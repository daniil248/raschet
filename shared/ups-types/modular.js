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
    const cap = Number(u.capacityKw) || Number(u.frameKw) || 0;
    const canParallel = rq.canParallel !== false;
    // Сколько модулей нужно для покрытия loadKw (без учёта резерва).
    const workingTotal = Math.ceil(rq.loadKw / u.moduleKwRated);
    const installedTotal = (r.mode === '2N') ? workingTotal * 2 : workingTotal + r.x;
    // v0.59.407: жёсткий кап по паспортной мощности модели/фрейма.
    // Сначала пробуем уместить в ОДИН frame.
    const fitsSingle = installedTotal <= u.moduleSlots
      && (cap === 0 || workingTotal * u.moduleKwRated <= cap + 1e-6)
      && (cap === 0 || installedTotal * u.moduleKwRated <= cap + 1e-6);
    if (fitsSingle) {
      const realCapacity = workingTotal * u.moduleKwRated;
      return {
        working: workingTotal, redundant: r.x, installed: installedTotal,
        realCapacity, usable: workingTotal * u.moduleKwRated,
        parallelFrames: 1,
        isParallel: false,
      };
    }
    // v0.60.405 (по запросу Пользователя 2026-05-06): multi-frame parallel.
    // Если single frame не вмещает И поддерживается параллель — несколько
    // frames в параллель. Каждый frame заполнен по паспорту (cap или
    // moduleSlots × moduleKwRated). Резерв — на каждом frame'е (распределён).
    if (!canParallel) return null;
    const frameCap = cap > 0 ? cap : (u.moduleSlots * u.moduleKwRated);
    if (frameCap <= 0) return null;
    const framesNeeded = Math.ceil(rq.loadKw / frameCap);
    if (framesNeeded < 2) return null; // не помог parallel, single тоже не fit
    // Per-frame layout: модулей в каждом frame'е = ceil(workingTotal / framesNeeded),
    // резерв распределяется аналогично.
    const workingPerFrame = Math.ceil(workingTotal / framesNeeded);
    const installedPerFrame = (r.mode === '2N') ? workingPerFrame * 2 : workingPerFrame + Math.ceil(r.x / framesNeeded);
    if (installedPerFrame > u.moduleSlots) return null;
    if (cap > 0 && installedPerFrame * u.moduleKwRated > cap + 1e-6) return null;
    const totalInstalled = installedPerFrame * framesNeeded;
    const totalWorking = workingPerFrame * framesNeeded;
    const realCapacity = totalWorking * u.moduleKwRated;
    const totalRedundant = totalInstalled - totalWorking;
    return {
      working: totalWorking, redundant: totalRedundant, installed: totalInstalled,
      realCapacity, usable: realCapacity,
      parallelFrames: framesNeeded,
      isParallel: true,
      installedPerFrame, workingPerFrame,
    };
  },

  fitDescription(u, fi) {
    // v0.60.405: для multi-frame parallel показываем «🔗 N×frames».
    if (fi.isParallel && fi.parallelFrames > 1) {
      return `${fi.parallelFrames} × Frame ${u.frameKw}kW (по ${fi.installedPerFrame} слотов = ${fi.installed}/${u.moduleSlots * fi.parallelFrames}) <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">🔗 параллель</span>`;
    }
    return `${fi.working}×${u.moduleKwRated}kW (работа) + ${fi.redundant}×${u.moduleKwRated}kW (резерв) = ${fi.installed}/${u.moduleSlots} слотов`;
  },

  buildComposition(u, fi) {
    // v0.60.405: для multi-frame parallel — увеличиваем qty фрейма.
    const frameQty = fi.parallelFrames || 1;
    return [
      { elementId: u.id, qty: frameQty, role: 'frame',
        label: (u.supplier || '') + ' ' + (u.model || u.id) + ' (фрейм)'
          + (frameQty > 1 ? ` × ${frameQty} в параллель` : '') },
      { elementId: null, inline: true, qty: fi.installed, role: 'module',
        label: `Силовой модуль ${u.moduleKwRated}kW (${fi.working} раб + ${fi.redundant} резерв)` },
    ];
  },

  summaryRowsHtml(u, fi) {
    // v0.60.405: для multi-frame parallel показываем кол-во фреймов.
    const framesRow = (fi.parallelFrames && fi.parallelFrames > 1)
      ? `<tr><td>🔗 Фреймов в параллель</td><td><b>${fi.parallelFrames}</b> × ${esc(fmt(u.frameKw))} kW</td></tr>`
      : '';
    const totalSlots = u.moduleSlots * (fi.parallelFrames || 1);
    return `
      <tr><td>Корпус (frame)</td><td>${esc(fmt(u.frameKw))} kW</td></tr>
      ${framesRow}
      <tr><td>Модуль</td><td>${esc(fmt(u.moduleKwRated))} kW</td></tr>
      <tr><td>Установлено модулей</td><td>${fi.installed} из ${totalSlots}</td></tr>
      <tr><td>Рабочих модулей</td><td>${fi.working}</td></tr>
      <tr><td>Резерв</td><td>${fi.redundant}</td></tr>
      <tr><td>Реальная мощность</td><td>${esc(fmt(fi.realCapacity))} kW</td></tr>`;
  },
};
