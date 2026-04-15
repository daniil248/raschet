import { state, svg, inspectorBody, uid, pagesForNode } from './state.js';
import { GLOBAL, DEFAULTS, CHANNEL_TYPES, CABLE_TYPES, NODE_H, LINE_COLORS, CONSUMER_CATALOG, TRANSFORMER_CATALOG, INSTALL_METHODS, BREAKER_SERIES, BREAKER_TYPES } from './constants.js';
import { escHtml, escAttr, fmt, field, checkField, flash } from './utils.js';
import { nodeVoltage, isThreePhase, computeCurrentA, nodeWireCount, cableVoltageClass } from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth } from './geometry.js';
import { effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor } from './modes.js';
import { snapshot, notifyChange } from './history.js';
import { clampPortsInvolvingNode, nextFreeTag } from './graph.js';
import { panelCosPhi, downstreamPQ } from './recalc.js';
import { effectiveTag, findZoneForMember, nodesInZone, maxOccupiedPort } from './zones.js';
import { kTempLookup, kGroupLookup, kBundlingFactor, selectCableSize } from './cable.js';
import { getMethod } from '../methods/index.js';

// Внешние зависимости, устанавливаемые через bindInspectorDeps
import {
  bindInspectorUpsDeps,
  openUpsParamsModal,
  openUpsControlModal,
  upsStatusBlock,
} from './inspector-ups.js';
import {
  bindInspectorConsumerDeps,
  openConsumerParamsModal,
} from './inspector-consumer.js';
import {
  bindInspectorSourceDeps,
  openImpedanceModal,
  openAutomationModal,
  sourceStatusBlock,
  voltageLevelOptions,
} from './inspector-source.js';
import {
  bindInspectorPanelDeps,
  openPanelParamsModal,
  openPanelControlModal,
  panelStatusBlock,
} from './inspector-panel.js';
let _render, _deleteNode, _deleteConn, _isTagUnique;
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
}

// ================= Инспектор =================
export function selectNode(id) {
  state.selectedKind = 'node'; state.selectedId = id;
  renderInspector();
}
export function selectConn(id) {
  state.selectedKind = 'conn'; state.selectedId = id;
  renderInspector();
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

  // Тип страницы + parent для ссылочной
  const independents = (state.pages || []).filter(p => p.type !== 'linked' && p.id !== page.id);
  let typeHtml = `
    <select id="pg-type">
      <option value="independent"${page.type !== 'linked' ? ' selected' : ''}>Независимая</option>`;
  for (const parent of independents) {
    const sel = page.type === 'linked' && page.sourcePageId === parent.id;
    typeHtml += `<option value="linked:${escAttr(parent.id)}"${sel ? ' selected' : ''}>Ссылочная → ${escHtml(parent.name || parent.id)}</option>`;
  }
  typeHtml += `</select>`;
  h.push(field('Тип', typeHtml));

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
}

export function renderInspectorNode(n) {
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
    h.push(field('Комментарии', `<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical">${escHtml(n.comment || '')}</textarea>`));
    h.push('<button class="btn-delete" id="btn-del-node">Удалить зону</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
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
        const lineLabel = `W-${fromTag}-${toTag}`;
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

  h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
  // Показать эффективное обозначение если отличается
  const eff = effectiveTag(n);
  if (eff && eff !== n.tag) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное обозначение: <b>${escHtml(eff)}</b></div>`);
  }
  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

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
    }
    h.push(field('Цвет линии', buildColorPalette(n)));
    // cos φ источника рассчитывается автоматически из downstream нагрузки.
    // Для генератора номинальный cos φ задаётся в параметрах источника.
    if (n._cosPhi) {
      h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px">cos φ (расчётный): <b>${n._cosPhi.toFixed(3)}</b></div>`);
    }
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));

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
    }

    // Все номинальные параметры (мощность, напряжение, Ssc, Uk%, Xs/Rs) — в модалке
    h.push(`<button class="full-btn" id="btn-open-impedance" style="margin-top:6px">🔌 Параметры источника (IEC 60909)</button>`);
    // Справка: текущие значения из модалки
    const levels = GLOBAL.voltageLevels || [];
    const outLevel = levels[n.voltageLevelIdx] || null;
    const outLabel = outLevel ? outLevel.label : `${nodeVoltage(n)} В`;
    let voltInfo = `Uвых: <b>${outLabel}</b>`;
    if (subtype === 'transformer' && typeof n.inputVoltageLevelIdx === 'number' && levels[n.inputVoltageLevelIdx]) {
      voltInfo = `Uвх: <b>${levels[n.inputVoltageLevelIdx].label}</b> → Uвых: <b>${outLabel}</b>`;
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

    h.push(`<button type="button" class="full-btn" id="btn-balance-panel" style="margin-top:8px">⚖ Балансировка фаз на щите</button>`);
    h.push(panelStatusBlock(n));
  } else if (n.type === 'ups') {
    h.push(`<button class="full-btn" id="btn-open-ups-control" style="margin-bottom:4px">🔌 Управление ИБП</button>`);
    h.push(`<button class="full-btn" id="btn-open-ups-params" style="margin-bottom:8px">⚙ Параметры ИБП</button>`);
    h.push(field('Цвет линии', buildColorPalette(n)));
    // Краткая сводка
    const battPct = Math.round(n.batteryChargePct || 0);
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      `Pном: <b>${fmt(n.capacityKw)} kW</b> · КПД: <b>${n.efficiency || 100}%</b> · АКБ: <b>${fmt(n.batteryKwh || 0)} kWh (${battPct}%)</b>` +
      `</div>`);
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
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
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      (cnt > 1 ? `Группа: <b>${cnt} × ${fmt(n.demandKw)} kW = ${fmt(cnt * (n.demandKw || 0))} kW</b>` : `P: <b>${fmt(n.demandKw)} kW</b>`) +
      ` · ${phLabel} · cos φ: <b>${(n.cosPhi ?? 0.92).toFixed(2)}</b> · Ки: <b>${(n.kUse ?? 1).toFixed(2)}</b>` +
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
  }

  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Изменения параметра «В работе» сохраняются в режиме <b>${escAttr(m?.name || '')}</b></div></div>`);
  }

  // Комментарии — для всех типов элементов
  h.push(field('Комментарии', `<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical">${escHtml(n.comment || '')}</textarea>`));

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

  // Полный дамп параметров узла
  h.push(renderFullPropsBlock(n));

  inspectorBody.innerHTML = h.join('');

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

  const saveBtn = document.getElementById('btn-save-preset');
  if (saveBtn) saveBtn.addEventListener('click', () => saveNodeAsPreset(n));
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
export function saveNodeAsPreset(n) {
  const name = n.name || n.type;
  if (!confirm(`Сохранить «${name}» в библиотеку?`)) return;
  const params = JSON.parse(JSON.stringify(n));
  delete params.id; delete params.x; delete params.y; delete params.tag;
  for (const k of Object.keys(params)) if (k.startsWith('_')) delete params[k];
  // Убираем привязки к конкретным элементам схемы
  delete params.linkedOutdoorId; delete params.linkedIndoorId;
  const list = loadUserPresets();
  const TYPE_CATEGORY = { source: 'Источники', generator: 'Генераторы', panel: 'Щиты', ups: 'ИБП', consumer: 'Потребители', channel: 'Каналы' };
  list.push({
    id: 'user-' + Date.now().toString(36),
    category: TYPE_CATEGORY[n.type] || 'Прочее',
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

export function wireInspectorInputs(n) {
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
        if (!_isTagUnique(t, n.id)) {
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
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId' || prop === 'sourceSubtype' || prop === 'channelType' || prop === 'bundling' || prop === 'installMethod' || prop === 'trayMode' || prop === 'auxInput') {
        renderInspector();
      }
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', apply);
  });
  // Чекбоксы привязки выходов к входам (avr_paired)
  inspectorBody.querySelectorAll('[data-oim-out]').forEach(inp => {
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
  inspectorBody.querySelectorAll('[data-switchover-out]').forEach(sel => {
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
  inspectorBody.querySelectorAll('[data-parallel]').forEach(inp => {
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
  inspectorBody.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      snapshot('prio:' + n.id + ':' + idx);
      if (!n.priorities) n.priorities = [];
      n.priorities[idx] = Number(inp.value) || 1;
      _render();
      notifyChange();
    });
  });
  inspectorBody.querySelectorAll('[data-loadfactor]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('lf:' + n.id);
      setEffectiveLoadFactor(n, inp.value);
      _render();
      notifyChange();
    });
  });

  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => _deleteNode(n.id));
  const autoBtn = document.getElementById('btn-open-automation');
  if (autoBtn) autoBtn.addEventListener('click', () => openAutomationModal(n));
  const impBtn = document.getElementById('btn-open-impedance');
  if (impBtn) impBtn.addEventListener('click', () => openImpedanceModal(n));

  // Управление щитом
  const panelCtrlBtn = document.getElementById('btn-open-panel-control');
  if (panelCtrlBtn && n.type === 'panel') {
    panelCtrlBtn.addEventListener('click', () => openPanelControlModal(n));
  }
  // Параметры щита
  const panelParamsBtn = document.getElementById('btn-open-panel-params');
  if (panelParamsBtn && n.type === 'panel') {
    panelParamsBtn.addEventListener('click', () => openPanelParamsModal(n));
  }
  const upsParamsBtn = document.getElementById('btn-open-ups-params');
  if (upsParamsBtn && n.type === 'ups') {
    upsParamsBtn.addEventListener('click', () => openUpsParamsModal(n));
  }
  const upsControlBtn = document.getElementById('btn-open-ups-control');
  if (upsControlBtn && n.type === 'ups') {
    upsControlBtn.addEventListener('click', () => openUpsControlModal(n));
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
        const kw = (Number(to.demandKw) || 0) * Math.max(1, Number(to.count) || 1);
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
  inspectorBody.querySelectorAll('[data-color-pick]').forEach(swatch => {
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
  inspectorBody.querySelectorAll('[data-aux-side]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('auxSide:' + n.id);
      n.auxInputSide = btn.dataset.auxSide;
      _render(); renderInspector(); notifyChange();
    });
  });

  // Фазные кнопки для потребителя
  inspectorBody.querySelectorAll('[data-phase-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('phase:' + n.id);
      n.phase = btn.dataset.phaseBtn;
      _render(); renderInspector(); notifyChange();
    });
  });

  // Расположение входов потребителя
  inspectorBody.querySelectorAll('[data-input-side]').forEach(btn => {
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
        const kw = (Number(other.demandKw) || 0) * Math.max(1, Number(other.count) || 1);
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

// Сохраняемое состояние зума модалки управления щитом
let _pcZoomState = { zoom: 1, fullscreen: false };


// Возвращает inline SVG строку для иконки способа прокладки (для инспектора)
// Функции щитов (openPanelParamsModal / openPanelControlModal / svgBreaker /
// _renderSectionedPanelControl / panelStatusBlock) перенесены в inspector-panel.js
// (re-export ниже).

export function channelIconSVG(channelType, size) {
  const s = size || 48;
  const scale = s / 36;
  let paths = '';
  // Упрощённые версии иконок как inline SVG строка
  function circSvg(cx, cy, r, fill, stroke) {
    return `<circle cx="${cx * scale}" cy="${cy * scale}" r="${r * scale}" fill="${fill || 'none'}" stroke="${stroke || '#555'}" stroke-width="${1.2 * scale}"/>`;
  }
  function dotsSvg(cx, cy, r) {
    const jr = r * 0.28 * scale;
    return circSvg(cx, cy, r, 'none', '#555') +
      `<circle cx="${(cx - r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${(cx + r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${cx * scale}" cy="${(cy + r * 0.2) * scale}" r="${jr}" fill="#555"/>`;
  }
  function hatch(x, y, w, h) {
    let r = `<rect x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="#888" stroke-width="${scale}"/>`;
    for (let i = 0; i < w; i += 4) {
      r += `<line x1="${(x + i) * scale}" y1="${(y + h) * scale}" x2="${(x + i + 4) * scale}" y2="${y * scale}" stroke="#ccc" stroke-width="${0.5 * scale}"/>`;
    }
    return r;
  }

  // Поддержка и channelType (legacy), и IEC метода
  const ct = ({
    A1: 'conduit', A2: 'conduit', B1: 'conduit', B2: 'tray_solid',
    C: 'wall', E: 'tray_perf', F: 'tray_ladder', G: 'wall',
    D1: 'ground', D2: 'ground_direct',
  })[channelType] || channelType || 'conduit';

  switch (ct) {
    case 'conduit': case 'insulated_conduit': case 'insulated_cable':
      paths = hatch(0, 0, 36, 8) + circSvg(18, 18, 9, 'none', '#888') + dotsSvg(18, 18, 5); break;
    case 'tray_solid':
      paths = `<rect x="${2 * scale}" y="${10 * scale}" width="${32 * scale}" height="${14 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 17, 5); break;
    case 'wall':
      paths = hatch(0, 0, 36, 8) + dotsSvg(18, 18, 6); break;
    case 'tray_perf': case 'tray_wire':
      paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_ladder': case 'air':
      paths = `<line x1="${4 * scale}" y1="${16 * scale}" x2="${4 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${32 * scale}" y1="${16 * scale}" x2="${32 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${4 * scale}" y1="${21 * scale}" x2="${32 * scale}" y2="${21 * scale}" stroke="#888" stroke-width="${0.8 * scale}"/>` + dotsSvg(18, 12, 5); break;
    case 'ground':
      paths = hatch(0, 0, 36, 28) + circSvg(18, 14, 8, 'none', '#888') + dotsSvg(18, 14, 4.5); break;
    case 'ground_direct':
      paths = hatch(0, 0, 36, 28) + dotsSvg(18, 14, 5.5); break;
    default: paths = dotsSvg(18, 14, 6);
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s * 28 / 36}">${paths}</svg>`;
}

// Inline SVG строка для иконки расположения кабелей (для инспектора)
export function bundlingIconSVG(bundling, size) {
  const s = size || 48;
  let svg = '';
  if (bundling === 'spaced') {
    svg = `<circle cx="12" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="12" cy="16" r="2" fill="#555"/><circle cx="36" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="36" cy="16" r="2" fill="#555"/><line x1="18" y1="8" x2="30" y2="8" stroke="#1976d2" stroke-width="0.8"/><text x="24" y="7" text-anchor="middle" fill="#1976d2" font-size="6">≥Ø</text>`;
  } else if (bundling === 'bundled') {
    svg = `<ellipse cx="24" cy="16" rx="18" ry="12" fill="none" stroke="#888" stroke-width="0.8" stroke-dasharray="3 2"/><circle cx="16" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="12" r="2" fill="#555"/><circle cx="30" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="30" cy="12" r="2" fill="#555"/><circle cx="23" cy="22" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="23" cy="22" r="2" fill="#555"/>`;
  } else {
    svg = `<circle cx="16" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="16" r="2" fill="#555"/><circle cx="32" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="32" cy="16" r="2" fill="#555"/>`;
  }
  return `<svg width="${s}" height="${s * 32 / 48}" viewBox="0 0 48 32">${svg}</svg>`;
}

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
    opts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(lv.label)} (${lv.vLL}V)</option>`;
  }
  return field('Уровень напряжения',
    `<select data-prop="voltageLevelIdx">${opts}</select>`) +
    `<div class="muted" style="font-size:10px;margin-top:-6px;margin-bottom:8px">V_LL: ${levels[curIdx]?.vLL || 400} В, V_LN: ${levels[curIdx]?.vLN || 230} В, ${levels[curIdx]?.wires || 5} проводов. Справочник — в «Начальных условиях».</div>`;
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
  const cnt = Math.max(1, Number(n.count) || 1);
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
export function statusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">есть питание</span>');
  else parts.push('<span class="badge off">без питания</span>');
  if (n.type === 'panel') parts.push(` нагрузка: <b>${fmt(n._loadKw)} kW</b>`);
  return `<div class="inspector-section"><div class="muted" style="font-size:11px">${parts.join(' ')}</div></div>`;
}

// upsStatusBlock перенесён в inspector-ups.js (re-export в конце файла)

// Общая функция: блок «Условия прокладки» — идентичный для канала и линии
// propPrefix: 'data-prop' для канала, 'data-conn-prop' для линии
function buildInstallConditionsBlock(method, bundling, ambientC, grouping, circuits, insulation, propPrefix) {
  const h = [];
  h.push('<details class="inspector-section">');
  h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Условия прокладки</summary>');
  // Способы прокладки из текущей методики
  const cm = getMethod(GLOBAL.calcMethod);
  const methodOpts = Object.entries(cm.installMethods).map(([k, v]) =>
    `<option value="${k}"${method === k ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
  h.push(field('Способ прокладки', `<select ${propPrefix}="installMethod">${methodOpts}</select>`));
  // Укладка из текущей методики
  const bundOpts = cm.hasBundling
    ? Object.entries(cm.bundlingOptions).map(([k, v]) =>
        `<option value="${k}"${bundling === k ? ' selected' : ''}>${escHtml(v)}</option>`).join('')
    : `<option value="touching" selected>Стандарт</option>`;
  h.push(field('Расположение кабелей', `<select ${propPrefix}="bundling">${bundOpts}</select>`));
  // Иконки способа прокладки и расположения
  h.push(`<div style="display:flex;gap:12px;justify-content:center;margin:8px 0">${channelIconSVG(method, 48)}${bundlingIconSVG(bundling, 48)}</div>`);
  h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" ${propPrefix}="ambientC" value="${ambientC || 30}">`));
  h.push(field('Цепей в группе', `<input type="number" min="1" max="50" step="1" ${propPrefix}="grouping" value="${grouping || 1}">`));
  // Коэффициенты
  h.push(installCoefficientBlock(method, ambientC, circuits, bundling, insulation || 'PVC'));
  h.push('</details>');
  return h.join('');
}

// Общая функция: справочные коэффициенты прокладки
// method — IEC метод, ambient — °C, circuits — кол-во цепей, bundling — укладка, insulation — PVC/XLPE
function installCoefficientBlock(method, ambient, circuits, bundling, insulation) {
  const kt = kTempLookup(ambient || 30, insulation || 'PVC');
  const kg = kGroupLookup(Math.max(1, circuits || 0), method || 'B1');
  const kb = kBundlingFactor(bundling || 'touching');
  const ktotal = kt * kg * kb;
  return `<div class="muted" style="font-size:11px;line-height:1.8;margin-top:6px">` +
    `Kt (темп.) = <b>${kt.toFixed(2)}</b> · ` +
    `Kg (группа, ${circuits || 0} цеп.) = <b>${kg.toFixed(2)}</b> · ` +
    `Kb (укладка) = <b>${kb.toFixed(2)}</b><br>` +
    `<b>Kобщ = ${ktotal.toFixed(3)}</b>` +
    `</div>`;
}

export function renderInspectorConn(c) {
  const fromN = state.nodes.get(c.from.nodeId);
  const toN   = state.nodes.get(c.to.nodeId);
  const h = [];
  const fromTag = effectiveTag(fromN) || fromN?.name || '?';
  const toTag = effectiveTag(toN) || toN?.name || '?';
  const autoLineLabel = `W-${fromTag}-${toTag}`;
  const lineLabel = c.lineLabel || autoLineLabel;
  h.push('<div class="muted" style="font-size:12px;margin-bottom:8px">Линия / связь</div>');
  h.push(`<div class="field"><label>Обозначение</label><div style="font-size:12px;font-weight:600">${escHtml(autoLineLabel)}</div></div>`);
  h.push(`<div class="field"><label>Откуда</label><div>${escHtml(fromTag)} · ${escHtml(fromN?.name || '?')} · выход ${c.from.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Куда</label><div>${escHtml(toTag)} · ${escHtml(toN?.name || '?')} · вход ${c.to.port + 1}</div></div>`);

  const lm = c.lineMode || 'normal';
  h.push(field('Состояние линии',
    `<select data-conn-prop="lineMode">
      <option value="normal"${lm === 'normal' ? ' selected' : ''}>Нормальная</option>
      <option value="damaged"${lm === 'damaged' ? ' selected' : ''}>Повреждена</option>
      <option value="disabled"${lm === 'disabled' ? ' selected' : ''}>Отключена</option>
    </select>`));

  // Режим разрыва (link mode) — линия скрывается, показываются ссылки на концах
  h.push(`<div class="field check"><input type="checkbox" id="cp-linkMode"${c.linkMode ? ' checked' : ''}><label>Скрыть линию (показать ссылками)</label></div>`);
  if (c.linkMode) {
    const previewOn = !!c._linkPreview;
    h.push(`<button type="button" id="cp-link-preview" class="full-btn" style="margin-bottom:8px">${previewOn ? '✓ Скрыть путь' : '👁 Показать путь (пунктир)'}</button>`);
  }

  if (c._state === 'active') {
    h.push('<div class="inspector-section"><h4>Нагрузка линии</h4>');
    const _par = Math.max(1, c._cableParallel || 1);
    const loadPerLine = (c._loadA || 0) / _par;
    const maxPerLine = (c._maxA || 0) / _par;
    const kwPerLine = (c._loadKw || 0) / _par;
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      (_par > 1 ? `Линий: <b>${_par}</b><br>` : '') +
      `Текущая P: <b>${fmt(kwPerLine)} kW</b><br>` +
      `Текущий I: <b>${fmt(loadPerLine)} A</b><br>` +
      `Расчётный I: <b>${fmt(maxPerLine)} A</b> <span class="muted">(по макс. нагрузке)</span><br>` +
      (c._cosPhi ? `cos φ: <b>${c._cosPhi.toFixed(2)}</b><br>` : '') +
      `Напряжение: <b>${c._voltage || '-'} В</b>` +
      (c._ikA && isFinite(c._ikA) ? `<br>Ik в точке: <b>${fmt(c._ikA / 1000)} кА</b>` : '') +
      `</div>`);
    // Блок ПРОВОДНИК — справочная информация
    {
      const hvBadge = c._isHV
        ? ` <span style="font-size:10px;background:#ef6c00;color:#fff;padding:1px 6px;border-radius:3px">ВН · ${escHtml(cableVoltageClass(c._voltage || 0))}</span>`
        : '';
      h.push(`<h4 style="margin:12px 0 6px;font-size:12px">Проводник${hvBadge}</h4>`);
    }
    if (c._cableSize || c._busbarNom || c._cableIz) {
      const par = Math.max(1, c._cableParallel || 1);
      const cores = c._wireCount || (c._threePhase ? 5 : 3);
      let cableSpec = '';
      if (c._busbarNom) {
        cableSpec = `Шинопровод: <b>${c._busbarNom} А</b>`;
      } else if (c._cableSize) {
        const spec = `${cores}×${c._cableSize} мм²`;
        cableSpec = par > 1 ? `Кабель: <b>${spec}</b> (${par} линии)` : `Кабель: <b>${spec}</b>`;
      }
      const effectiveBrkIn = c.manualBreakerIn || c._breakerIn || c._breakerPerLine || 0;
      const Iz = c._cableIz || 0;
      const IzTotal = Iz * par;
      // Координация по полному Iz при параллельных жилах, а не per-line
      const _pm = c.protectionMode || 'full';
      const inLeIz = (_pm === 'sc-only') || !effectiveBrkIn || !IzTotal || effectiveBrkIn <= IzTotal;
      const protOk = inLeIz;
      const oversize = IzTotal > 0 && effectiveBrkIn > 0 && IzTotal > effectiveBrkIn * 2;
      const bgColor = !protOk ? '#ffebee' : oversize ? '#fff8e1' : '#f5f5f5';
      const methodLabel = GLOBAL.calcMethod === 'pue' ? 'ПУЭ' : 'IEC 60364';
      h.push(`<div style="font-size:11px;line-height:1.6;margin-top:4px;padding:6px;background:${bgColor};border-radius:4px">` +
        (cableSpec ? cableSpec + '<br>' : '') +
        (effectiveBrkIn ? `Автомат: <b>${effectiveBrkIn} A</b><br>` : '') +
        (Iz ? `Iдоп на жилу (Iz): <b>${fmt(Iz)} A</b>${par > 1 ? ` · суммарно <b>${fmt(IzTotal)} А</b>` : ''}<br>` : '') +
        (!inLeIz ? '<span style="color:#c62828;font-weight:600">⚠ In > Iz — кабель не защищён автоматом!</span><br>' : '') +
        (oversize ? '<span style="color:#e65100">ℹ Кабель значительно завышен (Iz > 2×In)</span><br>' : '') +
        (c._breakerUndersize ? '<span style="color:#c62828;font-weight:600">⚠ Автомат меньше расчётного тока!</span><br>' : '') +
        (c._ecoSize ? `<span style="color:#0277bd">Экон. плотность: <b>${c._ecoSize} мм²</b> (j<sub>эк</sub>=${c._ecoJek})</span><br>` : '') +
        (c._cableKtotal ? `<span class="muted">K = ${c._cableKtotal.toFixed(3)} (Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span><br>` : '') +
        `<span class="muted">Методика: ${methodLabel}</span>` +
        `</div>`);

      // Справка: как подбирался кабель
      if (GLOBAL.showHelp !== false && c._cableSize) {
        const Iraw = c._maxA || 0;
        const IperNeeded = Iraw / par;
        h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
          <b>Как подбирался кабель:</b><br>
          1) Расчётный ток линии Iрасч = <b>${fmt(Iraw)} А</b><br>
          ${par > 1 ? `2) Параллельных жил — <b>${par}</b>, на жилу Iрасч/n = <b>${fmt(IperNeeded)} А</b><br>` : ''}
          ${_pm !== 'sc-only' && effectiveBrkIn ? `3) Координация с автоматом: Iz·n ≥ In, требуется Iz·n ≥ <b>${effectiveBrkIn} А</b><br>` : ''}
          4) Коэффициенты условий прокладки: Kt=${(c._cableKt||1).toFixed(2)}, Kg=${(c._cableKg||1).toFixed(2)}, K=${(c._cableKtotal||1).toFixed(3)}<br>
          5) Для ${methodLabel} выбрано ближайшее стандартное сечение <b>${c._cableSize} мм²</b>${par > 1 ? ` × ${par}` : ''}, дающее Iz=<b>${fmt(Iz)} А</b>${par > 1 ? ` (суммарно ${fmt(IzTotal)} А)` : ''}<br>
          Правило: Iрасч ≤ Iz·n${_pm !== 'sc-only' ? ' и In ≤ Iz·n' : ''}.
        </div>`);
      }
    }
    h.push('</div>');
  }

  // === Проводник линии ===
  const ct = c.cableType || GLOBAL.defaultCableType;
  const isBusbar = ct === 'busbar';

  h.push('<details class="inspector-section">');
  h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Подбор проводника</summary>');
  h.push(field('Тип проводника',
    `<select data-conn-prop="cableType">
      <option value="multi"${ct === 'multi' ? ' selected' : ''}>Многожильный</option>
      <option value="single"${ct === 'single' ? ' selected' : ''}>Одножильный многопроволочный</option>
      <option value="solid"${ct === 'solid' ? ' selected' : ''}>Цельная жила (класс 1–2, до 10 мм²)</option>
      <option value="busbar"${ct === 'busbar' ? ' selected' : ''}>Шинопровод</option>
    </select>`));
  h.push(field('Длина, м', `<input type="number" min="0" max="10000" step="0.5" data-conn-prop="lengthM" value="${c.lengthM ?? 1}">`));

  if (!isBusbar) {
    // Кабельные параметры — только для кабелей
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
    // Экономическая плотность тока — per-connection
    const ecoChecked = !!c.economicDensity;
    h.push(`<div class="field" style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-conn-prop="economicDensity" ${ecoChecked ? 'checked' : ''}> Расчёт по экон. плотности тока</label></div>`);
    if (ecoChecked) {
      const ecoHours = c.economicHours || 5000;
      h.push(field('Часы макс. нагрузки/год', `<select data-conn-prop="economicHours">
        <option value="3000"${ecoHours <= 3000 ? ' selected' : ''}>До 3000 ч</option>
        <option value="5000"${ecoHours > 3000 && ecoHours <= 5000 ? ' selected' : ''}>3000–5000 ч</option>
        <option value="8000"${ecoHours > 5000 ? ' selected' : ''}>Более 5000 ч</option>
      </select>`));
      if (c._ecoSize) {
        h.push(`<div style="background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;padding:6px;font-size:11px;margin-top:4px">j<sub>эк</sub> = ${c._ecoJek || '?'} А/мм², S<sub>эк</sub> = ${c._ecoSize} мм²</div>`);
      }
    }
  }
  // Секция сечения — ВНУТРИ details "Проводник"
  if ((c._cableSize || c._busbarNom || c._maxA > 0) && !isBusbar) {
    const manualCable = !!c.manualCableSize;
    // Для рекомендации при ручном кабеле — пересчитываем авто
    let autoSize, autoPar, autoIz;
    if (manualCable && c._maxA > 0) {
      const _m = getMethod(GLOBAL.calcMethod);
      const recSel = _m.selectCable(c._maxA || 0, {
        material: c.material || GLOBAL.defaultMaterial,
        insulation: c.insulation || GLOBAL.defaultInsulation,
        method: c._cableMethod || GLOBAL.defaultInstallMethod,
        ambient: c._cableAmbient || GLOBAL.defaultAmbient,
        grouping: c._cableGrouping || GLOBAL.defaultGrouping,
        bundling: c._cableBundling || 'touching',
        cableType: c.cableType || GLOBAL.defaultCableType,
        maxSize: GLOBAL.maxCableSize,
        parallel: c._cableParallel || 1,
      });
      autoSize = recSel.s;
      autoPar = recSel.parallel;
      autoIz = recSel.iDerated;
    } else {
      autoSize = c._cableSize;
      autoPar = c._cableParallel || 1;
      autoIz = c._cableIz || 0;
    }
    const SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
    const typeLabel = { multi: 'многожильный', single: 'одножильный многопр.', solid: 'цельная жила' }[c._cableType || 'multi'] || 'многожильный';
    const bundlingLabel = { spaced: 'с зазором', touching: 'плотно', bundled: 'в пучке' }[c._cableBundling || 'touching'] || 'плотно';

    h.push('<hr style="border:none;border-top:1px solid #e0e3ea;margin:10px 0">');
    // Toggle авто/ручной
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">');
    h.push('<span style="font-size:11px;font-weight:600">Сечение:</span>');
    h.push(`<span style="font-size:10px;color:${!manualCable ? '#4caf50' : '#999'}">авто</span>`);
    h.push(`<div data-cable-mode-toggle style="position:relative;width:36px;height:18px;border-radius:9px;background:${manualCable ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`);
    h.push(`<div style="position:absolute;top:2px;${manualCable ? 'right:2px' : 'left:2px'};width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></div>`);
    h.push('</div>');
    h.push(`<span style="font-size:10px;color:${manualCable ? '#e65100' : '#999'}">ручной</span>`);
    h.push('</div>');

    if (manualCable) {
      const mSize = c.manualCableSize || autoSize || 240;
      const mPar = c.manualCableParallel || autoPar || 1;
      let sizeOpts = '';
      for (const s of SECTIONS) sizeOpts += `<option value="${s}"${s === mSize ? ' selected' : ''}>${s} мм²</option>`;
      h.push('<div style="display:flex;gap:8px">');
      h.push('<div style="flex:1">' + field('Сечение', `<select data-conn-prop="manualCableSize">${sizeOpts}</select>`) + '</div>');
      h.push('<div style="flex:1">' + field('Параллельных', `<input type="number" data-conn-prop="manualCableParallel" min="1" max="20" step="1" value="${mPar}">`) + '</div>');
      h.push('</div>');
      // Подсказка с рекомендацией
      if (autoSize) {
        const recSpec = autoPar > 1 ? `${autoPar}×${autoSize} мм²` : `${autoSize} мм²`;
        h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;line-height:1.6">` +
          `Рекомендация: <b>${recSpec}</b><br>` +
          `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b>, ${typeLabel}<br>` +
          `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b>, t=${c._cableAmbient}°C, группа=${c._cableGrouping}<br>` +
          `Iдоп на жилу: <b>${fmt(autoIz)} A</b>` +
          (autoPar > 1 ? `<br>⚠ Авто-параллель: ${autoPar} линий (одиночная ${GLOBAL.maxCableSize} мм² не проходит)` : '') +
          (c._cableKtotal ? `<br><span style="color:#666">Kобщ = <b>${c._cableKtotal.toFixed(3)}</b></span>` +
            ` <span style="color:#999">(Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span>` : '') +
          `</div>`);
      }
      if (mSize < (autoSize || 0)) {
        h.push('<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ Сечение меньше рекомендуемого — перегруз</div>');
      } else if (autoSize && mSize > autoSize * 2) {
        h.push('<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:6px;font-size:11px;color:#2e7d32;margin-top:4px">ℹ Сечение избыточное</div>');
      }
    } else {
      // Авто — детальное описание подбора
      if (autoSize) {
        const warn = c._cableOverflow ? '<span style="color:#c62828"> ⚠ не проходит</span>' : '';
        h.push(`<div style="font-size:11px;line-height:1.8">` +
          `Сечение: <b>${autoPar > 1 ? autoPar + '×' : ''}${autoSize} мм²</b>${warn}<br>` +
          `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b><br>` +
          `Конструкция: <b>${typeLabel}</b><br>` +
          `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b><br>` +
          `t=${c._cableAmbient}°C, группа=${c._cableGrouping}, длина=${fmt(c._cableLength || 0)} м<br>` +
          `Iдоп на жилу: <b>${fmt(autoIz)} A</b>` +
          (autoPar > 1 ? `<br>Параллельных линий: <b>${autoPar}</b> · Iдоп всего: <b>${fmt(c._cableTotalIz || 0)} A</b>` : '') +
          (c._cableKtotal ? `<br><span style="color:#666">Kобщ = <b>${c._cableKtotal.toFixed(3)}</b></span>` +
            ` <span style="color:#999">(Kt=${(c._cableKt||1).toFixed(2)} × Kg=${(c._cableKg||1).toFixed(2)})</span>` : '') +
          `</div>`);
        if (c._cableAutoParallel && autoPar > 1) {
          h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:4px;line-height:1.6">` +
            `⚠ Авто-параллель: одиночная жила ${GLOBAL.maxCableSize} мм² не проходит → <b>${autoPar} параллельных ${autoSize} мм²</b><br>` +
            `<span class="muted">• Кабели одной фазы — одинаковой длины и сечения<br>` +
            `• Разносить не более 1 Ø или с зазором ≥ Ø<br>` +
            `• На каждую линию — свой автомат</span></div>`);
        }
      }
    }
  } else if (isBusbar && c._busbarNom) {
    const warn = c._cableOverflow ? ' ⚠ превышен макс.' : '';
    h.push(`<hr style="border:none;border-top:1px solid #e0e3ea;margin:10px 0">`);
    h.push(`<div style="font-size:11px;line-height:1.8">` +
      `Шинопровод: <b>${c._busbarNom} А</b>${warn} · Imax: <b>${fmt(c._maxA || 0)} A</b></div>`);
  }
  h.push('</details>');

  if (!isBusbar) {
    // === Условия прокладки — единый блок (идентичный каналу) ===
    const curMethod = c._cableMethod || c.installMethod || GLOBAL.defaultInstallMethod;
    const curBundling = c._cableBundling || c.bundling || 'touching';
    const curAmbient = c._cableAmbient || c.ambientC || GLOBAL.defaultAmbient;
    const curGrouping = c._cableGrouping || c.grouping || GLOBAL.defaultGrouping;
    h.push(buildInstallConditionsBlock(
      c.installMethod || GLOBAL.defaultInstallMethod,
      c.bundling || 'touching',
      c.ambientC || GLOBAL.defaultAmbient,
      c.grouping || GLOBAL.defaultGrouping,
      curGrouping,
      c.insulation || GLOBAL.defaultInsulation,
      'data-conn-prop'
    ));
  }

  // Кабельные каналы — после условий прокладки
  const channels = [...state.nodes.values()].filter(nn => nn.type === 'channel');
  if (channels.length) {
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    const chCount = chainIds.length;
    h.push(`<details class="inspector-section"${chCount ? ' open' : ''}>`);
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Кабельные каналы (${chCount})</summary>`);
    h.push('<div class="muted" style="font-size:10px;margin:4px 0 6px">Отметьте каналы, через которые проходит линия.</div>');
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')}</label></div>`);
    }
    h.push('</details>');
  }

  // Автомат защиты — для всех линий (не только активных)
  {
    // Используем единый справочник из constants.js
    const autoIn = c._breakerIn || c._breakerPerLine || 0;
    const manualBreaker = !!c.manualBreakerIn;
    const effectiveIn = manualBreaker ? (c.manualBreakerIn || autoIn) : autoIn;
    const cnt = c._breakerCount || 1;

    h.push('<div class="inspector-section">');
    // Toggle авто/ручной
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">');
    h.push('<h4 style="margin:0;font-size:12px">Защитный аппарат</h4>');
    h.push(`<span style="font-size:10px;color:${!manualBreaker ? '#4caf50' : '#999'}">авто</span>`);
    h.push(`<div data-breaker-mode-toggle style="position:relative;width:36px;height:18px;border-radius:9px;background:${manualBreaker ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`);
    h.push(`<div style="position:absolute;top:2px;${manualBreaker ? 'right:2px' : 'left:2px'};width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></div>`);
    h.push('</div>');
    h.push(`<span style="font-size:10px;color:${manualBreaker ? '#e65100' : '#999'}">ручной</span>`);
    h.push('</div>');

    // Режим защиты для ЭТОЙ линии: полная (КЗ + перегрузка) или только КЗ.
    // В режиме 'sc-only' авто-подбор кабеля не принуждает In ≤ Iz и не выдаёт
    // warning при превышении — применяется когда перегрузка защищается upstream.
    const _pm = c.protectionMode || 'full';
    h.push(field('Режим защиты', `
      <select data-conn-prop="protectionMode">
        <option value="full"${_pm === 'full' ? ' selected' : ''}>КЗ и перегрузка</option>
        <option value="sc-only"${_pm === 'sc-only' ? ' selected' : ''}>Только КЗ</option>
      </select>`));

    // Эффективный Iz для координации (учитываем параллельные жилы)
    const _parBrk = Math.max(1, c._cableParallel || 1);
    const _IzTotal = (c._cableIz || 0) * _parBrk;
    const _Imax = c._maxA || 0;
    const _IperLine = _Imax / _parBrk;
    const _pmFlag = c.protectionMode || 'full';
    const _showHelp = GLOBAL.showHelp !== false;
    // Минимальный запас автомата (%) из глобальных настроек
    const _minMarginPct = Math.max(0, Number(GLOBAL.breakerMinMarginPct) || 0);
    // Запасы:
    //  - по автомату: (In - Iрасч) / Iрасч · 100
    //  - по кабелю:   (Iz_total - Iрасч) / Iрасч · 100
    const _brkMarginPct = (_Imax > 0 && effectiveIn > 0)
      ? ((effectiveIn - _Imax) / _Imax) * 100
      : null;
    const _cableMarginPct = (_Imax > 0 && _IzTotal > 0)
      ? ((_IzTotal - _Imax) / _Imax) * 100
      : null;
    const _fmtPct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
    const _marginColor = (v) => {
      if (v == null) return '#999';
      if (v < 0) return '#c62828';
      if (v < _minMarginPct) return '#e65100';
      return '#2e7d32';
    };

    // Блок запасов (и для auto, и для manual)
    const marginBlock = () => `
      <div style="display:flex;gap:12px;font-size:11px;margin-top:4px;padding:4px 0;border-top:1px dashed #e0e3ea">
        <div>Запас по автомату:
          <b style="color:${_marginColor(_brkMarginPct)}">${_fmtPct(_brkMarginPct)}</b></div>
        <div>Запас по кабелю:
          <b style="color:${_marginColor(_cableMarginPct)}">${_fmtPct(_cableMarginPct)}</b></div>
      </div>`;

    if (manualBreaker) {
      let brkOpts = '';
      for (const nom of BREAKER_SERIES) {
        brkOpts += `<option value="${nom}"${nom === (c.manualBreakerIn || autoIn) ? ' selected' : ''}>${nom} А</option>`;
      }
      h.push(field('Номинал автомата', `<select data-conn-prop="manualBreakerIn">${brkOpts}</select>`));
      h.push(marginBlock());
      // Warning если запас по автомату меньше заданного минимума
      if (_brkMarginPct != null && _brkMarginPct >= 0 && _brkMarginPct < _minMarginPct) {
        h.push(`<div style="background:#fff3e0;border:1px solid #ffb74d;border-radius:4px;padding:6px;font-size:11px;color:#e65100;margin-top:4px">⚠ Запас по автомату ${_brkMarginPct.toFixed(1)}% меньше минимального ${_minMarginPct}%. Повысьте номинал.</div>`);
      }
      if (autoIn) {
        h.push(`<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:4px;padding:6px;font-size:11px;margin-top:4px">Рекомендация (авто): <b>${autoIn} А</b>${_minMarginPct > 0 ? ` <span class="muted">(с запасом ≥${_minMarginPct}%)</span>` : ''}</div>`);
        if (_showHelp) {
          const parText = _parBrk > 1 ? ` × ${_parBrk} ветви = ${fmt(_IzTotal)} А суммарно` : '';
          h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:4px;color:#1565c0;line-height:1.5">
            <b>Как получено:</b><br>
            Iрасч линии = <b>${fmt(_Imax)} А</b>${_parBrk > 1 ? ` (на жилу ${fmt(_IperLine)} А)` : ''}<br>
            Iz кабеля = <b>${fmt(c._cableIz || 0)} А</b>${parText}<br>
            Правило: Iрасч ≤ In ≤ Iz. Выбран ближайший стандартный номинал из ряда.
            ${_pmFlag === 'sc-only' ? '<br>Режим: <b>Только КЗ</b> — координация с Iz не требуется.' : ''}
          </div>`);
        }
      }
      // Warning 1: автомат > Iz (кабель не защищён от перегрузки) — только при full
      if (_pmFlag !== 'sc-only' && _IzTotal > 0 && effectiveIn > _IzTotal) {
        h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${effectiveIn} А) > Iz (${fmt(_IzTotal)} А${_parBrk > 1 ? ' суммарно' : ''}) — кабель не защищён от перегрузки! Увеличьте сечение или режим «Только КЗ».</div>`);
      }
      // Warning 2: автомат < Iрасч (сработает при нормальной нагрузке, нагрузка будет отключена)
      if (_Imax > 0 && effectiveIn > 0 && effectiveIn < _Imax * 0.95) {
        h.push(`<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:6px;font-size:11px;color:#c62828;margin-top:4px">⚠ In (${effectiveIn} А) &lt; Iрасч (${fmt(_Imax)} А) — автомат будет срабатывать при штатной нагрузке! Нагрузка будет отключена.</div>`);
      }
    } else {
      const badge = c._breakerAgainstCable
        ? '<span class="badge off">нарушена</span>'
        : (effectiveIn ? '<span class="badge on">ок</span>' : '');
      h.push(`<div style="font-size:12px;line-height:1.8">` +
        (effectiveIn ? `Номинал: <b>${effectiveIn} А</b> ${badge}<br>` : 'Не определён<br>') +
        (cnt > 1 ? `В шкафу: <b>${cnt} × ${effectiveIn} А</b> <span class="muted">(по одному на параллельную линию)</span><br>` : '') +
        (c._breakerAgainstCable ? `<span style="color:#c62828;font-size:11px">In > Iz (${fmt(_IzTotal)} А${_parBrk > 1 ? ' суммарно' : ''}) — увеличьте сечение</span>` : '') +
        `</div>`);
      // Запасы по автомату и кабелю
      if (effectiveIn) h.push(marginBlock());
      if (_showHelp && effectiveIn) {
        const parText = _parBrk > 1 ? ` × ${_parBrk} ветви = ${fmt(_IzTotal)} А суммарно` : '';
        h.push(`<div style="background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;padding:6px;font-size:11px;margin-top:6px;color:#1565c0;line-height:1.5">
          <b>Как получено:</b><br>
          Iрасч линии = <b>${fmt(_Imax)} А</b>${_parBrk > 1 ? ` (на жилу ${fmt(_IperLine)} А)` : ''}<br>
          Iz кабеля = <b>${fmt(c._cableIz || 0)} А</b>${parText}<br>
          Правило: Iрасч ≤ In ≤ Iz. Номинал <b>${effectiveIn} А</b> — ближайший стандартный из ряда, удовлетворяющий условию.
          ${_pmFlag === 'sc-only' ? '<br>Режим: <b>Только КЗ</b> — условие In ≤ Iz не принуждается.' : ''}
        </div>`);
      }
    }
    h.push('</div>');
  }

  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Рукоятки на концах — переключить связь на другой порт. «+» в середине сегмента — добавить точку сплайна. Shift+клик по точке — удалить. Shift+клик по линии — удалить связь.</div>');
  // Кнопка сброса точек сплайна — только если точки есть
  if (Array.isArray(c.waypoints) && c.waypoints.length) {
    h.push(`<button class="full-btn" id="btn-reset-waypoints" style="margin-top:8px">↺ Сбросить траекторию (${c.waypoints.length} точ.)</button>`);
  }
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка на поля связи
  inspectorBody.querySelectorAll('[data-conn-prop]').forEach(inp => {
    inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
      snapshot('conn:' + c.id + ':' + inp.dataset.connProp);
      const prop = inp.dataset.connProp;
      let v = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
      // Числовые свойства из select: manualBreakerIn, manualCableSize, manualCableParallel, grouping
      if (['manualBreakerIn', 'manualCableSize', 'manualCableParallel', 'grouping', 'ambientC', 'lengthM', 'economicHours'].includes(prop)) {
        v = Number(v) || 0;
      }
      c[prop] = v;
      _render();
      notifyChange();
      // Обновить иконки при смене метода/расположения
      // Перерисовать инспектор при любом изменении расчётных параметров
      renderInspector();
    });
  });
  // Режим разрыва (link mode)
  {
    const lmCb = document.getElementById('cp-linkMode');
    if (lmCb) {
      lmCb.addEventListener('change', () => {
        snapshot('conn-linkMode:' + c.id);
        c.linkMode = lmCb.checked;
        if (!c.linkMode) c._linkPreview = false;
        _render(); notifyChange(); renderInspector();
      });
    }
    const lpBtn = document.getElementById('cp-link-preview');
    if (lpBtn) {
      lpBtn.addEventListener('click', () => {
        c._linkPreview = !c._linkPreview;
        _render(); renderInspector();
      });
    }
  }
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
      _render();
      renderInspector();
      notifyChange();
    });
  });
  // Toggle авто/ручной подбор кабеля
  const cableModeToggle = inspectorBody.querySelector('[data-cable-mode-toggle]');
  if (cableModeToggle) {
    cableModeToggle.addEventListener('click', () => {
      snapshot('cable-mode:' + c.id);
      if (c.manualCableSize) {
        // Переключаем на авто
        delete c.manualCableSize;
        delete c.manualCableParallel;
      } else {
        // Переключаем на ручной — копируем текущий авто-подбор
        c.manualCableSize = c._cableSize || 240;
        c.manualCableParallel = c._cableParallel || 1;
      }
      _render(); renderInspector(); notifyChange();
    });
  }

  // Toggle авто/ручной автомат
  const breakerModeToggle = inspectorBody.querySelector('[data-breaker-mode-toggle]');
  if (breakerModeToggle) {
    breakerModeToggle.addEventListener('click', () => {
      snapshot('breaker-mode:' + c.id);
      if (c.manualBreakerIn) {
        delete c.manualBreakerIn;
      } else {
        c.manualBreakerIn = c._breakerIn || 100;
      }
      _render(); renderInspector(); notifyChange();
    });
  }

  document.getElementById('btn-del-conn').onclick = () => _deleteConn(c.id);
  const resetBtn = document.getElementById('btn-reset-waypoints');
  if (resetBtn) resetBtn.onclick = () => {
    snapshot('wp-reset:' + c.id);
    c.waypoints = [];
    _render();
    renderInspector();
    notifyChange();
    flash('Траектория сброшена');
  };
}

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
export { openUpsParamsModal, openUpsControlModal, upsStatusBlock };
export { openConsumerParamsModal };
export { openImpedanceModal, openAutomationModal, sourceStatusBlock, voltageLevelOptions };
export { openPanelParamsModal, openPanelControlModal, panelStatusBlock };
