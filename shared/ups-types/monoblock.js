// ======================================================================
// shared/ups-types/monoblock.js
// Тип ИБП «Моноблок»: один цельный шкаф с фиксированной мощностью.
// v0.59.385: вынесен в отдельный модуль (плагин). Чтобы добавить новый
// тип ИБП — создайте файл рядом и импортируйте его в index.js.
// ======================================================================

import { fmt, esc, v } from './_helpers.js';

export const monoblockType = {
  id: 'monoblock',
  label: 'Моноблок',
  shortLabel: 'ИБП (моноблок)',
  icon: '⚡',
  order: 10,

  // Что считать моноблоком в каталоге.
  matches(u) {
    if (!u) return false;
    const k = u.kind || 'ups';
    if (k !== 'ups') return false;
    return (u.upsType || 'monoblock') === 'monoblock';
  },

  // Дефолты для новой записи.
  defaults() {
    return {
      upsType: 'monoblock',
      capacityKw: 100,
      efficiency: 95,
      cosPhi: 0.99,
      vdcMin: 340,
      vdcMax: 480,
      inputs: 1,
      outputs: 1,
    };
  },

  // Доп. поля формы (после общих полей мощности/КПД).
  formFieldsHtml(/* src */) {
    return ''; // моноблок не требует доп. полей
  },

  readForm(/* g, base */) {
    return {}; // нечего добавить
  },

  // Карточка деталей (что вывести помимо общего блока).
  detailRowsHtml(/* u */) {
    return '';
  },

  // Метка в карточке wizard suitable-list.
  metaLabel(u) {
    return `${fmt(u.capacityKw)}kW, КПД ${fmt(u.efficiency, 0)}%`;
  },

  // Расчёт необходимого числа единиц.
  pickFit(rq, u, parseRedundancy) {
    const cap = Number(u.capacityKw) || 0;
    if (cap <= 0) return null;
    const r = parseRedundancy(rq.redundancy);
    let requiredQty = 1;
    if (r.mode === '2N') requiredQty = 2;
    else requiredQty = Math.ceil(rq.loadKw / cap) + r.x;
    if (cap * (requiredQty - r.x) >= rq.loadKw) {
      return {
        working: requiredQty - r.x,
        redundant: r.x,
        installed: requiredQty,
        realCapacity: cap,
        usable: cap * (requiredQty - r.x),
      };
    }
    return null;
  },

  // Краткое описание подбора (для suitable-list).
  fitDescription(u, fi) {
    return `${fi.installed} × ${fi.realCapacity}kW (${fi.working} работа + ${fi.redundant} резерв)`;
  },

  // Состав для BOM/composition.
  buildComposition(u, fi) {
    return [{
      elementId: u.id,
      qty: fi.installed,
      role: fi.redundant ? 'active+standby' : 'active',
      label: (u.supplier || '') + ' ' + (u.model || u.id),
    }];
  },

  // Доп. строки в шаге 3 (summary).
  summaryRowsHtml(u, fi) {
    return `
      <tr><td>Мощность ед.</td><td>${esc(fmt(u.capacityKw))} kW</td></tr>
      <tr><td>Количество ИБП</td><td>${fi.installed}</td></tr>`;
  },
};
