// =============================================================================
// cooling/ui/comparison-view.js — side-by-side таблица сравнения
// =============================================================================
// Принимает результат compareOptions() и рендерит матрицу метрик с
// подсветкой «победителя» по каждой строке.

import { findBest } from '../calc/comparison.js';
import { fmtKwh, fmtMoney } from '../calc/fc-summary.js';
import { escAttr, escHtml } from '../../meteo/util.js';

/**
 * @param {Array<OptionMetrics>} metrics — результат compareOptions
 * @param {string} currency — символ валюты
 */
export function renderComparisonTable(metrics, currency = '₽') {
  const cur = currency || '₽';
  const fmtM = (v) => fmtMoney(v, cur);
  if (!metrics || !metrics.length) {
    return '<div class="muted">Добавьте конфигурации для сравнения.</div>';
  }

  // Метрики (id, label, тип сравнения, fmt, getter)
  const ROWS = [
    { id: 'sysType',   label: 'Тип системы',         tip: 'Чиллер / DX air-cooled / DX pumped FC.',                                fmt: (m) => m.spec.systemType,                                  cmp: null },
    { id: 'fcMode',    label: 'FC mode',             tip: 'Режим фрикулинга (только для чиллеров).',                                fmt: (m) => m.spec.systemType === 'chiller' ? m.spec.freeCoolingMode : '—', cmp: null },
    { id: 'rated',     label: 'Rated cap, кВт',      tip: 'Холодопроизводительность при ratedAmbient.',                             fmt: (m) => `${Math.round(m.spec.ratedCapKw)}`,                  cmp: null },
    { id: 'ratedCOP',  label: 'Rated COP',            tip: 'COP при ratedAmbient.',                                                  fmt: (m) => m.spec.ratedCOP.toFixed(2),                          cmp: 'higher', getter: (m) => m.spec.ratedCOP },
    { id: 'fcHours',   label: 'FC часов/год',         tip: 'Часы в году в режиме фрикулинга.',                                       fmt: (m) => `${m.fc.fcHours.toFixed(0)}`,                        cmp: 'higher', getter: (m) => m.fc.fcHours },
    { id: 'fcPct',     label: '% года в FC',          tip: 'Доля года в FC.',                                                        fmt: (m) => `${m.fc.fcPct.toFixed(1)} %`,                        cmp: 'higher', getter: (m) => m.fc.fcPct },
    { id: 'energy',    label: 'Эл. потребление',      tip: 'Годовое суммарное потребление.',                                         fmt: (m) => fmtKwh(m.fc.energyKwh),                              cmp: 'lower',  getter: (m) => m.fc.energyKwh },
    { id: 'opex',      label: 'OPEX за год',          tip: 'Годовые затраты на электричество.',                                      fmt: (m) => fmtM(m.fc.costRub),                                  cmp: 'lower',  getter: (m) => m.fc.costRub },
    { id: 'capex',     label: 'CAPEX',                tip: 'Equipment + installation.',                                              fmt: (m) => fmtM(m.tco.capex),                                   cmp: 'lower',  getter: (m) => m.tco.capex },
    { id: 'tco',       label: 'TCO (NPV)',            tip: 'Total Cost of Ownership с учётом дисконтирования за lifetime.',          fmt: (m) => fmtM(m.tco.tco),                                     cmp: 'lower',  getter: (m) => m.tco.tco },
    { id: 'tcoUndisc', label: 'TCO (raw)',            tip: 'Без дисконтирования.',                                                   fmt: (m) => fmtM(m.tco.tcoUndiscounted),                         cmp: 'lower',  getter: (m) => m.tco.tcoUndiscounted },
    { id: 'avgYear',   label: `Средн. ${cur}/год`,    tip: 'TCO / lifetime — средняя годовая стоимость владения.',                  fmt: (m) => fmtM(m.tco.averageRubPerYear),                       cmp: 'lower',  getter: (m) => m.tco.averageRubPerYear },
    { id: 'payback',   label: 'Payback vs baseline',  tip: 'Discounted payback за сколько лет ΔCAPEX окупается ΔOPEX-экономией.',  fmt: (m, i) => i === 0 ? 'baseline' : (m.payback ? (m.payback.neverPaysBack ? `> ${m.tco.projectLifetimeYears} лет` : `${m.payback.exact.toFixed(1)} лет`) : '—'), cmp: null },
  ];

  // Найти победителя по каждой row (если cmp задан)
  const winnerByRow = new Map();
  for (const row of ROWS) {
    if (!row.cmp || !row.getter) continue;
    const lowerIsBetter = row.cmp === 'lower';
    // Преобразуем getter к field-path для findBest — у нас есть getter, поэтому делаем inline
    let bestIdx = -1;
    let bestVal = lowerIsBetter ? Infinity : -Infinity;
    metrics.forEach((m, i) => {
      const v = row.getter(m);
      if (!Number.isFinite(v)) return;
      if (lowerIsBetter ? v < bestVal : v > bestVal) {
        bestVal = v; bestIdx = i;
      }
    });
    if (bestIdx >= 0) winnerByRow.set(row.id, bestIdx);
  }

  return `<table class="cl-comparison-table">
    <thead>
      <tr>
        <th title="Параметр сравнения">Параметр</th>
        ${metrics.map((m, i) => `<th title="${escAttr(m.spec.systemType)} · ${escAttr(m.spec.freeCoolingMode || 'no FC')}">${escHtml(m.name || `Опция ${i + 1}`)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${ROWS.map(row => `<tr>
        <th title="${escAttr(row.tip)}">${escHtml(row.label)}</th>
        ${metrics.map((m, i) => {
          const winner = winnerByRow.get(row.id) === i;
          const cls = winner ? 'cl-cmp-winner' : '';
          return `<td class="${cls}" title="${escAttr(row.tip)}${winner ? ' • Победитель по этой метрике' : ''}">${escHtml(row.fmt(m, i))}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>
  <p class="muted" style="font-size:11px;margin-top:6px">
    💡 Зелёная подсветка — лучшая опция по этой метрике. Payback считается относительно первой опции (baseline).
  </p>`;
}
