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
  redundancyM: 0,        // в резерве (всего N+M в системе)
  // v0.60.1: режим резерва (по требованию Пользователя):
  //   'cold' — резерв полностью отключён, energy=0, ждёт failover.
  //            Активные = N, каждый берёт load/N.
  //   'hot'  — резерв работает параллельно с активными, делит нагрузку.
  //            Активные = N+M, каждый берёт load/(N+M) → ниже part-load
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
 * v0.60.7 (Phase 22.10.1): Построить топологию из ОДНОГО option-комплекса.
 *
 * Option в новой модели имеет equipment[]: каждый элемент — кусок
 * оборудования с qty (количество одинаковых). Расширяем qty в плоский
 * массив для simulateTopology.
 *
 * @param {object} option   — { equipment, topology }
 * @returns {TopologyDef}
 */
export function buildTopologyFromOption(option) {
  if (!option || !Array.isArray(option.equipment)) {
    return { chillers: [], cracs: [], loopMode: 'common-loop', redundancyN: 1, redundancyM: 0, standbyMode: 'cold' };
  }
  // Развернуть qty>1 в отдельные единицы (с уникальными именами «N #1», «N #2»…).
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
  const t = option.topology || { loopMode: 'common-loop', redundancyN: 1, redundancyM: 0, standbyMode: 'cold' };
  return buildTopologyFromOptions(flat, t.loopMode, t.redundancyN, t.redundancyM, t.standbyMode);
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
  //   делят нагрузку (всего N+M активных). Холодный = только N.
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
  // v0.60.1: при горячем резерве работают все N+M; при холодном — только N.
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
