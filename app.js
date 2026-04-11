/* =========================================================================
   Raschet — конструктор принципиальных схем электроснабжения
   ------------------------------------------------------------------------
   Архитектура:
     state.nodes : Map<id, Node>     — узлы (источники, генераторы, щиты, потребители)
     state.conns : Map<id, Conn>     — связи между портами
     state.view  : {x, y, zoom}      — параметры viewBox
   Расчёт мощности: recalc() — каскадная передача demand от потребителей
   вверх по активным цепям с учётом АВР (приоритеты) и резервных генераторов.
   ========================================================================= */

(() => {
'use strict';

// ================= Константы =================
const NODE_W = 170;
const NODE_H = 96;
const PORT_R = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Типы узлов и их параметры по умолчанию
const DEFAULTS = {
  source:    () => ({ name: 'Ввод ТП',    capacityKw: 100, on: true }),
  generator: () => ({ name: 'ДГУ',         capacityKw: 60,  on: true, backupMode: true }),
  panel:     () => ({ name: 'ЩС',          inputs: 2, outputs: 2, priorities: [1, 2, 3] }),
  consumer:  () => ({ name: 'Потребитель', demandKw: 10 }),
};

// ================= Состояние =================
const state = {
  nodes: new Map(),
  conns: new Map(),
  selectedId: null,
  view: { x: 0, y: 0, zoom: 1 },
  pending: null, // { fromNodeId, fromPort, mouseX, mouseY }
  drag: null,    // { nodeId, dx, dy } либо { pan: true, sx, sy, vx, vy }
};

let _idSeq = 1;
const uid = (p = 'n') => `${p}${_idSeq++}`;

// ================= DOM refs =================
const svg        = document.getElementById('canvas');
const viewport   = document.getElementById('viewport');
const layerConns = document.getElementById('layer-conns');
const layerNodes = document.getElementById('layer-nodes');
const layerOver  = document.getElementById('layer-overlay');
const inspectorBody = document.getElementById('inspector-body');
const statsEl    = document.getElementById('stats');

// ================= Геометрия портов =================
function nodeInputCount(n) {
  if (n.type === 'consumer') return 1;
  if (n.type === 'source' || n.type === 'generator') return 0;
  return n.inputs;
}
function nodeOutputCount(n) {
  if (n.type === 'consumer') return 0;
  if (n.type === 'source' || n.type === 'generator') return 1;
  return n.outputs;
}
function portPos(n, kind, idx) {
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const gap = NODE_W / (count + 1);
  const px = n.x + gap * (idx + 1);
  const py = kind === 'in' ? n.y : n.y + NODE_H;
  return { x: px, y: py };
}

// ================= Создание / удаление =================
function createNode(type, x, y) {
  const id = uid();
  const base = { id, type, x: x - NODE_W / 2, y: y - NODE_H / 2, ...DEFAULTS[type]() };
  state.nodes.set(id, base);
  selectNode(id);
  render();
  return id;
}

function deleteNode(id) {
  for (const c of Array.from(state.conns.values())) {
    if (c.from.nodeId === id || c.to.nodeId === id) state.conns.delete(c.id);
  }
  state.nodes.delete(id);
  if (state.selectedId === id) state.selectedId = null;
  render();
  renderInspector();
}

function deleteConn(id) {
  state.conns.delete(id);
  render();
}

// Обрезка портов при уменьшении их числа у щита
function clampPortsInvolvingNode(n) {
  for (const c of Array.from(state.conns.values())) {
    if (c.to.nodeId === n.id && c.to.port >= nodeInputCount(n)) state.conns.delete(c.id);
    if (c.from.nodeId === n.id && c.from.port >= nodeOutputCount(n)) state.conns.delete(c.id);
  }
}

// ================= Связи =================
function wouldCreateCycle(fromNodeId, toNodeId) {
  // DFS вниз от toNodeId по исходящим связям — если дойдём до fromNodeId, цикл
  const stack = [toNodeId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromNodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId === cur) stack.push(c.to.nodeId);
    }
  }
  return false;
}

function tryConnect(from, to) {
  if (from.nodeId === to.nodeId) return false;
  // Проверка: порт уже занят? (один вход — один источник)
  for (const c of state.conns.values()) {
    if (c.to.nodeId === to.nodeId && c.to.port === to.port) return false;
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId)) return false;
  const id = uid('c');
  state.conns.set(id, { id, from, to });
  return true;
}

// ================= Расчёт мощности =================
/*
 * Алгоритм:
 *   1. Строим edgesIn / edgesOut.
 *   2. powerOf(nodeId, allowBackup) — рекурсивно определяет, запитан ли узел,
 *      какая связь на входе выбрана (активный фидер по приоритету АВР),
 *      и учитывает резервные генераторы только при allowBackup=true.
 *   3. Для каждого потребителя идём вверх по активным активным фидерам
 *      и добавляем его demandKw ко всем промежуточным щитам и конечному источнику.
 */
function recalc() {
  const edgesIn = new Map();
  for (const n of state.nodes.values()) edgesIn.set(n.id, []);
  for (const c of state.conns.values()) edgesIn.get(c.to.nodeId).push(c);

  const cache = new Map();
  function powerOf(nid, allowBackup) {
    const key = nid + '|' + (allowBackup ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    // Временная метка для предотвращения бесконечной рекурсии (на случай ошибки валидации)
    cache.set(key, { powered: false, activeIn: null });

    const n = state.nodes.get(nid);
    let res;

    if (n.type === 'source') {
      res = { powered: !!n.on, activeIn: null };

    } else if (n.type === 'generator') {
      if (!n.on) res = { powered: false, activeIn: null };
      else if (n.backupMode && !allowBackup) res = { powered: false, activeIn: null };
      else res = { powered: true, activeIn: null };

    } else {
      // panel или consumer: нужен хотя бы один запитанный вход
      const ins = edgesIn.get(nid) || [];
      // отсортировать по приоритету (для consumer — приоритет не важен, один вход)
      const ranked = ins.map(c => ({
        conn: c,
        prio: (n.type === 'panel' && n.priorities)
                ? (n.priorities[c.to.port] ?? 99)
                : 1,
      })).sort((a, b) => a.prio - b.prio);

      let chosen = null;
      // Шаг 1: ищем фидер, запитанный БЕЗ резервного генератора
      for (const r of ranked) {
        const up = powerOf(r.conn.from.nodeId, false);
        if (up.powered) { chosen = r.conn; break; }
      }
      // Шаг 2: если не нашли и разрешён резерв — пробуем с резервом
      if (!chosen && allowBackup) {
        for (const r of ranked) {
          const up = powerOf(r.conn.from.nodeId, true);
          if (up.powered) { chosen = r.conn; break; }
        }
      }
      res = { powered: !!chosen, activeIn: chosen };
    }

    cache.set(key, res);
    return res;
  }

  // Сброс служебных полей
  for (const n of state.nodes.values()) {
    n._loadKw = 0;
    n._powered = false;
    n._overload = false;
  }
  for (const c of state.conns.values()) c._active = false;

  // Распространение нагрузки от каждого потребителя вверх
  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const r = powerOf(n.id, true);
    n._powered = r.powered;
    if (!r.powered) continue;

    const demand = Number(n.demandKw) || 0;
    n._loadKw = demand;

    // идём вверх
    let curId = n.id;
    let guard = 0;
    while (guard++ < 256) {
      const pr = powerOf(curId, true);
      if (!pr.activeIn) break;
      pr.activeIn._active = true;
      const up = state.nodes.get(pr.activeIn.from.nodeId);
      up._loadKw = (up._loadKw || 0) + demand;
      up._powered = true;
      if (up.type === 'source' || up.type === 'generator') break;
      curId = up.id;
    }
  }

  // Пометка источников/щитов, которые запитаны, но без нагрузки
  for (const n of state.nodes.values()) {
    if (n.type === 'source' || n.type === 'generator') {
      const pr = powerOf(n.id, true);
      n._powered = pr.powered;
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    }
    if (n.type === 'panel') {
      const pr = powerOf(n.id, true);
      if (!n._powered) n._powered = pr.powered;
    }
  }
}

// ================= Рендер =================
function updateViewBox() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const vw = W / state.view.zoom;
  const vh = H / state.view.zoom;
  svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${vw} ${vh}`);
  document.getElementById('bg').setAttribute('x', state.view.x);
  document.getElementById('bg').setAttribute('y', state.view.y);
  document.getElementById('bg').setAttribute('width', vw);
  document.getElementById('bg').setAttribute('height', vh);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

function render() {
  recalc();
  renderConns();
  renderNodes();
  renderStats();
}

function renderNodes() {
  while (layerNodes.firstChild) layerNodes.removeChild(layerNodes.firstChild);

  for (const n of state.nodes.values()) {
    const g = el('g', {
      class: 'node ' + n.type +
             (state.selectedId === n.id ? ' selected' : '') +
             (n._overload ? ' overload' : '') +
             (!n._powered && (n.type === 'panel' || n.type === 'consumer') ? ' unpowered' : ''),
      transform: `translate(${n.x},${n.y})`,
    });
    g.dataset.nodeId = n.id;

    // Тело
    g.appendChild(el('rect', {
      class: 'node-body',
      x: 0, y: 0, width: NODE_W, height: NODE_H,
    }));

    // Заголовок
    g.appendChild(text(12, 22, n.name || '(без имени)', 'node-title'));

    // Подпись типа
    const subText = {
      source: 'Источник',
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel: `Щит · вх ${n.inputs} · вых ${n.outputs}`,
      consumer: 'Потребитель',
    }[n.type];
    g.appendChild(text(12, 38, subText, 'node-sub'));

    // Данные мощности
    let loadLine = '';
    let loadCls = 'node-load';
    if (n.type === 'source' || n.type === 'generator') {
      if (!n.on) { loadLine = 'Отключён'; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} кВт`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'panel') {
      if (!n._powered) { loadLine = 'Без питания'; loadCls += ' off'; }
      else loadLine = `${fmt(n._loadKw)} кВт`;
    } else if (n.type === 'consumer') {
      if (!n._powered) { loadLine = `${fmt(n.demandKw)} кВт · нет`; loadCls += ' off'; }
      else loadLine = `${fmt(n.demandKw)} кВт`;
    }
    g.appendChild(text(12, NODE_H - 12, loadLine, loadCls));

    // Порты — входы (сверху)
    const inCount = nodeInputCount(n);
    for (let i = 0; i < inCount; i++) {
      const gap = NODE_W / (inCount + 1);
      const cx = gap * (i + 1);
      const circ = el('circle', {
        class: 'port in', cx, cy: 0, r: PORT_R,
      });
      circ.dataset.portKind = 'in';
      circ.dataset.portIdx  = i;
      circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // Метка приоритета (если панель с >1 входами)
      if (n.type === 'panel' && n.inputs > 1) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        g.appendChild(text(cx - 3, -10, String(prio), 'port-label'));
      }
    }

    // Порты — выходы (снизу)
    const outCount = nodeOutputCount(n);
    for (let i = 0; i < outCount; i++) {
      const gap = NODE_W / (outCount + 1);
      const cx = gap * (i + 1);
      const circ = el('circle', {
        class: 'port out', cx, cy: NODE_H, r: PORT_R,
      });
      circ.dataset.portKind = 'out';
      circ.dataset.portIdx  = i;
      circ.dataset.nodeId = n.id;
      g.appendChild(circ);
    }

    layerNodes.appendChild(g);
  }
}

function text(x, y, str, cls) {
  const t = el('text', { x, y, class: cls });
  t.textContent = str;
  return t;
}

function renderConns() {
  while (layerConns.firstChild) layerConns.removeChild(layerConns.firstChild);
  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const path = el('path', {
      class: 'conn' + (c._active ? ' active' : ' dead'),
      d: bezier(a, b),
    });
    path.dataset.connId = c.id;
    layerConns.appendChild(path);
  }
}

function bezier(a, b) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
}

function fmt(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toString();
}

// ================= Статистика =================
function renderStats() {
  let totalDemand = 0, totalCap = 0, totalDraw = 0;
  let unpoweredCount = 0, overloadCount = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      totalDemand += Number(n.demandKw) || 0;
      if (!n._powered) unpoweredCount++;
    }
    if (n.type === 'source' || n.type === 'generator') {
      if (n.on) totalCap += Number(n.capacityKw) || 0;
      totalDraw += n._loadKw || 0;
      if (n._overload) overloadCount++;
    }
  }
  const rows = [];
  rows.push(`<div class="row"><span>Запрос</span><span>${fmt(totalDemand)} кВт</span></div>`);
  rows.push(`<div class="row"><span>Источников</span><span>${fmt(totalCap)} кВт</span></div>`);
  rows.push(`<div class="row"><span>Потребляется</span><span>${fmt(totalDraw)} кВт</span></div>`);
  if (unpoweredCount) rows.push(`<div class="row warn"><span>Без питания</span><span>${unpoweredCount}</span></div>`);
  if (overloadCount)  rows.push(`<div class="row warn"><span>Перегруз</span><span>${overloadCount}</span></div>`);
  if (!unpoweredCount && !overloadCount && state.nodes.size) {
    rows.push(`<div class="row ok"><span>Статус</span><span>OK</span></div>`);
  }
  statsEl.innerHTML = rows.join('');
}

// ================= Инспектор =================
function selectNode(id) {
  state.selectedId = id;
  renderInspector();
}

function renderInspector() {
  const id = state.selectedId;
  if (!id || !state.nodes.has(id)) {
    inspectorBody.innerHTML = '<div class="muted">Выберите элемент или перетащите новый из палитры.</div>';
    return;
  }
  const n = state.nodes.get(id);
  const h = [];

  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

  if (n.type === 'source') {
    h.push(field('Мощность, кВт', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(checkField('В работе', 'on', n.on));
  } else if (n.type === 'generator') {
    h.push(field('Мощность, кВт', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(checkField('В работе', 'on', n.on));
    h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
  } else if (n.type === 'panel') {
    h.push(field('Входов', `<select data-prop="inputs"><option${n.inputs===1?' selected':''}>1</option><option${n.inputs===2?' selected':''}>2</option><option${n.inputs===3?' selected':''}>3</option></select>`));
    h.push(field('Выходов', `<select data-prop="outputs"><option${n.outputs===1?' selected':''}>1</option><option${n.outputs===2?' selected':''}>2</option><option${n.outputs===3?' selected':''}>3</option></select>`));
    if (n.inputs > 1) {
      h.push('<div class="inspector-section"><h4>Приоритеты входов (АВР)</h4>');
      h.push('<div class="muted" style="font-size:11px;margin-bottom:6px">1 = основной, чем больше — тем ниже приоритет</div>');
      for (let i = 0; i < n.inputs; i++) {
        const v = n.priorities?.[i] ?? (i + 1);
        h.push(field(`Вход ${i + 1}`, `<input type="number" min="1" max="9" step="1" data-prio="${i}" value="${v}">`));
      }
      h.push('</div>');
    }
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Нагрузка: <b>${fmt(n._loadKw)} кВт</b>${n._powered ? ' <span class="badge on">есть питание</span>' : ' <span class="badge off">без питания</span>'}</div></div>`);
  } else if (n.type === 'consumer') {
    h.push(field('Потребление, кВт', `<input type="number" min="0" step="0.1" data-prop="demandKw" value="${n.demandKw}">`));
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Статус: ${n._powered ? '<span class="badge on">запитан</span>' : '<span class="badge off">нет питания</span>'}</div></div>`);
  }

  h.push('<button class="btn-delete" id="btn-del-node">Удалить элемент</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписки
  inspectorBody.querySelectorAll('[data-prop]').forEach(inp => {
    inp.addEventListener('input', () => {
      const prop = inp.dataset.prop;
      let v = inp.type === 'number' ? Number(inp.value) : inp.value;
      if (inp.tagName === 'SELECT' && (prop === 'inputs' || prop === 'outputs')) v = Number(inp.value);
      if (inp.type === 'checkbox') v = inp.checked;
      n[prop] = v;
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      render();
    });
    if (inp.type === 'checkbox') {
      inp.addEventListener('change', () => {
        n[inp.dataset.prop] = inp.checked;
        render();
      });
    }
  });
  inspectorBody.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      if (!n.priorities) n.priorities = [1, 2, 3];
      n.priorities[idx] = Number(inp.value) || 1;
      render();
    });
  });
  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => deleteNode(n.id));
}

function field(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}
function checkField(label, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

// ================= Взаимодействие =================

// --- Преобразование клиентских координат в SVG ---
function clientToSvg(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = state.view.x + (clientX - rect.left) / state.view.zoom;
  const y = state.view.y + (clientY - rect.top)  / state.view.zoom;
  return { x, y };
}

// --- Палитра: drag & drop ---
document.querySelectorAll('.pal-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/raschet-type', item.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
});
svg.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', e => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/raschet-type');
  if (!type || !DEFAULTS[type]) return;
  const p = clientToSvg(e.clientX, e.clientY);
  createNode(type, p.x, p.y);
});

// --- Клики / перетаскивание нод ---
svg.addEventListener('mousedown', e => {
  const portEl = e.target.closest('.port');
  if (portEl) {
    // начинаем/завершаем связь
    e.stopPropagation();
    const nodeId = portEl.dataset.nodeId;
    const kind = portEl.dataset.portKind;
    const idx  = Number(portEl.dataset.portIdx);
    if (kind === 'out') {
      state.pending = { fromNodeId: nodeId, fromPort: idx, mouseX: 0, mouseY: 0 };
      svg.classList.add('connecting');
      const p = clientToSvg(e.clientX, e.clientY);
      state.pending.mouseX = p.x; state.pending.mouseY = p.y;
      drawPending();
    } else if (state.pending && kind === 'in') {
      const ok = tryConnect(
        { nodeId: state.pending.fromNodeId, port: state.pending.fromPort },
        { nodeId, port: idx },
      );
      state.pending = null;
      svg.classList.remove('connecting');
      clearPending();
      if (ok) render();
    }
    return;
  }

  const nodeEl = e.target.closest('.node');
  if (nodeEl) {
    const id = nodeEl.dataset.nodeId;
    const n = state.nodes.get(id);
    const p = clientToSvg(e.clientX, e.clientY);
    state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y };
    selectNode(id);
    render();
    return;
  }

  const connEl = e.target.closest('.conn');
  if (connEl) {
    if (e.shiftKey || e.button === 2) deleteConn(connEl.dataset.connId);
    return;
  }

  // пустое место: пан
  state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
  svg.classList.add('panning');
  state.selectedId = null;
  renderInspector();
  render();
});

window.addEventListener('mousemove', e => {
  if (state.drag && state.drag.nodeId) {
    const p = clientToSvg(e.clientX, e.clientY);
    const n = state.nodes.get(state.drag.nodeId);
    n.x = p.x - state.drag.dx;
    n.y = p.y - state.drag.dy;
    render();
  } else if (state.drag && state.drag.pan) {
    const dx = (e.clientX - state.drag.sx) / state.view.zoom;
    const dy = (e.clientY - state.drag.sy) / state.view.zoom;
    state.view.x = state.drag.vx - dx;
    state.view.y = state.drag.vy - dy;
    updateViewBox();
  }
  if (state.pending) {
    const p = clientToSvg(e.clientX, e.clientY);
    state.pending.mouseX = p.x;
    state.pending.mouseY = p.y;
    drawPending();
  }
});

window.addEventListener('mouseup', () => {
  if (state.drag) {
    svg.classList.remove('panning');
    state.drag = null;
  }
});

// отмена связи по Escape / правому клику
svg.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (state.pending) { state.pending = null; clearPending(); svg.classList.remove('connecting'); }
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.pending) { state.pending = null; clearPending(); svg.classList.remove('connecting'); }
  }
  if (e.key === 'Delete' && state.selectedId) deleteNode(state.selectedId);
});

function drawPending() {
  clearPending();
  if (!state.pending) return;
  const from = state.nodes.get(state.pending.fromNodeId);
  if (!from) return;
  const a = portPos(from, 'out', state.pending.fromPort);
  const path = el('path', {
    class: 'pending-line',
    d: bezier(a, { x: state.pending.mouseX, y: state.pending.mouseY }),
  });
  path.id = '__pending';
  layerOver.appendChild(path);
}
function clearPending() {
  const p = document.getElementById('__pending');
  if (p) p.remove();
}

// --- Зум колесом ---
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const before = clientToSvg(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.2, Math.min(4, state.view.zoom * factor));
  // Сохраняем точку под курсором
  const rect = svg.getBoundingClientRect();
  state.view.x = before.x - (e.clientX - rect.left) / newZoom;
  state.view.y = before.y - (e.clientY - rect.top)  / newZoom;
  state.view.zoom = newZoom;
  updateViewBox();
}, { passive: false });

// --- Панель инструментов ---
document.getElementById('btn-zoom-in').onclick  = () => { state.view.zoom = Math.min(4, state.view.zoom * 1.2); updateViewBox(); };
document.getElementById('btn-zoom-out').onclick = () => { state.view.zoom = Math.max(0.2, state.view.zoom / 1.2); updateViewBox(); };
document.getElementById('btn-zoom-reset').onclick = () => { state.view.zoom = 1; updateViewBox(); };
document.getElementById('btn-fit').onclick = fitAll;
document.getElementById('btn-save').onclick  = () => { localStorage.setItem('raschet.scheme', JSON.stringify(serialize())); flash('Сохранено в браузере'); };
document.getElementById('btn-load').onclick  = () => {
  const s = localStorage.getItem('raschet.scheme');
  if (!s) return flash('Нет сохранения');
  try { deserialize(JSON.parse(s)); render(); renderInspector(); flash('Загружено'); } catch (err) { flash('Ошибка: ' + err.message); }
};
document.getElementById('btn-clear').onclick = () => {
  if (state.nodes.size && !confirm('Очистить схему?')) return;
  state.nodes.clear(); state.conns.clear(); state.selectedId = null;
  render(); renderInspector();
};
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'raschet-scheme.json';
  a.click();
};
document.getElementById('btn-import').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { deserialize(JSON.parse(r.result)); render(); renderInspector(); } catch (err) { alert('Ошибка: ' + err.message); } };
  r.readAsText(f);
});

function fitAll() {
  if (!state.nodes.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + NODE_H);
  }
  const pad = 60;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const W = svg.clientWidth, H = svg.clientHeight;
  state.view.zoom = Math.min(W / w, H / h, 2);
  state.view.x = minX - pad;
  state.view.y = minY - pad;
  updateViewBox();
}

// ================= Сохранение / загрузка =================
function serialize() {
  return {
    version: 1,
    nextId: _idSeq,
    nodes: Array.from(state.nodes.values()).map(stripRuntime),
    conns: Array.from(state.conns.values()).map(c => ({ id: c.id, from: c.from, to: c.to })),
    view: { ...state.view },
  };
}
function stripRuntime(n) {
  const copy = { ...n };
  delete copy._loadKw; delete copy._powered; delete copy._overload;
  return copy;
}
function deserialize(data) {
  state.nodes.clear();
  state.conns.clear();
  for (const n of data.nodes || []) state.nodes.set(n.id, n);
  for (const c of data.conns || []) state.conns.set(c.id, c);
  _idSeq = Math.max(data.nextId || 1, 1);
  state.view = data.view || { x: 0, y: 0, zoom: 1 };
  state.selectedId = null;
  updateViewBox();
}

// ================= Вспомогательное =================
function flash(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// ================= Демо-пример =================
function buildDemo() {
  const s1 = createNode('source',    260, 80); state.nodes.get(s1).name = 'Ввод 1 (ТП)';
  const s2 = createNode('source',    480, 80); state.nodes.get(s2).name = 'Ввод 2 (резерв)';
  const g1 = createNode('generator', 700, 80); state.nodes.get(g1).name = 'ДГУ';
  const p1 = createNode('panel',     370, 260); state.nodes.get(p1).name = 'ЩС-1'; state.nodes.get(p1).inputs = 3;
  const p2 = createNode('panel',     600, 420); state.nodes.get(p2).name = 'ЩС-2';
  const c1 = createNode('consumer',  260, 460); state.nodes.get(c1).name = 'Сервер'; state.nodes.get(c1).demandKw = 8;
  const c2 = createNode('consumer',  500, 600); state.nodes.get(c2).name = 'Кондиционер'; state.nodes.get(c2).demandKw = 20;
  const c3 = createNode('consumer',  700, 600); state.nodes.get(c3).name = 'Освещение'; state.nodes.get(c3).demandKw = 5;

  tryConnect({ nodeId: s1, port: 0 }, { nodeId: p1, port: 0 });
  tryConnect({ nodeId: s2, port: 0 }, { nodeId: p1, port: 1 });
  tryConnect({ nodeId: g1, port: 0 }, { nodeId: p1, port: 2 });
  tryConnect({ nodeId: p1, port: 0 }, { nodeId: c1, port: 0 });
  tryConnect({ nodeId: p1, port: 1 }, { nodeId: p2, port: 0 });
  tryConnect({ nodeId: p2, port: 0 }, { nodeId: c2, port: 0 });
  tryConnect({ nodeId: p2, port: 1 }, { nodeId: c3, port: 0 });

  state.selectedId = null;
}

// ================= Инициализация =================
window.addEventListener('resize', updateViewBox);
updateViewBox();
buildDemo();
render();
renderInspector();
fitAll();

})();
