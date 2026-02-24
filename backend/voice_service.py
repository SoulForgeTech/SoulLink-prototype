"""
SoulLink Voice Service - 语音合成 (TTS) 和语音识别 (STT)
使用阿里云 DashScope API (CosyVoice + Paraformer)
"""

import os
import io
import re
import uuid
import json
import logging
import tempfile
import wave
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult

logger = logging.getLogger(__name__)

# Configure DashScope API key
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

# ==================== Voice Configuration ====================

# Default TTS settings
DEFAULT_TTS_MODEL = "cosyvoice-v3-flash"
DEFAULT_TTS_VOICE_FEMALE = "longhua_v3"      # Female, social companion style
DEFAULT_TTS_VOICE_MALE = "longanyang"        # Male, Mandarin/English

# Default ASR settings
DEFAULT_ASR_MODEL = "paraformer-realtime-v2"

# Voice mapping based on companion gender/subtype (cosyvoice-v3-flash compatible voices)
# Each entry: { "voice": voice_name, "rate": speech_rate, "pitch": pitch, "volume": volume }
VOICE_MAP = {
    # Female voices — using v3 compatible voices
    "female_gentle":   {"voice": "longhua_v3",      "rate": 0.9,  "pitch": 1.05, "volume": 55},   # 温柔姐姐 - social companion, warm tone
    "female_cold":     {"voice": "longxiaoxia_v3",  "rate": 0.95, "pitch": 0.95, "volume": 50},   # 高冷御姐 - voice assistant, cool tone
    "female_cute":     {"voice": "longantai_v3",    "rate": 1.05, "pitch": 1.1,  "volume": 60},   # 可爱学妹 - social companion, lively
    "female_cheerful": {"voice": "longanhuan",      "rate": 1.05, "pitch": 1.08, "volume": 60},   # 元气少女 - cheerful energetic girl
    # Male voices — using v3 compatible voices
    "male_ceo":        {"voice": "longze_v3",       "rate": 0.85, "pitch": 0.9,  "volume": 55},   # 霸总 - social companion, deep & authoritative
    "male_warm":       {"voice": "longcheng_v3",    "rate": 0.92, "pitch": 1.0,  "volume": 55},   # 暖男 - social companion, warm
    "male_classmate":  {"voice": "longzhe_v3",      "rate": 1.0,  "pitch": 1.0,  "volume": 50},   # 学长 - social companion
    "male_badboy":     {"voice": "longanyang",      "rate": 1.05, "pitch": 0.95, "volume": 55},   # 坏男孩 - slightly fast, lower pitch
    # Fallbacks
    "female": {"voice": "longhua_v3",    "rate": 0.95, "pitch": 1.0, "volume": 55},
    "male":   {"voice": "longanyang",    "rate": 0.95, "pitch": 1.0, "volume": 55},
}


def get_voice_config(gender: str, subtype: str = None) -> dict:
    """Get the voice config (voice name + prosody params) for the companion."""
    if subtype and subtype in VOICE_MAP:
        return VOICE_MAP[subtype]
    if gender in VOICE_MAP:
        return VOICE_MAP[gender]
    return {"voice": DEFAULT_TTS_VOICE_FEMALE, "rate": 0.95, "pitch": 1.0, "volume": 55}


def get_voice_for_companion(gender: str, subtype: str = None) -> str:
    """Get the best voice name for the companion based on gender and subtype."""
    return get_voice_config(gender, subtype)["voice"]


def extract_voice_style_from_persona(persona: str, gender: str = "female") -> str:
    """
    Analyze persona text using Gemini and return the best matching voice subtype.
    Result should be one of the VOICE_MAP keys (e.g., 'female_gentle', 'male_ceo').
    Cached in user settings as 'voice_style' for subsequent calls.
    """
    if not persona or len(persona.strip()) < 20:
        return f"{gender}_gentle" if gender == "female" else f"{gender}_warm"

    # Build the prompt for Gemini
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
            # Validate it's a known key
            if result in VOICE_MAP:
                logger.info(f"[VOICE] Extracted voice style from persona: {result}")
                return result
            # Try partial match
            for key in VOICE_MAP:
                if key in result or result in key:
                    logger.info(f"[VOICE] Matched voice style: {result} → {key}")
                    return key
        logger.warning(f"[VOICE] Could not parse Gemini result: {result}")
    except Exception as e:
        logger.warning(f"[VOICE] Failed to extract voice style: {e}")

    # Fallback
    return f"{gender}_gentle" if gender == "female" else f"{gender}_warm"


# ==================== TTS (Text-to-Speech) ====================

# Regex patterns to strip action/emotion descriptions from AI text before TTS
# Matches: （轻轻抱抱你）(smiles) *blushes* etc.
_ACTION_PATTERNS = [
    re.compile(r'\uff08[^\uff09]*\uff09'),       # Chinese fullwidth parens （...）
    re.compile(r'\([^)]*\)'),                     # ASCII parens (...)
    re.compile(r'\*[^*]+\*'),                     # Asterisk actions *...*
]
# Emoji cleanup — remove standalone emoji clusters (keep if inside text)
_EMOJI_PATTERN = re.compile(
    r'[\U0001F600-\U0001F64F'   # emoticons
    r'\U0001F300-\U0001F5FF'    # symbols & pictographs
    r'\U0001F680-\U0001F6FF'    # transport & map
    r'\U0001F900-\U0001F9FF'    # supplemental
    r'\U0001FA00-\U0001FA6F'    # chess symbols
    r'\U0001FA70-\U0001FAFF'    # symbols extended
    r'\u2600-\u26FF'            # misc symbols
    r'\u2700-\u27BF'            # dingbats
    r'\uFE00-\uFE0F'           # variation selectors
    r'\u200D'                   # zero width joiner
    r']+',
    flags=re.UNICODE,
)


def _clean_text_for_tts(text: str) -> str:
    """
    Remove action descriptions, emojis, and stage directions from text
    before sending to TTS. Keeps only the spoken dialogue.

    Examples:
        "（轻轻抱抱你）你好呀～" → "你好呀～"
        "(smiles) Hello there! 😊" → "Hello there!"
        "*blushes* 嗯...我也喜欢你" → "嗯...我也喜欢你"
    """
    cleaned = text
    for pattern in _ACTION_PATTERNS:
        cleaned = pattern.sub('', cleaned)
    # Remove emojis
    cleaned = _EMOJI_PATTERN.sub('', cleaned)
    # Clean up leftover whitespace
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
    # Remove leading/trailing punctuation artifacts
    cleaned = cleaned.strip('～~，,。. ')
    return cleaned


def _escape_xml(text: str) -> str:
    """Escape special characters for SSML XML content."""
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    text = text.replace('"', '&quot;')
    text = text.replace("'", '&apos;')
    return text


def _wrap_ssml(text: str, rate: float = 1.0, pitch: float = 1.0, volume: int = 50) -> str:
    """
    Wrap text in SSML <speak> tags with prosody parameters for more natural speech.
    CosyVoice SSML supports rate (0.5-2.0), pitch (0.5-2.0), volume (0-100).
    """
    escaped = _escape_xml(text)
    return f'<speak rate="{rate}" pitch="{pitch}" volume="{volume}">{escaped}</speak>'


def synthesize_speech(
    text: str,
    voice: str = None,
    gender: str = "female",
    subtype: str = None,
    speech_rate: float = None,
    volume: int = None,
) -> bytes:
    """
    Convert text to speech using CosyVoice with character-specific prosody.

    Args:
        text: The text to synthesize (max 2000 chars)
        voice: Specific voice name (overrides gender/subtype)
        gender: Companion gender ('male' or 'female')
        subtype: Companion subtype for voice selection
        speech_rate: Speech rate override (0.5 - 2.0, None = use character default)
        volume: Volume level override (0 - 100, None = use character default)

    Returns:
        Audio bytes in MP3 format
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty")

    # Clean action descriptions and emojis before synthesis
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

    # Get character-specific voice config (voice + prosody params)
    voice_config = get_voice_config(gender, subtype)
    selected_voice = voice or voice_config["voice"]
    final_rate = speech_rate if speech_rate is not None else voice_config.get("rate", 1.0)
    final_pitch = voice_config.get("pitch", 1.0)
    final_volume = volume if volume is not None else voice_config.get("volume", 55)

    logger.info(
        f"[TTS] Synthesizing {len(text)} chars | voice={selected_voice} | "
        f"rate={final_rate} pitch={final_pitch} vol={final_volume} | model={DEFAULT_TTS_MODEL}"
    )

    # Wrap in SSML for natural prosody control
    ssml_text = _wrap_ssml(text, rate=final_rate, pitch=final_pitch, volume=final_volume)

    try:
        synthesizer = SpeechSynthesizer(
            model=DEFAULT_TTS_MODEL,
            voice=selected_voice,
        )

        audio_data = synthesizer.call(ssml_text)

        if not audio_data:
            raise Exception("No audio data returned from TTS service")

        logger.info(f"[TTS] Generated {len(audio_data)} bytes of audio")
        return audio_data

    except Exception as e:
        logger.error(f"[TTS] Synthesis failed: {e}")
        raise


# ==================== STT (Speech-to-Text) ====================

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
                # Keep partial results as fallback
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

    # Save audio to a temporary file (DashScope SDK needs a file path)
    suffix_map = {
        "wav": ".wav",
        "mp3": ".mp3",
        "pcm": ".pcm",
        "aac": ".aac",
        "amr": ".amr",
        "opus": ".opus",
        "m4a": ".m4a",
        "webm": ".webm",
    }
    suffix = suffix_map.get(audio_format, ".wav")

    tmp_file = None
    try:
        tmp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp_file.write(audio_data)
        tmp_file.close()

        file_size = os.path.getsize(tmp_file.name)
        logger.info(f"[STT] Saved temp file: {tmp_file.name}, size={file_size} bytes")

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

        # Try callback sentences first (complete sentences)
        full_text = "".join(callback.sentences)

        # If no complete sentences, use partial text as fallback
        if not full_text and callback.partial_text:
            logger.info(f"[STT] No complete sentences, using partial: {callback.partial_text}")
            full_text = callback.partial_text

        # Also try to extract text from the result object itself
        if not full_text and result:
            try:
                # DashScope result may have output with sentences
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
        # Clean up temp file
        if tmp_file and os.path.exists(tmp_file.name):
            try:
                os.unlink(tmp_file.name)
            except:
                pass


# ==================== Health Check ====================

def check_voice_service_health() -> dict:
    """Check if the voice service is properly configured."""
    api_key = os.getenv("DASHSCOPE_API_KEY")
    return {
        "configured": bool(api_key),
        "api_key_set": bool(api_key),
        "tts_model": DEFAULT_TTS_MODEL,
        "asr_model": DEFAULT_ASR_MODEL,
    }
