// projects/projects.js — модуль «Проекты».
// MVP v0.59.222 (Фаза 1.27.0): список проектов + активный проект.
// Данные модулей (схема/СКС/шкафы) пока в общих LS-ключах, миграция в
// проектный неймспейс — в подфазах 1.27.1+ (см. shared/project-storage.js).

import {
  listProjects, createProject, updateProject, deleteProject,
  getActiveProjectId, setActiveProjectId, ensureDefaultProject,
  exportProject, importProject,
} from '../shared/project-storage.js';

/* ---------- inline modal / toast (без window.prompt/confirm/alert) ---------- */
function prToast(msg, kind = 'info') {
  const host = document.getElementById('pr-toast-host') || (() => {
    const h = document.createElement('div'); h.id = 'pr-toast-host'; document.body.appendChild(h); return h;
  })();
  const el = document.createElement('div');
  el.className = 'pr-toast pr-toast-' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('leave'), 2500);
  setTimeout(() => el.remove(), 3000);
}

function prConfirm(title, text) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(text)}</p>
        <div class="pr-modal-actions">
          <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="pr-btn-danger" data-act="yes">Подтвердить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.remove(); res(false); }
      const act = e.target.dataset?.act;
      if (act === 'yes') { overlay.remove(); res(true); }
      if (act === 'no')  { overlay.remove(); res(false); }
    });
  });
}

function prPrompt(title, label, initial = '', placeholder = '') {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${escapeHtml(title)}</h3>
        <label class="pr-modal-label">${escapeHtml(label)}</label>
        <input type="text" class="pr-modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(initial)}">
        <div class="pr-modal-actions">
          <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="pr-btn-primary" data-act="yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus(); input.select();
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      const act = e.target.dataset?.act;
      if (act === 'yes') done(input.value.trim() || null);
      if (act === 'no')  done(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Формат даты ---------- */
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- Ссылки на связанные модули ---------- */
const LINKED_MODULES = [
  { href: '../index.html',           label: '⚡ Конструктор схем' },
  { href: '../scs-design/',          label: '🔗 Проектирование СКС' },
  { href: '../scs-config/',          label: '🗄 Компоновщик шкафа' },
  { href: '../scs-config/inventory.html', label: '📦 Реестр IT-оборудования' },
  { href: '../facility-inventory/',  label: '🏭 Реестр оборудования объекта' },
];

/* ---------- Рендер ---------- */
function render() {
  const host = document.getElementById('pr-list');
  if (!host) return;
  const projects = listProjects();
  const activeId = getActiveProjectId();

  if (!projects.length) {
    host.innerHTML = `<div class="pr-empty">Пока нет ни одного проекта. Нажмите «＋ Новый проект», чтобы создать первый.</div>`;
    return;
  }

  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  host.innerHTML = projects.map(p => {
    const isActive = p.id === activeId;
    return `
    <div class="pr-project ${isActive ? 'active' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="pr-project-head">
        <div class="pr-project-title">
          <span class="pr-project-name">${escapeHtml(p.name || '(без имени)')}</span>
          ${isActive ? '<span class="pr-badge-active">активен</span>' : ''}
        </div>
        <div class="pr-project-actions">
          ${isActive ? '' : `<button type="button" class="pr-btn-sel" data-act="activate">Сделать активным</button>`}
          <button type="button" class="pr-btn-sel" data-act="rename">Переименовать</button>
          <button type="button" class="pr-btn-sel" data-act="import-scheme" title="Скопировать текущую глобальную схему Конструктора в этот проект">⬇ Взять глобальную схему</button>
          <button type="button" class="pr-btn-sel" data-act="apply-scheme" title="Применить схему проекта к главному Конструктору (перезапишет глобальную схему!)">⬆ Применить в Конструкторе</button>
          <button type="button" class="pr-btn-sel" data-act="export">Экспорт JSON</button>
          <button type="button" class="pr-btn-danger" data-act="delete">Удалить</button>
        </div>
      </div>
      ${p.description ? `<div class="pr-project-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="pr-project-meta muted">
        <span>Создан: ${fmtDate(p.createdAt)}</span>
        <span>· Изменён: ${fmtDate(p.updatedAt)}</span>
        <span>· ID: <code>${escapeHtml(p.id)}</code></span>
      </div>
      ${isActive ? `
      <div class="pr-project-links">
        ${LINKED_MODULES.map(m => `<a href="${m.href}" class="pr-link-chip">${m.label}</a>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  host.querySelectorAll('.pr-project').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="activate"]')?.addEventListener('click', () => {
      setActiveProjectId(id);
      prToast('✔ Проект сделан активным');
      render();
    });
    el.querySelector('[data-act="rename"]')?.addEventListener('click', async () => {
      const p = listProjects().find(x => x.id === id); if (!p) return;
      const name = await prPrompt('Переименовать проект', 'Новое имя', p.name || '');
      if (name == null) return;
      const desc = await prPrompt('Описание проекта', 'Адрес, клиент, контакты и т.п. (можно оставить пустым)', p.description || '');
      updateProject(id, { name, description: desc || '' });
      prToast('✔ Обновлено');
      render();
    });
    el.querySelector('[data-act="import-scheme"]')?.addEventListener('click', async () => {
      const raw = localStorage.getItem('raschet.scheme');
      if (!raw) { prToast('⚠ Глобальная схема Конструктора пуста', 'err'); return; }
      const ok = await prConfirm(
        'Взять глобальную схему в проект?',
        'В этот проект скопируется текущее содержимое главного Конструктора схем. Существующая схема проекта (если есть) будет перезаписана.'
      );
      if (!ok) return;
      localStorage.setItem(`raschet.project.${id}.engine.scheme.v1`, raw);
      updateProject(id, {});
      prToast('✔ Схема скопирована в проект');
      render();
    });
    el.querySelector('[data-act="apply-scheme"]')?.addEventListener('click', async () => {
      const key = `raschet.project.${id}.engine.scheme.v1`;
      const raw = localStorage.getItem(key);
      if (!raw) { prToast('⚠ В проекте нет схемы. Сначала «⬇ Взять глобальную схему»', 'err'); return; }
      const ok = await prConfirm(
        'Применить схему проекта в Конструкторе?',
        'Текущая глобальная схема Конструктора будет ПЕРЕЗАПИСАНА схемой этого проекта. Действие необратимо без backup — при необходимости сначала экспортируйте текущую глобальную схему через Конструктор.'
      );
      if (!ok) return;
      localStorage.setItem('raschet.scheme', raw);
      prToast('✔ Схема применена. Откройте Конструктор схем для проверки.');
    });
    el.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const blob = exportProject(id);
      if (!blob) { prToast('⚠ Проект не найден', 'err'); return; }
      const p = listProjects().find(x => x.id === id);
      const safe = (p?.name || id).replace(/[^\w\-]+/g, '_').slice(0, 40);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `project-${safe}-${dateStamp()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      prToast('✔ JSON сохранён');
    });
    el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      const p = listProjects().find(x => x.id === id); if (!p) return;
      const ok = await prConfirm(
        `Удалить проект «${p.name}»?`,
        'Метаданные проекта удалятся. Данные модулей, уже сохранённые в общих LS-ключах (схема, СКС, шкафы), не затрагиваются — они станут «бесхозными» до следующей фазы миграции (1.27.1+).'
      );
      if (!ok) return;
      deleteProject(id);
      prToast('✔ Удалено');
      render();
    });
  });
}

function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  ensureDefaultProject();
  render();
  document.getElementById('pr-new')?.addEventListener('click', async () => {
    const name = await prPrompt('Новый проект', 'Название проекта', '', 'напр. «ЦОД Альфа-1, Тверь»');
    if (!name) return;
    const desc = await prPrompt('Описание', 'Клиент / адрес / контакты (можно оставить пустым)', '');
    const p = createProject({ name, description: desc || '' });
    setActiveProjectId(p.id);
    prToast('✔ Проект создан и сделан активным');
    render();
  });
});
