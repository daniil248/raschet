// ======================================================================
// shared/ups-catalog.js
// Справочник моделей ИБП. По структуре и ключам хранения идентичен
// shared/battery-picker — каждый пользователь имеет свой экземпляр
// каталога в localStorage ('raschet.upsCatalog.v1.<uid>'), а данные
// между подпрограммами (ups-config, главная схема) не пересекаются
// случайно.
//
// Схема записи каталога (UpsRecord):
//   {
//     id:            string,     // makeUpsId(supplier, model)
//     supplier:      string,     // производитель (ABB, Schneider, …)
//     model:         string,     // модель / артикул
//     upsType:       'monoblock' | 'modular',
//     capacityKw:    number,     // номинал (для модульного = макс. frame)
//     frameKw:       number?,    // корпус (для модульного)
//     moduleKwRated: number?,    // мощность модуля
//     moduleSlots:   number?,    // слотов в корпусе
//     efficiency:    number,     // % (КПД DC–AC на номинале)
//     cosPhi:        number,     // cos φ номинальный
//     vdcMin:        number,     // В (минимум на шине DC)
//     vdcMax:        number,     // В (максимум на шине DC)
//     inputs:        number,     // 1 | 2
//     outputs:       number,     // число выходных портов
//     source:        string,     // 'ручной ввод' | 'импорт XLSX' | …
//     importedAt:    number,     // timestamp
//     custom:        boolean,    // true = созданная пользователем запись
//                                //        (редактируемая / удаляемая)
//   }
//
// API идентичен battery-catalog.js:
//   listUpses()      — массив всех записей (текущего пользователя)
//   getUps(id)       — одна запись
//   addUps(record)   — upsert (по id)
//   removeUps(id)    — удаление
//   clearCatalog()   — полная очистка per-user
//   makeUpsId(s, m)  — детерминированный id от supplier+model
// ======================================================================

const LEGACY_KEY = 'raschet.upsCatalog.v1';

function currentUserId() {
  try {
    return localStorage.getItem('raschet.currentUserId') || 'anonymous';
  } catch { return 'anonymous'; }
}

function storageKey() {
  return LEGACY_KEY + '.' + currentUserId();
}

function _read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    // Legacy fallback — читаем старый общий ключ и мигрируем на per-user
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        try { localStorage.setItem(storageKey(), JSON.stringify(arr)); } catch {}
        return arr;
      }
    }
    return [];
  } catch {
    return [];
  }
}

function _write(list) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list || []));
  } catch (e) {
    console.error('[ups-catalog] write failed', e);
  }
}

export function listUpses() {
  return _read();
}

export function getUps(id) {
  return _read().find(u => u.id === id) || null;
}

export function addUps(record) {
  if (!record || !record.id) return;
  const list = _read();
  const idx = list.findIndex(u => u.id === record.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...record };
  else list.push(record);
  _write(list);
}

export function removeUps(id) {
  const list = _read().filter(u => u.id !== id);
  _write(list);
}

export function clearCatalog() {
  _write([]);
}

// Детерминированный id: supplier-model, приведённый к kebab-case.
// Стабилен между вызовами (одинаковый supplier/model → одинаковый id).
export function makeUpsId(supplier, model) {
  const s = String(supplier || '').trim().toLowerCase();
  const m = String(model || '').trim().toLowerCase();
  return (s + '-' + m).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ups-' + Date.now();
}
