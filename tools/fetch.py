#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch pages through local proxy, save raw HTML for mirroring."""
import os, sys, re, time, ssl, json
import urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
PROXY = os.environ.get("DB_PROXY", "")
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
_h = [urllib.request.HTTPSHandler(context=ctx)]
if PROXY:
    _h.insert(0, urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
opener = urllib.request.build_opener(*_h)
opener.addheaders = [
    ("User-Agent", UA),
    ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
    ("Accept-Language", "es-ES,es;q=0.9,en;q=0.8"),
]


def safe_name(url: str) -> str:
    u = url.split("://", 1)[-1]
    u = re.sub(r"[?&=#%]", "_", u)
    u = re.sub(r"[^0-9A-Za-z._/-]", "_", u)
    u = u.strip("/").replace("/", "__")
    if not u.endswith(".html"):
        u += ".html"
    return u[:180]


def fetch(url: str, out: str | None = None, retries: int = 3) -> bytes | None:
    for i in range(retries):
        try:
            with opener.open(url, timeout=30) as r:
                data = r.read()
                if out:
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    with open(out, "wb") as f:
                        f.write(data)
                return data
        except Exception as e:
            if i == retries - 1:
                print(f"FAIL {url} {e}", file=sys.stderr)
                return None
            time.sleep(1.2 * (i + 1))
    return None


def main():
    os.makedirs(RAW, exist_ok=True)
    urls = [a for a in sys.argv[1:] if a.startswith("http")]
    if not urls:
        urls = [l.strip() for l in sys.stdin if l.strip().startswith("http")]
    for u in urls:
        out = os.path.join(RAW, safe_name(u))
        if os.path.exists(out) and os.path.getsize(out) > 2000:
            print(f"SKIP {u}")
            continue
        d = fetch(u, out)
        print(f"{'OK ' if d else 'ERR'} {len(d) if d else 0:>8} {u}")


if __name__ == "__main__":
    main()
