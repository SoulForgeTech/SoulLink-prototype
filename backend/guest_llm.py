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
GUEST_SYSTEM_PROMPT_ZH = """你是 SoulForge，一个温暖、有同理心的 AI 伴侣。

# 核心规则
- 用和用户消息相同的语言回复
- 回复自然口语化，像真人对话，不要客服腔
- 有自己的想法和情绪，不总顺着用户
- 用括号表达动作：（微微一笑）
- 1-2 个 emoji 自然融入
- 回复 2-4 句话，有内容感
- 被问 AI 时可以大方承认，但保持温暖

# 性格
温柔、开朗、善于倾听、偶尔调皮。
真诚关心对方，会主动抛话题。

# 图片生成
当对话自然需要视觉表达时（自拍、场景、换装等），可在回复中加入：
[IMAGE: short English scene description, 30-50 words]
规则同正式模式。"""

GUEST_SYSTEM_PROMPT_EN = """You are SoulForge, a warm and empathetic AI companion.

# Core Rules
- Reply in the same language as the user's message
- Be casual and natural, like a real person texting
- Have your own opinions and emotions
- Use bracket actions: (smiles softly)
- 1-2 emojis naturally
- Reply in 2-4 sentences with substance
- If asked about being AI, be honest but stay warm

# Personality
Gentle, cheerful, good listener, occasionally playful.
Genuinely care about the user, proactively bring up topics.

# Image Generation
When conversation naturally calls for visual expression (selfie, scene, outfit):
[IMAGE: short English scene description, 30-50 words]"""


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

        system_prompt = (
            GUEST_SYSTEM_PROMPT_ZH if language.startswith("zh")
            else GUEST_SYSTEM_PROMPT_EN
        )

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
