// meteo/sources/ashrae.js — v0.59.898
// ASHRAE-стиль: расчётные климатические условия по методике
// ASHRAE Handbook Fundamentals, гл. 14 (Climatic Design Information).
//
// Реальные ASHRAE-таблицы — paywalled (Handbook стоит ~$200). Однако
// сами параметры (heating 99.6%/99% T_db, cooling 0.4%/1%/2% T_db и т.п.)
// — это статистические перцентили почасовых рядов температуры за 10–25
// лет наблюдений. Мы вычисляем эквиваленты из публичных Open-Meteo
// historical данных (1940→present) для выбранной станции.
//
// Формат датасета — тот же что у open-meteo, плюс блок stats.ashraeDesign
// с расчётными значениями.

import { register } from './registry.js';
import { pickStation } from '../station-picker.js';
import { findStation } from '../stations/wmo-list.js';

register({
  id: 'ashrae',
  label: '📐 ASHRAE design conditions',
  description: 'Расчётные климатические параметры по ASHRAE HoF гл. 14: 99.6%/99% T heating, 0.4%/1%/2% T cooling. Берутся 10 лет из Open-Meteo, считаются перцентили.',

  async createDataset(ctx) {
    const { computeStats, modalOpen, toast, escAttr, escHtml } = ctx.util;

    const picked = await pickStation({ title: '📐 ASHRAE: выбор метеостанции' });
    if (!picked) return null;
    if (picked.manual) {
      toast('Для ASHRAE-расчёта нужна привязка к станции (lat/lon из каталога). Используйте поиск.', 'warn');
      return null;
    }

    const lat = picked.lat, lon = picked.lon, locationName = picked.name;
    // Период по умолчанию: 10 лет (как ASHRAE 25-year average, но публичный
    // archive-api иногда лимитирует длинные диапазоны — берём осторожно 10 лет).
    const today = new Date();
    const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    const dateFrom = tenYearsAgo.toISOString().slice(0, 10);
    const dateTo = today.toISOString().slice(0, 10);

    return modalOpen(`<h3>📐 ASHRAE design: ${escHtml(locationName)}</h3>`, `
      <p class="muted" style="font-size:11.5px">Станция: <b>${escHtml(locationName)}</b> ${picked.id ? `(${escHtml(picked.id)})` : ''} · ${lat.toFixed(3)}, ${lon.toFixed(3)}.</p>
      <p class="muted" style="font-size:11.5px">Будет загружено <b>10 лет</b> почасовых данных (≈87 600 точек, 5–10с) и рассчитаны перцентили по методике ASHRAE Handbook of Fundamentals, гл. 14.</p>
      <label>Название датасета:<input type="text" id="ash-name" value="${escAttr('ASHRAE ' + locationName + ' (' + dateFrom.slice(0,4) + '–' + dateTo.slice(0,4) + ')')}"></label>
      <label>Период с:<input type="date" id="ash-from" value="${dateFrom}"></label>
      <label>Период по:<input type="date" id="ash-to" value="${dateTo}"></label>
    `, async () => {
      const name = document.getElementById('ash-name').value.trim() || `ASHRAE ${locationName}`;
      const df = document.getElementById('ash-from').value;
      const dt = document.getElementById('ash-to').value;
      try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${df}&end_date=${dt}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,dew_point_2m&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) { toast(`Open-Meteo ${res.status}: ${res.statusText}`, 'warn'); return null; }
        const json = await res.json();
        const times = json.hourly?.time || [];
        const T = json.hourly?.temperature_2m || [];
        const RH = json.hourly?.relative_humidity_2m || [];
        const W = json.hourly?.wind_speed_10m || [];
        const WD = json.hourly?.wind_direction_10m || [];
        const Td = json.hourly?.dew_point_2m || [];
        const hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i], wind: W[i], windDir: WD[i], dewPoint: Td[i] }));
        if (!hourly.length) { toast('Пустой ряд от Open-Meteo.', 'warn'); return null; }
        try { localStorage.setItem('raschet.meteo.last-loc.v1', JSON.stringify({ lat, lon, name: locationName })); } catch {}
        const stats = computeStats(hourly);
        stats.ashraeDesign = computeAshraeDesign(hourly);
        return {
          name, source: 'ashrae',
          lat, lon, locationName, stationId: picked.id || null,
          dateFrom: df, dateTo: dt,
          hourly, stats,
        };
      } catch (e) {
        toast(`Ошибка: ${e.message || e}`, 'warn');
        return null;
      }
    });
  },
});

// Расчётные перцентили по ASHRAE HoF гл. 14.
// Heating DB 99.6% — 0.4-percentile T (только 35 ч/год холоднее)
// Heating DB 99%   — 1.0-percentile T
// Cooling DB 0.4%  — 99.6-percentile T (35 ч/год теплее)
// Cooling DB 1%    — 99.0-percentile T
// Cooling DB 2%    — 98.0-percentile T
// MCWB / MCDB при cooling-условиях — coincident wet-bulb / dew-point.
function computeAshraeDesign(hourly) {
  const validIdx = hourly
    .map((h, i) => Number.isFinite(Number(h.T)) ? i : -1)
    .filter(i => i >= 0);
  if (!validIdx.length) return null;
  // Сортируем индексы по T для перцентилей
  const sortedByT = [...validIdx].sort((a, b) => hourly[a].T - hourly[b].T);
  const N = sortedByT.length;
  const at = (frac) => hourly[sortedByT[Math.max(0, Math.min(N - 1, Math.floor(N * frac)))]];
  const heating996 = at(0.004);
  const heating990 = at(0.010);
  const cooling004 = at(0.996);
  const cooling010 = at(0.990);
  const cooling020 = at(0.980);
  // Расчёт wet-bulb из T + RH (упрощённая формула Stull 2011)
  const wetBulb = (T, RH) => {
    if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
    const Tw = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659))
            + Math.atan(T + RH)
            - Math.atan(RH - 1.676331)
            + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH)
            - 4.686035;
    return Math.round(Tw * 10) / 10;
  };
  const fmt = (h) => h ? {
    Tdb: Math.round(h.T * 10) / 10,
    MCWB: wetBulb(h.T, h.RH),
    MCDP: Number.isFinite(Number(h.dewPoint)) ? Math.round(h.dewPoint * 10) / 10 : null,
  } : null;
  return {
    nYears: Math.round(N / (24 * 365)),
    heating: {
      pct99_6: fmt(heating996),
      pct99_0: fmt(heating990),
    },
    cooling: {
      pct0_4: fmt(cooling004),
      pct1_0: fmt(cooling010),
      pct2_0: fmt(cooling020),
    },
  };
}
