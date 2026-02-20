"""
SoulLink Web Search Module
两层过滤：关键词快速筛 → Gemini 精确判断 → Google Custom Search
"""

import os
import re
import logging
import requests
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Google Custom Search 配置
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "c299681d1d793434b")
GOOGLE_CSE_API_KEY = os.getenv("GOOGLE_CSE_API_KEY", "")

# ========== 第一层：关键词快速过滤（0ms，过滤 95% 日常聊天） ==========

SEARCH_KEYWORDS_ZH = [
    r'天气', r'气温', r'下雨', r'下雪',
    r'新闻', r'热搜', r'热点', r'头条',
    r'股价', r'股票', r'基金', r'比特币', r'汇率',
    r'比赛', r'比分', r'赛事', r'世界杯', r'奥运',
    r'最新', r'最近', r'今天.*发生', r'昨天.*发生',
    r'现在.*多少', r'目前.*怎么样',
    r'上映', r'票房', r'开播',
    r'发布', r'发售', r'上市',
    r'谁赢了', r'结果.*怎么样',
    r'航班', r'火车', r'高铁',
]

SEARCH_KEYWORDS_EN = [
    r'weather', r'temperature', r'forecast',
    r'news', r'trending', r'headline',
    r'stock', r'price', r'bitcoin', r'crypto', r'exchange rate',
    r'score', r'game.*today', r'match.*result',
    r'latest', r'recent', r'current',
    r'release date', r'box office', r'premiere',
    r'who won', r'result',
    r'flight', r'train',
]

ALL_SEARCH_PATTERNS = [re.compile(p, re.IGNORECASE) for p in SEARCH_KEYWORDS_ZH + SEARCH_KEYWORDS_EN]


def _keyword_filter(message: str) -> bool:
    """第一层：关键词快速判断，返回 True 表示可能需要搜索"""
    for pattern in ALL_SEARCH_PATTERNS:
        if pattern.search(message):
            return True
    return False


# ========== 第二层：Gemini 精确判断（仅通过第一层的才触发） ==========

def _gemini_classify(user_message: str) -> Tuple[bool, Optional[str]]:
    """第二层：用 Gemini Flash 精确判断 + 生成搜索关键词"""
    try:
        from memory_engine import _call_gemini
        prompt = (
            "Decide if this message needs real-time web search. "
            "ONLY say yes for: current weather, live news, real-time data, events after 2024. "
            "Say no for: general chat, emotions, opinions, general knowledge.\n\n"
            f"Message: {user_message[:200]}\n\n"
            "Reply format:\n"
            "SEARCH: yes or no\n"
            "QUERY: search keywords (same language as message)\n"
        )
        result = _call_gemini(prompt)
        if not result:
            return False, None

        need_search = False
        query = None
        for line in result.strip().split("\n"):
            line = line.strip()
            if line.lower().startswith("search:"):
                need_search = "yes" in line.lower()
            elif line.lower().startswith("query:"):
                query = line.split(":", 1)[1].strip().strip('"\'') or None

        if need_search and not query:
            query = user_message[:100]

        logger.info(f"[SEARCH] Gemini: need={need_search}, query={query}")
        return need_search, query

    except Exception as e:
        logger.warning(f"[SEARCH] Gemini classify failed: {e}")
        return False, None


# ========== Google Custom Search ==========

def _google_search(query: str, num_results: int = 3) -> Optional[str]:
    """调用 Google Custom Search API"""
    api_key = GOOGLE_CSE_API_KEY or os.getenv("GOOGLE_CSE_API_KEY", "")
    if not api_key:
        logger.warning("[SEARCH] GOOGLE_CSE_API_KEY not configured")
        return None

    try:
        resp = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": api_key, "cx": GOOGLE_CSE_ID, "q": query, "num": num_results},
            timeout=5
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        if not items:
            return None

        results = []
        for i, item in enumerate(items, 1):
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            results.append(f"{i}. {title}: {snippet}")

        logger.info(f"[SEARCH] Found {len(items)} results for: {query}")
        return "\n".join(results)

    except Exception as e:
        logger.error(f"[SEARCH] Google search failed: {e}")
        return None


# ========== 主入口 ==========

def enhance_message_with_search(user_message: str) -> Tuple[str, bool]:
    """
    两层过滤 + 搜索增强：
    1. 关键词过滤（0ms）→ 过滤 95% 日常聊天
    2. Gemini 判断（~1s）→ 精确判断 + 生成搜索词
    3. Google 搜索（~0.5s）→ 获取结果注入消息
    """
    # 第一层：关键词快速过滤
    if not _keyword_filter(user_message):
        return user_message, False

    logger.info(f"[SEARCH] Keyword filter passed, checking with Gemini...")

    # 第二层：Gemini 精确判断
    need_search, query = _gemini_classify(user_message)
    if not need_search or not query:
        return user_message, False

    # 第三步：Google 搜索
    search_results = _google_search(query)
    if not search_results:
        return user_message, False

    # 注入搜索结果
    enhanced = (
        f"{user_message}\n\n"
        f"[System: 以下是联网搜索到的最新信息供你参考回答。"
        f"请用自然的口吻回答，就像你本来就知道这些信息一样，"
        f"不要说'根据搜索结果'之类的话。如果与问题无关则忽略。]\n"
        f"---\n{search_results}\n---"
    )

    logger.info(f"[SEARCH] Message enhanced with web results")
    return enhanced, True
