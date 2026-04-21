// ======================================================================
// shared/module-footer.js
// Фиксированный футер в правом нижнем углу модуля: версия приложения +
// ссылка «Журнал изменений» для конкретного модуля.
//
// Использование:
//   import { mountFooter } from '../shared/module-footer.js';
//   import { APP_VERSION } from '../js/engine/constants.js';
//   mountFooter({
//     appVersion: APP_VERSION,
//     moduleId: 'suppression',
//     moduleTitle: 'АГПТ',
//     entries: [
//       { version: '0.59.5', date: '2026-04-21', items: ['...'] },
//       { version: '0.59.4', date: '2026-04-21', items: ['...'] },
//     ],
//   });
// ======================================================================

const STYLES_INJECTED = Symbol.for('raschet.moduleFooterStylesInjected');

function _injectStyles() {
  if (globalThis[STYLES_INJECTED]) return;
  globalThis[STYLES_INJECTED] = true;
  const css = `
    /* Резерв снизу для body: фиксированный футер не должен перекрывать
       контент. Применяется ко всем модулям при вызове mountFooter(). */
    body.rs-with-mfoot { padding-bottom: 32px; }
    .rs-mfoot {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 9989;
      height: 32px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      font-family: system-ui, sans-serif; font-size: 12px; color: #607080;
      background: #fff; border-top: 1px solid #e0e3ea;
      padding: 0 24px;
    }
    .rs-mfoot .rs-mfoot-left,
    .rs-mfoot .rs-mfoot-right {
      display: flex; align-items: center; gap: 10px;
    }
    .rs-mfoot-left a { color: #455a64; }
    .rs-mfoot b { color: #0d47a1; font-weight: 600; }
    .rs-mfoot a { color: #1565c0; cursor: pointer; text-decoration: none; }
    .rs-mfoot a:hover { text-decoration: underline; }
    .rs-mfoot-dot { color: #b0bec5; }

    .rs-mlog-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 9992; display: flex; align-items: center; justify-content: center;
    }
    .rs-mlog {
      background: #fff; border-radius: 8px; width: min(640px, 92vw);
      max-height: 82vh; display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    .rs-mlog header {
      padding: 12px 16px; background: #f5f9ff; color: #0d47a1;
      border-bottom: 1px solid #e1e4e8; display: flex; align-items: center;
      font-weight: 600; font-size: 14px;
    }
    .rs-mlog header span { flex: 1; }
    .rs-mlog header button {
      background: transparent; border: none; color: #546e7a; font-size: 18px;
      cursor: pointer; padding: 2px 8px; border-radius: 3px;
    }
    .rs-mlog header button:hover { background: #eceff1; color: #c62828; }
    .rs-mlog-body { padding: 14px 18px; overflow-y: auto; font-size: 13px; line-height: 1.55; }
    .rs-mlog-entry { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px dashed #eee; }
    .rs-mlog-entry:last-child { border-bottom: none; }
    .rs-mlog-ver { font-weight: 700; color: #1565c0; font-size: 13px; }
    .rs-mlog-date { font-size: 11px; color: #888; margin-left: 8px; }
    .rs-mlog-entry ul { margin: 4px 0 0 0; padding-left: 22px; color: #333; }
    .rs-mlog-entry li { margin-bottom: 2px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * @param {Object} opts
 *   appVersion: string — общая версия Raschet (ядро/конструктор)
 *   moduleVersion?: string — независимая версия модуля (если его changelog
 *     развивается отдельно; берётся автоматически из entries[0].version)
 *   moduleId: string — для analytics/localStorage
 *   moduleTitle: string — короткое имя модуля в заголовке журнала
 *   entries: [{version, date, items:[string]}] — от новой к старой
 */
export function mountFooter(opts) {
  _injectStyles();
  const { appVersion, moduleId, moduleTitle, entries = [], links = null } = opts;

  // v0.59.128: футер упрощён по требованию пользователя — только версия
  // и ссылка на журнал изменений. Никаких дополнительных ссылок.
  const foot = document.createElement('div');
  foot.className = 'rs-mfoot';
  foot.innerHTML = `
    <div style="flex:1"></div>
    <div class="rs-mfoot-right">
      <span>Raschet <b>v${appVersion}</b></span>
      <span class="rs-mfoot-dot">·</span>
      <a data-act="log">Журнал изменений «${moduleTitle}»</a>
    </div>
  `;
  document.body.appendChild(foot);
  // Резервируем 32 px внизу body, чтобы фиксированный футер не
  // перекрывал контент во всех модулях (вкладки страниц в конструкторе,
  // формы / таблицы в подпрограммах). Класс, а не inline-стиль — чтобы
  // модульные CSS могли переопределить при необходимости.
  document.body.classList.add('rs-with-mfoot');

  foot.querySelector('[data-act="log"]').addEventListener('click', () => openLog(moduleTitle, entries));
}

function openLog(title, entries) {
  const back = document.createElement('div');
  back.className = 'rs-mlog-backdrop';
  back.innerHTML = `
    <div class="rs-mlog">
      <header><span>Журнал изменений · ${title}</span><button data-act="close">✕</button></header>
      <div class="rs-mlog-body">
        ${entries.length ? entries.map(e => `
          <div class="rs-mlog-entry">
            <span class="rs-mlog-ver">v${e.version}</span>
            <span class="rs-mlog-date">${e.date || ''}</span>
            <ul>${(e.items||[]).map(i => `<li>${i}</li>`).join('')}</ul>
          </div>`).join('') : '<div style="color:#888;">Пока нет записей.</div>'}
      </div>
    </div>
  `;
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.dataset.act === 'close') back.remove();
  });
  document.body.appendChild(back);
}
