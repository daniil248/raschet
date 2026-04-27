// projects/projects.js — модуль «Проекты».
// MVP v0.59.222 (Фаза 1.27.0): список проектов + активный проект.
// Данные модулей (схема/СКС/шкафы) пока в общих LS-ключах, миграция в
// проектный неймспейс — в подфазах 1.27.1+ (см. shared/project-storage.js).

import {
  listProjects, createProject, updateProject, deleteProject, copyProject,
  getActiveProjectId, setActiveProjectId, ensureDefaultProject,
  exportProject, importProject,
} from '../shared/project-storage.js';
import { buildModuleHref, clearNavStack } from '../shared/project-context.js';
import { migrateOrphanSchemes } from '../shared/scheme-orphan-migration.js';

// v0.59.507: автоматическая миграция orphan-схем при первом заходе на
// /projects/. Schemes без projectId → привязываем к контейнеру с тем же
// именем (если есть) или создаём новый. Один раз через LS-флаг.
try {
  const r = migrateOrphanSchemes();
  if (r && (r.matched > 0 || r.created > 0)) {
    console.info(`[/projects/] orphan-migration: matched=${r.matched}, created=${r.created}`);
  }
} catch (e) { console.warn('[/projects/] scheme-orphan-migration failed:', e); }

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

// v0.59.559: prConfirm 3-й аргумент opts: { okLabel?, isHtml? }.
// isHtml=true → text вставляется как сырой HTML (для bold/br/счётчиков).
// По умолчанию (isHtml === undefined/false) — escapeHtml, как раньше.
function prConfirm(title, text, opts = {}) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    const okLabel = opts.okLabel || 'Подтвердить';
    const textHtml = opts.isHtml ? text : escapeHtml(text);
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${textHtml}</p>
        <div class="pr-modal-actions">
          <button type="button" class="pr-btn-sel" data-act="no">Отмена</button>
          <button type="button" class="pr-btn-danger" data-act="yes">${escapeHtml(okLabel)}</button>
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

function prStatusPicker(current) {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    const rows = STATUSES.map(s => `
      <button type="button" class="pr-status-row" data-id="${s.id}" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:1px solid ${s.id === current ? s.color : '#e2e8f0'};background:${s.id === current ? s.bg : '#fff'};border-radius:8px;cursor:pointer;margin-bottom:6px;text-align:left">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color}"></span>
        <b style="color:${s.color}">${s.label}</b>
        ${s.id === current ? '<span style="margin-left:auto;color:' + s.color + ';font-size:12px">✓ текущий</span>' : ''}
      </button>`).join('');
    overlay.innerHTML = `
      <div class="pr-modal" style="max-width:420px">
        <h3>Статус проекта</h3>
        <p class="muted" style="font-size:12px">Используется для визуальной сортировки. Статус «Архив» прячет проект из общего списка (можно вернуть через «Показать архивные»).</p>
        <div style="margin:10px 0">${rows}</div>
        <div class="pr-modal-actions"><button type="button" class="pr-btn-sel" data-act="no">Закрыть</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = v => { overlay.remove(); res(v); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) done(null);
      const row = e.target.closest('.pr-status-row');
      if (row) done(row.dataset.id);
      if (e.target.dataset?.act === 'no') done(null);
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

/* v0.59.344: на странице /projects/ выводим ТОЛЬКО список проектов
   (имя, описание, статус, статистика, метаданные, базовые действия).
   Чипы модулей перенесены в детальную карточку /projects/project.html,
   которая показывает только осмысленный для проекта набор: схемы, СКС,
   реестры оборудования, модульный ЦОД. «Штучные» конфигураторы (cable,
   ИБП, РУ СН, щит, PDU, трансформатор, АГПТ, конфигуратор стойки) с
   проекта не запускаются — они вызываются из других модулей по контексту
   или с hub.html для разовых расчётов. */

/* ---------- Статусы проекта (Фаза 1.27.5) ---------- */
const STATUSES = [
  { id: 'draft',     label: 'Черновик',        color: '#64748b', bg: '#e2e8f0' },
  { id: 'planned',   label: 'Проектируется',   color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'installed', label: 'Смонтирован',     color: '#b45309', bg: '#fef3c7' },
  { id: 'operating', label: 'Эксплуатируется', color: '#047857', bg: '#d1fae5' },
  { id: 'archived',  label: 'Архив',           color: '#475569', bg: '#f1f5f9' },
];
function statusMeta(id) { return STATUSES.find(s => s.id === id) || STATUSES[0]; }
let showArchived = false;

/* ---------- Счётчики содержимого проекта (Фаза 1.27.6) ---------- */
// Читаем project-scoped LS-ключи и считаем: узлов в схеме, стоек в scs-config,
// связей в scs-design, позиций в реестрах. Показываем бейджами в карточке —
// чтобы сразу видно было, какой проект реально наполнен.
function projectStats(pid) {
  const s = { nodes: 0, racks: 0, links: 0, inventory: 0, facility: 0 };
  try {
    const sch = localStorage.getItem(`raschet.project.${pid}.engine.scheme.v1`);
    if (sch) {
      try { s.nodes = (JSON.parse(sch).nodes || []).length; } catch {}
    }
  } catch {}
  try {
    // Шаблоны стоек (rack-config.templates.v1) хранятся глобально. Per-project
    // «стойками проекта» считаем те, у которых в scs-config.contents.v1
    // этого проекта есть хоть одно устройство или в racktags — тег.
    const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
    const tags = localStorage.getItem(`raschet.project.${pid}.scs-config.rackTags.v1`);
    const ids = new Set();
    try {
      const obj = cont ? JSON.parse(cont) : {};
      Object.keys(obj || {}).forEach(k => { if (Array.isArray(obj[k]) && obj[k].length) ids.add(k); });
    } catch {}
    try {
      const obj = tags ? JSON.parse(tags) : {};
      Object.keys(obj || {}).forEach(k => { if ((obj[k] || '').trim()) ids.add(k); });
    } catch {}
    s.racks = ids.size;
  } catch {}
  try {
    const ln = localStorage.getItem(`raschet.project.${pid}.scs-design.links.v1`);
    if (ln) {
      try { s.links = (JSON.parse(ln) || []).length; } catch {}
    }
  } catch {}
  try {
    // IT-оборудование = устройства из contents.v1, просуммированные по всем стойкам.
    const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
    if (cont) {
      try {
        const obj = JSON.parse(cont) || {};
        s.inventory = Object.values(obj).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
      } catch {}
    }
  } catch {}
  try {
    const f = localStorage.getItem(`raschet.project.${pid}.facility-inventory.v1`);
    if (f) {
      try {
        const obj = JSON.parse(f);
        if (Array.isArray(obj)) s.facility = obj.length;
        else if (obj && Array.isArray(obj.items)) s.facility = obj.items.length;
      } catch {}
    }
  } catch {}
  return s;
}
function statsBadges(s) {
  const items = [
    { n: s.nodes,     lbl: 'узл. в схеме',      title: 'Узлов в схеме электроснабжения',   icon: '⚡' },
    { n: s.racks,     lbl: 'стоек',             title: 'Стоек в проекте (scs-config)',     icon: '🗄' },
    { n: s.links,     lbl: 'связей',            title: 'Меж-шкафных связей (scs-design)',  icon: '🔗' },
    { n: s.inventory, lbl: 'IT-устройств',      title: 'Устройств в шкафах (все стойки)',  icon: '📋' },
    { n: s.facility,  lbl: 'поз. объекта',      title: 'Позиций в реестре оборудования объекта', icon: '🏭' },
  ].filter(x => x.n > 0);
  if (!items.length) return '<span class="muted" style="font-size:11px">· пусто</span>';
  return items.map(x =>
    `<span style="display:inline-flex;align-items:center;gap:3px;background:#f1f5f9;color:#334155;padding:1px 7px;border-radius:10px;font-size:11px" title="${escapeHtml(x.title)}">${x.icon} <b>${x.n}</b> <span class="muted">${x.lbl}</span></span>`
  ).join(' ');
}

/* ---------- Рендер ---------- */
function render() {
  const host = document.getElementById('pr-list');
  if (!host) return;
  // v0.59.236: мини-проекты (kind='sketch') создаются из мастеров конкретных
  // модулей (scs-design и т.п.) и живут только в их dropdown'ах. В общий
  // список /projects/ они не попадают — это центр настоящих проектов.
  //
  // v0.59.506: Storage-схемы (созданные через window.Storage.createProject —
  // id начинается с 'lp_', есть поле scheme/memberUids) делят с project-
  // контейнерами (p_*/s_*) одну LS-таблицу raschet.projects.v1. Их НЕ
  // показываем в общем списке — они должны быть видны ТОЛЬКО внутри своих
  // родительских project-контейнеров (через Карточку проекта → Схемы).
  // Раньше схема, созданная через «+ Добавить → Схема» внутри проекта,
  // лишний раз появлялась как отдельный проект на верхнем уровне.
  let projects = listProjects().filter(p => {
    if ((p.kind || 'full') === 'sketch') return false;
    // Storage-схемы: id 'lp_*' или наличие поля scheme/memberUids/ownerId.
    if (typeof p.id === 'string' && p.id.startsWith('lp_')) return false;
    if ('scheme' in p || 'memberUids' in p) return false;
    return true;
  });
  const activeId = getActiveProjectId();

  // v0.59.238: фильтр архивных.
  const totalArchived = projects.filter(p => p.status === 'archived').length;
  if (!showArchived) projects = projects.filter(p => p.status !== 'archived');
  const filterHost = document.getElementById('pr-status-filter');
  if (filterHost) {
    filterHost.innerHTML = `
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#64748b;cursor:pointer">
        <input type="checkbox" id="pr-show-archived" ${showArchived ? 'checked' : ''}>
        Показать архивные ${totalArchived ? `<span style="background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:10px;font-size:11px">${totalArchived}</span>` : ''}
      </label>`;
    filterHost.querySelector('#pr-show-archived')?.addEventListener('change', e => {
      showArchived = !!e.target.checked;
      render();
    });
  }

  if (!projects.length) {
    host.innerHTML = `<div class="pr-empty">Пока нет ни одного проекта. Нажмите «＋ Новый проект», чтобы создать первый.</div>`;
    renderSketches();
    return;
  }

  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  host.innerHTML = projects.map(p => {
    const isActive = p.id === activeId;
    const st = statusMeta(p.status || 'draft');
    const statusBadge = `<span class="pr-badge-status" style="background:${st.bg};color:${st.color};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600" title="Кликните «Статус ▾» чтобы сменить">${escapeHtml(st.label)}</span>`;
    return `
    <div class="pr-project ${isActive ? 'active' : ''}" data-id="${escapeHtml(p.id)}" data-status="${escapeHtml(p.status || 'draft')}"${p.status === 'archived' ? ' style="opacity:.7"' : ''}>
      <div class="pr-project-head">
        <div class="pr-project-title">
          <span class="pr-project-name">${escapeHtml(p.name || '(без имени)')}</span>
          ${isActive ? '<span class="pr-badge-active">активен</span>' : ''}
          ${statusBadge}
        </div>
        <div class="pr-project-actions">
          <a href="project.html?project=${escapeHtml(p.id)}" class="pr-btn-primary" data-act="open" title="Перейти к карточке проекта (схемы, реестры, СКС, ЦОД)">Открыть проект →</a>
          ${isActive ? '' : `<button type="button" class="pr-btn-sel" data-act="activate">Сделать активным</button>`}
          <button type="button" class="pr-btn-sel" data-act="status">Статус ▾</button>
          <button type="button" class="pr-btn-sel" data-act="rename">Переименовать</button>
          <button type="button" class="pr-btn-sel" data-act="export">Экспорт JSON</button>
          <button type="button" class="pr-btn-sel" data-act="copy" title="Создать копию проекта: метаданные + все scoped-данные (стойки, связи, инвентарь). Новые id для экземпляров стоек.">📄 Копировать</button>
          <button type="button" class="pr-btn-danger" data-act="delete">Удалить</button>
        </div>
      </div>
      ${p.description ? `<div class="pr-project-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="pr-project-stats" style="margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center">${statsBadges(projectStats(p.id))}</div>
      <div class="pr-project-meta muted">
        <span>Создан: ${fmtDate(p.createdAt)}</span>
        <span>· Изменён: ${fmtDate(p.updatedAt)}</span>
        <span>· ID: <code>${escapeHtml(p.id)}</code></span>
      </div>
    </div>`;
  }).join('');

  // v0.59.344: «Открыть проект» — корневой переход, очищаем back-stack.
  host.querySelectorAll('[data-act="open"]').forEach(a => {
    a.addEventListener('click', () => { try { clearNavStack(); } catch {} });
  });

  host.querySelectorAll('.pr-project').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="activate"]')?.addEventListener('click', () => {
      setActiveProjectId(id);
      prToast('✔ Проект сделан активным');
      render();
    });
    el.querySelector('[data-act="status"]')?.addEventListener('click', async () => {
      const p = listProjects().find(x => x.id === id); if (!p) return;
      const next = await prStatusPicker(p.status || 'draft');
      if (next == null || next === p.status) return;
      updateProject(id, { status: next });
      prToast('✔ Статус: ' + statusMeta(next).label);
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
    // v0.59.344: import/apply-scheme перенесены в детальную карточку
    // /projects/project.html — на странице списка их быть не должно.
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
    el.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
      const p = listProjects().find(x => x.id === id); if (!p) return;
      const ok = await prConfirm(
        `Создать копию проекта «${p.name}»?`,
        'Скопируются метаданные и все проектные данные (стойки, связи, инвентарь, схема). Экземплярам стоек присваиваются новые inst-* id, ссылки внутри проекта переписываются автоматически. Глобальные данные (шаблоны корпусов, каталог IT-типов) — общие.'
      );
      if (!ok) return;
      const copy = copyProject(id);
      if (!copy) { prToast('⚠ Копирование не удалось', 'err'); return; }
      prToast(`✔ Создана копия «${copy.name}»`);
      render();
    });
    el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      const p = listProjects().find(x => x.id === id); if (!p) return;
      const s = projectStats(p.id);
      const total = s.nodes + s.racks + s.links + s.inventory + s.facility;
      const tail = total
        ? `\n\nБудут стёрты project-scoped данные: ⚡${s.nodes} узл · 🗄${s.racks} стоек · 🔗${s.links} связей · 📋${s.inventory} IT · 🏭${s.facility} поз. объекта. Действие необратимо.`
        : '\n\n(в проекте нет данных — удаление безопасно)';
      const ok = await prConfirm(
        `Удалить проект «${p.name}»?`,
        'Удалятся метаданные проекта И все его scoped-данные (raschet.project.' + p.id + '.*).' + tail
      );
      if (!ok) return;
      const { removedKeys } = deleteProject(id);
      prToast(`✔ Удалено${removedKeys ? ' (стёрто ' + removedKeys + ' ключей LS)' : ''}`);
      render();
    });
  });

  renderSketches();
}

// v0.59.243: аудит-панель мини-проектов. Sketches живут в dropdown'ах
// своих модулей и не мешаются в основном списке, но они всё ещё занимают
// место в LS — если пользователь создал много черновиков и забросил,
// они могут захламлять. Панель показывает их сгруппированными по
// ownerModule, со статистикой и кнопкой «Удалить» (каскадно).
function renderSketches() {
  const host = document.getElementById('pr-sketches');
  if (!host) return;
  const sketches = listProjects().filter(p => p.kind === 'sketch');
  if (!sketches.length) { host.innerHTML = ''; return; }

  // группировка по ownerModule
  const byOwner = {};
  for (const s of sketches) {
    const k = s.ownerModule || '(без модуля)';
    (byOwner[k] ||= []).push(s);
  }
  const ownerLabel = m => ({
    'scs-design': 'Проектирование СКС',
    'scs-config': 'Компоновщик шкафов',
    'rack-config': 'Конфигуратор стойки',
    'mv-config':  'Конфигуратор РУ СН',
    'mdc-config': 'Конфигуратор МЦОД',
  }[m] || m);
  // v0.59.531: ссылка «▶ Открыть» — открывает мини-проект в его модуле,
  // активируя его как контекст. Ранее у sketches не было входа из /projects/,
  // и пользователь, создавший мини-проект СКС в scs-design, терял его, если
  // переключал scs-design в полноценный проект (мини оставался в LS, но
  // dropdown-ы модулей его не показывали).
  const ownerHref = m => ({
    'scs-design': '../scs-design/',
    'scs-config': '../scs-config/',
    'rack-config': '../rack-config/',
    'mv-config':  '../mv-config/',
    'mdc-config': '../mdc-config/',
  }[m] || '../');

  const totalN = sketches.length;
  host.innerHTML = `
    <details class="pr-sketches-panel" ${sketchesOpen ? 'open' : ''} style="margin-top:24px;padding:10px 14px;background:#fafbfc;border:1px solid #e5e7eb;border-radius:8px">
      <summary style="cursor:pointer;font-weight:600;color:#475569;user-select:none">
        🧪 Мини-проекты (${totalN}) <span class="muted" style="font-weight:400;font-size:12px">— черновики мастеров, живут в своих модулях</span>
      </summary>
      <div style="margin-top:10px;color:#64748b;font-size:13px">
        Мини-проекты создаются внутри конкретного мастера (scs-design, mv-config и т.п.) для быстрых прикидок без создания полноценного проекта. Они видны только в dropdown'е своего модуля. Здесь — аудит на случай, если черновики накопились.
      </div>
      ${Object.entries(byOwner).map(([owner, items]) => `
        <div style="margin-top:12px">
          <div style="font-weight:600;color:#334155;font-size:13px;margin-bottom:6px">${escapeHtml(ownerLabel(owner))} <span class="muted" style="font-weight:400">· ${items.length}</span></div>
          ${items.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(s => {
            const st = projectStats(s.id);
            const total = st.nodes + st.racks + st.links + st.inventory + st.facility;
            return `
            <div class="pr-sketch-row" data-id="${escapeHtml(s.id)}" style="display:flex;align-items:center;gap:10px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.name || '(без имени)')}</span>
              <span class="muted" style="font-size:11px">${total ? statsBadges(st) : '<i>пусто</i>'}</span>
              <span class="muted" style="font-size:11px;white-space:nowrap">${fmtDate(s.updatedAt)}</span>
              <a class="pr-btn-sel" data-act="open-sketch" data-owner="${escapeHtml(s.ownerModule || '')}" href="${escapeHtml(buildModuleHref(ownerHref(s.ownerModule), { projectId: s.id, fromModule: 'projects' }))}" style="font-size:12px;padding:3px 10px;text-decoration:none" title="Открыть мини-проект в модуле, который его создал, и сделать его активным контекстом">▶ Открыть</a>
              <button type="button" class="pr-btn-sel" data-act="copy-sketch" style="font-size:12px;padding:3px 8px" title="Копия мини-проекта с новыми id экземпляров стоек">📄 Копия</button>
              <button type="button" class="pr-btn-danger" data-act="del-sketch" style="font-size:12px;padding:3px 8px">Удалить</button>
            </div>`;
          }).join('')}
        </div>
      `).join('')}
    </details>`;

  host.querySelector('.pr-sketches-panel')?.addEventListener('toggle', e => {
    sketchesOpen = !!e.target.open;
  });
  host.querySelectorAll('[data-act="open-sketch"]').forEach(a => {
    a.addEventListener('click', () => {
      // setActiveProjectId — для модулей, которые читают getActiveProjectId()
      // (а не только URL ?project=). location перейдёт ссылкой <a>.
      const row = a.closest('.pr-sketch-row');
      const id = row?.dataset.id; if (id) setActiveProjectId(id);
    });
  });
  host.querySelectorAll('[data-act="copy-sketch"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.pr-sketch-row');
      const id = row?.dataset.id; if (!id) return;
      const s = listProjects().find(x => x.id === id); if (!s) return;
      const copy = copyProject(id);
      if (!copy) { prToast('⚠ Копирование не удалось', 'err'); return; }
      prToast(`✔ Создана копия «${copy.name}»`);
      render();
    });
  });
  host.querySelectorAll('[data-act="del-sketch"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.pr-sketch-row');
      const id = row?.dataset.id; if (!id) return;
      const s = listProjects().find(x => x.id === id); if (!s) return;
      // v0.59.559: показать конкретно, что будет удалено — пользователь
      // должен видеть, есть ли в мини-проекте реальные данные. Раньше
      // была общая фраза «удалятся scoped-данные», без конкретики, что
      // могло привести к случайной потере 35 связей или плана зала.
      const st = projectStats(id);
      const total = st.nodes + st.racks + st.links + st.inventory + st.facility;
      const detailParts = [];
      if (st.nodes)     detailParts.push(`${st.nodes} узлов схемы`);
      if (st.racks)     detailParts.push(`${st.racks} стоек`);
      if (st.links)     detailParts.push(`${st.links} связей СКС`);
      if (st.inventory) detailParts.push(`${st.inventory} устройств`);
      if (st.facility)  detailParts.push(`${st.facility} позиций реестра`);
      const dataDescr = total
        ? `<b style="color:#b91c1c">Будет удалено: ${detailParts.join(', ')}.</b><br>Действие необратимо!`
        : 'Мини-проект пуст — удаление безопасно.';
      const ok = await prConfirm(
        `Удалить мини-проект «${s.name}»?`,
        dataDescr,
        { okLabel: total ? 'Удалить (и потерять данные)' : 'Удалить', isHtml: true }
      );
      if (!ok) return;
      const { removedKeys } = deleteProject(id);
      prToast(`✔ Мини-проект удалён${removedKeys ? ' (стёрто ' + removedKeys + ' ключей LS)' : ''}`);
      render();
    });
  });
}

let sketchesOpen = false;

function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------- init ---------- */
// v0.59.527: Auth.init на module-load + надёжный _initAfterDom (как в project.js).
console.info('[projects.js] module loaded, document.readyState=', document.readyState);
try {
  if (window.Auth && typeof window.Auth.init === 'function') {
    console.info('[projects.js] calling window.Auth.init()');
    window.Auth.init();
  }
} catch (e) { console.warn('[projects.js] Auth.init failed:', e); }

function _initAfterDom() {
  ensureDefaultProject();
  render();

  // Re-render при изменении auth-state (Storage переключится в cloud).
  try {
    if (window.Auth && typeof window.Auth.onAuthChange === 'function') {
      window.Auth.onAuthChange(() => {
        try { render(); } catch (e) { console.warn('[projects.js] re-render on auth-change failed:', e); }
      });
    }
  } catch {}

  document.getElementById('pr-new')?.addEventListener('click', async () => {
    const name = await prPrompt('Новый проект', 'Название проекта', '', 'напр. «ЦОД Альфа-1, Тверь»');
    if (!name) return;
    const desc = await prPrompt('Описание', 'Клиент / адрес / контакты (можно оставить пустым)', '');
    const p = createProject({ name, description: desc || '' });
    setActiveProjectId(p.id);
    prToast('✔ Проект создан и сделан активным');
    render();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAfterDom);
} else {
  _initAfterDom();
}
