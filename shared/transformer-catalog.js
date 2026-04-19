// ======================================================================
// shared/transformer-catalog.js
// Справочник силовых трансформаторов. Хранится per-user в localStorage.
// API симметричен battery/ups/panel каталогам.
//
// Схема (TransformerRecord):
//   {
//     id:          string,          // makeTransformerId(supplier, series, sKva)
//     supplier:    string,           // ABB, Siemens, ЭТК, Тольятти, …
//     series:      string,           // TMG, TRIHAL, ТСЗ, TMZ, …
//     variant:     string,           // артикул / типоразмер (опц.)
//     sKva:        number,           // номинальная мощность, кВА
//     uhvKv:       number,           // первичное напряжение, кВ
//     ulvV:        number,           // вторичное напряжение, В
//     vectorGroup: string,           // Y/Δ, например 'Dyn11', 'Yyn0'
//     ukPct:       number,           // напряжение КЗ u_k, %
//     p0Kw:        number,           // потери ХХ, кВт
//     pkKw:        number,           // потери КЗ, кВт
//     cooling:     string,           // 'ONAN' | 'ONAF' | 'AN' | 'AF' | 'dry'
//     insulation:  string,           // 'oil' | 'dry' | 'epoxy' | …
//     tempRise:    number?,          // допустимый перегрев, °C
//     weight:      number?,          // кг
//     source:      string,           // 'ручной ввод' | 'импорт XLSX'
//     importedAt:  number,
//     custom:      boolean,
//   }
// ======================================================================

const LEGACY_KEY = 'raschet.transformerCatalog.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

function _read() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        try { localStorage.setItem(storageKey(), JSON.stringify(arr)); } catch {}
        return arr;
      }
    }
    return [];
  } catch { return []; }
}
function _write(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list || [])); }
  catch (e) { console.error('[transformer-catalog] write failed', e); }
  _notify();
}

// Listeners для same-tab sync (catalog-bridge подписывается).
const _listeners = new Set();
export function onTransformersChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() {
  for (const cb of _listeners) { try { cb(); } catch (e) { console.error('[transformer-catalog] listener', e); } }
}

export function listTransformers() { return _read(); }
export function getTransformer(id) { return _read().find(t => t.id === id) || null; }

export function addTransformer(rec) {
  if (!rec || !rec.id) return;
  const list = _read();
  const idx = list.findIndex(t => t.id === rec.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...rec };
  else list.push(rec);
  _write(list);
}

export function removeTransformer(id) {
  _write(_read().filter(t => t.id !== id));
}

export function clearCatalog() { _write([]); }

export function makeTransformerId(supplier, series, sKva) {
  const parts = [supplier, series, String(sKva || '')].map(s =>
    String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  ).filter(Boolean);
  return parts.join('-') || ('tx-' + Date.now());
}
