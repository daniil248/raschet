// meteo/charts.js — v0.59.898
// Графики и визуализация для модуля Метеоданные. Все рисуются на canvas
// без внешних зависимостей.

import { escHtml } from './util.js';

// ─── 1. Гистограмма температуры (бины по 1°C) — часы → дни/год
export function drawTempHistogram(cvs, hourly, opts = {}) {
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const temps = (hourly || []).map(h => Number(h.T)).filter(Number.isFinite);
  if (!temps.length) return;
  const tmin = Math.floor(Math.min(...temps));
  const tmax = Math.ceil(Math.max(...temps));
  const bins = [];
  for (let t = tmin; t <= tmax; t++) bins.push({ t, count: 0 });
  for (const v of temps) {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor(v - tmin)));
    bins[idx].count++;
  }
  // Hours → days/year (нормировка к 365 дней)
  const periodDays = temps.length / 24;
  const yearScale = periodDays > 0 ? (365.25 / periodDays) : 1;
  const binsDays = bins.map(b => ({ t: b.t, days: (b.count / 24) * yearScale }));
  const maxDays = Math.max(...binsDays.map(b => b.days));
  const padL = 50, padR = 10, padT = 22, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / bins.length;
  // FreeCool zone (T<14)
  const fc14idx = bins.findIndex(b => b.t > 14);
  if (fc14idx > 0) {
    ctx.fillStyle = 'rgba(22, 163, 74, 0.08)';
    ctx.fillRect(padL, padT, fc14idx * bw, plotH);
  }
  ctx.fillStyle = '#3b82f6';
  binsDays.forEach((b, i) => {
    const x = padL + i * bw;
    const h = maxDays > 0 ? (b.days / maxDays) * plotH : 0;
    ctx.fillRect(x + 1, padT + plotH - h, Math.max(1, bw - 2), h);
  });
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('дней / год', 4, padT + 10);
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'right';
  ctx.fillText(maxDays.toFixed(0), padL - 4, padT + 10);
  ctx.fillText('0', padL - 4, padT + plotH);
  ctx.textAlign = 'center';
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].t % 5 === 0) {
      const x = padL + i * bw + bw / 2;
      ctx.fillText(bins[i].t + '°', x, H - 6);
    }
  }
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH); ctx.lineTo(W - padR, padT + plotH);
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
  ctx.stroke();
}

// ─── 2. Гистограмма влажности (RH в %, бины по 5%)
export function drawHumidityHistogram(cvs, hourly) {
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const rh = (hourly || []).map(h => Number(h.RH)).filter(Number.isFinite);
  if (!rh.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных по влажности в этом датасете', W / 2, H / 2);
    return;
  }
  const bins = [];
  for (let r = 0; r < 100; r += 5) bins.push({ r, count: 0 });
  for (const v of rh) {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor(v / 5)));
    bins[idx].count++;
  }
  const periodDays = rh.length / 24;
  const yearScale = periodDays > 0 ? (365.25 / periodDays) : 1;
  const binsDays = bins.map(b => ({ r: b.r, days: (b.count / 24) * yearScale }));
  const maxDays = Math.max(...binsDays.map(b => b.days));
  const padL = 50, padR = 10, padT = 22, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / bins.length;
  ctx.fillStyle = '#0ea5e9';
  binsDays.forEach((b, i) => {
    const x = padL + i * bw;
    const h = maxDays > 0 ? (b.days / maxDays) * plotH : 0;
    ctx.fillRect(x + 1, padT + plotH - h, Math.max(1, bw - 2), h);
  });
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('дней / год', 4, padT + 10);
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'right';
  ctx.fillText(maxDays.toFixed(0), padL - 4, padT + 10);
  ctx.fillText('0', padL - 4, padT + plotH);
  ctx.textAlign = 'center';
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].r % 10 === 0) {
      const x = padL + i * bw + bw / 2;
      ctx.fillText(bins[i].r + '%', x, H - 6);
    }
  }
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH); ctx.lineTo(W - padR, padT + plotH);
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
  ctx.stroke();
}

// ─── 3. Линия среднемесячной температуры с min/max envelope
export function drawMonthlyTempChart(cvs, hourly) {
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const monthly = Array.from({ length: 12 }, () => ({ sum: 0, n: 0, min: Infinity, max: -Infinity }));
  for (const h of (hourly || [])) {
    const T = Number(h.T);
    if (!Number.isFinite(T) || !h.t) continue;
    const m = parseInt(h.t.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) continue;
    monthly[m].sum += T;
    monthly[m].n++;
    if (T < monthly[m].min) monthly[m].min = T;
    if (T > monthly[m].max) monthly[m].max = T;
  }
  if (monthly.every(m => m.n === 0)) return;
  const valid = monthly.map(m => m.n > 0 ? { mean: m.sum / m.n, min: m.min, max: m.max } : null);
  const allTemps = valid.filter(Boolean).flatMap(v => [v.min, v.max, v.mean]);
  const yMin = Math.floor(Math.min(...allTemps) - 2);
  const yMax = Math.ceil(Math.max(...allTemps) + 2);
  const padL = 50, padR = 10, padT = 22, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const dx = plotW / 11;  // 12 точек, 11 интервалов
  const yToPx = (y) => padT + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  // Envelope (min..max area)
  ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    if (!valid[i]) continue;
    const x = padL + i * dx;
    if (i === 0 || !valid[i - 1]) ctx.moveTo(x, yToPx(valid[i].max));
    else ctx.lineTo(x, yToPx(valid[i].max));
  }
  for (let i = 11; i >= 0; i--) {
    if (!valid[i]) continue;
    const x = padL + i * dx;
    ctx.lineTo(x, yToPx(valid[i].min));
  }
  ctx.closePath(); ctx.fill();
  // Mean line
  ctx.strokeStyle = '#1e40af'; ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < 12; i++) {
    if (!valid[i]) { started = false; continue; }
    const x = padL + i * dx, y = yToPx(valid[i].mean);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Mean dots
  ctx.fillStyle = '#1e40af';
  for (let i = 0; i < 12; i++) {
    if (!valid[i]) continue;
    const x = padL + i * dx, y = yToPx(valid[i].mean);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Y axis
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('°C', 4, padT + 10);
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'right';
  ctx.fillText(yMax + '°', padL - 4, padT + 10);
  ctx.fillText(yMin + '°', padL - 4, padT + plotH);
  // 0°C grid line if visible
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, yToPx(0)); ctx.lineTo(W - padR, yToPx(0));
    ctx.stroke();
    ctx.fillText('0°', padL - 4, yToPx(0) + 4);
  }
  // X axis (months)
  const months = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д'];
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  for (let i = 0; i < 12; i++) {
    const x = padL + i * dx;
    ctx.fillText(months[i], x, H - 6);
  }
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH); ctx.lineTo(W - padR, padT + plotH);
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
  ctx.stroke();
}

// ─── 4. Days-in-range matrix: год × T-bin → кол-во дней с T в этом бине.
//    Возвращает HTML-таблицу (matrix Year × Tbin).
export function renderDaysInRangeTable(hourly, opts = {}) {
  if (!Array.isArray(hourly) || !hourly.length) return '<div class="muted">Нет данных.</div>';
  // Собираем матрицу year → Map<TbinFloor, dayCountSet>.
  // День считается «в бине T_bin», если средняя дневная T в этом бине.
  const byDayYearT = new Map();  // key: `${year}|${YYYY-MM-DD}` → { sum, n, year }
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
  // Bin per day
  const yearTBin = new Map();  // year → Map<Tbin, dayCount>
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
  // Все T-бины, объединение
  const allBins = new Set();
  for (const yMap of yearTBin.values()) for (const b of yMap.keys()) allBins.add(b);
  const bins = [...allBins].sort((a, b) => a - b);
  // Среднее по годам для каждого бина
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

// ─── 5. Wind rose: круговая диаграмма распределения ветра по 16 румбам.
//    Каждая «лепесток» — один из 16 секторов (по 22.5°) с длиной = доля
//    часов с этим направлением. Цвет — средняя сила ветра в секторе.
export function drawWindRose(cvs, hourly) {
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 30;
  const SECTORS = 16;          // 22.5° each
  const sectorDeg = 360 / SECTORS;
  // Aggregate
  const sectors = Array.from({ length: SECTORS }, () => ({ count: 0, windSum: 0 }));
  let total = 0;
  for (const h of (hourly || [])) {
    const dir = Number(h.windDir);
    const w = Number(h.wind);
    if (!Number.isFinite(dir) || !Number.isFinite(w)) continue;
    // Откуда дует: 0° = N, 90° = E, 180° = S, 270° = W. Открытое сектор — от dir.
    const idx = Math.round(((dir % 360) + 360) % 360 / sectorDeg) % SECTORS;
    sectors[idx].count++;
    sectors[idx].windSum += w;
    total++;
  }
  if (!total) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Нет данных по направлению ветра', cx, cy);
    return;
  }
  // Цветовая шкала по средней силе (до 10 m/s = насыщенный)
  const colorFor = (avgW) => {
    const t = Math.min(1, avgW / 10);
    const r = Math.round(180 - t * 40);
    const g = Math.round(220 - t * 100);
    const b = Math.round(240 - t * 40);
    return `rgb(${r},${g},${b})`;
  };
  const maxFrac = Math.max(...sectors.map(s => s.count / total));
  // Draw sector petals
  for (let i = 0; i < SECTORS; i++) {
    const s = sectors[i];
    if (s.count === 0) continue;
    const frac = s.count / total;
    const r = (frac / maxFrac) * R;
    const a1 = (i * sectorDeg - 90 - sectorDeg / 2) * Math.PI / 180;
    const a2 = (i * sectorDeg - 90 + sectorDeg / 2) * Math.PI / 180;
    const avgW = s.windSum / s.count;
    ctx.fillStyle = colorFor(avgW);
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a1, a2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Reference circles (25%, 50%, 75% of maxFrac)
  ctx.strokeStyle = '#cbd5e1';
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  for (const [frac, label] of [[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(label, cx + R * frac + 2, cy);
  }
  // Cardinal labels
  ctx.fillStyle = '#1f2937';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const card = [
    { label: 'С', a: -90 }, { label: 'В', a: 0 }, { label: 'Ю', a: 90 }, { label: 'З', a: 180 },
  ];
  for (const c of card) {
    const a = c.a * Math.PI / 180;
    const x = cx + Math.cos(a) * (R + 18);
    const y = cy + Math.sin(a) * (R + 18);
    ctx.fillText(c.label, x, y);
  }
  ctx.textBaseline = 'alphabetic';
  // Title
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`${total.toLocaleString('ru-RU')} часов`, 8, 14);
  ctx.textAlign = 'right';
  ctx.fillText('цвет = средняя сила ветра', W - 8, 14);
}

// ─── 6. Helper для генерации CSV из произвольной 2D-таблицы (rows × cells)
export function tableToCsv(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(';')).join('\r\n');
}

export function downloadCsv(csv, filename) {
  // BOM для корректного открытия в Excel с кириллицей
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'meteo-export.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
