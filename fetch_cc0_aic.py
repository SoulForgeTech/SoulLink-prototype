#!/usr/bin/env python3
"""
fetch_cc0_aic.py — bulk-fetch CC0 paintings from the Art Institute of
Chicago. Sister to fetch_cc0_backgrounds.py (CMA) and fetch_cc0_met.py
(Met). Same hard-gate philosophy: NO non-CC0 artwork enters the manifest.

AIC API: https://api.artic.edu/api/v1
  /artworks/search?q=<term>&query[term][is_public_domain]=true&fields=...
  IIIF images: https://www.artic.edu/iiif/2/<image_id>/full/<size>/0/default.jpg

AIC's `is_public_domain=true` maps to CC0 1.0 Universal (per their Open
Access policy: https://www.artic.edu/open-access/open-access-images).
The hard gate at line ~80 mirrors line 127 in fetch_cc0_backgrounds.py
and must not be relaxed.

USAGE
  python3 fetch_cc0_aic.py --query "Claude Monet" --artist-prefix "Claude Monet" \
                          --out ./bg_aic --target 30 --min-width 1600 \
                          --landscape-only --paintings-only
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

API = "https://api.artic.edu/api/v1"
IIIF = "https://www.artic.edu/iiif/2"
HEADERS = {"User-Agent": "SoulLink-bg-fetch/1.0 (research; CC0 only)"}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search(term, limit=100):
    qs = urllib.parse.urlencode({
        "q": term,
        "query[term][is_public_domain]": "true",
        "fields": "id,title,artist_display,is_public_domain,"
                  "classification_title,image_id,date_display,"
                  "main_reference_number,artwork_type_title",
        "limit": str(limit),
    })
    try:
        return get_json(f"{API}/artworks/search?{qs}")
    except Exception as e:
        print(f"  ! search failed: {e}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True, help="search term")
    ap.add_argument("--artist-prefix", default=None,
                    help="require artist_display to start with this string")
    ap.add_argument("--out", default="./bg_aic")
    ap.add_argument("--target", type=int, default=30)
    ap.add_argument("--min-width", type=int, default=1400)
    ap.add_argument("--landscape-only", action="store_true")
    ap.add_argument("--paintings-only", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    mpath = os.path.join(args.out, "manifest.csv")

    payload = search(args.query, limit=100)
    if not payload:
        sys.exit(1)
    hits = payload.get("data", [])
    print(f"AIC search '{args.query}': {len(hits)} hits (total {payload.get('pagination',{}).get('total','?')})")

    with open(mpath, "w", newline="", encoding="utf-8") as mf:
        wr = csv.writer(mf)
        wr.writerow(["id", "accession", "title", "artist", "date",
                     "license", "source_url", "image_url", "w", "h", "file"])

        n = 0
        for rec in hits:
            if n >= args.target:
                break
            if not rec.get("is_public_domain"):    # hard gate (AIC CC0)
                continue
            if args.artist_prefix and not (rec.get("artist_display") or "").startswith(args.artist_prefix):
                continue
            if args.paintings_only:
                ct = (rec.get("classification_title") or "").lower()
                at = (rec.get("artwork_type_title") or "").lower()
                if "painting" not in ct and "painting" not in at and "canvas" not in ct:
                    continue
            image_id = rec.get("image_id")
            if not image_id:
                continue
            url = f"{IIIF}/{image_id}/full/1843,/0/default.jpg"
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                img = Image.open(BytesIO(raw))
                w, h = img.size
            except Exception as e:
                print(f"  ! download failed {rec.get('id')}: {e}")
                continue
            if w and args.min_width and w < args.min_width:
                print(f"  - skip {rec.get('id')}: width {w} < {args.min_width}")
                continue
            if args.landscape_only and w and h and w < h:
                print(f"  - skip {rec.get('id')}: portrait {w}x{h}")
                continue
            acc = rec.get("main_reference_number", "")
            artist = rec.get("artist_display", "unknown") or "unknown"
            title = rec.get("title", "")
            date = rec.get("date_display", "")
            source = f"https://www.artic.edu/artworks/{rec.get('id')}"
            fname = f"aic_{acc}_{rec.get('id')}.jpg".replace("/", "-").replace(" ", "")
            fpath = os.path.join(args.out, fname)
            with open(fpath, "wb") as fh:
                fh.write(raw)
            wr.writerow([rec.get("id"), acc, title, artist, date, "CC0",
                         source, url, w, h, fname])
            mf.flush()
            n += 1
            print(f"  [{n}/{args.target}] {fname}  ({w}x{h}, {len(raw)//1024}KB)")
            time.sleep(0.4)

    print(f"\nDone. {n} CC0 images -> {args.out}")
    print(f"Manifest: {mpath}")


if __name__ == "__main__":
    main()
