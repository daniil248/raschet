/* =========================================================================
   hydraulic-methods/darcy-weisbach.js — расчёт потерь напора/давления
   в напорном трубопроводе (Дарси–Вейсбах + Colebrook–White).
   Контракт calc-lib: { META, compute(input) } (как suppression-methods).
   ========================================================================= */

import {
  waterDensity, waterKinematicViscosity, pipeArea, flowVelocity,
  reynolds, frictionFactor, headLossDarcy, headLossLocal,
  headToPressure, ROUGHNESS, G,
} from './formulas.js';

export const META = {
  id: 'darcy-weisbach',
  label: 'Потери напора — Дарси–Вейсбах',
  standard: 'Дарси–Вейсбах + Colebrook–White / Swamee–Jain (универсальный)',
  region: 'INT',
  version: '1.0',
  enabled: true,
  discipline: 'hydraulic',
  refs: ['Darcy–Weisbach', 'Colebrook–White / Swamee–Jain', 'СП 30.13330'],
  // X.4.4: декларативная схема входа для авто-формы producer'а.
  inputs: [
    { key: 'Q',      label: 'Расход',            unit: 'м³/ч', type: 'number', default: 36, required: true },
    { key: 'D_mm',   label: 'Внутр. диаметр',    unit: 'мм',   type: 'number', default: 100, required: true },
    { key: 'L',      label: 'Длина участка',     unit: 'м',    type: 'number', default: 120, required: true },
    { key: 'material', label: 'Материал трубы',  unit: '',     type: 'select', default: 'steel_used',
      options: [
        { value: 'steel_new', label: 'Сталь новая' },
        { value: 'steel_used', label: 'Сталь б/у' },
        { value: 'galvanized', label: 'Оцинковка' },
        { value: 'cast_iron', label: 'Чугун' },
        { value: 'copper', label: 'Медь' },
        { value: 'pvc', label: 'ПВХ' },
        { value: 'pe', label: 'ПЭ' },
        { value: 'concrete', label: 'Бетон' },
      ] },
    { key: 'sumK',   label: 'Σ местных сопрот.', unit: '',     type: 'number', default: 0 },
    { key: 'tC',     label: 'Темп. воды',        unit: '°C',   type: 'number', default: 20 },
    { key: 'dz',     label: 'Геод. перепад',     unit: 'м',    type: 'number', default: 0 },
  ],
};

/**
 * @param {object} input
 *   Q        — расход, м³/ч (вход в привычных единицах)
 *   D_mm     — внутренний диаметр, мм
 *   L        — длина участка, м
 *   material — ключ ROUGHNESS ('steel_new'…) | eps_mm абс. шероховатость, мм
 *   eps_mm   — переопределение шероховатости, мм (опц.)
 *   sumK     — сумма коэф. местных сопротивлений (опц., 0)
 *   tC       — температура воды, °C (опц., 20)
 *   dz       — геодезический перепад (выход−вход), м (опц., 0; + = подъём)
 * @returns {object} { v, Re, regime, f, hf_len, hf_local, hf_geo, hf_total,
 *                      dP_total, rho, nu, ... }
 */
export function compute(input = {}) {
  const Qh   = Number(input.Q) || 0;            // м³/ч
  const Q    = Qh / 3600;                        // м³/с
  const D    = (Number(input.D_mm) || 0) / 1000; // м
  const L    = Number(input.L) || 0;
  const tC   = Number.isFinite(+input.tC) ? +input.tC : 20;
  const sumK = Number(input.sumK) || 0;
  const dz   = Number(input.dz) || 0;
  const eps  = Number.isFinite(+input.eps_mm)
    ? (+input.eps_mm) / 1000
    : (ROUGHNESS[input.material] ?? ROUGHNESS.steel_new);

  const rho = waterDensity(tC);
  const nu  = waterKinematicViscosity(tC);
  const v   = flowVelocity(Q, D);
  const Re  = reynolds(v, D, nu);
  const f   = frictionFactor(Re, eps, D);

  const hf_len   = headLossDarcy(f, L, D, v);
  const hf_local = headLossLocal(sumK, v);
  const hf_geo   = dz;                            // подъём = доп. напор
  const hf_total = hf_len + hf_local + hf_geo;
  const dP_total = headToPressure(hf_total, rho);

  const regime = Re <= 0 ? '—' : (Re < 2300 ? 'ламинарный'
    : (Re < 4000 ? 'переходный' : 'турбулентный'));

  return {
    method: META.id,
    inputs: { Q_m3h: Qh, D_mm: input.D_mm, L, tC, sumK, dz, eps_mm: eps * 1000 },
    rho, nu, area_m2: pipeArea(D),
    v, Re, regime, f,
    hf_len, hf_local, hf_geo, hf_total,
    dP_total, dP_kPa: dP_total / 1000,
    // удельные потери на 100 м (для подбора диаметра)
    i_per_100m: D > 0 && L > 0 ? hf_len / L * 100 : 0,
    steps: [
      `v = Q/A = ${(Qh / 3600).toFixed(5)}/${pipeArea(D).toFixed(6)} = ${v.toFixed(3)} м/с`,
      `Re = v·D/ν = ${v.toFixed(3)}·${D.toFixed(4)}/${nu.toExponential(3)} = ${Re.toFixed(0)} (${regime})`,
      `f = ${f.toFixed(5)} (Swamee–Jain, ε=${(eps * 1000).toFixed(4)} мм)`,
      `hf = f·(L/D)·v²/2g = ${hf_len.toFixed(3)} м; местн. ${hf_local.toFixed(3)} м; геод. ${hf_geo.toFixed(3)} м`,
      `ΔP = ρ·g·Σh = ${rho.toFixed(1)}·${G}·${hf_total.toFixed(3)} = ${(dP_total / 1000).toFixed(2)} кПа`,
    ],
  };
}
