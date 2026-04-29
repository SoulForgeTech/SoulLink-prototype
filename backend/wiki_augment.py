"""
Canon material augmentation for the persona extractor.

Pipeline:
  1. ask Gemini whether it recognizes the character + what wiki to fetch
  2. fetch the wiki page (Fandom; sometimes Wikipedia)
  3. strip HTML to plain text, keep just the meaningful sections
  4. cache in Mongo (canon_corpus collection, 30-day TTL)
  5. return the corpus text to be slotted into the extractor prompt as
     @@CANON_CONTEXT@@

Failure modes are all soft — if anything blows up we return "" and the
extractor falls back to its own training-data canon recall (or, for OCs,
to persona-only behavior).
"""

import json
import logging
import os
import re
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

log = logging.getLogger(__name__)

CANON_CACHE_TTL_DAYS = 30
WIKI_FETCH_TIMEOUT = 15
WIKI_MAX_CHARS = 8000
USER_AGENT = "SoulLinkPersonaBot/0.1 (https://soullink.app; contact: dev@soullink.app)"

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
    if not fetched_at:
        return doc
    # Treat both naive & aware datetimes; Mongo stores naive UTC.
    try:
        age = datetime.utcnow() - fetched_at
        if age > timedelta(days=CANON_CACHE_TTL_DAYS):
            return None  # expired
    except Exception:
        pass
    return doc


def _cache_store(character_name: str, ip: str, wiki_url: str, corpus: str, recognized: bool) -> None:
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
            "wiki_url": wiki_url,
            "corpus": corpus,
            "recognized": recognized,
            "fetched_at": datetime.utcnow(),
        }},
        upsert=True,
    )


# ---------- IP / wiki URL detection via Gemini ----------

_DETECT_PROMPT = """Identify whether the following character name belongs to a known IP (anime, video game, novel, movie, popular fandom) and where authoritative reference material lives.

Character name: @@NAME@@

Respond with a single strict JSON object — no prose, no markdown fences:

{
  "recognized": true,                       // true if you recognize this as a known character
  "ip": "Genshin Impact",                   // name of the IP, or "" if not recognized
  "wiki_url": "https://genshin-impact.fandom.com/wiki/Furina"   // best Fandom or Wikipedia URL with character lore + quotes; "" if none
}

Guidance:
- Prefer English Fandom URLs (e.g. genshin-impact.fandom.com, honkai-star-rail.fandom.com, danmachi.fandom.com).
- For non-English characters, use the canonical English wiki URL even if the input name is in another language.
- For real-world public figures or fictional characters from major novels, Wikipedia is OK.
- If the name is too generic / could be many people (e.g. "John", "Alice"), set recognized=false.
- If you're not confident this is a famous canon character, set recognized=false.

Output the JSON now:"""


def _detect_ip_and_url(character_name: str) -> Dict:
    """Returns {recognized: bool, ip: str, wiki_url: str}. Never raises."""
    model = _get_model()
    if not model or not character_name:
        return {"recognized": False, "ip": "", "wiki_url": ""}
    try:
        prompt = _DETECT_PROMPT.replace("@@NAME@@", character_name.strip())
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
        obj = json.loads(text)
        if not isinstance(obj, dict):
            return {"recognized": False, "ip": "", "wiki_url": ""}
        url = (obj.get("wiki_url") or "").strip()
        # Sanity-check URL shape
        if url and not url.startswith(("http://", "https://")):
            url = ""
        return {
            "recognized": bool(obj.get("recognized")),
            "ip": (obj.get("ip") or "").strip()[:80],
            "wiki_url": url[:400],
        }
    except Exception as e:
        log.warning(f"[WIKI] IP detection failed for {character_name!r}: {e}")
        return {"recognized": False, "ip": "", "wiki_url": ""}


# ---------- Wiki page fetch + clean ----------

def _fetch_and_clean(url: str) -> str:
    """GET a Fandom/Wikipedia page and reduce it to a meaningful text corpus
    for Gemini grounding. Returns "" on any failure."""
    if not url:
        return ""
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError as e:
        log.warning(f"[WIKI] Missing scraping deps ({e}) — skipping fetch")
        return ""

    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=WIKI_FETCH_TIMEOUT)
        if resp.status_code != 200:
            log.warning(f"[WIKI] {url} → HTTP {resp.status_code}")
            return ""
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        log.warning(f"[WIKI] fetch failed for {url}: {e}")
        return ""

    # Drop chrome that just adds noise tokens
    for sel in [
        "script", "style", "nav", "footer", "aside",
        ".mw-editsection", ".navbox", ".reference", "sup.reference",
        ".mw-references-wrap", ".thumb", ".infobox", ".mw-collapsible",
        ".gallery", "table.wikitable",
    ]:
        for el in soup.select(sel):
            el.decompose()

    # Fandom main content lives in .mw-parser-output; Wikipedia uses #mw-content-text
    main = soup.select_one(".mw-parser-output") or soup.select_one("#mw-content-text") or soup
    text = main.get_text("\n", strip=True)
    # Collapse whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    # Heuristic: keep sections most relevant to character voice / lore.
    # We scan for headings and prefer Story / Personality / Quotes / Lore / Background.
    KEEP_SECTIONS = (
        "personality", "story", "lore", "background", "history", "quotes", "voice lines",
        "trivia", "appearance", "relationships", "biography", "synopsis",
        "story quest", "character story",
    )
    SKIP_SECTIONS = (
        "talents", "constellations", "ascension", "skills", "build", "abilities",
        "stats", "drops", "shop", "media", "videos", "see also", "external",
        "navigation", "trailers",
    )

    # Split by lines that look like headings (Fandom renders them as plain
    # capitalized lines after .get_text). We approximate: if a line is short
    # and Title Case, treat as heading.
    lines = text.split("\n")
    section_keep = True  # default to including content before first heading
    out_lines = []
    last_heading = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out_lines.append("")
            continue
        # Heading-like: short, no period, mostly title case
        is_heading = (
            len(stripped) <= 60
            and not stripped.endswith(("。", ".", "?", "!"))
            and (stripped.istitle() or stripped[0:1].isupper() and len(stripped.split()) <= 5)
        )
        if is_heading:
            lower = stripped.lower()
            if any(s in lower for s in SKIP_SECTIONS):
                section_keep = False
                last_heading = stripped
                continue
            if any(k in lower for k in KEEP_SECTIONS):
                section_keep = True
                last_heading = stripped
                out_lines.append(f"\n## {stripped}\n")
                continue
            # Unknown heading — keep by default unless it looks technical
            section_keep = True
            last_heading = stripped
            out_lines.append(f"\n## {stripped}\n")
            continue
        if section_keep:
            out_lines.append(stripped)

    cleaned = "\n".join(out_lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    if len(cleaned) > WIKI_MAX_CHARS:
        cleaned = cleaned[:WIKI_MAX_CHARS] + "\n[…truncated…]"
    return cleaned


# ---------- Public API ----------

def get_canon_context(character_name: str, *, force_refresh: bool = False) -> Dict:
    """
    Top-level entrypoint used by persona_extractor. Returns:
      {
        "recognized": bool,
        "ip": str,
        "wiki_url": str,
        "corpus": str,        # the text to feed to Gemini (may be empty)
        "from_cache": bool,
      }

    Soft-fails: any error path returns recognized=False with empty corpus.
    """
    name = (character_name or "").strip()
    if not name:
        return {"recognized": False, "ip": "", "wiki_url": "", "corpus": "", "from_cache": False}

    if not force_refresh:
        cached = _cache_lookup(name)
        if cached:
            return {
                "recognized": bool(cached.get("recognized", False)),
                "ip": cached.get("ip") or "",
                "wiki_url": cached.get("wiki_url") or "",
                "corpus": cached.get("corpus") or "",
                "from_cache": True,
            }

    detect = _detect_ip_and_url(name)
    if not detect.get("recognized") or not detect.get("wiki_url"):
        # Cache the negative result too — saves repeat detection calls for OCs.
        _cache_store(name, ip=detect.get("ip", ""), wiki_url="", corpus="", recognized=False)
        return {
            "recognized": False,
            "ip": detect.get("ip") or "",
            "wiki_url": "",
            "corpus": "",
            "from_cache": False,
        }

    corpus = _fetch_and_clean(detect["wiki_url"])
    if not corpus:
        # IP recognized but fetch failed — still record the negative so we
        # don't hammer the wiki next time. Gemini's training-data recall will
        # have to carry the load this round.
        _cache_store(name, ip=detect["ip"], wiki_url=detect["wiki_url"], corpus="", recognized=detect["recognized"])
        return {
            "recognized": detect["recognized"],
            "ip": detect["ip"],
            "wiki_url": detect["wiki_url"],
            "corpus": "",
            "from_cache": False,
        }

    _cache_store(name, ip=detect["ip"], wiki_url=detect["wiki_url"], corpus=corpus, recognized=True)
    log.info(f"[WIKI] Fetched canon for {name!r} ({detect['ip']!r}, {len(corpus)} chars)")
    return {
        "recognized": True,
        "ip": detect["ip"],
        "wiki_url": detect["wiki_url"],
        "corpus": corpus,
        "from_cache": False,
    }
