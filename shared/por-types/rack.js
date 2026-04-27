// shared/por-types/rack.js
// POR-type 'rack' — серверная/телекоммуникационная стойка.
//
// Доменные атрибуты:
//   mechanical: габариты, юниты, крепление
//   scs:        contents[] — IT-оборудование внутри стойки (наполнение)
//   electrical: суммарная нагрузка стойки (для подключения к щиту)
//   location:   привязка к зданию/этажу/помещению
//
// Типичные порты (создаются по требованию инженеров через addPort):
//   electrical:  { kind:'power-in', voltageV, phases } (PDU вход)
//   scs:         { kind:'sfp+', wavelength } или { kind:'rj45', category } (uplinks)
//   hvac:        обычно нет — охлаждение организует кондей рядом

import { num, str, withDomains } from './_helpers.js';

export const RACK_TYPE = {
  id: 'rack',
  label: 'Стойка',
  icon: '🗄',
  category: 'equipment',
  defaultDomains: ['mechanical', 'scs', 'electrical', 'location'],
  inspectorPanels: ['mechanical', 'electrical', 'scs', 'location'],

  factory(opts) {
    const o = opts || {};
    return withDomains({
      type: 'rack',
      subtype: str(o.subtype),
      tag:  str(o.tag),
      name: str(o.name, 'Стойка'),
      manufacturer: str(o.manufacturer),
      model:        str(o.model),
      views: {
        schematic: { symbol: 'rack' },
        layout:    { footprintMm: { w: num(o.widthMm, 600), h: num(o.depthMm, 800) } },
        data:      {},
      },
    }, {
      mechanical: {
        widthMm:    num(o.widthMm,   600),
        heightMm:   num(o.heightMm,  1991),
        depthMm:    num(o.depthMm,   800),
        weightKg:   num(o.weightKg,  80),
        rackUnits:  num(o.rackUnits, 42),
        anchorType: str(o.anchorType, 'floor'),
        ports:      Array.isArray(o.mechanicalPorts) ? o.mechanicalPorts : [],
      },
      scs: {
        contents: Array.isArray(o.contents) ? o.contents : [],
        ports:    Array.isArray(o.scsPorts) ? o.scsPorts : [],
      },
      electrical: {
        demandKw: num(o.demandKw, 0),
        cosPhi:   num(o.cosPhi,   0.95),
        phases:   num(o.phases,   3),
        voltageV: num(o.voltageV, 400) || null,
        ports:    Array.isArray(o.electricalPorts) ? o.electricalPorts : [],
      },
      location: o.location || {},
    });
  },

  // Какие поля участвуют в проверке группируемости (consumer-group).
  // Если у двух стоек различаются эти electrical-ключи — объединять
  // нельзя.
  groupElectricalKeys: ['phases', 'cosPhi', 'demandKw', 'voltageV'],
};
