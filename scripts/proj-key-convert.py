#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Фаза 2 / R2: конвертирует в apps/projects/project.js прямые литералы
  `raschet.project.${VAR}.MOD.KEY`
в байт-идентичный вызов helper-а
  projectKey(VAR, 'MOD', 'KEY')
projectKey(pid,m,k) === `raschet.project.${pid}.${m}.${k}` (project-storage.js:354)
=> результат строго идентичен, поведение не меняется, гасится R2.

Защита: заменяем ТОЛЬКО шаблоны, где после `${VAR}.` есть хотя бы одна
точка (MOD.KEY). Префиксные сканы вида `raschet.project.${id}.` (BODY без
точки/пустой) НЕ трогаются — projectKey дал бы иную строку.
"""
import re, sys

PATH = 'apps/projects/project.js'
src = open(PATH, encoding='utf-8').read()

# `raschet.project.${ VAR }. BODY `   (VAR без '}', BODY без backtick)
pat = re.compile(r'`raschet\.project\.\$\{([^}]+)\}\.([^`]*)`')

cnt = 0
samples = []

def repl(m):
    global cnt
    var = m.group(1).strip()
    body = m.group(2)
    if '.' not in body:           # prefix-скан / нет MOD.KEY — не трогаем
        return m.group(0)
    mod, key = body.split('.', 1)
    out = f"projectKey({var}, '{mod}', '{key}')"
    # инвариант байт-идентичности
    assert f"raschet.project.${{{var}}}.{mod}.{key}" == f"raschet.project.${{{var}}}.{body}", body
    cnt += 1
    if len(samples) < 4:
        samples.append((m.group(0), out))
    return out

new = pat.sub(repl, src)

if new != src:
    open(PATH, 'w', encoding='utf-8', newline='\n').write(new)

print(f"replaced: {cnt}")
for a, b in samples:
    print(f"  {a}")
    print(f"  -> {b}")
# остаточные сырые литералы (ожидаем только префикс-сканы без MOD.KEY)
left = [m.group(0) for m in pat.finditer(new)]
print(f"remaining raw raschet.project templates: {len(left)}")
for l in left[:10]:
    print(f"  LEFT {l}")
