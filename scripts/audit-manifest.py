#!/usr/bin/env python3
"""audit-manifest.py — сверка манифестов модулей с реальностью.

Цель: `requires` в modules.json / <module>/manifest.json должен честно
отражать реальные импорты модуля, а реестр — содержать все UI-папки.
Манифест перестаёт быть комментарием и становится контрактом.

Проверяет:
  1. UNDECLARED — модуль реально импортит shared/<X> или чужой модуль,
     но это не объявлено в requires.            → код возврата 1
  2. DEAD       — requires содержит запись, которая нигде не импортится
     (эвристика; advisory).                      → предупреждение
  3. UNREGISTERED — папка верхнего уровня с index.html отсутствует в
     modules.json (долг реестра, ARCHITECTURE.md §5). → предупреждение
  4. PARITY     — modules.json[i] vs <module>/manifest.json по
     потребительским полям (id/kind/requires/...). → код возврата 1

Запуск:
    python scripts/audit-manifest.py            # отчёт + код возврата
    python scripts/audit-manifest.py --strict   # DEAD/UNREGISTERED тоже -> 1

Код 0 — ок. Код 1 — есть UNDECLARED / PARITY (или всё при --strict).
Advisory по дизайну: в CI подключать non-blocking, ужесточать в Фазе 1.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv
IGNORE_DIRS = {
    "node_modules", ".git", ".github", ".claude", "scripts", "tools",
    "dev", "tmp", "functions", "fonts", "js", "shared", "modules",
    "elements",  # deprecated redirect -> catalog
}
# Платформенный baseline SHARED-слоя: инфраструктура, неявно доступная
# КАЖДОМУ ui-модулю (шапка/футер/диалоги/справка/деньги/проект/каталоги
# /отчёты/подписки/общие виджеты/CORE-calc). Не объявляется в requires
# пер-модульно — это шов. requires остаётся для ДОМЕННЫХ зависимостей
# (конкретный catalog/picker/bridge). Поэтому baseline исключён из
# UNDECLARED/DEAD — иначе сигнал тонет в шуме.
BASELINE_SHARED = {
    "shared/app-header", "shared/module-footer", "shared/module-nav",
    "shared/dialog", "shared/help-panel", "shared/auth",
    "shared/global-settings", "shared/subscriptions", "shared/ui",
    "shared/calc", "shared/calc-modules", "shared/calc-widget",
    "shared/catalogs", "shared/money", "shared/currency-rates",
    "shared/report", "shared/report-catalog", "shared/config-sidebar",
    "shared/config-io", "shared/project-storage", "shared/project-context",
    "shared/configuration-catalog", "shared/company-profile",
    "shared/auto-norm", "shared/backup", "shared/history-log",
    "shared/selection-panel", "shared/element-library",
    "shared/element-schemas",
}
# import ... from '<spec>'  /  import('<spec>')  /  from "<spec>"
IMPORT_RE = re.compile(
    r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]"""
    r"""|import\(\s*['"]([^'"]+)['"]"""
)
SRC_SUFFIX = (".js", ".mjs", ".html")


def norm_require(spec: str) -> str | None:
    """Импорт-спецификатор -> канон 'shared/<name>' | '<module>' | None."""
    s = spec.split("?")[0].strip()
    if "shared/" in s:
        tail = s.split("shared/", 1)[1].strip("/")
        parts = [p for p in tail.split("/") if p not in ("", ".", "..")]
        if parts:
            name = parts[0]
            for suf in SRC_SUFFIX:
                if name.endswith(suf):
                    name = name[: -len(suf)]
            return "shared/" + name
        return None
    return None


def module_dirs() -> list[Path]:
    out = []
    for p in sorted(ROOT.iterdir()):
        if not p.is_dir() or p.name in IGNORE_DIRS or p.name.startswith("."):
            continue
        out.append(p)
    return out


def collect_imports(d: Path) -> set[str]:
    specs: set[str] = set()
    for f in d.rglob("*"):
        if f.suffix not in SRC_SUFFIX:
            continue
        if any(part in IGNORE_DIRS for part in f.relative_to(ROOT).parts[:-1]):
            continue
        try:
            src = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in IMPORT_RE.finditer(src):
            specs.add(m.group(1) or m.group(2))
    return specs


def main() -> int:
    mjson = json.loads((ROOT / "modules.json").read_text(encoding="utf-8"))
    by_path = {}
    by_id = {}
    for rec in mjson["modules"]:
        by_id[rec["id"]] = rec
        by_path[rec["path"].rstrip("/")] = rec

    undeclared: list[str] = []
    dead: list[str] = []
    unregistered: list[str] = []
    parity: list[str] = []

    registered_dirs = {
        rec["path"].rstrip("/") for rec in mjson["modules"]
        if rec["path"] not in ("index.html",)
    }

    for d in module_dirs():
        name = d.name
        has_html = (d / "index.html").exists()
        rec = by_path.get(name)

        if rec is None:
            if has_html:
                unregistered.append(name)
            continue

        specs = collect_imports(d)
        used: set[str] = set()
        for spec in specs:
            req = norm_require(spec)
            if req is None:
                # чужой модуль? '../<other>/...'
                m = re.search(r"\.\./([a-z0-9-]+)/", spec)
                if m and m.group(1) != name and m.group(1) in by_id:
                    req = m.group(1)
                else:
                    continue
            used.add(req)

        declared = set(rec.get("requires", []))
        # requires вида 'shared/auth' либо id чужого модуля
        for u in sorted(used):
            if u in BASELINE_SHARED:
                continue  # шов-инфраструктура, не доменная зависимость
            if u.startswith("shared/"):
                if u not in declared:
                    undeclared.append(
                        f"{name}: импортит доменный {u}, нет в requires"
                    )
            elif u in by_id:
                if u not in declared:
                    undeclared.append(
                        f"{name}: cross-import модуля «{u}», нет в requires "
                        f"(должно идти через мост/контракт — boundary-lint R1)"
                    )
        for req in sorted(declared):
            if (req.startswith("shared/") and req not in used
                    and req not in BASELINE_SHARED):
                dead.append(f"{name}: requires «{req}» не импортится (мёртв?)")

        # PARITY: per-module manifest.json -> потребительские поля
        mf_path = (ROOT / "manifest.json") if name == "constructor" else (d / "manifest.json")
        if name != "constructor" and mf_path.exists():
            try:
                mf = json.loads(mf_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                parity.append(f"{name}: невалидный manifest.json: {e}")
                mf = None
            if mf is not None:
                for fld in ("id", "kind", "path", "subscriptionPlan",
                            "internalOnly", "requires", "permissions"):
                    a = rec.get(fld)
                    b = mf.get(fld)
                    if fld == "internalOnly":
                        a, b = bool(a), bool(b)
                    if fld == "kind":
                        a = a or "ui"
                        b = b or "ui"
                    if a != b:
                        parity.append(
                            f"{name}.{fld}: modules.json={a!r} ≠ manifest={b!r}"
                        )

    def section(title: str, items: list[str]) -> None:
        if items:
            print(f"\n=== {title} ({len(items)}) ===")
            for it in items:
                print(f"  • {it}")

    section("UNDECLARED — реальный импорт не объявлен в requires", undeclared)
    section("PARITY — modules.json ↔ manifest.json расхождение", parity)
    section("DEAD — requires без реального импорта (advisory)", dead)
    section("UNREGISTERED — UI-папка вне modules.json (долг Фазы 1)",
            unregistered)

    hard = bool(undeclared) or bool(parity)
    soft = bool(dead) or bool(unregistered)
    if not hard and not soft:
        print("audit-manifest: OK — манифесты честны, реестр полон.")
        return 0
    print(
        f"\nИтого: undeclared={len(undeclared)} parity={len(parity)} "
        f"dead={len(dead)} unregistered={len(unregistered)}"
    )
    if hard or (STRICT and soft):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
