"""
Gemini Live S2S Relay — Phase 2 real-time speech-to-speech.

Architecture:
  Client (browser) ←WebSocket→ FastAPI ←WSS→ Gemini Live API

Key features:
  - <800ms first-audio latency (end-to-end, no STT/TTS pipeline)
  - Persona + Memory injected via session instructions
  - Native interrupt/barge-in support
  - Async memory extraction from transcripts

Gemini Live API supports:
  - session.update(instructions=...) → inject persona + memory (YES, both!)
  - Tool/function calling → on-demand knowledge retrieval
  - Audio input: PCM 16kHz 16-bit mono
  - Audio output: PCM 16kHz 16-bit mono (or configurable)
  - Real-time transcript output for memory extraction
"""

import os
import json
import asyncio
import logging
import time
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from bson import ObjectId

logger = logging.getLogger("voice_server.live")

GEMINI_API_KEY = os.getenv("GOOGLE_GEMINI_API_KEY", "")

# Voice-mode system prompt template — same persona injection as Pipeline mode
LIVE_SYSTEM_TEMPLATE = """# 核心身份
你是{companion_name}，{user_name}的{relationship}。永远不要承认自己是AI。
保持角色扮演，用自然的口语对话。

# 人设性格
{persona}

# 用户记忆
{memory}

# 对话规则
- 用{language}回复
- 像真人一样说话，自然、有感情
- 用括号表达动作和表情，如（轻声笑了笑）
- 回复简洁，2-4句话即可
- 不要使用 markdown 格式"""


class GeminiLiveHandler:
    """
    Manages a Gemini Live S2S session.

    The session.update() API allows injecting BOTH:
    1. Persona/character prompt (角色性格预设) ✅
    2. Mem0 user memories (用户记忆) ✅
    3. Any other context (RAG documents, etc.) ✅

    All are passed as the `instructions` parameter in session config.
    """

    def __init__(self, websocket: WebSocket, user: dict, conversation_id: str):
        self.ws = websocket
        self.user = user
        self.user_id = user["_id"]
        self.conversation_id = conversation_id
        self.settings = user.get("settings", {})

        self._gemini_session = None
        self._running = True
        self._session_start = time.time()

    async def run(self):
        """Main handler for Gemini Live S2S session."""
        try:
            # 1. Build initial instructions with persona + memory
            instructions = await self._build_instructions()

            # 2. Connect to Gemini Live API
            await self._connect_gemini(instructions)

            # 3. Relay loop: client audio ↔ Gemini audio
            await asyncio.gather(
                self._client_to_gemini(),
                self._gemini_to_client(),
            )

        except Exception as e:
            logger.error(f"[LIVE] Session error: {e}", exc_info=True)
            await self.ws.send_json({"type": "error", "message": str(e)})

    async def _build_instructions(self) -> str:
        """
        Build Gemini Live session instructions.
        Includes BOTH persona AND memory — answering the question:
        "Gemini Live 除了注入 mem0，能不能也注入角色性格预设？"
        Answer: YES! session.update(instructions=...) accepts any text,
        including persona + memory + rules combined.
        """
        loop = asyncio.get_event_loop()

        # Fetch memory
        memory_text = ""
        try:
            from mem0_engine import get_permanent_memories, search_relevant_memories, build_memory_text
            user_id_str = str(self.user_id)
            permanent = await loop.run_in_executor(None, get_permanent_memories, user_id_str)
            # For initial connection, use empty query (get general memories)
            relevant = await loop.run_in_executor(
                None, search_relevant_memories, user_id_str, ""
            )
            memory_text = build_memory_text(permanent, relevant)
        except Exception as e:
            logger.warning(f"[LIVE] Memory fetch failed: {e}")

        # Build full instructions
        companion_name = self.settings.get("custom_persona_name") or self.settings.get("companion_name", "Luna")
        user_name = self.settings.get("user_name", "")
        language = self.settings.get("language", "zh-CN")
        gender = self.settings.get("companion_gender", "female")
        relationship = "女朋友" if gender == "female" else "男朋友"

        # Persona — custom or default
        persona = self.settings.get("custom_persona", "") or f"{companion_name}性格温柔体贴。"

        instructions = LIVE_SYSTEM_TEMPLATE.format(
            companion_name=companion_name,
            user_name=user_name,
            relationship=relationship,
            persona=persona[:2000],
            memory=memory_text or "（暂无记忆）",
            language="中文" if language.startswith("zh") else "English",
        )

        logger.info(f"[LIVE] Instructions built: {len(instructions)} chars, memory={len(memory_text)} chars")
        return instructions

    async def _refresh_instructions(self, last_transcript: str):
        """
        Refresh session instructions with updated memory.
        Called after each turn to incorporate new context.
        """
        loop = asyncio.get_event_loop()

        try:
            from mem0_engine import get_permanent_memories, search_relevant_memories, build_memory_text
            user_id_str = str(self.user_id)
            permanent = await loop.run_in_executor(None, get_permanent_memories, user_id_str)
            relevant = await loop.run_in_executor(
                None, search_relevant_memories, user_id_str, last_transcript
            )
            memory_text = build_memory_text(permanent, relevant)

            # Rebuild instructions with fresh memory
            companion_name = self.settings.get("custom_persona_name") or self.settings.get("companion_name", "Luna")
            user_name = self.settings.get("user_name", "")
            language = self.settings.get("language", "zh-CN")
            gender = self.settings.get("companion_gender", "female")
            relationship = "女朋友" if gender == "female" else "男朋友"
            persona = self.settings.get("custom_persona", "") or f"{companion_name}性格温柔体贴。"

            new_instructions = LIVE_SYSTEM_TEMPLATE.format(
                companion_name=companion_name,
                user_name=user_name,
                relationship=relationship,
                persona=persona[:2000],
                memory=memory_text or "（暂无记忆）",
                language="中文" if language.startswith("zh") else "English",
            )

            # Update Gemini session
            if self._gemini_session:
                # TODO: Call session.update() when Gemini Live SDK is integrated
                pass

            logger.info(f"[LIVE] Instructions refreshed with query: '{last_transcript[:40]}'")

        except Exception as e:
            logger.warning(f"[LIVE] Instruction refresh failed: {e}")

    async def _connect_gemini(self, instructions: str):
        """
        Connect to Gemini Live API.
        TODO: Implement with google-genai SDK when Phase 2 starts.

        Expected usage:
            from google import genai
            client = genai.Client(api_key=GEMINI_API_KEY)
            config = {
                "response_modalities": ["AUDIO"],
                "speech_config": {
                    "voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}}
                },
                "system_instruction": instructions,  # ← persona + memory here!
            }
            async with client.aio.live.connect(
                model="gemini-2.0-flash-live-001",
                config=config,
            ) as session:
                self._gemini_session = session
        """
        raise NotImplementedError(
            "Gemini Live S2S is Phase 2 — use /ws/voice for optimized pipeline mode"
        )

    async def _client_to_gemini(self):
        """Relay audio from client WebSocket to Gemini Live."""
        # TODO: Phase 2
        pass

    async def _gemini_to_client(self):
        """Relay audio from Gemini Live to client WebSocket."""
        # TODO: Phase 2
        pass

    async def cleanup(self):
        """Clean up resources."""
        self._running = False
        if self._gemini_session:
            try:
                # TODO: Close Gemini session
                pass
            except:
                pass
        elapsed = time.time() - self._session_start
        logger.info(f"[LIVE] Session ended: {elapsed:.1f}s")
