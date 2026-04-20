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

import {
  tccBreakerTime,
  tccFuseTime,
  tccCableThermalLimit,
  tccBreakerBandPoints,
  tccFuseBandPoints,
  tccRelayBandPoints,
} from './tcc-curves.js';

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
  // Для автоматов и предохранителей рендерим полосу (верхняя/нижняя граница
  // по IEC 60898 / IEC 60269) + центральную линию. Для кабеля — пунктир.
  const paths = [];
  const legendItems = [];
  for (const it of items) {
    if (!it.visible) continue;
    const band = bandPoints(it);
    if (band && band.length >= 2) {
      // Верхняя граница (t_hi) — движемся вправо, нижняя (t_lo) — влево.
      const up = band
        .filter(p => p.I >= xRange[0] && p.I <= xRange[1] && p.t_hi >= yRange[0] && p.t_hi <= yRange[1])
        .map(p => `${toX(p.I).toFixed(1)},${toY(p.t_hi).toFixed(1)}`);
      const lo = band
        .filter(p => p.I >= xRange[0] && p.I <= xRange[1] && p.t_lo >= yRange[0] && p.t_lo <= yRange[1])
        .slice().reverse()
        .map(p => `${toX(p.I).toFixed(1)},${toY(p.t_lo).toFixed(1)}`);
      if (up.length >= 2 && lo.length >= 2) {
        const fill = _hexAlpha(it.color, 0.22);
        paths.push(`<polygon points="${up.concat(lo).join(' ')}" fill="${fill}" stroke="${it.color}" stroke-width="1.2" data-id="${esc(it.id)}"/>`);
      }
    } else {
      // Fallback — старая однолинейная кривая (кабель, I_k-линии).
      const points = curvePoints(it, xRange, yRange, toX, toY);
      if (!points.length) continue;
      const d = 'M ' + points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L ');
      const dash = it.kind === 'cable' ? ' stroke-dasharray="5,3"' : '';
      paths.push(`<path d="${d}" fill="none" stroke="${it.color}" stroke-width="2"${dash} data-id="${esc(it.id)}"/>`);
    }
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
  // Фаза 1.19.11: crosshair-слой для hover-readout (I, t). Прозрачный
  // overlay поверх plot-area ловит mousemove и рисует пунктирные
  // направляющие + tooltip с расшифровкой координат.
  const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
         style="max-width:100%;font-family:system-ui,sans-serif" class="tcc-svg">
      <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fafbfc" stroke="#d0d7de"/>
      ${gridX.join('')}
      ${gridY.join('')}
      <text x="${padL + plotW / 2}" y="${H - 8}" font-size="11" fill="#555" text-anchor="middle">Ток, А</text>
      <text x="14" y="${padT + plotH / 2}" font-size="11" fill="#555" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Время отключения, с</text>
      ${vLines.join('')}
      ${paths.join('')}
      <g class="tcc-crosshair" pointer-events="none" style="display:none">
        <line class="tcc-cross-v" y1="${padT}" y2="${padT + plotH}" stroke="#1976d2" stroke-width="1" stroke-dasharray="3,3"/>
        <line class="tcc-cross-h" x1="${padL}" x2="${padL + plotW}" stroke="#1976d2" stroke-width="1" stroke-dasharray="3,3"/>
        <rect class="tcc-cross-bg" fill="#1976d2" rx="3"/>
        <text class="tcc-cross-lbl" font-size="11" font-family="monospace" fill="#fff" text-anchor="start"></text>
      </g>
      <rect class="tcc-hover-target" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}"
            fill="transparent" style="cursor:crosshair"/>
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

  // Hover-crosshair: при движении мыши над plot-area показываем
  // вертикаль/горизонталь и значение (I, t) с учётом log-log.
  const svgEl = container.querySelector('svg.tcc-svg');
  const hoverTgt = svgEl?.querySelector('.tcc-hover-target');
  const cross = svgEl?.querySelector('.tcc-crosshair');
  if (hoverTgt && cross) {
    const vLine = cross.querySelector('.tcc-cross-v');
    const hLine = cross.querySelector('.tcc-cross-h');
    const bg    = cross.querySelector('.tcc-cross-bg');
    const lbl   = cross.querySelector('.tcc-cross-lbl');
    hoverTgt.addEventListener('mousemove', (ev) => {
      const r = svgEl.getBoundingClientRect();
      const sx = W / r.width, sy = H / r.height;
      const x = (ev.clientX - r.left) * sx;
      const y = (ev.clientY - r.top) * sy;
      if (x < padL || x > padL + plotW || y < padT || y > padT + plotH) {
        cross.style.display = 'none'; return;
      }
      const lgI = lxMin + ((x - padL) / plotW) * (lxMax - lxMin);
      const lgT = lyMin + ((padT + plotH - y) / plotH) * (lyMax - lyMin);
      const I = Math.pow(10, lgI);
      const t = Math.pow(10, lgT);
      vLine.setAttribute('x1', x.toFixed(1));
      vLine.setAttribute('x2', x.toFixed(1));
      hLine.setAttribute('y1', y.toFixed(1));
      hLine.setAttribute('y2', y.toFixed(1));
      const text = `I = ${_fmtA(I)}  ·  t = ${_fmtT(t)}`;
      lbl.textContent = text;
      // Позиция tooltip — у правого-верхнего угла курсора, но не вне plot-area
      const tx = Math.min(x + 8, padL + plotW - 6 - text.length * 7);
      const ty = Math.max(y - 8, padT + 14);
      lbl.setAttribute('x', tx);
      lbl.setAttribute('y', ty);
      const pad = 4;
      bg.setAttribute('x', (tx - pad).toFixed(1));
      bg.setAttribute('y', (ty - 11).toFixed(1));
      bg.setAttribute('width', (text.length * 7 + pad * 2).toFixed(1));
      bg.setAttribute('height', '16');
      cross.style.display = '';
    });
    hoverTgt.addEventListener('mouseleave', () => { cross.style.display = 'none'; });
  }
}

function _fmtT(t) {
  if (t >= 3600) return (t / 3600).toFixed(1) + ' ч';
  if (t >= 60) return (t / 60).toFixed(1) + ' мин';
  if (t >= 1) return t.toFixed(2) + ' с';
  if (t >= 0.001) return (t * 1000).toFixed(0) + ' мс';
  return t.toExponential(1) + ' с';
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

/**
 * Возвращает массив {I, t_lo, t_hi} для item.
 * Для breaker / fuse — используем band-функции из tcc-curves.js.
 * Для cable / line — возвращаем null (рисуем однолинейно).
 */
function bandPoints(item) {
  // Phase 1.19.15: если у item есть relay-settings (Ir/Isd/tsd/Ii) —
  // рисуем по реальным уставкам (definite-time overcurrent по IEC 60255).
  // Это используется для MV-ячеек с VCB/SF6 и для промышленных MCCB/ACB.
  if (item.settings && Number(item.settings.Ir) > 0) {
    return tccRelayBandPoints(item.settings, 80);
  }
  if (item.kind === 'breaker') {
    const In = Number(item.In) || 16;
    const curve = item.curve || 'C';
    return tccBreakerBandPoints(In, curve, 80);
  }
  if (item.kind === 'fuse') {
    const In = Number(item.In) || 16;
    return tccFuseBandPoints(In, item.fuseType || 'gG', 80);
  }
  return null;
}

/** Перевод #rrggbb → rgba с заданной альфой. */
function _hexAlpha(hex, a) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return `rgba(120,120,120,${a})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Открывает TCC-график в отдельном модальном окне с увеличенным размером,
 * карточками автоматов (Ir/Isd ползунки) и легендой. Возвращает handle
 * со стандартными методами { update, toggle, getItems, close }.
 *
 * Использование:
 *   openTccModal({ items, ikMax, ikMin, title })
 */
export function openTccModal(opts = {}) {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.25);width:min(1400px,95vw);height:min(900px,92vh);display:flex;flex-direction:column;overflow:hidden';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e1e4e8;flex-shrink:0';
  header.innerHTML = `
    <h3 style="margin:0;font-size:14px;font-weight:600;flex:1">${esc(opts.title || 'Карта защиты линии — TCC')}</h3>
    <button type="button" data-tcc-modal-close style="border:1px solid #ccc;background:#f6f8fa;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:13px">Закрыть ✕</button>
  `;
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:minmax(240px,280px) 1fr;gap:12px';
  const cardsCol = document.createElement('div');
  cardsCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow:auto';
  const chartCol = document.createElement('div');
  chartCol.style.cssText = 'display:flex;flex-direction:column;min-width:0';
  body.appendChild(cardsCol);
  body.appendChild(chartCol);
  modal.appendChild(header);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const handle = mountTccChart(chartCol, {
    items: opts.items || [],
    ikMax: opts.ikMax,
    ikMin: opts.ikMin,
    width: 900,
    height: 640,
    showControls: true,
  });

  // Карточки автоматов с ползунками Ir/Isd/tsd (для регулируемых MCCB/ACB/VCB).
  // Для регулируемых автоматов (item.settings с Ir>0) — редактируем
  // item.settings.{Ir,Isd,tsd,Ii}, потому что bandPoints() читает эти поля.
  // Для фиксированных MCB B/C/D — Isd фиксирован стандартом (IEC 60898), ползунки
  // не показываем.
  const renderCards = () => {
    const items = handle.getItems();
    cardsCol.innerHTML = items.map((it, idx) => {
      const col = it.color;
      const In = Number(it.In) || 0;
      const curve = it.curve || it.fuseType || '';
      const hasRelaySettings = !!(it.settings && Number(it.settings.Ir) > 0);
      const Ir  = hasRelaySettings ? Number(it.settings.Ir)  : (Number(it.Ir)  || In);
      const Isd = hasRelaySettings
        ? Number(it.settings.Isd)
        : (Number(it.Isd) || (In * (curve === 'D' ? 15 : (curve === 'B' ? 4 : 7.5))));
      const tsd = hasRelaySettings ? Number(it.settings.tsd) || 0.2 : 0;
      const Ii  = hasRelaySettings ? Number(it.settings.Ii)  || (Ir * 20) : 0;
      // Ползунки доступны только для регулируемых автоматов (relay settings).
      const adjustable = hasRelaySettings;
      return `
        <div data-tcc-card="${esc(it.id)}" style="border:1px solid #d0d7de;border-radius:6px;overflow:hidden;background:#fff">
          <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:${col};color:#fff;font-size:12px;font-weight:600">
            <input type="checkbox" data-tcc-toggle="${esc(it.id)}"${it.visible ? ' checked' : ''} style="margin:0">
            <span style="flex:1">${esc(it.label)}</span>
            <span style="font-size:11px;opacity:0.9">${In ? In + ' A' : ''} ${curve ? curve : ''}</span>
          </div>
          ${adjustable ? `
          <div style="padding:8px 10px;font-size:11px;display:flex;flex-direction:column;gap:6px">
            <label style="display:flex;align-items:center;gap:6px">
              <span style="width:44px;color:#555">Ir, A</span>
              <input type="range" min="${Math.max(1, In * 0.4)}" max="${In}" step="1" value="${Ir}" data-tcc-param="Ir" data-tcc-target="${esc(it.id)}" style="flex:1">
              <input type="number" value="${Ir}" data-tcc-param-num="Ir" data-tcc-target="${esc(it.id)}" style="width:60px;font-size:11px;padding:2px">
            </label>
            <label style="display:flex;align-items:center;gap:6px">
              <span style="width:44px;color:#555">Isd, A</span>
              <input type="range" min="${Ir * 1.5}" max="${Ir * 20}" step="1" value="${Isd}" data-tcc-param="Isd" data-tcc-target="${esc(it.id)}" style="flex:1">
              <input type="number" value="${Isd}" data-tcc-param-num="Isd" data-tcc-target="${esc(it.id)}" style="width:60px;font-size:11px;padding:2px">
            </label>
            <label style="display:flex;align-items:center;gap:6px">
              <span style="width:44px;color:#555">tsd, с</span>
              <input type="range" min="0" max="1" step="0.01" value="${tsd}" data-tcc-param="tsd" data-tcc-target="${esc(it.id)}" style="flex:1">
              <input type="number" value="${tsd}" step="0.01" min="0" max="1" data-tcc-param-num="tsd" data-tcc-target="${esc(it.id)}" style="width:60px;font-size:11px;padding:2px">
            </label>
            <label style="display:flex;align-items:center;gap:6px">
              <span style="width:44px;color:#555">Ii, A</span>
              <input type="range" min="${Ir * 2}" max="${Ir * 40}" step="10" value="${Ii}" data-tcc-param="Ii" data-tcc-target="${esc(it.id)}" style="flex:1">
              <input type="number" value="${Ii}" data-tcc-param-num="Ii" data-tcc-target="${esc(it.id)}" style="width:60px;font-size:11px;padding:2px">
            </label>
          </div>
          ` : (it.kind === 'breaker' ? `<div style="padding:6px 10px;font-size:10.5px;color:#888">Кривая ${esc(curve || 'C')} (IEC 60898) — Isd и задержка фиксированы стандартом.</div>` : '')}
        </div>
      `;
    }).join('');

    cardsCol.querySelectorAll('[data-tcc-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        handle.toggle(cb.dataset.tccToggle, cb.checked);
      });
    });
    cardsCol.querySelectorAll('[data-tcc-param],[data-tcc-param-num]').forEach(inp => {
      inp.addEventListener('input', () => {
        const id = inp.dataset.tccTarget;
        const p = inp.dataset.tccParam || inp.dataset.tccParamNum;
        const items = handle.getItems();
        const it = items.find(x => x.id === id);
        if (!it) return;
        const v = Number(inp.value);
        // Для регулируемых автоматов пишем в settings — bandPoints() читает
        // оттуда, иначе изменения не влияют на кривую.
        if (it.settings && Number(it.settings.Ir) > 0) {
          it.settings = { ...it.settings, [p]: v };
          // При изменении Ir — масштабируем Ii и отображаемый In
          if (p === 'Ir') it.In = v;
        } else {
          it[p] = v;
          if (p === 'Ir') it.In = v;
        }
        handle.update({ items });
        // Синхронизация зеркальных input'ов
        cardsCol.querySelectorAll(`[data-tcc-target="${id}"][data-tcc-param="${p}"],[data-tcc-target="${id}"][data-tcc-param-num="${p}"]`)
          .forEach(o => { if (o !== inp) o.value = inp.value; });
      });
    });
  };
  renderCards();

  const close = () => {
    try { handle.destroy(); } catch {}
    document.body.removeChild(backdrop);
  };
  header.querySelector('[data-tcc-modal-close]').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  return { ...handle, close, refreshCards: renderCards };
}
