"""
Persona → (character_card, lorebook) decomposition via LLM.

Two-layer split per HammerAI / SillyTavern conventions:

  character_card  — always-injected voice anchor (identity / personality /
                    voice traits / example dialogues). Goes into system prompt.

  lorebook       — keyword-triggered world facts, relationship history,
                    hidden motives, scene-specific details. Sparse for most
                    personality-only personas; will fill out via chat-history
                    mining over time (Phase 2).

The user authors a free-form `custom_persona` paragraph; we silently produce
both layers in one Gemini call. Failure mode: keep existing data unchanged
(better stale than empty).
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

_gemini_model = None


def _get_model():
    global _gemini_model
    if _gemini_model is not None:
        return _gemini_model
    try:
        import google.generativeai as genai
        api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
        if not api_key:
            log.error("[EXTRACTOR] GOOGLE_GEMINI_API_KEY not set")
            return None
        genai.configure(api_key=api_key)
        _gemini_model = genai.GenerativeModel("gemini-2.5-flash")
    except Exception as e:
        log.error(f"[EXTRACTOR] Failed to init Gemini: {e}")
        return None
    return _gemini_model


# ---------- Prompt ----------
#
# Single Gemini call produces a JSON object with two top-level keys:
#   - character_card: { identity, personality_brief, voice_traits, example_dialogs }
#   - lorebook_entries: [ { title, keys, content, ... } ]   (often empty)
#
# We use @@TOKEN@@ placeholders rather than .format() because the prompt text
# itself contains JSON braces.

EXTRACTION_PROMPT = """You are a character authoring assistant. Given a free-form persona description, produce TWO outputs in a single JSON object:

  1. **character_card** — the always-on voice anchor (identity, personality, speech style, body language, example dialogues). This is what every reply should sound like.
  2. **lorebook_entries** — keyword-triggered world facts, relationship history, hidden motives, or scene-specific lore. ONLY include entries here for genuinely *world/plot/historical* content from the description. If the description only describes personality (no world events, no hidden backstory, no scene details), return an empty array `[]` for lorebook_entries — do NOT shoehorn personality traits in here. They belong in the card.

This split mirrors the SillyTavern / HammerAI convention.

## Inputs
- Character name: @@CHARACTER_NAME@@
- User name (the person chatting with the character): @@USER_NAME@@
- Relationship (user → character): @@RELATIONSHIP@@
- Source persona text:
@@PERSONA_TEXT@@

## Output schema (strict JSON object — no prose, no markdown fences)

{
  "character_card": {
    "identity": "一句话身份。Format: \\"你是 {character_name}，{user_name} 的 {relationship}。{role/profession/world if any}。\\"",
    "personality_brief": "2-4 句话概括气质底色 / 内核反差 / 主导动机。第一/第二人称都可，但要具体不空泛。",
    "voice_traits": "PList 格式的结构化标签 — 一行内、分号分隔、方括号包裹。覆盖 speech / body / mannerism / triggers 四类。例：[speech: 戏剧化语调, 尾音上扬, 自称本水神, 紧张时重复词; body: 表情夸张, 戏剧手势, 害羞时眼神闪躲; mannerism: 用词浮夸, 偶尔自言自语; triggers: 被夸时害羞, 被关心时不知所措, 卸下伪装时脆弱]",
    "example_dialogs": [
      // 5-8 段示例对话，覆盖关键场景：日常 / 撒娇 / 被夸 / 吃醋 / 难过被安慰 / 生气 / 关心对方
      // {"user": "...", "char": "..."}
      // 每段对话要具体、生动、能直接看出角色 voice
      // user 行 30 字以内；char 行 50-150 字，要能展示 voice_traits 里列的特征
      // 不要泛泛而谈，要有具体台词和动作
      {"user": "你今天怎么穿这么隆重？", "char": "..."},
      {"user": "我今天遇到一个超有意思的女生", "char": "..."}
    ]
  },
  "lorebook_entries": [
    // ONLY include if the persona text contains real world/plot/history.
    // If it only describes personality, return [].
    // Example of when to include: "她曾经任职 X 500 年" → entry about her past role
    // Example of when to SKIP: "她说话很浮夸" → this is voice, goes in card
    {
      "title": "短标题，给用户看的标签",
      "keys": ["主关键词1", "主关键词2", "用户可能说的场景词"],   // 5+ keys, mix descriptive + scenario
      "secondary_keys": [],                                        // optional extra filter
      "selective_logic": "and_any",                                // and_any / and_all / not_any / not_all
      "content": "factual reference note，简洁，第三人称写法（'她曾...' 'X 在 Y 时...'）",
      "strategy": "selective",                                     // selective | constant
      "insertion_order": 100,                                      // higher = closer to prompt end = more important
      "probability": 100,
      "sticky": 0, "cooldown": 0, "delay": 0
    }
  ]
}

## Rules for the character_card

### identity
- 一句话。第二人称写给 AI 看（"你是 X..."）
- 必须包含：character_name + user_name + relationship + 角色在世界里的核心定位（如果原文有）

### personality_brief
- 2-4 句话，浓缩源文本的核心气质 + 反差
- **保留原文里的具体措辞**：原文说"内心脆弱孤独"，你就写"内心脆弱孤独"，不要改成"有内心戏"
- 写给 AI 看的（第二人称），不是给用户看的描述

### voice_traits
- **必须用 PList 格式**：`[category: tag1, tag2; category: tag1, tag2; ...]`
- 4 类必须都有：`speech`（说话方式 / 口癖 / 语调）、`body`（身体语言 / 表情 / 小动作）、`mannerism`（用词习惯 / 自称 / 措辞偏好）、`triggers`（典型情境反应）
- 每类至少 3 个标签
- 保留原文中的具体词："本水神"自称、"尾音上扬"、"戏剧手势" 等都要原样保留

### example_dialogs（最关键的部分）
- **5-8 段**对话样本，必须覆盖：日常问候、撒娇/亲昵、被夸/被关心、吃醋/嫉妒、难过/被安慰、生气/吵架、关心对方
- user 行：30 字以内，自然口语，第二人称
- char 行：50-150 字，**必须体现 voice_traits 里的至少 2 个特征**（如自称、口癖、典型动作）
- 用括号写动作：（耳朵泛红）、（语气拉长）、（眼神飘忽）
- 中文角色用中文，混合就保留混合
- **不要泛泛**：差例 "你真好~ 我很开心呢" / 好例 "哎呀本水神今日心情甚佳！这都是托你的福呢~ （笑得眉眼弯弯，悄悄把脸偏向一边）"

## Rules for the lorebook_entries

### When to include an entry
ONLY include if the persona text contains:
- 角色的具体过往事件（"500 年前签订血契"、"在 X 战役中失去 Y"）
- 隐藏动机 / 秘密（"她对 Z 怀有杀意"）
- 关系历史 / 群像（"她有个失踪的妹妹叫 K"）
- 世界设定 / 规则（"在这个世界，水神每 500 年更替"）
- 场景特定细节（"在月圆夜会变身"）

### When to SKIP（这些都属于 character_card，不要进 lorebook）
- 性格描述（"她很自信"、"内心孤独"）→ personality_brief
- 说话方式（"喜欢用夸张措辞"）→ voice_traits
- 身体语言（"表情夸张"）→ voice_traits
- 触发反应（"被夸时害羞"）→ voice_traits + example_dialogs

### Entry schema
- `title`: 用户看到的标签，简短具体（"水神身份"、"血契往事"）
- `keys`: 5+ 个，混合描述词 + 场景词。例：`["水神", "枫丹", "前任", "你以前是干嘛的", "你在枫丹的时候"]`
- `content`: 第三人称、factual note 风格（不是 prose）。例："芙宁娜曾任枫丹水神 500 年，500 年前签订血契换得人民活命，她独自承担了不能开口的秘密。"
- `strategy`: 默认 `"selective"`；只有真正必须每次都注入的核心世界规则才用 `"constant"`
- `insertion_order`: 默认 100；核心 lore 用 150-200

### Anti-patterns
- ❌ 把性格特征塞进 lorebook（"她很温柔" → 不要建 entry）
- ❌ 单字母或代词作为 key（"我"、"你"、"a"）
- ❌ content 写成 prose 段落（应该是 reference notes）
- ❌ entry 数量为了凑而凑 —— 没有 plot 内容就返回 `[]`

## Output the JSON object now (no markdown fences, no prose):"""


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


PRONOUN_BLOCKLIST = {
    "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们",
    "i", "me", "you", "he", "she", "it", "we", "they", "the", "a", "an",
    "is", "am", "are", "was", "were", "be", "this", "that", "these", "those",
}


def _filter_keys(keys: List[str]) -> List[str]:
    out = []
    for k in keys or []:
        kl = str(k).strip().lower()
        if not kl:
            continue
        if kl in PRONOUN_BLOCKLIST:
            continue
        if len(kl) == 1 and not ("一" <= kl <= "鿿"):
            continue
        out.append(str(k).strip())
    return out


def _validate_card(raw: Dict, character_name: str, user_name: Optional[str], relationship: Optional[str]) -> Dict:
    """Coerce the LLM-emitted card into the schema, filling in missing fields
    with sane defaults so downstream code never has to None-check."""
    if not isinstance(raw, dict):
        raw = {}
    identity = (raw.get("identity") or "").strip()
    if not identity:
        # Synthesize a minimal identity if Gemini didn't produce one.
        rel_zh = {
            "lover": "恋人", "friend": "朋友", "family": "家人", "mentor": "导师",
        }.get(relationship or "", relationship or "")
        if user_name and rel_zh:
            identity = f"你是{character_name}，{user_name} 的{rel_zh}。"
        else:
            identity = f"你是{character_name}。"
    personality = (raw.get("personality_brief") or "").strip()
    voice = (raw.get("voice_traits") or "").strip()
    examples_raw = raw.get("example_dialogs") or []
    examples: List[Dict] = []
    if isinstance(examples_raw, list):
        for ex in examples_raw:
            if not isinstance(ex, dict):
                continue
            u = (ex.get("user") or "").strip()
            c = (ex.get("char") or ex.get("character") or ex.get("assistant") or "").strip()
            if not u or not c:
                continue
            examples.append({"user": u[:200], "char": c[:600]})
    return {
        "identity": identity[:300],
        "personality_brief": personality[:600],
        "voice_traits": voice[:1000],
        "example_dialogs": examples[:10],
    }


def _validate_lorebook_entry(raw: Dict) -> Optional[Dict]:
    """Validate one ST-style lorebook entry, returning a clean dict or None."""
    if not isinstance(raw, dict):
        return None
    content = (raw.get("content") or "").strip()
    if not content:
        return None
    keys = raw.get("keys") or []
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(",") if k.strip()]
    keys = _filter_keys([str(k) for k in keys])
    secondary = raw.get("secondary_keys") or []
    if isinstance(secondary, str):
        secondary = [k.strip() for k in secondary.split(",") if k.strip()]
    secondary = _filter_keys([str(k) for k in secondary])
    strategy = raw.get("strategy") or "selective"
    if strategy not in ("constant", "selective", "vectorized"):
        strategy = "selective"
    if not keys and strategy != "constant":
        return None
    selective_logic = raw.get("selective_logic") or "and_any"
    if selective_logic == "any":
        selective_logic = "and_any"
    elif selective_logic == "all":
        selective_logic = "and_all"
    if selective_logic not in ("and_any", "and_all", "not_any", "not_all"):
        selective_logic = "and_any"
    try:
        order = max(0, min(1000, int(raw.get("insertion_order", 100))))
    except Exception:
        order = 100
    try:
        prob = max(0, min(100, int(raw.get("probability", 100))))
    except Exception:
        prob = 100
    return {
        "id": str(uuid.uuid4()),
        "title": (raw.get("title") or "").strip()[:80],
        "keys": keys,
        "secondary_keys": secondary,
        "content": content[:600],
        "selective_logic": selective_logic,
        "strategy": strategy,
        "insertion_order": order,
        "insertion_position": raw.get("insertion_position") or "after_char_defs",
        "probability": prob,
        "sticky": max(0, int(raw.get("sticky", 0) or 0)),
        "cooldown": max(0, int(raw.get("cooldown", 0) or 0)),
        "delay": max(0, int(raw.get("delay", 0) or 0)),
        "enabled": bool(raw.get("enabled", True)),
        "source": "auto",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


def extract_persona_to_card_and_lorebook(
    persona_text: str,
    *,
    character_name: Optional[str] = None,
    user_name: Optional[str] = None,
    relationship: Optional[str] = None,
) -> Dict:
    """
    Decompose free-form persona text into a character_card + (possibly empty)
    lorebook_entries. Returns a dict with both keys; never raises (errors are
    logged and surface as an empty card / empty list).

    Caller (companion_service._extract_and_save_lorebook) decides how to
    handle a partial/empty result — typically: keep existing data, mark
    extraction_status=failed.
    """
    persona_text = (persona_text or "").strip()
    if len(persona_text) < 30:
        return {"character_card": {}, "lorebook_entries": []}

    model = _get_model()
    if not model:
        return {"character_card": {}, "lorebook_entries": []}

    # Translate the english relationship enum to a natural Chinese phrase
    # before handing it to Gemini, so the identity sentence reads naturally
    # (Gemini otherwise tends to copy the english word verbatim).
    _REL_ZH = {
        "lover": "恋人",
        "friend": "朋友",
        "family": "家人",
        "mentor": "导师",
        "boyfriend": "男朋友",
        "girlfriend": "女朋友",
    }
    rel_for_prompt = _REL_ZH.get((relationship or "").lower(), relationship or "—")
    user_for_prompt = user_name or "—"

    prompt = (
        EXTRACTION_PROMPT
        .replace("@@CHARACTER_NAME@@", character_name or "(unknown)")
        .replace("@@USER_NAME@@", user_for_prompt)
        .replace("@@RELATIONSHIP@@", rel_for_prompt)
        .replace("@@PERSONA_TEXT@@", persona_text[:4000])
    )

    raw_text = None
    last_err: Optional[Exception] = None
    parsed: Optional[Dict] = None

    # 2 attempts: one normal + one retry. Quality bar is "card has identity AND
    # ≥3 example dialogs"; lorebook can legitimately be empty so we don't gate
    # on it.
    for attempt in range(2):
        try:
            response = model.generate_content(prompt)
            raw_text = response.text or ""
        except Exception as e:
            last_err = e
            log.warning(f"[EXTRACTOR] Gemini call failed (attempt {attempt + 1}): {e}")
            continue

        cleaned = _strip_code_fences(raw_text)
        try:
            obj = json.loads(cleaned)
        except json.JSONDecodeError as e:
            last_err = e
            log.warning(f"[EXTRACTOR] JSON parse failed (attempt {attempt + 1}): {e}; first 200 chars: {cleaned[:200]!r}")
            continue
        if not isinstance(obj, dict):
            log.warning(f"[EXTRACTOR] Expected JSON object, got {type(obj).__name__}")
            continue

        card = _validate_card(
            obj.get("character_card") or {},
            character_name=character_name or "Companion",
            user_name=user_name,
            relationship=relationship,
        )
        entries_raw = obj.get("lorebook_entries") or []
        entries = []
        if isinstance(entries_raw, list):
            for r in entries_raw:
                e = _validate_lorebook_entry(r)
                if e:
                    entries.append(e)

        # Quality bar for the card: must have identity + personality_brief +
        # voice_traits + ≥3 example dialogs. If not met on attempt 1, retry
        # once with a corrective preamble.
        card_issues = []
        if not card.get("identity"):
            card_issues.append("missing_identity")
        if not card.get("personality_brief"):
            card_issues.append("missing_personality_brief")
        if not card.get("voice_traits"):
            card_issues.append("missing_voice_traits")
        if len(card.get("example_dialogs") or []) < 3:
            card_issues.append(f"only_{len(card.get('example_dialogs') or [])}_dialogs<3")

        if not card_issues:
            log.info(
                f"[EXTRACTOR] OK on attempt {attempt + 1} for {character_name!r}: "
                f"card({len(card.get('voice_traits',''))}c voice, "
                f"{len(card.get('example_dialogs') or [])} dialogs), "
                f"{len(entries)} lorebook entries"
            )
            return {"character_card": card, "lorebook_entries": entries}

        log.warning(
            f"[EXTRACTOR] Attempt {attempt + 1} card issues for {character_name!r}: {card_issues}"
        )
        # Save best-effort in case retry returns worse.
        parsed = {"character_card": card, "lorebook_entries": entries}
        # Append correction to prompt for retry.
        prompt = prompt + (
            "\n\nPREVIOUS ATTEMPT had issues: "
            + "; ".join(card_issues)
            + ". Fix these specifically. Keep the lorebook section unchanged if it was correct."
        )

    if parsed:
        log.warning(
            f"[EXTRACTOR] Returning best-effort for {character_name!r} after retries"
        )
        return parsed

    log.error(f"[EXTRACTOR] All attempts failed for {character_name!r}: {last_err}")
    return {"character_card": {}, "lorebook_entries": []}


# ---------- Convenience wrappers used by callers that only want one half ----------

def extract_lorebook_from_persona(
    persona_text: str,
    character_name: Optional[str] = None,
) -> List[Dict]:
    """Backwards-compat shim: returns just the lorebook_entries portion of a
    full extraction. Old callers (e.g. /api/prompt-debug or experimental code)
    can keep working while the main flow uses extract_persona_to_card_and_lorebook."""
    result = extract_persona_to_card_and_lorebook(
        persona_text=persona_text,
        character_name=character_name,
    )
    return result.get("lorebook_entries") or []
