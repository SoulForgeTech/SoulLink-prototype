#!/usr/bin/env python3
"""
fetch_cc0_nasa.py — bulk-fetch NASA Image Library photos. NASA media
created by U.S. federal employees is in the public domain (CC0-equivalent;
NASA's media usage policy:
https://www.nasa.gov/multimedia/guidelines/index.html). Manifest records
license='PD-NASA' to keep audit lineage distinct from museum CC0 entries.

API: https://images-api.nasa.gov  (no key required)
  /search?q=<term>&media_type=image   → list of items with links + data
  /asset/<nasa_id>                    → high-res variants of one item

USAGE
  python3 fetch_cc0_nasa.py --query "nebula" --out ./bg_nasa --target 25 \
                           --min-width 1600 --landscape-only
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from io import BytesIO

from PIL import Image

API = "https://images-api.nasa.gov"
HEADERS = {"User-Agent": "SoulLink-bg-fetch/1.0 (research; PD only)"}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search(term):
    qs = urllib.parse.urlencode({"q": term, "media_type": "image"})
    try:
        return get_json(f"{API}/search?{qs}")
    except Exception as e:
        print(f"  ! search failed ({term}): {e}")
        return None


def best_image_url(nasa_id):
    """Pick the largest available image variant for a NASA item."""
    try:
        manifest = get_json(f"{API}/asset/{nasa_id}")
    except Exception as e:
        print(f"  ! asset fetch failed {nasa_id}: {e}")
        return None
    items = manifest.get("collection", {}).get("items", [])
    # Prefer ~orig.jpg, then ~large.jpg, then ~medium.jpg
    by_suffix = {}
    for it in items:
        href = it.get("href", "")
        if not href.lower().endswith(".jpg") and not href.lower().endswith(".jpeg"):
            continue
        for sfx in ("~orig.jpg", "~orig.jpeg", "~large.jpg", "~medium.jpg"):
            if href.lower().endswith(sfx):
                by_suffix.setdefault(sfx, href)
    for sfx in ("~orig.jpg", "~orig.jpeg", "~large.jpg", "~medium.jpg"):
        if sfx in by_suffix:
            return by_suffix[sfx]
    # Fallback to whatever first jpg
    for it in items:
        href = it.get("href", "")
        if href.lower().endswith((".jpg", ".jpeg")):
            return href
    return None


# Curated space/sky queries skewing dark + atmospheric (good background).
DEFAULT_QUERIES = [
    "nebula", "galaxy", "andromeda", "milky way",
    "deep field", "JWST", "hubble deep",
    "pleiades", "orion nebula", "carina nebula",
    "supernova remnant", "stellar nursery",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", default=None,
                    help="single search term (else uses DEFAULT_QUERIES sweep)")
    ap.add_argument("--out", default="./bg_nasa")
    ap.add_argument("--target", type=int, default=30)
    ap.add_argument("--min-width", type=int, default=1600)
    ap.add_argument("--landscape-only", action="store_true")
    args = ap.parse_args()

    queries = [args.query] if args.query else DEFAULT_QUERIES

    os.makedirs(args.out, exist_ok=True)
    mpath = os.path.join(args.out, "manifest.csv")
    seen = set()

    with open(mpath, "w", newline="", encoding="utf-8") as mf:
        wr = csv.writer(mf)
        wr.writerow(["id", "accession", "title", "artist", "date",
                     "license", "source_url", "image_url", "w", "h", "file"])

        n = 0
        for term in queries:
            if n >= args.target:
                break
            print(f"[query] {term}")
            payload = search(term)
            if not payload:
                continue
            items = payload.get("collection", {}).get("items", [])
            for item in items:
                if n >= args.target:
                    break
                data = (item.get("data") or [{}])[0]
                nasa_id = data.get("nasa_id")
                if not nasa_id or nasa_id in seen:
                    continue
                seen.add(nasa_id)
                url = best_image_url(nasa_id)
                if not url:
                    continue
                try:
                    req = urllib.request.Request(url, headers=HEADERS)
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        raw = resp.read()
                    img = Image.open(BytesIO(raw))
                    w, h = img.size
                except Exception as e:
                    print(f"  ! download failed {nasa_id}: {e}")
                    continue
                if w and args.min_width and w < args.min_width:
                    print(f"  - skip {nasa_id}: width {w} < {args.min_width}")
                    continue
                if args.landscape_only and w and h and w < h:
                    print(f"  - skip {nasa_id}: portrait {w}x{h}")
                    continue
                title = data.get("title", "")
                center = data.get("center", "")
                date = (data.get("date_created", "") or "")[:10]
                source = f"https://images.nasa.gov/details/{nasa_id}"
                fname = f"nasa_{nasa_id}.jpg".replace("/", "-").replace(" ", "_")
                fpath = os.path.join(args.out, fname)
                with open(fpath, "wb") as fh:
                    fh.write(raw)
                wr.writerow([nasa_id, center, title, "NASA", date, "PD-NASA",
                             source, url, w, h, fname])
                mf.flush()
                n += 1
                print(f"  [{n}/{args.target}] {fname}  ({w}x{h}, {len(raw)//1024}KB)")
                time.sleep(0.5)

    print(f"\nDone. {n} PD-NASA images -> {args.out}")
    print(f"Manifest: {mpath}")


if __name__ == "__main__":
    main()
