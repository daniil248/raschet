// utils.js — чистые утилиты без зависимостей от других модулей

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function escAttr(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

export function fmt(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toString();
}

// Форматирование мощности: <0.5 kW → в Вт, иначе в kW
export function fmtPower(kw) {
  const v = Number(kw) || 0;
  if (Math.abs(v) < 0.5) return Math.round(v * 1000) + ' W';
  return fmt(v) + ' kW';
}

export function flash(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// v0.57.71: preserve-on-miss helpers для apply-хендлеров параметров.
// Правило: установленные пользователем параметры НЕЛЬЗЯ затирать
// дефолтами, если элемента нет в DOM или поле пустое. См.
// feedback_user_params.md. Используется в inspector/{source,consumer,panel,ups}.js.
export function readDomNum(id, curr) {
  const el = document.getElementById(id);
  if (!el) return curr;
  const raw = String(el.value ?? '').trim();
  if (raw === '') return curr;
  const v = Number(raw);
  return Number.isFinite(v) ? v : curr;
}

export function readDomStr(id, curr) {
  const el = document.getElementById(id);
  if (!el) return curr;
  const raw = String(el.value ?? '').trim();
  return raw === '' ? curr : raw;
}

export function field(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}

export function checkField(label, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
