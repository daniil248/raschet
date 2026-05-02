// =============================================================================
// shared/meteo-fetch.js — авто-загрузка meteo-датасета по координатам проекта
// =============================================================================
// Phase 21.3 (extracted): Из tech-workspace вынесено как переиспользуемый
// helper для cooling и других модулей. Один клик → 1 год почасовых данных
// через Open-Meteo Historical Weather API → сохранение как ⭐активного для
// проекта датасета.
//
// API:
//   await fetchAndSaveMeteoForProject(pid, { lat, lon, locationName, name? })
//   → сохраняет dataset в LS под projectKey(pid, 'meteo', 'datasets.v1'),
//     помечает как ⭐активный, возвращает {ok, dataset, error?}
//
// Pure JS (использует fetch). Без UI-зависимостей.

import { projectKey } from './project-storage.js';

/**
 * @param {string|null} pid
 * @param {object} loc — { lat, lon, locationName, name? }
 * @returns {Promise<{ok: boolean, dataset?: object, error?: string}>}
 */
export async function fetchAndSaveMeteoForProject(pid, loc) {
  if (!pid) return { ok: false, error: 'pid обязателен (нет проекта — данные не сохранятся в namespace)' };
  if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lon)) {
    return { ok: false, error: 'Не заданы координаты lat/lon' };
  }
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${yearAgo}&end_date=${today}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=auto`;
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Open-Meteo вернул ${res.status}: ${res.statusText}` };
    json = await res.json();
  } catch (e) {
    return { ok: false, error: `Сетевая ошибка: ${e.message || e}` };
  }
  const times = json.hourly?.time || [];
  if (!times.length) return { ok: false, error: 'Open-Meteo вернул пустой ряд' };
  const T = json.hourly?.temperature_2m || [];
  const RH = json.hourly?.relative_humidity_2m || [];
  const W = json.hourly?.wind_speed_10m || [];
  const WD = json.hourly?.wind_direction_10m || [];
  const hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i], wind: W[i], windDir: WD[i] }));

  // Inline-stats (минимально нужное для cooling/PUE)
  const temps = hourly.map(h => Number(h.T)).filter(Number.isFinite);
  const sorted = [...temps].sort((a, b) => a - b);
  const stats = {
    tmin:  Math.round(sorted[0] * 10) / 10,
    tmax:  Math.round(sorted[sorted.length - 1] * 10) / 10,
    tmean: Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 10) / 10,
    t99:   Math.round(sorted[Math.floor(sorted.length * 0.99)] * 10) / 10,
    freecoolHours: temps.filter(t => t < 14).length,
    n: temps.length,
  };

  const dsId = 'ds-' + Math.random().toString(36).slice(2, 10);
  const locName = loc.locationName || loc.name || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
  const dataset = {
    id: dsId,
    name: loc.name || `${locName} (${yearAgo}…${today})`,
    source: 'open-meteo',
    lat: loc.lat, lon: loc.lon, locationName: locName,
    stationId: loc.stationId || null,
    dateFrom: yearAgo, dateTo: today,
    hourly, stats,
    activeForProject: true,
    createdAt: Date.now(),
  };

  // Сбрасываем active у других + добавляем новый.
  const dsKey = projectKey(pid, 'meteo', 'datasets.v1');
  let existing = [];
  try { existing = JSON.parse(localStorage.getItem(dsKey) || '[]'); } catch {}
  for (const d of existing) d.activeForProject = false;
  existing.unshift(dataset);
  localStorage.setItem(dsKey, JSON.stringify(existing));
  localStorage.setItem(projectKey(pid, 'meteo', 'activeId.v1'), JSON.stringify(dsId));

  return { ok: true, dataset };
}
