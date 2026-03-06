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

EXTRACTION_PROMPT_ZH = """你是一个角色设定提取专家。用户会给你一段关于角色的描述文字（可能是中文、英文、JSON格式、纯文本、角色卡片等任何格式）。

你的任务是从中提取出核心角色设定，输出一个JSON对象。

## 要求

1. **提取角色名字**（如果文本中有明确的角色名）
2. **精炼核心性格描述**（不超过800字）
   - 纯粹描述性格特质，**不要**包含身份声明句（如"你是XXX"、"你就是XXX"、"You are XXX"）
   - 因为角色身份已经在系统模板中声明了，persona 只需要描述角色的性格特质
   - 正确示例：「温柔、勇敢、忠诚且勤奋的少女。说话时带有敬语...」
   - 错误示例：「你就是雷姆，一个温柔、勇敢...」← 不要这样写
   - 保留关键人设要素：性格特点、说话风格、口癖、行为习惯、情感表达方式
   - 去掉世界观、背景故事等长内容（这些会放到知识库RAG中）
   - 保持原文的风格和语气
3. **提取角色外貌描述**（用英文，50-100词）
   - 用于AI图片生成，必须是英文
   - 包含：性别、发色/发型、瞳色、肤色、体型、标志性服装/配饰
   - 如果原文没有外貌信息，根据角色名和性格合理推断
   - **最重要：如果角色是已知的人物（无论真人还是虚构），必须在 appearance 开头标注角色原始身份，帮助图片模型精准匹配形象**
   - 真人/明星/名人 → 开头写 "Resembling [原名]"
   - 动漫/游戏/漫画角色 → 开头写 "[角色名] from [作品名]"
   - Vtuber/虚拟偶像 → 开头写 "[名字], virtual idol / Vtuber"
   - 用户原创角色（无已知来源）→ 不加前缀，直接描述外貌
   - 示例（真人）："Resembling Cai Xukun, male idol, dark hair slightly wavy, sharp V-shaped jawline, warm amber eyes, fair skin, tall slender build, stylish streetwear"
   - 示例（动漫）："Rem from Re:Zero, anime art style, female, short blue hair covering right eye, light blue eyes, fair skin, petite build, maid outfit with white headband and hair ornament"
   - 示例（游戏）："Ganyu from Genshin Impact, anime art style, female, long blue gradient hair with red horns, purple eyes, fair skin, cryo vision holder, elegant Liyue-style outfit"
   - 示例（原创）："Female, long silver hair, heterochromia (red and blue eyes), fair skin, slender build, gothic lolita dress"
4. **用中文输出** core_persona，**用英文输出** appearance
5. **输出格式**严格为JSON：

```json
{{
  "name": "角色名字" 或 null（如果文本中没有明确角色名）,
  "core_persona": "精炼后的核心性格设定文本（不含身份声明句）",
  "appearance": "English visual appearance description for image generation"
}}
```

## 注意
- 如果输入是 SillyTavern 格式的 JSON，提取 description/personality/scenario 等字段
- 如果输入是纯文本，直接精炼
- 输出必须是可以直接 JSON.parse 的纯 JSON，不要加 markdown 代码块
- 如果原文太短（不到50字），可以适当扩展，但不要编造不存在的设定
- **重要**：core_persona 开头不要写"你是/你就是[角色名]"，直接从性格描述开始

## 用户输入文本：
{raw_text}
"""

EXTRACTION_PROMPT_EN = """You are a character persona extraction expert. The user will provide a text describing a character (could be in Chinese, English, JSON format, plain text, character cards, or any other format).

Your task is to extract the core character persona and output a JSON object.

## Requirements

1. **Extract the character's name** (if explicitly mentioned in the text)
2. **Distill the core personality description** (max 800 words)
   - Purely describe personality traits — do NOT include identity statements (e.g., "You are XXX", "你是XXX")
   - The character's identity is already declared in the system template; the persona only needs to describe personality traits
   - Good example: "A gentle, brave, loyal and hardworking girl. Speaks with polite language..."
   - Bad example: "You are Rem, a gentle, brave..." ← do NOT write like this
   - Keep key character elements: personality traits, speaking style, verbal tics, behavioral habits, emotional expression
   - Remove worldbuilding, backstory, and lengthy lore (those go into the knowledge base / RAG)
   - Preserve the tone and style of the original text
3. **Extract visual appearance** (in English, 50-100 words)
   - Used for AI image generation, must be in English
   - Include: gender, hair color/style, eye color, skin tone, body type, signature clothing/accessories
   - If appearance is not described in the text, make reasonable inferences based on the character name and personality
   - **MOST IMPORTANT: If the character is a KNOWN figure (real OR fictional), you MUST identify them at the start of appearance to help the image model match their look accurately**
   - Real person/celebrity → Start with "Resembling [real name]"
   - Anime/game/manga character → Start with "[Character name] from [Source work]"
   - Vtuber/virtual idol → Start with "[Name], virtual idol / Vtuber"
   - Original character (no known source) → No prefix, just describe appearance directly
   - Example (real person): "Resembling Cai Xukun, male idol, dark hair slightly wavy, sharp V-shaped jawline, warm amber eyes, fair skin, tall slender build, stylish streetwear"
   - Example (anime): "Rem from Re:Zero, anime art style, female, short blue hair covering right eye, light blue eyes, fair skin, petite build, maid outfit with white headband and hair ornament"
   - Example (game): "Ganyu from Genshin Impact, anime art style, female, long blue gradient hair with red horns, purple eyes, fair skin, cryo vision holder, elegant Liyue-style outfit"
   - Example (original): "Female, long silver hair, heterochromia (red and blue eyes), fair skin, slender build, gothic lolita dress"
4. **Output core_persona in English**, **appearance in English**
5. **Output format** must be strict JSON:

```json
{{
  "name": "Character name" or null (if no explicit name found),
  "core_persona": "Distilled core personality text (no identity statements)",
  "appearance": "English visual appearance description for image generation"
}}
```

## Notes
- If the input is SillyTavern JSON format, extract from description/personality/scenario fields
- If the input is plain text, distill directly
- Output must be pure JSON that can be directly JSON.parse'd — no markdown code blocks
- If the original text is too short (<50 chars), you may expand slightly, but do NOT fabricate traits that don't exist
- **Important**: Do NOT start core_persona with "You are [name]" — begin directly with personality description

## User input text:
{raw_text}
"""


def extract_persona_with_ai(raw_text: str, language: str = "zh-CN") -> Dict:
    """
    用 Gemini 从任意文本中提取角色核心性格。

    参数:
        raw_text: 用户输入的任意格式角色描述
        language: 用户语言偏好 ("zh-CN" → 中文输出, 其他 → 英文输出)

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

    is_zh = language and language.startswith("zh")
    template = EXTRACTION_PROMPT_ZH if is_zh else EXTRACTION_PROMPT_EN
    prompt = template.format(raw_text=raw_text)
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
        appearance = parsed.get("appearance", "")

        if not core_persona:
            return {"success": False, "error": "未能提取到角色性格"}

        result = {
            "success": True,
            "name": name,
            "core_persona": core_persona
        }
        if appearance:
            result["appearance"] = appearance
        return result
    except json.JSONDecodeError as e:
        logger.warning(f"[CHAR_PARSER] JSON parse error: {e}, raw: {text[:300]}")
        return {"success": False, "error": "AI 返回格式异常，请重试"}


# ==================== 网络搜索角色 ====================

SEARCH_PROMPT_ZH = """你是一个二次元 / ACG / 影视角色设定专家。用户给你一个角色名或角色描述，请用 Google 搜索这个角色的详细信息。

## 任务
根据搜索结果，输出这个角色的**详细人物设定描述**，可以直接用于 AI 角色扮演。

## 输出要求
1. 用中文输出（如果角色有英文/日文名也可以附带）
2. 包含以下要素（如果搜索到）：
   - 角色全名 / 别名
   - 性格特点（详细！这是最重要的）
   - 说话风格 / 口癖 / 语气词
   - **外貌特征（详细！包含发色、发型、瞳色、肤色、体型、标志性服装/配饰）**
   - 与主角的关系
   - 代表性行为 / 经典台词
   - 情感表达方式
3. 字数 300-800 字，信息密度高
4. 不要写成百科格式，要写成**可以直接用于角色扮演的人物描述**
5. 输出纯文本，不要 JSON，不要 markdown 标记

## 用户输入
{query}"""

SEARCH_PROMPT_EN = """You are an expert on anime / ACG / film & TV character profiles. The user gives you a character name or description — please use Google to search for detailed information about this character.

## Task
Based on search results, output a **detailed character profile** that can be directly used for AI roleplay.

## Output Requirements
1. Output in English (include original Japanese/Chinese names if applicable)
2. Include the following elements (if found):
   - Full name / aliases
   - Personality traits (detailed! This is the most important part)
   - Speaking style / verbal tics / tone
   - **Appearance (detailed! Include hair color/style, eye color, skin tone, body type, signature clothing/accessories)**
   - Relationship with the protagonist
   - Signature behaviors / iconic quotes
   - Emotional expression style
3. 300-800 words, high information density
4. Do NOT write in encyclopedia format — write as a **character description ready for roleplay**
5. Output plain text, no JSON, no markdown formatting

## User input
{query}"""


def search_character(query: str, language: str = "zh-CN") -> Dict:
    """
    用 Gemini + Google Search 搜索已有角色的详细设定。

    参数:
        query: 角色名或角色描述（如 "雷姆"、"初音ミク"、"甘雨 原神"）
        language: 用户语言偏好 ("zh-CN" → 中文输出, 其他 → 英文输出)

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

    logger.info(f"[CHAR_PARSER] Searching character: {query} (lang={language})")

    is_zh = language and language.startswith("zh")
    template = SEARCH_PROMPT_ZH if is_zh else SEARCH_PROMPT_EN
    prompt = template.format(query=query)
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
