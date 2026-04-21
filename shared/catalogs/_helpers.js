// ======================================================================
// shared/_catalog-helpers.js
// Внутренние утилиты для каталогов shared/{racks,pdus,rack-accessories}-
// catalog-data.js — без них listBuiltin…() и getLive…() работают, но
// override-слой element-library не подхватывается.
//
// _syncList(kind) возвращает массив Element'ов из element-library через
// глобальный __raschetElementLibrary (сохранён в engine/index.js при
// init'е). До init'а — возвращает [], и вызывающий код падает на
// статику KIT_CATALOG / PDU_CATALOG / ACCESSORY_CATALOG.
//
// _slug(s) — нормализация SKU → id (лат./кир./цифры + ._-).
// ======================================================================

let __listElements = null;
async function _ensureLib() {
  if (__listElements) return __listElements;
  try {
    const m = await import('./element-library.js');
    __listElements = m.listElements;
  } catch { __listElements = () => []; }
  return __listElements;
}

/** Синхронный доступ к library (использует кэш глобальной ссылки). */
export function _syncList(kind) {
  try {
    if (!__listElements && globalThis.__raschetElementLibrary?.listElements) {
      __listElements = globalThis.__raschetElementLibrary.listElements;
    }
    if (__listElements) return __listElements({ kind });
  } catch {}
  return [];
}

export function _slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

// Первая инициализация (асинхронная) — чтобы __listElements кэш был готов
// к моменту первого re-render'а rack-config.
_ensureLib();
