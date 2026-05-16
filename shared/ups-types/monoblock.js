// ======================================================================
// shared/ups-types/monoblock.js
// Тип ИБП «Моноблок»: один цельный шкаф с фиксированной мощностью.
// v0.59.385: вынесен в отдельный модуль (плагин). Чтобы добавить новый
// тип ИБП — создайте файл рядом и импортируйте его в index.js.
// ======================================================================

import { fmt, esc, v } from './_helpers.js';
import { buildUpsAccessories } from './accessories.js';

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
    // v0.60.409: для monoblock используется unitRedundancy (модулей нет).
    // Backward-compat: если unitRedundancy не задано — fallback на rq.redundancy.
    const scheme = rq.unitRedundancy || rq.redundancy || 'N';
    const r = parseRedundancy(scheme);
    let requiredQty = 1;
    if (r.mode === '2N') requiredQty = Math.max(2, Math.ceil(rq.loadKw / cap) * 2);
    else requiredQty = Math.ceil(rq.loadKw / cap) + r.x;
    // v0.60.405 (по запросу Пользователя 2026-05-06: «при выборе поддержки
    // параллельной работы, должны быть доступны ИБП меньшей единичной
    // мощности, например на 1000 кВт должен быть выбор ИБП 500 или 600 кВт
    // включенных в параллель»): canParallel-gate. Если параллельная работа
    // запрещена (rq.canParallel === false) — допускаем только single-unit
    // (cap × 1 ≥ loadKw). При canParallel=true (default) — multi-unit
    // monoblock'и тоже показываются (например 2×500 kW для loadKw=1000).
    const canParallel = rq.canParallel !== false; // default true
    if (!canParallel && requiredQty > 1) return null;
    if (cap * (requiredQty - r.x) >= rq.loadKw) {
      return {
        working: requiredQty - r.x,
        redundant: r.x,
        installed: requiredQty,
        realCapacity: cap,
        usable: cap * (requiredQty - r.x),
        isParallel: requiredQty > 1, // v0.60.405: маркер для UI
      };
    }
    return null;
  },

  // Краткое описание подбора (для suitable-list).
  fitDescription(u, fi) {
    // v0.60.405: для multi-unit фитов добавляем «🔗 параллель» индикатор.
    const par = fi.isParallel || fi.installed > 1
      ? ` <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">🔗 параллель</span>`
      : '';
    return `${fi.installed} × ${fi.realCapacity}kW (${fi.working} работа + ${fi.redundant} резерв)${par}`;
  },

  // Состав для BOM/composition.
  buildComposition(u, fi) {
    return [{
      elementId: u.id,
      qty: fi.installed,
      role: fi.redundant ? 'active+standby' : 'active',
      label: (u.supplier || '') + ' ' + (u.model || u.id),
    },
      // v0.60.487: авто-принадлежности ИБП.
      ...buildUpsAccessories(u, fi, { phases: fi.phases }),
    ];
  },

  // Доп. строки в шаге 3 (summary).
  summaryRowsHtml(u, fi) {
    // v0.60.405: для multi-unit маркируем «🔗 в параллель».
    const parTxt = (fi.installed > 1)
      ? ` 🔗 в параллель`
      : '';
    return `
      <tr><td>Мощность ед.</td><td>${esc(fmt(u.capacityKw))} kW</td></tr>
      <tr><td>Количество ИБП</td><td>${fi.installed}${parTxt}</td></tr>
      <tr><td>Суммарная активная</td><td>${esc(fmt(fi.usable || (fi.realCapacity * fi.working)))} kW</td></tr>`;
  },
};
