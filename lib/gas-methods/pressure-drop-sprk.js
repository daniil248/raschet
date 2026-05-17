/* =========================================================================
   gas-methods/pressure-drop-sprk.js — потери давления по нормам
   Республики Казахстан (СН РК 4.03-01 / СП РК 4.03-101, газораспред.
   системы). D5: казахстанская норма как ОТДЕЛЬНАЯ методика-файл —
   отключаемая/версионируемая независимо. Гидравлическая методика РК
   восходит к той же СНиП-линии, что и СП 42-101 РФ → расчётное ядро
   переиспользуется из pressure-drop.js; здесь — собственная META
   (норма/регион/версия), чтобы РК могла дивергировать/версионироваться
   независимо без правки РФ-метода.
   ========================================================================= */

import { compute as _computeRu } from './pressure-drop.js';

export const META = {
  id: 'gas-dp-sprk',
  label: 'Потери давления — СН РК 4.03-01 / СП РК 4.03-101',
  standard: 'СН РК 4.03-01-2011 / СП РК 4.03-101-2013',
  region: 'KZ',
  version: '1.0',
  enabled: true,
  discipline: 'gas',
  refs: ['СН РК 4.03-01', 'СП РК 4.03-101', 'СНиП-линия (как СП 42-101 РФ)'],
  inputs: [
    { key: 'Q',      label: 'Расход (н.у.)',   unit: 'м³/ч', type: 'number', default: 50, required: true },
    { key: 'D_mm',   label: 'Внутр. диаметр',  unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',      label: 'Длина участка',   unit: 'м',    type: 'number', default: 200, required: true },
    { key: 'P1_kPa', label: 'Давл. в начале (изб.)', unit: 'кПа', type: 'number', default: 3 },
    { key: 'gas',    label: 'Газ',             unit: '',     type: 'select', default: 'natural',
      options: [
        { value: 'natural', label: 'Природный' },
        { value: 'methane', label: 'Метан' },
        { value: 'propane', label: 'Пропан' },
        { value: 'butane', label: 'Бутан' },
        { value: 'air', label: 'Воздух' },
      ] },
    { key: 'tC',     label: 'Темп. газа',      unit: '°C',   type: 'number', default: 20 },
  ],
};

export function compute(input = {}) {
  const r = _computeRu(input);
  return { ...r, method: META.id, standard: META.standard };
}
