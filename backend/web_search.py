"""
SoulLink Web Search Module
Gemini 判断是否需要搜索 → Serper.dev Search
"""

import os
import logging
import requests
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Serper.dev 配置
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")


# ========== Gemini 判断是否需要搜索 ==========

def _gemini_classify(user_message: str) -> Tuple[bool, Optional[str]]:
    """用 Gemini Flash 判断是否需要联网搜索 + 生成搜索关键词"""
    try:
        from memory_engine import _call_gemini
        prompt = (
            "Decide if this message needs real-time web search. "
            "ONLY say yes for: current weather, live news, real-time data, events after 2024. "
            "Say no for: general chat, emotions, opinions, general knowledge.\n\n"
            f"Message: {user_message[:200]}\n\n"
            "Reply format:\n"
            "SEARCH: yes or no\n"
            "QUERY: search keywords (ALWAYS in English, include full location names e.g. 'Riverside CA' not just 'Riverside')\n"
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


# ========== Serper.dev Search ==========

def _serper_search(query: str, num_results: int = 5) -> Optional[str]:
    """调用 Serper.dev Search API"""
    api_key = SERPER_API_KEY or os.getenv("SERPER_API_KEY", "")
    if not api_key:
        logger.warning("[SEARCH] SERPER_API_KEY not configured")
        return None

    try:
        resp = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": num_results},
            timeout=5
        )
        resp.raise_for_status()
        data = resp.json()

        results = []

        # 提取 answerBox（如果有直接答案）
        answer_box = data.get("answerBox")
        if answer_box:
            title = answer_box.get("title", "")
            answer = answer_box.get("answer") or answer_box.get("snippet", "")
            if answer:
                answer_clean = answer.replace("\n", " | ")
                results.append(f"[DIRECT ANSWER] {title}: {answer_clean}")

        # 提取 knowledgeGraph（如果有知识面板）
        kg = data.get("knowledgeGraph")
        if kg:
            kg_title = kg.get("title", "")
            kg_desc = kg.get("description", "")
            kg_attrs = kg.get("attributes", {})
            if kg_title and kg_desc:
                kg_line = f"[KNOWLEDGE] {kg_title}: {kg_desc}"
                if kg_attrs:
                    attrs = "; ".join(f"{k}: {v}" for k, v in list(kg_attrs.items())[:5])
                    kg_line += f" ({attrs})"
                results.append(kg_line)

        # 提取 organic 搜索结果
        items = data.get("organic", [])
        for i, item in enumerate(items[:num_results], 1):
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            date = item.get("date", "")
            date_str = f" [{date}]" if date else ""
            results.append(f"{i}. {title}{date_str}: {snippet}")

        # 提取 topStories（新闻类查询）
        stories = data.get("topStories", [])
        if stories:
            for s in stories[:3]:
                s_title = s.get("title", "")
                s_source = s.get("source", "")
                s_date = s.get("date", "")
                if s_title:
                    results.append(f"[NEWS] {s_title} — {s_source} ({s_date})")

        if not results:
            return None

        logger.info(f"[SEARCH] Found {len(results)} results for: {query}")
        return "\n".join(results)

    except Exception as e:
        logger.error(f"[SEARCH] Serper search failed: {e}")
        return None


# ========== 主入口 ==========

def enhance_message_with_search(user_message: str) -> Tuple[str, bool]:
    """
    Gemini 判断 + 搜索增强：
    1. Gemini 判断（~1s）→ 精确判断是否需要搜索 + 生成搜索词
    2. Serper 搜索（~0.5s）→ 获取结果注入消息
    """
    # Gemini 判断是否需要搜索
    need_search, query = _gemini_classify(user_message)
    if not need_search or not query:
        return user_message, False

    # Serper 搜索
    search_results = _serper_search(query)
    if not search_results:
        return user_message, False

    # 注入搜索结果（中英双语指令）
    enhanced = (
        f"{user_message}\n\n"
        f"[System: Below are real-time web search results for your reference. "
        f"Use this information naturally in your reply — respond as if you already knew it. "
        f"Do NOT say 'according to search results' or similar phrases. "
        f"Ignore results that are not relevant to the question. "
        f"Reply in the same language as the user's message.]\n"
        f"以下是联网搜索到的最新信息，请自然地融入回答中，不要提及搜索。\n"
        f"---\n{search_results}\n---"
    )

    logger.info(f"[SEARCH] Message enhanced with web results")
    return enhanced, True
