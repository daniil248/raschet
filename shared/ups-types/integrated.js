// ======================================================================
// shared/ups-types/integrated.js
// Тип ИБП «Интегрированный»: ИБП в шкафу + (опц.) встроенный входной АВР +
// до 3 распределительных панелей (PDM-AC / PDM-IT1 / PDM-IT2).
// Базовая модель: Kehua MR33 60-150K Integrated UPS.
// ======================================================================

import { fmt, esc, v } from './_helpers.js';

export const integratedType = {
  id: 'integrated',
  label: 'Интегрированный',
  shortLabel: 'ИБП (интегрированный)',
  icon: '🏗',
  order: 30,

  matches(u) {
    if (!u) return false;
    return u.kind === 'ups-integrated';
  },

  defaults() {
    return {
      kind: 'ups-integrated',
      upsType: 'modular', // внутри — модульный фрейм
      capacityKw: 90,
      frameKw: 90,
      moduleKwRated: 30,
      moduleSlots: 4,
      efficiency: 95,
      cosPhi: 1.0,
      vdcMin: 336,
      vdcMax: 552,
      inputs: 1,
      outputs: 1,
      hasIntegratedAts: false,
      pdmModules: [
        { id: 'ac',  label: 'PDM-AC (HVAC)',  source: 'utility',  maxBreakers: 7,  polarity: '3P', screenPrefix: '1QF' },
        { id: 'it1', label: 'PDM-IT Load 1',  source: 'inverter', maxBreakers: 24, polarity: '1P', screenPrefix: '2QF' },
        { id: 'it2', label: 'PDM-IT Load 2',  source: 'bypass',   maxBreakers: 24, polarity: '1P', screenPrefix: '3QF' },
      ],
      cabinetWidthMm: 600,
      cabinetDepthMm: 1200,
      cabinetHeightMm: 2000,
    };
  },

  formFieldsHtml(src) {
    src = src || {};
    const pdms = Array.isArray(src.pdmModules) ? src.pdmModules : [];
    const rows = [0, 1, 2].map(i => {
      const p = pdms[i] || {};
      return `
        <div class="pdm-row" data-pdm-idx="${i}" style="display:contents">
          <label style="grid-column:1/2">Панель ${i + 1} (id)
            <input data-ut-pdm="id" type="text" value="${esc(p.id || '')}" placeholder="ac / it1 / it2">
          </label>
          <label>Источник
            <select data-ut-pdm="source">
              <option value="" ${!p.source ? 'selected' : ''}>— нет —</option>
              <option value="utility"  ${p.source === 'utility'  ? 'selected' : ''}>Сеть (utility)</option>
              <option value="inverter" ${p.source === 'inverter' ? 'selected' : ''}>Инвертор</option>
              <option value="bypass"   ${p.source === 'bypass'   ? 'selected' : ''}>Байпас</option>
            </select>
          </label>
          <label>Макс. автоматов<input data-ut-pdm="maxBreakers" type="number" min="0" max="48" step="1" value="${v(p.maxBreakers, 0)}"></label>
          <label>Полярность
            <select data-ut-pdm="polarity">
              <option value="1P" ${p.polarity === '1P' ? 'selected' : ''}>1P</option>
              <option value="3P" ${p.polarity === '3P' ? 'selected' : ''}>3P</option>
            </select>
          </label>
        </div>`;
    }).join('');
    return `
      <label>Корпус, kW<input data-ut-field="frameKw" type="number" min="1" step="5" value="${v(src.frameKw, 90)}"></label>
      <label>Модуль, kW<input data-ut-field="moduleKwRated" type="number" min="1" step="1" value="${v(src.moduleKwRated, 30)}"></label>
      <label>Слотов в корпусе<input data-ut-field="moduleSlots" type="number" min="1" max="32" step="1" value="${v(src.moduleSlots, 4)}"></label>
      <label style="display:flex;align-items:center;gap:6px;flex-direction:row">
        <input data-ut-field="hasIntegratedAts" type="checkbox" ${src.hasIntegratedAts ? 'checked' : ''}>
        Встроенный входной АВР
      </label>
      <div style="grid-column:1/-1;border-top:1px solid #ddd;padding-top:10px;margin-top:6px">
        <div style="font-weight:600;margin-bottom:6px">Распределительные панели (до 3-х)</div>
        <div class="form-grid pdm-grid">${rows}</div>
      </div>
      <label>Шкаф W, мм<input data-ut-field="cabinetWidthMm"  type="number" min="300" step="10" value="${v(src.cabinetWidthMm, 600)}"></label>
      <label>Шкаф D, мм<input data-ut-field="cabinetDepthMm"  type="number" min="300" step="10" value="${v(src.cabinetDepthMm, 1200)}"></label>
      <label>Шкаф H, мм<input data-ut-field="cabinetHeightMm" type="number" min="300" step="10" value="${v(src.cabinetHeightMm, 2000)}"></label>`;
  },

  readForm(getField, root) {
    const out = {
      kind: 'ups-integrated',
      frameKw: Number(getField('frameKw')) || 90,
      moduleKwRated: Number(getField('moduleKwRated')) || 30,
      moduleSlots: Number(getField('moduleSlots')) || 4,
      hasIntegratedAts: !!(root && root.querySelector('[data-ut-field="hasIntegratedAts"]')?.checked),
      cabinetWidthMm:  Number(getField('cabinetWidthMm'))  || 600,
      cabinetDepthMm:  Number(getField('cabinetDepthMm'))  || 1200,
      cabinetHeightMm: Number(getField('cabinetHeightMm')) || 2000,
      pdmModules: [],
    };
    if (root) {
      root.querySelectorAll('.pdm-row').forEach(row => {
        const id = row.querySelector('[data-ut-pdm="id"]')?.value.trim();
        const source = row.querySelector('[data-ut-pdm="source"]')?.value;
        if (!id || !source) return;
        out.pdmModules.push({
          id,
          label: id.toUpperCase(),
          source,
          maxBreakers: Number(row.querySelector('[data-ut-pdm="maxBreakers"]')?.value) || 0,
          polarity: row.querySelector('[data-ut-pdm="polarity"]')?.value || '1P',
        });
      });
    }
    return out;
  },

  detailRowsHtml(u) {
    const pdms = Array.isArray(u.pdmModules) ? u.pdmModules : [];
    const pdmList = pdms.length
      ? pdms.map(p => `${esc(p.label || p.id)} (${esc(p.source)} · ${p.maxBreakers}×${esc(p.polarity)})`).join('<br>')
      : '<span class="muted">нет</span>';
    return `
      <div>Корпус:</div><div><b>${fmt(u.frameKw)} kW</b> · ${u.moduleSlots || '—'} слотов</div>
      <div>Модуль:</div><div><b>${fmt(u.moduleKwRated)} kW</b></div>
      <div>Входной АВР:</div><div><b>${u.hasIntegratedAts ? 'есть (встроенный)' : 'нет'}</b></div>
      <div>Распред. панели:</div><div>${pdmList}</div>
      <div>Габариты шкафа:</div><div>${u.cabinetWidthMm || '—'} × ${u.cabinetDepthMm || '—'} × ${u.cabinetHeightMm || '—'} мм</div>`;
  },

  metaLabel(u) {
    const ats = u.hasIntegratedAts ? ', АВР' : '';
    const pdmN = Array.isArray(u.pdmModules) ? u.pdmModules.length : 0;
    return `Frame ${u.frameKw}kW · модуль ${u.moduleKwRated}kW × ${u.moduleSlots}${ats} · PDM ×${pdmN}`;
  },

  pickFit(rq, u, parseRedundancy) {
    // Логика как у модульного — фрейм + модули.
    if (!u.moduleKwRated || !u.moduleSlots) return null;
    const r = parseRedundancy(rq.redundancy);
    const working = Math.ceil(rq.loadKw / u.moduleKwRated);
    const installed = (r.mode === '2N') ? working * 2 : working + r.x;
    if (installed > u.moduleSlots) return null;
    const realCapacity = working * u.moduleKwRated;
    return {
      working, redundant: r.x, installed,
      realCapacity, usable: working * u.moduleKwRated,
    };
  },

  fitDescription(u, fi) {
    return `${fi.working}×${u.moduleKwRated}kW + резерв ${fi.redundant} = ${fi.installed}/${u.moduleSlots} слотов${u.hasIntegratedAts ? ' · входной АВР' : ''}`;
  },

  buildComposition(u, fi) {
    const out = [
      { elementId: u.id, qty: 1, role: 'integrated-cabinet',
        label: (u.supplier || '') + ' ' + (u.model || u.id) + ' (интегрированный шкаф)' },
      { elementId: null, inline: true, qty: fi.installed, role: 'module',
        label: `Силовой модуль ${u.moduleKwRated}kW (${fi.working} раб + ${fi.redundant} резерв)` },
    ];
    if (u.hasIntegratedAts) {
      out.push({ elementId: null, inline: true, qty: 1, role: 'ats',
        label: 'Встроенный входной АВР' });
    }
    if (Array.isArray(u.pdmModules)) {
      u.pdmModules.forEach(p => {
        out.push({ elementId: null, inline: true, qty: 1, role: 'pdm',
          label: `${p.label || p.id} · ${p.source} · ${p.maxBreakers}×${p.polarity}` });
      });
    }
    return out;
  },

  summaryRowsHtml(u, fi) {
    const pdmN = Array.isArray(u.pdmModules) ? u.pdmModules.length : 0;
    return `
      <tr><td>Корпус (frame)</td><td>${esc(fmt(u.frameKw))} kW</td></tr>
      <tr><td>Модуль</td><td>${esc(fmt(u.moduleKwRated))} kW</td></tr>
      <tr><td>Установлено модулей</td><td>${fi.installed} из ${u.moduleSlots}</td></tr>
      <tr><td>Входной АВР</td><td>${u.hasIntegratedAts ? '✓ встроенный' : '— нет'}</td></tr>
      <tr><td>Распред. панелей</td><td>${pdmN}</td></tr>`;
  },
};
