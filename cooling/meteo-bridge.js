// =============================================================================
// cooling/meteo-bridge.js — мост к данным модуля Meteo
// =============================================================================
// Cooling Systems не дублирует UI загрузки климата — он читает датасеты,
// загруженные модулем Meteo через тот же ключ project-storage.
//
// Это даёт «слабую» связь: Cooling работоспособен пока есть хоть один
// датасет в Meteo, но не зависит от его UI и не разделяет состояние.
//
// Если в Meteo нет ⭐-датасета — Cooling показывает пустое состояние
// со ссылкой «📅 Открыть Meteo →».

import { ensureDefaultProject, projectKey, getActiveProjectId } from 'shared/project-storage.js';
import { idbGet, idbAvailable } from 'shared/idb-store.js';

const KEY_DATA = ['meteo', 'datasets.v1'];
const KEY_ACTIVE = ['meteo', 'activeId.v1'];
const KEY_FILTER = ['meteo', 'globalFilter.v1'];

function loadJson(pid, suffix, fallback) {
  if (!pid) return fallback;
  try {
    const raw = localStorage.getItem(projectKey(pid, ...suffix));
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/* v0.60.50 fix: раньше использовали ensureDefaultProject() — он возвращает
   ОБЪЕКТ первого проекта, игнорируя setActiveProjectId. Когда cooling
   работал с pid=p_qarmet через URL, бридж всё равно читал meteo из
   дефолтного проекта (например TBC Bank) → cooling видел старый Берлин,
   хотя в Qarmet уже был импортирован ASHRAE Темиртау.
   Fix: getActiveProjectId() (string id) — уважает setActiveProjectId,
   который cooling.js вызывает при init из ?pid в URL. */
function resolvePid() {
  let id = null;
  try { id = getActiveProjectId(); } catch {}
  if (id) return id;
  // fallback на default
  const dp = ensureDefaultProject();
  return typeof dp === 'string' ? dp : (dp?.id || null);
}

/* v0.60.54 (Phase 34): in-memory кэш IDB-данных. Sync API getActiveMeteoDataset
   читает из кэша; preloadMeteoForPid() заполняет кэш async-ом. cooling.js
   должен await preload перед первым render. */
const _idbCache = new Map();  // pid → datasets[]

/**
 * Async-предзагрузка meteo-датасетов в кэш для последующего sync-чтения.
 * Cooling должен await preloadMeteoForPid(_pid?.id) в init.
 */
export async function preloadMeteoForPid(pid) {
  if (!pid) return;
  if (idbAvailable()) {
    try {
      const data = await idbGet(`meteo.datasets.${pid}`, null);
      if (Array.isArray(data)) {
        _idbCache.set(pid, data);
        return;
      }
    } catch (e) {
      console.warn('[meteo-bridge] idb preload failed:', e);
    }
  }
  // fallback на LS если IDB пусто/недоступно
  const ls = loadJson(pid, KEY_DATA, []) || [];
  _idbCache.set(pid, ls);
}

/**
 * Получить активный датасет из meteo.
 * @param {string|null} [pidOverride] — опц. явно задать pid
 */
export function getActiveMeteoDataset(pidOverride = null) {
  const pid = pidOverride || resolvePid();
  // v0.60.54: сначала смотрим IDB-кэш (если был preload), иначе LS.
  let datasets = _idbCache.get(pid);
  if (!Array.isArray(datasets) || !datasets.length) {
    datasets = loadJson(pid, KEY_DATA, []) || [];
  }
  if (!datasets.length) return null;
  const activeId = loadJson(pid, KEY_ACTIVE, null);
  const dataset =
    datasets.find(d => d.activeForProject) ||
    datasets.find(d => d.id === activeId) ||
    datasets[0];
  if (!dataset) return null;
  return {
    dataset,
    hourly: dataset.hourly || [],
    projectId: pid,
  };
}

/**
 * Получить глобальный фильтр периода из meteo (если задан).
 * @param {string|null} [pidOverride] — опц.
 */
export function getMeteoFilter(pidOverride = null) {
  const pid = pidOverride || resolvePid();
  const f = loadJson(pid, KEY_FILTER, null);
  return f && typeof f === 'object'
    ? { mode: 'all', year: '', periodFrom: '', periodTo: '', ...f }
    : { mode: 'all', year: '', periodFrom: '', periodTo: '' };
}

/**
 * Применить тот же глобальный фильтр периода, что и в meteo.
 * Cooling использует уже отфильтрованные данные — единый источник истины.
 *
 * @param {Array<object>} hourly
 * @param {object} filter
 */
export function applyFilter(hourly, filter) {
  if (!hourly || !filter) return hourly || [];
  if (filter.mode === 'year' && filter.year) {
    const prefix = String(filter.year);
    return hourly.filter(h => (h.t || '').startsWith(prefix));
  }
  if (filter.mode === 'period') {
    const from = filter.periodFrom || '';
    const to = filter.periodTo || '';
    return hourly.filter(h => {
      const t = (h.t || '').slice(0, 10);
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }
  return hourly;
}
