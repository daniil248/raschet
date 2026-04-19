// ======================================================================
// shared/element-library.js
// Единая библиотека элементов платформы Raschet.
//
// Фаза 1 архитектурного roadmap: вместо 4 раздельных каталогов (panel,
// ups, battery, transformer) + cable-types + presets — один справочник
// со всеми типами оборудования и общим API. Существующие каталоги в
// подфазе 1.2 станут adapter'ами поверх этой библиотеки, сохранив
// обратную совместимость.
//
// Ключ localStorage: 'raschet.elementLibrary.v1.<uid>'
//
// Схема Element:
//   {
//     id:          string,                   // стабильный (kind + slug)
//     kind:        string,                   // 'panel'|'ups'|'battery'|'transformer'|
//                                            // 'cable-type'|'consumer-type'|'enclosure'|
//                                            // 'breaker'|'climate'|'channel'|'custom'
//     category:    'equipment'|'fitting'|'channel'|'zone'|'reference',
//     label:       string,                   // человекочитаемое имя
//     description: string,
//     manufacturer:string,
//     series:      string,
//     variant:     string,
//     // Электрические параметры (опционально, зависит от kind)
//     electrical: {
//       voltageCategory: 'lv'|'mv'|'hv'|'dc',
//       voltageLevelId:  string,             // опциональная ссылка на voltageLevels
//       capacityKw:      number,             // для ИБП/трансформатора
//       capacityA:       number,             // для щита/автомата
//       phases:          1|2|3,
//       cosPhi:          number,
//       efficiency:      number,             // 0..1
//       ports: [{id, kind, direction, voltageCategory}]   // электрические коннекторы
//     },
//     // Геометрические параметры (опционально)
//     geometry: {
//       widthMm:       number,
//       heightMm:      number,
//       depthMm:       number,
//       weightKg:      number,
//       heatDissipationW: number,            // для теплового расчёта (Фаза 6)
//       serviceZone:   {front, back, left, right, top, bottom}, // мм зазоры
//       mountPoints:   [{x, y, z, kind}]     // физические точки крепления
//     },
//     // Представления для разных пространств (Фаза 2)
//     views: {
//       schematic:   { symbolId, svg },      // IEC 60617 символ
//       layout:      { svgFront, svgTop, svgSide },  // фасады для layout-страниц
//       3d:          { modelUrl, boxGeometry }        // 3D (Фаза 4)
//     },
//     // Состав (для модульных/фантомных элементов)
//     composition: [
//       { elementId: string, qty: number, phantom: boolean, role: string }
//     ],
//     // Дополнительные параметры зависят от kind — в kindProps
//     kindProps: {},                         // зависит от kind
//     // Meta
//     source:      'builtin'|'user'|'imported'|'adapter',
//     builtin:     boolean,
//     tags:        string[],
//     createdAt:   number,
//     updatedAt:   number,
//   }
//
// Элементы с `builtin: true` поставляются с приложением (из adapter'ов
// или базовых каталогов) и не удаляются пользователем.
//
// API симметричен остальным каталогам:
//   listElements({kind, category, tag})
//   getElement(id)
//   saveElement(element)
//   removeElement(id)
//   cloneElement(id, newName)
//   exportLibraryJSON()
//   importLibraryJSON(json, mode)
//
// Для интеграции с существующими модулями см. Фазу 1.2: panel-catalog,
// ups-catalog и т.п. переходят на адаптеры через listElements({kind:'panel'}).
// ======================================================================

const LEGACY_KEY = 'raschet.elementLibrary.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

// ——— Валидные значения kind ———
// ВАЖНО про кабели: `cable-type` — это ЛИНЕЙКА (ВВГнг-LS, АВБбШв, UTP…),
// к нему НЕЛЬЗЯ привязывать цену (нельзя сказать «ВВГ стоит 5 рублей»).
// Конкретный ценник — это `cable-sku`: `{ cableTypeId, cores, sizeMm2 }`
// (например «ВВГнг-LS 3×2.5 мм² — 95 ₽/м»). Цены ТОЛЬКО на SKU.
export const ELEMENT_KINDS = {
  panel:         { category: 'equipment', label: 'Распределительный щит', pricable: true },
  ups:           { category: 'equipment', label: 'Источник бесперебойного питания', pricable: true },
  battery:       { category: 'equipment', label: 'Аккумуляторная батарея', pricable: true },
  transformer:   { category: 'equipment', label: 'Трансформатор', pricable: true },
  breaker:       { category: 'equipment', label: 'Автоматический выключатель', pricable: true },
  enclosure:     { category: 'equipment', label: 'Корпус (оболочка) щита', pricable: true },
  climate:       { category: 'equipment', label: 'Климатическое оборудование', pricable: true },
  'consumer-type': { category: 'reference', label: 'Тип потребителя', pricable: false },
  'cable-type':  { category: 'reference', label: 'Тип кабеля (линейка)', pricable: false,
                   note: 'Цены привязываются к cable-sku (конкретный размер и число жил)' },
  'cable-sku':   { category: 'equipment', label: 'Кабель: SKU (типоразмер)', pricable: true,
                   note: 'Конкретный типоразмер: ВВГнг-LS 3×2.5 мм², UTP Cat.5e 4×2×0.5 и т.д.' },
  channel:       { category: 'channel', label: 'Кабельный канал / трасса', pricable: true },
  custom:        { category: 'equipment', label: 'Произвольный элемент', pricable: true },
};

/** Возвращает true если к элементу данного kind можно привязать цену. */
export function isPricableKind(kind) {
  return !!(ELEMENT_KINDS[kind]?.pricable);
}

// Публикуем в globalThis для lazy-lookup из price-records (без цикл. import)
if (typeof globalThis !== 'undefined') {
  globalThis.__raschetElementLibrary = {
    get getElement() { return getElement; },
    get isPricableKind() { return isPricableKind; },
  };
}

// ——— Базовое чтение/запись ———

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
  catch (e) { console.error('[element-library] write failed', e); }
}

// ——— Регистрация встроенных элементов (из адаптеров) ———
// Адаптер-каталоги (panel-catalog, ups-catalog, etc) регистрируют свои
// builtin-элементы через registerBuiltin(). Это позволяет listElements
// возвращать builtin + user в одном списке.

const _builtins = new Map(); // id → Element

export function registerBuiltin(element) {
  if (!element || !element.id) return;
  _builtins.set(element.id, { ...element, builtin: true, source: 'builtin' });
}

export function registerBuiltins(elements) {
  for (const el of elements) registerBuiltin(el);
}

export function clearBuiltins() { _builtins.clear(); }

// ——— Публичный API ———

/**
 * Список элементов библиотеки с опциональной фильтрацией.
 * filter = { kind?, category?, tag?, manufacturer? }
 * Возвращает builtin + user в одном массиве, builtin первыми.
 */
export function listElements(filter = {}) {
  const userList = _read();
  // Builtin элементы не пересекаются с user по id (user id не должен совпадать с builtin)
  const userFiltered = userList.filter(u => !_builtins.has(u.id));
  let all = [..._builtins.values(), ...userFiltered];

  if (filter.kind) all = all.filter(e => e.kind === filter.kind);
  if (filter.category) all = all.filter(e => e.category === filter.category);
  if (filter.tag) all = all.filter(e => Array.isArray(e.tags) && e.tags.includes(filter.tag));
  if (filter.manufacturer) all = all.filter(e => e.manufacturer === filter.manufacturer);

  return all;
}

/** Найти элемент по id. */
export function getElement(id) {
  if (_builtins.has(id)) return _builtins.get(id);
  return _read().find(e => e.id === id) || null;
}

/**
 * Сохранить или обновить пользовательский элемент.
 * Нельзя перезаписать builtin — создаётся клон с новым id.
 */
export function saveElement(element) {
  if (!element) throw new Error('[element-library] element required');
  if (!element.id) throw new Error('[element-library] element.id required');
  if (!element.kind || !ELEMENT_KINDS[element.kind]) {
    throw new Error('[element-library] invalid kind: ' + element.kind);
  }
  if (_builtins.has(element.id)) {
    throw new Error('[element-library] cannot override builtin: ' + element.id);
  }
  const list = _read();
  const now = Date.now();
  const idx = list.findIndex(e => e.id === element.id);
  const saved = {
    ...element,
    category: element.category || ELEMENT_KINDS[element.kind].category,
    builtin: false,
    source: element.source || 'user',
    createdAt: (idx >= 0 ? list[idx].createdAt : now),
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = saved;
  else list.push(saved);
  _write(list);
  _notify();
  return saved;
}

/** Удалить пользовательский элемент (builtin не удаляются). */
export function removeElement(id) {
  if (_builtins.has(id)) return false;
  const list = _read();
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  _write(list);
  _notify();
  return true;
}

/**
 * Клонировать элемент (builtin или пользовательский) с новым id/именем.
 * Клон создаётся как user-элемент.
 */
export function cloneElement(sourceId, newName) {
  const src = getElement(sourceId);
  if (!src) throw new Error('[element-library] not found: ' + sourceId);
  const newId = (src.id + '-copy-' + Date.now()).toLowerCase();
  const clone = {
    ...JSON.parse(JSON.stringify(src)),
    id: newId,
    label: newName || (src.label + ' (копия)'),
    builtin: false,
    source: 'user',
  };
  delete clone.createdAt;
  delete clone.updatedAt;
  return saveElement(clone);
}

/** Экспорт всей библиотеки (builtin + user) в JSON. */
export function exportLibraryJSON() {
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    elements: [..._builtins.values(), ..._read()],
  }, null, 2);
}

/**
 * Импорт библиотеки из JSON. mode = 'merge' | 'replace'
 * Builtin элементы не затрагиваются.
 */
export function importLibraryJSON(json, mode = 'merge') {
  let parsed;
  try { parsed = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (e) { throw new Error('Bad JSON: ' + e.message); }
  if (!parsed || !Array.isArray(parsed.elements)) throw new Error('Bad format');

  let list = mode === 'replace' ? [] : _read();
  let added = 0, updated = 0;

  for (const rec of parsed.elements) {
    if (!rec.id || _builtins.has(rec.id)) continue; // skip builtins
    const idx = list.findIndex(e => e.id === rec.id);
    const saved = {
      ...rec,
      builtin: false,
      source: rec.source === 'builtin' ? 'imported' : (rec.source || 'imported'),
      updatedAt: Date.now(),
      createdAt: (idx >= 0 ? list[idx].createdAt : rec.createdAt || Date.now()),
    };
    if (idx >= 0) { list[idx] = saved; updated++; }
    else { list.push(saved); added++; }
  }
  _write(list);
  _notify();
  return { added, updated, total: list.length };
}

/** Очистить пользовательскую часть библиотеки (builtin остаются). */
export function clearUserElements() {
  _write([]);
  _notify();
}

/** Слушатели изменений — для reactivity подпрограмм. */
const _listeners = new Set();
export function onLibraryChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() { for (const cb of _listeners) { try { cb(); } catch(e) { console.error(e); } } }
