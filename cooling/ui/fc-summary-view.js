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

  return `<div class="cl-fc-summary">
    <div class="cl-fc-summary-title" title="Сводка по выбранной системе охлаждения и фрикулингу.">
      📊 ${escHtml(sum.sysLabel)} · ${Math.round(sum.ratedCapKw)} кВт rated
    </div>
    <div class="cl-fc-kpi-grid">
      <div class="cl-fc-kpi" title="Часы в году в режиме фрикулинга (с учётом partial FC). Σ fc_fraction × часов_в_интервале.">
        <span class="cl-fc-kpi-lbl">FC часов/год</span>
        <span class="cl-fc-kpi-val">${sum.fcHours.toFixed(0)} ч</span>
      </div>
      <div class="cl-fc-kpi" title="Доля года в режиме FC = FC_часы / общие_часы × 100.">
        <span class="cl-fc-kpi-lbl">% года в FC</span>
        <span class="cl-fc-kpi-val">${sum.fcPct.toFixed(1)} %</span>
      </div>
      <div class="cl-fc-kpi" title="Годовое эл. потребление = Σ P_total × hours.">
        <span class="cl-fc-kpi-lbl">Эл. потребление</span>
        <span class="cl-fc-kpi-val">${fmtKwh(sum.energyKwh)}</span>
      </div>
      ${sum.tariff > 0 ? `
      <div class="cl-fc-kpi" title="Годовые эксплуатационные затраты на электроэнергию = Energy × tariff. Без обслуживания.">
        <span class="cl-fc-kpi-lbl">OPEX за год</span>
        <span class="cl-fc-kpi-val">${fmtMoney(sum.costRub, currency)}</span>
      </div>` : ''}
      ${sum.fcActive ? `
      <div class="cl-fc-kpi cl-fc-kpi-saving" title="Экономия по сравнению с baseline (тот же чиллер/DX без free-cooling). ROI инвестиции в FC.">
        <span class="cl-fc-kpi-lbl">Экономия vs noFC</span>
        <span class="cl-fc-kpi-val">${fmtKwh(sum.savedKwh)} <span class="cl-fc-kpi-sub">(−${sum.savedPct.toFixed(0)}%${sum.tariff > 0 ? ` · ${fmtMoney(sum.savedRub, currency)}/год` : ''})</span></span>
      </div>` : ''}
    </div>
  </div>`;
}
