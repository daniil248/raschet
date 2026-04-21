/* psy-calculators.js — ЕДИНЫЙ калькулятор параметров влажного воздуха.
   Все параметры связаны между собой, каждое поле имеет единственную копию.

   Группы:
     1. Атмосфера   (h, P, Pk)                         coreSize=1
     2. Состояние   (t, T, φ, d, W, pv, Pws, h, tр, tм, v, ρ, mw, Cpa, pda, Rda, Rv)
                                                        coreSize=2  (из t, φ, d, pv, Pws, h, tр)
     3. Расход      (V, Vn, Gда, Gs)                   coreSize=1

   Введите любые известные → остальные посчитаются. Чекбокс 🔒 запрещает
   перезапись поля. Клик на auto-поле не сбрасывает его, можно сразу
   редактировать стрелками/клавиатурой.

   Формулы: ASHRAE Fundamentals 2021 / ГОСТ 4401-81 / СП 50.13330.2012.
*/

import { createMultiCalc } from '../shared/calc-widget.js';
import {
  T0, Pws, humidityRatio, enthalpy, specificVolume, density,
  dewPointFromW, wetBulb, RHfromW, pressureAtAltitude,
} from './psychrometrics-core.js';

/* -------------------- универсальный solver -------------------- */
function solve(knowns, locked) {
  const out = {};

  /* ======================= 1. АТМОСФЕРА ========================= */
  let P = null, h_alt = null;
  // приоритет: locked > явный P > Pk > h > default
  if ('P' in knowns)  P = knowns.P;
  else if ('Pk' in knowns) P = knowns.Pk * 1000;
  else if ('h' in knowns) { h_alt = knowns.h; P = pressureAtAltitude(h_alt); }
  else { P = 101325; h_alt = 0; }
  if (h_alt == null) {
    // инверсия барометрической формулы
    const r = P / 101325;
    h_alt = (1 - Math.pow(r, 1 / 5.2559)) / 2.25577e-5;
  }
  out.P  = P;
  out.Pk = P / 1000;
  out.h  = h_alt;

  /* ======================= 2. СОСТОЯНИЕ ========================= */
  // Нормализуем t из T если нужно
  const k = { ...knowns };
  if ('T' in k && !('t' in k)) k.t = k.T - T0;
  // Нормализуем W из d
  if ('d' in k && !('W' in k)) k.W = k.d / 1000;
  if ('W' in k && !('d' in k)) k.d = k.W * 1000;

  // Если задано Pws — можно получить t (обратная Hyland-Wexler)
  const invertPws = (pwsTarget) => {
    let t = 20;
    for (let i = 0; i < 60; i++) {
      const f = Math.log(Pws(t)) - Math.log(pwsTarget);
      const df = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
      const s = f / df; t -= s;
      if (Math.abs(s) < 1e-4) break;
    }
    return t;
  };
  if ('Pws' in k && !('t' in k)) k.t = invertPws(k.Pws);

  // Определим t и W из того, что есть
  let t = null, W = null;
  if ('t' in k && 'phi' in k) {
    t = k.t; W = humidityRatio(t, k.phi / 100, P);
  } else if ('t' in k && 'W' in k) {
    t = k.t; W = k.W;
  } else if ('t' in k && 'pv' in k) {
    t = k.t; W = 0.621945 * k.pv / (P - k.pv);
  } else if ('t' in k && 'tr' in k) {
    t = k.t;
    const pv = Pws(k.tr);
    W = 0.621945 * pv / (P - pv);
  } else if ('t' in k && 'h_enth' in k) {
    t = k.t;
    W = (k.h_enth - 1.006 * t) / (2501 + 1.86 * t);
  } else if ('t' in k && 'tm' in k) {
    t = k.t;
    // итеративно подобрать W из психрометрического ур-ния
    let Wg = humidityRatio(t, 0.5, P);
    for (let i = 0; i < 40; i++) {
      const Ws = 0.621945 * Pws(k.tm) / (P - Pws(k.tm));
      Wg = ((2501 - 2.326 * k.tm) * Ws - 1.006 * (t - k.tm)) / (2501 + 1.86 * t - 4.186 * k.tm);
      break;  // формула прямая, итерация не нужна
    }
    W = Wg;
  } else if ('phi' in k && 'W' in k) {
    W = k.W;
    let tt = 20;
    for (let i = 0; i < 80; i++) {
      const f = RHfromW(tt, W, P) - k.phi / 100;
      const df = (RHfromW(tt + 0.01, W, P) - RHfromW(tt - 0.01, W, P)) / 0.02;
      const s = f / df; tt -= s;
      if (Math.abs(s) < 1e-4) break;
    }
    t = tt;
  } else if ('pv' in k && 'phi' in k) {
    // Pws = pv/(phi/100) → t
    const Pws_t = k.pv / (k.phi / 100);
    t = invertPws(Pws_t);
    W = 0.621945 * k.pv / (P - k.pv);
  } else if ('tr' in k && 'phi' in k) {
    // pv = Pws(tr); Pws(t) = pv/phi → t
    const pv = Pws(k.tr);
    const Pws_t = pv / (k.phi / 100);
    t = invertPws(Pws_t);
    W = 0.621945 * pv / (P - pv);
  } else if ('t' in k) {
    t = k.t;  // без второго параметра — только Pws и T
  } else if ('tr' in k && 'W' in k) {
    // специфичный: tr → pv, W → t
    W = k.W;
    let tt = 20;
    for (let i = 0; i < 80; i++) {
      const f = RHfromW(tt, W, P) - (W * P / (0.621945 + W)) / Pws(tt);
      tt = k.tr + 1;  // fallback: оценка
      break;
    }
    t = tt;
  }

  /* --- заполняем state outs --- */
  if (t != null) {
    out.t = t;
    out.T = t + T0;
    out.Pws = Pws(t);
  }
  if (t != null && W != null) {
    const phi = Math.max(0, RHfromW(t, W, P));
    const pv  = W * P / (0.621945 + W);
    const pda = P - pv;
    const h_e = enthalpy(t, W);
    const v   = specificVolume(t, W, P);
    const rho = density(t, W, P);
    const Cpa = 1.006 + 1.86 * W;                  // кДж/(кг·К) влажного воздуха
    const mw  = (W * 1000) * rho / (1 + W);        // г_воды / м³ влажного воздуха
    const tr  = dewPointFromW(W, P);
    const tm  = wetBulb(t, Math.max(1e-6, Math.min(1, phi)), P);

    out.phi = phi * 100;
    out.d   = W * 1000;
    out.W   = W;
    out.pv  = pv;
    out.pda = pda;
    out.h_enth = h_e;
    out.v   = v;
    out.rho = rho;
    out.Cpa = Cpa;
    out.mw  = mw;
    out.tr  = tr;
    out.tm  = tm;
  }

  /* ======================== 3. РАСХОД =========================== */
  const rhoN = 1.2041;            // кг/м³ при 20 °C, 101 325 Па
  const rho_u = out.rho;
  const W_u   = ('W' in out) ? out.W : 0;
  if (Number.isFinite(rho_u)) {
    let V = null, Vn = null, Gda = null;
    if ('V'   in knowns) V   = knowns.V;
    if ('Vn'  in knowns) Vn  = knowns.Vn;
    if ('Gda' in knowns) Gda = knowns.Gda;
    if (Gda != null) {
      V  = V  ?? Gda * (1 + W_u) / rho_u;
      Vn = Vn ?? V * rho_u / rhoN;
    } else if (V != null) {
      Gda = V * rho_u / (1 + W_u);
      Vn  = Vn ?? V * rho_u / rhoN;
    } else if (Vn != null) {
      V   = Vn * rhoN / rho_u;
      Gda = V * rho_u / (1 + W_u);
    }
    if (V   != null) out.V   = V;
    if (Vn  != null) out.Vn  = Vn;
    if (Gda != null) { out.Gda = Gda; out.Gs = Gda / 3600; }
  }

  /* =================== КОНСТАНТЫ (всегда) ======================= */
  out.Rda = 287.055;   // Дж/(кг·К) — сухой воздух
  out.Rv  = 461.495;   // Дж/(кг·К) — водяной пар
  out.Ma  = 28.9644;   // г/моль
  out.Mv  = 18.015;    // г/моль

  return out;
}

/* -------------------- метаданные полей -------------------- */
const FIELDS = {
  // Атмосфера (приходит из «Условия объекта», read-only)
  h:   { label: 'Высота h',                  unit: 'м',       precision: 0, readOnly: true, hint: 'из «Условия объекта»' },
  P:   { label: 'P',                         unit: 'Па',      precision: 0, readOnly: true, hint: 'из «Условия объекта»' },
  Pk:  { label: 'P',                         unit: 'кПа',     precision: 3, readOnly: true, hint: 'из «Условия объекта»' },
  // Состояние
  t:   { label: 't',                         unit: '°C',      precision: 2 },
  T:   { label: 'T',                         unit: 'K',       precision: 2 },
  phi: { label: 'φ',                         unit: '%',       precision: 2 },
  d:   { label: 'd',                         unit: 'г/кг',    precision: 3 },
  W:   { label: 'W',                         unit: 'кг/кг',   precision: 6 },
  pv:  { label: 'p<sub>в</sub>',             unit: 'Па',      precision: 1 },
  Pws: { label: 'P<sub>нс</sub>',            unit: 'Па',      precision: 1 },
  pda: { label: 'p<sub>да</sub> = P − p<sub>в</sub>', unit: 'Па', precision: 1 },
  h_enth: { label: 'h (энтальпия)',          unit: 'кДж/кг',  precision: 3 },
  tr:  { label: 't<sub>р</sub> (точка росы)', unit: '°C',     precision: 2 },
  tm:  { label: 't<sub>м</sub> (мокрый терм.)', unit: '°C',   precision: 2 },
  v:   { label: 'v (уд. объём)',             unit: 'м³/кг',   precision: 4 },
  rho: { label: 'ρ (плотность)',             unit: 'кг/м³',   precision: 4 },
  mw:  { label: 'm<sub>в</sub> (вода в м³)', unit: 'г/м³',    precision: 3 },
  Cpa: { label: 'C<sub>p,вв</sub>',          unit: 'кДж/(кг·К)', precision: 5 },
  // Расход
  V:   { label: 'V (факт.)',                 unit: 'м³/ч',    precision: 2 },
  Vn:  { label: 'V (НУ)',                    unit: 'м³/ч',    precision: 2 },
  Gda: { label: 'G<sub>да</sub>',            unit: 'кг/ч',    precision: 2 },
  Gs:  { label: 'G<sub>да</sub>',            unit: 'кг/с',    precision: 4 },
  // Константы
  Rda: { label: 'R<sub>да</sub>',            unit: 'Дж/(кг·К)', precision: 3, readOnly: true, hint: 'константа' },
  Rv:  { label: 'R<sub>в</sub>',             unit: 'Дж/(кг·К)', precision: 3, readOnly: true, hint: 'константа' },
  Ma:  { label: 'M (сух. воздух)',           unit: 'г/моль',   precision: 4, readOnly: true, hint: 'константа' },
  Mv:  { label: 'M (вода)',                  unit: 'г/моль',   precision: 4, readOnly: true, hint: 'константа' },
};

const GROUPS = [
  {
    id: 'atm',
    title: 'Атмосфера (давление, высота)',
    keys: ['h', 'P', 'Pk'],
    coreSize: 1,
  },
  {
    id: 'state',
    title: 'Состояние влажного воздуха (задайте любые 2: t, φ, d, p<sub>в</sub>, P<sub>нс</sub>, h, t<sub>р</sub>, t<sub>м</sub>)',
    keys: ['t', 'T', 'phi', 'd', 'W', 'pv', 'Pws', 'pda', 'h_enth', 'tr', 'tm', 'v', 'rho', 'mw', 'Cpa'],
    coreSize: 2,
  },
  {
    id: 'flow',
    title: 'Расход воздуха (задайте 1 из V, V(НУ), G<sub>да</sub>)',
    keys: ['V', 'Vn', 'Gda', 'Gs'],
    coreSize: 1,
  },
  {
    id: 'const',
    title: 'Газовые константы (справочные)',
    keys: ['Rda', 'Rv', 'Ma', 'Mv'],
    coreSize: 0,
  },
];

export function mountPsyCalculators(container) {
  container.innerHTML = '';
  const calc = createMultiCalc({
    title: 'Калькулятор параметров влажного воздуха (полный)',
    desc: 'Заполните любые известные параметры — остальные будут вычислены. Все группы связаны: P атмосферы входит в расчёт d и h, ρ влияет на V/G<sub>да</sub>. У каждого параметра <b>одно поле ввода</b>. Чекбокс 🔒 запрещает пересчёт поля при вводе в другие. Клик на вычисленное поле не сбрасывает значение — можно редактировать с текущего числа.',
    groups: GROUPS,
    fields: FIELDS,
    solve,
  });
  container.appendChild(calc);
  // Инициализируем константы как выходы (они всегда есть в out)
  return calc;
}
