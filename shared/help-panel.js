// ======================================================================
// shared/help-panel.js
// Единый help-виджет для всех подпрограмм Raschet.
//
// Использование:
//   import { mountHelp } from '../shared/help-panel.js';
//   mountHelp({
//     module: 'cable',                     // id модуля (для localStorage / аналитики)
//     title: 'Расчёт кабельной линии',     // Заголовок модалки
//     usage: `
//       <h4>Как использовать</h4>
//       <ol>
//         <li>Введите нагрузку (kW) и напряжение (V)</li>
//         <li>Выберите способ прокладки и группу</li>
//         <li>Получите рекомендуемое сечение</li>
//       </ol>
//     `,
//     calcs: `
//       <h4>Формулы и стандарты</h4>
//       <ul>
//         <li>I<sub>расч</sub> = P / (√3 · U · cos φ) — IEC 60364-5-52</li>
//         <li>S = k² × Iz² / t — IEC 60364-4-43 (термостойкость)</li>
//       </ul>
//     `,
//   });
//
// Рендерит floating-button «?» в правом-нижнем углу. Клик — показывает
// модалку с двумя вкладками: «Как использовать» / «Текущие расчёты».
// ======================================================================

const STYLES_INJECTED = Symbol.for('raschet.helpPanelStylesInjected');

function _injectStyles() {
  if (globalThis[STYLES_INJECTED]) return;
  globalThis[STYLES_INJECTED] = true;
  const css = `
    .rs-help-fab {
      position: fixed; right: 16px; bottom: 44px; z-index: 9990;
      width: 44px; height: 44px; border-radius: 50%;
      background: #1976d2; color: #fff; border: none; cursor: pointer;
      font-size: 22px; font-weight: 700; line-height: 44px; text-align: center;
      box-shadow: 0 4px 14px rgba(25,118,210,0.45);
      transition: transform .15s ease, box-shadow .15s ease;
      font-family: system-ui, sans-serif;
    }
    .rs-help-fab:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(25,118,210,0.55); }
    .rs-help-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 9991; display: flex; align-items: center; justify-content: center;
    }
    .rs-help-modal {
      background: #fff; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      width: min(780px, 92vw); max-height: 88vh;
      display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif;
    }
    .rs-help-header {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; border-bottom: 1px solid #e1e4e8;
      background: linear-gradient(to right, #1976d2, #1565c0); color: #fff;
    }
    .rs-help-header h3 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
    .rs-help-close {
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 16px;
    }
    .rs-help-close:hover { background: rgba(255,255,255,0.35); }
    .rs-help-tabs {
      display: flex; border-bottom: 1px solid #e1e4e8; background: #fafbfc;
      flex-shrink: 0;
    }
    .rs-help-tab {
      padding: 10px 18px; cursor: pointer; border: none; background: transparent;
      font-size: 13px; font-weight: 500; color: #586069; border-bottom: 2px solid transparent;
      font-family: inherit;
    }
    .rs-help-tab.active { color: #1976d2; border-bottom-color: #1976d2; background: #fff; }
    .rs-help-tab:hover:not(.active) { color: #24292e; background: #f0f3f6; }
    .rs-help-body {
      flex: 1; overflow-y: auto; padding: 16px 20px; font-size: 13px; line-height: 1.6;
      color: #24292e;
    }
    .rs-help-body h4 { margin: 0 0 8px; font-size: 14px; color: #1565c0; }
    .rs-help-body h5 { margin: 14px 0 6px; font-size: 13px; color: #455a64; }
    .rs-help-body ol, .rs-help-body ul { margin: 6px 0 10px; padding-left: 24px; }
    .rs-help-body li { margin-bottom: 4px; }
    .rs-help-body code {
      background: #f6f8fa; padding: 1px 5px; border-radius: 3px;
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
    }
    .rs-help-body table {
      border-collapse: collapse; margin: 8px 0; font-size: 12px;
    }
    .rs-help-body th, .rs-help-body td {
      border: 1px solid #d0d7de; padding: 4px 8px; text-align: left;
    }
    .rs-help-body th { background: #f6f8fa; font-weight: 600; }
    .rs-help-body .muted { color: #6a737d; font-size: 11px; }
    .rs-help-body .note {
      background: #eef5ff; border-left: 3px solid #1976d2; padding: 8px 12px;
      margin: 10px 0; border-radius: 0 4px 4px 0; font-size: 12px;
    }
    .rs-help-body .warn {
      background: #fff8e1; border-left: 3px solid #f57c00; padding: 8px 12px;
      margin: 10px 0; border-radius: 0 4px 4px 0; font-size: 12px;
    }
  `;
  const st = document.createElement('style');
  st.id = 'rs-help-panel-styles';
  st.textContent = css;
  document.head.appendChild(st);
}

/**
 * Смонтировать floating-кнопку «?» и связанную модалку.
 * @param {object} opts
 * @param {string} opts.module   — идентификатор модуля
 * @param {string} opts.title    — заголовок модалки
 * @param {string} opts.usage    — HTML-контент вкладки «Как использовать»
 * @param {string} opts.calcs    — HTML-контент вкладки «Текущие расчёты»
 * @param {string} [opts.shortcuts] — опциональная 3-я вкладка «Горячие клавиши»
 * @returns {{ open: Function, close: Function, destroy: Function }}
 */
export function mountHelp(opts = {}) {
  _injectStyles();
  const fab = document.createElement('button');
  fab.className = 'rs-help-fab';
  fab.type = 'button';
  fab.title = 'Справка по модулю';
  fab.setAttribute('aria-label', 'Справка');
  fab.textContent = '?';
  document.body.appendChild(fab);

  let backdrop = null;
  let activeTab = 'usage';

  function open() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'rs-help-backdrop';
    backdrop.innerHTML = _modalHtml(opts, activeTab);
    document.body.appendChild(backdrop);
    // wire
    backdrop.querySelector('.rs-help-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelectorAll('.rs-help-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        backdrop.querySelectorAll('.rs-help-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
        backdrop.querySelector('.rs-help-body').innerHTML = _tabBody(opts, activeTab);
      });
    });
    // Escape to close
    const kh = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', kh); } };
    document.addEventListener('keydown', kh);
  }
  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
  }
  function destroy() {
    close();
    fab.remove();
  }
  fab.addEventListener('click', open);
  return { open, close, destroy };
}

function _modalHtml(opts, activeTab) {
  const hasShortcuts = !!opts.shortcuts;
  return `
    <div class="rs-help-modal">
      <div class="rs-help-header">
        <h3>📘 ${_esc(opts.title || 'Справка по модулю')}</h3>
        <button class="rs-help-close" type="button" aria-label="Закрыть">✕</button>
      </div>
      <div class="rs-help-tabs">
        <button class="rs-help-tab${activeTab === 'usage' ? ' active' : ''}" data-tab="usage" type="button">Как использовать</button>
        <button class="rs-help-tab${activeTab === 'calcs' ? ' active' : ''}" data-tab="calcs" type="button">Текущие расчёты</button>
        ${hasShortcuts ? `<button class="rs-help-tab${activeTab === 'shortcuts' ? ' active' : ''}" data-tab="shortcuts" type="button">Горячие клавиши</button>` : ''}
      </div>
      <div class="rs-help-body">${_tabBody(opts, activeTab)}</div>
    </div>
  `;
}

function _tabBody(opts, tab) {
  if (tab === 'usage') return opts.usage || '<p class="muted">Раздел «Как использовать» не заполнен.</p>';
  if (tab === 'calcs') return opts.calcs || '<p class="muted">Раздел «Текущие расчёты» не заполнен.</p>';
  if (tab === 'shortcuts') return opts.shortcuts || '<p class="muted">Горячие клавиши не назначены.</p>';
  return '';
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
