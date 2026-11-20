#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate /es/search/ page reusing the mirrored chrome (header/footer) of the home page."""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
HOME = os.path.join(SITE, "es", "index.html")
OUT = os.path.join(SITE, "es", "search", "index.html")


def main():
    if not os.path.exists(HOME):
        sys.exit("home page missing; run mirror first")
    h = open(HOME, encoding="utf-8").read()

    head_end = h.find("</head>")
    head = h[:head_end]
    head = re.sub(r"<title[^>]*>.*?</title>", '<title data-next-head="">Buscar-DramaBox</title>', head, flags=re.S)

    body_start = h.find("<body")
    main_i = h.find('class="index-module-scss-module__oMTV4W__mainContent"')
    if main_i < 0:
        main_i = h.find("<main")
    foot_i = h.find("<footer")
    if foot_i < 0:
        sys.exit("footer not found")
    hdr_end = h.find("</header>")
    cut = (hdr_end + len("</header>")) if hdr_end > 0 else main_i
    prefix = h[body_start:cut]
    suffix = h[foot_i:]
    suffix = re.sub(r"<script[^>]*src=\"/static/app.js\"[^>]*></script>", "", suffix)

    main = (
        '<div class="db-search-wrap">'
        "<h1>Buscar</h1>"
        '<input id="db-q" class="db-search-input" placeholder="Busca tu drama favorito" autocomplete="off"/>'
        '<div id="db-results" class="db-grid"></div>'
        "</div>"
    )
    html = head + "</head>" + prefix + main + suffix
    if "/static/app.js" not in html:
        html = html.replace("</body>", '<script src="/static/app.js" defer></script></body>')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(html)
    print(f"search page: {len(html)} bytes")


if __name__ == "__main__":
    main()
