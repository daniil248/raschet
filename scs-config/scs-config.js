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

import {
  ensureDefaultProject, getActiveProjectId, projectKey, listProjects
} from '../shared/project-storage.js';
// v0.59.278: единая точка доступа к стойкам. Шаблоны — глобальные
// (rack-config.templates.v1), экземпляры — project-scoped.
import {
  loadAllRacksForActiveProject, saveAllRacksForActiveProject,
  migrateLegacyInstances, LS_TEMPLATES_GLOBAL
} from '../shared/rack-storage.js';
// v0.59.516/521: POR-источник стоек теперь интегрирован в
// shared/rack-storage.js::loadAllRacksForActiveProject (третий источник
// после templates/instances). scs-config/loadRacks() лишь делегирует
// — отдельный импорт getObjects из POR здесь больше не нужен.

const LS_RACK      = LS_TEMPLATES_GLOBAL;               // оставлен для storage-listener совместимости
const LS_CATALOG   = 'scs-config.catalog.v1';           // глобальный каталог IT-типов
const LS_TEMPLATES = 'scs-config.assemblyTemplates.v1'; // глобальная библиотека шаблонов сборок

// Проектные ключи — переопределяются в rescopeToActiveProject() при запуске.
let LS_CONTENTS  = 'scs-config.contents.v1';
let LS_MATRIX    = 'scs-config.matrix.v1';
let LS_CART      = 'scs-config.cart.v1';
let LS_RACKTAGS  = 'scs-config.rackTags.v1';
let LS_WAREHOUSE = 'scs-config.warehouse.v1';

/* v0.59.232: защита от удаления подключённых устройств. Читаем
   scs-design.links активного проекта; если устройство (rackId+devId)
   фигурирует как fromRackId+fromDevId или toRackId+toDevId хотя бы в
   одной связи — удаление/«на тележку» запрещены. Требование: «если к
   оборудованию был подключен хоть один кабель, оборудование удалять из
   проекта нельзя». */
function hasAttachedCables(rackId, devId) {
  try {
    const pid = getActiveProjectId();
    if (!pid) return false;
    const key = projectKey(pid, 'scs-design', 'links.v1');
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return false;
    return arr.some(l =>
      (l.fromRackId === rackId && l.fromDevId === devId) ||
      (l.toRackId   === rackId && l.toDevId   === devId)
    );
  } catch { return false; }
}
function countAttachedCables(rackId, devId) {
  try {
    const pid = getActiveProjectId();
    if (!pid) return 0;
    const key = projectKey(pid, 'scs-design', 'links.v1');
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    return arr.filter(l =>
      (l.fromRackId === rackId && l.fromDevId === devId) ||
      (l.toRackId   === rackId && l.toDevId   === devId)
    ).length;
  } catch { return 0; }
}

const OLD_SCS_KEYS = {
  contents:  'scs-config.contents.v1',
  matrix:    'scs-config.matrix.v1',
  cart:      'scs-config.cart.v1',
  rackTags:  'scs-config.rackTags.v1',
  warehouse: 'scs-config.warehouse.v1',
};

function rescopeToActiveProject() {
  ensureDefaultProject();
  const pid = getActiveProjectId();
  LS_CONTENTS  = projectKey(pid, 'scs-config', 'contents.v1');
  LS_MATRIX    = projectKey(pid, 'scs-config', 'matrix.v1');
  LS_CART      = projectKey(pid, 'scs-config', 'cart.v1');
  LS_RACKTAGS  = projectKey(pid, 'scs-config', 'rackTags.v1');
  LS_WAREHOUSE = projectKey(pid, 'scs-config', 'warehouse.v1');
  const pairs = [
    [OLD_SCS_KEYS.contents,  LS_CONTENTS],
    [OLD_SCS_KEYS.matrix,    LS_MATRIX],
    [OLD_SCS_KEYS.cart,      LS_CART],
    [OLD_SCS_KEYS.rackTags,  LS_RACKTAGS],
    [OLD_SCS_KEYS.warehouse, LS_WAREHOUSE],
  ];
  let migrated = 0;
  for (const [oldK, newK] of pairs) {
    if (oldK === newK) continue;
    try {
      if (localStorage.getItem(newK) == null && localStorage.getItem(oldK) != null) {
        localStorage.setItem(newK, localStorage.getItem(oldK));
        migrated++;
      }
    } catch {}
  }
  return { pid, migrated };
}
rescopeToActiveProject();

/* ---- базовый каталог типов оборудования (1.24.2) ---------------------- */
// v0.59.245: depthMm — монтажная глубина устройства, мм. Используется
// side-view и depth-collision check. Дефолты — типичные для категории.
/* v0.59.257: каталог вынесен в shared/scs-catalog-data.js (по образцу
   rack-catalog-data.js). Здесь — только импорт под прежними именами. */
import { SCS_DEFAULT_CATALOG, KIND_LABEL as _KIND_LABEL } from '../shared/scs-catalog-data.js';
import { wireExportImport } from '../shared/config-io.js';
import { APP_VERSION } from '../js/engine/constants.js';
const DEFAULT_CATALOG = SCS_DEFAULT_CATALOG;
const KIND_LABEL = _KIND_LABEL;

/* v0.59.282: тип физического порта устройства — используется scs-design для
   валидации «порт ↔ кабель». 'auto' = определяется по kind / label. */
const PORT_TYPE_OPTIONS = [
  ['', 'авто'], ['rj45', 'RJ45'], ['lc', 'LC (фибра)'], ['sc', 'SC (фибра)'],
  ['sfp', 'SFP/SFP+'], ['bnc', 'BNC'], ['f', 'F-разъём'],
  ['c13', 'C13'], ['c14', 'C14'], ['power', 'силовой'], ['none', 'без портов'],
];

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
  // v0.59.245: face mode — какой «вид» стойки рисуется.
  //   'front' — фронт (как раньше), монтаж — передние рельсы
  //   'rear'  — тыл, монтаж — задние рельсы
  //   'side'  — вид сбоку (профиль), виден depth + mountSide всех устройств
  //   '3d'    — three.js (v0.59.246)
  // v0.59.247: persist в LS (пользовательская настройка вида — пусть остаётся).
  faceMode: (function(){ try { return localStorage.getItem('scs-config.faceMode.v1') || 'front'; } catch { return 'front'; } })(),
  // v0.59.258: направление U-нумерации. 'bu' = 1 снизу (классика, EIA-310),
  // 'td' = 1 сверху (нек-рые внутренние стандарты операторов).
  uNumDir: (function(){ try { return localStorage.getItem('scs-config.uNumDir.v1') || 'bu'; } catch { return 'bu'; } })(),
  // v0.59.264: фильтры каталога persist. Диапазон U и подстрока часто нужны
  // повторно, при переключении стоек/сборок — пусть не сбрасываются.
  catFilter: (function(){
    try { return JSON.parse(localStorage.getItem('scs-config.catFilter.v1') || 'null') || { q:'', kind:'', uMin:'', uMax:'' }; }
    catch { return { q:'', kind:'', uMin:'', uMax:'' }; }
  })(),
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
  // v0.59.521: вся логика (templates + instances + POR) теперь внутри
  // shared/rack-storage.js::loadAllRacksForActiveProject. Это даёт
  // одинаковую видимость POR-стоек во ВСЕХ потребителях rack-storage:
  // scs-config / racks-list / scs-design / прочих.
  try {
    migrateLegacyInstances();
    return loadAllRacksForActiveProject() || [];
  } catch (e) { console.warn('[scs-config] loadRacks error', e); return []; }
}
function saveRacks() {
  // v0.59.278: разложить state.racks по соответствующим ключам.
  try { saveAllRacksForActiveProject(state.racks); } catch (e) { console.warn('[scs-config] saveRacks error', e); }
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
// v0.59.530: ОТКАТ contentsBasedKw write в POR.
// По уточнению пользователя: электрику нужна ЗАПРАШИВАЕМАЯ мощность
// (от технолога, demandKw), а не суммарная по содержимому стойки. По факту
// в стойке может быть меньше оборудования, но проектный расчёт
// (кабель/автомат) ведётся по запрошенной. Поэтому contentsBasedKw как
// автозапись в POR не нужна — она вводила в заблуждение. Если потребуется
// видеть «реальное наполнение vs запрос» — это отдельный UI без записи
// в electrical-домен.
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
/* Генерируемый тег устройства: <rackTag>.U<bottom> (TIA-606).
   Для многоюнитных устройств адрес определяется НИЖНЕЙ точкой крепления
   (монтажный референс), без диапазона — например 2U с top=43 → "U42".
   Высота подставляется отдельно в колонку размера устройства. */
function deviceTag(d) {
  const r = currentRack(); if (!r) return '';
  const tag = (state.rackTags[r.id] || '').trim();
  if (!tag) return '';
  const type = state.catalog.find(c => c.id === d.typeId);
  const h = type ? type.heightU : 1;
  const bottom = d.positionU - h + 1;
  return `${tag}.U${bottom}`;
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

/* v0.59.255: "Физический шкаф проекта" — только стойки с тегом.
   Без тега — это глобальные шаблоны корпусов (hardware blueprint), они
   не относятся к проекту и в списках/дропдаунах/сайдбаре модуля СКС не показываются. */
function projectRacks() {
  // v0.59.274: если URL содержит ?rackId=<id>, а такая стойка есть в библиотеке,
  // но без TIA-тега в текущем проекте — всё равно включаем её в список, чтобы
  // ссылка вида rack.html?rackId=inst-… открывалась, а пользователь видел
  // конкретную причину (см. renderWarnings: «стойка без TIA-тега»).
  let pinned = null;
  try {
    const qp = new URLSearchParams(location.search);
    pinned = qp.get('rackId') || null;
  } catch {}
  return state.racks.filter(r => {
    const hasTag = ((state.rackTags && state.rackTags[r.id]) || '').trim();
    if (hasTag) return true;
    if (pinned && r.id === pinned) return true;
    return false;
  });
}

/* ---- render: верх (выбор стойки) --------------------------------------- */
/* v0.59.277: label стойки = «TAG (TemplateName · Uu)».
   Правила:
   — если у экземпляра задан sourceTemplateId и шаблон найден → берём его name
   — иначе → r.name (собственное имя экземпляра), если оно не совпадает с тегом
   — Uu добавляется в конце (из шаблона, если геометрия взята оттуда, иначе из r.u).
   Это даёт пользователю однозначную строку: «A-02 (600x1200x42U Тип 1 · 42U)». */
function rackLabel(r) {
  if (!r) return '';
  const tag = ((state.rackTags && state.rackTags[r.id]) || '').trim();
  // ищем шаблон корпуса по sourceTemplateId; fallback — snapshot'ное имя.
  let corpusName = '';
  if (r.sourceTemplateId) {
    const tpl = state.racks.find(x => x.id === r.sourceTemplateId);
    corpusName = tpl ? (tpl.name || '') : (r.sourceTemplateName || '');
  }
  if (!corpusName) corpusName = r.name || '';
  const uPart = (r.u ? r.u + 'U' : '');
  // если tag уже совпадает с name (старые экземпляры имели name=«Стойка (TAG)») —
  // не дублируем, показываем просто «TAG (Uu)».
  const suffix = corpusName
    ? `${corpusName}${uPart ? ' · ' + uPart : ''}`
    : uPart;
  if (tag) return suffix ? `${tag} (${suffix})` : tag;
  return suffix || r.id;
}

function renderRackPicker() {
  const sel = $('sc-rack');
  const list = projectRacks();
  sel.innerHTML = list.length
    ? list.map(r => `<option value="${r.id}">${escape(rackLabel(r))}</option>`).join('')
    : `<option value="">— в проекте нет физических шкафов; разверните в Реестре IT-оборудования —</option>`;
  if (state.currentRackId && list.find(r => r.id === state.currentRackId)) sel.value = state.currentRackId;
  else if (list[0]) {
    state.currentRackId = list[0].id;
    sel.value = state.currentRackId;
  } else {
    state.currentRackId = null;
  }
  const r = currentRack();
  $('sc-rack-u').textContent = r ? r.u : '—';
  // v0.59.335: занято = reserved корпусом + сумма U всех размещённых устройств.
  // Раньше показывался только r.occupied (U, зарезервированных корпусом под
  // шасси), поэтому при 13 установленных устройствах показывало «0».
  $('sc-rack-occ').textContent = r ? computeOccupiedU(r, currentContents()) : '—';
  // v0.59.267: свободные диапазоны
  const freeEl = $('sc-rack-free');
  if (freeEl) {
    const ranges = r ? freeURanges(r, currentContents()) : [];
    freeEl.textContent = ranges.length ? ranges.join(', ') : (r ? 'нет' : '—');
    freeEl.title = r ? `Непрерывные свободные U: ${ranges.length} диапазон(ов)` : '';
  }
}

/* ---- render: каталог типов --------------------------------------------- */
function renderCatalog() {
  const t = $('sc-catalog');
  // v0.59.258: фильтры каталога
  const f = state.catFilter || (state.catFilter = { q: '', kind: '', uMin: '', uMax: '' });
  const q = (f.q || '').trim().toLowerCase();
  const kindSel = f.kind || '';
  const uMin = f.uMin === '' ? null : +f.uMin;
  const uMax = f.uMax === '' ? null : +f.uMax;
  // populate kind-filter dropdown (один раз при первом рендере)
  const kf = $('sc-cat-kind-filter');
  if (kf && kf.options.length <= 1) {
    Object.keys(KIND_LABEL).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = KIND_LABEL[k];
      kf.appendChild(opt);
    });
    // v0.59.264: после populate — применить сохранённое значение
    if (kindSel) kf.value = kindSel;
  }
  const rows = [`<tr>
    <th>Тип</th><th>Название</th><th>U</th><th title="Монтажная глубина в мм — используется side-view и проверкой двустороннего монтажа">Глуб., мм</th><th>Вт</th><th title="Количество портов">Порты</th>
    <th title="Порты также с тыла (dual-side): например коммутаторы с mgmt-RJ45 сзади">⇄</th>
    <th title="Тип физического порта для валидации «порт ↔ кабель» в scs-design. «авто» = определяется по типу оборудования и названию.">Порт</th>
    <th title="Скорость порта (например 1G, 10G, 40G, 100G, 400G). Свободный текст.">Скор.</th>
    <th style="width:40px">цвет</th><th style="width:90px"></th>
  </tr>`];
  let shown = 0;
  state.catalog.forEach((c, idx) => {
    if (q && !((c.label || '').toLowerCase().includes(q) || (c.id || '').toLowerCase().includes(q))) return;
    if (kindSel && c.kind !== kindSel) return;
    if (uMin !== null && !(c.heightU >= uMin)) return;
    if (uMax !== null && !(c.heightU <= uMax)) return;
    shown++;
    rows.push(`<tr data-idx="${idx}" draggable="true" data-typeid="${c.id}" title="Перетащите на карту юнитов чтобы разместить в конкретный U">
      <td><select data-k="kind">${Object.keys(KIND_LABEL).map(k =>
        `<option value="${k}"${c.kind===k?' selected':''}>${KIND_LABEL[k]}</option>`).join('')}</select></td>
      <td><input data-k="label" value="${escape(c.label)}"></td>
      <td><input data-k="heightU" type="number" min="1" step="1" value="${c.heightU}"></td>
      <td><input data-k="depthMm" type="number" min="30" max="1200" step="10" value="${c.depthMm}" style="width:60px"></td>
      <td><input data-k="powerW" type="number" min="0" step="1" value="${c.powerW}"></td>
      <td><input data-k="ports" type="number" min="0" step="1" value="${c.ports}"></td>
      <td><input data-k="portsRear" type="checkbox"${c.portsRear ? ' checked' : ''} title="Порты также на задней панели"></td>
      <td><select data-k="portType" style="font-size:11px;max-width:110px">${PORT_TYPE_OPTIONS.map(([v, lbl]) =>
        `<option value="${v}"${(c.portType || '') === v ? ' selected' : ''}>${lbl}</option>`).join('')}</select></td>
      <td><input data-k="portSpeed" value="${escape(c.portSpeed || '')}" placeholder="1G/10G/40G" style="width:72px;font-size:11px"></td>
      <td><input data-k="color" type="color" value="${c.color || '#94a3b8'}" style="width:40px;padding:0"></td>
      <td>
        <button type="button" class="sc-btn" data-add="${c.id}">➕ в стойку</button>
        <button type="button" class="sc-btn sc-btn-danger" data-del="${c.id}" title="Удалить тип">✕</button>
      </td>
    </tr>`);
  });
  // v0.59.273: если фильтры спрятали ВСЕ записи — явная подсказка, чтобы
  // пользователь не думал что каталог «исчез».
  if (shown === 0 && state.catalog.length > 0) {
    rows.push(`<tr><td colspan="11" class="muted" style="text-align:center;padding:12px;background:#fffbeb;color:#92400e">⚠ Все ${state.catalog.length} записей скрыты фильтрами. Нажмите <b>✕ Сброс</b> для очистки.</td></tr>`);
  } else if (state.catalog.length === 0) {
    rows.push(`<tr><td colspan="11" class="muted" style="text-align:center;padding:12px">Каталог пуст. Нажмите <b>↺ Базовый набор</b> чтобы загрузить дефолтные типы.</td></tr>`);
  }
  t.innerHTML = rows.join('');
  const cntEl = $('sc-cat-count');
  if (cntEl) cntEl.textContent = `${shown} / ${state.catalog.length}`;
  // bind cell editing
  t.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('change', () => {
      const tr = el.closest('tr');
      const idx = +tr.dataset.idx;
      const k = el.dataset.k;
      const v = el.type === 'number' ? +el.value : (el.type === 'checkbox' ? el.checked : el.value);
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
function addToRack(typeId, forcedU, forcedSide) {
  const r = currentRack(); if (!r) { scToast('Сначала выберите стойку', 'warn'); return; }
  const type = state.catalog.find(c => c.id === typeId); if (!type) return;
  // v0.59.250: если активный вид — rear, новое устройство ставим на заднюю
  // сторону. Front/Side/3D — на переднюю. forcedSide (из drag API) имеет
  // приоритет. Occupancy считается ТОЛЬКО по этой стороне — front и rear
  // независимы по юнитам.
  const side = forcedSide || (state.faceMode === 'rear' ? 'rear' : 'front');
  let positionU;
  if (Number.isFinite(forcedU)) {
    positionU = Math.max(type.heightU, Math.min(r.u, forcedU));
  } else {
    positionU = findFirstFreeSlot(r, currentContents(), type.heightU, side);
  }
  const dev = {
    id: uid('dev'),
    typeId,
    label: type.label,
    mountSide: side,
    positionU,
    pduFeed: '', pduOutlet: '',
  };
  currentContents().push(dev);
  saveContents();
  renderContents();
  rerenderPreview();
  return dev;
}

/* Ищет первую свободную область heightU подряд сверху вниз, с учётом занятых
   юнитов (r.occupied сверху) и уже расставленных устройств на той же
   стороне монтажа (v0.59.250). Возвращает U-номер верхнего юнита
   устройства или r.u - r.occupied. */
/* v0.59.267: Непрерывные свободные диапазоны U для отображения в top-bar.
   Возвращает массив строк: ["U3–U5", "U10", …] сверху вниз.
   occupied = true если юнит занят ЛЮБОЙ стороной (front/rear/rack-занятые сверху).
   Отдельно по сторонам не выводим (слишком шумно) — считаем пересечение. */
// v0.59.335: суммарно занятые U — reserved корпусом сверху (r.occupied) +
// сумма высот всех размещённых устройств (по каталогу). Если front и rear
// не перекрываются, считаем реальное число «съеденных» юнитов (пересечение
// по сторонам). Используется в top-bar и sidebar-карточках.
function computeOccupiedU(r, devices) {
  if (!r) return 0;
  const occ = new Array(r.u + 1).fill(false);
  for (let u = r.u; u > r.u - (r.occupied || 0); u--) occ[u] = true;
  (devices || []).forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const uh = type ? Math.max(1, Number(type.u) || 1) : 1;
    const top = Number(d.u) || 0;
    if (!top) return;
    for (let i = 0; i < uh; i++) {
      const uu = top + i;
      if (uu >= 1 && uu <= r.u) occ[uu] = true;
    }
  });
  let c = 0;
  for (let u = 1; u <= r.u; u++) if (occ[u]) c++;
  return c;
}

function freeURanges(r, devices) {
  if (!r) return [];
  const occ = new Array(r.u + 1).fill(false);
  // занятые стойкой сверху
  for (let u = r.u; u > r.u - (r.occupied || 0); u--) occ[u] = true;
  // устройства (front и rear оба «съедают» место с точки зрения доступных U)
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) {
      const u = d.positionU - k;
      if (u >= 1 && u <= r.u) occ[u] = true;
    }
  });
  // свободные интервалы сверху вниз
  const ranges = [];
  let start = null;
  for (let u = r.u; u >= 1; u--) {
    if (!occ[u]) { if (start == null) start = u; }
    else if (start != null) { ranges.push([start, u + 1]); start = null; }
  }
  if (start != null) ranges.push([start, 1]);
  return ranges.map(([a, b]) => a === b ? `U${a}` : `U${a}–U${b}`);
}

function findFirstFreeSlot(r, devices, heightU, side) {
  const targetSide = side || 'front';
  const occ = new Array(r.u + 1).fill(false);
  for (let u = r.u; u > r.u - r.occupied; u--) occ[u] = true;
  devices.forEach(d => {
    if ((d.mountSide || 'front') !== targetSide) return; // другая сторона — не мешает
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
  // v0.59.267: обновить «Свободно» при любой перерисовке контента
  const freeEl = $('sc-rack-free');
  if (freeEl) {
    const ranges = r ? freeURanges(r, devices) : [];
    freeEl.textContent = ranges.length ? ranges.join(', ') : (r ? 'нет' : '—');
  }
  // v0.59.268: «⚡ Мощность» — суммарная заявленная, с % от demandKw
  const pwEl = $('sc-rack-power');
  if (pwEl) {
    if (r) {
      const totalW = devices.reduce((s, d) => {
        const type = state.catalog.find(c => c.id === d.typeId);
        return s + (type ? (type.powerW || 0) : 0);
      }, 0);
      const kw = totalW / 1000;
      const demand = +r.demandKw || 0;
      const pct = demand ? Math.round((kw / demand) * 100) : null;
      pwEl.textContent = demand
        ? `${kw.toFixed(2)} / ${demand.toFixed(2)} кВт (${pct}%)`
        : `${totalW} Вт`;
      pwEl.style.color = (pct != null && pct > 100) ? '#b91c1c' : (pct != null && pct > 80) ? '#c2410c' : '';
      pwEl.title = demand
        ? `Σ powerW = ${totalW} Вт; demandKw стойки = ${demand} кВт; использование ${pct}%`
        : `Σ powerW = ${totalW} Вт (demandKw стойки не задан в rack-config)`;
    } else {
      pwEl.textContent = '—';
      pwEl.style.color = '';
    }
  }
  if (!r) { t.innerHTML = '<tr><td>Нет выбранной стойки</td></tr>'; return; }
  const conflicts = detectConflicts(r, devices);
  const rows = [`<tr>
    <th>U</th><th>Тип</th><th>Название</th><th title="TIA-606">Тег</th><th title="Сторона монтажа: передние рельсы (front) или задние (rear). Двустороннее размещение позволяет использовать обе стороны стойки, если позволяет глубина.">Сторона</th><th title="Монтажная глубина, мм. Пусто = из каталога (type.depthMm). Коллизия front+rear на одних U, когда depthA+depthB > rack.depth.">Глуб., мм</th><th>Ввод</th><th>PDU outlet</th>
    <th style="width:50px"></th>
  </tr>`];
  const feeds = pduFeeds(r);
  const allOutlets = pduOutletOptions(r);
  // счётчик использования розеток для проверки «один слот = одно устройство»
  const outletUsage = new Map();
  devices.forEach(d => {
    if (d.pduOutlet) outletUsage.set(d.pduOutlet, (outletUsage.get(d.pduOutlet) || 0) + 1);
  });
  // v0.59.272: визуальная сортировка — сверху стойки вниз (positionU desc).
  // В state.contents порядок не меняем; dataset.idx ссылается на оригинальный индекс.
  const viewOrder = devices.map((d, i) => i).sort((a, b) => {
    const ua = devices[a].positionU, ub = devices[b].positionU;
    if (ub !== ua) return ub - ua;
    // на одном U: front перед rear (как на карте)
    const sa = devices[a].mountSide === 'rear' ? 1 : 0;
    const sb = devices[b].mountSide === 'rear' ? 1 : 0;
    return sa - sb;
  });
  viewOrder.forEach(idx => {
    const d = devices[idx];
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
    const mSide = d.mountSide || 'front';
    const effDepth = (typeof d.depthMm === 'number' ? d.depthMm : (type ? type.depthMm : 0)) || 0;
    rows.push(`<tr data-idx="${idx}" class="${conflict ? 'sc-conflict' : ''}">
      <td><input data-k="positionU" type="number" min="${h}" max="${r.u}" step="1" value="${d.positionU}" style="width:55px"></td>
      <td>${escape(type ? KIND_LABEL[type.kind] : 'Удалён')} · ${h}U</td>
      <td><input data-k="label" value="${escape(d.label)}"></td>
      <td class="muted" style="font-family:monospace;font-size:11px">${escape(deviceTag(d) || '—')}</td>
      <td><select data-k="mountSide" style="width:72px" title="Сторона монтажа"><option value="front"${mSide==='front'?' selected':''}>Фронт</option><option value="rear"${mSide==='rear'?' selected':''}>Тыл</option></select></td>
      <td><input data-k="depthMm" type="number" min="30" max="1200" step="10" value="${effDepth}" style="width:68px" title="Глубина устройства в мм. Каталожное значение: ${type?.depthMm ?? '—'} мм"></td>
      <td><select data-k="pduFeed" style="width:60px">${feedOptsHtml}</select></td>
      <td><select data-k="pduOutlet">${outletOptsHtml}</select></td>
      <td style="white-space:nowrap"><button type="button" class="sc-btn sc-btn-sm" data-dup="${d.id}" title="Дублировать устройство: создаст копию с тем же типом/названием в ближайшем свободном U-слоте, без привязки к PDU-розетке">⎘</button><button type="button" class="sc-btn sc-btn-danger sc-btn-sm" data-del="${d.id}">✕</button></td>
    </tr>`);
  });
  if (!devices.length) rows.push('<tr><td colspan="11" class="muted">— пусто — добавьте из каталога кнопкой ➕</td></tr>');
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
    const n = countAttachedCables(state.currentRackId, id);
    if (n > 0) {
      scToast(`Нельзя удалить: к устройству подключено ${n} ${n === 1 ? 'кабель' : (n < 5 ? 'кабеля' : 'кабелей')}. Сначала удалите связи в «Проектирование СКС».`, 'warn');
      return;
    }
    state.contents[state.currentRackId] = devices.filter(d => d.id !== id);
    saveContents();
    renderContents();
    rerenderPreview();
  }));
  // v0.59.271: дублировать устройство (в ближайший свободный слот, без pduOutlet)
  t.querySelectorAll('[data-dup]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.dup;
    const src = devices.find(d => d.id === id);
    if (!src) return;
    const type = state.catalog.find(c => c.id === src.typeId);
    const h = type ? type.heightU : 1;
    const targetSide = src.mountSide || 'front';
    const topU = findFirstFreeSlot(r, devices, h, targetSide);
    const copy = {
      ...src,
      id: uid('d'),
      positionU: topU,
      pduOutlet: '',  // slot-specific — не наследуем (проверка «1 розетка = 1 устройство»)
      label: src.label + ' (копия)',
    };
    state.contents[state.currentRackId] = [...devices, copy];
    saveContents();
    renderContents();
    rerenderPreview();
    scToast(`Дублировано: ${copy.label} → U${topU}`, 'ok');
  }));
}

/* ---- конфликты: наезд U / переполнение PDU ---------------------------- */
function detectConflicts(r, devices) {
  const conflicts = new Set();
  // v0.59.245: проверяем U-коллизии ОТДЕЛЬНО по сторонам монтажа.
  // Устройство на front не мешает устройству на rear, пока их суммарная
  // глубина помещается в rack.depth (см. detectDepthConflicts).
  const slotFront = new Array(r.u + 1).fill(null);
  const slotRear  = new Array(r.u + 1).fill(null);
  for (let u = r.u; u > r.u - r.occupied; u--) { slotFront[u] = '__rack_occ__'; slotRear[u] = '__rack_occ__'; }
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    const slot = (d.mountSide || 'front') === 'rear' ? slotRear : slotFront;
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
  // depth-коллизии: front+rear на пересекающихся U, если depth_front + depth_rear > rack.depth
  const depthConflicts = detectDepthConflicts(r, devices);
  depthConflicts.forEach(id => conflicts.add(id));
  return conflicts;
}

// v0.59.245: коллизии глубины. Для каждой пары (front-device, rear-device)
// с пересекающимся диапазоном U: если depthFront + depthRear > rack.depth
// с учётом зазора ~50 мм (воздух/кабели) — помечаем обе как конфликт.
function detectDepthConflicts(r, devices) {
  const out = new Set();
  if (!r?.depth || r.depth === 'any') return out; // глубина не задана — пропускаем
  const rackDepth = +r.depth || 0;
  if (!rackDepth) return out;
  // v0.59.256: сравниваем с railDepth (устройства крепятся на рельсы, не в корпус).
  const railDepth = (typeof r.railDepth === 'number' && r.railDepth >= 300) ? +r.railDepth : Math.max(300, rackDepth - 250);
  const GAP = 50; // мм — минимальный внутренний промежуток
  const effDepth = d => {
    if (typeof d.depthMm === 'number' && d.depthMm > 0) return d.depthMm;
    const t = state.catalog.find(c => c.id === d.typeId);
    return t?.depthMm || 0;
  };
  const uRange = d => {
    const t = state.catalog.find(c => c.id === d.typeId);
    const h = t ? t.heightU : 1;
    return [d.positionU - h + 1, d.positionU];
  };
  const fronts = devices.filter(d => (d.mountSide || 'front') === 'front');
  const rears  = devices.filter(d => (d.mountSide || 'front') === 'rear');
  fronts.forEach(a => {
    const [a1, a2] = uRange(a);
    const da = effDepth(a);
    rears.forEach(b => {
      const [b1, b2] = uRange(b);
      const db = effDepth(b);
      const overlap = Math.max(a1, b1) <= Math.min(a2, b2);
      if (!overlap) return;
      if (da + db + GAP > railDepth) { out.add(a.id); out.add(b.id); }
    });
  });
  return out;
}

// v0.59.245: Side-view — профиль стойки сбоку. Ось Y — юниты (как во фронте),
// ось X — глубина (в мм, масштабируется к bodyW). Левая грань = перед стойки,
// правая = зад. Front-устройства рисуются у левой грани, rear — у правой.
// Конфликты (frontDepth + rearDepth + GAP > rackDepth на пересечении U) —
// красная обводка + штриховка в зоне пересечения.
function renderSideView(hostId, opts) {
  const host = $(hostId); if (!host) return;
  const r = currentRack(); if (!r) { host.innerHTML = '<div class="muted">Нет выбранной стойки.</div>'; return; }
  const devices = currentContents();
  const conflicts = detectConflicts(r, devices);
  const depthConflicts = detectDepthConflicts(r, devices);
  const scale = opts?.big ? 2 : 1;
  const rowH = 16 * scale;
  const bodyW = 260 * scale; // ширина панели глубины
  const leftPad = 32;
  const svgH = r.u * rowH + 8;
  const svgW = bodyW + leftPad + 20;
  const rackDepthMm = (+r.depth === +r.depth && r.depth !== 'any') ? +r.depth : 1000;
  // v0.59.256: railDepth — расстояние между 19"-рельсами (adjustable).
  // v0.59.257: front/rear offsets из rack-config (3-field geometry).
  const railDepthMm = (typeof r.railDepth === 'number' && r.railDepth >= 100) ? +r.railDepth : Math.max(300, rackDepthMm - 250);
  const railFrontOff = (typeof r.railFrontOffset === 'number' && r.railFrontOffset >= 0)
    ? +r.railFrontOffset
    : Math.max(0, (rackDepthMm - railDepthMm) / 2);
  const mmToPx = (bodyW) / rackDepthMm;
  const frontRailX = leftPad + railFrontOff * mmToPx;
  const rearRailX  = leftPad + (railFrontOff + railDepthMm) * mmToPx;
  // v0.59.263 fix: frontClearance / rearClearance были не определены — ReferenceError
  // в strict-mode модуля приводил к падению renderSideView.
  const frontClearance = railFrontOff;
  const rearClearance  = Math.max(0, rackDepthMm - railFrontOff - railDepthMm);

  const bgParts = [];
  // профиль стойки
  bgParts.push(`<rect x="${leftPad}" y="4" width="${bodyW}" height="${r.u * rowH}" fill="#f8fafc" stroke="#64748b" stroke-width="1"/>`);
  // передние/задние рельсы — вертикальные линии в позициях railDepth (не у краёв корпуса)
  bgParts.push(`<line x1="${frontRailX}" y1="4" x2="${frontRailX}" y2="${4 + r.u * rowH}" stroke="#3b82f6" stroke-width="2" opacity="0.75"><title>Передний 19"-рельс (отступ ${railFrontOff} мм)</title></line>`);
  bgParts.push(`<line x1="${rearRailX}" y1="4" x2="${rearRailX}" y2="${4 + r.u * rowH}" stroke="#ef4444" stroke-width="2" opacity="0.75"><title>Задний 19"-рельс (railDepth=${railDepthMm} мм, отступ от тыла ${rearClearance} мм)</title></line>`);
  // «зазор до двери» — тонкая штриховка на передней и задней областях
  if (frontClearance > 0) {
    bgParts.push(`<rect x="${leftPad}" y="4" width="${frontRailX - leftPad}" height="${r.u * rowH}" fill="#3b82f6" fill-opacity="0.06"><title>Зазор фасад → передний рельс: ${frontClearance} мм</title></rect>`);
  }
  if (rearClearance > 0) {
    bgParts.push(`<rect x="${rearRailX}" y="4" width="${leftPad + bodyW - rearRailX}" height="${r.u * rowH}" fill="#ef4444" fill-opacity="0.06"><title>Зазор задний рельс → тыл: ${rearClearance} мм</title></rect>`);
  }
  // сетка юнитов
  for (let i = 0; i < r.u; i++) {
    const u = r.u - i;
    const y = 4 + i * rowH;
    bgParts.push(`<line x1="${leftPad}" y1="${y}" x2="${leftPad + bodyW}" y2="${y}" stroke="#e2e8f0" stroke-width="0.5"/>`);
    bgParts.push(`<text x="${leftPad - 4}" y="${y + rowH/2 + 4}" font-size="${9*scale}" fill="#64748b" text-anchor="end">${u}</text>`);
  }
  // «занято стойкой» сверху
  if (r.occupied) {
    const y = 4;
    const h = r.occupied * rowH;
    bgParts.push(`<rect x="${leftPad}" y="${y}" width="${bodyW}" height="${h}" fill="#cbd5e1" stroke="#64748b" stroke-width="0.5"/>`);
    bgParts.push(`<text x="${leftPad + bodyW/2}" y="${y + h/2 + 4}" font-size="${10*scale}" fill="#475569" text-anchor="middle">занято (${r.occupied}U)</text>`);
  }
  // подписи сторон
  bgParts.push(`<text x="${leftPad}" y="${svgH}" font-size="${9*scale}" fill="#3b82f6">◀ перед</text>`);
  bgParts.push(`<text x="${leftPad + bodyW}" y="${svgH}" font-size="${9*scale}" fill="#ef4444" text-anchor="end">зад ▶</text>`);

  const effDepth = d => {
    if (typeof d.depthMm === 'number' && d.depthMm > 0) return d.depthMm;
    const t = state.catalog.find(c => c.id === d.typeId);
    return t?.depthMm || 0;
  };

  const deviceRects = devices.map(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    if (!type) return '';
    const h = type.heightU;
    const topIdx = r.u - d.positionU;
    const y = 4 + topIdx * rowH;
    const side = (d.mountSide || 'front');
    const dmm = effDepth(d);
    const dpx = Math.min(bodyW, Math.max(4, dmm * mmToPx));
    // v0.59.256: устройства крепятся на рельсы, поэтому начинаются от railX, а не от корпуса
    const x = side === 'rear' ? (rearRailX - dpx) : frontRailX;
    const hasConflict = conflicts.has(d.id);
    const depthOverflow = dmm > railDepthMm;
    const fill = type.color || '#94a3b8';
    const stroke = (hasConflict || depthOverflow) ? '#dc2626' : (side === 'rear' ? '#991b1b' : '#1e40af');
    const sw = (hasConflict || depthOverflow) ? 1.5 : 0.6;
    const lbl = `${d.label} · ${dmm}мм · ${side === 'rear' ? 'тыл' : 'фронт'}`;
    return `<g class="sc-sideband" data-devid="${d.id}">
      <rect x="${x}" y="${y}" width="${dpx}" height="${h*rowH - 1}" fill="${fill}" fill-opacity="0.85" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="${x + 4}" y="${y + rowH/2 + 3}" font-size="${9*scale}" fill="#0f172a" clip-path="inset(0 0 0 0)">${escape(lbl)}</text>
    </g>`;
  }).join('');

  // «мостики» коллизий — штриховка между front и rear на пересечении U, если суммарно не помещается
  const collisionMarks = [];
  depthConflicts.forEach(id => {
    // рисовать только один раз на устройство (иначе двойная штриховка)
    // Упрощённо: помечаем ⚠ иконкой справа от устройства.
    const d = devices.find(x => x.id === id); if (!d) return;
    const type = state.catalog.find(c => c.id === d.typeId); if (!type) return;
    const topIdx = r.u - d.positionU;
    const y = 4 + topIdx * rowH;
    const side = (d.mountSide || 'front');
    const iconX = side === 'rear' ? (frontRailX + 6) : (rearRailX - 14);
    collisionMarks.push(`<text x="${iconX}" y="${y + rowH/2 + 4}" font-size="${12*scale}" fill="#dc2626" font-weight="bold" title="Коллизия глубины">⚠</text>`);
  });

  const svgId = opts?.big ? 'sc-sideview-svg-big' : 'sc-sideview-svg';
  const svgEl = `<svg id="${svgId}" class="sc-unitmap-svg sc-sideview-svg" width="${svgW}" height="${svgH + 14}" viewBox="0 0 ${svgW} ${svgH + 14}" xmlns="http://www.w3.org/2000/svg" data-rowh="${rowH}" data-bodyw="${bodyW}" data-bodyx="${leftPad}" data-face="side">
    ${bgParts.join('')}
    ${deviceRects}
    ${collisionMarks.join('')}
  </svg>`;

  // легенда + стат глубины
  const depthConflictN = depthConflicts.size / 2 | 0;
  const maxFront = devices.filter(d => (d.mountSide||'front')==='front').reduce((m,d) => Math.max(m, effDepth(d)), 0);
  const maxRear  = devices.filter(d => (d.mountSide||'front')==='rear' ).reduce((m,d) => Math.max(m, effDepth(d)), 0);
  const freeDepth = railDepthMm - maxFront - maxRear - 50;
  const depthStat = `max front: ${maxFront} · max rear: ${maxRear} · зазор между устройствами: ${freeDepth >= 0 ? freeDepth : 0} мм${freeDepth < 0 ? ' <span style="color:#dc2626">(перегруз)</span>' : ''}`;
  const legend = [
    `<span><i style="background:#3b82f6"></i>Фронт (перед стойки)</span>`,
    `<span><i style="background:#ef4444"></i>Тыл (задняя сторона)</span>`,
    `<span class="muted">Корпус: ${rackDepthMm} мм · Рельсы: <b>${railDepthMm}</b> мм · ${depthStat}</span>`,
  ];
  if (depthConflictN) legend.push(`<span style="color:#dc2626">⚠ Коллизий глубины: ${depthConflictN}</span>`);

  host.innerHTML = `${svgEl}<div class="sc-unitmap-legend">${legend.join('')}</div>`;
  bindSideViewDrop(svgId, rowH, leftPad, bodyW, rackDepthMm);
  bindSideViewMove(svgId, rowH, leftPad, bodyW);
}

/* v0.59.365 — drag-to-move уже размещённых устройств на виде сбоку.
   ЛКМ по полосе → перетаскивание по Y меняет positionU, по X (левая/правая
   половина) — переключает фронт/тыл. Превью рисуется dashed-обводкой. */
function bindSideViewMove(svgId, rowH, leftPad, bodyW) {
  const svg = $(svgId); if (!svg) return;
  const r = currentRack(); if (!r) return;
  svg.querySelectorAll('g.sc-sideband').forEach(g => {
    g.style.cursor = 'grab';
    g.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const devId = g.dataset.devid;
      const d = currentContents().find(x => x.id === devId); if (!d) return;
      const type = state.catalog.find(c => c.id === d.typeId); if (!type) return;
      const h = type.heightU || 1;
      state.sideDrag = { devId, h, startU: d.positionU, startSide: d.mountSide || 'front', wantU: d.positionU, wantSide: d.mountSide || 'front', valid: true };
      g.setPointerCapture(ev.pointerId);
      g.style.opacity = '0.4';
      g.style.cursor = 'grabbing';
    });
    g.addEventListener('pointermove', ev => {
      if (!state.sideDrag || state.sideDrag.devId !== g.dataset.devid) return;
      const rect = svg.getBoundingClientRect();
      const svgH = svg.viewBox.baseVal.height || rect.height;
      const svgW = svg.viewBox.baseVal.width || rect.width;
      const xView = (ev.clientX - rect.left) * (svgW / rect.width);
      const yView = (ev.clientY - rect.top) * (svgH / rect.height);
      const r2 = currentRack(); if (!r2) return;
      const h = state.sideDrag.h;
      const topIdx = Math.max(0, Math.min(r2.u - h, Math.floor((yView - 4) / rowH)));
      const wantU = r2.u - topIdx;
      const wantSide = xView < leftPad + bodyW / 2 ? 'front' : 'rear';
      const valid = canPlace(r2, currentContents(), state.sideDrag.devId, h, wantU, wantSide);
      state.sideDrag.wantU = wantU;
      state.sideDrag.wantSide = wantSide;
      state.sideDrag.valid = valid;
      svg.querySelectorAll('.sc-sidemove-preview').forEach(el => el.remove());
      const y = 4 + (r2.u - wantU) * rowH;
      const previewW = bodyW * 0.45;
      const previewX = wantSide === 'rear' ? (leftPad + bodyW - previewW) : leftPad;
      const color = valid ? '#16a34a' : '#dc2626';
      const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g2.setAttribute('class', 'sc-sidemove-preview');
      g2.setAttribute('pointer-events', 'none');
      g2.innerHTML = `<rect x="${previewX}" y="${y}" width="${previewW}" height="${h * rowH - 1}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${previewX + previewW/2}" y="${y + h*rowH/2 + 4}" font-size="10" fill="${color}" text-anchor="middle" font-weight="bold">${wantSide === 'rear' ? '🟥 тыл' : '🟦 фронт'} · U${wantU}</text>`;
      svg.appendChild(g2);
    });
    const finish = ev => {
      if (!state.sideDrag) return;
      svg.querySelectorAll('.sc-sidemove-preview').forEach(el => el.remove());
      g.style.opacity = '';
      g.style.cursor = 'grab';
      const drag = state.sideDrag; state.sideDrag = null;
      try { g.releasePointerCapture(ev.pointerId); } catch {}
      const moved = drag.wantU !== drag.startU || drag.wantSide !== drag.startSide;
      if (drag.valid && moved) {
        const d = currentContents().find(x => x.id === drag.devId);
        if (d) {
          d.positionU = drag.wantU;
          d.mountSide = drag.wantSide;
          saveContents();
          renderContents(); renderWarnings(); renderBom(); rerenderPreview();
        }
      } else {
        rerenderPreview();
      }
    };
    g.addEventListener('pointerup', finish);
    g.addEventListener('pointercancel', finish);
  });
}

/* v0.59.253 — drop-target на вид сбоку. По X определяется сторона (левая
   половина профиля = фронт, правая = тыл); по Y — U-позиция. Превью
   рисует box с глубиной типа вдоль рельсы. */
function bindSideViewDrop(svgId, rowH, leftPad, bodyW, rackDepthMm) {
  const svg = $(svgId); if (!svg) return;
  const highlight = (on) => svg.classList.toggle('sc-drop-hover', on);
  const acceptType = (types) => types.includes('application/x-scs-typeid') || types.includes('application/x-scs-cartid') || types.includes('application/x-scs-whid');
  const toViewX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const svgW = svg.viewBox.baseVal.width || rect.width;
    return (clientX - rect.left) * (svgW / rect.width);
  };
  const toViewY = (clientY) => {
    const rect = svg.getBoundingClientRect();
    const svgH = svg.viewBox.baseVal.height || rect.height;
    return (clientY - rect.top) * (svgH / rect.height);
  };
  const computeTopU = (clientY) => {
    const r = currentRack(); if (!r) return null;
    const yView = toViewY(clientY);
    const rowIdx = Math.max(0, Math.min(r.u - 1, Math.floor((yView - 4) / rowH)));
    return r.u - rowIdx;
  };
  const computeSide = (clientX) => {
    const xView = toViewX(clientX);
    return xView < leftPad + bodyW / 2 ? 'front' : 'rear';
  };
  const clearPreview = () => { const p = svg.querySelector('.sc-drop-preview'); if (p) p.remove(); };
  const updatePreview = (clientX, clientY, h, depthMm) => {
    const topU = computeTopU(clientY); if (topU == null) return;
    const r = currentRack();
    clearPreview();
    const wantU = Math.min(topU, r.u);
    const side = computeSide(clientX);
    const topIdx = r.u - wantU;
    const y = 4 + topIdx * rowH;
    const ph = h || 1;
    const dpx = Math.min(bodyW, Math.max(6, (depthMm || 400) * (bodyW / rackDepthMm)));
    const x = side === 'rear' ? (leftPad + bodyW - dpx) : leftPad;
    const valid = canPlace(r, currentContents(), null, ph, wantU, side);
    const color = valid ? '#2563eb' : '#dc2626';
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'sc-drop-preview');
    g.setAttribute('pointer-events', 'none');
    g.innerHTML = `<rect x="${x}" y="${y}" width="${dpx}" height="${ph*rowH - 1}"
      fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text x="${x + dpx/2}" y="${y + ph*rowH/2 + 4}" font-size="10" fill="${color}" text-anchor="middle" font-weight="bold">${side === 'rear' ? '🟥 тыл' : '🟦 фронт'} · U${wantU}</text>`;
    svg.appendChild(g);
  };
  const onOver = (ev) => {
    const types = Array.from(ev.dataTransfer.types);
    if (!acceptType(types)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = types.includes('application/x-scs-typeid') ? 'copy' : 'move';
    highlight(true);
    const meta = state._dragMeta || {};
    // depth из каталога: нужен typeId. В _dragMeta его нет — используем дефолт.
    updatePreview(ev.clientX, ev.clientY, meta.h || 1, meta.depthMm || 400);
  };
  svg.addEventListener('dragenter', onOver);
  svg.addEventListener('dragover', onOver);
  svg.addEventListener('dragleave', ev => {
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
    const side = computeSide(ev.clientX);
    if (whId) {
      warehouseToCart(whId);
      const justAdded = state.cart[state.cart.length - 1];
      if (justAdded) { justAdded.mountSide = side; installFromCart(justAdded.id, wantTopU); }
    } else if (cartId) {
      const item = state.cart.find(x => x.id === cartId);
      if (item) item.mountSide = side;
      installFromCart(cartId, wantTopU);
    } else {
      const type = state.catalog.find(c => c.id === typeId); if (!type) return;
      const finalU = findNearestFreeSlot(r, currentContents(), type.heightU, wantTopU, side);
      if (finalU == null) { scToast('Нет свободного места для устройства (' + type.heightU + 'U)', 'err'); return; }
      addToRack(typeId, finalU, side);
    }
  });
}

/* ======================================================================
   v0.59.246 — ЭТАП 2: 3D-вид (PoC, three.js через ESM CDN).
   Ленивая загрузка при первом клике 🧊 3D. Корпус — wireframe box,
   устройства — solid boxes с цветом из каталога. OrbitControls для
   вращения/zoom. Без оптимизаций (полная пересборка сцены на каждый
   render). Cleanup — cancelAnimationFrame + renderer.dispose() при
   переключении на другой face-mode (вызывается из renderUnitMap).
   ====================================================================== */
// v0.59.248 fix: jsdelivr's OrbitControls.js использует bare-спецификатор
// `import { ... } from 'three'`, который браузер не резолвит без import-map.
// esm.sh перезаписывает такие импорты на абсолютные — поэтому грузим отсюда.
let _threePromise = null;
function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = Promise.all([
    import('https://esm.sh/three@0.160'),
    import('https://esm.sh/three@0.160/examples/jsm/controls/OrbitControls.js'),
  ]).then(([THREE, orbit]) => ({ THREE, OrbitControls: orbit.OrbitControls }));
  return _threePromise;
}

async function renderRack3D(hostId, opts) {
  const host = $(hostId); if (!host) return;
  const r = currentRack();
  if (!r) { host.innerHTML = '<div class="muted">Нет выбранной стойки.</div>'; return; }
  // cleanup предыдущего 3D (например, смена стойки в 3D-режиме)
  if (host._3dCleanup) { try { host._3dCleanup(); } catch {} host._3dCleanup = null; }
  host.innerHTML = '<div class="muted" style="padding:20px">🧊 Загрузка three.js…</div>';

  let THREE, OrbitControls;
  try { ({ THREE, OrbitControls } = await loadThree()); }
  catch (e) {
    host.innerHTML = '<div class="sc-warn-item err">Не удалось загрузить three.js. Проверьте сеть.</div>';
    return;
  }
  // пока грузилось — пользователь мог уйти с 3D-режима
  if (state.faceMode !== '3d') return;

  const devices = currentContents();
  const U_MM = 44.45; // 1U = 44.45 мм (EIA-310)
  const rackW = 600;  // типовая ширина корпуса, мм
  const innerW = 482.6; // ширина между 19" рельсами (EIA-310 inside)
  const rackH = r.u * U_MM;
  const rackD = (+r.depth === +r.depth && r.depth !== 'any') ? +r.depth : 1000;
  const FR = 6; // толщина стенок / панелей, мм
  const RAIL_W = 16; // толщина стойки-рельса, мм
  // v0.59.256/257: геометрия рельс (front-offset + railDepth + rear-offset).
  const railDepthMm = (typeof r.railDepth === 'number' && r.railDepth >= 100) ? +r.railDepth : Math.max(300, rackD - 250);
  const railFrontOff = (typeof r.railFrontOffset === 'number' && r.railFrontOffset >= 0) ? +r.railFrontOffset : Math.max(20, (rackD - railDepthMm) / 2);
  const railFrontZ  = railFrontOff;
  const railRearZ   = railFrontZ + railDepthMm;

  const width = Math.max(400, host.clientWidth || 500);
  const height = 480;
  host.innerHTML = '';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);
  const camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
  // v0.59.262: persist позиции камеры между открытиями 3D (ключ — геометрия rack'а,
  // чтобы при смене стойки не наследовать неподходящий вид).
  const camKey = `scs-config.cam3d.v1.${r.u}x${rackW}x${rackD}`;
  const loadedCam = (() => {
    try { return JSON.parse(localStorage.getItem(camKey) || 'null'); } catch { return null; }
  })();
  if (loadedCam && Array.isArray(loadedCam.pos) && Array.isArray(loadedCam.tgt)) {
    camera.position.set(...loadedCam.pos);
  } else {
    camera.position.set(rackW * 1.8, rackH * 1.2, rackD * 1.5);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.display = 'block';
  host.appendChild(renderer.domElement);
  // v0.59.258: hint-оверлей с напоминанием про управление камерой.
  const hint = document.createElement('div');
  hint.textContent = 'ЛКМ — вращать · ПКМ / Shift+ЛКМ / ← ↑ → ↓ — пан · колёсико — zoom';
  hint.style.cssText = 'font-size:11px;color:#64748b;padding:4px 6px;background:rgba(255,255,255,0.85);border-top:1px solid #e2e8f0;';
  host.appendChild(hint);

  const controls = new OrbitControls(camera, renderer.domElement);
  if (loadedCam && Array.isArray(loadedCam.tgt)) controls.target.set(...loadedCam.tgt);
  else controls.target.set(rackW / 2, rackH / 2, rackD / 2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // v0.59.258: панорамирование — явно включено; screen-space pan удобнее для
  // вертикально-ориентированных объектов (стоек). Средняя кнопка / Shift+ЛКМ /
  // стрелки — пан; ПКМ также pan у OrbitControls (по умолчанию у them pan на
  // ПКМ, но включаем явно и ускоряем).
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.2;
  controls.keyPanSpeed = 30;
  controls.zoomSpeed = 1.1;
  controls.rotateSpeed = 0.9;
  controls.listenToKeyEvents(window);
  controls.minDistance = 300;
  controls.maxDistance = rackD * 12;
  // Renderer: физически-корректное освещение для MeshStandard
  renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  controls.update();

  // свет: hemisphere (небо/пол) + ключевой + заполняющий + rim
  scene.add(new THREE.HemisphereLight(0xeef2f7, 0x3b4252, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(2000, 3500, 1800);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 100;
  dir.shadow.camera.far = 8000;
  dir.shadow.camera.left = -rackW * 3;
  dir.shadow.camera.right = rackW * 3;
  dir.shadow.camera.top = rackH * 2;
  dir.shadow.camera.bottom = -rackH * 0.2;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xb4c7e4, 0.35);
  fill.position.set(-1800, 1200, -1500);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd28a, 0.25);
  rim.position.set(500, 1500, -2500);
  scene.add(rim);

  // пол: плоскость принимает тени + сетка
  const floorSize = Math.max(rackD, rackW) * 4;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.95, metalness: 0.0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(rackW / 2, -0.5, rackD / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(floorSize, 40, 0xcbd5e1, 0xe2e8f0);
  grid.position.set(rackW / 2, 0, rackD / 2);
  scene.add(grid);

  // --- корпус шкафа ---
  const cabinet = new THREE.Group();
  scene.add(cabinet);

  // v0.59.258: PBR-материалы (MeshStandard) для более правдоподобного вида.
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3b4454, roughness: 0.42, metalness: 0.78 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.55, transparent: true, opacity: 0.48 });
  const doorMat  = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.25, metalness: 0.3,  transparent: true, opacity: 0.38 });
  const railMat  = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55, metalness: 0.65 });
  const edgeMat  = new THREE.LineBasicMaterial({ color: 0x0f172a, opacity: 0.6, transparent: true });

  const mkBox = (w, h, d, mat, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    e.position.copy(m.position);
    const grp = new THREE.Group();
    grp.add(m); grp.add(e);
    return grp;
  };
  // v0.59.254: раньше фасад создавался через Object.assign(new Mesh, {position:...})
  // — это ломало внутренний matrix Object3D (position — accessor) и 3D падал без
  // ошибки рендера. Используем явный helper.
  const mkMesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  // пол и крыша — всегда
  cabinet.add(mkBox(rackW, FR, rackD, metalMat, rackW/2, FR/2, rackD/2));
  cabinet.add(mkBox(rackW, FR, rackD, metalMat, rackW/2, rackH - FR/2, rackD/2));

  // 4 стойки (рельсы): передние — ближе к z=0; задние — у z=rackD.
  // Рельсы стоят на отступе (rackW - innerW)/2 от боков. Цвет — тёмно-синий спереди,
  // тёмно-красный сзади (чтобы ориентироваться).
  const railInset = (rackW - innerW) / 2;
  const railY = rackH / 2;
  const railH = rackH - 2 * FR;
  const frontRailMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.55, metalness: 0.6 });
  const rearRailMat  = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.55, metalness: 0.6 });
  // передняя пара (z-центр на railFrontZ)
  cabinet.add(mkBox(RAIL_W, railH, RAIL_W, frontRailMat, railInset + RAIL_W/2,          railY, railFrontZ));
  cabinet.add(mkBox(RAIL_W, railH, RAIL_W, frontRailMat, rackW - railInset - RAIL_W/2,  railY, railFrontZ));
  // задняя пара (z-центр на railRearZ)
  cabinet.add(mkBox(RAIL_W, railH, RAIL_W, rearRailMat,  railInset + RAIL_W/2,          railY, railRearZ));
  cabinet.add(mkBox(RAIL_W, railH, RAIL_W, rearRailMat,  rackW - railInset - RAIL_W/2,  railY, railRearZ));

  // боковые стенки — тогл
  const walls = new THREE.Group();
  walls.add(mkBox(FR, rackH - 2*FR, rackD - 2*FR, panelMat, FR/2,          rackH/2, rackD/2));
  walls.add(mkBox(FR, rackH - 2*FR, rackD - 2*FR, panelMat, rackW - FR/2,  rackH/2, rackD/2));
  cabinet.add(walls);

  // v0.59.261: перфорированные двери — canvas-текстура с сеткой отверстий
  // (реальные ЦОД-стойки имеют ~63-83% открытую площадь на дверях).
  const mkPerfTexture = () => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#f1f5f9';
    const step = 10, r = 3;
    for (let y = step; y < 256; y += step) {
      for (let x = step; x < 256; x += step) {
        ctx.beginPath();
        ctx.arc(x + ((y / step) % 2 ? step/2 : 0), y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };
  const perfTex = mkPerfTexture();
  // повторяем с учётом реальных размеров (≈ 1 тайл = 80 мм)
  perfTex.repeat.set((rackW - 2*FR) / 80, (rackH - 2*FR) / 80);
  const perfDoorMat = new THREE.MeshStandardMaterial({
    color: 0x334155, roughness: 0.35, metalness: 0.55,
    transparent: true, opacity: 0.86, alphaMap: perfTex,
  });

  // передняя дверь с перфорацией + ручка + петли
  const doorFront = new THREE.Group();
  doorFront.add(mkBox(rackW - 2*FR, rackH - 2*FR, FR, perfDoorMat, rackW/2, rackH/2, FR/2));
  // рамка двери (непрозрачная) по периметру
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.7 });
  const FRAME_W = 8;
  doorFront.add(mkBox(rackW - 2*FR, FRAME_W, FR, frameMat, rackW/2, FR + FRAME_W/2, FR/2));
  doorFront.add(mkBox(rackW - 2*FR, FRAME_W, FR, frameMat, rackW/2, rackH - FR - FRAME_W/2, FR/2));
  doorFront.add(mkBox(FRAME_W, rackH - 2*FR, FR, frameMat, FR + FRAME_W/2, rackH/2, FR/2));
  doorFront.add(mkBox(FRAME_W, rackH - 2*FR, FR, frameMat, rackW - FR - FRAME_W/2, rackH/2, FR/2));
  // ручка
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.3, metalness: 0.9 });
  doorFront.add(mkBox(30, 80, 8, handleMat, rackW - FR - FRAME_W - 20, rackH * 0.52, -4));
  cabinet.add(doorFront);

  // задняя дверь — тоже перфорированная
  const perfTexRear = mkPerfTexture();
  perfTexRear.repeat.set((rackW - 2*FR) / 80, (rackH - 2*FR) / 80);
  const perfDoorMatRear = new THREE.MeshStandardMaterial({
    color: 0x334155, roughness: 0.35, metalness: 0.55,
    transparent: true, opacity: 0.86, alphaMap: perfTexRear,
  });
  const doorRear = new THREE.Group();
  doorRear.add(mkBox(rackW - 2*FR, rackH - 2*FR, FR, perfDoorMatRear, rackW/2, rackH/2, rackD - FR/2));
  doorRear.add(mkBox(rackW - 2*FR, FRAME_W, FR, frameMat, rackW/2, FR + FRAME_W/2, rackD - FR/2));
  doorRear.add(mkBox(rackW - 2*FR, FRAME_W, FR, frameMat, rackW/2, rackH - FR - FRAME_W/2, rackD - FR/2));
  doorRear.add(mkBox(FRAME_W, rackH - 2*FR, FR, frameMat, FR + FRAME_W/2, rackH/2, rackD - FR/2));
  doorRear.add(mkBox(FRAME_W, rackH - 2*FR, FR, frameMat, rackW - FR - FRAME_W/2, rackH/2, rackD - FR/2));
  doorRear.add(mkBox(30, 80, 8, handleMat, FR + FRAME_W + 20, rackH * 0.52, rackD + 4));
  cabinet.add(doorRear);

  // v0.59.261: ножки — под корпусом, уходят вниз от y=0 (пол смещён ниже).
  // Не шевелим cabinet.position — иначе сломаем координаты устройств (они в scene).
  const footMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.5 });
  const FOOT_H = 40, FOOT_D = 50;
  [[rackW * 0.1, rackD * 0.1], [rackW * 0.9, rackD * 0.1],
   [rackW * 0.1, rackD * 0.9], [rackW * 0.9, rackD * 0.9]].forEach(([fx, fz]) => {
    scene.add(mkBox(FOOT_D, FOOT_H, FOOT_D, footMat, fx, -FOOT_H/2, fz));
  });
  // пол опустить на высоту ножек, чтобы они стояли на нём
  floor.position.y = -FOOT_H;
  grid.position.y  = -FOOT_H + 0.1;

  // «занято стойкой» сверху (фиктивный блок, например патч-панель/органайзер)
  if (r.occupied) {
    const occH = r.occupied * U_MM;
    cabinet.add(mkBox(innerW, occH - 2, rackD - 2*FR - 20, new THREE.MeshLambertMaterial({ color: 0x94a3b8 }),
                      rackW/2, rackH - FR - occH/2, rackD/2));
  }

  // --- устройства с «ушами» + фасад + полки ---
  const depthConflicts = detectDepthConflicts(r, devices);
  const EAR_WIDTH = (rackW - innerW) / 2;   // ~58.7 мм — зона от корпуса до стенки
  const EAR_PLATE = 3;                       // толщина уха по Z (снаружи рельса)
  const earMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.55 });
  const facadeMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.55, metalness: 0.35 });
  const ledGreen = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const ledBlue  = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const ledAmber = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  devices.forEach(d => {
    const type = state.catalog.find(c => c.id === d.typeId); if (!type) return;
    const h = type.heightU;
    const dMm = (typeof d.depthMm === 'number' && d.depthMm > 0) ? d.depthMm : (type.depthMm || 400);
    const side = d.mountSide || 'front';
    const bodyH = h * U_MM - 1.5;
    const yBottom = (d.positionU - h) * U_MM;
    const yCenter = yBottom + bodyH / 2;
    const hex = parseInt((type.color || '#94a3b8').replace('#',''), 16);
    const devMat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.35 });
    const isShelf = type.kind === 'shelf';
    const portsRear = !!type.portsRear;

    // v0.59.256: монтажные плоскости определяются railFrontZ / railRearZ.
    // Полка — тонкий поддон: рисуем плоскость между рельсами
    if (isShelf) {
      const shelfH = Math.max(6, U_MM * 0.25);
      const shelfDepth = Math.min(railDepthMm - RAIL_W, dMm || 500);
      const shelfZ = side === 'rear' ? (railRearZ - RAIL_W/2 - shelfDepth/2) : (railFrontZ + RAIL_W/2 + shelfDepth/2);
      scene.add(mkBox(innerW, shelfH, shelfDepth, devMat, rackW/2, yBottom + shelfH/2, shelfZ));
      // передняя планка полки (бортик) — у монтажной плоскости
      const lipZ = side === 'rear' ? (railRearZ + EAR_PLATE/2) : (railFrontZ - EAR_PLATE/2);
      scene.add(mkBox(innerW, bodyH, EAR_PLATE, earMat, rackW/2, yCenter, lipZ));
    } else {
      // Корпус между рельсами: крепится к монтажной плоскости и уходит вглубь на dMm
      const zCenter = side === 'rear' ? (railRearZ - RAIL_W/2 - dMm/2) : (railFrontZ + RAIL_W/2 + dMm/2);
      scene.add(mkBox(innerW, bodyH, dMm, devMat, rackW/2, yCenter, zCenter));
    }

    // «Уши» 19": плоские пластины СНАРУЖИ рельсов на монтажной плоскости.
    const earZFront = railFrontZ - RAIL_W/2 - EAR_PLATE/2;
    const earZRear  = railRearZ + RAIL_W/2 + EAR_PLATE/2;
    const earZ = side === 'rear' ? earZRear : earZFront;
    const earLeftCX  = EAR_WIDTH / 2;               // центр от x=0 до x=EAR_WIDTH
    const earRightCX = rackW - EAR_WIDTH / 2;
    scene.add(mkBox(EAR_WIDTH - 2, bodyH, EAR_PLATE, earMat, earLeftCX,  yCenter, earZ));
    scene.add(mkBox(EAR_WIDTH - 2, bodyH, EAR_PLATE, earMat, earRightCX, yCenter, earZ));

    // --- Фасад (pattern по type.kind) ---
    const drawFacade = (faceSide) => {
      if (isShelf) return;
      const faceZ = faceSide === 'rear'
        ? railRearZ + RAIL_W/2 + EAR_PLATE + 0.2
        : railFrontZ - RAIL_W/2 - EAR_PLATE - 0.2;
      const kind = type.kind || '';
      const padY = Math.max(2, bodyH * 0.12);
      const usableH = bodyH - 2 * padY;
      const usableW = innerW - 24;
      if (kind === 'switch') {
        // ряды портов — тёмные квадратики 8x8 вдоль полосы
        const rows = Math.max(1, Math.floor(usableH / 10));
        const cols = Math.max(8, Math.min(24, Math.floor(usableW / 12)));
        const panelW = cols * 12 + 8;
        scene.add(mkBox(panelW, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          for (let c = 0; c < cols; c++) {
            const px = rackW/2 - panelW/2 + 8 + c*12;
            const py = yCenter - usableH/2 + 4 + rIdx*10;
            const portGeo = new THREE.BoxGeometry(9, 7, 0.4);
            scene.add(mkMesh(portGeo, ledGreen, px, py, faceZ));
          }
        }
      } else if (kind === 'patch-panel') {
        // v0.59.365: 2 ряда, если 2U+ или ports>24 (реальные patch-panel
        // на 48 портов имеют двухрядную раскладку).
        const totalPorts = Math.max(1, Math.min(96, +(type.ports) || 24));
        const rowsP = (h >= 2 || totalPorts > 24) ? 2 : 1;
        const colsP = Math.ceil(totalPorts / rowsP);
        const panelW = colsP * 12 + 8;
        scene.add(mkBox(panelW, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        const portH = Math.min(9, (usableH - 4) / rowsP - 2);
        const rowSpan = portH + 2;
        for (let rIdx = 0; rIdx < rowsP; rIdx++) {
          const py = yCenter + (rIdx - (rowsP - 1)/2) * rowSpan;
          const colsThis = (rIdx === rowsP - 1) ? (totalPorts - rIdx*colsP) : colsP;
          for (let c = 0; c < colsThis; c++) {
            const px = rackW/2 - panelW/2 + 8 + c*12;
            const portGeo = new THREE.BoxGeometry(9, portH, 0.4);
            scene.add(mkMesh(portGeo, ledAmber, px, py, faceZ));
          }
        }
      } else if (kind === 'pdu') {
        // ряд розеток
        const cols = Math.min(24, Math.max(6, Math.floor(usableH / 8)));
        for (let c = 0; c < cols; c++) {
          const py = yCenter - usableH/2 + (c+0.5) * (usableH/cols);
          const outlet = new THREE.BoxGeometry(18, 6, 0.4);
          scene.add(mkMesh(outlet, ledBlue, rackW/2, py, faceZ));
        }
      } else if (kind === 'server-1U' || kind === 'server-2U' || kind === 'server') {
        // отсек HDD + LED-индикатор
        const bays = h >= 2 ? 8 : 4;
        const bayW = Math.min(30, (innerW * 0.7) / bays);
        const row = bays * bayW;
        scene.add(mkBox(row + 20, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        for (let b = 0; b < bays; b++) {
          const px = rackW/2 - row/2 + (b + 0.5)*bayW;
          scene.add(mkMesh(new THREE.BoxGeometry(bayW - 2, usableH*0.7, 0.5), ledBlue, px, yCenter, faceZ));
        }
      } else if (kind === 'server-gpu') {
        // AI/GPU сервер: радиатор-рёбра сверху + ряд GPU-модулей + LED-bar
        const panelW = innerW - 20;
        scene.add(mkBox(panelW, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        // рёбра сверху (heatsink band)
        const finBand = Math.min(usableH * 0.2, 30);
        const finY = yCenter + usableH/2 - finBand/2;
        const finCount = Math.max(20, Math.floor(panelW / 6));
        for (let i = 0; i < finCount; i++) {
          const fx = rackW/2 - panelW/2 + (i + 0.5) * (panelW/finCount);
          scene.add(mkMesh(new THREE.BoxGeometry(0.8, finBand, 0.6), facadeMat, fx, finY, faceZ));
        }
        // GPU-модули
        const gpuN = Math.max(4, Math.min(8, type.gpuCount || 8));
        const gw = panelW / gpuN - 4;
        const gBand = usableH * 0.55;
        const gYCenter = yCenter - finBand/2;
        const gpuBodyMat = new THREE.MeshLambertMaterial({ color: 0x0b132b });
        const nvidiaGreenMat = new THREE.MeshBasicMaterial({ color: 0x76b900 });
        for (let i = 0; i < gpuN; i++) {
          const gx = rackW/2 - panelW/2 + (i + 0.5) * (panelW/gpuN);
          scene.add(mkBox(gw, gBand, 1.2, gpuBodyMat, gx, gYCenter, faceZ));
          // зелёная светящаяся полоса NVIDIA
          scene.add(mkMesh(new THREE.BoxGeometry(gw - 3, Math.max(1, gBand*0.08), 0.4), nvidiaGreenMat, gx, gYCenter + gBand/2 - 2, faceZ + 0.6));
        }
        // LED-линейка снизу
        const ledN = Math.min(16, Math.floor(panelW / 14));
        const ledYPos = yCenter - usableH/2 + 3;
        for (let i = 0; i < ledN; i++) {
          const lx = rackW/2 - panelW/2 + (i + 0.5) * (panelW / ledN);
          const m = i < ledN*0.7 ? ledGreen : (i < ledN*0.9 ? ledAmber : new THREE.MeshBasicMaterial({ color: 0xef4444 }));
          scene.add(mkMesh(new THREE.BoxGeometry(2.5, 2.5, 0.5), m, lx, ledYPos, faceZ));
        }
      } else if (kind === 'storage') {
        // JBOD: сетка HDD-отсеков, front-loaded
        const bays = type.bays || 24;
        const panelW = innerW - 10;
        scene.add(mkBox(panelW, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        const cols = Math.ceil(Math.sqrt(bays * (panelW / usableH)));
        const rows = Math.ceil(bays / cols);
        const bw = panelW / cols - 1.2;
        const bh = usableH / rows - 1.2;
        let n = 0;
        const trayMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
        for (let r = 0; r < rows && n < bays; r++) {
          for (let c = 0; c < cols && n < bays; c++, n++) {
            const bx = rackW/2 - panelW/2 + (c + 0.5) * (panelW / cols);
            const by = yCenter + usableH/2 - (r + 0.5) * (usableH / rows);
            scene.add(mkBox(bw, bh, 0.5, trayMat, bx, by, faceZ));
            // LED активности (угловой)
            const ledMat = (n % 7 === 0) ? ledAmber : ledGreen;
            scene.add(mkMesh(new THREE.BoxGeometry(0.9, 0.9, 0.4), ledMat, bx + bw/2 - 0.8, by + bh/2 - 0.8, faceZ + 0.3));
          }
        }
      } else if (kind === 'firewall') {
        // тёмная панель + «дисплей» + ряд LED
        const panelW = innerW - 20;
        scene.add(mkBox(panelW, usableH, 0.6, facadeMat, rackW/2, yCenter, faceZ - 0.4));
        const dispW = panelW * 0.22, dispH = usableH * 0.45;
        const dispMat = new THREE.MeshBasicMaterial({ color: 0x064e3b });
        scene.add(mkBox(dispW, dispH, 0.4, dispMat, rackW/2 - panelW/2 + dispW/2 + 4, yCenter, faceZ));
        const ledN = Math.min(16, Math.floor(panelW/14));
        for (let i = 0; i < ledN; i++) {
          const lx = rackW/2 - panelW/2 + dispW + 10 + (i + 0.5) * ((panelW - dispW - 14) / ledN);
          const m = i % 3 === 0 ? new THREE.MeshBasicMaterial({ color: 0xef4444 }) : ledGreen;
          scene.add(mkMesh(new THREE.BoxGeometry(2.5, 2.5, 0.5), m, lx, yCenter, faceZ));
        }
      } else {
        // дефолт — тонкая полоса с 2 светодиодами
        scene.add(mkBox(40, 4, 0.6, facadeMat, rackW/2 - 20, yCenter, faceZ));
        scene.add(mkMesh(new THREE.BoxGeometry(3, 3, 0.5), ledGreen, rackW/2 + 30, yCenter, faceZ));
        scene.add(mkMesh(new THREE.BoxGeometry(3, 3, 0.5), ledAmber, rackW/2 + 40, yCenter, faceZ));
      }
    };
    drawFacade(side);
    if (portsRear) drawFacade(side === 'front' ? 'rear' : 'front');

    if (depthConflicts.has(d.id)) {
      const zCenter2 = side === 'rear' ? (railRearZ - RAIL_W/2 - dMm/2) : (railFrontZ + RAIL_W/2 + dMm/2);
      const eg = new THREE.BoxGeometry(innerW + 1, bodyH + 1, dMm + 1);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(eg),
        new THREE.LineBasicMaterial({ color: 0xdc2626 }));
      edges.position.set(rackW/2, yCenter, zCenter2);
      scene.add(edges);
    }
  });

  let raf = 0;
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  // v0.59.262: debounced persist позиции камеры при любых изменениях OrbitControls.
  let saveTO = 0;
  controls.addEventListener('change', () => {
    clearTimeout(saveTO);
    saveTO = setTimeout(() => {
      try {
        localStorage.setItem(camKey, JSON.stringify({
          pos: camera.position.toArray(),
          tgt: controls.target.toArray(),
        }));
      } catch {}
    }, 200);
  });

  // v0.59.276: переименовано в legend (был SyntaxError "Identifier 'hint' has
  // already been declared" — hint уже объявлен в этой же функции выше на ~стр.
  // 1047). Ошибка парсинга ES-модуля глушила ВЕСЬ scs-config.js: пустой
  // композер, нет каталога, нет стоек. Fix: legend вместо второго hint.
  const legend = document.createElement('div');
  legend.className = 'sc-3d-hint';
  legend.innerHTML = `
    <div>🧊 <b>3D</b> · ЛКМ — вращать · колесо — zoom · ПКМ — pan</div>
    <div class="muted">Шкаф ${r.u}U · ${rackW}×${rackD} мм${depthConflicts.size ? ' · <span style="color:#fca5a5">⚠ коллизии глубины</span>' : ''}</div>
    <div class="sc-3d-toggles">
      <label><input type="checkbox" data-tog="walls" checked> стенки</label>
      <label><input type="checkbox" data-tog="doorFront" checked> дверь фронт</label>
      <label><input type="checkbox" data-tog="doorRear" checked> дверь тыл</label>
    </div>
  `;
  host.appendChild(legend);
  legend.querySelectorAll('[data-tog]').forEach(cb => {
    cb.addEventListener('change', () => {
      const k = cb.dataset.tog;
      const obj = k === 'walls' ? walls : (k === 'doorFront' ? doorFront : doorRear);
      obj.visible = cb.checked;
    });
  });

  host._3dCleanup = () => {
    cancelAnimationFrame(raf);
    clearTimeout(saveTO);
    try { controls.dispose(); } catch {}
    try { renderer.dispose(); } catch {}
    try { renderer.forceContextLoss?.(); } catch {}
    try { renderer.domElement?.remove(); } catch {}
  };
}

/* ---- render: предупреждения ------------------------------------------- */
function renderWarnings() {
  const host = $('sc-warn');
  const r = currentRack();
  if (!r) { host.innerHTML = '<div class="sc-warn-item warn">Нет выбранной стойки.</div>'; return; }
  const devices = currentContents();
  const conflicts = detectConflicts(r, devices);
  const depthConflicts = detectDepthConflicts(r, devices);
  const uConflicts = new Set([...conflicts].filter(id => !depthConflicts.has(id)));
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
  // v0.59.274: если текущая стойка пришла по URL, но у неё нет TIA-тега в этом проекте —
  // предупреждаем пользователя и предлагаем присвоить тег (иначе она «невидима» и в BOM).
  const curTag = ((state.rackTags && state.rackTags[r.id]) || '').trim();
  if (!curTag) {
    items.push(`<div class="sc-warn-item warn">⚠ Стойка <b>${escape(r.name || r.id)}</b> (<code>${escape(r.id)}</code>) не имеет TIA-942 тега в этом проекте. Присвойте тег в поле выше (например <code>DC1.H3.R05</code>), иначе она считается «глобальным шаблоном корпуса» и скрывается из сайдбара/BOM модуля СКС.</div>`);
  }
  if (uConflicts.size) items.push(`<div class="sc-warn-item err">U-конфликты размещения: ${uConflicts.size} ед. перекрываются по юнитам или выходят за границы стойки.</div>`);
  if (depthConflicts.size) items.push(`<div class="sc-warn-item err">⚠ Конфликты глубины: ${depthConflicts.size} ед. не помещаются при двустороннем монтаже (front+rear пересекаются по юнитам, а суммарная глубина + 50 мм зазор > ${(+r.depth)||'?'} мм). Откройте 📐 Бок — видно пересечение.</div>`);
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
    // v0.59.269: инфо-строка с балансом по вводам (даже если перегруза нет)
    const feedList = [];
    const allFeeds = new Set([...byFeed.keys(), ...pduByFeed.keys()]);
    Array.from(allFeeds).sort().forEach(feed => {
      const load = byFeed.get(feed) || 0;
      const cap = pduByFeed.get(feed) || 0;
      const pct = cap > 0 ? Math.round((load / cap) * 100) : null;
      const color = pct == null ? '#64748b' : pct > 100 ? '#b91c1c' : pct > 80 ? '#c2410c' : pct > 50 ? '#047857' : '#2563eb';
      feedList.push(`<span style="color:${color}"><b>${escape(feed)}</b> ${(load/1000).toFixed(2)}${cap ? `/${(cap/1000).toFixed(2)}` : ''} кВт${pct != null ? ` · ${pct}%` : ''}</span>`);
    });
    if (feedList.length) {
      items.push(`<div class="sc-warn-item info" title="Баланс нагрузки по вводам PDU. В идеале A и B (и C/D) должны быть близки по % для резервирования 2N.">📊 По вводам: ${feedList.join(' · ')}</div>`);
    }
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
  // v0.59.259: физическая влезаемость 0U-PDU по сторонам (A,C — левая; B,D — правая)
  if (Array.isArray(r.pdus) && r.pdus.length) {
    const L = r.pdus.filter(p => ['A','C'].includes((p.feed || '').toUpperCase())).length;
    const R = r.pdus.filter(p => ['B','D'].includes((p.feed || '').toUpperCase())).length;
    if (L > 2) items.push(`<div class="sc-warn-item err">На левую сторону стойки (вводы A/C) назначено ${L} вертикальных PDU — физически умещается не более 2.</div>`);
    if (R > 2) items.push(`<div class="sc-warn-item err">На правую сторону стойки (вводы B/D) назначено ${R} вертикальных PDU — физически умещается не более 2.</div>`);
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

/* v0.59.302: какие порты устройства уже заняты существующими патч-кордами.
   Эндпойнты в матрице имеют свободный формат; распознаём «Label/pN» и «Label/N». */
function portsUsedForDev(dev) {
  const used = new Set();
  if (!dev) return used;
  const links = currentMatrix();
  const label = String(dev.label || '').trim().toLowerCase();
  if (!label) return used;
  const check = ep => {
    const s = String(ep || '').trim().toLowerCase();
    if (!s.startsWith(label)) return;
    const rest = s.slice(label.length);
    const m = rest.match(/^[\s\/\-:]*p?(\d+)/);
    if (m) used.add(+m[1]);
  };
  links.forEach(l => { check(l.a); check(l.b); });
  return used;
}

/* v0.59.302: клик по порту → выбор + клик по другому порту → патч-корд */
function onPortClick(devId, port) {
  const devices = currentContents();
  const dev = devices.find(d => d.id === devId);
  if (!dev) return;
  const sel = state._portSel;
  // повторный клик по тому же порту — отмена
  if (sel && sel.devId === devId && sel.port === port) {
    state._portSel = null;
    renderUnitMap();
    return;
  }
  // первый выбор
  if (!sel) {
    state._portSel = { devId, port };
    renderUnitMap();
    return;
  }
  // второй клик — разные устройства (внутри одного шкафа — это и есть патч-корд)
  if (sel.devId === devId) {
    // тот же девайс, другой порт — пока не поддерживаем loopback
    state._portSel = { devId, port };
    renderUnitMap();
    return;
  }
  const aDev = devices.find(d => d.id === sel.devId);
  if (!aDev) { state._portSel = null; renderUnitMap(); return; }
  // сформировать эндпойнты в формате «Label/pN»
  const a = `${aDev.label}/p${sel.port}`;
  const b = `${dev.label}/p${port}`;
  const links = currentMatrix();
  // угадать тип кабеля: если хоть одно — patch-panel → cat.6a, если оптика по type.portType — om4
  const aType = state.catalog.find(c => c.id === aDev.typeId);
  const bType = state.catalog.find(c => c.id === dev.typeId);
  const optical = s => /^(lc|sc|fc|st|mpo|sfp)/i.test(String(s || ''));
  const isOptic = optical(aType && aType.portType) || optical(bType && bType.portType);
  const cable = isOptic ? 'om4' : 'cat.6a';
  links.push({ id: uid('lnk'), a, b, cable, lengthM: 2, color: '' });
  saveMatrix();
  state._portSel = null;
  renderUnitMap();
  renderMatrix();
  renderBom();
}

/* ---- render: карта юнитов (SVG фронт-вью) ----------------------------- */
function renderUnitMap(hostId, opts) {
  hostId = hostId || 'sc-unitmap';
  opts = opts || {};
  const host = $(hostId);
  if (!host) return;
  // v0.59.340: сохранить scrollLeft/Top уже отрисованного scroll-обёрток
  // (sc-zoomwrap-main или sc-zoomwrap), чтобы клик по порту не сбрасывал
  // положение вьюпорта.
  const _prevWrap = host.querySelector('.sc-zoomwrap');
  const _prevScroll = _prevWrap ? { l: _prevWrap.scrollLeft, t: _prevWrap.scrollTop } : null;
  const r = currentRack();
  if (!r) { host.innerHTML = '<div class="muted">Нет выбранной стойки.</div>'; return; }
  // v0.59.245: side-view — делегируется renderSideView. Front/Rear — обычный
  // unit map, но с фильтром по mountSide. 3D — renderRack3D (lazy three.js).
  if (state.faceMode === 'side') { renderSideView(hostId, opts); return; }
  if (state.faceMode === '3d')   { renderRack3D(hostId, opts); return; }
  // при уходе с 3D — освободить GL-контекст
  const prevHost = $(hostId);
  if (prevHost && prevHost._3dCleanup) { try { prevHost._3dCleanup(); } catch {} prevHost._3dCleanup = null; }
  const devices = currentContents();
  const conflicts = detectConflicts(r, devices);
  // В модалке делаем юнит крупнее для удобства
  const scale = opts.big ? 2 : 1;
  const rowH = 16 * scale, bodyW = 220 * scale;
  // v0.59.254: свежая раскладка. Слева: U-номера (x=4..18), потом колонка
  // вертикальных PDU (для r.pdus). Далее корпус стойки (x=32..32+bodyW).
  // Справа от стойки — подписи устройств (labelW), в модалке — ещё wires.
  // v0.59.258: PDU теперь разводятся по сторонам по вводу:
  //   A,C → левая стойка, B,D → правая. Снаружи U-номеров.
  //   Раскладка слева-направо:
  //   [PDU-LEFT | U# LEFT | RACK | U# RIGHT | PDU-RIGHT | LABEL_GAP | LABELS]
  const PDU_STRIP = 6 * scale;   // ширина одной полосы PDU
  const allPdus = (r.pdus || []);
  // распределение по сторонам
  const leftFeeds = new Set(['A', 'C']);
  const rightFeeds = new Set(['B', 'D']);
  const pduLeft = [];
  const pduRight = [];
  allPdus.forEach((p, i) => {
    const f = (p.feed || '').toUpperCase();
    if (leftFeeds.has(f)) pduLeft.push(p);
    else if (rightFeeds.has(f)) pduRight.push(p);
    else { (i % 2 === 0 ? pduLeft : pduRight).push(p); }
  });
  // ограничиваем до 2 строк на сторону (физически больше не уместить)
  const pduLeftShown = pduLeft.slice(0, 2);
  const pduRightShown = pduRight.slice(0, 2);
  const PDU_PAD = 2;
  const PDU_ZONE_LEFT_W  = pduLeftShown.length  ? pduLeftShown.length  * (PDU_STRIP + 1) + PDU_PAD : 0;
  const PDU_ZONE_RIGHT_W = pduRightShown.length ? pduRightShown.length * (PDU_STRIP + 1) + PDU_PAD : 0;
  const UNUM_COL_W = 14 * scale;
  const PDU_LEFT_X  = 2;
  const UNUM_LEFT_X = PDU_LEFT_X + PDU_ZONE_LEFT_W + 2; // правый край — UNUM_LEFT_X + UNUM_COL_W (anchor=end)
  const UNUM_X = UNUM_LEFT_X + UNUM_COL_W;
  const RACK_X = UNUM_X + 4;
  const UNUM_RIGHT_X = RACK_X + bodyW + 4;             // левый край (anchor=start)
  const PDU_RIGHT_X  = UNUM_RIGHT_X + UNUM_COL_W + 2;
  const LABEL_GAP = 6;
  const LABEL_W = 200 * scale;
  const svgH = r.u * rowH + 8;
  const svgW = PDU_RIGHT_X + PDU_ZONE_RIGHT_W + LABEL_GAP + LABEL_W;
  const mode = state.viewMode;
  // slot → device; индексы U=1..r.u (1 — снизу, r.u — сверху)
  const slot = new Array(r.u + 1).fill(null);
  for (let u = r.u; u > r.u - r.occupied; u--) slot[u] = { kind: 'rack-occ' };
  // v0.59.245: в front-виде показываем устройства со mountSide='front' (+legacy
  // без поля = front). В rear-виде — только 'rear'. U-номера показываются
  // «как видит наблюдатель»: в тыле часто нумеруют зеркально, но большинство
  // DC-систем (TIA-606) сохраняют единую U-нумерацию независимо от стороны,
  // поэтому рисуем одинаково. Разная только выборка devices и цвет рамки.
  const isBoth = state.faceMode === 'both';
  const face = state.faceMode === 'rear' ? 'rear' : 'front';
  const visibleDevices = isBoth ? devices.slice() : devices.filter(d => (d.mountSide || 'front') === face);
  // в режиме «обе стороны» slot-массив не используем (front и rear могут
  // занимать один и тот же U законно — разная сторона).
  if (!isBoth) visibleDevices.forEach(d => {
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
  // v0.59.258: направление нумерации. 'bu' (классика) — 1 снизу, r.u сверху.
  // 'td' — 1 сверху, r.u снизу. Физические позиции (positionU) не меняются —
  // меняется только подпись строки.
  const uNumDir = state.uNumDir || 'bu';
  const rects = [];
  for (let i = 0; i < r.u; i++) {
    const u = r.u - i;                     // логический U слота (bu: 1 снизу)
    const label = uNumDir === 'td' ? (r.u - u + 1) : u;
    const y = 4 + i * rowH;
    const s = slot[u];
    if (!s || s.kind === 'rack-occ') {
      const fill = s && s.kind === 'rack-occ' ? '#cbd5e1' : '#f1f5f9';
      const stroke = s && s.kind === 'rack-occ' ? '#64748b' : '#cbd5e1';
      rects.push(`<rect x="${RACK_X}" y="${y}" width="${bodyW}" height="${rowH - 1}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
    }
    // U-номер слева
    rects.push(`<text x="${UNUM_X}" y="${y + rowH/2 + 4}" font-size="${9*scale}" fill="#64748b" text-anchor="end">${label}</text>`);
    // U-номер справа (симметрично)
    rects.push(`<text x="${UNUM_RIGHT_X}" y="${y + rowH/2 + 4}" font-size="${9*scale}" fill="#64748b" text-anchor="start">${label}</text>`);
  }

  // v0.59.254: вертикальные PDU слева от стойки — одна полоса на ввод.
  // Рисуется на всю высоту стойки; количество розеток ≈ ceil(r.u * 1.5) — просто
  // для визуализации. Занятые розетки помечаются зелёным, по pduOutlet.
  const pduStrips = [];
  const outletsByFeed = new Map();
  devices.forEach(d => {
    const f = d.pduFeed || '';
    if (!f || !d.pduOutlet) return;
    const m = String(d.pduOutlet).match(/(\d+)/);
    if (!m) return;
    if (!outletsByFeed.has(f)) outletsByFeed.set(f, new Set());
    outletsByFeed.get(f).add(+m[1]);
  });
  // проверка физической влезаемости вертикальных (0U) PDU: на одну сторону
  // умещается не более 2 полос одинаковой длины = высоте стойки. Если больше —
  // рисуем красную шапку и warn-крест.
  const pduFitBad = { left: pduLeft.length > 2, right: pduRight.length > 2 };
  const drawPduStrip = (p, sx) => {
    const strips = 4 + Math.ceil(r.u * (p.phases === 3 ? 0.7 : 1.2));
    const color = feedColor(p.feed);
    pduStrips.push(`<rect x="${sx}" y="4" width="${PDU_STRIP}" height="${r.u * rowH}" fill="#1f2937" stroke="${color}" stroke-width="1"/>`);
    const stepY = (r.u * rowH - 4) / strips;
    const used = outletsByFeed.get(p.feed) || new Set();
    for (let j = 0; j < strips; j++) {
      const oy = 4 + 2 + j * stepY + stepY / 2;
      const on = used.has(j + 1);
      pduStrips.push(`<circle cx="${sx + PDU_STRIP/2}" cy="${oy}" r="${Math.max(1, PDU_STRIP*0.28)}" fill="${on ? color : '#334155'}" stroke="${on ? '#fff' : '#111827'}" stroke-width="0.3"/>`);
    }
    pduStrips.push(`<text x="${sx + PDU_STRIP/2}" y="${2}" font-size="${7*scale}" fill="${color}" text-anchor="middle" dominant-baseline="hanging">${escape(p.feed || '?')}</text>`);
  };
  pduLeftShown.forEach((p, i) => {
    const sx = PDU_LEFT_X + i * (PDU_STRIP + 1);
    drawPduStrip(p, sx);
  });
  pduRightShown.forEach((p, i) => {
    const sx = PDU_RIGHT_X + i * (PDU_STRIP + 1);
    drawPduStrip(p, sx);
  });
  if (pduFitBad.left) {
    pduStrips.push(`<g><rect x="${PDU_LEFT_X - 1}" y="4" width="${PDU_ZONE_LEFT_W}" height="3" fill="#dc2626"><title>⚠ На левую сторону стойки назначено ${pduLeft.length} PDU (помещается 2). Физически не влезают.</title></rect></g>`);
  }
  if (pduFitBad.right) {
    pduStrips.push(`<g><rect x="${PDU_RIGHT_X - 1}" y="4" width="${PDU_ZONE_RIGHT_W}" height="3" fill="#dc2626"><title>⚠ На правую сторону стойки назначено ${pduRight.length} PDU (помещается 2). Физически не влезают.</title></rect></g>`);
  }
  // затем устройства — ОДНОЙ группой на устройство (для drag-n-drop; 1.24.3 full).
  // v0.59.253: режим 'both' — шкаф делим пополам. Левая половина = фронт,
  // правая = тыл. Рамка спереди — синяя, сзади — красная штриховая.
  const halfW = bodyW / 2;
  const deviceGroups = visibleDevices.map(d => {
    const type = state.catalog.find(c => c.id === d.typeId);
    if (!type) return '';
    const h = type.heightU;
    const topIdx = r.u - d.positionU; // row index (0=сверху)
    const y = 4 + topIdx * rowH;
    const conflict = conflicts.has(d.id);
    const devSide = d.mountSide || 'front';
    const fill = mode === 'power' ? feedColor(d.pduFeed) : (type.color || '#94a3b8');
    const sideStroke = isBoth ? (devSide === 'rear' ? '#dc2626' : '#2563eb') : '#64748b';
    const stroke = conflict ? '#dc2626' : sideStroke;
    const dashAttr = (isBoth && devSide === 'rear') ? ' stroke-dasharray="4 2"' : '';
    const tag = deviceTag(d);
    const tagSfx = tag ? ' · ' + tag : '';
    const sideBadge = isBoth ? (devSide === 'rear' ? '🟥 ' : '🟦 ') : '';
    const labelTxt = mode === 'power'
      ? `${sideBadge}${d.label}${d.pduFeed ? ' · ввод '+d.pduFeed : ' · ⚠ без PDU'}${type.powerW ? ' · '+type.powerW+' Вт' : ''}${tagSfx}`
      : `${sideBadge}${d.label}${d.pduFeed ? ' · '+d.pduFeed : ''}${tagSfx}`;
    // v0.59.253: «уши» 19" теперь узкие прямоугольники ВНУТРИ корпуса слева/
    // справа (а не снаружи), как на реальных rack-mount устройствах с
    // винтами через фланцы. Толщина масштабируется по scale.
    const earW = Math.max(3, 3 * scale);
    const earY = y;
    const earH = h * rowH - 1;
    const earFill = '#0f172a';
    const isShelf = type.kind === 'shelf';
    const portsRear = !!type.portsRear;
    // v0.59.365: в режиме «обе стороны» корпус НЕ сжимается до halfW — устройство
    // рисуется на полную ширину, но клипуется по соответствующей половине.
    // Левая половина = front, правая = rear. Пользователю важно видеть фронт/тыл
    // в реальных пропорциях (фасад, порты, надписи), без зажатия в 50%.
    const bodyX = RACK_X;
    const bodyWidth = bodyW;
    // уши — тонкие вертикальные полосы у самого края корпуса, изнутри
    const leftEarX = bodyX;
    const rightEarX = bodyX + bodyWidth - earW;
    // фасад — небольшой паттерн внутри корпуса по type.kind (лампы/порты)
    const facadeX = bodyX + earW + 2;
    const facadeW = Math.max(0, bodyWidth - 2*earW - 4);
    const facadeY = y + 2;
    const facadeH = h * rowH - 5;
    const facadeHtml = isShelf
      ? `<pattern id="shelf-hatch-${d.id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#475569" stroke-width="1"/></pattern>`
        + `<rect x="${bodyX}" y="${y}" width="${bodyWidth}" height="${h*rowH-1}" fill="url(#shelf-hatch-${d.id})" opacity="0.6"/>`
      : (() => {
          const kind = type.kind || '';
          if (kind === 'switch' || kind === 'patch-panel') {
            // v0.59.302: порты кликабельные — можно создавать патч-корды кликами.
            // Реальное число портов — из type.ports; рисуем ровно столько, сколько
            // задекларировано (ограничение 48 — визуально всё равно не влезет).
            const portCount = Math.max(1, Math.min(96, +(type.ports) || 24));
            // v0.59.365: если устройство 2U+ или портов много — раскладываем
            // в 2 ряда (так выглядят реальные patch-panel/switch с 48 портами).
            const rows = (h >= 2 || portCount > 24) ? 2 : 1;
            const perRow = Math.ceil(portCount / rows);
            const pw = Math.max(1.5, facadeW / perRow - 1);
            const ph = Math.max(2, (rows === 2 ? facadeH*0.32 : facadeH*0.35));
            const rowGap = rows === 2 ? Math.max(1, facadeH*0.08) : 0;
            const totalRowsH = rows*ph + (rows-1)*rowGap;
            const rowsY0 = facadeY + (facadeH - totalRowsH)/2;
            const pc = kind === 'patch-panel' ? '#f59e0b' : '#22c55e';
            const usedSet = portsUsedForDev(d);
            const sel = state._portSel;
            const parts = [];
            for (let i = 0; i < portCount; i++) {
              const r = Math.floor(i / perRow);
              const c = i % perRow;
              const px = facadeX + c * (pw + 1) + 0.5;
              const py = rowsY0 + r * (ph + rowGap);
              const pIdx = i + 1;
              const isUsed = usedSet.has(pIdx);
              const isSel  = sel && sel.devId === d.id && sel.port === pIdx;
              const pFill  = isSel ? '#6366f1' : (isUsed ? '#ef4444' : pc);
              const stroke = isSel ? '#1e1b4b' : (isUsed ? '#7f1d1d' : '#0b4d2a');
              parts.push(`<rect class="sc-port${isSel?' sel':''}${isUsed?' used':''}" data-devid="${d.id}" data-port="${pIdx}" x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${pFill}" stroke="${stroke}" stroke-width="0.4" opacity="0.95" style="cursor:pointer"><title>${escape(d.label)} · порт ${pIdx}${isUsed?' · занят':''}</title></rect>`);
            }
            return parts.join('');
          } else if (kind === 'pdu') {
            // ряд «розеток» — синие круги
            const n = Math.min(16, Math.max(4, Math.floor(facadeW / 7)));
            const parts = [];
            for (let i = 0; i < n; i++) {
              const cx = facadeX + (i + 0.5) * (facadeW / n);
              parts.push(`<circle cx="${cx}" cy="${facadeY + facadeH/2}" r="${Math.max(1.5, facadeH*0.22)}" fill="#3b82f6" opacity="0.85"/>`);
            }
            return parts.join('');
          } else if (kind === 'server-1U' || kind === 'server-2U' || kind === 'server') {
            const bays = (h >= 2) ? Math.max(8, Math.min(12, Math.round(facadeW/16))) : Math.max(4, Math.min(10, Math.round(facadeW/20)));
            const bw = facadeW / bays - 2;
            const parts = [];
            for (let i = 0; i < bays; i++) {
              const bx = facadeX + i * (bw + 2) + 1;
              parts.push(`<rect x="${bx}" y="${facadeY + facadeH*0.15}" width="${bw}" height="${facadeH*0.7}" fill="#1e293b" stroke="#334155" stroke-width="0.3"/>`);
              parts.push(`<circle cx="${bx + bw/2}" cy="${facadeY + facadeH*0.82}" r="0.7" fill="#22c55e" opacity="0.7"/>`);
            }
            parts.push(`<circle cx="${facadeX + facadeW - 3}" cy="${facadeY + 3}" r="1.5" fill="#22c55e"/>`);
            parts.push(`<circle cx="${facadeX + facadeW - 8}" cy="${facadeY + 3}" r="1.2" fill="#3b82f6"/>`);
            return parts.join('');
          } else if (kind === 'server-gpu') {
            // AI/GPU сервер: верх — радиатор (рёбра), низ — GPU-модули с LED-линейкой.
            const parts = [];
            const finsY = facadeY + 1;
            const finsH = Math.max(3, facadeH*0.18);
            const nFins = Math.max(20, Math.floor(facadeW / 3));
            for (let i = 0; i < nFins; i++) {
              const fx = facadeX + i * (facadeW / nFins);
              parts.push(`<line x1="${fx}" y1="${finsY}" x2="${fx}" y2="${finsY + finsH}" stroke="#334155" stroke-width="0.5"/>`);
            }
            const gpuN = Math.max(4, Math.min(8, type.gpuCount || 8));
            const gBandY = facadeY + facadeH*0.25;
            const gBandH = facadeH*0.55;
            const gw = facadeW / gpuN - 2;
            for (let i = 0; i < gpuN; i++) {
              const gx = facadeX + i * (gw + 2) + 1;
              parts.push(`<rect x="${gx}" y="${gBandY}" width="${gw}" height="${gBandH}" fill="#0b132b" stroke="#76b900" stroke-width="0.5"/>`);
              // NVIDIA-green accent
              parts.push(`<rect x="${gx + 1}" y="${gBandY + 1}" width="${gw - 2}" height="${Math.max(1, gBandH*0.12)}" fill="#76b900" opacity="0.85"/>`);
              parts.push(`<text x="${gx + gw/2}" y="${gBandY + gBandH/2 + 2}" font-size="${Math.max(2, 4*scale)}" fill="#94a3b8" text-anchor="middle">GPU${i+1}</text>`);
            }
            // LED-bar снизу (активность/мощность)
            const ledY = facadeY + facadeH - 2.5;
            const ledN = Math.min(16, Math.floor(facadeW / 4));
            for (let i = 0; i < ledN; i++) {
              const lx = facadeX + (i + 0.5) * (facadeW / ledN);
              const col = i < ledN*0.7 ? '#22c55e' : (i < ledN*0.9 ? '#f59e0b' : '#ef4444');
              parts.push(`<circle cx="${lx}" cy="${ledY}" r="0.8" fill="${col}"/>`);
            }
            return parts.join('');
          } else if (kind === 'storage') {
            // JBOD: сетка HDD-отсеков
            const bays = type.bays || 24;
            const cols = Math.ceil(Math.sqrt(bays * (facadeW/facadeH)));
            const rows = Math.ceil(bays / cols);
            const bw = facadeW / cols - 1;
            const bh = facadeH / rows - 1;
            const parts = [];
            let n = 0;
            for (let r = 0; r < rows && n < bays; r++) {
              for (let c = 0; c < cols && n < bays; c++, n++) {
                const bx = facadeX + c * (bw + 1);
                const by = facadeY + r * (bh + 1);
                parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#0f172a" stroke="#475569" stroke-width="0.3"/>`);
                parts.push(`<rect x="${bx+0.8}" y="${by + bh*0.35}" width="${bw*0.5}" height="${bh*0.2}" fill="#1e293b"/>`);
                parts.push(`<circle cx="${bx + bw - 1.3}" cy="${by + 1.3}" r="0.5" fill="${(n%7===0)?'#f59e0b':'#22c55e'}"/>`);
              }
            }
            return parts.join('');
          } else if (kind === 'firewall') {
            // тёмная панель + ряд LED + ЖК-полоса
            const parts = [];
            parts.push(`<rect x="${facadeX}" y="${facadeY + facadeH*0.25}" width="${facadeW*0.25}" height="${facadeH*0.35}" fill="#1e293b" stroke="#475569" stroke-width="0.3"/>`);
            parts.push(`<text x="${facadeX + facadeW*0.125}" y="${facadeY + facadeH*0.5}" font-size="${Math.max(2, 4*scale)}" fill="#22c55e" text-anchor="middle" font-family="monospace">OK</text>`);
            const ledN = Math.min(16, Math.floor(facadeW/8));
            for (let i = 0; i < ledN; i++) {
              const lx = facadeX + facadeW*0.3 + (i + 0.5) * (facadeW*0.65 / ledN);
              parts.push(`<circle cx="${lx}" cy="${facadeY + facadeH*0.45}" r="1.2" fill="${i%3===0?'#ef4444':'#22c55e'}" opacity="0.85"/>`);
            }
            return parts.join('');
          } else if (kind === 'router') {
            // модули (SFP-cages) + LED
            const mods = Math.max(4, Math.min(12, Math.floor(facadeW/14)));
            const mw = facadeW / mods - 2;
            const parts = [];
            for (let i = 0; i < mods; i++) {
              const mx = facadeX + i * (mw + 2) + 1;
              parts.push(`<rect x="${mx}" y="${facadeY + facadeH*0.3}" width="${mw}" height="${facadeH*0.4}" fill="#334155" stroke="#475569" stroke-width="0.3"/>`);
              parts.push(`<circle cx="${mx + mw/2}" cy="${facadeY + facadeH*0.78}" r="0.7" fill="#3b82f6"/>`);
            }
            return parts.join('');
          }
          // default — 2 LED
          return `<circle cx="${facadeX + 3}" cy="${facadeY + facadeH/2}" r="1.5" fill="#22c55e"/>`
               + `<circle cx="${facadeX + 9}" cy="${facadeY + facadeH/2}" r="1.5" fill="#f59e0b"/>`;
        })();
    // если у типа порты есть и на тыле — маркер звёздочки
    const rearMark = (portsRear && !isBoth) ? `<text x="${bodyX + bodyWidth - 14}" y="${y + rowH/2 + 4}" font-size="${9*scale}" fill="#dc2626" title="порты и с тыла">⇄</text>` : '';
    // v0.59.258: подпись — справа от правой зоны PDU, чтобы ни PDU, ни U-номера
    // не перекрывались текстом.
    const labelX = PDU_RIGHT_X + PDU_ZONE_RIGHT_W + LABEL_GAP;
    const labelY = y + rowH/2 + 4;
    // v0.59.365: в режиме «обе стороны» инлайн-clip-path даёт корпусу+фасаду
    // показать только левую половину (front) или только правую (rear). Сама
    // подпись/линия-«leader» НЕ клипуются — они рисуются справа от стойки.
    const halfClipFront = `<clipPath id="sc-half-front-${d.id}"><rect x="${RACK_X}" y="${y - 1}" width="${halfW}" height="${h*rowH + 2}"/></clipPath>`;
    const halfClipRear  = `<clipPath id="sc-half-rear-${d.id}"><rect x="${RACK_X + halfW}" y="${y - 1}" width="${halfW}" height="${h*rowH + 2}"/></clipPath>`;
    const clipDef = isBoth ? (devSide === 'rear' ? halfClipRear : halfClipFront) : '';
    const clipAttr = isBoth ? ` clip-path="url(#sc-half-${devSide === 'rear' ? 'rear' : 'front'}-${d.id})"` : '';
    return `<g class="sc-devband" data-devid="${d.id}" data-h="${h}" data-side="${devSide}" style="cursor:grab">
      ${clipDef}
      <g${clipAttr}>
        <rect x="${bodyX}" y="${y}" width="${bodyWidth}" height="${h * rowH - 1}" fill="${fill}" stroke="${stroke}"${dashAttr} stroke-width="${conflict ? 1.5 : (isBoth ? 1 : 0.5)}"/>
        ${isShelf ? '' : `<rect x="${leftEarX}" y="${earY}" width="${earW}" height="${earH}" fill="${earFill}"/>`}
        ${isShelf ? '' : `<rect x="${rightEarX}" y="${earY}" width="${earW}" height="${earH}" fill="${earFill}"/>`}
        ${facadeHtml}
        ${rearMark}
      </g>
      <line x1="${bodyX + bodyWidth}" y1="${labelY - 2}" x2="${labelX - 2}" y2="${labelY - 2}" stroke="${type.color || '#94a3b8'}" stroke-width="1" opacity="0.7"/>
      <text x="${labelX}" y="${labelY}" font-size="${(isBoth ? 10 : 11)*scale}" fill="#0f172a">${escape(labelTxt)}</text>
    </g>`;
  }).join('');
  // в режиме «обе стороны» — центральная разделительная линия между front и rear
  const splitter = isBoth
    ? `<line x1="${RACK_X + halfW}" y1="4" x2="${RACK_X + halfW}" y2="${4 + r.u * rowH}" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2 2"/>`
      + `<text x="${RACK_X + halfW/2}" y="${rowH - 4}" font-size="${8*scale}" fill="#2563eb" text-anchor="middle">🟦 фронт</text>`
      + `<text x="${RACK_X + halfW + halfW/2}" y="${rowH - 4}" font-size="${8*scale}" fill="#dc2626" text-anchor="middle">🟥 тыл</text>`
    : '';

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
    const rightX = PDU_RIGHT_X + PDU_ZONE_RIGHT_W + LABEL_GAP + LABEL_W; // wires стартуют за подписями
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
  // v0.59.340: zoom/pan теперь работает и на основной (не-modal) карте.
  // Раньше z=1 фиксировался для !big — поэтому Ctrl+wheel ничего не делал
  // и при port-click не было состояния масштаба, которое можно было бы
  // сохранить. Теперь state.mapZoom персистится между renderUnitMap.
  const zoomStateKey = opts.big ? 'dlgZoom' : 'mapZoom';
  const z = state[zoomStateKey] || 1;
  const svgEl = `<svg id="${svgId}" class="sc-unitmap-svg" width="${totalW * z}" height="${svgH * z}" viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg" data-rowh="${rowH}" data-zoom="${z}" data-bodyw="${bodyW}" data-bodyx="${RACK_X}" data-face="${state.faceMode}">
    ${rects.join('')}
    ${pduStrips.join('')}
    ${splitter}
    ${deviceGroups}
    ${wires}
  </svg>`;
  const legendEl = `<div class="sc-unitmap-legend">${legend.join('') || '<span class="muted">— пусто —</span>'}</div>`;
  if (opts.big) {
    host.innerHTML = `<div class="sc-zoomwrap" id="sc-zoomwrap">${svgEl}</div>${legendEl}`;
    bindZoomPan($('sc-zoomwrap'), svgId, totalW, svgH, 'dlgZoom');
  } else {
    // v0.59.340: оборачиваем в scroll-контейнер с фиксированной max-height,
    // чтобы Ctrl+wheel мог зумить, а pan сдвигал scrollLeft/Top.
    host.innerHTML = `<div class="sc-zoomwrap sc-zoomwrap-main" id="sc-zoomwrap-main" style="overflow:auto;max-height:70vh;border:1px solid #e2e8f0;border-radius:4px">${svgEl}</div>${legendEl}`;
    bindZoomPan($('sc-zoomwrap-main'), svgId, totalW, svgH, 'mapZoom');
  }
  bindUnitMapDrag(svgId);
  // v0.59.340: восстановить положение прокрутки
  if (_prevScroll) {
    const newWrap = host.querySelector('.sc-zoomwrap');
    if (newWrap) { newWrap.scrollLeft = _prevScroll.l; newWrap.scrollTop = _prevScroll.t; }
  }
  // v0.59.302: клики по портам → создание патч-кордов
  const svgNode = $(svgId);
  if (svgNode) {
    svgNode.addEventListener('click', ev => {
      const p = ev.target.closest('.sc-port');
      if (!p) return;
      ev.stopPropagation();
      const devId = p.getAttribute('data-devid');
      const port = +p.getAttribute('data-port');
      if (devId && port) onPortClick(devId, port);
    });
  }
}

/* 1.24.33 — zoom/pan в модалке. Wheel — zoom at cursor; drag по пустому
   месту (не по полосе устройства) — pan через scrollLeft/scrollTop. */
function bindZoomPan(wrap, svgId, baseW, baseH, stateKey) {
  if (!wrap) return;
  const svg = $(svgId); if (!svg) return;
  // v0.59.340: универсализован под несколько zoom-state'ов (dlgZoom для
  // модалки, mapZoom для основной карты).
  stateKey = stateKey || 'dlgZoom';
  wrap.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return; // без Ctrl — обычный скролл
    ev.preventDefault();
    const oldZ = state[stateKey] || 1;
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZ = Math.max(0.4, Math.min(5, oldZ * factor));
    if (Math.abs(newZ - oldZ) < 0.001) return;
    const rect = wrap.getBoundingClientRect();
    const cx = ev.clientX - rect.left + wrap.scrollLeft;
    const cy = ev.clientY - rect.top + wrap.scrollTop;
    const k = newZ / oldZ;
    state[stateKey] = newZ;
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
      // v0.59.302: клик по порту не должен запускать drag устройства
      if (ev.target && ev.target.classList && ev.target.classList.contains('sc-port')) return;
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
      const valid = canPlace(r, currentContents(), d.id, h, wantU, d.mountSide || 'front');
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
function canPlace(r, devices, excludeDevId, heightU, wantU, side) {
  if (wantU < heightU || wantU > r.u) return false;
  const targetSide = side || 'front';
  for (const d of devices) {
    if (d.id === excludeDevId) continue;
    // v0.59.250: другая сторона монтажа не создаёт U-коллизию.
    if ((d.mountSide || 'front') !== targetSide) continue;
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
  state._dragMeta = { h: type.heightU || 1, label, color: type.color || '#94a3b8', depthMm: +type.depthMm || 400 };
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
  // v0.59.253: в режиме «Обе» сторона монтажа определяется X-координатой
  // курсора (левая половина → фронт, правая → тыл).
  const computeSide = (clientX) => {
    const face = svg.dataset.face || 'front';
    if (face === 'rear') return 'rear';
    if (face !== 'both') return 'front';
    const rect = svg.getBoundingClientRect();
    const svgW = svg.viewBox.baseVal.width || rect.width;
    const xView = (clientX - rect.left) * (svgW / rect.width);
    const bodyW = +svg.dataset.bodyw || 220;
    const bodyX = +svg.dataset.bodyx || 32;
    const halfW = bodyW / 2;
    return xView < bodyX + halfW ? 'front' : 'rear';
  };
  const updatePreview = (clientX, clientY, h) => {
    const topU = computeTopU(clientY); if (topU == null) return;
    const r = currentRack();
    const old = svg.querySelector('.sc-drop-preview'); if (old) old.remove();
    const ph = h || 1;
    const wantU = Math.min(topU, r.u);
    const topIdx = r.u - wantU;
    const y = 4 + topIdx * rowH;
    const bodyW = +svg.dataset.bodyw || 220;
    const bodyX = +svg.dataset.bodyx || 32;
    const face = svg.dataset.face || 'front';
    const side = computeSide(clientX);
    const isBoth = face === 'both';
    const halfW = bodyW / 2;
    const px = isBoth ? (side === 'rear' ? (bodyX + halfW) : bodyX) : bodyX;
    const pw = isBoth ? halfW : bodyW;
    // проверим можно ли сюда поставить
    const valid = canPlace(r, currentContents(), null, ph, wantU, side);
    const color = valid ? '#2563eb' : '#dc2626';
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'sc-drop-preview');
    g.setAttribute('pointer-events', 'none');
    const badge = isBoth ? (side === 'rear' ? '🟥 тыл' : '🟦 фронт') : '';
    g.innerHTML = `<rect x="${px}" y="${y}" width="${pw}" height="${ph * rowH - 1}"
      fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>
      ${badge ? `<text x="${px + pw/2}" y="${y + (ph*rowH)/2 + 4}" font-size="11" fill="${color}" text-anchor="middle" font-weight="bold">${badge}</text>` : ''}`;
    svg.appendChild(g);
  };
  const clearPreview = () => { const p = svg.querySelector('.sc-drop-preview'); if (p) p.remove(); };
  const onDragOver = (ev) => {
    const types = Array.from(ev.dataTransfer.types);
    if (!acceptType(types)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = types.includes('application/x-scs-typeid') ? 'copy' : 'move';
    highlight(true);
    let h = 1;
    const s = state._dragMeta; if (s && s.h) h = s.h;
    updatePreview(ev.clientX, ev.clientY, h);
  };
  svg.addEventListener('dragenter', onDragOver);
  svg.addEventListener('dragover', onDragOver);
  svg.addEventListener('dragleave', (ev) => {
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
    const targetSide = computeSide(ev.clientX);
    if (whId) {
      warehouseToCart(whId);
      const justAdded = state.cart[state.cart.length - 1];
      if (justAdded) { justAdded.mountSide = targetSide; installFromCart(justAdded.id, wantTopU); }
    } else if (cartId) {
      const item = state.cart.find(x => x.id === cartId);
      if (item) item.mountSide = targetSide;
      installFromCart(cartId, wantTopU);
    } else {
      const type = state.catalog.find(c => c.id === typeId); if (!type) return;
      const finalU = findNearestFreeSlot(r, currentContents(), type.heightU, wantTopU, targetSide);
      if (finalU == null) { scToast('Нет свободного места для устройства (' + type.heightU + 'U)', 'err'); return; }
      addToRack(typeId, finalU, targetSide);
    }
  });
}

/* 1.24.29 — поиск ближайшего свободного блока heightU к wantU (сначала
   выше, потом ниже). Возвращает top-U или null если нет места. */
function findNearestFreeSlot(r, devices, heightU, wantU, side) {
  const okAt = (u) => canPlace(r, devices, null, heightU, u, side);
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
    const row = byType.get(key) || { label: type.label, kind: KIND_LABEL[type.kind], qty: 0, powerW: type.powerW, depthMm: type.depthMm || 0 };
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
  const rows = [`<tr><th>Позиция</th><th>Раздел</th><th>Кол-во</th><th>Длина, м</th><th>Вт/шт</th><th title="Монтажная глубина, мм">Глуб., мм</th></tr>`];
  items.forEach(it => {
    rows.push(`<tr><td>${escape(it.label)}</td><td>${escape(it.kind)}</td><td>${it.qty}</td><td>${it.lenM ? it.lenM.toFixed(1) : '—'}</td><td>${it.powerW ?? '—'}</td><td>${it.depthMm || '—'}</td></tr>`);
  });
  if (!items.length) rows.push('<tr><td colspan="6" class="muted">— пусто —</td></tr>');
  t.innerHTML = rows.join('');
}
function exportBomCsv() {
  const items = computeBom();
  const r = currentRack();
  const rackTag = currentRackTag();
  const rows = [['Позиция','Раздел','Кол-во','Длина, м','Вт/шт','Глуб., мм']];
  items.forEach(it => rows.push([it.label, it.kind, it.qty, it.lenM ? it.lenM.toFixed(1) : '', it.powerW ?? '', it.depthMm || '']));
  // 1.24.30 — список устройств с TIA-606 тегами (отдельной секцией)
  if (r) {
    rows.push([]);
    rows.push([`Теги устройств TIA-606 (стойка ${rackTag || r.name || ''})`]);
    rows.push(['Тег','U','Название','Тип','Сторона','Глуб., мм','PDU ввод','PDU outlet']);
    currentContents().slice().sort((a,b) => b.positionU - a.positionU).forEach(d => {
      const t = state.catalog.find(c => c.id === d.typeId);
      const dmm = (typeof d.depthMm === 'number' && d.depthMm > 0) ? d.depthMm : (t?.depthMm || '');
      const side = (d.mountSide || 'front') === 'rear' ? 'тыл' : 'фронт';
      rows.push([deviceTag(d), d.positionU, d.label, t ? KIND_LABEL[t.kind] : '', side, dmm, d.pduFeed || '', d.pduOutlet || '']);
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

/* v0.59.277: picker шаблонов КОРПУСА стойки (в отличие от «Готовая сборка»
   — тот пресет содержимого). Источник — state.racks без тега (tpl-* и
   старые tpl без префикса). Применение копирует геометрию в текущую стойку
   и фиксирует sourceTemplateId → в label появится «TAG (TplName · Uu)». */
function renderCorpusPicker() {
  const sel = $('sc-corpus'); if (!sel) return;
  // Шаблоны = стойки БЕЗ тега. Исключаем саму текущую стойку (если она
  // оказалась tpl-* без тега — пограничный случай).
  const curId = state.currentRackId;
  const tpls = state.racks.filter(r => {
    const hasTag = ((state.rackTags && state.rackTags[r.id]) || '').trim();
    return !hasTag && r.id !== curId;
  });
  const r = currentRack();
  const curTpl = r && r.sourceTemplateId;
  sel.innerHTML = tpls.length
    ? '<option value="">— выбрать шаблон —</option>' +
      tpls.map(t => `<option value="${t.id}"${t.id === curTpl ? ' selected' : ''}>${escape(t.name || t.id)} · ${t.u}U</option>`).join('')
    : '<option value="">— нет шаблонов в rack-config —</option>';
  // v0.59.280: показываем «↶ Вернуть» только если есть снимок.
  const revertBtn = $('sc-corpus-revert');
  if (revertBtn) revertBtn.style.display = (r && r._corpusBackup) ? '' : 'none';
}

/* v0.59.280: делаем снимок критичных полей стойки ДО применения корпуса.
   Хранится прямо на объекте r как r._corpusBackup. По кнопке «↶ Вернуть»
   возвращаем исходное состояние. Содержимое (устройства) — в state.contents
   по rackId, здесь не трогается, но резервируем и его, т.к. изменение
   ёмкости (U) может косвенно повлиять на валидность позиций. */
const CORPUS_FIELDS = [
  'u','width','depth','railFrontOffset','railDepth','railRearOffset','railAutoField',
  'doorFront','doorRear','doorWithLock','lock','sides','top','base','comboTopBase',
  'entryTop','entryBot','entryType','occupied','blankType','demandKw','cosphi',
  'pduRedundancy','pdus','accessories','kitId','manufacturer','name'
];

function snapshotCorpus(r) {
  const snap = {};
  CORPUS_FIELDS.forEach(k => {
    snap[k] = (r[k] && typeof r[k] === 'object') ? JSON.parse(JSON.stringify(r[k])) : r[k];
  });
  snap.sourceTemplateId   = r.sourceTemplateId || null;
  snap.sourceTemplateName = r.sourceTemplateName || null;
  snap._ts = Date.now();
  return snap;
}

async function applyCorpus() {
  const sel = $('sc-corpus'); const id = sel && sel.value;
  const r = currentRack();
  if (!r) { scToast('Сначала выберите стойку', 'warn'); return; }
  if (!id) { scToast('Выберите шаблон корпуса', 'warn'); return; }
  const tpl = state.racks.find(x => x.id === id);
  if (!tpl) { scToast('Шаблон не найден', 'err'); return; }

  // diff-превью: показываем, какие ключевые параметры поменяются.
  const diffLines = [];
  const pairs = [
    ['u', 'U'], ['width', 'Ширина, мм'], ['depth', 'Глубина, мм'],
    ['occupied', 'Занято корпусом, U'], ['doorFront', 'Дверь фасад'],
    ['doorRear', 'Дверь тыл'],
  ];
  pairs.forEach(([k, lbl]) => {
    const a = r[k], b = tpl[k];
    if (String(a ?? '—') !== String(b ?? '—')) diffLines.push(`${lbl}: ${a ?? '—'} → ${b ?? '—'}`);
  });
  const pdusA = Array.isArray(r.pdus) ? r.pdus.length : 0;
  const pdusB = Array.isArray(tpl.pdus) ? tpl.pdus.length : 0;
  if (pdusA !== pdusB) diffLines.push(`PDU: ${pdusA} → ${pdusB}`);
  const detail = (diffLines.length
    ? 'Изменится: ' + diffLines.join('; ') + '. '
    : 'Параметры совпадают — применение будет no-op. ')
    + 'Содержимое (устройства) не затрагивается. Текущее состояние можно вернуть кнопкой «↶ Вернуть корпус».';

  const ok = await scConfirm(
    `Применить корпус «${tpl.name}» к стойке «${rackLabel(r)}»?`,
    detail,
    { okLabel: 'Применить' }
  );
  if (!ok) return;

  // Бэкап до применения — даст возможность отменить.
  r._corpusBackup = snapshotCorpus(r);

  // Копируем геометрию. НЕ копируем id/comment/sourceTemplate*/_corpusBackup.
  const SKIP = new Set(['id', 'comment', 'sourceTemplateId', 'sourceTemplateName', '_corpusBackup']);
  Object.keys(tpl).forEach(k => {
    if (SKIP.has(k)) return;
    r[k] = (tpl[k] && typeof tpl[k] === 'object') ? JSON.parse(JSON.stringify(tpl[k])) : tpl[k];
  });
  r.sourceTemplateId = tpl.id;
  r.sourceTemplateName = tpl.name || tpl.id;
  saveRacks();
  rerender();
  scToast(`Корпус «${tpl.name}» применён · можно отменить ↶`, 'ok');
}

/* v0.59.280: вернуть стойку к состоянию ДО последнего applyCorpus. */
async function revertCorpus() {
  const r = currentRack();
  if (!r || !r._corpusBackup) { scToast('Нечего отменять.', 'warn'); return; }
  const snap = r._corpusBackup;
  const ok = await scConfirm(
    `Откатить применение корпуса у стойки «${rackLabel(r)}»?`,
    'Вернётся состояние, которое было непосредственно перед применением шаблона. Содержимое стойки не изменится.',
    { okLabel: 'Откатить' }
  );
  if (!ok) return;
  CORPUS_FIELDS.forEach(k => {
    r[k] = (snap[k] && typeof snap[k] === 'object') ? JSON.parse(JSON.stringify(snap[k])) : snap[k];
  });
  r.sourceTemplateId   = snap.sourceTemplateId || null;
  r.sourceTemplateName = snap.sourceTemplateName || null;
  delete r._corpusBackup;
  saveRacks();
  rerender();
  scToast('Корпус стойки откатан.', 'ok');
}

/* v0.59.280: сохранить текущую геометрию стойки как НОВЫЙ шаблон корпуса
   (в глобальный каталог rack-config). Шаблон получает уникальный tpl-* id
   и дефолтное имя; пользователь задаёт своё имя в prompt. Саму стойку не
   трогаем — sourceTemplateId по желанию можно перепривязать на новый шаблон. */
async function saveCorpusAsNewTemplate() {
  const r = currentRack();
  if (!r) { scToast('Нет выбранной стойки.', 'warn'); return; }
  const defName = `Корпус · ${r.u || '?'}U · ${r.width || '?'}×${r.depth || '?'}`;
  const name = await scPrompt('Имя нового шаблона корпуса', defName);
  if (name == null) return;
  const nm = String(name).trim();
  if (!nm) { scToast('Имя не может быть пустым.', 'warn'); return; }
  const dup = state.racks.some(x => (x.name || '').trim().toLowerCase() === nm.toLowerCase());
  if (dup) { scToast(`Имя «${nm}» уже занято.`, 'warn'); return; }
  const tpl = JSON.parse(JSON.stringify(r));
  tpl.id = 'tpl-' + Math.random().toString(36).slice(2, 9);
  tpl.name = nm;
  delete tpl.comment;
  delete tpl.sourceTemplateId;
  delete tpl.sourceTemplateName;
  delete tpl._corpusBackup;
  state.racks.push(tpl);
  const relink = await scConfirm(
    'Перепривязать текущую стойку к новому шаблону?',
    `Шаблон «${nm}» создан. Хотите, чтобы текущая стойка указывала на него как на источник корпуса (sourceTemplateId)?`,
    { okLabel: 'Перепривязать', cancelLabel: 'Оставить как есть' }
  );
  if (relink) {
    r.sourceTemplateId = tpl.id;
    r.sourceTemplateName = tpl.name;
  }
  saveRacks();
  rerender();
  scToast(`Шаблон «${nm}» сохранён в rack-config.`, 'ok');
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
      mountSide: d.mountSide || 'front',
      depthMm: (typeof d.depthMm === 'number') ? d.depthMm : null,
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
    const nd = { id: uid('dev'), typeId: d.typeId, label: d.label, positionU: d.positionU, mountSide: d.mountSide || 'front', pduFeed: d.pduFeed, pduOutlet: d.pduOutlet };
    if (typeof d.depthMm === 'number') nd.depthMm = d.depthMm;
    return nd;
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
  const n = countAttachedCables(state.currentRackId, devId);
  if (n > 0) {
    scToast(`Нельзя вытащить: к устройству подключено ${n} ${n === 1 ? 'кабель' : (n < 5 ? 'кабеля' : 'кабелей')}. Сначала удалите связи в «Проектирование СКС».`, 'warn');
    return;
  }
  const r = currentRack();
  state.cart.push({
    id: uid('cart'),
    typeId: d.typeId,
    label: d.label,
    fromRackId: r ? r.id : null,
    fromRackName: r ? (r.name || '') : '',
    pduFeed: d.pduFeed || '', pduOutlet: d.pduOutlet || '',
    mountSide: d.mountSide || 'front',
    depthMm: (typeof d.depthMm === 'number') ? d.depthMm : null,
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
  const targetSide = item.mountSide || (state.faceMode === 'rear' ? 'rear' : 'front');
  const finalU = findNearestFreeSlot(r, currentContents(), type.heightU,
    Number.isFinite(wantTopU) ? wantTopU : r.u - r.occupied, targetSide);
  if (finalU == null) { scToast('Нет места в стойке (' + type.heightU + 'U)', 'err'); return; }
  const newDev = {
    id: uid('dev'),
    typeId: item.typeId,
    label: item.label,
    positionU: finalU,
    mountSide: targetSide,
    pduFeed: item.pduFeed || '', pduOutlet: '',  // розетку не тянем — другая стойка
  };
  if (typeof item.depthMm === 'number') newDev.depthMm = item.depthMm;
  currentContents().push(newDev);
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
function rerender() { renderRackPicker(); renderRacksSidebar(); renderTemplates(); renderCorpusPicker(); renderContents(); renderMatrix(); rerenderPreview(); renderCart(); renderWarehouse(); }

/* 1.24.39 — сайдбар со списком всех шкафов проекта (в rack.html).
   Клик по карточке переключает state.currentRackId + URL без перезагрузки. */
function renderRacksSidebar() {
  const host = $('sc-racks-side'); if (!host) return;
  const list = projectRacks();
  if (!list.length) {
    host.innerHTML = `<div class="sc-cart-empty">В проекте нет физических шкафов.<br>
      <button type="button" class="sc-btn sc-btn-primary" data-act="new-rack" style="margin-top:8px">➕ Новая стойка</button>
      <br><a href="./index.html" style="font-size:11px">Реестр шкафов →</a></div>`;
    host.querySelector('[data-act="new-rack"]')?.addEventListener('click', () => {
      location.href = './index.html?new=1';
    });
    return;
  }
  host.innerHTML = list.map(r => {
    const devs = state.contents[r.id] || [];
    const usedU = devs.reduce((s, d) => {
      const t = state.catalog.find(c => c.id === d.typeId);
      return s + (t ? (t.heightU || 1) : 1);
    }, 0);
    const tag = (state.rackTags[r.id] || '').trim();
    const full = r.u || 0;
    const pct = full ? Math.round(((usedU + (r.occupied || 0)) / full) * 100) : 0;
    const active = r.id === state.currentRackId ? ' sc-rack-card-active' : '';
    // v0.59.277: под именем экземпляра показываем ссылку на шаблон корпуса
    // (если задан). Это делает сайдбар однозначным: «A-02 / 600x1200x42U Тип 1».
    let corpusName = '';
    if (r.sourceTemplateId) {
      const tpl = state.racks.find(x => x.id === r.sourceTemplateId);
      corpusName = tpl ? (tpl.name || '') : (r.sourceTemplateName || '');
    }
    return `<div class="sc-rack-card${active}" data-rackid="${r.id}" title="Открыть">
      <div class="sc-rack-card-top">
        ${tag ? `<code>${escape(tag)}</code>` : `<span class="muted">—</span>`}
        <span class="muted">${full}U</span>
      </div>
      <div class="sc-rack-card-name">${escape(r.name || 'Без имени')}</div>
      ${corpusName ? `<div class="sc-rack-card-corpus" title="Шаблон корпуса">🗄 ${escape(corpusName)}</div>` : ''}
      <div class="sc-rack-card-bar">
        <div style="width:${pct}%;background:${pct>90?'#dc2626':pct>70?'#f59e0b':'#10b981'}"></div>
      </div>
      <div class="sc-rack-card-meta"><span>${devs.length} уст.</span><span class="muted">${pct}%</span></div>
    </div>`;
  }).join('');
  // v0.59.255: клик — явный переход (URL + full reload), чтобы пользователь
  // не переключал стойку случайно. Активная карточка не кликабельна.
  host.querySelectorAll('.sc-rack-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.rackid;
      if (id === state.currentRackId) return;
      location.href = `./rack.html?rackId=${encodeURIComponent(id)}`;
    });
  });
}

/* ---- init -------------------------------------------------------------- */
// v0.59.244: project badge — показать активный проект + sketch-warning.
function renderProjectBadge() {
  const el = document.getElementById('sc-project-badge');
  if (!el) return;
  const pid = getActiveProjectId();
  // v0.59.515: в шапке — selectable dropdown со списком всех full-проектов.
  // Раньше тут была статичная подпись + ссылка «сменить →» в /projects/.
  // Теперь смена проекта происходит in-place: select.onChange → location.href
  // с новым ?project=<pid>&from=projects.
  let projects = [];
  try { projects = (listProjects() || []).filter(x => (x.kind || 'full') !== 'sketch'); } catch {}
  // Сортировка: активный сверху, остальные по updatedAt desc.
  projects.sort((a, b) => {
    if (a.id === pid) return -1;
    if (b.id === pid) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  const optionsHtml = projects.map(p => {
    const sel = (p.id === pid) ? ' selected' : '';
    const name = (p.name || p.id).replace(/</g, '&lt;');
    return `<option value="${p.id}"${sel}>${name}</option>`;
  }).join('');

  if (!pid) {
    el.innerHTML = `<span style="color:#b91c1c">⚠ Вне проекта</span> · <select id="sc-project-switch" style="font-size:13px"><option value="">— выбрать проект —</option>${optionsHtml}</select> · <a href="../projects/" style="color:#1565c0">/projects/</a>`;
  } else {
    let p = null;
    try { p = (listProjects() || []).find(x => x.id === pid) || null; } catch {}
    const isSketch = p?.kind === 'sketch';
    const icon = isSketch ? '🧪' : '📁';
    const lbl  = isSketch ? 'Мини-проект' : 'Проект';
    el.innerHTML = `${icon} ${lbl}: <select id="sc-project-switch" style="font-size:13px;font-weight:600">${optionsHtml}</select> · <a href="../projects/" style="color:#1565c0">/projects/</a>`;
  }
  // Bind change.
  const sel = document.getElementById('sc-project-switch');
  if (sel) {
    sel.addEventListener('change', () => {
      const newPid = sel.value;
      if (!newPid || newPid === pid) return;
      const url = new URL(location.href);
      url.searchParams.set('project', newPid);
      url.searchParams.set('from', 'scs-config');
      location.href = url.toString();
    });
  }
}

function init() {
  renderProjectBadge();
  state.racks     = loadRacks();
  state.catalog   = loadJson(LS_CATALOG,   DEFAULT_CATALOG.slice());
  state.contents  = loadJson(LS_CONTENTS,  {});
  state.matrix    = loadJson(LS_MATRIX,    {});
  state.templates = loadJson(LS_TEMPLATES, []);
  state.cart      = loadJson(LS_CART,      []);
  state.rackTags  = loadJson(LS_RACKTAGS,  {});
  state.warehouse = loadJson(LS_WAREHOUSE, []);
  // v0.59.273: защита от повреждённого LS — типизация важных структур.
  if (!Array.isArray(state.racks))    state.racks = [];
  if (!Array.isArray(state.catalog))  state.catalog = DEFAULT_CATALOG.slice();
  if (!state.contents || typeof state.contents !== 'object' || Array.isArray(state.contents)) state.contents = {};
  if (!state.matrix    || typeof state.matrix    !== 'object' || Array.isArray(state.matrix))    state.matrix = {};
  if (!Array.isArray(state.templates)) state.templates = [];
  if (!Array.isArray(state.cart))      state.cart = [];
  if (!state.rackTags  || typeof state.rackTags  !== 'object' || Array.isArray(state.rackTags))  state.rackTags = {};
  if (!Array.isArray(state.warehouse)) state.warehouse = [];
  if (!state.catalog.length) state.catalog = DEFAULT_CATALOG.slice();

  // v0.59.520: для racks из POR (имеют r.tag и помечены _source:'por'),
  // если у них нет записи в state.rackTags — добавляем. SCS-picker
  // фильтрует «Стойки проекта — с тегом» по state.rackTags[r.id], а тег
  // из POR-объекта живёт в r.tag. Без этой синхронизации POR-стойки не
  // попадали в picker даже если у них есть obj.tag в POR.
  let _rackTagsTouched = false;
  for (const r of state.racks) {
    if (!r || !r.id) continue;
    if (r._source !== 'por' && !r.porObjectId) continue;  // только POR
    const existing = (state.rackTags[r.id] || '').trim();
    if (existing) continue;
    const t = (r.tag || '').trim();
    if (!t) continue;
    state.rackTags[r.id] = t;
    _rackTagsTouched = true;
  }
  if (_rackTagsTouched) {
    try { localStorage.setItem(LS_RACKTAGS, JSON.stringify(state.rackTags)); } catch {}
    console.info('[scs-config] синхронизированы теги из POR → state.rackTags');
  }
  // v0.59.275: санитарная проверка catFilter — если сохранённый фильтр скрывает
  // весь каталог (например uMin > max heightU), сбрасываем его, чтобы юзер
  // не видел пустой каталог без подсказки при открытии страницы.
  try {
    const f = state.catFilter || {};
    const maxU = state.catalog.reduce((m,c)=>Math.max(m, +c.heightU||0), 0);
    if ((f.uMin !== '' && +f.uMin > maxU) || (f.uMax !== '' && +f.uMax < 1)) {
      state.catFilter = { q:'', kind:'', uMin:'', uMax:'' };
      localStorage.setItem('scs-config.catFilter.v1', JSON.stringify(state.catFilter));
    }
  } catch {}
  // v0.59.245: миграция — depthMm для старых записей каталога.
  // Не перезаписываем если уже задано (user params are sacred).
  state.catalog.forEach(c => {
    if (typeof c.depthMm !== 'number') {
      const def = DEFAULT_CATALOG.find(d => d.id === c.id);
      c.depthMm = def?.depthMm || (c.kind === 'patch-panel' || c.kind === 'cable-manager' ? 100 : 500);
    }
  });
  // v0.59.257: auto-append новых моделей из DEFAULT_CATALOG по id (Supermicro
  // AI-серверы, Cisco/Arista/NVIDIA свитчи и т.п.). Не перезаписываем
  // существующие записи — пользовательские правки sacred.
  const have = new Set(state.catalog.map(c => c.id));
  DEFAULT_CATALOG.forEach(d => { if (!have.has(d.id)) state.catalog.push({ ...d }); });
  saveCatalog();
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
    renderContents(); renderMatrix(); rerenderPreview(); renderCorpusPicker();
    const r = currentRack();
    $('sc-rack-u').textContent = r ? r.u : '—';
    $('sc-rack-occ').textContent = r ? computeOccupiedU(r, currentContents()) : '—';
    const freeEl2 = $('sc-rack-free');
    if (freeEl2) {
      const ranges = r ? freeURanges(r, currentContents()) : [];
      freeEl2.textContent = ranges.length ? ranges.join(', ') : (r ? 'нет' : '—');
    }
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
  // v0.59.258: фильтры каталога
  // v0.59.264: persist в LS + restore значений инпутов при открытии
  const saveCatFilter = () => {
    try { localStorage.setItem('scs-config.catFilter.v1', JSON.stringify(state.catFilter)); } catch {}
  };
  const bindCatFilter = (id, key, ev = 'input') => {
    const el = $(id); if (!el) return;
    // restore сохранённого значения в UI
    if (state.catFilter && state.catFilter[key] != null) el.value = state.catFilter[key];
    el.addEventListener(ev, () => {
      if (!state.catFilter) state.catFilter = { q: '', kind: '', uMin: '', uMax: '' };
      state.catFilter[key] = el.value;
      saveCatFilter();
      renderCatalog();
    });
  };
  bindCatFilter('sc-cat-search', 'q');
  bindCatFilter('sc-cat-kind-filter', 'kind', 'change');
  bindCatFilter('sc-cat-u-min', 'uMin');
  bindCatFilter('sc-cat-u-max', 'uMax');
  // v0.59.266: кнопка сброса фильтров
  const clrBtn = $('sc-cat-filter-clear');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    state.catFilter = { q: '', kind: '', uMin: '', uMax: '' };
    saveCatFilter();
    ['sc-cat-search','sc-cat-kind-filter','sc-cat-u-min','sc-cat-u-max'].forEach(id => {
      const el = $(id); if (el) el.value = '';
    });
    renderCatalog();
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

  // v0.59.367: экспорт/импорт всей конфигурации СКС активного проекта.
  // LS_CONTENTS/LS_MATRIX/LS_CART/LS_RACKTAGS/LS_WAREHOUSE — project-namespaced
  // (вычисляются в startup из projectKey()), LS_CATALOG/LS_TEMPLATES — глобальные.
  // Также сохраняем список стоек активного проекта (через rack-storage).
  wireExportImport({
    exportBtn: document.getElementById('sc-export-config'),
    importBtn: document.getElementById('sc-import-config'),
    fileInput: document.getElementById('sc-import-file'),
    schema: 'raschet.scs-config.v1',
    lsKeys: [LS_CATALOG, LS_TEMPLATES, LS_CONTENTS, LS_MATRIX, LS_CART, LS_RACKTAGS, LS_WAREHOUSE],
    filenamePrefix: 'scs-config',
    appVersion: APP_VERSION,
    getExtra: () => {
      try { return { racks: loadAllRacksForActiveProject() || [] }; }
      catch { return null; }
    },
    onAfterImport: (payload) => {
      try {
        if (payload && payload._extra && Array.isArray(payload._extra.racks)) {
          saveAllRacksForActiveProject(payload._extra.racks);
        }
        // полная перезагрузка: проще, чем синхронизировать state в живом UI
        location.reload();
      } catch (e) { console.warn('[scs-config import]', e); }
    },
  });
  $('sc-template-save').addEventListener('click', saveCurrentAsTemplate);
  $('sc-template-apply').addEventListener('click', applyTemplate);
  // v0.59.277: применить шаблон корпуса (rack-config tpl) к текущему экземпляру.
  $('sc-corpus-apply')?.addEventListener('click', applyCorpus);
  // v0.59.280: откат применения корпуса + сохранение как новый шаблон.
  $('sc-corpus-revert')?.addEventListener('click', revertCorpus);
  $('sc-corpus-save-as')?.addEventListener('click', saveCorpusAsNewTemplate);

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

  /* ---- v0.59.245 переключатель вида (Фронт / Тыл / Бок / 3D) --------- */
  // инициализация активной кнопки из persist-состояния
  document.querySelectorAll('.sc-fm-btn').forEach(b => {
    b.classList.toggle('sc-fm-active', b.dataset.face === state.faceMode);
  });
  document.querySelectorAll('.sc-fm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.faceMode = btn.dataset.face;
      try { localStorage.setItem('scs-config.faceMode.v1', state.faceMode); } catch {}
      document.querySelectorAll('.sc-fm-btn').forEach(b => {
        b.classList.toggle('sc-fm-active', b.dataset.face === state.faceMode);
      });
      rerenderPreview();
    });
  });

  /* ---- v0.59.258 направление U-нумерации (bu / td) ------------------- */
  const unumBtn = $('sc-unum-toggle');
  const syncUnumBtn = () => {
    if (!unumBtn) return;
    unumBtn.textContent = state.uNumDir === 'td' ? '↕ 1↓' : '↕ 1↑';
    unumBtn.title = (state.uNumDir === 'td'
      ? 'U-нумерация: 1 сверху (top-down). Кликнуть — переключить на «1 снизу»'
      : 'U-нумерация: 1 снизу (bottom-up, EIA-310). Кликнуть — переключить на «1 сверху»')
      + ' · горячая клавиша: U';
  };
  syncUnumBtn();
  if (unumBtn) unumBtn.addEventListener('click', () => {
    state.uNumDir = state.uNumDir === 'td' ? 'bu' : 'td';
    try { localStorage.setItem('scs-config.uNumDir.v1', state.uNumDir); } catch {}
    syncUnumBtn();
    rerenderPreview();
  });

  /* ---- v0.59.270 горячие клавиши: U = toggle uNumDir; F = cycle face-mode */
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tgt = ev.target;
    const tag = (tgt && tgt.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tgt && tgt.isContentEditable)) return;
    const key = ev.key.toLowerCase();
    if (key === 'u') {
      ev.preventDefault();
      state.uNumDir = state.uNumDir === 'td' ? 'bu' : 'td';
      try { localStorage.setItem('scs-config.uNumDir.v1', state.uNumDir); } catch {}
      syncUnumBtn();
      rerenderPreview();
    } else if (key === 'f') {
      ev.preventDefault();
      const order = ['front', 'rear', 'both', 'side', '3d'];
      const idx = order.indexOf(state.faceMode);
      state.faceMode = order[(idx + 1) % order.length];
      try { localStorage.setItem('scs-config.faceMode.v1', state.faceMode); } catch {}
      document.querySelectorAll('.sc-fm-btn').forEach(b => {
        b.classList.toggle('sc-fm-active', b.dataset.face === state.faceMode);
      });
      rerenderPreview();
    }
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

// v0.59.273: обёртка init() с глобальным catch — при падении показываем
// красный баннер вверху страницы вместо молчаливо-пустого интерфейса.
try {
  init();
} catch (e) {
  console.error('[scs-config] init() failed:', e);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;padding:8px 14px;font:13px system-ui;box-shadow:0 2px 6px rgba(0,0,0,.25)';
  banner.innerHTML = `⚠ Компоновщик не смог инициализироваться: <b>${(e && e.message || e)}</b>. Откройте DevTools (F12) → Console для стека. Попробуйте очистить LS: <code style="background:#7f1d1d;padding:1px 5px;border-radius:3px">localStorage.clear()</code> и перезагрузить.`;
  document.body.appendChild(banner);
}

// v0.59.273: глобальный перехватчик runtime-ошибок и unhandled promise rejections.
// Раньше silent-fail прятал баги типа ReferenceError в ленивых путях (renderSideView),
// из-за чего пользователь видел «Компоновщик сломался» без подсказки.
window.addEventListener('error', (ev) => {
  try {
    console.error('[scs-config] runtime error:', ev.error || ev.message);
    if (!document.getElementById('sc-err-toast-global')) {
      const t = document.createElement('div');
      t.id = 'sc-err-toast-global';
      t.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;font:12px system-ui;max-width:420px;box-shadow:0 4px 12px rgba(0,0,0,.15)';
      t.innerHTML = `⚠ Ошибка: <b>${(ev.error && ev.error.message) || ev.message}</b><br><span style="font-size:11px;color:#7f1d1d">Детали в Console (F12)</span>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 8000);
    }
  } catch {}
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[scs-config] unhandled rejection:', ev.reason);
});
