/* =========================================================================
   Raschet — точка входа ES-модулей
   Собирает все модули, связывает зависимости, выставляет window.Raschet API.
   ========================================================================= */

// === Импорты ===
import { GLOBAL, DEFAULTS, NODE_H, APP_VERSION, CONSUMER_CATALOG } from './constants.js';
import { state, uid, initDOM, setChangeCb, getChangeCb, svg, setIdSeq, ensureDefaultPage } from './state.js';
import { escHtml, escAttr, fmt, flash, field, checkField } from './utils.js';
import { selectCableSize, selectBreaker } from './cable.js';
import {
  nodeVoltage, nodeVoltageLN, isThreePhase, nodeWireCount,
  computeCurrentA, consumerNominalCurrent, consumerRatedCurrent,
  consumerInrushCurrent, upsChargeKw, sourceImpedance,
} from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight, portPos } from './geometry.js';
import {
  effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor,
  createMode, deleteMode, selectMode, bindModeDeps,
} from './modes.js';
import {
  snapshot, clearUndoStack, undo, redo, updateUndoButtons, notifyChange,
  bindHistoryDeps, setSuppressSnapshot, getSuppressSnapshot,
  canUndo, canRedo,
} from './history.js';
import {
  nextFreeTag, isTagUnique, createNode, deleteNode, deleteConn,
  clampPortsInvolvingNode, wouldCreateCycle, tryConnect, bindGraphDeps,
} from './graph.js';
import {
  isNodeFullyInside, findZoneForMember, effectiveTag, nodesInZone,
  tryAttachToZone, detachFromZones, maxOccupiedPort,
} from './zones.js';
import { serialize, stripRuntime, deserialize, bindSerializationDeps } from './serialization.js';
import { recalc, maxDownstreamLoad, downstreamPQ, panelCosPhi } from './recalc.js';
import {
  updateViewBox, el, text, bezier, splinePath, pathMidpoint,
  render, renderNodes, renderConns, renderStats, renderModes,
  drawChannelIcon, drawBundlingIcon, bindRenderDeps,
} from './render.js';
import {
  selectNode, selectConn, renderInspector, renderInspectorNode,
  renderInspectorConn, wireInspectorInputs, clientToSvg,
  openImpedanceModal, openAutomationModal, openConsumerParamsModal,
  openUpsParamsModal, openPanelParamsModal, checkFieldEff,
  channelIconSVG, bundlingIconSVG, voltageField, phaseField,
  phaseFieldConsumer, sourceStatusBlock, panelStatusBlock,
  consumerCurrentsBlock, prioritySection, statusBlock, upsStatusBlock,
  saveNodeAsPreset, bindInspectorDeps,
} from './inspector.js';
import { initInteraction, bindInteractionDeps } from './interaction.js';
import { initToolbar, autoLayout, exportSVG, exportPNG, fitAll } from './export.js';
import { simTick, startSimLoop, stopSimLoop } from './simulation.js';
import { generateReport, get3PhaseBalance } from './report.js';
import { getReportSections } from './report-sections.js';
import { importLoadsTable } from './import.js';

// === Синхронизация GLOBAL с shared/global-settings.js ===
// Единый источник правды — localStorage['raschet.global.v1'].
// loadGlobal() делает миграцию (voltage levels, builtin marks).
// Все модули (cable/, battery/, ups-config/…) читают тот же cache.
import { loadGlobal, saveGlobal, onGlobalChange } from '../../shared/global-settings.js';
import { migrateVoltageLevels } from './electrical.js';
const _loadedGlobal = loadGlobal();
Object.assign(GLOBAL, _loadedGlobal);
migrateVoltageLevels(GLOBAL.voltageLevels);
// Подписка: если global-settings меняется извне (другая вкладка или
// subprogram) — engine GLOBAL остаётся в синхроне.
onGlobalChange((next) => {
  for (const k of Object.keys(next)) {
    if (k in GLOBAL) GLOBAL[k] = next[k];
  }
});

// === Phase 1.2: инициализация catalog-bridge ===
// Регистрирует legacy-каталоги (panel, ups, battery, transformer, cable-types)
// как builtin-элементы в element-library. Подписывается на cross-tab sync.
import { initCatalogBridge } from '../../shared/catalog-bridge.js';
initCatalogBridge();

// === Phase 1.3: BOM-генератор ===
// Собирает спецификацию проекта из state + element-library (composition).
import { collectBomFromProject, bomToMarkdown } from '../../shared/bom.js';

// === Phase 1.4.3: приём выбора из ups-config/ ===
// Когда пользователь в вкладке ups-config нажимает «Применить к схеме»,
// в localStorage пишется объект { nodeId, ups, selectedAt }. Мы слушаем
// 'storage' event (кросс-tab) и проверяем при focus (когда пользователь
// возвращается на эту вкладку). При совпадении nodeId с узлом в state —
// применяем через applyUpsModel и сохраняем upsCatalogId.
import { applyUpsModel } from '../../shared/ups-picker.js';
const PENDING_UPS_KEY = 'raschet.pendingUpsSelection.v1';
function _tryConsumePendingUpsSelection() {
  let raw;
  try { raw = localStorage.getItem(PENDING_UPS_KEY); } catch { return; }
  if (!raw) return;
  let payload;
  try { payload = JSON.parse(raw); } catch { localStorage.removeItem(PENDING_UPS_KEY); return; }
  if (!payload || !payload.nodeId || !payload.ups) { localStorage.removeItem(PENDING_UPS_KEY); return; }
  // Устарел если старше 5 минут — игнорируем
  if (payload.selectedAt && (Date.now() - payload.selectedAt) > 5 * 60 * 1000) {
    localStorage.removeItem(PENDING_UPS_KEY);
    return;
  }
  const node = state.nodes.get(payload.nodeId);
  if (!node || node.type !== 'ups') {
    localStorage.removeItem(PENDING_UPS_KEY);
    return;
  }
  try {
    snapshot('ups-config:apply:' + node.id);
    applyUpsModel(node, payload.ups);
    render(); renderInspector(); notifyChange();
    console.info('[ups-config] applied', payload.ups.id, 'to', node.id);
  } catch (e) {
    console.warn('[ups-config] apply failed', e);
  } finally {
    localStorage.removeItem(PENDING_UPS_KEY);
  }
}
window.addEventListener('focus', _tryConsumePendingUpsSelection);
window.addEventListener('storage', (ev) => {
  if (ev.key === PENDING_UPS_KEY && ev.newValue) _tryConsumePendingUpsSelection();
});
// Сразу проверяем на старте — если пользователь обновил страницу после применения
_tryConsumePendingUpsSelection();

// === Phase 1.4.4: приём выбора АКБ из battery/ ===
const PENDING_BATTERY_KEY = 'raschet.pendingBatterySelection.v1';
function _tryConsumePendingBatterySelection() {
  let raw;
  try { raw = localStorage.getItem(PENDING_BATTERY_KEY); } catch { return; }
  if (!raw) return;
  let payload;
  try { payload = JSON.parse(raw); } catch { localStorage.removeItem(PENDING_BATTERY_KEY); return; }
  if (!payload || !payload.nodeId) { localStorage.removeItem(PENDING_BATTERY_KEY); return; }
  if (payload.selectedAt && (Date.now() - payload.selectedAt) > 5 * 60 * 1000) {
    localStorage.removeItem(PENDING_BATTERY_KEY);
    return;
  }
  const node = state.nodes.get(payload.nodeId);
  if (!node || node.type !== 'ups') {
    localStorage.removeItem(PENDING_BATTERY_KEY);
    return;
  }
  try {
    snapshot('battery-calc:apply:' + node.id);
    if (payload.batteryCatalogId) node.batteryCatalogId = payload.batteryCatalogId;
    if (payload.batteryStringCount) node.batteryStringCount = payload.batteryStringCount;
    if (payload.batteryBlocksPerString) node.batteryBlocksPerString = payload.batteryBlocksPerString;
    if (payload.batteryAutonomyMin) node.batteryAutonomyMin = payload.batteryAutonomyMin;
    if (payload.batteryKwh) node.batteryKwh = payload.batteryKwh;
    render(); renderInspector(); notifyChange();
    console.info('[battery-calc] applied to', node.id, payload);
  } catch (e) {
    console.warn('[battery-calc] apply failed', e);
  } finally {
    localStorage.removeItem(PENDING_BATTERY_KEY);
  }
}
window.addEventListener('focus', _tryConsumePendingBatterySelection);
window.addEventListener('storage', (ev) => {
  if (ev.key === PENDING_BATTERY_KEY && ev.newValue) _tryConsumePendingBatterySelection();
});
_tryConsumePendingBatterySelection();

// === Инициализация DOM ===
initDOM();
// Гарантируем что всегда есть хотя бы одна страница
ensureDefaultPage();

// Загрузка пользовательской библиотеки типов потребителей из localStorage
// (user-scoped, не привязано к проекту).
try {
  const stored = localStorage.getItem('raschet.userConsumerCatalog.v1');
  if (stored) {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr)) GLOBAL.customConsumerCatalog = arr;
  }
} catch (e) { console.warn('[userCatalog] cannot load', e); }

// Хелпер для сохранения пользовательской библиотеки
function persistUserConsumerCatalog() {
  try {
    localStorage.setItem('raschet.userConsumerCatalog.v1',
      JSON.stringify(GLOBAL.customConsumerCatalog || []));
  } catch (e) { console.warn('[userCatalog] cannot save', e); }
}

// Экспонируем renderInspector для export.js page switching
if (typeof window !== 'undefined') {
  window.__raschetRenderInspector = () => renderInspector();
  window.__raschetPersistUserCatalog = persistUserConsumerCatalog;
}

// === Связывание зависимостей (late-binding) ===
bindModeDeps({ snapshot, render, renderInspector, notifyChange });
bindHistoryDeps({ serialize, deserialize, render, renderInspector });
bindGraphDeps({ snapshot, render, renderInspector, notifyChange, selectNode, findZoneForMember });
bindSerializationDeps({ clearUndoStack, render, renderInspector, updateViewBox });
bindRenderDeps({ renderInspector });
bindInspectorDeps({ render, deleteNode, deleteConn, isTagUnique });
bindInteractionDeps({ undo, redo, fitAll, serialize });

// === Инициализация UI ===
initInteraction();
initToolbar();

// === Холодный старт ===
window.addEventListener('resize', updateViewBox);
updateViewBox();
render();
renderInspector();
startSimLoop();

// === Версия ===
const vEl = document.getElementById('app-version');
if (vEl) vEl.textContent = 'v' + APP_VERSION;

// === Библиотека пресетов ===
// Привязывает узел к текущей странице (home + linked если current — ссылочная)
function _assignCurrentPageIds(base) {
  if (!state.currentPageId) return;
  const cur = (state.pages || []).find(p => p.id === state.currentPageId);
  if (cur && cur.type === 'linked' && cur.sourcePageId) {
    base.pageIds = [cur.sourcePageId, cur.id];
  } else {
    base.pageIds = [state.currentPageId];
  }
}

function applyPreset(preset) {
  if (!preset || !preset.type || !DEFAULTS[preset.type]) return null;
  snapshot();
  const W = (svg ? svg.clientWidth : 0) || 800;
  const H = (svg ? svg.clientHeight : 0) || 600;
  const cx = state.view.x + (W / 2) / state.view.zoom;
  const cy = state.view.y + (H / 2) / state.view.zoom;
  const id = uid();
  // Если пресет имеет sourceSubtype (utility/other) — передаём его в DEFAULTS
  const subtype = preset.params?.sourceSubtype;
  const defs = DEFAULTS[preset.type](subtype);
  const base = { id, type: preset.type, ...defs, ...preset.params };
  base.tag = nextFreeTag(preset.type);
  if (typeof base.inputs === 'number') {
    if (!Array.isArray(base.priorities)) base.priorities = [];
    while (base.priorities.length < base.inputs) base.priorities.push(base.priorities.length + 1);
    base.priorities.length = base.inputs;
  }
  base.x = cx - nodeWidth(base) / 2;
  base.y = cy - NODE_H / 2;
  _assignCurrentPageIds(base);
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}

function applyPresetAt(preset, x, y) {
  if (!preset || !preset.type || !DEFAULTS[preset.type]) return null;
  snapshot();
  const id = uid();
  const subtype = preset.params?.sourceSubtype;
  const defs = DEFAULTS[preset.type](subtype);
  const base = { id, type: preset.type, ...defs, ...preset.params };
  base.tag = nextFreeTag(preset.type);
  if (typeof base.inputs === 'number') {
    if (!Array.isArray(base.priorities)) base.priorities = [];
    while (base.priorities.length < base.inputs) base.priorities.push(base.priorities.length + 1);
    base.priorities.length = base.inputs;
  }
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
  _assignCurrentPageIds(base);
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}

// === Демо ===
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

  state.modes.push({ id: uid('m'), name: 'Ввод 1 сломан', overrides: { [s1]: { on: false } } });
  state.modes.push({ id: uid('m'), name: 'Оба ввода сломаны', overrides: { [s1]: { on: false }, [s2]: { on: false } } });

  state.selectedKind = null; state.selectedId = null;
}

// === Публичный API (для main.js) ===
window.Raschet = {
  loadScheme(data) {
    setSuppressSnapshot(true);
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
      setSuppressSnapshot(false);
    }
    clearUndoStack();
  },
  getScheme() {
    return serialize();
  },
  loadDemo() {
    setSuppressSnapshot(true);
    try {
      state.nodes.clear();
      state.conns.clear();
      state.modes = [];
      state.activeModeId = null;
      state.selectedKind = null;
      state.selectedId = null;
      setIdSeq(1);
      buildDemo();
      render();
      renderInspector();
    } finally {
      setSuppressSnapshot(false);
    }
    clearUndoStack();
  },
  setReadOnly(flag) {
    state.readOnly = !!flag;
    document.body.classList.toggle('read-only', state.readOnly);
    renderInspector();
  },
  fit() {
    if (svg && (!svg.clientWidth || !svg.clientHeight)) {
      requestAnimationFrame(() => fitAll());
      return;
    }
    fitAll();
  },
  isEmpty() { return state.nodes.size === 0; },
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory: clearUndoStack,
  onChange(cb) { setChangeCb(cb); },

  applyPreset,
  applyPresetAt,
  generateReport,
  getReportSections,
  // Прямой доступ к state (для модалки параметров проекта и т.п.)
  _state: state,
  notifyChange: () => {
    const cb = (typeof getChangeCb === 'function' ? getChangeCb() : null);
    if (typeof cb === 'function') cb();
  },
  importLoadsTable,
  get3PhaseBalance,
  // Фаза 1.3: BOM
  getBom() { return collectBomFromProject(state); },
  getBomMarkdown() { return bomToMarkdown(collectBomFromProject(state).aggregated); },
  getGlobal() { return { ...GLOBAL }; },
  getConsumerCatalog() {
    return [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])];
  },
  setGlobal(patch) {
    if (!patch || typeof patch !== 'object') return;
    for (const k of Object.keys(patch)) {
      if (k in GLOBAL) GLOBAL[k] = patch[k];
    }
    // Синхронизация с shared/global-settings.js — уведомит все
    // подпрограммы через onGlobalChange + запишет в localStorage.
    try { saveGlobal(patch); } catch (e) { console.warn('[engine.setGlobal]', e); }
    render();
    renderInspector();
  },
  // Модалки параметров — для редактирования пресетов
  openConsumerParamsModal,
  openUpsParamsModal,
  openPanelParamsModal,
  openImpedanceModal,
  getDefaults(type) { return DEFAULTS[type] ? DEFAULTS[type]() : {}; },
  _presetEditCallback: null,
};
