# -*- coding: utf-8 -*-
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
for p in sys.argv[1:]:
    d = open(p, encoding='utf-8').read()
    print('=' * 20, p)
    for m in re.finditer(r'<footer[^>]*>', d):
        print('footer tag at', m.start(), m.group(0)[:160])
    print('footer count:', len(re.findall(r'<footer', d)))
    # find where __next div closes: look for pattern </div><script id="__NEXT_DATA__"
    m = re.search(r'</div>(<script[^>]*__NEXT_DATA__)', d)
    print('next-close ctx:', repr(d[m.start()-300:m.start()+60]) if m else None)
