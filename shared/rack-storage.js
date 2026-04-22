// =========================================================================
// shared/rack-storage.js — v0.59.278
//
// Единая точка доступа к «стойкам» (корпусам). Ввели после того, как
// пользовательская коллекция смешивала в одном ключе
// `rack-config.templates.v1` и настоящие шаблоны (tpl-*, черновики без
// префикса), и экземпляры, развёрнутые в проект (inst-*). Из-за этого:
//   • экземпляры одного проекта «протекали» в списки других проектов;
//   • rack-config показывал inst-* в библиотеке шаблонов;
//   • удалить/скопировать мини-проект без ручной чистки было нельзя.
//
// Новая модель:
//   ШАБЛОНЫ (корпуса-дизайны) — остаются в двух местах, как было:
//     • глобальный       `rack-config.templates.v1`
//     • project-scoped   `raschet.project.<pid>.rack-config.templates.v1`
//   ЭКЗЕМПЛЯРЫ (конкретные стойки в проекте, id = 'inst-*') — ТОЛЬКО в:
//     • project-scoped   `raschet.project.<pid>.rack-config.instances.v1`
//
// loadAllRacksForActiveProject() возвращает объединение (шаблоны + экземпляры
// активного проекта). Это сохраняет привычный контракт для модулей-читателей
// scs-config / scs-design, которые раньше делали один read из глобального LS.
//
// Одноразовая миграция migrateLegacyInstances() разделяет существующие
// данные по префиксу id и переносит inst-* в активный проект, если они ещё
// не там. Маркер 'rack-config.instances.migrated.v1' = '1' по завершении.
// =========================================================================

import {
  ensureDefaultProject, getActiveProjectId, projectKey, listProjects
} from './project-storage.js';

const LS_TEMPLATES_GLOBAL = 'rack-config.templates.v1';
const MIGRATED_FLAG = 'rack-config.instances.migrated.v1';

function parseJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

export function instancesKey(pid) {
  return projectKey(pid, 'rack-config', 'instances.v1');
}
export function templatesScopedKey(pid) {
  return projectKey(pid, 'rack-config', 'templates.v1');
}

export { LS_TEMPLATES_GLOBAL };

/** Загрузить только шаблоны (глобальные + проект активного). Без экземпляров. */
export function loadTemplates() {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  const global = parseJson(LS_TEMPLATES_GLOBAL, []);
  const scoped = pid ? parseJson(templatesScopedKey(pid), []) : [];
  const out = [];
  const seen = new Set();
  (Array.isArray(global) ? global : []).forEach(r => {
    if (!r || !r.id || String(r.id).startsWith('inst-')) return; // inst-* здесь быть не должно после миграции
    if (seen.has(r.id)) return;
    seen.add(r.id); out.push(r);
  });
  (Array.isArray(scoped) ? scoped : []).forEach(r => {
    if (!r || !r.id || String(r.id).startsWith('inst-')) return;
    if (seen.has(r.id)) return;
    seen.add(r.id); out.push(r);
  });
  return out;
}

/** Загрузить только экземпляры активного проекта. */
export function loadInstances() {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  if (!pid) return [];
  const arr = parseJson(instancesKey(pid), []);
  return Array.isArray(arr) ? arr.filter(r => r && r.id) : [];
}

/** Объединение: шаблоны + экземпляры активного проекта. Для обратной совместимости с state.racks. */
export function loadAllRacksForActiveProject() {
  const t = loadTemplates();
  const i = loadInstances();
  return [...t, ...i];
}

/** Сохранить массив экземпляров в активный проект (ключ project-scoped). */
export function saveInstances(arr) {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  if (!pid) return;
  const insts = (Array.isArray(arr) ? arr : []).filter(r => r && r.id && String(r.id).startsWith('inst-'));
  try { localStorage.setItem(instancesKey(pid), JSON.stringify(insts)); } catch {}
}

/** Сохранить массив шаблонов в глобальный ключ. (Project-scoped шаблоны — отдельный API). */
export function saveGlobalTemplates(arr) {
  const tpls = (Array.isArray(arr) ? arr : []).filter(r => r && r.id && !String(r.id).startsWith('inst-'));
  try { localStorage.setItem(LS_TEMPLATES_GLOBAL, JSON.stringify(tpls)); } catch {}
}

/**
 * Сохранить объединённый массив (для старого кода, который держит state.racks).
 * Автоматически разложит по id-префиксу: inst-* → проект; остальные → глобальные шаблоны.
 * Нигде не затронет project-scoped ключ ШАБЛОНОВ — туда пишет только rack-config.
 */
export function saveAllRacksForActiveProject(arr) {
  if (!Array.isArray(arr)) return;
  const instances = [];
  const globalTpls = [];
  // Узнаём, какие id изначально приехали из project-scoped шаблонов — их не
  // перезаписываем в глобальный ключ (иначе шаблон «перелетит» в глобал).
  const pid = getActiveProjectId();
  const scopedTplIds = new Set();
  if (pid) {
    const s = parseJson(templatesScopedKey(pid), []);
    if (Array.isArray(s)) s.forEach(r => { if (r && r.id) scopedTplIds.add(r.id); });
  }
  arr.forEach(r => {
    if (!r || !r.id) return;
    if (String(r.id).startsWith('inst-')) { instances.push(r); return; }
    if (scopedTplIds.has(r.id)) return; // пришёл из project-scoped — не трогаем
    globalTpls.push(r);
  });
  // Сохраняем только те коллекции, куда реально пишем.
  saveInstances(instances);
  // Глобальные шаблоны: мержим с уже существующими (чтобы не потерять записи
  // других проектов, которых в переданном arr не было).
  const existing = parseJson(LS_TEMPLATES_GLOBAL, []);
  const seen = new Set(globalTpls.map(r => r.id));
  if (Array.isArray(existing)) {
    existing.forEach(r => {
      if (!r || !r.id) return;
      if (String(r.id).startsWith('inst-')) return; // старый мусор — отбрасываем
      if (seen.has(r.id)) return;                    // переданный вариант важнее
      globalTpls.push(r);
    });
  }
  saveGlobalTemplates(globalTpls);
}

/**
 * Одноразовая миграция. Разделяет смешанное содержимое
 * 'rack-config.templates.v1': inst-* уходят в активный проект (instances.v1),
 * остальное — остаётся в глобальном ключе шаблонов.
 *
 * Если active project нет — не делаем ничего (оставляем старые данные); это
 * безопасно, миграция сработает на первой же загрузке после создания проекта.
 */
export function migrateLegacyInstances() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') return { migrated: 0, skipped: true };
    ensureDefaultProject();
    const pid = getActiveProjectId();
    if (!pid) return { migrated: 0, skipped: true, reason: 'no-active-project' };
    const legacy = parseJson(LS_TEMPLATES_GLOBAL, []);
    if (!Array.isArray(legacy) || !legacy.length) {
      localStorage.setItem(MIGRATED_FLAG, '1');
      return { migrated: 0, skipped: true };
    }
    const tpls = [];
    const insts = [];
    legacy.forEach(r => {
      if (!r || !r.id) return;
      if (String(r.id).startsWith('inst-')) insts.push(r);
      else tpls.push(r);
    });
    // Экземпляры: мерджим с тем, что уже есть в проекте (на случай повторного запуска).
    const curInsts = parseJson(instancesKey(pid), []);
    const haveIds = new Set((Array.isArray(curInsts) ? curInsts : []).map(r => r && r.id).filter(Boolean));
    const mergedInsts = Array.isArray(curInsts) ? curInsts.slice() : [];
    insts.forEach(r => { if (!haveIds.has(r.id)) mergedInsts.push(r); });
    try { localStorage.setItem(instancesKey(pid), JSON.stringify(mergedInsts)); } catch {}
    // Глобальный ключ — только шаблоны.
    try { localStorage.setItem(LS_TEMPLATES_GLOBAL, JSON.stringify(tpls)); } catch {}
    localStorage.setItem(MIGRATED_FLAG, '1');
    return { migrated: insts.length, skipped: false };
  } catch (e) {
    console.warn('[rack-storage] migrate error:', e);
    return { migrated: 0, error: String(e && e.message || e) };
  }
}

/** Удалить экземпляры указанного проекта (для «удалить проект»/«копировать проект»). */
export function wipeInstancesForProject(pid) {
  if (!pid) return;
  try { localStorage.removeItem(instancesKey(pid)); } catch {}
}

/** Скопировать все экземпляры из srcPid в dstPid (с новыми id, чтобы теги не конфликтовали). */
export function cloneInstancesBetweenProjects(srcPid, dstPid) {
  if (!srcPid || !dstPid || srcPid === dstPid) return { copied: 0 };
  const src = parseJson(instancesKey(srcPid), []);
  if (!Array.isArray(src) || !src.length) return { copied: 0 };
  const idMap = {};
  const copies = src.map(r => {
    const c = JSON.parse(JSON.stringify(r));
    const newId = 'inst-' + Math.random().toString(36).slice(2, 10);
    idMap[r.id] = newId;
    c.id = newId;
    return c;
  });
  try { localStorage.setItem(instancesKey(dstPid), JSON.stringify(copies)); } catch {}
  return { copied: copies.length, idMap };
}
