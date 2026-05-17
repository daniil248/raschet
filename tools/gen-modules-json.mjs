#!/usr/bin/env node
// =========================================================================
// tools/gen-modules-json.mjs — генератор/валидатор реестра модулей
// (Фаза 1). Zero-deps. Источник правды — <module>/manifest.json;
// корневой modules.json — ПРОЕКЦИЯ манифестов на поля, которые читают
// потребители (hub.html / /modules/ / shared/subscriptions.js).
//
//   node tools/gen-modules-json.mjs --check   # сверка с modules.json (CI)
//   node tools/gen-modules-json.mjs --write   # перегенерировать modules.json
//
// Фаза 1 (zero-risk): запускаем ТОЛЬКО --check. modules.json НЕ
// перезаписывается, пока паритет не подтверждён зелёным прогоном CI.
// Порядок модулей в массиве = REGISTRY_ORDER (как в текущем modules.json,
// т.к. hub рендерит по порядку). Расширенные поля манифеста
// (version/owner/dependsOnContracts/…) в проекцию НЕ попадают —
// modules.json остаётся функционально идентичным (без регрессий).
// =========================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const MJSON = join(ROOT, 'modules.json');
const MODE = process.argv.includes('--write') ? 'write'
  : process.argv.includes('--check') ? 'check' : 'check';

// Порядок реестра (как в текущем modules.json — hub зависит от порядка).
const REGISTRY_ORDER = [
  'constructor', 'cable', 'schematic', 'sketch', 'battery', 'ups-config',
  'panel-config', 'mv-config', 'transformer-config', 'reports', 'catalog',
  'help', 'tech-workspace', 'logistics', 'projects',
  // Фаза 1 — регистрация ранее не учтённых UI-модулей (subscriptionPlan
  // 'free' → без UI-лока, поведение идентично «не в реестре»).
  'cooling', 'meteo', 'service', 'scs-config', 'scs-design', 'rack-config',
  'mdc-config', 'genset-config', 'pdu-config', 'suppression-config',
  'psychrometrics', 'facility-inventory', 'configurator3d',
  // calc-lib (kind:'calc-lib') — без UI/subscription-check, auto-included.
  'suppression-methods', 'hydraulic-methods', 'hvac-methods', 'gas-methods',
  'electrical-methods',
];

// Папка модуля по id. После file-structure restructuring манифесты
// лежат в apps/<id>/ (UI-модули) либо lib/<id>/ (calc-lib); constructor —
// в корне (manifest.json); часть корневых модулей (help) — <id>/.
// Резолвер ищет в каноничном порядке: apps → lib → root-<id> → root.
function manifestPath(id) {
  if (id === 'constructor') return join(ROOT, 'manifest.json');
  const cands = [
    join(ROOT, 'apps', id, 'manifest.json'),
    join(ROOT, 'lib', id, 'manifest.json'),
    join(ROOT, id, 'manifest.json'),
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return cands[0]; // не найден — вернём apps-путь (existsSync ниже даст diagnostic)
}

// Проекция манифеста → запись modules.json (только потребительские поля,
// в порядке как в текущем файле; неизвестные/расширенные — отбрасываем).
function project(mf) {
  const o = {};
  o.id = mf.id;
  o.name = mf.name;
  o.description = mf.description;
  o.path = mf.path;
  o.icon = mf.icon;
  o.badge = mf.badge;
  o.requires = mf.requires || [];
  o.dbCollections = mf.dbCollections || [];
  o.permissions = mf.permissions || [];
  o.enabled = mf.enabled !== false;
  o.kind = mf.kind || 'ui';
  o.subscriptionPlan = mf.subscriptionPlan || 'free';
  o.internalOnly = !!mf.internalOnly;
  return o;
}

// Нормализация для сравнения: сорт ключей рекурсивно (порядок ключей в
// объекте не важен потребителям; порядок массива modules — важен и НЕ
// сортируется).
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  }
  return v;
}

const missing = [];
const modules = [];
for (const id of REGISTRY_ORDER) {
  const p = manifestPath(id);
  if (!existsSync(p)) { missing.push(id); continue; }
  let mf;
  try { mf = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { console.error(`[gen-modules-json] невалидный JSON: ${p}: ${e.message}`); process.exit(2); }
  if (mf.id !== id) {
    console.error(`[gen-modules-json] id манифеста «${mf.id}» ≠ ожидаемому «${id}» (${p})`);
    process.exit(2);
  }
  modules.push(project(mf));
}

if (missing.length) {
  console.error(`[gen-modules-json] нет manifest.json для: ${missing.join(', ')}`);
  console.error('Фаза 1: создать <module>/manifest.json для всех 15 ' +
    'зарегистрированных модулей.');
  process.exit(2);
}

const cur = JSON.parse(readFileSync(MJSON, 'utf8'));
const built = { ...cur, modules }; // сохраняем $schema/version/description

if (MODE === 'write') {
  writeFileSync(MJSON, JSON.stringify(built, null, 2) + '\n');
  console.log(`[gen-modules-json] modules.json перегенерирован (${modules.length} модулей).`);
  process.exit(0);
}

// --check: паритет проекции манифестов с текущим modules.json (по
// массиву modules; порядок важен, порядок ключей — нет).
const a = JSON.stringify(norm(cur.modules));
const b = JSON.stringify(norm(built.modules));
if (a === b) {
  console.log(`[gen-modules-json] OK — manifests ↔ modules.json паритет (${modules.length} модулей).`);
  process.exit(0);
}
console.error('[gen-modules-json] РАСХОЖДЕНИЕ manifests ↔ modules.json:');
for (let i = 0; i < Math.max(cur.modules.length, built.modules.length); i++) {
  const x = JSON.stringify(norm(cur.modules[i]));
  const y = JSON.stringify(norm(built.modules[i]));
  if (x !== y) {
    console.error(`\n  [#${i}] id=${(built.modules[i]||{}).id || (cur.modules[i]||{}).id}`);
    console.error(`   modules.json: ${x}`);
    console.error(`   из manifest : ${y}`);
  }
}
console.error('\nПривести <module>/manifest.json к modules.json (или ' +
  '--write после подтверждения паритета в CI).');
process.exit(1);
