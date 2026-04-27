// ======================================================================
// shared/scheme-orphan-migration.js
//
// Одноразовая миграция: находит Storage-схемы (id 'lp_*') без валидной
// привязки к проект-контейнеру (projectId пустой ИЛИ ссылается на
// несуществующий проект) и для каждой создаёт собственный проект-
// контейнер с тем же именем. Затем линкует scheme.projectId = ctx.id.
//
// Зачем: до v0.59.506 «+ Новый проект» создавал контейнер + схему вместе,
// а «+ Добавить → Схема» — только схему. Часть схем оказывалась без
// контейнера, что:
//   • показывало их в списке /projects/ как top-level (фикс v0.59.506),
//   • ломало POR-pid резолвер (data.projectId || data.id) — POR клался
//     в scheme-id вместо контейнер-id, не шарился между схемами.
//
// После миграции каждая схема имеет parent-контейнер. Дальше user может
// руками сгруппировать их (переименовать контейнеры, drag & drop —
// функционал по необходимости отдельно).
//
// Триггер: вызывается из shared/project-storage.js при загрузке. Флаг
// 'raschet.scheme-orphan-migration.v1' = '1' предотвращает повторный
// запуск.
// ======================================================================

import { listProjects, createProject } from './project-storage.js';

const MIGRATION_FLAG = 'raschet.scheme-orphan-migration.v1';

function _isStorageScheme(p) {
  if (!p || typeof p.id !== 'string') return false;
  if (p.id.startsWith('lp_')) return true;
  // Старые cloud-схемы могут не иметь lp_-префикса, но иметь поля Storage:
  if ('scheme' in p) return true;
  if ('memberUids' in p) return true;
  return false;
}

function _isProjectContext(p) {
  if (!p || typeof p.id !== 'string') return false;
  // Project-context: id 'p_*' или 's_*', есть kind ('full'/'sketch').
  if (p.id.startsWith('p_') || p.id.startsWith('s_')) return true;
  if (p.kind === 'full' || p.kind === 'sketch') return true;
  return false;
}

/** Нормализация имени для match: trim + lowercase + collapse spaces. */
function _normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Найти orphan-схемы и привязать к существующим проектам или создать
 * контейнеры. Стратегия:
 *   1. Если scheme.projectId валидный — пропустить.
 *   2. Иначе попытаться найти project-контейнер с ТЕМ ЖЕ именем (без
 *      учёта регистра/пробелов). Если найден — линкуем туда.
 *   3. Иначе создаём новый контейнер.
 *
 * Возвращает { matched, created, skipped, alreadyDone }.
 */
export function migrateOrphanSchemes(opts) {
  const force = opts && opts.force === true;
  try {
    if (!force && localStorage.getItem(MIGRATION_FLAG) === '1') {
      return { matched: 0, created: 0, skipped: 0, alreadyDone: true };
    }
  } catch {}

  let arr;
  try { arr = listProjects(); } catch { return { matched: 0, created: 0, skipped: 0, error: 'listProjects failed' }; }
  if (!Array.isArray(arr) || arr.length === 0) {
    try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch {}
    return { matched: 0, created: 0, skipped: 0 };
  }

  // Множество id project-контейнеров + map nameNormalized → ctx (для матчинга по имени).
  const contexts = arr.filter(_isProjectContext);
  const ctxIds   = new Set(contexts.map(p => p.id));
  const ctxByName = new Map();
  for (const c of contexts) {
    const k = _normName(c.name);
    if (k && !ctxByName.has(k)) ctxByName.set(k, c);
  }

  let matched = 0, created = 0, skipped = 0;
  for (const p of arr) {
    if (!_isStorageScheme(p)) continue;
    const linkedCtx = p.projectId && ctxIds.has(p.projectId);
    if (linkedCtx) { skipped++; continue; }

    const baseName = (p.name && String(p.name).trim()) || 'Без имени';
    let targetCtxId = null;
    let createdNew  = false;

    // (2) Пытаемся найти контейнер с тем же именем.
    const matchKey = _normName(baseName);
    if (matchKey && ctxByName.has(matchKey)) {
      targetCtxId = ctxByName.get(matchKey).id;
    } else {
      // (3) Создаём новый контейнер.
      try {
        const ctx = createProject({
          name:        baseName,
          description: `Авто-создан миграцией orphan-схем (${new Date().toISOString().slice(0, 10)}). Содержит схему «${baseName}».`,
          status:      'draft',
        });
        if (ctx && ctx.id) {
          targetCtxId = ctx.id;
          ctxIds.add(ctx.id);
          ctxByName.set(matchKey || ctx.id, ctx);
          createdNew = true;
        }
      } catch (e) { console.warn('[orphan-migration] createProject failed for', baseName, e); }
    }

    if (!targetCtxId) continue;

    // Линкуем scheme.projectId напрямую в LS (Storage.saveProject требовал бы init).
    try {
      const fresh = listProjects();
      const idx = fresh.findIndex(x => x && x.id === p.id);
      if (idx >= 0) {
        fresh[idx].projectId = targetCtxId;
        fresh[idx].updatedAt = Date.now();
        try { localStorage.setItem('raschet.projects.v1', JSON.stringify(fresh)); } catch {}
      }
      if (createdNew) created++;
      else matched++;
      console.info(`[orphan-migration] scheme ${p.id} «${baseName}» → ${createdNew ? 'НОВЫЙ' : 'СУЩЕСТВУЮЩИЙ'} контейнер ${targetCtxId}`);
    } catch (e) { console.warn('[orphan-migration] link failed for', p.id, e); }
  }

  try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch {}
  if (matched + created > 0) {
    console.info(`[orphan-migration] завершено: matched ${matched}, created ${created}, skipped ${skipped}`);
  }
  return { matched, created, skipped };
}

/** Принудительный пере-запуск (через console: RaschetSchemeMigration.run({force:true})). */
if (typeof window !== 'undefined') {
  window.RaschetSchemeMigration = {
    run: migrateOrphanSchemes,
    reset: () => { try { localStorage.removeItem(MIGRATION_FLAG); } catch {} },
  };
}
