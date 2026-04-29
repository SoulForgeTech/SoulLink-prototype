"""
Lorebook engine — keyword-triggered "wiki for the LLM", aligned with the
SillyTavern / HammerAI World Info standard.

Distinct from RAG (probabilistic vector search), Mem0 (semantic memory), and
the auto-extracted character_card (always-injected voice anchor): lorebook
entries fire only when their keywords appear in the recent conversation
window, giving authors precise control over WHEN specific lore surfaces.

Entry shape (new ST/HammerAI schema, with legacy fallback fields):
    id, title, keys[], secondary_keys[], selective_logic, content,
    strategy (constant|selective|vectorized), insertion_order,
    insertion_position, probability, sticky, cooldown, delay,
    enabled, source, created_at, updated_at

Algorithm:
  1. Load per-conversation state from Redis: {turn, hits{entry_id: {last_turn}}}.
  2. Constant entries (strategy=constant) always enter the candidate pool
     unless under cooldown.
  3. Sticky pass: any entry with sticky>0 that fired within the last `sticky`
     turns is force-included (mirrors ST behavior).
  4. Tokenize scan window (current msg + last N turns) with jieba.
  5. For each non-constant entry: skip if disabled / under cooldown / not yet
     past its delay; otherwise match keys against tokens with the entry's
     selective_logic. Apply probability gate.
  6. Apply recency bonus to entries that fired last turn (keeps context
     alive across pronoun-only follow-ups).
  7. Sort by effective insertion_order desc, greedy-fill to token budget.
  8. Persist updated state (turn += 1, fired entries get last_turn=turn).

Empty entries / no companion → empty output (drop-in safe).
"""

import json
import logging
import random
from typing import Dict, List, Optional, Tuple

try:
    import jieba

    # Don't autoload dictionaries on first call — warm the cache eagerly so the
    # first chat request doesn't pay 300ms+ of dict load time.
    jieba.initialize()
    _JIEBA_OK = True
except Exception as _e:
    _JIEBA_OK = False
    logging.getLogger(__name__).warning(
        f"[LOREBOOK] jieba unavailable, falling back to substring match: {_e}"
    )

from redis_client import safe_get, safe_setex

log = logging.getLogger(__name__)

STATE_TTL_SECONDS = 24 * 3600
RECENCY_BONUS = 20
DEFAULT_BUDGET_TOKENS = 1200
SCAN_WINDOW_TURNS = 3


def estimate_tokens(text: str) -> int:
    """CJK ~1.5 chars/token, others ~4 chars/token. Off by ±20%; precise
    enough for budget cutoffs."""
    if not text:
        return 0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    other = len(text) - cjk
    return int(cjk / 1.5 + other / 4) + 1


def _tokenize(text: str) -> set:
    text_lower = text.lower()
    if _JIEBA_OK:
        toks = set(jieba.lcut_for_search(text_lower))
    else:
        toks = set()
    toks.add(text_lower)  # for substring fallback on multi-word phrases
    return toks


def _key_matches(key: str, scan_text_lower: str, tokens: set) -> bool:
    if not key:
        return False
    k = key.lower()
    if k in tokens:
        return True
    # Substring fallback for multi-word phrases or rare jieba mis-segments.
    # Restrict to keys long enough that incidental matches inside other words
    # are unlikely (CJK threshold stricter — each CJK char carries more meaning).
    if " " in k:
        return k in scan_text_lower
    cjk_count = sum(1 for ch in k if "一" <= ch <= "鿿")
    if cjk_count >= 3 or (cjk_count == 0 and len(k) >= 4):
        return k in scan_text_lower
    return False


def _is_constant(entry: Dict) -> bool:
    """Honor both the new strategy field and the legacy `constant` bool."""
    s = (entry.get("strategy") or "").lower()
    if s == "constant":
        return True
    if s in ("selective", "vectorized"):
        return False
    return bool(entry.get("constant", False))


def _entry_order(entry: Dict) -> int:
    """Prefer the new insertion_order field; fall back to legacy `priority`."""
    val = entry.get("insertion_order")
    if val is None:
        val = entry.get("priority", 50)
    try:
        return int(val)
    except Exception:
        return 50


def _normalize_logic(logic: str) -> str:
    """Map any historical key formats to the canonical 4 SillyTavern values."""
    l = (logic or "").lower()
    if l == "any":
        return "and_any"
    if l == "all":
        return "and_all"
    if l in ("and_any", "and_all", "not_any", "not_all"):
        return l
    return "and_any"


def _evaluate_logic(matched_primary: List[str], primary_keys: List[str],
                    matched_secondary: List[str], secondary_keys: List[str],
                    logic: str) -> bool:
    """Apply the selective_logic combining primary and secondary key matches.
    See SillyTavern docs for the exact AND/NOT semantics."""
    primary_hit = bool(matched_primary)
    if not primary_hit:
        return False
    if not secondary_keys:
        # No secondary filter — primary hit is sufficient regardless of logic.
        return True
    s_any = bool(matched_secondary)
    s_all = (len(matched_secondary) == len(secondary_keys))
    if logic == "and_any":
        return s_any
    if logic == "and_all":
        return s_all
    if logic == "not_any":
        return not s_any
    if logic == "not_all":
        return not s_all
    return True


# ---------- Redis-backed per-conversation state ----------

def _state_key(conversation_id: str) -> str:
    return f"lorebook:state:{conversation_id}"


def get_state(conversation_id: str) -> Dict:
    """State shape: {"turn": int, "hits": {entry_id: {"last_turn": int}}}."""
    raw = safe_get(_state_key(conversation_id))
    if not raw:
        return {"turn": 0, "hits": {}}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {
                "turn": int(data.get("turn", 0) or 0),
                "hits": data.get("hits") or {},
            }
    except Exception:
        pass
    return {"turn": 0, "hits": {}}


def set_state(conversation_id: str, state: Dict) -> None:
    payload = json.dumps({
        "turn": int(state.get("turn", 0) or 0),
        "hits": state.get("hits") or {},
    })
    safe_setex(_state_key(conversation_id), STATE_TTL_SECONDS, payload)


# ---------- Selection ----------

def select_lorebook(
    user_message: str,
    history_texts: List[str],
    entries: List[Dict],
    state: Optional[Dict] = None,
    budget_tokens: int = DEFAULT_BUDGET_TOKENS,
    rng: Optional[random.Random] = None,
) -> Tuple[List[Dict], int, Dict]:
    """
    Returns (selected_entries, tokens_used, new_state).

    `state` is the per-conversation state dict from Redis (or None for one-shot
    test mode). The returned new_state should be persisted by the caller.
    """
    if not entries:
        return [], 0, {"turn": 0, "hits": {}}

    state = state or {"turn": 0, "hits": {}}
    current_turn = int(state.get("turn", 0) or 0) + 1
    hits_map = dict(state.get("hits") or {})  # entry_id -> {"last_turn": int}
    rng = rng or random

    msg_count_for_delay = len(history_texts) + 1

    # Build scan tokens once.
    scan_parts = [user_message] + (history_texts[-SCAN_WINDOW_TURNS:] if history_texts else [])
    scan_text = "\n".join(p for p in scan_parts if p)
    scan_text_lower = scan_text.lower()
    tokens = _tokenize(scan_text)

    candidates: List[Dict] = []
    seen_ids: set = set()

    def _consider(entry: Dict, reason: str, matched: List[str]) -> None:
        eid = entry.get("id")
        if eid and eid in seen_ids:
            return
        if eid:
            seen_ids.add(eid)
        entry["_matched_keys"] = matched
        entry["_match_reason"] = reason
        # Recency bonus: did this entry fire in the immediately previous turn?
        last = (hits_map.get(eid) or {}).get("last_turn", 0) if eid else 0
        bonus = RECENCY_BONUS if last == current_turn - 1 else 0
        entry["_eff_order"] = _entry_order(entry) + bonus
        candidates.append(entry)

    # 1. Constant entries — always pool unless under cooldown.
    for e in entries:
        if not e.get("enabled", True):
            continue
        if not _is_constant(e):
            continue
        eid = e.get("id")
        cooldown = max(0, int(e.get("cooldown", 0) or 0))
        last_t = (hits_map.get(eid) or {}).get("last_turn", 0) if eid else 0
        if cooldown > 0 and last_t and (current_turn - last_t) <= cooldown:
            continue
        _consider(e, "constant", [])

    # 2. Sticky pass — any entry whose sticky window covers this turn is
    # force-included even without a fresh keyword match. Mirrors ST behavior.
    for e in entries:
        if not e.get("enabled", True):
            continue
        if _is_constant(e):
            continue
        eid = e.get("id")
        if not eid or eid not in hits_map:
            continue
        sticky = max(0, int(e.get("sticky", 0) or 0))
        if sticky <= 0:
            continue
        last_t = hits_map[eid].get("last_turn", 0)
        if last_t and (current_turn - last_t) <= sticky:
            _consider(e, "sticky", [])

    # 3. Keyword-triggered selective entries.
    for e in entries:
        if not e.get("enabled", True) or _is_constant(e):
            continue

        eid = e.get("id")
        # Cooldown gate
        cooldown = max(0, int(e.get("cooldown", 0) or 0))
        last_t = (hits_map.get(eid) or {}).get("last_turn", 0) if eid else 0
        if cooldown > 0 and last_t and (current_turn - last_t) <= cooldown:
            continue

        # Delay gate (require ≥N msgs in chat)
        delay = max(0, int(e.get("delay", 0) or 0))
        if delay > 0 and msg_count_for_delay < delay:
            continue

        primary_keys = [k for k in (e.get("keys") or []) if k]
        secondary_keys = [k for k in (e.get("secondary_keys") or []) if k]
        if not primary_keys:
            continue

        matched_primary = [k for k in primary_keys if _key_matches(k, scan_text_lower, tokens)]
        if not matched_primary:
            continue
        matched_secondary = [k for k in secondary_keys if _key_matches(k, scan_text_lower, tokens)]
        logic = _normalize_logic(e.get("selective_logic", "and_any"))
        if not _evaluate_logic(matched_primary, primary_keys, matched_secondary, secondary_keys, logic):
            continue

        # Probability gate (after match — matches ST behavior)
        prob = max(0, min(100, int(e.get("probability", 100) or 100)))
        if prob < 100 and rng.random() * 100 >= prob:
            continue

        _consider(e, "keyword", matched_primary)

    # 4. Greedy fill to token budget (highest effective insertion_order first).
    candidates.sort(key=lambda c: -c.get("_eff_order", 50))
    selected: List[Dict] = []
    used = 0
    for c in candidates:
        t = estimate_tokens(c.get("content", ""))
        if used + t <= budget_tokens:
            selected.append(c)
            used += t

    # 5. Final output order: original insertion_order desc, stable.
    selected.sort(key=lambda c: -_entry_order(c))

    # 6. Update hits map for entries that fired this turn.
    new_hits = dict(hits_map)
    for s in selected:
        sid = s.get("id")
        if sid:
            new_hits[sid] = {"last_turn": current_turn}
    # Garbage collect very old entries to keep payload bounded.
    if len(new_hits) > 200:
        cutoff = current_turn - 50
        new_hits = {k: v for k, v in new_hits.items() if (v.get("last_turn") or 0) >= cutoff}

    new_state = {"turn": current_turn, "hits": new_hits}
    return selected, used, new_state


def format_lorebook_block(selected_entries: List[Dict]) -> str:
    if not selected_entries:
        return ""
    lines = ["[Character knowledge — relevant facts and history]"]
    for e in selected_entries:
        title = (e.get("title") or "").strip()
        if not title:
            keys = e.get("keys") or []
            title = keys[0] if keys else "fact"
        content = (e.get("content") or "").strip()
        if not content:
            continue
        flat = " ".join(content.split())
        lines.append(f"- {title}: {flat}")
    if len(lines) == 1:
        return ""
    lines.append("[End of knowledge]")
    return "\n".join(lines)


# ---------- Top-level entry point used by chat routes ----------

def build_lorebook_prefix(
    user_message: str,
    conversation: Dict,
    companion: Optional[Dict],
    budget_tokens: int = DEFAULT_BUDGET_TOKENS,
) -> str:
    """
    Returns the [Character knowledge] block (with trailing blank line) ready to
    prepend to the user message, or "" when nothing fires.
    """
    if not companion:
        return ""
    entries = companion.get("lorebook_entries") or []
    if not entries:
        return ""

    history_msgs = conversation.get("messages", []) or []
    history_texts = [(m.get("content") or "") for m in history_msgs[-SCAN_WINDOW_TURNS:]]
    conv_id = str(conversation.get("_id", ""))

    state = get_state(conv_id) if conv_id else {"turn": 0, "hits": {}}

    try:
        selected, used_tokens, new_state = select_lorebook(
            user_message=user_message,
            history_texts=history_texts,
            entries=entries,
            state=state,
            budget_tokens=budget_tokens,
        )
    except Exception as e:
        log.warning(f"[LOREBOOK] select failed for conv {conv_id}: {e}")
        return ""

    if not selected:
        return ""

    block = format_lorebook_block(selected)
    if not block:
        return ""

    if conv_id:
        set_state(conv_id, new_state)

    # Detailed log so users tailing journalctl can see exactly what fired and
    # why — the lorebook UI also surfaces this, but logs are useful for
    # debugging chat hot-path behavior.
    hit_details = []
    for e in selected:
        title = (e.get("title") or "").strip() or (e.get("keys") or [""])[0] or "fact"
        reason = e.get("_match_reason", "?")
        if reason in ("constant", "sticky"):
            hit_details.append(f"{title}[{reason}]")
        else:
            mk = e.get("_matched_keys") or []
            mk_short = ",".join(mk[:3]) + ("..." if len(mk) > 3 else "")
            hit_details.append(f"{title}[{mk_short}]")
    log.info(
        f"[LOREBOOK] conv={conv_id[-8:] if conv_id else '?'} "
        f"turn={new_state.get('turn')} hits={len(selected)} "
        f"tokens={used_tokens} → {' | '.join(hit_details)}"
    )
    return block + "\n\n"
