// =============================================================================
// cooling/calc/datasheet.js — JSON-формат даташита холодильного оборудования
// =============================================================================
// Phase 25.1: По требованию Пользователя 2026-05-02 «для климатического
// оборудования добавь возможность загружать даташиты конкретного оборудования
// (описание формата добавь в справку модуля и поля импорта)».
//
// Pure JS, no DOM. Модуль определяет схему JSON-даташита, парсер и валидатор.
// Используется в cooling/ui/chiller-form.js (кнопка «📥 Импорт даташита»).

import { DEFAULT_CHILLER } from './chiller-defaults.js';

/**
 * Версия схемы даташита. Меняется при breaking-changes.
 * Backward-compat импортёр — лучшая практика.
 */
export const DATASHEET_SCHEMA = 'raschet-chiller-datasheet/v1';

/**
 * Спецификация полей даташита (для документации, валидации, UI-подсказок).
 * Поля без required:true — опциональные.
 */
export const DATASHEET_FIELDS = [
  // Идентификация
  { id: 'schema',         type: 'string',   required: true,
    desc: `Версия схемы. Должно быть «${DATASHEET_SCHEMA}» для импорта v1.` },
  { id: 'vendor',         type: 'string',   required: false, mapsTo: null,
    desc: 'Производитель (Daikin / Stulz / York / Carrier / Trane / Vertiv ...). Информационное.' },
  { id: 'model',          type: 'string',   required: false, mapsTo: null,
    desc: 'Модель агрегата. Информационное.' },
  { id: 'kind',           type: 'enum:chiller|crac|drycooler|dx', required: false, mapsTo: null,
    desc: 'Категория устройства. Информационное (более точно — systemType).' },

  // Базовые параметры → spec.*
  { id: 'systemType',     type: 'string',   required: false, mapsTo: 'systemType',
    desc: 'Тип системы согласно SYSTEM_TYPES (chiller / chiller-air-cooled-screw / dx-air / crac-water / ...). Если не задан — берётся kind или текущий spec.systemType.' },
  { id: 'ratedCapKw',     type: 'number',   required: true,  mapsTo: 'ratedCapKw',
    desc: 'Номинальная холодопроизводительность Q_rated при ratedAmbient, кВт.' },
  { id: 'ratedCop',       type: 'number',   required: true,  mapsTo: 'ratedCOP',
    desc: 'Rated COP = Q_cool / P_elec при ratedAmbient. Допускаются альтернативы: ratedCOP, COP, eer (после конверсии).' },
  { id: 'ambientRated',   type: 'number',   required: false, mapsTo: 'ambientRated',
    desc: 'Условия rated (T_amb, °C). Default 35°C для air-cooled, 30°C для water-cooled.' },

  // Capacity / COP correction
  { id: 'capCorrPctPerC', type: 'number',   required: false, mapsTo: 'capCorrPctPerC',
    desc: 'Capacity correction (%/°C). Air-cooled: −1.5; water-cooled: −0.5.' },
  { id: 'partLoadCurve',  type: 'enum:iplv|fixed', required: false, mapsTo: 'partLoadCurve',
    desc: 'COP curve mode. «iplv» — линейная Carnot-подобная коррекция; «fixed» — без T-correction.' },

  // Free-cooling
  { id: 'freeCoolingMode',          type: 'enum:none|dry|wet', required: false, mapsTo: 'freeCoolingMode',
    desc: 'Режим фрикулинга чиллера: none / dry (drycooler) / wet (cooling tower).' },
  { id: 'chwsTemp',                 type: 'number', required: false, mapsTo: 'chwsTemp',
    desc: 'Chilled Water Supply temperature, °C. Default 7°C.' },
  { id: 'freeCoolingApproach',      type: 'number', required: false, mapsTo: 'freeCoolingApproach',
    desc: 'Approach ΔT (°C) между T_ref и CHWS для 100% FC. Dry: 5; wet: 3.' },
  { id: 'freeCoolingAuxPctOfRated', type: 'number', required: false, mapsTo: 'freeCoolingAuxPctOfRated',
    desc: 'Aux power во время FC, % от ratedCap.' },

  // DX pumped
  { id: 'dxPumpedThresholdDb',     type: 'number', required: false, mapsTo: 'dxPumpedThresholdDb',
    desc: 'Threshold T_db (°C) — ниже которой DX-pumped переходит в FC.' },
  { id: 'dxPumpedAuxPctOfRated',   type: 'number', required: false, mapsTo: 'dxPumpedAuxPctOfRated',
    desc: 'Aux power DX-pumped (% от ratedCap).' },

  // Performance curve (вместо аналитических формул)
  { id: 'performanceCurve', type: 'array', required: false, mapsTo: 'perfCurve',
    desc: 'Массив точек реальной curve производителя: [{tAmbC, capacityKw, powerKw|cop}, ...]. Минимум 2 точки. Если задана — заменяет аналитические формулы.' },

  // Информационное (не маппится в spec, идёт в name)
  { id: 'refrigerant',    type: 'string', required: false, mapsTo: null,
    desc: 'Тип хладагента (R410A, R32, R134a, R513A ...). Информационное.' },
  { id: 'compressorType', type: 'string', required: false, mapsTo: null,
    desc: 'Тип компрессора (scroll, screw, centrifugal, reciprocating).' },
  { id: 'physical',       type: 'object', required: false, mapsTo: null,
    desc: 'Габариты {lengthMm, widthMm, heightMm, weightKg}. Используется в 3D-визуализации.' },
];

/**
 * Распарсить и валидировать даташит-JSON.
 *
 * @param {string} text — содержимое JSON-файла или paste-area
 * @returns {{ok: boolean, datasheet?: object, errors: string[]}}
 */
export function parseDatasheet(text) {
  const errors = [];
  let json;
  try { json = JSON.parse(text); }
  catch (e) {
    return { ok: false, errors: [`JSON-parse error: ${e.message}`] };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['JSON должен быть объектом {...}, не массивом или примитивом.'] };
  }

  // Schema check (предупреждение если другая версия, но не блок).
  if (!json.schema) {
    errors.push(`⚠ Поле «schema» отсутствует. Ожидается «${DATASHEET_SCHEMA}». Импорт продолжен в best-effort режиме.`);
  } else if (json.schema !== DATASHEET_SCHEMA) {
    errors.push(`⚠ Schema «${json.schema}» не равна ожидаемой «${DATASHEET_SCHEMA}». Импорт продолжен в best-effort режиме.`);
  }

  // Required-поля
  const ratedCap = Number(json.ratedCapKw ?? json.ratedCap ?? json.capacity);
  if (!Number.isFinite(ratedCap) || ratedCap <= 0) {
    errors.push('Обязательное поле «ratedCapKw» (или alias ratedCap/capacity) отсутствует или ≤ 0.');
  }
  const ratedCop = Number(json.ratedCop ?? json.ratedCOP ?? json.COP ?? json.cop);
  if (!Number.isFinite(ratedCop) || ratedCop <= 0) {
    errors.push('Обязательное поле «ratedCop» (или alias ratedCOP/COP/cop) отсутствует или ≤ 0.');
  }

  // Performance curve валидация
  if (Array.isArray(json.performanceCurve)) {
    if (json.performanceCurve.length < 2) {
      errors.push('performanceCurve: минимум 2 точки требуется для интерполяции.');
    } else {
      json.performanceCurve.forEach((pt, i) => {
        if (!pt || typeof pt !== 'object') {
          errors.push(`performanceCurve[${i}]: точка должна быть объектом {tAmbC, capacityKw, powerKw|cop}.`);
        } else {
          if (!Number.isFinite(Number(pt.tAmbC ?? pt.T))) {
            errors.push(`performanceCurve[${i}]: tAmbC (или T) должен быть числом.`);
          }
          if (!Number.isFinite(Number(pt.capacityKw ?? pt.capacity))) {
            errors.push(`performanceCurve[${i}]: capacityKw (или capacity) должен быть числом.`);
          }
          const hasPower = Number.isFinite(Number(pt.powerKw ?? pt.power));
          const hasCop = Number.isFinite(Number(pt.cop));
          if (!hasPower && !hasCop) {
            errors.push(`performanceCurve[${i}]: нужен либо powerKw, либо cop.`);
          }
        }
      });
    }
  }

  // Если есть фатальные ошибки (нет ratedCap или ratedCop) — fail.
  const fatal = errors.some(e => e.startsWith('Обязательное') || e.startsWith('performanceCurve['));
  if (fatal) return { ok: false, errors };

  return { ok: true, datasheet: json, errors };  // errors могут быть warnings
}

/**
 * Применить даташит к существующей spec (или DEFAULT_CHILLER если spec=null).
 * Возвращает новую spec, готовую к onChange().
 *
 * @param {object} datasheet — результат parseDatasheet().datasheet
 * @param {object|null} currentSpec
 * @returns {object} новая spec
 */
export function applyDatasheetToSpec(datasheet, currentSpec) {
  const base = { ...DEFAULT_CHILLER, ...(currentSpec || {}) };
  if (!datasheet) return base;

  // Маппинг по DATASHEET_FIELDS.mapsTo. Также alias-распознавание.
  const ratedCap = Number(datasheet.ratedCapKw ?? datasheet.ratedCap ?? datasheet.capacity);
  if (Number.isFinite(ratedCap)) base.ratedCapKw = ratedCap;

  const ratedCop = Number(datasheet.ratedCop ?? datasheet.ratedCOP ?? datasheet.COP ?? datasheet.cop);
  if (Number.isFinite(ratedCop)) base.ratedCOP = ratedCop;

  if (datasheet.systemType) base.systemType = String(datasheet.systemType);
  else if (datasheet.kind === 'chiller') base.systemType = base.systemType || 'chiller';
  else if (datasheet.kind === 'crac')    base.systemType = base.systemType || 'crac-water';
  else if (datasheet.kind === 'dx')      base.systemType = base.systemType || 'dx-air';

  for (const f of DATASHEET_FIELDS) {
    if (!f.mapsTo) continue;
    if (f.mapsTo === 'ratedCapKw' || f.mapsTo === 'ratedCOP' || f.mapsTo === 'systemType') continue;
    const v = datasheet[f.id];
    if (v == null) continue;
    if (f.mapsTo === 'perfCurve') {
      // Нормализуем точки performance-curve к {T, capacity, cop} формату cooling-calc.
      base.perfCurve = (Array.isArray(v) ? v : []).map(pt => {
        const T = Number(pt.tAmbC ?? pt.T);
        const capacity = Number(pt.capacityKw ?? pt.capacity);
        const cop = Number.isFinite(Number(pt.cop))
          ? Number(pt.cop)
          : (capacity / Math.max(0.01, Number(pt.powerKw ?? pt.power)));
        return { T, capacity, cop };
      }).filter(p => Number.isFinite(p.T) && Number.isFinite(p.capacity) && Number.isFinite(p.cop))
        .sort((a, b) => a.T - b.T);
    } else if (f.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) base[f.mapsTo] = n;
    } else {
      base[f.mapsTo] = v;
    }
  }

  // Имя spec из vendor + model (если заданы).
  if (datasheet.vendor || datasheet.model) {
    base.name = `${datasheet.vendor || ''} ${datasheet.model || ''}`.trim();
  }

  return base;
}

/**
 * Сгенерировать пример datasheet JSON для скачивания / копирования.
 */
export function getExampleDatasheet() {
  return JSON.stringify({
    schema: DATASHEET_SCHEMA,
    vendor: 'Daikin',
    model: 'EWAQ200BAW (пример)',
    kind: 'chiller',
    systemType: 'chiller-air-cooled-screw',
    ratedCapKw: 200,
    ratedCop: 3.4,
    ambientRated: 35,
    capCorrPctPerC: -1.5,
    partLoadCurve: 'iplv',
    freeCoolingMode: 'dry',
    chwsTemp: 12,
    freeCoolingApproach: 5,
    freeCoolingAuxPctOfRated: 6,
    performanceCurve: [
      { tAmbC: -10, capacityKw: 230, powerKw: 48 },
      { tAmbC:   0, capacityKw: 220, powerKw: 53 },
      { tAmbC:  15, capacityKw: 210, powerKw: 60 },
      { tAmbC:  25, capacityKw: 205, powerKw: 65 },
      { tAmbC:  35, capacityKw: 200, cop: 3.4 },
      { tAmbC:  45, capacityKw: 180, cop: 2.8 },
    ],
    refrigerant: 'R134a',
    compressorType: 'screw',
    physical: { lengthMm: 4500, widthMm: 2200, heightMm: 2400, weightKg: 3200 },
  }, null, 2);
}

/**
 * Сгенерировать markdown-описание формата для help-секции модуля.
 */
export function getDatasheetFormatDocsHtml() {
  const fields = DATASHEET_FIELDS.map(f => {
    const required = f.required ? '<b style="color:#b91c1c">required</b>' : '<span style="color:#64748b">optional</span>';
    const mapped = f.mapsTo ? ` → <code>spec.${f.mapsTo}</code>` : '';
    return `<tr>
      <td><code>${f.id}</code></td>
      <td><code>${f.type}</code></td>
      <td>${required}</td>
      <td>${f.desc}${mapped}</td>
    </tr>`;
  }).join('');
  return `
    <p>Формат JSON-даташита для импорта спецификации холодильного оборудования. Версия схемы: <code>${DATASHEET_SCHEMA}</code>.</p>
    <table class="cl-help-table" style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th>Поле</th><th>Тип</th><th>Обяз.</th><th>Описание</th></tr></thead>
      <tbody>${fields}</tbody>
    </table>
    <h5 style="margin-top:14px">Пример</h5>
    <pre style="background:#f1f5f9;padding:8px;border-radius:3px;font-size:11px;overflow-x:auto">${getExampleDatasheet()}</pre>
    <p class="muted" style="font-size:11.5px;margin-top:8px">
      💡 Альтернативные имена полей распознаются автоматически: <code>ratedCap</code> / <code>capacity</code> вместо <code>ratedCapKw</code>;
      <code>COP</code> / <code>ratedCOP</code> / <code>cop</code> вместо <code>ratedCop</code>;
      <code>T</code> вместо <code>tAmbC</code>; <code>power</code> вместо <code>powerKw</code>; <code>capacity</code> вместо <code>capacityKw</code>.
    </p>
  `;
}
