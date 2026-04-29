"""
After backfill_lorebook.py rebuilds character_cards in Mongo, run this to
push the updated system prompt (now containing the character_card block) to
each user's AnythingLLM workspace. Without this step the new card data sits
in Mongo unused, because chat goes through AnythingLLM which caches the
system prompt at workspace-update time.

Usage (on EC2):
  cd /home/ubuntu/soullink-backend/backend
  source ../venv/bin/activate
  set -a && source .env && set +a
  python3 push_workspace_cards.py            # dry run
  python3 push_workspace_cards.py --apply    # actually push
  python3 push_workspace_cards.py --apply --user-id <oid>  # one user
"""

import argparse
import logging
import os
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("push_cards")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="Actually push (default: dry-run)")
    p.add_argument("--user-id", help="Process only this user (for testing)")
    p.add_argument("--limit", type=int, default=0, help="Stop after N users (0=no limit)")
    args = p.parse_args()

    from database import db
    from workspace_manager import workspace_manager

    db.connect()

    query = {"settings.custom_persona": {"$nin": [None, ""]}}
    if args.user_id:
        from bson import ObjectId
        query["_id"] = ObjectId(args.user_id)

    users = list(db.db["users"].find(query, {"_id": 1, "name": 1}))
    log.info(f"Found {len(users)} users with custom_persona to refresh")
    if not args.apply:
        log.warning("DRY RUN — no pushes. Pass --apply to actually push.")

    pushed = 0
    failed = 0
    skipped = 0
    for i, u in enumerate(users, 1):
        if args.limit and pushed + failed >= args.limit:
            break
        uid = u["_id"]
        name = u.get("name") or "Friend"
        log.info(f"[{i}/{len(users)}] user={uid} name={name!r}")

        if not args.apply:
            log.info("  [dry-run] would push system prompt")
            skipped += 1
            continue

        try:
            result = workspace_manager.update_system_prompt(uid, name)
            if result.get("success"):
                pushed += 1
                log.info("  ✓ pushed")
            else:
                failed += 1
                log.warning(f"  ✗ failed: {result.get('error')}")
        except Exception as e:
            failed += 1
            log.exception(f"  ✗ exception: {e}")

        # Throttle so we don't hammer AnythingLLM
        time.sleep(0.2)

    log.info("")
    log.info(f"Done. pushed={pushed} failed={failed} skipped={skipped}")


if __name__ == "__main__":
    main()
