/* =========================================================================
   suppression-methods/validation-tests.js — Phase 11.9
   Регрессионные тесты для 4 методик (СП 485, СП РК, NFPA 2001, ISO 14520).
   Каждый кейс — входной объект + ожидаемые значения с допуском ±5 %.

   Опорные примеры:
   • СП 485 Приложение Д: HFC-227ea (FM-200), 30×3 м, Cн=7.2%, T=20°C.
     Аналитически: mp = S·H·r1·Cн/(100−Cн) = 30·3·7.18·7.2/92.8 ≈ 50.1 кг.
   • NFPA 2001 Annex A (FM-200 6.25 вес. %): 50 м³ → ~20 кг ±10%.
   • ISO 14520 Annex B (HFC-227ea): design concentration 7% → аналог СП 485.
   • СП РК 2022 (IG-541): 100 м³ → mp_inert ≈ 3.8·V·ln(100/(100−Cн))/2.303.

   Допуск намеренно широкий (±5 %) — тесты ловят только грубые регрессии,
   не мелкие уточнения коэффициентов/округлений между релизами.
   ========================================================================= */

// Динамический импорт с cache-bust — GitHub Pages отдаёт max-age=600, и после
// фикса реестра (добавление sp-485-annex-d) браузер мог держать старый index.js.
let METHODS = null;
async function loadMethods() {
  if (METHODS) return METHODS;
  const mod = await import('./index.js?v=' + Date.now());
  METHODS = mod.METHODS;
  return METHODS;
}

export const TEST_CASES = [
  {
    id: 'sp485-fm200-30x3',
    methodId: 'sp-485-annex-d',
    label: 'СП 485 Прил.Д · FM-200 · серверная 30×3 м',
    ref: 'Формула Прил.Д: mp = S·H·r1·Cн/(100−Cн)',
    input: {
      agent: 'HFC-227ea', sp: 30, h: 3, tm: 20, hm: 0, fs: 0,
      paramp: 0.4, cn: 7.2, tp: 10, fireClass: 'A',
      moduleCode: 'HAL-42-40', obtr: 0, k1: 1.05,
    },
    expected: { mp: 50.1, n: 2, C: 7.2 },
    tolerancePct: 5,
  },
  {
    id: 'sp485-fm200-100m2',
    methodId: 'sp-485-annex-d',
    label: 'СП 485 Прил.Д · FM-200 · большое помещение 100×3 м',
    ref: 'Проверка линейного масштабирования mp ∝ V',
    input: {
      agent: 'HFC-227ea', sp: 100, h: 3, tm: 20, hm: 0, fs: 0,
      paramp: 0.4, cn: 7.2, tp: 10, fireClass: 'A',
      moduleCode: 'HAL-42-100', obtr: 0, k1: 1.05,
    },
    expected: { mp: 167.1, C: 7.2 }, // 50.1 × (100/30) ≈ 167
    tolerancePct: 5,
  },
  {
    id: 'sp485-novec-30x3',
    methodId: 'sp-485-annex-d',
    label: 'СП 485 Прил.Д · Novec 1230 · 30×3 м',
    ref: 'FK-5-1-12: rho20=13.60, Cmin_A=4.2. mp = 90·13.60·Cн/(100−Cн)',
    input: {
      agent: 'FK-5-1-12', sp: 30, h: 3, tm: 20, hm: 0, fs: 0,
      paramp: 0.4, tp: 10, fireClass: 'A',
      moduleCode: 'HAL-42-40', obtr: 0, k1: 1.05,
    },
    // Cn = Cmin_A · 1.0 = 4.2; mp = 90·13.60·4.2/95.8 ≈ 53.6
    expected: { mp: 53.6, C: 4.2 },
    tolerancePct: 5,
  },
  {
    id: 'nfpa-fm200-50m3',
    methodId: 'nfpa-2001',
    label: 'NFPA 2001 · FM-200 · 50 м³',
    ref: 'NFPA §5.4: design C = MEC · 1.3 = 7.0 · 1.3 = 9.1%. W = V/s·C/(100−C).',
    input: {
      agent: 'HFC-227ea', V: 50, fireClass: 'A',
      tempC: 20, altM: 0, leakage: 'II',
    },
    // s(20) = 0.1269 + 0.000513·20 = 0.1372; W = 50/0.1372·9.1/90.9 ≈ 36.5 кг
    expected: { M: 36.5, C: 9.1 },
    tolerancePct: 5,
  },
  {
    id: 'iso-fm200-100m3',
    methodId: 'iso-14520',
    label: 'ISO 14520 · FM-200 · 100 м³',
    ref: 'ISO 14520: C = MEC·1.3 = 9.1%. M = V/s · C/(100−C) / Kalt.',
    input: {
      agent: 'HFC-227ea', V: 100, fireClass: 'A',
      tempC: 20, altM: 0,
    },
    // s20(HFC-227ea) = 0.1373; M = 100/0.1373·9.1/90.9 ≈ 72.9 кг
    expected: { C: 9.1, M: 72.9 },
    tolerancePct: 5,
  },
  {
    id: 'sprk-ig541-100m3',
    methodId: 'sp-rk-2022',
    label: 'СП РК 2.02-102-2022 · IG-541 · 100 м³',
    ref: 'Инертный: M = K1·V·ρ·ln(100/(100−C)). C = Cmin·Ks = 39.9·1.3 = 51.87%.',
    input: {
      agent: 'IG-541', V: 100, fireClass: 'A',
      tempC: 20, altM: 0, leakage: 'II',
    },
    // C = 39.9·1.3 = 51.87; K1(II)=1.10; M = 1.10·100·1.40·ln(100/48.13) ≈ 112.7 кг
    expected: { C: 51.87, M: 112.7 },
    tolerancePct: 5,
  },
];

/** Проверяет одно поле результата с учётом допуска. */
function checkField(actual, expected, tolerancePct) {
  if (typeof expected !== 'number' || !Number.isFinite(expected)) {
    return { ok: actual === expected, actual, expected };
  }
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    return { ok: false, actual, expected };
  }
  const delta = Math.abs(actual - expected);
  const tol = Math.abs(expected) * tolerancePct / 100;
  return { ok: delta <= tol, actual: +actual.toFixed(2), expected, deltaPct: +(delta / Math.max(1e-9, Math.abs(expected)) * 100).toFixed(1) };
}

/** Прогон одного кейса. */
export function runCase(tc, methodsMap) {
  const map = methodsMap || METHODS || {};
  const method = map[tc.methodId];
  if (!method) {
    return { id: tc.id, label: tc.label, ok: false, error: 'Unknown method: ' + tc.methodId };
  }
  let result;
  try {
    result = method.compute(tc.input);
  } catch (err) {
    return { id: tc.id, label: tc.label, ok: false, error: err.message };
  }
  const checks = [];
  let allOk = true;
  for (const [key, expected] of Object.entries(tc.expected)) {
    const chk = checkField(result[key], expected, tc.tolerancePct || 5);
    checks.push({ key, ...chk });
    if (!chk.ok) allOk = false;
  }
  return { id: tc.id, label: tc.label, methodId: tc.methodId, ref: tc.ref, ok: allOk, checks, result };
}

/** Прогон всех кейсов. */
export async function runAll() {
  const map = await loadMethods();
  return TEST_CASES.map(tc => runCase(tc, map));
}
