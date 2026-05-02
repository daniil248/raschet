// =============================================================================
// cooling/calc/comparison.js — сравнение нескольких конфигураций
// =============================================================================
// Принимает массив именованных опций { name, spec, eco, equipment, topology, general }
// + общий hourly + тариф, возвращает таблицу метрик для side-by-side сравнения.
//
// v0.60.18 (Phase 22.10.1 follow-up): по требованию Пользователя 2026-05-02
// «сравнивать нужно не отдельные системы а системы на запрашиваемую мощность» —
// перешли с per-unit метрик (buildBinData(opt.spec)) на СИСТЕМНЫЕ метрики
// (simulateOptionTopology) с учётом qty + N+M резервирования. CAPEX/OPEX
// денежных полей умножаются на Σ qty по группам оборудования (eco.* трактуется
// как PER-UNIT стоимость).
//
// NO DOM. Pure JS.

import { simulateOptionTopology } from './topology.js';
import { computeTco, discountedPaybackYears, convertEcoToCurrency } from './capex-tco.js';

/**
 * Метрики для одной опции (системные, не per-unit).
 *
 * @typedef {object} OptionMetrics
 * @property {string} name           — пользовательское имя
 * @property {object} spec           — primary chillerSpec (для отображения типа/COP)
 * @property {object} eco            — economics (системные = per-unit × Σ qty)
 * @property {object} fc             — { energyKwh, costRub, fcHours, fcPct }
 * @property {object} tco            — результат computeTco на системных eco
 * @property {number} totalQty       — Σ qty по группам оборудования
 * @property {number} installedKw    — суммарная установленная мощность активных групп
 * @property {number} annualEnergy   — кВт·ч/год (alias fc.energyKwh)
 * @property {number} annualCost     — валюта/год (alias fc.costRub)
 * @property {object|null} payback   — discounted payback vs первой опции
 *                                     (если эта опция дороже по CAPEX)
 */

/**
 * Сравнить N опций НА УРОВНЕ СИСТЕМЫ (с учётом qty + резервирования).
 *
 * @param {Array<object>} options       — список опций (с equipment[]+topology+eco)
 * @param {Array<object>} hourly        — фильтрованный hourly meteo
 * @param {number} tariffPerKwh         — тариф (в displayCurrency, уже сконвертирован)
 * @param {string} displayCurrency      — валюта проекта/отчёта
 * @param {function|null} convertFn     — (amount, fromIso, toIso) => number
 *
 * @returns {Array<OptionMetrics>}
 */
export function compareOptions(options, hourly, tariffPerKwh, displayCurrency = '₽', convertFn = null, requiredCoolingKw = 0, selectionEco = null) {
  if (!options || !options.length) return [];

  // v0.60.25: финансовые параметры (lifetime/discount/escalations) — на
  // selection-уровне. Override каждого option.eco чтобы все варианты считались
  // на одинаковых финусловиях. Если selectionEco не передан, используются
  // option.eco (legacy путь).
  const finOverrides = selectionEco ? {
    projectLifetimeYears: selectionEco.projectLifetimeYears,
    discountRatePct:      selectionEco.discountRatePct,
    escalationEnergyPct:  selectionEco.escalationEnergyPct,
    escalationMaintPct:   selectionEco.escalationMaintPct,
  } : null;

  const computed = options.map(opt => {
    // Σ qty по всем equipment-группам — масштабирующий коэффициент для
    // CAPEX/OPEX денежных полей (eco.* трактуется как PER-UNIT).
    const equipment = Array.isArray(opt.equipment) ? opt.equipment : [];
    const totalQty = equipment.reduce((s, eq) => s + (eq.qty || 1), 0);

    // Установленная мощность системы (только активные единицы, без cold-резерва)
    const installedKw = equipment.reduce((s, eq) => {
      if (!eq.spec) return s;
      const active = eq.standbyMode === 'hot'
        ? (eq.qty || 1)
        : (eq.redundancyN || (eq.qty || 1));
      return s + (eq.spec.ratedCapKw || 0) * active;
    }, 0);

    // Системное энергопотребление через simulateOptionTopology — учитывает
    // qty × per-unit-energy + (cold-резерв = 0; hot-резерв делит нагрузку).
    const tMetrics = simulateOptionTopology(opt, hourly, requiredCoolingKw);
    const annualEnergyKwh = tMetrics.totalEnergyKwh || 0;

    // Часы в FC-режиме считаем по primary spec (только chiller-plant): берём
    // bin-rows для одной единицы, fcFraction × hours по всем bins. Это аппрок,
    // но достаточная для сравнения «доли года в FC».
    const pSpec = (equipment.find(eq => eq.spec) || {}).spec || opt.spec || null;
    let fcHours = 0, fcPct = 0;
    if (pSpec && tMetrics.bins && tMetrics.bins.length) {
      const totalHours = tMetrics.bins.reduce((s, b) => s + (b.hours || 0), 0);
      // bins from simulateOptionTopology — chillerLoadByBin (до распределения).
      // Достаём fcFraction через быструю реконструкцию на pSpec.
      // Чтобы не дублировать импорт buildBinData, помечаем fcHours/fcPct только
      // если pSpec поддерживает FC и bin-данные имеют power-info. Более точные
      // числа доступны во вкладке energy через computeFcSummary.
      // Простой proxy: если ratedCop > 0 и есть bins с T < freeCoolingThresholdC,
      // считаем что эти часы — FC-режим.
      const fcThr = Number(pSpec.freeCoolingThresholdC);
      if (Number.isFinite(fcThr)) {
        for (const b of tMetrics.bins) {
          if (b.tBin < fcThr) fcHours += (b.hours || 0);
        }
        fcPct = totalHours > 0 ? (fcHours / totalHours) * 100 : 0;
      }
    }

    const annualCost = annualEnergyKwh * (tariffPerKwh || 0);

    // Convert eco к displayCurrency (per-unit values).
    // costItems в новой модели уже хранит qty и НЕ нужно умножать ещё раз.
    // Поддерживаем legacy single-value поля × totalQty.
    const ecoConv = convertEcoToCurrency(opt.eco, displayCurrency, convertFn);
    const useLegacyMultiplier = !Array.isArray(opt.eco?.costItems) || !opt.eco.costItems.length;
    const k = useLegacyMultiplier ? totalQty : 1;
    const ecoSystem = {
      ...ecoConv,
      equipmentCost:         (Number(ecoConv.equipmentCost)        || 0) * k,
      installationCost:      (Number(ecoConv.installationCost)     || 0) * k,
      maintenanceRubPerYear: (Number(ecoConv.maintenanceRubPerYear) || 0) * k,
      // v0.60.25: financial overrides от selection
      ...(finOverrides ? finOverrides : {}),
    };

    const tco = computeTco({
      annualEnergyKwh,
      tariffRubKwh: tariffPerKwh,
      eco: ecoSystem,
    });

    return {
      name: opt.name,
      spec: pSpec || { systemType: '?', ratedCapKw: 0, ratedCOP: 0, freeCoolingMode: '—' },
      eco: ecoSystem,
      ecoNative: opt.eco,
      fc: { energyKwh: annualEnergyKwh, costRub: annualCost, fcHours, fcPct },
      tco,
      totalQty,
      installedKw,
      annualEnergy: annualEnergyKwh,
      annualCost,
      payback: null,
    };
  });

  // Payback каждой относительно baseline (первой = ★основной)
  const baseline = computed[0];
  for (let i = 1; i < computed.length; i++) {
    computed[i].payback = discountedPaybackYears(computed[i].tco, baseline.tco);
  }

  return computed;
}

/**
 * Найти «победителя» по конкретной метрике.
 *
 * @param {Array<OptionMetrics>} metrics
 * @param {string} field   — путь через точки, напр. 'tco.tco', 'fc.energyKwh'
 * @param {boolean} lowerIsBetter
 *
 * @returns {number} индекс победителя или -1 если нет данных
 */
export function findBest(metrics, field, lowerIsBetter = true) {
  let bestIdx = -1;
  let bestVal = lowerIsBetter ? Infinity : -Infinity;
  metrics.forEach((m, i) => {
    const v = field.split('.').reduce((o, k) => (o == null ? null : o[k]), m);
    if (!Number.isFinite(v)) return;
    if (lowerIsBetter ? v < bestVal : v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}
