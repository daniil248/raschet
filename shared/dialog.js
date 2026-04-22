// =========================================================================
// shared/dialog.js (v0.59.186)
// Единый API in-page диалогов для всех подпрограмм: rsToast / rsConfirm /
// rsPrompt. Никаких нативных alert/confirm/prompt — всё рендерится в
// собственный хост #rs-ui-host. CSS самодостаточен: инъектится при первом
// вызове, не требует подключения base.css на странице.
// =========================================================================

const DIALOG_CSS = `
#rs-ui-host { position: fixed; inset: 0; pointer-events: none; z-index: 10000; }
#rs-ui-host .rs-toast { pointer-events: auto; position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(16px); opacity: 0; transition: transform .2s ease, opacity .2s ease; background: #334155; color: #fff; padding: 10px 16px; border-radius: 8px; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,0.15); max-width: 560px; }
#rs-ui-host .rs-toast-shown { transform: translateX(-50%) translateY(0); opacity: 1; }
#rs-ui-host .rs-toast-ok   { background: #16a34a; }
#rs-ui-host .rs-toast-warn { background: #d97706; }
#rs-ui-host .rs-toast-err  { background: #dc2626; }
#rs-ui-host .rs-toast-info { background: #475569; }
#rs-ui-host .rs-modal-back { pointer-events: auto; position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .15s ease; }
#rs-ui-host .rs-modal-open { opacity: 1; }
#rs-ui-host .rs-modal-card { background: #fff; border-radius: 10px; padding: 20px 22px; min-width: 320px; max-width: 520px; box-shadow: 0 10px 40px rgba(0,0,0,0.25); font: 13px/1.4 system-ui, sans-serif; color: #0f172a; }
#rs-ui-host .rs-modal-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
#rs-ui-host .rs-modal-msg { color: #475569; margin-bottom: 14px; white-space: pre-wrap; }
#rs-ui-host .rs-modal-input { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; margin-bottom: 14px; }
#rs-ui-host .rs-modal-input:focus { outline: 2px solid #3b82f6; outline-offset: -1px; border-color: #3b82f6; }
#rs-ui-host .rs-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
#rs-ui-host .rs-btn { cursor: pointer; padding: 7px 16px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; font: inherit; color: #0f172a; }
#rs-ui-host .rs-btn:hover { background: #f1f5f9; }
#rs-ui-host .rs-btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
#rs-ui-host .rs-btn-primary:hover { background: #1d4ed8; }
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rs-dialog-css')) return;
  const s = document.createElement('style');
  s.id = 'rs-dialog-css';
  s.textContent = DIALOG_CSS;
  (document.head || document.documentElement).appendChild(s);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function host() {
  injectCss();
  let h = document.getElementById('rs-ui-host');
  if (!h) {
    h = document.createElement('div');
    h.id = 'rs-ui-host';
    document.body.appendChild(h);
  }
  return h;
}

/**
 * rsToast(msg, kind='info')
 *   kind: 'info' | 'ok' | 'warn' | 'err'
 *   err держится 5 сек, остальные 3 сек.
 */
export function rsToast(msg, kind) {
  kind = kind || 'info';
  const h = host();
  const t = document.createElement('div');
  t.className = 'rs-toast rs-toast-' + kind;
  t.textContent = String(msg || '');
  h.appendChild(t);
  requestAnimationFrame(() => t.classList.add('rs-toast-shown'));
  setTimeout(() => {
    t.classList.remove('rs-toast-shown');
    setTimeout(() => t.remove(), 250);
  }, kind === 'err' ? 5000 : 3000);
}

/**
 * rsConfirm(title, message?, opts?) → Promise<boolean | string | null>
 *   Если opts.input передан — модалка показывает input, резолвит строку
 *   (или null при отмене). Иначе — резолвит true/false.
 *   opts.okLabel / cancelLabel — подписи кнопок.
 */
export function rsConfirm(title, message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const h = host();
    const back = document.createElement('div');
    back.className = 'rs-modal-back';
    back.innerHTML = `
      <div class="rs-modal-card" role="dialog" aria-modal="true">
        <div class="rs-modal-title">${esc(title)}</div>
        ${message ? `<div class="rs-modal-msg">${esc(message)}</div>` : ''}
        ${opts.input != null ? `<input class="rs-modal-input" type="text" value="${esc(opts.input)}" />` : ''}
        <div class="rs-modal-actions">
          <button type="button" class="rs-btn" data-v="0">${esc(opts.cancelLabel || 'Отмена')}</button>
          <button type="button" class="rs-btn rs-btn-primary" data-v="1">${esc(opts.okLabel || 'OK')}</button>
        </div>
      </div>`;
    h.appendChild(back);
    const input = back.querySelector('.rs-modal-input');
    let onKey = null;
    const close = (result) => {
      if (onKey) document.removeEventListener('keydown', onKey);
      back.classList.remove('rs-modal-open');
      setTimeout(() => back.remove(), 150);
      resolve(result);
    };
    back.querySelector('[data-v="1"]').addEventListener('click', () =>
      close(input ? (input.value || '') : true));
    back.querySelector('[data-v="0"]').addEventListener('click', () =>
      close(input ? null : false));
    back.addEventListener('click', ev => {
      if (ev.target === back) close(input ? null : false);
    });
    onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(input ? null : false); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        close(input ? (input.value || '') : true);
      }
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      back.classList.add('rs-modal-open');
      if (input) { input.focus(); input.select(); }
      else {
        const okBtn = back.querySelector('[data-v="1"]');
        if (okBtn) okBtn.focus();
      }
    });
  });
}

/**
 * rsPrompt(title, defaultValue='') → Promise<string | null>
 */
export function rsPrompt(title, defaultValue) {
  return rsConfirm(title, '', { input: defaultValue == null ? '' : String(defaultValue) });
}

// Глобальные алиасы для legacy-кода (чтобы заменить alert/confirm/prompt
// одной строкой import + глобальной привязкой). Только если window есть.
if (typeof window !== 'undefined') {
  window.rsToast   = rsToast;
  window.rsConfirm = rsConfirm;
  window.rsPrompt  = rsPrompt;
}
