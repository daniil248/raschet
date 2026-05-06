import { state, svg, inspectorBody, uid, pagesForNode } from './state.js';
import { GLOBAL, DEFAULTS, CHANNEL_TYPES, CABLE_TYPES, NODE_H, LINE_COLORS, CONSUMER_CATALOG, TRANSFORMER_CATALOG, INSTALL_METHODS, BREAKER_SERIES, BREAKER_TYPES, ZONE_PASTEL_PALETTE, SYSTEMS_CATALOG, getSystemMeta, getAllSystems } from './constants.js';
import { escHtml, escAttr, fmt, field, checkField, flash, helpIcon } from './utils.js';
import { nodeVoltage, isThreePhase, computeCurrentA, nodeWireCount, cableVoltageClass, formatVoltageLevelLabel, consumerTotalDemandKw, consumerCountEffective, containerHomogeneity } from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, getNodeGeometryMm } from './geometry.js';
import { getCurrentPage, getPageKind, PAGE_KINDS, PAGE_KINDS_META } from './state.js';
import { effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor } from './modes.js';
import { snapshot, notifyChange } from './history.js';
import { clampPortsInvolvingNode, nextFreeTag } from './graph.js';
import { panelCosPhi, downstreamPQ } from './recalc.js';
import { effectiveTag, findZoneForMember, nodesInZone, maxOccupiedPort, copyZoneWithMembers } from './zones.js';
import { kTempLookup, kGroupLookup, kBundlingFactor, selectCableSize } from './cable.js';
import { getMethod } from '../methods/index.js';
import { getTerm, getTermTooltip, isTermUsed } from '../methods/terms.js';
import { listTransformers } from '../../shared/transformer-catalog.js';
import { mountTransformerPicker, applyTransformerModel } from '../../shared/transformer-picker.js';
// v0.59.351: автоматический матч узла схемы с реестрами проекта по S/N или Инв.№.
import { findInventoryMatch, listAllItDevices, listAllFacilityItems } from '../../shared/inventory-bridge.js';
import { getActiveProjectId as _activeProjectId } from '../../shared/project-storage.js';
import { rsPrompt, rsConfirm } from '../../shared/dialog.js';

// Внешние зависимости, устанавливаемые через bindInspectorDeps
import {
  bindInspectorUpsDeps,
  bindWrapModalTabs as bindWrapModalTabsUps,
  openUpsParamsModal,
  openUpsControlModal,
  openUpsBatteryModal,
  upsStatusBlock,
} from './inspector/ups.js';
import {
  bindInspectorConsumerDeps,
  openConsumerParamsModal,
} from './inspector/consumer.js';
import {
  bindInspectorSourceDeps,
  bindWrapModalTabs as bindWrapModalTabsSource,
  openImpedanceModal,
  openAutomationModal,
  openTuRequestModal,
  sourceStatusBlock,
  voltageLevelOptions,
} from './inspector/source.js';
import {
  bindInspectorPanelDeps,
  bindWrapModalTabs as bindWrapModalTabsPanel,
  openPanelParamsModal,
  openPanelControlModal,
  panelStatusBlock,
} from './inspector/panel.js';
import {
  bindInspectorConnDeps,
  renderInspectorConn,
  buildInstallConditionsBlock,
  installCoefficientBlock,
  channelIconSVG,
  bundlingIconSVG,
} from './inspector/conn.js';
let _render, _deleteNode, _deleteConn, _isTagUnique;
// v0.58.55: запоминаем активную вкладку инспектора по id узла, чтобы
// при re-render (change → renderInspector()) не сбрасывать её на «Общее».
const _activeTabByNode = new Map();
// v0.59.88: публичный setter активной модал-вкладки. Нужен, когда кнопка
// «Параметры щита» в сайдбаре (вкладка Электрика) открывает модалку —
// модалка должна открыться именно на «Электрика», а не на «Общее».
export function setModalActiveTab(nodeId, tab) {
  if (!nodeId || !tab) return;
  _activeTabByNode.set(nodeId + ':modal', tab);
}
export function bindInspectorDeps({ render, deleteNode, deleteConn, isTagUnique }) {
  _render = render;
  _deleteNode = deleteNode;
  _deleteConn = deleteConn;
  _isTagUnique = isTagUnique;
  // Прокидываем renderInspector в отдельные модули.
  bindInspectorUpsDeps({ renderInspector });
  bindInspectorConsumerDeps({ renderInspector });
  bindInspectorSourceDeps({ renderInspector });
  bindInspectorPanelDeps({ renderInspector });
  bindInspectorConnDeps({ renderInspector });
  // v0.58.6: прокидываем обёртку модалок во вкладки систем
  try {
    bindWrapModalTabsUps(wrapModalWithSystemTabs);
    bindWrapModalTabsSource(wrapModalWithSystemTabs);
    bindWrapModalTabsPanel(wrapModalWithSystemTabs);
  } catch {}
  // v0.59.368: defensive event delegation на inspectorBody для модальных
  // кнопок типа «Параметры потребителя/щита/ИБП». Прямой listener
  // в wireInspectorInputs() мог терять привязку при re-render
  // (или при условиях, где wire не успел отработать в порядке загрузки
  // системных вкладок). Делегирование гарантирует, что click всегда
  // открывает модалку, даже если direct binding ещё не успел.
  if (inspectorBody && !inspectorBody.__rsDelegated) {
    inspectorBody.__rsDelegated = true;
    inspectorBody.addEventListener('click', (ev) => {
      const t = ev.target && ev.target.closest && ev.target.closest('button');
      if (!t || !t.id) return;
      // Если у узла state.selectedKind/Id указывают на node — берём узел.
      let n = null;
      if (state.selectedKind === 'node') n = state.nodes.get(state.selectedId) || null;
      if (!n) return;
      try {
        if (t.id === 'btn-open-consumer-params' && n.type === 'consumer') {
          openConsumerParamsModal(n);
        } else if (t.id === 'btn-open-panel-params' && n.type === 'panel') {
          setModalActiveTab(n.id, 'electrical');
          openPanelParamsModal(n);
        } else if (t.id === 'btn-open-panel-control' && n.type === 'panel') {
          openPanelControlModal(n);
        } else if (t.id === 'btn-open-ups-params' && n.type === 'ups') {
          openUpsParamsModal(n);
        } else if (t.id === 'btn-open-ups-control' && n.type === 'ups') {
          openUpsControlModal(n);
        } else if (t.id === 'btn-open-ups-battery' && n.type === 'ups') {
          openUpsBatteryModal(n);
        }
      } catch (e) { console.warn('[inspector delegated click]', t.id, e); }
    }, true); // capture, чтобы сработать даже если direct listener вызвал stopPropagation
  }
}

// ================= Инспектор =================
// Хук для collab-блокировок: main.js устанавливает коллбэк, который
// вызывается при любом изменении выделения (с возможностью cancel).
let _selectionHook = null;
export function setSelectionHook(cb) { _selectionHook = cb; }

function _runSelectionHook(kind, id, prevKind, prevId) {
  if (typeof _selectionHook !== 'function') return true;
  try {
    const res = _selectionHook(kind, id, prevKind, prevId);
    return res !== false;
  } catch (e) { console.warn('[selectionHook]', e); return true; }
}

export function selectNode(id) {
  const prevK = state.selectedKind, prevI = state.selectedId;
  if (!_runSelectionHook('node', id, prevK, prevI)) return;
  state.selectedKind = 'node'; state.selectedId = id;
  renderInspector();
}
export function selectConn(id) {
  const prevK = state.selectedKind, prevI = state.selectedId;
  if (!_runSelectionHook('conn', id, prevK, prevI)) return;
  state.selectedKind = 'conn'; state.selectedId = id;
  renderInspector();
}

// =============== Синхронизация зон с одинаковым effectiveTag ===============
// Два экземпляра зоны (root или sub) с совпадающим полным обозначением
// («P1» или «P1.S2») считаются одной логической зоной. Изменение name /
// color в одном экземпляре пробрасывается на все остальные. Сама функция
// безопасна к зонам без effectiveTag — просто ничего не делает.
function _syncZoneByEffectiveTag(src, patch) {
  if (!src || src.type !== 'zone') return;
  const srcTag = effectiveTag(src);
  if (!srcTag) return;
  for (const other of state.nodes.values()) {
    if (other.id === src.id || other.type !== 'zone') continue;
    if (effectiveTag(other) !== srcTag) continue;
    for (const [k, v] of Object.entries(patch)) other[k] = v;
  }
}

// Сохранить состояние open/closed всех <details> в инспекторе
function _detailsKey(summary, idx) {
  // Нормализуем ключ: убираем числа в скобках чтобы "Линии в канале (1)" = "Линии в канале (0)"
  const raw = summary?.textContent?.trim() || '';
  return raw.replace(/\s*\(\d+\)\s*$/, '') || `__${idx}`;
}
function _saveDetailsState() {
  const map = {};
  inspectorBody.querySelectorAll('details').forEach((det, i) => {
    map[_detailsKey(det.querySelector('summary'), i)] = det.open;
  });
  return map;
}
function _restoreDetailsState(map) {
  inspectorBody.querySelectorAll('details').forEach((det, i) => {
    const key = _detailsKey(det.querySelector('summary'), i);
    if (key in map) det.open = map[key];
  });
}

export function renderInspector() {
  if (!state.selectedKind) {
    // Ничего не выбрано — показываем свойства ТЕКУЩЕЙ СТРАНИЦЫ
    renderInspectorPage();
    return;
  }
  const detailsState = _saveDetailsState();
  if (state.selectedKind === 'node') {
    const n = state.nodes.get(state.selectedId);
    if (!n) { inspectorBody.innerHTML = ''; return; }
    renderInspectorNode(n);
  } else {
    const c = state.conns.get(state.selectedId);
    if (!c) { inspectorBody.innerHTML = ''; return; }
    renderInspectorConn(c);
  }
  _restoreDetailsState(detailsState);
}

function renderInspectorPage() {
  const page = (state.pages || []).find(p => p.id === state.currentPageId);
  if (!page) {
    inspectorBody.innerHTML = '<div class="muted">Нет активной страницы.</div>';
    return;
  }
  const h = [];
  h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px">Свойства страницы</div>`);
  h.push(field('Обозначение', `<input type="text" id="pg-designation" value="${escAttr(page.designation || '')}" placeholder="Л1, Э-001, ...">`));
  h.push(field('Название', `<input type="text" id="pg-name" value="${escAttr(page.name || '')}">`));
  h.push(field('№ листа', `<input type="text" id="pg-sheet" value="${escAttr(page.sheetNo || '')}" placeholder="1">`));
  h.push(field('Наименование чертежа', `<input type="text" id="pg-title" value="${escAttr(page.title || '')}" placeholder="Принципиальная схема">`));
  h.push(field('Ревизия', `<input type="text" id="pg-rev" value="${escAttr(page.revision || '')}" placeholder="0">`));
  h.push(field('Описание страницы', `<textarea id="pg-desc" rows="3" style="width:100%;font:inherit;font-size:12px;resize:vertical" placeholder="Описание этого листа">${escHtml(page.description || '')}</textarea>`));
  // v0.58.10: вид страницы + масштаб (для layout / mechanical)
  {
    const kind = getPageKind(page);
    let kindOpts = '';
    for (const k of PAGE_KINDS) {
      const m = PAGE_KINDS_META[k];
      if (!m) continue;
      kindOpts += `<option value="${k}"${kind === k ? ' selected' : ''}>${escHtml(m.icon)} ${escHtml(m.label)}</option>`;
    }
    // v0.58.21: вид страницы зафиксирован после создания — иначе можно
    // сломать схему (порты/связи привязаны к виду). Для смены — создайте
    // новую страницу нужного вида.
    h.push(field('Вид страницы', `<select id="pg-kind" disabled title="Вид страницы нельзя изменить после создания — создайте новую страницу нужного вида">${kindOpts}</select>`
      + `<div class="muted" style="font-size:10px;margin-top:2px">Фиксируется при создании страницы</div>`));
    // v0.58.35: масштаб — только для страниц расположения (для schematic/TCC
    // и прочих абстрактных видов понятие масштаба не имеет смысла).
    if (kind === 'layout') {
      const scales = ['1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50', '1:100', '1:200', '1:500', '1:1000'];
      const curScale = page.scale || '1:1';
      const scaleOpts = scales.map(s => `<option value="${s}"${s === curScale ? ' selected' : ''}>${s}</option>`).join('');
      h.push(field('Масштаб', `<select id="pg-scale">${scaleOpts}</select>`));
      // v0.58.42: тумблеры сетки/линеек
      // v0.58.44: «Сетка» — дубль глобального toolbar-тумблера (GLOBAL.showGrid).
      // Линейки — per-page (глобального нет).
      const sg = GLOBAL.showGrid !== false;
      const sr = page.showRulers !== false;
      h.push(field('Отображение', `
        <label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;cursor:pointer">
          <input type="checkbox" id="pg-show-grid"${sg ? ' checked' : ''}> Сетка
        </label>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" id="pg-show-rulers"${sr ? ' checked' : ''}> Линейки
        </label>`));
    }
  }

  // v0.59.398: убрано поле «Тип» (Независимая/Ссылочная) из свойств страницы.
  // В проекте всегда набор видов одной схемы (см. v0.58.5 — убрано из контекст-
  // меню), все элементы видны на всех страницах. Поле было реликтом ранней
  // архитектуры и вводило пользователей в заблуждение.

  // Статистика страницы
  const nodeCount = [...state.nodes.values()].filter(n => {
    const pids = Array.isArray(n.pageIds) ? n.pageIds : null;
    return !pids || pids.length === 0 || pids.includes(page.id);
  }).length;
  h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-top:8px">` +
    `Узлов на странице: <b>${nodeCount}</b>` +
    `</div>`);

  // Блок параметров проекта (краткое превью)
  const proj = state.project || {};
  if (proj.designation || proj.name || proj.customer) {
    h.push('<div class="inspector-section"><h4>Проект</h4>');
    h.push('<div style="font-size:11px;line-height:1.7">');
    if (proj.designation) h.push(`<div>Обозначение: <b>${escHtml(proj.designation)}</b></div>`);
    if (proj.name) h.push(`<div>Наименование: ${escHtml(proj.name)}</div>`);
    if (proj.customer) h.push(`<div>Заказчик: ${escHtml(proj.customer)}</div>`);
    if (proj.stage) h.push(`<div>Стадия: ${escHtml(proj.stage)}</div>`);
    h.push('</div></div>');
  }
  h.push(`<button class="full-btn" id="pg-open-project" style="margin-top:8px">📋 Параметры проекта…</button>`);

  // v0.59.712: чеклист состояния проектирования. Сводка по схеме —
  // что готово, что требует внимания. Заменяет ручной обход через
  // отчёт «Проверки и предупреждения» — быстрый просмотр прямо в
  // правом сайдбаре, без открытия отчётов.
  {
    const allNodes = [...state.nodes.values()];
    const sources = allNodes.filter(m => m.type === 'source' || m.type === 'generator');
    const upses = allNodes.filter(m => m.type === 'ups');
    const panels = allNodes.filter(m => m.type === 'panel');
    const consumers = allNodes.filter(m => m.type === 'consumer');
    const unpoweredConsumers = consumers.filter(m => !m._powered);
    const overloaded = allNodes.filter(m => m._overload || m._breakerOverload);
    const vdropOver5 = allNodes.filter(m =>
      (m.type === 'consumer' || m.type === 'panel') && Number(m._deltaUPct) > 5);
    const vdropOver10 = allNodes.filter(m =>
      (m.type === 'consumer' || m.type === 'panel') && Number(m._deltaUPct) > 10);
    // v0.59.716: подсчёт кабельных проблем
    const allConns = [...state.conns.values()].filter(c => c._state === 'active' && !c._isInternalConnHidden);
    const cableOverflow = allConns.filter(c => c._cableOverflow);
    const breakerUndersize = allConns.filter(c => c._breakerUndersize);
    const tuFilled = (() => {
      try {
        const ps = state.project?.customer || state.project?.object;
        return !!ps;
      } catch { return false; }
    })();
    // v0.59.713/717: некоторые строки делаем кликабельными — клик
    // выделяет ПЕРВЫЙ проблемный узел/связь на схеме (data-checklist-jump
    // + опциональный data-checklist-kind='node'|'conn').
    const _row = (icon, color, label, count, total, jumpId, jumpKind) => {
      const txt = total != null ? `${count}/${total}` : (count != null ? String(count) : '');
      const _kind = jumpKind || 'node';
      const _clickable = jumpId
        ? ` data-checklist-jump="${jumpId}" data-checklist-kind="${_kind}" style="cursor:pointer" title="Кликните, чтобы перейти к первой проблемной ${_kind === 'conn' ? 'линии' : 'узлу'}"`
        : '';
      return `<div${_clickable ? ' class="checklist-row"' : ''}${_clickable} style="display:flex;justify-content:space-between;align-items:center;font-size:11px;line-height:1.6${jumpId ? ';cursor:pointer' : ''}">
        <span><span style="color:${color}">${icon}</span> ${label}</span>
        <b style="color:${color}">${txt}</b>
      </div>`;
    };
    const isOk = (v) => v === 0 || v === true;
    const _firstId = (arr) => (arr && arr[0] ? arr[0].id : null);
    h.push(`<div class="inspector-section" style="margin-top:12px;padding:8px 10px;background:#f9fafb;border-radius:4px">
      <h4 style="margin:0 0 6px;font-size:13px">📐 Состояние проектирования</h4>
      ${_row(sources.length ? '✓' : '⚠', sources.length ? '#15803d' : '#ca8a04', 'Источников питания', sources.length)}
      ${_row(upses.length ? '✓' : 'ℹ', upses.length ? '#15803d' : '#6b7280', 'ИБП', upses.length)}
      ${_row(panels.length ? '✓' : 'ℹ', panels.length ? '#15803d' : '#6b7280', 'Распределительных щитов', panels.length)}
      ${_row(consumers.length ? '✓' : '⚠', consumers.length ? '#15803d' : '#ca8a04', 'Потребителей', consumers.length)}
      ${_row(isOk(unpoweredConsumers.length) ? '✓' : '⚠', isOk(unpoweredConsumers.length) ? '#15803d' : '#ca8a04', 'Без питания', unpoweredConsumers.length, null, _firstId(unpoweredConsumers))}
      ${_row(isOk(overloaded.length) ? '✓' : '⛔', isOk(overloaded.length) ? '#15803d' : '#b91c1c', 'Перегруженных узлов', overloaded.length, null, _firstId(overloaded))}
      ${_row(isOk(vdropOver5.length) ? '✓' : '⚠', isOk(vdropOver5.length) ? '#15803d' : '#ca8a04', 'ΔU > 5%', vdropOver5.length, null, _firstId(vdropOver5))}
      ${vdropOver10.length > 0 ? _row('⛔', '#b91c1c', 'из них ΔU > 10%', vdropOver10.length, null, _firstId(vdropOver10)) : ''}
      ${_row(isOk(cableOverflow.length) ? '✓' : '⛔', isOk(cableOverflow.length) ? '#15803d' : '#b91c1c', 'Кабелей переполнено', cableOverflow.length, null, _firstId(cableOverflow), 'conn')}
      ${_row(isOk(breakerUndersize.length) ? '✓' : '⛔', isOk(breakerUndersize.length) ? '#15803d' : '#b91c1c', 'Автоматов: In < Iрасч', breakerUndersize.length, null, _firstId(breakerUndersize), 'conn')}
      ${_row(tuFilled ? '✓' : 'ℹ', tuFilled ? '#15803d' : '#6b7280', 'Информация о проекте', tuFilled ? 'есть' : 'не заполнена')}
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #d7dde5">
        <button type="button" id="pg-open-reports-checks" class="full-btn" style="font-size:11px;padding:4px 8px">📊 Подробный отчёт «Проверки и предупреждения»</button>
      </div>
    </div>`);
  }

  // v0.59.702: запрос на ТУ перенесён сюда (из инспектора utility-источника).
  // Пользователь: «Получение ТУ вынеси в свойства проекта (правый сайдбар)
  // сделай выбор, ТУ по низкой стороне или ТУ по высокой стороне».
  // Кнопка доступна всегда — даже если на схеме ещё нет источника. Внутри
  // модалки можно выбрать ТУ по высокой / низкой стороне (HV / LV) и тогда
  // расчёт берёт данные с соответствующих узлов схемы.
  h.push(`<div class="inspector-section" style="margin-top:12px">
    <h4 style="margin:0 0 6px;font-size:13px">📋 Технические условия (ТУ)</h4>
    <button class="full-btn" id="pg-open-tu-request" style="background:#0c4a6e;color:#fff;font-weight:600">📋 Запрос на ТУ для подачи в РЭС</button>
    <div class="muted" style="font-size:10px;margin-top:4px;line-height:1.4">Документ-обоснование заявленной мощности по проекту. Можно выбрать сторону присоединения (низкая 0.4 кВ или высокая 6/10 кВ) внутри модалки.</div>
  </div>`);

  inspectorBody.innerHTML = h.join('');

  // Handlers
  const bindInput = (id, setter) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      snapshot('page:' + page.id);
      setter(el.value);
      notifyChange();
      // Перерисуем tabs
      if (typeof window !== 'undefined' && typeof window.__raschetRenderPageTabs === 'function') {
        try { window.__raschetRenderPageTabs(); } catch {}
      }
    });
  };
  bindInput('pg-designation', v => { page.designation = String(v).trim(); });
  bindInput('pg-name', v => { page.name = String(v).trim() || page.id; });
  bindInput('pg-sheet', v => { page.sheetNo = String(v).trim(); });
  bindInput('pg-title', v => { page.title = String(v).trim(); });
  bindInput('pg-rev',   v => { page.revision = String(v).trim(); });
  bindInput('pg-desc',  v => { page.description = String(v); });
  // v0.58.10: вид и масштаб страницы
  const pgKind = document.getElementById('pg-kind');
  if (pgKind) {
    pgKind.addEventListener('change', () => {
      snapshot('page-kind:' + page.id);
      const v = pgKind.value;
      if (PAGE_KINDS.includes(v)) page.kind = v;
      notifyChange();
      if (typeof window !== 'undefined' && typeof window.__raschetRenderPageTabs === 'function') {
        try { window.__raschetRenderPageTabs(); } catch {}
      }
      _render();
    });
  }
  const pgScale = document.getElementById('pg-scale');
  if (pgScale) {
    pgScale.addEventListener('change', () => {
      snapshot('page-scale:' + page.id);
      page.scale = pgScale.value;
      notifyChange();
      _render();
    });
  }
  // v0.58.42: сетка/линейки на layout-странице
  const pgShowGrid = document.getElementById('pg-show-grid');
  if (pgShowGrid) {
    pgShowGrid.addEventListener('change', () => {
      // v0.58.44: синхронизируем с глобальным toolbar-тумблером
      GLOBAL.showGrid = pgShowGrid.checked;
      // Обновить opacity кнопки в toolbar
      const gridBtn = document.getElementById('btn-toggle-grid');
      if (gridBtn) gridBtn.style.opacity = GLOBAL.showGrid !== false ? '1' : '0.4';
      _render();
    });
  }
  const pgShowRulers = document.getElementById('pg-show-rulers');
  if (pgShowRulers) {
    pgShowRulers.addEventListener('change', () => {
      snapshot('page-showrulers:' + page.id);
      page.showRulers = pgShowRulers.checked;
      notifyChange();
      _render();
    });
  }

  const typeSel = document.getElementById('pg-type');
  if (typeSel) {
    typeSel.addEventListener('change', () => {
      snapshot('page-type:' + page.id);
      const val = typeSel.value;
      if (val === 'independent') {
        page.type = 'independent';
        delete page.sourcePageId;
      } else if (val.startsWith('linked:')) {
        const parentId = val.substring('linked:'.length);
        page.type = 'linked';
        page.sourcePageId = parentId;
      }
      notifyChange();
      if (typeof window !== 'undefined' && typeof window.__raschetRenderPageTabs === 'function') {
        try { window.__raschetRenderPageTabs(); } catch {}
      }
      _render();
      renderInspector();
    });
  }

  const openProjBtn = document.getElementById('pg-open-project');
  if (openProjBtn && typeof window !== 'undefined' && typeof window.__raschetOpenProjectInfo === 'function') {
    openProjBtn.addEventListener('click', () => window.__raschetOpenProjectInfo());
  }
  // v0.59.702: запрос на ТУ из свойств страницы.
  const tuPgBtn = document.getElementById('pg-open-tu-request');
  if (tuPgBtn) tuPgBtn.addEventListener('click', () => openTuRequestModal(null));
  // v0.59.715: открыть полный отчёт «Проверки и предупреждения».
  const reportsBtn = document.getElementById('pg-open-reports-checks');
  if (reportsBtn && typeof window !== 'undefined' && typeof window.__raschetOpenReports === 'function') {
    reportsBtn.addEventListener('click', () => {
      try { window.__raschetOpenReports('checks'); } catch { window.__raschetOpenReports(); }
    });
  }

  // v0.59.713/714/717: клик по проблемной строке чеклиста — переход к
  // первому проблемному узлу или связи. data-checklist-kind=
  //   'node' (default) → state.nodes + centerOnNode
  //   'conn'           → state.conns + centerOnConn
  inspectorBody.querySelectorAll('[data-checklist-jump]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-checklist-jump');
      if (!id) return;
      const kind = el.getAttribute('data-checklist-kind') || 'node';
      if (kind === 'conn') {
        const c = state.conns.get(id);
        if (!c) return;
        state.selectedKind = 'conn';
        state.selectedId = id;
        try {
          const expMod = await import('./export.js');
          if (expMod && typeof expMod.centerOnConn === 'function') {
            expMod.centerOnConn(c);
          }
        } catch {}
      } else {
        const tgt = state.nodes.get(id);
        if (!tgt) return;
        state.selectedKind = 'node';
        state.selectedId = id;
        try {
          const expMod = await import('./export.js');
          if (expMod && typeof expMod.centerOnNode === 'function') {
            expMod.centerOnNode(tgt);
          }
        } catch {}
      }
      try { _render(); } catch {}
      try { renderInspector(); } catch {}
    });
  });
}

export function renderInspectorNode(n) {
  const h = [];
  // Для зоны — обозначение называется «Префикс зоны» и редактируется в zonePrefix
  if (n.type === 'zone') {
    h.push(field('Префикс зоны', `<input type="text" data-prop="zonePrefix" value="${escAttr(n.zonePrefix || '')}" placeholder="P1">`));
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));
    h.push(field('Ширина, px', `<input type="number" min="200" max="4000" step="40" data-prop="width" value="${n.width || 600}">`));
    h.push(field('Высота, px', `<input type="number" min="120" max="4000" step="40" data-prop="height" value="${n.height || 400}">`));
    // Палитра пастельных цветов (24 swatch). Клик по swatch ставит
    // color в n и пробрасывает на все зоны с тем же effectiveTag.
    {
      const cur = (n.color || '#e3f2fd').toLowerCase();
      const swatches = ZONE_PASTEL_PALETTE.map(c => {
        const sel = c.toLowerCase() === cur;
        return `<button type="button" class="zone-swatch${sel ? ' sel' : ''}" data-zone-color="${c}" style="background:${c}" title="${c}"></button>`;
      }).join('');
      h.push(`<div class="field"><label>Цвет фона</label>
        <div class="zone-palette">${swatches}</div>
        <input type="hidden" data-prop="color" value="${escAttr(n.color || '#e3f2fd')}">
      </div>`);
    }
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
    h.push(field('Комментарии', `<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical">${escHtml(n.comment || '')}</textarea>`));
    h.push(`<button class="full-btn" id="btn-copy-zone" style="margin-top:8px">📋 Копировать зону со всеми элементами</button>`);
    h.push('<button class="btn-delete" id="btn-del-node">Удалить зону</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    // Клики по swatch палитры цвета зоны
    inspectorBody.querySelectorAll('[data-zone-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        snapshot('zone-color:' + n.id);
        const newCol = btn.dataset.zoneColor;
        n.color = newCol;
        // Синхронизация цвета на все зоны с тем же effectiveTag
        _syncZoneByEffectiveTag(n, { color: newCol });
        _render();
        notifyChange();
        renderInspector();
      });
    });
    // Копирование зоны со всеми вложенными элементами
    const copyZoneBtn = document.getElementById('btn-copy-zone');
    if (copyZoneBtn) {
      copyZoneBtn.addEventListener('click', () => {
        snapshot('copy-zone:' + n.id);
        const newId = copyZoneWithMembers(n.id);
        if (newId) {
          state.selectedKind = 'node';
          state.selectedId = newId;
          _render();
          notifyChange();
          renderInspector();
          const newZone = state.nodes.get(newId);
          flash('Зона скопирована: ' + (newZone?.zonePrefix || newId));
        } else {
          flash('Не удалось скопировать зону', 'error');
        }
      });
    }
    return;
  }
  // Channel — только тип и условия среды; материал/изоляция задаются в линиях
  if (n.type === 'channel') {
    h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
    { const eff = effectiveTag(n);
      if (eff && eff !== n.tag) {
        h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное обозначение: <b>${escHtml(eff)}</b></div>`);
      }
    }
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

    h.push(field('Длина канала, м', `<input type="number" min="0" max="10000" step="1" data-prop="lengthM" value="${n.lengthM || 0}">`));
    h.push(checkField('Режим трассы (визуальный канал)', 'trayMode', !!n.trayMode));
    if (n.trayMode) {
      h.push('<div style="display:flex;gap:8px">');
      h.push('<div style="flex:1">' + field('Ширина, px', `<input type="number" min="20" max="200" step="10" data-prop="trayWidth" value="${n.trayWidth || 40}">`) + '</div>');
      h.push('<div style="flex:1">' + field('Длина, px', `<input type="number" min="40" max="1000" step="10" data-prop="trayLength" value="${n.trayLength || 120}">`) + '</div>');
      h.push('<div style="flex:1">' + field('Угол, °', `<input type="number" min="0" max="345" step="15" data-prop="trayAngle" value="${n.trayAngle || 0}">`) + '</div>');
      h.push('</div>');
    }

    // Условия прокладки — единый блок
    const chMethod = n.installMethod || 'B1';
    const imInfo = INSTALL_METHODS[chMethod] || INSTALL_METHODS.B1;
    const bd = n.bundling || imInfo.bundlingDefault || 'touching';
    // Считаем цепи в канале
    let chCircuits = 0;
    for (const c of state.conns.values()) {
      if (!Array.isArray(c.channelIds) || !c.channelIds.includes(n.id)) continue;
      const toN = state.nodes.get(c.to?.nodeId);
      chCircuits += (toN && toN.type === 'consumer' && (Number(toN.count) || 1) > 1) ? Number(toN.count) : 1;
    }
    if (!n.grouping) n.grouping = Math.max(1, chCircuits);
    h.push(buildInstallConditionsBlock(chMethod, bd, n.ambientC || 30, n.grouping || 1, chCircuits, 'PVC', 'data-prop'));

    // Статистика использования канала — считаем и линии, и суммарные цепи
    let lines = 0, circuits = 0;
    const channelConns = [];
    for (const c of state.conns.values()) {
      if (!Array.isArray(c.channelIds) || !c.channelIds.includes(n.id)) continue;
      lines++;
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const par = (toN && toN.type === 'consumer' && (Number(toN.count) || 1) > 1)
        ? Number(toN.count)
        : 1;
      circuits += par;
      channelConns.push({ c, fromN, toN, par });
    }
    h.push(`<div class="inspector-section">` +
      `<div style="display:flex;gap:12px;justify-content:center;margin:8px 0">${channelIconSVG(chMethod, 56)}${bundlingIconSVG(bd, 56)}</div>` +
      `<div class="muted" style="font-size:11px;line-height:1.8">` +
      `Метод прокладки по IEC: <b>${chMethod}</b><br>` +
      `Линий в канале: <b>${lines}</b><br>` +
      `Параллельных цепей (для K_group): <b>${circuits}</b><br>` +
      `</div></div>`);

    // Перечень линий, проходящих через канал — под катом
    if (channelConns.length) {
      h.push('<details class="inspector-section" style="margin-top:8px">');
      h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Линии в канале (${channelConns.length})</summary>`);
      h.push('<div style="font-size:11px;line-height:1.8;margin-top:4px">');
      for (const { c, fromN, toN, par } of channelConns) {
        const fromTag = fromN ? (effectiveTag(fromN) || fromN.name || '?') : '?';
        const toTag = toN ? (effectiveTag(toN) || toN.name || '?') : '?';
        const lineLabel = `${c._isHV ? 'WH' : 'W'}-${fromTag}-${toTag}`;
        const cable = c._cableSize ? `${c._wireCount || '?'}×${c._cableSize} мм²` : '—';
        const current = c._maxA ? `${fmt(c._maxA)} A` : '—';
        const length = c._cableLength != null ? `${c._cableLength} м` : '—';
        const countLabel = par > 1 ? ` (${par} шт.)` : '';
        h.push(`<div style="padding:3px 0;border-bottom:1px solid #eee;display:flex;align-items:center;gap:4px">`);
        h.push(`<div style="flex:1"><b>${escHtml(lineLabel)}</b>${countLabel}<br>`);
        h.push(`<span style="color:#666">${cable} · ${length} · Imax: ${current}</span></div>`);
        h.push(`<button class="ch-line-remove" data-ch-remove-conn="${c.id}" data-ch-remove-ch="${n.id}" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:#999;font-size:14px" title="Убрать из канала">✕</button>`);
        h.push(`</div>`);
      }
      h.push('</div></details>');
    }

    h.push(field('Комментарии', `<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical">${escHtml(n.comment || '')}</textarea>`));
    h.push('<button class="btn-delete" id="btn-del-node">Удалить канал</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    // Кнопки удаления линии из канала
    inspectorBody.querySelectorAll('.ch-line-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const connId = btn.dataset.chRemoveConn;
        const chId = btn.dataset.chRemoveCh;
        const conn = state.conns.get(connId);
        if (conn && Array.isArray(conn.channelIds)) {
          snapshot('ch-remove-line:' + connId);
          conn.channelIds = conn.channelIds.filter(id => id !== chId);
          // Убрать waypoint из центра канала
          const ch = state.nodes.get(chId);
          if (ch && ch.trayMode && Array.isArray(conn.waypoints)) {
            const tw = ch.trayWidth || 40;
            const tl = (ch.trayLength || 120);
            const cx = ch.x + tw / 2;
            const cy = ch.y + tl / 2;
            conn.waypoints = conn.waypoints.filter(wp => Math.hypot(wp.x - cx, wp.y - cy) > 5);
          }
          _render(); renderInspector(); notifyChange();
        }
      });
    });
    return;
  }

  // Phase 2.3 (v0.58.4): вкладки по системам (электрика / габариты)
  // для всех типов кроме zone/channel/conn.
  // v0.58.38: tabs Электрика/Габариты/Системы + по одной вкладке для
  // каждой включённой (не-electrical) системы с параметрами.
  // v0.58.47: новая вкладка «📋 Общее» — tag/name/id + product/configure.
  // v0.60.277 (по запросу Пользователя 2026-05-06 «в текущей парадигме как
  // нам быть с этим блоком (Системы), мы в конструкторе схем оставили
  // только электрику. И электрику не нужно знать, какие еще системы есть
  // в оборудовании. ... При этом все оборудование проекта точно должно
  // отображаться у технолога ЦОД и у администратора и ГИПа со всеми
  // возможными портами»): Конструктор схем = ДИСЦИПЛИНА ЭЛЕКТРИКА.
  //   • Скрываем таб «🧩 Системы» (multi-discipline matter — Tech-workspace).
  //   • Скрываем extra-tabs не-электрических систем (data, plumbing, ...).
  //   • n.systems данные сохраняются — Tech-workspace и др. дисциплинарные
  //     модули продолжают читать/писать.
  //   • Read-only chip-info про другие дисциплины — в renderGeneralPanel.
  const _extraTabsAll = renderExtraSystemTabs(n);
  const _extraTabs = { tabsHtml: '', panelsHtml: '' }; // suppress in electrical-discipline
  // v0.59.886: для контейнера скрываем «Габариты» и «Системы» — их параметры
  // относятся к конкретному физическому экземпляру; контейнер — только
  // организационная обёртка. Пользователь: «габариты и системы не нужно,
  // они указываются только для конкретных потребителей».
  const _isContainer = n.type === 'consumer-container';
  h.push(`<div class="tp-tabs" role="tablist" style="margin-bottom:8px">
    <button type="button" class="tp-tab active" data-tab="general" role="tab">📋 Общее</button>
    <button type="button" class="tp-tab" data-tab="electrical" role="tab">⚡ Электрика</button>
    ${_isContainer ? '' : `<button type="button" class="tp-tab" data-tab="geometry" role="tab">📐 Габариты</button>`}
    ${_extraTabs.tabsHtml}
  </div>`);
  // Вкладка «Общее»
  h.push(`<div class="tp-panel" data-panel="general">`);
  h.push(renderGeneralPanel(n));
  h.push(`</div>`);
  // Вкладка «Электрика» — только электрика (tag/name вынесены в Общее)
  h.push(`<div class="tp-panel" data-panel="electrical" hidden>`);

  if (n.type === 'source' || n.type === 'generator') {
    const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    h.push(field('Тип источника',
      `<select data-prop="sourceSubtype">
        <option value="transformer"${subtype === 'transformer' ? ' selected' : ''}>Трансформатор</option>
        <option value="generator"${subtype === 'generator' ? ' selected' : ''}>Генератор (ДГУ / ДЭС)</option>
        <option value="utility"${subtype === 'utility' ? ' selected' : ''}>Городская сеть (ЛЭП)</option>
        <option value="other"${subtype === 'other' ? ' selected' : ''}>Прочий</option>
      </select>`));
    // Для трансформатора: опциональный вход первичной обмотки
    if (subtype === 'transformer') {
      h.push(`<div class="field check"><input type="checkbox" data-prop="inputs" data-as-bool="1"${(n.inputs | 0) > 0 ? ' checked' : ''}><label>Вход первичной обмотки (подключение к utility)</label></div>`);
      // === Модель из справочника трансформаторов ===
      try {
        const txCat = listTransformers();
        if (txCat.length) {
          h.push('<h4 style="margin:10px 0 4px">Модель из справочника</h4>');
          h.push('<div id="tx-cat-picker-mount" style="margin-bottom:4px"></div>');
          h.push(`<div class="muted" style="font-size:11px;margin-bottom:6px">Паспортные данные (S, U, u<sub>k</sub>, потери, группа) применяются к источнику. Справочник — в <a href="transformer-config/" target="_blank" style="color:#1976d2">«Конфигураторе трансформатора»</a>.</div>`);
        } else {
          h.push(`<div class="muted" style="font-size:11px;margin:6px 0;padding:8px 10px;background:#f6f8fa;border-radius:4px">
            Справочник трансформаторов пуст. Добавьте модели в <a href="transformer-config/" target="_blank" style="color:#1976d2">«Конфигураторе трансформатора»</a>.
          </div>`);
        }
      } catch (e) { /* опционально */ }
    }
    h.push(field('Цвет линии', buildColorPalette(n)));
    // cos φ источника рассчитывается автоматически из downstream нагрузки.
    // Для генератора номинальный cos φ задаётся в параметрах источника.
    // v0.59.661: methodology-aware label + tooltip с аналогами других методик.
    if (n._cosPhi) {
      const _cosT = getTerm('powerFactor', GLOBAL.calcMethod || 'iec');
      const _cosTip = getTermTooltip('powerFactor', GLOBAL.calcMethod || 'iec');
      h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px" title="${escAttr(_cosTip)}">${escHtml(_cosT.label)} (расчётный): <b>${n._cosPhi.toFixed(3)}</b><span style="margin-left:6px;font-size:10px">${escHtml(_cosT.aliases)}</span></div>`);
    }
    // v0.58.49: «В работе» перенесён на вкладку «Общее» (влияет на все системы).

    // Поля только для генератора
    if (subtype === 'generator') {
      h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
      const tgLen = (Array.isArray(n.triggerGroups) && n.triggerGroups.length) ||
        ((Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length) ? 1 : 0);
      h.push(`<button class="full-btn" id="btn-open-automation">⚡ Автоматизация${tgLen ? ` (${tgLen} сценар.)` : ''}</button>`);
      // Собственные нужды — чекбокс и сторона порта
      h.push(checkField('Порт собственных нужд', 'auxInput', !!n.auxInput));
      if (n.auxInput) {
        const side = n.auxInputSide || 'left';
        h.push('<div style="display:flex;gap:8px;margin-bottom:8px">');
        for (const [val, label] of [['left','← Слева'],['right','→ Справа']]) {
          const active = side === val;
          h.push(`<button type="button" data-aux-side="${val}" style="padding:3px 10px;border:1px solid ${active ? '#1976d2' : '#ccc'};background:${active ? '#1976d2' : '#fff'};color:${active ? '#fff' : '#333'};border-radius:4px;cursor:pointer;font-size:11px;font-weight:${active ? '600' : '400'}">${label}</button>`);
        }
        h.push('</div>');
      }
      // v0.59.627/631: режим ДГУ по ISO 8528-1 теперь в «Параметры источника
      // (IEC 60909)» (см. кнопку «🔌 Параметры источника» ниже).
    }

    // Все номинальные параметры (мощность, напряжение, Ssc, Uk%, Xs/Rs) — в модалке
    h.push(`<button class="full-btn" id="btn-open-impedance" style="margin-top:6px">🔌 Параметры источника (IEC 60909)</button>`);
    // v0.59.702: запрос на ТУ перенесён в свойства страницы (правый
    // сайдбар, когда узел не выбран). Пользователь: «Получение ТУ
    // вынеси в свойства проекта (правый сайдбар) сделай выбор, ТУ
    // по низкой стороне или ТУ по высокой стороне».
    // Здесь, у utility-источника, кнопка убрана — чтобы избежать
    // дублирования и центральной точки управления документом.
    // Справка: текущие значения из модалки
    const levels = GLOBAL.voltageLevels || [];
    const outLevel = levels[n.voltageLevelIdx] || null;
    const outLabel = outLevel ? formatVoltageLevelLabel(outLevel) : `${nodeVoltage(n)} В`;
    let voltInfo = `Uвых: <b>${outLabel}</b>`;
    if (subtype === 'transformer' && typeof n.inputVoltageLevelIdx === 'number' && levels[n.inputVoltageLevelIdx]) {
      voltInfo = `Uвх: <b>${formatVoltageLevelLabel(levels[n.inputVoltageLevelIdx])}</b> → Uвых: <b>${outLabel}</b>`;
    }
    // Класс напряжения по IEC 60502-2 — для utility, а также для трансформатора
    // (на первичной и вторичной сторонах).
    const iecBlock = (() => {
      if (subtype === 'utility') {
        return `<br>Класс по IEC 60502-2: <b>${escHtml(cableVoltageClass(nodeVoltage(n)))}</b>`;
      }
      if (subtype === 'transformer' && typeof n.inputVoltageLevelIdx === 'number' && levels[n.inputVoltageLevelIdx]) {
        const Uprim = levels[n.inputVoltageLevelIdx].vLL;
        const Usec = nodeVoltage(n);
        return `<br>IEC 60502-2 первич.: <b>${escHtml(cableVoltageClass(Uprim))}</b>` +
               `<br>IEC 60502-2 вторич.: <b>${escHtml(cableVoltageClass(Usec))}</b>`;
      }
      return `<br>Класс по IEC 60502-2: <b>${escHtml(cableVoltageClass(nodeVoltage(n)))}</b>`;
    })();
    // Snom скрываем для utility (нет номинальной мощности)
    const snomLine = (subtype === 'utility')
      ? ''
      : `Snom: <b>${fmt(n.snomKva || 0)} kVA</b> (${fmt(n.capacityKw || 0)} kW)<br>`;
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px;line-height:1.6">` +
      snomLine +
      voltInfo +
      iecBlock +
      `</div>`);
    // Phase 1.20.39 / 1.20.45: модель резервирования.
    //   • redundancyGroup (строка) — взаимный резерв внутри группы:
    //     «каждый может покрыть нагрузку» → availCap_группы = sum − max.
    //     Пример: 2 трансформатора в группе «T» → avail = мощность одного.
    //   • isBackup — резервный тир (ДГУ при отказе сети): не считается
    //     в нормальной availCap, участвует только в N-1-анализе.
    //   • isStandby — холодный подмен (подменный ДГУ внутри тира):
    //     не считается нигде, кроме как «резерв max(standbyCaps)» в N-1.
    // Сводка по текущей группе резерва (если задана): сколько участников,
    // максимальная единичная мощность, N-1 статус.
    let groupSummaryHtml = '';
    if (n.redundancyGroup && String(n.redundancyGroup).trim() && !n.isBackup && !n.isStandby) {
      const gKey = String(n.redundancyGroup).trim();
      const peers = [];
      for (const m of state.nodes.values()) {
        if ((m.type === 'source' || m.type === 'generator') &&
            !m.isBackup && !m.isStandby &&
            String(m.redundancyGroup || '').trim() === gKey) {
          peers.push(m);
        }
      }
      if (peers.length >= 2) {
        const caps = peers.map(p => Number(p.capacityKw) || 0);
        const sum = caps.reduce((a, b) => a + b, 0);
        const maxC = Math.max(...caps);
        const remaining = sum - maxC;
        groupSummaryHtml = `<div style="font-size:11px;margin-top:4px;padding:4px 6px;background:#e8f5e9;border-left:3px solid #4caf50;border-radius:3px;line-height:1.5">
          🔗 В группе «${gKey}»: <b>${peers.length}×</b> параллельно, взаимный резерв N-1.<br>
          Остаток при отказе одного: <b>${remaining.toFixed(0)} кВт</b> (из ${sum.toFixed(0)}).
        </div>`;
      } else {
        groupSummaryHtml = `<div style="font-size:11px;margin-top:4px;color:#888">
          В группе «${gKey}» пока только этот источник. Задайте ту же группу другому источнику — они будут работать параллельно и резервировать друг друга.
        </div>`;
      }
    }
    // v0.59.703: серые инлайн-блоки про резервирование заменены на helpIcon.
    const _redGroupTip = 'Два и более источников с одинаковой группой → параллельная работа + взаимный резерв (N-1). Каждый участник должен в одиночку выдерживать пиковую нагрузку (на случай отказа другого). Например: 2 трансформатора в группе «T» → доступная мощность = sum − max = мощность одного.';
    const _backupTip = 'Резервный тир (backup) — не участвует в нормальной работе, активируется только при отказе основного источника. Например, ДГУ резервный — стартует при отказе городской сети. Учитывается отдельно при N-1 анализе.';
    const _standbyTip = 'Подменный (cold standby) — холодный резерв, подменяет любой отказавший источник своего тира. Пример: +1 ДГУ к двум рабочим. Не считается в нормальной доступной мощности; вступает в работу только при отказе одного из активных.';
    h.push(`<div class="inspector-section" style="padding:6px 0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:12px;color:#666">Группа резерва:${helpIcon(_redGroupTip)}</span>
        <input type="text" id="src-redundancy-group" value="${n.redundancyGroup ? String(n.redundancyGroup).replace(/"/g, '&quot;') : ''}" placeholder="напр. T, DGU" style="flex:1;padding:2px 6px;font-size:12px;border:1px solid #ccc;border-radius:3px">
      </div>
      ${groupSummaryHtml}
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:6px">
        <input type="checkbox" id="src-is-backup"${n.isBackup ? ' checked' : ''} style="margin:0">
        <span>Резервный тир (backup)${helpIcon(_backupTip)}</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:6px">
        <input type="checkbox" id="src-is-standby"${n.isStandby ? ' checked' : ''} style="margin:0">
        <span>Подменный (cold standby)${helpIcon(_standbyTip)}</span>
      </label>
    </div>`);
    h.push(sourceStatusBlock(n));
  } else if (n.type === 'panel') {
    const isSection = !!n.parentSectionedId;
    const isSectionedContainer = n.switchMode === 'sectioned';
    // Кнопки управления
    if (!isSection) {
      h.push(`<button class="full-btn" id="btn-open-panel-control" style="margin-bottom:4px">🔌 ${isSectionedContainer ? 'Управление многосекционным щитом' : 'Управление щитом'}</button>`);
    }
    h.push(`<button class="full-btn" id="btn-open-panel-params" style="margin-bottom:8px">⚙ Параметры ${isSection ? 'секции' : 'щита'}</button>`);

    // Краткая сводка (не для секционного контейнера — у него всё на секциях)
    const sm = n.switchMode || 'auto';
    if (sm !== 'sectioned') {
      const multiInput = (n.inputs || 1) > 1;
      const smLabel = !multiInput ? '' : ({ auto: 'АВР', manual: 'Ручной', parallel: 'Щит', avr_paired: 'АВР привязка', switchover: 'Подменный', watchdog: 'Watchdog' }[sm] || sm);
      const modeStr = multiInput ? `Режим: <b>${smLabel}</b> · ` : '';
      h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
        `${modeStr}Вх: <b>${n.inputs}</b> · Вых: <b>${n.outputs}</b> · In: <b>${n.capacityA ?? 160} А</b>` +
        `</div>`);
    } else {
      const secCount = Array.isArray(n.sectionIds) ? n.sectionIds.length : 0;
      const tieCount = Array.isArray(n.busTies) ? n.busTies.length : 0;
      h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
        `Многосекционный · ${secCount} секций · ${tieCount} СВ</div>`);
    }

    // Ксим перенесён в параметры щита

    // Шлейф (daisy-chain): определяется автоматически — если на входной
    // порт щита подключено ≥2 линии, щит вместе с peer-щитами по этому
    // порту образует цепочку. Один автомат выше защищает все кабели в
    // цепочке, поэтому сечения подбираются по суммарной нагрузке.
    {
      const chainInputs = [];
      for (let i = 0; i < (n.inputs || 0); i++) {
        let cnt = 0;
        for (const cc of state.conns.values()) if (cc.to.nodeId === n.id && cc.to.port === i) cnt++;
        if (cnt >= 2) chainInputs.push(i + 1);
      }
      if (chainInputs.length) {
        h.push(`<div class="muted" style="font-size:10px;line-height:1.4;margin-top:4px;padding:4px 6px;background:#fef3c7;border-left:3px solid #f59e0b">⛓ Шлейф на вход${chainInputs.length > 1 ? 'ах' : 'е'} ${chainInputs.join(', ')}. Кабели защищены одним автоматом upstream-щита и подбираются по макс. суммарной нагрузке цепочки.</div>`);
      }
    }

    h.push(`<button type="button" class="full-btn" id="btn-balance-panel" style="margin-top:8px">⚖ Балансировка фаз на щите</button>`);
    h.push(panelStatusBlock(n));
  } else if (n.type === 'junction-box') {
    const ch = Array.isArray(n.channels) ? n.channels : [];
    const N = Math.max(1, Number(n.inputs) || ch.length || 2);
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:6px">` +
      `Клеммная коробка N-вход → N-выход. Каждый вход идёт напрямую на свой выход. ` +
      `Перемычки между входами возможны ТОЛЬКО до защитного аппарата.</div>`);
    h.push(field('Каналов (вх=вых)', `<input type="number" min="1" max="32" step="1" data-jb-n value="${N}">`));
    h.push(field('IP', `<input type="text" data-jb-ip value="${(n.ipRating || 'IP54').replace(/"/g,'&quot;')}">`));
    h.push(field('Ток ошиновки, A', `<input type="number" min="1" step="1" data-jb-cap value="${Number(n.capacityA) || 63}">`));
    // Есть ли защита хоть в одном канале → показываем колонку «Вкл»
    const anyProt = ch.some(cc => cc && cc.hasProtection);
    // Maintenance: весь junction-box обесточен
    h.push(`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:6px">` +
      `<input type="checkbox" data-jb-maint${n.maintenance ? ' checked' : ''}>` +
      `<span>🛠 Обслуживание — коробка полностью обесточена</span></label>`);
    // Список каналов: защита да/нет, протип, ток, вкл/выкл
    let tbl = '<div class="inspector-section"><h4>Каналы (вход i → выход i)</h4>';
    tbl += '<table style="width:100%;font-size:11px;border-collapse:collapse">';
    tbl += '<thead><tr><th>#</th><th>Защита</th><th>Тип</th><th>In, A</th>' +
      (anyProt ? '<th title="Состояние защитного аппарата">Вкл</th>' : '') +
      '</tr></thead><tbody>';
    for (let i = 0; i < N; i++) {
      const c = ch[i] || { hasProtection: false, protKind: 'breaker', breakerA: 0, fuseA: 0, closed: true };
      const iA = c.protKind === 'fuse' ? (c.fuseA || 0) : (c.breakerA || 0);
      const isClosed = c.closed !== false; // default: включён
      tbl += `<tr data-jb-row="${i}">` +
        `<td style="text-align:center">${i + 1}</td>` +
        `<td style="text-align:center"><input type="checkbox" data-jb-has="${i}"${c.hasProtection ? ' checked' : ''}></td>` +
        `<td><select data-jb-kind="${i}" ${c.hasProtection ? '' : 'disabled'} style="width:100%"><option value="breaker"${c.protKind !== 'fuse' ? ' selected' : ''}>Автомат</option><option value="fuse"${c.protKind === 'fuse' ? ' selected' : ''}>Предохранитель</option></select></td>` +
        `<td><input type="number" min="0" step="1" data-jb-in="${i}" ${c.hasProtection ? '' : 'disabled'} value="${iA}" style="width:60px"></td>` +
        (anyProt ? `<td style="text-align:center">${c.hasProtection ? `<input type="checkbox" data-jb-closed="${i}"${isClosed ? ' checked' : ''}>` : '<span class="muted">—</span>'}</td>` : '') +
        `</tr>`;
    }
    tbl += '</tbody></table>';
    // Bridges editor (перемычки между входами — только среди каналов без защиты для сторон)
    const br = Array.isArray(n.bridges) ? n.bridges : [];
    tbl += '<div style="margin-top:8px"><b>Перемычки между входами (до защиты):</b></div>';
    if (!br.length) {
      tbl += '<div class="muted" style="font-size:11px;margin:2px 0 4px">Нет</div>';
    } else {
      tbl += '<div style="display:flex;flex-direction:column;gap:2px;margin:2px 0 4px">';
      br.forEach((p, k) => {
        tbl += `<div style="display:flex;gap:4px;align-items:center;font-size:11px">` +
          `<span>${(p[0] | 0) + 1} ⇌ ${(p[1] | 0) + 1}</span>` +
          `<button type="button" data-jb-br-del="${k}" style="padding:1px 6px;font-size:10px;cursor:pointer">✕</button>` +
          `</div>`;
      });
      tbl += '</div>';
    }
    tbl += `<div style="display:flex;gap:4px;align-items:center">` +
      `<input type="number" min="1" max="${N}" step="1" data-jb-br-a placeholder="A" style="width:50px">` +
      `<span>⇌</span>` +
      `<input type="number" min="1" max="${N}" step="1" data-jb-br-b placeholder="B" style="width:50px">` +
      `<button type="button" id="btn-jb-br-add" style="padding:2px 8px;font-size:11px;cursor:pointer">＋ добавить</button>` +
      `</div>`;
    tbl += '</div>';
    h.push(tbl);
    h.push(`<div class="muted" style="font-size:10px;line-height:1.5;margin-top:4px">` +
      `Если у канала <b>есть защита</b> — отходящий кабель подбирается по ней. ` +
      `Если защиты нет — по защите вышестоящего шкафа (вход i). ` +
      `Перемычки объединяют входы в общую шину ДО защиты (на их каналах кабель = max нагрузки).` +
      `</div>`);
    h.push(statusBlock(n));
  } else if (n.type === 'ups') {
    h.push(`<button class="full-btn" id="btn-open-ups-control" style="margin-bottom:4px">🔌 Управление ИБП</button>`);
    h.push(`<button class="full-btn" id="btn-open-ups-battery" style="margin-bottom:4px">🔋 АКБ</button>`);
    h.push(`<button class="full-btn" id="btn-open-ups-params" style="margin-bottom:8px">⚙ Параметры ИБП</button>`);
    h.push(field('Цвет линии', buildColorPalette(n)));
    // Краткая сводка
    const battPct = Math.round(n.batteryChargePct || 0);
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      `Pном: <b>${fmt(n.capacityKw)} kW</b> · КПД: <b>${n.efficiency || 100}%</b> · АКБ: <b>${fmt(n.batteryKwh || 0)} kWh (${battPct}%)</b>` +
      `</div>`);
    // v0.58.49: «В работе» перенесён на вкладку «Общее».
    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(`<button class="full-btn" id="btn-open-consumer-params" style="margin-bottom:8px">⚙ Параметры потребителя</button>`);
    // Расположение входов
    if ((n.inputs || 1) >= 1) {
      const side = n.inputSide || 'top';
      const opts = (n.inputs || 1) <= 1
        ? [['top','↑ Сверху'],['left','← Слева'],['right','→ Справа']]
        : [['top','↑ Сверху'],['left','← Слева'],['right','→ Справа'],['split','↔ По бокам']];
      h.push('<div class="field"><label>Расположение входов</label>');
      h.push('<div style="display:flex;gap:4px;flex-wrap:wrap">');
      for (const [val, label] of opts) {
        const active = side === val;
        h.push(`<button type="button" data-input-side="${val}" style="padding:3px 10px;border:1px solid ${active ? '#1976d2' : '#ccc'};background:${active ? '#1976d2' : '#fff'};color:${active ? '#fff' : '#333'};border-radius:4px;cursor:pointer;font-size:11px;font-weight:${active ? '600' : '400'}">${label}</button>`);
      }
      h.push('</div></div>');
    }
    // Краткая сводка
    const cnt = Math.max(1, n.count || 1);
    const ph = n.phase || '3ph';
    const phLabel = ph === '3ph' ? '3Ф' : ph;
    // v0.59.661: methodology-aware короткие обозначения в сводной строке.
    const _mid = GLOBAL.calcMethod || 'iec';
    const _cosShort = getTerm('powerFactor', _mid).short || 'cos φ';
    const _kuShort = getTerm('utilization', _mid).short || 'Ки';
    const _kuTip = getTermTooltip('utilization', _mid);
    const _cosTip = getTermTooltip('powerFactor', _mid);
    const _kuPart = isTermUsed('utilization', _mid)
      ? ` · <span title="${escAttr(_kuTip)}">${escHtml(_kuShort)}: <b>${(n.kUse ?? 1).toFixed(2)}</b></span>`
      : '';
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      (cnt > 1 ? `Группа: <b>${cnt} × ${fmt(n.demandKw)} kW = ${fmt(cnt * (n.demandKw || 0))} kW</b>` : `P: <b>${fmt(n.demandKw)} kW</b>`) +
      ` · ${phLabel} · <span title="${escAttr(_cosTip)}">${escHtml(_cosShort)}: <b>${(n.cosPhi ?? 0.92).toFixed(2)}</b></span>` +
      _kuPart +
      `</div>`);

    // Фаза — только для однофазных потребителей
    if (ph !== '3ph') {
      h.push('<div class="field"><label>Фаза</label>');
      h.push('<div style="display:flex;gap:4px;flex-wrap:wrap">');
      const phases = [
        { val: '3ph', label: '3Ф' },
        { val: 'A', label: 'A' },
        { val: 'B', label: 'B' },
        { val: 'C', label: 'C' },
      ];
      for (const p of phases) {
        const active = ph === p.val;
        h.push(`<button type="button" data-phase-btn="${p.val}" style="padding:4px 12px;border:1px solid ${active ? '#1976d2' : '#ccc'};background:${active ? '#1976d2' : '#fff'};color:${active ? '#fff' : '#333'};border-radius:4px;cursor:pointer;font-size:12px;font-weight:${active ? '600' : '400'}">${p.label}</button>`);
      }
      h.push(`<button type="button" id="btn-auto-phase" style="padding:4px 12px;border:1px dashed #999;background:#f5f5f5;border-radius:4px;cursor:pointer;font-size:11px" title="Наименее нагруженная фаза">Авто</button>`);
      h.push('</div></div>');
    }

    h.push(consumerCurrentsBlock(n));
    // Множитель нагрузки — только в активном сценарии
    if (state.activeModeId) {
      const lf = effectiveLoadFactor(n);
      h.push('<div class="inspector-section"><h4>В текущем сценарии</h4>');
      h.push(field('Множитель нагрузки (0–3)', `<input type="number" min="0" max="3" step="0.05" data-loadfactor value="${lf}">`));
      h.push(`<div class="muted" style="font-size:11px;margin-top:-4px">1.0 = номинал, 0.5 = 50%, 0 = выключено.</div>`);
      h.push('</div>');
    }
    h.push(statusBlock(n));
  } else if (n.type === 'consumer-container') {
    // v0.59.822 (1.28.20 Phase 4): полный инспектор contaier-узла.
    // v0.59.885: добавлены «Расположение входов» и «Расчётные величины»
    // (через consumerCurrentsBlock + inputSide buttons) — пользователь:
    // «и сторону подключения тоже добавь для группы, сделай один в один».
    // inputSide (top/left/right/split) — наследуется от consumer.
    {
      const inputSide = n.inputSide || 'top';
      h.push('<div class="inspector-section"><h4>Расположение входов</h4>');
      h.push('<div style="display:flex;gap:6px;flex-wrap:wrap">');
      const _sideBtn = (val, label) => `<button type="button" class="cside-btn${inputSide === val ? ' active' : ''}" data-input-side="${val}" style="padding:4px 10px;font-size:11px;border:1px solid ${inputSide === val ? '#2563eb' : '#cbd5e1'};background:${inputSide === val ? '#dbeafe' : '#fff'};color:${inputSide === val ? '#1e40af' : '#475569'};border-radius:4px;cursor:pointer;font-weight:${inputSide === val ? '600' : '400'}">${label}</button>`;
      h.push(_sideBtn('top', '↑ Сверху'));
      h.push(_sideBtn('left', '← Слева'));
      h.push(_sideBtn('right', '→ Справа'));
      h.push(_sideBtn('split', '↔ По бокам'));
      h.push('</div></div>');
    }
    // Расчётные величины (агрегированные через consumerCurrentsBlock).
    h.push(consumerCurrentsBlock(n));
    // v0.59.883: предупреждение если параметры членов разнородны.
    try {
      const _homo = containerHomogeneity(n);
      if (!_homo.homogeneous && _homo.mismatches && _homo.mismatches.length) {
        const _LABELS = {
          demandKw: 'Pуст (мощность)',
          cosPhi:   'cos φ',
          voltage:  'напряжение',
          phase:    'фаза',
          kUse:     'Ки',
        };
        const list = _homo.mismatches.map(m => _LABELS[m] || m).join(', ');
        h.push(`<div class="inspector-section"><div style="font-size:11px;padding:6px 8px;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;color:#78350f;line-height:1.5">
          ⚠ <b>Расхождение параметров членов группы:</b> ${escHtml(list)}.<br>
          <span style="opacity:0.85">Для однородной нагрузки автомат и кабель подбираются по группе. При расхождении — каждый член должен иметь свою защиту.</span>
        </div></div>`);
      }
    } catch {}
    // v0.59.887: блок «список slot'ов» переехал в Общее (renderGeneralPanel).
    // Здесь во вкладке «Электрика» оставлены только электрические данные:
    // Расположение входов, Расчётные величины, ⚠ предупреждение.
    // Кнопки управления составом ➕/⇆ — тоже в Общем, под списком slot'ов.
  }

  // v0.58.49: подсказка про режим «В работе» перенесена на вкладку «Общее».

  // v0.58.47: комментарии перенесены на вкладку «Общее».

  // Кнопка сохранения элемента в пользовательскую библиотеку
  if (n.type !== 'zone') {
    h.push('<button id="btn-save-preset" class="full-btn" style="margin-top:10px">★ Сохранить в библиотеку</button>');
  }
  h.push('<button class="btn-delete" id="btn-del-node">Удалить элемент</button>');

  // === Страницы, на которых показан элемент ===
  // Показываем только home-страницу узла + linked-страницы того же родителя.
  // Независимые страницы НЕ могут обмениваться узлами — только через ссылочную.
  {
    const allowed = pagesForNode(n);
    if (allowed.length > 1) {
      const curPids = Array.isArray(n.pageIds) ? n.pageIds : (state.currentPageId ? [state.currentPageId] : []);
      h.push('<div class="inspector-section"><h4>Страницы</h4>');
      h.push('<div style="font-size:11px;color:#546e7a;margin-bottom:4px">Отметьте ссылочные страницы, на которых виден этот узел. Home (независимая) — обязательна.</div>');
      for (const p of allowed) {
        const checked = curPids.includes(p.id);
        const isHome = p.type !== 'linked';
        const disabled = isHome ? ' disabled' : '';
        h.push(`<div class="field check"><input type="checkbox" data-page-id="${escAttr(p.id)}"${checked ? ' checked' : ''}${disabled}><label>${escHtml(p.name || p.id)}${isHome ? ' <span class="muted" style="font-size:10px">(home)</span>' : ' <span class="muted" style="font-size:10px">(ссыл.)</span>'}</label></div>`);
      }
      h.push('</div>');
    }
  }

  // Полный дамп параметров узла — в электрической вкладке
  h.push(renderFullPropsBlock(n));
  h.push(`</div>`); // /panel electrical

  // Phase 2.3 (v0.58.4): вкладка «Габариты» — доступна для любых типов,
  // не только на layout-странице. Если в каталоге нет размеров — показываем
  // пустые поля для ручного override (n.geometryMm).
  h.push(`<div class="tp-panel" data-panel="geometry" hidden>`);
  if (n.type === 'zone') {
    h.push('<div class="muted" style="font-size:11px">Габариты зоны задаются шириной/высотой в px на вкладке «Электрика».</div>');
  } else {
    h.push(renderGeometryMmBlock(n));
  }
  h.push(`</div>`); // /panel geometry

  // v0.58.15 / v0.60.277: вкладка «Системы» удалена из Конструктора схем.
  // Конструктор = дисциплина «электрика»; multi-discipline systems
  // редактируются в Tech-workspace. n.systems данные сохраняются.
  // Панели extra-tabs (data/plumbing/...) тоже скрыты.

  inspectorBody.innerHTML = h.join('');
  wireSystemsBlock(n, inspectorBody);

  // Tab switching
  inspectorBody.querySelectorAll('.tp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      _activeTabByNode.set(n.id, tab);  // v0.58.55: запомнить вкладку
      inspectorBody.querySelectorAll('.tp-tab').forEach(t => t.classList.toggle('active', t === btn));
      inspectorBody.querySelectorAll('.tp-panel').forEach(p => {
        p.hidden = p.dataset.panel !== tab;
      });
    });
  });
  // v0.58.55: после re-render (например, из-за change в инпуте) — восстановить
  // ранее активную вкладку, чтобы пользователь не «выпадал» в Общее.
  const savedTab = _activeTabByNode.get(n.id);
  if (savedTab && savedTab !== 'general') {
    const btn = inspectorBody.querySelector(`.tp-tab[data-tab="${savedTab}"]`);
    if (btn) {
      inspectorBody.querySelectorAll('.tp-tab').forEach(t => t.classList.toggle('active', t === btn));
      inspectorBody.querySelectorAll('.tp-panel').forEach(p => {
        p.hidden = p.dataset.panel !== savedTab;
      });
    }
  }

  // Монтируем каскадный пикер трансформаторов (если узел — источник-
  // трансформатор и справочник не пуст).
  try {
    if ((n.type === 'source' || n.type === 'generator') &&
        (n.sourceSubtype || 'transformer') === 'transformer') {
      const txMount = document.getElementById('tx-cat-picker-mount');
      const txCat = listTransformers();
      if (txMount && txCat.length) {
        mountTransformerPicker(txMount, {
          list: txCat,
          selectedId: n.transformerCatalogId || null,
          currentSupplier: n._txSelSupplier || '',
          currentSeries: n._txSelSeries || '',
          placeholders: { supplier: '— не выбрано —', series: '— не выбрано —', model: '— не выбрано —' },
          labels: { supplier: 'Производитель', series: 'Серия', model: 'Типоразмер' },
          idPrefix: 'tx-cat',
          onChange: (st) => {
            n._txSelSupplier = st.supplier || null;
            n._txSelSeries = st.series || null;
            if (st.modelId && st.transformer && st.modelId !== n.transformerCatalogId) {
              snapshot('source-params:' + n.id + ':tx-catalog');
              applyTransformerModel(n, st.transformer);
              _render(); notifyChange();
              renderInspector();
            } else if (!st.modelId && n.transformerCatalogId) {
              n.transformerCatalogId = null;
              renderInspector();
            }
          },
        });
      }
    }
  } catch (e) { /* опционально */ }

  // Обработчики чекбоксов страниц
  inspectorBody.querySelectorAll('[data-page-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      snapshot('node-pages:' + n.id);
      const pid = cb.dataset.pageId;
      let pids = Array.isArray(n.pageIds) ? n.pageIds.slice() : (state.currentPageId ? [state.currentPageId] : []);
      if (cb.checked) {
        if (!pids.includes(pid)) pids.push(pid);
      } else {
        pids = pids.filter(x => x !== pid);
        if (pids.length === 0) {
          // Нельзя убрать со всех страниц — вернём текущую
          pids = [state.currentPageId];
          cb.checked = true;
          flash('Нельзя убрать узел со всех страниц. Удалите узел целиком или оставьте минимум одну.');
        }
      }
      n.pageIds = pids;
      notifyChange();
      _render();
      renderInspector();
    });
  });

  wireInspectorInputs(n);
  // Phase 2.3: wire для полей override габаритов (если секция отрисована)
  if (document.querySelector('[data-geom-prop]')) wireGeometryMmBlock(n);
  if (document.querySelector('[data-lc-prop]')) wireLayoutColorBlock(n);

  const saveBtn = document.getElementById('btn-save-preset');
  if (saveBtn) saveBtn.addEventListener('click', () => saveNodeAsPreset(n));

  // v0.59.822 (1.28.20 Phase 4): wire для consumer-container slot-actions.
  if (n.type === 'consumer-container') {
    _wireContainerSlots(n);
    const openBtn = document.getElementById('btn-open-container-members');
    if (openBtn) openBtn.addEventListener('click', () => openContainerMembersModal(n));
    // v0.59.886: вторая такая же кнопка из вкладки «Общее».
    const openBtnGen = document.getElementById('btn-open-container-members-general');
    if (openBtnGen) openBtnGen.addEventListener('click', () => openContainerMembersModal(n));
    // v0.59.886: input-side кнопки для контейнера (Расположение входов).
    document.querySelectorAll('button.cside-btn[data-input-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        const side = btn.dataset.inputSide;
        if (!side) return;
        n.inputSide = side;
        try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); window.Raschet?.renderInspector?.(); } catch {}
      });
    });
  }
}

// v0.59.825 (1.28.20 Phase 8): модалка состава контейнера. По двойному
// клику на контейнере на canvas (или из инспектора) — открывает список
// карточек членов (как обычные consumer-карточки в инспекторе).
// v0.59.884: переключение видов (карточки / таблица) в модалке состава контейнера.
// Пользователь: «для этого окна нужно еще одно представление в форме таблицы
// для быстрого изменения параметра всех потребителей». Persistence в LS.
let _containerMembersView = (() => {
  try { return localStorage.getItem('raschet.container-members.view.v1') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
})();
let _containerMembersTableFilter = { search: '', subtype: '', phase: '', powered: '' };
let _containerMembersSelected = new Set(); // bulk-edit selection (node ids)
// v0.60.239 (по запросу Пользователя 2026-05-05 «для таблицы добавь фильтры
// и возможность настройки отображаемых полей и пресеты, а то номинальная
// мощность видна, а расчетная нет»): per-column visibility + presets.
const _CM_TABLE_COLUMNS = [
  { id: 'tag',        label: 'Tag',          default: true,  required: true },
  { id: 'name',       label: 'Имя',          default: true },
  { id: 'subtype',    label: 'Подтип',       default: true },
  { id: 'pNom',       label: 'P_ном (кВт)',  default: true },
  { id: 'iNom',       label: 'I_ном (А)',    default: false },
  { id: 'pCalc',      label: 'P_расч (кВт)', default: true },
  { id: 'iCalc',      label: 'I_расч (А)',   default: false },
  { id: 'cos',        label: 'cos φ',        default: true },
  { id: 'phase',      label: 'Фаза',         default: true },
  { id: 'voltage',    label: 'U (В)',        default: true },
  { id: 'ku',         label: 'К_и',          default: true },
  { id: 'inputs',     label: 'Входы',        default: false },
  { id: 'priorities', label: 'Приоритеты',   default: false },
  { id: 'status',     label: 'Статус',       default: false },
];
const _CM_LS_COLS = 'raschet.container-members.cols.v1';
const _CM_LS_PRESETS = 'raschet.container-members.presets.v1';
const _CM_LS_PRESET_ID = 'raschet.container-members.preset-id.v1';
let _containerMembersCols = (() => {
  try {
    const raw = localStorage.getItem(_CM_LS_COLS);
    if (raw) return { ...Object.fromEntries(_CM_TABLE_COLUMNS.map(c => [c.id, c.default])), ...JSON.parse(raw) };
  } catch {}
  return Object.fromEntries(_CM_TABLE_COLUMNS.map(c => [c.id, c.default]));
})();
function _saveCmCols() {
  try { localStorage.setItem(_CM_LS_COLS, JSON.stringify(_containerMembersCols)); } catch {}
}
function _loadCmPresets() {
  try {
    const raw = localStorage.getItem(_CM_LS_PRESETS);
    if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) return p; }
  } catch {}
  // Default presets.
  return [
    { id: 'minimal', label: 'Минимум', cols: { tag: true, name: true, pNom: true, ku: true } },
    { id: 'design',  label: 'Расчётный', cols: { tag: true, name: true, subtype: true, pNom: true, pCalc: true, iCalc: true, cos: true, phase: true, ku: true } },
    { id: 'topology', label: 'Топология', cols: { tag: true, name: true, inputs: true, priorities: true, status: true, pCalc: true } },
    { id: 'full',    label: 'Все', cols: Object.fromEntries(_CM_TABLE_COLUMNS.map(c => [c.id, true])) },
  ];
}
function _saveCmPresets(presets) {
  try { localStorage.setItem(_CM_LS_PRESETS, JSON.stringify(presets)); } catch {}
}
function _applyCmPreset(presetId) {
  const presets = _loadCmPresets();
  const p = presets.find(x => x.id === presetId);
  if (!p) return;
  // Reset to all-false, then set true per preset cols.
  const next = Object.fromEntries(_CM_TABLE_COLUMNS.map(c => [c.id, false]));
  // Required cols always on.
  for (const c of _CM_TABLE_COLUMNS) if (c.required) next[c.id] = true;
  for (const k of Object.keys(p.cols || {})) if (p.cols[k]) next[k] = true;
  _containerMembersCols = next;
  _saveCmCols();
  try { localStorage.setItem(_CM_LS_PRESET_ID, presetId); } catch {}
}

export function openContainerMembersModal(container) {
  if (!container || container.type !== 'consumer-container') return;
  const modal = document.getElementById('modal-container-members');
  const body = document.getElementById('container-members-body');
  const title = document.getElementById('container-members-title');
  if (!modal || !body) return;
  // v0.60.345: kit-mode (Сборка) удалён. Только обычная Группа.
  if (title) title.textContent = `Состав контейнера ${effectiveTag(container) || ''}`;
  const slots = Array.isArray(container.slots) ? container.slots : [];
  const h = [];
  // Σ-подсводка + per-member powered-state (для Kit-сборок с разными ATS).
  let totalKw = 0, linkedCount = 0, phCount = 0;
  // v0.60.255: считаем сколько членов с inputs>1 (multi-input/ATS) — для info-чипа.
  let multiInputCount = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.kind === 'linked' && s.nodeId) {
      const a = state.nodes.get(s.nodeId);
      if (a) {
        totalKw += (Number(a.demandKw) || 0) * Math.max(1, Number(a.count) || 1);
        linkedCount++;
        if ((Number(a.inputs) || 1) > 1) multiInputCount++;
      }
    } else if (s.kind === 'placeholder') {
      totalKw += Number(s.demandKw) || 0; phCount++;
    }
  }
  h.push(`<div style="padding:8px 12px;background:#f5f7fa;border-bottom:1px solid #e0e7ee;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <span>Σ <b>${totalKw.toFixed(2)} кВт</b> · реальных потребителей: <b>${linkedCount}</b> · placeholder-слотов: <b>${phCount}</b>${multiInputCount > 0 ? ` · <span title="Сколько членов имеют > 1 входа (multi-input / ATS).">с ATS / multi-input: <b>${multiInputCount}</b></span>` : ''}</span>
    <span style="display:inline-flex;gap:4px">
      <button type="button" class="cm-view-toggle" data-view="cards" style="padding:4px 10px;font-size:11px;border:1px solid #cbd5e1;background:${_containerMembersView === 'cards' ? '#dbeafe' : '#fff'};color:${_containerMembersView === 'cards' ? '#1e40af' : '#64748b'};border-radius:4px;cursor:pointer;font-weight:${_containerMembersView === 'cards' ? '600' : '400'}" title="Карточный вид (компактный обзор)">📋 Карточки</button>
      <button type="button" class="cm-view-toggle" data-view="table" style="padding:4px 10px;font-size:11px;border:1px solid #cbd5e1;background:${_containerMembersView === 'table' ? '#dbeafe' : '#fff'};color:${_containerMembersView === 'table' ? '#1e40af' : '#64748b'};border-radius:4px;cursor:pointer;font-weight:${_containerMembersView === 'table' ? '600' : '400'}" title="Табличный вид с фильтрами и групповым редактированием">📊 Таблица</button>
    </span>
  </div>`);
  // v0.60.255: kitMode toggle + контекстный banner.
  // По запросу Пользователя 2026-05-05 «реализация позволит учитывать
  // отдельно кондиционер, отдельно наружный блок, отдельно кабель между
  // кондиционеров и наружным блоком и все это для лаконичности на схеме
  // обернуть так чтобы группа содержала сколько угодно экземпляров внутри
  // и при этом отображалась как 2 устройства».
  // По уточнению Пользователя 2026-05-06 «у кондиционеров с ATS активный
  // только один ввод, но в группе могут быть разные вводы активны, это
  // нужно учитывать» — ATS активный вход тракторируется per-member
  // (recalc.activeInputs работает per-узел), Σ powered считается отдельно
  // для каждого slot-узла; в банере показано info-напоминание.
  // v0.60.345 (по репорту Пользователя 2026-05-06: «не сработала твоя идея,
  // связей между элементами нет, подключение не работает, лучше как я
  // описал... группу как Сборка удаляем из программы»): kit-mode (Сборка)
  // удалён как UI-режим. Группы только однотипные. Outdoor-блоки делаются
  // через modal-button в карточке кондиционера (отдельный refactor).
  // v0.60.361 (по репорту Пользователя 2026-05-06: «это не нужно. Нужно
  // определять состояния АВР в групповых потребителях а не в группе, у
  // группы убери»): UI селектор приоритетов контейнера (v0.60.360) удалён.
  // АВР теперь работает per-член — recalc.js эвалуирует priorities каждого
  // multi-input child'а независимо (см. v0.60.361 в recalc.js).
  h.push(`<div style="padding:8px 12px;border-bottom:1px solid #e0e7ee;background:#fff;font-size:12px;color:#64748b;font-style:italic">
    Группа однотипных потребителей с общим питающим кабелем. Для cond+outdoor — открывайте карточку кондиционера, там кнопка «🔧 Наружный блок». АВР работает <b>per-член</b>: каждый потребитель с multi-input независимо выбирает свой приоритетный вход (см. строку «Входы» в карточке члена).
  </div>`);
  // v0.60.378 (по репорту Пользователя 2026-05-06: «не нашел в карточке
  // группы селектора режима резервирования»): селектор режима для
  // container'а (как для consumer в v0.60.375). Применяется к group через
  // container.consumerReserveR + redundancyStandbyType. Влияет на
  // consumerTotalDemandKw для container (electrical.js).
  {
    const _slotCount = slots.filter(s => s && (s.kind === 'linked' || s.kind === 'placeholder')).length;
    if (_slotCount >= 2) {
      const _curR = Math.max(0, Math.min(_slotCount - 1, Number(container.consumerReserveR) || 0));
      let _curMode = 'N';
      if (_curR === 0) _curMode = 'N';
      else if (_curR === 1) _curMode = 'N+1';
      else if (_curR === 2 && _slotCount >= 3) _curMode = 'N+2';
      else if (_curR * 2 === _slotCount) _curMode = '2N';
      else _curMode = 'custom';
      const _N = _slotCount - _curR;
      const _standbyType = String(container.redundancyStandbyType || 'cold');
      h.push(`<div style="padding:8px 12px;border-bottom:1px solid #e0e7ee;background:#f0fdfa;font-size:12px;display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <span><b>Режим резервирования группы:</b></span>
        <select id="cm-cont-redundancyMode" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:3px">
          <option value="N"${_curMode === 'N' ? ' selected' : ''}>N (все ${_slotCount} активны)</option>
          <option value="N+1"${_curMode === 'N+1' ? ' selected' : ''}${_slotCount < 2 ? ' disabled' : ''}>N+1 (активны ${_slotCount - 1})</option>
          <option value="N+2"${_curMode === 'N+2' ? ' selected' : ''}${_slotCount < 3 ? ' disabled' : ''}>N+2 (активны ${_slotCount - 2})</option>
          <option value="2N"${_curMode === '2N' ? ' selected' : ''}${(_slotCount % 2 !== 0 || _slotCount < 2) ? ' disabled' : ''}>2N (${_slotCount / 2} акт.+${_slotCount / 2} рез.)</option>
          <option value="custom"${_curMode === 'custom' ? ' selected' : ''}>Custom (R = ${_curR})</option>
        </select>
        ${_curR > 0 ? `<span><b>Тип:</b></span>
          <select id="cm-cont-standbyType" style="font:inherit;font-size:12px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:3px" title="Холодный — резерв ОТКЛЮЧЁН (АВР). Горячий — все count работают на ${(_N / _slotCount * 100).toFixed(0)}%, load-sharing.">
            <option value="cold"${_standbyType === 'cold' ? ' selected' : ''}>❄ Холодный</option>
            <option value="hot"${_standbyType === 'hot' ? ' selected' : ''}>🔥 Горячий</option>
          </select>` : ''}
        <span style="font-size:10.5px;color:#64748b">Активные N=<b>${_N}</b> · Резерв R=<b>${_curR}</b> · Всего ${_slotCount}</span>
      </div>`);
    }
  }
  if (!slots.length) {
    h.push('<div style="padding:24px;text-align:center;color:#778899">Контейнер пуст. Drop потребителя на канвасе сюда — добавится.</div>');
  } else {
    // v0.59.840: сортировка по обозначению (natural sort) — placeholders в конец.
    const _sortedM = slots.map((s, i) => {
      let _key = '￿';
      if (s && s.kind === 'linked' && s.nodeId) {
        const a = state.nodes.get(s.nodeId);
        if (a && a.tag) _key = String(a.tag);
      }
      return { s, i, key: _key };
    });
    _sortedM.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));
    if (_containerMembersView === 'table') {
      // v0.59.884: табличный вид. Filter row + select-all + bulk-edit toolbar.
      const flt = _containerMembersTableFilter;
      const subtypes = new Set();
      const phases = new Set();
      _sortedM.forEach(e => {
        if (e.s.kind === 'linked' && e.s.nodeId) {
          const a = state.nodes.get(e.s.nodeId);
          if (a) {
            subtypes.add(a.consumerSubtype || 'custom');
            phases.add(a.phase || '3ph');
          }
        } else if (e.s.kind === 'placeholder') {
          subtypes.add(e.s.subtype || 'custom');
          phases.add(e.s.phase || '3ph');
        }
      });
      const matchesFilter = (s) => {
        if (s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (!a) return false;
          if (flt.search) {
            const hay = `${a.tag || ''} ${a.name || ''} ${a.consumerSubtype || ''}`.toLowerCase();
            if (!hay.includes(flt.search.toLowerCase())) return false;
          }
          if (flt.subtype && (a.consumerSubtype || 'custom') !== flt.subtype) return false;
          if (flt.phase && (a.phase || '3ph') !== flt.phase) return false;
          // v0.60.239: фильтр по статусу.
          if (flt.powered) {
            const isPow = !!a._powered;
            const isOver = !!a._overload;
            if (flt.powered === 'powered' && !(isPow && !isOver)) return false;
            if (flt.powered === 'overload' && !isOver) return false;
            if (flt.powered === 'unpowered' && isPow) return false;
          }
          return true;
        } else if (s.kind === 'placeholder') {
          if (flt.search) {
            const hay = `${s.subtype || ''}`.toLowerCase();
            if (!hay.includes(flt.search.toLowerCase())) return false;
          }
          if (flt.subtype && (s.subtype || 'custom') !== flt.subtype) return false;
          if (flt.phase && (s.phase || '3ph') !== flt.phase) return false;
          if (flt.powered) return false; // placeholder не имеет powered-state
          return true;
        }
        return false;
      };
      const filteredM = _sortedM.filter(e => matchesFilter(e.s));
      // Очистим selection от удалённых ids
      for (const id of Array.from(_containerMembersSelected)) {
        const stillExists = filteredM.some(e => e.s.kind === 'linked' && e.s.nodeId === id);
        if (!stillExists) _containerMembersSelected.delete(id);
      }
      const selCount = _containerMembersSelected.size;
      // Filter row + bulk toolbar
      h.push('<div style="padding:8px 12px;border-bottom:1px solid #e0e7ee;background:#fafbfc;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px">');
      h.push(`<input type="search" id="cm-table-search" placeholder="🔍 поиск по имени/тегу/типу" value="${escAttr(flt.search)}" style="padding:4px 8px;font-size:12px;border:1px solid #cbd5e1;border-radius:3px;width:200px">`);
      h.push(`<select id="cm-table-subtype" title="Подтип"><option value="">все типы</option>${[...subtypes].sort().map(s => `<option value="${escAttr(s)}" ${flt.subtype === s ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}</select>`);
      h.push(`<select id="cm-table-phase" title="Фаза"><option value="">все фазы</option>${[...phases].sort().map(p => `<option value="${escAttr(p)}" ${flt.phase === p ? 'selected' : ''}>${escHtml(p)}</option>`).join('')}</select>`);
      // v0.60.239: фильтр по статусу.
      h.push(`<select id="cm-table-powered" title="Статус питания">
        <option value="">все статусы</option>
        <option value="powered"   ${flt.powered === 'powered' ? 'selected' : ''}>⚡ запитан</option>
        <option value="overload"  ${flt.powered === 'overload' ? 'selected' : ''}>⚠ перегруз</option>
        <option value="unpowered" ${flt.powered === 'unpowered' ? 'selected' : ''}>○ без питания</option>
      </select>`);
      // v0.60.239: пресеты + колонки.
      const _curPresetId = (() => { try { return localStorage.getItem(_CM_LS_PRESET_ID) || ''; } catch { return ''; } })();
      const _presetsList = _loadCmPresets();
      h.push(`<select id="cm-table-preset" title="Пресет колонок">
        <option value="">— пресет —</option>
        ${_presetsList.map(p => `<option value="${escAttr(p.id)}" ${_curPresetId === p.id ? 'selected' : ''}>${escHtml(p.label)}</option>`).join('')}
      </select>`);
      h.push(`<button type="button" id="cm-table-cols" title="Настроить видимость колонок" style="padding:3px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer">⚙ Колонки</button>`);
      if (flt.search || flt.subtype || flt.phase || flt.powered) {
        h.push(`<button type="button" id="cm-table-reset" style="padding:3px 8px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer">× сброс</button>`);
      }
      h.push(`<span class="muted" style="margin-left:auto">Показано: ${filteredM.length} из ${_sortedM.length}</span>`);
      h.push('</div>');
      // v0.60.239: popover с чекбоксами видимости колонок (initially hidden).
      h.push(`<div id="cm-cols-popover" style="display:none;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e0e7ee;font-size:12px">
        <div style="display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center">
          ${_CM_TABLE_COLUMNS.map(c => `
            <label style="display:flex;align-items:center;gap:4px;${c.required ? 'opacity:0.6' : 'cursor:pointer'}">
              <input type="checkbox" data-cm-col="${escAttr(c.id)}" ${_containerMembersCols[c.id] ? 'checked' : ''} ${c.required ? 'disabled' : ''}>
              <span>${escHtml(c.label)}</span>
            </label>
          `).join('')}
        </div>
      </div>`);
      // Bulk-edit toolbar (если что-то выделено)
      if (selCount > 0) {
        h.push(`<div style="padding:8px 12px;background:#eff6ff;border-bottom:1px solid #bfdbfe;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px">
          <b style="color:#1e3a8a">Выделено: ${selCount}</b>
          <span style="margin-left:8px">Применить ко всем выделенным:</span>
          <label>P (кВт): <input type="number" id="cm-bulk-kw" min="0" step="0.5" style="width:80px;padding:2px 4px;font-size:11px;border:1px solid #cbd5e1;border-radius:3px"></label>
          <label>cos φ: <input type="number" id="cm-bulk-cos" min="0.1" max="1" step="0.01" style="width:70px;padding:2px 4px;font-size:11px;border:1px solid #cbd5e1;border-radius:3px"></label>
          <label>Фаза: <select id="cm-bulk-phase" style="font-size:11px;padding:2px 4px;border:1px solid #cbd5e1;border-radius:3px"><option value="">—</option><option value="1ph">1ph</option><option value="3ph">3ph</option></select></label>
          <label>U (В): <input type="number" id="cm-bulk-voltage" min="0" step="10" style="width:70px;padding:2px 4px;font-size:11px;border:1px solid #cbd5e1;border-radius:3px"></label>
          <button type="button" id="cm-bulk-apply" style="padding:4px 10px;font-size:11px;border:1px solid #2563eb;background:#dbeafe;color:#1e40af;border-radius:3px;cursor:pointer;font-weight:500">✓ Применить</button>
          <button type="button" id="cm-bulk-clear" style="padding:4px 10px;font-size:11px;border:1px solid #cbd5e1;background:#fff;border-radius:3px;cursor:pointer">✕ снять</button>
        </div>`);
      }
      // Table
      // v0.60.239: column visibility helper.
      const _colVis = _containerMembersCols;
      const _ifCol = (id, html) => _colVis[id] ? html : '';
      h.push('<div style="max-height:60vh;overflow-y:auto;padding:0">');
      h.push('<table class="cm-table" style="width:100%;border-collapse:collapse;font-size:12px">');
      h.push(`<thead style="background:#f1f5f9;position:sticky;top:0;z-index:1">
        <tr>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1;width:30px"><input type="checkbox" id="cm-table-selectall" title="Выделить всё видимое"></th>
          ${_ifCol('tag',        '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1">Tag</th>')}
          ${_ifCol('name',       '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1">Имя</th>')}
          ${_ifCol('subtype',    '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1">Подтип</th>')}
          ${_ifCol('pNom',       '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1" title="Установленная мощность (P_ном) одного прибора × количество.">P_ном (кВт)</th>')}
          ${_ifCol('iNom',       '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1" title="Номинальный ток I_ном = P_ном / U / cos φ / k.">I_ном (А)</th>')}
          ${_ifCol('pCalc',      '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1" title="Расчётная мощность P_расч = P_ном × К_и (ПУЭ 1.3.13 / IEC 60364).">P_расч (кВт)</th>')}
          ${_ifCol('iCalc',      '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1" title="Расчётный ток I_расч = P_расч / U / cos φ / k.">I_расч (А)</th>')}
          ${_ifCol('cos',        '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1">cos φ</th>')}
          ${_ifCol('phase',      '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1">Фаза</th>')}
          ${_ifCol('voltage',    '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1">U (В)</th>')}
          ${_ifCol('ku',         '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1">К_и</th>')}
          ${_ifCol('inputs',     '<th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1" title="Количество входных портов (P1, P2, …).">Входы</th>')}
          ${_ifCol('priorities', '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #cbd5e1" title="Приоритеты использования портов: одинаковые = параллель, возрастающие = АВР (1=primary, 2=standby).">Приоритеты</th>')}
          ${_ifCol('status',     '<th style="padding:6px 8px;text-align:center;border-bottom:1px solid #cbd5e1">Статус</th>')}
          <th style="padding:6px 8px;text-align:right;border-bottom:1px solid #cbd5e1;width:90px"></th>
        </tr>
      </thead><tbody>`);
      for (const entry of filteredM) {
        const s = entry.s; const i = entry.i;
        if (s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (!a) {
            // v0.60.239: dynamic colspan = checkbox + visible cols + actions.
            const _visCount = 1 + _CM_TABLE_COLUMNS.filter(c => _colVis[c.id]).length + 1;
            h.push(`<tr><td colspan="${_visCount}" style="padding:6px 8px;color:#991b1b;background:#fef2f2;border-bottom:1px solid #f1f5f9">Слот #${i+1}: битая ссылка <button type="button" data-cm-remove="${escAttr(String(i))}" style="margin-left:8px;padding:2px 8px;font-size:11px">×</button></td></tr>`);
            continue;
          }
          // v0.60.239: extended fields.
          let tagFull = effectiveTag(a) || a.tag || a.id;
          if (!tagFull.includes('.') && container) {
            const cZone = findZoneForMember(container);
            if (cZone && cZone.zonePrefix) tagFull = `${cZone.zonePrefix}.${tagFull}`;
          }
          const isSel = _containerMembersSelected.has(a.id);
          const _kw = Number(a.demandKw) || 0;
          const _cnt = Math.max(1, Number(a.count) || 1);
          const _cos = Number(a.cosPhi) || 0.95;
          const _ph3 = (a.phase || '3ph') === '3ph';
          const _U = Number(a.voltage) || 400;
          const _kUse = (a.kUse != null) ? Number(a.kUse) : 1;
          const _Pnom = _kw * _cnt;
          const _kFactor = _ph3 ? Math.sqrt(3) : 1;
          const _Inom = (_Pnom > 0 && _U > 0 && _cos > 0) ? (_Pnom * 1000) / (_kFactor * _U * _cos) : 0;
          const _Pcalc = _Pnom * _kUse;
          const _Icalc = (_Pcalc > 0 && _U > 0 && _cos > 0) ? (_Pcalc * 1000) / (_kFactor * _U * _cos) : 0;
          const _inputs = Math.max(1, Number(a.inputs) || 1);
          const _priorities = Array.isArray(a.priorities) ? a.priorities : [];
          let _portsTxt = '';
          if (_inputs > 1 && _priorities.length) {
            const allOnes = _priorities.every(p => Number(p) === 1);
            const ascending = _priorities.every((p, idx) => Number(p) === idx + 1);
            _portsTxt = allOnes ? 'параллель'
                     : ascending ? `АВР (${_priorities.join(',')})`
                     : _priorities.map((p, idx) => `P${idx+1}=${p}`).join(',');
          } else {
            _portsTxt = '—';
          }
          const _isPow = !!a._powered;
          const _isOver = !!a._overload;
          const _statusBadge = _isOver
            ? '<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:10px" title="Перегрузка">⚠</span>'
            : (_isPow
                ? '<span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:3px;font-size:10px" title="Запитан">⚡</span>'
                : '<span style="background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:3px;font-size:10px" title="Без питания">○</span>');
          h.push(`<tr data-mid="${escAttr(a.id)}" style="${isSel ? 'background:#eff6ff' : ''}">
            <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9"><input type="checkbox" class="cm-row-sel" data-mid="${escAttr(a.id)}" ${isSel ? 'checked' : ''}></td>
            ${_ifCol('tag',        `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-weight:600">${escHtml(tagFull)}</td>`)}
            ${_ifCol('name',       `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9">${escHtml(a.name || '')}</td>`)}
            ${_ifCol('subtype',    `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">${escHtml(a.consumerSubtype || 'custom')}</td>`)}
            ${_ifCol('pNom',       `<td style="padding:2px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><input type="number" class="cm-row-kw" data-mid="${escAttr(a.id)}" value="${_kw}" min="0" step="0.5" style="width:70px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid transparent;border-radius:3px">${_cnt > 1 ? `<span class="muted" style="font-size:10px"> ×${_cnt}</span>` : ''}</td>`)}
            ${_ifCol('iNom',       `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#475569">${fmt(_Inom, 1)}</td>`)}
            ${_ifCol('pCalc',      `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#1e40af;font-weight:500">${fmt(_Pcalc)}</td>`)}
            ${_ifCol('iCalc',      `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#1e40af">${fmt(_Icalc, 1)}</td>`)}
            ${_ifCol('cos',        `<td style="padding:2px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><input type="number" class="cm-row-cos" data-mid="${escAttr(a.id)}" value="${_cos}" min="0.1" max="1" step="0.01" style="width:60px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid transparent;border-radius:3px"></td>`)}
            ${_ifCol('phase',      `<td style="padding:2px 8px;border-bottom:1px solid #f1f5f9"><select class="cm-row-phase" data-mid="${escAttr(a.id)}" style="font-size:11px;padding:2px 4px;border:1px solid transparent;border-radius:3px"><option value="1ph" ${(a.phase||'3ph')==='1ph'?'selected':''}>1ph</option><option value="3ph" ${(a.phase||'3ph')==='3ph'?'selected':''}>3ph</option></select></td>`)}
            ${_ifCol('voltage',    `<td style="padding:2px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><input type="number" class="cm-row-voltage" data-mid="${escAttr(a.id)}" value="${_U}" min="0" step="10" style="width:60px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid transparent;border-radius:3px"></td>`)}
            ${_ifCol('ku',         `<td style="padding:2px 8px;border-bottom:1px solid #f1f5f9"><input type="number" class="cm-row-ku" data-mid="${escAttr(a.id)}" value="${_kUse}" min="0" max="1" step="0.05" style="width:60px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid transparent;border-radius:3px"></td>`)}
            ${_ifCol('inputs',     `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:right">${_inputs}</td>`)}
            ${_ifCol('priorities', `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:11px">${escHtml(_portsTxt)}</td>`)}
            ${_ifCol('status',     `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:center">${_statusBadge}</td>`)}
            <td style="padding:2px 8px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">
              <button type="button" data-cm-edit="${escAttr(a.id)}" title="Открыть полный инспектор" style="padding:2px 6px;font-size:11px;border:1px solid #2563eb;background:#dbeafe;color:#1e40af;border-radius:3px;cursor:pointer">⚙</button>
              <button type="button" data-cm-extract="${escAttr(String(i))}" title="Извлечь" style="padding:2px 6px;font-size:11px;border:1px solid #94a3b8;background:#fff;border-radius:3px;cursor:pointer">↗</button>
              <button type="button" data-cm-remove="${escAttr(String(i))}" title="Удалить" style="padding:2px 6px;font-size:11px;border:1px solid #ef4444;background:#fff;color:#b91c1c;border-radius:3px;cursor:pointer">×</button>
            </td>
          </tr>`);
        } else if (s.kind === 'placeholder') {
          // v0.60.239: расчётные значения для placeholder (1 единица).
          const _phKw = Number(s.demandKw) || 0;
          const _phCos = Number(s.cosPhi) || 0.95;
          const _phU = Number(s.voltage) || 400;
          const _phKu = (s.kUse != null) ? Number(s.kUse) : 1;
          const _phPh3 = (s.phase || '3ph') === '3ph';
          const _phK = _phPh3 ? Math.sqrt(3) : 1;
          const _phInom = (_phKw > 0 && _phU > 0 && _phCos > 0) ? (_phKw * 1000) / (_phK * _phU * _phCos) : 0;
          const _phPcalc = _phKw * _phKu;
          const _phIcalc = (_phPcalc > 0 && _phU > 0 && _phCos > 0) ? (_phPcalc * 1000) / (_phK * _phU * _phCos) : 0;
          const _bg = 'background:#fef9c3', _bd = 'border-bottom:1px solid #fde68a';
          h.push(`<tr style="${_bg}">
            <td style="padding:4px 8px;${_bd}"></td>
            ${_ifCol('tag',        `<td style="padding:4px 8px;${_bd};color:#92400e;font-style:italic">placeholder #${i+1}</td>`)}
            ${_ifCol('name',       `<td style="padding:4px 8px;${_bd}">—</td>`)}
            ${_ifCol('subtype',    `<td style="padding:4px 8px;${_bd};color:#92400e">${escHtml(s.subtype || 'custom')}</td>`)}
            ${_ifCol('pNom',       `<td style="padding:2px 8px;${_bd};text-align:right"><input type="number" data-cm-kw="${escAttr(String(i))}" value="${_phKw}" min="0" step="0.5" style="width:70px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid #fde68a;background:#fff;border-radius:3px"></td>`)}
            ${_ifCol('iNom',       `<td style="padding:4px 8px;${_bd};text-align:right;color:#92400e">${fmt(_phInom, 1)}</td>`)}
            ${_ifCol('pCalc',      `<td style="padding:4px 8px;${_bd};text-align:right;color:#92400e">${fmt(_phPcalc)}</td>`)}
            ${_ifCol('iCalc',      `<td style="padding:4px 8px;${_bd};text-align:right;color:#92400e">${fmt(_phIcalc, 1)}</td>`)}
            ${_ifCol('cos',        `<td style="padding:2px 8px;${_bd};text-align:right"><input type="number" data-cm-cos="${escAttr(String(i))}" value="${_phCos}" min="0.1" max="1" step="0.01" style="width:60px;text-align:right;padding:2px 4px;font-size:11px;border:1px solid #fde68a;background:#fff;border-radius:3px"></td>`)}
            ${_ifCol('phase',      `<td style="padding:4px 8px;${_bd}">${escHtml(s.phase || '3ph')}</td>`)}
            ${_ifCol('voltage',    `<td style="padding:4px 8px;${_bd};text-align:right">${_phU}</td>`)}
            ${_ifCol('ku',         `<td style="padding:4px 8px;${_bd}">${_phKu}</td>`)}
            ${_ifCol('inputs',     `<td style="padding:4px 8px;${_bd};text-align:right;color:#92400e">—</td>`)}
            ${_ifCol('priorities', `<td style="padding:4px 8px;${_bd};color:#92400e">—</td>`)}
            ${_ifCol('status',     `<td style="padding:4px 8px;${_bd};text-align:center;color:#92400e">📝</td>`)}
            <td style="padding:2px 8px;${_bd};text-align:right;white-space:nowrap">
              <button type="button" data-cm-materialize="${escAttr(String(i))}" title="Материализовать" style="padding:2px 6px;font-size:11px;border:1px solid #16a34a;background:#dcfce7;color:#15803d;border-radius:3px;cursor:pointer">⊕</button>
              <button type="button" data-cm-remove="${escAttr(String(i))}" title="Удалить slot" style="padding:2px 6px;font-size:11px;border:1px solid #ef4444;background:#fff;color:#b91c1c;border-radius:3px;cursor:pointer">×</button>
            </td>
          </tr>`);
        }
      }
      h.push('</tbody></table>');
      h.push('</div>');
    } else {
    h.push('<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:12px">');
    for (const entry of _sortedM) {
      const s = entry.s; const i = entry.i;
      if (!s) continue;
      if (s.kind === 'linked' && s.nodeId) {
        const a = state.nodes.get(s.nodeId);
        if (!a) {
          h.push(`<div style="padding:12px;background:#fee;border:1px solid #f87171;border-radius:6px;color:#991b1b">
            Слот #${i + 1}: битая ссылка
            <button type="button" data-cm-remove="${escAttr(String(i))}" style="margin-top:8px;padding:3px 10px;font-size:11px;border:1px solid #94a3b8;background:#fff;border-radius:3px;cursor:pointer">× Удалить</button>
          </div>`);
          continue;
        }
        // v0.60.238 (по запросу Пользователя 2026-05-05 «добавь на карточки
        // количество портов и приоритет их использования» / «отобрази все
        // поля которые отображаются на карточке размещенного потребителя»
        // / «и в обозначение потребителя так же добавь обозначение зоны,
        // чтобы не путаться»): расширенная карточка члена контейнера —
        // те же поля что у standalone-consumer card, плюс зонный префикс.
        let tag = effectiveTag(a) || a.tag || a.id;
        // Если effectiveTag не вернул префикс зоны (consumer внутри
        // container не считается прямым членом zone) — берём префикс зоны
        // самого container'а.
        if (!tag.includes('.') && container) {
          const cZone = findZoneForMember(container);
          if (cZone && cZone.zonePrefix) tag = `${cZone.zonePrefix}.${tag}`;
        }
        const name = a.name || '';
        const kw = Number(a.demandKw) || 0;
        const cnt = Math.max(1, Number(a.count) || 1);
        const sub = a.consumerSubtype || 'custom';
        const cos = a.cosPhi || 0.95;
        const phase = a.phase || '3ph';
        const v = Number(a.voltage) || 400;
        const ku = (a.kUse != null) ? Number(a.kUse) : 1;
        const inputs = Math.max(1, Number(a.inputs) || 1);
        const priorities = Array.isArray(a.priorities) ? a.priorities : [];
        // Описание портов и приоритетов.
        let portsTxt = `${inputs} вх.`;
        if (inputs > 1 && priorities.length) {
          const allOnes = priorities.every(p => Number(p) === 1);
          const ascending = priorities.every((p, idx) => Number(p) === idx + 1);
          if (allOnes) {
            portsTxt = `${inputs} вх. · параллель (все ${priorities.map(p => `prio=${p}`).join(', ')})`;
          } else if (ascending) {
            portsTxt = `${inputs} вх. · АВР (${priorities.map((p, idx) => `P${idx + 1}=${p}`).join(', ')})`;
          } else {
            portsTxt = `${inputs} вх. · ${priorities.map((p, idx) => `P${idx + 1}=${p}`).join(', ')}`;
          }
        }
        // Расчётный ток (упрощённо: I = P × count × Ки / (k × U × cos)).
        const ph3 = phase === '3ph';
        const Uc = ph3 ? v : (v <= 250 ? v : 230);
        const k = ph3 ? Math.sqrt(3) : 1;
        const Pnom = kw * cnt;
        const Inom = (Pnom > 0 && Uc > 0 && cos > 0) ? (Pnom * 1000) / (k * Uc * cos) : 0;
        const Pcalc = Pnom * ku;
        const Icalc = (Pcalc > 0 && Uc > 0 && cos > 0) ? (Pcalc * 1000) / (k * Uc * cos) : 0;
        // Статус питания.
        const powered = !!a._powered;
        const overload = !!a._overload;
        const statusBadge = overload
          ? `<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:10px">⚠ перегруз</span>`
          : (powered
              ? `<span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:3px;font-size:10px">⚡ запитан</span>`
              : `<span style="background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:3px;font-size:10px">○ без питания</span>`);
        h.push(`<div style="padding:10px 12px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:6px;border-bottom:1px solid #f1f5f9;padding-bottom:5px">
            <span style="flex:1;font-weight:600;font-size:14px" title="Полный путь с зоной/контейнером для уникальной идентификации потребителя.">${escHtml(tag)}</span>
            ${statusBadge}
            <span style="color:#778899;font-size:11px">#${i + 1}</span>
          </div>
          <div style="font-size:12px;color:#334155;margin-bottom:4px">${escHtml(name)} · <span style="color:#64748b">${escHtml(sub)}</span></div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:11px;color:#475569;align-items:center">
            <span title="Установленная мощность одного прибора (P_ном) × количество.">P_ном:</span>
            <b>${cnt > 1 ? `${cnt}×${kw} = ${fmt(Pnom)}` : fmt(kw)} кВт <span class="muted">/ ${fmt(Inom, 1)} A</span></b>
            <span title="Расчётная мощность с учётом коэффициента использования (К_и). По ПУЭ 1.3.13.">P_расч:</span>
            <b>${fmt(Pcalc)} кВт <span class="muted">/ ${fmt(Icalc, 1)} A</span></b>
            <span title="Коэффициент использования (К_и).">К_и:</span>
            <b>${ku.toFixed(2)}</b>
            <span title="Косинус φ — коэффициент мощности.">cos φ:</span>
            <b>${cos}</b>
            <span title="Фаза и напряжение.">U / Фаза:</span>
            <b>${escHtml(phase)} · ${v} В</b>
            <span title="Количество входных портов (P1, P2…) и приоритеты их использования. Параллель = все приоритеты одинаковые. АВР = разные (1=primary, 2=standby).">Входы:</span>
            <b>${escHtml(portsTxt)}</b>
            ${(inputs === 1 && (Number(container.inputs) || 1) > 1) ? `
              <span title="Порт группы, к которому подключён этот блок. Используется для маршрутизации до соответствующего щита.">Порт группы:</span>
              <select data-cm-groupport="${escAttr(a.id)}" style="font:inherit;font-size:11px;padding:1px 4px;border:1px solid #cbd5e1;border-radius:3px" title="Этот блок имеет 1 ввод; выберите к какому порту контейнера (P1…) он подключён. От этого зависит, через какой щит (на верхнем уровне) он питается.">
                ${Array.from({ length: Number(container.inputs) || 1 }, (_, _pi) =>
                  `<option value="${_pi}"${(Number(a.assignedGroupPort) || 0) === _pi ? ' selected' : ''}>P${_pi + 1}</option>`
                ).join('')}
              </select>
            ` : ''}
          </div>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button type="button" data-cm-edit="${escAttr(a.id)}" style="flex:1;padding:4px 8px;font-size:11px;border:1px solid #2563eb;background:#dbeafe;color:#1e40af;border-radius:4px;cursor:pointer" title="Открыть полный инспектор члена">⚙ Редактировать</button>
            <button type="button" data-cm-copy="${escAttr(String(i))}" style="padding:4px 8px;font-size:11px;border:1px solid #16a34a;background:#dcfce7;color:#15803d;border-radius:4px;cursor:pointer" title="Создать копию этого потребителя в той же группе (новый тег + такие же параметры)">📋</button>
            <button type="button" data-cm-extract="${escAttr(String(i))}" style="padding:4px 8px;font-size:11px;border:1px solid #94a3b8;background:#fff;border-radius:4px;cursor:pointer" title="Извлечь как standalone-потребителя">↗</button>
            <button type="button" data-cm-unlink="${escAttr(String(i))}" style="padding:4px 8px;font-size:11px;border:1px solid #94a3b8;background:#fff;border-radius:4px;cursor:pointer" title="Разъединить (member → placeholder)">✂</button>
            <button type="button" data-cm-remove="${escAttr(String(i))}" style="padding:4px 8px;font-size:11px;border:1px solid #ef4444;background:#fff;color:#b91c1c;border-radius:4px;cursor:pointer" title="Удалить из группы">×</button>
          </div>
        </div>`);
      } else if (s.kind === 'placeholder') {
        // v0.59.843: preview будущего tag'а при materialize (по маске
        // соседних linked-членов).
        const _futureTag = _suggestTagFromContainer(container);
        h.push(`<div style="padding:10px 12px;background:#fef9c3;border:1px solid #facc15;border-radius:6px;display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:6px;border-bottom:1px solid #fde68a;padding-bottom:5px">
            <span style="flex:1;font-weight:600;font-size:13px;color:#92400e">${_futureTag ? `<span style="color:#a16207">${escHtml(_futureTag)}</span> <span style="font-weight:400;font-style:italic">(будущий)</span>` : '<i>placeholder</i>'}</span>
            <span style="color:#92400e;font-size:11px">#${i + 1}</span>
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:11px;color:#78350f;align-items:center">
            <span>P:</span><input type="number" data-cm-kw="${escAttr(String(i))}" value="${Number(s.demandKw) || 0}" min="0" step="0.5" style="padding:1px 4px;font-size:11px;width:80px"> кВт
            <span>cos φ:</span><input type="number" data-cm-cos="${escAttr(String(i))}" value="${Number(s.cosPhi) || 0.95}" min="0.1" max="1" step="0.01" style="padding:1px 4px;font-size:11px;width:80px">
            <span>Тип:</span><b>${escHtml(s.subtype || 'custom')}</b>
            <span>Фаза:</span><b>${escHtml(s.phase || '3ph')} · ${Number(s.voltage) || 400} В</b>
          </div>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button type="button" data-cm-materialize="${escAttr(String(i))}" style="flex:1;padding:4px 8px;font-size:11px;border:1px solid #16a34a;background:#dcfce7;color:#15803d;border-radius:4px;cursor:pointer" title="Создать реальный consumer-узел">⊕ Материализовать</button>
            <button type="button" data-cm-remove="${escAttr(String(i))}" style="padding:4px 8px;font-size:11px;border:1px solid #ef4444;background:#fff;color:#b91c1c;border-radius:4px;cursor:pointer" title="Удалить slot">×</button>
          </div>
        </div>`);
      }
    }
    h.push('</div>');
    } // end inner else (cards view)
  } // end outer else (slots.length > 0)
  // v0.60.180 (по репорту Пользователя 2026-05-04 «как теперь удалить
  // экземпляры и группу с одним элементом вернуть в простой потребитель?»):
  // в footer модалки добавлены явные actions:
  //   • «↩ Расформировать группу» — показывается когда осталось 1
  //     linked-instance + 0 placeholders. Откатывает контейнер обратно
  //     к одиночному consumer'у (через тот же flow, что normalizeContainers).
  //   • «🗑 Удалить группу» — удаляет контейнер целиком + все linked-consumer'ы
  //     (с подтверждением).
  // Раньше Пользователь видел только «➕ Добавить placeholder» и не знал,
  // что × на карточке возвращает consumer в реестр, а нормализация —
  // автоматическая на recalc.
  h.push('<div style="padding:12px;border-top:1px solid #e0e7ee;display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap">');
  h.push('<div style="display:flex;gap:8px;flex-wrap:wrap">');
  if (linkedCount === 1 && phCount === 0) {
    h.push('<button type="button" id="cm-collapse-group" title="Группа содержит только 1 потребителя — вернуть его как обычного consumer\'a (контейнер удаляется, consumer возвращается на canvas)" style="padding:6px 14px;font-size:12px;border:1px solid #16a34a;background:#dcfce7;color:#166534;border-radius:4px;cursor:pointer;font-weight:600">↩ Расформировать группу (1 элемент)</button>');
  }
  h.push('<button type="button" id="cm-delete-container" title="Удалить контейнер целиком вместе со всеми linked-потребителями (необратимо)" style="padding:6px 14px;font-size:12px;border:1px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:4px;cursor:pointer">🗑 Удалить группу полностью</button>');
  h.push('</div>');
  // v0.60.345: kit-mode удалён, остаётся только placeholder-слот для обычной группы.
  h.push('<div style="display:flex;gap:6px;flex-wrap:wrap">');
  h.push('<button type="button" id="cm-add-placeholder" style="padding:6px 14px;font-size:12px;border:1px solid #2563eb;background:#dbeafe;color:#1e40af;border-radius:4px;cursor:pointer">➕ Добавить placeholder-слот</button>');
  h.push('</div>');
  h.push('</div>');
  body.innerHTML = h.join('');
  modal.classList.remove('hidden');
  // wire-up actions (re-uses _wireContainerSlots-like logic, но на body модалки)
  _wireContainerMembersModal(container, body, modal);
}
function _wireContainerMembersModal(n, body, modal) {
  // v0.59.884: toggle между cards/table view + table inputs/bulk-edit.
  body.querySelectorAll('.cm-view-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      _containerMembersView = (v === 'table') ? 'table' : 'cards';
      try { localStorage.setItem('raschet.container-members.view.v1', _containerMembersView); } catch {}
      // Очистим selection при смене view
      _containerMembersSelected.clear();
      openContainerMembersModal(n); // re-render всей модалки
    });
  });
  // Table view: filter inputs.
  const fSearch = body.querySelector('#cm-table-search');
  if (fSearch) fSearch.addEventListener('input', e => {
    _containerMembersTableFilter.search = e.target.value;
    openContainerMembersModal(n);
    // Re-focus + position cursor
    setTimeout(() => {
      const f2 = document.getElementById('cm-table-search');
      if (f2) { f2.focus(); f2.setSelectionRange(f2.value.length, f2.value.length); }
    }, 0);
  });
  body.querySelector('#cm-table-subtype')?.addEventListener('change', e => { _containerMembersTableFilter.subtype = e.target.value; openContainerMembersModal(n); });
  body.querySelector('#cm-table-phase')?.addEventListener('change', e => { _containerMembersTableFilter.phase = e.target.value; openContainerMembersModal(n); });
  // v0.60.239: фильтр по статусу + пресеты + видимость колонок.
  body.querySelector('#cm-table-powered')?.addEventListener('change', e => {
    _containerMembersTableFilter.powered = e.target.value;
    openContainerMembersModal(n);
  });
  body.querySelector('#cm-table-preset')?.addEventListener('change', e => {
    const id = e.target.value;
    if (id) _applyCmPreset(id);
    openContainerMembersModal(n);
  });
  body.querySelector('#cm-table-cols')?.addEventListener('click', () => {
    const pop = document.getElementById('cm-cols-popover');
    if (pop) pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
  });
  body.querySelectorAll('input[data-cm-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      const colId = cb.dataset.cmCol;
      _containerMembersCols[colId] = cb.checked;
      _saveCmCols();
      // Снимаем привязку к пресету (Пользователь сам кастомизировал).
      try { localStorage.removeItem(_CM_LS_PRESET_ID); } catch {}
      openContainerMembersModal(n);
    });
  });
  body.querySelector('#cm-table-reset')?.addEventListener('click', () => {
    _containerMembersTableFilter = { search: '', subtype: '', phase: '', powered: '' };
    openContainerMembersModal(n);
  });
  // Row select checkboxes
  body.querySelectorAll('input.cm-row-sel').forEach(cb => {
    cb.addEventListener('change', e => {
      const mid = cb.dataset.mid;
      if (cb.checked) _containerMembersSelected.add(mid);
      else _containerMembersSelected.delete(mid);
      openContainerMembersModal(n);
    });
  });
  // Select-all
  body.querySelector('#cm-table-selectall')?.addEventListener('change', e => {
    const checked = e.target.checked;
    body.querySelectorAll('input.cm-row-sel').forEach(cb => {
      const mid = cb.dataset.mid;
      if (checked) _containerMembersSelected.add(mid);
      else _containerMembersSelected.delete(mid);
    });
    openContainerMembersModal(n);
  });
  // Per-row inline edit (change event — сохраняет на blur)
  const _applyRowField = (field, parser, validator) => {
    body.querySelectorAll('input.' + field + ', select.' + field).forEach(inp => {
      inp.addEventListener('change', e => {
        const mid = inp.dataset.mid;
        const a = state.nodes.get(mid);
        if (!a) return;
        const raw = inp.value;
        const parsed = parser(raw);
        if (validator && !validator(parsed)) return;
        const fieldName = field.replace('cm-row-', '');
        a[fieldName] = parsed;
        try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {}
      });
    });
  };
  _applyRowField('cm-row-kw',      v => Number(v) || 0, v => v >= 0);
  _applyRowField('cm-row-cos',     v => Number(v) || 0.95, v => v >= 0.1 && v <= 1);
  _applyRowField('cm-row-phase',   v => v);
  _applyRowField('cm-row-voltage', v => Number(v) || 400, v => v >= 0);
  _applyRowField('cm-row-ku',      v => Number(v) || 1, v => v >= 0 && v <= 1);
  // Map renames: input.cm-row-X — нужно cm-row-X → имя поля без префикса.
  // Я использую упрощённую логику выше; явные обработчики для kw → demandKw, ku → kUse:
  body.querySelectorAll('input.cm-row-kw').forEach(inp => {
    inp.addEventListener('change', e => {
      const a = state.nodes.get(inp.dataset.mid);
      if (a) { a.demandKw = Number(inp.value) || 0; try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {} }
    });
  });
  body.querySelectorAll('input.cm-row-cos').forEach(inp => {
    inp.addEventListener('change', e => {
      const a = state.nodes.get(inp.dataset.mid);
      if (a) { a.cosPhi = Number(inp.value) || 0.95; try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {} }
    });
  });
  body.querySelectorAll('select.cm-row-phase').forEach(sel => {
    sel.addEventListener('change', e => {
      const a = state.nodes.get(sel.dataset.mid);
      if (a) { a.phase = sel.value; try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {} }
    });
  });
  body.querySelectorAll('input.cm-row-voltage').forEach(inp => {
    inp.addEventListener('change', e => {
      const a = state.nodes.get(inp.dataset.mid);
      if (a) { a.voltage = Number(inp.value) || 400; try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {} }
    });
  });
  body.querySelectorAll('input.cm-row-ku').forEach(inp => {
    inp.addEventListener('change', e => {
      const a = state.nodes.get(inp.dataset.mid);
      if (a) { a.kUse = Number(inp.value); try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {} }
    });
  });
  // Bulk-edit toolbar
  body.querySelector('#cm-bulk-apply')?.addEventListener('click', () => {
    const kw = body.querySelector('#cm-bulk-kw').value;
    const cos = body.querySelector('#cm-bulk-cos').value;
    const ph = body.querySelector('#cm-bulk-phase').value;
    const v = body.querySelector('#cm-bulk-voltage').value;
    let count = 0;
    for (const mid of _containerMembersSelected) {
      const a = state.nodes.get(mid);
      if (!a) continue;
      if (kw !== '') a.demandKw = Number(kw) || 0;
      if (cos !== '') a.cosPhi = Math.max(0.1, Math.min(1, Number(cos) || 0.95));
      if (ph !== '') a.phase = ph;
      if (v !== '') a.voltage = Number(v) || 400;
      count++;
    }
    if (count > 0) {
      try { window.Raschet?.recalc?.(); window.Raschet?.render?.(); } catch {}
      openContainerMembersModal(n);
    }
  });
  body.querySelector('#cm-bulk-clear')?.addEventListener('click', () => {
    _containerMembersSelected.clear();
    openContainerMembersModal(n);
  });

  // Edit member full inspector — выбираем член, закрываем модалку, открываем
  // обычный consumer-modal через openConsumerParamsModal.
  // v0.59.838: после закрытия consumer-модалки возвращаемся в контейнер
  // (а не оставляем пользователя у пустого канваса). Пользователь:
  // «после открытия карточки потребителя из группы, нужно вернуться
  // обратно в группу а не просто закрыть окно».
  // v0.60.378: change-handlers для container redundancy + standby type.
  body.querySelector('#cm-cont-redundancyMode')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    const _slotCount = (Array.isArray(n.slots) ? n.slots : []).filter(s => s && (s.kind === 'linked' || s.kind === 'placeholder')).length;
    let r = 0;
    if (mode === 'N') r = 0;
    else if (mode === 'N+1' && _slotCount >= 2) r = 1;
    else if (mode === 'N+2' && _slotCount >= 3) r = 2;
    else if (mode === '2N' && _slotCount >= 2 && _slotCount % 2 === 0) r = _slotCount / 2;
    if (r > 0) n.consumerReserveR = r;
    else delete n.consumerReserveR;
    try { snapshot('cm-cont-reserveR:' + n.id + ':' + mode); } catch {}
    try { notifyChange(); } catch {}
    try { window.Raschet?.recalc?.(); } catch {}
    try { window.Raschet?.render?.(); } catch {}
    openContainerMembersModal(n);
  });
  body.querySelector('#cm-cont-standbyType')?.addEventListener('change', (e) => {
    const st = e.target.value;
    if (st === 'hot') n.redundancyStandbyType = 'hot';
    else delete n.redundancyStandbyType;
    try { snapshot('cm-cont-standbyType:' + n.id + ':' + st); } catch {}
    try { notifyChange(); } catch {}
    try { window.Raschet?.recalc?.(); } catch {}
    try { window.Raschet?.render?.(); } catch {}
    openContainerMembersModal(n);
  });

  // v0.60.352: change-handler для группового порта single-input child'ов.
  body.querySelectorAll('[data-cm-groupport]').forEach(sel => {
    sel.addEventListener('change', () => {
      const aid = sel.getAttribute('data-cm-groupport');
      const a = state.nodes.get(aid);
      if (!a) return;
      const v = Number(sel.value) || 0;
      a.assignedGroupPort = v;
      try { snapshot('cm-groupport-change:' + aid + ':' + v); } catch {}
      try { notifyChange(); } catch {}
    });
  });

  body.querySelectorAll('[data-cm-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid = btn.getAttribute('data-cm-edit');
      const a = state.nodes.get(aid);
      if (!a) return;
      modal.classList.add('hidden');
      // open standard consumer params modal
      try {
        selectNode(a.id);
        openConsumerParamsModal(a);
        // Установим one-shot return-to-container handler на consumer modal
        const cpModal = document.getElementById('modal-consumer-params');
        if (cpModal) {
          const _onClose = () => {
            if (cpModal.classList.contains('hidden')) {
              cpModal.removeEventListener('animationend', _onClose);
              _observer.disconnect();
              // Возвращаемся в контейнер
              setTimeout(() => openContainerMembersModal(n), 50);
            }
          };
          // Используем MutationObserver для отслеживания добавления .hidden
          const _observer = new MutationObserver(() => {
            if (cpModal.classList.contains('hidden')) {
              _observer.disconnect();
              setTimeout(() => {
                if (state.nodes.get(n.id)) openContainerMembersModal(n);
              }, 50);
            }
          });
          _observer.observe(cpModal, { attributes: true, attributeFilter: ['class'] });
        }
      } catch {}
    });
  });
  // Extract / Unlink / Remove / Materialize / inline-edit / Add placeholder —
  // повторяем логику _wireContainerSlots но на body модалки.
  const refresh = () => {
    openContainerMembersModal(n);
    _render();
    notifyChange();
  };
  // v0.60.354 (по запросу Пользователя 2026-05-06: «как скопировать
  // кондиционер который в группе??? только вытащить скопировать и заново
  // разместить???»): кнопка 📋 — клонирует child прямо в группе.
  body.querySelectorAll('[data-cm-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cm-copy'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'linked' || !slot.nodeId) return;
      const a = state.nodes.get(slot.nodeId);
      if (!a) return;
      snapshot('container-copy:' + n.id + ':' + a.id);
      // Глубокая копия (без id, конкретно-инстансных полей).
      const clone = JSON.parse(JSON.stringify(a));
      clone.id = uid();
      // Новый тег: используем nextFreeTag по subtype (consumer → ACU/L).
      try {
        clone.tag = nextFreeTag('consumer');
        // Если original был ACU* — выбираем ACU prefix (CONSUMER_SUBTYPE_PREFIX
        // в graph.js handles это).
      } catch {}
      // Сбросить per-instance ссылки (outdoor blocks, alias и т.п.).
      delete clone.linkedOutdoorId;
      delete clone.linkedOutdoorIds;
      delete clone.linkedAlias;
      delete clone.containerId;
      // Расчётные поля сбросить.
      clone._loadKw = 0; clone._powered = false; clone._maxLoadKw = 0; clone._maxLoadA = 0;
      clone.containerId = n.id;
      // pageIds совпадает с container'ом (т.к. children наследуют от него).
      clone.pageIds = Array.isArray(n.pageIds) ? n.pageIds.slice() : [];
      state.nodes.set(clone.id, clone);
      // Вставить новый linked-slot после оригинального.
      n.slots.splice(idx + 1, 0, { kind: 'linked', nodeId: clone.id });
      notifyChange();
      refresh();
    });
  });

  body.querySelectorAll('[data-cm-extract]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cm-extract'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'linked' || !slot.nodeId) return;
      const a = state.nodes.get(slot.nodeId);
      if (!a) return;
      snapshot('container-extract:' + n.id + ':' + a.id);
      delete a.containerId;
      a.pageIds = state.currentPageId ? [state.currentPageId] : [];
      a.x = (Number(n.x) || 0) + 240 + idx * 20;
      a.y = (Number(n.y) || 0);
      n.slots.splice(idx, 1);
      if (!n.slots.length) {
        try { _deleteNode(n.id, { hard: true, silent: true }); } catch {}
        modal.classList.add('hidden');
        _render(); notifyChange();
        return;
      }
      refresh();
    });
  });
  body.querySelectorAll('[data-cm-unlink]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cm-unlink'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'linked' || !slot.nodeId) return;
      const a = state.nodes.get(slot.nodeId);
      if (!a) return;
      snapshot('container-unlink:' + n.id + ':#' + idx);
      n.slots[idx] = {
        kind: 'placeholder',
        demandKw: Number(a.demandKw) || 0,
        cosPhi: Number(a.cosPhi) || 0.95,
        phase: a.phase || '3ph',
        voltage: Number(a.voltage) || 400,
        voltageLevelIdx: Number(a.voltageLevelIdx) || 0,
        subtype: a.consumerSubtype || 'custom',
        kUse: Number(a.kUse) || 1,
      };
      // Consumer НЕ удаляется — отправляется в реестр (unplaced)
      delete a.containerId;
      a.pageIds = [];
      refresh();
    });
  });
  body.querySelectorAll('[data-cm-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cm-remove'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      snapshot('container-removeslot:' + n.id + ':#' + idx);
      if (slot && slot.kind === 'linked' && slot.nodeId) {
        // Consumer НЕ удаляется — в реестр (unplaced).
        const a = state.nodes.get(slot.nodeId);
        if (a) { delete a.containerId; a.pageIds = []; }
      }
      n.slots.splice(idx, 1);
      if (!n.slots.length) {
        try { _deleteNode(n.id, { hard: true, silent: true }); } catch {}
        modal.classList.add('hidden');
        _render(); notifyChange();
        return;
      }
      refresh();
    });
  });
  body.querySelectorAll('[data-cm-materialize]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cm-materialize'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'placeholder') return;
      snapshot('container-materialize:' + n.id + ':#' + idx);
      const newId = uid();
      // v0.59.841: tag по маске соседних linked-членов (SR07 если SR01..SR06).
      const suggestedTag = _suggestTagFromContainer(n) || nextFreeTag('consumer');
      const newConsumer = {
        id: newId, type: 'consumer', name: _suggestNameFromContainer(n, slot.subtype) || 'Потребитель', tag: suggestedTag,
        x: Number(n.x) || 0, y: Number(n.y) || 0,
        demandKw: Number(slot.demandKw) || 0, cosPhi: Number(slot.cosPhi) || 0.95,
        phase: slot.phase || '3ph', voltage: Number(slot.voltage) || 400,
        voltageLevelIdx: Number(slot.voltageLevelIdx) || 0,
        consumerSubtype: slot.subtype || 'custom', kUse: Number(slot.kUse) || 1,
        inputs: 1, outputs: 0, count: 1, priorities: [1, 2],
        containerId: n.id, pageIds: [],
      };
      state.nodes.set(newId, newConsumer);
      n.slots[idx] = { kind: 'linked', nodeId: newId };
      refresh();
    });
  });
  body.querySelectorAll('[data-cm-kw]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.getAttribute('data-cm-kw'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx)) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'placeholder') return;
      snapshot('container-slot-kw:' + n.id + ':#' + idx);
      slot.demandKw = Math.max(0, Number(inp.value) || 0);
      _render(); notifyChange();
    });
  });
  body.querySelectorAll('[data-cm-cos]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.getAttribute('data-cm-cos'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx)) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'placeholder') return;
      snapshot('container-slot-cos:' + n.id + ':#' + idx);
      slot.cosPhi = Math.max(0.1, Math.min(1, Number(inp.value) || 0.95));
      _render(); notifyChange();
    });
  });
  const addBtn = document.getElementById('cm-add-placeholder');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      snapshot('container-addplaceholder:' + n.id);
      if (!Array.isArray(n.slots)) n.slots = [];
      let demandKw = 5, cosPhi = 0.95, phase = '3ph', voltage = 400, vIdx = 0, subtype = 'custom';
      for (const s of n.slots) {
        if (s && s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a) { demandKw = Number(a.demandKw) || demandKw; cosPhi = Number(a.cosPhi) || cosPhi; phase = a.phase || phase; voltage = Number(a.voltage) || voltage; vIdx = Number(a.voltageLevelIdx) || vIdx; subtype = a.consumerSubtype || subtype; break; }
        }
      }
      n.slots.push({ kind: 'placeholder', demandKw, cosPhi, phase, voltage, voltageLevelIdx: vIdx, subtype });
      refresh();
    });
  }

  // v0.60.255: kitMode toggle.
  // Переключение режима «Группа ↔ Сборка» — меняет n.kitMode и пересчитывает
  // _isKitInternal на conns (через recalc → _markKitInternalConns).
  const kitOff = body.querySelector('#cm-kitmode-off');
  const kitOn  = body.querySelector('#cm-kitmode-on');
  if (kitOff) kitOff.addEventListener('click', () => {
    if (!n.kitMode) return;
    snapshot('container-kitmode-off:' + n.id);
    n.kitMode = false;
    refresh();
  });
  if (kitOn) kitOn.addEventListener('click', () => {
    if (n.kitMode) return;
    snapshot('container-kitmode-on:' + n.id);
    n.kitMode = true;
    refresh();
  });

  // v0.60.255: helper для создания одного consumer-узла как linked-slot
  // в kit-сборке. Возвращает id нового узла.
  function _addKitMember({ name, subtype, kw, cos, phase, voltage }) {
    const id = uid('n');
    const tag = nextFreeTag('consumer');
    const node = {
      id, type: 'consumer', name, tag,
      x: Number(n.x) || 0, y: Number(n.y) || 0,
      ...DEFAULTS.consumer(),
      consumerSubtype: subtype || 'custom',
      demandKw: Number(kw) || 0,
      cosPhi: Number(cos) || 0.85,
      phase: phase || '3ph',
      voltage: Number(voltage) || 400,
      kUse: 1,
      inputs: 1, outputs: 0, count: 1, priorities: [1],
      containerId: n.id,
      pageIds: [], // members не на canvas — отображаются через container-узел
    };
    state.nodes.set(id, node);
    if (!Array.isArray(n.slots)) n.slots = [];
    n.slots.push({ kind: 'linked', nodeId: id });
    return id;
  }
  // v0.60.255: helper для создания внутреннего kit-conn между двумя
  // members. Conn маркируется _isKitInternal в recalc автоматически.
  function _addKitConn(fromId, toId) {
    const cid = uid('c');
    state.conns.set(cid, {
      id: cid,
      from: { nodeId: fromId, port: 0 },
      to:   { nodeId: toId,   port: 0 },
      material: GLOBAL.defaultMaterial,
      insulation: GLOBAL.defaultInsulation,
      installMethod: GLOBAL.defaultInstallMethod,
      ambientC: GLOBAL.defaultAmbient,
      grouping: GLOBAL.defaultGrouping,
      bundling: 'touching',
      lengthM: 5,
      cableMark: GLOBAL.projectMainCableLv || null,
    });
    return cid;
  }

  // v0.60.255: «+ Кондиционер (water-cooled)» — только cond, без outdoor.
  body.querySelector('#cm-add-kit-cond-only')?.addEventListener('click', () => {
    if (!n.kitMode) { try { window.scToast?.('Включите режим «🧩 Сборка»', 'warn'); } catch {} ; return; }
    snapshot('container-add-kit-cond-only:' + n.id);
    _addKitMember({ name: 'Кондиционер', subtype: 'conditioner', kw: 10, cos: 0.85, phase: '3ph', voltage: 400 });
    refresh();
  });

  // v0.60.255: «+ Кондиционер + outdoor» — cond + 1 outdoor + kit-internal conn.
  body.querySelector('#cm-add-kit-cond-1out')?.addEventListener('click', () => {
    if (!n.kitMode) { try { window.scToast?.('Включите режим «🧩 Сборка»', 'warn'); } catch {} ; return; }
    snapshot('container-add-kit-cond-1out:' + n.id);
    const condId = _addKitMember({ name: 'Кондиционер', subtype: 'conditioner', kw: 10, cos: 0.85, phase: '3ph', voltage: 400 });
    const outId  = _addKitMember({ name: 'Наруж. блок', subtype: 'outdoor_unit', kw: 0.6, cos: 0.85, phase: '1ph', voltage: 230 });
    _addKitConn(condId, outId);
    refresh();
  });

  // v0.60.255: «+ Кондиционер + 2× outdoor» — cond + 2 outdoor + 2 kit-internal conns.
  body.querySelector('#cm-add-kit-cond-2out')?.addEventListener('click', () => {
    if (!n.kitMode) { try { window.scToast?.('Включите режим «🧩 Сборка»', 'warn'); } catch {} ; return; }
    snapshot('container-add-kit-cond-2out:' + n.id);
    const condId = _addKitMember({ name: 'Кондиционер (2-контурный)', subtype: 'conditioner', kw: 16, cos: 0.85, phase: '3ph', voltage: 400 });
    const out1Id = _addKitMember({ name: 'Наруж. блок №1', subtype: 'outdoor_unit', kw: 0.6, cos: 0.85, phase: '1ph', voltage: 230 });
    const out2Id = _addKitMember({ name: 'Наруж. блок №2', subtype: 'outdoor_unit', kw: 0.6, cos: 0.85, phase: '1ph', voltage: 230 });
    _addKitConn(condId, out1Id);
    _addKitConn(condId, out2Id);
    refresh();
  });
  // v0.60.180 (по репорту Пользователя 2026-05-04): «↩ Расформировать
  // группу» — когда linked=1, ph=0. Возвращает consumer на canvas с
  // pageIds + positions контейнера; перенаправляет state.conns/sysConns
  // container.id → consumer.id; контейнер удаляется.
  const collapseBtn = document.getElementById('cm-collapse-group');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      try {
        const slots = Array.isArray(n.slots) ? n.slots : [];
        // v0.60.183 fix (по репорту Пользователя «группу так и не могу
        // расформировать. В одном месте удаляю, в другом остается»):
        // 1. Фильтруем по СУЩЕСТВОВАНИЮ node в state.nodes (как в header
        //    linkedCount), а не только по truthy nodeId. Раньше stale-slot
        //    (linked-slot с удалённым consumer'ом) давал linked.length>1 →
        //    handler bail'ил без эффекта.
        // 2. Чистим stale-slots до проверки.
        // 3. Принудительный bypassConnGate в _deleteNode (на случай если
        //    redirect не покрыл какие-то connections).
        const liveSlots = slots.filter(s => {
          if (!s) return false;
          if (s.kind === 'placeholder') return true;
          if (s.kind === 'linked' && s.nodeId) {
            return !!state.nodes.get(s.nodeId);
          }
          return false;
        });
        const liveLinked = liveSlots.filter(s => s.kind === 'linked' && s.nodeId);
        const livePh = liveSlots.filter(s => s.kind === 'placeholder');
        if (liveLinked.length !== 1 || livePh.length !== 0) {
          console.warn('[collapse-group] aborted: liveLinked=' + liveLinked.length + ' livePh=' + livePh.length);
          return;
        }
        const memberId = liveLinked[0].nodeId;
        const a = state.nodes.get(memberId);
        if (!a) {
          console.warn('[collapse-group] aborted: member not found:', memberId);
          return;
        }
        snapshot('container-collapse:' + n.id);
        // Возвращаем consumer на canvas: pageIds + positionsByPage от контейнера.
        a.pageIds = Array.isArray(n.pageIds) ? n.pageIds.slice() : [];
        if (n.positionsByPage) {
          try { a.positionsByPage = JSON.parse(JSON.stringify(n.positionsByPage)); } catch {}
        }
        a.x = n.x; a.y = n.y;
        delete a.containerId;
        // Перенаправить connections container → consumer.
        for (const c of state.conns.values()) {
          if (c.from && c.from.nodeId === n.id) c.from.nodeId = a.id;
          if (c.to && c.to.nodeId === n.id) c.to.nodeId = a.id;
        }
        if (state.sysConns) {
          for (const sc of state.sysConns.values()) {
            if (sc.fromNodeId === n.id) sc.fromNodeId = a.id;
            if (sc.toNodeId === n.id) sc.toNodeId = a.id;
          }
        }
        // Перед удалением — обнуляем slots, чтобы не было cascading.
        n.slots = [];
        // Удаляем контейнер. bypassConnGate — на случай если какие-то
        // connections не покрылись redirect'ом (sectioned/system-conns).
        const delResult = _deleteNode(n.id, {
          hard: true, silent: true, force: true, bypassConnGate: true
        });
        if (delResult && delResult.blocked) {
          console.warn('[collapse-group] _deleteNode blocked:', delResult);
          // Попытка fallback: удалить напрямую из state.nodes
          state.nodes.delete(n.id);
        }
        // Снимаем выделение если был выбран контейнер.
        if (state.selectedKind === 'node' && state.selectedId === n.id) {
          state.selectedKind = null; state.selectedId = null;
        }
        modal.classList.add('hidden');
        _render();
        try { renderInspector(); } catch {}
        notifyChange();
      } catch (err) {
        console.error('[collapse-group] FAILED:', err);
        alert('Ошибка расформирования группы. Откройте консоль (F12) для деталей.');
      }
    });
  }
  // v0.60.180: «🗑 Удалить группу полностью» — контейнер + все linked-members.
  const deleteContainerBtn = document.getElementById('cm-delete-container');
  if (deleteContainerBtn) {
    deleteContainerBtn.addEventListener('click', async () => {
      try {
        const slots = Array.isArray(n.slots) ? n.slots : [];
        const linked = slots.filter(s => s && s.kind === 'linked' && s.nodeId && state.nodes.get(s.nodeId));
        const lcount = linked.length;
        const ok = await rsConfirm(
          'Удалить группу полностью?',
          `Удалятся: контейнер «${n.tag || n.name || n.id}» и ${lcount} linked-потребител${lcount === 1 ? 'ь' : (lcount < 5 ? 'я' : 'ей')}. Действие необратимо.`,
          { okLabel: 'Удалить', cancelLabel: 'Отмена' }
        );
        if (!ok) return;
        snapshot('container-deleteall:' + n.id);
        // Сначала обрываем все state.conns/sysConns ссылающиеся на контейнер
        // и его linked-members (иначе delete-gate блокирует hard-delete).
        const allIds = new Set([n.id]);
        for (const s of linked) allIds.add(s.nodeId);
        for (const [cid, c] of Array.from(state.conns.entries())) {
          if (allIds.has(c.from?.nodeId) || allIds.has(c.to?.nodeId)) {
            state.conns.delete(cid);
          }
        }
        if (state.sysConns) {
          for (const [scid, sc] of Array.from(state.sysConns.entries())) {
            if (allIds.has(sc.fromNodeId) || allIds.has(sc.toNodeId) ||
                allIds.has(sc.from?.nodeId) || allIds.has(sc.to?.nodeId)) {
              state.sysConns.delete(scid);
            }
          }
        }
        n.slots = [];
        // Удаляем linked-consumer'ы, затем сам контейнер.
        for (const s of linked) {
          const r = _deleteNode(s.nodeId, { hard: true, silent: true, force: true, bypassConnGate: true });
          if (r && r.blocked) state.nodes.delete(s.nodeId);
        }
        const r2 = _deleteNode(n.id, { hard: true, silent: true, force: true, bypassConnGate: true });
        if (r2 && r2.blocked) state.nodes.delete(n.id);
        if (state.selectedKind === 'node' && allIds.has(state.selectedId)) {
          state.selectedKind = null; state.selectedId = null;
        }
        modal.classList.add('hidden');
        _render();
        try { renderInspector(); } catch {}
        notifyChange();
      } catch (err) {
        console.error('[delete-container] FAILED:', err);
        alert('Ошибка удаления группы. Откройте консоль (F12) для деталей.');
      }
    });
  }
  // close handlers
  modal.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => { modal.classList.add('hidden'); }, { once: true });
  });
}

// v0.59.841: при materialize placeholder'а — сгенерировать tag по маске
// соседних linked-членов того же контейнера. Например, если в контейнере
// уже SR01, SR02, SR03, SR05 — следующий materialized = SR06 (или SR04
// если задумаемся о пропусках, но проще: max+1).
// Если linked-члены имеют разные префиксы (SR01, CR01) — берём префикс
// первого linked-члена (по натуральной сортировке). Если linked-членов
// нет вообще — fallback на nextFreeTag('consumer') = L1, L2 и т.д.
function _suggestTagFromContainer(container) {
  if (!container || !Array.isArray(container.slots)) return null;
  const linkedTags = [];
  for (const s of container.slots) {
    if (s && s.kind === 'linked' && s.nodeId) {
      const a = state.nodes.get(s.nodeId);
      if (a && a.tag) linkedTags.push(a.tag);
    }
  }
  if (!linkedTags.length) return null;
  // Сортировка натуральная, берём первый — определяет префикс/формат
  linkedTags.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const first = linkedTags[0];
  // Парсим формат: <prefix><digits>, где digits может иметь leading zeros
  const m = first.match(/^([^\d]*)(\d+)$/);
  if (!m) return null;
  const prefix = m[1];
  const sampleDigits = m[2]; // например "01" — длина 2
  const padLen = sampleDigits.length;
  // Найти максимальный номер среди linked-tags с тем же префиксом
  let maxN = 0;
  for (const t of linkedTags) {
    const tm = t.match(/^([^\d]*)(\d+)$/);
    if (!tm || tm[1] !== prefix) continue;
    const n = parseInt(tm[2], 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  // Сгенерировать N+1 с тем же padding
  const nextN = maxN + 1;
  const padded = String(nextN).padStart(padLen, '0');
  const candidate = prefix + padded;
  // Проверка уникальности — если занят, пробуем дальше
  for (let bump = 0; bump < 100; bump++) {
    const tag = prefix + String(nextN + bump).padStart(padLen, '0');
    let used = false;
    for (const node of state.nodes.values()) {
      if (node.tag === tag) { used = true; break; }
    }
    if (!used) return tag;
  }
  return candidate;
}

// v0.59.844: предлагает name для нового члена контейнера. Берёт name
// первого linked-члена; иначе по subtype (rack→Стойка, hvac→Кондиционер,
// motor→Двигатель и т.д.); fallback на container.name или 'Потребитель'.
function _suggestNameFromContainer(container, subtype) {
  if (!container) return null;
  if (Array.isArray(container.slots)) {
    for (const s of container.slots) {
      if (s && s.kind === 'linked' && s.nodeId) {
        const a = state.nodes.get(s.nodeId);
        if (a && a.name && a.name !== 'Потребитель') return a.name;
      }
    }
  }
  // Fallback по subtype
  const _subtypeNames = {
    'rack':         'Стойка',
    'server':       'Сервер',
    'telecom':      'Телеком-стойка',
    'lighting':     'Освещение',
    'socket':       'Розеточная группа',
    'motor':        'Двигатель',
    'fan':          'Вентилятор',
    'pump':         'Насос',
    'heater':       'Нагреватель',
    'conditioner':  'Кондиционер',
    'outdoor_unit': 'Наружный блок',
  };
  if (subtype && _subtypeNames[subtype]) return _subtypeNames[subtype];
  // Container.name (если задан как «Группа стоек» — возьмём «Стойка»)
  const cName = String(container.name || '').trim();
  if (cName) {
    if (cName.startsWith('Группа ')) return cName.slice(7).trim() || cName;
    return cName;
  }
  return null;
}

// v0.59.822: обработчики slot-actions в инспекторе consumer-container.
function _wireContainerSlots(n) {
  // Click по строке linked-slot — открыть инспектор члена.
  inspectorBody.querySelectorAll('[data-slot-open]').forEach(row => {
    row.addEventListener('click', (e) => {
      // не реагируем на клики по кнопкам/инпутам внутри строки
      if (e.target.closest('button') || e.target.closest('input')) return;
      const aid = row.getAttribute('data-slot-open');
      if (aid) selectNode(aid);
    });
  });
  // Извлечь slot — split-out: удаляем slot из контейнера, делаем consumer
  // standalone (восстанавливаем pageIds = current page).
  inspectorBody.querySelectorAll('[data-slot-extract]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-slot-extract'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'linked' || !slot.nodeId) return;
      const a = state.nodes.get(slot.nodeId);
      if (!a) return;
      snapshot('container-extract:' + n.id + ':' + a.id);
      // Восстанавливаем consumer как standalone
      delete a.containerId;
      a.pageIds = state.currentPageId ? [state.currentPageId] : [];
      // Размещаем рядом с контейнером (offset 240px вправо)
      a.x = (Number(n.x) || 0) + 240 + idx * 20;
      a.y = (Number(n.y) || 0);
      n.slots.splice(idx, 1);
      // Если контейнер опустел — удаляем его
      if (!n.slots.length) {
        try { _deleteNode(n.id, { hard: true, silent: true }); } catch {}
      }
      _render();
      renderInspector();
      notifyChange();
    });
  });
  // Разъединить slot — consumer становится unplaced (в реестре), slot
  // конвертируется в placeholder со спекой бывшего члена. Consumer НЕ
  // удаляется (пользователь: «электрик максимум мог их выкинуть из
  // группы, но не мог удалить их с проекта»).
  inspectorBody.querySelectorAll('[data-slot-unlink]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-slot-unlink'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'linked' || !slot.nodeId) return;
      const a = state.nodes.get(slot.nodeId);
      if (!a) return;
      snapshot('container-unlink:' + n.id + ':#' + idx);
      // Сохраняем спеку в slot
      n.slots[idx] = {
        kind: 'placeholder',
        demandKw: Number(a.demandKw) || 0,
        cosPhi: Number(a.cosPhi) || 0.95,
        phase: a.phase || '3ph',
        voltage: Number(a.voltage) || 400,
        voltageLevelIdx: Number(a.voltageLevelIdx) || 0,
        subtype: a.consumerSubtype || 'custom',
        kUse: Number(a.kUse) || 1,
      };
      // Consumer-узел остаётся в проекте, но без containerId — он
      // в реестре как unplaced (pageIds=[]). Пользователь сам решит
      // что с ним делать.
      delete a.containerId;
      a.pageIds = [];
      _render();
      renderInspector();
      notifyChange();
    });
  });
  // Удалить slot. Для linked-slot: consumer возвращается в реестр (НЕ
  // удаляется). Для placeholder: просто убирается. Если linked-consumer
  // имеет connections — гарантированно НЕ удалится (защита в deleteNode),
  // он становится unplaced. Контейнер с пустыми slots авто-удаляется.
  inspectorBody.querySelectorAll('[data-slot-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-slot-remove'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      snapshot('container-removeslot:' + n.id + ':#' + idx);
      if (slot && slot.kind === 'linked' && slot.nodeId) {
        // НЕ удаляем consumer — отправляем в реестр (unplaced)
        const a = state.nodes.get(slot.nodeId);
        if (a) { delete a.containerId; a.pageIds = []; }
      }
      n.slots.splice(idx, 1);
      if (!n.slots.length) {
        try { _deleteNode(n.id, { hard: true, silent: true }); } catch {}
      }
      _render();
      renderInspector();
      notifyChange();
    });
  });
  // Materialize placeholder → реальный consumer-узел.
  inspectorBody.querySelectorAll('[data-slot-materialize]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-slot-materialize'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'placeholder') return;
      snapshot('container-materialize:' + n.id + ':#' + idx);
      const newId = uid();
      const newConsumer = {
        id: newId,
        type: 'consumer',
        name: _suggestNameFromContainer(n, slot.subtype) || 'Потребитель',
        tag: _suggestTagFromContainer(n) || nextFreeTag('consumer'),
        x: Number(n.x) || 0, y: Number(n.y) || 0,
        demandKw: Number(slot.demandKw) || 0,
        cosPhi: Number(slot.cosPhi) || 0.95,
        phase: slot.phase || '3ph',
        voltage: Number(slot.voltage) || 400,
        voltageLevelIdx: Number(slot.voltageLevelIdx) || 0,
        consumerSubtype: slot.subtype || 'custom',
        kUse: Number(slot.kUse) || 1,
        inputs: 1, outputs: 0,
        count: 1,
        priorities: [1, 2],
        containerId: n.id,
        pageIds: [],
      };
      state.nodes.set(newId, newConsumer);
      n.slots[idx] = { kind: 'linked', nodeId: newId };
      _render();
      renderInspector();
      notifyChange();
    });
  });
  // Inline edit kW для placeholder.
  inspectorBody.querySelectorAll('[data-slot-kw]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.getAttribute('data-slot-kw'));
      if (!Array.isArray(n.slots) || !Number.isFinite(idx) || idx < 0 || idx >= n.slots.length) return;
      const slot = n.slots[idx];
      if (!slot || slot.kind !== 'placeholder') return;
      snapshot('container-slot-kw:' + n.id + ':#' + idx);
      slot.demandKw = Math.max(0, Number(inp.value) || 0);
      _render();
      notifyChange();
    });
  });
  // v0.59.827 (Phase 9): convert container → uniform group consumer.
  const convBtn = document.getElementById('btn-container-to-consumer');
  if (convBtn) {
    convBtn.addEventListener('click', async () => {
      if (!Array.isArray(n.slots) || !n.slots.length) return;
      // Собираем параметры: средний kW, cosPhi от первого linked-члена / placeholder
      let totalKw = 0, count = n.slots.length;
      let cosPhi = 0.95, phase = '3ph', voltage = 400, vIdx = 0, subtype = 'custom';
      let firstSet = false;
      for (const s of n.slots) {
        if (!s) continue;
        if (s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a) {
            totalKw += (Number(a.demandKw) || 0) * Math.max(1, Number(a.count) || 1);
            if (!firstSet) {
              cosPhi = Number(a.cosPhi) || cosPhi;
              phase = a.phase || phase;
              voltage = Number(a.voltage) || voltage;
              vIdx = Number(a.voltageLevelIdx) || vIdx;
              subtype = a.consumerSubtype || subtype;
              firstSet = true;
            }
          }
        } else if (s.kind === 'placeholder') {
          totalKw += Number(s.demandKw) || 0;
          if (!firstSet) {
            cosPhi = Number(s.cosPhi) || cosPhi;
            phase = s.phase || phase;
            voltage = Number(s.voltage) || voltage;
            vIdx = Number(s.voltageLevelIdx) || vIdx;
            subtype = s.subtype || subtype;
            firstSet = true;
          }
        }
      }
      const avgKw = count > 0 ? totalKw / count : 0;
      // Подтверждение — destructive
      const ok = await rsConfirm({
        title: 'Преобразовать в группового потребителя?',
        text: `Все ${count} слотов будут заменены одним consumer-узлом с count=${count}, demandKw=${avgKw.toFixed(2)} кВт. Индивидуальные tag/name членов будут потеряны. Линии (если есть) сохранятся.`,
      });
      if (!ok) return;
      snapshot('container-to-consumer:' + n.id);
      // Создаём одиночный consumer на месте контейнера
      const newId = uid();
      const newConsumer = {
        id: newId, type: 'consumer', name: 'Групповой потребитель',
        tag: nextFreeTag('consumer'),
        x: Number(n.x) || 0, y: Number(n.y) || 0,
        demandKw: avgKw, cosPhi, phase, voltage, voltageLevelIdx: vIdx,
        consumerSubtype: subtype, kUse: 1,
        inputs: Math.max(1, Number(n.inputs) || 1), outputs: 0,
        count, priorities: [1, 2],
        pageIds: Array.isArray(n.pageIds) ? n.pageIds.slice() : [],
        positionsByPage: n.positionsByPage ? JSON.parse(JSON.stringify(n.positionsByPage)) : undefined,
      };
      state.nodes.set(newId, newConsumer);
      // Re-route connections container.id → newId
      for (const c of state.conns.values()) {
        if (c.from && c.from.nodeId === n.id) c.from.nodeId = newId;
        if (c.to   && c.to.nodeId   === n.id) c.to.nodeId   = newId;
      }
      if (state.sysConns) {
        for (const sc of state.sysConns.values()) {
          if (sc.fromNodeId === n.id) sc.fromNodeId = newId;
          if (sc.toNodeId   === n.id) sc.toNodeId   = newId;
        }
      }
      // Удаляем все linked-member узлы
      for (const s of n.slots) {
        if (s && s.kind === 'linked' && s.nodeId && state.nodes.has(s.nodeId)) {
          try { _deleteNode(s.nodeId, { hard: true, silent: true, force: true }); } catch {}
        }
      }
      // Удаляем сам контейнер
      try { _deleteNode(n.id, { hard: true, silent: true, force: true }); } catch {}
      selectNode(newId);
      _render();
      notifyChange();
      try { flash(`Контейнер свёрнут в группового потребителя count=${count}`, 'success'); } catch {}
    });
  }
  // Add placeholder.
  const addBtn = document.getElementById('btn-add-placeholder');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      snapshot('container-addplaceholder:' + n.id);
      if (!Array.isArray(n.slots)) n.slots = [];
      // Дефолты — со спекой первого linked-члена, если есть
      let demandKw = 5, cosPhi = 0.95, phase = '3ph', voltage = 400, vIdx = 0, subtype = 'custom';
      for (const s of n.slots) {
        if (s && s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a) {
            demandKw = Number(a.demandKw) || demandKw;
            cosPhi = Number(a.cosPhi) || cosPhi;
            phase = a.phase || phase;
            voltage = Number(a.voltage) || voltage;
            vIdx = Number(a.voltageLevelIdx) || vIdx;
            subtype = a.consumerSubtype || subtype;
            break;
          }
        }
      }
      n.slots.push({ kind: 'placeholder', demandKw, cosPhi, phase, voltage, voltageLevelIdx: vIdx, subtype });
      renderInspector();
      _render();
      notifyChange();
    });
  }
}

// v0.58.15: блок «Системы» — чекбоксы для всех систем каталога.
// Сохраняет n.systems = ['electrical','data',...]. Если пусто — дефолт
// рассчитывается в render.getNodeSystems (обычно ['electrical']).
export function renderSystemsBlock(n) {
  // v0.58.24: синхронизируем пользовательские системы проекта в global hook
  try {
    const proj = state.project || {};
    globalThis.__raschetCustomSystems = Array.isArray(proj.customSystems) ? proj.customSystems.slice() : [];
  } catch {}
  const cur = Array.isArray(n.systems) && n.systems.length ? n.systems : ['electrical'];
  const sp = (n.systemParams && typeof n.systemParams === 'object') ? n.systemParams : {};
  const allSystems = getAllSystems();
  const renderParamInput = (sysId, p, val) => {
    const v = (val === 0 || val) ? val : '';
    const name = `data-sys-param="${escAttr(sysId)}" data-sys-key="${escAttr(p.key)}"`;
    if (p.type === 'select') {
      const opts = (p.options || []).map(o => `<option value="${escAttr(o)}"${String(v) === String(o) ? ' selected' : ''}>${escHtml(o || '—')}</option>`).join('');
      return `<select ${name} style="width:100%;font:inherit;font-size:12px;padding:3px 4px">${opts}</select>`;
    }
    if (p.type === 'number') {
      const hasMax = Number.isFinite(p.max);
      const hasMin = Number.isFinite(p.min);
      const outOfRange = (v !== '' && ((hasMin && Number(v) < p.min) || (hasMax && Number(v) > p.max)));
      return `<input type="number" ${name} value="${escAttr(v)}"${hasMin ? ` min="${p.min}"` : ''}${hasMax ? ` max="${p.max}"` : ''}${p.step ? ` step="${p.step}"` : ''} style="width:100%;font:inherit;font-size:12px;padding:3px 4px${outOfRange ? ';border-color:#dc2626;background:#fef2f2' : ''}">`;
    }
    return `<input type="text" ${name} value="${escAttr(v)}" style="width:100%;font:inherit;font-size:12px;padding:3px 4px">`;
  };
  const isCustom = (sysId) => {
    try {
      return Array.isArray(state.project?.customSystems) &&
        state.project.customSystems.some(s => s.id === sysId);
    } catch { return false; }
  };
  // v0.58.38: только on/off чипы; параметры включённых систем показываются
  // отдельными вкладками (renderExtraSystemTabs).
  const items = allSystems.map(s => {
    const on = cur.includes(s.id);
    const custom = isCustom(s.id);
    const hasParams = Array.isArray(s.params) && s.params.length;
    const paramsHint = on && hasParams
      ? `<span class="muted" style="font-size:10px;margin-left:4px">→ вкладка «${escHtml(s.label)}»</span>`
      : '';
    const manageBtns = custom ? `
      <button type="button" class="sys-manage" data-sys-manage-add="${escAttr(s.id)}" title="Добавить параметр" style="margin-left:auto;font-size:10px;padding:2px 6px;border:1px solid ${s.color};background:#fff;border-radius:3px;cursor:pointer;color:${s.color}">+ параметр</button>
      <button type="button" class="sys-manage" data-sys-manage-del="${escAttr(s.id)}" title="Удалить систему проекта" style="font-size:10px;padding:2px 6px;border:1px solid #dc2626;background:#fff;border-radius:3px;cursor:pointer;color:#dc2626;margin-left:4px">✕</button>` : '';
    return `<label class="sys-chip" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;border:1px solid ${on ? s.color : '#e0e3ea'};border-radius:4px;cursor:pointer;background:${on ? s.color + '15' : '#fff'}">
      <input type="checkbox" data-sys="${escAttr(s.id)}"${on ? ' checked' : ''} style="margin:0">
      <span style="font-size:14px">${s.icon}</span>
      <span style="font-weight:600;color:${s.color}">${escHtml(s.label)}</span>
      ${custom ? '<span class="muted" style="font-size:10px;margin-left:4px">custom</span>' : ''}
      ${paramsHint}
      ${manageBtns}
    </label>`;
  }).join('');
  return `<div class="inspector-section">
    <h4>Системы элемента</h4>
    <div class="muted" style="font-size:11px;margin-bottom:8px">
      Включите системы, к которым относится элемент. Параметры каждой включённой
      системы редактируются на отдельной вкладке (появляется автоматически).
    </div>
    ${items}
    <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e0e3ea">
      <button type="button" class="full-btn" id="btn-add-custom-system" style="font-size:11px">➕ Добавить свою систему…</button>
      <div class="muted" style="font-size:10px;margin-top:4px">Пользовательская система сохраняется в проекте (state.project.customSystems).</div>
    </div>
  </div>`;
}

// v0.58.38: параметры одной системы — для вкладки «<Система>».
export function renderSystemParamsPanel(n, sysId) {
  try {
    const proj = state.project || {};
    globalThis.__raschetCustomSystems = Array.isArray(proj.customSystems) ? proj.customSystems.slice() : [];
  } catch {}
  const meta = getSystemMeta(sysId);
  if (!meta) return '';
  const sp = (n.systemParams && typeof n.systemParams === 'object') ? n.systemParams : {};
  const vals = (sp[sysId] && typeof sp[sysId] === 'object') ? sp[sysId] : {};
  // v0.58.52 (1.22.4): если узел привязан к продукту из каталога, его
  // systemRanges переопределяют min/max/default параметра для этого sysId.
  let product = null;
  if (n.productId) {
    const catalog = Array.isArray(state.project?.productCatalog) ? state.project.productCatalog : [];
    product = catalog.find(p => p.id === n.productId) || null;
  }
  const ranges = (product && product.systemRanges && product.systemRanges[sysId]) || null;
  const params = (Array.isArray(meta.params) ? meta.params : []).map(p => {
    if (!ranges) return p;
    const r = ranges[p.key];
    if (!r) return p;
    const merged = { ...p };
    if (Number.isFinite(r.min)) merged.min = r.min;
    if (Number.isFinite(r.max)) merged.max = r.max;
    return merged;
  });
  const renderParamInput = (p, val) => {
    const v = (val === 0 || val) ? val : '';
    const name = `data-sys-param="${escAttr(sysId)}" data-sys-key="${escAttr(p.key)}"`;
    if (p.type === 'select') {
      const opts = (p.options || []).map(o => `<option value="${escAttr(o)}"${String(v) === String(o) ? ' selected' : ''}>${escHtml(o || '—')}</option>`).join('');
      return `<select ${name} style="width:100%;font:inherit;font-size:12px;padding:3px 4px">${opts}</select>`;
    }
    if (p.type === 'number') {
      const hasMax = Number.isFinite(p.max);
      const hasMin = Number.isFinite(p.min);
      const outOfRange = (v !== '' && ((hasMin && Number(v) < p.min) || (hasMax && Number(v) > p.max)));
      return `<input type="number" ${name} value="${escAttr(v)}"${hasMin ? ` min="${p.min}"` : ''}${hasMax ? ` max="${p.max}"` : ''}${p.step ? ` step="${p.step}"` : ''} style="width:100%;font:inherit;font-size:12px;padding:3px 4px${outOfRange ? ';border-color:#dc2626;background:#fef2f2' : ''}">`;
    }
    return `<input type="text" ${name} value="${escAttr(v)}" style="width:100%;font:inherit;font-size:12px;padding:3px 4px">`;
  };
  const isCustom = Array.isArray(state.project?.customSystems) &&
    state.project.customSystems.some(s => s.id === sysId);
  const manage = isCustom
    ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e0e3ea;display:flex;gap:6px;flex-wrap:wrap">
         <button type="button" class="sys-manage" data-sys-manage-add="${escAttr(sysId)}" style="font-size:11px;padding:4px 8px;border:1px solid ${meta.color};background:#fff;border-radius:3px;cursor:pointer;color:${meta.color}">+ параметр</button>
         <button type="button" class="sys-manage" data-sys-manage-del="${escAttr(sysId)}" style="font-size:11px;padding:4px 8px;border:1px solid #dc2626;background:#fff;border-radius:3px;cursor:pointer;color:#dc2626">✕ удалить систему</button>
       </div>`
    : '';
  const productHint = (product && ranges)
    ? `<div class="muted" style="font-size:11px;margin-bottom:6px">Диапазоны из изделия <b>${escHtml(product.name || product.modelRef || product.id)}</b>${product.manufacturer ? ' (' + escHtml(product.manufacturer) + ')' : ''} — каталог проекта.</div>`
    : '';
  if (!params.length) {
    return `<div class="inspector-section">
      <h4 style="color:${meta.color}">${meta.icon} ${escHtml(meta.label)}</h4>
      ${productHint}
      <div class="muted" style="font-size:11px">У этой системы ещё нет параметров.${isCustom ? ' Добавьте первый — ниже.' : ''}</div>
      ${manage}
    </div>`;
  }
  const rows = params.map(p => {
    const unit = p.unit ? `<span class="muted" style="font-size:10px;margin-left:4px">${escHtml(p.unit)}</span>` : '';
    // v0.58.49: диапазон по каталогу (min..max) — подсказка для per-instance
    // ввода проектных данных. Пользователь видит «окно допустимых значений».
    let rangeHint = '';
    if (p.type === 'number' && (Number.isFinite(p.min) || Number.isFinite(p.max))) {
      const lo = Number.isFinite(p.min) ? p.min : '…';
      const hi = Number.isFinite(p.max) ? p.max : '…';
      const u = p.unit ? ' ' + p.unit : '';
      rangeHint = `<span class="muted" style="font-size:10px;margin-left:8px">диапазон: ${lo}…${hi}${u}</span>`;
    }
    return `<label style="display:block;font-size:11px;margin-top:6px">
      <span style="color:#555">${escHtml(p.label)}${unit}${rangeHint}</span>
      ${renderParamInput(p, vals[p.key])}
    </label>`;
  }).join('');
  // v0.58.51 (1.22.3): акцент-цвет на уровне панели (data-sys-accent),
  // а не на внутреннем div — единый стиль с другими вкладками.
  return `<div class="inspector-section">
    <h4 style="color:${meta.color}">${meta.icon} ${escHtml(meta.label)}</h4>
    ${productHint}
    <div style="padding:4px 0">${rows}</div>
    ${manage}
  </div>`;
}

// v0.58.47: карта «тип → конфигуратор». Кнопка «Конфигурировать…» на
// вкладке Общее открывает соответствующий модуль в новой вкладке.
const _CONFIGURATORS = {
  // {href, label} — какой модуль открывать для данного n
  transformer: { href: 'transformer-config/', label: 'Конфигуратор трансформатора' },
  panel:       { href: 'panel-config/',       label: 'Конфигуратор НКУ' },
  panelMv:     { href: 'mv-config/',          label: 'Конфигуратор РУ СН' },
  ups:         { href: 'ups-config/',         label: 'Конфигуратор ИБП' },
  rack:        { href: 'rack-config/',        label: 'Конфигуратор стойки' },
  scs:         { href: 'scs-config/',         label: 'Конфигуратор СКС/телеком (в разработке)' },
  // v0.60.202 (по репорту Пользователя 2026-05-04 «у нас вроде уже появился
  // конфигуратор ДГУ, почему бы не привязать его к схеме»): добавлен
  // конфигуратор ДГУ для type='generator'.
  generator:   { href: 'dgu-config/',         label: 'Конфигуратор ДГУ' },
};
function _configuratorForNode(n) {
  if (!n) return null;
  if (n.type === 'source' || n.type === 'generator') {
    const sub = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    if (sub === 'transformer') return _CONFIGURATORS.transformer;
    if (sub === 'generator' || n.type === 'generator') return _CONFIGURATORS.generator;
    return null;
  }
  if (n.type === 'panel') return n.isMv ? _CONFIGURATORS.panelMv : _CONFIGURATORS.panel;
  if (n.type === 'ups') return _CONFIGURATORS.ups;
  // v0.58.47: consumer-стойка (серверная/телеком) → конфигуратор стойки
  if (n.type === 'consumer' && (n.subtype === 'rack' || n.consumerKind === 'rack')) {
    return _CONFIGURATORS.rack;
  }
  return null;
}

// v0.58.47: панель «Общее» — основные идентификаторы и быстрый доступ к
// модулю-конфигуратору. Вкладки Электрика/Габариты/Системы содержат
// только свои тематические поля; Общее собирает общий фундамент.
export function renderGeneralPanel(n) {
  const h = [];
  // v0.60.278 (по уточнению Пользователя 2026-05-06 «опять же это все должно
  // быть привязано только к проекту. Отдельно такие списки не актуальны»):
  // chip-info «Также в системах: ...» убран. Электрику не нужно видеть
  // информацию о других дисциплинах — это шум. Multi-discipline концепция
  // живёт ТОЛЬКО в проектном контексте (Tech-workspace / ГИП / Администратор).
  // Конструктор схем = чистая дисциплина электрика, без отвлечений.
  // Данные n.systems сохраняются — Tech-workspace их видит и редактирует.
  // v0.58.49: «В работе» — общий переключатель эксплуатационного состояния.
  // Применим к source/generator/ups (остальные не имеют бинарного on/off).
  // Выключенный узел пропадает из расчёта всех систем, а не только электрики.
  if (n.type === 'source' || n.type === 'generator' || n.type === 'ups') {
    const on = effectiveOn(n);
    h.push(`<div class="inspector-section" style="margin-top:0;padding-top:0;border-top:0">`);
    h.push(`<div class="field check" style="margin-bottom:4px"><input type="checkbox" data-prop="on"${on ? ' checked' : ''}><label style="font-weight:600">В работе</label></div>`);
    // Подсказка: изменения «В работе» сохраняются в активном режиме
    if (state.activeModeId) {
      const m = state.modes.find(x => x.id === state.activeModeId);
      if (m) h.push(`<div class="muted" style="font-size:11px">Сохраняется в режиме <b>${escHtml(m.name || '')}</b>. Влияет на все системы.</div>`);
    }
    h.push(`</div>`);
  }
  h.push(`<div class="inspector-section">`);
  h.push(`<h4>Идентификация</h4>`);
  h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}" placeholder="T1, ЩС-1, K12, ...">`));
  const eff = effectiveTag(n);
  if (eff && eff !== n.tag) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное обозначение: <b>${escHtml(eff)}</b></div>`);
  }
  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name || '')}">`));
  // v0.59.886: контейнер потребителей не имеет инвентарного номера / S/N /
  // модели — это организационная обёртка, а не физический экземпляр.
  // Пользователь: «модель изделие и прочие применимое к конкретному
  // экземпляру нужно удалить из группы».
  const _isContainerNode = n.type === 'consumer-container';
  if (!_isContainerNode) {
    h.push(field('Инв. №&nbsp;/&nbsp;паспорт', `<input type="text" data-prop="assetId" value="${escAttr(n.assetId || '')}" placeholder="например, INV-0042">`));
    h.push(field('Серийный №', `<input type="text" data-prop="serialNo" value="${escAttr(n.serialNo || '')}" placeholder="необязательно">`));
  }
  // v0.59.351: автоматический матч с реестрами проекта по S/N или Инв.№.
  // Если узел уже описан в реестре IT (scs-config) или объекта (facility-
  // inventory) — показываем чип со ссылкой. Чисто read-only, никаких полей
  // на узле не добавляем (lookup делается каждый раз при рендере инспектора).
  // v0.59.886: для контейнера весь блок registry-link пропускается.
  if (!_isContainerNode) try {
    if ((n.serialNo && n.serialNo.trim()) || (n.assetId && n.assetId.trim())) {
      const pid = _activeProjectId();
      const m = findInventoryMatch(pid, n.serialNo || '', n.assetId || '');
      if (m) {
        if (m.kind === 'it') {
          const tag = m.rackTag ? ` · стойка <b>${escHtml(m.rackTag)}</b>` : '';
          const devLabel = (m.device && (m.device.label || m.device.name)) || '?';
          h.push(`<div style="margin-top:6px;padding:6px 10px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:4px;font-size:11px;color:#065f46">
            ✓ Найден в реестре IT: <b>${escHtml(devLabel)}</b>${tag}
            <a href="scs-config/inventory.html" style="margin-left:8px;color:#047857" title="Открыть реестр IT-оборудования">→ открыть</a>
          </div>`);
        } else if (m.kind === 'facility') {
          const itLabel = (m.item && (m.item.name || m.item.label)) || '?';
          h.push(`<div style="margin-top:6px;padding:6px 10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;font-size:11px;color:#92400e">
            ✓ Найден в реестре объекта: <b>${escHtml(itLabel)}</b>
            <a href="facility-inventory/" style="margin-left:8px;color:#b45309" title="Открыть реестр оборудования объекта">→ открыть</a>
          </div>`);
        }
      } else {
        h.push(`<div class="muted" style="margin-top:6px;font-size:11px;opacity:0.7">
          🔍 В реестрах проекта не найден (по S/N или Инв.№)
        </div>`);
      }
    }
    // v0.59.353: кнопки ручной привязки и создания записи. Показываем всегда —
    // даже если S/N пуст (тогда picker сам заполнит поле выбранным значением).
    // v0.59.563: для consumer-rack узлов IT-реестр не релевантен (реестр
    // для устройств ВНУТРИ стоек, а сама стойка — инфраструктура).
    // Заменяем на «🗄 Открыть в Компоновщике» (наполнение PDU/устройствами)
    // и индикатор POR-объекта (mirror связан или нет).
    const isRackNode = n.type === 'consumer' && (n.subtype === 'rack' || n.consumerKind === 'rack');
    if (isRackNode) {
      // v0.59.633: передаём return-URL чтобы кнопка «Назад» возвращалась
      // в эту же схему, а не на главную выбора схемы.
      const compHref = 'scs-config/rack.html?from=schematic&schemeNodeId=' + encodeURIComponent(n.id)
        + '&return=' + encodeURIComponent(location.href);
      const porBadge = n.porObjectId
        ? `<span title="Связан с POR-объектом ${escAttr(n.porObjectId)} (engine↔POR mirror)" style="font-size:11px;padding:3px 8px;border:1px solid #86efac;background:#f0fdf4;color:#14532d;border-radius:3px">🔗 POR ✓</span>`
        : `<span title="Нет связи с POR — mirror создаст объект при следующем sync" style="font-size:11px;padding:3px 8px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:3px">🔗 POR —</span>`;
      h.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <a href="${escAttr(compHref)}" target="_blank" rel="noopener" style="font-size:11px;padding:3px 8px;border:1px solid #86efac;background:#f0fdf4;color:#14532d;border-radius:3px;text-decoration:none">🗄 Открыть в Компоновщике</a>
        ${porBadge}
      </div>`);
    } else {
      h.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button type="button" data-action="link-inventory" style="font-size:11px;padding:3px 8px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:3px;cursor:pointer">🔗 Привязать вручную…</button>
        <button type="button" data-action="create-inventory-it" style="font-size:11px;padding:3px 8px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:3px;cursor:pointer">➕ Создать запись в реестре IT</button>
      </div>`);
    }
  } catch {}
  if (!_isContainerNode) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px">UUID: <code style="font-size:11px">${escHtml(n.id)}</code></div>`);
  }
  h.push(`</div>`);

  // v0.59.835: блок «Назначение» УБРАН — ранее дублировал «Категория + Тип
  // потребителя» в модалке параметров. Пользователь: «Не стоит использовать
  // подтип и категорию если они абсолютно дублируют друг друга». Назначение
  // теперь полностью определяется через `consumerSubtype` (запись каталога) —
  // см. модалку «⚙ Параметры потребителя».  `n.subtype` авто-выводится из
  // category каталожной записи (см. derive-helper в consumer.js apply).

  // Блок «Модель/изделие»
  const cfg = _configuratorForNode(n);
  const modelRef = n.modelRef || '';
  // v0.59.87: для щитов (panel) состав = конфигуратор, а не отдельное
  // каталожное изделие. «Производитель / Выбранное изделие» для панели
  // вводили в заблуждение — их скрываем. Для всех остальных узлов
  // поведение прежнее.
  const isPanelNode = n.type === 'panel';
  // v0.59.886: для контейнера блок «Модель изделия» полностью скрыт —
  // контейнер не имеет производителя/изделия, это организационная
  // обёртка. Параметры — у конкретных слотов внутри.
  if (!_isContainerNode) {
  h.push(`<div class="inspector-section">`);
  h.push(`<h4>${isPanelNode ? 'Конфигурация щита' : 'Модель изделия'}</h4>`);

  // v0.58.52 (1.22.4): подборка подходящих изделий из каталога проекта.
  // Продукт хранит диапазоны параметров систем; узел ссылается на продукт
  // через n.productId — renderSystemParamsPanel читает ранжи отсюда.
  const catalog = Array.isArray(state.project?.productCatalog) ? state.project.productCatalog : [];
  const matches = catalog.filter(p => {
    if (p.type && p.type !== n.type) return false;
    if (p.subtype && n.subtype && p.subtype !== n.subtype) return false;
    return true;
  });
  if (matches.length && !isPanelNode) {
    const cur = n.productId || '';
    const opts = ['<option value="">— не выбрано —</option>']
      .concat(matches.map(p => `<option value="${escAttr(p.id)}"${cur === p.id ? ' selected' : ''}>${escHtml(p.name || p.modelRef || p.id)}${p.manufacturer ? ' · ' + escHtml(p.manufacturer) : ''}</option>`))
      .join('');
    h.push(field('Изделие из каталога', `<select data-prop="productId">${opts}</select>`));
  }

  if (!isPanelNode) {
    h.push(field('Производитель', `<input type="text" data-prop="manufacturer" value="${escAttr(n.manufacturer || '')}" placeholder="ABB, Schneider, Legrand, ...">`));
    h.push(field('Выбранное изделие',
      `<input type="text" data-prop="modelRef" value="${escAttr(modelRef)}" placeholder="Не выбрано">`));
  }

  // v0.58.52: сохранить текущие параметры как изделие в каталог
  if (modelRef || n.manufacturer) {
    h.push(`<button type="button" data-action="save-product" style="display:block;margin-top:8px;width:100%;padding:6px;font-size:12px;border:1px solid #0ea5e9;background:#f0f9ff;color:#075985;border-radius:3px;cursor:pointer">💾 Сохранить как изделие в каталог проекта…</button>`);
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px">Создаст запись в каталоге изделий со всеми текущими параметрами систем в роли min/max/default. Другие узлы того же типа смогут выбрать это изделие и получить эти диапазоны.</div>`);
  }

  if (cfg) {
    // v0.58.60 (1.23.10): для rack-конфигуратора передаём nodeId и
    // экспортируем текущую конфигурацию стойки в bridge-ключ localStorage,
    // чтобы модуль мог её подхватить, показать и вернуть обратно.
    let href = cfg.href;
    if (cfg === _CONFIGURATORS.rack) {
      const bridgeKey = 'raschet.rack.bridge.' + n.id;
      try {
        const existing = n.rackTemplate || null;
        // v0.58.62 (1.23.10+): собираем вводы узла для валидации PDU по
        // доступной мощности и режиму резервирования (2N при двух вводах
        // с приоритетом 1 — как у обычного потребителя).
        const feeds = [];
        const inCount = typeof n._inCount === 'number' ? n._inCount
                        : (Array.isArray(n.priorities) ? n.priorities.length : 1);
        for (let i = 0; i < inCount; i++) {
          // метка ввода — по индексу: 0→A, 1→B, …
          const label = String.fromCharCode(65 + i);
          const priority = (n.priorities && n.priorities[i]) ?? (i + 1);
          // availableKw — оцениваем как demandKw узла (предположение: каждый
          // ввод рассчитан на полную нагрузку). Если расчётный _maxFeedKw
          // доступен — используем его; иначе deman­dKw самого узла.
          const availKw = (Array.isArray(n._feedAvailableKw) && n._feedAvailableKw[i] != null)
            ? Number(n._feedAvailableKw[i])
            : (Number(n.demandKw) || 0);
          feeds.push({ portIdx: i, label, priority, availableKw: availKw });
        }
        localStorage.setItem(bridgeKey, JSON.stringify({
          applied: false, ts: Date.now(),
          template: existing || null,
          feeds,
        }));
      } catch {}
      href = cfg.href + (cfg.href.includes('?') ? '&' : '?') + 'nodeId=' + encodeURIComponent(n.id);
    }
    // v0.59.87: для панельных конфигураторов (LV/MV) — передаём полный
    // контекст (как в вкладке «Электрика»), чтобы wizard не стартовал
    // с нуля, а увидел узел, имя, inputs/outputs, нагрузку, IP.
    if (cfg === _CONFIGURATORS.panel) {
      const qp = new URLSearchParams();
      qp.set('nodeId', n.id);
      if (n.name) qp.set('name', n.name);
      if (n.switchMode === 'avr') qp.set('kind', 'avr'); else qp.set('kind', 'distribution');
      if (n._loadKw) qp.set('loadKw', String(n._loadKw));
      if (n.inputs) qp.set('inputs', String(n.inputs));
      if (n.outputs) qp.set('outputs', String(n.outputs));
      if (n.ipRating) qp.set('ip', n.ipRating);
      href = cfg.href + '?' + qp.toString();
    } else if (cfg === _CONFIGURATORS.panelMv) {
      const qp = new URLSearchParams();
      qp.set('nodeId', n.id);
      if (n.name) qp.set('name', n.name);
      if (n.capacityA) qp.set('In_A', String(n.capacityA));
      if (n.mvSwitchgearId) qp.set('lockedId', n.mvSwitchgearId);
      href = cfg.href + '?' + qp.toString();
    } else if (cfg === _CONFIGURATORS.generator) {
      // v0.60.210 (исправление v0.60.207 + по репорту Пользователя 2026-05-04
      // «давай вернемся к передачи актуальной нагрузки в конфигуратор ДГУ»):
      // имена URL-params исправлены под то, что dgu-config.js readUrlParams
      // реально читает: «capacityKw» (не «loadKw»), «rh» (не «humidity»).
      // Дополнительно передаём «project» — чтобы dgu-config-сам подтянул
      // location/climate из активного проекта если URL-params не задали.
      const qp = new URLSearchParams();
      qp.set('nodeId', n.id);
      if (n.name) qp.set('name', n.name);
      // Project — чтобы dgu-config мог сам читать project.location при
      // отсутствии явных climate-params (его _hydrateFromContext делает
      // location-fallback).
      try {
        const pid = _activeProjectId();
        if (pid) qp.set('project', pid);
      } catch {}
      // v0.60.309 (по уточнению Пользователя 2026-05-06: «расчет он для того
      // и расчет, что мы задаём сколько нужно, а не сколько есть»):
      // Конфигуратор подбирает по ТРЕБУЕМОЙ (downstream) нагрузке, а не по
      // ранее установленному nameplate ДГУ. Раньше брался MAX(maxLoadKw,
      // n.capacityKw, _maxDownstreamUncapped) — это «фиксировало» прежний
      // выбор и не давало уменьшить размер ДГУ при перепроектировании.
      // Теперь — только из реального downstream demand.
      const _maxLoadKw = Number(n._maxLoadKw) || 0;
      const _uncapped = Number(n._maxDownstreamUncapped) || 0;
      const reqKw = Math.max(_maxLoadKw, _uncapped);
      if (reqKw > 0) qp.set('capacityKw', String(Math.ceil(reqKw)));
      // v0.60.310 (по уточнению Пользователя 2026-05-06: «но при этом забирай
      // так же и кВА, так как это так же важно для подбора ДГУ»): передаём
      // также S (полную мощность в кВА). cos φ узла-генератора берётся из
      // n._cosPhi (downstream weighted), fallback — n.cosPhi (паспорт ДГУ),
      // далее GLOBAL.defaultCosPhi. Snom (кВА) = P_кВт / cos φ.
      const _cosPhiUsed = Number(n._cosPhi) || Number(n.cosPhi) || (window.__GLOBAL_cosPhi || 0.92);
      const reqKva = _cosPhiUsed > 0 ? reqKw / _cosPhiUsed : reqKw / 0.92;
      if (reqKva > 0) qp.set('capacityKva', String(Math.ceil(reqKva)));
      qp.set('cosPhi', String(_cosPhiUsed.toFixed(3)));
      // Breakdown — для отображения «📐 как получено» в dgu-config.
      const breakdown = JSON.stringify({
        maxLoadKw: Math.round(_maxLoadKw * 10) / 10,
        uncapped: Math.round(_uncapped * 10) / 10,
        cosPhi: Math.round(_cosPhiUsed * 1000) / 1000,
        reqKva: Math.round(reqKva * 10) / 10,
      });
      qp.set('breakdown', breakdown);
      // Климат: из активного проекта project.location.{altitudeM, ambientTC,
      // humidityPct}.
      try {
        const _ls = (typeof localStorage !== 'undefined') ? localStorage : null;
        if (_ls) {
          const raw = _ls.getItem('raschet.projects.v1');
          const arr = raw ? JSON.parse(raw) : [];
          const pid = _activeProjectId();
          const proj = Array.isArray(arr) ? arr.find(p => p && p.id === pid) : null;
          const loc = proj && proj.location;
          if (loc) {
            if (Number.isFinite(Number(loc.altitudeM))) qp.set('altitude', String(Number(loc.altitudeM)));
            if (Number.isFinite(Number(loc.ambientTC))) qp.set('tamb', String(Number(loc.ambientTC)));
            if (Number.isFinite(Number(loc.humidityPct))) qp.set('rh', String(Number(loc.humidityPct)));
          }
        }
      } catch {}
      // Резервный/основной режим (PRP/COP/ESP/LTP per ISO 8528-1).
      // backup=true → ESP (резерв), false → PRP (основной).
      qp.set('mode', n.backupMode ? 'ESP' : 'PRP');
      // Резервирование: n.redundancy если задано (формат «N+1» и т.п.).
      if (n.redundancy) qp.set('redundancy', n.redundancy);
      // Автономия — если задана auxAutonomyHr / fuelAutonomyHr.
      const autonomyHr = Number(n.fuelAutonomyHr) || Number(n.autonomyHr) || 0;
      if (autonomyHr > 0) qp.set('autonomy', String(autonomyHr));
      // Vendor preference (если уже задан).
      if (n.manufacturer) qp.set('vendor', n.manufacturer);
      href = cfg.href + '?' + qp.toString();
    }
    const isPanel = (cfg === _CONFIGURATORS.panel || cfg === _CONFIGURATORS.panelMv);
    h.push(`<a class="full-btn" href="${escAttr(href)}" target="_blank" rel="noopener" style="display:block;margin-top:8px;text-align:center;text-decoration:none">🔧 ${escHtml(cfg.label)}</a>`);
    // v0.59.546: для consumer-rack — дополнительная ссылка прямо в Компоновщик
    // шкафа (наполнение PDU/устройствами), отдельно от rack-config (корпус).
    // ?from=schematic даёт back-link «← Назад в Конструктор схем».
    if (cfg === _CONFIGURATORS.rack) {
      // v0.59.547: открываем Компоновщик с явным контекстом — schemeNodeId
      // данного узла, чтобы там автоматически выбрался первый виртуал
      // (count>1 → SR1-1 как стартовый), а не случайная стойка из списка.
      // v0.59.633: + return-URL для кнопки «Назад».
      const qp = new URLSearchParams();
      qp.set('from', 'schematic');
      qp.set('schemeNodeId', n.id);
      qp.set('return', location.href);
      const compHref = 'scs-config/rack.html?' + qp.toString();
      h.push(`<a class="full-btn" href="${escAttr(compHref)}" target="_blank" rel="noopener" style="display:block;margin-top:6px;text-align:center;text-decoration:none;background:#f0fdf4;color:#14532d;border-color:#86efac">🗄 Компоновщик шкафа (наполнение)</a>`);
    }
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px">${
      isPanel
        ? 'Оболочка, шины, автоматы, учёт, ТТ, мониторинг и аксессуары — всё в wizard конфигуратора. Wizard видит реальные связи узла (ток/тип линии).'
        : 'Выбор конкретной модели из каталога и конкретные параметры — в отдельном модуле.'
    }${cfg === _CONFIGURATORS.rack ? ' После настройки нажмите в модуле «↩ Применить к узлу схемы». Наполнение PDU/устройствами — в Компоновщике (количество стоек count=N развёрнуто в N виртуалов).' : ''}</div>`);

    // v0.60.217: если к узлу-генератору применена ДГУ — показываем сводку
    // (round-trip из dgu-config через postMessage('raschet.dgu.apply')).
    // v0.60.222: tooltips на каждом поле (правило feedback_tooltips).
    // v0.60.224 (по репорту Пользователя 2026-05-04 «при выходе запрашиваемой
    // мощности за пределы подобранного ДГУ, нужно оповещать пользователя»):
    // если n._maxLoadKw > capacityKw — блок становится красным с alert-иконкой
    // и показывает % перегруза.
    if (cfg === _CONFIGURATORS.generator && n.appliedConfig?.dgu) {
      const cfgDgu = n.appliedConfig.dgu;
      const sel = cfgDgu.selected || {};
      const sp  = cfgDgu.spec || {};
      const ageMin = cfgDgu.ts ? Math.round((Date.now() - cfgDgu.ts) / 60000) : null;
      const ageStr = ageMin == null ? '' : (ageMin < 1 ? 'только что' : ageMin < 60 ? `${ageMin} мин назад` : `${Math.round(ageMin / 60)} ч назад`);
      const _t = (txt, tooltip) => `<span title="${escAttr(tooltip)}">${txt}</span>`;
      // v0.60.224: проверка перегруза.
      const _reqKw = Math.max(Number(n._maxLoadKw) || 0, Number(n._maxDownstreamUncapped) || 0);
      const _capKw = Number(n.capacityKw) || Number(sel.nameplateKw) || 0;
      const _exceeded = _capKw > 0 && _reqKw > _capKw;
      const _exceedPct = _exceeded ? ((_reqKw - _capKw) / _capKw * 100) : 0;
      const _close = !_exceeded && _capKw > 0 && _reqKw >= 0.85 * _capKw;
      const modelLine = (sel.vendor || sel.model)
        ? _t(`${sel.vendor ? escHtml(sel.vendor) + ' ' : ''}<b>${escHtml(sel.model || '')}</b>`,
             `Производитель и модель ДГУ из каталога. Записано через apply из dgu-config (postMessage 'raschet.dgu.apply').`)
        : '';
      const nameplateBlock = sel.nameplateKw
        ? '<br>' + _t('Номинал: ' + Number(sel.nameplateKw).toFixed(0) + ' кВт',
                      `Nameplate-мощность установки (один блок). По выбранному режиму ISO 8528. Используется как верхний лимит capacityKw в схеме.`)
        : '';
      const modeBlock = sp.mode
        ? ' · ' + _t('режим ' + escHtml(sp.mode),
            sp.mode === 'ESP' ? 'Emergency Standby Power. До 200 ч/год. Без перегрузки.' :
            sp.mode === 'PRP' ? 'Prime Power. Постоянный режим, ≤70% nameplate средн. 10% перегрузка 1ч из 12.' :
            sp.mode === 'COP' ? 'Continuous Operating Power. 24/7 при 100% постоянной нагрузке.' :
            sp.mode === 'LTP' ? 'Limited-Time Prime. До 500 ч/год при 100% нагрузке.' :
            sp.mode === 'DCC' ? 'Data Centre Continuous (ISO 8528-13). 24/7 для критической IT-нагрузки.' :
            sp.mode === 'DCP' ? 'Data Centre Prime (ISO 8528-13). PRP-аналог для ЦОД.' :
            sp.mode === 'DCS' ? 'Data Centre Standby (ISO 8528-13). Резерв ЦОД с запуском ≤10 сек.' :
            sp.mode === 'MCSP' ? 'Mission Critical Standby (Tier IV).' :
            'Режим ДГУ по ISO 8528.')
        : '';
      const qtyBlock = (sp.qty && sp.qty > 1)
        ? ' · ' + _t('кол-во ' + sp.qty,
            'Количество единиц ДГУ. ' + (sp.redundancy === 'N+1' ? 'N+1: 1 рабочий + 1 резервный.' : sp.redundancy === '2N' ? '2N: полное дублирование.' : 'N: без резерва.'))
        : '';
      const engineBlock = sel.engineModel
        ? '<br>' + _t('Двигатель: ' + escHtml(sel.engineModel),
            'Дизельный двигатель ДГУ' + (sel.cylinders ? `, ${sel.cylinders} цилиндров` : '') + (sel.displacement ? `, ${Number(sel.displacement).toFixed(1)} L` : '') + '. Из datasheet производителя.')
        : '';
      const sfcBlock = sel.sfcLkWh
        ? ' · ' + _t('SFC ' + Number(sel.sfcLkWh).toFixed(3) + ' л/кВт·ч',
            'Specific Fuel Consumption — расход топлива на единицу выработанной энергии при 75% нагрузке (ISO 3046-1). Используется в расчётах объёма бака и стоимости автономии.')
        : '';
      const derateBlock = Number.isFinite(Number(sp.derateMultiplier))
        ? '<br>' + _t('Climate derate: ' + (Number(sp.derateMultiplier) * 100).toFixed(1) + '% от nameplate',
            'Climate derate по ISO 3046-1: высота, T наружного воздуха, влажность снижают доступную мощность от nameplate. Учитывается при подборе размера ДГУ.')
        : '';
      // v0.60.224: цвет блока зависит от состояния перегруза.
      const _bgColor   = _exceeded ? '#fef2f2' : (_close ? '#fff7ed' : '#f0fdf4');
      const _borderCol = _exceeded ? '#b91c1c' : (_close ? '#c2410c' : '#16a34a');
      const _txtColor  = _exceeded ? '#7f1d1d' : (_close ? '#7c2d12' : '#14532d');
      const _statusIcon = _exceeded ? '⛔' : (_close ? '⚠' : '✓');
      const _statusText = _exceeded ? 'ДГУ ПЕРЕГРУЖЕНА' : (_close ? 'ДГУ близка к пределу' : 'ДГУ сконфигурирована');
      const _capacityWarning = _exceeded
        ? `<div style="margin-top:6px;padding:6px 8px;background:#fee2e2;border-radius:3px;font-size:11.5px;font-weight:600"
             title="Запрашиваемая мощность узла превышает паспортный номинал применённой модели. Откройте конфигуратор и выберите более крупную модель — либо распределите нагрузку.">
             ⛔ Запрашиваемая мощность <b>${_reqKw.toFixed(1)} кВт</b> превышает номинал ДГУ <b>${_capKw.toFixed(0)} кВт</b> на <b>+${_exceedPct.toFixed(1)}%</b>.<br>
             Откройте <a href="../dgu-config/?nodeId=${escAttr(n.id)}" target="_blank" style="color:#7f1d1d;text-decoration:underline">конфигуратор ДГУ</a> и выберите более мощную модель.
           </div>`
        : (_close
          ? `<div style="margin-top:6px;padding:6px 8px;background:#ffedd5;border-radius:3px;font-size:11.5px"
               title="Запрашиваемая мощность близка к пределу применённой модели (≥85%). Рекомендуется запас минимум 15-20% для долгосрочной эксплуатации.">
               ⚠ Запрашиваемая <b>${_reqKw.toFixed(1)} кВт</b> близка к номиналу <b>${_capKw.toFixed(0)} кВт</b> (${(_reqKw/_capKw*100).toFixed(0)}%). Рекомендуется запас ≥15-20%.
             </div>`
          : '');
      h.push(`<div style="margin-top:8px;padding:8px 10px;background:${_bgColor};border-left:3px solid ${_borderCol};border-radius:3px;font-size:11px;color:${_txtColor}"
        title="Узел-генератор имеет привязанную модель ДГУ из каталога (n.appliedConfig.dgu). Войдёт в BOM проекта.">
        <b title="Сигнал что ДГУ-конфигуратор успешно вернул выбор в схему.">${_statusIcon} ${escHtml(_statusText)}</b>${ageStr ? ` <span class="muted" title="Время с момента apply из dgu-config.">(${escHtml(ageStr)})</span>` : ''}<br>
        ${modelLine}
        ${nameplateBlock}${modeBlock}${qtyBlock}
        ${engineBlock}${sfcBlock}
        ${derateBlock}
        ${_capacityWarning}
        <br><span class="muted" title="Запись произошла через postMessage('raschet.dgu.apply') или storage-bridge от dgu-config. Спецификация автоматически обновится при следующем экспорте BOM/КП.">Записано через apply из dgu-config. Войдёт в BOM проекта автоматически.</span>
      </div>`);
    }

    // v0.58.81: если к узлу уже применён rack-шаблон — показываем сводку,
    // чтобы было видно без повторного открытия конфигуратора.
    if (cfg === _CONFIGURATORS.rack && n.rackTemplate && typeof n.rackTemplate === 'object') {
      const t = n.rackTemplate;
      const pduCount = Array.isArray(t.pdus) ? t.pdus.reduce((s, p) => s + (Number(p.qty) || 1), 0) : 0;
      const accCount = Array.isArray(t.accessories) ? t.accessories.reduce((s, a) => s + (Number(a.qty) || 1), 0) : 0;
      const dim = [t.u ? t.u + 'U' : '', t.width ? t.width + 'мм' : '',
                   t.depth ? 'гл.' + t.depth + 'мм' : ''].filter(Boolean).join(' × ');
      h.push(`<div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:3px;font-size:11px;color:#14532d">
        <b>✓ Стойка сконфигурирована</b><br>
        ${t.manufacturer ? escHtml(t.manufacturer) + (dim ? ' · ' : '') : ''}${dim ? escHtml(dim) : ''}
        ${pduCount ? '<br>PDU: ' + pduCount + ' шт' : ''}
        ${accCount ? '<br>Аксессуары: ' + accCount + ' шт' : ''}
        <br><span class="muted">Войдёт в BOM проекта автоматически.</span>
      </div>`);
    }
  } else if (!matches.length) {
    h.push(`<div class="muted" style="font-size:11px">Для этого типа элемента модуль-конфигуратор пока не подключён. Параметры задаются вручную на остальных вкладках.</div>`);
  }
  h.push(`</div>`);
  } // end if (!_isContainerNode) — блок «Модель изделия» только для конкретных экземпляров

  // v0.59.886: для контейнера в Общих показываем «Состав контейнера»
  // (раньше отображался во вкладке «Электрика»). Пользователь:
  // «блок список потребителей внутри вынести в раздел Общие».
  if (_isContainerNode) {
    const slots = Array.isArray(n.slots) ? n.slots : [];
    let totalKwSum = 0;
    for (const s of slots) {
      if (!s) continue;
      if (s.kind === 'linked' && s.nodeId) {
        const a = state.nodes.get(s.nodeId);
        if (a) totalKwSum += (Number(a.demandKw) || 0) * Math.max(1, Number(a.count) || 1);
      } else if (s.kind === 'placeholder') totalKwSum += Number(s.demandKw) || 0;
    }
    h.push('<div class="inspector-section"><h4>Контейнер потребителей</h4>');
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:6px">Σ нагрузка: <b>${totalKwSum.toFixed(2)} кВт</b> · слотов: <b>${slots.length}</b>. Контейнер — организационная обёртка; параметры (модель/ИНВ/S/N) у конкретных потребителей внутри.</div>`);
    h.push(`<button type="button" id="btn-open-container-members-general" class="full-btn" style="margin-bottom:8px;padding:6px 10px;background:#dbeafe;color:#1e40af;border:1px solid #2563eb;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500">📋 Открыть состав в модалке (или dblclick на канвасе)</button>`);
    if (!slots.length) {
      h.push('<div class="muted" style="font-size:12px;padding:6px 0">Контейнер пуст. Drop потребителя на канвасе сюда — добавится как слот.</div>');
    } else {
      // Краткий список slot-ов — natural sort, без editable.
      const _sorted = slots.map((s, i) => {
        let _key = '￿';
        if (s && s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a && a.tag) _key = String(a.tag);
        }
        return { s, i, key: _key };
      });
      _sorted.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));
      h.push('<div style="display:flex;flex-direction:column;gap:3px;font-size:12px">');
      for (const entry of _sorted) {
        const s = entry.s; const i = entry.i;
        if (!s) continue;
        if (s.kind === 'linked' && s.nodeId) {
          const a = state.nodes.get(s.nodeId);
          if (a) {
            const tag = a.tag || a.id;
            const name = a.name || '';
            const kw = Number(a.demandKw) || 0;
            h.push(`<div style="padding:5px 6px;background:#f5f7fa;border-radius:4px;display:flex;align-items:center;gap:6px;cursor:pointer" data-slot-open="${escAttr(a.id)}" title="Открыть параметры члена">
              <span style="flex:1"><b>${escHtml(tag)}</b> ${escHtml(name)}</span>
              <span class="muted" style="font-size:11px">#${i + 1} · ${kw} кВт</span>
            </div>`);
          }
        } else if (s.kind === 'placeholder') {
          const kw = Number(s.demandKw) || 0;
          h.push(`<div style="padding:5px 6px;background:#fef3c7;border-radius:4px;display:flex;align-items:center;gap:6px">
            <span style="flex:1"><i style="color:#92400e">placeholder #${i + 1}</i></span>
            <span class="muted" style="font-size:11px">${kw} кВт</span>
          </div>`);
        }
      }
      h.push('</div>');
    }
    // v0.59.887: кнопки управления составом контейнера в Общее
    // (раньше были на вкладке Электрика).
    h.push('<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">');
    h.push('<button type="button" id="btn-add-placeholder" class="full-btn" style="flex:1;padding:5px 10px;font-size:12px">➕ Placeholder-слот</button>');
    h.push('<button type="button" id="btn-container-to-consumer" class="full-btn" style="flex:1;padding:5px 10px;font-size:12px;background:#fff7ed;border:1px solid #fb923c;color:#9a3412" title="Свернуть контейнер в одиночный групповой потребитель count=N (как «10 лампочек × 50Вт»)">⇆ В группового потребителя</button>');
    h.push('</div>');
    h.push('</div>');
  }

  // Блок «Комментарий» — общего назначения
  h.push(`<div class="inspector-section">`);
  h.push(`<h4>Комментарий</h4>`);
  h.push(`<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical" placeholder="Заметки по объекту (не влияют на расчёт)">${escHtml(n.comment || '')}</textarea>`);
  h.push(`</div>`);
  return h.join('');
}

// v0.58.38: tab-buttons + panels для включённых систем (кроме electrical).
// Electrical встроена во вкладку «Электрика». Возвращает строки HTML.
export function renderExtraSystemTabs(n) {
  try {
    const proj = state.project || {};
    globalThis.__raschetCustomSystems = Array.isArray(proj.customSystems) ? proj.customSystems.slice() : [];
  } catch {}
  const cur = Array.isArray(n.systems) && n.systems.length ? n.systems : ['electrical'];
  const tabs = [];
  const panels = [];
  for (const sysId of cur) {
    if (sysId === 'electrical') continue;
    const meta = getSystemMeta(sysId);
    if (!meta) continue;
    const tabId = 'sys:' + sysId;
    tabs.push(`<button type="button" class="tp-tab" data-tab="${escAttr(tabId)}" role="tab" title="${escAttr(meta.label)}" style="border-color:${meta.color}">${meta.icon} ${escHtml(meta.label)}</button>`);
    panels.push(`<div class="tp-panel" data-panel="${escAttr(tabId)}" data-sys-accent="${escAttr(sysId)}" style="--sys-accent:${meta.color}" hidden>${renderSystemParamsPanel(n, sysId)}</div>`);
  }
  return { tabsHtml: tabs.join(''), panelsHtml: panels.join('') };
}
export function wireSystemsBlock(n, root) {
  const host = (root || inspectorBody);
  if (!host) return;
  const checks = host.querySelectorAll('[data-sys]');
  checks.forEach(ch => {
    ch.addEventListener('change', () => {
      const id = ch.dataset.sys;
      if (!id) return;
      snapshot('sys:' + n.id + ':' + id);
      if (!Array.isArray(n.systems)) n.systems = ['electrical'];
      if (ch.checked) {
        if (!n.systems.includes(id)) n.systems.push(id);
      } else {
        n.systems = n.systems.filter(s => s !== id);
      }
      // Если пусто — всё равно оставляем electrical по умолчанию, чтобы
      // элемент не «пропал» со схемы неожиданно.
      if (!n.systems.length) n.systems = ['electrical'];
      notifyChange();
      // v0.58.39: после перерисовки — переключаемся на вкладку этой системы,
      // чтобы пользователь сразу увидел где заполнять параметры.
      const targetTab = (ch.checked && id !== 'electrical') ? 'sys:' + id : null;
      if (_render) _render();
      renderInspector();
      if (targetTab) {
        try {
          // Ищем и в sidebar-инспекторе, и в модалке (последняя активная)
          const roots = [document.getElementById('inspector-body'), document.querySelector('.modal.active .modal-body')].filter(Boolean);
          for (const r of roots) {
            const btn = r.querySelector(`.tp-tab[data-tab="${targetTab}"]`);
            if (btn) { btn.click(); break; }
          }
        } catch {}
      }
    });
  });
  // v0.58.25: управление параметрами пользовательской системы — +/удалить
  host.querySelectorAll('[data-sys-manage-add]').forEach(b => {
    // клик по кнопке не должен переключать чекбокс родительского label
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', async (e) => {
      const sysId = b.getAttribute('data-sys-manage-add');
      const sys = (state.project.customSystems || []).find(s => s.id === sysId);
      if (!sys) return;
      const label = await rsPrompt('Название параметра (отображается в UI):', '');
      if (!label) return;
      const keyRaw = await rsPrompt('Ключ (латиница/цифры):', label.toLowerCase().replace(/[^a-z0-9]+/g, ''));
      const key = String(keyRaw || '').trim();
      if (!key || !/^[a-z0-9_]+$/i.test(key)) { flash('Ключ должен быть a-z0-9_', 'error'); return; }
      if (!Array.isArray(sys.params)) sys.params = [];
      if (sys.params.find(p => p.key === key)) { flash('Параметр с таким ключом уже существует', 'error'); return; }
      const type = ((await rsPrompt('Тип параметра: number / text / select', 'text')) || 'text').trim();
      const unit = (await rsPrompt('Единицы измерения (можно пусто):', '')) || '';
      const p = { key, label, type: ['number','text','select'].includes(type) ? type : 'text' };
      if (unit) p.unit = unit;
      if (p.type === 'select') {
        const opts = (await rsPrompt('Варианты через запятую:', '')) || '';
        p.options = [''].concat(opts.split(',').map(o => o.trim()).filter(Boolean));
      }
      if (p.type === 'number') { p.min = 0; p.step = 1; }
      snapshot('custom-system-param-add:' + sysId + ':' + key);
      sys.params.push(p);
      globalThis.__raschetCustomSystems = state.project.customSystems.slice();
      notifyChange();
      renderInspector();
    });
  });
  host.querySelectorAll('[data-sys-manage-del]').forEach(b => {
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', async () => {
      const sysId = b.getAttribute('data-sys-manage-del');
      if (!(await rsConfirm('Удалить систему «' + sysId + '» из проекта?', 'Она исчезнет у всех элементов.', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
      snapshot('custom-system-del:' + sysId);
      state.project.customSystems = (state.project.customSystems || []).filter(s => s.id !== sysId);
      // убрать упоминания систем и параметров из всех узлов
      for (const node of state.nodes.values()) {
        if (Array.isArray(node.systems)) node.systems = node.systems.filter(x => x !== sysId);
        if (node.systemParams && node.systemParams[sysId]) delete node.systemParams[sysId];
      }
      globalThis.__raschetCustomSystems = state.project.customSystems.slice();
      notifyChange();
      if (_render) _render();
      renderInspector();
    });
  });
  // v0.58.24: добавление пользовательской системы
  const addBtn = host.querySelector('#btn-add-custom-system');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const label = await rsPrompt('Название системы (отображается в UI и отчётах):', '');
    if (!label) return;
    const idRaw = await rsPrompt('ID (латиница, цифры, дефис):', label.toLowerCase().replace(/[^a-z0-9\-]+/g, '-').replace(/^-+|-+$/g, ''));
    const id = String(idRaw || '').trim();
    if (!id || !/^[a-z0-9\-]+$/i.test(id)) { flash('ID должен содержать только a-z, 0-9 и дефис', 'error'); return; }
    const all = getAllSystems();
    if (all.find(s => s.id === id)) { flash('Система с таким ID уже существует', 'error'); return; }
    const icon = ((await rsPrompt('Иконка (emoji, 1 символ):', '🔧')) || '🔧').slice(0, 2);
    const color = ((await rsPrompt('Цвет (#RRGGBB):', '#6366f1')) || '#6366f1').trim();
    const kindsRaw = await rsPrompt('Виды страниц через запятую (schematic, layout). Пусто = везде:', 'schematic');
    const pageKinds = String(kindsRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    snapshot('custom-system-add:' + id);
    if (!Array.isArray(state.project.customSystems)) state.project.customSystems = [];
    state.project.customSystems.push({ id, label, icon, color, pageKinds, params: [] });
    globalThis.__raschetCustomSystems = state.project.customSystems.slice();
    notifyChange();
    if (_render) _render();
    renderInspector();
  });
  // v0.58.21: параметры систем
  const params = host.querySelectorAll('[data-sys-param]');
  params.forEach(inp => {
    inp.addEventListener('change', () => {
      const sysId = inp.getAttribute('data-sys-param');
      const key = inp.getAttribute('data-sys-key');
      if (!sysId || !key) return;
      snapshot('sys-param:' + n.id + ':' + sysId + ':' + key);
      if (!n.systemParams || typeof n.systemParams !== 'object') n.systemParams = {};
      if (!n.systemParams[sysId] || typeof n.systemParams[sysId] !== 'object') n.systemParams[sysId] = {};
      let v = inp.value;
      if (inp.type === 'number') {
        v = v === '' ? '' : Number(v);
        if (v === '' || !Number.isFinite(v)) {
          delete n.systemParams[sysId][key];
        } else {
          n.systemParams[sysId][key] = v;
        }
      } else {
        const sv = String(v).trim();
        if (!sv) delete n.systemParams[sysId][key];
        else n.systemParams[sysId][key] = sv;
      }
      // cleanup пустых объектов
      if (!Object.keys(n.systemParams[sysId]).length) delete n.systemParams[sysId];
      if (!Object.keys(n.systemParams).length) delete n.systemParams;
      notifyChange();
    });
  });
}

// Phase 2.3: блок ручного override габаритов (мм) для layout-страницы.
// Показывает текущий резолв (из библиотеки / override / нет) + поля ввода.
// Если пусто — берётся library.geometry. Удобно когда элемент
// добавлен без ссылки на каталог.
export function renderGeometryMmBlock(n) {
  const geom = getNodeGeometryMm(n);
  const ov = n.geometryMm || {};
  const hint = geom
    ? `источник: ${geom.source === 'override' ? 'override (этот узел)' : geom.source === 'library' ? 'каталог' : geom.source}`
    : 'не задано — узел не рисуется как футпринт';
  const val = (k) => {
    const v = Number(ov[k]) > 0 ? ov[k] : (geom && geom.source === 'library' ? geom[k] : '');
    return v || '';
  };
  const badge = geom
    ? `<span class="muted" style="font-size:11px">${Math.round(geom.widthMm)}×${Math.round(geom.heightMm)}${geom.depthMm ? '×' + Math.round(geom.depthMm) : ''} мм${geom.weightKg ? `, ${geom.weightKg} кг` : ''}</span>`
    : '';
  return `<div class="inspector-section">
    <h4>Габариты (мм) <span class="muted" style="font-weight:400;font-size:11px">— ${hint}</span></h4>
    <div style="font-size:11px;margin-bottom:6px">${badge}</div>
    <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <label style="font-size:11px">Ширина<input type="number" min="0" step="10" data-geom-prop="widthMm" value="${escAttr(val('widthMm'))}" placeholder="${geom?.widthMm ? Math.round(geom.widthMm) : ''}"></label>
      <label style="font-size:11px">Высота<input type="number" min="0" step="10" data-geom-prop="heightMm" value="${escAttr(val('heightMm'))}" placeholder="${geom?.heightMm ? Math.round(geom.heightMm) : ''}"></label>
      <label style="font-size:11px">Глубина<input type="number" min="0" step="10" data-geom-prop="depthMm" value="${escAttr(val('depthMm'))}" placeholder="${geom?.depthMm ? Math.round(geom.depthMm) : ''}"></label>
      <label style="font-size:11px">Вес, кг<input type="number" min="0" step="0.1" data-geom-prop="weightKg" value="${escAttr(val('weightKg'))}" placeholder="${geom?.weightKg || ''}"></label>
    </div>
    <button type="button" class="full-btn" id="btn-clear-geom-override" style="margin-top:6px;font-size:11px">Очистить override (брать из каталога)</button>
    <label style="display:block;font-size:11px;margin-top:8px">Этаж / уровень (целое число, 0 по умолчанию)
      <input type="number" step="1" data-node-floor value="${escAttr(Number.isFinite(Number(n.floor)) ? Number(n.floor) : 0)}" style="width:100%;font:inherit;font-size:12px;padding:3px 4px">
    </label>
    <div class="muted" style="font-size:10px;margin-top:2px">На одном этаже объекты не могут пересекаться, если один не содержит другой полностью.</div>
    ${renderLayoutColorBlock(n)}
  </div>`;
}

// v0.58.21: персональный цвет карточки на layout-странице.
// Разные подтипы элементов (разные потребители / разные щиты) могут
// отличаться по цвету — это задаётся узлу индивидуально.
export function renderLayoutColorBlock(n) {
  const lc = (n.layoutColor && typeof n.layoutColor === 'object') ? n.layoutColor : {};
  const fill = lc.fill || '';
  const stroke = lc.stroke || '';
  return `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e0e3ea">
    <h4 style="font-size:12px;margin-bottom:6px">Цвет на расположении</h4>
    <div class="muted" style="font-size:10px;margin-bottom:6px">
      Индивидуальный цвет карточки на layout-странице. Если пусто — берётся цвет по типу элемента.
    </div>
    <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:end">
      <label style="font-size:11px">Заливка
        <input type="color" data-lc-prop="fill" value="${escAttr(fill || '#ffffff')}" style="width:100%;height:28px;padding:0;border:1px solid #cbd5e1;border-radius:4px">
      </label>
      <label style="font-size:11px">Обводка
        <input type="color" data-lc-prop="stroke" value="${escAttr(stroke || '#333333')}" style="width:100%;height:28px;padding:0;border:1px solid #cbd5e1;border-radius:4px">
      </label>
    </div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button type="button" class="full-btn" id="btn-lc-apply-fill"  style="flex:1;font-size:11px">Применить заливку</button>
      <button type="button" class="full-btn" id="btn-lc-apply-stroke" style="flex:1;font-size:11px">Применить обводку</button>
    </div>
    <button type="button" class="full-btn" id="btn-lc-apply-kin" style="margin-top:6px;font-size:11px">Применить всем узлам с тем же подтипом</button>
    <button type="button" class="full-btn" id="btn-lc-clear" style="margin-top:6px;font-size:11px">Сбросить цвет (брать по типу)</button>
  </div>`;
}

export function wireLayoutColorBlock(n, root) {
  const r = root || inspectorBody;
  const fillInput   = r.querySelector('[data-lc-prop="fill"]');
  const strokeInput = r.querySelector('[data-lc-prop="stroke"]');
  const applyFill   = r.querySelector('#btn-lc-apply-fill');
  const applyStroke = r.querySelector('#btn-lc-apply-stroke');
  const clr         = r.querySelector('#btn-lc-clear');
  function setProp(prop, v) {
    snapshot('layoutColor:' + n.id);
    if (!n.layoutColor || typeof n.layoutColor !== 'object') n.layoutColor = {};
    if (v) n.layoutColor[prop] = v; else delete n.layoutColor[prop];
    if (!n.layoutColor.fill && !n.layoutColor.stroke) delete n.layoutColor;
    notifyChange();
    if (_render) _render();
  }
  if (applyFill && fillInput) applyFill.addEventListener('click', () => setProp('fill', fillInput.value));
  if (applyStroke && strokeInput) applyStroke.addEventListener('click', () => setProp('stroke', strokeInput.value));
  const applyKin = r.querySelector('#btn-lc-apply-kin');
  if (applyKin) applyKin.addEventListener('click', () => {
    // «Подтип» = type + (consumerKind / panelKind / sourceKind / libraryRef) для различения подтипов в пределах типа.
    const subKeyOf = (m) => {
      if (!m) return '';
      return [m.type, m.consumerKind, m.panelKind, m.sourceKind, m.upsKind, m.libraryRef]
        .filter(v => v != null && v !== '').join('|');
    };
    const myKey = subKeyOf(n);
    const f = fillInput ? fillInput.value : '';
    const s = strokeInput ? strokeInput.value : '';
    let count = 0;
    snapshot('layoutColor-kin:' + n.id);
    for (const other of state.nodes.values()) {
      if (other.id === n.id) continue;
      if (subKeyOf(other) !== myKey) continue;
      if (!other.layoutColor || typeof other.layoutColor !== 'object') other.layoutColor = {};
      if (f) other.layoutColor.fill = f;
      if (s) other.layoutColor.stroke = s;
      count++;
    }
    if (!n.layoutColor || typeof n.layoutColor !== 'object') n.layoutColor = {};
    if (f) n.layoutColor.fill = f;
    if (s) n.layoutColor.stroke = s;
    notifyChange();
    if (_render) _render();
    flash(`Цвет применён к ${count + 1} узлам подтипа`, 'ok');
  });
  if (clr) clr.addEventListener('click', () => {
    if (!n.layoutColor) return;
    snapshot('layoutColor-clear:' + n.id);
    delete n.layoutColor;
    notifyChange();
    if (_render) _render();
    renderInspector();
  });
}

export function wireGeometryMmBlock(n, root) {
  const r = root || inspectorBody;
  r.querySelectorAll('[data-geom-prop]').forEach(inp => {
    inp.addEventListener('change', () => {
      const prop = inp.dataset.geomProp;
      const raw = inp.value.trim();
      const v = raw === '' ? 0 : Number(raw);
      snapshot('geometryMm:' + n.id);
      n.geometryMm = { ...(n.geometryMm || {}), [prop]: v };
      const all = n.geometryMm;
      if (!Number(all.widthMm) && !Number(all.heightMm) && !Number(all.depthMm) && !Number(all.weightKg)) {
        delete n.geometryMm;
      }
      notifyChange();
      _render();
      renderInspector();
    });
  });
  const clr = r.querySelector('#btn-clear-geom-override');
  if (clr) clr.addEventListener('click', () => {
    if (!n.geometryMm) return;
    snapshot('geometryMm-clear:' + n.id);
    delete n.geometryMm;
    notifyChange();
    _render();
    renderInspector();
  });
  // v0.58.28: этаж/уровень
  const floorInp = r.querySelector('[data-node-floor]');
  if (floorInp) floorInp.addEventListener('change', () => {
    const v = Math.round(Number(floorInp.value) || 0);
    snapshot('floor:' + n.id);
    if (v === 0) delete n.floor;
    else n.floor = v;
    notifyChange();
    _render();
  });
}

// v0.58.6: обёртка для модалок «Параметры X» — превращает сплошной
// body в табы «⚡ Электрика / 📐 Габариты». Вызывается в конце каждого
// open*Params после того как body.innerHTML уже сформирован.
//   bodyEl — DOM контейнер модалки
//   n — узел, для которого открыта модалка
// Содержимое bodyEl целиком уходит во вкладку «Электрика»; во вкладку
// «Габариты» добавляется renderGeometryMmBlock(n) с уже готовой
// провязкой wireGeometryMmBlock(n, root).
export function wrapModalWithSystemTabs(bodyEl, n) {
  if (!bodyEl || !n || n.type === 'zone') return;
  // Избегаем двойного оборачивания (если модалка переоткрывается в уже
  // обёрнутом контейнере).
  if (bodyEl.querySelector(':scope > .tp-tabs')) return;
  const originalHtml = bodyEl.innerHTML;
  // v0.60.277: Конструктор схем = дисциплина электрика. Скрываем таб
  // «🧩 Системы» (multi-discipline) и extra-tabs (data/plumbing/...).
  // n.systems данные не теряются — Tech-workspace и др. модули читают/пишут.
  const extra = { tabsHtml: '', panelsHtml: '' };
  // v0.58.50: добавлен таб «Общее» (roadmap 1.22.2), активный по умолчанию
  const tabsHtml = `<div class="tp-tabs" role="tablist" style="margin-bottom:12px">
    <button type="button" class="tp-tab active" data-tab="general" role="tab">📋 Общее</button>
    <button type="button" class="tp-tab" data-tab="electrical" role="tab">⚡ Электрика</button>
    <button type="button" class="tp-tab" data-tab="geometry" role="tab">📐 Габариты</button>
    ${extra.tabsHtml}
  </div>`;
  bodyEl.innerHTML = tabsHtml
    + `<div class="tp-panel" data-panel="general">${renderGeneralPanel(n)}</div>`
    + `<div class="tp-panel" data-panel="electrical" hidden>${originalHtml}</div>`
    + `<div class="tp-panel" data-panel="geometry" hidden>${renderGeometryMmBlock(n)}</div>`
    /* v0.60.277: Системы и extra-tabs скрыты — Конструктор = дисциплина электрика. */
    + extra.panelsHtml;
  bodyEl.querySelectorAll(':scope > .tp-tabs .tp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      _activeTabByNode.set(n.id + ':modal', tab);  // v0.58.55
      bodyEl.querySelectorAll(':scope > .tp-tabs .tp-tab').forEach(t => t.classList.toggle('active', t === btn));
      bodyEl.querySelectorAll(':scope > .tp-panel').forEach(p => {
        p.hidden = p.dataset.panel !== tab;
      });
    });
  });
  // v0.58.55: восстановить активную вкладку модалки
  const savedModalTab = _activeTabByNode.get(n.id + ':modal');
  if (savedModalTab && savedModalTab !== 'general') {
    const btn = bodyEl.querySelector(`:scope > .tp-tabs .tp-tab[data-tab="${savedModalTab}"]`);
    if (btn) {
      bodyEl.querySelectorAll(':scope > .tp-tabs .tp-tab').forEach(t => t.classList.toggle('active', t === btn));
      bodyEl.querySelectorAll(':scope > .tp-panel').forEach(p => {
        p.hidden = p.dataset.panel !== savedModalTab;
      });
    }
  }
  wireGeometryMmBlock(n, bodyEl);
  wireLayoutColorBlock(n, bodyEl);
  wireSystemsBlock(n, bodyEl);
  // v0.58.50: провязка «Общее» в модалке — только data-prop инпуты внутри
  // панели, без document.getElementById-кнопок (те уже подвязаны в sidebar).
  try { wireGeneralPanelInputs(n, bodyEl); } catch {}
}

// v0.59.353: модалка-picker для ручной привязки узла к реестрам проекта.
// Показывает плоский список IT-устройств и позиций реестра объекта с
// поиском. По клику записывает sn/assetId в узел.
function _openInventoryPickerForNode(n) {
  const pid = _activeProjectId();
  const itList = listAllItDevices(pid);
  const facList = listAllFacilityItems(pid);
  const all = [
    ...itList.map(x => ({ kind: 'it', ...x })),
    ...facList.map(x => ({ kind: 'facility', ...x })),
  ];
  // Снять предыдущий picker если есть
  const prev = document.getElementById('rs-inv-picker-overlay');
  if (prev) prev.remove();
  const overlay = document.createElement('div');
  overlay.id = 'rs-inv-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center';
  const renderRows = (q) => {
    const ql = (q || '').trim().toLowerCase();
    const filtered = !ql ? all : all.filter(r => {
      const hay = [r.label, r.sn, r.assetId, r.rackTag || ''].join(' ').toLowerCase();
      return hay.includes(ql);
    });
    if (!filtered.length) return `<div class="muted" style="padding:16px;text-align:center">Записей не найдено</div>`;
    return filtered.slice(0, 200).map((r, i) => {
      const idx = all.indexOf(r);
      const tagHtml = r.rackTag ? ` · <span style="color:#0369a1">стойка ${escHtml(r.rackTag)}</span>` : '';
      const meta = [r.sn ? `S/N: ${escHtml(r.sn)}` : '', r.assetId ? `Инв.№: ${escHtml(r.assetId)}` : ''].filter(Boolean).join(' · ');
      const kindBadge = r.kind === 'it' ? '<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px;font-size:10px">IT</span>' : '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-size:10px">объект</span>';
      return `<div class="rs-inv-row" data-idx="${idx}" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;flex-direction:column;gap:2px">
        <div style="display:flex;gap:8px;align-items:center"><b>${escHtml(r.label)}</b>${kindBadge}${tagHtml}</div>
        <div class="muted" style="font-size:11px">${meta || '<i>без идентификаторов</i>'}</div>
      </div>`;
    }).join('');
  };
  overlay.innerHTML = `<div style="background:#fff;border-radius:6px;width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.25)">
    <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:10px">
      <b>🔗 Привязка к реестру проекта</b>
      <span class="muted" style="font-size:11px;margin-left:auto">${all.length} записей</span>
      <button type="button" id="rs-inv-close" style="background:none;border:0;font-size:18px;cursor:pointer;padding:0 4px">×</button>
    </div>
    <div style="padding:10px 14px;border-bottom:1px solid #f1f5f9">
      <input type="text" id="rs-inv-search" placeholder="Поиск по имени / S/N / Инв.№ / стойке..." style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:12px">
    </div>
    <div id="rs-inv-list" style="overflow:auto;flex:1;min-height:120px">${renderRows('')}</div>
    <div style="padding:8px 14px;border-top:1px solid #e5e7eb;font-size:11px;color:#64748b">Клик по записи запишет S/N и Инв.№ выбранного устройства в текущий узел.</div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#rs-inv-close').addEventListener('click', close);
  const listEl = overlay.querySelector('#rs-inv-list');
  const searchEl = overlay.querySelector('#rs-inv-search');
  searchEl.addEventListener('input', () => { listEl.innerHTML = renderRows(searchEl.value); });
  listEl.addEventListener('click', e => {
    const row = e.target.closest('.rs-inv-row');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    const r = all[idx];
    if (!r) return;
    snapshot('inv-link:' + n.id);
    if (r.sn) n.serialNo = r.sn;
    if (r.assetId) n.assetId = r.assetId;
    close();
    try { renderInspector(); } catch {}
    notifyChange();
    flash('Привязано: ' + (r.label || ''));
  });
  setTimeout(() => searchEl.focus(), 30);
}

function _createInventoryEntryForNode(n) {
  const pid = _activeProjectId();
  const params = new URLSearchParams();
  if (pid) params.set('project', pid);
  params.set('from', 'schematic');
  if (n.tag) params.set('prefillTag', n.tag);
  if (n.name) params.set('prefillName', n.name);
  if (n.serialNo) params.set('prefillSn', n.serialNo);
  if (n.assetId) params.set('prefillAssetId', n.assetId);
  const url = '../scs-config/inventory.html?' + params.toString();
  window.open(url, '_blank');
}

// v0.59.549: при смене tag на интегрированном ИБП (kind='ups-integrated')
// каскадно переименовываем все дочерние panel-узлы — заменяем префикс
// «<oldTag>.» на «<newTag>.» в их .tag и в .name (если оно тоже содержит
// старый префикс). Дочки, тег которых пользователь явно переопределил
// (не начинается с oldPrefix) — не трогаем. Конфликтные новые теги
// пропускаются с предупреждением.
function _propagateIntegratedTagChange(n, oldTag, newTag) {
  if (!n || n.type !== 'ups' || n.kind !== 'ups-integrated') return 0;
  const ids = Array.isArray(n.integratedChildIds) ? n.integratedChildIds : [];
  if (!ids.length || !oldTag || oldTag === newTag) return 0;
  const oldPrefix = oldTag + '.';
  const newPrefix = newTag + '.';
  // Соберём занятые новые теги (за исключением самих children) для проверки уникальности.
  const childIdSet = new Set(ids);
  const taken = new Set();
  for (const m of state.nodes.values()) {
    if (!m || !m.tag) continue;
    if (m.id === n.id) continue;
    if (childIdSet.has(m.id)) continue;
    taken.add(String(m.tag).trim().toLowerCase());
  }
  let renamed = 0;
  const skipped = [];
  for (const cid of ids) {
    const c = state.nodes.get(cid);
    if (!c || !c.tag) continue;
    if (!c.tag.startsWith(oldPrefix)) continue; // ручной override — не трогаем
    const candidate = newPrefix + c.tag.slice(oldPrefix.length);
    if (taken.has(candidate.toLowerCase())) {
      skipped.push(c.tag + ' → ' + candidate);
      continue;
    }
    c.tag = candidate;
    if (typeof c.name === 'string' && c.name.startsWith(oldPrefix)) {
      c.name = newPrefix + c.name.slice(oldPrefix.length);
    }
    taken.add(candidate.toLowerCase());
    renamed++;
  }
  if (skipped.length) {
    flash(`Переименовано ${renamed}, пропущено из-за конфликтов: ${skipped.slice(0,2).join(', ')}${skipped.length>2?'…':''}`, 'info');
  }
  return renamed;
}

// v0.58.50: минимальная провязка инпутов вкладки «Общее» на заданном root.
// Используется в модалках (openPanelParamsModal/openUpsParamsModal/…),
// чтобы не дублировать глобальные обработчики кнопок из wireInspectorInputs.
export function wireGeneralPanelInputs(n, root) {
  if (!root || !n) return;
  root.querySelectorAll('[data-panel="general"] [data-prop]').forEach(inp => {
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
        if (!_isTagUnique(t, n.id)) {
          flash(`Обозначение «${t}» уже занято`);
          inp.value = n.tag || '';
          return;
        }
        const oldTag = n.tag || '';
        n.tag = t;
        // v0.59.549: каскадное переименование дочек интегрированного ИБП.
        if (n.type === 'ups' && n.kind === 'ups-integrated' && oldTag && oldTag !== t) {
          const renamed = _propagateIntegratedTagChange(n, oldTag, t);
          if (renamed > 0) flash(`Обновлены теги ${renamed} компонентов интегрированного ИБП`, 'ok');
        }
      } else if (prop === 'on' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        setEffectiveOn(n, v);
      } else if (prop === 'productId') {
        _applyProductBinding(n, v);
      } else {
        n[prop] = v;
      }
      _render();
      renderInspector();
      notifyChange();
    };
    inp.addEventListener('change', apply);
  });
  // v0.58.52: кнопка «Сохранить как изделие» — работает и в sidebar, и в модалке
  root.querySelectorAll('[data-action="save-product"]').forEach(btn => {
    btn.addEventListener('click', () => _saveNodeAsProduct(n));
  });
  // v0.59.353: кнопки ручной привязки и создания записи в реестре
  root.querySelectorAll('[data-action="link-inventory"]').forEach(btn => {
    btn.addEventListener('click', () => _openInventoryPickerForNode(n));
  });
  root.querySelectorAll('[data-action="create-inventory-it"]').forEach(btn => {
    btn.addEventListener('click', () => _createInventoryEntryForNode(n));
  });
}

// v0.58.52 (1.22.4): применение продукта из каталога к узлу. Копирует
// manufacturer/modelRef и заполняет пустые параметры систем дефолтами.
// min/max для отображения берётся «на лету» в renderSystemParamsPanel.
function _applyProductBinding(n, productId) {
  if (!productId) {
    delete n.productId;
    return;
  }
  const catalog = Array.isArray(state.project?.productCatalog) ? state.project.productCatalog : [];
  const prod = catalog.find(p => p.id === productId);
  if (!prod) { delete n.productId; return; }
  n.productId = productId;
  if (prod.manufacturer) n.manufacturer = prod.manufacturer;
  if (prod.modelRef) n.modelRef = prod.modelRef;
  // Заполняем пустые параметры систем дефолтами продукта
  if (prod.systemRanges && typeof prod.systemRanges === 'object') {
    if (!n.systemParams || typeof n.systemParams !== 'object') n.systemParams = {};
    for (const sysId of Object.keys(prod.systemRanges)) {
      const sysRanges = prod.systemRanges[sysId] || {};
      if (!n.systemParams[sysId] || typeof n.systemParams[sysId] !== 'object') n.systemParams[sysId] = {};
      for (const key of Object.keys(sysRanges)) {
        const r = sysRanges[key];
        const cur = n.systemParams[sysId][key];
        if ((cur === undefined || cur === '' || cur === null) && r && r.default !== undefined) {
          n.systemParams[sysId][key] = r.default;
        }
      }
    }
  }
}

// v0.58.52 (1.22.4): «Сохранить как изделие» — создаёт запись в
// state.project.productCatalog из текущих n.systemParams (min=max=default=val).
async function _saveNodeAsProduct(n) {
  const defaultName = n.modelRef || n.name || n.tag || n.type;
  const name = await rsPrompt('Название изделия в каталоге:', defaultName);
  if (!name) return;
  const ranges = {};
  const sp = (n.systemParams && typeof n.systemParams === 'object') ? n.systemParams : {};
  for (const sysId of Object.keys(sp)) {
    const sv = sp[sysId] || {};
    const keys = Object.keys(sv);
    if (!keys.length) continue;
    ranges[sysId] = {};
    for (const k of keys) {
      const v = sv[k];
      if (v === undefined || v === null || v === '') continue;
      const nv = Number(v);
      if (Number.isFinite(nv)) {
        ranges[sysId][k] = { min: nv, max: nv, default: nv };
      } else {
        // text/select — только default
        ranges[sysId][k] = { default: v };
      }
    }
  }
  const id = 'prod-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const prod = {
    id,
    name: String(name).trim(),
    type: n.type || '',
    subtype: n.subtype || '',
    manufacturer: n.manufacturer || '',
    modelRef: n.modelRef || '',
    systemRanges: ranges,
  };
  if (!Array.isArray(state.project.productCatalog)) state.project.productCatalog = [];
  state.project.productCatalog.push(prod);
  n.productId = id;
  snapshot('save-product:' + id);
  notifyChange();
  renderInspector();
  flash(`Изделие «${prod.name}» добавлено в каталог проекта`);
}

// Полный блок «Все данные объекта» внизу инспектора
export function renderFullPropsBlock(n) {
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
export function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESET_KEY)) || []; }
  catch { return []; }
}
export function saveUserPresets(list) {
  try { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list)); }
  catch (e) { console.error('[userPresets]', e); }
}
export async function saveNodeAsPreset(n) {
  const name = n.name || n.type;
  if (!(await rsConfirm(`Сохранить «${name}» в библиотеку?`, '', { okLabel: 'Сохранить', cancelLabel: 'Отмена' }))) return;
  const params = JSON.parse(JSON.stringify(n));
  delete params.id; delete params.x; delete params.y; delete params.tag;
  for (const k of Object.keys(params)) if (k.startsWith('_')) delete params[k];
  // Убираем привязки к конкретным элементам схемы
  delete params.linkedOutdoorId; delete params.linkedIndoorId;
  const list = loadUserPresets();
  // v0.59.327: junction-box удалён как отдельный тип — клеммная коробка это panel c switchMode='terminal'.
  const TYPE_CATEGORY = { source: 'Источники', generator: 'Генераторы', panel: 'НКУ', ups: 'ИБП', consumer: 'Потребители', channel: 'Каналы' };
  list.push({
    id: 'user-' + Date.now().toString(36),
    category: n.type === 'panel' && n.isMv ? 'Среднее напряжение' : (TYPE_CATEGORY[n.type] || 'Прочее'),
    title: name,
    description: '',
    type: n.type,
    params,
    custom: true,
  });
  saveUserPresets(list);
  // Регистрируем в общем каталоге пресетов
  if (window.Presets && typeof window.Presets.add === 'function') {
    window.Presets.add(list[list.length - 1]);
  }
  flash('Сохранено в библиотеку: ' + title);
}

export function wireInspectorInputs(n, root) {
  // v0.58.50: root опционален — можно провязать Общее-вкладку в модалке
  const host = root || inspectorBody;
  // v0.58.52: кнопка «Сохранить как изделие» в sidebar-инспекторе
  host.querySelectorAll('[data-action="save-product"]').forEach(btn => {
    btn.addEventListener('click', () => _saveNodeAsProduct(n));
  });
  // v0.59.353: ручная привязка к реестрам / создание записи (sidebar)
  host.querySelectorAll('[data-action="link-inventory"]').forEach(btn => {
    btn.addEventListener('click', () => _openInventoryPickerForNode(n));
  });
  host.querySelectorAll('[data-action="create-inventory-it"]').forEach(btn => {
    btn.addEventListener('click', () => _createInventoryEntryForNode(n));
  });
  host.querySelectorAll('[data-prop]').forEach(inp => {
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
        if (!_isTagUnique(t, n.id)) {
          flash(`Обозначение «${t}» уже занято`);
          inp.value = n.tag || '';
          return;
        }
        const oldTag = n.tag || '';
        n.tag = t;
        // v0.59.549: каскадное переименование дочек интегрированного ИБП.
        if (n.type === 'ups' && n.kind === 'ups-integrated' && oldTag && oldTag !== t) {
          const renamed = _propagateIntegratedTagChange(n, oldTag, t);
          if (renamed > 0) flash(`Обновлены теги ${renamed} компонентов интегрированного ИБП`, 'ok');
        }
      } else if (prop === 'on' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        setEffectiveOn(n, v);
      } else if (prop === 'manualActiveInput') {
        n.manualActiveInput = Number(v) || 0;
      } else if (prop === 'count') {
        n.count = Math.max(1, Number(v) || 1);
      } else if (prop === 'switchMode') {
        n.switchMode = String(v);
      } else if (prop === 'inputs' || prop === 'outputs') {
        // Особый случай: чекбокс с data-as-bool="1" — переключает 0/1 (для input трансформатора)
        if (inp.type === 'checkbox' && inp.dataset.asBool === '1') {
          const target = v ? 1 : 0;
          // Проверяем что при уменьшении не отключаем занятый порт
          const kind = prop === 'inputs' ? 'in' : 'out';
          const maxUsed = maxOccupiedPort(n.id, kind);
          if (target === 0 && maxUsed >= 0) {
            flash('Сначала отключите связь со входа', 'error');
            inp.checked = true;
            return;
          }
          n[prop] = target;
          _render();
          notifyChange();
          renderInspector();
          return;
        }
        const newN = Math.max(1, Number(v) || 1);
        const kind = prop === 'inputs' ? 'in' : 'out';
        const maxUsed = maxOccupiedPort(n.id, kind);
        if (newN <= maxUsed) {
          flash(`Нельзя уменьшить: ${prop === 'inputs' ? 'вход' : 'выход'} №${maxUsed + 1} занят. Сначала отключите линию.`, 'error');
          inp.value = n[prop];
          return;
        }
        n[prop] = newN;
      } else if (prop === 'productId') {
        _applyProductBinding(n, v);
        _render(); renderInspector(); notifyChange();
        return;
      } else if (prop === 'sourceSubtype') {
        n.sourceSubtype = v;
        // Конвертируем внутренний type для совместимости расчётной логики
        if (v === 'generator') {
          n.type = 'generator';
          if (typeof n.backupMode !== 'boolean') n.backupMode = true;
          if (!Array.isArray(n.triggerNodeIds)) n.triggerNodeIds = [];
          if (typeof n.startDelaySec !== 'number') n.startDelaySec = 5;
          if (typeof n.stopDelaySec !== 'number') n.stopDelaySec = 2;
          if (!n.triggerLogic) n.triggerLogic = 'any';
        } else {
          n.type = 'source';
        }
      } else if (prop === 'triggerNodeId') {
        n.triggerNodeId = v ? String(v) : null;
      } else if (prop === 'voltageLevelIdx') {
        n.voltageLevelIdx = Number(v) || 0;
        const lv = GLOBAL.voltageLevels[n.voltageLevelIdx];
        if (lv) {
          n.voltage = lv.vLL;
          n.phase = lv.phases === 3 ? '3ph' : '1ph';
        }
      } else if (prop === 'phase' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        n.phase = v;
        if (v === '3ph') n.voltage = GLOBAL.voltage3ph;
        else if (v === '1ph') n.voltage = GLOBAL.voltage1ph;
      } else if (prop === 'phase' && n.type === 'consumer') {
        n.phase = v;
        if (v === '3ph') n.voltage = GLOBAL.voltage3ph;
        else n.voltage = GLOBAL.voltage1ph;
      } else {
        n[prop] = v;
        // Синхронизация цвета ИБП на одном parallel-щите
        if (prop === 'lineColor' && n.type === 'ups') syncUpsColors(n, v);
        // Зоны: смена zonePrefix → если такой же effectiveTag уже есть
        // у другой зоны, копируем её name/color в текущую (подхват).
        // Затем в любом случае пробрасываем текущие значения на все
        // зоны с этим же effectiveTag — чтобы ничего не разъехалось.
        if (n.type === 'zone' && prop === 'zonePrefix') {
          const eff = effectiveTag(n);
          if (eff) {
            for (const other of state.nodes.values()) {
              if (other.id === n.id || other.type !== 'zone') continue;
              if (effectiveTag(other) !== eff) continue;
              if (other.name) n.name = other.name;
              if (other.color) n.color = other.color;
              break;
            }
            _syncZoneByEffectiveTag(n, { name: n.name, color: n.color });
          }
        }
        // Зоны: при смене name или color — проброс на все зоны с тем же
        // полным обозначением (effectiveTag учитывает и подзоны).
        if (n.type === 'zone' && (prop === 'name' || prop === 'color')) {
          _syncZoneByEffectiveTag(n, { [prop]: v });
        }
        // При включении trayMode — пересвязать waypoints к центру канала
        if (prop === 'trayMode' && n.type === 'channel' && v) {
          const tw = n.trayWidth || 40;
          const tl = (n.trayLength || 120);
          const cx = n.x + tw / 2;
          const cy = n.y + tl / 2;
          for (const c of state.conns.values()) {
            if (!Array.isArray(c.channelIds) || !c.channelIds.includes(n.id)) continue;
            if (!Array.isArray(c.waypoints)) continue;
            // Проверяем, есть ли уже waypoint около центра
            const hasSnap = c.waypoints.some(wp => Math.hypot(wp.x - cx, wp.y - cy) < 30);
            if (!hasSnap) {
              // Добавляем waypoint в центр канала
              c.waypoints.push({ x: cx, y: cy });
            } else {
              // Перемещаем существующий ближайший waypoint точно в центр
              let best = null, bestDist = Infinity;
              for (const wp of c.waypoints) {
                const d = Math.hypot(wp.x - cx, wp.y - cy);
                if (d < bestDist) { best = wp; bestDist = d; }
              }
              if (best && bestDist < 100) { best.x = cx; best.y = cy; }
            }
          }
        }
      }
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      _render();
      notifyChange();
      // Перерисовать инспектор при изменениях, от которых зависят другие поля
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId' || prop === 'sourceSubtype' || prop === 'channelType' || prop === 'bundling' || prop === 'installMethod' || prop === 'trayMode' || prop === 'auxInput' || prop === 'subtype') {
        renderInspector();
      }
    };
    // Фикс фокуса: для всех полей используем только 'change' (срабатывает на
    // blur / Enter), без 'input' — иначе каждый символ перерисовывает DOM и
    // сбрасывает фокус/каретку в text/number input'ах.
    inp.addEventListener('change', apply);
  });
  // Чекбоксы привязки выходов к входам (avr_paired)
  host.querySelectorAll('[data-oim-out]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('oim:' + n.id);
      const oi = Number(inp.dataset.oimOut);
      const ii = Number(inp.dataset.oimIn);
      if (!Array.isArray(n.outputInputMap)) n.outputInputMap = [];
      while (n.outputInputMap.length <= oi) n.outputInputMap.push([]);
      if (!Array.isArray(n.outputInputMap[oi])) n.outputInputMap[oi] = [];
      if (inp.checked) {
        if (!n.outputInputMap[oi].includes(ii)) n.outputInputMap[oi].push(ii);
      } else {
        n.outputInputMap[oi] = n.outputInputMap[oi].filter(x => x !== ii);
      }
      _render(); notifyChange();
    });
  });
  // Селекты switchover per-output
  host.querySelectorAll('[data-switchover-out]').forEach(sel => {
    sel.addEventListener('change', () => {
      snapshot('switchover:' + n.id);
      const oi = Number(sel.dataset.switchoverOut);
      if (!Array.isArray(n.outputActivateWhenDead)) n.outputActivateWhenDead = [];
      while (n.outputActivateWhenDead.length <= oi) n.outputActivateWhenDead.push(null);
      n.outputActivateWhenDead[oi] = sel.value || null;
      _render(); notifyChange();
    });
  });
  // Чекбоксы параллельного режима щита
  host.querySelectorAll('[data-parallel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('parallel:' + n.id);
      const idx = Number(inp.dataset.parallel);
      if (!Array.isArray(n.parallelEnabled)) n.parallelEnabled = [];
      while (n.parallelEnabled.length <= idx) n.parallelEnabled.push(false);
      n.parallelEnabled[idx] = inp.checked;
      _render();
      notifyChange();
    });
  });
  host.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      snapshot('prio:' + n.id + ':' + idx);
      if (!n.priorities) n.priorities = [];
      n.priorities[idx] = Number(inp.value) || 1;
      _render();
      notifyChange();
    });
  });
  host.querySelectorAll('[data-loadfactor]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('lf:' + n.id);
      setEffectiveLoadFactor(n, inp.value);
      _render();
      notifyChange();
    });
  });

  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => _deleteNode(n.id, { fromPage: state.currentPageId || null }));
  const autoBtn = document.getElementById('btn-open-automation');
  if (autoBtn) autoBtn.addEventListener('click', () => openAutomationModal(n));
  const impBtn = document.getElementById('btn-open-impedance');
  if (impBtn) impBtn.addEventListener('click', () => openImpedanceModal(n));
  const tuBtn = document.getElementById('btn-open-tu-request');
  if (tuBtn) tuBtn.addEventListener('click', () => openTuRequestModal(n));
  // v0.59.631: openGenRatingModal удалён — поля ISO 8528 теперь в openImpedanceModal.
  // Phase 1.20.39 / 1.20.45: модель резервирования источников
  const standbyCb = document.getElementById('src-is-standby');
  if (standbyCb) {
    standbyCb.addEventListener('change', () => {
      n.isStandby = !!standbyCb.checked;
      snapshot();
      notifyChange();
    });
  }
  const backupCb = document.getElementById('src-is-backup');
  if (backupCb) {
    backupCb.addEventListener('change', () => {
      n.isBackup = !!backupCb.checked;
      snapshot();
      notifyChange();
    });
  }
  const redGrp = document.getElementById('src-redundancy-group');
  if (redGrp) {
    redGrp.addEventListener('change', () => {
      const v = String(redGrp.value || '').trim();
      if (v) n.redundancyGroup = v;
      else delete n.redundancyGroup;
      snapshot();
      notifyChange();
    });
  }

  // Управление щитом
  const panelCtrlBtn = document.getElementById('btn-open-panel-control');
  if (panelCtrlBtn && n.type === 'panel') {
    panelCtrlBtn.addEventListener('click', () => openPanelControlModal(n));
  }
  // Параметры щита
  const panelParamsBtn = document.getElementById('btn-open-panel-params');
  if (panelParamsBtn && n.type === 'panel') {
    panelParamsBtn.addEventListener('click', () => {
      // v0.59.88: кнопка живёт во вкладке «Электрика» сайдбара — модалку
      // открываем сразу на вкладке «Электрика», не на «Общее».
      setModalActiveTab(n.id, 'electrical');
      openPanelParamsModal(n);
    });
  }
  const upsParamsBtn = document.getElementById('btn-open-ups-params');
  if (upsParamsBtn && n.type === 'ups') {
    upsParamsBtn.addEventListener('click', () => openUpsParamsModal(n));
  }
  const upsControlBtn = document.getElementById('btn-open-ups-control');
  if (upsControlBtn && n.type === 'ups') {
    upsControlBtn.addEventListener('click', () => openUpsControlModal(n));
  }
  const upsBatteryBtn = document.getElementById('btn-open-ups-battery');
  if (upsBatteryBtn && n.type === 'ups') {
    upsBatteryBtn.addEventListener('click', () => openUpsBatteryModal(n));
  }
  const consParamsBtn = document.getElementById('btn-open-consumer-params');
  if (consParamsBtn && n.type === 'consumer') {
    consParamsBtn.addEventListener('click', () => openConsumerParamsModal(n));
  }

  // Балансировка фаз на щите
  const balanceBtn = document.getElementById('btn-balance-panel');
  if (balanceBtn && n.type === 'panel') {
    balanceBtn.addEventListener('click', () => {
      snapshot('balance:' + n.id);
      // Собираем однофазных потребителей на этом щите
      const singlePhase = [];
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== n.id) continue;
        const to = state.nodes.get(c.to.nodeId);
        if (!to || to.type !== 'consumer') continue;
        const ph = to.phase || '3ph';
        if (ph !== '3ph') singlePhase.push(to);
      }
      if (!singlePhase.length) { flash('Нет однофазных потребителей на щите'); return; }
      // Жадный алгоритм с учётом групп:
      //  - Последовательная группа (serialMode) = один неделимый загруз (всю группу на одну фазу)
      //  - Параллельная группа (count>1, !serialMode) = N отдельных элементов,
      //    распределяем по фазам так, чтобы не все сидели на одной фазе.
      const load = { A: 0, B: 0, C: 0 };
      // 3ф нагрузки равномерно в трёх фазах
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== n.id) continue;
        const to = state.nodes.get(c.to.nodeId);
        if (!to || to.type !== 'consumer' || (to.phase || '3ph') !== '3ph') continue;
        const kw = consumerTotalDemandKw(to);
        load.A += kw/3; load.B += kw/3; load.C += kw/3;
      }
      // Разворачиваем однофазных в поэлементный список (1 атом = 1 физический прибор)
      const units = []; // { cons, unitKw, groupIdx }
      for (const cons of singlePhase) {
        const cnt = Math.max(1, Number(cons.count) || 1);
        const perUnit = Number(cons.demandKw) || 0;
        cons._balCounts = { A: 0, B: 0, C: 0 };
        if (cnt > 1 && !cons.serialMode) {
          // Разбиваем параллельную группу на cnt независимых элементов
          for (let k = 0; k < cnt; k++) units.push({ cons, unitKw: perUnit });
        } else {
          // serialMode или одиночный потребитель — единый атом
          units.push({ cons, unitKw: perUnit * cnt });
        }
      }
      // Сортируем элементы по убыванию мощности
      units.sort((a, b) => b.unitKw - a.unitKw);
      // Жадно назначаем на наименее нагруженную фазу
      for (const u of units) {
        const min = Math.min(load.A, load.B, load.C);
        const ph = load.A === min ? 'A' : (load.B === min ? 'B' : 'C');
        load[ph] += u.unitKw;
        u.cons._balCounts[ph] += 1;
      }
      // Записываем результат назад на потребителей
      for (const cons of singlePhase) {
        const bc = cons._balCounts;
        delete cons._balCounts;
        const cnt = Math.max(1, Number(cons.count) || 1);
        if (cnt > 1 && !cons.serialMode) {
          // Параллельная группа — сохраняем распределение, доминирующая фаза
          cons.phaseDistribution = { A: bc.A, B: bc.B, C: bc.C };
          const maxC = Math.max(bc.A, bc.B, bc.C);
          cons.phase = bc.A === maxC ? 'A' : (bc.B === maxC ? 'B' : 'C');
        } else {
          // Одиночный / serial — одна фаза, распределение не нужно
          delete cons.phaseDistribution;
          cons.phase = bc.A > 0 ? 'A' : (bc.B > 0 ? 'B' : 'C');
        }
      }
      _render(); renderInspector(); notifyChange();
      flash(`Баланс: A:${fmt(load.A)} B:${fmt(load.B)} C:${fmt(load.C)} kW`);
    });
  }

  // Палитра цветов — клик по квадратику
  host.querySelectorAll('[data-color-pick]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      snapshot('color:' + n.id);
      const newColor = swatch.dataset.colorPick;
      n.lineColor = newColor;
      // Для ИБП: синхронизировать цвет с другими ИБП на том же parallel-щите
      if (n.type === 'ups') syncUpsColors(n, newColor);
      _render(); renderInspector(); notifyChange();
    });
  });

  // Генератор: сторона порта СН
  host.querySelectorAll('[data-aux-side]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('auxSide:' + n.id);
      n.auxInputSide = btn.dataset.auxSide;
      _render(); renderInspector(); notifyChange();
    });
  });

  // Фазные кнопки для потребителя
  // === Junction Box ===
  if (n.type === 'junction-box') {
    const ensureChannels = (N) => {
      const cur = Array.isArray(n.channels) ? n.channels : [];
      const out = [];
      for (let i = 0; i < N; i++) {
        out.push(cur[i] ? { ...cur[i] } : { hasProtection: false, protKind: 'breaker', breakerA: 0, fuseA: 0 });
      }
      n.channels = out;
      // bridges с индексами ≥ N удаляем
      if (Array.isArray(n.bridges)) {
        n.bridges = n.bridges.filter(p => (p[0] | 0) < N && (p[1] | 0) < N && (p[0] | 0) !== (p[1] | 0));
      } else n.bridges = [];
    };
    const nInp = host.querySelector('[data-jb-n]');
    if (nInp) nInp.addEventListener('change', () => {
      snapshot('jb:N:' + n.id);
      const N = Math.max(1, Math.min(32, parseInt(nInp.value, 10) || 2));
      n.inputs = N; n.outputs = N;
      ensureChannels(N);
      _render(); renderInspector(); notifyChange();
    });
    const ipInp = host.querySelector('[data-jb-ip]');
    if (ipInp) ipInp.addEventListener('change', () => {
      snapshot('jb:ip:' + n.id); n.ipRating = String(ipInp.value || 'IP54'); notifyChange();
    });
    const capInp = host.querySelector('[data-jb-cap]');
    if (capInp) capInp.addEventListener('change', () => {
      snapshot('jb:cap:' + n.id); n.capacityA = Math.max(1, parseInt(capInp.value, 10) || 63); notifyChange();
    });
    host.querySelectorAll('[data-jb-has]').forEach(cb => {
      cb.addEventListener('change', () => {
        const i = parseInt(cb.dataset.jbHas, 10);
        snapshot('jb:has:' + n.id + ':' + i);
        ensureChannels(n.inputs || n.channels.length || 2);
        n.channels[i].hasProtection = !!cb.checked;
        _render(); renderInspector(); notifyChange();
      });
    });
    host.querySelectorAll('[data-jb-kind]').forEach(sel => {
      sel.addEventListener('change', () => {
        const i = parseInt(sel.dataset.jbKind, 10);
        snapshot('jb:kind:' + n.id + ':' + i);
        ensureChannels(n.inputs || n.channels.length || 2);
        n.channels[i].protKind = sel.value === 'fuse' ? 'fuse' : 'breaker';
        renderInspector(); notifyChange();
      });
    });
    host.querySelectorAll('[data-jb-in]').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = parseInt(inp.dataset.jbIn, 10);
        snapshot('jb:in:' + n.id + ':' + i);
        ensureChannels(n.inputs || n.channels.length || 2);
        const v = Math.max(0, parseFloat(inp.value) || 0);
        if (n.channels[i].protKind === 'fuse') n.channels[i].fuseA = v;
        else n.channels[i].breakerA = v;
        notifyChange();
      });
    });
    const maintBox = host.querySelector('[data-jb-maint]');
    if (maintBox) maintBox.addEventListener('change', () => {
      snapshot('jb:maint:' + n.id);
      n.maintenance = !!maintBox.checked;
      _render(); renderInspector(); notifyChange();
    });
    host.querySelectorAll('[data-jb-closed]').forEach(cb => {
      cb.addEventListener('change', () => {
        const i = parseInt(cb.dataset.jbClosed, 10);
        snapshot('jb:closed:' + n.id + ':' + i);
        ensureChannels(n.inputs || n.channels.length || 2);
        n.channels[i].closed = !!cb.checked;
        _render(); renderInspector(); notifyChange();
      });
    });
    host.querySelectorAll('[data-jb-br-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = parseInt(btn.dataset.jbBrDel, 10);
        snapshot('jb:br-del:' + n.id + ':' + k);
        if (Array.isArray(n.bridges)) n.bridges.splice(k, 1);
        renderInspector(); notifyChange();
      });
    });
    const addBtn = document.getElementById('btn-jb-br-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      const a = parseInt(host.querySelector('[data-jb-br-a]')?.value, 10);
      const b = parseInt(host.querySelector('[data-jb-br-b]')?.value, 10);
      const N = n.inputs || (Array.isArray(n.channels) ? n.channels.length : 0) || 2;
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a > N || b > N || a === b) return;
      snapshot('jb:br-add:' + n.id);
      if (!Array.isArray(n.bridges)) n.bridges = [];
      const ia = a - 1, ib = b - 1;
      const exists = n.bridges.some(p => (p[0] === ia && p[1] === ib) || (p[0] === ib && p[1] === ia));
      if (!exists) n.bridges.push([ia, ib]);
      renderInspector(); notifyChange();
    });
  }

  host.querySelectorAll('[data-phase-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('phase:' + n.id);
      n.phase = btn.dataset.phaseBtn;
      _render(); renderInspector(); notifyChange();
    });
  });

  // Расположение входов потребителя
  host.querySelectorAll('[data-input-side]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('inputSide:' + n.id);
      n.inputSide = btn.dataset.inputSide;
      _render(); renderInspector(); notifyChange();
    });
  });

  // Авто-балансировка фазы потребителя
  const autoPhaseBtn = document.getElementById('btn-auto-phase');
  if (autoPhaseBtn && n.type === 'consumer') {
    autoPhaseBtn.addEventListener('click', () => {
      snapshot('auto-phase:' + n.id);
      // Найдём щит, к которому подключён потребитель
      let panelId = null;
      for (const c of state.conns.values()) {
        if (c.to.nodeId === n.id) {
          const from = state.nodes.get(c.from.nodeId);
          if (from && from.type === 'panel') { panelId = from.id; break; }
          // Может через UPS/канал — идём выше
          if (from) {
            for (const c2 of state.conns.values()) {
              if (c2.to.nodeId === from.id) {
                const up = state.nodes.get(c2.from.nodeId);
                if (up && up.type === 'panel') { panelId = up.id; break; }
              }
            }
          }
          if (panelId) break;
        }
      }
      // Считаем нагрузку по фазам на этом щите (без текущего потребителя)
      const load = { A: 0, B: 0, C: 0 };
      for (const other of state.nodes.values()) {
        if (other.type !== 'consumer' || other.id === n.id) continue;
        // Проверяем что потребитель на том же щите
        let samePanel = false;
        for (const c of state.conns.values()) {
          if (c.to.nodeId === other.id && c.from.nodeId === panelId) { samePanel = true; break; }
        }
        if (!samePanel) continue;
        const kw = consumerTotalDemandKw(other);
        const ph = other.phase || '3ph';
        if (ph === '3ph') { load.A += kw/3; load.B += kw/3; load.C += kw/3; }
        else if (ph === 'A') load.A += kw;
        else if (ph === 'B') load.B += kw;
        else if (ph === 'C') load.C += kw;
      }
      // Выбираем наименее нагруженную фазу
      const min = Math.min(load.A, load.B, load.C);
      if (load.A === min) n.phase = 'A';
      else if (load.B === min) n.phase = 'B';
      else n.phase = 'C';
      _render(); renderInspector(); notifyChange();
      flash(`Фаза: ${n.phase} (A:${fmt(load.A)} B:${fmt(load.B)} C:${fmt(load.C)} kW)`);
    });
  }
}

// openImpedanceModal / openAutomationModal / voltageLevelOptions / sourceStatusBlock
// перенесены в inspector-source.js (re-export ниже).

// openConsumerParamsModal перенесён в inspector-consumer.js (re-export ниже).

// ================= Модалка «Параметры ИБП» =================
// UPS-функции (openUpsParamsModal / openUpsControlModal / upsStatusBlock)
// перенесены в inspector-ups.js. Re-export ниже в конце файла.

// ================= Модалка «Параметры щита» =================

// ================= Модалка «Управление щитом» =================
// IEC 60617 автоматический выключатель (circuit breaker symbol)
// Структура сверху вниз:
//   - верхняя вертикальная линия (подвод)
//   - крестик (механизм расцепителя) — всегда сверху
//   - подвижный контакт: ось вращения СНИЗУ
//     ON:  контакт вертикален (замкнут, совпадает с линией)
//     OFF: контакт отклонён влево ~30° от оси снизу
//   - нижняя точка (ось вращения / нижний контакт)

// ================= Многосекционный щит — SVG визуализация =================
// (_pcZoomState перенесён в inspector/panel.js)


// Возвращает inline SVG строку для иконки способа прокладки (для инспектора)
// channelIconSVG / bundlingIconSVG / buildInstallConditionsBlock /
// installCoefficientBlock / renderInspectorConn перенесены в inspector-conn.js.

// Функции щитов (openPanelParamsModal / openPanelControlModal / svgBreaker /
// _renderSectionedPanelControl / panelStatusBlock) перенесены в inspector-panel.js
// (re-export ниже).


// Inline SVG строка для иконки расположения кабелей (для инспектора)

// Поле уровня напряжения — выбор из справочника
// Синхронизация цвета ИБП: все ИБП, подключённые к одному downstream
// parallel-щиту, должны иметь одинаковый цвет линии
function syncUpsColors(ups, color) {
  // Найдём downstream-щит этого ИБП
  let targetPanelId = null;
  for (const c of state.conns.values()) {
    if (c.from.nodeId === ups.id) {
      const to = state.nodes.get(c.to.nodeId);
      if (to && to.type === 'panel') { targetPanelId = to.id; break; }
    }
  }
  if (!targetPanelId) return;
  // Найдём все другие ИБП, подключённые к этому же щиту
  for (const c of state.conns.values()) {
    if (c.to.nodeId === targetPanelId) {
      const from = state.nodes.get(c.from.nodeId);
      if (from && from.type === 'ups' && from.id !== ups.id) {
        from.lineColor = color;
      }
    }
  }
}

// Палитра цветов: 16 стандартных + до 8 пользовательских
function buildColorPalette(n) {
  const curColor = n.lineColor || '#e53935';
  const paletteSet = new Set(LINE_COLORS);
  // Собираем пользовательские цвета (используемые в проекте, не входящие в палитру)
  const userColors = [];
  for (const nn of state.nodes.values()) {
    if (nn.lineColor && !paletteSet.has(nn.lineColor) && nn.lineColor !== curColor) {
      if (!userColors.includes(nn.lineColor) && userColors.length < 8) {
        userColors.push(nn.lineColor);
      }
    }
  }
  const sz = 18; // размер квадратика
  let h = `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin-bottom:4px">`;
  // 16 палитры
  for (const c of LINE_COLORS) {
    const sel = c === curColor;
    h += `<div data-color-pick="${c}" style="width:${sz}px;height:${sz}px;border-radius:2px;background:${c};border:2px solid ${sel ? '#000' : 'transparent'};cursor:pointer;${sel ? 'box-shadow:0 0 0 1px #fff inset' : ''}" title="${c}"></div>`;
  }
  h += '</div>';
  // Пользовательские (если есть)
  if (userColors.length) {
    h += `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin-bottom:4px">`;
    for (const c of userColors) {
      const sel = c === curColor;
      h += `<div data-color-pick="${c}" style="width:${sz}px;height:${sz}px;border-radius:2px;background:${c};border:2px solid ${sel ? '#000' : '#ddd'};cursor:pointer" title="${c}"></div>`;
    }
    h += '</div>';
  }
  // Произвольный цвет
  h += `<input type="color" data-prop="lineColor" value="${curColor}" style="width:${sz + 4}px;height:${sz + 4}px;padding:0;border:1px solid #ccc;border-radius:3px;cursor:pointer" title="Произвольный цвет">`;
  return h;
}

export function voltageField(n) {
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  // Синхронизируем voltage из уровня
  if (levels[curIdx]) {
    n.voltage = levels[curIdx].vLL;
    n.phase = levels[curIdx].phases === 3 ? '3ph' : '1ph';
  }
  let opts = '';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    opts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(lv))}</option>`;
  }
  return field('Уровень напряжения',
    `<select data-prop="voltageLevelIdx">${opts}</select>`) +
    `<div class="muted" style="font-size:10px;margin-top:-6px;margin-bottom:8px">V_LL: ${levels[curIdx]?.vLL || 400} В, V_LN: ${levels[curIdx]?.vLN || 230} В, фаз: ${levels[curIdx]?.phases || 3}. Число жил — по наличию N/PE (в параметрах узла). Справочник — в «Начальных условиях».</div>`;
}

// Поле фазы 3ph/1ph для источников/генераторов/ИБП
export function phaseField(n) {
  const ph = n.phase || '3ph';
  return field('Фазность',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="1ph"${ph === '1ph' ? ' selected' : ''}>Однофазная (230 В)</option>
    </select>`);
}
// Поле фазы для потребителя (A/B/C/3ph)
export function phaseFieldConsumer(n) {
  const ph = n.phase || '3ph';
  return field('Фаза',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="A"${ph === 'A' ? ' selected' : ''}>Фаза A (230 В)</option>
      <option value="B"${ph === 'B' ? ' selected' : ''}>Фаза B (230 В)</option>
      <option value="C"${ph === 'C' ? ' selected' : ''}>Фаза C (230 В)</option>
    </select>`);
}
// sourceStatusBlock перенесён в inspector-source.js (re-export ниже).
// Блок статуса для щита
// Блок расчётных токов для потребителя
export function consumerCurrentsBlock(n) {
  // v0.59.885: для consumer-container — count = число slot'ов,
  // чтобы блок «На единицу» корректно делил суммы на slot.length.
  const cnt = (n.type === 'consumer-container' && Array.isArray(n.slots))
    ? Math.max(1, n.slots.length)
    : Math.max(1, Number(n.count) || 1);
  const isGroup = cnt > 1;
  const parts = [];

  // Суммарные величины (группа или единичный)
  parts.push(`<b>P акт.:</b> ${fmt(n._powerP || 0)} kW`);
  parts.push(`<b>Q реакт.:</b> ${fmt(n._powerQ || 0)} kvar`);
  parts.push(`<b>S полн.:</b> ${fmt(n._powerS || 0)} kVA`);
  parts.push(`<b>Установочный ток:</b> ${fmt(n._nominalA || 0)} А`);
  parts.push(`<b>Расчётный ток:</b> ${fmt(n._ratedA || 0)} А  <span class="muted">(с учётом Ки)</span>`);
  if ((n.inrushFactor || 1) > 1) {
    parts.push(`<b>Пусковой ток:</b> ${fmt(n._inrushA || 0)} А`);
  }

  let html = `<div class="inspector-section"><h4>Расчётные величины${isGroup ? ' (группа)' : ''}</h4><div style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div>`;

  // Для групповых — добавить расчёт на единицу
  if (isGroup) {
    const perP = (n._powerP || 0) / cnt;
    const perQ = (n._powerQ || 0) / cnt;
    const perS = (n._powerS || 0) / cnt;
    const perNomA = (n._nominalA || 0) / cnt;
    const perRatedA = (n._ratedA || 0) / cnt;
    const unitParts = [];
    unitParts.push(`<b>P акт.:</b> ${fmt(perP)} kW`);
    unitParts.push(`<b>Q реакт.:</b> ${fmt(perQ)} kvar`);
    unitParts.push(`<b>S полн.:</b> ${fmt(perS)} kVA`);
    unitParts.push(`<b>Установочный ток:</b> ${fmt(perNomA)} А`);
    unitParts.push(`<b>Расчётный ток:</b> ${fmt(perRatedA)} А`);
    html += `<h4 style="margin-top:10px">На единицу (1 из ${cnt})</h4><div style="font-size:11px;line-height:1.8">${unitParts.join('<br>')}</div>`;
  }

  html += '</div>';
  return html;
}

export function prioritySection(n) {
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
// v0.60.165: helper для distinguishing «orphan» vs «idle» (см. render.js
// _hasUpstreamSource v0.60.164). Inline-копия для inspector.js — оба
// модуля шарят state.nodes / state.conns через тот же import.
function _hasUpstreamSourceForInspector(n) {
  if (!n) return false;
  const visited = new Set();
  const stack = [n.id];
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = state.nodes.get(id);
    if (!node) continue;
    if (id !== n.id && (node.type === 'source' || node.type === 'generator' || node.type === 'ups')) {
      return true;
    }
    for (const c of state.conns.values()) {
      if (c?.to?.nodeId !== id) continue;
      const fromId = c?.from?.nodeId;
      if (fromId && !visited.has(fromId)) stack.push(fromId);
    }
  }
  return false;
}
export function statusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">есть питание</span>');
  else {
    // v0.60.165: «В резерве» если есть upstream source (но он currently off).
    // «Без питания» только для truly disconnected nodes.
    const isIdle = _hasUpstreamSourceForInspector(n);
    parts.push(isIdle
      ? '<span class="badge" style="background:#fef3c7;color:#92400e">в резерве</span>'
      : '<span class="badge off">без питания</span>');
  }
  if (n.type === 'panel') parts.push(` нагрузка: <b>${fmt(n._loadKw)} kW</b>`);
  return `<div class="inspector-section"><div class="muted" style="font-size:11px">${parts.join(' ')}</div></div>`;
}

// upsStatusBlock перенесён в inspector-ups.js (re-export в конце файла)

// Общая функция: блок «Условия прокладки» — идентичный для канала и линии
// propPrefix: 'data-prop' для канала, 'data-conn-prop' для линии


export function checkFieldEff(label, n, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}

export function clientToSvg(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = state.view.x + (clientX - rect.left) / state.view.zoom;
  const y = state.view.y + (clientY - rect.top)  / state.view.zoom;
  return { x, y };
}

// ===== Re-exports из модульных файлов =====
// Реэкспорт импортированных символов для backward-compat (index.js, main.js).
export { openUpsParamsModal, openUpsControlModal, openUpsBatteryModal, upsStatusBlock };
export { openConsumerParamsModal };
export { openImpedanceModal, openAutomationModal, sourceStatusBlock, voltageLevelOptions };
export { openPanelParamsModal, openPanelControlModal, panelStatusBlock };
export { renderInspectorConn, channelIconSVG, bundlingIconSVG, buildInstallConditionsBlock, installCoefficientBlock };
