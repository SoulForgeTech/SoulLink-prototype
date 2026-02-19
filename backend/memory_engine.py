"""
SoulLink Memory Engine — 三层记忆系统
从对话中异步提取关键信息，存入 MongoDB，注入 system prompt。

记忆层级:
  permanent (≤10) — 身份/家人/宠物/职业等，永不自动删除
  long_term (≤15) — 重要经历/偏好/习惯，90 天淡化
  short_term (≤5)  — 近期事件/临时情绪，14 天过期
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from bson import ObjectId

logger = logging.getLogger(__name__)

# ==================== 配置 ====================

MAX_PERMANENT = 10
MAX_LONG_TERM = 15
MAX_SHORT_TERM = 5
SHORT_TERM_DAYS = 14
LONG_TERM_DAYS = 90
SYNC_EVERY_N = 5  # 每 N 次提取同步一次 system prompt

EXTRACTION_PROMPT = """You are a memory extraction assistant. Extract key facts worth remembering from this conversation between a user and their AI companion.

User message: {user_msg}
AI reply: {ai_reply}

User's existing memories:
{existing_summary}

Rules:
1. Only extract genuinely useful NEW information. Skip pure chitchat.
2. If the user corrects or updates old info (e.g. "I changed jobs"), output an update.
3. Keep each fact SHORT (under 20 words), in the SAME language as the user's message.
4. Categories:
   - permanent: identity, family, pets, job, hometown, birthday, real name — things that rarely change
   - long_term: hobbies, preferences, important experiences, relationships, habits
   - short_term: recent events, current mood, temporary plans

Return ONLY valid JSON (no markdown, no explanation):
{{"new_memories": [{{"fact": "...", "type": "permanent|long_term|short_term"}}], "updates": [{{"old_fact": "exact old fact text", "new_fact": "updated text"}}]}}

If nothing worth remembering, return: {{"new_memories": [], "updates": []}}"""


# ==================== Gemini API 调用 ====================

_gemini_model = None


def _get_gemini_model():
    """延迟初始化 Gemini 模型"""
    global _gemini_model
    if _gemini_model is None:
        try:
            import google.generativeai as genai
            api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
            if not api_key:
                logger.error("[MEMORY] GOOGLE_GEMINI_API_KEY not set in .env")
                return None
            genai.configure(api_key=api_key)
            _gemini_model = genai.GenerativeModel("gemini-2.5-flash")
            logger.info("[MEMORY] Gemini model initialized")
        except Exception as e:
            logger.error(f"[MEMORY] Failed to init Gemini: {e}")
            return None
    return _gemini_model


def _call_gemini(prompt: str) -> Optional[str]:
    """调用 Gemini API 返回文本响应"""
    model = _get_gemini_model()
    if not model:
        return None
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        logger.warning(f"[MEMORY] Gemini API error: {e}")
        return None


# ==================== 记忆提取 ====================

def extract_memories(user_msg: str, ai_reply: str, existing_memory: Dict) -> Optional[Dict]:
    """
    从一轮对话中提取新记忆和更新。
    返回 {"new_memories": [...], "updates": [...]} 或 None（提取失败）
    """
    # 构建已有记忆摘要给 LLM 参考（避免重复提取）
    existing_summary = _summarize_existing(existing_memory)

    prompt = EXTRACTION_PROMPT.format(
        user_msg=user_msg,
        ai_reply=ai_reply,
        existing_summary=existing_summary or "(none yet)"
    )

    raw = _call_gemini(prompt)
    if not raw:
        return None

    # 清理可能的 markdown 包裹
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]  # 去掉第一行 ```json
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        result = json.loads(text)
        # 验证结构
        if "new_memories" not in result:
            result["new_memories"] = []
        if "updates" not in result:
            result["updates"] = []
        return result
    except json.JSONDecodeError as e:
        logger.warning(f"[MEMORY] JSON parse error: {e}, raw: {text[:200]}")
        return None


def _summarize_existing(memory: Dict) -> str:
    """将已有记忆转成简短摘要供 LLM 参考"""
    lines = []
    for layer in ["permanent", "long_term", "short_term"]:
        for item in memory.get(layer, []):
            lines.append(f"- [{layer}] {item['fact']}")
    return "\n".join(lines) if lines else ""


# ==================== 记忆合并 ====================

def merge_memories(existing: Dict, extracted: Dict) -> tuple:
    """
    合并新提取的记忆到已有记忆中。
    返回 (updated_memory, has_changes)
    """
    now = datetime.utcnow()
    has_changes = False

    # 确保结构完整
    for layer in ["permanent", "long_term", "short_term"]:
        if layer not in existing:
            existing[layer] = []

    # 1. 处理更新（替换已有记忆）
    for update in extracted.get("updates", []):
        old_fact = update.get("old_fact", "").strip()
        new_fact = update.get("new_fact", "").strip()
        if not old_fact or not new_fact:
            continue

        found = False
        for layer in ["permanent", "long_term", "short_term"]:
            for item in existing[layer]:
                if item["fact"].strip() == old_fact:
                    item["fact"] = new_fact
                    item["updated_at"] = now
                    found = True
                    has_changes = True
                    logger.info(f"[MEMORY] Updated: '{old_fact}' → '{new_fact}'")
                    break
            if found:
                break

    # 2. 添加新记忆
    for mem in extracted.get("new_memories", []):
        fact = mem.get("fact", "").strip()
        mem_type = mem.get("type", "short_term")
        if not fact:
            continue

        # 检查重复
        if _is_duplicate(existing, fact):
            continue

        # 确保 type 有效
        if mem_type not in ("permanent", "long_term", "short_term"):
            mem_type = "short_term"

        entry = {"fact": fact, "created_at": now, "updated_at": now}

        # 检查上限
        layer = existing[mem_type]
        max_size = {"permanent": MAX_PERMANENT, "long_term": MAX_LONG_TERM, "short_term": MAX_SHORT_TERM}[mem_type]

        if len(layer) >= max_size:
            if mem_type == "permanent":
                logger.warning(f"[MEMORY] Permanent memory full ({MAX_PERMANENT}), skipping: {fact}")
                continue
            else:
                # 删除最旧的
                layer.sort(key=lambda x: x.get("updated_at", x.get("created_at", now)))
                removed = layer.pop(0)
                logger.info(f"[MEMORY] Evicted oldest {mem_type}: '{removed['fact']}'")

        layer.append(entry)
        has_changes = True
        logger.info(f"[MEMORY] Added [{mem_type}]: '{fact}'")

    return existing, has_changes


def _is_duplicate(memory: Dict, new_fact: str) -> bool:
    """简单文本匹配检查重复"""
    new_lower = new_fact.lower().strip()
    for layer in ["permanent", "long_term", "short_term"]:
        for item in memory.get(layer, []):
            if item["fact"].lower().strip() == new_lower:
                return True
    return False


# ==================== 过期清理 ====================

def cleanup_expired(memory: Dict) -> Dict:
    """清理过期的 short_term 和 long_term 记忆"""
    now = datetime.utcnow()

    # short_term: 14 天过期
    if "short_term" in memory:
        cutoff = now - timedelta(days=SHORT_TERM_DAYS)
        before = len(memory["short_term"])
        memory["short_term"] = [
            m for m in memory["short_term"]
            if m.get("updated_at", m.get("created_at", now)) > cutoff
        ]
        removed = before - len(memory["short_term"])
        if removed > 0:
            logger.info(f"[MEMORY] Cleaned {removed} expired short_term memories")

    # long_term: 90 天过期
    if "long_term" in memory:
        cutoff = now - timedelta(days=LONG_TERM_DAYS)
        before = len(memory["long_term"])
        memory["long_term"] = [
            m for m in memory["long_term"]
            if m.get("updated_at", m.get("created_at", now)) > cutoff
        ]
        removed = before - len(memory["long_term"])
        if removed > 0:
            logger.info(f"[MEMORY] Cleaned {removed} expired long_term memories")

    return memory


# ==================== 记忆文本生成（注入 prompt） ====================

def build_memory_text(memory: Dict) -> str:
    """
    将记忆转成简洁文本块，用于注入 system prompt 的 {{memory}} 占位符。
    如果没有记忆返回空字符串。
    """
    lines = []

    for item in memory.get("permanent", []):
        lines.append(f"- {item['fact']}")
    for item in memory.get("long_term", []):
        lines.append(f"- {item['fact']}")
    for item in memory.get("short_term", []):
        lines.append(f"- {item['fact']}")

    if not lines:
        return ""

    header = "# 关于用户的记忆 / Memories about the user\n以下是你记住的关于用户的重要信息，对话中自然运用：\nKey facts you remember about the user — use naturally in conversation:\n"
    return header + "\n".join(lines)


# ==================== 主入口 ====================

def process_memory(user_id: ObjectId, user_msg: str, ai_reply: str):
    """
    完整记忆处理流程（在后台线程中运行）：
    1. 从 MongoDB 读取已有记忆
    2. 清理过期记忆
    3. 调 Gemini 提取新记忆
    4. 合并到已有记忆
    5. 存回 MongoDB
    6. 按频率同步 system prompt
    """
    from database import db

    try:
        # 1. 读取用户及已有记忆
        user = db.db["users"].find_one({"_id": user_id})
        if not user:
            logger.warning(f"[MEMORY] User {user_id} not found")
            return

        memory = user.get("memory", {
            "permanent": [],
            "long_term": [],
            "short_term": [],
            "extraction_count": 0,
            "last_prompt_sync": None
        })

        # 2. 清理过期
        memory = cleanup_expired(memory)

        # 3. 提取新记忆
        extracted = extract_memories(user_msg, ai_reply, memory)
        if not extracted:
            # 提取失败或无结果，仍然更新 count
            memory["extraction_count"] = memory.get("extraction_count", 0) + 1
            db.db["users"].update_one(
                {"_id": user_id},
                {"$set": {"memory": memory}}
            )
            return

        # 4. 合并
        memory, has_changes = merge_memories(memory, extracted)

        # 5. 更新计数并存储
        memory["extraction_count"] = memory.get("extraction_count", 0) + 1
        count = memory["extraction_count"]

        db.db["users"].update_one(
            {"_id": user_id},
            {"$set": {"memory": memory}}
        )

        # 6. 按频率同步 system prompt（有变化 且 每 N 次）
        if has_changes and count % SYNC_EVERY_N == 0:
            _sync_prompt(user_id, user)
            memory["last_prompt_sync"] = datetime.utcnow()
            db.db["users"].update_one(
                {"_id": user_id},
                {"$set": {"memory.last_prompt_sync": memory["last_prompt_sync"]}}
            )
            logger.info(f"[MEMORY] Synced prompt for user {user.get('name', '?')} (count={count})")
        elif has_changes:
            logger.info(f"[MEMORY] Changes saved but prompt sync deferred (count={count}, next sync at {count + (SYNC_EVERY_N - count % SYNC_EVERY_N)})")

    except Exception as e:
        logger.error(f"[MEMORY] process_memory error: {e}")
        import traceback
        traceback.print_exc()


def _sync_prompt(user_id: ObjectId, user: Dict):
    """同步 system prompt 到 AnythingLLM workspace"""
    try:
        from workspace_manager import WorkspaceManager
        wm = WorkspaceManager()
        result = wm.update_system_prompt(user_id, user["name"])
        if result.get("success"):
            logger.info(f"[MEMORY] Prompt synced successfully")
        else:
            logger.warning(f"[MEMORY] Prompt sync failed: {result.get('error')}")
    except Exception as e:
        logger.error(f"[MEMORY] Prompt sync error: {e}")
