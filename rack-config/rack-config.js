/* =========================================================================
   rack-config/rack-config.js
   MVP конфигуратор 19" стойки:
    - форма параметров (U, ширина, глубина, двери, аксессуары, кабельные вводы,
      заглушки пустых U, PDU)
    - проверка мощности PDU vs заявленная demandKw (с учётом cosφ, фаз и
      номинала), проверка занятых U, предупреждения по дверям/охлаждению
    - BOM на заказ (корпус, двери, стенки, крыша, основание, вводы, заглушки, PDU)
    - CSV-экспорт, печать
    - хранение шаблонов в localStorage (ключ rack-config.templates.v1)
   Интеграция с узлом consumer/rack основного проекта — roadmap 1.23.10.
   ========================================================================= */

'use strict';

const LS_KEY = 'rack-config.templates.v1';

/* ---------- справочные таблицы для BOM ---------- */
const DOOR_LABEL = {
  glass:  'Дверь стекло (закалённое) с замком',
  mesh:   'Дверь перфорированная (сетка) с замком',
  metal:  'Дверь металлическая глухая',
  double: 'Дверь двустворчатая перфорированная',
  none:   null,
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
  key:     'Замок ключевой',
  code:    'Замок кодовый',
  electro: 'Электрозамок',
};
const BLANK_LABEL = {
  '1U-solid': 'Заглушка 1U глухая',
  '1U-vent':  'Заглушка 1U перфорированная',
  '2U-solid': 'Заглушка 2U глухая',
};
const BLANK_U = { '1U-solid': 1, '1U-vent': 1, '2U-solid': 2 };

/* ---------- state ---------- */
function makeBlankTemplate(name = 'Новый шаблон') {
  return {
    id: 'tpl-' + Math.random().toString(36).slice(2, 9),
    name,
    manufacturer: '',
    u: 42,
    width: 600,
    depth: 1000,
    doorFront: 'mesh',
    doorRear: 'mesh',
    lock: 'key',
    sideL: true,
    sideR: true,
    top: 'vent',
    base: 'feet',
    entryTop: 2,
    entryBot: 2,
    entryType: 'brush',
    occupied: 0,
    blankType: '1U-solid',
    demandKw: 5,
    cosphi: 0.9,
    pdus: [
      { id: 'pdu1', qty: 1, rating: 16, phases: 1, height: 0, outlets: 8, outletType: 'C13', mount: 'vertical' }
    ],
    comment: '',
  };
}

const state = {
  templates: [],
  currentId: null,
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
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.templates));
  } catch (e) {
    alert('Не удалось сохранить шаблон: ' + e.message);
  }
}

/* ---------- helpers ---------- */
function el(id) { return document.getElementById(id); }
function current() { return state.templates.find(t => t.id === state.currentId) || null; }

/* ---------- форма ↔ state ---------- */
function renderTemplateList() {
  const sel = el('rc-template');
  sel.innerHTML = '';
  state.templates.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name || '(без имени)';
    sel.appendChild(o);
  });
  if (state.currentId) sel.value = state.currentId;
}

function renderForm() {
  const t = current();
  if (!t) return;
  el('rc-name').value         = t.name || '';
  el('rc-manufacturer').value = t.manufacturer || '';
  el('rc-u').value            = String(t.u);
  el('rc-width').value        = String(t.width);
  el('rc-depth').value        = String(t.depth);
  el('rc-door-front').value   = t.doorFront;
  el('rc-door-rear').value    = t.doorRear;
  el('rc-lock').value         = t.lock;
  el('rc-side-l').checked     = !!t.sideL;
  el('rc-side-r').checked     = !!t.sideR;
  el('rc-top').value          = t.top;
  el('rc-base').value         = t.base;
  el('rc-entry-top').value    = t.entryTop;
  el('rc-entry-bot').value    = t.entryBot;
  el('rc-entry-type').value   = t.entryType;
  el('rc-occupied').value     = t.occupied;
  el('rc-blank-type').value   = t.blankType;
  el('rc-demand-kw').value    = t.demandKw;
  el('rc-cosphi').value       = t.cosphi;
  el('rc-comment').value      = t.comment || '';
  renderPduList();
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
  t.lock         = el('rc-lock').value;
  t.sideL        = el('rc-side-l').checked;
  t.sideR        = el('rc-side-r').checked;
  t.top          = el('rc-top').value;
  t.base         = el('rc-base').value;
  t.entryTop     = Math.max(0, parseInt(el('rc-entry-top').value, 10) || 0);
  t.entryBot     = Math.max(0, parseInt(el('rc-entry-bot').value, 10) || 0);
  t.entryType    = el('rc-entry-type').value;
  t.occupied     = Math.max(0, parseInt(el('rc-occupied').value, 10) || 0);
  t.blankType    = el('rc-blank-type').value;
  t.demandKw     = Math.max(0, parseFloat(el('rc-demand-kw').value) || 0);
  t.cosphi       = Math.min(1, Math.max(0.5, parseFloat(el('rc-cosphi').value) || 0.9));
  t.comment      = el('rc-comment').value;
}

/* ---------- PDU ---------- */
function renderPduList() {
  const t = current();
  const host = el('rc-pdu-list');
  host.innerHTML = '';
  t.pdus.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'rc-pdu-item';
    row.innerHTML = `
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
      <label class="rc-field"><span>Розеток</span>
        <input type="number" min="1" step="1" data-k="outlets" value="${p.outlets}">
      </label>
      <label class="rc-field"><span>Тип розеток</span>
        <select data-k="outletType">
          ${['C13','C19','Schuko','mix'].map(x => `<option value="${x}" ${p.outletType===x?'selected':''}>${x}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="rc-btn rc-btn-danger" data-del="${idx}">✕</button>
    `;
    row.querySelectorAll('[data-k]').forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        const v = inp.value;
        if (k === 'qty' || k === 'outlets') p[k] = Math.max(1, parseInt(v,10)||1);
        else if (k === 'phases' || k === 'height') p[k] = parseInt(v,10)||0;
        else if (k === 'rating') p.rating = parseInt(v,10);
        else p[k] = v;
        recalc();
      });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      t.pdus.splice(idx, 1);
      renderPduList();
      recalc();
    });
    host.appendChild(row);
  });
}

/* ---------- расчёт ---------- */
function pduCapacityKw(p) {
  // P = U × I × √(phases) × cosφ; однофазный: 230×I×cosφ; трёхфазный: √3×400×I×cosφ
  const cos = current().cosphi || 0.9;
  const I = p.rating;
  if (p.phases === 3) return (Math.sqrt(3) * 400 * I * cos) / 1000;
  return (230 * I * cos) / 1000;
}

function computeBom() {
  const t = current();
  const rows = [];
  const add = (name, qty, unit = 'шт', note = '') => {
    if (!name || qty <= 0) return;
    rows.push({ name, qty, unit, note });
  };

  add(`Стойка 19" ${t.u}U ${t.width}×${t.depth} мм` +
      (t.manufacturer ? ` (${t.manufacturer})` : ''), 1);

  if (DOOR_LABEL[t.doorFront]) add(DOOR_LABEL[t.doorFront] + ' — передняя', 1);
  if (DOOR_LABEL[t.doorRear])  add(DOOR_LABEL[t.doorRear]  + ' — задняя',   1);
  if (LOCK_LABEL[t.lock])      add(LOCK_LABEL[t.lock], (DOOR_LABEL[t.doorFront]?1:0) + (DOOR_LABEL[t.doorRear]?1:0));

  if (t.sideL) add('Боковая стенка левая', 1);
  if (t.sideR) add('Боковая стенка правая', 1);
  if (TOP_LABEL[t.top]) add(TOP_LABEL[t.top], 1);
  if (BASE_LABEL[t.base]) add(BASE_LABEL[t.base], 1);

  if (ENTRY_LABEL[t.entryType]) {
    const n = (t.entryTop||0) + (t.entryBot||0);
    if (n > 0) add(ENTRY_LABEL[t.entryType], n, 'шт',
      `сверху ${t.entryTop}, снизу ${t.entryBot}`);
  }

  const free = Math.max(0, t.u - t.occupied);
  const bu = BLANK_U[t.blankType] || 1;
  const blanksQty = Math.floor(free / bu);
  if (blanksQty > 0 && BLANK_LABEL[t.blankType]) {
    add(BLANK_LABEL[t.blankType], blanksQty, 'шт', `покрытие ${blanksQty*bu}U из ${free}U свободных`);
  }

  // PDU
  t.pdus.forEach(p => {
    const hStr = p.height === 0 ? '0U верт.' : `${p.height}U`;
    const name = `PDU ${p.phases}ф ${p.rating}A, ${p.outlets}×${p.outletType}, ${hStr}`;
    add(name, p.qty);
  });

  // Монтажный комплект
  const screws = Math.max(20, (t.u - Math.max(0, t.u - t.occupied)) * 4 + 20);
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

  // Мощность PDU vs demandKw
  const capKw = t.pdus.reduce((s, p) => s + p.qty * pduCapacityKw(p), 0);
  if (t.demandKw > 0) {
    if (capKw < t.demandKw) {
      out.push({ lvl: 'err',
        msg: `Суммарная ёмкость PDU ${capKw.toFixed(2)} кВт < заявленная ${t.demandKw} кВт. Добавьте PDU или повысьте номинал.` });
    } else if (capKw < t.demandKw * 1.2) {
      out.push({ lvl: 'warn',
        msg: `Запас по мощности <20%: ёмкость ${capKw.toFixed(2)} кВт, заявлено ${t.demandKw} кВт.` });
    } else {
      out.push({ lvl: 'ok',
        msg: `PDU: ${capKw.toFixed(2)} кВт ёмкость при заявленных ${t.demandKw} кВт (запас ${((capKw/t.demandKw-1)*100).toFixed(0)}%).` });
    }
  }

  // Охлаждение / двери
  const dFront = t.doorFront, dRear = t.doorRear;
  const perfFront = dFront === 'mesh' || dFront === 'none';
  const perfRear  = dRear  === 'mesh' || dRear === 'double' || dRear === 'none';
  const heatKw = t.demandKw;
  if (heatKw >= 3 && (!perfFront || !perfRear)) {
    out.push({ lvl: 'warn',
      msg: `При тепловыделении ≥3 кВт рекомендуются перфорированные двери спереди и сзади (сейчас: ${dFront}/${dRear}).` });
  }
  if (heatKw >= 5 && t.top !== 'fan') {
    out.push({ lvl: 'warn',
      msg: `При ≥5 кВт рекомендуется крыша с вентиляторными модулями.` });
  }

  // Стенки
  if (!t.sideL || !t.sideR) {
    out.push({ lvl: 'warn',
      msg: `Снята ${!t.sideL && !t.sideR ? 'обе боковые стенки' : 'боковая стенка'} — допустимо только в линейке из нескольких стоек.` });
  }

  return out;
}

/* ---------- превью ---------- */
function renderWarnings() {
  const host = el('rc-warn');
  host.innerHTML = '';
  const ws = computeWarnings();
  ws.forEach(w => {
    const d = document.createElement('div');
    d.className = 'rc-warn-item ' + w.lvl;
    d.textContent = (w.lvl === 'err' ? '⛔ ' : w.lvl === 'warn' ? '⚠ ' : '✓ ') + w.msg;
    host.appendChild(d);
  });
}

function renderBom() {
  const rows = computeBom();
  const tbl = el('rc-bom');
  tbl.innerHTML = `
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

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function recalc() {
  const t = current();
  if (!t) return;
  el('rc-free').value = Math.max(0, t.u - t.occupied);
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

/* ---------- bind ---------- */
function bind() {
  // все простые поля — change (не input; см. MEMORY)
  const ids = ['rc-name','rc-manufacturer','rc-u','rc-width','rc-depth',
    'rc-door-front','rc-door-rear','rc-lock','rc-side-l','rc-side-r',
    'rc-top','rc-base','rc-entry-top','rc-entry-bot','rc-entry-type',
    'rc-occupied','rc-blank-type','rc-demand-kw','rc-cosphi','rc-comment'];
  ids.forEach(id => {
    const node = el(id);
    if (!node) return;
    const ev = (node.tagName === 'SELECT' || node.type === 'checkbox') ? 'change' : 'change';
    node.addEventListener(ev, () => { readForm(); renderTemplateList(); recalc(); });
  });

  el('rc-template').addEventListener('change', () => {
    state.currentId = el('rc-template').value;
    renderForm();
  });
  el('rc-new').addEventListener('click', () => addTemplate(null));
  el('rc-dup').addEventListener('click', () => {
    readForm();
    addTemplate(current());
  });
  el('rc-del').addEventListener('click', deleteTemplate);
  el('rc-pdu-add').addEventListener('click', () => {
    const t = current();
    t.pdus.push({ id: 'pdu'+Date.now(), qty:1, rating:16, phases:1, height:0, outlets:8, outletType:'C13', mount:'vertical' });
    renderPduList();
    recalc();
  });

  el('rc-save').addEventListener('click', () => {
    readForm();
    saveTemplates();
    renderTemplateList();
    alert('Шаблон «' + (current().name || '—') + '» сохранён в localStorage.');
  });
  el('rc-bom-csv').addEventListener('click', () => { readForm(); exportCsv(); });
  el('rc-bom-print').addEventListener('click', () => window.print());
}

/* ---------- init ---------- */
function init() {
  state.templates = loadTemplates();
  if (!state.templates.length) state.templates.push(makeBlankTemplate('Стойка серверная 42U'));
  state.currentId = state.templates[0].id;
  renderTemplateList();
  renderForm();
  bind();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
