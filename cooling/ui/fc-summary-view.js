// =============================================================================
// cooling/ui/fc-summary-view.js — HTML-вывод FC + OPEX сводки
// =============================================================================
// Использует pure-функцию computeFcSummary из calc/fc-summary.js,
// форматирует в KPI-grid HTML.

import { computeFcSummary, fmtKwh, fmtMoney } from '../calc/fc-summary.js';
import { escHtml } from '../../meteo/util.js';

/**
 * @param {Array<object>} rows
 * @param {object} spec
 * @param {number} tariffPerKwh — тариф (валюта/кВт·ч) в выбранной валюте
 * @param {Array<object>} hourly
 * @param {string} currency — символ валюты (₽/$/€/₸/¥/...)
 * @returns {string} HTML
 */
export function renderFreeCoolingSummary(rows, spec, tariffPerKwh, hourly, currency = '₽') {
  const sum = computeFcSummary(rows, spec, tariffPerKwh, hourly);
  if (!sum) return '';

  // v0.60.64: показываем per-year (нормализованные) числа. Если фильтр охватывает
  // несколько лет — добавляем sub-line «за период: N МВт·ч (Y лет)» для прозрачности.
  const isMultiYear = sum.yearsInPeriod > 1.05;
  const periodHint = isMultiYear ? ` <span class="cl-fc-kpi-sub" title="За весь выбранный период фильтра (Σ всех лет в hourly-датасете)">(за период ${sum.yearsInPeriod.toFixed(1)} лет: ${fmtKwh(sum.energyKwh)})</span>` : '';
  const fcPeriodHint = isMultiYear ? ` <span class="cl-fc-kpi-sub">(за период: ${sum.fcHours.toFixed(0)} ч)</span>` : '';

  return `<div class="cl-fc-summary">
    <div class="cl-fc-summary-title" title="Сводка по выбранной системе охлаждения и фрикулингу. Все значения нормализованы на 1 год (если фильтр охватывает N лет — делится на N).">
      📊 ${escHtml(sum.sysLabel)} · ${Math.round(sum.ratedCapKw)} кВт rated${isMultiYear ? ` <span style="font-size:11px;color:#475569">· датасет ${sum.yearsInPeriod.toFixed(1)} лет</span>` : ''}
    </div>
    <div class="cl-fc-kpi-grid">
      <div class="cl-fc-kpi" title="Часы в году в режиме фрикулинга (с учётом partial FC). Σ fc_fraction × часов_в_интервале / N_лет.">
        <span class="cl-fc-kpi-lbl">FC часов/год</span>
        <span class="cl-fc-kpi-val">${sum.annualFcHours.toFixed(0)} ч${fcPeriodHint}</span>
      </div>
      <div class="cl-fc-kpi" title="Доля года в режиме FC = FC_часы / общие_часы × 100. Не зависит от длины периода.">
        <span class="cl-fc-kpi-lbl">% года в FC</span>
        <span class="cl-fc-kpi-val">${sum.fcPct.toFixed(1)} %</span>
      </div>
      <div class="cl-fc-kpi" title="Среднегодовое эл. потребление = Σ P_total × hours / N_лет в датасете. При фильтре «1 год» = period.">
        <span class="cl-fc-kpi-lbl">Эл. потребление в год</span>
        <span class="cl-fc-kpi-val">${fmtKwh(sum.annualEnergyKwh)}${periodHint}</span>
      </div>
      ${sum.tariff > 0 ? `
      <div class="cl-fc-kpi" title="Годовые эксплуатационные затраты на электроэнергию = annualEnergy × tariff. Без обслуживания.">
        <span class="cl-fc-kpi-lbl">OPEX за год</span>
        <span class="cl-fc-kpi-val">${fmtMoney(sum.annualCostRub, currency)}</span>
      </div>` : ''}
      ${sum.fcActive ? `
      <div class="cl-fc-kpi cl-fc-kpi-saving" title="Экономия по сравнению с baseline (тот же чиллер/DX без free-cooling). ROI инвестиции в FC. Нормализовано на 1 год.">
        <span class="cl-fc-kpi-lbl">Экономия vs noFC</span>
        <span class="cl-fc-kpi-val">${fmtKwh(sum.annualSavedKwh)} <span class="cl-fc-kpi-sub">(−${sum.savedPct.toFixed(0)}%${sum.tariff > 0 ? ` · ${fmtMoney(sum.annualSavedRub, currency)}/год` : ''})</span></span>
      </div>` : ''}
    </div>
  </div>`;
}
