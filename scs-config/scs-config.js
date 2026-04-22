/* =========================================================================
   scs-config/scs-config.js — Phase 1.24 MVP.
   Конфигуратор СКС / телеком-оборудования: описывает содержимое стойки.

   Входные данные:
     • Шаблоны стоек — читаются из localStorage['rack-config.templates.v1']
       (корпус, U, занятые юниты, заглушки, PDU-раскладка).
     • Каталог типов оборудования — локальный (см. DEFAULT_CATALOG ниже),
       пользователь может дописать свои типы.

   Хранилище:
     • localStorage['scs-config.catalog.v1']   — [{id, kind, label, heightU,
       powerW, ports, color}]
     • localStorage['scs-config.contents.v1']  — { [rackId]: [{id, typeId,
       label, positionU (верхний U), pduFeed, pduOutlet}] }
     • localStorage['scs-config.matrix.v1']    — { [rackId]: [{id, a, b,
       cable, lengthM, color}] }

   Интерфейс (1.24.1–1.24.8):
     — выбор стойки (rack template);
     — правка каталога типов;
     — список размещённого оборудования с U-позицией;
     — проверки: наложение по U, наезд на заглушки, переполнение PDU;
     — SVG-карта фронт-вью с цветными полосами по типам;
     — СКС-матрица «порт ↔ порт» для патч-кордов;
     — BOM по типам + CSV-экспорт.

   ЗАВИСИМОСТИ: не импортирует никакой engine-код — работает автономно,
   читая готовые шаблоны стоек. Это делает модуль полезным и вне основной
   схемы: можно спроектировать стойку отдельно для закупки.
   ========================================================================= */

const LS_RACK      = 'rack-config.templates.v1';
const LS_CATALOG   = 'scs-config.catalog.v1';
const LS_CONTENTS  = 'scs-config.contents.v1';
const LS_MATRIX    = 'scs-config.matrix.v1';
const LS_TEMPLATES = 'scs-config.assemblyTemplates.v1'; // 1.24.7
const LS_CART      = 'scs-config.cart.v1';              // 1.24.28
const LS_RACKTAGS  = 'scs-config.rackTags.v1';          // 1.24.23 — { [rackId]: tag }
const LS_WAREHOUSE = 'scs-config.warehouse.v1';         // 1.24.32 — склад проекта

/* ---- базовый каталог типов оборудования (1.24.2) ---------------------- */
const DEFAULT_CATALOG = [
  { id: 'sw-24',   kind: 'switch',       label: 'Коммутатор 24×1G',         heightU: 1, powerW: 45,  ports: 24, color: '#60a5fa' },
  { id: 'sw-48',   kind: 'switch',       label: 'Коммутатор 48×1G + 4SFP+', heightU: 1, powerW: 95,  ports: 48, color: '#3b82f6' },
  { id: 'pp-24',   kind: 'patch-panel',  label: 'Патч-панель 24 cat.6',     heightU: 1, powerW: 0,   ports: 24, color: '#fbbf24' },
  { id: 'pp-48',   kind: 'patch-panel',  label: 'Патч-панель 48 cat.6',     heightU: 2, powerW: 0,   ports: 48, color: '#f59e0b' },
  { id: 'srv-1u',  kind: 'server',       label: 'Сервер 1U',                heightU: 1, powerW: 450, ports: 4,  color: '#a78bfa' },
  { id: 'srv-2u',  kind: 'server',       label: 'Сервер 2U',                heightU: 2, powerW: 750, ports: 4,  color: '#8b5cf6' },
  { id: 'kvm',     kind: 'kvm',          label: 'Консоль KVM 1U',           heightU: 1, powerW: 20,  ports: 8,  color: '#34d399' },
  { id: 'mon-1u',  kind: 'monitor',      label: 'Монитор 1U (выдвижной)',   heightU: 1, powerW: 25,  ports: 1,  color: '#10b981' },
  { id: 'ups-1u',  kind: 'ups',          label: 'ИБП 1U 1 кВА',             heightU: 1, powerW: 900, ports: 0,  color: '#f472b6' },
  { id: 'cm-1u',   kind: 'cable-manager',label: 'Кабельный органайзер 1U',  heightU: 1, powerW: 0,   ports: 0,  color: '#94a3b8' },
];

const KIND_LABEL = {
  'switch': 'Коммутатор', 'patch-panel': 'Патч-панель', 'server': 'Сервер',
  'kvm': 'KVM', 'monitor': 'Монитор', 'ups': 'ИБП-1U', 'cable-manager': 'Органайзер', 'other': 'Другое',
};

/* ---- state ------------------------------------------------------------- */
const state = {
  racks: [],         // шаблоны из rack-config
  currentRackId: null,
  catalog: [],       // типы оборудования
  contents: {},      // { rackId: [device] }
  matrix: {},        // { rackId: [link] }
  templates: [],     // [{id, name, contents, matrix}] — «готовые сборки» (1.24.7)
  cart: [],          // 1.24.28 — «тележка»: [{id, typeId, label, fromRackId, fromRackName, pduFeed, pduOutlet, takenAt}]
  rackTags: {},      // 1.24.23 — { [rackId]: 'DC1.H3.R05' }
  warehouse: [],     // 1.24.32 — склад: та же модель что cart
  // view mode: 'scs' — цвет по типу; 'power' — цвет по вводу PDU (1.24.11)
  viewMode: 'scs',
  // drag state
  drag: null,        // { devId, startY, startU, rowH, r }
};

/* ---- цвет вводов для view=power (1.24.11) ----------------------------- */
const FEED_COLORS = { 'A': '#3b82f6', 'B': '#ef4444', 'C': '#22c55e', 'D': '#a855f7' };
function feedColor(feed) {
  if (!feed) return '#cbd5e1';
  return FEED_COLORS[feed] || '#f59e0b';
}

/* ---- utils ------------------------------------------------------------- */
function $(id) { return document.getElementById(id); }
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 9); }

/* =========================================================================
   In-page UI вместо alert/confirm/prompt браузера.
   Host-контейнер создаётся лениво и монтируется в <body>.
   ========================================================================= */
function scUiHost() {
  let h = document.getElementById('sc-ui-host');
  if (!h) {
    h = document.createElement('div');
    h.id = 'sc-ui-host';
    document.body.appendChild(h);
  }
  return h;
}
function scToast(msg, kind) {
  kind = kind || 'info'; // info | ok | warn | err
  const host = scUiHost();
  const el = document.createElement('div');
  el.className = 'sc-toast sc-toast-' + kind;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('sc-toast-shown'));
  setTimeout(() => {
    el.classList.remove('sc-toast-shown');
    setTimeout(() => el.remove(), 250);
  }, kind === 'err' ? 5000 : 3000);
}
function scConfirm(title, message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const host = scUiHost();
    const back = document.createElement('div');
    back.className = 'sc-modal-back';
    back.innerHTML = `
      <div class="sc-modal-card" role="dialog" aria-modal="true">
        <div class="sc-modal-title">${escape(title)}</div>
        ${message ? `<div class="sc-modal-msg">${escape(message)}</div>` : ''}
        ${opts.input != null ? `<input class="sc-modal-input" type="text" value="${escape(opts.input)}" />` : ''}
        <div class="sc-modal-actions">
          <button type="button" class="sc-btn" data-v="0">${escape(opts.cancelLabel || 'Отмена')}</button>
          <button type="button" class="sc-btn sc-btn-primary" data-v="1">${escape(opts.okLabel || 'OK')}</button>
        </div>
      </div>`;
    host.appendChild(back);
    const input = back.querySelector('.sc-modal-input');
    const close = (result) => {
      back.classList.remove('sc-modal-open');
      setTimeout(() => back.remove(), 150);
      resolve(result);
    };
    back.querySelector('[data-v="1"]').addEventListener('click', () => close(input ? (input.value || '') : true));
    back.querySelector('[data-v="0"]').addEventListener('click', () => close(input ? null : false));
    back.addEventListener('click', ev => { if (ev.target === back) close(input ? null : false); });
    requestAnimationFrame(() => {
      back.classList.add('sc-modal-open');
      if (input) { input.focus(); input.select(); }
    });
    back.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') close(input ? null : false);
      if (ev.key === 'Enter' && input) close(input.value || '');
    });
  });
}
function scPrompt(title, defaultValue) {
  return scConfirm(title, '', { input: defaultValue ?? '' });
}

/* ---- persistence ------------------------------------------------------- */
function loadRacks() {
  try {
    const raw = localStorage.getItem(LS_RACK);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveCatalog()   { try { localStorage.setItem(LS_CATALOG,   JSON.stringify(state.catalog));   } catch {} }
function saveContents()  { try { localStorage.setItem(LS_CONTENTS,  JSON.stringify(state.contents));  } catch {} }
function saveMatrix()    { try { localStorage.setItem(LS_MATRIX,    JSON.stringify(state.matrix));    } catch {} }
function saveTemplates() { try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(state.templates)); } catch {} }
function saveCart()      { try { localStorage.setItem(LS_CART,      JSON.stringify(state.cart));      } catch {} }
function saveRackTags()  { try { localStorage.setItem(LS_RACKTAGS,  JSON.stringify(state.rackTags));  } catch {} }
function saveWarehouse() { try { localStorage.setItem(LS_WAREHOUSE, JSON.stringify(state.warehouse)); } catch {} }

/* Текущий TIA-тег стойки (из state.rackTags) или «DC1.R<u>» как fallback */
function currentRackTag() {
  const r = currentRack(); if (!r) return '';
  return (state.rackTags[r.id] || '').trim();
}
/* Генерируемый тег устройства: <rackTag>.U<top>-U<bottom> (TIA-606) */
function deviceTag(d) {
  const r = currentRack(); if (!r) return '';
  const tag = (state.rackTags[r.id] || '').trim();
  if (!tag) return '';
  const type = state.catalog.find(c => c.id === d.typeId);
  const h = type ? type.heightU : 1;
  const bottom = d.positionU - h + 1;
  return h > 1 ? `${tag}.U${d.positionU}-${bottom}` : `${tag}.U${d.positionU}`;
}

/* ---- список доступных PDU-розеток текущей стойки (1.24.4 full) -------
   Разворачивает rack.pdus → плоский список { feed, outletIdx, typeLabel,
   pduLabel }. Каждый PDU может иметь qty>1 → создаём отдельные блоки
   «PDU-инстансов» по qty. outletIdx нумеруется в пределах инстанса PDU. */
function pduOutletOptions(rack) {
  if (!rack || !Array.isArray(rack.pdus)) return [];
  const opts = [];
  rack.pdus.forEach((p, pduIdx) => {
    const qty = Math.max(1, +p.qty || 1);
    for (let q = 0; q < qty; q++) {
      const pduLabel = `PDU${pduIdx + 1}${qty > 1 ? '.' + (q + 1) : ''} ${p.rating}A/${p.phases}ф · ${p.feed}`;
      const outlets = Array.isArray(p.outlets) ? p.outlets : [];
      let slot = 1;
      outlets.forEach(o => {
        const count = Math.max(0, +o.count || 0);
        for (let i = 0; i < count; i++, slot++) {
          opts.push({
            feed: p.feed,
            outlet: `P${pduIdx + 1}${qty > 1 ? '.' + (q + 1) : ''}-${slot}`,
            typeLabel: o.type,
            pduLabel,
          });
        }
      });
    }
  });
  return opts;
}

/** unique feeds в стойке (для простого dropdown ввода) */
function pduFeeds(rack) {
  if (!rack || !Array.isArray(rack.pdus)) return [];
  return [...new Set(rack.pdus.map(p => p.feed).filter(Boolean))];
}

/* ---- current rack helpers --------------------------------------------- */
function currentRack() {
  return state.racks.find(r => r.id === state.currentRackId) || null;
}
function currentContents() {
  if (!state.currentRackId) return [];
  if (!state.contents[state.currentRackId]) state.contents[state.currentRackId] = [];
  return state.contents[state.currentRackId];
}
function currentMatrix() {
  if (!state.currentRackId) return [];
  if (!state.matrix[state.currentRackId]) state.matrix[state.currentRackId] = [];
  return state.matrix[state.currentRackId];
}

/* ---- render: верх (выбор стойки) --------------------------------------- */
function renderRackPicker() {
  const sel = $('sc-rack');
  sel.innerHTML = state.racks.length
    ? state.racks.map(r => `<option value="${r.id}">${escape(r.name || 'Без имени')} · ${r.u}U</option>`).join('')
    : `<option value="">— нет шаблонов стоек; создайте в Конфигураторе стойки —</option>`;
  if (state.currentRackId) sel.value = state.currentRackId;
  else if (state.racks[0]) {
    state.currentRackId = state.racks[0].id;
    sel.value = state.currentRackId;
  }
  const r = currentRack();
  $('sc-rack-u').textContent = r ? r.u : '—';
  $('sc-rack-occ').textContent = r ? r.occupied : '—';
}

/* ---- render: каталог типов --------------------------------------------- */
function renderCatalog() {
  const t = $('sc-catalog');
  const rows = [`<tr>
    <th>Тип</th><th>Название</th><th>U</th><th>Вт</th><th>Порты</th>
    <th style="width:40px">цвет</th><th style="width:90px"></th>
  </tr>`];
  state.catalog.forEach((c, idx) => {
    rows.push(`<tr data-idx="${idx}" draggable="true" data-typeid="${c.id}" title="Перетащите на карту юнитов чтобы разместить в конкретный U">
      <td><select data-k="kind">${Object.keys(KIND_LABEL).map(k =>
        `<option value="${k}"${c.kind===k?' selected':''}>${KIND_LABEL[k]}</option>`).join('')}</select></td>
      <td><input data-k="label" value="${escape(c.label)}"></td>
      <td><input data-k="heightU" type="number" min="1" step="1" value="${c.heightU}"></td>
      <td><input data-k="powerW" type="number" min="0" step="1" value="${c.powerW}"></td>
      <td><input data-k="ports" type="number" min="0" step="1" value="${c.ports}"></td>
      <td><input data-k="color" type="color" value="${c.color || '#94a3b8'}" style="width:40px;padding:0"></td>
      <td>
        <button type="button" class="sc-btn" data-add="${c.id}">➕ в стойку</button>
        <button type="button" class="sc-btn sc-btn-danger" data-del="${c.id}" title="Удалить тип">✕</button>
      </td>
    </tr>`);
  });
  t.innerHTML = rows.join('');
  // bind cell editing
  t.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('change', () => {
      const tr = el.closest('tr');
      const idx = +tr.dataset.idx;
      const k = el.dataset.k;
      const v = el.type === 'number' ? +el.value : el.value;
      state.catalog[idx][k] = v;
      saveCatalog();
      rerender(); // цвет/heightU → перерисовать карту, BOM
    });
  });
  t.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addToRack(b.dataset.add)));
  // 1.24.10 drag-source: строка каталога → карта юнитов
  t.querySelectorAll('tr[data-typeid]').forEach(tr => {
    tr.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('application/x-scs-typeid', tr.dataset.typeid);
      ev.dataTransfer.effectAllowed = 'copy';
      tr.classList.add('sc-drag-src');
      const type = state.catalog.find(c => c.id === tr.dataset.typeid);
      if (type) setDragGhost(ev, type, type.label);
    });
    tr.addEventListener('dragend', () => { tr.classList.remove('sc-drag-src'); state._dragMeta = null; });
  });
  t.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    scConfirm('Удалить тип оборудования?', 'Уже размещённые единицы в стойках НЕ будут удалены.', { okLabel: 'Удалить' }).then(ok => {
      if (!ok) return;
      state.catalog = state.catalog.filter(c => c.id !== id);
      saveCatalog();
      renderCatalog();
    });
  }));
}

/* ---- добавление устройства в стойку ------------------------------------ */
function addToRack(typeId, forcedU) {
  const r = currentRack(); if (!r) { scToast('Сначала выберите стойку', 'warn'); return; }
  const type = state.catalog.find(c => c.id === typeId); if (!type) return;
  let positionU;
  if (Number.isFinite(forcedU)) {
    // clamp так чтобы устройство влезло: top должен быть ≥ heightU
    positionU = Math.max(type.heightU, Math.min(r.u, forcedU));
  } else {
    positionU = findFirstFreeSlot(r, currentContents(), type.heightU);
  }
  const dev = {
    id: uid('dev'),
    typeId,
    label: type.label,
    positionU, // номер верхнего U устройства (1…r.u)
    pduFeed: '', pduOutlet: '',
  };
  currentContents().push(dev);
  saveContents();
  renderContents();
  rerenderPreview();
  return dev;
}

/* Ищет первую свободную область heightU подряд сверху вниз, с учётом занятых
   юнитов (r.occupied сверху) и уже расставленных устройств. Возвращает U-номер
   верхнего юнита устройства или r.u - r.occupied (первый после «оборудования»). */
function findFirstFreeSlot(r, devices, heightU) {
  // занятость: массив length=r.u, true если занято
  const occ = new Array(r.u + 1).fill(false); // 1..r.u
  // верхние "occupied" юниты стойки — считаем, что это уже занятое оборудование «общей группой»
  // в rack-config это верхний блок. Нас интересуют только свободные/заглушечные места.
  for (let u = r.u; u > r.u - r.occupied; u--) occ[u] = true;
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) occ[d.positionU - k] = true;
  });
  // ищем сверху вниз первый свободный блок heightU (сверху = больший U)
  for (let top = r.u - r.occupied; top >= heightU; top--) {
    let ok = true;
    for (let k = 0; k < heightU; k++) if (occ[top - k]) { ok = false; break; }
    if (ok) return top;
  }
  return 1; // нет места — на дно, detectConflicts подсветит
}

/* ---- render: контент стойки ------------------------------------------- */
function renderContents() {
  const t = $('sc-contents');
  const r = currentRack();
  const devices = currentContents();
  if (!r) { t.innerHTML = '<tr><td>Нет выбранной стойки</td></tr>'; return; }
  const conflicts = detectConflicts(r, devices);
  const rows = [`<tr>
    <th>U</th><th>Тип</th><th>Название</th><th title="TIA-606">Тег</th><th>Ввод</th><th>PDU outlet</th>
    <th style="width:50px"></th>
  </tr>`];
  const feeds = pduFeeds(r);
  const allOutlets = pduOutletOptions(r);
  // счётчик использования розеток для проверки «один слот = одно устройство»
  const outletUsage = new Map();
  devices.forEach(d => {
    if (d.pduOutlet) outletUsage.set(d.pduOutlet, (outletUsage.get(d.pduOutlet) || 0) + 1);
  });
  devices.forEach((d, idx) => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    const conflict = conflicts.has(d.id);
    // dropdown розеток фильтруется по выбранному feed; если feed пуст — показываем все
    const outletsForFeed = d.pduFeed ? allOutlets.filter(o => o.feed === d.pduFeed) : allOutlets;
    const outletOptsHtml = ['<option value="">—</option>']
      .concat(outletsForFeed.map(o => {
        const taken = outletUsage.get(o.outlet) >= 1 && d.pduOutlet !== o.outlet;
        return `<option value="${o.outlet}"${d.pduOutlet === o.outlet ? ' selected' : ''}${taken ? ' disabled' : ''}>${o.outlet} · ${o.typeLabel}${taken ? ' (занят)' : ''}</option>`;
      })).join('');
    const feedOptsHtml = ['<option value="">—</option>']
      .concat(feeds.map(f => `<option value="${f}"${d.pduFeed === f ? ' selected' : ''}>${f}</option>`)).join('');
    rows.push(`<tr data-idx="${idx}" class="${conflict ? 'sc-conflict' : ''}">
      <td><input data-k="positionU" type="number" min="${h}" max="${r.u}" step="1" value="${d.positionU}" style="width:55px"></td>
      <td>${escape(type ? KIND_LABEL[type.kind] : 'Удалён')} · ${h}U</td>
      <td><input data-k="label" value="${escape(d.label)}"></td>
      <td class="muted" style="font-family:monospace;font-size:11px">${escape(deviceTag(d) || '—')}</td>
      <td><select data-k="pduFeed" style="width:60px">${feedOptsHtml}</select></td>
      <td><select data-k="pduOutlet">${outletOptsHtml}</select></td>
      <td><button type="button" class="sc-btn sc-btn-danger" data-del="${d.id}">✕</button></td>
    </tr>`);
  });
  if (!devices.length) rows.push('<tr><td colspan="7" class="muted">— пусто — добавьте из каталога кнопкой ➕</td></tr>');
  t.innerHTML = rows.join('');
  t.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('change', () => {
      const tr = el.closest('tr');
      const idx = +tr.dataset.idx;
      const k = el.dataset.k;
      const v = el.type === 'number' ? +el.value : el.value;
      devices[idx][k] = v;
      saveContents();
      rerender();
    });
  });
  t.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    state.contents[state.currentRackId] = devices.filter(d => d.id !== id);
    saveContents();
    renderContents();
    rerenderPreview();
  }));
}

/* ---- конфликты: наезд U / переполнение PDU ---------------------------- */
function detectConflicts(r, devices) {
  const conflicts = new Set();
  // карта занятости со стороной rack.occupied (его считаем непересекаемым «общим» блоком)
  const slot = new Array(r.u + 1).fill(null); // 1..r.u → id
  for (let u = r.u; u > r.u - r.occupied; u--) slot[u] = '__rack_occ__';
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) {
      const u = d.positionU - k;
      if (u < 1 || u > r.u) { conflicts.add(d.id); continue; }
      if (slot[u] && slot[u] !== d.id) {
        conflicts.add(d.id);
        if (slot[u] !== '__rack_occ__') conflicts.add(slot[u]);
      } else {
        slot[u] = d.id;
      }
    }
  });
  return conflicts;
}

/* ---- render: предупреждения ------------------------------------------- */
function renderWarnings() {
  const host = $('sc-warn');
  const r = currentRack();
  if (!r) { host.innerHTML = '<div class="sc-warn-item warn">Нет выбранной стойки.</div>'; return; }
  const devices = currentContents();
  const conflicts = detectConflicts(r, devices);
  const totalH = devices.reduce((s, d) => {
    const type = state.catalog.find(c => c.id === d.typeId);
    return s + (type ? type.heightU : 1);
  }, 0);
  const totalW = devices.reduce((s, d) => {
    const type = state.catalog.find(c => c.id === d.typeId);
    return s + (type ? type.powerW : 0);
  }, 0);
  const freeU = r.u - r.occupied;
  const items = [];
  if (conflicts.size) items.push(`<div class="sc-warn-item err">Конфликты размещения: ${conflicts.size} ед. перекрываются или выходят за границы U (подсвечены красным).</div>`);
  if (totalH > freeU) items.push(`<div class="sc-warn-item err">Суммарная высота оборудования ${totalH}U превышает свободное место (${freeU}U после «занятых» ${r.occupied}U).</div>`);
  // потребляемая мощность vs rack.demandKw
  if (r.demandKw && totalW / 1000 > r.demandKw * 1.0) {
    items.push(`<div class="sc-warn-item warn">Сумма заявленной мощности оборудования ≈ ${(totalW/1000).toFixed(2)} кВт превышает зарезервированную для стойки ${r.demandKw} кВт.</div>`);
  }
  // привязка к PDU — простая проверка: каждое устройство с powerW>0 должно иметь pduFeed
  const unfed = devices.filter(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    return type && type.powerW > 0 && !d.pduFeed;
  });
  if (unfed.length) items.push(`<div class="sc-warn-item warn">${unfed.length} устройств с питанием не привязаны к вводу PDU.</div>`);

  // hard check: перегруз по вводу (сумма powerW устройств на ввод A/B/C/… vs допустимая)
  // допустимая = rating × sqrt(3 if phases=3 else 1) × 230V × cosphi_rack (≈0.9)
  const byFeed = new Map();
  devices.forEach(d => {
    if (!d.pduFeed) return;
    const type = state.catalog.find(c => c.id === d.typeId);
    const w = type ? (type.powerW || 0) : 0;
    byFeed.set(d.pduFeed, (byFeed.get(d.pduFeed) || 0) + w);
  });
  if (r.pdus) {
    const cosphi = +r.cosphi || 0.9;
    const pduByFeed = new Map();
    r.pdus.forEach(p => {
      const cap = p.rating * (p.phases === 3 ? Math.sqrt(3) : 1) * 230 * cosphi;
      const qty = Math.max(1, +p.qty || 1);
      pduByFeed.set(p.feed, (pduByFeed.get(p.feed) || 0) + cap * qty);
    });
    byFeed.forEach((load, feed) => {
      const cap = pduByFeed.get(feed) || 0;
      if (cap > 0 && load > cap) {
        items.push(`<div class="sc-warn-item err">Перегруз ввода <b>${escape(feed)}</b>: нагрузка ≈ ${(load/1000).toFixed(2)} кВт > ёмкости PDU ≈ ${(cap/1000).toFixed(2)} кВт.</div>`);
      }
    });
  }

  // дубли розеток (один слот = одно устройство)
  const outletUsage = new Map();
  devices.forEach(d => {
    if (d.pduOutlet) outletUsage.set(d.pduOutlet, (outletUsage.get(d.pduOutlet) || 0) + 1);
  });
  const dupOutlets = [...outletUsage.entries()].filter(([, n]) => n > 1);
  if (dupOutlets.length) {
    items.push(`<div class="sc-warn-item err">Дублирование PDU-розетки: ${dupOutlets.map(([o, n]) => `${o} (×${n})`).join(', ')}. Один слот должен занимать одно устройство.</div>`);
  }
  if (!items.length) items.push('<div class="sc-warn-item ok">Всё ок: размещение корректно, конфликтов нет.</div>');
  host.innerHTML = items.join('');
}

/* ---- render: СКС-матрица ---------------------------------------------- */
function renderMatrix() {
  const t = $('sc-matrix');
  const links = currentMatrix();
  const rows = [`<tr>
    <th>Порт A</th><th>Порт B</th><th>Кабель</th><th>Длина, м</th><th>Цвет</th>
    <th style="width:30px"></th>
  </tr>`];
  links.forEach((l, idx) => {
    rows.push(`<tr data-idx="${idx}">
      <td><input data-k="a" value="${escape(l.a)}" placeholder="PP-A/12"></td>
      <td><input data-k="b" value="${escape(l.b)}" placeholder="SW-1/12"></td>
      <td><select data-k="cable">
        ${['cat.6','cat.6A','cat.7','OM3 LC-LC','OS2 LC-LC'].map(c =>
          `<option${l.cable===c?' selected':''}>${c}</option>`).join('')}
      </select></td>
      <td><input data-k="lengthM" type="number" min="0.5" step="0.5" value="${l.lengthM}" style="width:60px"></td>
      <td><input data-k="color" value="${escape(l.color || '')}" placeholder="син./жёлт.">
      </td>
      <td><button type="button" class="sc-btn sc-btn-danger" data-del="${l.id}">✕</button></td>
    </tr>`);
  });
  if (!links.length) rows.push('<tr><td colspan="6" class="muted">— пусто —</td></tr>');
  t.innerHTML = rows.join('');
  t.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = +el.closest('tr').dataset.idx;
      const k = el.dataset.k;
      links[idx][k] = el.type === 'number' ? +el.value : el.value;
      saveMatrix();
      renderBom();
    });
  });
  t.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    state.matrix[state.currentRackId] = links.filter(l => l.id !== id);
    saveMatrix();
    renderMatrix();
    renderBom();
  }));
}
function addMatrixRow() {
  const links = currentMatrix();
  links.push({ id: uid('lnk'), a: '', b: '', cable: 'cat.6', lengthM: 2, color: '' });
  saveMatrix();
  renderMatrix();
}

/* ---- render: карта юнитов (SVG фронт-вью) ----------------------------- */
function renderUnitMap(hostId, opts) {
  hostId = hostId || 'sc-unitmap';
  opts = opts || {};
  const host = $(hostId);
  if (!host) return;
  const r = currentRack();
  if (!r) { host.innerHTML = '<div class="muted">Нет выбранной стойки.</div>'; return; }
  const devices = currentContents();
  const conflicts = detectConflicts(r, devices);
  // В модалке делаем юнит крупнее для удобства
  const scale = opts.big ? 2 : 1;
  const rowH = 16 * scale, bodyW = 220 * scale;
  const svgH = r.u * rowH + 8;
  const svgW = bodyW + 40;
  const mode = state.viewMode;
  // slot → device; индексы U=1..r.u (1 — снизу, r.u — сверху)
  const slot = new Array(r.u + 1).fill(null);
  for (let u = r.u; u > r.u - r.occupied; u--) slot[u] = { kind: 'rack-occ' };
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) {
      const u = d.positionU - k;
      if (u < 1 || u > r.u) continue;
      slot[u] = { device: d, type, isTop: k === 0, conflict: conflicts.has(d.id) };
    }
  });

  // Сам шкаф (рамка + все U с нумерацией) рисуется всегда — и на
  // маленькой карте, и в модалке. В модалке отличие только в наличии
  // слоя патч-кордов (wires). См. renderUnitMap ниже.
  const rects = [];
  for (let i = 0; i < r.u; i++) {
    const u = r.u - i; // сверху вниз
    const y = 4 + i * rowH;
    const s = slot[u];
    if (!s || s.kind === 'rack-occ') {
      const fill = s && s.kind === 'rack-occ' ? '#cbd5e1' : '#f1f5f9';
      const stroke = s && s.kind === 'rack-occ' ? '#64748b' : '#cbd5e1';
      rects.push(`<rect x="32" y="${y}" width="${bodyW}" height="${rowH - 1}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
    }
    rects.push(`<text x="28" y="${y + rowH/2 + 4}" font-size="${9*scale}" fill="#64748b" text-anchor="end">${u}</text>`);
  }
  // затем устройства — ОДНОЙ группой на устройство (для drag-n-drop; 1.24.3 full).
  const deviceGroups = devices.map(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    if (!type) return '';
    const h = type.heightU;
    const topIdx = r.u - d.positionU; // row index (0=сверху)
    const y = 4 + topIdx * rowH;
    const conflict = conflicts.has(d.id);
    const fill = mode === 'power' ? feedColor(d.pduFeed) : (type.color || '#94a3b8');
    const stroke = conflict ? '#dc2626' : '#64748b';
    const tag = deviceTag(d);
    const tagSfx = tag ? ' · ' + tag : '';
    const labelTxt = mode === 'power'
      ? `${d.label}${d.pduFeed ? ' · ввод '+d.pduFeed : ' · ⚠ без PDU'}${type.powerW ? ' · '+type.powerW+' Вт' : ''}${tagSfx}`
      : `${d.label}${d.pduFeed ? ' · '+d.pduFeed : ''}${tagSfx}`;
    return `<g class="sc-devband" data-devid="${d.id}" data-h="${h}" style="cursor:grab">
      <rect x="32" y="${y}" width="${bodyW}" height="${h * rowH - 1}" fill="${fill}" stroke="${stroke}" stroke-width="${conflict ? 1.5 : 0.5}"/>
      <text x="${38}" y="${y + rowH/2 + 4}" font-size="${10*scale}" fill="#0f172a">${escape(labelTxt)}</text>
    </g>`;
  }).join('');

  const legend = [];
  if (mode === 'power') {
    const seenFeeds = new Set();
    devices.forEach(d => {
      const f = d.pduFeed || '';
      if (seenFeeds.has(f)) return;
      seenFeeds.add(f);
      legend.push(`<span><i style="background:${feedColor(f)}"></i>${f ? 'Ввод '+f : '⚠ Без PDU'}</span>`);
    });
  } else {
    const seen = new Set();
    devices.forEach(d => {
      const type = state.catalog.find(c => c.id === d.typeId);
      if (!type || seen.has(type.id)) return;
      seen.add(type.id);
      legend.push(`<span><i style="background:${type.color}"></i>${escape(KIND_LABEL[type.kind])}</span>`);
    });
  }
  if (r.occupied) legend.unshift(`<span><i style="background:#cbd5e1"></i>Занято стойкой · ${r.occupied}U</span>`);

  // Патч-корды — только в модалке (full view). Соединяем устройства,
  // метка которых появляется как префикс в link.a или link.b. Рисуем
  // кривую Безье справа от стойки: вход/выход на правой грани устройства.
  let wires = '';
  if (opts.big) {
    const links = currentMatrix();
    const lookup = (endpoint) => {
      const s = String(endpoint || '').trim().toLowerCase();
      if (!s) return null;
      return devices.find(d => {
        const lbl = String(d.label || '').toLowerCase();
        return lbl && (s.startsWith(lbl) || lbl.startsWith(s.split(/[\s\/\-:]/)[0]));
      }) || null;
    };
    const centerY = (d) => {
      const t = state.catalog.find(c => c.id === d.typeId);
      const h = t ? t.heightU : 1;
      const topIdx = r.u - d.positionU;
      return 4 + topIdx * rowH + (h * rowH) / 2;
    };
    const wireParts = [];
    const rightX = 32 + bodyW;
    links.forEach((l, idx) => {
      const a = lookup(l.a), b = lookup(l.b);
      if (!a || !b || a === b) return;
      const y1 = centerY(a), y2 = centerY(b);
      const color = l.color && /^#|^[a-z]+$/i.test(l.color) ? l.color
        : (l.cable && l.cable.includes('OM') ? '#f59e0b'
           : l.cable && l.cable.includes('OS') ? '#eab308' : '#2563eb');
      const dx = 20 + Math.abs(y2 - y1) * 0.25;
      const path = `M ${rightX} ${y1} C ${rightX+dx} ${y1}, ${rightX+dx} ${y2}, ${rightX} ${y2}`;
      wireParts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="${1.5*scale}" opacity="0.85"/>`);
      // маркеры концов
      wireParts.push(`<circle cx="${rightX}" cy="${y1}" r="${2.5*scale}" fill="${color}"/>`);
      wireParts.push(`<circle cx="${rightX}" cy="${y2}" r="${2.5*scale}" fill="${color}"/>`);
    });
    wires = `<g class="sc-wires">${wireParts.join('')}</g>`;
  }

  // В модалке SVG шире — добавим запас справа под кривые кабелей.
  const extraRight = opts.big ? 120 : 0;
  const svgId = opts.big ? 'sc-unitmap-svg-big' : 'sc-unitmap-svg';
  const totalW = svgW + extraRight;
  const z = opts.big ? (state.dlgZoom || 1) : 1;
  const svgEl = `<svg id="${svgId}" class="sc-unitmap-svg" width="${totalW * z}" height="${svgH * z}" viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg" data-rowh="${rowH}" data-zoom="${z}" data-bodyw="${bodyW}" data-bodyx="32">
    ${rects.join('')}
    ${deviceGroups}
    ${wires}
  </svg>`;
  const legendEl = `<div class="sc-unitmap-legend">${legend.join('') || '<span class="muted">— пусто —</span>'}</div>`;
  if (opts.big) {
    host.innerHTML = `<div class="sc-zoomwrap" id="sc-zoomwrap">${svgEl}</div>${legendEl}`;
    bindZoomPan($('sc-zoomwrap'), svgId, totalW, svgH);
  } else {
    host.innerHTML = `${svgEl}${legendEl}`;
  }
  bindUnitMapDrag(svgId);
}

/* 1.24.33 — zoom/pan в модалке. Wheel — zoom at cursor; drag по пустому
   месту (не по полосе устройства) — pan через scrollLeft/scrollTop. */
function bindZoomPan(wrap, svgId, baseW, baseH) {
  if (!wrap) return;
  const svg = $(svgId); if (!svg) return;
  wrap.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return; // без Ctrl — обычный скролл
    ev.preventDefault();
    const oldZ = state.dlgZoom || 1;
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZ = Math.max(0.4, Math.min(5, oldZ * factor));
    if (Math.abs(newZ - oldZ) < 0.001) return;
    const rect = wrap.getBoundingClientRect();
    const cx = ev.clientX - rect.left + wrap.scrollLeft;
    const cy = ev.clientY - rect.top + wrap.scrollTop;
    const k = newZ / oldZ;
    state.dlgZoom = newZ;
    svg.setAttribute('width', baseW * newZ);
    svg.setAttribute('height', baseH * newZ);
    svg.setAttribute('data-zoom', newZ);
    wrap.scrollLeft = cx * k - (ev.clientX - rect.left);
    wrap.scrollTop = cy * k - (ev.clientY - rect.top);
  }, { passive: false });
  let pan = null;
  wrap.addEventListener('pointerdown', ev => {
    // пан только по пустому месту (не по полосе устройства) и основным кнопкам
    if (ev.target.closest('g.sc-devband')) return;
    if (ev.button !== 0 && ev.button !== 1) return;
    pan = { x: ev.clientX, y: ev.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop, pid: ev.pointerId };
    wrap.setPointerCapture(ev.pointerId);
    wrap.style.cursor = 'grabbing';
  });
  wrap.addEventListener('pointermove', ev => {
    if (!pan) return;
    wrap.scrollLeft = pan.sl - (ev.clientX - pan.x);
    wrap.scrollTop  = pan.st - (ev.clientY - pan.y);
  });
  const endPan = ev => {
    if (!pan) return;
    try { wrap.releasePointerCapture(pan.pid); } catch {}
    pan = null;
    wrap.style.cursor = '';
  };
  wrap.addEventListener('pointerup', endPan);
  wrap.addEventListener('pointercancel', endPan);
}

/* ---- drag-n-drop в SVG (1.24.3 full) ---------------------------------
   Pointerdown на <g.sc-devband> — захват; pointermove — двигаем полосу,
   snap к целому U; pointerup — коммит (saveContents) или откат (если
   вышли за границы). Используются Pointer Events API (работает для мыши
   и сенсорного ввода). SetPointerCapture позволяет таскать за пределами
   исходного rect. */
function bindUnitMapDrag(svgId) {
  svgId = svgId || 'sc-unitmap-svg';
  const svg = $(svgId); if (!svg) return;
  const rowH = +svg.dataset.rowh || 16;
  bindUnitMapDrop(svg, rowH);
  svg.querySelectorAll('g.sc-devband').forEach(g => {
    g.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const devId = g.dataset.devid;
      const d = currentContents().find(x => x.id === devId); if (!d) return;
      const type = state.catalog.find(c => c.id === d.typeId);
      const h = +g.dataset.h || 1;
      state.drag = { devId, startY: ev.clientY, startU: d.positionU, rowH, svgId, h, wantU: d.positionU, valid: true, intra: true };
      g.setPointerCapture(ev.pointerId);
      // 1.24.37 — «отрываем» девайс от шкафа на время drag: скрываем полностью
      g.style.display = 'none';
      // плавающий ghost как в cart→rack drag
      if (type) {
        const ghost = document.createElement('div');
        ghost.className = 'sc-drag-ghost sc-drag-ghost-live';
        ghost.textContent = `${d.label} · ${h}U`;
        ghost.style.background = type.color || '#94a3b8';
        ghost.style.left = (ev.clientX + 12) + 'px';
        ghost.style.top = (ev.clientY + 12) + 'px';
        document.body.appendChild(ghost);
        state.drag.ghostEl = ghost;
      }
    });
    g.addEventListener('pointermove', ev => {
      if (!state.drag || state.drag.devId !== g.dataset.devid) return;
      if (state.drag.ghostEl) {
        state.drag.ghostEl.style.left = (ev.clientX + 12) + 'px';
        state.drag.ghostEl.style.top = (ev.clientY + 12) + 'px';
      }
      const overEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const overCart = !!(overEl && overEl.closest('.sc-cart-dropzone'));
      const overWh = !!(overEl && !overCart && overEl.closest('.sc-wh-dropzone'));
      state.drag.overCart = overCart;
      state.drag.overWh = overWh;
      document.querySelectorAll('.sc-cart-dropzone').forEach(el => el.classList.toggle('sc-drop-hover', overCart));
      document.querySelectorAll('.sc-wh-dropzone').forEach(el => el.classList.toggle('sc-drop-hover', overWh));
      // preview — в том SVG, над которым сейчас курсор (любой сtg.sc-unitmap-svg)
      document.querySelectorAll('.sc-drop-preview').forEach(el => el.remove());
      if (overCart || overWh) { state.drag.valid = false; return; }
      const svgNow = overEl && overEl.closest && overEl.closest('svg.sc-unitmap-svg');
      if (!svgNow) { state.drag.valid = false; return; }
      const rowHNow = +svgNow.dataset.rowh || rowH;
      const r = currentRack(); if (!r) return;
      const d = currentContents().find(x => x.id === state.drag.devId); if (!d) return;
      const h = state.drag.h;
      // вычисляем wantU по координате курсора внутри svg
      const rect = svgNow.getBoundingClientRect();
      const zoom = +svgNow.dataset.zoom || 1;
      const yInSvg = (ev.clientY - rect.top) / zoom;
      const topIdx = Math.max(0, Math.min(r.u - h, Math.floor((yInSvg - 4) / rowHNow)));
      const wantU = r.u - topIdx;
      const valid = canPlace(r, currentContents(), d.id, h, wantU);
      state.drag.wantU = wantU;
      state.drag.valid = valid;
      const bodyW = +svgNow.dataset.bodyw || 220;
      const bodyX = +svgNow.dataset.bodyx || 32;
      const y = 4 + (r.u - wantU) * rowHNow;
      const color = valid ? '#2563eb' : '#dc2626';
      const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g2.setAttribute('class', 'sc-drop-preview');
      g2.setAttribute('pointer-events', 'none');
      g2.innerHTML = `<rect x="${bodyX}" y="${y}" width="${bodyW}" height="${h * rowHNow - 1}"
        fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      svgNow.appendChild(g2);
    });
    g.addEventListener('pointerup', () => {
      if (!state.drag) return;
      document.querySelectorAll('.sc-cart-dropzone,.sc-wh-dropzone').forEach(el => el.classList.remove('sc-drop-hover'));
      if (state.drag.ghostEl) { try { state.drag.ghostEl.remove(); } catch {} }
      document.querySelectorAll('.sc-drop-preview').forEach(el => el.remove());
      const drop = state.drag;
      state.drag = null;
      if (drop.overCart) {
        moveToCart(drop.devId);
      } else if (drop.overWh) {
        moveToCart(drop.devId);
        const last = state.cart[state.cart.length - 1];
        if (last) cartToWarehouse(last.id);
      } else if (drop.valid && drop.wantU !== drop.startU) {
        const d = currentContents().find(x => x.id === drop.devId);
        if (d) { d.positionU = drop.wantU; saveContents(); }
        renderContents(); renderWarnings(); renderBom(); rerenderPreview();
      } else {
        // откат — просто re-render, чтобы девайс появился снова
        rerenderPreview();
      }
    });
    g.addEventListener('pointercancel', () => {
      if (state.drag && state.drag.ghostEl) { try { state.drag.ghostEl.remove(); } catch {} }
      document.querySelectorAll('.sc-drop-preview').forEach(el => el.remove());
      document.querySelectorAll('.sc-cart-dropzone,.sc-wh-dropzone').forEach(el => el.classList.remove('sc-drop-hover'));
      state.drag = null;
      rerenderPreview();
    });
  });
}

/* 1.24.29 — проверка «влезет ли устройство в позицию wantU, не задев
   других». excludeDevId — игнорируем это устройство (для drag). */
function canPlace(r, devices, excludeDevId, heightU, wantU) {
  if (wantU < heightU || wantU > r.u) return false;
  // v0.59.179: удалён ошибочный цикл по r.occupied, который считал верхние
  // U «занятыми стопкой» и блокировал любое перемещение в пределах
  // обычной зоны установки оборудования. Реальная проверка overlap —
  // цикл ниже по всем устройствам.
  for (const d of devices) {
    if (d.id === excludeDevId) continue;
    const t = state.catalog.find(c => c.id === d.typeId);
    const dh = t ? t.heightU : 1;
    for (let k = 0; k < heightU; k++) {
      const myU = wantU - k;
      for (let j = 0; j < dh; j++) {
        if (myU === d.positionU - j) return false;
      }
    }
  }
  return true;
}

/* ---- 1.24.10 drop-target: палитра каталога → карта юнитов --------------
   На SVG принимаем перетаскивание <tr data-typeid> из каталога. При drop
   вычисляем U по clientY относительно SVG (учитываем что U=1 — снизу),
   создаём устройство в этой позиции. */
/* 1.24.36 — кастомный drag-ghost: цветной прямоугольник с названием
   устройства (как полоса в стойке). Показывается при HTML5-drag из
   каталога/тележки/склада, следует за курсором. state._dragMeta хранит
   высоту текущего dragged для превью в SVG. */
function setDragGhost(ev, type, label) {
  state._dragMeta = { h: type.heightU || 1, label, color: type.color || '#94a3b8' };
  const ghost = document.createElement('div');
  ghost.className = 'sc-drag-ghost';
  ghost.textContent = `${label} · ${type.heightU || 1}U`;
  ghost.style.background = type.color || '#94a3b8';
  document.body.appendChild(ghost);
  try { ev.dataTransfer.setDragImage(ghost, 100, 14); } catch {}
  // убираем ghost из DOM после снимка (браузер копирует его визуально)
  setTimeout(() => { try { ghost.remove(); } catch {} }, 0);
}

function bindUnitMapDrop(svg, rowH) {
  const highlight = (on) => svg.classList.toggle('sc-drop-hover', on);
  const acceptType = (types) => types.includes('application/x-scs-typeid') || types.includes('application/x-scs-cartid') || types.includes('application/x-scs-whid');
  const computeTopU = (clientY) => {
    const r = currentRack(); if (!r) return null;
    const rect = svg.getBoundingClientRect();
    const svgH = svg.viewBox.baseVal.height || rect.height;
    const yClient = clientY - rect.top;
    const yView = yClient * (svgH / rect.height);
    const rowIdx = Math.max(0, Math.min(r.u - 1, Math.floor((yView - 4) / rowH)));
    return r.u - rowIdx;
  };
  const updatePreview = (clientY, typeId, h) => {
    const topU = computeTopU(clientY); if (topU == null) return;
    const r = currentRack();
    // удалить старый превью
    const old = svg.querySelector('.sc-drop-preview'); if (old) old.remove();
    const ph = h || 1;
    const wantU = Math.min(topU, r.u);
    const topIdx = r.u - wantU;
    const y = 4 + topIdx * rowH;
    const bodyW = +svg.dataset.bodyw || 220;
    const bodyX = +svg.dataset.bodyx || 32;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'sc-drop-preview');
    g.setAttribute('pointer-events', 'none');
    g.innerHTML = `<rect x="${bodyX}" y="${y}" width="${bodyW}" height="${ph * rowH - 1}"
      fill="#2563eb" fill-opacity="0.25" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    svg.appendChild(g);
  };
  const clearPreview = () => { const p = svg.querySelector('.sc-drop-preview'); if (p) p.remove(); };
  const onDragOver = (ev) => {
    const types = Array.from(ev.dataTransfer.types);
    if (!acceptType(types)) return;
    ev.preventDefault();
    // dropEffect должен быть совместим с effectAllowed источника:
    // каталог → copy, тележка/склад → move.
    ev.dataTransfer.dropEffect = types.includes('application/x-scs-typeid') ? 'copy' : 'move';
    highlight(true);
    // превью размера: по типу / тележке / складу
    let h = 1;
    const s = state._dragMeta; if (s && s.h) h = s.h;
    updatePreview(ev.clientY, null, h);
  };
  svg.addEventListener('dragenter', onDragOver);
  svg.addEventListener('dragover', onDragOver);
  svg.addEventListener('dragleave', (ev) => {
    // dragleave fires on children — проверим что реально покинули svg
    if (ev.relatedTarget && svg.contains(ev.relatedTarget)) return;
    highlight(false); clearPreview();
  });
  svg.addEventListener('drop', ev => {
    highlight(false); clearPreview();
    const typeId = ev.dataTransfer.getData('application/x-scs-typeid');
    const cartId = ev.dataTransfer.getData('application/x-scs-cartid');
    const whId = ev.dataTransfer.getData('application/x-scs-whid');
    if (!typeId && !cartId && !whId) return;
    ev.preventDefault();
    const r = currentRack(); if (!r) return;
    const wantTopU = computeTopU(ev.clientY); if (wantTopU == null) return;
    if (whId) {
      warehouseToCart(whId);
      const justAdded = state.cart[state.cart.length - 1];
      if (justAdded) installFromCart(justAdded.id, wantTopU);
    } else if (cartId) {
      installFromCart(cartId, wantTopU);
    } else {
      const type = state.catalog.find(c => c.id === typeId); if (!type) return;
      const finalU = findNearestFreeSlot(r, currentContents(), type.heightU, wantTopU);
      if (finalU == null) { scToast('Нет свободного места для устройства (' + type.heightU + 'U)', 'err'); return; }
      addToRack(typeId, finalU);
    }
  });
}

/* 1.24.29 — поиск ближайшего свободного блока heightU к wantU (сначала
   выше, потом ниже). Возвращает top-U или null если нет места. */
function findNearestFreeSlot(r, devices, heightU, wantU) {
  const okAt = (u) => canPlace(r, devices, null, heightU, u);
  if (okAt(wantU)) return wantU;
  for (let delta = 1; delta <= r.u; delta++) {
    const up = wantU + delta;
    if (up <= r.u && okAt(up)) return up;
    const dn = wantU - delta;
    if (dn >= heightU && okAt(dn)) return dn;
  }
  return null;
}

/* ---- BOM --------------------------------------------------------------- */
function computeBom() {
  const devices = currentContents();
  const links = currentMatrix();
  const byType = new Map();
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    if (!type) return;
    const key = type.id;
    const row = byType.get(key) || { label: type.label, kind: KIND_LABEL[type.kind], qty: 0, powerW: type.powerW };
    row.qty++;
    byType.set(key, row);
  });
  const byCable = new Map();
  links.forEach(l => {
    const key = l.cable || '—';
    const row = byCable.get(key) || { label: `Патч-корд ${key}`, kind: 'кабель', qty: 0, lenM: 0 };
    row.qty++;
    row.lenM += +l.lengthM || 0;
    byCable.set(key, row);
  });
  return [...byType.values(), ...byCable.values()];
}
function renderBom() {
  const t = $('sc-bom');
  const items = computeBom();
  const rows = [`<tr><th>Позиция</th><th>Раздел</th><th>Кол-во</th><th>Длина, м</th><th>Вт/шт</th></tr>`];
  items.forEach(it => {
    rows.push(`<tr><td>${escape(it.label)}</td><td>${escape(it.kind)}</td><td>${it.qty}</td><td>${it.lenM ? it.lenM.toFixed(1) : '—'}</td><td>${it.powerW ?? '—'}</td></tr>`);
  });
  if (!items.length) rows.push('<tr><td colspan="5" class="muted">— пусто —</td></tr>');
  t.innerHTML = rows.join('');
}
function exportBomCsv() {
  const items = computeBom();
  const r = currentRack();
  const rackTag = currentRackTag();
  const rows = [['Позиция','Раздел','Кол-во','Длина, м','Вт/шт']];
  items.forEach(it => rows.push([it.label, it.kind, it.qty, it.lenM ? it.lenM.toFixed(1) : '', it.powerW ?? '']));
  // 1.24.30 — список устройств с TIA-606 тегами (отдельной секцией)
  if (r) {
    rows.push([]);
    rows.push([`Теги устройств TIA-606 (стойка ${rackTag || r.name || ''})`]);
    rows.push(['Тег','U','Название','Тип','PDU ввод','PDU outlet']);
    currentContents().slice().sort((a,b) => b.positionU - a.positionU).forEach(d => {
      const t = state.catalog.find(c => c.id === d.typeId);
      rows.push([deviceTag(d), d.positionU, d.label, t ? KIND_LABEL[t.kind] : '', d.pduFeed || '', d.pduOutlet || '']);
    });
  }
  const csv = rows.map(row => row.map(v => {
    const s = String(v ?? '');
    return /[;\"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scs-bom_${(r && r.name ? r.name : 'rack').replace(/[^\w\-]+/g,'_')}.csv`;
  a.click();
}

/* 1.24.35 доводка — CSV экспорт инвентаря склада. */
function exportWarehouseCsv() {
  if (!state.warehouse.length) { scToast('Склад пуст', 'warn'); return; }
  const rows = [['Адрес','Устройство','S/N','Заметка','Было в (стойка)','Дата поступления']];
  const sorted = [...state.warehouse].sort((a, b) => {
    const aa = a.address || '\uFFFF'; const bb = b.address || '\uFFFF';
    return aa.localeCompare(bb, 'ru', { numeric: true });
  });
  sorted.forEach(it => {
    rows.push([
      it.address || '',
      it.label || '',
      it.serial || '',
      it.note || '',
      it.fromRackName || '',
      it.storedAt ? new Date(it.storedAt).toISOString().slice(0,10) : '',
    ]);
  });
  const csv = rows.map(row => row.map(v => {
    const s = String(v ?? '');
    return /[;\"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `warehouse_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ---- auto-pack: уложить всё сверху вниз без зазоров ------------------- */
/* 1.24.34 — Умная авто-укладка по правилам размещения в стойке.
   - ИБП (тяжёлые) в самый низ (низкий центр тяжести, короткие силовые
     кабели до PDU).
   - Патч-панели и коммутаторы сверху (кабельный ввод с верхнего лотка,
     короткие патч-корды копперной части).
   - KVM + монитор в середине на уровне глаз оператора.
   - Серверы заполняют середину.
   - Органайзеры ставятся между активным оборудованием как разделители.
   - Между зонами (top/middle/bottom) — 1U зазор для вентиляции/кабелей,
     если есть место. */
function autoPack() {
  const r = currentRack(); if (!r) return;
  const devices = currentContents();
  if (!devices.length) return;

  // priority: меньше = ближе к верху стойки
  const PRIO = { patch: 5, switch: 15, kvm: 35, monitor: 40, server: 55, other: 60, organizer: 70, ups: 95 };
  const zoneOf = (p) => p < 25 ? 'top' : p > 80 ? 'bottom' : 'middle';

  const enriched = devices.map(d => {
    const t = state.catalog.find(c => c.id === d.typeId);
    return { d, h: t ? t.heightU : 1, prio: PRIO[t ? t.kind : 'other'] ?? 60, kind: t ? t.kind : 'other' };
  });

  // Top: патч сверху, коммутатор под ним. Сортировка prio asc, затем h asc (мелкие выше).
  const top = enriched.filter(x => zoneOf(x.prio) === 'top' && x.kind !== 'organizer').sort((a,b) => a.prio - b.prio || a.h - b.h);
  // Middle: KVM/монитор — выше; серверы — ниже. Крупные серверы ближе к верху middle.
  const mid = enriched.filter(x => zoneOf(x.prio) === 'middle' && x.kind !== 'organizer').sort((a,b) => a.prio - b.prio || b.h - a.h);
  // Bottom: ИБП самые тяжёлые — ниже всех. Крупные (больше h) в самый низ.
  const bot = enriched.filter(x => zoneOf(x.prio) === 'bottom' && x.kind !== 'organizer').sort((a,b) => b.prio - a.prio || b.h - a.h);
  // Органайзеры — как разделители между группами middle.
  const organizers = enriched.filter(x => x.kind === 'organizer');

  // U=r.u сверху, U=1 снизу. positionU = верхний U устройства.
  // Top размещается сверху вниз от U=r.u - r.occupied.
  let uTop = r.u - r.occupied;
  let uBot = 1; // next free bottom base-U

  // Проверка выхода за границы: если не влезает — оставляем старую позицию.
  top.forEach(x => {
    if (uTop < x.h) return;
    x.d.positionU = uTop;
    uTop -= x.h;
  });

  // Bottom снизу вверх: positionU = uBot + h - 1
  bot.forEach(x => {
    const topU = uBot + x.h - 1;
    if (topU > uTop) return; // некуда
    x.d.positionU = topU;
    uBot = topU + 1;
  });

  // 1U зазор между top и middle (если есть место и есть что разделять)
  if (top.length && (mid.length || bot.length) && uTop - uBot + 1 > 0) uTop -= 1;

  // Middle: сверху вниз, между uTop и uBot. Разделитель-органайзер между
  // разными kind-ами (если есть запас органайзеров).
  let prevKind = null;
  let orgPool = organizers.slice();
  mid.forEach(x => {
    if (uTop < x.h || uTop < uBot + x.h - 1) return;
    if (prevKind && prevKind !== x.kind && orgPool.length && uTop >= 1 + x.h) {
      const org = orgPool.shift();
      org.d.positionU = uTop;
      uTop -= 1;
      if (uTop < x.h) return;
    }
    x.d.positionU = uTop;
    uTop -= x.h;
    prevKind = x.kind;
  });

  // Оставшиеся органайзеры — прямо над bottom-зоной (между middle и bottom).
  orgPool.forEach(x => {
    if (uTop < 1 || uTop < uBot) return;
    x.d.positionU = uTop;
    uTop -= 1;
  });

  saveContents();
  renderContents();
  rerenderPreview();
  scToast('Авто-укладка по правилам размещения', 'ok');
}

/* ---- шаблоны «готовой сборки» (1.24.7) --------------------------------
   Снапшот currentContents + currentMatrix сохраняется под именем. Применение
   к другой стойке = клонирование с новыми id и с обрезкой устройств, которые
   не помещаются по высоте (новая стойка может быть меньше). */
function renderTemplates() {
  const sel = $('sc-template'); if (!sel) return;
  sel.innerHTML = state.templates.length
    ? '<option value="">— выбрать —</option>' + state.templates.map(t => `<option value="${t.id}">${escape(t.name)}</option>`).join('')
    : '<option value="">— нет сохранённых —</option>';
}
async function saveCurrentAsTemplate() {
  const r = currentRack(); if (!r) { scToast('Нет выбранной стойки', 'warn'); return; }
  const name = await scPrompt('Имя пресета сборки', `Сборка · ${r.name || r.u + 'U'}`);
  if (!name) return;
  const tmpl = {
    id: uid('tmpl'),
    name: String(name).trim(),
    // Снимаем копии без id — применение сгенерирует новые
    contents: currentContents().map(d => ({
      typeId: d.typeId, label: d.label, positionU: d.positionU,
      pduFeed: d.pduFeed || '', pduOutlet: d.pduOutlet || '',
    })),
    matrix: currentMatrix().map(l => ({
      a: l.a, b: l.b, cable: l.cable, lengthM: l.lengthM, color: l.color || '',
    })),
    createdAt: new Date().toISOString(),
  };
  state.templates.push(tmpl);
  saveTemplates();
  renderTemplates();
  $('sc-template').value = tmpl.id;
}
async function applyTemplate() {
  const sel = $('sc-template'); const id = sel.value;
  const tmpl = state.templates.find(t => t.id === id);
  const r = currentRack();
  if (!tmpl || !r) { scToast('Выберите пресет и стойку', 'warn'); return; }
  const ok = await scConfirm(
    `Применить пресет «${tmpl.name}»?`,
    'Существующее содержимое и матрица текущей стойки будут заменены.',
    { okLabel: 'Применить' }
  );
  if (!ok) return;
  // обрезка по высоте стойки: не помещается устройство, если positionU > r.u или (positionU - h + 1) < 1
  const dropped = [];
  const contents = tmpl.contents.map(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    if (d.positionU > r.u || d.positionU - h + 1 < 1) { dropped.push(d); return null; }
    return { id: uid('dev'), typeId: d.typeId, label: d.label, positionU: d.positionU, pduFeed: d.pduFeed, pduOutlet: d.pduOutlet };
  }).filter(Boolean);
  const matrix = tmpl.matrix.map(l => ({ id: uid('lnk'), a: l.a, b: l.b, cable: l.cable, lengthM: l.lengthM, color: l.color }));
  state.contents[state.currentRackId] = contents;
  state.matrix[state.currentRackId] = matrix;
  saveContents(); saveMatrix();
  rerender();
  if (dropped.length) scToast(`Не поместилось ${dropped.length} устройств — стойка меньше исходной`, 'warn');
}

/* =========================================================================
   1.24.28 — «тележка» (moving cart).
   Модель как в реальном ЦОД: вытащил сервер из одной стойки → везёт →
   установил в другую. Общий буфер между всеми стойками проекта.
   ========================================================================= */
function moveToCart(devId) {
  const devs = currentContents();
  const d = devs.find(x => x.id === devId); if (!d) return;
  const r = currentRack();
  state.cart.push({
    id: uid('cart'),
    typeId: d.typeId,
    label: d.label,
    fromRackId: r ? r.id : null,
    fromRackName: r ? (r.name || '') : '',
    pduFeed: d.pduFeed || '', pduOutlet: d.pduOutlet || '',
    takenAt: new Date().toISOString(),
  });
  state.contents[state.currentRackId] = devs.filter(x => x.id !== devId);
  saveCart(); saveContents();
  renderContents(); rerenderPreview(); renderCart();
  scToast('Устройство вытащено на тележку', 'ok');
}
function installFromCart(cartId, wantTopU) {
  const r = currentRack(); if (!r) { scToast('Выберите стойку', 'warn'); return; }
  const idx = state.cart.findIndex(x => x.id === cartId);
  if (idx < 0) return;
  const item = state.cart[idx];
  const type = state.catalog.find(c => c.id === item.typeId);
  if (!type) { scToast('Тип оборудования из тележки не найден в каталоге', 'err'); return; }
  const finalU = findNearestFreeSlot(r, currentContents(), type.heightU,
    Number.isFinite(wantTopU) ? wantTopU : r.u - r.occupied);
  if (finalU == null) { scToast('Нет места в стойке (' + type.heightU + 'U)', 'err'); return; }
  currentContents().push({
    id: uid('dev'),
    typeId: item.typeId,
    label: item.label,
    positionU: finalU,
    pduFeed: item.pduFeed || '', pduOutlet: '',  // розетку не тянем — другая стойка
  });
  state.cart.splice(idx, 1);
  saveCart(); saveContents();
  renderContents(); rerenderPreview(); renderCart();
  scToast(`Установлено в U${finalU}`, 'ok');
}
function cartToWarehouse(cartId) {
  const idx = state.cart.findIndex(x => x.id === cartId);
  if (idx < 0) return;
  const item = state.cart.splice(idx, 1)[0];
  item.storedAt = Date.now();
  if (!item.address) item.address = suggestNextAddress();
  state.warehouse.push(item);
  saveCart(); saveWarehouse();
  renderCart(); renderWarehouse();
  scToast(`Отправлено на склад · ${item.address}`, 'ok');
}

/* 1.24.35 доводка — авто-назначение следующего адреса на складе.
   Ищет все адреса вида <prefix>-<...числа...>; инкрементирует последнее
   число. Если склад пуст — стартовый A-01-1-1. */
function suggestNextAddress() {
  const addrs = state.warehouse.map(x => x.address).filter(Boolean);
  if (!addrs.length) return 'A-01-1-1';
  // берём самый «поздний» по natural-sort и инкрементируем последний сегмент
  const sorted = addrs.slice().sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const last = sorted[sorted.length - 1];
  const m = last.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return last + '-2';
  const prefix = m[1], num = m[2], suffix = m[3] || '';
  const next = String(+num + 1).padStart(num.length, '0');
  let candidate = prefix + next + suffix;
  // если внезапно занят — добавляем -2
  if (state.warehouse.some(x => (x.address || '').toLowerCase() === candidate.toLowerCase())) {
    candidate += '-2';
  }
  return candidate;
}
function warehouseToCart(whId) {
  const idx = state.warehouse.findIndex(x => x.id === whId);
  if (idx < 0) return;
  const item = state.warehouse.splice(idx, 1)[0];
  delete item.storedAt;
  state.cart.push(item);
  saveCart(); saveWarehouse();
  renderCart(); renderWarehouse();
  scToast('Взято со склада на тележку', 'ok');
}
async function editWarehouseItem(whId) {
  const item = state.warehouse.find(x => x.id === whId); if (!item) return;
  const serial = await scPrompt('Серийный номер', item.serial || '');
  if (serial === null) return;
  const note = await scPrompt('Заметка', item.note || '');
  if (note === null) return;
  item.serial = serial.trim() || undefined;
  item.note = note.trim() || undefined;
  saveWarehouse(); renderWarehouse();
}
function fmtAge(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const d = Math.floor(diff / 86400000);
  if (d < 1) return 'сегодня';
  if (d === 1) return 'вчера';
  if (d < 30) return `${d} дн. назад`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m} мес. назад`;
  const y = Math.floor(d / 365);
  return `${y} г. назад`;
}
async function discardWarehouseItem(whId) {
  const ok = await scConfirm('Удалить со склада?', 'Устройство будет удалено безвозвратно.', { okLabel: 'Удалить' });
  if (!ok) return;
  state.warehouse = state.warehouse.filter(x => x.id !== whId);
  saveWarehouse(); renderWarehouse();
}
function returnCartItem(cartId) {
  const item = state.cart.find(x => x.id === cartId); if (!item) return;
  if (!item.fromRackId) { scToast('Исходная стойка неизвестна', 'warn'); return; }
  const rack = state.racks.find(r => r.id === item.fromRackId);
  if (!rack) { scToast('Исходная стойка удалена', 'err'); return; }
  // переключаемся на исходную стойку и ставим
  const prevRackId = state.currentRackId;
  state.currentRackId = item.fromRackId;
  const cnt = currentContents();
  const type = state.catalog.find(c => c.id === item.typeId);
  const h = type ? type.heightU : 1;
  const finalU = findNearestFreeSlot(rack, cnt, h, rack.u - rack.occupied);
  if (finalU == null) {
    state.currentRackId = prevRackId;
    scToast('В исходной стойке нет места', 'err');
    return;
  }
  cnt.push({ id: uid('dev'), typeId: item.typeId, label: item.label, positionU: finalU, pduFeed: item.pduFeed || '', pduOutlet: item.pduOutlet || '' });
  state.cart = state.cart.filter(x => x.id !== cartId);
  saveContents(); saveCart();
  // вернуться на текущую стойку, пользователь не ожидает прыжка
  state.currentRackId = prevRackId;
  rerender(); renderCart();
  scToast(`Возвращено в «${rack.name || rack.u+'U'}» U${finalU}`, 'ok');
}

function renderCart() {
  const hosts = ['sc-cart', 'sc-cart-dlg'].map(id => $(id)).filter(Boolean);
  const badges = ['sc-cart-badge', 'sc-cart-badge-dlg'].map(id => $(id)).filter(Boolean);
  badges.forEach(b => b.textContent = state.cart.length);
  let html;
  if (!state.cart.length) {
    html = '<div class="sc-cart-empty muted">Пусто. Перетащите устройство с карты стойки сюда, чтобы вытащить.</div>';
  } else {
    const rows = [`<tr><th>Устройство</th><th>Из стойки</th><th style="width:180px"></th></tr>`];
    state.cart.forEach(item => {
      const fromLabel = item.fromRackName || (item.fromRackId ? '(стойка)' : '—');
      rows.push(`<tr draggable="true" data-cartid="${item.id}">
        <td>${escape(item.label)}</td>
        <td class="muted">${escape(fromLabel)}</td>
        <td>
          <button type="button" class="sc-btn" data-act="return" data-id="${item.id}" title="Вернуть в исходную стойку">↩</button>
          <button type="button" class="sc-btn" data-act="tosh" data-id="${item.id}" title="Отправить на склад">→ склад</button>
        </td>
      </tr>`);
    });
    html = `<table class="sc-cart-tbl">${rows.join('')}</table>`;
  }
  hosts.forEach(host => {
    host.innerHTML = html;
    host.querySelectorAll('tr[data-cartid]').forEach(tr => {
      tr.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('application/x-scs-cartid', tr.dataset.cartid);
        ev.dataTransfer.effectAllowed = 'move';
        tr.classList.add('sc-drag-src');
        const item = state.cart.find(x => x.id === tr.dataset.cartid);
        const type = item && state.catalog.find(c => c.id === item.typeId);
        if (item && type) setDragGhost(ev, type, item.label);
      });
      tr.addEventListener('dragend', () => { tr.classList.remove('sc-drag-src'); state._dragMeta = null; });
    });
    host.querySelectorAll('[data-act="return"]').forEach(b => b.addEventListener('click', () => returnCartItem(b.dataset.id)));
    host.querySelectorAll('[data-act="tosh"]').forEach(b => b.addEventListener('click', () => cartToWarehouse(b.dataset.id)));
  });
}
function renderWarehouse() {
  const hosts = ['sc-wh', 'sc-wh-dlg'].map(id => $(id)).filter(Boolean);
  const badges = ['sc-wh-badge', 'sc-wh-badge-dlg'].map(id => $(id)).filter(Boolean);
  badges.forEach(b => b.textContent = state.warehouse.length);
  let html;
  const toolbar = `<div class="sc-wh-toolbar">
    <input type="search" class="sc-wh-search" placeholder="🔎 поиск по адресу/названию/S/N" value="${escape(state.whFilter || '')}">
    <button type="button" class="sc-btn" data-act="whcsv" title="Экспорт инвентаря в CSV">CSV</button>
  </div>`;
  if (!state.warehouse.length) {
    html = toolbar + '<div class="sc-cart-empty muted">Склад пуст.</div>';
  } else {
    const rows = [`<tr><th>Адрес</th><th>Устройство</th><th>S/N · заметка</th><th>Было в</th><th>Хранится</th><th style="width:240px"></th></tr>`];
    // сортировка по адресу (натуральная), пустые — в конец; в пределах равного адреса — по дате desc
    const f = (state.whFilter || '').trim().toLowerCase();
    const matches = (it) => !f ||
      (it.address || '').toLowerCase().includes(f) ||
      (it.label || '').toLowerCase().includes(f) ||
      (it.serial || '').toLowerCase().includes(f) ||
      (it.note || '').toLowerCase().includes(f);
    const sorted = state.warehouse.filter(matches).sort((a, b) => {
      const aa = a.address || '\uFFFF'; const bb = b.address || '\uFFFF';
      const cmp = aa.localeCompare(bb, 'ru', { numeric: true });
      if (cmp !== 0) return cmp;
      return (b.storedAt || 0) - (a.storedAt || 0);
    });
    if (!sorted.length) rows.push('<tr><td colspan="6" class="muted">— по фильтру ничего —</td></tr>');
    sorted.forEach(item => {
      const fromLabel = item.fromRackName || '—';
      const snNote = [item.serial ? `S/N: ${escape(item.serial)}` : '', item.note ? escape(item.note) : '']
        .filter(Boolean).join(' · ') || '<span class="muted">—</span>';
      const addr = item.address
        ? `<code style="background:#fef3c7;padding:1px 5px;border-radius:3px;font-size:11px">${escape(item.address)}</code>`
        : '<span class="muted" style="font-size:11px">— нет —</span>';
      rows.push(`<tr draggable="true" data-whid="${item.id}">
        <td>${addr}</td>
        <td>${escape(item.label)}</td>
        <td style="font-size:11px">${snNote}</td>
        <td class="muted">${escape(fromLabel)}</td>
        <td class="muted" title="${item.storedAt ? new Date(item.storedAt).toLocaleString() : ''}">${fmtAge(item.storedAt)}</td>
        <td>
          <button type="button" class="sc-btn" data-act="addr" data-id="${item.id}" title="Адрес хранения (зона-стеллаж-полка-ячейка)">📍</button>
          <button type="button" class="sc-btn" data-act="edit" data-id="${item.id}" title="Редактировать S/N и заметку">📝</button>
          <button type="button" class="sc-btn" data-act="tocart" data-id="${item.id}" title="Взять на тележку">↑ на тележку</button>
          <button type="button" class="sc-btn sc-btn-danger" data-act="del" data-id="${item.id}" title="Удалить со склада">✕</button>
        </td>
      </tr>`);
    });
    html = toolbar + `<table class="sc-cart-tbl">${rows.join('')}</table>`;
  }
  hosts.forEach(host => {
    host.innerHTML = html;
    const search = host.querySelector('.sc-wh-search');
    if (search) search.addEventListener('input', ev => {
      state.whFilter = ev.target.value;
      renderWarehouse();
      // refocus после re-render (innerHTML уничтожает старый input)
      requestAnimationFrame(() => {
        const sNew = host.querySelector('.sc-wh-search');
        if (sNew) { sNew.focus(); sNew.setSelectionRange(sNew.value.length, sNew.value.length); }
      });
    });
    const csvBtn = host.querySelector('[data-act="whcsv"]');
    if (csvBtn) csvBtn.addEventListener('click', exportWarehouseCsv);
    host.querySelectorAll('tr[data-whid]').forEach(tr => {
      tr.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('application/x-scs-whid', tr.dataset.whid);
        ev.dataTransfer.effectAllowed = 'move';
        tr.classList.add('sc-drag-src');
        const item = state.warehouse.find(x => x.id === tr.dataset.whid);
        const type = item && state.catalog.find(c => c.id === item.typeId);
        if (item && type) setDragGhost(ev, type, item.label);
      });
      tr.addEventListener('dragend', () => { tr.classList.remove('sc-drag-src'); state._dragMeta = null; });
    });
    host.querySelectorAll('[data-act="tocart"]').forEach(b => b.addEventListener('click', () => warehouseToCart(b.dataset.id)));
    host.querySelectorAll('[data-act="del"]').forEach(b => b.addEventListener('click', () => discardWarehouseItem(b.dataset.id)));
    host.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => editWarehouseItem(b.dataset.id)));
    host.querySelectorAll('[data-act="addr"]').forEach(b => b.addEventListener('click', () => editWarehouseAddress(b.dataset.id)));
  });
}

/* 1.24.35 — адресное хранение на складе. Формат: зона-стеллаж-полка-ячейка
   (напр. A-12-3-2). Свободная строка, сортировка по адресу через
   localeCompare numeric. */
async function editWarehouseAddress(whId) {
  const item = state.warehouse.find(x => x.id === whId); if (!item) return;
  const v = await scPrompt('Адрес хранения', item.address || '');
  if (v === null) return;
  const addr = v.trim();
  if (addr) {
    // проверка дубликата адреса (один адрес = одна единица хранения)
    const dup = state.warehouse.find(x => x.id !== whId && (x.address || '').toLowerCase() === addr.toLowerCase());
    if (dup) {
      const ok = await scConfirm('Адрес занят', `По адресу «${addr}» уже хранится «${dup.label}». Всё равно присвоить?`, { okLabel: 'Да' });
      if (!ok) return;
    }
    item.address = addr;
  } else {
    delete item.address;
  }
  saveWarehouse(); renderWarehouse();
}

/* HTML5-drop на тележку (для drag со склада, если доделаем; сейчас только
   pointer-drag с карты обрабатывается в pointerup). */
function bindCartWarehouseDropzones() {
  // привязываем ВСЕ зоны (основная страница + модалка)
  document.querySelectorAll('.sc-cart-dropzone').forEach(cartZone => {
    cartZone.addEventListener('dragover', ev => {
      if (!Array.from(ev.dataTransfer.types).includes('application/x-scs-whid')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      cartZone.classList.add('sc-drop-hover');
    });
    cartZone.addEventListener('dragleave', () => cartZone.classList.remove('sc-drop-hover'));
    cartZone.addEventListener('drop', ev => {
      cartZone.classList.remove('sc-drop-hover');
      const whId = ev.dataTransfer.getData('application/x-scs-whid');
      if (whId) { ev.preventDefault(); warehouseToCart(whId); }
    });
  });
  document.querySelectorAll('.sc-wh-dropzone').forEach(whZone => {
    whZone.addEventListener('dragover', ev => {
      if (!Array.from(ev.dataTransfer.types).includes('application/x-scs-cartid')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      whZone.classList.add('sc-drop-hover');
    });
    whZone.addEventListener('dragleave', () => whZone.classList.remove('sc-drop-hover'));
    whZone.addEventListener('drop', ev => {
      whZone.classList.remove('sc-drop-hover');
      const cartId = ev.dataTransfer.getData('application/x-scs-cartid');
      if (cartId) { ev.preventDefault(); cartToWarehouse(cartId); }
    });
  });
}

/* ---- глобальный rerender ---------------------------------------------- */
function rerenderPreview() {
  // 1.24.40 — основная карта в rack.html теперь всегда с zoom/pan (как раньше в модалке)
  renderUnitMap('sc-unitmap', { big: true });
  const dlg = $('sc-unitmap-dlg');
  if (dlg && dlg.open) renderUnitMap('sc-unitmap-dlg-body', { big: true });
  renderWarnings(); renderBom();
}
function rerender() { renderRackPicker(); renderRacksSidebar(); renderTemplates(); renderContents(); renderMatrix(); rerenderPreview(); renderCart(); renderWarehouse(); }

/* 1.24.39 — сайдбар со списком всех шкафов проекта (в rack.html).
   Клик по карточке переключает state.currentRackId + URL без перезагрузки. */
function renderRacksSidebar() {
  const host = $('sc-racks-side'); if (!host) return;
  if (!state.racks.length) {
    host.innerHTML = `<div class="sc-cart-empty">Нет шаблонов стоек.<br><a href="../rack-config/">Создать</a></div>`;
    return;
  }
  host.innerHTML = state.racks.map(r => {
    const devs = state.contents[r.id] || [];
    const usedU = devs.reduce((s, d) => {
      const t = state.catalog.find(c => c.id === d.typeId);
      return s + (t ? (t.heightU || 1) : 1);
    }, 0);
    const tag = (state.rackTags[r.id] || '').trim();
    const full = r.u || 0;
    const pct = full ? Math.round(((usedU + (r.occupied || 0)) / full) * 100) : 0;
    const active = r.id === state.currentRackId ? ' sc-rack-card-active' : '';
    return `<div class="sc-rack-card${active}" data-rackid="${r.id}" title="Открыть">
      <div class="sc-rack-card-top">
        ${tag ? `<code>${escape(tag)}</code>` : `<span class="muted">—</span>`}
        <span class="muted">${full}U</span>
      </div>
      <div class="sc-rack-card-name">${escape(r.name || 'Без имени')}</div>
      <div class="sc-rack-card-bar">
        <div style="width:${pct}%;background:${pct>90?'#dc2626':pct>70?'#f59e0b':'#10b981'}"></div>
      </div>
      <div class="sc-rack-card-meta"><span>${devs.length} уст.</span><span class="muted">${pct}%</span></div>
    </div>`;
  }).join('');
  host.querySelectorAll('.sc-rack-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.rackid;
      if (id === state.currentRackId) return;
      state.currentRackId = id;
      try { history.replaceState(null, '', `?rackId=${encodeURIComponent(id)}`); } catch {}
      rerender();
    });
  });
}

/* ---- init -------------------------------------------------------------- */
function init() {
  state.racks     = loadRacks();
  state.catalog   = loadJson(LS_CATALOG,   DEFAULT_CATALOG.slice());
  state.contents  = loadJson(LS_CONTENTS,  {});
  state.matrix    = loadJson(LS_MATRIX,    {});
  state.templates = loadJson(LS_TEMPLATES, []);
  state.cart      = loadJson(LS_CART,      []);
  state.rackTags  = loadJson(LS_RACKTAGS,  {});
  state.warehouse = loadJson(LS_WAREHOUSE, []);
  if (!state.catalog.length) state.catalog = DEFAULT_CATALOG.slice();
  // 1.24.24 URL-роутинг: ?rackId=<id> предпочитает выбор стойки из URL;
  // ?tag=<tia> ищет стойку по TIA-тегу (DC1.H3.R05). Если нет — auto-pick первой.
  const qp = new URLSearchParams(location.search);
  const qRackId = qp.get('rackId');
  const qTag = qp.get('tag');
  let pickedId = null;
  if (qRackId && state.racks.find(r => r.id === qRackId)) pickedId = qRackId;
  else if (qTag) {
    const match = Object.entries(state.rackTags).find(([id, t]) => t.toLowerCase() === qTag.toLowerCase());
    if (match && state.racks.find(r => r.id === match[0])) pickedId = match[0];
  }
  if (!pickedId && state.racks.length) pickedId = state.racks[0].id;
  state.currentRackId = pickedId;

  renderCatalog();
  rerender();
  bindCartWarehouseDropzones();

  $('sc-rack').addEventListener('change', e => {
    state.currentRackId = e.target.value || null;
    renderContents(); renderMatrix(); rerenderPreview();
    const r = currentRack();
    $('sc-rack-u').textContent = r ? r.u : '—';
    $('sc-rack-occ').textContent = r ? r.occupied : '—';
    $('sc-rack-tag').value = r ? (state.rackTags[r.id] || '') : '';
    // 1.24.24 — синхронизируем URL (без перезагрузки), чтобы ссылки делились
    if (state.currentRackId) {
      const url = new URL(location.href);
      url.searchParams.set('rackId', state.currentRackId);
      url.searchParams.delete('tag');
      history.replaceState(null, '', url);
    }
  });
  // 1.24.23 — TIA-942 тег стойки (+1.24.40: уникальность в проекте)
  const tagInput = $('sc-rack-tag');
  tagInput.addEventListener('change', () => {
    const r = currentRack(); if (!r) return;
    const v = tagInput.value.trim();
    if (v) {
      // проверка: тег не должен совпадать с тегом другой стойки
      const dup = Object.entries(state.rackTags).find(([id, t]) =>
        id !== r.id && (t || '').trim().toLowerCase() === v.toLowerCase());
      if (dup) {
        const other = state.racks.find(x => x.id === dup[0]);
        scToast(`Тег «${v}» уже присвоен стойке «${other?.name || dup[0]}». Тег должен быть уникальным.`, 'warn');
        tagInput.value = state.rackTags[r.id] || '';
        return;
      }
      state.rackTags[r.id] = v;
    } else {
      delete state.rackTags[r.id];
    }
    saveRackTags();
    renderContents(); rerenderPreview();
    renderRacksSidebar && renderRacksSidebar();
  });
  // начальная подгрузка тега
  if (state.currentRackId) tagInput.value = state.rackTags[state.currentRackId] || '';
  $('sc-cat-add').addEventListener('click', () => {
    state.catalog.push({
      id: uid('t'), kind: 'other', label: 'Новый тип',
      heightU: 1, powerW: 0, ports: 0, color: '#94a3b8'
    });
    saveCatalog();
    renderCatalog();
  });
  $('sc-cat-reset').addEventListener('click', () => {
    scConfirm('Сбросить каталог к базовому набору?', 'Пользовательские типы будут удалены.', { okLabel: 'Сбросить' }).then(ok => {
      if (!ok) return;
      state.catalog = DEFAULT_CATALOG.slice();
      saveCatalog();
      renderCatalog();
    });
  });
  $('sc-auto').addEventListener('click', autoPack);
  $('sc-matrix-add').addEventListener('click', addMatrixRow);
  $('sc-bom-csv').addEventListener('click', exportBomCsv);
  $('sc-template-save').addEventListener('click', saveCurrentAsTemplate);
  $('sc-template-apply').addEventListener('click', applyTemplate);

  /* ---- 1.24.11 переключатель режима (СКС / Питание) ------------------ */
  document.querySelectorAll('.sc-vm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.mode;
      document.querySelectorAll('.sc-vm-btn').forEach(b => {
        b.classList.toggle('sc-vm-active', b.dataset.mode === state.viewMode);
      });
      rerenderPreview();
    });
  });

  /* ---- 1.24.12 полноэкранная карта (legacy — модалка удалена после 1.24.38) */
  const dlg = $('sc-unitmap-dlg');
  const fsBtn = $('sc-unitmap-fullscreen');
  if (fsBtn && dlg) {
    fsBtn.addEventListener('click', () => {
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      renderUnitMap('sc-unitmap-dlg-body', { big: true });
    });
    const closeBtn = $('sc-unitmap-dlg-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
  }

  // pick up rack template changes in other tabs
  window.addEventListener('storage', e => {
    if (e.key === LS_RACK) {
      state.racks = loadRacks();
      if (!state.racks.find(r => r.id === state.currentRackId)) {
        state.currentRackId = state.racks[0]?.id || null;
      }
      rerender();
    }
  });
}

init();
