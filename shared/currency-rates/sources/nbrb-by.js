// =============================================================================
// shared/currency-rates/sources/nbrb-by.js — Национальный банк Беларуси
// =============================================================================
// Source: https://www.nbrb.by/statistics/rates
// Endpoint: https://api.nbrb.by/exrates/rates?ondate=YYYY-MM-DD&periodicity=0
//
// Возвращает массив { Cur_ID, Date, Cur_Abbreviation, Cur_Scale, Cur_Name,
//                     Cur_OfficialRate }
//   Cur_Abbreviation — ISO код (USD/EUR/...)
//   Cur_Scale        — кол-во единиц иностранной валюты для одного курса
//                      (например, 100 для JPY)
//   Cur_OfficialRate — Cur_Scale единиц = X BYN
// CORS обычно открыт.

import { register } from '../index.js';

async function fetchNbrbBy(date) {
  // date YYYY-MM-DD используем как есть
  const url = `https://api.nbrb.by/exrates/rates?ondate=${date}&periodicity=0`;
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
  if (!Array.isArray(json) || !json.length) throw new Error(`NBRB BY: ${lastErr?.message || 'unknown'}`);
  // base = BYN; rates[CUR] = «1 BYN в CUR» = Cur_Scale / Cur_OfficialRate
  const rates = { BYN: 1 };
  for (const row of json) {
    const cc = row.Cur_Abbreviation;
    const scale = parseFloat(row.Cur_Scale);
    const rate = parseFloat(row.Cur_OfficialRate);
    if (!cc || !Number.isFinite(scale) || !Number.isFinite(rate) || rate <= 0 || scale <= 0) continue;
    // rate = Cur_Scale CUR за X BYN → 1 BYN = scale/rate CUR
    rates[cc.toUpperCase()] = scale / rate;
  }
  return { date, base: 'BYN', rates };
}

register({
  id: 'nbrb-by',
  label: 'Национальный банк Беларуси',
  base: 'BYN',
  url: 'https://www.nbrb.by/',
  fetch: fetchNbrbBy,
});
