"""
Deepgram Streaming STT — WebSocket-based real-time speech-to-text.

Replaces the batch Whisper upload (1-3s) with streaming transcription (~300ms).

Usage:
    stt = DeepgramStreamingSTT()
    await stt.connect(language="zh")
    await stt.send_audio(chunk)           # non-blocking
    async for result in stt.transcripts(): # yields partial + final
        if result.is_final:
            final_text = result.text
    await stt.close()
"""

import os
import json
import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import websockets

logger = logging.getLogger("voice_server.stt")

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

# Deepgram WebSocket endpoint
DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"


@dataclass
class TranscriptResult:
    """A single transcript result from Deepgram."""
    text: str
    is_final: bool
    confidence: float = 0.0
    speech_final: bool = False  # True when Deepgram detects end of utterance


class DeepgramStreamingSTT:
    """
    Manages a single Deepgram streaming STT session.

    Lifecycle:
        1. connect() — open WebSocket to Deepgram
        2. send_audio() — push audio chunks as they arrive from client
        3. transcripts() — async generator yielding TranscriptResult
        4. finish_stream() — signal end of audio, get final results
        5. close() — clean up
    """

    def __init__(self):
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._transcript_queue: asyncio.Queue[Optional[TranscriptResult]] = asyncio.Queue()
        self._receive_task: Optional[asyncio.Task] = None
        self._closed = False
        self._final_text_parts: list[str] = []

    async def connect(
        self,
        language: str = "zh",
        sample_rate: int = 16000,
        encoding: str = "linear16",
        channels: int = 1,
        interim_results: bool = True,
        endpointing: int = 400,  # ms — how quickly to detect end of speech
        vad_events: bool = True,
    ):
        """
        Open a WebSocket connection to Deepgram.

        Args:
            language: BCP-47 language code ("zh", "en", "multi" for auto-detect)
            sample_rate: Audio sample rate in Hz
            encoding: Audio encoding ("linear16" for PCM, "opus" for webm)
            channels: Number of audio channels
            interim_results: Whether to return partial transcripts
            endpointing: Silence duration (ms) to trigger utterance end
            vad_events: Whether to emit VAD events
        """
        if not DEEPGRAM_API_KEY:
            raise ValueError("DEEPGRAM_API_KEY not set in environment")

        # Build WebSocket URL with query params
        params = {
            "model": "nova-3",
            "language": language if language != "multi" else "multi",
            "channels": str(channels),
            "interim_results": str(interim_results).lower(),
            "endpointing": str(endpointing),
            "vad_events": str(vad_events).lower(),
            "punctuate": "true",
            "smart_format": "true",
        }
        # Only set encoding/sample_rate for raw formats (linear16, etc.)
        # For container formats (webm, ogg), Deepgram auto-detects — don't specify
        if encoding in ("linear16", "mulaw", "alaw", "flac"):
            params["encoding"] = encoding
            params["sample_rate"] = str(sample_rate)
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{DEEPGRAM_WS_URL}?{query}"

        logger.info(f"[STT] Connecting to Deepgram: lang={language}, rate={sample_rate}")

        self._ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
            ping_interval=20,
            ping_timeout=10,
        )

        # Start background task to receive messages
        self._receive_task = asyncio.create_task(self._receive_loop())
        logger.info("[STT] Deepgram connected")

    async def send_audio(self, chunk: bytes):
        """
        Send an audio chunk to Deepgram. Non-blocking.
        Call this as audio chunks arrive from the client WebSocket.
        """
        if self._ws and not self._closed:
            try:
                await self._ws.send(chunk)
            except Exception as e:
                logger.warning(f"[STT] Failed to send audio chunk: {e}")

    async def finish_stream(self):
        """
        Signal that audio input is complete.
        Deepgram will flush any remaining transcript.
        """
        if self._ws and not self._closed:
            try:
                # Send CloseStream message per Deepgram protocol
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                logger.info("[STT] Sent CloseStream to Deepgram")
            except Exception as e:
                logger.warning(f"[STT] Failed to send CloseStream: {e}")

    async def transcripts(self) -> AsyncIterator[TranscriptResult]:
        """
        Async generator that yields TranscriptResult as they arrive.
        Yields both partial (interim) and final results.
        Ends when the connection closes or finish_stream() completes.
        """
        while True:
            result = await self._transcript_queue.get()
            if result is None:
                # Sentinel — stream ended
                break
            yield result

    def get_full_transcript(self) -> str:
        """Get the concatenated final transcript so far."""
        return "".join(self._final_text_parts)

    async def close(self):
        """Clean up WebSocket and background task."""
        self._closed = True

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        if self._ws:
            try:
                await self._ws.close()
            except:
                pass
            self._ws = None

        # Push sentinel to unblock any waiting consumer
        await self._transcript_queue.put(None)
        logger.info("[STT] Deepgram session closed")

    async def _receive_loop(self):
        """Background task: read Deepgram WebSocket messages, parse transcripts."""
        try:
            async for message in self._ws:
                if self._closed:
                    break

                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "Results":
                    # Transcript result
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [])
                    if not alternatives:
                        continue

                    best = alternatives[0]
                    text = best.get("transcript", "").strip()
                    confidence = best.get("confidence", 0.0)
                    is_final = data.get("is_final", False)
                    speech_final = data.get("speech_final", False)

                    if text:
                        result = TranscriptResult(
                            text=text,
                            is_final=is_final,
                            confidence=confidence,
                            speech_final=speech_final,
                        )
                        await self._transcript_queue.put(result)

                        if is_final:
                            self._final_text_parts.append(text)
                            logger.info(
                                f"[STT] Final: '{text[:80]}' "
                                f"(conf={confidence:.2f}, speech_final={speech_final})"
                            )
                        else:
                            logger.debug(f"[STT] Partial: '{text[:60]}'")

                elif msg_type == "SpeechStarted":
                    logger.debug("[STT] Speech started")

                elif msg_type == "UtteranceEnd":
                    logger.debug("[STT] Utterance end detected")
                    # Signal utterance boundary
                    await self._transcript_queue.put(
                        TranscriptResult(text="", is_final=True, speech_final=True)
                    )

                elif msg_type == "Metadata":
                    logger.info(f"[STT] Session metadata: request_id={data.get('request_id', 'N/A')}")

                elif msg_type == "Error":
                    logger.error(f"[STT] Deepgram error: {data}")

        except websockets.exceptions.ConnectionClosed:
            logger.info("[STT] Deepgram connection closed")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[STT] Receive loop error: {e}", exc_info=True)
        finally:
            # Push sentinel to signal end of stream
            await self._transcript_queue.put(None)


class WhisperFallbackSTT:
    """
    Fallback: batch Whisper STT for when Deepgram is unavailable.
    Reuses existing voice_service.recognize_speech_whisper().
    """

    @staticmethod
    async def transcribe(audio_data: bytes, audio_format: str = "webm") -> str:
        """Batch transcribe using Whisper API (async wrapper)."""
        loop = asyncio.get_event_loop()
        from voice_service import recognize_speech
        return await loop.run_in_executor(None, recognize_speech, audio_data, audio_format)
