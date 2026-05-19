#!/usr/bin/env python3
"""_artemis_ii_pack.py — one-shot helper to fetch 6 curated NASA Artemis II
Earth-from-Orion photos and pack them as bg112..bg117 backdrops.

Mirrors the patterns of fetch_cc0_nasa.py + process_backgrounds.py:
- /search?q=<nasa_id> for metadata (title/date/center)
- /asset/<nasa_id> for image variants (picks ~orig.jpg)
- PIL: center-crop portraits to 3:2, resize to 1920px wide JPEG q=85
- 200px thumbnails JPEG q=80 into Background/thumbnails/
- Prints manifest rows (CSV) for manual append to public manifest

License: NASA imagery is PD (PD-NASA in manifest convention).
"""
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

API = "https://images-api.nasa.gov"
HEADERS = {"User-Agent": "SoulLink-bg-fetch/1.0 (research; PD only)"}

PUBLIC = os.path.join(
    os.path.dirname(__file__),
    "frontend", "soullink-next", "public", "images", "Background",
)
THUMB = os.path.join(PUBLIC, "thumbnails")

TARGET_WIDTH = 1920
THUMB_WIDTH = 200
JPEG_QUALITY = 85
THUMB_QUALITY = 80

# Curated Artemis II Earth-from-Orion photos. bg112..bg117.
# Verified against https://images-api.nasa.gov on 2026-05-19.
CURATED = [
    ("bg113", "art002e023506"),
    ("bg116", "art002e000180"),
]


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_meta(nasa_id):
    qs = urllib.parse.urlencode({"q": nasa_id, "media_type": "image"})
    payload = get_json(f"{API}/search?{qs}")
    for item in payload.get("collection", {}).get("items", []):
        data = (item.get("data") or [{}])[0]
        if data.get("nasa_id") == nasa_id:
            return {
                "title": data.get("title", ""),
                "center": data.get("center", ""),
                "date": (data.get("date_created", "") or "")[:10],
            }
    raise SystemExit(f"no metadata for {nasa_id}")


def fetch_image_url(nasa_id):
    manifest = get_json(f"{API}/asset/{nasa_id}")
    items = manifest.get("collection", {}).get("items", [])
    by_suffix = {}
    for it in items:
        href = it.get("href", "")
        for sfx in ("~orig.jpg", "~orig.jpeg", "~large.jpg", "~medium.jpg"):
            if href.lower().endswith(sfx):
                by_suffix.setdefault(sfx, href)
    for sfx in ("~orig.jpg", "~orig.jpeg", "~large.jpg", "~medium.jpg"):
        if sfx in by_suffix:
            return by_suffix[sfx]
    raise SystemExit(f"no usable image variant for {nasa_id}")


def download_bytes(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def process_one(bg_id, nasa_id):
    print(f"[{bg_id} <- {nasa_id}]")
    meta = fetch_meta(nasa_id)
    url = fetch_image_url(nasa_id)
    print(f"  title: {meta['title']}")
    print(f"  url:   {url}")
    raw = download_bytes(url)
    img = Image.open(io.BytesIO(raw))
    src_w, src_h = img.size
    print(f"  source: {src_w}x{src_h} ({len(raw)//1024} KB)")

    # Portrait -> landscape 3:2 center crop
    if src_h > src_w:
        new_h = int(src_w * 2 / 3)
        top = (src_h - new_h) // 2
        img = img.crop((0, top, src_w, top + new_h))
        print(f"  cropped: {img.size[0]}x{img.size[1]}")

    # Resize to TARGET_WIDTH
    w, h = img.size
    if w > TARGET_WIDTH:
        new_h = int(h * TARGET_WIDTH / w)
        img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)
        print(f"  resized: {img.size[0]}x{img.size[1]}")

    if img.mode != "RGB":
        img = img.convert("RGB")

    # Save full
    out_full = os.path.join(PUBLIC, f"{bg_id}.jpg")
    img.save(out_full, "JPEG", quality=JPEG_QUALITY, optimize=True)
    print(f"  saved:  {out_full} ({os.path.getsize(out_full)//1024} KB)")

    # Thumbnail
    thumb_h = int(img.size[1] * THUMB_WIDTH / img.size[0])
    thumb = img.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)
    out_thumb = os.path.join(THUMB, f"{bg_id}.jpg")
    thumb.save(out_thumb, "JPEG", quality=THUMB_QUALITY, optimize=True)
    print(f"  thumb:  {out_thumb} ({os.path.getsize(out_thumb)//1024} KB)")

    final_w, final_h = img.size
    return {
        "bg_id": bg_id,
        "style": "space",
        "license": "PD-NASA",
        "id": nasa_id,
        "accession": meta["center"],
        "title": meta["title"],
        "artist": "NASA",
        "date": meta["date"],
        "source_url": f"https://images.nasa.gov/details/{nasa_id}",
        "image_url": url,
        "w": final_w,
        "h": final_h,
        "src_file": f"nasa_{nasa_id}.jpg",
        "out_file": f"{bg_id}.jpg",
    }


def main():
    os.makedirs(THUMB, exist_ok=True)
    rows = []
    for bg_id, nasa_id in CURATED:
        rows.append(process_one(bg_id, nasa_id))
        time.sleep(0.4)
        print()

    print("=== manifest rows (append to public manifest.csv) ===")
    fields = [
        "bg_id", "style", "license", "id", "accession", "title", "artist",
        "date", "source_url", "image_url", "w", "h", "src_file", "out_file",
    ]
    buf = io.StringIO()
    wr = csv.DictWriter(buf, fieldnames=fields)
    for r in rows:
        wr.writerow({k: r.get(k, "") for k in fields})
    sys.stdout.write(buf.getvalue())


if __name__ == "__main__":
    main()
