// ======================================================================
// shared/logistics-schemas.js
// Схемы данных для модуля «Рабочее место логиста» (Фаза 1.6).
//
// Хранилище — per-user localStorage:
//   raschet.warehouses.v1.<uid>
//   raschet.shipments.v1.<uid>
//   raschet.carrierRates.v1.<uid>
//
// API симметричен другим каталогам: list / get / save / remove + onChange.
// ======================================================================

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}

// ==================== WarehouseRecord ====================
// { id, name, counterpartyId?, type, address, capacityM3?, costPerM3Day?, leadDays? }
// type: 'own' | 'rented' | 'supplier' | 'customer' | 'transit'

const WH_KEY_BASE = 'raschet.warehouses.v1';
function _whKey() { return WH_KEY_BASE + '.' + currentUserId(); }

export const WAREHOUSE_TYPES = {
  own:      { label: 'Свой склад', icon: '🏭' },
  rented:   { label: 'Арендованный', icon: '🏢' },
  supplier: { label: 'Склад поставщика', icon: '📦' },
  customer: { label: 'Склад заказчика', icon: '🏗' },
  transit:  { label: 'Транзитный', icon: '🚚' },
};

function _whRead() {
  try { const r = localStorage.getItem(_whKey()); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function _whWrite(list) {
  try { localStorage.setItem(_whKey(), JSON.stringify(list)); } catch (e) { console.error('[warehouses]', e); }
  for (const cb of _whListeners) { try { cb(); } catch {} }
}
const _whListeners = new Set();
export function onWarehousesChange(cb) { _whListeners.add(cb); return () => _whListeners.delete(cb); }

export function listWarehouses(filter = {}) {
  let list = _whRead();
  if (filter.type) list = list.filter(w => w.type === filter.type);
  if (filter.counterpartyId) list = list.filter(w => w.counterpartyId === filter.counterpartyId);
  return list;
}
export function getWarehouse(id) { return _whRead().find(w => w.id === id) || null; }
export function saveWarehouse(rec) {
  if (!rec || !rec.name) throw new Error('[warehouse] name required');
  if (!rec.id) rec.id = 'wh-' + Date.now().toString(36);
  if (!rec.type) rec.type = 'own';
  const list = _whRead();
  const idx = list.findIndex(w => w.id === rec.id);
  const now = Date.now();
  const saved = { ...rec, createdAt: idx >= 0 ? list[idx].createdAt : now, updatedAt: now };
  if (idx >= 0) list[idx] = saved; else list.push(saved);
  _whWrite(list);
  return saved;
}
export function removeWarehouse(id) {
  const list = _whRead().filter(w => w.id !== id);
  _whWrite(list);
}

// ==================== CarrierRate ====================
// Тариф перевозки: { id, carrierId, mode, unitRUB, perKg?, perKm?, perM3?, minOrder?, note? }
// mode: 'road' | 'rail' | 'air' | 'sea' | 'express' | 'pickup'

const CR_KEY_BASE = 'raschet.carrierRates.v1';
function _crKey() { return CR_KEY_BASE + '.' + currentUserId(); }

export const SHIPMENT_MODES = {
  road:    { label: 'Авто', icon: '🚚' },
  rail:    { label: 'ЖД',    icon: '🚂' },
  air:     { label: 'Авиа',  icon: '✈' },
  sea:     { label: 'Море',  icon: '🚢' },
  express: { label: 'Экспресс', icon: '📦' },
  pickup:  { label: 'Самовывоз', icon: '🤝' },
};

function _crRead() {
  try { const r = localStorage.getItem(_crKey()); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function _crWrite(list) {
  try { localStorage.setItem(_crKey(), JSON.stringify(list)); } catch (e) { console.error('[rates]', e); }
  for (const cb of _crListeners) { try { cb(); } catch {} }
}
const _crListeners = new Set();
export function onCarrierRatesChange(cb) { _crListeners.add(cb); return () => _crListeners.delete(cb); }

export function listCarrierRates(filter = {}) {
  let list = _crRead();
  if (filter.mode) list = list.filter(r => r.mode === filter.mode);
  if (filter.carrierId) list = list.filter(r => r.carrierId === filter.carrierId);
  return list;
}
export function getCarrierRate(id) { return _crRead().find(r => r.id === id) || null; }
export function saveCarrierRate(rec) {
  if (!rec) throw new Error('[rate] record required');
  if (!rec.id) rec.id = 'cr-' + Date.now().toString(36);
  if (!rec.mode) rec.mode = 'road';
  const list = _crRead();
  const idx = list.findIndex(r => r.id === rec.id);
  const now = Date.now();
  const saved = { ...rec, createdAt: idx >= 0 ? list[idx].createdAt : now, updatedAt: now };
  if (idx >= 0) list[idx] = saved; else list.push(saved);
  _crWrite(list);
  return saved;
}
export function removeCarrierRate(id) {
  const list = _crRead().filter(r => r.id !== id);
  _crWrite(list);
}

// ==================== ShipmentRecord ====================
// { id, projectId?, label, status, mode, carrierId?, originId?, destinationId?,
//   items: [{ elementId?, label, qty, unitKg, unitM3, unitPriceRUB }],
//   cost, currency, plannedAt?, deliveredAt?, notes? }

const SH_KEY_BASE = 'raschet.shipments.v1';
function _shKey() { return SH_KEY_BASE + '.' + currentUserId(); }

export const SHIPMENT_STATUSES = {
  draft:     { label: 'Черновик', icon: '📝', color: '#888' },
  planned:   { label: 'Запланировано', icon: '📅', color: '#1976d2' },
  shipped:   { label: 'Отправлено', icon: '🚚', color: '#f57c00' },
  delivered: { label: 'Доставлено', icon: '✓', color: '#2e7d32' },
  cancelled: { label: 'Отменено', icon: '✗', color: '#cf222e' },
};

function _shRead() {
  try { const r = localStorage.getItem(_shKey()); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function _shWrite(list) {
  try { localStorage.setItem(_shKey(), JSON.stringify(list)); } catch (e) { console.error('[shipments]', e); }
  for (const cb of _shListeners) { try { cb(); } catch {} }
}
const _shListeners = new Set();
export function onShipmentsChange(cb) { _shListeners.add(cb); return () => _shListeners.delete(cb); }

export function listShipments(filter = {}) {
  let list = _shRead();
  if (filter.status) list = list.filter(s => s.status === filter.status);
  if (filter.projectId) list = list.filter(s => s.projectId === filter.projectId);
  return list.sort((a, b) => (b.plannedAt || b.createdAt || 0) - (a.plannedAt || a.createdAt || 0));
}
export function getShipment(id) { return _shRead().find(s => s.id === id) || null; }
export function saveShipment(rec) {
  if (!rec) throw new Error('[shipment] record required');
  if (!rec.id) rec.id = 'sh-' + Date.now().toString(36);
  if (!rec.status) rec.status = 'draft';
  if (!Array.isArray(rec.items)) rec.items = [];
  const list = _shRead();
  const idx = list.findIndex(s => s.id === rec.id);
  const now = Date.now();
  const saved = { ...rec, createdAt: idx >= 0 ? list[idx].createdAt : now, updatedAt: now };
  if (idx >= 0) list[idx] = saved; else list.push(saved);
  _shWrite(list);
  return saved;
}
export function removeShipment(id) {
  const list = _shRead().filter(s => s.id !== id);
  _shWrite(list);
}

// ==================== Калькулятор стоимости перевозки ====================
/**
 * Рассчитать стоимость перевозки по тарифу для items.
 * shipment.items = [{ unitKg, unitM3, qty }]
 * rate: { unitRUB?, perKg?, perKm?, perM3?, minOrder? }
 * opts: { distanceKm? }
 * Возвращает { subtotal, breakdown: { fixed, perKg, perKm, perM3 }, totalKg, totalM3 }
 */
export function calcShipmentCost(items, rate, opts = {}) {
  const totalKg = items.reduce((s, it) => s + (Number(it.unitKg) || 0) * (Number(it.qty) || 1), 0);
  const totalM3 = items.reduce((s, it) => s + (Number(it.unitM3) || 0) * (Number(it.qty) || 1), 0);
  const dist = Number(opts.distanceKm) || 0;
  const breakdown = {
    fixed: Number(rate.unitRUB) || 0,
    perKg: (Number(rate.perKg) || 0) * totalKg,
    perKm: (Number(rate.perKm) || 0) * dist,
    perM3: (Number(rate.perM3) || 0) * totalM3,
  };
  let subtotal = breakdown.fixed + breakdown.perKg + breakdown.perKm + breakdown.perM3;
  const minOrder = Number(rate.minOrder) || 0;
  if (minOrder > 0 && subtotal < minOrder) subtotal = minOrder;
  return { subtotal, breakdown, totalKg, totalM3 };
}
