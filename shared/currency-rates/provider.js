// =============================================================================
// shared/currency-rates/provider.js — единый поставщик convertFn на дату
// =============================================================================
// Тонкая обёртка над shared/currency-rates/index.js. Один раз загружает
// курсы на дату (с LS-кэшем — повторно НЕ грузит, если дата уже была) и
// возвращает СИНХРОННЫЙ convertFn(amount, from, to), пригодный для
// cost-items-modal / capex-tco (computeEcoTotals / convertEcoToCurrency).
//
// Курсы кэшируются по дате в index.js. Перезагрузка с сервера — только
// при force (Пользователь нажал «Обновить курс») либо при первой
// встрече новой даты. Смена даты → новый convertFn.
//
// Использование:
//   import { makeConvertFn } from '../shared/currency-rates/provider.js';
//   const { convertFn, date, sourceId, cached, base } =
//       await makeConvertFn({ date: '2026-05-16' });
//   const usd = convertFn(1000, '₸', '$');   // синхронно

import { fetchRates, convert, getActiveSourceId } from './index.js';
import { currencyToIso } from '../money.js';
// side-effect: регистрация источников-плагинов
import './sources/index.js';

/* Доп. словесные обозначения, которых нет в money.js CURRENCIES. */
const EXTRA_TO_ISO = {
  'тг': 'KZT', 'руб': 'RUB', 'руб.': 'RUB', 'тыс. руб.': 'RUB',
  'тыс.руб.': 'RUB', '$.': 'USD',
};

/* Символ/слово валюты → ISO-код (index.js оперирует ISO 4217). */
function toIso(cur) {
  if (!cur) return cur;
  const c = String(cur).trim();
  if (EXTRA_TO_ISO[c]) return EXTRA_TO_ISO[c];
  const iso = currencyToIso(c);          // ₸→KZT, ₽→RUB, $→USD, …
  return (iso && iso !== c) ? iso : c.toUpperCase();
}

const _todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Построить convertFn на дату. Курсы берутся из LS-кэша (повторно не
 * грузятся), либо запрашиваются у активного источника один раз.
 *
 * @param {object} [o]
 *   @param {string} [o.date]     — YYYY-MM-DD (по умолчанию сегодня)
 *   @param {string} [o.sourceId] — id источника (по умолчанию активный)
 *   @param {boolean}[o.force]    — принудительно перезапросить (кнопка «Обновить»)
 * @returns {Promise<{convertFn:(a,from,to)=>number|null, date:string,
 *                     sourceId:string, cached:boolean, base:string|null,
 *                     error:string|null}>}
 */
export async function makeConvertFn(o = {}) {
  const date = o.date || _todayIso();
  const sourceId = o.sourceId || getActiveSourceId();
  let rates = null, cached = false, base = null, error = null;
  try {
    rates = await fetchRates(sourceId, date, !!o.force);
    cached = !!rates.cached;
    base = rates.base || null;
  } catch (e) {
    error = (e && e.message) || String(e);
  }
  const convertFn = (amount, from, to) => {
    const a = Number(amount);
    if (!Number.isFinite(a)) return null;
    const f = toIso(from), t = toIso(to);
    if (f === t) return a;
    if (!rates) return null;
    return convert(a, f, t, rates);
  };
  return { convertFn, date, sourceId, cached, base, error };
}

export { toIso };
