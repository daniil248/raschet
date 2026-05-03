// =============================================================================
// cooling/calc/fc-summary.js — сводные метрики free-cooling и потребления
// =============================================================================
// Pure-функции считающие raw-числа: FC часов/год, % года, energy, OPEX,
// savings vs noFC. Возвращают объект с числами; UI слой (fc-summary-view.js)
// форматирует в HTML.
//
// NO DOM. Pure JS.

import { buildBinData } from './chiller-bin-calc.js';

/**
 * Сводка по free-cooling и эксплуатационным затратам.
 *
 * @param {Array<object>} rows         — bin-строки с применённой spec (energy, fcFraction)
 * @param {object|null}  spec          — chillerSpec (для baseline-сравнения)
 * @param {number} tariffRubKwh        — тариф ₽/кВт·ч
 * @param {Array<object>} hourly       — исходный фильтрованный hourly (для baseline)
 *
 * @returns {object|null} { fcHours, fcPct, energyKwh, costRub,
 *                          baselineEnergyKwh, savedKwh, savedPct, savedRub,
 *                          tariff, fcActive, sysLabel }
 */
export function computeFcSummary(rows, spec, tariffRubKwh, hourly) {
  if (!spec || !(Number(spec.ratedCapKw) > 0)) return null;

  const totalHours = rows.reduce((a, r) => a + (r.hours || 0), 0);
  const fcHours    = rows.reduce((a, r) => a + (r.fcFraction || 0) * (r.hours || 0), 0);
  const fcPct      = totalHours > 0 ? (fcHours / totalHours * 100) : 0;
  const energyKwh  = rows.reduce((a, r) => a + (r.energy || 0), 0);
  const tariff     = Number(tariffRubKwh) || 0;
  const costRub    = energyKwh * tariff;

  // Baseline = тот же spec, но без FC
  const baselineSpec = {
    ...spec,
    systemType: spec.systemType === 'dx-pumped-fc' ? 'dx-air' : 'chiller',
    freeCoolingMode: 'none',
  };
  const baselineRows = buildBinData(hourly, baselineSpec);
  const baselineEnergyKwh = baselineRows.reduce((a, r) => a + (r.energy || 0), 0);
  const savedKwh = Math.max(0, baselineEnergyKwh - energyKwh);
  const savedPct = baselineEnergyKwh > 0 ? (savedKwh / baselineEnergyKwh * 100) : 0;
  const savedRub = savedKwh * tariff;

  const sysLabel = {
    'chiller':       `Чиллер (FC: ${spec.freeCoolingMode || 'none'})`,
    'dx-air':        'DX air-cooled',
    'dx-pumped-fc':  'DX pumped refrigerant FC',
  }[spec.systemType || 'chiller'];

  const fcActive = (spec.systemType === 'chiller' && spec.freeCoolingMode !== 'none')
                || spec.systemType === 'dx-pumped-fc';

  // v0.60.64 fix (bug-репорт Пользователя 2026-05-03 «58.28 МВт·ч это за год
   // или за расчетный период??»): добавляем annualized-метрики, считая
   // factor = (totalHours / 8760). При filter='год 2023' totalHours=8760 →
   // factor=1 → annual===период. При filter='все годы' с 10-летним датасетом
   // → factor≈10 → annual = period/10.
  const yearsInPeriod = totalHours > 0 ? totalHours / 8760 : 1;
  const annualEnergyKwh = yearsInPeriod > 0 ? energyKwh / yearsInPeriod : energyKwh;
  const annualCostRub = annualEnergyKwh * tariff;
  const annualFcHours = yearsInPeriod > 0 ? fcHours / yearsInPeriod : fcHours;
  const annualSavedKwh = yearsInPeriod > 0 ? savedKwh / yearsInPeriod : savedKwh;
  const annualSavedRub = annualSavedKwh * tariff;

  return {
    // Period-totals (то что считалось до v0.60.64)
    fcHours, fcPct, energyKwh, costRub,
    baselineEnergyKwh, savedKwh, savedPct, savedRub,
    // Per-year (нормализовано для удобства отображения)
    annualEnergyKwh, annualCostRub, annualFcHours, annualSavedKwh, annualSavedRub,
    yearsInPeriod,
    tariff, fcActive, sysLabel,
    totalHours, ratedCapKw: spec.ratedCapKw,
  };
}

/**
 * Хелперы форматирования (не привязаны к DOM, можно вызывать из UI).
 */
export function fmtKwh(v) {
  if (!Number.isFinite(v)) return '—';
  return v >= 1000000 ? `${(v/1000000).toFixed(2)} ГВт·ч`
    : v >= 1000 ? `${(v/1000).toFixed(2)} МВт·ч`
    : `${v.toFixed(0)} кВт·ч`;
}

/**
 * Универсальное форматирование денег с любым символом валюты.
 * @param {number} v — сумма
 * @param {string} cur — символ/код валюты (₽, $, €, ₸, ¥, Kč, ₣, ₩, ₺ и т.д.)
 */
export function fmtMoney(v, cur = '₽') {
  if (!Number.isFinite(v)) return '—';
  const c = cur || '₽';
  return v >= 1000000 ? `${(v/1000000).toFixed(2)} млн ${c}`
    : v >= 1000 ? `${(v/1000).toFixed(0)} тыс ${c}`
    : `${v.toFixed(0)} ${c}`;
}

/**
 * @deprecated — используйте fmtMoney(v, currency).
 * Оставлено для backward-compat.
 */
export function fmtRub(v) { return fmtMoney(v, '₽'); }

/**
 * Каталог поддерживаемых валют для UI-селектора.
 * code — символ для отображения; iso — ISO 4217 код для конвертации;
 * label — полное название.
 */
export const CURRENCIES = [
  { code: '₽',   iso: 'RUB', label: 'RUB · российский рубль' },
  { code: '$',   iso: 'USD', label: 'USD · доллар США' },
  { code: '€',   iso: 'EUR', label: 'EUR · евро' },
  { code: '₸',   iso: 'KZT', label: 'KZT · казахстанский тенге' },
  { code: '¥',   iso: 'CNY', label: 'CNY · юань (КНР)' },
  { code: '£',   iso: 'GBP', label: 'GBP · фунт стерлингов' },
  { code: 'Br',  iso: 'BYN', label: 'BYN · белорусский рубль' },
  { code: '₺',   iso: 'TRY', label: 'TRY · турецкая лира' },
  { code: '₴',   iso: 'UAH', label: 'UAH · украинская гривна' },
  { code: 'CHF', iso: 'CHF', label: 'CHF · швейцарский франк' },
];

/** Получить ISO-код валюты по её символу (₽ → RUB, $ → USD, ...). */
export function currencyToIso(code) {
  return CURRENCIES.find(c => c.code === code)?.iso || code;
}
