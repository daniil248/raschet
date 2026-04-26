// ======================================================================
// shared/ups-types/modular.js
// Тип ИБП «Модульный»: фрейм + сменные силовые модули.
// ======================================================================

import { fmt, esc, v } from './_helpers.js';

export const modularType = {
  id: 'modular',
  label: 'Модульный',
  shortLabel: 'ИБП (модульный)',
  icon: '⚡',
  order: 20,

  matches(u) {
    if (!u) return false;
    const k = u.kind || 'ups';
    if (k !== 'ups') return false;
    return u.upsType === 'modular';
  },

  defaults() {
    return {
      upsType: 'modular',
      capacityKw: 200,
      frameKw: 200,
      moduleKwRated: 25,
      moduleSlots: 8,
      efficiency: 96,
      cosPhi: 1.0,
      vdcMin: 340,
      vdcMax: 480,
      inputs: 2,
      outputs: 1,
    };
  },

  formFieldsHtml(src) {
    src = src || {};
    return `
      <label>Корпус, kW<input data-ut-field="frameKw" type="number" min="1" step="5" value="${v(src.frameKw, 200)}"></label>
      <label>Модуль, kW<input data-ut-field="moduleKwRated" type="number" min="1" step="1" value="${v(src.moduleKwRated, 25)}"></label>
      <label>Слотов в корпусе<input data-ut-field="moduleSlots" type="number" min="1" max="32" step="1" value="${v(src.moduleSlots, 8)}"></label>`;
  },

  readForm(getField) {
    return {
      frameKw: Number(getField('frameKw')) || 200,
      moduleKwRated: Number(getField('moduleKwRated')) || 25,
      moduleSlots: Number(getField('moduleSlots')) || 8,
    };
  },

  detailRowsHtml(u) {
    return `
      <div>Корпус:</div><div><b>${fmt(u.frameKw)} kW</b> · ${u.moduleSlots || '—'} слотов</div>
      <div>Модуль:</div><div><b>${fmt(u.moduleKwRated)} kW</b></div>`;
  },

  metaLabel(u) {
    return `Frame ${u.frameKw}kW · модуль ${u.moduleKwRated}kW × ${u.moduleSlots} слотов`;
  },

  pickFit(rq, u, parseRedundancy) {
    if (!u.moduleKwRated || !u.moduleSlots) return null;
    const r = parseRedundancy(rq.redundancy);
    const working = Math.ceil(rq.loadKw / u.moduleKwRated);
    const installed = (r.mode === '2N') ? working * 2 : working + r.x;
    if (installed > u.moduleSlots) return null;
    // v0.59.407: жёсткий кап по паспортной мощности модели — модуль с
    // capacityKw=120 (MR33 120) не должен «вмещать» 180 кВт даже если
    // moduleSlots=10 в копии записи. Проверяем что working×moduleKwRated и
    // installed×moduleKwRated не выходят за nameplate capacityKw / frameKw.
    const cap = Number(u.capacityKw) || Number(u.frameKw) || 0;
    if (cap > 0 && working * u.moduleKwRated > cap + 1e-6) return null;
    if (cap > 0 && installed * u.moduleKwRated > cap + 1e-6) return null;
    const realCapacity = working * u.moduleKwRated;
    return {
      working, redundant: r.x, installed,
      realCapacity, usable: working * u.moduleKwRated,
    };
  },

  fitDescription(u, fi) {
    return `${fi.working}×${u.moduleKwRated}kW (работа) + ${fi.redundant}×${u.moduleKwRated}kW (резерв) = ${fi.installed}/${u.moduleSlots} слотов`;
  },

  buildComposition(u, fi) {
    return [
      { elementId: u.id, qty: 1, role: 'frame',
        label: (u.supplier || '') + ' ' + (u.model || u.id) + ' (фрейм)' },
      { elementId: null, inline: true, qty: fi.installed, role: 'module',
        label: `Силовой модуль ${u.moduleKwRated}kW (${fi.working} раб + ${fi.redundant} резерв)` },
    ];
  },

  summaryRowsHtml(u, fi) {
    return `
      <tr><td>Корпус (frame)</td><td>${esc(fmt(u.frameKw))} kW</td></tr>
      <tr><td>Модуль</td><td>${esc(fmt(u.moduleKwRated))} kW</td></tr>
      <tr><td>Установлено модулей</td><td>${fi.installed} из ${u.moduleSlots}</td></tr>
      <tr><td>Рабочих модулей</td><td>${fi.working}</td></tr>
      <tr><td>Резерв</td><td>${fi.redundant}</td></tr>
      <tr><td>Реальная мощность</td><td>${esc(fmt(fi.realCapacity))} kW</td></tr>`;
  },
};
