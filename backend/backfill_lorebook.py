"""
One-shot backfill: scan all users with legacy custom_persona text and run the
LLM extractor for each, populating their default companion's lorebook_entries.

Idempotent — safe to re-run. If a companion already has entries with a recent
lorebook_extracted_at, the user is skipped unless --force is passed. Each user
is processed serially to avoid thrashing Gemini's rate limit; expect ~3-5s per
user with a healthy persona text.

Usage (on EC2):
  cd /home/ubuntu/soullink-backend/backend
  source ../venv/bin/activate
  set -a && source .env && set +a
  python3 backfill_lorebook.py            # dry run
  python3 backfill_lorebook.py --apply    # actually write
  python3 backfill_lorebook.py --apply --force   # re-extract even if already done
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("backfill")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write to Mongo (default: dry run)")
    parser.add_argument("--force", action="store_true", help="Re-extract even if already extracted")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N users (0 = no limit)")
    parser.add_argument("--user-id", help="Process only this user_id (for testing)")
    args = parser.parse_args()

    from database import db
    from companion_service import (
        get_active_companion,
        _extract_and_save_lorebook,
    )

    db.connect()

    query = {"settings.custom_persona": {"$nin": [None, ""]}}
    if args.user_id:
        from bson import ObjectId
        query["_id"] = ObjectId(args.user_id)

    cursor = db.db["users"].find(query, {
        "_id": 1, "name": 1, "settings": 1,
    })
    users = list(cursor)
    log.info(f"Found {len(users)} users with legacy custom_persona")

    if not args.apply:
        log.warning("DRY RUN — no writes. Pass --apply to actually extract.")

    processed = 0
    extracted_total = 0
    skipped_already = 0
    failed = 0

    for u in users:
        if args.limit and processed >= args.limit:
            break
        uid = u["_id"]
        settings = u.get("settings") or {}
        persona = (settings.get("custom_persona") or "").strip()
        if len(persona) < 30:
            continue
        name = (
            settings.get("custom_persona_name")
            or settings.get("companion_name")
            or "Companion"
        )
        user_name = u.get("name") or "Friend"
        relationship = settings.get("companion_relationship")

        log.info(f"[{processed + 1}/{len(users)}] user={uid} character={name!r} persona_len={len(persona)}")

        # Trigger lazy companion creation if needed.
        companion = get_active_companion(uid, user_doc=u)
        if not companion:
            log.warning(f"  no companion for user {uid} — skipping")
            failed += 1
            processed += 1
            continue

        # Skip already-extracted unless --force.
        if not args.force and companion.get("lorebook_extracted_at"):
            log.info(f"  already extracted at {companion.get('lorebook_extracted_at')} — skipping (--force to override)")
            skipped_already += 1
            processed += 1
            continue

        if not args.apply:
            log.info("  [dry-run] would extract")
            processed += 1
            continue

        try:
            count = _extract_and_save_lorebook(
                companion["_id"], uid, persona, name,
                user_name=user_name, relationship=relationship,
            )
            if count > 0:
                log.info(f"  ✓ extracted {count} entries")
                extracted_total += count
            else:
                log.warning(f"  ✗ extraction yielded 0 entries (kept existing)")
                failed += 1
        except Exception as e:
            log.exception(f"  ✗ extraction error: {e}")
            failed += 1

        processed += 1
        # Light throttle so we don't hammer Gemini's rate limits.
        time.sleep(0.5)

    log.info("")
    log.info(f"Done. processed={processed} extracted_total={extracted_total} skipped={skipped_already} failed={failed}")
    if not args.apply:
        log.info("(this was a dry run — re-run with --apply to actually write)")


if __name__ == "__main__":
    main()
