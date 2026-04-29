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

EXTRACTION_PROMPT = """You are a character authoring assistant. Given a character name and a free-form persona description (and optionally some canonical reference material), produce TWO outputs in a single JSON object:

  1. **character_card** — the always-on voice anchor (identity, personality, speech style, body language, example dialogues). This is what every reply should sound like.
  2. **lorebook_entries** — keyword-triggered world facts, relationship history, hidden motives, plot events, or scene-specific lore. The KEY canonical material lives here.

This split mirrors the SillyTavern / HammerAI convention.

## SOURCE PRIORITY (most important rule)

You will use up to THREE sources of information, in this priority order:

  **(A) Canonical material from your training data.**
       If you recognize @@CHARACTER_NAME@@ as a known character from any IP
       (anime / video game / novel / movie / popular fandom), you MUST use
       that canonical material:
         - Real dialogue lines from the source (verbatim or near-verbatim) —
           NOT invented imitations
         - Real plot events, hidden backstories, world setting, relationship
           network, signature mannerisms, secrets, defining moments
         - Set "canon_recognized": true and "canon_ip": "<name of IP>"
       Do NOT shy away from quoting actual lines — that is the entire point.

  **(B) Canonical reference material provided below as @@CANON_CONTEXT@@.**
       If non-empty, this is wiki / fandom / source-script text we fetched
       for you. Treat it as authoritative — extract dialogues, lore, plot
       events, relationships from it directly. Combine with (A) when both
       are available.

  **(C) The user's persona text.**
       Always weighted on top — the user may have customized or refined the
       canonical character (e.g. softer / older / set in a different scene).
       When persona text contradicts canon, persona wins. When persona is
       silent on something canon covers, use canon.

  **If you don't recognize the character AND no canon context is provided:**
       Set "canon_recognized": false. example_dialogs may be synthesized in
       the spirit of the persona text; lorebook_entries should be sparse
       (only what's literally in the persona text — usually empty).

## Inputs

- Character name: @@CHARACTER_NAME@@

- Canonical reference material (may be empty):
@@CANON_CONTEXT@@

- User-authored persona text:
@@PERSONA_TEXT@@

## Output schema (strict JSON object — no prose, no markdown fences)

{
  "canon_recognized": true,                  // REQUIRED. true if you recognize the character from any IP
  "canon_ip": "Genshin Impact",              // The IP name if recognized, else ""
  "character_card": {
    "identity": "Intrinsic character identity ONLY — do NOT mention the user or the user's relationship to the character. Format: \\"<Name>，<role/profession/world>。<one-line distinctive trait>。\\" Example: \\"芙宁娜，原任枫丹水神 500 年。自称'本水神'，外表浮夸自信、内心脆弱孤独的戏剧艺术家。\\"",
    "personality_brief": "2-4 句话概括气质底色 / 内核反差 / 主导动机。第三人称写法（描述这个角色）。",
    "voice_traits": "PList 格式 — 一行、分号分隔、方括号包裹。覆盖 speech / body / mannerism / triggers 四类。每类至少 3 个标签。如果 canon_recognized=true，必须包含 canon 里的标志性口癖、自称、招牌动作。",
    "example_dialogs": [
      // 6-10 段示例对话。
      // 如果 canon_recognized=true，这里 MUST 包含真实 canon 台词（剧情/语音/支线对话），
      // 用 "source": "canon" 标注。可以略改写场景以贴合 user/char 对话格式，但保留原台词的措辞、口癖、自称。
      // 如果 canon 中没有合适场景，用 "source": "synthesized" 标注合成对话。
      // 覆盖：日常 / 撒娇 / 被夸 / 吃醋 / 难过被安慰 / 生气 / 关心对方
      {"user": "...", "char": "...", "source": "canon", "canon_ref": "from <quest/voice line>"},
      {"user": "...", "char": "...", "source": "synthesized"}
    ]
  },
  "lorebook_entries": [
    // 如果 canon_recognized=true，这里 MUST 大量填充 canon 内容：
    //   * 角色身份背景（ex: 枫丹前任水神，统治 500 年）
    //   * 关键剧情事件（ex: 终幕审判、500 年契约、自我揭示）
    //   * 隐藏动机/秘密 (ex: 她其实是芙卡萝丝的人形容器)
    //   * 关系网（ex: 与那维莱特、克洛琳德、芙卡洛斯的关系）
    //   * 世界设定 (ex: 枫丹的水神更替制度)
    //   * 标志性事件 / 名场面
    // 如果只有 persona 没有 canon，可以是空数组 — 那部分会随聊天历史挖矿增长。
    {
      "title": "短标题（给用户看的标签）",
      "keys": ["主关键词1", "主关键词2", "用户可能说的场景词"],   // 5+ keys, mix descriptive + scenario
      "secondary_keys": [],
      "selective_logic": "and_any",
      "content": "factual reference note 风格。第三人称。可以引用 canon 的细节、年份、事件名。",
      "strategy": "selective",
      "insertion_order": 100,
      "probability": 100,
      "sticky": 0, "cooldown": 0, "delay": 0,
      "_source_hint": "canon | persona"   // 标注这条 entry 是从 canon 还是 persona 来的
    }
  ]
}

## Rules for the character_card

### identity (CRITICAL — common mistake)
- 描述**角色本身是谁**，不要提及用户、不要提关系（如"X 的恋人/朋友"）
  - 关系会由 system prompt 在另一处注入，写在这里就是双重注入
- 一句话格式：`<Name>，<intrinsic role/profession/world>。<one-line distinctive trait>。`
- 例 1（canon 已识别）："芙宁娜，原任枫丹水神 500 年。自称'本水神'，外表浮夸自信、内心脆弱孤独的戏剧艺术家。"
- 例 2（无 canon，纯 persona）："Aiden，30 岁科技公司 CEO。沉稳干练，工作之外却展现温柔细腻的一面。"
- 第三人称写法（不要写"你是..."）

### personality_brief
- 2-4 句话，浓缩气质底色 + 反差 + 主导动机
- 第三人称。保留原文具体措辞，不要抽象化

### voice_traits
- **必须用 PList 格式**：`[category: tag1, tag2; category: tag1, tag2; ...]`
- 4 类必须都有：`speech` / `body` / `mannerism` / `triggers`
- 每类至少 3 个标签
- 如果 canon_recognized=true，**必须**包含 canon 里的标志性口癖（自称、口头禅、招牌动作）

### example_dialogs（最关键 + canon 优先）
- **6-10 段**对话样本，覆盖：日常 / 撒娇 / 被夸 / 吃醋 / 难过被安慰 / 生气 / 关心对方
- 如果 canon_recognized=true：
  - 优先用真实 canon 台词，标注 `"source": "canon"` 和 `"canon_ref": "<source>"`
  - 可以为了贴合对话格式略调整场景，但措辞、自称、口癖、用词偏好原样保留
  - 至少一半应该是 canon 来的
- 如果 canon 没合适场景，标注 `"source": "synthesized"` 编一段
- user 行：30 字以内；char 行：50-200 字
- 用括号描动作：（耳朵泛红）、（语气拉长）

## Rules for the lorebook_entries

### Source priority
- 如果 canon_recognized=true：**这里要重点填充**。覆盖
  - 角色身份背景 / 出身
  - 关键剧情事件（具体到事件名 / 章节）
  - 隐藏动机 / 秘密 / 真实身份
  - 主要关系网（朋友、敌人、家人、师徒、爱人）
  - 世界设定相关条目（角色所属阵营、世界规则、特殊能力机制）
  - 标志性事件 / 名场面
- 如果只有 persona 没 canon：稀疏即可，仅当 persona 含 plot/world 才建 entry

### When to SKIP（仍然只放 card 里）
- 纯性格描述（"她很自信"）
- 说话方式（"喜欢夸张措辞"）
- 身体语言（"表情夸张"）

### Entry schema
- `title`: 短标签（"水神身份"、"血契契约"、"双重身份"）
- `keys`: 5+ 个，混合描述词 + 场景词
- `content`: factual reference note（不是 prose）。可以引用具体年份、章节、事件名
- `strategy`: 默认 `"selective"`；核心世界规则可用 `"constant"`
- `insertion_order`: 默认 100；核心 lore 用 150-200
- `_source_hint`: `"canon"` 或 `"persona"`

### Anti-patterns
- ❌ 把性格特征塞进 lorebook（"她很温柔" → 不建 entry）
- ❌ 单字母或代词作为 key（"我"、"你"、"a"）
- ❌ content 写成 prose 段落（应该是 reference notes）
- ❌ identity 提到用户名或关系

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


def _validate_card(raw: Dict, character_name: str) -> Dict:
    """Coerce the LLM-emitted card into the schema, filling in missing fields
    with sane defaults so downstream code never has to None-check.

    NOTE: identity intentionally describes the character intrinsically and
    does NOT mention the user or the user→character relationship. Those are
    injected separately by the system-prompt template (see workspace_manager).
    """
    if not isinstance(raw, dict):
        raw = {}
    identity = (raw.get("identity") or "").strip()
    if not identity:
        identity = f"{character_name}。"
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
            examples.append({
                "user": u[:200],
                "char": c[:800],
                "source": (ex.get("source") or "synthesized").strip().lower(),
                "canon_ref": (ex.get("canon_ref") or "").strip()[:120],
            })
    return {
        "identity": identity[:400],
        "personality_brief": personality[:800],
        "voice_traits": voice[:1200],
        "example_dialogs": examples[:12],
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
    user_name: Optional[str] = None,           # accepted for API compat; unused
    relationship: Optional[str] = None,        # accepted for API compat; unused
    canon_context: Optional[str] = None,
) -> Dict:
    """
    Decompose free-form persona text + (optional) canon reference material
    into a character_card + lorebook_entries. Returns a dict with both keys
    plus canon_recognized / canon_ip flags from the LLM; never raises.

    `canon_context` is wiki/script text fetched separately by wiki_augment.
    When provided, the LLM is instructed to extract canonical dialogue and
    plot/lore directly from it. Combined with the model's own training-data
    canon knowledge.

    Identity intentionally does NOT mention user_name/relationship — those
    are injected separately by the system-prompt template. The kwargs are
    accepted for backward compatibility with existing call sites.
    """
    persona_text = (persona_text or "").strip()
    if len(persona_text) < 30:
        return {"character_card": {}, "lorebook_entries": [], "canon_recognized": False, "canon_ip": ""}

    model = _get_model()
    if not model:
        return {"character_card": {}, "lorebook_entries": [], "canon_recognized": False, "canon_ip": ""}

    canon_block = (canon_context or "").strip()
    canon_for_prompt = canon_block[:8000] if canon_block else "(none — rely on your own training-data knowledge if you recognize the character)"

    prompt = (
        EXTRACTION_PROMPT
        .replace("@@CHARACTER_NAME@@", character_name or "(unknown)")
        .replace("@@CANON_CONTEXT@@", canon_for_prompt)
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
        )
        entries_raw = obj.get("lorebook_entries") or []
        entries = []
        if isinstance(entries_raw, list):
            for r in entries_raw:
                e = _validate_lorebook_entry(r)
                if e:
                    entries.append(e)
        canon_recognized = bool(obj.get("canon_recognized"))
        canon_ip = (obj.get("canon_ip") or "").strip()[:80]

        # Quality bar for the card: must have identity + personality_brief +
        # voice_traits + ≥3 example dialogs. If recognized canon character,
        # also require ≥6 dialogs (canon characters should have rich examples).
        card_issues = []
        if not card.get("identity"):
            card_issues.append("missing_identity")
        if not card.get("personality_brief"):
            card_issues.append("missing_personality_brief")
        if not card.get("voice_traits"):
            card_issues.append("missing_voice_traits")
        min_dialogs = 6 if canon_recognized else 3
        if len(card.get("example_dialogs") or []) < min_dialogs:
            card_issues.append(f"only_{len(card.get('example_dialogs') or [])}_dialogs<{min_dialogs}")
        # If canon recognized, expect at least one canon-sourced dialog
        if canon_recognized:
            canon_dialogs = sum(1 for d in (card.get("example_dialogs") or []) if d.get("source") == "canon")
            if canon_dialogs == 0:
                card_issues.append("canon_recognized_but_no_canon_dialogs")
            # Lorebook should have entries when canon is recognized
            if not entries:
                card_issues.append("canon_recognized_but_empty_lorebook")

        if not card_issues:
            log.info(
                f"[EXTRACTOR] OK on attempt {attempt + 1} for {character_name!r}: "
                f"canon={canon_recognized}({canon_ip!r}), "
                f"card({len(card.get('voice_traits',''))}c voice, "
                f"{len(card.get('example_dialogs') or [])} dialogs), "
                f"{len(entries)} lorebook entries"
            )
            return {
                "character_card": card,
                "lorebook_entries": entries,
                "canon_recognized": canon_recognized,
                "canon_ip": canon_ip,
            }

        log.warning(
            f"[EXTRACTOR] Attempt {attempt + 1} issues for {character_name!r}: {card_issues}"
        )
        # Save best-effort in case retry returns worse.
        parsed = {
            "character_card": card,
            "lorebook_entries": entries,
            "canon_recognized": canon_recognized,
            "canon_ip": canon_ip,
        }
        # Append correction to prompt for retry.
        prompt = prompt + (
            "\n\nPREVIOUS ATTEMPT had issues: "
            + "; ".join(card_issues)
            + ". Fix these specifically. If canon_recognized, you MUST include real canon dialogue lines and lorebook entries from the source IP — don't be lazy. Don't shrink the output, expand it."
        )

    if parsed:
        log.warning(f"[EXTRACTOR] Returning best-effort for {character_name!r} after retries")
        return parsed

    log.error(f"[EXTRACTOR] All attempts failed for {character_name!r}: {last_err}")
    return {"character_card": {}, "lorebook_entries": [], "canon_recognized": False, "canon_ip": ""}


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
