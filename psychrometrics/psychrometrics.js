/* psychrometrics.js — UI wiring: cycle-of-points editor + Mollier chart.
   Модель:
     cycle.points[i] = { name, t, rh, x? (override d г/кг), V? (V м³/ч на сегмент)}
     cycle.procs[i]  = { type }  — процесс i→(i+1), где type ∈
        'none' | 'P' (нагрев, d=const) | 'C' (охлаждение/осушение)
        | 'A' (адиабат. увлажнение, h=const) | 'S' (паровое увл., t=const)
        | 'X' (свободный, без ограничений) — просто соединить точки
*/
import {
  state, RHfromW, humidityRatio, Pws, enthalpy, TfromHW,
  pressureAtAltitude, processPowerKW, processMoistureKgH,
  RHO_NORMAL, dewPointFromW,
} from './psychrometrics-core.js';
import { render, plotPoint, plotProcess, arrowDefs, plotLegend } from './psychrometrics-chart.js';

const $  = (id) => document.getElementById(id);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* --- Состояние --- */
const S = {
  alt: 0,             // м
  P: 101325,          // Па
  rhMax: 100,         // %
  tEvap: 15,          // °C
  vBase: 10000,       // м³/ч
  tMinChart: -15,     // °C — нижняя граница оси t на диаграмме
  tMaxChart: 50,      // °C — верхняя граница оси t
  dMaxChart: 30,      // г/кг — правая граница оси d
  showRuNames: (() => { try { return localStorage.getItem('psy.showRuNames') === '1'; } catch { return false; } })(),
  // v0.59.90: формат листа + ориентация. Раньше был только флаг chartRotate,
  // который через CSS `transform: rotate(-90deg)` крутил весь SVG — это ломало
  // hover/click-mapping и давало «неправильно развёрнутый лист». Теперь
  // ориентация меняет именно размеры полотна (и, соответственно, аспект),
  // а формат — реальные габариты A4/A3 (в мм × px/mm).
  chartFormat: (() => { try { return localStorage.getItem('psy.chartFormat') || 'A4'; } catch { return 'A4'; } })(),
  chartOrient: (() => { try { return localStorage.getItem('psy.chartOrient') || 'landscape'; } catch { return 'landscape'; } })(),
  edgeView: (() => { try { return localStorage.getItem('psy.edgeView') || 'cards'; } catch { return 'cards'; } })(),
  // v0.59.946: comfortZoneId инициализируется из LS на старте, чтобы первый
  // рендер диаграммы (в wire() до handler-а czSel) не падал на default
  // 'tc99-rec', когда пользователь сохранил 'tc99-all' / 'ashrae55' / etc.
  // Раньше: select_value='tc99-all' но S.comfortZoneId на первом рендере
  // был undefined → falls back to 'tc99-rec' → видна только Recommended.
  comfortZoneId: (() => { try { const v = localStorage.getItem('psy.comfortZoneId'); return v != null ? v : 'tc99-rec'; } catch { return 'tc99-rec'; } })(),
  // v0.59.935: Точка 1 — всегда вход с улицы (наружный воздух).
  // По репорту: «пусть точка один будет всегда входная из улицы». Имя
  // сделано generic-ом, чтобы подходило и для зимы, и для лета — конкретный
  // режим подставляется через «📍 Из meteo» (обновляет именно первую точку).
  points: [
    { name: 'Наружный воздух (улица)', nameUser: true, t: -20, tUser: true, tTs: 1, rh: 85, rhUser: true, rhTs: 1, x: '', h: '', V: '' },
    { name: 'После калорифера', t: '', rh: '', x: '', h: '', V: '' },
    { name: 'После увлажн.',    t: '', rh: '', x: '', h: '', V: '' },
  ],
  procs: [
    { type: 'P', Q: '', qw: '', fromIdx: 0, toIdx: 1 },  // 1→2 нагрев
    { type: 'A', Q: '', qw: '', fromIdx: 1, toIdx: 2 },  // 2→3 адиабат. увл.
  ],
  /* Зоны (помещения): прямоугольники-подложки под узлы. Не участвуют в
     расчёте, только визуал и подготовка к интеграции с конструктором схем,
     где зоны = помещения/контейнеры. { id, name, cx, cy, w, h, color } */
  zones: [],
};
let _zoneSeq = 1;

const PROC_TYPES = [
  { v: 'none', t: '— (разрыв)'                            },
  { v: 'P',    t: 'P · нагрев (d=const)'                  },
  { v: 'C',    t: 'C · охлаждение / осушение'             },
  { v: 'A',    t: 'A · адиабат. увл. (h=const)'           },
  { v: 'S',    t: 'S · паровое увл. (t=const)'            },
  { v: 'M',    t: 'M · смешение с точкой'                 },
  { v: 'R',    t: 'R · рекуператор (теплообмен с точкой)'  },
  { v: 'X',    t: 'X · произвольный'                      },
];

const PROC_COLOR = {
  none: '#b0bec5', P: '#e65100', C: '#0277bd', A: '#2e7d32', S: '#6a1b9a', M: '#00838f', R: '#ad1457', X: '#424242',
};

/* Авто-имя исходящей точки из типа предыдущего процесса */
const PROC_NAME_OUT = {
  P: 'После нагревателя',
  C: 'После охл./осуш.',
  A: 'После адиабат. увл.',
  S: 'После пар. увл.',
  M: 'После смешения',
  R: 'После рекуператора',
  X: 'Смешение/переход',
  none: '',
};

/* Цели процесса: любую ОДНУ величину можно задать — точка 2 рассчитается */
const PROC_TARGETS = [
  { v: '',     t: '— (ввод точки)',  u: '' },
  { v: 't2',   t: 't₂',               u: '°C' },
  { v: 'dt',   t: 'Δt',               u: '°C' },
  { v: 'phi2', t: 'φ₂',               u: '%' },
  { v: 'd2',   t: 'd₂',               u: 'г/кг' },
  { v: 'dd',   t: 'Δd',               u: 'г/кг' },
  { v: 'h2',   t: 'h₂',               u: 'кДж/кг' },
  { v: 'dh',   t: 'Δh',               u: 'кДж/кг' },
  { v: 'Q',    t: 'Q (мощн.)',        u: 'кВт' },
  { v: 'qw',   t: 'qw (влагопр.)',    u: 'кг/ч' },
];

/* Обратная Hyland-Wexler: по Pws → t (Ньютон по ln) */
function invertPws(pwsTarget) {
  let t = 20;
  for (let i = 0; i < 60; i++) {
    const f = Math.log(Pws(t)) - Math.log(Math.max(1e-3, pwsTarget));
    const df = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
    const s = f / df; t -= s;
    if (Math.abs(s) < 1e-4) break;
  }
  return t;
}

/* ========================================================================
   Утилиты
   ======================================================================== */
/* Безопасный парсер числа.
   КРИТИЧНО: Number('') === 0 (а не NaN), что ломало pointState:
   пустое поле d трактовалось как «d=0» и обнуляло W. */
function nNum(v, d=NaN) {
  if (v == null) return d;
  const s = String(v).trim();
  if (s === '') return d;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Расчёт state для точки. Допустимые комбинации:
     (t, φ)   — стандарт
     (t, d)   — через override d (г/кг)
     (t, h)   — из энтальпии находим W
   Возвращает state или null, если данных недостаточно. */
/* v0.59.958: pointState — единый расчётный движок для точек/процессов
   (psychrometrics-core.js — те же humidityRatio/enthalpy/Pws/state, что
   использует и калькулятор на вкладке «Калькуляторы и формулы»).
   По репорту: «для вычисления полей в точках и процессах должен
   использоваться тот же калькулятор который доступен пользователю на
   вкладке. Значения не должны отличаться».
   Любое значение, выведенное в карточке точки или процессе, и значение,
   вычисленное калькулятором с теми же входными — БИТ-в-БИТ совпадают
   (и round-trip через humidityRatio/RHfromW тоже точный). */
function pointState(p, P) {
  const t  = nNum(p.t);
  const rh = nNum(p.rh);
  const xG = nNum(p.x);   // d, г/кг
  const h  = nNum(p.h);   // энтальпия, кДж/кг
  if (!Number.isFinite(t)) return null;
  // user-флаги — primary fields только если user-set (v0.59.957).
  const xIsUser = !!p.xUser && Number.isFinite(xG);
  const hIsUser = !!p.hUser && Number.isFinite(h);
  // Helper: rh от W (через core RHfromW — единый источник правды)
  const rhFromW = (W) => clamp(100 * RHfromW(t, W, P), 0, 200) / 100;
  // 1. d override (только если user-set)
  if (xIsUser) {
    return state(t, rhFromW(xG / 1000), P);
  }
  // 2. Энтальпия (только если user-set): W = (h − 1.006·t) / (2501 + 1.86·t)
  if (hIsUser) {
    const W = (h - 1.006 * t) / (2501 + 1.86 * t);
    if (Number.isFinite(W) && W >= 0) return state(t, rhFromW(W), P);
  }
  // 3. Стандарт: t + φ
  if (!Number.isFinite(rh)) {
    // fallback — если только t, берём auto x/h как «лучшую догадку»
    if (Number.isFinite(xG))   return state(t, rhFromW(xG / 1000), P);
    if (Number.isFinite(h)) {
      const W = (h - 1.006 * t) / (2501 + 1.86 * t);
      if (Number.isFinite(W) && W >= 0) return state(t, rhFromW(W), P);
    }
    return null;
  }
  return state(t, clamp(rh, 0, 100) / 100, P);
}

/* ========================================================================
   Граф: узлы (S.points) + рёбра (S.procs с fromIdx/toIdx).
   Обратная совместимость: если у ребра нет fromIdx/toIdx — считаем (i, i+1).
   ======================================================================== */
function edgeFrom(pr, i) { return Number.isFinite(+pr?.fromIdx) ? +pr.fromIdx : i; }
function edgeTo(pr, i)   { return Number.isFinite(+pr?.toIdx)   ? +pr.toIdx   : i+1; }
/* Порядок применения рёбер: топологический по fromIdx, потом по toIdx. */
function edgeOrder() {
  return [...S.procs.keys()].sort((a, b) => {
    const fa = edgeFrom(S.procs[a], a), fb = edgeFrom(S.procs[b], b);
    if (fa !== fb) return fa - fb;
    return edgeTo(S.procs[a], a) - edgeTo(S.procs[b], b);
  });
}
/* При удалении узла idx — сдвигаем индексы рёбер, помечаем «битые» рёбра. */
function reindexAfterPointDelete(delIdx) {
  S.procs.forEach(pr => {
    const f = edgeFrom(pr, -1), t = edgeTo(pr, -1);
    if (f === delIdx || t === delIdx) { pr._broken = true; return; }
    pr.fromIdx = f > delIdx ? f - 1 : f;
    pr.toIdx   = t > delIdx ? t - 1 : t;
    ['mixWith','recupWith'].forEach(k => {
      const v = parseInt(pr[k], 10);
      if (Number.isFinite(v)) {
        if (v === delIdx) pr[k] = '';
        else if (v > delIdx) pr[k] = String(v - 1);
      }
    });
  });
  S.procs = S.procs.filter(pr => !pr._broken);
}

/* ========================================================================
   Рендер редактора цикла — узлы и рёбра в РАЗНЫХ контейнерах.
   ======================================================================== */
function renderCycle() {
  renderZones();
  renderNodes();
  renderEdges();
  renderZonesPanel();
}

/* ========================================================================
   Зоны (помещения) — прямоугольные подложки на полотне.
   ======================================================================== */
function newZoneId() { return 'z' + (_zoneSeq++); }
function renderZones() {
  const host = $('psy-canvas-zones');
  if (!host) return;
  host.innerHTML = '';
  S.zones.forEach((z) => {
    if (!z.id) z.id = newZoneId();
    const el = document.createElement('div');
    el.className = 'psy-canvas-zone';
    el.dataset.zoneId = z.id;
    el.style.left   = (+z.cx || 0) + 'px';
    el.style.top    = (+z.cy || 0) + 'px';
    el.style.width  = Math.max(60, +z.w || 200) + 'px';
    el.style.height = Math.max(60, +z.h || 120) + 'px';
    const col = z.color || '#90caf9';
    el.style.background   = hexToRgba(col, 0.12);
    el.style.borderColor  = hexToRgba(col, 0.7);
    el.innerHTML = `
      <div class="psy-canvas-zone-label">${escAttr(z.name || 'Зона')}</div>
      <div class="psy-canvas-zone-resize" data-act="zone-resize"></div>
    `;
    host.appendChild(el);
    attachZoneDrag(el, z);
    attachZoneResize(el, z);
  });
}
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(144,202,249,${a})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
function attachZoneDrag(el, z) {
  let moving = false, sx=0, sy=0, ox=0, oy=0;
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-act="zone-resize"]')) return;
    moving = true;
    sx = e.clientX; sy = e.clientY;
    ox = +z.cx || 0; oy = +z.cy || 0;
    document.body.style.userSelect = 'none';
    document.body.classList.add('psy-dragging');
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!moving) return;
    const k = (S.canvasView?.scale) || 1;  // v0.59.911: учёт canvas zoom
    // v0.59.914: убрал Math.max(0, ...) — с бесконечным canvas зоны
    // должны двигаться куда угодно.
    z.cx = ox + (e.clientX - sx) / k;
    z.cy = oy + (e.clientY - sy) / k;
    el.style.left = (z.cx|0) + 'px';
    el.style.top  = (z.cy|0) + 'px';
  };
  const onUp = () => { if (!moving) return; moving=false; document.body.style.userSelect=''; saveCycle(); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function attachZoneResize(el, z) {
  const grip = el.querySelector('[data-act="zone-resize"]');
  if (!grip) return;
  let rz = false, sx=0, sy=0, ow=0, oh=0;
  grip.addEventListener('mousedown', (e) => {
    rz = true;
    sx = e.clientX; sy = e.clientY;
    ow = +z.w || 200; oh = +z.h || 120;
    document.body.style.userSelect = 'none';
    document.body.classList.add('psy-dragging');
    e.preventDefault(); e.stopPropagation();
  });
  const onMove = (e) => {
    if (!rz) return;
    const k = (S.canvasView?.scale) || 1;  // v0.59.911: учёт canvas zoom
    z.w = Math.max(60, ow + (e.clientX - sx) / k);
    z.h = Math.max(60, oh + (e.clientY - sy) / k);
    el.style.width  = (z.w|0) + 'px';
    el.style.height = (z.h|0) + 'px';
  };
  const onUp = () => { if (!rz) return; rz=false; document.body.style.userSelect=''; saveCycle(); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function renderZonesPanel() {
  const host = $('psy-zones-panel');
  if (!host) return;
  host.innerHTML = '';
  if (!S.zones.length) {
    host.innerHTML = `<div style="padding:8px;color:#607080;font-size:11px">
      Нет зон. Нажмите «+ зона» — появится прямоугольник на полотне, его можно двигать и растягивать.
    </div>`;
    return;
  }
  S.zones.forEach((z, i) => {
    const row = document.createElement('div');
    row.className = 'psy-zone-row';
    row.innerHTML = `
      <input type="color" data-zcol="color" data-i="${i}" value="${escAttr(z.color || '#90caf9')}" title="Цвет">
      <input type="text"  data-zcol="name"  data-i="${i}" value="${escAttr(z.name || '')}" placeholder="Имя зоны">
      <span style="color:#607080">x</span>
      <input type="number" data-zcol="cx" data-i="${i}" value="${+z.cx||0}" step="10" title="X, px">
      <span style="color:#607080">y</span>
      <input type="number" data-zcol="cy" data-i="${i}" value="${+z.cy||0}" step="10" title="Y, px">
      <span style="color:#607080">w</span>
      <input type="number" data-zcol="w"  data-i="${i}" value="${+z.w||200}" step="10" min="60" title="Ширина, px">
      <span style="color:#607080">h</span>
      <input type="number" data-zcol="h"  data-i="${i}" value="${+z.h||120}" step="10" min="60" title="Высота, px">
      <button type="button" class="psy-btn" data-act="zone-del" data-i="${i}" title="Удалить зону">✕</button>
    `;
    host.appendChild(row);
  });
}
function wireZonesPanel() {
  const host = $('psy-zones-panel');
  if (!host) return;
  host.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-zcol]');
    if (!inp) return;
    const i = +inp.dataset.i;
    const col = inp.dataset.zcol;
    const z = S.zones[i]; if (!z) return;
    if (col === 'name' || col === 'color') z[col] = inp.value;
    else z[col] = parseFloat(inp.value) || 0;
    renderZones();
    saveCycle();
  });
  host.addEventListener('click', (e) => {
    const del = e.target.closest('[data-act="zone-del"]');
    if (!del) return;
    const i = +del.dataset.i;
    S.zones.splice(i, 1);
    renderZones();
    renderZonesPanel();
    saveCycle();
  });
}
/* Автоматическая раскладка: узлам без cx/cy проставляем координаты сеткой.
   Шаг 220×260 — с запасом под высоту карточки (~200-220px при фиксированной
   ширине 200px и переносе подписей). */
const NODE_W = 200, NODE_H = 220, GRID_X = 220, GRID_Y = 260;
function ensurePointLayout() {
  S.points.forEach((p, i) => {
    if (!Number.isFinite(+p.cx)) p.cx = 20 + (i % 6) * GRID_X;
    if (!Number.isFinite(+p.cy)) p.cy = 20 + Math.floor(i / 6) * GRID_Y;
  });
}
function renderNodes() {
  const host = $('psy-cycle');
  if (!host) return;
  host.innerHTML = '';
  ensurePointLayout();
  S.points.forEach((p, i) => {
    const card = pointCard(p, i);
    card.style.left = (p.cx | 0) + 'px';
    card.style.top  = (p.cy | 0) + 'px';
    host.appendChild(card);
    attachPointDrag(card, p);
  });
  renderCanvasLinks();
}

/* Перетаскивание узла за заголовок. Во время drag обновляем p.cx/cy,
   двигаем карточку и перерисовываем SVG-связи. В конце — сохраняем цикл. */
function attachPointDrag(card, p) {
  const hdr = card.querySelector('.psy-point-header');
  if (!hdr) return;
  let moving = false, sx=0, sy=0, ox=0, oy=0;
  hdr.addEventListener('mousedown', (e) => {
    // Не мешаем клику по крестику удаления и по самому input
    if (e.target.closest('button')) return;
    if (e.target.tagName === 'INPUT') return;
    moving = true;
    sx = e.clientX; sy = e.clientY;
    ox = +p.cx || 0; oy = +p.cy || 0;
    document.body.style.userSelect = 'none';
    document.body.classList.add('psy-dragging');
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!moving) return;
    // v0.59.911: учитываем canvas zoom — clientX-delta нужно разделить на scale
    // v0.59.914: убрал Math.max(0, ...) — с бесконечным canvas карточки должны
    // двигаться куда угодно (в т.ч. в отрицательные координаты).
    const k = (S.canvasView?.scale) || 1;
    p.cx = ox + (e.clientX - sx) / k;
    p.cy = oy + (e.clientY - sy) / k;
    card.style.left = (p.cx|0) + 'px';
    card.style.top  = (p.cy|0) + 'px';
    renderCanvasLinks();
  };
  const onUp = () => {
    if (!moving) return;
    moving = false;
    document.body.style.userSelect = ''; document.body.classList.remove('psy-dragging');
    saveCycle();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* SVG-рендер связей между узлами по S.procs (fromIdx → toIdx).
   Линия от центра нижней стороны источника к центру верхней стороны
   цели с цветом процесса. Для M/R — дополнительная пунктирная линия
   к ref-узлу. */
function renderCanvasLinks() {
  const svg = $('psy-canvas-links');
  if (!svg) return;
  // v0.59.916: учёт отрицательных координат (drag без 0-clamp).
  // SVG viewBox теперь начинается с минимальной точки + padding.
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  S.points.forEach(p => {
    const cx = +p.cx || 0, cy = +p.cy || 0;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx + NODE_W > maxX) maxX = cx + NODE_W;
    if (cy + NODE_H > maxY) maxY = cy + NODE_H;
  });
  // Padding и минимум
  const padX = 40, padY = 40;
  const vbX = Math.min(0, minX - padX);
  const vbY = Math.min(0, minY - padY);
  const w = Math.max(2400, maxX + padX - vbX);
  const h = Math.max(1200, maxY + padY - vbY);
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.style.left = vbX + 'px';
  svg.style.top  = vbY + 'px';
  const parent = svg.parentElement;
  if (parent) {
    parent.style.width  = w + 'px';
    parent.style.height = h + 'px';
  }
  const centerBottom = (p) => ({ x: (+p.cx||0) + NODE_W/2, y: (+p.cy||0) + NODE_H });
  const centerTop    = (p) => ({ x: (+p.cx||0) + NODE_W/2, y: (+p.cy||0) });
  const centerMid    = (p) => ({ x: (+p.cx||0) + NODE_W/2, y: (+p.cy||0) + NODE_H/2 });
  // Defs: маркеры-стрелки по типам
  const arrDefs = Object.entries(PROC_COLOR).map(([k, col]) => `
    <marker id="cv-${k}" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${col}"/>
    </marker>`).join('');
  let out = `<defs>${arrDefs}</defs>`;
  S.procs.forEach((pr, i) => {
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    const a = S.points[fromI], b = S.points[toI];
    if (!a || !b || fromI === toI) return;
    const color = PROC_COLOR[pr.type] || '#607080';
    const p1 = centerBottom(a), p2 = centerTop(b);
    // Кривая Безье — плавная линия
    const midY = (p1.y + p2.y) / 2;
    const d = `M ${p1.x} ${p1.y} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${p2.y}`;
    // v0.59.944: оборачиваем drawing процесса в <g> с data-proc-idx —
    // клик открывает modal-редактор. По репорту: «добавь возможность
    // изменения процесса кликом на сам процесс».
    out += `<g class="psy-canvas-proc" data-proc-idx="${i}" style="color:${color}">`;
    out += `<title>${escAttr((PROC_SHORT_NAME_GLOBAL?.[pr.type] || pr.type) + ' — клик для настройки')}</title>`;
    // невидимая «жирная» подложка под кривую — чтобы ловить клик в широкой зоне
    out += `<path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>`;
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"
             marker-end="url(#cv-${pr.type||'X'})"/>`;
    // Бейдж типа процесса на середине кривой
    const bx = (p1.x + p2.x) / 2, by = midY;

    // v0.59.915: для R-процесса — настоящий X-cross символ рекуператора
    // Показываем 4-портовое устройство с двумя пересекающимися потоками.
    if (pr.type === 'R') {
      const refKey = pr.recupWith;
      const r = refKey != null ? S.points[parseInt(refKey, 10)] : null;
      if (r) {
        const rc = centerMid(r);
        const bc = centerMid(b);
        // Вытяжной поток ref → exhaust (через тот же teplotechnik)
        // Рисуем вытяжной как pas-двойную линию параллельную главному
        const dx = bx, dy = by;
        // Бокс рекуператора — квадрат вокруг центрального бейджа
        const boxR = 22;
        out += `<rect x="${dx - boxR}" y="${dy - boxR}" width="${boxR*2}" height="${boxR*2}" rx="3"
                fill="#fff" stroke="${color}" stroke-width="2"/>`;
        // X-cross внутри (пересечение потоков)
        out += `<line x1="${dx - boxR + 4}" y1="${dy - boxR + 4}" x2="${dx + boxR - 4}" y2="${dy + boxR - 4}"
                stroke="${color}" stroke-width="2" stroke-dasharray="3,2" opacity="0.7"/>`;
        out += `<line x1="${dx + boxR - 4}" y1="${dy - boxR + 4}" x2="${dx - boxR + 4}" y2="${dy + boxR - 4}"
                stroke="${color}" stroke-width="2" stroke-dasharray="3,2" opacity="0.7"/>`;
        // Подпись η на коробке
        const eta = pr.recupEff || '?';
        out += `<text x="${dx}" y="${dy + boxR + 12}" text-anchor="middle" font-size="10" font-weight="600" fill="${color}">η=${eta}</text>`;
        // Линия выхода вытяжки (от ref-узла к коробке) — пунктирная, чтобы было видно теплоту
        out += `<line x1="${rc.x}" y1="${rc.y}" x2="${dx}" y2="${dy}"
                stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>`;
        out += `<text x="${(rc.x+dx)/2}" y="${(rc.y+dy)/2 - 4}" text-anchor="middle" font-size="9" fill="${color}" opacity="0.8">вытяжка</text>`;
        out += `</g>`;
        return;  // не рисуем стандартный bage поверх
      }
    }
    // v0.59.915: для M-процесса — символ смешения (Y-junction)
    if (pr.type === 'M') {
      const refKey = pr.mixWith;
      const r = refKey != null ? S.points[parseInt(refKey, 10)] : null;
      if (r) {
        const rc = centerMid(r);
        // Y-shape: основной поток + ref-поток сходятся в b
        out += `<line x1="${rc.x}" y1="${rc.y}" x2="${p2.x}" y2="${p2.y}"
                stroke="${color}" stroke-width="1.8" stroke-dasharray="4,3" opacity="0.6"/>`;
        // Пузырь смешения
        out += `<g transform="translate(${bx},${by})">
          <circle r="14" fill="#fff" stroke="${color}" stroke-width="2"/>
          <text y="4" text-anchor="middle" font-size="13" font-weight="700" fill="${color}">M</text>
        </g>`;
        const ratio = pr.mixRatio || '?';
        out += `<text x="${bx}" y="${by + 26}" text-anchor="middle" font-size="10" font-weight="600" fill="${color}">${ratio}</text>`;
        out += `</g>`;
        return;
      }
    }
    out += `<g transform="translate(${bx},${by})">
      <circle r="10" fill="#fff" stroke="${color}" stroke-width="1.5"/>
      <text y="3.5" text-anchor="middle" font-size="11" font-weight="700" fill="${color}">${pr.type||'X'}</text>
    </g>`;
    // v0.59.949: имя процесса под бейджем (если задано). По репорту:
    // «в демо-цикле ЦОД не нашел нагрева от стоек» — explicit name
    // делает IT-нагрузку и др. явно видимыми.
    const labelName = pr.name || PROC_SHORT_NAME_GLOBAL[pr.type] || '';
    if (labelName) {
      out += `<text x="${bx}" y="${by + 24}" text-anchor="middle"
              font-size="11" fill="${color}" font-weight="600"
              paint-order="stroke" stroke="#fff" stroke-width="3">${escAttr(labelName)}</text>`;
    }
    // v0.59.925: ⚠ icon если есть feasibility-warning (proc._wizWarn)
    if (pr._wizWarn) {
      out += `<g transform="translate(${bx + 14},${by - 10})">
        <circle r="7" fill="#fef3c7" stroke="#b45309" stroke-width="1"/>
        <text y="3" text-anchor="middle" font-size="10" font-weight="700" fill="#b45309">⚠</text>
        <title>${escAttr(String(pr._wizWarn))}</title>
      </g>`;
    }
    out += `</g>`;  // close .psy-canvas-proc
  });
  svg.innerHTML = out;
  // v0.59.944: клик по элементу процесса → открыть modal-редактор.
  // Wire один раз — у SVG-элемента, через event-делегацию на data-proc-idx.
  if (!svg._procClickWired) {
    svg._procClickWired = true;
    svg.addEventListener('click', (e) => {
      const g = e.target.closest('[data-proc-idx]');
      if (!g) return;
      e.stopPropagation();
      const idx = +g.dataset.procIdx;
      if (Number.isFinite(idx) && idx >= 0 && idx < S.procs.length) {
        openProcessEditor(idx);
      }
    });
  }
}
function renderEdges() {
  const host = $('psy-edges');
  if (host) {
    host.innerHTML = '';
    if (!S.procs.length) {
      host.innerHTML = `<div style="padding:12px;color:#607080;font-size:12px">
        Нет связей. Нажмите «+ связь», чтобы задать процесс между любыми двумя узлами (графовая модель: узел → узел).
      </div>`;
    } else {
      S.procs.forEach((pr, i) => host.appendChild(procArrow(pr, i)));
    }
  }
  renderEdgesList();
  renderProcsSidebar();
  applyEdgeViewMode();
}

/* v0.59.939: левый сайдбар «Процессы» рядом с canvas. Рендерит
   компактный список процессов с краткими параметрами и кнопкой
   редактирования (открывает модалку с детальной настройкой). */
const PROC_SHORT_NAME_GLOBAL = {
  P: 'Нагрев', C: 'Охлаждение', A: 'Адиабат. увл.',
  S: 'Пар. увл.', M: 'Смешение', R: 'Рекуператор', X: 'Своб.', none: '— разрыв',
};
function renderProcsSidebar() {
  const host = $('psy-procs-sidebar-list');
  if (!host) return;
  if (!S.procs.length) {
    host.innerHTML = `<div class="psy-procs-sidebar-empty">
      Нет процессов. Нажмите «+ связь» — появится первый процесс.<br><br>
      💡 Также: «🧙 Мастер процесса» — пошагово создаёт связь + новую целевую точку.
    </div>`;
    return;
  }
  // Один раз вычисляем cycle для отображения Q/qw/V в краткой форме.
  let cyc = null;
  try { cyc = computeCycle(); } catch {}
  const sts = cyc?.sts || [];
  const segs = cyc?.segs || [];
  host.innerHTML = S.procs.map((pr, i) => {
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    const a = sts[fromI], b = sts[toI];
    const seg = segs[i];
    const color = PROC_COLOR[pr.type] || '#607080';
    const shortName = pr.name || PROC_SHORT_NAME_GLOBAL[pr.type] || pr.type;
    const fmt = (v, d=1) => Number.isFinite(v) ? (Math.abs(v) < 1000 ? v.toFixed(d) : v.toExponential(2)) : '—';
    const tA = a ? `${fmt(a.T,1)}°C` : '—';
    const tB = b ? `${fmt(b.T,1)}°C` : '—';
    const dT = (a && b) ? (b.T - a.T).toFixed(1) : '—';
    const Q = seg?.Q != null ? `Q=${fmt(seg.Q,1)}кВт` : '';
    const qw = seg?.qw != null && Math.abs(seg.qw) > 0.001 ? `q<sub>w</sub>=${fmt(seg.qw,2)}кг/ч` : '';
    return `
      <div class="psy-procs-sidebar-item" data-proc-idx="${i}" tabindex="0" role="button"
           title="Кликните для детальных настроек">
        <div class="psy-procs-sidebar-item-row1">
          <span class="psy-procs-sidebar-type-badge" style="background:${color}">${pr.type || 'X'}</span>
          <span class="psy-procs-sidebar-name">${escAttr(shortName)}</span>
          <button type="button" class="psy-procs-sidebar-del" data-act="del-edge" data-i="${i}" title="Удалить связь">✕</button>
        </div>
        <div class="psy-procs-sidebar-edge">${fromI+1}. ${escAttr((S.points[fromI]?.name||'').slice(0,16))} → ${toI+1}. ${escAttr((S.points[toI]?.name||'').slice(0,16))}</div>
        <div class="psy-procs-sidebar-stats">
          <span>${tA} → ${tB}</span>
          <span>ΔT=${dT}</span>
          ${Q ? `<span><b>${Q}</b></span>` : ''}
          ${qw ? `<span>${qw}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* v0.59.939: общий wireGraphHost (был closure в wire(), теперь module-level).
   Принимает либо id, либо элемент DOM. Используется для основной панели
   узлов/связей и для нашей modal-редактора процесса. */
function wireGraphHost(hostOrId) {
  const host = typeof hostOrId === 'string' ? $(hostOrId) : hostOrId;
  if (!host) return;
  host.addEventListener('input', (e) => {
    const col = e.target?.dataset?.col;
    if (col && ['V','name','t','rh','x','h','Q','qw'].includes(col)) {
      e.target.dataset.user = '1';
      e.target.dataset.ts = String(performance.now());
      // v0.59.957: при изменении одного из «парного» поля сбрасываем
      // user-флаг конфликтующих, чтобы pointState не запоминал устаревшее
      // значение. По репорту: «почему связанные параметры не пересчитываются
      // автоматический????».
      // Логика: pointState приоритезирует d > h > φ. Если user изменяет φ,
      // но x/h помечены user — pointState использует old x → новый φ
      // игнорируется. Поэтому:
      //   • t или rh типит → x/h становятся auto (cleared user-flag)
      //   • x или h типит → rh становится auto (производное от t+d или t+h)
      const card = e.target.closest('.psy-point');
      if (card) {
        const clearList =
          col === 't' || col === 'rh' ? ['x', 'h'] :
          col === 'x' || col === 'h'  ? ['rh']     :
          [];
        clearList.forEach(f => {
          const fInp = card.querySelector(`[data-col="${f}"]`);
          if (fInp && fInp !== e.target) {
            fInp.dataset.user = '';
            fInp.dataset.ts = '0';
          }
        });
      }
    }
    update();
  });
  host.addEventListener('change', (e) => {
    const col = e.target?.dataset?.col;
    if (col === 'proc-type') {
      const i = +e.target.dataset.i;
      S.procs[i] = S.procs[i] || {};
      S.procs[i].type = e.target.value;
      rerenderCycle();
      return;
    }
    if (col === 'fromIdx' || col === 'toIdx') {
      const i = +e.target.dataset.i;
      S.procs[i] = S.procs[i] || {};
      S.procs[i][col] = parseInt(e.target.value, 10);
      rerenderCycle();
      return;
    }
    update();
  });
  host.addEventListener('blur', (e) => {
    const col = e.target?.dataset?.col;
    if (!col) return;
    if (['V','t','rh','x','h','Q','qw'].includes(col) && e.target.value.trim() === '') {
      e.target.dataset.user = '';
      e.target.dataset.ts = '0';
      update();
    }
  }, true);
  host.addEventListener('click', (e) => {
    const delPt = e.target.closest('[data-act="del"]');
    const delEd = e.target.closest('[data-act="del-edge"]');
    if (delPt) {
      const i = +delPt.dataset.i;
      S.points.splice(i, 1);
      reindexAfterPointDelete(i);
      rerenderCycle();
    } else if (delEd) {
      const i = +delEd.dataset.i;
      S.procs.splice(i, 1);
      rerenderCycle();
    }
  });
}

/* v0.59.939: модалка редактирования процесса. Содержит полную карточку
   procArrow (тот же UI, что был в панели «Связи»). Сама карточка вешается
   на единый wireGraphHost-механизм, поэтому редактирование работает
   как в основной панели. По репорту: «сама настройка процесса должна
   проходить в том же модальном окне что и в мастере процесса». */
function openProcessEditor(procIdx) {
  const pr = S.procs[procIdx];
  if (!pr) return;
  const overlay = document.createElement('div');
  overlay.className = 'psy-proc-edit-overlay';
  overlay.innerHTML = `
    <div class="psy-proc-edit-modal" role="dialog" aria-label="Настройка процесса">
      <div class="psy-proc-edit-head">
        <h3>⚙ Процесс ${procIdx + 1}: ${escAttr(PROC_SHORT_NAME_GLOBAL[pr.type] || pr.type)}</h3>
        <button type="button" class="psy-proc-edit-close" title="Закрыть">×</button>
      </div>
      <div class="psy-proc-edit-body" id="psy-proc-edit-body"></div>
      <div class="psy-proc-edit-actions">
        <button type="button" class="psy-wiz-btn psy-proc-edit-wizard" title="Открыть мастер процесса с пресетами оборудования">🧙 Через мастер</button>
        <button type="button" class="psy-wiz-btn psy-proc-edit-ok psy-wiz-primary">Готово</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // Вставляем актуальную карточку
  const body = overlay.querySelector('#psy-proc-edit-body');
  body.appendChild(procArrow(pr, procIdx));
  wireGraphHost(body);  // те же event-handlers как в основной панели
  // v0.59.951: триггерим update() чтобы computed-блок (Δ состояний,
  // Q/qw) сразу заполнился актуальными значениями для новой DOM-карточки.
  try { update(); } catch {}
  // v0.59.955: drag по header. По репорту: «модалки должны перемещаться
  // мышью». Используем абсолютное позиционирование modal-окна с offset-ом
  // от центра. Закрытие сбрасывает позицию (modal каждый раз новый).
  (() => {
    const head = overlay.querySelector('.psy-proc-edit-head');
    const modal = overlay.querySelector('.psy-proc-edit-modal');
    if (!head || !modal) return;
    let dx = 0, dy = 0, sx = 0, sy = 0, dragging = false;
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = modal.getBoundingClientRect();
      dx = rect.left; dy = rect.top;
      // Переключаем модалку из flex-center в абсолютное
      modal.style.position = 'absolute';
      modal.style.left = dx + 'px';
      modal.style.top  = dy + 'px';
      modal.style.margin = '0';
      overlay.style.alignItems = 'flex-start';
      overlay.style.justifyContent = 'flex-start';
      document.body.classList.add('psy-dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      modal.style.left = (dx + e.clientX - sx) + 'px';
      modal.style.top  = (dy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('psy-dragging');
    });
  })();
  // v0.59.953: «🧙 Через мастер» — закрывает модалку и открывает
  // wizard step 2 для текущего типа. По репорту: «при открытии
  // карточки процесса внутри можно запустить мастер процесса и
  // изменить данные через мастер». Применённые в wizard поля
  // создают новый процесс (старый можно удалить если нужно), либо
  // если type совпадает и это R/M — настройки можно скопировать.
  overlay.querySelector('.psy-proc-edit-wizard').addEventListener('click', () => {
    overlay.remove();
    rerenderCycle();
    // v0.59.956: передаём editProcIdx — wizard работает в edit-mode,
    // обновляет существующий процесс вместо создания дубликата.
    if (pr.type && pr.type !== 'none') {
      try { openWizardStep2(pr.type, procIdx); } catch (e) { console.error('[wizardStep2]', e); }
    } else {
      try { openProcessWizard(); } catch (e) { console.error('[wizard]', e); }
    }
  });
  const close = () => {
    overlay.remove();
    rerenderCycle();  // диаграмма + sidebar обновляются
  };
  overlay.querySelector('.psy-proc-edit-close').addEventListener('click', close);
  overlay.querySelector('.psy-proc-edit-ok').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close();
    }
  });
}

/* Таблица-список процессов. Альтернатива карточкам: компактный свод
   всех рёбер графа в виде строк. Inline-редактирование типа, от-узла,
   к-узла. Остальные параметры отображаются read-only и редактируются
   в карточной панели. Стиль близок к референсу пользователя. */
function renderEdgesList() {
  const host = $('psy-edges-list');
  if (!host) return;
  if (!S.procs.length) {
    host.innerHTML = `<div class="psy-el-empty">Нет связей. Добавьте «+ связь» — появится строка в таблице.</div>`;
    return;
  }
  // Вычисляем параметры точек один раз, чтобы показать t/φ/L в строках.
  const { sts, segs } = computeCycle();
  const nodeLabel = (i) => {
    const n = S.points[i]; if (!n) return '—';
    return `${i+1}. ${escAttr((n.name||'').slice(0,18))}`;
  };
  const trs = S.procs.map((pr, i) => {
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    const a = sts[fromI], b = sts[toI];
    const s = segs[i] || null;
    const typeLabel = PROC_TYPES.find(p => p.v === pr.type)?.t?.split('·')[0]?.trim() || pr.type;
    const col = PROC_COLOR[pr.type] || '#607080';
    const typeBadge = `<span class="psy-el-type" style="background:${col}">${pr.type || 'X'}</span>`;
    const fmt = (v, d=1) => Number.isFinite(v) ? v.toFixed(d) : '—';
    const nodeOpts = (sel) => S.points.map((p, pi) =>
      `<option value="${pi}" ${pi===sel?'selected':''}>${pi+1}. ${escAttr((p.name||'').slice(0,16))}</option>`).join('');
    return `
      <tr data-el-idx="${i}">
        <td class="psy-el-name">${typeBadge} <b>${escAttr(typeLabel)}</b></td>
        <td>
          <select data-el-col="type" data-i="${i}" title="Тип процесса">
            ${PROC_TYPES.map(pt => `<option value="${pt.v}" ${pr.type===pt.v?'selected':''}>${pt.v} · ${pt.t.split('·').slice(1).join('·').trim()||pt.t}</option>`).join('')}
          </select>
        </td>
        <td>
          <select data-el-col="fromIdx" data-i="${i}">${nodeOpts(fromI)}</select>
        </td>
        <td>${a ? fmt(a.T, 1) : '—'}</td>
        <td>${a ? fmt(a.RH, 0) : '—'}</td>
        <td>${s ? fmt(s.V, 0) : '—'}</td>
        <td>
          <select data-el-col="toIdx" data-i="${i}">${nodeOpts(toI)}</select>
        </td>
        <td>${b ? fmt(b.T, 1) : '—'}</td>
        <td>${b ? fmt(b.RH, 0) : '—'}</td>
        <td>${s ? fmt(s.V, 0) : '—'}</td>
        <td style="color:${s && s.Q>0?'#c62828':'#0277bd'};font-weight:600">${s ? fmt(s.Q, 2) : '—'}</td>
        <td style="color:${s && s.qw>0?'#2e7d32':'#6a1b9a'}">${s ? fmt(s.qw, 3) : '—'}</td>
        <td><button type="button" class="psy-el-del" data-act="del-edge" data-i="${i}" title="Удалить связь">✕</button></td>
      </tr>`;
  }).join('');
  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th rowspan="2" style="width:160px">Наименование</th>
          <th rowspan="2" style="width:180px">Тип процесса</th>
          <th colspan="4" class="psy-el-group">Начальная точка</th>
          <th colspan="4" class="psy-el-group">Конечная точка</th>
          <th rowspan="2">Q, кВт</th>
          <th rowspan="2">q<sub>w</sub>, кг/ч</th>
          <th rowspan="2"></th>
        </tr>
        <tr>
          <th>№</th><th>t, °C</th><th>φ, %</th><th>L, м³/ч</th>
          <th>№</th><th>t, °C</th><th>φ, %</th><th>L, м³/ч</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  `;
}

/* v0.59.90: габариты полотна диаграммы по формату+ориентации (в единицах
   SVG, 3 px/мм). A4 = 210×297 мм, A3 = 297×420 мм. Возвращает {w,h}. */
function chartPageDims() {
  const PPM = 3; // px per mm
  const paper = S.chartFormat === 'A3' ? { w: 297, h: 420 } : { w: 210, h: 297 };
  const isLand = S.chartOrient === 'landscape';
  const w = (isLand ? paper.h : paper.w) * PPM;
  const h = (isLand ? paper.w : paper.h) * PPM;
  return { w: Math.round(w), h: Math.round(h) };
}

function applyEdgeViewMode() {
  const cards = $('psy-edges');
  const list  = $('psy-edges-list');
  if (!cards || !list) return;
  const mode = S.edgeView === 'list' ? 'list' : 'cards';
  cards.style.display = mode === 'cards' ? '' : 'none';
  list.style.display  = mode === 'list'  ? '' : 'none';
  document.querySelectorAll('.psy-view-btn').forEach(b => {
    const on = b.dataset.view === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function pointCard(p, i) {
  const el = document.createElement('div');
  el.className = 'psy-point';
  el.dataset.pointIdx = String(i);
  const du = (f) => p[f+'User'] ? '1' : '';
  const ts = (f) => Number.isFinite(+p[f+'Ts']) ? String(p[f+'Ts']) : '0';
  const ru = S.showRuNames;
  const L = {
    t:   `t, °C${ru?' <em style="color:#90a4ae;font-style:normal">(температура)</em>':''}`,
    rh:  `φ, %${ru?' <em style="color:#90a4ae;font-style:normal">(отн. влажн.)</em>':''}`,
    d:   `d, г/кг${ru?' <em style="color:#90a4ae;font-style:normal">(влагосодерж.)</em>':''}`,
    h:   `h, кДж/кг${ru?' <em style="color:#90a4ae;font-style:normal">(энтальпия)</em>':''}`,
  };
  const hint = i === 0
    ? `<span class="pt-hint">Начало цикла: задайте любые 2 из {t, φ, d, h}.</span>`
    : `<span class="pt-hint">Задайте любую из {t, φ, d, h} — остальное посчитается от процесса ${i}→${i+1}. Либо задайте Q или q<sub>w</sub> на стрелке выше.</span>`;
  el.innerHTML = `
    <div class="psy-point-header">
      <span>Точка ${i+1}</span>
      <button type="button" class="pt-del" title="Удалить точку" data-act="del" data-i="${i}">✕</button>
    </div>
    <label>Имя<input type="text" data-col="name" data-i="${i}" data-user="${du('name')}" value="${escAttr(p.name || '')}"></label>
    <label>${L.t}<input type="number" data-col="t" data-i="${i}" data-user="${du('t')}" data-ts="${ts('t')}" value="${p.t ?? ''}" step="0.1"></label>
    <label>${L.rh}<input type="number" data-col="rh" data-i="${i}" data-user="${du('rh')}" data-ts="${ts('rh')}" value="${p.rh ?? ''}" step="1" min="0" max="100"></label>
    <label>${L.d}<input type="number" data-col="x" data-i="${i}" data-user="${du('x')}" data-ts="${ts('x')}" value="${p.x ?? ''}" step="0.1" placeholder="авто"></label>
    <label>${L.h}<input type="number" data-col="h" data-i="${i}" data-user="${du('h')}" data-ts="${ts('h')}" value="${p.h ?? ''}" step="0.1" placeholder="авто"></label>
    ${hint}
    <div class="pt-computed" data-role="pt-computed"></div>
  `;
  return el;
}

function procArrow(pr, i) {
  const el = document.createElement('div');
  el.className = 'psy-proc-arrow';
  el.dataset.procIdx = String(i);
  // v0.59.952: accent-цвет слева в цвете процесса.
  const procColor = PROC_COLOR[pr.type] || '#607080';
  el.style.borderLeftColor = procColor;
  el.dataset.procColor = pr.type || 'X';
  const fromI = edgeFrom(pr, i);
  const toI   = edgeTo(pr, i);
  const srcNode = S.points[fromI];
  const userV = srcNode?.V;
  const hasUserV = userV != null && userV !== '';
  const duQ  = pr.Qs  ? '1' : '';
  const duQw = pr.qws ? '1' : '';
  const tsQ  = Number.isFinite(+pr.Qts)  ? String(pr.Qts)  : '0';
  const tsQw = Number.isFinite(+pr.qwts) ? String(pr.qwts) : '0';
  const nodeOpts = (sel) => S.points.map((p, pi) =>
    `<option value="${pi}" ${pi===sel?'selected':''}>${pi+1}. ${escAttr((p.name||'').slice(0,22))}</option>`).join('');
  // v0.59.951: для P-нагрева q_w структурно всегда 0 (d=const → ΔW=0)
  // — input убираем, чтобы не сбивать пользователя. По репорту:
  // «использование для нагрева qw, кг/ч, для меня не понятно? это нужно?»
  // Также скрываем для S (паровое увлажн.) — там qw тоже однозначно =
  // m_da·(W₂−W₁), но пользователь обычно задаёт W₂ через φ или через ΔW
  // на точке, не через qw напрямую.
  const showQwInput = !['P'].includes(pr.type);
  el.innerHTML = `
    <div class="arr-label" style="display:flex;justify-content:space-between;align-items:center;gap:4px">
      <span>${fromI+1} → ${toI+1}</span>
      <button type="button" title="Удалить связь" data-act="del-edge" data-i="${i}"
              style="background:transparent;border:0;color:#c62828;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
    </div>
    <!-- v0.59.953: Δ-блок ПЕРЕНЕСЁН в начало карточки — сразу видно
         текущие Q/qw/ΔT при открытии. Раньше был внизу — пришлось
         бы скроллить. -->
    <div data-role="proc-computed" style="margin-bottom:4px;padding:5px 7px;background:#f0f4f8;border:1px solid #d4d9e0;border-radius:3px;font-size:10px;line-height:1.5;color:#37474f;display:none">
      <div data-role="proc-computed-row" style="font-weight:600;color:#263238;margin-bottom:2px">📊 Δ состояний и нагрузка:</div>
      <div data-role="proc-computed-deltas">—</div>
    </div>
    <label style="font-size:10px;color:#455a64"><span>от узла</span>
      <select data-col="fromIdx" data-i="${i}">${nodeOpts(fromI)}</select>
    </label>
    <label style="font-size:10px;color:#455a64;margin-top:2px"><span>к узлу</span>
      <select data-col="toIdx" data-i="${i}">${nodeOpts(toI)}</select>
    </label>
    <select data-col="proc-type" data-i="${i}" style="margin-top:4px">
      ${PROC_TYPES.map(pt => `<option value="${pt.v}" ${pr.type===pt.v?'selected':''}>${pt.t}</option>`).join('')}
    </select>
    <div class="arr" data-role="arr" style="color:${PROC_COLOR[pr.type]||'#607080'}">↓</div>
    <label style="font-size:10px;color:#666;margin-top:4px"><span>Q, кВт</span>
      <input type="number" data-col="Q" data-i="${i}" data-user="${duQ}" data-ts="${tsQ}" value="${pr.Q ?? ''}" step="0.1" placeholder="авто">
    </label>
    ${showQwInput ? `
    <label style="font-size:10px;color:#666;margin-top:2px"><span>q<sub>w</sub>, кг/ч</span>
      <input type="number" data-col="qw" data-i="${i}" data-user="${duQw}" data-ts="${tsQw}" value="${pr.qw ?? ''}" step="0.1" placeholder="авто">
      <span data-role="condensate" style="display:none;margin-top:3px;padding:3px 5px;background:#e1f5fe;border:1px solid #4fc3f7;border-radius:3px;font-size:10px;color:#01579b;font-weight:600;"></span>
    </label>
    ` : `
    <div style="font-size:10px;color:#999;margin-top:2px;font-style:italic;">
      q<sub>w</sub> = 0 (нагрев d=const, влагу не передаёт)
      <span data-role="condensate" style="display:none"></span>
    </div>
    `}
    <label style="font-size:10px;color:#666;margin-top:4px"><span>V процесса, м³/ч</span>
      <input type="number" data-col="V" data-i="${i}" data-user="${hasUserV?'1':''}" value="${hasUserV?userV:''}" step="100" placeholder="авто (масса)">
      <span class="v-auto" data-role="v-auto" style="font-size:10px;color:#2e7d32;display:block;margin-top:2px;"></span>
    </label>
    ${pr.type === 'M' ? mixControls(pr, i) : ''}
    ${pr.type === 'R' ? recupControls(pr, i) : ''}
    ${pr.type === 'C' ? coolControls(pr, i) : ''}
    <div data-role="proc-warn" style="display:none;margin-top:6px;padding:4px 6px;background:#fff3e0;border:1px solid #ffb74d;border-radius:3px;font-size:10px;line-height:1.3;color:#bf360c;"></div>
  `;
  return el;
}

/* v0.59.905: ADP/BF контролы для процесса C (охлаждение).
   ADP — Apparatus Dew Point (T поверхности коил), BF — Bypass Factor (доля 0..1).
   По ASHRAE Handbook HVAC Systems and Equipment гл. 23. Если задан ADP < Td_in,
   конденсат считается ВСЕГДА (даже если t_out > Td_in). */
function coolControls(pr, i) {
  const adp = pr.adp ?? '';
  const bf = pr.bf ?? '';
  return `
    <div style="margin-top:6px;padding:6px 8px;background:#e1f5fe;border:1px solid #81d4fa;border-radius:4px">
      <div style="font-size:10.5px;font-weight:600;color:#01579b;margin-bottom:3px">❄ Охладитель / коил</div>
      <label style="font-size:10px;color:#01579b;display:block">ADP, °C (T поверхности коил)
        <input type="number" data-col="adp" data-i="${i}" value="${adp}" step="0.5" placeholder="авто (контактное)" style="width:100%">
      </label>
      <label style="font-size:10px;color:#01579b;display:block;margin-top:3px">BF (bypass factor 0..1)
        <input type="number" data-col="bf" data-i="${i}" value="${bf}" step="0.05" min="0" max="1" placeholder="0.15 (тип. DX)" style="width:100%">
      </label>
      <div style="font-size:9.5px;color:#0277bd;margin-top:3px;line-height:1.3">
        Без ADP — контактная модель (конденсат только если t₂&lt;t_dp_in).<br>
        С ADP — BF-смешение: W₂ = BF·W₁ + (1−BF)·W_sat(ADP). Корректно для коила.
      </div>
    </div>
  `;
}

/* Поля для процесса «R» (рекуператор): опорная точка (вытяжка) + КПД η (по t).
   Модель: t₂ = t₁ + η·(t_ref − t₁), W₂ = W₁ (сенсибельная модель). */
function recupControls(pr, i) {
  const rw = (pr.recupWith ?? '').toString();
  const eff = (pr.recupEff ?? '0.6').toString();
  const mode = pr.recupMode || 'sensible';  // v0.59.931
  const opts = S.points.map((pp, pi) =>
    `<option value="${pi}" ${String(pi)===rw?'selected':''}>${pi+1}. ${escAttr((pp.name||'').slice(0,16))}</option>`
  ).join('');
  return `
    <label style="font-size:10px;color:#ad1457;margin-top:4px;border-top:1px dashed #f48fb1;padding-top:4px" title="Опорная точка — поток, отдающий тепло (обычно вытяжка)."><span>обменивать с точкой</span>
      <select data-col="recupWith" data-i="${i}">
        <option value="">— выбрать —</option>${opts}
      </select>
    </label>
    <label style="font-size:10px;color:#ad1457;margin-top:2px" title="КПД рекуператора (0…1). t₂ = t₁ + η·(t_ref − t₁)."><span>η</span>
      <input type="number" data-col="recupEff" data-i="${i}" value="${eff}" step="0.05" min="0" max="1">
    </label>
    <label style="font-size:10px;color:#ad1457;margin-top:2px" title="Режим: sensible — только теплообмен (d=const). total — энтальпийный (роторный) — также передаёт влагу с тем же η."><span>режим</span>
      <select data-col="recupMode" data-i="${i}">
        <option value="sensible"${mode==='sensible'?' selected':''}>Sensible (T-only, пластинч.)</option>
        <option value="total"${mode==='total'?' selected':''}>Total / энтальпийный (роторный)</option>
      </select>
    </label>
  `;
}

/* Поля для процесса «M» (смешение): опорная точка + доля α */
function mixControls(pr, i) {
  const mw = (pr.mixWith ?? '').toString();
  const mr = (pr.mixRatio ?? '0.5').toString();
  const opts = S.points.map((pp, pi) =>
    `<option value="${pi}" ${String(pi)===mw?'selected':''}>${pi+1}. ${escAttr((pp.name||'').slice(0,16))}</option>`
  ).join('');
  return `
    <label style="font-size:10px;color:#00838f;margin-top:4px;border-top:1px dashed #b0bec5;padding-top:4px"><span>смешать с точкой</span>
      <select data-col="mixWith" data-i="${i}">
        <option value="">— выбрать —</option>${opts}
      </select>
    </label>
    <label style="font-size:10px;color:#00838f;margin-top:2px" title="Доля (по массе) входящего потока от точки ${i+1} в смеси. Остальное — от опорной точки."><span>α (доля ${i+1})</span>
      <input type="number" data-col="mixRatio" data-i="${i}" value="${mr}" step="0.05" min="0" max="1">
    </label>
  `;
}

/* --- Обновляет только computed-блоки карточек БЕЗ пересоздания input'ов.
   Так мы не теряем фокус при вводе. */
function refreshComputedInCards() {
  S.points.forEach((p, i) => {
    const card = document.querySelector(`.psy-point[data-point-idx="${i}"]`);
    if (!card) return;
    const st = pointState(p, S.P);
    const computed = card.querySelector('[data-role="pt-computed"]');
    card.classList.toggle('invalid', !!(st && st.RH > S.rhMax + 0.1));
    if (!computed) return;
    if (!st) {
      computed.innerHTML = i === 0
        ? `<span style="color:#c62828">Начало цикла: задайте любые 2 из (t, φ, d, h).</span>`
        : `<span style="color:#c62828">Задайте любую из (t, φ, d, h) — остальное посчитается от процесса ${i}→${i+1}. Либо задайте Q или q<sub>w</sub> на стрелке процесса выше.</span>`;
    } else {
      computed.innerHTML =
        `<b>d</b>=${(st.W*1000).toFixed(2)} г/кг · <b>h</b>=${st.h.toFixed(2)} кДж/кг<br>` +
        `<b>ρ</b>=${st.rho.toFixed(3)} · <b>v</b>=${st.v.toFixed(4)} · ` +
        `<b>t<sub>р</sub></b>=${st.Td.toFixed(1)} · <b>t<sub>м</sub></b>=${st.Twb.toFixed(1)}`;
    }
  });
  // Цвет стрелки процесса
  S.procs.forEach((pr, i) => {
    const arr = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"] [data-role="arr"]`);
    if (arr) arr.style.color = PROC_COLOR[pr.type] || '#607080';
  });
}

/* Обновить подписи «автоматический V» под полями V, когда сегмент ведомый.
   Также кладём вычисленное V прямо в input.value (НЕ помечая как user),
   чтобы пользователь мог редактировать с текущего числа (стрелки/ввод). */
function refreshAutoV(segs, primaryIdx) {
  if (!segs) return;
  // v0.59.948: querySelectorAll — обновляем ВСЕ proc-arrow (модалка тоже).
  segs.forEach((s, i) => {
    const arrs = document.querySelectorAll(`.psy-proc-arrow[data-proc-idx="${i}"]`);
    arrs.forEach(arrEl => {
      const wrap = arrEl.querySelector(`[data-role="v-auto"]`);
      const inp  = arrEl.querySelector(`input[data-col="V"]`);
      if (!s) { if (wrap) wrap.textContent = ''; return; }
      if (s.derived) {
        if (wrap) { wrap.textContent = `авто: ${s.V.toFixed(0)} м³/ч (по массе)`; wrap.style.color = '#2e7d32'; }
        if (inp && inp.dataset.user !== '1') {
          if (document.activeElement !== inp) inp.value = s.V.toFixed(0);
          else if (inp.value.trim() === '') inp.value = s.V.toFixed(0);
        }
      } else {
        if (wrap) { wrap.textContent = `ведущий · Gда=${s.G.toFixed(0)} кг/ч`; wrap.style.color = '#1565c0'; }
      }
    });
  });
}

function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

/* ========================================================================
   Чтение DOM → state
   ======================================================================== */
function readInputs() {
  // Высота ↔ давление связаны симметрично (ISA/ГОСТ 4401-81):
  //   P(h) = P₀·(1 − 2,25577·10⁻⁵·h)^5,2559
  //   h(P) = (1 − (P/P₀)^(1/5,2559)) / 2,25577·10⁻⁵
  // Ведомым становится то поле, которое НЕ в фокусе.
  const altActive = document.activeElement?.id === 'psy-alt';
  const pActive   = document.activeElement?.id === 'psy-P-kpa';
  if (pActive && !altActive) {
    // Пользователь правит давление → пересчитываем высоту
    S.P = nNum($('psy-P-kpa').value, 101.325) * 1000;
    const r = S.P / 101325;
    S.alt = (r > 0 && r <= 1.5)
      ? (1 - Math.pow(r, 1 / 5.2559)) / 2.25577e-5
      : 0;
    $('psy-alt').value = Math.round(S.alt);
  } else {
    // В фокусе высота (или ни одно из двух) → давление ведомое
    S.alt = nNum($('psy-alt').value, 0);
    S.P = pressureAtAltitude(S.alt);
    $('psy-P-kpa').value = (S.P / 1000).toFixed(3);
  }
  S.rhMax  = nNum($('psy-rhmax').value, 100);
  // v0.59.911: tEvap-поле убрано из UI (ADP теперь per-process); читаем
  // из элемента если он есть (legacy), иначе используем сохранённое.
  const tevapEl = $('psy-tevap');
  if (tevapEl) S.tEvap = nNum(tevapEl.value, 15);
  S.vBase  = nNum($('psy-vbase').value, 10000);
  const tmin = nNum($('psy-tmin-chart')?.value, -15);
  const tmax = nNum($('psy-tmax-chart')?.value, 50);
  const dmax = nNum($('psy-dmax-chart')?.value, 30);
  if (tmin < tmax - 5) { S.tMinChart = tmin; S.tMaxChart = tmax; }
  if (dmax >= 5)       { S.dMaxChart = dmax; }

  // v0.59.940: подключаем также модалку редактора процесса — её inputs
  // ранее игнорировались (т.к. они не внутри #psy-cycle/#psy-edges), и
  // изменения в модалке не доезжали до cascade. По репорту: «параметры
  // внесенные в процесс не изменяют параметров точек которые зависят от
  // процесса».
  $$('#psy-cycle [data-col], #psy-edges [data-col], .psy-proc-edit-overlay [data-col]').forEach(el => {
    const col = el.dataset.col;
    const i   = +el.dataset.i;
    const v   = el.value;
    const isUser = el.dataset.user === '1';
    const ts = Number(el.dataset.ts) || 0;
    if (col === 'proc-type') { S.procs[i] = S.procs[i] || {}; S.procs[i].type = v; }
    else if (col === 'fromIdx') { S.procs[i] = S.procs[i] || {}; S.procs[i].fromIdx = parseInt(v, 10); }
    else if (col === 'toIdx')   { S.procs[i] = S.procs[i] || {}; S.procs[i].toIdx   = parseInt(v, 10); }
    else if (col === 'mixWith')   { S.procs[i] = S.procs[i] || {}; S.procs[i].mixWith   = v; }
    else if (col === 'mixRatio')  { S.procs[i] = S.procs[i] || {}; S.procs[i].mixRatio  = v; }
    else if (col === 'recupWith') { S.procs[i] = S.procs[i] || {}; S.procs[i].recupWith = v; }
    else if (col === 'recupEff')  { S.procs[i] = S.procs[i] || {}; S.procs[i].recupEff  = v; }
    else if (col === 'recupMode') { S.procs[i] = S.procs[i] || {}; S.procs[i].recupMode = v; }   // v0.59.931
    else if (col === 'adp')       { S.procs[i] = S.procs[i] || {}; S.procs[i].adp       = v; }   // v0.59.905 ADP coil
    else if (col === 'bf')        { S.procs[i] = S.procs[i] || {}; S.procs[i].bf        = v; }   // v0.59.905 Bypass Factor
    else if (col === 'Q' || col === 'qw') {
      S.procs[i] = S.procs[i] || {};
      if (isUser && v !== '') {
        S.procs[i][col] = v;
        S.procs[i][col + 's']  = true;    // *s — flag
        S.procs[i][col + 'ts'] = ts;
      } else {
        S.procs[i][col] = '';
        S.procs[i][col + 's']  = false;
        S.procs[i][col + 'ts'] = 0;
      }
    }
    else if (col === 'V') {
      // V принадлежит узлу-источнику ребра (fromIdx), а не номеру ребра.
      // Элемент управления стоит на карточке ребра, но данные пишем в узел.
      const pr = S.procs[i];
      const srcIdx = edgeFrom(pr, i);
      S.points[srcIdx] = S.points[srcIdx] || {};
      if (isUser && v !== '') S.points[srcIdx].V = v;
      else S.points[srcIdx].V = '';
    }
    else if (col === 'name' || col === 't' || col === 'rh' || col === 'x' || col === 'h') {
      S.points[i] = S.points[i] || {};
      if (isUser) {
        S.points[i][col] = v;
        S.points[i][col + 'User'] = true;
        if (col !== 'name') S.points[i][col + 'Ts'] = ts;
      } else {
        S.points[i][col + 'User'] = false;
        if (col !== 'name') S.points[i][col + 'Ts'] = 0;
      }
    }
  });
}

/* ========================================================================
   Forward-compute: по a (state) + proc (type+tgt+tgtVal) + V + P → state b
   ======================================================================== */
function forwardPoint(a, proc, V, P) {
  const tgt = proc.tgt;
  const val = nNum(proc.tgtVal);
  if (!tgt || !Number.isFinite(val)) return null;

  const Gda = V * a.rho / (1 + a.W);  // кг_да/ч (от точки a)
  let t2 = null, W2 = null, h2 = null;

  /* 1. Инвариант процесса */
  if (proc.type === 'P') W2 = a.W;
  else if (proc.type === 'A') h2 = a.h;
  else if (proc.type === 'S') t2 = a.T;
  // C и X — без жёсткого инварианта (C обработаем отдельно)

  /* 2. Цель */
  switch (tgt) {
    case 't2':  t2 = val; break;
    case 'dt':  t2 = a.T + val; break;
    case 'd2':  W2 = val / 1000; break;
    case 'dd':  W2 = a.W + val / 1000; break;
    case 'h2':  h2 = val; break;
    case 'dh':  h2 = a.h + val; break;
    case 'Q':   if (Gda > 0) h2 = a.h + val * 3600 / Gda; break;
    case 'qw':  if (Gda > 0) W2 = a.W + val / Gda; break;
    case 'phi2': {
      const phi = val / 100;
      if (proc.type === 'P') {
        const pv = a.W * P / (0.621945 + a.W);
        t2 = invertPws(pv / Math.max(1e-4, phi));
        W2 = a.W;
      } else if (proc.type === 'S') {
        t2 = a.T;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      } else if (proc.type === 'A') {
        let tt = a.T - 3;
        for (let it = 0; it < 40; it++) {
          const pv = phi * Pws(tt);
          const W_try = 0.621945 * pv / (P - pv);
          const h_try = 1.006 * tt + W_try * (2501 + 1.86 * tt);
          const tt2 = tt + 0.05;
          const pv2 = phi * Pws(tt2);
          const W2x = 0.621945 * pv2 / (P - pv2);
          const h2x = 1.006 * tt2 + W2x * (2501 + 1.86 * tt2);
          const f = h_try - a.h;
          const df = (h2x - h_try) / 0.05;
          if (Math.abs(df) < 1e-8) break;
          const s = f / df; tt -= s;
          if (Math.abs(s) < 1e-3) break;
        }
        t2 = tt;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      } else if (proc.type === 'C') {
        // C + φ2: охлаждение, конечная φ на насыщении — лучше сделать t2 из d=a.W
        t2 = invertPws((a.W * P / (0.621945 + a.W)) / Math.max(1e-4, phi));
        W2 = a.W;  // без осушения
      } else {
        // X: принимаем t2 = a.T (без изменения), W по φ
        t2 = a.T;
        const pv = phi * Pws(t2);
        W2 = 0.621945 * pv / (P - pv);
      }
      break;
    }
  }

  /* 3. Замыкание: h ↔ t/W */
  if (t2 == null && W2 != null && h2 != null) t2 = (h2 - 2501 * W2) / (1.006 + 1.86 * W2);
  if (W2 == null && t2 != null && h2 != null) W2 = (h2 - 1.006 * t2) / (2501 + 1.86 * t2);

  /* 3.5. Для C: если после применения цели остались h2 + ни t2 ни W2
     (например tgt=Q или tgt=h2) — предполагаем d=const (сенсибельное охл.).
     Если при этом t2 < Td → переключаемся на линию насыщения и ищем t,
     при котором h(t, Ws(t)) = h2 (охлаждение с осушением).
     Аналогично для P при неполном состоянии: считаем d=const. */
  if ((proc.type === 'C' || proc.type === 'P') && t2 == null && W2 == null && h2 != null) {
    W2 = a.W;
    t2 = (h2 - 2501 * W2) / (1.006 + 1.86 * W2);
    if (proc.type === 'C' && t2 < a.Td - 0.05) {
      // Newton по t на линии насыщения: h_sat(t) = 1.006·t + Ws(t)·(2501+1.86·t)
      let tt = a.Td - 1;
      for (let it = 0; it < 60; it++) {
        const Ws  = humidityRatio(tt, 1.0, P);
        const hh  = 1.006 * tt + Ws * (2501 + 1.86 * tt);
        const tt2 = tt + 0.05;
        const Ws2 = humidityRatio(tt2, 1.0, P);
        const hh2 = 1.006 * tt2 + Ws2 * (2501 + 1.86 * tt2);
        const f = hh - h2;
        const df = (hh2 - hh) / 0.05;
        if (Math.abs(df) < 1e-8) break;
        const s = f / df; tt -= s;
        if (Math.abs(s) < 1e-3) break;
      }
      t2 = tt;
      W2 = humidityRatio(t2, 1.0, P);
    }
  }

  /* 4. v0.59.905 (Bug-fix): C — модель ADP+BF (Apparatus Dew Point + Bypass Factor).
     Раньше: конденсат считался ТОЛЬКО когда t2_finalAir < a.Td. Это неверно —
     в реальном испарителе/охладителе часть воздуха ВСЕГДА проходит через
     поверхность теплообменника с T=ADP (если ADP<a.Td → конденсация на коил),
     остальной обходит (BF). Финальное состояние = смешение bypass + ADP-saturated.

     Если proc.adp задан И proc.adp < a.Td → применяем BF-модель:
       W_out = BF × W_in + (1-BF) × W_sat(ADP)
       T_out = BF × T_in + (1-BF) × ADP
     Если adp/bf не заданы — fallback на старую логику (контактное охлаждение).

     Поля процесса: proc.adp (°C), proc.bf (доля 0..1), proc.bf — default 0.15
     для типичного DX-coil (ASHRAE Handbook HVAC Systems and Equipment гл. 23).
  */
  if (proc.type === 'C') {
    const adpC = nNum(proc.adp);
    const bfRaw = nNum(proc.bf);
    const hasAdp = Number.isFinite(adpC);
    const bf = Number.isFinite(bfRaw) ? Math.max(0, Math.min(1, bfRaw)) : 0.15;
    if (hasAdp && adpC < a.Td - 0.01) {
      // BF-модель — корректный конденсат всегда когда ADP < Td_in
      const Wadp = humidityRatio(adpC, 1.0, P);
      // Если t2 не задан явно — рассчитаем по BF
      if (t2 == null) {
        t2 = bf * a.T + (1 - bf) * adpC;
      }
      // W_out — всегда по BF (даже если t2 задан явно — конденсат корректен)
      W2 = bf * a.W + (1 - bf) * Wadp;
    } else {
      // Контактная модель (fallback): t2 < Td → насыщение, иначе сенсибельное
      if (W2 == null && t2 != null) {
        if (t2 < a.Td - 0.05) W2 = humidityRatio(t2, 1.0, P);
        else W2 = a.W;
      }
      if (t2 == null && W2 != null) {
        if (W2 < a.W - 1e-6) t2 = dewPointFromW(W2, P);
        else t2 = a.T;
      }
    }
  }

  /* 5. X: если не хватает одной переменной — нельзя */
  if (proc.type === 'X') {
    if (t2 == null || W2 == null) return null;
  }

  if (t2 == null || W2 == null) return null;
  // Ограничиваем W в пределах насыщения (строгое условие)
  const Ws = humidityRatio(t2, 1.0, P);
  if (W2 > Ws * 1.001) W2 = Ws;
  if (W2 < 0) W2 = 0;
  return state(t2, Math.max(0, Math.min(1, RHfromW(t2, W2, P))), P);
}

/* ========================================================================
   Cascade: авто-имена + forward-compute точки 2+ если задана цель процесса
   ======================================================================== */
function cascade() {
  // Несколько проходов — чтобы рёбра R/M, ссылающиеся на узлы «ниже по
  // графу» (например, рекуператор приток↔вытяжка, где оба конца нужно
  // знать), сошлись. Для ациклических графов 1 прохода достаточно, для
  // циклов с ref-узлами — 3 прохода обычно хватает.
  for (let pass = 0; pass < 3; pass++) cascadePass();
}
function cascadePass() {
  const order = edgeOrder();
  for (const ei of order) {
    const proc = S.procs[ei] || { type: 'P' };
    const srcIdx = edgeFrom(proc, ei);
    const dstIdx = edgeTo(proc, ei);
    if (srcIdx === dstIdx) continue;
    const p = S.points[dstIdx];
    const src = S.points[srcIdx];
    if (!p || !src) continue;
    // Авто-имя. v0.59.946: для R-процесса определяем сторону рекуператора
    // (приток vs вытяжка) по имени src — иначе оба выхода называются
    // одинаково «После рекуператора», и непонятно где какой поток.
    // По репорту: «по рекуператору добавь однозначное понимание с какого
    // выхода, притока или вытяжки».
    if (!p.nameUser) {
      if (proc.type === 'R') {
        const srcName = (src.name || '').toLowerCase();
        const isSupply = /(нар(уж|ужн)|приток|свеж|улиц)/.test(srcName);
        const isExhaust = /(вытяжк|внутр|помещ|комн|зал|return)/.test(srcName);
        if (isSupply)      p.name = 'После рекуп. (приток)';
        else if (isExhaust) p.name = 'После рекуп. (вытяжка)';
        else                p.name = PROC_NAME_OUT.R;
      } else {
        p.name = PROC_NAME_OUT[proc.type] || '';
      }
    }
    const aState = pointState(src, S.P);
    if (!aState) continue;

    // «Индекс целевой точки» в формулах ниже — это dstIdx.
    // (переменная i ранее в этой функции — заменена на dstIdx).
    const i = dstIdx;

    // Процесс «смешение»: точка i = α·(точка srcIdx) + (1-α)·(точка mixWith),
    // mass-weighted по сухому воздуху.
    if (proc.type === 'M') {
      const refIdx = parseInt(proc.mixWith, 10);
      const alpha  = Math.max(0, Math.min(1, parseFloat(proc.mixRatio)));
      if (Number.isFinite(refIdx) && refIdx >= 0 && refIdx < S.points.length && refIdx !== i) {
        const bSrc = pointState(S.points[refIdx], S.P);
        if (bSrc && Number.isFinite(alpha)) {
          const W_mix = alpha * aState.W + (1 - alpha) * bSrc.W;
          const h_mix = alpha * aState.h + (1 - alpha) * bSrc.h;
          // Из h и W находим t: t = (h - 2501·W)/(1.006 + 1.86·W)
          const t_mix = (h_mix - 2501 * W_mix) / (1.006 + 1.86 * W_mix);
          const rh_mix = Math.max(0, Math.min(100, RHfromW(t_mix, W_mix, S.P) * 100));
          // Для смешения все поля точки i — «авто», user-input перекрывает
          const anyUser = p.tUser || p.rhUser || p.xUser || p.hUser;
          if (!anyUser) {
            p.t = Number(t_mix.toFixed(2));
            p.rh = Number(rh_mix.toFixed(2));
            p.x = Number((W_mix * 1000).toFixed(3));
            p.h = Number(h_mix.toFixed(3));
          }
          continue;
        }
      }
    }

    // Процесс «рекуператор»: t₂ = t₁ + η·(t_ref − t₁), W₂ = W₁.
    // Сенсибельная модель (без конденсата). Если t₂ опускается ниже точки
    // росы входа — clamp по насыщению при d=const (конденсация на пластинах
    // в данной MVP-модели игнорируется — это отдельная задача).
    if (proc.type === 'R') {
      const refIdx = parseInt(proc.recupWith, 10);
      const eta    = Math.max(0, Math.min(1, parseFloat(proc.recupEff)));
      if (Number.isFinite(refIdx) && refIdx >= 0 && refIdx < S.points.length && refIdx !== i) {
        const bSrc = pointState(S.points[refIdx], S.P);
        if (bSrc && Number.isFinite(eta)) {
          // v0.59.931: режим recovery — sensible (по T) или total (по T и W).
          // proc.recupMode: 'sensible' (default) | 'total' (энтальпийный).
          // Energy-recovery wheel может передавать и влагу — η_lat = η_sens
          // в первом приближении.
          const isTotal = proc.recupMode === 'total';
          const t2 = aState.T + eta * (bSrc.T - aState.T);
          let W2;
          if (isTotal) {
            // Энтальпийный — также передаём влагу с тем же η
            W2 = aState.W + eta * (bSrc.W - aState.W);
          } else {
            // Сенсибельный — d=const
            W2 = aState.W;
          }
          // v0.59.932: ВАЖНО — clamp к W_sat(t2) для ОБОИХ режимов.
          // Без этого при t2 < Td_in φ выходит >100% (как в скрине user'а где
          // точка 9 имела φ=200%). Физически — конденсация на пластинах,
          // W уменьшается до W_sat.
          const Wsat = humidityRatio(t2, 1.0, S.P);
          if (W2 > Wsat) W2 = Wsat;
          if (W2 < 0) W2 = 0;
          const rh2 = Math.max(0, Math.min(100, RHfromW(t2, W2, S.P) * 100));
          const h2  = 1.006 * t2 + W2 * (2501 + 1.86 * t2);
          const anyUser = p.tUser || p.rhUser || p.xUser || p.hUser;
          if (!anyUser) {
            p.t = Number(t2.toFixed(2));
            p.rh = Number(rh2.toFixed(2));
            p.x = Number((W2 * 1000).toFixed(3));
            p.h = Number(h2.toFixed(3));
          }
          continue;
        }
      }
    }

    // v0.59.936: C-процесс с заданным ADP — auto-apply BF-модель.
    // По репорту: «при таких параметрах, на теплообменнике охладителя
    // точно будет конденсат выпадать, а у тебя ни чего нет. Учти это»
    // и далее: «это фантомная точка, в которой происходит процесс совсем
    // другого охлаждения и смешения с воздухом который не успел охладиться
    // до температуры теплообменника».
    //
    // Раньше: cascade пропускал C-процесс если пользователь не задал явный
    // target (t2/φ2/Q/qw) → точка 2 оставалась с дефолтным W=W1 → ΔW=0 →
    // qw=0 (хотя физически конденсат ОБЯЗАН выпадать при ADP < Td_in).
    //
    // BF-модель: часть (1-BF) воздуха проходит через ADP-saturated state
    // (фантомная точка на кривой насыщения при T=ADP), часть BF обходит
    // коил без изменения. Финал = смешение:
    //   T_out = BF·T_in + (1-BF)·ADP
    //   W_out = BF·W_in + (1-BF)·W_sat(ADP)
    if (proc.type === 'C') {
      const adpC = nNum(proc.adp);
      const bfRaw = nNum(proc.bf);
      const bf = Number.isFinite(bfRaw) ? Math.max(0, Math.min(1, bfRaw)) : 0.15;
      const hasManualCand = (p.tUser || p.rhUser || p.xUser || p.hUser
                             || proc.Qs || proc.qws);
      if (Number.isFinite(adpC) && adpC < aState.Td - 0.01 && !hasManualCand) {
        const t2 = bf * aState.T + (1 - bf) * adpC;
        const Wadp = humidityRatio(adpC, 1.0, S.P);
        let W2 = bf * aState.W + (1 - bf) * Wadp;
        // Безопасный clamp до W_sat(t2) — не должно быть >100% RH.
        const Wsat2 = humidityRatio(t2, 1.0, S.P);
        if (W2 > Wsat2) W2 = Wsat2;
        if (W2 < 0) W2 = 0;
        const rh2 = Math.max(0, Math.min(100, RHfromW(t2, W2, S.P) * 100));
        const h2 = 1.006 * t2 + W2 * (2501 + 1.86 * t2);
        p.t  = Number(t2.toFixed(2));
        p.rh = Number(rh2.toFixed(2));
        p.x  = Number((W2 * 1000).toFixed(3));
        p.h  = Number(h2.toFixed(3));
        continue;
      }
    }

    // Собираем кандидаты на «цель» — всё, что пользователь задал вручную.
    // Побеждает самый свежий по timestamp.
    const cands = [];
    if (p.tUser  && p.t  !== '' && p.t  != null) cands.push({ tgt: 't2',   val: nNum(p.t),  ts: +p.tTs  || 0 });
    if (p.rhUser && p.rh !== '' && p.rh != null) cands.push({ tgt: 'phi2', val: nNum(p.rh), ts: +p.rhTs || 0 });
    if (p.xUser  && p.x  !== '' && p.x  != null) cands.push({ tgt: 'd2',   val: nNum(p.x),  ts: +p.xTs  || 0 });
    if (p.hUser  && p.h  !== '' && p.h  != null) cands.push({ tgt: 'h2',   val: nNum(p.h),  ts: +p.hTs  || 0 });
    if (proc.Qs  && proc.Q  !== '' && proc.Q  != null) cands.push({ tgt: 'Q',  val: nNum(proc.Q),  ts: +proc.Qts  || 0 });
    if (proc.qws && proc.qw !== '' && proc.qw != null) cands.push({ tgt: 'qw', val: nNum(proc.qw), ts: +proc.qwts || 0 });

    if (!cands.length) {
      // Нет ни одного пользовательского входа ни на точке, ни на процессе.
      // Оставляем точку как есть — ничего не «подсасываем» от предыдущей.
      continue;
    }

    cands.sort((a, b) => b.ts - a.ts);
    const winner = cands[0];

    // V сегмента — берём с узла-источника ребра
    let V_seg = nNum(src.V);
    if (!(V_seg > 0)) V_seg = S.vBase;

    // v0.59.955: Bug-fix — раньше forwardPoint получал ТОЛЬКО {type, tgt,
    // tgtVal} → proc.adp/bf/recupWith/recupEff/mixWith/mixRatio/recupMode
    // были недоступны → BF-модель охлаждения, R/M-вычисления не работали
    // через cascade pipeline. По репорту: «как так получается что я охлаждаю
    // воздух с 40 градусов до 22 с помощью DX кондиционера с поверхностью
    // 10 градусов, и у меня не выпадает конденсат». Передаём ПОЛНЫЙ proc
    // со spread, добавляя только tgt/tgtVal от winner-кандидата.
    const procForFP = { ...proc, tgt: winner.tgt, tgtVal: winner.val };
    const bState = forwardPoint(aState, procForFP, V_seg, S.P);
    if (!bState) continue;

    // Победитель остаётся user; остальные кандидаты — пересчитываются (user=false).
    ['t','rh','x','h'].forEach(f => {
      const tgtMap = { t:'t2', rh:'phi2', x:'d2', h:'h2' };
      if (tgtMap[f] !== winner.tgt) { p[f + 'User'] = false; p[f + 'Ts'] = 0; }
    });
    if (winner.tgt !== 'Q')  { proc.Qs  = false; proc.Qts  = 0; proc.Q  = ''; }
    if (winner.tgt !== 'qw') { proc.qws = false; proc.qwts = 0; proc.qw = ''; }

    writeComputed(p, bState);

    // «Победитель» сам себя не перезаписывает (user-значение сохраняется как есть).
    if (winner.tgt === 't2')   { p.t  = nNum(p.t); }
    if (winner.tgt === 'phi2') { p.rh = nNum(p.rh); }
    if (winner.tgt === 'd2')   { p.x  = nNum(p.x); }
    if (winner.tgt === 'h2')   { p.h  = nNum(p.h); }
  }
}

/* Записать все поля t/rh/x/h в точку из state (без поднятия user). */
function writeComputed(p, st) {
  p.t  = Number(st.T.toFixed(2));
  p.rh = Number(st.RH.toFixed(2));
  p.x  = Number((st.W * 1000).toFixed(3));
  p.h  = Number(st.h.toFixed(3));
}


/* Для каждой точки: если pointState валиден и d/h не введены пользователем —
   вписываем вычисленные значения в p.x / p.h (без user-флага). Это нужно,
   чтобы в input-полях «d» и «h» отображались посчитанные значения, а не
   placeholder «авто». */
function fillComputedDH() {
  S.points.forEach(p => {
    const st = pointState(p, S.P);
    if (!st) return;
    if (!p.xUser) p.x = Number((st.W * 1000).toFixed(3));
    if (!p.hUser) p.h = Number(st.h.toFixed(3));
    // Заодно синхронизируем t/rh, если они не введены пользователем
    // (например после override по d — φ пересчитался)
    if (!p.tUser)  p.t  = Number(st.T.toFixed(2));
    if (!p.rhUser) p.rh = Number(st.RH.toFixed(2));
  });
}

/* Записывает S.points значения в DOM input'ы (только auto-поля). */
function writeCardsFromState() {
  S.points.forEach((p, i) => {
    const card = document.querySelector(`.psy-point[data-point-idx="${i}"]`);
    if (!card) return;
    ['name','t','rh','x','h'].forEach(col => {
      const inp = card.querySelector(`[data-col="${col}"]`);
      if (!inp) return;
      // S — источник истины. Синхронизируем data-user/data-ts.
      if (!p[col + 'User']) { inp.dataset.user = ''; inp.dataset.ts = '0'; }
      const isUser = inp.dataset.user === '1';
      if (isUser) return;
      if (document.activeElement === inp) return;
      const v = p[col];
      inp.value = (v == null || v === '') ? '' : String(v);
    });
  });
  // Стрелки: синхронизируем Q, qw (user/ts) с моделью
  S.procs.forEach((pr, i) => {
    const arr = document.querySelector(`.psy-proc-arrow[data-proc-idx="${i}"]`);
    if (!arr) return;
    ['Q','qw'].forEach(col => {
      const inp = arr.querySelector(`input[data-col="${col}"]`);
      if (!inp) return;
      const userFlag = col === 'Q' ? pr.Qs : pr.qws;
      if (!userFlag) {
        inp.dataset.user = ''; inp.dataset.ts = '0';
        if (document.activeElement !== inp) inp.value = '';
      }
    });
  });
}

/* ========================================================================
   Считаем все точки; для каждого процесса — тепло и влагоприток
   ======================================================================== */
function computeCycle() {
  const sts = S.points.map(p => pointState(p, S.P));
  const segs = new Array(S.procs.length).fill(null);

  /* Графовая модель: «ведущим» считаем первый в edgeOrder() сегмент, у
     источника которого задан V. Если нигде не задан — G_ref от S.vBase
     на самом раннем валидном источнике. */
  const order = edgeOrder();
  let primaryEdgeIdx = -1;   // индекс S.procs, не ei
  for (const ei of order) {
    const pr = S.procs[ei];
    const srcIdx = edgeFrom(pr, ei);
    if (nNum(S.points[srcIdx]?.V) > 0 && sts[srcIdx]) { primaryEdgeIdx = ei; break; }
  }
  let G_ref = 0;
  if (primaryEdgeIdx >= 0) {
    const pr = S.procs[primaryEdgeIdx];
    const srcIdx = edgeFrom(pr, primaryEdgeIdx);
    const a = sts[srcIdx];
    const V = nNum(S.points[srcIdx].V);
    G_ref = V * a.rho / (1 + a.W);
  } else {
    // fallback: на первом узле первого ребра в edgeOrder
    for (const ei of order) {
      const srcIdx = edgeFrom(S.procs[ei], ei);
      if (sts[srcIdx]) { G_ref = S.vBase * sts[srcIdx].rho / (1 + sts[srcIdx].W); break; }
    }
  }

  S.procs.forEach((pr, ei) => {
    const srcIdx = edgeFrom(pr, ei);
    const dstIdx = edgeTo(pr, ei);
    const a = sts[srcIdx], b = sts[dstIdx];
    if (!a || !b || srcIdx === dstIdx) { segs[ei] = null; return; }
    const userV = nNum(S.points[srcIdx]?.V);
    // Если у источника ребра задан V — используем его напрямую (ветки с
    // разным расходом, например свежий воздух 300 vs рециркуляция 50000).
    // Иначе — производный от G_ref главного сегмента (прежняя модель
    // сохранения массы для линейной цепочки).
    const hasOwnV = Number.isFinite(userV) && userV > 0;
    let V;
    if (hasOwnV) V = userV;
    else if (G_ref > 0) V = G_ref * (1 + a.W) / a.rho;
    else V = S.vBase;
    const G  = V * a.rho / (1 + a.W);
    const Q  = processPowerKW(a, b, V);
    const qw = processMoistureKgH(a, b, V);
    segs[ei] = {
      type: pr.type, V, Q, qw, G,
      derived: !hasOwnV,
      fromIdx: srcIdx, toIdx: dstIdx,
      dT: +(b.T - a.T).toFixed(2),
      dW: +((b.W - a.W)*1000).toFixed(3),
      dh: +(b.h - a.h).toFixed(2),
    };
  });
  return { sts, segs, primaryIdx: primaryEdgeIdx };
}

/* ========================================================================
   Рендер результатов
   ======================================================================== */
function renderResults(sts, segs) {
  const b1 = $('psy-output-body'); b1.innerHTML = '';
  sts.forEach((st, i) => {
    const name = S.points[i].name || `P${i+1}`;
    const warn = st && st.RH > S.rhMax + 0.1
      ? ` style="background:#ffebee;color:#c62828;"` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td${warn}>${i+1}</td><td>${escHtml(name)}</td>
      ${st ? `
        <td>${st.T.toFixed(1)}</td>
        <td>${st.RH.toFixed(1)}</td>
        <td>${(st.W*1000).toFixed(2)}</td>
        <td>${st.h.toFixed(2)}</td>
        <td>${st.rho.toFixed(3)}</td>
        <td>${st.v.toFixed(4)}</td>
        <td>${st.Td.toFixed(1)}</td>
        <td>${st.Twb.toFixed(1)}</td>
      ` : `<td colspan="8" style="text-align:center;color:#999">—</td>`}
    `;
    b1.appendChild(tr);
  });

  const b2 = $('psy-proc-body'); b2.innerHTML = '';
  let sumQheat = 0, sumQcool = 0, sumQwHum = 0, sumQwDeh = 0;
  segs.forEach((s) => {
    if (!s) return;
    if (s.Q > 0)  sumQheat += s.Q;
    if (s.Q < 0)  sumQcool += -s.Q;
    if (s.qw > 0) sumQwHum += s.qw;
    if (s.qw < 0) sumQwDeh += -s.qw;
  });
  segs.forEach((s, i) => {
    const pr = S.procs[i] || {};
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    if (!s) {
      b2.insertAdjacentHTML('beforeend',
        `<tr><td>${fromI+1}→${toI+1}</td><td colspan="9" style="text-align:center;color:#999">—</td></tr>`);
      return;
    }
    const label = PROC_TYPES.find(p => p.v === s.type)?.t || s.type;
    const sign  = s.Q > 0.05 ? 'нагрев/увл.' : s.Q < -0.05 ? 'охл./осуш.' : '≈0';
    b2.insertAdjacentHTML('beforeend', `
      <tr style="background:${PROC_COLOR[s.type]||'#eee'}14">
        <td>${fromI+1}→${toI+1}</td><td>${label}</td>
        <td>${s.V.toFixed(0)}</td>
        <td>${s.dT.toFixed(2)}</td>
        <td>${s.dW.toFixed(3)}</td>
        <td>${s.dh.toFixed(2)}</td>
        <td>${s.G.toFixed(0)}</td>
        <td style="color:${s.Q>0?'#c62828':'#0277bd'};font-weight:600">${s.Q.toFixed(2)}</td>
        <td style="color:${s.qw>0?'#2e7d32':'#6a1b9a'}">${s.qw.toFixed(3)}</td>
        <td style="font-size:10px;color:#555">${sign}</td>
      </tr>
    `);
  });
  // Итоговая строка: суммы Q (нагрев / охл) и qw (увл / осуш)
  const anyProc = segs.some(s => s);
  if (anyProc) {
    // Конденсат = |суммарное осушение| в кг/ч, л/ч, л/сут.
    const condKgH = sumQwDeh;
    const condLph = condKgH / 0.998;
    const condLpd = condLph * 24;
    b2.insertAdjacentHTML('beforeend', `
      <tr style="background:#eceff1;font-weight:700;border-top:2px solid #90a4ae">
        <td colspan="7" style="text-align:right;color:#37474f">ИТОГО по циклу:</td>
        <td style="color:#c62828" title="Суммарная мощность нагрева/увл. (Q>0)">
          +${sumQheat.toFixed(2)}<br><span style="font-weight:400;font-size:10px;color:#0277bd">−${sumQcool.toFixed(2)}</span>
        </td>
        <td style="color:#2e7d32" title="Суммарный влагоприток (qw>0) / осушение (qw<0)">
          +${sumQwHum.toFixed(3)}<br><span style="font-weight:400;font-size:10px;color:#6a1b9a">−${sumQwDeh.toFixed(3)}</span>
        </td>
        <td style="font-size:10px;color:#37474f">нагрев/охл.<br>увл./осуш.</td>
      </tr>
      ${condKgH > 0.001 ? `
      <tr style="background:#e1f5fe;border-top:1px solid #4fc3f7">
        <td colspan="7" style="text-align:right;color:#01579b;font-weight:700">💧 Конденсат (суммарно по осушению):</td>
        <td colspan="3" style="color:#01579b;font-weight:700">
          ${condKgH.toFixed(3)} кг/ч ≈ ${condLph.toFixed(3)} л/ч ≈ ${condLpd.toFixed(1)} л/сут
        </td>
      </tr>` : ''}
    `);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

/* ========================================================================
   Диаграмма
   ======================================================================== */

// v0.59.937: каталог зон с ПОЛНЫМИ ASHRAE TC 9.9 (2021) bounds:
//   Tmin/Tmax — DB (dry-bulb) пределы
//   RHmin/RHmax — относительная влажность
//   TdMin/TdMax — точка росы (dew-point) — КРИТИЧНО для правильной формы.
// По репорту: «в оригинале линия не идет до пересечения с линией влажности,
// а заканчивается гораздо раньше». Раньше зона рисовалась как прямоугольник
// T × RH — верхний правый угол выходил за реальный максимум Td (например
// для Recommended W при T=27, RH=60% получалось ~0.0135 кг/кг = Td≈18.5°C,
// а в спеке TC 9.9 макс Td для Recommended = 15°C). На i-d это видно как
// зону, перерезающую больше, чем должна.
//
// Финальная форма envelope = пересечение четырёх ограничений:
//   T ∈ [Tmin, Tmax]
//   RH ∈ [RHmin, RHmax]    (W ≥ W(T, RHmin), W ≤ W(T, RHmax))
//   Td ∈ [TdMin, TdMax]    (W ≥ W_sat(TdMin), W ≤ W_sat(TdMax))
const COMFORT_ZONES = {
  'ashrae55':  { Tmin: 23, Tmax: 26, RHmin: 0.30, RHmax: 0.60, TdMin: 4,   TdMax: 17, label: 'ASHRAE 55',          stroke: '#16a34a', fill: 'rgba(22,163,74,0.12)' },
  'tc99-rec':  { Tmin: 18, Tmax: 27, RHmin: 0.0,  RHmax: 0.60, TdMin: 5.5, TdMax: 15, label: 'TC 9.9 Recommended', stroke: '#15803d', fill: 'rgba(22,163,74,0.12)' },
  'tc99-a1':   { Tmin: 15, Tmax: 32, RHmin: 0.08, RHmax: 0.80, TdMin: -12, TdMax: 17, label: 'TC 9.9 A1',          stroke: '#1e40af', fill: 'rgba(59,130,246,0.10)' },
  'tc99-a2':   { Tmin: 10, Tmax: 35, RHmin: 0.08, RHmax: 0.80, TdMin: -12, TdMax: 21, label: 'TC 9.9 A2',          stroke: '#7c3aed', fill: 'rgba(124,58,237,0.10)' },
  'tc99-a3':   { Tmin:  5, Tmax: 40, RHmin: 0.08, RHmax: 0.85, TdMin: -12, TdMax: 24, label: 'TC 9.9 A3',          stroke: '#b45309', fill: 'rgba(180,83,9,0.10)' },
  'tc99-a4':   { Tmin:  5, Tmax: 45, RHmin: 0.08, RHmax: 0.90, TdMin: -12, TdMax: 24, label: 'TC 9.9 A4',          stroke: '#b91c1c', fill: 'rgba(185,28,28,0.10)' },
};

/* v0.59.942: позиция текстовой метки зоны = верхний-правый угол реальной
   (clipped) envelope. С учётом Td-bound: W_corner = min(W(Tmax, RHmax),
   W_sat(TdMax)). Раньше использовалось (Tmax, RHmax) без clipping → при
   stack-mode TC 9.9 метки A1/A2/A3/A4 уходили в пустую область выше
   фактических envelopes. */
function zoneLabelPos(z, P, pos) {
  const W_rh = humidityRatio(z.Tmax, z.RHmax, P);
  const W_td = Number.isFinite(z.TdMax) ? humidityRatio(z.TdMax, 1.0, P) : Infinity;
  const W_corner = Math.min(W_rh, W_td);
  return pos(W_corner, z.Tmax);
}

function computeComfortZonePolygon(P, pos, zoneId) {
  const z = COMFORT_ZONES[zoneId];
  if (!z) return null;
  // v0.59.937: envelope = AND по 4-м constraints. На каждом T ∈ [Tmin, Tmax]
  // вычисляем верхнюю и нижнюю границу W:
  //   W_low(T)  = max( W(T, RHmin),  W_sat(TdMin) )   ← если RHmin задано
  //   W_high(T) = min( W(T, RHmax),  W_sat(TdMax) )
  // Если W_low > W_high при данном T — точка вне envelope (не добавляем).
  // Затем строим polygon: нижняя кривая слева→направо + верхняя кривая
  // справа→налево. Точки T_in/T_out на пересечении constraints находятся
  // автоматически (просто отсекаем участок где low>high).
  try {
    const Tstep = 0.5;
    const Wsat = (T) => humidityRatio(T, 1.0, P);
    const Wlow = (T) => Math.max(
      humidityRatio(T, z.RHmin || 0, P),
      Number.isFinite(z.TdMin) ? Wsat(z.TdMin) : 0
    );
    const Whigh = (T) => Math.min(
      humidityRatio(T, z.RHmax, P),
      Number.isFinite(z.TdMax) ? Wsat(z.TdMax) : Infinity
    );
    // Bottom curve: T от Tmin до Tmax, W = W_low(T)
    const bottom = [];
    for (let T = z.Tmin; T <= z.Tmax + 1e-3; T += Tstep) {
      const T_ = Math.min(T, z.Tmax);
      const wl = Wlow(T_), wh = Whigh(T_);
      if (wl <= wh + 1e-9) bottom.push([T_, wl]);
    }
    // Top curve: T от Tmax до Tmin (обратный обход), W = W_high(T)
    const top = [];
    for (let T = z.Tmax; T >= z.Tmin - 1e-3; T -= Tstep) {
      const T_ = Math.max(T, z.Tmin);
      const wl = Wlow(T_), wh = Whigh(T_);
      if (wl <= wh + 1e-9) top.push([T_, wh]);
    }
    if (bottom.length < 2 || top.length < 2) return null;
    const corners = [...bottom, ...top];
    const pts = corners.map(([T, W]) => {
      const [x, y] = pos(W, T);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { points: pts.join(' '), zone: z };
  } catch { return null; }
}

let _chartCtx = null;
let _activePoint = null;
function renderChart(sts) {
  const host = $('psy-chart');
  const dims = chartPageDims();
  // v0.59.940: layout переключается по ориентации.
  //   landscape → ASHRAE-style (T-горизонт, W-вертикаль справа)
  //   portrait  → Mollier-Ramzin (W-горизонт, T-вертикаль слева)
  const chartStyle = (S.chartOrient === 'landscape') ? 'ashrae' : 'ramzin';
  const { svg, X, Y, pos, inv, opts, style } = render(null, {
    P: S.P,
    T_min: S.tMinChart, T_max: S.tMaxChart,
    W_max: S.dMaxChart / 1000,
    width: dims.w, height: dims.h,
    style: chartStyle,
  });
  const ctx = { X, Y, pos, inv, style, opts };
  _chartCtx = { X, Y, pos, inv, opts, style };
  let overlay = arrowDefs();

  const zoneId = S.comfortZoneId || (S.showComfortZone !== false ? 'tc99-rec' : '');
  if (zoneId === 'tc99-all') {
    const stack = ['tc99-a4', 'tc99-a3', 'tc99-a2', 'tc99-a1', 'tc99-rec'];
    for (const id of stack) {
      const cz = computeComfortZonePolygon(S.P, pos, id);
      if (!cz) continue;
      const z = cz.zone;
      // v0.59.942: метка зоны — в АКТУАЛЬНОМ верхнем-правом углу envelope.
      // Раньше использовалось (Tmax, RHmax) → с введением Td-clamping
      // (v0.59.938) этот угол часто ВЫШЕ реальной envelope (W_high =
      // min(W_RH(Tmax,RHmax), W_sat(TdMax))) → метки уезжали в пустоту.
      const [labelXc, labelYc] = zoneLabelPos(z, S.P, pos);
      overlay += `<g class="psy-comfort-zone" pointer-events="none">
        <polygon points="${cz.points}" fill="none" stroke="${z.stroke}" stroke-width="1.4"/>
        <text x="${labelXc - 4}" y="${labelYc - 4}" text-anchor="end" font-size="11" fill="${z.stroke}" font-weight="700"
              paint-order="stroke" stroke="#fff" stroke-width="2.5">${escAttr(z.label.replace('TC 9.9 ', ''))}</text>
      </g>`;
    }
  } else if (zoneId) {
    const cz = computeComfortZonePolygon(S.P, pos, zoneId);
    if (cz) {
      const z = cz.zone;
      const [labelXc, labelYc] = zoneLabelPos(z, S.P, pos);
      overlay += `<g class="psy-comfort-zone" pointer-events="none">
        <polygon points="${cz.points}" fill="${z.fill}" stroke="${z.stroke}" stroke-width="1" stroke-dasharray="5,3"/>
        <text x="${labelXc - 4}" y="${labelYc - 4}" text-anchor="end" font-size="10" fill="${z.stroke}" font-weight="700"
              paint-order="stroke" stroke="#fff" stroke-width="2.5">${escAttr(z.label)}</text>
      </g>`;
    }
  }

  // crosshair layer (обновляется в mousemove)
  overlay += `<g id="psy-xhair" style="display:none;pointer-events:none;">
    <line class="psy-xh-v" stroke="#c62828" stroke-width="0.6" stroke-dasharray="3,2"/>
    <line class="psy-xh-h" stroke="#c62828" stroke-width="0.6" stroke-dasharray="3,2"/>
    <circle class="psy-xh-dot" r="3" fill="#c62828" stroke="#fff" stroke-width="1"/>
  </g>`;
  // v0.59.936: сегменты — по всем рёбрам графа.
  // Если два процесса используют ОДНУ И ТУ ЖЕ пару точек (например, 1→2
  // охлаждение и 2→1 нагрев в open-loop замкнутом цикле), они визуально
  // ложатся друг на друга и видим только последний. Сдвигаем такие
  // дубликаты перпендикулярно оси соединения на ±OFFSET, чтобы оба были
  // видны.
  const PAIR_OFFSET_PX = 6;
  const segCounts = new Map();
  const segIdx = new Map();
  for (let i = 0; i < S.procs.length; i++) {
    const pr = S.procs[i] || {};
    const fromI = edgeFrom(pr, i);
    const toI   = edgeTo(pr, i);
    if (pr.type === 'none' || fromI === toI) continue;
    // Канонический ключ пары — независимо от направления (для подсчёта).
    const key = fromI < toI ? `${fromI}-${toI}` : `${toI}-${fromI}`;
    segCounts.set(key, (segCounts.get(key) || 0) + 1);
  }

  const badges = [];
  for (let i = 0; i < S.procs.length; i++) {
    const pr = S.procs[i] || { type: 'P' };
    const fromI = edgeFrom(pr, i);
    const toI   = edgeTo(pr, i);
    const a = sts[fromI], b = sts[toI];
    if (!a || !b || pr.type === 'none' || fromI === toI) continue;
    const color = PROC_COLOR[pr.type] || '#0d47a1';
    // Считаем смещение для дубликата
    const key = fromI < toI ? `${fromI}-${toI}` : `${toI}-${fromI}`;
    const total = segCounts.get(key) || 1;
    const idx = (segIdx.get(`${i}-${key}`) || segIdx.size) % total;
    segIdx.set(`${i}-${key}`, idx);
    let dx = 0, dy = 0;
    const [ax, ay] = pos(a.W, a.T);
    const [bx, by] = pos(b.W, b.T);
    if (total > 1) {
      const sign = fromI < toI ? 1 : -1;
      const dxLine = bx - ax, dyLine = by - ay;
      const len = Math.max(1, Math.hypot(dxLine, dyLine));
      const nx = -dyLine / len, ny = dxLine / len;
      dx = sign * PAIR_OFFSET_PX * nx;
      dy = sign * PAIR_OFFSET_PX * ny;
    }
    overlay += drawProcessPath(ctx, a, b, pr.type, color, pr, { dx, dy });
    if (pr.type === 'M' || pr.type === 'R') {
      const refKey = pr.type === 'M' ? pr.mixWith : pr.recupWith;
      const refIdx = parseInt(refKey, 10);
      if (Number.isFinite(refIdx) && sts[refIdx]) {
        const r = sts[refIdx];
        const [rx, ry] = pos(r.W, r.T);
        overlay += `<line x1="${rx}" y1="${ry}" x2="${bx}" y2="${by}"
                     stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>`;
      }
    }
    const mx = (ax + bx) / 2 + dx;
    const my = (ay + by) / 2 + dy;
    // v0.59.936: подпись имени процесса под бейджем (короткое чтение типа,
    // чтобы было ясно кому P/C/A/S/M/R соответствует — иначе буква без
    // контекста). По репорту: «не видно название второго процесса».
    const PROC_SHORT_NAME = {
      P: 'Нагрев', C: 'Охлаждение', A: 'Адиабат. увл.',
      S: 'Пар. увл.', M: 'Смешение', R: 'Рекуператор', X: 'Своб.',
    };
    const procName = pr.name || PROC_SHORT_NAME[pr.type] || '';
    badges.push({ x: mx, y: my, type: pr.type, color, name: procName });
  }
  badges.forEach(b => {
    overlay += `<g transform="translate(${b.x},${b.y})">
      <circle r="8" fill="#fff" stroke="${b.color}" stroke-width="1.5"/>
      <text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="${b.color}">${b.type}</text>
      ${b.name ? `<text y="22" text-anchor="middle" font-size="9" fill="${b.color}" font-weight="600"
        paint-order="stroke" stroke="#fff" stroke-width="2.5">${escAttr(b.name)}</text>` : ''}
    </g>`;
  });
  // Кольцо-подсветка активной точки (если карточка в фокусе)
  if (Number.isFinite(_activePoint) && sts[_activePoint]) {
    const st = sts[_activePoint];
    const [px, py] = pos(st.W, st.T);
    overlay += `<circle cx="${px}" cy="${py}" r="10" fill="none"
                 stroke="#ff6f00" stroke-width="2" opacity="0.85">
                <animate attributeName="r" values="10;14;10" dur="1.4s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.85;0.35;0.85" dur="1.4s" repeatCount="indefinite"/>
               </circle>`;
  }
  let nPlotted = 0;
  sts.forEach((st, i) => {
    if (!st) return;
    overlay += plotPoint(ctx, st, String(i+1), '#0d47a1');
    nPlotted++;
  });
  // Легенда с детальными параметрами всех точек — в правый нижний угол
  if (nPlotted > 0) {
    overlay += plotLegend(opts, sts, S.points.map(p => p.name || ''));
  }
  // Фолбэк: цикл пуст или все точки без t/φ — показываем подсказку
  if (nPlotted === 0) {
    const cx = (opts.marginL + (opts.width - opts.marginR)) / 2;
    const cy = (opts.marginT + (opts.height - opts.marginB)) / 2;
    overlay += `<g pointer-events="none">
      <rect x="${cx-220}" y="${cy-40}" width="440" height="80" rx="6"
            fill="#fff" stroke="#c62828" stroke-width="1.2" opacity="0.95"/>
      <text x="${cx}" y="${cy-10}" text-anchor="middle" font-size="14" font-weight="700" fill="#c62828">Нет точек на диаграмме</text>
      <text x="${cx}" y="${cy+12}" text-anchor="middle" font-size="11" fill="#37474f">Задайте t и φ хотя бы в одной карточке или выберите «Демо-цикл»</text>
    </g>`;
  }
  host.innerHTML = svg.replace('</svg>', overlay + '</svg>');
  // Readout overlay (div над svg)
  let readout = host.querySelector('.psy-xh-readout');
  if (!readout) {
    readout = document.createElement('div');
    readout.className = 'psy-xh-readout';
    readout.style.cssText = 'position:absolute;pointer-events:none;background:rgba(255,255,255,0.95);border:1px solid #c62828;border-radius:3px;padding:3px 6px;font:11px/1.4 Consolas,monospace;color:#263238;display:none;box-shadow:0 1px 3px rgba(0,0,0,0.15);white-space:nowrap;z-index:5;';
    host.style.position = 'relative';
    host.appendChild(readout);
  }
  attachCrosshair(host);
  // v0.59.935: нормализуем размер текста SVG под фактический display-scale,
  // чтобы шрифты на диаграмме визуально совпадали с шрифтом страницы
  // (а не «съёживались» в маленьком окне и не «гипертрофировались» в большом).
  normalizeChartFontSizes(host);
  if (!host._fsResizeWired) {
    host._fsResizeWired = true;
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => normalizeChartFontSizes(host));
    });
  }
}

// v0.59.935: пересчитывает font-size у каждого <text> в SVG диаграммы так,
// чтобы визуальный размер на экране = «дизайн-size» × bodyFont/12px ratio,
// независимо от того, насколько SVG отмасштабирован относительно viewBox.
//   designed (user units) = base_target_px / display_scale
// где display_scale = svgRect.width / viewBox.width.
// Дизайн-size читаем из computedStyle при первом проходе и кэшируем
// в data-psy-fs-base, чтобы повторные вызовы не «накручивали» множитель.
function normalizeChartFontSizes(host) {
  const svg = host.querySelector('svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const vbW = svg.viewBox?.baseVal?.width || 0;
  if (!rect.width || !vbW) return;
  const scale = rect.width / vbW;
  if (!Number.isFinite(scale) || scale <= 0) return;
  // Целимся в визуальный размер, близкий к шрифту страницы (body/14px).
  // Соотношения дизайн-сайзов (9/10/11/12) сохраняем — масштабируем все
  // одинаковым коэффициентом targetBase / 12, где 12 — наш «нормальный»
  // дизайн-размер.
  const bodyFs = parseFloat(getComputedStyle(document.body).fontSize) || 14;
  const TARGET_BASE_PX = bodyFs;  // 12-px дизайн → bodyFs визуально
  const inv = 1 / scale;
  const ratio = TARGET_BASE_PX / 12;
  svg.querySelectorAll('text').forEach(t => {
    let designed = parseFloat(t.dataset.psyFsBase || '');
    if (!Number.isFinite(designed) || designed <= 0) {
      // Первый вызов — фиксируем исходный font-size (в user-units).
      designed = parseFloat(getComputedStyle(t).fontSize) || 12;
      t.dataset.psyFsBase = String(designed);
    }
    const px = designed * ratio * inv;
    t.style.fontSize = px.toFixed(2) + 'px';
  });
}

function attachCrosshair(host) {
  if (host._xhWired) return;
  host._xhWired = true;
  const onMove = (e) => {
    if (!_chartCtx) return;
    const svg = host.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = vb.width / rect.width, sy = vb.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top)  * sy;
    const { opts } = _chartCtx;
    const plotW = opts.width - opts.marginL - opts.marginR;
    const plotH = opts.height - opts.marginT - opts.marginB;
    // v0.59.940: используем ctx.inv для обоих layouts (ramzin/ashrae).
    const { W, T } = _chartCtx.inv ? _chartCtx.inv(px, py) : {
      W: opts.W_min + (px - opts.marginL) / plotW * (opts.W_max - opts.W_min),
      T: opts.T_max - (py - opts.marginT) / plotH * (opts.T_max - opts.T_min),
    };
    const g = svg.querySelector('#psy-xhair');
    const readout = host.querySelector('.psy-xh-readout');
    // Вне поля графика — скрыть
    if (W < opts.W_min || W > opts.W_max || T < opts.T_min || T > opts.T_max) {
      if (g) g.style.display = 'none';
      if (readout) readout.style.display = 'none';
      return;
    }
    // Обновляем крестик
    if (g) {
      g.style.display = '';
      const v = g.querySelector('.psy-xh-v');
      const h = g.querySelector('.psy-xh-h');
      const d = g.querySelector('.psy-xh-dot');
      v.setAttribute('x1', px); v.setAttribute('x2', px);
      v.setAttribute('y1', opts.marginT); v.setAttribute('y2', opts.marginT + plotH);
      h.setAttribute('y1', py); h.setAttribute('y2', py);
      h.setAttribute('x1', opts.marginL); h.setAttribute('x2', opts.marginL + plotW);
      d.setAttribute('cx', px); d.setAttribute('cy', py);
    }
    // Значения: W -> pv -> phi; h; rho. φ в физическом диапазоне [0..100].
    // Если точка выше линии насыщения — это «перенасыщ.» (нефизично).
    const pv = W * S.P / (0.621945 + W);
    const phi_raw = 100 * pv / Pws(T);
    const phi = Math.max(0, Math.min(100, phi_raw));
    const supersat = phi_raw > 100.5;
    const h_v = 1.006 * T + W * (2501 + 1.86 * T);
    const v_sp = 287.055 * (T + 273.15) * (1 + 1.6078 * W) / S.P;
    const rho = (1 + W) / v_sp;
    const Td = (phi > 0.01) ? dewPointFromW(W, S.P) : -999;
    if (readout) {
      const ru = S.showRuNames;
      const phiStr = supersat
        ? `<span style="color:#c62828">перенасыщ. (выше φ=100%)</span>`
        : `${phi.toFixed(1)} %`;
      readout.innerHTML =
        `<b>t</b>${ru?' (темп.)':''} = ${T.toFixed(1)} °C<br>` +
        `<b>d</b>${ru?' (влагосодерж.)':''} = ${(W*1000).toFixed(2)} г/кг<br>` +
        `<b>φ</b>${ru?' (отн. влажн.)':''} = ${phiStr}<br>` +
        `<b>h</b>${ru?' (энтальпия)':''} = ${h_v.toFixed(2)} кДж/кг<br>` +
        `<b>ρ</b>${ru?' (плотность)':''} = ${rho.toFixed(3)} кг/м³` +
        (Td > -900 && !supersat ? `<br><b>t<sub>р</sub></b>${ru?' (точка росы)':''} = ${Td.toFixed(1)} °C` : '');
      // позиция: смещаем от курсора, учитываем границы
      const hostRect = host.getBoundingClientRect();
      let lx = e.clientX - hostRect.left + 12;
      let ly = e.clientY - hostRect.top + 12;
      readout.style.display = 'block';
      // после display считаем размер
      const rw = readout.offsetWidth, rh = readout.offsetHeight;
      if (lx + rw > hostRect.width - 4)  lx = e.clientX - hostRect.left - rw - 12;
      if (ly + rh > hostRect.height - 4) ly = e.clientY - hostRect.top - rh - 12;
      readout.style.left = lx + 'px';
      readout.style.top  = ly + 'px';
    }
  };
  const onLeave = () => {
    const svg = host.querySelector('svg');
    const g = svg && svg.querySelector('#psy-xhair');
    if (g) g.style.display = 'none';
    const readout = host.querySelector('.psy-xh-readout');
    if (readout) readout.style.display = 'none';
  };
  host.addEventListener('mousemove', onMove);
  host.addEventListener('mouseleave', onLeave);

  // Клик по диаграмме → записать t и φ в активную (в фокусе) карточку точки
  host.addEventListener('click', (e) => {
    if (!_chartCtx) return;
    if (!Number.isFinite(_activePoint)) return;
    const svg = host.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = vb.width / rect.width, sy = vb.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top)  * sy;
    const { opts } = _chartCtx;
    const { W, T } = _chartCtx.inv ? _chartCtx.inv(px, py) : {
      W: opts.W_min + (px - opts.marginL) / (opts.width - opts.marginL - opts.marginR) * (opts.W_max - opts.W_min),
      T: opts.T_max - (py - opts.marginT) / (opts.height - opts.marginT - opts.marginB) * (opts.T_max - opts.T_min),
    };
    if (W < opts.W_min || W > opts.W_max || T < opts.T_min || T > opts.T_max) return;
    // φ = pv/Pws; clamp в физический диапазон.
    const pv = Math.max(0, W) * S.P / (0.621945 + Math.max(0, W));
    const phi = Math.max(0, Math.min(100, 100 * pv / Pws(T)));
    const now = performance.now();
    const p = S.points[_activePoint];
    if (!p) return;
    p.t  = Number(T.toFixed(2));   p.tUser  = true;  p.tTs  = now;
    p.rh = Number(phi.toFixed(1)); p.rhUser = true;  p.rhTs = now + 0.01;
    // При клике d и h должны стать auto (пересчитаться из t+φ)
    p.x = ''; p.xUser = false; p.xTs = 0;
    p.h = ''; p.hUser = false; p.hTs = 0;
    update();
  });
}

/* Промежуточные точки, чтобы линия процесса шла по реалистичной траектории.
   v0.59.936: для C-процесса с заданным ADP/BF — рисуем «фантомную точку»
   ADP на кривой насыщения + пунктирную mix-линию (a → ADP-sat), затем
   основную стрелку a → b (mix-result). По репорту пользователя:
   «фантомная точка, в которой происходит процесс совсем другого
   охлаждения и смешения с воздухом который не успел охладиться до
   температуры теплообменника, но его нужно учитывать».
   offset = { dx, dy } — перпендикулярное смещение для overlapping-арок
   (если два процесса делят одни и те же endpoints). */
function drawProcessPath(ctx, a, b, type, color, proc, offset) {
  // v0.59.940: pp(W, T) — единая (W, T) → [x, y] трансляция с offset,
  // работает для ramzin/ashrae layouts.
  const dx = offset?.dx || 0;
  const dy = offset?.dy || 0;
  const pp = (W, T) => {
    const [x, y] = ctx.pos(W, T);
    return [x + dx, y + dy];
  };
  // C с ADP/BF — спец-визуал: ADP-marker + mix line.
  if (type === 'C') {
    const adpC = nNum(proc?.adp);
    if (Number.isFinite(adpC) && adpC < a.Td - 0.01 && b.W < a.W - 1e-6) {
      const Wadp = humidityRatio(adpC, 1.0, a.P);
      const [xA, yA] = pp(a.W, a.T);
      const [xB, yB] = pp(b.W, b.T);
      const [xAdp, yAdp] = pp(Wadp, adpC);
      return `<g>
        <line x1="${xA}" y1="${yA}" x2="${xAdp}" y2="${yAdp}"
              stroke="${color}" stroke-width="0.9" stroke-dasharray="2,3" opacity="0.6"/>
        <circle cx="${xAdp}" cy="${yAdp}" r="3.5" fill="#fff"
                stroke="${color}" stroke-width="1.5"/>
        <text x="${xAdp + 6}" y="${yAdp + 3}" font-size="9"
              fill="${color}" font-weight="700"
              paint-order="stroke" stroke="#fff" stroke-width="2.5">ADP ${adpC.toFixed(0)}°C</text>
        <line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}"
              stroke="${color}" stroke-width="2.2"
              marker-end="url(#arrow-${type})"/>
      </g>`;
    }
  }
  const pts = [pp(a.W, a.T)];
  if (type === 'P') {
    pts.push(pp(a.W, b.T));
  } else if (type === 'A') {
    const h = a.h;
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
      const W = a.W + (b.W - a.W) * (k/steps);
      const t = (h - 2501*W) / (1.006 + 1.86*W);
      pts.push(pp(W, t));
    }
  } else if (type === 'S') {
    pts.push(pp(b.W, a.T));
  } else if (type === 'M') {
    pts.push(pp(b.W, b.T));
  } else if (type === 'R') {
    if (b.T < a.Td - 0.05 && b.W < a.W - 1e-6) {
      const Tdew = a.Td;
      pts.push(pp(a.W, Tdew));
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        const T = Tdew + (b.T - Tdew) * (k / steps);
        const W = humidityRatio(T, 1.0, a.P);
        pts.push(pp(W, T));
      }
    } else if (b.T < a.Td - 0.05) {
      const Tdew = a.Td;
      pts.push(pp(a.W, Tdew));
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        const T = Tdew + (b.T - Tdew) * (k / steps);
        const W = Math.min(b.W || a.W, humidityRatio(T, 1.0, a.P));
        pts.push(pp(W, T));
      }
    } else {
      pts.push(pp(a.W, b.T));
    }
  } else if (type === 'C') {
    if (b.W < a.W - 1e-6) {
      const Tdew = a.Td;
      pts.push(pp(a.W, Tdew));
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        const T = Tdew + (b.T - Tdew) * (k/steps);
        const W = humidityRatio(T, 1.0, a.P);
        pts.push(pp(W, T));
      }
    } else {
      pts.push(pp(b.W, b.T));
    }
  }
  pts.push(pp(b.W, b.T));
  return `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none"
           stroke="${color}" stroke-width="2.2" stroke-linejoin="round"
           marker-end="url(#arrow-${type})"/>`;
}

/* ========================================================================
   Формулы и пояснение
   ======================================================================== */
function renderFormulas() {
  $('psy-formulas').innerHTML = `
    <h4>1. Атмосферное давление на высоте</h4>
    <div class="f-row"><code>P(h) = P<sub>0</sub>·(1 − 2,25577·10⁻⁵·h)<sup>5,2559</sup></code>
      <span>Международная стандартная атмосфера (ISA / ГОСТ 4401-81). P<sub>0</sub> = 101 325 Па.
      Давление влияет на d, ρ, ось абсолютной влажности и φ = Pпар/Pнас.</span></div>

    <h4>2. Давление насыщения Pₙ(t) — Hyland–Wexler 1983 (ASHRAE Fundamentals 2021)</h4>
    <div class="f-row"><code>ln P<sub>ws</sub> = C<sub>8</sub>/T + C<sub>9</sub> + C<sub>10</sub>T + C<sub>11</sub>T² + C<sub>12</sub>T³ + C<sub>13</sub>lnT</code>
      <span>Для T ≥ 273,15 К (вода). Для льда — другой полином. Более точная формулировка, чем Magnus/СП 50.13330.</span></div>

    <h4>3. Парциальное давление пара и влагосодержание</h4>
    <div class="f-row"><code>Pпар = φ·Pₙ(t)</code>
      <span>φ [0..1] — относительная влажность.</span></div>
    <div class="f-row"><code>d = 621,945 · Pпар / (Pатм − Pпар)   [г воды / кг сух. возд.]</code>
      <span>621,945 = 1000·Mвода/Mвоздух = 1000·18,015/28,966. ASHRAE стандарт.</span></div>
    <div class="f-row"><code>φ = d·Pатм / [Pₙ(t)·(621,945 + d)]</code>
      <span>Обратная формула — если задано d (override).</span></div>

    <h4>4. Энтальпия влажного воздуха</h4>
    <div class="f-row"><code>h = 1,006·t + d/1000·(2501 + 1,86·t)   [кДж/кг сух. возд.]</code>
      <span>1,006 — теплоёмкость сух. воздуха; 2501 — теплота парообразования при 0 °C; 1,86 — теплоёмкость пара.</span></div>

    <h4>5. Плотность и удельный объём</h4>
    <div class="f-row"><code>v = R<sub>a</sub>·T·(1 + 1,6078·W) / P,  R<sub>a</sub> = 287,055 Дж/(кг·К)</code>
      <span>Удельный объём на 1 кг сух. возд.</span></div>
    <div class="f-row"><code>ρ = (1 + W) / v</code>
      <span>Плотность влажного воздуха.</span></div>

    <h4>6. Температура точки росы и мокрого термометра</h4>
    <div class="f-row"><code>t<sub>р</sub>: решение Pₙ(t<sub>р</sub>) = Pпар</code>
      <span>Ньютон-итерация с начальным приближением Magnus. При t<sub>р</sub> выпадает конденсат.</span></div>
    <div class="f-row"><code>W = [(2501 − 2,326·t<sub>м</sub>)·Wₛ(t<sub>м</sub>) − 1,006·(t − t<sub>м</sub>)] / (2501 + 1,86·t − 4,186·t<sub>м</sub>)</code>
      <span>Психрометрическое уравнение. t<sub>м</sub> ищется итеративно (ASHRAE).</span></div>

    <h4>7. Процессы между точками</h4>
    <div class="f-row"><code>P (нагрев):  d=const, Δh = 1,006·Δt + 1,86·d/1000·Δt  →  Q > 0</code>
      <span>Паспортные электрические / водяные калориферы. Сенсибельная нагрузка.</span></div>
    <div class="f-row"><code>C (охлаждение/осушение): до t<sub>р</sub> d=const, затем по φ=100% к t<sub>коил</sub></code>
      <span>Если температура ниже точки росы — выпадает конденсат, Δd &lt; 0, Q &lt; 0 (полная нагрузка = сенсибельная + латентная).</span></div>
    <div class="f-row"><code>A (адиабат. увл.):  h=const, d растёт → t падает</code>
      <span>Форсуночные камеры, сотовые испарители. Предел — t<sub>м</sub> (насыщение по линии h=const).</span></div>
    <div class="f-row"><code>S (паровое увл.):  t≈const, d растёт</code>
      <span>Паровые увлажнители. Приблизительно изотермический процесс (пар при 100 °C даёт малое приращение t).</span></div>
    <div class="f-row"><code>X (произвольный):  просто соединяет две точки</code>
      <span>Для рециркуляции/смешения или произвольных переходов.</span></div>

    <h4>8. Тепловая мощность и влагоприток процесса</h4>
    <div class="f-row"><code>G<sub>да</sub> = V · ρ<sub>да</sub> = V · ρ / (1 + W)   [кг/ч]</code>
      <span>Массовый расход сух. воздуха. V — объёмный расход м³/ч.</span></div>
    <div class="f-row"><code>Q = G<sub>да</sub>/3600 · Δh   [кВт]</code>
      <span>Полная тепловая нагрузка (сенсибельная + латентная). Δh в кДж/кг.</span></div>
    <div class="f-row"><code>q<sub>w</sub> = G<sub>да</sub> · ΔW   [кг/ч]</code>
      <span>Массовый влагоприток/осушение. ΔW в кг/кг.</span></div>

    <div class="note">Точность: Hyland-Wexler + ASHRAE-формы обеспечивают ±0,1% в диапазоне −40…+50 °C. Ниже −20 °C — используется ветка над льдом.</div>
  `;
}

/* ========================================================================
   Демо-циклы и действия
   ======================================================================== */
const DEMOS = {
  'summer': {
    label: 'Лето: охл./осуш. → доводчик',
    apply: () => {
      const now = performance.now();
      S.points = [
        { name: 'Лето наружный',   nameUser: true, t: 35, tUser: true, tTs: now, rh: 50, rhUser: true, rhTs: now, x: '', h: '', V: '' },
        { name: 'После охл./осуш.', nameUser: true, t: 14, tUser: true, tTs: now+1, rh: '', x: '', h: '', V: '' },
        { name: 'Приточный',        nameUser: true, t: 22, tUser: true, tTs: now+2, rh: '', x: '', h: '', V: '' },
      ];
      S.procs = [ { type:'C', Q:'', qw:'' }, { type:'P', Q:'', qw:'' } ];
    }
  },
  'winter': {
    label: 'Зима: нагрев → адиабат. увлажн.',
    apply: () => {
      const now = performance.now();
      S.points = [
        { name: 'Зима наружный',    nameUser: true, t: -20, tUser: true, tTs: now, rh: 85, rhUser: true, rhTs: now, x: '', h: '', V: '' },
        { name: 'После калорифера', nameUser: true, t: 28,  tUser: true, tTs: now+1, rh: '', x: '', h: '', V: '' },
        { name: 'После увлажн.',    nameUser: true, t: '', rh: 40, rhUser: true, rhTs: now+2, x: '', h: '', V: '' },
      ];
      S.procs = [ { type:'P', Q:'', qw:'' }, { type:'A', Q:'', qw:'' } ];
    }
  },
  'recup': {
    label: 'Зима, замкнутый цикл: рекуп. + калориф. + помещение (люди/стены)',
    apply: () => {
      // v0.59.950: ПОЛНЫЙ замкнутый цикл с реальным сценарием — по репорту:
      //   «вытяжка берется из неоткуда и не связана с температурой
      //   подающего воздуха и никакими нагревами или охлаждениями внутри
      //   помещения. Сделай реальный сценарий с полным циклом, включая
      //   инфильтрацию, эксфильтрацию, теплопритоки от стен, теплопритоки
      //   и влагопритоки от людей».
      //
      // Сценарий: офисное помещение зимой (Москва, -20°C на улице).
      //   Приточный тракт: Улица → Рекуп → Калорифер → Помещение.
      //   В помещении: тепло-/влагопритоки от людей и теплопотери через
      //     стены / эксфильтрацию (X-процесс «Помещение»).
      //   Вытяжной тракт: Помещение → Рекуп → На улицу.
      //   Цикл замкнут — приточный и вытяжной потоки связаны через
      //     рекуператор (теплообмен) и через помещение (тепло/влага).
      const now = performance.now();
      S.vBase = 2000;
      S.points = [
        // 0: Уличный воздух (зима, расчётная)
        { name: 'Улица (зима)',           nameUser: true, t: -20, tUser: true, tTs: now,   rh: 85, rhUser: true, rhTs: now,   x: '', h: '', V: 2000, cx: 40,  cy: 40 },
        // 1: Приток после рекуп. (auto-name «После рекуп. (приток)»)
        { name: '',                       nameUser: false,                               t: '', rh: '', x: '', h: '', V: '',                            cx: 320, cy: 40 },
        // 2: Приток после калорифера. T задана инженером (28°C — компенсирует теплопотери помещения).
        { name: 'После калорифера',       nameUser: true, t: 28, tUser: true, tTs: now+2, rh: '', x: '', h: '', V: '',                                  cx: 600, cy: 40 },
        // 3: Помещение (внутренний климат) — анкер 22°C, 40% RH.
        //    X-процесс 2→3 покажет, какие Q и qw нужны для поддержания
        //    этого климата (баланс: люди + потери через стены/эксфильтрацию).
        { name: 'Помещение (22°C, 40%)',  nameUser: true, t: 22, tUser: true, tTs: now+3, rh: 40, rhUser: true, rhTs: now+3, x: '', h: '', V: '',     cx: 880, cy: 40 },
        // 4: Вытяжка после рекуп. (auto-name «После рекуп. (вытяжка)»)
        { name: '',                       nameUser: false,                               t: '', rh: '', x: '', h: '', V: '',                            cx: 320, cy: 280 },
      ];
      S.procs = [
        // 0→1 R: рекуператор, приточная сторона нагревается от вытяжной (ref=3, помещение 22°C)
        { type:'R', name:'♻ Рекуператор (приток)', Q:'', qw:'', fromIdx: 0, toIdx: 1, recupWith: '3', recupEff: '0.65', recupMode: 'sensible' },
        // 1→2 P: догревный калорифер до +28°C (компенсация теплопотерь зала)
        { type:'P', name:'🔥 Калорифер', Q:'', qw:'', fromIdx: 1, toIdx: 2 },
        // 2→3 X: «Помещение» — внутренний баланс. Cascade посчитает:
        //   Q (кВт) = m_da·(h₃−h₂) — net heat balance:
        //     +Q от людей (~1 кВт на 10 чел) + Q от оборудования
        //     −Q потери через ограждения (стены, окна, эксфильтрация)
        //     При t_supply=28°C → t_room=22°C получается ΔT=−6°C, т.е.
        //     потери преобладают на ~3-4 кВт (типично для офиса 50 м²).
        //   qw (кг/ч) = m_da·ΔW — net moisture balance:
        //     +qw от людей (~0.5 кг/ч на 10 чел) + испарение
        //     −qw эксфильтрация
        //     Положительный qw → влагопритоки преобладают (что и видим
        //     при t_room=22°C, RH=40% → W₃≈6.6 г/кг vs W₂=W₁≈0.5 г/кг).
        { type:'X', name:'🏢 Помещение (люди + стены + инфильтрация)', Q:'', qw:'', fromIdx: 2, toIdx: 3 },
        // 3→4 R: рекуператор, вытяжная сторона отдаёт тепло притоку (ref=0)
        { type:'R', name:'♻ Рекуператор (вытяжка)', Q:'', qw:'', fromIdx: 3, toIdx: 4, recupWith: '0', recupEff: '0.65', recupMode: 'sensible' },
      ];
      // Зоны-подложки для visual-группировки на canvas
      S.zones = [
        { id: newZoneId(), name: 'Улица',          color: '#b0bec5', cx: 0,    cy: 0,   w: 240,  h: 480 },
        { id: newZoneId(), name: 'Вент. камера',   color: '#90caf9', cx: 260,  cy: 0,   w: 320,  h: 480 },
        { id: newZoneId(), name: 'Помещение (с людьми)', color: '#ffcc80', cx: 600, cy: 0, w: 320, h: 240 },
      ];
    }
  },
  'recirc': {
    label: 'Рециркуляция: смешение с приточкой',
    apply: () => {
      const now = performance.now();
      S.points = [
        { name: 'Наружный',       nameUser: true, t: -10, tUser: true, tTs: now,   rh: 80, rhUser: true, rhTs: now,   x: '', h: '', V: '' },
        { name: 'Смесь 30/70',    nameUser: true, t: '', rh: '', x: '', h: '', V: '' },
        { name: 'После нагрева',  nameUser: true, t: 22, tUser: true, tTs: now+2, rh: '', x: '', h: '', V: '' },
        { name: 'Рецирк. из пом.', nameUser: true, t: 22, tUser: true, tTs: now+3, rh: 40, rhUser: true, rhTs: now+3, x: '', h: '', V: '' },
      ];
      S.procs = [
        { type:'M', Q:'', qw:'', mixWith:'3', mixRatio:'0.3' },
        { type:'P', Q:'', qw:'' },
        { type:'none', Q:'', qw:'' },
      ];
    }
  },
  /* ====================================================================
     ЦОД машинный зал: IT 200 кВт, V_recirc ≈ 50 000 м³/ч (ΔT≈12 °C
     на стойку — ASHRAE TC 9.9), свежий воздух 300 м³/ч (норма по людям
     + поддув в холодный коридор), рекуператор приток↔вытяжка η=0.6,
     догрев приточки до +18 °C перед смесью, CRAC охл./осуш. до 22 °C.
     Горячий коридор анкерован на +35 °C (выход IT), холодный — 22 °C 50%.
     ==================================================================== */
  'dc-winter': {
    label: 'ЦОД машзал: IT 200 кВт + рекуператор + CRAC',
    apply: () => {
      const now = performance.now();
      S.vBase = 50000;
      S.points = [
        // Раскладка: приточный тракт в верхнем ряду, вытяжной — в нижнем,
        // машзал — правый край. Получается П-образная схема движения воздуха.
        // cx/cy в px на полотне psy-canvas.
        { name:'Улица (зима -35 °C)',   nameUser:true, t:-35, tUser:true, tTs:now,   rh:80, rhUser:true, rhTs:now,   x:'', h:'', V:300, cx:20,   cy:20  },
        { name:'После рекуп. (приток)', nameUser:true, t:'', rh:'', x:'', h:'', V:'',                                                                       cx:260,  cy:20  },
        { name:'После догрева (+18 °C)', nameUser:true, t:18, tUser:true, tTs:now+2, rh:'', x:'', h:'', V:'',                                              cx:500,  cy:20  },
        { name:'Приток в зал (смесь)',   nameUser:true, t:'', rh:'', x:'', h:'', V:50000,                                                                   cx:740,  cy:20  },
        { name:'Горячий коридор (+35)',  nameUser:true, t:35, tUser:true, tTs:now+4, rh:25, rhUser:true, rhTs:now+4, x:'', h:'', V:'',                      cx:980,  cy:150 },
        { name:'После CRAC (+22, 50%)',  nameUser:true, t:22, tUser:true, tTs:now+5, rh:50, rhUser:true, rhTs:now+5, x:'', h:'', V:'',                      cx:740,  cy:300 },
        { name:'Вытяжка (300 м³/ч)',     nameUser:true, t:'', rh:'', x:'', h:'', V:300,                                                                     cx:500,  cy:300 },
        { name:'Наружу после рекуп.',     nameUser:true, t:'', rh:'', x:'', h:'', V:'',                                                                      cx:20,   cy:300 },
      ];
      S.procs = [
        // 0→1 R: рекуператор, приточная сторона греется от вытяжной (ref=6).
        { type:'R', name:'♻ Рекуп. (приток)', Q:'', qw:'', fromIdx:0, toIdx:1, recupWith:'6', recupEff:'0.6' },
        // 1→2 P: догревный калорифер (водяной/электрический). До +18 °C.
        { type:'P', name:'🔥 Догревный калорифер', Q:'', qw:'', fromIdx:1, toIdx:2 },
        // 2→3 M: смешение «догретая свежая + рециркуляция из хол. коридора».
        //         α=0.006 = 300/(300+49700) — доля свежего по массе.
        { type:'M', name:'🔀 Смешение свеж/рецирк', Q:'', qw:'', fromIdx:2, toIdx:3, mixWith:'5', mixRatio:'0.006' },
        // 3→4 X: машзал — НАГРЕВ ОТ СТОЕК (IT-нагрузка). По репорту
        // пользователя: «в демо-цикле ЦОД не нашел нагрева от стоек» —
        // теперь процесс имеет явное имя «🖥 IT-нагрузка от стоек».
        // Q вычисляется cascade-ом из point 3 (приток) vs point 4 (горячий
        // коридор +35°C) — типично ~200 кВт.
        { type:'X', name:'🖥 IT-нагрузка от стоек ≈200 кВт', Q:'', qw:'', fromIdx:3, toIdx:4 },
        // 4→5 C: CRAC (прецизионный кондиционер). Охлаждение + осушение.
        { type:'C', name:'❄ CRAC (прец. охладитель)', Q:'', qw:'', fromIdx:4, toIdx:5 },
        // 5→6 X: тап вытяжки из хол. коридора (d и t как у узла 5).
        { type:'X', name:'⤴ Тап вытяжки', Q:'', qw:'', fromIdx:5, toIdx:6 },
        // 6→7 R: рекуператор, вытяжная сторона отдаёт тепло (ref=1).
        { type:'R', name:'♻ Рекуп. (вытяжка)', Q:'', qw:'', fromIdx:6, toIdx:7, recupWith:'1', recupEff:'0.6' },
      ];
      // Зоны-подложки: улица / вент. камера приток / машзал / вытяжка.
      S.zones = [
        { id: newZoneId(), name: 'Улица', color:'#b0bec5', cx: 0,   cy: 0,   w: 220, h: 560 },
        { id: newZoneId(), name: 'Вент. камера (приток)', color:'#90caf9', cx: 240, cy: 0,   w: 460, h: 240 },
        { id: newZoneId(), name: 'Машзал ЦОД', color:'#ef9a9a', cx: 720, cy: 0,   w: 480, h: 380 },
        { id: newZoneId(), name: 'Вент. камера (вытяжка)', color:'#a5d6a7', cx: 240, cy: 260, w: 460, h: 220 },
      ];
    }
  },
};

function loadDemo(key) {
  const demo = DEMOS[key] || DEMOS['summer'];
  S.alt = 0; S.P = 101325; S.rhMax = 100; S.tEvap = 15; S.vBase = 10000;
  S.zones = [];
  demo.apply();
  // Демо описывают S.procs как линейную цепочку (procs[i] = edge i→i+1).
  // Проставляем явные fromIdx/toIdx чтобы граф-модель работала корректно.
  S.procs.forEach((pr, i) => {
    if (!Number.isFinite(+pr.fromIdx)) pr.fromIdx = i;
    if (!Number.isFinite(+pr.toIdx))   pr.toIdx   = i + 1;
  });
  syncTopInputs();
  renderCycle();
  update();
}

function syncTopInputs() {
  $('psy-alt').value    = S.alt;
  $('psy-P-kpa').value  = (S.P/1000).toFixed(3);
  $('psy-rhmax').value  = S.rhMax;
  if ($('psy-tevap')) $('psy-tevap').value = S.tEvap;
  $('psy-vbase').value  = S.vBase;
  if ($('psy-tmin-chart')) $('psy-tmin-chart').value = S.tMinChart;
  if ($('psy-tmax-chart')) $('psy-tmax-chart').value = S.tMaxChart;
  if ($('psy-dmax-chart')) $('psy-dmax-chart').value = S.dMaxChart;
}

/* ========================================================================
   Main
   ======================================================================== */
/* Полный пересчёт БЕЗ пересоздания inputs (чтобы не терять фокус). */
function update() {
  readInputs();
  cascade();                  // авто-имена + forward-compute точек по цели процесса
  fillComputedDH();           // для каждой точки: если d/h не user — вписываем вычисленное
  writeCardsFromState();      // пушим S → DOM для auto-полей без user-флага
  refreshComputedInCards();
  const { sts, segs, primaryIdx } = computeCycle();
  refreshAutoV(segs, primaryIdx);
  fillComputedQW(segs);       // для каждой стрелки: Q и qw — вычислены, если не user
  fillCondensate(segs);       // для C/A с осушением — сколько конденсата (кг/ч, л/ч, л/сут)
  fillProcWarnings(sts);      // предупреждения о несовместимости типа процесса и целевой точки
  renderResults(sts, segs);
  renderChart(sts);
  saveCycle();
}

/* Валидация «заявленный тип процесса vs фактический переход между точками».
   Пользователь может задать P (d=const), но навязать целевой точке другой d —
   тогда график/расчёт формально сработает, но термодинамически это будет уже
   не изобарный нагрев, а что-то другое. Предупреждаем без блокировки. */
function fillProcWarnings(sts) {
  // v0.59.948: querySelectorAll — обновляем все proc-arrow elements.
  for (let i = 0; i < S.procs.length; i++) {
    const boxes = document.querySelectorAll(`.psy-proc-arrow[data-proc-idx="${i}"] [data-role="proc-warn"]`);
    if (!boxes.length) continue;
    const pr = S.procs[i];
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    const a = sts[fromI], b = sts[toI];
    const msgs = [];
    if (pr && a && b && pr.type !== 'none' && pr.type !== 'X') {
      const dA = a.W * 1000, dB = b.W * 1000;          // г/кг
      const tolD = 0.05;                                // г/кг
      const tolT = 0.2;                                 // °C
      const tolH = 0.3;                                 // кДж/кг
      if (pr.type === 'P' && Math.abs(dB - dA) > tolD) {
        msgs.push(`P (d=const): d₁=${dA.toFixed(2)} → d₂=${dB.toFixed(2)} г/кг — расхождение ${Math.abs(dB-dA).toFixed(2)} г/кг. Проверьте целевую точку.`);
      }
      if (pr.type === 'P' && b.T < a.T - tolT) {
        msgs.push(`P (нагрев), но t₂ < t₁ (${b.T.toFixed(1)} < ${a.T.toFixed(1)}). Для охлаждения выберите C.`);
      }
      if (pr.type === 'C' && b.T > a.T + tolT) {
        msgs.push(`C (охлаждение), но t₂ > t₁ (${b.T.toFixed(1)} > ${a.T.toFixed(1)}). Для нагрева выберите P.`);
      }
      if (pr.type === 'A' && Math.abs(b.h - a.h) > tolH) {
        msgs.push(`A (h=const): h₁=${a.h.toFixed(2)} → h₂=${b.h.toFixed(2)} кДж/кг — расхождение ${Math.abs(b.h-a.h).toFixed(2)}.`);
      }
      if (pr.type === 'A' && dB < dA - tolD) {
        msgs.push(`A (адиабат. увл.) подразумевает d₂ ≥ d₁, но d₂=${dB.toFixed(2)} < d₁=${dA.toFixed(2)} г/кг.`);
      }
      if (pr.type === 'S' && Math.abs(b.T - a.T) > tolT) {
        msgs.push(`S (t=const): t₁=${a.T.toFixed(1)} → t₂=${b.T.toFixed(1)} — расхождение ${Math.abs(b.T-a.T).toFixed(1)} °C.`);
      }
      if (pr.type === 'S' && dB < dA - tolD) {
        msgs.push(`S (паровое увл.) подразумевает d₂ ≥ d₁, но d₂=${dB.toFixed(2)} < d₁=${dA.toFixed(2)} г/кг.`);
      }
      if (pr.type === 'R') {
        if (Math.abs(dB - dA) > tolD) {
          msgs.push(`R (рекуператор, сенсиб.): d₁=${dA.toFixed(2)} → d₂=${dB.toFixed(2)} — модель подразумевает d=const.`);
        }
        const refIdx = parseInt(pr.recupWith, 10);
        if (!Number.isFinite(refIdx) || !sts[refIdx]) {
          msgs.push('R: не выбрана опорная точка (обменивать с точкой).');
        } else {
          const r = sts[refIdx];
          // Нагрев идёт к t_ref, поэтому t₁<t_ref для нагрева, t₁>t_ref для охлаждения.
          // Проверим согласованность знака Δt с ожидаемым.
          const expectSign = Math.sign(r.T - a.T);
          const gotSign = Math.sign(b.T - a.T);
          if (expectSign !== 0 && gotSign !== 0 && expectSign !== gotSign) {
            msgs.push(`R: направление теплообмена не согласовано с опорной точкой ${refIdx+1}.`);
          }
        }
      }
      if (pr.type === 'M') {
        const refIdx = parseInt(pr.mixWith, 10);
        if (!Number.isFinite(refIdx) || !sts[refIdx]) {
          msgs.push('M: не выбрана опорная точка (смешать с точкой).');
        }
        const α = Number(pr.mixRatio);
        if (!Number.isFinite(α) || α < 0 || α > 1) {
          msgs.push('M: доля α должна быть в диапазоне 0…1.');
        }
      }
      if (a.RH > S.rhMax + 0.1 || b.RH > S.rhMax + 0.1) {
        msgs.push(`Пересечение линии насыщения: φ > φ_max (${S.rhMax}%). Физически невозможно без конденсации.`);
      }
    }
    boxes.forEach(box => {
      if (msgs.length === 0) {
        box.style.display = 'none';
        box.innerHTML = '';
      } else {
        box.style.display = '';
        box.innerHTML = '⚠ ' + msgs.join('<br>⚠ ');
      }
    });
  }
}

/* Авто-заполнение Q и q_w в DOM стрелок процесса. Для не-user полей
   подставляем вычисленные значения из segs — чтобы сразу было видно
   мощность/влагоприток, не переключаясь на таблицу процессов. */
function fillComputedQW(segs) {
  // v0.59.948: querySelectorAll — обновляем ВСЕ matching proc-arrows
  // (скрытый #psy-edges + модалка-редактор + sidebar). Раньше querySelector
  // возвращал только первый (скрытый) — модалка не получала computed Q/qw.
  segs.forEach((s, i) => {
    if (!s) return;
    document.querySelectorAll(`.psy-proc-arrow[data-proc-idx="${i}"]`).forEach(arr => {
      ['Q','qw'].forEach(col => {
        const inp = arr.querySelector(`input[data-col="${col}"]`);
        if (!inp) return;
        if (inp.dataset.user === '1') return;
        if (document.activeElement === inp) return;
        const val = col === 'Q' ? s.Q.toFixed(2) : s.qw.toFixed(3);
        inp.value = val;
      });
    });
  });
  // v0.59.951: после fill Q/qw — обновляем блок computed-параметров.
  refreshProcCardComputed(segs);
}

/* v0.59.951: блок «📊 Δ состояний и нагрузка» в карточке процесса.
   По репорту: «в карточке процесса нужно сразу отображать расчетные
   параметры если пользователь изменил значения в точке». Показывает
   ΔT, Δd, Δh, computed Q и q_w — обновляется автоматически после
   каждого update() pipeline (через fillComputedQW в самом конце). */
function refreshProcCardComputed(segs) {
  segs.forEach((s, i) => {
    document.querySelectorAll(`.psy-proc-arrow[data-proc-idx="${i}"]`).forEach(arr => {
      const wrap = arr.querySelector('[data-role="proc-computed"]');
      const out  = arr.querySelector('[data-role="proc-computed-deltas"]');
      if (!wrap || !out) return;
      if (!s) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = '';
      const fmt = (v, d=2) => Number.isFinite(v) ? v.toFixed(d) : '—';
      const sgn = (v, d=2) => Number.isFinite(v)
        ? (v >= 0 ? '+' : '') + v.toFixed(d)
        : '—';
      const QColor = s.Q > 0 ? '#c62828' : s.Q < 0 ? '#0277bd' : '#607080';
      const qwColor = s.qw > 0.001 ? '#2e7d32' : s.qw < -0.001 ? '#6a1b9a' : '#607080';
      out.innerHTML =
        `ΔT=<b>${sgn(s.dT, 2)}</b>°C · ` +
        `Δd=<b>${sgn(s.dW, 3)}</b> г/кг · ` +
        `Δh=<b>${sgn(s.dh, 2)}</b> кДж/кг<br>` +
        `Q=<b style="color:${QColor}">${sgn(s.Q, 2)}</b> кВт · ` +
        `q<sub>w</sub>=<b style="color:${qwColor}">${sgn(s.qw, 3)}</b> кг/ч<br>` +
        `<span style="color:#607080">V=${fmt(s.V, 0)} м³/ч · G<sub>да</sub>=${fmt(s.G, 0)} кг/ч</span>`;
    });
  });
}

/* Подсказка «сколько будет конденсата» при охлаждении с осушением.
   При C-процессе (и при A/S/X с отрицательным qw — это физически тоже
   осушение, если W₂<W₁) выводим под q_w синюю плашку:
     • кг/ч — модуль qw
     • л/ч — то же в литрах (ρ_воды ≈ 0.998 кг/л при 20°C, для простоты =1)
     • л/сут — суточный объём конденсата (важно для дренажа)
   Плюс суммарная точка росы t_р₁ входного потока — для проверки, что
   t_поверхности охладителя ниже t_р (иначе осушения просто не будет). */
function fillCondensate(segs) {
  // v0.59.948: querySelectorAll — обновляем все proc-arrows (см. fillComputedQW)
  segs.forEach((s, i) => {
    document.querySelectorAll(`.psy-proc-arrow[data-proc-idx="${i}"]`).forEach(arr => {
      const box = arr.querySelector('[data-role="condensate"]');
      if (!box) return;
      if (!s || !(s.qw < -0.001)) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
      }
      const abs = Math.abs(s.qw);
      const lph = abs / 0.998;
      const lpd = lph * 24;
      box.style.display = '';
      box.innerHTML =
        `💧 Конденсат: <b>${abs.toFixed(3)}</b> кг/ч ≈ `
        + `<b>${lph.toFixed(3)}</b> л/ч ≈ `
        + `<b>${lpd.toFixed(1)}</b> л/сут`;
    });
  });
}

/* ========================================================================
   Persistence — весь цикл в localStorage (psy.cycle.v1)
   ======================================================================== */
const LS_KEY = 'psy.cycle.v1';
let _saveTimer = null;
function saveCycle() {
  if (_saveTimer) return;             // debounce 300ms
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const payload = {
        v: 1,
        alt: S.alt, P: S.P, rhMax: S.rhMax, tEvap: S.tEvap, vBase: S.vBase,
        tMinChart: S.tMinChart, tMaxChart: S.tMaxChart, dMaxChart: S.dMaxChart,
        points: S.points, procs: S.procs,
        zones: S.zones,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }, 300);
}
function loadCycle() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || !Array.isArray(o.points) || !Array.isArray(o.procs)) return false;
    if (Number.isFinite(o.alt))   S.alt   = o.alt;
    if (Number.isFinite(o.P))     S.P     = o.P;
    if (Number.isFinite(o.rhMax)) S.rhMax = o.rhMax;
    if (Number.isFinite(o.tEvap)) S.tEvap = o.tEvap;
    if (Number.isFinite(o.vBase)) S.vBase = o.vBase;
    if (Number.isFinite(o.tMinChart)) S.tMinChart = o.tMinChart;
    if (Number.isFinite(o.tMaxChart)) S.tMaxChart = o.tMaxChart;
    if (Number.isFinite(o.dMaxChart)) S.dMaxChart = o.dMaxChart;
    S.points = o.points;
    S.procs  = o.procs;
    S.zones  = Array.isArray(o.zones) ? o.zones : [];
    // Обновим _zoneSeq, чтобы новые id не конфликтовали с загруженными.
    S.zones.forEach((z) => {
      const m = /^z(\d+)$/.exec(String(z.id || ''));
      if (m) _zoneSeq = Math.max(_zoneSeq, (+m[1]) + 1);
      if (!z.id) z.id = newZoneId();
    });
    // Миграция старых цепочек без fromIdx/toIdx — проставляем по индексу.
    S.procs.forEach((pr, i) => {
      if (!Number.isFinite(+pr.fromIdx)) pr.fromIdx = i;
      if (!Number.isFinite(+pr.toIdx))   pr.toIdx   = i + 1;
    });
    return true;
  } catch { return false; }
}
/* Пересоздание цикла (добавить/удалить точку / загрузка демо). */
function rerenderCycle() {
  renderCycle();
  update();
}

function wire() {
  // v0.59.912: каждая стадия в try-catch — даже если одна ломается, остальные
  // (особенно attachment listeners ниже) обязательно отрабатывают.
  try { loadCycle(); } catch (e) { console.error('[psy.wire.loadCycle]', e); }
  try { syncTopInputs(); } catch (e) { console.error('[psy.wire.syncTopInputs]', e); }
  try { renderFormulas(); } catch (e) { console.error('[psy.wire.renderFormulas]', e); }
  try { renderCycle(); } catch (e) { console.error('[psy.wire.renderCycle]', e); }
  try { update(); } catch (e) { console.error('[psy.wire.update]', e); }
  try { wireInfiniteCanvas(); }
  catch (e) { console.error('[wireInfiniteCanvas]', e); }
  // v0.59.927: рендер «active meteo» chip
  try { renderMeteoChip(); } catch (e) { console.error('[renderMeteoChip]', e); }
  // v0.59.919: при инициальной загрузке если есть точки и сохранённого view нет
  // (или он скрывает все точки) — auto-fit чтобы пользователь сразу видел граф.
  try {
    const hasView = !!S.canvasView && Number.isFinite(+S.canvasView.scale);
    if (S.points && S.points.length && !hasView) {
      setTimeout(() => fitCanvas(), 100);
    }
  } catch (e) {}

  // Верхние поля
  // v0.59.913: null-check — psy-tevap отсутствует в HTML, без проверки
  // $(id).addEventListener бросал TypeError, обрывая wire() — кнопки add/
  // wizard/csv/from-meteo не приcвоились. Этот баг существовал ещё до
  // v0.59.911, но проявился только с моими новыми wizard/from-meteo handlers.
  ['psy-alt','psy-P-kpa','psy-rhmax','psy-tevap','psy-vbase','psy-tmin-chart','psy-tmax-chart','psy-dmax-chart'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });

  // Переключатель русских названий
  const ruCb = $('psy-ru-names');
  if (ruCb) {
    ruCb.checked = !!S.showRuNames;
    ruCb.addEventListener('change', () => {
      S.showRuNames = ruCb.checked;
      try { localStorage.setItem('psy.showRuNames', S.showRuNames ? '1' : '0'); } catch {}
      rerenderCycle();
    });
  }

  // v0.59.929/946: select зоны (TC 9.9 / ASHRAE 55).
  // S.comfortZoneId уже загружен из LS в S-инициализаторе (см. вверху файла) —
  // здесь только синхронизация select.value и change-handler.
  const czSel = $('psy-comfort-zone-select');
  if (czSel) {
    czSel.value = S.comfortZoneId || '';
    czSel.addEventListener('change', () => {
      S.comfortZoneId = czSel.value;
      try { localStorage.setItem('psy.comfortZoneId', S.comfortZoneId); } catch {}
      rerenderCycle();
    });
  }

  // Делегирование событий в зоне цикла.
  // Любой РЕАЛЬНЫЙ ввод в текстовые/числовые поля помечает поле как
  // пользовательский ввод (data-user="1"), чтобы cascade не затирал его.
  // Фокус на карточке → подсветка точки на диаграмме
  $('psy-cycle').addEventListener('focusin', (e) => {
    const card = e.target.closest('.psy-point');
    if (!card) return;
    const idx = +card.dataset.pointIdx;
    if (Number.isFinite(idx) && idx !== _activePoint) {
      _activePoint = idx;
      update();       // перерисовать чтобы появилось кольцо
    }
  });
  $('psy-cycle').addEventListener('focusout', (e) => {
    // Задержка — если фокус перескакивает в другое поле той же карточки
    setTimeout(() => {
      const active = document.activeElement;
      const card = active?.closest?.('.psy-point');
      if (!card) {
        if (_activePoint !== null) { _activePoint = null; update(); }
      }
    }, 50);
  });

  wireGraphHost('psy-cycle');
  wireGraphHost('psy-edges');

  /* Таблица-список процессов: свои обработчики для inline select'ов
     (type/fromIdx/toIdx) и кнопки удаления. Поля value read-only. */
  const listHost = $('psy-edges-list');
  if (listHost) {
    listHost.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-el-col]');
      if (!sel) return;
      const i = +sel.dataset.i;
      const col = sel.dataset.elCol;
      S.procs[i] = S.procs[i] || {};
      if (col === 'type') S.procs[i].type = sel.value;
      else S.procs[i][col] = parseInt(sel.value, 10);
      rerenderCycle();
    });
    listHost.addEventListener('click', (e) => {
      const del = e.target.closest('[data-act="del-edge"]');
      if (!del) return;
      const i = +del.dataset.i;
      S.procs.splice(i, 1);
      rerenderCycle();
    });
  }

  /* Кнопки-таб «карточки / список». Переключают S.edgeView и видимость
     контейнеров, сохраняют выбор в localStorage. */
  document.querySelectorAll('.psy-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.edgeView = btn.dataset.view === 'list' ? 'list' : 'cards';
      try { localStorage.setItem('psy.edgeView', S.edgeView); } catch {}
      applyEdgeViewMode();
    });
  });

  /* v0.59.90: формат (A4/A3) + ориентация (landscape/portrait) диаграммы.
     Меняют реальные габариты SVG (viewBox = 3px × мм), не CSS-крутилку.
     После смены — полный перерасчёт точек и перерисовка графика. */
  const fmtSel = $('psy-chart-format');
  const oriSel = $('psy-chart-orient');
  if (fmtSel) {
    fmtSel.value = S.chartFormat;
    fmtSel.addEventListener('change', () => {
      S.chartFormat = fmtSel.value === 'A3' ? 'A3' : 'A4';
      try { localStorage.setItem('psy.chartFormat', S.chartFormat); } catch {}
      rerenderCycle();
    });
  }
  if (oriSel) {
    oriSel.value = S.chartOrient;
    oriSel.addEventListener('change', () => {
      S.chartOrient = oriSel.value === 'portrait' ? 'portrait' : 'landscape';
      try { localStorage.setItem('psy.chartOrient', S.chartOrient); } catch {}
      rerenderCycle();
    });
  }

  // v0.59.913: глобальный debug-handle для диагностики (window.__psy)
  try {
    window.__psy = {
      get S() { return S; },
      get points() { return S?.points; },
      get procs() { return S?.procs; },
      addPoint() { S.points.push({ name:'', t:'', rh:'', x:'', h:'', V:'' }); rerenderCycle(); },
      rerender: () => rerenderCycle(),
    };
  } catch (e) {}

  $('psy-add').addEventListener('click', () => {
    try {
      // v0.59.918: рядом с последней — смещаем на 220 px вправо
      // (если есть точки), чтобы новая не наслаивалась.
      const last = S.points[S.points.length - 1];
      const newPt = { name:'', t:'', rh:'', x:'', h:'', V:'' };
      if (last && Number.isFinite(+last.cx)) {
        newPt.cx = (+last.cx) + 220;
        newPt.cy = (+last.cy) || 0;
      }
      S.points.push(newPt);
      rerenderCycle();
      // v0.59.919: auto-fit чтобы новая точка была видна
      setTimeout(() => fitCanvas(), 50);
    } catch (e) { console.error('[psy-add click]', e); }
  });

  // v0.59.906: Мастер процесса — пошаговое добавление с минимальными вводными
  const wizBtn = $('psy-wizard');
  if (wizBtn) wizBtn.addEventListener('click', () => openProcessWizard());

  // v0.59.915: Рекуператор-блок — одной кнопкой создаёт 4 точки + 2 R-процесса.
  // Топология: приток (наружный) → R → приток после → ... + вытяжка (внутр.) →
  // R(reverse) → вытяжка-наружу. ref-узлы кросс-связаны для теплообмена.
  const recupBtn = $('psy-add-recup');
  if (recupBtn) recupBtn.addEventListener('click', () => {
    const baseI = S.points.length;
    const baseX = 100, baseY = 100;
    // 4 точки: 0=Наружный, 1=Приток после рекуп, 2=Внутр. вытяжка, 3=Вытяжка-наружу
    S.points.push({ name:'Наружный (приток)',   t:'-15', rh:'85',  cx: baseX,             cy: baseY,             x:'', h:'', V:'' });
    S.points.push({ name:'Приток после рекуп.', t:'',    rh:'',    cx: baseX,             cy: baseY + 280,       x:'', h:'', V:'' });
    S.points.push({ name:'Внутренний (вытяжка)',t:'22',  rh:'40',  cx: baseX + 320,       cy: baseY,             x:'', h:'', V:'' });
    S.points.push({ name:'Вытяжка наружу',      t:'',    rh:'',    cx: baseX + 320,       cy: baseY + 280,       x:'', h:'', V:'' });
    // R-процесс приток: 0 → 1 (источник теплоты — точка 2)
    S.procs.push({ type:'R', fromIdx: baseI + 0, toIdx: baseI + 1, recupWith: String(baseI + 2), recupEff: '0.65', Q:'', qw:'' });
    // R-процесс вытяжка: 2 → 3 (источник холода — точка 0). Это автоматически
    // не считается обратно — в текущей модели R считает только ОДИН поток. Но
    // визуально полезно показать второй поток.
    S.procs.push({ type:'R', fromIdx: baseI + 2, toIdx: baseI + 3, recupWith: String(baseI + 0), recupEff: '0.65', Q:'', qw:'' });
    rerenderCycle();
    // v0.59.917: auto-fit canvas чтобы новый блок попал в viewport
    setTimeout(() => fitCanvas(), 50);
    psyToast('♻ Рекуператор-блок: 4 точки + 2 R-процесса. η=0.65', 'ok');
  });

  // v0.59.915: Рециркуляция-блок — 3 точки + M-процесс.
  // Топология: 0=свежий + 1=возврат → 2=смесь
  const recircBtn = $('psy-add-recirc');
  if (recircBtn) recircBtn.addEventListener('click', () => {
    const baseI = S.points.length;
    const baseX = 100, baseY = 100;
    S.points.push({ name:'Свежий (наружн.)',   t:'-15', rh:'85', cx: baseX,         cy: baseY,         x:'', h:'', V:'' });
    S.points.push({ name:'Возврат (помещение)',t:'22',  rh:'40', cx: baseX + 320,   cy: baseY,         x:'', h:'', V:'' });
    S.points.push({ name:'Смесь',              t:'',    rh:'',   cx: baseX + 160,   cy: baseY + 280,   x:'', h:'', V:'' });
    S.procs.push({ type:'M', fromIdx: baseI + 0, toIdx: baseI + 2, mixWith: String(baseI + 1), mixRatio: '0.3', Q:'', qw:'' });
    rerenderCycle();
    setTimeout(() => fitCanvas(), 50);
    psyToast('🔄 Рециркуляция-блок: свежий 30%, возврат 70%', 'ok');
  });

  // v0.59.908: расширенный импорт ASHRAE design points из meteo.
  // 4 точки по ASHRAE Handbook гл. 14: Heating 99.6%/99% + Cooling 1%/0.4%.
  // Со средневзвешенной RH в окне ±1°C от target T.
  //
  // v0.59.908.1: пользователь сам выбирает локацию через station-picker
  // (может отличаться от активного meteo-датасета проекта). Если данных
  // на эту локацию нет в загруженных датасетах — fetch on-the-fly из Open-Meteo.
  // Импорт идемпотентен: повторный клик обновляет существующие точки
  // с _meteoTag, не плодит дубли.
  const fromMeteoBtn = $('psy-from-meteo');
  if (fromMeteoBtn) fromMeteoBtn.addEventListener('click', async () => {
    try {
      const { pickStation } = await import('../meteo/station-picker.js');
      const { ensureDefaultProject } = await import('../shared/project-storage.js');
      const pid = ensureDefaultProject();

      // Шаг 1: выбор локации
      const picked = await pickStation({ title: '📍 Выбор локации для ASHRAE design points' });
      if (!picked) return;
      if (picked.manual) {
        psyToast('Для ASHRAE-расчёта нужна станция из каталога. Используйте поиск/карту.', 'warn');
        return;
      }

      // v0.59.911: auto-fill «Условия объекта» по выбранной станции
      // (высота над у.м. → atmospheric pressure пересчитывается автоматически)
      if (picked.elev != null && Number.isFinite(Number(picked.elev))) {
        const altEl = $('psy-alt');
        if (altEl) {
          altEl.value = Math.round(Number(picked.elev));
          // Имитируем focus+input event чтобы pressure пересчиталось через update()
          altEl.focus();
          altEl.dispatchEvent(new Event('input', { bubbles: true }));
          altEl.blur();
        }
        update();  // полный пересчёт чтобы давление обновилось
      }

      // Шаг 2: проверим, есть ли уже датасет для этой локации в /meteo/
      const { listDatasets } = await import('../meteo/meteo-api.js');
      const allDs = listDatasets(pid);
      const existingDs = allDs.find(d =>
        Math.abs((d.lat || 0) - picked.lat) < 0.05 &&
        Math.abs((d.lon || 0) - picked.lon) < 0.05
      );

      let hourly;
      let locName = picked.name;
      if (existingDs && existingDs.hourly && existingDs.hourly.length > 24 * 30) {
        hourly = existingDs.hourly;
        locName = existingDs.locationName || picked.name;
        psyToast(`Использован существующий датасет: ${locName} (${hourly.length} часов)`, 'info');
      } else {
        // Fetch fresh: 5 лет Open-Meteo (для статистических percentiles)
        psyToast(`Загрузка 5 лет Open-Meteo для ${locName}…`, 'info');
        const today = new Date();
        const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
        const dateFrom = fiveYearsAgo.toISOString().slice(0, 10);
        const dateTo = today.toISOString().slice(0, 10);
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${picked.lat}&longitude=${picked.lon}&start_date=${dateFrom}&end_date=${dateTo}&hourly=temperature_2m,relative_humidity_2m&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) { psyToast(`Open-Meteo вернул ${res.status}`, 'warn'); return; }
        const json = await res.json();
        const times = json.hourly?.time || [];
        const T = json.hourly?.temperature_2m || [];
        const RH = json.hourly?.relative_humidity_2m || [];
        hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i] }));
        if (!hourly.length) { psyToast('Open-Meteo вернул пустой ряд.', 'warn'); return; }
      }

      const sortedT = [...hourly.map(h => Number(h.T)).filter(Number.isFinite)].sort((a, b) => a - b);
      const N = sortedT.length;
      const at = (frac) => sortedT[Math.min(N - 1, Math.max(0, Math.floor(N * frac)))];
      const tHeat996 = at(0.004);
      const tHeat990 = at(0.010);
      const tCool010 = at(0.990);
      const tCool004 = at(0.996);
      const rhFor = (targetT) => {
        const close = hourly.filter(h => Number.isFinite(Number(h.RH)) && Math.abs(Number(h.T) - targetT) < 1.0);
        if (!close.length) return null;
        return close.reduce((s, h) => s + Number(h.RH), 0) / close.length;
      };
      // v0.59.928: добавляем по ОДНОЙ точке за раз, выбор пользователя.
      // Простые имена «Зима …» / «Лето …» вместо технических «Heating 99.6%».
      const designs = [
        { tag: 'meteo-h996', shortLabel: '🥶 Зима расчётная (T 99.6%)', name: `Зима расч. ${locName}`,    t: tHeat996, rhDef: 80, hint: 'Для подбора нагревателей по экстремальной зиме' },
        { tag: 'meteo-h99',  shortLabel: '❄ Зима типовая (T 99%)',      name: `Зима типов. ${locName}`,   t: tHeat990, rhDef: 78, hint: 'Для типовой зимней нагрузки' },
        { tag: 'meteo-c1',   shortLabel: '☀ Лето типовое (T 1%)',       name: `Лето типов. ${locName}`,   t: tCool010, rhDef: 50, hint: 'Для типовой летней нагрузки' },
        { tag: 'meteo-c04',  shortLabel: '🌡 Лето расчётное (T 0.4%)',  name: `Лето расч. ${locName}`,    t: tCool004, rhDef: 45, hint: 'Для подбора чиллера по экстремальному лету' },
      ];

      // One-time cleanup для legacy points с старыми именами / без тэгов
      const NAME_PREFIXES = {
        'meteo-h996': ['Heating 99.6%', 'Зима расч.', 'Зима расч'],
        'meteo-h99':  ['Heating 99%', 'Зима типов'],
        'meteo-c1':   ['Cooling 1%', 'Лето типов'],
        'meteo-c04':  ['Cooling 0.4%', 'Лето расч.', 'Лето расч'],
      };
      for (const [tag, prefixes] of Object.entries(NAME_PREFIXES)) {
        if (S.points.some(p => p && p._meteoTag === tag)) continue;
        const idx = S.points.findIndex(p => p && !p._meteoTag &&
          prefixes.some(pref => (p.name || '').startsWith(pref)));
        if (idx >= 0) S.points[idx]._meteoTag = tag;
      }

      // Шаг: пользователь выбирает какую точку добавить
      const pickedTag = await openDesignPointPicker(designs, locName);
      if (!pickedTag) return;
      const d = designs.find(x => x.tag === pickedTag);
      if (!d) return;
      const rh = rhFor(d.t) ?? d.rhDef;
      // v0.59.935: новая логика по репорту: «точку из метео нужно добавлять
      // новую если только точек еще вообще нет, иначе просто для входной
      // точки выбирать из метео». Раньше каждый клик «Из meteo» либо
      // обновлял точку с тем же _meteoTag, либо добавлял новую — в результате
      // в цикле копились лишние карточки «Зима…/Лето…», а уже названная
      // пользователем «Наружный (приток)» оставалась пустой.
      const tNow = performance.now();
      const tStr = String(Math.round(d.t * 10) / 10);
      const rhStr = String(Math.round(rh));
      if (!S.points.length) {
        // Пусто — добавляем как первую точку с meteo-именем
        S.points.push({
          _meteoTag: d.tag,
          name: d.name, nameUser: true,
          t: tStr, tUser: true, tTs: tNow,
          rh: rhStr, rhUser: true, rhTs: tNow,
          x: '', h: '', V: '',
        });
        psyToast(`✓ Добавлена точка «${d.name}» · ${d.t.toFixed(1)}°C, ${Math.round(rh)}%`, 'ok');
      } else {
        // v0.59.945: Точки есть — применяем к ВХОДНОЙ (первой) точке,
        // имя ТАКЖЕ обновляем (по репорту: «при выборе точки из метео,
        // записывай ее имя»). Раньше имя сохранялось — но пользователь
        // ожидает что выбор «Зима расч. Алматы» отразится в названии.
        const inp = S.points[0];
        inp.name = d.name; inp.nameUser = true;
        inp.t = tStr; inp.tUser = true; inp.tTs = tNow;
        inp.rh = rhStr; inp.rhUser = true; inp.rhTs = tNow;
        inp._meteoTag = d.tag;
        inp.x = ''; inp.h = '';  // сбрасываем — будут пересчитаны из t+rh
        psyToast(`✓ Точка 1 ← «${d.name}» · ${d.t.toFixed(1)}°C, ${Math.round(rh)}%`, 'ok');
      }
      rerenderCycle();
      setTimeout(() => fitCanvas(), 100);
    } catch (e) {
      console.error('[psy-from-meteo]', e);
      psyToast(`Ошибка: ${e.message || e}`, 'warn');
    }
  });

  function psyToast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:16px;right:16px;z-index:10001;padding:10px 14px;border-radius:5px;font:13px system-ui;color:#f9fafb;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:360px;background:${kind==='warn'?'#b45309':kind==='ok'?'#15803d':'#1f2937'};opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 2800);
  }
  const addEdgeHandler = () => {
    // По умолчанию: ребро из последнего узла в предыдущий (образует последовательность)
    const N = S.points.length;
    const fromIdx = N >= 2 ? N - 2 : 0;
    const toIdx   = N >= 2 ? N - 1 : 0;
    S.procs.push({ type: 'X', Q:'', qw:'', fromIdx, toIdx });
    rerenderCycle();
    setTimeout(() => fitCanvas(), 50);  // v0.59.919: видимость новой связи
  };
  const btnAddEdge = $('psy-add-edge');
  if (btnAddEdge) btnAddEdge.addEventListener('click', addEdgeHandler);
  // v0.59.939: «+ связь» в сайдбаре — то же самое
  const btnAddEdgeSb = $('psy-add-edge-sidebar');
  if (btnAddEdgeSb) btnAddEdgeSb.addEventListener('click', addEdgeHandler);

  // v0.59.939: клик по элементу сайдбара → modal-редактор;
  //           кнопка ✕ внутри элемента → удалить связь.
  const sbList = $('psy-procs-sidebar-list');
  if (sbList) sbList.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-act="del-edge"]');
    if (delBtn) {
      e.stopPropagation();
      const idx = +delBtn.dataset.i;
      if (Number.isFinite(idx) && idx >= 0 && idx < S.procs.length) {
        S.procs.splice(idx, 1);
        rerenderCycle();
      }
      return;
    }
    const item = e.target.closest('.psy-procs-sidebar-item');
    if (!item) return;
    const idx = +item.dataset.procIdx;
    if (Number.isFinite(idx)) openProcessEditor(idx);
  });
  if (sbList) sbList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.psy-procs-sidebar-item');
    if (!item) return;
    e.preventDefault();
    const idx = +item.dataset.procIdx;
    if (Number.isFinite(idx)) openProcessEditor(idx);
  });
  const btnAddZone = $('psy-add-zone');
  if (btnAddZone) btnAddZone.addEventListener('click', () => {
    // Палитра приятных пастельных цветов — циклом по счётчику зон.
    const palette = ['#90caf9','#a5d6a7','#ffcc80','#ce93d8','#ef9a9a','#80cbc4','#fff59d','#b0bec5'];
    const color = palette[S.zones.length % palette.length];
    S.zones.push({
      id: newZoneId(),
      name: 'Новая зона',
      cx: 40 + (S.zones.length % 3) * 60,
      cy: 40 + (S.zones.length % 3) * 60,
      w: 300, h: 200, color,
    });
    renderZones();
    renderZonesPanel();
    saveCycle();
  });
  wireZonesPanel();
  $('psy-clear').addEventListener('click', () => {
    const now = performance.now();
    // v0.59.935: после Очистить — Точка 1 всегда вход с улицы.
    S.points = [{ name:'Наружный воздух (улица)', nameUser:true, t: -10, tUser:true, tTs: now, rh: 80, rhUser:true, rhTs: now, x: '', h:'', V: '' }];
    S.procs = [];
    S.zones = [];
    rerenderCycle();
  });
  $('psy-demo').addEventListener('change', (e) => {
    const key = e.target.value;
    if (!key) return;
    loadDemo(key);
    e.target.value = '';   // reset select
    setTimeout(() => fitCanvas(), 100);  // v0.59.919: видимость демо-цикла
  });

  // v0.59.921: named cycles save/load (multiple cycles per project)
  const ncSel = $('psy-named-cycles');
  if (ncSel) {
    refreshNamedCyclesList();
    ncSel.addEventListener('change', async (e) => {
      const v = e.target.value;
      e.target.value = '';
      if (!v) return;
      const cycles = loadNamedCycles();
      if (v === '__save__') {
        const name = await psyPrompt('Название цикла', 'Например: Лето расч., Зима расч., Расчётный режим');
        if (!name) return;
        // v0.59.926: сохраняем также canvasView (zoom/pan) — при загрузке
        // восстанавливаем точно такой же ракурс canvas.
        cycles[name.trim()] = JSON.parse(JSON.stringify({
          points: S.points, procs: S.procs, zones: S.zones,
          canvasView: S.canvasView || null,
        }));
        saveNamedCycles(cycles);
        refreshNamedCyclesList();
        psyToast(`💾 Сохранён цикл «${name}» (с view)`, 'ok');
      } else if (v === '__manage__') {
        const names = Object.keys(cycles);
        if (!names.length) { psyToast('Нет сохранённых циклов.', 'info'); return; }
        const which = await psyPrompt('Удалить цикл с именем (точно)', names.join(' / '));
        if (!which || !cycles[which.trim()]) return;
        delete cycles[which.trim()];
        saveNamedCycles(cycles);
        refreshNamedCyclesList();
        psyToast(`🗑 Удалён цикл «${which.trim()}»`, 'ok');
      } else {
        // Load by name
        const snap = cycles[v];
        if (!snap) { psyToast('Цикл не найден.', 'warn'); return; }
        S.points = JSON.parse(JSON.stringify(snap.points || []));
        S.procs = JSON.parse(JSON.stringify(snap.procs || []));
        S.zones = JSON.parse(JSON.stringify(snap.zones || []));
        rerenderCycle();
        // v0.59.926: восстановить сохранённый canvas view, либо auto-fit
        if (snap.canvasView && Number.isFinite(snap.canvasView.scale)) {
          S.canvasView = JSON.parse(JSON.stringify(snap.canvasView));
          // Применить view вручную (apply() в замыкании wireInfiniteCanvas — недоступна здесь)
          const canvas = document.getElementById('psy-canvas');
          const inner = document.getElementById('psy-canvas-inner');
          if (canvas && inner) {
            const cv = S.canvasView;
            inner.style.transform = `translate3d(${cv.tx}px, ${cv.ty}px, 0) scale(${cv.scale})`;
            const lab = document.getElementById('psy-canvas-zoom');
            if (lab) lab.textContent = Math.round(cv.scale * 100) + '%';
            const gridSize = 20 * cv.scale;
            canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
            canvas.style.backgroundPosition = `${cv.tx}px ${cv.ty}px`;
          }
        } else {
          setTimeout(() => fitCanvas(), 100);
        }
        psyToast(`📁 Загружен цикл «${v}»${snap.canvasView ? ' (восстановлен view)' : ''}`, 'ok');
      }
    });
  }
  const btnCsv = $('psy-csv');
  if (btnCsv) btnCsv.addEventListener('click', exportCsv);

  // v0.59.924: print-friendly export
  const btnPrint = $('psy-print');
  if (btnPrint) btnPrint.addEventListener('click', () => {
    // Inject print header (страница печати с датой и метаданными)
    let hdr = document.querySelector('.psy-print-header');
    if (!hdr) {
      hdr = document.createElement('div');
      hdr.className = 'psy-print-header';
      document.body.insertBefore(hdr, document.body.firstChild);
    }
    const date = new Date().toLocaleDateString('ru-RU');
    hdr.innerHTML = `<h1>i-d диаграмма Молье–Рамзина · ${date}</h1>
      <div style="font-size:11px;color:#555">Высота: ${S.alt} м · P: ${(S.P/1000).toFixed(2)} кПа · Точек: ${S.points.length} · Процессов: ${S.procs.filter(p => p.type !== 'none').length}</div>`;
    setTimeout(() => window.print(), 100);
  });

  // v0.59.948: tab-switching. Pane'ы переключаются через display
  // (без recreation), состояние калькуляторов и графика сохраняется.
  // Активная вкладка persist в LS.
  try {
    const tabs = document.querySelectorAll('.psy-tab');
    const panes = document.querySelectorAll('.psy-tab-pane');
    const setActive = (paneName) => {
      tabs.forEach(t => {
        const on = t.dataset.pane === paneName;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(p => {
        p.classList.toggle('active', p.dataset.pane === paneName);
      });
      try { localStorage.setItem('psy.activeTab', paneName); } catch {}
      // При переключении на «Диаграмма» — re-fit canvas (т.к. размеры могли
      // быть посчитаны при display:none и быть некорректны).
      if (paneName === 'diagram') {
        setTimeout(() => { try { fitCanvas(); } catch {} }, 50);
      }
    };
    tabs.forEach(t => t.addEventListener('click', () => setActive(t.dataset.pane)));
    // Восстановить вкладку из LS
    try {
      const saved = localStorage.getItem('psy.activeTab');
      if (saved && (saved === 'diagram' || saved === 'calc')) setActive(saved);
    } catch {}
  } catch (e) { console.error('[psy.tabs]', e); }
}

/* Экспорт точек и процессов в CSV (UTF-8 BOM, ';' — для Excel-RU). */
function exportCsv() {
  const { sts, segs } = computeCycle();
  const sep = ';';
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(`# i-d диаграмма — экспорт ${new Date().toISOString().slice(0,19).replace('T',' ')}`);
  lines.push(`# P = ${(S.P/1000).toFixed(3)} кПа; alt = ${S.alt} м; rhMax = ${S.rhMax}%; V_base = ${S.vBase} м³/ч`);
  lines.push('');
  lines.push('## Точки');
  lines.push(['№','Имя','t,°C','φ,%','d,г/кг','h,кДж/кг','ρ,кг/м³','v,м³/кг','tр,°C','tм,°C'].join(sep));
  sts.forEach((st, i) => {
    if (!st) { lines.push([i+1, q(S.points[i]?.name||''), '—','—','—','—','—','—','—','—'].join(sep)); return; }
    lines.push([
      i+1, q(S.points[i]?.name||''),
      st.T.toFixed(2), st.RH.toFixed(1),
      (st.W*1000).toFixed(3), st.h.toFixed(2),
      st.rho.toFixed(3), st.v.toFixed(4),
      st.Td.toFixed(2), st.Twb.toFixed(2),
    ].map(x => String(x).replace('.', ',')).join(sep));
  });
  lines.push('');
  lines.push('## Процессы');
  lines.push(['№','Тип','V,м³/ч','ΔT,°C','Δd,г/кг','Δh,кДж/кг','Gда,кг/ч','Q,кВт','qw,кг/ч'].join(sep));
  let sQh=0,sQc=0,sWh=0,sWd=0;
  segs.forEach((s, i) => {
    const pr = S.procs[i] || {};
    const fromI = edgeFrom(pr, i), toI = edgeTo(pr, i);
    if (!s) { lines.push([`${fromI+1}→${toI+1}`, '—','','','','','','',''].join(sep)); return; }
    if (s.Q>0) sQh += s.Q; else sQc += -s.Q;
    if (s.qw>0) sWh += s.qw; else sWd += -s.qw;
    const label = PROC_TYPES.find(p=>p.v===s.type)?.t || s.type;
    lines.push([
      `${fromI+1}→${toI+1}`, q(label),
      s.V.toFixed(0), s.dT.toFixed(2), s.dW.toFixed(3), s.dh.toFixed(2),
      s.G.toFixed(0), s.Q.toFixed(2), s.qw.toFixed(3),
    ].map(x => String(x).replace('.', ',')).join(sep));
  });
  lines.push('');
  lines.push(['ИТОГО', '', '', '', '', '', '',
              `нагрев: +${sQh.toFixed(2)} / охл: −${sQc.toFixed(2)}`,
              `увл: +${sWh.toFixed(3)} / осуш: −${sWd.toFixed(3)}`].join(sep));
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `id-diagram-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

/* ========================================================================
   v0.59.906: Мастер процесса (Process Wizard) — пошаговое добавление узла
   и процесса с минимальными исходными данными. Поддерживаемые процессы:
     P (heat), C (cool), A (adiabatic humid), S (steam humid),
     M (mixing), R (recovery), X (arbitrary).
   Каждый имеет минимальные required-поля, остальное считается из физики.
   ======================================================================== */
function openProcessWizard() {
  if (S.points.length === 0) {
    psyToast('Сначала добавьте начальную точку (входной воздух).', 'warn');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'psy-wiz-overlay';
  overlay.innerHTML = `<div class="psy-wiz-modal" role="dialog" aria-modal="true">
    <div class="psy-wiz-head"><h3>🧙 Мастер процесса</h3>
      <button type="button" class="psy-wiz-close" title="Закрыть">×</button>
    </div>
    <div class="psy-wiz-body">
      <h4>Шаг 1 — выберите тип процесса</h4>
      <div class="psy-wiz-types">
        <button type="button" class="psy-wiz-type" data-pt="P">
          <b>🔥 Нагрев (P)</b><br><span>d=const, ΔT увеличивает t</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="C">
          <b>❄ Охлаждение (C)</b><br><span>с осушением — модель ADP/BF</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="A">
          <b>💦 Адиабат. увлажн. (A)</b><br><span>h=const, форсунки/пэды</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="S">
          <b>♨ Паровое увлажн. (S)</b><br><span>t=const, +d</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="M">
          <b>🔀 Смешение (M)</b><br><span>с другой точкой по доле</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="R">
          <b>♻ Рекуператор (R)</b><br><span>теплообмен с вытяжкой по η</span>
        </button>
        <button type="button" class="psy-wiz-type" data-pt="X">
          <b>📍 Произвольный (X)</b><br><span>напрямую t,φ конечной точки</span>
        </button>
      </div>
    </div>
    <div class="psy-wiz-actions">
      <button type="button" class="psy-wiz-btn psy-wiz-cancel">Отмена</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.psy-wiz-close').addEventListener('click', close);
  overlay.querySelector('.psy-wiz-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.psy-wiz-type').forEach(btn => {
    btn.addEventListener('click', () => {
      const pt = btn.dataset.pt;
      overlay.remove();
      openWizardStep2(pt);
    });
  });
}

// Шаг 2 — данные конкретного процесса.
// v0.59.956: optional editProcIdx — если задан, wizard работает в режиме
// редактирования существующего процесса (а не создаёт новый):
//   • префилл fromIdx из текущего процесса
//   • префилл type-specific полей (recupWith/recupEff, mixWith/mixRatio, adp/bf)
//   • applyWizard обновит S.procs[editProcIdx] вместо push
// По репорту: «при открытии карточки процесса внутри можно запустить мастер
// процесса и изменить данные через мастер» — теперь wizard действительно
// редактирует, не дублирует.
function openWizardStep2(procType, editProcIdx) {
  const editing = Number.isFinite(editProcIdx) && S.procs[editProcIdx];
  const editProc = editing ? S.procs[editProcIdx] : null;
  const defaultFromIdx = editing
    ? edgeFrom(editProc, editProcIdx)
    : (S.points.length - 1);
  const PROC_LABELS = { P:'🔥 Нагрев', C:'❄ Охлаждение', A:'💦 Адиабат. увлажн.',
    S:'♨ Паровое увлажн.', M:'🔀 Смешение', R:'♻ Рекуператор', X:'📍 Произвольный' };

  const fromOpts = S.points.map((p, i) =>
    `<option value="${i}" ${i === defaultFromIdx ? 'selected' : ''}>${i+1}. ${escAttr((p.name || ('Точка ' + (i+1))).slice(0, 40))}${p.t ? ` · ${p.t}°C` : ''}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'psy-wiz-overlay';
  overlay.innerHTML = `<div class="psy-wiz-modal" role="dialog">
    <div class="psy-wiz-head"><h3>🧙 ${editing ? 'Редактирование' : ''} ${PROC_LABELS[procType]} — параметры</h3>
      <button type="button" class="psy-wiz-close" title="Закрыть">×</button>
    </div>
    <div class="psy-wiz-body">
      <label class="psy-wiz-from-label" style="display:block;margin-bottom:10px;font-weight:500">📍 От точки:
        <select id="wz-fromIdx" style="width:100%;margin-top:3px;padding:6px 10px;border:1px solid #d1d5db;border-radius:4px;font-size:13px">${fromOpts}</select>
      </label>
      <h4>Шаг 2 — введите ОДИН известный параметр (остальное рассчитается)</h4>
      ${wizardFields(procType)}
      <p class="psy-wiz-hint">Поля помечены ⓘ — заполните любое одно. Остальные оставьте пустыми.</p>
    </div>
    <div class="psy-wiz-actions">
      <button type="button" class="psy-wiz-btn psy-wiz-cancel">Отмена</button>
      ${editing ? '' : '<button type="button" class="psy-wiz-btn psy-wiz-back">← Назад</button>'}
      <button type="button" class="psy-wiz-btn psy-wiz-primary psy-wiz-apply">${editing ? '💾 Сохранить' : '✓ Создать'}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.psy-wiz-close').addEventListener('click', close);
  overlay.querySelector('.psy-wiz-cancel').addEventListener('click', close);
  const backBtn = overlay.querySelector('.psy-wiz-back');
  if (backBtn) backBtn.addEventListener('click', () => { close(); openProcessWizard(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  // v0.59.956: pre-fill полей из текущего процесса (edit-mode).
  if (editing) {
    const setField = (id, val) => {
      const el = overlay.querySelector('#' + id);
      if (el && val != null && val !== '') el.value = val;
    };
    if (procType === 'M') {
      setField('wz-mix',   editProc.mixWith);
      setField('wz-ratio', editProc.mixRatio);
    } else if (procType === 'R') {
      setField('wz-recref', editProc.recupWith);
      setField('wz-eta',    editProc.recupEff);
    }
    if (editProc.adp) setField('wz-adp', editProc.adp);
    if (editProc.bf)  setField('wz-bf',  editProc.bf);
    // V — из источника edge
    const srcV = S.points[edgeFrom(editProc, editProcIdx)]?.V;
    if (srcV) setField('wz-V', srcV);
    // Текущий target → пред-заполнить соответствующее поле
    const tgtPt = S.points[edgeTo(editProc, editProcIdx)];
    if (tgtPt) {
      if (tgtPt.tUser  && tgtPt.t  !== '') setField('wz-t2',  tgtPt.t);
      if (tgtPt.rhUser && tgtPt.rh !== '') setField('wz-phi2', tgtPt.rh);
      if (tgtPt.xUser  && tgtPt.x  !== '') setField('wz-d2',  tgtPt.x);
      if (tgtPt.hUser  && tgtPt.h  !== '') setField('wz-h2',  tgtPt.h);
    }
  }
  overlay.querySelector('.psy-wiz-apply').addEventListener('click', () => {
    const selFrom = overlay.querySelector('#wz-fromIdx');
    const fromIdx = selFrom ? Number(selFrom.value) : defaultFromIdx;
    if (applyWizard(procType, overlay, fromIdx, editProcIdx)) close();
  });
  // v0.59.907: preset selector — auto-fill полей при выборе
  const presetSel = overlay.querySelector('#wz-preset');
  if (presetSel) presetSel.addEventListener('change', () => {
    const preset = (WIZARD_PRESETS[procType] || []).find(p => p.id === presetSel.value);
    if (!preset) return;
    // Сначала очистить все известные поля, потом заполнить из preset
    ['wz-t2','wz-dt','wz-Q','wz-V','wz-phi2','wz-d2','wz-dd','wz-qw','wz-adp','wz-bf','wz-eta','wz-ratio'].forEach(id => {
      const el = overlay.querySelector('#' + id);
      if (el) el.value = '';
    });
    for (const [k, v] of Object.entries(preset.fields || {})) {
      const el = overlay.querySelector('#wz-' + k);
      if (el) el.value = v;
    }
  });
}

// v0.59.907: пресеты методик и типового оборудования.
// Каждый пресет — заранее заданный набор полей wizard, выбираемый из
// dropdown в шаге 2. Пользователь может оставить «Custom» и ввести вручную.
const WIZARD_PRESETS = {
  P: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'electric',    label: '⚡ Электрокалорифер · ΔT=+12°C', fields: { dt: 12 } },
    { id: 'water-low',   label: '🌡 Водяной 70/55 · ΔT=+25°C', fields: { dt: 25 } },
    { id: 'water-mid',   label: '🌡 Водяной 80/60 · ΔT=+35°C', fields: { dt: 35 } },
    { id: 'preheat',     label: '❄→🔥 Преднагрев · t₂=2°C (защита коил)', fields: { t2: 2 } },
    { id: 'reheat-comf', label: '🌬 Доводчик к 22°C', fields: { t2: 22 } },
  ],
  C: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'dx-coil',   label: '❄ DX-coil типовой (ADP 10°C, BF 0.15)', fields: { adp: 10, bf: 0.15 } },
    { id: 'cw-coil',   label: '❄ Чиллер 7/12°C (ADP 9°C, BF 0.10)', fields: { adp: 9, bf: 0.10 } },
    { id: 'cw-coil-deep', label: '❄ Чиллер 5/10°C, глубокая (ADP 7°C, BF 0.05)', fields: { adp: 7, bf: 0.05 } },
    { id: 'freecool', label: '🌬 Free-cool до 14°C (контакт)', fields: { t2: 14 } },
    { id: 'precool',  label: '🌬 Предохлаждение в 22°C', fields: { t2: 22 } },
    { id: 'desic',    label: '💨 Глубокое осушение φ₂=50%', fields: { phi2: 50, adp: 5, bf: 0.10 } },
  ],
  A: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'pad-typical', label: '💦 Адиабат. пэд η=0.85 → φ≈90%', fields: { phi2: 90 } },
    { id: 'pad-eff',     label: '💦 Высокоэффект. пэд → φ≈95%', fields: { phi2: 95 } },
    { id: 'spray',       label: '💧 Форсуночная камера → φ≈80%', fields: { phi2: 80 } },
  ],
  S: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'steam-low',  label: '♨ Паровой увлажн. +2 г/кг', fields: { dd: 2 } },
    { id: 'steam-mid',  label: '♨ Паровой увлажн. +5 г/кг', fields: { dd: 5 } },
    { id: 'steam-high', label: '♨ Паровой увлажн. +8 г/кг', fields: { dd: 8 } },
  ],
  M: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'rec-30', label: '🔄 Рециркуляция 30/70 (свежий/возврат)', fields: { ratio: 0.3 } },
    { id: 'rec-50', label: '🔄 Рециркуляция 50/50', fields: { ratio: 0.5 } },
    { id: 'rec-70', label: '🔄 Рециркуляция 70/30 (минимум приточного)', fields: { ratio: 0.7 } },
    { id: 'fresh-only', label: '🌫 Только свежий воздух', fields: { ratio: 1.0 } },
  ],
  R: [
    { id: 'custom', label: '✏ Custom (ввести вручную)', fields: {} },
    { id: 'rotary',     label: '♻ Роторный энтальпийный η=0.80', fields: { eta: 0.80 } },
    { id: 'plate-cross',label: '♻ Пластинч. перекрестный η=0.65', fields: { eta: 0.65 } },
    { id: 'plate-counter', label: '♻ Пластинч. противоток η=0.85', fields: { eta: 0.85 } },
    { id: 'glycol',     label: '♻ Гликолевый η=0.50 (раздел.)', fields: { eta: 0.50 } },
    { id: 'heatpipe',   label: '♻ Heat-pipe η=0.55', fields: { eta: 0.55 } },
  ],
  X: [{ id: 'custom', label: '✏ Custom', fields: {} }],
};

function presetSelector(pt) {
  const presets = WIZARD_PRESETS[pt] || [];
  if (presets.length <= 1) return '';
  return `<label style="margin-bottom:12px"><b>📚 Пресет (типовое оборудование/режим):</b>
    <select id="wz-preset" style="font-weight:500">
      ${presets.map(p => `<option value="${p.id}">${escAttr(p.label)}</option>`).join('')}
    </select>
  </label>
  <p class="psy-wiz-hint" style="margin:0 0 8px">Выберите пресет — поля заполнятся автоматически. Можно оставить «Custom» и ввести вручную.</p>`;
}

function wizardFields(pt) {
  const NODE_OPTS = S.points.map((p, i) => `<option value="${i}">${i+1}. ${escAttr((p.name||'').slice(0,30))}</option>`).join('');
  const presetUI = presetSelector(pt);
  if (pt === 'P') return presetUI + `
    <label>Целевая t₂, °C ⓘ<input type="number" id="wz-t2" step="0.5" placeholder="напр. 22"></label>
    <label>Прирост Δt, °C ⓘ<input type="number" id="wz-dt" step="0.5" placeholder="напр. +12"></label>
    <label>Мощность Q, кВт ⓘ<input type="number" id="wz-Q" step="1" placeholder="требуется V м³/ч (см. ниже)"></label>
    <label>Расход воздуха V, м³/ч (для Q)<input type="number" id="wz-V" step="100" placeholder="опционально"></label>
  `;
  if (pt === 'C') return presetUI + `
    <label>Целевая t₂, °C ⓘ<input type="number" id="wz-t2" step="0.5" placeholder="напр. 14"></label>
    <label>Целевая φ₂, % ⓘ<input type="number" id="wz-phi2" step="1" min="0" max="100" placeholder="напр. 90"></label>
    <label>Мощность охлаждения Q, кВт (отриц.) ⓘ<input type="number" id="wz-Q" step="1" placeholder="напр. -25"></label>
    <label>Расход воздуха V, м³/ч (для Q)<input type="number" id="wz-V" step="100" placeholder="опционально"></label>
    <hr style="margin:8px 0;border:0;border-top:1px solid #e0e0e0">
    <label>❄ ADP — T поверхности коил, °C (опц., точная модель)<input type="number" id="wz-adp" step="0.5" placeholder="напр. 10"></label>
    <label>BF — bypass factor (0..1, тип. 0.15)<input type="number" id="wz-bf" step="0.05" min="0" max="1" placeholder="0.15"></label>
  `;
  if (pt === 'A') return presetUI + `
    <label>Целевая t₂, °C ⓘ<input type="number" id="wz-t2" step="0.5" placeholder="ниже t_in (испарение охлаждает)"></label>
    <label>Целевая φ₂, % ⓘ<input type="number" id="wz-phi2" step="1" min="0" max="100" placeholder="напр. 90"></label>
    <label>Прирост Δd, г/кг ⓘ<input type="number" id="wz-dd" step="0.1" placeholder="напр. +3"></label>
  `;
  if (pt === 'S') return presetUI + `
    <label>Целевая d₂, г/кг ⓘ<input type="number" id="wz-d2" step="0.1" placeholder="напр. 8"></label>
    <label>Прирост Δd, г/кг ⓘ<input type="number" id="wz-dd" step="0.1" placeholder="напр. +2"></label>
    <label>Влагоприток qw, кг/ч ⓘ<input type="number" id="wz-qw" step="0.1" placeholder="требует V"></label>
    <label>Расход V, м³/ч (для qw)<input type="number" id="wz-V" step="100" placeholder="опционально"></label>
  `;
  if (pt === 'M') return presetUI + `
    <label>С какой точкой смешивать?<select id="wz-mix">${NODE_OPTS}</select></label>
    <label>Доля исходной (mixRatio, 0..1) ⓘ<input type="number" id="wz-ratio" step="0.05" min="0" max="1" placeholder="напр. 0.7 (рециркуляция)"></label>
  `;
  if (pt === 'R') return presetUI + `
    <label>Опорная точка (вытяжка)<select id="wz-recref">${NODE_OPTS}</select></label>
    <label>КПД рекуператора η (0..1) ⓘ<input type="number" id="wz-eta" step="0.05" min="0" max="1" placeholder="напр. 0.65"></label>
  `;
  if (pt === 'X') return `
    <label>t₂, °C<input type="number" id="wz-t2" step="0.5" placeholder="напр. 24"></label>
    <label>φ₂, %<input type="number" id="wz-phi2" step="1" min="0" max="100" placeholder="напр. 50"></label>
  `;
  return '';
}

function applyWizard(pt, overlay, fromIdx, editProcIdx) {
  const v = (id) => {
    const el = overlay.querySelector('#' + id);
    if (!el) return null;
    return el.value === '' ? null : Number(el.value);
  };
  // v0.59.956: editing-mode — переиспользуем существующий proc; иначе новый.
  const editing = Number.isFinite(editProcIdx) && S.procs[editProcIdx];
  const proc = editing
    ? Object.assign({}, S.procs[editProcIdx], { type: pt, Q: '', qw: '', fromIdx })
    : { type: pt, Q: '', qw: '', fromIdx };
  let t2 = v('wz-t2'), phi2 = v('wz-phi2'), dt = v('wz-dt'), dd = v('wz-dd'),
      d2 = v('wz-d2'), Q = v('wz-Q'), qw = v('wz-qw'), V = v('wz-V'),
      adp = v('wz-adp'), bf = v('wz-bf'), eta = v('wz-eta'), ratio = v('wz-ratio');
  let pickedTgt = null, pickedVal = null;
  // Choose primary target
  if (Number.isFinite(t2)) { pickedTgt = 't2'; pickedVal = t2; }
  else if (Number.isFinite(phi2)) { pickedTgt = 'phi2'; pickedVal = phi2; }
  else if (Number.isFinite(dt)) { pickedTgt = 'dt'; pickedVal = dt; }
  else if (Number.isFinite(d2)) { pickedTgt = 'd2'; pickedVal = d2; }
  else if (Number.isFinite(dd)) { pickedTgt = 'dd'; pickedVal = dd; }
  else if (Number.isFinite(Q)) { pickedTgt = 'Q'; pickedVal = Q; }
  else if (Number.isFinite(qw)) { pickedTgt = 'qw'; pickedVal = qw; }

  // v0.59.920: feasibility validation — проверяем физическую осмысленность
  // ввода до создания процесса. Если нелогично — предупреждаем, но не блокируем
  // (пользователь может всё равно создать).
  const fromPt = S.points[fromIdx];
  const tIn = Number(fromPt?.t);
  if (Number.isFinite(tIn)) {
    const warns = [];
    if (pt === 'P') {  // нагрев
      if (Number.isFinite(t2) && t2 < tIn) warns.push(`Нагрев: t₂=${t2}°C < t_in=${tIn}°C — это охлаждение (выберите C)`);
      if (Number.isFinite(dt) && dt < 0) warns.push(`Нагрев: Δt=${dt}°C — отрицательный (выберите C для охлаждения)`);
      if (Number.isFinite(Q) && Q < 0) warns.push(`Нагрев: Q=${Q} кВт — отрицательная мощность бессмысленна для P`);
    } else if (pt === 'C') {  // охлаждение
      if (Number.isFinite(t2) && t2 > tIn) warns.push(`Охлаждение: t₂=${t2}°C > t_in=${tIn}°C — это нагрев (выберите P)`);
      if (Number.isFinite(Q) && Q > 0) warns.push(`Охлаждение: Q=${Q} кВт — должна быть отрицательной для C`);
    } else if (pt === 'A') {  // адиабатическое увлажнение — испарение охлаждает
      if (Number.isFinite(t2) && t2 > tIn) warns.push(`Адиабат. увл.: t₂=${t2}°C > t_in=${tIn}°C — испарение охлаждает воздух (t₂ должна быть НИЖЕ)`);
      if (Number.isFinite(dd) && dd < 0) warns.push(`Адиабат. увл.: Δd=${dd} — увлажнение должно увеличивать d (положительное значение)`);
    } else if (pt === 'S') {  // паровое увлажнение — t примерно const
      if (Number.isFinite(dd) && dd < 0) warns.push(`Паровое увл.: Δd=${dd} — увлажнение положительное`);
    }
    if (warns.length) {
      // Показываем toast с warning, но не блокируем создание (пользователь
      // может всё равно знать что делает; рекомендуем правку тип процесса).
      psyToast(`⚠ ${warns[0]}`, 'warn');
      // Также сохраним warning для отображения на стрелке (renderProcArrow
      // показывает [data-role="proc-warn"]).
      proc._wizWarn = warns.join(' · ');
    }
  }

  if (pt === 'M') {
    const mixI = Number(overlay.querySelector('#wz-mix')?.value);
    if (!Number.isFinite(ratio)) { psyToast('Укажите долю смешения (mixRatio).', 'warn'); return false; }
    proc.mixWith = String(mixI);
    proc.mixRatio = String(ratio);
  } else if (pt === 'R') {
    const refI = Number(overlay.querySelector('#wz-recref')?.value);
    if (!Number.isFinite(eta)) { psyToast('Укажите КПД рекуператора η.', 'warn'); return false; }
    proc.recupWith = String(refI);
    proc.recupEff = String(eta);
  } else if (pt === 'X') {
    if (!Number.isFinite(t2) || !Number.isFinite(phi2)) {
      psyToast('Для произвольного процесса нужны t₂ и φ₂.', 'warn'); return false;
    }
    // X — задаём напрямую конечную точку, не процесс с целью
    pickedTgt = null;
  } else {
    if (!pickedTgt) {
      psyToast('Введите ОДИН известный параметр (t₂, φ₂, Q, и т.п.).', 'warn');
      return false;
    }
  }
  if (Number.isFinite(adp)) proc.adp = String(adp);
  if (Number.isFinite(bf)) proc.bf = String(bf);
  if (pickedTgt) {
    proc.tgt = pickedTgt;
    proc.tgtVal = String(pickedVal);
    proc.Qs = pickedTgt === 'Q'; proc.qws = pickedTgt === 'qw';
    if (pickedTgt === 'Q') { proc.Q = String(pickedVal); proc.Qts = Date.now(); }
    if (pickedTgt === 'qw') { proc.qw = String(pickedVal); proc.qwts = Date.now(); }
  }
  if (Number.isFinite(V) && V > 0) {
    // Запишем V в исходную точку (cascade использует srcNode.V для вычисления массы)
    const src = S.points[fromIdx]; if (src) src.V = String(V);
  }
  // v0.59.957: role-based имя для целевой точки. По репорту:
  //   «зачем в имя точки добавлять температуру точки если она не меняется
  //   после изменения целевой точки. Зачем имени точки давать имя которое
  //   отождествляется с процессом (Охлаждение до...)».
  // Раньше имена выглядели как «Нагрев до 22°C» — а если t позже менялось,
  // имя становилось неправдой. Теперь — описательное имя роли без фикс.
  // значений: «После нагревателя», «После охладителя», и т.д.
  // Фиксированные значения отображаются в самой точке (поля t/φ/d/h),
  // имя описывает РОЛЬ, не конкретное состояние.
  const newName = PROC_NAME_OUT[pt] || 'Точка';
  const newPoint = { name: newName, nameUser: true, t: '', rh: '', x: '', h: '', V: '' };
  // v0.59.954: Bug-fix: cascade читает target из p.tUser/rhUser/xUser/hUser,
  // а wizard раньше писал только в proc.tgt/tgtVal — cascade их не видел и
  // целевая точка оставалась пустой. По репорту: «мастер не заполняет
  // конечную точку, хотя она была задана».
  // Теперь пишем target ДОПОЛНИТЕЛЬНО в поля целевой точки.
  const tNow = performance.now();
  if (pt === 'X') {
    if (Number.isFinite(t2))   { newPoint.t  = String(t2);   newPoint.tUser  = true; newPoint.tTs  = tNow; }
    if (Number.isFinite(phi2)) { newPoint.rh = String(phi2); newPoint.rhUser = true; newPoint.rhTs = tNow + 0.01; }
  } else if (pickedTgt === 't2') {
    newPoint.t  = String(pickedVal); newPoint.tUser  = true; newPoint.tTs  = tNow;
  } else if (pickedTgt === 'phi2') {
    newPoint.rh = String(pickedVal); newPoint.rhUser = true; newPoint.rhTs = tNow;
  } else if (pickedTgt === 'd2') {
    newPoint.x  = String(pickedVal); newPoint.xUser  = true; newPoint.xTs  = tNow;
  } else if (pickedTgt === 'dt') {
    // Δt → абсолютное t2 на основе t_in (зафиксируем сейчас, чтобы cascade видел)
    const tIn = Number(fromPt?.t);
    if (Number.isFinite(tIn)) {
      newPoint.t = String(tIn + pickedVal); newPoint.tUser = true; newPoint.tTs = tNow;
    }
  } else if (pickedTgt === 'dd') {
    // Δd → абсолютное W2 г/кг на основе W_in
    const dIn = Number(fromPt?.x);
    if (Number.isFinite(dIn)) {
      newPoint.x = String(dIn + pickedVal); newPoint.xUser = true; newPoint.xTs = tNow;
    }
  } else if (pickedTgt === 'h2') {
    newPoint.h = String(pickedVal); newPoint.hUser = true; newPoint.hTs = tNow;
  }
  // Для Q/qw target — proc.Qs/qws уже установлены выше, cascade читает с proc.
  // v0.59.956: editing-mode — обновляем существующую целевую точку
  // и проц, не создаём новые. Иначе — стандартный push.
  if (editing) {
    const tgtIdx = edgeTo(S.procs[editProcIdx], editProcIdx);
    const tgtPt = S.points[tgtIdx];
    if (tgtPt) {
      // Перезаписываем target-поля из newPoint (cascade пересчитает остальные)
      tgtPt.name = newPoint.name; tgtPt.nameUser = true;
      // Сбрасываем ВСЕ user-флаги, потом ставим только заданный target
      ['t','rh','x','h'].forEach(f => {
        tgtPt[f] = '';
        tgtPt[f + 'User'] = false;
        tgtPt[f + 'Ts'] = 0;
      });
      // Применяем target из newPoint
      ['t','rh','x','h'].forEach(f => {
        if (newPoint[f + 'User']) {
          tgtPt[f] = newPoint[f];
          tgtPt[f + 'User'] = true;
          tgtPt[f + 'Ts'] = newPoint[f + 'Ts'] || tNow;
        }
      });
    }
    proc.toIdx = tgtIdx;
    S.procs[editProcIdx] = proc;
    rerenderCycle();
    psyToast(`💾 Обновлено: ${newName}`, 'ok');
    return true;
  }
  S.points.push(newPoint);
  proc.toIdx = S.points.length - 1;
  S.procs.push(proc);
  rerenderCycle();
  psyToast(`✓ Создано: ${newName}`, 'ok');
  return true;
}

// ========================================================================
// v0.59.911: Бесконечный canvas с pan/zoom/fit (CAD-style)
// State хранится в S.canvasView = { tx, ty, scale }, persists в LS.
// Pan: drag пустой области canvas (но не поверх узлов/zones).
// Zoom: wheel (с origin под курсором).
// Fit: кнопка ⊞ или dblclick на пустой области — вписывает все узлы.
// ========================================================================
// v0.59.918: вычисляет центр текущего viewport в координатах canvas-inner
// (с учётом pan tx/ty и scale). Полезно для размещения новых точек.
function computeViewportCenter() {
  const canvas = document.getElementById('psy-canvas');
  if (!canvas) return { x: 200, y: 200 };
  const v = S.canvasView || { tx: 0, ty: 0, scale: 1 };
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  return {
    x: (cw / 2 - v.tx) / (v.scale || 1),
    y: (ch / 2 - v.ty) / (v.scale || 1),
  };
}

// v0.59.917: глобальная fit-функция для canvas (используется тоже из
// recup/recirc-кнопок). Вычисляется отдельно, без замыкания на wireInfiniteCanvas.
function fitCanvas() {
  const canvas = document.getElementById('psy-canvas');
  const inner  = document.getElementById('psy-canvas-inner');
  if (!canvas || !inner) return;
  const points = S.points || [];
  const zones = S.zones || [];
  if (!points.length && !zones.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const cx = Number(p.cx) || 0, cy = Number(p.cy) || 0;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx + 200 > maxX) maxX = cx + 200;
    if (cy + 220 > maxY) maxY = cy + 220;
  }
  for (const z of zones) {
    const cx = Number(z.cx) || 0, cy = Number(z.cy) || 0;
    const w = Number(z.w) || 200, h = Number(z.h) || 200;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx + w > maxX) maxX = cx + w;
    if (cy + h > maxY) maxY = cy + h;
  }
  if (!Number.isFinite(minX)) return;
  const padding = 40;
  minX -= padding; minY -= padding; maxX += padding; maxY += padding;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const contentW = maxX - minX, contentH = maxY - minY;
  const scale = Math.min(cw / contentW, ch / contentH, 1.5);
  if (!S.canvasView) S.canvasView = { tx: 0, ty: 0, scale: 1 };
  S.canvasView.scale = Math.max(0.15, scale);
  S.canvasView.tx = (cw - contentW * S.canvasView.scale) / 2 - minX * S.canvasView.scale;
  S.canvasView.ty = (ch - contentH * S.canvasView.scale) / 2 - minY * S.canvasView.scale;
  inner.style.transform = `translate3d(${S.canvasView.tx}px, ${S.canvasView.ty}px, 0) scale(${S.canvasView.scale})`;
  const lab = document.getElementById('psy-canvas-zoom');
  if (lab) lab.textContent = Math.round(S.canvasView.scale * 100) + '%';
  const gridSize = 20 * S.canvasView.scale;
  canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  canvas.style.backgroundPosition = `${S.canvasView.tx}px ${S.canvasView.ty}px`;
  try { localStorage.setItem('psy.canvasView', JSON.stringify(S.canvasView)); } catch {}
}

function wireInfiniteCanvas() {
  const canvas = document.getElementById('psy-canvas');
  const inner  = document.getElementById('psy-canvas-inner');
  if (!canvas || !inner) return;

  // Восстановить view из LS
  try {
    const saved = JSON.parse(localStorage.getItem('psy.canvasView') || 'null');
    if (saved && Number.isFinite(saved.tx) && Number.isFinite(saved.ty) && Number.isFinite(saved.scale)) {
      S.canvasView = saved;
    }
  } catch {}
  if (!S.canvasView) S.canvasView = { tx: 0, ty: 0, scale: 1 };

  const apply = (animate = false) => {
    const v = S.canvasView;
    if (!animate) inner.classList.add('psy-no-trans');
    inner.style.transform = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.scale})`;
    if (!animate) requestAnimationFrame(() => inner.classList.remove('psy-no-trans'));
    const lab = document.getElementById('psy-canvas-zoom');
    if (lab) lab.textContent = Math.round(v.scale * 100) + '%';
    // v0.59.912: динамический grid на viewport — следует за pan/zoom,
    // выглядит «бесконечным». Размер ячейки 20px × scale.
    const gridSize = 20 * v.scale;
    canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    canvas.style.backgroundPosition = `${v.tx}px ${v.ty}px`;
    try { localStorage.setItem('psy.canvasView', JSON.stringify(S.canvasView)); } catch {}
  };
  apply(true);

  // ─── Pan: mousedown на пустой области canvas (не на point/zone)
  let panning = false, panStart = null;
  canvas.addEventListener('mousedown', (e) => {
    // Только если клик НЕ по узлу/zone/инпуту/кнопке — чтобы не мешать редактированию
    if (e.target.closest('.psy-point, .psy-canvas-zone, .psy-canvas-toolbar, input, select, button, textarea, .psy-canvas-zone-resize')) return;
    if (e.button !== 0 && e.button !== 1) return;  // только левая или средняя
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, tx: S.canvasView.tx, ty: S.canvasView.ty };
    canvas.classList.add('psy-panning');
    document.body.classList.add('psy-dragging');  // v0.59.950: предотвращаем выделение текста при pan
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    S.canvasView.tx = panStart.tx + (e.clientX - panStart.x);
    S.canvasView.ty = panStart.ty + (e.clientY - panStart.y);
    apply();
  });
  window.addEventListener('mouseup', () => {
    if (!panning) return;
    panning = false;
    canvas.classList.remove('psy-panning');
    document.body.classList.remove('psy-dragging');
  });

  // ─── Zoom: wheel с origin под курсором
  canvas.addEventListener('wheel', (e) => {
    if (e.target.closest('.psy-canvas-toolbar, input[type="number"]')) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.1, Math.min(3.0, S.canvasView.scale * factor));
    if (newScale === S.canvasView.scale) return;
    // Сохранить точку под курсором фиксированной
    const k = newScale / S.canvasView.scale;
    S.canvasView.tx = mx - k * (mx - S.canvasView.tx);
    S.canvasView.ty = my - k * (my - S.canvasView.ty);
    S.canvasView.scale = newScale;
    apply();
  }, { passive: false });

  // ─── Fit: кнопка / двойной клик
  const fit = () => {
    const points = S.points || [];
    const zones = S.zones || [];
    if (!points.length && !zones.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const cx = Number(p.cx) || 0, cy = Number(p.cy) || 0;
      const w = 200, h = 220;  // PSY_NODE_W/PSY_NODE_H approx
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx + w > maxX) maxX = cx + w;
      if (cy + h > maxY) maxY = cy + h;
    }
    for (const z of zones) {
      const cx = Number(z.cx) || 0, cy = Number(z.cy) || 0;
      const w = Number(z.w) || 200, h = Number(z.h) || 200;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx + w > maxX) maxX = cx + w;
      if (cy + h > maxY) maxY = cy + h;
    }
    if (!Number.isFinite(minX)) return;
    const padding = 40;
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const contentW = maxX - minX, contentH = maxY - minY;
    const scale = Math.min(cw / contentW, ch / contentH, 1.5);
    S.canvasView.scale = Math.max(0.15, scale);
    S.canvasView.tx = (cw - contentW * S.canvasView.scale) / 2 - minX * S.canvasView.scale;
    S.canvasView.ty = (ch - contentH * S.canvasView.scale) / 2 - minY * S.canvasView.scale;
    apply(true);
  };

  // Toolbar buttons
  canvas.querySelectorAll('[data-cv-act]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.cvAct;
      if (act === 'zoom-in') {
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        const factor = 1.2;
        const newScale = Math.min(3, S.canvasView.scale * factor);
        const k = newScale / S.canvasView.scale;
        S.canvasView.tx = cw / 2 - k * (cw / 2 - S.canvasView.tx);
        S.canvasView.ty = ch / 2 - k * (ch / 2 - S.canvasView.ty);
        S.canvasView.scale = newScale;
        apply(true);
      } else if (act === 'zoom-out') {
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        const factor = 1 / 1.2;
        const newScale = Math.max(0.15, S.canvasView.scale * factor);
        const k = newScale / S.canvasView.scale;
        S.canvasView.tx = cw / 2 - k * (cw / 2 - S.canvasView.tx);
        S.canvasView.ty = ch / 2 - k * (ch / 2 - S.canvasView.ty);
        S.canvasView.scale = newScale;
        apply(true);
      } else if (act === 'fit') fit();
      else if (act === 'reset') {
        S.canvasView = { tx: 0, ty: 0, scale: 1 };
        apply(true);
      }
    });
  });

  // Двойной клик по пустой области = fit
  canvas.addEventListener('dblclick', (e) => {
    if (e.target.closest('.psy-point, .psy-canvas-zone, .psy-canvas-toolbar, input, select, button, textarea')) return;
    fit();
  });

  // v0.59.912: убрал document-keydown шорткаты — они могли перехватывать
  // ввод в input полях (включая psy-add и др.). Если нужны — навешу на canvas.
}

// v0.59.928: модал выбора design-точки для импорта из meteo.
// Возвращает выбранный tag или null при отмене.
function openDesignPointPicker(designs, locName) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'psy-wiz-overlay';
    const rows = designs.map(d => `
      <button type="button" class="psy-design-pt" data-tag="${escAttr(d.tag)}">
        <span class="psy-design-pt-icon">${escAttr(d.shortLabel.slice(0, 2))}</span>
        <span class="psy-design-pt-body">
          <b>${escAttr(d.shortLabel.slice(2).trim())}</b>
          <span class="psy-design-pt-vals">${d.t.toFixed(1)} °C · RH ~${d.rhDef}%</span>
          <span class="psy-design-pt-hint">${escAttr(d.hint)}</span>
        </span>
      </button>
    `).join('');
    overlay.innerHTML = `<div class="psy-wiz-modal" role="dialog" style="width:min(560px,92vw)">
      <div class="psy-wiz-head"><h3>📍 Какую точку добавить?</h3>
        <button type="button" class="psy-wiz-close">×</button>
      </div>
      <div class="psy-wiz-body">
        <p class="psy-wiz-from">Локация: <b>${escAttr(locName)}</b>. Выберите ОДИН design-режим:</p>
        <div class="psy-design-pt-list">${rows}</div>
      </div>
      <div class="psy-wiz-actions">
        <button type="button" class="psy-wiz-btn psy-wiz-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.psy-wiz-close').addEventListener('click', () => close(null));
    overlay.querySelector('.psy-wiz-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelectorAll('.psy-design-pt').forEach(b => {
      b.addEventListener('click', () => close(b.dataset.tag));
    });
  });
}

// v0.59.927: рендер chip с активным meteo-датасетом проекта.
// Async — meteo-api.js загружается lazy.
async function renderMeteoChip() {
  const chip = document.getElementById('psy-meteo-chip');
  if (!chip) return;
  try {
    const { getActiveDataset } = await import('../meteo/meteo-api.js');
    const { ensureDefaultProject } = await import('../shared/project-storage.js');
    const pid = ensureDefaultProject();
    const ds = getActiveDataset(pid);
    if (!ds) {
      chip.hidden = true;
      return;
    }
    const s = ds.stats || {};
    const period = ds.dateFrom && ds.dateTo ? `${ds.dateFrom}…${ds.dateTo}` : '';
    chip.hidden = false;
    chip.innerHTML = `
      <span class="psy-meteo-chip-icon">📍</span>
      <span class="psy-meteo-chip-name">${escAttr(ds.locationName || ds.name || 'Активный meteo')}</span>
      <span class="psy-meteo-chip-stats">${period} · T ${s.tmin ?? '—'}…${s.tmax ?? '—'} °C · средн ${s.tmean ?? '—'} °C · ${ds.hourly?.length || s.n || 0} ч</span>
      <a class="psy-meteo-chip-link" href="../meteo/" target="_blank" title="Открыть модуль «Метеоданные»">↗ Открыть meteo</a>
    `;
  } catch (e) {
    chip.hidden = true;
  }
}

// v0.59.921: named cycles в LS — { name: { points, procs, zones } }
const NAMED_CYCLES_KEY = 'psy.namedCycles.v1';
function loadNamedCycles() {
  try { return JSON.parse(localStorage.getItem(NAMED_CYCLES_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveNamedCycles(obj) {
  try { localStorage.setItem(NAMED_CYCLES_KEY, JSON.stringify(obj || {})); } catch {}
}
function refreshNamedCyclesList() {
  const sel = document.getElementById('psy-named-cycles');
  if (!sel) return;
  const cycles = loadNamedCycles();
  const names = Object.keys(cycles);
  // Перестраиваем список — все существующие named-cycles сверху, потом __save__ / __manage__
  sel.innerHTML = `
    <option value="">📁 Циклы (${names.length})…</option>
    ${names.map(n => `<option value="${escAttr(n)}">▸ ${escAttr(n)}</option>`).join('')}
    <option value="__save__">💾 Сохранить текущий цикл как…</option>
    <option value="__manage__">🗑 Удалить сохранённые…</option>
  `;
}

// Inline-prompt замена для browser prompt (No browser dialogs правило).
function psyPrompt(title, placeholder = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'psy-wiz-overlay';
    overlay.innerHTML = `<div class="psy-wiz-modal" style="width:min(420px,92vw)" role="dialog">
      <div class="psy-wiz-head"><h3>${escAttr(title)}</h3>
        <button type="button" class="psy-wiz-close" title="Закрыть">×</button>
      </div>
      <div class="psy-wiz-body">
        <input type="text" id="psy-prompt-input" placeholder="${escAttr(placeholder)}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:4px;font-size:13px" autofocus>
      </div>
      <div class="psy-wiz-actions">
        <button type="button" class="psy-wiz-btn psy-wiz-cancel">Отмена</button>
        <button type="button" class="psy-wiz-btn psy-wiz-primary psy-wiz-ok">OK</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector('#psy-prompt-input');
    setTimeout(() => inp?.focus(), 50);
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') close(inp.value);
    };
    overlay.querySelector('.psy-wiz-close').addEventListener('click', () => close(null));
    overlay.querySelector('.psy-wiz-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.psy-wiz-ok').addEventListener('click', () => close(inp.value));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
  });
}

// Глобальный psyToast (nested-копия в wire() остаётся для backward-compat).
// Использует тот же visual.
function psyToast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:16px;right:16px;z-index:10001;padding:10px 14px;border-radius:5px;font:13px system-ui;color:#f9fafb;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:360px;background:${kind==='warn'?'#b45309':kind==='ok'?'#15803d':'#1f2937'};opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 2800);
}

document.addEventListener('DOMContentLoaded', wire);
