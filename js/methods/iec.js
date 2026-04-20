// =========================================================================
// Методика IEC 60364-5-52 — обёртка над существующим engine/cable.js
// =========================================================================

import {
  selectCableSize, selectBreaker as _selectBreaker, cableTable,
  kTempLookup, kGroupLookup, kBundlingFactor
} from '../engine/cable.js';

import {
  INSTALL_METHODS, CABLE_TYPES, IEC_TABLES,
  BREAKER_SERIES, GLOBAL
} from '../engine/constants.js';

// ================= Публичный интерфейс методики =================

export default {
  id: 'iec',
  label: 'IEC 60364-5-52',

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
