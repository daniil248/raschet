// ======================================================================
// shared/app-header.js
// Единый хедер подпрограмм Raschet. Вставляется в любую страницу
// подпрограммы вызовом mountHeader({ title, home, version }).
//
// Содержимое справа:
//   ⚙ — шестерёнка, открывает глобальные настройки платформы
//   👤 — auth widget (аватар/имя пользователя или кнопка «Войти»)
//
// Модалка настроек — shared/global-settings.js (общий источник правды
// между главным приложением и всеми подпрограммами).
// ======================================================================

import { openSettingsModal } from './global-settings.js';
import { APP_VERSION } from '../js/engine/constants.js';

const HOME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`;
const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * Вставляет стандартный хедер в элемент #rs-header-mount (или в переданный
 * mount-элемент / селектор).
 *
 * @param {Object} opts
 * @param {string} opts.title     — название подпрограммы (справа от «Raschet»)
 * @param {string} [opts.home]    — путь к главной странице (по умолчанию '../hub.html')
 * @param {string} [opts.version] — опциональная версия (маленький текст)
 * @param {string|HTMLElement} [opts.mount] — элемент или селектор; default '#rs-header-mount'
 * @param {boolean} [opts.showHome=true] — показывать кнопку «К программам»
 * @returns {HTMLElement} — созданный <header> элемент
 */
export function mountHeader(opts = {}) {
  const {
    title = '',
    home = '../hub.html',
    version = 'v' + APP_VERSION,
    mount = '#rs-header-mount',
    showHome = true,
  } = opts;

  const mountEl = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!mountEl) {
    console.warn('[app-header] mount element not found:', mount);
    return null;
  }

  const header = document.createElement('header');
  header.className = 'rs-header';
  header.innerHTML =
    `<div class="rs-header-left">` +
      (showHome ? `<a class="rs-home-btn" href="${esc(home)}" title="К программам" aria-label="К программам">${HOME_SVG}</a>` : '') +
      `<span class="rs-brand">Raschet</span>` +
      (title ? `<span class="rs-subtitle">${esc(title)}</span>` : '') +
      (version ? `<span class="rs-version">${esc(version)}</span>` : '') +
    `</div>` +
    `<div class="rs-header-right">` +
      `<button type="button" class="rs-icon-btn rs-gear-btn" aria-label="Глобальные настройки" title="Глобальные настройки платформы">${GEAR_SVG}</button>` +
      `<div class="rs-auth-widget">` +
        `<button type="button" class="rs-icon-btn rs-signin-btn" style="display:none" title="Войти">${USER_SVG}<span style="margin-left:6px">Войти</span></button>` +
        `<div class="rs-user-chip" style="display:none"><img class="rs-user-photo" alt=""><span class="rs-user-name"></span></div>` +
      `</div>` +
    `</div>`;

  mountEl.replaceWith(header);
  header.id = mountEl.id || 'rs-header';

  // Шестерёнка
  const gearBtn = header.querySelector('.rs-gear-btn');
  if (gearBtn) gearBtn.addEventListener('click', () => openSettingsModal());

  // Auth widget — привязываем к window.Auth если доступен
  _wireAuthWidget(header);

  return header;
}

function _wireAuthWidget(header) {
  const signinBtn = header.querySelector('.rs-signin-btn');
  const chip      = header.querySelector('.rs-user-chip');
  const photoEl   = header.querySelector('.rs-user-photo');
  const nameEl    = header.querySelector('.rs-user-name');
  if (!signinBtn || !chip) return;

  const render = () => {
    const u = (window.Auth && window.Auth.currentUser) || null;
    if (u) {
      signinBtn.style.display = 'none';
      chip.style.display = 'inline-flex';
      if (photoEl) {
        if (u.photo) { photoEl.src = u.photo; photoEl.style.display = ''; }
        else photoEl.style.display = 'none';
      }
      if (nameEl) nameEl.textContent = u.name || u.email || 'User';
      chip.title = u.email || u.name || '';
      chip.onclick = () => {
        if (confirm('Выйти из аккаунта?')) {
          try { window.Auth.signOut(); } catch (e) { console.warn(e); }
        }
      };
    } else {
      signinBtn.style.display = 'inline-flex';
      chip.style.display = 'none';
    }
  };

  signinBtn.addEventListener('click', async () => {
    try {
      if (window.Auth && typeof window.Auth.signIn === 'function') {
        await window.Auth.signIn();
      } else {
        alert('Модуль авторизации не подключён на этой странице.');
      }
    } catch (e) {
      alert('Ошибка входа: ' + (e.message || e));
    }
  });

  // Подписка на изменения
  if (window.Auth && typeof window.Auth.onAuthChange === 'function') {
    window.Auth.onAuthChange(render);
  } else {
    // Auth ещё не загружен — попробуем через 0 + через 500 мс
    setTimeout(render, 0);
    setTimeout(() => {
      if (window.Auth && typeof window.Auth.onAuthChange === 'function') {
        window.Auth.onAuthChange(render);
      }
    }, 500);
  }
  render();
}
