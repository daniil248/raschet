// =============================================================================
// shared/currency-rates/sources/exchangerate-host.js — exchangerate.host
// =============================================================================
// Source: https://exchangerate.host/
// Free, no API key. Поддержка любой даты с 1999 года.
// Endpoint: https://api.exchangerate.host/YYYY-MM-DD?base=USD
// Формат: { date, base, rates: { EUR: 0.92, RUB: 91.5, ... } }
//
// Ставит base='USD' для нашего модуля (но фактически API позволяет любой).

import { register } from '../index.js';

async function fetchExchangeRateHost(date) {
  const resp = await fetch(`https://api.exchangerate.host/${date}?base=USD`);
  if (!resp.ok) throw new Error(`exchangerate.host HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success && json.success !== undefined) {
    throw new Error('exchangerate.host: success=false');
  }
  const rates = { ...(json.rates || {}), USD: 1 };
  return { date: json.date || date, base: json.base || 'USD', rates };
}

register({
  id: 'exchangerate-host',
  label: 'exchangerate.host (USD base, открытое API)',
  base: 'USD',
  url: 'https://exchangerate.host/',
  fetch: fetchExchangeRateHost,
});
