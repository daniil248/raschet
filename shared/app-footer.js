// ======================================================================
// shared/app-footer.js
// Единый футер подпрограмм Raschet: версия приложения, ссылки на
// связанные модули, репозиторий. Вставляется вызовом mountFooter().
//
// Использование:
//   import { mountFooter } from '../shared/app-footer.js';
//   mountFooter();
// либо с кастомизацией:
//   mountFooter({ mount: '#my-footer-mount', links: [...], home: '../hub.html' });
//
// Если у страницы нет элемента mount — футер добавляется в конец body.
// ======================================================================

import { APP_VERSION } from '../js/engine/constants.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

const DEFAULT_LINKS = [
  { label: 'Все программы', href: '../hub.html' },
  { label: 'Библиотека и каталог', href: '../catalog/' },
  { label: 'GitHub', href: 'https://github.com/daniil248/raschet', external: true },
];

/**
 * Вставляет единый футер в mountEl (или в конец body если не задан).
 * Не вставляется повторно если уже есть элемент .rs-footer в документе.
 */
export function mountFooter(opts = {}) {
  const {
    mount = '#rs-footer-mount',
    links = DEFAULT_LINKS,
    version = 'v' + APP_VERSION,
    showLinks = true,
  } = opts;

  // Избегаем повторной вставки (если страница рендерится несколько раз)
  if (document.querySelector('footer.rs-footer')) return;

  let mountEl = typeof mount === 'string' ? document.querySelector(mount) : mount;
  const appendToBody = !mountEl;
  if (appendToBody) {
    mountEl = document.createElement('div');
    document.body.appendChild(mountEl);
  }

  const footer = document.createElement('footer');
  footer.className = 'rs-footer';
  const linksHtml = showLinks
    ? links.map(l =>
        `<a href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}${l.external ? ' ↗' : ''}</a>`
      ).join('<span class="rs-footer-sep">·</span>')
    : '';

  const year = new Date().getFullYear();
  footer.innerHTML =
    `<div class="rs-footer-inner">` +
      `<div class="rs-footer-links">${linksHtml}</div>` +
      `<div class="rs-footer-meta">` +
        `<span class="rs-footer-version" title="Версия приложения">${esc(version)}</span>` +
        `<span class="rs-footer-copyright">© ${year} Raschet Platform</span>` +
      `</div>` +
    `</div>`;

  mountEl.appendChild(footer);
  _ensureStyles();
  return footer;
}

// Инжектим CSS один раз (чтобы не требовать отдельный .css)
let _stylesInjected = false;
function _ensureStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
    footer.rs-footer {
      margin-top: 32px;
      padding: 16px 20px;
      background: #fafbfc;
      border-top: 1px solid #e1e4e8;
      font-size: 12px;
      color: #666;
    }
    footer.rs-footer .rs-footer-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    footer.rs-footer .rs-footer-links {
      display: flex;
      gap: 0;
      align-items: center;
      flex-wrap: wrap;
    }
    footer.rs-footer .rs-footer-links a {
      color: #1976d2;
      text-decoration: none;
      padding: 4px 8px;
    }
    footer.rs-footer .rs-footer-links a:hover { text-decoration: underline; }
    footer.rs-footer .rs-footer-sep { color: #ccc; }
    footer.rs-footer .rs-footer-meta {
      display: flex;
      gap: 12px;
      align-items: center;
      font-family: monospace;
      font-size: 11px;
    }
    footer.rs-footer .rs-footer-version {
      padding: 2px 8px;
      background: #e8f1fb;
      color: #1976d2;
      border-radius: 3px;
      font-weight: 600;
    }
    footer.rs-footer .rs-footer-copyright { color: #999; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
