/* =========================================================================
   psychrometrics-chart.js — draw a psychrometric chart.

   Two layouts (option `style`):
   • 'ramzin'  — Mollier-Ramzin (Russian): W horizontal (bottom), T vertical
                 (left). Default.
   • 'ashrae'  — ASHRAE textbook style: T horizontal (bottom), W vertical
                 (right axis). Same data, transposed coordinate system.

   Returns ctx с pos(W,T) → [x,y] и inv(x,y) → {W, T} — потребитель
   (renderChart, plotPoint, attachCrosshair) использует только эти
   функции и не зависит от конкретной системы координат.
   ========================================================================= */

import { Pws, humidityRatio, enthalpy, RHfromW, state } from './psychrometrics-core.js';

const DEFAULTS = {
  T_min: -15, T_max: 50,
  W_min: 0,   W_max: 0.030,   // kg/kg_da
  width: 900, height: 600,
  marginL: 50, marginR: 20, marginT: 20, marginB: 50,
  P: 101325,
  style: 'ramzin',  // 'ramzin' | 'ashrae'
};

export function render(container, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const isAshrae = o.style === 'ashrae';
  if (isAshrae) {
    // У ASHRAE-style ось W справа — нужен запас под подписи
    o.marginR = Math.max(o.marginR, 60);
  }
  const plotW = o.width - o.marginL - o.marginR;
  const plotH = o.height - o.marginT - o.marginB;
  // Унифицированная (W, T) → (x, y) трансляция. X/Y оставлены для
  // обратной совместимости в Ramzin-режиме (старые callers).
  let X, Y, pos, inv;
  if (isAshrae) {
    X = T => o.marginL + (T - o.T_min) / (o.T_max - o.T_min) * plotW;
    Y = W => o.marginT + (o.W_max - W) / (o.W_max - o.W_min) * plotH;
    pos = (W, T) => [X(T), Y(W)];
    inv = (x, y) => ({
      T: o.T_min + (x - o.marginL) / plotW * (o.T_max - o.T_min),
      W: o.W_max - (y - o.marginT) / plotH * (o.W_max - o.W_min),
    });
  } else {
    X = W => o.marginL + (W - o.W_min) / (o.W_max - o.W_min) * plotW;
    Y = T => o.marginT + (o.T_max - T) / (o.T_max - o.T_min) * plotH;
    pos = (W, T) => [X(W), Y(T)];
    inv = (x, y) => ({
      W: o.W_min + (x - o.marginL) / plotW * (o.W_max - o.W_min),
      T: o.T_max - (y - o.marginT) / plotH * (o.T_max - o.T_min),
    });
  }

  let svg = `<svg viewBox="0 0 ${o.width} ${o.height}" xmlns="http://www.w3.org/2000/svg"
              style="background:#fff;font-family:Arial,sans-serif;">`;

  // --- Grid: T isotherms (every 5°C) — используем pos для обоих layouts.
  svg += `<g stroke="#e0e0e0" stroke-width="0.5">`;
  for (let T = Math.ceil(o.T_min / 5) * 5; T <= o.T_max; T += 5) {
    const [x1, y1] = pos(o.W_min, T);
    const [x2, y2] = pos(o.W_max, T);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  // W grid (every 0.002)
  for (let W = 0; W <= o.W_max + 1e-9; W += 0.002) {
    const [x1, y1] = pos(W, o.T_min);
    const [x2, y2] = pos(W, o.T_max);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  svg += `</g>`;

  // --- Saturation curve (RH=100%) ---
  svg += curvePath(o, pos, 1.0, '#c62828', 1.6);
  for (let rh = 10; rh < 100; rh += 10) {
    svg += curvePath(o, pos, rh / 100, '#9e9e9e', 0.5);
  }

  // --- Constant enthalpy lines (kJ/kg_da) every 10 kJ/kg ---
  svg += `<g stroke="#1976d2" stroke-width="0.4" stroke-dasharray="3,2" opacity="0.7">`;
  const enthalpyLabels = [];
  for (let h = -20; h <= 120; h += 10) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const W = o.W_min + (o.W_max - o.W_min) * i / 40;
      const T = (h - 2501 * W) / (1.006 + 1.86 * W);
      if (T >= o.T_min && T <= o.T_max) {
        const [px, py] = pos(W, T);
        pts.push([px, py]);
      }
    }
    if (pts.length > 1) {
      svg += `<polyline points="${pts.map(p=>p[0]+','+p[1]).join(' ')}" fill="none"/>`;
      enthalpyLabels.push({ pts, h });
    }
  }
  svg += `</g>`;
  // v0.59.945: Метки h выровнены по ОДНОЙ прямой:
  //   ramzin — все на y = marginT - 4 (горизонтальная линия над плот-областью).
  //     Считаем W где iso-h пересекает T=T_max: W = (h - 1.006·Tmax)/(2501+1.86·Tmax).
  //     Если W вне [W_min, W_max] — линия не достигает верхнего края, label-имеет
  //     fallback к pts[0] (как раньше).
  //   ashrae — все на x = marginL - 4 (вертикальная справа от левой грани).
  //     Считаем W где iso-h пересекает T=T_min: W = (h - 1.006·Tmin)/(2501+1.86·Tmin).
  for (const lbl of enthalpyLabels) {
    let labelX, labelY, anchor;
    if (isAshrae) {
      // Метка слева от плот-области, на y где iso-h пересекает T=T_min
      const W_at_Tmin = (lbl.h - 1.006 * o.T_min) / (2501 + 1.86 * o.T_min);
      if (W_at_Tmin >= o.W_min && W_at_Tmin <= o.W_max) {
        const [, py] = pos(W_at_Tmin, o.T_min);
        labelX = o.marginL - 4;
        labelY = py + 3;
        anchor = 'end';
      } else {
        // fallback — последняя точка (pts[конец])
        const head = lbl.pts[lbl.pts.length - 1];
        labelX = head[0] - 4;
        labelY = head[1] - 3;
        anchor = 'end';
      }
    } else {
      // ramzin — метка над плот-областью, на x где iso-h пересекает T=T_max
      const W_at_Tmax = (lbl.h - 1.006 * o.T_max) / (2501 + 1.86 * o.T_max);
      if (W_at_Tmax >= o.W_min && W_at_Tmax <= o.W_max) {
        const [px] = pos(W_at_Tmax, o.T_max);
        labelX = px + 2;
        labelY = o.marginT - 3;
        anchor = 'start';
      } else {
        // fallback — первая точка
        const head = lbl.pts[0];
        labelX = head[0] + 2;
        labelY = head[1] - 3;
        anchor = 'start';
      }
    }
    svg += `<text x="${labelX}" y="${labelY}" text-anchor="${anchor}"
             style="font-size:9px;fill:#1565c0;font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:2.5px;">
             h=${lbl.h}</text>`;
  }

  // --- Axes (плот-рамка) ---
  svg += `<g stroke="#333" stroke-width="0.8" fill="none">`;
  svg += `<rect x="${o.marginL}" y="${o.marginT}" width="${plotW}" height="${plotH}"/>`;
  svg += `</g>`;

  if (isAshrae) {
    // T-метки снизу
    for (let T = Math.ceil(o.T_min / 5) * 5; T <= o.T_max; T += 5) {
      const [px] = pos(o.W_min, T);
      svg += `<text x="${px}" y="${o.marginT + plotH + 14}" text-anchor="middle"
               style="font-size:10px;fill:#333;">${T}</text>`;
    }
    // W-метки справа (г/кг)
    for (let W = 0; W <= o.W_max + 1e-9; W += 0.005) {
      const [, py] = pos(W, o.T_min);
      svg += `<text x="${o.marginL + plotW + 6}" y="${py + 3}" text-anchor="start"
               style="font-size:10px;fill:#333;">${(W * 1000).toFixed(0)}</text>`;
    }
    // Axis titles + давление (v0.59.945)
    const Pkpa = (o.P / 1000).toFixed(2);
    svg += `<text x="${o.marginL + plotW / 2}" y="${o.height - 8}" text-anchor="middle"
             style="font-size:11px;fill:#555;font-weight:600;">
             t, °C — Dry-Bulb Temperature  ·  P = ${Pkpa} кПа</text>`;
    const wLblX = o.marginL + plotW + o.marginR - 6;
    const wLblY = o.marginT + plotH / 2;
    svg += `<text x="${wLblX}" y="${wLblY}" text-anchor="middle"
             transform="rotate(90 ${wLblX} ${wLblY})"
             style="font-size:11px;fill:#555;font-weight:600;">
             d (W), г/кг — Humidity Ratio</text>`;
    // v0.59.964: RH-метки RotatedAlongCurve как в reference ASHRAE.
    svg += rhLabelsAlongCurves(o, pos, true /* isAshrae */);
    // v0.59.943: Wet-Bulb метки на кривой насыщения. На saturation curve
    // T_db = T_wb, поэтому каждая точка кривой при integer T = метка
    // wet-bulb. Раскрашиваем красным (как в reference ASHRAE Foundamentals
    // Fig.2 — Wet Bulb / Saturation Temperature на левой оси).
    for (let T = 0; T <= 30; T += 5) {
      if (T < o.T_min || T > o.T_max) continue;
      const W = humidityRatio(T, 1.0, o.P);
      if (W > o.W_max) continue;
      const [px, py] = pos(W, T);
      svg += `<text x="${px - 4}" y="${py - 3}" text-anchor="end"
               style="font-size:9px;fill:#c62828;font-weight:600;
               paint-order:stroke;stroke:#fff;stroke-width:2px;">${T}</text>`;
    }
    // Подпись «Wet Bulb / Saturation» вдоль кривой насыщения (диагональ).
    // Размещаем у Twb=15°C, ориентированную вдоль кривой ≈45°.
    const twbLbl_W = humidityRatio(15, 1.0, o.P);
    if (twbLbl_W >= o.W_min && twbLbl_W <= o.W_max) {
      const [lx, ly] = pos(twbLbl_W, 15);
      svg += `<text x="${lx - 14}" y="${ly + 22}" text-anchor="middle"
               transform="rotate(-45 ${lx - 14} ${ly + 22})"
               style="font-size:9px;fill:#c62828;font-style:italic;
               paint-order:stroke;stroke:#fff;stroke-width:2px;">
               Wet Bulb / Saturation Temp, °C</text>`;
    }
  } else {
    // RAMZIN: T-метки слева, W-метки снизу
    for (let T = Math.ceil(o.T_min / 5) * 5; T <= o.T_max; T += 5) {
      const [, py] = pos(o.W_min, T);
      svg += `<text x="${o.marginL - 6}" y="${py + 3}" text-anchor="end"
               style="font-size:10px;fill:#333;">${T}</text>`;
    }
    for (let W = 0; W <= o.W_max + 1e-9; W += 0.005) {
      const [px] = pos(W, o.T_min);
      svg += `<text x="${px}" y="${o.marginT + plotH + 14}" text-anchor="middle"
               style="font-size:10px;fill:#333;">${(W * 1000).toFixed(0)}</text>`;
    }
    // v0.59.945: давление в подписи нижней оси
    const Pkpa = (o.P / 1000).toFixed(2);
    svg += `<text x="${o.marginL + plotW / 2}" y="${o.height - 10}" text-anchor="middle"
             style="font-size:11px;fill:#555;font-weight:600;">
             d (W), г влаги / кг сух. воздуха  ·  P = ${Pkpa} кПа</text>`;
    svg += `<text x="12" y="${o.marginT + plotH / 2}" text-anchor="middle"
             transform="rotate(-90 12 ${o.marginT + plotH / 2})"
             style="font-size:11px;fill:#555;font-weight:600;">t, °C</text>`;
    // v0.59.964: RH-метки rotated along curves.
    svg += rhLabelsAlongCurves(o, pos, false /* ramzin */);
  }

  // Закрывающий тег SVG. Без него svg.replace('</svg>', overlay+'</svg>')
  // в renderChart() не находит цель замены и overlay (точки/процессы/
  // бейджи/crosshair) теряется — браузер сам закрывает svg уже после
  // присвоения в innerHTML, но overlay в строку попасть не успевает.
  svg += `</svg>`;
  return { svg, X, Y, pos, inv, opts: o, style: o.style };
}

/* v0.59.964: метки RH=const, ориентированные ВДОЛЬ кривой (как в
   reference ASHRAE Foundamentals Fig.2 + ГОСТ-Mollier). По репорту:
   «и подписи влажности сделай как на скринах для режимов».
   Каждой метке — позиция на кривой при выбранном T_lab + tangent
   angle от ближайших точек. */
/* v0.59.972: helper — проверка, существует ли RH-кривая в плот-области.
   Если для всех T ∈ [T_min, T_max] значение W ≤ W_min (или ≥ W_max уже на
   T_min — кривая стартует выше потолка) → линии в плоте нет → метку не
   выводим. По репорту: «если линии нет, не выводи значение». */
function rhCurveExistsInPlot(o, phi) {
  // Проверяем хотя бы одну точку внутри: W в [W_min, W_max] для какого-то T
  for (let T = o.T_min; T <= o.T_max; T += 1) {
    const W = humidityRatio(T, phi, o.P);
    if (Number.isFinite(W) && W >= o.W_min && W <= o.W_max) return true;
  }
  return false;
}

function rhLabelsAlongCurves(o, pos, isAshrae) {
  // v0.59.971: метки RH размещаются НА ВНУТРЕННЕЙ СТОРОНЕ РАМКИ —
  // там где RH-кривая выходит из плот-области (через верх — W=W_max,
  // или через правый край — T=T_max). По репорту: «значение влажности
  // размести по краю рамки, с внутренней стороны».
  // Алгоритм: сканируем T от Tmin до Tmax шагом 0.5°C. Если W при текущем
  // φ превышает W_max → линейная интерполяция назад до точного W_max
  // (выход через верх). Иначе — метка у T=Tmax (выход через правый край).
  const RHs = [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90];
  let s = '';
  for (const rh of RHs) {
    const phi = rh / 100;
    // v0.59.972: если линии нет в плот-области — пропускаем метку.
    if (!rhCurveExistsInPlot(o, phi)) continue;
    const dT = 0.5;
    let T_exit = null;
    for (let T = o.T_min; T <= o.T_max; T += dT) {
      const W = humidityRatio(T, phi, o.P);
      if (W > o.W_max) {
        const T_prev = T - dT;
        const W_prev = humidityRatio(T_prev, phi, o.P);
        const t = (o.W_max - W_prev) / (W - W_prev);
        T_exit = T_prev + t * dT;
        break;
      }
    }
    let T_lab, W_lab, edge;
    if (T_exit != null) {
      T_lab = T_exit;
      W_lab = o.W_max * 0.97;  // ~3% inside top-edge
      edge = 'top';
    } else {
      T_lab = o.T_max - 0.5;
      W_lab = humidityRatio(T_lab, phi, o.P);
      edge = 'right';
      if (!Number.isFinite(W_lab) || W_lab < o.W_min) continue;
    }
    // Tangent для угла поворота
    const T1 = Math.max(o.T_min, T_lab - dT);
    const T2 = Math.min(o.T_max, T_lab + dT);
    const W1 = humidityRatio(T1, phi, o.P);
    const W2 = humidityRatio(T2, phi, o.P);
    const [px1, py1] = pos(W1, T1);
    const [px2, py2] = pos(W2, T2);
    const angle = Math.atan2(py2 - py1, px2 - px1) * 180 / Math.PI;
    const [px, py] = pos(W_lab, T_lab);
    // Inset «внутрь» от рамки в плот-область (12px вглубь)
    const inset = edge === 'top'
      ? (isAshrae ? { dx: 0, dy: 14 } : { dx: 0, dy: 14 })
      : (isAshrae ? { dx: -22, dy: 4 } : { dx: -22, dy: 4 });
    s += `<text x="${px + inset.dx}" y="${py + inset.dy}" text-anchor="middle"
             transform="rotate(${angle.toFixed(1)} ${px + inset.dx} ${py + inset.dy})"
             style="font-size:9px;fill:#444;font-weight:600;
             paint-order:stroke;stroke:#fff;stroke-width:2.5px;">${rh}%</text>`;
  }
  // 100% (saturation) — у её правого-верхнего выхода из плот-области
  const dT = 0.5;
  let T_sat = null;
  for (let T = o.T_min; T <= o.T_max; T += dT) {
    const W = humidityRatio(T, 1.0, o.P);
    if (W > o.W_max) {
      const T_prev = T - dT;
      const W_prev = humidityRatio(T_prev, 1.0, o.P);
      const t = (o.W_max - W_prev) / (W - W_prev);
      T_sat = T_prev + t * dT;
      break;
    }
  }
  const W_sat100 = T_sat != null ? o.W_max * 0.95 : Math.min(humidityRatio(o.T_max - 1, 1.0, o.P), o.W_max);
  const T_sat_lab = T_sat != null ? T_sat : o.T_max - 1;
  if (W_sat100 >= o.W_min) {
    const W1 = humidityRatio(T_sat_lab - dT, 1.0, o.P);
    const W2 = humidityRatio(T_sat_lab + dT, 1.0, o.P);
    const [px1, py1] = pos(W1, T_sat_lab - dT);
    const [px2, py2] = pos(W2, T_sat_lab + dT);
    const angle = Math.atan2(py2 - py1, px2 - px1) * 180 / Math.PI;
    const [px, py] = pos(W_sat100, T_sat_lab);
    s += `<text x="${px - 16}" y="${py + 14}" text-anchor="middle"
             transform="rotate(${angle.toFixed(1)} ${px - 16} ${py + 14})"
             style="font-size:10px;fill:#c62828;font-weight:700;
             paint-order:stroke;stroke:#fff;stroke-width:2.5px;">100%</text>`;
  }
  return s;
}

function curvePath(o, pos, rh, color, width) {
  const pts = [];
  for (let T = o.T_min; T <= o.T_max; T += 0.5) {
    const W = humidityRatio(T, rh, o.P);
    if (W > o.W_max) break;
    pts.push(pos(W, T));
  }
  if (!pts.length) return '';
  return `<polyline points="${pts.map(p=>p.join(',')).join(' ')}"
          fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

/* --- Plot a process point or trajectory --- */
export function plotPoint(ctx, st, label, color = '#0d47a1') {
  const [x, y] = ctx.pos ? ctx.pos(st.W, st.T) : [ctx.X(st.W), ctx.Y(st.T)];
  let s = `<g>`;
  s += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#fff" stroke-width="1.2"/>`;
  if (label) {
    // Только компактный номер возле кружка. Подробные параметры (t/φ/d/h)
    // выводятся отдельной легендой в правом нижнем углу диаграммы —
    // см. renderChart() в psychrometrics.js.
    s += `<text x="${x + 7}" y="${y - 5}"
            style="font-size:12px;fill:${color};font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px;">${label}</text>`;
  }
  s += `</g>`;
  return s;
}

/* Легенда точек в углу диаграммы. v0.59.948: компактный 2-строчный формат
   на точку (имя сверху, параметры — снизу, мелким шрифтом). По репорту:
   «тексты вылазиют за границы, нам же потом это еще и печатать, сделай
   аккуратно». */
export function plotLegend(opts, sts, pointNames = []) {
  const items = [];
  sts.forEach((st, i) => {
    if (!st) return;
    const rawName = pointNames[i] || '';
    const name = rawName.length > 28 ? rawName.slice(0, 27) + '…' : rawName;
    items.push({
      idx: i + 1, name,
      txt: `t=${st.T.toFixed(1)}° · φ=${st.RH.toFixed(0)}% · d=${(st.W*1000).toFixed(2)} г/кг · h=${st.h.toFixed(1)} кДж/кг`
    });
  });
  if (!items.length) return '';
  // 2-строчный формат: header + (name + values) per item
  // v0.59.948: учитываем что normalizeChartFontSizes (post-render) увеличивает
  // SVG-шрифты до visual-size ~14px (matching body), поэтому design-size
  // расстояния больше реального.
  const headerH = 18;
  const lineGap = 14;          // расстояние между строками в одной item
  const itemH = lineGap * 2 + 4; // 2 строки + промежуток между items
  const padX = 8, padY = 6;
  const boxW = 360;
  const boxH = items.length * itemH + padY * 2 + headerH;
  const isAshrae = opts.style === 'ashrae';
  const x0 = isAshrae
    ? opts.marginL + 4
    : opts.width - opts.marginR - boxW;
  const y0 = isAshrae
    ? opts.marginT + 4
    : opts.height - opts.marginB - boxH - 4;
  let s = `<g class="psy-legend" pointer-events="none">`;
  s += `<rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" rx="4"
          fill="#fff" stroke="#b0bec5" stroke-width="0.8" opacity="0.96"/>`;
  s += `<text x="${x0 + padX}" y="${y0 + padY + 11}"
          style="font-size:10px;font-weight:700;fill:#37474f;">Параметры точек</text>`;
  // 2 строки на точку: 1-я — № и имя жирным, 2-я — параметры мельче.
  // y baseline для каждой строки = y0 + padY + headerH + k*itemH + offset.
  items.forEach((it, k) => {
    const blockTop = y0 + padY + headerH + k * itemH;
    const yName = blockTop + lineGap;
    const yVals = blockTop + lineGap * 2;
    s += `<text x="${x0 + padX}" y="${yName}" style="font-size:10px;fill:#263238;">`
       + `<tspan font-weight="700" fill="#0d47a1">${it.idx}.</tspan> `
       + `<tspan font-weight="600" fill="#37474f">${escXml(it.name)}</tspan>`
       + `</text>`;
    s += `<text x="${x0 + padX + 12}" y="${yVals}" style="font-size:9px;fill:#455a64;">`
       + escXml(it.txt)
       + `</text>`;
  });
  s += `</g>`;
  return s;
}

function escXml(s) {
  return String(s).replace(/[<>&"']/g, c =>
    ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
}

export function plotProcess(ctx, points, color = '#0d47a1') {
  const { X, Y } = ctx;
  const coords = points.map(st => `${X(st.W)},${Y(st.T)}`).join(' ');
  return `<polyline points="${coords}" fill="none" stroke="${color}"
           stroke-width="2" marker-end="url(#arrow)"/>`;
}

export function arrowDefs() {
  const colors = {
    arrow:       '#0d47a1',
    'arrow-P':   '#e65100',
    'arrow-C':   '#0277bd',
    'arrow-A':   '#2e7d32',
    'arrow-S':   '#6a1b9a',
    'arrow-M':   '#00838f',
    'arrow-R':   '#ad1457',
    'arrow-X':   '#424242',
  };
  const markers = Object.entries(colors).map(([id, col]) => `
    <marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${col}"/>
    </marker>`).join('');
  return `<defs>${markers}</defs>`;
}
