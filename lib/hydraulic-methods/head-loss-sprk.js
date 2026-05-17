/* =========================================================================
   hydraulic-methods/head-loss-sprk.js — потери напора по нормам
   Республики Казахстан (СН РК 4.01-02 / СП РК 4.01-101, водоснабжение).
   D5: казахстанская норма как ОТДЕЛЬНАЯ методика-файл (отключаемая/
   версионируемая независимо). Гидравлика РК — той же СНиП-линии, что
   СП 30.13330 РФ → ядро переиспользуется из darcy-weisbach.js; здесь —
   собственная META для независимой дивергенции/версии.
   ========================================================================= */

import { compute as _computeDW } from './darcy-weisbach.js';

export const META = {
  id: 'head-loss-sprk',
  label: 'Потери напора — СН РК 4.01-02 / СП РК 4.01-101',
  standard: 'СН РК 4.01-02-2009 / СП РК 4.01-101-2012',
  region: 'KZ',
  version: '1.0',
  enabled: true,
  discipline: 'hydraulic',
  refs: ['СН РК 4.01-02', 'СП РК 4.01-101', 'Дарси (как СП 30.13330 РФ)'],
  inputs: [
    { key: 'Q',    label: 'Расход',          unit: 'м³/ч', type: 'number', default: 36, required: true },
    { key: 'D_mm', label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',    label: 'Длина участка',   unit: 'м',    type: 'number', default: 120, required: true },
    { key: 'material', label: 'Материал трубы', unit: '',   type: 'select', default: 'steel_used',
      options: [
        { value: 'steel_new', label: 'Сталь новая' },
        { value: 'steel_used', label: 'Сталь б/у' },
        { value: 'galvanized', label: 'Оцинковка' },
        { value: 'cast_iron', label: 'Чугун' },
        { value: 'copper', label: 'Медь' },
        { value: 'pvc', label: 'ПВХ' },
        { value: 'pe', label: 'ПЭ' },
        { value: 'concrete', label: 'Бетон' },
      ] },
    { key: 'sumK', label: 'Σ местных сопрот.', unit: '',   type: 'number', default: 0 },
    { key: 'tC',   label: 'Темп. воды',      unit: '°C',   type: 'number', default: 20 },
    { key: 'dz',   label: 'Геод. перепад',   unit: 'м',    type: 'number', default: 0 },
  ],
};

export function compute(input = {}) {
  const r = _computeDW(input);
  return { ...r, method: META.id, standard: META.standard };
}
