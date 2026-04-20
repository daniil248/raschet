import { state, svg, inspectorBody, uid, pagesForNode } from './state.js';
import { GLOBAL, DEFAULTS, CHANNEL_TYPES, CABLE_TYPES, NODE_H, LINE_COLORS, CONSUMER_CATALOG, TRANSFORMER_CATALOG, INSTALL_METHODS, BREAKER_SERIES, BREAKER_TYPES, ZONE_PASTEL_PALETTE } from './constants.js';
import { escHtml, escAttr, fmt, field, checkField, flash } from './utils.js';
import { nodeVoltage, isThreePhase, computeCurrentA, nodeWireCount, cableVoltageClass, formatVoltageLevelLabel } from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth } from './geometry.js';
import { effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor } from './modes.js';
import { snapshot, notifyChange } from './history.js';
import { clampPortsInvolvingNode, nextFreeTag } from './graph.js';
import { panelCosPhi, downstreamPQ } from './recalc.js';
import { effectiveTag, findZoneForMember, nodesInZone, maxOccupiedPort, copyZoneWithMembers } from './zones.js';
import { kTempLookup, kGroupLookup, kBundlingFactor, selectCableSize } from './cable.js';
import { getMethod } from '../methods/index.js';
import { listTransformers } from '../../shared/transformer-catalog.js';
import { mountTransformerPicker, applyTransformerModel } from '../../shared/transformer-picker.js';

// Внешние зависимости, устанавливаемые через bindInspectorDeps
import {
  bindInspectorUpsDeps,
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
  openImpedanceModal,
  openAutomationModal,
  sourceStatusBlock,
  voltageLevelOptions,
} from './inspector/source.js';
import {
  bindInspectorPanelDeps,
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
    h.push(`<div class="inspector-section" style="padding:6px 0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:12px;color:#666">Группа резерва:</span>
        <input type="text" id="src-redundancy-group" value="${n.redundancyGroup ? String(n.redundancyGroup).replace(/"/g, '&quot;') : ''}" placeholder="напр. T, DGU" style="flex:1;padding:2px 6px;font-size:12px;border:1px solid #ccc;border-radius:3px" title="Участники одной группы взаимно резервируют друг друга (N-1)">
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:6px">
        <input type="checkbox" id="src-is-backup"${n.isBackup ? ' checked' : ''} style="margin:0">
        <span>Резервный тир (backup)</span>
      </label>
      <div class="muted" style="font-size:10px;margin-top:2px;line-height:1.4">
        Не участвует в нормальной работе. Например, ДГУ при отказе городской сети.
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:6px">
        <input type="checkbox" id="src-is-standby"${n.isStandby ? ' checked' : ''} style="margin:0">
        <span>Подменный (cold standby)</span>
      </label>
      <div class="muted" style="font-size:10px;margin-top:2px;line-height:1.4">
        Подменяет любой отказавший источник своего тира. Пример: +1 ДГУ к двум рабочим.
      </div>
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

    h.push(`<button type="button" class="full-btn" id="btn-balance-panel" style="margin-top:8px">⚖ Балансировка фаз на щите</button>`);
    h.push(panelStatusBlock(n));
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
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId' || prop === 'sourceSubtype' || prop === 'channelType' || prop === 'bundling' || prop === 'installMethod' || prop === 'trayMode' || prop === 'auxInput') {
        renderInspector();
      }
    };
    // Фикс фокуса: для всех полей используем только 'change' (срабатывает на
    // blur / Enter), без 'input' — иначе каждый символ перерисовывает DOM и
    // сбрасывает фокус/каретку в text/number input'ах.
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
