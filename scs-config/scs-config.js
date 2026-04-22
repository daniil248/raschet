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
    rows.push(`<tr data-idx="${idx}">
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
  t.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    if (!confirm('Удалить тип оборудования из каталога? Уже размещённые единицы в стойках НЕ будут удалены.')) return;
    state.catalog = state.catalog.filter(c => c.id !== id);
    saveCatalog();
    renderCatalog();
  }));
}

/* ---- добавление устройства в стойку ------------------------------------ */
function addToRack(typeId) {
  const r = currentRack(); if (!r) { alert('Сначала выберите стойку.'); return; }
  const type = state.catalog.find(c => c.id === typeId); if (!type) return;
  const positionU = findFirstFreeSlot(r, currentContents(), type.heightU);
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
    <th>U</th><th>Тип</th><th>Название</th><th>Ввод</th><th>PDU outlet</th>
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
      <td><select data-k="pduFeed" style="width:60px">${feedOptsHtml}</select></td>
      <td><select data-k="pduOutlet">${outletOptsHtml}</select></td>
      <td><button type="button" class="sc-btn sc-btn-danger" data-del="${d.id}">✕</button></td>
    </tr>`);
  });
  if (!devices.length) rows.push('<tr><td colspan="6" class="muted">— пусто — добавьте из каталога кнопкой ➕</td></tr>');
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

  // сначала пустые ряды / занятые стойкой
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
    const labelTxt = mode === 'power'
      ? `${d.label}${d.pduFeed ? ' · ввод '+d.pduFeed : ' · ⚠ без PDU'}${type.powerW ? ' · '+type.powerW+' Вт' : ''}`
      : `${d.label}${d.pduFeed ? ' · '+d.pduFeed : ''}`;
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

  const svgId = opts.big ? 'sc-unitmap-svg-big' : 'sc-unitmap-svg';
  host.innerHTML = `<svg id="${svgId}" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" data-rowh="${rowH}">
    ${rects.join('')}
    ${deviceGroups}
  </svg>
  <div class="sc-unitmap-legend">${legend.join('') || '<span class="muted">— пусто —</span>'}</div>`;
  bindUnitMapDrag(svgId);
}

/* ---- drag-n-drop в SVG (1.24.3 full) ---------------------------------
   Pointerdown на <g.sc-devband> — захват; pointermove — двигаем полосу,
   snap к целому U; pointerup — коммит (saveContents) или откат (если
   вышли за границы). Используются Pointer Events API (работает для мыши
   и сенсорного ввода). SetPointerCapture позволяет таскать за пределами
   исходного rect. */
function bindUnitMapDrag(svgId) {
  const svg = $(svgId || 'sc-unitmap-svg'); if (!svg) return;
  const rowH = +svg.dataset.rowh || 16;
  svg.querySelectorAll('g.sc-devband').forEach(g => {
    g.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const devId = g.dataset.devid;
      const d = currentContents().find(x => x.id === devId); if (!d) return;
      state.drag = { devId, startY: ev.clientY, startU: d.positionU, rowH, g };
      g.setPointerCapture(ev.pointerId);
      g.style.cursor = 'grabbing';
      g.style.opacity = '0.75';
    });
    g.addEventListener('pointermove', ev => {
      if (!state.drag || state.drag.devId !== g.dataset.devid) return;
      const r = currentRack(); if (!r) return;
      const d = currentContents().find(x => x.id === state.drag.devId); if (!d) return;
      const dy = ev.clientY - state.drag.startY;
      const drows = Math.round(-dy / rowH); // вверх по экрану = больший U
      const h = +g.dataset.h || 1;
      const newU = Math.max(h, Math.min(r.u, state.drag.startU + drows));
      if (newU !== d.positionU) {
        d.positionU = newU;
        renderUnitMap();   // re-draw (rebinds listeners)
        // состояние drag нужно перезахватить, т.к. g уничтожен
        const gNew = document.querySelector(`g.sc-devband[data-devid="${state.drag.devId}"]`);
        if (gNew) { gNew.setPointerCapture(ev.pointerId); gNew.style.cursor = 'grabbing'; gNew.style.opacity = '0.75'; }
      }
    });
    g.addEventListener('pointerup', () => {
      if (!state.drag) return;
      state.drag = null;
      saveContents();
      renderContents();
      renderWarnings();
      renderBom();
    });
    g.addEventListener('pointercancel', () => { state.drag = null; });
  });
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
  const rows = [['Позиция','Раздел','Кол-во','Длина, м','Вт/шт']];
  items.forEach(it => rows.push([it.label, it.kind, it.qty, it.lenM ? it.lenM.toFixed(1) : '', it.powerW ?? '']));
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

/* ---- auto-pack: уложить всё сверху вниз без зазоров ------------------- */
function autoPack() {
  const r = currentRack(); if (!r) return;
  const devices = currentContents();
  let u = r.u - r.occupied;
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    d.positionU = u;
    u -= h;
  });
  saveContents();
  renderContents();
  rerenderPreview();
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
function saveCurrentAsTemplate() {
  const r = currentRack(); if (!r) { alert('Нет выбранной стойки.'); return; }
  const name = prompt('Имя шаблона сборки:', `Сборка · ${r.name || r.u + 'U'}`);
  if (!name) return;
  const tmpl = {
    id: uid('tmpl'),
    name: name.trim(),
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
function applyTemplate() {
  const sel = $('sc-template'); const id = sel.value;
  const tmpl = state.templates.find(t => t.id === id);
  const r = currentRack();
  if (!tmpl || !r) { alert('Выберите шаблон и стойку.'); return; }
  if (!confirm(`Применить шаблон «${tmpl.name}» к текущей стойке? Существующее содержимое и матрица будут заменены.`)) return;
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
  if (dropped.length) alert(`Не поместилось ${dropped.length} устройств (стойка меньше исходной или другое занятое пространство).`);
}

/* ---- глобальный rerender ---------------------------------------------- */
function rerenderPreview() {
  renderUnitMap('sc-unitmap', { big: false });
  const dlg = $('sc-unitmap-dlg');
  if (dlg && dlg.open) renderUnitMap('sc-unitmap-dlg-body', { big: true });
  renderWarnings(); renderBom();
}
function rerender() { renderRackPicker(); renderTemplates(); renderContents(); renderMatrix(); rerenderPreview(); }

/* ---- init -------------------------------------------------------------- */
function init() {
  state.racks     = loadRacks();
  state.catalog   = loadJson(LS_CATALOG,   DEFAULT_CATALOG.slice());
  state.contents  = loadJson(LS_CONTENTS,  {});
  state.matrix    = loadJson(LS_MATRIX,    {});
  state.templates = loadJson(LS_TEMPLATES, []);
  if (!state.catalog.length) state.catalog = DEFAULT_CATALOG.slice();
  // auto-pick rack
  if (state.racks.length) state.currentRackId = state.racks[0].id;

  renderCatalog();
  rerender();

  $('sc-rack').addEventListener('change', e => {
    state.currentRackId = e.target.value || null;
    renderContents(); renderMatrix(); rerenderPreview();
    const r = currentRack();
    $('sc-rack-u').textContent = r ? r.u : '—';
    $('sc-rack-occ').textContent = r ? r.occupied : '—';
  });
  $('sc-cat-add').addEventListener('click', () => {
    state.catalog.push({
      id: uid('t'), kind: 'other', label: 'Новый тип',
      heightU: 1, powerW: 0, ports: 0, color: '#94a3b8'
    });
    saveCatalog();
    renderCatalog();
  });
  $('sc-cat-reset').addEventListener('click', () => {
    if (!confirm('Сбросить каталог типов к базовому набору? Пользовательские типы будут удалены.')) return;
    state.catalog = DEFAULT_CATALOG.slice();
    saveCatalog();
    renderCatalog();
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

  /* ---- 1.24.12 полноэкранная карта ----------------------------------- */
  const dlg = $('sc-unitmap-dlg');
  $('sc-unitmap-fullscreen').addEventListener('click', () => {
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    renderUnitMap('sc-unitmap-dlg-body', { big: true });
  });
  $('sc-unitmap-dlg-close').addEventListener('click', () => { if (dlg && dlg.close) dlg.close(); else dlg.removeAttribute('open'); });

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
