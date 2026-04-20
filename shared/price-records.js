// ======================================================================
// shared/price-records.js
// История цен оборудования. Множественные цены на один элемент:
// разные контрагенты, разные типы цен, разные даты.
//
// Схема PriceRecord:
//   {
//     id:             string,      // uid
//     elementId:      string,      // ссылка на Element из element-library
//     price:          number,      // цена за единицу
//     currency:       'RUB'|'USD'|'EUR'|'CNY'|'KZT'|…,
//     priceType:      'purchase' | 'retail' | 'wholesale' |
//                     'list' | 'special' | 'project',
//     counterpartyId: string?,     // ссылка на CounterpartyRecord
//     source:         string,      // 'manual' | 'XLSX:<filename>' |
//                                  // 'URL:<price-list-url>' | 'email' | …
//     recordedAt:     number,      // timestamp записи цены (дата фиксации)
//     validFrom:      number?,     // timestamp начала действия
//     validUntil:     number?,     // timestamp окончания действия
//     quantity:       number?,     // количество (MOQ, оптовая цена «от N шт»)
//     unitOfMeasure:  string?,     // 'шт' | 'м' | 'кг' | 'компл'
//     conditions:     string?,     // 'DDP склад заказчика', 'FCA Москва'
//     discount:       number?,     // % скидка от базовой цены (если применимо)
//     vat:            number?,     // % НДС (0, 10, 20)
//     vatIncluded:    boolean,     // цена уже включает НДС?
//     notes:          string?,     // произвольное примечание
//     createdAt:      number,
//     updatedAt:      number,
//   }
//
// Записи иммутабельны по факту установки цены (recordedAt): изменения
// создают новую запись, а не перезаписывают старую. Но сохраняется
// возможность redact (removePrice) если запись ошибочна.
// ======================================================================

const LEGACY_KEY = 'raschet.priceRecords.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

export const PRICE_TYPES = {
  purchase:  { label: 'Закупочная',   icon: '💰', description: 'Цена закупки у поставщика' },
  retail:    { label: 'Розничная',    icon: '🛒', description: 'Розничная / прейскурантная' },
  wholesale: { label: 'Оптовая',      icon: '📦', description: 'Оптовая (от определённого количества)' },
  list:      { label: 'Прайс-лист',   icon: '📋', description: 'Официальная цена прайс-листа' },
  special:   { label: 'Специальная',  icon: '⭐', description: 'Индивидуальная скидка / спец-цена проекту' },
  project:   { label: 'Проектная',    icon: '📐', description: 'Цена на конкретный проект с объёмом' },
};

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY', 'KZT', 'BYN'];

function _read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    return [];
  } catch { return []; }
}

function _write(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list || [])); }
  catch (e) { console.error('[price-records] write failed', e); }
  _notify();
}

const _listeners = new Set();
export function onPricesChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() {
  for (const cb of _listeners) { try { cb(); } catch (e) { console.error('[price-records] listener', e); } }
}

function _uid() {
  return 'pr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
}

// ——— Public API ———

/**
 * Список цен с фильтрацией.
 * filter = { elementId, counterpartyId, priceType, currency,
 *            recordedAfter, recordedBefore, activeOnly }
 */
export function listPrices(filter = {}) {
  let list = _read();
  if (filter.elementId) list = list.filter(p => p.elementId === filter.elementId);
  if (filter.counterpartyId) list = list.filter(p => p.counterpartyId === filter.counterpartyId);
  if (filter.priceType) list = list.filter(p => p.priceType === filter.priceType);
  if (filter.currency) list = list.filter(p => p.currency === filter.currency);
  if (filter.recordedAfter) list = list.filter(p => p.recordedAt >= filter.recordedAfter);
  if (filter.recordedBefore) list = list.filter(p => p.recordedAt <= filter.recordedBefore);
  if (filter.activeOnly) {
    const now = Date.now();
    list = list.filter(p => {
      if (p.validFrom && now < p.validFrom) return false;
      if (p.validUntil && now > p.validUntil) return false;
      return true;
    });
  }
  // Сортируем по дате записи, свежие первыми
  return list.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));
}

export function getPrice(id) {
  return _read().find(p => p.id === id) || null;
}

/**
 * Все цены на элемент с ОПТИМИЗАЦИЕЙ: последняя / min / max / avg.
 * Возвращает { prices, latest, min, max, avg, count }.
 * Цены приводятся к одной валюте только если все записи в ней.
 */
export function pricesForElement(elementId, filter = {}) {
  const prices = listPrices({ ...filter, elementId });
  if (!prices.length) return { prices: [], latest: null, min: null, max: null, avg: null, count: 0 };
  // Только если все в одной валюте — считаем агрегаты
  const currencies = new Set(prices.map(p => p.currency));
  const sameCurrency = currencies.size === 1;
  const values = prices.map(p => Number(p.price) || 0);
  return {
    prices,
    latest: prices[0] || null, // отсортированы по recordedAt desc
    min: sameCurrency ? Math.min(...values) : null,
    max: sameCurrency ? Math.max(...values) : null,
    avg: sameCurrency ? values.reduce((a, v) => a + v, 0) / values.length : null,
    currency: sameCurrency ? prices[0].currency : null,
    count: prices.length,
  };
}

/**
 * Сохранить цену. id генерится если не задан. recordedAt = now если не задан.
 * Возвращает сохранённую запись.
 */
export function savePrice(rec) {
  if (!rec) throw new Error('[price] record required');
  if (!rec.elementId) throw new Error('[price] elementId required');
  if (rec.price == null || !Number.isFinite(Number(rec.price))) {
    throw new Error('[price] valid price required');
  }
  // Валидация: цену нельзя привязать к non-pricable kind
  // (cable-type — линейка, cable-sku — SKU; цена только на SKU).
  // Импортируем element-library лениво чтобы избежать циклического импорта.
  try {
    // eslint-disable-next-line no-undef
    const lib = globalThis.__raschetElementLibrary;
    if (lib && typeof lib.getElement === 'function' && typeof lib.isPricableKind === 'function') {
      const el = lib.getElement(rec.elementId);
      if (el && !lib.isPricableKind(el.kind)) {
        throw new Error(
          `[price] kind='${el.kind}' не поддерживает прямое назначение цены. ` +
          (el.kind === 'cable-type'
            ? 'Цена кабеля привязывается к конкретному SKU (ВВГнг-LS 3×2.5 мм²), а не к линейке. Создайте cable-sku.'
            : 'Выберите другой элемент.')
        );
      }
    }
  } catch (e) {
    // Если это наша ошибка валидации — пробрасываем. Если что-то другое —
    // тихо пропускаем (обратная совместимость).
    if (e.message && e.message.startsWith('[price]')) throw e;
  }
  const list = _read();
  const now = Date.now();
  if (!rec.id) rec.id = _uid();
  if (!rec.recordedAt) rec.recordedAt = now;
  if (!rec.priceType) rec.priceType = 'purchase';
  if (!rec.currency) rec.currency = 'RUB';
  if (!PRICE_TYPES[rec.priceType]) throw new Error('[price] invalid priceType: ' + rec.priceType);
  const idx = list.findIndex(p => p.id === rec.id);
  const saved = {
    ...rec,
    price: Number(rec.price),
    createdAt: (idx >= 0 ? list[idx].createdAt : now),
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = saved;
  else list.push(saved);
  _write(list);
  return saved;
}

export function removePrice(id) {
  const list = _read();
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  _write(list);
  return true;
}

export function clearAllPrices() { _write([]); }

/**
 * Массовое добавление цен (для импорта из XLSX).
 * records — массив частичных PriceRecord.
 * Возвращает { added, skipped, errors }.
 */
export function bulkAddPrices(records) {
  const list = _read();
  const now = Date.now();
  let added = 0, skipped = 0;
  const errors = [];
  for (const rec of records || []) {
    try {
      if (!rec || !rec.elementId) { skipped++; continue; }
      if (rec.price == null || !Number.isFinite(Number(rec.price))) { skipped++; continue; }
      const full = {
        id: rec.id || _uid(),
        recordedAt: rec.recordedAt || now,
        priceType: rec.priceType || 'purchase',
        currency: rec.currency || 'RUB',
        ...rec,
        price: Number(rec.price),
        createdAt: now,
        updatedAt: now,
      };
      list.push(full);
      added++;
    } catch (e) {
      errors.push({ rec, error: e.message });
    }
  }
  _write(list);
  return { added, skipped, errors };
}

// v0.57.92 (Phase 1.5.5): история импортов + откат.
// Каждая запись цены хранит source-метку (например 'XLSX:file.xlsx' или
// 'manual' / 'JSON-import'). listImportBatches() группирует цены по
// source + дате импорта (createdAt с округлением до минуты, чтобы
// сгруппировать записи одной сессии импорта) и возвращает агрегаты
// для UI «история импортов».
export function listImportBatches() {
  const prices = _read();
  const groups = new Map();
  for (const p of prices) {
    const src = p.source || 'manual';
    // Группируем по source + дате в минутах (разные импорты одного файла
    // в разные дни — разные batch'и).
    const minuteBucket = p.createdAt ? Math.floor(p.createdAt / 60000) * 60000 : 0;
    const key = src + '|' + minuteBucket;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        source: src,
        importedAt: minuteBucket,
        count: 0,
        currencies: new Set(),
        counterpartyIds: new Set(),
        elementIds: new Set(),
      });
    }
    const g = groups.get(key);
    g.count++;
    if (p.currency) g.currencies.add(p.currency);
    if (p.counterpartyId) g.counterpartyIds.add(p.counterpartyId);
    if (p.elementId) g.elementIds.add(p.elementId);
  }
  // Возвращаем отсортированными по дате desc
  return [...groups.values()]
    .map(g => ({
      ...g,
      currencies: [...g.currencies],
      counterpartyIds: [...g.counterpartyIds],
      uniqueElements: g.elementIds.size,
      elementIds: undefined, // не отдаём полный Set наружу
    }))
    .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
}

/**
 * Откат импорта: удаляет все записи с указанным source, импортированные
 * в минутном окне [bucket, bucket+60000). Если minuteBucket не задан —
 * удаляет ВСЕ записи с данным source. Возвращает число удалённых.
 */
export function rollbackImportBatch(source, minuteBucket) {
  if (!source) return 0;
  const list = _read();
  const before = list.length;
  const kept = list.filter(p => {
    if (p.source !== source) return true;
    if (minuteBucket != null) {
      const b = p.createdAt ? Math.floor(p.createdAt / 60000) * 60000 : 0;
      if (b !== minuteBucket) return true;
    }
    return false; // source совпадает (и bucket если задан) — удаляем
  });
  const removed = before - kept.length;
  if (removed > 0) _write(kept);
  return removed;
}

/**
 * Экспорт всех цен в JSON (для backup).
 */
export function exportPricesJSON() {
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    prices: _read(),
  }, null, 2);
}

/**
 * Импорт цен из JSON. mode = 'merge' | 'replace'.
 */
export function importPricesJSON(json, mode = 'merge') {
  let parsed;
  try { parsed = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (e) { throw new Error('Bad JSON: ' + e.message); }
  if (!parsed || !Array.isArray(parsed.prices)) throw new Error('Bad format');

  let list = mode === 'replace' ? [] : _read();
  let added = 0, updated = 0;
  for (const rec of parsed.prices) {
    if (!rec || !rec.elementId || rec.price == null) continue;
    const idx = list.findIndex(p => p.id === rec.id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...rec }; updated++; }
    else { list.push(rec); added++; }
  }
  _write(list);
  return { added, updated, total: list.length };
}
