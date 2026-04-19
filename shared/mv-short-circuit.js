// ======================================================================
// shared/mv-short-circuit.js
// Расчёт токов короткого замыкания на среднем напряжении по IEC 60909.
//
// Стандарт IEC 60909-0 описывает расчёт токов КЗ в трёхфазных
// переменнотоковых системах. Для MV сетей (6-35 кВ) используются:
//
//   I_k3 — трёхфазный начальный симметричный ток КЗ
//   I_k2 — двухфазный, обычно ≈ 0.866 × I_k3
//   I_k1 — однофазный (только для заземлённой нейтрали, в MV сетях РФ
//          изолированная — этот ток пренебрежимо мал)
//   i_p  — ударный ток (peak), i_p = κ × √2 × I_k3 где κ = 1.02...1.8
//
// Базовая формула:
//   I_k3 = c × U_n / (√3 × Z_k)
// где c — voltage factor:
//   c_max = 1.1   (для расчёта максимальных токов — выбор автоматов)
//   c_min = 0.95  (для расчёта минимальных — проверка чувствительности защит)
//
// Импедансы в секвенции:
//
// 1) Сеть (utility, HV side) — по S_sc (SCC, short-circuit capacity, МВА):
//    Z_Q = c × U_n² / S_sc
//    Можно также задавать через I_k3_sys: Z_Q = c × U_n / (√3 × I_k3_sys)
//
// 2) Трансформатор (пересчёт через коэффициент трансформации):
//    Z_T = u_k% × U_rLV² / S_rT / 100
//    с разделением на R_T, X_T:
//       R_T = u_R% × U_rLV² / S_rT / 100   (u_R ≈ P_k / S_rT × 100)
//       X_T = √(Z_T² − R_T²)
//
// 3) Кабель MV: R_cable, X_cable из погонных параметров × длина
//    Типовые значения для 3×50 мм² Cu: R₀=0.387 Ом/км, X₀=0.12 Ом/км
//
// 4) Генератор (субпереходный режим):
//    Z_G = X_d'' × U_rG² / S_rG
//    Обычно X_d'' = 0.1...0.2 о.е.
//
// Суммирование: Z_k = Σ (R_i + jX_i), по модулю √(R_sum² + X_sum²)
//
// Для ВПРАВО/ВЛЕВО ссылочных задач (расчёт на разных ступенях):
// Z пересчитывается через коэффициент трансформации: Z' = Z × (U1/U2)²
// ======================================================================

/**
 * Voltage factors по IEC 60909-0 Table 1.
 * Для максимальных токов: c_max.
 * Для минимальных: c_min.
 *
 * Rating voltage < 1 kV (LV): c_max=1.05, c_min=0.95
 * Rating voltage 1-35 kV:     c_max=1.10, c_min=1.00
 * Rating voltage >35 kV:      c_max=1.10, c_min=1.00
 */
export const C_FACTORS = {
  lv: { max: 1.05, min: 0.95 },
  mv: { max: 1.10, min: 1.00 },
  hv: { max: 1.10, min: 1.00 },
};

/**
 * Импеданс сети (utility) по мощности КЗ.
 *
 * @param {number} U_kV — напряжение в точке подключения, кВ
 * @param {number} S_sc_MVA — мощность КЗ сети (Short-Circuit Capacity), МВА
 * @param {number} c — voltage factor (default 1.1)
 * @param {number} xToRRatio — X/R отношение (default 10 для MV ВЛЭП)
 * @returns {{ R_ohm, X_ohm, Z_ohm }}
 */
export function impedanceUtility(U_kV, S_sc_MVA, c = 1.1, xToRRatio = 10) {
  const Un = Number(U_kV) * 1000;
  const Ssc = Number(S_sc_MVA) * 1e6;
  if (Ssc <= 0 || Un <= 0) return { R_ohm: 0, X_ohm: 0, Z_ohm: 0 };
  const Z = (c * Un * Un) / Ssc;
  // X/R: X >> R → X ≈ Z, R ≈ Z × sin(atan(1/X_R))
  const sin = xToRRatio / Math.sqrt(1 + xToRRatio * xToRRatio);
  const cos = 1 / Math.sqrt(1 + xToRRatio * xToRRatio);
  return { R_ohm: Z * cos, X_ohm: Z * sin, Z_ohm: Z };
}

/**
 * Импеданс сети через заданный I_k3 на вторичке.
 *
 * @param {number} U_kV — напряжение, кВ
 * @param {number} I_k3_kA — заданный ток КЗ, кА
 * @param {number} c — voltage factor
 * @param {number} xToRRatio
 * @returns {{ R_ohm, X_ohm, Z_ohm }}
 */
export function impedanceFromIk(U_kV, I_k3_kA, c = 1.1, xToRRatio = 10) {
  const Un = Number(U_kV) * 1000;
  const Ik = Number(I_k3_kA) * 1000;
  if (Ik <= 0 || Un <= 0) return { R_ohm: 0, X_ohm: 0, Z_ohm: 0 };
  const Z = (c * Un) / (Math.sqrt(3) * Ik);
  const sin = xToRRatio / Math.sqrt(1 + xToRRatio * xToRRatio);
  const cos = 1 / Math.sqrt(1 + xToRRatio * xToRRatio);
  return { R_ohm: Z * cos, X_ohm: Z * sin, Z_ohm: Z };
}

/**
 * Импеданс трансформатора (по вторичной стороне).
 *
 * @param {number} U_LV_V — номинальное напряжение вторички, В
 * @param {number} S_rT_kVA — номинальная мощность, кВА
 * @param {number} u_k_percent — напряжение КЗ u_k, % (обычно 4-8% для LV TP, 8-12% для MV-MV)
 * @param {number} p_k_kW — потери КЗ, кВт (опционально для R)
 * @returns {{ R_ohm, X_ohm, Z_ohm }}
 */
export function impedanceTransformer(U_LV_V, S_rT_kVA, u_k_percent, p_k_kW = 0) {
  const U = Number(U_LV_V);
  const Sn = Number(S_rT_kVA) * 1000;
  const uk = Number(u_k_percent) / 100;
  if (Sn <= 0 || U <= 0 || uk <= 0) return { R_ohm: 0, X_ohm: 0, Z_ohm: 0 };
  const Z = uk * U * U / Sn;
  let R;
  if (p_k_kW > 0) {
    // R = P_k / (3 × I_n²) = P_k × U² / (3 × (U × I_n)²) = P_k × U² / S_n²... упрощение
    // IEC 60909: R_T = (P_k × U²) / S_rT² при S_rT в ВА
    R = (Number(p_k_kW) * 1000 * U * U) / (Sn * Sn);
  } else {
    // Если P_k не задан — типовое R/X ≈ 0.05...0.1 для маленьких ТП, 0.02...0.05 для больших
    const RoverX = S_rT_kVA <= 400 ? 0.1 : (S_rT_kVA <= 1600 ? 0.05 : 0.03);
    R = Z * RoverX / Math.sqrt(1 + RoverX * RoverX);
  }
  const X = Math.sqrt(Math.max(0, Z * Z - R * R));
  return { R_ohm: R, X_ohm: X, Z_ohm: Z };
}

/**
 * Импеданс MV-кабеля.
 * Типовые погонные параметры для Cu кабелей с бумажной/XLPE изоляцией
 * сечением 50-240 мм²:
 *   R₀ ≈ 0.39...0.075 Ом/км (зависит от S)
 *   X₀ ≈ 0.12...0.10 Ом/км (для 3-жильных)
 *
 * @param {number} S_mm2 — сечение жилы, мм²
 * @param {number} length_m — длина, м
 * @param {string} material — 'Cu' | 'Al'
 * @returns {{ R_ohm, X_ohm, Z_ohm }}
 */
export function impedanceMvCable(S_mm2, length_m, material = 'Cu') {
  const S = Number(S_mm2) || 0;
  const L = Number(length_m) || 0;
  if (S <= 0 || L <= 0) return { R_ohm: 0, X_ohm: 0, Z_ohm: 0 };
  // Удельное сопротивление при +20 °C
  const rho = material === 'Al' ? 0.0287 : 0.0175; // Ом·мм²/м
  const R0 = rho / S * 1000; // Ом/км
  // Реактивное сопротивление MV-кабелей (типовое)
  const X0 = S <= 50 ? 0.12 : (S <= 150 ? 0.11 : 0.10); // Ом/км
  const R = R0 * (L / 1000);
  const X = X0 * (L / 1000);
  return { R_ohm: R, X_ohm: X, Z_ohm: Math.sqrt(R * R + X * X) };
}

/**
 * Импеданс генератора (субпереходный режим).
 *
 * @param {number} U_kV — напряжение на клеммах генератора, кВ
 * @param {number} S_rG_kVA — номинальная мощность генератора, кВА
 * @param {number} xd_pp — Xd'' в о.е. (subtransient, default 0.15)
 * @returns {{ R_ohm, X_ohm, Z_ohm }}
 */
export function impedanceGenerator(U_kV, S_rG_kVA, xd_pp = 0.15) {
  const U = Number(U_kV) * 1000;
  const Sn = Number(S_rG_kVA) * 1000;
  const xdpp = Number(xd_pp);
  if (Sn <= 0 || U <= 0 || xdpp <= 0) return { R_ohm: 0, X_ohm: 0, Z_ohm: 0 };
  // Z_G = Xd'' × U² / S_n
  const X = xdpp * U * U / Sn;
  // R_G ≈ 0.05 × X для мощных машин, 0.07...0.15 для малых
  const R = X * (S_rG_kVA <= 500 ? 0.15 : 0.07);
  return { R_ohm: R, X_ohm: X, Z_ohm: Math.sqrt(R * R + X * X) };
}

/**
 * Сложение последовательных импедансов.
 * @param {Array<{R_ohm, X_ohm}>} list
 */
export function sumSeries(list) {
  let R = 0, X = 0;
  for (const z of list) { R += Number(z.R_ohm) || 0; X += Number(z.X_ohm) || 0; }
  return { R_ohm: R, X_ohm: X, Z_ohm: Math.sqrt(R * R + X * X) };
}

/**
 * Расчёт тока I_k3 в точке подключения.
 *
 * @param {number} U_kV — напряжение в точке, кВ
 * @param {{ R_ohm, X_ohm }} Z_k — суммарный импеданс до точки
 * @param {number} c — voltage factor (1.1 для max)
 * @returns {{ I_k3_kA, I_p_kA, I_k2_kA }}
 */
export function calcIk3(U_kV, Z_k, c = 1.1) {
  const Un = Number(U_kV) * 1000;
  const Z = Z_k.Z_ohm ?? Math.sqrt((Z_k.R_ohm ?? 0) ** 2 + (Z_k.X_ohm ?? 0) ** 2);
  if (Z <= 0 || Un <= 0) return { I_k3_kA: 0, I_p_kA: 0, I_k2_kA: 0 };
  const I_k3 = (c * Un) / (Math.sqrt(3) * Z) / 1000;
  // Ударный ток: i_p = κ × √2 × I_k3 где κ зависит от X/R
  const R = Z_k.R_ohm || 1e-6;
  const X = Z_k.X_ohm || 0;
  const XR = X / R;
  const kappa = 1.02 + 0.98 * Math.exp(-3 / Math.max(0.1, XR));
  const I_p = kappa * Math.sqrt(2) * I_k3;
  const I_k2 = 0.866 * I_k3; // √3/2
  return { I_k3_kA: I_k3, I_p_kA: I_p, I_k2_kA: I_k2, kappa };
}

/**
 * Высокоуровневая функция: для конкретной MV-ветки проекта (node в схеме)
 * собирает импедансы от источника до точки, возвращает I_k.
 *
 * @param {Object} context
 *   context.U_kV — напряжение в точке (MV шина)
 *   context.components — массив импедансов от source до точки
 *     [{ kind: 'utility'|'transformer'|'cable'|'generator', R_ohm, X_ohm }]
 *   context.cMode — 'max' (default) | 'min'
 * @returns {{ I_k3_kA, I_p_kA, I_k2_kA, Z_k }}
 */
export function calcAtPoint(context) {
  const Z = sumSeries(context.components || []);
  const c = (context.cMode === 'min') ? 1.0 : 1.1;
  const ik = calcIk3(context.U_kV, Z, c);
  return { ...ik, Z_k: Z };
}
