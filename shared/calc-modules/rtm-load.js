// shared/calc-modules/rtm-load.js
// v0.59.653: Расчёт электрических нагрузок по РТМ 36.18.32.4-92
// (метод упорядоченных диаграмм Г.М. Каялова).
//
// Назначение: для группы электроприёмников вычислить расчётную
// (получасовую максимальную) активную нагрузку P_расч с учётом
// коэффициентов использования (Ки) и максимума (Кмакс).
//
// Юзер: «для расчёта по РТМ прими автоматическое применение коэффициентов
// использования и одновременности. По факту нужны расчёты максимума для
// прохождения сертификации Uptime Institute и расчёты для получения ТУ».
//
// Алгоритм (РТМ 36.18.32.4-92, п. 1.4):
//   1. Σ P_ном — суммарная номинальная мощность всех ЭП группы
//   2. n_э — эффективное число ЭП = (Σ P_ном)² / Σ (P_ном²)
//      (фиктивное число одинаковых ЭП с равной мощностью, дающих ту же
//       сумму квадратов, что и реальная группа)
//   3. Ки.ср — средневзвешенный Ки = Σ (Ки_i × P_ном_i) / Σ P_ном
//   4. Кмакс — коэффициент максимума, выбирается по таблице (n_э, Ки.ср)
//   5. P_ср = Σ Ки_i × P_ном_i — средняя нагрузка за наиболее загруженную смену
//   6. P_макс = Кмакс × P_ср — расчётная (получасовая максимальная) нагрузка
//
// При n_э > 200 или Ки.ср > 0.8 принимается Кмакс = 1.0 (нагрузка
// уже усреднена, дальнейшее усиление не происходит).
//
// Реактивная мощность Q_макс рассчитывается по реактивному коэф. максимума
// (Кмакс') = 1.0 если n_э > 10, иначе 1.1. Q_ср = Σ tan(φ_i) × Ки_i × P_ном_i.

// Таблица Кмакс из РТМ 36.18.32.4-92 (приложение 2).
// Строки — диапазоны n_э, столбцы — диапазоны Ки.ср.
// Ki: 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8
const KMAX_TABLE = [
  // n_э,   Ки=0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8
  { ne:   2, k: [3.43, 3.11, 2.64, 2.14, 1.87, 1.65, 1.46, 1.29, 1.14] },
  { ne:   3, k: [3.23, 2.87, 2.42, 1.97, 1.71, 1.51, 1.37, 1.22, 1.10] },
  { ne:   4, k: [3.04, 2.64, 2.24, 1.83, 1.62, 1.43, 1.30, 1.17, 1.08] },
  { ne:   5, k: [2.88, 2.48, 2.10, 1.74, 1.54, 1.37, 1.25, 1.14, 1.07] },
  { ne:   6, k: [2.72, 2.31, 1.99, 1.66, 1.47, 1.32, 1.22, 1.12, 1.06] },
  { ne:   7, k: [2.56, 2.20, 1.90, 1.60, 1.42, 1.28, 1.20, 1.10, 1.05] },
  { ne:   8, k: [2.42, 2.10, 1.84, 1.55, 1.38, 1.25, 1.18, 1.09, 1.05] },
  { ne:  10, k: [2.24, 1.96, 1.72, 1.46, 1.32, 1.20, 1.14, 1.07, 1.04] },
  { ne:  15, k: [1.97, 1.74, 1.55, 1.34, 1.22, 1.13, 1.10, 1.05, 1.03] },
  { ne:  20, k: [1.79, 1.60, 1.43, 1.26, 1.17, 1.11, 1.08, 1.04, 1.02] },
  { ne:  25, k: [1.65, 1.49, 1.34, 1.20, 1.14, 1.10, 1.07, 1.03, 1.02] },
  { ne:  30, k: [1.55, 1.41, 1.28, 1.17, 1.12, 1.09, 1.06, 1.03, 1.01] },
  { ne:  40, k: [1.40, 1.31, 1.21, 1.14, 1.10, 1.07, 1.05, 1.02, 1.01] },
  { ne:  50, k: [1.30, 1.23, 1.16, 1.11, 1.08, 1.06, 1.04, 1.02, 1.01] },
  { ne:  70, k: [1.20, 1.16, 1.11, 1.08, 1.06, 1.04, 1.03, 1.01, 1.00] },
  { ne: 100, k: [1.13, 1.10, 1.08, 1.06, 1.04, 1.03, 1.02, 1.01, 1.00] },
  { ne: 200, k: [1.05, 1.04, 1.03, 1.02, 1.02, 1.01, 1.01, 1.00, 1.00] },
];
const KU_BUCKETS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

// Lookup Кмакс по таблице (n_э, Ки.ср). Использует ближайшую строку
// (по nearest или по большему nе для запаса), и линейную интерполяцию
// между Ku-bucket'ами.
export function lookupKmax(ne, kuAvg) {
  if (!Number.isFinite(ne) || ne <= 1) return 1.0;
  if (!Number.isFinite(kuAvg) || kuAvg <= 0) return 1.0;
  // Большие n_э → насыщение Кмакс к 1.0
  if (ne >= 200) return 1.0;
  if (kuAvg >= 0.8) return 1.0;
  // Берём ближайшую (или большую) строку n_э
  let row = KMAX_TABLE[0];
  for (const r of KMAX_TABLE) {
    if (r.ne <= ne) row = r;
    else break;
  }
  // Линейная интерполяция между ku-bucket'ами
  const k = row.k;
  if (kuAvg <= KU_BUCKETS[0]) return k[0];
  if (kuAvg >= KU_BUCKETS[KU_BUCKETS.length - 1]) return k[k.length - 1];
  for (let i = 0; i < KU_BUCKETS.length - 1; i++) {
    const a = KU_BUCKETS[i], b = KU_BUCKETS[i + 1];
    if (kuAvg >= a && kuAvg <= b) {
      const t = (kuAvg - a) / (b - a);
      return k[i] + (k[i + 1] - k[i]) * t;
    }
  }
  return 1.0;
}

// Эффективное число ЭП по формуле n_э = (Σ P_ном)² / Σ (P_ном²)
export function effectiveCount(consumers) {
  let sumP = 0, sumP2 = 0;
  for (const c of consumers) {
    const p = Number(c.Pnom) || 0;
    if (p <= 0) continue;
    sumP += p;
    sumP2 += p * p;
  }
  if (sumP2 <= 0) return 0;
  return (sumP * sumP) / sumP2;
}

// Главный helper: дано — массив ЭП с {Pnom, Ku, cosPhi}.
// Возвращает { Pmax, Pavg, Qmax, Qavg, Smax, ne, kuAvg, Kmax, KmaxQ, count, PnomSum, QnomSum, SnomSum }.
//
// Для смешанной группы (разные Ки) РТМ предписывает считать кучами по
// одинаковым Ки или использовать средневзвешенный Ки. Здесь — упрощённо
// средневзвешенный (РТМ §1.4.4).
export function rtmComputeMax(consumers) {
  if (!Array.isArray(consumers) || consumers.length === 0) {
    return { Pmax: 0, Pavg: 0, Qmax: 0, Qavg: 0, Smax: 0, ne: 0, kuAvg: 0, Kmax: 1, KmaxQ: 1, count: 0, PnomSum: 0, QnomSum: 0, SnomSum: 0 };
  }
  let sumP = 0, sumQnom = 0, sumKuP = 0, sumQavg = 0, sumP2 = 0;
  let count = 0;
  for (const c of consumers) {
    const p = Number(c.Pnom) || 0;
    const ku = Math.max(0, Math.min(1, Number(c.Ku) || 0));
    const cos = Math.max(0.1, Math.min(1, Number(c.cosPhi) || 0.92));
    if (p <= 0) continue;
    const tan = Math.sqrt(Math.max(0, 1 - cos * cos)) / cos;
    sumP += p;
    sumP2 += p * p;
    sumQnom += tan * p;       // v0.59.654: реактивная номинальная (без Ки)
    sumKuP += ku * p;
    sumQavg += tan * ku * p;
    count++;
  }
  if (sumP <= 0) {
    return { Pmax: 0, Pavg: 0, Qmax: 0, Qavg: 0, Smax: 0, ne: 0, kuAvg: 0, Kmax: 1, KmaxQ: 1, count, PnomSum: 0, QnomSum: 0, SnomSum: 0 };
  }
  const ne = sumP2 > 0 ? (sumP * sumP) / sumP2 : 0;
  const kuAvg = sumKuP / sumP;
  const Pavg = sumKuP;
  const Qavg = sumQavg;
  const Kmax = lookupKmax(ne, kuAvg);
  // Реактивный коэф. максимума: Кмакс' = 1.1 при n_э ≤ 10, иначе 1.0
  const KmaxQ = ne <= 10 ? 1.1 : 1.0;
  const Pmax = Kmax * Pavg;
  const Qmax = KmaxQ * Qavg;
  const Smax = Math.sqrt(Pmax * Pmax + Qmax * Qmax);
  // v0.59.654: суммарные номинальные значения (без Ки/Кмакс) — для отображения
  // «номинальной нагрузки» панели/щита (юзер: «номинальная мощность щита
  // должна считаться по номинальной нагрузке, а не по шинам»).
  const PnomSum = sumP;
  const QnomSum = sumQnom;
  const SnomSum = Math.sqrt(PnomSum * PnomSum + QnomSum * QnomSum);
  return { Pmax, Pavg, Qmax, Qavg, Smax, ne, kuAvg, Kmax, KmaxQ, count, PnomSum, QnomSum, SnomSum };
}
