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
import { startAutoBackupTimer, attachOnCloseBackup } from './backup.js';
import {
  getProjectContext, getPreviousStep, navigateBack, moduleLabel, pushNavStep,
  buildModuleHref,
} from './project-context.js';
import { getProject } from './project-storage.js';

// Известные пути модулей — для авто-ребайнда ссылок (см. _wireModuleLinks).
const MODULE_PATH_RX = /\/(schematic|cable|scs-design|scs-config|facility-inventory|rack-config|mv-config|ups-config|panel-config|pdu-config|transformer-config|mdc-config|suppression-config|projects|tech-workspace|help)\//;

// Эвристическое определение moduleId из location.pathname.
// Используется если вызывающий не передал moduleId явно.
function inferModuleId() {
  try {
    const p = location.pathname.toLowerCase();
    // hub.html — главный экран программ.
    if (/\/hub\.html$/.test(p)) return 'hub';
    // /projects/project.html — детальная карточка одного проекта (push'ит в
    // back-stack: с неё уходят в модули и возвращаются обратно).
    if (/\/projects\/project\.html$/.test(p)) return 'project-detail';
    const m = p.match(/\/([\w-]+)\/(?:index\.html|inventory\.html)?$/);
    if (m) {
      const dir = m[1];
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

  // v0.59.855: автозапуск таймера авто-бэкапа на любой странице где
  // mountHeader вызывается. Безопасно — если в settings disabled,
  // startAutoBackupTimer ничего не делает.
  try {
    const v = (typeof window !== 'undefined' && window.RASCHET_VERSION) || '';
    startAutoBackupTimer({ appVersion: v });
    attachOnCloseBackup({ appVersion: v });
  } catch (e) { console.warn('[app-header] auto-backup init failed:', e); }

  const mountEl = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!mountEl) {
    console.warn('[app-header] mount element not found:', mount);
    return null;
  }

  // v0.59.342: project-badge + back-кнопка для cross-module навигации.
  // v0.59.344: правила:
  //  - hub (главный экран программ) — никаких project-фич: ни back, ни
  //    project-badge, ни link-rewriter. Это «корень» приложения.
  //  - /projects/ — пушать в стек не нужно; это «лист проектов», точка входа.
  //  - direct-entry в конфигуратор (URL без ?project=) — пользователь хочет
  //    разовый расчёт; не показываем back/badge и не переписываем ссылки.
  //    Это значит: «штучные» модули (cable, mv-config, ups-config, и т.п.),
  //    запускаемые с hub, не предлагают переходов в другие модули.
  //  - project-mode (URL содержит ?project=) — полный набор фич: pushNavStep,
  //    badge, back-кнопка, link-rewriter с пробросом контекста.
  const ctx = (() => { try { return getProjectContext(); } catch { return {}; } })();
  const isHub = moduleId === 'hub';
  const isProjectsList = moduleId === 'projects';
  const inProjectMode = !!ctx.projectId && !isHub;

  // Push в back-stack только в project-mode и не для самого /projects/.
  if (moduleId && !isHub && !isProjectsList && inProjectMode) {
    try { pushNavStep({ moduleId, projectId: ctx.projectId, url: location.href }); } catch {}
  }

  const prev = inProjectMode ? (() => { try { return getPreviousStep(); } catch { return null; } })() : null;
  const proj = inProjectMode ? (() => { try { return getProject(ctx.projectId); } catch { return null; } })() : null;

  // Виртуальный prev из ?from= — только в project-mode.
  const effectivePrev = inProjectMode
    ? (prev || (ctx.fromModule ? { moduleId: ctx.fromModule, url: null } : null))
    : null;

  const backBtnHtml = effectivePrev
    ? `<button type="button" class="rs-back-btn" title="Вернуться: ${esc(moduleLabel(effectivePrev.moduleId))}" aria-label="Назад" data-from="${esc(effectivePrev.moduleId)}">←&nbsp;${esc(moduleLabel(effectivePrev.moduleId).replace(/^[^\s]+\s/,''))}</button>`
    : '';
  const projBadgeHtml = proj
    ? `<span class="rs-proj-badge" title="Активный проект: ${esc(proj.name || proj.id)}\nКликните чтобы вернуться к проекту">📁&nbsp;${esc(proj.name || proj.id)}</span>`
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
      `<button type="button" class="rs-storage-mode-btn" aria-label="Режим хранения" title="Режим хранения данных — локальный или облачный (Firebase)"></button>` +
      `<button type="button" class="rs-icon-btn rs-help-btn" aria-label="Помощь" title="Открыть Центр помощи на статью о текущем модуле">❓</button>` +
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

  // v0.59.859 Priority 3: health-check для orphan-PID-данных. Если в LS
  // обнаружены raschet.project.<pid>.* ключи без metadata-записи в
  // raschet.projects.v1, показываем плавающий warning-toast (один раз
  // за сессию, dismissable). Помогает обнаружить «потерю» данных рано.
  try { _checkOrphanProjects(); } catch (e) { console.warn('[health-check]', e); }

  // v0.59.800: кнопка ❓ — открывает Центр помощи на статью о текущем
  // модуле. inferModuleId уже есть, используем для маппинга moduleId →
  // article-id. Если модуль не имеет своей статьи — открываем главную.
  const helpBtn = header.querySelector('.rs-help-btn');
  if (helpBtn) {
    const MODULE_TO_ARTICLE = {
      'schematic': 'module-schematic',
      'tech-workspace': 'module-tech-workspace',
      'scs-design': 'module-scs-design',
      'scs-config': 'module-scs-config',
      'projects': 'module-projects',
      'project-detail': 'module-projects',
      'mdc-config': 'module-mdc-config',
      'help': 'help-center-meta',
      'hub': 'intro',
    };
    helpBtn.addEventListener('click', () => {
      const mid = (typeof moduleId === 'string' && moduleId) || inferModuleId();
      const article = MODULE_TO_ARTICLE[mid] || 'intro';
      const inSub = location.pathname.split('/').filter(Boolean).length > 1;
      const helpHref = (inSub ? '../help/' : './help/') + '#' + article;
      try { window.open(helpHref, '_blank', 'noopener'); }
      catch { location.href = helpHref; }
    });
  }

  // v0.59.780: режим хранения — Local / Online (Firebase). Юзер может
  // переключиться в local чтобы не палить квоту, или в cloud для
  // совместной работы. Кнопка показывает текущий режим, click открывает
  // модалку с переключателем + sync-кнопками.
  const storageModeBtn = header.querySelector('.rs-storage-mode-btn');
  if (storageModeBtn) {
    const updateStorageBadge = () => {
      // v0.59.857: принцип «нельзя действие — не показывай кнопку».
      // Если на этой странице нет нашего window.Storage (а есть только
      // встроенный браузерный Storage-конструктор у которого нет
      // userMode/setUserMode/syncLocalToCloud) — chip скрываем целиком.
      // Раньше клик показывал warn-toast, что нарушает UX-принцип.
      const S = window.Storage;
      const isOurStorage = !!(S && typeof S.setUserMode === 'function' && typeof S.syncLocalToCloud === 'function');
      if (!isOurStorage) {
        storageModeBtn.style.display = 'none';
        return;
      }
      storageModeBtn.style.display = '';
      const userMode = S.userMode || 'auto';
      const effective = S.effectiveMode || 'local';
      const isCloud = effective === 'cloud';
      const overrideMark = (userMode !== 'auto') ? ' 🔒' : '';
      storageModeBtn.innerHTML = isCloud ? `☁ Онлайн${overrideMark}` : `💾 Локально${overrideMark}`;
      storageModeBtn.classList.toggle('rs-storage-cloud', isCloud);
      storageModeBtn.classList.toggle('rs-storage-local', !isCloud);
      storageModeBtn.title = isCloud
        ? 'Режим: Онлайн (Firebase). Click — настроить.'
        : 'Режим: Локальный (без квот Firebase). Click — настроить и синхронизировать.';
    };
    updateStorageBadge();
    window.addEventListener('raschet:storage-mode-changed', updateStorageBadge);
    setTimeout(updateStorageBadge, 800); // дождаться window.Auth / window.Storage ready
    setTimeout(updateStorageBadge, 2000); // повторно — на случай поздней инициализации
    storageModeBtn.addEventListener('click', () => openStorageModeModal());
  }

  // Back-кнопка — возврат на предыдущий модуль.
  const backBtn = header.querySelector('.rs-back-btn');
  if (backBtn) backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const fromAttr = backBtn.getAttribute('data-from');
    const inSub = location.pathname.split('/').filter(Boolean).length > 1;
    // Особые цели вне back-stack:
    if (fromAttr === 'projects') {
      location.href = inSub ? '../projects/' : './projects/';
      return;
    }
    if (fromAttr === 'project-detail' && ctx.projectId) {
      const base = inSub ? '../projects/project.html' : './projects/project.html';
      location.href = buildModuleHref(base, { projectId: ctx.projectId });
      return;
    }
    if (fromAttr === 'hub') {
      location.href = inSub ? '../hub.html' : './hub.html';
      return;
    }
    // По умолчанию: pop из back-stack или fallback на карточку проекта.
    const fallback = ctx.projectId
      ? buildModuleHref((inSub ? '../projects/project.html' : './projects/project.html'), { projectId: ctx.projectId })
      : (inSub ? '../projects/' : './projects/');
    try { navigateBack(fallback); } catch { history.back(); }
  });

  // Project-badge — клик ведёт к карточке проекта /projects/project.html.
  const projBadge = header.querySelector('.rs-proj-badge');
  if (projBadge && ctx.projectId) {
    projBadge.style.cursor = 'pointer';
    projBadge.addEventListener('click', () => {
      const inSub = !/^\/(?:index\.html)?$/.test(location.pathname) && location.pathname.split('/').filter(Boolean).length > 1;
      const base = inSub ? '../projects/project.html' : './projects/project.html';
      location.href = buildModuleHref(base, { projectId: ctx.projectId });
    });
  }

  // Auth widget — привязываем к window.Auth если доступен
  _wireAuthWidget(header);

  // v0.59.342: глобальный делегат на клик по ссылкам других модулей —
  // дописывает ?project=&from=<thisModule> «на лету», чтобы не править
  // каждый <a> в каждом модуле.
  // v0.59.344: link-rewriter активируется ТОЛЬКО в project-mode. В hub и
  // direct-entry — обычные ссылки без проброса контекста; пользователь явно
  // решил «штучный» запуск.
  if (moduleId && inProjectMode) _wireModuleLinks(moduleId);

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
    // v0.59.859: применяем принцип «нельзя действие — не показывай кнопку».
    // Если auth API не доступен на этой странице ИЛИ Firebase не настроен
    // (config пуст / SDK не загружен) — кнопку «Войти» скрываем, чтобы
    // не показывать toast «модуль авторизации не подключён» при клике.
    const A = window.Auth;
    const authAvailable = !!(A && typeof A.signIn === 'function' && A.isFirebaseReady);
    const u = (A && A.currentUser) || null;
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
    } else if (authAvailable) {
      signinBtn.style.display = 'inline-flex';
      chip.style.display = 'none';
    } else {
      // Auth недоступен — кнопку скрываем (не отвлекаем пользователя).
      signinBtn.style.display = 'none';
      chip.style.display = 'none';
    }
  };

  signinBtn.addEventListener('click', async () => {
    try {
      if (window.Auth && typeof window.Auth.signIn === 'function') {
        await window.Auth.signIn();
      }
      // else — кнопка скрыта, клик не должен прийти
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

// v0.59.780: модалка переключения режима хранения. Показывает текущий
// режим (auto/local/cloud), эффективный режим, кнопки переключения
// и sync (push local→cloud / pull cloud→local).
function openStorageModeModal() {
  const Storage = window.Storage;
  // v0.59.839: window.Storage может быть встроенным браузерным конструктором
  // (если js/projects.js не загружен на этой странице) — у него нет наших
  // методов. Показываем графовый info-toast вместо нерабочей модалки.
  // Пользователь: «синхронизация не работает».
  if (!Storage || typeof Storage.setUserMode !== 'function'
      || typeof Storage.syncLocalToCloud !== 'function') {
    rsToast('Режим хранения и синхронизация доступны только на странице «Проекты». Откройте список проектов и кликните на иконку режима в заголовке.', 'warn');
    return;
  }
  const userMode = Storage.userMode || 'auto';
  const effective = Storage.effectiveMode || 'local';
  const fbReady = !!(window.Auth && window.Auth.isFirebaseReady);
  const overlay = document.createElement('div');
  overlay.className = 'rs-storage-modal-overlay';
  overlay.innerHTML = `<div class="rs-storage-modal">
    <div class="rs-storage-modal-head">
      <h3>Режим хранения данных</h3>
      <button type="button" class="rs-storage-modal-close" aria-label="Закрыть">×</button>
    </div>
    <div class="rs-storage-modal-body">
      <div class="rs-storage-status">
        <div><b>Текущий режим:</b> <span class="${effective === 'cloud' ? 'rs-mode-cloud' : 'rs-mode-local'}">${effective === 'cloud' ? '☁ Онлайн (Firebase)' : '💾 Локально (LocalStorage)'}</span></div>
        <div><b>Firebase:</b> ${fbReady ? '<span style="color:#16a34a">✓ Готов</span>' : '<span style="color:#dc2626">✗ Недоступен (войдите через Gmail)</span>'}</div>
      </div>
      <div class="rs-storage-modes">
        <label class="rs-storage-mode-row${userMode === 'auto' ? ' selected' : ''}">
          <input type="radio" name="rs-storage-mode" value="auto"${userMode === 'auto' ? ' checked' : ''}>
          <div>
            <div class="rs-storage-mode-name">🔄 Автоматически</div>
            <div class="rs-storage-mode-desc">Если Firebase авторизован — облако; иначе — локально.</div>
          </div>
        </label>
        <label class="rs-storage-mode-row${userMode === 'local' ? ' selected' : ''}">
          <input type="radio" name="rs-storage-mode" value="local"${userMode === 'local' ? ' checked' : ''}>
          <div>
            <div class="rs-storage-mode-name">💾 Только локально</div>
            <div class="rs-storage-mode-desc">Все данные в LocalStorage браузера. Без квот Firebase, без совместной работы. Подходит для одиночной работы без ограничений.</div>
          </div>
        </label>
        <label class="rs-storage-mode-row${userMode === 'cloud' ? ' selected' : ''}${!fbReady ? ' disabled' : ''}">
          <input type="radio" name="rs-storage-mode" value="cloud"${userMode === 'cloud' ? ' checked' : ''}${!fbReady ? ' disabled' : ''}>
          <div>
            <div class="rs-storage-mode-name">☁ Только онлайн</div>
            <div class="rs-storage-mode-desc">Firebase Firestore. Совместная работа, синхронизация между устройствами. Требует входа через Gmail.</div>
          </div>
        </label>
      </div>
      <div class="rs-storage-sync">
        <h4>Синхронизация</h4>
        <p class="muted">При смене режима данные не переносятся автоматически. Используйте кнопки ниже для явной синхронизации.</p>
        <div class="rs-storage-sync-actions">
          <button type="button" class="rs-storage-push" ${!fbReady ? 'disabled' : ''} title="Загрузить локальные проекты в облако">⬆ Local → Cloud</button>
          <button type="button" class="rs-storage-pull" ${!fbReady ? 'disabled' : ''} title="Скачать облачные проекты в локальное хранилище">⬇ Cloud → Local</button>
        </div>
        <div class="rs-storage-sync-result muted" id="rs-storage-sync-result"></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.rs-storage-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('input[name="rs-storage-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      Storage.setUserMode(r.value);
      rsToast(`Режим хранения: ${r.value === 'auto' ? 'авто' : (r.value === 'local' ? 'локально' : 'онлайн')}`, 'ok');
      // Re-render rows
      overlay.querySelectorAll('.rs-storage-mode-row').forEach(row => row.classList.remove('selected'));
      r.closest('.rs-storage-mode-row').classList.add('selected');
    });
  });
  const resultEl = overlay.querySelector('#rs-storage-sync-result');
  overlay.querySelector('.rs-storage-push').addEventListener('click', async (e) => {
    if (!confirm('Загрузить ВСЕ локальные проекты в облако? Существующие cloud-копии будут обновлены.')) return;
    e.target.disabled = true;
    resultEl.textContent = '⏳ Синхронизация...';
    try {
      const res = await Storage.syncLocalToCloud();
      resultEl.textContent = `✓ Загружено: ${res.pushed}/${res.total}` + (res.errors ? ` (ошибок: ${res.errors})` : '');
      rsToast(`Загружено в облако: ${res.pushed} проектов`, 'ok');
    } catch (err) {
      resultEl.textContent = `✗ ${err.message || err}`;
      rsToast('Ошибка sync: ' + (err.message || err), 'err');
    }
    e.target.disabled = false;
  });
  overlay.querySelector('.rs-storage-pull').addEventListener('click', async (e) => {
    if (!confirm('Скачать ВСЕ облачные проекты в локальное хранилище? Локальные копии будут обновлены.')) return;
    e.target.disabled = true;
    resultEl.textContent = '⏳ Синхронизация...';
    try {
      const res = await Storage.syncCloudToLocal();
      resultEl.textContent = `✓ Скачано: ${res.pulled}/${res.total}`;
      rsToast(`Скачано из облака: ${res.pulled} проектов`, 'ok');
    } catch (err) {
      resultEl.textContent = `✗ ${err.message || err}`;
      rsToast('Ошибка sync: ' + (err.message || err), 'err');
    }
    e.target.disabled = false;
  });
}

// v0.59.859: health-check — обнаруживает orphan-PID-данные в LocalStorage
// (ключи raschet.project.<pid>.* без соответствующей записи в
// raschet.projects.v1). Если найдены — показывает Toast с предложением
// открыть /projects/ и нажать «🔧 Восстановить связи». Один раз за сессию.
function _checkOrphanProjects() {
  try {
    if (sessionStorage.getItem('raschet.healthCheck.orphan.shown') === '1') return;
    let knownIds = new Set();
    try {
      const arr = JSON.parse(localStorage.getItem('raschet.projects.v1') || '[]');
      if (Array.isArray(arr)) for (const p of arr) if (p && typeof p.id === 'string') knownIds.add(p.id);
    } catch {}
    const orphanPids = new Set();
    const PREFIX = 'raschet.project.';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const rest = k.slice(PREFIX.length);
      const dot = rest.indexOf('.');
      if (dot < 0) continue;
      const pid = rest.slice(0, dot);
      if (typeof pid !== 'string' || !pid) continue;
      if (!/^[ps]_|^lp_/.test(pid)) continue;
      if (knownIds.has(pid)) continue;
      orphanPids.add(pid);
    }
    if (!orphanPids.size) return;
    sessionStorage.setItem('raschet.healthCheck.orphan.shown', '1');
    // Toast с кнопкой
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:16px;right:16px;max-width:380px;padding:14px 16px;background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:10000;font-size:13px;line-height:1.4';
    const onProjectsPage = location.pathname.includes('/projects/');
    toast.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:20px">⚠</span>
        <div style="flex:1">
          <div style="font-weight:600;color:#78350f;margin-bottom:4px">Обнаружены orphan-данные</div>
          <div style="color:#92400e;font-size:12px;margin-bottom:8px">В LocalStorage есть ${orphanPids.size} проект-ключей без metadata-записи. Это значит часть проектов невидима в реестре, но данные на месте.</div>
          ${onProjectsPage
            ? '<button type="button" class="rs-orphan-fix" style="padding:6px 12px;background:#16a34a;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px">🔧 Восстановить связи</button>'
            : '<a href="../projects/" style="display:inline-block;padding:6px 12px;background:#16a34a;color:#fff;border-radius:4px;text-decoration:none;font-weight:600;font-size:12px">→ Открыть Проекты</a>'}
          <button type="button" class="rs-orphan-dismiss" style="margin-left:6px;padding:6px 10px;background:transparent;border:1px solid #d97706;color:#92400e;border-radius:4px;cursor:pointer;font-size:12px">Скрыть</button>
        </div>
      </div>
    `;
    document.body.appendChild(toast);
    toast.querySelector('.rs-orphan-dismiss')?.addEventListener('click', () => toast.remove());
    toast.querySelector('.rs-orphan-fix')?.addEventListener('click', () => {
      const btn = document.getElementById('pr-restore-links');
      if (btn) { btn.click(); toast.remove(); }
    });
    // Auto-hide через 30 сек
    setTimeout(() => toast.remove(), 30000);
  } catch (e) { console.warn('[health-check] orphan scan failed:', e); }
}
