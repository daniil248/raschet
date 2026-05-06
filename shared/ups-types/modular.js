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
    // v0.60.409: раздельные схемы — moduleRedundancy и unitRedundancy.
    // Backward-compat: если только rq.redundancy задано — используем для модулей.
    const moduleScheme = rq.moduleRedundancy || rq.redundancy || 'N';
    const unitScheme = rq.unitRedundancy || 'N';
    const rMod = parseRedundancy(moduleScheme);
    const rUnit = parseRedundancy(unitScheme);
    const cap = Number(u.capacityKw) || Number(u.frameKw) || 0;
    const canParallel = rq.canParallel !== false;
    // Сколько модулей нужно для покрытия loadKw (без учёта резерва).
    const workingTotal = Math.ceil(rq.loadKw / u.moduleKwRated);
    // Module-level редундансия (внутри single-frame) — только для single-frame
    // (без multi-frame). Для multi-frame moduleScheme применяется на per-frame.
    const installedTotalSingleFrame = (rMod.mode === '2N') ? workingTotal * 2 : workingTotal + rMod.x;
    // v0.59.407: жёсткий кап по паспортной мощности модели/фрейма.
    // Сначала пробуем уместить в ОДИН frame.
    const fitsSingle = installedTotalSingleFrame <= u.moduleSlots
      && (cap === 0 || workingTotal * u.moduleKwRated <= cap + 1e-6)
      && (cap === 0 || installedTotalSingleFrame * u.moduleKwRated <= cap + 1e-6);
    if (fitsSingle) {
      // Single frame fit: применяем module-level редундансию. Unit-level тоже
      // может применяться (1 рабочий frame + N+1 = 2 frames), при canParallel.
      const unitRedundantFrames = canParallel
        ? ((rUnit.mode === '2N') ? 1 : rUnit.x) // 1 фрейм-резерв (поверх 1 working frame)
        : 0;
      const totalFramesS = 1 + unitRedundantFrames;
      const installedTotal = installedTotalSingleFrame * totalFramesS;
      const workingModules = workingTotal; // working modules in working frame
      const realCapacity = workingModules * u.moduleKwRated;
      const totalRedundant = installedTotal - workingModules;
      return {
        working: workingModules, redundant: totalRedundant, installed: installedTotal,
        realCapacity, usable: realCapacity,
        parallelFrames: totalFramesS,
        workingFrames: 1,
        redundantFrames: unitRedundantFrames,
        isParallel: totalFramesS > 1,
        installedPerFrame: installedTotalSingleFrame, workingPerFrame: workingTotal,
      };
    }
    // v0.60.405 (по запросу Пользователя 2026-05-06): multi-frame parallel.
    // v0.60.408 (по уточнению Пользователя 2026-05-06: «не хватает
    // резервирования самих ИБП а не только модулей»): для multi-frame
    // редундансия применяется на УРОВНЕ ФРЕЙМОВ (N+1 = +1 frame),
    // а не размазывается на модули внутри каждого frame'а. Каждый frame
    // имеет workingPerFrame модулей (без extra reserve внутри). Frame-level
    // резерв = r.x фреймов (для N+1) или = framesNeeded (для 2N).
    if (!canParallel) return null;
    const frameCap = cap > 0 ? cap : (u.moduleSlots * u.moduleKwRated);
    if (frameCap <= 0) return null;
    const workingFrames = Math.ceil(rq.loadKw / frameCap);
    if (workingFrames < 2) return null; // single frame не помог parallel
    // v0.60.409: frame-level редундансия — из rUnit; module-level — из rMod
    // применяется ВНУТРИ каждого frame'а (extra модули в каждом frame'е).
    const redundantFrames = (rUnit.mode === '2N') ? workingFrames : rUnit.x;
    const totalFrames = workingFrames + redundantFrames;
    // Каждый working frame несёт долю нагрузки; модулей в каждом frame'е
    // = столько, сколько нужно для покрытия (loadKw / workingFrames),
    // плюс module-level reserve.
    const moduleKw = u.moduleKwRated;
    const workingPerFrame = Math.ceil((rq.loadKw / workingFrames) / moduleKw);
    const installedPerFrame = (rMod.mode === '2N')
      ? workingPerFrame * 2
      : workingPerFrame + rMod.x;
    if (installedPerFrame > u.moduleSlots) return null;
    if (cap > 0 && installedPerFrame * moduleKw > cap + 1e-6) return null;
    // Все frames (incl. reserve) имеют одинаковое наполнение модулями.
    const totalModules = installedPerFrame * totalFrames;
    const workingModules = workingPerFrame * workingFrames;
    const realCapacity = workingModules * moduleKw;
    const totalRedundant = totalModules - workingModules;
    return {
      working: workingModules,
      redundant: totalRedundant,
      installed: totalModules,
      realCapacity, usable: realCapacity,
      parallelFrames: totalFrames,
      workingFrames,
      redundantFrames,
      isParallel: true,
      installedPerFrame, workingPerFrame,
      // v0.60.409: разбивка редундансии для UI отчёта.
      moduleReservePerFrame: installedPerFrame - workingPerFrame,
      moduleScheme,
      unitScheme,
    };
  },

  fitDescription(u, fi) {
    // v0.60.405/v0.60.408: для multi-frame parallel показываем frame-level
    // breakdown.
    if (fi.isParallel && fi.parallelFrames > 1) {
      const wF = fi.workingFrames || fi.parallelFrames;
      const rF = fi.redundantFrames || 0;
      const frameDescr = rF > 0
        ? `${wF} раб + ${rF} рез = ${fi.parallelFrames} ИБП`
        : `${fi.parallelFrames} ИБП в параллель`;
      return `🔗 ${frameDescr}, по ${fi.installedPerFrame}×${u.moduleKwRated}kW в каждом фрейме (${fi.installed} модулей всего) <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">параллель</span>`;
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
    // v0.60.405/v0.60.408: для multi-frame parallel — раздельно frame-level
    // и module-level.
    const isMulti = fi.parallelFrames && fi.parallelFrames > 1;
    let framesRows = '';
    if (isMulti) {
      const wF = fi.workingFrames || fi.parallelFrames;
      const rF = fi.redundantFrames || 0;
      framesRows = `
        <tr><td>🔗 Фреймов в параллель</td><td><b>${fi.parallelFrames}</b> × ${esc(fmt(u.frameKw))} kW${rF > 0 ? ` (${wF} раб + ${rF} рез)` : ''}</td></tr>`;
    }
    const totalSlots = u.moduleSlots * (fi.parallelFrames || 1);
    return `
      <tr><td>Корпус (frame)</td><td>${esc(fmt(u.frameKw))} kW</td></tr>
      ${framesRows}
      <tr><td>Модуль</td><td>${esc(fmt(u.moduleKwRated))} kW</td></tr>
      <tr><td>Установлено модулей</td><td>${fi.installed} из ${totalSlots}${isMulti ? ` (по ${fi.installedPerFrame} в каждом frame)` : ''}</td></tr>
      <tr><td>Рабочих модулей</td><td>${fi.working}</td></tr>
      <tr><td>Резерв модулей</td><td>${fi.redundant}${isMulti && fi.redundantFrames > 0 ? ` (включая ${fi.redundantFrames} резервный фрейм)` : ''}</td></tr>
      <tr><td>Реальная мощность</td><td>${esc(fmt(fi.realCapacity))} kW</td></tr>`;
  },
};
