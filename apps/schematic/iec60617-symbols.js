// ======================================================================
// iec60617-symbols.js
// Библиотека символов принципиальных электрических схем по IEC 60617-DB-12M.
// Координаты символов — в миллиметрах, опорная точка (0,0) — геометрический
// центр символа. Все выводы (pins) тоже в мм относительно центра.
//
// Каждый символ описывает:
//   id       — IEC-классификационный идентификатор (S00123 …)
//   name     — локализованное имя
//   group    — группа палитры
//   refPrefix— префикс позиционного обозначения (R, C, K, Q, …)
//   w, h     — габаритные размеры в мм
//   pins     — список точек подключения { id, x, y }
//   draw     — функция, возвращающая SVG-строку тела символа
//              (координаты в мм, центр — (0,0))
// ======================================================================

/**
 * Базовый шаг схемной сетки (IEC — обычно кратно 2.5 мм).
 * Все выводы и размеры символов выровнены на 2.5 мм.
 */
export const GRID_MM = 2.5;

/** Условный шрифтовой размер для подписей — в мм */
export const LABEL_FS = 2.6;

/**
 * Полный каталог символов. Группы соответствуют разделам IEC 60617.
 */
export const IEC_SYMBOLS = [
  // ============================================================
  // 04 — Пассивные компоненты
  // ============================================================
  {
    id: 'S00210',
    iec: 'IEC 60617-04-01-01',
    name: 'Резистор',
    group: '04 · Пассивные',
    refPrefix: 'R',
    w: 20, h: 10,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-6" y2="0"/>
      <rect class="sch-comp-body" x="-6" y="-2.5" width="12" height="5"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="10" y2="0"/>
    `,
  },
  {
    id: 'S00215',
    iec: 'IEC 60617-04-01-03',
    name: 'Резистор переменный',
    group: '04 · Пассивные',
    refPrefix: 'R',
    w: 20, h: 14,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-6" y2="0"/>
      <rect class="sch-comp-body" x="-6" y="-2.5" width="12" height="5"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="10" y2="0"/>
      <line class="sch-comp-body" x1="-4" y1="6" x2="4" y2="-6"/>
      <polygon class="sch-comp-body" points="4,-6 2.1,-4.5 4.1,-3.5" fill="#1f2430"/>
    `,
  },
  {
    id: 'S00220',
    iec: 'IEC 60617-04-02-01',
    name: 'Конденсатор',
    group: '04 · Пассивные',
    refPrefix: 'C',
    w: 14, h: 10,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-7" y1="0" x2="-1" y2="0"/>
      <line class="sch-comp-body" x1="-1" y1="-4" x2="-1" y2="4"/>
      <line class="sch-comp-body" x1="1"  y1="-4" x2="1"  y2="4"/>
      <line class="sch-comp-body" x1="1"  y1="0" x2="7"  y2="0"/>
    `,
  },
  {
    id: 'S00225',
    iec: 'IEC 60617-04-03-01',
    name: 'Катушка индуктивности',
    group: '04 · Пассивные',
    refPrefix: 'L',
    w: 20, h: 10,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-8" y2="0"/>
      <path class="sch-comp-body" d="M-8 0 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0"/>
      <line class="sch-comp-body" x1="8" y1="0" x2="10" y2="0"/>
    `,
  },

  // ============================================================
  // 05 — Полупроводники
  // ============================================================
  {
    id: 'S00410',
    iec: 'IEC 60617-05-03-01',
    name: 'Диод',
    group: '05 · Полупроводники',
    refPrefix: 'VD',
    w: 14, h: 10,
    pins: [
      { id: 'A', x: -7, y: 0 },
      { id: 'K', x:  7, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-7" y1="0" x2="-3" y2="0"/>
      <polygon class="sch-comp-body" points="-3,-3 -3,3 3,0" fill="#1f2430"/>
      <line class="sch-comp-body" x1="3" y1="-3" x2="3" y2="3"/>
      <line class="sch-comp-body" x1="3" y1="0" x2="7" y2="0"/>
    `,
  },
  {
    id: 'S00415',
    iec: 'IEC 60617-05-03-05',
    name: 'Светодиод',
    group: '05 · Полупроводники',
    refPrefix: 'HL',
    w: 14, h: 12,
    pins: [
      { id: 'A', x: -7, y: 0 },
      { id: 'K', x:  7, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-7" y1="0" x2="-3" y2="0"/>
      <polygon class="sch-comp-body" points="-3,-3 -3,3 3,0" fill="#1f2430"/>
      <line class="sch-comp-body" x1="3" y1="-3" x2="3" y2="3"/>
      <line class="sch-comp-body" x1="3" y1="0" x2="7" y2="0"/>
      <line class="sch-comp-body" x1="-1" y1="-4" x2="2.5" y2="-6"/>
      <polygon class="sch-comp-body" points="2.5,-6 1.3,-5.2 2.1,-4.3" fill="#1f2430"/>
      <line class="sch-comp-body" x1="-3" y1="-5" x2="0.5" y2="-7"/>
      <polygon class="sch-comp-body" points="0.5,-7 -0.7,-6.2 0.1,-5.3" fill="#1f2430"/>
    `,
  },
  {
    id: 'S00440',
    iec: 'IEC 60617-05-05-01',
    name: 'Транзистор NPN',
    group: '05 · Полупроводники',
    refPrefix: 'VT',
    w: 14, h: 14,
    pins: [
      { id: 'B', x: -7, y: 0 },
      { id: 'C', x:  5, y: -7 },
      { id: 'E', x:  5, y:  7 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="1" cy="0" r="6"/>
      <line class="sch-comp-body" x1="-7" y1="0" x2="-2" y2="0"/>
      <line class="sch-comp-body" x1="-2" y1="-4" x2="-2" y2="4"/>
      <line class="sch-comp-body" x1="-2" y1="-2" x2="5" y2="-7"/>
      <line class="sch-comp-body" x1="-2" y1="2"  x2="5" y2="7"/>
      <polygon class="sch-comp-body" points="5,7 2.5,6.2 3.5,4.8" fill="#1f2430"/>
    `,
  },

  // ============================================================
  // 06 — Коммутация
  // ============================================================
  {
    id: 'S00610',
    iec: 'IEC 60617-07-02-01',
    name: 'Выключатель 1-полюсный',
    group: '07 · Коммутация',
    refPrefix: 'SA',
    w: 20, h: 12,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-4" y2="0"/>
      <line class="sch-comp-body" x1="-4"  y1="0" x2="5"  y2="-5"/>
      <line class="sch-comp-body" x1="4"   y1="0" x2="10" y2="0"/>
      <circle class="sch-comp-pin-dot" cx="-4" cy="0" r="0.5" fill="#1f2430"/>
      <circle class="sch-comp-pin-dot" cx="4"  cy="0" r="0.5" fill="#1f2430"/>
    `,
  },
  {
    id: 'S00620',
    iec: 'IEC 60617-07-13-01',
    name: 'Автоматический выключатель',
    group: '07 · Коммутация',
    refPrefix: 'QF',
    w: 20, h: 16,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-4" y2="0"/>
      <line class="sch-comp-body" x1="-4"  y1="0" x2="5"  y2="-5"/>
      <line class="sch-comp-body" x1="4"   y1="0" x2="10" y2="0"/>
      <rect class="sch-comp-body" x="-2" y="-8" width="4" height="3"/>
      <line class="sch-comp-body" x1="0" y1="-5" x2="0" y2="-2"/>
      <circle class="sch-comp-pin-dot" cx="-4" cy="0" r="0.5" fill="#1f2430"/>
      <circle class="sch-comp-pin-dot" cx="4"  cy="0" r="0.5" fill="#1f2430"/>
    `,
  },
  {
    id: 'S00630',
    iec: 'IEC 60617-07-21-02',
    name: 'Разъединитель',
    group: '07 · Коммутация',
    refPrefix: 'QS',
    w: 20, h: 14,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-4" y2="0"/>
      <line class="sch-comp-body" x1="-4"  y1="0" x2="5"  y2="-5"/>
      <line class="sch-comp-body" x1="4"   y1="0" x2="10" y2="0"/>
      <line class="sch-comp-body" x1="-4" y1="-3" x2="-4" y2="3"/>
      <line class="sch-comp-body" x1="4"  y1="-3" x2="4"  y2="3"/>
    `,
  },
  {
    id: 'S00640',
    iec: 'IEC 60617-07-21-01',
    name: 'Предохранитель',
    group: '07 · Коммутация',
    refPrefix: 'FU',
    w: 20, h: 8,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-6" y2="0"/>
      <rect class="sch-comp-body" x="-6" y="-2" width="12" height="4"/>
      <line class="sch-comp-body" x1="-6" y1="0" x2="6" y2="0"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="10" y2="0"/>
    `,
  },
  {
    id: 'S00650',
    iec: 'IEC 60617-07-15-03',
    name: 'Контактор (замыкающий)',
    group: '07 · Коммутация',
    refPrefix: 'KM',
    w: 20, h: 12,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-4" y2="0"/>
      <line class="sch-comp-body" x1="-4" y1="0" x2="5" y2="-5"/>
      <path class="sch-comp-body" d="M-3 -5 q3 2 6 0"/>
      <line class="sch-comp-body" x1="4"   y1="0" x2="10" y2="0"/>
    `,
  },
  {
    id: 'S00660',
    iec: 'IEC 60617-07-02-02',
    name: 'Кнопка NO',
    group: '07 · Коммутация',
    refPrefix: 'SB',
    w: 20, h: 12,
    pins: [
      { id: '1', x: -10, y: 0 },
      { id: '2', x:  10, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-10" y1="0" x2="-6" y2="0"/>
      <line class="sch-comp-body" x1="-6" y1="-3" x2="6" y2="-3"/>
      <line class="sch-comp-body" x1="0" y1="-3" x2="0" y2="-6"/>
      <rect class="sch-comp-body" x="-1.5" y="-8" width="3" height="2"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="10" y2="0"/>
    `,
  },

  // ============================================================
  // 06 — Катушки / реле
  // ============================================================
  {
    id: 'S00710',
    iec: 'IEC 60617-07-15-21',
    name: 'Катушка реле',
    group: '07 · Коммутация',
    refPrefix: 'K',
    w: 14, h: 10,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-7" y1="0" x2="-4" y2="0"/>
      <rect class="sch-comp-body" x="-4" y="-3" width="8" height="6"/>
      <line class="sch-comp-body" x1="4" y1="0" x2="7" y2="0"/>
    `,
  },

  // ============================================================
  // 06 — Электромашины
  // ============================================================
  {
    id: 'S00510',
    iec: 'IEC 60617-06-04-01',
    name: 'Двигатель 3~',
    group: '06 · Машины',
    refPrefix: 'M',
    w: 18, h: 18,
    pins: [
      { id: 'U', x: -7, y: -9 },
      { id: 'V', x:  0, y: -9 },
      { id: 'W', x:  7, y: -9 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="8"/>
      <text x="0" y="0">M</text>
      <text x="0" y="5" style="font-size:2.2px">3~</text>
      <line class="sch-comp-body" x1="-7" y1="-8" x2="-7" y2="-9"/>
      <line class="sch-comp-body" x1="0"  y1="-8" x2="0"  y2="-9"/>
      <line class="sch-comp-body" x1="7"  y1="-8" x2="7"  y2="-9"/>
    `,
  },
  {
    id: 'S00520',
    iec: 'IEC 60617-06-04-02',
    name: 'Генератор',
    group: '06 · Машины',
    refPrefix: 'G',
    w: 18, h: 18,
    pins: [
      { id: '1', x: -9, y: 0 },
      { id: '2', x:  9, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="8"/>
      <text x="0" y="0">G</text>
      <line class="sch-comp-body" x1="-8" y1="0" x2="-9" y2="0"/>
      <line class="sch-comp-body" x1="8"  y1="0" x2="9"  y2="0"/>
    `,
  },
  {
    id: 'S00540',
    iec: 'IEC 60617-06-09-01',
    name: 'Трансформатор 2-обм.',
    group: '06 · Машины',
    refPrefix: 'T',
    w: 22, h: 20,
    pins: [
      { id: 'A', x: -11, y: -6 },
      { id: 'X', x: -11, y:  6 },
      { id: 'a', x:  11, y: -6 },
      { id: 'x', x:  11, y:  6 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="-2" cy="-6" r="2.5"/>
      <circle class="sch-comp-body" cx="-2" cy="-2" r="2.5"/>
      <circle class="sch-comp-body" cx="-2" cy="2"  r="2.5"/>
      <circle class="sch-comp-body" cx="-2" cy="6"  r="2.5"/>
      <circle class="sch-comp-body" cx="2"  cy="-6" r="2.5"/>
      <circle class="sch-comp-body" cx="2"  cy="-2" r="2.5"/>
      <circle class="sch-comp-body" cx="2"  cy="2"  r="2.5"/>
      <circle class="sch-comp-body" cx="2"  cy="6"  r="2.5"/>
      <line class="sch-comp-body" x1="-11" y1="-6" x2="-4.5" y2="-6"/>
      <line class="sch-comp-body" x1="-11" y1="6"  x2="-4.5" y2="6"/>
      <line class="sch-comp-body" x1="4.5"  y1="-6" x2="11" y2="-6"/>
      <line class="sch-comp-body" x1="4.5"  y1="6"  x2="11" y2="6"/>
      <line class="sch-comp-body" x1="0" y1="-9" x2="0" y2="9"/>
    `,
  },

  // ============================================================
  // 02 — Заземления и соединения
  // ============================================================
  {
    id: 'S00810',
    iec: 'IEC 60617-02-15-01',
    name: 'Заземление',
    group: '02 · Провода',
    refPrefix: 'PE',
    w: 8, h: 10,
    pins: [
      { id: '1', x: 0, y: -5 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="0" y1="-5" x2="0" y2="0"/>
      <line class="sch-comp-body" x1="-4" y1="0" x2="4" y2="0"/>
      <line class="sch-comp-body" x1="-2.5" y1="1.5" x2="2.5" y2="1.5"/>
      <line class="sch-comp-body" x1="-1" y1="3" x2="1" y2="3"/>
    `,
  },
  {
    id: 'S00815',
    iec: 'IEC 60617-02-15-03',
    name: 'Заземление защитное',
    group: '02 · Провода',
    refPrefix: 'PE',
    w: 10, h: 10,
    pins: [
      { id: '1', x: 0, y: -5 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="0" y1="-5" x2="0" y2="0"/>
      <circle class="sch-comp-body" cx="0" cy="0" r="2"/>
      <line class="sch-comp-body" x1="-4" y1="2" x2="4" y2="2"/>
      <line class="sch-comp-body" x1="-2.5" y1="3.5" x2="2.5" y2="3.5"/>
      <line class="sch-comp-body" x1="-1" y1="5" x2="1" y2="5"/>
    `,
  },
  {
    id: 'S00820',
    iec: 'IEC 60617-02-02-05',
    name: 'Клемма',
    group: '02 · Провода',
    refPrefix: 'XT',
    w: 8, h: 8,
    pins: [
      { id: '1', x: -4, y: 0 },
      { id: '2', x:  4, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="1.5"/>
      <line class="sch-comp-body" x1="-4" y1="0" x2="-1.5" y2="0"/>
      <line class="sch-comp-body" x1="1.5" y1="0" x2="4" y2="0"/>
    `,
  },

  // ============================================================
  // 08 — Измерительные приборы
  // ============================================================
  {
    id: 'S00910',
    iec: 'IEC 60617-08-08-01',
    name: 'Амперметр',
    group: '08 · Измерения',
    refPrefix: 'PA',
    w: 14, h: 14,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="6"/>
      <text x="0" y="0">A</text>
      <line class="sch-comp-body" x1="-7" y1="0" x2="-6" y2="0"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="7" y2="0"/>
    `,
  },
  {
    id: 'S00920',
    iec: 'IEC 60617-08-08-02',
    name: 'Вольтметр',
    group: '08 · Измерения',
    refPrefix: 'PV',
    w: 14, h: 14,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="6"/>
      <text x="0" y="0">V</text>
      <line class="sch-comp-body" x1="-7" y1="0" x2="-6" y2="0"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="7" y2="0"/>
    `,
  },
  {
    id: 'S00930',
    iec: 'IEC 60617-08-08-04',
    name: 'Ваттметр',
    group: '08 · Измерения',
    refPrefix: 'PW',
    w: 14, h: 14,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="6"/>
      <text x="0" y="0">W</text>
      <line class="sch-comp-body" x1="-7" y1="0" x2="-6" y2="0"/>
      <line class="sch-comp-body" x1="6" y1="0" x2="7" y2="0"/>
    `,
  },

  // ============================================================
  // 08 — Лампы / сигнальные устройства
  // ============================================================
  {
    id: 'S01010',
    iec: 'IEC 60617-08-10-01',
    name: 'Лампа сигнальная',
    group: '08 · Измерения',
    refPrefix: 'HL',
    w: 14, h: 14,
    pins: [
      { id: '1', x: -7, y: 0 },
      { id: '2', x:  7, y: 0 },
    ],
    draw: () => `
      <circle class="sch-comp-body" cx="0" cy="0" r="5"/>
      <line class="sch-comp-body" x1="-3.5" y1="-3.5" x2="3.5" y2="3.5"/>
      <line class="sch-comp-body" x1="-3.5" y1="3.5" x2="3.5" y2="-3.5"/>
      <line class="sch-comp-body" x1="-7" y1="0" x2="-5" y2="0"/>
      <line class="sch-comp-body" x1="5" y1="0" x2="7" y2="0"/>
    `,
  },

  // ============================================================
  // 04 — Батарея / источник постоянного тока
  // ============================================================
  {
    id: 'S01110',
    iec: 'IEC 60617-04-13-01',
    name: 'Аккумулятор',
    group: '04 · Пассивные',
    refPrefix: 'GB',
    w: 16, h: 10,
    pins: [
      { id: '+', x: -8, y: 0 },
      { id: '-', x:  8, y: 0 },
    ],
    draw: () => `
      <line class="sch-comp-body" x1="-8" y1="0" x2="-2" y2="0"/>
      <line class="sch-comp-body" x1="-2" y1="-4" x2="-2" y2="4"/>
      <line class="sch-comp-body" x1="0"  y1="-2" x2="0"  y2="2"/>
      <line class="sch-comp-body" x1="0"  y1="0" x2="8" y2="0"/>
      <text x="-5" y="-4">+</text>
      <text x="3" y="-4">−</text>
    `,
  },
];

/**
 * Группировка по полю group для отображения палитры.
 */
export function getSymbolGroups() {
  const map = new Map();
  for (const s of IEC_SYMBOLS) {
    if (!map.has(s.group)) map.set(s.group, []);
    map.get(s.group).push(s);
  }
  return map;
}

export function getSymbolById(id) {
  return IEC_SYMBOLS.find(s => s.id === id) || null;
}
