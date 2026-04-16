import { state, uid } from './state.js';

// Late-bound dependencies (set by index.js to avoid circular imports)
let _snapshot, _render, _renderInspector, _notifyChange;
export function bindModeDeps({ snapshot, render, renderInspector, notifyChange }) {
  _snapshot = snapshot; _render = render; _renderInspector = renderInspector; _notifyChange = notifyChange;
}

// ================= Режимы =================
export function effectiveOn(n) {
  if (!('on' in n)) return true;
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    if (m && m.overrides && m.overrides[n.id] && 'on' in m.overrides[n.id]) {
      return m.overrides[n.id].on;
    }
  }
  return n.on;
}
export function setEffectiveOn(n, val) {
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
// Множитель нагрузки потребителя в текущем режиме.
// По умолчанию 1. В per-mode override можно задать 0 (не считается),
// 0.5 (50%), 2 (двойная нагрузка) и т.п.
// Устанавливается через инспектор в поле «Коэфф. режима» когда
// выбран конкретный режим работы.
export function effectiveLoadFactor(n) {
  if (!state.activeModeId) {
    return typeof n.normalLoadFactor === 'number' ? n.normalLoadFactor : 1;
  }
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (m && m.overrides && m.overrides[n.id] && typeof m.overrides[n.id].loadFactor === 'number') {
    return m.overrides[n.id].loadFactor;
  }
  return 1;
}
export function setEffectiveLoadFactor(n, val) {
  if (!state.activeModeId) return;
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (!m) return;
  if (!m.overrides) m.overrides = {};
  if (!m.overrides[n.id]) m.overrides[n.id] = {};
  m.overrides[n.id].loadFactor = Number(val) || 0;
}
export function createMode(name) {
  _snapshot();
  const id = uid('m');
  const m = { id, name: name || `Режим ${state.modes.length + 1}`, overrides: {} };
  state.modes.push(m);
  state.activeModeId = id;
  _render();
  _notifyChange();
}
export function deleteMode(id) {
  _snapshot();
  state.modes = state.modes.filter(m => m.id !== id);
  if (state.activeModeId === id) state.activeModeId = null;
  _render();
  _notifyChange();
}
export function selectMode(id) {
  state.activeModeId = id;
  _render();
  _renderInspector();
}
