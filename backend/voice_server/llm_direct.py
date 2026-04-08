"""
Direct Gemini Flash LLM — bypasses AnythingLLM for lower latency.

Handles:
  1. Parallel context retrieval (Mem0 memory + chat history)
  2. Voice-optimized system prompt construction
  3. Streaming token generation via Gemini Flash API

Saves ~300-500ms by eliminating the AnythingLLM proxy hop.
"""

import os
import re
import asyncio
import logging
from typing import AsyncIterator, Dict, List, Optional, Tuple

from bson import ObjectId

logger = logging.getLogger("voice_server.llm")

GEMINI_API_KEY = os.getenv("GOOGLE_GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("VOICE_LLM_MODEL", "gemini-2.5-flash")

# Voice mode produces shorter replies — faster TTS, more natural conversation
VOICE_MAX_TOKENS = 300

# System prompt template for voice mode (shorter than text chat template)
VOICE_SYSTEM_TEMPLATE = """# 核心规则
用<think>标签思考后再回复。

# 语言
始终使用用户消息的语言回复。用户语言偏好：{language}

# 角色
你是{companion_name}，{user_name}的{relationship}。永远不要承认自己是AI。

# 人设
{persona}

# 记忆
{memory}

# 语音模式特别规则
- 回复要简洁自然，像真人说话，适合语音播放
- 不要使用 markdown 格式（粗体、列表等）
- 不要使用 [IMAGE:] 标签
- 用括号表达动作：（轻声笑了笑）
- 1-2个emoji即可
- 回复控制在2-4句话"""


async def gather_context(
    user_id: ObjectId,
    user_settings: dict,
    conversation_id: str,
    transcript: str,
) -> Tuple[str, str, List[dict]]:
    """
    Parallel context retrieval — runs Mem0 + DB queries concurrently.

    Returns:
        (system_prompt, memory_text, chat_history)
    """
    loop = asyncio.get_event_loop()

    # --- Run all I/O in parallel ---
    async def fetch_memory():
        """Retrieve Mem0 memories (sync functions wrapped for async)."""
        try:
            from mem0_engine import (
                search_relevant_memories,
                get_permanent_memories,
                build_memory_text,
            )
            user_id_str = str(user_id)
            permanent = await loop.run_in_executor(
                None, get_permanent_memories, user_id_str
            )
            relevant = await loop.run_in_executor(
                None, search_relevant_memories, user_id_str, transcript
            )
            text = build_memory_text(permanent, relevant)
            logger.info(
                f"[LLM] Memory: {len(permanent)} permanent, "
                f"{len(relevant)} relevant → {len(text)} chars"
            )
            return text
        except Exception as e:
            logger.warning(f"[LLM] Memory retrieval failed: {e}")
            return ""

    async def fetch_history():
        """Retrieve recent chat history from MongoDB."""
        try:
            from database import db
            if conversation_id:
                conv = db.get_conversation(ObjectId(conversation_id), user_id)
            else:
                conv = db.get_active_conversation(user_id)

            if not conv or not conv.get("messages"):
                return []

            # Last 6 messages for voice mode (less context = faster TTFT)
            messages = conv["messages"][-6:]
            history = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if content:
                    # Strip thinking tags from history
                    content = re.sub(
                        r"<(?:think|thought)>.*?</(?:think|thought)>",
                        "",
                        content,
                        flags=re.DOTALL,
                    ).strip()
                    if content:
                        history.append({"role": role, "content": content})
            return history
        except Exception as e:
            logger.warning(f"[LLM] History retrieval failed: {e}")
            return []

    # Execute in parallel
    memory_text, history = await asyncio.gather(
        fetch_memory(),
        fetch_history(),
    )

    # --- Build system prompt ---
    settings = user_settings or {}
    companion_name = settings.get("custom_persona_name") or settings.get("companion_name", "Luna")
    user_name = settings.get("user_name", "")
    language = settings.get("language", "en")
    persona = settings.get("custom_persona", "") or _default_persona(settings)
    gender = settings.get("companion_gender", "female")
    relationship = "女朋友" if gender == "female" else "男朋友"

    system_prompt = VOICE_SYSTEM_TEMPLATE.format(
        language=language,
        companion_name=companion_name,
        user_name=user_name,
        relationship=relationship,
        persona=persona[:1500],  # Cap persona length for faster TTFT
        memory=memory_text or "（暂无记忆）",
    )

    return system_prompt, memory_text, history


def _default_persona(settings: dict) -> str:
    """Generate a default persona if no custom one is set."""
    gender = settings.get("companion_gender", "female")
    subtype = settings.get("companion_subtype", "")
    name = settings.get("companion_name", "Luna")

    type_desc = {
        "female_gentle": "温柔体贴，善解人意",
        "female_cold": "高冷成熟，知性优雅",
        "female_cute": "可爱活泼，天真浪漫",
        "female_cheerful": "开朗阳光，充满活力",
        "male_ceo": "霸道自信，有担当",
        "male_warm": "温暖细心，善于倾听",
        "male_classmate": "阳光帅气，运动系",
        "male_badboy": "酷酷的，神秘感",
    }.get(subtype, "温柔体贴")

    return f"{name}的性格：{type_desc}。"


async def stream_reply(
    transcript: str,
    system_prompt: str,
    chat_history: List[dict],
) -> AsyncIterator[str]:
    """
    Stream tokens from Gemini Flash.

    Yields:
        Individual tokens/chunks as they arrive from the model.
        Thinking content (<think>...</think>) is filtered out.
    """
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=system_prompt,
            generation_config={
                "temperature": 0.85,
                "max_output_tokens": VOICE_MAX_TOKENS,
                "top_p": 0.95,
            },
        )

        # Build conversation for Gemini
        contents = []
        for msg in chat_history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [msg["content"]]})

        # Add current user message
        contents.append({"role": "user", "parts": [transcript]})

        logger.info(
            f"[LLM] Streaming: model={GEMINI_MODEL}, "
            f"history={len(chat_history)} msgs, prompt={len(system_prompt)} chars"
        )

        # Stream response
        response = model.generate_content(contents, stream=True)

        in_thinking = False
        for chunk in response:
            if not chunk.text:
                continue

            text = chunk.text

            # Filter thinking blocks (don't TTS them)
            # Handle chunks that may split <think> tags across boundaries
            if "<think>" in text.lower():
                in_thinking = True
                # Yield any text before the <think> tag
                before = re.split(r"<think>", text, flags=re.IGNORECASE)[0]
                if before.strip():
                    yield before
                continue

            if "</think>" in text.lower():
                in_thinking = False
                # Yield any text after the </think> tag
                after = re.split(r"</think>", text, flags=re.IGNORECASE)[-1]
                if after.strip():
                    yield after
                continue

            if in_thinking:
                continue

            yield text

    except Exception as e:
        logger.error(f"[LLM] Gemini streaming error: {e}", exc_info=True)
        yield f"抱歉，我遇到了一点问题，请再说一次。"


async def stream_reply_full(
    user_id: ObjectId,
    user_settings: dict,
    conversation_id: str,
    transcript: str,
) -> AsyncIterator[str]:
    """
    High-level API: gather context + stream reply.
    Combines parallel context retrieval with streaming LLM output.
    """
    system_prompt, memory_text, history = await gather_context(
        user_id, user_settings, conversation_id, transcript
    )

    async for token in stream_reply(transcript, system_prompt, history):
        yield token
