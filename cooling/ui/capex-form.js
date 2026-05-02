// =============================================================================
// cooling/ui/capex-form.js — форма ввода CAPEX/economics параметров
// =============================================================================
// HTML-форма для ввода equipmentCost / installation / maintenance / lifetime /
// discountRate / escalation. Tooltip на каждом параметре.

import { DEFAULT_ECONOMICS } from '../calc/capex-tco.js';
import { fmtMoney } from '../calc/fc-summary.js';
import { escAttr, escHtml } from '../../meteo/util.js';

/**
 * @param {object} eco — economics parameters (или null → DEFAULT_ECONOMICS)
 * @param {function(eco)} onChange
 * @param {string} currency — символ валюты для подписей
 */
export function renderCapexForm(eco, onChange, currency = '₽') {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  const cur = currency || '₽';
  const wrap = document.createElement('div');
  wrap.className = 'cl-capex-form';
  wrap.innerHTML = `
    <h4 title="Параметры экономической модели TCO/NPV/Payback. Соответствует ISO 15686-5 Life-Cycle Costing.">💰 CAPEX и экономические параметры</h4>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Капитальные затраты (год 0)</div>
      <div class="cl-chiller-grid">
        <label title="Закупочная стоимость оборудования: чиллер/DX-блок + конденсатор + насосы + (опционально) free-cooling модули.">
          Оборудование, ${escHtml(cur)}:<input type="number" step="1000" min="0" data-cf="equipmentCost" value="${e.equipmentCost}">
        </label>
        <label title="Монтаж + пусконаладка + обвязка трубопроводами + электроподключение + вспомогательные работы.">
          Монтаж/ПНР, ${escHtml(cur)}:<input type="number" step="1000" min="0" data-cf="installationCost" value="${e.installationCost}">
        </label>
      </div>
    </div>
    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Эксплуатационные расходы</div>
      <div class="cl-chiller-grid">
        <label title="Регламентное ТО: фильтры, чистка теплообменников, заправка хладагента, выезд сервисной бригады.">
          ТО, ${escHtml(cur)}/год:<input type="number" step="1000" min="0" data-cf="maintenanceRubPerYear" value="${e.maintenanceRubPerYear}">
        </label>
        <label title="Срок горизонта оценки TCO. Типично 10–20 лет для HVAC, до 25 лет для крупных чиллеров. Свыше lifetime оборудование требует капремонта или замены.">
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
