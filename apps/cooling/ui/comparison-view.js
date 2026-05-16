// =============================================================================
// cooling/ui/comparison-view.js — side-by-side таблица сравнения
// =============================================================================
// Принимает результат compareOptions() и рендерит матрицу метрик с
// подсветкой «победителя» по каждой строке.

import { findBest } from '../calc/comparison.js';
import { fmtKwh, fmtMoney } from '../calc/fc-summary.js';
import { escAttr, escHtml } from 'meteo/util.js';

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

  // v0.60.18: метрики СИСТЕМНЫЕ (с учётом qty + N+R резервирования).
  // По требованию Пользователя 2026-05-02: «сравнивать нужно не отдельные
  // системы а системы на запрашиваемую мощность».
  const ROWS = [
    { id: 'sysType',   label: 'Тип системы',                tip: 'Тип основного агрегата опции (Чиллер / DX air-cooled / DX pumped FC / CRAC).',                  fmt: (m) => m.spec.systemType,                                  cmp: null },
    { id: 'fcMode',    label: 'FC mode',                     tip: 'Режим фрикулинга (только для чиллеров).',                                                       fmt: (m) => (m.spec.systemType || '').startsWith('chiller') ? (m.spec.freeCoolingMode || '—') : '—', cmp: null },
    { id: 'ratedUnit', label: 'Rated/единица, кВт',          tip: 'Номинальная холодопроизводительность ОДНОЙ единицы оборудования при ratedAmbient.',             fmt: (m) => `${Math.round(m.spec.ratedCapKw || 0)}`,             cmp: null },
    { id: 'totalQty',  label: 'Кол-во в системе, шт',        tip: 'Σ qty по всем equipment-группам (N+R суммарно). Определяется из требуемой мощности и резервирования.', fmt: (m) => `${m.totalQty || 0}`,                                cmp: null },
    { id: 'installed', label: 'Установлено системой, кВт',   tip: 'Σ ratedCapKw × активные единицы (без cold-резерва). Должно покрывать требуемую мощность с запасом.', fmt: (m) => `${Math.round(m.installedKw || 0)}`,                cmp: 'higher', getter: (m) => m.installedKw || 0 },
    { id: 'ratedCOP',  label: 'Rated COP/единица',           tip: 'COP одной единицы при ratedAmbient.',                                                          fmt: (m) => (m.spec.ratedCOP || 0).toFixed(2),                   cmp: 'higher', getter: (m) => m.spec.ratedCOP || 0 },
    { id: 'fcHours',   label: 'FC часов/год',                 tip: 'Часы в году с partial/full free-cooling (нормализовано на 1 год: Σ fc_fraction × hours / N_лет в датасете). v0.60.64: фикс — раньше использовался несуществующий freeCoolingThresholdC и всегда показывалось 0.', fmt: (m) => `${(m.fc.fcHours || 0).toFixed(0)}`,                cmp: 'higher', getter: (m) => m.fc.fcHours || 0 },
    { id: 'fcPct',     label: '% года в FC',                  tip: 'Доля года в FC = FC_часы / общие_часы × 100. Не зависит от длины периода.',                  fmt: (m) => `${(m.fc.fcPct || 0).toFixed(1)} %`,                cmp: 'higher', getter: (m) => m.fc.fcPct || 0 },
    { id: 'energy',    label: 'Эл. потребление в год',       tip: 'Среднегодовое эл. потребление системы (кВт·ч/год). Нормализовано на 1 год: Σ Power × hours / N_лет в hourly-датасете. cold-резерв = 0; hot-резерв делит нагрузку.',          fmt: (m) => fmtKwh(m.fc.energyKwh),                              cmp: 'lower',  getter: (m) => m.fc.energyKwh },
    { id: 'opex',      label: 'OPEX за год (электр.)',       tip: 'Годовые затраты системы на электричество (annualEnergy × тариф). Нормализовано на 1 год.',     fmt: (m) => fmtM(m.fc.costRub),                                  cmp: 'lower',  getter: (m) => m.fc.costRub },
    { id: 'capex',     label: 'CAPEX системы',                tip: 'Equipment + installation × Σ qty. Денежные поля eco.* трактуются как стоимость ОДНОЙ единицы и масштабируются на количество.', fmt: (m) => fmtM(m.tco.capex),                                   cmp: 'lower',  getter: (m) => m.tco.capex },
    { id: 'tco',       label: 'TCO системы (NPV)',            tip: 'Total Cost of Ownership всей системы с дисконтированием за lifetime.',                          fmt: (m) => fmtM(m.tco.tco),                                     cmp: 'lower',  getter: (m) => m.tco.tco },
    { id: 'tcoUndisc', label: 'TCO системы (raw)',            tip: 'Без дисконтирования.',                                                                          fmt: (m) => fmtM(m.tco.tcoUndiscounted),                         cmp: 'lower',  getter: (m) => m.tco.tcoUndiscounted },
    { id: 'avgYear',   label: `Средн. ${cur}/год`,            tip: 'TCO / lifetime — средняя годовая стоимость владения системой.',                                fmt: (m) => fmtM(m.tco.averageRubPerYear),                       cmp: 'lower',  getter: (m) => m.tco.averageRubPerYear },
    { id: 'payback',   label: 'Payback vs baseline',         tip: 'Discounted payback за сколько лет ΔCAPEX окупается ΔOPEX-экономией. Baseline = первая опция (★ основная).', fmt: (m, i) => i === 0 ? 'baseline' : (m.payback ? (m.payback.neverPaysBack ? `> ${m.tco.projectLifetimeYears} лет` : `${m.payback.exact.toFixed(1)} лет`) : '—'), cmp: null },
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

  return `<div class="cl-cmp-banner" title="Все денежные и энергетические метрики посчитаны на ВСЮ систему: per-unit-spec × Σ qty (количество единиц по группам с учётом N+R резервирования). По требованию: «сравнивать нужно не отдельные системы а системы на запрашиваемую мощность».">
    📊 <b>Сравнение СИСТЕМ на требуемую мощность</b> — energy/CAPEX/OPEX/TCO посчитаны на ВЕСЬ комплекс с учётом qty + резерва каждой опции.
  </div>
  <table class="cl-comparison-table">
    <thead>
      <tr>
        <th title="Параметр сравнения">Параметр</th>
        ${metrics.map((m, i) => `<th title="${escAttr(m.spec.systemType || '?')} · qty=${m.totalQty || 0} · установлено ${Math.round(m.installedKw || 0)} кВт">${escHtml(m.name || `Опция ${i + 1}`)}</th>`).join('')}
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
