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

// v0.59.685: «?»-иконка с подсказкой, появляющейся в всплывающем окне
// при наведении. Пользователь: «подсказки и справку показывай только в
// всплывающем окне над параметром или над знаком вопроса в кружке после
// названия параметра».
//
// Использование: helpIcon('Краткое описание параметра. Аналоги в других
// методиках. Формула. Ссылка на нормативку.') возвращает HTML span,
// который встраивается рядом с <label> любого поля.
//
// CSS-классы: .help-icon (синий кружок «?» в углу), .help-icon[title]:hover
// показывает нативный browser tooltip. Для более богатых тултипов с
// форматированием можно позже подменить на JS-popover.
export function helpIcon(tip) {
  if (!tip) return '';
  return `<span class="help-icon" title="${escAttr(tip)}" tabindex="0" aria-label="Справка">?</span>`;
}
