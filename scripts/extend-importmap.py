#!/usr/bin/env python3
# Step 3a (v0.60.544): добавляет в importmap всех entry-HTML ключи
# module-namespace для cross-импортируемых модулей (cooling/ meteo/
# service/ suppression-methods/), адреса document-relative. Идемпотентно.
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = '"cooling/": "../cooling/", "meteo/": "../meteo/", "service/": "../service/", "suppression-methods/": "../suppression-methods/"'

ONE_LINE_OLD = '{ "imports": { "shared/": "../shared/", "engine/": "../js/engine/" } }'
ONE_LINE_NEW = '{ "imports": { "shared/": "../shared/", "engine/": "../js/engine/", ' + KEYS + ' } }'

MULTI_OLD = '"engine/": "../js/engine/",'
MULTI_NEW = ('"engine/": "../js/engine/",\n'
             '    "cooling/": "../cooling/",\n'
             '    "meteo/": "../meteo/",\n'
             '    "service/": "../service/",\n'
             '    "suppression-methods/": "../suppression-methods/",')

done, skip = [], []
for p in ROOT.rglob("*.html"):
    parts = p.relative_to(ROOT).parts
    if parts[0] in (".claude", ".git", "node_modules", "tmp"):
        continue
    txt = p.read_text(encoding="utf-8")
    if 'type="importmap"' not in txt:
        continue
    if '"cooling/"' in txt:
        skip.append(str(p.relative_to(ROOT)).replace("\\", "/")); continue
    if ONE_LINE_OLD in txt:
        txt = txt.replace(ONE_LINE_OLD, ONE_LINE_NEW, 1)
    elif MULTI_OLD in txt:
        txt = txt.replace(MULTI_OLD, MULTI_NEW, 1)
    else:
        skip.append(str(p.relative_to(ROOT)).replace("\\", "/") + " (PATTERN MISS)")
        continue
    p.write_text(txt, encoding="utf-8", newline="")
    done.append(str(p.relative_to(ROOT)).replace("\\", "/"))

print(f"EXTENDED ({len(done)})")
print(f"SKIP ({len(skip)}): " + ", ".join(skip))
