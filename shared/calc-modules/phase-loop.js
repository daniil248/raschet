// ======================================================================
// shared/calc-modules/phase-loop.js
// Обязательный модуль для TN-систем: проверка петли «фаза-ноль»
// (IEC 60364-4-41 §411.3.2, ПУЭ 1.7.79).
//
// Требование: при однофазном КЗ на корпус ток I_k1 должен обеспечивать
// срабатывание защитного аппарата за требуемое время t_a:
//   I_k1 ≥ I_a (ток автоматического отключения по характеристике автомата)
//
// Упрощённая формула: I_k1 ≈ U_ф / Z_loop
//   Z_loop = Z_src + R_line(фаза) + R_line(N/PE)
//   R_line(фаза) = ρ × L / S_phase  (для длины линии L и сечения S_phase)
//   R_line(N/PE) = ρ × L / S_N      (сечение нейтрали/защитного)
//
// Для B-характеристики I_a ≈ 5·I_n, для C — 10·I_n, для D — 20·I_n.
//
// Модуль mandatory для сетей с TN-системой заземления, иначе скип.
// ======================================================================

const RHO = { Cu: 0.0178, Al: 0.0285 }; // Ом·мм²/м при 20°C

// Горячая поправка (IEC 60909 §4.3.3): при t=70°C R возрастает в ~1.2 раза
const HOT_FACTOR = 1.2;

// Кратность мгновенного расцепления MCB
const MAG_MULT = {
  MCB_B: 5,
  MCB_C: 10,
  MCB_D: 20,
  MCCB:  10,
  ACB:   10,
  gG:    10, // для gG-предохранителей — условное значение
};

export const phaseLoopModule = {
  id: 'phaseLoop',
  label: 'Петля фаза-ноль',
  description: 'IEC 60364-4-41 — проверка I_k1 ≥ I_a для срабатывания защиты при КЗ на корпус в TN-системе.',
  mandatory: true,
  order: 50,
  calc(input) {
    const earthing = String(input.earthingSystem || 'TN-S').toUpperCase();
    if (!earthing.startsWith('TN')) {
      return {
        pass: true,
        details: { skipped: true, reason: 'Система заземления ' + earthing + ' — петля не применяется.' },
        warnings: [],
      };
    }
    const L = Number(input.lengthM) || 0;
    if (L <= 0) {
      return { pass: true, details: { skipped: true, reason: 'длина не задана' }, warnings: [] };
    }
    const Uph = Number(input.Uph) || (Number(input.U) / Math.sqrt(3)) || 230;
    const sPhase = Number(input.currentSize) || 0;
    // Сечение нейтрали: по умолчанию = фазному (IEC 60364-5-52 §524.2).
    // Для PEN-проводника в TN-C при S ≥ 16 мм² допускается S_N ≥ 16.
    const sN = Number(input.nSize) || sPhase;
    if (sPhase <= 0) return { pass: false, details: {}, warnings: ['Сечение фазы не задано'] };

    const rho = RHO[input.material || 'Cu'] || RHO.Cu;
    const Rphase = rho * L / sPhase * HOT_FACTOR;
    const Rn     = rho * L / sN     * HOT_FACTOR;
    // Внутреннее сопротивление источника (приближённо 50 мОм для
    // низковольтной сети от трансформатора среднего размера).
    const Zsrc = Number(input.zSource) || 0.05;
    const Zloop = Zsrc + Rphase + Rn;
    const Ik1 = Zloop > 0 ? Uph / Zloop : 0;

    const In = Number(input.breakerIn) || Number(input.In) || 0;
    const breakerCurve = input.breakerCurve || 'MCB_C';
    const mult = MAG_MULT[breakerCurve] || 10;
    const Ia = In * mult;

    const passBreaker = Ik1 >= Ia;
    // УЗО (RCD) обеспечивает защиту при косвенном прикосновении
    // независимо от условия Ik1 ≥ Ia. По IEC 60364-4-41 §411.3.3
    // УЗО с IΔn ≤ 30 мА — дополнительная защита.
    const rcdEnabled = !!input.rcdEnabled;
    const rcdTripMa = Number(input.rcdTripMa) || 30;
    const pass = passBreaker || rcdEnabled;
    const warnings = [];
    if (!passBreaker && !rcdEnabled) {
      warnings.push(`I_k1 = ${Math.round(Ik1)} А < I_a = ${Ia} А (${breakerCurve} ${In}А × ${mult}). Установите УЗО или увеличьте сечение.`);
    } else if (!passBreaker && rcdEnabled) {
      warnings.push(`I_k1 = ${Math.round(Ik1)} А < I_a = ${Ia} А — защита обеспечивается УЗО (IΔn = ${rcdTripMa} мА).`);
    }
    return {
      pass,
      details: {
        earthing,
        Uph: Math.round(Uph),
        Rphase: Math.round(Rphase * 1000) / 1000,
        Rn: Math.round(Rn * 1000) / 1000,
        Zsrc,
        Zloop: Math.round(Zloop * 1000) / 1000,
        Ik1: Math.round(Ik1),
        Ia,
        In,
        breakerCurve,
        multiplier: mult,
        rcdEnabled,
        rcdTripMa: rcdEnabled ? rcdTripMa : null,
      },
      warnings,
    };
  },
};
