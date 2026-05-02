// =============================================================================
// cooling/ui/capex-form.js — форма ввода CAPEX/economics параметров
// =============================================================================
// HTML-форма для ввода equipmentCost / installation / maintenance / lifetime /
// discountRate / escalation. Tooltip на каждом параметре.
//
// v0.60.18: Компактный режим. Каждое денежное поле — клик-кнопка с тоталом и
// валютой. Клик открывает popup-таблицу статей затрат (хоть одна строка, хоть
// подробная разбивка). Поля пересчитываются с per-item конвертацией.

import { DEFAULT_ECONOMICS, MONEY_FIELDS, normMoney, moneyTotalIn } from '../calc/capex-tco.js';
import { fmtMoney, CURRENCIES } from '../calc/fc-summary.js';
import { escAttr, escHtml, modalOpen } from '../../meteo/util.js';

/**
 * @param {object} eco — economics parameters
 * @param {function(eco)} onChange
 * @param {string} displayCurrency — валюта проекта/отчёта
 * @param {function|null} convertFn — (amount, fromIso, toIso) => number
 *                       привязан к курсам на _ratesDate.
 */
export function renderCapexForm(eco, onChange, displayCurrency = '₽', convertFn = null) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  // Гарантируем, что денежные поля — объекты {value, currency, items?}.
  for (const f of MONEY_FIELDS) {
    e[f.id] = normMoney(e[f.id], e.currency || displayCurrency);
  }
  const wrap = document.createElement('div');
  wrap.className = 'cl-capex-form';

  // Компактная клик-кнопка для денежного поля.
  const moneyCell = (field) => {
    const m = e[field.id];
    const totalNative = m.items && m.items.length
      ? m.items.reduce((s, it) => s + (Number(it.value) || 0), 0)
      : m.value;
    const totalDisp = (convertFn && m.currency !== displayCurrency)
      ? moneyTotalIn(m, displayCurrency, convertFn, displayCurrency)
      : null;
    const itemsCount = (m.items && m.items.length) || 0;
    const perYear = field.perYear ? `/год` : '';
    const labelFull = `${field.label}${perYear ? ' (' + displayCurrency + perYear + ')' : ''}`;
    const dispHint = (Number.isFinite(totalDisp) && totalDisp > 0 && m.currency !== displayCurrency)
      ? `<span class="cl-money-conv" title="Эквивалент в валюте проекта по текущему курсу.">≈ ${totalDisp.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${escHtml(displayCurrency)}${perYear}</span>`
      : '';
    const itemsBadge = itemsCount > 1
      ? `<span class="cl-money-items-badge" title="Состоит из ${itemsCount} статей затрат.">${itemsCount} статей</span>`
      : (itemsCount === 1
        ? `<span class="cl-money-items-badge" title="1 статья затрат.">1 статья</span>`
        : `<span class="cl-money-items-badge cl-money-items-empty" title="Нет статей. Кликните, чтобы заполнить.">пусто</span>`);
    return `<div class="cl-money-cell" title="${escAttr(field.tip)} Кликните, чтобы открыть таблицу статей затрат.">
      <div class="cl-money-cell-lbl">${escHtml(labelFull)}</div>
      <button type="button" class="cl-money-cell-btn" data-money-edit="${escAttr(field.id)}">
        <span class="cl-money-cell-val">${totalNative.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${escHtml(m.currency)}${perYear}</span>
        ${itemsBadge}
      </button>
      ${dispHint}
    </div>`;
  };

  wrap.innerHTML = `
    <h4 title="Параметры экономической модели TCO/NPV/Payback. Соответствует ISO 15686-5 Life-Cycle Costing.">💰 CAPEX и экономические параметры</h4>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Капитальные затраты (год 0)</div>
      <p class="muted cl-capex-hint" title="Каждое поле — клик-кнопка с итоговой суммой. Клик открывает таблицу статей затрат (одна строка или подробная разбивка). У каждой статьи своя валюта; в отчётах суммы пересчитываются в валюту проекта (${escAttr(displayCurrency)}) по курсу.">
        ⓘ Кликните по сумме — откроется таблица статей затрат (хоть одна строка, хоть подробно).
      </p>
      <div class="cl-money-grid">
        ${moneyCell(MONEY_FIELDS[0])}
        ${moneyCell(MONEY_FIELDS[1])}
      </div>
    </div>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Эксплуатационные расходы</div>
      <div class="cl-money-grid">
        ${moneyCell(MONEY_FIELDS[2])}
        <label class="cl-compact-field" title="Срок горизонта оценки TCO. Типично 10–20 лет для HVAC, до 25 лет для крупных чиллеров.">
          <span>Срок проекта, лет</span>
          <input type="number" step="1" min="1" max="40" data-cf="projectLifetimeYears" value="${e.projectLifetimeYears}">
        </label>
      </div>
    </div>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Ставка дисконтирования и эскалация</div>
      <div class="cl-money-grid">
        <label class="cl-compact-field" title="Discount rate (ставка дисконтирования) — приведение будущих платежей к текущей стоимости. Типично:
• 8–10% для коммерческих проектов
• 12–15% для high-risk
• 5–7% для гос/инфраструктурных">
          <span>Discount rate, %/год</span>
          <input type="number" step="0.5" min="0" max="50" data-cf="discountRatePct" value="${e.discountRatePct}">
        </label>
        <label class="cl-compact-field" title="Годовой рост тарифа на электроэнергию. Применяется к OPEX_energy_t = base × (1+esc)^(t-1). РФ типично 4–7%/год.">
          <span>Эскалация эл/энергии, %/год</span>
          <input type="number" step="0.5" min="0" max="20" data-cf="escalationEnergyPct" value="${e.escalationEnergyPct}">
        </label>
        <label class="cl-compact-field" title="Годовой рост стоимости ТО (зарплаты + запчасти). Типично 3–5%/год.">
          <span>Эскалация ТО, %/год</span>
          <input type="number" step="0.5" min="0" max="20" data-cf="escalationMaintPct" value="${e.escalationMaintPct}">
        </label>
      </div>
    </div>
  `;

  wrap.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-money-edit]');
    if (!btn) return;
    ev.preventDefault();
    const id = btn.dataset.moneyEdit;
    const field = MONEY_FIELDS.find(f => f.id === id);
    if (!field) return;
    const cur = e[id];
    const updated = await openMoneyItemsModal(field, cur, displayCurrency, convertFn);
    if (!updated) return;
    onChange({ ...e, [id]: updated });
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

/**
 * v0.60.18: Popup-редактор статей затрат денежного поля.
 * Возвращает {value, currency, items} или null если отменили.
 */
export async function openMoneyItemsModal(field, money, displayCurrency, convertFn) {
  const m = normMoney(money, displayCurrency);
  // Если items пусто, но value > 0 — конвертируем legacy single-value в одну
  // статью «Прочее», чтобы не терять старое значение.
  let items = (m.items && m.items.length)
    ? m.items.map(it => ({ ...it }))
    : (m.value > 0 ? [{ id: rid(), label: 'Прочее', value: m.value, currency: m.currency }] : []);
  const fieldCur = m.currency || displayCurrency;

  const curOptsFor = (sel) => CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''} title="${c.label}">${c.code}</option>`
  ).join('');

  const renderRows = () => items.map((it, idx) => `
    <tr data-row="${idx}">
      <td><input type="text" class="cl-mi-label" data-attr="label" value="${escAttr(it.label || '')}" placeholder="Например: Чиллер York YLAA200..."></td>
      <td><input type="number" step="100" min="0" class="cl-mi-value" data-attr="value" value="${Number(it.value) || 0}"></td>
      <td><select class="cl-mi-currency" data-attr="currency">${curOptsFor(it.currency || fieldCur)}</select></td>
      <td><button type="button" class="cl-mi-del" title="Удалить эту статью.">×</button></td>
    </tr>
  `).join('');

  const tableBody = () => renderRows();
  const totalsHtml = () => {
    const sumNative = items.reduce((s, it) => {
      const v = Number(it.value) || 0;
      const ic = it.currency || fieldCur;
      if (ic === fieldCur) return s + v;
      if (convertFn) {
        const c = convertFn(v, ic, fieldCur);
        return s + (Number.isFinite(c) ? c : v);
      }
      return s + v;
    }, 0);
    const sumDisp = (fieldCur !== displayCurrency && convertFn)
      ? items.reduce((s, it) => {
        const v = Number(it.value) || 0;
        const ic = it.currency || fieldCur;
        if (ic === displayCurrency) return s + v;
        const c = convertFn(v, ic, displayCurrency);
        return s + (Number.isFinite(c) ? c : v);
      }, 0)
      : null;
    return `
      <div class="cl-mi-totals">
        <div class="cl-mi-total-main" title="Итог в валюте поля. Если статьи в других валютах — пересчитаны по курсу.">
          Итого: <b>${sumNative.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${escHtml(fieldCur)}</b>
        </div>
        ${(Number.isFinite(sumDisp) && fieldCur !== displayCurrency)
          ? `<div class="cl-mi-total-disp" title="Эквивалент в валюте проекта (${escAttr(displayCurrency)}) по текущему курсу.">≈ ${sumDisp.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${escHtml(displayCurrency)}</div>`
          : ''}
      </div>
    `;
  };

  const bodyHtml = `
    <p class="cl-mi-hint" title="Хоть одна строка, хоть подробная разбивка. У каждой статьи своя валюта; итог пересчитывается в валюту поля и в валюту проекта.">
      Заполните статьи затрат — одной строкой или с подробной разбивкой.
    </p>
    <div class="cl-mi-field-cur" title="Валюта поля. Используется для итога. Если статьи в других валютах — конвертация по курсу.">
      Валюта поля: <select id="cl-mi-field-cur">${curOptsFor(fieldCur)}</select>
    </div>
    <div class="cl-mi-table-wrap">
      <table class="cl-mi-table">
        <thead>
          <tr>
            <th title="Описание статьи затрат: что именно покупаем/работа.">Статья</th>
            <th title="Сумма за эту статью.">Сумма</th>
            <th title="Валюта статьи. Default = валюта поля.">Валюта</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="cl-mi-tbody">${tableBody()}</tbody>
      </table>
      <button type="button" id="cl-mi-add" class="cl-mi-add-btn" title="Добавить пустую строку.">+ Добавить статью</button>
    </div>
    <div id="cl-mi-totals">${totalsHtml()}</div>
  `;

  function rid() { return 'it-' + Math.random().toString(36).slice(2, 8); }

  function syncFromDom(overlay) {
    const rows = overlay.querySelectorAll('#cl-mi-tbody tr[data-row]');
    rows.forEach(tr => {
      const idx = Number(tr.dataset.row);
      if (!items[idx]) return;
      items[idx].label    = tr.querySelector('.cl-mi-label')?.value || '';
      items[idx].value    = Number(tr.querySelector('.cl-mi-value')?.value) || 0;
      items[idx].currency = tr.querySelector('.cl-mi-currency')?.value || fieldCur;
    });
  }

  // ВАЖНО: modalOpen создаёт overlay синхронно, но возвращает Promise. Чтобы
  // повесить hooks ДО того как пользователь нажмёт OK, инициируем modalOpen,
  // в следующем кадре биндим события (overlay уже в DOM), и только ПОТОМ
  // дожидаемся результата.
  const promise = modalOpen(
    `<h3>${escHtml(field.label)} — статьи затрат</h3>`,
    bodyHtml,
    async (overlay) => {
      syncFromDom(overlay);
      const finalCur = (overlay.querySelector('#cl-mi-field-cur')?.value) || fieldCur;
      const cleaned = items.filter(it => (it.label && it.label.trim()) || (Number(it.value) || 0) > 0);
      const total = cleaned.reduce((s, it) => {
        const v = Number(it.value) || 0;
        const ic = it.currency || finalCur;
        if (ic === finalCur) return s + v;
        if (convertFn) {
          const c = convertFn(v, ic, finalCur);
          return s + (Number.isFinite(c) ? c : v);
        }
        return s + v;
      }, 0);
      return { ok: true, payload: { value: total, currency: finalCur, items: cleaned } };
    }
  );
  requestAnimationFrame(() => bindModalEvents());
  const result = await promise;
  if (!result || !result.payload) return null;
  return result.payload;

  function bindModalEvents() {
    const overlay = document.querySelector('.mt-modal-overlay');
    if (!overlay) return;
    const tbody = overlay.querySelector('#cl-mi-tbody');
    const totalsBox = overlay.querySelector('#cl-mi-totals');
    const fieldCurSel = overlay.querySelector('#cl-mi-field-cur');
    const addBtn = overlay.querySelector('#cl-mi-add');

    const repaintTotals = () => { if (totalsBox) totalsBox.innerHTML = totalsHtml(); };
    const repaintRows = () => { if (tbody) tbody.innerHTML = tableBody(); repaintTotals(); };

    overlay.addEventListener('input', (ev) => {
      const tr = ev.target.closest('tr[data-row]');
      if (!tr) return;
      const idx = Number(tr.dataset.row);
      if (!items[idx]) return;
      const attr = ev.target.dataset.attr;
      if (attr === 'label')    items[idx].label = ev.target.value;
      if (attr === 'value')    items[idx].value = Number(ev.target.value) || 0;
      if (attr === 'currency') items[idx].currency = ev.target.value;
      repaintTotals();
    });

    overlay.addEventListener('click', (ev) => {
      const del = ev.target.closest('.cl-mi-del');
      if (del) {
        const tr = del.closest('tr[data-row]');
        const idx = Number(tr.dataset.row);
        items.splice(idx, 1);
        repaintRows();
        return;
      }
    });

    if (addBtn) addBtn.addEventListener('click', () => {
      const cur = fieldCurSel?.value || fieldCur;
      items.push({ id: rid(), label: '', value: 0, currency: cur });
      repaintRows();
    });

    if (fieldCurSel) fieldCurSel.addEventListener('change', () => {
      // При смене валюты поля — обновляем placeholder для новых строк, тоталы.
      repaintTotals();
    });
  }
}

/**
 * KPI блок для одной TCO-конфигурации.
 *
 * @param {object} tcoResult — результат computeTco
 * @param {object|null} payback — discountedPaybackYears vs baseline (или null)
 * @param {string} currency — символ валюты
 */
export function renderTcoKpi(tcoResult, payback = null, currency = '₽') {
  if (!tcoResult) return '';
  const cur = currency || '₽';
  return `<div class="cl-fc-summary">
    <div class="cl-fc-summary-title" title="Итоги расчёта TCO для текущей конфигурации.">
      💰 TCO ${tcoResult.projectLifetimeYears} лет (discount ${tcoResult.discountRatePct.toFixed(1)}%)
    </div>
    <div class="cl-fc-kpi-grid">
      <div class="cl-fc-kpi" title="Капитальные затраты в год 0 = equipment + installation.">
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
