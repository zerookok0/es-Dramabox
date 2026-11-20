#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch all listing pages (/es/browse/all/N and /es/browse/<catId>) + more pages."""
import os, re, sys, queue, threading, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl import get, next_data, BASE, RAW  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA_SAFE = re.compile(r"[^0-9A-Za-z._-]")


def safe(url: str) -> str:
    name = url.split("://", 1)[-1].replace("/", "__")
    name = name.replace("?", "_").replace("=", "_").replace("&", "_")
    name = UA_SAFE.sub("_", name)
    return name + (".html" if not name.endswith(".html") else "")


def urls():
    out = [f"{BASE}/es/browse/all/{n}" for n in range(1, 147)]
    try:
        h = open(os.path.join(RAW, "www.dramabox.com__es__browse.html"), encoding="utf-8", errors="replace").read()
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', h, re.S)
        pp = json.loads(m.group(1))["props"]["pageProps"]
        for t in pp.get("types") or []:
            out.append(f"{BASE}/es/browse/{t['id']}")
    except Exception as e:
        print("cat parse fail", e, file=sys.stderr)
    out += [f"{BASE}/es/more/{k}" for k in ("trending", "must-sees", "hidden-gems")]
    out += [f"{BASE}/es/business", f"{BASE}/es/dpo"]
    return out


def main():
    items = urls()
    q = queue.Queue()
    for u in items:
        p = os.path.join(RAW, safe(u))
        if os.path.exists(p) and os.path.getsize(p) > 5000:
            continue
        q.put((u, p))
    total = q.qsize()
    print(f"listing fetch: {total}/{len(items)}", flush=True)
    done = [0]
    lock = threading.Lock()

    def worker():
        while True:
            try:
                u, p = q.get_nowait()
            except queue.Empty:
                return
            h = get(u, retries=2)
            if h and len(h) > 5000:
                open(p, "wb").write(h)
            with lock:
                done[0] += 1
                if done[0] % 25 == 0:
                    print(f"[{done[0]}/{total}]", flush=True)

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(6)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    print("LISTING PAGES DONE")


if __name__ == "__main__":
    main()
