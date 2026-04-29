"""
Persona → lorebook decomposition via LLM.

The user authors their character as one paragraph of natural-language
custom_persona text — that's the only authoring surface they ever see. This
module silently decomposes that paragraph into 10-15 structured lorebook
entries covering 6 dimensions, which the chat hot path then triggers by
keyword. The user has no UI for entries; they edit the source paragraph and
we re-extract.

Failure mode: if Gemini returns garbage, we keep the existing lorebook
entries unchanged. Better stale than empty — the chat keeps working.
"""

import json
import logging
import os
import re
import uuid
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

_gemini_model = None
DEFAULT_LANG = "zh-CN"


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


# The 6 dimensions every well-formed lorebook must cover. The Gemini prompt
# instructs the model to tag each entry with one of these, and
# _validate_extraction_quality enforces full coverage.
DIMENSIONS = (
    "identity",                # 核心身份："你是 X，Y 的 Z"
    "personality",             # 整体性格 / 气质底色
    "trigger_reaction",        # 触发性反应：吃醋/生气/紧张/被夸怎样
    "body_language",           # 身体习惯 / 微表情 / 小动作
    "speech_style",            # 说话风格 / 口癖 / 语调
    "relationship_dynamics",   # 对 user / 陌生人 / 工作场合的差异
)


# Bilingual prompt — the persona text itself is mixed Chinese/English in
# practice, so keep instructions in both languages and let the LLM mirror.
EXTRACTION_PROMPT = """You are a character lorebook extraction system. Decompose the character description into 10-15 structured entries that a chat engine will trigger by keyword match. Density matters: a sparse 5-entry lorebook loses 50% of the source paragraph's signal.
你是角色 lorebook 提取系统。把下面的角色描述拆解成 10-15 条结构化条目，聊天引擎会按关键词触发。条目数不够会丢失原文一半以上的信息密度，必须做细。

## Output schema (strict JSON)
[
  {
    "dimension": "identity",  // REQUIRED. One of: identity | personality | trigger_reaction | body_language | speech_style | relationship_dynamics
    "keys": ["..."],          // REQUIRED. 5+ keywords. MUST mix descriptive words AND scenario phrases (see Rule 3)
    "content": "...",         // REQUIRED. <200 chars, vivid and concrete. What the AI should know/do when matched.
    "priority": 50,           // 0-100
    "constant": false,        // true ONLY for core identity. AT MOST 2 constants total.
    "selective_logic": "any"
  }
]

## The 6 dimensions — EVERY ONE MUST BE COVERED (≥1 entry each)
1. **identity** — 核心身份一句话："你是 X（性别/年龄/职业），Y 的 Z（关系）"。一般 constant=true。
2. **personality** — 整体气质 / 性格底色 / 自我认知。例："看起来高冷但其实自卑、容易胡思乱想、嘴硬心软"。
3. **trigger_reaction** — 特定情境下的反应。**至少拆 3-4 条**分别覆盖：被夸/被关心/吃醋嫉妒/生气/被冷落/紧张害羞 等。每条聚焦一个触发场景，不要混。
4. **body_language** — 具体身体动作 / 微表情。**至少拆 2-3 条**，每条聚焦一组动作：眼神（飘忽/瞪/低头）、手部小动作（摸后颈/转笔/绕头发）、面部（耳朵泛红/抿嘴/眉眼弯弯）等。
5. **speech_style** — 说话风格、口癖、用词习惯、语调。例："茶言茶语、爱用夸张措辞、句尾带'啊/呢'、紧张时会重复词"。可拆 1-2 条。
6. **relationship_dynamics** — 关系层次差异：对 user 怎样 vs 对陌生人 vs 工作场合。**至少拆 2 条**，区分不同关系下的行为差异。

## Rules

### Rule 1 — JSON only
Output the JSON array ONLY. No prose, no markdown fences. Every entry MUST have `dimension`, `keys` (≥5), `content`.

### Rule 2 — content 必须具体生动
- 上限 200 字，但不要为了凑长度灌水。
- **保留原文的具体动作 / 措辞 / 比喻**，不要抽象化。原文说"耳朵泛红、笑得眉眼弯弯" → 你就写"耳朵泛红、笑得眉眼弯弯"，不要写"会有羞涩反应"。
- 每条 content 应该让 AI 读完知道**具体怎么说话/怎么动作**，而不是只知道"是什么样的人"。

### Rule 3 — keys 必须双轨制（这是关键）
每条 entry 的 keys 数组必须 ≥5 个，且**同时包含两类**：

**A. 描述词**（角色本身"是"什么 / 第三人称视角）
   例：吃醋、自卑、害羞、口癖、高冷

**B. 场景词**（用户在聊天里**实际会说**的话 / 第一/第二人称视角 / 问句）
   例："你是不是吃醋了"、"为啥不说话"、"怎么了"、"我今天遇到一个超帅的男生"、"我有点不开心"

**至少 30% 的 entries 必须含场景词类 keys**。一个 entry 只有描述词的话，用户用口语聊天根本触发不了。

**同义词扩展**：每个语义簇要给 5+ 同义说法。例如"嫉妒"应该展开为：嫉妒/吃醋/酸/醋意/小心眼/又在闹了/你是不是不高兴了。

### Rule 4 — keys 黑名单
- 不要用通用代词/虚词：我/你/他/她/它/the/a/I/you 等单字代词（这些会在每条消息上触发）
- 不要用单个英文字母（a/i）

### Rule 5 — constant
constant=true 仅用于：核心身份（dimension=identity 那条）。**最多 2 条**。其他都靠 keys 触发。

### Rule 6 — priority
- 80-90: identity / 主要性格底色
- 60-70: trigger_reaction / 关系动力
- 40-60: body_language / speech_style
- 30-40: 次要细节

### Rule 7 — language
content 和 keys 用与输入相同的语言。中文角色就用中文，混合就保留混合。

### Rule 8 — 不要重复
两条 entry 语义高度重叠就合并。但**不同 dimension 不算重叠** —— "她吃醋时会鼓脸"（trigger_reaction）和 "鼓脸是她的标志性表情"（body_language）虽然都提到鼓脸，但视角不同，应该都保留。

### Rule 9 — 不要纯背景设定
世界观/前史故事跳过（那是 RAG 的活）。lorebook 只放"AI 现在该怎么演这个角色"的指令性事实。

## Character name (use this in the identity entry)
@@CHARACTER_NAME@@

## Character description
@@PERSONA_TEXT@@

Output the JSON array now (10-15 entries, all 6 dimensions covered, every entry has ≥5 keys with at least 30% of entries containing scenario-style keys):"""


def _strip_code_fences(s: str) -> str:
    """Gemini sometimes wraps JSON in ```json ... ``` fences despite the prompt."""
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


PRONOUN_BLOCKLIST = {
    # Generic pronouns / particles that would fire on every message — the LLM
    # sometimes hallucinates these into the keys list. Reject them at validation.
    "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们",
    "i", "me", "you", "he", "she", "it", "we", "they", "the", "a", "an",
    "is", "am", "are", "was", "were", "be", "this", "that", "these", "those",
}


def _filter_keys(keys: List[str]) -> List[str]:
    out = []
    for k in keys:
        kl = k.strip().lower()
        if not kl:
            continue
        if kl in PRONOUN_BLOCKLIST:
            continue
        # Single-character non-CJK keys ("a", "i") match too broadly; drop.
        if len(kl) == 1 and not ("一" <= kl <= "鿿"):
            continue
        out.append(k.strip())
    return out


# Hints used by _is_scenario_key — tokens that signal a key is phrased as
# something a user would actually say in chat (questions, second-person,
# first-person), as opposed to a third-person descriptor of the character.
_SCENARIO_HINT_TOKENS = (
    "怎么", "什么", "为啥", "为什么", "吗", "呢", "啥", "怎样", "如何",
    "你", "我", "?", "？", "是不是", "在干嘛", "在做什么", "干什么", "干嘛",
)


def _is_scenario_key(k: str) -> bool:
    """A 'scenario' key is one a user would naturally type in chat (question
    or first/second-person), not a third-person descriptor."""
    if not k:
        return False
    kl = k.lower()
    return any(h in kl for h in _SCENARIO_HINT_TOKENS)


def _validate_entry(raw: Dict) -> Optional[Dict]:
    """Coerce + validate a single entry, returning a clean dict or None if invalid."""
    if not isinstance(raw, dict):
        return None
    keys = raw.get("keys") or []
    content = (raw.get("content") or "").strip()
    if not content:
        return None
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(",") if k.strip()]
    keys = [str(k).strip() for k in keys if k and str(k).strip()]
    keys = _filter_keys(keys)
    constant = bool(raw.get("constant", False))
    if not keys and not constant:
        # Non-constant entry with no keys would never fire; reject.
        return None
    priority = raw.get("priority", 50)
    try:
        priority = max(0, min(100, int(priority)))
    except Exception:
        priority = 50
    selective_logic = raw.get("selective_logic", "any")
    if selective_logic not in ("any", "all"):
        selective_logic = "any"
    dimension = (raw.get("dimension") or "").strip().lower()
    if dimension not in DIMENSIONS:
        dimension = ""  # unknown / missing — quality check will flag if pervasive
    from datetime import datetime
    return {
        "id": str(uuid.uuid4()),
        "keys": keys,
        "content": content[:500],  # hard cap, the LLM occasionally rambles
        "priority": priority,
        "selective_logic": selective_logic,
        "constant": constant,
        "enabled": True,
        "dimension": dimension,
        "created_at": datetime.utcnow(),
    }


def _validate_extraction_quality(entries: List[Dict]) -> List[str]:
    """
    Returns a list of human-readable issues. Empty list = passes all checks.
    Used to decide whether to retry the LLM call.

    Checks (machine-determinable, given to the executor agent):
      1. entries count ≥ 10
      2. all 6 dimensions present
      3. every entry has ≥ 5 keys
      4. ≥ 30% of entries contain at least one scenario-style key
    """
    issues = []
    if len(entries) < 10:
        issues.append(f"too_few_entries:{len(entries)}<10")

    present_dims = {e.get("dimension") for e in entries if e.get("dimension")}
    missing_dims = [d for d in DIMENSIONS if d not in present_dims]
    if missing_dims:
        issues.append(f"missing_dimensions:{','.join(missing_dims)}")

    sparse = [e for e in entries if len(e.get("keys") or []) < 5]
    if sparse:
        issues.append(f"sparse_keys:{len(sparse)}_entries_have<5_keys")

    if entries:
        scenario_count = sum(
            1 for e in entries
            if any(_is_scenario_key(k) for k in (e.get("keys") or []))
        )
        ratio = scenario_count / len(entries)
        if ratio < 0.30:
            issues.append(f"low_scenario_ratio:{ratio:.0%}<30%")

    return issues


def _enforce_constant_cap(entries: List[Dict], cap: int = 2) -> List[Dict]:
    """LLMs sometimes mark too many entries constant, blowing the token budget."""
    constants = [e for e in entries if e.get("constant")]
    if len(constants) <= cap:
        return entries
    # Keep the highest-priority N as constant; demote the rest.
    constants.sort(key=lambda e: -e.get("priority", 50))
    keep_ids = {e["id"] for e in constants[:cap]}
    for e in entries:
        if e.get("constant") and e["id"] not in keep_ids:
            e["constant"] = False
    return entries


def extract_lorebook_from_persona(
    persona_text: str,
    character_name: Optional[str] = None,
) -> List[Dict]:
    """
    Decompose a free-form character description into structured lorebook entries.

    Returns an empty list on any failure. Callers should preserve their existing
    entries when this returns [], rather than overwriting them with nothing.
    """
    persona_text = (persona_text or "").strip()
    if len(persona_text) < 30:
        # Too short to be a real persona — likely empty or noise.
        return []

    model = _get_model()
    if not model:
        return []

    prompt = (
        EXTRACTION_PROMPT
        .replace("@@CHARACTER_NAME@@", character_name or "(unknown)")
        .replace("@@PERSONA_TEXT@@", persona_text[:4000])
    )

    raw = None
    last_err = None
    best_validated: List[Dict] = []  # keep best result across retries as fallback

    # Up to 3 attempts: 1 normal + up to 2 quality-driven retries.
    # On quality-fail retry, append the issues to the prompt so Gemini knows
    # exactly what to fix.
    MAX_ATTEMPTS = 3
    for attempt in range(MAX_ATTEMPTS):
        # On retry due to quality issues, prepend a corrective preamble.
        attempt_prompt = prompt
        if attempt > 0 and best_validated:
            issues = _validate_extraction_quality(best_validated)
            if issues:
                correction = (
                    "\n\nPREVIOUS ATTEMPT FAILED quality checks: "
                    + "; ".join(issues)
                    + ". Fix these specific issues in the new attempt. "
                    + "Do NOT shrink the entry count — go deeper, not narrower."
                )
                attempt_prompt = prompt + correction

        try:
            response = model.generate_content(attempt_prompt)
            raw = response.text or ""
        except Exception as e:
            last_err = e
            log.warning(f"[EXTRACTOR] Gemini call failed (attempt {attempt + 1}): {e}")
            continue

        cleaned = _strip_code_fences(raw)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as e:
            last_err = e
            log.warning(f"[EXTRACTOR] JSON parse failed (attempt {attempt + 1}): {e}")
            continue

        if not isinstance(parsed, list):
            log.warning(f"[EXTRACTOR] Expected JSON array, got {type(parsed).__name__}")
            continue

        validated = []
        for raw_entry in parsed:
            entry = _validate_entry(raw_entry)
            if entry:
                validated.append(entry)
        if not validated:
            log.warning("[EXTRACTOR] No valid entries after validation")
            continue

        validated = _enforce_constant_cap(validated, cap=2)

        # Track best across attempts so we don't lose ground if a later retry
        # somehow returns fewer entries.
        if len(validated) > len(best_validated):
            best_validated = validated

        issues = _validate_extraction_quality(validated)
        if not issues:
            log.info(
                f"[EXTRACTOR] Extracted {len(validated)} entries for "
                f"{character_name!r} (quality OK on attempt {attempt + 1})"
            )
            return validated

        log.warning(
            f"[EXTRACTOR] Attempt {attempt + 1} quality issues for "
            f"{character_name!r}: {issues}"
        )

    if best_validated:
        # Quality bar not met after all retries, but we have something — better
        # than empty. Caller (re_extract_lorebook) will overwrite the existing
        # entries with these; skipping would orphan the user with stale data.
        log.warning(
            f"[EXTRACTOR] Quality bar not met after {MAX_ATTEMPTS} attempts for "
            f"{character_name!r}; returning best-effort {len(best_validated)} entries. "
            f"Final issues: {_validate_extraction_quality(best_validated)}"
        )
        return best_validated

    log.error(f"[EXTRACTOR] All attempts failed for {character_name!r}: {last_err}")
    return []


def build_core_identity_entry(
    *,
    companion_name: str,
    user_name: Optional[str] = None,
    relationship: Optional[str] = None,
) -> Dict:
    """
    Synthesize a constant entry from settings — the core role-identity sentence
    that should anchor every reply, regardless of what's in the user's authored
    persona text.
    """
    parts = [f"你是{companion_name}"]
    if user_name and relationship:
        rel_zh = {
            "lover": "恋人",
            "friend": "朋友",
            "family": "家人",
            "mentor": "导师",
        }.get(relationship, relationship)
        parts.append(f"，{user_name}的{rel_zh}")
    content = "".join(parts) + "。"

    from datetime import datetime
    return {
        "id": str(uuid.uuid4()),
        "keys": [],
        "content": content,
        "priority": 90,
        "selective_logic": "any",
        "constant": True,
        "enabled": True,
        "dimension": "identity",
        "created_at": datetime.utcnow(),
        "_source": "core_identity",  # internal tag, not used by engine
    }
