/* =========================================================================
   shared/backup.js — резервное копирование и восстановление данных Raschet.

   Работа с LocalStorage целиком (все ключи, не только raschet.*) — чтобы
   охватить scs-config / rack-config / другие модули с собственными
   неймспейсами.

   API:
     exportAllToJson()           — собирает все ключи LS в JSON-объект
     downloadBackup()            — выгружает .json файл через <a download>
     restoreFromJson(json, opts) — восстанавливает LS из объекта (с подтверждением)
     readBackupFile(file)        — Promise<object> парсит File-объект
     listLocalKeys()             — отладочная функция, возвращает все ключи
     setupAutoBackup(intervalMs) — Phase 2: периодический локальный бэкап
                                    с использованием File System Access API
     getAutoBackupSettings()     — читает настройки auto-backup из LS

   Формат бэкапа:
     {
       schema: 'raschet.backup/1',
       exportedAt: ISO-string,
       appVersion: 'x.y.z',
       userId: 'currentUserId or anonymous',
       keyCount: N,
       data: { [key]: stringValue }
     }
   ========================================================================= */

const BACKUP_SCHEMA = 'raschet.backup/1';
const AUTO_BACKUP_KEY = 'raschet.autoBackup.settings.v1';
const LAST_BACKUP_KEY = 'raschet.lastBackupAt.v1';

/** Собрать все LocalStorage в JSON-структуру. */
export function exportAllToJson({ appVersion = '' } = {}) {
  const data = {};
  let count = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      data[k] = localStorage.getItem(k);
      count++;
    }
  } catch (e) {
    console.warn('[backup] exportAllToJson scan failed:', e);
  }
  let userId = 'anonymous';
  try { userId = localStorage.getItem('raschet.currentUserId') || 'anonymous'; } catch {}
  return {
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion,
    userId,
    keyCount: count,
    data,
  };
}

/** Скачать бэкап как .json файл (через временный <a download>). */
export function downloadBackup({ appVersion = '', filename = '' } = {}) {
  const payload = exportAllToJson({ appVersion });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const name = filename || `raschet-backup-${stamp}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  try { localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({ at: Date.now(), keys: payload.keyCount })); } catch {}
  return payload;
}

/**
 * Восстановить LS из payload-объекта.
 * @param {object} payload объект из бэкап-файла
 * @param {object} opts
 *   strategy: 'merge' (default) — merge с существующими, 'replace' — стереть
 *             всё и записать только из бэкапа.
 */
export function restoreFromJson(payload, { strategy = 'merge' } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Backup payload не является объектом');
  }
  if (payload.schema && payload.schema !== BACKUP_SCHEMA) {
    console.warn('[backup] схема не совпадает:', payload.schema, 'ожидалась', BACKUP_SCHEMA);
  }
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Поле data отсутствует или не объект');
  }
  let written = 0, skipped = 0, errors = 0;
  if (strategy === 'replace') {
    try { localStorage.clear(); } catch (e) { console.warn('[backup] localStorage.clear failed:', e); }
  }
  for (const [k, v] of Object.entries(data)) {
    try {
      if (typeof v !== 'string') { skipped++; continue; }
      localStorage.setItem(k, v);
      written++;
    } catch (e) {
      errors++;
      console.warn('[backup] setItem failed for', k, e);
    }
  }
  // v0.60.777: restore пишет в LS сырым setItem мимо C3 write-hook —
  // в server-режиме (залогинен) дозаливаем восстановленное в Postgres,
  // иначе данные git-копии не попадут в серверную БД. Fail-soft, async.
  try {
    const S = (typeof window !== 'undefined') && window.GEToolsServer;
    if (S && S.mode === 'server' && S.isAuthed && S.isAuthed() && S.pushAll) {
      S.pushAll().catch(() => {});
    }
  } catch {}
  return { written, skipped, errors, total: Object.keys(data).length, strategy };
}

/** Прочитать File-объект (из <input type=file>) и распарсить как JSON. */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Файл не выбран')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result || '{}'))); }
      catch (e) { reject(new Error('Невалидный JSON: ' + (e.message || e))); }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsText(file, 'utf-8');
  });
}

/** Список всех ключей LS — отладочная функция. */
export function listLocalKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

/* ===== Auto-backup (Phase 2: File System Access API) ===========================
 * Если браузер поддерживает window.showDirectoryPicker (Chrome 86+, Edge 86+,
 * Opera 72+), мы можем один раз спросить пользователя «куда сохранять бэкапы»,
 * получить FileSystemDirectoryHandle и сохранить permission. Дальше при
 * каждом auto-backup пишем файл напрямую в эту папку без диалога.
 *
 * Permission хранится в IndexedDB (не в LS — handle нельзя сериализовать).
 * Settings (включён ли auto-backup, интервал) — в LS.
 * ========================================================================== */

const IDB_DB = 'raschet-backup';
const IDB_STORE = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Спросить у пользователя папку для авто-бэкапов. Запоминается в IndexedDB. */
export async function pickBackupFolder() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('Браузер не поддерживает File System Access API. Используйте «💾 Бэкап» вручную.');
  }
  // mode:'readwrite' нужен чтобы писать файлы.
  // startIn:'home' — по умолчанию открывать пикер в домашней папке
  // пользователя (явный запрос). Браузер НЕ даёт тихий доступ к ФС —
  // папку всё равно выбирает пользователь явно; startIn лишь задаёт
  // стартовую директорию диалога.
  const handle = await window.showDirectoryPicker({
    mode: 'readwrite',
    id: 'raschet-backup',
    startIn: 'home',
  });
  await idbSet('folder', handle);
  return handle;
}

async function getStoredFolderHandle() {
  try { return await idbGet('folder'); } catch { return null; }
}

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

/** Записать бэкап-файл в выбранную папку (если есть handle и permission). */
export async function writeBackupToFolder({ appVersion = '' } = {}) {
  const handle = await getStoredFolderHandle();
  if (!handle) throw new Error('Папка не выбрана. Откройте Настройки → Авто-бэкап.');
  const ok = await ensurePermission(handle, 'readwrite');
  if (!ok) throw new Error('Нет разрешения на запись в выбранную папку.');
  const payload = exportAllToJson({ appVersion });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const fileName = `raschet-backup-${stamp}.json`;
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
  try { localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({ at: Date.now(), keys: payload.keyCount, fileName })); } catch {}
  return { fileName, keyCount: payload.keyCount };
}

/** Настройки auto-backup. */
export function getAutoBackupSettings() {
  const def = { enabled: false, intervalMin: 60, onClose: true };
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return def;
    return { ...def, ...JSON.parse(raw) };
  } catch { return def; }
}

export function setAutoBackupSettings(patch) {
  const cur = getAutoBackupSettings();
  const next = { ...cur, ...patch };
  try { localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function getLastBackupInfo() {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

let _autoBackupTimer = null;

/** Запустить таймер периодического авто-бэкапа (если включён в настройках). */
export function startAutoBackupTimer({ appVersion = '' } = {}) {
  stopAutoBackupTimer();
  const s = getAutoBackupSettings();
  if (!s.enabled) return;
  const intervalMs = Math.max(5, Number(s.intervalMin) || 60) * 60 * 1000;
  _autoBackupTimer = setInterval(() => {
    writeBackupToFolder({ appVersion }).catch(e => {
      console.warn('[auto-backup] write failed:', e.message || e);
    });
  }, intervalMs);
}

export function stopAutoBackupTimer() {
  if (_autoBackupTimer) {
    clearInterval(_autoBackupTimer);
    _autoBackupTimer = null;
  }
}

/** Привязать обработчик beforeunload — срабатывает при закрытии вкладки. */
export function attachOnCloseBackup({ appVersion = '' } = {}) {
  window.addEventListener('beforeunload', () => {
    const s = getAutoBackupSettings();
    if (!s.enabled || !s.onClose) return;
    // beforeunload + async = скорее всего НЕ успеет завершиться, но попытаемся.
    // Браузер блокирует async операции в этом событии. Реальная защита —
    // intervalMin таймер во время сессии.
    writeBackupToFolder({ appVersion }).catch(() => {});
  });
}
