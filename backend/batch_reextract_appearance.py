"""
重新提取所有用户的 image_appearance（使用更新后的 prompt）。
旧的提取包含夸张词汇，导致生成的图片不自然。
在服务器上运行: cd /home/ubuntu/soullink-backend/backend && /home/ubuntu/soullink-backend/venv/bin/python3 batch_reextract_appearance.py
"""
import os
import sys
import time
from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient

MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB", "soullink")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# 找出所有有 custom_persona 的用户（不管有没有 image_appearance，全部重新提取）
users = []
for u in db["users"].find({}, {"_id": 1, "name": 1, "settings": 1}):
    s = u.get("settings") or {}
    cp = s.get("custom_persona")
    if cp and isinstance(cp, str) and len(cp) > 5:
        users.append(u)

print(f"=== Found {len(users)} users with custom_persona — will RE-EXTRACT all ===")
for u in users:
    s = u.get("settings", {})
    pname = s.get("custom_persona_name") or "N/A"
    old_ia = s.get("image_appearance") or "EMPTY"
    print(f"  {u['name']} | persona_name={pname} | old_appearance: {old_ia[:80]}...")

if not users:
    print("No users with custom_persona found!")
    sys.exit(0)

confirm = input(f"\nRe-extract appearance for {len(users)} users? (y/n): ")
if confirm.lower() != 'y':
    print("Aborted.")
    sys.exit(0)

# 导入 Gemini 提取函数和清理函数
from image_gen import _extract_appearance_from_persona, _clean_image_prompt

success = 0
failed = 0
for u in users:
    s = u.get("settings", {})
    uname = u.get("name", "?")
    pname = s.get("custom_persona_name") or ""
    persona = s.get("custom_persona", "")

    print(f"\n--- Re-extracting for {uname} (character: {pname or 'N/A'}) ---")
    print(f"  Persona preview: {persona[:80]}...")

    appearance = _extract_appearance_from_persona(persona)
    if appearance and len(appearance) > 10:
        # 清理夸张形容词
        appearance = _clean_image_prompt(appearance)

        # Inject source name if not already present
        if pname and pname.lower() not in appearance.lower():
            appearance = pname + ". " + appearance

        db["users"].update_one(
            {"_id": u["_id"]},
            {"$set": {"settings.image_appearance": appearance}}
        )
        print(f"  OK: {appearance[:160]}")
        success += 1
    else:
        print(f"  FAIL: empty result")
        failed += 1

    # Rate limit
    time.sleep(1)

print(f"\n=== Done! Success: {success}, Failed: {failed} ===")
