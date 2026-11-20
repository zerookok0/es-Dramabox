#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch one watch page per book (first episode) — becomes the per-book player page."""
import os, re, sys, json, glob, queue, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl import get, next_data, BASE, RAW  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(RAW, "video")
THREADS = int(os.environ.get("THREADS", "6"))


def targets():
    out = []
    for f in glob.glob(os.path.join(DATA, "books", "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        bi = d.get("bookInfo") or {}
        cl = d.get("chapterList") or []
        if not bi.get("bookId") or not cl:
            continue
        ch = cl[0]
        bid = bi["bookId"]
        slug = (bi.get("bookNameEn") or "drama")
        bslug = f"{bid}_{slug}"
        ep = f"{ch['id']}_Episode-{ch['index'] + 1}"
        out.append((bslug, ep, f"{BASE}/es/video/{bslug}/{ep}"))
    return out


def safe(bslug):
    return re.sub(r"[^0-9A-Za-z._-]", "_", bslug)


def main():
    os.makedirs(OUT, exist_ok=True)
    items = targets()
    q = queue.Queue()
    for it in items:
        p = os.path.join(OUT, safe(it[0]) + ".html")
        if os.path.exists(p) and os.path.getsize(p) > 5000:
            continue
        q.put((it, p))
    total = q.qsize()
    print(f"video pages to fetch: {total}/{len(items)}", flush=True)
    done = [0]
    lock = threading.Lock()

    def worker():
        while True:
            try:
                (bslug, ep, url), p = q.get_nowait()
            except queue.Empty:
                return
            h = get(url, retries=2)
            if h and len(h) > 5000:
                open(p, "wb").write(h)
                ok = True
            else:
                ok = False
            with lock:
                done[0] += 1
                if done[0] % 50 == 0 or not ok:
                    print(f"[{done[0]}/{total}] {'ok' if ok else 'FAIL'} {bslug.encode('ascii','replace').decode()}", flush=True)

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(THREADS)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    got = len(glob.glob(os.path.join(OUT, "*.html")))
    print(f"VIDEO DONE {got}")


if __name__ == "__main__":
    main()
