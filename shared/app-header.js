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
import { rsToast, rsConfirm } from './dialog.js';
import {
  getProjectContext, getPreviousStep, navigateBack, moduleLabel, pushNavStep,
  buildModuleHref,
} from './project-context.js';
import { getProject } from './project-storage.js';

// Известные пути модулей — для авто-ребайнда ссылок (см. _wireModuleLinks).
const MODULE_PATH_RX = /\/(schematic|cable|scs-design|scs-config|facility-inventory|rack-config|mv-config|ups-config|panel-config|pdu-config|transformer-config|mdc-config|suppression-config|projects)\//;

// Эвристическое определение moduleId из location.pathname.
// Используется если вызывающий не передал moduleId явно.
function inferModuleId() {
  try {
    const p = location.pathname.toLowerCase();
    const m = p.match(/\/([\w-]+)\/(?:index\.html|inventory\.html)?$/);
    if (m) {
      const dir = m[1];
      // inventory.html лежит в scs-config — отдельный moduleId.
      if (dir === 'scs-config' && /inventory\.html$/i.test(p)) return 'scs-config-inventory';
      if (dir === 'projects') return 'projects';
      return dir;
    }
    // Корневой index.html — главный конструктор схем.
    if (/\/(?:index\.html)?$/.test(p)) return 'schematic';
  } catch {}
  return null;
}

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
    mount = '#rs-header-mount',
    showHome = true,
    moduleId: explicitModuleId = null,
  } = opts;
  const moduleId = explicitModuleId || inferModuleId();

  const mountEl = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!mountEl) {
    console.warn('[app-header] mount element not found:', mount);
    return null;
  }

  // v0.59.342: project-badge + back-кнопка для cross-module навигации.
  const ctx = (() => { try { return getProjectContext(); } catch { return {}; } })();
  // Регистрируем текущую страницу в back-stack — следующий модуль сможет
  // вернуться сюда через ←-кнопку. Для /projects/ сами не пушим (там
  // clearNavStack при клике по ссылке модуля).
  if (moduleId && moduleId !== 'projects') {
    try { pushNavStep({ moduleId, projectId: ctx.projectId, url: location.href }); } catch {}
  }
  const prev = (() => { try { return getPreviousStep(); } catch { return null; } })();
  const proj = ctx.projectId ? (() => { try { return getProject(ctx.projectId); } catch { return null; } })() : null;

  // Если нет стека, но в URL есть ?from= — синтезируем "виртуальный" prev,
  // чтобы пользователь, перешедший напрямую по сохранённой ссылке, тоже
  // увидел back-кнопку.
  const effectivePrev = prev || (ctx.fromModule ? { moduleId: ctx.fromModule, url: null } : null);

  const backBtnHtml = effectivePrev
    ? `<button type="button" class="rs-back-btn" title="Вернуться: ${esc(moduleLabel(effectivePrev.moduleId))}" aria-label="Назад" data-from="${esc(effectivePrev.moduleId)}">←&nbsp;${esc(moduleLabel(effectivePrev.moduleId).replace(/^[^\s]+\s/,''))}</button>`
    : '';
  const projBadgeHtml = proj
    ? `<span class="rs-proj-badge" title="Активный проект: ${esc(proj.name || proj.id)}\nКликните чтобы вернуться к списку проектов">📁&nbsp;${esc(proj.name || proj.id)}</span>`
    : '';

  const header = document.createElement('header');
  header.className = 'rs-header';
  header.innerHTML =
    `<div class="rs-header-left">` +
      (showHome ? `<a class="rs-home-btn" href="${esc(home)}" title="К программам" aria-label="К программам">${HOME_SVG}</a>` : '') +
      `<span class="rs-brand">Raschet</span>` +
      (title ? `<span class="rs-subtitle">${esc(title)}</span>` : '') +
      backBtnHtml +
      projBadgeHtml +
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

  // Back-кнопка — возврат на предыдущий модуль.
  const backBtn = header.querySelector('.rs-back-btn');
  if (backBtn) backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const fromAttr = backBtn.getAttribute('data-from');
    // Если ?from=projects — идём на /projects/ (особый случай).
    if (fromAttr === 'projects') {
      // Из подпапки '../projects/'; из корня './projects/'.
      const inSub = !/\/(?:index\.html)?$/.test(location.pathname) && location.pathname.split('/').filter(Boolean).length > 1;
      location.href = inSub ? '../projects/' : './projects/';
      return;
    }
    try { navigateBack('../projects/'); } catch { history.back(); }
  });

  // Project-badge — клик ведёт к /projects/.
  const projBadge = header.querySelector('.rs-proj-badge');
  if (projBadge) {
    projBadge.style.cursor = 'pointer';
    projBadge.addEventListener('click', () => {
      // Пытаемся определить относительный путь к /projects/.
      const path = location.pathname;
      const depth = (path.match(/\/[^\/]+\//g) || []).length;
      // Простая эвристика: если мы в подпапке (e.g. /scs-config/) — '../projects/'
      const href = path.endsWith('/projects/') || path.endsWith('/projects/index.html')
        ? location.href
        : (path.includes('/projects/') ? './' : '../projects/');
      location.href = href;
    });
  }

  // Auth widget — привязываем к window.Auth если доступен
  _wireAuthWidget(header);

  // v0.59.342: глобальный делегат на клик по ссылкам других модулей —
  // дописывает ?project=&from=<thisModule> «на лету», чтобы не править
  // каждый <a> в каждом модуле.
  if (moduleId) _wireModuleLinks(moduleId);

  return header;
}

function _wireModuleLinks(currentModuleId) {
  // Один раз на страницу.
  if (window.__rsModuleLinksWired) return;
  window.__rsModuleLinksWired = true;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target === '_blank') return;
    const href = a.getAttribute('href');
    if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href)) return;
    if (/^https?:/i.test(href)) return; // внешний URL
    if (!MODULE_PATH_RX.test(href) && !MODULE_PATH_RX.test('/' + href)) return;
    // Уже содержит project= — не трогаем.
    if (/[?&]project=/.test(href)) return;
    let ctx = {}; try { ctx = getProjectContext(); } catch {}
    if (!ctx.projectId && !currentModuleId) return;
    e.preventDefault();
    location.href = buildModuleHref(href, {
      projectId: ctx.projectId,
      fromModule: currentModuleId,
    });
  }, true);
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
      chip.onclick = async () => {
        if (await rsConfirm('Выйти из аккаунта?', '', { okLabel: 'Выйти', cancelLabel: 'Отмена' })) {
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
        rsToast('Модуль авторизации не подключён на этой странице.', 'warn');
      }
    } catch (e) {
      rsToast('Ошибка входа: ' + (e.message || e), 'err');
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
