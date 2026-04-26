// shared/ups-types/_helpers.js — мини-утилиты для type-плагинов.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function fmt(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const x = Number(n);
  return x % 1 === 0 ? x.toString() : x.toFixed(digits);
}

// Значение для поля формы: если undefined/null — fallback.
export function v(val, fallback) {
  return (val == null) ? fallback : val;
}
