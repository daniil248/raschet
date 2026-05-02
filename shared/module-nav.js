// =============================================================================
// shared/module-nav.js — навигация между модулями (return-from-embed pattern)
// =============================================================================
// Принцип (зафиксирован Пользователем 2026-05-02): «Мы должны вернуться ровно
// туда, откуда пришли в этот модуль. Это справедливо для любого модуля».
//
// Три режима работы любого модуля:
//
//   1. STANDALONE (?standalone=1)
//      Модуль работает как самостоятельное приложение. Нет привязки к
//      проекту. НЕ показывать кнопок возврата / cross-links.
//
//   2. EMBED — модуль вызван из другого модуля для подбора/выбора данных
//      (?return=PATH&returnSession=ID&returnLabel=...)
//      Показать кнопки:
//        ✓ Применить и вернуться   — отдаёт payload в LS под ключом
//                                    raschet.nav.return.<sessionId>.payload
//                                    + redirect на PATH с ?navResult=<sessionId>
//        ✗ Отмена                  — просто redirect без payload
//      Исходный модуль читает LS и удаляет ключ.
//
//   3. PROJECT (default — без специальных параметров)
//      Модуль открыт самостоятельно из hub. Cross-links на смежные модули
//      могут отображаться при наличии прав (placeholder).
//
// API:
//   detectNavMode()           → { mode, return: { path, sessionId, label } | null }
//   openEmbed(originPath, targetPath, sessionId, label)
//                              → location.href = targetPath с правильными query
//   readEmbedResult(sessionId) → payload | null  (и удаляет из LS)
//   completeReturn(payload)    → запись payload в LS + redirect на return.path
//   cancelReturn()             → просто redirect на return.path
//   renderModuleActions(rootEl, options)
//                              → HTML/события для cross-links и return-buttons

const LS_PREFIX = 'raschet.nav.return.';

/**
 * Определить режим работы модуля по URL.
 *
 * @returns {{mode: 'standalone'|'embed'|'project', return: object|null}}
 */
export function detectNavMode() {
  const params = new URLSearchParams(location.search);
  if (params.get('standalone') === '1') return { mode: 'standalone', return: null };
  const ret = params.get('return');
  if (ret) {
    return {
      mode: 'embed',
      return: {
        path: ret,
        sessionId: params.get('returnSession') || ('s_' + Date.now()),
        label: params.get('returnLabel') || 'исходный модуль',
      },
    };
  }
  return { mode: 'project', return: null };
}

/**
 * Открыть другой модуль в embed-режиме (для подбора данных).
 *
 * @param {string} originPath  — путь куда возвращаться (location.pathname)
 * @param {string} targetPath  — путь модуля-получателя (например '/cooling/')
 * @param {string} label       — короткое имя origin для UI получателя
 * @returns {string} sessionId — для последующего readEmbedResult
 */
export function openEmbed(originPath, targetPath, label) {
  const sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const url = `${targetPath}?return=${encodeURIComponent(originPath)}&returnSession=${encodeURIComponent(sessionId)}&returnLabel=${encodeURIComponent(label || '')}`;
  location.href = url;
  return sessionId;
}

/**
 * Прочитать payload, переданный из embed-модуля. Если URL имеет
 * ?navResult=<sessionId> — возвращает данные и удаляет из LS.
 *
 * @returns {object|null} payload или null если нет данных
 */
export function readEmbedResult() {
  const params = new URLSearchParams(location.search);
  const sid = params.get('navResult');
  if (!sid) return null;
  const key = LS_PREFIX + sid + '.payload';
  try {
    const raw = localStorage.getItem(key);
    if (raw) localStorage.removeItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Вернуться в origin-модуль с payload (Применить).
 *
 * @param {object} navContext  — результат detectNavMode().return
 * @param {object} payload     — данные для передачи (произвольная структура)
 */
export function completeReturn(navContext, payload) {
  if (!navContext) return;
  try {
    localStorage.setItem(LS_PREFIX + navContext.sessionId + '.payload', JSON.stringify(payload || {}));
  } catch {}
  location.href = `${navContext.path}?navResult=${encodeURIComponent(navContext.sessionId)}`;
}

/**
 * Вернуться без payload (Отмена).
 */
export function cancelReturn(navContext) {
  if (!navContext) return;
  location.href = navContext.path;
}

/**
 * Рендерит actions-блок (cross-links + return-buttons) в указанный root-элемент.
 *
 * @param {HTMLElement} root
 * @param {object} opts
 *   @param {object} opts.navContext — результат detectNavMode()
 *   @param {Array<{href, label, title}>=} opts.crossLinks — для project-mode
 *   @param {function():object=} opts.getPayload — для embed-mode «Применить»
 */
export function renderModuleActions(root, opts) {
  if (!root) return;
  const ctx = opts.navContext || { mode: 'project', return: null };
  if (ctx.mode === 'standalone') {
    root.innerHTML = '';
    return;
  }
  if (ctx.mode === 'embed' && ctx.return) {
    const lbl = ctx.return.label || 'исходный модуль';
    root.innerHTML = `
      <button type="button" class="mod-nav-btn-primary" data-act="apply"
              title="Применить выбранные данные и вернуться в «${escAttr(lbl)}». Данные будут переданы автоматически.">
        ✓ Применить и вернуться в «${escHtml(lbl)}»
      </button>
      <button type="button" class="mod-nav-btn-cancel" data-act="cancel"
              title="Вернуться в «${escAttr(lbl)}» без передачи данных. Старые данные пользователя сохранятся.">
        ✗ Отмена
      </button>
    `;
    root.querySelector('[data-act="apply"]').addEventListener('click', () => {
      const payload = opts.getPayload ? opts.getPayload() : {};
      completeReturn(ctx.return, payload);
    });
    root.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      cancelReturn(ctx.return);
    });
    return;
  }
  // project mode — cross-links на смежные модули (если переданы и доступны)
  const links = (opts.crossLinks || []).filter(l => l && l.href);
  if (!links.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = links.map(l =>
    `<a href="${escAttr(l.href)}" class="mod-nav-cross-link" title="${escAttr(l.title || '')}">${escHtml(l.label)}</a>`
  ).join('');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return escHtml(s); }
