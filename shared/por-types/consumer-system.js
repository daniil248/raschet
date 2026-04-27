// shared/por-types/consumer-system.js
// POR-type 'consumer-system' — распределённая электрическая система без
// собственного габарита.
//
// Примеры (subtype):
//   'lighting'       — система освещения этажа/помещения (N ламп распределены)
//   'outlets'        — розеточная сеть (N розеток на пространстве)
//   'pipe-heating'   — обогрев трубопроводов (нагревательный кабель вдоль линии)
//   'snow-melting'   — обогрев кровли/лотков
//   'ventilation'    — вентилятор/электропривод вентиляции (если ↔︎ HVAC мы
//                      показывает их как электро-нагрузку)
//   'plinth-heating' — плинтусный обогрев / тёплый пол с эл. кабелем
//   'custom'         — произвольный тип, заданный пользователем
//
// Отличия от 'rack' / 'consumer' / 'panel':
//   • НЕТ domains.mechanical — системы не имеют geometric footprint (но
//     могут быть kabelи / лотки / распред.коробки — это отдельные POR-
//     объекты type='enclosure'/'cable', не часть consumer-system).
//   • domains.location.spaces[] — массив пространств (система может быть
//     распределена по нескольким помещениям/зонам).
//   • domains.electrical.composition — структура с кол-вом и параметрами
//     отдельных «единиц» (ламп / розеток / погонных метров кабеля), без
//     создания N отдельных POR-объектов.

import { num, str, withDomains } from './_helpers.js';

const KNOWN_SUBTYPES = [
  'lighting', 'outlets', 'pipe-heating', 'snow-melting',
  'ventilation', 'plinth-heating', 'custom',
];

const SUBTYPE_LABEL_RU = {
  'lighting':       'Освещение',
  'outlets':        'Розеточная сеть',
  'pipe-heating':   'Обогрев трубопроводов',
  'snow-melting':   'Антиобледенение',
  'ventilation':    'Вентиляция',
  'plinth-heating': 'Электрический обогрев',
  'custom':         'Система',
};

const SUBTYPE_ICON = {
  'lighting':       '💡',
  'outlets':        '🔌',
  'pipe-heating':   '🌡',
  'snow-melting':   '❄',
  'ventilation':    '🌀',
  'plinth-heating': '♨',
  'custom':         '⚙',
};

export const CONSUMER_SYSTEM_TYPE = {
  id: 'consumer-system',
  label: 'Распределённая система',
  icon: '💡',                                    // дефолтная — для палитры
  category: 'system',                             // ← НОВАЯ категория
  defaultDomains: ['electrical', 'location'],     // mechanical отсутствует
  inspectorPanels: ['electrical', 'location'],
  groupElectricalKeys: ['phases', 'cosPhi', 'demandKw', 'voltageV'],

  factory(opts) {
    const o = opts || {};
    const subtype = KNOWN_SUBTYPES.includes(o.subtype) ? o.subtype : (o.subtype ? 'custom' : 'lighting');
    const defaultName = SUBTYPE_LABEL_RU[subtype] || 'Система';
    const icon = SUBTYPE_ICON[subtype] || '⚙';

    return withDomains({
      type: 'consumer-system',
      subtype,
      tag:  str(o.tag),
      name: str(o.name, defaultName),
      manufacturer: str(o.manufacturer),
      model:        str(o.model),
      views: {
        // На принципиалке — компактный символ системы (без габаритного
        // прямоугольника как у rack).
        schematic: { symbol: 'consumer-system', icon, label: defaultName },
        // На layout-странице систему НЕ рисуем как footprint (нет габарита).
        // Можно опционально показать «зону покрытия» по location.spaces.
        layout:    { coverageMode: 'spaces' },
        // На СКС-странице — как правило, не отображается (если subtype не
        // 'outlets' с СКС-розетками; такие имеют parallel domain.scs).
      },
    }, {
      electrical: {
        demandKw: num(o.demandKw, 0),
        cosPhi:   num(o.cosPhi,   0.95),
        phases:   num(o.phases,   1),
        voltageV: o.voltageV ?? 230,
        kSim:     num(o.kSim,     1.0),  // коэф. одновременности
        // Composition — кол-во и параметры отдельных «единиц» без создания
        // отдельных POR-объектов. Поля depend on subtype:
        //   lighting:     { unitCount, unitPowerW, lampType }
        //   outlets:      { outletCount, outletRatedA, outletType }
        //   pipe-heating: { lengthM, powerPerMeterW, cableType, mediumTempC }
        //   snow-melting: { areaM2, powerPerM2W }
        //   ventilation:  { fanCount, fanPowerKw, controlKind }
        composition: o.composition || {},
        ports:       Array.isArray(o.electricalPorts) ? o.electricalPorts : [],
      },
      location: {
        // Системы распределены по НЕСКОЛЬКИМ пространствам (в отличие от
        // одного spaceId у rack/panel). Для compatibility сохраняем оба
        // поля: spaceId — если система в одном помещении; spaces[] —
        // если в нескольких.
        spaceId:    o.spaceId || null,
        spaces:     Array.isArray(o.spaces) ? o.spaces : [],
        floorId:    o.floorId    || null,
        buildingId: o.buildingId || null,
        siteId:     o.siteId     || null,
        zoneId:     o.zoneId     || null,    // логическая зона (не пространство)
        ...((o.location && typeof o.location === 'object') ? o.location : {}),
      },
    });
  },
};

/** Helper: посчитать суммарную мощность по composition (если задана). */
export function calcSystemDemandFromComposition(comp, subtype) {
  if (!comp) return null;
  switch (subtype) {
    case 'lighting': {
      const n = num(comp.unitCount, 0);
      const w = num(comp.unitPowerW, 0);
      return (n * w) / 1000;  // W → kW
    }
    case 'outlets': {
      // По умолчанию мощность не считается из composition — пользователь
      // вводит demandKw напрямую (k одновременности уже учтён).
      return null;
    }
    case 'pipe-heating':
    case 'plinth-heating': {
      const len = num(comp.lengthM, 0);
      const ppm = num(comp.powerPerMeterW, 0);
      return (len * ppm) / 1000;
    }
    case 'snow-melting': {
      const a = num(comp.areaM2, 0);
      const ppm2 = num(comp.powerPerM2W, 0);
      return (a * ppm2) / 1000;
    }
    case 'ventilation': {
      const fc = num(comp.fanCount, 0);
      const fp = num(comp.fanPowerKw, 0);
      return fc * fp;
    }
    default: return null;
  }
}

export const CONSUMER_SYSTEM_SUBTYPES = KNOWN_SUBTYPES;
export const CONSUMER_SYSTEM_SUBTYPE_LABELS = SUBTYPE_LABEL_RU;
