"""
Fish Audio Async TTS — sub-clause level streaming synthesis.

Improvements over the sync version in voice_service.py:
  - Async HTTP calls (httpx) — non-blocking
  - Sub-clause splitting (min 4 chars vs 6)
  - Pipelined: starts TTS on first clause while LLM still generates
  - Warmup support for the first call
"""

import os
import re
import asyncio
import logging
from typing import AsyncIterator, Tuple

import httpx

logger = logging.getLogger("voice_server.tts")

FISH_AUDIO_KEY = os.getenv("FISH_AUDIO_KEY", "")
FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts"

# Reuse voice map and cleaning from existing voice_service
# Import lazily to avoid issues when voice_service imports dashscope
_voice_service = None


def _get_voice_service():
    global _voice_service
    if _voice_service is None:
        import voice_service
        _voice_service = voice_service
    return _voice_service


# ==================== Text Cleaning ====================

# Action/emotion patterns to strip before TTS
_ACTION_PATTERNS = [
    re.compile(r'\[IMAGE:[^\]]*\]', re.DOTALL),
    re.compile(r'\uff08[^\uff09]*\uff09'),         # Chinese parens （...）
    re.compile(r'\uff08[^\uff09]*$'),               # Unclosed （...
    re.compile(r'^[^\uff08]*\uff09\s*'),            # Orphan ...）
    re.compile(r'\([^)]*\)'),                       # ASCII parens
    re.compile(r'\([^)]*$'),                        # Unclosed (...
    re.compile(r'^[^(]*\)\s*'),                     # Orphan ...)
    re.compile(r'\*[^*]+\*'),                       # Asterisk actions
]

_EMOJI_PATTERN = re.compile(
    r'[\U0001F600-\U0001F64F'
    r'\U0001F300-\U0001F5FF'
    r'\U0001F680-\U0001F6FF'
    r'\U0001F900-\U0001F9FF'
    r'\U0001FA00-\U0001FA6F'
    r'\U0001FA70-\U0001FAFF'
    r'\u2600-\u26FF'
    r'\u2700-\u27BF'
    r'\uFE00-\uFE0F'
    r'\u200D]+',
    flags=re.UNICODE,
)


def clean_text_for_tts(text: str) -> str:
    """Remove actions, emojis, and stage directions from text."""
    cleaned = text
    for pattern in _ACTION_PATTERNS:
        cleaned = pattern.sub('', cleaned)
    cleaned = _EMOJI_PATTERN.sub('', cleaned)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
    cleaned = cleaned.strip('～~，,。. ')
    return cleaned


# ==================== Clause Splitting ====================

# Split on both sentence-ending AND clause-ending punctuation
_CLAUSE_SPLIT_RE = re.compile(
    r'(?<=[。！？…\.!\?\n，,；;—])'
    r'(?=\S)'
)


def split_clauses(text: str, min_len: int = 4) -> list:
    """
    Split text into sub-clauses for streaming TTS.
    Lower min_len (4 vs original 6) for faster first-audio.
    """
    if not text or not text.strip():
        return []
    raw = _CLAUSE_SPLIT_RE.split(text.strip())
    out, buf = [], ""
    for part in raw:
        part = part.strip()
        if not part:
            continue
        buf += part
        if len(buf) >= min_len:
            out.append(buf)
            buf = ""
    if buf:
        if out:
            out[-1] += buf
        else:
            out.append(buf)
    return out


# ==================== Async TTS ====================

# Persistent httpx client for connection reuse
_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _http_client


async def synthesize_async(text: str, ref_id: str) -> bytes:
    """
    Async TTS for a single text segment via Fish Audio.

    Args:
        text: Cleaned text to synthesize (already stripped of actions/emojis)
        ref_id: Fish Audio voice reference ID

    Returns:
        MP3 audio bytes, or empty bytes on failure
    """
    if not text or len(text) < 2:
        return b""

    if not FISH_AUDIO_KEY:
        logger.error("[TTS] FISH_AUDIO_KEY not set")
        return b""

    client = _get_client()

    try:
        resp = await client.post(
            FISH_AUDIO_TTS_URL,
            headers={
                "Authorization": f"Bearer {FISH_AUDIO_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "text": text[:2000],
                "reference_id": ref_id,
                "format": "mp3",
            },
        )

        if resp.status_code != 200:
            logger.error(f"[TTS] Fish Audio error {resp.status_code}: {resp.text[:200]}")
            return b""

        audio = resp.content
        if audio:
            logger.info(f"[TTS] '{text[:30]}' → {len(audio)} bytes")
        return audio

    except httpx.TimeoutException:
        logger.error(f"[TTS] Timeout for: '{text[:30]}'")
        return b""
    except Exception as e:
        logger.error(f"[TTS] Error: {e}")
        return b""


async def warmup(ref_id: str):
    """
    Send a short warmup TTS request to pre-establish connection.
    Call this when voice session starts to reduce first-audio latency.
    """
    try:
        await synthesize_async("你好", ref_id)
        logger.info("[TTS] Warmup complete")
    except Exception as e:
        logger.debug(f"[TTS] Warmup failed (non-critical): {e}")


class StreamingTTSPipeline:
    """
    Manages the streaming TTS pipeline for a voice session.

    Accumulates LLM tokens, detects clause boundaries,
    and fires off TTS requests as soon as clauses are ready.
    Maintains ordering for sequential playback.

    Rate limiting: max 2 concurrent TTS requests to avoid Fish Audio 429.
    """

    def __init__(self, ref_id: str, max_concurrent: int = 1):
        self.ref_id = ref_id
        self._buffer = ""
        self._audio_queue: asyncio.Queue[Tuple[int, str, bytes] | None] = asyncio.Queue()
        self._pending_tasks: list[asyncio.Task] = []
        self._index = 0
        self._results: dict[int, Tuple[str, bytes]] = {}
        self._next_yield_idx = 0
        self._finished_feeding = False
        # Semaphore limits concurrent Fish Audio API calls
        self._tts_semaphore = asyncio.Semaphore(max_concurrent)

    def feed_token(self, token: str):
        """
        Feed an LLM token. If a clause boundary is detected,
        immediately submit TTS for the complete clause.
        """
        self._buffer += token
        clauses = split_clauses(self._buffer)

        if len(clauses) > 1:
            # Complete clauses ready — submit for TTS
            complete = clauses[:-1]
            self._buffer = clauses[-1]

            for clause_text in complete:
                cleaned = clean_text_for_tts(clause_text)
                if cleaned and len(cleaned) >= 2:
                    idx = self._index
                    self._index += 1
                    task = asyncio.create_task(self._tts_and_enqueue(idx, cleaned))
                    self._pending_tasks.append(task)

    async def flush(self):
        """
        Flush remaining buffer (call after LLM stream ends).
        Submits final partial clause for TTS.
        """
        self._finished_feeding = True
        if self._buffer.strip():
            cleaned = clean_text_for_tts(self._buffer.strip())
            if cleaned and len(cleaned) >= 2:
                idx = self._index
                self._index += 1
                task = asyncio.create_task(self._tts_and_enqueue(idx, cleaned))
                self._pending_tasks.append(task)
            self._buffer = ""

        # Wait for all pending TTS to complete
        if self._pending_tasks:
            await asyncio.gather(*self._pending_tasks, return_exceptions=True)
            self._pending_tasks.clear()

        # Signal end
        await self._audio_queue.put(None)

    async def audio_segments(self) -> AsyncIterator[Tuple[str, bytes]]:
        """
        Yield (clause_text, mp3_bytes) in order as TTS completes.
        Maintains ordering even if later clauses finish TTS first.
        """
        while True:
            # Check if next segment is already ready (out-of-order completion)
            if self._next_yield_idx in self._results:
                text, audio = self._results.pop(self._next_yield_idx)
                self._next_yield_idx += 1
                if audio:
                    yield (text, audio)
                continue

            # Wait for next result
            item = await self._audio_queue.get()
            if item is None:
                # Yield any remaining ordered results
                while self._next_yield_idx in self._results:
                    text, audio = self._results.pop(self._next_yield_idx)
                    self._next_yield_idx += 1
                    if audio:
                        yield (text, audio)
                break

            idx, text, audio = item
            if idx == self._next_yield_idx:
                self._next_yield_idx += 1
                if audio:
                    yield (text, audio)
            else:
                # Out of order — store for later
                self._results[idx] = (text, audio)

    async def cancel(self):
        """Cancel all pending TTS tasks (e.g., on user interrupt)."""
        for task in self._pending_tasks:
            if not task.done():
                task.cancel()
        self._pending_tasks.clear()
        # Drain queue
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        await self._audio_queue.put(None)

    async def _tts_and_enqueue(self, idx: int, text: str):
        """TTS a clause and put result in the queue (rate-limited)."""
        try:
            async with self._tts_semaphore:
                audio = await synthesize_async(text, self.ref_id)
            await self._audio_queue.put((idx, text, audio))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[TTS] Clause {idx} error: {e}")
            await self._audio_queue.put((idx, text, b""))
