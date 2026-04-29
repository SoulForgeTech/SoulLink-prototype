"""
Companion service — owns the `companions` Mongo collection and lazy migration
from the legacy `users.settings.custom_persona*` fields.

Each user has 1..N companions; the active one is referenced by
`users.settings.active_companion_id`. For existing users a default companion is
created on first chat from their legacy settings, so deploy needs no batch
migration.

Lorebook entries live inside the companion document (small docs, infrequent
writes — embedding is fine; promote to its own collection only if entries grow
past a few hundred per companion).
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from bson import ObjectId

from database import db
from redis_client import safe_get, safe_setex, safe_delete

log = logging.getLogger(__name__)

COLLECTION = "companions"
CACHE_TTL_SECONDS = 300


# ---------- Cache helpers ----------

def _cache_key(companion_id: str) -> str:
    return f"companion:{companion_id}"


def _bson_safe(doc: Dict) -> Dict:
    """Shallow-copy doc with ObjectId/datetime stringified for JSON cache."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _cache_set(doc: Dict) -> None:
    cid = str(doc.get("_id"))
    if not cid:
        return
    try:
        safe_setex(_cache_key(cid), CACHE_TTL_SECONDS, json.dumps(_bson_safe(doc), default=str))
    except Exception:
        pass


def _cache_invalidate(companion_id: str) -> None:
    safe_delete(_cache_key(companion_id))


# ---------- Schema ----------

def _new_lorebook_entry(
    keys: List[str],
    content: str,
    *,
    title: str = "",
    secondary_keys: Optional[List[str]] = None,
    selective_logic: str = "and_any",
    strategy: str = "selective",
    insertion_order: int = 100,
    insertion_position: str = "after_char_defs",
    probability: int = 100,
    sticky: int = 0,
    cooldown: int = 0,
    delay: int = 0,
    enabled: bool = True,
    source: str = "manual",
) -> Dict:
    """
    Build a new lorebook entry conforming to the ST/HammerAI-style schema.

    Backward-compatible callers can omit any of the advanced fields and they'll
    default to sensible values. The legacy `priority` and `constant` fields are
    superseded by `insertion_order` and `strategy` respectively — the lorebook
    engine reads both for compat.
    """
    if selective_logic not in ("and_any", "and_all", "not_any", "not_all"):
        # Tolerate legacy "any"/"all" payloads from old API clients.
        if selective_logic == "any":
            selective_logic = "and_any"
        elif selective_logic == "all":
            selective_logic = "and_all"
        else:
            selective_logic = "and_any"
    if strategy not in ("constant", "selective", "vectorized"):
        strategy = "selective"
    if insertion_position not in (
        "before_char_defs", "after_char_defs",
        "before_example", "after_example",
        "top_an", "bottom_an", "at_depth",
    ):
        insertion_position = "after_char_defs"
    return {
        "id": str(uuid.uuid4()),
        "title": (title or "").strip(),
        "keys": [k.strip() for k in (keys or []) if k and k.strip()],
        "secondary_keys": [k.strip() for k in (secondary_keys or []) if k and k.strip()],
        "content": (content or "").strip(),
        "selective_logic": selective_logic,
        "strategy": strategy,
        "insertion_order": max(0, min(1000, int(insertion_order))),
        "insertion_position": insertion_position,
        "probability": max(0, min(100, int(probability))),
        "sticky": max(0, int(sticky)),
        "cooldown": max(0, int(cooldown)),
        "delay": max(0, int(delay)),
        "enabled": bool(enabled),
        "source": source,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


def _empty_character_card() -> Dict:
    """The character_card is the always-injected counterpart to the
    keyword-triggered lorebook. It owns identity, voice traits, and example
    dialogues — content that should always anchor the AI's persona, not be
    surfaced situationally."""
    return {
        "identity": "",                # "你是 X，Y 的 Z" 一句话身份
        "personality_brief": "",       # 2-3 句温度 / 气质底色
        "voice_traits": "",            # PList 风格：[speech: ...; body: ...; mannerism: ...]
        "example_dialogs": [],         # [{"user": "...", "char": "..."}, ...]
        "extracted_at": None,          # last successful extraction timestamp
        "source_persona_hash": "",     # crude change-detection — skip re-extract if unchanged
    }


def _new_companion_doc(
    user_id: ObjectId,
    name: str,
    *,
    is_default: bool,
    gender: Optional[str] = None,
    relationship: Optional[str] = None,
    custom_persona: Optional[str] = None,
) -> Dict:
    now = datetime.utcnow()
    return {
        "user_id": user_id,
        "name": name or "Companion",
        "is_default": bool(is_default),
        "gender": gender,
        "relationship": relationship,
        "custom_persona": custom_persona or "",      # source persona text (legacy field — still authoritative)
        "character_card": _empty_character_card(),   # always-inject layer (extracted)
        "lorebook_entries": [],                      # keyword-triggered layer (extracted + manual)
        "extraction_status": "pending",              # pending | running | done | failed (UI polling)
        "extraction_error": None,
        "created_at": now,
        "updated_at": now,
    }


# ---------- Public API ----------

def _rehydrate_cached(doc: Dict) -> Dict:
    """Cache stores stringified ObjectIds; restore them so callers can pass
    `doc["_id"]` straight into Mongo queries without silently mismatching."""
    if not doc:
        return doc
    for k in ("_id", "user_id"):
        v = doc.get(k)
        if isinstance(v, str):
            try:
                doc[k] = ObjectId(v)
            except Exception:
                pass
    return doc


def get_companion_by_id(companion_id, user_id: ObjectId) -> Optional[Dict]:
    """Fetch by id with cache. Verifies ownership."""
    cid_str = str(companion_id)
    cached = safe_get(_cache_key(cid_str))
    if cached:
        try:
            doc = json.loads(cached)
            # Trust cache only if user_id matches (defense in depth).
            if str(doc.get("user_id")) == str(user_id):
                return _rehydrate_cached(doc)
        except Exception:
            pass

    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return None

    doc = db.db[COLLECTION].find_one({"_id": oid, "user_id": user_id})
    if doc:
        _cache_set(doc)
    return doc


def list_companions(user_id: ObjectId) -> List[Dict]:
    cur = db.db[COLLECTION].find({"user_id": user_id}).sort("created_at", 1)
    return list(cur)


def get_active_companion(user_id: ObjectId, user_doc: Optional[Dict] = None) -> Optional[Dict]:
    """
    Return the user's active companion, lazy-creating a default one from legacy
    settings when this user has none yet. Cache-first.

    If user_doc is provided, it will be reused instead of re-fetched from Mongo.
    """
    if user_doc is None:
        user_doc = db.get_user_by_id(user_id)
    if not user_doc:
        return None

    settings = user_doc.get("settings") or {}
    active_id = settings.get("active_companion_id")
    if active_id:
        comp = get_companion_by_id(active_id, user_id)
        if comp:
            return comp
        # Stale pointer — fall through to refresh.

    # Pick first existing companion if any.
    existing = list_companions(user_id)
    if existing:
        comp = existing[0]
        _set_active_companion(user_id, comp["_id"])
        return comp

    # Lazy create from legacy fields.
    return _create_default_from_legacy(user_id, settings)


def _create_default_from_legacy(user_id: ObjectId, settings: Dict) -> Dict:
    name = (
        settings.get("custom_persona_name")
        or settings.get("companion_name")
        or "Companion"
    )
    gender = (
        settings.get("custom_persona_gender")
        or settings.get("companion_gender")
    )
    relationship = settings.get("companion_relationship")
    custom_persona = settings.get("custom_persona") or ""

    doc = _new_companion_doc(
        user_id,
        name=name,
        is_default=True,
        gender=gender,
        relationship=relationship,
        custom_persona=custom_persona,
    )
    result = db.db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    _set_active_companion(user_id, doc["_id"])
    _cache_set(doc)
    log.info(f"[COMPANION] Lazy-created default companion {doc['_id']} for user {user_id}")

    # Kick off lorebook extraction in the background so the user's first chat
    # doesn't block on Gemini. The first message will fall back to legacy
    # behavior (no lorebook entries) and subsequent messages get the layered
    # prompt. Idempotent — re-runs replace entries.
    if custom_persona:
        try:
            import threading
            threading.Thread(
                target=_extract_and_save_lorebook,
                args=(doc["_id"], user_id, custom_persona, name),
                daemon=True,
            ).start()
        except Exception as e:
            log.warning(f"[COMPANION] Background extraction spawn failed: {e}")

    return doc


def _coerce_oid(val) -> Optional[ObjectId]:
    """Cache deserialization returns string ids — coerce back before queries."""
    if isinstance(val, ObjectId):
        return val
    try:
        return ObjectId(str(val))
    except Exception:
        return None


def _extract_and_save_lorebook(
    companion_id,
    user_id,
    persona_text: str,
    character_name: str,
    user_name: Optional[str] = None,
    relationship: Optional[str] = None,
) -> int:
    """
    Run LLM extraction to produce BOTH a character_card (always-inject voice
    layer) and lorebook_entries (keyword-triggered world/plot facts), and
    persist both atomically.

    Returns the number of entries written (counting card filled + lorebook
    entries) — 0 means extraction failed and existing data was kept.

    Used by:
      - Background spawn from /api/user/confirm-persona
      - Synchronous backfill script
      - Manual /re-extract endpoint
    """
    try:
        from persona_extractor import extract_persona_to_card_and_lorebook
    except Exception as e:
        log.error(f"[COMPANION] persona_extractor import failed: {e}")
        return 0

    cid = _coerce_oid(companion_id)
    uid = _coerce_oid(user_id)
    if not cid or not uid:
        log.error(f"[COMPANION] Invalid id types: companion={companion_id!r} user={user_id!r}")
        return 0

    # Mark extraction as running so the frontend status indicator can show
    # progress; cleared on success or replaced with 'failed' on error.
    db.db[COLLECTION].update_one(
        {"_id": cid, "user_id": uid},
        {"$set": {"extraction_status": "running", "extraction_error": None}},
    )
    _cache_invalidate(str(cid))

    # Augment with canonical material from a wiki/fandom page if we recognize
    # the character. This is best-effort — failures fall back to Gemini's own
    # training-data canon recall.
    canon_info = {"recognized": False, "ip": "", "wiki_url": "", "corpus": "", "from_cache": False}
    try:
        from wiki_augment import get_canon_context
        canon_info = get_canon_context(character_name)
        if canon_info.get("recognized"):
            log.info(
                f"[COMPANION] Canon context for {character_name!r}: "
                f"ip={canon_info.get('ip')!r} corpus={len(canon_info.get('corpus') or '')}c "
                f"cached={canon_info.get('from_cache')}"
            )
    except Exception as e:
        log.warning(f"[COMPANION] Canon augmentation failed (non-fatal): {e}")

    try:
        result = extract_persona_to_card_and_lorebook(
            persona_text=persona_text,
            character_name=character_name,
            user_name=user_name,
            relationship=relationship,
            canon_context=canon_info.get("corpus") or "",
        )
    except Exception as e:
        log.exception(f"[COMPANION] Extractor raised for companion {cid}: {e}")
        db.db[COLLECTION].update_one(
            {"_id": cid, "user_id": uid},
            {"$set": {"extraction_status": "failed", "extraction_error": str(e)[:300]}},
        )
        _cache_invalidate(str(cid))
        return 0

    card = result.get("character_card") or {}
    lore_entries = result.get("lorebook_entries") or []

    # The card is the load-bearing piece; if Gemini returned nothing usable
    # we keep whatever was there before. An empty lorebook is fine and common
    # (most personas describe personality, not plot/world).
    if not card.get("identity") and not card.get("personality_brief"):
        log.warning(f"[COMPANION] Extraction returned empty card for companion {cid} — keeping existing")
        db.db[COLLECTION].update_one(
            {"_id": cid, "user_id": uid},
            {"$set": {"extraction_status": "failed", "extraction_error": "empty_card"}},
        )
        _cache_invalidate(str(cid))
        return 0

    import hashlib
    persona_hash = hashlib.sha256((persona_text or "").encode("utf-8")).hexdigest()[:16]
    card["extracted_at"] = datetime.utcnow()
    card["source_persona_hash"] = persona_hash
    # Stash canon recognition info on the card for diagnostics + UI display
    card["canon_recognized"] = bool(result.get("canon_recognized"))
    card["canon_ip"] = (result.get("canon_ip") or "")
    if canon_info.get("wiki_url"):
        card["canon_wiki_url"] = canon_info.get("wiki_url")

    try:
        update_result = db.db[COLLECTION].update_one(
            {"_id": cid, "user_id": uid},
            {
                "$set": {
                    "character_card": card,
                    "lorebook_entries": lore_entries,
                    "extraction_status": "done",
                    "extraction_error": None,
                    "updated_at": datetime.utcnow(),
                    "lorebook_extracted_at": datetime.utcnow(),
                }
            },
        )
        if update_result.matched_count == 0:
            log.warning(f"[COMPANION] Update matched 0 docs (companion={cid} user={uid}) — extraction lost")
            return 0
        _cache_invalidate(str(cid))
        log.info(
            f"[COMPANION] Saved character_card + {len(lore_entries)} lorebook entries to companion {cid} "
            f"(card identity={card.get('identity', '')[:40]!r}, dialogs={len(card.get('example_dialogs') or [])})"
        )
        return len(lore_entries) + 1  # +1 to indicate the card itself was written
    except Exception as e:
        log.warning(f"[COMPANION] Failed to persist extraction: {e}")
        db.db[COLLECTION].update_one(
            {"_id": cid, "user_id": uid},
            {"$set": {"extraction_status": "failed", "extraction_error": str(e)[:300]}},
        )
        _cache_invalidate(str(cid))
        return 0


def re_extract_lorebook(
    user_id: ObjectId,
    persona_text: Optional[str] = None,
    *,
    user_name: Optional[str] = None,
    background: bool = True,
) -> None:
    """
    Trigger lorebook re-extraction for the user's active companion. Called
    from /api/user/confirm-persona and similar persona-update endpoints.

    Background mode (default) — fire-and-forget so the HTTP response isn't
    blocked by the LLM call. Set background=False for the backfill script
    where serialization is desired.
    """
    user_doc = db.get_user_by_id(user_id)
    if not user_doc:
        return
    settings = user_doc.get("settings") or {}
    if persona_text is None:
        persona_text = settings.get("custom_persona") or ""
    if not persona_text or len(persona_text.strip()) < 30:
        return

    companion = get_active_companion(user_id, user_doc=user_doc)
    if not companion:
        return

    name = (
        settings.get("custom_persona_name")
        or settings.get("companion_name")
        or companion.get("name")
        or "Companion"
    )
    relationship = settings.get("companion_relationship")

    def _run():
        _extract_and_save_lorebook(
            companion["_id"],
            user_id,
            persona_text,
            name,
            user_name=user_name,
            relationship=relationship,
        )

    if background:
        try:
            import threading
            threading.Thread(target=_run, daemon=True).start()
        except Exception as e:
            log.warning(f"[COMPANION] re_extract spawn failed: {e}")
    else:
        _run()


def _set_active_companion(user_id: ObjectId, companion_id: ObjectId) -> None:
    db.db["users"].update_one(
        {"_id": user_id},
        {"$set": {"settings.active_companion_id": str(companion_id), "updated_at": datetime.utcnow()}},
    )


def create_companion(
    user_id: ObjectId,
    name: str,
    *,
    gender: Optional[str] = None,
    relationship: Optional[str] = None,
    custom_persona: Optional[str] = None,
    set_active: bool = False,
) -> Dict:
    doc = _new_companion_doc(
        user_id,
        name=name,
        is_default=False,
        gender=gender,
        relationship=relationship,
        custom_persona=custom_persona,
    )
    result = db.db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    if set_active:
        _set_active_companion(user_id, doc["_id"])
    _cache_set(doc)
    return doc


def update_companion(
    companion_id,
    user_id: ObjectId,
    fields: Dict,
) -> Optional[Dict]:
    allowed = {"name", "gender", "relationship", "custom_persona"}
    update = {k: v for k, v in (fields or {}).items() if k in allowed}
    if not update:
        return get_companion_by_id(companion_id, user_id)
    update["updated_at"] = datetime.utcnow()

    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return None
    db.db[COLLECTION].update_one(
        {"_id": oid, "user_id": user_id},
        {"$set": update},
    )
    _cache_invalidate(str(oid))
    return db.db[COLLECTION].find_one({"_id": oid, "user_id": user_id})


def delete_companion(companion_id, user_id: ObjectId) -> bool:
    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return False
    result = db.db[COLLECTION].delete_one({"_id": oid, "user_id": user_id, "is_default": False})
    _cache_invalidate(str(oid))
    return result.deleted_count > 0


# ---------- Lorebook entry CRUD ----------

def add_lorebook_entry(
    companion_id,
    user_id: ObjectId,
    *,
    keys: List[str],
    content: str,
    title: str = "",
    secondary_keys: Optional[List[str]] = None,
    selective_logic: str = "and_any",
    strategy: str = "selective",
    insertion_order: int = 100,
    insertion_position: str = "after_char_defs",
    probability: int = 100,
    sticky: int = 0,
    cooldown: int = 0,
    delay: int = 0,
    enabled: bool = True,
    source: str = "manual",
) -> Optional[Dict]:
    is_constant = (strategy == "constant")
    if not keys and not is_constant:
        # A non-constant entry with no keys would never fire — reject.
        return None
    if not content:
        return None

    entry = _new_lorebook_entry(
        keys=keys,
        content=content,
        title=title,
        secondary_keys=secondary_keys,
        selective_logic=selective_logic,
        strategy=strategy,
        insertion_order=insertion_order,
        insertion_position=insertion_position,
        probability=probability,
        sticky=sticky,
        cooldown=cooldown,
        delay=delay,
        enabled=enabled,
        source=source,
    )

    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return None

    result = db.db[COLLECTION].update_one(
        {"_id": oid, "user_id": user_id},
        {
            "$push": {"lorebook_entries": entry},
            "$set": {"updated_at": datetime.utcnow()},
        },
    )
    if result.modified_count == 0:
        return None
    _cache_invalidate(str(oid))
    return entry


def update_lorebook_entry(
    companion_id,
    user_id: ObjectId,
    entry_id: str,
    fields: Dict,
) -> Optional[Dict]:
    allowed = {
        "title", "keys", "secondary_keys", "content", "selective_logic",
        "strategy", "insertion_order", "insertion_position",
        "probability", "sticky", "cooldown", "delay", "enabled",
    }
    set_ops = {}
    for k, v in (fields or {}).items():
        if k not in allowed:
            continue
        if k in ("keys", "secondary_keys"):
            set_ops[f"lorebook_entries.$.{k}"] = [s.strip() for s in (v or []) if s and s.strip()]
        elif k in ("insertion_order", "probability"):
            set_ops[f"lorebook_entries.$.{k}"] = max(0, min(1000 if k == "insertion_order" else 100, int(v)))
        elif k in ("sticky", "cooldown", "delay"):
            set_ops[f"lorebook_entries.$.{k}"] = max(0, int(v))
        elif k == "selective_logic":
            set_ops[f"lorebook_entries.$.selective_logic"] = (
                v if v in ("and_any", "and_all", "not_any", "not_all") else "and_any"
            )
        elif k == "strategy":
            set_ops[f"lorebook_entries.$.strategy"] = (
                v if v in ("constant", "selective", "vectorized") else "selective"
            )
        elif k == "insertion_position":
            set_ops[f"lorebook_entries.$.insertion_position"] = v if v in (
                "before_char_defs", "after_char_defs",
                "before_example", "after_example",
                "top_an", "bottom_an", "at_depth",
            ) else "after_char_defs"
        elif k == "enabled":
            set_ops[f"lorebook_entries.$.enabled"] = bool(v)
        else:
            set_ops[f"lorebook_entries.$.{k}"] = v
    if not set_ops:
        return None
    set_ops["lorebook_entries.$.updated_at"] = datetime.utcnow()

    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return None

    set_ops["updated_at"] = datetime.utcnow()
    result = db.db[COLLECTION].update_one(
        {"_id": oid, "user_id": user_id, "lorebook_entries.id": entry_id},
        {"$set": set_ops},
    )
    if result.modified_count == 0:
        return None
    _cache_invalidate(str(oid))
    doc = db.db[COLLECTION].find_one(
        {"_id": oid, "user_id": user_id, "lorebook_entries.id": entry_id},
        {"lorebook_entries.$": 1},
    )
    return (doc or {}).get("lorebook_entries", [None])[0]


def delete_lorebook_entry(companion_id, user_id: ObjectId, entry_id: str) -> bool:
    try:
        oid = ObjectId(companion_id) if not isinstance(companion_id, ObjectId) else companion_id
    except Exception:
        return False
    result = db.db[COLLECTION].update_one(
        {"_id": oid, "user_id": user_id},
        {
            "$pull": {"lorebook_entries": {"id": entry_id}},
            "$set": {"updated_at": datetime.utcnow()},
        },
    )
    if result.modified_count > 0:
        _cache_invalidate(str(oid))
        return True
    return False
