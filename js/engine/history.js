import { state, getChangeCb, getChangeListeners } from './state.js';

// Late-bound dependencies (set by index.js to avoid circular imports)
let _serialize, _deserialize, _render, _renderInspector;
export function bindHistoryDeps({ serialize, deserialize, render, renderInspector }) {
  _serialize = serialize; _deserialize = deserialize; _render = render; _renderInspector = renderInspector;
}

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

export function snapshot(tag) {
  if (_suppressSnapshot) return;
  if (tag && tag === _lastSnapTag) return;
  _undoStack.push(JSON.stringify(_serialize()));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
  _lastSnapTag = tag || ('#' + (++_snapCounter));
  updateUndoButtons();
}

export function clearUndoStack() {
  _undoStack.length = 0;
  _redoStack.length = 0;
  _lastSnapTag = null;
  updateUndoButtons();
}

export function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(JSON.stringify(_serialize()));
  const prev = _undoStack.pop();
  _suppressSnapshot = true;
  try {
    _deserialize(JSON.parse(prev));
    _render();
    _renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

export function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(JSON.stringify(_serialize()));
  const next = _redoStack.pop();
  _suppressSnapshot = true;
  try {
    _deserialize(JSON.parse(next));
    _render();
    _renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

export function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = _undoStack.length === 0;
  if (r) r.disabled = _redoStack.length === 0;
}

export function notifyChange() {
  if (state.readOnly || _suppressSnapshot) return;
  // Главный handler (main.js — autosave + dirty-flag).
  const _changeCb = getChangeCb();
  if (_changeCb) {
    try { _changeCb(); } catch (e) { console.error('[onChange]', e); }
  }
  // Дополнительные слушатели (POR-mirror, плагины) — отдельный список,
  // не блокируют главный, ошибки логируются индивидуально.
  const listeners = getChangeListeners();
  if (listeners && listeners.size) {
    for (const cb of listeners) {
      try { cb(); } catch (e) { console.error('[onChangeListener]', e); }
    }
  }
}

export function canUndo() { return _undoStack.length > 0; }
export function canRedo() { return _redoStack.length > 0; }
export function setSuppressSnapshot(v) { _suppressSnapshot = v; }
export function getSuppressSnapshot() { return _suppressSnapshot; }
