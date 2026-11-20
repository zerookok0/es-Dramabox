#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DramaBox (es) — legal / static page builder.

Stage 1 (fetch):  pull the source pages into raw/legal/ with readable names.
Stage 2 (build):  convert raw HTML into deployable static pages under site/.
Stage 3 (verify): every output must exist, be > 3000 bytes and expose >= 1500
                  visible Spanish characters after tag stripping.

Everything goes through the local proxy (http://127.0.0.1:7890) with a mobile
Android user agent. No page is edited by hand: this script is the only writer.

Usage:
    python tools/build_legal.py            # fetch + build + verify
    python tools/build_legal.py --build    # build + verify only (uses cached raw/)
    python tools/build_legal.py --verify   # verify only
"""
import hashlib
import html as htmlmod
import os
import posixpath
import random
import re
import string
import ssl
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit, unquote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "legal")
DATA = os.path.join(ROOT, "data", "legal")
SITE = os.path.join(ROOT, "site")
CSS_DIR = os.path.join(SITE, "static", "css")
IMG_DIR = os.path.join(SITE, "static", "img")

PROXY = os.environ.get("DB_PROXY", "http://127.0.0.1:7890")
UA = ("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
HDRS = [
    ("User-Agent", UA),
    ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
               "image/webp,image/apng,*/*;q=0.8"),
    ("Accept-Language", "es-ES,es;q=0.9,en;q=0.8"),
    ("Upgrade-Insecure-Requests", "1"),
]

# ---------------------------------------------------------------- page config
# kind "support"  -> dramabox support site: SSR shell + real `es` content fragment
# kind "site"     -> www.dramabox.com Next.js page: transformed in place
PAGES = [
    dict(
        name="terms", kind="support", out="terms.html",
        url="https://support.dramaboxdb.com/terms.html?language=es",
        raw="terms.html", frag="terms.es.htm",
        frag_url="https://support.dramaboxdb.com/version/v1_6_20260527/terms/es.htm",
        version="v1_6_20260527", title="Términos de servicio",
    ),
    dict(
        name="privacy", kind="support", out="privacy.html",
        url="https://support.dramaboxdb.com/privacy.html?language=es",
        raw="privacy.html", frag="privacy.es.htm",
        frag_url="https://support.dramaboxdb.com/version/v1_7_20260718/privacy/es.htm",
        version="v1_7_20260718", title="Política de privacidad",
    ),
    dict(
        # no Spanish cookie policy exists upstream: support site ships en + zhHans
        name="cookie", kind="support", out="cookie.html",
        url="https://support.dramaboxdb.com/cookie-policy.html?language=es",
        raw="cookie.html", frag="cookie.en.htm",
        frag_url="https://support.dramaboxdb.com/version/v1_0_20251211/cookie-policy/en.htm",
        version="v1_0_20251211", title="Cookie Policy",
    ),
    dict(
        name="download", kind="site", out="es/download/index.html",
        url="https://www.dramabox.com/es/download",
        raw="download.html", addon="addon-download.html",
    ),
    dict(
        name="business", kind="site", out="es/business/index.html",
        url="https://www.dramabox.com/es/business",
        raw="business.html", addon="addon-business.html",
    ),
    dict(
        name="dpo", kind="site", out="es/dpo/index.html",
        url="https://www.dramabox.com/es/dpo",
        raw="dpo.html", addon="addon-dpo.html",
    ),
]
NOT_FOUND = dict(name="404", kind="site", out="404.html", raw="download.html",
                 url="https://www.dramabox.com/es/download")
APP_JS_TAG = '<script src="/static/app.js" defer></script>'
APP_JS_BODY = (
    "/* app.js — minimal runtime for the mirrored static pages.\n"
    "   The original site loaded a full SPA bundle here; the mirror ships plain\n"
    "   server-rendered HTML, so this file only wires up small niceties. */\n"
    "(function () {\n"
    "  'use strict';\n"
    "  function ready(fn) {\n"
    "    if (document.readyState !== 'loading') { fn(); }\n"
    "    else { document.addEventListener('DOMContentLoaded', fn); }\n"
    "  }\n"
    "  ready(function () {\n"
    "    // External links opened in a new tab keep the mirror in place.\n"
    "    var links = document.querySelectorAll('a[href^=\"http\"]');\n"
    "    for (var i = 0; i < links.length; i++) {\n"
    "      var a = links[i];\n"
    "      if (a.hostname && a.hostname !== window.location.hostname) {\n"
    "        a.setAttribute('target', '_blank');\n"
    "        a.setAttribute('rel', 'noopener noreferrer');\n"
    "      }\n"
    "    }\n"
    "    // Version selector on the legal pages is a read-only label.\n"
    "    var sel = document.getElementById('version_select');\n"
    "    if (sel) { sel.disabled = true; }\n"
    "  });\n"
    "})();\n"
)

SUPPORT_MAP = {
    "terms.html": "/terms.html",
    "privacy.html": "/privacy.html",
    "cookie-policy.html": "/cookie.html",
    "cookie.html": "/cookie.html",
}

# ------------------------------------------------------------------- transport
_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE
_cache = {}
_assets = {}          # abs url -> site-relative path


def _opener():
    op = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPSHandler(context=_ctx),
    )
    op.addheaders = list(HDRS)
    return op


def fetch_bytes(url, retries=3, allow_nonce=True):
    """GET through the proxy. 403/429/503 -> retry with a random query nonce."""
    if url in _cache:
        return _cache[url]
    op = _opener()
    last = None
    for i in range(retries):
        try:
            with op.open(url, timeout=45) as r:
                data = r.read()
                _cache[url] = data
                return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429, 500, 502, 503) and i < retries - 1:
                time.sleep(0.8 + i)
                continue
            if allow_nonce and e.code in (403, 429):
                nonce = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
                sep = "&" if "?" in url else "?"
                return fetch_bytes(f"{url}{sep}_r={nonce}", retries, allow_nonce=False)
            break
        except Exception as e:                                  # noqa: BLE001
            last = e
            if i == retries - 1:
                break
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(f"fetch failed: {url} ({last})")


def fetch_text(url):
    return fetch_bytes(url).decode("utf-8", "replace")


# ------------------------------------------------------------------- fetching
def do_fetch():
    os.makedirs(RAW, exist_ok=True)
    failed = []
    for cfg in PAGES:
        out = os.path.join(RAW, cfg["raw"])
        try:
            data = fetch_bytes(cfg["url"])
        except Exception as e:                                  # noqa: BLE001
            print(f"  ERR page {cfg['name']}: {e}")
            if not os.path.exists(out):
                failed.append(cfg["name"])
            continue
        with open(out, "wb") as f:
            f.write(data)
        print(f"  page  {cfg['name']:<9} {len(data):>8}B  {cfg['url']}")
    for cfg in PAGES:
        if not cfg.get("frag_url"):
            continue
        out = os.path.join(RAW, cfg["frag"])
        try:
            data = fetch_bytes(cfg["frag_url"])
        except Exception as e:                                  # noqa: BLE001
            # es fragment missing -> try the page's SSR default language (en)
            alt = cfg["frag_url"].replace("/es.htm", "/en.htm")
            try:
                data = fetch_bytes(alt)
                print(f"  frag  {cfg['name']:<9} (es missing, en fallback) {len(data):>8}B")
            except Exception as e2:                             # noqa: BLE001
                print(f"  ERR frag {cfg['name']}: {e} | {e2}")
                failed.append(f"{cfg['name']}:frag")
                continue
        with open(out, "wb") as f:
            f.write(data)
        print(f"  frag  {cfg['name']:<9} {len(data):>8}B  {cfg['frag_url']}")
    return failed


# --------------------------------------------------------------- url rewriting
def is_dramabox(host):
    host = (host or "").lower()
    return "dramabox" in host


def with_trailing_slash(path):
    if not path.startswith("/"):
        path = "/" + path
    if path.endswith("/"):
        return path
    last = path.rsplit("/", 1)[-1]
    if "." in last:                       # file (xxx.html, favicon.ico)
        return path
    return path + "/"


def rewrite_href(href):
    """dramabox URL -> local site path; everything else untouched."""
    raw = href
    h = htmlmod.unescape(href).strip()
    if not h or h.startswith(("#", "mailto:", "tel:", "javascript:", "data:", "sms:")):
        return raw
    if h.startswith("//"):
        h = "https:" + h
    if h.startswith("http"):
        parts = urlsplit(h)
        if not is_dramabox(parts.hostname):
            return raw
        path = parts.path or "/"
        if is_dramabox(parts.hostname) and parts.hostname.lower().startswith("support."):
            base = posixpath.basename(path)
            if base in SUPPORT_MAP:
                return SUPPORT_MAP[base]
            return with_trailing_slash("/" + path.lstrip("/"))
        return with_trailing_slash("/" + path.lstrip("/"))
    # relative reference (fragment / support shell / extensionless route)
    base = posixpath.basename(h.split("?")[0].split("#")[0])
    if base in SUPPORT_MAP:
        return SUPPORT_MAP[base]
    if h.startswith("?"):
        return raw
    return with_trailing_slash(h.split("#")[0].split("?")[0])


def localize_asset(abs_url):
    """Download a dramabox image/font and return its /static/img/<basename> path."""
    if abs_url in _assets:
        return _assets[abs_url]
    try:
        data = fetch_bytes(abs_url)
    except Exception as e:                                      # noqa: BLE001
        print(f"    ! asset failed {abs_url} ({e})")
        return None
    name = unquote(posixpath.basename(urlsplit(abs_url).path)) or "asset"
    name = re.sub(r"[^0-9A-Za-z._-]", "_", name)
    dest = os.path.join(IMG_DIR, name)
    if os.path.exists(dest):
        with open(dest, "rb") as f:
            if f.read() != data:                 # same name, other bytes
                stem, ext = os.path.splitext(name)
                name = f"{stem}-{hashlib.md5(data).hexdigest()[:8]}{ext}"
                dest = os.path.join(IMG_DIR, name)
    os.makedirs(IMG_DIR, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    rel = "/static/img/" + name
    _assets[abs_url] = rel
    return rel


CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")]*)\1\s*\)")
CSS_IMPORT_RE = re.compile(r"@import\s+(?:url\()?['\"]?([^'\")\s]+)")


def localize_css(css, css_url):
    """Rewrite dramabox asset refs inside a stylesheet to /static/img/..."""
    for imp in CSS_IMPORT_RE.findall(css):
        print(f"    ! @import left as-is: {imp}")

    def repl(m):
        ref = m.group(2).strip()
        if not ref or ref.startswith(("data:", "#")):
            return m.group(0)
        absu = urljoin(css_url, ref)
        if not is_dramabox(urlsplit(absu).hostname):
            return m.group(0)
        loc = localize_asset(absu)
        return f"url({loc})" if loc else m.group(0)

    return CSS_URL_RE.sub(repl, css)


def rewrite_src(src):
    s = htmlmod.unescape(src).strip()
    if not s or s.startswith(("data:", "#")):
        return src
    if s.startswith("//"):
        s = "https:" + s
    if s.startswith("http"):
        parts = urlsplit(s)
        if not is_dramabox(parts.hostname):
            return src
        loc = localize_asset(s)
        return loc or src
    return src


def rewrite_document_urls(fragment_or_doc):
    out = re.sub(r'href="([^"]*)"', lambda m: f'href="{rewrite_href(m.group(1))}"', fragment_or_doc)
    out = re.sub(r'src="([^"]*)"', lambda m: f'src="{rewrite_src(m.group(1))}"', out)
    return out


# ------------------------------------------------------------------ html utils
def strip_scripts(doc):
    doc = re.sub(r"<script\b[^>]*>.*?</script>", "", doc, flags=re.S | re.I)
    return re.sub(r"<script\b[^>]*?/?>", "", doc, flags=re.I)


def strip_preloads(doc):
    return re.sub(r"<link\b[^>]*\brel=\"(?:preload|modulepreload)\"[^>]*>", "", doc, flags=re.I)


def set_lang_es(doc):
    if re.search(r"<html[^>]*>", doc, re.I):
        return re.sub(r"<html[^>]*>", '<html lang="es">', doc, count=1, flags=re.I)
    return doc


def add_app_script(doc):
    if APP_JS_TAG in doc:
        return doc
    if re.search(r"</body>", doc, re.I):
        return re.sub(r"</body>", APP_JS_TAG + "\n</body>", doc, count=1, flags=re.I)
    return doc + "\n" + APP_JS_TAG + "\n"


def read_data(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


def write_site(rel, text):
    path = os.path.join(SITE, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path


def addon_style_tag():
    css = read_data("addon.css")
    return "<style>\n" + css + "\n</style>"


# ------------------------------------------------------------- support builder
def support_viewport(raw):
    m = re.search(r"<meta\s+name=[\"']viewport[\"'][^>]*?>", raw, re.S | re.I)
    if m:
        return re.sub(r"\s+", " ", m.group(0))
    return ('<meta name="viewport" content="width=device-width, initial-scale=1.0, '
            'maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">')


def build_support(cfg):
    raw = open(os.path.join(RAW, cfg["raw"]), encoding="utf-8", errors="replace").read()
    frag = open(os.path.join(RAW, cfg["frag"]), encoding="utf-8", errors="replace").read()
    frag = strip_scripts(strip_preloads(frag))
    frag = rewrite_document_urls(frag)
    styles = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", raw, re.S | re.I)).strip()
    title = cfg["title"]
    shown = cfg["version"].replace("_", ".")
    doc = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
{support_viewport(raw)}
<meta name="format-detection" content="telephone=no">
<meta name="mobile-web-app-capable" content="yes">
<link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">
<title>{htmlmod.escape(title)}</title>
<style>
    :root {{
      --bg-color-01: #0F0F0F;
      --font-color-01: #fff;
    }}

{styles}

    .selector-container select {{
      font-size: 12px;
      color: var(--font-color-01);
      background-color: transparent;
      border: 1px solid rgba(255, 255, 255, .25);
      border-radius: 4px;
      padding: 2px 4px;
    }}
  </style>
</head>
<body>
<div id="terms">
  <div class="fetch_content">
{frag}
  </div>
  <div class="selector-container">
    <label for="version_select"></label>
    <select name="version" id="version_select">
      <option value="{cfg['version']}" selected>{shown}</option>
    </select>
  </div>
</div>
{APP_JS_TAG}
</body>
</html>
"""
    return doc


# ---------------------------------------------------------------- site builder
def build_site(cfg, main_override=None, out_name=None):
    name = out_name or cfg["name"]
    raw = open(os.path.join(RAW, cfg["raw"]), encoding="utf-8", errors="replace").read()

    doc = strip_scripts(strip_preloads(raw))

    # --- stylesheets: merge the page's external CSS into one local file
    sheets = re.findall(r"<link\b[^>]*rel=[\"']stylesheet[\"'][^>]*>", doc, re.I)
    css_chunks = []
    for tag in sheets:
        m = re.search(r"href=[\"']([^\"']+)[\"']", tag, re.I)
        if not m:
            continue
        url = urljoin(cfg["url"], htmlmod.unescape(m.group(1)))
        try:
            css_chunks.append(f"/* {url} */\n" + localize_css(fetch_text(url), url))
        except Exception as e:                                  # noqa: BLE001
            print(f"    ! css failed {url} ({e})")
    css_rel = f"/static/css/legal-{name}.css"
    if css_chunks:
        os.makedirs(CSS_DIR, exist_ok=True)
        with open(os.path.join(CSS_DIR, f"legal-{name}.css"), "w",
                  encoding="utf-8", newline="\n") as f:
            f.write("\n\n".join(css_chunks) + "\n")
        first = True
        for tag in sheets:
            if first:
                doc = doc.replace(tag, f'<link rel="stylesheet" href="{css_rel}"/>', 1)
                first = False
            else:
                doc = doc.replace(tag, "", 1)

    # --- 404 cosmetics
    if main_override is not None:
        doc = re.sub(r"<link\b[^>]*rel=[\"']canonical[\"'][^>]*>", "", doc, flags=re.I)
        doc = doc.replace('<meta charSet="utf-8"',
                          '<meta name="robots" content="noindex,follow"/><meta charSet="utf-8"', 1)
        doc = re.sub(r"<title[^>]*>.*?</title>", "<title>Página no encontrada (404) – DramaBox</title>",
                     doc, count=1, flags=re.S | re.I)

    # --- assets + links
    doc = rewrite_document_urls(doc)

    # --- optional addon / replacement main block
    addon = ""
    if cfg.get("addon"):
        addon = read_data(cfg["addon"])
    if main_override is not None:
        addon = main_override
    addon = rewrite_document_urls(addon)
    if addon:
        # shared block styles belong in <head>; the block itself lives inside <main>
        # so the page's own header offset (fixed header) keeps working.
        style = addon_style_tag()
        if re.search(r"</head>", doc, re.I):
            doc = re.sub(r"</head>", style + "\n</head>", doc, count=1, flags=re.I)
        else:
            doc = style + doc
        if main_override is not None:
            # 404: swap the whole main content, keep <main> + <footer> untouched
            open_main = re.search(r"<main\b[^>]*>", doc, re.I)
            close_main = doc.lower().find("</main>", open_main.end() if open_main else 0)
            if open_main and close_main != -1:
                doc = doc[:open_main.end()] + "\n" + addon + "\n" + doc[close_main:]
            else:
                doc = insert_before(doc, "<footer", "\n" + addon + "\n")
        else:
            # info block: append at the end of <main>, above the footer
            close_main = doc.lower().rfind("</main>")
            if close_main != -1:
                doc = doc[:close_main] + "\n" + addon + "\n" + doc[close_main:]
            else:
                doc = insert_before(doc, "<footer", "\n" + addon + "\n")

    doc = set_lang_es(doc)
    doc = add_app_script(doc)
    return doc


def insert_before(doc, marker, chunk):
    i = doc.lower().find(marker.lower())
    if i != -1:
        return doc[:i] + chunk + doc[i:]
    return doc.replace("</body>", chunk + "</body>", 1)


# ---------------------------------------------------------------------- verify
TAG_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)


def visible_text(doc):
    t = TAG_RE.sub(" ", doc)
    t = re.sub(r"<!--.*?-->", " ", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = htmlmod.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


SPANISH_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡]")


def verify(outputs):
    print("\n=== verify ===")
    ok_all = True
    rows = []
    for cfg, path in outputs:
        size = os.path.getsize(path) if os.path.exists(path) else 0
        text = visible_text(open(path, encoding="utf-8", errors="replace").read()) if size else ""
        letters = len(SPANISH_RE.findall(text))
        ok = size > 3000 and letters >= 1500
        ok_all = ok_all and ok
        rows.append((os.path.relpath(path, ROOT).replace(os.sep, "/"), size, len(text), letters, ok))
        print(f"  {'OK ' if ok else 'FAIL'} {rows[-1][0]:<28} {size:>8}B "
              f"visible={len(text):>6} letters={letters:>6}")
    # sanity checks on the generated markup
    for cfg, path in outputs:
        if not os.path.exists(path):
            ok_all = False
            print(f"  WARN {os.path.relpath(path, ROOT)}: file missing")
            continue
        doc = open(path, encoding="utf-8", errors="replace").read()
        problems = []
        if APP_JS_TAG not in doc:
            problems.append("missing app.js")
        if re.search(r"<script\b(?! src=\"/static/app.js\")", doc, re.I):
            problems.append("stray <script>")
        if re.search(r"rel=\"(?:preload|modulepreload)\"", doc):
            problems.append("preload left")
        left = [u for u in re.findall(r'(?:href|src)="([^"]*)"', doc)
                if u.lower().startswith(("http://", "https://", "//"))
                and is_dramabox(urlsplit("https:" + u if u.startswith("//") else u).hostname)]
        if left:
            problems.append(f"{len(left)} dramabox url(s): {left[:3]}")
        if 'lang="es"' not in doc:
            problems.append("lang != es")
        if "width=device-width" not in doc:
            problems.append("no viewport")
        # every locally referenced asset must exist
        for rel in set(re.findall(r"[\"'](/static/(?:css|img)/[^\"']+)[\"']", doc)):
            p = os.path.join(SITE, rel.lstrip("/").replace("/", os.sep))
            if not os.path.exists(p):
                problems.append(f"missing asset {rel}")
        if problems:
            ok_all = False
            print(f"  WARN {os.path.relpath(path, ROOT)}: " + "; ".join(problems))
        else:
            print(f"  mark {os.path.relpath(path, ROOT):<28} clean")
    return ok_all, rows


# ------------------------------------------------------------------------ main
def main(argv):
    mode = "all"
    if "--build" in argv:
        mode = "build"
    if "--verify" in argv:
        mode = "verify"

    os.makedirs(RAW, exist_ok=True)
    os.makedirs(CSS_DIR, exist_ok=True)
    os.makedirs(IMG_DIR, exist_ok=True)

    failed = []
    if mode in ("all",):
        print("=== fetch ===")
        failed = do_fetch()

    outputs = []
    if mode in ("all", "build"):
        print("\n=== build ===")
        for cfg in PAGES:
            try:
                if cfg["kind"] == "support":
                    doc = build_support(cfg)
                else:
                    doc = build_site(cfg)
            except Exception as e:                              # noqa: BLE001
                print(f"  ERR build {cfg['name']}: {e}")
                failed.append(cfg["name"])
                continue
            path = write_site(cfg["out"], doc)
            print(f"  wrote {os.path.relpath(path, ROOT):<30} {os.path.getsize(path):>8}B")
        try:
            doc404 = build_site(NOT_FOUND,
                                main_override=read_data("404-main.html"),
                                out_name="404")
            path = write_site("404.html", doc404)
            print(f"  wrote {os.path.relpath(path, ROOT):<30} {os.path.getsize(path):>8}B")
        except Exception as e:                                  # noqa: BLE001
            print(f"  ERR build 404: {e}")
            failed.append("404")

        app = os.path.join(SITE, "static", "app.js")
        if not os.path.exists(app):
            os.makedirs(os.path.dirname(app), exist_ok=True)
            with open(app, "w", encoding="utf-8", newline="\n") as f:
                f.write(APP_JS_BODY)
            print(f"  wrote {os.path.relpath(app, ROOT)}")

    for cfg in PAGES:
        outputs.append((cfg, os.path.join(SITE, cfg["out"].replace("/", os.sep))))
    outputs.append((NOT_FOUND, os.path.join(SITE, "404.html")))

    ok, rows = verify(outputs)

    print("\n=== summary ===")
    print(f"  pages   : {len(rows)}")
    print(f"  images  : {len([1 for _ in os.listdir(IMG_DIR)]) if os.path.isdir(IMG_DIR) else 0}"
          f" in site/static/img/")
    print(f"  css     : {len(os.listdir(CSS_DIR)) if os.path.isdir(CSS_DIR) else 0}"
          f" in site/static/css/")
    if failed:
        print(f"  failed  : {', '.join(failed)}")
    print(f"  result  : {'ALL OK' if ok and not failed else 'ATTENTION NEEDED'}")
    return 0 if ok and not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
