#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transform mirrored dramabox raw HTML -> deployable static site under site/."""
import os, re, sys, glob, json, hashlib
import urllib.request, ssl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
SITE = os.path.join(ROOT, "site")
STATIC = os.path.join(SITE, "static")
PROXY = os.environ.get("DB_PROXY", "http://127.0.0.1:7890")
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
OP = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
    urllib.request.HTTPSHandler(context=ctx))
OP.addheaders = [("User-Agent", UA), ("Accept-Language", "es-ES,es;q=0.9"), ("Referer", "https://www.dramabox.com/es")]


def dl(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        with OP.open(url, timeout=40) as r:
            data = r.read()
        open(dest, "wb").write(data)
        return True
    except Exception as e:
        print(f"  asset fail {url} {e}", file=sys.stderr)
        return False


def route_from_name(name: str) -> str | None:
    base = name[:-5] if name.endswith(".html") else name
    parts = [p for p in base.split("__")]
    if len(parts) < 2:
        return None
    segs = [p for p in parts[1:] if p and p not in ("index",)]
    route = "/" + "/".join(segs)
    route = route.rstrip("/")
    return route or "/"


def out_path(route: str) -> str:
    p = route.strip("/")
    if not p:
        return os.path.join(SITE, "index.html")
    return os.path.join(SITE, *p.split("/"), "index.html")


# ---------------------------------------------------------------- assets
def collect_css():
    """All unique stylesheet URLs referenced by any mirrored page."""
    urls = set()
    for f in glob.glob(os.path.join(RAW, "**", "*.html"), recursive=True):
        s = open(f, encoding="utf-8", errors="replace").read()
        for m in re.findall(r'<link[^>]+href="([^"]+\.css[^"]*)"', s):
            urls.add(m.replace("&amp;", "&"))
    return sorted(urls)


def build_css():
    urls = collect_css()
    os.makedirs(os.path.join(STATIC, "css"), exist_ok=True)
    os.makedirs(os.path.join(STATIC, "img"), exist_ok=True)
    chunks = []
    media = set()
    for u in urls:
        name = os.path.basename(u.split("?")[0])
        dest = os.path.join(ROOT, "raw", "css", name)
        if not dl(u, dest):
            continue
        css = open(dest, encoding="utf-8", errors="replace").read()
        for m in re.findall(r'url\(\s*[\'"]?([^\'")]+)[\'"]?\s*\)', css):
            if m.startswith("data:"):
                continue
            media.add(m)
        chunks.append(f"/* {name} */\n{css}")
    # media assets: ../media/x.png  ->  https://infocdn.dramaboxdb.com/seo/dramabox/_next/static/media/x.png
    for m in media:
        base = os.path.basename(m.split("?")[0])
        src = "https://infocdn.dramaboxdb.com/seo/dramabox/_next/static/media/" + base
        dl(src, os.path.join(STATIC, "img", base))
    merged = "\n".join(chunks)
    merged = re.sub(r'url\(\s*[\'"]?\.\./media/([^\'")]+)[\'"]?\s*\)',
                    lambda mm: f"url(/static/img/{os.path.basename(mm.group(1).split('?')[0])})", merged)
    open(os.path.join(STATIC, "css", "app.css"), "w", encoding="utf-8").write(merged)
    print(f"css: {len(urls)} bundles -> {len(merged)/1024:.0f} KB, media {len(media)}")


CHROME_IMAGES = [
    "https://infocdn.dramaboxdb.com/seo/dramabox/images/dramabox/m-logo.png",
    "https://infocdn.dramaboxdb.com/seo/dramabox/images/logo.png",
    "https://infocdn.dramaboxdb.com/seo/dramabox/images/dramabox/arrow-down.png",
    "https://infocdn.dramaboxdb.com/seo/dramabox/images/user/feed-back-icon.webp",
    "https://www.dramabox.com/favicon.ico",
]


def build_chrome():
    os.makedirs(os.path.join(STATIC, "img"), exist_ok=True)
    for u in CHROME_IMAGES:
        dl(u, os.path.join(STATIC, "img", os.path.basename(u)))
    # favicon at site root
    fav = os.path.join(STATIC, "img", "favicon.ico")
    if os.path.exists(fav):
        open(os.path.join(SITE, "favicon.ico"), "wb").write(open(fav, "rb").read())


# ---------------------------------------------------------------- page
SUPPORT_MAP = {
    "support.dramaboxdb.com/terms.html": "/terms.html",
    "support.dramaboxdb.com/privacy.html": "/privacy.html",
    "support.dramaboxdb.com/cookie-policy.html": "/cookie.html",
}

DROP_TAGS = re.compile(
    r'<(script)[^>]*>.*?</script>|'
    r'<(script)[^>]*/>|'
    r'<link[^>]+rel="(?:preload|modulepreload|prefetch|dns-prefetch|preconnect)"[^>]*>|'
    r'<link[^>]+href="[^"]*_next/static[^"]*"[^>]*>|'
    r'<link[^>]+rel="alternate"[^>]*>|'
    r'<meta[^>]+http-equiv="(?:Content-Security-Policy|pragma|Cache-Control|Expires)"[^>]*>',
    re.S | re.I)


def rewrite_html(s: str) -> str:
    # strip next runtime + preloads
    s = DROP_TAGS.sub("", s)
    # support-site legal pages
    for k, v in SUPPORT_MAP.items():
        s = re.sub(r'https?://' + re.escape(k) + r'\?[^"\']*', v, s)
        s = re.sub(r'https?://' + re.escape(k), v, s)
    # cdn chrome assets -> local
    s = re.sub(r'https?://infocdn\.dramaboxdb\.com/seo/dramabox/images/([\w./\-]+\.(?:png|jpe?g|webp|gif|svg|ico))',
               r'/static/img/\1', s)
    # absolute internal links -> relative
    s = s.replace('href="https://www.dramabox.com', 'href="')
    s = s.replace('href="http://www.dramabox.com', 'href="')
    s = re.sub(r'href="(/(?!static/|terms\.html|privacy\.html|cookie\.html)[^"#?]*?)"',
               lambda m: f'href="{m.group(1)}/"' if not m.group(1).endswith(".html") else m.group(0), s)
    # inject our stylesheet + runtime
    head_add = ('<link rel="stylesheet" href="/static/css/app.css"/>'
                '<link rel="stylesheet" href="/static/css/db.css"/>')
    s = s.replace("</head>", head_add + "</head>", 1)
    if "/static/app.js" not in s:
        s = s.replace("</body>", '<script src="/static/app.js" defer></script></body>', 1)
    # body data-route marker for JS
    s = re.sub(r'<body([^>]*)>', lambda m: '<body' + m.group(1) + ' data-db="mirror">', s, count=1)
    return s


def slug_map():
    m = {}
    for f in glob.glob(os.path.join(ROOT, "data", "books", "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        bi = d.get("bookInfo") or {}
        bid = bi.get("bookId")
        if bid:
            m[str(bid)] = bi.get("bookNameEn") or "drama"
    return m


def page_jobs():
    """(raw_file, route) pairs for every mirrored page."""
    jobs = []
    for f in glob.glob(os.path.join(RAW, "*.html")):
        name = os.path.basename(f)
        if "browse_pageNo" in name:
            continue
        route = route_from_name(name)
        if route and route.startswith("/es"):
            if route.startswith("/es/video/"):
                segs = route.strip("/").split("/")
                if len(segs) >= 3:
                    route = "/" + "/".join(segs[:3])
                else:
                    continue
            jobs.append((f, route))
    slugs = slug_map()
    for f in glob.glob(os.path.join(RAW, "books", "*.html")):
        bid = os.path.splitext(os.path.basename(f))[0]
        slug = slugs.get(bid)
        if slug:
            jobs.append((f, f"/es/drama/{bid}/{slug}"))
    for f in glob.glob(os.path.join(RAW, "video", "*.html")):
        bslug = os.path.splitext(os.path.basename(f))[0]
        jobs.append((f, f"/es/video/{bslug}"))
    return jobs


def build_pages():
    made = 0
    for f, route in page_jobs():
        html = open(f, encoding="utf-8", errors="replace").read()
        if 'id="__next"' not in html:
            continue
        out = out_path(route)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "w", encoding="utf-8").write(rewrite_html(html))
        made += 1
    print(f"pages: {made}")


def build_data():
    """Publish JSON data used by client-side interactions."""
    dst = os.path.join(SITE, "data", "books")
    os.makedirs(dst, exist_ok=True)
    n = 0
    for f in glob.glob(os.path.join(ROOT, "data", "books", "*.json")):
        n += 1
    idx = {"books": [], "generated": ""}
    print(f"data books: {n}")


def build_assets():
    """Download every /static/img/... referenced by mirrored pages."""
    refs = set()
    for f in glob.glob(os.path.join(SITE, "**", "*.html"), recursive=True):
        s = open(f, encoding="utf-8", errors="replace").read()
        refs.update(re.findall(r'/static/img/([\w./\-]+\.(?:png|jpe?g|webp|gif|svg|ico))', s))
    missing = [r for r in sorted(refs) if not os.path.exists(os.path.join(STATIC, "img", r))]
    print(f"assets: refs={len(refs)} missing={len(missing)}")
    for r in missing:
        url = "https://infocdn.dramaboxdb.com/seo/dramabox/images/" + r
        dl(url, os.path.join(STATIC, "img", r))


if __name__ == "__main__":
    steps = sys.argv[1:] or ["css", "chrome", "pages", "assets"]
    if "css" in steps:
        build_css()
    if "chrome" in steps:
        build_chrome()
    if "pages" in steps:
        build_pages()
    if "assets" in steps:
        build_assets()
