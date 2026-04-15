// ======================================================================
// shared/report-catalog.js
// Per-user хранилище шаблонов отчётов в localStorage. API симметричен
// panel-catalog / battery-catalog — одинаковая схема ключей и формат
// записи, чтобы подпрограммы могли единообразно работать со справочниками.
//
// Ключ хранения: 'raschet.reportCatalog.v1.<uid>'
// uid берётся из localStorage['raschet.currentUserId'] (shared/auth.js
// кэширует его даже в локальном режиме без Firebase). Если uid нет —
// пишем в bucket 'anonymous'.
//
// Схема записи (ReportTemplateRecord):
//   {
//     id:         string,          // makeTemplateId(name) или uuid
//     name:       string,          // человекочитаемое имя, уникальное
//     description:string,          // опциональное описание
//     tags:       string[],        // для фильтрации ('cable','schematic',...)
//     template:   object,          // сам шаблон (см. shared/report/template.js)
//     createdAt:  number,          // unix ms
//     updatedAt:  number,
//     source:     'builtin'|'user', // builtin — идёт в комплекте, нельзя удалить
//   }
// ======================================================================

const LEGACY_KEY = 'raschet.reportCatalog.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

function _read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    // миграция с глобального ключа (если когда-то писали без uid)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        try { localStorage.setItem(storageKey(), JSON.stringify(arr)); } catch {}
        return arr;
      }
    }
    return [];
  } catch { return []; }
}
function _write(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list || [])); }
  catch (e) { console.error('[report-catalog] write failed', e); }
}

/** Все шаблоны, отсортированные по имени. */
export function listTemplates() {
  return _read().slice().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
}

/** Один шаблон по id или null. */
export function getTemplate(id) {
  return _read().find(t => t.id === id) || null;
}

/** Сохранить или обновить запись. Если id не задан — создаётся новый. */
export function saveTemplate(rec) {
  if (!rec) return null;
  const list = _read();
  const now = Date.now();
  let id = rec.id;
  if (!id) id = makeTemplateId(rec.name || 'template');
  // гарантируем уникальность id при создании нового
  if (!rec.id) {
    let suffix = 1;
    const base = id;
    while (list.some(t => t.id === id)) { id = base + '-' + (++suffix); }
  }
  const full = {
    id,
    name:        rec.name || 'Без названия',
    description: rec.description || '',
    tags:        Array.isArray(rec.tags) ? rec.tags.slice() : [],
    template:    rec.template || {},
    createdAt:   rec.createdAt || now,
    updatedAt:   now,
    source:      rec.source || 'user',
  };
  const idx = list.findIndex(t => t.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...full };
  else list.push(full);
  _write(list);
  return full;
}

/** Переименовать или клонировать под другим id. */
export function cloneTemplate(id, newName) {
  const src = getTemplate(id);
  if (!src) return null;
  return saveTemplate({
    name:        newName || (src.name + ' (копия)'),
    description: src.description,
    tags:        src.tags,
    template:    JSON.parse(JSON.stringify(src.template || {})),
    source:      'user',
  });
}

/** Удалить запись. Встроенные (source === 'builtin') не удаляются. */
export function removeTemplate(id) {
  const list = _read();
  const rec = list.find(t => t.id === id);
  if (!rec || rec.source === 'builtin') return false;
  _write(list.filter(t => t.id !== id));
  return true;
}

/** Полная очистка пользовательских (builtin остаются). */
export function clearUserTemplates() {
  _write(_read().filter(t => t.source === 'builtin'));
}

/** Экспорт всего каталога в один JSON-файл (для бэкапа / переноса). */
export function exportCatalogJSON() {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: _read(),
  }, null, 2);
}

/** Импорт из JSON-строки. mode:
 *    'merge'   — добавить новые, существующие по id не трогать
 *    'replace' — перезаписать совпадающие по id
 *    'reset'   — очистить пользовательские и залить заново
 */
export function importCatalogJSON(json, mode = 'merge') {
  let payload;
  try { payload = JSON.parse(json); }
  catch (e) { throw new Error('Некорректный JSON: ' + e.message); }
  const incoming = Array.isArray(payload) ? payload
                  : Array.isArray(payload?.templates) ? payload.templates : null;
  if (!incoming) throw new Error('Не найден массив templates в JSON');
  let list = mode === 'reset' ? _read().filter(t => t.source === 'builtin') : _read();
  let added = 0, updated = 0;
  for (const rec of incoming) {
    if (!rec || !rec.template) continue;
    const idx = list.findIndex(t => t.id === rec.id);
    if (idx < 0) {
      list.push({ ...rec, source: rec.source || 'user' });
      added++;
    } else if (mode !== 'merge') {
      list[idx] = { ...list[idx], ...rec, source: list[idx].source || 'user' };
      updated++;
    }
  }
  _write(list);
  return { added, updated, total: list.length };
}

/** Стабильный id из имени. */
export function makeTemplateId(name) {
  const slug = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'template') + '-' + Math.random().toString(36).slice(2, 8);
}
