// ======================================================================
// shared/counterparty-catalog.js
// Каталог контрагентов (поставщики, производители, дилеры, логисты).
//
// Используется в catalog/ для привязки цен к источнику, в logistics/ для
// выбора перевозчика/склада, в reports/ для оформления КП и ТТН.
//
// Схема CounterpartyRecord:
//   {
//     id:         string,       // makeCounterpartyId(name, inn)
//     name:       string,       // полное / фирменное название
//     shortName:  string,       // сокращённое (для таблиц)
//     inn:        string,       // ИНН (10 или 12 знаков)
//     kpp:        string,       // КПП (9 знаков, для юр. лиц)
//     type:       'supplier' | 'manufacturer' | 'dealer' | 'logistics' |
//                 'warehouse' | 'customer' | 'other',
//     address:    string,       // юридический адрес
//     deliveryAddress: string,  // адрес склада/самовывоза
//     phone:      string,
//     email:      string,
//     website:    string,
//     contacts: [               // ответственные лица
//       { name, position, phone, email }
//     ],
//     paymentTerms: string,     // 'предоплата' | 'оплата по факту' | '30 дней' | …
//     currency:   string,       // основная валюта расчётов 'RUB'|'USD'|'EUR'|'CNY'
//     discount:   number,       // % индивидуальной скидки
//     tags:       string[],     // 'основной', 'Китай', 'дистрибьютор ABB'
//     notes:      string,
//     source:     'manual' | 'imported',
//     createdAt:  number,
//     updatedAt:  number,
//   }
// ======================================================================

const LEGACY_KEY = 'raschet.counterparties.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

export const COUNTERPARTY_TYPES = {
  supplier:     { label: 'Поставщик',     icon: '📦' },
  manufacturer: { label: 'Производитель', icon: '🏭' },
  dealer:       { label: 'Дилер',         icon: '🏪' },
  logistics:    { label: 'Логистика',     icon: '🚚' },
  warehouse:    { label: 'Склад',         icon: '🏢' },
  customer:     { label: 'Заказчик',      icon: '👤' },
  other:        { label: 'Прочее',        icon: '—' },
};

function _read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    return [];
  } catch { return []; }
}

function _write(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list || [])); }
  catch (e) { console.error('[counterparty-catalog] write failed', e); }
  _notify();
}

const _listeners = new Set();
export function onCounterpartiesChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() {
  for (const cb of _listeners) { try { cb(); } catch (e) { console.error('[counterparty] listener', e); } }
}

// ——— Public API ———

export function listCounterparties(filter = {}) {
  let list = _read();
  if (filter.type) list = list.filter(c => c.type === filter.type);
  if (filter.tag) list = list.filter(c => Array.isArray(c.tags) && c.tags.includes(filter.tag));
  if (filter.search) {
    const q = filter.search.toLowerCase();
    list = list.filter(c => {
      const hay = [c.name, c.shortName, c.inn, c.kpp, c.address, c.phone, c.email]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

export function getCounterparty(id) {
  return _read().find(c => c.id === id) || null;
}

export function saveCounterparty(rec) {
  if (!rec) throw new Error('[counterparty] record required');
  if (!rec.name) throw new Error('[counterparty] name required');
  if (!rec.id) rec.id = makeCounterpartyId(rec.name, rec.inn);
  if (!rec.type) rec.type = 'supplier';
  if (!COUNTERPARTY_TYPES[rec.type]) throw new Error('[counterparty] invalid type: ' + rec.type);
  const list = _read();
  const now = Date.now();
  const idx = list.findIndex(c => c.id === rec.id);
  const saved = {
    ...rec,
    createdAt: (idx >= 0 ? list[idx].createdAt : now),
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = saved;
  else list.push(saved);
  _write(list);
  return saved;
}

export function removeCounterparty(id) {
  const list = _read();
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  _write(list);
  return true;
}

export function clearCatalog() { _write([]); }

/** Детерминированный id: name+inn → kebab-case. */
export function makeCounterpartyId(name, inn) {
  const parts = [name, inn].map(s =>
    String(s || '').trim().toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi, '-').replace(/^-+|-+$/g, '')
  ).filter(Boolean);
  return parts.join('-') || ('cp-' + Date.now());
}

/** Валидация ИНН (10 или 12 цифр). Возвращает true/false. */
export function validateInn(inn) {
  if (!inn) return true; // ИНН опционален
  const s = String(inn).replace(/\s/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(s)) return false;
  // TODO: добавить проверку контрольной суммы (опционально)
  return true;
}
