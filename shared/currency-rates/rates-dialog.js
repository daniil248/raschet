// =============================================================================
// shared/currency-rates/rates-dialog.js — UI справочника курсов валют
// =============================================================================
// Модальное окно: выбор источника курсов, даты, отображение таблицы курсов,
// кнопка обновления (force=true).
//
// Используется из любого модуля через open(): возвращает Promise<void>.

import { fetchRates, listSources, getActiveSourceId, setActiveSourceId, getCachedDates, clearCache } from './index.js';
import './sources/index.js';

const STYLE_ID = 'rates-dialog-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .rd-overlay {
      position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    }
    .rd-modal {
      background: #fff; border-radius: 8px; padding: 18px 22px; min-width: 480px; max-width: 720px;
      max-height: 86vh; overflow-y: auto;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18);
    }
    .rd-modal h3 { margin: 0 0 12px; color: #1e3a8a; font-size: 16px; }
    .rd-row { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; font-size: 12.5px; }
    .rd-row label { font-weight: 500; color: #374151; }
    .rd-row input[type=date], .rd-row select {
      padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 3px; font: inherit; font-size: 12.5px;
    }
    .rd-row button {
      padding: 5px 12px; border-radius: 3px; cursor: pointer;
      font-size: 12.5px; border: 1px solid transparent; font-weight: 500;
    }
    .rd-btn-primary { background: #1e40af; color: #fff; border-color: #1e40af; }
    .rd-btn-primary:hover { background: #1e3a8a; }
    .rd-btn-ghost { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
    .rd-btn-ghost:hover { background: #e5e7eb; }
    .rd-source-meta { color: #64748b; font-size: 11px; flex: 1; }
    .rd-status { padding: 8px 10px; border-radius: 4px; font-size: 12px; margin: 8px 0; }
    .rd-status-loading { background: #fef3c7; color: #92400e; }
    .rd-status-ok { background: #d1fae5; color: #065f46; }
    .rd-status-err { background: #fef2f2; color: #b91c1c; }
    .rd-rates-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
    .rd-rates-table th, .rd-rates-table td { padding: 5px 9px; border: 1px solid #e5e7eb; text-align: left; }
    .rd-rates-table th { background: #f3f4f6; font-weight: 600; }
    .rd-rates-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .rd-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
    .rd-cached-list { font-size: 11px; color: #64748b; margin-top: 4px; }
    .rd-cached-list a { color: #1e40af; cursor: pointer; margin-right: 6px; text-decoration: underline; }
  `;
  document.head.appendChild(s);
}

/**
 * Открыть модальное окно справочника курсов.
 * @returns {Promise<void>}
 */
export function open() {
  ensureStyle();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'rd-overlay';
    const modal = document.createElement('div');
    modal.className = 'rd-modal';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let activeSrcId = getActiveSourceId();
    let activeDate = new Date().toISOString().slice(0, 10);
    let lastRates = null;

    const close = () => { try { document.body.removeChild(overlay); } catch {} resolve(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const render = () => {
      const sources = listSources();
      const src = sources.find(s => s.id === activeSrcId) || sources[0];
      if (!src) {
        modal.innerHTML = `<h3>Курсы валют</h3><p>Источники не зарегистрированы.</p>`;
        return;
      }
      const cachedDates = getCachedDates(src.id);
      const sourceMeta = `<a href="${src.url}" target="_blank" rel="noopener" title="Открыть сайт источника в новой вкладке">${src.url}</a>`;

      modal.innerHTML = `
        <h3 title="Справочник валют с историческими курсами. Выберите источник, дату — получите таблицу курсов.">💱 Справочник валют</h3>

        <div class="rd-row">
          <label title="Источник курсов. Каждый источник публикует курсы относительно своей базовой валюты.">Источник:</label>
          <select id="rd-src" title="Доступные источники курсов валют (зарегистрированные плагины).">
            ${sources.map(s => `<option value="${s.id}"${s.id === src.id ? ' selected' : ''} title="${s.label} (база: ${s.base})">${s.label}</option>`).join('')}
          </select>
        </div>
        <div class="rd-row">
          <span class="rd-source-meta">База: <b>${src.base}</b> · ${sourceMeta}</span>
        </div>

        <div class="rd-row">
          <label title="Дата котировок. Курсы публикуются на рабочие дни; на выходных может вернуться курс предыдущей пятницы или ошибка.">Дата:</label>
          <input type="date" id="rd-date" value="${activeDate}" max="${new Date().toISOString().slice(0, 10)}" min="2000-01-01">
          <button class="rd-btn-primary" id="rd-fetch" title="Загрузить курсы на выбранную дату от выбранного источника. Результат кешируется в LocalStorage.">⤓ Загрузить</button>
          <button class="rd-btn-ghost" id="rd-refetch" title="Принудительно перезапросить (игнорировать кеш). Используйте если данные на дату обновились.">↻ Обновить</button>
        </div>

        ${cachedDates.length > 0 ? `<div class="rd-cached-list" title="Даты, для которых курсы уже сохранены локально.">Кешированные даты: ${cachedDates.slice(0, 12).map(d => `<a data-date="${d}">${d}</a>`).join('')}${cachedDates.length > 12 ? ' …' : ''}</div>` : ''}

        <div id="rd-status"></div>
        <div id="rd-table-wrap"></div>

        <div class="rd-actions">
          <button class="rd-btn-ghost" id="rd-clear-cache" title="Удалить весь кеш курсов из LocalStorage. Не затрагивает другие данные приложения.">🗑 Очистить кеш</button>
          <button class="rd-btn-ghost" id="rd-close" title="Закрыть окно. Активный источник сохранится для следующего открытия.">Закрыть</button>
        </div>
      `;

      // Wire
      modal.querySelector('#rd-src').addEventListener('change', (e) => {
        activeSrcId = e.target.value;
        setActiveSourceId(activeSrcId);
        lastRates = null;
        render();
      });
      modal.querySelector('#rd-date').addEventListener('change', (e) => {
        activeDate = e.target.value;
      });
      modal.querySelector('#rd-fetch').addEventListener('click', () => doFetch(false));
      modal.querySelector('#rd-refetch').addEventListener('click', () => doFetch(true));
      modal.querySelector('#rd-close').addEventListener('click', close);
      modal.querySelector('#rd-clear-cache').addEventListener('click', () => {
        if (confirm('Удалить весь кеш курсов из LocalStorage?')) {
          clearCache();
          render();
        }
      });
      modal.querySelectorAll('.rd-cached-list a[data-date]').forEach(a => {
        a.addEventListener('click', () => {
          activeDate = a.dataset.date;
          modal.querySelector('#rd-date').value = activeDate;
          doFetch(false);
        });
      });
    };

    const setStatus = (cls, text) => {
      const el = modal.querySelector('#rd-status');
      if (!el) return;
      el.className = `rd-status rd-status-${cls}`;
      el.textContent = text;
    };

    const doFetch = async (force) => {
      setStatus('loading', `⏳ Загрузка курсов на ${activeDate}…`);
      try {
        const result = await fetchRates(activeSrcId, activeDate, force);
        lastRates = result;
        setStatus('ok', `✓ Курсы на ${result.date} от «${listSources().find(s => s.id === activeSrcId)?.label}» (${result.cached ? 'из кеша' : 'свежие'}).`);
        renderTable(result);
      } catch (e) {
        setStatus('err', `✗ Ошибка: ${e.message}`);
      }
    };

    const renderTable = (result) => {
      const wrap = modal.querySelector('#rd-table-wrap');
      if (!result || !result.rates) { wrap.innerHTML = ''; return; }
      const codes = Object.keys(result.rates).sort();
      wrap.innerHTML = `<table class="rd-rates-table">
        <thead>
          <tr>
            <th title="Код валюты ISO 4217.">Валюта</th>
            <th class="num" title="Сколько единиц этой валюты в 1 единице базовой валюты (${result.base}).">1 ${result.base} = …</th>
            <th class="num" title="Сколько единиц базовой валюты в 1 единице этой валюты.">1 … = ${result.base}</th>
          </tr>
        </thead>
        <tbody>${codes.map(code => {
          const r = result.rates[code];
          const inv = r > 0 ? 1 / r : 0;
          const fmtR = r >= 1 ? r.toFixed(4) : r.toFixed(6);
          const fmtI = inv >= 1 ? inv.toFixed(4) : inv.toFixed(6);
          return `<tr><td title="ISO 4217 код">${code}</td><td class="num">${fmtR}</td><td class="num">${fmtI}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
    };

    render();
  });
}
