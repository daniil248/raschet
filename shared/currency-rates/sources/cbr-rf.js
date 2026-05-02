// =============================================================================
// shared/currency-rates/sources/cbr-rf.js — ЦБ РФ (через cbr-xml-daily.ru)
// =============================================================================
// Source: https://www.cbr-xml-daily.ru/
// Endpoint:
//   today:  https://www.cbr-xml-daily.ru/daily_json.js
//   archive: https://www.cbr-xml-daily.ru/archive/YYYY/MM/DD/daily_json.js
//
// Возвращает JSON, рейты «X RUB за Y CUR».

import { register } from '../index.js';

async function fetchCbrRf(date) {
  const today = new Date().toISOString().slice(0, 10);
  const url = (date === today)
    ? 'https://www.cbr-xml-daily.ru/daily_json.js'
    : `https://www.cbr-xml-daily.ru/archive/${date.replace(/-/g, '/')}/daily_json.js`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`CBR RF HTTP ${resp.status}`);
  const json = await resp.json();
  // json.Valute = { USD: { Value: 91.5, Nominal: 1, ... }, JPY: { Value: 60.1, Nominal: 100 }, ... }
  // base = RUB. Хотим: 1 RUB = ? CUR
  const rates = { RUB: 1 };
  for (const [code, v] of Object.entries(json.Valute || {})) {
    const value = parseFloat(v.Value);
    const nominal = parseFloat(v.Nominal) || 1;
    if (!Number.isFinite(value) || value <= 0) continue;
    // value/nominal = «1 CUR в RUB» → 1 RUB = nominal / value CUR
    rates[code] = nominal / value;
  }
  return { date, base: 'RUB', rates };
}

register({
  id: 'cbr-rf',
  label: 'Центральный банк РФ',
  base: 'RUB',
  url: 'https://www.cbr.ru/',
  fetch: fetchCbrRf,
});
