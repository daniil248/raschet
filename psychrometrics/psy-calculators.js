/* psy-calculators.js — группа калькуляторов «заполни известные → получи неизвестные».
   Построено на shared/calc-widget.js. Формулы — ASHRAE Fundamentals 2021 /
   СП 50.13330.2012 / ГОСТ 4401-81.

   Все калькуляторы независимы друг от друга, работают на одной странице,
   не конфликтуют с основным циклом. Виджет сам решает, что считать
   известным, а что — выходом.
*/

import { createCalcCard, mountCalcGroup } from '../shared/calc-widget.js';
import {
  T0, Pws, humidityRatio, enthalpy, specificVolume, density,
  dewPointFromW, wetBulb, RHfromW, pressureAtAltitude,
} from './psychrometrics-core.js';

/* ---------- конвертер T ↔ K ---------- */
function cardTemperature() {
  return createCalcCard({
    title: 'Температура: °C ↔ K',
    desc: 'Связь между шкалой Цельсия и Кельвина.',
    formula: '<code>T [K] = t [°C] + 273,15</code>',
    fields: [
      { key: 't', label: 't', unit: '°C', precision: 2 },
      { key: 'T', label: 'T', unit: 'K', precision: 2 },
    ],
    solve: k => {
      if ('t' in k) return { T: k.t + T0 };
      if ('T' in k) return { t: k.T - T0 };
      return { t: 20, T: 293.15 };
    },
  });
}

/* ---------- барометрическое давление ---------- */
function cardBarometric() {
  return createCalcCard({
    title: 'Атмосферное давление на высоте',
    desc: 'ISA / ГОСТ 4401-81 (до ~5000 м). P₀ = 101 325 Па — на уровне моря.',
    formula: '<code>P(h) = P₀·(1 − 2,25577·10⁻⁵·h)<sup>5,2559</sup></code>',
    fields: [
      { key: 'h',  label: 'Высота h', unit: 'м',   precision: 0 },
      { key: 'P0', label: 'P₀',       unit: 'Па',  precision: 0, hint: 'по умолчанию 101 325' },
      { key: 'P',  label: 'P(h)',     unit: 'Па',  precision: 0 },
      { key: 'Pk', label: 'P(h)',     unit: 'кПа', precision: 3 },
    ],
    solve: k => {
      const P0 = ('P0' in k) ? k.P0 : 101325;
      if ('h' in k) {
        const P = pressureAtAltitude(k.h, P0);
        return { P0, P, Pk: P / 1000 };
      }
      if ('P' in k) {
        // инверсия: h = (1 − (P/P0)^(1/5.2559)) / 2.25577e-5
        const h = (1 - Math.pow(k.P / P0, 1 / 5.2559)) / 2.25577e-5;
        return { P0, h, Pk: k.P / 1000 };
      }
      if ('Pk' in k) {
        const P = k.Pk * 1000;
        const h = (1 - Math.pow(P / P0, 1 / 5.2559)) / 2.25577e-5;
        return { P0, h, P };
      }
      return { P0, P: P0, Pk: P0 / 1000, h: 0 };
    },
  });
}

/* ---------- плотность воздуха ρ = p·M/(R·T) ---------- */
function cardAirDensity() {
  return createCalcCard({
    title: 'Плотность сухого воздуха ρ = p·M/(R·T)',
    desc: 'Уравнение состояния идеального газа. M = 0,0289644 кг/моль, R = 8,314463 Дж/(моль·К).',
    formula: '<code>ρ = P·M / (R·T)</code>,  T = t + 273,15',
    fields: [
      { key: 'P',   label: 'P',  unit: 'Па',      precision: 0 },
      { key: 't',   label: 't',  unit: '°C',      precision: 2 },
      { key: 'rho', label: 'ρ',  unit: 'кг/м³',   precision: 4 },
    ],
    solve: k => {
      const M = 0.0289644, R = 8.314462618;
      if ('P' in k && 't' in k) {
        const T = k.t + T0;
        return { rho: (k.P * M) / (R * T) };
      }
      if ('rho' in k && 't' in k) {
        const T = k.t + T0;
        return { P: (k.rho * R * T) / M };
      }
      if ('rho' in k && 'P' in k) {
        const T = (k.P * M) / (k.rho * R);
        return { t: T - T0 };
      }
      return {};
    },
  });
}

/* ---------- давление насыщения Pws (Hyland-Wexler) ---------- */
function cardSaturationPressure() {
  return createCalcCard({
    title: 'Давление насыщения водяного пара',
    desc: 'Hyland-Wexler 1983 (ASHRAE). Над водой (t ≥ 0 °C) и надо льдом (t < 0 °C). Точность ±0,1 %.',
    formula: '<code>ln(P<sub>нс</sub>) = C₈/T + C₉ + C₁₀·T + C₁₁·T² + C₁₂·T³ + C₁₃·lnT</code>',
    fields: [
      { key: 't',    label: 't',        unit: '°C', precision: 2 },
      { key: 'Pws',  label: 'P<sub>нс</sub>',  unit: 'Па', precision: 1 },
      { key: 'PwsK', label: 'P<sub>нс</sub>',  unit: 'кПа', precision: 4 },
    ],
    solve: k => {
      if ('t' in k) {
        const p = Pws(k.t);
        return { Pws: p, PwsK: p / 1000 };
      }
      if ('Pws' in k || 'PwsK' in k) {
        const target = ('Pws' in k) ? k.Pws : k.PwsK * 1000;
        // Newton для t (по ln)
        let t = 20;
        for (let i = 0; i < 50; i++) {
          const f = Math.log(Pws(t)) - Math.log(target);
          const dfdt = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
          const step = f / dfdt; t -= step;
          if (Math.abs(step) < 1e-4) break;
        }
        return { t, Pws: target, PwsK: target / 1000 };
      }
      return {};
    },
  });
}

/* ---------- парциальное давление пара pv = φ·Pws ---------- */
function cardPartialPressure() {
  return createCalcCard({
    title: 'Парциальное давление водяного пара',
    desc: 'По относительной влажности φ и температуре.',
    formula: '<code>p<sub>в</sub> = (φ/100) · P<sub>нс</sub>(t)</code>',
    fields: [
      { key: 't',   label: 't',  unit: '°C', precision: 2 },
      { key: 'phi', label: 'φ',  unit: '%',  precision: 1 },
      { key: 'pv',  label: 'p<sub>в</sub>', unit: 'Па', precision: 1 },
      { key: 'Pws', label: 'P<sub>нс</sub>', unit: 'Па', precision: 1 },
    ],
    solve: k => {
      if ('t' in k && 'phi' in k) {
        const ps = Pws(k.t);
        return { Pws: ps, pv: (k.phi / 100) * ps };
      }
      if ('t' in k && 'pv' in k) {
        const ps = Pws(k.t);
        return { Pws: ps, phi: 100 * k.pv / ps };
      }
      if ('phi' in k && 'pv' in k) {
        // φ·Pws = pv → Pws = pv/φ → t из обратной
        const Pws_target = k.pv / (k.phi / 100);
        let t = 20;
        for (let i = 0; i < 50; i++) {
          const f = Math.log(Pws(t)) - Math.log(Pws_target);
          const dfdt = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
          const step = f / dfdt; t -= step;
          if (Math.abs(step) < 1e-4) break;
        }
        return { t, Pws: Pws_target };
      }
      return {};
    },
  });
}

/* ---------- влагосодержание d = 621.945·pv/(P−pv) ---------- */
function cardHumidityRatio() {
  return createCalcCard({
    title: 'Влагосодержание d',
    desc: 'Масса водяного пара на кг сухого воздуха. Связь с парциальным давлением пара.',
    formula: '<code>d = 621,945 · p<sub>в</sub> / (P − p<sub>в</sub>)</code> [г/кг]',
    fields: [
      { key: 'P',  label: 'P',  unit: 'Па',     precision: 0 },
      { key: 'pv', label: 'p<sub>в</sub>', unit: 'Па', precision: 1 },
      { key: 'd',  label: 'd',  unit: 'г/кг',   precision: 3 },
    ],
    solve: k => {
      const P = ('P' in k) ? k.P : 101325;
      if ('pv' in k) return { P, d: 621.945 * k.pv / (P - k.pv) };
      if ('d' in k) {
        // d/1000 = 0.621945 · pv/(P-pv)
        const W = k.d / 1000;
        return { P, pv: W * P / (0.621945 + W) };
      }
      return { P };
    },
  });
}

/* ---------- полное состояние влажного воздуха (t, φ, d, h, tр, tм, v, ρ) ---------- */
function cardFullState() {
  return createCalcCard({
    title: 'Полное состояние воздуха',
    desc: 'Задайте <b>любые два</b> из (t, φ, d) — остальное (h, t<sub>р</sub>, t<sub>м</sub>, v, ρ, p<sub>в</sub>) рассчитается автоматически. P по умолчанию 101 325 Па.',
    formula:
      '<code>h = 1,006·t + d/1000·(2501 + 1,86·t)</code><br>' +
      '<code>v = R<sub>a</sub>·T·(1 + 1,6078·W)/P</code>,  R<sub>a</sub>=287,055 Дж/(кг·К)<br>' +
      '<code>ρ = (1+W)/v</code>',
    fields: [
      { key: 'P',   label: 'P',    unit: 'Па',      precision: 0 },
      { key: 't',   label: 't',    unit: '°C',      precision: 2 },
      { key: 'phi', label: 'φ',    unit: '%',       precision: 1 },
      { key: 'd',   label: 'd',    unit: 'г/кг',    precision: 3 },
      { key: 'h',   label: 'h',    unit: 'кДж/кг',  precision: 2 },
      { key: 'tr',  label: 't<sub>р</sub>', unit: '°C', precision: 2 },
      { key: 'tm',  label: 't<sub>м</sub>', unit: '°C', precision: 2 },
      { key: 'v',   label: 'v',    unit: 'м³/кг',   precision: 4 },
      { key: 'rho', label: 'ρ',    unit: 'кг/м³',   precision: 4 },
      { key: 'pv',  label: 'p<sub>в</sub>', unit: 'Па', precision: 1 },
    ],
    solve: k => {
      const P = ('P' in k) ? k.P : 101325;
      // Определяем t и W из любых двух: (t,φ), (t,d), (φ,d)
      let t, W;
      if ('t' in k && 'phi' in k) {
        t = k.t; W = humidityRatio(t, k.phi / 100, P);
      } else if ('t' in k && 'd' in k) {
        t = k.t; W = k.d / 1000;
      } else if ('phi' in k && 'd' in k) {
        // φ·Pws(t) · 0.621945/(P-φPws) = W → итерация по t
        const W_t = k.d / 1000;
        let tt = 20;
        for (let i = 0; i < 80; i++) {
          const phi_guess = RHfromW(tt, W_t, P);
          const f = phi_guess - k.phi / 100;
          const dphi = (RHfromW(tt + 0.01, W_t, P) - RHfromW(tt - 0.01, W_t, P)) / 0.02;
          const step = f / dphi; tt -= step;
          if (Math.abs(step) < 1e-4) break;
        }
        t = tt; W = W_t;
      } else if ('t' in k && 'h' in k) {
        t = k.t; W = (k.h - 1.006 * t) / (2501 + 1.86 * t);
      } else {
        return { P };
      }
      const phi = RHfromW(t, W, P) * 100;
      const h   = enthalpy(t, W);
      const tr  = dewPointFromW(W, P);
      const tm  = wetBulb(t, Math.max(0, Math.min(1, phi / 100)), P);
      const v   = specificVolume(t, W, P);
      const rho = density(t, W, P);
      const pv  = W * P / (0.621945 + W);
      return { P, t, phi, d: W * 1000, h, tr, tm, v, rho, pv };
    },
  });
}

/* ---------- приведение расхода к нормальным условиям ---------- */
function cardNormalVolume() {
  return createCalcCard({
    title: 'Расход: фактические ↔ нормальные условия',
    desc: 'Нормальные условия (НУ): 20 °C, 101 325 Па → ρ<sub>N</sub> = 1,2041 кг/м³. Пересчёт по сохранению массы.',
    formula: '<code>V<sub>N</sub> = V · ρ / ρ<sub>N</sub></code>',
    fields: [
      { key: 'V',   label: 'V (факт.)', unit: 'м³/ч',   precision: 1 },
      { key: 'rho', label: 'ρ (факт.)', unit: 'кг/м³',  precision: 4 },
      { key: 'Vn',  label: 'V (норм.)', unit: 'м³/ч',   precision: 1 },
    ],
    solve: k => {
      const rhoN = 1.2041;
      if ('V' in k && 'rho' in k) return { Vn: k.V * k.rho / rhoN };
      if ('Vn' in k && 'rho' in k) return { V: k.Vn * rhoN / k.rho };
      if ('V' in k && 'Vn' in k)  return { rho: (k.Vn / k.V) * rhoN };
      return {};
    },
  });
}

/* ---------- тепловая мощность процесса ---------- */
function cardProcessPower() {
  return createCalcCard({
    title: 'Тепловая мощность процесса',
    desc: 'Расход сух. воздуха: G<sub>да</sub> = V·ρ/(1+W). Нагрузка: Q = G<sub>да</sub>·Δh/3600.',
    formula:
      '<code>G<sub>да</sub> [кг/ч] = V·ρ/(1+W)</code><br>' +
      '<code>Q [кВт] = G<sub>да</sub> · Δh / 3600</code>',
    fields: [
      { key: 'V',   label: 'V',    unit: 'м³/ч',   precision: 1 },
      { key: 'rho', label: 'ρ',    unit: 'кг/м³',  precision: 4, hint: 'плотность на входе' },
      { key: 'W',   label: 'W',    unit: 'кг/кг',  precision: 5, hint: 'на входе (d/1000)' },
      { key: 'dh',  label: 'Δh',   unit: 'кДж/кг', precision: 2 },
      { key: 'G',   label: 'G<sub>да</sub>', unit: 'кг/ч', precision: 1 },
      { key: 'Q',   label: 'Q',    unit: 'кВт',    precision: 3 },
    ],
    solve: k => {
      const rho = ('rho' in k) ? k.rho : 1.2;
      const W   = ('W'   in k) ? k.W   : 0;
      let G = 'G' in k ? k.G : null;
      if (G == null && 'V' in k) G = k.V * rho / (1 + W);
      const out = { rho, W };
      if (G != null) out.G = G;
      if (G != null && 'V' in k) { /* ничего */ }
      else if (G != null && !('V' in k)) out.V = G * (1 + W) / rho;
      if ('dh' in k && G != null) out.Q = G * k.dh / 3600;
      if ('Q'  in k && G != null) out.dh = k.Q * 3600 / G;
      if ('Q'  in k && 'dh' in k && G == null) {
        const GG = k.Q * 3600 / k.dh;
        out.G = GG;
        if ('V' in k) out.rho = GG * (1 + W) / k.V;
        else out.V = GG * (1 + W) / rho;
      }
      return out;
    },
  });
}

/* ---------- влагоприток процесса ---------- */
function cardMoistureLoad() {
  return createCalcCard({
    title: 'Влагоприток процесса',
    desc: 'Масса влаги, вносимая (+) или удаляемая (−) в единицу времени.',
    formula: '<code>q<sub>w</sub> [кг/ч] = G<sub>да</sub> · ΔW</code>,  ΔW = Δd/1000',
    fields: [
      { key: 'G',  label: 'G<sub>да</sub>', unit: 'кг/ч', precision: 1 },
      { key: 'dd', label: 'Δd',             unit: 'г/кг', precision: 3 },
      { key: 'qw', label: 'q<sub>w</sub>',  unit: 'кг/ч', precision: 3 },
    ],
    solve: k => {
      if ('G'  in k && 'dd' in k) return { qw: k.G * k.dd / 1000 };
      if ('G'  in k && 'qw' in k) return { dd: k.qw * 1000 / k.G };
      if ('dd' in k && 'qw' in k) return { G: k.qw * 1000 / k.dd };
      return {};
    },
  });
}

/* ---------- точка росы из парциального давления ---------- */
function cardDewPoint() {
  return createCalcCard({
    title: 'Точка росы t<sub>р</sub>',
    desc: 'Температура, при которой воздух с данным p<sub>в</sub> становится насыщенным (φ = 100 %).',
    formula: '<code>P<sub>нс</sub>(t<sub>р</sub>) = p<sub>в</sub></code> — решается итерационно.',
    fields: [
      { key: 'pv', label: 'p<sub>в</sub>', unit: 'Па', precision: 1 },
      { key: 'tr', label: 't<sub>р</sub>', unit: '°C', precision: 2 },
    ],
    solve: k => {
      if ('pv' in k) {
        // использовать инверсию Pws
        let t = 10;
        for (let i = 0; i < 50; i++) {
          const f = Math.log(Pws(t)) - Math.log(k.pv);
          const d = (Math.log(Pws(t + 0.01)) - Math.log(Pws(t - 0.01))) / 0.02;
          const s = f / d; t -= s;
          if (Math.abs(s) < 1e-4) break;
        }
        return { tr: t };
      }
      if ('tr' in k) return { pv: Pws(k.tr) };
      return {};
    },
  });
}

/* ---------- мокрый термометр ---------- */
function cardWetBulb() {
  return createCalcCard({
    title: 'Температура мокрого термометра t<sub>м</sub>',
    desc: 'Психрометрическое уравнение ASHRAE (итерация).',
    formula: '<code>W = [(2501 − 2,326·t<sub>м</sub>)·W<sub>s</sub>(t<sub>м</sub>) − 1,006·(t − t<sub>м</sub>)] / (2501 + 1,86·t − 4,186·t<sub>м</sub>)</code>',
    fields: [
      { key: 't',   label: 't',  unit: '°C', precision: 2 },
      { key: 'phi', label: 'φ',  unit: '%',  precision: 1 },
      { key: 'P',   label: 'P',  unit: 'Па', precision: 0 },
      { key: 'tm',  label: 't<sub>м</sub>', unit: '°C', precision: 2 },
    ],
    solve: k => {
      const P = ('P' in k) ? k.P : 101325;
      if ('t' in k && 'phi' in k) return { P, tm: wetBulb(k.t, k.phi / 100, P) };
      return { P };
    },
  });
}

/* =========================================================
   Экспорт: готовая функция mount в контейнер.
   ========================================================= */
export function mountPsyCalculators(container) {
  const cards = [
    cardTemperature(),
    cardBarometric(),
    cardAirDensity(),
    cardSaturationPressure(),
    cardPartialPressure(),
    cardHumidityRatio(),
    cardDewPoint(),
    cardWetBulb(),
    cardFullState(),
    cardProcessPower(),
    cardMoistureLoad(),
    cardNormalVolume(),
  ];
  mountCalcGroup(container, cards);
  return cards;
}
