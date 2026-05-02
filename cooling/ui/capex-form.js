// =============================================================================
// cooling/ui/capex-form.js — форма ввода CAPEX/economics параметров
// =============================================================================
// HTML-форма для ввода equipmentCost / installation / maintenance / lifetime /
// discountRate / escalation. Tooltip на каждом параметре.

import { DEFAULT_ECONOMICS, MONEY_FIELDS, normMoney } from '../calc/capex-tco.js';
import { fmtMoney, CURRENCIES, currencyToIso } from '../calc/fc-summary.js';
import { escAttr, escHtml } from '../../meteo/util.js';

/**
 * v0.60.0: Per-field currency. Каждое денежное поле — пара {value, currency}.
 * При смене валюты в селекторе — auto-конвертация значения по курсу через
 * convertFn (передан caller'ом).
 *
 * @param {object} eco — economics parameters
 * @param {function(eco)} onChange
 * @param {string} displayCurrency — валюта проекта/отчёта
 * @param {function|null} convertFn — (amount, fromIso, toIso) => number
 *                       привязан к курсам на _ratesDate.
 */
export function renderCapexForm(eco, onChange, displayCurrency = '₽', convertFn = null) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  // Гарантируем, что денежные поля — объекты {value, currency}.
  for (const f of MONEY_FIELDS) {
    e[f.id] = normMoney(e[f.id], e.currency || displayCurrency);
  }
  const wrap = document.createElement('div');
  wrap.className = 'cl-capex-form';
  const curOptsFor = (sel) => CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''} title="${c.label}">${c.code}</option>`
  ).join('');
  // Per-field денежная строка: input value + select currency. На дисплее
  // справа от поля — значение в валюте проекта (если отличается).
  const moneyRow = (field) => {
    const m = e[field.id];
    const conv = (convertFn && m.currency !== displayCurrency && m.value > 0)
      ? convertFn(m.value, m.currency, displayCurrency)
      : null;
    const projHint = (Number.isFinite(conv) && conv > 0)
      ? `<span class="cl-money-conv" title="Эквивалент в валюте проекта (${escAttr(displayCurrency)}) по текущему курсу из 💱 Справочника валют на выбранную дату.">≈ ${conv.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${escHtml(displayCurrency)}</span>`
      : '';
    return `<label title="${escAttr(field.tip)}">
      ${escHtml(field.label)}${field.perYear ? '' : ''}:
      <span class="cl-money-input">
        <input type="number" step="1000" min="0" data-money-id="${escAttr(field.id)}" data-money-attr="value" value="${m.value}">
        <select data-money-id="${escAttr(field.id)}" data-money-attr="currency" title="Валюта ввода. Default = валюта проекта. При смене — значение пересчитается по курсу.">${curOptsFor(m.currency)}</select>
      </span>
      ${projHint}
    </label>`;
  };

  wrap.innerHTML = `
    <h4 title="Параметры экономической модели TCO/NPV/Payback. Соответствует ISO 15686-5 Life-Cycle Costing.">💰 CAPEX и экономические параметры</h4>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Капитальные затраты (год 0)</div>
      <p class="muted" style="font-size:11px;margin:0 0 8px" title="Каждое поле — пара (значение, валюта). Default валюта = валюта проекта (${escAttr(displayCurrency)}). При смене валюты в селекторе значение auto-пересчитывается по курсу на текущую «Дату курса» (выбрана в боковой панели).">
        ⓘ Каждое поле в собственной валюте. На дисплее эквивалент в валюте проекта (${escHtml(displayCurrency)}). Изменение валюты → автоконвертация по курсу.
      </p>
      <div class="cl-chiller-grid">
        ${moneyRow(MONEY_FIELDS[0])}
        ${moneyRow(MONEY_FIELDS[1])}
      </div>
    </div>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Эксплуатационные расходы</div>
      <div class="cl-chiller-grid">
        ${moneyRow(MONEY_FIELDS[2])}
        <label title="Срок горизонта оценки TCO. Типично 10–20 лет для HVAC, до 25 лет для крупных чиллеров.">
          Срок проекта, лет:<input type="number" step="1" min="1" max="40" data-cf="projectLifetimeYears" value="${e.projectLifetimeYears}">
        </label>
      </div>
    </div>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Ставка дисконтирования и эскалация</div>
      <div class="cl-chiller-grid">
        <label title="Discount rate (ставка дисконтирования) — приведение будущих платежей к текущей стоимости. Типично:
• 8–10% для коммерческих проектов
• 12–15% для high-risk
• 5–7% для гос/инфраструктурных">
          Discount rate, %/год:<input type="number" step="0.5" min="0" max="50" data-cf="discountRatePct" value="${e.discountRatePct}">
        </label>
        <label title="Годовой рост тарифа на электроэнергию. Применяется к OPEX_energy_t = base × (1+esc)^(t-1). РФ типично 4–7%/год.">
          Эскалация эл/энергии, %/год:<input type="number" step="0.5" min="0" max="20" data-cf="escalationEnergyPct" value="${e.escalationEnergyPct}">
        </label>
        <label title="Годовой рост стоимости ТО (зарплаты + запчасти). Типично 3–5%/год.">
          Эскалация ТО, %/год:<input type="number" step="0.5" min="0" max="20" data-cf="escalationMaintPct" value="${e.escalationMaintPct}">
        </label>
      </div>
    </div>
  `;
  wrap.addEventListener('change', (ev) => {
    // v0.60.0: per-field money input/select
    const moneyEl = ev.target.closest('[data-money-id]');
    if (moneyEl) {
      const id = moneyEl.dataset.moneyId;
      const attr = moneyEl.dataset.moneyAttr;
      const cur = e[id] || { value: 0, currency: displayCurrency };
      if (attr === 'value') {
        cur.value = Number(moneyEl.value) || 0;
        onChange({ ...e, [id]: { ...cur } });
        return;
      }
      if (attr === 'currency') {
        const oldCur = cur.currency;
        const newCur = moneyEl.value;
        if (oldCur === newCur) return;
        let newValue = cur.value;
        // Auto-конвертация по курсу при смене валюты (по требованию).
        if (convertFn && cur.value > 0) {
          const conv = convertFn(cur.value, oldCur, newCur);
          if (Number.isFinite(conv) && conv > 0) newValue = Math.round(conv);
        }
        onChange({ ...e, [id]: { value: newValue, currency: newCur } });
        return;
      }
    }
    // Прочие поля (projectLifetimeYears, discountRatePct, escalation*)
    const inp = ev.target.closest('[data-cf]');
    if (!inp) return;
    const field = inp.dataset.cf;
    const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    onChange({ ...e, [field]: val });
  });
  return wrap;
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
