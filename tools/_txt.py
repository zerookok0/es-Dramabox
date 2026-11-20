# -*- coding: utf-8 -*-
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
for p in sys.argv[1:]:
    d = open(p, encoding='utf-8', errors='replace').read()
    b = re.search(r'<body[^>]*>(.*?)</body>', d, re.S)
    b = b.group(1) if b else ''
    b = re.sub(r'<script[^>]*>.*?</script>', ' ', b, flags=re.S)
    b = re.sub(r'<style[^>]*>.*?</style>', ' ', b, flags=re.S)
    b = re.sub(r'<(?:br|/p|/div|/h[1-6]|/li)[^>]*>', '\n', b)
    t = re.sub(r'<[^>]+>', ' ', b)
    t = re.sub(r'&nbsp;', ' ', t)
    t = re.sub(r'[ \t]+', ' ', t)
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    print("=" * 20, p, "lines", len(lines))
    for l in lines:
        print("  |", l)
    print()
