"""
Canon material augmentation for the persona extractor.

Pipeline:
  1. ask Gemini to identify the IP and produce a prioritized list of wiki
     sources (MediaWiki api.php endpoints + page titles)
  2. fetch each via the MediaWiki API (prop=text → parsed HTML)
     — uses the API rather than scraping the rendered HTML page so we
       sidestep Cloudflare 403s and bot-detection chrome
  3. strip the HTML to plain text, accumulate up to a cap
  4. cache in Mongo (canon_corpus collection, 30-day TTL)
  5. return the corpus to the extractor as @@CANON_CONTEXT@@

Source priority (encoded in the Gemini detection prompt):
  - Chinese games (Genshin / Honkai / Zenless / PGR): wiki.biligame.com
  - Most other fandoms: <subdomain>.fandom.com
  - Real people / mainstream literature / film: en.wikipedia.org

Voice/quote subpages are critical (e.g. "/语音", "/Voice-Lines",
"/Quotes") because they're where actual character dialogue lives. The
prompt asks Gemini to include them whenever they exist.

Soft-fails everywhere — empty corpus is acceptable; the extractor will
honor canon_recognized=false and produce a sparser, persona-only result.
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

CANON_CACHE_TTL_DAYS = 30
HTTP_TIMEOUT = 15
MAX_CORPUS_CHARS = 25000     # combined budget across all sources
PER_SOURCE_MAX = 18000       # per-source cap (so one giant page doesn't starve siblings)
INTER_FETCH_SLEEP = 1.5      # polite delay between requests to same wiki
# Browser-like UA — some wikis (BiliWiki notably) challenge non-browser UAs
# with a bot-protection page on certain subpages. The MediaWiki API itself
# is allowed for either UA, but we lean browser-like to maximize coverage.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 "
    "SoulLinkPersonaBot/0.3"
)

_gemini_model = None


def _get_model():
    global _gemini_model
    if _gemini_model is not None:
        return _gemini_model
    try:
        import google.generativeai as genai
        api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
        if not api_key:
            log.warning("[WIKI] GOOGLE_GEMINI_API_KEY not set — IP detection disabled")
            return None
        genai.configure(api_key=api_key)
        _gemini_model = genai.GenerativeModel("gemini-2.5-flash")
    except Exception as e:
        log.warning(f"[WIKI] Failed to init Gemini: {e}")
        return None
    return _gemini_model


# ---------- Mongo cache ----------

CACHE_COLLECTION = "canon_corpus"


def _get_cache_collection():
    try:
        from database import db
        return db.db[CACHE_COLLECTION]
    except Exception as e:
        log.warning(f"[WIKI] Cache collection unavailable: {e}")
        return None


def _cache_lookup(character_name: str) -> Optional[Dict]:
    coll = _get_cache_collection()
    if coll is None:
        return None
    key = (character_name or "").strip().lower()
    if not key:
        return None
    doc = coll.find_one({"_id": key})
    if not doc:
        return None
    fetched_at = doc.get("fetched_at")
    if fetched_at:
        try:
            if (datetime.utcnow() - fetched_at) > timedelta(days=CANON_CACHE_TTL_DAYS):
                return None  # expired
        except Exception:
            pass
    return doc


def _cache_store(character_name: str, *, ip: str, sources: List[Dict], corpus: str, recognized: bool) -> None:
    coll = _get_cache_collection()
    if coll is None:
        return
    key = (character_name or "").strip().lower()
    if not key:
        return
    coll.update_one(
        {"_id": key},
        {"$set": {
            "_id": key,
            "character_name": character_name,
            "ip": ip,
            "sources": sources,
            "corpus": corpus,
            "recognized": recognized,
            "fetched_at": datetime.utcnow(),
        }},
        upsert=True,
    )


# ---------- IP / wiki source detection via Gemini ----------

_DETECT_PROMPT = """Identify whether the following character name is from a known IP (anime / video game / novel / film / popular fandom) and which wiki pages have authoritative reference material — character lore, story dialogue, voice lines.

Character name: @@NAME@@

Respond with a single strict JSON object — no prose, no markdown fences:

{
  "recognized": true,
  "ip": "Genshin Impact",
  "wiki_sources": [
    // 1-4 sources in priority order. Each is a MediaWiki page we can fetch
    // via api.php?action=parse&page=<page>&prop=text. We will accumulate
    // text from all of them up to a budget. Always include voice-line /
    // quote subpages when they exist — they have actual dialogue.
    {"api": "https://wiki.biligame.com/ys/api.php", "page": "芙宁娜", "kind": "main"},
    {"api": "https://wiki.biligame.com/ys/api.php", "page": "芙宁娜/语音", "kind": "voice"}
  ]
}

Source priority guidance:
- Chinese games (Genshin Impact 原神 / Honkai Star Rail 崩坏星穹铁道 / Zenless Zone Zero 绝区零 / Punishing Gray Raven 战双 / Wuthering Waves 鸣潮 / Arknights 明日方舟):
    PRIMARY → wiki.biligame.com
      - Genshin: https://wiki.biligame.com/ys/api.php
      - Honkai SR: https://wiki.biligame.com/sr/api.php
      - Zenless: https://wiki.biligame.com/zzz/api.php
      - PGR: https://wiki.biligame.com/zspms/api.php
      - Wuthering: https://wiki.biligame.com/wuthering/api.php
      - Arknights: https://prts.wiki/api.php  (not biligame)
    Voice/quote subpages on biligame are usually <name>/语音
    Fandom is a useful secondary (English voice lines).

- Western/global games (Honkai Impact 3, Final Fantasy, etc.):
    PRIMARY → fandom.com (use the IP's subdomain).
    Voice subpages: <Name>/Voice-Lines or <Name>/Quotes

- Anime / manga (One Piece, JJK, etc.):
    PRIMARY → en.<ip>.fandom.com or onepiece.fandom.com
    Or moegirlpedia for Chinese-first content: https://zh.moegirl.org.cn/api.php

- Real people / classic literature / mainstream films:
    https://en.wikipedia.org/w/api.php  with the canonical title

- For non-English character names, ALWAYS include the native-language wiki
  source first (BiliWiki for Chinese, Moegirl for Japanese-origin works
  popular in CN). Then optionally add the English Fandom as backup.

If you do NOT recognize the character (custom OC, generic name, no canon),
or you're not confident → set recognized=false and wiki_sources=[].

Output the JSON now:"""


def _detect_sources(character_name: str) -> Dict:
    """Returns {recognized, ip, wiki_sources: [{api, page, kind}, ...]}.
    Never raises."""
    model = _get_model()
    if not model or not character_name:
        return {"recognized": False, "ip": "", "wiki_sources": []}
    try:
        prompt = _DETECT_PROMPT.replace("@@NAME@@", character_name.strip())
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
        obj = json.loads(text)
        if not isinstance(obj, dict):
            return {"recognized": False, "ip": "", "wiki_sources": []}
        sources_raw = obj.get("wiki_sources") or []
        sources: List[Dict] = []
        for s in sources_raw:
            if not isinstance(s, dict):
                continue
            api = (s.get("api") or "").strip()
            page = (s.get("page") or "").strip()
            kind = (s.get("kind") or "main").strip()
            if not api.startswith(("http://", "https://")) or not page:
                continue
            sources.append({"api": api[:300], "page": page[:200], "kind": kind[:30]})
        return {
            "recognized": bool(obj.get("recognized")),
            "ip": (obj.get("ip") or "").strip()[:80],
            "wiki_sources": sources[:4],
        }
    except Exception as e:
        log.warning(f"[WIKI] IP detection failed for {character_name!r}: {e}")
        return {"recognized": False, "ip": "", "wiki_sources": []}


# ---------- MediaWiki API fetch + clean ----------

def _fetch_mediawiki(api_url: str, page_title: str) -> str:
    """Fetch a page via MediaWiki action=parse and return the rendered HTML
    body (raw — caller cleans). Returns "" on any failure."""
    try:
        import requests
    except ImportError:
        return ""
    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
        "prop": "text",
        "redirects": "1",
        "disablelimitreport": "1",
        "disableeditsection": "1",
        "disabletoc": "1",
    }
    try:
        resp = requests.get(
            api_url, params=params,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=HTTP_TIMEOUT,
        )
        if resp.status_code != 200:
            log.warning(f"[WIKI] {api_url} page={page_title!r} → HTTP {resp.status_code}")
            return ""
        data = resp.json()
        if "error" in data:
            log.info(f"[WIKI] {api_url} page={page_title!r} → API error: {data['error'].get('info', '')[:120]}")
            return ""
        html = (data.get("parse") or {}).get("text", {}).get("*", "")
        return html or ""
    except Exception as e:
        log.warning(f"[WIKI] fetch error {api_url} page={page_title!r}: {e}")
        return ""


def _clean_html_to_text(html: str) -> str:
    """Strip MediaWiki-rendered HTML to a compact text representation focused
    on lore/story/voice-line content."""
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        # Fallback: regex strip — much worse but doesn't break the pipeline
        return re.sub(r"<[^>]+>", " ", html)
    soup = BeautifulSoup(html, "html.parser")
    # Drop chrome that doesn't contribute usable canon
    for sel in [
        "script", "style", "nav", "footer", "aside",
        ".mw-editsection", ".navbox", ".reference", "sup.reference",
        ".mw-references-wrap", ".thumb", ".infobox",
        ".gallery", ".sidebar", ".sister-projects",
        ".error", ".noprint", ".printfooter",
        ".toctitle", "#toc", ".toc",
        # BiliWiki / Fandom infobox-y tables — they're stat tables, not lore
        "table.bgwhite", "table.flex_table",
        "div.mw-collapsible-content",  # often sound-file collapsibles
    ]:
        for el in soup.select(sel):
            el.decompose()

    # Inline replacement: keep visible text only
    text = soup.get_text("\n", strip=True)
    # Collapse whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    # Drop obvious navigation lines
    text = re.sub(r"^(隐藏|展开|折叠|跳转到导航|跳转到搜索|编辑|查看源代码)$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


# ---------- Public API ----------

def get_canon_context(character_name: str, *, force_refresh: bool = False) -> Dict:
    """
    Top-level entrypoint used by persona_extractor. Returns:
      {
        "recognized": bool,
        "ip": str,
        "sources": [{"api","page","kind","fetched_chars"}],
        "corpus": str,
        "from_cache": bool,
      }

    Soft-fails: any error path returns recognized=False with empty corpus.
    """
    name = (character_name or "").strip()
    if not name:
        return {"recognized": False, "ip": "", "sources": [], "corpus": "", "from_cache": False}

    if not force_refresh:
        cached = _cache_lookup(name)
        if cached:
            return {
                "recognized": bool(cached.get("recognized", False)),
                "ip": cached.get("ip") or "",
                "sources": cached.get("sources") or [],
                "corpus": cached.get("corpus") or "",
                "from_cache": True,
            }

    detect = _detect_sources(name)
    if not detect.get("recognized") or not detect.get("wiki_sources"):
        # Cache the negative — saves repeat detection calls for OCs.
        _cache_store(name, ip=detect.get("ip", ""), sources=[], corpus="", recognized=False)
        return {
            "recognized": False,
            "ip": detect.get("ip") or "",
            "sources": [],
            "corpus": "",
            "from_cache": False,
        }

    # Fetch each source in order, accumulating into the corpus until we hit
    # the budget. Each section gets a clear delimiter so the LLM can cite.
    # Polite delay between requests to the same domain to avoid tripping
    # bot-detection on aggressive-looking bursts.
    import time
    accumulated_chars = 0
    chunks: List[str] = []
    fetched_sources: List[Dict] = []
    last_api_host = ""
    for i, src in enumerate(detect["wiki_sources"]):
        if accumulated_chars >= MAX_CORPUS_CHARS:
            break
        api_host = src["api"].split("/")[2] if "://" in src["api"] else ""
        if i > 0 and api_host == last_api_host:
            time.sleep(INTER_FETCH_SLEEP)
        last_api_host = api_host
        html = _fetch_mediawiki(src["api"], src["page"])
        text = _clean_html_to_text(html)
        if not text:
            fetched_sources.append({**src, "fetched_chars": 0})
            continue
        # Per-source cap so a 50k voice-line page doesn't starve other sources
        if len(text) > PER_SOURCE_MAX:
            text = text[:PER_SOURCE_MAX] + "\n[…truncated at per-source cap…]"
        # Total budget cap
        remaining = MAX_CORPUS_CHARS - accumulated_chars
        if len(text) > remaining:
            text = text[:remaining] + "\n[…truncated at total budget…]"
        chunk = (
            f"\n\n=== SOURCE: {src['kind']} | {src['page']} | {src['api']} ===\n{text}"
        )
        chunks.append(chunk)
        accumulated_chars += len(chunk)
        fetched_sources.append({**src, "fetched_chars": len(text)})

    corpus = "".join(chunks).strip()
    if not corpus:
        # IP recognized but every fetch failed — record + return empty so
        # extractor knows not to fabricate. Negative cache stored to avoid
        # hammering the wiki on retry.
        _cache_store(name, ip=detect["ip"], sources=fetched_sources, corpus="", recognized=detect["recognized"])
        return {
            "recognized": detect["recognized"],
            "ip": detect["ip"],
            "sources": fetched_sources,
            "corpus": "",
            "from_cache": False,
        }

    _cache_store(name, ip=detect["ip"], sources=fetched_sources, corpus=corpus, recognized=True)
    log.info(
        f"[WIKI] Fetched canon for {name!r} ({detect['ip']!r}, "
        f"{len(corpus)}c from {len(fetched_sources)} sources)"
    )
    return {
        "recognized": True,
        "ip": detect["ip"],
        "sources": fetched_sources,
        "corpus": corpus,
        "from_cache": False,
    }
