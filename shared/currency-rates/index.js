// =============================================================================
// shared/currency-rates/index.js — справочник валют с историческими курсами
// =============================================================================
// Pure-функции загрузки/кеширования/конвертации валютных курсов на дату.
// Источники регистрируются как плагины (registry-pattern, аналогично meteo).
//
// Хранение в LS:
//   raschet.shared.currencyRates.cache.v1 = {
//     [sourceId]: {
//       [YYYY-MM-DD]: { base: 'KZT', rates: { 'USD': 478.5, 'EUR': 502.1, ... } }
//     }
//   }
//   raschet.shared.currencyRates.activeSource.v1 = 'nbk-rk'
//
// Конвертация amount: amount × rates[from] / rates[to] (через base).
//
// Для использования из любого модуля — импортируйте:
//   import { fetchRates, convert, listSources } from '../shared/currency-rates/index.js';

const KEY_CACHE  = 'raschet.shared.currencyRates.cache.v1';
const KEY_SOURCE = 'raschet.shared.currencyRates.activeSource.v1';

const _sources = new Map();   // id → { id, label, base, async fetch(date) }

/**
 * Зарегистрировать источник курсов. Использует side-effect import плагинов.
 *
 * @param {object} src
 *   @param {string} src.id
 *   @param {string} src.label
 *   @param {string} src.base — базовая валюта источника (валюта страны)
 *   @param {string} src.url — base URL для info
 *   @param {async function(date)} src.fetch — возвращает { date, base, rates: {CUR: rate} }
 *                                              где rate = (1 base) → CUR
 */
export function register(src) {
  if (!src || !src.id || typeof src.fetch !== 'function') return;
  _sources.set(src.id, src);
}

export function listSources() {
  return [..._sources.values()];
}

export function getActiveSourceId() {
  try { return localStorage.getItem(KEY_SOURCE) || 'nbk-rk'; } catch { return 'nbk-rk'; }
}

export function setActiveSourceId(id) {
  try { localStorage.setItem(KEY_SOURCE, id); } catch {}
}

/* ----- Cache в LS ----- */
function loadCache() {
  try { const raw = localStorage.getItem(KEY_CACHE); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(KEY_CACHE, JSON.stringify(c)); } catch {}
}

/**
 * Загрузить курсы на дату от источника. Использует кеш в LS.
 *
 * @param {string} sourceId
 * @param {string} date — YYYY-MM-DD (по умолчанию сегодня)
 * @param {boolean} force — игнорировать кеш и принудительно перезапросить
 * @returns {Promise<{date, base, rates}>}
 */
export async function fetchRates(sourceId = null, date = null, force = false) {
  const id = sourceId || getActiveSourceId();
  const src = _sources.get(id);
  if (!src) throw new Error(`Currency source not registered: ${id}`);
  const d = date || new Date().toISOString().slice(0, 10);

  const cache = loadCache();
  if (!force && cache[id] && cache[id][d]) {
    return { ...cache[id][d], cached: true, sourceId: id, date: d };
  }
  // Запрос источника
  const result = await src.fetch(d);
  if (!cache[id]) cache[id] = {};
  cache[id][d] = { date: d, base: result.base, rates: result.rates, fetchedAt: Date.now() };
  saveCache(cache);
  return { ...cache[id][d], cached: false, sourceId: id };
}

/**
 * Конвертировать сумму из валюты `from` в `to`. Использует rates на дату.
 *
 * @param {number} amount
 * @param {string} from — код валюты (USD, EUR, RUB, KZT, ...)
 * @param {string} to
 * @param {object} rates — { date, base, rates: {CUR: rate to base} }
 * @returns {number|null}
 */
export function convert(amount, from, to, rates) {
  if (!Number.isFinite(amount) || !rates || !rates.rates) return null;
  if (from === to) return amount;
  const r = rates.rates;
  const base = rates.base;
  // Convert from → base → to
  const fromToBase = (from === base) ? 1 : (1 / (r[from] || NaN));
  const baseToTo   = (to === base)   ? 1 : (r[to] || NaN);
  if (!Number.isFinite(fromToBase) || !Number.isFinite(baseToTo)) return null;
  return amount * fromToBase * baseToTo;
}

/**
 * Получить cached даты для источника (для UI history-pickers).
 */
export function getCachedDates(sourceId) {
  const cache = loadCache();
  if (!cache[sourceId]) return [];
  return Object.keys(cache[sourceId]).sort((a, b) => b.localeCompare(a));
}

/**
 * Удалить из cache конкретную дату/источник.
 */
export function clearCache(sourceId = null, date = null) {
  const cache = loadCache();
  if (sourceId == null) { saveCache({}); return; }
  if (!cache[sourceId]) return;
  if (date == null) { delete cache[sourceId]; }
  else { delete cache[sourceId][date]; }
  saveCache(cache);
}
