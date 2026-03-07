"""
SoulLink Mem0 Memory Engine — 语义记忆系统
替代 memory_engine.py，使用 Mem0 + Qdrant 实现向量存储和语义搜索。

保留原有的预过滤 + 垃圾过滤逻辑，新增：
  - 语义搜索：每条消息只注入相关记忆（top-K），不全量注入
  - 自动去重：Mem0 内置 embedding 相似度去重
  - TTL 过期：通过 metadata 标记 + 定期清理实现
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
MAX_SEARCH_RESULTS = 8       # 语义搜索 top-K
SHORT_TERM_DAYS = 14
LONG_TERM_DAYS = 90

# ==================== Mem0 初始化 ====================

_mem0_client = None


def _get_mem0():
    """懒加载初始化 Mem0 客户端（Qdrant embedded + Gemini）"""
    global _mem0_client
    if _mem0_client is not None:
        return _mem0_client

    from mem0 import Memory

    gemini_key = os.getenv("GOOGLE_GEMINI_API_KEY")
    qdrant_path = os.getenv("QDRANT_PATH", "/home/ubuntu/qdrant_data")

    config = {
        "llm": {
            "provider": "gemini",
            "config": {
                "model": "gemini-2.5-flash",
                "api_key": gemini_key,
                "temperature": 0.1,
            }
        },
        "embedder": {
            "provider": "gemini",
            "config": {
                "model": "gemini-embedding-001",
                "api_key": gemini_key,
                "embedding_dims": 768,
            }
        },
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": "soullink_memories",
                "path": qdrant_path,
                "embedding_model_dims": 768,
                "on_disk": True,
                # embedded mode — 无需单独 Qdrant 服务
            }
        },
        "version": "v1.1",
    }

    _mem0_client = Memory.from_config(config)
    logger.info(f"[MEM0] Initialized — Qdrant path: {qdrant_path}")
    return _mem0_client


# ==================== 预过滤（从 memory_engine.py 复用） ====================

_SKIP_PATTERNS = [
    r'^(你好|嗨|哈喽|hello|hi|hey|嘿|在吗|在不在)[\s!！.。?？]*$',
    r'^(晚安|早安|早上好|午安|下午好|晚上好|good\s*(morning|night|evening))[\s!！.。~～❤️💕😘🌙]*$',
    r'^(拜拜|再见|bye|byebye|see\s*you|回见|走了|睡了|去了|下次见)[\s!！.。~～]*$',
    r'^(好的?|ok|okay|嗯|哦|哈哈|呵呵|嘻嘻|谢谢|thanks?|thank\s*you|不客气|没事|对|是的?)[\s!！.。]*$',
    r'^(啊|呃|唔|额|嗯嗯|哇|wow|lol|haha|😂|🤣|❤️|👍|💕|🥰|😊|😘)+[\s!！.。]*$',
]
_SKIP_COMPILED = [re.compile(p, re.IGNORECASE) for p in _SKIP_PATTERNS]


def _should_skip_extraction(user_msg: str) -> bool:
    """跳过太短/太trivial的消息"""
    msg = user_msg.strip()
    if not msg:
        return True
    if all(ord(c) > 0x1F000 or c in ' \t' for c in msg):
        return True
    clean = re.sub(r'[\s!！?？.。,，~～]+', '', msg)
    if len(clean) <= 3:
        return True
    for pattern in _SKIP_COMPILED:
        if pattern.match(msg):
            return True
    return False


# ==================== 垃圾记忆过滤（从 memory_engine.py 复用） ====================

_JUNK_PATTERNS = [
    r'(今天|昨天|现在|刚才|目前).{0,10}(温度|°[FC]|度|℃|℉)',
    r'\d+\s*°[FC]',
    r'(天气|气温|降雨|下雨|下雪|有风|晴|多云|阴天)',
    r'(雪崩|地震|事故|洪水|台风|飓风|遇难|死亡|伤亡)',
    r'(新闻|头条|报道|breaking)',
    r'^用户(说了?|打了?)(晚安|早安|你好|再见|拜拜)',
    r'(准备睡觉|要睡了|去睡了|准备休息|going to sleep|going to bed)',
    r'(测试AI|试探AI|考验AI|测试.*判断|边界问题|testing)',
    r'用户(问|询问|想知道)(AI|人工智能)(能不能|是否|会不会)',
    r'(股价|股票|比特币|bitcoin|涨了?|跌了?|价格)\s*\d',
]
_JUNK_COMPILED = [re.compile(p, re.IGNORECASE) for p in _JUNK_PATTERNS]


def _is_junk_memory(fact: str) -> bool:
    """拦截 LLM 错误提取的垃圾记忆"""
    for pattern in _JUNK_COMPILED:
        if pattern.search(fact):
            logger.info(f"[MEM0] Junk blocked: '{fact}'")
            return True
    return False


# ==================== 记忆层级分类 ====================

_PERMANENT_KEYWORDS = [
    'name is', 'real name', '真名', '叫做', '姓名',
    'family', 'mother', 'father', 'sister', 'brother', 'wife', 'husband',
    '家人', '妈妈', '爸爸', '姐姐', '哥哥', '妻子', '丈夫', '父母', '兄弟', '姐妹',
    'pet', 'cat', 'dog', '宠物', '猫', '狗',
    'job', 'work at', 'works at', 'occupation', '工作', '职业', '公司', '上班',
    'birthday', 'born in', '生日', '出生',
    'hometown', '老家', '家乡', '来自',
    'nationality', '国籍',
    'university', 'college', 'school', '大学', '学校', '毕业',
    'major', 'degree', '专业', '学位',
    'language', 'speaks', '语言', '会说',
]

_SHORT_TERM_KEYWORDS = [
    'next week', 'tomorrow', 'this weekend', '下周', '明天', '这周末', '下个月',
    'interview', 'exam', 'trip', '面试', '考试', '旅行', '出差',
    'moving', 'relocating', '搬家', '搬到',
    'deadline', 'due date', '截止', '到期',
]


def _classify_tier(fact: str) -> str:
    """基于关键词分类记忆层级"""
    fact_lower = fact.lower()
    for kw in _PERMANENT_KEYWORDS:
        if kw in fact_lower:
            return "permanent"
    for kw in _SHORT_TERM_KEYWORDS:
        if kw in fact_lower:
            return "short_term"
    return "long_term"


def _calculate_expiry(tier: str) -> Optional[str]:
    """计算过期时间 ISO 字符串，permanent/long_term 返回 None"""
    if tier in ("permanent", "long_term"):
        return None
    elif tier == "short_term":
        now = datetime.utcnow()
        return (now + timedelta(days=SHORT_TERM_DAYS)).isoformat()
    return None


# ==================== 核心 API ====================

def get_permanent_memories(user_id: str) -> List[Dict]:
    """获取所有永久记忆（始终注入 prompt）"""
    m = _get_mem0()
    try:
        all_mems = m.get_all(user_id=user_id)
        # Mem0 返回格式可能是 list 或 dict with "results" key
        items = all_mems if isinstance(all_mems, list) else all_mems.get("results", [])
        permanent = []
        for r in items:
            meta = r.get("metadata", {})
            if meta.get("tier") == "permanent":
                permanent.append({
                    "fact": r.get("memory", ""),
                    "tier": "permanent",
                    "id": r.get("id"),
                })
        return permanent
    except Exception as e:
        logger.error(f"[MEM0] get_permanent error: {e}")
        return []


def search_relevant_memories(user_id: str, query: str, limit: int = MAX_SEARCH_RESULTS) -> List[Dict]:
    """语义搜索：返回与当前消息最相关的非永久记忆"""
    m = _get_mem0()
    try:
        results = m.search(query=query, user_id=user_id, limit=limit)
        items = results if isinstance(results, list) else results.get("results", [])

        memories = []
        now = datetime.utcnow()
        for r in items:
            meta = r.get("metadata", {})
            # 跳过 permanent（单独处理）
            if meta.get("tier") == "permanent":
                continue
            # 跳过已过期
            expires_at = meta.get("expires_at")
            if expires_at:
                try:
                    if datetime.fromisoformat(expires_at) < now:
                        continue
                except (ValueError, TypeError):
                    pass
            memories.append({
                "fact": r.get("memory", ""),
                "tier": meta.get("tier", "long_term"),
                "id": r.get("id"),
            })
        return memories
    except Exception as e:
        logger.error(f"[MEM0] search error: {e}")
        return []


def build_memory_text(permanent: List[Dict], relevant: List[Dict]) -> str:
    """
    构建记忆文本用于注入 system prompt。
    permanent 始终包含，relevant 为语义搜索结果。
    """
    sections = []

    if permanent:
        facts = "\n".join(f"- {m['fact']}" for m in permanent)
        sections.append(f"[Core — always remember]\n{facts}")

    if relevant:
        facts = "\n".join(f"- {m['fact']}" for m in relevant)
        sections.append(f"[Important — remember for now]\n{facts}")

    if not sections:
        return ""

    header = "# Memories about the user\nUse these naturally in conversation. Core facts are most important.\n"
    return header + "\n".join(sections)


# ==================== 记忆提取（后台异步调用） ====================

def process_memory(user_id: ObjectId, user_msg: str, ai_reply: str):
    """
    主入口 — 在后台线程中运行。
    1. 预过滤 trivial 消息
    2. Mem0 add() 自动提取 + 去重
    3. 后置垃圾过滤
    4. 分类打标 + 设 TTL
    """
    if _should_skip_extraction(user_msg):
        logger.debug(f"[MEM0] Skipped trivial: '{user_msg[:50]}'")
        return

    uid_str = str(user_id)
    m = _get_mem0()

    try:
        messages = [
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": ai_reply},
        ]
        result = m.add(messages=messages, user_id=uid_str, metadata={"source": "chat"})

        # 处理结果：后置过滤 + 分类
        if not result:
            return

        events = result if isinstance(result, list) else result.get("results", [])
        for event in events:
            if event.get("event") != "ADD":
                continue

            mem_text = event.get("memory", "")
            mem_id = event.get("id")

            # 垃圾过滤
            if _is_junk_memory(mem_text):
                try:
                    m.delete(mem_id)
                except Exception:
                    pass
                continue

            # 分类 + TTL
            tier = _classify_tier(mem_text)
            expires_at = _calculate_expiry(tier)

            # 永久记忆数量检查
            if tier == "permanent":
                existing_perm = get_permanent_memories(uid_str)
                if len(existing_perm) >= MAX_PERMANENT:
                    tier = "long_term"
                    expires_at = _calculate_expiry("long_term")
                    logger.warning(f"[MEM0] Permanent full ({MAX_PERMANENT}), downgraded to long_term: '{mem_text}'")

            try:
                m.update(mem_id, data=mem_text, metadata={
                    "tier": tier,
                    "expires_at": expires_at,
                    "source": "chat",
                })
            except Exception as e:
                logger.warning(f"[MEM0] Failed to update metadata for '{mem_text}': {e}")

            logger.info(f"[MEM0] Added [{tier}]: '{mem_text}'")

    except Exception as e:
        logger.error(f"[MEM0] process_memory error: {e}")
        import traceback
        traceback.print_exc()


def cleanup_expired_memories(user_id: str):
    """清理已过期的记忆。概率性调用（~5% 的消息触发）。"""
    m = _get_mem0()
    try:
        all_mems = m.get_all(user_id=user_id)
        items = all_mems if isinstance(all_mems, list) else all_mems.get("results", [])

        now = datetime.utcnow()
        cleaned = 0
        for mem in items:
            meta = mem.get("metadata", {})
            expires_at = meta.get("expires_at")
            if not expires_at:
                continue
            try:
                if datetime.fromisoformat(expires_at) < now:
                    m.delete(mem.get("id"))
                    cleaned += 1
                    logger.info(f"[MEM0] Expired: '{mem.get('memory', '')[:50]}'")
            except (ValueError, TypeError):
                continue

        if cleaned:
            logger.info(f"[MEM0] Cleaned {cleaned} expired memories for user {user_id}")
    except Exception as e:
        logger.error(f"[MEM0] cleanup error: {e}")
