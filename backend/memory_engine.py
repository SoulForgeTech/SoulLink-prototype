"""
SoulLink Memory Engine — 三层记忆系统
从对话中异步提取关键信息，存入 MongoDB，注入 system prompt。

记忆层级:
  permanent (≤10) — 身份/家人/宠物/职业等，永不自动删除
  long_term (≤15) — 重要经历/偏好/习惯，90 天淡化
  short_term (≤5)  — 近期事件/临时情绪，14 天过期
"""

import os
import re
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

EXTRACTION_PROMPT = """You are a STRICT memory extraction assistant for an AI companion app. Your job is to decide what's worth remembering about the user. Memory slots are LIMITED and precious — only store facts that will be useful in FUTURE conversations.

User message: {user_msg}
AI reply: {ai_reply}

Existing memories:
{existing_summary}

=== STRICT RULES ===

1. BE EXTREMELY SELECTIVE. When in doubt, store NOTHING. Empty output is perfectly fine and expected for most conversations.

2. NEVER store any of these (instant reject):
   - Greetings & farewells: 你好, 晚安, 早上好, goodbye, good night, hi, hey, 再见, 拜拜, 睡了, 起床了
   - Real-time data: weather, temperature, °F, °C, stock prices, sports scores, exchange rates
   - News events: accidents, disasters, elections, celebrity gossip, headlines
   - Timestamps: "今天", "昨天", "刚才", "现在" — these expire immediately
   - Meta-conversation: "测试AI", "你能不能...", "试试看", testing the AI, asking what AI can do
   - Vague emotions: "心情不好", "有点累", "无聊" (too transient to remember)
   - AI's own responses or capabilities — only store facts ABOUT THE USER

3. ONLY store facts that pass this test: "Would this fact still be useful to know in 2 weeks?"
   - YES: "用户在星巴克工作" → useful for future conversations
   - YES: "用户养了一只叫Mochi的猫" → permanent identity fact
   - YES: "用户下周要搬到纽约" → important upcoming life event
   - NO:  "用户今天准备睡觉" → irrelevant tomorrow
   - NO:  "Riverside今天48°F" → expired in hours
   - NO:  "用户说了晚安" → just a greeting
   - NO:  "太浩湖发生雪崩" → news, not about the user

4. Store the user's INTEREST, not the data itself:
   - OK:  "用户经常关注Riverside天气"
   - BAD: "Riverside今天48°F有风"
   - OK:  "用户关注加密货币市场"
   - BAD: "比特币今天涨了5%"

5. Categories (be strict about placement):
   - permanent: real name, family members, pets, job/school, hometown, birthday, nationality — things that rarely change
   - long_term: hobbies, food preferences, relationship status, important life plans, recurring habits
   - short_term: ONLY significant upcoming events (travel plans, job interviews, exams) — NOT daily trivia

6. Keep each fact under 15 words, in the SAME language as the user's message.

7. If the user corrects old info (e.g. "I changed jobs"), output an update instead of a new memory.

Return ONLY valid JSON:
{{"new_memories": [{{"fact": "...", "type": "permanent|long_term|short_term"}}], "updates": [{{"old_fact": "exact old text", "new_fact": "updated text"}}]}}

If NOTHING worth remembering (this should be the case for most casual messages): {{"new_memories": [], "updates": []}}"""


# ==================== 预过滤 — 跳过不值得提取的消息 ====================

# 短消息模式：打招呼、告别、单字回复等
_SKIP_PATTERNS = [
    # 中文
    r'^(你好|嗨|哈喽|hello|hi|hey|嘿|在吗|在不在)[\s!！.。?？]*$',
    r'^(晚安|早安|早上好|午安|下午好|晚上好|good\s*(morning|night|evening))[\s!！.。~～❤️💕😘🌙]*$',
    r'^(拜拜|再见|bye|byebye|see\s*you|回见|走了|睡了|去了|下次见)[\s!！.。~～]*$',
    r'^(好的?|ok|okay|嗯|哦|哈哈|呵呵|嘻嘻|谢谢|thanks?|thank\s*you|不客气|没事|对|是的?)[\s!！.。]*$',
    r'^(啊|呃|唔|额|嗯嗯|哇|wow|lol|haha|😂|🤣|❤️|👍|💕|🥰|😊|😘)+[\s!！.。]*$',
]
_SKIP_COMPILED = [re.compile(p, re.IGNORECASE) for p in _SKIP_PATTERNS]


def _should_skip_extraction(user_msg: str) -> bool:
    """判断消息是否太短/太trivial，不值得调 Gemini 提取"""
    msg = user_msg.strip()

    # 空消息
    if not msg:
        return True

    # 纯 emoji
    if all(ord(c) > 0x1F000 or c in ' \t' for c in msg):
        return True

    # 过短且无实质信息（< 4个中文字符或 < 8个英文字符）
    clean = re.sub(r'[\s!！?？.。,，~～]+', '', msg)
    if len(clean) <= 3:
        return True

    # 匹配跳过模式
    for pattern in _SKIP_COMPILED:
        if pattern.match(msg):
            return True

    return False


# ==================== 后置过滤 — 拦截垃圾记忆 ====================

_JUNK_PATTERNS = [
    # 实时数据
    r'(今天|昨天|现在|刚才|目前).{0,10}(温度|°[FC]|度|℃|℉)',
    r'\d+\s*°[FC]',
    r'(天气|气温|降雨|下雨|下雪|有风|晴|多云|阴天)',
    # 新闻事件
    r'(雪崩|地震|事故|洪水|台风|飓风|遇难|死亡|伤亡)',
    r'(新闻|头条|报道|breaking)',
    # 打招呼/告别
    r'^用户(说了?|打了?)(晚安|早安|你好|再见|拜拜)',
    r'(准备睡觉|要睡了|去睡了|准备休息|going to sleep|going to bed)',
    # 元对话
    r'(测试AI|试探AI|考验AI|测试.*判断|边界问题|testing)',
    r'用户(问|询问|想知道)(AI|人工智能)(能不能|是否|会不会)',
    # 股票/价格
    r'(股价|股票|比特币|bitcoin|涨了?|跌了?|价格)\s*\d',
]
_JUNK_COMPILED = [re.compile(p, re.IGNORECASE) for p in _JUNK_PATTERNS]


def _is_junk_memory(fact: str) -> bool:
    """代码层兜底：拦截 Gemini 错误提取的垃圾记忆"""
    for pattern in _JUNK_COMPILED:
        if pattern.search(fact):
            logger.info(f"[MEMORY] Junk filter blocked: '{fact}'")
            return True
    return False


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

        # 后置过滤：拦截垃圾记忆
        result["new_memories"] = [
            m for m in result["new_memories"]
            if not _is_junk_memory(m.get("fact", ""))
        ]

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

        # 后置过滤：更新内容也要检查
        if _is_junk_memory(new_fact):
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
    分层显示，让 AI 知道优先级。如果没有记忆返回空字符串。
    """
    sections = []

    perm = memory.get("permanent", [])
    if perm:
        facts = "\n".join(f"- {item['fact']}" for item in perm)
        sections.append(f"[Core — always remember]\n{facts}")

    lt = memory.get("long_term", [])
    if lt:
        facts = "\n".join(f"- {item['fact']}" for item in lt)
        sections.append(f"[Important — remember for now]\n{facts}")

    # short_term: 只注入最近 3 天的，避免过时信息污染 prompt
    st = memory.get("short_term", [])
    if st:
        cutoff = datetime.utcnow() - timedelta(days=3)
        recent = [item for item in st if item.get("updated_at", item.get("created_at", datetime.min)) > cutoff]
        if recent:
            facts = "\n".join(f"- {item['fact']}" for item in recent)
            sections.append(f"[Recent — may be outdated]\n{facts}")

    if not sections:
        return ""

    header = "# Memories about the user\nUse these naturally in conversation. Core facts are most important.\n"
    return header + "\n\n".join(sections)


# ==================== 主入口 ====================

def process_memory(user_id: ObjectId, user_msg: str, ai_reply: str):
    """
    完整记忆处理流程（在后台线程中运行）：
    0. 预过滤：跳过打招呼/告别等无意义消息
    1. 从 MongoDB 读取已有记忆
    2. 清理过期记忆
    3. 调 Gemini 提取新记忆
    4. 合并到已有记忆
    5. 存回 MongoDB
    6. 按频率同步 system prompt
    """
    from database import db

    # 0. 预过滤 — 短消息/打招呼/告别直接跳过，省 Gemini API 调用
    if _should_skip_extraction(user_msg):
        logger.debug(f"[MEMORY] Skipped trivial message: '{user_msg[:50]}'")
        return

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
