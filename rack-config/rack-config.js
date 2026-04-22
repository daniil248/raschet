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
import { openPduPickerModal } from '../shared/pdu-picker-modal.js';
import { rsToast, rsConfirm } from '../shared/dialog.js';
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
function makeBlankTemplate(name = 'Новый шкаф') {
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
  catch (e) { rsToast('Не удалось сохранить: ' + e.message, 'err'); }
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
  const widths = Array.from(new Set(KITS.filter(k => k.id).map(k => k.preset.width))).sort((a,b) => a-b);
  const depths = Array.from(new Set(KITS.filter(k => k.id).map(k => k.preset.depth))).sort((a,b) => a-b);
  // v0.59.110: предустановка фильтров из текущих параметров шаблона, если
  // пользователь уже задал U/ширину/глубину. Каталог сразу сузится до
  // совместимых моделей.
  const state = {
    search: '',
    mfg: '__all__',
    u: us.includes(t.u) ? String(t.u) : '__all__',
    width: widths.includes(t.width) ? String(t.width) : '__all__',
    depth: depths.includes(t.depth) ? String(t.depth) : '__all__',
  };

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
  // v0.59.118: score 0–100 — насколько kit совпадает с параметрами шаблона.
  // U(25) + width(20) + depth(15) + doorF/R(10+10) + sides(5) + top(5) +
  // base(5) + manufacturer match(5). 'any' у пользователя = полный балл.
  function scoreKit(k) {
    const p = k.preset || {};
    let s = 0;
    // U — точно = 25, в ±3U = 15, иначе 0
    if (t.u && p.u != null) {
      if (+p.u === +t.u) s += 25;
      else if (Math.abs(+p.u - +t.u) <= 3) s += 15;
    } else s += 12;
    // width — точно = 20; 'any' у пользователя = 20
    if (t.width === 'any' || !t.width) s += 20;
    else if (+p.width === +t.width) s += 20;
    // depth — точно = 15, в ±200 = 8; 'any' = 15
    if (t.depth === 'any' || !t.depth) s += 15;
    else if (+p.depth === +t.depth) s += 15;
    else if (Math.abs(+p.depth - +t.depth) <= 200) s += 8;
    // doors, walls, top, base — exact match или 'any' у юзера
    const tol = (user, preset, pts) => {
      if (!user || user === 'any') return pts;
      if (preset == null) return pts * 0.5;
      return user === preset ? pts : 0;
    };
    s += tol(t.doorFront, p.doorFront, 10);
    s += tol(t.doorRear,  p.doorRear,  10);
    s += tol(t.sides,     p.sides,     5);
    s += tol(t.top,       p.top,       5);
    s += tol(t.base,      p.base,      5);
    // manufacturer — partial match (включение подстроки в обе стороны)
    const userMfg = (t.manufacturer || '').trim().toLowerCase();
    const kitMfg  = ((p && p.manufacturer) || '').trim().toLowerCase();
    if (!userMfg) s += 5;
    else if (kitMfg.includes(userMfg) || userMfg.includes(kitMfg)) s += 5;
    return Math.min(100, Math.round(s));
  }
  function render() {
    const q = state.search.trim().toLowerCase();
    const rows = KITS.filter(k => {
      if (!k.id) return false; // «Произвольная» — отдельная кнопка внизу
      const mfg = (k.preset && k.preset.manufacturer) || '';
      if (state.mfg !== '__all__' && mfg !== state.mfg) return false;
      if (state.u !== '__all__' && k.preset.u !== +state.u) return false;
      if (state.width !== '__all__' && k.preset.width !== +state.width) return false;
      if (state.depth !== '__all__' && k.preset.depth !== +state.depth) return false;
      if (q && !(k.sku.toLowerCase().includes(q)
               || k.name.toLowerCase().includes(q)
               || mfg.toLowerCase().includes(q))) return false;
      return true;
    }).map(k => ({ k, score: scoreKit(k) }))
      .sort((a, b) => b.score - a.score);
    box.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--rs-border-soft);display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Каталог базовых комплектов стоек</h3>
        <button type="button" class="rc-btn" id="rc-km-close-x">✕</button>
      </div>
      <div style="padding:12px 20px;display:grid;grid-template-columns:2fr 1fr 0.7fr 0.9fr 0.9fr auto;gap:10px;align-items:end;border-bottom:1px solid var(--rs-border-soft)">
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
        <label class="rc-field"><span>Ширина, мм</span>
          <select id="rc-km-w">
            <option value="__all__" ${state.width==='__all__'?'selected':''}>Все</option>
            ${widths.map(w => `<option value="${w}" ${String(state.width)===String(w)?'selected':''}>${w}</option>`).join('')}
          </select>
        </label>
        <label class="rc-field"><span>Глубина, мм</span>
          <select id="rc-km-d">
            <option value="__all__" ${state.depth==='__all__'?'selected':''}>Все</option>
            ${depths.map(d => `<option value="${d}" ${String(state.depth)===String(d)?'selected':''}>${d}</option>`).join('')}
          </select>
        </label>
        <div class="muted" style="font-size:11px;padding-bottom:6px">Найдено: <b>${rows.length}</b></div>
      </div>
      <div style="overflow:auto;flex:1 1 auto;padding:4px 20px 12px 20px">
        <style>
          .rc-km-bar { display:inline-block;width:50px;height:5px;background:#eee;border-radius:3px;overflow:hidden;margin-left:6px;vertical-align:middle }
          .rc-km-bar > i { display:block;height:100%;background:#4caf50 }
        </style>
        <table class="rc-acc-table" style="margin-top:0">
          <thead><tr>
            <th>SKU</th><th>Наименование</th><th>Формат</th><th>Двери</th><th>Производитель</th><th>Score</th><th style="width:90px"></th>
          </tr></thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Ничего не найдено.</td></tr>` :
              rows.map(({ k, score }) => {
                const sel = t.kitId === k.id;
                return `<tr${sel?' style="background:var(--rs-accent-bg)"':''}>
                  <td><code>${escape(k.sku)}</code></td>
                  <td>${escape(k.name)}</td>
                  <td>${k.preset.u}U ${k.preset.width}×${k.preset.depth}</td>
                  <td>${doorLbl(k)}</td>
                  <td>${escape((k.preset && k.preset.manufacturer) || '')}</td>
                  <td style="white-space:nowrap"><b>${score}</b><span class="rc-km-bar"><i style="width:${score}%"></i></span></td>
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
    box.querySelector('#rc-km-w').addEventListener('change',   e => { state.width = e.target.value; render(); });
    box.querySelector('#rc-km-d').addEventListener('change',   e => { state.depth = e.target.value; render(); });
    box.querySelectorAll('[data-km-pick]').forEach(btn =>
      btn.addEventListener('click', () => pick(btn.dataset.kmPick)));
  }
  render();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}

// Модал выбора PDU из каталога. v0.59.117 — теперь использует общий
// shared/pdu-picker-modal.js (тот же движок, что в standalone-модуле
// /pdu-config/): ранжирование по score, требования «номинал ≥», розетки
// «C13 ≥ / C19 ≥ / Schuko ≥», фильтр по производителю-чипсам, категория.
// Сверху навешены rack-config-специфичные опции: «Парой на A+B» + цвет.
// -------------------- Wizard modal: встраивает /pdu-config/ в iframe --------------------
function openPduWizardModal(pduIdx) {
  // Снимаем предыдущую модалку если есть
  document.querySelectorAll('.rc-pdu-wizard-modal').forEach(n => n.remove());
  const overlay = document.createElement('div');
  overlay.className = 'rc-pdu-wizard-modal';
  overlay.innerHTML = `
    <div class="rc-pdu-wizard-backdrop"></div>
    <div class="rc-pdu-wizard-panel">
      <div class="rc-pdu-wizard-head">
        <b>🧙 Конфигуратор PDU</b>
        <span class="muted" style="font-size:11px;margin-left:8px">
          Задайте контекст и требования; когда закончите — нажмите «Применить» и значения вернутся в PDU#${pduIdx + 1}.
        </span>
        <span style="flex:1"></span>
        <button type="button" class="rc-btn" data-act="close">✕ Закрыть</button>
      </div>
      <iframe class="rc-pdu-wizard-iframe" src="../pdu-config/?embed=1&amp;pduIdx=${pduIdx}"></iframe>
    </div>
  `;
  document.body.appendChild(overlay);
  // Помощь «?» остаётся доступна поверх модалки: поднимаем её z-index выше оверлея (10001 → 10060) и сдвигаем выше, чтобы не перекрывать нижние кнопки iframe «Применить/Закрыть».
  const helpFab = document.querySelector('.rs-help-fab');
  const prevFab = helpFab ? { z: helpFab.style.zIndex, b: helpFab.style.bottom } : null;
  if (helpFab) { helpFab.style.zIndex = '10060'; helpFab.style.bottom = '92px'; }
  const close = () => { overlay.remove(); window.removeEventListener('message', onMsg); if (helpFab && prevFab) { helpFab.style.zIndex = prevFab.z; helpFab.style.bottom = prevFab.b; } };
  overlay.querySelector('[data-act="close"]').onclick = close;
  overlay.querySelector('.rc-pdu-wizard-backdrop').onclick = close;

  function onMsg(ev) {
    const d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'pdu-config:close') { close(); return; }
    if (d.type !== 'pdu-config:apply') return;
    applyPduPayload(pduIdx, d.payload);
    close();
  }
  window.addEventListener('message', onMsg);
}

function applyPduPayload(pduIdx, payload) {
  if (!payload) return;
  const t = current();
  const p = t.pdus[pduIdx];
  if (!p) return;
  if (payload.rating)  p.rating  = Number(payload.rating)  || p.rating;
  if (payload.phases)  p.phases  = Number(payload.phases)  || p.phases;
  if (payload.height !== undefined) p.height = Number(payload.height) || 0;
  if (Array.isArray(payload.outlets) && payload.outlets.length) {
    p.outlets = payload.outlets.map(o => ({ type: o.type, count: Number(o.count) || 1 }));
  }
  if (payload.requirementsOnly) {
    p.sku = '';
    p._requirements = {
      label: payload.label || '',
      category: payload.category || '',
      context: payload.context || null,
      savedAt: Date.now(),
    };
  } else if (payload.sku) {
    p.sku = payload.sku;
    delete p._requirements;
  }
  try { localStorage.setItem('raschet.lastPduConfig.v1', JSON.stringify({ ...payload, selectedAt: Date.now() })); } catch {}
  renderPduList();
  recalc();
}

function renderPduReqsBlock(host, pdu, pduIdx) {
  const outletsStr = (pdu.outlets || []).filter(o => o.count > 0)
    .map(o => `${o.type}×${o.count}`).join(', ') || '—';
  const heightStr = pdu.height === 0 ? '0U (верт.)' : (pdu.height ? pdu.height + 'U' : '—');
  const ratingStr = pdu.rating ? `${pdu.rating} A` : '—';
  const phasesStr = pdu.phases ? `${pdu.phases}ф` : '—';
  const qtyStr = pdu.qty ? pdu.qty : 1;

  if (pdu.sku) {
    const cat = pduBySku(pdu.sku);
    if (cat) {
      host.innerHTML = `
        <div class="rc-pdu-req-card rc-pdu-req-sku">
          <div><b>✓ Модель выбрана:</b> ${escape(cat.mfg)} <code>${escape(cat.sku)}</code> — ${escape(cat.name)}</div>
          <div class="rc-pdu-req-grid">
            <div><span>Кол-во</span><b>${qtyStr}</b></div>
            <div><span>Номинал</span><b>${ratingStr}</b></div>
            <div><span>Фаз</span><b>${phasesStr}</b></div>
            <div><span>Высота</span><b>${heightStr}</b></div>
            <div class="rc-pdu-req-full"><span>Розетки</span><b>${escape(outletsStr)}</b></div>
          </div>
          <div class="muted" style="font-size:11px;margin-top:4px">В спецификации — с артикулом ${escape(cat.sku)}. Чтобы изменить — откройте «🧙 Конфигуратор PDU».</div>
        </div>`;
      return;
    }
  }
  const req = pdu._requirements || {};
  const ctx = req.context;
  host.innerHTML = `
    <div class="rc-pdu-req-card rc-pdu-req-reqs">
      <div><b>📋 Лист требований (без SKU)</b></div>
      <div class="rc-pdu-req-grid">
        <div><span>Кол-во</span><b>${qtyStr}</b></div>
        <div><span>Номинал</span><b>≥ ${ratingStr}</b></div>
        <div><span>Фаз</span><b>${phasesStr}</b></div>
        <div><span>Высота</span><b>${heightStr}</b></div>
        <div class="rc-pdu-req-full"><span>Розетки</span><b>${escape(outletsStr)}</b></div>
        ${req.category ? `<div><span>Категория</span><b>${escape(req.category)}</b></div>` : ''}
        ${ctx ? `<div class="rc-pdu-req-full"><span>Контекст</span><b>${ctx.servers || '?'} серверов × ${ctx.kwPerServer || '?'} кВт, cos φ=${ctx.cosPhi || '?'}, ${ctx.phases === '3' ? '3ф 400В' : '1ф 230В'}, резерв ${ctx.redundancy || 'N'}</b></div>` : ''}
      </div>
      <div class="muted" style="font-size:11px;margin-top:4px">В BOM попадёт как <b>лист требований</b>. Чтобы выбрать артикул — «🧙 Конфигуратор PDU» → «Выбрать».</div>
    </div>`;
}

function openPduCatalogModal(pdu) {
  const tpl = current();
  const mode = tpl.pduRedundancy || '2N';
  const thisFeed = (pdu && pdu.feed) || 'A';
  const pairFeed = thisFeed === 'A' ? 'B' : 'A';
  const redMode = (mode === '2N' || mode === 'n+1');
  const pairAlreadyExists = tpl.pdus.some(p => p !== pdu && p.feed === pairFeed);
  const pairDefault = redMode && !pairAlreadyExists;

  // Подсчитываем текущие розетки PDU по типам — это минимумы фильтра.
  const curOut = { c13: 0, c19: 0, schuko: 0 };
  (pdu.outlets || []).forEach(o => {
    const t2 = String(o.type || '').toLowerCase();
    const n = Number(o.count ?? o.qty) || 0;
    if (t2 === 'c13') curOut.c13 += n;
    else if (t2 === 'c19') curOut.c19 += n;
    else if (t2 === 'schuko' || t2 === 'cee7/4' || t2 === 'cee7') curOut.schuko += n;
  });

  const initial = {
    phases: (pdu && (pdu.phases === 1 || pdu.phases === 3)) ? String(pdu.phases) : 'any',
    rating: Number(pdu && pdu.rating) || 0,
    height: (pdu && typeof pdu.height === 'number') ? String(pdu.height) : 'any',
    category: (pdu && pdu.category) || 'any',
    outlets: curOut,
  };
  // State carriers for pair/color (мутируются обработчиками extraFooter)
  const pairState = { pair: pairDefault, colorA: (pdu && pdu.color) || '', colorB: '' };

  // Standalone-pick из /pdu-config/ (raschet.lastPduConfig.v1) — если
  // свежий (< 24 ч), показываем кнопку «⬇ Применить из Конфигуратора».
  let lastPdu = null;
  try {
    const raw = localStorage.getItem('raschet.lastPduConfig.v1');
    if (raw) {
      const p = JSON.parse(raw);
      // Принимаем либо полностью выбранную модель (sku), либо «только
      // требования» (requirementsOnly:true без sku — из кнопки «Перенести
      // требования» в модалке-пикере PDU).
      const okTime = p && p.selectedAt && (Date.now() - p.selectedAt) < 24*60*60*1000;
      if (okTime && (p.sku || p.requirementsOnly)) lastPdu = p;
    }
  } catch {}
  const lastPduBtn = lastPdu
    ? (lastPdu.requirementsOnly
        ? `<button type="button" id="pdm-apply-last" class="pdm-btn pdm-btn-primary" title="Применить только требования (номинал/фазы/розетки), без конкретной модели">⬇ Требования из Конфигуратора PDU</button>`
        : `<button type="button" id="pdm-apply-last" class="pdm-btn pdm-btn-primary" title="Применить модель, выбранную в /pdu-config/ (${escape(lastPdu.manufacturer)} · ${escape(lastPdu.label)})">⬇ Из Конфигуратора PDU: ${escape(lastPdu.manufacturer)} ${escape(lastPdu.label)}</button>`)
    : '';

  const extraFooter = `
    ${lastPduBtn}
    <label style="display:flex;gap:6px;align-items:center;font-size:12px${pairAlreadyExists?';opacity:0.5':''}" ${pairAlreadyExists?'title="На вводе '+pairFeed+' уже есть PDU — пара не добавится автоматически"':''}>
      <input type="checkbox" id="pdm-pair" ${pairState.pair?'checked':''} ${pairAlreadyExists?'disabled':''}>
      Парой на ${thisFeed}+${pairFeed} ${redMode?'<span style="color:#1565c0;font-size:11px">(реком. для '+mode+')</span>':''}
    </label>
    <label style="display:flex;gap:4px;align-items:center;font-size:12px" title="Цвет корпуса PDU для ввода ${thisFeed}. Попадает в BOM и лист требований.">
      Цвет ${thisFeed}: <input type="text" id="pdm-ca" value="${escape(pairState.colorA)}" style="width:80px;font-size:12px" placeholder="—">
    </label>
    <label style="display:flex;gap:4px;align-items:center;font-size:12px" title="Цвет корпуса PDU для ввода ${pairFeed}. Обычно отличается от ${thisFeed}.">
      Цвет ${pairFeed}: <input type="text" id="pdm-cb" value="${escape(pairState.colorB)}" style="width:80px;font-size:12px" placeholder="—">
    </label>
  `;

  openPduPickerModal({
    title: `Каталог PDU · ввод ${thisFeed}`,
    selectedSku: (pdu && pdu.sku) || '',
    initial,
    extraFooter,
    onExtraMount: box => {
      const pairEl = box.querySelector('#pdm-pair');
      if (pairEl) pairEl.addEventListener('change', e => { pairState.pair = e.target.checked; });
      const caEl = box.querySelector('#pdm-ca');
      if (caEl) caEl.addEventListener('input', e => { pairState.colorA = e.target.value; });
      const cbEl = box.querySelector('#pdm-cb');
      if (cbEl) cbEl.addEventListener('input', e => { pairState.colorB = e.target.value; });
      // «Применить из Конфигуратора PDU» — подставляет payload из
      // raschet.lastPduConfig.v1 напрямую, минуя выбор по таблице.
      const applyLast = box.querySelector('#pdm-apply-last');
      if (applyLast && lastPdu) applyLast.addEventListener('click', () => {
        // requirementsOnly: применяем параметры без привязки к конкретной SKU
        if (lastPdu.requirementsOnly) pdu.sku = '';
        else pdu.sku = lastPdu.sku;
        pdu.rating = Number(lastPdu.rating) || pdu.rating;
        pdu.phases = Number(lastPdu.phases) || pdu.phases;
        pdu.height = Number(lastPdu.height) || 0;
        if (Array.isArray(lastPdu.outlets)) {
          pdu.outlets = lastPdu.outlets.map(o => ({ type: o.type, count: Number(o.count) || 0 }));
        }
        if (pairState.colorA) pdu.color = pairState.colorA;
        if (pairState.pair && !pairAlreadyExists) {
          const twin = JSON.parse(JSON.stringify(pdu));
          twin.id = 'pdu' + Date.now() + '-' + pairFeed;
          twin.feed = pairFeed;
          if (pairState.colorB) twin.color = pairState.colorB; else delete twin.color;
          tpl.pdus.push(twin);
        }
        // box — внутренняя панель, её parent — backdrop с z-index 9999.
        if (box.parentElement) box.parentElement.remove();
        renderPduList(); recalc();
      });
    },
    onClear: () => {
      // «Произвольная» — сохраняем цвет (если задан), сбрасываем sku
      pdu.sku = '';
      if (pairState.colorA) pdu.color = pairState.colorA;
      else if (pdu.color) delete pdu.color;
      renderPduList(); recalc();
    },
    onPick: ({ sku, pdu: picked }) => {
      if (!sku || !picked) { renderPduList(); recalc(); return; }
      const kp = picked.kindProps || {};
      const el2 = picked.electrical || {};
      pdu.sku = sku;
      pdu.rating = Number(kp.rating || el2.capacityA || pdu.rating);
      pdu.phases = Number(kp.phases || el2.phases || pdu.phases);
      // height в rack-config — число (0/1/2); в element-library это тоже
      // число (rack-catalog-data.js), но на всякий случай — нормализация.
      const hRaw = kp.height;
      const hNum = typeof hRaw === 'number' ? hRaw
                 : (String(hRaw).match(/^(\d+)/) || [0, 0])[1];
      pdu.height = Number(hNum) || 0;
      // outlets: приводим к формату rack-config {type,count}
      if (Array.isArray(kp.outlets)) {
        pdu.outlets = kp.outlets.map(o => ({
          type: o.type,
          count: Number(o.count ?? o.qty) || 0,
        }));
      }
      if (pairState.colorA) pdu.color = pairState.colorA;
      else if (pdu.color) delete pdu.color;
      // Парный PDU на противоположный ввод
      if (pairState.pair && !pairAlreadyExists) {
        const twin = JSON.parse(JSON.stringify(pdu));
        twin.id = 'pdu' + Date.now() + '-' + pairFeed;
        twin.feed = pairFeed;
        if (pairState.colorB) twin.color = pairState.colorB; else delete twin.color;
        tpl.pdus.push(twin);
      }
      renderPduList(); recalc();
    },
  });
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
  // 1.24.40 — уникальность обозначения (name) стойки в проекте
  const newName = el('rc-name').value.trim();
  if (newName && newName !== t.name) {
    const dup = state.templates.find(x => x.id !== t.id && (x.name || '').trim().toLowerCase() === newName.toLowerCase());
    if (dup) {
      // откатываем DOM на предыдущее значение
      el('rc-name').value = t.name || '';
      rsToast(`Обозначение «${newName}» уже занято другой стойкой проекта. Должно быть уникальным.`, 'warn');
      // остальные поля всё равно читаем
    } else {
      t.name = newName;
    }
  } else {
    t.name = newName;
  }
  t.manufacturer = el('rc-manufacturer').value.trim();
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
    // Единственное редактируемое поле в строке — «Ввод». Всё остальное
    // (номинал / фазы / высота / розетки / модель) задаётся в Конфигураторе PDU.
    row.innerHTML = `
      <div class="rc-pdu-head">
        <label class="rc-field" title="К какому вводу электрической схемы подключён этот PDU. PDU на одном вводе суммируются, на разных — резервируют друг друга.">
          <span>Ввод</span>
          <select data-k="feed">
            ${['A','B','C','D'].map(f => `<option value="${f}" ${p.feed===f?'selected':''}>Ввод ${f}</option>`).join('')}
          </select>
        </label>
        <div style="flex:1"></div>
        <button type="button" class="rc-btn rc-btn-danger" data-del="${idx}" title="Удалить PDU">✕</button>
      </div>
      <div class="rc-pdu-catalog" style="margin-top:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <button type="button" class="rc-btn rc-btn-primary" data-pdu-wizard="${idx}" title="Открыть Конфигуратор PDU: задать контекст (серверы/кВт/резерв), автоподбор требований, ранжированные рекомендации. Результат (модель или лист требований) вернётся сюда одним кликом.">🧙 Конфигуратор PDU →</button>
          <button type="button" class="rc-btn" data-pdu-cat="${idx}" title="Быстрый выбор артикула из встроенного справочника PDU.">📋 Каталог PDU</button>
        </div>
        <div data-pdu-reqs="${idx}" class="rc-pdu-reqs"></div>
      </div>
    `;
    // feed
    row.querySelectorAll('[data-k]').forEach(inp => {
      inp.addEventListener('change', () => {
        if (inp.dataset.k === 'feed') { p.feed = inp.value; recalc(); }
      });
    });
    const catBtn = row.querySelector('[data-pdu-cat]');
    if (catBtn) catBtn.addEventListener('click', () => openPduCatalogModal(p));
    const wizBtn = row.querySelector('[data-pdu-wizard]');
    if (wizBtn) wizBtn.addEventListener('click', () => openPduWizardModal(idx));
    const reqsHost = row.querySelector(`[data-pdu-reqs="${idx}"]`);
    if (reqsHost) renderPduReqsBlock(reqsHost, p, idx);
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
    // v0.59.111: если указан цвет корпуса — добавляем в примечание
    const colorNote = p.color ? ` · цвет: ${p.color}` : '';
    if (cat) {
      add(`${cat.name} (${cat.sku})`, p.qty, 'шт',
          `${cat.mfg} · ${PDU_CATEGORY[cat.category] || cat.category} · ввод ${p.feed}${colorNote}`);
    } else {
      const name = `PDU ${p.phases}ф ${p.rating}A, ${totalOutlets} розеток (${outletsDesc}), ${hStr}`;
      add(name, p.qty, 'шт',
          `ввод ${p.feed}${colorNote} · произвольная спецификация (см. «Лист требований»)`);
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
        const headroom = t.demandKw > 0 ? ((minCap / t.demandKw - 1) * 100) : 0;
        out.push({ lvl: 'ok',
          msg: `2N: каждый ввод в одиночку обеспечивает ≥${t.demandKw} кВт (минимум ${minCap.toFixed(2)} кВт, запас ${headroom >= 0 ? '+' : ''}${headroom.toFixed(0)}%). Суммарная ёмкость ${sumCap.toFixed(2)} кВт в мощность не засчитывается дважды.` });
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
          const headroom = t.demandKw > 0 ? ((remaining / t.demandKw - 1) * 100) : 0;
          out.push({ lvl: 'ok',
            msg: `N+1: после отказа «жирного» ввода остаётся ${remaining.toFixed(2)} кВт ≥ ${t.demandKw} кВт (запас ${headroom >= 0 ? '+' : ''}${headroom.toFixed(0)}%).` });
        }
      }
    } else {
      // none — суммируем
      if (sumCap + 1e-6 < t.demandKw) {
        out.push({ lvl: 'err',
          msg: `Суммарная ёмкость PDU ${sumCap.toFixed(2)} кВт < заявленная ${t.demandKw} кВт.` });
      } else {
        const headroom = t.demandKw > 0 ? ((sumCap / t.demandKw - 1) * 100) : 0;
        out.push({ lvl: 'ok',
          msg: `Одиночное питание: сумма PDU ${sumCap.toFixed(2)} кВт ≥ ${t.demandKw} кВт (запас ${headroom >= 0 ? '+' : ''}${headroom.toFixed(0)}%).` });
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
  // v0.59.112: 'any' («не важно») считается неопределённым и не вызывает warn.
  const perfFront = /mesh/.test(t.doorFront) || t.doorFront === 'none' || t.doorFront === 'any';
  const perfRear  = /mesh/.test(t.doorRear)  || t.doorRear === 'none'  || t.doorRear === 'any';
  if (t.demandKw >= 3 && (!perfFront || !perfRear)) {
    out.push({ lvl: 'warn',
      msg: `При тепловыделении ≥3 кВт рекомендуются перфорированные двери спереди и сзади.` });
  }
  // v0.59.134: для серверных шкафов при больших нагрузках — наоборот, максимально уплотняем корпус (cold/hot aisle containment), вентиляторные крыши не рекомендуются. Warn о незаделанных щелях:
  if (t.demandKw >= 5) {
    const leaky = [];
    if (t.top === 'fan' || t.top === 'vent') leaky.push('вентиляторная/перфорированная крыша');
    if (t.sides === 'none' || t.sides === 'left' || t.sides === 'right') leaky.push('отсутствуют боковые стенки');
    if (t.floor === 'vent') leaky.push('перфорированный пол');
    if (leaky.length) {
      out.push({ lvl: 'warn', msg: `При ≥5 кВт серверный шкаф следует максимально уплотнять (cold/hot aisle containment). Обнаружены «щели»: ${leaky.join('; ')}. Перфорированы должны быть только передняя и задняя двери.` });
    }
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

  // ===================================================================
  // v0.59.113: совместимость выбранных деталей / аксессуаров
  // ===================================================================

  // 1. Двустворчатые двери на узкой стойке — у нашего типового решения
  // все стойки 600 мм идут с двустворчатой задней дверью, поэтому никаких
  // warnings по этому поводу не выводим. При необходимости правило можно
  // вернуть для других производителей.

  // 2. Физическая вместимость по U: занятое оборудование + горизонтальные
  // PDU (height>0, qty шт на стойку ÷ max по вводам) должны уместиться в U
  // стойки. 0U PDU занимают только боковую шину и в подсчёт не идут.
  const occupied = Math.max(0, +t.occupiedU || 0);
  let pduHoriz = 0;
  (t.pdus || []).forEach(p => {
    const h = +p.height || 0;
    if (h <= 0) return;
    const perFeed = Math.max(1, +p.qty || 1);
    pduHoriz = Math.max(pduHoriz, h * perFeed);
  });
  const totalU = occupied + pduHoriz;
  if (t.u && totalU > t.u) {
    out.push({ lvl: 'err',
      msg: `Вместимость стойки ${t.u}U превышена: занято оборудованием ${occupied}U + горизонтальные PDU ${pduHoriz}U = ${totalU}U. Уменьшите загрузку, выберите 0U PDU или более высокий корпус.` });
  } else if (t.u && totalU > t.u - 2 && totalU > 0) {
    out.push({ lvl: 'warn',
      msg: `Стойка ${t.u}U заполнена почти полностью (${totalU}U из ${t.u}U, запас <2U на кабель-органайзеры и рост).` });
  }

  // 3. Электрозамок требует отдельной цепи питания 12/24В от СКУД — это
  // часто забывают в ТЗ, поэтому выдаём info при любом doorWithLock.
  if (t.lock === 'electro') {
    out.push({ lvl: 'warn',
      msg: `Электрозамок: заложите отдельный слаботочный кабель питания 12/24В от контроллера СКУД и согласуйте протокол (Wiegand / OSDP).` });
  }

  // 4. Kit-конфликт: kit.includes содержит параметр, но пользователь
  // выбрал значение, отличное от kit.preset. В BOM эта позиция пропускается
  // (считается включённой в кит), но фактически в стойке будет preset-
  // значение, а не выбранное — предупреждаем.
  const kitW = kitById(t.kitId || '');
  if (kitW && Array.isArray(kitW.includes) && kitW.preset) {
    const CHECK_KEYS = ['doorFront', 'doorRear', 'sides', 'top', 'base', 'u', 'width', 'depth'];
    CHECK_KEYS.forEach(k => {
      if (!kitW.includes.includes(k)) return;
      const kitVal = kitW.preset[k];
      const userVal = t[k];
      if (kitVal == null || userVal == null || userVal === 'any') return;
      if (String(kitVal) !== String(userVal)) {
        out.push({ lvl: 'warn',
          msg: `Комплект «${kitW.sku}» включает «${k}» = ${kitVal}, но у Вас указано ${userVal}. Фактически в стойке будет «${kitVal}» (из кита); выбранное значение игнорируется в BOM. Либо выберите «Произвольный» кит, либо приведите параметры к preset.` });
      }
    });
  }

  // 5. Тяжёлая нагрузка + ролики. >10 кВт IT-оборудования обычно означает
  // вес стойки 600–800 кг — ролики рассчитаны на перевозку пустой/лёгкой
  // стойки при монтаже, эксплуатировать на них нельзя.
  if (t.base === 'casters' && (+t.demandKw || 0) >= 10) {
    out.push({ lvl: 'warn',
      msg: `Ролики + ${(+t.demandKw).toFixed(0)} кВт IT-нагрузки: стойка этого класса обычно 600+ кг, ролики — только для перемещения при монтаже. Для стационарной установки закажите регулируемые ножки или цоколь.` });
  }

  // 6. Кабельные вводы снизу + цоколь без вырезов. Если указан plinth и
  // entryBot>0, нужен цоколь с вырезами — часто это отдельный SKU.
  if (t.base === 'plinth' && (+t.entryBot || 0) > 0) {
    out.push({ lvl: 'warn',
      msg: `Цоколь + ${+t.entryBot} кабельных вводов снизу: убедитесь, что выбран цоколь с вырезами под кабель (обычно отдельный артикул, напр. Rittal 8601.035 / APC AR7570).` });
  }

  // 7a. Замок на отсутствующую дверь. Если обе двери 'none', но
  // doorWithLock=true или lock!='none' — это ошибка (замок крепится к
  // двери, ставить его некуда).
  if (t.doorWithLock && t.doorFront === 'none' && t.doorRear === 'none') {
    out.push({ lvl: 'err',
      msg: `Замки в дверях отмечены, но обе двери = «без двери». Уберите «Замок входит в дверь» или выберите тип дверей.` });
  }

  // 7b. Вертикальные 0U PDU — стойка имеет ровно 2 монтажные позиции
  // (левая и правая задние стойки). Больше двух 0U PDU на один ввод
  // физически не закрепить штатно.
  const vert = {};
  (t.pdus || []).forEach(p => {
    const h = +p.height || 0;
    if (h !== 0) return;
    const f = p.feed || 'A';
    vert[f] = (vert[f] || 0) + Math.max(1, +p.qty || 1);
  });
  Object.keys(vert).forEach(f => {
    if (vert[f] > 2) {
      out.push({ lvl: 'warn',
        msg: `Ввод ${f}: ${vert[f]} вертикальных (0U) PDU — в стойке обычно две боковые шины. Проверьте количество или перейдите на горизонтальные PDU.` });
    }
  });

  // 8. Аксессуары от чужого производителя. Предупреждаем, только если
  // производитель шкафа известен и аксессуар явно «не родной».
  const rackMfgCur = (t.manufacturer || '').trim();
  if (rackMfgCur && Array.isArray(t.accessories)) {
    const foreign = [];
    t.accessories.forEach(a => {
      const cat = accBySku(a.sku);
      if (!cat) return;
      if (!accessoryMatchesRackMfg(cat, rackMfgCur)) {
        foreign.push(cat.sku + ' (' + (cat.mfg || '—') + ')');
      }
    });
    if (foreign.length) {
      out.push({ lvl: 'warn',
        msg: `Аксессуары от других производителей (${foreign.length}): ${foreign.slice(0,3).join(', ')}${foreign.length>3?` и ещё ${foreign.length-3}`:''}. Убедитесь, что крепёж совместим с каркасом ${rackMfgCur} (посадочные места/шаг квадратных отверстий).` });
    }
  }

  return out;
}

/* ---------- превью ---------- */
function renderWarnings() {
  const host = el('rc-warn');
  host.innerHTML = '';
  // v0.59.115: сортируем по строгости (err → warn → ok) и добавляем шапку
  // со счётчиком. Пусто = «нарушений не найдено».
  const list = computeWarnings();
  const rank = { err: 0, warn: 1, ok: 2 };
  list.sort((a, b) => (rank[a.lvl] ?? 3) - (rank[b.lvl] ?? 3));
  const nErr = list.filter(w => w.lvl === 'err').length;
  const nWarn = list.filter(w => w.lvl === 'warn').length;
  const nOk = list.filter(w => w.lvl === 'ok').length;
  if (list.length === 0) {
    const d = document.createElement('div');
    d.className = 'rc-warn-item ok';
    d.textContent = '✓ Нарушений и предупреждений не найдено.';
    host.appendChild(d);
    return;
  }
  const hdr = document.createElement('div');
  hdr.className = 'rc-warn-summary';
  hdr.style.cssText = 'display:flex;gap:10px;font-size:12px;padding:4px 0 6px 0;color:var(--rs-muted, #888)';
  const parts = [];
  if (nErr)  parts.push(`<span style="color:#c62828">⛔ ошибок: ${nErr}</span>`);
  if (nWarn) parts.push(`<span style="color:#ef6c00">⚠ предупреждений: ${nWarn}</span>`);
  if (nOk)   parts.push(`<span style="color:#2e7d32">✓ ок: ${nOk}</span>`);
  hdr.innerHTML = parts.join(' · ');
  host.appendChild(hdr);
  list.forEach(w => {
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
  renderUnitMap();
}

/* ---------- 2D карта юнитов (Phase 1.23.8) ----------
   Простая SVG-схема фронт-вью стойки: стек U сверху вниз, занятые —
   в верхней части, заглушки — ниже, горизонтальные PDU (1U/2U) —
   отдельные ряды внизу, 0U PDU — вертикальные «рельсы» по бокам.
   Назначение — быстрое визуальное понимание наполнения стойки без
   ручного пересчёта U, и приёмка BOM (занятые + заглушки = Utotal). */
function renderUnitMap() {
  const host = el('rc-unitmap'); if (!host) return;
  const t = current();
  if (!t) { host.innerHTML = ''; return; }

  const totalU = Math.max(1, t.u || 42);
  const occ = Math.min(totalU, Math.max(0, +t.occupied || 0));
  // горизонтальные PDU занимают 1-2U в стойке, по высоте выберем ≥1
  const horizPdus = [];
  const vertPdus  = [];
  (t.pdus || []).forEach(p => {
    const qty = Math.max(1, +p.qty || 1);
    for (let i = 0; i < qty; i++) {
      if (+p.height > 0) horizPdus.push({ h: Math.min(+p.height, 2), rating: p.rating, phases: p.phases, feed: p.feed });
      else               vertPdus.push({ rating: p.rating, phases: p.phases, feed: p.feed });
    }
  });
  // распределим hz-PDU по самым нижним свободным юнитам (после заглушек)
  const hzTotal = horizPdus.reduce((s, p) => s + p.h, 0);
  const blanks = Math.max(0, totalU - occ - hzTotal);

  // геометрия: высота ряда 16px, ширина 200px; «рельсы» — 18px по бокам
  const rowH = 16, bodyW = 200, railW = vertPdus.length ? 18 : 0;
  const svgW = bodyW + railW * 2 + 28; // +padding слева для номеров U
  const svgH = totalU * rowH + 8;

  const rows = [];
  // сверху вниз: U(totalU)..U1. Заполняем с верха occupied, затем blanks, затем horiz PDU.
  let u = totalU;
  // occupied
  for (let i = 0; i < occ; i++, u--) {
    rows.push({ u, kind: 'eq', label: '' });
  }
  // blanks
  for (let i = 0; i < blanks; i++, u--) {
    rows.push({ u, kind: 'blank', label: '' });
  }
  // horizontal PDUs — снизу
  horizPdus.forEach((p, idx) => {
    for (let k = 0; k < p.h; k++, u--) {
      rows.push({ u, kind: 'pdu-h', label: k === 0 ? `PDU ${p.rating}A/${p.phases}ф · ${p.feed}` : '' });
    }
  });

  // vertPdus — две колонки-рельсы: чередуем L / R
  const leftVert = [], rightVert = [];
  vertPdus.forEach((p, i) => (i % 2 === 0 ? leftVert : rightVert).push(p));

  const colorFor = k => k === 'eq' ? '#cbd5e1'
                      : k === 'blank' ? '#f1f5f9'
                      : k === 'pdu-h' ? '#bfdbfe'
                      : '#bfdbfe';

  const bodyX = railW + 28;
  const rectsSvg = rows.map((r, i) => {
    const y = 4 + i * rowH;
    const fill = colorFor(r.kind);
    const stroke = r.kind === 'blank' ? '#cbd5e1' : '#64748b';
    const label = r.label
      ? `<text x="${bodyX + 6}" y="${y + rowH/2 + 4}" font-size="10" fill="#0f172a">${escape(r.label)}</text>`
      : '';
    const num = `<text x="${railW + 22}" y="${y + rowH/2 + 4}" font-size="9" fill="#64748b" text-anchor="end">${r.u}</text>`;
    return `<rect x="${bodyX}" y="${y}" width="${bodyW}" height="${rowH - 1}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>${num}${label}`;
  }).join('');

  const railSvg = (list, x) => list.length
    ? `<rect x="${x}" y="4" width="${railW}" height="${totalU * rowH}" fill="#bfdbfe" stroke="#64748b" stroke-width="0.5"/>`
      + `<text x="${x + railW/2}" y="${4 + totalU * rowH / 2}" font-size="9" fill="#0f172a" text-anchor="middle" transform="rotate(-90, ${x + railW/2}, ${4 + totalU * rowH / 2})">${list.length}× PDU 0U · ${list.map(p => p.feed).join('/')}</text>`
    : '';

  const svg = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    ${railSvg(leftVert, 0)}
    ${railSvg(rightVert, bodyX + bodyW + 4)}
    ${rectsSvg}
  </svg>`;

  const legend = `<div class="rc-unitmap-legend">
    <span><i style="background:#cbd5e1"></i>Оборудование · ${occ}U</span>
    <span><i style="background:#f1f5f9;border:1px solid #cbd5e1"></i>Заглушка · ${blanks}U</span>
    <span><i style="background:#bfdbfe"></i>PDU горизонт. · ${hzTotal}U</span>
    ${vertPdus.length ? `<span><i style="background:#bfdbfe;border:1px solid #64748b"></i>PDU 0U (рельсы) · ${vertPdus.length} шт.</span>` : ''}
  </div>`;

  host.innerHTML = svg + legend;
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
    if (p.color) lines.push(`  Цвет корпуса:       ${p.color}`);
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
async function duplicatePdusPerFeed() {
  const t = current();
  // группируем существующие PDU по вводам
  const byFeed = {};
  t.pdus.forEach(p => { (byFeed[p.feed] = byFeed[p.feed] || []).push(p); });
  const feeds = Object.keys(byFeed);
  if (!feeds.length) { rsToast('Нет PDU для дублирования.', 'warn'); return; }
  const ok = await rsConfirm(
    `Дублировать PDU на ${feeds.length} вводах?`,
    `На каждом из вводов (${feeds.join(', ')}) будет добавлена по одной копии PDU — всего +${feeds.length} шт. ` +
    `Это типовая схема «2 PDU на ввод»: один кабель от основной схемы расщепляется в шкафу через T-сплиттер / клипс-бокс IEC 60309. ` +
    `В BOM автоматически добавится распределитель на каждый ввод.`,
    { okLabel: 'Продолжить', cancelLabel: 'Отмена' });
  if (!ok) return;
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
  // 1.24.40 — автоинкремент имени если оно уже занято (уникальность в проекте)
  const baseName = (t.name || 'Новый шкаф').trim();
  let name = baseName, n = 2;
  const clash = nm => state.templates.some(x => (x.name || '').trim().toLowerCase() === nm.toLowerCase());
  while (clash(name)) { name = `${baseName} (${n++})`; }
  t.name = name;
  state.templates.push(t);
  state.currentId = t.id;
  saveTemplates();
  renderTemplateList();
  renderForm();
}
async function deleteTemplate() {
  if (!(await rsConfirm('Удалить текущий шаблон?', '', { okLabel: 'Удалить', cancelLabel: 'Отмена' }))) return;
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
  if (!state.nodeId) { rsToast('Шаблон не привязан к узлу схемы.', 'warn'); return; }
  readForm();
  try {
    localStorage.setItem(BRIDGE_KEY_PREFIX + state.nodeId,
      JSON.stringify({ applied: true, ts: Date.now(), template: t }));
  } catch (e) { rsToast('Не удалось передать шаблон: ' + e.message, 'err'); return; }
  // postMessage родительскому окну если есть
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: 'raschet.rack.apply', nodeId: state.nodeId, template: t,
      }, '*');
    }
  } catch {}
  rsToast('Шаблон применён к узлу схемы. Можно закрыть вкладку.', 'ok');
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
    rsToast('Шаблон «' + (current().name || '—') + '» сохранён в localStorage.', 'ok');
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
