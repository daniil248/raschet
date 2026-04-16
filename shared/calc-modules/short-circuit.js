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

function getK(material, insulation) {
  const m = K_TABLE[material] || K_TABLE.Cu;
  return m[insulation] || m.PVC;
}

export const shortCircuitModule = {
  id: 'shortCircuit',
  label: 'Термическая стойкость к току КЗ',
  description: 'IEC 60364-4-43 §434.5 — проверка S ≥ I_k · √t_k / k. k = 115 (Cu/ПВХ), 143 (Cu/XLPE), 76 (Al/ПВХ), 94 (Al/XLPE).',
  mandatory: true,
  order: 40,
  calc(input) {
    const Ik = Number(input.IkA) || 0;
    const tk = Number(input.tkS) || 0;
    if (Ik <= 0 || tk <= 0) {
      return {
        pass: true,
        details: { skipped: true, reason: 'I_k или t_k не заданы' },
        warnings: [],
      };
    }
    const k = getK(input.material || 'Cu', input.insulation || 'PVC');
    const sRequired = (Ik * Math.sqrt(tk)) / k;
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
        tkS: tk,
        k,
        sRequired: Math.round(sRequired * 10) / 10,
        sCurrent,
        material: input.material,
        insulation: input.insulation,
      },
      warnings: pass
        ? []
        : [`S_min по КЗ = ${sRequired.toFixed(1)} мм² (I_k=${Math.round(Ik)} А, t_k=${tk} с, k=${k}). Текущее ${sCurrent} мм² недостаточно.`],
    };
  },
};
