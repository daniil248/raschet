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

// Глобальные настройки расчёта
const GLOBAL = {
  voltage3ph: 400,
  voltage1ph: 230,
  defaultCosPhi: 0.92,
  defaultInstallMethod: 'B1',
  defaultAmbient: 30,
  defaultGrouping: 1,
  defaultMaterial: 'Cu',     // Cu | Al
  defaultInsulation: 'PVC',  // PVC | XLPE
};

// Ряд номиналов автоматов защиты
const BREAKER_SERIES = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 400, 630, 800, 1000, 1250, 1600];

// IEC 60364-5-52 — допустимые длительные токи.
// Структура: IEC_TABLES[material][insulation][method] = [[s_mm2, I_A], ...]
// Медь, ПВХ-изоляция, 3 нагруженных проводника — это и есть прежние значения.
// Алюминий ≈ 0.78 × меди; XLPE ≈ 1.30 × ПВХ (упрощённое приближение IEC tab B.52).
const IEC_TABLES = {
  Cu: {
    PVC: {
      B1: [[1.5,15.5],[2.5,21],[4,28],[6,36],[10,50],[16,68],[25,89],[35,110],[50,134],[70,171],[95,207],[120,239],[150,275],[185,314],[240,369],[300,424]],
      B2: [[1.5,15],[2.5,20],[4,27],[6,34],[10,46],[16,62],[25,80],[35,99],[50,118],[70,149],[95,179],[120,206],[150,236],[185,268],[240,313],[300,358]],
      C:  [[1.5,19.5],[2.5,27],[4,36],[6,46],[10,63],[16,85],[25,112],[35,138],[50,168],[70,213],[95,258],[120,299],[150,344],[185,392],[240,461],[300,530]],
      E:  [[1.5,22],[2.5,30],[4,40],[6,51],[10,70],[16,94],[25,119],[35,148],[50,180],[70,232],[95,282],[120,328],[150,379],[185,434],[240,514],[300,593]],
      F:  [[1.5,26],[2.5,36],[4,49],[6,63],[10,86],[16,115],[25,149],[35,185],[50,225],[70,289],[95,352],[120,410],[150,473],[185,542],[240,641],[300,741]],
      D1: [[1.5,22],[2.5,29],[4,38],[6,47],[10,63],[16,81],[25,104],[35,125],[50,148],[70,183],[95,216],[120,246],[150,278],[185,312],[240,361],[300,408]],
    },
    XLPE: {
      // Приближение XLPE ≈ 1.30 × PVC (IEC допускает более высокий нагрев жил)
      B1: [[1.5,20],[2.5,27],[4,37],[6,48],[10,66],[16,89],[25,118],[35,145],[50,176],[70,224],[95,271],[120,314],[150,361],[185,412],[240,484],[300,556]],
      B2: [[1.5,20],[2.5,27],[4,36],[6,45],[10,61],[16,82],[25,105],[35,130],[50,155],[70,196],[95,236],[120,271],[150,310],[185,352],[240,411],[300,470]],
      C:  [[1.5,26],[2.5,36],[4,48],[6,61],[10,83],[16,112],[25,147],[35,181],[50,221],[70,280],[95,339],[120,393],[150,452],[185,514],[240,605],[300,696]],
      E:  [[1.5,29],[2.5,40],[4,54],[6,68],[10,94],[16,127],[25,161],[35,200],[50,242],[70,311],[95,378],[120,440],[150,508],[185,582],[240,688],[300,793]],
      F:  [[1.5,34],[2.5,47],[4,64],[6,83],[10,114],[16,152],[25,197],[35,245],[50,297],[70,381],[95,463],[120,539],[150,621],[185,712],[240,842],[300,975]],
      D1: [[1.5,29],[2.5,38],[4,49],[6,62],[10,83],[16,106],[25,137],[35,164],[50,195],[70,241],[95,285],[120,324],[150,367],[185,412],[240,476],[300,538]],
    },
  },
  Al: {
    PVC: {
      // Алюминий ≈ 0.78 × меди (IEC tab B.52 простое приближение)
      B1: [[2.5,16],[4,22],[6,28],[10,39],[16,53],[25,69],[35,86],[50,104],[70,133],[95,161],[120,186],[150,214],[185,245],[240,288],[300,331]],
      B2: [[2.5,16],[4,21],[6,26],[10,36],[16,48],[25,62],[35,77],[50,92],[70,116],[95,139],[120,160],[150,184],[185,209],[240,244],[300,279]],
      C:  [[2.5,21],[4,28],[6,36],[10,49],[16,66],[25,87],[35,108],[50,131],[70,166],[95,201],[120,233],[150,268],[185,306],[240,360],[300,413]],
      E:  [[2.5,23],[4,31],[6,40],[10,54],[16,73],[25,93],[35,116],[50,140],[70,181],[95,220],[120,256],[150,295],[185,338],[240,400],[300,463]],
      F:  [[2.5,28],[4,38],[6,49],[10,67],[16,90],[25,116],[35,144],[50,176],[70,225],[95,274],[120,320],[150,369],[185,423],[240,500],[300,578]],
      D1: [[2.5,23],[4,30],[6,37],[10,49],[16,63],[25,81],[35,97],[50,115],[70,143],[95,168],[120,192],[150,217],[185,243],[240,282],[300,318]],
    },
    XLPE: {
      B1: [[2.5,21],[4,29],[6,37],[10,52],[16,69],[25,92],[35,113],[50,137],[70,175],[95,212],[120,245],[150,282],[185,321],[240,378],[300,434]],
      B2: [[2.5,21],[4,28],[6,35],[10,47],[16,64],[25,82],[35,101],[50,121],[70,153],[95,184],[120,212],[150,242],[185,275],[240,321],[300,367]],
      C:  [[2.5,28],[4,37],[6,48],[10,65],[16,87],[25,115],[35,141],[50,173],[70,219],[95,264],[120,307],[150,353],[185,402],[240,472],[300,543]],
      E:  [[2.5,31],[4,42],[6,53],[10,73],[16,99],[25,126],[35,156],[50,189],[70,243],[95,295],[120,343],[150,396],[185,454],[240,539],[300,621]],
      F:  [[2.5,37],[4,50],[6,65],[10,89],[16,118],[25,154],[35,191],[50,232],[95,361],[120,421],[150,485],[185,555],[240,656],[300,762]],
      D1: [[2.5,30],[4,38],[6,48],[10,64],[16,83],[25,106],[35,128],[50,151],[70,188],[95,222],[120,252],[150,287],[185,322],[240,372],[300,420]],
    },
  },
};

function cableTable(material, insulation, method) {
  const m = IEC_TABLES[material] || IEC_TABLES.Cu;
  const i = m[insulation] || m.PVC || Object.values(m)[0];
  const t = i[method] || i.B1 || Object.values(i)[0];
  return t;
}

// Поправка по температуре (IEC 60364-5-52 tab B.52.14), различается для ПВХ и XLPE
const K_TEMP = {
  PVC:  { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1.00, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.50 },
  XLPE: { 10: 1.15, 15: 1.12, 20: 1.08, 25: 1.04, 30: 1.00, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76, 60: 0.71, 65: 0.65, 70: 0.58 },
};

// Поправка на количество цепей в группе (упрощённо tab B.52.17, методы B-F)
const K_GROUP = { 1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50, 10: 0.48, 12: 0.45, 16: 0.41, 20: 0.38 };

function kTempLookup(t, insulation) {
  const tbl = K_TEMP[insulation || 'PVC'] || K_TEMP.PVC;
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - t) < Math.abs(best - t)) best = k;
  return tbl[best];
}
function kGroupLookup(n) {
  const keys = Object.keys(K_GROUP).map(Number).sort((a, b) => a - b);
  const v = Math.max(1, n | 0);
  // Находим ближайший ключ не меньше v
  let best = K_GROUP[1];
  for (const k of keys) { if (k <= v) best = K_GROUP[k]; }
  return best;
}

// Подбор минимального стандартного сечения.
// opts: { material, insulation, method, ambientC, grouping, conductorsInParallel }
function selectCableSize(I, opts) {
  const o = opts || {};
  const material = o.material || GLOBAL.defaultMaterial;
  const insulation = o.insulation || GLOBAL.defaultInsulation;
  const method = o.method || GLOBAL.defaultInstallMethod;
  const ambient = Number(o.ambientC) || GLOBAL.defaultAmbient;
  const grouping = Number(o.grouping) || GLOBAL.defaultGrouping;
  const parallel = Math.max(1, Number(o.conductorsInParallel) || 1);

  const table = cableTable(material, insulation, method);
  const kT = kTempLookup(ambient, insulation);
  const kG = kGroupLookup(grouping);
  const k = kT * kG;

  // Каждая параллельная ветвь несёт I/parallel
  const Iper = I / parallel;
  for (const [s, iRef] of table) {
    const iDerated = iRef * k;
    if (iDerated >= Iper) {
      return {
        s, iAllowed: iRef, iDerated, kT, kG,
        material, insulation, method, parallel,
        totalCapacity: iDerated * parallel,
      };
    }
  }
  const last = table[table.length - 1];
  return {
    s: last[0], iAllowed: last[1], iDerated: last[1] * k, kT, kG,
    material, insulation, method, parallel,
    totalCapacity: last[1] * k * parallel,
    overflow: true,
  };
}

// Подбор ближайшего большего стандартного автомата
function selectBreaker(Iload) {
  for (const In of BREAKER_SERIES) {
    if (In >= Iload) return In;
  }
  return BREAKER_SERIES[BREAKER_SERIES.length - 1];
}

// Типы узлов и их параметры по умолчанию
const DEFAULTS = {
  source:    () => ({
    name: 'Ввод ТП', capacityKw: 100, on: true,
    phase: '3ph', voltage: 400, cosPhi: 0.95,
  }),
  generator: () => ({
    name: 'ДГУ', capacityKw: 60, on: true, backupMode: true,
    phase: '3ph', voltage: 400, cosPhi: 0.85,
    triggerNodeId: null,
    startDelaySec: 5,
  }),
  panel:     () => ({
    name: 'ЩС',
    inputs: 2, outputs: 2,
    priorities: [1, 2],
    switchMode: 'auto',
    manualActiveInput: 0,
    parallelEnabled: [],
    kSim: 1.0,
  }),
  ups:       () => ({
    name: 'ИБП',
    capacityKw: 10,
    efficiency: 95,
    chargeA: 2,
    batteryKwh: 2,
    batteryChargePct: 100,
    phase: '3ph', voltage: 400, cosPhi: 0.92,
    inputs: 1, outputs: 1,
    priorities: [1],
    on: true,
    // Внутренний статический байпас — срабатывает при перегрузке или отказе
    // инвертора, проводит нагрузку напрямую со входа, минуя преобразование.
    // Не имеет отдельного порта — использует существующий основной вход.
    staticBypass: true,              // включён ли статический байпас как таковой
    staticBypassAuto: true,          // автоматический (по перегрузу) или принудительный
    staticBypassOverloadPct: 110,    // % от capacityKw, выше которого переходит на байпас
    staticBypassForced: false,       // принудительный байпас (через переключатель)
  }),
  consumer:  () => ({
    name: 'Потребитель',
    demandKw: 10,
    count: 1,
    inputs: 2,
    priorities: [1, 2],
    phase: '3ph',
    voltage: 400,
    cosPhi: 0.92,
    kUse: 1.0,
    inrushFactor: 1,
  }),
  // ------- Новые типы -------
  channel:   () => ({
    // Кабельный канал / трасса — узел-«труба». Может содержать несколько линий
    // разных потребителей. Все линии, проходящие через один канал, считаются
    // одной группой для коэффициента группировки.
    name: 'Кабельный канал',
    material: 'Cu',
    insulation: 'PVC',
    method: 'B1',
    ambientC: 30,
    // Длина канала (для будущего расчёта падения напряжения), м
    lengthM: 10,
    // Способность «проходить через себя» — канал не меняет направление, это 1 вход + 1 выход
    inputs: 1,
    outputs: 1,
  }),
  zone:      () => ({
    // Зона / помещение — контейнер для группировки узлов. Не участвует
    // в электрическом расчёте, но даёт префикс в обозначении вложенных узлов.
    name: 'Зона',
    zonePrefix: 'Z1',        // префикс, добавляется к tag вложенных узлов: Z1.PNL1
    width: 600,
    height: 400,
    color: '#e3f2fd',
    inputs: 0,
    outputs: 0,
  }),
};

// Префиксы обозначений (tag) по типу узла
const TAG_PREFIX = {
  source:    'TR',
  generator: 'GS',
  panel:     'PNL',
  ups:       'UPS',
  consumer:  'L',
  channel:   'CH',
  zone:      'Z',
};

// ================= Электротехнические расчёты =================

// Напряжение потребителя по фазе
function nodeVoltage(n) {
  if (n.voltage) return Number(n.voltage);
  return (n.phase === '3ph') ? GLOBAL.voltage3ph : GLOBAL.voltage1ph;
}
function isThreePhase(n) { return (n.phase || '3ph') === '3ph'; }

// Установочный ток — ток при номинальной мощности
// I = P / (√3 · U · cos φ)   для 3-фазной
// I = P / (U · cos φ)        для 1-фазной (A/B/C)
function computeCurrentA(P_kW, voltage, cosPhi, threePhase) {
  const P = Number(P_kW) || 0;
  const U = Number(voltage) || 400;
  const cos = Number(cosPhi) || 0.92;
  if (P <= 0) return 0;
  const k = threePhase ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * U * cos);
}

// Номинальный (установочный) ток потребителя или группы
function consumerNominalCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const P = per * cnt;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}
// Расчётный ток (с учётом Ки и loadFactor сценария)
function consumerRatedCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
  const P = per * cnt * k;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}
// Пусковой ток
function consumerInrushCurrent(n) {
  return consumerNominalCurrent(n) * (Number(n.inrushFactor) || 1);
}

// Мощность заряда ИБП по току в А (переход с chargeA на кВт для учёта в нагрузке)
function upsChargeKw(ups) {
  if (typeof ups.chargeKw === 'number' && !('chargeA' in ups)) return Number(ups.chargeKw) || 0;
  const I = Number(ups.chargeA) || 0;
  const U = Number(ups.voltage) || ((ups.phase === '3ph') ? 400 : 230);
  const k = ((ups.phase || '3ph') === '3ph') ? Math.sqrt(3) : 1;
  // cos φ зарядного = 1 (ориентировочно)
  return (I * U * k) / 1000;
}

// Максимально возможная нагрузка downstream (без Ки, loadFactor, Ксим).
// Используется для подбора кабеля — выбираем сечение на «худший» сценарий.
function maxDownstreamLoad(nodeId) {
  let total = 0;
  const seen = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;
      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        total += per * cnt;
      } else if (to.type === 'panel' || to.type === 'ups' || to.type === 'channel') {
        stack.push(to.id);
      }
    }
  }
  return total;
}

// Финальный cos φ щита — взвешенное по активной мощности.
// Суммирует P и Q = P·tan(acos(cos)) по всем downstream-потребителям, cos_total = P / √(P²+Q²)
function panelCosPhi(panelId) {
  let P = 0, Q = 0;
  const seen = new Set();
  const stack = [panelId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;
      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        const k = (Number(to.kUse) || 1) * effectiveLoadFactor(to);
        const p = per * cnt * k;
        const cos = Math.max(0.1, Math.min(1, Number(to.cosPhi) || 0.92));
        const tan = Math.sqrt(1 - cos * cos) / cos;
        P += p;
        Q += p * tan;
      } else if (to.type === 'panel' || to.type === 'ups') {
        stack.push(to.id);
      }
    }
  }
  if (P <= 0) return null;
  return P / Math.sqrt(P * P + Q * Q);
}

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

// ================= Undo / Redo =================
// Снапшотный стек: перед каждым мутирующим действием сохраняется JSON
// текущей схемы. Undo восстанавливает предыдущий снимок, redo — следующий.
// Tag используется для коалесирования подряд идущих мелких правок (например,
// последовательные нажатия клавиш в одном поле инспектора даут один снимок).
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 100;
let _suppressSnapshot = false;
let _lastSnapTag = null;
let _snapCounter = 0;
let _changeCb = null;

function snapshot(tag) {
  if (_suppressSnapshot) return;
  if (tag && tag === _lastSnapTag) return;
  _undoStack.push(JSON.stringify(serialize()));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
  _lastSnapTag = tag || ('#' + (++_snapCounter));
  updateUndoButtons();
}

function clearUndoStack() {
  _undoStack.length = 0;
  _redoStack.length = 0;
  _lastSnapTag = null;
  updateUndoButtons();
}

function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(JSON.stringify(serialize()));
  const prev = _undoStack.pop();
  _suppressSnapshot = true;
  try {
    deserialize(JSON.parse(prev));
    render();
    renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(JSON.stringify(serialize()));
  const next = _redoStack.pop();
  _suppressSnapshot = true;
  try {
    deserialize(JSON.parse(next));
    render();
    renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = _undoStack.length === 0;
  if (r) r.disabled = _redoStack.length === 0;
}

function notifyChange() {
  if (_changeCb && !state.readOnly && !_suppressSnapshot) {
    try { _changeCb(); } catch (e) { console.error('[onChange]', e); }
  }
}

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

// Множитель нагрузки потребителя в текущем режиме (сценарий).
// По умолчанию 1 (100%). Режим «ночь» может выставить 0.2 для освещения и т.д.
function effectiveLoadFactor(n) {
  if (!state.activeModeId) return 1;
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (m && m.overrides && m.overrides[n.id] && typeof m.overrides[n.id].loadFactor === 'number') {
    return m.overrides[n.id].loadFactor;
  }
  return 1;
}
function setEffectiveLoadFactor(n, val) {
  if (!state.activeModeId) return;
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (!m) return;
  if (!m.overrides) m.overrides = {};
  if (!m.overrides[n.id]) m.overrides[n.id] = {};
  m.overrides[n.id].loadFactor = Number(val) || 0;
}
function createMode(name) {
  snapshot();
  const id = uid('m');
  const m = { id, name: name || `Режим ${state.modes.length + 1}`, overrides: {} };
  state.modes.push(m);
  state.activeModeId = id;
  render();
  notifyChange();
}
function deleteMode(id) {
  snapshot();
  state.modes = state.modes.filter(m => m.id !== id);
  if (state.activeModeId === id) state.activeModeId = null;
  render();
  notifyChange();
}
function selectMode(id) {
  state.activeModeId = id;
  render();
  renderInspector();
}

// ================= Геометрия узла =================
function nodeInputCount(n) {
  if (n.type === 'source' || n.type === 'generator') return 0;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.inputs | 0);
}
function nodeOutputCount(n) {
  if (n.type === 'consumer') return 0;
  if (n.type === 'source' || n.type === 'generator') return 1;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.outputs | 0);
}
function nodeWidth(n) {
  if (n.type === 'zone') return Math.max(200, Number(n.width) || 600);
  const maxPorts = Math.max(nodeInputCount(n), nodeOutputCount(n), 1);
  return Math.max(NODE_MIN_W, maxPorts * PORT_GAP_MIN + 24);
}
function nodeHeight(n) {
  if (n.type === 'zone') return Math.max(120, Number(n.height) || 400);
  return NODE_H;
}
function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const h = nodeHeight(n);
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const gap = w / (count + 1);
  const px = n.x + gap * (idx + 1);
  const py = kind === 'in' ? n.y : n.y + h;
  return { x: px, y: py };
}

// ================= Создание / удаление =================
function createNode(type, x, y) {
  snapshot();
  const id = uid();
  const base = { id, type, x, y, ...DEFAULTS[type]() };
  base.tag = nextFreeTag(type);
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}
function deleteNode(id) {
  snapshot();
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
  notifyChange();
}
function deleteConn(id) {
  snapshot();
  state.conns.delete(id);
  if (state.selectedKind === 'conn' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  render();
  renderInspector();
  notifyChange();
}
function clampPortsInvolvingNode(n) {
  // Порты удалять НЕ разрешаем — пользователь должен сначала снять связи.
  // Эта функция теперь только нормализует вспомогательные массивы.
  if (Array.isArray(n.priorities)) {
    while (n.priorities.length < nodeInputCount(n)) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = nodeInputCount(n);
  }
  if (n.type === 'panel' && Array.isArray(n.parallelEnabled)) {
    while (n.parallelEnabled.length < nodeInputCount(n)) n.parallelEnabled.push(false);
    n.parallelEnabled.length = nodeInputCount(n);
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
    // Выход может иметь только одну исходящую связь
    if (c.from.nodeId === from.nodeId && c.from.port === from.port) return false;
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId)) return false;
  snapshot();
  const id = uid('c');
  state.conns.set(id, { id, from, to });
  notifyChange();
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
      if (!effectiveOn(n)) {
        res = null;
      } else if (n.triggerNodeId) {
        // Генератор с триггером
        const trigger = state.nodes.get(n.triggerNodeId);
        if (!trigger) {
          res = (n.backupMode && !allowBackup) ? null : [];
        } else {
          const triggerPowered = activeInputs(n.triggerNodeId, false) !== null;
          if (triggerPowered) {
            // Триггер жив → генератор в дежурстве, не питает
            res = null;
          } else {
            // Триггер мёртв: генератор активен только если симуляция уже его запустила.
            // _running выставляется тиком после startDelaySec.
            if (n._running) {
              res = (n.backupMode && !allowBackup) ? null : [];
            } else {
              // Ещё не запустился — не питает
              res = null;
            }
          }
        }
      } else if (n.backupMode && !allowBackup) {
        res = null;
      } else {
        res = [];
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
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
        // Батарейный резерв — только если батарея реально есть.
        // При принудительном статическом байпасе батарея не используется.
        if (res === null && allowBackup && !n.staticBypassForced) {
          const batt = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
          if (batt > 0) res = [];
        }
      }
    } else if (n.type === 'channel') {
      // Канал — пассивный узел, просто передаёт питание через себя.
      // Имеет один вход и один выход, логика как у щита без АВР.
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        const live = ins.filter(c => activeInputs(c.from.nodeId, false) !== null);
        if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
        else if (allowBackup) {
          const liveB = ins.filter(c => activeInputs(c.from.nodeId, true) !== null);
          if (liveB.length) res = liveB.map(c => ({ conn: c, share: 1 / liveB.length }));
        }
      }
    } else if (n.type === 'zone') {
      // Зона — чисто декоративный контейнер, в расчёте не участвует
      res = null;
    } else {
      // panel или consumer
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        // Ручной режим щита: работает только явно выбранный вход
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
        } else if (n.type === 'panel' && n.switchMode === 'parallel') {
          // Параллельный режим: работают все явно включённые вводные автоматы
          // (для шкафов байпаса и параллельной работы ИБП)
          const enabledMask = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
          const selected = ins.filter(c => enabledMask[c.to.port]);
          // Сначала без резерва
          let live = selected.filter(c => activeInputs(c.from.nodeId, false) !== null);
          if (live.length === 0 && allowBackup) {
            live = selected.filter(c => activeInputs(c.from.nodeId, true) !== null);
          }
          if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
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
      // Потери на ИБП применяем только когда он работает через инвертор.
      // На статическом байпасе КПД = 100%.
      const upsActiveLoss = (nn.type === 'ups') && !nn._onStaticBypass;
      const eff = upsActiveLoss
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
    // Для группы потребителей: суммарный demand = count × demandKw × loadFactor
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const factor = effectiveLoadFactor(n);
    const total = per * count * factor;
    n._loadKw = total;
    walkUp(n.id, total);
  }

  // Зарядный ток ИБП — накидывается поверх проходной мощности, только если:
  // - ИБП включён
  // - Работает от входа (не от батареи)
  // - НЕ на статическом байпасе (при байпасе инвертор выключен, батарея не
  //   заряжается)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!effectiveOn(n)) continue;
    const ai = activeInputs(n.id, true);
    if (!ai || ai.length === 0) continue;

    // Предварительная проверка байпаса ещё до пост-прохода статусов
    const overloadRatio = (Number(n.capacityKw) || 1) > 0
      ? (n._loadKw || 0) / Number(n.capacityKw) * 100
      : 0;
    const onBypass = n.staticBypass && (
      n.staticBypassForced ||
      (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110))
    );
    if (onBypass) continue;

    const ch = upsChargeKw(n);
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

      // Определяем, работает ли статический байпас.
      // Возможно при: принудительном переключении или автоматическом по перегрузке
      // (и только если ИБП получает питание со входа, не с батареи).
      const overloadRatio = (Number(n.capacityKw) || 1) > 0
        ? (n._loadKw || 0) / Number(n.capacityKw) * 100
        : 0;
      const shouldBypass = (
        n.staticBypass && !n._onBattery && n._powered &&
        (n.staticBypassForced || (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110)))
      );
      n._onStaticBypass = shouldBypass;

      if (n._powered && !n._onBattery) {
        if (shouldBypass) {
          // Статический байпас: поток идёт мимо инвертора, КПД = 100%,
          // зарядный ток не потребляется (батарея не обслуживается)
          n._inputKw = n._loadKw;
        } else {
          const eff = Math.max(0.01, (Number(n.efficiency) || 100) / 100);
          n._inputKw = n._loadKw / eff + upsChargeKw(n);
        }
      } else {
        n._inputKw = 0;
      }
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    }
  }

  // Подсчёт защитных автоматов в щитах:
  // для каждого выхода щита, ведущего к потребителю/каналу/вниз — свой автомат.
  // Для группового потребителя (count > 1) — count автоматов одинакового номинала,
  // подобранных по току ОДНОЙ единицы группы.
  // === Расчёт токов, сечений кабелей и подбор автоматов ===
  // Подсчёт «сколько разных цепей идёт через каждый канал» — для коэффициента группировки
  const channelCircuits = new Map(); // channelId → count
  for (const c of state.conns.values()) {
    const ids = Array.isArray(c.channelIds) ? c.channelIds : [];
    for (const chId of ids) {
      channelCircuits.set(chId, (channelCircuits.get(chId) || 0) + 1);
    }
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;

    // Характеристики линии — берутся с downstream-узла
    const threePhase = isThreePhase(toN);
    const U = nodeVoltage(toN);

    // Эффективный cos φ линии
    let cos;
    if (toN.type === 'consumer') cos = Number(toN.cosPhi) || GLOBAL.defaultCosPhi;
    else if (toN.type === 'panel') cos = panelCosPhi(toN.id) || GLOBAL.defaultCosPhi;
    else cos = GLOBAL.defaultCosPhi;

    c._voltage = U;
    c._cosPhi = cos;
    c._threePhase = threePhase;
    c._loadA = c._loadKw > 0 ? computeCurrentA(c._loadKw, U, cos, threePhase) : 0;

    // === Расчётный ток для подбора кабеля: максимально возможный по всем сценариям ===
    // Для потребителя: P_уст × count (Ки и loadFactor НЕ учитываем — «максимум»)
    // Для группы потребителей: то же самое.
    // Для промежуточных связей (щит→щит, ИБП→щит): берём сумму downstream-максимумов.
    let maxKwDownstream;
    if (toN.type === 'consumer') {
      const per = Number(toN.demandKw) || 0;
      const cnt = Math.max(1, Number(toN.count) || 1);
      const inrush = Number(toN.inrushFactor) || 1;
      // Максимум = установочная × кратность пускового (если есть пусковые токи —
      // нужен запас). Кабель обычно выбирают по длительному, но берём максимум
      // длительной нагрузки = P_уст × count (без Ки).
      maxKwDownstream = per * cnt;
    } else if (toN.type === 'panel' || toN.type === 'ups') {
      // Максимально возможная нагрузка downstream — сумма всех потребителей вниз
      maxKwDownstream = maxDownstreamLoad(toN.id);
    } else {
      maxKwDownstream = c._loadKw;
    }
    const maxCurrent = maxKwDownstream > 0
      ? computeCurrentA(maxKwDownstream, U, cos, threePhase)
      : 0;
    c._maxA = maxCurrent;

    // === Параметры прокладки: худший случай из всех каналов на пути связи ===
    // Если каналы не назначены — используем параметры самой связи (как раньше).
    const channelIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    let material = c.material || GLOBAL.defaultMaterial;
    let insulation = c.insulation || GLOBAL.defaultInsulation;
    let method = c.installMethod || GLOBAL.defaultInstallMethod;
    let ambient = Number(c.ambientC) || GLOBAL.defaultAmbient;
    let grouping = Number(c.grouping) || GLOBAL.defaultGrouping;

    // Числовые ранги для сравнения методов прокладки — чем больше ранг, тем «хуже»
    // (меньший длительно-допустимый ток при равном сечении)
    const methodRank = { F: 0, E: 1, C: 2, B1: 3, B2: 3, D1: 4 };

    if (channelIds.length) {
      // Берём первый канал как базу и усугубляем параметры каждым следующим
      let worstMethod = null;
      let worstAmbient = 0;
      let maxGroup = 0;
      let hasChannel = false;
      for (const chId of channelIds) {
        const ch = state.nodes.get(chId);
        if (!ch || ch.type !== 'channel') continue;
        hasChannel = true;
        const chAmb = Number(ch.ambientC) || 30;
        if (chAmb > worstAmbient) worstAmbient = chAmb;
        const chMethod = ch.method || 'B1';
        if (worstMethod === null || (methodRank[chMethod] || 0) > (methodRank[worstMethod] || 0)) {
          worstMethod = chMethod;
        }
        const grpInCh = channelCircuits.get(chId) || 1;
        if (grpInCh > maxGroup) maxGroup = grpInCh;
        // Материал и изоляция берутся с последнего канала по пути (если разные —
        // это ошибка монтажа, но усугубление в сторону «хуже» невозможно тривиально,
        // поэтому используем значения последнего канала)
        if (ch.material) material = ch.material;
        if (ch.insulation) insulation = ch.insulation;
      }
      if (hasChannel) {
        method = worstMethod || method;
        ambient = Math.max(ambient, worstAmbient);
        grouping = Math.max(grouping, maxGroup);
      }
    }

    // Количество параллельных проводников:
    // Для группы потребителей (N штук) — каждый требует своей отдельной кабельной
    // пары. Одна линия к группе из 10 потребителей = 10 параллельных цепей в одном
    // канале. Это используется и как parallel (для уменьшения тока на жилу),
    // и как повышение группировки в канале (уже посчитано через channelCircuits —
    // но если канал не назначен, учитываем группу через parallel).
    let conductorsInParallel = 1;
    if (toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
      conductorsInParallel = Number(toN.count) || 1;
      // Если канал не назначен, добавим эти цепи в группировку связи
      if (channelIds.length === 0) grouping = Math.max(grouping, conductorsInParallel);
    }

    c._cableMaterial = material;
    c._cableInsulation = insulation;
    c._cableMethod = method;
    c._cableAmbient = ambient;
    c._cableGrouping = grouping;
    c._cableParallel = conductorsInParallel;
    c._channelChain = channelIds.slice();

    if (maxCurrent > 0) {
      const sel = selectCableSize(maxCurrent, {
        material, insulation, method, ambientC: ambient, grouping,
        conductorsInParallel,
      });
      c._cableSize = sel.s;
      c._cableIz = sel.iDerated;
      c._cableTotalIz = sel.totalCapacity;
      c._cableOverflow = !!sel.overflow;
    } else {
      c._cableSize = null;
      c._cableIz = 0;
      c._cableTotalIz = 0;
      c._cableOverflow = false;
    }
  }

  // === Подбор защитных автоматов на выходах ===
  // Для каждой связи определяем, является ли она "ответвлением" щита/ИБП/источника.
  // Если да — подбираем номинал автомата защиты по расчётному току ОДНОЙ жилы
  // группы (т.к. внутри шкафа на каждую параллельную цепь ставится свой автомат).
  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    if (!fromN) continue;
    if (fromN.type !== 'panel' && fromN.type !== 'ups' && fromN.type !== 'source') {
      c._breakerIn = null;
      c._breakerCount = 0;
      continue;
    }
    const toN = state.nodes.get(c.to.nodeId);
    if (!toN) { c._breakerIn = null; c._breakerCount = 0; continue; }

    // Ток одной жилы внутри группы (для групповых потребителей делим на count)
    const parallel = Math.max(1, c._cableParallel || 1);
    const Iper = (c._maxA || 0) / parallel;
    if (Iper <= 0) {
      c._breakerIn = null;
      c._breakerCount = 0;
      continue;
    }
    c._breakerIn = selectBreaker(Iper);
    c._breakerCount = parallel;
    // Проверка: сечение должно выдерживать ток автомата (упрощённая селективность
    // по току: Iz ≥ In). Если нет — помечаем связь как «не селективно».
    c._breakerAgainstCable = !!(c._cableIz && c._breakerIn && c._cableIz < c._breakerIn);
  }

  // === Расчёт финального cos φ и токов для щитов / ИБП / источников ===
  for (const n of state.nodes.values()) {
    if (n.type === 'panel') {
      n._cosPhi = panelCosPhi(n.id);
      // Расчётная мощность щита учитывает Ксим
      const kSim = Number(n.kSim) || 1;
      n._calcKw = (n._loadKw || 0) * kSim;
      n._loadA = n._calcKw > 0 ? computeCurrentA(n._calcKw, nodeVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'source' || n.type === 'generator') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'ups') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'consumer') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._nominalA = consumerNominalCurrent(n);
      n._ratedA = consumerRatedCurrent(n);
      n._inrushA = consumerInrushCurrent(n);
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

// Путь сплайна с промежуточными точками. Использует Catmull-Rom → Bezier, чтобы
// линия проходила через все waypoints гладко.
function splinePath(a, points, b) {
  if (!points || points.length === 0) return bezier(a, b);
  const pts = [a, ...points, b];
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // Catmull-Rom → cubic Bezier
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
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

  // Сначала рисуем зоны (они позади обычных узлов)
  for (const n of state.nodes.values()) {
    if (n.type !== 'zone') continue;
    const w = nodeWidth(n), h = nodeHeight(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const g = el('g', {
      class: 'node zone' + (selected ? ' selected' : ''),
      transform: `translate(${n.x},${n.y})`,
    });
    g.dataset.nodeId = n.id;
    g.appendChild(el('rect', {
      class: 'zone-body',
      x: 0, y: 0, width: w, height: h,
      fill: n.color || '#e3f2fd',
      'fill-opacity': 0.25,
    }));
    // Подпись: префикс зоны крупнее, имя ниже
    g.appendChild(text(12, 22, n.zonePrefix || n.tag || '', 'zone-prefix'));
    g.appendChild(text(12, 40, n.name || '', 'zone-name'));
    // Уголок для ресайза
    g.appendChild(el('rect', {
      class: 'zone-resize', x: w - 14, y: h - 14, width: 12, height: 12,
    }));
    layerNodes.appendChild(g);
  }

  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    const w = nodeWidth(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const cls = [
      'node', n.type,
      selected ? 'selected' : '',
      n._overload ? 'overload' : '',
      (!n._powered && (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups')) ? 'unpowered' : '',
      (n.type === 'ups' && n._onBattery) ? 'onbattery' : '',
      (n.type === 'ups' && n._onStaticBypass) ? 'onbypass' : '',
      (n.type === 'panel' && n.switchMode === 'manual') ? 'manual' : '',
    ].filter(Boolean).join(' ');

    const g = el('g', { class: cls, transform: `translate(${n.x},${n.y})` });
    g.dataset.nodeId = n.id;

    g.appendChild(el('rect', { class: 'node-body', x: 0, y: 0, width: w, height: NODE_H }));

    // Обозначение — с учётом префикса зоны («P1.MPB1»)
    const displayTag = effectiveTag(n);
    if (displayTag) g.appendChild(text(12, 16, displayTag, 'node-tag'));

    // Имя
    g.appendChild(text(12, 33, n.name || '(без имени)', 'node-title'));

    // Подпись типа
    const subTxt = {
      source:    'Источник',
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel:     `Щит · вх ${n.inputs} · вых ${n.outputs}` +
                   (n.switchMode === 'manual' ? ' · руч.' : n.switchMode === 'parallel' ? ' · пар.' : ''),
      ups:       `ИБП · КПД ${Math.round(Number(n.efficiency) || 100)}%` +
                   (n._onStaticBypass ? ' · БАЙПАС' : ''),
      consumer:  ((n.count || 1) > 1
                    ? `Группа · ${n.count} × ${fmt(n.demandKw)} kW`
                    : 'Потребитель') + (n.inputs > 1 ? ` · вх ${n.inputs}` : ''),
      channel:   `Канал · ${n.material || 'Cu'} / ${n.insulation || 'PVC'} · ${n.method || 'B1'}`,
    }[n.type];
    g.appendChild(text(12, 49, subTxt, 'node-sub'));

    // Нагрузка
    let loadLine = '', loadCls = 'node-load';
    if (n.type === 'source') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'generator') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else if (n.triggerNodeId && n._startCountdown > 0) {
        loadLine = `ПУСК через ${Math.ceil(n._startCountdown)} с`;
        loadCls += ' off';
      } else if (n.triggerNodeId && !n._running) {
        loadLine = 'Дежурство';
        loadCls += ' off';
      } else {
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
        let suffix = '';
        if (n._onStaticBypass) suffix = ' · БАЙПАС';
        else if (n._onBattery) {
          const sec = Math.max(0, Math.round(n._runtimeLeftSec || 0));
          const mm = Math.floor(sec / 60);
          const ss = sec % 60;
          suffix = ` · БАТ ${mm}:${String(ss).padStart(2, '0')}`;
        }
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW${suffix}`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'consumer') {
      loadLine = n._powered ? `${fmt(n.demandKw)} kW` : `${fmt(n.demandKw)} kW · нет`;
      if (!n._powered) loadCls += ' off';
    } else if (n.type === 'channel') {
      loadLine = `${n.ambientC || 30}°C · ${n.lengthM || 0} м`;
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

  // Control-линии: от триггера к генератору (тонкая пунктирная)
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator' || !n.triggerNodeId) continue;
    const trigger = state.nodes.get(n.triggerNodeId);
    if (!trigger) continue;
    const genW = nodeWidth(n);
    const trigW = nodeWidth(trigger);
    const a = { x: trigger.x + trigW / 2, y: trigger.y + NODE_H / 2 };
    const b = { x: n.x + genW / 2, y: n.y + NODE_H / 2 };
    // Активна линия запуска, когда триггер мёртв и генератор включён
    const triggerAlive = !!trigger._powered;
    const started = effectiveOn(n) && !triggerAlive;
    const cls = started ? 'control-line started' : 'control-line';
    layerConns.appendChild(el('line', {
      class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    }));
    // Ярлык "ПУСК / дежурство"
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const label = started ? 'ПУСК' : 'дежурство';
    layerConns.appendChild(text(mid.x, mid.y - 4, label, 'control-label' + (started ? ' started' : '')));
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const waypoints = Array.isArray(c.waypoints) ? c.waypoints : [];
    const d = splinePath(a, waypoints, b);

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

    // Подпись на активных линиях: мощность + ток + сечение.
    if (c._state === 'active' && c._loadKw > 0) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let power;
      if (toN.type === 'consumer' && (toN.count || 1) > 1) {
        power = `${toN.count}×${fmt(toN.demandKw)} kW`;
      } else {
        power = `${fmt(c._loadKw)} kW`;
      }
      const amps = c._loadA > 0 ? ` · ${fmt(c._loadA)} A` : '';
      const size = c._cableSize ? ` · ${c._cableSize} мм²` : '';
      const labelText = power + amps + size;
      const lbl = text(mid.x, mid.y - 4, labelText, 'conn-label' + (c._cableOverflow ? ' overload' : ''));
      layerConns.appendChild(lbl);
    }

    // Рукоятки на обоих концах выделенной связи + точки сплайна
    if (selected) {
      const h1 = el('circle', { class: 'conn-handle', cx: b.x, cy: b.y, r: 7 });
      h1.dataset.reconnectId = c.id;
      h1.dataset.reconnectEnd = 'to';
      layerConns.appendChild(h1);
      const h2 = el('circle', { class: 'conn-handle', cx: a.x, cy: a.y, r: 7 });
      h2.dataset.reconnectId = c.id;
      h2.dataset.reconnectEnd = 'from';
      layerConns.appendChild(h2);

      // Существующие waypoints
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const dot = el('circle', { class: 'conn-waypoint', cx: wp.x, cy: wp.y, r: 5 });
        dot.dataset.waypointId = c.id;
        dot.dataset.waypointIdx = i;
        layerConns.appendChild(dot);
      }
      // «Плюсы» для добавления новых waypoints в середине каждого сегмента
      const chain = [a, ...waypoints, b];
      for (let i = 0; i < chain.length - 1; i++) {
        const mid = { x: (chain[i].x + chain[i + 1].x) / 2, y: (chain[i].y + chain[i + 1].y) / 2 };
        const plus = el('circle', { class: 'conn-waypoint-add', cx: mid.x, cy: mid.y, r: 4 });
        plus.dataset.waypointAddId = c.id;
        plus.dataset.waypointAddIdx = i; // вставка перед позицией i в waypoints
        layerConns.appendChild(plus);
      }
    }

    // Бейдж автомата на выходе источника/щита/ИБП (ближе к from-концу)
    if (c._breakerIn && c._state === 'active') {
      // Находим точку ~25% пути от a к b
      const labelPos = waypoints.length
        ? { x: (a.x + waypoints[0].x) / 2, y: (a.y + waypoints[0].y) / 2 }
        : { x: a.x + (b.x - a.x) * 0.22, y: a.y + (b.y - a.y) * 0.22 };
      const txt = c._breakerCount > 1
        ? `${c._breakerCount}×C${c._breakerIn}А`
        : `C${c._breakerIn}А`;
      const cls = 'breaker-badge' + (c._breakerAgainstCable ? ' overload' : '');
      layerConns.appendChild(text(labelPos.x, labelPos.y + 14, txt, cls));
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
        snapshot('mode-name:' + mid);
        const m = state.modes.find(x => x.id === mid);
        if (m) m.name = nameInput.value;
        notifyChange();
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
  // Для зоны — обозначение называется «Префикс зоны» и редактируется в zonePrefix
  if (n.type === 'zone') {
    h.push(field('Префикс зоны', `<input type="text" data-prop="zonePrefix" value="${escAttr(n.zonePrefix || '')}" placeholder="P1">`));
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));
    h.push(field('Ширина, px', `<input type="number" min="200" max="4000" step="40" data-prop="width" value="${n.width || 600}">`));
    h.push(field('Высота, px', `<input type="number" min="120" max="4000" step="40" data-prop="height" value="${n.height || 400}">`));
    h.push(field('Цвет фона', `<input type="text" data-prop="color" value="${escAttr(n.color || '#e3f2fd')}">`));
    // Показать какие узлы принадлежат зоне
    const children = nodesInZone(n);
    if (children.length) {
      h.push('<div class="inspector-section"><h4>Элементы в зоне</h4>');
      h.push('<div style="font-size:11px;line-height:1.8">');
      for (const ch of children) {
        h.push(`<div>${escHtml(effectiveTag(ch))} — ${escHtml(ch.name || '')}</div>`);
      }
      h.push('</div></div>');
    }
    h.push('<button class="btn-delete" id="btn-del-node">Удалить зону</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    return;
  }
  // Channel — свои поля
  if (n.type === 'channel') {
    h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));
    h.push(field('Материал жил',
      `<select data-prop="material">
        <option value="Cu"${(n.material || 'Cu') === 'Cu' ? ' selected' : ''}>Медь</option>
        <option value="Al"${n.material === 'Al' ? ' selected' : ''}>Алюминий</option>
      </select>`));
    h.push(field('Изоляция',
      `<select data-prop="insulation">
        <option value="PVC"${(n.insulation || 'PVC') === 'PVC' ? ' selected' : ''}>ПВХ</option>
        <option value="XLPE"${n.insulation === 'XLPE' ? ' selected' : ''}>СПЭ (XLPE)</option>
      </select>`));
    const mth = n.method || 'B1';
    h.push(field('Способ прокладки',
      `<select data-prop="method">
        <option value="B1"${mth === 'B1' ? ' selected' : ''}>B1 — в трубе на стене</option>
        <option value="B2"${mth === 'B2' ? ' selected' : ''}>B2 — многожильный в трубе</option>
        <option value="C"${mth === 'C' ? ' selected' : ''}>C — открыто на стене</option>
        <option value="E"${mth === 'E' ? ' selected' : ''}>E — на лотке (многожильный)</option>
        <option value="F"${mth === 'F' ? ' selected' : ''}>F — на лотке (одножильные)</option>
        <option value="D1"${mth === 'D1' ? ' selected' : ''}>D1 — в земле</option>
      </select>`));
    h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-prop="ambientC" value="${n.ambientC || 30}">`));
    h.push(field('Длина канала, м', `<input type="number" min="0" max="10000" step="1" data-prop="lengthM" value="${n.lengthM || 0}">`));
    // Показать сколько линий идёт через этот канал
    let circuits = 0;
    for (const c of state.conns.values()) {
      if (Array.isArray(c.channelIds) && c.channelIds.includes(n.id)) circuits++;
    }
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Цепей в канале: <b>${circuits}</b><br>Коэффициент группировки применяется ко всем кабелям, проходящим через канал.</div></div>`);
    h.push('<button class="btn-delete" id="btn-del-node">Удалить канал</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    return;
  }

  h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
  // Показать эффективное обозначение если отличается
  const eff = effectiveTag(n);
  if (eff && eff !== n.tag) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное обозначение: <b>${escHtml(eff)}</b></div>`);
  }
  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

  if (n.type === 'source') {
    h.push(field('Мощность, kW', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(phaseField(n));
    h.push(field('Напряжение, В', `<input type="number" min="100" max="50000" step="1" data-prop="voltage" value="${n.voltage || 400}">`));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.95}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    h.push(sourceStatusBlock(n));
  } else if (n.type === 'generator') {
    h.push(field('Мощность, kW', `<input type="number" min="0" step="1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(phaseField(n));
    h.push(field('Напряжение, В', `<input type="number" min="100" max="50000" step="1" data-prop="voltage" value="${n.voltage || 400}">`));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.85}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
    // Триггер запуска
    const triggerOpts = ['<option value="">— не назначен —</option>'];
    for (const other of state.nodes.values()) {
      if (other.id === n.id) continue;
      if (other.type !== 'source' && other.type !== 'panel') continue;
      const sel = n.triggerNodeId === other.id ? ' selected' : '';
      triggerOpts.push(`<option value="${escAttr(other.id)}"${sel}>${escHtml(other.tag || '')} ${escHtml(other.name || '')}</option>`);
    }
    h.push('<div class="inspector-section"><h4>Линия запуска</h4>');
    h.push(field('Триггер (запускаться при обесточке)', `<select data-prop="triggerNodeId">${triggerOpts.join('')}</select>`));
    h.push(field('Задержка запуска, сек', `<input type="number" min="0" max="600" step="1" data-prop="startDelaySec" value="${n.startDelaySec || 0}">`));
    h.push('<div class="muted" style="font-size:11px">Если триггер задан, генератор запускается только когда триггер обесточен. В дежурном состоянии линия запуска серая.</div>');
    h.push('</div>');
    h.push(sourceStatusBlock(n));
  } else if (n.type === 'panel') {
    h.push(field('Входов', `<input type="number" min="1" max="30" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="30" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(field('Ксим (коэффициент одновременности)', `<input type="number" min="0" max="1.2" step="0.05" data-prop="kSim" value="${n.kSim ?? 1}">`));
    const sm = n.switchMode || 'auto';
    h.push(field('Режим переключения',
      `<select data-prop="switchMode">
        <option value="auto"${sm === 'auto' ? ' selected' : ''}>Автоматический (АВР)</option>
        <option value="manual"${sm === 'manual' ? ' selected' : ''}>Ручной — один вход</option>
        <option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Параллельный — несколько вводов</option>
      </select>`));
    if (sm === 'manual' && n.inputs > 0) {
      const opts = [];
      for (let i = 0; i < n.inputs; i++) {
        opts.push(`<option value="${i}"${(n.manualActiveInput | 0) === i ? ' selected' : ''}>Вход ${i + 1}</option>`);
      }
      h.push(field('Активный вход',
        `<select data-prop="manualActiveInput">${opts.join('')}</select>`));
      h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Работает только явно выбранный вход. Если на нём нет напряжения — щит обесточен.</div>');
    } else if (sm === 'parallel' && n.inputs > 0) {
      h.push('<div class="inspector-section"><h4>Включённые вводы</h4>');
      h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Можно включить несколько вводных автоматов одновременно — актуально для шкафов байпаса и параллельной работы ИБП.</div>');
      const enabled = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
      for (let i = 0; i < n.inputs; i++) {
        const on = !!enabled[i];
        h.push(`<div class="field check"><input type="checkbox" data-parallel="${i}"${on ? ' checked' : ''}><label>Вход ${i + 1}</label></div>`);
      }
      h.push('</div>');
    } else {
      h.push(prioritySection(n));
    }
    h.push(panelStatusBlock(n));
  } else if (n.type === 'ups') {
    h.push(field('Выходная мощность, kW', `<input type="number" min="0" step="0.1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(field('КПД, %', `<input type="number" min="30" max="100" step="1" data-prop="efficiency" value="${n.efficiency}">`));
    h.push(phaseField(n));
    h.push(field('Напряжение, В', `<input type="number" min="100" max="1000" step="1" data-prop="voltage" value="${n.voltage || 400}">`));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.92}">`));
    h.push(field('Ток заряда батареи, А', `<input type="number" min="0" step="0.1" data-prop="chargeA" value="${n.chargeA ?? 2}">`));
    h.push(field('Ёмкость батареи, kWh', `<input type="number" min="0" step="0.1" data-prop="batteryKwh" value="${n.batteryKwh}">`));
    h.push(field('Заряд батареи, %', `<input type="number" min="0" max="100" step="1" data-prop="batteryChargePct" value="${n.batteryChargePct}">`));
    h.push(field('Входов', `<input type="number" min="1" max="5" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="20" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    if (n.inputs > 1) h.push(prioritySection(n));

    // Статический байпас
    h.push('<div class="inspector-section"><h4>Внутренний статический байпас</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Встроенная функция ИБП: при перегрузке или принудительно переводит нагрузку напрямую со входа, минуя инвертор. КПД = 100%, батарея не заряжается.</div>');
    h.push(checkField('Байпас разрешён', 'staticBypass', n.staticBypass !== false));
    h.push(checkField('Автоматический (по перегрузу)', 'staticBypassAuto', n.staticBypassAuto !== false));
    h.push(field('Порог перехода, % от Pном', `<input type="number" min="80" max="200" step="5" data-prop="staticBypassOverloadPct" value="${n.staticBypassOverloadPct || 110}">`));
    h.push(checkField('Принудительный байпас (вручную)', 'staticBypassForced', !!n.staticBypassForced));
    h.push('</div>');

    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(field('Количество в группе', `<input type="number" min="1" max="999" step="1" data-prop="count" value="${n.count || 1}">`));
    h.push(field(((n.count || 1) > 1 ? 'Мощность каждого, kW' : 'Установленная мощность, kW'),
      `<input type="number" min="0" step="0.1" data-prop="demandKw" value="${n.demandKw}">`));
    if ((n.count || 1) > 1) {
      const total = (Number(n.demandKw) || 0) * (n.count | 0);
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Суммарная установленная: <b>${n.count} × ${fmt(n.demandKw)} kW = ${fmt(total)} kW</b></div>`);
    }
    h.push(phaseFieldConsumer(n));
    h.push(field('Напряжение, В', `<input type="number" min="100" max="50000" step="1" data-prop="voltage" value="${n.voltage || (n.phase === '3ph' ? 400 : 230)}">`));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi ?? 0.92}">`));
    h.push(field('Ки — коэффициент использования', `<input type="number" min="0" max="1" step="0.05" data-prop="kUse" value="${n.kUse ?? 1}">`));
    h.push(field('Кратность пускового тока', `<input type="number" min="1" max="10" step="0.1" data-prop="inrushFactor" value="${n.inrushFactor ?? 1}">`));
    h.push(field('Входов', `<input type="number" min="1" max="10" step="1" data-prop="inputs" value="${n.inputs}">`));
    if (n.inputs > 1) h.push(prioritySection(n));
    // Расчётные величины
    h.push(consumerCurrentsBlock(n));
    // В активном сценарии — поле множителя нагрузки
    if (state.activeModeId) {
      const lf = effectiveLoadFactor(n);
      h.push('<div class="inspector-section"><h4>В текущем сценарии</h4>');
      h.push(field('Множитель нагрузки (0–3)', `<input type="number" min="0" max="3" step="0.05" data-loadfactor value="${lf}">`));
      h.push(`<div class="muted" style="font-size:11px;margin-top:-4px">1.0 = номинал, 0.5 = 50% мощности, 0 = выключено.</div>`);
      h.push('</div>');
    }
    h.push(statusBlock(n));
  }

  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Изменения параметра «В работе» сохраняются в режиме <b>${escAttr(m?.name || '')}</b></div></div>`);
  }

  // Кнопка сохранения элемента в пользовательскую библиотеку
  if (n.type !== 'zone') {
    h.push('<button id="btn-save-preset" class="full-btn" style="margin-top:10px">★ Сохранить в библиотеку</button>');
  }
  h.push('<button class="btn-delete" id="btn-del-node">Удалить элемент</button>');

  // Полный дамп параметров узла
  h.push(renderFullPropsBlock(n));

  inspectorBody.innerHTML = h.join('');

  wireInspectorInputs(n);

  const saveBtn = document.getElementById('btn-save-preset');
  if (saveBtn) saveBtn.addEventListener('click', () => saveNodeAsPreset(n));
}

// Полный блок «Все данные объекта» внизу инспектора
function renderFullPropsBlock(n) {
  const rows = [];
  // Список полей, которые мы не хотим показывать (координаты, runtime)
  const skip = new Set(['id', 'x', 'y', 'width', 'height']);
  const keys = Object.keys(n).filter(k => !k.startsWith('_') && !skip.has(k));
  keys.sort();
  for (const k of keys) {
    let v = n[k];
    if (v === null || v === undefined) v = '—';
    else if (typeof v === 'object') v = JSON.stringify(v);
    else v = String(v);
    rows.push(`<tr><td class="fp-k">${escHtml(k)}</td><td class="fp-v">${escHtml(v)}</td></tr>`);
  }
  // Runtime-значения (с префиксом _)
  const runtimeKeys = Object.keys(n).filter(k => k.startsWith('_'));
  runtimeKeys.sort();
  if (runtimeKeys.length) {
    rows.push('<tr><td colspan="2" class="fp-sep">— Расчётные величины —</td></tr>');
    for (const k of runtimeKeys) {
      let v = n[k];
      if (typeof v === 'number') v = Number(v).toFixed(3).replace(/\.?0+$/, '');
      else if (v === null || v === undefined) v = '—';
      else if (typeof v === 'object') v = JSON.stringify(v);
      rows.push(`<tr><td class="fp-k">${escHtml(k)}</td><td class="fp-v">${escHtml(String(v))}</td></tr>`);
    }
  }
  return `<div class="inspector-section full-props"><h4>Все данные объекта</h4><table class="fp-table">${rows.join('')}</table></div>`;
}

// Сохранение узла как пользовательского пресета
const USER_PRESET_KEY = 'raschet.userPresets.v1';
function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESET_KEY)) || []; }
  catch { return []; }
}
function saveUserPresets(list) {
  try { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list)); }
  catch (e) { console.error('[userPresets]', e); }
}
function saveNodeAsPreset(n) {
  const title = prompt('Название пресета:', `${n.name || n.type}`);
  if (!title) return;
  const params = JSON.parse(JSON.stringify(n));
  // Чистим технические поля
  delete params.id; delete params.x; delete params.y; delete params.tag;
  for (const k of Object.keys(params)) if (k.startsWith('_')) delete params[k];
  const list = loadUserPresets();
  list.push({
    id: 'user-' + Date.now().toString(36),
    category: 'Мои',
    title,
    description: `Сохранено ${new Date().toLocaleString()}`,
    type: n.type,
    params,
    custom: true,
  });
  saveUserPresets(list);
  // Регистрируем в общем каталоге пресетов, если Presets уже загружен
  if (window.Presets && window.Presets.all) {
    window.Presets.all.push(list[list.length - 1]);
  }
  flash('Сохранено в библиотеку: ' + title);
}

function wireInspectorInputs(n) {
  inspectorBody.querySelectorAll('[data-prop]').forEach(inp => {
    const prop = inp.dataset.prop;
    const apply = () => {
      snapshot('prop:' + n.id + ':' + prop);
      let v;
      if (inp.type === 'checkbox') v = inp.checked;
      else if (inp.type === 'number') v = Number(inp.value);
      else v = inp.value;

      if (prop === 'tag') {
        const t = String(v || '').trim();
        if (!t) return;
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
      } else if (prop === 'inputs' || prop === 'outputs') {
        const newN = Math.max(1, Number(v) || 1);
        const kind = prop === 'inputs' ? 'in' : 'out';
        const maxUsed = maxOccupiedPort(n.id, kind);
        if (newN <= maxUsed) {
          flash(`Нельзя уменьшить: ${prop === 'inputs' ? 'вход' : 'выход'} №${maxUsed + 1} занят. Сначала отключите линию.`, 'error');
          inp.value = n[prop];
          return;
        }
        n[prop] = newN;
      } else if (prop === 'triggerNodeId') {
        // Пустая строка → null, иначе id
        n.triggerNodeId = v ? String(v) : null;
      } else if (prop === 'phase' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        n.phase = v;
        // Автоматически выставляем напряжение по фазности
        if (v === '3ph') n.voltage = 400;
        else if (v === '1ph') n.voltage = 230;
      } else if (prop === 'phase' && n.type === 'consumer') {
        n.phase = v;
        if (v === '3ph') n.voltage = 400;
        else n.voltage = 230;
      } else {
        n[prop] = v;
      }
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      render();
      notifyChange();
      // Перерисовать инспектор при изменениях, от которых зависят другие поля
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId') {
        renderInspector();
      }
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', apply);
  });
  // Чекбоксы параллельного режима щита
  inspectorBody.querySelectorAll('[data-parallel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('parallel:' + n.id);
      const idx = Number(inp.dataset.parallel);
      if (!Array.isArray(n.parallelEnabled)) n.parallelEnabled = [];
      while (n.parallelEnabled.length <= idx) n.parallelEnabled.push(false);
      n.parallelEnabled[idx] = inp.checked;
      render();
      notifyChange();
    });
  });
  inspectorBody.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      snapshot('prio:' + n.id + ':' + idx);
      if (!n.priorities) n.priorities = [];
      n.priorities[idx] = Number(inp.value) || 1;
      render();
      notifyChange();
    });
  });
  inspectorBody.querySelectorAll('[data-loadfactor]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('lf:' + n.id);
      setEffectiveLoadFactor(n, inp.value);
      render();
      notifyChange();
    });
  });

  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => deleteNode(n.id));
}

// Поле фазы 3ph/1ph для источников/генераторов/ИБП
function phaseField(n) {
  const ph = n.phase || '3ph';
  return field('Фазность',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="1ph"${ph === '1ph' ? ' selected' : ''}>Однофазная (230 В)</option>
    </select>`);
}
// Поле фазы для потребителя (A/B/C/3ph)
function phaseFieldConsumer(n) {
  const ph = n.phase || '3ph';
  return field('Фаза',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="A"${ph === 'A' ? ' selected' : ''}>Фаза A (230 В)</option>
      <option value="B"${ph === 'B' ? ' selected' : ''}>Фаза B (230 В)</option>
      <option value="C"${ph === 'C' ? ' selected' : ''}>Фаза C (230 В)</option>
    </select>`);
}
// Блок статуса для источников и генераторов
function sourceStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) parts.push('<span class="badge off">отключён</span>');
  else {
    const pct = (Number(n.capacityKw) || 0) > 0 ? Math.round((n._loadKw || 0) / n.capacityKw * 100) : 0;
    parts.push(n._overload ? '<span class="badge off">перегруз</span>' : '<span class="badge on">в работе</span>');
    parts.push(`нагрузка: <b>${fmt(n._loadKw || 0)} / ${fmt(n.capacityKw)} kW</b> (${pct}%)`);
    if (n._loadA > 0) parts.push(`ток: <b>${fmt(n._loadA)} A</b>`);
    if (n._cosPhi) parts.push(`cos φ: <b>${n._cosPhi.toFixed(2)}</b>`);
  }
  if (n.type === 'generator' && n.triggerNodeId) {
    const t = state.nodes.get(n.triggerNodeId);
    if (t) {
      const tPowered = !!t._powered;
      parts.push(`триггер: <b>${escHtml(t.tag || '')}</b> — ${tPowered ? 'норма (дежурство)' : 'обесточен (пуск)'}`);
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
// Блок статуса для щита
function panelStatusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">запитан</span>');
  else parts.push('<span class="badge off">без питания</span>');
  parts.push(`нагрузка: <b>${fmt(n._loadKw || 0)} kW</b>`);
  if (n._loadA > 0) parts.push(`ток: <b>${fmt(n._loadA)} A</b>`);
  if (n._cosPhi) parts.push(`финальный cos φ: <b>${n._cosPhi.toFixed(2)}</b>`);
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
// Блок расчётных токов для потребителя
function consumerCurrentsBlock(n) {
  const parts = [];
  parts.push(`<b>Установочный ток:</b> ${fmt(n._nominalA || 0)} А`);
  parts.push(`<b>Расчётный ток:</b> ${fmt(n._ratedA || 0)} А  <span class="muted">(с учётом Ки)</span>`);
  if ((n.inrushFactor || 1) > 1) {
    parts.push(`<b>Пусковой ток:</b> ${fmt(n._inrushA || 0)} А`);
  }
  return `<div class="inspector-section"><h4>Расчётные величины</h4><div style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}

// Мини-escape для HTML (дубликат main.js, т.к. app.js его не видит)
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
  } else if (n._onStaticBypass) {
    parts.push('<span class="badge backup">статический байпас</span>');
    parts.push(`<span class="muted">инвертор выключен, поток идёт со входа напрямую</span>`);
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    parts.push(`на входе: <b>${fmt(n._inputKw)} kW</b> (без потерь)`);
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
  h.push('<div class="muted" style="font-size:12px;margin-bottom:8px">Линия / связь</div>');
  h.push(`<div class="field"><label>Откуда</label><div>${escHtml(effectiveTag(fromN))} · ${escHtml(fromN?.name || '?')} · выход ${c.from.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Куда</label><div>${escHtml(effectiveTag(toN))} · ${escHtml(toN?.name || '?')} · вход ${c.to.port + 1}</div></div>`);

  if (c._state === 'active') {
    h.push('<div class="inspector-section"><h4>Нагрузка линии</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Текущая P: <b>${fmt(c._loadKw)} kW</b><br>` +
      `Текущий I: <b>${fmt(c._loadA || 0)} A</b><br>` +
      `Расчётный I для кабеля: <b>${fmt(c._maxA || 0)} A</b> <span class="muted">(по максимально возможной нагрузке)</span><br>` +
      (c._cosPhi ? `cos φ: <b>${c._cosPhi.toFixed(2)}</b><br>` : '') +
      `Напряжение: <b>${c._voltage || '-'} В</b>` +
      `</div></div>`);
  }

  // Выбор каналов на пути линии
  const channels = [...state.nodes.values()].filter(n => n.type === 'channel');
  if (channels.length) {
    h.push('<div class="inspector-section"><h4>Кабельные каналы на пути</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Отметьте каналы, через которые проходит линия. Расчёт возьмёт самые худшие параметры прокладки и учтёт группировку цепей в каждом канале.</div>');
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')} (${escHtml(ch.material || 'Cu')}/${escHtml(ch.insulation || 'PVC')}, ${escHtml(ch.method || 'B1')}, ${ch.ambientC || 30}°C)</label></div>`);
    }
    h.push('</div>');
  }

  // Параметры кабеля (используются если каналы не назначены)
  h.push('<div class="inspector-section"><h4>Параметры кабеля</h4>');
  h.push('<div class="muted" style="font-size:11px;margin-bottom:6px">Если выбраны каналы — эти значения переопределяются параметрами каналов (худший случай).</div>');
  const material = c.material || GLOBAL.defaultMaterial;
  h.push(field('Материал жил',
    `<select data-conn-prop="material">
      <option value="Cu"${material === 'Cu' ? ' selected' : ''}>Медь</option>
      <option value="Al"${material === 'Al' ? ' selected' : ''}>Алюминий</option>
    </select>`));
  const insulation = c.insulation || GLOBAL.defaultInsulation;
  h.push(field('Изоляция',
    `<select data-conn-prop="insulation">
      <option value="PVC"${insulation === 'PVC' ? ' selected' : ''}>ПВХ</option>
      <option value="XLPE"${insulation === 'XLPE' ? ' selected' : ''}>СПЭ (XLPE)</option>
    </select>`));
  const method = c.installMethod || GLOBAL.defaultInstallMethod;
  h.push(field('Способ прокладки',
    `<select data-conn-prop="installMethod">
      <option value="B1"${method === 'B1' ? ' selected' : ''}>B1 — в трубе на стене</option>
      <option value="B2"${method === 'B2' ? ' selected' : ''}>B2 — многожильный в трубе</option>
      <option value="C"${method === 'C' ? ' selected' : ''}>C — открыто на стене</option>
      <option value="E"${method === 'E' ? ' selected' : ''}>E — на лотке (многожильный)</option>
      <option value="F"${method === 'F' ? ' selected' : ''}>F — на лотке (одножильные)</option>
      <option value="D1"${method === 'D1' ? ' selected' : ''}>D1 — в земле</option>
    </select>`));
  h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-conn-prop="ambientC" value="${c.ambientC || GLOBAL.defaultAmbient}">`));
  h.push(field('Цепей в группе', `<input type="number" min="1" max="20" step="1" data-conn-prop="grouping" value="${c.grouping || GLOBAL.defaultGrouping}">`));
  h.push('</div>');

  // Результат подбора кабеля
  if (c._state === 'active' && c._cableSize) {
    const warn = c._cableOverflow ? '<span style="color:#c62828;font-weight:600"> (превышен предел таблицы)</span>' : '';
    const groupNote = (c._cableParallel && c._cableParallel > 1)
      ? `<br><span class="muted">Групповая линия: ${c._cableParallel} параллельных кабелей</span>`
      : '';
    h.push('<div class="inspector-section"><h4>Подобранный кабель</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Сечение: <b>${c._cableSize} мм²</b>${warn}<br>` +
      `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b><br>` +
      `Метод расчёта: <b>${c._cableMethod || 'B1'}</b>, t=${c._cableAmbient}°C, групп=${c._cableGrouping}<br>` +
      `Iдоп на жилу: <b>${fmt(c._cableIz)} A</b><br>` +
      (c._cableParallel > 1 ? `Iдоп всей группы: <b>${fmt(c._cableTotalIz)} A</b><br>` : '') +
      groupNote +
      `</div></div>`);
  }

  // Автомат защиты
  if (c._breakerIn) {
    const cnt = c._breakerCount || 1;
    const badge = c._breakerAgainstCable
      ? '<span class="badge off">селект. нарушена</span>'
      : '<span class="badge on">ок</span>';
    h.push('<div class="inspector-section"><h4>Защитный аппарат</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Номинал: <b>C${c._breakerIn} А</b> ${badge}<br>` +
      (cnt > 1 ? `В шкафу: <b>${cnt} × C${c._breakerIn} А</b> <span class="muted">(по одному на каждую параллельную линию группы)</span><br>` : '') +
      (c._breakerAgainstCable ? `<span style="color:#c62828;font-size:11px">Ток автомата превышает допустимую нагрузку кабеля (${fmt(c._cableIz)} А). Увеличьте сечение или уменьшите номинал.</span>` : '') +
      `</div></div>`);
  }

  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Рукоятки на концах — переключить связь на другой порт. «+» в середине сегмента — добавить точку сплайна. Shift+клик по точке — удалить. Shift+клик по линии — удалить связь.</div>');
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка на поля связи
  inspectorBody.querySelectorAll('[data-conn-prop]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('conn:' + c.id + ':' + inp.dataset.connProp);
      const prop = inp.dataset.connProp;
      const v = inp.type === 'number' ? Number(inp.value) : inp.value;
      c[prop] = v;
      render();
      notifyChange();
    });
  });
  // Чекбоксы каналов
  inspectorBody.querySelectorAll('[data-conn-channel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('conn-channel:' + c.id);
      if (!Array.isArray(c.channelIds)) c.channelIds = [];
      const chId = inp.dataset.connChannel;
      if (inp.checked) {
        if (!c.channelIds.includes(chId)) c.channelIds.push(chId);
      } else {
        c.channelIds = c.channelIds.filter(x => x !== chId);
      }
      render();
      renderInspector();
      notifyChange();
    });
  });
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
  // Клик на кнопку «+» в середине сегмента → добавляем waypoint в этой точке
  const addEl = e.target.closest('.conn-waypoint-add');
  if (addEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = addEl.dataset.waypointAddId;
    const idx = Number(addEl.dataset.waypointAddIdx);
    const c = state.conns.get(cid);
    if (!c) return;
    snapshot();
    if (!Array.isArray(c.waypoints)) c.waypoints = [];
    const p = clientToSvg(e.clientX, e.clientY);
    c.waypoints.splice(idx, 0, { x: p.x, y: p.y });
    state.drag = { waypointConnId: cid, waypointIdx: idx };
    render();
    notifyChange();
    return;
  }
  // Клик на существующий waypoint → перетаскиваем его.
  // Shift+клик удаляет waypoint.
  const wpEl = e.target.closest('.conn-waypoint');
  if (wpEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = wpEl.dataset.waypointId;
    const idx = Number(wpEl.dataset.waypointIdx);
    const c = state.conns.get(cid);
    if (!c || !Array.isArray(c.waypoints)) return;
    if (e.shiftKey) {
      snapshot();
      c.waypoints.splice(idx, 1);
      render();
      notifyChange();
      return;
    }
    snapshot();
    state.drag = { waypointConnId: cid, waypointIdx: idx };
    return;
  }

  // Рукоятка reconnect: на выделенной связи есть два хэндла (to и from).
  // Перетаскивание одного из них позволяет переключить связь на другой порт
  // без удаления оригинальной.
  const handleEl = e.target.closest('.conn-handle');
  if (handleEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = handleEl.dataset.reconnectId;
    const end = handleEl.dataset.reconnectEnd || 'to';
    const c = state.conns.get(cid);
    if (!c) return;
    // «Якорь» — конец, который НЕ двигается; с него начинается pending
    if (end === 'to') {
      state.pending = {
        startNodeId: c.from.nodeId, startKind: 'out', startPort: c.from.port,
        reconnectConnId: cid, mouseX: 0, mouseY: 0,
      };
    } else {
      state.pending = {
        startNodeId: c.to.nodeId, startKind: 'in', startPort: c.to.port,
        reconnectConnId: cid, mouseX: 0, mouseY: 0,
      };
    }
    const p = clientToSvg(e.clientX, e.clientY);
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    svg.classList.add('connecting');
    render();
    drawPending();
    return;
  }

  // Порт — начало/конец связи. Можно начинать С ЛЮБОГО порта.
  // При клике на второй порт ориентация определяется автоматически.
  const portEl = e.target.closest('.port');
  if (portEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const nodeId = portEl.dataset.nodeId;
    const kind = portEl.dataset.portKind;
    const idx  = Number(portEl.dataset.portIdx);

    if (!state.pending) {
      // Начинаем новую связь с любого порта — но сразу запоминаем что это drag
      state.pending = { startNodeId: nodeId, startKind: kind, startPort: idx, mouseX: 0, mouseY: 0 };
      const p = clientToSvg(e.clientX, e.clientY);
      state.pending.mouseX = p.x; state.pending.mouseY = p.y;
      svg.classList.add('connecting');
      drawPending();
    } else {
      finishPendingAtPort(portEl);
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
      snapshot();
      const n = state.nodes.get(id);
      const p = clientToSvg(e.clientX, e.clientY);
      // Для зоны — захватываем все вложенные узлы, чтобы тащить вместе.
      // Также запоминаем исходные смещения детей относительно зоны.
      if (n.type === 'zone') {
        const children = nodesInZone(n).map(ch => ({
          id: ch.id, dx: ch.x - n.x, dy: ch.y - n.y,
        }));
        state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y, children };
      } else {
        state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y };
      }
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
  if (state.drag && state.drag.waypointConnId) {
    const c = state.conns.get(state.drag.waypointConnId);
    if (c && Array.isArray(c.waypoints)) {
      const p = clientToSvg(e.clientX, e.clientY);
      let nx = p.x, ny = p.y;
      if (!e.altKey) {
        nx = Math.round(nx / 40) * 40;
        ny = Math.round(ny / 40) * 40;
      }
      c.waypoints[state.drag.waypointIdx] = { x: nx, y: ny };
      render();
    }
    return;
  }
  if (state.drag && state.drag.nodeId) {
    const p = clientToSvg(e.clientX, e.clientY);
    const n = state.nodes.get(state.drag.nodeId);
    let nx = p.x - state.drag.dx;
    let ny = p.y - state.drag.dy;
    // Snap to grid 40 — держим Alt чтобы отключить привязку
    if (!e.altKey) {
      nx = Math.round(nx / 40) * 40;
      ny = Math.round(ny / 40) * 40;
    }
    n.x = nx;
    n.y = ny;
    // Тащим детей вместе с зоной
    if (state.drag.children) {
      for (const ch of state.drag.children) {
        const cn = state.nodes.get(ch.id);
        if (cn) {
          cn.x = nx + ch.dx;
          cn.y = ny + ch.dy;
        }
      }
    }
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
    // Помечаем, что произошло реальное перемещение (более 3 пикселей)
    if (!state.pending.moved) {
      const dx = Math.abs((state.pending.mouseX || 0) - p.x);
      const dy = Math.abs((state.pending.mouseY || 0) - p.y);
      if (dx > 3 || dy > 3) state.pending.moved = true;
    }
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    drawPending();
  }
});

window.addEventListener('mouseup', (e) => {
  if (state.drag) {
    const wasNodeDrag = !!state.drag.nodeId;
    const wasWpDrag = !!state.drag.waypointConnId;
    svg.classList.remove('panning');
    state.drag = null;
    if (wasNodeDrag || wasWpDrag) notifyChange();
  }
  // Завершение pending:
  //  - если ведение связи уже началось и пользователь двигал мышь (moved=true)
  //    и отпустил над портом → завершаем как drag&drop
  //  - если курсор не двигался (это был click-start) — оставляем pending
  //    в режиме «клик-клик», пользователь кликнет вторым щелчком по цели
  //  - если двигался, но отпустил не над портом → отменяем
  if (state.pending) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const portEl = target && target.closest && target.closest('.port');
    const moved = !!state.pending.moved;
    if (portEl && portEl !== state.pending._startPortEl) {
      finishPendingAtPort(portEl);
    } else if (moved) {
      cancelPending();
    }
    // иначе: не двигался — pending живёт, ждём второго клика
  }
});

// Отмена ведения связи
svg.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (state.pending) cancelPending();
});
let _clipboardNode = null;

function copySelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  flash('Скопировано: ' + (n.tag || n.name));
}

function pasteNode(offsetX = 40, offsetY = 40) {
  if (!_clipboardNode) return;
  snapshot();
  const id = uid();
  const copy = JSON.parse(JSON.stringify(_clipboardNode));
  copy.id = id;
  copy.x = (copy.x || 0) + offsetX;
  copy.y = (copy.y || 0) + offsetY;
  copy.tag = nextFreeTag(copy.type); // уникальное обозначение
  // Обнуляем runtime-поля
  delete copy._loadKw; delete copy._loadA; delete copy._powered;
  delete copy._overload; delete copy._cosPhi; delete copy._onBattery;
  delete copy._inputKw; delete copy._nominalA; delete copy._ratedA; delete copy._inrushA;
  delete copy._calcKw;
  state.nodes.set(id, copy);
  selectNode(id);
  render();
  notifyChange();
  flash('Вставлено: ' + copy.tag);
}

function duplicateSelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  pasteNode(40, 40);
}

window.addEventListener('keydown', e => {
  // Undo / Redo работают даже когда фокус в input, это стандартное поведение
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    if (state.readOnly) return;
    e.preventDefault();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
    if (state.readOnly) return;
    e.preventDefault();
    redo();
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  // Copy / Paste / Duplicate
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    if (state.readOnly) return;
    e.preventDefault();
    copySelectedNode();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
    if (state.readOnly) return;
    e.preventDefault();
    pasteNode();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    if (state.readOnly) return;
    e.preventDefault();
    duplicateSelectedNode();
    return;
  }
  if (e.key === 'Escape' && state.pending) cancelPending();
  if (state.readOnly) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedKind === 'node' && state.selectedId) { deleteNode(state.selectedId); e.preventDefault(); }
    else if (state.selectedKind === 'conn' && state.selectedId) { deleteConn(state.selectedId); e.preventDefault(); }
  }
});

function cancelPending() {
  if (!state.pending) return;
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  render();
}

// Завершение pending при отпускании/клике над портом.
// portEl — DOM-элемент .port, над которым закончилось действие.
function finishPendingAtPort(portEl) {
  if (!state.pending) return;
  if (state.readOnly) { cancelPending(); return; }

  const s = state.pending;
  const nodeId = portEl.dataset.nodeId;
  const kind = portEl.dataset.portKind;
  const idx  = Number(portEl.dataset.portIdx);

  // Концы должны быть разных типов: один out, другой in
  if (s.startKind === kind) {
    flash('Соединение возможно только между выходом и входом', 'error');
    cancelPending();
    return;
  }
  const outEnd = s.startKind === 'out'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };
  const inEnd  = s.startKind === 'in'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };

  if (outEnd.nodeId === inEnd.nodeId) {
    flash('Нельзя замыкать узел на себя', 'error');
    cancelPending();
    return;
  }

  // === Жёсткие проверки ===
  // 1) Вход может иметь не более одной входящей связи
  // 2) Выход может иметь не более одной исходящей связи
  const existingId = s.reconnectConnId || null;
  const duplicateIn = [...state.conns.values()].some(c =>
    c.id !== existingId && c.to.nodeId === inEnd.nodeId && c.to.port === inEnd.port);
  if (duplicateIn) {
    flash('На этом входе уже есть линия. Сначала отключите её.', 'error');
    cancelPending();
    return;
  }
  const duplicateOut = [...state.conns.values()].some(c =>
    c.id !== existingId && c.from.nodeId === outEnd.nodeId && c.from.port === outEnd.port);
  if (duplicateOut) {
    flash('С этого выхода уже идёт линия. От одного выхода можно только одну.', 'error');
    cancelPending();
    return;
  }
  if (wouldCreateCycle(outEnd.nodeId, inEnd.nodeId)) {
    flash('Такое соединение создаст цикл', 'error');
    cancelPending();
    return;
  }

  // Reconnect существующей линии (rewire)
  if (existingId) {
    const existing = state.conns.get(existingId);
    if (existing) {
      snapshot();
      existing.from = outEnd;
      existing.to = inEnd;
      state.pending = null;
      clearPending();
      svg.classList.remove('connecting');
      render();
      notifyChange();
      return;
    }
  }

  // Новая связь
  const cid = tryConnect(outEnd, inEnd);
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  if (cid) { selectConn(cid); render(); }
  else flash('Не удалось создать связь', 'error');
}

function drawPending() {
  clearPending();
  if (!state.pending) return;
  const p = state.pending;
  const node = state.nodes.get(p.startNodeId);
  if (!node) return;
  const a = portPos(node, p.startKind, p.startPort);
  const path = el('path', {
    class: 'pending-line',
    d: bezier(a, { x: p.mouseX, y: p.mouseY }),
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
  snapshot();
  state.nodes.clear(); state.conns.clear(); state.modes = []; state.activeModeId = null;
  state.selectedKind = null; state.selectedId = null;
  render(); renderInspector();
  notifyChange();
};
// Undo / Redo кнопки в тулбаре (добавлены в index.html)
const _btnUndo = document.getElementById('btn-undo');
const _btnRedo = document.getElementById('btn-redo');
if (_btnUndo) _btnUndo.onclick = undo;
if (_btnRedo) _btnRedo.onclick = redo;
updateUndoButtons();
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
    version: 3,
    nextId: _idSeq,
    nodes: Array.from(state.nodes.values()).map(stripRuntime),
    conns: Array.from(state.conns.values()).map(stripRuntime),
    modes: state.modes,
    activeModeId: state.activeModeId,
    view: { ...state.view },
  };
}
// Удаляет все runtime-поля (с префиксом _) — они вычисляются при загрузке.
function stripRuntime(obj) {
  const copy = {};
  for (const k in obj) {
    if (k.startsWith('_')) continue;
    copy[k] = obj[k];
  }
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
    if (n.type === 'consumer') {
      if (typeof n.count !== 'number') n.count = 1;
      if (!n.phase) n.phase = '3ph';
      if (typeof n.cosPhi !== 'number') n.cosPhi = GLOBAL.defaultCosPhi;
      if (typeof n.kUse !== 'number') n.kUse = 1.0;
      if (typeof n.inrushFactor !== 'number') n.inrushFactor = 1;
      if (typeof n.voltage !== 'number') n.voltage = (n.phase === '3ph') ? 400 : 230;
    }
    if (n.type === 'panel') {
      if (!n.switchMode) n.switchMode = 'auto';
      if (typeof n.manualActiveInput !== 'number') n.manualActiveInput = 0;
      if (!Array.isArray(n.parallelEnabled)) n.parallelEnabled = new Array(n.inputs || 0).fill(false);
      if (typeof n.kSim !== 'number') n.kSim = 1.0;
    }
    if (n.type === 'source' || n.type === 'generator' || n.type === 'ups') {
      if (!n.phase) n.phase = '3ph';
      if (typeof n.voltage !== 'number') n.voltage = 400;
      if (typeof n.cosPhi !== 'number') n.cosPhi = (n.type === 'generator') ? 0.85 : 0.92;
    }
    if (n.type === 'ups') {
      if (typeof n.chargeA !== 'number') {
        if (typeof n.chargeKw === 'number' && n.chargeKw > 0) {
          const U = n.voltage || 400;
          const k = n.phase === '3ph' ? Math.sqrt(3) : 1;
          n.chargeA = (n.chargeKw * 1000) / (U * k);
        } else {
          n.chargeA = 2;
        }
      }
      if (typeof n.staticBypass !== 'boolean') n.staticBypass = true;
      if (typeof n.staticBypassAuto !== 'boolean') n.staticBypassAuto = true;
      if (typeof n.staticBypassOverloadPct !== 'number') n.staticBypassOverloadPct = 110;
      if (typeof n.staticBypassForced !== 'boolean') n.staticBypassForced = false;
    }
    if (n.type === 'generator') {
      if (typeof n.startDelaySec !== 'number') n.startDelaySec = 5;
      if (!('triggerNodeId' in n)) n.triggerNodeId = null;
    }
    if (n.type === 'channel') {
      if (!n.material) n.material = 'Cu';
      if (!n.insulation) n.insulation = 'PVC';
      if (!n.method) n.method = 'B1';
      if (typeof n.ambientC !== 'number') n.ambientC = 30;
      if (typeof n.lengthM !== 'number') n.lengthM = 10;
      if (typeof n.inputs !== 'number') n.inputs = 1;
      if (typeof n.outputs !== 'number') n.outputs = 1;
    }
    if (n.type === 'zone') {
      if (!n.zonePrefix) n.zonePrefix = n.tag || 'Z1';
      if (typeof n.width !== 'number') n.width = 600;
      if (typeof n.height !== 'number') n.height = 400;
      if (!n.color) n.color = '#e3f2fd';
    }
  }

  updateViewBox();
}

// === Зоны ===
// Ищем зону, в которую геометрически попадает центр узла.
// Если зон несколько вложенных — берём самую «узкую» (меньшей площади).
function findZoneFor(n) {
  if (!n || n.type === 'zone') return null;
  const cx = n.x + nodeWidth(n) / 2;
  const cy = n.y + nodeHeight(n) / 2;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    const zw = nodeWidth(z), zh = nodeHeight(z);
    if (cx >= z.x && cx <= z.x + zw && cy >= z.y && cy <= z.y + zh) {
      const area = zw * zh;
      if (area < bestArea) { best = z; bestArea = area; }
    }
  }
  return best;
}

// Эффективное обозначение с учётом префикса зоны: «P1.MPB1»
function effectiveTag(n) {
  if (!n) return '';
  if (n.type === 'zone') return n.zonePrefix || n.tag || '';
  const z = findZoneFor(n);
  if (z && (z.zonePrefix || z.tag)) {
    const prefix = z.zonePrefix || z.tag;
    return `${prefix}.${n.tag || ''}`;
  }
  return n.tag || '';
}

// Узлы, принадлежащие зоне (для drag-all)
function nodesInZone(zone) {
  const result = [];
  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    if (findZoneFor(n) === zone) result.push(n);
  }
  return result;
}

// Проверка: сколько портов данного вида реально занято связями
function maxOccupiedPort(nodeId, kind) {
  let max = -1;
  for (const c of state.conns.values()) {
    if (kind === 'in' && c.to.nodeId === nodeId) max = Math.max(max, c.to.port);
    if (kind === 'out' && c.from.nodeId === nodeId) max = Math.max(max, c.from.port);
  }
  return max;
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

// ================= Симуляция времени =================
// Тик раз в секунду. Ускорение разряда: реальная автономия / 20 = симуляционная.
// Например, 20 мин реальной автономии ≈ 1 мин симуляции.
const TIME_ACCEL = 20;
let _simTickHandle = null;
let _lastTickAt = 0;

function simTick() {
  const now = Date.now();
  const dtSec = _lastTickAt ? (now - _lastTickAt) / 1000 : 1;
  _lastTickAt = now;
  if (dtSec <= 0 || dtSec > 10) { _lastTickAt = now; return; }

  let changed = false;

  // 1. Генераторы с триггером — учёт задержки старта
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator') continue;
    if (!n.triggerNodeId) { n._startedAt = 0; n._running = false; continue; }
    const trigger = state.nodes.get(n.triggerNodeId);
    if (!trigger) { n._startedAt = 0; n._running = false; continue; }
    const triggerPowered = !!trigger._powered;
    if (triggerPowered) {
      // Возврат в дежурство — сбрасываем таймер
      if (n._startedAt || n._running) {
        n._startedAt = 0;
        n._running = false;
        n._startCountdown = 0;
        changed = true;
      }
    } else {
      // Триггер обесточен. Если таймер не запущен — запускаем отсчёт.
      if (!n._startedAt) {
        n._startedAt = now;
        n._running = false;
        changed = true;
      }
      const delay = Math.max(0, Number(n.startDelaySec) || 0);
      const elapsed = (now - n._startedAt) / 1000;
      if (elapsed >= delay) {
        if (!n._running) { n._running = true; changed = true; }
        n._startCountdown = 0;
      } else {
        n._startCountdown = Math.max(0, delay - elapsed);
      }
    }
  }

  // 2. ИБП — разряд батареи пока работает от неё
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!n._onBattery) {
      // Считаем остаток как запас / нагрузка (для отображения)
      const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
      const loadKw = n._loadKw || 0;
      if (loadKw > 0) n._autonomyMin = (battKwh / loadKw) * 60;
      else n._autonomyMin = 0;
      n._runtimeLeftSec = 0;
      continue;
    }
    const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
    const loadKw = n._loadKw || 0;
    if (loadKw <= 0 || battKwh <= 0) {
      n._runtimeLeftSec = 0;
      continue;
    }
    // Реальное время работы в минутах
    const realMinutes = (battKwh / loadKw) * 60;
    // Сокращённое (симуляционное) время
    const simMinutes = realMinutes / TIME_ACCEL;
    n._runtimeLeftSec = simMinutes * 60;

    // Уменьшаем заряд: за 1 секунду симуляции «прошло» TIME_ACCEL секунд реально
    // т.е. разряд = loadKw × (dtSec × TIME_ACCEL / 3600) kWh
    const consumedKwh = loadKw * (dtSec * TIME_ACCEL / 3600);
    let newBatt = battKwh - consumedKwh;
    if (newBatt < 0) newBatt = 0;
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newBatt / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.01) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  // 3. ИБП — медленный заряд, когда работает от сети (упрощённо: до 100% за
  // batteryKwh / chargeKw часов, ускорено в TIME_ACCEL раз)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (n._onBattery || !n._powered) continue;
    const ch = upsChargeKw(n);
    if (ch <= 0) continue;
    if ((n.batteryChargePct || 0) >= 100) continue;
    const addedKwh = ch * (dtSec * TIME_ACCEL / 3600);
    const curKwh = (Number(n.batteryKwh) || 0) * (n.batteryChargePct || 0) / 100;
    const newKwh = Math.min(Number(n.batteryKwh) || 0, curKwh + addedKwh);
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newKwh / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.1) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  if (changed) {
    render();
    // Не перерисовываем инспектор целиком — это ломает фокус в инпутах;
    // только обновляем блок статуса ИБП и таймеры, если выбран ИБП или генератор
    if (state.selectedKind === 'node') {
      const sel = state.nodes.get(state.selectedId);
      if (sel && (sel.type === 'ups' || sel.type === 'generator')) {
        // Мягкая перерисовка: перезаполняем только статус
        renderInspector();
      }
    }
  }
}

function startSimLoop() {
  if (_simTickHandle) return;
  _lastTickAt = Date.now();
  _simTickHandle = setInterval(simTick, 1000);
}
function stopSimLoop() {
  if (_simTickHandle) clearInterval(_simTickHandle);
  _simTickHandle = null;
}

// ================= Инициализация (холодный старт) =================
window.addEventListener('resize', updateViewBox);
updateViewBox();
render();
renderInspector();
startSimLoop();

// ================= Библиотека пресетов =================
function applyPreset(preset) {
  if (!preset || !preset.type || !DEFAULTS[preset.type]) return null;
  snapshot();
  // Создаём узел в центре текущего видимого окна
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
  const cx = state.view.x + (W / 2) / state.view.zoom;
  const cy = state.view.y + (H / 2) / state.view.zoom;
  const id = uid();
  const base = { id, type: preset.type, ...DEFAULTS[preset.type](), ...preset.params };
  base.tag = nextFreeTag(preset.type);
  // Нормализуем массив приоритетов под число входов
  if (typeof base.inputs === 'number') {
    if (!Array.isArray(base.priorities)) base.priorities = [];
    while (base.priorities.length < base.inputs) base.priorities.push(base.priorities.length + 1);
    base.priorities.length = base.inputs;
  }
  base.x = cx - nodeWidth(base) / 2;
  base.y = cy - NODE_H / 2;
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}

// ================= 3-фазная балансировка =================
// Для каждого щита считаем суммарную нагрузку по фазам A/B/C (3ф распределяется поровну)
// и возвращаем максимальный дисбаланс в процентах.
function get3PhaseBalance() {
  // Сначала построим map «щит → {a, b, c}»
  const byPanel = new Map();
  // Функция «куда прикреплён потребитель» — пройдём вверх по активным связям до первого щита
  function findPanelForConsumer(consumerId) {
    const stack = [consumerId];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = state.nodes.get(cur);
      if (!n) continue;
      if (n.type === 'panel' && cur !== consumerId) return cur;
      // идём вверх по любым связям (не только active — нас интересует структура)
      for (const c of state.conns.values()) {
        if (c.to.nodeId === cur) stack.push(c.from.nodeId);
      }
    }
    return null;
  }
  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const total = per * count;
    const panelId = findPanelForConsumer(n.id);
    if (!panelId) continue;
    if (!byPanel.has(panelId)) byPanel.set(panelId, { a: 0, b: 0, c: 0 });
    const g = byPanel.get(panelId);
    const ph = n.phase || '3ph';
    if (ph === '3ph') { g.a += total / 3; g.b += total / 3; g.c += total / 3; }
    else if (ph === 'A') g.a += total;
    else if (ph === 'B') g.b += total;
    else if (ph === 'C') g.c += total;
  }
  const out = [];
  for (const [panelId, g] of byPanel) {
    const panel = state.nodes.get(panelId);
    const sum = g.a + g.b + g.c;
    if (sum <= 0) continue;
    const avg = sum / 3;
    const max = Math.max(g.a, g.b, g.c);
    const imbalance = ((max - avg) / avg) * 100;
    out.push({
      panelId,
      tag: panel?.tag || '',
      name: panel?.name || '',
      a: g.a, b: g.b, c: g.c,
      imbalance,
      warning: imbalance > 15,
    });
  }
  return out;
}

// ================= Генерация отчёта =================
function generateReport() {
  recalc();
  const lines = [];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  lines.push('ОТЧЁТ ПО СХЕМЕ ЭЛЕКТРОСНАБЖЕНИЯ');
  lines.push('Дата: ' + stamp);
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    lines.push('Сценарий: ' + (m?.name || '-'));
  } else {
    lines.push('Сценарий: Нормальный режим');
  }
  lines.push('='.repeat(60));
  lines.push('');

  // 1. Источники
  const sources = [...state.nodes.values()].filter(n => n.type === 'source' || n.type === 'generator');
  if (sources.length) {
    lines.push('ИСТОЧНИКИ ПИТАНИЯ');
    lines.push('-'.repeat(78));
    lines.push('Обозн.  Имя                  Тип         Pном, kW  Pнаг, kW   Iр, A   cos φ');
    for (const s of sources) {
      const on = effectiveOn(s);
      const cap = Number(s.capacityKw) || 0;
      const load = s._loadKw || 0;
      const type = s.type === 'source' ? 'Источник' : (s.backupMode ? 'Генер.рез.' : 'Генератор');
      const status = !on ? ' ОТКЛ' : (s._overload ? ' ПЕРЕГР' : '');
      lines.push(
        (s.tag || '').padEnd(8) +
        (s.name || '').padEnd(21) +
        type.padEnd(12) +
        String(fmt(cap)).padStart(8) + '  ' +
        String(fmt(load)).padStart(8) + '  ' +
        String(fmt(s._loadA || 0)).padStart(6) + '   ' +
        ((s._cosPhi || 0).toFixed(2)) + status
      );
    }
    lines.push('');
  }

  // 2. ИБП
  const upses = [...state.nodes.values()].filter(n => n.type === 'ups');
  if (upses.length) {
    lines.push('ИСТОЧНИКИ БЕСПЕРЕБОЙНОГО ПИТАНИЯ (ИБП)');
    lines.push('-'.repeat(60));
    for (const u of upses) {
      const cap = Number(u.capacityKw) || 0;
      const load = u._loadKw || 0;
      const eff = Number(u.efficiency) || 100;
      const batt = (Number(u.batteryKwh) || 0) * (Number(u.batteryChargePct) || 0) / 100;
      const aut = load > 0 ? batt / load * 60 : 0;
      lines.push(`${(u.tag || '').padEnd(8)}${u.name}`);
      lines.push(`   Выход:      ${fmt(load)} / ${fmt(cap)} kW  (КПД ${eff}%)`);
      lines.push(`   Батарея:    ${fmt(batt)} kWh · ${u.batteryChargePct || 0}%`);
      if (load > 0) {
        lines.push(`   Автономия:  ${aut >= 60 ? (aut / 60).toFixed(1) + ' ч' : Math.round(aut) + ' мин'}`);
      }
      if (u._onBattery) lines.push('   Статус:     РАБОТА ОТ БАТАРЕИ');
      else if (u._powered) lines.push('   Статус:     норма (от сети)');
      else lines.push('   Статус:     БЕЗ ПИТАНИЯ');
      lines.push('');
    }
  }

  // 3. Щиты
  const panels = [...state.nodes.values()].filter(n => n.type === 'panel');
  if (panels.length) {
    lines.push('РАСПРЕДЕЛИТЕЛЬНЫЕ ЩИТЫ');
    lines.push('-'.repeat(78));
    lines.push('Обозн.  Имя                  Вх/Вых  Pрасч, kW  Iрасч, A  Ксим  cos φ  Режим');
    for (const p of panels) {
      const mode = p.switchMode === 'manual' ? 'РУЧН'
                 : p.switchMode === 'parallel' ? 'ПАРАЛ'
                 : 'АВР';
      lines.push(
        (p.tag || '').padEnd(8) +
        (p.name || '').padEnd(21) +
        `${p.inputs}/${p.outputs}`.padEnd(8) +
        String(fmt(p._calcKw || p._loadKw || 0)).padStart(9) + '  ' +
        String(fmt(p._loadA || 0)).padStart(8) + '  ' +
        String((p.kSim || 1).toFixed(2)).padStart(4) + '  ' +
        (p._cosPhi ? p._cosPhi.toFixed(2) : '----').padEnd(6) + ' ' +
        mode
      );
    }
    lines.push('');
  }

  // 4. Потребители
  const consumers = [...state.nodes.values()].filter(n => n.type === 'consumer');
  if (consumers.length) {
    lines.push('ПОТРЕБИТЕЛИ');
    lines.push('-'.repeat(92));
    lines.push('Обозн.  Имя                  Фаза  kW ед  Кол  Pрасч  cos φ  Iуст  Iрасч  Iпуск  Статус');
    let total = 0;
    for (const c of consumers) {
      const per = Number(c.demandKw) || 0;
      const cnt = Math.max(1, Number(c.count) || 1);
      const factor = effectiveLoadFactor(c);
      const k = (Number(c.kUse) || 1) * factor;
      const sum = per * cnt * k;
      if (c._powered) total += sum;
      lines.push(
        (c.tag || '').padEnd(8) +
        (c.name || '').padEnd(21) +
        (c.phase || '3ph').padEnd(5) + ' ' +
        String(fmt(per)).padStart(6) + ' ' +
        String(cnt).padStart(4) + ' ' +
        String(fmt(sum)).padStart(6) + ' ' +
        ((Number(c.cosPhi) || 0.92).toFixed(2)).padStart(6) + ' ' +
        String(fmt(c._nominalA || 0)).padStart(5) + ' ' +
        String(fmt(c._ratedA || 0)).padStart(6) + ' ' +
        String(fmt(c._inrushA || 0)).padStart(6) + '  ' +
        (c._powered ? 'ок' : 'БЕЗ ПИТ')
      );
    }
    lines.push('-'.repeat(92));
    lines.push('ИТОГО расчётная активная мощность: ' + fmt(total) + ' kW');
    lines.push('');
  }

  // 4a. Кабельные линии
  const activeCables = [...state.conns.values()].filter(c => c._state === 'active' && c._cableSize);
  if (activeCables.length) {
    lines.push('КАБЕЛЬНЫЕ ЛИНИИ (подбор по IEC 60364-5-52)');
    lines.push('-'.repeat(84));
    lines.push('Откуда       →  Куда                P, kW    I, A   Сечение   Метод   Iдоп');
    for (const c of activeCables) {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromLbl = (fromN?.tag || '') + ' ' + (fromN?.name || '');
      const toLbl = (toN?.tag || '') + ' ' + (toN?.name || '');
      const warn = c._cableOverflow ? ' ⚠' : '';
      lines.push(
        fromLbl.slice(0, 12).padEnd(14) +
        toLbl.slice(0, 18).padEnd(20) +
        String(fmt(c._loadKw)).padStart(6) + '  ' +
        String(fmt(c._loadA || 0)).padStart(6) + '  ' +
        (c._cableSize + ' мм²').padStart(8) + '   ' +
        (c._cableMethod || '-').padEnd(6) + '  ' +
        String(fmt(c._cableIz)).padStart(4) + warn
      );
    }
    lines.push('');
  }

  // 5. 3-фазная балансировка
  const balance = get3PhaseBalance();
  if (balance.length) {
    lines.push('ТРЁХФАЗНЫЙ БАЛАНС ПО ЩИТАМ');
    lines.push('-'.repeat(60));
    lines.push('Щит                    A, kW    B, kW    C, kW    Дисбаланс');
    for (const b of balance) {
      const warn = b.warning ? '  ⚠ превышен' : '';
      lines.push(
        ((b.tag || '') + ' ' + (b.name || '')).padEnd(22) +
        String(fmt(b.a)).padStart(8) + ' ' +
        String(fmt(b.b)).padStart(8) + ' ' +
        String(fmt(b.c)).padStart(8) + '    ' +
        b.imbalance.toFixed(1) + '%' + warn
      );
    }
    lines.push('Норма: дисбаланс не более 15%.');
    lines.push('');
  }

  // 6. Проверки
  const issues = [];
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
      if (!hasIn) issues.push(`  ⚠ Потребитель ${n.tag || n.name} не подключён`);
      if (!n._powered) issues.push(`  ⚠ Потребитель ${n.tag || n.name} без питания`);
    }
    if (n.type === 'panel') {
      const hasOut = [...state.conns.values()].some(c => c.from.nodeId === n.id);
      if (!hasOut) issues.push(`  ⚠ Щит ${n.tag || n.name} не имеет отходящих линий`);
    }
    if (n.type === 'ups' && (Number(n.batteryKwh) || 0) <= 0) {
      issues.push(`  ⚠ ИБП ${n.tag || n.name}: нулевая ёмкость батареи`);
    }
    if (n.type === 'generator' && !n.backupMode) {
      issues.push(`  ℹ Генератор ${n.tag || n.name} работает как основной источник (не резерв)`);
    }
    if (n._overload) {
      issues.push(`  ⚠ ${n.tag || n.name}: перегруз (${fmt(n._loadKw)}/${fmt(n.capacityKw)} kW)`);
    }
  }
  if (issues.length) {
    lines.push('ПРОВЕРКИ И ПРЕДУПРЕЖДЕНИЯ');
    lines.push('-'.repeat(60));
    for (const iss of issues) lines.push(iss);
    lines.push('');
  } else {
    lines.push('ПРОВЕРКИ: замечаний нет.');
    lines.push('');
  }

  return lines.join('\n');
}

// ================= Импорт таблицы нагрузок =================
// Поддерживает CSV с разделителями: табуляция, точка с запятой, запятая.
// Колонки (первая строка — заголовок): name, kW, count, phase, panel.
// Возвращает число добавленных потребителей.
function importLoadsTable(text) {
  if (!text || typeof text !== 'string') return 0;
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length < 1) return 0;

  // Автоопределение разделителя
  const first = rawLines[0];
  let sep = ',';
  if (first.includes('\t')) sep = '\t';
  else if (first.includes(';')) sep = ';';
  else if (!first.includes(',')) sep = '\t';

  const header = rawLines[0].split(sep).map(s => s.trim().toLowerCase());
  const idxName = header.indexOf('name');
  const idxKw = header.findIndex(h => h === 'kw' || h === 'квт' || h === 'power');
  const idxCount = header.indexOf('count');
  const idxPhase = header.indexOf('phase');
  const idxPanel = header.indexOf('panel');
  if (idxName < 0 || idxKw < 0) {
    throw new Error('В заголовке нужны как минимум колонки name и kW');
  }

  snapshot();
  _suppressSnapshot = true;
  let added = 0;
  try {
    // Найдём подходящие щиты по имени/тегу
    const panelByKey = new Map();
    for (const n of state.nodes.values()) {
      if (n.type !== 'panel') continue;
      if (n.tag) panelByKey.set(n.tag.toLowerCase(), n);
      if (n.name) panelByKey.set(n.name.toLowerCase(), n);
    }

    // Расположим новые потребители ниже существующих
    let maxY = 0, minX = Infinity;
    for (const n of state.nodes.values()) {
      maxY = Math.max(maxY, n.y + NODE_H);
      minX = Math.min(minX, n.x);
    }
    if (!isFinite(minX)) minX = 100;
    const startY = maxY + 60;
    const step = 190;

    for (let i = 1; i < rawLines.length; i++) {
      const parts = rawLines[i].split(sep).map(s => s.trim());
      if (!parts[idxName]) continue;
      const name = parts[idxName];
      const kw = Number(String(parts[idxKw]).replace(',', '.')) || 0;
      const cnt = idxCount >= 0 ? Math.max(1, Number(parts[idxCount]) || 1) : 1;
      const phase = idxPhase >= 0 ? (parts[idxPhase] || '3ph') : '3ph';
      const panelKey = idxPanel >= 0 ? String(parts[idxPanel] || '').toLowerCase() : '';

      const id = uid();
      const base = { id, type: 'consumer', ...DEFAULTS.consumer() };
      base.name = name;
      base.demandKw = kw;
      base.count = cnt;
      base.phase = (phase === '3ph' || phase === 'A' || phase === 'B' || phase === 'C') ? phase : '3ph';
      base.inputs = 1;
      base.priorities = [1];
      base.tag = nextFreeTag('consumer');
      base.x = minX + (added % 5) * step;
      base.y = startY + Math.floor(added / 5) * (NODE_H + 40);
      state.nodes.set(id, base);

      // Автоподключение к щиту, если указано
      if (panelKey && panelByKey.has(panelKey)) {
        const panel = panelByKey.get(panelKey);
        // Ищем свободный выходной порт
        const usedPorts = new Set();
        for (const c of state.conns.values()) {
          if (c.from.nodeId === panel.id) usedPorts.add(c.from.port);
        }
        let freePort = 0;
        const outCount = nodeOutputCount(panel);
        for (let p = 0; p < outCount; p++) {
          if (!usedPorts.has(p)) { freePort = p; break; }
        }
        if (usedPorts.size < outCount) {
          const cid = uid('c');
          state.conns.set(cid, {
            id: cid,
            from: { nodeId: panel.id, port: freePort },
            to: { nodeId: id, port: 0 },
          });
        }
      }
      added++;
    }
  } finally {
    _suppressSnapshot = false;
  }
  render();
  renderInspector();
  notifyChange();
  return added;
}

// ================= Публичный API (для main.js) =================
window.Raschet = {
  loadScheme(data) {
    _suppressSnapshot = true;
    try {
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
      } else {
        deserialize(data);
        render();
        renderInspector();
      }
    } catch (err) {
      console.error('[Raschet.loadScheme]', err);
      throw err;
    } finally {
      _suppressSnapshot = false;
    }
    clearUndoStack();
  },
  getScheme() {
    return serialize();
  },
  loadDemo() {
    _suppressSnapshot = true;
    try {
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
    } finally {
      _suppressSnapshot = false;
    }
    clearUndoStack();
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
  undo,
  redo,
  canUndo() { return _undoStack.length > 0; },
  canRedo() { return _redoStack.length > 0; },
  clearHistory: clearUndoStack,
  onChange(cb) { _changeCb = cb; },

  applyPreset,
  generateReport,
  importLoadsTable,
  get3PhaseBalance,
};

})();
