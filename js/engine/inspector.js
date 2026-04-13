import { state, svg, inspectorBody } from './state.js';
import { GLOBAL, DEFAULTS, CHANNEL_TYPES, CABLE_TYPES, NODE_H } from './constants.js';
import { escHtml, escAttr, fmt, field, checkField, flash } from './utils.js';
import { nodeVoltage, isThreePhase, computeCurrentA, upsChargeKw, sourceImpedance, nodeWireCount } from './electrical.js';
import { nodeInputCount, nodeOutputCount, nodeWidth } from './geometry.js';
import { effectiveOn, setEffectiveOn, effectiveLoadFactor, setEffectiveLoadFactor } from './modes.js';
import { snapshot, notifyChange } from './history.js';
import { clampPortsInvolvingNode } from './graph.js';
import { panelCosPhi, downstreamPQ } from './recalc.js';
import { effectiveTag, findZoneForMember, nodesInZone, maxOccupiedPort } from './zones.js';

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

export function renderInspector() {
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
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

    const ct = n.channelType || 'conduit';
    const ctOpts = Object.keys(CHANNEL_TYPES).map(key => {
      const sel = ct === key ? ' selected' : '';
      return `<option value="${key}"${sel}>${escHtml(CHANNEL_TYPES[key].label)}</option>`;
    }).join('');
    h.push(field('Тип канала', `<select data-prop="channelType">${ctOpts}</select>`));

    const bd = n.bundling || CHANNEL_TYPES[ct]?.bundlingDefault || 'touching';
    h.push(field('Расположение кабелей',
      `<select data-prop="bundling">
        <option value="spaced"${bd === 'spaced' ? ' selected' : ''}>С зазором ≥ Ø кабеля</option>
        <option value="touching"${bd === 'touching' ? ' selected' : ''}>Плотно друг к другу</option>
        <option value="bundled"${bd === 'bundled' ? ' selected' : ''}>В пучке / жгуте</option>
      </select>`));
    // SVG-иконка расположения кабелей
    h.push('<div style="text-align:center;margin:6px 0 10px"><svg width="120" height="36" viewBox="0 0 120 36">');
    if (bd === 'spaced') {
      // С зазором: кабели на расстоянии ≥ Ø друг от друга
      h.push('<circle cx="20" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="60" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="100" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Стрелка зазора
      h.push('<line x1="28" y1="8" x2="52" y2="8" stroke="#1976d2" stroke-width="0.8" marker-start="url(#arr)" marker-end="url(#arr)"/>');
      h.push('<text x="40" y="6" text-anchor="middle" fill="#1976d2" font-size="7">≥Ø</text>');
    } else if (bd === 'touching') {
      // Плотно: кабели касаются друг друга
      h.push('<circle cx="42" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="58" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="74" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Жилы
      h.push('<circle cx="42" cy="18" r="2.5" fill="#555"/>');
      h.push('<circle cx="58" cy="18" r="2.5" fill="#555"/>');
      h.push('<circle cx="74" cy="18" r="2.5" fill="#555"/>');
    } else {
      // В пучке: кабели связаны вместе
      h.push('<ellipse cx="60" cy="18" rx="22" ry="14" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="3 2"/>');
      h.push('<circle cx="50" cy="14" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="66" cy="14" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="58" cy="24" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Жилы
      h.push('<circle cx="50" cy="14" r="2" fill="#555"/>');
      h.push('<circle cx="66" cy="14" r="2" fill="#555"/>');
      h.push('<circle cx="58" cy="24" r="2" fill="#555"/>');
    }
    h.push('</svg></div>');
    h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">«С зазором» — группировка не учитывается. «Плотно» — базовый K_group. «В пучке» — дополнительное понижение ×0.85.</div>');

    h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-prop="ambientC" value="${n.ambientC || 30}">`));
    h.push(field('Длина канала, м', `<input type="number" min="0" max="10000" step="1" data-prop="lengthM" value="${n.lengthM || 0}">`));

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
    const typeInfo = CHANNEL_TYPES[ct] || CHANNEL_TYPES.conduit;
    h.push(`<div class="inspector-section">` +
      `<div style="display:flex;gap:12px;justify-content:center;margin:8px 0">${channelIconSVG(ct, 56)}${bundlingIconSVG(bd, 56)}</div>` +
      `<div class="muted" style="font-size:11px;line-height:1.8">` +
      `Метод прокладки по IEC: <b>${typeInfo.method}</b><br>` +
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
        h.push(`<div style="padding:3px 0;border-bottom:1px solid #eee">`);
        h.push(`<b>${escHtml(lineLabel)}</b>${countLabel}<br>`);
        h.push(`<span style="color:#666">${cable} · ${length} · Imax: ${current}</span>`);
        h.push(`</div>`);
      }
      h.push('</div></details>');
    }

    h.push(field('Комментарии', `<textarea data-prop="comment" rows="3" style="width:100%;font-size:12px;resize:vertical">${escHtml(n.comment || '')}</textarea>`));
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

  if (n.type === 'source' || n.type === 'generator') {
    const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    h.push(field('Тип источника',
      `<select data-prop="sourceSubtype">
        <option value="transformer"${subtype === 'transformer' ? ' selected' : ''}>Трансформатор</option>
        <option value="generator"${subtype === 'generator' ? ' selected' : ''}>Генератор (ДГУ / ДЭС)</option>
      </select>`));
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
    // Кнопки управления
    h.push(`<button class="full-btn" id="btn-open-panel-control" style="margin-bottom:4px">🔌 Управление щитом</button>`);
    h.push(`<button class="full-btn" id="btn-open-panel-params" style="margin-bottom:8px">⚙ Параметры щита</button>`);

    if (n.maintenance) {
      h.push('<div style="background:#fff3e0;border:1px solid #ffb74d;border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px;font-weight:600;color:#e65100">⚠ ЩИТ В РЕЖИМЕ ОБСЛУЖИВАНИЯ — ОБЕСТОЧЕН</div>');
    }

    // Краткая сводка
    const sm = n.switchMode || 'auto';
    const smLabel = { auto: 'АВР', manual: 'Ручной', parallel: 'Щит', avr_paired: 'АВР привязка', switchover: 'Подменный', watchdog: 'Watchdog' }[sm] || sm;
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      `Режим: <b>${smLabel}</b> · Вх: <b>${n.inputs}</b> · Вых: <b>${n.outputs}</b> · In: <b>${n.capacityA ?? 160} А</b>` +
      `</div>`);

    // Ксим перенесён в параметры щита

    h.push(`<button type="button" class="full-btn" id="btn-balance-panel" style="margin-top:8px">⚖ Балансировка фаз на щите</button>`);
    h.push(panelStatusBlock(n));
  } else if (n.type === 'ups') {
    h.push(`<button class="full-btn" id="btn-open-ups-params" style="margin-bottom:8px">⚙ Параметры ИБП</button>`);
    // Краткая сводка
    const battPct = Math.round(n.batteryChargePct || 0);
    h.push(`<div class="muted" style="font-size:11px;line-height:1.6;margin-bottom:8px">` +
      `Pном: <b>${fmt(n.capacityKw)} kW</b> · КПД: <b>${n.efficiency || 100}%</b> · АКБ: <b>${fmt(n.batteryKwh || 0)} kWh (${battPct}%)</b>` +
      `</div>`);
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(`<button class="full-btn" id="btn-open-consumer-params" style="margin-bottom:8px">⚙ Параметры потребителя</button>`);
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

  // Полный дамп параметров узла
  h.push(renderFullPropsBlock(n));

  inspectorBody.innerHTML = h.join('');

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
      }
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      _render();
      notifyChange();
      // Перерисовать инспектор при изменениях, от которых зависят другие поля
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId' || prop === 'sourceSubtype' || prop === 'channelType' || prop === 'bundling') {
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
      // Жадный алгоритм: сортируем по мощности ↓, назначаем на наименее нагруженную фазу
      const load = { A: 0, B: 0, C: 0 };
      // Сначала учтём 3ф нагрузки
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== n.id) continue;
        const to = state.nodes.get(c.to.nodeId);
        if (!to || to.type !== 'consumer' || (to.phase || '3ph') !== '3ph') continue;
        const kw = (Number(to.demandKw) || 0) * Math.max(1, Number(to.count) || 1);
        load.A += kw/3; load.B += kw/3; load.C += kw/3;
      }
      // Сортируем однофазных по убыванию мощности
      singlePhase.sort((a, b) => {
        const ka = (Number(a.demandKw)||0) * Math.max(1, Number(a.count)||1);
        const kb = (Number(b.demandKw)||0) * Math.max(1, Number(b.count)||1);
        return kb - ka;
      });
      for (const cons of singlePhase) {
        const kw = (Number(cons.demandKw) || 0) * Math.max(1, Number(cons.count) || 1);
        const min = Math.min(load.A, load.B, load.C);
        if (load.A === min) { cons.phase = 'A'; load.A += kw; }
        else if (load.B === min) { cons.phase = 'B'; load.B += kw; }
        else { cons.phase = 'C'; load.C += kw; }
      }
      _render(); renderInspector(); notifyChange();
      flash(`Баланс: A:${fmt(load.A)} B:${fmt(load.B)} C:${fmt(load.C)} kW`);
    });
  }

  // Фазные кнопки для потребителя
  inspectorBody.querySelectorAll('[data-phase-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      snapshot('phase:' + n.id);
      n.phase = btn.dataset.phaseBtn;
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
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Номинальные параметры источника и данные для расчёта тока КЗ по IEC 60909.</div>');

  // === Номинальные параметры ===
  h.push('<h4 style="margin:16px 0 8px">Номинальные параметры</h4>');
  h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));

  // Выходное напряжение (вторичная обмотка для трансформатора)
  const outIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  h.push(field(isTransformer ? 'Выходное напряжение (вторичная обмотка)' : 'Выходное напряжение',
    `<select id="imp-voltage-out">${voltageLevelOptions(outIdx, null)}</select>`));

  // Входное напряжение (первичная обмотка) — только для трансформатора
  if (isTransformer) {
    const inIdx = (typeof n.inputVoltageLevelIdx === 'number') ? n.inputVoltageLevelIdx : (() => {
      // По умолчанию ищем 10kV в справочнике
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
  h.push(field('Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="1" max="10000" step="1" value="${n.sscMva ?? 500}">`));
  h.push(field('Напряжение КЗ трансформатора (Uk), %', `<input type="number" id="imp-uk" min="0" max="25" step="0.5" value="${n.ukPct ?? 6}">`));
  h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));

  // Потери трансформатора (только для трансформатора)
  if (isTransformer) {
    h.push('<h4 style="margin:16px 0 8px">Потери трансформатора</h4>');
    h.push(field('Потери КЗ (Pk), кВт', `<input type="number" id="imp-pk" min="0" max="100" step="0.1" value="${n.pkW ?? 6}">`));
    h.push(field('Потери ХХ (P0), кВт', `<input type="number" id="imp-p0" min="0" max="50" step="0.1" value="${n.p0W ?? 1.5}">`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Pk — потери короткого замыкания (нагрев обмоток при номинальном токе).<br>P0 — потери холостого хода (нагрев магнитопровода).</div>');
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

  const applyBtn = document.getElementById('impedance-apply');
  if (applyBtn) applyBtn.onclick = () => {
    snapshot('impedance:' + n.id);
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
    n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 500;
    n.ukPct = Number(document.getElementById('imp-uk')?.value) || 0;
    n.xsRsRatio = Number(document.getElementById('imp-xsrs')?.value) || 10;
    if (isTransformer) {
      n.pkW = Number(document.getElementById('imp-pk')?.value) || 0;
      n.p0W = Number(document.getElementById('imp-p0')?.value) || 0;
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
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Количество в группе', `<input type="number" id="cp-count" min="1" max="999" step="1" value="${n.count || 1}">`));
  h.push(field((n.count || 1) > 1 ? 'Мощность каждого, kW' : 'Установленная мощность, kW',
    `<input type="number" id="cp-demandKw" min="0" step="0.1" value="${n.demandKw}">`));

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
  h.push(field('Входов', `<input type="number" id="cp-inputs" min="1" max="10" step="1" value="${n.inputs}">`));

  body.innerHTML = h.join('');
  const applyBtn = document.getElementById('consumer-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    snapshot('consumer-params:' + n.id);
    n.count = Number(document.getElementById('cp-count')?.value) || 1;
    n.demandKw = Number(document.getElementById('cp-demandKw')?.value) || 0;
    const vIdx = Number(document.getElementById('cp-voltage')?.value) || 0;
    n.voltageLevelIdx = vIdx;
    if (levels[vIdx]) { n.voltage = levels[vIdx].vLL; n.phase = levels[vIdx].phases === 3 ? '3ph' : '1ph'; }
    n.cosPhi = Number(document.getElementById('cp-cosPhi')?.value) || 0.92;
    n.kUse = Number(document.getElementById('cp-kUse')?.value) ?? 1;
    n.inrushFactor = Number(document.getElementById('cp-inrush')?.value) || 1;
    n.inputs = Number(document.getElementById('cp-inputs')?.value) || 1;
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
    snapshot('ups-params:' + n.id);
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
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);

  // Входы / Выходы — в ряд
  h.push('<div style="display:flex;gap:12px">');
  h.push('<div style="flex:1">' + field('Входов', `<input type="number" id="pp-inputs" min="1" max="30" step="1" value="${n.inputs}">`) + '</div>');
  h.push('<div style="flex:1">' + field('Выходов', `<input type="number" id="pp-outputs" min="1" max="30" step="1" value="${n.outputs}">`) + '</div>');
  h.push('</div>');

  // Ксим + Номинал — в ряд
  h.push('<div style="display:flex;gap:12px">');
  h.push('<div style="flex:1">' + field('Ксим', `<input type="number" id="pp-kSim" min="0" max="1.2" step="0.05" value="${n.kSim ?? 1}">`) + '</div>');
  h.push('<div style="flex:1">' + field('In, А', `<input type="number" id="pp-capacityA" min="0" step="1" value="${n.capacityA ?? 160}">`) + '</div>');
  h.push('</div>');
  if (n._capacityKwFromA) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:-8px;margin-bottom:10px">Эквивалент: <b>${fmt(n._capacityKwFromA)} kW</b></div>`);
  }

  // Запасы — в ряд
  h.push('<div style="display:flex;gap:12px">');
  h.push('<div style="flex:1">' + field('Мин. запас, %', `<input type="number" id="pp-marginMin" min="0" max="50" step="1" value="${n.marginMinPct ?? 2}">`) + '</div>');
  h.push('<div style="flex:1">' + field('Макс. запас, %', `<input type="number" id="pp-marginMax" min="5" max="500" step="1" value="${n.marginMaxPct ?? 30}">`) + '</div>');
  h.push('</div>');

  // Режим коммутации
  {
    h.push('<h4 style="margin:16px 0 8px">Режим коммутации</h4>');
    const sm = n.switchMode || 'auto';
    const multiInput = (n.inputs || 0) > 1;
    let smOpts = `<option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Щит (без АВР) — ручное управление</option>`;
    if (multiInput) {
      smOpts += `<option value="auto"${sm === 'auto' ? ' selected' : ''}>АВР автоматический</option>`;
      smOpts += `<option value="avr_paired"${sm === 'avr_paired' ? ' selected' : ''}>АВР с привязкой выходов к входам</option>`;
      smOpts += `<option value="switchover"${sm === 'switchover' ? ' selected' : ''}>Подменный (switchover)</option>`;
      smOpts += `<option value="watchdog"${sm === 'watchdog' ? ' selected' : ''}>Watchdog</option>`;
    }
    h.push(field('Тип', `<select id="pp-switchMode">${smOpts}</select>`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-4px;margin-bottom:8px">Щит без АВР: все автоматы управляются только вручную. АВР: автоматическое переключение по приоритетам.</div>');

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

      // Задержки — для всех АВР
      h.push('<h4 style="margin:12px 0 8px">Задержки</h4>');
      h.push('<div style="display:flex;gap:12px">');
      h.push('<div style="flex:1">' + field('Переключение, сек', `<input type="number" id="pp-avrDelay" min="0" max="30" step="0.5" value="${n.avrDelaySec ?? 2}">`) + '</div>');
      h.push('<div style="flex:1">' + field('Разбежка, сек', `<input type="number" id="pp-avrInterlock" min="0" max="10" step="0.5" value="${n.avrInterlockSec ?? 1}">`) + '</div>');
      h.push('</div>');
      h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Переключение — задержка при возврате напряжения. Разбежка — интервал между автоматами.</div>');
    } // end hasAVR
  }

  body.innerHTML = h.join('');

  // Live: переключение типа АВР сразу применяется
  const smSel = document.getElementById('pp-switchMode');
  if (smSel) {
    smSel.addEventListener('change', () => {
      snapshot('switchMode:' + n.id);
      n.switchMode = smSel.value;
      _render(); renderInspector(); notifyChange();
      openPanelParamsModal(n);
    });
  }

  const applyBtn = document.getElementById('panel-params-apply');
  if (applyBtn) applyBtn.onclick = () => {
    snapshot('panel-params:' + n.id);
    n.inputs = Number(document.getElementById('pp-inputs')?.value) || 1;
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
    _render(); renderInspector(); notifyChange();
    openPanelParamsModal(n); // перерисовать с актуальными данными
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

export function openPanelControlModal(n) {
  const body = document.getElementById('panel-control-body');
  if (!body) return;

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
  const svgH = outBrkY + brkH + 50;

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

  // --- SVG однолинейная схема ---
  h += `<div style="text-align:center;overflow-x:auto;padding:10px 0">`;
  h += `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:sans-serif;font-size:10px">`;

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
    // Линия от автомата вниз
    h += `<line x1="${x}" y1="${outBrkY + brkH}" x2="${x}" y2="${svgH - 16}" stroke="${lineCol}" stroke-width="2"/>`;
    // Метка назначения
    h += `<text x="${x}" y="${svgH - 4}" text-anchor="middle" fill="#333" font-size="9" font-weight="600">${escHtml(s.destTag)}</text>`;
    // Кликабельная зона
    h += `<rect x="${x - 14}" y="${outBrkY - 2}" width="28" height="${brkH + 4}" fill="transparent" style="cursor:pointer" data-breaker-toggle="${i}"/>`;
  }

  h += `</svg></div>`;

  // Таймер АВР
  if (n._avrSwitchCountdown > 0) {
    h += `<div style="text-align:center;font-size:12px;color:#1976d2;font-weight:600;margin:4px 0">АВР: задержка переключения ${Math.ceil(n._avrSwitchCountdown)} с</div>`;
  } else if (n._avrInterlockCountdown > 0) {
    h += `<div style="text-align:center;font-size:12px;color:#ff9800;font-weight:600;margin:4px 0">АВР: разбежка ${Math.ceil(n._avrInterlockCountdown)} с</div>`;
  }

  // --- Переключатель Авто / Ручной (только для щитов с АВР) ---
  if (inCount > 1 && hasAVR) {
    const manualNow = n.switchMode === 'manual';
    h += '<div style="display:flex;align-items:center;gap:10px;margin:10px 0 6px">';
    h += '<span style="font-size:11px;color:' + (!manualNow ? '#4caf50;font-weight:600' : '#999') + '">Авто</span>';
    h += `<div id="pc-toggle" style="position:relative;width:52px;height:26px;border-radius:13px;background:${manualNow ? '#ff9800' : '#4caf50'};cursor:pointer;transition:background 0.2s;flex-shrink:0">`;
    h += `<div style="position:absolute;top:2px;${manualNow ? 'right:2px' : 'left:2px'};width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`;
    h += '</div>';
    h += '<span style="font-size:11px;color:' + (manualNow ? '#e65100;font-weight:600' : '#999') + '">Ручной</span>';
    h += '</div>';
  } else if (n.switchMode === 'parallel') {
    h += '<div style="font-size:11px;color:#666;margin:8px 0">Щит без АВР — все автоматы управляются вручную</div>';
  }

  // --- Обслуживание ---
  h += `<div class="field check" style="margin-top:8px"><input type="checkbox" id="pc-maintenance"${n.maintenance ? ' checked' : ''}><label>Режим обслуживания (полностью обесточен)</label></div>`;
  if (n.maintenance) {
    h += '<div style="background:#fff3e0;border:1px solid #ffb74d;border-radius:6px;padding:6px;font-size:11px;font-weight:600;color:#e65100">⚠ ЩИТ В РЕЖИМЕ ОБСЛУЖИВАНИЯ</div>';
  }


  body.innerHTML = h;

  // Автоматы выходов
  body.querySelectorAll('[data-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      snapshot('breaker:' + n.id);
      const idx = Number(el.dataset.breakerToggle);
      if (!Array.isArray(n.breakerStates)) n.breakerStates = new Array(outCount).fill(true);
      while (n.breakerStates.length < outCount) n.breakerStates.push(true);
      n.breakerStates[idx] = !n.breakerStates[idx];
      openPanelControlModal(n);
      _render(); notifyChange();
    });
  });

  // Автоматы входов
  body.querySelectorAll('[data-in-breaker-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.inBreakerToggle);
      if (!Array.isArray(n.inputBreakerStates)) n.inputBreakerStates = new Array(inCount).fill(false);
      while (n.inputBreakerStates.length < inCount) n.inputBreakerStates.push(false);

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
      openPanelControlModal(n);
      _render(); notifyChange();
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
      openPanelControlModal(n);
      _render(); renderInspector(); notifyChange();
    });
  }

  // Обслуживание
  const maintCb = document.getElementById('pc-maintenance');
  if (maintCb) {
    maintCb.addEventListener('change', () => {
      snapshot('maint:' + n.id);
      n.maintenance = maintCb.checked;
      openPanelControlModal(n);
      _render(); renderInspector(); notifyChange();
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

  switch (channelType) {
    case 'conduit': paths = hatch(0, 0, 36, 8) + circSvg(18, 18, 9, 'none', '#888') + dotsSvg(18, 18, 5); break;
    case 'tray_solid': paths = `<rect x="${2 * scale}" y="${10 * scale}" width="${32 * scale}" height="${14 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 17, 5); break;
    case 'wall': paths = hatch(0, 0, 36, 8) + dotsSvg(18, 18, 6); break;
    case 'tray_perf': paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_wire': paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_ladder': paths = `<line x1="${4 * scale}" y1="${16 * scale}" x2="${4 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${32 * scale}" y1="${16 * scale}" x2="${32 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${4 * scale}" y1="${21 * scale}" x2="${32 * scale}" y2="${21 * scale}" stroke="#888" stroke-width="${0.8 * scale}"/>` + dotsSvg(18, 12, 5); break;
    case 'ground': paths = hatch(0, 0, 36, 28) + circSvg(18, 14, 8, 'none', '#888') + dotsSvg(18, 14, 4.5); break;
    case 'ground_direct': paths = hatch(0, 0, 36, 28) + dotsSvg(18, 14, 5.5); break;
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

  if (c._state === 'active') {
    h.push('<div class="inspector-section"><h4>Нагрузка линии</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Текущая P: <b>${fmt(c._loadKw)} kW</b><br>` +
      `Текущий I: <b>${fmt(c._loadA || 0)} A</b><br>` +
      `Расчётный I для кабеля: <b>${fmt(c._maxA || 0)} A</b> <span class="muted">(по максимально возможной нагрузке)</span><br>` +
      (c._cosPhi ? `cos φ: <b>${c._cosPhi.toFixed(2)}</b><br>` : '') +
      `Напряжение: <b>${c._voltage || '-'} В</b>` +
      (c._ikA && isFinite(c._ikA) ? `<br>Ik в точке: <b>${fmt(c._ikA / 1000)} кА</b>` : '') +
      `</div></div>`);
  }

  // Выбор каналов на пути линии
  const channels = [...state.nodes.values()].filter(n => n.type === 'channel');
  if (channels.length) {
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    const chCount = chainIds.length;
    h.push(`<details class="inspector-section" style="margin-top:8px"${chCount ? ' open' : ''}>`);
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">Кабельные каналы (${chCount})</summary>`);
    h.push('<div class="muted" style="font-size:10px;margin:4px 0 6px">Отметьте каналы, через которые проходит линия.</div>');
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')}</label></div>`);
    }
    h.push('</details>');
  }

  // === Проводник линии ===
  const ct = c.cableType || GLOBAL.defaultCableType;
  const isBusbar = ct === 'busbar';

  h.push('<div class="inspector-section"><h4>Проводник</h4>');
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
  }
  h.push('</div>');

  if (!isBusbar) {
    // === Условия прокладки (только для кабелей) ===
    h.push('<div class="inspector-section"><h4>Условия прокладки</h4>');
    const curMethod = c.installMethod || GLOBAL.defaultInstallMethod;
    const curBundling = c.bundling || 'touching';
    const methodToChannel = { B1: 'conduit', B2: 'tray_solid', C: 'wall', E: 'tray_perf', F: 'tray_ladder', D1: 'ground', D2: 'ground_direct' };
    h.push(`<div style="display:flex;gap:10px;justify-content:center;margin:6px 0">${channelIconSVG(methodToChannel[curMethod] || 'conduit', 48)}${bundlingIconSVG(curBundling, 48)}</div>`);
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    if (chainIds.length) {
      h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Линия проходит через канал(ы) — параметры ниже переопределяются каналом (худший случай по всей цепочке).</div>');
    } else {
      h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Линия не проходит через каналы — параметры берутся отсюда.</div>');
    }
    const method = c.installMethod || GLOBAL.defaultInstallMethod;
    h.push(field('Способ прокладки',
      `<select data-conn-prop="installMethod">
        <option value="B1"${method === 'B1' ? ' selected' : ''}>B1 — изолированные в трубе</option>
        <option value="B2"${method === 'B2' ? ' selected' : ''}>B2 — многожильный в трубе</option>
        <option value="C"${method === 'C' ? ' selected' : ''}>C — открыто на стене</option>
        <option value="E"${method === 'E' ? ' selected' : ''}>E — многожильный на лотке</option>
        <option value="F"${method === 'F' ? ' selected' : ''}>F — одножильные на лотке / в воздухе</option>
        <option value="D1"${method === 'D1' ? ' selected' : ''}>D1 — в трубе в земле</option>
        <option value="D2"${method === 'D2' ? ' selected' : ''}>D2 — напрямую в земле</option>
      </select>`));
    const bundling = c.bundling || 'touching';
    h.push(field('Расположение кабелей',
      `<select data-conn-prop="bundling">
        <option value="spaced"${bundling === 'spaced' ? ' selected' : ''}>С зазором ≥ Ø кабеля</option>
        <option value="touching"${bundling === 'touching' ? ' selected' : ''}>Плотно друг к другу</option>
        <option value="bundled"${bundling === 'bundled' ? ' selected' : ''}>В пучке / жгуте</option>
      </select>`));
    h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-conn-prop="ambientC" value="${c.ambientC || GLOBAL.defaultAmbient}">`));
    h.push(field('Цепей в группе', `<input type="number" min="1" max="20" step="1" data-conn-prop="grouping" value="${c.grouping || GLOBAL.defaultGrouping}">`));
    h.push('</div>');
  }

  // Результат подбора проводника
  if (c._state === 'active' && (c._cableSize || c._busbarNom)) {
    if (isBusbar && c._busbarNom) {
      // Шинопровод — номинал
      const warn = c._cableOverflow ? '<span style="color:#c62828;font-weight:600"> ⚠ превышен макс. номинал ряда</span>' : '';
      const kTemp = c._busbarKt != null ? c._busbarKt.toFixed(2) : '—';
      const kLoad = c._busbarKl != null ? c._busbarKl.toFixed(2) : '—';
      const izDerated = c._cableIz || c._busbarNom;
      h.push('<div class="inspector-section"><h4>Подобранный шинопровод</h4>');
      h.push(`<div style="font-size:12px;line-height:1.8">` +
        `Номинал: <b>${c._busbarNom} А</b>${warn}<br>` +
        `Imax расчётный: <b>${fmt(c._maxA || 0)} A</b><br>` +
        `Iдоп (с коэфф.): <b>${fmt(izDerated)} A</b><br>` +
        `Kt (темп.): <b>${kTemp}</b>, Kl (нагрузка): <b>${kLoad}</b><br>` +
        `Длина: <b>${fmt(c._cableLength || 0)} м</b>` +
        `</div></div>`);
    } else if (c._cableSize) {
      // Кабель
      const warn = c._cableOverflow ? '<span style="color:#c62828;font-weight:600"> (Iрасч > Iдоп даже при макс. сечении и ' + (GLOBAL.maxParallelAuto || 4) + ' параллельных)</span>' : '';
      const par = c._cableParallel || 1;
      const typeLabel = {
        multi: 'многожильный',
        single: 'одножильный многопр.',
        solid: 'цельная жила',
      }[c._cableType || 'multi'] || 'многожильный';
      const bundlingLabel = {
        spaced:   'с зазором ≥ Ø',
        touching: 'плотно',
        bundled:  'в пучке',
      }[c._cableBundling || 'touching'] || 'плотно';

      h.push('<div class="inspector-section"><h4>Подобранный кабель</h4>');
      h.push(`<div style="font-size:12px;line-height:1.8">` +
        `Сечение: <b>${c._cableSize} мм²</b>${warn}<br>` +
        `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b><br>` +
        `Конструкция: <b>${typeLabel}</b><br>` +
        `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b><br>` +
        `t=${c._cableAmbient}°C, группа=${c._cableGrouping}, длина=${fmt(c._cableLength || 0)} м<br>` +
        `Iдоп на жилу: <b>${fmt(c._cableIz)} A</b><br>` +
        (par > 1 ? `Параллельных линий: <b>${par}</b><br>Iдоп всех линий: <b>${fmt(c._cableTotalIz)} A</b><br>` : '') +
        `</div></div>`);

      if (c._cableAutoParallel) {
        h.push('<div class="inspector-section" style="background:#fff8e1;border-radius:6px;padding:10px;border:1px solid #ffd54f">');
        h.push(`<div style="font-size:12px;line-height:1.7">` +
          `⚠ <b>Авто-параллель:</b> одиночная жила сечением ${GLOBAL.maxCableSize} мм² не проходит по току,<br>` +
          `поэтому расчёт выбрал <b>${par} параллельных линий ${c._cableSize} мм²</b>.<br>` +
          `<span class="muted" style="font-size:11px">Рекомендации IEC по прокладке параллельных линий:<br>` +
          `• Кабели одной фазы — одинаковой длины и сечения<br>` +
          `• Разносить не более 1 диаметра (вариант &laquo;touching&raquo;) либо с зазором ≥ Ø для лучшего теплоотвода<br>` +
          `• Использовать общий лоток с симметричной разводкой по фазам (ABC/ABC/...)<br>` +
          `• На каждую параллельную линию — свой автомат того же номинала в шкафу</span>` +
          `</div></div>`);
      }
    }
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
  // Кнопка сброса точек сплайна — только если точки есть
  if (Array.isArray(c.waypoints) && c.waypoints.length) {
    h.push(`<button class="full-btn" id="btn-reset-waypoints" style="margin-top:8px">↺ Сбросить траекторию (${c.waypoints.length} точ.)</button>`);
  }
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка на поля связи
  inspectorBody.querySelectorAll('[data-conn-prop]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('conn:' + c.id + ':' + inp.dataset.connProp);
      const prop = inp.dataset.connProp;
      const v = inp.type === 'number' ? Number(inp.value) : inp.value;
      c[prop] = v;
      _render();
      notifyChange();
      // Обновить иконки при смене метода/расположения
      if (prop === 'installMethod' || prop === 'bundling') renderInspector();
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
      _render();
      renderInspector();
      notifyChange();
    });
  });
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
