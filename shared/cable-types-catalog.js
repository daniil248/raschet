// ======================================================================
// shared/cable-types-catalog.js
// Per-user каталог типов кабельной продукции (ВВГнг, КВВГнг, FTP и т.п.).
// Базовые (builtin: true) приходят из BUILTIN_CABLE_TYPES и не удаляются.
// Пользователь может добавлять свои или импортировать через XLSX.
//
// Ключ localStorage: 'raschet.cableTypesCatalog.v1.<uid>'
//
// Схема записи (CableTypeRecord):
//   {
//     id:           string,                     // стабильный (supplier + model)
//     brand:        string,                     // торговая марка: 'ВВГнг-LS', 'FTP'
//     fullName:     string,                     // полное обозначение с нормативом
//     category:     'power'|'hv'|'signal'|'data'|'fieldbus'|'dc',
//     material:     'Cu'|'Al',
//     insulation:   'PVC'|'XLPE'|'EPR'|'Rubber',
//     sheathMaterial: 'PVC'|'LSZH'|'PE'|'FRLS',
//     fireResistant: boolean,                   // огнестойкий (FRLS)
//     lowSmokeZH:   boolean,                    // LSZH (пониженная дымность)
//     standard:     string,                     // ГОСТ 31996-2012, IEC 60502-1
//     description:  string,
//     builtin:      boolean,                    // нельзя удалить
//     source:       'builtin'|'user'|'imported',
//     createdAt, updatedAt
//   }
// ======================================================================

const LEGACY_KEY = 'raschet.cableTypesCatalog.v1';

function currentUserId() {
  try { return localStorage.getItem('raschet.currentUserId') || 'anonymous'; }
  catch { return 'anonymous'; }
}
function storageKey() { return LEGACY_KEY + '.' + currentUserId(); }

// ——— базовые типы (встроенные, не удаляемые) ———
export const BUILTIN_CABLE_TYPES = [
  // === Силовые (power) ===
  {
    id: 'vvgng-ls',
    brand: 'ВВГнг(А)-LS',
    fullName: 'ВВГнг(А)-LS — медь, ПВХ изоляция и оболочка, пониженная дымность',
    category: 'power',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'LSZH',
    fireResistant: false,
    lowSmokeZH: true,
    standard: 'ГОСТ 31996-2012',
    description: 'Силовой кабель для стационарной прокладки в сетях до 1 кВ. Нераспространяющий горение, пониженная дымо-газовыделения.',
  },
  {
    id: 'vvgng-frls',
    brand: 'ВВГнг(А)-FRLS',
    fullName: 'ВВГнг(А)-FRLS — огнестойкий, LSZH',
    category: 'power',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'FRLS',
    fireResistant: true,
    lowSmokeZH: true,
    standard: 'ГОСТ 31996-2012',
    description: 'Огнестойкий силовой кабель. Сохраняет работоспособность в условиях пожара 180 мин. Для систем противопожарной защиты, аварийного освещения.',
  },
  {
    id: 'avbbshv',
    brand: 'АВБбШв',
    fullName: 'АВБбШв — алюминий, ПВХ, броня из стальных лент',
    category: 'power',
    material: 'Al',
    insulation: 'PVC',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 16442-80',
    description: 'Бронированный силовой кабель для прокладки в земле и кабельных сооружениях.',
  },
  {
    id: 'vvg',
    brand: 'ВВГ',
    fullName: 'ВВГ — медь, ПВХ изоляция и оболочка',
    category: 'power',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 31996-2012',
    description: 'Базовый силовой кабель для сетей до 1 кВ.',
  },
  {
    id: 'avvg',
    brand: 'АВВГ',
    fullName: 'АВВГ — алюминий, ПВХ',
    category: 'power',
    material: 'Al',
    insulation: 'PVC',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 31996-2012',
    description: 'Силовой кабель с алюминиевыми жилами, сети до 1 кВ.',
  },
  {
    id: 'pvs',
    brand: 'ПВС',
    fullName: 'ПВС — гибкий, ПВХ изоляция',
    category: 'power',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 7399-97',
    description: 'Гибкий провод соединительный для бытовой техники, удлинителей.',
  },

  // === Высоковольтные (hv) ===
  {
    id: 'apvpug',
    brand: 'АПвПуг',
    fullName: 'АПвПуг — алюминий, СПЭ изоляция, оболочка ПЭ, гофрированная броня',
    category: 'hv',
    material: 'Al',
    insulation: 'XLPE',
    sheathMaterial: 'PE',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ Р 55025-2012',
    description: 'Высоковольтный кабель 6-35 кВ с изоляцией из сшитого полиэтилена.',
  },
  {
    id: 'pvpu',
    brand: 'ПвПу',
    fullName: 'ПвПу — медь, СПЭ, ПЭ оболочка',
    category: 'hv',
    material: 'Cu',
    insulation: 'XLPE',
    sheathMaterial: 'PE',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ Р 55025-2012',
    description: 'Медный высоковольтный кабель 6-35 кВ, СПЭ изоляция.',
  },

  // === Слаботочные / контрольные (signal) ===
  {
    id: 'kvvg',
    brand: 'КВВГ',
    fullName: 'КВВГ — контрольный, медь, ПВХ',
    category: 'signal',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 1508-78',
    description: 'Контрольный кабель для систем управления до 660 В AC / 1000 В DC.',
  },
  {
    id: 'kvvgng-ls',
    brand: 'КВВГнг(А)-LS',
    fullName: 'КВВГнг(А)-LS — контрольный, LSZH',
    category: 'signal',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'LSZH',
    fireResistant: false,
    lowSmokeZH: true,
    standard: 'ГОСТ 1508-78',
    description: 'Контрольный кабель не распространяющий горение с низким дымовыделением.',
  },
  {
    id: 'kvvgng-frls',
    brand: 'КВВГнг(А)-FRLS',
    fullName: 'КВВГнг(А)-FRLS — огнестойкий контрольный',
    category: 'signal',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: 'FRLS',
    fireResistant: true,
    lowSmokeZH: true,
    standard: 'ГОСТ 1508-78',
    description: 'Огнестойкий контрольный кабель для систем автоматики противопожарных установок.',
  },

  // === Информационные (data) ===
  {
    id: 'utp-5e',
    brand: 'UTP cat.5e',
    fullName: 'UTP Cat 5e — витая пара, 100 МГц',
    category: 'data',
    material: 'Cu',
    insulation: 'PE',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'TIA/EIA-568-B',
    description: 'Неэкранированная витая пара 4×2×0.5 мм. Ethernet до 1 Гбит/с, 100 м.',
  },
  {
    id: 'ftp-6',
    brand: 'FTP cat.6',
    fullName: 'FTP Cat 6 — экранированная витая пара, 250 МГц',
    category: 'data',
    material: 'Cu',
    insulation: 'PE',
    sheathMaterial: 'PVC',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'TIA/EIA-568-B',
    description: 'Экранированная витая пара для Ethernet 10 Гбит/с до 55 м.',
  },
  {
    id: 'tpp',
    brand: 'ТПП',
    fullName: 'ТПП — телефонный, медь, ПЭ изоляция, ПЭ оболочка',
    category: 'data',
    material: 'Cu',
    insulation: 'PE',
    sheathMaterial: 'PE',
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ТУ 16.К71-008-87',
    description: 'Телефонный кабель для городских АТС, многопарный.',
  },
  {
    id: 'fiber-sm',
    brand: 'ОКЛ (SM)',
    fullName: 'Оптический кабель одномодовый 9/125',
    category: 'data',
    material: null,
    insulation: null,
    sheathMaterial: 'LSZH',
    fireResistant: false,
    lowSmokeZH: true,
    standard: 'ITU-T G.652',
    description: 'Одномодовое оптоволокно для магистральных линий, до 80 км без усиления.',
  },

  // === Постоянный ток (dc) ===
  {
    id: 'pugv',
    brand: 'ПуГВ',
    fullName: 'ПуГВ — гибкий установочный, ПВХ',
    category: 'dc',
    material: 'Cu',
    insulation: 'PVC',
    sheathMaterial: null,
    fireResistant: false,
    lowSmokeZH: false,
    standard: 'ГОСТ 31947-2012',
    description: 'Гибкий одножильный провод для стационарной прокладки, DC и AC до 450/750 В.',
  },
  {
    id: 'solar-dc',
    brand: 'Solar DC',
    fullName: 'Solar DC (PV1-F) — для фотоэлектрических систем',
    category: 'dc',
    material: 'Cu',
    insulation: 'XLPE',
    sheathMaterial: 'XLPE',
    fireResistant: false,
    lowSmokeZH: true,
    standard: 'EN 50618',
    description: 'Специальный DC-кабель для солнечных электростанций, УФ-стойкий, до 1500 В DC.',
  },
];

// ——— API (симметрично panel-catalog.js) ———

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
  catch (e) { console.error('[cable-types-catalog] write failed', e); }
  _notify();
}

// Listeners для same-tab sync (catalog-bridge подписывается).
const _listeners = new Set();
export function onCableTypesChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function _notify() {
  for (const cb of _listeners) { try { cb(); } catch (e) { console.error('[cable-types-catalog] listener', e); } }
}

/** Все типы кабелей: builtin (всегда) + user-added из localStorage. */
export function listCableTypes() {
  const userList = _read();
  // Базовые всегда идут первыми, пользовательские — в конце.
  const builtinMarked = BUILTIN_CABLE_TYPES.map(t => ({ ...t, builtin: true, source: 'builtin' }));
  // Пользовательские не могут иметь id совпадающий с builtin
  const userFiltered = userList.filter(u => !BUILTIN_CABLE_TYPES.some(b => b.id === u.id));
  return [...builtinMarked, ...userFiltered];
}

/** Найти тип по id (builtin или пользовательский). */
export function getCableType(id) {
  const b = BUILTIN_CABLE_TYPES.find(t => t.id === id);
  if (b) return { ...b, builtin: true, source: 'builtin' };
  return _read().find(t => t.id === id) || null;
}

/** Добавить пользовательский тип. */
export function addCableType(rec) {
  if (!rec || !rec.id) throw new Error('[cable-types-catalog] id required');
  if (BUILTIN_CABLE_TYPES.some(b => b.id === rec.id)) {
    throw new Error('Cannot override builtin: ' + rec.id);
  }
  const list = _read();
  const now = Date.now();
  const idx = list.findIndex(t => t.id === rec.id);
  const saved = {
    ...rec,
    builtin: false,
    source: rec.source || 'user',
    createdAt: (idx >= 0 ? list[idx].createdAt : now),
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = saved;
  else list.push(saved);
  _write(list);
  return saved;
}

/** Удалить пользовательский тип (builtin не удаляются). */
export function removeCableType(id) {
  if (BUILTIN_CABLE_TYPES.some(b => b.id === id)) return false;
  const list = _read();
  const idx = list.findIndex(t => t.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  _write(list);
  return true;
}

/** Фильтр по категории. */
export function listCableTypesByCategory(category) {
  return listCableTypes().filter(t => t.category === category);
}

/** Экспорт пользовательских типов в JSON. */
export function exportUserCableTypes() {
  return JSON.stringify({ version: 1, types: _read() }, null, 2);
}

/** Импорт (merge). */
export function importCableTypes(json) {
  let parsed;
  try { parsed = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (e) { throw new Error('Bad JSON: ' + e.message); }
  if (!parsed || !Array.isArray(parsed.types)) throw new Error('Bad format');
  let added = 0, updated = 0;
  for (const rec of parsed.types) {
    if (!rec.id || BUILTIN_CABLE_TYPES.some(b => b.id === rec.id)) continue;
    const existing = _read().find(t => t.id === rec.id);
    addCableType(rec);
    if (existing) updated++; else added++;
  }
  return { added, updated, total: _read().length };
}
