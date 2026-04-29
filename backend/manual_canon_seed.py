"""
One-shot helper: pre-populate the canon_corpus collection for characters
that Gemini misidentified during automated detection (typically newer or
niche IPs that postdate Gemini's training cutoff). After running this,
the persona extractor will see a non-empty canon_context for these
characters and produce real canon-grounded entries.

Usage (on EC2):
  cd /home/ubuntu/soullink-backend/backend
  source ../venv/bin/activate
  set -a && source .env && set +a
  python3 manual_canon_seed.py
"""

import logging
import os
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Hand-curated mapping for characters Gemini doesn't recognize. Each entry
# has the correct wiki sources we verified manually.
MANUAL_CANON_SOURCES = [
    {
        "name": "夏以昼",
        "ip": "Love and Deepspace 恋与深空",
        "sources": [
            {"api": "https://wiki.biligame.com/lysk/api.php", "page": "夏以昼:信息", "kind": "main"},
        ],
    },
    {
        "name": "顾时夜",
        "ip": "World After 世界之外",
        "sources": [
            {"api": "https://wiki.biligame.com/world/api.php", "page": "顾时夜_时代旧影", "kind": "main"},
            {"api": "https://wiki.biligame.com/world/api.php", "page": "顾时夜_迷失空间", "kind": "story"},
            {"api": "https://wiki.biligame.com/world/api.php", "page": "顾时夜_现实世界", "kind": "story"},
        ],
    },
    {
        "name": "樱羽艾玛",
        "ip": "Magical Girl Witch Trial 魔法少女的魔女审判",
        "sources": [
            {"api": "https://wiki.biligame.com/manosaba/api.php", "page": "樱羽艾玛", "kind": "main"},
        ],
    },
]


def main():
    from wiki_augment import _fetch_mediawiki, _clean_html_to_text, _cache_store, MAX_CORPUS_CHARS, PER_SOURCE_MAX

    for entry in MANUAL_CANON_SOURCES:
        print(f"=== {entry['name']} ({entry['ip']}) ===")
        chunks = []
        fetched = []
        accumulated = 0
        for src in entry["sources"]:
            if accumulated >= MAX_CORPUS_CHARS:
                break
            html = _fetch_mediawiki(src["api"], src["page"])
            text = _clean_html_to_text(html)
            if not text:
                fetched.append({**src, "fetched_chars": 0})
                print(f"  ✗ {src['page']}: 0 chars")
                continue
            if len(text) > PER_SOURCE_MAX:
                text = text[:PER_SOURCE_MAX] + "\n[…truncated at per-source cap…]"
            remaining = MAX_CORPUS_CHARS - accumulated
            if len(text) > remaining:
                text = text[:remaining] + "\n[…truncated at total budget…]"
            chunk = f"\n\n=== SOURCE: {src['kind']} | {src['page']} | {src['api']} ===\n{text}"
            chunks.append(chunk)
            accumulated += len(chunk)
            fetched.append({**src, "fetched_chars": len(text)})
            print(f"  ✓ {src['page']}: {len(text)} chars")
            time.sleep(1.5)
        corpus = "".join(chunks).strip()
        if corpus:
            _cache_store(
                entry["name"],
                ip=entry["ip"],
                sources=fetched,
                corpus=corpus,
                recognized=True,
            )
            print(f"  → cached {len(corpus)} chars under {entry['name']!r}")
        else:
            print(f"  → SKIP (no content fetched)")
        print()


if __name__ == "__main__":
    main()
