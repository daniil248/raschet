/* =========================================================================
   sp-485-annex-d.js — расчёт массы ГОТВ и количества модулей по
   СП 485.1311500.2020 Приложение Д (галогеноуглеводороды, сжиженные).

   Формулы (пример идентичен расчёту Такт-Газ-Плюс):
     k2  = paramp · fs/(sp·h) · tp · √h          — учёт потерь через проёмы
     r1  = r0 · k3 · 293 / (273 + tm)            — плотность паров ГОТВ
     mp  = sp·h · r1 · (1 + k2) · Cн/(100 − Cн)  — норм. масса ГОТВ
     r2  = r1 · pmin / 2                          — остаточная плотность в трубах
     m1  = mb + ob/1000 · r2                     — остаток ГОТВ в модуле
     mtr = obtr/1000 · r2                        — остаток ГОТВ в трубах
     n   = ⌈(mp + mtr) / (kz·ob/k1 − m1)⌉        — количество модулей
     mg  = k1 · (mp + mtr + n·m1)                — расчётная масса ГОТВ
     zr  = mg / n                                — заряд каждого модуля

   Приложение Ж — площадь дополнительного проёма сброса:
     rв  = 1.2 · k3 · 293/(273+tm)
     Fc  ≥ (1.2·k3·mp)/(0.7·1.05·tpd·r1) ·
            √[ rв / (7·10^6·pa·((piz+pa)/pa)^(2/7) − 1) ]  − fs
   ========================================================================= */

import { AGENTS } from './agents.js';
import { findVariant } from './modules-catalog.js';

export const META = {
  id: 'sp-485-annex-d',
  label: 'СП 485.1311500.2020, Приложение Д (Россия)',
  region: 'RU', year: 2020,
  refs: ['СП 485.1311500.2020, Прил. Д, Прил. Ж'],
};

/** Коэффициент K3 по высоте над ур.моря (линейно, упрощённо). */
export function K3_altitude(hm) {
  const h = Math.max(0, hm || 0);
  // СП 485 табл. Д.1 (упрощение): 0→1.00, 500→0.96, 1000→0.92, 2000→0.85
  if (h <=    0) return 1.00;
  if (h <=  500) return 1.00 - (h /  500) * 0.04;
  if (h <= 1000) return 0.96 - ((h-500)/500) * 0.04;
  if (h <= 2000) return 0.92 - ((h-1000)/1000) * 0.07;
  return 0.85;
}

/** Нормативная концентрация Сн (% об.) = Cmin · Kбез. */
export function Cnorm(agent, fireClass = 'A') {
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);
  const Cmin = fireClass === 'A' || fireClass === 'A2' ? a.Cmin_A : a.Cmin_B;
  const Kbez = fireClass === 'A' || fireClass === 'A2' ? 1.0 : 1.0; // в Прил.Д Сн уже задаётся в исходных данных
  return +(Cmin * Kbez).toFixed(2);
}

/**
 * Расчёт массы ГОТВ и количества модулей.
 * @param {Object} inp
 *  - agent: ключ ГОТВ (из AGENTS)
 *  - sp, h: площадь м² и высота помещения м
 *  - tm: минимальная температура °C
 *  - hm: высота над уровнем моря м
 *  - fs: площадь открытых проёмов, м²
 *  - paramp: параметр П (0.1…0.65)
 *  - cn: нормативная концентрация % об. (если не задана — берём Cmin·1.0)
 *  - tp: нормативное время подачи ОТВ, с (обычно 10 для хладонов)
 *  - fireClass: 'A' | 'A2' | 'B'
 *  - moduleCode: код модификации модуля из каталога
 *  - obtr: объём труб (л) из гидравлики (если 0 — принимается 0, mtr=0)
 *  - k1: коэф. утечек в дежурном режиме (по умолч. 1.05)
 */
export function compute(inp) {
  const {
    agent, sp, h, tm = 20, hm = 0, fs = 0, paramp = 0.4,
    cn, tp, fireClass = 'A',
    moduleCode, obtr = 0, k1 = 1.05,
  } = inp;

  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);
  const mod = findVariant(moduleCode);
  if (!mod) throw new Error('Unknown module: ' + moduleCode);

  const r0 = a.rho20;
  const K3 = K3_altitude(hm);
  const Cn = Number.isFinite(cn) ? +cn : Cnorm(agent, fireClass);
  const tpNorm = Number.isFinite(tp) ? +tp : a.dischargeS;

  // r1 — плотность паров ГОТВ при tm и hm
  const r1 = +(r0 * K3 * 293 / (273 + tm)).toFixed(3);

  // k2 — потери через проёмы: paramp · fs/(sp·h) · tp · √h
  const k2 = fs > 0
    ? +(paramp * (fs / (sp * h)) * tpNorm * Math.sqrt(h)).toFixed(4)
    : 0;

  // mp — нормативная масса
  const mp = +((sp * h * r1 * (1 + k2) * Cn / (100 - Cn))).toFixed(1);

  // r2 — плотность в трубах при минимальном давлении pmin (атм)
  const pmin = mod.pmin_atm;
  const r2 = +(r1 * pmin / 2).toFixed(3);

  // m1 — остаток ГОТВ в модуле
  const m1 = +(mod.mb + mod.ob / 1000 * r2).toFixed(2);

  // mtr — остаток ГОТВ в трубах
  const mtr = +(obtr / 1000 * r2).toFixed(3);

  // n — количество модулей
  const denom = mod.kz_max * mod.ob / k1 - m1;
  const nCalc = (mp + mtr) / denom;
  const n = Math.max(1, Math.ceil(nCalc));

  // mg — расчётная масса, zr — заряд одного модуля
  const mg = +(k1 * (mp + mtr + n * m1)).toFixed(1);
  const zr = +(mg / n).toFixed(2);

  // mg минимальная (без труб, без остатка) — нижняя граница
  const Mmin = +(mp).toFixed(1);

  // tpd — расчётное время подачи 95% mp (п.9.1.3 СП 485, упрощ. = 0.95·tp · √(n/1))
  const tpd = +(tpNorm * Math.sqrt(Math.max(1, n))).toFixed(2);

  return {
    method: META.id, agent, agentLabel: a.label, moduleCode,
    // входные (нормализованные)
    inputs: { sp, h, tm, hm, fs, paramp, Cn, tp: tpNorm, fireClass, k1, pmin },
    // промежуточные
    K3, r0, r1, k2, r2, m1, mtr, obtr,
    kz_max: mod.kz_max, ob: mod.ob, mb: mod.mb,
    // результаты
    mp, mg, zr, n, Mmin, tpd,
    dischargeS: tpNorm,
    Mreserve: mg,
    // для совместимости со spec/cylinder UI
    M: mg, C: Cn,
    steps: [
      `Агент: ${a.label}; класс пожара ${fireClass}; Cн = ${Cn}% об.`,
      `r1 = r0·K3·293/(273+tm) = ${r0}·${K3.toFixed(3)}·293/${(273+tm)} = ${r1} кг/м³`,
      `k2 = П·fs/(sp·h)·tp·√h = ${k2}`,
      `mp = sp·h·r1·(1+k2)·Cн/(100−Cн) = ${sp}·${h}·${r1}·(1+${k2})·${Cn}/${(100-Cn).toFixed(1)} = ${mp} кг`,
      `r2 = r1·pmin/2 = ${r1}·${pmin}/2 = ${r2} кг/м³`,
      `m1 = mb + ob/1000·r2 = ${mod.mb} + ${mod.ob}/1000·${r2} = ${m1} кг`,
      `mtr = obtr/1000·r2 = ${obtr}/1000·${r2} = ${mtr} кг`,
      `n = ⌈(mp+mtr)/(kz·ob/k1 − m1)⌉ = ⌈(${mp}+${mtr})/(${mod.kz_max}·${mod.ob}/${k1} − ${m1})⌉ = ${n}`,
      `mg = k1·(mp + mtr + n·m1) = ${k1}·(${mp} + ${mtr} + ${n}·${m1}) = ${mg} кг`,
      `Заряд модуля zr = mg/n = ${mg}/${n} = ${zr} кг`,
    ],
  };
}

/* ------- Приложение Ж: площадь дополнительного проёма сброса ------- */
/**
 * @param {Object} p
 *  - mp, r1, tpd: из результатов compute()
 *  - tm (°C), hm (м), piz (МПа), fs (м²)
 *  - K3_opening: коэф. к3 для подачи ГОТВ (для хладонов ≈ 1)
 */
export function reliefArea(p) {
  const { mp, r1, tpd, tm = 20, hm = 0, piz = 0.003, fs = 0, K3_opening = 1 } = p;
  const K2alt = 1; // упрощённо для hm=0; при hm>0 — коррекция по K3_altitude
  const pa = +(0.1 * K2alt).toFixed(4);                    // МПа
  const rho_air = +(1.2 * K2alt * 293 / (273 + tm)).toFixed(3);

  // (piz+pa)/pa возведённое в степень 2/7
  const ratio27 = Math.pow((piz + pa) / pa, 2 / 7);
  const denom = 7 * 1e6 * pa * (ratio27 - 1);              // Па
  const A = (1.2 * K3_opening * mp) / (0.7 * 1.05 * tpd * r1);
  const root = Math.sqrt(Math.max(0, rho_air / denom));
  const Fc = Math.max(0, +(A * root - fs).toFixed(4));

  return {
    pa, rho_air, ratio27: +ratio27.toFixed(5),
    A: +A.toFixed(3), Fc,
    steps: [
      `ρв = 1.2·K2·293/(273+tm) = ${rho_air} кг/м³`,
      `pa = 0.1·K2 = ${pa} МПа;  piz = ${piz} МПа`,
      `((piz+pa)/pa)^(2/7) = ${ratio27.toFixed(5)}`,
      `Fc ≥ 1.2·K3·mp/(0.7·1.05·tpd·r1) · √[ρв/(7·10⁶·pa·(...−1))] − fs = ${Fc} м²`,
    ],
  };
}
