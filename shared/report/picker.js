// ======================================================================
// shared/report/picker.js
// Универсальное модальное окно выбора шаблона отчёта из каталога
// (shared/report-catalog.js). Используется подпрограммами при экспорте
// отчёта, чтобы не писать собственный UI выбора.
//
//   import { pickTemplate } from '../shared/report/picker.js';
//
//   const rec = await pickTemplate({
//     title: 'Экспорт отчёта по расчёту',
//     tags:  ['кабель','расчёты','общее'],  // опционально — фильтр по тегам
//   });
//   if (!rec) return;   // пользователь отменил
//   const tpl = Report.createTemplate(rec.template);
//   tpl.content = buildMyReportBlocks(data);
//   await Report.exportPDF(tpl, rec.name);
// ======================================================================

import { listTemplates } from '../report-catalog.js';

let _cssInjected = false;
function ensureCss() {
  if (_cssInjected) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = new URL('./editor.css', import.meta.url).href;
  document.head.appendChild(link);
  _cssInjected = true;
}

/**
 * Открыть picker шаблонов. Возвращает Promise, который резолвится
 * выбранной записью (с id, name, description, tags, template) или
 * null, если пользователь отменил выбор.
 *
 * opts:
 *   title     — заголовок модалки (по умолчанию «Выберите шаблон отчёта»)
 *   tags      — массив тегов для фильтрации. Если задан, в списке будут
 *               только шаблоны, у которых хотя бы один тег совпадает.
 *               Если после фильтра список пуст — показываются все.
 *   defaultId — id шаблона, который будет выделен по умолчанию
 */
export function pickTemplate(opts = {}) {
  return new Promise((resolve) => {
    ensureCss();
    const all = listTemplates();
    const tags = Array.isArray(opts.tags) ? opts.tags : null;

    // В picker показываем ВСЕГДА все шаблоны — чтобы пользователь мог
    // выбрать любой, даже если его теги не совпадают с ожиданием
    // подпрограммы. Шаблоны, теги которых пересекаются с opts.tags,
    // помечаются как рекомендованные и идут первыми в списке.
    const isRecommended = (t) => {
      if (!tags || !tags.length) return false;
      return tags.some(tg => (t.tags || []).includes(tg));
    };
    const filtered = [
      ...all.filter(isRecommended),
      ...all.filter(t => !isRecommended(t)),
    ];

    const backdrop = el('div', 'rpt-modal-backdrop');
    const modal = el('div', 'rpt-picker-modal');
    backdrop.appendChild(modal);

    const hdr = el('div', 'rpt-picker-hdr');
    const title = el('div', 'rpt-picker-title');
    title.textContent = opts.title || 'Выберите шаблон отчёта';
    hdr.appendChild(title);
    const closeBtn = el('button', 'rpt-picker-close');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    hdr.appendChild(closeBtn);
    modal.appendChild(hdr);

    const body = el('div', 'rpt-picker-body');
    modal.appendChild(body);

    const footer = el('div', 'rpt-picker-footer');
    const link = document.createElement('a');
    link.href = resolveCatalogHref();
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'rpt-picker-link';
    link.textContent = 'Открыть каталог шаблонов ↗';
    footer.appendChild(link);
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn';
    btnCancel.textContent = 'Отмена';
    footer.appendChild(btnCancel);
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'btn primary';
    btnOk.textContent = 'Выбрать';
    btnOk.disabled = true;
    footer.appendChild(btnOk);
    modal.appendChild(footer);

    document.body.appendChild(backdrop);

    let selectedId = opts.defaultId && filtered.some(t => t.id === opts.defaultId)
      ? opts.defaultId
      : (filtered[0] && filtered[0].id) || null;
    if (selectedId) btnOk.disabled = false;

    const renderList = () => {
      body.innerHTML = '';
      if (filtered.length === 0) {
        const empty = el('div', 'rpt-picker-empty');
        empty.textContent = 'Нет сохранённых шаблонов. Откройте «Шаблоны отчётов» и создайте первый.';
        body.appendChild(empty);
        return;
      }
      const recommendedCount = filtered.filter(isRecommended).length;
      // Заголовок секции «Рекомендованные для этой задачи», если есть
      if (recommendedCount > 0) {
        const sec = el('div', 'rpt-picker-section');
        sec.textContent = 'Рекомендованные для этой задачи';
        body.appendChild(sec);
      }
      filtered.forEach((t, idx) => {
        // Разделитель между рекомендованными и остальными
        if (recommendedCount > 0 && idx === recommendedCount) {
          const sec = el('div', 'rpt-picker-section');
          sec.textContent = 'Остальные шаблоны';
          body.appendChild(sec);
        }
        const item = el('div', 'rpt-picker-item');
        if (t.id === selectedId) item.classList.add('active');
        const name = el('div', 'rpt-picker-item__name');
        name.textContent = t.name;
        if (isRecommended(t)) {
          const rec = el('span', 'rpt-picker-item__badge recommended');
          rec.textContent = '✓ рекомендован';
          name.appendChild(rec);
        }
        const badge = el('span', 'rpt-picker-item__badge ' + (t.source === 'builtin' ? 'builtin' : 'user'));
        badge.textContent = t.source === 'builtin' ? 'Встроенный' : 'Мой';
        name.appendChild(badge);
        item.appendChild(name);
        if (t.description) {
          const d = el('div', 'rpt-picker-item__desc');
          d.textContent = t.description;
          item.appendChild(d);
        }
        item.addEventListener('click', () => {
          selectedId = t.id;
          btnOk.disabled = false;
          renderList();
        });
        item.addEventListener('dblclick', ok);
        body.appendChild(item);
      });
    };

    const finish = (val) => {
      backdrop.remove();
      resolve(val);
    };
    const ok = () => {
      const rec = filtered.find(t => t.id === selectedId);
      finish(rec || null);
    };
    closeBtn.addEventListener('click', () => finish(null));
    btnCancel.addEventListener('click', () => finish(null));
    btnOk.addEventListener('click', ok);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });

    renderList();
  });
}

// ——— утилиты ———

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** Возвращает относительный путь к странице каталога отчётов. Работает
 *  из любой подпрограммы, т.к. у нас фиксированная структура папок. */
function resolveCatalogHref() {
  try {
    // Этот модуль лежит в /shared/report/; каталог — в /reports/.
    // Берём URL модуля и откатываемся на 2 уровня выше.
    const base = new URL('../../reports/', import.meta.url);
    return base.href;
  } catch {
    return '../reports/';
  }
}
