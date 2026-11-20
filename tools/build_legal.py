# -*- coding: utf-8 -*-
"""Fetch legal/static pages through local proxy into raw/legal/ with readable names."""
import os, sys, ssl, random, string, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "legal")
PROXY = os.environ.get("DB_PROXY", "http://127.0.0.1:7890")
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
HDRS = [
    ("User-Agent", UA),
    ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
    ("Accept-Language", "es-ES,es;q=0.9,en;q=0.8"),
    ("Upgrade-Insecure-Requests", "1"),
]

PAGES = [
    ("terms",    "https://support.dramaboxdb.com/terms.html?language=es"),
    ("privacy",  "https://support.dramaboxdb.com/privacy.html?language=es"),
    ("cookie",   "https://support.dramaboxdb.com/cookie-policy.html?language=es"),
    ("download", "https://www.dramabox.com/es/download"),
    ("business", "https://www.dramabox.com/es/business"),
    ("dpo",      "https://www.dramabox.com/es/dpo"),
]

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def make_opener():
    op = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPSHandler(context=ctx),
    )
    op.addheaders = list(HDRS)
    return op


def rand_qs(url):
    s = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return url + ("&" if "?" in url else "?") + "_r=" + s


def get(url, retries=3):
    op = make_opener()
    last = None
    for i in range(retries):
        try:
            with op.open(url, timeout=40) as r:
                return r.read(), r.status
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429, 503):
                time.sleep(1.0 + i)
                continue
            break
        except Exception as e:
            last = e
            time.sleep(1.2 * (i + 1))
    raise RuntimeError(f"{url} -> {last}")


def fetch_page(url):
    """Fetch; on 403/429/503 retry with a random query parameter."""
    try:
        return get(url), url
    except RuntimeError as e:
        msg = str(e)
        if any(c in msg for c in ("403", "429", "503", "Forbidden", "Too Many")):
            u2 = rand_qs(url)
            print(f"  retry with nonce: {u2}")
            return get(u2), u2
        raise


def main():
    os.makedirs(RAW, exist_ok=True)
    ok = 0
    for name, url in PAGES:
        out = os.path.join(RAW, name + ".html")
        try:
            (data, status), used = fetch_page(url)
        except Exception as e:
            print(f"ERR  {name:<9} {e}")
            continue
        if not data or len(data) < 500:
            print(f"ERR  {name:<9} short body {len(data or b'')}B {url}")
            continue
        with open(out, "wb") as f:
            f.write(data)
        ok += 1
        print(f"OK   {name:<9} {status} {len(data):>8}B  {used}")
    print(f"\nfetched {ok}/{len(PAGES)} -> {RAW}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
