// ======================================================================
// shared/legacy-rack-migration.js
//
// Одноразовая миграция: legacy rack-instances из rack-config.instances.v1
// + scs-config.contents.v1/rackTags.v1 → POR-объекты type='rack'.
//
// Зачем: до Phase 2.5 racks хранились во множестве LS-ключей
// (rack-config.instances, scs-config.contents, scs-config.rackTags), и
// разные модули читали РАЗНЫЕ источники. Это проявлялось как
// рассогласование UI (на карточке проекта 8 стоек, а в СКС-модуле
// «legacy режим, ничего нет»). POR должен стать единым источником.
//
// Стратегия:
//   • Перебрать ВСЕ project-id из массива projects (raschet.projects.v1)
//     — учитываем только project-контейнеры (p_*/s_*) и orphan-схемы
//     (lp_* без linkedCtx).
//   • Для каждого pid:
//     1. Загрузить rack-config/instances.v1 — это «реальные» стойки.
//     2. Загрузить scs-config/contents.v1 — записи с rackId без
//        соответствующего instance считаются tag-only стойками.
//     3. Загрузить scs-config/rackTags.v1 — пары rackId→tag.
//     4. Объединить уникальные racks (по id).
//     5. Создать POR-объект type='rack' для каждого uniq rack, если
//        ещё нет (по тегу или legacyId).
//
// Дедупликация: каждая POR-запись хранит legacyRackId (исходный id из
// rack-config.instances) и/или legacyTag для повторного match. Если
// миграция уже создала POR с тем же legacyRackId — пропускаем.
//
// Триггер: вызывается на startup-страниц где может быть pid (engine
// main.js при открытии проекта). Управляется флагом
// 'raschet.legacy-rack-migration.v2' (v2 вешаем на каждое расширение
// логики).
// ======================================================================

import { listProjects, projectKey } from './project-storage.js';
import { getObjects, addObject, patchObject } from './por.js';
import { getPorType } from './por-types/index.js';

// v3: переход на детерминистические POR-id (por_legacy_<rackId>) и
// auto-dedup существующих дублей. Старые записи с v2-флагом будут
// мигрированы повторно — addObject upsert-перезаписывает по id.
const FLAG_KEY = 'raschet.legacy-rack-migration.v3';

function _load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

function _isProjectLikeId(id) {
  if (typeof id !== 'string') return false;
  // Включаем p_ (контейнер), s_ (sketch), lp_ (Storage scheme — orphan-схемы
  // тоже могли иметь привязанные racks через legacy).
  return id.startsWith('p_') || id.startsWith('s_') || id.startsWith('lp_');
}

/**
 * Собрать legacy racks для одного pid.
 * Возвращает Map<rackId, {tag, name, source, raw}>.
 */
function _collectLegacyRacks(pid) {
  const out = new Map();

  // 1) rack-config.instances.v1 — главный источник instance-данных.
  const instances = _load(projectKey(pid, 'rack-config', 'instances.v1'), []);
  if (Array.isArray(instances)) {
    for (const r of instances) {
      if (!r || !r.id) continue;
      out.set(r.id, {
        tag:    r.tag || r.label || '',
        name:   r.name || r.label || '',
        source: 'rack-config.instances',
        raw:    r,
      });
    }
  }

  // 2) scs-config.rackTags.v1 — { rackId: tag } / Map<rackId,string>.
  const tags = _load(projectKey(pid, 'scs-config', 'rackTags.v1'), {});
  if (tags && typeof tags === 'object') {
    for (const [rackId, tag] of Object.entries(tags)) {
      if (!rackId) continue;
      if (!out.has(rackId)) {
        out.set(rackId, { tag: String(tag || ''), name: '', source: 'scs-config.rackTags', raw: null });
      } else if (!out.get(rackId).tag) {
        out.get(rackId).tag = String(tag || '');
      }
    }
  }

  // 3) scs-config.contents.v1 — { rackId: [devices...] } — стойки с
  //    содержимым. Если их нет в instances — добавляем как tag-only.
  const contents = _load(projectKey(pid, 'scs-config', 'contents.v1'), {});
  if (contents && typeof contents === 'object') {
    for (const rackId of Object.keys(contents)) {
      if (!rackId) continue;
      if (!out.has(rackId)) {
        out.set(rackId, { tag: '', name: '', source: 'scs-config.contents', raw: null });
      }
    }
  }

  return out;
}

/**
 * Построить POR-partial из legacy raw-объекта.
 * raw — это объект из rack-config.instances.v1 (имеет поля u, width,
 * depth, demandKw, cosphi, name, tag, ...).
 */
/** Детерминистический POR-id из legacy-rackId. Коллизия безопасна: одинаковый
 *  rackId внутри ОДНОГО pid → один POR-id → addObject upsert-перезаписывает. */
function _legacyPorId(rackId) {
  // Безопасные символы только: буквы/цифры/_/-. Прочее — заменяем.
  const safe = String(rackId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return 'por_legacy_' + (safe || 'noid');
}

function _legacyToPorPartial(rackId, info) {
  const r = info.raw || {};
  const def = getPorType('rack');
  if (!def) return null;
  const partial = def.factory({
    tag:       info.tag || r.tag || rackId,
    name:      info.name || r.name || (info.tag ? `Стойка ${info.tag}` : 'Стойка'),
    rackUnits: Number(r.u || r.units || 42),
    widthMm:   Number(r.width  || r.widthMm  || 600),
    depthMm:   Number(r.depth  || r.depthMm  || 800),
    heightMm:  Number(r.heightMm || 1991),
    demandKw:  Number(r.demandKw || 0),
    cosPhi:    Number(r.cosphi || r.cosPhi || 0.95),
    phases:    Number(r.phases || 3),
    voltageV:  Number(r.voltageV || 400),
  });
  if (!partial) return null;
  // v0.59.510: детерминистический id — повторный запуск миграции
  // upsert-перезапишет вместо создания дубликата. legacyRackId хранится
  // также для трассировки и совместимости со старой логикой.
  partial.id = _legacyPorId(rackId);
  partial.legacyRackId = rackId;
  partial.legacySource = info.source;
  return partial;
}

/**
 * Мигрировать legacy racks одного проекта. С детерминистическими id —
 * повторный запуск upsert-перезаписывает существующие POR-объекты, не
 * создаёт дубли.
 * Возвращает { created, updated, totalLegacy }.
 */
export function migrateProjectLegacyRacks(pid, opts) {
  if (!pid) return { created: 0, updated: 0 };
  const legacy = _collectLegacyRacks(pid);
  if (!legacy.size) return { created: 0, updated: 0 };

  const existingPor = getObjects(pid, { type: 'rack' });
  const existingIds = new Set(existingPor.map(o => o.id));

  let created = 0, updated = 0;
  for (const [rackId, info] of legacy.entries()) {
    const partial = _legacyToPorPartial(rackId, info);
    if (!partial) continue;
    const isUpdate = existingIds.has(partial.id);
    const obj = addObject(pid, partial);
    if (obj) {
      if (isUpdate) updated++; else created++;
      if (!isUpdate) {
        console.info(`[legacy-rack-migration] pid=${pid} rack ${rackId} (${info.tag||'no-tag'}) → POR ${obj.id}`);
      }
    }
  }
  return { created, updated, totalLegacy: legacy.size };
}

/**
 * Очистить существующие дубликаты POR-объектов type='rack' в проекте.
 * Группирует по (tag, demandKw, widthMm, depthMm). Для каждой группы
 * оставляет ОДИН объект с детерминистическим legacy-id (если есть) или
 * самый старый. Остальные удаляет.
 *
 * Возвращает { removed, kept, groups }.
 */
export function deduplicateProjectRacks(pid) {
  if (!pid) return { removed: 0, kept: 0, groups: 0 };
  const racks = getObjects(pid, { type: 'rack' });
  if (!racks.length) return { removed: 0, kept: 0, groups: 0 };

  // Группировка по (tag + ключевые мех./электр. параметры).
  const groupKey = (o) => {
    const m = (o.domains && o.domains.mechanical) || {};
    const e = (o.domains && o.domains.electrical) || {};
    return [o.tag || '', e.demandKw || 0, m.widthMm || 0, m.depthMm || 0, m.rackUnits || 0].join('|');
  };

  const groups = new Map();
  for (const r of racks) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  let removed = 0, kept = 0;
  // Импорт removeObject лениво — circular import safe.
  const { removeObject } = (typeof require === 'function') ? null : require('./por.js') || {};

  for (const [, arr] of groups.entries()) {
    if (arr.length === 1) { kept++; continue; }
    // Выбираем «победителя»:
    // 1. Детерминистический legacy-id (id начинается с por_legacy_).
    // 2. Иначе — самый старый (createdAt).
    arr.sort((a, b) => {
      const aL = String(a.id || '').startsWith('por_legacy_') ? 0 : 1;
      const bL = String(b.id || '').startsWith('por_legacy_') ? 0 : 1;
      if (aL !== bL) return aL - bL;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    const winner = arr[0];
    kept++;
    for (let i = 1; i < arr.length; i++) {
      // Подгружаем removeObject лениво (избегаем circular).
      try {
        // eslint-disable-next-line global-require
        const por = window.RaschetPOR || {};
        if (por.removeObject) por.removeObject(pid, arr[i].id);
        removed++;
      } catch (e) { console.warn('[dedup] remove failed:', e); }
    }
  }
  console.info(`[legacy-rack-migration] dedup pid=${pid}: kept ${kept}, removed ${removed} (groups ${groups.size})`);
  return { removed, kept, groups: groups.size };
}

/**
 * Мигрировать ВСЕ известные проекты. Возвращает агрегат.
 * Управляется флагом FLAG_KEY (раз в сессию через LS).
 */
export function migrateAllLegacyRacks(opts) {
  const force = opts && opts.force === true;
  try {
    if (!force && localStorage.getItem(FLAG_KEY) === '1') {
      return { created: 0, skipped: 0, alreadyDone: true };
    }
  } catch {}

  let projects;
  try { projects = listProjects(); } catch { return { created: 0, skipped: 0, error: 'listProjects failed' }; }
  if (!Array.isArray(projects)) return { created: 0, skipped: 0 };

  let totalCreated = 0, totalUpdated = 0, totalDedupRemoved = 0, processed = 0;
  for (const p of projects) {
    if (!p || !_isProjectLikeId(p.id)) continue;
    const r = migrateProjectLegacyRacks(p.id);
    totalCreated += r.created;
    totalUpdated += r.updated;
    // Сразу после миграции — dedup на случай старых дубликатов из v2.
    try {
      const d = deduplicateProjectRacks(p.id);
      totalDedupRemoved += d.removed;
    } catch {}
    processed++;
  }

  try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
  if (totalCreated > 0 || totalDedupRemoved > 0) {
    console.info(`[legacy-rack-migration] processed ${processed} projects: created ${totalCreated}, updated ${totalUpdated}, dedup removed ${totalDedupRemoved}`);
  }
  return { created: totalCreated, updated: totalUpdated, dedupRemoved: totalDedupRemoved, processed };
}

if (typeof window !== 'undefined') {
  window.RaschetLegacyRackMigration = {
    runAll: migrateAllLegacyRacks,
    runOne: migrateProjectLegacyRacks,
    dedupOne: deduplicateProjectRacks,
    reset: () => { try { localStorage.removeItem(FLAG_KEY); } catch {} },
  };
}
