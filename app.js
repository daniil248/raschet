/* =========================================================================
   Raschet — конструктор принципиальных схем электроснабжения
   ------------------------------------------------------------------------
   Состояние:
     state.nodes         : Map<id, Node>          — источники/генераторы/щиты/потребители
     state.conns         : Map<id, Conn>          — связи между портами
     state.modes         : Array<Mode>            — сохранённые режимы работы
     state.activeModeId  : string|null            — активный режим (null = "Нормальный")
     state.selectedKind  : 'node'|'conn'|null
     state.selectedId    : string|null
     state.view          : { x, y, zoom }         — параметры viewBox
   Расчёт:
     recalc() — каскадное распространение demand от потребителей вверх.
     Приоритеты: входы щита/потребителя группируются по значению priority.
     Группа с наименьшим номером и хотя бы одним запитанным фидером —
     активна; внутри группы фидеры делят нагрузку поровну (параллельно).
     Резервные генераторы включаются, только если основного питания нет.
   ========================================================================= */

(() => {
'use strict';

// ================= Константы =================
const NODE_H = 96;
const NODE_MIN_W = 180;
const PORT_GAP_MIN = 34;
const PORT_R = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Типы узлов и их параметры по умолчанию
const DEFAULTS = {
  source:    () => ({ name: 'Ввод ТП',    capacityKw: 100, on: true }),
  generator: () => ({ name: 'ДГУ',         capacityKw: 60,  on: true, backupMode: true }),
  panel:     () => ({
    name: 'ЩС',
    inputs: 2, outputs: 2,
    priorities: [1, 2],
    switchMode: 'auto',       // 'auto' — АВР по приоритетам; 'manual' — ручной выбор активного входа
    manualActiveInput: 0,     // индекс входа в ручном режиме
  }),
  ups:       () => ({
    name: 'ИБП',
    capacityKw: 10,
    efficiency: 95,          // КПД, проценты 30–100
    chargeKw: 0.5,           // мощность, уходящая на заряд батареи
    batteryKwh: 2,           // ёмкость аккумуляторов
    batteryChargePct: 100,   // текущий уровень заряда, %
    inputs: 1, outputs: 1,
    priorities: [1],
    on: true,
  }),
  consumer:  () => ({
    name: 'Потребитель',
    demandKw: 10,
    count: 1,                // число потребителей в группе (1 = обычный потребитель)
    inputs: 2,
    priorities: [1, 2],
  }),
};

// Префиксы обозначений (tag) по типу узла
const TAG_PREFIX = {
  source:    'TR',
  generator: 'GS',
  panel:     'PNL',
  ups:       'UPS',
  consumer:  'L',
};

// ================= Состояние =================
const state = {
  nodes: new Map(),
  conns: new Map(),
  modes: [],
  activeModeId: null,
  selectedKind: null,
  selectedId: null,
  view: { x: 0, y: 0, zoom: 1 },
  pending: null,     // { fromNodeId, fromPort, mouseX, mouseY, restoreConn? }
  drag: null,        // { nodeId, dx, dy } | { pan, sx, sy, vx, vy }
  readOnly: false,   // просмотр без редактирования
};

let _idSeq = 1;
const uid = (p = 'n') => `${p}${_idSeq++}`;

// Поиск наименьшего свободного обозначения с заданным префиксом (TR1, TR2, …)
function nextFreeTag(type) {
  const prefix = TAG_PREFIX[type] || 'X';
  const used = new Set();
  for (const n of state.nodes.values()) {
    if (n.tag) used.add(n.tag);
  }
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

// Проверка, что tag не занят другим узлом
function isTagUnique(tag, exceptId) {
  for (const n of state.nodes.values()) {
    if (n.id !== exceptId && n.tag === tag) return false;
  }
  return true;
}

// ================= DOM refs =================
const svg        = document.getElementById('canvas');
const layerConns = document.getElementById('layer-conns');
const layerNodes = document.getElementById('layer-nodes');
const layerOver  = document.getElementById('layer-overlay');
const inspectorBody = document.getElementById('inspector-body');
const statsEl    = document.getElementById('stats');
const modesListEl = document.getElementById('modes-list');

// ================= Режимы =================
function effectiveOn(n) {
  if (!('on' in n)) return true;
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    if (m && m.overrides && m.overrides[n.id] && 'on' in m.overrides[n.id]) {
      return m.overrides[n.id].on;
    }
  }
  return n.on;
}
function setEffectiveOn(n, val) {
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    if (!m) return;
    if (!m.overrides) m.overrides = {};
    if (!m.overrides[n.id]) m.overrides[n.id] = {};
    m.overrides[n.id].on = val;
  } else {
    n.on = val;
  }
}
function createMode(name) {
  const id = uid('m');
  const m = { id, name: name || `Режим ${state.modes.length + 1}`, overrides: {} };
  state.modes.push(m);
  state.activeModeId = id;
  render();
}
function deleteMode(id) {
  state.modes = state.modes.filter(m => m.id !== id);
  if (state.activeModeId === id) state.activeModeId = null;
  render();
}
function selectMode(id) {
  state.activeModeId = id;
  render();
  renderInspector();
}

// ================= Геометрия узла =================
function nodeInputCount(n) {
  if (n.type === 'source' || n.type === 'generator') return 0;
  return Math.max(0, n.inputs | 0);
}
function nodeOutputCount(n) {
  if (n.type === 'consumer') return 0;
  if (n.type === 'source' || n.type === 'generator') return 1;
  return Math.max(0, n.outputs | 0);
}
function nodeWidth(n) {
  const maxPorts = Math.max(nodeInputCount(n), nodeOutputCount(n), 1);
  return Math.max(NODE_MIN_W, maxPorts * PORT_GAP_MIN + 24);
}
function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const gap = w / (count + 1);
  const px = n.x + gap * (idx + 1);
  const py = kind === 'in' ? n.y : n.y + NODE_H;
  return { x: px, y: py };
}

// ================= Создание / удаление =================
function createNode(type, x, y) {
  const id = uid();
  const base = { id, type, x, y, ...DEFAULTS[type]() };
  base.tag = nextFreeTag(type);
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
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
  for (const m of state.modes) { if (m.overrides) delete m.overrides[id]; }
  if (state.selectedKind === 'node' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  render();
  renderInspector();
}
function deleteConn(id) {
  state.conns.delete(id);
  if (state.selectedKind === 'conn' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  render();
  renderInspector();
}
function clampPortsInvolvingNode(n) {
  for (const c of Array.from(state.conns.values())) {
    if (c.to.nodeId === n.id && c.to.port >= nodeInputCount(n)) state.conns.delete(c.id);
    if (c.from.nodeId === n.id && c.from.port >= nodeOutputCount(n)) state.conns.delete(c.id);
  }
  // Подрезка массива приоритетов
  if (Array.isArray(n.priorities)) {
    while (n.priorities.length < nodeInputCount(n)) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = nodeInputCount(n);
  }
}

// ================= Связи =================
function wouldCreateCycle(fromNodeId, toNodeId) {
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
  for (const c of state.conns.values()) {
    if (c.to.nodeId === to.nodeId && c.to.port === to.port) return false;
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId)) return false;
  const id = uid('c');
  state.conns.set(id, { id, from, to });
  return id;
}

// ================= Расчёт мощности =================
function recalc() {
  const edgesIn = new Map();
  for (const n of state.nodes.values()) edgesIn.set(n.id, []);
  for (const c of state.conns.values()) edgesIn.get(c.to.nodeId).push(c);

  const cache = new Map();
  function activeInputs(nid, allowBackup) {
    const key = nid + '|' + (allowBackup ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null); // placeholder на случай re-entry

    const n = state.nodes.get(nid);
    let res = null;

    if (n.type === 'source') {
      res = effectiveOn(n) ? [] : null;
    } else if (n.type === 'generator') {
      if (!effectiveOn(n)) res = null;
      else if (n.backupMode && !allowBackup) res = null;
      else res = [];
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        // Как щит — группировка по приоритетам
        const ins = edgesIn.get(nid) || [];
        if (ins.length > 0) {
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
        }
        // Батарейный резерв — ИБП играет роль источника, когда вход мёртв
        if (res === null && allowBackup) res = [];
      }
    } else {
      // panel или consumer
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        // Ручной режим щита: работает только явно выбранный вход, без учёта приоритетов.
        // Если на нём есть напряжение — щит запитан. Иначе щит обесточен, даже если
        // другие входы живы.
        if (n.type === 'panel' && n.switchMode === 'manual') {
          const idx = n.manualActiveInput | 0;
          const target = ins.find(c => c.to.port === idx);
          if (target) {
            const upNoBackup = activeInputs(target.from.nodeId, false);
            if (upNoBackup !== null) {
              res = [{ conn: target, share: 1 }];
            } else if (allowBackup) {
              const upWithBackup = activeInputs(target.from.nodeId, true);
              if (upWithBackup !== null) res = [{ conn: target, share: 1 }];
            }
          }
        } else {
          // Автоматический режим — группировка по приоритетам с параллельной работой
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          // Фаза 1: без резерва
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          // Фаза 2: с резервом
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
        }
      }
    }

    cache.set(key, res);
    return res;
  }

  // Сброс расчётных полей
  for (const n of state.nodes.values()) {
    n._loadKw = 0; n._powered = false; n._overload = false;
  }
  for (const c of state.conns.values()) { c._active = false; c._loadKw = 0; c._state = 'dead'; }

  // Распространение нагрузки от потребителей вверх.
  // При прохождении границы ИБП поток вверх увеличивается на 1/КПД — это потери
  // на преобразование. Если ИБП работает от батареи (активные входы пусты),
  // visit() завершается — вверх ничего не идёт.
  function walkUp(nid, kw) {
    let depth = 0;
    const visit = (id, flow) => {
      if (depth++ > 2000) return;
      const ai = activeInputs(id, true);
      if (!ai || ai.length === 0) return;
      const nn = state.nodes.get(id);
      const eff = (nn.type === 'ups')
        ? Math.max(0.01, (Number(nn.efficiency) || 100) / 100)
        : 1;
      const flowUp = flow / eff;
      for (const { conn, share } of ai) {
        const upKw = flowUp * share;
        conn._active = true;
        conn._loadKw += upKw;
        const up = state.nodes.get(conn.from.nodeId);
        up._loadKw += upKw;
        up._powered = true;
        visit(up.id, upKw);
      }
    };
    visit(nid, kw);
  }

  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const ai = activeInputs(n.id, true);
    n._powered = ai !== null;
    if (!n._powered) continue;
    // Для группы потребителей: суммарный demand = count × demandKw
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const total = per * count;
    n._loadKw = total;
    walkUp(n.id, total);
  }

  // Зарядный ток ИБП — накидывается поверх проходной мощности,
  // только если ИБП работает от входа (не от батареи).
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!effectiveOn(n)) continue;
    const ai = activeInputs(n.id, true);
    if (!ai || ai.length === 0) continue; // мёртв или на батарее
    const ch = Number(n.chargeKw) || 0;
    if (ch <= 0) continue;
    walkUp(n.id, ch);
  }

  // Вычисление _state для каждой связи — три цвета:
  //   active  — красная: есть напряжение И downstream выбрал этот вход
  //   powered — зелёная: есть напряжение, но downstream не использует этот вход
  //   dead    — серая пунктирная: upstream без напряжения
  for (const c of state.conns.values()) {
    if (c._active) { c._state = 'active'; continue; }
    const upAi = activeInputs(c.from.nodeId, true);
    c._state = (upAi !== null) ? 'powered' : 'dead';
  }

  // Статусы источников и ИБП
  for (const n of state.nodes.values()) {
    if (n.type === 'source' || n.type === 'generator') {
      const ai = activeInputs(n.id, true);
      n._powered = ai !== null;
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    } else if (n.type === 'panel') {
      if (!n._powered) n._powered = activeInputs(n.id, true) !== null;
    } else if (n.type === 'ups') {
      const ai = activeInputs(n.id, true);
      n._powered = ai !== null;
      n._onBattery = ai !== null && ai.length === 0;
      if (n._powered && !n._onBattery) {
        const eff = Math.max(0.01, (Number(n.efficiency) || 100) / 100);
        n._inputKw = n._loadKw / eff + (Number(n.chargeKw) || 0);
      } else {
        n._inputKw = 0;
      }
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    }
  }
}

// ================= Рендер =================
function updateViewBox() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const vw = W / state.view.zoom;
  const vh = H / state.view.zoom;
  svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${vw} ${vh}`);
  const bg = document.getElementById('bg');
  bg.setAttribute('x', state.view.x);
  bg.setAttribute('y', state.view.y);
  bg.setAttribute('width', vw);
  bg.setAttribute('height', vh);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) e.appendChild(c);
  return e;
}
function text(x, y, str, cls) {
  const t = el('text', { x, y, class: cls });
  t.textContent = str;
  return t;
}
function bezier(a, b) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
}
function fmt(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toString();
}

function render() {
  recalc();
  renderConns();
  renderNodes();
  renderStats();
  renderModes();
}

function renderNodes() {
  while (layerNodes.firstChild) layerNodes.removeChild(layerNodes.firstChild);

  for (const n of state.nodes.values()) {
    const w = nodeWidth(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const cls = [
      'node', n.type,
      selected ? 'selected' : '',
      n._overload ? 'overload' : '',
      (!n._powered && (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups')) ? 'unpowered' : '',
      (n.type === 'ups' && n._onBattery) ? 'onbattery' : '',
      (n.type === 'panel' && n.switchMode === 'manual') ? 'manual' : '',
    ].filter(Boolean).join(' ');

    const g = el('g', { class: cls, transform: `translate(${n.x},${n.y})` });
    g.dataset.nodeId = n.id;

    g.appendChild(el('rect', { class: 'node-body', x: 0, y: 0, width: w, height: NODE_H }));

    // Обозначение (tag) — мелкая надпись сверху
    if (n.tag) g.appendChild(text(12, 16, n.tag, 'node-tag'));

    // Имя
    g.appendChild(text(12, 33, n.name || '(без имени)', 'node-title'));

    // Подпись типа
    const subTxt = {
      source:    'Источник',
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel:     `Щит · вх ${n.inputs} · вых ${n.outputs}` + (n.switchMode === 'manual' ? ' · руч.' : ''),
      ups:       `ИБП · КПД ${Math.round(Number(n.efficiency) || 100)}%`,
      consumer:  ((n.count || 1) > 1
                    ? `Группа · ${n.count} × ${fmt(n.demandKw)} kW`
                    : 'Потребитель') + (n.inputs > 1 ? ` · вх ${n.inputs}` : ''),
    }[n.type];
    g.appendChild(text(12, 49, subTxt, 'node-sub'));

    // Нагрузка
    let loadLine = '', loadCls = 'node-load';
    if (n.type === 'source' || n.type === 'generator') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'panel') {
      loadLine = n._powered ? `${fmt(n._loadKw)} kW` : 'Без питания';
      if (!n._powered) loadCls += ' off';
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else if (!n._powered) { loadLine = 'Без питания'; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW${n._onBattery ? ' · БАТ' : ''}`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'consumer') {
      loadLine = n._powered ? `${fmt(n.demandKw)} kW` : `${fmt(n.demandKw)} kW · нет`;
      if (!n._powered) loadCls += ' off';
    }
    g.appendChild(text(12, NODE_H - 12, loadLine, loadCls));

    // Порты — входы
    const inCount = nodeInputCount(n);
    // Состояние каждого входного порта: 'active' | 'powered' | undefined
    const portStates = new Map();
    if (inCount > 1) {
      for (const c of state.conns.values()) {
        if (c.to.nodeId !== n.id) continue;
        if (c._state === 'active' || c._state === 'powered') {
          portStates.set(c.to.port, c._state);
        }
      }
    }
    for (let i = 0; i < inCount; i++) {
      const cx = w / (inCount + 1) * (i + 1);
      const circ = el('circle', { class: 'port in', cx, cy: 0, r: PORT_R });
      circ.dataset.portKind = 'in'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // Метка приоритета
      if (n.type === 'panel' || (n.type === 'consumer' && inCount > 1)) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        g.appendChild(text(cx, -10, `P${prio}`, 'port-label'));
      }
      // Лампочки (только при inputs > 1):
      //   зелёная — на красную линию («работает, несёт нагрузку»)
      //   красная — на зелёную линию («есть напряжение, но не выбрано»)
      //   нет лампочки — на серую пунктирную
      if (inCount > 1) {
        const ps = portStates.get(i);
        if (ps === 'active') {
          g.appendChild(el('circle', { class: 'port-lamp green', cx: cx + 11, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core green', cx: cx + 11, cy: 0, r: 2 }));
        } else if (ps === 'powered') {
          g.appendChild(el('circle', { class: 'port-lamp red', cx: cx + 11, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core red', cx: cx + 11, cy: 0, r: 2 }));
        }
      }
    }
    // Порты — выходы
    const outCount = nodeOutputCount(n);
    for (let i = 0; i < outCount; i++) {
      const cx = w / (outCount + 1) * (i + 1);
      const circ = el('circle', { class: 'port out', cx, cy: NODE_H, r: PORT_R });
      circ.dataset.portKind = 'out'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
    }

    layerNodes.appendChild(g);
  }
}

function renderConns() {
  while (layerConns.firstChild) layerConns.removeChild(layerConns.firstChild);

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const d = bezier(a, b);

    const selected = state.selectedKind === 'conn' && state.selectedId === c.id;

    // Невидимая «толстая» дорожка — упрощает попадание кликом
    const hit = el('path', { class: 'conn-hit', d });
    hit.dataset.connId = c.id;
    layerConns.appendChild(hit);

    // Видимая линия
    const stateClass = c._state === 'active' ? ' active'
                     : c._state === 'powered' ? ' powered'
                     : ' dead';
    const path = el('path', {
      class: 'conn' + stateClass + (selected ? ' selected' : ''),
      d,
    });
    path.dataset.connId = c.id;
    layerConns.appendChild(path);

    // Подпись мощности на активных линиях.
    // Если подходит к группе потребителей — показываем «N × X kW» вместо суммы.
    if (c._state === 'active' && c._loadKw > 0) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let labelText;
      if (toN.type === 'consumer' && (toN.count || 1) > 1) {
        labelText = `${toN.count} × ${fmt(toN.demandKw)} kW`;
      } else {
        labelText = `${fmt(c._loadKw)} kW`;
      }
      const lbl = text(mid.x, mid.y - 4, labelText, 'conn-label');
      layerConns.appendChild(lbl);
    }

    // Рукоятка на «to»-конце выделенной связи
    if (selected) {
      const h = el('circle', { class: 'conn-handle', cx: b.x, cy: b.y, r: 7 });
      h.dataset.reconnectId = c.id;
      layerConns.appendChild(h);
    }
  }
}

function renderStats() {
  let totalDemand = 0, totalCap = 0, totalDraw = 0;
  let unpoweredCount = 0, overloadCount = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      totalDemand += Number(n.demandKw) || 0;
      if (!n._powered) unpoweredCount++;
    }
    if (n.type === 'source' || n.type === 'generator') {
      if (effectiveOn(n)) totalCap += Number(n.capacityKw) || 0;
      totalDraw += n._loadKw || 0;
      if (n._overload) overloadCount++;
    }
  }
  const rows = [];
  rows.push(`<div class="row"><span>Запрос</span><span>${fmt(totalDemand)} kW</span></div>`);
  rows.push(`<div class="row"><span>Источников</span><span>${fmt(totalCap)} kW</span></div>`);
  rows.push(`<div class="row"><span>Потребляется</span><span>${fmt(totalDraw)} kW</span></div>`);
  if (unpoweredCount) rows.push(`<div class="row warn"><span>Без питания</span><span>${unpoweredCount}</span></div>`);
  if (overloadCount)  rows.push(`<div class="row warn"><span>Перегруз</span><span>${overloadCount}</span></div>`);
  if (!unpoweredCount && !overloadCount && state.nodes.size) {
    rows.push(`<div class="row ok"><span>Статус</span><span>OK</span></div>`);
  }
  statsEl.innerHTML = rows.join('');
}

function renderModes() {
  const rows = [];
  const list = [{ id: null, name: 'Нормальный' }, ...state.modes];
  for (const m of list) {
    const active = m.id === state.activeModeId;
    const canDel = m.id !== null;
    rows.push(
      `<div class="mode-row${active ? ' active' : ''}" data-mid="${m.id ?? ''}">
        <input type="radio" name="mode"${active ? ' checked' : ''}>
        <input type="text" class="mode-name" value="${escAttr(m.name)}"${canDel ? '' : ' disabled'}>
        <button class="mode-del" ${canDel ? '' : 'disabled'}>×</button>
      </div>`
    );
  }
  modesListEl.innerHTML = rows.join('');

  modesListEl.querySelectorAll('.mode-row').forEach(row => {
    const mid = row.dataset.mid || null;
    row.querySelector('input[type=radio]').addEventListener('change', () => selectMode(mid));
    row.addEventListener('click', e => {
      if (e.target.closest('.mode-del') || e.target.classList.contains('mode-name')) return;
      selectMode(mid);
    });
    const nameInput = row.querySelector('.mode-name');
    if (!nameInput.disabled) {
      nameInput.addEventListener('input', () => {
        const m = state.modes.find(x => x.id === mid);
        if (m) m.name = nameInput.value;
      });
    }
    const del = row.querySelector('.mode-del');
    if (!del.disabled) del.addEventListener('click', e => { e.stopPropagation(); deleteMode(mid); });
  });
}

// ================= Инспектор =================
function selectNode(id) {
  state.selectedKind = 'node'; state.selectedId = id;
  renderInspector();
}
function selectConn(id) {
  state.selectedKind = 'conn'; state.selectedId = id;
  renderInspector();
}

function renderInspector() {
  if (!state.selectedKind) {
    inspectorBody.innerHTML = '<div class="muted">Выберите элемент или связь, либо перетащите новый элемент из палитры.</div>';
    return;
  }
  if (state.selectedKind === 'node') {
    const n = state.nodes.get(state.selectedId);
    if (!n) { inspectorBody.innerHTML = ''; return; }
    renderInspectorNode(n);
  } else {
    const c = state.conns.get(state.selectedId);
    if (!c) { inspectorBody.innerHTML = ''; return; }
    renderInspectorConn(c);
  }
}

function renderInspectorNode(n) {
  const h = [];
  h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

  if (n.type === 'source') {
    h.push(field('Мощность, kW', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
  } else if (n.type === 'generator') {
    h.push(field('Мощность, kW', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
  } else if (n.type === 'panel') {
    h.push(field('Входов', `<input type="number" min="1" max="30" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="30" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(field('Режим переключения',
      `<select data-prop="switchMode">
        <option value="auto"${n.switchMode !== 'manual' ? ' selected' : ''}>Автоматический (АВР)</option>
        <option value="manual"${n.switchMode === 'manual' ? ' selected' : ''}>Ручной</option>
      </select>`));
    if (n.switchMode === 'manual' && n.inputs > 0) {
      const opts = [];
      for (let i = 0; i < n.inputs; i++) {
        opts.push(`<option value="${i}"${(n.manualActiveInput | 0) === i ? ' selected' : ''}>Вход ${i + 1}</option>`);
      }
      h.push(field('Активный вход (ручной)',
        `<select data-prop="manualActiveInput">${opts.join('')}</select>`));
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">В ручном режиме приоритеты и наличие напряжения не учитываются — работает только явно выбранный вход.</div>');
    } else {
      h.push(prioritySection(n));
    }
    h.push(statusBlock(n));
  } else if (n.type === 'ups') {
    h.push(field('Выходная мощность, kW', `<input type="number" min="0" step="0.1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(field('КПД, %', `<input type="number" min="30" max="100" step="1" data-prop="efficiency" value="${n.efficiency}">`));
    h.push(field('Ток заряда батареи, kW', `<input type="number" min="0" step="0.1" data-prop="chargeKw" value="${n.chargeKw}">`));
    h.push(field('Ёмкость батареи, kWh', `<input type="number" min="0" step="0.1" data-prop="batteryKwh" value="${n.batteryKwh}">`));
    h.push(field('Заряд батареи, %', `<input type="number" min="0" max="100" step="1" data-prop="batteryChargePct" value="${n.batteryChargePct}">`));
    h.push(field('Входов', `<input type="number" min="1" max="5" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="20" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    if (n.inputs > 1) h.push(prioritySection(n));
    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(field('Количество в группе', `<input type="number" min="1" max="999" step="1" data-prop="count" value="${n.count || 1}">`));
    h.push(field(((n.count || 1) > 1 ? 'Мощность каждого, kW' : 'Потребление, kW'),
      `<input type="number" min="0" step="0.1" data-prop="demandKw" value="${n.demandKw}">`));
    if ((n.count || 1) > 1) {
      const total = (Number(n.demandKw) || 0) * (n.count | 0);
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Суммарно: <b>${n.count} × ${fmt(n.demandKw)} kW = ${fmt(total)} kW</b></div>`);
    }
    h.push(field('Входов', `<input type="number" min="1" max="10" step="1" data-prop="inputs" value="${n.inputs}">`));
    if (n.inputs > 1) h.push(prioritySection(n));
    h.push(statusBlock(n));
  }

  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Изменения параметра «В работе» сохраняются в режиме <b>${escAttr(m?.name || '')}</b></div></div>`);
  }

  h.push('<button class="btn-delete" id="btn-del-node">Удалить элемент</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка
  inspectorBody.querySelectorAll('[data-prop]').forEach(inp => {
    const prop = inp.dataset.prop;
    const apply = () => {
      let v;
      if (inp.type === 'checkbox') v = inp.checked;
      else if (inp.type === 'number') v = Number(inp.value);
      else v = inp.value;

      if (prop === 'tag') {
        const t = String(v || '').trim();
        if (!t) return; // пустой tag не разрешаем
        if (!isTagUnique(t, n.id)) {
          flash(`Обозначение «${t}» уже занято`);
          inp.value = n.tag || '';
          return;
        }
        n.tag = t;
      } else if (prop === 'on' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        setEffectiveOn(n, v);
      } else if (prop === 'manualActiveInput') {
        n.manualActiveInput = Number(v) || 0;
      } else if (prop === 'count') {
        n.count = Math.max(1, Number(v) || 1);
      } else if (prop === 'switchMode') {
        n.switchMode = String(v);
      } else {
        n[prop] = v;
      }
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      render();
      // Перерисовать инспектор при изменениях, от которых зависят другие поля
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count') {
        renderInspector();
      }
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', apply);
  });
  inspectorBody.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      if (!n.priorities) n.priorities = [];
      n.priorities[idx] = Number(inp.value) || 1;
      render();
    });
  });

  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => deleteNode(n.id));
}

function prioritySection(n) {
  const ic = nodeInputCount(n);
  if (ic < 1) return '';
  const rows = [];
  rows.push('<div class="inspector-section"><h4>Приоритеты входов</h4>');
  rows.push('<div class="muted" style="font-size:11px;margin-bottom:8px">1 = высший. Равные значения — параллельная работа с разделением нагрузки.</div>');
  for (let i = 0; i < ic; i++) {
    const v = n.priorities?.[i] ?? (i + 1);
    rows.push(field(`Вход ${i + 1}`, `<input type="number" min="1" max="99" step="1" data-prio="${i}" value="${v}">`));
  }
  rows.push('</div>');
  return rows.join('');
}
function statusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">есть питание</span>');
  else parts.push('<span class="badge off">без питания</span>');
  if (n.type === 'panel') parts.push(` нагрузка: <b>${fmt(n._loadKw)} kW</b>`);
  return `<div class="inspector-section"><div class="muted" style="font-size:11px">${parts.join(' ')}</div></div>`;
}

function upsStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) {
    parts.push('<span class="badge off">отключён</span>');
  } else if (!n._powered) {
    parts.push('<span class="badge off">без питания</span>');
  } else {
    parts.push(n._onBattery
      ? '<span class="badge backup">работа от батареи</span>'
      : '<span class="badge on">работа от сети</span>');
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    if (!n._onBattery) parts.push(`потребление на входе: <b>${fmt(n._inputKw)} kW</b>`);
  }
  const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
  parts.push(`запас батареи: <b>${fmt(battKwh)} kWh</b> (${n.batteryChargePct || 0}%)`);
  if (n._loadKw > 0) {
    const hrs = battKwh / n._loadKw;
    const min = hrs * 60;
    let autTxt;
    if (min >= 600) autTxt = '> 10 ч';
    else if (min >= 60) autTxt = (hrs).toFixed(1) + ' ч';
    else if (min >= 1) autTxt = Math.round(min) + ' мин';
    else autTxt = '< 1 мин';
    parts.push(`автономия при текущей нагрузке: <b>${autTxt}</b>`);
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}

function renderInspectorConn(c) {
  const fromN = state.nodes.get(c.from.nodeId);
  const toN   = state.nodes.get(c.to.nodeId);
  const h = [];
  h.push('<div class="muted" style="font-size:12px;margin-bottom:8px">Связь</div>');
  h.push(`<div class="field"><label>Откуда</label><div>${escAttr(fromN?.name || '?')} · выход ${c.from.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Куда</label><div>${escAttr(toN?.name || '?')} · вход ${c.to.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Нагрузка</label><div>${c._active ? fmt(c._loadKw) + ' kW' : 'не активна'}</div></div>`);
  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Потяните оранжевую точку на конце линии, чтобы переключить связь на другой вход. Shift+клик — быстрое удаление.</div>');
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');
  document.getElementById('btn-del-conn').onclick = () => deleteConn(c.id);
}

function field(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}
function checkField(label, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
function checkFieldEff(label, n, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
function escAttr(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

// ================= Взаимодействие =================
function clientToSvg(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = state.view.x + (clientX - rect.left) / state.view.zoom;
  const y = state.view.y + (clientY - rect.top)  / state.view.zoom;
  return { x, y };
}

// Палитра: drag & drop (десктоп) + click-to-add (мобильный и шорткат)
let _palDragActive = false;
document.querySelectorAll('.pal-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    if (state.readOnly) { e.preventDefault(); return; }
    _palDragActive = true;
    e.dataTransfer.setData('text/raschet-type', item.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
  item.addEventListener('dragend', () => {
    setTimeout(() => { _palDragActive = false; }, 150);
  });
  item.addEventListener('click', () => {
    if (state.readOnly) return;
    if (_palDragActive) return; // был настоящий drag — click не обрабатываем
    const type = item.dataset.type;
    if (!DEFAULTS[type]) return;
    const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
    const cx = state.view.x + (W / 2) / state.view.zoom;
    const cy = state.view.y + (H / 2) / state.view.zoom;
    createNode(type, cx, cy);
    document.body.classList.remove('palette-open');
  });
});
svg.addEventListener('dragover', e => { if (state.readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', e => {
  if (state.readOnly) return;
  e.preventDefault();
  const type = e.dataTransfer.getData('text/raschet-type');
  if (!type || !DEFAULTS[type]) return;
  const p = clientToSvg(e.clientX, e.clientY);
  createNode(type, p.x, p.y);
});

// Мышь
svg.addEventListener('mousedown', e => {
  // Рукоятка reconnection
  const handleEl = e.target.closest('.conn-handle');
  if (handleEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = handleEl.dataset.reconnectId;
    const c = state.conns.get(cid);
    if (!c) return;
    const saved = { id: c.id, from: { ...c.from }, to: { ...c.to } };
    state.conns.delete(cid);
    state.pending = {
      fromNodeId: saved.from.nodeId,
      fromPort: saved.from.port,
      restoreConn: saved,
      mouseX: 0, mouseY: 0,
    };
    const p = clientToSvg(e.clientX, e.clientY);
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    svg.classList.add('connecting');
    render();
    drawPending();
    return;
  }

  // Порт — начало/конец связи
  const portEl = e.target.closest('.port');
  if (portEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const nodeId = portEl.dataset.nodeId;
    const kind = portEl.dataset.portKind;
    const idx  = Number(portEl.dataset.portIdx);
    if (kind === 'out') {
      state.pending = { fromNodeId: nodeId, fromPort: idx, mouseX: 0, mouseY: 0 };
      const p = clientToSvg(e.clientX, e.clientY);
      state.pending.mouseX = p.x; state.pending.mouseY = p.y;
      svg.classList.add('connecting');
      drawPending();
    } else if (state.pending && kind === 'in') {
      const cid = tryConnect(
        { nodeId: state.pending.fromNodeId, port: state.pending.fromPort },
        { nodeId, port: idx },
      );
      state.pending = null;
      svg.classList.remove('connecting');
      clearPending();
      if (cid) { selectConn(cid); render(); }
    }
    return;
  }

  // Связь
  const connEl = e.target.closest('.conn-hit, .conn');
  if (connEl && connEl.dataset.connId) {
    const cid = connEl.dataset.connId;
    if (e.shiftKey && !state.readOnly) { deleteConn(cid); return; }
    selectConn(cid);
    render();
    return;
  }

  // Нода
  const nodeEl = e.target.closest('.node');
  if (nodeEl) {
    const id = nodeEl.dataset.nodeId;
    selectNode(id);
    if (!state.readOnly) {
      const n = state.nodes.get(id);
      const p = clientToSvg(e.clientX, e.clientY);
      state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y };
    }
    render();
    return;
  }

  // Пустое место → пан
  state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
  svg.classList.add('panning');
  state.selectedKind = null; state.selectedId = null;
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
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    drawPending();
  }
});

window.addEventListener('mouseup', () => {
  if (state.drag) { svg.classList.remove('panning'); state.drag = null; }
});

// Отмена ведения связи
svg.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (state.pending) cancelPending();
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape' && state.pending) cancelPending();
  if (state.readOnly) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedKind === 'node' && state.selectedId) { deleteNode(state.selectedId); e.preventDefault(); }
    else if (state.selectedKind === 'conn' && state.selectedId) { deleteConn(state.selectedId); e.preventDefault(); }
  }
});

function cancelPending() {
  if (!state.pending) return;
  if (state.pending.restoreConn) {
    const r = state.pending.restoreConn;
    state.conns.set(r.id, { id: r.id, from: r.from, to: r.to });
  }
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  render();
}

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

// Зум колесом
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const before = clientToSvg(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.2, Math.min(4, state.view.zoom * factor));
  const rect = svg.getBoundingClientRect();
  state.view.x = before.x - (e.clientX - rect.left) / newZoom;
  state.view.y = before.y - (e.clientY - rect.top)  / newZoom;
  state.view.zoom = newZoom;
  updateViewBox();
}, { passive: false });

// ================= Тулбар =================
document.getElementById('btn-zoom-in').onclick  = () => { state.view.zoom = Math.min(4, state.view.zoom * 1.2); updateViewBox(); };
document.getElementById('btn-zoom-out').onclick = () => { state.view.zoom = Math.max(0.2, state.view.zoom / 1.2); updateViewBox(); };
document.getElementById('btn-zoom-reset').onclick = () => { state.view.zoom = 1; updateViewBox(); };
document.getElementById('btn-fit').onclick = fitAll;
document.getElementById('btn-save-local').onclick  = () => { localStorage.setItem('raschet.scheme', JSON.stringify(serialize())); flash('Сохранено в браузере'); };
document.getElementById('btn-load-local').onclick  = () => {
  const s = localStorage.getItem('raschet.scheme');
  if (!s) return flash('Нет сохранения');
  try { deserialize(JSON.parse(s)); render(); renderInspector(); flash('Загружено'); }
  catch (err) { flash('Ошибка: ' + err.message); }
};
document.getElementById('btn-clear').onclick = () => {
  if (state.nodes.size && !confirm('Очистить схему?')) return;
  state.nodes.clear(); state.conns.clear(); state.modes = []; state.activeModeId = null;
  state.selectedKind = null; state.selectedId = null;
  render(); renderInspector();
};
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  a.download = `raschet-scheme_${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.getElementById('btn-import').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { deserialize(JSON.parse(r.result)); render(); renderInspector(); }
    catch (err) { alert('Ошибка: ' + err.message); }
  };
  r.readAsText(f);
});
document.getElementById('btn-new-mode').onclick = () => createMode();

function fitAll() {
  if (!state.nodes.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + NODE_H);
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

// ================= Сохранение =================
function serialize() {
  return {
    version: 2,
    nextId: _idSeq,
    nodes: Array.from(state.nodes.values()).map(stripRuntime),
    conns: Array.from(state.conns.values()).map(c => ({ id: c.id, from: c.from, to: c.to })),
    modes: state.modes,
    activeModeId: state.activeModeId,
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
  for (const n of (data.nodes || [])) state.nodes.set(n.id, n);
  for (const c of (data.conns || [])) state.conns.set(c.id, c);
  state.modes = data.modes || [];
  state.activeModeId = data.activeModeId || null;
  _idSeq = Math.max(data.nextId || 1, 1);
  state.view = data.view || { x: 0, y: 0, zoom: 1 };
  state.selectedKind = null; state.selectedId = null;

  // Миграция старых схем: проставляем отсутствующие поля
  for (const n of state.nodes.values()) {
    if (!n.tag) n.tag = nextFreeTag(n.type);
    if (n.type === 'consumer' && typeof n.count !== 'number') n.count = 1;
    if (n.type === 'panel') {
      if (!n.switchMode) n.switchMode = 'auto';
      if (typeof n.manualActiveInput !== 'number') n.manualActiveInput = 0;
    }
  }

  updateViewBox();
}

// ================= Сообщения =================
function flash(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// ================= Демо =================
function buildDemo() {
  const s1 = createNode('source',    280, 100); const s1n = state.nodes.get(s1); s1n.name = 'Ввод 1 (ТП)';
  const s2 = createNode('source',    520, 100); const s2n = state.nodes.get(s2); s2n.name = 'Ввод 2';
  const g1 = createNode('generator', 760, 100); const g1n = state.nodes.get(g1); g1n.name = 'ДГУ';
  const p1 = createNode('panel',     440, 300); const p1n = state.nodes.get(p1); p1n.name = 'ЩС-1'; p1n.inputs = 3; p1n.outputs = 2; p1n.priorities = [1, 2, 3];
  const p2 = createNode('panel',     640, 480); const p2n = state.nodes.get(p2); p2n.name = 'ЩС-2'; p2n.inputs = 1; p2n.outputs = 2;
  const u1 = createNode('ups',       260, 440); const u1n = state.nodes.get(u1); u1n.name = 'ИБП сервера'; u1n.capacityKw = 12; u1n.efficiency = 94; u1n.chargeKw = 0.6; u1n.batteryKwh = 5; u1n.batteryChargePct = 100;
  const c1 = createNode('consumer',  260, 600); const c1n = state.nodes.get(c1); c1n.name = 'Сервер'; c1n.demandKw = 8; c1n.inputs = 1; c1n.priorities = [1];
  const c2 = createNode('consumer',  540, 660); const c2n = state.nodes.get(c2); c2n.name = 'Кондиционер'; c2n.demandKw = 20; c2n.inputs = 1;
  const c3 = createNode('consumer',  760, 660); const c3n = state.nodes.get(c3); c3n.name = 'Освещение';   c3n.demandKw = 5;  c3n.inputs = 1;

  tryConnect({ nodeId: s1, port: 0 }, { nodeId: p1, port: 0 });
  tryConnect({ nodeId: s2, port: 0 }, { nodeId: p1, port: 1 });
  tryConnect({ nodeId: g1, port: 0 }, { nodeId: p1, port: 2 });
  tryConnect({ nodeId: p1, port: 0 }, { nodeId: u1, port: 0 });
  tryConnect({ nodeId: u1, port: 0 }, { nodeId: c1, port: 0 });
  tryConnect({ nodeId: p1, port: 1 }, { nodeId: p2, port: 0 });
  tryConnect({ nodeId: p2, port: 0 }, { nodeId: c2, port: 0 });
  tryConnect({ nodeId: p2, port: 1 }, { nodeId: c3, port: 0 });

  // Пример режима — Ввод 1 сломан
  state.modes.push({ id: uid('m'), name: 'Ввод 1 сломан', overrides: { [s1]: { on: false } } });
  state.modes.push({ id: uid('m'), name: 'Оба ввода сломаны', overrides: { [s1]: { on: false }, [s2]: { on: false } } });

  state.selectedKind = null; state.selectedId = null;
}

// ================= Тач-события =================
// Эмуляция мыши для одного пальца + пинч-зум для двух.
let _pinch = null;

function synthMouseFromTouch(type, touch) {
  const target = document.elementFromPoint(touch.clientX, touch.clientY) || svg;
  const evt = new MouseEvent(type, {
    clientX: touch.clientX,
    clientY: touch.clientY,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  target.dispatchEvent(evt);
}

svg.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    // Пинч — отменяем любые одно-пальцевые операции
    if (state.drag) { svg.classList.remove('panning'); state.drag = null; }
    if (state.pending) cancelPending();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinch = { dist: Math.hypot(dx, dy), zoom: state.view.zoom };
    e.preventDefault();
    return;
  }
  if (e.touches.length === 1) {
    e.preventDefault();
    synthMouseFromTouch('mousedown', e.touches[0]);
  }
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (_pinch && e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const newZoom = Math.max(0.2, Math.min(4, _pinch.zoom * (dist / _pinch.dist)));
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = svg.getBoundingClientRect();
    const before = clientToSvg(cx, cy);
    state.view.zoom = newZoom;
    state.view.x = before.x - (cx - rect.left) / newZoom;
    state.view.y = before.y - (cy - rect.top)  / newZoom;
    updateViewBox();
    e.preventDefault();
    return;
  }
  if (!_pinch && e.touches.length === 1 && (state.drag || state.pending)) {
    e.preventDefault();
    synthMouseFromTouch('mousemove', e.touches[0]);
  }
}, { passive: false });

window.addEventListener('touchend', e => {
  if (_pinch) {
    if (e.touches.length < 2) _pinch = null;
    return;
  }
  if (state.drag || state.pending) {
    const t = e.changedTouches[0];
    if (t) synthMouseFromTouch('mouseup', t);
  }
});
window.addEventListener('touchcancel', () => {
  _pinch = null;
  if (state.drag) { svg.classList.remove('panning'); state.drag = null; }
});

// ================= Инициализация (холодный старт) =================
window.addEventListener('resize', updateViewBox);
updateViewBox();
render();
renderInspector();

// ================= Публичный API (для main.js) =================
window.Raschet = {
  loadScheme(data) {
    if (!data) {
      state.nodes.clear();
      state.conns.clear();
      state.modes = [];
      state.activeModeId = null;
      state.selectedKind = null;
      state.selectedId = null;
      state.view = { x: 0, y: 0, zoom: 1 };
      updateViewBox();
      render();
      renderInspector();
      return;
    }
    try {
      deserialize(data);
      render();
      renderInspector();
    } catch (err) {
      console.error('[Raschet.loadScheme]', err);
      throw err;
    }
  },
  getScheme() {
    return serialize();
  },
  loadDemo() {
    state.nodes.clear();
    state.conns.clear();
    state.modes = [];
    state.activeModeId = null;
    state.selectedKind = null;
    state.selectedId = null;
    _idSeq = 1;
    buildDemo();
    render();
    renderInspector();
  },
  setReadOnly(flag) {
    state.readOnly = !!flag;
    document.body.classList.toggle('read-only', state.readOnly);
    // Перерисуем инспектор — в read-only режиме инпуты должны быть disabled
    renderInspector();
  },
  fit() {
    // Если canvas только что показан, дадим браузеру посчитать layout
    if (!svg.clientWidth || !svg.clientHeight) {
      requestAnimationFrame(() => fitAll());
      return;
    }
    fitAll();
  },
  isEmpty() { return state.nodes.size === 0; },
};

})();
