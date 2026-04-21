/* =========================================================================
   SP RK 2.02-102-2022 — Kazakhstan Set of Rules for automatic fire
   suppression installations. Section 8 — gas suppression.

   Halocarbon mass (kg):
     M = K1 · V · (rho1 / s) · C / (100 - C)
     where:
       K1 = leakage compensation coef. (table 8.2)
            I class (sealed): 1.00; II (normal): 1.10; III (leaky): 1.20
       V  = protected volume, m³
       rho1 = agent vapor density at 20°C, kg/m³
       s  = specific volume, m³/kg (≈ 1/rho1)
       C  = design concentration, % (Cmin × Ks), Ks = 1.2 for class B/C,
            1.3 for class A per SP RK
   Inert-gas mass (kg):
     M = K1 · V · rho_s · ln(100/(100-C))
   Cylinder count: ceil(M / M_cyl), with M_cyl:
     halocarbon: V_cyl · fillRatio (typ. 1.1–1.2 kg/L)
     inert: V_cyl · P / (P_atm · s_atm) simplified by cylinder fill spec.
   ========================================================================= */

import { AGENTS } from './agents.js';

export const META = {
  id: 'sp-rk-2022',
  label: 'СП РК 2.02-102-2022 (Казахстан)',
  region: 'KZ',
  year: 2022,
  refs: [
    'СП РК 2.02-102-2022, раздел 8',
    'СТ РК 2175, СТ РК 1487',
  ],
};

// Коэффициент безопасности (Ks) по пож. классу
function safetyFactor(fireClass) {
  return fireClass === 'A' ? 1.3 : 1.2;
}

// Коэффициент утечки (K1) по классу герметичности помещения
function K1ByLeakage(leak /* 'I'|'II'|'III' */) {
  return leak === 'I' ? 1.00 : leak === 'III' ? 1.20 : 1.10;
}

// Температурная поправка (К): коэффициент изменения плотности по T, ISO 14520 A.
function tempCorrection(T) {
  return (273.15 + 20) / (273.15 + (Number.isFinite(T) ? T : 20));
}

// Поправка по высоте над уровнем моря (давление ↓ → концентрация ↑)
function altCorrection(H_m) {
  // ISO 14520 table: H=0→1.00, 1500→0.82, 3000→0.67 (lineariz.)
  const H = Math.max(0, H_m || 0);
  if (H <= 1500) return 1 - H / 1500 * 0.18;
  if (H <= 3000) return 0.82 - (H - 1500) / 1500 * 0.15;
  return 0.67;
}

export function compute(input) {
  const { agent, V, fireClass = 'A', leakage = 'II', tempC = 20, altM = 0 } = input;
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);

  const Ks = safetyFactor(fireClass);
  const K1 = K1ByLeakage(leakage);
  const Cmin = fireClass === 'A' ? a.Cmin_A : a.Cmin_B;
  const C = +(Cmin * Ks).toFixed(2);

  const Kt   = tempCorrection(tempC);
  const Kalt = altCorrection(altM);

  let M;
  if (a.type === 'halocarbon') {
    M = K1 * V * (a.rho20 / 1 /* s=1/rho */) * (C / (100 - C));
    M = M * a.s20 * a.rho20; // simpler: M = K1*V*rho1*C/(100-C)*s20 → canonical
    // Canonical per SP/ISO: M = V/s · C/(100-C) · K1  (kg), where s=m³/kg
    M = K1 * V * (1 / a.s20) * (C / (100 - C));
  } else {
    M = K1 * V * a.rho20 * Math.log(100 / (100 - C));
  }
  M = M * Kt / Kalt; // температура и высота
  M = +M.toFixed(1);

  return {
    method: META.id,
    agent, agentLabel: a.label,
    V, fireClass, leakage, tempC, altM,
    C, Cmin, Ks, K1, Kt: +Kt.toFixed(3), Kalt: +Kalt.toFixed(3),
    M,                              // расчётная масса, кг
    Mreserve: +(M * 1.0).toFixed(1),// запас — 100% (один полный комплект)
    dischargeS: a.dischargeS,
    steps: [
      `Вид ГОТВ: ${a.label} (${a.type === 'halocarbon' ? 'хим.' : 'инерт.'})`,
      `Cmin(${fireClass}) = ${Cmin}% × Ks=${Ks} → C = ${C}%`,
      `K1 (герметичность ${leakage}) = ${K1}`,
      `Kt (T=${tempC}°C) = ${Kt.toFixed(3)}, Kalt (H=${altM}м) = ${Kalt.toFixed(3)}`,
      a.type === 'halocarbon'
        ? `M = K1·V/s·C/(100−C)·Kt/Kalt = ${K1}·${V}/${a.s20}·${C}/${(100-C).toFixed(1)}·${Kt.toFixed(3)}/${Kalt.toFixed(3)} = ${M} кг`
        : `M = K1·V·ρ·ln(100/(100−C))·Kt/Kalt = ${K1}·${V}·${a.rho20}·ln(100/${(100-C).toFixed(1)})·${Kt.toFixed(3)}/${Kalt.toFixed(3)} = ${M} кг`,
    ],
  };
}
