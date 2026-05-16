#!/usr/bin/env python3
# Step 3a (v0.60.544): cross-module относительные импорты → bare.
# Только настоящие module<->module (источник и цель — РАЗНЫЕ папки модулей;
# js/ и shared/ исключены — CORE/SHARED не переезжают). Цели, реально
# импортируемые cross-module: cooling, meteo, service, suppression-methods.
# Резолв обеспечит расширенный importmap (см. extend-importmap ниже).
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ("cooling", "meteo", "service", "suppression-methods")
EXCLUDE_TOP = {".claude", ".git", "shared", "js", "node_modules", "tmp",
               "scripts", "tools"}

# (from|import|import() '|" (../)+  (target)/
PAT = re.compile(
    r"""(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])((?:\.\./)+)("""
    + "|".join(TARGETS) + r""")/"""
)

def repl(m):
    head, q, dots, tgt = m.group(1), m.group(2), m.group(3), m.group(4)
    return f"{head}{q}{tgt}/"

changed = []
for p in ROOT.rglob("*"):
    if p.suffix not in (".js", ".html"):
        continue
    parts = p.relative_to(ROOT).parts
    if parts[0] in EXCLUDE_TOP:
        continue
    src_mod = parts[0]
    txt = p.read_text(encoding="utf-8")

    def guard(m):
        # не трогаем, если цель == собственный модуль (интра, путь через ../
        # в пределах модуля — но cross targets всегда другой модуль; всё же
        # защищаемся: если src_mod == target и нет смысла bare-ить)
        if m.group(4) == src_mod:
            return m.group(0)
        return repl(m)

    new = PAT.sub(guard, txt)
    if new != txt:
        p.write_text(new, encoding="utf-8", newline="")
        changed.append(str(p.relative_to(ROOT)).replace("\\", "/"))

print(f"CONVERTED {len(changed)} files:")
for c in sorted(changed):
    print("  " + c)
