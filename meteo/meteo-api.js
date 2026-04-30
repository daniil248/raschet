// meteo-api.js — v0.59.894 (Etap C)
// Public API для других модулей: чтение активного метео-датасета проекта.
// Возвращает только базовые stats + ссылку на raw-hourly при необходимости.
// Не импортирует тяжёлый UI из meteo.js.

import { projectKey } from '../shared/project-storage.js';

export function getActiveDataset(pid) {
  if (!pid) return null;
  try {
    const all = JSON.parse(localStorage.getItem(projectKey(pid, 'meteo', 'datasets.v1')) || '[]');
    return all.find(d => d.activeForProject) || all[0] || null;
  } catch { return null; }
}

export function listDatasets(pid) {
  if (!pid) return [];
  try {
    return JSON.parse(localStorage.getItem(projectKey(pid, 'meteo', 'datasets.v1')) || '[]');
  } catch { return []; }
}

// Краткая сводка (без hourly[]) — для KPI на чужих экранах.
export function getActiveSummary(pid) {
  const d = getActiveDataset(pid);
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    locationName: d.locationName || '',
    lat: d.lat, lon: d.lon,
    dateFrom: d.dateFrom, dateTo: d.dateTo,
    stats: d.stats || null,
    source: d.source,
  };
}
