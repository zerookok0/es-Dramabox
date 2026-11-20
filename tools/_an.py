# -*- coding: utf-8 -*-
"""Analyze raw dramabox pages: body text length, stylesheets, images, links."""
import re, sys, os
sys.stdout.reconfigure(encoding='utf-8')

def analyze(path, label):
    d = open(path, encoding='utf-8', errors='replace').read()
    body = re.search(r'<body[^>]*>(.*?)</body>', d, re.S)
    b = body.group(1) if body else ''
    txt = re.sub(r'<script[^>]*>.*?</script>', ' ', b, flags=re.S)
    txt = re.sub(r'<style[^>]*>.*?</style>', ' ', txt, flags=re.S)
    txt = re.sub(r'<[^>]+>', ' ', txt)
    txt = re.sub(r'&[a-z#0-9]+;', ' ', txt)
    txt = re.sub(r'\s+', ' ', txt).strip()
    print(f"### {label} {path}")
    print(f"  total={len(d)} bodyraw={len(b)} bodytext={len(txt)}")
    print(f"  bodyhead: {b[:300]!r}")
    print(f"  texthead: {txt[:300]!r}")
    print("  stylesheets:")
    for m in re.finditer(r'<link[^>]+rel="stylesheet"[^>]*>', d):
        print("   ", m.group(0)[:220])
    print("  preloads:", len(re.findall(r'rel="(?:module)?preload"', d)))
    print("  imgs:", len(re.findall(r'<img', d)))
    srcs = re.findall(r'<img[^>]+src="([^"]+)"', d)
    for s in srcs[:12]:
        print("    img:", s[:160])
    print("  root divs:", re.findall(r'<div id="[^"]+"[^>]*>', d)[:5])
    print()

for a in sys.argv[1:]:
    p, label = a.split('=', 1) if '=' in a else (a, os.path.basename(a))
    analyze(p, label)
