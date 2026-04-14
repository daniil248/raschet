// =========================================================================
// Методика ПУЭ 7 (Правила устройства электроустановок, 7-е издание)
// Таблицы 1.3.4–1.3.7 — допустимые длительные токи
// Таблицы 1.3.3, 1.3.26 — поправочные коэффициенты
// =========================================================================

import { BREAKER_SERIES, GLOBAL } from '../engine/constants.js';

// ================= Таблицы допустимых токов =================

// Таблица 1.3.4 — Медные проводники с ПВХ/резиновой изоляцией
// [сечение мм², 2 одножильных, 3 одножильных, 1 двухжильный, 1 трёхжильный]
// Для трубы: берём «3 одножильных» или «1 трёхжильный» в зависимости от cableType
// Для открытой прокладки: используем таблицу 1.3.6

// Таблица 1.3.4 — Cu, ПВХ, в трубе
const CU_PVC_PIPE = [
  //  S,   2×1ж, 3×1ж, 1×2ж, 1×3ж
  [1.5,   17,   15,   16,   14],
  [2.5,   23,   21,   21,   19],
  [4,     32,   27,   27,   25],
  [6,     40,   34,   34,   32],
  [10,    55,   50,   46,   42],
  [16,    80,   70,   61,   55],
  [25,   100,   85,   80,   75],
  [35,   125,  100,   95,   90],
  [50,   160,  135,  120,  110],
  [70,   195,  175,  150,  140],
  [95,   245,  215,  190,  170],
  [120,  295,  250,  220,  200],
  [150,  340,  290,  255,  235],
  [185,  390,  335,  290,  270],
  [240,  465,  395,  345,  310],
];

// Таблица 1.3.5 — Al, ПВХ, в трубе
const AL_PVC_PIPE = [
  [2.5,   19,   16,   17,   14],
  [4,     25,   21,   21,   19],
  [6,     32,   26,   26,   24],
  [10,    42,   38,   36,   32],
  [16,    60,   55,   49,   42],
  [25,    80,   65,   60,   56],
  [35,    95,   75,   73,   65],
  [50,   130,  105,   95,   85],
  [70,   165,  135,  120,  105],
  [95,   200,  170,  150,  135],
  [120,  230,  200,  175,  160],
  [150,  270,  235,  200,  185],
  [185,  310,  270,  235,  215],
  [240,  370,  320,  275,  250],
];

// Таблица 1.3.6 — Cu, открытая прокладка (ПВХ/резина)
const CU_PVC_OPEN = [
  //  S,   2×1ж, 3×1ж, 1×2ж, 1×3ж
  [1.5,   23,   19,   21,   19],
  [2.5,   30,   27,   27,   25],
  [4,     41,   38,   38,   35],
  [6,     50,   46,   44,   42],
  [10,    80,   70,   60,   55],
  [16,   100,   90,   80,   75],
  [25,   140,  115,  100,   95],
  [35,   170,  140,  125,  120],
  [50,   215,  175,  160,  145],
  [70,   270,  215,  195,  180],
  [95,   325,  265,  245,  220],
  [120,  385,  310,  285,  260],
  [150,  440,  355,  330,  305],
  [185,  510,  410,  380,  350],
  [240,  605,  490,  450,  410],
];

// Таблица 1.3.6 — Al, открытая прокладка
const AL_PVC_OPEN = [
  [2.5,   24,   20,   22,   19],
  [4,     32,   28,   28,   26],
  [6,     39,   36,   32,   30],
  [10,    60,   50,   47,   39],
  [16,    75,   60,   60,   55],
  [25,   105,   85,   80,   70],
  [35,   130,  105,   95,   85],
  [50,   165,  135,  120,  110],
  [70,   210,  165,  150,  140],
  [95,   250,  200,  190,  170],
  [120,  295,  240,  220,  200],
  [150,  340,  275,  255,  235],
  [185,  390,  315,  290,  270],
  [240,  465,  375,  350,  315],
];

// Таблица 1.3.7 — кабели в земле (Cu и Al, ПВХ)
const CU_PVC_GROUND = [
  //  S,   1×3ж
  [1.5,   27],
  [2.5,   36],
  [4,     47],
  [6,     60],
  [10,    83],
  [16,   110],
  [25,   150],
  [35,   175],
  [50,   215],
  [70,   265],
  [95,   315],
  [120,  355],
  [150,  400],
  [185,  450],
  [240,  520],
];

const AL_PVC_GROUND = [
  [2.5,   29],
  [4,     36],
  [6,     46],
  [10,    63],
  [16,    85],
  [25,   115],
  [35,   135],
  [50,   165],
  [70,   200],
  [95,   245],
  [120,  275],
  [150,  310],
  [185,  350],
  [240,  400],
];

// ================= Поправочные коэффициенты =================

// Таблица 1.3.3 — поправка на температуру окружающей среды
// Нормируется к +25°C (ПУЭ нормирует при 25°C, не 30°C как IEC)
const K_TEMP_PUE = {
  // tMax = 65°C для ПВХ, 90°C для XLPE
  PVC:  { 10: 1.18, 15: 1.14, 20: 1.10, 25: 1.00, 30: 0.94, 35: 0.87, 40: 0.79, 45: 0.71, 50: 0.61 },
  XLPE: { 10: 1.12, 15: 1.09, 20: 1.06, 25: 1.00, 30: 0.96, 35: 0.92, 40: 0.88, 45: 0.83, 50: 0.78 },
};

// Таблица 1.3.26 ПУЭ — поправка на число кабелей в группе
// В пучке (bundle) — аналог IEC bundle
const K_GROUP_PUE_BUNDLE = {
  1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.55,
};
// В ряд однослойно (rows) — аналог IEC layer
const K_GROUP_PUE_ROWS = {
  1: 1.00, 2: 0.85, 3: 0.79, 4: 0.75, 5: 0.73, 6: 0.72,
};

// ================= Внутренние функции =================

function kTempPue(t, insulation) {
  const tbl = K_TEMP_PUE[insulation || 'PVC'] || K_TEMP_PUE.PVC;
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - t) < Math.abs(best - t)) best = k;
  return tbl[best];
}

function kGroupPue(n, bundling) {
  if (bundling === 'spaced') return 1.0; // с зазором — без снижения
  const table = bundling === 'rows' ? K_GROUP_PUE_ROWS : K_GROUP_PUE_BUNDLE;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const v = Math.max(1, n | 0);
  let best = table[1];
  for (const k of keys) { if (k <= v) best = table[k]; }
  return best;
}

/**
 * Получить таблицу допустимых токов для заданных условий.
 * Возвращает массив [[сечение, ток], ...]
 */
function getTable(material, method, cableType) {
  // Определяем индекс столбца:
  // 0 = сечение, 1 = 2×1ж, 2 = 3×1ж, 3 = 1×2ж, 4 = 1×3ж
  let colIdx;
  if (cableType === 'single') {
    colIdx = 2; // 3 одножильных
  } else {
    colIdx = 4; // 1 трёхжильный (по умолчанию для multi/solid)
  }

  let rawTable;
  if (method === 'ground') {
    // Для земли — только трёхжильный, отдельная таблица
    rawTable = material === 'Al' ? AL_PVC_GROUND : CU_PVC_GROUND;
    return rawTable.map(row => [row[0], row[1]]);
  } else if (method === 'open') {
    rawTable = material === 'Al' ? AL_PVC_OPEN : CU_PVC_OPEN;
  } else {
    // pipe (в трубе) — по умолчанию
    rawTable = material === 'Al' ? AL_PVC_PIPE : CU_PVC_PIPE;
  }

  return rawTable.map(row => [row[0], row[colIdx] || row[row.length - 1]]);
}

function selectBreakerPue(Iload) {
  for (const In of BREAKER_SERIES) {
    if (In >= Iload) return In;
  }
  return BREAKER_SERIES[BREAKER_SERIES.length - 1];
}

// ================= Публичный интерфейс =================

export default {
  id: 'pue',
  label: 'ПУЭ 7',

  materials: { Cu: 'Медь (Cu)', Al: 'Алюминий (Al)' },
  insulations: { PVC: 'ПВХ / резина' },
  cableTypes: {
    multi:  'Многожильный (3ж)',
    single: 'Одножильный',
  },

  installMethods: {
    pipe:   'В трубе / коробе',
    open:   'Открытая прокладка',
    ground: 'В земле',
  },
  defaultMethod: 'pipe',

  hasBundling: true,
  bundlingOptions: {
    bundle: 'В пучке',
    rows:   'В ряд (однослойно)',
    spaced: 'С зазором',
  },

  availableSizes(material, insulation, method) {
    const t = getTable(material || 'Cu', method || 'pipe', 'multi');
    return t.map(([s]) => s);
  },

  /**
   * Подбор сечения по ПУЭ.
   * Правило: Iдоп ≥ Iрасч (с учётом поправок)
   */
  selectCable(I, opts) {
    const o = opts || {};
    const material   = o.material || 'Cu';
    const insulation = o.insulation || 'PVC';
    const method     = o.method || 'pipe';
    const cableType  = o.cableType || 'multi';
    const ambient    = Number(o.ambient) || 25;
    const grouping   = Number(o.grouping) || 1;
    const bundling   = o.bundling || 'bundle';
    const maxSize    = Number(o.maxSize) || 240;
    const basePar    = Math.max(1, Number(o.parallel) || 1);

    const table = getTable(material, method, cableType);
    const kT = kTempPue(ambient, insulation);
    const kG = method !== 'ground' ? kGroupPue(grouping, bundling) : 1.0;
    const k = kT * kG;

    const effTable = table.filter(([s]) => s <= maxSize);

    function tryWithParallel(parallel) {
      const Iper = I / parallel;
      for (const [s, iRef] of effTable) {
        const iDerated = iRef * k;
        if (iDerated >= Iper) {
          return { s, iAllowed: iRef, iDerated, parallel };
        }
      }
      return null;
    }

    let res = tryWithParallel(basePar);
    let autoParallel = false;

    if (!res) {
      const maxPar = Math.max(basePar, Number(GLOBAL.maxParallelAuto) || 10);
      for (let par = basePar + 1; par <= maxPar; par++) {
        res = tryWithParallel(par);
        if (res) { autoParallel = true; break; }
      }
    }

    if (res) {
      return {
        s: res.s,
        iAllowed: res.iAllowed,
        iDerated: res.iDerated,
        kT, kG,
        material, insulation, method, bundling,
        cableType,
        parallel: res.parallel,
        autoParallel,
        totalCapacity: res.iDerated * res.parallel,
      };
    }

    // overflow
    const last = effTable[effTable.length - 1] || table[table.length - 1];
    return {
      s: last[0], iAllowed: last[1], iDerated: last[1] * k,
      kT, kG,
      material, insulation, method, bundling, cableType,
      parallel: basePar,
      autoParallel: false,
      totalCapacity: last[1] * k * basePar,
      overflow: true,
    };
  },

  selectBreaker(I) {
    return selectBreakerPue(I);
  },
};
