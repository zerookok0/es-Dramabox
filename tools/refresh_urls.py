#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重新抓取每部剧的详情页，刷新剧集 mp4 签名地址（签名约一年到期，需要定期跑）。

用法:
    python tools/refresh_urls.py            # 刷新全部
    python tools/refresh_urls.py 20         # 只刷新 20 部（试跑）

刷新后执行: python tools/pack.py && python tools/mirror.py pages assets && node scripts/build.mjs
"""
import os, sys, json, glob, queue, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl import get, next_data, BASE  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "books")
SITE_DATA = os.path.join(ROOT, "site", "data", "books")
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 0


def main():
    files = sorted(glob.glob(os.path.join(DATA, "*.json")))
    if LIMIT:
        files = files[:LIMIT]
    q = queue.Queue()
    for f in files:
        q.put(f)
    total = q.qsize()
    stats = {"ok": 0, "fail": 0, "urls": 0}
    lock = threading.Lock()

    def worker():
        while True:
            try:
                f = q.get_nowait()
            except queue.Empty:
                return
            d = json.load(open(f, encoding="utf-8"))
            bi = d.get("bookInfo") or {}
            bid = bi.get("bookId")
            slug = bi.get("bookNameEn") or "drama"
            h = get(f"{BASE}/es/drama/{bid}/{slug}", retries=2)
            ok = False
            if h:
                nd = next_data(h.decode("utf-8", "replace"))
                pp = (nd or {}).get("props", {}).get("pageProps", {}) or {}
                cl = pp.get("chapterList") or []
                if cl:
                    n = sum(1 for c in cl if c.get("mp4"))
                    d["chapterList"] = cl
                    json.dump(d, open(f, "w", encoding="utf-8"), ensure_ascii=False)
                    # 同步到 site/data（运行时读取的那份）
                    sp = os.path.join(SITE_DATA, f"{bid}.json")
                    if os.path.exists(sp):
                        sd = json.load(open(sp, encoding="utf-8"))
                        sd["chapterList"] = [{
                            "id": c.get("id"), "index": c.get("index"),
                            "unlock": bool(c.get("unlock")), "mp4": c.get("mp4") or "",
                            "cover": c.get("cover") or "", "duration": c.get("duration") or 0,
                            "price": c.get("chapterPrice") or 0,
                        } for c in cl]
                        json.dump(sd, open(sp, "w", encoding="utf-8"), ensure_ascii=False,
                                  separators=(",", ":"))
                    with lock:
                        stats["urls"] += n
                    ok = True
            with lock:
                stats["ok" if ok else "fail"] += 1
                done = stats["ok"] + stats["fail"]
                if done % 50 == 0:
                    print(f"[{done}/{total}] ok={stats['ok']} fail={stats['fail']} urls={stats['urls']}", flush=True)

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(6)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    print(f"REFRESH DONE ok={stats['ok']} fail={stats['fail']} signed_urls={stats['urls']}")


if __name__ == "__main__":
    main()
