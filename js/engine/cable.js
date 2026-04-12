import { GLOBAL, IEC_TABLES, BREAKER_SERIES, K_TEMP, K_GROUP, CABLE_TYPES } from './constants.js';

export function cableTable(material, insulation, method) {
  const m = IEC_TABLES[material] || IEC_TABLES.Cu;
  const i = m[insulation] || m.PVC || Object.values(m)[0];
  const t = i[method] || i.B1 || Object.values(i)[0];
  return t;
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

export function kGroupLookup(n) {
  const keys = Object.keys(K_GROUP).map(Number).sort((a, b) => a - b);
  const v = Math.max(1, n | 0);
  // Находим ближайший ключ не меньше v
  let best = K_GROUP[1];
  for (const k of keys) { if (k <= v) best = K_GROUP[k]; }
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
  const kG = kGroupLookup(grouping) * kBundlingFactor(bundling);
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
  function tryWithParallel(parallel) {
    const Iper = I / parallel;
    const InNeeded = selectBreaker(Iper); // ближайший стандартный ≥ Iрасч
    for (const [s, iRef] of effTable) {
      const iDerated = iRef * k;
      // Iz должен быть ≥ In (автомат защищает кабель)
      if (iDerated >= InNeeded) {
        return { s, iAllowed: iRef, iDerated, parallel };
      }
    }
    return null;
  }

  // Сначала с базовым параллелизмом
  let res = tryWithParallel(basePar);

  // Если не хватает — наращиваем параллель.
  let autoParallel = false;
  if (!res && allowAutoParallel) {
    const maxPar = Math.max(basePar, Number(GLOBAL.maxParallelAuto) || 4);
    for (let par = basePar + 1; par <= maxPar; par++) {
      // Пересчитываем K_group под увеличенную группу
      let grp2 = grouping;
      if (!kBundlingIgnoresGrouping(bundling)) {
        grp2 += (par - basePar);
      }
      const kG2 = kGroupLookup(grp2) * kBundlingFactor(bundling);
      const k2 = kT * kG2;
      const Iper = I / par;
      const InNeeded = selectBreaker(Iper);
      for (const [s, iRef] of effTable) {
        const iDerated = iRef * k2;
        // Iz ≥ In ≥ Iрасч — автомат защищает кабель
        if (iDerated >= InNeeded) {
          res = { s, iAllowed: iRef, iDerated, parallel: par };
          autoParallel = true;
          break;
        }
      }
      if (res) break;
    }
  }

  if (res) {
    return {
      s: res.s,
      iAllowed: res.iAllowed,
      iDerated: res.iDerated,
      kT, kG,
      material, insulation, method, bundling, cableType,
      parallel: res.parallel,
      autoParallel,
      totalCapacity: res.iDerated * res.parallel,
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
