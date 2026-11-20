# -*- coding: utf-8 -*-
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
for p in sys.argv[1:]:
    d = open(p, encoding='utf-8').read()
    print('=' * 20, p, 'LEN', len(d))
    print(d[:900])
    print('...TAIL...')
    print(d[-500:])
    print('classes:', sorted(set(re.findall(r'class="([^"]+)"', d))))
    print('links:', re.findall(r'href="([^"]+)"', d)[:20])
    print('imgs:', re.findall(r'<img[^>]+>', d)[:5])
