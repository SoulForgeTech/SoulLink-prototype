"""
SoulLink Voice Service - 语音合成 (TTS) 和语音识别 (STT)
使用阿里云 DashScope API (CosyVoice + Paraformer)
"""

import os
import io
import uuid
import json
import logging
import tempfile
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult

logger = logging.getLogger(__name__)

# Configure DashScope API key
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

# ==================== Voice Configuration ====================

# Default TTS settings
DEFAULT_TTS_MODEL = "cosyvoice-v3-flash"
DEFAULT_TTS_VOICE_FEMALE = "longanhuan"      # Female, Mandarin/English
DEFAULT_TTS_VOICE_MALE = "longanyang"        # Male, Mandarin/English

# Default ASR settings
DEFAULT_ASR_MODEL = "paraformer-realtime-v2"

# Voice mapping based on companion gender/subtype
VOICE_MAP = {
    # Female voices
    "female_gentle": "longanhuan",        # 温柔姐姐 - gentle female
    "female_cold": "longxiaoxia_v2",      # 高冷御姐 - cool female
    "female_cute": "longxiaomeng_v2",     # 可爱学妹 - cute female
    "female_cheerful": "longlaotie_v2",   # 元气少女 - cheerful female
    # Male voices
    "male_ceo": "longanyang",             # 霸总 - authoritative male
    "male_warm": "longshu_v2",            # 暖男 - warm male
    "male_classmate": "longanyang",       # 学长 - senior male
    "male_badboy": "longanyang",          # 坏男孩 - bad boy male
    # Fallbacks
    "female": "longanhuan",
    "male": "longanyang",
}


def get_voice_for_companion(gender: str, subtype: str = None) -> str:
    """Get the best voice for the companion based on gender and subtype."""
    if subtype and subtype in VOICE_MAP:
        return VOICE_MAP[subtype]
    if gender in VOICE_MAP:
        return VOICE_MAP[gender]
    return DEFAULT_TTS_VOICE_FEMALE


# ==================== TTS (Text-to-Speech) ====================

def synthesize_speech(
    text: str,
    voice: str = None,
    gender: str = "female",
    subtype: str = None,
    speech_rate: float = 1.0,
    volume: int = 50,
) -> bytes:
    """
    Convert text to speech using CosyVoice.

    Args:
        text: The text to synthesize (max 20,000 chars)
        voice: Specific voice name (overrides gender/subtype)
        gender: Companion gender ('male' or 'female')
        subtype: Companion subtype for voice selection
        speech_rate: Speech rate (0.5 - 2.0, default 1.0)
        volume: Volume level (0 - 100, default 50)

    Returns:
        Audio bytes in MP3 format
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty")

    # Truncate very long text
    if len(text) > 2000:
        text = text[:2000]
        logger.warning("Text truncated to 2000 characters for TTS")

    # Determine voice
    selected_voice = voice or get_voice_for_companion(gender, subtype)

    logger.info(f"[TTS] Synthesizing {len(text)} chars with voice={selected_voice}, model={DEFAULT_TTS_MODEL}")

    try:
        synthesizer = SpeechSynthesizer(
            model=DEFAULT_TTS_MODEL,
            voice=selected_voice,
        )

        audio_data = synthesizer.call(text)

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
        self.error = None

    def on_event(self, result: RecognitionResult):
        sentence = result.get_sentence()
        if sentence and sentence.get("text"):
            if result.is_sentence_end():
                self.sentences.append(sentence["text"])

    def on_error(self, error):
        self.error = str(error)
        logger.error(f"[STT] Recognition error: {error}")

    def on_complete(self):
        logger.info(f"[STT] Recognition complete, {len(self.sentences)} sentences")


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

        callback = STTCallback()

        recognition = Recognition(
            model=DEFAULT_ASR_MODEL,
            format=audio_format,
            sample_rate=sample_rate,
            language_hints=["zh", "en"],
            callback=callback,
        )

        result = recognition.call(tmp_file.name)

        if callback.error:
            raise Exception(f"STT error: {callback.error}")

        # Combine all recognized sentences
        full_text = "".join(callback.sentences)

        if not full_text:
            logger.warning("[STT] No text recognized from audio")
            return ""

        logger.info(f"[STT] Recognized: {full_text[:100]}...")
        return full_text

    except Exception as e:
        logger.error(f"[STT] Recognition failed: {e}")
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
