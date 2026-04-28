"""
Lorebook engine — deterministic, keyword-triggered "wiki for the LLM".

Distinct from RAG (probabilistic vector search) and Mem0 (semantic memory):
lorebook entries fire only when their keywords appear in the recent
conversation window, giving authors precise control over when specific lore
gets injected.

Algorithm:
  1. Constant entries (if any) always enter the candidate pool.
  2. Tokenize scan window (current message + last 3 turns) with jieba.
  3. For each non-constant entry, match keys against tokens. selective_logic
     "any" = at least one key hits; "all" = every key must hit.
  4. Apply per-conversation recency bonus to entries that fired last turn —
     keeps context alive across pronoun-only follow-ups.
  5. Sort by effective priority desc, greedy-fill to token budget.
  6. Persist hit-set to Redis for next turn's recency lookup.

Empty entries → empty output (drop-in safe for users with no lorebook yet).
"""

import json
import logging
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

RECENCY_TTL_SECONDS = 24 * 3600
RECENCY_BONUS = 20
DEFAULT_BUDGET_TOKENS = 800
SCAN_WINDOW_TURNS = 3


def estimate_tokens(text: str) -> int:
    """
    Approximate token count for budget enforcement.
    CJK chars ~1.5 chars/token, others ~4 chars/token. Off by ±20% for our
    use; precise enough for budget cutoffs.
    """
    if not text:
        return 0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    other = len(text) - cjk
    return int(cjk / 1.5 + other / 4) + 1


def _tokenize(text: str) -> set:
    """jieba tokens + raw substring fallback. Lowercased."""
    text_lower = text.lower()
    if _JIEBA_OK:
        toks = set(jieba.lcut(text_lower))
    else:
        toks = set()
    # Always include the raw lowered text so single-character or English-phrase
    # keys still match without depending on the tokenizer's segmentation.
    toks.add(text_lower)
    return toks


def _key_matches(key: str, scan_text_lower: str, tokens: set) -> bool:
    if not key:
        return False
    k = key.lower()
    if k in tokens:
        return True
    # Multi-word English keys ("blue maid"), or Chinese phrases jieba split
    # apart — fall back to substring on the full scan text.
    return k in scan_text_lower


def select_lorebook(
    user_message: str,
    history_texts: List[str],
    entries: List[Dict],
    last_hit_ids: List[str],
    budget_tokens: int = DEFAULT_BUDGET_TOKENS,
) -> Tuple[List[Dict], int]:
    """
    Returns (selected_entries, tokens_used). selected_entries is sorted for
    output (highest original priority first).
    """
    if not entries:
        return [], 0

    last_hits_set = set(last_hit_ids or [])

    # 1. Constant entries first — always included regardless of keys.
    candidates = [
        e for e in entries
        if e.get("enabled", True) and e.get("constant", False)
    ]

    # 2. Keyword-triggered entries.
    scan_parts = [user_message] + (history_texts[-SCAN_WINDOW_TURNS:] if history_texts else [])
    scan_text = "\n".join(p for p in scan_parts if p)
    scan_text_lower = scan_text.lower()
    tokens = _tokenize(scan_text)

    for e in entries:
        if not e.get("enabled", True) or e.get("constant", False):
            continue
        keys = [k for k in (e.get("keys") or []) if k]
        if not keys:
            continue
        matched = [k for k in keys if _key_matches(k, scan_text_lower, tokens)]
        logic = e.get("selective_logic", "any")
        if logic == "all":
            if len(matched) == len(keys):
                candidates.append(e)
        else:  # "any"
            if matched:
                candidates.append(e)

    # 3. Dedupe by entry id (in case constant + keyword-matched same entry).
    seen = set()
    deduped = []
    for c in candidates:
        cid = c.get("id")
        if cid and cid in seen:
            continue
        if cid:
            seen.add(cid)
        deduped.append(c)
    candidates = deduped

    # 4. Effective priority with recency bonus.
    for c in candidates:
        base = int(c.get("priority", 50))
        bonus = RECENCY_BONUS if c.get("id") in last_hits_set else 0
        c["_eff_priority"] = base + bonus

    # 5. Greedy fill to token budget (highest effective priority first).
    candidates.sort(key=lambda c: -c["_eff_priority"])
    selected = []
    used = 0
    for c in candidates:
        t = estimate_tokens(c.get("content", ""))
        if used + t <= budget_tokens:
            selected.append(c)
            used += t

    # 6. Final output order: original priority desc, stable.
    selected.sort(key=lambda c: -int(c.get("priority", 50)))

    return selected, used


def format_lorebook_block(selected_entries: List[Dict]) -> str:
    if not selected_entries:
        return ""
    lines = ["[Character knowledge — relevant facts and relationships]"]
    for e in selected_entries:
        keys = e.get("keys") or []
        title = keys[0] if keys else "fact"
        content = (e.get("content") or "").strip()
        if not content:
            continue
        # Single-line per entry; multi-line content gets joined to keep block compact.
        flat = " ".join(content.split())
        lines.append(f"- {title}: {flat}")
    if len(lines) == 1:
        return ""
    lines.append("[End of knowledge]")
    return "\n".join(lines)


# ---------- Recency cache (Redis) ----------

def _recency_key(conversation_id: str) -> str:
    return f"lorebook:recency:{conversation_id}"


def get_recency_hits(conversation_id: str) -> List[str]:
    raw = safe_get(_recency_key(conversation_id))
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x) for x in data if x]
    except Exception:
        pass
    return []


def set_recency_hits(conversation_id: str, entry_ids: List[str]) -> None:
    if not entry_ids:
        # Don't blow away the cache on an empty hit — let it expire naturally so
        # a one-turn pronoun-only message doesn't reset everything.
        return
    payload = json.dumps([str(x) for x in entry_ids])
    safe_setex(_recency_key(conversation_id), RECENCY_TTL_SECONDS, payload)


# ---------- Top-level entry point used by chat routes ----------

def build_lorebook_prefix(
    user_message: str,
    conversation: Dict,
    companion: Optional[Dict],
    budget_tokens: int = DEFAULT_BUDGET_TOKENS,
) -> str:
    """
    Returns the [Character knowledge] block (with trailing blank line) ready to
    prepend to message_to_send, or "" when there's nothing to inject.

    Drop-in safe: if companion is None, has no lorebook_entries, or entries are
    all disabled with no keyword hit, returns "" — chat behavior matches today.
    """
    if not companion:
        return ""
    entries = companion.get("lorebook_entries") or []
    if not entries:
        return ""

    history_msgs = conversation.get("messages", []) or []
    history_texts = [(m.get("content") or "") for m in history_msgs[-SCAN_WINDOW_TURNS:]]
    conv_id = str(conversation.get("_id", ""))

    last_hits = get_recency_hits(conv_id) if conv_id else []

    try:
        selected, used_tokens = select_lorebook(
            user_message=user_message,
            history_texts=history_texts,
            entries=entries,
            last_hit_ids=last_hits,
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

    # Persist new hit set for next turn's recency boost.
    if conv_id:
        set_recency_hits(conv_id, [e.get("id") for e in selected if e.get("id")])

    log.info(
        f"[LOREBOOK] conv={conv_id[-8:] if conv_id else '?'} "
        f"hits={len(selected)} tokens={used_tokens}"
    )
    return block + "\n\n"
