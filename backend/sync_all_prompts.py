#!/usr/bin/env python3
"""Sync system prompts for ALL users to their AnythingLLM workspaces."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from database import db
from workspace_manager import WorkspaceManager

wm = WorkspaceManager()

# 获取所有有 workspace 的用户
workspaces = list(db.db["workspaces"].find({}))
print(f"Found {len(workspaces)} workspaces in MongoDB")

success = 0
failed = 0
skipped = 0

for ws in workspaces:
    user_id = ws["user_id"]
    slug = ws.get("slug", "?")

    user = db.db["users"].find_one({"_id": user_id})
    if not user:
        print(f"  SKIP {slug} — user not found")
        skipped += 1
        continue

    name = user.get("name", "Friend")
    email = user.get("email", "?")

    try:
        result = wm.update_system_prompt(user_id, name)
        if result.get("success"):
            print(f"  OK   {slug} ({email})")
            success += 1
        else:
            print(f"  FAIL {slug} ({email}) — {result.get('error')}")
            failed += 1
    except Exception as e:
        print(f"  ERR  {slug} ({email}) — {e}")
        failed += 1

print(f"\nDone! success={success}, failed={failed}, skipped={skipped}")
