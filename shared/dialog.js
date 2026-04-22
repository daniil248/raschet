// =========================================================================
// shared/dialog.js (v0.59.182)
// Единый API in-page диалогов для всех подпрограмм: rsToast / rsConfirm /
// rsPrompt. Никаких нативных alert/confirm/prompt — всё рендерится в
// собственный хост #rs-ui-host и стилизуется через shared/styles/dialog.css
// (подключается отдельно или через base.css).
// =========================================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function host() {
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
    const close = (result) => {
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
    back.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') close(input ? null : false);
      if (ev.key === 'Enter' && input) close(input.value || '');
    });
    requestAnimationFrame(() => {
      back.classList.add('rs-modal-open');
      if (input) { input.focus(); input.select(); }
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
