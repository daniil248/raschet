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
  { id: 'tag',  label: 'Обозначение', required: true, group: 'identification', shortLabel: 'Tag' },
  { id: 'name', label: 'Имя',         required: true, group: 'identification', shortLabel: 'Имя' },
];

// Schematic-режим (главная схема, electrical) ─────────────────────────────
const SCHEMATIC_FIELDS = {
  consumer: [
    ...COMMON_REQUIRED,
    // v0.59.879: подписи полей сделаны ОДНОЗНАЧНЫМИ.
    // v0.60.185 (по репорту Пользователя 2026-05-04 «нужно выводить
    // номинальную мощность/ток и расчетную мощность/ток. это же актуально
    // и для группы потребителей»): добавлено capacityA для consumer
    // (раньше было только в panel). Это нужно чтобы PAIR «Номинал»
    // (nominalKw + capacityA → «Номинал: 8.2 кВт / 21.35 А») работал
    // на consumer-карточке. Семантика: capacityA = номинальный ток
    // потребителя Iном.
    { id: 'subtitle',     label: 'Подзаголовок (тип / вход)',  shortLabel: 'Тип',         group: 'identification' },
    { id: 'demandKw',     label: 'Расчётная мощность (кВт)',   shortLabel: 'Pрасч',       unit: 'kW', group: 'electrical' },
    { id: 'kvAOrVA',      label: 'Полная мощность (кВА)',      shortLabel: 'S',           unit: 'kVA', group: 'electrical' },
    { id: 'currentA',     label: 'Расчётный ток (А)',          shortLabel: 'Iрасч',       unit: 'A',   group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. мощность (кВт)',       shortLabel: 'Pмакс',       unit: 'kW', group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',              shortLabel: 'Iмакс',       unit: 'A',   group: 'electrical' },
    { id: 'nominalKw',    label: 'Номинальная мощность (кВт)', shortLabel: 'Pном',        unit: 'kW', group: 'electrical' },
    { id: 'capacityA',    label: 'Номинальный ток (А)',        shortLabel: 'Iном',        unit: 'A',   group: 'electrical' },
    { id: 'cosPhi',       label: 'cos φ',                      shortLabel: 'cos φ',                    group: 'electrical' },
    { id: 'phase',        label: 'Фаза',                       shortLabel: 'Фаза',                     group: 'electrical' },
    { id: 'voltage',      label: 'Напряжение (В)',             shortLabel: 'U',           unit: 'V',   group: 'electrical' },
    { id: 'breakerIn',    label: 'Номинал автомата (А)',       shortLabel: 'Iавт',        unit: 'A',   group: 'electrical' },
    { id: 'cableSpec',    label: 'Кабель (марка/сечение)',     shortLabel: 'Кабель',                   group: 'electrical' },
    { id: 'deltaUPct',    label: 'Падение напряжения ΔU (%)',  shortLabel: 'ΔU',          unit: '%',   group: 'electrical' },
    { id: 'freeKw',       label: 'Свободная мощность (кВт)',   shortLabel: 'Своб. P',     unit: 'kW', group: 'electrical' },
    { id: 'freeA',        label: 'Свободный ток (А)',          shortLabel: 'Своб. I',     unit: 'A',   group: 'electrical' },
    { id: 'count',        label: 'Кол-во в группе (шт.)',      shortLabel: '×',           unit: 'шт.', group: 'identification' },
    { id: 'icon',         label: 'Иконка типа',                shortLabel: 'Иконка',                   group: 'identification' },
  ],
  panel: [
    ...COMMON_REQUIRED,
    { id: 'capacityA',    label: 'Номинал шкафа (А)',       shortLabel: 'Номинал',    unit: 'A',     group: 'electrical' },
    { id: 'currentKw',    label: 'Текущая мощность (кВт)',  shortLabel: 'Текущая',    unit: 'kW',    group: 'electrical' },
    { id: 'currentA',     label: 'Текущий ток (А)',         shortLabel: 'Ток',        unit: 'A',     group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. (кВт)',             shortLabel: 'Макс.',      unit: 'kW',   group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',           shortLabel: 'Макс. ток',  unit: 'A',     group: 'electrical' },
    { id: 'freeKw',       label: 'Свободно (кВт)',          shortLabel: 'Свободно',   unit: 'kW',   group: 'electrical' },
    { id: 'freeA',        label: 'Свободно (А)',            shortLabel: 'Своб. ток',  unit: 'A',     group: 'electrical' },
    { id: 'marginPct',    label: 'Запас (%)',               shortLabel: 'Запас',      unit: '%',     group: 'electrical' },
    { id: 'kSim',         label: 'Kисп',                    shortLabel: 'Kисп',                       group: 'electrical' },
    { id: 'switchMode',   label: 'Режим АВР',               shortLabel: 'Режим',                      group: 'electrical' },
    { id: 'sectionsCount',label: 'Кол-во секций',           shortLabel: 'Секций',     unit: 'секц.', group: 'identification' },
  ],
  source: [
    ...COMMON_REQUIRED,
    { id: 'sourceSubtype',label: 'Тип источника',           shortLabel: 'Тип',                       group: 'identification' },
    { id: 'voltage',      label: 'Напряжение',              shortLabel: 'U',          unit: 'V',     group: 'electrical' },
    { id: 'snomKva',      label: 'Sном (кВА)',              shortLabel: 'Sном',       unit: 'kVA',   group: 'electrical' },
    { id: 'capacityKw',   label: 'Мощность (кВт)',          shortLabel: 'Pном',       unit: 'kW',   group: 'electrical' },
    { id: 'currentKw',    label: 'Текущая мощность (кВт)',  shortLabel: 'Текущая',    unit: 'kW',    group: 'electrical' },
    { id: 'currentA',     label: 'Текущий ток (А)',         shortLabel: 'Ток',        unit: 'A',     group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. (кВт)',             shortLabel: 'Макс.',      unit: 'kW',   group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',           shortLabel: 'Макс. ток',  unit: 'A',     group: 'electrical' },
    { id: 'freeKw',       label: 'Свободно (кВт)',          shortLabel: 'Свободно',   unit: 'kW',   group: 'electrical' },
    { id: 'freeA',        label: 'Свободно (А)',            shortLabel: 'Своб. ток',  unit: 'A',     group: 'electrical' },
    { id: 'sscMva',       label: 'Sкз (МВА)',               shortLabel: 'Sкз',        unit: 'MVA',   group: 'electrical' },
    { id: 'ukPct',        label: 'uк (%)',                  shortLabel: 'uк',         unit: '%',     group: 'electrical' },
  ],
  generator: [
    ...COMMON_REQUIRED,
    { id: 'capacityKw',   label: 'Мощность (кВт)',          shortLabel: 'Pном',       unit: 'kW',   group: 'electrical' },
    { id: 'snomKva',      label: 'Sном (кВА)',              shortLabel: 'Sном',       unit: 'kVA',   group: 'electrical' },
    { id: 'currentKw',    label: 'Текущая мощность (кВт)',  shortLabel: 'Текущая',    unit: 'kW',    group: 'electrical' },
    { id: 'currentA',     label: 'Текущий ток (А)',         shortLabel: 'Ток',        unit: 'A',     group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. (кВт)',             shortLabel: 'Макс.',      unit: 'kW',   group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',           shortLabel: 'Макс. ток',  unit: 'A',     group: 'electrical' },
    { id: 'freeKw',       label: 'Свободно (кВт)',          shortLabel: 'Свободно',   unit: 'kW',   group: 'electrical' },
    { id: 'freeA',        label: 'Свободно (А)',            shortLabel: 'Своб. ток',  unit: 'A',     group: 'electrical' },
    { id: 'backupMode',   label: 'Резервный режим',         shortLabel: 'Режим',                     group: 'status' },
    { id: 'triggerInfo',  label: 'Триггеры',                shortLabel: 'Триггеры',   unit: 'триг.', group: 'status' },
  ],
  ups: [
    ...COMMON_REQUIRED,
    { id: 'kva',          label: 'кВА',                     shortLabel: 'Sном',       unit: 'kVA',   group: 'electrical' },
    { id: 'kw',           label: 'кВт',                     shortLabel: 'Pном',       unit: 'kW',   group: 'electrical' },
    { id: 'autonomyMin',  label: 'Автономия (мин)',         shortLabel: 'Автономия',  unit: 'мин',   group: 'electrical' },
    { id: 'currentKw',    label: 'Текущая мощность (кВт)',  shortLabel: 'Текущая',    unit: 'kW',    group: 'electrical' },
    { id: 'currentA',     label: 'Ток (А)',                 shortLabel: 'Ток',        unit: 'A',     group: 'electrical' },
    { id: 'maxKw',        label: 'Макс. (кВт)',             shortLabel: 'Макс.',      unit: 'kW',   group: 'electrical' },
    { id: 'maxA',         label: 'Макс. ток (А)',           shortLabel: 'Макс. ток',  unit: 'A',     group: 'electrical' },
    { id: 'freeKw',       label: 'Свободно (кВт)',          shortLabel: 'Свободно',   unit: 'kW',   group: 'electrical' },
    { id: 'freeA',        label: 'Свободно (А)',            shortLabel: 'Своб. ток',  unit: 'A',     group: 'electrical' },
    { id: 'redundancy',   label: 'Резервирование',          shortLabel: 'Резерв',                    group: 'status' },
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

/**
 * Найти описание поля по (kind, type, fieldId).
 * Возвращает поле или null. v0.59.807.
 */
export function getFieldDef(kind, type, fieldId) {
  return listCardFields(kind, type).find(f => f.id === fieldId) || null;
}

/**
 * Краткая подпись поля для канваса (короче чем label, без скобочек с
 * единицами, т.к. unit рендерится отдельно после value).
 * Если у поля нет shortLabel — fallback на label.
 */
export function shortLabel(kind, type, fieldId) {
  const f = getFieldDef(kind, type, fieldId);
  return (f && f.shortLabel) || (f && f.label) || fieldId;
}

/** Единица измерения поля (если есть). */
export function fieldUnit(kind, type, fieldId) {
  const f = getFieldDef(kind, type, fieldId);
  return (f && f.unit) || '';
}
