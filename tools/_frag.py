# -*- coding: utf-8 -*-
"""Fetch Spanish legal fragments (SSR content lives in /version/<ver>/<doc>/es.htm)."""
import os, sys, ssl, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "raw", "legal")
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")

FRAGS = [
    ("terms.es.htm",   "https://support.dramaboxdb.com/version/v1_6_20260527/terms/es.htm"),
    ("privacy.es.htm", "https://support.dramaboxdb.com/version/v1_7_20260718/privacy/es.htm"),
    ("cookie.es.htm",  "https://support.dramaboxdb.com/version/v1_0_20251211/cookie-policy/es.htm"),
]

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
op = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
    urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [("User-Agent", UA), ("Accept-Language", "es-ES,es;q=0.9"),
                 ("Accept", "text/html,*/*;q=0.8")]

for name, url in FRAGS:
    try:
        with op.open(url, timeout=40) as r:
            d = r.read()
        open(os.path.join(OUT, name), "wb").write(d)
        print(f"OK  {name:<16} {len(d):>8}B {url}")
    except Exception as e:
        print(f"ERR {name:<16} {e}")
