// ======================================================================
// shared/data-adapter.js — DataAdapter contract.
//
// Назначение: разорвать прямую связь конфигураторов с проектным слоем.
//
// СТАРАЯ МОДЕЛЬ (deprecated):
//   rack-config/rack-config.js → импортирует project-storage / project-context
//                                → знает «работаю в проекте такой-то»
//                                → читает/пишет в раскетных-проектных LS-ключах
//
// НОВАЯ МОДЕЛЬ:
//   rack-config/rack-config.js → импортирует ТОЛЬКО data-adapter.js
//                                → вызывает getAdapter('rack-config').list/add/update/remove
//                                → не знает откуда данные
//   shared/project-bootstrap.js → при загрузке страницы в проектном
//                                режиме вызывает setAdapter('rack-config',
//                                createPorAdapter(pid, 'rack'))
//   В standalone-режиме setAdapter не вызывается → используется
//   default-фабрика, зарегистрированная самим конфигуратором (LS-based).
//
// Контракт DataAdapter:
//   {
//     list(filter?):   Promise<Item[]>  | Item[]    // sync пока, async позже
//     get(id):         Item | null
//     add(partial):    Item                          // returns full item with id
//     update(id, patch, opts?): Item | null
//     remove(id):      boolean
//     subscribe(cb):   () => void                    // returns unsubscribe
//   }
// ======================================================================

const _adapters  = new Map();   // moduleId → adapter instance (override / current)
const _factories = new Map();   // moduleId → default factory (для standalone)

/**
 * Конфигуратор регистрирует собственную default-фабрику. Если проектный
 * слой не подменил adapter через setAdapter — getAdapter создаст adapter
 * из этой фабрики (например LS-based).
 */
export function registerDefaultAdapterFactory(moduleId, factory) {
  if (!moduleId || typeof factory !== 'function') return;
  _factories.set(moduleId, factory);
}

/** Подменить adapter (вызывается project-bootstrap'ом). */
export function setAdapter(moduleId, adapter) {
  if (!moduleId || !adapter) return;
  _adapters.set(moduleId, adapter);
  _emitAdapterChange(moduleId, adapter);
}

/** Сбросить adapter (например при выходе из проекта). */
export function clearAdapter(moduleId) {
  _adapters.delete(moduleId);
  _emitAdapterChange(moduleId, null);
}

/** Получить текущий adapter. Лениво создаёт через factory если не подменён. */
export function getAdapter(moduleId) {
  if (_adapters.has(moduleId)) return _adapters.get(moduleId);
  const factory = _factories.get(moduleId);
  if (factory) {
    let adapter;
    try { adapter = factory(); } catch (e) { console.warn('[data-adapter] factory failed:', e); }
    if (adapter) {
      _adapters.set(moduleId, adapter);
      return adapter;
    }
  }
  // Fallback: in-memory adapter, чтобы консументы не падали.
  console.warn('[data-adapter] no adapter / factory for', moduleId, '— using in-memory fallback');
  return createMemoryAdapter();
}

// ─── Listeners на смену adapter (для конфигураторов, чтобы перерисоваться) ──

const _adapterChangeSubs = new Map(); // moduleId → Set<cb>
function _emitAdapterChange(moduleId, adapter) {
  const set = _adapterChangeSubs.get(moduleId);
  if (!set) return;
  for (const cb of set) {
    try { cb(adapter); } catch (e) { console.warn('[data-adapter] sub failed:', e); }
  }
}
export function onAdapterChange(moduleId, callback) {
  if (!_adapterChangeSubs.has(moduleId)) _adapterChangeSubs.set(moduleId, new Set());
  _adapterChangeSubs.get(moduleId).add(callback);
  return () => { const s = _adapterChangeSubs.get(moduleId); if (s) s.delete(callback); };
}

// ──────────────────────────── In-memory adapter ─────────────────────

export function createMemoryAdapter() {
  const items = new Map();
  const subs = new Set();
  function emit(ev) { for (const cb of subs) { try { cb(ev); } catch {} } }
  function _uid() { return 'mem_' + Math.random().toString(36).slice(2, 10); }
  return {
    list(filter) {
      const arr = [...items.values()];
      if (!filter) return arr;
      return arr.filter(x => {
        for (const [k, v] of Object.entries(filter)) if (x[k] !== v) return false;
        return true;
      });
    },
    get(id) { return items.get(id) || null; },
    add(partial) {
      const id = (partial && partial.id) || _uid();
      const item = { ...partial, id };
      items.set(id, item);
      emit({ kind: 'add', id, item });
      return item;
    },
    update(id, patch) {
      const cur = items.get(id); if (!cur) return null;
      const next = { ...cur, ...patch, id };
      items.set(id, next);
      emit({ kind: 'update', id, before: cur, after: next });
      return next;
    },
    remove(id) {
      const cur = items.get(id); if (!cur) return false;
      items.delete(id);
      emit({ kind: 'remove', id, before: cur });
      return true;
    },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}

// ──────────────────────────── LS adapter ────────────────────────────

/**
 * createLSAdapter(lsKey) — простейший LocalStorage-backed adapter.
 * Хранит { [id]: item } в localStorage[lsKey]. Cross-tab sync через
 * 'storage'-event.
 */
export function createLSAdapter(lsKey) {
  if (!lsKey) throw new Error('createLSAdapter: lsKey required');
  const subs = new Set();
  function _uid() { return 'lsa_' + Math.random().toString(36).slice(2, 10); }
  function _load() {
    try { const raw = localStorage.getItem(lsKey); return raw ? JSON.parse(raw) || {} : {}; }
    catch { return {}; }
  }
  function _save(store) {
    try { localStorage.setItem(lsKey, JSON.stringify(store)); }
    catch (e) { console.warn('[ls-adapter] save failed:', e); }
  }
  function emit(ev) { for (const cb of subs) { try { cb(ev); } catch {} } }
  // Cross-tab
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e && e.key === lsKey) emit({ kind: 'sync', source: 'remote' });
    });
  }
  return {
    list(filter) {
      const arr = Object.values(_load());
      if (!filter) return arr;
      return arr.filter(x => {
        for (const [k, v] of Object.entries(filter)) if (x[k] !== v) return false;
        return true;
      });
    },
    get(id) { return _load()[id] || null; },
    add(partial) {
      const store = _load();
      const id = (partial && partial.id) || _uid();
      const item = { ...partial, id };
      store[id] = item; _save(store);
      emit({ kind: 'add', id, item, source: 'local' });
      return item;
    },
    update(id, patch) {
      const store = _load();
      const cur = store[id]; if (!cur) return null;
      const next = { ...cur, ...patch, id };
      store[id] = next; _save(store);
      emit({ kind: 'update', id, before: cur, after: next, source: 'local' });
      return next;
    },
    remove(id) {
      const store = _load();
      const cur = store[id]; if (!cur) return false;
      delete store[id]; _save(store);
      emit({ kind: 'remove', id, before: cur, source: 'local' });
      return true;
    },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}

// ──────────────────────────── Debug ─────────────────────────────────

if (typeof window !== 'undefined') {
  window.RaschetDataAdapter = {
    getAdapter, setAdapter, clearAdapter, registerDefaultAdapterFactory,
    onAdapterChange, createMemoryAdapter, createLSAdapter,
  };
}
