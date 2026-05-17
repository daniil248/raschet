// ======================================================================
// rack-config/calc/rack-power.js
// Чистый расчётный слой Компоновщика шкафа (без DOM): электрика —
// фазность, kW↔A, ёмкость PDU и группировка по вводам.
// Переиспользуемо: отчёты, BOM, тесты.
// ======================================================================

// Фазность шкафа: 3ф если хоть один PDU трёхфазный (по умолчанию 3ф — DC-typical).
export function guessRackIs3ph(t) {
  if (!t || !Array.isArray(t.pdus) || !t.pdus.length) return true;
  return t.pdus.some(p => Number(p.phases) === 3);
}

// P (кВт) → I (А) по фазности и cosφ шаблона.
export function kwToA(kw, t) {
  if (!(kw > 0)) return 0;
  const cos = (t && Number(t.cosphi)) || 0.9;
  const is3 = guessRackIs3ph(t);
  const U = is3 ? 400 : 230;
  const k = is3 ? Math.sqrt(3) : 1;
  return (kw * 1000) / (k * U * cos);
}

// I (А) → P (кВт).
export function aToKw(a, t) {
  if (!(a > 0)) return 0;
  const cos = (t && Number(t.cosphi)) || 0.9;
  const is3 = guessRackIs3ph(t);
  const U = is3 ? 400 : 230;
  const k = is3 ? Math.sqrt(3) : 1;
  return (a * k * U * cos) / 1000;
}

// Ёмкость одного PDU (кВт): P = 230·I·cosφ (1ф) или √3·400·I·cosφ (3ф).
export function pduCapacityKw(p, cos = 0.9) {
  const I = p.rating;
  if (p.phases === 3) return (Math.sqrt(3) * 400 * I * cos) / 1000;
  return (230 * I * cos) / 1000;
}

// {A: kW, B: kW, ...} — ёмкость PDU, сгруппированная по вводам.
export function computePduCapacityByFeed(t, cos = 0.9) {
  const out = {};
  t.pdus.forEach(p => {
    const f = p.feed || 'A';
    out[f] = (out[f] || 0) + (p.qty || 1) * pduCapacityKw(p, cos);
  });
  return out;
}
