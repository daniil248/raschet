// =============================================================================
// service/catalog/materials.js — каталог расходных материалов сервиса
// =============================================================================
// Phase 32.2 (по требованию: «не хватает каталога расходных материалов с
// привязкой к видам работ или конкретному оборудованию»).
//
// Структура material:
//   {
//     id, name, sku?, category, unit,
//     defaultPrice: { value, currency },
//     vendor?, datasheet?,
//     compatibleEquipment: [],  // 'chiller' | 'crac' | 'dx' | 'ups' | 'pdu' | 'panel' | ...
//     workTypes: [],            // 'install-refrigerant' | 'maint-filters' | 'maint-oil' | ...
//                               // совпадает с sourceRef.kind в order-builder
//     consumptionRate?: { perKw: 0.05, unit: 'кг/кВт' },  // напр. R410A: 50г/кВт
//     notes?: '',
//   }
//
// Pure JS / LS utility wrappers + pub/sub.

const LS_USER_MATERIALS = 'raschet.service.materials.user.v1';

/**
 * Seed-каталог встроенных материалов. Read-only — пользователь может СКОПИРОВАТЬ
 * материал в свой каталог через UI и редактировать копию.
 *
 * Цены в валюте по умолчанию для категории (DEFAULT_CURRENCY_BY_CATEGORY).
 * Хладагенты и оборудование — USD ($), масла/фильтры/расходники — ₸.
 */
export const SEED_MATERIALS = [
  // ===== Хладагенты =====
  { id: 'seed-mat-r410a', name: 'Хладагент R410A', sku: 'R410A-1KG',
    category: 'material', unit: 'кг',
    defaultPrice: { value: 12, currency: '$' },
    compatibleEquipment: ['chiller', 'dx', 'crac'],
    workTypes: ['install-refrigerant', 'maint-refrigerant'],
    consumptionRate: { perKw: 0.05, unit: 'кг/кВт' },
    notes: 'GWP 2088 — перспективная замена R32. F-Gas regulation в EU.' },
  { id: 'seed-mat-r32', name: 'Хладагент R32', sku: 'R32-1KG',
    category: 'material', unit: 'кг',
    defaultPrice: { value: 14, currency: '$' },
    compatibleEquipment: ['chiller', 'dx'],
    workTypes: ['install-refrigerant', 'maint-refrigerant'],
    consumptionRate: { perKw: 0.04, unit: 'кг/кВт' },
    notes: 'GWP 675 — современный mildly flammable (A2L). Требует обучения.' },
  { id: 'seed-mat-r134a', name: 'Хладагент R134a', sku: 'R134A-1KG',
    category: 'material', unit: 'кг',
    defaultPrice: { value: 18, currency: '$' },
    compatibleEquipment: ['chiller'],
    workTypes: ['install-refrigerant', 'maint-refrigerant'],
    consumptionRate: { perKw: 0.06, unit: 'кг/кВт' },
    notes: 'GWP 1430 — для centrifugal chillers, постепенно phase-down.' },
  { id: 'seed-mat-r290', name: 'Хладагент R290 (пропан)', sku: 'R290-1KG',
    category: 'material', unit: 'кг',
    defaultPrice: { value: 8, currency: '$' },
    compatibleEquipment: ['dx', 'small-chiller'],
    workTypes: ['install-refrigerant', 'maint-refrigerant'],
    consumptionRate: { perKw: 0.025, unit: 'кг/кВт' },
    notes: 'GWP 3 — будущее. A3 — высокая пожароопасность, ограничения по charge.' },

  // ===== Масла / запчасти компрессоров =====
  { id: 'seed-mat-pol-oil', name: 'Масло POE для R410A/R32', sku: 'POE-1L',
    category: 'material', unit: 'л',
    defaultPrice: { value: 8000, currency: '₸' },
    compatibleEquipment: ['chiller', 'dx', 'crac'],
    workTypes: ['maint-oil'],
    notes: 'Полиэфирное масло — гигроскопично, требует контроля влаги.' },
  { id: 'seed-mat-pag-oil', name: 'Масло PAG (для CO₂-систем)', sku: 'PAG-1L',
    category: 'material', unit: 'л',
    defaultPrice: { value: 12000, currency: '₸' },
    compatibleEquipment: ['chiller'],
    workTypes: ['maint-oil'],
    notes: 'Полиалкиленгликоль — для R744 транскритических циклов.' },

  // ===== Воздушные фильтры =====
  { id: 'seed-mat-filter-g4', name: 'Фильтр воздушный G4 (594×594×48мм)', sku: 'F-G4-594',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 1500, currency: '₸' },
    compatibleEquipment: ['crac', 'ahu'],
    workTypes: ['maint-filters'],
    notes: 'Грубой очистки. Менять при ΔP ≥ 250 Па или раз в квартал.' },
  { id: 'seed-mat-filter-f7', name: 'Фильтр воздушный F7 (594×594×592мм)', sku: 'F-F7-594',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 8000, currency: '₸' },
    compatibleEquipment: ['crac', 'ahu'],
    workTypes: ['maint-filters'],
    notes: 'Тонкой очистки. Стандарт для серверных. Менять при ΔP ≥ 450 Па.' },
  { id: 'seed-mat-filter-h13', name: 'Фильтр HEPA H13 (594×594×292мм)', sku: 'F-H13-594',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 35000, currency: '₸' },
    compatibleEquipment: ['crac', 'ahu'],
    workTypes: ['maint-filters'],
    notes: '99.95% эффективность 0.3 мкм. Чистые комнаты, медицина.' },

  // ===== Сухие охладители / трубопроводы =====
  { id: 'seed-mat-glycol', name: 'Гликоль этиленовый (концентрат)', sku: 'GLYCOL-EG-25L',
    category: 'material', unit: 'л',
    defaultPrice: { value: 800, currency: '₸' },
    compatibleEquipment: ['chiller', 'drycooler'],
    workTypes: ['install-pipework', 'maint-glycol-refill'],
    consumptionRate: { perKw: 0.8, unit: 'л/кВт (раствор 35%)' },
    notes: 'Антифриз для drycooler/free-cooling-loop. Концентрация 30-50% по T_min.' },
  { id: 'seed-mat-pipe-cu-22', name: 'Труба медная ø22мм (отожжённая)', sku: 'CU-22-1M',
    category: 'material', unit: 'м',
    defaultPrice: { value: 3500, currency: '₸' },
    compatibleEquipment: ['chiller', 'dx'],
    workTypes: ['install-pipework'],
    notes: 'Для freon-линий. Толщина стенки 1.0-1.5мм.' },
  { id: 'seed-mat-insulation-19', name: 'Изоляция Armaflex 19мм (рулон)', sku: 'INS-19-1M',
    category: 'material', unit: 'м',
    defaultPrice: { value: 2500, currency: '₸' },
    compatibleEquipment: ['chiller', 'dx', 'crac'],
    workTypes: ['install-pipework'],
    notes: 'Для холодильных линий. K-class non-fire-spread.' },

  // ===== ИБП / АКБ =====
  { id: 'seed-mat-bat-12v100', name: 'АКБ 12V 100Ah (VRLA AGM)', sku: 'BAT-12V100',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 95, currency: '$' },
    compatibleEquipment: ['ups'],
    workTypes: ['install-battery', 'maint-battery-replace'],
    notes: 'Срок службы 5-7 лет. Менять полным комплектом.' },
  { id: 'seed-mat-bat-li-100', name: 'АКБ Li-ion 48V 100Ah (LiFePO4)', sku: 'BAT-LI-48V100',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 1200, currency: '$' },
    compatibleEquipment: ['ups'],
    workTypes: ['install-battery'],
    notes: 'Срок службы 10-15 лет. Дороже VRLA, но меньше TCO.' },
  { id: 'seed-mat-ups-fan', name: 'Вентилятор охлаждения ИБП (запчасть)', sku: 'UPS-FAN-001',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 15000, currency: '₸' },
    compatibleEquipment: ['ups'],
    workTypes: ['maint-ups-fan-replace'],
    notes: 'Заменяется при шуме / превышении T_internal.' },

  // ===== ДГУ =====
  { id: 'seed-mat-dgu-oil', name: 'Масло моторное дизель (15W-40)', sku: 'OIL-15W40-1L',
    category: 'material', unit: 'л',
    defaultPrice: { value: 1800, currency: '₸' },
    compatibleEquipment: ['dgu'],
    workTypes: ['maint-dgu-oil'],
    consumptionRate: { perKw: 0.015, unit: 'л/кВт (на одну смену)' },
    notes: 'Замена раз в 250-500 ч наработки или раз в год.' },
  { id: 'seed-mat-dgu-oil-filter', name: 'Фильтр масляный ДГУ', sku: 'DGU-OIL-FILT',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 6000, currency: '₸' },
    compatibleEquipment: ['dgu'],
    workTypes: ['maint-dgu-oil'],
    notes: 'Меняется вместе с маслом.' },
  { id: 'seed-mat-dgu-fuel-filter', name: 'Фильтр топливный ДГУ', sku: 'DGU-FUEL-FILT',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 8000, currency: '₸' },
    compatibleEquipment: ['dgu'],
    workTypes: ['maint-dgu-fuel'],
    notes: 'Меняется раз в 500-1000 ч наработки.' },
  { id: 'seed-mat-dgu-air-filter', name: 'Фильтр воздушный ДГУ', sku: 'DGU-AIR-FILT',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 12000, currency: '₸' },
    compatibleEquipment: ['dgu'],
    workTypes: ['maint-dgu-air'],
    notes: 'Раз в год или при загрязнении.' },

  // ===== СКС / IT-кабели =====
  { id: 'seed-mat-patch-cat6a', name: 'Патч-корд UTP Cat6A 2м', sku: 'PATCH-CAT6A-2M',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 1800, currency: '₸' },
    compatibleEquipment: ['scs'],
    workTypes: ['install-scs', 'maint-scs-recable'],
    notes: '10G на 100м. Stranded copper.' },
  { id: 'seed-mat-fiber-om4', name: 'Патч-корд OM4 LC-LC duplex 3м', sku: 'PATCH-OM4-3M',
    category: 'material', unit: 'шт',
    defaultPrice: { value: 4500, currency: '₸' },
    compatibleEquipment: ['scs'],
    workTypes: ['install-scs'],
    notes: '40G на 150м, 100G на 100м. Aqua-color jacket.' },
];

/* ---------- LS persistence + CRUD ---------- */

function loadUserMaterials() {
  try {
    const raw = localStorage.getItem(LS_USER_MATERIALS);
    return raw ? (JSON.parse(raw) || []) : [];
  } catch { return []; }
}

function saveUserMaterials(arr) {
  try {
    localStorage.setItem(LS_USER_MATERIALS, JSON.stringify(arr || []));
    _notifyChange();
  } catch {}
}

/**
 * Получить ВСЕ материалы (seed + user). Каждый отмечен флагом isUser.
 * Опциональные фильтры: { equipment: 'chiller', workType: 'install-refrigerant' }.
 */
export function listMaterials(filter = {}) {
  const seed = SEED_MATERIALS.map(m => ({ ...m, isUser: false }));
  const user = loadUserMaterials().map(m => ({ ...m, isUser: true }));
  let all = [...seed, ...user];
  if (filter.equipment) {
    all = all.filter(m => !m.compatibleEquipment || m.compatibleEquipment.includes(filter.equipment));
  }
  if (filter.workType) {
    all = all.filter(m => !m.workTypes || m.workTypes.includes(filter.workType));
  }
  return all;
}

/**
 * Найти материалы, рекомендуемые для заданного типа работ + типа оборудования.
 * Используется для auto-suggest при добавлении позиции из шаблона работ.
 */
export function suggestMaterialsForWork(workType, equipmentKind) {
  return listMaterials({ workType, equipment: equipmentKind });
}

export function addMaterial(material) {
  const arr = loadUserMaterials();
  const id = 'usr-mat-' + Math.random().toString(36).slice(2, 8);
  const m = {
    id,
    name: String(material.name || ''),
    sku: material.sku || '',
    category: material.category || 'material',
    unit: material.unit || 'шт',
    defaultPrice: material.defaultPrice || { value: 0, currency: '₸' },
    vendor: material.vendor || '',
    compatibleEquipment: Array.isArray(material.compatibleEquipment) ? material.compatibleEquipment : [],
    workTypes: Array.isArray(material.workTypes) ? material.workTypes : [],
    consumptionRate: material.consumptionRate || null,
    notes: material.notes || '',
  };
  arr.push(m);
  saveUserMaterials(arr);
  return m;
}

export function updateMaterial(id, patch) {
  if (id?.startsWith('seed-')) return false;  // seed read-only
  const arr = loadUserMaterials();
  const idx = arr.findIndex(m => m.id === id);
  if (idx < 0) return false;
  arr[idx] = { ...arr[idx], ...patch, id };
  saveUserMaterials(arr);
  return true;
}

export function deleteMaterial(id) {
  if (id?.startsWith('seed-')) return false;
  const arr = loadUserMaterials().filter(m => m.id !== id);
  saveUserMaterials(arr);
  return true;
}

/* Pub/sub */
const _listeners = new Set();
export function onMaterialsChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
function _notifyChange() {
  _listeners.forEach(cb => { try { cb(); } catch {} });
  try { window.dispatchEvent(new CustomEvent('raschet:materials-change')); } catch {}
}

/* Категории оборудования (для UI dropdown в форме материала) */
export const EQUIPMENT_KINDS = [
  { id: 'chiller',     label: 'Чиллер' },
  { id: 'small-chiller', label: 'Чиллер малой мощности' },
  { id: 'dx',          label: 'DX (split, RTU)' },
  { id: 'crac',        label: 'CRAC прецизионный' },
  { id: 'ahu',         label: 'AHU (приточно-вытяжная)' },
  { id: 'drycooler',   label: 'Сухой охладитель' },
  { id: 'ups',         label: 'ИБП' },
  { id: 'dgu',         label: 'ДГУ (Дизель-генератор)' },
  { id: 'pdu',         label: 'PDU' },
  { id: 'panel',       label: 'Щит электрический' },
  { id: 'transformer', label: 'Трансформатор' },
  { id: 'scs',         label: 'СКС / Cabling' },
  { id: 'mdc',         label: 'Модульный ЦОД' },
  { id: 'rack',        label: 'Стойка серверная' },
];
