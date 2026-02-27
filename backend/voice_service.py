"""
SoulLink Voice Service - TTS (Fish Audio) + STT (DashScope Paraformer)
TTS: Fish Audio S1 模型，支持 200万+ 社区音色 + 搜索
STT: 阿里云 DashScope Paraformer（不变）
"""

import os
import io
import re
import uuid
import json
import logging
import tempfile
import wave
import requests
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult

logger = logging.getLogger(__name__)

# Configure DashScope API key (for STT only)
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

# ==================== Fish Audio TTS Configuration ====================

FISH_AUDIO_KEY = os.getenv("FISH_AUDIO_KEY", "")
FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts"
FISH_AUDIO_MODEL_URL = "https://api.fish.audio/model"
FISH_AUDIO_MODEL = "s1"

# Default ASR settings (unchanged)
DEFAULT_ASR_MODEL = "paraformer-realtime-v2"

# Preset voice map — split by language, curated from Fish Audio top voices
# Each voice: { ref_id, name_zh, name_en, gender }
VOICE_MAP_ZH = {
    "female_gentle":   {"ref_id": "fbe02f8306fc4d3d915e9871722a39d5", "name_zh": "温柔姐姐",   "name_en": "Gentle Girl",   "gender": "female"},   # 嘉岚3.0 - soft, smooth, gentle
    "female_cold":     {"ref_id": "4f201abba2574feeae11e5ebf737859e", "name_zh": "高冷御姐",   "name_en": "Cool Queen",    "gender": "female"},   # 王琨 - clear, crisp, professional
    "female_cute":     {"ref_id": "e488ebeadd83496b97a3cd472dcd04ab", "name_zh": "可爱学妹",   "name_en": "Cute Girl",     "gender": "female"},   # 爱丽丝(中配) - bright, playful
    "female_cheerful": {"ref_id": "5c353fdb312f4888836a9a5680099ef0", "name_zh": "元气少女",   "name_en": "Cheerful Girl", "gender": "female"},   # 女大学生 - energetic, cheerful
    "male_ceo":        {"ref_id": "dd43b30d04d9446a94ebe41f301229b5", "name_zh": "霸总",       "name_en": "Authoritative", "gender": "male"},     # 宣传片 - deep, authoritative, warm
    "male_warm":       {"ref_id": "332941d1360c48949f1b4e0cabf912cd", "name_zh": "暖男",       "name_en": "Warm Guy",      "gender": "male"},     # 丁真(锐刻五代) - warm, gentle
    "male_classmate":  {"ref_id": "e80ea225770f42f79d50aa98be3cedfc", "name_zh": "阳光男生",   "name_en": "Sunny Boy",     "gender": "male"},     # 孙笑川 - relaxed, friendly, smooth
    "male_badboy":     {"ref_id": "f7561ff309bd4040a59f1e600f4f4338", "name_zh": "酷男孩",     "name_en": "Cool Boy",      "gender": "male"},     # 黑手 - authoritative, serious, dramatic
}

VOICE_MAP_EN = {
    "female_gentle":   {"ref_id": "8ef4a238714b45718ce04243307c57a7", "name_zh": "温柔女声",   "name_en": "Gentle Girl",    "gender": "female"},   # E-girl intimate - soft, gentle, warm
    "female_cold":     {"ref_id": "5ac6fb7171ba419190700620738209d8", "name_zh": "冷酷女王",   "name_en": "Raiden Shogun",  "gender": "female"},   # Raiden Shogun - authoritative, regal
    "female_cute":     {"ref_id": "9fad12dc142b429d9396190b0197adb8", "name_zh": "软萌女孩",   "name_en": "Soft E-Girl",    "gender": "female"},   # E-Girl soft - playful, kawaii
    "female_cheerful": {"ref_id": "59e9dc1cb20c452584788a2690c80970", "name_zh": "活力女孩",   "name_en": "ALLE",           "gender": "female"},   # ALLE - energetic, bright, enthusiastic
    "male_ceo":        {"ref_id": "03397b4c4be74759b72533b663fbd001", "name_zh": "权威男声",   "name_en": "Elon Musk",      "gender": "male"},     # Elon Musk - calm, professional
    "male_warm":       {"ref_id": "728f6ff2240d49308e8137ffe66008e2", "name_zh": "温暖男声",   "name_en": "Adam",           "gender": "male"},     # Adam - friendly, warm
    "male_classmate":  {"ref_id": "802e3bc2b27e49c2995d23ef70e6ac89", "name_zh": "阳光男生",   "name_en": "Energetic Male", "gender": "male"},     # Energetic Male - enthusiastic, clear
    "male_badboy":     {"ref_id": "8bed0e9b444046e2bf72da4b251d9a1d", "name_zh": "叙事男声",   "name_en": "Marcus",         "gender": "male"},     # Marcus - deep, smooth, calm
}

# Unified map for subtype key lookup (defaults to zh)
VOICE_MAP = VOICE_MAP_ZH


def _get_voice_map(language: str = "zh") -> dict:
    """Get the voice map for the given language."""
    if language and language.startswith("en"):
        return VOICE_MAP_EN
    return VOICE_MAP_ZH


def get_voice_ref_id(gender: str, subtype: str = None, language: str = "zh") -> str:
    """Get the Fish Audio reference_id for the companion."""
    vmap = _get_voice_map(language)
    if subtype and subtype in vmap:
        return vmap[subtype]["ref_id"]
    fallback_key = f"{gender}_gentle" if gender == "female" else f"{gender}_warm"
    if fallback_key in vmap:
        return vmap[fallback_key]["ref_id"]
    return VOICE_MAP_ZH["female_gentle"]["ref_id"]


def extract_voice_style_from_persona(persona: str, gender: str = "female") -> str:
    """
    Analyze persona text using Gemini and return the best matching voice subtype.
    Result should be one of the VOICE_MAP keys (e.g., 'female_gentle', 'male_ceo').
    Cached in user settings as 'voice_style' for subsequent calls.
    """
    if not persona or len(persona.strip()) < 20:
        return f"{gender}_gentle" if gender == "female" else f"{gender}_warm"

    female_types = "female_gentle(温柔姐姐), female_cold(高冷御姐), female_cute(可爱学妹), female_cheerful(元气少女)"
    male_types = "male_ceo(霸总), male_warm(暖男), male_classmate(学长), male_badboy(坏男孩)"
    type_options = female_types if gender == "female" else male_types

    prompt = f"""Analyze this character persona and determine which voice style best matches.
Choose exactly ONE from these options: {type_options}

Character persona:
{persona[:1500]}

Reply with ONLY the type key (e.g., female_gentle or male_warm). No explanation."""

    try:
        from memory_engine import _call_gemini
        result = _call_gemini(prompt)
        if result:
            result = result.strip().lower().replace(" ", "_")
            if result in VOICE_MAP:
                logger.info(f"[VOICE] Extracted voice style from persona: {result}")
                return result
            for key in VOICE_MAP:
                if key in result or result in key:
                    logger.info(f"[VOICE] Matched voice style: {result} → {key}")
                    return key
        logger.warning(f"[VOICE] Could not parse Gemini result: {result}")
    except Exception as e:
        logger.warning(f"[VOICE] Failed to extract voice style: {e}")

    return f"{gender}_gentle" if gender == "female" else f"{gender}_warm"


# ==================== TTS (Text-to-Speech) via Fish Audio ====================

# Regex patterns to strip action/emotion descriptions from AI text before TTS
_ACTION_PATTERNS = [
    re.compile(r'\uff08[^\uff09]*\uff09'),       # Chinese fullwidth parens （...）
    re.compile(r'\([^)]*\)'),                     # ASCII parens (...)
    re.compile(r'\*[^*]+\*'),                     # Asterisk actions *...*
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
    r'\u200D'
    r']+',
    flags=re.UNICODE,
)


def _clean_text_for_tts(text: str) -> str:
    """Remove action descriptions, emojis, and stage directions from text before TTS."""
    cleaned = text
    for pattern in _ACTION_PATTERNS:
        cleaned = pattern.sub('', cleaned)
    cleaned = _EMOJI_PATTERN.sub('', cleaned)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
    cleaned = cleaned.strip('～~，,。. ')
    return cleaned


def synthesize_speech(
    text: str,
    voice_id: str = None,
    gender: str = "female",
    subtype: str = None,
    language: str = "zh",
    **kwargs,
) -> bytes:
    """
    Convert text to speech using Fish Audio S1.

    Args:
        text: The text to synthesize
        voice_id: Fish Audio reference_id (overrides gender/subtype)
        gender: Companion gender ('male' or 'female')
        subtype: Companion subtype for default voice selection
        language: 'zh' or 'en' — selects language-appropriate default voice

    Returns:
        Audio bytes in MP3 format
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty")

    if not FISH_AUDIO_KEY:
        raise ValueError("Fish Audio API key not configured (FISH_AUDIO_KEY)")

    # Clean action descriptions and emojis
    original_text = text
    text = _clean_text_for_tts(text)
    if text != original_text:
        logger.info(f"[TTS] Cleaned text: '{original_text[:80]}' → '{text[:80]}'")

    if not text:
        raise ValueError("Text is empty after cleaning action descriptions")

    # Truncate very long text
    if len(text) > 2000:
        text = text[:2000]
        logger.warning("Text truncated to 2000 characters for TTS")

    # Determine reference_id: user-selected voice_id > subtype default > gender default
    ref_id = voice_id or get_voice_ref_id(gender, subtype, language)

    logger.info(f"[TTS] Fish Audio | {len(text)} chars | ref_id={ref_id} | model={FISH_AUDIO_MODEL}")

    try:
        resp = requests.post(
            FISH_AUDIO_TTS_URL,
            headers={
                "Authorization": f"Bearer {FISH_AUDIO_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "reference_id": ref_id,
                "format": "mp3",
            },
            timeout=30,
            stream=True,
        )

        if resp.status_code != 200:
            error_text = resp.text[:500]
            logger.error(f"[TTS] Fish Audio API error {resp.status_code}: {error_text}")
            raise Exception(f"Fish Audio TTS failed ({resp.status_code}): {error_text}")

        # Read streaming response
        audio_chunks = []
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                audio_chunks.append(chunk)

        audio_data = b"".join(audio_chunks)

        if not audio_data:
            raise Exception("No audio data returned from Fish Audio")

        logger.info(f"[TTS] Generated {len(audio_data)} bytes of audio")
        return audio_data

    except requests.exceptions.Timeout:
        logger.error("[TTS] Fish Audio request timed out")
        raise Exception("TTS request timed out")
    except requests.exceptions.RequestException as e:
        logger.error(f"[TTS] Fish Audio request failed: {e}")
        raise


# ==================== Voice Search (Fish Audio Community) ====================

def search_voices(query: str = "", language: str = None, page: int = 1, page_size: int = 20) -> dict:
    """
    Search Fish Audio community voices.

    Args:
        query: Search text (voice name/description)
        language: Language filter (e.g., 'zh', 'en', 'ja')
        page: Page number (1-based)
        page_size: Results per page (max 50)

    Returns:
        { "total": int, "voices": [{ "id", "name", "description", "cover_image", "languages", "tags", "author" }] }
    """
    if not FISH_AUDIO_KEY:
        raise ValueError("Fish Audio API key not configured")

    params = {
        "page_size": min(page_size, 50),
        "page_number": page,
        "sort_by": "task_count",
    }
    if query:
        params["title"] = query
    if language:
        params["language"] = language

    try:
        resp = requests.get(
            FISH_AUDIO_MODEL_URL,
            headers={"Authorization": f"Bearer {FISH_AUDIO_KEY}"},
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        voices = []
        for item in data.get("items", []):
            voices.append({
                "id": item.get("_id", ""),
                "name": item.get("title", ""),
                "description": (item.get("description") or "")[:200],
                "cover_image": item.get("cover_image", ""),
                "languages": item.get("languages", []),
                "tags": item.get("tags", []),
                "author": item.get("author", {}).get("nickname", ""),
                "task_count": item.get("task_count", 0),
            })

        return {"total": data.get("total", 0), "voices": voices}

    except Exception as e:
        logger.error(f"[VOICE] Search failed: {e}")
        raise


def list_preset_voices(language: str = "zh") -> list:
    """Return the list of preset voices for the voice selector, based on language."""
    vmap = _get_voice_map(language)
    is_zh = not (language and language.startswith("en"))
    presets = []
    for key, v in vmap.items():
        presets.append({
            "id": v["ref_id"],
            "name": v["name_zh"] if is_zh else v["name_en"],
            "gender": v["gender"],
            "type": key,
            "is_preset": True,
        })
    return presets


# ==================== STT (Speech-to-Text) — unchanged ====================

class STTCallback(RecognitionCallback):
    """Callback for collecting ASR results."""

    def __init__(self):
        self.sentences = []
        self.partial_text = ""
        self.error = None
        self.all_events = []

    def on_event(self, result: RecognitionResult):
        sentence = result.get_sentence()
        is_end = result.is_sentence_end()
        logger.info(f"[STT] on_event: sentence={sentence}, is_sentence_end={is_end}")
        self.all_events.append({"sentence": sentence, "is_end": is_end})

        if sentence and sentence.get("text"):
            if is_end:
                self.sentences.append(sentence["text"])
            else:
                self.partial_text = sentence["text"]

    def on_error(self, error):
        self.error = str(error)
        logger.error(f"[STT] Recognition error: {error}")

    def on_complete(self):
        logger.info(
            f"[STT] Recognition complete: {len(self.sentences)} sentences, "
            f"partial='{self.partial_text}', events={len(self.all_events)}"
        )


def recognize_speech(
    audio_data: bytes,
    audio_format: str = "wav",
    sample_rate: int = 16000,
) -> str:
    """
    Convert speech to text using Paraformer.

    Args:
        audio_data: Audio bytes
        audio_format: Audio format ('wav', 'mp3', 'pcm', 'aac', 'amr', 'opus')
        sample_rate: Audio sample rate in Hz

    Returns:
        Recognized text string
    """
    if not audio_data:
        raise ValueError("Audio data cannot be empty")

    logger.info(f"[STT] Recognizing {len(audio_data)} bytes, format={audio_format}, rate={sample_rate}")

    suffix_map = {
        "wav": ".wav", "mp3": ".mp3", "pcm": ".pcm",
        "aac": ".aac", "amr": ".amr", "opus": ".opus",
        "m4a": ".m4a", "webm": ".webm",
    }
    suffix = suffix_map.get(audio_format, ".wav")

    tmp_file = None
    wav_file = None
    try:
        tmp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp_file.write(audio_data)
        tmp_file.close()

        file_size = os.path.getsize(tmp_file.name)
        logger.info(f"[STT] Saved temp file: {tmp_file.name}, size={file_size} bytes")

        # Convert unsupported formats (webm, m4a) to wav using ffmpeg
        if audio_format in ("webm", "m4a"):
            import subprocess
            wav_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            wav_file.close()
            try:
                cmd = [
                    "ffmpeg", "-y", "-i", tmp_file.name,
                    "-ar", "16000", "-ac", "1", "-f", "wav", wav_file.name
                ]
                result = subprocess.run(cmd, capture_output=True, timeout=15)
                if result.returncode == 0 and os.path.getsize(wav_file.name) > 100:
                    logger.info(f"[STT] Converted {audio_format} → wav ({os.path.getsize(wav_file.name)} bytes)")
                    os.unlink(tmp_file.name)
                    tmp_file.name = wav_file.name
                    wav_file = None
                    audio_format = "wav"
                    suffix = ".wav"
                else:
                    logger.warning(f"[STT] ffmpeg conversion failed: {result.stderr.decode()[:200]}")
            except Exception as conv_err:
                logger.warning(f"[STT] Audio conversion failed: {conv_err}")

        # Auto-detect sample rate from WAV file header
        actual_sample_rate = sample_rate
        if audio_format == "wav":
            try:
                with wave.open(tmp_file.name, "rb") as wf:
                    actual_sample_rate = wf.getframerate()
                    channels = wf.getnchannels()
                    sampwidth = wf.getsampwidth()
                    nframes = wf.getnframes()
                    logger.info(
                        f"[STT] WAV info: rate={actual_sample_rate}, channels={channels}, "
                        f"sampwidth={sampwidth}, frames={nframes}, "
                        f"duration={nframes/actual_sample_rate:.2f}s"
                    )
            except Exception as wav_err:
                logger.warning(f"[STT] Could not read WAV header: {wav_err}, using default rate={sample_rate}")

        logger.info(f"[STT] Using sample_rate={actual_sample_rate} (requested={sample_rate})")

        callback = STTCallback()

        recognition = Recognition(
            model=DEFAULT_ASR_MODEL,
            format=audio_format,
            sample_rate=actual_sample_rate,
            language_hints=["zh", "en"],
            callback=callback,
        )

        result = recognition.call(tmp_file.name)
        logger.info(f"[STT] recognition.call() returned: {result}")

        if callback.error:
            raise Exception(f"STT error: {callback.error}")

        full_text = "".join(callback.sentences)

        if not full_text and callback.partial_text:
            logger.info(f"[STT] No complete sentences, using partial: {callback.partial_text}")
            full_text = callback.partial_text

        if not full_text and result:
            try:
                if hasattr(result, 'output'):
                    output = result.output
                    logger.info(f"[STT] result.output: {output}")
                    if isinstance(output, dict):
                        if output.get('text'):
                            full_text = output['text']
                        elif output.get('sentence'):
                            sentences = output['sentence']
                            full_text = ''.join([s.get('text', '') for s in sentences if s.get('text')])
                elif isinstance(result, dict):
                    if result.get('text'):
                        full_text = result['text']
                    elif result.get('output', {}).get('text'):
                        full_text = result['output']['text']
            except Exception as parse_err:
                logger.warning(f"[STT] Could not parse result object: {parse_err}")

        if not full_text:
            logger.warning(
                f"[STT] No text recognized. callback.sentences={callback.sentences}, "
                f"partial={callback.partial_text}, events={callback.all_events}"
            )
            return ""

        logger.info(f"[STT] Recognized: {full_text[:200]}")
        return full_text

    except Exception as e:
        logger.error(f"[STT] Recognition failed: {e}", exc_info=True)
        raise
    finally:
        for f in [tmp_file, wav_file]:
            if f and hasattr(f, 'name') and os.path.exists(f.name):
                try:
                    os.unlink(f.name)
                except:
                    pass


# ==================== Health Check ====================

def check_voice_service_health() -> dict:
    """Check if the voice service is properly configured."""
    dashscope_key = os.getenv("DASHSCOPE_API_KEY")
    return {
        "configured": bool(FISH_AUDIO_KEY),
        "fish_audio_key_set": bool(FISH_AUDIO_KEY),
        "dashscope_key_set": bool(dashscope_key),
        "tts_provider": "fish_audio",
        "tts_model": FISH_AUDIO_MODEL,
        "asr_model": DEFAULT_ASR_MODEL,
    }
