import { GLOBAL, IEC_TABLES, HV_TABLES, BREAKER_SERIES, HV_BREAKER_SERIES, K_TEMP, K_GROUP_TABLES, INSTALL_METHODS, CABLE_TYPES, BREAKER_TYPES } from './constants.js';

export function cableTable(material, insulation, method) {
  const m = IEC_TABLES[material] || IEC_TABLES.Cu;
  const i = m[insulation] || m.PVC || Object.values(m)[0];
  const t = i[method] || i.B1 || Object.values(i)[0];
  return t;
}

// Подбор таблицы для HV-кабелей (XLPE 6/10/35 кВ, IEC 60502-2).
// Возвращает массив [[s_mm2, I_A], ...] для ближайшего класса
// напряжения. По умолчанию — XLPE Cu, прокладка в земле (D2).
export function hvCableTable(voltageV, material = 'Cu') {
  if (!HV_TABLES) return null;
  const m = HV_TABLES[material] || HV_TABLES.Cu;
  if (!m) return null;
  // Ближайший класс напряжения (6 / 10 / 35 кВ)
  const vKv = Number(voltageV) / 1000;
  const classes = Object.keys(m).map(Number).sort((a, b) => a - b);
  if (!classes.length) return null;
  let best = classes[0];
  for (const c of classes) {
    if (c <= vKv) best = c;
  }
  // Если напряжение больше максимального класса в таблице — берём максимальный
  if (vKv > classes[classes.length - 1]) best = classes[classes.length - 1];
  return m[best] || null;
}

export function kBundlingFactor(bundling) {
  if (bundling === 'spaced') return 1.0;       // без группового ухудшения
  if (bundling === 'bundled') return 0.85;     // ≈ 0.85 сверх обычного K_group (IEC табл. B.52.20)
  return 1.0;                                  // touching — базовое, всё в K_group
}

export function kBundlingIgnoresGrouping(bundling) {
  return bundling === 'spaced';
}

export function kTempLookup(t, insulation) {
  const tbl = K_TEMP[insulation || 'PVC'] || K_TEMP.PVC;
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - t) < Math.abs(best - t)) best = k;
  return tbl[best];
}

// method — метод прокладки IEC (A1, B1, C, E, F, G, D1, D2)
// Определяет какую таблицу K_GROUP использовать
export function kGroupLookup(n, method) {
  const im = method && INSTALL_METHODS[method];
  const groupType = im ? im.groupType : 'bundle';
  const table = K_GROUP_TABLES[groupType] || K_GROUP_TABLES.bundle;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const v = Math.max(1, n | 0);
  let best = table[1];
  for (const k of keys) { if (k <= v) best = table[k]; }
  return best;
}

// Подбор минимального стандартного сечения.
// opts: { material, insulation, method, ambientC, grouping, bundling,
//         conductorsInParallel, cableType, maxSize, allowAutoParallel }
// Если заданное conductorsInParallel не выдерживает ток и ни одно сечение
// до maxSize не подходит, функция автоматически увеличивает параллель
// до maxParallelAuto — и сообщает autoParallel: true.
export function selectCableSize(I, opts) {
  const o = opts || {};
  const material = o.material || GLOBAL.defaultMaterial;
  const insulation = o.insulation || GLOBAL.defaultInsulation;
  const method = o.method || GLOBAL.defaultInstallMethod;
  const ambient = Number(o.ambientC) || GLOBAL.defaultAmbient;
  const bundling = o.bundling || 'touching';
  const grouping = kBundlingIgnoresGrouping(bundling)
    ? 1
    : (Number(o.grouping) || GLOBAL.defaultGrouping);
  const cableType = o.cableType || GLOBAL.defaultCableType;
  const maxSize = Number(o.maxSize) || GLOBAL.maxCableSize || 240;
  const allowAutoParallel = o.allowAutoParallel !== false;
  const basePar = Math.max(1, Number(o.conductorsInParallel) || 1);

  const table = cableTable(material, insulation, method);
  const kT = kTempLookup(ambient, insulation);
  const kG = kGroupLookup(grouping, method) * kBundlingFactor(bundling);
  const k = kT * kG;

  // Для цельных жил — ограничение по max сечению (10 мм² для класса 1-2)
  const typeInfo = CABLE_TYPES[cableType] || CABLE_TYPES.multi;
  const typeSolidMax = typeInfo.solidMax;

  function filterTable(t) {
    return t.filter(([s]) => s <= maxSize && (!typeSolidMax || s <= typeSolidMax));
  }
  const effTable = filterTable(table);

  // Пробуем подобрать сечение для заданного числа параллельных жил.
  // Правило IEC 60364-4-43: Iрасч ≤ In ≤ Iz
  //   — сечение должно быть достаточным, чтобы существовал стандартный
  //     автомат In ≥ Iрасч, при этом In ≤ Iz (автомат защищает кабель).
  // IEC 60364-4-43: координация автомата и кабеля
  // Условие 1: Ib ≤ In ≤ Iz
  // Условие 2: I2 ≤ 1.45 × Iz, где I2 = I2ratio × In
  const breakerCurve = o.breakerCurve || 'MCB_C';
  const brkType = BREAKER_TYPES[breakerCurve] || BREAKER_TYPES.MCB_C;
  const I2ratio = brkType.I2ratio;
  // Единый запас по автомату (та же цепочка, что в recalc.js): применяется
  // внутри подбора кабеля, чтобы InNeeded = selectBreaker(Iper × (1+margin/100))
  // — это гарантирует In ≤ Iz даже если вызывающий код не раздул sizingCurrent.
  const breakerMarginPct = Math.max(0, Number(o.breakerMarginPct) || 0);
  const marginK = 1 + breakerMarginPct / 100;
  // Режим защиты параллельных линий:
  //   'individual' — по per-line автомату + ОБЩИЙ автомат на суммарный ток
  //                  (кабель должен выдержать и то, и другое)
  //   'common'     — один общий автомат на суммарный ток
  //   'per-line'   — только per-line (например, групповая нагрузка count>1)
  // Default 'individual' — самая строгая координация (две проверки).
  const protectionMode = o.protectionMode || 'individual';

  function tryWithParallel(parallel) {
    const Iper = I / parallel;
    const InNeededPer = selectBreaker(Iper * marginK);
    const InNeededTotal = selectBreaker(I * marginK);
    for (const [s, iRef] of effTable) {
      const iDerated = iRef * k;
      // IEC 60364-4-43: In ≤ Iz AND I2 ≤ 1.45 × Iz — проверяем для каждого
      // автомата, который защищает эту жилу:
      //   per-line автомат (250А) vs Iz одной жилы (265А)
      //   общий автомат (630А)   vs Iz·n суммарно (530А)
      // Кабель должен пройти обе проверки (для 'individual'/'common').
      const okPer = (iDerated >= InNeededPer) && (I2ratio * InNeededPer <= 1.45 * iDerated);
      const okTotal = (iDerated * parallel >= InNeededTotal) && (I2ratio * InNeededTotal <= 1.45 * iDerated * parallel);
      let ok;
      if (protectionMode === 'per-line') ok = okPer;
      else if (protectionMode === 'common') ok = okTotal;
      else ok = okPer && okTotal; // individual — обе проверки
      if (ok) {
        return { s, iAllowed: iRef, iDerated, parallel, InNeeded: Math.max(InNeededPer, Math.ceil(InNeededTotal / parallel)) };
      }
    }
    return null;
  }

  // Сначала с базовым параллелизмом
  let res = tryWithParallel(basePar);

  // Если не хватает — наращиваем параллель.
  // Параллельные жилы одной цепи НЕ увеличивают группировку (IEC 60364-5-52 Annex E).
  // K_group остаётся от базового grouping.
  let autoParallel = false;
  if (!res && allowAutoParallel) {
    const maxPar = Math.max(basePar, Number(GLOBAL.maxParallelAuto) || 10);
    for (let par = basePar + 1; par <= maxPar; par++) {
      const r = tryWithParallel(par);
      if (r) { res = r; autoParallel = true; break; }
    }
  }

  if (res) {
    return {
      s: res.s,
      iAllowed: res.iAllowed,
      iDerated: res.iDerated,
      kT, kG, I2ratio, breakerCurve,
      material, insulation, method, bundling, cableType,
      parallel: res.parallel,
      autoParallel,
      totalCapacity: res.iDerated * res.parallel,
      InNeeded: res.InNeeded,
      breakerMarginPct,
    };
  }

  // Не смогли подобрать даже с максимальной параллелью — берём максимум таблицы
  // (в пределах maxSize) и возвращаем overflow
  const last = effTable[effTable.length - 1] || table[table.length - 1];
  return {
    s: last[0], iAllowed: last[1], iDerated: last[1] * k, kT, kG,
    material, insulation, method, bundling, cableType,
    parallel: basePar,
    autoParallel: false,
    totalCapacity: last[1] * k * basePar,
    overflow: true,
  };
}

// Подбор ближайшего большего стандартного автомата
export function selectBreaker(Iload) {
  for (const In of BREAKER_SERIES) {
    if (In >= Iload) return In;
  }
  return BREAKER_SERIES[BREAKER_SERIES.length - 1];
}

// HV-выключатель (VCB / SF6, IEC 62271-100) — ряд номиналов 200..4000 А.
// Выбирается ближайший больший номинал к расчётному току Iрасч.
export function selectHvBreaker(Iload) {
  const arr = HV_BREAKER_SERIES || [];
  for (const In of arr) {
    if (In >= Iload) return In;
  }
  return arr[arr.length - 1] || 4000;
}
