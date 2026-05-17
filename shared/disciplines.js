/* =========================================================================
   shared/disciplines.js — реестр инженерных дисциплин (КОНТРАКТ-ШОВ).
   -------------------------------------------------------------------------
   Единый источник правды между CORE (`state.project.discipline`,
   47.4.1) и per-discipline расчётными движками `lib/<id>-methods`
   (calc-lib, X.4.1). Чистые данные + тонкие аксессоры. БЕЗ импортов
   модулей/lib (закон границ: shared→module запрещён): движок здесь —
   лишь СТРОКА bare-спецификатора, фактический `import()` делает
   потребитель (когда у него появится importmap-ключ).
   Назначение: дать X.4.2 (узел в неск. дисциплинах) и X.4.4
   (сводный отчёт) стабильный контракт; CORE остаётся electrical.
   ========================================================================= */

/**
 * @typedef {Object} Discipline
 * @property {string} id        машинный ключ (== state.project.discipline)
 * @property {string} label     русское название (UI)
 * @property {string} icon      эмодзи-маркер
 * @property {?string} calcLibId id calc-lib (modules.json) или null (CORE)
 * @property {?string} calcLib  bare-спецификатор для import() потребителем
 * @property {string} units     базовая величина расчёта (подпись)
 * @property {boolean} core     true → расчёт в CORE (js/calc), не lib
 * @property {boolean} ready    true → движок реализован и развёрнут
 */

/** @type {Discipline[]} порядок = порядок отображения в UI. */
export const DISCIPLINES = [
  {
    id: 'electrical', label: 'Электроснабжение', icon: '⚡',
    calcLibId: null, calcLib: null, units: 'кВт / А / В',
    core: true, ready: true,
  },
  {
    id: 'hydraulic', label: 'Гидравлика', icon: '💧',
    calcLibId: 'hydraulic-methods', calcLib: 'hydraulic-methods/index.js',
    units: 'м³/ч / кПа / м', core: false, ready: true,
  },
  {
    id: 'hvac', label: 'ОВиК (вентиляция)', icon: '🌬',
    calcLibId: 'hvac-methods', calcLib: 'hvac-methods/index.js',
    units: 'м³/ч / кВт', core: false, ready: true,
  },
  {
    id: 'gas', label: 'Газоснабжение', icon: '⛽',
    calcLibId: 'gas-methods', calcLib: 'gas-methods/index.js',
    units: 'м³/ч / кПа', core: false, ready: true,
  },
  {
    id: 'suppression', label: 'Газовое пожаротушение', icon: '🧯',
    calcLibId: 'suppression-methods', calcLib: 'suppression-methods/index.js',
    units: 'кг / % / МПа', core: false, ready: true,
  },
  // 47.4.1 перечислил также mechanical/data — задел без движка.
  {
    id: 'mechanical', label: 'Механика / нагрузки', icon: '🧱',
    calcLibId: null, calcLib: null, units: 'кН / кг',
    core: false, ready: false,
  },
  {
    id: 'data', label: 'СКС / слаботочка', icon: '🔌',
    calcLibId: null, calcLib: null, units: 'порты / м',
    core: false, ready: false,
  },
];

const _byId = Object.freeze(
  Object.fromEntries(DISCIPLINES.map(d => [d.id, Object.freeze(d)])));

/** Дисциплина по id (или undefined). */
export function getDiscipline(id) {
  return _byId[id];
}

/** Дисциплина проекта по id с fallback на electrical (как serialization). */
export function disciplineOf(id) {
  return _byId[id] || _byId.electrical;
}

/** Список дисциплин: { onlyReady?, withLib? } фильтры. */
export function listDisciplines({ onlyReady = false, withLib = false } = {}) {
  return DISCIPLINES.filter(d =>
    (!onlyReady || d.ready) && (!withLib || !!d.calcLib));
}

/** Bare-спецификатор calc-lib дисциплины (для import() потребителем),
 *  либо null если расчёт в CORE / движок не готов. */
export function calcLibSpecifier(id) {
  const d = _byId[id];
  return d && d.ready ? d.calcLib : null;
}

/** id дисциплины по умолчанию (== CORE serialization default). */
export const DEFAULT_DISCIPLINE = 'electrical';

/* -------------------------------------------------------------------------
   X.4.2 — членство узла в дисциплинах (cross-discipline node).
   Контракт: узел МОЖЕТ нести опциональный массив `node.disciplines`
   (id-строки). Поле аддитивно и сохраняется в проекте «бесплатно»
   (serialization.stripRuntime пропускает любые не-`_` поля → round-trip
   без миграции). Если поля нет/пусто — узел принадлежит дисциплине
   проекта (как было до 47.4.1). НИКАКОЙ авто-записи: отсутствие поля
   ≠ ошибка (см. memory: user-params-sacred, typeof-guard).
   ------------------------------------------------------------------------- */

/** Нормализовать сырой список id → только известные, без дублей. */
function _sanitizeIds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const id = typeof x === 'string' ? x : '';
    if (id && _byId[id] && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * Эффективное членство узла в дисциплинах.
 * @param {object} node             узел схемы (может быть null)
 * @param {string} projectDiscipline текущая дисциплина проекта
 * @returns {string[]} непустой список id (fallback — [project|electrical])
 */
export function nodeDisciplines(node, projectDiscipline) {
  const explicit = _sanitizeIds(node && node.disciplines);
  if (explicit.length) return explicit;
  const base = (typeof projectDiscipline === 'string' && _byId[projectDiscipline])
    ? projectDiscipline : DEFAULT_DISCIPLINE;
  return [base];
}

/** Принадлежит ли узел дисциплине (с учётом fallback на проект). */
export function isNodeInDiscipline(node, disciplineId, projectDiscipline) {
  return nodeDisciplines(node, projectDiscipline).includes(disciplineId);
}

/** true → узел явно мультидисциплинарный (членство в ≥2 дисциплинах). */
export function isMultiDiscipline(node) {
  return _sanitizeIds(node && node.disciplines).length >= 2;
}

/* -------------------------------------------------------------------------
   Ф-A (X.4.5.3, Вариант I) — дисциплина СТРАНИЦЫ-схемы.
   Контракт: schema-constructor-architecture.md §2. Страница =
   типизированная схема; тип (дисциплина) задаётся в мастере создания
   и НЕИЗМЕНЯЕМ. Поле `page.discipline` аддитивно: serialization
   пропускает любые не-`_` поля → round-trip без миграции. Отсутствие
   поля ≠ ошибка: fallback на дисциплину проекта (как до Варианта I),
   затем DEFAULT_DISCIPLINE. НИКАКОЙ авто-записи (memory:user-params-
   sacred, typeof-guard). На этом шаге ПОТРЕБИТЕЛЕЙ нет (cache-safe);
   разводка в Конструктор/serialization — фазы Ф-B…Ф-C.
   ------------------------------------------------------------------------- */

/**
 * Эффективная дисциплина страницы-схемы.
 * @param {object} page             объект страницы (может быть null)
 * @param {string} projectDiscipline дисциплина проекта (backward-compat)
 * @returns {string} известный id дисциплины (никогда не пустой)
 */
export function pageDiscipline(page, projectDiscipline) {
  const explicit = page && typeof page.discipline === 'string'
    ? page.discipline : '';
  if (explicit && _byId[explicit]) return explicit;
  const base = (typeof projectDiscipline === 'string' && _byId[projectDiscipline])
    ? projectDiscipline : DEFAULT_DISCIPLINE;
  return base;
}

/** true → у страницы ЯВНО зафиксирован immutable-тип (есть валидное
 *  page.discipline). false → тип ещё не присвоен (legacy/наследует проект). */
export function isPageTyped(page) {
  return !!(page && typeof page.discipline === 'string' && _byId[page.discipline]);
}
