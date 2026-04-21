// ======================================================================
// pdu-config/pdu-config.js
// Standalone-модуль подбора PDU из единой библиотеки элементов.
// Источник данных: listElements({kind:'pdu'}) из shared/element-library.js
// (через catalog-bridge → shared/rack-catalog-data.js seed'ы).
// ======================================================================

import { listElements } from '../shared/element-library.js';
import { initCatalogBridge, syncLegacyToLibrary } from '../shared/catalog-bridge.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ——— State ———
const state = {
  phases: '3',           // '1' | '3' | 'any'
  rating: 32,            // минимум по вводу, A
  height: 'any',         // '0U' | '1U' | '2U' | 'any'
  category: 'any',       // basic | metered | monitored | switched | hybrid | any
  outlets: { c13: 16, c19: 4, schuko: 0 },
  mfgs: new Set(),       // пустой = все
};

const CATEGORY_LABEL = {
  basic: 'Basic',
  metered: 'Metered',
  monitored: 'Monitored',
  switched: 'Switched',
  hybrid: 'Hybrid',
};

// ——— Загрузка данных ———
let _pdus = [];
async function loadPdus() {
  initCatalogBridge();
  // syncLegacyToLibrary уже вызывается bridge'ом при init, но нам надо
  // дождаться — повторный вызов дешёвый (дебаунс + in-flight guard).
  await syncLegacyToLibrary();
  _pdus = listElements({ kind: 'pdu' });
  return _pdus;
}

// ——— Подсчёт розеток в модели ———
function countOutlets(pdu) {
  const outlets = pdu.kindProps?.outlets || [];
  let c13 = 0, c19 = 0, schuko = 0, other = 0;
  for (const o of outlets) {
    const type = String(o.type || '').toLowerCase();
    const qty = Number(o.qty ?? o.count) || 0;
    if (type === 'c13') c13 += qty;
    else if (type === 'c19') c19 += qty;
    else if (type === 'schuko' || type === 'cee7/4' || type === 'cee7') schuko += qty;
    else other += qty;
  }
  return { c13, c19, schuko, other, total: c13 + c19 + schuko + other };
}

// ——— Score + фильтры ———
function scoreCandidate(pdu) {
  const kp = pdu.kindProps || {};
  const el = pdu.electrical || {};
  const reasons = [];
  let score = 0;
  const max = 100;

  // Жёсткие фильтры — вернут -1 если не подходит.
  if (state.phases !== 'any' && String(kp.phases || el.phases || '') !== state.phases) return null;
  if (state.category !== 'any' && kp.category !== state.category) return null;
  if (state.height !== 'any' && String(kp.height) !== String(state.height)) return null;
  if (state.mfgs.size > 0 && !state.mfgs.has(pdu.manufacturer)) return null;

  // Rating — должен быть ≥ запрошенного.
  const rating = Number(kp.rating || el.capacityA || 0);
  if (rating < state.rating) return null;

  // Outlets coverage (50 pts)
  const has = countOutlets(pdu);
  const need = state.outlets;
  const covC13    = need.c13 === 0    ? 1 : Math.min(1, has.c13    / need.c13);
  const covC19    = need.c19 === 0    ? 1 : Math.min(1, has.c19    / need.c19);
  const covSchuko = need.schuko === 0 ? 1 : Math.min(1, has.schuko / need.schuko);
  const covAll = (covC13 + covC19 + covSchuko) / 3;
  if (covAll < 1 && (need.c13 || need.c19 || need.schuko)) {
    // частичное покрытие — пропускаем (пользователь получит только полностью покрывающие)
    return null;
  }
  score += 50 * covAll;

  // Rating closeness (20 pts): чем ближе rating к state.rating (но не меньше) — тем лучше
  const ratingRatio = state.rating / rating;  // 1.0 = идеально
  score += 20 * Math.max(0, ratingRatio);

  // Outlet overhead penalty (минимальный перерасход розеток предпочтителен): (15 pts)
  const needTotal = need.c13 + need.c19 + need.schuko;
  const overhead = needTotal > 0 ? Math.max(0, has.total - needTotal) / Math.max(1, has.total) : 0;
  score += 15 * (1 - overhead);

  // Category exact vs 'any' (5 pts)
  if (state.category !== 'any') score += 5;

  // Height exact vs 'any' (5 pts)
  if (state.height !== 'any') score += 5;

  // Bonuses / reasons
  reasons.push(`розетки: C13×${has.c13}, C19×${has.c19}, Schuko×${has.schuko}`);
  reasons.push(`${rating} A (запрошено ≥${state.rating})`);
  if (kp.height) reasons.push(kp.height);
  if (kp.categoryLabel) reasons.push(kp.categoryLabel);

  return {
    score: Math.min(max, Math.round(score)),
    reasons,
    outlets: has,
  };
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
  // Mfg chips (на основе всех доступных PDU)
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

  // Results
  const ranked = rank();
  const countEl = document.getElementById('pc-count');
  countEl.textContent = `· найдено: ${ranked.length} из ${_pdus.length}`;

  const box = document.getElementById('pc-results');
  if (!ranked.length) {
    box.innerHTML = `<div class="pc-empty">
      Нет подходящих моделей. Попробуйте снизить требования — например, уменьшить число розеток,
      выбрать другую категорию или расширить фильтр по производителю.
    </div>`;
    return;
  }

  const rows = ranked.map(r => {
    const p = r.pdu;
    const kp = p.kindProps || {};
    const bar = `<div class="pc-score-bar"><i style="width:${r.score}%"></i></div>`;
    return `
      <tr data-id="${esc(p.id)}">
        <td><b>${esc(p.manufacturer || '—')}</b><br>
            <span class="muted" style="font-size:10px;font-family:monospace">${esc(kp.sku || p.variant || p.id)}</span></td>
        <td>${esc(p.label)}</td>
        <td>${esc(kp.categoryLabel || kp.category || '—')}</td>
        <td class="pc-row-score">${r.score} ${bar}</td>
        <td><button class="pc-btn" data-act="detail">Детали</button></td>
      </tr>`;
  }).join('');

  box.innerHTML = `
    <table class="pc-results-table">
      <thead>
        <tr>
          <th>Производитель / SKU</th>
          <th>Модель</th>
          <th>Категория</th>
          <th>Score</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  box.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('button[data-act="detail"]').onclick = () => openDetail(id);
    tr.style.cursor = 'pointer';
  });
}

// ——— Detail modal ———
function openDetail(id) {
  const p = _pdus.find(x => x.id === id);
  if (!p) return;
  const kp = p.kindProps || {};
  const outlets = kp.outlets || [];
  const rows = outlets.map(o => `<tr><td>${esc(o.type)}</td><td>${Number(o.qty ?? o.count) || 0}</td></tr>`).join('');
  const sku = kp.sku || p.variant || p.id;
  const body = `
    <div>
      <div><b>${esc(p.label)}</b></div>
      <div class="muted" style="font-size:11px">${esc(p.manufacturer || '')} · ${esc(sku)}</div>
      <hr>
      <div style="font-size:12px;line-height:1.8">
        <div><b>Категория:</b> ${esc(kp.categoryLabel || kp.category || '—')}</div>
        <div><b>Фаз:</b> ${kp.phases || '—'}</div>
        <div><b>Номинал:</b> ${kp.rating || '—'} A</div>
        <div><b>Высота:</b> ${kp.height === 0 || kp.height === '0' ? '0U (вертикальный)' : (kp.height ? kp.height + 'U' : '—')}</div>
      </div>
      <h4 style="margin-top:14px;font-size:13px">Розетки</h4>
      <table class="pc-results-table"><thead><tr><th>Тип</th><th>Кол-во</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="pc-empty">нет данных</td></tr>'}</tbody></table>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #eee;padding-top:12px">
        <button id="pc-detail-pick" class="pc-btn pc-btn-primary">⬆ Выбрать эту модель</button>
        <button id="pc-detail-open-rack" class="pc-btn">Открыть Конфигуратор стойки →</button>
      </div>
      <div class="muted" style="font-size:11px;margin-top:6px;line-height:1.5">
        «Выбрать» сохранит модель в <code>raschet.lastPduConfig.v1</code>. В модалке подбора PDU
        Конфигуратора стойки появится кнопка «⬇ Применить из Конфигуратора» — один клик и PDU
        подставится в нужный ввод.
      </div>
    </div>`;
  const modal = document.getElementById('pc-modal');
  document.getElementById('pc-modal-title').textContent = p.label;
  document.getElementById('pc-modal-body').innerHTML = body;
  modal.hidden = false;
  modal.querySelector('.rc-modal-close').onclick = () => (modal.hidden = true);
  modal.querySelector('.rc-modal-backdrop').onclick = () => (modal.hidden = true);
  document.getElementById('pc-detail-pick').onclick = () => {
    saveLastPdu(p);
    modal.hidden = true;
    renderPendingBanner();
  };
  document.getElementById('pc-detail-open-rack').onclick = () => {
    saveLastPdu(p);
    location.href = '../rack-config/';
  };
}

// ——— Handoff: standalone pick → rack-config ———
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
  };
  try {
    localStorage.setItem('raschet.lastPduConfig.v1', JSON.stringify(payload));
  } catch {}
}

function renderPendingBanner() {
  let el = document.getElementById('pc-pending-banner');
  let last = null;
  try {
    const raw = localStorage.getItem('raschet.lastPduConfig.v1');
    if (raw) last = JSON.parse(raw);
  } catch {}
  const fresh = last && last.sku && last.selectedAt && (Date.now() - last.selectedAt) < 24 * 60 * 60 * 1000;
  if (!fresh) {
    if (el) el.remove();
    return;
  }
  const ageMin = Math.round((Date.now() - last.selectedAt) / 60000);
  const ageStr = ageMin < 60 ? (ageMin + ' мин назад') : (Math.round(ageMin / 60) + ' ч назад');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pc-pending-banner';
    el.style.cssText = 'margin:0 auto 14px;max-width:1400px;padding:10px 14px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const wrap = document.querySelector('.pc-wrap');
    if (wrap) wrap.before(el);
  }
  el.innerHTML = `
    <span>✓ Сейчас выбрано: <b>${esc(last.manufacturer)} · ${esc(last.label)}</b>
      <span class="muted" style="font-size:11px">(${ageStr})</span>
      <span class="muted" style="font-size:11px">· ${last.phases || '?'}ф · ${last.rating || '?'} A · ${last.height === 0 ? '0U' : (last.height + 'U')}</span></span>
    <span class="muted" style="font-size:11px;flex:1;min-width:200px">В Конфигураторе стойки → PDU → «Каталог» → «⬇ Применить из Конфигуратора».</span>
    <button id="pc-pending-clear" class="pc-btn">✕ Сбросить</button>
  `;
  el.querySelector('#pc-pending-clear').onclick = () => {
    try { localStorage.removeItem('raschet.lastPduConfig.v1'); } catch {}
    renderPendingBanner();
  };
}
// Обновляем «X мин назад» раз в минуту
setInterval(() => { try { renderPendingBanner(); } catch {} }, 60000);

// ——— Wire form ———
function wire() {
  const $ = id => document.getElementById(id);
  const commit = () => {
    state.phases = $('pc-phases').value;
    state.rating = Number($('pc-rating').value) || 0;
    state.height = $('pc-height').value;
    state.category = $('pc-category').value;
    state.outlets.c13    = Number($('pc-outlets-c13').value) || 0;
    state.outlets.c19    = Number($('pc-outlets-c19').value) || 0;
    state.outlets.schuko = Number($('pc-outlets-schuko').value) || 0;
    render();
  };
  for (const id of ['pc-phases','pc-rating','pc-height','pc-category',
                     'pc-outlets-c13','pc-outlets-c19','pc-outlets-schuko']) {
    const el = $(id);
    el.addEventListener('change', commit);
    if (el.tagName === 'INPUT') el.addEventListener('input', () => {
      // debounce простой — input → commit
      clearTimeout(wire._t);
      wire._t = setTimeout(commit, 180);
    });
  }
  $('pc-apply').onclick = commit;
  $('pc-reset').onclick = () => {
    state.phases = '3'; state.rating = 32; state.height = 'any'; state.category = 'any';
    state.outlets = { c13: 16, c19: 4, schuko: 0 };
    state.mfgs.clear();
    $('pc-phases').value = '3';
    $('pc-rating').value = 32;
    $('pc-height').value = 'any';
    $('pc-category').value = 'any';
    $('pc-outlets-c13').value = 16;
    $('pc-outlets-c19').value = 4;
    $('pc-outlets-schuko').value = 0;
    render();
  };

  // Ctrl+Enter → apply
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
  });
}

// ——— Boot ———
(async () => {
  await loadPdus();
  wire();
  render();
  renderPendingBanner();
  if (!_pdus.length) {
    document.getElementById('pc-results').innerHTML =
      `<div class="pc-empty">Библиотека PDU пуста. Откройте «Каталог и библиотеку элементов» — встроенные модели должны появиться автоматически (shared/rack-catalog-data.js).</div>`;
  }
})();
