#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crawl dramabox.com/es: listing pages -> book detail pages -> raw HTML + JSON."""
import os, re, sys, json, time, ssl, threading, queue
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
DATA = os.path.join(ROOT, "data")
PROXY = os.environ.get("DB_PROXY", "")  # 留空=直连（GitHub Actions / 海外机器）；本机需要代理时设 DB_PROXY
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
BASE = "https://www.dramabox.com"
SLUGS = {}
THREADS = int(os.environ.get("THREADS", "5"))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def make_opener():
    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if PROXY:
        handlers.insert(0, urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    o = urllib.request.build_opener(*handlers)
    o.addheaders = [
        ("User-Agent", UA),
        ("Accept", "text/html,application/xhtml+xml,*/*;q=0.8"),
        ("Accept-Language", "es-ES,es;q=0.9,en;q=0.8"),
    ]
    return o


TLS = threading.local()


def get(url, retries=3):
    if not hasattr(TLS, "op"):
        TLS.op = make_opener()
    for i in range(retries):
        try:
            with TLS.op.open(url, timeout=35) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                return None
            time.sleep(1.5 * (i + 1))
    return None


def next_data(html: str):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def listing_url(page_no: int) -> str:
    return f"{BASE}/es/browse/all/{page_no}"


def stage_listing():
    os.makedirs(DATA, exist_ok=True)
    out = os.path.join(DATA, "listing.json")
    books, seen, pages = [], set(), 1
    if os.path.exists(out):
        d = json.load(open(out, encoding="utf-8"))
        books, seen = d["books"], {b["bookId"] for b in d["books"]}
        SLUGS.update(d.get("slugs") or {})
        print(f"resume listing: {len(books)} books")
    page = 1
    while page <= pages:
        html = get(listing_url(page))
        if not html:
            print(f"listing page {page} failed", file=sys.stderr)
            page += 1
            continue
        txt = html.decode("utf-8", "replace")
        nd = next_data(txt)
        if not nd:
            page += 1
            continue
        for bid, slug in re.findall(r'/es/drama/(\d+)/([A-Za-z0-9\-%_.]+)', txt):
            SLUGS.setdefault(bid, slug)
        pp = nd["props"]["pageProps"]
        pages = pp.get("pages", pages)
        for b in pp.get("bookList") or []:
            bid = str(b.get("bookId") or b.get("id") or "")
            if bid and bid not in seen:
                seen.add(bid)
                books.append({
                    "bookId": bid,
                    "bookName": b.get("bookName") or b.get("name"),
                    "cover": b.get("cover"),
                    "introduction": b.get("introduction"),
                    "typeTwoId": b.get("typeTwoId"),
                    "typeTwoName": b.get("typeTwoName"),
                    "chapterCount": b.get("chapterCount"),
                    "viewCount": b.get("viewCount"),
                })
        json.dump({"pages": pages, "books": books, "slugs": SLUGS}, open(out, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=0)
        print(f"listing {page}/{pages} total={len(books)}", flush=True)
        page += 1
    print(f"LISTING DONE pages={pages} books={len(books)}")


def detail_slug_map():
    """Slug per book: scrape from listing HTML anchors of page 1 (fallback)."""
    return {}


def stage_details():
    os.makedirs(os.path.join(DATA, "books"), exist_ok=True)
    os.makedirs(os.path.join(RAW, "books"), exist_ok=True)
    listing = json.load(open(os.path.join(DATA, "listing.json"), encoding="utf-8"))
    books = listing["books"]
    SLUGS.update(listing.get("slugs") or {})
    print(f"slugs known: {len(SLUGS)}")
    q = queue.Queue()
    for b in books:
        bid = b["bookId"]
        p = os.path.join(DATA, "books", f"{bid}.json")
        if os.path.exists(p) and os.path.getsize(p) > 500:
            continue
        q.put(bid)

    total = q.qsize()
    done = [0]
    lock = threading.Lock()

    def worker():
        while True:
            try:
                bid = q.get_nowait()
            except queue.Empty:
                return
            # find slug: try direct probe with generic slug - Next.js resolves by id
            slug = SLUGS.get(bid) or ""
            url = f"{BASE}/es/drama/{bid}/{slug}" if slug else f"{BASE}/es/drama/{bid}"
            html = get(url, retries=2)
            ok = False
            if html:
                nd = next_data(html.decode("utf-8", "replace"))
                if nd:
                    pp = nd["props"]["pageProps"]
                    if pp.get("bookInfo"):
                        json.dump(pp, open(os.path.join(DATA, "books", f"{bid}.json"), "w",
                                           encoding="utf-8"), ensure_ascii=False)
                        open(os.path.join(RAW, "books", f"{bid}.html"), "wb").write(html)
                        ok = True
            with lock:
                done[0] += 1
                if done[0] % 25 == 0 or not ok:
                    print(f"[{done[0]}/{total}] {'ok' if ok else 'FAIL'} {bid}", flush=True)
            q.task_done()

    ths = [threading.Thread(target=worker, daemon=True) for _ in range(THREADS)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    print("DETAILS DONE")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("listing", "all"):
        stage_listing()
    if what in ("details", "all"):
        stage_details()
