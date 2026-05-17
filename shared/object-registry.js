/* =========================================================================
   shared/object-registry.js — общий per-project реестр физических
   объектов (КОНТРАКТ-ШОВ, Ф-E / X.4.5.3 §6).
   -------------------------------------------------------------------------
   Назначение (schema-constructor-architecture.md §6): ОДИН физический
   объект (стойка/шкаф/устройство) на проект; дисциплины правят только
   свой срез атрибутов; межмодульная видимость определяется ПОРТАМИ
   (data→СКС, fieldbus→АСУТП, pipe→гидравлика, ...).

   Этот файл — ТОЛЬКО контракт + чистые аксессоры (как Ф-A
   disciplines.js): без импортов модулей/lib, без доступа к LS. Реестр
   передаётся аргументом; интеграция с project-storage швом и
   реконсиляция с memory:rack-merge / tech-workspace — СЛЕДУЮЩИЕ
   защищённые инкременты Ф-E. На этом шаге ПОТРЕБИТЕЛЕЙ нет
   (cache-safe, memory:cache_safe_exports). НИКАКОЙ авто-записи
   (memory:user-params-sacred).
   ========================================================================= */

/**
 * @typedef {Object} ObjectPort
 * @property {string} id     уникальный в пределах объекта
 * @property {PortType} type тип порта (определяет межмодульную видимость)
 * @property {?string} label человекочитаемая подпись (опц.)
 */

/**
 * @typedef {Object} RegistryObject
 * @property {string} id        уникальный per-project id
 * @property {string} kind      'rack' | 'cabinet' | 'device' | ...
 * @property {?string} tag      пользовательский шифр (для dedup-suggest)
 * @property {?string} ownerModule  модуль-владелец (эмиттер объекта)
 * @property {ObjectPort[]} ports    типизированные порты
 * @property {Object<string,object>} disciplineAttrs срез атрибутов
 *           по дисциплине: { electrical:{...}, data:{...}, ... } —
 *           каждая дисциплина правит ТОЛЬКО свой ключ.
 */

/** Типы портов → межмодульная видимость (§6). Расширяемо. */
export const PORT_TYPES = [
  'power',    // электроснабжение
  'data',     // СКС / слаботочка
  'fieldbus', // АСУТП / полевая шина
  'pipe',     // гидравлика
  'duct',     // ОВиК
  'gas',      // газоснабжение
];

const _portSet = Object.freeze(new Set(PORT_TYPES));

/** Валиден ли тип порта. */
export function isPortType(t) {
  return typeof t === 'string' && _portSet.has(t);
}

/**
 * Нормализовать порты объекта → только валидные типы, без дублей id.
 * @param {RegistryObject} obj
 * @returns {ObjectPort[]}
 */
export function objectPorts(obj) {
  const raw = obj && Array.isArray(obj.ports) ? obj.ports : [];
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id || seen.has(id) || !isPortType(p.type)) continue;
    seen.add(id);
    out.push({ id, type: p.type, label: typeof p.label === 'string' ? p.label : null });
  }
  return out;
}

/** Несёт ли объект хотя бы один порт данного типа. */
export function hasPortType(obj, portType) {
  return objectPorts(obj).some(p => p.type === portType);
}

/**
 * Виден ли объект модулю дисциплины — порт-driven видимость (§6).
 * Объект всплывает в модуле, если у него есть порт нужного типа.
 * @param {RegistryObject} obj
 * @param {PortType} portType тип порта, на который смотрит модуль
 * @returns {boolean}
 */
export function isVisibleToPort(obj, portType) {
  return isPortType(portType) && hasPortType(obj, portType);
}

/**
 * Дисциплинарный срез атрибутов объекта (read). Возвращает срез или
 * {} — НЕ мутирует, отсутствие среза ≠ ошибка (user-params-sacred).
 * @param {RegistryObject} obj
 * @param {string} disciplineId  id из shared/disciplines.js
 * @returns {object}
 */
export function disciplineSlice(obj, disciplineId) {
  const da = obj && obj.disciplineAttrs;
  if (da && typeof da === 'object' && da[disciplineId]
      && typeof da[disciplineId] === 'object') {
    return da[disciplineId];
  }
  return {};
}

/**
 * Список объектов реестра, видимых модулю по типу порта.
 * @param {RegistryObject[]} registry
 * @param {PortType} portType
 * @returns {RegistryObject[]}
 */
export function objectsVisibleToPort(registry, portType) {
  if (!Array.isArray(registry) || !isPortType(portType)) return [];
  return registry.filter(o => isVisibleToPort(o, portType));
}

/**
 * Кандидаты-дубли по совпадению tag (fallback для legacy, §6 /
 * memory:rack-merge — общий реестр by-design, авто-suggest «Связать»).
 * Чистая функция: не сливает, только находит группы одинаковых tag.
 * @param {RegistryObject[]} registry
 * @returns {Object<string,RegistryObject[]>} tag → объекты (только
 *          группы размером ≥2)
 */
export function duplicateTagGroups(registry) {
  const byTag = {};
  if (!Array.isArray(registry)) return byTag;
  for (const o of registry) {
    const tag = o && typeof o.tag === 'string' ? o.tag.trim() : '';
    if (!tag) continue;
    (byTag[tag] || (byTag[tag] = [])).push(o);
  }
  for (const t of Object.keys(byTag)) {
    if (byTag[t].length < 2) delete byTag[t];
  }
  return byTag;
}
