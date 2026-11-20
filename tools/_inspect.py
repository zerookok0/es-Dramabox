# -*- coding: utf-8 -*-
import re, sys
p = sys.argv[1]
d = open(p, encoding='utf-8', errors='replace').read()
scripts = re.findall(r'<script[^>]*>(.*?)</script>', d, re.S)
out = []
for i, s in enumerate(scripts):
    out.append(f"===== SCRIPT {i} (len {len(s)}) =====")
    out.append(s)
open(sys.argv[2], 'w', encoding='utf-8').write("\n".join(out))
print("scripts:", len(scripts), "->", sys.argv[2])
