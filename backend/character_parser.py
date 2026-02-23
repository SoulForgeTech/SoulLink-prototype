"""
SoulLink Character Parser — 用 Gemini 从任意文本中提取角色核心性格
支持各种格式：SillyTavern JSON、纯文本描述、角色卡片等
支持网络搜索：Gemini + Google Search grounding 搜索已有角色设定
"""

import os
import json
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ==================== Gemini API ====================

_gemini_model = None
_gemini_search_model = None


def _get_gemini_model():
    """延迟初始化 Gemini 模型（复用 memory_engine 的模式）"""
    global _gemini_model
    if _gemini_model is None:
        try:
            import google.generativeai as genai
            api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
            if not api_key:
                logger.error("[CHAR_PARSER] GOOGLE_GEMINI_API_KEY not set")
                return None
            genai.configure(api_key=api_key)
            _gemini_model = genai.GenerativeModel("gemini-2.5-flash")
            logger.info("[CHAR_PARSER] Gemini model initialized")
        except Exception as e:
            logger.error(f"[CHAR_PARSER] Failed to init Gemini: {e}")
            return None
    return _gemini_model


def _get_gemini_search_model():
    """延迟初始化带 Google Search grounding 的 Gemini 模型"""
    global _gemini_search_model
    if _gemini_search_model is None:
        try:
            from google import genai as genai_new
            from google.genai import types
            api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
            if not api_key:
                logger.error("[CHAR_PARSER] GOOGLE_GEMINI_API_KEY not set")
                return None
            client = genai_new.Client(api_key=api_key)
            _gemini_search_model = (client, types)
            logger.info("[CHAR_PARSER] Gemini Search model initialized (google-genai)")
        except ImportError:
            logger.error("[CHAR_PARSER] google-genai package not installed, search unavailable")
            return None
        except Exception as e:
            logger.error(f"[CHAR_PARSER] Failed to init Gemini Search: {e}")
            return None
    return _gemini_search_model


def _call_gemini(prompt: str) -> Optional[str]:
    """调用 Gemini API"""
    model = _get_gemini_model()
    if not model:
        return None
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        logger.warning(f"[CHAR_PARSER] Gemini API error: {e}")
        return None


def _call_gemini_with_search(prompt: str) -> Optional[str]:
    """调用 Gemini API with Google Search grounding"""
    result = _get_gemini_search_model()
    if not result:
        # Fallback: 用普通 Gemini（没有搜索，但至少有 AI 知识）
        logger.warning("[CHAR_PARSER] Search model unavailable, falling back to regular Gemini")
        return _call_gemini(prompt)
    try:
        client, types = result
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            )
        )
        return response.text.strip()
    except Exception as e:
        logger.warning(f"[CHAR_PARSER] Gemini Search API error: {e}")
        # Fallback to regular Gemini
        return _call_gemini(prompt)


# ==================== 角色提取 ====================

EXTRACTION_PROMPT = """你是一个角色设定提取专家。用户会给你一段关于角色的描述文字（可能是中文、英文、JSON格式、纯文本、角色卡片等任何格式）。

你的任务是从中提取出核心角色设定，输出一个JSON对象。

## 要求

1. **提取角色名字**（如果文本中有明确的角色名）
2. **精炼核心性格描述**（不超过800字）
   - 用第二人称（你是…你会…你的性格…）
   - 保留关键人设要素：性格特点、说话风格、口癖、行为习惯、情感表达方式
   - 去掉世界观、背景故事等长内容（这些会放到知识库RAG中）
   - 保持原文的风格和语气
3. **输出格式**严格为JSON：

```json
{{
  "name": "角色名字" 或 null（如果文本中没有明确角色名）,
  "core_persona": "精炼后的核心性格设定文本"
}}
```

## 注意
- 如果输入是 SillyTavern 格式的 JSON，提取 description/personality/scenario 等字段
- 如果输入是纯文本，直接精炼
- 输出必须是可以直接 JSON.parse 的纯 JSON，不要加 markdown 代码块
- core_persona 中可以包含中英文双语内容
- 如果原文太短（不到50字），可以适当扩展，但不要编造不存在的设定

## 用户输入文本：
{raw_text}
"""


def extract_persona_with_ai(raw_text: str) -> Dict:
    """
    用 Gemini 从任意文本中提取角色核心性格。

    参数:
        raw_text: 用户输入的任意格式角色描述

    返回:
        {
            "success": True/False,
            "name": "角色名" | None,
            "core_persona": "精炼的核心性格设定文本"
        }
    """
    if not raw_text or not raw_text.strip():
        return {"success": False, "error": "输入文本为空"}

    raw_text = raw_text.strip()

    # 最小长度检查
    if len(raw_text) < 10:
        return {"success": False, "error": "描述太短，请提供至少 10 个字符的角色描述"}

    # 如果文本太长，截取前 8000 字（Gemini 可以处理更多，但没必要）
    if len(raw_text) > 8000:
        raw_text = raw_text[:8000] + "\n... (文本过长已截断)"

    prompt = EXTRACTION_PROMPT.format(raw_text=raw_text)
    result = _call_gemini(prompt)

    if not result:
        return {"success": False, "error": "AI 解析失败，请重试"}

    # 清理可能的 markdown 包裹
    text = result.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        parsed = json.loads(text)
        name = parsed.get("name")
        core_persona = parsed.get("core_persona", "")

        if not core_persona:
            return {"success": False, "error": "未能提取到角色性格"}

        return {
            "success": True,
            "name": name,
            "core_persona": core_persona
        }
    except json.JSONDecodeError as e:
        logger.warning(f"[CHAR_PARSER] JSON parse error: {e}, raw: {text[:300]}")
        return {"success": False, "error": "AI 返回格式异常，请重试"}


# ==================== 网络搜索角色 ====================

SEARCH_PROMPT = """你是一个二次元 / ACG / 影视角色设定专家。用户给你一个角色名或角色描述，请用 Google 搜索这个角色的详细信息。

## 任务
根据搜索结果，输出这个角色的**详细人物设定描述**，可以直接用于 AI 角色扮演。

## 输出要求
1. 用中文输出（如果角色有英文/日文名也可以附带）
2. 包含以下要素（如果搜索到）：
   - 角色全名 / 别名
   - 性格特点（详细！这是最重要的）
   - 说话风格 / 口癖 / 语气词
   - 外貌特征（简短）
   - 与主角的关系
   - 代表性行为 / 经典台词
   - 情感表达方式
3. 字数 300-800 字，信息密度高
4. 不要写成百科格式，要写成**可以直接用于角色扮演的人物描述**
5. 输出纯文本，不要 JSON，不要 markdown 标记

## 用户输入
{query}"""


def search_character(query: str) -> Dict:
    """
    用 Gemini + Google Search 搜索已有角色的详细设定。

    参数:
        query: 角色名或角色描述（如 "雷姆"、"初音ミク"、"甘雨 原神"）

    返回:
        {
            "success": True/False,
            "description": "搜索到的角色详细描述",
            "query": "原始搜索词"
        }
    """
    if not query or not query.strip():
        return {"success": False, "error": "搜索词为空"}

    query = query.strip()

    if len(query) > 200:
        return {"success": False, "error": "搜索词过长"}

    logger.info(f"[CHAR_PARSER] Searching character: {query}")

    prompt = SEARCH_PROMPT.format(query=query)
    result = _call_gemini_with_search(prompt)

    if not result:
        return {"success": False, "error": "搜索失败，请重试"}

    # 清理结果
    description = result.strip()

    if len(description) < 30:
        return {"success": False, "error": "未找到相关角色信息"}

    logger.info(f"[CHAR_PARSER] Search result length: {len(description)} chars")

    return {
        "success": True,
        "description": description,
        "query": query
    }
