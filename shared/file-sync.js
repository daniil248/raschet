// =============================================================================
// shared/file-sync.js — file-based project storage (drawio-style)
// =============================================================================
// v0.60.258 (по запросу Пользователя 2026-05-06 «предлагаю пользовательские
// данные хранить не в браузере а в локальных файлах пользователя, как drawio
// например хранит библиотеки пользователя просто в файле. Такой файл можно
// выложить на сетевом ресурсе и использовать совместно, по крайней мере на
// чтение и один на запись»):
//
// Модуль обеспечивает работу с проектами как с локальными файлами через
// File System Access API (Chromium-браузеры) с graceful fallback на
// download/upload через <input type=file> для Firefox/Safari.
//
// Возможности:
//   • showSaveFilePicker → пользователь выбирает .raschet.json файл (или
//     создаёт новый) → handle сохраняется → последующие save-ы пишутся
//     в тот же файл (in-place) без диалога.
//   • showOpenFilePicker → выбор файла + handle → авто-save при изменениях.
//   • Read-only mode → файл открыт без права записи (для совместного просмотра).
//   • Network shares: handle указывает на mapped-drive (Z:\), пишется
//     прозрачно. Conflict detection через mtime polling (опционально).
//   • Fallback (Firefox/Safari): download .json при «Сохранить», upload через
//     <input type=file> при «Открыть». Без in-place save — каждый раз диалог.
//
// File format: pure JSON со scheme + project meta:
//   {
//     "_format": "raschet-project",
//     "_version": "1",
//     "_savedAt": "2026-05-06T12:34:56.789Z",
//     "name": "Project name",
//     "scheme": { ...nodes/conns/zones/... },
//     "meta": { customer, address, ... }
//   }
// =============================================================================

const FILE_PICKER_OPTS = {
  types: [{
    description: 'Raschet Project',
    accept: { 'application/json': ['.raschet.json', '.json'] },
  }],
  excludeAcceptAllOption: false,
};

export const FILE_FORMAT = 'raschet-project';
export const FILE_FORMAT_VERSION = '1';

/**
 * Проверка поддержки File System Access API.
 * @returns {boolean} true если showSaveFilePicker / showOpenFilePicker доступны.
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined'
      && typeof window.showSaveFilePicker === 'function'
      && typeof window.showOpenFilePicker === 'function';
}

/**
 * Сборка payload-а для записи в файл из текущей схемы и meta.
 * @param {object} scheme — window.Raschet.getScheme() результат.
 * @param {object} [meta] — { name, customer, address, ... }
 */
export function buildFilePayload(scheme, meta = {}) {
  return {
    _format: FILE_FORMAT,
    _version: FILE_FORMAT_VERSION,
    _savedAt: new Date().toISOString(),
    name: meta.name || 'Без названия',
    customer: meta.customer || '',
    address: meta.address || '',
    code: meta.code || '',
    info: meta.info || '',
    scheme,
  };
}

/**
 * Парсинг файла Raschet — поддерживаются 2 формата:
 *   1. Новый: { _format: 'raschet-project', scheme: {...}, name, ... }
 *   2. Legacy (export JSON): сама scheme как корневой объект ({nodes, conns, ...})
 */
export function parseFilePayload(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { throw new Error('Файл не является валидным JSON: ' + e.message); }
  if (!obj || typeof obj !== 'object') throw new Error('Пустой или некорректный JSON');
  if (obj._format === FILE_FORMAT) {
    if (!obj.scheme || typeof obj.scheme !== 'object') {
      throw new Error('В файле нет поля scheme');
    }
    return {
      scheme: obj.scheme,
      meta: {
        name: obj.name || '',
        customer: obj.customer || '',
        address: obj.address || '',
        code: obj.code || '',
        info: obj.info || '',
      },
      savedAt: obj._savedAt ? new Date(obj._savedAt) : null,
    };
  }
  // Legacy: scheme в корне
  if (Array.isArray(obj.nodes) && Array.isArray(obj.conns)) {
    return { scheme: obj, meta: {}, savedAt: null };
  }
  throw new Error('Файл не похож на проект Raschet (нет _format или nodes/conns)');
}

/**
 * Открыть проект из файла. Возвращает handle (если поддерживается) или null.
 * Бросает DOMException 'AbortError' если Пользователь отменил диалог.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.readOnly=false] — открыть без права записи.
 * @returns {Promise<{handle: FileSystemFileHandle|null, file: File, payload: object, readOnly: boolean}>}
 */
export async function openProjectFile(opts = {}) {
  const readOnly = !!opts.readOnly;
  if (isFileSystemAccessSupported()) {
    const [handle] = await window.showOpenFilePicker({
      ...FILE_PICKER_OPTS,
      multiple: false,
    });
    // Запрашиваем readwrite только если не readOnly.
    if (!readOnly) {
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          await handle.requestPermission({ mode: 'readwrite' });
        }
      } catch (e) {
        console.warn('[file-sync] readwrite permission failed, fallback to readonly:', e.message);
      }
    }
    const file = await handle.getFile();
    const text = await file.text();
    const payload = parseFilePayload(text);
    payload.fileName = file.name;
    return { handle, file, payload, readOnly };
  }
  // Fallback: <input type=file>
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.raschet.json,application/json';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return reject(new DOMException('User cancelled', 'AbortError'));
      try {
        const text = await file.text();
        const payload = parseFilePayload(text);
        payload.fileName = file.name;
        resolve({ handle: null, file, payload, readOnly: true /* без handle = только-чтение, save-as → download */ });
      } catch (e) { reject(e); }
    };
    input.oncancel = () => { input.remove(); reject(new DOMException('User cancelled', 'AbortError')); };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Сохранить проект «как файл» — запросить у Пользователя имя/локацию через
 * showSaveFilePicker (или fallback на download). Возвращает handle (или null).
 *
 * @param {object} payload — результат buildFilePayload()
 * @param {object} [opts]
 * @param {string} [opts.suggestedName] — предлагаемое имя файла.
 */
export async function saveProjectAsFile(payload, opts = {}) {
  const suggestedName = opts.suggestedName || `${(payload.name || 'project').replace(/[^\w\sа-яёА-ЯЁ.-]+/gi, '_')}.raschet.json`;
  const json = JSON.stringify(payload, null, 2);
  if (isFileSystemAccessSupported()) {
    const handle = await window.showSaveFilePicker({
      ...FILE_PICKER_OPTS,
      suggestedName,
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return { handle, fileName: suggestedName };
  }
  // Fallback: download via blob URL.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { handle: null, fileName: suggestedName };
}

/**
 * Перезаписать файл по сохранённому handle (in-place save). Используется
 * на каждый saveCurrent() в file-mode без диалога. Возвращает время записи.
 *
 * @param {FileSystemFileHandle} handle
 * @param {object} payload — buildFilePayload()
 * @returns {Promise<{savedAt: Date, bytes: number}>}
 */
export async function writeProjectToHandle(handle, payload) {
  if (!handle) throw new Error('No file handle — нечего перезаписывать');
  // Проверяем разрешение на запись (могло быть отозвано браузером).
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') throw new Error('Нет прав на запись в файл (отозвано браузером)');
    }
  } catch (e) {
    // Не все имплементации (некоторые версии Chrome) поддерживают query/request.
    // Просто пробуем createWritable — если упадёт, поднимется наверх.
  }
  const json = JSON.stringify(payload, null, 2);
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
  return { savedAt: new Date(), bytes: new Blob([json]).size };
}

/**
 * Проверить modtime файла (для conflict detection при многопользовательской
 * работе через сетевой ресурс). Возвращает Date или null если handle нет.
 */
export async function getFileLastModified(handle) {
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    return new Date(file.lastModified);
  } catch (e) {
    return null;
  }
}

/**
 * Перечитать содержимое файла по handle (read-only refresh).
 * Используется для «↻ Перечитать» когда файл изменён извне.
 */
export async function reloadFromHandle(handle) {
  if (!handle) throw new Error('No file handle');
  const file = await handle.getFile();
  const text = await file.text();
  const payload = parseFilePayload(text);
  payload.fileName = file.name;
  return { file, payload };
}

// =============================================================================
// v0.60.260: персистентный handle через IndexedDB.
// =============================================================================
// File System Access API позволяет сохранять FileSystemFileHandle в IndexedDB
// (structured clone), чтобы при следующей загрузке страницы handle оставался
// «живым» — Пользователю не нужно заново выбирать файл. Permission, однако,
// придётся подтвердить заново: браузеры не сохраняют readwrite-grant между
// сессиями. Это запрос «requestPermission({ mode: 'readwrite' })».

const IDB_NAME = 'raschet-file-sync';
const IDB_VERSION = 1;
const IDB_STORE = 'recent-handle';
const IDB_KEY_LAST = 'last';

/** Открыть IndexedDB с store для handle. */
function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
  });
}

/**
 * Сохранить последний открытый handle для повторного использования.
 * @param {FileSystemFileHandle|null} handle
 * @param {object} [meta] — { fileName, readOnly }
 */
export async function rememberHandle(handle, meta = {}) {
  if (!handle) return;
  try {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const st = tx.objectStore(IDB_STORE);
      st.put({
        handle,
        fileName: meta.fileName || '',
        readOnly: !!meta.readOnly,
        savedAt: Date.now(),
      }, IDB_KEY_LAST);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn('[file-sync] rememberHandle failed:', e.message);
  }
}

/**
 * Загрузить последний сохранённый handle. Возвращает null если нет.
 * Permission НЕ запрашивается тут — это решает caller через requestPermission.
 */
export async function loadRememberedHandle() {
  try {
    if (!isFileSystemAccessSupported()) return null;
    const db = await _openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const st = tx.objectStore(IDB_STORE);
      const req = st.get(IDB_KEY_LAST);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  } catch (e) {
    console.warn('[file-sync] loadRememberedHandle failed:', e.message);
    return null;
  }
}

/** Очистить сохранённый handle (например при закрытии файла). */
export async function forgetHandle() {
  try {
    const db = await _openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY_LAST);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {}
}

/**
 * Проверить и при необходимости запросить разрешение на чтение/запись
 * для сохранённого handle.
 * @param {FileSystemFileHandle} handle
 * @param {string} mode — 'read' или 'readwrite'
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return 'denied';
  try {
    const cur = await handle.queryPermission({ mode });
    if (cur === 'granted') return 'granted';
    const req = await handle.requestPermission({ mode });
    return req;
  } catch (e) {
    return 'denied';
  }
}
