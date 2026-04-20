// ======================================================================
// shared/catalog-xlsx-parser.js
// Унифицированный парсер плоских XLSX-таблиц в записи каталогов
// ups/panel/transformer. Идея:
//
//   — файл представляет собой плоскую таблицу с одной строкой-заголовком
//     и одной моделью в каждой строке данных
//   — колонки распознаются по имени (русский / английский), регистр и
//     пробелы игнорируются
//   — на каждую строку создаётся одна запись каталога через recordBuilder
//
// Используется глобальный SheetJS (window.XLSX), который подключается
// через <script src="https://cdn.jsdelivr.net/.../xlsx.full.min.js"></script>
// в index.html каждой подпрограммы.
//
// В отличие от battery-data-parser.js (который обрабатывает long-format
// «одна точка разряда = одна строка»), здесь каждая строка = одна модель.
// ======================================================================

import { makeUpsId } from './ups-catalog.js';
import { makePanelId } from './panel-catalog.js';
import { makeTransformerId } from './transformer-catalog.js';

const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_\-/]+/g, '');

function findColIdx(headerRow, candidates) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = norm(headerRow[i]);
    for (const cand of candidates) {
      if (h === norm(cand)) return i;
    }
  }
  return -1;
}

function numVal(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-,eE]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function strVal(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Общий движок парсинга. schema описывает:
 *   { columns:    { fieldName: [возможные имена колонок] },
 *     required:   [имена обязательных полей],
 *     toRecord:   (row, filename) => каталожная запись }
 * row — объект { fieldName: rawValue } после мэппинга.
 */
function parseSheet(arrayBuffer, filename, schema) {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error('SheetJS (window.XLSX) не подключён');
  }
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const out = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    // Находим header — первая строка, в которой распознано >= 3 колонок.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const h = rows[i];
      if (!Array.isArray(h)) continue;
      let hit = 0;
      for (const cands of Object.values(schema.columns)) {
        if (findColIdx(h, cands) >= 0) hit++;
      }
      if (hit >= 3) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;

    const header = rows[headerIdx];
    // Мэп fieldName → column index
    const idx = {};
    for (const [field, cands] of Object.entries(schema.columns)) {
      idx[field] = findColIdx(header, cands);
    }
    // Проверяем обязательные
    const missing = (schema.required || []).filter(f => idx[f] < 0);
    if (missing.length) continue; // не тот лист — пропускаем

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => c == null || c === '')) continue;
      // Собираем field → raw value
      const rec = {};
      for (const [field, i] of Object.entries(idx)) {
        rec[field] = i >= 0 ? row[i] : null;
      }
      // Обязательные не пустые
      let ok = true;
      for (const f of (schema.required || [])) {
        const v = rec[f];
        if (v == null || v === '') { ok = false; break; }
      }
      if (!ok) continue;
      const built = schema.toRecord(rec, filename);
      if (built) out.push(built);
    }
  }

  return out;
}

// ========================== UPS ==========================

const UPS_SCHEMA = {
  columns: {
    supplier:     ['Supplier', 'Производитель', 'Brand', 'Бренд'],
    model:        ['Model', 'Модель', 'Артикул', 'Part_Number', 'PN'],
    upsType:      ['Type', 'Тип', 'Ups_Type', 'Configuration'],
    capacityKw:   ['Capacity_kW', 'Capacity', 'P_kW', 'Мощность_кВт', 'Мощность', 'kW'],
    capacityKva:  ['Capacity_kVA', 'kVA', 'S_kVA', 'Мощность_кВА'],
    frameKw:      ['Frame_kW', 'Frame', 'Корпус_кВт'],
    moduleKwRated:['Module_kW', 'Power_Module_kW', 'Мощность_модуля'],
    moduleSlots:  ['Module_Slots', 'Slots', 'Слотов'],
    efficiency:   ['Efficiency', 'КПД', 'Eta', 'Efficiency_Pct'],
    cosPhi:       ['Cos_Phi', 'cosφ', 'PF', 'Power_Factor'],
    vdcMin:       ['Vdc_Min', 'DC_Min', 'Umin_DC', 'Udc_min'],
    vdcMax:       ['Vdc_Max', 'DC_Max', 'Umax_DC', 'Udc_max'],
    inputs:       ['Inputs', 'Вводов', 'N_Inputs'],
    outputs:      ['Outputs', 'Выходов', 'N_Outputs'],
  },
  required: ['supplier', 'model'],
  toRecord(r, filename) {
    const supplier = strVal(r.supplier);
    const model = strVal(r.model);
    if (!supplier || !model) return null;
    // Нормализация upsType: «модульный / modular» → 'modular', иначе monoblock
    const typeRaw = norm(r.upsType);
    const upsType = /modul|моду/.test(typeRaw) ? 'modular' : 'monoblock';
    // kVA → kW через cos φ (если есть kW — используем его)
    let capacityKw = numVal(r.capacityKw);
    const cosPhi = numVal(r.cosPhi) || 0.9;
    if (capacityKw == null) {
      const kva = numVal(r.capacityKva);
      if (kva != null) capacityKw = Math.round(kva * cosPhi);
    }
    // Efficiency — принимаем и дробь (0.96), и проценты (96)
    let eff = numVal(r.efficiency);
    if (eff != null && eff < 1.5) eff = Math.round(eff * 100);
    return {
      id: makeUpsId(supplier, model),
      supplier, model,
      upsType,
      capacityKw: capacityKw || 0,
      frameKw:        numVal(r.frameKw) || null,
      moduleKwRated:  numVal(r.moduleKwRated) || null,
      moduleSlots:    numVal(r.moduleSlots) || null,
      efficiency: eff != null ? eff : 96,
      cosPhi,
      vdcMin:  numVal(r.vdcMin) || 0,
      vdcMax:  numVal(r.vdcMax) || 0,
      inputs:  numVal(r.inputs)  || 1,
      outputs: numVal(r.outputs) || 1,
      source: 'импорт XLSX: ' + filename,
      importedAt: Date.now(),
      custom: false,
    };
  },
};

export function parseUpsXlsx(arrayBuffer, filename = 'ups.xlsx') {
  const out = parseSheet(arrayBuffer, filename, UPS_SCHEMA);
  if (!out.length) throw new Error('В файле не найдено ни одной записи ИБП (ожидаются колонки Supplier / Model / Capacity_kW …)');
  return out;
}

// ========================= PANEL =========================

const PANEL_SCHEMA = {
  columns: {
    supplier:  ['Supplier', 'Производитель', 'Brand'],
    series:    ['Series', 'Серия', 'Line'],
    variant:   ['Variant', 'Variant_PN', 'Артикул', 'Part_Number', 'PN'],
    inNominal: ['In_Nominal', 'In', 'I_Nominal', 'Nominal_A', 'Ном_А', 'Номинал'],
    inputs:    ['Inputs', 'Вводов', 'N_Inputs'],
    outputs:   ['Outputs', 'Отходящих', 'N_Outputs'],
    sections:  ['Sections', 'Секций', 'N_Sections'],
    ipRating:  ['IP', 'IP_Rating', 'Степень_защиты'],
    form:      ['Form', 'Форма', 'Form_Separation'],
    width:     ['Width', 'Ширина', 'W_mm', 'W'],
    height:    ['Height', 'Высота', 'H_mm', 'H'],
    depth:     ['Depth', 'Глубина', 'D_mm', 'D'],
    busbarA:   ['Busbar_A', 'Шинопровод_А', 'Busbar_Nominal'],
    material:  ['Material', 'Материал', 'Enclosure_Material'],
    maxHeatDissipationW: ['Max_Heat_W', 'Max_Pdiss_W', 'Тепло_макс_Вт', 'Heat_Dissipation'],
  },
  required: ['supplier', 'variant'],
  toRecord(r, filename) {
    const supplier = strVal(r.supplier);
    const series   = strVal(r.series);
    const variant  = strVal(r.variant);
    if (!supplier || !variant) return null;
    return {
      id: makePanelId(supplier, series, variant),
      supplier, series, variant,
      inNominal: numVal(r.inNominal) || 0,
      inputs:    numVal(r.inputs)    || 1,
      outputs:   numVal(r.outputs)   || 0,
      sections:  numVal(r.sections)  || 1,
      ipRating:  strVal(r.ipRating)  || 'IP31',
      form:      strVal(r.form)      || '',
      width:     numVal(r.width)     || 0,
      height:    numVal(r.height)    || 0,
      depth:     numVal(r.depth)     || 0,
      busbarA:   numVal(r.busbarA)   || null,
      material:  strVal(r.material)  || 'steel',
      maxHeatDissipationW: numVal(r.maxHeatDissipationW) || 0,
      source: 'импорт XLSX: ' + filename,
      importedAt: Date.now(),
      custom: false,
    };
  },
};

export function parsePanelXlsx(arrayBuffer, filename = 'panels.xlsx') {
  const out = parseSheet(arrayBuffer, filename, PANEL_SCHEMA);
  if (!out.length) throw new Error('В файле не найдено ни одной записи щита (ожидаются колонки Supplier / Series / Variant / In_Nominal …)');
  return out;
}

// ====================== TRANSFORMER ======================

const TRANSFORMER_SCHEMA = {
  columns: {
    supplier:    ['Supplier', 'Производитель', 'Brand'],
    series:      ['Series', 'Серия', 'Type'],
    variant:     ['Variant', 'Артикул', 'Part_Number', 'PN'],
    sKva:        ['S_kVA', 'kVA', 'Мощность_кВА', 'Rated_kVA'],
    uhvKv:       ['Uhv_kV', 'U1_kV', 'HV_kV', 'Первичное_кВ', 'U_HV'],
    ulvV:        ['Ulv_V', 'U2_V', 'LV_V', 'Вторичное_В', 'U_LV'],
    vectorGroup: ['Vector_Group', 'Группа_соединений', 'Group', 'Соединение'],
    ukPct:       ['uk', 'uk_Pct', 'Uk_%', 'Uk'],
    p0Kw:        ['P0_kW', 'P0', 'Losses_No_Load', 'P_XX'],
    pkKw:        ['Pk_kW', 'Pk', 'Losses_Load', 'P_КЗ'],
    cooling:     ['Cooling', 'Охлаждение'],
    insulation:  ['Insulation', 'Изоляция'],
    tempRise:    ['Temp_Rise', 'Перегрев'],
    weight:      ['Weight', 'Масса', 'Масса_кг', 'Weight_kg'],
  },
  required: ['supplier', 'sKva'],
  toRecord(r, filename) {
    const supplier = strVal(r.supplier);
    const series   = strVal(r.series);
    const variant  = strVal(r.variant);
    const sKva     = numVal(r.sKva);
    if (!supplier || sKva == null) return null;
    // Нормализация напряжений: поддержка «0.4 kV» и «400 V»
    let uhvKv = numVal(r.uhvKv) || 0;
    let ulvV  = numVal(r.ulvV)  || 0;
    if (uhvKv > 1000) uhvKv = uhvKv / 1000; // ввод был в вольтах
    if (ulvV < 1)     ulvV  = ulvV * 1000;  // ввод был в киловольтах
    return {
      id: makeTransformerId(supplier, series || variant, sKva),
      supplier, series, variant,
      sKva,
      uhvKv,
      ulvV: ulvV || 400,
      vectorGroup: strVal(r.vectorGroup) || 'Dyn11',
      ukPct:  numVal(r.ukPct)  || 6,
      p0Kw:   numVal(r.p0Kw)   || 0,
      pkKw:   numVal(r.pkKw)   || 0,
      cooling:    strVal(r.cooling)    || 'ONAN',
      insulation: strVal(r.insulation) || 'oil',
      tempRise:   numVal(r.tempRise)   || null,
      weight:     numVal(r.weight)     || null,
      source: 'импорт XLSX: ' + filename,
      importedAt: Date.now(),
      custom: false,
    };
  },
};

export function parseTransformerXlsx(arrayBuffer, filename = 'transformers.xlsx') {
  const out = parseSheet(arrayBuffer, filename, TRANSFORMER_SCHEMA);
  if (!out.length) throw new Error('В файле не найдено ни одной записи трансформатора (ожидаются колонки Supplier / S_kVA / Uhv_kV / Ulv_V …)');
  return out;
}

// ================== Генерация шаблонов ==================
// Возвращают Workbook через SheetJS с заголовком колонок и 2–3 примерами
// строк. Используются кнопкой «⬇ Шаблон XLSX» в каждом конфигураторе,
// чтобы пользователь видел ожидаемый формат до импорта.

function _canonicalHeader(schema) {
  // Первая запись в массиве альтернатив считается каноническим именем
  return Object.fromEntries(Object.entries(schema.columns).map(([k, arr]) => [k, arr[0]]));
}

/**
 * Формирует Workbook с одним листом для указанного каталога.
 * kind: 'ups' | 'panel' | 'transformer'
 */
export function makeCatalogTemplate(kind) {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error('SheetJS (window.XLSX) не подключён');
  }
  let schema, examples, sheetName;
  if (kind === 'ups') {
    schema = UPS_SCHEMA;
    sheetName = 'UPS Catalog';
    examples = [
      { supplier: 'ABB', model: 'PowerValue 11 RT 6 kVA', upsType: 'monoblock', capacityKw: 6, capacityKva: 6, efficiency: 94, cosPhi: 1.0, vdcMin: 192, vdcMax: 240, inputs: 1, outputs: 1 },
      { supplier: 'Schneider', model: 'Galaxy VM 100 kW', upsType: 'monoblock', capacityKw: 100, capacityKva: 100, efficiency: 96, cosPhi: 1.0, vdcMin: 384, vdcMax: 480, inputs: 2, outputs: 2 },
      { supplier: 'Vertiv', model: 'Liebert APM 300', upsType: 'modular', capacityKw: 300, frameKw: 300, moduleKwRated: 30, moduleSlots: 10, efficiency: 96.5, cosPhi: 1.0, vdcMin: 320, vdcMax: 448, inputs: 2, outputs: 2 },
    ];
  } else if (kind === 'panel') {
    schema = PANEL_SCHEMA;
    sheetName = 'Panel Catalog';
    examples = [
      { supplier: 'ABB', series: 'ArTu M', variant: 'M40830', inNominal: 800, inputs: 1, outputs: 24, sections: 1, ipRating: 'IP31', form: 'Form 2b', width: 600, height: 2000, depth: 400 },
      { supplier: 'Schneider', series: 'Prisma P', variant: 'P630-AVR', inNominal: 630, inputs: 2, outputs: 18, sections: 2, ipRating: 'IP54', form: 'Form 3b', width: 800, height: 2100, depth: 600 },
      { supplier: 'KEAZ', series: 'OptiBox', variant: 'OB-P-160', inNominal: 160, inputs: 1, outputs: 12, sections: 1, ipRating: 'IP40', form: 'Form 1', width: 400, height: 600, depth: 200 },
    ];
  } else if (kind === 'transformer') {
    schema = TRANSFORMER_SCHEMA;
    sheetName = 'Transformer Catalog';
    examples = [
      { supplier: 'ABB', series: 'TRIHAL', variant: 'TH 1000', sKva: 1000, uhvKv: 10, ulvV: 400, vectorGroup: 'Dyn11', ukPct: 6, p0Kw: 1.7, pkKw: 9.2, cooling: 'AN', insulation: 'dry', weight: 3200 },
      { supplier: 'Siemens', series: 'GEAFOL', variant: 'GF-1600', sKva: 1600, uhvKv: 10, ulvV: 400, vectorGroup: 'Dyn11', ukPct: 6, p0Kw: 2.4, pkKw: 13.5, cooling: 'AN', insulation: 'epoxy', weight: 4600 },
      { supplier: 'Тольятти', series: 'ТМГ', variant: 'ТМГ-630/10', sKva: 630, uhvKv: 10, ulvV: 400, vectorGroup: 'Dyn11', ukPct: 5.5, p0Kw: 1.05, pkKw: 7.6, cooling: 'ONAN', insulation: 'oil', weight: 2100 },
    ];
  } else {
    throw new Error('makeCatalogTemplate: kind должен быть "ups" | "panel" | "transformer"');
  }
  const canonical = _canonicalHeader(schema);
  const fieldKeys = Object.keys(canonical);
  const header = fieldKeys.map(k => canonical[k]);
  const rows = examples.map(ex => fieldKeys.map(k => ex[k] ?? ''));
  const aoa = [header, ...rows];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  // Ширина колонок по макс. длине заголовка
  ws['!cols'] = header.map(h => ({ wch: Math.max(12, String(h).length + 2) }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/**
 * Генерирует шаблон и скачивает его в браузере.
 */
export function downloadCatalogTemplate(kind) {
  const wb = makeCatalogTemplate(kind);
  const fname = {
    ups:         'ups-catalog-template.xlsx',
    panel:       'panel-catalog-template.xlsx',
    transformer: 'transformer-catalog-template.xlsx',
  }[kind] || 'catalog-template.xlsx';
  window.XLSX.writeFile(wb, fname);
}

// ====================================================================
// Phase 1.2.3: Унифицированный API parseXlsx(buffer, {kind}) → Element[]
// ====================================================================
// Ранее каждая подпрограмма знала свой per-kind парсер и конвертер.
// Теперь все они доступны через один вход: результат сразу в формате
// Element из element-library (через from*Record-конвертеры).
//
// Поддерживаемые kind'ы:
//   - 'ups'         → parseUpsXlsx + fromUpsRecord
//   - 'panel'       → parsePanelXlsx + fromPanelRecord
//   - 'transformer' → parseTransformerXlsx + fromTransformerRecord
//
// Для kind'ов battery / cable-type / cable-sku per-kind парсеры пока
// отсутствуют (в коде они обслуживаются отдельными модулями:
// battery-data-parser, catalog/tab-import для SKU с ценами). Добавить
// в эту же схему можно по мере необходимости.
//
// Возвращает { elements, legacy, errors } где legacy — исходные записи
// (для обратной совместимости с существующими импортёрами через
// addUps/addPanel/addTransformer), а elements — уже сконвертированные
// в формат Element library.
// ====================================================================
const _KIND_TO_PARSER = {
  ups:         parseUpsXlsx,
  panel:       parsePanelXlsx,
  transformer: parseTransformerXlsx,
};

export async function parseXlsx(arrayBuffer, opts = {}) {
  const kind = opts.kind;
  const filename = opts.filename || (kind ? `${kind}.xlsx` : 'catalog.xlsx');
  if (!kind) throw new Error('parseXlsx: требуется opts.kind');
  const parser = _KIND_TO_PARSER[kind];
  if (!parser) {
    throw new Error(`parseXlsx: kind='${kind}' не поддерживается. Доступно: ${Object.keys(_KIND_TO_PARSER).join(', ')}`);
  }
  const legacy = parser(arrayBuffer, filename);
  // Ленивый импорт element-schemas чтобы не тянуть его в загрузки
  // подпрограмм, которые используют только legacy-путь.
  let elements = [];
  const errors = [];
  try {
    const schemas = await import('./element-schemas.js');
    const conv = {
      ups:         schemas.fromUpsRecord,
      panel:       schemas.fromPanelRecord,
      transformer: schemas.fromTransformerRecord,
    }[kind];
    if (typeof conv === 'function') {
      for (const rec of legacy) {
        try { elements.push(conv(rec)); }
        catch (e) { errors.push({ rec, error: e.message }); }
      }
    }
  } catch (e) {
    errors.push({ rec: null, error: 'element-schemas import failed: ' + e.message });
  }
  return { kind, filename, elements, legacy, errors };
}

export function supportedParseXlsxKinds() {
  return Object.keys(_KIND_TO_PARSER);
}
