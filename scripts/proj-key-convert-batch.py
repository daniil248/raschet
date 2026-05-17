#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Фаза 2 / R2 (продолжение proj-key-convert.py): батч по прочим сырым
читателям. Конвертирует литералы `raschet.project.${VAR}.MOD.KEY`
в байт-идентичный projectKey(VAR,'MOD','KEY').

Гард строже, чем в проходе по project.js:
  - в body есть точка (есть MOD.KEY)
  - body НЕ заканчивается точкой → исключаем префикс-сканы
    (`raschet.project.${pid}.scs-design.` — отдельная задача,
     для них projectKey семантически не предназначен).
projectKey(p,m,k) === `raschet.project.${p}.${m}.${k}` → строго идентично.
"""
import re, os

TARGETS = [
    'apps/projects/projects.js',
    'js/main.js',
    'apps/tech-workspace/tech-workspace.js',
    'apps/scs-design/scs-design.js',
]
pat = re.compile(r'`raschet\.project\.\$\{([^}]+)\}\.([^`]*)`')
total = 0
for path in TARGETS:
    if not os.path.exists(path):
        print(f"{path}: SKIP (нет файла)"); continue
    src = open(path, encoding='utf-8').read()
    cnt = 0
    def repl(m):
        global cnt
        var = m.group(1).strip(); body = m.group(2)
        if '.' not in body or body.endswith('.'):
            return m.group(0)                     # префикс-скан / нет MOD.KEY
        mod, key = body.split('.', 1)
        assert f"raschet.project.${{{var}}}.{mod}.{key}" == \
               f"raschet.project.${{{var}}}.{body}", (path, body)
        cnt += 1
        return f"projectKey({var}, '{mod}', '{key}')"
    new = pat.sub(repl, src)
    if new != src:
        open(path, 'w', encoding='utf-8', newline='\n').write(new)
    left = [m.group(0) for m in pat.finditer(new)]
    print(f"{path}: replaced={cnt}  remaining(prefix-scans kept)={len(left)}")
    for l in left:
        print(f"   KEPT {l}")
    total += cnt
print(f"TOTAL replaced: {total}")
