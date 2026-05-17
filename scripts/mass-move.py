#!/usr/bin/env python3
# Массовый переезд папок модулей (v0.60.547). Атомарно, детерминированно.
# apps/ = UI-модули, lib/ = calc-libs. cooling уже в apps/. НЕ двигаем:
# help, modules, dev, elements, js, shared, functions, scripts, tools, tmp,
# apps, lib + корневые файлы. Пути ссылок пересчитываются против ФИНАЛЬНОЙ
# раскладки. importmap-блоки регенерируются (доп. ключи типа three целы).
# Запуск: python3 scripts/mass-move.py [--dry]
import re, json, pathlib, posixpath, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DRY = "--dry" in sys.argv

APPS = ["battery","cable","catalog","configurator3d","facility-inventory",
        "genset-config","logistics","mdc-config","meteo","mv-config",
        "panel-config","pdu-config","projects","psychrometrics","rack-config",
        "reports","schematic","scs-config","scs-design","service","sketch",
        "suppression-config","tech-workspace","transformer-config","ups-config"]
LIB = ["suppression-methods"]
TO_MOVE = {m: f"apps/{m}" for m in APPS} | {m: f"lib/{m}" for m in LIB}
MOVED_IDS = set(TO_MOVE) | {"cooling"}          # cooling уже в apps/

# финальные папки namespace-целей importmap (от корня)
NS = {"shared/":"shared", "engine/":"js/engine",
      "cooling/":"apps/cooling", "meteo/":"apps/meteo",
      "service/":"apps/service", "suppression-methods/":"lib/suppression-methods"}

def rel(target, frm):
    r = posixpath.relpath(target, frm)
    return r + ("" if r.endswith("/") else "/")

IM_RE = re.compile(r'(<script type="importmap">)(.*?)(</script>)', re.S)

def rebuild_importmap(html, new_dir):
    def repl(m):
        try: obj = json.loads(m.group(2))
        except Exception as e:
            print("  ! importmap parse fail in", new_dir, e); return m.group(0)
        out = {}
        for k, v in obj.get("imports", {}).items():
            if k in NS:
                tgt = NS[k]
                out[k] = "./" if new_dir == tgt else rel(tgt, new_dir)
            else:
                out[k] = v
        return f'{m.group(1)}\n  {json.dumps({"imports":out}, ensure_ascii=False)}\n  {m.group(3)}'
    return IM_RE.sub(repl, html)

# '../seg' где seg НЕ переехавший модуль и не apps/lib → корневой
# неперемещаемый таргет: на каждый +1 глубины добавить '../'.
# '../apps/cooling/' (артефакт пилота) → сосед '../cooling/'.
REF_RE = re.compile(r'''(["'(=])((?:\.\./)+)([A-Za-z0-9._-]+)(/|["')\s])''')

def fix_refs(text, gain):
    if gain <= 0: return text
    extra = "../" * gain
    def r(m):
        delim, dots, seg, tail = m.groups()
        if seg in ("apps","lib"):
            return m.group(0)                      # пути в группы не трогаем
        if seg in MOVED_IDS:
            return m.group(0)                      # сосед-модуль — без изменений
        return f"{delim}{extra}{dots}{seg}{tail}"  # корневой таргет — глубже
    text = REF_RE.sub(r, text)
    text = text.replace("../apps/cooling/", "../cooling/")
    return text

def process_file(f, new_dir, gain):
    txt = f.read_text(encoding="utf-8"); orig = txt
    if f.suffix == ".html":
        blocks = []
        def stash(m): blocks.append(m.group(0)); return f"\0IM{len(blocks)-1}\0"
        txt = IM_RE.sub(stash, txt)
        txt = fix_refs(txt, gain)
        for i, b in enumerate(blocks):
            txt = txt.replace(f"\0IM{i}\0", rebuild_importmap(b, new_dir))
    else:
        txt = fix_refs(txt, gain)
    if txt != orig and not DRY:
        f.write_text(txt, encoding="utf-8", newline="")
    return txt != orig

def main():
    changed = 0
    for src in TO_MOVE:
        for f in list((ROOT/src).rglob("*.html")) + list((ROOT/src).rglob("*.js")):
            rel_old = f.relative_to(ROOT).as_posix()
            sub = rel_old.split("/")[1:-1]
            new_dir = "/".join([TO_MOVE[src]] + sub)
            gain = (new_dir.count("/")+1) - (("/".join(rel_old.split("/")[:-1])).count("/")+1)
            if process_file(f, new_dir, gain): changed += 1
    # apps/cooling: не двигается, но namespace-цели (meteo/service) переехали
    cidx = ROOT/"apps/cooling/index.html"
    if cidx.exists():
        t = cidx.read_text(encoding="utf-8"); n = rebuild_importmap(t, "apps/cooling")
        if n != t and not DRY: cidx.write_text(n, encoding="utf-8", newline="")
        if n != t: changed += 1
    # лаунчеры (НЕ двигаются): importmap указывает на namespace-цели
    for L in ["modules/index.html","dev/por-playground.html",
              "elements/index.html","help/index.html"]:
        p = ROOT/L
        if not p.exists(): continue
        t = p.read_text(encoding="utf-8"); n = rebuild_importmap(t, L.rsplit("/",1)[0])
        if n != t:
            if not DRY: p.write_text(n, encoding="utf-8", newline="")
            changed += 1; print("  launcher importmap:", L)
    print(f"{'DRY ' if DRY else ''}files content-changed: {changed}; dirs to git mv: {len(TO_MOVE)}")
    if DRY: return
    for src, dest in TO_MOVE.items():
        (ROOT/dest).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git","mv",src,dest], cwd=ROOT, check=True)
    print("git mv done:", len(TO_MOVE))

if __name__ == "__main__":
    main()
