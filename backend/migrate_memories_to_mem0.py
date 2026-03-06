"""
一次性迁移脚本：MongoDB users.memory → Mem0 (Qdrant)
运行: cd /home/ubuntu/soullink-backend && python migrate_memories_to_mem0.py

注意：
  - 迁移前确保 MEM0_ENABLED=false（不要在迁移期间启用新系统）
  - 迁移完成后再设 MEM0_ENABLED=true
  - MongoDB 原数据不会被修改，保留作为备份
"""

import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

from database import db
from mem0_engine import _get_mem0, _classify_tier, _calculate_expiry, _is_junk_memory


def migrate():
    m = _get_mem0()
    users = list(db.db["users"].find({"memory": {"$exists": True}}))
    print(f"Found {len(users)} users with memories\n")

    total_migrated = 0
    total_skipped = 0

    for user in users:
        uid = str(user["_id"])
        user_name = user.get("name", "unknown")
        memory = user.get("memory", {})

        user_count = 0
        for tier in ["permanent", "long_term", "short_term"]:
            for item in memory.get(tier, []):
                fact = item.get("fact", "").strip()
                if not fact:
                    continue

                # 跳过垃圾记忆
                if _is_junk_memory(fact):
                    print(f"  [SKIP-JUNK] {fact}")
                    total_skipped += 1
                    continue

                # 计算过期时间
                expires_at = _calculate_expiry(tier)

                try:
                    # 用 "Remember this" 格式让 Mem0 存储原始事实
                    m.add(
                        messages=[{"role": "user", "content": f"Remember: {fact}"}],
                        user_id=uid,
                        metadata={
                            "tier": tier,
                            "expires_at": expires_at,
                            "source": "migration",
                            "migrated_at": datetime.utcnow().isoformat(),
                        }
                    )
                    user_count += 1
                    total_migrated += 1
                    print(f"  [{tier}] {fact}")
                except Exception as e:
                    print(f"  [ERROR] {fact} — {e}")
                    total_skipped += 1

        print(f"✓ {user_name} ({uid}) — {user_count} memories migrated\n")

    print(f"{'='*50}")
    print(f"Migration complete!")
    print(f"  Migrated: {total_migrated}")
    print(f"  Skipped:  {total_skipped}")
    print(f"\nNext steps:")
    print(f"  1. Verify: python -c \"from mem0_engine import _get_mem0; m = _get_mem0(); print(m.get_all(user_id='<test_user_id>'))\"")
    print(f"  2. Set MEM0_ENABLED=true in .env")
    print(f"  3. sudo systemctl restart soullink-backend")


if __name__ == "__main__":
    migrate()
