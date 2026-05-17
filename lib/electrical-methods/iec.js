// =========================================================================
// Методика IEC 60364-5-52 — обёртка над существующим engine/cable.js
// =========================================================================

import {
  selectCableSize, selectBreaker as _selectBreaker, cableTable,
  kTempLookup, kGroupLookup, kBundlingFactor
} from '../../js/engine/cable.js';

import {
  INSTALL_METHODS, CABLE_TYPES, IEC_TABLES,
  BREAKER_SERIES, GLOBAL
} from '../../js/engine/constants.js';

// ================= Терминология IEC =================
// v0.59.658: термины параметров с точки зрения IEC 60364.
// Юзер: «термины лучше отнести непосредственно к методикам, в отдельных
// файлах для каждой методики».
export const TERMS_IEC = {
  utilization:    { label: 'k_u — utilization factor',           short: 'k_u',     explain: 'доля от номинальной мощности, фактически используемая ЭП (IEC 60364-1, §4)', aliases: 'РТМ/ПУЭ: Ки (коэффициент использования)', used: true },
  peakDemand:     { label: 'peak demand factor',                  short: 'k_pd',    explain: 'отношение пикового получасового спроса к средней нагрузке',                  aliases: 'РТМ: Кмакс; ПУЭ: К_расч',                 used: false },
  simultaneity:   { label: 'k_s — diversity factor',              short: 'k_s',     explain: 'учитывает что не все нагрузки достигают пика одновременно (IEC 60364-1, §4)', aliases: 'РТМ/ПУЭ: Ко (коэффициент одновременности)', used: true },
  effectiveCount: { label: '',                                    short: '',        explain: '',                                                                            aliases: '',                                          used: false },
  powerFactor:    { label: 'cos φ (power factor)',                short: 'PF',      explain: 'ratio of active to apparent power (P/S)',                                     aliases: 'РТМ/ПУЭ: cos φ',                          used: true },
  inrush:         { label: 'Starting current ratio (Ist/In)',     short: 'Ist/In',  explain: 'inrush current as multiple of rated current',                                 aliases: 'РТМ/ПУЭ: кратность пускового тока',       used: true },
};

// ================= Публичный интерфейс методики =================

export default {
  id: 'iec',
  label: 'IEC 60364-5-52',
  // D4/D5: harmonization-метаданные (аддитивно, не ломают потребителей).
  standard: 'IEC 60364-5-52',
  region: 'INT',
  version: '1.0',
  enabled: true,
  discipline: 'electrical',
  terms: TERMS_IEC,

  materials: { Cu: 'Медь (Cu)', Al: 'Алюминий (Al)' },
  insulations: { PVC: 'ПВХ', XLPE: 'СПЭ (XLPE)' },
  cableTypes: {
    multi:  'Многожильный',
    single: 'Одножильный',
    solid:  'Цельная жила',
  },

  installMethods: Object.fromEntries(
    Object.entries(INSTALL_METHODS).map(([k, v]) => [k, v.label])
  ),
  defaultMethod: 'B1',

  // IEC имеет bundling
  hasBundling: true,
  bundlingOptions: {
    touching: 'Вплотную (touching)',
    spaced:   'С зазором (spaced)',
    bundled:  'В пучке (bundled)',
  },

  /** Стандартные сечения из таблиц IEC */
  availableSizes(material, insulation, method) {
    const t = cableTable(material || 'Cu', insulation || 'PVC', method || 'B1');
    return t.map(([s]) => s);
  },

  /**
   * Подбор сечения по IEC 60364-4-43.
   * @param {number} I — расчётный ток, А
   * @param {object} opts — параметры
   * @returns {object} результат подбора
   */
  selectCable(I, opts) {
    const o = opts || {};
    const result = selectCableSize(I, {
      material:              o.material,
      insulation:            o.insulation,
      method:                o.method,
      ambientC:              o.ambient,
      grouping:              o.grouping,
      bundling:              o.bundling,
      cableType:             o.cableType,
      maxSize:               o.maxSize,
      conductorsInParallel:  o.parallel,
      breakerCurve:          o.breakerCurve || 'MCB_C',
      breakerMarginPct:      o.breakerMarginPct || 0,
      protectionMode:        o.protectionMode || 'individual',
      allowAutoParallel:     true,
    });
    return result;
  },

  selectBreaker(I) {
    return _selectBreaker(I);
  },
};
