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

/* v0.58.72: централизация.
   Справочные таблицы, KIT_CATALOG, ACCESSORY_CATALOG, PDU_CATALOG и
   хелперы (pduBySku / accBySku / kitById / accessoryMatchesRackMfg /
   accessoryMfgList) переехали в shared/rack-catalog-data.js — тот же
   модуль через catalog-bridge регистрирует элементы как builtin в
   единой библиотеке (kinds: 'rack', 'pdu', 'rack-accessory').
   Здесь — только импорт, чтобы не было дублирующего источника данных. */
import {
  DOOR_LABEL, TOP_LABEL, BASE_LABEL, ENTRY_LABEL, LOCK_LABEL,
  BLANK_LABEL, BLANK_U,
  KIT_CATALOG, ACCESSORY_CATALOG, ACC_CATEGORIES,
  PDU_CATEGORY, PDU_CATALOG,
  pduBySku, accBySku, kitById,
  accessoryMatchesRackMfg, accessoryMfgList,
  getLiveKitCatalog, getLivePduCatalog, getLiveAccessoryCatalog,
} from '../shared/rack-catalog-data.js';
import { initCatalogBridge } from '../shared/catalog-bridge.js';
import { onLibraryChange } from '../shared/element-library.js';
initCatalogBridge();

// Re-render при правках каталога (админ изменил встроенный rack/pdu/accessory).
try {
  onLibraryChange(() => {
    try { if (typeof renderForm === 'function') renderForm(); } catch {}
    try { if (typeof renderKitBtn === 'function') renderKitBtn(); } catch {}
  });
} catch {}

const LS_KEY  = 'rack-config.templates.v1';
const BRIDGE_KEY_PREFIX = 'raschet.rack.bridge.';

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
    // Режим резервирования PDU:
    //   'none' — все PDU суммируются (одиночное питание)
    //   '2N'   — PDU сгруппированы по вводам A/B/C/…; каждый ввод должен
    //            в одиночку покрывать demandKw (горячий резерв)
    //   'n+1'  — сумма - 1 «худший» ввод ≥ demandKw (N+1 избыточность)
    pduRedundancy: '2N',
    pdus: [
      { id: 'pdu1', qty: 1, rating: 16, phases: 1, height: 0, feed: 'A',
        outlets: [ { type: 'C13', count: 8 } ] },
      { id: 'pdu2', qty: 1, rating: 16, phases: 1, height: 0, feed: 'B',
        outlets: [ { type: 'C13', count: 8 } ] },
    ],
    // feeds — мета с основной схемы: какие вводы есть у узла consumer/rack
    // и их доступная мощность. Если есть — используется для жёсткой
    // проверки «нагрузка ≤ доступной по этому вводу». Заполняется при
    // открытии конфигуратора с ?nodeId=… через bridge-ключ.
    feeds: [],
    accessories: [], // [{ sku, qty }] — дополнительные аксессуары из ACCESSORY_CATALOG
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
function renderKitBtn() {
  const btn = el('rc-kit-btn');
  if (!btn) return;
  const t = current();
  const kit = kitById(t && t.kitId || '');
  btn.textContent = kit.id
    ? `${kit.name}${kit.sku ? ' — ' + kit.sku : ''}`
    : '— Произвольная конфигурация (выбрать из каталога…) —';
}

// Модал выбора базового комплекта из каталога.
// Колонки: SKU | наименование | формат (UxWxD) | двери | производитель.
// Фильтры: производитель, формат по U, по ширине/глубине, текст-поиск.
function openKitCatalogModal() {
  const t = current();
  const KITS = getLiveKitCatalog();
  const mfgs = Array.from(new Set(
    KITS.filter(k => k.id).map(k => (k.preset && k.preset.manufacturer) || '—'))).sort();
  const us   = Array.from(new Set(KITS.filter(k => k.id).map(k => k.preset.u))).sort((a,b) => a-b);
  const state = { search: '', mfg: '__all__', u: '__all__' };

  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--rs-bg-card);color:var(--rs-fg);border-radius:10px;max-width:1040px;width:94%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  back.appendChild(box);
  document.body.appendChild(back);

  function doorLbl(k) {
    const f = DOOR_LABEL[k.preset.doorFront] || '—';
    const r = DOOR_LABEL[k.preset.doorRear]  || '—';
    return `<span class="muted" style="font-size:11px">перед: ${escape(f)}<br>зад: ${escape(r)}</span>`;
  }
  function render() {
    const q = state.search.trim().toLowerCase();
    const rows = KITS.filter(k => {
      if (!k.id) return false; // «Произвольная» — отдельная кнопка внизу
      const mfg = (k.preset && k.preset.manufacturer) || '';
      if (state.mfg !== '__all__' && mfg !== state.mfg) return false;
      if (state.u !== '__all__' && k.preset.u !== +state.u) return false;
      if (q && !(k.sku.toLowerCase().includes(q)
               || k.name.toLowerCase().includes(q)
               || mfg.toLowerCase().includes(q))) return false;
      return true;
    });
    box.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Каталог базовых комплектов стоек</h3>
        <button type="button" class="rc-btn" id="rc-km-close-x">✕</button>
      </div>
      <div style="padding:12px 20px;display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end;border-bottom:1px solid var(--rs-border-soft)">
        <label class="rc-field"><span>Поиск</span>
          <input type="text" id="rc-km-search" value="${escape(state.search)}" placeholder="SKU, наименование, производитель…">
        </label>
        <label class="rc-field"><span>Производитель</span>
          <select id="rc-km-mfg">
            <option value="__all__" ${state.mfg==='__all__'?'selected':''}>Все</option>
            ${mfgs.map(m => `<option value="${escape(m)}" ${state.mfg===m?'selected':''}>${escape(m)}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Формат, U</span>
          <select id="rc-km-u">
            <option value="__all__" ${state.u==='__all__'?'selected':''}>Все</option>
            ${us.map(u => `<option value="${u}" ${String(state.u)===String(u)?'selected':''}>${u}U</option>`).join('')}
          </select>
        </label>
        <div class="muted" style="font-size:11px;padding-bottom:6px">Найдено: <b>${rows.length}</b></div>
      </div>
      <div style="overflow:auto;flex:1 1 auto;padding:4px 20px 12px 20px">
        <table class="rc-acc-table" style="margin-top:0">
          <thead><tr>
            <th>SKU</th><th>Наименование</th><th>Формат</th><th>Двери</th><th>Производитель</th><th style="width:90px"></th>
          </tr></thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Ничего не найдено.</td></tr>` :
              rows.map(k => {
                const sel = t.kitId === k.id;
                return `<tr${sel?' style="background:var(--rs-accent-bg)"':''}>
                  <td><code>${escape(k.sku)}</code></td>
                  <td>${escape(k.name)}</td>
                  <td>${k.preset.u}U ${k.preset.width}×${k.preset.depth}</td>
                  <td>${doorLbl(k)}</td>
                  <td>${escape((k.preset && k.preset.manufacturer) || '')}</td>
                  <td><button type="button" class="rc-btn ${sel?'rc-btn-primary':''}" data-km-pick="${escape(k.id)}">${sel?'✓ выбран':'Выбрать'}</button></td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;gap:8px">
        <button type="button" class="rc-btn" id="rc-km-clear">— Произвольная (без каталога) —</button>
        <button type="button" class="rc-btn" id="rc-km-cancel">Закрыть</button>
      </div>
    `;
    const close = () => back.remove();
    const pick = id => { current().kitId = id; applyKitPreset(); renderForm(); close(); };
    box.querySelector('#rc-km-close-x').addEventListener('click', close);
    box.querySelector('#rc-km-cancel').addEventListener('click', close);
    box.querySelector('#rc-km-clear').addEventListener('click', () => pick(''));
    box.querySelector('#rc-km-search').addEventListener('input', e => {
      state.search = e.target.value; render();
      const inp = box.querySelector('#rc-km-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    box.querySelector('#rc-km-mfg').addEventListener('change', e => { state.mfg = e.target.value; render(); });
    box.querySelector('#rc-km-u').addEventListener('change',   e => { state.u   = e.target.value; render(); });
    box.querySelectorAll('[data-km-pick]').forEach(btn =>
      btn.addEventListener('click', () => pick(btn.dataset.kmPick)));
  }
  render();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}

// Модал выбора PDU из каталога. Колонки: SKU | производитель | категория |
// фазы | номинал | высота | розетки. Фильтры: mfg, category, phases, rating.
function openPduCatalogModal(pdu) {
  const PDUS = getLivePduCatalog();
  const mfgs = Array.from(new Set(PDUS.map(p => p.mfg))).sort();
  const st = { search: '', mfg: '__all__', cat: '__all__', phases: '__all__' };

  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--rs-bg-card);color:var(--rs-fg);border-radius:10px;max-width:1040px;width:94%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  back.appendChild(box);
  document.body.appendChild(back);

  function render() {
    const q = st.search.trim().toLowerCase();
    const rows = PDUS.filter(p => {
      if (st.mfg !== '__all__' && p.mfg !== st.mfg) return false;
      if (st.cat !== '__all__' && p.category !== st.cat) return false;
      if (st.phases !== '__all__' && String(p.phases) !== st.phases) return false;
      if (q && !(p.sku.toLowerCase().includes(q)
               || p.name.toLowerCase().includes(q)
               || (PDU_CATEGORY[p.category]||'').toLowerCase().includes(q))) return false;
      return true;
    });
    box.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Каталог PDU</h3>
        <button type="button" class="rc-btn" id="rc-pm-close-x">✕</button>
      </div>
      <div style="padding:12px 20px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px;align-items:end;border-bottom:1px solid var(--rs-border-soft)">
        <label class="rc-field"><span>Поиск</span>
          <input type="text" id="rc-pm-search" value="${escape(st.search)}" placeholder="SKU, название, категория…">
        </label>
        <label class="rc-field"><span>Производитель</span>
          <select id="rc-pm-mfg">
            <option value="__all__" ${st.mfg==='__all__'?'selected':''}>Все</option>
            ${mfgs.map(m => `<option value="${escape(m)}" ${st.mfg===m?'selected':''}>${escape(m)}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Категория</span>
          <select id="rc-pm-cat">
            <option value="__all__" ${st.cat==='__all__'?'selected':''}>Все</option>
            ${Object.keys(PDU_CATEGORY).map(c => `<option value="${c}" ${st.cat===c?'selected':''}>${escape(PDU_CATEGORY[c])}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Фазы</span>
          <select id="rc-pm-ph">
            <option value="__all__" ${st.phases==='__all__'?'selected':''}>Все</option>
            <option value="1" ${st.phases==='1'?'selected':''}>1ф</option>
            <option value="3" ${st.phases==='3'?'selected':''}>3ф</option>
          </select>
        </label>
        <div class="muted" style="font-size:11px;padding-bottom:6px">Найдено: <b>${rows.length}</b></div>
      </div>
      <div style="overflow:auto;flex:1 1 auto;padding:4px 20px 12px 20px">
        <table class="rc-acc-table" style="margin-top:0">
          <thead><tr>
            <th>SKU</th><th>Наименование</th><th>Производитель</th><th>Категория</th><th>Фазы / A</th><th>Высота</th><th>Розетки</th><th style="width:90px"></th>
          </tr></thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Ничего не найдено.</td></tr>` :
              rows.map(p => {
                const sel = pdu.sku === p.sku;
                const outs = p.outlets.map(o => `${o.count}×${o.type}`).join(' + ');
                return `<tr${sel?' style="background:var(--rs-accent-bg)"':''}>
                  <td><code>${escape(p.sku)}</code></td>
                  <td>${escape(p.name)}</td>
                  <td>${escape(p.mfg)}</td>
                  <td>${escape(PDU_CATEGORY[p.category] || p.category)}</td>
                  <td>${p.phases}ф / ${p.rating} A</td>
                  <td>${p.height===0?'0U верт.':p.height+'U'}</td>
                  <td style="font-size:11px">${escape(outs)}</td>
                  <td><button type="button" class="rc-btn ${sel?'rc-btn-primary':''}" data-pm-pick="${escape(p.sku)}">${sel?'✓ выбран':'Выбрать'}</button></td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;gap:8px">
        <button type="button" class="rc-btn" id="rc-pm-clear">— Произвольная (лист требований) —</button>
        <button type="button" class="rc-btn" id="rc-pm-cancel">Закрыть</button>
      </div>
    `;
    const close = () => back.remove();
    const pick = sku => {
      pdu.sku = sku || '';
      const cat2 = sku ? pduBySku(sku) : null;
      if (cat2) {
        pdu.rating = cat2.rating;
        pdu.phases = cat2.phases;
        pdu.height = cat2.height;
        pdu.outlets = JSON.parse(JSON.stringify(cat2.outlets));
      }
      close();
      renderPduList(); recalc();
    };
    box.querySelector('#rc-pm-close-x').addEventListener('click', close);
    box.querySelector('#rc-pm-cancel').addEventListener('click', close);
    box.querySelector('#rc-pm-clear').addEventListener('click', () => pick(''));
    box.querySelector('#rc-pm-search').addEventListener('input', e => {
      st.search = e.target.value; render();
      const inp = box.querySelector('#rc-pm-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    box.querySelector('#rc-pm-mfg').addEventListener('change', e => { st.mfg = e.target.value; render(); });
    box.querySelector('#rc-pm-cat').addEventListener('change', e => { st.cat = e.target.value; render(); });
    box.querySelector('#rc-pm-ph').addEventListener('change',  e => { st.phases = e.target.value; render(); });
    box.querySelectorAll('[data-pm-pick]').forEach(btn =>
      btn.addEventListener('click', () => pick(btn.dataset.pmPick)));
  }
  render();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}
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
    if (kit.includes.includes('cableEntryTop')) items.push('вводы в крышу с щётками');
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
  renderKitBtn();
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
  el('rc-pdu-redundancy').value = t.pduRedundancy || '2N';
  el('rc-comment').value      = t.comment || '';
  if (!Array.isArray(t.accessories)) t.accessories = [];
  renderPduList();
  renderAccList();
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
  t.pduRedundancy = el('rc-pdu-redundancy').value || '2N';
  t.comment      = el('rc-comment').value;
}

/* ---------- аксессуары ---------- */

// Модальное окно выбора аксессуаров из каталога:
//   • текстовый поиск по SKU/названию/примечанию
//   • фильтр по производителю (по умолчанию — производитель текущего шкафа,
//     если распознан; чекбокс «показать все» снимает ограничение)
//   • фильтр по категории
//   • чекбоксы + поле количества для каждой позиции
//   • кнопка «Добавить выбранные» — переносит в t.accessories
function openAccessoryModal() {
  const t = current();
  const rackMfg = t.manufacturer || '';
  const ACCS = getLiveAccessoryCatalog();
  // какие аксессуары соответствуют бренду шкафа
  const matching = ACCS.filter(a => accessoryMatchesRackMfg(a, rackMfg));
  const restrictByMfg = matching.length > 0; // если ни одного совпадения — показываем все

  const state = {
    search: '',
    mfg:    restrictByMfg ? '__match__' : '__all__', // __match__ = только подходящие
    cat:    '__all__',
    picks:  {},  // sku → qty
  };

  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--rs-bg-card);color:var(--rs-fg);border-radius:10px;max-width:920px;width:92%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  back.appendChild(box);
  document.body.appendChild(back);

  const mfgs = accessoryMfgList();
  const cats = Object.keys(ACC_CATEGORIES);

  function render() {
    const q = state.search.trim().toLowerCase();
    const rows = ACCS.filter(a => {
      if (state.mfg === '__match__' && !accessoryMatchesRackMfg(a, rackMfg)) return false;
      if (state.mfg !== '__all__' && state.mfg !== '__match__' && a.mfg !== state.mfg) return false;
      if (state.cat !== '__all__' && a.category !== state.cat) return false;
      if (q && !(a.sku.toLowerCase().includes(q)
               || a.name.toLowerCase().includes(q)
               || (a.note||'').toLowerCase().includes(q))) return false;
      return true;
    });
    const pickedCount = Object.values(state.picks).filter(n => n > 0).length;
    box.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Каталог аксессуаров — выбор</h3>
        <button type="button" class="rc-btn" id="rc-am-close-x" title="Закрыть">✕</button>
      </div>
      <div style="padding:12px 20px;display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end;border-bottom:1px solid var(--rs-border-soft)">
        <label class="rc-field"><span>Поиск</span>
          <input type="text" id="rc-am-search" value="${escape(state.search)}" placeholder="SKU, название, примечание…">
        </label>
        <label class="rc-field"><span>Производитель</span>
          <select id="rc-am-mfg">
            ${restrictByMfg ? `<option value="__match__" ${state.mfg==='__match__'?'selected':''}>Только для «${escape(rackMfg)}»</option>` : ''}
            <option value="__all__" ${state.mfg==='__all__'?'selected':''}>Все производители</option>
            ${mfgs.map(m => `<option value="${escape(m)}" ${state.mfg===m?'selected':''}>${escape(m)}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Категория</span>
          <select id="rc-am-cat">
            <option value="__all__" ${state.cat==='__all__'?'selected':''}>Все</option>
            ${cats.map(c => `<option value="${escape(c)}" ${state.cat===c?'selected':''}>${escape(ACC_CATEGORIES[c])}</option>`).join('')}
          </select>
        </label>
        <div class="muted" style="font-size:11px;padding-bottom:6px">Найдено: <b>${rows.length}</b></div>
      </div>
      <div style="overflow:auto;flex:1 1 auto;padding:4px 20px 12px 20px">
        <table class="rc-acc-table" style="margin-top:0">
          <thead><tr>
            <th style="width:28px"></th>
            <th>Артикул</th>
            <th>Наименование</th>
            <th>Производитель</th>
            <th>Категория</th>
            <th style="width:80px">Кол-во</th>
          </tr></thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Ничего не найдено по фильтрам.</td></tr>` :
              rows.map(a => {
                const picked = state.picks[a.sku] || 0;
                return `<tr${picked>0?' style="background:var(--rs-accent-bg)"':''}>
                  <td><input type="checkbox" data-am-chk="${escape(a.sku)}" ${picked>0?'checked':''}></td>
                  <td><code>${escape(a.sku)}</code></td>
                  <td>${escape(a.name)}<br><span class="muted" style="font-size:11px">${escape(a.note || '')}</span></td>
                  <td>${escape(a.mfg)}</td>
                  <td>${escape(ACC_CATEGORIES[a.category] || a.category)}</td>
                  <td><input type="number" min="1" step="1" value="${picked>0?picked:1}" data-am-qty="${escape(a.sku)}" ${picked>0?'':'disabled'} style="width:70px"></td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="muted" style="font-size:12px">Выбрано позиций: <b>${pickedCount}</b></div>
        <div style="display:flex;gap:8px">
          <button type="button" class="rc-btn" id="rc-am-cancel">Отмена</button>
          <button type="button" class="rc-btn rc-btn-primary" id="rc-am-apply">Добавить выбранные</button>
        </div>
      </div>
    `;
    // bind
    const close = () => back.remove();
    box.querySelector('#rc-am-close-x').addEventListener('click', close);
    box.querySelector('#rc-am-cancel').addEventListener('click', close);
    box.querySelector('#rc-am-search').addEventListener('input', e => {
      state.search = e.target.value;
      render();
      // фокус обратно в поле поиска
      const inp = box.querySelector('#rc-am-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    box.querySelector('#rc-am-mfg').addEventListener('change', e => { state.mfg = e.target.value; render(); });
    box.querySelector('#rc-am-cat').addEventListener('change', e => { state.cat = e.target.value; render(); });
    box.querySelectorAll('[data-am-chk]').forEach(chk => {
      chk.addEventListener('change', e => {
        const sku = chk.dataset.amChk;
        if (e.target.checked) state.picks[sku] = state.picks[sku] || 1;
        else delete state.picks[sku];
        render();
      });
    });
    box.querySelectorAll('[data-am-qty]').forEach(inp => {
      inp.addEventListener('change', e => {
        const sku = inp.dataset.amQty;
        const v = Math.max(1, parseInt(inp.value, 10) || 1);
        if (state.picks[sku]) state.picks[sku] = v;
      });
    });
    box.querySelector('#rc-am-apply').addEventListener('click', () => {
      const t = current();
      if (!Array.isArray(t.accessories)) t.accessories = [];
      Object.keys(state.picks).forEach(sku => {
        const qty = state.picks[sku];
        if (!qty) return;
        const existing = t.accessories.find(a => a.sku === sku);
        if (existing) existing.qty = (existing.qty || 0) + qty;
        else t.accessories.push({ sku, qty });
      });
      close();
      renderAccList(); recalc();
    });
  }
  render();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}
function renderAccList() {
  const t = current();
  const host = el('rc-acc-list');
  if (!t.accessories || !t.accessories.length) {
    host.innerHTML = '<div class="muted" style="font-size:12px;margin-top:8px">Аксессуары не добавлены.</div>';
    return;
  }
  host.innerHTML = `
    <table class="rc-acc-table">
      <thead><tr><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th></th></tr></thead>
      <tbody>
        ${t.accessories.map((a, i) => {
          const meta = accBySku(a.sku);
          return `<tr>
            <td><code>${escape(a.sku)}</code></td>
            <td>${meta ? escape(meta.name) : '<i>(нет в каталоге)</i>'}<br><span class="muted" style="font-size:11px">${meta ? escape(meta.note || '') : ''}</span></td>
            <td><input type="number" min="1" step="1" value="${a.qty}" data-acc-qty="${i}" style="width:60px"></td>
            <td><button type="button" class="rc-btn rc-btn-danger rc-btn-mini" data-acc-del="${i}">✕</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  host.querySelectorAll('[data-acc-qty]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.accQty;
      t.accessories[i].qty = Math.max(1, parseInt(inp.value, 10) || 1);
      recalc();
    });
  });
  host.querySelectorAll('[data-acc-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.accDel;
      t.accessories.splice(i, 1);
      renderAccList(); recalc();
    });
  });
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
    if (!p.feed) p.feed = 'A';
    if (typeof p.sku !== 'string') p.sku = '';
    const cat = p.sku ? pduBySku(p.sku) : null;
    const locked = !!cat;
    const row = document.createElement('div');
    row.className = 'rc-pdu-item';
    const catLabel = cat
      ? `${cat.mfg} ${cat.sku} — ${PDU_CATEGORY[cat.category] || cat.category}`
      : '— Произвольная (лист требований) — открыть каталог…';
    row.innerHTML = `
      <div class="rc-pdu-catalog">
        <label class="rc-field" style="flex:1 1 100%" title="Открыть каталог PDU. При выборе поля номинала/фаз/высоты/розеток подставляются и блокируются.">
          <span>Каталог PDU</span>
          <button type="button" class="rc-catalog-btn" data-pdu-cat="${idx}">${escape(catLabel)}</button>
        </label>
        ${locked ? `<div class="rc-kit-includes"><b>${escape(cat.mfg)} ${escape(cat.sku)}:</b> ${escape(cat.name)} — <i>${escape(PDU_CATEGORY[cat.category] || cat.category)}</i></div>` : `<div class="muted" style="font-size:11px;margin-top:2px">Произвольная конфигурация — будет сгенерирован <b>лист требований</b> (спецификация) для закупки по ТЗ.</div>`}
      </div>
      <div class="rc-pdu-head">
        <label class="rc-field" title="К какому вводу электрической схемы подключён этот PDU. PDU на одном вводе суммируются, на разных — резервируют друг друга.">
          <span>Ввод</span>
          <select data-k="feed">
            ${['A','B','C','D'].map(f => `<option value="${f}" ${p.feed===f?'selected':''}>Ввод ${f}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Кол-во</span>
          <input type="number" min="1" step="1" data-k="qty" value="${p.qty}">
        </label>
        <label class="rc-field ${locked?'rc-locked':''}"><span>Номинал, А</span>
          <select data-k="rating" ${locked?'disabled':''}>
            ${[10,16,20,25,32,40,63].map(a => `<option value="${a}" ${p.rating===a?'selected':''}>${a} A</option>`).join('')}
          </select>
        </label>
        <label class="rc-field ${locked?'rc-locked':''}"><span>Фазы</span>
          <select data-k="phases" ${locked?'disabled':''}>
            <option value="1" ${p.phases===1?'selected':''}>1ф</option>
            <option value="3" ${p.phases===3?'selected':''}>3ф</option>
          </select>
        </label>
        <label class="rc-field ${locked?'rc-locked':''}"><span>Высота, U</span>
          <select data-k="height" ${locked?'disabled':''}>
            <option value="0" ${p.height===0?'selected':''}>0U (верт.)</option>
            <option value="1" ${p.height===1?'selected':''}>1U</option>
            <option value="2" ${p.height===2?'selected':''}>2U</option>
          </select>
        </label>
        <button type="button" class="rc-btn rc-btn-danger" data-del="${idx}" title="Удалить PDU">✕</button>
      </div>
      <div class="rc-pdu-outlets">
        <div class="rc-pdu-outlets-head">
          <b>Розетки${locked?' <span class="muted" style="font-weight:normal;font-size:11px">(из каталога)</span>':''}</b>
          <button type="button" class="rc-btn" data-add-outlet ${locked?'disabled':''}>+ тип</button>
        </div>
        <div class="rc-pdu-outlet-rows">
          ${p.outlets.map((o, oi) => `
            <div class="rc-pdu-outlet">
              <select data-ok="type" data-oi="${oi}" ${locked?'disabled':''}>
                ${['C13','C19','C13+C19','Schuko','NEMA 5-15','IEC 60309 16A','IEC 60309 32A','UK BS1363','разъём T-slot','смешанный'].map(x =>
                  `<option value="${x}" ${o.type===x?'selected':''}>${x}</option>`).join('')}
              </select>
              <input type="number" min="1" step="1" data-ok="count" data-oi="${oi}" value="${o.count}" title="Количество розеток этого типа" ${locked?'disabled':''}>
              <button type="button" class="rc-btn rc-btn-danger rc-btn-mini" data-del-outlet="${oi}" title="Удалить строку" ${locked?'disabled':''}>✕</button>
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
        else if (k === 'feed') p.feed = v;
        else p[k] = v;
        recalc();
      });
    });
    const catBtn = row.querySelector('[data-pdu-cat]');
    if (catBtn) catBtn.addEventListener('click', () => openPduCatalogModal(p));
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

// Возвращает {A: kW, B: kW, ...} — ёмкость PDU, сгруппированная по вводам.
function computePduCapacityByFeed(t) {
  const out = {};
  t.pdus.forEach(p => {
    const f = p.feed || 'A';
    out[f] = (out[f] || 0) + (p.qty || 1) * pduCapacityKw(p);
  });
  return out;
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

  // Кабельные вводы. У Kehua/APC/Rittal вводы в крышу с щётками обычно
  // входят в состав шкафа — в BOM отдельной строкой учитываем только
  // «лишние» и/или нижние. Если 'cableEntryTop' в комплекте — верхние
  // не считаем (только нижние и только если тип ≠ brush или
  // явно требуется другой тип).
  if (ENTRY_LABEL[t.entryType]) {
    const topIncluded = kit.includes.includes('cableEntryTop');
    const topQty = topIncluded ? 0 : (t.entryTop || 0);
    const botQty = t.entryBot || 0;
    const n = topQty + botQty;
    if (n > 0) add(ENTRY_LABEL[t.entryType], n, 'шт',
      topIncluded
        ? `снизу ${botQty} (сверху ${t.entryTop||0} в комплекте шкафа)`
        : `сверху ${t.entryTop||0}, снизу ${botQty}`);
    else if (topIncluded && (t.entryTop||0) > 0) {
      // все вводы — в комплекте, дополнительных не нужно; в BOM
      // информационной строкой не добавляем.
    }
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
    const cat = p.sku ? pduBySku(p.sku) : null;
    if (cat) {
      add(`${cat.name} (${cat.sku})`, p.qty, 'шт',
          `${cat.mfg} · ${PDU_CATEGORY[cat.category] || cat.category} · ввод ${p.feed}`);
    } else {
      const name = `PDU ${p.phases}ф ${p.rating}A, ${totalOutlets} розеток (${outletsDesc}), ${hStr}`;
      add(name, p.qty, 'шт',
          `ввод ${p.feed} · произвольная спецификация (см. «Лист требований»)`);
    }
  });

  // T-сплиттер / распределитель когда на один ввод приходится 2+ PDU:
  // в шкаф с 2 вводами ставят 4 PDU (по 2 на ввод), физически один кабель
  // с ввода расщепляется T-коннектором или клипс-боксом.
  const byFeedCount = {};
  t.pdus.forEach(p => {
    const total = p.qty || 1;
    byFeedCount[p.feed] = (byFeedCount[p.feed] || 0) + total;
  });
  Object.keys(byFeedCount).forEach(f => {
    if (byFeedCount[f] >= 2) {
      const maxA = Math.max(...t.pdus.filter(x => x.feed === f).map(x => x.rating || 16));
      const is3ph = t.pdus.some(x => x.feed === f && x.phases === 3);
      add(`Распределитель питания (T-сплиттер / клипс-бокс) IEC 60309 ${is3ph?'3ф':'1ф'} ${maxA}A`,
          1, 'шт', `ввод ${f}: ${byFeedCount[f]} PDU на одном кабеле от основной схемы`);
    }
  });

  // Монтажный крепёж
  const screws = Math.max(20, (t.u - free) * 4 + 20);
  add('Комплект крепежа M6 (болт+гайка+шайба)', screws, 'шт', 'монтажный');

  // Дополнительные аксессуары (Kehua Wise и т.п.)
  if (Array.isArray(t.accessories)) {
    t.accessories.forEach(a => {
      const meta = accBySku(a.sku);
      const name = meta ? `${meta.name} (${a.sku})` : a.sku;
      const note = meta ? [meta.mfg, meta.note].filter(Boolean).join(' · ') : '';
      add(name, a.qty || 1, 'шт', note);
    });
  }

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

  // PDU capacity vs demand — с учётом режима резервирования и вводов
  const byFeed = computePduCapacityByFeed(t);
  const sumCap = Object.values(byFeed).reduce((s, v) => s + v, 0);
  const feeds = Object.keys(byFeed).sort();
  const mode = t.pduRedundancy || '2N';
  if (t.demandKw > 0) {
    if (mode === '2N') {
      // каждый ввод должен в одиночку покрывать demandKw
      const weakFeeds = feeds.filter(f => byFeed[f] + 1e-6 < t.demandKw);
      if (feeds.length < 2) {
        out.push({ lvl: 'warn',
          msg: `Режим 2N подразумевает минимум два ввода (A+B). Сейчас PDU распределены только по вводам: ${feeds.join(', ') || '—'}.` });
      }
      if (weakFeeds.length) {
        out.push({ lvl: 'err',
          msg: `Режим 2N: ввод${weakFeeds.length>1?'ы':''} ${weakFeeds.join(', ')} не покрывает ${t.demandKw} кВт в одиночку ` +
               `(${weakFeeds.map(f => `${f}: ${byFeed[f].toFixed(2)} кВт`).join('; ')}). При отказе второго ввода стойка обесточится.` });
      } else if (feeds.length >= 2) {
        const minCap = Math.min(...feeds.map(f => byFeed[f]));
        out.push({ lvl: 'ok',
          msg: `2N: каждый ввод в одиночку обеспечивает ≥${t.demandKw} кВт (минимум ${minCap.toFixed(2)} кВт). Суммарная ёмкость ${sumCap.toFixed(2)} кВт в мощность не засчитывается дважды.` });
      }
    } else if (mode === 'n+1') {
      // после выпадения самого «жирного» ввода оставшиеся должны покрыть demandKw
      if (feeds.length < 2) {
        out.push({ lvl: 'err',
          msg: `Режим N+1 требует минимум двух вводов. Сейчас один.` });
      } else {
        const maxFeed = Math.max(...feeds.map(f => byFeed[f]));
        const remaining = sumCap - maxFeed;
        if (remaining + 1e-6 < t.demandKw) {
          out.push({ lvl: 'err',
            msg: `N+1: после отказа «жирного» ввода остаётся ${remaining.toFixed(2)} кВт < ${t.demandKw} кВт.` });
        } else {
          out.push({ lvl: 'ok',
            msg: `N+1: после отказа «жирного» ввода остаётся ${remaining.toFixed(2)} кВт ≥ ${t.demandKw} кВт.` });
        }
      }
    } else {
      // none — суммируем
      if (sumCap + 1e-6 < t.demandKw) {
        out.push({ lvl: 'err',
          msg: `Суммарная ёмкость PDU ${sumCap.toFixed(2)} кВт < заявленная ${t.demandKw} кВт.` });
      } else {
        out.push({ lvl: 'ok',
          msg: `Одиночное питание: сумма PDU ${sumCap.toFixed(2)} кВт ≥ ${t.demandKw} кВт.` });
      }
    }
  }

  // v0.59.106: требуемая мощность на один ввод зависит от режима резервирования.
  //   2N  → каждый ввод несёт полную demandKw (второй в горячем резерве).
  //   N+1 → после выпадения одного ввода оставшиеся (N−1) должны покрыть demandKw,
  //         значит при равных вводах нужно demandKw / (N−1) на каждом.
  //   none → пропорционально ёмкости PDU (или demandKw / N при отсутствии данных).
  const neededPerFeed = {};
  feeds.forEach(f => {
    if (mode === '2N' || mode === '2n') {
      neededPerFeed[f] = t.demandKw;
    } else if (mode === 'n+1') {
      const nMinus1 = Math.max(1, feeds.length - 1);
      neededPerFeed[f] = t.demandKw / nMinus1;
    } else {
      neededPerFeed[f] = sumCap > 0
        ? t.demandKw * (byFeed[f] / sumCap)
        : (feeds.length ? t.demandKw / feeds.length : 0);
    }
  });

  // v0.59.104: проверка запаса PDU. Для 2N/N+1 занижение уже ловится
  // модой-специфичной проверкой выше (weakFeeds / remaining < demandKw),
  // дублировать err не нужно. Во всех режимах добавляем warn о перезапасе
  // (PDU > 1.8×needed — рекомендуем меньший типоразмер). Для 'none'
  // занижение PDU уже ловит общий `Σ < demandKw`, но per-feed здесь полезно.
  feeds.forEach(f => {
    const need = neededPerFeed[f] || 0;
    if (need <= 0) return;
    const redMode = (mode === '2N' || mode === '2n' || mode === 'n+1');
    if (!redMode && byFeed[f] + 1e-6 < need) {
      out.push({ lvl: 'err',
        msg: `Ввод ${f}: номинал PDU ${byFeed[f].toFixed(2)} кВт меньше требуемой нагрузки ${need.toFixed(2)} кВт — не хватит запитать оборудование.` });
    } else if (byFeed[f] > need * 1.8 + 1e-6) {
      // v0.59.105: не ругаемся на «завышение» если сама нагрузка мала
      // (< 3 кВт) или PDU уже минимальный практический (≤ 4 кВт ≈ 16 A 1ф) —
      // ниже этого уровня выбор номиналов ограничен каталожной сеткой.
      if (need >= 3 && byFeed[f] > 4) {
        out.push({ lvl: 'warn',
          msg: `Ввод ${f}: номинал PDU ${byFeed[f].toFixed(2)} кВт сильно завышен относительно нагрузки ${need.toFixed(2)} кВт (>80% запаса) — можно подобрать меньший типоразмер.` });
      }
    }
  });

  // Сверка с реальными вводами из электрической схемы (если есть)
  if (Array.isArray(t.feeds) && t.feeds.length) {
    const schemaFeeds = {}; // feedLabel → availableKw
    t.feeds.forEach((f, i) => {
      const label = f.label || String.fromCharCode(65 + i); // A, B, …
      schemaFeeds[label] = Number(f.availableKw) || 0;
    });
    // v0.59.101: сверяем доступную мощность ввода из схемы с ТРЕБУЕМОЙ нагрузкой
    // (не с номиналом PDU). PDU обычно имеет запас над нагрузкой, что нормально.
    // Критично — если сам ввод не тянет нагрузку.
    Object.keys(byFeed).forEach(f => {
      const avail = schemaFeeds[f];
      if (avail == null) {
        out.push({ lvl: 'warn',
          msg: `Ввод ${f}: PDU настроены, но в электрической схеме такого ввода у узла нет. Проверьте приоритеты входных портов.` });
        return;
      }
      const need = neededPerFeed[f] || 0;
      if (need > avail + 1e-6) {
        out.push({ lvl: 'err',
          msg: `Ввод ${f}: в схеме доступно ${avail.toFixed(2)} кВт, а требуемая нагрузка на ввод — ${need.toFixed(2)} кВт. Ввод не потянет нагрузку стойки.` });
      }
    });
    // PDU не привязан к существующему вводу
    Object.keys(schemaFeeds).forEach(f => {
      if (byFeed[f] == null) {
        out.push({ lvl: 'warn',
          msg: `Ввод ${f}: в электрической схеме доступно ${schemaFeeds[f].toFixed(2)} кВт, но PDU на этот ввод не назначены.` });
      }
    });
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
function renderFeedInfo() {
  const t = current();
  const host = el('rc-feed-info');
  if (!host) return;
  const byFeed = computePduCapacityByFeed(t);
  const schemaFeeds = Array.isArray(t.feeds) ? t.feeds : [];
  if (!schemaFeeds.length && !Object.keys(byFeed).length) {
    host.innerHTML = '';
    return;
  }
  const rows = [];
  const feedLabels = new Set([
    ...Object.keys(byFeed),
    ...schemaFeeds.map((f, i) => f.label || String.fromCharCode(65 + i)),
  ]);
  // v0.59.101: та же логика что в computeWarnings — PDU должен быть ≥ нагрузки,
  // а ввод схемы должен давать ≥ нагрузки. Сравнение PDU vs avail не имеет смысла:
  // PDU с запасом над нагрузкой — нормальная практика.
  const feedsInByFeed = Object.keys(byFeed);
  const sumCap = Object.values(byFeed).reduce((s, v) => s + v, 0);
  const mode = t.pduRedundancy || '2N';
  const needOf = (lbl) => {
    if (!(lbl in byFeed) || !t.demandKw) return 0;
    if (mode === '2N' || mode === '2n') return t.demandKw;
    if (mode === 'n+1') {
      const nMinus1 = Math.max(1, feedsInByFeed.length - 1);
      return t.demandKw / nMinus1;
    }
    return sumCap > 0 ? t.demandKw * (byFeed[lbl] / sumCap)
                      : (feedsInByFeed.length ? t.demandKw / feedsInByFeed.length : 0);
  };
  Array.from(feedLabels).sort().forEach(lbl => {
    const pduKw = byFeed[lbl] || 0;
    const schemaF = schemaFeeds.find((f, i) => (f.label || String.fromCharCode(65 + i)) === lbl);
    const availKw = schemaF ? Number(schemaF.availableKw) || 0 : null;
    const prio = schemaF ? schemaF.priority : null;
    const need = needOf(lbl);
    let badge;
    if (availKw == null) {
      badge = `<span class="rc-feed-pill warn">только PDU</span>`;
    } else if (need > 0 && pduKw + 1e-6 < need) {
      badge = `<span class="rc-feed-pill err">PDU &lt; нагрузки</span>`;
    } else if (need > 0 && need > availKw + 1e-6) {
      badge = `<span class="rc-feed-pill err">ввод &lt; нагрузки</span>`;
    } else if (need >= 3 && pduKw > 4 && pduKw > need * 1.8 + 1e-6) {
      badge = `<span class="rc-feed-pill warn">PDU завышен</span>`;
    } else {
      badge = `<span class="rc-feed-pill ok">OK</span>`;
    }
    rows.push(`
      <tr>
        <td><b>Ввод ${lbl}</b>${prio != null ? ` <span class="muted">(P${prio})</span>` : ''}</td>
        <td>PDU: ${pduKw.toFixed(2)} кВт${need > 0 ? ` <span class="muted">(нужно ${need.toFixed(2)})</span>` : ''}</td>
        <td>${availKw != null ? 'Доступно: ' + availKw.toFixed(2) + ' кВт' : '<span class="muted">не привязан к схеме</span>'}</td>
        <td>${badge}</td>
      </tr>`);
  });
  host.innerHTML = `
    <table class="rc-feed-table">
      <thead><tr><th>Ввод</th><th>PDU</th><th>Схема</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${schemaFeeds.length
      ? `<div class="muted" style="font-size:11px;margin-top:4px">Доступная мощность взята из основной схемы (узел ${escape(state.nodeId || '')}).</div>`
      : `<div class="muted" style="font-size:11px;margin-top:4px">Конфигуратор открыт без связи с узлом схемы — проверка по реальным вводам не выполняется.</div>`}
  `;
}

function recalc() {
  const t = current();
  if (!t) return;
  el('rc-free').value = Math.max(0, t.u - t.occupied);
  applyKitLocks();
  renderFeedInfo();
  renderWarnings();
  renderBom();
}

/* ---------- лист требований на PDU (technical spec sheet) ----------
   Для каждого PDU (в первую очередь — произвольной конфигурации без sku)
   выводим текстовое ТЗ: номинал, фазы, кол-во и типы розеток, требуемый
   функционал (basic/metered/…), ввод схемы, мин. мощность. Такой лист
   отправляется поставщику для подбора эквивалента.                    */
function buildPduRequirements() {
  const t = current();
  const lines = [];
  lines.push(`ЛИСТ ТРЕБОВАНИЙ НА PDU — шкаф «${t.name || '—'}»`);
  lines.push(`Заявленная мощность стойки: ${t.demandKw} кВт, cos φ ${t.cosphi}`);
  lines.push(`Режим резервирования: ${
    t.pduRedundancy === '2N' ? '2N (каждый ввод 100 %)' :
    t.pduRedundancy === 'n+1' ? 'N+1 (допустим отказ одного ввода)' :
    'без резервирования'}`);
  lines.push('');
  t.pdus.forEach((p, i) => {
    const cat = p.sku ? pduBySku(p.sku) : null;
    const kw  = (p.qty || 1) * pduCapacityKw(p);
    const outletsDesc = p.outlets.map(o => `${o.count}×${o.type}`).join(' + ');
    const totalOutlets = p.outlets.reduce((s,o)=>s+(+o.count||0),0);
    lines.push(`── PDU #${i+1} (ввод ${p.feed}, ${p.qty} шт) ──`);
    if (cat) {
      lines.push(`  Каталожная позиция: ${cat.mfg} ${cat.sku}`);
      lines.push(`  Наименование:       ${cat.name}`);
      lines.push(`  Функционал:         ${PDU_CATEGORY[cat.category] || cat.category}`);
    } else {
      lines.push(`  Подбор эквивалента по ТЗ. Аналоги: APC AP79xx/AP89xx,`);
      lines.push(`  Rittal DK 7955.xxx, Raritan PX3, Kehua KPDU-*.`);
    }
    lines.push(`  Номинал:            ${p.rating} A, ${p.phases}-фазный, 230/400 В`);
    lines.push(`  Высота:             ${p.height === 0 ? '0U (вертикальный, на боковине)' : p.height + 'U (горизонтальный)'}`);
    lines.push(`  Розетки:            ${totalOutlets} шт. (${outletsDesc})`);
    lines.push(`  Расчётная ёмкость:  ${kw.toFixed(2)} кВт (при cos φ ${t.cosphi})`);
    lines.push(`  Входной разъём:     IEC 60309 ${p.phases===3?'3P+N+PE 32A':'P+N+PE 16A'} (уточнить по длине кабеля)`);
    lines.push(`  Требования к шнуру: 3 м, cord-retention, сертификат по ГОСТ IEC 60884-1`);
    if (!cat) {
      lines.push(`  Доп. требования:    укажите желаемый функционал —`);
      lines.push(`                      basic / metered / monitored / switched / hybrid`);
    }
    lines.push('');
  });
  // распределители
  const byFeedCount = {};
  t.pdus.forEach(p => { byFeedCount[p.feed] = (byFeedCount[p.feed] || 0) + (p.qty || 1); });
  Object.keys(byFeedCount).forEach(f => {
    if (byFeedCount[f] >= 2) {
      lines.push(`⚠ Ввод ${f}: ${byFeedCount[f]} PDU на одном вводе — требуется T-сплиттер`);
      lines.push(`   или клипс-бокс IEC 60309 на входе в шкаф (один кабель от схемы).`);
      lines.push('');
    }
  });
  lines.push(`Сгенерировано автоматически rack-config v${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}.`);
  return lines.join('\n');
}
function exportPduSpec() {
  const txt = buildPduRequirements();
  const t = current();
  const blob = new Blob(['\uFEFF' + txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pdu-spec-${(t.name||'tpl').replace(/[^\wа-яА-Я\-]/g,'_')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function showPduSpec() {
  const txt = buildPduRequirements();
  // простой модал
  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--rs-bg-card);color:var(--rs-fg);border-radius:10px;max-width:720px;width:90%;max-height:80vh;overflow:auto;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.4)';
  box.innerHTML = `
    <h3 style="margin:0 0 10px 0">Лист требований на PDU</h3>
    <pre style="font:12px/1.45 var(--rs-font-mono, monospace);white-space:pre-wrap;background:var(--rs-bg-soft);padding:12px;border-radius:6px;border:1px solid var(--rs-border-soft)">${escape(txt)}</pre>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button type="button" class="rc-btn" id="rc-pdu-spec-copy">📋 Скопировать</button>
      <button type="button" class="rc-btn" id="rc-pdu-spec-dl">⬇ Скачать .txt</button>
      <button type="button" class="rc-btn rc-btn-primary" id="rc-pdu-spec-close">Закрыть</button>
    </div>`;
  back.appendChild(box);
  document.body.appendChild(back);
  box.querySelector('#rc-pdu-spec-close').addEventListener('click', () => back.remove());
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  box.querySelector('#rc-pdu-spec-dl').addEventListener('click', exportPduSpec);
  box.querySelector('#rc-pdu-spec-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(txt).then(() => {
      const b = box.querySelector('#rc-pdu-spec-copy');
      b.textContent = '✓ Скопировано';
      setTimeout(() => { b.textContent = '📋 Скопировать'; }, 1500);
    });
  });
}

/* ---------- сдвоить PDU на каждом вводе ---------- */
function duplicatePdusPerFeed() {
  const t = current();
  // группируем существующие PDU по вводам
  const byFeed = {};
  t.pdus.forEach(p => { (byFeed[p.feed] = byFeed[p.feed] || []).push(p); });
  const feeds = Object.keys(byFeed);
  if (!feeds.length) { alert('Нет PDU для дублирования.'); return; }
  if (!confirm(
    `На каждом из ${feeds.length} вводов (${feeds.join(', ')}) будет добавлена по одной копии PDU — всего +${feeds.length} шт.\n\n` +
    `Это типовая схема «2 PDU на ввод»: один кабель от основной схемы расщепляется в шкафу через T-сплиттер / клипс-бокс IEC 60309. ` +
    `В BOM автоматически добавится распределитель на каждый ввод.\n\nПродолжить?`)) return;
  feeds.forEach(f => {
    const src = byFeed[f][0];
    t.pdus.push(JSON.parse(JSON.stringify({
      ...src,
      id: 'pdu' + Date.now() + '-' + f,
      qty: 1,
    })));
  });
  renderPduList(); recalc();
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
    'rc-occupied','rc-blank-type','rc-demand-kw','rc-cosphi',
    'rc-pdu-redundancy','rc-comment'];
  ids.forEach(id => {
    const node = el(id);
    if (!node) return;
    node.addEventListener('change', () => { readForm(); renderTemplateList(); recalc(); });
  });

  const kitBtn = el('rc-kit-btn');
  if (kitBtn) kitBtn.addEventListener('click', () => { readForm(); openKitCatalogModal(); });

  el('rc-template').addEventListener('change', () => {
    state.currentId = el('rc-template').value;
    renderForm();
  });
  el('rc-new').addEventListener('click', () => addTemplate(null));
  el('rc-dup').addEventListener('click', () => { readForm(); addTemplate(current()); });
  el('rc-del').addEventListener('click', deleteTemplate);
  const specBtn = el('rc-pdu-spec');
  if (specBtn) specBtn.addEventListener('click', () => { readForm(); showPduSpec(); });
  const dupBtn = el('rc-pdu-duplicate');
  if (dupBtn) dupBtn.addEventListener('click', duplicatePdusPerFeed);
  el('rc-pdu-add').addEventListener('click', () => {
    const t = current();
    // чередуем feed A/B/C/… чтобы новый PDU попадал на следующий ввод
    const used = t.pdus.map(p => p.feed || 'A');
    const order = ['A','B','C','D'];
    const nextFeed = order.find(f => !used.includes(f)) || order[used.length % 4];
    t.pdus.push({ id: 'pdu'+Date.now(), qty:1, rating:16, phases:1, height:0,
      feed: nextFeed, outlets: [ { type: 'C13', count: 8 } ] });
    renderPduList(); recalc();
  });

  const accOpen = el('rc-acc-open');
  if (accOpen) accOpen.addEventListener('click', () => { readForm(); openAccessoryModal(); });

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
  renderKitBtn();
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
      // feeds — список вводов из электрической схемы, мост передаёт
      // отдельно в bridge.feeds (актуальная информация, которая могла
      // измениться после того как шаблон был сохранён)
      if (Array.isArray(bridge.feeds)) t.feeds = bridge.feeds;
      // убеждаемся, что шаблон есть в списке или подменяем первый
      const ix = state.templates.findIndex(x => x.id === t.id);
      if (ix >= 0) state.templates[ix] = t;
      else state.templates.unshift(t);
      state.currentId = t.id;
    } else if (bridge && Array.isArray(bridge.feeds)) {
      // шаблона ещё нет, но вводы схемы есть — подставляем в первый шаблон
      state.currentId = state.templates[0].id;
      const t0 = current();
      if (t0) t0.feeds = bridge.feeds;
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
