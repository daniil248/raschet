/* =========================================================================
   psychrometrics-chart.js — draw a psychrometric (Mollier-Ramzin / ID)
   chart as SVG and plot process points.

   Axes: x = W (humidity ratio, g/kg_da) [0..30], y = T (°C) [-15..50].
   Curves: constant RH (10..100%), constant h (kJ/kg_da), saturation line.
   ========================================================================= */

import { Pws, humidityRatio, enthalpy, RHfromW, state } from './psychrometrics-core.js';

const DEFAULTS = {
  T_min: -15, T_max: 50,
  W_min: 0,   W_max: 0.030,   // kg/kg_da
  width: 900, height: 600,
  marginL: 50, marginR: 20, marginT: 20, marginB: 50,
  P: 101325,
};

export function render(container, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const plotW = o.width - o.marginL - o.marginR;
  const plotH = o.height - o.marginT - o.marginB;
  const X = w => o.marginL + (w - o.W_min) / (o.W_max - o.W_min) * plotW;
  const Y = T => o.marginT + (o.T_max - T) / (o.T_max - o.T_min) * plotH;

  let svg = `<svg viewBox="0 0 ${o.width} ${o.height}" xmlns="http://www.w3.org/2000/svg"
              style="background:#fff;font-family:Arial,sans-serif;">`;

  // --- Grid: T isotherms (every 5°C) ---
  svg += `<g stroke="#e0e0e0" stroke-width="0.5">`;
  for (let T = Math.ceil(o.T_min / 5) * 5; T <= o.T_max; T += 5) {
    svg += `<line x1="${X(o.W_min)}" y1="${Y(T)}" x2="${X(o.W_max)}" y2="${Y(T)}"/>`;
  }
  // W grid (every 0.002)
  for (let W = 0; W <= o.W_max + 1e-9; W += 0.002) {
    svg += `<line x1="${X(W)}" y1="${Y(o.T_min)}" x2="${X(W)}" y2="${Y(o.T_max)}"/>`;
  }
  svg += `</g>`;

  // --- Saturation curve (RH=100%) ---
  svg += curvePath(o, X, Y, 1.0, '#c62828', 1.6);

  // --- RH isolines 10..90% every 10% ---
  for (let rh = 10; rh < 100; rh += 10) {
    svg += curvePath(o, X, Y, rh / 100, '#9e9e9e', 0.5);
  }

  // --- Constant enthalpy lines (kJ/kg_da) every 10 kJ/kg ---
  // h = 1.006·T + W·(2501 + 1.86·T). Solve for T(W):
  //    T = (h - 2501·W) / (1.006 + 1.86·W)
  svg += `<g stroke="#1976d2" stroke-width="0.4" stroke-dasharray="3,2" opacity="0.7">`;
  for (let h = -20; h <= 120; h += 10) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const W = o.W_min + (o.W_max - o.W_min) * i / 40;
      const T = (h - 2501 * W) / (1.006 + 1.86 * W);
      if (T >= o.T_min && T <= o.T_max) pts.push([X(W), Y(T)]);
    }
    if (pts.length > 1) {
      svg += `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none"/>`;
    }
  }
  svg += `</g>`;

  // --- Axes ---
  svg += `<g stroke="#333" stroke-width="0.8">`;
  svg += `<line x1="${o.marginL}" y1="${Y(o.T_min)}" x2="${o.marginL + plotW}" y2="${Y(o.T_min)}"/>`;
  svg += `<line x1="${o.marginL}" y1="${o.marginT}" x2="${o.marginL}" y2="${Y(o.T_min)}"/>`;
  svg += `</g>`;

  // T labels (left)
  for (let T = Math.ceil(o.T_min / 5) * 5; T <= o.T_max; T += 5) {
    svg += `<text x="${o.marginL - 6}" y="${Y(T) + 3}" text-anchor="end"
             style="font-size:10px;fill:#333;">${T}</text>`;
  }
  // W labels (bottom) in g/kg
  for (let W = 0; W <= o.W_max + 1e-9; W += 0.005) {
    svg += `<text x="${X(W)}" y="${Y(o.T_min) + 14}" text-anchor="middle"
             style="font-size:10px;fill:#333;">${(W * 1000).toFixed(0)}</text>`;
  }

  // Axis titles
  svg += `<text x="${o.marginL + plotW / 2}" y="${o.height - 10}" text-anchor="middle"
           style="font-size:11px;fill:#555;font-weight:600;">
           d (W), г влаги / кг сух. воздуха</text>`;
  svg += `<text x="12" y="${o.marginT + plotH / 2}" text-anchor="middle"
           transform="rotate(-90 12 ${o.marginT + plotH / 2})"
           style="font-size:11px;fill:#555;font-weight:600;">t, °C</text>`;

  // RH annotations along saturation curve top area
  for (const rh of [20, 40, 60, 80, 100]) {
    // find point at some T for label
    const T = 30;
    const Pws_T = Pws(T);
    const Pw = rh / 100 * Pws_T;
    const W = 0.621945 * Pw / (o.P - Pw);
    if (W >= o.W_min && W <= o.W_max) {
      svg += `<text x="${X(W) + 3}" y="${Y(T)}" style="font-size:9px;fill:#666;">
              φ=${rh}%</text>`;
    }
  }

  return { svg, X, Y, opts: o };
}

function curvePath(o, X, Y, rh, color, width) {
  const pts = [];
  for (let T = o.T_min; T <= o.T_max; T += 0.5) {
    const W = humidityRatio(T, rh, o.P);
    if (W > o.W_max) break;
    pts.push([X(W), Y(T)]);
  }
  if (!pts.length) return '';
  return `<polyline points="${pts.map(p=>p.join(',')).join(' ')}"
          fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

/* --- Plot a process point or trajectory --- */
export function plotPoint(ctx, st, label, color = '#0d47a1') {
  const { X, Y } = ctx;
  const x = X(st.W), y = Y(st.T);
  let s = `<g>`;
  s += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#fff" stroke-width="1.2"/>`;
  if (label) {
    s += `<text x="${x + 7}" y="${y - 7}"
            style="font-size:11px;fill:${color};font-weight:700;">${label}</text>`;
    s += `<text x="${x + 7}" y="${y + 5}"
            style="font-size:9px;fill:#555;">
            t=${st.T}°C, φ=${st.RH}%, d=${(st.W*1000).toFixed(1)} г/кг, h=${st.h} кДж/кг</text>`;
  }
  s += `</g>`;
  return s;
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
