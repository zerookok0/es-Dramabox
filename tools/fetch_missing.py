#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch detail pages for book ids referenced by mirrored pages but missing in data/."""
import os, re, sys, json, glob, queue, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl import get, next_data, BASE, RAW  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def main():
    have = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(DATA, "books", "*.json"))}
    refs = {}
    pat = re.compile(r'/es/(?:drama|video)/(\d+)[_/]([A-Za-z0-9\-%_.]+)')
    for f in glob.glob(os.path.join(RAW, "**", "*.html"), recursive=True):
        s = open(f, encoding="utf-8", errors="replace").read()
        for bid, slug in pat.findall(s):
            if bid not in have:
                refs.setdefault(bid, slug)
    print(f"have={len(have)} missing_refs={len(refs)}")
    if not refs:
        return
    os.makedirs(os.path.join(DATA, "books"), exist_ok=True)
    os.makedirs(os.path.join(RAW, "books"), exist_ok=True)
    q = queue.Queue()
    for bid, slug in refs.items():
        q.put((bid, slug))
    ok = [0]

    def worker():
        while True:
            try:
                bid, slug = q.get_nowait()
            except queue.Empty:
                return
            h = get(f"{BASE}/es/drama/{bid}/{slug}", retries=2)
            if h:
                nd = next_data(h.decode("utf-8", "replace"))
                if nd and (nd.get("props", {}).get("pageProps", {}) or {}).get("bookInfo"):
                    json.dump(nd["props"]["pageProps"],
                              open(os.path.join(DATA, "books", f"{bid}.json"), "w", encoding="utf-8"),
                              ensure_ascii=False)
                    open(os.path.join(RAW, "books", f"{bid}.html"), "wb").write(h)
                    ok[0] += 1

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(6)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    print(f"fetched {ok[0]}")


if __name__ == "__main__":
    main()
