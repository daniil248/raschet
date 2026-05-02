// =============================================================================
// service/service.js — orchestrator модуля «Сервис: монтаж и ТО»
// =============================================================================
// Phase 24.1 (по требованию Пользователя 2026-05-02): «отдельный модуль расчёта
// стоимости технического обслуживания и стоимости монтажных работ, где инженер
// сервиса сможет формировать стоимость себеса и стоимости для клиента по
// монтажным и сервисным работам по проекту или разовые работы».
//
// Архитектурный паттерн идентичен cooling/cooling.js:
//   - 3 режима: standalone (?standalone=1) / project (?pid=...) / embed (?return=...)
//   - sidebar: список нарядов + переключатель контекста
//   - content: форма активного наряда (ui/order-form.js)
//   - per-context state: orders[], activeOrderId

// v0.60.37: explicit load-marker для диагностики кеша/import-проблем
console.info('%c[service v0.60.37] script LOADED', 'color:#16a34a;font-weight:bold');

import { detectNavMode, renderModuleActions, completeReturn, cancelReturn } from '../shared/module-nav.js';
import { ensureDefaultProject, projectKey, listProjects, getProject, setActiveProjectId, createProject } from '../shared/project-storage.js';
import { fetchRates, convert as convertRate } from '../shared/currency-rates/index.js';
import * as util from '../meteo/util.js';
import { CURRENCIES, currencyToIso } from '../cooling/calc/fc-summary.js';
import { DEFAULT_ORDER, ORDER_TYPES, defaultPosition } from './calc/order-model.js';
import { renderOrderForm } from './ui/order-form.js';
import {
  buildInstallPositionsFromCoolingOption,
  buildMaintenancePositionsFromCoolingOption,
  loadCoolingSelectionsForContext,
} from './calc/order-builder.js';

const $ = (id) => document.getElementById(id);

// ---- State ----
let _pid = null;
let _standalone = false;
let _navMode = null;
let _navReturn = null;
let _orders = [];
let _activeOrderId = null;
let _currency = '₽';
let _ratesDate = (() => {
  try { return localStorage.getItem('service.ratesDate.v1') || new Date().toISOString().slice(0, 10); }
  catch { return new Date().toISOString().slice(0, 10); }
})();
let _ratesCache = null;
let _ratesLoading = false;
let _seq = 1;

// ---- LS keys ----
const KEY_ORDERS    = ['service', 'orders.v1'];
const KEY_ACTIVE_ID = ['service', 'activeOrderId.v1'];
const KEY_CURRENCY  = ['service', 'currency.v1'];

function storageKey(suffix) {
  if (_standalone) return `raschet.service.standalone.${suffix.join('.')}`;
  return projectKey(_pid?.id, ...suffix);
}
function loadJson(suffix, fallback) {
  try { const raw = localStorage.getItem(storageKey(suffix)); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function saveJson(suffix, value) {
  try { localStorage.setItem(storageKey(suffix), JSON.stringify(value)); } catch {}
}
function persist() {
  saveJson(KEY_ORDERS, _orders);
  saveJson(KEY_ACTIVE_ID, _activeOrderId);
  saveJson(KEY_CURRENCY, _currency);
}

async function ensureRatesLoaded() {
  if (_ratesLoading) return;
  if (_ratesCache && _ratesCache.date === _ratesDate) return;
  _ratesLoading = true;
  try { _ratesCache = await fetchRates(null, _ratesDate, false); }
  catch {} finally { _ratesLoading = false; }
}
function makeConvertFn() {
  if (!_ratesCache) return null;
  return (amount, from, to) => {
    const fromIso = currencyToIso(from);
    const toIso = currencyToIso(to);
    return convertRate(amount, fromIso, toIso, _ratesCache);
  };
}

// ---- Active ----
function activeOrder() {
  return _orders.find(o => o.id === _activeOrderId) || null;
}

// ---- Render ----
function renderContextPicker() {
  const el = $('sv-context-picker');
  if (!el) {
    console.warn('[service v0.60.30] sv-context-picker не найден в DOM');
    return;
  }
  try {
    _renderContextPickerInner(el);
  } catch (e) {
    console.error('[service v0.60.30] Ошибка renderContextPicker:', e);
    el.innerHTML = `<div style="padding:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;font-size:11px;color:#b91c1c">⚠ Ошибка загрузки контекста: ${util.escHtml(e.message || String(e))}. Откройте DevTools → Console для деталей.</div>`;
  }
  // v0.60.30: явный маркер версии — если виден «service v0.60.30», то JS работает
  if (!el.innerHTML || el.innerHTML.length < 50) {
    el.innerHTML = `<div style="padding:6px;background:#fff7ed;border:1px solid #fdba74;border-radius:3px;font-size:11px;color:#9a3412">⚠ service v0.60.30 init: picker не отрендерился (innerHTML пустой). Откройте DevTools → Console.</div>`;
  }
}

function _renderContextPickerInner(el) {
  if (_navMode === 'embed' && _navReturn) {
    el.innerHTML = `<span title="Embed-режим: модуль вызван из «${util.escAttr(_navReturn.label)}». После работы нажмите «✓ Применить и вернуться».">🔗 Embed: вернуться в <b>${util.escHtml(_navReturn.label)}</b></span>`;
    return;
  }
  let projects = [];
  try { projects = listProjects() || []; } catch {}
  const currentVal = _standalone ? '__standalone__' : ((_pid && _pid.id) || '__standalone__');

  const groups = { svcLocal: [], withSvc: [], others: [] };
  for (const p of projects) {
    if (p.kind === 'sketch' && p.ownerModule === 'service') groups.svcLocal.push(p);
    else if (projectHasServiceData(p.id)) groups.withSvc.push(p);
    else groups.others.push(p);
  }
  const optEl = (p, icon) =>
    `<option value="${util.escAttr(p.id)}"${currentVal === p.id ? ' selected' : ''} title="Наряды будут сохранены в проекте «${util.escAttr(p.name || p.id)}»">${icon} ${util.escHtml(p.name || p.id)}</option>`;
  const grpHtml = (label, opts) => opts.length
    ? `<optgroup label="${util.escAttr(label)}">${opts.join('')}</optgroup>` : '';

  const optsHtml = `
    <option value="__standalone__"${currentVal === '__standalone__' ? ' selected' : ''} title="Разовый наряд — данные хранятся в общем LocalStorage без привязки к проекту.">🔓 Без проекта (разовый)</option>
    <option value="__new_local__" title="Создать новый ЛОКАЛЬНЫЙ контейнер сервисных нарядов (sketch-проект, ownerModule=service).">➕ Создать новый локальный кейс…</option>
    ${grpHtml('🛠 Локальные кейсы сервиса', groups.svcLocal.map(p => optEl(p, '🛠')))}
    ${grpHtml('💼 Проекты с нарядами',       groups.withSvc.map(p => optEl(p, '💼')))}
    ${grpHtml('📁 Прочие проекты',           groups.others.map(p => optEl(p, '📁')))}
  `;
  el.innerHTML = `
    <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px" title="Контекст хранения нарядов сервиса.">КОНТЕКСТ КЕЙСА</label>
    <select id="sv-context-sel" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:12px;background:#fff;cursor:pointer">${optsHtml}</select>
  `;
  const sel = el.querySelector('#sv-context-sel');
  if (sel) sel.addEventListener('change', async () => {
    const v = sel.value;
    if (v === '__standalone__') {
      const url = new URL(location.href);
      url.searchParams.set('standalone', '1');
      url.searchParams.delete('pid');
      location.href = url.toString();
      return;
    }
    if (v === '__new_local__') {
      sel.value = currentVal;
      const name = await svPrompt('Название локального кейса', `Сервис ${new Date().toLocaleDateString('ru-RU')}`);
      if (!name?.trim()) return;
      try {
        const p = createProject({
          name: name.trim(),
          description: 'Локальный кейс сервиса (ownerModule=service).',
          kind: 'sketch', ownerModule: 'service', status: 'draft',
        });
        const url = new URL(location.href);
        url.searchParams.delete('standalone');
        url.searchParams.set('pid', p.id);
        location.href = url.toString();
      } catch (e) {
        util.toast(`Не удалось создать: ${e.message}`, 'err');
      }
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('standalone');
    url.searchParams.set('pid', v);
    location.href = url.toString();
  });
}

/* v0.60.29: rich empty-state — большие CTA + список cooling-подборов
   текущего контекста для one-click создания нарядов. */
function renderRichEmptyState(host) {
  if (!host) return;
  const params = new URLSearchParams(location.search);
  const pid = params.get('standalone') === '1' ? null : (params.get('pid') || _pid?.id || null);
  const selections = loadCoolingSelectionsForContext(pid);
  const cardsHtml = selections.flatMap(sel => {
    return (sel.options || []).map(opt => {
      const eqCount = (opt.equipment || []).length;
      const totalQty = (opt.equipment || []).reduce((s, eq) => s + (Number(eq.qty) || 0), 0);
      return `<div class="sv-cool-card" data-sel-id="${util.escAttr(sel.id)}" data-opt-id="${util.escAttr(opt.id)}" title="Создать наряд монтажа на основе этой cooling-опции (${eqCount} групп оборудования, Σ qty=${totalQty}). Можно потом переключить тип на ТО или Разовая.">
        <div class="sv-cool-card-title">${util.escHtml(sel.name)} → ${util.escHtml(opt.name)}</div>
        <div class="sv-cool-card-meta">${eqCount} групп · Σ qty = ${totalQty} шт</div>
        <div class="sv-cool-card-actions">
          <button type="button" class="sv-btn-ghost" data-quick-type="install" data-sel-id="${util.escAttr(sel.id)}" data-opt-id="${util.escAttr(opt.id)}" title="Создать наряд МОНТАЖА с авто-заполнением позиций">+ Монтаж</button>
          <button type="button" class="sv-btn-ghost" data-quick-type="maintenance" data-sel-id="${util.escAttr(sel.id)}" data-opt-id="${util.escAttr(opt.id)}" title="Создать наряд ТО (квартальное) с авто-заполнением позиций">+ ТО</button>
        </div>
      </div>`;
    });
  }).join('');

  host.innerHTML = `
    <div class="sv-empty-rich">
      <h3>🛠 Сервис: монтаж и ТО</h3>
      <p class="muted" style="font-size:13px;max-width:520px;margin:0 auto 12px">
        Расчёт стоимости работ для инженера сервиса: себестоимость + клиент-цена с маржой и НДС. По проекту или разовые работы.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:16px;flex-wrap:wrap">
        <button type="button" class="sv-btn-primary sv-cta-big" id="sv-empty-add">+ Создать пустой наряд</button>
      </div>
      ${selections.length ? `
        <div style="margin-top:18px;text-align:left">
          <h4 style="text-align:center;margin:0 0 8px;color:#475569;font-size:13px;text-transform:uppercase;letter-spacing:0.4px" title="Найдены cooling-подборы в текущем контексте. Один клик создаст наряд с авто-заполнением позиций (qty из топологии, цены — дефолтные по типу/мощности). Редактируйте после создания.">
            ❄ Создать из cooling-подбора (найдено опций: ${selections.reduce((s, x) => s + (x.options?.length || 0), 0)})
          </h4>
          <div class="sv-cool-cards">
            ${cardsHtml}
          </div>
        </div>
      ` : `
        <p class="muted" style="font-size:11.5px;margin-top:14px">
          ℹ Нет cooling-подборов в текущем контексте. Создайте подбор в модуле «❄ Подбор холодильных систем» — после этого здесь появятся карточки для one-click создания монтажных нарядов.
        </p>
      `}
    </div>
  `;
  // Wire CTA buttons
  const addBtn = host.querySelector('#sv-empty-add');
  if (addBtn) addBtn.addEventListener('click', () => $('sv-add-order')?.click());
  host.querySelectorAll('[data-quick-type]').forEach(btn => {
    btn.addEventListener('click', () => quickCreateFromCooling(
      btn.dataset.selId, btn.dataset.optId, btn.dataset.quickType
    ));
  });
}

/* v0.60.29: одно-клик создание наряда из cooling-подбора. */
function quickCreateFromCooling(selId, optId, type) {
  const params = new URLSearchParams(location.search);
  const pid = params.get('standalone') === '1' ? null : (params.get('pid') || _pid?.id || null);
  const selections = loadCoolingSelectionsForContext(pid);
  const sel = selections.find(s => s.id === selId);
  const opt = sel?.options?.find(o => o.id === optId);
  if (!sel || !opt) {
    util.toast('Подбор/опция не найдены', 'err');
    return;
  }
  const builder = (type === 'maintenance')
    ? buildMaintenancePositionsFromCoolingOption
    : buildInstallPositionsFromCoolingOption;
  const positions = builder(opt, _currency);
  if (!positions.length) {
    util.toast('У опции нет equipment-групп. Сначала задайте оборудование во вкладке Топология.', 'err');
    return;
  }
  const typeLabel = type === 'maintenance' ? 'ТО' : 'Монтаж';
  const newOrd = {
    ...DEFAULT_ORDER,
    id: 'ord-' + (_seq++),
    name: `${typeLabel}: ${sel.name} → ${opt.name}`,
    type,
    coolingSelectionId: sel.id,
    positions,
  };
  _orders.push(newOrd);
  _activeOrderId = newOrd.id;
  persist();
  renderActive();
  util.toast(`Наряд «${newOrd.name}» создан с ${positions.length} позициями`, 'ok');
}

function projectHasServiceData(pid) {
  if (!pid) return false;
  const prefix = `raschet.project.${pid}.service.`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const v = localStorage.getItem(k);
        if (v && v !== 'null' && v !== '[]') return true;
      }
    }
  } catch {}
  return false;
}

function renderOrdersList() {
  const root = $('sv-orders-list');
  if (!root) return;
  if (!_orders.length) {
    root.innerHTML = '<p class="muted" style="font-size:11.5px;padding:6px">Нарядов нет. Кнопка «+ Наряд» создаст первый.</p>';
    return;
  }
  root.innerHTML = _orders.map(o => {
    const isActive = o.id === _activeOrderId;
    const tLabel = ORDER_TYPES.find(t => t.id === o.type)?.label || o.type;
    return `<div class="sv-order-row${isActive ? ' active' : ''}" data-order-id="${util.escAttr(o.id)}" title="Кликните чтобы открыть наряд «${util.escAttr(o.name)}»">
      <div class="sv-order-name">${util.escHtml(o.name || '(без имени)')}</div>
      <div class="sv-order-meta">${util.escHtml(tLabel)} · ${util.escHtml(o.date || '')}</div>
      <button type="button" class="sv-order-del" data-act="delete" data-order-id="${util.escAttr(o.id)}" title="Удалить наряд">🗑</button>
    </div>`;
  }).join('');
}

function renderActive() {
  // Изолируем каждый sub-render чтобы ошибка в одном не блокировала остальное
  try { renderContextPicker(); } catch (e) { console.error('[service] renderContextPicker error:', e); }
  try { renderOrdersList(); } catch (e) { console.error('[service] renderOrdersList error:', e); }
  try { renderModuleActionsHere(); } catch (e) { console.error('[service] renderModuleActions error:', e); }
  const empty = $('sv-empty');
  const pane = $('sv-active-pane');
  const order = activeOrder();
  if (!order) {
    // v0.60.29: rich empty state с CTA + auto-suggest из cooling-подборов
    try { renderRichEmptyState(empty); } catch (e) { console.error('[service] empty state error:', e); }
    if (empty) empty.style.display = 'flex';
    if (pane) pane.hidden = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (pane) pane.hidden = false;
  const wrap = $('sv-order-form-wrap');
  if (wrap) {
    wrap.innerHTML = '';
    const cf = makeConvertFn();
    wrap.appendChild(renderOrderForm(order, (next) => {
      const idx = _orders.findIndex(o => o.id === order.id);
      if (idx >= 0) _orders[idx] = next;
      persist();
      renderActive();
    }, _currency, cf));
  }
  const headName = $('sv-active-name');
  if (headName) headName.textContent = `🛠 ${order.name || '(без имени)'}`;
}

function renderModuleActionsHere() {
  const root = $('sv-content-actions');
  if (!root) return;
  // v0.60.30: правильная сигнатура renderModuleActions — { navContext, crossLinks, getPayload }.
  // Раньше передавал отдельные navMode/navReturn — потенциально могло throw.
  renderModuleActions(root, {
    navContext: { mode: _navMode, return: _navReturn },
    crossLinks: [
      { href: '../cooling/', label: '❄ Подбор холода', title: 'Перейти в модуль подбора холодильных систем' },
      { href: '../projects/', label: '📁 Проекты', title: 'Перейти в список проектов' },
    ],
    getPayload: () => ({ module: 'service' }),
  });
}

// ---- Helpers ----
function svPrompt(label, def = '') {
  return util.modalOpen('<h3>Ввод значения</h3>',
    `<label>${util.escHtml(label)}:<input type="text" id="sv-prompt-input" value="${util.escAttr(def)}" autofocus></label>`,
    async () => ({ value: document.getElementById('sv-prompt-input').value })
  ).then(r => r ? r.value : null);
}
function svConfirm(msg) {
  return util.modalOpen('<h3>Подтверждение</h3>', `<p>${util.escHtml(msg)}</p>`,
    async () => ({ ok: true })).then(r => !!r);
}

// ---- Init ----
async function init() {
  const nav = detectNavMode();
  _navMode = nav.mode;
  _navReturn = nav.return;
  _standalone = (_navMode === 'standalone');

  if (!_standalone) {
    const params = new URLSearchParams(location.search);
    const urlPid = params.get('pid');
    if (urlPid) {
      const proj = getProject(urlPid);
      if (proj) { setActiveProjectId(urlPid); _pid = proj; }
      else _pid = ensureDefaultProject();
    } else {
      _pid = ensureDefaultProject();
    }
  }

  _orders = loadJson(KEY_ORDERS, []) || [];
  _activeOrderId = loadJson(KEY_ACTIVE_ID, null);
  const savedCur = loadJson(KEY_CURRENCY, null);
  if (typeof savedCur === 'string') _currency = savedCur;

  // Ensure unique seq
  for (const o of _orders) {
    const m = /ord-(\d+)/.exec(o.id);
    if (m) _seq = Math.max(_seq, +m[1] + 1);
  }
  if (_activeOrderId && !_orders.some(o => o.id === _activeOrderId)) {
    _activeOrderId = _orders[0]?.id || null;
  }

  // Currency picker
  const curSel = $('sv-currency');
  if (curSel) {
    if (!Array.isArray(CURRENCIES) || !CURRENCIES.length) {
      console.error('[service] CURRENCIES не загружены — fallback на default ₽');
      curSel.innerHTML = '<option value="₽" selected>₽ — Российский рубль</option>';
    } else {
      curSel.innerHTML = CURRENCIES.map(c =>
        `<option value="${c.code}"${c.code === _currency ? ' selected' : ''} title="${c.label}">${c.code} — ${c.label}</option>`
      ).join('');
    }
    curSel.addEventListener('change', () => {
      _currency = curSel.value || '₽';
      persist();
      renderActive();
    });
  }
  // Date picker
  const dateInp = $('sv-rates-date');
  if (dateInp) {
    dateInp.value = _ratesDate;
    dateInp.addEventListener('change', async () => {
      _ratesDate = dateInp.value;
      try { localStorage.setItem('service.ratesDate.v1', _ratesDate); } catch {}
      _ratesCache = null;
      await ensureRatesLoaded();
      renderActive();
    });
  }

  // Add-order button
  const addBtn = $('sv-add-order');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const name = await svPrompt('Название наряда', `Наряд ${_orders.length + 1}`);
    if (!name?.trim()) return;
    const newOrd = {
      ...DEFAULT_ORDER,
      id: 'ord-' + (_seq++),
      name: name.trim(),
    };
    _orders.push(newOrd);
    _activeOrderId = newOrd.id;
    persist();
    renderActive();
    util.toast(`Наряд «${newOrd.name}» создан`, 'ok');
  });

  // Orders list interactions
  $('sv-orders-list').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('button[data-act="delete"]');
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.orderId;
      const o = _orders.find(x => x.id === id);
      if (!o) return;
      const ok = await svConfirm(`Удалить наряд «${o.name}»?`);
      if (!ok) return;
      _orders = _orders.filter(x => x.id !== id);
      if (_activeOrderId === id) _activeOrderId = _orders[0]?.id || null;
      persist();
      renderActive();
      util.toast('Наряд удалён', 'info');
      return;
    }
    const row = e.target.closest('.sv-order-row');
    if (row && !e.target.closest('button')) {
      _activeOrderId = row.dataset.orderId;
      persist();
      renderActive();
    }
  });

  await ensureRatesLoaded();
  renderActive();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[service] Fatal init error:', err);
    const el = document.getElementById('sv-context-picker');
    if (el) el.innerHTML = `<div style="padding:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;font-size:12px;color:#b91c1c">⚠ Ошибка инициализации: ${util.escHtml(err.message || String(err))}. Откройте DevTools → Console.</div>`;
  });
});
