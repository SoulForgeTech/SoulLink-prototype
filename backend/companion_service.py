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
    priority: int = 50,
    selective_logic: str = "any",
    constant: bool = False,
    enabled: bool = True,
) -> Dict:
    return {
        "id": str(uuid.uuid4()),
        "keys": [k.strip() for k in (keys or []) if k and k.strip()],
        "content": (content or "").strip(),
        "priority": max(0, min(100, int(priority))),
        "selective_logic": selective_logic if selective_logic in ("any", "all") else "any",
        "constant": bool(constant),
        "enabled": bool(enabled),
        "created_at": datetime.utcnow(),
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
        "custom_persona": custom_persona or "",  # legacy fallback text
        "lorebook_entries": [],
        "example_dialogs": [],  # placeholder for Layer 3
        "created_at": now,
        "updated_at": now,
    }


# ---------- Public API ----------

def get_companion_by_id(companion_id, user_id: ObjectId) -> Optional[Dict]:
    """Fetch by id with cache. Verifies ownership."""
    cid_str = str(companion_id)
    cached = safe_get(_cache_key(cid_str))
    if cached:
        try:
            doc = json.loads(cached)
            # Trust cache only if user_id matches (defense in depth).
            if str(doc.get("user_id")) == str(user_id):
                return doc
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


def _extract_and_save_lorebook(
    companion_id: ObjectId,
    user_id: ObjectId,
    persona_text: str,
    character_name: str,
    user_name: Optional[str] = None,
    relationship: Optional[str] = None,
) -> int:
    """
    Run LLM extraction and replace the companion's lorebook_entries with the
    result. Returns the number of entries written. On failure (Gemini error,
    parse error, no valid entries), keeps existing entries intact and returns 0.

    Used both for background-spawned extraction during companion creation and
    for the synchronous backfill script.
    """
    try:
        from persona_extractor import (
            extract_lorebook_from_persona,
            build_core_identity_entry,
        )
    except Exception as e:
        log.error(f"[COMPANION] persona_extractor import failed: {e}")
        return 0

    extracted = extract_lorebook_from_persona(persona_text, character_name=character_name)
    if not extracted:
        log.info(f"[COMPANION] Extraction yielded 0 entries for companion {companion_id} — keeping existing")
        return 0

    # Always prepend a synthesized core-identity entry regardless of what the
    # LLM produced — anchors role identity in every reply.
    core = build_core_identity_entry(
        companion_name=character_name,
        user_name=user_name,
        relationship=relationship,
    )
    final_entries = [core] + extracted

    try:
        db.db[COLLECTION].update_one(
            {"_id": companion_id, "user_id": user_id},
            {
                "$set": {
                    "lorebook_entries": final_entries,
                    "updated_at": datetime.utcnow(),
                    "lorebook_extracted_at": datetime.utcnow(),
                }
            },
        )
        _cache_invalidate(str(companion_id))
        log.info(f"[COMPANION] Saved {len(final_entries)} lorebook entries to companion {companion_id}")
        return len(final_entries)
    except Exception as e:
        log.warning(f"[COMPANION] Failed to persist extracted lorebook: {e}")
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
    priority: int = 50,
    selective_logic: str = "any",
    constant: bool = False,
    enabled: bool = True,
) -> Optional[Dict]:
    if not keys and not constant:
        # A non-constant entry with no keys would never fire — reject.
        return None
    if not content:
        return None

    entry = _new_lorebook_entry(
        keys=keys,
        content=content,
        priority=priority,
        selective_logic=selective_logic,
        constant=constant,
        enabled=enabled,
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
    allowed = {"keys", "content", "priority", "selective_logic", "constant", "enabled"}
    set_ops = {}
    for k, v in (fields or {}).items():
        if k not in allowed:
            continue
        if k == "keys":
            set_ops[f"lorebook_entries.$.keys"] = [s.strip() for s in (v or []) if s and s.strip()]
        elif k == "priority":
            set_ops[f"lorebook_entries.$.priority"] = max(0, min(100, int(v)))
        elif k == "selective_logic":
            set_ops[f"lorebook_entries.$.selective_logic"] = v if v in ("any", "all") else "any"
        elif k in ("constant", "enabled"):
            set_ops[f"lorebook_entries.$.{k}"] = bool(v)
        else:
            set_ops[f"lorebook_entries.$.{k}"] = v
    if not set_ops:
        return None

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
