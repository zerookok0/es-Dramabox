# -*- coding: utf-8 -*-
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
for p in sys.argv[1:]:
    d = open(p, encoding='utf-8').read()
    print('=' * 20, p, 'LEN', len(d))
    i = d.rfind('</body>')
    print(repr(d[max(0, i - 1500):i + 20]))
    print('srcset count:', len(re.findall(r'srcset=', d)))
    print('style blocks:', len(re.findall(r'<style', d)))
    print('noscript:', len(re.findall(r'<noscript', d)))
