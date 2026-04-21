/* =========================================================================
   hydraulics.js — упрощённый гидравлический расчёт трубопровода АГПТ.
   Darcy–Weisbach для изотермического течения сжиженного хладона в жидко-
   паровой фазе. Используется для грубой оценки падения давления и
   проверки достаточности давления перед насадками.

   Модель (упрощённая):
     m_dot_total = mg / tp         — суммарный массовый расход, кг/с
     на каждом участке m_dot = m_dot_total × weight
         где weight = доля потока, идущая через данный участок
         (по умолч. поровну между всеми насадками-концами ветвей).
     ρ_mix ≈ r2 (плотность в трубах при pmin), кг/м³
     v     = m_dot / (ρ · A),          A = π·Dвн²/4
     Re    = ρ·v·Dвн/μ                 (μ хладон ≈ 2.5e-4 Па·с)
     λ     = 0.11·(Δ/Dвн + 68/Re)^0.25 (формула Альтшуля)
     ΔP    = λ · (L/Dвн) · ρ·v²/2      (Darcy-Weisbach)
     + локальные потери ζ·ρ·v²/2 (углы, тройники — учитываются
     эквивалентной длиной L_экв = ζ·Dвн/λ).

   Это приближение — для окончательного проектирования использовать
   специализированные модули производителей (DIOM, FSSA-2001).
   ========================================================================= */

import { AGENTS } from './agents.js';
import { findVariant } from './modules-catalog.js';

const DN_TO_IDMM = {
  15: 16,  20: 21.6, 22: 15,   25: 27.0, 28: 20,  32: 35.9,
  34: 27,  40: 41.9, 50: 53.1, 65: 68.9, 80: 80.9, 100: 107.1,
};
const ZETA = { elbow: 0.5, tee_through: 0.2, tee_branch: 1.5, reducer: 0.1, nozzle: 1.0 };

/** Внутренний диаметр, мм, по DN (или OD×wall). */
function idMm(seg) {
  if (Number.isFinite(seg.ID)) return +seg.ID;
  return DN_TO_IDMM[+seg.DN] ?? (+seg.DN);
}

/**
 * @param {Object} p
 *   - pipeline: массив участков [{ id, axis, L, DN, nozzle, zetaExtra }]
 *   - agent, moduleCode, mg, tp, r2
 * @returns {Object} сегменты с ΔP, скорость, Re, λ; суммарные метрики.
 */
export function computeHydraulic(p) {
  const { pipeline = [], agent, mg, tp, r2, zetaPer = {} } = p;
  if (!pipeline.length) return { segments: [], dPtotal: 0, vMax: 0, reMin: 0 };

  const a = AGENTS[agent];
  const mu = 2.5e-4;                                // Па·с, хладон (~жидк.)
  const rho = r2 || a?.rho20 || 7;                  // кг/м³
  const eps = 0.00015;                              // мм, шероховатость ст.труб

  // Количество насадков (точек выпуска). Массовый расход делится поровну.
  const nozzles = pipeline.filter(s => s.nozzle && s.nozzle !== 'none').length || 1;
  const mdotPerNozzle = (mg / tp) / nozzles;

  // Упрощённое распределение: каждый участок несёт поток, пропорциональный
  // числу нисходящих насадков. На данном этапе принимаем «по одному насадку
  // на ветвь» и полный m_dot для магистральных участков.
  // (Будущая доработка: учёт топологии parent-child)
  const segments = pipeline.map((s, i) => {
    const downstreamNozzles = s.nozzle && s.nozzle !== 'none' ? 1 : nozzles;
    const mdot = mdotPerNozzle * downstreamNozzles;
    const ID_mm = idMm(s);
    const D = ID_mm / 1000;                         // м
    const A = Math.PI * D * D / 4;                  // м²
    const v = mdot / (rho * A);                     // м/с
    const Re = rho * v * D / mu;
    const rel = eps / ID_mm;
    const lam = 0.11 * Math.pow(rel + 68 / Math.max(Re, 1), 0.25);
    const L = +s.L || 0;
    const dPlin = lam * (L / D) * rho * v * v / 2;  // Па
    const ze = (zetaPer[s.id] ?? (s.nozzle && s.nozzle !== 'none' ? ZETA.nozzle : ZETA.elbow));
    const dPloc = ze * rho * v * v / 2;
    const dP = dPlin + dPloc;
    return {
      id: s.id, idx: i+1, DN: s.DN, ID_mm, L,
      mdot: +mdot.toFixed(3),
      v: +v.toFixed(2), Re: Math.round(Re),
      lambda: +lam.toFixed(4),
      dPlin: +dPlin.toFixed(0), dPloc: +dPloc.toFixed(0),
      dP: +dP.toFixed(0),
      nozzle: s.nozzle || 'none',
    };
  });

  const dPtotal = segments.reduce((a, s) => a + s.dP, 0);
  const vMax = Math.max(...segments.map(s => s.v));
  const reMin = Math.min(...segments.map(s => s.Re));

  // Давление на выходе
  const mod = findVariant(p.moduleCode);
  const P_in_bar = mod?.pressure_bar || 42;
  const P_out_bar = P_in_bar - dPtotal / 1e5;

  return {
    segments,
    dPtotal,                  // Па
    dPtotalBar: +(dPtotal / 1e5).toFixed(2),
    vMax: +vMax.toFixed(2),
    reMin,
    P_in_bar,
    P_out_bar: +P_out_bar.toFixed(2),
    P_min_required_bar: (mod?.pmin_atm || 6) * 1.013,
    ok: P_out_bar >= (mod?.pmin_atm || 6) * 1.013,
    steps: [
      `ρ в трубе ≈ ${rho.toFixed(2)} кг/м³; μ = ${mu.toExponential(1)} Па·с`,
      `Насадков: ${nozzles}; m˙/насадок = ${mdotPerNozzle.toFixed(2)} кг/с`,
      `Σ ΔP = ${(dPtotal/1e5).toFixed(2)} бар; v_max = ${vMax.toFixed(1)} м/с`,
      `P_вх = ${P_in_bar} бар → P_вых ≈ ${P_out_bar.toFixed(2)} бар (мин ${((mod?.pmin_atm||6)*1.013).toFixed(1)} бар)`,
      P_out_bar >= (mod?.pmin_atm||6)*1.013 ? '✓ Давления достаточно' : '✗ Давления НЕ достаточно — уменьшить L или увеличить DN',
    ],
  };
}

/** Рекомендованный DN по массовому расходу и целевой скорости. */
export function recommendDN(mdot, rho, targetV = 35) {
  const A = mdot / (rho * targetV);                  // м²
  const Dmm = Math.sqrt(4 * A / Math.PI) * 1000;
  const DN_LIST = [15, 20, 25, 32, 40, 50, 65, 80, 100];
  return DN_LIST.find(d => (DN_TO_IDMM[d] || d) >= Dmm) || 100;
}
