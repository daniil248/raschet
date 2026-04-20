// ======================================================================
// catalog/catalog.js
// Полноценный модуль управления каталогом платформы.
//
// Табы:
//  1. Элементы — список элементов library с колонкой последней цены
//  2. Цены — CRUD записей PriceRecord, фильтры
//  3. Контрагенты — CRUD Counterparty
//  4. Импорт — XLSX прайс-листов с маппингом колонок
//  5. Аналитика — сводка по ценам / контрагентам
// ======================================================================

import {
  listElements, getElement, saveElement, removeElement, cloneElement,
  exportLibraryJSON, importLibraryJSON, onLibraryChange,
  ELEMENT_KINDS, isPricableKind,
  getCurrentRole, canEditBuiltin, listBuiltinOverrides, resetBuiltinOverride,
} from '../shared/element-library.js';
import { createCableSkuElement } from '../shared/element-schemas.js';
import { tccBreakerTime, tccSamplePoints } from '../shared/tcc-curves.js';
// mountTccChart используется в cable/ и инспекторе линии — не здесь.
import {
  listPrices, getPrice, savePrice, removePrice, pricesForElement,
  bulkAddPrices, exportPricesJSON, importPricesJSON, onPricesChange,
  listImportBatches, rollbackImportBatch,
  PRICE_TYPES, CURRENCIES,
} from '../shared/price-records.js';
import {
  listCounterparties, getCounterparty, saveCounterparty, removeCounterparty,
  onCounterpartiesChange, COUNTERPARTY_TYPES, validateInn, makeCounterpartyId,
} from '../shared/counterparty-catalog.js';
import { initCatalogBridge } from '../shared/catalog-bridge.js';

initCatalogBridge();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtPrice(p, cur) {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  return Number(p).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (cur || '');
}
function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('ru-RU'); } catch { return '—'; }
}

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash ' + kind;
  el.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// v0.57.89 (Phase 1.5.6): sparkline динамики цены.
// Рисует мини-SVG по prices (отсортированным по recordedAt asc).
// Возвращает HTML-строку либо «—» если данных недостаточно.
function renderPriceSparkline(priceInfo) {
  if (!priceInfo || !priceInfo.prices || priceInfo.prices.length < 2 || !priceInfo.currency) {
    return '<span class="muted" style="font-size:10px">—</span>';
  }
  const pts = priceInfo.prices
    .slice()
    .filter(p => p.currency === priceInfo.currency && Number(p.recordedAt) > 0 && Number.isFinite(Number(p.price)))
    .sort((a, b) => Number(a.recordedAt) - Number(b.recordedAt));
  if (pts.length < 2) return '<span class="muted" style="font-size:10px">—</span>';
  const W = 90, H = 24, PAD = 2;
  const values = pts.map(p => Number(p.price));
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const vRange = vMax - vMin || 1;
  const tMin = Number(pts[0].recordedAt);
  const tMax = Number(pts[pts.length - 1].recordedAt);
  const tRange = tMax - tMin || 1;
  const xy = pts.map(p => {
    const x = PAD + (W - 2 * PAD) * (Number(p.recordedAt) - tMin) / tRange;
    const y = H - PAD - (H - 2 * PAD) * (Number(p.price) - vMin) / vRange;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const trendColor = last > first * 1.02 ? '#d32f2f' : last < first * 0.98 ? '#388e3c' : '#757575';
  const trendSign = last > first ? '↗' : last < first ? '↘' : '→';
  const pctChange = first > 0 ? ((last - first) / first * 100) : 0;
  const title = `${pts.length} записей: ${fmtPrice(first, priceInfo.currency)} → ${fmtPrice(last, priceInfo.currency)} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%)`;
  return `<span title="${esc(title)}" style="display:inline-flex;align-items:center;gap:4px">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
      <polyline points="${xy}" fill="none" stroke="${trendColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map(p => {
        const x = PAD + (W - 2 * PAD) * (Number(p.recordedAt) - tMin) / tRange;
        const y = H - PAD - (H - 2 * PAD) * (Number(p.price) - vMin) / vRange;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="${trendColor}"/>`;
      }).join('')}
    </svg>
    <span style="color:${trendColor};font-size:11px;font-weight:600">${trendSign}${Math.abs(pctChange).toFixed(0)}%</span>
  </span>`;
}

// ====================== Tabs ======================
let currentTab = 'elements';

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.hidden = (c.id !== 'tab-' + tabName));
  const renderers = {
    elements: renderElementsTab,
    prices: renderPricesTab,
    counterparties: renderCounterpartiesTab,
    import: renderImportTab,
    analytics: renderAnalyticsTab,
  };
  renderers[tabName]?.();
}

// ====================== Модалка ======================
function openModal(title, formHtml, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-form').innerHTML = formHtml;
  const modal = document.getElementById('modal');
  modal.classList.add('show');
  // Сбрасываем состояние кнопок (могли быть модифицированы в view-модалке)
  const saveBtn = document.getElementById('modal-save');
  const cancelBtn = document.getElementById('modal-cancel');
  if (saveBtn) saveBtn.style.display = '';
  if (cancelBtn) cancelBtn.textContent = 'Отмена';
  // Удаляем временные кнопки от view-модалки
  const footer = cancelBtn?.parentElement;
  if (footer) footer.querySelectorAll('.view-clone-btn').forEach(b => b.remove());

  cancelBtn.onclick = () => modal.classList.remove('show');
  saveBtn.onclick = () => {
    try {
      const ok = onSave();
      if (ok !== false) modal.classList.remove('show');
    } catch (e) {
      flash('Ошибка: ' + e.message, 'error');
    }
  };
}

// ====================== TAB: ЭЛЕМЕНТЫ ======================
const elFilters = { kind: '', source: '', search: '' };

function renderElementsTab() {
  const container = document.getElementById('tab-elements');
  const all = listElements();
  // v0.58.71: защитный фильтр — не исключаем элементы из-за мусорных
  // значений в el (null элементов, отсутствующих полей). Каждый
  // предикат проверяет, что фильтр задан И значение поля «плохое».
  const filtered = all.filter(el => {
    if (!el || typeof el !== 'object') return false;
    if (elFilters.kind && el.kind !== elFilters.kind) return false;
    // Источник: 'builtin' | 'user' | 'imported' | ''(все)
    if (elFilters.source === 'builtin') {
      if (!el.builtin) return false;
    } else if (elFilters.source === 'user') {
      // Пользовательские = всё что не builtin (включая imported-клоны)
      if (el.builtin) return false;
    }
    // '' (Все источники) — не фильтруем по источнику вообще
    if (elFilters.search) {
      const q = String(elFilters.search).toLowerCase();
      const hay = [el.label, el.manufacturer, el.series, el.variant, el.id]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  try {
    console.debug('[catalog] render: total=%d, filtered=%d, filters=%o',
      all.length, filtered.length, { ...elFilters });
  } catch {}

  const kindOpts = Object.entries(ELEMENT_KINDS).map(([k, d]) =>
    `<option value="${k}"${elFilters.kind === k ? ' selected' : ''}>${esc(d.label)}</option>`).join('');

  // v0.58.73: role-gate снят — правка builtin доступна всем через override
  // (ограничение вернётся в Фазе 5 auth вместе с ролью catalog-admin).
  const overrides = listBuiltinOverrides();
  const overrideCount = Object.keys(overrides).length;
  const roleIsAdmin = (getCurrentRole() === 'catalog-admin' || getCurrentRole() === 'admin');
  const roleBadge = roleIsAdmin
    ? `<span class="badge" style="background:#b54708;color:#fff">admin: ${esc(getCurrentRole())}</span>`
    : `<span class="badge">роль: ${esc(getCurrentRole())}</span>`;

  const html = [`
    <div class="toolbar">
      <select id="el-filter-kind"><option value="">Все типы</option>${kindOpts}</select>
      <select id="el-filter-source">
        <option value="">Все источники</option>
        <option value="builtin">Встроенные</option>
        <option value="user">Пользовательские</option>
      </select>
      <input type="search" id="el-filter-search" placeholder="Поиск…" style="flex:1" value="${esc(elFilters.search)}">
      <div class="spacer"></div>
      <button id="el-add" class="primary">+ Добавить элемент</button>
      <button id="el-export">Экспорт JSON</button>
      <button id="el-role-toggle" style="${roleIsAdmin ? 'background:#b54708;color:#fff;border-color:#b54708' : ''}" title="Переключить режим админа (индикатор роли; правка встроенных сейчас доступна всем)">${roleIsAdmin ? '🔓 Выйти из админа' : '🔒 Режим админа'}</button>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">
      Всего: <b>${all.length}</b>, отфильтровано: <b>${filtered.length}</b>
      · ${roleBadge}
      ${overrideCount ? `· <b>${overrideCount}</b> правок встроенных <a href="#" id="el-show-overrides" style="color:#b54708">(показать)</a>` : ''}
    </div>
    <div style="max-height:60vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Название</th>
            <th>Производитель / Серия</th>
            <th>Последняя цена</th>
            <th title="Минимум / максимум среди цен в одной валюте">Мин / Макс</th>
            <th title="Динамика цены во времени (последние предложения, слева старое → справа новое)">Динамика</th>
            <th>Предложений</th>
            <th></th>
          </tr>
        </thead>
        <tbody>`];

  for (const el of filtered) {
    const priceInfo = pricesForElement(el.id);
    const lastPrice = priceInfo.latest
      ? fmtPrice(priceInfo.latest.price, priceInfo.latest.currency) + ' <span class="muted" style="font-size:10px">· ' + fmtDate(priceInfo.latest.recordedAt) + '</span>'
      : '<span class="muted">—</span>';
    // v0.57.89 (Phase 1.5.6): колонки min/max + sparkline динамики цены.
    // Отображаются только если все цены элемента в одной валюте.
    let minMaxCell = '<span class="muted">—</span>';
    if (priceInfo.min != null && priceInfo.max != null && priceInfo.currency) {
      if (priceInfo.min === priceInfo.max) {
        minMaxCell = `<span class="muted">=${fmtPrice(priceInfo.min, priceInfo.currency)}</span>`;
      } else {
        const deltaPct = priceInfo.min > 0 ? ((priceInfo.max - priceInfo.min) / priceInfo.min * 100) : 0;
        minMaxCell = `<span style="font-size:11px">${fmtPrice(priceInfo.min, priceInfo.currency)}<br>${fmtPrice(priceInfo.max, priceInfo.currency)}</span><br><span class="muted" style="font-size:10px">Δ ${deltaPct.toFixed(0)}%</span>`;
      }
    }
    const sparkCell = renderPriceSparkline(priceInfo);
    const srcBadge = el.builtin ? '<span class="badge builtin">builtin</span>'
      : el.source === 'imported' ? '<span class="badge imported">import</span>'
      : '<span class="badge user">user</span>';
    html.push(`
      <tr data-id="${esc(el.id)}">
        <td>${srcBadge} <span class="muted" style="font-size:11px">${esc(el.kind)}</span></td>
        <td><b>${esc(el.label || el.id)}</b><br><span class="muted" style="font-size:10px;font-family:monospace">${esc(el.id)}</span></td>
        <td>${esc([el.manufacturer, el.series, el.variant].filter(Boolean).join(' · ') || '—')}</td>
        <td class="num">${lastPrice}</td>
        <td class="num">${minMaxCell}</td>
        <td>${sparkCell}</td>
        <td class="num">${priceInfo.count || '—'}</td>
        <td class="actions">
          <button data-act="view" title="Просмотр свойств элемента${el.kind === 'breaker' ? ' + TCC-график' : ''}">👁 Просмотр</button>
          ${isPricableKind(el.kind)
            ? '<button data-act="add-price">+ Цена</button>'
            : (el.kind === 'cable-type'
                ? '<button data-act="add-sku" title="Создать типоразмер (SKU) для этой линейки кабеля">+ SKU</button>'
                : '<button disabled title="' + (ELEMENT_KINDS[el.kind]?.note || 'Цена не применима к этому типу') + '">нет цены</button>')}
          <button data-act="view-prices">Цены</button>
          ${!el.builtin
            ? '<button data-act="edit">✎</button>'
            : `<button data-act="edit" title="Править встроенный элемент">✎</button>${overrides[el.id] ? '<button data-act="reset" title="Откатить к исходным данным">↺</button>' : ''}`}
          <button data-act="clone">Клон</button>
          ${!el.builtin
            ? '<button data-act="del" class="danger">×</button>'
            : '<button data-act="tombstone" class="danger" title="Скрыть встроенный элемент (откат через ↺)">×</button>'}
        </td>
      </tr>`);
  }
  if (!filtered.length) {
    html.push('<tr><td colspan="8" class="empty">Ничего не найдено</td></tr>');
  }
  html.push('</tbody></table></div>');
  container.innerHTML = html.join('');

  // Wire filters
  document.getElementById('el-filter-kind').onchange = e => { elFilters.kind = e.target.value; renderElementsTab(); };
  document.getElementById('el-filter-source').onchange = e => { elFilters.source = e.target.value; renderElementsTab(); };
  document.getElementById('el-filter-search').oninput = e => { elFilters.search = e.target.value; renderElementsTab(); };
  document.getElementById('el-add').onclick = () => openAddElementModal();
  document.getElementById('el-export').onclick = () => downloadJSON(exportLibraryJSON(), 'element-library.json');

  // Role toggle (индикатор для Phase 5; не гейтит правку — role-gate снят в v0.58.73)
  const roleBtn = document.getElementById('el-role-toggle');
  if (roleBtn) roleBtn.onclick = () => {
    const cur = getCurrentRole();
    if (cur === 'catalog-admin' || cur === 'admin') {
      try { localStorage.setItem('raschet.currentRole', 'user'); } catch {}
      flash('Режим admin выключен', 'success');
    } else {
      try { localStorage.setItem('raschet.currentRole', 'catalog-admin'); } catch {}
      flash('Режим admin включён', 'success');
    }
    renderElementsTab();
  };

  const showOvBtn = document.getElementById('el-show-overrides');
  if (showOvBtn) showOvBtn.onclick = (e) => {
    e.preventDefault();
    const ov = listBuiltinOverrides();
    const rows = Object.entries(ov).map(([id, patch]) => {
      const el = getElement(id);
      const label = el ? el.label : '(скрыт)';
      const kind = patch.tombstone ? '<span style="color:#b42318">скрыт</span>'
                                   : Object.keys(patch).filter(k => k !== 'updatedAt').join(', ');
      return `<tr><td><code>${esc(id)}</code></td><td>${esc(label)}</td><td>${kind}</td><td>${fmtDate(patch.updatedAt)}</td><td><button data-reset="${esc(id)}">↺ Откатить</button></td></tr>`;
    }).join('');
    openModal('Правки встроенных элементов',
      `<table class="data-table"><thead><tr><th>ID</th><th>Название</th><th>Изменения</th><th>Обновлено</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Нет правок</td></tr>'}</tbody></table>`,
      null);
    setTimeout(() => {
      document.querySelectorAll('button[data-reset]').forEach(b => {
        b.onclick = () => {
          try {
            resetBuiltinOverride(b.dataset.reset);
            flash('Откачено к исходным данным', 'success');
            document.getElementById('modal').classList.remove('show');
            renderElementsTab();
          } catch (err) { flash(err.message, 'error'); }
        };
      });
    }, 50);
  };

  // Wire row actions
  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'view') openViewElementModal(id);
        else if (act === 'add-price') openPriceModal({ elementId: id });
        else if (act === 'add-sku') openCableSkuModal(id);
        else if (act === 'breaker-details') openBreakerDetailsModal(id);
        else if (act === 'view-prices') { elFilters.search = ''; switchTab('prices'); priceFilters.elementId = id; renderPricesTab(); }
        else if (act === 'edit') openAddElementModal(id);
        else if (act === 'clone') {
          const name = prompt('Имя клона:', (getElement(id)?.label || '') + ' (копия)');
          if (name) { try { cloneElement(id, name); flash('Клонировано', 'success'); } catch (e) { flash(e.message, 'error'); } }
        }
        else if (act === 'del') {
          if (confirm('Удалить?')) { removeElement(id); flash('Удалено', 'success'); }
        }
        else if (act === 'reset') {
          if (confirm('Откатить правки к исходным данным?')) {
            try { resetBuiltinOverride(id); flash('Откачено', 'success'); }
            catch (err) { flash(err.message, 'error'); }
          }
        }
        else if (act === 'tombstone') {
          if (confirm('Скрыть этот встроенный элемент?\n\nВосстановить можно через «↺» в списке правок встроенных.')) {
            try { removeElement(id); flash('Скрыто', 'success'); }
            catch (err) { flash(err.message, 'error'); }
          }
        }
      };
    });
  });
}

// ——— Kind-specific form sections ———
// v0.58.73: редактирование структурных параметров rack/pdu прямо в каталоге.
// Для rack — комплектация (U/W/D, двери, стенки, крыша, пол, includes).
// Для pdu — фазы, номинал, высота, категория, список розеток.

const DOOR_OPTS = [
  ['none', 'без двери'],
  ['glass', 'стекло одностворчатая'],
  ['mesh', 'перфорированная одностворчатая'],
  ['metal', 'металл глухая одностворчатая'],
  ['double-glass', 'двустворчатая стеклянная'],
  ['double-mesh', 'двустворчатая перфорированная'],
  ['double-metal', 'двустворчатая металл'],
];
const SIDES_OPTS = [
  ['pair-sku', 'пара, один SKU'],
  ['pair-split', 'пара, раздельно'],
  ['single', 'одна'],
  ['none', 'без стенок'],
];
const TOP_OPTS    = [['solid','глухая'],['vent','вентилируемая'],['fan','с вентиляторами']];
const BASE_OPTS   = [['feet','ножки'],['casters','ролики'],['plinth','цоколь']];
const KIT_INCLUDE_KEYS = [
  ['doorFront',      'Дверь передняя'],
  ['doorRear',       'Дверь задняя'],
  ['sides',          'Боковые стенки'],
  ['top',            'Крыша'],
  ['base',           'Пол / основание'],
  ['doorWithLock',   'Замок в дверь (встроен)'],
  ['comboTopBase',   'Крыша+пол одной позицией'],
  ['cableEntryTop',  'Вводы в крышу со щётками'],
  ['frame',          'Рама'],
];
const PDU_CAT_OPTS = [
  ['basic','basic (без измерений)'],
  ['metered','metered (ввод)'],
  ['monitored','monitored (per-outlet)'],
  ['switched','switched (удал. упр.)'],
  ['hybrid','hybrid (monitored+switched)'],
];

function _selOpts(opts, cur) {
  return opts.map(([v,l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

function renderRackFields(el) {
  const kp = el.kindProps || {};
  const g  = el.geometry || {};
  const includes = Array.isArray(kp.includes) ? kp.includes : [];
  const incHtml = KIT_INCLUDE_KEYS.map(([key, label]) =>
    `<label style="display:inline-block;margin:2px 10px 2px 0;font-size:12px">
      <input type="checkbox" data-inc="${esc(key)}"${includes.includes(key) ? ' checked' : ''}> ${esc(label)}
    </label>`).join('');
  return `
    <fieldset style="border:1px solid #ddd;padding:10px;margin-top:12px;border-radius:4px">
      <legend style="font-size:12px;font-weight:600;padding:0 6px">Комплектация стойки</legend>
      <div class="field-row">
        <div class="field"><label>U</label><input id="f-rack-u" type="number" min="1" max="52" value="${Number(kp.u || 42)}"></div>
        <div class="field"><label>Ширина, мм</label><input id="f-rack-w" type="number" min="400" max="1200" step="50" value="${Number(kp.width || g.widthMm || 600)}"></div>
        <div class="field"><label>Глубина, мм</label><input id="f-rack-d" type="number" min="400" max="1400" step="50" value="${Number(kp.depth || g.depthMm || 1000)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Дверь передняя</label><select id="f-rack-doorFront">${_selOpts(DOOR_OPTS, kp.doorFront || 'mesh')}</select></div>
        <div class="field"><label>Дверь задняя</label><select id="f-rack-doorRear">${_selOpts(DOOR_OPTS, kp.doorRear || 'double-mesh')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Боковые стенки</label><select id="f-rack-sides">${_selOpts(SIDES_OPTS, kp.sides || 'pair-sku')}</select></div>
        <div class="field"><label>Крыша</label><select id="f-rack-top">${_selOpts(TOP_OPTS, kp.top || 'solid')}</select></div>
        <div class="field"><label>Пол</label><select id="f-rack-base">${_selOpts(BASE_OPTS, kp.base || 'feet')}</select></div>
      </div>
      <div class="field"><label style="display:block;font-size:11px;color:#555;margin-bottom:4px">Замок в дверь встроен</label>
        <label style="font-size:12px"><input type="checkbox" id="f-rack-doorWithLock"${kp.doorWithLock ? ' checked' : ''}> да</label>
        <label style="font-size:12px;margin-left:12px"><input type="checkbox" id="f-rack-comboTopBase"${kp.comboTopBase ? ' checked' : ''}> Крыша+пол одной позицией</label>
      </div>
      <div class="field">
        <label style="font-size:11px;color:#555">Входит в комплект (locked-поля: при выборе этого артикула в rack-config они блокируются)</label>
        <div id="f-rack-includes">${incHtml}</div>
      </div>
    </fieldset>`;
}

function readRackFields() {
  const $ = id => document.getElementById(id);
  const includes = Array.from(document.querySelectorAll('#f-rack-includes input[data-inc]'))
    .filter(i => i.checked).map(i => i.dataset.inc);
  return {
    u:              Number($('f-rack-u').value) || undefined,
    width:          Number($('f-rack-w').value) || undefined,
    depth:          Number($('f-rack-d').value) || undefined,
    doorFront:      $('f-rack-doorFront').value,
    doorRear:       $('f-rack-doorRear').value,
    sides:          $('f-rack-sides').value,
    top:            $('f-rack-top').value,
    base:           $('f-rack-base').value,
    doorWithLock:   $('f-rack-doorWithLock').checked,
    comboTopBase:   $('f-rack-comboTopBase').checked,
    includes,
  };
}

function renderPduFields(el) {
  const kp = el.kindProps || {};
  const outlets = Array.isArray(kp.outlets) ? kp.outlets : [];
  const rows = outlets.map((o, i) => `
    <div class="field-row" data-outlet-idx="${i}">
      <div class="field"><label>Тип</label><input class="f-pdu-otype" value="${esc(o.type || '')}" placeholder="C13 / C19 / Schuko"></div>
      <div class="field"><label>Кол-во</label><input class="f-pdu-oqty" type="number" min="0" value="${Number(o.count ?? o.qty ?? 0)}"></div>
      <div class="field"><label>&nbsp;</label><button type="button" class="danger" data-outlet-del="${i}">×</button></div>
    </div>`).join('');
  return `
    <fieldset style="border:1px solid #ddd;padding:10px;margin-top:12px;border-radius:4px">
      <legend style="font-size:12px;font-weight:600;padding:0 6px">Параметры PDU</legend>
      <div class="field-row">
        <div class="field"><label>Категория</label><select id="f-pdu-cat">${_selOpts(PDU_CAT_OPTS, kp.category || 'basic')}</select></div>
        <div class="field"><label>Фаз</label>
          <select id="f-pdu-phases">
            <option value="1"${kp.phases === 1 ? ' selected' : ''}>1</option>
            <option value="3"${kp.phases === 3 ? ' selected' : ''}>3</option>
          </select>
        </div>
        <div class="field"><label>Номинал, A</label><input id="f-pdu-rating" type="number" min="6" max="125" value="${Number(kp.rating || 16)}"></div>
        <div class="field"><label>Высота, U</label>
          <select id="f-pdu-height">
            <option value="0"${kp.height === 0 ? ' selected' : ''}>0U (verticle)</option>
            <option value="1"${kp.height === 1 ? ' selected' : ''}>1U</option>
            <option value="2"${kp.height === 2 ? ' selected' : ''}>2U</option>
          </select>
        </div>
      </div>
      <label style="font-size:11px;color:#555">Розетки</label>
      <div id="f-pdu-outlets">${rows}</div>
      <button type="button" id="f-pdu-addoutlet" style="margin-top:6px">+ Добавить группу розеток</button>
    </fieldset>`;
}
function wirePduFields() {
  const host = document.getElementById('f-pdu-outlets');
  const addBtn = document.getElementById('f-pdu-addoutlet');
  if (!host || !addBtn) return;
  const addRow = (type = '', qty = 0) => {
    const i = host.children.length;
    const div = document.createElement('div');
    div.className = 'field-row';
    div.dataset.outletIdx = i;
    div.innerHTML = `
      <div class="field"><label>Тип</label><input class="f-pdu-otype" value="${esc(type)}" placeholder="C13 / C19 / Schuko"></div>
      <div class="field"><label>Кол-во</label><input class="f-pdu-oqty" type="number" min="0" value="${qty}"></div>
      <div class="field"><label>&nbsp;</label><button type="button" class="danger" data-outlet-del="${i}">×</button></div>`;
    host.appendChild(div);
    div.querySelector('[data-outlet-del]').onclick = () => div.remove();
  };
  addBtn.onclick = () => addRow();
  host.querySelectorAll('[data-outlet-del]').forEach(b => {
    b.onclick = () => b.closest('.field-row').remove();
  });
}
function readPduFields() {
  const $ = id => document.getElementById(id);
  const outlets = Array.from(document.querySelectorAll('#f-pdu-outlets .field-row')).map(row => ({
    type: row.querySelector('.f-pdu-otype').value.trim(),
    count: Number(row.querySelector('.f-pdu-oqty').value) || 0,
  })).filter(o => o.type);
  return {
    category: $('f-pdu-cat').value,
    phases:   Number($('f-pdu-phases').value) || 1,
    rating:   Number($('f-pdu-rating').value) || 16,
    height:   Number($('f-pdu-height').value) || 0,
    outlets,
  };
}

function openAddElementModal(editId) {
  const el = editId ? getElement(editId) : { kind: 'custom', label: '' };
  if (!el) return flash('Не найдено', 'error');
  const isBuiltinEdit = !!(editId && el.builtin);
  const kindOpts = Object.entries(ELEMENT_KINDS).map(([k, d]) =>
    `<option value="${k}"${k === el.kind ? ' selected' : ''}>${esc(d.label)}</option>`).join('');

  let kindSpecific = '';
  if (el.kind === 'rack') kindSpecific = renderRackFields(el);
  else if (el.kind === 'pdu') kindSpecific = renderPduFields(el);

  const html = `
    ${isBuiltinEdit ? '<div style="background:#fff4e5;border-left:3px solid #b54708;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#7a3a00">Редактирование <b>встроенного</b> элемента. ID и kind менять нельзя; «↺» — откат к исходным данным.</div>' : ''}
    <div class="field"><label>ID</label><input id="f-id" value="${esc(el.id || '')}"${editId ? ' readonly' : ''}></div>
    <div class="field"><label>Kind</label><select id="f-kind"${isBuiltinEdit ? ' disabled' : ''}>${kindOpts}</select></div>
    <div class="field"><label>Название</label><input id="f-label" value="${esc(el.label || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Производитель</label><input id="f-manufacturer" value="${esc(el.manufacturer || '')}"></div>
      <div class="field"><label>Серия</label><input id="f-series" value="${esc(el.series || '')}"></div>
    </div>
    <div class="field"><label>Вариант / артикул</label><input id="f-variant" value="${esc(el.variant || '')}"></div>
    <div class="field"><label>Описание</label><textarea id="f-description">${esc(el.description || '')}</textarea></div>
    ${kindSpecific}`;

  openModal(editId ? 'Редактирование элемента' : 'Новый элемент', html, () => {
    const id = document.getElementById('f-id').value.trim();
    if (!id) { flash('ID обязателен', 'error'); return false; }
    if (!editId && getElement(id)) { flash('ID уже существует', 'error'); return false; }
    const kind = document.getElementById('f-kind').value;
    const base = {
      ...el,
      id, kind,
      label: document.getElementById('f-label').value,
      manufacturer: document.getElementById('f-manufacturer').value || undefined,
      series: document.getElementById('f-series').value || undefined,
      variant: document.getElementById('f-variant').value || undefined,
      description: document.getElementById('f-description').value || undefined,
    };
    if (kind === 'rack') {
      const rack = readRackFields();
      base.kindProps = { ...(el.kindProps || {}), ...rack };
      base.geometry = { ...(el.geometry || {}), widthMm: rack.width, depthMm: rack.depth,
        heightMm: (rack.u || 0) * 44.45 + 150 };
    } else if (kind === 'pdu') {
      const pdu = readPduFields();
      base.kindProps = { ...(el.kindProps || {}), ...pdu,
        categoryLabel: ({
          basic: 'Базовый (без измерений)',
          metered: 'Metered (ввод)',
          monitored: 'Monitored (per-outlet)',
          switched: 'Switched (упр. коммутацией)',
          hybrid: 'Hybrid (monitored+switched)',
        })[pdu.category] || pdu.category,
      };
      base.electrical = { ...(el.electrical || {}), phases: pdu.phases, capacityA: pdu.rating };
    }
    saveElement(base);
    flash('Сохранено', 'success');
  });
  // PDU — wire dynamic outlet rows after modal is in DOM
  if (el.kind === 'pdu') setTimeout(wirePduFields, 0);
}

// ====================== Просмотр свойств элемента ======================
// Универсальная read-only модалка для любого kind'а. Для breaker
// перенаправляет на openBreakerDetailsModal (с TCC-графиком).

function openViewElementModal(id) {
  const el = getElement(id);
  if (!el) return flash('Элемент не найден', 'error');
  // Для breaker — специализированный вьюер с TCC
  if (el.kind === 'breaker') return openBreakerDetailsModal(id);

  const kindDef = ELEMENT_KINDS[el.kind] || { label: el.kind };
  const srcBadge = el.builtin
    ? '<span class="badge builtin">builtin (только чтение)</span>'
    : el.source === 'imported'
      ? '<span class="badge imported">imported</span>'
      : '<span class="badge user">user</span>';

  const field = (label, value) => !value ? '' : `
    <tr><td style="color:#555;width:45%">${esc(label)}</td><td style="font-weight:600">${esc(value)}</td></tr>`;

  // Сбор ключевых полей в таблицу
  const basics = [
    field('ID', el.id),
    field('Тип (kind)', kindDef.label),
    field('Категория', el.category),
    field('Название', el.label),
    field('Производитель', el.manufacturer),
    field('Серия', el.series),
    field('Вариант', el.variant),
    field('Источник', el.source),
    el.tags?.length ? field('Теги', el.tags.join(', ')) : '',
    field('Описание', el.description),
  ].filter(Boolean).join('');

  const el2row = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return '';
    return Object.entries(obj)
      .filter(([k, v]) => v != null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => field(prefix + k, String(v)))
      .join('');
  };

  const electricalRows = el2row(el.electrical, '');
  const geometryRows = el2row(el.geometry, '');
  const kindPropsRows = el2row(el.kindProps, '');

  // Для элементов с composition — таблица состава
  let compositionHtml = '';
  if (Array.isArray(el.composition) && el.composition.length) {
    compositionHtml = `
      <h4 style="margin:14px 0 6px;font-size:13px">Состав (composition)</h4>
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>Роль</th><th>Элемент</th><th class="num">Кол-во</th><th>Phantom</th></tr></thead>
        <tbody>
          ${el.composition.map(c => `
            <tr>
              <td>${esc(c.role || '—')}</td>
              <td>${esc(c.label || c.elementId || '—')}</td>
              <td class="num">${c.qty || 1}</td>
              <td>${c.phantom ? '✓' : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  const html = `
    <div style="background:#f0f4ff;padding:10px;border-radius:4px;margin-bottom:12px;font-size:13px">
      <b>${esc(el.label || el.id)}</b> ${srcBadge}<br>
      <span class="muted" style="font-size:11px;font-family:monospace">${esc(el.id)}</span>
    </div>

    <h4 style="margin:0 0 6px;font-size:13px">Общие параметры</h4>
    <table class="wiz-summary-table" style="width:100%;font-size:12px">${basics}</table>

    ${electricalRows ? `
      <h4 style="margin:14px 0 6px;font-size:13px">Электрические параметры</h4>
      <table class="wiz-summary-table" style="width:100%;font-size:12px">${electricalRows}</table>
    ` : ''}

    ${geometryRows ? `
      <h4 style="margin:14px 0 6px;font-size:13px">Геометрия / габариты</h4>
      <table class="wiz-summary-table" style="width:100%;font-size:12px">${geometryRows}</table>
    ` : ''}

    ${kindPropsRows ? `
      <h4 style="margin:14px 0 6px;font-size:13px">Специфичные параметры (${esc(kindDef.label)})</h4>
      <table class="wiz-summary-table" style="width:100%;font-size:12px">${kindPropsRows}</table>
    ` : ''}

    ${compositionHtml}

    <details style="margin-top:14px">
      <summary style="cursor:pointer;font-size:12px;color:#666">Полный JSON (для экспорта)</summary>
      <pre style="background:#f6f8fa;padding:10px;border-radius:4px;font-size:11px;max-height:300px;overflow:auto;margin-top:6px">${esc(JSON.stringify(el, null, 2))}</pre>
    </details>

    ${el.builtin ? '<div style="font-size:11px;margin-top:10px;padding:8px;background:#fff4e5;border-left:3px solid #b54708;border-radius:3px;color:#7a3a00">ℹ Встроенный элемент. Правка — через кнопку «✎» в строке списка; «↺» — откат к исходным данным.</div>' : ''}
  `;

  openModal('Свойства: ' + (el.label || el.id), html, () => true);
  // Скрываем кнопку «Сохранить» — режим просмотра
  const saveBtn = document.getElementById('modal-save');
  if (saveBtn) saveBtn.style.display = 'none';
  // Переименовываем «Отмена» в «Закрыть»
  const cancelBtn = document.getElementById('modal-cancel');
  if (cancelBtn) cancelBtn.textContent = 'Закрыть';
  // Дополнительная кнопка «Клонировать»
  const footer = cancelBtn?.parentElement;
  if (footer && !footer.querySelector('.view-clone-btn')) {
    const cloneBtn = document.createElement('button');
    cloneBtn.textContent = 'Клонировать для редактирования';
    cloneBtn.className = 'view-clone-btn';
    cloneBtn.style.marginRight = 'auto';
    cloneBtn.onclick = () => {
      const name = prompt('Имя клона:', (el.label || id) + ' (копия)');
      if (!name) return;
      try {
        const c = cloneElement(id, name);
        flash('Клон создан: ' + c.label, 'success');
        document.getElementById('modal').classList.remove('show');
        // Автоматически открываем редактирование клона
        setTimeout(() => openAddElementModal(c.id), 100);
      } catch (e) { flash('Ошибка: ' + e.message, 'error'); }
    };
    footer.insertBefore(cloneBtn, cancelBtn);
  }
  // Восстановление кнопок при следующем вызове openModal —
  // логика теперь в самом openModal() (сбрасывает кнопки в начале).
}

// ====================== Параметры автомата (Фаза 1.10) ======================
// Модалка детального просмотра и редактирования BreakerElement:
// - паспорт (In, Icu, поляса, curve, type)
// - settings для электронных расцепителей (Ir/Isd/tsd/Ii)
// - мини-график TCC в SVG

function openBreakerDetailsModal(id) {
  const el = getElement(id);
  if (!el || el.kind !== 'breaker') return flash('Автомат не найден', 'error');
  const kp = el.kindProps || {};
  const builtin = !!el.builtin;
  const svg = _renderTccMiniSvg(kp);

  // Базовая карточка — только чтение для builtin, иначе редактируемые поля
  const readonlyAttr = builtin ? ' readonly disabled' : '';
  const ro = builtin; // короче

  const settingsBlock = (kp.adjustable && kp.settings)
    ? `<h4 style="margin:12px 0 6px;font-size:13px">Настройки электронного расцепителя (LSI)</h4>
       <div style="background:#f6f8fa;padding:10px;border-radius:4px;font-size:12px">
         ${_breakerSettingRow('Ir (долгая уставка)',    kp.settings.Ir,  ro, id)}
         ${_breakerSettingRow('Isd (короткая уставка)', kp.settings.Isd, ro, id)}
         ${_breakerSettingRow('tsd (задержка Isd)',     kp.settings.tsd, ro, id)}
         ${_breakerSettingRow('Ii (мгновенная уставка)',kp.settings.Ii,  ro, id)}
         <div class="muted" style="font-size:11px;margin-top:8px">
           Ir × I<sub>n</sub> — тепловой расцепитель (длительная защита)<br>
           Isd — короткая (селективность), tsd — её задержка<br>
           Ii — мгновенный (мгн. отключение при КЗ)
         </div>
       </div>`
    : '';

  const html = `
    <div style="background:#f0f4ff;padding:10px;border-radius:4px;margin-bottom:12px;font-size:13px">
      <b>${esc(el.label)}</b>${builtin ? ' <span class="badge builtin">builtin</span>' : ''}<br>
      <span class="muted" style="font-size:11px">${esc(el.id)}</span>
    </div>
    <h4 style="margin:0 0 6px;font-size:13px">Паспортные параметры</h4>
    <div class="field-row">
      <div class="field"><label>Тип</label><input value="${esc(kp.type || 'MCB')}"${readonlyAttr}></div>
      <div class="field"><label>Характеристика</label><input value="${esc(kp.curve || 'C')}"${readonlyAttr}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>I<sub>n</sub>, А</label><input value="${kp.inNominal || ''}"${readonlyAttr}></div>
      <div class="field"><label>Полюса</label><input value="${kp.poles || ''}"${readonlyAttr}></div>
      <div class="field"><label>I<sub>cu</sub>, кА</label><input value="${kp.breakingCapacityKa || ''}"${readonlyAttr}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Расцепитель</label><input value="${esc(kp.tripUnit || '')}"${readonlyAttr}></div>
      <div class="field"><label>Модулей</label><input value="${kp.modules || ''}"${readonlyAttr}></div>
    </div>

    <h4 style="margin:14px 0 6px;font-size:13px">Время-токовая характеристика (TCC)</h4>
    <div style="background:#fff;border:1px solid #e1e4e8;border-radius:4px;padding:10px;text-align:center">
      ${svg}
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">
      Логарифмические оси: X = I/I<sub>n</sub>, Y = время, с. Диапазон 1…100×I<sub>n</sub>, 0.01…1000 с.
      ${kp.tccCurveFormula ? 'Формула: <code>' + esc(kp.tccCurveFormula) + '</code>' : ''}
    </div>

    ${settingsBlock}

    ${builtin ? '<div class="muted" style="font-size:11px;margin-top:10px;padding:8px;background:#fff4e5;border-radius:3px">⚠ Встроенный автомат — параметры только для просмотра. Для редактирования создайте клон через кнопку «Клон».</div>' : ''}
  `;

  openModal('Параметры автомата', html, () => {
    if (ro) return true; // builtin — просто закрыть
    // Сохраняем изменённые settings (для user-breakers с adjustable)
    // (пока минимально — значения settings редактируются в отдельных inputs не реализовано)
    return true;
  });
}

function _breakerSettingRow(label, setting, readonly, breakerId) {
  if (!setting) return '';
  const roAttr = readonly ? ' disabled' : '';
  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
      <span style="flex:0 0 180px;color:#555">${esc(label)}</span>
      <span style="font-family:monospace;font-size:11px;color:#999">${setting.min}…${setting.max}</span>
      <input type="number" class="br-setting" data-br-id="${esc(breakerId)}" data-br-key="${esc(label)}"
        value="${setting.value}" min="${setting.min}" max="${setting.max}" step="${setting.step || 1}"
        style="flex:1;padding:3px 6px;border:1px solid #d0d7de;border-radius:3px"${roAttr}>
    </div>`;
}

// SVG-график TCC: лог-лог оси, кривая автомата
function _renderTccMiniSvg(kp) {
  const W = 360, H = 240, padL = 35, padR = 10, padT = 10, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Оси: X 1…100 (log), Y 0.01…1000 (log)
  const xMin = 1, xMax = 100;
  const yMin = 0.01, yMax = 1000;
  const lxMin = Math.log10(xMin), lxMax = Math.log10(xMax);
  const lyMin = Math.log10(yMin), lyMax = Math.log10(yMax);
  const toX = v => padL + ((Math.log10(v) - lxMin) / (lxMax - lxMin)) * plotW;
  const toY = v => padT + plotH - ((Math.log10(v) - lyMin) / (lyMax - lyMin)) * plotH;

  const curve = kp.curve || 'C';
  // Точки кривой
  const pts = [];
  const xs = [];
  for (let lx = lxMin; lx <= lxMax; lx += 0.02) xs.push(Math.pow(10, lx));
  for (const x of xs) {
    const { t_sec } = tccBreakerTime(x, curve);
    if (Number.isFinite(t_sec) && t_sec >= yMin && t_sec <= yMax) {
      pts.push([toX(x), toY(t_sec)]);
    }
  }
  const pathD = pts.length ? 'M ' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L ') : '';

  // Сетка
  const gridX = [];
  for (let lx = 0; lx <= 2; lx++) {
    const x = Math.pow(10, lx);
    gridX.push(`<line x1="${toX(x)}" y1="${padT}" x2="${toX(x)}" y2="${padT + plotH}" stroke="#e1e4e8" stroke-width="0.5"/>`);
    gridX.push(`<text x="${toX(x)}" y="${H - 10}" font-size="9" fill="#888" text-anchor="middle">${x}</text>`);
  }
  const gridY = [];
  for (let ly = lyMin; ly <= lyMax; ly++) {
    const y = Math.pow(10, ly);
    gridY.push(`<line x1="${padL}" y1="${toY(y)}" x2="${padL + plotW}" y2="${toY(y)}" stroke="#e1e4e8" stroke-width="0.5"/>`);
    const lbl = y >= 1 ? String(y) : (y === 0.01 ? '0.01' : (y === 0.1 ? '0.1' : y.toString()));
    gridY.push(`<text x="${padL - 4}" y="${toY(y) + 3}" font-size="9" fill="#888" text-anchor="end">${lbl}</text>`);
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fafbfc" stroke="#d0d7de"/>
    ${gridX.join('')}
    ${gridY.join('')}
    <text x="${padL + plotW / 2}" y="${H - 1}" font-size="9" fill="#555" text-anchor="middle">I / I_n</text>
    <text x="8" y="${padT + plotH / 2}" font-size="9" fill="#555" text-anchor="middle" transform="rotate(-90 8 ${padT + plotH / 2})">t, с</text>
    <path d="${pathD}" fill="none" stroke="#1976d2" stroke-width="2"/>
    <text x="${padL + plotW - 50}" y="${padT + 15}" font-size="11" fill="#1976d2" font-weight="bold">MCB ${esc(curve)}</text>
  </svg>`;
}

// ====================== Создание cable-sku ======================
// Цена кабеля не может быть привязана к линейке (cable-type = ВВГнг-LS),
// нужен конкретный SKU — ВВГнг-LS 3×2.5 мм². Эта модалка создаёт SKU
// для выбранной линейки, затем сразу открывает окно назначения цены.
// Стандартные ряды жил и сечений по ГОСТ 22483 / IEC 60228.
const STD_CABLE_CORES = [1, 2, 3, 4, 5, 7, 12, 19, 24, 37];
const STD_CABLE_SIZES = [
  0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800
];

function openCableSkuModal(cableTypeId) {
  const type = getElement(cableTypeId);
  if (!type) return flash('Линейка не найдена', 'error');
  if (type.kind !== 'cable-type') return flash('Только для cable-type', 'warn');

  const brand = type.kindProps?.brand || type.label || type.id;
  const coresOpts = STD_CABLE_CORES.map(c => `<option value="${c}">${c}</option>`).join('');
  const sizeOpts = STD_CABLE_SIZES.map(s => `<option value="${s}">${s} мм²</option>`).join('');

  const html = `
    <div style="padding:8px;background:#f0f4ff;border:1px solid #d0d7e8;border-radius:4px;margin-bottom:12px;font-size:12px">
      <b>Линейка:</b> ${esc(brand)} <span class="muted">(${esc(type.id)})</span><br>
      <span class="muted" style="font-size:11px">Создаётся конкретный типоразмер (SKU). К нему можно будет привязывать цены.</span>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Число жил *</label>
        <select id="f-cores">${coresOpts}</select>
      </div>
      <div class="field">
        <label>Сечение, мм² *</label>
        <select id="f-sizeMm2">${sizeOpts}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label><input type="checkbox" id="f-hasN"> N-жила</label></div>
      <div class="field"><label><input type="checkbox" id="f-hasPE"> PE-жила</label></div>
    </div>
    <div class="field"><label>Производитель (опц.)</label><input id="f-manufacturer" value="${esc(type.manufacturer || '')}"></div>
    <div class="field"><label>Артикул производителя (опц.)</label><input id="f-vendorSku" placeholder="например, 112233"></div>
    <div class="field-row">
      <div class="field"><label>Диаметр внешн., мм (опц.)</label><input type="number" id="f-diam" step="0.1" min="0"></div>
      <div class="field"><label>Масса, кг/км (опц.)</label><input type="number" id="f-mass" step="0.1" min="0"></div>
    </div>
    <div class="field"><label>Длина бухты, м (опц.)</label><input type="number" id="f-pkg" min="0" placeholder="100 / 200 / 500 / 1000"></div>
  `;
  openModal('SKU для «' + esc(brand) + '»', html, () => {
    const cores = Number(document.getElementById('f-cores').value) || 3;
    const sizeMm2 = Number(document.getElementById('f-sizeMm2').value) || 1.5;
    const sku = createCableSkuElement({
      cableTypeId: cableTypeId,
      cores,
      sizeMm2,
      brand,
      hasN: document.getElementById('f-hasN').checked,
      hasPE: document.getElementById('f-hasPE').checked,
      manufacturer: document.getElementById('f-manufacturer').value || type.manufacturer || '',
      vendorSku: document.getElementById('f-vendorSku').value || null,
      overallDiameterMm: Number(document.getElementById('f-diam').value) || null,
      weightKgPerKm: Number(document.getElementById('f-mass').value) || null,
      lengthPackage: Number(document.getElementById('f-pkg').value) || null,
      // Наследуем атрибуты линейки
      voltageCategory: type.electrical?.voltageCategory,
    });
    try {
      if (getElement(sku.id)) {
        flash('SKU уже существует: ' + sku.id, 'warn');
        return false;
      }
      saveElement(sku);
      flash('Создан SKU: ' + sku.label, 'success');
      // После создания — сразу открываем модалку назначения цены
      setTimeout(() => openPriceModal({ elementId: sku.id }), 100);
    } catch (e) {
      flash('Ошибка: ' + e.message, 'error');
      return false;
    }
  });
}

// ====================== TAB: ЦЕНЫ ======================
const priceFilters = { elementId: '', counterpartyId: '', priceType: '', currency: '' };

function renderPricesTab() {
  const container = document.getElementById('tab-prices');
  const prices = listPrices(priceFilters);
  const elements = new Map(listElements().map(el => [el.id, el]));
  const counterparties = new Map(listCounterparties().map(c => [c.id, c]));

  const ptOpts = Object.entries(PRICE_TYPES).map(([k, d]) =>
    `<option value="${k}"${priceFilters.priceType === k ? ' selected' : ''}>${esc(d.label)}</option>`).join('');
  const cpOpts = [...counterparties.values()].map(c =>
    `<option value="${c.id}"${priceFilters.counterpartyId === c.id ? ' selected' : ''}>${esc(c.shortName || c.name)}</option>`).join('');
  const curOpts = CURRENCIES.map(c => `<option value="${c}"${priceFilters.currency === c ? ' selected' : ''}>${c}</option>`).join('');

  const html = [`
    <div class="toolbar">
      <select id="pr-filter-pt"><option value="">Все типы цен</option>${ptOpts}</select>
      <select id="pr-filter-cp"><option value="">Все контрагенты</option>${cpOpts}</select>
      <select id="pr-filter-cur"><option value="">Все валюты</option>${curOpts}</select>
      ${priceFilters.elementId ? `<span class="type-badge">Элемент: ${esc(elements.get(priceFilters.elementId)?.label || priceFilters.elementId)} <button style="padding:0;margin-left:4px;background:none;border:none;cursor:pointer;color:#1976d2" id="pr-clear-el">×</button></span>` : ''}
      <div class="spacer"></div>
      <button id="pr-add" class="primary">+ Добавить цену</button>
      <button id="pr-export">Экспорт JSON</button>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Записей: <b>${prices.length}</b></div>
    <div style="max-height:60vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Дата</th><th>Элемент</th><th>Тип</th><th class="num">Цена</th>
            <th>Контрагент</th><th>Источник</th><th>Актуальна</th><th></th>
          </tr>
        </thead>
        <tbody>`];

  const now = Date.now();
  for (const p of prices) {
    const el = elements.get(p.elementId);
    const cp = counterparties.get(p.counterpartyId);
    const pt = PRICE_TYPES[p.priceType] || { label: p.priceType, icon: '' };
    const active = !p.validUntil || p.validUntil >= now;
    html.push(`
      <tr data-id="${esc(p.id)}">
        <td>${fmtDate(p.recordedAt)}</td>
        <td>${el ? esc(el.label || el.id) : '<span class="muted">?' + esc(p.elementId) + '</span>'}</td>
        <td><span class="type-badge">${pt.icon} ${esc(pt.label)}</span></td>
        <td class="num"><b>${fmtPrice(p.price, p.currency)}</b>${p.vatIncluded ? ' <span class="muted" style="font-size:10px">с НДС</span>' : ''}</td>
        <td>${cp ? esc(cp.shortName || cp.name) : '<span class="muted">—</span>'}</td>
        <td class="muted" style="font-size:11px">${esc(p.source || '—')}</td>
        <td>${active ? '<span class="badge active">да</span>' : '<span class="badge expired">нет</span>'}</td>
        <td class="actions">
          <button data-act="edit">✎</button>
          <button data-act="del" class="danger">×</button>
        </td>
      </tr>`);
  }
  if (!prices.length) {
    html.push('<tr><td colspan="8" class="empty">Нет записей. Добавьте первую цену.</td></tr>');
  }
  html.push('</tbody></table></div>');
  container.innerHTML = html.join('');

  document.getElementById('pr-filter-pt').onchange = e => { priceFilters.priceType = e.target.value; renderPricesTab(); };
  document.getElementById('pr-filter-cp').onchange = e => { priceFilters.counterpartyId = e.target.value; renderPricesTab(); };
  document.getElementById('pr-filter-cur').onchange = e => { priceFilters.currency = e.target.value; renderPricesTab(); };
  const clrBtn = document.getElementById('pr-clear-el');
  if (clrBtn) clrBtn.onclick = () => { priceFilters.elementId = ''; renderPricesTab(); };
  document.getElementById('pr-add').onclick = () => openPriceModal();
  document.getElementById('pr-export').onclick = () => downloadJSON(exportPricesJSON(), 'prices.json');

  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'edit') openPriceModal(null, id);
        else if (btn.dataset.act === 'del') { if (confirm('Удалить запись цены?')) { removePrice(id); flash('Удалено', 'success'); } }
      };
    });
  });
}

function openPriceModal(presets = {}, editId = null) {
  const existing = editId ? getPrice(editId) : null;
  const rec = existing || { priceType: 'purchase', currency: 'RUB', vatIncluded: true, vat: 20, ...presets };
  // Показываем только элементы, к которым можно привязать цену (pricable: true).
  // cable-type исключён — для него цена создаётся через cable-sku.
  const elements = listElements().filter(el => isPricableKind(el.kind));
  const counterparties = listCounterparties();

  const elOpts = elements.map(el =>
    `<option value="${el.id}"${el.id === rec.elementId ? ' selected' : ''}>${esc(el.label || el.id)} <span>[${el.kind}]</span></option>`).join('');
  const cpOpts = counterparties.map(c =>
    `<option value="${c.id}"${c.id === rec.counterpartyId ? ' selected' : ''}>${esc(c.shortName || c.name)}</option>`).join('');
  const ptOpts = Object.entries(PRICE_TYPES).map(([k, d]) =>
    `<option value="${k}"${k === rec.priceType ? ' selected' : ''}>${d.icon} ${esc(d.label)}</option>`).join('');
  const curOpts = CURRENCIES.map(c => `<option value="${c}"${c === rec.currency ? ' selected' : ''}>${c}</option>`).join('');

  const dateVal = rec.recordedAt ? new Date(rec.recordedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const validUntilVal = rec.validUntil ? new Date(rec.validUntil).toISOString().slice(0, 10) : '';

  const html = `
    <div class="field"><label>Элемент *</label><select id="f-elementId">${elOpts}</select></div>
    <div class="field-row">
      <div class="field"><label>Цена *</label><input type="number" id="f-price" min="0" step="0.01" value="${rec.price ?? ''}"></div>
      <div class="field"><label>Валюта</label><select id="f-currency">${curOpts}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Тип цены</label><select id="f-priceType">${ptOpts}</select></div>
      <div class="field"><label>Контрагент</label><select id="f-counterpartyId"><option value="">—</option>${cpOpts}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Дата записи *</label><input type="date" id="f-recordedAt" value="${dateVal}"></div>
      <div class="field"><label>Действует до</label><input type="date" id="f-validUntil" value="${validUntilVal}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Мин. количество</label><input type="number" id="f-quantity" min="1" value="${rec.quantity || 1}"></div>
      <div class="field"><label>НДС %</label><input type="number" id="f-vat" min="0" max="30" value="${rec.vat ?? 20}"></div>
      <div class="field" style="flex:0 0 auto;align-self:end;padding-bottom:8px">
        <label><input type="checkbox" id="f-vatIncluded"${rec.vatIncluded ? ' checked' : ''}> Цена с НДС</label>
      </div>
    </div>
    <div class="field"><label>Источник</label><input id="f-source" value="${esc(rec.source || 'manual')}" placeholder="manual / XLSX:file.xlsx / URL: / email"></div>
    <div class="field"><label>Условия</label><input id="f-conditions" value="${esc(rec.conditions || '')}" placeholder="DDP склад заказчика, FCA Москва, и т.д."></div>
    <div class="field"><label>Примечания</label><textarea id="f-notes">${esc(rec.notes || '')}</textarea></div>
  `;
  openModal(editId ? 'Редактирование цены' : 'Новая цена', html, () => {
    const elementId = document.getElementById('f-elementId').value;
    const price = Number(document.getElementById('f-price').value);
    if (!elementId) { flash('Выберите элемент', 'error'); return false; }
    if (!price || price < 0) { flash('Укажите цену', 'error'); return false; }
    const validUntil = document.getElementById('f-validUntil').value;
    savePrice({
      id: editId || undefined,
      elementId, price,
      currency: document.getElementById('f-currency').value,
      priceType: document.getElementById('f-priceType').value,
      counterpartyId: document.getElementById('f-counterpartyId').value || null,
      recordedAt: new Date(document.getElementById('f-recordedAt').value).getTime(),
      validUntil: validUntil ? new Date(validUntil).getTime() : null,
      quantity: Number(document.getElementById('f-quantity').value) || 1,
      vat: Number(document.getElementById('f-vat').value) || 0,
      vatIncluded: document.getElementById('f-vatIncluded').checked,
      source: document.getElementById('f-source').value || 'manual',
      conditions: document.getElementById('f-conditions').value || null,
      notes: document.getElementById('f-notes').value || null,
    });
    flash('Сохранено', 'success');
  });
}

// ====================== TAB: КОНТРАГЕНТЫ ======================
const cpFilters = { type: '', search: '' };

function renderCounterpartiesTab() {
  const container = document.getElementById('tab-counterparties');
  const list = listCounterparties(cpFilters);
  const typeOpts = Object.entries(COUNTERPARTY_TYPES).map(([k, d]) =>
    `<option value="${k}"${cpFilters.type === k ? ' selected' : ''}>${d.icon} ${esc(d.label)}</option>`).join('');

  const html = [`
    <div class="toolbar">
      <select id="cp-filter-type"><option value="">Все типы</option>${typeOpts}</select>
      <input type="search" id="cp-filter-search" placeholder="Поиск (название / ИНН / email)…" style="flex:1" value="${esc(cpFilters.search)}">
      <div class="spacer"></div>
      <button id="cp-add" class="primary">+ Добавить контрагента</button>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Всего: <b>${list.length}</b></div>
    <div style="max-height:60vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr><th>Тип</th><th>Название</th><th>ИНН / КПП</th><th>Контакт</th><th>Теги</th><th></th></tr>
        </thead>
        <tbody>`];

  for (const c of list) {
    const typeDef = COUNTERPARTY_TYPES[c.type] || { label: c.type, icon: '' };
    html.push(`
      <tr data-id="${esc(c.id)}">
        <td><span class="type-badge">${typeDef.icon} ${esc(typeDef.label)}</span></td>
        <td><b>${esc(c.shortName || c.name)}</b>${c.shortName && c.name !== c.shortName ? `<br><span class="muted" style="font-size:11px">${esc(c.name)}</span>` : ''}</td>
        <td class="muted" style="font-size:11px;font-family:monospace">${esc(c.inn || '—')}${c.kpp ? ' / ' + esc(c.kpp) : ''}</td>
        <td class="muted" style="font-size:11px">${[c.phone, c.email].filter(Boolean).map(esc).join('<br>') || '—'}</td>
        <td class="muted" style="font-size:11px">${Array.isArray(c.tags) ? c.tags.map(t => `<span class="type-badge">${esc(t)}</span>`).join(' ') : ''}</td>
        <td class="actions">
          <button data-act="edit">✎</button>
          <button data-act="del" class="danger">×</button>
        </td>
      </tr>`);
  }
  if (!list.length) html.push('<tr><td colspan="6" class="empty">Нет контрагентов. Добавьте первого.</td></tr>');
  html.push('</tbody></table></div>');
  container.innerHTML = html.join('');

  document.getElementById('cp-filter-type').onchange = e => { cpFilters.type = e.target.value; renderCounterpartiesTab(); };
  document.getElementById('cp-filter-search').oninput = e => { cpFilters.search = e.target.value; renderCounterpartiesTab(); };
  document.getElementById('cp-add').onclick = () => openCpModal();
  container.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'edit') openCpModal(id);
        else if (btn.dataset.act === 'del') { if (confirm('Удалить контрагента?')) { removeCounterparty(id); flash('Удалено', 'success'); } }
      };
    });
  });
}

function openCpModal(editId) {
  const rec = editId ? getCounterparty(editId) : { type: 'supplier', currency: 'RUB' };
  const typeOpts = Object.entries(COUNTERPARTY_TYPES).map(([k, d]) =>
    `<option value="${k}"${k === rec.type ? ' selected' : ''}>${d.icon} ${esc(d.label)}</option>`).join('');
  const curOpts = CURRENCIES.map(c => `<option value="${c}"${c === rec.currency ? ' selected' : ''}>${c}</option>`).join('');
  const html = `
    <div class="field-row">
      <div class="field"><label>Тип *</label><select id="f-type">${typeOpts}</select></div>
      <div class="field"><label>Валюта расчётов</label><select id="f-currency">${curOpts}</select></div>
    </div>
    <div class="field"><label>Полное название *</label><input id="f-name" value="${esc(rec.name || '')}"></div>
    <div class="field"><label>Сокращённое (для таблиц)</label><input id="f-shortName" value="${esc(rec.shortName || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ИНН</label><input id="f-inn" value="${esc(rec.inn || '')}" placeholder="10 или 12 цифр"></div>
      <div class="field"><label>КПП</label><input id="f-kpp" value="${esc(rec.kpp || '')}"></div>
    </div>
    <div class="field"><label>Юр. адрес</label><input id="f-address" value="${esc(rec.address || '')}"></div>
    <div class="field"><label>Адрес склада / самовывоза</label><input id="f-deliveryAddress" value="${esc(rec.deliveryAddress || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Телефон</label><input id="f-phone" value="${esc(rec.phone || '')}"></div>
      <div class="field"><label>Email</label><input id="f-email" value="${esc(rec.email || '')}"></div>
    </div>
    <div class="field"><label>Сайт</label><input id="f-website" value="${esc(rec.website || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Условия оплаты</label><input id="f-paymentTerms" value="${esc(rec.paymentTerms || '')}" placeholder="предоплата / по факту / 30 дней"></div>
      <div class="field"><label>Скидка, %</label><input type="number" id="f-discount" min="0" max="100" step="0.5" value="${rec.discount || 0}"></div>
    </div>
    <div class="field"><label>Теги (через запятую)</label><input id="f-tags" value="${esc((rec.tags || []).join(', '))}" placeholder="основной, Китай, дистрибьютор ABB"></div>
    <div class="field"><label>Примечания</label><textarea id="f-notes">${esc(rec.notes || '')}</textarea></div>
  `;
  openModal(editId ? 'Редактирование контрагента' : 'Новый контрагент', html, () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { flash('Название обязательно', 'error'); return false; }
    const inn = document.getElementById('f-inn').value.trim();
    if (inn && !validateInn(inn)) { flash('ИНН должен быть 10 или 12 цифр', 'error'); return false; }
    saveCounterparty({
      id: editId || undefined,
      type: document.getElementById('f-type').value,
      currency: document.getElementById('f-currency').value,
      name,
      shortName: document.getElementById('f-shortName').value || undefined,
      inn: inn || undefined,
      kpp: document.getElementById('f-kpp').value || undefined,
      address: document.getElementById('f-address').value || undefined,
      deliveryAddress: document.getElementById('f-deliveryAddress').value || undefined,
      phone: document.getElementById('f-phone').value || undefined,
      email: document.getElementById('f-email').value || undefined,
      website: document.getElementById('f-website').value || undefined,
      paymentTerms: document.getElementById('f-paymentTerms').value || undefined,
      discount: Number(document.getElementById('f-discount').value) || 0,
      tags: document.getElementById('f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      notes: document.getElementById('f-notes').value || undefined,
    });
    flash('Сохранено', 'success');
  });
}

// ====================== TAB: ИМПОРТ ======================
function renderImportTab() {
  const container = document.getElementById('tab-import');
  container.innerHTML = `
    <h3 style="margin-top:0">Импорт прайс-листов</h3>
    <div class="muted" style="font-size:13px;margin-bottom:12px">
      Загрузите XLSX / CSV с прайс-листом. Маппинг колонок определяется автоматически по заголовкам
      (Цена/Price, Артикул/SKU, Количество/Qty), можно подправить вручную перед применением.
    </div>
    <div class="dropzone" id="import-dropzone">
      <div style="font-size:32px">📄</div>
      <div>Перетащите файл XLSX / CSV сюда или нажмите чтобы выбрать</div>
      <input type="file" id="import-file" accept=".xlsx,.xls,.csv" multiple style="display:none">
    </div>
    <div id="import-preview"></div>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e1e4e8">
      <h3>Импорт JSON</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Для восстановления из backup</div>
      <button id="import-prices-json">Импорт цен из JSON</button>
      <button id="import-library-json">Импорт библиотеки из JSON</button>
      <input type="file" id="import-json-file" accept=".json" style="display:none">
    </div>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e1e4e8">
      <h3 style="margin:0 0 8px">История импортов <span class="muted" style="font-size:11px;font-weight:normal">(v0.57.92)</span></h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Группировка цен по source-метке + минутному окну импорта.
        «Откатить» удаляет все записи из этой партии (необратимо).
      </div>
      <div id="import-history"></div>
    </div>
  `;
  wireImportTab();
  renderImportHistory();
}

function renderImportHistory() {
  const wrap = document.getElementById('import-history');
  if (!wrap) return;
  const batches = listImportBatches();
  if (!batches.length) {
    wrap.innerHTML = '<div class="empty" style="padding:12px">История пуста — ещё не было импортов.</div>';
    return;
  }
  const fmtDT = ts => {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return '—'; }
  };
  const html = [`
    <table class="data-table">
      <thead>
        <tr>
          <th>Источник</th>
          <th>Дата / время</th>
          <th class="num">Записей</th>
          <th class="num">Элементов</th>
          <th>Валюты</th>
          <th>Контрагенты</th>
          <th></th>
        </tr>
      </thead>
      <tbody>`];
  for (const b of batches) {
    const cpNames = b.counterpartyIds.length
      ? b.counterpartyIds.map(id => {
          const c = getCounterparty(id);
          return c ? esc(c.shortName || c.name) : esc(id);
        }).join(', ')
      : '<span class="muted">—</span>';
    html.push(`
      <tr>
        <td><span style="font-family:monospace;font-size:11px">${esc(b.source)}</span></td>
        <td style="font-size:12px">${fmtDT(b.importedAt)}</td>
        <td class="num">${b.count}</td>
        <td class="num">${b.uniqueElements}</td>
        <td style="font-size:11px">${b.currencies.map(esc).join(', ') || '—'}</td>
        <td style="font-size:11px">${cpNames}</td>
        <td class="actions"><button data-act="rollback" data-src="${esc(b.source)}" data-bucket="${b.importedAt}" class="danger" title="Удалить все записи из этой партии">↩ Откатить</button></td>
      </tr>`);
  }
  html.push('</tbody></table>');
  wrap.innerHTML = html.join('');
  wrap.querySelectorAll('[data-act="rollback"]').forEach(btn => {
    btn.onclick = () => {
      const src = btn.dataset.src;
      const bucket = Number(btn.dataset.bucket) || 0;
      if (!confirm(`Удалить все цены из партии «${src}» (${new Date(bucket).toLocaleString('ru-RU')})?\nЭто действие необратимо.`)) return;
      const removed = rollbackImportBatch(src, bucket);
      flash(`Удалено записей: ${removed}`, removed > 0 ? 'success' : 'warn');
      renderImportHistory();
    };
  });
}

function wireImportTab() {
  const dz = document.getElementById('import-dropzone');
  const file = document.getElementById('import-file');
  dz.onclick = () => file.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => {
    e.preventDefault(); dz.classList.remove('dragover');
    handleImportFiles(e.dataTransfer.files);
  };
  file.onchange = e => handleImportFiles(e.target.files);

  let jsonMode = 'prices';
  const jsonFile = document.getElementById('import-json-file');
  document.getElementById('import-prices-json').onclick = () => { jsonMode = 'prices'; jsonFile.click(); };
  document.getElementById('import-library-json').onclick = () => { jsonMode = 'library'; jsonFile.click(); };
  jsonFile.onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const mode = confirm('Merge (OK) или Replace (Cancel)?') ? 'merge' : 'replace';
    try {
      const text = await f.text();
      const result = (jsonMode === 'prices' ? importPricesJSON : importLibraryJSON)(text, mode);
      flash(`Импортировано: +${result.added}, обновлено ${result.updated}`, 'success');
    } catch (err) {
      flash('Ошибка: ' + err.message, 'error');
    }
    e.target.value = '';
  };
}

async function handleImportFiles(files) {
  if (!files || !files.length) return;
  if (typeof XLSX === 'undefined') { flash('XLSX library не загружена', 'error'); return; }
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      renderImportPreview(file.name, rows);
    } catch (e) {
      flash(`Ошибка ${file.name}: ${e.message}`, 'error');
    }
  }
}

function renderImportPreview(fileName, rows) {
  if (!rows.length) return flash('Файл пуст', 'warn');
  const preview = document.getElementById('import-preview');
  // Авто-маппинг колонок
  const headers = Object.keys(rows[0]);
  const mapping = { elementId: '', price: '', currency: '', counterpartyId: '', priceType: 'purchase' };
  for (const h of headers) {
    const low = h.toLowerCase();
    if (/artikul|article|sku|код|артикул|id/.test(low) && !mapping.elementId) mapping.elementId = h;
    if (/price|цена|стоимость|cost/.test(low) && !mapping.price) mapping.price = h;
    if (/curr|валют/.test(low) && !mapping.currency) mapping.currency = h;
    // v0.57.92 (Phase 1.5.5): auto-match колонки контрагента (per-row override)
    if (/counter|contractor|vendor|supplier|contragent|контрагент|поставщик|продавец/.test(low) && !mapping.counterpartyId) mapping.counterpartyId = h;
  }
  const counterparties = listCounterparties();
  const cpOpts = counterparties.map(c => `<option value="${c.id}">${esc(c.shortName || c.name)}</option>`).join('');

  const mapRow = (field, label) => `
    <tr>
      <td><b>${label}</b></td>
      <td><select data-map="${field}">
        <option value="">—</option>
        ${headers.map(h => `<option value="${esc(h)}"${mapping[field] === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}
      </select></td>
    </tr>`;
  preview.innerHTML = `
    <h3 style="margin:20px 0 6px">Предпросмотр: ${esc(fileName)} (${rows.length} строк)</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Сопоставьте колонки файла с полями прайса.</div>
    <table class="data-table mapping-table">
      <thead><tr><th>Поле</th><th>Колонка файла</th></tr></thead>
      <tbody>
        ${mapRow('elementId', 'Элемент (ID или артикул)')}
        ${mapRow('price', 'Цена')}
        ${mapRow('currency', 'Валюта')}
        ${mapRow('counterpartyId', 'Контрагент (per-row, опц.)')}
      </tbody>
    </table>
    <div class="muted" style="font-size:11px;margin:4px 0 0">
      Если колонка «Контрагент» сопоставлена — значение в строке файла переопределяет глобальный выбор ниже.
      Ожидаются ID контрагента (${counterparties.length ? counterparties.slice(0, 3).map(c => esc(c.id)).join(' / ') + (counterparties.length > 3 ? ' / …' : '') : 'нет контрагентов'}) или их короткое имя.
    </div>
    <div class="field-row" style="margin-top:12px">
      <div class="field"><label>Контрагент по умолчанию (fallback)</label>
        <select id="imp-cp"><option value="">—</option>${cpOpts}</select>
      </div>
      <div class="field"><label>Тип цены</label>
        <select id="imp-pt">${Object.entries(PRICE_TYPES).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Источник</label>
        <input id="imp-src" value="XLSX:${esc(fileName)}">
      </div>
    </div>
    <details style="margin:12px 0"><summary style="cursor:pointer">Превью данных (первые 5 строк)</summary>
      <pre style="background:#f6f8fa;padding:10px;font-size:11px;max-height:200px;overflow:auto">${esc(JSON.stringify(rows.slice(0, 5), null, 2))}</pre>
    </details>
    <button id="imp-apply" class="primary">Импортировать ${rows.length} записей</button>
  `;

  // Update mapping on change
  preview.querySelectorAll('[data-map]').forEach(sel => {
    sel.onchange = e => { mapping[sel.dataset.map] = e.target.value; };
  });
  document.getElementById('imp-apply').onclick = () => {
    if (!mapping.elementId || !mapping.price) { flash('Сопоставьте поля «Элемент» и «Цена»', 'error'); return; }
    const cpId = document.getElementById('imp-cp').value || null;
    const pt = document.getElementById('imp-pt').value;
    const src = document.getElementById('imp-src').value;
    // v0.57.92 (Phase 1.5.5): per-row counterparty override.
    // Если колонка сопоставлена — значение из файла приоритетнее
    // глобального selector. Разрешаем указывать либо ID контрагента,
    // либо его shortName/name (резолвим через counterparties).
    const cpById = new Map(counterparties.map(c => [String(c.id).toLowerCase(), c]));
    const cpByName = new Map();
    for (const c of counterparties) {
      if (c.shortName) cpByName.set(String(c.shortName).toLowerCase(), c);
      if (c.name) cpByName.set(String(c.name).toLowerCase(), c);
    }
    const resolveCp = raw => {
      const s = String(raw || '').trim().toLowerCase();
      if (!s) return null;
      return (cpById.get(s) || cpByName.get(s) || null);
    };
    let perRowMatched = 0, perRowUnresolved = 0;
    const recs = rows.map(r => {
      let rowCpId = cpId;
      if (mapping.counterpartyId) {
        const raw = r[mapping.counterpartyId];
        if (raw != null && String(raw).trim()) {
          const resolved = resolveCp(raw);
          if (resolved) { rowCpId = resolved.id; perRowMatched++; }
          else perRowUnresolved++;
        }
      }
      return {
        elementId: String(r[mapping.elementId] || '').trim(),
        price: Number(r[mapping.price]) || 0,
        currency: (r[mapping.currency] || 'RUB').toString().trim() || 'RUB',
        priceType: pt,
        counterpartyId: rowCpId,
        source: src,
        recordedAt: Date.now(),
      };
    }).filter(r => r.elementId && r.price > 0);
    const result = bulkAddPrices(recs);
    const cpMsg = mapping.counterpartyId
      ? ` (per-row контрагент: ${perRowMatched} match${perRowUnresolved ? `, ${perRowUnresolved} не распознан` : ''})`
      : '';
    flash(`Импортировано ${result.added}, пропущено ${result.skipped}${cpMsg}`, result.errors.length || perRowUnresolved ? 'warn' : 'success');
    preview.innerHTML = '';
    renderImportHistory();
  };
}

// ====================== TAB: АНАЛИТИКА ======================
function renderAnalyticsTab() {
  const container = document.getElementById('tab-analytics');
  const elements = listElements();
  const prices = listPrices();
  const counterparties = listCounterparties();

  // Сводка
  const elementsWithPrice = new Set(prices.map(p => p.elementId)).size;
  const elementsWithoutPrice = elements.length - elementsWithPrice;
  const now = Date.now();
  const staleThreshold = 90 * 24 * 3600 * 1000;
  const staleCount = prices.filter(p => (now - (p.recordedAt || 0)) > staleThreshold).length;

  // Контрагенты по числу цен
  const byCp = {};
  for (const p of prices) {
    if (p.counterpartyId) byCp[p.counterpartyId] = (byCp[p.counterpartyId] || 0) + 1;
  }
  const topCp = Object.entries(byCp).sort((a, b) => b[1] - a[1]).slice(0, 5);

  container.innerHTML = `
    <h3 style="margin-top:0">Сводка по каталогу</h3>
    <div class="stat-cards">
      <div class="stat-card"><div class="label">Элементов</div><div class="value">${elements.length}</div></div>
      <div class="stat-card"><div class="label">Контрагентов</div><div class="value">${counterparties.length}</div></div>
      <div class="stat-card"><div class="label">Записей цен</div><div class="value">${prices.length}</div></div>
      <div class="stat-card"><div class="label">С ценами</div><div class="value">${elementsWithPrice}</div></div>
      <div class="stat-card"><div class="label">Без цен</div><div class="value" style="color:#c67300">${elementsWithoutPrice}</div></div>
      <div class="stat-card"><div class="label">Устаревшие (>90д)</div><div class="value" style="color:#cf222e">${staleCount}</div></div>
    </div>

    <h3 style="margin:24px 0 8px">Топ-5 контрагентов по числу цен</h3>
    ${topCp.length ? `
      <table class="data-table">
        <thead><tr><th>Контрагент</th><th class="num">Цен</th></tr></thead>
        <tbody>
          ${topCp.map(([id, cnt]) => {
            const cp = counterparties.find(c => c.id === id);
            return `<tr><td>${esc(cp?.shortName || cp?.name || id)}</td><td class="num"><b>${cnt}</b></td></tr>`;
          }).join('')}
        </tbody>
      </table>
    ` : '<div class="empty">Нет данных</div>'}

    <h3 style="margin:24px 0 8px">Элементы без цен</h3>
    ${elementsWithoutPrice > 0 ? `
      <div class="muted" style="font-size:12px;margin-bottom:8px">${elementsWithoutPrice} из ${elements.length} элементов не имеют ни одной записи цены.</div>
      <div style="max-height:300px;overflow:auto">
        <table class="data-table">
          <thead><tr><th>Тип</th><th>Название</th><th></th></tr></thead>
          <tbody>
            ${elements.filter(el => !prices.some(p => p.elementId === el.id)).slice(0, 50).map(el => `
              <tr><td>${esc(el.kind)}</td><td>${esc(el.label || el.id)}</td>
              <td class="actions"><button onclick="window._openPriceModal && window._openPriceModal('${esc(el.id)}')">+ Цена</button></td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="empty">Все элементы с ценами 🎉</div>'}
  `;
  window._openPriceModal = (id) => openPriceModal({ elementId: id });
}

// ====================== Helpers ======================
function downloadJSON(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  flash('Экспорт готов', 'success');
}

// ====================== Bootstrap ======================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  // Первый рендер с задержкой для catalog-bridge
  setTimeout(() => switchTab('elements'), 150);
  // Реактивность
  onLibraryChange(() => { if (currentTab === 'elements') renderElementsTab(); else if (currentTab === 'analytics') renderAnalyticsTab(); });
  onPricesChange(() => { if (['elements', 'prices', 'analytics'].includes(currentTab)) switchTab(currentTab); });
  onCounterpartiesChange(() => { if (['counterparties', 'prices', 'analytics'].includes(currentTab)) switchTab(currentTab); });
});
