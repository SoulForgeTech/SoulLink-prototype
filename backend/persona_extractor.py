"""
Persona → lorebook decomposition via LLM.

The user authors their character as one paragraph of natural-language
custom_persona text — that's the only authoring surface they ever see. This
module silently decomposes that paragraph into 4-8 structured lorebook
entries, which the chat hot path then triggers by keyword. The user has no UI
for entries; they edit the source paragraph and we re-extract.

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


# Bilingual prompt — the persona text itself is mixed Chinese/English in
# practice, so keep instructions in both languages and let the LLM mirror.
EXTRACTION_PROMPT = """You are a character lorebook extraction system. Decompose the character description into 4-8 structured entries that a chat engine will trigger by keyword match.
你是角色 lorebook 提取系统。把下面的角色描述拆解成 4-8 条结构化条目，聊天引擎会按关键词触发。

## Output schema (strict JSON)
[
  {
    "keys": ["..."],          // 2-5 keywords/aliases users would mention to evoke this aspect
    "content": "...",         // <100 chars, what the AI should know when matched
    "priority": 50,           // 0-100, higher = more important
    "constant": false,        // true ONLY for core identity / world setting that must always inject
    "selective_logic": "any"  // almost always "any"
  }
]

## Rules
1. Output JSON array ONLY. No prose, no markdown fences.
2. Each entry's "content" must be self-contained and readable in isolation.
3. "keys" must include common aliases users actually say in chat:
   - Names + nicknames + role-titles ("姐姐", "本水神", "boss")
   - For attributes: include both the attribute and likely user phrasing
     (entry about hair color → keys=["头发", "发色", "颜色", "什么颜色"])
   - DO NOT include generic pronouns or particles (我/你/他/她/它/I/you/he/she/it/the/a)
     — these would fire on every message and pollute the prompt.
   - DO NOT include single English letters (a/i) for the same reason.
4. constant=true ONLY for: core role identity, world setting, hard-line behavior rules.
   At MOST 2 constant entries. Most entries should be keyword-triggered.
5. priority guidance:
   - 70-80: core personality traits, defining quirks
   - 50-60: secondary traits, relationships
   - 30-40: minor preferences, trivia
6. Language: produce content in the SAME LANGUAGE as the input description.
7. Avoid duplicates — if two facts overlap, merge them.
8. Skip world-building lore that's pure backstory (those go to RAG, not lorebook).

## Character name (use this when generating identity entry)
@@CHARACTER_NAME@@

## Character description
@@PERSONA_TEXT@@

Output the JSON array now:"""


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
    from datetime import datetime
    return {
        "id": str(uuid.uuid4()),
        "keys": keys,
        "content": content[:500],  # hard cap, the LLM occasionally rambles
        "priority": priority,
        "selective_logic": selective_logic,
        "constant": constant,
        "enabled": True,
        "created_at": datetime.utcnow(),
    }


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
    for attempt in range(2):
        try:
            response = model.generate_content(prompt)
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
        log.info(f"[EXTRACTOR] Extracted {len(validated)} entries for {character_name!r}")
        return validated

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
        "created_at": datetime.utcnow(),
        "_source": "core_identity",  # internal tag, not used by engine
    }
