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
      const head = pts[0];
      enthalpyLabels.push({ x: head[0], y: head[1], h });
    }
  }
  svg += `</g>`;
  for (const lbl of enthalpyLabels) {
    if (lbl.y < o.marginT + 6) continue;
    svg += `<text x="${lbl.x + 2}" y="${lbl.y - 3}"
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
    // Axis titles
    svg += `<text x="${o.marginL + plotW / 2}" y="${o.height - 8}" text-anchor="middle"
             style="font-size:11px;fill:#555;font-weight:600;">
             t, °C — Dry-Bulb Temperature</text>`;
    const wLblX = o.marginL + plotW + o.marginR - 6;
    const wLblY = o.marginT + plotH / 2;
    svg += `<text x="${wLblX}" y="${wLblY}" text-anchor="middle"
             transform="rotate(90 ${wLblX} ${wLblY})"
             style="font-size:11px;fill:#555;font-weight:600;">
             d (W), г/кг — Humidity Ratio</text>`;
    // RH-аннотации
    for (const rh of [20, 40, 60, 80, 100]) {
      const T = 28;
      const Pws_T = Pws(T);
      const Pw = rh / 100 * Pws_T;
      const W = 0.621945 * Pw / (o.P - Pw);
      if (W >= o.W_min && W <= o.W_max) {
        const [px, py] = pos(W, T);
        svg += `<text x="${px + 3}" y="${py - 2}" style="font-size:9px;fill:#666;font-style:italic;">
                φ=${rh}%</text>`;
      }
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
    svg += `<text x="${o.marginL + plotW / 2}" y="${o.height - 10}" text-anchor="middle"
             style="font-size:11px;fill:#555;font-weight:600;">
             d (W), г влаги / кг сух. воздуха</text>`;
    svg += `<text x="12" y="${o.marginT + plotH / 2}" text-anchor="middle"
             transform="rotate(-90 12 ${o.marginT + plotH / 2})"
             style="font-size:11px;fill:#555;font-weight:600;">t, °C</text>`;
    for (const rh of [20, 40, 60, 80, 100]) {
      const T = 30;
      const Pws_T = Pws(T);
      const Pw = rh / 100 * Pws_T;
      const W = 0.621945 * Pw / (o.P - Pw);
      if (W >= o.W_min && W <= o.W_max) {
        const [px, py] = pos(W, T);
        svg += `<text x="${px + 3}" y="${py}" style="font-size:9px;fill:#666;">
                φ=${rh}%</text>`;
      }
    }
  }

  // Закрывающий тег SVG. Без него svg.replace('</svg>', overlay+'</svg>')
  // в renderChart() не находит цель замены и overlay (точки/процессы/
  // бейджи/crosshair) теряется — браузер сам закрывает svg уже после
  // присвоения в innerHTML, но overlay в строку попасть не успевает.
  svg += `</svg>`;
  return { svg, X, Y, pos, inv, opts: o, style: o.style };
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

/* Легенда точек в правом нижнем углу диаграммы. Возвращает SVG-блок. */
export function plotLegend(opts, sts, pointNames = []) {
  const items = [];
  sts.forEach((st, i) => {
    if (!st) return;
    const name = pointNames[i] ? ` ${pointNames[i].slice(0, 20)}` : '';
    items.push({
      idx: i + 1, name,
      txt: `t=${st.T.toFixed(1)}°C · φ=${st.RH.toFixed(0)}% · d=${(st.W*1000).toFixed(2)} г/кг · h=${st.h.toFixed(2)} кДж/кг`
    });
  });
  if (!items.length) return '';
  const lineH = 14;
  const padX = 8, padY = 6;
  const boxW = 360;
  const boxH = items.length * lineH + padY * 2 + 16; // +16 для заголовка
  const x0 = opts.width - opts.marginR - boxW;
  const y0 = opts.height - opts.marginB - boxH - 4;
  let s = `<g class="psy-legend" pointer-events="none">`;
  s += `<rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" rx="4"
          fill="#fff" stroke="#b0bec5" stroke-width="0.8" opacity="0.96"/>`;
  s += `<text x="${x0 + padX}" y="${y0 + padY + 10}"
          style="font-size:10px;font-weight:700;fill:#37474f;">Параметры точек</text>`;
  items.forEach((it, k) => {
    const y = y0 + padY + 16 + (k + 1) * lineH - 3;
    s += `<text x="${x0 + padX}" y="${y}" style="font-size:10px;fill:#263238;">`
       + `<tspan font-weight="700" fill="#0d47a1">${it.idx}.</tspan>`
       + `<tspan fill="#455a64">${escXml(it.name)}</tspan>`
       + ` <tspan fill="#263238">${it.txt}</tspan>`
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
