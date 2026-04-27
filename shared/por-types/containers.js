// shared/por-types/containers.js
// POR-types для location-иерархии: site / building / floor / space.
//
// Любое POR-оборудование может ссылаться через domains.location.{siteId|
// buildingId|floorId|spaceId} на эти контейнеры. Технолог/архитектор
// заполняет иерархию один раз в начале проекта; остальные дисциплины
// видят и используют для фильтрации.

import { num, str, withDomains } from './_helpers.js';

function makeContainer(typeId, defaultName, extraMech) {
  return {
    id: typeId,
    label: defaultName,
    icon: ({ site: '🌍', building: '🏢', floor: '📋', space: '🚪' })[typeId] || '📦',
    category: 'container',
    defaultDomains: ['location', 'mechanical'],
    inspectorPanels: ['location', 'mechanical'],

    factory(opts) {
      const o = opts || {};
      return withDomains({
        type: typeId,
        subtype: str(o.subtype),
        tag:  str(o.tag),
        name: str(o.name, defaultName),
      }, {
        location: {
          parentId: o.parentId || null,  // ссылка на контейнер уровнем выше
          level:    num(o.level, 0),     // для floor: 0=земля, 1, -1, …
          address:  str(o.address),
        },
        mechanical: {
          widthMm:  num(o.widthMm,  0),
          depthMm:  num(o.depthMm,  0),
          heightMm: num(o.heightMm, 0),
          areaM2:   num(o.areaM2,   0),
          ...(extraMech || {}),
        },
      });
    },
  };
}

export const SITE_TYPE     = makeContainer('site',     'Площадка');
export const BUILDING_TYPE = makeContainer('building', 'Здание');
export const FLOOR_TYPE    = makeContainer('floor',    'Этаж');
export const SPACE_TYPE    = makeContainer('space',    'Помещение');

export const CONTAINER_TYPES = [SITE_TYPE, BUILDING_TYPE, FLOOR_TYPE, SPACE_TYPE];
