#!/usr/bin/env node
// =========================================================================
// tools/boundary-lint.mjs — boundary-lint платформы Raschet (Фаза 0).
// Zero-deps (только встроенные модули Node). Проверяет закон импортов
// и сырые чужие LS-ключи по правилам shared/contracts/README.md §5.
//
// Запуск:
//   node tools/boundary-lint.mjs                 # отчёт; exit 1 если есть НОВЫЕ
//   node tools/boundary-lint.mjs --update-baseline  # перезаписать allowlist
//
// Аллоулист: shared/contracts/lint-allowlist.json (поле allow[]).
// Санкционированные текущие нарушения подавляются → CI зелёный с дня 1;
// каждое гасится по тикету ROADMAP X.1.3. Новое (не в allow[]) → fail.
// =========================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const ALLOW_PATH = join(ROOT, 'shared', 'contracts', 'lint-allowlist.json');
const UPDATE = process.argv.includes('--update-baseline');

// Каталоги-модули (PLUGGABLE/STANDALONE). Корневые js/* (кроме core)
// трактуем как модуль "constructor".
const MODULE_DIRS = new Set([
  'tech-workspace', 'ups-config', 'cooling', 'scs-config', 'scs-design',
  'mdc-config', 'battery', 'dgu-config', 'transformer-config', 'mv-config',
  'panel-config', 'pdu-config', 'rack-config', 'suppression-config',
  'meteo', 'psychrometrics', 'service', 'projects', 'reports', 'logistics',
  'facility-inventory', 'catalog', 'cable', 'schematic',
]);
// Файлы-исключения для R2 (имеют право работать с чужими LS-ключами).
const LS_EXEMPT = new Set([
  'shared/project-storage.js', 'shared/configuration-catalog.js',
  'shared/subscriptions.js', 'shared/project-context.js',
  'shared/project-bootstrap.js',
]);
const isBridge = (p) => /^shared\/[^/]*-bridge\.js$/.test(p) ||
  p === 'shared/legacy-rack-migration.js';
// Не сканируем.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dev', '.claude', 'configurator3d', 'elements',
  'sketch',
]);
const SKIP_FILES = new Set([
  'ROADMAP-archive.md', 'ROADMAP.md', 'tools/boundary-lint.mjs',
  'tools/gen-modules-json.mjs',
]);

function rel(p) { return relative(ROOT, p).split(sep).join('/'); }
function isCore(p) {
  return p.startsWith('js/engine/') || p.startsWith('js/calc/') ||
    p.startsWith('js/methods/');
}
function isCatalog(p) {
  return p.startsWith('shared/catalogs/') ||
    /^shared\/[^/]+-seed\.js$/.test(p) ||
    p.startsWith('shared/ups-types/') || p.startsWith('shared/battery-types/') ||
    p.startsWith('shared/por-types/');
}
function isShared(p) { return p.startsWith('shared/') && !isCatalog(p); }
function moduleOf(p) {
  const seg = p.split('/');
  if (MODULE_DIRS.has(seg[0])) return seg[0];
  // корневые js/* (не core) — модуль "constructor" (склейка приложения)
  if (seg[0] === 'js' && !isCore(p)) return 'constructor';
  if (seg[0] === 'index.html' || seg[0] === 'main.js') return 'constructor';
  return null;
}

// Сбор файлов .js/.mjs/.html
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const r = rel(full);
    if (SKIP_DIRS.has(name)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full, out); continue; }
    if (!/\.(m?js|html)$/.test(name)) continue;
    if (SKIP_FILES.has(r)) continue;
    out.push(full);
  }
  return out;
}

// Извлечение import/export-from спецификаторов (regex; достаточно для R*).
const IMPORT_RE =
  /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
// Сырой чужой LS-ключ: literal/template raschet.(project|projects|configurations|subscription).
const LS_RE =
  /localStorage\s*\.\s*(?:get|set|remove)Item\s*\(\s*[`'"]raschet\.(?:project|projects|configurations|subscription)[.`'"$]/;
const LS_TPL_RE =
  /[`'"]raschet\.project\.\$\{/; // template-форма ключа проекта

function resolveSpec(fileRel, spec) {
  if (!spec.startsWith('.')) return null; // bare/url — не файловый путь репо
  const abs = resolve(ROOT, dirname(fileRel), spec);
  return relative(ROOT, abs).split(sep).join('/');
}

function classify(p) {
  if (isCore(p)) return 'core';
  if (isCatalog(p)) return 'catalog';
  if (isShared(p)) return 'shared';
  if (moduleOf(p)) return 'module';
  return 'other';
}

function loadAllow() {
  try {
    const j = JSON.parse(readFileSync(ALLOW_PATH, 'utf8'));
    return Array.isArray(j.allow) ? j : { ...j, allow: [] };
  } catch { return { version: 1, allow: [] }; }
}
function allowKey(v) { return [v.rule, v.file, v.target || ''].join('::'); }

const allowDoc = loadAllow();
const allowSet = new Set(allowDoc.allow.map(allowKey));

const files = walk(ROOT, []);
const violations = [];
const r2warn = [];

for (const full of files) {
  const fileRel = rel(full);
  const cls = classify(fileRel);
  const text = readFileSync(full, 'utf8');
  const fileMod = moduleOf(fileRel);

  // --- Импортные правила (R1/R3/R4) ---
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const tgt = resolveSpec(fileRel, spec);
    if (!tgt) continue;
    const tgtCls = classify(tgt);

    // R3: CORE может импортировать CORE/SHARED/CATALOGS, но НЕ модуль
    // (фактическая инвариант: ядро не зависит от подключаемого модуля;
    // CORE→SHARED — норма, движок использует контракты shared/).
    if (cls === 'core' && tgtCls === 'module') {
      violations.push({ rule: 'R3-core-imports-module', file: fileRel,
        target: tgt, msg: `CORE импортирует модуль: ${spec}` });
      continue;
    }
    // Объявленные мосты (shared/<m>-bridge.js, legacy-rack-migration)
    // — санкционированный адаптер: вправе знать о двух модулях.
    if (isBridge(fileRel)) continue;
    // R4: CATALOG не импортирует модуль.
    if (cls === 'catalog' && tgtCls === 'module') {
      violations.push({ rule: 'R4-catalog-imports-module', file: fileRel,
        target: tgt, msg: `CATALOG импортирует модуль: ${spec}` });
      continue;
    }
    // R1: модуль не импортирует внутренности другого модуля.
    if (cls === 'module' && tgtCls === 'module') {
      const tgtMod = moduleOf(tgt);
      if (tgtMod && fileMod && tgtMod !== fileMod) {
        violations.push({ rule: 'R1-cross-module-import', file: fileRel,
          target: tgt, msg: `модуль «${fileMod}» импортирует «${tgtMod}»: ${spec}` });
      }
    }
    // SHARED не импортирует модуль (R-shared).
    if (cls === 'shared' && tgtCls === 'module') {
      violations.push({ rule: 'R-shared-imports-module', file: fileRel,
        target: tgt, msg: `SHARED импортирует модуль: ${spec}` });
    }
  }

  // --- R2: сырой чужой LS-ключ (ЭВРИСТИКА → WARN-only до Фазы 2) ---
  // Регэксп шумит (ловит projectKey()-комментарии/доку). Genuine
  // рефактор сырого доступа — ROADMAP X.1.3 / Фаза 2. В Фазе 0 R2 не
  // влияет на exit (только предупреждение), чтобы не плодить ложный
  // baseline. Жёсткие — только импортные R1/R3/R4/R-shared.
  if (!LS_EXEMPT.has(fileRel) && !isBridge(fileRel)) {
    if (LS_RE.test(text) ||
        (/localStorage\s*\.\s*(?:get|set|remove)Item/.test(text) && LS_TPL_RE.test(text))) {
      r2warn.push(fileRel);
    }
  }
}

// Разделение: подавленные (в allow) vs новые.
const suppressed = [];
const fresh = [];
for (const v of violations) {
  (allowSet.has(allowKey(v)) ? suppressed : fresh).push(v);
}

if (UPDATE) {
  const allow = violations.map(v => ({
    rule: v.rule, file: v.file, target: v.target || undefined,
    note: 'baseline 2026-05-16 (Фаза 0) — гасится по ROADMAP X.1.3',
  }));
  const doc = {
    _comment: 'Машинный baseline boundary-lint. Подавляет санкционированные ' +
      'текущие нарушения → CI зелёный с дня 1. Каждое гасится по ROADMAP ' +
      'X.1.3. НЕ добавлять новые без тикета. Спека: shared/contracts/README.md §5.',
    version: 2, updated: '2026-05-16',
    rulesDoc: 'shared/contracts/README.md §5',
    allow,
  };
  writeFileSync(ALLOW_PATH, JSON.stringify(doc, null, 2) + '\n');
  console.log(`[boundary-lint] baseline обновлён: ${allow.length} записей → ${rel(ALLOW_PATH)}`);
  process.exit(0);
}

// Отчёт.
const byRule = {};
for (const v of fresh) (byRule[v.rule] ??= []).push(v);
console.log(`[boundary-lint] файлов проверено: ${files.length}`);
console.log(`[boundary-lint] жёсткие нарушения: ${violations.length} ` +
  `(подавлено allowlist: ${suppressed.length}, НОВЫХ: ${fresh.length})`);
if (r2warn.length) {
  console.log(`[boundary-lint] ⚠ R2 (advisory, не блокирует): ` +
    `${r2warn.length} файлов трогают чужой LS-ключ literal/template — ` +
    `рефактор через project-storage запланирован (ROADMAP X.1.3 / Фаза 2).`);
}
if (fresh.length) {
  console.log('\n=== НОВЫЕ нарушения границ (требуют тикета/исправления) ===');
  for (const rule of Object.keys(byRule).sort()) {
    console.log(`\n[${rule}]`);
    for (const v of byRule[rule]) {
      console.log(`  ${v.file}${v.target ? ' → ' + v.target : ''}\n    ${v.msg}`);
    }
  }
  console.log('\nЕсли это сознательное временное нарушение — добавить тикет ' +
    'X.1.3 и запись в shared/contracts/lint-allowlist.json (allow[]).');
  process.exit(1);
}
console.log('[boundary-lint] OK — новых нарушений нет (baseline зелёный).');
process.exit(0);
