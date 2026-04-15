// ======================================================================
// shared/panel-catalog.js
// Справочник типовых щитов (распределительных, главных, АВР). Хранится
// per-user в localStorage. API симметричен battery/ups каталогам.
//
// Схема записи (PanelRecord):
//   {
//     id:         string,          // makePanelId(supplier, series, variant)
//     supplier:   string,           // ABB, Schneider, KEAZ, ИЭК, …
//     series:     string,           // ArTu M, Prisma, OptiBox, …
//     variant:    string,           // типоразмер / артикул
//     inNominal:  number,           // номинал вводного, А
//     inputs:     number,           // число вводов (1 — простой, 2 — АВР)
//     outputs:    number,           // число отходящих полей
//     sections:   number,           // секций (1 — одно, ≥2 — секционированный)
//     ipRating:   string,           // 'IP31' | 'IP54' | ...
//     form:       string,           // внутренняя форма разделения (IEC 61439)
//     width:      number,           // мм (опционально)
//     height:     number,           // мм
//     depth:      number,           // мм
//     busbarA:    number?,          // если шинопровод — его номинал, А
//     source:     string,           // 'ручной ввод'
//     importedAt: number,
//     custom:     boolean,
//   }
// ======================================================================

const LEGACY_KEY = 'raschet.panelCatalog.v1';

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
  catch (e) { console.error('[panel-catalog] write failed', e); }
}

export function listPanels() { return _read(); }
export function getPanel(id) { return _read().find(p => p.id === id) || null; }

export function addPanel(rec) {
  if (!rec || !rec.id) return;
  const list = _read();
  const idx = list.findIndex(p => p.id === rec.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...rec };
  else list.push(rec);
  _write(list);
}

export function removePanel(id) {
  _write(_read().filter(p => p.id !== id));
}

export function clearCatalog() { _write([]); }

export function makePanelId(supplier, series, variant) {
  const parts = [supplier, series, variant].map(s =>
    String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  ).filter(Boolean);
  return parts.join('-') || ('panel-' + Date.now());
}
