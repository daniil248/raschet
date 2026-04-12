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
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.92}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));

    // Поля только для генератора
    if (subtype === 'generator') {
      h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
      const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
        ? n.triggerNodeIds : (n.triggerNodeId ? [n.triggerNodeId] : []);
      const triggerCount = triggers.length;
      h.push('<div class="inspector-section">');
      h.push(`<button class="full-btn" id="btn-open-automation">⚡ Автоматизация${triggerCount ? ` (${triggerCount} триггер${triggerCount > 1 ? 'ов' : ''})` : ''}</button>`);
      h.push(field('Задержка запуска, сек', `<input type="number" min="0" max="600" step="1" data-prop="startDelaySec" value="${n.startDelaySec || 0}">`));
      h.push(field('Задержка остановки, сек', `<input type="number" min="0" max="600" step="1" data-prop="stopDelaySec" value="${n.stopDelaySec ?? 2}">`));
      h.push('</div>');
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
    h.push(field('Входов', `<input type="number" min="1" max="30" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="30" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(field('Ксим (коэффициент одновременности)', `<input type="number" min="0" max="1.2" step="0.05" data-prop="kSim" value="${n.kSim ?? 1}">`));

    // Номинал шкафа — в амперах. Рядом показываем эквивалент в kW для справки.
    h.push('<div class="inspector-section"><h4>Номинал шкафа</h4>');
    h.push(field('Номинальный ток вводного автомата, А', `<input type="number" min="0" step="1" data-prop="capacityA" value="${n.capacityA ?? 160}">`));
    // Подсказка с эквивалентной мощностью
    if (n._capacityKwFromA) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-8px;margin-bottom:10px">Эквивалентная мощность при ${nodeVoltage(n)} В, cos φ ${(n._cosPhi || GLOBAL.defaultCosPhi).toFixed(2)}: <b>${fmt(n._capacityKwFromA)} kW</b></div>`);
    }
    h.push(field('Мин. запас над нагрузкой, %', `<input type="number" min="0" max="50" step="1" data-prop="marginMinPct" value="${n.marginMinPct ?? 2}">`));
    h.push(field('Макс. запас над нагрузкой, %', `<input type="number" min="5" max="500" step="1" data-prop="marginMaxPct" value="${n.marginMaxPct ?? 30}">`));
    h.push('<div class="muted" style="font-size:11px;margin-top:-4px">Шкаф считается правильно подобранным, если его номинальный ток превышает расчётный на значение в этих пределах. Вне диапазона — предупреждение.</div>');
    h.push('</div>');

    // Режим переключения и приоритеты имеют смысл только при 2+ входах
    if (n.inputs > 1) {
      const sm = n.switchMode || 'auto';
      h.push(field('Режим переключения',
        `<select data-prop="switchMode">
          <option value="auto"${sm === 'auto' ? ' selected' : ''}>Автоматический (АВР)</option>
          <option value="manual"${sm === 'manual' ? ' selected' : ''}>Ручной — один вход</option>
          <option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Параллельный — несколько вводов</option>
          <option value="avr_paired"${sm === 'avr_paired' ? ' selected' : ''}>АВР с привязкой выходов к входам</option>
          <option value="switchover"${sm === 'switchover' ? ' selected' : ''}>Подменный (switchover) — по условию</option>
          <option value="watchdog"${sm === 'watchdog' ? ' selected' : ''}>Watchdog — вход N → выход N по сигналу</option>
        </select>`));
      if (sm === 'manual') {
        const opts = [];
        for (let i = 0; i < n.inputs; i++) {
          opts.push(`<option value="${i}"${(n.manualActiveInput | 0) === i ? ' selected' : ''}>Вход ${i + 1}</option>`);
        }
        h.push(field('Активный вход',
          `<select data-prop="manualActiveInput">${opts.join('')}</select>`));
        h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Работает только явно выбранный вход. Если на нём нет напряжения — щит обесточен.</div>');
      } else if (sm === 'avr_paired') {
        h.push('<div class="inspector-section"><h4>АВР с привязкой</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Каждый выход привязан к группе входов. Выход работает от того входа из своей группы, у которого есть питание (АВР внутри группы).</div>');
        const map = Array.isArray(n.outputInputMap) ? n.outputInputMap : [];
        for (let oi = 0; oi < n.outputs; oi++) {
          const assigned = map[oi] || [];
          h.push(`<div class="field"><label>Выход ${oi + 1} ← входы:</label><div>`);
          for (let ii = 0; ii < n.inputs; ii++) {
            const checked = assigned.includes(ii);
            h.push(`<span style="margin-right:8px"><input type="checkbox" data-oim-out="${oi}" data-oim-in="${ii}"${checked ? ' checked' : ''}> Вх${ii + 1}</span>`);
          }
          h.push('</div></div>');
        }
        h.push('</div>');
      } else if (sm === 'switchover') {
        h.push('<div class="inspector-section"><h4>Подменный (switchover)</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Каждый выход включается только когда указанный узел обесточен. Типичное применение: подменный ДГУ, который заменяет ДГУ1 или ДГУ2.</div>');
        const whenDead = Array.isArray(n.outputActivateWhenDead) ? n.outputActivateWhenDead : [];
        const candidates = [...state.nodes.values()].filter(o => o.id !== n.id && (o.type === 'source' || o.type === 'generator' || o.type === 'ups'));
        for (let oi = 0; oi < n.outputs; oi++) {
          const curId = whenDead[oi] || '';
          let opts = '<option value="">— всегда активен —</option>';
          for (const cand of candidates) {
            opts += `<option value="${escAttr(cand.id)}"${curId === cand.id ? ' selected' : ''}>${escHtml(effectiveTag(cand))} ${escHtml(cand.name || '')}</option>`;
          }
          h.push(field(`Выход ${oi + 1}: включить при обесточке`, `<select data-switchover-out="${oi}">${opts}</select>`));
        }
        h.push('</div>');
      } else if (sm === 'watchdog') {
        h.push('<div class="inspector-section"><h4>Watchdog</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Вход i → выход i. Выход активен когда upstream входа i мёртв.</div>');
        h.push('</div>');
      } else if (sm === 'parallel') {
        h.push('<div class="inspector-section"><h4>Включённые вводы</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Можно включить несколько вводных автоматов одновременно — актуально для шкафов байпаса и параллельной работы ИБП.</div>');
        const enabled = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
        for (let i = 0; i < n.inputs; i++) {
          const on = !!enabled[i];
          h.push(`<div class="field check"><input type="checkbox" data-parallel="${i}"${on ? ' checked' : ''}><label>Вход ${i + 1}</label></div>`);
        }
        h.push('</div>');
      } else {
        h.push(prioritySection(n));
      }
    }
    // При inputs === 1 никаких приоритетов/режимов не показываем
    h.push(panelStatusBlock(n));
  } else if (n.type === 'ups') {
    h.push(field('Выходная мощность, kW', `<input type="number" min="0" step="0.1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(field('КПД, %', `<input type="number" min="30" max="100" step="1" data-prop="efficiency" value="${n.efficiency}">`));
    h.push(voltageField(n));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.92}">`));
    h.push(field('Ток заряда батареи, А (AC из сети)', `<input type="number" min="0" step="0.1" data-prop="chargeA" value="${n.chargeA ?? 2}">`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-8px;margin-bottom:8px">Ток, потребляемый ИБП из сети переменного тока на заряд батареи. Не путать с DC-током заряда АКБ.</div>');
    h.push(field('Ёмкость батареи, kWh', `<input type="number" min="0" step="0.1" data-prop="batteryKwh" value="${n.batteryKwh}">`));
    h.push(field('Заряд батареи, %', `<input type="number" min="0" max="100" step="1" data-prop="batteryChargePct" value="${n.batteryChargePct}">`));
    h.push(field('Входов', `<input type="number" min="1" max="5" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="20" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    if (n.inputs > 1) h.push(prioritySection(n));

    // Статический байпас
    h.push('<div class="inspector-section"><h4>Внутренний статический байпас</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Встроенная функция ИБП: при перегрузке или принудительно переводит нагрузку напрямую со входа, минуя инвертор. КПД = 100%, батарея не заряжается.</div>');
    h.push(checkField('Байпас разрешён', 'staticBypass', n.staticBypass !== false));
    h.push(checkField('Автоматический (по перегрузу)', 'staticBypassAuto', n.staticBypassAuto !== false));
    h.push(field('Порог перехода, % от Pном', `<input type="number" min="80" max="200" step="5" data-prop="staticBypassOverloadPct" value="${n.staticBypassOverloadPct || 110}">`));
    h.push(checkField('Принудительный байпас (вручную)', 'staticBypassForced', !!n.staticBypassForced));
    h.push('</div>');

    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(field('Количество в группе', `<input type="number" min="1" max="999" step="1" data-prop="count" value="${n.count || 1}">`));
    h.push(field(((n.count || 1) > 1 ? 'Мощность каждого, kW' : 'Установленная мощность, kW'),
      `<input type="number" min="0" step="0.1" data-prop="demandKw" value="${n.demandKw}">`));
    if ((n.count || 1) > 1) {
      const total = (Number(n.demandKw) || 0) * (n.count | 0);
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Суммарная установленная: <b>${n.count} × ${fmt(n.demandKw)} kW = ${fmt(total)} kW</b></div>`);
    }
    h.push(voltageField(n));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi ?? 0.92}">`));
    h.push(field('Ки — коэффициент использования', `<input type="number" min="0" max="1" step="0.05" data-prop="kUse" value="${n.kUse ?? 1}">`));
    h.push(field('Кратность пускового тока', `<input type="number" min="1" max="10" step="0.1" data-prop="inrushFactor" value="${n.inrushFactor ?? 1}">`));
    h.push(field('Входов', `<input type="number" min="1" max="10" step="1" data-prop="inputs" value="${n.inputs}">`));
    if (n.inputs > 1) h.push(prioritySection(n));
    // Расчётные величины
    h.push(consumerCurrentsBlock(n));
    // В активном сценарии — поле множителя нагрузки
    if (state.activeModeId) {
      const lf = effectiveLoadFactor(n);
      h.push('<div class="inspector-section"><h4>В текущем сценарии</h4>');
      h.push(field('Множитель нагрузки (0–3)', `<input type="number" min="0" max="3" step="0.05" data-loadfactor value="${lf}">`));
      h.push(`<div class="muted" style="font-size:11px;margin-top:-4px">1.0 = номинал, 0.5 = 50% мощности, 0 = выключено.</div>`);
      h.push('</div>');
    }
    h.push(statusBlock(n));
  }

  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Изменения параметра «В работе» сохраняются в режиме <b>${escAttr(m?.name || '')}</b></div></div>`);
  }

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

  const hasTriggerGroups = Array.isArray(n.triggerGroups) && n.triggerGroups.length > 0;

  h.push(`<h3>Автоматизация ${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);

  // === Режим: простой (legacy) или подменный (triggerGroups) ===
  const mode = hasTriggerGroups ? 'groups' : 'simple';
  h.push(field('Режим запуска',
    `<select id="auto-mode">
      <option value="simple"${mode === 'simple' ? ' selected' : ''}>Простой (резервный ДГУ)</option>
      <option value="groups"${mode === 'groups' ? ' selected' : ''}>Подменный ДГУ (несколько сценариев)</option>
    </select>`));
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Простой: ДГУ запускается при потере питания на выбранных узлах.<br>Подменный: ДГУ подменяет конкретный источник и коммутирует соответствующие выходы.</div>');

  // === Простой режим ===
  h.push(`<div id="auto-simple" style="${mode === 'simple' ? '' : 'display:none'}">`);
  h.push('<h4>Триггеры запуска</h4>');
  h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Отметьте узлы, при отключении которых ДГУ запускается.</div>');

  const allCandidates = [];
  for (const other of state.nodes.values()) {
    if (other.id === n.id) continue;
    if (other.type !== 'source' && other.type !== 'panel' && other.type !== 'generator' && other.type !== 'ups') continue;
    allCandidates.push(other);
  }
  const currentTriggers = new Set(
    (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : [])
  );
  for (const cand of allCandidates) {
    const checked = currentTriggers.has(cand.id);
    h.push(`<div class="field check"><input type="checkbox" data-auto-trigger="${escAttr(cand.id)}"${checked ? ' checked' : ''}><label>${escHtml(effectiveTag(cand))} — ${escHtml(cand.name || '')}</label></div>`);
  }
  const logic = n.triggerLogic || 'any';
  h.push(field('Логика',
    `<select id="auto-trigger-logic">
      <option value="any"${logic === 'any' ? ' selected' : ''}>ANY — хотя бы один отключён</option>
      <option value="all"${logic === 'all' ? ' selected' : ''}>ALL — все отключены</option>
    </select>`));
  h.push('</div>');

  // === Подменный режим (triggerGroups) ===
  h.push(`<div id="auto-groups" style="${mode === 'groups' ? '' : 'display:none'}">`);
  h.push('<h4>Сценарии подмены</h4>');
  h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Каждый сценарий: условие (какой ввод щита мёртв) → какие выходы коммутационного щита включить. Первый сработавший сценарий активируется.</div>');

  // Собираем все щиты с их входами для выбора
  const panels = [...state.nodes.values()].filter(nn => nn.type === 'panel' && nn.inputs > 0);
  // Щит, подключённый к выходу генератора (downstream switchover panel)
  let downstreamPanel = null;
  for (const c of state.conns.values()) {
    if (c.from.nodeId === n.id) {
      const to = state.nodes.get(c.to.nodeId);
      if (to && to.type === 'panel') { downstreamPanel = to; break; }
    }
  }

  const groups = hasTriggerGroups ? n.triggerGroups : [];
  // Рендер каждой группы
  for (let gi = 0; gi < Math.max(groups.length, 1); gi++) {
    const grp = groups[gi] || { name: '', watchInputs: [], logic: 'any', activateOutputs: [] };
    h.push(`<div class="inspector-section" style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:10px" data-grp-idx="${gi}">`);
    h.push(field(`Сценарий ${gi + 1} — имя`, `<input type="text" data-grp-name="${gi}" value="${escAttr(grp.name || '')}" placeholder="Подмена ДГУ${gi+1}">`));

    // Условия: выбор ввода щита
    h.push('<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Условие запуска (ввод щита без питания):</div>');
    const watches = Array.isArray(grp.watchInputs) ? grp.watchInputs : [];
    for (const p of panels) {
      for (let port = 0; port < p.inputs; port++) {
        // Найдём что подключено к этому вводу
        let feederTag = '—';
        for (const c of state.conns.values()) {
          if (c.to.nodeId === p.id && c.to.port === port) {
            const from = state.nodes.get(c.from.nodeId);
            feederTag = from ? (effectiveTag(from) || from.name || '?') : '?';
            break;
          }
        }
        const isChecked = watches.some(w => w.panelId === p.id && w.inputPort === port);
        const label = `${escHtml(effectiveTag(p))} вход ${port + 1} (от ${escHtml(feederTag)})`;
        h.push(`<div class="field check" style="font-size:11px"><input type="checkbox" data-grp-watch="${gi}" data-panel="${escAttr(p.id)}" data-port="${port}"${isChecked ? ' checked' : ''}><label>${label}</label></div>`);
      }
    }
    const gLogic = grp.logic || 'any';
    h.push(`<select data-grp-logic="${gi}" style="font-size:11px;margin:4px 0">
      <option value="any"${gLogic === 'any' ? ' selected' : ''}>ANY</option>
      <option value="all"${gLogic === 'all' ? ' selected' : ''}>ALL</option>
    </select>`);

    // Выходы switchover-щита для коммутации
    if (downstreamPanel) {
      h.push(`<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Выходы ${escHtml(effectiveTag(downstreamPanel))} для включения:</div>`);
      const activeOuts = new Set(Array.isArray(grp.activateOutputs) ? grp.activateOutputs : []);
      for (let oi = 0; oi < (downstreamPanel.outputs || 0); oi++) {
        // Куда ведёт этот выход?
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
    }
    h.push('</div>');
  }

  // Кнопка «+ Добавить сценарий»
  h.push(`<button type="button" id="auto-add-group" style="font-size:12px;padding:5px 12px;border:1px dashed #999;background:transparent;border-radius:4px;cursor:pointer;width:100%;margin-top:4px">+ Добавить сценарий</button>`);
  h.push('</div>');

  body.innerHTML = h.join('');

  // Переключение режима
  const modeSelect = document.getElementById('auto-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      const simple = document.getElementById('auto-simple');
      const groups = document.getElementById('auto-groups');
      if (modeSelect.value === 'simple') {
        if (simple) simple.style.display = '';
        if (groups) groups.style.display = 'none';
      } else {
        if (simple) simple.style.display = 'none';
        if (groups) groups.style.display = '';
      }
    });
  }

  // + Добавить сценарий
  const addBtn = document.getElementById('auto-add-group');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!Array.isArray(n.triggerGroups)) n.triggerGroups = [];
      n.triggerGroups.push({ name: '', watchInputs: [], logic: 'any', activateOutputs: [] });
      openAutomationModal(n); // перерисовать
    });
  }

  // Привязка кнопки «Применить»
  const applyBtn = document.getElementById('automation-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      snapshot('automation:' + n.id);
      const selectedMode = document.getElementById('auto-mode')?.value || 'simple';

      if (selectedMode === 'simple') {
        // Простой режим
        const selected = [];
        body.querySelectorAll('[data-auto-trigger]').forEach(inp => {
          if (inp.checked) selected.push(inp.dataset.autoTrigger);
        });
        n.triggerNodeIds = selected;
        n.triggerNodeId = selected[0] || null;
        const logicSel = document.getElementById('auto-trigger-logic');
        n.triggerLogic = logicSel ? logicSel.value : 'any';
        n.triggerGroups = []; // очистить группы
      } else {
        // Подменный режим
        n.triggerNodeIds = [];
        n.triggerNodeId = null;
        const newGroups = [];
        const grpEls = body.querySelectorAll('[data-grp-idx]');
        grpEls.forEach(el => {
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
      }

      document.getElementById('modal-automation').classList.add('hidden');
      _render();
      renderInspector();
      notifyChange();
      flash('Автоматизация обновлена');
    };
  }

  document.getElementById('modal-automation').classList.remove('hidden');
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
  const parts = [];
  parts.push(`<b>P акт.:</b> ${fmt(n._powerP || 0)} kW`);
  parts.push(`<b>Q реакт.:</b> ${fmt(n._powerQ || 0)} kvar`);
  parts.push(`<b>S полн.:</b> ${fmt(n._powerS || 0)} kVA`);
  parts.push(`<b>Установочный ток:</b> ${fmt(n._nominalA || 0)} А`);
  parts.push(`<b>Расчётный ток:</b> ${fmt(n._ratedA || 0)} А  <span class="muted">(с учётом Ки)</span>`);
  if ((n.inrushFactor || 1) > 1) {
    parts.push(`<b>Пусковой ток:</b> ${fmt(n._inrushA || 0)} А`);
  }
  return `<div class="inspector-section"><h4>Расчётные величины</h4><div style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
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
  h.push(field('Обозначение', `<input type="text" data-conn-prop="lineLabel" value="${escAttr(lineLabel)}" placeholder="${escAttr(autoLineLabel)}">`));
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
    h.push('<div class="inspector-section"><h4>Кабельные каналы на пути</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Отметьте каналы, через которые проходит линия. Расчёт возьмёт самые худшие параметры прокладки и учтёт группировку цепей в каждом канале.</div>');
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')} (${escHtml(ch.material || 'Cu')}/${escHtml(ch.insulation || 'PVC')}, ${escHtml(ch.method || 'B1')}, ${ch.ambientC || 30}°C)</label></div>`);
    }
    h.push('</div>');
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
