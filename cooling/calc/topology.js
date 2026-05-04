// =============================================================================
// cooling/calc/topology.js — топология холодоснабжения (chillers ↔ CRACs)
// =============================================================================
// Pure-функции расчёта системы из нескольких чиллеров и нескольких CRAC,
// связанных через общий контур (common-loop) или точка-точка (p2p).
//
// По требованию Пользователя 2026-05-02:
//   • Несколько водяных CRAC могут подключаться к общему чиллеру.
//   • Чиллеры включаются с резервированием (N+1, 2N) — общий трубопровод
//     или точка-точка (один чиллер — один CRAC).
//   • Водяные CRAC могут быть с компрессором на борту (DX-glycol гибрид)
//     или с отдельным контуром фрикулинга (Stulz CyberHandler dual-circuit).
//
// Модель данных:
//   topology = {
//     chillers: [chillerSpec, ...]      — массив чиллеров (могут быть одинаковые)
//     cracs:    [cracSpec, ...]          — массив CRAC (любые типы кондиционеров)
//     loopMode: 'common-loop' | 'p2p',
//     redundancyN: 2,    // штатно работающих чиллеров
//     redundancyM: 1,    // в горячем резерве (для расчёта при отказе)
//   }
//
// Симуляция (метод интервалов, аналогично chiller-bin-calc):
//   Для каждого T_amb:
//     1. Каждый CRAC даёт capacity (corrected) и cracCoolingLoadKw на чиллер.
//     2. Σ cracCoolingLoadKw = total chiller load.
//     3. Распределяем нагрузку между chillers[] (равномерно по N штатным).
//     4. Каждый чиллер — applyChillerCalc(load, его spec) → power.
//     5. Σ power_chillers + Σ power_cracs = total power per bin.
//     6. energy_bin = power × hours_in_bin.
//
// NO DOM. Pure JS.

import { applyChillerCalc, buildBinData } from './chiller-bin-calc.js';
import { isCracType } from './chiller-defaults.js';

/**
 * @typedef {object} TopologyDef
 * @property {Array<object>} chillers    — chillerSpec[] (типов chiller / dx-air / dx-pumped-fc)
 * @property {Array<object>} cracs       — cracSpec[] (типов crac-* или dx-air для standalone)
 * @property {'common-loop'|'p2p'} loopMode
 * @property {number} redundancyN        — штатно работающих чиллеров
 * @property {number} redundancyM        — в резерве
 *
 * @typedef {object} TopologyMetrics
 * @property {number} totalEnergyKwh     — годовое суммарное потребление, кВт·ч
 * @property {number} totalCoolingKw     — суммарная capacity всех CRAC, кВт
 * @property {Array<object>} perEquipment — массив { kind, name, energyKwh, peakKw }
 * @property {Array<object>} bins         — массив интервалов температуры с распределением load
 */

export const DEFAULT_TOPOLOGY = {
  chillers: [],
  cracs: [],
  loopMode: 'common-loop',
  redundancyN: 1,        // штатно работающих чиллеров
  redundancyM: 0,        // в резерве (всего N+R в системе)
  // v0.60.1: режим резерва (по требованию Пользователя):
  //   'cold' — резерв полностью отключён, energy=0, ждёт failover.
  //            Активные = N, каждый берёт load/N.
  //   'hot'  — резерв работает параллельно с активными, делит нагрузку.
  //            Активные = N+R, каждый берёт load/(N+R) → ниже part-load
  //            на каждом + быстрый failover без ramp-up.
  standbyMode: 'cold',
};

/**
 * Построить топологию из массива опций подбора. Опции с системами kind='plant'
 * (chiller/dx-air/dx-pumped-fc) → chillers. Опции с kind='crac' → cracs.
 * Используется для лёгкой интеграции с существующей моделью selections.
 */
export function buildTopologyFromOptions(options, loopMode = 'common-loop', redundancyN = 1, redundancyM = 0, standbyMode = 'cold') {
  const chillers = [];
  const cracs = [];
  for (const opt of options || []) {
    const sysType = opt.spec?.systemType || 'chiller';
    if (isCracType(sysType)) cracs.push(opt);
    else chillers.push(opt);
  }
  return { chillers, cracs, loopMode, redundancyN: Math.max(1, redundancyN), redundancyM, standbyMode };
}

/**
 * v0.60.15 (Phase 22.10.1, refined): Симуляция option-комплекса.
 *
 * По уточнению Пользователя: redundancy now per-EQUIPMENT-GROUP (не per-option).
 * Каждая equipment-группа имеет свои qty + N + R + standbyMode.
 *
 * Алгоритм:
 *   Для каждой equipment-группы:
 *     • activeUnits = N (cold) или N+R (hot); coldStandby = qty - activeUnits
 *     • Если group.role='crac' (или crac-type spec) → CRACs: каждая активная
 *       единица даёт нагрузку на upstream chillers
 *     • Если group.role='chiller'|'dx' → активные распределяют общую chiller-load
 *
 * Возвращает aggregate metrics + per-group breakdown.
 *
 * @param {object} option   — { equipment, topology, general }
 * @param {Array<object>} hourly  — фильтрованный hourly meteo
 * @returns {TopologyMetrics}
 */
export function simulateOptionTopology(option, hourly, requiredCoolingKw = 0) {
  if (!option || !Array.isArray(option.equipment) || !hourly?.length) {
    return { totalEnergyKwh: 0, totalCoolingKw: 0, perEquipment: [], bins: [] };
  }

  // 1. Разделяем equipment на cracs и chillers/dx-plant.
  const cracGroups = [];
  const chillerGroups = [];
  for (const eq of option.equipment) {
    if (!eq.spec) continue;
    if (isCracType(eq.spec.systemType)) cracGroups.push(eq);
    else chillerGroups.push(eq);
  }

  // 2. Per-group (CRAC) расчёт + сбор bin-нагрузки на chiller.
  const cracPerEquipment = [];
  const chillerLoadByBin = new Map();   // tBin → { tBin, hours, load, twbAvg }
  for (const grp of cracGroups) {
    const activeUnits = grp.standbyMode === 'hot'
      ? Math.max(1, (grp.qty || 1))
      : Math.max(1, grp.redundancyN || (grp.qty || 1));
    const standbyUnits = (grp.qty || 1) - activeUnits;
    const cracRows = buildBinData(hourly, grp.spec);
    let energyKwh = 0, peakKw = 0;
    for (const r of cracRows) {
      energyKwh += (r.energy || 0) * activeUnits;
      const power = (r.power || 0) * activeUnits;
      if (power > peakKw) peakKw = power;
      // Нагрузка на upstream chiller от ВСЕХ active CRAC.
      const cur = chillerLoadByBin.get(r.tBin) || { tBin: r.tBin, hours: r.hours, load: 0, twbAvg: r.twbAvg };
      cur.load += (r.cracCoolingLoadKw || 0) * activeUnits;
      chillerLoadByBin.set(r.tBin, cur);
    }
    cracPerEquipment.push({
      kind: 'crac', name: grp.spec.name || `CRAC ${grp.id}`,
      qty: grp.qty, activeUnits, standbyUnits, role: grp.role,
      ratedCapKw: (grp.spec.ratedCapKw || 0) * activeUnits,
      energyKwh, peakKw,
    });
    if (standbyUnits > 0 && grp.standbyMode === 'cold') {
      cracPerEquipment.push({
        kind: 'crac-cold-standby', name: `${grp.spec.name || 'CRAC'} (резерв)`,
        qty: standbyUnits, ratedCapKw: (grp.spec.ratedCapKw || 0) * standbyUnits,
        energyKwh: 0, peakKw: 0,
      });
    }
  }

  // v0.60.21 fix: если CRAC не заданы (chiller-only / dx-only система), но
  // есть «Требуемая мощн.» из подбора → генерируем нагрузку на чиллеры
  // равной requiredCoolingKw на все bin'ы. Это исправляет баг «Σ Cooling
  // = 0 кВт» в Topology-tab при системе без CRAC.
  if (cracGroups.length === 0 && chillerGroups.length > 0 && requiredCoolingKw > 0) {
    // Берём bins из первого чиллера для сетки температур.
    const refSpec = chillerGroups[0].spec;
    const refRows = buildBinData(hourly, refSpec);
    for (const r of refRows) {
      chillerLoadByBin.set(r.tBin, {
        tBin: r.tBin, hours: r.hours, twbAvg: r.twbAvg,
        load: requiredCoolingKw,
      });
    }
  }
  const chillerBins = [...chillerLoadByBin.values()].sort((a, b) => a.tBin - b.tBin);

  // 3. Per-group (chiller/dx) расчёт. Распределяем chiller-load между всеми
  // активными чиллерами всех групп равномерно (общий контур).
  const totalActiveChillerUnits = chillerGroups.reduce((sum, grp) => {
    return sum + (grp.standbyMode === 'hot'
      ? Math.max(1, (grp.qty || 1))
      : Math.max(1, grp.redundancyN || (grp.qty || 1)));
  }, 0);

  const chillerPerEquipment = [];
  for (const grp of chillerGroups) {
    const activeUnits = grp.standbyMode === 'hot'
      ? Math.max(1, (grp.qty || 1))
      : Math.max(1, grp.redundancyN || (grp.qty || 1));
    const standbyUnits = (grp.qty || 1) - activeUnits;
    let energyKwh = 0, peakKw = 0;
    for (const bin of chillerBins) {
      // Доля каждой активной единицы.
      const sharedLoad = totalActiveChillerUnits > 0 ? bin.load / totalActiveChillerUnits : 0;
      const baseRow = { tBin: bin.tBin, hours: bin.hours, twbAvg: bin.twbAvg };
      const calc = applyChillerCalc(baseRow, grp.spec);
      const power = calc.cop > 0 ? sharedLoad / calc.cop : 0;
      const energy = power * bin.hours * activeUnits;
      energyKwh += energy;
      const totalGroupPower = power * activeUnits;
      if (totalGroupPower > peakKw) peakKw = totalGroupPower;
    }
    chillerPerEquipment.push({
      kind: grp.role === 'dx' ? 'dx' : 'chiller',
      name: grp.spec.name || `Chiller ${grp.id}`,
      qty: grp.qty, activeUnits, standbyUnits, role: grp.role,
      ratedCapKw: (grp.spec.ratedCapKw || 0) * activeUnits,
      energyKwh, peakKw,
      standbyMode: grp.standbyMode,
    });
    if (standbyUnits > 0 && grp.standbyMode === 'cold') {
      chillerPerEquipment.push({
        kind: 'chiller-cold-standby', name: `${grp.spec.name || 'Chiller'} (резерв)`,
        qty: standbyUnits, ratedCapKw: (grp.spec.ratedCapKw || 0) * standbyUnits,
        energyKwh: 0, peakKw: 0,
      });
    }
  }

  const perEquipment = [...chillerPerEquipment, ...cracPerEquipment];
  const totalEnergyKwh = perEquipment.reduce((a, e) => a + e.energyKwh, 0);
  const totalCoolingKw = cracPerEquipment.reduce((a, e) => a + (e.kind === 'crac' ? e.ratedCapKw : 0), 0);

  return { totalEnergyKwh, totalCoolingKw, perEquipment, bins: chillerBins };
}

/**
 * @deprecated v0.60.15 — используйте simulateOptionTopology(option, hourly).
 * Обёртка для backward-compat: создаёт виртуальный option из массива options.
 */
export function buildTopologyFromOption(option) {
  if (!option || !Array.isArray(option.equipment)) {
    return { chillers: [], cracs: [], loopMode: 'common-loop', redundancyN: 1, redundancyM: 0, standbyMode: 'cold' };
  }
  const flat = [];
  for (const eq of option.equipment) {
    const q = Math.max(1, Math.round(Number(eq.qty) || 1));
    for (let i = 0; i < q; i++) {
      flat.push({
        id: eq.id + (q > 1 ? `_${i + 1}` : ''),
        name: eq.spec?.name || `${eq.role || 'Eq'} ${i + 1}`,
        spec: eq.spec,
      });
    }
  }
  const t = option.topology || { loopMode: 'common-loop' };
  return buildTopologyFromOptions(flat, t.loopMode, 1, 0, 'cold');
}

/**
 * Симуляция топологии по часовому ряду meteo.
 *
 * @param {TopologyDef} topo
 * @param {Array<object>} hourly       — фильтрованный hourly meteo
 * @returns {TopologyMetrics}
 */
export function simulateTopology(topo, hourly) {
  if (!topo || !hourly || !hourly.length) {
    return { totalEnergyKwh: 0, totalCoolingKw: 0, perEquipment: [], bins: [] };
  }
  const N = Math.max(1, topo.redundancyN || 1);
  const M = Math.max(0, topo.redundancyM || 0);
  const standbyMode = topo.standbyMode || 'cold';
  // v0.60.1: горячий резерв = резервы работают параллельно с активными,
  //   делят нагрузку (всего N+R активных). Холодный = только N.
  const ACTIVE_COUNT = standbyMode === 'hot' ? (N + M) : N;

  // Сначала считаем bin-данные для CRAC (чтобы получить cracCoolingLoadKw на чиллер).
  const cracPerEquipment = (topo.cracs || []).map(crac => {
    const rows = buildBinData(hourly, crac.spec);
    let energyKwh = 0;
    let peakKw = 0;
    for (const r of rows) {
      energyKwh += r.energy || 0;
      if (r.power > peakKw) peakKw = r.power;
    }
    return { kind: 'crac', name: crac.name, ratedCapKw: crac.spec?.ratedCapKw || 0, energyKwh, peakKw, rows };
  });

  // Суммируем нагрузку CRAC на чиллер по интервалам (по T наружн.).
  // Map: tBin → Σ cracCoolingLoadKw
  const chillerLoadByBin = new Map();
  for (const ce of cracPerEquipment) {
    for (const r of ce.rows) {
      const cur = chillerLoadByBin.get(r.tBin) || { tBin: r.tBin, hours: r.hours, load: 0, twbAvg: r.twbAvg };
      cur.load += (r.cracCoolingLoadKw || 0);
      chillerLoadByBin.set(r.tBin, cur);
    }
  }
  const chillerBins = [...chillerLoadByBin.values()].sort((a, b) => a.tBin - b.tBin);

  // Теперь для каждого чиллера: распределяем нагрузку (equally между N штатных).
  // Важно: сохраняем оригинальную capacity-долю в каждом интервале через scaling.
  const chillersList = (topo.chillers || []);
  // v0.60.1: при горячем резерве работают все N+R; при холодном — только N.
  const workingChillers = chillersList.slice(0, ACTIVE_COUNT);
  const coldStandbyChillers = chillersList.slice(ACTIVE_COUNT);

  const chillerPerEquipment = workingChillers.map((ch, idx) => {
    let energyKwh = 0;
    let peakKw = 0;
    for (const bin of chillerBins) {
      // Доля каждого работающего чиллера = 1 / ACTIVE_COUNT.
      const sharedLoad = bin.load / ACTIVE_COUNT;
      const baseRow = { tBin: bin.tBin, hours: bin.hours, twbAvg: bin.twbAvg };
      const calc = applyChillerCalc(baseRow, ch.spec);
      const power = calc.cop > 0 ? sharedLoad / calc.cop : 0;
      const energy = power * bin.hours;
      energyKwh += energy;
      if (power > peakKw) peakKw = power;
    }
    // Маркер: чиллеры с index ≥ N — это резервы. В горячем режиме они
    // тоже работают (помечаем «горячий резерв»). В холодном они не попали
    // в workingChillers вовсе.
    const kind = (idx >= N && standbyMode === 'hot') ? 'chiller-hot-standby' : 'chiller';
    return { kind, name: ch.name, ratedCapKw: ch.spec?.ratedCapKw || 0, energyKwh, peakKw };
  });

  // Холодный резерв — энергия = 0 (выключены, ждут failover).
  for (const ch of coldStandbyChillers) {
    chillerPerEquipment.push({ kind: 'chiller-standby', name: ch.name, ratedCapKw: ch.spec?.ratedCapKw || 0, energyKwh: 0, peakKw: 0 });
  }

  const perEquipment = [...chillerPerEquipment, ...cracPerEquipment.map(ce => ({ kind: ce.kind, name: ce.name, ratedCapKw: ce.ratedCapKw, energyKwh: ce.energyKwh, peakKw: ce.peakKw }))];
  const totalEnergyKwh = perEquipment.reduce((a, e) => a + e.energyKwh, 0);
  const totalCoolingKw = (topo.cracs || []).reduce((a, c) => a + (c.spec?.ratedCapKw || 0), 0);

  return { totalEnergyKwh, totalCoolingKw, perEquipment, bins: chillerBins };
}
