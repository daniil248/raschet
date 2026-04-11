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
    category: 'Щиты',
    title: 'ВРУ с АВР · 2 ввода',
    description: 'Вводно-распределительное устройство с АВР на 2 ввода',
    type: 'panel',
    params: { name: 'ВРУ', inputs: 2, outputs: 4, priorities: [1, 2], switchMode: 'auto' },
  },
  {
    id: 'pnl-vru-3',
    category: 'Щиты',
    title: 'ВРУ с АВР · 3 ввода (ТП+ТП+ДГУ)',
    description: 'ВРУ на два городских ввода и один резервный от ДГУ',
    type: 'panel',
    params: { name: 'ВРУ', inputs: 3, outputs: 6, priorities: [1, 1, 2], switchMode: 'auto' },
  },
  {
    id: 'pnl-ss',
    category: 'Щиты',
    title: 'ЩС · силовой',
    description: 'Стандартный силовой щит',
    type: 'panel',
    params: { name: 'ЩС', inputs: 1, outputs: 6, priorities: [1], switchMode: 'auto' },
  },
  {
    id: 'pnl-so',
    category: 'Щиты',
    title: 'ЩО · освещения',
    description: 'Щит освещения',
    type: 'panel',
    params: { name: 'ЩО', inputs: 1, outputs: 8, priorities: [1], switchMode: 'auto' },
  },
  {
    id: 'pnl-mcb',
    category: 'Щиты',
    title: 'ЩК · квартирный',
    description: 'Квартирный щит на 6 автоматов',
    type: 'panel',
    params: { name: 'ЩК', inputs: 1, outputs: 6, priorities: [1], switchMode: 'auto' },
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

// Подгружаем пользовательские пресеты из localStorage
try {
  const stored = localStorage.getItem('raschet.userPresets.v1');
  if (stored) {
    const list = JSON.parse(stored);
    if (Array.isArray(list)) {
      for (const p of list) PRESETS.push(p);
    }
  }
} catch (e) { console.warn('[presets] cannot load user presets', e); }

window.Presets = {
  all: PRESETS,
  byCategory,
  get(id) { return PRESETS.find(p => p.id === id); },
  removeUser(id) {
    const idx = PRESETS.findIndex(p => p.id === id);
    if (idx >= 0) PRESETS.splice(idx, 1);
    try {
      const stored = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
      const filtered = stored.filter(p => p.id !== id);
      localStorage.setItem('raschet.userPresets.v1', JSON.stringify(filtered));
    } catch {}
  },
};

})();
