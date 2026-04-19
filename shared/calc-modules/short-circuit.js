// ======================================================================
// shared/calc-modules/short-circuit.js
// Обязательный модуль: термическая стойкость кабеля к току КЗ
// (IEC 60364-4-43 §434.5, ПУЭ 1.4.6).
//
// Проверка: I_k × √t_k ≤ k × S  →  S ≥ I_k × √t_k / k
// где:
//   I_k — действующее значение тока КЗ, А
//   t_k — время отключения автомата при КЗ, с (обычно 0.1…5 с)
//   k   — константа материала и изоляции, А·с^0.5 / мм²
//         (медь + XLPE: 143, медь + ПВХ: 115, алюминий + XLPE: 94,
//          алюминий + ПВХ: 76 — IEC 60364-4-43 Tab A54.2/A54.3)
//   S   — сечение кабеля, мм²
//
// Модуль mandatory: термическая проверка кабеля на КЗ требуется
// ПУЭ и IEC всегда. Если I_k не задан — модуль возвращает pass:true
// со скип-предупреждением.
// ======================================================================

// Константа k [A·√с/мм²] по IEC 60364-4-43 Table A54.2/A54.3.
// Для защитных проводников — по Table 54.2 (чуть ниже), но здесь
// расчёт для фазных жил.
const K_TABLE = {
  Cu: { PVC: 115, XLPE: 143 },
  Al: { PVC:  76, XLPE:  94 },
};

// Импорт let-through данных MCB (Фаза 1.18)
import { letThroughI2t } from '../tcc-curves.js';

function getK(material, insulation) {
  const m = K_TABLE[material] || K_TABLE.Cu;
  return m[insulation] || m.PVC;
}

// Оценка времени отключения автомата по кратности Ik/In и типу кривой.
// При кратности выше магнитного порога — мгновенное срабатывание (~5-10 мс).
// Ниже магнитного порога — тепловой расцепитель (до 0.1-1 с).
// IEC 60898-1: B → 3-5×In, C → 5-10×In, D → 10-20×In
const MAG_THRESHOLD = {
  MCB_B: 5, MCB_C: 10, MCB_D: 20,
  MCCB: 10, ACB: 10, gG: 10,
};
function estimateTripTime(Ik, In, curve) {
  if (Ik <= 0 || In <= 0) return 0.1;
  const ratio = Ik / In;
  const magThresh = MAG_THRESHOLD[curve] || 10;
  // Глубокая мгновенная зона (ratio > 2 × magThresh) — токоограничивающее
  // действие MCB, полупериод 50Гц = 10 мс, но с let-through эффективное
  // время по энергии I²t ещё меньше (0.005 с — типичное значение для
  // MCB класса 3 по IEC 60898-1 при I_k ≥ Icu).
  if (ratio >= magThresh * 2) {
    return (curve === 'MCCB' || curve === 'ACB') ? 0.02 : 0.005;
  }
  if (ratio >= magThresh) {
    // Обычная мгновенная зона: 5-10 мс для MCB, 20-50 мс для MCCB
    return (curve === 'MCCB' || curve === 'ACB') ? 0.03 : 0.01;
  }
  // Тепловой расцепитель: приблизительно t ∝ 1/(ratio²)
  // При ratio=2 → ~30с, ratio=5 → ~5с, ratio=8 → ~1с
  return Math.min(5, Math.max(0.1, 100 / (ratio * ratio)));
}

export const shortCircuitModule = {
  id: 'shortCircuit',
  label: 'Термическая стойкость к току КЗ',
  description: 'Термическая стойкость: S ≥ Ik·√tk / k. По IEC 60364-4-43 / ПУЭ 1.4.6. tk рассчитывается по кривой автомата.',
  mandatory: true,
  order: 40,
  calc(input) {
    const Ik = Number(input.IkA) || 0;
    if (Ik <= 0) {
      return {
        pass: true,
        details: { skipped: true, reason: 'I_k не задан' },
        warnings: [],
      };
    }
    // tk: берём МИНИМУМ из заданного пользователем и рассчитанного по
    // кривой автомата. Физически кабель не может греться дольше, чем
    // работает защитный автомат. Если пользователь задал большее tk
    // (для селективности upstream) — оно игнорируется здесь: кабель
    // защищён данным автоматом, и кривая этого автомата — верхняя
    // граница времени нагрева.
    //
    // Раньше был баг: использовали tkUser без проверки, что приводило
    // к завышению сечения для быстрых MCB (B/C/D в глубокой мгновенной
    // зоне, где автомат отключает за 5-10 мс, но пользователь задал
    // 0.05-0.15 с «с запасом»).
    const In = Number(input.breakerIn) || 0;
    const curve = input.breakerCurve || 'MCB_C';
    const tkUser = Number(input.tkS) || 0;
    const tkAuto = estimateTripTime(Ik, In, curve);
    let tk, tkSource;
    if (tkUser > 0) {
      if (tkUser < tkAuto) {
        // Пользователь задал меньше — верим ему (например upstream быстрее)
        tk = tkUser; tkSource = 'user';
      } else {
        // Пользователь задал больше — используем реальное по кривой
        tk = tkAuto; tkSource = 'auto-clamped';
      }
    } else {
      tk = tkAuto; tkSource = 'auto';
    }
    const k = getK(input.material || 'Cu', input.insulation || 'PVC');

    // Фаза 1.18: для MCB в глубокой мгн. зоне используем let-through I²t
    // автомата (паспорт производителя класс 3 по IEC 60898-1) вместо
    // упрощённой формулы I_k² × t. Это физически корректнее — реальный
    // ток, проходящий через кабель, ограничен токоограничивающим
    // действием автомата.
    //   S_min = √(I²t_let_through) / k
    //
    // Условие применения: curve ∈ B/C/D/K/Z И ratio ≥ magThresh (мгн. зона).
    // Для MCCB/ACB данные паспорта индивидуальны — пока стандартная формула.
    let sRequired;
    let letThroughUsed = false;
    let letThroughValue = null;
    const ratio = In > 0 ? Ik / In : 0;
    const magThreshForCheck = MAG_THRESHOLD[curve] || 10;
    // Выделяем краткое имя curve (MCB_B → B) для letThroughI2t
    const curveShort = /^MCB_([BCDKZ])$/.exec(curve)?.[1];
    if (curveShort && ratio >= magThreshForCheck) {
      // Класс токоограничения MCB (1/2/3) — из input.breakerLimitClass или по
      // умолчанию 3 (современные). Устаревшие MCB без токоограничения → 1.
      const limitClass = Number(input.breakerLimitClass) || 3;
      const I2t = letThroughI2t(In, curveShort, Ik, limitClass);
      if (I2t != null && I2t > 0) {
        letThroughValue = I2t;
        sRequired = Math.sqrt(I2t) / k;
        letThroughUsed = true;
      }
    }
    if (!letThroughUsed) {
      sRequired = (Ik * Math.sqrt(tk)) / k;
    }

    const sCurrent = Number(input.currentSize) || 0;
    const pass = sCurrent > 0 && sCurrent >= sRequired;
    // Ищем ближайший стандартный размер сверху (простая логика —
    // runner всё равно возьмёт max через bump)
    const standardSizes = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];
    let bump = null;
    if (!pass) {
      for (const s of standardSizes) {
        if (s >= sRequired) { bump = s; break; }
      }
    }
    return {
      pass,
      bump,
      details: {
        IkA: Math.round(Ik),
        tkS: Math.round(tk * 1000) / 1000,
        tkSource,          // 'user' | 'auto' | 'auto-clamped'
        tkUser: tkUser > 0 ? tkUser : null,
        tkAuto: Math.round(tkAuto * 1000) / 1000,
        k,
        sRequired: Math.round(sRequired * 10) / 10,
        sCurrent,
        material: input.material,
        insulation: input.insulation,
        breakerIn: In,
        breakerCurve: curve,
        // Фаза 1.18: let-through информация
        letThroughUsed,
        letThroughI2t: letThroughValue ? Math.round(letThroughValue) : null,
        calcMode: letThroughUsed ? 'let-through (IEC 60898-1 class 3)' : 'I_k² × t_k',
      },
      warnings: pass
        ? []
        : [letThroughUsed
            ? `S_min по КЗ = ${sRequired.toFixed(1)} мм² (let-through I²t=${Math.round(letThroughValue)} А²·с для ${curve} ${In}А, k=${k}). Текущее ${sCurrent} мм² недостаточно.`
            : `S_min по КЗ = ${sRequired.toFixed(1)} мм² (I_k=${Math.round(Ik)} А, t_k=${(Math.round(tk * 1000) / 1000)} с${tkSource === 'auto' ? ' авто' : (tkSource === 'auto-clamped' ? ' ограничено по кривой автомата' : '')}, k=${k}). Текущее ${sCurrent} мм² недостаточно.`
          ],
    };
  },
};
