// =============================================================================
// cooling/ui/energy-chart.js — stacked bar чарт по бинам T_amb
// =============================================================================
// Chart.js (загружается из cooling/index.html через CDN). Вынесено из
// meteo/charts.js → drawChillerEnergyChart.

let _chartRegistry = new Map();
function destroyExisting(cvs) {
  const existing = _chartRegistry.get(cvs.id);
  if (existing) { try { existing.destroy(); } catch {} _chartRegistry.delete(cvs.id); }
}
function register(cvs, chart) { _chartRegistry.set(cvs.id, chart); }
const CHART = () => (typeof window !== 'undefined' && window.Chart) ? window.Chart : null;

/**
 * Stacked-bar: per-bin годовая энергия с разбивкой на компрессор + FC aux.
 *
 * @param {HTMLCanvasElement} cvs
 * @param {Array<object>} rows — bin-строки с применённой spec
 */
export function drawChillerEnergyChart(cvs, rows) {
  const Chart = CHART();
  if (!Chart || !cvs) return;
  destroyExisting(cvs);
  if (!rows || !rows.length || !rows.some(r => Number.isFinite(r.energy))) {
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = '#9ca3af'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Задайте Chiller / DX spec для расчёта', cvs.width / 2, cvs.height / 2);
    return;
  }

  const labels = [];
  const mechKwh = [];
  const auxKwh = [];
  for (const r of rows) {
    if (!Number.isFinite(r.energy)) continue;
    labels.push(r.tBin);
    const fc = r.fcFraction || 0;
    const mechPower = (1 - fc) * (r.capacity || 0) / Math.max(0.01, r.copMech || 1);
    const totalPower = r.power || 0;
    const auxPower = Math.max(0, totalPower - mechPower);
    mechKwh.push(mechPower * r.hours);
    auxKwh.push(auxPower * r.hours);
  }

  register(cvs, new Chart(cvs, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Компрессор (мех)', data: mechKwh, backgroundColor: 'rgba(220,38,38,0.85)', borderColor: 'rgba(220,38,38,1)', borderWidth: 1, stack: 'energy' },
        { label: 'Free-cooling aux (насосы/вент)', data: auxKwh, backgroundColor: 'rgba(22,163,74,0.85)', borderColor: 'rgba(22,163,74,1)', borderWidth: 1, stack: 'energy' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: (items) => `T_amb = ${items[0].label} °C`,
            footer: (items) => `Σ за бин: ${items.reduce((a, it) => a + (it.parsed.y || 0), 0).toFixed(0)} кВт·ч/год`,
            label: (it) => `${it.dataset.label}: ${it.parsed.y.toFixed(0)} кВт·ч/год`,
          },
        },
        title: { display: true, text: 'Годовое эл. потребление по бинам T_amb (стек: компрессор + aux)', font: { size: 12, weight: 600 }, color: '#075985' },
      },
      scales: {
        x: { stacked: true, title: { display: true, text: 'Ambient T, °C' }, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 30 } },
        y: { stacked: true, title: { display: true, text: 'кВт·ч / год' }, beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
      },
    },
  }));
}

/**
 * TCO line chart: кумулятивные дисконтированные затраты по годам для
 * нескольких опций. Помогает увидеть точку payback графически.
 *
 * @param {HTMLCanvasElement} cvs
 * @param {Array<{name, tco}>} options — массив TCO-результатов
 */
export function drawTcoChart(cvs, options) {
  const Chart = CHART();
  if (!Chart || !cvs) return;
  destroyExisting(cvs);
  if (!options || !options.length) {
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = '#9ca3af'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Заполните CAPEX и тариф для расчёта TCO', cvs.width / 2, cvs.height / 2);
    return;
  }
  const N = options[0].tco?.yearlyOpex?.length || 0;
  const labels = Array.from({ length: N + 1 }, (_, i) => i);  // годы 0..N
  const palette = ['#1e40af', '#dc2626', '#15803d', '#a16207', '#7c3aed'];
  const datasets = options.map((opt, i) => {
    const data = [opt.tco.capex, ...opt.tco.yearlyOpex.map(y => y.cumDiscounted)];
    return {
      label: opt.name || `Опция ${i + 1}`,
      data, borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length] + '20',
      borderWidth: 2, fill: false, tension: 0.1,
    };
  });

  register(cvs, new Chart(cvs, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
        title: { display: true, text: 'Кумулятивный дисконтированный TCO по годам, ₽', font: { size: 12, weight: 600 }, color: '#075985' },
        tooltip: { callbacks: { label: (it) => `${it.dataset.label}: ${it.parsed.y.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽` } },
      },
      scales: {
        x: { title: { display: true, text: 'Год от начала эксплуатации' }, grid: { display: false } },
        y: { title: { display: true, text: 'Кумул. дисконт. затраты, ₽' }, beginAtZero: true, ticks: { callback: (v) => v.toLocaleString('ru-RU') } },
      },
    },
  }));
}
