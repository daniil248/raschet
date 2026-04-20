/* =========================================================================
   rack-config/rack-config.js
   MVP+ конфигуратор 19" стойки:
    - каталог готовых комплектов (артикулов) — при выборе блокируются поля,
      входящие в комплект
    - произвольная сборка из корпуса, дверей (одно-/двустворчатые, с замком
      в комплекте или отдельно), боковых стенок (пара одним SKU / парой
      отдельно / одна / без), крыши, пола (возможна объединённая позиция
      крыша+пол), кабельных вводов, заглушек пустых U
    - PDU с микс-набором розеток (несколько типов в одной PDU)
    - проверка ёмкости PDU (строгая: capKw ≥ demandKw; запас допустим
      меньше чем для стойки в целом)
    - BOM, CSV, печать, localStorage-шаблоны
    - мост с основной схемой: ?nodeId=… в URL — загрузка/возврат шаблона
      узлу consumer/rack через postMessage + localStorage bridge
   Roadmap 1.23.2–1.23.10.
   ========================================================================= */

'use strict';

const LS_KEY  = 'rack-config.templates.v1';
const BRIDGE_KEY_PREFIX = 'raschet.rack.bridge.';

/* ---------- справочные таблицы ---------- */
const DOOR_LABEL = {
  glass:        'Дверь стекло одностворчатая',
  mesh:         'Дверь перфорированная одностворчатая',
  metal:        'Дверь металл глухая одностворчатая',
  'double-mesh':  'Дверь двустворчатая перфорированная',
  'double-glass': 'Дверь двустворчатая стеклянная',
  'double-metal': 'Дверь двустворчатая металл',
  none:         null,
};
const TOP_LABEL = {
  solid: 'Крыша глухая',
  vent:  'Крыша вентилируемая',
  fan:   'Крыша с вентиляторными модулями (4×)',
};
const BASE_LABEL = {
  feet:    'Комплект регулируемых ножек',
  casters: 'Комплект роликов',
  plinth:  'Цоколь',
};
const ENTRY_LABEL = {
  brush: 'Кабельный ввод со щёткой',
  plug:  'Кабельный ввод-заглушка',
  pg:    'Кабельный ввод PG-сальник',
};
const LOCK_LABEL = {
  key:     'Замок ключевой (отд. позиция)',
  code:    'Замок кодовый (отд. позиция)',
  electro: 'Электрозамок (отд. позиция)',
};
const BLANK_LABEL = {
  '1U-solid': 'Заглушка 1U глухая',
  '1U-vent':  'Заглушка 1U перфорированная',
  '2U-solid': 'Заглушка 2U глухая',
};
const BLANK_U = { '1U-solid': 1, '1U-vent': 1, '2U-solid': 2 };

/* ---------- каталог базовых комплектов ----------
   Каждый артикул определяет какие поля (locks) входят в комплект и их
   значения. При выборе такого комплекта форма подставляет значения и
   запрещает их редактирование. */
const KIT_CATALOG = [
  { id: '',      sku: '',           name: 'Произвольная конфигурация', includes: [], preset: {} },

  { id: 'apc-ar3100',
    sku: 'AR3100',
    name: 'APC NetShelter SX 42U 600×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase'],
    preset: {
      manufacturer: 'APC NetShelter SX',
      u: 42, width: 600, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh',
      doorWithLock: true,
      sides: 'pair-sku',
      top: 'vent', base: 'feet', comboTopBase: true,
    } },
  { id: 'apc-ar3150',
    sku: 'AR3150',
    name: 'APC NetShelter SX 42U 750×1070',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base','comboTopBase'],
    preset: {
      manufacturer: 'APC NetShelter SX',
      u: 42, width: 800, depth: 1070,
      doorFront: 'mesh', doorRear: 'double-mesh',
      doorWithLock: true,
      sides: 'pair-sku',
      top: 'vent', base: 'feet', comboTopBase: true,
    } },
  { id: 'cmo-shtk-m-42',
    sku: 'ШТК-М-42.6.10-44АА',
    name: 'ЦМО ШТК-М 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: {
      manufacturer: 'ЦМО ШТК-М',
      u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh',
      doorWithLock: true,
      sides: 'pair-sku',
      top: 'vent', base: 'feet',
    } },
  { id: 'rittal-ts-it-42',
    sku: 'TS IT 5528.110',
    name: 'Rittal TS IT 42U 600×1000',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','top','base','comboTopBase'],
    preset: {
      manufacturer: 'Rittal TS IT',
      u: 42, width: 600, depth: 1000,
      doorFront: 'mesh', doorRear: 'double-mesh',
      doorWithLock: true,
      sides: 'pair-split',
      top: 'vent', base: 'feet', comboTopBase: true,
    } },
  { id: 'hyperline-twb-24',
    sku: 'TWB-2466-SR-RAL9004',
    name: 'Hyperline TWB 24U 600×600 (настенный)',
    includes: ['u','width','depth','doorFront','doorRear','doorWithLock','sides','top','base'],
    preset: {
      manufacturer: 'Hyperline TWB',
      u: 24, width: 600, depth: 600,
      doorFront: 'glass', doorRear: 'none',
      doorWithLock: true,
      sides: 'pair-sku',
      top: 'vent', base: 'feet',
    } },
];

/* ---------- state ---------- */
function makeBlankTemplate(name = 'Новый шаблон') {
  return {
    id: 'tpl-' + Math.random().toString(36).slice(2, 9),
    name,
    manufacturer: '',
    kitId: '',
    u: 42, width: 600, depth: 1000,
    doorFront: 'mesh',
    doorRear:  'double-mesh',
    doorWithLock: true,
    lock: 'key',
    sides: 'pair-sku',
    top:  'vent',
    base: 'feet',
    comboTopBase: false,
    entryTop: 2, entryBot: 2, entryType: 'brush',
    occupied: 0, blankType: '1U-solid',
    demandKw: 5, cosphi: 0.9,
    pdus: [
      { id: 'pdu1', qty: 1, rating: 16, phases: 1, height: 0,
        outlets: [ { type: 'C13', count: 8 } ] }
    ],
    comment: '',
  };
}

const state = {
  templates: [],
  currentId: null,
  // режим «связь с узлом схемы»
  nodeId: null,   // если открыты из инспектора — id узла consumer/rack
};

/* ---------- localStorage ---------- */
function loadTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('rack-config: не удалось загрузить шаблоны', e);
    return [];
  }
}
function saveTemplates() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.templates)); }
  catch (e) { alert('Не удалось сохранить: ' + e.message); }
}

/* ---------- helpers ---------- */
function el(id) { return document.getElementById(id); }
function current() { return state.templates.find(t => t.id === state.currentId) || null; }
function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- kit catalog ---------- */
function renderKitSelect() {
  const sel = el('rc-kit');
  sel.innerHTML = KIT_CATALOG.map(k =>
    `<option value="${k.id}">${escape(k.name)}${k.sku ? ' — ' + escape(k.sku) : ''}</option>`).join('');
}
function kitById(id) { return KIT_CATALOG.find(k => k.id === id) || KIT_CATALOG[0]; }
function applyKitLocks() {
  const t = current();
  const kit = kitById(t.kitId || '');
  el('rc-kit-sku').value = kit.sku || '';
  // включить/выключить элементы формы
  document.querySelectorAll('[data-lock]').forEach(inp => {
    const lockKey = inp.dataset.lock;
    const locked = kit.includes.includes(lockKey);
    inp.disabled = locked;
    const field = inp.closest('.rc-field');
    if (field) field.classList.toggle('rc-locked', locked);
  });
  // раздел замка: если замок в двери — скрываем отдельный select
  const lockField = el('rc-lock-field');
  lockField.style.display = t.doorWithLock ? 'none' : '';
  // описание «входит в комплект»
  const host = el('rc-kit-includes');
  if (!kit.id) {
    host.innerHTML = '<i>Произвольная конфигурация — все поля доступны.</i>';
  } else {
    const items = [];
    if (kit.includes.includes('u'))     items.push(`корпус ${t.u}U ${t.width}×${t.depth}`);
    if (kit.includes.includes('doorFront')) items.push('передняя дверь');
    if (kit.includes.includes('doorRear'))  items.push('задняя дверь');
    if (kit.includes.includes('doorWithLock')) items.push('замки дверей');
    if (kit.includes.includes('sides')) items.push('боковые стенки');
    if (kit.includes.includes('top'))   items.push('крыша');
    if (kit.includes.includes('base'))  items.push('пол/основание');
    if (kit.includes.includes('comboTopBase')) items.push('крыша+пол одной позицией');
    host.innerHTML = '<b>Входит в комплект:</b> ' + escape(items.join(', ')) + '.';
  }
}
function applyKitPreset() {
  const t = current();
  const kit = kitById(t.kitId || '');
  if (!kit.id) return;
  Object.assign(t, JSON.parse(JSON.stringify(kit.preset)));
}

/* ---------- форма ↔ state ---------- */
function renderTemplateList() {
  const sel = el('rc-template');
  sel.innerHTML = state.templates.map(t =>
    `<option value="${t.id}">${escape(t.name || '(без имени)')}</option>`).join('');
  if (state.currentId) sel.value = state.currentId;
}

function renderForm() {
  const t = current();
  if (!t) return;
  el('rc-name').value         = t.name || '';
  el('rc-manufacturer').value = t.manufacturer || '';
  el('rc-kit').value          = t.kitId || '';
  el('rc-u').value            = String(t.u);
  el('rc-width').value        = String(t.width);
  el('rc-depth').value        = String(t.depth);
  el('rc-door-front').value   = t.doorFront;
  el('rc-door-rear').value    = t.doorRear;
  el('rc-door-with-lock').checked = !!t.doorWithLock;
  el('rc-lock').value         = t.lock;
  el('rc-sides').value        = t.sides;
  el('rc-top').value          = t.top;
  el('rc-base').value         = t.base;
  el('rc-combo-top-base').checked = !!t.comboTopBase;
  el('rc-entry-top').value    = t.entryTop;
  el('rc-entry-bot').value    = t.entryBot;
  el('rc-entry-type').value   = t.entryType;
  el('rc-occupied').value     = t.occupied;
  el('rc-blank-type').value   = t.blankType;
  el('rc-demand-kw').value    = t.demandKw;
  el('rc-cosphi').value       = t.cosphi;
  el('rc-comment').value      = t.comment || '';
  renderPduList();
  applyKitLocks();
  recalc();
}

function readForm() {
  const t = current();
  if (!t) return;
  t.name         = el('rc-name').value.trim();
  t.manufacturer = el('rc-manufacturer').value.trim();
  t.u            = parseInt(el('rc-u').value, 10) || 42;
  t.width        = parseInt(el('rc-width').value, 10) || 600;
  t.depth        = parseInt(el('rc-depth').value, 10) || 1000;
  t.doorFront    = el('rc-door-front').value;
  t.doorRear     = el('rc-door-rear').value;
  t.doorWithLock = el('rc-door-with-lock').checked;
  t.lock         = el('rc-lock').value;
  t.sides        = el('rc-sides').value;
  t.top          = el('rc-top').value;
  t.base         = el('rc-base').value;
  t.comboTopBase = el('rc-combo-top-base').checked;
  t.entryTop     = Math.max(0, parseInt(el('rc-entry-top').value, 10) || 0);
  t.entryBot     = Math.max(0, parseInt(el('rc-entry-bot').value, 10) || 0);
  t.entryType    = el('rc-entry-type').value;
  t.occupied     = Math.max(0, parseInt(el('rc-occupied').value, 10) || 0);
  t.blankType    = el('rc-blank-type').value;
  t.demandKw     = Math.max(0, parseFloat(el('rc-demand-kw').value) || 0);
  t.cosphi       = Math.min(1, Math.max(0.5, parseFloat(el('rc-cosphi').value) || 0.9));
  t.comment      = el('rc-comment').value;
}

/* ---------- PDU список ---------- */
function renderPduList() {
  const t = current();
  const host = el('rc-pdu-list');
  host.innerHTML = '';
  t.pdus.forEach((p, idx) => {
    // sanitize legacy (outlets+outletType → outlets[])
    if (!Array.isArray(p.outlets)) {
      p.outlets = [ { type: p.outletType || 'C13', count: Number(p.outlets) || 8 } ];
      delete p.outletType;
    }
    const row = document.createElement('div');
    row.className = 'rc-pdu-item';
    row.innerHTML = `
      <div class="rc-pdu-head">
        <label class="rc-field"><span>Кол-во</span>
          <input type="number" min="1" step="1" data-k="qty" value="${p.qty}">
        </label>
        <label class="rc-field"><span>Номинал, А</span>
          <select data-k="rating">
            ${[10,16,20,25,32,40,63].map(a => `<option value="${a}" ${p.rating===a?'selected':''}>${a} A</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Фазы</span>
          <select data-k="phases">
            <option value="1" ${p.phases===1?'selected':''}>1ф</option>
            <option value="3" ${p.phases===3?'selected':''}>3ф</option>
          </select>
        </label>
        <label class="rc-field"><span>Высота, U</span>
          <select data-k="height">
            <option value="0" ${p.height===0?'selected':''}>0U (верт.)</option>
            <option value="1" ${p.height===1?'selected':''}>1U</option>
            <option value="2" ${p.height===2?'selected':''}>2U</option>
          </select>
        </label>
        <button type="button" class="rc-btn rc-btn-danger" data-del="${idx}" title="Удалить PDU">✕</button>
      </div>
      <div class="rc-pdu-outlets">
        <div class="rc-pdu-outlets-head">
          <b>Розетки</b>
          <button type="button" class="rc-btn" data-add-outlet>+ тип</button>
        </div>
        <div class="rc-pdu-outlet-rows">
          ${p.outlets.map((o, oi) => `
            <div class="rc-pdu-outlet">
              <select data-ok="type" data-oi="${oi}">
                ${['C13','C19','C13+C19','Schuko','NEMA 5-15','IEC 60309 16A','IEC 60309 32A','UK BS1363','разъём T-slot','смешанный'].map(x =>
                  `<option value="${x}" ${o.type===x?'selected':''}>${x}</option>`).join('')}
              </select>
              <input type="number" min="1" step="1" data-ok="count" data-oi="${oi}" value="${o.count}" title="Количество розеток этого типа">
              <button type="button" class="rc-btn rc-btn-danger rc-btn-mini" data-del-outlet="${oi}" title="Удалить строку">✕</button>
            </div>
          `).join('')}
        </div>
        <div class="muted" style="font-size:11px">Итого розеток: ${p.outlets.reduce((s,o)=>s+(+o.count||0),0)}</div>
      </div>
    `;
    // основные поля
    row.querySelectorAll('[data-k]').forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        const v = inp.value;
        if (k === 'qty') p.qty = Math.max(1, parseInt(v,10)||1);
        else if (k === 'phases' || k === 'height') p[k] = parseInt(v,10)||0;
        else if (k === 'rating') p.rating = parseInt(v,10);
        else p[k] = v;
        recalc();
      });
    });
    // розетки
    row.querySelectorAll('[data-ok]').forEach(inp => {
      inp.addEventListener('change', () => {
        const oi = +inp.dataset.oi;
        const ok = inp.dataset.ok;
        if (!p.outlets[oi]) return;
        if (ok === 'count') p.outlets[oi].count = Math.max(1, parseInt(inp.value,10)||1);
        else p.outlets[oi].type = inp.value;
        renderPduList(); recalc();
      });
    });
    row.querySelector('[data-add-outlet]').addEventListener('click', () => {
      p.outlets.push({ type: 'C19', count: 4 });
      renderPduList(); recalc();
    });
    row.querySelectorAll('[data-del-outlet]').forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = +btn.dataset.delOutlet;
        if (p.outlets.length <= 1) { alert('Должен быть хотя бы один тип розеток.'); return; }
        p.outlets.splice(oi, 1);
        renderPduList(); recalc();
      });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      t.pdus.splice(idx, 1); renderPduList(); recalc();
    });
    host.appendChild(row);
  });
}

/* ---------- расчёт ---------- */
function pduCapacityKw(p) {
  // P = 230·I·cosφ (1ф) или √3·400·I·cosφ (3ф)
  const cos = current().cosphi || 0.9;
  const I = p.rating;
  if (p.phases === 3) return (Math.sqrt(3) * 400 * I * cos) / 1000;
  return (230 * I * cos) / 1000;
}

function computeBom() {
  const t = current();
  const kit = kitById(t.kitId || '');
  const rows = [];
  const add = (name, qty, unit = 'шт', note = '') => {
    if (!name || qty <= 0) return;
    rows.push({ name, qty, unit, note });
  };

  // Корпус / базовый комплект
  if (kit.id && kit.sku) {
    const whatIn = [];
    if (kit.includes.includes('doorFront')) whatIn.push('перед. дверь');
    if (kit.includes.includes('doorRear'))  whatIn.push('задн. дверь');
    if (kit.includes.includes('sides'))     whatIn.push('стенки');
    if (kit.includes.includes('top'))       whatIn.push('крыша');
    if (kit.includes.includes('base'))      whatIn.push('пол');
    add(`Комплект стойки ${kit.name} (${kit.sku})`, 1, 'шт',
        'включает: ' + (whatIn.join(', ') || 'корпус'));
  } else {
    add(`Стойка 19" ${t.u}U ${t.width}×${t.depth} мм` +
        (t.manufacturer ? ` (${t.manufacturer})` : ''), 1);
  }

  // Двери — только если не входят в комплект
  const doorIncluded = kit.includes.includes('doorFront');
  const rearDoorIncluded = kit.includes.includes('doorRear');
  if (!doorIncluded && DOOR_LABEL[t.doorFront]) {
    add(DOOR_LABEL[t.doorFront] + ' — передняя' + (t.doorWithLock ? ' (с замком)' : ''), 1);
  }
  if (!rearDoorIncluded && DOOR_LABEL[t.doorRear]) {
    add(DOOR_LABEL[t.doorRear] + ' — задняя' + (t.doorWithLock ? ' (с замком)' : ''), 1);
  }
  // Замок — отдельно только если НЕ в двери и ни одна дверь не из комплекта
  if (!t.doorWithLock && !kit.includes.includes('doorWithLock') && LOCK_LABEL[t.lock]) {
    const doorCnt = (DOOR_LABEL[t.doorFront] ? 1 : 0) + (DOOR_LABEL[t.doorRear] ? 1 : 0);
    if (doorCnt > 0) add(LOCK_LABEL[t.lock], doorCnt);
  }

  // Боковые стенки
  if (!kit.includes.includes('sides')) {
    if (t.sides === 'pair-sku')      add('Комплект боковых стенок (пара L+R)', 1);
    else if (t.sides === 'pair-split') { add('Боковая стенка левая', 1); add('Боковая стенка правая', 1); }
    else if (t.sides === 'left')     add('Боковая стенка левая', 1);
    else if (t.sides === 'right')    add('Боковая стенка правая', 1);
  }

  // Крыша + пол (возможно, одной позицией)
  const topIncl = kit.includes.includes('top');
  const baseIncl = kit.includes.includes('base');
  const comboIncl = kit.includes.includes('comboTopBase');
  if (t.comboTopBase && !comboIncl && !topIncl && !baseIncl) {
    add(`${TOP_LABEL[t.top] || 'Крыша'} + ${BASE_LABEL[t.base] || 'основание'} (комплект)`, 1);
  } else {
    if (!topIncl && TOP_LABEL[t.top]) add(TOP_LABEL[t.top], 1);
    if (!baseIncl && BASE_LABEL[t.base]) add(BASE_LABEL[t.base], 1);
  }

  // Кабельные вводы
  if (ENTRY_LABEL[t.entryType]) {
    const n = (t.entryTop||0) + (t.entryBot||0);
    if (n > 0) add(ENTRY_LABEL[t.entryType], n, 'шт',
      `сверху ${t.entryTop}, снизу ${t.entryBot}`);
  }

  // Заглушки
  const free = Math.max(0, t.u - t.occupied);
  const bu = BLANK_U[t.blankType] || 1;
  const blanksQty = Math.floor(free / bu);
  if (blanksQty > 0 && BLANK_LABEL[t.blankType]) {
    add(BLANK_LABEL[t.blankType], blanksQty, 'шт',
      `покрытие ${blanksQty*bu}U из ${free}U свободных`);
  }

  // PDU
  t.pdus.forEach(p => {
    const hStr = p.height === 0 ? '0U верт.' : `${p.height}U`;
    const outletsDesc = p.outlets.map(o => `${o.count}×${o.type}`).join(' + ');
    const totalOutlets = p.outlets.reduce((s,o)=>s+(+o.count||0),0);
    const name = `PDU ${p.phases}ф ${p.rating}A, ${totalOutlets} розеток (${outletsDesc}), ${hStr}`;
    add(name, p.qty);
  });

  // Монтажный крепёж
  const screws = Math.max(20, (t.u - free) * 4 + 20);
  add('Комплект крепежа M6 (болт+гайка+шайба)', screws, 'шт', 'монтажный');

  return rows;
}

function computeWarnings() {
  const t = current();
  const out = [];

  const occ = t.occupied;
  if (occ > t.u) {
    out.push({ lvl: 'err',
      msg: `Занято ${occ}U превышает формат стойки ${t.u}U.` });
  }
  const pduU = t.pdus.reduce((s,p) => s + p.qty * (p.height || 0), 0);
  if (occ + pduU > t.u) {
    out.push({ lvl: 'err',
      msg: `Оборудование (${occ}U) + горизонтальные PDU (${pduU}U) = ${occ+pduU}U, доступно ${t.u}U.` });
  }

  // PDU capacity vs demand — строгое сравнение (запас не требуется)
  const capKw = t.pdus.reduce((s, p) => s + p.qty * pduCapacityKw(p), 0);
  if (t.demandKw > 0) {
    if (capKw < t.demandKw - 1e-6) {
      out.push({ lvl: 'err',
        msg: `Ёмкость PDU ${capKw.toFixed(2)} кВт < заявленная ${t.demandKw} кВт. Добавьте PDU или поднимите номинал.` });
    } else {
      const margin = ((capKw / t.demandKw - 1) * 100);
      out.push({ lvl: 'ok',
        msg: `PDU: ${capKw.toFixed(2)} кВт ёмкость при заявленных ${t.demandKw} кВт (запас ${margin.toFixed(0)}%).` });
    }
  }

  // Охлаждение — уже для стойки в целом, с обычным запасом
  const perfFront = /mesh/.test(t.doorFront) || t.doorFront === 'none';
  const perfRear  = /mesh/.test(t.doorRear)  || t.doorRear === 'none';
  if (t.demandKw >= 3 && (!perfFront || !perfRear)) {
    out.push({ lvl: 'warn',
      msg: `При тепловыделении ≥3 кВт рекомендуются перфорированные двери спереди и сзади.` });
  }
  if (t.demandKw >= 5 && t.top !== 'fan') {
    out.push({ lvl: 'warn',
      msg: `При ≥5 кВт рекомендуется крыша с вентиляторными модулями.` });
  }

  // Стенки
  if (t.sides === 'left' || t.sides === 'right') {
    out.push({ lvl: 'warn',
      msg: `Стенка только с одной стороны — проверьте, что соседняя стойка стоит вплотную.` });
  }
  if (t.sides === 'none') {
    out.push({ lvl: 'warn',
      msg: `Стенки не заказаны — допустимо только в линейке стоек.` });
  }

  return out;
}

/* ---------- превью ---------- */
function renderWarnings() {
  const host = el('rc-warn');
  host.innerHTML = '';
  computeWarnings().forEach(w => {
    const d = document.createElement('div');
    d.className = 'rc-warn-item ' + w.lvl;
    d.textContent = (w.lvl === 'err' ? '⛔ ' : w.lvl === 'warn' ? '⚠ ' : '✓ ') + w.msg;
    host.appendChild(d);
  });
}
function renderBom() {
  const rows = computeBom();
  el('rc-bom').innerHTML = `
    <thead><tr>
      <th>#</th><th>Позиция</th><th>Кол-во</th><th>Ед.</th><th>Примечание</th>
    </tr></thead>
    <tbody>
      ${rows.map((r,i) => `
        <tr>
          <td>${i+1}</td>
          <td>${escape(r.name)}</td>
          <td class="rc-qty">${r.qty}</td>
          <td>${r.unit}</td>
          <td>${escape(r.note||'')}</td>
        </tr>`).join('')}
      <tr class="rc-total">
        <td colspan="2">Всего позиций</td>
        <td class="rc-qty">${rows.length}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>`;
}
function recalc() {
  const t = current();
  if (!t) return;
  el('rc-free').value = Math.max(0, t.u - t.occupied);
  applyKitLocks();
  renderWarnings();
  renderBom();
}

/* ---------- CSV ---------- */
function exportCsv() {
  const t = current();
  const rows = computeBom();
  const head = ['#','Позиция','Кол-во','Ед.','Примечание'];
  const body = rows.map((r,i) => [i+1, r.name, r.qty, r.unit, r.note||'']);
  const csv = [head, ...body]
    .map(r => r.map(cell => {
      const s = String(cell);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(';'))
    .join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rack-bom-${(t.name||'tpl').replace(/[^\wа-яА-Я\-]/g,'_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- управление шаблонами ---------- */
function addTemplate(src) {
  const t = src ? JSON.parse(JSON.stringify(src)) : makeBlankTemplate();
  t.id = 'tpl-' + Math.random().toString(36).slice(2, 9);
  if (src) t.name = (src.name || 'Шаблон') + ' (копия)';
  state.templates.push(t);
  state.currentId = t.id;
  saveTemplates();
  renderTemplateList();
  renderForm();
}
function deleteTemplate() {
  if (!confirm('Удалить текущий шаблон?')) return;
  const idx = state.templates.findIndex(t => t.id === state.currentId);
  if (idx < 0) return;
  state.templates.splice(idx, 1);
  if (!state.templates.length) state.templates.push(makeBlankTemplate());
  state.currentId = state.templates[Math.max(0, idx-1)].id;
  saveTemplates();
  renderTemplateList();
  renderForm();
}

/* ---------- мост с основной схемой (роадмап 1.23.10) ---------- */
function getNodeIdFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    return params.get('nodeId') || null;
  } catch { return null; }
}
function loadFromBridge(nodeId) {
  try {
    const raw = localStorage.getItem(BRIDGE_KEY_PREFIX + nodeId);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch { return null; }
}
function sendApplyToHost() {
  const t = current();
  if (!state.nodeId) { alert('Шаблон не привязан к узлу схемы.'); return; }
  readForm();
  try {
    localStorage.setItem(BRIDGE_KEY_PREFIX + state.nodeId,
      JSON.stringify({ applied: true, ts: Date.now(), template: t }));
  } catch (e) { alert('Не удалось передать шаблон: ' + e.message); return; }
  // postMessage родительскому окну если есть
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: 'raschet.rack.apply', nodeId: state.nodeId, template: t,
      }, '*');
    }
  } catch {}
  alert('Шаблон применён к узлу схемы. Можно закрыть вкладку.');
}

/* ---------- bind ---------- */
function bind() {
  const ids = ['rc-name','rc-manufacturer','rc-u','rc-width','rc-depth',
    'rc-door-front','rc-door-rear','rc-door-with-lock','rc-lock',
    'rc-sides','rc-top','rc-base','rc-combo-top-base',
    'rc-entry-top','rc-entry-bot','rc-entry-type',
    'rc-occupied','rc-blank-type','rc-demand-kw','rc-cosphi','rc-comment'];
  ids.forEach(id => {
    const node = el(id);
    if (!node) return;
    node.addEventListener('change', () => { readForm(); renderTemplateList(); recalc(); });
  });

  el('rc-kit').addEventListener('change', () => {
    const t = current();
    t.kitId = el('rc-kit').value;
    applyKitPreset();
    renderForm();
  });

  el('rc-template').addEventListener('change', () => {
    state.currentId = el('rc-template').value;
    renderForm();
  });
  el('rc-new').addEventListener('click', () => addTemplate(null));
  el('rc-dup').addEventListener('click', () => { readForm(); addTemplate(current()); });
  el('rc-del').addEventListener('click', deleteTemplate);
  el('rc-pdu-add').addEventListener('click', () => {
    const t = current();
    t.pdus.push({ id: 'pdu'+Date.now(), qty:1, rating:16, phases:1, height:0,
      outlets: [ { type: 'C13', count: 8 } ] });
    renderPduList(); recalc();
  });

  el('rc-save').addEventListener('click', () => {
    readForm();
    saveTemplates();
    renderTemplateList();
    alert('Шаблон «' + (current().name || '—') + '» сохранён в localStorage.');
  });
  el('rc-bom-csv').addEventListener('click', () => { readForm(); exportCsv(); });
  el('rc-bom-print').addEventListener('click', () => window.print());

  // кнопка «Применить к узлу» появляется если ?nodeId=…
  const applyBtn = el('rc-apply-to-node');
  if (applyBtn) applyBtn.addEventListener('click', sendApplyToHost);
}

/* ---------- init ---------- */
function init() {
  renderKitSelect();
  state.templates = loadTemplates();
  if (!state.templates.length) state.templates.push(makeBlankTemplate('Стойка серверная 42U'));

  // привязка к узлу из URL
  state.nodeId = getNodeIdFromUrl();
  if (state.nodeId) {
    const bridge = loadFromBridge(state.nodeId);
    if (bridge && bridge.template) {
      // подгружаем шаблон как текущий (не в общий localStorage)
      const t = JSON.parse(JSON.stringify(bridge.template));
      t.id = 'tpl-node-' + state.nodeId;
      // убеждаемся, что шаблон есть в списке или подменяем первый
      const ix = state.templates.findIndex(x => x.id === t.id);
      if (ix >= 0) state.templates[ix] = t;
      else state.templates.unshift(t);
      state.currentId = t.id;
    } else {
      state.currentId = state.templates[0].id;
    }
    // показываем UI «применить к узлу»
    document.body.classList.add('rc-has-node');
    injectApplyUi();
  } else {
    state.currentId = state.templates[0].id;
  }

  renderTemplateList();
  renderForm();
  bind();
}

function injectApplyUi() {
  // добавляем кнопку в блок «Сохранение»
  const saveBtn = el('rc-save');
  if (!saveBtn) return;
  const wrap = saveBtn.parentElement;
  const info = document.createElement('div');
  info.className = 'rc-warn-item ok';
  info.style.marginBottom = '8px';
  info.innerHTML = `✓ Шаблон связан с узлом схемы <code>${escape(state.nodeId)}</code>. Нажмите «Применить», чтобы передать конфигурацию обратно в основной проект.`;
  wrap.insertBefore(info, saveBtn);
  const apply = document.createElement('button');
  apply.id = 'rc-apply-to-node';
  apply.type = 'button';
  apply.className = 'rc-btn rc-btn-primary';
  apply.textContent = '↩ Применить к узлу схемы';
  apply.style.marginLeft = '8px';
  saveBtn.insertAdjacentElement('afterend', apply);
  apply.addEventListener('click', sendApplyToHost);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
