#!/usr/bin/env python3
"""
fetch_cc0_met.py — bulk-fetch CC0 paintings from The Metropolitan Museum
of Art's Open Access API. Sister script to fetch_cc0_backgrounds.py
(which targets Cleveland Museum). Same hard-gate philosophy: NO non-CC0
artwork enters the manifest.

Met API: https://collectionapi.metmuseum.org/public/collection/v1
  /search?q=<term>&hasImages=true&isPublicDomain=true   → list of object IDs
  /objects/<id>                                          → details

Met's "Open Access" program licenses all flagged works under CC0
(https://www.metmuseum.org/about-the-met/policies-and-documents/open-access).
The hard gate at line ~80 (`if not rec.get("isPublicDomain"): continue`)
mirrors fetch_cc0_backgrounds.py line 127 and must not be relaxed.

USAGE
  python3 fetch_cc0_met.py --query "Monet" --out ./bg_met --target 30 \
                          --min-width 1400 --landscape-only --paintings-only
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

API = "https://collectionapi.metmuseum.org/public/collection/v1"
HEADERS = {"User-Agent": "SoulLink-bg-fetch/1.0 (research; CC0 only)"}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search(term):
    qs = urllib.parse.urlencode({
        "q": term, "hasImages": "true", "isPublicDomain": "true",
    })
    try:
        payload = get_json(f"{API}/search?{qs}")
    except Exception as e:
        print(f"  ! search failed: {e}")
        return []
    return payload.get("objectIDs") or []


def get_object(oid):
    try:
        return get_json(f"{API}/objects/{oid}")
    except Exception as e:
        print(f"  ! object fetch failed {oid}: {e}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True, help="search term, e.g. 'Monet'")
    ap.add_argument("--out", default="./bg_met")
    ap.add_argument("--target", type=int, default=30)
    ap.add_argument("--min-width", type=int, default=1400)
    ap.add_argument("--landscape-only", action="store_true")
    ap.add_argument("--paintings-only", action="store_true",
                    help="require classification == 'Paintings'")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    mpath = os.path.join(args.out, "manifest.csv")

    object_ids = search(args.query)
    print(f"Met search '{args.query}': {len(object_ids)} hits")

    with open(mpath, "w", newline="", encoding="utf-8") as mf:
        wr = csv.writer(mf)
        wr.writerow(["id", "accession", "title", "artist", "date",
                     "license", "source_url", "image_url", "w", "h", "file"])

        n = 0
        for oid in object_ids:
            if n >= args.target:
                break
            rec = get_object(oid)
            if not rec:
                continue
            if not rec.get("isPublicDomain"):    # hard gate (Met CC0)
                continue
            if args.paintings_only and rec.get("classification") != "Paintings":
                continue
            url = rec.get("primaryImage")
            if not url:
                continue
            # Download to check dimensions (Met API doesn't expose them).
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                img = Image.open(BytesIO(raw))
                w, h = img.size
            except Exception as e:
                print(f"  ! download failed {oid}: {e}")
                continue
            if w and args.min_width and w < args.min_width:
                print(f"  - skip {oid}: width {w} < {args.min_width}")
                continue
            if args.landscape_only and w and h and w < h:
                print(f"  - skip {oid}: portrait {w}x{h}")
                continue
            acc = rec.get("accessionNumber", "")
            artist = rec.get("artistDisplayName", "unknown") or "unknown"
            title = rec.get("title", "")
            date = rec.get("objectDate", "")
            source = rec.get("objectURL", "")
            fname = f"met_{acc}_{oid}.jpg".replace("/", "-").replace(" ", "")
            fpath = os.path.join(args.out, fname)
            with open(fpath, "wb") as fh:
                fh.write(raw)
            wr.writerow([oid, acc, title, artist, date, "CC0",
                         source, url, w, h, fname])
            mf.flush()
            n += 1
            print(f"  [{n}/{args.target}] {fname}  ({w}x{h}, {len(raw)//1024}KB)")
            time.sleep(0.6)

    print(f"\nDone. {n} CC0 images -> {args.out}")
    print(f"Manifest: {mpath}")


if __name__ == "__main__":
    main()
