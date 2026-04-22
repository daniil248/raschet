#!/usr/bin/env python3
"""audit-design.py — Phase 1.26.9

Проверяет, что ни один модуль не ставит max-width:<число>px + margin:0 auto
на корневую обёртку (body > main, .*-wrap, .page-wrap, main).

Запуск:
    python scripts/audit-design.py

Код возврата 0 — ок. Код 1 — найдены нарушения.
"""
from __future__ import annotations
import os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE_DIRS = {"node_modules", ".git", "dist", "scripts"}
BASE_CSS = ROOT / "shared" / "styles" / "base.css"

WRAPPER_PATTERNS = [
    re.compile(r"^\s*body\s*>\s*main\b"),
    re.compile(r"^\s*\.(?:page|sc|rc|cb|mv|pdu|ups|xf|el|bat|cat|log|mdc|psy|sup|pc|tr|app)-wrap\b"),
    re.compile(r"^\s*main\s*(?:\{|$)"),
]

BLOCK_RE = re.compile(r"([^{}]+?)\{([^{}]*)\}", re.DOTALL)
MAX_WIDTH_RE = re.compile(r"max-width\s*:\s*\d+(?:\.\d+)?(?:px|rem|em|vw)")
MARGIN_AUTO_RE = re.compile(r"margin[^;]*:[^;]*\bauto\b")

def walk_css(root: Path):
    for p in root.rglob("*.css"):
        if any(part in IGNORE_DIRS for part in p.parts): continue
        if p == BASE_CSS: continue
        yield p

def line_of(src: str, pos: int) -> int:
    return src.count("\n", 0, pos) + 1

def audit(path: Path, src: str, issues: list[str]):
    for m in BLOCK_RE.finditer(src):
        selector = m.group(1).strip()
        body = m.group(2)
        if not any(pat.search(selector) for pat in WRAPPER_PATTERNS): continue
        if MAX_WIDTH_RE.search(body) and MARGIN_AUTO_RE.search(body):
            issues.append(f"{path.relative_to(ROOT)}:{line_of(src, m.start())}  «{selector[:60]}»  — max-width + margin:auto")

def main() -> int:
    issues: list[str] = []
    for f in walk_css(ROOT):
        try:
            src = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            src = f.read_text(encoding="cp1251", errors="ignore")
        audit(f, src, issues)
    if issues:
        print("[x] Найдены нарушения full-width policy (Phase 1.26.1):")
        for i in issues: print("  " + i)
        print(f"\nВсего: {len(issues)}.")
        return 1
    print("[ok] Full-width policy OK.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
