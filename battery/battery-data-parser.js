// ======================================================================
// battery-data-parser.js
// Парсинг XLSX-файлов «Battery DataTable» в нормализованный формат
// каталога (battery-catalog.js). Использует глобальный SheetJS (XLSX),
// подключаемый через <script src="…xlsx.full.min.js"></script>.
//
// Поддерживаемый формат входного файла (long-format):
//   Колонки: Battery_Supplier | Battery_Type | Capacity | End_Voltage |
//            Time_Value | Power_Value
//   Каждая строка — одна точка (endV, tMin, powerW) для конкретной модели.
//
// Примеры файлов (см. Battery DataTable/*.xlsx):
//   - Kehua Battery DataTable.xlsx (большой файл с несколькими моделями)
//   - Panasonic_LC-P127R2PG1.xlsx
//   - Sonnenschein_A412_180A.xlsx
//   - SVC VP12100N.xlsx
//
// Если в файле несколько моделей (разные Battery_Type/Supplier в строках),
// парсер создаёт НЕСКОЛЬКО записей каталога — одну на каждую модель.
// ======================================================================

import { makeBatteryId } from './battery-catalog.js';

// Нормализует имя колонки для поиска: убирает пробелы, приводит к lower-case
const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '');

// Ищет индекс колонки по списку возможных имён
function findColIdx(headerRow, candidates) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = norm(headerRow[i]);
    for (const cand of candidates) {
      if (h === norm(cand)) return i;
    }
  }
  return -1;
}

// Эвристическое определение химии по имени модели
function guessChemistry(type) {
  const t = (type || '').toLowerCase();
  if (/li|lfp|lifepo|lithium/.test(t)) return 'li-ion';
  if (/nicd|ni-cd|никад/.test(t)) return 'nicd';
  if (/nimh|никмг/.test(t)) return 'nimh';
  // По умолчанию — свинцово-кислотная (VRLA/AGM/GEL)
  return 'vrla';
}

// Оценка номинального напряжения блока по модели / end-voltage-диапазону.
// Для свинца типичные блоки: 2V, 6V, 12V. 2V end-voltage × 6 cells = 12V block.
function inferBlockVoltage(type, endVs) {
  const t = (type || '').toLowerCase();
  // Явные указатели в имени
  if (/^2v|[^\d]2v/.test(t)) return 2;
  if (/^6v|[^\d]6v/.test(t)) return 6;
  if (/^12v|[^\d]12v|^vp12|[^\d]12/.test(t)) return 12;
  if (/24v/.test(t)) return 24;
  if (/48v/.test(t)) return 48;
  // Эвристика по end-voltage: если все <= 2, то это «на элемент»,
  // и типичный блок — 12V (6 элементов × 2V)
  if (Array.isArray(endVs) && endVs.length) {
    const maxEv = Math.max(...endVs);
    if (maxEv <= 2.1) return 12; // свинец, блоки 12V
  }
  return 12;
}

/**
 * Парсит один ArrayBuffer XLSX-файла в массив записей каталога.
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} filename — имя исходного файла (для source)
 * @returns {Array<Object>} список записей каталога (одна запись на модель)
 */
export function parseBatteryXlsx(arrayBuffer, filename = 'upload.xlsx') {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error('SheetJS (window.XLSX) не подключён');
  }
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const allRows = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    // Находим header — первая строка, где есть хотя бы 3 из наших ключевых колонок
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const h = rows[i];
      if (!Array.isArray(h)) continue;
      const hit = [
        findColIdx(h, ['Battery_Supplier', 'Supplier']),
        findColIdx(h, ['Battery_Type', 'Type', 'Model']),
        findColIdx(h, ['Capacity', 'Ah', 'Capacity_Ah']),
        findColIdx(h, ['End_Voltage', 'EndVoltage', 'V_end', 'Vend']),
        findColIdx(h, ['Time_Value', 'Time', 'Duration', 'TimeMin']),
        findColIdx(h, ['Power_Value', 'Power', 'PowerW', 'P']),
      ].filter(idx => idx >= 0).length;
      if (hit >= 4) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;

    const header = rows[headerIdx];
    const idxSupplier = findColIdx(header, ['Battery_Supplier', 'Supplier']);
    const idxType     = findColIdx(header, ['Battery_Type', 'Type', 'Model']);
    const idxCap      = findColIdx(header, ['Capacity', 'Ah', 'Capacity_Ah']);
    const idxEndV     = findColIdx(header, ['End_Voltage', 'EndVoltage', 'V_end', 'Vend']);
    const idxTime     = findColIdx(header, ['Time_Value', 'Time', 'Duration', 'TimeMin']);
    const idxPower    = findColIdx(header, ['Power_Value', 'Power', 'PowerW', 'P']);

    if (idxType < 0 || idxEndV < 0 || idxTime < 0 || idxPower < 0) continue;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => c == null || c === '')) continue;

      const supplier = idxSupplier >= 0 ? row[idxSupplier] : null;
      const type     = row[idxType];
      const cap      = idxCap >= 0 ? row[idxCap] : null;
      const endV     = Number(row[idxEndV]);
      const tMin     = Number(row[idxTime]);
      const powerW   = row[idxPower] == null ? null : Number(row[idxPower]);

      if (!type || !Number.isFinite(endV) || !Number.isFinite(tMin)) continue;
      if (powerW == null || !Number.isFinite(powerW)) continue;

      allRows.push({
        supplier: supplier ? String(supplier).trim() : 'Unknown',
        type: String(type).trim(),
        capacityAh: cap == null ? null : Number(cap),
        endV, tMin, powerW,
      });
    }
  }

  if (!allRows.length) {
    throw new Error('В файле не найдено ни одной строки данных в ожидаемом формате');
  }

  // Группируем по (supplier, type) → одна запись каталога на модель
  const groups = new Map();
  for (const row of allRows) {
    const key = makeBatteryId(row.supplier, row.type);
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        supplier: row.supplier,
        type: row.type,
        capacityAh: row.capacityAh,
        dischargeTable: [],
      });
    }
    const g = groups.get(key);
    if (g.capacityAh == null && row.capacityAh != null) g.capacityAh = row.capacityAh;
    g.dischargeTable.push({ endV: row.endV, tMin: row.tMin, powerW: row.powerW });
  }

  const out = [];
  for (const g of groups.values()) {
    const endVs = g.dischargeTable.map(p => p.endV);
    const blockVoltage = inferBlockVoltage(g.type, endVs);
    // cellCount = blockVoltage / 2 (для свинца; у Li-Ion оценивается иначе — TODO)
    const cellCount = Math.round(blockVoltage / 2) || 6;
    const cellVoltage = 2.0;
    // Сортируем таблицу разряда для стабильного порядка
    g.dischargeTable.sort((a, b) => (a.endV - b.endV) || (a.tMin - b.tMin));
    out.push({
      ...g,
      chemistry: guessChemistry(g.type),
      blockVoltage,
      cellCount,
      cellVoltage,
      source: filename,
      importedAt: Date.now(),
    });
  }
  return out;
}
