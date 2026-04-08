"""
Voice Pipeline WebSocket Handler — orchestrates STT → LLM → TTS in real time.

This is the main handler for /ws/voice connections. It manages:
  1. Receiving audio chunks from client → Deepgram streaming STT
  2. LLM response via AnythingLLM (preserves all chat history & RAG)
  3. Pipelined TTS with ordered audio playback
  4. User interrupt handling

LLM goes through AnythingLLM (not direct Gemini) so that:
  - Chat history is automatically saved in AnythingLLM sessions
  - RAG document retrieval works
  - Voice ↔ text chat memory continuity is preserved
"""

import json
import asyncio
import logging
import re
import time
from typing import AsyncIterator, Optional

from fastapi import WebSocket, WebSocketDisconnect
from bson import ObjectId

import os
from voice_server.stt_deepgram import DeepgramStreamingSTT, WhisperFallbackSTT

# Feature flag: use Deepgram streaming STT or fallback to Whisper batch
USE_DEEPGRAM = bool(os.getenv("DEEPGRAM_API_KEY", ""))
from voice_server.tts_stream import (
    StreamingTTSPipeline,
    warmup as tts_warmup,
    clean_text_for_tts,
)

logger = logging.getLogger("voice_server.ws")


class VoicePipelineHandler:
    """
    Manages a single voice call session over WebSocket.

    State machine:
      idle → listening → processing → speaking → listening → ...
    """

    # Voice: non-reasoning for speed. Text chat keeps its own model.
    VOICE_MODEL = os.getenv("VOICE_CHAT_MODEL", "grok-4-1-fast-non-reasoning")

    def __init__(self, websocket: WebSocket, user: dict, conversation_id: str):
        self.ws = websocket
        self.user = user
        self.user_id = user["_id"]
        self.conversation_id = conversation_id
        self.settings = user.get("settings", {})

        # Voice configuration
        self._voice_ref_id = self._resolve_voice_ref_id()
        self._language = self.settings.get("language", "en")
        self._voice_lang = "zh" if self._language.startswith("zh") else "en"

        # State
        self._state = "idle"
        self._stt: Optional[DeepgramStreamingSTT] = None
        self._tts_pipeline: Optional[StreamingTTSPipeline] = None
        self._interrupted = False
        self._running = True

        # Whisper fallback: collect raw audio chunks when Deepgram unavailable
        self._audio_chunks: list[bytes] = []

        # Audio config (updated by client "config" message)
        self._sample_rate = 48000  # Default; client sends actual rate

        # Timing
        self._session_start = time.time()

    def _resolve_voice_ref_id(self) -> str:
        """Get Fish Audio voice reference ID for this user."""
        from voice_service import get_voice_ref_id
        voice_id = self.settings.get("voice_id", "")
        if voice_id:
            return voice_id
        gender = self.settings.get("companion_gender", "female")
        subtype = self.settings.get("companion_subtype", "")
        lang = "zh" if self.settings.get("language", "en").startswith("zh") else "en"
        return get_voice_ref_id(gender, subtype, lang)

    async def _send_state(self, state: str):
        """Update state and notify client."""
        self._state = state
        try:
            await self.ws.send_json({"type": "state", "state": state})
        except Exception:
            pass

    async def _send_json(self, data: dict):
        """Send JSON message to client."""
        try:
            await self.ws.send_json(data)
        except Exception:
            pass

    async def _send_binary(self, data: bytes):
        """Send binary audio to client."""
        try:
            await self.ws.send_bytes(data)
        except Exception:
            pass

    async def run(self):
        """Main loop: handle incoming WebSocket messages."""
        # Warmup TTS connection in background
        asyncio.create_task(tts_warmup(self._voice_ref_id))

        await self._send_state("listening")

        # Start collecting audio for STT
        await self._start_stt()

        while self._running:
            try:
                message = await self.ws.receive()
            except WebSocketDisconnect:
                self._running = False
                break

            msg_type = message.get("type", "")

            if msg_type == "websocket.receive":
                if "bytes" in message and message["bytes"]:
                    # Binary audio chunk → forward to STT
                    await self._handle_audio_chunk(message["bytes"])

                elif "text" in message and message["text"]:
                    # JSON control message
                    try:
                        data = json.loads(message["text"])
                        await self._handle_control(data)
                    except json.JSONDecodeError:
                        pass

            elif msg_type == "websocket.disconnect":
                self._running = False
                break

    async def _handle_audio_chunk(self, chunk: bytes):
        """Forward audio chunk to STT engine or collect for Whisper fallback."""
        if self._state == "listening":
            if self._stt:
                # Deepgram streaming mode
                await self._stt.send_audio(chunk)
            else:
                # Whisper fallback: collect chunks for batch transcription
                self._audio_chunks.append(chunk)

        elif self._state == "speaking":
            # Audio while AI is speaking = potential interrupt
            # Client should send {"type": "interrupt"} for explicit interrupt
            pass

    async def _handle_control(self, data: dict):
        """Handle JSON control messages from client."""
        msg_type = data.get("type", "")

        if msg_type == "end_turn":
            # User finished speaking — process the audio
            if self._state == "listening":
                await self._process_turn()

        elif msg_type == "interrupt":
            # User interrupted AI speech
            await self._handle_interrupt()

        elif msg_type == "config":
            # Update session config
            if "sample_rate" in data:
                self._sample_rate = int(data["sample_rate"])
                logger.info(f"[WS] Client sample rate: {self._sample_rate}Hz")
                # Restart STT with correct sample rate
                if self._stt:
                    await self._stt.close()
                await self._start_stt()
            if "voice_ref_id" in data:
                self._voice_ref_id = data["voice_ref_id"]
                logger.info(f"[WS] Voice changed to: {self._voice_ref_id}")

        elif msg_type == "ping":
            await self._send_json({"type": "pong"})

    async def _start_stt(self):
        """Initialize STT: Deepgram streaming or Whisper fallback."""
        self._audio_chunks = []  # Reset audio buffer

        if USE_DEEPGRAM:
            try:
                self._stt = DeepgramStreamingSTT()
                await self._stt.connect(
                    language=self._voice_lang,
                    sample_rate=self._sample_rate,
                    encoding="linear16",
                    endpointing=400,
                )

                # Background: listen for speech_final → auto-trigger processing
                asyncio.create_task(self._stt_auto_process())

                logger.info("[WS] Deepgram STT session started")
            except Exception as e:
                logger.error(f"[WS] Failed to start Deepgram STT: {e}")
                self._stt = None
                logger.info("[WS] Falling back to Whisper batch STT")
        else:
            self._stt = None
            logger.info("[WS] Using Whisper batch STT (DEEPGRAM_API_KEY not set)")

    async def _stt_auto_process(self):
        """
        Listen for Deepgram speech_final events and auto-trigger processing.
        This replaces client-side VAD silence detection for turn-taking.
        """
        if not self._stt:
            return

        try:
            async for result in self._stt.transcripts():
                if not self._running:
                    break

                # Send interim transcripts to client for display
                if result.text:
                    await self._send_json({
                        "type": "transcript",
                        "text": result.text,
                        "is_final": result.is_final,
                    })

                # speech_final = Deepgram detected end of utterance
                if result.speech_final and self._state == "listening":
                    transcript = self._stt.get_full_transcript()
                    if transcript and transcript.strip():
                        # Close current STT (we have the full text)
                        await self._stt.close()
                        self._stt = None
                        # Process the turn
                        asyncio.create_task(self._process_turn_with_transcript(transcript))
                        return

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[WS] STT auto-process error: {e}")

    async def _process_turn(self):
        """
        Process a complete user turn (triggered by client end_turn signal).
        Handles both Deepgram streaming and Whisper batch fallback.
        """
        transcript = ""

        if self._stt:
            # Deepgram streaming mode: finalize and get transcript
            await self._stt.finish_stream()
            transcript = self._stt.get_full_transcript()
            await self._stt.close()
            self._stt = None
        elif self._audio_chunks:
            # Whisper batch fallback: concatenate PCM chunks, transcribe
            await self._send_state("processing")
            raw_audio = b"".join(self._audio_chunks)
            self._audio_chunks = []
            if len(raw_audio) > 600:  # Skip too-short recordings
                try:
                    # PCM 16kHz 16-bit → WAV header + data for Whisper
                    wav_audio = self._pcm_to_wav(raw_audio)
                    transcript = await WhisperFallbackSTT.transcribe(wav_audio, "wav")
                except Exception as e:
                    logger.error(f"[WS] Whisper fallback error: {e}")

        if not transcript or not transcript.strip():
            logger.info("[WS] Empty transcript, returning to listening")
            await self._send_json({"type": "error", "message": "Could not recognize speech"})
            await self._send_state("listening")
            await self._start_stt()
            return

        await self._process_turn_with_transcript(transcript)

    @staticmethod
    def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
        """Convert raw PCM 16-bit mono to WAV format for Whisper."""
        import struct
        num_channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = len(pcm_data)

        header = struct.pack(
            '<4sI4s4sIHHIIHH4sI',
            b'RIFF',
            36 + data_size,
            b'WAVE',
            b'fmt ',
            16,                   # chunk size
            1,                    # PCM format
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b'data',
            data_size,
        )
        return header + pcm_data

    async def _process_turn_with_transcript(self, transcript: str):
        """
        Process a complete user turn with known transcript:
          1. Parallel: gather context (memory + history)
          2. Stream LLM → pipe to TTS → send audio to client
          3. Save conversation to DB
        """
        t_start = time.time()
        await self._send_state("processing")
        self._interrupted = False

        logger.info(f"[WS] Processing transcript: '{transcript[:80]}'")

        # Send final transcript to client
        await self._send_json({
            "type": "transcript",
            "text": transcript,
            "is_final": True,
        })

        # 2. Setup AnythingLLM workspace
        try:
            loop = asyncio.get_event_loop()
            workspace_slug, api = await self._get_anythingllm()
            t_setup = time.time()
            logger.info(f"[WS] AnythingLLM ready ({t_setup - t_start:.2f}s)")
        except Exception as e:
            logger.error(f"[WS] AnythingLLM setup failed: {e}")
            await self._send_json({"type": "error", "message": f"LLM setup error: {e}"})
            await self._send_state("listening")
            await self._start_stt()
            return

        # 3. Stream LLM (via AnythingLLM) → TTS → audio to client
        await self._send_state("speaking")

        tts = StreamingTTSPipeline(self._voice_ref_id)
        self._tts_pipeline = tts
        full_reply = ""
        thinking_content = ""
        in_thinking = False

        async def llm_to_tts():
            """Stream AnythingLLM tokens into TTS pipeline."""
            nonlocal full_reply, thinking_content, in_thinking
            try:
                async for token in self._stream_anythingllm(api, transcript):
                    if self._interrupted:
                        break

                    full_reply += token

                    # Filter <think> tags — don't TTS thinking content
                    if "<think>" in token.lower() or "<thought>" in token.lower():
                        in_thinking = True
                        continue
                    if "</think>" in token.lower() or "</thought>" in token.lower():
                        in_thinking = False
                        continue
                    if in_thinking:
                        thinking_content += token
                        continue

                    tts.feed_token(token)
            except Exception as e:
                logger.error(f"[WS] LLM stream error: {e}")
            finally:
                await tts.flush()

        async def tts_to_client():
            """Send TTS audio segments to client as binary frames."""
            try:
                async for clause_text, audio_bytes in tts.audio_segments():
                    if self._interrupted:
                        break
                    if audio_bytes:
                        await self._send_binary(audio_bytes)
                        logger.debug(f"[WS] Sent audio: '{clause_text[:20]}' ({len(audio_bytes)} bytes)")
            except Exception as e:
                logger.error(f"[WS] TTS→client error: {e}")

        # Run both concurrently
        await asyncio.gather(
            llm_to_tts(),
            tts_to_client(),
        )

        t_done = time.time()
        self._tts_pipeline = None

        if self._interrupted:
            logger.info(f"[WS] Turn interrupted after {t_done - t_start:.2f}s")
        else:
            logger.info(
                f"[WS] Turn complete: {t_done - t_start:.2f}s total "
                f"(setup={t_setup - t_start:.2f}s, "
                f"LLM+TTS={t_done - t_setup:.2f}s)"
            )

        # Send full reply text for chat display
        if full_reply:
            display_reply = re.sub(
                r'<(?:think|thought)>.*?</(?:think|thought)>',
                '', full_reply, flags=re.DOTALL
            ).strip()

            await self._send_json({
                "type": "reply",
                "text": display_reply,
                "thinking": thinking_content if thinking_content else None,
                "conversation_id": self.conversation_id,
            })

        # 4. Signal turn complete
        await self._send_json({"type": "done"})

        # 5. Save + restore model (background)
        clean_reply = display_reply if full_reply else ""
        asyncio.create_task(self._save_turn(transcript, clean_reply))
        asyncio.create_task(self._restore_model())

        # 6. Return to listening
        if not self._interrupted:
            await self._send_state("listening")
            await self._start_stt()

    async def _get_anythingllm(self):
        """Get AnythingLLM workspace, switch to voice model."""
        loop = asyncio.get_event_loop()
        from workspace_manager import WorkspaceManager
        from anythingllm_api import AnythingLLMAPI
        import requests as _req

        wm = WorkspaceManager()
        self._wm = wm  # Save for restore
        ws_result = await loop.run_in_executor(
            None, wm.get_or_create_workspace, self.user_id
        )
        if not ws_result.get("success"):
            raise Exception(f"Workspace error: {ws_result.get('error', 'unknown')}")

        slug = ws_result["workspace"]["slug"]
        self._workspace_slug = slug

        # Read current model before switching
        try:
            resp = await loop.run_in_executor(None, lambda: _req.get(
                f"{wm.anythingllm_base_url}/api/v1/workspace/{slug}",
                headers={"Authorization": f"Bearer {wm.anythingllm_api_key}"},
                timeout=5,
            ))
            ws_list = resp.json().get("workspace", [])
            ws_data = ws_list[0] if isinstance(ws_list, list) and ws_list else ws_list
            self._original_model = ws_data.get("chatModel", "") if isinstance(ws_data, dict) else ""
        except Exception:
            self._original_model = "grok-4-1-fast-reasoning"

        # Switch to fast non-reasoning model for voice
        if self._original_model != self.VOICE_MODEL:
            try:
                await loop.run_in_executor(None, lambda: _req.post(
                    f"{wm.anythingllm_base_url}/api/v1/workspace/{slug}/update",
                    headers={"Authorization": f"Bearer {wm.anythingllm_api_key}",
                             "Content-Type": "application/json"},
                    json={"chatModel": self.VOICE_MODEL},
                    timeout=5,
                ))
                logger.info(f"[WS] Voice model: {self._original_model} → {self.VOICE_MODEL}")
            except Exception as e:
                logger.warning(f"[WS] Model switch failed: {e}")

        api = AnythingLLMAPI(
            base_url=wm.anythingllm_base_url,
            api_key=wm.anythingllm_api_key,
            workspace_slug=slug,
        )
        return slug, api

    async def _restore_model(self):
        """Restore original model after voice call."""
        if not getattr(self, '_original_model', None) or not getattr(self, '_wm', None):
            return
        if self._original_model == self.VOICE_MODEL:
            return  # No change needed
        try:
            loop = asyncio.get_event_loop()
            import requests as _req
            slug = self._workspace_slug
            wm = self._wm
            await loop.run_in_executor(None, lambda: _req.post(
                f"{wm.anythingllm_base_url}/api/v1/workspace/{slug}/update",
                headers={"Authorization": f"Bearer {wm.anythingllm_api_key}",
                         "Content-Type": "application/json"},
                json={"chatModel": self._original_model},
                timeout=5,
            ))
            logger.info(f"[WS] Restored model: {self.VOICE_MODEL} → {self._original_model}")
        except Exception as e:
            logger.warning(f"[WS] Model restore failed: {e}")

    async def _stream_anythingllm(
        self, api, transcript: str
    ) -> AsyncIterator[str]:
        """
        Stream tokens from AnythingLLM (sync generator → async yield).
        Uses the same session_id as the conversation for history continuity.
        """
        loop = asyncio.get_event_loop()
        import queue as queue_mod
        token_queue: queue_mod.Queue = queue_mod.Queue()
        _SENTINEL = object()

        def _run_stream():
            """Run AnythingLLM sync stream in thread, put tokens in queue."""
            try:
                for chunk in api.send_message_stream(
                    transcript,
                    session_id=self.conversation_id or "default-session",
                ):
                    if chunk.get("error"):
                        logger.error(f"[WS] AnythingLLM error: {chunk['error']}")
                        break
                    token = chunk.get("textResponse", "")
                    if token:
                        token_queue.put(token)
            except Exception as e:
                logger.error(f"[WS] AnythingLLM stream error: {e}")
            finally:
                token_queue.put(_SENTINEL)

        # Run sync stream in background thread
        thread_future = loop.run_in_executor(None, _run_stream)

        # Yield tokens as they arrive — poll queue with short timeouts
        total_wait = 0.0
        max_wait = 60.0  # Overall timeout for the entire LLM response
        poll_interval = 0.1  # Check every 100ms

        while total_wait < max_wait:
            try:
                # Non-blocking check
                item = token_queue.get_nowait()
                if item is _SENTINEL:
                    break
                yield item
                total_wait = 0.0  # Reset timeout when we get a token
            except queue_mod.Empty:
                # No token yet — wait a bit and retry
                await asyncio.sleep(poll_interval)
                total_wait += poll_interval
                # If thread died, stop waiting
                if thread_future.done():
                    # Drain remaining items
                    while not token_queue.empty():
                        item = token_queue.get_nowait()
                        if item is _SENTINEL:
                            break
                        yield item
                    break

    async def _save_turn(self, user_text: str, ai_reply: str):
        """Save both user voice message and AI reply to MongoDB."""
        try:
            loop = asyncio.get_event_loop()
            from database import db

            if self.conversation_id:
                conv_id = ObjectId(self.conversation_id)
            else:
                conv = await loop.run_in_executor(
                    None, db.get_active_conversation, self.user_id
                )
                conv_id = conv["_id"]
                self.conversation_id = str(conv_id)

            # Save user message
            await loop.run_in_executor(
                None,
                db.add_message_to_conversation,
                conv_id, self.user_id, "user", user_text,
                None, None, None, "voice", None, None,
            )

            # Save AI reply (also marked as voice type for UI rendering)
            if ai_reply:
                await loop.run_in_executor(
                    None,
                    db.add_message_to_conversation,
                    conv_id, self.user_id, "assistant", ai_reply,
                    None, None, None, "voice", None, None,
                )

            logger.info(f"[WS] Saved turn: user={len(user_text)} chars, ai={len(ai_reply)} chars")
        except Exception as e:
            logger.error(f"[WS] Save turn error: {e}")

    async def _handle_interrupt(self):
        """Handle user interrupt: stop TTS, return to listening."""
        logger.info("[WS] User interrupt")
        self._interrupted = True

        # Cancel TTS pipeline
        if self._tts_pipeline:
            await self._tts_pipeline.cancel()

        # Return to listening
        await self._send_state("listening")
        await self._start_stt()



    async def cleanup(self):
        """Clean up resources when session ends."""
        self._running = False

        # Always restore text chat model on disconnect
        await self._restore_model()

        if self._stt:
            await self._stt.close()
            self._stt = None

        if self._tts_pipeline:
            await self._tts_pipeline.cancel()
            self._tts_pipeline = None

        elapsed = time.time() - self._session_start
        logger.info(f"[WS] Session cleanup: duration={elapsed:.1f}s")
