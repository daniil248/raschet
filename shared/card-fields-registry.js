// =========================================================================
// shared/card-fields-registry.js — v0.59.783 (Phase 19.1)
//
// Реестр полей карточки узла на схеме. Каждое поле имеет:
//   id        — уникальный ключ внутри (page.kind, node.type)
//   label     — человекочитаемый заголовок (для UI настроек)
//   required  — поле обязательно отображается (нельзя выключить)
//   group     — секция группировки в UI (identification / electrical / mechanical / status)
//
// Используется:
//   - shared/card-presets.js: валидация preset-конфигов, default-пресеты
//   - shared/card-presets.js: resolveCardPreset (читает per-mode/perType)
//   - js/engine/render.js: фильтрация полей при рисовании карточки
//
// Пользователь: «настраивать свой вид этих карточек, и выводить только нужные ему
// данные». Иерархия выбора: scheme → project → user → system-default.
// =========================================================================

/** @typedef {{ id:string, label:string, required?:boolean, group?:string }} CardField */

// Common (для всех режимов): identification / status — обязательные.
const COMMON_REQUIRED = [
  { id: 'tag',  label: 'Обозначение', required: true, group: 'identification' },
  { id: 'name', label: 'Имя',         required: true, group: 'identification' },
];

// Schematic-режим (главная схема, electrical) ─────────────────────────────
const SCHEMATIC_FIELDS = {
  consumer: [
    ...COMMON_REQUIRED,
    { id: 'demandKw',     label: 'Мощность (кВт)',         group: 'electrical' },
    { id: 'kvAOrVA',      label: 'кВА',                     group: 'electrical' },
    { id: 'currentA',     label: 'Ток (А)',                 group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. (кВт)',             group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',           group: 'electrical' },
    { id: 'nominalKw',    label: 'Номинал (кВт)',           group: 'electrical' },
    { id: 'cosPhi',       label: 'cos φ',                   group: 'electrical' },
    { id: 'phase',        label: 'Фаза',                    group: 'electrical' },
    { id: 'voltage',      label: 'Напряжение',              group: 'electrical' },
    { id: 'breakerIn',    label: 'Автомат (А)',             group: 'electrical' },
    { id: 'cableSpec',    label: 'Кабель (марка/сечение)',  group: 'electrical' },
    { id: 'deltaUPct',    label: 'ΔU (%)',                  group: 'electrical' },
    { id: 'count',        label: 'Кол-во в группе',         group: 'identification' },
    { id: 'icon',         label: 'Иконка типа',             group: 'identification' },
  ],
  panel: [
    ...COMMON_REQUIRED,
    { id: 'capacityA',    label: 'Номинал шкафа (А)',       group: 'electrical' },
    { id: 'currentA',     label: 'Текущий ток (А)',         group: 'electrical' },
    { id: 'marginPct',    label: 'Запас (%)',               group: 'electrical' },
    { id: 'kSim',         label: 'Kисп',                    group: 'electrical' },
    { id: 'switchMode',   label: 'Режим АВР',               group: 'electrical' },
    { id: 'sectionsCount',label: 'Кол-во секций',           group: 'identification' },
  ],
  source: [
    ...COMMON_REQUIRED,
    { id: 'sourceSubtype',label: 'Тип источника',           group: 'identification' },
    { id: 'voltage',      label: 'Напряжение',              group: 'electrical' },
    { id: 'snomKva',      label: 'Sном (кВА)',              group: 'electrical' },
    { id: 'capacityKw',   label: 'Мощность (кВт)',          group: 'electrical' },
    { id: 'sscMva',       label: 'Sкз (МВА)',               group: 'electrical' },
    { id: 'ukPct',        label: 'uк (%)',                  group: 'electrical' },
  ],
  generator: [
    ...COMMON_REQUIRED,
    { id: 'capacityKw',   label: 'Мощность (кВт)',          group: 'electrical' },
    { id: 'snomKva',      label: 'Sном (кВА)',              group: 'electrical' },
    { id: 'backupMode',   label: 'Резервный режим',         group: 'status' },
    { id: 'triggerInfo',  label: 'Триггеры',                group: 'status' },
  ],
  ups: [
    ...COMMON_REQUIRED,
    { id: 'kva',          label: 'кВА',                     group: 'electrical' },
    { id: 'kw',           label: 'кВт',                     group: 'electrical' },
    { id: 'autonomyMin',  label: 'Автономия (мин)',         group: 'electrical' },
    { id: 'currentA',     label: 'Ток (А)',                 group: 'electrical' },
    { id: 'redundancy',   label: 'Резервирование',          group: 'status' },
  ],
  zone: [
    { id: 'zonePrefix', label: 'Префикс зоны', required: true, group: 'identification' },
    { id: 'name',       label: 'Имя',           required: true, group: 'identification' },
    { id: 'memberCount',label: 'Кол-во членов', group: 'identification' },
  ],
  channel: [
    ...COMMON_REQUIRED,
    { id: 'cableSpec',   label: 'Сечение / тип',         group: 'electrical' },
    { id: 'lengthM',     label: 'Длина (м)',             group: 'mechanical' },
  ],
};

// Layout-режим (план зала, mechanical/footprints) ─────────────────────────
const LAYOUT_FIELDS = {
  consumer: [
    ...COMMON_REQUIRED,
    { id: 'widthMm',     label: 'Ширина (мм)',           group: 'mechanical' },
    { id: 'depthMm',     label: 'Глубина (мм)',          group: 'mechanical' },
    { id: 'heightMm',    label: 'Высота (мм)',           group: 'mechanical' },
    { id: 'weightKg',    label: 'Вес (кг)',              group: 'mechanical' },
    { id: 'demandKw',    label: 'Мощность (кВт)',        group: 'electrical' },
    { id: 'cooling',     label: 'Тип охлаждения',        group: 'mechanical' },
    { id: 'rackUnits',   label: 'U',                     group: 'mechanical' },
  ],
  panel: [
    ...COMMON_REQUIRED,
    { id: 'widthMm',     label: 'Ширина (мм)',           group: 'mechanical' },
    { id: 'depthMm',     label: 'Глубина (мм)',          group: 'mechanical' },
    { id: 'heightMm',    label: 'Высота (мм)',           group: 'mechanical' },
    { id: 'capacityA',   label: 'Номинал (А)',           group: 'electrical' },
  ],
};

// scs-design (план СКС, межшкафные связи) ─────────────────────────────────
const SCS_DESIGN_FIELDS = {
  rack: [
    ...COMMON_REQUIRED,
    { id: 'rackUnits',   label: 'U',                     group: 'mechanical' },
    { id: 'occupied',    label: 'Занято U',              group: 'status' },
    { id: 'demandKw',    label: 'Мощность (кВт)',        group: 'electrical' },
  ],
};

/**
 * Реестр полей: top-level keys = page.kind, second-level = node.type.
 * Если для (kind,type) пары записи нет — система вернёт COMMON_REQUIRED
 * и режим будет считаться «без настройки» (отображение по умолчанию).
 */
export const CARD_FIELDS = {
  schematic:   SCHEMATIC_FIELDS,
  layout:      LAYOUT_FIELDS,
  'scs-design': SCS_DESIGN_FIELDS,
  // mechanical / hvac добавим по мере необходимости
};

/** Список field-объектов для (kind, type). [] если ничего не зарегистрировано. */
export function listCardFields(kind, type) {
  const byType = CARD_FIELDS[kind];
  if (!byType) return [...COMMON_REQUIRED];
  return byType[type] || [...COMMON_REQUIRED];
}

/** Все ID полей (включая required) — используется как «полный набор» для default-пресета. */
export function allFieldIds(kind, type) {
  return listCardFields(kind, type).map(f => f.id);
}

/** Required-IDs — обязательные поля, которые preset не может выключить. */
export function requiredFieldIds(kind, type) {
  return listCardFields(kind, type).filter(f => f.required).map(f => f.id);
}
