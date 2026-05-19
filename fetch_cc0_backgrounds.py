#!/usr/bin/env python3
"""
fetch_cc0_backgrounds.py
SoulLink — bulk-fetch CC0, license-clean watercolor / ink-wash landscape
backgrounds from the Cleveland Museum of Art Open Access API.

WHY THIS SCRIPT EXISTS
  Claude cannot run this for you: its sandbox network only reaches package
  registries + GitHub, not museum image hosts. Run this on your own machine
  or in your Codespace, where there is no domain allowlist.

WHAT IT GUARANTEES
  - Downloads ONLY works whose API record says share_license_status == "CC0"
    (CC0 = commercial use OK, no attribution required). Anything else skipped.
  - Writes manifest.csv (id, accession, title, artist, date, license,
    source_url, image_url, w, h) so every asset has documented provenance
    for investor / legal diligence.

WHAT IT CANNOT DO
  - It can't see the pictures. Keyword search returns a *range*; you still do
    one fast visual cull against the aesthetic rubric before shipping.

USAGE
  python3 fetch_cc0_backgrounds.py --out ./bg --target 200 --min-width 1600

Then: visual cull -> run your ③ normalization prompt over the kept set
(incl. custom-upload pipeline) -> write the freeze line in CLAUDE.md. Done.
"""

import argparse, csv, json, os, sys, time, urllib.parse, urllib.request

API = "https://openaccess-api.clevelandart.org/api/artworks"

# Search terms grouped by aesthetic style. Pick a group with --style.
# Edit freely; more terms = wider net. CC0 gate (line ~127) is unchanged.

INK_QUERIES = [
    "Ni Zan", "Mi Fu", "Mi Youren", "Ma Yuan", "Xia Gui",
    "Wen Zhengming", "Dong Qichang", "Huang Gongwang", "Shitao",
    "literati landscape", "ink landscape", "misty mountains",
    "river landscape ink", "album leaf landscape",
    "Sesshu", "Shubun", "nanga", "splashed ink landscape",
]

IMPRESSIONIST_QUERIES = [
    "Claude Monet", "Vincent van Gogh", "Paul Cezanne", "Camille Pissarro",
    "Pierre-Auguste Renoir", "Alfred Sisley", "Berthe Morisot",
    "Edgar Degas", "Mary Cassatt", "Eugene Boudin",
    "James McNeill Whistler", "Pierre Bonnard", "Edouard Vuillard",
    "Paul Signac", "Georges Seurat",
    "impressionist landscape", "post-impressionist landscape",
    "haystack", "water lilies", "Giverny",
]

# Soft watercolor / luminist / tonalist / plein-air landscape painters.
# Tighter than IMPRESSIONIST_QUERIES — aim for delicate wash, not impasto.
WATERCOLOR_QUERIES = [
    # American luminist / Hudson River / watercolor
    "Winslow Homer watercolor", "John Singer Sargent watercolor",
    "Thomas Doughty", "Thomas Moran", "Childe Hassam",
    "George Inness", "Maxfield Parrish landscape",
    # French Barbizon / soft impressionist
    "Camille Corot landscape", "Charles-Francois Daubigny",
    "Eugene Boudin coast", "Henri-Joseph Harpignies",
    "Theodore Rousseau landscape",
    # British watercolor masters
    "John Sell Cotman", "John Varley", "Peter De Wint",
    "Joseph Mallord William Turner watercolor",
    "David Cox landscape",
    # Tonalist / general
    "James McNeill Whistler nocturne",
    "watercolor landscape", "watercolour landscape",
    "plein air landscape", "tonalist landscape",
    "marine watercolor", "coastal watercolor",
]

# Monet-only deep dive. The iconic "Impression, Sunrise" (1872) lives at
# the Musée Marmottan (Paris) and is NOT in CMA OpenAccess, so this set
# focuses on what CMA actually holds: water lilies, Giverny garden,
# Etretat coast, Argenteuil sails, Rouen cathedral, haystacks.
MONET_QUERIES = [
    "Claude Monet", "Monet water lilies", "Monet Giverny",
    "Monet Etretat", "Monet Argenteuil", "Monet Rouen",
    "Monet haystack", "Monet poplars", "Monet Vetheuil",
    "Monet garden", "Monet pond", "Monet Seine",
]

STYLE_GROUPS = {
    "ink": INK_QUERIES,
    "impressionist": IMPRESSIONIST_QUERIES,
    "watercolor": WATERCOLOR_QUERIES,
    "monet": MONET_QUERIES,
}
# Backwards-compat alias used elsewhere in the file
QUERIES = INK_QUERIES

HEADERS = {"User-Agent": "SoulLink-bg-fetch/1.0 (research; CC0 only)"}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def query(term, page_limit=100):
    """Yield CC0 artwork records for one search term, paginating."""
    skip = 0
    while True:
        qs = urllib.parse.urlencode({
            "q": term, "type": "Painting", "cc0": 1,
            "has_image": 1, "limit": page_limit, "skip": skip,
        })
        try:
            payload = get_json(f"{API}?{qs}")
        except Exception as e:
            print(f"  ! query failed ({term}, skip={skip}): {e}")
            return
        data = payload.get("data", [])
        if not data:
            return
        for rec in data:
            yield rec
        got = len(data)
        skip += got
        if got < page_limit:
            return
        time.sleep(0.4)


def pick_image(rec):
    """Prefer print > full > web; return (url, w, h) or (None, 0, 0)."""
    imgs = rec.get("images") or {}
    for k in ("print", "full", "web"):
        if k in imgs and imgs[k] and imgs[k].get("url"):
            i = imgs[k]
            try:
                w, h = int(i.get("width", 0)), int(i.get("height", 0))
            except (TypeError, ValueError):
                w, h = 0, 0
            return i["url"], w, h
    return None, 0, 0


def artist_of(rec):
    cr = rec.get("creators") or []
    return cr[0].get("description", "").strip() if cr else "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./bg")
    ap.add_argument("--target", type=int, default=200,
                    help="stop after this many downloaded")
    ap.add_argument("--min-width", type=int, default=1400,
                    help="skip images narrower than this (UI backgrounds)")
    ap.add_argument("--landscape-only", action="store_true",
                    help="only keep images where width >= height")
    ap.add_argument("--style", choices=list(STYLE_GROUPS.keys()), default="ink",
                    help="which curated query group to run")
    args = ap.parse_args()
    queries = STYLE_GROUPS[args.style]

    os.makedirs(args.out, exist_ok=True)
    seen, rows, n = set(), [], 0
    mpath = os.path.join(args.out, "manifest.csv")

    with open(mpath, "w", newline="", encoding="utf-8") as mf:
        wr = csv.writer(mf)
        wr.writerow(["id", "accession", "title", "artist", "date",
                     "license", "source_url", "image_url", "w", "h", "file"])

        for term in queries:
            if n >= args.target:
                break
            print(f"[query] {term}")
            for rec in query(term):
                if n >= args.target:
                    break
                rid = rec.get("id")
                if rid in seen:
                    continue
                if rec.get("share_license_status") != "CC0":   # hard gate
                    continue
                url, w, h = pick_image(rec)
                if not url:
                    continue
                if w and args.min_width and w < args.min_width:
                    continue
                if args.landscape_only and w and h and w < h:
                    continue
                seen.add(rid)
                ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".jpg"
                fname = f"cma_{rec.get('accession_number','')}_{rid}{ext}".replace("/", "-")
                fpath = os.path.join(args.out, fname)
                try:
                    req = urllib.request.Request(url, headers=HEADERS)
                    with urllib.request.urlopen(req, timeout=60) as resp, \
                            open(fpath, "wb") as fh:
                        fh.write(resp.read())
                except Exception as e:
                    print(f"  ! download failed {rid}: {e}")
                    continue
                rows_data = [
                    rid, rec.get("accession_number", ""),
                    rec.get("title", ""), artist_of(rec),
                    rec.get("creation_date", ""), "CC0",
                    rec.get("url", ""), url, w, h, fname,
                ]
                wr.writerow(rows_data)
                mf.flush()
                n += 1
                print(f"  [{n}/{args.target}] {fname}")
                time.sleep(0.5)

    print(f"\nDone. {n} CC0 images -> {args.out}")
    print(f"Manifest: {mpath}")
    print("Next: visual cull -> ③ normalization -> freeze in CLAUDE.md.")


if __name__ == "__main__":
    main()
