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

// ──────────────────────────── Export / Import ──────────────────────
//
// Конфигуратор должен уметь сохранить/загрузить свои данные в JSON-файл
// независимо от того, где они хранятся (LS / POR / cloud). Это generic
// helper'ы, работают с любым DataAdapter.
//
// Формат export-файла:
//   {
//     schemaVersion: 1,
//     module:        '<moduleId>',
//     exportedAt:    <ms>,
//     items:         [ ... raw items из adapter.list() ... ],
//   }

const EXPORT_SCHEMA_VERSION = 1;

/**
 * Экспортировать содержимое adapter'а в JSON-объект.
 * filter — опциональный фильтр (передаётся в adapter.list).
 */
export function exportAdapter(adapter, moduleId, filter) {
  if (!adapter || typeof adapter.list !== 'function') {
    return { schemaVersion: EXPORT_SCHEMA_VERSION, module: moduleId || '', exportedAt: Date.now(), items: [] };
  }
  let items = [];
  try { items = adapter.list(filter) || []; } catch (e) { console.warn('[data-adapter] export.list failed:', e); }
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    module:        moduleId || '',
    exportedAt:    Date.now(),
    items:         JSON.parse(JSON.stringify(items)),
  };
}

/**
 * Скачать export как JSON-файл. fileName — без расширения.
 * Только в браузере (использует Blob + <a download>).
 */
export function downloadExport(exportObj, fileName) {
  if (typeof document === 'undefined') return;
  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (fileName || 'export') + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

/**
 * Импортировать items из JSON-объекта в adapter.
 * mode:
 *   'merge'   — добавить (если id совпадает — update, иначе add); существующие записи не трогаются.
 *   'replace' — удалить все текущие, затем добавить новые.
 *   'append'  — просто add() для каждого item с новым id (игнорируя его id).
 *
 * Возвращает { added, updated, removed, errors[] }.
 */
export function importIntoAdapter(adapter, exportObj, mode) {
  const result = { added: 0, updated: 0, removed: 0, errors: [] };
  if (!adapter || !exportObj) return result;
  const items = Array.isArray(exportObj.items) ? exportObj.items : [];
  const m = mode || 'merge';

  if (m === 'replace') {
    try {
      const cur = adapter.list() || [];
      for (const it of cur) {
        if (it && it.id) { adapter.remove(it.id); result.removed++; }
      }
    } catch (e) { result.errors.push('replace clear failed: ' + e.message); }
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    try {
      if (m === 'append') {
        const copy = { ...item };
        delete copy.id;
        adapter.add(copy);
        result.added++;
      } else {
        // merge / replace: пытаемся upsert по id.
        const id = item.id;
        if (id) {
          const exists = adapter.get ? adapter.get(id) : null;
          if (exists) {
            adapter.update(id, item);
            result.updated++;
          } else {
            adapter.add(item);
            result.added++;
          }
        } else {
          adapter.add(item);
          result.added++;
        }
      }
    } catch (e) {
      result.errors.push(`item ${item.id || '(no id)'}: ${e.message}`);
    }
  }
  return result;
}

/**
 * Прочитать JSON-файл из <input type="file">. Возвращает Promise<exportObj>.
 */
export function readExportFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Файл не выбран'));
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ''));
        resolve(obj);
      } catch (e) { reject(new Error('Некорректный JSON: ' + e.message)); }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsText(file);
  });
}

if (typeof window !== 'undefined') {
  window.RaschetDataAdapter = {
    getAdapter, setAdapter, clearAdapter, registerDefaultAdapterFactory,
    onAdapterChange, createMemoryAdapter, createLSAdapter,
    exportAdapter, downloadExport, importIntoAdapter, readExportFile,
  };
}
