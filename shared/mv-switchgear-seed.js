// ======================================================================
// shared/mv-switchgear-seed.js
// Базовый набор распределительных устройств среднего напряжения:
//   - Schneider RM6 (ringmain SF6)
//   - SafeRing (китайский аналог RM6, DEKRAJ и др.)
//   - ЩО-70 (советские сборные ячейки с выключателями нагрузки)
//   - Дополнительно: типовые ячейки ЦОИ-10, КСО-272
//
// Регистрируются как builtin через catalog-bridge при старте приложения.
// Используются в MV-конфигураторе (Фаза 1.19) и инспекторе трансформатора
// на главной схеме.
// ======================================================================

import { createMvSwitchgearElement, createMvCellElement } from './element-schemas.js';

// ==================== Schneider Electric RM6 ====================
// Компактный ringmain в SF6 для 24 кВ сетей. Стандартные конфигурации:
//   II   — 2 ввода (кабельные)         — без защиты, чистый RMU
//   III  — 2 ввода + 1 защита          — ввод 2 × + 1 transformer-protect
//   IIDI — 2 ввода + 2 защиты          — большая подстанция
//   DI   — 1 ввод + 1 защита           — концевая
//   NE-I, NE-II, NE-III ... — модификации с защитой вакуумным выключателем
//
// Номенклатура по функциям (3 ячейки):
//   I = isolator (switch-disconnector 630A)
//   Q = кабельная ячейка с выключателем нагрузки
//   B = выключатель нагрузки + заземлитель
//   D = transformer-protection (SF6 switch + 3 fuses)
//   V = VCB (vacuum circuit breaker)
//   N = digital-ready

const RM6_VARIANTS = [
  // { variant, cells: [...], width }
  { variant: 'II',    cells: ['switch-in', 'switch-in'],                 width: 696 },
  { variant: 'III',   cells: ['switch-in', 'switch-in', 'trafo-protect'], width: 1088 },
  { variant: 'IIDI',  cells: ['switch-in', 'switch-in', 'trafo-protect', 'trafo-protect'], width: 1480 },
  { variant: 'DI',    cells: ['switch-in', 'trafo-protect'],             width: 892 },
  { variant: 'IDI',   cells: ['switch-in', 'trafo-protect', 'switch-in'], width: 1088 },
  { variant: 'IIV',   cells: ['switch-in', 'switch-in', 'vcb'],          width: 1088 },
  { variant: 'IV',    cells: ['switch-in', 'vcb'],                       width: 892 },
];

function _rm6Cells(variant) {
  return RM6_VARIANTS.find(v => v.variant === variant)?.cells || [];
}

function _rm6ToCellRecords(cells) {
  return cells.map((type, i) => {
    if (type === 'switch-in') {
      return {
        position: i + 1,
        type: 'infeed',
        In: 630,
        breakerType: 'switch',
        fuseRating_A: null,
        functionDesc: 'Кабельный ввод с выключателем нагрузки + заземлитель',
      };
    }
    if (type === 'trafo-protect') {
      return {
        position: i + 1,
        type: 'transformer-protect',
        In: 200,
        breakerType: 'fuse-switch',
        fuseRating_A: 63,   // стандарт для 630 кВА / 10 кВ
        functionDesc: 'Защита трансформатора: switch-disconnector + 3× HV-fuse',
      };
    }
    if (type === 'vcb') {
      return {
        position: i + 1,
        type: 'feeder',
        In: 630,
        breakerType: 'VCB',
        fuseRating_A: null,
        protectionRelay: 'SEPAM series',
        functionDesc: 'Вакуумный выключатель с защитой',
      };
    }
    return { position: i + 1, type: 'feeder', In: 630 };
  });
}

function seedRM6() {
  const out = [];
  for (const v of RM6_VARIANTS) {
    const cells = _rm6ToCellRecords(v.cells);
    out.push(createMvSwitchgearElement({
      id: 'schneider-rm6-' + v.variant.toLowerCase(),
      manufacturer: 'Schneider Electric',
      series: 'RM6',
      variant: v.variant,
      label: `RM6 ${v.variant}`,
      description: `Компактное моноблочное РУ в SF6, 24 кВ, конфигурация ${v.variant} (${cells.length} ячеек)`,
      mvType: 'ringmain',
      Un_kV: 24,
      Uw_kV: 28,
      In_A: 630,
      Ip_kA: 52.5,   // электродинамическая стойкость
      It_kA: 21,     // термическая 1 с
      cells,
      insulation: 'sf6',
      arcProof: true,
      IP: 'IP67',    // для газового моноблока
      form: 'LSC2A-PM',
      expandable: false,
      widthMm: v.width,
      heightMm: 1375,
      depthMm: 735,
      weightKg: 300 + cells.length * 30,
      source: 'builtin',
      builtin: true,
      tags: ['RMU', 'SF6', 'ringmain', '24kV'],
    }));
  }
  return out;
}

// ==================== ABB SafeRing (ringmain SF6, 12/24 кВ) ====================
// Компактное кольцевое РУ SF6 производства ABB — европейский аналог
// Schneider RM6. Типовая номенклатура: CC, CCF, CCCF, CVF, CVV, VVV
// (C = switch-infeed, V = VCB, F = fuse-switch trafo-protect).

const SAFERING_VARIANTS = [
  { variant: 'CC',   cells: ['switch-in', 'switch-in'],                      width: 700 },
  { variant: 'CCF',  cells: ['switch-in', 'switch-in', 'trafo-protect'],     width: 1050 },
  { variant: 'CCCF', cells: ['switch-in', 'switch-in', 'switch-in', 'trafo-protect'], width: 1400 },
  { variant: 'CVF',  cells: ['switch-in', 'vcb', 'trafo-protect'],           width: 1050 },
  { variant: 'CVV',  cells: ['switch-in', 'vcb', 'vcb'],                     width: 1050 },
  { variant: 'VVV',  cells: ['vcb', 'vcb', 'vcb'],                           width: 1050 },
];

function seedSafeRing() {
  const out = [];
  for (const v of SAFERING_VARIANTS) {
    const cells = _rm6ToCellRecords(v.cells);
    out.push(createMvSwitchgearElement({
      id: 'safering-' + v.variant.toLowerCase(),
      manufacturer: 'ABB',
      series: 'SafeRing',
      variant: v.variant,
      label: `SafeRing ${v.variant}`,
      description: `Компактное РУ в SF6, 12 кВ, конфигурация ${v.variant} (${cells.length} ячеек)`,
      mvType: 'ringmain',
      Un_kV: 12,
      Uw_kV: 12,
      In_A: 630,
      Ip_kA: 50,
      It_kA: 20,
      cells,
      insulation: 'sf6',
      arcProof: true,
      IP: 'IP67',
      form: 'LSC2A-PM',
      expandable: false,
      widthMm: v.width,
      heightMm: 1450,
      depthMm: 800,
      weightKg: 320 + cells.length * 35,
      source: 'builtin',
      builtin: true,
      tags: ['RMU', 'SF6', 'ringmain', '12kV', 'China'],
    }));
  }
  return out;
}

// ==================== ЩО-70 (советские сборные ячейки) ====================
// Сборные из отдельных ячеек (камер) шириной 750-1000 мм. Несколько типов
// по назначению: ВЛВ (ввод выключатель), ВЛВО (отходящая), ТТ (измерения),
// ССВ (секционная) и т.п.
//
// В справочнике даём конфигурацию «по умолчанию» на 10 кВ:
//  - ШО-70-1 ВЛВ-630   — ввод с выключателем
//  - ШО-70-2 ВЛВО-630  — отходящая линия
//  - ШО-70-3 ТТ        — измерения (ТН + учёт)
//  - ШО-70-4 ССВ-630   — секционная

const SHO70_CELLS = [
  { variant: 'ВЛВ-630',    cellType: 'infeed',               In: 630,  breakerType: 'VCB',
    desc: 'Ввод с вакуумным выключателем, 10 кВ, 630 А' },
  { variant: 'ВЛВО-630',   cellType: 'feeder',               In: 630,  breakerType: 'VCB',
    desc: 'Отходящая линия с вакуумным выключателем' },
  { variant: 'ТТ',         cellType: 'measurement',          In: 100,  breakerType: 'none',
    desc: 'Ячейка измерений: ТН + коммерческий учёт' },
  { variant: 'ССВ-630',    cellType: 'busCoupler',           In: 630,  breakerType: 'VCB',
    desc: 'Секционная ячейка с выключателем' },
  { variant: 'ТСН',        cellType: 'transformer-protect',  In: 100,  breakerType: 'fuse-switch',
    desc: 'Трансформатор собственных нужд (16-100 кВА)' },
  { variant: 'Р-Н',        cellType: 'earthing',             In: 0,    breakerType: 'earthing-switch',
    desc: 'Заземляющая ячейка (разъединитель с ножами заземления)' },
];

function seedSho70() {
  const out = [];
  // Ячейки ЩО-70 как отдельные mv-cell элементы
  for (const c of SHO70_CELLS) {
    out.push(createMvCellElement({
      id: 'sho70-' + c.variant.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      manufacturer: 'ЩО-70',
      series: 'ЩО-70',
      variant: c.variant,
      label: `ЩО-70 ${c.variant}`,
      description: c.desc,
      cellType: c.cellType,
      Un_kV: 10,
      In_A: c.In,
      breakerType: c.breakerType,
      Icu_kA: 20,
      fuseRating_A: c.breakerType === 'fuse-switch' ? 63 : null,
      protectionRelay: ['VCB'].includes(c.breakerType) ? 'SPAC-805' : null,
      functionDesc: c.desc,
      widthMm: 750,
      heightMm: 2300,
      depthMm: 1000,
      weightKg: 600,
      source: 'builtin',
      builtin: true,
      tags: ['ЩО-70', 'СН', '10kV', 'сборная'],
    }));
  }
  // Типовая сборка ЩО-70 для ТП 2×1000 кВА (6 ячеек)
  out.push(createMvSwitchgearElement({
    id: 'sho70-typical-6cells',
    manufacturer: 'ЩО-70',
    series: 'ЩО-70',
    variant: 'Типовая 6 ячеек',
    label: 'ЩО-70 (типовая 6 ячеек)',
    description: 'Типовая сборка ЩО-70 для ТП 2×1000 кВА: 2 ввода + 1 ССВ + 2 отх + 1 ТН',
    mvType: 'panelboard',
    Un_kV: 10,
    Uw_kV: 12,
    In_A: 630,
    Ip_kA: 51,
    It_kA: 20,
    cells: [
      { position: 1, type: 'infeed',               In: 630, breakerType: 'VCB',   functionDesc: 'Ввод 1 (ВЛВ-630)' },
      { position: 2, type: 'infeed',               In: 630, breakerType: 'VCB',   functionDesc: 'Ввод 2 (ВЛВ-630)' },
      { position: 3, type: 'busCoupler',           In: 630, breakerType: 'VCB',   functionDesc: 'Секционная (ССВ-630)' },
      { position: 4, type: 'feeder',               In: 630, breakerType: 'VCB',   functionDesc: 'Отходящая 1 (ВЛВО-630)' },
      { position: 5, type: 'feeder',               In: 630, breakerType: 'VCB',   functionDesc: 'Отходящая 2 (ВЛВО-630)' },
      { position: 6, type: 'measurement',          In: 100, breakerType: 'none',  functionDesc: 'Учёт (ТТ)' },
    ],
    insulation: 'air',
    arcProof: false,
    IP: 'IP31',
    form: 'LSC1',
    expandable: true,
    widthMm: 750 * 6,
    heightMm: 2300,
    depthMm: 1000,
    weightKg: 3800,
    source: 'builtin',
    builtin: true,
    tags: ['ЩО-70', 'СН', '10kV', 'сборная', 'panelboard'],
  }));
  return out;
}

// ==================== Все builtin MV ====================

export function listBuiltinMvSwitchgear() {
  return [
    ...seedRM6(),
    ...seedSafeRing(),
    ...seedSho70(),
  ];
}
