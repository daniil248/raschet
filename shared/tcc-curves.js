// ======================================================================
// shared/tcc-curves.js
// Время-токовые характеристики (TCC) автоматов защиты и проводников.
//
// Логика:
//   Для MCB с типовыми характеристиками (B / C / D / K / Z) используются
//   упрощённые кусочные функции, воспроизводящие IEC 60898-1 / IEC 60947-2:
//
//   - Тепловой расцепитель (долгий участок): thermally inverse, t = f(I²)
//     Выражение: t = A / (I/In)^2 - B, ограничение сверху 10000 с
//   - Зона неопределённости (1.13...1.45 × In для MCB):
//     меняется медленно, от 1 ч (@ 1.13) до 1 мин (@ 1.45)
//   - Магнитный (мгновенный) расцепитель:
//     B  : 3...5    × In     → 10-30 мс
//     C  : 5...10   × In     → 10-30 мс
//     D  : 10...20  × In     → 10-30 мс
//     K  : 8...14   × In     → 10-30 мс
//     Z  : 2...3    × In     → 10-30 мс
//
//   Для плавких предохранителей gG используется аппроксимация IEC 60269.
//
//   Для проводника — тепловая стойкость IEC 60364-4-43:
//     t = k² × S² / I² — граница, дольше которой проводник не выдержит.
//
// API:
//   tccBreakerTime(I_per_In, curve) → { t_sec, branch }
//   tccCableThermalLimit(I_A, S_mm2, k) → t_sec
//   tccFuseTime(I_per_In, 'gG' | 'gM' | 'aM') → t_sec
//   tccSamplePoints(kind, opts) → [{ i_per_In, t_sec }]  — для графика
// ======================================================================

/**
 * Константы магнитных расцепителей (IEC 60898-1 для MCB).
 * minMul = нижняя граница срабатывания, maxMul = верхняя.
 */
const MAGNETIC_BOUNDS = {
  B: { min: 3, max: 5 },
  C: { min: 5, max: 10 },
  D: { min: 10, max: 20 },
  K: { min: 8, max: 14 },
  Z: { min: 2, max: 3 },
};

/**
 * Let-through energy I²t для MCB по IEC 60898-1.
 *
 * MCB делятся на 3 класса по токоограничению:
 *   class 1 — не токоограничивающие (устаревшие, LSF1)
 *   class 2 — среднее токоограничение
 *   class 3 — высокое токоограничение (современные, ABB S200, Schneider iC60)
 *
 * При КЗ в мгновенной зоне автомат обрывает ток за 3-5 мс (class 3)
 * или за 10-20 мс (class 1). Фактическая тепловая энергия, пропускаемая
 * через кабель, меньше расчётной I_k² × t_mcb_time — это позволяет
 * применять меньшие сечения.
 *
 * Данные — верхняя граница (с запасом) из паспортов производителей.
 *
 * Для class 3 значения — типовые из ABB S200 / Schneider iC60 / Legrand DX3.
 * Для class 2 — примерно в 2× выше.
 * Для class 1 — примерно в 4× выше (кабель нужен больше).
 */
const MCB_LETTHROUGH_I2T_CLASS3 = {
  6:   3000,
  10:  5000,
  16:  8000,
  20: 10000,
  25: 13000,
  32: 18000,
  40: 25000,
  50: 35000,
  63: 50000,
};
// Коэффициенты масштабирования относительно class 3
const MCB_CLASS_FACTORS = {
  1: 4.0,  // не ограничивает — let-through ≈ I_k² × t_reaction
  2: 2.0,  // среднее ограничение
  3: 1.0,  // современное высокое (по умолчанию)
};
// Legacy — для обратной совместимости с кодом, ожидающим исходный экспорт
const MCB_LETTHROUGH_I2T = MCB_LETTHROUGH_I2T_CLASS3;

/**
 * Вернуть let-through I²t для MCB с учётом номинала, класса и фактического I_k.
 * Если автомат не MCB (curve не B/C/D/K/Z) — возвращает null (нет данных,
 * использовать стандартную формулу I² × t).
 *
 * @param {number} In  — номинал автомата, A
 * @param {string} curve — 'B' | 'C' | 'D' | 'K' | 'Z' | 'MCCB' | 'ACB' | 'gG'
 * @param {number} Ik  — ток КЗ, A
 * @param {number} [limitClass=3] — класс токоограничения MCB (1/2/3).
 *                      По умолчанию 3 (современные токоограничивающие).
 *                      Для устаревших MCB без токоограничения — 1.
 * @returns {number|null} I²t в A²·s, либо null если данные недоступны
 */
export function letThroughI2t(In, curve, Ik, limitClass = 3) {
  if (!curve || !['B', 'C', 'D', 'K', 'Z'].includes(curve)) return null;
  const factor = MCB_CLASS_FACTORS[limitClass] || 1.0;
  const keys = Object.keys(MCB_LETTHROUGH_I2T_CLASS3).map(Number).sort((a, b) => a - b);
  let chosen = keys[keys.length - 1];
  for (const k of keys) if (k >= In) { chosen = k; break; }
  const base = MCB_LETTHROUGH_I2T_CLASS3[chosen] * factor;
  // Пропорциональное снижение при I_k << I_cu (типичный I_cu = 6 кА)
  const Icu_typical = 6000;
  if (Ik && Ik < Icu_typical) {
    const k = Math.max(0.1, Ik / Icu_typical);
    return base * k * k;
  }
  return base;
}

/**
 * Время срабатывания автомата при токе I = k × In.
 * Возвращает { t_sec, branch } где branch: 'thermal' | 'magnetic' | 'instant' | 'safe'.
 *
 * Упрощённая модель:
 *   I/In < 1.13         → не срабатывает (t = Infinity, safe)
 *   1.13 ≤ I/In < 1.45  → тепловой, зона неопределённости, 60-3600 с
 *   1.45 ≤ I/In < magMin → тепловой инверсный, t = 80 / (I/In)^2
 *   magMin ≤ I/In < magMax → магнитный (нижняя полоса), 0.02-0.1 с
 *   I/In ≥ magMax       → мгновенное, 0.01 с
 */
export function tccBreakerTime(I_per_In, curve = 'C') {
  const k = Number(I_per_In);
  if (!Number.isFinite(k) || k <= 0) return { t_sec: Infinity, branch: 'safe' };
  if (k < 1.13) return { t_sec: Infinity, branch: 'safe' };

  const mag = MAGNETIC_BOUNDS[curve] || MAGNETIC_BOUNDS.C;

  if (k < 1.45) {
    // Зона неопределённости: от 3600 с при 1.13 до 60 с при 1.45 (log-lin)
    const r = (k - 1.13) / (1.45 - 1.13);
    const t = 3600 * Math.exp(-r * Math.log(3600 / 60)); // 3600 → 60
    return { t_sec: t, branch: 'thermal' };
  }

  if (k < mag.min) {
    // Тепловой инверсный: t = A / (k² - 1), A подбирается так, чтобы при
    // k=1.45 было t≈60 с, а при k=magMin — t≈0.5 с (близко к магн. зоне).
    // Формула Thermal-overload (IEC 60947-2 simplified):
    // t = A / (k² - 1), где A — калибровочная константа.
    // При k=1.45: t=60, k²-1=1.1025 → A ≈ 66.15
    // Для consistency прямо считаем:
    const t = 66 / (k * k - 1);
    return { t_sec: Math.max(0.5, t), branch: 'thermal' };
  }

  if (k < mag.max) {
    // Магнитный расцепитель (полоса неопределённости срабатывания):
    // IEC допускает от 0.02 до 0.1 с. Берём среднее 0.03-0.05 с.
    return { t_sec: 0.05, branch: 'magnetic' };
  }

  // Выше maxMul: мгновенное срабатывание, ~10-20 мс
  return { t_sec: 0.01, branch: 'instant' };
}

/**
 * Время, дольше которого проводник с сечением S при токе I будет греться
 * сверх допустимого (IEC 60364-4-43): t = k² × S² / I².
 *
 * k — материал/изоляция:
 *   115 — Cu / PVC
 *   143 — Cu / XLPE
 *   74  — Al / PVC
 *   87  — Al / XLPE
 *   146 — Cu / EPR
 */
export function tccCableThermalLimit(I_A, S_mm2, k = 115) {
  const I = Number(I_A), S = Number(S_mm2);
  if (!Number.isFinite(I) || I <= 0) return Infinity;
  return (k * k * S * S) / (I * I);
}

/**
 * Время срабатывания плавкого предохранителя gG (IEC 60269-2-1).
 * Упрощённая аппроксимация: t = A / (k² - 1), где A подбирается для gG.
 */
export function tccFuseTime(I_per_In, fuseType = 'gG') {
  const k = Number(I_per_In);
  if (!Number.isFinite(k) || k <= 1.25) return Infinity; // gG не срабатывает
  const A = fuseType === 'gG' ? 50 : (fuseType === 'gM' ? 65 : 120); // aM медленнее
  return A / (k * k - 1);
}

/**
 * Сформировать точки кривой для графика (log-log).
 * kind = 'MCB_B' | 'MCB_C' | 'MCB_D' | 'MCB_K' | 'MCB_Z' | 'fuse-gG' | 'cable'
 *
 * Для автомата: I_per_In от 1.01 до 100, ~40 точек.
 * Для кабеля — передайте opts = { I_A_span: [I_min, I_max], S_mm2, k }
 */
export function tccSamplePoints(kind, opts = {}) {
  const points = [];
  if (kind.startsWith('MCB_')) {
    const curve = kind.split('_')[1];
    const xs = _logRange(1.01, 100, 60);
    for (const x of xs) {
      const { t_sec } = tccBreakerTime(x, curve);
      if (Number.isFinite(t_sec)) points.push({ i_per_In: x, t_sec });
    }
  } else if (kind.startsWith('fuse-')) {
    const ftype = kind.split('-')[1] || 'gG';
    const xs = _logRange(1.26, 100, 60);
    for (const x of xs) {
      const t = tccFuseTime(x, ftype);
      if (Number.isFinite(t)) points.push({ i_per_In: x, t_sec: t });
    }
  } else if (kind === 'cable') {
    const { I_A_span = [10, 100000], S_mm2 = 2.5, k = 115 } = opts;
    const xs = _logRange(I_A_span[0], I_A_span[1], 60);
    for (const I_A of xs) {
      const t = tccCableThermalLimit(I_A, S_mm2, k);
      if (Number.isFinite(t)) points.push({ I_A, t_sec: t });
    }
  }
  return points;
}

/** Логарифмический ряд от a до b, n точек. */
function _logRange(a, b, n) {
  const la = Math.log(a), lb = Math.log(b);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.exp(la + (lb - la) * i / (n - 1)));
  }
  return out;
}

/**
 * Проверка селективности между двумя автоматами (upstream и downstream).
 * Возвращает { selective, reason, checks } где checks — детали по каждой
 * из трёх проверок (амплитудная / временная / при I_k).
 *
 * up, down — объекты BreakerElement.kindProps: { curve, inNominal, type, settings? }
 * I_k — максимальный ток КЗ в точке downstream (А)
 */
export function checkSelectivity(up, down, I_k = null) {
  const checks = [];
  // 1. Амплитудная: In_up ≥ k × In_down (коэффициент зависит от типа)
  const coef = down.curve === 'B' ? 2.0 : (down.curve === 'C' ? 1.6 : 1.4);
  const amplitudeOk = Number(up.inNominal) >= coef * Number(down.inNominal);
  checks.push({
    type: 'amplitude',
    ok: amplitudeOk,
    info: `In_up=${up.inNominal} vs ${coef}×In_down=${(coef * down.inNominal).toFixed(1)} А`,
  });

  // 2. При заданном I_k — сравнение времён
  if (I_k != null && Number.isFinite(I_k)) {
    const tUp = tccBreakerTime(I_k / up.inNominal, up.curve).t_sec;
    const tDown = tccBreakerTime(I_k / down.inNominal, down.curve).t_sec;
    const timeOk = tUp > tDown * 1.3; // upstream должен быть значительно медленнее
    checks.push({
      type: 'time-at-Ik',
      ok: timeOk,
      info: `При I_k=${I_k.toFixed(0)}А: t_up=${tUp.toFixed(3)}с > t_down=${tDown.toFixed(3)}с × 1.3`,
      tUp, tDown,
    });
  }

  const selective = checks.every(c => c.ok);
  return {
    selective,
    reason: selective
      ? 'Селективность обеспечена'
      : 'Нарушение: ' + checks.filter(c => !c.ok).map(c => c.type + ' (' + c.info + ')').join(', '),
    checks,
  };
}
