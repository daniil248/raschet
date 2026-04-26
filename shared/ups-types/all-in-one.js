// ======================================================================
// shared/ups-types/all-in-one.js
// Тип ИБП «All-in-One» (Kehua S³C-…): моноблочный шкаф со встроенной
// батареей и встроенными PDM-панелями. По духу — как «integrated», но
// со своими ограничениями:
//
//   1) Батарея НЕ подбирается отдельно — идёт в комплекте, лимит модулей
//      зашит в модель (batteryMaxModules: 8 для 40/50 А·ч, 4 для 100 А·ч).
//   2) Параллельная работа с другими шкафами НЕ поддерживается
//      (no parallel expansion). Нагрузку нельзя «нарастить» добавлением
//      второго AIO — для этого нужен standalone S³ (тип «integrated» +
//      cabinet S3C040/050/100).
//   3) Источник питания PDM фиксирован: одна панель «utility» (для HVAC),
//      одна «inverter» (IT-нагрузка). По требованию пользователя — ОДИН
//      выходной порт на панель (без 24-разъёмной разводки), чтобы не
//      загромождать схему.
//
// Модель именуется S3C{aH}-{phaseCode}{kVA} (по брошюре Kehua):
//   S3C040-1106 = 40 А·ч · 1:1 · 6 кВА
//   S3C040-3310 = 40 А·ч · 3:3 · 10 кВА
//   S3C040-3320 = 40 А·ч · 3:3 · 20 кВА
//   …
// ======================================================================

import { fmt, esc, v } from './_helpers.js';

export const allInOneType = {
  id: 'all-in-one',
  label: 'All-in-One (моноблок со встроенной АКБ)',
  shortLabel: 'ИБП (All-in-One)',
  icon: '📦',
  order: 40,

  matches(u) {
    if (!u) return false;
    return u.kind === 'ups-all-in-one';
  },

  defaults() {
    return {
      kind: 'ups-all-in-one',
      upsType: 'monoblock',     // внутри — моноблочный инвертор
      capacityKw: 20,
      capacityKva: 20,
      efficiency: 95,
      cosPhi: 1.0,
      vdcMin: 192,
      vdcMax: 240,
      inputs: 1,
      outputs: 1,
      phases: 3,
      // Встроенная батарея — параметры самой системы, не отдельная АКБ.
      batteryChemistry: 'li-ion',
      batteryCapacityAh: 40,
      batteryMaxModules: 8,     // для 40/50 А·ч; для 100 А·ч = 4
      batteryInstalledModules: 8,
      // PDM-панели: по умолчанию 2 (utility + inverter), один выход на панель.
      pdmModules: [
        { id: 'ac', label: 'PDM-AC (HVAC)', source: 'utility',  polarity: '3P', screenPrefix: '1QF' },
        { id: 'it', label: 'PDM-IT',        source: 'inverter', polarity: '1P', screenPrefix: '2QF' },
      ],
      // Габариты — стандартный шкаф S3C.
      cabinetWidthMm: 600,
      cabinetDepthMm: 1100,
      cabinetHeightMm: 2000,
      // Запрет параллельной работы.
      parallelSupported: false,
    };
  },

  formFieldsHtml(src) {
    src = src || {};
    const pdms = Array.isArray(src.pdmModules) ? src.pdmModules : [];
    const rows = [0, 1].map(i => {
      const p = pdms[i] || {};
      return `
        <div class="pdm-row" data-pdm-idx="${i}" style="display:contents">
          <label style="grid-column:1/2">Панель ${i + 1} (id)
            <input data-ut-pdm="id" type="text" value="${esc(p.id || '')}" placeholder="ac / it">
          </label>
          <label>Источник
            <select data-ut-pdm="source">
              <option value="" ${!p.source ? 'selected' : ''}>— нет —</option>
              <option value="utility"  ${p.source === 'utility'  ? 'selected' : ''}>Сеть (utility)</option>
              <option value="inverter" ${p.source === 'inverter' ? 'selected' : ''}>Инвертор</option>
              <option value="bypass"   ${p.source === 'bypass'   ? 'selected' : ''}>Байпас</option>
            </select>
          </label>
          <label>Полярность
            <select data-ut-pdm="polarity">
              <option value="1P" ${p.polarity === '1P' ? 'selected' : ''}>1P</option>
              <option value="3P" ${p.polarity === '3P' ? 'selected' : ''}>3P</option>
            </select>
          </label>
        </div>`;
    }).join('');
    return `
      <label>Мощность, kVA<input data-ut-field="capacityKva" type="number" min="1" step="1" value="${v(src.capacityKva, 20)}"></label>
      <label>Мощность, kW<input data-ut-field="capacityKw" type="number" min="1" step="1" value="${v(src.capacityKw, 20)}"></label>
      <label>Фазы (in:out)
        <select data-ut-field="phases">
          <option value="1" ${Number(src.phases) === 1 ? 'selected' : ''}>1:1</option>
          <option value="3" ${Number(src.phases) === 3 ? 'selected' : ''}>3:3</option>
        </select>
      </label>
      <div style="grid-column:1/-1;border-top:1px solid #ddd;padding-top:10px;margin-top:6px;background:#fffbe7;border-radius:4px">
        <div style="font-weight:600;margin:6px 8px 6px">🔋 Встроенная АКБ</div>
        <div class="form-grid" style="padding:0 8px">
          <label>Ёмкость модуля, А·ч
            <select data-ut-field="batteryCapacityAh">
              <option value="40"  ${Number(src.batteryCapacityAh) === 40  ? 'selected' : ''}>40 (макс. 8 модулей)</option>
              <option value="50"  ${Number(src.batteryCapacityAh) === 50  ? 'selected' : ''}>50 (макс. 8 модулей)</option>
              <option value="100" ${Number(src.batteryCapacityAh) === 100 ? 'selected' : ''}>100 (макс. 4 модуля)</option>
            </select>
          </label>
          <label>Установлено модулей<input data-ut-field="batteryInstalledModules" type="number" min="1" max="8" step="1" value="${v(src.batteryInstalledModules, 8)}"></label>
        </div>
        <div class="muted" style="font-size:11px;padding:6px 10px">Лимит модулей фиксируется автоматически: 8 для 40/50 А·ч, 4 для 100 А·ч. Параллельная работа AIO-шкафов <b>не поддерживается</b> — для наращивания мощности используйте standalone S³ (тип «Интегрированный»).</div>
      </div>
      <div style="grid-column:1/-1;border-top:1px solid #ddd;padding-top:10px;margin-top:6px">
        <div style="font-weight:600;margin-bottom:6px">Распределительные панели (по одному выходу на панель)</div>
        <div class="form-grid pdm-grid">${rows}</div>
      </div>
      <label>Шкаф W, мм<input data-ut-field="cabinetWidthMm"  type="number" min="300" step="10" value="${v(src.cabinetWidthMm, 600)}"></label>
      <label>Шкаф D, мм<input data-ut-field="cabinetDepthMm"  type="number" min="300" step="10" value="${v(src.cabinetDepthMm, 1100)}"></label>
      <label>Шкаф H, мм<input data-ut-field="cabinetHeightMm" type="number" min="300" step="10" value="${v(src.cabinetHeightMm, 2000)}"></label>`;
  },

  readForm(getField, root) {
    const ah = Number(getField('batteryCapacityAh')) || 40;
    const maxMods = (ah === 100) ? 4 : 8;
    const installed = Math.max(1, Math.min(maxMods, Number(getField('batteryInstalledModules')) || maxMods));
    const out = {
      kind: 'ups-all-in-one',
      capacityKva: Number(getField('capacityKva')) || 20,
      capacityKw:  Number(getField('capacityKw'))  || 20,
      phases:      Number(getField('phases'))      || 3,
      batteryCapacityAh:        ah,
      batteryMaxModules:        maxMods,
      batteryInstalledModules:  installed,
      cabinetWidthMm:  Number(getField('cabinetWidthMm'))  || 600,
      cabinetDepthMm:  Number(getField('cabinetDepthMm'))  || 1100,
      cabinetHeightMm: Number(getField('cabinetHeightMm')) || 2000,
      parallelSupported: false,
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
          polarity: row.querySelector('[data-ut-pdm="polarity"]')?.value || '1P',
        });
      });
    }
    return out;
  },

  detailRowsHtml(u) {
    const pdms = Array.isArray(u.pdmModules) ? u.pdmModules : [];
    const pdmList = pdms.length
      ? pdms.map(p => `${esc(p.label || p.id)} (${esc(p.source)} · ${esc(p.polarity)})`).join('<br>')
      : '<span class="muted">нет</span>';
    const ah = Number(u.batteryCapacityAh) || 0;
    const max = Number(u.batteryMaxModules) || (ah === 100 ? 4 : 8);
    const inst = Number(u.batteryInstalledModules) || max;
    return `
      <div>Мощность:</div><div><b>${fmt(u.capacityKw)} kW</b> / ${fmt(u.capacityKva)} kVA · ${u.phases || 3}:${u.phases || 3}</div>
      <div>Встроенная АКБ:</div><div><b>${ah} А·ч × ${inst} мод.</b> (лимит ${max})</div>
      <div>Параллельная работа:</div><div><b style="color:#c62828">не поддерживается</b></div>
      <div>Распред. панели:</div><div>${pdmList}</div>
      <div>Габариты шкафа:</div><div>${u.cabinetWidthMm || '—'} × ${u.cabinetDepthMm || '—'} × ${u.cabinetHeightMm || '—'} мм</div>`;
  },

  metaLabel(u) {
    return `${u.capacityKw}kW · ${u.batteryCapacityAh}А·ч ×${u.batteryInstalledModules || u.batteryMaxModules || 8} · AIO`;
  },

  pickFit(rq, u, parseRedundancy) {
    // AIO — моноблок: одна модель = одна установка. Параллель НЕ поддерживается.
    // Если требуется N+1 / 2N — модель не подходит.
    if (!u.capacityKw) return null;
    const r = parseRedundancy(rq.redundancy);
    if (r.mode !== 'N' && r.x === 0) {
      // Допускаем только базовую N. Для N+1/2N AIO не годится.
      return null;
    }
    if (r.mode === '2N' || r.x > 0) return null;
    if (rq.loadKw > Number(u.capacityKw) + 1e-6) return null;
    return {
      working: 1,
      redundant: 0,
      installed: 1,
      realCapacity: Number(u.capacityKw),
      usable: Number(u.capacityKw),
    };
  },

  fitDescription(u, fi) {
    return `1× ${u.capacityKw}kW (моноблок со встроенной АКБ ${u.batteryCapacityAh}А·ч×${u.batteryInstalledModules}). Параллель не поддерживается.`;
  },

  buildComposition(u, fi) {
    const out = [
      { elementId: u.id, qty: 1, role: 'aio-cabinet',
        label: (u.supplier || '') + ' ' + (u.model || u.id) + ' (All-in-One шкаф)' },
      { elementId: null, inline: true, qty: u.batteryInstalledModules || u.batteryMaxModules || 8, role: 'battery-module',
        label: `Батарейный модуль ${u.batteryCapacityAh} А·ч (встроен)` },
    ];
    if (Array.isArray(u.pdmModules)) {
      u.pdmModules.forEach(p => {
        out.push({ elementId: null, inline: true, qty: 1, role: 'pdm',
          label: `${p.label || p.id} · ${p.source} · ${p.polarity}` });
      });
    }
    return out;
  },

  bomSubItems(u) {
    const out = [];
    const inst = Number(u.batteryInstalledModules) || Number(u.batteryMaxModules) || 8;
    out.push({
      category: 'Встроенная АКБ AIO',
      id: `aio-batt-${u.id}`,
      supplier: u.supplier,
      model: `${u.model} · батарейный модуль ${u.batteryCapacityAh} А·ч × ${inst}`,
      qty: inst,
    });
    if (Array.isArray(u.pdmModules)) {
      for (const p of u.pdmModules) {
        out.push({
          category: 'Распред. панели AIO (PDM)',
          id: `aio-pdm-${u.id}-${p.id}`,
          supplier: u.supplier,
          model: `${u.model} · ${p.label || p.id} (${p.source}, ${p.polarity})`,
          qty: 1,
        });
      }
    }
    return out;
  },

  summaryRowsHtml(u, fi) {
    const pdmN = Array.isArray(u.pdmModules) ? u.pdmModules.length : 0;
    return `
      <tr><td>Мощность</td><td>${esc(fmt(u.capacityKw))} kW / ${esc(fmt(u.capacityKva))} kVA</td></tr>
      <tr><td>Фазы</td><td>${u.phases || 3}:${u.phases || 3}</td></tr>
      <tr><td>Встроенная АКБ</td><td>${u.batteryCapacityAh} А·ч × ${u.batteryInstalledModules || u.batteryMaxModules || 8} мод.</td></tr>
      <tr><td>Параллельная работа</td><td style="color:#c62828">не поддерживается</td></tr>
      <tr><td>Распред. панелей</td><td>${pdmN}</td></tr>`;
  },
};
