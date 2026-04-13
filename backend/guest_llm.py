"""
Guest LLM — direct Gemini streaming for anonymous users.

No AnythingLLM workspace, no Mem0, no RAG.
Conversation history sent with each request acts as "memory".
"""

import os
import logging
from typing import Iterator

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GOOGLE_GEMINI_API_KEY", "")

# Fixed system prompt for guest mode — a warm, generic companion
GUEST_SYSTEM_PROMPT = None  # Loaded lazily from template file


def _load_guest_prompt() -> str:
    """Load guest system prompt from the standard template, with Abigail as default."""
    global GUEST_SYSTEM_PROMPT
    if GUEST_SYSTEM_PROMPT:
        return GUEST_SYSTEM_PROMPT

    import os
    template_path = os.path.join(os.path.dirname(__file__), "system_prompt_template.txt")
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            template = f.read()
    except Exception:
        # Fallback minimal prompt
        return "You are Abigail, a warm AI companion girlfriend. Reply naturally."

    # Replace placeholders with guest defaults
    prompt = template.replace("{{companion_name}}", "Abigail")
    prompt = prompt.replace("{{user_name}}", "你")
    prompt = prompt.replace("{{language}}", "zh-CN")
    prompt = prompt.replace("{{current_model}}", "Gemini")
    prompt = prompt.replace("{{persona}}", "温柔、开朗、善于倾听、偶尔调皮。真诚关心对方，会主动抛话题。有自己的小脾气和想法。\nGentle, cheerful, good listener, occasionally playful. Genuinely cares, proactively brings up topics.")
    prompt = prompt.replace("{{memory}}", "")

    # 游客模式调整：伴侣而非恋人（更通用）
    prompt = prompt.replace("的女朋友", "的 AI 伴侣")
    prompt = prompt.replace("'s girlfriend", "'s AI companion")
    prompt = prompt.replace("你是恋人角色，亲密接触是这段关系中自然的一部分。", "你是伴侣角色，温暖陪伴是这段关系的核心。")
    prompt = prompt.replace("You are in a romantic role — physical intimacy is a natural part of this relationship.", "You are a companion — warmth and emotional support are the core of this relationship.")

    # 图片生成默认动漫风格
    prompt += "\n\n# Guest Image Style\n图片生成时默认使用动漫/二次元风格。在 [IMAGE:] 描述开头加入 'anime art style'。\nWhen generating images, default to anime/2D art style. Start [IMAGE:] descriptions with 'anime art style'."

    GUEST_SYSTEM_PROMPT = prompt
    logger.info(f"[GUEST-LLM] Loaded guest system prompt ({len(prompt)} chars)")
    return prompt


def stream_guest_chat(
    messages: list,
    language: str = "zh-CN",
    model: str = "gemini-2.5-flash",
) -> Iterator[str]:
    """
    Stream tokens from Gemini directly for guest users.

    Args:
        messages: Full conversation history [{role, content}, ...]
        language: User language preference
        model: Gemini model to use (fast, no reasoning)

    Yields:
        Text tokens as they arrive
    """
    try:
        from google import genai

        client = genai.Client(api_key=GEMINI_API_KEY)

        system_prompt = _load_guest_prompt()

        # Convert messages to Gemini format
        contents = []
        for msg in messages:
            role = "user" if msg.get("role") == "user" else "model"
            content = msg.get("content", "")
            if content:
                contents.append({"role": role, "parts": [{"text": content}]})

        if not contents:
            yield "你好呀~ 有什么想聊的？"
            return

        logger.info(
            f"[GUEST-LLM] Streaming: model={model}, "
            f"history={len(contents)} msgs, lang={language}"
        )

        response = client.models.generate_content_stream(
            model=model,
            contents=contents,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.85,
                "max_output_tokens": 500,
            },
        )

        for chunk in response:
            if chunk.text:
                yield chunk.text

    except Exception as e:
        logger.error(f"[GUEST-LLM] Error: {e}", exc_info=True)
        yield "抱歉，遇到了一点问题，请再试一次~"
