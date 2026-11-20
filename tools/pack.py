#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pack crawled JSON into deployable data files under site/data/."""
import os, re, sys, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
BOOKS = os.path.join(ROOT, "data", "books")
OUT = os.path.join(SITE, "data")


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", name or "").strip("-")
    return s


def main():
    os.makedirs(os.path.join(OUT, "books"), exist_ok=True)
    idx = []
    for f in sorted(glob.glob(os.path.join(BOOKS, "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        bi = d.get("bookInfo") or {}
        if not bi.get("bookId"):
            continue
        bid = bi["bookId"]
        slug = bi.get("bookNameEn") or slugify(bi.get("bookName"))
        chapters = []
        for c in d.get("chapterList") or []:
            chapters.append({
                "id": c.get("id"), "index": c.get("index"), "unlock": bool(c.get("unlock")),
                "mp4": c.get("mp4") or "", "cover": c.get("cover") or "",
                "duration": c.get("duration") or 0, "price": c.get("chapterPrice") or 0,
            })
        payload = {
            "bookInfo": bi,
            "chapterList": chapters,
            "slug": slug,
        }
        with open(os.path.join(OUT, "books", f"{bid}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        idx.append({
            "bookId": bid,
            "slug": slug,
            "name": bi.get("bookName"),
            "cover": bi.get("cover"),
            "introduction": (bi.get("introduction") or "")[:400],
            "chapterCount": bi.get("chapterCount"),
            "viewCount": bi.get("viewCount"),
            "typeTwoId": (bi.get("typeTwoIds") or [None])[0],
            "typeTwoName": bi.get("typeTwoName"),
        })
    # categories from browse page
    cats = []
    try:
        p = os.path.join(ROOT, "raw", "www.dramabox.com__es__browse.html")
        h = open(p, encoding="utf-8", errors="replace").read()
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', h, re.S)
        pp = json.loads(m.group(1))["props"]["pageProps"]
        cats = [{"id": t.get("id"), "name": t.get("name")} for t in (pp.get("types") or [])]
    except Exception as e:
        print("category parse failed", e, file=sys.stderr)
    json.dump({"books": idx, "categories": cats}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"packed books={len(idx)} categories={len(cats)}")


if __name__ == "__main__":
    main()
