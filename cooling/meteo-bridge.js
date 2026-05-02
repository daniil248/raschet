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

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';

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

/**
 * Получить активный датасет из meteo.
 *
 * @returns {{dataset, hourly, projectId}|null} { dataset, hourly,
 *          projectId } или null если нет датасетов.
 */
export function getActiveMeteoDataset() {
  const pid = ensureDefaultProject();
  const datasets = loadJson(pid, KEY_DATA, []) || [];
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
 * @returns {{mode, year, periodFrom, periodTo}}
 */
export function getMeteoFilter() {
  const pid = ensureDefaultProject();
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
