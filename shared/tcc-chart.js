// ======================================================================
// shared/tcc-chart.js
// Визуализация время-токовых характеристик (TCC) цепочки защиты.
// Рендерит SVG log-log график с множественными кривыми (автоматы,
// предохранители, проводники), чекбоксами toggle для каждой кривой,
// линиями токов КЗ и подсветкой селективности.
//
// Использование:
//   import { mountTccChart } from '../shared/tcc-chart.js';
//   const handle = mountTccChart(containerEl, { items, options });
//   // handle.update({ items, options }) — перерисовать
//   // handle.toggle(itemId, visible)     — скрыть/показать кривую
//
// Где items — массив { id, label, color?, kind, ...params }:
//   kind='breaker':  { In, curve }           — MCB B/C/D/K/Z, MCCB
//   kind='fuse':     { In, fuseType }        — gG/gM/aM
//   kind='cable':    { S_mm2, k, inNominal? } — проводник + его защита
//   kind='line':     { I_A, style: 'v' }     — вертикальная линия (I_k)
//
// Оси: X — ток (А) log-log, Y — время (с) log-log.
// ======================================================================

import { tccBreakerTime, tccFuseTime, tccCableThermalLimit } from './tcc-curves.js';

const DEFAULT_COLORS = [
  '#1976d2', '#d32f2f', '#388e3c', '#f57c00', '#7b1fa2',
  '#00796b', '#5d4037', '#455a64', '#c2185b', '#512da8',
];

/**
 * Смонтировать TCC-график в container.
 * container: HTMLElement (например, div)
 * opts: {
 *   items: [...],
 *   xRange: [xmin, xmax],    // ток А, по умолчанию [1, 100000]
 *   yRange: [ymin, ymax],    // время с, по умолчанию [0.001, 10000]
 *   width, height,           // размер SVG (auto-fit)
 *   showControls: true,      // чекбоксы toggle
 *   ikMax, ikMin,            // вертикальные линии Ik_max/Ik_min
 * }
 * Возвращает handle с методами { update, toggle, getItems, destroy }.
 */
export function mountTccChart(container, opts = {}) {
  const state = {
    items: (opts.items || []).map((it, i) => ({
      visible: true,
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      ...it,
    })),
    xRange: opts.xRange || [1, 100000],
    yRange: opts.yRange || [0.001, 10000],
    width: opts.width || 700,
    height: opts.height || 500,
    showControls: opts.showControls !== false,
    ikMax: opts.ikMax,
    ikMin: opts.ikMin,
  };

  container.classList.add('tcc-chart-container');
  render(container, state);

  return {
    update(patch) {
      Object.assign(state, patch);
      if (patch.items) {
        state.items = patch.items.map((it, i) => ({
          visible: it.visible !== false,
          color: it.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          ...it,
        }));
      }
      render(container, state);
    },
    toggle(itemId, visible) {
      const it = state.items.find(i => i.id === itemId);
      if (!it) return;
      it.visible = (visible == null) ? !it.visible : !!visible;
      render(container, state);
    },
    getItems() { return state.items.slice(); },
    destroy() { container.innerHTML = ''; container.classList.remove('tcc-chart-container'); },
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function render(container, state) {
  const { width: W, height: H, xRange, yRange, items, showControls, ikMax, ikMin } = state;
  const padL = 55, padR = 15, padT = 20, padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const lxMin = Math.log10(xRange[0]), lxMax = Math.log10(xRange[1]);
  const lyMin = Math.log10(yRange[0]), lyMax = Math.log10(yRange[1]);
  const toX = v => padL + ((Math.log10(v) - lxMin) / (lxMax - lxMin)) * plotW;
  const toY = v => padT + plotH - ((Math.log10(v) - lyMin) / (lyMax - lyMin)) * plotH;

  // ——— Сетка ———
  const gridX = [];
  for (let lx = Math.ceil(lxMin); lx <= Math.floor(lxMax); lx++) {
    const x = Math.pow(10, lx);
    gridX.push(`<line x1="${toX(x)}" y1="${padT}" x2="${toX(x)}" y2="${padT + plotH}" stroke="#e1e4e8" stroke-width="0.5"/>`);
    const lbl = x >= 1000 ? (x / 1000) + 'к' : x;
    gridX.push(`<text x="${toX(x)}" y="${H - padB + 15}" font-size="10" fill="#888" text-anchor="middle">${lbl}</text>`);
    // Minor (2..9)
    for (let m = 2; m < 10; m++) {
      const xm = x * m;
      if (Math.log10(xm) < lxMax) {
        gridX.push(`<line x1="${toX(xm)}" y1="${padT}" x2="${toX(xm)}" y2="${padT + plotH}" stroke="#f0f2f5" stroke-width="0.3"/>`);
      }
    }
  }
  const gridY = [];
  for (let ly = Math.ceil(lyMin); ly <= Math.floor(lyMax); ly++) {
    const y = Math.pow(10, ly);
    gridY.push(`<line x1="${padL}" y1="${toY(y)}" x2="${padL + plotW}" y2="${toY(y)}" stroke="#e1e4e8" stroke-width="0.5"/>`);
    const lbl = y >= 1 ? y + 'с' : (y >= 0.01 ? y + 'с' : y);
    gridY.push(`<text x="${padL - 6}" y="${toY(y) + 3}" font-size="10" fill="#888" text-anchor="end">${lbl}</text>`);
    for (let m = 2; m < 10; m++) {
      const ym = y * m;
      if (Math.log10(ym) < lyMax) {
        gridY.push(`<line x1="${padL}" y1="${toY(ym)}" x2="${padL + plotW}" y2="${toY(ym)}" stroke="#f0f2f5" stroke-width="0.3"/>`);
      }
    }
  }

  // ——— Кривые ———
  const paths = [];
  const legendItems = [];
  for (const it of items) {
    if (!it.visible) continue;
    const points = curvePoints(it, xRange, yRange, toX, toY);
    if (!points.length) continue;
    const d = 'M ' + points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L ');
    const stroke = it.color;
    const dash = it.kind === 'cable' ? ' stroke-dasharray="5,3"' : '';
    paths.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2"${dash} data-id="${esc(it.id)}"/>`);
  }
  for (const it of items) {
    legendItems.push({
      id: it.id,
      label: it.label,
      color: it.color,
      visible: it.visible,
      kind: it.kind,
    });
  }

  // ——— Вертикальные линии I_k ———
  const vLines = [];
  if (ikMax) {
    vLines.push(`<line x1="${toX(ikMax)}" y1="${padT}" x2="${toX(ikMax)}" y2="${padT + plotH}" stroke="#d32f2f" stroke-width="1" stroke-dasharray="3,3"/>`);
    vLines.push(`<text x="${toX(ikMax) + 4}" y="${padT + 12}" font-size="10" fill="#d32f2f">I_k max = ${_fmtA(ikMax)}</text>`);
  }
  if (ikMin) {
    vLines.push(`<line x1="${toX(ikMin)}" y1="${padT}" x2="${toX(ikMin)}" y2="${padT + plotH}" stroke="#f57c00" stroke-width="1" stroke-dasharray="3,3"/>`);
    vLines.push(`<text x="${toX(ikMin) + 4}" y="${padT + 24}" font-size="10" fill="#f57c00">I_k min = ${_fmtA(ikMin)}</text>`);
  }

  // ——— Сборка SVG ———
  const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;font-family:system-ui,sans-serif">
      <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fafbfc" stroke="#d0d7de"/>
      ${gridX.join('')}
      ${gridY.join('')}
      <text x="${padL + plotW / 2}" y="${H - 8}" font-size="11" fill="#555" text-anchor="middle">Ток, А</text>
      <text x="14" y="${padT + plotH / 2}" font-size="11" fill="#555" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Время отключения, с</text>
      ${vLines.join('')}
      ${paths.join('')}
    </svg>
  `;

  // ——— Легенда с чекбоксами ———
  let controls = '';
  if (showControls) {
    const rows = legendItems.map(it => `
      <label class="tcc-legend-row" style="display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;border-radius:3px;margin-bottom:2px">
        <input type="checkbox" data-tcc-toggle="${esc(it.id)}"${it.visible ? ' checked' : ''}>
        <span style="display:inline-block;width:24px;height:3px;background:${it.color};${it.kind === 'cable' ? 'background-image:repeating-linear-gradient(90deg,' + it.color + ' 0 5px,transparent 5px 8px);' : ''}"></span>
        <span style="font-size:12px">${esc(it.label)}</span>
        ${it.kind === 'cable' ? '<span class="muted" style="font-size:10px;color:#999">(проводник)</span>' : ''}
      </label>
    `).join('');
    controls = `<div class="tcc-legend" style="margin-top:8px;padding:8px;background:#fafbfc;border:1px solid #e1e4e8;border-radius:4px">${rows}</div>`;
  }

  container.innerHTML = svg + controls;

  // Wire чекбоксов
  container.querySelectorAll('[data-tcc-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.tccToggle;
      const it = state.items.find(i => i.id === id);
      if (it) { it.visible = cb.checked; render(container, state); }
    });
  });
}

// Точки кривой в координатах SVG
function curvePoints(item, xRange, yRange, toX, toY) {
  const points = [];
  if (item.kind === 'breaker') {
    const In = Number(item.In) || 16;
    const curve = item.curve || 'C';
    // Строим по I/In от 1.01 до 100, но переводим в абсолютный I (А)
    const ratios = logRange(1.05, 100, 100);
    for (const r of ratios) {
      const I = r * In;
      if (I < xRange[0] || I > xRange[1]) continue;
      const { t_sec } = tccBreakerTime(r, curve);
      if (Number.isFinite(t_sec) && t_sec >= yRange[0] && t_sec <= yRange[1]) {
        points.push([toX(I), toY(t_sec)]);
      }
    }
  } else if (item.kind === 'fuse') {
    const In = Number(item.In) || 16;
    const ftype = item.fuseType || 'gG';
    const ratios = logRange(1.3, 50, 100);
    for (const r of ratios) {
      const I = r * In;
      if (I < xRange[0] || I > xRange[1]) continue;
      const t = tccFuseTime(r, ftype);
      if (Number.isFinite(t) && t >= yRange[0] && t <= yRange[1]) {
        points.push([toX(I), toY(t)]);
      }
    }
  } else if (item.kind === 'cable') {
    const S = Number(item.S_mm2) || 2.5;
    const k = Number(item.k) || 115;
    const Is = logRange(xRange[0], xRange[1], 100);
    for (const I of Is) {
      const t = tccCableThermalLimit(I, S, k);
      if (Number.isFinite(t) && t >= yRange[0] && t <= yRange[1]) {
        points.push([toX(I), toY(t)]);
      }
    }
  }
  return points;
}

function logRange(a, b, n) {
  const la = Math.log(a), lb = Math.log(b);
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.exp(la + (lb - la) * i / (n - 1)));
  return out;
}

function _fmtA(I) {
  if (I >= 1000) return (I / 1000).toFixed(I >= 10000 ? 0 : 1) + ' кА';
  return I.toFixed(0) + ' А';
}
