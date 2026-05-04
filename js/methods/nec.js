// =========================================================================
// Методика NEC (NFPA 70) — National Electrical Code (США/Канада).
// v0.60.123 (Phase auto-norm): минимальная реализация — wrapper над IEC.
//
// NEC 310.16 (allowable ampacities) и NEC 215.2 (voltage drop) по подходу
// близки к IEC 60364-5-52: ампасити при базовых условиях × фактор
// температуры × фактор группы. Полная NEC требует:
//   - AWG-сечения (1/0, 2/0, 4/0 + размеры в kcmil) — TODO.
//   - Таблицы кондуитов NEC Annex C — TODO.
//   - Specific bundling factors NEC 310.15(B) — TODO.
//
// Сейчас используем IEC-таблицы с метровым сечением (мм²), показываем
// в UI как «NEC (используются IEC-таблицы внутри)». Это даёт корректный
// порядок величины и консервативный результат для проектов в США/Канаде.
// =========================================================================

import iec from './iec.js';

// Переводные термины NEC (минимум для UI; основа взята из IEC).
export const TERMS_NEC = {
  utilization:    { label: 'demand factor (DF)',                short: 'DF',      explain: 'NEC 220.42 — demand factor — fraction of rated load actually used', aliases: 'IEC: k_u, ПУЭ: Ки', used: true },
  peakDemand:     { label: 'maximum demand',                    short: 'M_dem',   explain: 'NEC 220.40 — total connected load × demand factor',               aliases: 'РТМ: Кмакс',          used: false },
  simultaneity:   { label: 'diversity (load diversity)',         short: 'div',    explain: 'fraction of loads operating simultaneously',                       aliases: 'IEC: k_s',            used: true },
  effectiveCount: { label: '',                                   short: '',       explain: '',                                                                  aliases: '',                    used: false },
  powerFactor:    { label: 'power factor (PF)',                  short: 'PF',     explain: 'NEC 220.61 — ratio of W to VA',                                    aliases: 'IEC/ПУЭ: cos φ',      used: true },
  inrush:         { label: 'locked rotor / inrush ratio',        short: 'LRA',    explain: 'NEC 430-related — starting current multiplier',                    aliases: 'IEC: Ist/In',         used: true },
};

export default {
  ...iec,
  id: 'nec',
  label: 'NEC (NFPA 70)',
  terms: TERMS_NEC,

  // NEC использует AWG, но т.к. внутри расчёт через IEC-таблицы — оставляем
  // мм²-сечения. UI показывает label «NEC (IEC-tables internally)».
  // Полная AWG-поддержка — TODO Phase NEC.full.

  materials: { Cu: 'Copper (Cu)', Al: 'Aluminum (Al)' },
  insulations: {
    // NEC использует THWN/THHN/XHHW etc. Показываем mapping:
    PVC:  'THWN/THWN-2 (PVC equivalent)',
    XLPE: 'XHHW-2 (XLPE equivalent)',
  },
  cableTypes: {
    multi:  'Multi-conductor (THWN-cable / NM)',
    single: 'Single-conductor (THWN)',
    solid:  'Solid conductor',
  },
};
