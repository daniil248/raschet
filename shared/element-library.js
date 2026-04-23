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
// ——— Override-слой для редактирования builtin (см. комментарий ниже) ———
// Правка элементов, помеченных `builtin: true`, хранится отдельным
// срезом в localStorage — не трогая исходные seed'ы и не смешиваясь
// с user-created элементами. Ключ ГЛОБАЛЬНЫЙ (не per-user), т.к.
// редактирование builtin — прерогатива роли «catalog-admin» (см.
// Фазу 5 roadmap), и правки должны быть видны всем пользователям
// установки. Значения: Map<id, Partial<Element>> — либо частичный
// override (patch), либо полная запись с флагом `tombstone: true`
// (временное «удаление» builtin из выдачи).
const OVERRIDES_KEY = 'raschet.elementLibrary.overrides.v1';
// Роль пользователя. До внедрения полноценного auth (Фаза 5) читается
// из localStorage['raschet.currentRole']: 'user' (default) | 'catalog-admin' | 'admin'.
// Только admin-роли могут редактировать builtin (canEditBuiltin()).
const ROLE_KEY = 'raschet.currentRole';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

/** Текущая роль (заглушка до Фазы 5 auth). */
export function getCurrentRole() {
  try { return localStorage.getItem(ROLE_KEY) || 'user'; }
  catch { return 'user'; }
}
/**
 * true если текущая роль имеет право редактировать builtin-элементы.
 * v0.58.73: role-gate временно снят — любая роль может править builtin
 * через override-слой. Реальная проверка вернётся в Фазу 5 (auth).
 * Storage и API остаются готовыми (override-слой, getCurrentRole).
 */
export function canEditBuiltin() {
  return true;
}

// ——— Overrides (правки builtin) ———
function _readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}
function _writeOverrides(map) {
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map || {})); }
  catch (e) { console.error('[element-library] write overrides failed', e); }
}
/** Применить override (если есть) к builtin-элементу. Возвращает merged-копию. */
function _applyOverride(el, overrides) {
  if (!el || !el.builtin) return el;
  const ov = overrides[el.id];
  if (!ov) return el;
  if (ov.tombstone) return null; // builtin «скрыт» админом
  return { ...el, ...ov, id: el.id, kind: el.kind, builtin: true, source: 'builtin', overridden: true, updatedAt: ov.updatedAt || el.updatedAt };
}

/**
 * Список всех overrides builtin-элементов (для UI каталога-админа).
 * Возвращает { [id]: patch }.
 */
export function listBuiltinOverrides() { return _readOverrides(); }

/**
 * Экспорт всех локальных правок (builtin-overrides + user-elements) в компактный
 * JSON, пригодный для передачи разработчику и последующего мержа в seed-файлы.
 * Формат:
 *   { version, exportedAt, overrides: {...}, userElements: [...] }
 */
export function exportLocalEdits() {
  return JSON.stringify({
    version: 1,
    kind: 'raschet-library-edits',
    exportedAt: Date.now(),
    overrides: _readOverrides(),
    userElements: _read(),
  }, null, 2);
}

/**
 * Сбросить override для builtin-элемента (вернуть к исходному seed).
 * Только для admin-роли. Возвращает true если что-то было удалено.
 */
export function resetBuiltinOverride(id) {
  // role-gate снят до Фазы 5, см. canEditBuiltin()
  const map = _readOverrides();
  if (!(id in map)) return false;
  delete map[id];
  _writeOverrides(map);
  _notify();
  return true;
}

// ——— Валидные значения kind ———
// ВАЖНО про кабели: `cable-type` — это ЛИНЕЙКА (ВВГнг-LS, АВБбШв, UTP…),
// к нему НЕЛЬЗЯ привязывать цену (нельзя сказать «ВВГ стоит 5 рублей»).
// Конкретный ценник — это `cable-sku`: `{ cableTypeId, cores, sizeMm2 }`
// (например «ВВГнг-LS 3×2.5 мм² — 95 ₽/м»). Цены ТОЛЬКО на SKU.
export const ELEMENT_KINDS = {
  panel:         { category: 'equipment', label: 'НКУ (LV щит, IEC 61439)', pricable: true,
                   note: 'Низковольтное комплектное устройство до 1000 В (ВРУ, ЩС, ЩО, ЩК). Стандарт IEC 61439, формы разделения 1-4.' },
  'junction-box':{ category: 'equipment', label: 'Клеммная коробка (Junction Box)', pricable: true,
                   note: 'Коробка N-вход → N-выход: каждый вход идёт напрямую в свой выход через клеммник. Опционально в цепь ставится защитный аппарат (автомат / предохранитель). Возможны перемычки между входами ДО защитного аппарата.' },
  ups:           { category: 'equipment', label: 'Источник бесперебойного питания', pricable: true },
  battery:       { category: 'equipment', label: 'Аккумуляторная батарея', pricable: true },
  transformer:   { category: 'equipment', label: 'Трансформатор', pricable: true },
  breaker:       { category: 'equipment', label: 'Автоматический выключатель', pricable: true },
  'mv-switchgear': { category: 'equipment', label: 'РУ СН (MV, IEC 62271-200)', pricable: true,
                     note: 'Распределительное устройство среднего напряжения 6-35 кВ (RM6, SafeRing, ЩО-70). Стандарт IEC 62271-200, категории LSC1/LSC2.' },
  'mv-cell':     { category: 'equipment', label: 'Ячейка СН (ввод/отход/ТН/секционная)', pricable: true,
                   note: 'Типы ячеек: infeed, feeder, transformer-protection, measurement, busCoupler, earthing' },
  enclosure:     { category: 'equipment', label: 'Корпус (оболочка) щита', pricable: true },
  climate:       { category: 'equipment', label: 'Климатическое оборудование', pricable: true },
  rack:          { category: 'equipment', label: 'Серверная / телеком-стойка (19")', pricable: true,
                   note: 'Шкаф 19" с дверями, крышей, основанием, комплектами кабельных вводов. IEC 60297.' },
  pdu:           { category: 'equipment', label: 'PDU (блок распределения питания)', pricable: true,
                   note: 'Категории: basic / metered / monitored / switched / hybrid. Входы C14/C20/IEC 60309/hard-wired.' },
  'rack-accessory': { category: 'equipment', label: 'Аксессуар стойки (организатор, полка, заглушка)', pricable: true },
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
    get listElements() { return listElements; },
    get onLibraryChange() { return onLibraryChange; },
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
  const overrides = _readOverrides();
  // Builtin элементы не пересекаются с user по id (user id не должен совпадать с builtin)
  const userFiltered = userList.filter(u => !_builtins.has(u.id));
  const builtinsMerged = [];
  for (const el of _builtins.values()) {
    const merged = _applyOverride(el, overrides);
    if (merged) builtinsMerged.push(merged);
  }
  let all = [...builtinsMerged, ...userFiltered];

  if (filter.kind) all = all.filter(e => e.kind === filter.kind);
  if (filter.category) all = all.filter(e => e.category === filter.category);
  if (filter.tag) all = all.filter(e => Array.isArray(e.tags) && e.tags.includes(filter.tag));
  if (filter.manufacturer) all = all.filter(e => e.manufacturer === filter.manufacturer);

  return all;
}

/** Найти элемент по id (с учётом override для builtin). */
export function getElement(id) {
  if (_builtins.has(id)) {
    const overrides = _readOverrides();
    return _applyOverride(_builtins.get(id), overrides);
  }
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
  // Правка builtin: пишем в override-слой (только для catalog-admin),
  // не трогая исходный seed. Обычные пользователи получают ошибку —
  // клонирование должно идти через cloneElement().
  if (_builtins.has(element.id)) {
    if (!canEditBuiltin()) {
      throw new Error('[element-library] cannot override builtin: ' + element.id + ' (requires catalog-admin role)');
    }
    const map = _readOverrides();
    // Сохраняем полный снимок как patch поверх builtin — простая модель,
    // позволяет редактору править любые поля без diff-логики.
    const { id, kind, builtin, source, overridden, ...patch } = element;
    map[element.id] = { ...patch, updatedAt: Date.now() };
    _writeOverrides(map);
    _notify();
    return _applyOverride(_builtins.get(element.id), map);
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

/**
 * Удалить элемент. Для builtin: admin-роль может пометить tombstone
 * (скрыть из выдачи); сброс к исходному seed — через resetBuiltinOverride().
 */
export function removeElement(id) {
  if (_builtins.has(id)) {
    if (!canEditBuiltin()) return false;
    const map = _readOverrides();
    map[id] = { tombstone: true, updatedAt: Date.now() };
    _writeOverrides(map);
    _notify();
    return true;
  }
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
