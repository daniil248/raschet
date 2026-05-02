// =============================================================================
// cooling/ui/capex-form.js — форма CAPEX/economics параметров
// =============================================================================
// v0.60.21: ЕДИНАЯ ТАБЛИЦА «Состав оборудования» (по требованию Пользователя
// 2026-05-02: «Одна строка в которой несколько колонок. Стоимость оборудования,
// стоимость монтажа, стоимость ТО (всё что нужно для корректного расчёта),
// количество, чтобы не вписывать каждый однотипный чиллер много раз. Для
// каждой цены, выбор валюты. Цена может быть в долларах, а монтаж в тенге…
// При этом все отдельные затраты в общей форме выводим по разделам»).
//
// Form layout:
//   📦 Состав оборудования (X статей)        [ⓘ откроет таблицу]
//   ────────────────────────────────────────
//   Σ Оборудование:   <amount> <displayCur>
//   Σ Монтаж/ПНР:     <amount> <displayCur>
//   Σ ТО за год:      <amount> <displayCur>
//   ────────────────────────────────────────
//   [прочие параметры: lifetime / discount / эскалация]
//
// Modal (открывается по клику кнопки):
//   ┌─ Статья ─┬─ Кол-во ─┬─ Стоим. оборуд. ─┬─ Вал. ─┬─ Стоим. монтажа ─┬─ Вал. ─┬─ Стоим. ТО/год ─┬─ Вал. ─┬─ × ─┐
//   │ Чиллер 1 │   5      │  6000             │  €     │ 2000              │  ₽     │ 500              │  ₸    │     │
//   │ + Добавить позицию                                                                                              │
//   └─ Σ оборуд:  X €  · Σ монтаж: Y €  · Σ ТО/год: Z €  (всё в валюте проекта по курсу) ─────────────────────────┘

import {
  DEFAULT_ECONOMICS, COST_ITEM_COLUMNS,
  normCostItems, sumCostItemsByCol, computeEcoTotals,
} from '../calc/capex-tco.js';
import { fmtMoney, CURRENCIES } from '../calc/fc-summary.js';
import { escAttr, escHtml, modalOpen, toast } from '../../meteo/util.js';

/**
 * @param {object} eco              — economics параметры
 * @param {function(eco)} onChange  — вызывается при каждом change
 * @param {string} displayCurrency  — валюта проекта/отчёта
 * @param {function|null} convertFn — (amount, fromIso, toIso) => number
 */
export function renderCapexForm(eco, onChange, displayCurrency = '₽', convertFn = null) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  const wrap = document.createElement('div');
  wrap.className = 'cl-capex-form';

  const items = normCostItems(e, displayCurrency);
  const totals = computeEcoTotals(e, displayCurrency, convertFn);
  const fmtT = (v) => fmtMoney(v, displayCurrency);

  wrap.innerHTML = `
    <h4 title="Параметры экономической модели TCO/NPV/Payback. Соответствует ISO 15686-5 Life-Cycle Costing.">💰 CAPEX и экономические параметры</h4>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title" title="Единая таблица состава оборудования: одна строка = одно изделие с количеством и ценами по разделам (оборудование / монтаж / ТО). Для каждой цены своя валюта.">📦 Состав оборудования (статьи затрат)</div>
      <button type="button" class="cl-btn-primary cl-cost-edit-btn" id="cl-edit-cost-items"
              title="Открыть таблицу состава: Статья / Кол-во / Стоимость оборудования / Стоимость монтажа / Стоимость ТО за год. Для каждой цены свой выбор валюты. Чиллер в долларах + монтаж в тенге + ТО в евро — всё допустимо.">
        ✏ Редактировать состав (${items.length} ${itemsWord(items.length)})
      </button>
      <div class="cl-cost-totals" title="Итоги по разделам — все в валюте проекта по текущему курсу. Каждая цена в своей валюте конвертируется отдельно.">
        <div class="cl-cost-total-row">
          <span class="cl-cost-total-lbl" title="Σ qty × Стоимость оборудования по всем статьям, в валюте проекта.">Σ Оборудование:</span>
          <span class="cl-cost-total-val">${fmtT(totals.equipmentCost)}</span>
        </div>
        <div class="cl-cost-total-row">
          <span class="cl-cost-total-lbl" title="Σ qty × Стоимость монтажа+ПНР по всем статьям.">Σ Монтаж/ПНР:</span>
          <span class="cl-cost-total-val">${fmtT(totals.installationCost)}</span>
        </div>
        <div class="cl-cost-total-row">
          <span class="cl-cost-total-lbl" title="Σ qty × Стоимость ТО за год по всем статьям. Используется как базовая годовая OPEX-ТО (с эскалацией ниже).">Σ ТО за год:</span>
          <span class="cl-cost-total-val">${fmtT(totals.maintenanceRubPerYear)}</span>
        </div>
        <div class="cl-cost-total-row cl-cost-total-grand" title="Год 0: Σ Оборудование + Σ Монтаж — это CAPEX, который попадает в TCO как разовая затрата.">
          <span class="cl-cost-total-lbl"><b>CAPEX (год 0):</b></span>
          <span class="cl-cost-total-val"><b>${fmtT(totals.equipmentCost + totals.installationCost)}</b></span>
        </div>
      </div>
    </div>

    <p class="muted" style="font-size:11.5px;margin:8px 0 0;padding:6px 10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:3px" title="Срок проекта, ставка дисконтирования и эскалации перенесены на ПОДБОР-уровень — чтобы все варианты сравнивались на одинаковых финансовых условиях. Изменяйте их во вкладке «📋 Свойства подбора».">
      ℹ Срок проекта, ставка дисконтирования и эскалации — на уровне ПОДБОРА (вкладка «📋 Свойства подбора»). Здесь — только статьи затрат для этой опции.
    </p>
  `;

  wrap.addEventListener('click', async (ev) => {
    if (!ev.target.closest('#cl-edit-cost-items')) return;
    ev.preventDefault();
    const updated = await openCostItemsModal(items, displayCurrency, convertFn);
    if (!updated) return;
    onChange({ ...e, costItems: updated });
  });
  wrap.addEventListener('change', (ev) => {
    const inp = ev.target.closest('[data-cf]');
    if (!inp) return;
    const field = inp.dataset.cf;
    const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    onChange({ ...e, [field]: val });
  });
  return wrap;
}

function itemsWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 19) return 'статей';
  if (b === 1) return 'статья';
  if (b >= 2 && b <= 4) return 'статьи';
  return 'статей';
}

/**
 * Popup-редактор costItems: единая таблица «Статья / Кол-во / 3 × (Цена + Валюта) / × delete».
 * Возвращает обновлённый массив или null если отменили.
 */
export async function openCostItemsModal(initialItems, displayCurrency, convertFn) {
  const items = (initialItems || []).map(it => ({ ...it,
    equipmentPrice:          { ...it.equipmentPrice },
    installPrice:            { ...it.installPrice },
    maintenancePerYearPrice: { ...it.maintenancePerYearPrice },
  }));

  const curOptsFor = (sel) => CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''} title="${c.label}">${c.code}</option>`
  ).join('');

  const headerHtml = `
    <thead>
      <tr>
        <th title="Описание позиции (например «Чиллер York YLAA200» / «Блок насосов первичного контура»).">Статья</th>
        <th title="Количество одинаковых единиц этой позиции. Все цены умножаются на qty в итогах.">Кол-во</th>
        <th colspan="2" title="Стоимость ОДНОГО оборудования + валюта. Σ Оборудование = qty × value (с конвертацией).">Стоимость оборудования</th>
        <th colspan="2" title="Стоимость монтажа + ПНР для ОДНОЙ единицы + валюта.">Стоимость монтажа+ПНР</th>
        <th colspan="2" title="Стоимость ТО за год для ОДНОЙ единицы + валюта.">Стоимость ТО за год</th>
        <th></th>
      </tr>
    </thead>
  `;

  const renderRows = () => items.map((it, idx) => {
    const isAuto = !!it.linkedGroupId;
    const lockIcon = isAuto ? '🔒' : '';
    const qtyTitle = isAuto
      ? `Авто-qty из топологии (linkedGroupId=${it.linkedGroupId}). Чтобы изменить — отредактируйте qty группы оборудования во вкладке «🔗 Топология». Это правило: «количество основных железок жёстко связано с количеством в опции».`
      : 'Количество единиц этой позиции (пользовательская).';
    const labelTitle = isAuto
      ? 'Авто-связано с группой оборудования. Можно переименовать.'
      : 'Произвольное описание позиции.';
    const delBtn = isAuto
      ? `<button type="button" disabled class="cl-mi-del" style="opacity:0.3;cursor:not-allowed" title="Авто-строка от группы оборудования. Удалите группу во вкладке Топология чтобы убрать строку.">×</button>`
      : `<button type="button" class="cl-mi-del" title="Удалить эту позицию.">×</button>`;
    return `
    <tr data-row="${idx}" class="${isAuto ? 'cl-ci-auto-row' : ''}">
      <td>${lockIcon}<input type="text" class="cl-ci-label" data-attr="label" value="${escAttr(it.label || '')}" placeholder="Например: Чиллер York YLAA200..." title="${escAttr(labelTitle)}"></td>
      <td><input type="number" min="1" step="1" class="cl-ci-qty" data-attr="qty" value="${Number(it.qty) || 1}" title="${escAttr(qtyTitle)}"${isAuto ? ' readonly style="background:#f1f5f9;color:#64748b;cursor:not-allowed"' : ''}></td>
      <td><input type="number" min="0" step="100" class="cl-ci-val" data-col="equipmentPrice" data-attr="value" value="${Number(it.equipmentPrice?.value) || 0}" title="Стоимость одной единицы оборудования."></td>
      <td><select class="cl-ci-cur" data-col="equipmentPrice" data-attr="currency" title="Валюта стоимости оборудования.">${curOptsFor(it.equipmentPrice?.currency || displayCurrency)}</select></td>
      <td><input type="number" min="0" step="100" class="cl-ci-val" data-col="installPrice" data-attr="value" value="${Number(it.installPrice?.value) || 0}" title="Стоимость монтажа+ПНР для одной единицы."></td>
      <td><select class="cl-ci-cur" data-col="installPrice" data-attr="currency" title="Валюта стоимости монтажа.">${curOptsFor(it.installPrice?.currency || displayCurrency)}</select></td>
      <td><input type="number" min="0" step="100" class="cl-ci-val" data-col="maintenancePerYearPrice" data-attr="value" value="${Number(it.maintenancePerYearPrice?.value) || 0}" title="Стоимость ТО за год для одной единицы."></td>
      <td><select class="cl-ci-cur" data-col="maintenancePerYearPrice" data-attr="currency" title="Валюта стоимости ТО.">${curOptsFor(it.maintenancePerYearPrice?.currency || displayCurrency)}</select></td>
      <td>${delBtn}</td>
    </tr>
  `;}).join('');

  const renderTotals = () => {
    // Native totals (без конвертации, в валюте каждой ячейки) — отображаем
    // только итог в displayCurrency через computeEcoTotals.
    const eco = { costItems: items, currency: displayCurrency };
    const t = computeEcoTotals(eco, displayCurrency, convertFn);
    const fmt = (v) => fmtMoney(v, displayCurrency);
    return `
      <div class="cl-mi-totals" title="Итоги по разделам — каждая цена конвертирована из своей валюты в валюту проекта по курсу.">
        <div class="cl-mi-total-row">
          <span>Σ Оборудование:</span> <b>${fmt(t.equipmentCost)}</b>
        </div>
        <div class="cl-mi-total-row">
          <span>Σ Монтаж/ПНР:</span> <b>${fmt(t.installationCost)}</b>
        </div>
        <div class="cl-mi-total-row">
          <span>Σ ТО за год:</span> <b>${fmt(t.maintenancePerYearPrice ?? t.maintenanceRubPerYear)}</b>
        </div>
        <div class="cl-mi-total-row cl-mi-total-grand">
          <span>CAPEX (год 0):</span> <b>${fmt(t.equipmentCost + t.installationCost)}</b>
        </div>
      </div>
    `;
  };

  const bodyHtml = `
    <p class="cl-mi-hint" title="Каждая позиция — изделие с количеством и тремя ценами. Все цены могут быть в разных валютах. Итоги в валюте проекта.">
      Одна строка = одно изделие. Цены в любой валюте; итоги — в валюте проекта (${escHtml(displayCurrency)}).
    </p>
    <div class="cl-ci-table-wrap">
      <table class="cl-ci-table">
        ${headerHtml}
        <tbody id="cl-ci-tbody">${renderRows()}</tbody>
      </table>
      <button type="button" id="cl-ci-add" class="cl-mi-add-btn" title="Добавить новую пустую позицию.">+ Добавить позицию</button>
    </div>
    <div id="cl-ci-totals">${renderTotals()}</div>
  `;

  function rid() { return 'ci-' + Math.random().toString(36).slice(2, 8); }

  function syncFromDom(overlay) {
    const rows = overlay.querySelectorAll('#cl-ci-tbody tr[data-row]');
    rows.forEach(tr => {
      const idx = Number(tr.dataset.row);
      if (!items[idx]) return;
      items[idx].label = tr.querySelector('.cl-ci-label')?.value || '';
      // v0.60.23: для linkedGroupId-строк qty НЕ читаем из DOM (readonly).
      if (!items[idx].linkedGroupId) {
        items[idx].qty = Number(tr.querySelector('.cl-ci-qty')?.value) || 1;
      }
      ['equipmentPrice', 'installPrice', 'maintenancePerYearPrice'].forEach(col => {
        const valInp = tr.querySelector(`.cl-ci-val[data-col="${col}"]`);
        const curSel = tr.querySelector(`.cl-ci-cur[data-col="${col}"]`);
        if (!items[idx][col]) items[idx][col] = { value: 0, currency: displayCurrency };
        if (valInp) items[idx][col].value = Number(valInp.value) || 0;
        if (curSel) items[idx][col].currency = curSel.value;
      });
    });
  }

  const promise = modalOpen(
    `<h3>📦 Состав оборудования — статьи затрат</h3>`,
    bodyHtml,
    async (overlay) => {
      syncFromDom(overlay);
      const cleaned = items.filter(it =>
        (it.label && it.label.trim()) ||
        (Number(it.equipmentPrice?.value) || 0) > 0 ||
        (Number(it.installPrice?.value) || 0) > 0 ||
        (Number(it.maintenancePerYearPrice?.value) || 0) > 0
      );
      return { ok: true, payload: cleaned };
    }
  );
  requestAnimationFrame(() => bindModalEvents());
  const result = await promise;
  if (!result || !result.payload) return null;
  return result.payload;

  function bindModalEvents() {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    const tbody = overlay.querySelector('#cl-ci-tbody');
    const totalsBox = overlay.querySelector('#cl-ci-totals');
    const addBtn = overlay.querySelector('#cl-ci-add');

    const repaintTotals = () => { if (totalsBox) totalsBox.innerHTML = renderTotals(); };
    const repaintRows = () => { if (tbody) tbody.innerHTML = renderRows(); repaintTotals(); };

    overlay.addEventListener('input', (ev) => {
      const tr = ev.target.closest('tr[data-row]');
      if (!tr) return;
      const idx = Number(tr.dataset.row);
      if (!items[idx]) return;
      const attr = ev.target.dataset.attr;
      const col = ev.target.dataset.col;
      // v0.60.24: input НЕ обрабатывает currency (это было причиной что conversion
      // не работал — input для <select> срабатывал ДО change → oldCur === newCur).
      if (attr === 'currency') return;
      if (attr === 'label')     items[idx].label = ev.target.value;
      else if (attr === 'qty' && !items[idx].linkedGroupId) items[idx].qty = Number(ev.target.value) || 1;
      else if (col && attr === 'value') {
        if (!items[idx][col]) items[idx][col] = { value: 0, currency: displayCurrency };
        items[idx][col].value = Number(ev.target.value) || 0;
      }
      repaintTotals();
    });
    overlay.addEventListener('change', (ev) => {
      // Currency-select fires change (не input)
      const tr = ev.target.closest('tr[data-row]');
      if (!tr) return;
      const idx = Number(tr.dataset.row);
      if (!items[idx]) return;
      const col = ev.target.dataset.col;
      const attr = ev.target.dataset.attr;
      if (col && attr === 'currency') {
        if (!items[idx][col]) items[idx][col] = { value: 0, currency: displayCurrency };
        const oldCur = items[idx][col].currency;
        const newCur = ev.target.value;
        if (oldCur !== newCur) {
          // v0.60.24 (по требованию: «суммы не пересчитываются при изменении
          // валюты»): авто-пересчитать value по курсу. Раньше input-event
          // <select> срабатывал ДО change → oldCur === newCur. Теперь input
          // полностью игнорирует currency, а change делает конверсию.
          const curVal = Number(items[idx][col].value) || 0;
          if (curVal > 0) {
            if (!convertFn) {
              toast(`Курсы валют не загружены (${oldCur}→${newCur}). Откройте справочник 💱 в сайдбаре.`, 'err');
            } else {
              const v = convertFn(curVal, oldCur, newCur);
              if (Number.isFinite(v) && v > 0) {
                items[idx][col].value = +(v.toFixed(2));
                const valInp = tr.querySelector(`.cl-ci-val[data-col="${col}"]`);
                if (valInp) valInp.value = items[idx][col].value;
                toast(`${curVal} ${oldCur} → ${items[idx][col].value} ${newCur}`, 'ok');
              } else {
                toast(`Курс ${oldCur}→${newCur} не найден. Значение сохранено как есть.`, 'err');
              }
            }
          }
          items[idx][col].currency = newCur;
        }
        repaintTotals();
      }
    });
    overlay.addEventListener('click', (ev) => {
      const del = ev.target.closest('.cl-mi-del');
      if (del && !del.disabled) {
        const tr = del.closest('tr[data-row]');
        const idx = Number(tr.dataset.row);
        // v0.60.23: auto-row нельзя удалять — только через топологию.
        if (items[idx]?.linkedGroupId) return;
        items.splice(idx, 1);
        repaintRows();
      }
    });
    if (addBtn) addBtn.addEventListener('click', () => {
      items.push({
        id: rid(),
        label: '',
        qty: 1,
        equipmentPrice:          { value: 0, currency: displayCurrency },
        installPrice:            { value: 0, currency: displayCurrency },
        maintenancePerYearPrice: { value: 0, currency: displayCurrency },
      });
      repaintRows();
    });
  }
}

/**
 * KPI блок для одной TCO-конфигурации.
 */
export function renderTcoKpi(tcoResult, payback = null, currency = '₽') {
  if (!tcoResult) return '';
  const cur = currency || '₽';
  return `<div class="cl-fc-summary">
    <div class="cl-fc-summary-title" title="Итоги расчёта TCO для текущей конфигурации.">
      💰 TCO ${tcoResult.projectLifetimeYears} лет (discount ${tcoResult.discountRatePct.toFixed(1)}%)
    </div>
    <div class="cl-fc-kpi-grid">
      <div class="cl-fc-kpi" title="Капитальные затраты в год 0 = equipment + installation (Σ qty по всем статьям).">
        <span class="cl-fc-kpi-lbl">CAPEX</span>
        <span class="cl-fc-kpi-val">${fmtMoney(tcoResult.capex, cur)}</span>
      </div>
      <div class="cl-fc-kpi" title="Total Cost of Ownership = CAPEX + Σ дисконтированных OPEX за lifetime.">
        <span class="cl-fc-kpi-lbl">TCO (NPV)</span>
        <span class="cl-fc-kpi-val">${fmtMoney(tcoResult.tco, cur)}</span>
      </div>
      <div class="cl-fc-kpi" title="Без дисконтирования: CAPEX + Σ raw OPEX.">
        <span class="cl-fc-kpi-lbl">TCO (raw)</span>
        <span class="cl-fc-kpi-val">${fmtMoney(tcoResult.tcoUndiscounted, cur)}</span>
      </div>
      <div class="cl-fc-kpi" title="Среднегодовая стоимость владения = TCO / lifetime.">
        <span class="cl-fc-kpi-lbl">Среднее ${escHtml(cur)}/год</span>
        <span class="cl-fc-kpi-val">${fmtMoney(tcoResult.averageRubPerYear, cur)}</span>
      </div>
      ${payback ? `
      <div class="cl-fc-kpi cl-fc-kpi-saving" title="Discounted payback period — год t, в котором кумулятивный дисконтированный денежный поток (saved_OPEX − ΔCAPEX) переходит через 0.">
        <span class="cl-fc-kpi-lbl">Payback (vs baseline)</span>
        <span class="cl-fc-kpi-val">${payback.neverPaysBack ? '> ' + tcoResult.projectLifetimeYears + ' лет' : payback.exact.toFixed(1) + ' лет'}</span>
      </div>` : ''}
    </div>
  </div>`;
}
