// ======================================================================
// pdu-config/pdu-config.js
// Standalone-модуль подбора PDU из единой библиотеки элементов.
// Источник данных: listElements({kind:'pdu'}) из shared/element-library.js
// (через catalog-bridge → shared/catalogs/pdus.js).
//
// Поток работы:
//   ① Контекст стойки (серверов, кВт/серв, cos φ, 2N) → расчёт I_rack,
//      автоподбор номинала PDU и количества розеток C13.
//   ② Требования (редактируемые) — могут быть заполнены из контекста
//      или вручную.
//   ③ Ранжирование — score 0–100 по покрытию/номиналу/перерасходу.
//   ④ Действия — выбрать модель (→ lastPduConfig.v1),
//      перенести только требования (requirementsOnly),
//      печать / экспорт markdown / ссылка на каталог.
// ======================================================================

import { listElements } from '../shared/element-library.js';
import { initCatalogBridge, syncLegacyToLibrary } from '../shared/catalog-bridge.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ——— State ———
const ctx = {
  servers: 20,
  kwPerServer: 0.6,
  c19Devices: 0,
  cosPhi: 0.92,
  phases: '3',        // '1' | '3'
  redundancy: 'N',    // 'N' | '2N'
};

const state = {
  phases: '3',           // '1' | '3' | 'any'
  rating: 32,            // минимум по вводу, A
  height: 'any',         // '0' | '1' | '2' | 'any'
  category: 'any',       // basic | metered | monitored | switched | hybrid | any
  // outlets: map of type → required count. Любой ключ, сколько угодно типов.
  outlets: { C13: 20, C19: 4 },
  mfgs: new Set(),       // пустой = все
};

// Нормализация имени типа розетки (заглавные, убираем пробелы/дефисы)
const normType = s => String(s || '').trim().toUpperCase().replace(/[\s\-_/]+/g, '');
// Канонические типы (для сортировки и автодополнения из контекста)
const STD_OUTLET_TYPES = ['C13', 'C19', 'C15', 'C21', 'SCHUKO', 'NEMA515', 'NEMA520', 'NEMA L5-30', 'IEC309'];

const CATEGORY_LABEL = {
  basic: 'Basic',
  metered: 'Metered',
  monitored: 'Monitored (per-outlet)',
  switched: 'Switched',
  hybrid: 'Hybrid',
};

// ——— Загрузка данных ———
let _pdus = [];
async function loadPdus() {
  initCatalogBridge();
  await syncLegacyToLibrary();
  _pdus = listElements({ kind: 'pdu' });
  return _pdus;
}

// ——— Контекст → требования ———
function computeFromContext() {
  const P_kW = ctx.servers * ctx.kwPerServer;          // суммарная мощность стойки, кВт
  const P_W = P_kW * 1000;
  const cos = Math.max(0.5, ctx.cosPhi);
  let I_rack;
  if (ctx.phases === '3') I_rack = P_W / (Math.sqrt(3) * 400 * cos);
  else                    I_rack = P_W / (230 * cos);

  // В режиме 2N каждый PDU должен:
  //   а) в штатном режиме нести ~60% (балансировка с учётом headroom);
  //   б) при отказе другого — всю нагрузку с запасом 1.25.
  // Берём максимум.
  const I_one_N  = 1.25 * I_rack;
  const I_one_2N = Math.max(1.25 * I_rack, 0.6 * I_rack); // при 2N по факту = 1.25·I_rack
  const I_req = ctx.redundancy === '2N' ? I_one_2N : I_one_N;

  // Ступенчато округляем к стандартным номиналам PDU: 16/20/32/63
  const ratings = [16, 20, 32, 63];
  const needRating = ratings.find(r => r >= I_req) || ratings[ratings.length - 1];

  // Розетки: серверы = 2× C13 по умолчанию; минус c19Devices * 2 (они на C19)
  const serversOnC13 = Math.max(0, ctx.servers - ctx.c19Devices);
  const c13Needed = serversOnC13 * 2; // 2× ввода на сервер
  const c19Needed = ctx.c19Devices * 2; // C19 на high-power — тоже парно

  // В режиме 2N на каждый PDU идёт один ввод сервера (не два), поэтому делим.
  const divider = ctx.redundancy === '2N' ? 2 : 1;
  const c13PerPdu = Math.ceil(c13Needed / divider);
  const c19PerPdu = Math.ceil(c19Needed / divider);

  // Округляем к «красивым» блокам
  const roundUp = (n, steps) => steps.find(s => s >= n) || steps[steps.length - 1];
  const c13Rounded = c13PerPdu > 0 ? roundUp(c13PerPdu, [8, 16, 20, 24, 36, 42]) : 0;
  const c19Rounded = c19PerPdu > 0 ? roundUp(c19PerPdu, [2, 4, 6, 8, 10, 12]) : 0;

  return {
    P_kW, I_rack, I_req,
    rating: needRating,
    c13: c13Rounded,
    c19: c19Rounded,
    pdusCount: ctx.redundancy === '2N' ? 2 : 1,
  };
}

function applyContextToRequirements() {
  const r = computeFromContext();
  state.phases = ctx.phases;
  state.rating = r.rating;
  state.outlets.C13 = r.c13;
  state.outlets.C19 = r.c19;
  // Прочие типы (Schuko, NEMA, IEC 309…) оставляем как есть — контекст их не задаёт
  document.getElementById('pc-phases').value = ctx.phases;
  document.getElementById('pc-rating').value = r.rating;
  renderOutletInputs();
  render();
  renderContextSummary();
}

// Собрать список типов розеток из каталога + текущих требований
function detectedOutletTypes() {
  const set = new Set();
  // Из требований (могут включать пользовательские)
  for (const t of Object.keys(state.outlets)) set.add(normType(t));
  // Из каталога
  for (const p of _pdus) {
    for (const o of (p.kindProps?.outlets || [])) {
      if (o.type) set.add(normType(o.type));
    }
  }
  // Приоритет в отображении: стандартные сверху, потом остальные
  const std = STD_OUTLET_TYPES.map(normType);
  const arr = Array.from(set);
  arr.sort((a, b) => {
    const ia = std.indexOf(a), ib = std.indexOf(b);
    if (ia < 0 && ib < 0) return a.localeCompare(b);
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  return arr;
}

function displayType(t) {
  const T = normType(t);
  if (T === 'SCHUKO') return 'Schuko';
  if (T === 'NEMA515') return 'NEMA 5-15';
  if (T === 'NEMA520') return 'NEMA 5-20';
  if (T === 'IEC309') return 'IEC 309';
  return T;
}

function renderOutletInputs() {
  const box = document.getElementById('pc-outlets-grid');
  if (!box) return;
  const types = detectedOutletTypes();
  box.innerHTML = types.map(t => {
    const val = state.outlets[t] ?? 0;
    return `<label class="pc-field" style="margin:0">
      <span>${esc(displayType(t))} (≥)</span>
      <input type="number" min="0" max="96" data-outlet="${esc(t)}" value="${val}">
    </label>`;
  }).join('') + `
    <label class="pc-field" style="margin:0">
      <span>+ добавить тип</span>
      <select id="pc-outlet-add">
        <option value="">— выбрать —</option>
        <option value="C13">C13</option>
        <option value="C19">C19</option>
        <option value="C15">C15</option>
        <option value="C21">C21</option>
        <option value="SCHUKO">Schuko (CEE 7/4)</option>
        <option value="NEMA515">NEMA 5-15</option>
        <option value="NEMA520">NEMA 5-20</option>
        <option value="NEMA L5-30">NEMA L5-30</option>
        <option value="IEC309-16">IEC 60309 16 A</option>
        <option value="IEC309-32">IEC 60309 32 A</option>
        <option value="UK-BS1363">UK BS1363</option>
        <option value="T-SLOT">T-slot</option>
        <option value="__custom__">свой…</option>
      </select>
    </label>`;
  box.querySelectorAll('input[data-outlet]').forEach(inp => {
    inp.addEventListener('change', () => {
      const t = inp.dataset.outlet;
      const v = Math.max(0, Number(inp.value) || 0);
      if (v === 0) delete state.outlets[t]; else state.outlets[t] = v;
      render();
    });
  });
  const addSel = box.querySelector('#pc-outlet-add');
  if (addSel) addSel.addEventListener('change', () => {
    let raw = addSel.value;
    addSel.value = '';
    if (!raw) return;
    if (raw === '__custom__') {
      raw = prompt('Введите тип разъёма (напр. «C13», «IEC309 63A»):');
      if (!raw) return;
    }
    const t = normType(raw);
    if (!t) return;
    if (!state.outlets[t]) state.outlets[t] = 1;
    renderOutletInputs();
    render();
  });
}

function renderContextSummary() {
  const r = computeFromContext();
  const el = document.getElementById('pc-ctx-summary');
  if (!el) return;
  el.innerHTML = `
    <div class="pc-summary-grid">
      <div><span class="pc-summary-k">P стойки</span> <b>${r.P_kW.toFixed(1)} кВт</b></div>
      <div><span class="pc-summary-k">I стойки</span> <b>${r.I_rack.toFixed(1)} A</b></div>
      <div><span class="pc-summary-k">I на PDU</span> <b>${r.I_req.toFixed(1)} A</b></div>
      <div><span class="pc-summary-k">Номинал PDU</span> <b>${r.rating} A</b></div>
      <div><span class="pc-summary-k">C13 / PDU</span> <b>${r.c13}</b></div>
      <div><span class="pc-summary-k">C19 / PDU</span> <b>${r.c19}</b></div>
      <div class="pc-summary-full"><span class="pc-summary-k">PDU в стойке</span> <b>${r.pdusCount}</b> ${ctx.redundancy === '2N' ? '(пара A + B от разных фидеров)' : ''}</div>
    </div>
  `;
}

// ——— Подсчёт розеток в модели: map type → qty ———
function countOutlets(pdu) {
  const outlets = pdu.kindProps?.outlets || [];
  const map = {};
  let total = 0;
  for (const o of outlets) {
    const t = normType(o.type);
    if (!t) continue;
    const qty = Number(o.qty ?? o.count) || 0;
    map[t] = (map[t] || 0) + qty;
    total += qty;
  }
  map.total = total;
  return map;
}

// ——— Score ———
function scoreCandidate(pdu) {
  const kp = pdu.kindProps || {};
  const el = pdu.electrical || {};
  const reasons = [];
  let score = 0;

  if (state.phases !== 'any' && String(kp.phases || el.phases || '') !== state.phases) return null;
  if (state.category !== 'any' && kp.category !== state.category) return null;
  if (state.height !== 'any' && String(kp.height) !== String(state.height)) return null;
  if (state.mfgs.size > 0 && !state.mfgs.has(pdu.manufacturer)) return null;

  const rating = Number(kp.rating || el.capacityA || 0);
  if (rating < state.rating) return null;

  const has = countOutlets(pdu);
  const need = state.outlets;
  const needTypes = Object.keys(need).filter(t => need[t] > 0);
  let needTotal = 0;
  if (needTypes.length) {
    let covSum = 0;
    for (const t of needTypes) {
      const got = has[t] || 0;
      if (got < need[t]) return null; // жёсткий минимум по каждому типу
      covSum += Math.min(1, got / need[t]);
      needTotal += need[t];
    }
    score += 50 * (covSum / needTypes.length);
  } else {
    score += 50;
  }

  const ratingRatio = state.rating / rating;
  score += 20 * Math.max(0, ratingRatio);

  const overhead = needTotal > 0 ? Math.max(0, has.total - needTotal) / Math.max(1, has.total) : 0;
  score += 15 * (1 - overhead);

  if (state.category !== 'any') score += 5;
  if (state.height !== 'any') score += 5;

  const outletStr = Object.keys(has).filter(k => k !== 'total' && has[k] > 0)
    .map(k => `${displayType(k)}×${has[k]}`).join(', ');
  reasons.push('розетки: ' + (outletStr || '—'));
  reasons.push(`${rating} A (запрошено ≥${state.rating})`);
  if (kp.height !== undefined) reasons.push((kp.height === 0 || kp.height === '0') ? '0U' : `${kp.height}U`);
  if (kp.categoryLabel) reasons.push(kp.categoryLabel);

  return { score: Math.min(100, Math.round(score)), reasons, outlets: has };
}

function rank() {
  const candidates = [];
  for (const pdu of _pdus) {
    const s = scoreCandidate(pdu);
    if (s) candidates.push({ pdu, ...s });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ——— Render ———
function render() {
  const chipsEl = document.getElementById('pc-mfg-chips');
  const allMfgs = Array.from(new Set(_pdus.map(p => p.manufacturer).filter(Boolean))).sort();
  chipsEl.innerHTML = allMfgs.map(m =>
    `<button class="pc-chip${state.mfgs.has(m) ? ' on' : ''}" data-mfg="${esc(m)}">${esc(m)}</button>`
  ).join('');
  chipsEl.querySelectorAll('.pc-chip').forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.mfg;
      if (state.mfgs.has(m)) state.mfgs.delete(m); else state.mfgs.add(m);
      render();
    };
  });

  const ranked = rank();
  const countEl = document.getElementById('pc-count');
  countEl.textContent = `· найдено: ${ranked.length} из ${_pdus.length}`;

  const box = document.getElementById('pc-results');
  if (!ranked.length) {
    box.innerHTML = `<div class="pc-empty">
      Нет подходящих моделей. Попробуйте снизить требования — уменьшить число розеток,
      расширить категорию или убрать фильтр по производителю.
    </div>`;
    return;
  }

  const rows = ranked.map((r, idx) => {
    const p = r.pdu;
    const kp = p.kindProps || {};
    const bar = `<div class="pc-score-bar"><i style="width:${r.score}%"></i></div>`;
    const sku = kp.sku || p.variant || p.id;
    const h = (kp.height === 0 || kp.height === '0') ? '0U' : (kp.height ? kp.height + 'U' : '—');
    return `
      <tr data-id="${esc(p.id)}" class="${idx === 0 ? 'pc-row-best' : ''}">
        <td>${idx === 0 ? '<span class="pc-badge-best">✓ Лучшее</span>' : ''}</td>
        <td><b>${esc(p.manufacturer || '—')}</b><br>
            <span class="muted" style="font-size:10px;font-family:monospace">${esc(sku)}</span></td>
        <td>${esc(p.label)}</td>
        <td>${esc(kp.categoryLabel || kp.category || '—')}</td>
        <td>${kp.rating || '—'} A · ${kp.phases || '?'}ф · ${h}</td>
        <td>${Object.keys(r.outlets).filter(k => k !== 'total' && r.outlets[k] > 0).map(k => `${displayType(k)}×${r.outlets[k]}`).join(' ') || '—'}</td>
        <td class="pc-row-score">${r.score} ${bar}</td>
        <td class="pc-row-actions">
          <button class="pc-btn" data-act="detail">Детали</button>
          <button class="pc-btn pc-btn-primary" data-act="pick">Выбрать</button>
        </td>
      </tr>`;
  }).join('');

  box.innerHTML = `
    <table class="pc-results-table">
      <thead>
        <tr>
          <th></th>
          <th>Производитель / SKU</th>
          <th>Модель</th>
          <th>Категория</th>
          <th>Номинал · Высота</th>
          <th>Розетки</th>
          <th>Score</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  box.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('button[data-act="detail"]').onclick = (e) => { e.stopPropagation(); openDetail(id); };
    tr.querySelector('button[data-act="pick"]').onclick = (e) => { e.stopPropagation(); pickModel(id); };
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openDetail(id));
  });
}

// ——— Detail ———
function openDetail(id) {
  const p = _pdus.find(x => x.id === id);
  if (!p) return;
  const kp = p.kindProps || {};
  const outlets = kp.outlets || [];
  const rows = outlets.map(o => `<tr><td>${esc(o.type)}</td><td>${Number(o.qty ?? o.count) || 0}</td></tr>`).join('');
  const sku = kp.sku || p.variant || p.id;
  const h = (kp.height === 0 || kp.height === '0') ? '0U (вертикальный)' : (kp.height ? kp.height + 'U' : '—');
  const body = `
    <div>
      <div><b>${esc(p.label)}</b></div>
      <div class="muted" style="font-size:11px">${esc(p.manufacturer || '')} · ${esc(sku)}</div>
      <hr>
      <div style="font-size:12px;line-height:1.8">
        <div><b>Категория:</b> ${esc(kp.categoryLabel || kp.category || '—')}</div>
        <div><b>Фаз:</b> ${kp.phases || '—'}</div>
        <div><b>Номинал:</b> ${kp.rating || '—'} A</div>
        <div><b>Высота:</b> ${h}</div>
      </div>
      <h4 style="margin-top:14px;font-size:13px">Розетки</h4>
      <table class="pc-results-table"><thead><tr><th>Тип</th><th>Кол-во</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="pc-empty">нет данных</td></tr>'}</tbody></table>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #eee;padding-top:12px">
        <button id="pc-detail-pick" class="pc-btn pc-btn-primary">⬆ Выбрать эту модель</button>
        ${IS_EMBED ? '' : '<button id="pc-detail-open-rack" class="pc-btn">Открыть Конфигуратор стойки →</button>'}
      </div>
      <div class="muted" style="font-size:11px;margin-top:6px;line-height:1.5">
        «Выбрать» сохранит модель в <code>raschet.lastPduConfig.v1</code>. В Конфигураторе стойки
        → «Каталог PDU» появится кнопка «⬇ Из Конфигуратора PDU» — один клик и PDU подставится.
      </div>
    </div>`;
  const modal = document.getElementById('pc-modal');
  document.getElementById('pc-modal-title').textContent = p.label;
  document.getElementById('pc-modal-body').innerHTML = body;
  modal.hidden = false;
  modal.querySelector('.rc-modal-close').onclick = () => (modal.hidden = true);
  modal.querySelector('.rc-modal-backdrop').onclick = () => (modal.hidden = true);
  document.getElementById('pc-detail-pick').onclick = () => { pickModel(id); modal.hidden = true; };
  const openRackBtn = document.getElementById('pc-detail-open-rack');
  if (openRackBtn) openRackBtn.onclick = () => { pickModel(id); if (IS_EMBED) { postToParent('pdu-config:close', null); } else { top.location.href = '../rack-config/'; } };
}

// ——— Embed mode (iframe внутри rack-config) ———
const IS_EMBED = new URLSearchParams(location.search).get('embed') === '1';
// Пометка body/html классами сразу при загрузке — до любого рендера, чтобы CSS-правила embed-режима (в т.ч. скрытие pc-banner) сработали даже если JS-рендер банера опередит нас.
if (IS_EMBED) { try { document.documentElement.classList.add('pc-embed-html'); document.body && document.body.classList.add('pc-embed'); } catch {} }
function postToParent(type, payload) {
  try { window.parent.postMessage({ type, payload }, '*'); } catch {}
}
function injectEmbedBar() {
  document.body.classList.add('pc-embed');
  // Скрываем шапку приложения и статический футер — они не нужны внутри iframe
  const hdr = document.getElementById('rs-header-mount'); if (hdr) hdr.style.display = 'none';
  const sf = document.getElementById('pc-static-footer'); if (sf) sf.remove();
  // Sticky-бар со «Применить требования» / «Закрыть»
  const bar = document.createElement('div');
  bar.className = 'pc-embed-bar';
  bar.innerHTML = `
    <span class="muted" style="font-size:12px">Режим встраивания · результат применяется к PDU в Конфигураторе стойки</span>
    <span style="flex:1"></span>
    <button type="button" class="pc-btn pc-btn-primary" id="pc-embed-apply-reqs">⬇ Применить требования</button>
    <button type="button" class="pc-btn" id="pc-embed-close">✕ Закрыть</button>
  `;
  document.body.appendChild(bar);
  document.getElementById('pc-embed-apply-reqs').onclick = saveLastPduRequirementsOnly;
  document.getElementById('pc-embed-close').onclick = () => postToParent('pdu-config:close', null);
}

// ——— Handoff ———
function pickModel(id) {
  const p = _pdus.find(x => x.id === id);
  if (!p) return;
  saveLastPdu(p);
  renderPendingBanner();
  flash(`Выбрано: ${p.manufacturer || ''} ${p.label}`);
  if (IS_EMBED) {
    const kp = p.kindProps || {};
    postToParent('pdu-config:apply', {
      sku: kp.sku || p.variant || p.id,
      manufacturer: p.manufacturer || '',
      label: p.label || '',
      category: kp.category || '',
      phases: Number(kp.phases) || 0,
      rating: Number(kp.rating) || 0,
      height: Number(kp.height) || 0,
      outlets: (kp.outlets || []).map(o => ({ type: o.type, count: Number(o.qty ?? o.count) || 0 })),
      context: { ...ctx, pdusCount: ctx.redundancy === '2N' ? 2 : 1 },
    });
  }
}

function saveLastPdu(p) {
  const kp = p.kindProps || {};
  const payload = {
    sku: kp.sku || p.variant || p.id,
    manufacturer: p.manufacturer || '',
    label: p.label || '',
    category: kp.category || '',
    phases: Number(kp.phases) || 0,
    rating: Number(kp.rating) || 0,
    height: Number(kp.height) || 0,
    outlets: (kp.outlets || []).map(o => ({ type: o.type, count: Number(o.qty ?? o.count) || 0 })),
    selectedAt: Date.now(),
    // Контекст — для справки, на случай если rack-config захочет показать
    context: { ...ctx, pdusCount: ctx.redundancy === '2N' ? 2 : 1 },
  };
  try { localStorage.setItem('raschet.lastPduConfig.v1', JSON.stringify(payload)); } catch {}
}

function saveLastPduRequirementsOnly() {
  const payload = {
    requirementsOnly: true,
    sku: '',
    manufacturer: '',
    label: `Требования: ${state.rating}A · ${state.phases}ф · ${Object.keys(state.outlets).filter(k=>state.outlets[k]>0).map(k=>displayType(k)+'≥'+state.outlets[k]).join(', ')}`,
    category: state.category !== 'any' ? state.category : '',
    phases: state.phases === 'any' ? 0 : Number(state.phases),
    rating: state.rating,
    height: state.height === 'any' ? 0 : Number(state.height),
    outlets: Object.keys(state.outlets)
      .filter(k => state.outlets[k] > 0)
      .map(k => ({ type: displayType(k), count: state.outlets[k] })),
    selectedAt: Date.now(),
    context: { ...ctx, pdusCount: ctx.redundancy === '2N' ? 2 : 1 },
  };
  try { localStorage.setItem('raschet.lastPduConfig.v1', JSON.stringify(payload)); } catch {}
  renderPendingBanner();
  if (IS_EMBED) {
    postToParent('pdu-config:apply', payload);
    flash('Требования применены к PDU в стойке.');
  } else {
    flash('Требования сохранены. Откройте Конфигуратор стойки → PDU → «Каталог».');
  }
}

function renderPendingBanner() {
  const slot = document.getElementById('pc-pending-banner-slot');
  if (!slot) return;
  let last = null;
  try {
    const raw = localStorage.getItem('raschet.lastPduConfig.v1');
    if (raw) last = JSON.parse(raw);
  } catch {}
  const fresh = last && last.selectedAt && (Date.now() - last.selectedAt) < 24 * 60 * 60 * 1000;
  if (!fresh) { slot.innerHTML = ''; return; }
  const ageMin = Math.round((Date.now() - last.selectedAt) / 60000);
  const ageStr = ageMin < 60 ? (ageMin + ' мин назад') : (Math.round(ageMin / 60) + ' ч назад');
  const kind = last.requirementsOnly ? '📋 Требования' : '✓ Модель';
  const label = last.requirementsOnly
    ? `${last.rating} A · ${last.phases || '?'}ф · розетки: ${(last.outlets||[]).map(o => o.type+'×'+o.count).join(', ')}`
    : `${esc(last.manufacturer)} · ${esc(last.label)}`;
  // В embed-режиме (iframe внутри rack-config) баннер не нужен: приведёт к вложенной модалке. Результат и так вернётся через postMessage.
  if (IS_EMBED) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="pc-banner">
      <span><b>${kind}</b> · ${label} <span class="muted" style="font-size:11px">(${ageStr})</span></span>
      <span class="muted" style="font-size:11px;flex:1;min-width:180px">В Конфигураторе стойки → PDU → «Каталог» → «⬇ Из Конфигуратора PDU».</span>
      <a href="../rack-config/" class="pc-btn pc-btn-primary" target="_top">Открыть стойку →</a>
      <button class="pc-btn" id="pc-banner-clear">✕</button>
    </div>
  `;
  slot.querySelector('#pc-banner-clear').onclick = () => {
    try { localStorage.removeItem('raschet.lastPduConfig.v1'); } catch {}
    renderPendingBanner();
  };
}
setInterval(() => { try { renderPendingBanner(); } catch {} }, 60000);

// ——— Flash ———
function flash(msg) {
  const t = document.createElement('div');
  t.className = 'pc-flash';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('pc-flash-in'), 10);
  setTimeout(() => { t.classList.remove('pc-flash-in'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ——— Requirements export ———
function buildRequirementsText() {
  const r = computeFromContext();
  const cat = state.category !== 'any' ? (CATEGORY_LABEL[state.category] || state.category) : 'любая';
  const h = state.height !== 'any' ? state.height + 'U' : 'любая';
  const mfgs = state.mfgs.size ? Array.from(state.mfgs).join(', ') : 'любой';
  return [
    `# Требования к PDU`,
    ``,
    `**Контекст стойки**`,
    `- Серверов: ${ctx.servers}`,
    `- кВт/сервер: ${ctx.kwPerServer}`,
    `- P стойки: ${r.P_kW.toFixed(2)} кВт`,
    `- cos φ: ${ctx.cosPhi}`,
    `- Система: ${ctx.phases === '3' ? '3-фазная (400В)' : '1-фазная (230В)'}`,
    `- Резерв: ${ctx.redundancy}${ctx.redundancy === '2N' ? ' (два PDU A+B от разных фидеров)' : ''}`,
    `- I стойки: ${r.I_rack.toFixed(1)} A`,
    `- I на один PDU (с запасом 1.25×): ${r.I_req.toFixed(1)} A`,
    ``,
    `**Требования к каждому PDU**`,
    `- Номинал: не менее **${state.rating} A**`,
    `- Фаз: ${state.phases === 'any' ? 'любое' : state.phases + 'ф'}`,
    `- Высота: ${h}`,
    `- Категория: ${cat}`,
    `- Розетки (на PDU): ${Object.keys(state.outlets).filter(k=>state.outlets[k]>0).map(k=>`${displayType(k)} ≥ ${state.outlets[k]}`).join(', ') || '—'}`,
    `- Производитель: ${mfgs}`,
    ``,
    `**Количество PDU в стойке:** ${r.pdusCount}`,
    ``,
    `_Сгенерировано: Raschet · Конфигуратор PDU · ${new Date().toLocaleString('ru-RU')}_`,
  ].join('\n');
}

function exportMarkdown() {
  const txt = buildRequirementsText();
  const blob = new Blob([txt], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pdu-requirements-${Date.now()}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function printRequirements() {
  const txt = buildRequirementsText();
  const htmlLines = txt.split('\n').map(l => {
    if (l.startsWith('# ')) return `<h1>${esc(l.slice(2))}</h1>`;
    if (l.startsWith('**') && l.endsWith('**')) return `<h3>${esc(l.slice(2, -2))}</h3>`;
    if (l.startsWith('- ')) return `<li>${l.slice(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`;
    if (l.startsWith('_') && l.endsWith('_')) return `<p class="footer-note"><i>${esc(l.slice(1, -1))}</i></p>`;
    if (!l.trim()) return '';
    return `<p>${l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
  });
  // group consecutive <li> into <ul>
  const grouped = [];
  let inUl = false;
  for (const line of htmlLines) {
    if (line.startsWith('<li>')) {
      if (!inUl) { grouped.push('<ul>'); inUl = true; }
      grouped.push(line);
    } else {
      if (inUl) { grouped.push('</ul>'); inUl = false; }
      grouped.push(line);
    }
  }
  if (inUl) grouped.push('</ul>');

  const w = window.open('', '_blank', 'width=800,height=900');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Требования к PDU</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 30px auto; padding: 0 30px; color: #222; }
      h1 { font-size: 20px; border-bottom: 2px solid #1565c0; padding-bottom: 8px; }
      h3 { font-size: 14px; color: #1565c0; margin-top: 18px; }
      ul { padding-left: 22px; }
      li { margin: 4px 0; }
      .footer-note { margin-top: 28px; font-size: 11px; color: #777; border-top: 1px dashed #ccc; padding-top: 10px; }
      @media print { body { margin: 0; } }
    </style>
    </head><body>${grouped.join('\n')}</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch {} }, 300);
}

// ——— Wire ———
function wire() {
  const $ = id => document.getElementById(id);

  // Контекст
  const ctxFields = [
    ['pc-ctx-servers', v => ctx.servers = Math.max(0, Math.round(Number(v) || 0))],
    ['pc-ctx-kw',      v => ctx.kwPerServer = Math.max(0, Number(v) || 0)],
    ['pc-ctx-c19',     v => ctx.c19Devices = Math.max(0, Math.round(Number(v) || 0))],
    ['pc-ctx-cos',     v => ctx.cosPhi = Math.max(0.5, Math.min(1, Number(v) || 0.92))],
    ['pc-ctx-phases',  v => ctx.phases = v],
    ['pc-ctx-redund',  v => ctx.redundancy = v],
  ];
  for (const [id, fn] of ctxFields) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', () => { fn(el.value); renderContextSummary(); });
    el.addEventListener('change', () => { fn(el.value); renderContextSummary(); });
  }
  $('pc-apply-ctx').onclick = applyContextToRequirements;

  // Требования (розетки рендерятся динамически через renderOutletInputs)
  const commit = () => {
    state.phases = $('pc-phases').value;
    state.rating = Number($('pc-rating').value) || 0;
    state.height = $('pc-height').value;
    state.category = $('pc-category').value;
    // outlets уже синхронизируются в renderOutletInputs через change-слушатели
    render();
  };
  for (const id of ['pc-phases','pc-rating','pc-height','pc-category']) {
    const el = $(id);
    el.addEventListener('change', commit);
    if (el.tagName === 'INPUT') el.addEventListener('input', () => {
      clearTimeout(wire._t);
      wire._t = setTimeout(commit, 180);
    });
  }
  $('pc-apply').onclick = commit;
  $('pc-reset').onclick = () => {
    state.phases = '3'; state.rating = 32; state.height = 'any'; state.category = 'any';
    state.outlets = { C13: 20, C19: 4 };
    state.mfgs.clear();
    $('pc-phases').value = '3';
    $('pc-rating').value = 32;
    $('pc-height').value = 'any';
    $('pc-category').value = 'any';
    renderOutletInputs();
    render();
  };

  // Экшены
  $('pc-transfer-reqs').onclick = saveLastPduRequirementsOnly;
  $('pc-print').onclick = printRequirements;
  $('pc-export-md').onclick = exportMarkdown;

  // Ctrl+Enter → apply
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
  });
}

// ——— Boot ———
(async () => {
  try {
    await loadPdus();
  } catch (e) {
    console.error('[pdu-config] loadPdus failed:', e);
    document.getElementById('pc-results').innerHTML =
      `<div class="pc-empty">Ошибка загрузки библиотеки: ${esc(e.message || String(e))}</div>`;
  }
  wire();
  renderContextSummary();
  renderOutletInputs();
  render();
  renderPendingBanner();
  if (IS_EMBED) injectEmbedBar();
  if (!_pdus.length) {
    document.getElementById('pc-results').innerHTML =
      `<div class="pc-empty">Библиотека PDU пуста. Откройте <a href="../catalog/?filterKind=pdu">Каталог</a> — встроенные модели должны появиться автоматически.</div>`;
  }
})();
