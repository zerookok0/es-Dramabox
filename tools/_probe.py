# -*- coding: utf-8 -*-
import sys, os, ssl, urllib.request, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
                                 urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [("User-Agent", UA),
                 ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
                 ("Accept-Language", "es-ES,es;q=0.9,en;q=0.8")]
for u in sys.argv[1:]:
    try:
        t = time.time()
        with op.open(u, timeout=40) as r:
            d = r.read()
        print(f"OK  {r.status} {len(d):>8} {time.time()-t:.1f}s {u}")
    except Exception as e:
        print(f"ERR {e} {u}")
