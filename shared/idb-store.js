// =============================================================================
// shared/idb-store.js — минимальный IndexedDB key-value store
// =============================================================================
// Phase 34 (по диагностике 2026-05-03 через Chrome MCP): LocalStorage квота
// в Chrome ≈ 4-5 МБ → ASHRAE Темиртау 10 лет (87696 точек ≈ 6 МБ JSON) НЕ
// помещается. IndexedDB квота ~50 МБ — 2 ГБ → решение.
//
// API совместим с loadJson/saveJson (но async):
//   await idbGet(key, fallback?)
//   await idbSet(key, value)
//   await idbDelete(key)
//   await idbKeys(prefix?)
//
// Внутри — single-store «kv» в DB «raschet-storage». Без зависимостей.

const DB_NAME = 'raschet-storage';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/** Прочитать значение по ключу. */
export async function idbGet(key, fallback = null) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[idb-store] get error:', e);
    return fallback;
  }
}

/** Сохранить значение по ключу. */
export async function idbSet(key, value) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[idb-store] set error:', e);
    return false;
  }
}

/** Удалить значение по ключу. */
export async function idbDelete(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[idb-store] delete error:', e);
    return false;
  }
}

/** Список ключей с опциональным префиксом. */
export async function idbKeys(prefix = '') {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        const keys = req.result || [];
        resolve(prefix ? keys.filter(k => String(k).startsWith(prefix)) : keys);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[idb-store] keys error:', e);
    return [];
  }
}

/** Available? (false для очень старых браузеров без IDB). */
export function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}
