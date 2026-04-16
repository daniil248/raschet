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
export function effectiveLoadFactor(n) {
  // Аварийный потребитель: в нормальном режиме loadFactor=0 (не участвует
  // в расчёте нагрузки). В любом аварийном режиме — включается (если нет
  // per-mode override).
  if (!state.activeModeId && n.emergencyOnly) return 0;
  if (!state.activeModeId) return 1;
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
