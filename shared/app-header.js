// ======================================================================
// shared/app-header.js
// Единый хедер подпрограмм Raschet. Вставляется в любую страницу
// подпрограммы вызовом mountHeader({ title, home, version }).
//
// Использование:
//   <body>
//     <div id="rs-header-mount"></div>
//     ...
//     <script type="module">
//       import { mountHeader } from '../shared/app-header.js';
//       mountHeader({ title: 'Расчёт АКБ', home: '../hub.html' });
//     </script>
//   </body>
//
// Хедер жёстко фиксирован по высоте 56 px (см. shared/app-header.css),
// можно стилизовать через класс .rs-header.
// ======================================================================

const HOME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`;

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
 * @returns {HTMLElement} — созданный <header> элемент
 */
export function mountHeader(opts = {}) {
  const {
    title = '',
    home = '../hub.html',
    version = '',
    mount = '#rs-header-mount',
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
      `<a class="rs-home-btn" href="${esc(home)}" title="К программам" aria-label="К программам">${HOME_SVG}</a>` +
      `<span class="rs-brand">Raschet</span>` +
      (title ? `<span class="rs-subtitle">${esc(title)}</span>` : '') +
      (version ? `<span class="rs-version">${esc(version)}</span>` : '') +
    `</div>` +
    `<div class="rs-header-right"></div>`;

  mountEl.replaceWith(header);
  // Сохраняем id на новом элементе, чтобы повторные вызовы работали
  header.id = mountEl.id || 'rs-header';
  return header;
}
