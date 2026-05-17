// meteo/charts.js — v0.59.900
// Графики на Chart.js (CDN из meteo/index.html). До v0.59.899 был ручной
// canvas — качество низкое; пользователь обновил требование.
// Wind rose остался на canvas (Chart.js не имеет хорошей polar area для
// этого формата без плагина), но переписан с лучшими отступами.

import { escHtml } from './util.js';

let _chartRegistry = new Map();   // canvas-id → Chart instance
function destroyExisting(cvs) {
  const existing = _chartRegistry.get(cvs.id);
  if (existing) { try { existing.destroy(); } catch {} _chartRegistry.delete(cvs.id); }
}
function register(cvs, chart) { _chartRegistry.set(cvs.id, chart); }

const CHART = () => (typeof window !== 'undefined' && window.Chart) ? window.Chart : null;

// ─── 1. Гистограмма температуры (интервалы по 1°C) — дни/год
export function drawTempHistogram(cvs, hourly) {
  const Chart = CHART();
  if (!Chart || !cvs) return;
  destroyExisting(cvs);
  const temps = (hourly || []).map(h => Number(h.T)).filter(Number.isFinite);
  if (!temps.length) return;
  const tmin = Math.floor(Math.min(...temps));
  const tmax = Math.ceil(Math.max(...temps));
  const labels = [];
  const counts = [];
  for (let t = tmin; t <= tmax; t++) { labels.push(t); counts.push(0); }
  for (const v of temps) {
    const idx = Math.min(counts.length - 1, Math.max(0, Math.floor(v - tmin)));
    counts[idx]++;
  }
  const periodDays = temps.length / 24;
  const yearScale = periodDays > 0 ? (365.25 / periodDays) : 1;
  const days = counts.map(c => (c / 24) * yearScale);
  // Подкраска FreeCool-зоны: T<14 → зелёная заливка, иначе синий.
  const bgColors = labels.map(t => t < 14 ? 'rgba(22,163,74,0.55)' : 'rgba(59,130,246,0.85)');
  register(cvs, new Chart(cvs, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Дней / год', data: days, backgroundColor: bgColors, borderColor: 'rgba(0,0,0,0.05)', borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `T = ${items[0].label} °C`,
            label: (it) => `${it.parsed.y.toFixed(1)} дней/год · ${(it.parsed.y * 24).toFixed(0)} часов · ${(it.parsed.y / 365.25 * 100).toFixed(2)}% года`,
          },
        },
      },
      scales: {
        x: { title: { display: true, text: 'T наружн., °C' }, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 30 } },
        y: { title: { display: true, text: 'Дней / год' }, beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
      },
    },
  }));
}

// ─── 2. Гистограмма влажности (интервалы 5% RH)
export function drawHumidityHistogram(cvs, hourly) {
  const Chart = CHART();
  if (!Chart || !cvs) return;
  destroyExisting(cvs);
  const rh = (hourly || []).map(h => Number(h.RH)).filter(Number.isFinite);
  if (!rh.length) {
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = '#9ca3af'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Нет данных по влажности в этом датасете', cvs.width / 2, cvs.height / 2);
    return;
  }
  const labels = [];
  const counts = [];
  for (let r = 0; r < 100; r += 5) { labels.push(r + '–' + (r + 4)); counts.push(0); }
  for (const v of rh) {
    const idx = Math.min(counts.length - 1, Math.max(0, Math.floor(v / 5)));
    counts[idx]++;
  }
  const periodDays = rh.length / 24;
  const yearScale = periodDays > 0 ? (365.25 / periodDays) : 1;
  const days = counts.map(c => (c / 24) * yearScale);
  register(cvs, new Chart(cvs, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Дней / год', data: days, backgroundColor: 'rgba(14,165,233,0.85)', borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: (items) => `RH ${items[0].label} %`,
          label: (it) => `${it.parsed.y.toFixed(1)} дней/год`,
        } },
      },
      scales: {
        x: { title: { display: true, text: 'Относительная влажность, %' }, grid: { display: false } },
        y: { title: { display: true, text: 'Дней / год' }, beginAtZero: true },
      },
    },
  }));
}

// ─── 3. Среднемесячная температура с min/max диапазоном
export function drawMonthlyTempChart(cvs, hourly) {
  const Chart = CHART();
  if (!Chart || !cvs) return;
  destroyExisting(cvs);
  const monthly = Array.from({ length: 12 }, () => ({ sum: 0, n: 0, min: Infinity, max: -Infinity }));
  for (const h of (hourly || [])) {
    const T = Number(h.T);
    if (!Number.isFinite(T) || !h.t) continue;
    const m = parseInt(h.t.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) continue;
    monthly[m].sum += T; monthly[m].n++;
    if (T < monthly[m].min) monthly[m].min = T;
    if (T > monthly[m].max) monthly[m].max = T;
  }
  if (monthly.every(m => m.n === 0)) return;
  const labels = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const means = monthly.map(m => m.n > 0 ? m.sum / m.n : null);
  const mins = monthly.map(m => m.n > 0 ? m.min : null);
  const maxs = monthly.map(m => m.n > 0 ? m.max : null);
  register(cvs, new Chart(cvs, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Max', data: maxs, borderColor: 'rgba(220,38,38,0.7)', backgroundColor: 'rgba(220,38,38,0.08)', fill: '+1', tension: 0.3, pointRadius: 2 },
        { label: 'Среднее', data: means, borderColor: 'rgba(30,64,175,1)', backgroundColor: 'rgba(30,64,175,0.15)', tension: 0.3, pointRadius: 4, borderWidth: 2.5, fill: false },
        { label: 'Min', data: mins, borderColor: 'rgba(37,99,235,0.7)', backgroundColor: 'rgba(37,99,235,0.08)', tension: 0.3, pointRadius: 2, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { title: { display: true, text: 'Месяц' }, grid: { display: false } },
        y: { title: { display: true, text: 'Температура, °C' }, grid: { color: 'rgba(0,0,0,0.05)' } },
      },
    },
  }));
}

// ─── 4. Wind rose: круговая на canvas (Chart.js polar area не подходит идеально).
//    Улучшен по сравнению с v0.59.899: подписи направлений на полном круге
//    (С/СВ/В/ЮВ/Ю/ЮЗ/З/СЗ), чёткая шкала колец, легенда силы внизу.
export function drawWindRose(cvs, hourly) {
  if (!cvs) return;
  destroyExisting(cvs);
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 - 10;
  const R = Math.min(W, H - 40) / 2 - 30;
  const SECTORS = 16;
  const sectorDeg = 360 / SECTORS;
  const sectors = Array.from({ length: SECTORS }, () => ({ count: 0, windSum: 0 }));
  let total = 0;
  for (const h of (hourly || [])) {
    const dir = Number(h.windDir);
    const w = Number(h.wind);
    if (!Number.isFinite(dir) || !Number.isFinite(w)) continue;
    const idx = Math.round(((dir % 360) + 360) % 360 / sectorDeg) % SECTORS;
    sectors[idx].count++;
    sectors[idx].windSum += w;
    total++;
  }
  if (!total) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных по направлению ветра', W / 2, H / 2);
    return;
  }
  const colorFor = (avgW) => {
    const t = Math.min(1, avgW / 12);
    return `hsl(${210 - t * 200}, ${60 + t * 30}%, ${65 - t * 25}%)`;
  };
  const maxFrac = Math.max(...sectors.map(s => s.count / total));
  // Reference circles
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Petals
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(30,64,175,0.4)';
  for (let i = 0; i < SECTORS; i++) {
    const s = sectors[i];
    if (s.count === 0) continue;
    const frac = s.count / total;
    const r = (frac / maxFrac) * R;
    const a1 = (i * sectorDeg - 90 - sectorDeg / 2) * Math.PI / 180;
    const a2 = (i * sectorDeg - 90 + sectorDeg / 2) * Math.PI / 180;
    const avgW = s.windSum / s.count;
    ctx.fillStyle = colorFor(avgW);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a1, a2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Cardinal + intercardinal labels
  ctx.fillStyle = '#1f2937';
  ctx.font = '600 12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const dirs = [
    { label: 'С', a: -90 }, { label: 'СВ', a: -45 },
    { label: 'В', a: 0 }, { label: 'ЮВ', a: 45 },
    { label: 'Ю', a: 90 }, { label: 'ЮЗ', a: 135 },
    { label: 'З', a: 180 }, { label: 'СЗ', a: -135 },
  ];
  for (const c of dirs) {
    const a = c.a * Math.PI / 180;
    const x = cx + Math.cos(a) * (R + 16);
    const y = cy + Math.sin(a) * (R + 16);
    ctx.fillText(c.label, x, y);
  }
  // Reference labels (повторяемость)
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const [frac, lab] of [[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']]) {
    ctx.fillText(`${(maxFrac * frac * 100).toFixed(0)}%`, cx + R * frac + 3, cy);
  }
  ctx.textBaseline = 'alphabetic';
  // Title + total + legend
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`${total.toLocaleString('ru-RU')} наблюдений`, 8, 14);
  // Wind speed gradient legend (внизу)
  const lgX = 60, lgY = H - 14, lgW = W - 120;
  for (let i = 0; i < lgW; i++) {
    ctx.fillStyle = colorFor(i / lgW * 12);
    ctx.fillRect(lgX + i, lgY - 6, 1, 8);
  }
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(lgX, lgY - 6, lgW, 8);
  ctx.fillStyle = '#6b7280';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('0 м/с', lgX - 4, lgY);
  ctx.textAlign = 'left';
  ctx.fillText('12+ м/с', lgX + lgW + 4, lgY);
}

// ─── 5. Days-in-range: Year × T-bin → дни.
export function renderDaysInRangeTable(hourly) {
  if (!Array.isArray(hourly) || !hourly.length) return '<div class="muted">Нет данных.</div>';
  const byDayYearT = new Map();
  for (const h of hourly) {
    const T = Number(h.T);
    if (!Number.isFinite(T) || !h.t) continue;
    const year = Number(h.t.slice(0, 4));
    const day = h.t.slice(0, 10);
    const key = year + '|' + day;
    let rec = byDayYearT.get(key);
    if (!rec) { rec = { sum: 0, n: 0, year }; byDayYearT.set(key, rec); }
    rec.sum += T; rec.n++;
  }
  const yearTBin = new Map();
  for (const rec of byDayYearT.values()) {
    if (!rec.n) continue;
    const tAvg = rec.sum / rec.n;
    const bin = Math.floor(tAvg);
    let yMap = yearTBin.get(rec.year);
    if (!yMap) { yMap = new Map(); yearTBin.set(rec.year, yMap); }
    yMap.set(bin, (yMap.get(bin) || 0) + 1);
  }
  if (!yearTBin.size) return '<div class="muted">Нет данных за полный день.</div>';
  const years = [...yearTBin.keys()].sort();
  const allBins = new Set();
  for (const yMap of yearTBin.values()) for (const b of yMap.keys()) allBins.add(b);
  const bins = [...allBins].sort((a, b) => a - b);
  const meanByBin = new Map();
  for (const b of bins) {
    let sum = 0, n = 0;
    for (const y of years) {
      const v = yearTBin.get(y).get(b) || 0;
      sum += v; n++;
    }
    meanByBin.set(b, n > 0 ? sum / n : 0);
  }
  return `<table class="mt-pivot-table">
    <thead><tr>
      <th>T °C</th>
      ${years.map(y => `<th class="num">${y}</th>`).join('')}
      <th class="num"><b>Среднее</b></th>
    </tr></thead>
    <tbody>
      ${bins.map(b => `<tr>
        <td class="num">${b}</td>
        ${years.map(y => {
          const v = yearTBin.get(y).get(b) || 0;
          return `<td class="num">${v > 0 ? v : ''}</td>`;
        }).join('')}
        <td class="num"><b>${meanByBin.get(b).toFixed(1)}</b></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// v0.59.991: drawChillerEnergyChart перенесён в /cooling/ui/energy-chart.js
// (расчёт чиллеров теперь в отдельном модуле).

// ─── 6. CSV helpers — v0.60.523 (Фаза 2 burndown #3): реализация в
// SHARED (shared/meteo-util.js). Re-export сохраняет старый путь
// `./charts.js` для meteo/annual-table.js (zero-build).
export { tableToCsv, downloadCsv } from 'shared/meteo-util.js';
