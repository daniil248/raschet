// =============================================================================
// cooling/calc/capex-tco.js — CAPEX / OPEX / TCO / NPV / payback
// =============================================================================
// Pure-функции экономической модели подбора холодильного оборудования.
// Используется для технико-экономического сравнения нескольких опций.
//
// Модель (упрощённый Total Cost of Ownership, TCO):
//   TCO_N лет = CAPEX  +  Σ_{t=1..N} (OPEX_energy_t + OPEX_maintenance_t) / (1+r)^t
//
// Где:
//   CAPEX = equipmentCost + installationCost  (₽, year 0)
//   OPEX_energy_t = annual_energy_kwh × tariff × (1 + escEnergy)^(t-1)
//   OPEX_maintenance_t = maintenanceRubPerYear × (1 + escMaint)^(t-1)
//   r = discount rate (доля, например 0.08 для 8%)
//   escEnergy / escMaint = годовая эскалация цены (доля)
//
// Payback period (Discounted) — год t, в котором кумулятивный
// дисконтированный денежный поток (saved_OPEX − ΔCAPEX) переходит через 0.
//
// Источники методики:
//   • ISO 15686-5:2017 «Buildings and constructed assets — Service life
//     planning — Life-cycle costing»
//   • ASHRAE Handbook — Applications (2023) гл. 38 «Owning and Operating Costs»
//   • EN 15459-1:2017 «Energy performance of buildings — Economic evaluation»
//
// NO DOM. Pure JS.

/**
 * Default-параметры экономической модели.
 * Большинство значений — типичные для РФ-проектов 2025-26.
 */
export const DEFAULT_ECONOMICS = {
  equipmentCost: 0,           // ₽ — закупочная стоимость оборудования
  installationCost: 0,        // ₽ — монтаж/пусконаладка/обвязка
  maintenanceRubPerYear: 0,   // ₽/год — регламентное ТО
  projectLifetimeYears: 20,   // лет — срок сравнения. Зафиксировано пользователем 2026-05-02: «нужно 20 лет». Соответствует типичному жизненному циклу HVAC-оборудования (chiller 15–25 лет, DX 10–15) и горизонту проектов ЦОД.
  discountRatePct: 8,         // %/год — ставка дисконтирования
  escalationEnergyPct: 5,     // %/год — рост тарифа на электроэнергию
  escalationMaintPct: 4,      // %/год — рост стоимости ТО
};

/**
 * Расчёт TCO/NPV по одной опции.
 *
 * @param {object} opts
 *   @param {number} annualEnergyKwh  — годовое потребление (из bin-calc)
 *   @param {number} tariffRubKwh     — текущий тариф ₽/кВт·ч
 *   @param {object} eco              — параметры economics (см. DEFAULT_ECONOMICS)
 *
 * @returns {object} {
 *   capex,
 *   yearlyOpex: [{year, energyRub, maintRub, totalRub, discountedRub, cumDiscounted}],
 *   tco,                  // CAPEX + Σ discounted OPEX
 *   tcoUndiscounted,      // CAPEX + Σ raw OPEX (для info)
 *   averageRubPerYear,    // tco / N
 * }
 */
export function computeTco({ annualEnergyKwh, tariffRubKwh, eco }) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  const N = Math.max(1, Math.round(Number(e.projectLifetimeYears) || 15));
  const r = (Number(e.discountRatePct) || 0) / 100;
  const escE = (Number(e.escalationEnergyPct) || 0) / 100;
  const escM = (Number(e.escalationMaintPct) || 0) / 100;
  const tariff = Number(tariffRubKwh) || 0;
  const annKwh = Number(annualEnergyKwh) || 0;
  const baseEnergy = annKwh * tariff;
  const baseMaint  = Number(e.maintenanceRubPerYear) || 0;

  const capex = (Number(e.equipmentCost) || 0) + (Number(e.installationCost) || 0);

  let cumDisc = 0;
  let sumDisc = 0;
  let sumUndisc = 0;
  const yearly = [];
  for (let t = 1; t <= N; t++) {
    const energyRub = baseEnergy * Math.pow(1 + escE, t - 1);
    const maintRub  = baseMaint  * Math.pow(1 + escM, t - 1);
    const totalRub  = energyRub + maintRub;
    const discount  = Math.pow(1 + r, t);
    const discountedRub = totalRub / discount;
    sumDisc += discountedRub;
    sumUndisc += totalRub;
    cumDisc += discountedRub;
    yearly.push({ year: t, energyRub, maintRub, totalRub, discountedRub, cumDiscounted: cumDisc + capex });
  }

  return {
    capex,
    yearlyOpex: yearly,
    tco: capex + sumDisc,
    tcoUndiscounted: capex + sumUndisc,
    averageRubPerYear: (capex + sumDisc) / N,
    discountRatePct: r * 100,
    projectLifetimeYears: N,
  };
}

/**
 * Discounted Payback Period — за сколько лет инвестиция (ΔCAPEX) окупится
 * экономией на OPEX (ΔOPEX) с учётом дисконтирования.
 *
 * @param {object} candidate  — TCO результат рассматриваемого варианта
 * @param {object} baseline   — TCO результат baseline (более простого)
 *
 * @returns {object|null} { years, exact, neverPaysBack } или null если
 *                        candidate не дороже baseline.
 *   years        — целое число лет (с округлением вверх)
 *   exact        — дробное (линейная интерполяция в году пересечения)
 *   neverPaysBack — true если за горизонт N лет не окупится
 */
export function discountedPaybackYears(candidate, baseline) {
  const dCapex = candidate.capex - baseline.capex;
  if (dCapex <= 0) return null;  // candidate дешевле или равен по CAPEX → не имеет смысла считать payback

  const r = candidate.discountRatePct / 100;
  let cum = -dCapex;   // начинаем с долга по CAPEX
  for (let i = 0; i < candidate.yearlyOpex.length; i++) {
    const candOpex = candidate.yearlyOpex[i].totalRub;
    const baseOpex = baseline.yearlyOpex[i] ? baseline.yearlyOpex[i].totalRub : 0;
    const savings  = baseOpex - candOpex;
    const disc     = Math.pow(1 + r, i + 1);
    const discSavings = savings / disc;
    const prev = cum;
    cum += discSavings;
    if (prev < 0 && cum >= 0) {
      const fraction = -prev / discSavings;
      return { years: i + 1, exact: i + fraction, neverPaysBack: false };
    }
  }
  return { years: null, exact: null, neverPaysBack: true };
}
