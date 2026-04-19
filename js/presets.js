/* =========================================================================
   presets.js — каталог типовых элементов.
   Каждый пресет — { id, category, title, description, type, params }.
   Применяется через window.Raschet.applyPreset(params) или просто
   создаётся новый узел нужного типа с уже заполненными полями.
   ========================================================================= */
(function () {
'use strict';

const PRESETS = [
  // -------- Источники --------
  {
    id: 'src-tp-400',
    category: 'Источники',
    title: 'Ввод ТП 0.4 кВ · 400 кВА',
    description: 'Стандартный ввод от трансформаторной подстанции',
    type: 'source',
    params: { name: 'Ввод ТП', capacityKw: 400, on: true },
  },
  {
    id: 'src-tp-630',
    category: 'Источники',
    title: 'Ввод ТП 0.4 кВ · 630 кВА',
    description: 'Ввод от ТП повышенной мощности',
    type: 'source',
    params: { name: 'Ввод ТП', capacityKw: 630, on: true },
  },
  {
    id: 'src-tp-100',
    category: 'Источники',
    title: 'Ввод 0.4 кВ · 100 кВт',
    description: 'Малый ввод, подходит для офисного здания',
    type: 'source',
    params: { name: 'Ввод', capacityKw: 100, on: true },
  },

  // -------- Генераторы --------
  {
    id: 'gen-dgu-60',
    category: 'Генераторы',
    title: 'ДГУ 60 кВА · резерв',
    description: 'Дизельная генераторная установка 60 кВА, резервная',
    type: 'generator',
    params: { name: 'ДГУ', capacityKw: 48, on: true, backupMode: true },
  },
  {
    id: 'gen-dgu-150',
    category: 'Генераторы',
    title: 'ДГУ 150 кВА · резерв',
    description: 'ДГУ средней мощности, резервное питание',
    type: 'generator',
    params: { name: 'ДГУ', capacityKw: 120, on: true, backupMode: true },
  },
  {
    id: 'gen-dgu-400',
    category: 'Генераторы',
    title: 'ДГУ 400 кВА · резерв',
    description: 'ДГУ большой мощности для ЦОД',
    type: 'generator',
    params: { name: 'ДГУ', capacityKw: 320, on: true, backupMode: true },
  },

  // -------- Щиты --------
  {
    id: 'pnl-vru-2',
    category: 'НКУ',
    title: 'ВРУ с АВР · 2 ввода',
    description: 'Вводно-распределительное устройство с АВР на 2 ввода',
    type: 'panel',
    params: { name: 'ВРУ', inputs: 2, outputs: 4, priorities: [1, 2], switchMode: 'auto' },
  },
  {
    id: 'pnl-vru-3',
    category: 'НКУ',
    title: 'ВРУ с АВР · 3 ввода (ТП+ТП+ДГУ)',
    description: 'ВРУ на два городских ввода и один резервный от ДГУ',
    type: 'panel',
    params: { name: 'ВРУ', inputs: 3, outputs: 6, priorities: [1, 1, 2], switchMode: 'auto' },
  },
  {
    id: 'pnl-ss',
    category: 'НКУ',
    title: 'ЩС · силовой',
    description: 'Стандартный силовой щит',
    type: 'panel',
    params: { name: 'ЩС', inputs: 1, outputs: 6, priorities: [1], switchMode: 'auto' },
  },
  {
    id: 'pnl-so',
    category: 'НКУ',
    title: 'ЩО · освещения',
    description: 'Щит освещения',
    type: 'panel',
    params: { name: 'ЩО', inputs: 1, outputs: 8, priorities: [1], switchMode: 'auto' },
  },
  {
    id: 'pnl-mcb',
    category: 'НКУ',
    title: 'ЩК · квартирный',
    description: 'Квартирный щит на 6 автоматов',
    type: 'panel',
    params: { name: 'ЩК', inputs: 1, outputs: 6, priorities: [1], switchMode: 'auto' },
  },

  // -------- Среднее напряжение (6-35 кВ) — Фаза 1.19 --------
  // Используется тот же тип 'panel', но с флагом mvSwitchgearId (ссылка на
  // builtin-элемент из element-library) и voltageLevelIdx=3 (10 кВ) — чтобы
  // conn._isHV проставлялся recalc'ом и подхватывался фильтр ВН-кабелей.
  {
    id: 'mv-rm6-iii',
    category: 'Среднее напряжение',
    title: 'RM6 III · ввод+ввод+защита ТП',
    description: 'Schneider RM6 (24 кВ SF6), 2 ввода + защита трансформатора, 630 А',
    type: 'panel',
    params: {
      name: 'RM6', inputs: 2, outputs: 1,
      priorities: [1, 2], switchMode: 'auto',
      voltageLevelIdx: 3, // 10 kV по умолчанию (HV)
      capacityA: 630,
      ipRating: 'IP67',
      mvSwitchgearId: 'schneider-rm6-iii',
      isMv: true,
    },
  },
  {
    id: 'mv-rm6-iidi',
    category: 'Среднее напряжение',
    title: 'RM6 IIDI · 2 ввода + 2 защиты',
    description: 'Schneider RM6 для ТП с двумя трансформаторами',
    type: 'panel',
    params: {
      name: 'RM6', inputs: 2, outputs: 2,
      priorities: [1, 2], switchMode: 'auto',
      voltageLevelIdx: 3, capacityA: 630, ipRating: 'IP67',
      mvSwitchgearId: 'schneider-rm6-iidi', isMv: true,
    },
  },
  {
    id: 'mv-fafering-ccf',
    category: 'Среднее напряжение',
    title: 'FafeRing CCF · ввод+ввод+защита',
    description: 'Компактное РУ 12 кВ, аналог RM6 (Китай)',
    type: 'panel',
    params: {
      name: 'FafeRing', inputs: 2, outputs: 1,
      priorities: [1, 2], switchMode: 'auto',
      voltageLevelIdx: 3, capacityA: 630, ipRating: 'IP67',
      mvSwitchgearId: 'fafering-ccf', isMv: true,
    },
  },
  {
    id: 'mv-sho70-typical',
    category: 'Среднее напряжение',
    title: 'ЩО-70 · типовая 6 ячеек (ТП 2×1000)',
    description: 'Сборное РУ 10 кВ: 2 ввода + ССВ + 2 отх + ТН',
    type: 'panel',
    params: {
      name: 'ЩО-70', inputs: 2, outputs: 2,
      priorities: [1, 2], switchMode: 'auto',
      voltageLevelIdx: 3, capacityA: 630, ipRating: 'IP31',
      mvSwitchgearId: 'sho70-typical-6cells', isMv: true,
    },
  },
  {
    id: 'mv-empty',
    category: 'Среднее напряжение',
    title: 'Произвольное РУ СН',
    description: 'Пустое РУ СН — выбор модели в инспекторе или конфигурирование через wizard (планируется Фаза 1.19.1)',
    type: 'panel',
    params: {
      name: 'РУ СН', inputs: 1, outputs: 2,
      priorities: [1], switchMode: 'auto',
      voltageLevelIdx: 3, capacityA: 630,
      isMv: true,
    },
  },

  // -------- ИБП --------
  {
    id: 'ups-3k',
    category: 'ИБП',
    title: 'ИБП 3 кВА · on-line',
    description: 'Двойное преобразование, одна фаза, для рабочих мест',
    type: 'ups',
    params: {
      name: 'ИБП', capacityKw: 2.7, efficiency: 94, chargeKw: 0.3,
      batteryKwh: 1.5, batteryChargePct: 100,
      inputs: 1, outputs: 2, priorities: [1], on: true,
    },
  },
  {
    id: 'ups-10k',
    category: 'ИБП',
    title: 'ИБП 10 кВА · on-line',
    description: 'Для серверной комнаты',
    type: 'ups',
    params: {
      name: 'ИБП', capacityKw: 9, efficiency: 94, chargeKw: 0.6,
      batteryKwh: 5, batteryChargePct: 100,
      inputs: 1, outputs: 4, priorities: [1], on: true,
    },
  },
  {
    id: 'ups-40k',
    category: 'ИБП',
    title: 'ИБП 40 кВА · on-line',
    description: 'Промышленный ИБП для малого ЦОД',
    type: 'ups',
    params: {
      name: 'ИБП', capacityKw: 36, efficiency: 95, chargeKw: 2,
      batteryKwh: 20, batteryChargePct: 100,
      inputs: 2, outputs: 6, priorities: [1, 2], on: true,
    },
  },
  {
    id: 'ups-120k',
    category: 'ИБП',
    title: 'ИБП 120 кВА · модульный',
    description: 'Модульный ИБП уровня ЦОД',
    type: 'ups',
    params: {
      name: 'ИБП', capacityKw: 108, efficiency: 96, chargeKw: 5,
      batteryKwh: 60, batteryChargePct: 100,
      inputs: 2, outputs: 8, priorities: [1, 2], on: true,
    },
  },

  // -------- Потребители --------
  {
    id: 'cns-server',
    category: 'Потребители',
    title: 'Сервер 1U',
    description: 'Стоечный сервер общего назначения',
    type: 'consumer',
    params: { name: 'Сервер', demandKw: 0.6, count: 1, inputs: 2, priorities: [1, 1], phase: '3ph' },
  },
  {
    id: 'cns-rack',
    category: 'Потребители',
    title: 'Серверная стойка',
    description: 'Полная стойка оборудования',
    type: 'consumer',
    params: { name: 'Стойка', demandKw: 6, count: 1, inputs: 2, priorities: [1, 1], phase: '3ph' },
  },
  {
    id: 'cns-rack-10',
    category: 'Потребители',
    title: 'Ряд из 10 стоек',
    description: 'Группа: 10 стоек по 6 кВт',
    type: 'consumer',
    params: { name: 'Стойки', demandKw: 6, count: 10, inputs: 2, priorities: [1, 1], phase: '3ph' },
  },
  {
    id: 'cns-ac',
    category: 'Потребители',
    title: 'Кондиционер',
    description: 'Сплит-система или прецизионный кондиционер',
    type: 'consumer',
    params: { name: 'Кондиционер', demandKw: 5, count: 1, inputs: 1, priorities: [1], phase: '3ph' },
  },
  {
    id: 'cns-light',
    category: 'Потребители',
    title: 'Освещение',
    description: 'Группа светильников',
    type: 'consumer',
    params: { name: 'Освещение', demandKw: 2, count: 1, inputs: 1, priorities: [1], phase: 'A' },
  },
  {
    id: 'cns-socket',
    category: 'Потребители',
    title: 'Розеточная группа',
    description: 'Группа розеток общего назначения',
    type: 'consumer',
    params: { name: 'Розетки', demandKw: 3, count: 1, inputs: 1, priorities: [1], phase: 'A' },
  },
];

// Группировка по категориям для UI
function byCategory() {
  const out = new Map();
  for (const p of PRESETS) {
    if (!out.has(p.category)) out.set(p.category, []);
    out.get(p.category).push(p);
  }
  return out;
}

// Модификации пользователя поверх base-набора:
//  - deleted: Set<id> — удалённые (в том числе базовые)
//  - overrides: Map<id, preset> — изменённые (замещают оригинал)
//  - added: Array<preset> — новые user-presets (id "up_*" или "user_*")
// Все три — в localStorage под своими ключами.
let _deletedIds = new Set();
let _overrides = new Map();
let _added = [];

function _loadMods() {
  try {
    const del = JSON.parse(localStorage.getItem('raschet.presetsDeleted.v1') || '[]');
    if (Array.isArray(del)) _deletedIds = new Set(del);
  } catch {}
  try {
    const ov = JSON.parse(localStorage.getItem('raschet.presetsOverrides.v1') || '{}');
    if (ov && typeof ov === 'object') {
      for (const [k, v] of Object.entries(ov)) _overrides.set(k, v);
    }
  } catch {}
  // Совместимость: старый ключ userPresets.v1 = список новых
  try {
    const old = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
    if (Array.isArray(old)) _added = old;
  } catch {}
}
function _saveDeleted() {
  try { localStorage.setItem('raschet.presetsDeleted.v1', JSON.stringify([..._deletedIds])); } catch {}
}
function _saveOverrides() {
  try {
    const obj = {};
    for (const [k, v] of _overrides) obj[k] = v;
    localStorage.setItem('raschet.presetsOverrides.v1', JSON.stringify(obj));
  } catch {}
}
function _saveAdded() {
  try { localStorage.setItem('raschet.userPresets.v1', JSON.stringify(_added)); } catch {}
}

// Вычисляет финальный список пресетов, применяя deleted/overrides/added
function _resolve() {
  const result = [];
  for (const p of PRESETS) {
    if (_deletedIds.has(p.id)) continue;
    result.push(_overrides.has(p.id) ? _overrides.get(p.id) : p);
  }
  for (const p of _added) {
    if (_deletedIds.has(p.id)) continue;
    result.push(_overrides.has(p.id) ? _overrides.get(p.id) : p);
  }
  return result;
}

_loadMods();

// Список id «базовых» пресетов из комплекта — чтобы при сбросе уметь вернуть их.
const BUILTIN_IDS = new Set(PRESETS.map(p => p.id));

window.Presets = {
  get all() { return _resolve(); },
  byCategory() {
    const out = new Map();
    for (const p of _resolve()) {
      if (!out.has(p.category)) out.set(p.category, []);
      out.get(p.category).push(p);
    }
    return out;
  },
  get(id) { return _resolve().find(p => p.id === id); },
  // Проверка: пресет входит в базовую поставку?
  isBuiltin(id) { return BUILTIN_IDS.has(id); },
  // Добавить новый user-пресет
  add(preset) {
    _added.push(preset);
    _saveAdded();
  },
  // Изменить пресет (базовый — через overrides; user-added — в самом массиве)
  update(id, patch) {
    if (BUILTIN_IDS.has(id)) {
      const base = _overrides.get(id) || PRESETS.find(p => p.id === id);
      if (!base) return;
      const merged = { ...base, ...patch, id, params: { ...(base.params || {}), ...(patch.params || {}) } };
      _overrides.set(id, merged);
      _saveOverrides();
    } else {
      const idx = _added.findIndex(p => p.id === id);
      if (idx >= 0) {
        _added[idx] = { ..._added[idx], ...patch, id, params: { ..._added[idx].params, ...(patch.params || {}) } };
        _saveAdded();
      }
    }
  },
  // Удалить пресет: базовый → в deleted-set; user — удаляем из added
  remove(id) {
    if (BUILTIN_IDS.has(id)) {
      _deletedIds.add(id);
      _saveDeleted();
    } else {
      const idx = _added.findIndex(p => p.id === id);
      if (idx >= 0) { _added.splice(idx, 1); _saveAdded(); }
    }
  },
  // Для совместимости со старым кодом
  removeUser(id) { this.remove(id); },
  // Восстановление всех базовых — очистка deleted и overrides
  resetBuiltins() {
    _deletedIds.clear(); _overrides.clear();
    _saveDeleted(); _saveOverrides();
  },
};

})();
