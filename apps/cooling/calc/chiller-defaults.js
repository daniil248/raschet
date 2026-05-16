// =============================================================================
// cooling/calc/chiller-defaults.js — спецификация чиллера/DX-системы
// =============================================================================
// Default-значения и типы (system / FC mode / etc.). Вынесено в отдельный
// файл чтобы оба слоя (calc + ui) разделяли одни константы без циклов.
//
// NO DOM. Pure data + helpers.

/**
 * Default chiller / DX-system specification.
 *
 * Поля:
 *   systemType:           'chiller' | 'dx-air' | 'dx-pumped-fc'
 *   ratedCapKw:           rated cooling capacity (Q_rated), кВт
 *   ratedCOP:             rated COP при ratedAmbient (Q/P)
 *   ambientRated:         T_amb °C при котором задан rated (ASHRAE = 35°C)
 *   capCorrPctPerC:       capacity correction %/°C (типично -1.5 для air-cooled)
 *   partLoadCurve:        'iplv' | 'fixed' — кривая COP по T_amb
 *
 *   freeCoolingMode:      'none' | 'dry' | 'wet' (для systemType='chiller')
 *   chwsTemp:             chilled water supply T, °C
 *   freeCoolingApproach:  ΔT для 100% FC, °C
 *   freeCoolingAuxPctOfRated: aux power во время FC, % от ratedCap
 *
 *   dxPumpedThresholdDb:  T_db threshold для DX-pumped (бинарный режим)
 *   dxPumpedAuxPctOfRated: aux power насоса хладагента, % от ratedCap
 */
export const DEFAULT_CHILLER = {
  systemType: 'chiller',
  ratedCapKw: 0,
  ratedCOP: 3.5,
  capCorrPctPerC: -1.5,
  ambientRated: 35,
  partLoadCurve: 'iplv',
  freeCoolingMode: 'none',
  chwsTemp: 12,
  freeCoolingApproach: 5,
  freeCoolingAuxPctOfRated: 5,
  dxPumpedThresholdDb: 13,
  dxPumpedAuxPctOfRated: 3,
};

/**
 * Описание типов систем для UI (label + tooltip).
 *
 * v0.59.996: добавлены типы CRAC (Computer Room Air Conditioner) для
 * водяных систем охлаждения с привязкой к чиллеру в топологии (Phase 22.10).
 *
 * Группировка по физике:
 *   • Standalone (полная система): chiller / dx-air / dx-pumped-fc
 *   • CRAC (требует upstream чиллера в топологии): crac-water /
 *     crac-water+compressor / crac-water+fc-loop
 *
 * CRAC-типы используются в bin-calc как «потребители холода» — их
 * холодопроизводительность суммируется и подаётся как нагрузка на
 * чиллеры (calc/topology.js).
 */
export const SYSTEM_TYPES = [
  { id: 'chiller',       label: 'Чиллер (CHW)', kind: 'plant',
    desc: 'Чиллер с водяным контуром. Поддерживает free-cooling (dry/wet).' },
  { id: 'dx-air',        label: 'DX air-cooled (RTU/сплит)', kind: 'plant',
    desc: 'DX (direct expansion), воздушный конденсатор. Автономен, без FC.' },
  { id: 'dx-pumped-fc',  label: 'DX с pumped refrigerant FC', kind: 'plant',
    desc: 'DX с насосом хладагента (Liebert/Vertiv). При низкой T_amb компрессор отключается.' },
  { id: 'crac-water',    label: 'CRAC водяной (от чиллера)', kind: 'crac',
    desc: 'Водяной CRAC: пассивный fan-coil, теплоноситель — холодная вода от чиллера. В топологии нагрузка суммируется и подаётся на чиллеры.' },
  { id: 'crac-water+compressor', label: 'CRAC водяной + компрессор (DX-glycol гибрид)', kind: 'crac',
    desc: 'Водяной CRAC с компрессором на борту. Летом работает как DX, зимой переключается на glycol-loop free-cooling от dry cooler. Резервирует чиллер при отказе.' },
  { id: 'crac-water+fc-loop',    label: 'CRAC + контур фрикулинга (Stulz CyberHandler)', kind: 'crac',
    desc: 'Водяной CRAC с отдельным контуром фрикулинга (двухконтурный, dual-circuit). При низкой T_amb работает 100% на FC без участия компрессора. Пример: Stulz CyberHandler 2.' },
];

/**
 * Какие из system-types относятся к CRAC (требуют upstream-чиллера).
 */
export const CRAC_TYPES = SYSTEM_TYPES.filter(t => t.kind === 'crac').map(t => t.id);

/**
 * Является ли тип CRAC-ом (нагрузкой на чиллер).
 */
export function isCracType(systemType) { return CRAC_TYPES.includes(systemType); }

/**
 * Описание режимов фрикулинга для UI.
 */
export const FC_MODES = [
  { id: 'none', label: 'Нет (только компрессор)' },
  { id: 'dry',  label: 'Dry (drycooler, T_db)' },
  { id: 'wet',  label: 'Wet (градирня, T_wb)' },
];

/**
 * Метаданные столбцов annual-таблицы. tip = расширенное описание для
 * tooltip и help-панели.
 */
export const COLUMNS = [
  { id: 'tBin',     label: 'T наружн., °C',
    tip: 'Интервал температуры наружного воздуха (по сухому термометру), целое число °C. Записи группируются по floor(T) — например, в строку «5» попадают часы с T от 5.0 до 5.999°C.',
    fmt: v => v.tBin },
  { id: 'hours',    label: 'Часов в году',
    tip: 'Сколько часов в году температура попадала в этот интервал. Σ по всем строкам ≈ 8766 (365.25 × 24).',
    fmt: v => v.hours.toFixed(0) },
  { id: 'days',     label: 'Дней в году',
    tip: 'Дней в году = часов / 24.',
    fmt: v => v.days.toFixed(2) },
  { id: 'pct',      label: '% года',
    tip: 'Доля года = часов / 8766 × 100.',
    fmt: v => v.pct.toFixed(2) },
  { id: 'rhAvg',    label: 'Средн. RH, %',
    tip: 'Средняя относительная влажность в этом интервале температуры.',
    fmt: v => v.rhAvg != null ? v.rhAvg.toFixed(0) : '' },
  { id: 'twbAvg',   label: 'Средн. T_wb, °C',
    tip: 'Средний wet-bulb (Stull 2011). Используется как T_ref для wet free-cooling (cooling tower).',
    fmt: v => v.twbAvg != null ? v.twbAvg.toFixed(1) : '' },
  { id: 'cumPct',   label: 'Кумул. %',
    tip: 'Кумулятивный % года (от низких T к высоким).',
    fmt: v => v.cumPct.toFixed(1) },
  // Chiller / DX columns (default false; auto-enable когда задана spec)
  { id: 'capacity', label: 'Capacity, кВт',
    tip: 'Холодопроизводительность при T_amb. Capacity = ratedCap × (1 + capCorr × (T − T_rated)).',
    chiller: true, fmt: v => v.capacity != null ? v.capacity.toFixed(1) : '' },
  { id: 'copMech',  label: 'COP_mech',
    tip: 'COP компрессорного охлаждения. IPLV: COP × (1 + 0.02 × (T_rated − T)) clamp [0.6×; 1.8×].',
    chiller: true, fmt: v => v.copMech != null ? v.copMech.toFixed(2) : '' },
  { id: 'fcFraction', label: 'FC %',
    tip: 'Доля фрикулинга в этом интервале. 100% = компрессор off; 0% = только мех. охл.',
    chiller: true, fmt: v => v.fcFraction != null ? (v.fcFraction * 100).toFixed(0) : '' },
  { id: 'cop',      label: 'COP_eff',
    tip: 'Эффективный COP с учётом FC = capacity / (P_compressor + P_aux). При 100% FC может быть 15–30.',
    chiller: true, fmt: v => v.cop != null ? v.cop.toFixed(2) : '' },
  { id: 'power',    label: 'Σ Мощность, кВт',
    tip: 'Σ электрическая мощность: P = (1−fc) × Cap / COP_mech + P_aux.',
    chiller: true, fmt: v => v.power != null ? v.power.toFixed(2) : '' },
  { id: 'energy',   label: 'Энергия, кВт·ч/год',
    tip: 'Годовая энергия в этом интервале = Σ Мощность × часов.',
    chiller: true, fmt: v => v.energy != null ? v.energy.toFixed(0) : '' },
];

/**
 * Default-набор отображаемых столбцов (без chiller).
 */
export const DEFAULT_COLS = ['tBin', 'hours', 'days', 'rhAvg'];

/**
 * Список chiller-колонок, которые auto-включаются при заданной spec.
 */
export const CHILLER_COLS = ['capacity', 'copMech', 'fcFraction', 'cop', 'power', 'energy'];
