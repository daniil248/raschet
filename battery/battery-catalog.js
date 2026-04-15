// ======================================================================
// battery-catalog.js
// Справочник АКБ, сохраняемый в localStorage. Независимый модуль —
// может использоваться из любой подпрограммы Raschet (разряд АКБ в
// standalone-режиме, выбор АКБ в инспекторе ИБП и т.п.).
//
// Формат записи (нормализованный long-format):
// {
//   id: 'sup_type',                         // уникальный ID (supplier_type)
//   supplier: 'Kehua',                      // производитель
//   type: '6-GFM150',                       // модель
//   chemistry: 'vrla' | 'li-ion' | 'nicd',  // химия (если известна)
//   capacityAh: 150,                        // номинальная ёмкость блока, А·ч
//   blockVoltage: 12,                       // номинальное напряжение блока, В
//   cellCount: 6,                           // число элементов в блоке (12V/2V = 6)
//   cellVoltage: 2.0,                       // номинальное напряжение элемента
//   // Таблица «постоянной мощности разряда» — массив точек:
//   //   { endV: 1.6, tMin: 5, powerW: 4590 }
//   // endV — напряжение на элемент в конце разряда, tMin — длительность
//   // разряда (мин), powerW — мощность на БЛОК (W), которую может отдать
//   // батарея при этих условиях.
//   dischargeTable: [
//     { endV: 1.6, tMin: 5, powerW: 4590 },
//     ...
//   ],
//   source: 'Panasonic_LC-P127R2PG1.xlsx',  // файл-источник
//   importedAt: 1700000000000,              // timestamp импорта
// }
// ======================================================================

// Ключ общего (legacy) хранилища — используется для чтения старых
// данных и как fallback если пользователь не авторизован.
const LEGACY_KEY = 'raschet.batteryCatalog.v1';

// Текущий пользователь берётся из Auth-кэша (localStorage,
// устанавливается в main.js на auth onChange). Если пользователя
// нет — 'anonymous'. Per-user ключ: 'raschet.batteryCatalog.v1.<uid>'.
function currentUserId() {
  try {
    return localStorage.getItem('raschet.currentUserId') || 'anonymous';
  } catch { return 'anonymous'; }
}

function storageKey() {
  return LEGACY_KEY + '.' + currentUserId();
}

function load() {
  try {
    // Сначала пробуем per-user ключ
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    // Fallback: legacy-ключ (для миграции с старой версии)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        // Миграция: копируем legacy в per-user и НЕ удаляем legacy
        // (другие пользователи увидят тот же начальный набор).
        try { localStorage.setItem(storageKey(), legacy); } catch {}
        return arr;
      }
    }
    return [];
  } catch (e) {
    console.warn('[battery-catalog] load failed', e);
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list));
  } catch (e) {
    console.warn('[battery-catalog] save failed', e);
  }
}

export function listBatteries() {
  return load();
}

export function getBattery(id) {
  const list = load();
  return list.find(b => b.id === id) || null;
}

export function addBattery(entry) {
  if (!entry || !entry.id) throw new Error('battery must have id');
  const list = load();
  const idx = list.findIndex(b => b.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  save(list);
  return entry;
}

export function removeBattery(id) {
  const list = load();
  const next = list.filter(b => b.id !== id);
  save(next);
}

export function clearCatalog() {
  save([]);
}

// Уникальный ID из supplier + type
export function makeBatteryId(supplier, type) {
  const s = (supplier || 'unknown').toString().trim().toLowerCase().replace(/\s+/g, '_');
  const t = (type || 'unknown').toString().trim().toLowerCase().replace(/\s+/g, '_');
  return `${s}__${t}`;
}
