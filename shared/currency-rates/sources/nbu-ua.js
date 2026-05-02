// =============================================================================
// shared/currency-rates/sources/nbu-ua.js — Национальный банк Украины
// =============================================================================
// Source: https://bank.gov.ua/ua/markets/exchangerates/
// Endpoint: https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange
//           ?date=YYYYMMDD&json
//
// Возвращает массив { r030, txt, rate, cc, exchangedate }
//   cc      — код валюты (USD/EUR/...)
//   rate    — N UAH за 1 единицу (или несколько единиц — см. стандарт NBU)
// API публичное, без ключа. CORS обычно открыт.

import { register } from '../index.js';

async function fetchNbuUa(date) {
  // date YYYY-MM-DD → YYYYMMDD
  const yyyymmdd = date.replace(/-/g, '');
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${yyyymmdd}&json`;
  const tryUrls = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  let json = null, lastErr = null;
  for (const u of tryUrls) {
    try {
      const resp = await fetch(u);
      if (!resp.ok) { lastErr = new Error(`HTTP ${resp.status}`); continue; }
      json = await resp.json();
      if (Array.isArray(json) && json.length) break;
      lastErr = new Error('пустой ответ');
    } catch (e) { lastErr = e; }
  }
  if (!Array.isArray(json) || !json.length) throw new Error(`NBU UA: ${lastErr?.message || 'unknown'}`);
  // base = UAH; rates[CUR] = «1 UAH в CUR» = 1 / rate (если rate = N UAH за 1 CUR).
  const rates = { UAH: 1 };
  for (const row of json) {
    const cc = row.cc;
    const rate = parseFloat(row.rate);
    if (!cc || !Number.isFinite(rate) || rate <= 0) continue;
    // NBU rate = N UAH за 1 cc → 1 UAH = 1/N cc
    rates[cc.toUpperCase()] = 1 / rate;
  }
  return { date, base: 'UAH', rates };
}

register({
  id: 'nbu-ua',
  label: 'Национальный банк Украины',
  base: 'UAH',
  url: 'https://bank.gov.ua/',
  fetch: fetchNbuUa,
});
