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

const FLAG_KEY = 'raschet.legacy-rack-migration.v2';

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
  // Маркеры для дедупликации при повторном запуске и для трассировки
  // обратно к legacy LS.
  partial.legacyRackId = rackId;
  partial.legacySource = info.source;
  return partial;
}

/**
 * Мигрировать legacy racks одного проекта.
 * Возвращает { created, skipped }.
 */
export function migrateProjectLegacyRacks(pid, opts) {
  if (!pid) return { created: 0, skipped: 0 };
  const legacy = _collectLegacyRacks(pid);
  if (!legacy.size) return { created: 0, skipped: 0 };

  // Существующие POR-объекты type='rack' для этого pid — для дедупа.
  const existingPor = getObjects(pid, { type: 'rack' });
  const existingByLegacyId = new Map();
  for (const o of existingPor) {
    if (o.legacyRackId) existingByLegacyId.set(o.legacyRackId, o);
  }

  let created = 0, skipped = 0;
  for (const [rackId, info] of legacy.entries()) {
    if (existingByLegacyId.has(rackId)) { skipped++; continue; }
    const partial = _legacyToPorPartial(rackId, info);
    if (!partial) continue;
    const obj = addObject(pid, partial);
    if (obj) {
      created++;
      console.info(`[legacy-rack-migration] pid=${pid} rack ${rackId} (${info.tag||'no-tag'}) → POR ${obj.id}`);
    }
  }
  return { created, skipped };
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

  let totalCreated = 0, totalSkipped = 0, processed = 0;
  for (const p of projects) {
    if (!p || !_isProjectLikeId(p.id)) continue;
    const r = migrateProjectLegacyRacks(p.id);
    totalCreated += r.created;
    totalSkipped += r.skipped;
    processed++;
  }

  try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
  if (totalCreated > 0) {
    console.info(`[legacy-rack-migration] processed ${processed} projects, created ${totalCreated} POR-objects, skipped ${totalSkipped} (already migrated)`);
  }
  return { created: totalCreated, skipped: totalSkipped, processed };
}

if (typeof window !== 'undefined') {
  window.RaschetLegacyRackMigration = {
    runAll: migrateAllLegacyRacks,
    runOne: migrateProjectLegacyRacks,
    reset: () => { try { localStorage.removeItem(FLAG_KEY); } catch {} },
  };
}
