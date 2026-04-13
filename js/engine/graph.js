import { state, uid } from './state.js';
import { GLOBAL, DEFAULTS, TAG_PREFIX, NODE_H } from './constants.js';
import { nodeWidth, nodeInputCount } from './geometry.js';

let _snapshot, _render, _renderInspector, _notifyChange, _selectNode, _findZoneForMember;
export function bindGraphDeps({ snapshot, render, renderInspector, notifyChange, selectNode, findZoneForMember }) {
  _snapshot = snapshot; _render = render; _renderInspector = renderInspector;
  _notifyChange = notifyChange; _selectNode = selectNode; _findZoneForMember = findZoneForMember;
}

// Поиск наименьшего свободного обозначения с заданным префиксом (TR1, TR2, …)
export function nextFreeTag(type) {
  const prefix = TAG_PREFIX[type] || 'X';
  const used = new Set();
  for (const n of state.nodes.values()) {
    if (n.tag) used.add(n.tag);
  }
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

// Проверка, что tag не занят другим узлом В ТОЙ ЖЕ ЗОНЕ.
// Одинаковые теги допустимы в разных зонах (P1.MDB1 и P2.MDB1 — ок).
export function isTagUnique(tag, exceptId) {
  // Определяем зону кандидата
  const candidate = state.nodes.get(exceptId);
  const candidateZone = candidate ? _findZoneForMember(candidate) : null;
  const candidateZoneId = candidateZone ? candidateZone.id : null;
  for (const n of state.nodes.values()) {
    if (n.id === exceptId) continue;
    if (n.tag !== tag) continue;
    // Нашли узел с таким же tag — допустим, если он в ДРУГОЙ зоне
    const nZone = _findZoneForMember(n);
    const nZoneId = nZone ? nZone.id : null;
    if (nZoneId !== candidateZoneId) continue; // разные зоны → ок
    return false; // та же зона (или обе без зоны) → конфликт
  }
  return true;
}

// ================= Создание / удаление =================
export function createNode(type, x, y) {
  _snapshot();
  const id = uid();
  const base = { id, type, x, y, ...DEFAULTS[type]() };
  base.tag = nextFreeTag(type);
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
  state.nodes.set(id, base);
  _selectNode(id);
  _render();
  _notifyChange();
  return id;
}
export function deleteNode(id) {
  _snapshot();
  const n = state.nodes.get(id);
  // Каскадное удаление парного блока кондиционера
  const linkedIds = [];
  if (n) {
    if (n.linkedOutdoorId) linkedIds.push(n.linkedOutdoorId);
    if (n.linkedIndoorId) linkedIds.push(n.linkedIndoorId);
  }
  for (const lid of linkedIds) {
    const linked = state.nodes.get(lid);
    if (linked) {
      // Очистить обратную ссылку, чтобы не было рекурсии
      linked.linkedOutdoorId = null;
      linked.linkedIndoorId = null;
      for (const c of Array.from(state.conns.values())) {
        if (c.from.nodeId === lid || c.to.nodeId === lid) state.conns.delete(c.id);
      }
      state.nodes.delete(lid);
      for (const m of state.modes) { if (m.overrides) delete m.overrides[lid]; }
    }
  }
  for (const c of Array.from(state.conns.values())) {
    if (c.from.nodeId === id || c.to.nodeId === id) state.conns.delete(c.id);
  }
  state.nodes.delete(id);
  for (const m of state.modes) { if (m.overrides) delete m.overrides[id]; }
  if (state.selectedKind === 'node' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  _render();
  _renderInspector();
  _notifyChange();
}
export function deleteConn(id) {
  _snapshot();
  state.conns.delete(id);
  if (state.selectedKind === 'conn' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  _render();
  _renderInspector();
  _notifyChange();
}
export function clampPortsInvolvingNode(n) {
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
export function wouldCreateCycle(fromNodeId, toNodeId) {
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
export function tryConnect(from, to) {
  if (from.nodeId === to.nodeId) return false;
  for (const c of state.conns.values()) {
    if (c.to.nodeId === to.nodeId && c.to.port === to.port) return false;
    // Выход может иметь только одну исходящую связь
    if (c.from.nodeId === from.nodeId && c.from.port === from.port) return false;
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId)) return false;
  _snapshot();
  const id = uid('c');
  const conn = {
    id, from, to,
    // Дефолты по умолчанию для вывода ~1 м до щита/потребителя в норм. условиях
    material: GLOBAL.defaultMaterial,
    insulation: GLOBAL.defaultInsulation,
    installMethod: GLOBAL.defaultInstallMethod,
    ambientC: GLOBAL.defaultAmbient,
    grouping: GLOBAL.defaultGrouping,
    bundling: 'touching',
    lengthM: 1,
  };
  state.conns.set(id, conn);
  _notifyChange();
  return id;
}
