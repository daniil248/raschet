import { state, svg, inspectorBody, uid } from './state.js';
import { GLOBAL, DEFAULTS, CHANNEL_TYPES, CABLE_TYPES, NODE_H, LINE_COLORS, CONSUMER_CATALOG, TRANSFORMER_CATALOG, INSTALL_METHODS, BREAKER_SERIES, BREAKER_TYPES } from './constants.js';
import { escHtml, escAttr, fmt, field, checkField, flash } from './utils.js';
import { nodeVoltage, isThreePhase, computeCurrentA, upsChargeKw, sourceImpedance, nodeWireCount } from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth } from './geometry.js';
import { effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor } from './modes.js';
import { snapshot, notifyChange } from './history.js';
import { clampPortsInvolvingNode, nextFreeTag } from './graph.js';
import { panelCosPhi, downstreamPQ } from './recalc.js';
import { effectiveTag, findZoneForMember, nodesInZone, maxOccupiedPort } from './zones.js';
import { kTempLookup, kGroupLookup, kBundlingFactor, selectCableSize } from './cable.js';
import { getMethod } from '../methods/index.js';

// Внешние зависимости, устанавливаемые через bindInspectorDeps
let _render, _deleteNode, _deleteConn, _isTagUnique;
export function bindInspectorDeps({ render, deleteNode, deleteConn, isTagUnique }) {
  _render = render;
  _deleteNode = deleteNode;
  _deleteConn = deleteConn;
  _isTagUnique = isTagUnique;
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
    inspectorBody.innerHTML = '<div class="muted">Выберите элемент или связь, либо перетащите новый элемент из палитры.</div>';
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
        <option value="other"${subtype === 'other' ? ' selected' : ''}>Прочий (гор. сеть, ВРУ)</option>
      </select>`));
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
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px;line-height:1.6">` +
      `Snom: <b>${fmt(n.snomKva || 0)} kVA</b> (${fmt(n.capacityKw || 0)} kW)<br>` +
      voltInfo +
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
  if (Array.isArray(state.pages) && state.pages.length > 1) {
    const curPids = Array.isArray(n.pageIds) ? n.pageIds : (state.currentPageId ? [state.currentPageId] : []);
    h.push('<div class="inspector-section"><h4>Страницы</h4>');
    h.push('<div style="font-size:11px;color:#546e7a;margin-bottom:4px">Отметьте страницы, на которых виден этот узел.</div>');
    for (const p of state.pages) {
      const checked = curPids.includes(p.id);
      h.push(`<div class="field check"><input type="checkbox" data-page-id="${escAttr(p.id)}"${checked ? ' checked' : ''}><label>${escHtml(p.name || p.id)} <span class="muted" style="font-size:10px">(${p.type === 'linked' ? 'ссыл.' : 'нез.'})</span></label></div>`);
    }
    h.push('</div>');
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
  // Регистрируем в общем каталоге пресетов, если Presets уже загружен
  if (window.Presets && window.Presets.all) {
    window.Presets.all.push(list[list.length - 1]);
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

// ================= Модалка «Параметры источника» (IEC 60909) =================

// Генерация <option> для уровней напряжения с фильтрацией
function voltageLevelOptions(selectedIdx, filter) {
  const levels = GLOBAL.voltageLevels || [];
  let opts = '';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    // Фильтр: '3ph' — только 3-фазные, '1ph' — однофазные, 'dc' — DC (wires===2), null — все
    if (filter === '3ph' && lv.phases !== 3) continue;
    if (filter === '1ph' && (lv.phases !== 1 || lv.wires === 2)) continue;
    if (filter === 'dc' && lv.wires !== 2) continue;
    opts += `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escHtml(lv.label)} (${lv.vLL}V)</option>`;
  }
  return opts;
}

export function openImpedanceModal(n) {
  const body = document.getElementById('impedance-body');
  if (!body) return;
  const h = [];
  const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
  const isTransformer = subtype === 'transformer';
  const isOther = subtype === 'other';
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="imp-name" value="${escAttr(n.name || '')}">`));
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Номинальные параметры источника и данные для расчёта тока КЗ по IEC 60909.</div>');

  // === Номинальные параметры ===
  h.push('<h4 style="margin:16px 0 8px">Номинальные параметры</h4>');

  if (isTransformer) {
    // Трансформатор: выбор из типового ряда
    let tOpts = '<option value="">— выберите —</option>';
    for (const t of TRANSFORMER_CATALOG) {
      const sel = t.snomKva === n.snomKva ? ' selected' : '';
      tOpts += `<option value="${t.snomKva}"${sel}>${t.label}</option>`;
    }
    h.push(field('Типовой номинал (ГОСТ 11677)', `<select id="imp-tCatalog">${tOpts}</select>`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-4px">При выборе заполняются Uk, Pk, P0 по ГОСТ. Поле Snom остаётся ручным для редактирования.</div>`);
    h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  } else {
    h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  }

  // Выходное напряжение (вторичная обмотка для трансформатора)
  const outIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  h.push(field(isTransformer ? 'Выходное напряжение (вторичная обмотка)' : 'Выходное напряжение',
    `<select id="imp-voltage-out">${voltageLevelOptions(outIdx, null)}</select>`));

  // Входное напряжение (первичная обмотка) — только для трансформатора.
  // Для "other" (городская сеть / ВРУ) скрыто — внешний источник описывается
  // только параметрами КЗ на стороне нашего напряжения.
  if (isTransformer) {
    const inIdx = (typeof n.inputVoltageLevelIdx === 'number') ? n.inputVoltageLevelIdx : (() => {
      const levels = GLOBAL.voltageLevels || [];
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].vLL >= 6000) return i;
      }
      return 0;
    })();
    h.push(field('Входное напряжение (первичная обмотка)',
      `<select id="imp-voltage-in">${voltageLevelOptions(inIdx, null)}</select>`));
  }

  // Параметры КЗ
  h.push('<h4 style="margin:16px 0 8px">Параметры короткого замыкания</h4>');
  if (isOther) {
    // Для "прочего" источника достаточно ввода одного параметра — тока КЗ
    // на шинах в точке подключения (или Ssc сети). Всё остальное неактуально.
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Для стороннего источника (городская сеть, ВРУ) задайте либо ток трёхфазного КЗ в точке подключения, либо мощность КЗ питающей сети.</div>');
    h.push(field('Ток трёхфазного КЗ Ik, кА', `<input type="number" id="imp-ikka" min="0" max="200" step="0.1" value="${n.ikKA ?? 10}">`));
    h.push(field('ИЛИ Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="0" max="10000" step="1" value="${n.sscMva ?? 0}">`));
    h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));
  } else {
    h.push(field('Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="1" max="10000" step="1" value="${n.sscMva ?? 500}">`));
    if (isTransformer) {
      h.push(field('Напряжение КЗ трансформатора (Uk), %', `<input type="number" id="imp-uk" min="0" max="25" step="0.5" value="${n.ukPct ?? 6}">`));
    } else {
      h.push(field('Xd\'\' (сверхпереходное), о.е.', `<input type="number" id="imp-xdpp" min="0.01" max="1" step="0.01" value="${n.xdpp ?? 0.15}">`));
    }
    h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));
  }

  // Потери трансформатора (только для трансформатора)
  if (isTransformer) {
    h.push('<h4 style="margin:16px 0 8px">Потери трансформатора</h4>');
    h.push(field('Потери КЗ (Pk), кВт', `<input type="number" id="imp-pk" min="0" max="100" step="0.1" value="${n.pkW ?? 6}">`));
    h.push(field('Потери ХХ (P0), кВт', `<input type="number" id="imp-p0" min="0" max="50" step="0.1" value="${n.p0W ?? 1.5}">`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Pk — потери короткого замыкания (нагрев обмоток при номинальном токе).<br>P0 — потери холостого хода (нагрев магнитопровода).</div>');
  }

  // Собственные нужды (только для генератора с auxInput)
  if (!isTransformer && n.auxInput) {
    h.push('<h4 style="margin:16px 0 8px">Собственные нужды</h4>');
    h.push(field('Мощность СН, kW', `<input type="number" id="imp-auxKw" min="0" max="1000" step="0.1" value="${n.auxDemandKw || 0}">`));
    h.push(field('cos φ СН', `<input type="number" id="imp-auxCos" min="0.1" max="1" step="0.01" value="${n.auxCosPhi || 0.85}">`));
    h.push(`<div class="field check"><input type="checkbox" id="imp-auxBrk"${n.auxBreakerOn !== false ? ' checked' : ''}><label>Автомат СН включён</label></div>`);
  }

  // Вычисленные значения (справка)
  const U = nodeVoltage(n);
  const Zs = sourceImpedance(n);
  const IkMax = Zs > 0 ? (1.1 * U) / (Math.sqrt(3) * Zs) : Infinity;
  const Pkw = (n.snomKva || 0) * (Number(n.cosPhi) || 0.92);
  h.push(`<div class="inspector-section"><div style="font-size:12px;line-height:1.8">` +
    `Активная мощность (P = Snom × cos φ): <b>${fmt(Pkw)} kW</b><br>` +
    `Zs (полное сопротивление): <b>${(Zs * 1000).toFixed(2)} мОм</b><br>` +
    (isFinite(IkMax) ? `Ik max (c=1.1): <b>${fmt(IkMax / 1000)} кА</b> при ${U} В` : 'Ik: ∞ (Zs = 0)') +
    `</div></div>`);

  body.innerHTML = h.join('');

  // Handler для типового каталога трансформаторов — автозаполнение полей
  const tCatEl = document.getElementById('imp-tCatalog');
  if (tCatEl) {
    tCatEl.addEventListener('change', () => {
      const val = Number(tCatEl.value);
      if (!val) return;
      const t = TRANSFORMER_CATALOG.find(x => x.snomKva === val);
      if (!t) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      set('imp-snom', t.snomKva);
      set('imp-uk', t.ukPct);
      set('imp-pk', t.pkW);
      set('imp-p0', t.p0W);
      set('imp-xsrs', t.xsRsRatio);
    });
  }

  const applyBtn = document.getElementById('impedance-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('impedance:' + n.id);
    const impName = document.getElementById('imp-name')?.value?.trim();
    if (impName) n.name = impName;
    n.snomKva = Number(document.getElementById('imp-snom')?.value) || 400;

    // Выходное напряжение из справочника
    const outLevelIdx = Number(document.getElementById('imp-voltage-out')?.value) || 0;
    const levels = GLOBAL.voltageLevels || [];
    n.voltageLevelIdx = outLevelIdx;
    if (levels[outLevelIdx]) {
      n.voltage = levels[outLevelIdx].vLL;
      n.phase = levels[outLevelIdx].phases === 3 ? '3ph' : '1ph';
    }

    // Входное напряжение (только для трансформатора)
    if (isTransformer) {
      const inEl = document.getElementById('imp-voltage-in');
      if (inEl) n.inputVoltageLevelIdx = Number(inEl.value) || 0;
    }

    // capacityKw = Snom × cos φ
    n.capacityKw = n.snomKva * (Number(n.cosPhi) || 0.92);
    if (isOther) {
      // Прочий источник: сохраняем Ik и/или Ssc; Uk/Xd'' не используются.
      n.ikKA = Number(document.getElementById('imp-ikka')?.value) || 0;
      n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 0;
      delete n.ukPct;
      delete n.xdpp;
      delete n.pkW;
      delete n.p0W;
      delete n.inputVoltageLevelIdx;
    } else {
      n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 500;
      if (isTransformer) {
        n.ukPct = Number(document.getElementById('imp-uk')?.value) || 0;
      } else {
        n.xdpp = Number(document.getElementById('imp-xdpp')?.value) || 0.15;
      }
    }
    n.xsRsRatio = Number(document.getElementById('imp-xsrs')?.value) || 10;
    if (isTransformer) {
      n.pkW = Number(document.getElementById('imp-pk')?.value) || 0;
      n.p0W = Number(document.getElementById('imp-p0')?.value) || 0;
    }
    // Собственные нужды
    if (!isTransformer && n.auxInput) {
      n.auxDemandKw = Number(document.getElementById('imp-auxKw')?.value) || 0;
      n.auxCosPhi = Number(document.getElementById('imp-auxCos')?.value) || 0.85;
      n.auxBreakerOn = document.getElementById('imp-auxBrk')?.checked !== false;
    }
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-impedance').classList.add('hidden');
      return;
    }
    document.getElementById('modal-impedance').classList.add('hidden');
    _render();
    renderInspector();
    notifyChange();
    flash('Параметры источника обновлены');
  };

  document.getElementById('modal-impedance').classList.remove('hidden');
}

// ================= Модалка «Автоматизация» =================
export function openAutomationModal(n) {
  const body = document.getElementById('automation-body');
  if (!body) return;
  const h = [];

  h.push(`<h3>Автоматизация ${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Задайте условия запуска генератора. Каждый сценарий: при потере напряжения на указанных вводах → запуск ДГУ и (опционально) коммутация выходов щита. Для простого резервного ДГУ достаточно одного сценария без выходов.</div>');

  // Мигрируем legacy triggerNodeIds в triggerGroups если нужно
  let groups = Array.isArray(n.triggerGroups) && n.triggerGroups.length
    ? n.triggerGroups
    : [];
  if (!groups.length) {
    const legacyIds = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : []);
    if (legacyIds.length) {
      groups = [{ name: 'Резерв', watchInputs: legacyIds.map(id => ({ nodeId: id })), logic: n.triggerLogic || 'any', activateOutputs: [] }];
    }
  }

  // Собираем все щиты с входами, сортируем по полному обозначению
  const panels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.inputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru'));

  // Щит коммутации (опционально — для подменных ДГУ)
  const switchPanels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.outputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru'));

  let switchPanelId = n.switchPanelId || null;
  if (!switchPanelId) {
    for (const c of state.conns.values()) {
      if (c.from.nodeId === n.id) {
        const to = state.nodes.get(c.to.nodeId);
        if (to && to.type === 'panel') { switchPanelId = to.id; break; }
      }
    }
  }

  let switchOpts = '<option value="">— нет (простой резервный)</option>';
  for (const sp of switchPanels) {
    const sel = sp.id === switchPanelId ? ' selected' : '';
    switchOpts += `<option value="${escAttr(sp.id)}"${sel}>${escHtml(effectiveTag(sp))} — ${escHtml(sp.name || '')} (${sp.outputs} вых.)</option>`;
  }
  h.push(field('Щит коммутации (опционально)', `<select id="auto-switch-panel">${switchOpts}</select>`));
  h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Для подменного ДГУ — выберите щит, автоматы которого будут коммутироваться. Для простого резервного — оставьте «нет».</div>');

  const downstreamPanel = switchPanelId ? state.nodes.get(switchPanelId) : null;

  // Рендер каждой группы (groups уже определена выше)
  for (let gi = 0; gi < Math.max(groups.length, 1); gi++) {
    const grp = groups[gi] || { name: '', watchInputs: [], logic: 'any', activateOutputs: [] };
    const grpName = grp.name || `Сценарий ${gi + 1}`;
    h.push(`<details class="inspector-section" style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:10px" data-grp-idx="${gi}"${gi === 0 ? ' open' : ''}>`);
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px"><span style="flex:1">${escHtml(grpName)}</span>`);
    if (groups.length > 1) {
      h.push(`<button type="button" data-grp-delete="${gi}" style="font-size:14px;color:#c62828;background:none;border:none;cursor:pointer;padding:2px" title="Удалить">×</button>`);
    }
    h.push('</summary>');
    h.push(`<div style="margin-top:8px">`);
    h.push(field('Имя', `<input type="text" data-grp-name="${gi}" value="${escAttr(grp.name || '')}" placeholder="Сценарий ${gi+1}">`));

    // Условия: выбор ввода щита (отсортированные)
    h.push('<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Условие запуска (ввод щита без питания):</div>');
    const watches = Array.isArray(grp.watchInputs) ? grp.watchInputs : [];

    // Собираем и сортируем все вводы
    const allInputs = [];
    for (const p of panels) {
      for (let port = 0; port < p.inputs; port++) {
        let feederTag = '—';
        for (const c of state.conns.values()) {
          if (c.to.nodeId === p.id && c.to.port === port) {
            const from = state.nodes.get(c.from.nodeId);
            feederTag = from ? (effectiveTag(from) || from.name || '?') : '?';
            break;
          }
        }
        const panelTag = effectiveTag(p) || p.tag || '';
        allInputs.push({ panelId: p.id, port, panelTag, feederTag });
      }
    }
    // Сортировка: сначала по щиту, потом по номеру порта
    allInputs.sort((a, b) => a.panelTag.localeCompare(b.panelTag, 'ru') || a.port - b.port);

    for (const inp of allInputs) {
      const isChecked = watches.some(w => w.panelId === inp.panelId && w.inputPort === inp.port);
      const label = `${escHtml(inp.panelTag)} вход ${inp.port + 1} (от ${escHtml(inp.feederTag)})`;
      h.push(`<div class="field check" style="font-size:11px"><input type="checkbox" data-grp-watch="${gi}" data-panel="${escAttr(inp.panelId)}" data-port="${inp.port}"${isChecked ? ' checked' : ''}><label>${label}</label></div>`);
    }

    const gLogic = grp.logic || 'any';
    h.push(`<select data-grp-logic="${gi}" style="font-size:11px;margin:4px 0">
      <option value="any"${gLogic === 'any' ? ' selected' : ''}>ANY — хотя бы один мёртв</option>
      <option value="all"${gLogic === 'all' ? ' selected' : ''}>ALL — все мертвы</option>
    </select>`);

    // Выходы коммутационного щита (отсортированные по номеру)
    if (downstreamPanel) {
      h.push(`<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Включить выходы ${escHtml(effectiveTag(downstreamPanel))}:</div>`);
      const activeOuts = new Set(Array.isArray(grp.activateOutputs) ? grp.activateOutputs : []);
      for (let oi = 0; oi < (downstreamPanel.outputs || 0); oi++) {
        let destTag = '—';
        for (const c of state.conns.values()) {
          if (c.from.nodeId === downstreamPanel.id && c.from.port === oi) {
            const to = state.nodes.get(c.to.nodeId);
            destTag = to ? (effectiveTag(to) || to.name || '?') : '?';
            break;
          }
        }
        const checked = activeOuts.has(oi);
        h.push(`<div class="field check" style="font-size:11px"><input type="checkbox" data-grp-output="${gi}" data-out-idx="${oi}"${checked ? ' checked' : ''}><label>Выход ${oi + 1} → ${escHtml(destTag)}</label></div>`);
      }
    } else {
      h.push('<div class="muted" style="font-size:11px;color:#c62828">Выберите щит коммутации выше.</div>');
    }
    h.push('</div></details>');
  }

  // Кнопка «+ Добавить сценарий»
  h.push(`<button type="button" id="auto-add-group" style="font-size:12px;padding:5px 12px;border:1px dashed #999;background:transparent;border-radius:4px;cursor:pointer;width:100%;margin-top:4px">+ Добавить сценарий</button>`);

  // Задержки запуска и остановки
  h.push('<h4 style="margin:16px 0 8px">Задержки</h4>');
  h.push(field('Задержка запуска, сек', `<input type="number" id="auto-startDelay" min="0" max="600" step="1" value="${n.startDelaySec || 0}">`));
  h.push(field('Задержка остановки, сек', `<input type="number" id="auto-stopDelay" min="0" max="600" step="1" value="${n.stopDelaySec ?? 2}">`));
  h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Задержка запуска — время до выхода на рабочий режим.<br>Задержка остановки — время остывания после снятия нагрузки.</div>');
  h.push('</div>');

  body.innerHTML = h.join('');

  // Смена щита коммутации → перерисовать модалку
  const switchPanelSelect = document.getElementById('auto-switch-panel');
  if (switchPanelSelect) {
    switchPanelSelect.addEventListener('change', () => {
      n.switchPanelId = switchPanelSelect.value || null;
      openAutomationModal(n);
    });
  }

  // + Добавить сценарий
  const addBtn = document.getElementById('auto-add-group');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!Array.isArray(n.triggerGroups)) n.triggerGroups = [];
      n.triggerGroups.push({ name: '', watchInputs: [], logic: 'any', activateOutputs: [] });
      openAutomationModal(n);
    });
  }

  // Удаление сценария
  body.querySelectorAll('[data-grp-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gi = Number(btn.dataset.grpDelete);
      if (Array.isArray(n.triggerGroups) && n.triggerGroups[gi]) {
        n.triggerGroups.splice(gi, 1);
      }
      openAutomationModal(n);
    });
  });

  // Применить
  const applyBtn = document.getElementById('automation-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      snapshot('automation:' + n.id);

      // Сохраняем щит коммутации
      const spSel = document.getElementById('auto-switch-panel');
      n.switchPanelId = spSel ? (spSel.value || null) : null;

      // Собираем все группы
      const newGroups = [];
      body.querySelectorAll('[data-grp-idx]').forEach(el => {
        const gi = Number(el.dataset.grpIdx);
        const nameInput = el.querySelector(`[data-grp-name="${gi}"]`);
        const logicSelect = el.querySelector(`[data-grp-logic="${gi}"]`);

        const watchInputs = [];
        el.querySelectorAll(`[data-grp-watch="${gi}"]`).forEach(cb => {
          if (cb.checked) {
            watchInputs.push({ panelId: cb.dataset.panel, inputPort: Number(cb.dataset.port) });
          }
        });

        const activateOutputs = [];
        el.querySelectorAll(`[data-grp-output="${gi}"]`).forEach(cb => {
          if (cb.checked) activateOutputs.push(Number(cb.dataset.outIdx));
        });

        newGroups.push({
          name: nameInput ? nameInput.value : '',
          watchInputs,
          logic: logicSelect ? logicSelect.value : 'any',
          activateOutputs,
        });
      });

      n.triggerGroups = newGroups;
      // Очищаем legacy поля
      n.triggerNodeIds = [];
      n.triggerNodeId = null;

      // Задержки
      n.startDelaySec = Number(document.getElementById('auto-startDelay')?.value) || 0;
      n.stopDelaySec = Number(document.getElementById('auto-stopDelay')?.value) ?? 2;

      document.getElementById('modal-automation').classList.add('hidden');
      _render();
      renderInspector();
      notifyChange();
      flash('Автоматизация обновлена');
    };
  }

  document.getElementById('modal-automation').classList.remove('hidden');
}

// ================= Модалка «Параметры потребителя» =================
export function openConsumerParamsModal(n) {
  const body = document.getElementById('consumer-params-body');
  if (!body) return;
  const isOutdoor = n.consumerSubtype === 'outdoor_unit';
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="cp-name" value="${escAttr(n.name || '')}">`));

  // Справочник типовых потребителей (не показываем для наружного блока)
  const fullCatalog = [...CONSUMER_CATALOG, ...(GLOBAL.customConsumerCatalog || [])];
  if (!isOutdoor) {
    const curSub = n.consumerSubtype || 'custom';
    let catOpts = '';
    for (const cat of fullCatalog) {
      catOpts += `<option value="${cat.id}"${cat.id === curSub ? ' selected' : ''}>${escHtml(cat.label)}</option>`;
    }
    h.push(field('Тип потребителя', `<select id="cp-catalog">${catOpts}</select>`));
  } else {
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px">Наружный блок кондиционера</div>`);
  }

  h.push(field('Количество в группе', `<input type="number" id="cp-count" min="1" max="999" step="1" value="${n.count || 1}">`));
  // Чекбокс «Последовательное соединение» — активен только при count > 1.
  // Поле «Указание нагрузки» всегда присутствует, но скрывается CSS когда !serialMode,
  // чтобы показываться/прятаться сразу при клике на чекбокс (без кнопки Применить).
  const _cpCount = Math.max(1, Number(n.count) || 1);
  const _serial = _cpCount > 1 && !!n.serialMode;
  const _loadSpec = (n.loadSpec === 'total') ? 'total' : 'per-unit';
  if (_cpCount > 1) {
    h.push(`<div class="field check"><input type="checkbox" id="cp-serialMode"${n.serialMode ? ' checked' : ''}><label>Последовательное соединение (цепочка)</label></div>`);
    h.push(`<div id="cp-loadSpec-wrap" class="field" style="${_serial ? '' : 'display:none'}">
      <label>Указание нагрузки</label>
      <select id="cp-loadSpec">
        <option value="per-unit"${_loadSpec === 'per-unit' ? ' selected' : ''}>На каждый элемент</option>
        <option value="total"${_loadSpec === 'total' ? ' selected' : ''}>На всю группу</option>
      </select>
    </div>`);
  }
  // Значение в поле demandKw показываем как total или per-unit в зависимости
  // от режима loadSpec. Внутренне n.demandKw ВСЕГДА хранится per-unit.
  const _displayDemand = (_serial && _loadSpec === 'total')
    ? (Number(n.demandKw || 0) * _cpCount)
    : Number(n.demandKw || 0);
  const _demandLabel = (_cpCount > 1)
    ? ((_serial && _loadSpec === 'total') ? 'Мощность всей группы, kW' : 'Мощность каждого, kW')
    : 'Установленная мощность, kW';
  h.push(`<div id="cp-demandKw-wrap" class="field">
    <label id="cp-demandKw-label">${_demandLabel}</label>
    <input type="number" id="cp-demandKw" min="0" step="0.1" value="${_displayDemand}">
  </div>`);

  // Напряжение
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(levels[i].label)} (${levels[i].vLL}V)</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="cp-voltage">${vOpts}</select>`));
  h.push(field('cos φ', `<input type="number" id="cp-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi ?? 0.92}">`));
  h.push(field('Ки — коэффициент использования', `<input type="number" id="cp-kUse" min="0" max="1" step="0.05" value="${n.kUse ?? 1}">`));
  h.push(field('Кратность пускового тока', `<input type="number" id="cp-inrush" min="1" max="10" step="0.1" value="${n.inrushFactor ?? 1}">`));
  h.push(field('Входов', `<input type="number" id="cp-inputs" min="1" max="2" step="1" value="${Math.min(n.inputs || 1, 2)}">`));

  // Приоритеты входов (горизонтально) — только если больше 1 входа
  const inputCount = n.inputs || 1;
  if (inputCount > 1) {
    h.push('<div class="field"><label style="text-transform:uppercase;font-size:11px;color:#666">Приоритеты входов</label>');
    h.push('<div style="display:flex;gap:6px;flex-wrap:wrap">');
    for (let i = 0; i < inputCount; i++) {
      const v = (n.priorities && n.priorities[i]) ?? (i + 1);
      h.push(`<div style="text-align:center"><div style="font-size:10px;color:#999;margin-bottom:2px">Вх ${i + 1}</div>`);
      h.push(`<input type="number" id="cp-prio-${i}" min="1" max="99" step="1" value="${v}" style="width:48px;text-align:center;padding:4px">`);
      h.push('</div>');
    }
    h.push('</div>');
    h.push('<div class="muted" style="font-size:10px;margin-top:2px">1 = высший. Равные значения = параллельная работа.</div>');
    h.push('</div>');
  }

  // Параметры наружного блока (только для кондиционера)
  if (!isOutdoor && (n.consumerSubtype === 'conditioner')) {
    h.push('<details class="inspector-section" open>');
    h.push('<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Наружный блок</summary>');
    h.push(field('Мощность наружного блока, kW', `<input type="number" id="cp-outdoorKw" min="0" step="0.1" value="${n.outdoorKw || 0.3}">`));
    h.push(field('cos φ наружного блока', `<input type="number" id="cp-outdoorCosPhi" min="0.1" max="1" step="0.01" value="${n.outdoorCosPhi || 0.85}">`));
    if (n.linkedOutdoorId) {
      const outdoor = state.nodes.get(n.linkedOutdoorId);
      if (outdoor) {
        h.push(`<div class="muted" style="font-size:11px">Наружный блок: ${escHtml(effectiveTag(outdoor))} ${escHtml(outdoor.name)}</div>`);
      }
    }
    h.push('</details>');
  }

  // Кнопка сохранения текущих параметров в справочник проекта
  if (!isOutdoor) {
    h.push('<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee">');
    h.push('<button type="button" id="cp-save-catalog" style="font-size:11px;padding:4px 8px;border:1px dashed #999;background:#f9f9f9;border-radius:4px;cursor:pointer">+ Сохранить как тип в проект</button>');
    h.push('</div>');
  }

  body.innerHTML = h.join('');

  // Кнопка сохранения в справочник
  const saveBtn = document.getElementById('cp-save-catalog');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const label = prompt('Название типа потребителя:');
      if (!label) return;
      const id = 'user_' + Date.now();
      const entry = {
        id, label,
        demandKw: Number(document.getElementById('cp-demandKw')?.value) || 10,
        cosPhi: Number(document.getElementById('cp-cosPhi')?.value) || 0.92,
        kUse: Number(document.getElementById('cp-kUse')?.value) ?? 1,
        inrushFactor: Number(document.getElementById('cp-inrush')?.value) || 1,
        phase: '3ph',
      };
      if (!Array.isArray(GLOBAL.customConsumerCatalog)) GLOBAL.customConsumerCatalog = [];
      GLOBAL.customConsumerCatalog.push(entry);
      notifyChange();
      openConsumerParamsModal(n);
      flash('Тип сохранён в проект');
    });
  }

  // Обработчик смены типа из справочника
  const catSelect = document.getElementById('cp-catalog');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      const cat = fullCatalog.find(c => c.id === catSelect.value);
      if (!cat) return;
      const demEl = document.getElementById('cp-demandKw');
      const cosEl = document.getElementById('cp-cosPhi');
      const kUseEl = document.getElementById('cp-kUse');
      const inrEl = document.getElementById('cp-inrush');
      if (demEl) demEl.value = cat.demandKw;
      if (cosEl) cosEl.value = cat.cosPhi;
      if (kUseEl) kUseEl.value = cat.kUse;
      if (inrEl) inrEl.value = cat.inrushFactor;
      // Перерисовать модалку для показа/скрытия секции наружного блока
      // если тип сменился на/с кондиционера
      const wasCond = n.consumerSubtype === 'conditioner';
      const isCond = cat.id === 'conditioner';
      if (wasCond !== isCond) {
        // Применим тип сразу, чтобы UI обновился
        n.consumerSubtype = cat.id;
        if (isCond) {
          n.outdoorKw = cat.outdoorKw || 0.3;
          n.outdoorCosPhi = cat.outdoorCosPhi || 0.85;
        }
        openConsumerParamsModal(n); // перерисовать
      }
    });
  }

  // Live-обновление полей serial/loadSpec: показываем/скрываем «Указание нагрузки»
  // и переименовываем label «Мощность ...» сразу по клику, без Apply.
  // Также конвертируем значение demandKw при переключении per-unit ↔ total,
  // чтобы пользователь видел корректное число для выбранного режима.
  const serialCb = document.getElementById('cp-serialMode');
  const loadSpecSel = document.getElementById('cp-loadSpec');
  const loadSpecWrap = document.getElementById('cp-loadSpec-wrap');
  const demandInput = document.getElementById('cp-demandKw');
  const demandLabel = document.getElementById('cp-demandKw-label');
  const countInput = document.getElementById('cp-count');
  const updateDemandUi = (prevSerial, prevLoadSpec) => {
    const cnt = Math.max(1, Number(countInput?.value) || 1);
    const serial = !!serialCb?.checked;
    const ls = (loadSpecSel?.value === 'total') ? 'total' : 'per-unit';
    if (loadSpecWrap) loadSpecWrap.style.display = serial ? '' : 'none';
    if (demandLabel) {
      demandLabel.textContent = (cnt > 1)
        ? ((serial && ls === 'total') ? 'Мощность всей группы, kW' : 'Мощность каждого, kW')
        : 'Установленная мощность, kW';
    }
    // Конвертируем значение в поле при смене режима, чтобы юзер видел согласованную цифру
    if (demandInput) {
      const cur = Number(demandInput.value) || 0;
      const wasTotal = !!prevSerial && prevLoadSpec === 'total' && cnt > 1;
      const isTotal = serial && ls === 'total' && cnt > 1;
      if (wasTotal !== isTotal) {
        if (isTotal) demandInput.value = (cur * cnt).toFixed(2).replace(/\.00$/, '');
        else demandInput.value = (cur / cnt).toFixed(2).replace(/\.00$/, '');
      }
    }
  };
  if (serialCb) {
    // Храним предыдущее состояние, чтобы знать «было / стало» для конвертации.
    let _prevSerial = serialCb.checked;
    let _prevLS = loadSpecSel?.value || 'per-unit';
    serialCb.addEventListener('change', () => {
      updateDemandUi(_prevSerial, _prevLS);
      _prevSerial = serialCb.checked;
      _prevLS = loadSpecSel?.value || 'per-unit';
    });
    if (loadSpecSel) {
      loadSpecSel.addEventListener('change', () => {
        updateDemandUi(_prevSerial, _prevLS);
        _prevSerial = serialCb.checked;
        _prevLS = loadSpecSel.value || 'per-unit';
      });
    }
  }

  const applyBtn = document.getElementById('consumer-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('consumer-params:' + n.id);
    const catId = document.getElementById('cp-catalog')?.value || n.consumerSubtype || 'custom';
    const cat = fullCatalog.find(c => c.id === catId);
    n.consumerSubtype = catId;
    const nameInput = document.getElementById('cp-name')?.value?.trim();
    n.name = nameInput || (cat ? cat.label : n.name || 'Потребитель');
    n.count = Number(document.getElementById('cp-count')?.value) || 1;
    n.serialMode = !!document.getElementById('cp-serialMode')?.checked;
    n.loadSpec = (document.getElementById('cp-loadSpec')?.value === 'total') ? 'total' : 'per-unit';
    const _rawDemand = Number(document.getElementById('cp-demandKw')?.value) || 0;
    // Всегда храним per-unit. Если пользователь ввёл total — делим на count.
    n.demandKw = (n.serialMode && n.loadSpec === 'total' && n.count > 1)
      ? (_rawDemand / n.count)
      : _rawDemand;
    const vIdx = Number(document.getElementById('cp-voltage')?.value) || 0;
    n.voltageLevelIdx = vIdx;
    if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; n.phase = levels[vIdx].phases === 3 ? '3ph' : '1ph'; }
    n.cosPhi = Number(document.getElementById('cp-cosPhi')?.value) || 0.92;
    n.kUse = Number(document.getElementById('cp-kUse')?.value) ?? 1;
    n.inrushFactor = Number(document.getElementById('cp-inrush')?.value) || 1;
    n.inputs = Number(document.getElementById('cp-inputs')?.value) || 1;

    // Сохранить приоритеты
    if (!Array.isArray(n.priorities)) n.priorities = [];
    for (let i = 0; i < n.inputs; i++) {
      const el = document.getElementById('cp-prio-' + i);
      n.priorities[i] = el ? (Number(el.value) || (i + 1)) : (i + 1);
    }
    while (n.priorities.length < n.inputs) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = n.inputs;

    // Кондиционер: создание / обновление наружного блока (не для виртуальных узлов)
    if (catId === 'conditioner') {
      n.outdoorKw = Number(document.getElementById('cp-outdoorKw')?.value) || 0.3;
      n.outdoorCosPhi = Number(document.getElementById('cp-outdoorCosPhi')?.value) || 0.85;
      n.outputs = 1;
      if (n.id !== '__preset_edit__' && (!n.linkedOutdoorId || !state.nodes.get(n.linkedOutdoorId))) {
        // Создать наружный блок
        const outId = uid();
        const outdoor = {
          id: outId, type: 'consumer',
          x: n.x,
          y: n.y + NODE_H + 80,
          ...DEFAULTS.consumer(),
          name: 'Наруж. блок',
          consumerSubtype: 'outdoor_unit',
          demandKw: n.outdoorKw,
          cosPhi: n.outdoorCosPhi,
          linkedIndoorId: n.id,
          inputs: 1, outputs: 0, count: n.count || 1,
        };
        outdoor.tag = nextFreeTag('consumer');
        state.nodes.set(outId, outdoor);
        n.linkedOutdoorId = outId;
        // Создать связь indoor→outdoor
        const connId = uid('c');
        state.conns.set(connId, {
          id: connId,
          from: { nodeId: n.id, port: 0 },
          to: { nodeId: outId, port: 0 },
          material: GLOBAL.defaultMaterial,
          insulation: GLOBAL.defaultInsulation,
          installMethod: GLOBAL.defaultInstallMethod,
          ambientC: GLOBAL.defaultAmbient,
          grouping: GLOBAL.defaultGrouping,
          bundling: 'touching',
          lengthM: 5,
        });
      } else {
        // Обновить существующий наружный блок
        const outdoor = state.nodes.get(n.linkedOutdoorId);
        if (outdoor) {
          outdoor.demandKw = n.outdoorKw;
          outdoor.cosPhi = n.outdoorCosPhi;
          outdoor.count = n.count || 1;
        }
      }
    } else if (n.id !== '__preset_edit__') {
      // Если сменили с кондиционера на другой тип — удалить наружный блок
      if (n.linkedOutdoorId) {
        const outId = n.linkedOutdoorId;
        // Удалить связи наружного блока
        for (const c of Array.from(state.conns.values())) {
          if (c.from.nodeId === outId || c.to.nodeId === outId) state.conns.delete(c.id);
        }
        state.nodes.delete(outId);
        n.linkedOutdoorId = null;
      }
      n.outputs = 0;
    }

    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-consumer-params').classList.add('hidden');
      return;
    }
    _render(); renderInspector(); notifyChange();
    openConsumerParamsModal(n);
    flash('Параметры обновлены');
  };
  document.getElementById('modal-consumer-params').classList.remove('hidden');
}

// ================= Модалка «Параметры ИБП» =================
export function openUpsParamsModal(n) {
  const body = document.getElementById('ups-params-body');
  if (!body) return;
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="up-name" value="${escAttr(n.name || '')}">`));

  h.push('<h4 style="margin:8px 0">Основные параметры</h4>');
  h.push(field('Выходная мощность, kW', `<input type="number" id="up-capKw" min="0" step="0.1" value="${n.capacityKw}">`));
  h.push(field('КПД, %', `<input type="number" id="up-eff" min="30" max="100" step="1" value="${n.efficiency}">`));
  h.push(field('Входов', `<input type="number" id="up-inputs" min="1" max="5" step="1" value="${n.inputs}">`));
  h.push(field('Выходов', `<input type="number" id="up-outputs" min="1" max="20" step="1" value="${n.outputs}">`));

  // Напряжение
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  let vOpts = '';
  for (let i = 0; i < levels.length; i++) {
    vOpts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(levels[i].label)} (${levels[i].vLL}V)</option>`;
  }
  h.push(field('Уровень напряжения', `<select id="up-voltage">${vOpts}</select>`));
  h.push(field('cos φ', `<input type="number" id="up-cosPhi" min="0.1" max="1" step="0.01" value="${n.cosPhi || 1.0}">`));

  h.push('<h4 style="margin:16px 0 8px">Батарея</h4>');
  h.push(field('Ёмкость батареи, kWh', `<input type="number" id="up-battKwh" min="0" step="0.1" value="${n.batteryKwh}">`));
  h.push(field('Заряд батареи, %', `<input type="number" id="up-battPct" min="0" max="100" step="1" value="${n.batteryChargePct}">`));
  h.push(field('Ток заряда, А (AC)', `<input type="number" id="up-chargeA" min="0" step="0.1" value="${n.chargeA ?? 2}">`));
  h.push('<div class="muted" style="font-size:10px;margin-top:-8px">Ток из сети на заряд АКБ.</div>');

  h.push('<h4 style="margin:16px 0 8px">Статический байпас</h4>');
  h.push(`<div class="field check"><input type="checkbox" id="up-bypass"${n.staticBypass !== false ? ' checked' : ''}><label>Байпас разрешён</label></div>`);
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassAuto"${n.staticBypassAuto !== false ? ' checked' : ''}><label>Автоматический (по перегрузу)</label></div>`);
  h.push(field('Порог перехода, % от Pном', `<input type="number" id="up-bypassPct" min="80" max="200" step="5" value="${n.staticBypassOverloadPct || 110}">`));
  h.push(`<div class="field check"><input type="checkbox" id="up-bypassForced"${n.staticBypassForced ? ' checked' : ''}><label>Принудительный байпас</label></div>`);

  body.innerHTML = h.join('');

  const applyBtn = document.getElementById('ups-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('ups-params:' + n.id);
    const upName = document.getElementById('up-name')?.value?.trim();
    if (upName) n.name = upName;
    n.capacityKw = Number(document.getElementById('up-capKw')?.value) || 0;
    n.efficiency = Number(document.getElementById('up-eff')?.value) || 95;
    n.inputs = Number(document.getElementById('up-inputs')?.value) || 1;
    n.outputs = Number(document.getElementById('up-outputs')?.value) || 1;
    const vIdx = Number(document.getElementById('up-voltage')?.value) || 0;
    n.voltageLevelIdx = vIdx;
    if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; n.phase = levels[vIdx].phases === 3 ? '3ph' : '1ph'; }
    n.cosPhi = Number(document.getElementById('up-cosPhi')?.value) || 1.0;
    n.batteryKwh = Number(document.getElementById('up-battKwh')?.value) || 0;
    n.batteryChargePct = Number(document.getElementById('up-battPct')?.value) || 0;
    n.chargeA = Number(document.getElementById('up-chargeA')?.value) || 0;
    n.staticBypass = document.getElementById('up-bypass')?.checked !== false;
    n.staticBypassAuto = document.getElementById('up-bypassAuto')?.checked !== false;
    n.staticBypassOverloadPct = Number(document.getElementById('up-bypassPct')?.value) || 110;
    n.staticBypassForced = !!document.getElementById('up-bypassForced')?.checked;
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-ups-params').classList.add('hidden');
      return;
    }
    _render(); renderInspector(); notifyChange();
    openUpsParamsModal(n);
    flash('Параметры ИБП обновлены');
  };

  document.getElementById('modal-ups-params').classList.remove('hidden');
}

// ================= Модалка «Параметры щита» =================
export function openPanelParamsModal(n) {
  const body = document.getElementById('panel-params-body');
  if (!body) return;
  const h = [];
  // Обозначение (редактируемое) + Имя
  h.push(field('Обозначение', `<input type="text" id="pp-tag" value="${escAttr(n.tag || '')}">`));
  {
    const eff = effectiveTag(n);
    if (eff && eff !== n.tag) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное: <b>${escHtml(eff)}</b></div>`);
    }
  }
  h.push(field('Имя', `<input type="text" id="pp-name" value="${escAttr(n.name || '')}">`));

  // Тип щита — всегда виден
  const sm = n.switchMode || 'auto';
  {
    const isSubSection = !!n.parentSectionedId;
    let smOpts = `<option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Щит</option>`;
    smOpts += `<option value="auto"${sm === 'auto' ? ' selected' : ''}>Щит с АВР</option>`;
    if (!isSubSection) smOpts += `<option value="sectioned"${sm === 'sectioned' ? ' selected' : ''}>Многосекционный щит</option>`;
    if ((n.inputs || 0) > 1) {
      smOpts += `<option value="avr_paired"${sm === 'avr_paired' ? ' selected' : ''}>АВР с привязкой</option>`;
      smOpts += `<option value="switchover"${sm === 'switchover' ? ' selected' : ''}>Подменный</option>`;
      smOpts += `<option value="watchdog"${sm === 'watchdog' ? ' selected' : ''}>Watchdog</option>`;
    }
    h.push(field('Тип щита', `<select id="pp-switchMode">${smOpts}</select>`));
  }

  const isSectioned = sm === 'sectioned';

  // Базовые настройки — только для несекционных щитов
  if (!isSectioned) {
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Входов', `<input type="number" id="pp-inputs" min="1" max="30" step="1" value="${n.inputs}">`) + '</div>');
    h.push('<div style="flex:1">' + field('Выходов', `<input type="number" id="pp-outputs" min="1" max="30" step="1" value="${n.outputs}">`) + '</div>');
    h.push('</div>');
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Ксим', `<input type="number" id="pp-kSim" min="0" max="1.2" step="0.05" value="${n.kSim ?? 1}">`) + '</div>');
    {
      const curA = n.capacityA ?? 160;
      let opts = '';
      let hasCur = false;
      for (const v of BREAKER_SERIES) {
        if (v === curA) hasCur = true;
        opts += `<option value="${v}"${v === curA ? ' selected' : ''}>${v} А</option>`;
      }
      if (!hasCur) opts = `<option value="${curA}" selected>${curA} А</option>` + opts;
      h.push('<div style="flex:1">' + field('In, А', `<select id="pp-capacityA">${opts}</select>`) + '</div>');
    }
    h.push('</div>');
    if (n._capacityKwFromA) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-8px;margin-bottom:10px">Эквивалент: <b>${fmt(n._capacityKwFromA)} kW</b></div>`);
    }
    h.push('<div style="display:flex;gap:12px">');
    h.push('<div style="flex:1">' + field('Мин. запас, %', `<input type="number" id="pp-marginMin" min="0" max="50" step="1" value="${n.marginMinPct ?? 2}">`) + '</div>');
    h.push('<div style="flex:1">' + field('Макс. запас, %', `<input type="number" id="pp-marginMax" min="5" max="500" step="1" value="${n.marginMaxPct ?? 30}">`) + '</div>');
    h.push('</div>');
  }

  // Режимы переключения для несекционных щитов
  {
    const multiInput = (n.inputs || 0) > 1;

    if (multiInput && !isSectioned) {

      const hasAVR = sm !== 'parallel';

      if (hasAVR) {
        // Приоритеты — только для стандартного АВР (auto)
        if (sm === 'auto') {
          h.push('<h4 style="margin:12px 0 8px">Приоритеты входов</h4>');
          h.push('<div class="muted" style="font-size:10px;margin-bottom:6px">1 = высший. Равные = параллельная работа.</div>');
          h.push('<div style="display:flex;gap:8px;flex-wrap:wrap">');
          for (let i = 0; i < (n.inputs || 0); i++) {
            const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
            let feederTag = `Вх${i + 1}`;
            for (const c of state.conns.values()) {
              if (c.to.nodeId === n.id && c.to.port === i) {
                const from = state.nodes.get(c.from.nodeId);
                if (from) feederTag = effectiveTag(from) || from.name || feederTag;
                break;
              }
            }
            h.push(`<div style="text-align:center"><div style="font-size:9px;color:#666;margin-bottom:2px">${escHtml(feederTag)}</div><input type="number" id="pp-prio-${i}" min="1" max="20" step="1" value="${prio}" style="width:44px;text-align:center;font-size:12px"></div>`);
          }
          h.push('</div>');
        }

        // (секционный щит реализован как отдельные panel nodes — см. блок isSectioned ниже)

        // Задержки — для всех АВР
        h.push('<h4 style="margin:12px 0 8px">Задержки</h4>');
        h.push('<div style="display:flex;gap:12px">');
        h.push('<div style="flex:1">' + field('Переключение, сек', `<input type="number" id="pp-avrDelay" min="0" max="30" step="0.5" value="${n.avrDelaySec ?? 2}">`) + '</div>');
        h.push('<div style="flex:1">' + field('Разбежка, сек', `<input type="number" id="pp-avrInterlock" min="0" max="10" step="0.5" value="${n.avrInterlockSec ?? 1}">`) + '</div>');
        h.push('</div>');
      } // end hasAVR
    } // end multiInput
  }

  // === Многосекционный щит — секции как отдельные panel-узлы ===
  if (isSectioned) {
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    const ties = Array.isArray(n.busTies) ? n.busTies : [];

    h.push('<h4 style="margin:12px 0 8px">Секции</h4>');
    h.push(`<div class="muted" style="font-size:10px;margin-bottom:8px">Каждая секция — отдельный щит. Клик по секции открывает параметры.</div>`);

    for (let si = 0; si < secIds.length; si++) {
      const secNode = state.nodes.get(secIds[si]);
      if (!secNode) continue;
      const secName = secNode.name || `Секция ${si + 1}`;
      const secTag = effectiveTag(secNode) || secNode.tag || '';
      const secSm = secNode.switchMode || 'parallel';
      const smLabel = secSm === 'auto' ? 'АВР' : 'Щит';
      // Проверяем подключения
      let hasConns = false;
      for (const c of state.conns.values()) {
        if (c.to.nodeId === secNode.id || c.from.nodeId === secNode.id) { hasConns = true; break; }
      }

      h.push(`<div style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:6px">`);
      h.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">`);
      h.push(`<span style="font-size:12px;font-weight:600">${escHtml(secName)}</span>`);
      h.push(`<span style="font-size:10px;color:#999">${secTag} · ${smLabel} · In ${secNode.capacityA || 0}А · вх${secNode.inputs} вых${secNode.outputs}</span>`);
      h.push(`<button type="button" data-sec-open="${secIds[si]}" style="margin-left:auto;font-size:11px;padding:3px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:4px;cursor:pointer">⚙ Параметры</button>`);
      h.push('</div>');
      if (secIds.length > 1 && !hasConns) {
        h.push(`<button type="button" data-sec-delete="${si}" style="font-size:10px;padding:2px 6px;border:1px solid #ef9a9a;background:#fff;border-radius:3px;cursor:pointer;color:#c62828">✕ Удалить</button>`);
      } else if (secIds.length > 1 && hasConns) {
        h.push(`<span class="muted" style="font-size:10px">Нельзя удалить — есть линии</span>`);
      }
      h.push('</div>');

      // СВ между секциями
      if (si < secIds.length - 1) {
        const tieIdx = ties.findIndex(t => (t.between[0] === si && t.between[1] === si + 1) || (t.between[0] === si + 1 && t.between[1] === si));
        h.push(`<div style="text-align:center;margin:4px 0;padding:6px;background:#f0f0f0;border-radius:4px">`);
        if (tieIdx >= 0) {
          const tie = ties[tieIdx];
          h.push(`<div style="font-size:11px;font-weight:600;margin-bottom:4px">СВ${tieIdx + 1}</div>`);
          h.push('<div style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap">');
          h.push(`<select data-tie-mode="${tieIdx}" style="font-size:11px;padding:3px 8px;border:1px solid #ccc;border-radius:3px">`);
          h.push(`<option value="auto"${tie.auto ? ' selected' : ''}>Авто</option>`);
          h.push(`<option value="manual"${!tie.auto ? ' selected' : ''}>Ручной</option></select>`);
          if (tie.auto) {
            h.push(`<label style="font-size:10px;color:#666">Ts</label><input type="number" data-tie-delay="${tieIdx}" min="0" max="30" step="0.5" value="${tie.delaySec ?? 2}" style="width:50px;font-size:11px;padding:3px">`);
            h.push(`<label style="font-size:10px;color:#666">Tr</label><input type="number" data-tie-interlock="${tieIdx}" min="0" max="10" step="0.5" value="${tie.interlockSec ?? 1}" style="width:50px;font-size:11px;padding:3px">`);
          }
          h.push(`<button type="button" data-tie-remove="${tieIdx}" style="font-size:11px;padding:3px 6px;border:1px solid #ef9a9a;background:#fff;border-radius:3px;cursor:pointer;color:#c62828">✕</button>`);
          h.push('</div>');
        } else {
          const nextSec = state.nodes.get(secIds[si + 1]);
          h.push(`<button type="button" data-tie-add="${si}" style="font-size:11px;padding:4px 12px;border:1px dashed #999;background:#fff;border-radius:4px;cursor:pointer">+ СВ</button>`);
        }
        h.push('</div>');
      }
    }
    h.push(`<button type="button" id="pp-addSection" style="width:100%;font-size:11px;padding:6px;border:1px dashed #999;background:#f9f9f9;border-radius:4px;cursor:pointer;margin-top:8px">+ Добавить секцию</button>`);
  }

  body.innerHTML = h.join('');

  // Live: переключение типа АВР сразу применяется
  const smSel = document.getElementById('pp-switchMode');
  if (smSel) {
    smSel.addEventListener('change', () => {
      snapshot('switchMode:' + n.id);
      n.switchMode = smSel.value;
      // При переходе на sectioned — автосоздание первой секции
      if (smSel.value === 'sectioned' && (!n.sectionIds || !n.sectionIds.length)) {
        const secId = uid();
        const secNode = {
          id: secId, type: 'panel',
          x: n.x, y: n.y,
          ...DEFAULTS.panel(),
          name: 'Секция 1',
          inputs: n.inputs || 1, outputs: n.outputs || 4,
          switchMode: (n.inputs || 1) > 1 ? 'auto' : 'parallel',
          capacityA: n.capacityA || 160,
          priorities: n.priorities ? [...n.priorities] : [1],
          parentSectionedId: n.id,
        };
        secNode.tag = 'P1';
        state.nodes.set(secId, secNode);
        n.sectionIds = [secId];
        n.busTies = [];
        n.inputs = 0; n.outputs = 0;
      }
      _render(); renderInspector(); notifyChange();
      openPanelParamsModal(n);
    });
  }

  // Обработчики секционного щита
  if (n.switchMode === 'sectioned') {
    // Открыть параметры секции
    body.querySelectorAll('[data-sec-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const secId = btn.dataset.secOpen;
        const secNode = state.nodes.get(secId);
        if (secNode) {
          document.getElementById('modal-panel-params').classList.add('hidden');
          openPanelParamsModal(secNode);
        }
      });
    });
    // Добавить секцию — создаёт отдельный panel node
    const addSecBtn = document.getElementById('pp-addSection');
    if (addSecBtn) addSecBtn.addEventListener('click', () => {
      snapshot('addSection:' + n.id);
      if (!Array.isArray(n.sectionIds)) n.sectionIds = [];
      const secId = uid();
      const secNum = n.sectionIds.length + 1;
      // Позиция: правее последней секции
      let sx = n.x || 0, sy = n.y || 0;
      if (n.sectionIds.length > 0) {
        const lastSec = state.nodes.get(n.sectionIds[n.sectionIds.length - 1]);
        if (lastSec) { sx = lastSec.x + nodeWidth(lastSec) + 40; sy = lastSec.y; }
      }
      const secNode = {
        id: secId, type: 'panel',
        x: sx, y: sy,
        ...DEFAULTS.panel(),
        name: `Секция ${secNum}`,
        inputs: 1, outputs: 4,
        switchMode: 'parallel',
        capacityA: 160,
        parentSectionedId: n.id,
      };
      secNode.tag = `P${n.sectionIds.length + 1}`;
      state.nodes.set(secId, secNode);
      n.sectionIds.push(secId);
      _render(); notifyChange();
      openPanelParamsModal(n);
    });
    // Удалить секцию
    body.querySelectorAll('[data-sec-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = Number(btn.dataset.secDelete);
        const secId = n.sectionIds[si];
        if (!secId) return;
        snapshot('delSection:' + n.id);
        // Удалить связи секции
        for (const c of Array.from(state.conns.values())) {
          if (c.from.nodeId === secId || c.to.nodeId === secId) state.conns.delete(c.id);
        }
        state.nodes.delete(secId);
        n.sectionIds.splice(si, 1);
        // Удалить СВ ссылающиеся на эту секцию
        n.busTies = (n.busTies || []).filter(t => t.between[0] !== si && t.between[1] !== si)
          .map(t => ({ ...t, between: t.between.map(i => i > si ? i - 1 : i) }));
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        _render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Добавить СВ
    body.querySelectorAll('[data-tie-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = Number(btn.dataset.tieAdd);
        snapshot('addTie:' + n.id);
        if (!Array.isArray(n.busTies)) n.busTies = [];
        n.busTies.push({ between: [si, si + 1], closed: false, auto: true });
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        _render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Удалить СВ
    body.querySelectorAll('[data-tie-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = Number(btn.dataset.tieRemove);
        snapshot('delTie:' + n.id);
        n.busTies.splice(ti, 1);
        n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
        _render(); notifyChange();
        openPanelParamsModal(n);
      });
    });
    // Режим СВ
    body.querySelectorAll('[data-tie-mode]').forEach(sel => {
      sel.addEventListener('change', () => {
        const ti = Number(sel.dataset.tieMode);
        n.busTies[ti].auto = sel.value === 'auto';
        notifyChange();
      });
    });
  }

  const applyBtn = document.getElementById('panel-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('panel-params:' + n.id);
    // Обозначение
    const ppTag = document.getElementById('pp-tag')?.value?.trim();
    if (ppTag && ppTag !== n.tag) {
      if (_isTagUnique(ppTag, n.id)) {
        n.tag = ppTag;
      } else {
        flash(`Обозначение «${ppTag}» уже занято`, 'error');
        return;
      }
    }
    const ppName = document.getElementById('pp-name')?.value?.trim();
    if (ppName) n.name = ppName;
    const curSm = document.getElementById('pp-switchMode')?.value || n.switchMode;
    if (curSm !== 'sectioned') n.inputs = Number(document.getElementById('pp-inputs')?.value) || 1;
    else { n.inputs = 0; n.outputs = 0; }
    n.outputs = Number(document.getElementById('pp-outputs')?.value) || 1;
    n.kSim = Number(document.getElementById('pp-kSim')?.value) ?? 1;
    n.capacityA = Number(document.getElementById('pp-capacityA')?.value) || 160;
    n.marginMinPct = Number(document.getElementById('pp-marginMin')?.value) || 2;
    n.marginMaxPct = Number(document.getElementById('pp-marginMax')?.value) || 30;
    const smSel = document.getElementById('pp-switchMode');
    if (smSel) n.switchMode = smSel.value;
    n.avrDelaySec = Number(document.getElementById('pp-avrDelay')?.value) ?? 2;
    n.avrInterlockSec = Number(document.getElementById('pp-avrInterlock')?.value) ?? 1;
    // Приоритеты
    if (!Array.isArray(n.priorities)) n.priorities = [];
    for (let i = 0; i < n.inputs; i++) {
      const el = document.getElementById(`pp-prio-${i}`);
      if (el) n.priorities[i] = Number(el.value) || (i + 1);
    }
    while (n.priorities.length < n.inputs) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = n.inputs;
    // Многосекционный щит: сохранить задержки СВ
    if (n.switchMode === 'sectioned') {
      n._busTieStates = null; n._busTieSwitchStartedAt = null; n._busTieInterlockStartedAt = null; n._busTieDisconnected = null; n._busTieDeadSec = null;
      // Сохранить задержки СВ
      if (Array.isArray(n.busTies)) {
        for (let ti = 0; ti < n.busTies.length; ti++) {
          const dEl = body.querySelector(`[data-tie-delay="${ti}"]`);
          if (dEl) n.busTies[ti].delaySec = Number(dEl.value) ?? 2;
          const iEl = body.querySelector(`[data-tie-interlock="${ti}"]`);
          if (iEl) n.busTies[ti].interlockSec = Number(iEl.value) ?? 1;
        }
      }
    }
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-panel-params').classList.add('hidden');
      return;
    }
    _render(); renderInspector(); notifyChange();
    openPanelParamsModal(n);
    flash('Параметры щита обновлены');
  };

  document.getElementById('modal-panel-params').classList.remove('hidden');
}

// ================= Модалка «Управление щитом» =================
// IEC 60617 автоматический выключатель (circuit breaker symbol)
// Структура сверху вниз:
//   - верхняя вертикальная линия (подвод)
//   - крестик (механизм расцепителя) — всегда сверху
//   - подвижный контакт: ось вращения СНИЗУ
//     ON:  контакт вертикален (замкнут, совпадает с линией)
//     OFF: контакт отклонён влево ~30° от оси снизу
//   - нижняя точка (ось вращения / нижний контакт)
function svgBreaker(x, topY, on, color, offColor) {
  const h = 30;
  const col = on ? color : (offColor || '#bbb');
  let s = '';

  // Верхняя точка подключения (неподвижный контакт)
  const topPt = topY;
  // Крестик механизма — в верхней трети
  const crossY = topY + 7;
  // Ось вращения контакта — внизу
  const pivotY = topY + h;

  // Верхняя вертикальная линия (от верхней точки до крестика)
  s += `<line x1="${x}" y1="${topPt}" x2="${x}" y2="${crossY - 4}" stroke="${col}" stroke-width="2"/>`;

  // Крестик механизма (всегда сверху)
  s += `<line x1="${x - 4}" y1="${crossY - 4}" x2="${x + 4}" y2="${crossY + 4}" stroke="${col}" stroke-width="1.5"/>`;
  s += `<line x1="${x + 4}" y1="${crossY - 4}" x2="${x - 4}" y2="${crossY + 4}" stroke="${col}" stroke-width="1.5"/>`;

  if (on) {
    // Замкнут: контакт вертикален — от крестика вниз до оси
    s += `<line x1="${x}" y1="${crossY + 4}" x2="${x}" y2="${pivotY}" stroke="${col}" stroke-width="2.5"/>`;
  } else {
    // Разомкнут: контакт отклонён от оси (снизу) влево вверх ~30°
    // Ось вращения = pivotY, контакт идёт от pivotY вверх-влево
    const contactLen = pivotY - crossY - 4;
    const angle = 30 * Math.PI / 180; // 30 градусов
    const tipX = x - Math.sin(angle) * contactLen;
    const tipY = pivotY - Math.cos(angle) * contactLen;
    s += `<line x1="${x}" y1="${pivotY}" x2="${tipX}" y2="${tipY}" stroke="${offColor || '#ff9800'}" stroke-width="2.5"/>`;
  }

  // Нижняя точка (ось вращения)
  s += `<circle cx="${x}" cy="${pivotY}" r="2.5" fill="${col}"/>`;
  // Верхняя точка
  s += `<circle cx="${x}" cy="${topPt}" r="2" fill="${col}"/>`;

  return { svg: s, height: h };
}

// ================= Многосекционный щит — SVG визуализация =================
function _renderSectionedPanelControl(n, body) {
  const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
  const busTies = Array.isArray(n.busTies) ? n.busTies : [];
  if (!secIds.length) {
    body.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Секции не настроены. Откройте «Параметры щита» и добавьте секции.</div>';
    document.getElementById('modal-panel-control').classList.remove('hidden');
    return;
  }
  // Собираем section nodes
  const sections = secIds.map(id => state.nodes.get(id)).filter(Boolean);
  if (!sections.length) {
    body.innerHTML = '<div class="muted" style="padding:20px">Секции не найдены.</div>';
    document.getElementById('modal-panel-control').classList.remove('hidden');
    return;
  }
  const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : busTies.map(t => !!t.closed);
  if (!Array.isArray(n._busTieStates)) n._busTieStates = tieStates;

  // Размеры — ширина секции пропорциональна количеству выходов/входов (как у простого щита)
  const portGap = 40; // расстояние между портами
  const secWidths = sections.map(sec => {
    const pins = Math.max(sec.inputs || 1, sec.outputs || 1, 2);
    return pins * portGap + 40;
  });
  const tieW = 60;  // промежуток для СВ
  const totalW = secWidths.reduce((s, w) => s + w, 0) + (sections.length - 1) * tieW + 40;
  const brkH = 28;
  const inBrkY = 30;
  const busY = inBrkY + brkH + 20;
  const outBrkY = busY + 20;
  const maxOuts = Math.max(...sections.map(s => s.outputs || 1), 1);
  const svgH = outBrkY + brkH + 20 + maxOuts * 14;

  // Определяем питание секций: секция запитана если _powered И хотя бы один вводной автомат включён
  const sectionPowered = new Array(sections.length).fill(false);
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    if (!sec._powered) continue;
    // Проверяем что хотя бы один вводной автомат включён
    const inBrk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
    let hasClosedBreaker = false;
    for (let i = 0; i < (sec.inputs || 1); i++) {
      if (inBrk[i] !== false) { hasClosedBreaker = true; break; }
    }
    // Или питание через виртуальную связь (СВ) — тоже считаем
    if (hasClosedBreaker) {
      sectionPowered[si] = true;
    } else {
      // Может быть запитана через СВ
      for (const c of state.conns.values()) {
        if (c._virtual && c.to.nodeId === sec.id && (c._state === 'active' || c._state === 'powered')) {
          sectionPowered[si] = true;
          break;
        }
      }
    }
  }
  // BFS: через замкнутые СВ определяем какие секции запитаны
  const sectionFed = new Array(sections.length).fill(false);
  for (let si = 0; si < sections.length; si++) {
    if (!sectionPowered[si]) continue;
    // BFS от запитанной секции через замкнутые СВ
    const queue = [si];
    const visited = new Set();
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      sectionFed[cur] = true;
      for (let ti = 0; ti < busTies.length; ti++) {
        if (!tieStates[ti]) continue;
        const [a, b] = busTies[ti].between;
        if (a === cur && !visited.has(b)) queue.push(b);
        if (b === cur && !visited.has(a)) queue.push(a);
      }
    }
  }

  let h = '';
  h += `<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`;
  h += `<div class="muted" style="font-size:11px;margin-bottom:8px">Многосекционный щит · ${sections.length} секций · ${busTies.length} СВ</div>`;
  h += `<div id="pc-svg-wrap" style="display:flex;justify-content:center;align-items:flex-start;overflow:auto;flex:1">`;
  h += `<svg id="pc-svg" width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}" style="font-family:sans-serif;font-size:10px">`;

  // Вычисляем X-позиции начала каждой секции
  const secStartX = [];
  let cx = 20;
  for (let si = 0; si < sections.length; si++) {
    secStartX.push(cx);
    cx += secWidths[si];
    if (si < sections.length - 1) cx += tieW;
  }

  // Рисуем каждую секцию (стиль идентичен простому щиту)
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const secW = secWidths[si];
    const sx = secStartX[si];
    const fed = sectionFed[si];
    const hasPower = sectionPowered[si];
    const busCol = fed ? '#e53935' : '#bbb';

    // Подпись секции
    const secLabel = sec.name || `Секция ${si + 1}`;
    h += `<text x="${sx + secW / 2}" y="${svgH - 4}" text-anchor="middle" fill="#999" font-size="9">${escHtml(secLabel)}</text>`;
    // Нагрузка секции
    let secLoadKw = 0;
    for (const cc of state.conns.values()) {
      if (cc.from.nodeId === sec.id && cc._loadKw) secLoadKw += cc._loadKw;
    }
    const capA = sec.capacityA || 0;
    const maxA = sec._maxLoadA || 0;
    if (capA) h += `<text x="${sx + 4}" y="${busY - 14}" text-anchor="start" fill="${fed ? '#333' : '#999'}" font-size="8">In ${capA}А</text>`;
    if (maxA) h += `<text x="${sx + 4}" y="${busY - 5}" text-anchor="start" fill="${fed ? '#333' : '#999'}" font-size="8">Макс: ${fmt(maxA)}А</text>`;
    // Шина секции
    h += `<rect x="${sx}" y="${busY - 2}" width="${secW}" height="4" fill="${busCol}" rx="1"/>`;

    // Входы секции (стиль как у простого щита)
    const inCount = sec.inputs || 1;
    for (let ii = 0; ii < inCount; ii++) {
      const port = ii;
      const ix = sx + 20 + (ii + 0.5) * ((secW - 40) / Math.max(inCount, 1));
      // Подпись источника
      let feederTag = `Вх${port + 1}`;
      for (const c of state.conns.values()) {
        if (c.to.nodeId === sec.id && c.to.port === port && !c._virtual) {
          const from = state.nodes.get(c.from.nodeId);
          if (from) feederTag = effectiveTag(from) || from.name || feederTag;
          break;
        }
      }
      h += `<text x="${ix}" y="12" text-anchor="middle" fill="#333" font-size="9" font-weight="600">${escHtml(feederTag)}</text>`;
      // Линия сверху → автомат
      const inBrk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
      const brkOn = inBrk[port] !== false;
      const lineAlive = hasPower;
      const topColor = lineAlive ? '#e53935' : '#bbb';
      const throughColor = lineAlive && brkOn ? '#e53935' : '#bbb';
      h += `<line x1="${ix}" y1="16" x2="${ix}" y2="${inBrkY}" stroke="${topColor}" stroke-width="2"/>`;
      // Лампочка (идентична простому щиту)
      const lampY = 22;
      if (lineAlive && brkOn) {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="#43a047" opacity="0.8"/>`;
      } else if (lineAlive) {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="#e53935" opacity="0.8"/>`;
      } else {
        h += `<circle cx="${ix}" cy="${lampY}" r="4" fill="none" stroke="#ccc" stroke-width="1"/>`;
      }
      // Автомат IEC
      const brk = svgBreaker(ix, inBrkY, brkOn, throughColor, '#ff9800');
      h += brk.svg;
      // Линия от автомата до шины
      h += `<line x1="${ix}" y1="${inBrkY + brkH}" x2="${ix}" y2="${busY - 2}" stroke="${throughColor}" stroke-width="2"/>`;
      // Приоритет
      const prio = (sec.priorities && sec.priorities[ii]) ?? (ii + 1);
      h += `<text x="${ix + 12}" y="${inBrkY + brkH / 2 + 3}" fill="#1976d2" font-size="8">P${prio}</text>`;
      // Клик-зона
      h += `<rect x="${ix - 14}" y="${inBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-sec-in-toggle="${si}:${port}"/>`;
    }

    // Выходы секции (стиль как у простого щита)
    const outCount = sec.outputs || 1;
    for (let oi = 0; oi < outCount; oi++) {
      const port = oi;
      const ox = sx + 20 + (oi + 0.5) * ((secW - 40) / Math.max(outCount, 1));
      const outBrk = Array.isArray(sec.breakerStates) ? sec.breakerStates : [];
      const outOn = outBrk[port] !== false;
      const powered = fed && outOn;
      const lineCol = powered ? '#e53935' : '#bbb';
      // Линия шина → автомат
      h += `<line x1="${ox}" y1="${busY + 2}" x2="${ox}" y2="${outBrkY}" stroke="${busCol}" stroke-width="2"/>`;
      const brk = svgBreaker(ox, outBrkY, outOn, lineCol, '#ff9800');
      h += brk.svg;

      // Номинал автомата (как у простого щита — с _breakerCount и кривой)
      let brkLabel = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === sec.id && cc.from.port === port) {
          if (cc._breakerIn) {
            const cnt = cc._breakerCount || 1;
            if (cnt > 1 && cc._breakerPerLine) brkLabel = `${cnt}×${cc._breakerPerLine}А`;
            else brkLabel = `${cc._breakerIn}А`;
          } else if (cc._breakerPerLine) {
            const cnt = cc._breakerCount || 1;
            brkLabel = cnt > 1 ? `${cnt}×${cc._breakerPerLine}А` : `${cc._breakerPerLine}А`;
          }
          break;
        }
      }
      if (brkLabel) {
        h += `<text x="${ox - 12}" y="${outBrkY + brkH / 2}" fill="#ef6c00" font-size="8" font-weight="600" text-anchor="end" dominant-baseline="central">${brkLabel}</text>`;
      }
      // Линия от автомата вниз
      h += `<line x1="${ox}" y1="${outBrkY + brkH}" x2="${ox}" y2="${outBrkY + brkH + 14}" stroke="${lineCol}" stroke-width="2"/>`;
      // Метка назначения (как у простого щита)
      let outLabel = '';
      let labelColor = '#333';
      let hasConn = false;
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === sec.id && cc.from.port === port && !cc._virtual) {
          hasConn = true;
          const to = state.nodes.get(cc.to.nodeId);
          outLabel = to ? (effectiveTag(to) || to.name || '') : '';
          outLabel += `-${cc.to.port + 1}`;
          break;
        }
      }
      if (!hasConn) { outLabel = 'Резерв'; labelColor = '#bbb'; }
      const labelY = outBrkY + brkH + 16;
      h += `<text x="${ox}" y="${labelY}" fill="${labelColor}" font-size="9" font-weight="600" text-anchor="end" dominant-baseline="central" transform="rotate(-90 ${ox} ${labelY})">${escHtml(outLabel)}</text>`;
      // Клик-зона
      h += `<rect x="${ox - 14}" y="${outBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-sec-out-toggle="${si}:${port}"/>`;
    }
  }

  // Рисуем СВ между секциями
  for (let ti = 0; ti < busTies.length; ti++) {
    const tie = busTies[ti];
    const [secA, secB] = tie.between;
    const tieOn = tieStates[ti];
    // X позиция: между секциями secA и secB
    const xA = secStartX[secA] + secWidths[secA];
    const xB = secStartX[secB];
    const mx = (xA + xB) / 2;

    const col = tieOn ? '#e53935' : '#bbb';
    // Горизонтальные линии от шин к СВ
    h += `<line x1="${xA}" y1="${busY}" x2="${mx - 10}" y2="${busY}" stroke="${col}" stroke-width="2"/>`;
    h += `<line x1="${mx + 10}" y1="${busY}" x2="${xB}" y2="${busY}" stroke="${col}" stroke-width="2"/>`;

    // СВ символ (горизонтальный автомат)
    if (tieOn) {
      h += `<line x1="${mx - 10}" y1="${busY}" x2="${mx + 10}" y2="${busY}" stroke="${col}" stroke-width="3"/>`;
    } else {
      h += `<line x1="${mx - 10}" y1="${busY}" x2="${mx + 4}" y2="${busY - 10}" stroke="${col}" stroke-width="2.5"/>`;
    }
    // Крестик
    h += `<line x1="${mx - 3}" y1="${busY - 4}" x2="${mx + 3}" y2="${busY + 4}" stroke="${col}" stroke-width="1.5"/>`;
    h += `<line x1="${mx + 3}" y1="${busY - 4}" x2="${mx - 3}" y2="${busY + 4}" stroke="${col}" stroke-width="1.5"/>`;

    // Подпись
    h += `<text x="${mx}" y="${busY - 14}" text-anchor="middle" fill="${tie.auto ? '#1976d2' : '#666'}" font-size="8">${tie.auto ? 'авто' : 'ручн.'}</text>`;
    h += `<text x="${mx}" y="${busY + 24}" text-anchor="middle" fill="#666" font-size="8">СВ${ti + 1}</text>`;

    // Клик-зона
    h += `<rect x="${mx - 16}" y="${busY - 16}" width="32" height="32" fill="transparent" style="cursor:pointer" data-sec-tie-toggle="${ti}"/>`;
  }

  h += '</svg></div>';

  // Настройки выносим в отдельную панель (pc-settings-panel)
  let sh = '';

  // Переключатели Авто/Ручной для каждого СВ + таймеры
  if (busTies.length) {
    sh += '<div>';
    for (let ti = 0; ti < busTies.length; ti++) {
      const tie = busTies[ti];
      const isAuto = !!tie.auto;
      sh += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">';
      sh += `<span style="font-size:11px;font-weight:600;color:#666;min-width:36px">СВ${ti + 1}:</span>`;
      sh += `<span style="font-size:11px;color:${isAuto ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh += `<div data-tie-auto-toggle="${ti}" style="position:relative;width:44px;height:22px;border-radius:11px;background:${isAuto ? '#4caf50' : '#ff9800'};cursor:pointer;flex-shrink:0">`;
      sh += `<div style="position:absolute;top:2px;${isAuto ? 'left:2px' : 'right:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh += '</div>';
      sh += `<span style="font-size:11px;color:${!isAuto ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh += '</div>';
      const swCd = Array.isArray(n._busTieSwitchCountdown) ? (n._busTieSwitchCountdown[ti] || 0) : 0;
      const ilCd = Array.isArray(n._busTieInterlockCountdown) ? (n._busTieInterlockCountdown[ti] || 0) : 0;
      const swStarted = Array.isArray(n._busTieSwitchStartedAt) ? (n._busTieSwitchStartedAt[ti] || 0) : 0;
      const swElapsed = swStarted > 0 ? (Date.now() - swStarted) / 1000 : 0;
      if (swCd > 0 && swElapsed > 0.5) {
        sh += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">СВ${ti + 1}: задержка ${Math.ceil(swCd)} с</div>`;
      } else if (ilCd > 0) {
        sh += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">СВ${ti + 1}: разбежка ${Math.ceil(ilCd)} с</div>`;
      }
    }
    sh += '</div>';
  }
  // АВР для секций с несколькими вводами
  const avrSections = sections.filter(s => (s.inputs || 1) > 1);
  if (avrSections.length) {
    sh += '<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px">';
    sh += '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:4px">АВР секций:</div>';
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      if ((sec.inputs || 1) <= 1) continue;
      const manualNow = sec.switchMode === 'manual';
      const secLabel = sec.name || `Секция ${si + 1}`;
      sh += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0">';
      sh += `<span style="font-size:11px;font-weight:600;color:#666;min-width:70px">${escHtml(secLabel)}:</span>`;
      sh += `<span style="font-size:11px;color:${!manualNow ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh += `<div data-sec-avr-toggle="${si}" style="position:relative;width:44px;height:22px;border-radius:11px;background:${manualNow ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`;
      sh += `<div style="position:absolute;top:2px;${manualNow ? 'right:2px' : 'left:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh += '</div>';
      sh += `<span style="font-size:11px;color:${manualNow ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh += '</div>';
      if (sec._avrSwitchCountdown > 0) {
        sh += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">${escHtml(secLabel)}: задержка ${Math.ceil(sec._avrSwitchCountdown)} с</div>`;
      } else if (sec._avrInterlockCountdown > 0) {
        sh += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">${escHtml(secLabel)}: разбежка ${Math.ceil(sec._avrInterlockCountdown)} с</div>`;
      }
    }
    sh += '</div>';
  }
  // Приоритет ввода для каждой секции
  const hasAutoTie = busTies.some(t => t.auto);
  if (hasAutoTie) {
    sh += '<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px">';
    sh += '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:4px">Приоритет:</div>';
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const secLabel = sec.name || `Секция ${si + 1}`;
      const prio = sec.sectionInputPriority || 'input';
      sh += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0">';
      sh += `<span style="font-size:11px;color:#666;min-width:70px">${escHtml(secLabel)}:</span>`;
      sh += `<button type="button" data-sec-priority="${si}:input" style="padding:2px 8px;border:1px solid ${prio === 'input' ? '#1976d2' : '#ccc'};background:${prio === 'input' ? '#1976d2' : '#fff'};color:${prio === 'input' ? '#fff' : '#333'};border-radius:3px;cursor:pointer;font-size:10px">Ввод</button>`;
      sh += `<button type="button" data-sec-priority="${si}:tie" style="padding:2px 8px;border:1px solid ${prio === 'tie' ? '#1976d2' : '#ccc'};background:${prio === 'tie' ? '#1976d2' : '#fff'};color:${prio === 'tie' ? '#fff' : '#333'};border-radius:3px;cursor:pointer;font-size:10px">СВ</button>`;
      sh += '</div>';
    }
    sh += '</div>';
  }

  body.innerHTML = h;

  // Записываем настройки в нижнюю панель с кнопкой сворачивания
  const settingsPanel = document.getElementById('pc-settings-panel');
  if (settingsPanel && sh) {
    settingsPanel.innerHTML =
      `<div style="width:280px;border:1px solid #d0d0d0;border-radius:8px;background:rgba(255,255,255,0.92);backdrop-filter:blur(6px);box-shadow:0 2px 12px rgba(0,0,0,0.1)">` +
      `<div id="pc-settings-toggle" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;user-select:none">` +
      `<span style="font-size:12px;font-weight:700;color:#444">⚙ Настройки</span>` +
      `<span style="font-size:12px;color:#999" id="pc-settings-arrow">▲</span></div>` +
      `<div id="pc-settings-content" style="padding:4px 12px 10px;border-top:1px solid #eee">${sh}</div></div>`;
    const toggle = document.getElementById('pc-settings-toggle');
    const content = document.getElementById('pc-settings-content');
    const arrow = document.getElementById('pc-settings-arrow');
    if (toggle && content) {
      toggle.onclick = () => {
        const hidden = content.style.display === 'none';
        content.style.display = hidden ? '' : 'none';
        if (arrow) arrow.textContent = hidden ? '▲' : '▼';
      };
    }
  } else if (settingsPanel) {
    settingsPanel.innerHTML = '';
  }

  // Зум
  {
    let pcZoom = _pcZoomState.zoom;
    const pcSvg = document.getElementById('pc-svg');
    const pcLabel = document.getElementById('pc-zoom-label');
    const pcWrap = document.getElementById('pc-svg-wrap');
    const applyZoom = () => {
      if (pcSvg) { pcSvg.style.width = (totalW * pcZoom) + 'px'; pcSvg.style.height = (svgH * pcZoom) + 'px'; }
      if (pcLabel) pcLabel.textContent = Math.round(pcZoom * 100) + '%';
      _pcZoomState.zoom = pcZoom;
    };
    applyZoom();
    const zIn = document.getElementById('pc-zoom-in');
    const zOut = document.getElementById('pc-zoom-out');
    if (zIn) zIn.onclick = () => { pcZoom = Math.min(3, pcZoom * 1.25); applyZoom(); };
    if (zOut) zOut.onclick = () => { pcZoom = Math.max(0.3, pcZoom / 1.25); applyZoom(); };
  }

  // Fullscreen
  const fsBtn = document.getElementById('pc-fullscreen');
  const modalBox = body.closest('.modal-box');
  if (fsBtn && modalBox) {
    if (_pcZoomState.fullscreen) { modalBox.classList.add('modal-fullscreen'); fsBtn.textContent = '⤡'; }
    fsBtn.onclick = () => { modalBox.classList.toggle('modal-fullscreen'); _pcZoomState.fullscreen = modalBox.classList.contains('modal-fullscreen'); fsBtn.textContent = _pcZoomState.fullscreen ? '⤡' : '⤢'; };
  }

  // Клик по входным автоматам секций
  body.querySelectorAll('[data-sec-in-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, portStr] = el.dataset.secInToggle.split(':');
      const si = Number(siStr), port = Number(portStr);
      const sec = sections[si];
      if (!sec) return;
      if (!Array.isArray(sec.inputBreakerStates)) sec.inputBreakerStates = new Array(sec.inputs || 0).fill(true);
      while (sec.inputBreakerStates.length < (sec.inputs || 0)) sec.inputBreakerStates.push(true);
      // Блокировка: если секция имеет АВР в авто-режиме
      if ((sec.inputs || 1) > 1 && sec.switchMode !== 'manual' && sec.switchMode !== 'parallel') {
        flash('Вводные автоматы управляются АВР секции. Переключите в ручной режим.', 'error');
        return;
      }
      // Блокировка: если СВ к этой секции в авто-режиме — автоматика управляет вводами
      for (let ti = 0; ti < busTies.length; ti++) {
        const tie = busTies[ti];
        if (!tie.auto) continue;
        const [a, b] = tie.between;
        if (a === si || b === si) {
          flash('Вводные автоматы управляются автоматикой СВ. Переключите СВ в ручной режим.', 'error');
          return;
        }
      }
      const wantOn = !sec.inputBreakerStates[port];
      // Блокировка: при включении автомата — проверить что СВ к смежной секции
      // не соединит два источника
      if (wantOn) {
        for (let ti = 0; ti < busTies.length; ti++) {
          if (!tieStates[ti]) continue; // СВ разомкнут — ОК
          const [a, b] = busTies[ti].between;
          const otherSi = a === si ? b : (b === si ? a : -1);
          if (otherSi < 0) continue;
          const otherSec = sections[otherSi];
          if (!otherSec) continue;
          // Проверяем: есть ли у смежной секции включённые автоматы?
          const otherBrk = Array.isArray(otherSec.inputBreakerStates) ? otherSec.inputBreakerStates : [];
          const otherHasOn = Array.from({length: otherSec.inputs || 1}, (_, i) => otherBrk[i] !== false).some(Boolean);
          if (otherHasOn) {
            flash('Блокировка: СВ замкнут — сначала отключите СВ или вводные автоматы смежной секции!', 'error');
            return;
          }
        }
      }
      snapshot('sec-in:' + sec.id + ':' + port);
      sec.inputBreakerStates[port] = wantOn;
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Клик по выходным автоматам секций
  body.querySelectorAll('[data-sec-out-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, portStr] = el.dataset.secOutToggle.split(':');
      const si = Number(siStr), port = Number(portStr);
      const sec = sections[si];
      if (!sec) return;
      if (!Array.isArray(sec.breakerStates)) sec.breakerStates = new Array(sec.outputs || 0).fill(true);
      while (sec.breakerStates.length < (sec.outputs || 0)) sec.breakerStates.push(true);
      snapshot('sec-out:' + sec.id + ':' + port);
      sec.breakerStates[port] = !sec.breakerStates[port];
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Клик по СВ — с блокировкой
  body.querySelectorAll('[data-sec-tie-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const ti = Number(el.dataset.secTieToggle);
      const tie = busTies[ti];
      if (!tie) return;
      // Блокировка ручного управления в режиме Авто
      if (tie.auto) {
        flash('СВ в автоматическом режиме. Переключите в ручной для управления.', 'error');
        return;
      }
      const wantClose = !tieStates[ti];
      // Блокировка: СВ можно замкнуть только если ВСЕ вводные автоматы
      // хотя бы ОДНОЙ из смежных секций выключены
      if (wantClose) {
        const [siA, siB] = tie.between;
        const secA = sections[siA], secB = sections[siB];
        // Проверяем: все ли вводные автоматы секции выключены?
        const allBrkOff = (sec) => {
          if (!sec) return true;
          const brk = Array.isArray(sec.inputBreakerStates) ? sec.inputBreakerStates : [];
          for (let i = 0; i < (sec.inputs || 1); i++) {
            if (brk[i] !== false) return false; // автомат включён
          }
          return true; // все выключены
        };
        if (!allBrkOff(secA) && !allBrkOff(secB)) {
          flash('Блокировка: выключите все вводные автоматы одной из секций перед включением СВ!', 'error');
          return;
        }
      }
      snapshot('sec-tie:' + n.id + ':' + ti);
      n._busTieStates[ti] = wantClose;
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Переключатель Авто/Ручной для СВ (в settings panel)
  document.querySelectorAll('[data-tie-auto-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const ti = Number(el.dataset.tieAutoToggle);
      const tie = busTies[ti];
      if (!tie) return;
      snapshot('sec-tie-mode:' + n.id + ':' + ti);
      tie.auto = !tie.auto;
      // Сброс таймеров при переключении режима
      if (Array.isArray(n._busTieSwitchStartedAt)) {
        n._busTieSwitchStartedAt[ti] = 0;
        n._busTieSwitchCountdown[ti] = 0;
        n._busTieInterlockStartedAt[ti] = 0;
        n._busTieInterlockCountdown[ti] = 0;
        n._busTieDisconnected[ti] = false;
      }
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Приоритет ввод/СВ для секций (в settings panel)
  document.querySelectorAll('[data-sec-priority]').forEach(el => {
    el.addEventListener('click', () => {
      const [siStr, val] = el.dataset.secPriority.split(':');
      const sec = sections[Number(siStr)];
      if (!sec) return;
      snapshot('secPriority:' + sec.id);
      sec.sectionInputPriority = val;
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // АВР секций: Авто/Ручной toggle (в settings panel)
  document.querySelectorAll('[data-sec-avr-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const si = Number(el.dataset.secAvrToggle);
      const sec = sections[si];
      if (!sec) return;
      snapshot('sec-avr:' + sec.id);
      if (sec.switchMode === 'manual') {
        sec.switchMode = sec._prevSwitchMode || 'auto';
        sec.inputBreakerStates = null;
        sec._avrBreakerOverride = null;
        sec._avrActivePort = undefined;
        sec._avrSwitchStartedAt = 0;
        sec._avrDisconnected = false;
      } else {
        sec._prevSwitchMode = sec.switchMode;
        if (Array.isArray(sec._avrBreakerOverride)) {
          sec.inputBreakerStates = [...sec._avrBreakerOverride];
        } else {
          const states = new Array(sec.inputs || 0).fill(false);
          for (const c of state.conns.values()) {
            if (c.to.nodeId === sec.id && c._state === 'active') states[c.to.port] = true;
          }
          sec.inputBreakerStates = states;
        }
        sec.switchMode = 'manual';
      }
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  document.getElementById('modal-panel-control').classList.remove('hidden');
}

// Сохраняемое состояние зума модалки управления щитом
let _pcZoomState = { zoom: 1, fullscreen: false };

export function openPanelControlModal(n) {
  const body = document.getElementById('panel-control-body');
  if (!body) return;

  // Многосекционный щит — отдельный рендер
  if (n.switchMode === 'sectioned') {
    _renderSectionedPanelControl(n, body);
    return;
  }

  const inCount = n.inputs || 0;
  const outCount = n.outputs || 0;
  const isPlainPanel = n.switchMode === 'parallel';
  const isManual = n.switchMode === 'manual' || isPlainPanel;
  const hasAVR = !isPlainPanel;
  const colW = 90;
  const maxCols = Math.max(inCount, outCount, 1);
  const svgW = Math.max(maxCols * colW + 40, 300);
  const inBrkY = 30;   // начало автоматов входов
  const brkH = 28;
  const busY = inBrkY + brkH + 20;
  const outBrkY = busY + 20;
  const svgH = outBrkY + brkH + 80; // увеличено для вертикальных подписей

  // Состояние входов
  // В авто-режиме: АВР определяет какие входы замкнуты (по приоритетам/логике).
  // В ручном/щит: из inputBreakerStates.
  const inputStates = [];
  const inBreakers = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];

  // Определяем какие входы АВР считает активными (по связям active/powered)
  const avrActiveInputs = new Set();
  for (const c of state.conns.values()) {
    if (c.to.nodeId === n.id && (c._state === 'active')) {
      avrActiveInputs.add(c.to.port);
    }
  }

  for (let i = 0; i < inCount; i++) {
    let feederTag = '—', hasPower = false;
    for (const c of state.conns.values()) {
      if (c.to.nodeId === n.id && c.to.port === i) {
        const from = state.nodes.get(c.from.nodeId);
        feederTag = from ? (effectiveTag(from) || from.name || '?') : '?';
        hasPower = c._state === 'active' || c._state === 'powered';
        break;
      }
    }
    let breakerOn;
    if (isManual) {
      // Ручной/Щит: из inputBreakerStates
      breakerOn = inBreakers[i] !== false;
    } else {
      // Авто (АВР): из _avrBreakerOverride (симуляция) или active input
      if (Array.isArray(n._avrBreakerOverride) && typeof n._avrBreakerOverride[i] === 'boolean') {
        breakerOn = n._avrBreakerOverride[i];
      } else {
        breakerOn = avrActiveInputs.has(i);
      }
    }
    inputStates.push({ powered: hasPower, feederTag, breakerOn });
  }

  // Состояние выходов
  const outputStates = [];
  const outBreakers = Array.isArray(n.breakerStates) ? n.breakerStates : [];
  for (let i = 0; i < outCount; i++) {
    let destTag = '—', powered = false;
    for (const c of state.conns.values()) {
      if (c.from.nodeId === n.id && c.from.port === i) {
        const to = state.nodes.get(c.to.nodeId);
        destTag = to ? (effectiveTag(to) || to.name || '?') : '?';
        powered = c._state === 'active' || c._state === 'powered';
        break;
      }
    }
    const breakerOn = outBreakers[i] !== false;
    outputStates.push({ powered, destTag, breakerOn });
  }

  const busPowered = !n.maintenance && inputStates.some(s => s.powered && s.breakerOn);

  let h = '';
  h += `<h3 style="margin-top:0">${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`;

  // --- SVG однолинейная схема (зум в header, АВР toggle в settings panel) ---
  h += `<div id="pc-svg-wrap" style="display:flex;justify-content:center;align-items:flex-start;overflow:auto;flex:1">`;
  h += `<svg id="pc-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:sans-serif;font-size:10px">`;

  // Шина
  const busX1 = 15, busX2 = svgW - 15;
  const busColor = busPowered ? '#e53935' : '#bbb';
  h += `<rect x="${busX1}" y="${busY - 2}" width="${busX2 - busX1}" height="4" fill="${busColor}" rx="1"/>`;

  // Входы: линия сверху → автомат → шина
  for (let i = 0; i < inCount; i++) {
    const x = 20 + (i + 0.5) * ((svgW - 40) / Math.max(inCount, 1));
    const s = inputStates[i];
    const lineAlive = s.powered && !n.maintenance;
    const topColor = lineAlive ? '#e53935' : '#bbb';
    const throughColor = lineAlive && s.breakerOn ? '#e53935' : '#bbb';

    // Метка источника
    h += `<text x="${x}" y="12" text-anchor="middle" fill="#333" font-size="9" font-weight="600">${escHtml(s.feederTag)}</text>`;
    // Линия сверху до автомата
    h += `<line x1="${x}" y1="16" x2="${x}" y2="${inBrkY}" stroke="${topColor}" stroke-width="2"/>`;
    // Лампочка состояния ввода
    const lampY = 22;
    if (lineAlive && s.breakerOn) {
      // Зелёная — запитан и замкнут
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="#43a047" opacity="0.8"/>`;
    } else if (lineAlive) {
      // Красная — есть напряжение, но разомкнут
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="#e53935" opacity="0.8"/>`;
    } else {
      // Серая — нет напряжения
      h += `<circle cx="${x}" cy="${lampY}" r="4" fill="none" stroke="#ccc" stroke-width="1"/>`;
    }
    // Автомат входа (IEC)
    const brk = svgBreaker(x, inBrkY, s.breakerOn, throughColor, '#ff9800');
    h += brk.svg;
    // Линия от автомата до шины
    h += `<line x1="${x}" y1="${inBrkY + brkH}" x2="${x}" y2="${busY - 2}" stroke="${throughColor}" stroke-width="2"/>`;
    // Кликабельная зона автомата входа:
    // - Щит без АВР: всегда кликабельно
    // - АВР ручной режим: кликабельно (с блокировкой приоритетов)
    // - АВР авто: НЕ кликабельно (управляет АВР)
    // - 1 вход: всегда кликабельно (нечего переключать)
    const inputClickable = isManual || inCount <= 1;
    if (inputClickable) {
      h += `<rect x="${x - 14}" y="${inBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-in-breaker-toggle="${i}"/>`;
    }
    // Приоритет
    const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
    h += `<text x="${x + 12}" y="${inBrkY + brkH / 2 + 3}" fill="#1976d2" font-size="8">P${prio}</text>`;
  }

  // Выходы: шина → автомат → линия вниз
  for (let i = 0; i < outCount; i++) {
    const x = 20 + (i + 0.5) * ((svgW - 40) / Math.max(outCount, 1));
    const s = outputStates[i];
    const on = s.breakerOn;
    const powered = busPowered && on;
    const busCol = busPowered ? '#e53935' : '#bbb';
    const lineCol = powered ? '#e53935' : '#bbb';

    // Линия шина → автомат
    h += `<line x1="${x}" y1="${busY + 2}" x2="${x}" y2="${outBrkY}" stroke="${busCol}" stroke-width="2"/>`;
    // Автомат выхода (IEC)
    const brk = svgBreaker(x, outBrkY, on, lineCol, '#ff9800');
    h += brk.svg;
    // Подпись номинала автомата (слева от автомата)
    {
      let brkLabel = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === n.id && cc.from.port === i) {
          if (cc._breakerIn) {
            const cnt = cc._breakerCount || 1;
            if (cnt > 1 && cc._breakerPerLine) brkLabel = `${cnt}×${cc._breakerPerLine}А`;
            else brkLabel = `${cc._breakerIn}А`;
          } else if (cc._breakerPerLine) {
            const cnt = cc._breakerCount || 1;
            brkLabel = cnt > 1 ? `${cnt}×${cc._breakerPerLine}А` : `${cc._breakerPerLine}А`;
          }
          break;
        }
      }
      if (brkLabel) {
        h += `<text x="${x - 12}" y="${outBrkY + brkH/2}" fill="#ef6c00" font-size="8" font-weight="600" text-anchor="end" dominant-baseline="central">${brkLabel}</text>`;
      }
    }
    // Линия от автомата вниз
    h += `<line x1="${x}" y1="${outBrkY + brkH}" x2="${x}" y2="${outBrkY + brkH + 14}" stroke="${lineCol}" stroke-width="2"/>`;
    // Метка назначения / "Резерв"
    let outLabel;
    let labelColor = '#333';
    if (s.destTag === '—') {
      outLabel = 'Резерв';
      labelColor = '#bbb';
    } else {
      let inPortNum = '';
      for (const cc of state.conns.values()) {
        if (cc.from.nodeId === n.id && cc.from.port === i) {
          inPortNum = `-${cc.to.port + 1}`;
          break;
        }
      }
      outLabel = s.destTag + inPortNum;
    }
    const labelY = outBrkY + brkH + 16;
    h += `<text x="${x}" y="${labelY}" fill="${labelColor}" font-size="9" font-weight="600" text-anchor="end" dominant-baseline="central" transform="rotate(-90 ${x} ${labelY})">${escHtml(outLabel)}</text>`;
    // Кликабельная зона
    h += `<rect x="${x - 14}" y="${outBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-breaker-toggle="${i}"/>`;
  }

  h += `</svg></div>`;

  body.innerHTML = h;

  // Настройки простого щита — в settings panel
  {
    const sp = document.getElementById('pc-settings-panel');
    let sh2 = '';
    if (inCount > 1 && hasAVR) {
      const manualNow = n.switchMode === 'manual';
      sh2 += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">';
      sh2 += `<span style="font-size:11px;font-weight:600;color:#666">АВР:</span>`;
      sh2 += `<span style="font-size:11px;color:${!manualNow ? '#4caf50;font-weight:600' : '#999'}">Авто</span>`;
      sh2 += `<div id="pc-toggle" style="position:relative;width:44px;height:22px;border-radius:11px;background:${manualNow ? '#ff9800' : '#4caf50'};cursor:pointer;flex-shrink:0">`;
      sh2 += `<div style="position:absolute;top:2px;${manualNow ? 'right:2px' : 'left:2px'};width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
      sh2 += '</div>';
      sh2 += `<span style="font-size:11px;color:${manualNow ? '#e65100;font-weight:600' : '#999'}">Ручной</span>`;
      sh2 += '</div>';
      if (n._avrSwitchCountdown > 0) {
        sh2 += `<div style="font-size:11px;color:#1976d2;font-weight:600;margin:2px 0">Задержка ${Math.ceil(n._avrSwitchCountdown)} с</div>`;
      } else if (n._avrInterlockCountdown > 0) {
        sh2 += `<div style="font-size:11px;color:#ff9800;font-weight:600;margin:2px 0">Разбежка ${Math.ceil(n._avrInterlockCountdown)} с</div>`;
      }
    }
    if (sp && sh2) {
      sp.innerHTML = `<div style="width:240px;border:1px solid #d0d0d0;border-radius:8px;background:rgba(255,255,255,0.92);backdrop-filter:blur(6px);box-shadow:0 2px 12px rgba(0,0,0,0.1)">` +
        `<div id="pc-settings-toggle" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;user-select:none">` +
        `<span style="font-size:12px;font-weight:700;color:#444">⚙ Настройки</span>` +
        `<span style="font-size:12px;color:#999" id="pc-settings-arrow">▲</span></div>` +
        `<div id="pc-settings-content" style="padding:4px 12px 10px;border-top:1px solid #eee">${sh2}</div></div>`;
      const toggle = document.getElementById('pc-settings-toggle');
      const content = document.getElementById('pc-settings-content');
      const arrow = document.getElementById('pc-settings-arrow');
      if (toggle && content) {
        toggle.onclick = () => { const h = content.style.display === 'none'; content.style.display = h ? '' : 'none'; if (arrow) arrow.textContent = h ? '▲' : '▼'; };
      }
    } else if (sp) {
      sp.innerHTML = '';
    }
  }

  // Зум однолинейной схемы — восстанавливаем сохранённый зум
  {
    let pcZoom = _pcZoomState.zoom;
    const pcSvg = document.getElementById('pc-svg');
    const pcLabel = document.getElementById('pc-zoom-label');
    const pcWrap = document.getElementById('pc-svg-wrap');
    const applyZoom = () => {
      if (pcSvg) {
        pcSvg.style.width = (svgW * pcZoom) + 'px';
        pcSvg.style.height = (svgH * pcZoom) + 'px';
      }
      if (pcLabel) pcLabel.textContent = Math.round(pcZoom * 100) + '%';
      _pcZoomState.zoom = pcZoom;
    };
    applyZoom(); // применить сохранённый зум сразу
    const zoomIn = document.getElementById('pc-zoom-in');
    const zoomOut = document.getElementById('pc-zoom-out');
    if (zoomIn) zoomIn.onclick = () => { pcZoom = Math.min(3, pcZoom * 1.25); applyZoom(); };
    if (zoomOut) zoomOut.onclick = () => { pcZoom = Math.max(0.3, pcZoom / 1.25); applyZoom(); };
    if (pcWrap) pcWrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pcZoom = e.deltaY < 0 ? Math.min(3, pcZoom * 1.1) : Math.max(0.3, pcZoom / 1.1);
      applyZoom();
    }, { passive: false });
  }

  // Fullscreen toggle — восстанавливаем сохранённое состояние
  const fsBtn = document.getElementById('pc-fullscreen');
  const modalBox = body.closest('.modal-box');
  if (fsBtn && modalBox) {
    if (_pcZoomState.fullscreen) {
      modalBox.classList.add('modal-fullscreen');
      fsBtn.textContent = '⤡';
    }
    fsBtn.onclick = () => {
      modalBox.classList.toggle('modal-fullscreen');
      _pcZoomState.fullscreen = modalBox.classList.contains('modal-fullscreen');
      fsBtn.textContent = _pcZoomState.fullscreen ? '⤡' : '⤢';
    };
  }

  // Автоматы выходов
  body.querySelectorAll('[data-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      snapshot('breaker:' + n.id);
      const idx = Number(el.dataset.breakerToggle);
      if (!Array.isArray(n.breakerStates)) n.breakerStates = new Array(outCount).fill(true);
      while (n.breakerStates.length < outCount) n.breakerStates.push(true);
      n.breakerStates[idx] = !n.breakerStates[idx];
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Автоматы входов
  body.querySelectorAll('[data-in-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.inBreakerToggle);
      if (!Array.isArray(n.inputBreakerStates)) n.inputBreakerStates = new Array(inCount).fill(true);
      while (n.inputBreakerStates.length < inCount) n.inputBreakerStates.push(true);

      const wantOn = !n.inputBreakerStates[idx];

      // Блокировка для АВР в ручном режиме: нельзя включить автомат
      // другого приоритета пока текущий не выключен
      if (hasAVR && n.switchMode === 'manual' && wantOn) {
        const priorities = Array.isArray(n.priorities) ? n.priorities : [];
        const myPrio = priorities[idx] ?? (idx + 1);
        // Проверяем: есть ли включённый автомат с ДРУГИМ приоритетом?
        for (let i = 0; i < inCount; i++) {
          if (i === idx) continue;
          if (n.inputBreakerStates[i]) {
            const otherPrio = priorities[i] ?? (i + 1);
            if (otherPrio !== myPrio) {
              flash('Блокировка: сперва выключите другой ввод (P' + otherPrio + ')');
              return;
            }
          }
        }
      }

      snapshot('in-breaker:' + n.id);
      n.inputBreakerStates[idx] = wantOn;
      // Для АВР: сбросить _avrBreakerOverride при ручном переключении
      if (n.switchMode === 'manual') {
        n._avrBreakerOverride = [...n.inputBreakerStates];
      }
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  });

  // Переключатель Авто / Ручной (toggle)
  const toggleEl = document.getElementById('pc-toggle');
  if (toggleEl) {
    toggleEl.addEventListener('click', () => {
      snapshot('mode:' + n.id);
      if (n.switchMode === 'manual') {
        n.switchMode = n._prevSwitchMode || 'auto';
        // Сброс — АВР управляет автоматами
        n.inputBreakerStates = null;
        n._avrBreakerOverride = null;
        n._avrActivePort = undefined;
        n._avrSwitchStartedAt = 0;
        n._avrDisconnected = false;
      } else {
        n._prevSwitchMode = n.switchMode;
        // Копируем текущее состояние автоматов АВР в ручное управление
        // чтобы при переключении ничего не менялось
        if (Array.isArray(n._avrBreakerOverride)) {
          n.inputBreakerStates = [...n._avrBreakerOverride];
        } else {
          // Определяем из текущих active связей
          const states = new Array(n.inputs || 0).fill(false);
          for (const c of state.conns.values()) {
            if (c.to.nodeId === n.id && c._state === 'active') {
              states[c.to.port] = true;
            }
          }
          n.inputBreakerStates = states;
        }
        n.switchMode = 'manual';
      }
      _render(); notifyChange();
      openPanelControlModal(n);
    });
  }

  // Обслуживание
  const maintCb = document.getElementById('pc-maintenance');
  if (maintCb) {
    maintCb.addEventListener('change', () => {
      snapshot('maint:' + n.id);
      n.maintenance = maintCb.checked;
      _render(); renderInspector(); notifyChange();
      openPanelControlModal(n);
    });
  }

  // +/- входы/выходы (с проверкой подключений)
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  function hasConnOnPort(nodeId, kind, port) {
    for (const c of state.conns.values()) {
      if (kind === 'in' && c.to.nodeId === nodeId && c.to.port === port) return true;
      if (kind === 'out' && c.from.nodeId === nodeId && c.from.port === port) return true;
    }
    return false;
  }

  // Закрыть
  const applyBtn = document.getElementById('panel-control-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      _render(); notifyChange();
      openPanelControlModal(n); // перерисовать модалку с актуальным состоянием
    };
  }

  document.getElementById('modal-panel-control').classList.remove('hidden');
}

// Возвращает inline SVG строку для иконки способа прокладки (для инспектора)
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
// Блок статуса для источников и генераторов
export function sourceStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) parts.push('<span class="badge off">отключён</span>');
  else {
    const pct = (Number(n.capacityKw) || 0) > 0 ? Math.round((n._loadKw || 0) / n.capacityKw * 100) : 0;
    parts.push(n._overload ? '<span class="badge off">перегруз</span>' : '<span class="badge on">в работе</span>');
    // Максимальная расчётная нагрузка (все потребители 100%)
    if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
    // Текущая нагрузка (в текущем режиме/сценарии)
    parts.push(`<b>Текущая:</b> ${fmt(n._powerP || n._loadKw || 0)} kW · ${fmt(n._loadA || 0)} A <span class="muted">(${pct}%)</span>`);
    if (n._powerQ) parts.push(`Q реакт.: <b>${fmt(n._powerQ)} kvar</b>`);
    if (n._powerS) parts.push(`S полн.: <b>${fmt(n._powerS)} kVA</b>`);
    if (n._cosPhi) parts.push(`cos φ: <b>${n._cosPhi.toFixed(2)}</b>`);
    if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на шинах: <b>${fmt(n._ikA / 1000)} кА</b>`);
    if (n._deltaUPct > 0) parts.push(`ΔU: <b>${n._deltaUPct.toFixed(2)}%</b>`);
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
export function panelStatusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">запитан</span>');
  else parts.push('<span class="badge off">без питания</span>');
  // Максимальная расчётная нагрузка
  if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
  // Текущая нагрузка
  parts.push(`<b>Текущая:</b> ${fmt(n._powerP || 0)} kW · ${fmt(n._loadA || 0)} A`);
  parts.push(`Q реакт.: ${fmt(n._powerQ || 0)} kvar · S полн.: ${fmt(n._powerS || 0)} kVA`);
  if (Number(n.kSim) && Number(n.kSim) !== 1) {
    parts.push(`расчётная с Ксим: <b>${fmt(n._calcKw || 0)} kW</b>`);
  }
  if (n._cosPhi) parts.push(`cos φ итог: <b>${n._cosPhi.toFixed(2)}</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik (ток КЗ): <b>${fmt(n._ikA / 1000)} кА</b>`);
  if (n._deltaUPct > 0) parts.push(`ΔU суммарный: <b>${n._deltaUPct.toFixed(2)}%</b>${n._deltaUPct > 5 ? ' ⚠ > 5%' : ''}`);

  // Запас номинала шкафа — сравниваем с максимальным током.
  if (Number(n.capacityA) > 0) {
    const capA = Number(n.capacityA);
    const maxA = n._maxLoadA || 0;
    parts.push(`номинал: <b>${fmt(capA)} A</b>, макс.ток: <b>${fmt(maxA)} A</b>`);
    if (maxA > 0) {
      const pct = n._marginPct == null ? 0 : n._marginPct;
      const pctTxt = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      if (n._marginWarn === 'undersize') {
        parts.push(`запас: <b style="color:#c62828">${pctTxt}</b> ⚠ перегруз (номинал ниже макс.тока)`);
      } else if (n._marginWarn === 'oversize') {
        parts.push(`запас: <b style="color:#8e24aa">${pctTxt}</b> ⚠ избыточен (макс. ${n.marginMaxPct}%)`);
      } else {
        parts.push(`запас: <b style="color:#2e7d32">${pctTxt}</b> ок`);
      }
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
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

export function upsStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) {
    parts.push('<span class="badge off">отключён</span>');
  } else if (!n._powered) {
    parts.push('<span class="badge off">без питания</span>');
  } else if (n._onStaticBypass) {
    parts.push('<span class="badge backup">статический байпас</span>');
    parts.push(`<span class="muted">инвертор выключен, реактивная мощность потребителей идёт сквозь ИБП</span>`);
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    parts.push(`на входе: <b>${fmt(n._inputKw)} kW</b> (без потерь)`);
  } else {
    parts.push(n._onBattery
      ? '<span class="badge backup">работа от батареи</span>'
      : '<span class="badge on">работа от сети</span>');
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    if (!n._onBattery) parts.push(`потребление на входе: <b>${fmt(n._inputKw)} kW</b>`);
  }
  // Номинальный ток на выходе
  const capA = computeCurrentA(n.capacityKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`<b>Номинальный ток: ${fmt(capA)} A</b> (при ${fmt(n.capacityKw)} kW, cos φ = 1)`);

  // P/Q/S — как его видит вышестоящая сеть
  if (typeof n._powerP === 'number') {
    parts.push(`P акт.: <b>${fmt(n._powerP)} kW</b>`);
    parts.push(`Q реакт.: <b>${fmt(n._powerQ || 0)} kvar</b> ${n._onStaticBypass ? '' : '<span class="muted">(инвертор — 0)</span>'}`);
    parts.push(`S полн.: <b>${fmt(n._powerS || 0)} kVA</b>`);
    parts.push(`cos φ: <b>${n._cosPhi ? n._cosPhi.toFixed(2) : '1.00'}</b> ${n._onStaticBypass ? '<span class="muted">(байпас)</span>' : '<span class="muted">(инвертор)</span>'}`);
  }
  // Потребление на входе (от сети): макс. = capacityKw/eff + chargeKw
  const maxInputKw = Number(n.capacityKw) / Math.max(0.01, (Number(n.efficiency) || 100) / 100) + upsChargeKw(n);
  const maxInputA = computeCurrentA(maxInputKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`макс. потребление на входе: <b>${fmt(maxInputKw)} kW · ${fmt(maxInputA)} A</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на выходе: <b>${fmt(n._ikA / 1000)} кА</b>`);
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
    h.push('<h4 style="margin:12px 0 6px;font-size:12px">Проводник</h4>');
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
