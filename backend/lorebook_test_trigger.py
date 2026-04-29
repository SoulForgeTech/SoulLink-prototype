"""
Dev tool — simulate a single lorebook trigger pass for a user/message pair.

Frontend has no lorebook UI by design, so users can't directly verify which
entries fire on a given message. This script lets you ssh to EC2 and ask:
"if user X said Y, what entries would fire and what would get injected?"

Usage (on EC2):
  cd /home/ubuntu/soullink-backend/backend
  source ../venv/bin/activate
  set -a && source .env && set +a

  # By user_id (uses their active companion):
  python3 lorebook_test_trigger.py --user-id 6976c509ed03548169910819 \
      --message "你又在嫉妒了？"

  # By companion name (resolves to first matching companion):
  python3 lorebook_test_trigger.py --companion "芙宁娜" \
      --message "我今天遇到一个超帅的男生"

  # With recent history (multiline scan window, --history repeatable):
  python3 lorebook_test_trigger.py --user-id ... --message "怎么了" \
      --history "我有点不开心" --history "今天工作很累"

Output: per-entry hit detail + the injected [Character knowledge] block as it
would appear in the chat prompt.
"""

import argparse
import logging
import os
import sys

logging.basicConfig(
    level=logging.WARNING,  # silence the routine [LOREBOOK] info log; we print our own
    format="%(asctime)s [%(levelname)s] %(message)s",
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", help="User _id (ObjectId hex)")
    parser.add_argument("--companion", help="Companion name (alternative to --user-id)")
    parser.add_argument("--message", required=True, help="The user's chat message")
    parser.add_argument("--history", action="append", default=[],
                        help="Prior turn text (repeatable, oldest first)")
    parser.add_argument("--budget", type=int, default=1200,
                        help="Token budget for selection (default 1200)")
    args = parser.parse_args()

    if not args.user_id and not args.companion:
        parser.error("provide --user-id or --companion")

    from bson import ObjectId
    from database import db
    from lorebook_engine import select_lorebook, format_lorebook_block

    db.connect()

    if args.user_id:
        try:
            uid = ObjectId(args.user_id)
        except Exception:
            print(f"ERROR: invalid user-id {args.user_id!r}")
            sys.exit(1)
        comp = db.db["companions"].find_one({"user_id": uid})
        if not comp:
            print(f"ERROR: no companion for user {args.user_id}")
            sys.exit(1)
    else:
        comp = db.db["companions"].find_one({"name": args.companion})
        if not comp:
            print(f"ERROR: no companion named {args.companion!r}")
            sys.exit(1)

    name = comp.get("name", "(unknown)")
    entries = comp.get("lorebook_entries") or []

    print(f"=== Companion: {name} (id={comp['_id']}) ===")
    print(f"Total entries in lorebook: {len(entries)}")
    print(f"User message: {args.message!r}")
    if args.history:
        print(f"History context ({len(args.history)} turns):")
        for h in args.history:
            print(f"  - {h!r}")
    print()

    selected, used = select_lorebook(
        user_message=args.message,
        history_texts=args.history,
        entries=entries,
        last_hit_ids=[],  # no recency context for one-shot test
        budget_tokens=args.budget,
    )

    if not selected:
        print(f"❌ No entries fired (token budget {args.budget} unused).")
        print()
        print("Possible reasons:")
        print("  - This message contains no keys present in any entry's `keys` array")
        print("  - Try adding more synonyms to the relevant entry, or rephrase the test message")
        print()
        print("Inspect entry keys with:")
        print(f"  python3 -c \"import sys;sys.path.insert(0,'.');from database import db;db.connect();c=db.db['companions'].find_one({{'_id':__import__('bson').ObjectId('{comp['_id']}')}});[print(e.get('keys')) for e in c['lorebook_entries']]\"")
        sys.exit(0)

    print(f"✓ {len(selected)} entries fired (used {used}/{args.budget} tokens)")
    print()
    for i, e in enumerate(selected, 1):
        dim = e.get("dimension", "-")
        reason = e.get("_match_reason", "?")
        priority = e.get("priority", 50)
        eff = e.get("_eff_priority", priority)
        bonus_marker = f" (+{eff - priority} recency)" if eff != priority else ""
        if reason == "constant":
            label = "[CONSTANT]"
        else:
            mk = e.get("_matched_keys") or []
            label = f"matched keys: {mk}"
        title = (e.get("keys") or [""])[0] or dim
        content = (e.get("content") or "").strip()
        print(f"  {i}. [{dim:22}] priority={priority}{bonus_marker} {label}")
        print(f"     title: {title}")
        print(f"     content: {content}")
        print()

    print("=== Injected block (as appears in chat prompt) ===")
    print(format_lorebook_block(selected))


if __name__ == "__main__":
    main()
