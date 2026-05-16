#!/usr/bin/env python3
# Step 2 раската importmap (v0.60.543): конвертация import-спецификаторов
# модулей с относительных ../shared/ , ../../shared/ , ../js/engine/ и т.д.
# на bare-спецификаторы shared/ и engine/. Все entry-HTML уже имеют
# importmap (Step 1, v0.60.541), поэтому резолвинг работает в любом
# документе, включая cross-module. ТОЛЬКО shared/ и js/engine — НЕ трогаем
# интра-/cross-модульные относительные импорты и не-JS ссылки (это фаза
# переезда папок). shared/ и js/ не конвертируем (они не переезжают).
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = {".claude", ".git", "shared", "js", "cooling", "node_modules",
                "tmp", "scripts", "tools"}

# (from|import) ('|") (../)+(shared|js/engine)/   ->  bare
# и dynamic import('...').  Сохраняем кавычку.
PAT = re.compile(
    r"""(\bfrom\s*|\bimport\s*\(?\s*|\bimport\s+)"""      # ключевое слово
    r"""(['"])"""                                          # кавычка
    r"""(?:\.\./)+"""                                      # один+ ../
    r"""(shared|js/engine)/"""                             # цель
)

def repl(m):
    head, quote, target = m.group(1), m.group(2), m.group(3)
    bare = "engine/" if target == "js/engine" else "shared/"
    return f"{head}{quote}{bare}"

def iter_files():
    for p in ROOT.rglob("*"):
        if p.suffix not in (".js", ".html"):
            continue
        parts = set(p.relative_to(ROOT).parts)
        if parts & EXCLUDE_DIRS:
            continue
        yield p

changed = []
for p in iter_files():
    txt = p.read_text(encoding="utf-8")
    new = PAT.sub(repl, txt)
    if new != txt:
        p.write_text(new, encoding="utf-8", newline="")
        changed.append(str(p.relative_to(ROOT)).replace("\\", "/"))

print(f"CONVERTED {len(changed)} files:")
for c in sorted(changed):
    print("  " + c)
