// ======================================================================
// shared/panel-catalog.js
// Справочник щитовых оболочек (корпусов). Хранится per-user в localStorage.
// API симметричен battery/ups каталогам.
//
// ⚠ АРХИТЕКТУРА: с v0.41 справочник — это только каталог ОБОЛОЧЕК (корпусов).
// Проектная конфигурация (inputs/outputs/sections) задаётся на УЗЛЕ щита в
// конкретной схеме, а не хранится в каталоге. Поля inputs/outputs/sections
// помечены DEPRECATED и будут убраны в Фазе 1 (Element Library).
//
// Схема записи (PanelRecord — оболочка):
//   {
//     id:           string,         // makePanelId(supplier, series, variant)
//     supplier:     string,         // ABB, Schneider, KEAZ, ИЭК, …
//     series:       string,         // ArTu M, Prisma, OptiBox, …
//     variant:      string,         // типоразмер / артикул
//     inNominal:    number,         // номинал вводного (пропускной), А
//     ipRating:     string,         // 'IP31' | 'IP54' | ...
//     form:         string,         // внутренняя форма разделения (IEC 61439)
//     width:        number,         // мм
//     height:       number,         // мм
//     depth:        number,         // мм
//     busbarA:      number?,        // номинал шин, А (опционально)
//     material:     string,         // 'steel' | 'polymer' | 'stainless' (новое)
//     maxHeatDissipationW: number,  // максимально рассеиваемая мощность, Вт (новое)
//                                   // Для теплового расчёта (Фаза 6, IEC 60890/61439)
//     source:       string,         // 'ручной ввод' | 'imported'
//     importedAt:   number,
//     custom:       boolean,
//     // DEPRECATED — проектная конфигурация, будет на узле щита:
//     inputs?:      number,         // DEPRECATED
//     outputs?:     number,         // DEPRECATED
//     sections?:    number,         // DEPRECATED
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
  _notify();
}

// Listeners для same-tab sync (catalog-bridge подписывается, чтобы
// element-library видела изменения сразу, без перезагрузки).
const _listeners = new Set();
export function onPanelsChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() {
  for (const cb of _listeners) { try { cb(); } catch (e) { console.error('[panel-catalog] listener', e); } }
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
