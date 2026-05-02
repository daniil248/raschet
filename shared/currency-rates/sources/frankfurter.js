// =============================================================================
// shared/currency-rates/sources/frankfurter.js — Frankfurter.app (ECB)
// =============================================================================
// Source: https://www.frankfurter.app/
// Free, no API key. Курсы Европейского ЦБ (ECB), база EUR.
// Endpoint: https://api.frankfurter.app/YYYY-MM-DD
// Формат: { date, base, rates: { USD: 1.085, ... } }

import { register } from '../index.js';

async function fetchFrankfurter(date) {
  const resp = await fetch(`https://api.frankfurter.app/${date}`);
  if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`);
  const json = await resp.json();
  // base = EUR; rates = { USD: 1.085, ... } — это «1 EUR = 1.085 USD»
  // Для convert(): хотим rates[CUR] = «1 EUR в CUR» — что и есть.
  const rates = { ...json.rates, EUR: 1 };
  return { date: json.date || date, base: json.base || 'EUR', rates };
}

register({
  id: 'frankfurter',
  label: 'ECB / Frankfurter.app (EUR base)',
  base: 'EUR',
  url: 'https://www.frankfurter.app/',
  fetch: fetchFrankfurter,
});
