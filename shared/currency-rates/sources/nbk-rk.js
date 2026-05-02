// =============================================================================
// shared/currency-rates/sources/nbk-rk.js — Национальный банк РК
// =============================================================================
// Source: https://nationalbank.kz/?docid=2304
// API endpoint: https://nationalbank.kz/rss/get_rates.cfm?fdate=DD.MM.YYYY
//
// Возвращает RSS-XML с курсами всех валют к KZT на указанную дату.
// Фактически курсы публикуются на рабочие дни; запрос на выходной/праздник
// возвращает пустой/последний рабочий курс — обрабатываем gracefully.
//
// Парсинг XML без зависимостей: regex по <item><title>USD</title><description>478.5</description></item>.

import { register } from '../index.js';

async function fetchNbkRk(date) {
  // date = YYYY-MM-DD → DD.MM.YYYY
  const [y, m, d] = date.split('-');
  const fdate = `${d}.${m}.${y}`;
  const url = `https://nationalbank.kz/rss/get_rates.cfm?fdate=${fdate}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NBK RK HTTP ${resp.status}`);
  const xml = await resp.text();
  // Парсим item-блоки: <item> <title>...</title> <description>...</description> <quant>...</quant> </item>
  const rates = {};
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m2;
  while ((m2 = itemRe.exec(xml)) !== null) {
    const block = m2[1];
    const title = (block.match(/<title>([^<]*)<\/title>/) || [])[1];
    const desc  = (block.match(/<description>([^<]*)<\/description>/) || [])[1];
    const quant = +(block.match(/<quant>([^<]*)<\/quant>/) || [])[1] || 1;
    if (!title || !desc) continue;
    const rate = parseFloat(desc.replace(',', '.'));
    if (Number.isFinite(rate) && rate > 0) {
      // rate в RSS показан как «X KZT за `quant` единиц валюты».
      // Нам нужен «1 KZT = ? CUR» (т.к. base = KZT).
      // Если указано «1 USD = 478.5 KZT» (quant=1) → 1 KZT = 1 / 478.5 USD.
      // Если quant=10, то «10 JPY = X KZT» → 1 KZT = quant / X JPY.
      rates[title.toUpperCase()] = quant / rate;
    }
  }
  // KZT = base, добавляем сам KZT = 1
  rates.KZT = 1;
  return { date, base: 'KZT', rates };
}

register({
  id: 'nbk-rk',
  label: 'Национальный банк РК',
  base: 'KZT',
  url: 'https://nationalbank.kz/',
  fetch: fetchNbkRk,
});
