// =========================================================================
// tech-workspace.js — v0.59.779 (Phase 20.1, скелет)
//
// Рабочее место технолога ЦОД. Концепция объекта на предпроектной стадии:
// количество стоек / IT-нагрузка / ИБП / климат / ввод (ТП+ДГУ) / PDU /
// площади / multi-variant compare / handoff в детальное проектирование.
//
// MVP реализует:
//   - Список вариантов (CRUD): add / duplicate / delete / make-primary
//   - Заполнение параметров по разделам (20.2-20.7)
//   - Real-time расчёт IT-нагрузки, доступной мощности ИБП, холода, площадей
//   - Storage в LS: raschet.project.<pid>.tech-workspace.variants.v1
//   - Переключатель режимов: Список / План (План — заглушка)
//   - Кнопки «Привязать модель…» — открывают catalog-picker (toast если
//     модуль каталога не подключён)
//
// Не реализовано (откладывается):
//   - Полноценный план зала с drag-drop (20.7 → отдельная фаза)
//   - DOCX-выгрузка пояснительной записки (20.9)
//   - Multi-variant compare side-by-side (20.10) — пока показывается один
//     вариант, переключение через клик на левой панели
//   - Handoff в schematic / scs-design / mdc-config (20.11)
// =========================================================================

import { ensureDefaultProject, projectKey } from '../shared/project-storage.js';

const $ = (id) => document.getElementById(id);

// ─── State
let _pid = null;
let _variants = []; // массив объектов варианта
let _activeId = null;
let _mode = 'list'; // 'list' | 'plan'

// ─── Storage
const KEY_VARIANTS = ['tech-workspace', 'variants.v1'];
const KEY_ACTIVE = ['tech-workspace', 'activeVariantId.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try {
    const raw = localStorage.getItem(projectKey(_pid, ...suffix));
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}

// ─── Variant data shape
function newVariant(name) {
  return {
    id: 'v-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Базовый вариант',
    primary: false,
    readOnly: false,
    createdAt: Date.now(),
    concept: {
      racks: { count: 0, kwPerRack: 0, profile: 'it', widthMm: 600, depthMm: 1200, modelRef: null },
      ups: { count: 2, ratedKva: 0, redundancy: 'N+1', cosPhi: 0.95, loadFactor: 0.8, autonomyMin: 15, batteryTech: 'vrla', modelRef: null },
      cooling: { count: 3, kwPerUnit: 0, type: 'crac', redundancy: 'N+1', modelRef: null },
      feed: {
        tp: { needed: false, kva: 0, redundancy: '2', modelRef: null },
        dgu: { needed: false, kw: 0, mode: 'esp', redundancy: 'N+1', modelRef: null },
      },
      pdu: { kind: 'metered', phases: '3ph', ratingA: 32, inputsPerRack: 2, modelRef: null },
    },
  };
}

// ─── Calculations
function calcITTotal(c) {
  return (Number(c.racks.count) || 0) * (Number(c.racks.kwPerRack) || 0);
}
function calcMachroomArea(c) {
  // Грубая оценка: 2.5 м²/стойка + проходы (×1.4 для hot/cold aisle)
  const N = Number(c.racks.count) || 0;
  return Math.round(N * 2.5 * 1.4);
}
function calcUpsAvailable(c) {
  const u = c.ups;
  const count = Number(u.count) || 0;
  const reserve = u.redundancy === 'N+1' ? 1 : (u.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  const kva = Number(u.ratedKva) || 0;
  const cos = Number(u.cosPhi) || 0.95;
  const lf = Number(u.loadFactor) || 0.8;
  return Math.round(N * kva * cos * lf * 10) / 10;
}
function calcCoolAvailable(c) {
  const co = c.cooling;
  const count = Number(co.count) || 0;
  const reserve = co.redundancy === 'N+1' ? 1 : (co.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  return Math.round(N * (Number(co.kwPerUnit) || 0) * 10) / 10;
}
function calcFeedTotal(c) {
  // Принятая мощность объекта = max(ТП, IT × 1.3 c учётом потерь и климата)
  const itTotal = calcITTotal(c);
  const climateLoss = itTotal * 0.3; // 30% на климат + потери
  const totalNeeded = itTotal + climateLoss;
  const tp = c.feed.tp.needed ? Number(c.feed.tp.kva) || 0 : 0;
  return Math.max(totalNeeded, tp * 0.8); // tp в кВА → kW при cos=0.8
}
function calcAreas(c) {
  const N = Number(c.racks.count) || 0;
  const upsCount = Number(c.ups.count) || 0;
  const upsKva = Number(c.ups.ratedKva) || 0;
  const coolCount = Number(c.cooling.count) || 0;
  // Очень грубо. Минимумы по ТКП 308-2011 / TIA-942.
  const areas = [
    { name: 'Машзал (стойки)', m2: Math.max(20, Math.round(N * 2.5 * 1.4)) },
    { name: 'ИБП-зал', m2: Math.max(15, Math.round(upsCount * 4)) },
    { name: 'АКБ-зал (VRLA)', m2: c.ups.batteryTech === 'vrla' ? Math.max(10, Math.round(upsCount * upsKva * 0.012)) : 0 },
    { name: 'Климат-зал', m2: Math.max(20, Math.round(coolCount * 6)) },
    { name: 'ТП', m2: c.feed.tp.needed ? Math.max(20, Math.round((Number(c.feed.tp.kva) || 0) * 0.025)) : 0 },
    { name: 'ДГУ-зал', m2: c.feed.dgu.needed ? Math.max(30, Math.round((Number(c.feed.dgu.kw) || 0) * 0.04)) : 0 },
    { name: 'Склад', m2: 15 },
    { name: 'Диспетчерская', m2: 12 },
  ].filter(a => a.m2 > 0);
  return areas;
}

// ─── Render
function renderVariantsList() {
  const root = $('tw-variants-list');
  if (!root) return;
  if (!_variants.length) {
    root.innerHTML = '<div class="muted tw-no-variants">Нет вариантов. Нажмите ➕</div>';
    return;
  }
  root.innerHTML = _variants.map(v => {
    const active = v.id === _activeId ? ' active' : '';
    const primary = v.primary ? ' <span class="tw-badge-primary" title="Основной вариант">⭐</span>' : '';
    const readonly = v.readOnly ? ' <span class="tw-badge-readonly" title="Передан в проектирование">🔒</span>' : '';
    return `<div class="tw-variant-row${active}" data-vid="${v.id}">
      <span class="tw-variant-name" title="${escAttr(v.name)}">${escHtml(v.name)}</span>
      ${primary}${readonly}
      <span class="tw-variant-actions">
        <button type="button" data-act="primary" data-vid="${v.id}" title="Сделать основным">⭐</button>
        <button type="button" data-act="duplicate" data-vid="${v.id}" title="Дублировать">📋</button>
        <button type="button" data-act="delete" data-vid="${v.id}" title="Удалить">🗑</button>
      </span>
    </div>`;
  }).join('');
}

function renderActiveVariant() {
  const v = _variants.find(x => x.id === _activeId);
  const empty = $('tw-empty-state');
  const listPane = $('tw-mode-list');
  const planPane = $('tw-mode-plan');
  const handoffBtn = $('tw-handoff');
  if (!v) {
    if (empty) empty.style.display = 'flex';
    if (listPane) listPane.hidden = true;
    if (planPane) planPane.hidden = true;
    if (handoffBtn) handoffBtn.disabled = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (handoffBtn) handoffBtn.disabled = !!v.readOnly;
  // mode panes
  if (listPane) listPane.hidden = (_mode !== 'list');
  if (planPane) planPane.hidden = (_mode !== 'plan');
  // Header
  $('tw-variant-name').textContent = v.name + (v.primary ? ' ⭐' : '');
  $('tw-readonly-badge').hidden = !v.readOnly;
  const c = v.concept;
  // Sync inputs
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
  const setChk = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
  setVal('tw-rack-count', c.racks.count);
  setVal('tw-rack-kw', c.racks.kwPerRack);
  setVal('tw-rack-profile', c.racks.profile);
  setVal('tw-rack-width', c.racks.widthMm);
  setVal('tw-rack-depth', c.racks.depthMm);
  setVal('tw-ups-count', c.ups.count);
  setVal('tw-ups-kva', c.ups.ratedKva);
  setVal('tw-ups-redundancy', c.ups.redundancy);
  setVal('tw-ups-cosphi', c.ups.cosPhi);
  setVal('tw-ups-load', Math.round((c.ups.loadFactor || 0.8) * 100));
  setVal('tw-ups-autonomy', c.ups.autonomyMin);
  setVal('tw-ups-battery', c.ups.batteryTech);
  setVal('tw-cool-count', c.cooling.count);
  setVal('tw-cool-kw', c.cooling.kwPerUnit);
  setVal('tw-cool-type', c.cooling.type);
  setVal('tw-cool-redundancy', c.cooling.redundancy);
  setChk('tw-tp-needed', c.feed.tp.needed);
  setVal('tw-tp-kva', c.feed.tp.kva);
  setVal('tw-tp-redundancy', c.feed.tp.redundancy);
  setChk('tw-dgu-needed', c.feed.dgu.needed);
  setVal('tw-dgu-kw', c.feed.dgu.kw);
  setVal('tw-dgu-mode', c.feed.dgu.mode);
  setVal('tw-dgu-redundancy', c.feed.dgu.redundancy);
  setVal('tw-pdu-kind', c.pdu.kind);
  setVal('tw-pdu-phases', c.pdu.phases);
  setVal('tw-pdu-rating', String(c.pdu.ratingA));
  setVal('tw-pdu-inputs', String(c.pdu.inputsPerRack));
  // Disable inputs if readOnly
  document.querySelectorAll('.tw-content input, .tw-content select').forEach(el => {
    el.disabled = !!v.readOnly;
  });
  // Compute summaries
  const itKw = calcITTotal(c);
  const machM2 = calcMachroomArea(c);
  const upsKw = calcUpsAvailable(c);
  const coolKw = calcCoolAvailable(c);
  const feedKw = calcFeedTotal(c);
  $('tw-it-total').textContent = itKw.toFixed(1);
  $('tw-machroom-area').textContent = machM2;
  $('tw-ups-available').textContent = upsKw.toFixed(1);
  $('tw-ups-margin').textContent = (itKw > 0)
    ? (upsKw >= itKw ? `✓ +${(upsKw - itKw).toFixed(1)} кВт` : `⚠ −${(itKw - upsKw).toFixed(1)} кВт`)
    : '—';
  $('tw-cool-available').textContent = coolKw.toFixed(1);
  $('tw-cool-margin').textContent = (itKw > 0)
    ? (coolKw >= itKw ? `✓ +${(coolKw - itKw).toFixed(1)} кВт` : `⚠ −${(itKw - coolKw).toFixed(1)} кВт`)
    : '—';
  $('tw-feed-total').textContent = feedKw.toFixed(1);
  // Areas table
  const areas = calcAreas(c);
  const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
  const areasRoot = $('tw-areas-table');
  if (areasRoot) {
    areasRoot.innerHTML = `<table class="tw-areas">
      <thead><tr><th>Помещение</th><th class="num">Площадь, м²</th></tr></thead>
      <tbody>${areas.map(a => `<tr><td>${escHtml(a.name)}</td><td class="num">${a.m2}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Σ</b></td><td class="num"><b>${sumM2}</b></td></tr></tfoot>
    </table>`;
  }
  // Summary line
  $('tw-content-summary').textContent = `${c.racks.count} стоек × ${c.racks.kwPerRack} кВт = ${itKw.toFixed(1)} кВт IT · Σ ${sumM2} м²`;
}

// ─── Persistence
function persistVariants() { saveJson(KEY_VARIANTS, _variants); }
function persistActive() { saveJson(KEY_ACTIVE, _activeId); }

// ─── Field bindings (input → variant.concept.*)
function bindInputs() {
  const set = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const v = () => _variants.find(x => x.id === _activeId);
  const onChange = () => { renderActiveVariant(); persistVariants(); };
  set('tw-rack-count', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.racks.count = Number(e.target.value) || 0; onChange(); });
  set('tw-rack-kw', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.racks.kwPerRack = Number(e.target.value) || 0; onChange(); });
  set('tw-rack-profile', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.racks.profile = e.target.value; onChange(); });
  set('tw-rack-width', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.racks.widthMm = Number(e.target.value) || 600; onChange(); });
  set('tw-rack-depth', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.racks.depthMm = Number(e.target.value) || 1200; onChange(); });
  set('tw-ups-count', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.count = Number(e.target.value) || 0; onChange(); });
  set('tw-ups-kva', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.ratedKva = Number(e.target.value) || 0; onChange(); });
  set('tw-ups-redundancy', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.redundancy = e.target.value; onChange(); });
  set('tw-ups-cosphi', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.cosPhi = Number(e.target.value) || 0.95; onChange(); });
  set('tw-ups-load', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.loadFactor = (Number(e.target.value) || 80) / 100; onChange(); });
  set('tw-ups-autonomy', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.autonomyMin = Number(e.target.value) || 15; onChange(); });
  set('tw-ups-battery', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.ups.batteryTech = e.target.value; onChange(); });
  set('tw-cool-count', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.cooling.count = Number(e.target.value) || 0; onChange(); });
  set('tw-cool-kw', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.cooling.kwPerUnit = Number(e.target.value) || 0; onChange(); });
  set('tw-cool-type', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.cooling.type = e.target.value; onChange(); });
  set('tw-cool-redundancy', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.cooling.redundancy = e.target.value; onChange(); });
  set('tw-tp-needed', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.tp.needed = !!e.target.checked; onChange(); });
  set('tw-tp-kva', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.tp.kva = Number(e.target.value) || 0; onChange(); });
  set('tw-tp-redundancy', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.tp.redundancy = e.target.value; onChange(); });
  set('tw-dgu-needed', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.dgu.needed = !!e.target.checked; onChange(); });
  set('tw-dgu-kw', 'input', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.dgu.kw = Number(e.target.value) || 0; onChange(); });
  set('tw-dgu-mode', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.dgu.mode = e.target.value; onChange(); });
  set('tw-dgu-redundancy', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.feed.dgu.redundancy = e.target.value; onChange(); });
  set('tw-pdu-kind', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.pdu.kind = e.target.value; onChange(); });
  set('tw-pdu-phases', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.pdu.phases = e.target.value; onChange(); });
  set('tw-pdu-rating', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.pdu.ratingA = Number(e.target.value) || 32; onChange(); });
  set('tw-pdu-inputs', 'change', e => { const cur = v(); if (!cur || cur.readOnly) return; cur.concept.pdu.inputsPerRack = Number(e.target.value) || 2; onChange(); });
}

// ─── Variant CRUD
function addVariant() {
  const name = `Вариант ${_variants.length + 1}`;
  const v = newVariant(name);
  if (_variants.length === 0) v.primary = true;
  _variants.push(v);
  _activeId = v.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function duplicateVariant(id) {
  const src = _variants.find(v => v.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'v-' + Math.random().toString(36).slice(2, 10);
  copy.name = src.name + ' (копия)';
  copy.primary = false;
  copy.readOnly = false;
  copy.createdAt = Date.now();
  _variants.push(copy);
  _activeId = copy.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function deleteVariant(id) {
  const idx = _variants.findIndex(v => v.id === id);
  if (idx < 0) return;
  if (!confirm(`Удалить вариант «${_variants[idx].name}»? Действие необратимо.`)) return;
  _variants.splice(idx, 1);
  if (_activeId === id) _activeId = _variants[0]?.id || null;
  // Если удалили primary — назначаем primary первому оставшемуся
  if (!_variants.some(v => v.primary) && _variants.length > 0) {
    _variants[0].primary = true;
  }
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function makePrimary(id) {
  for (const v of _variants) v.primary = (v.id === id);
  persistVariants();
  renderVariantsList(); renderActiveVariant();
}

// ─── Mode toggle
function setMode(mode) {
  _mode = (mode === 'plan') ? 'plan' : 'list';
  document.querySelectorAll('.tw-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
  renderActiveVariant();
}

// ─── Bind-model buttons (placeholders)
function bindModelButtons() {
  document.querySelectorAll('.tw-bind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dom = btn.dataset.bindDomain;
      const map = {
        rack: 'стойка', ups: 'ИБП', cool: 'кондиционер',
        tp: 'трансформатор', dgu: 'ДГУ', pdu: 'PDU',
      };
      alert(`📦 Привязка модели «${map[dom] || dom}» к каталогу — функция в разработке (Phase 20.1.x).\n\nПосле подключения catalog-picker откроется модалка выбора конкретной модели.`);
    });
  });
}

// ─── Handoff (placeholder)
function bindHandoff() {
  const btn = $('tw-handoff');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const v = _variants.find(x => x.id === _activeId);
    if (!v || v.readOnly) return;
    if (!confirm(`📤 Передать вариант «${v.name}» в детальное проектирование?\n\nПосле передачи variant станет read-only. Параметры будут предзаполнены в schematic / scs-design / mdc-config.\n\nПродолжить?`)) return;
    v.readOnly = true;
    v.handoffAt = Date.now();
    persistVariants();
    renderVariantsList(); renderActiveVariant();
    alert(`✓ Вариант передан в проектирование.\n\nHandoff-логика (заполнение schematic/scs-design/mdc-config) — в разработке (Phase 20.11).`);
  });
}

// ─── Main
function init() {
  _pid = ensureDefaultProject();
  _variants = loadJson(KEY_VARIANTS, []);
  _activeId = loadJson(KEY_ACTIVE, null);
  if (!_variants.length) {
    // Авто-создание базового варианта при первом входе
    addVariant();
  } else if (!_variants.some(v => v.id === _activeId)) {
    _activeId = _variants[0].id;
  }
  renderVariantsList();
  renderActiveVariant();
  bindInputs();
  bindModelButtons();
  bindHandoff();
  // Левая панель: клик по варианту / actions
  $('tw-variants-list').addEventListener('click', (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const vid = actBtn.dataset.vid;
      const act = actBtn.dataset.act;
      if (act === 'duplicate') duplicateVariant(vid);
      else if (act === 'delete') deleteVariant(vid);
      else if (act === 'primary') makePrimary(vid);
      return;
    }
    const row = e.target.closest('.tw-variant-row');
    if (row) {
      _activeId = row.dataset.vid;
      persistActive();
      renderVariantsList();
      renderActiveVariant();
    }
  });
  // Add variant
  $('tw-variant-add').addEventListener('click', addVariant);
  // Mode toggle
  document.querySelectorAll('.tw-mode-btn').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
}

// ─── Utils
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return escHtml(s); }

document.addEventListener('DOMContentLoaded', init);
