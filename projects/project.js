// projects/project.js — детальная карточка одного проекта.
// v0.59.344+: отдельный экран с курируемым набором модулей. Запускается
// по ссылке project.html?project=<pid> с /projects/. Все ссылки на модули
// несут ?project=<pid>&from=projects (вернёт пользователя именно сюда).

import {
  listProjects, getProject, updateProject, deleteProject, copyProject,
  setActiveProjectId, exportProject,
  // v0.59.373: подпроекты — артефакты внутри родителя (схемы, СКС, шкафы).
  listSubProjects, createSubProject,
} from '../shared/project-storage.js';
import { buildModuleHref, clearNavStack } from '../shared/project-context.js';

/* ---------- inline modal / toast ---------- */
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
        <h3>${esc(title)}</h3>
        <p class="muted">${esc(text)}</p>
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
function prPrompt(title, label, initial = '') {
  return new Promise(res => {
    const overlay = document.createElement('div');
    overlay.className = 'pr-overlay';
    overlay.innerHTML = `
      <div class="pr-modal">
        <h3>${esc(title)}</h3>
        <label class="pr-modal-label">${esc(label)}</label>
        <input type="text" class="pr-modal-input" value="${esc(initial)}">
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
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- Курируемый набор модулей проекта ----------
   Только то, что имеет смысл В КОНТЕКСТЕ ПРОЕКТА:
   - Конструктор схем (универсальный — электрика, гидравлика, механика,
     СКС; со связью со всеми объектами проекта)
   - Проектирование СКС (меж-шкафные связи + план зала; также может быть
     встроен как блок внутрь Конструктора схем)
   - Компоновщик шкафа (содержимое экземпляров)
   - Реестр IT-оборудования (S/N, IP, MAC)
   - Реестр оборудования объекта (мебель, ЗИП)
   - Модульный ЦОД (если объект — МДЦ)

   НЕ показываем здесь: cable, mv-config, ups-config, panel-config,
   pdu-config, transformer-config, suppression-config, rack-config —
   они «штучные», запускаются с hub.html для разовых расчётов или
   из других модулей по контексту (например, кнопка «Расчёт кабеля»
   на узле схемы откроет cable с уже подставленными параметрами). */
const PROJECT_MODULES = [
  {
    id: 'schematic',
    href: '../index.html',
    icon: '⚡',
    label: 'Конструктор схем',
    desc: 'Любые схемы объекта: электрика, гидравлика, механика, СКС. Связан со всеми объектами проекта (стойки, шкафы, реестры).',
    color: '#1d4ed8',
  },
  {
    id: 'scs-design',
    href: '../scs-design/',
    icon: '🔗',
    label: 'Проектирование СКС',
    desc: 'Меж-шкафные связи, план зала, кабельный журнал. Может быть встроена в схему как блок.',
    color: '#0d9488',
  },
  {
    id: 'scs-config',
    href: '../scs-config/',
    icon: '🗄',
    label: 'Компоновщик шкафа',
    desc: 'Содержимое каждого экземпляра шкафа. Серверные стойки из схемы попадают сюда штучно с уникальным Tag.',
    color: '#7c3aed',
  },
  {
    id: 'scs-config-inventory',
    href: '../scs-config/inventory.html',
    icon: '📦',
    label: 'Реестр IT-оборудования',
    desc: 'S/N, IP, MAC, инвентарные номера серверов, свичей, патч-панелей.',
    color: '#0891b2',
  },
  {
    id: 'facility-inventory',
    href: '../facility-inventory/',
    icon: '🏭',
    label: 'Реестр оборудования объекта',
    desc: 'Не-IT имущество: мебель, стеллажи, ЗИП, КИПиА, инструмент.',
    color: '#b45309',
  },
  {
    id: 'mdc-config',
    href: '../mdc-config/',
    icon: '🏗',
    label: 'Модульный ЦОД',
    desc: 'Если объект — МДЦ (GDM-600): wizard зон, расстановка стоек/ИБП/кондёров, top-view.',
    color: '#be185d',
  },
];

/* ---------- Статусы ---------- */
const STATUSES = [
  { id: 'draft',     label: 'Черновик',        color: '#64748b', bg: '#e2e8f0' },
  { id: 'planned',   label: 'Проектируется',   color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'installed', label: 'Смонтирован',     color: '#b45309', bg: '#fef3c7' },
  { id: 'operating', label: 'Эксплуатируется', color: '#047857', bg: '#d1fae5' },
  { id: 'archived',  label: 'Архив',           color: '#475569', bg: '#f1f5f9' },
];
function statusMeta(id) { return STATUSES.find(s => s.id === id) || STATUSES[0]; }

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

/* ---------- Статистика проекта ---------- */
function projectStats(pid) {
  const s = { nodes: 0, racks: 0, links: 0, inventory: 0, facility: 0 };
  try {
    const sch = localStorage.getItem(`raschet.project.${pid}.engine.scheme.v1`);
    if (sch) { try { s.nodes = (JSON.parse(sch).nodes || []).length; } catch {} }
  } catch {}
  try {
    const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
    const tags = localStorage.getItem(`raschet.project.${pid}.scs-config.rackTags.v1`);
    const ids = new Set();
    try { const o = cont ? JSON.parse(cont) : {}; Object.keys(o || {}).forEach(k => { if (Array.isArray(o[k]) && o[k].length) ids.add(k); }); } catch {}
    try { const o = tags ? JSON.parse(tags) : {}; Object.keys(o || {}).forEach(k => { if ((o[k] || '').trim()) ids.add(k); }); } catch {}
    s.racks = ids.size;
  } catch {}
  try {
    const ln = localStorage.getItem(`raschet.project.${pid}.scs-design.links.v1`);
    if (ln) { try { s.links = (JSON.parse(ln) || []).length; } catch {} }
  } catch {}
  try {
    const cont = localStorage.getItem(`raschet.project.${pid}.scs-config.contents.v1`);
    if (cont) { try { const o = JSON.parse(cont) || {}; s.inventory = Object.values(o).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0); } catch {} }
  } catch {}
  try {
    const f = localStorage.getItem(`raschet.project.${pid}.facility-inventory.v1`);
    if (f) {
      try {
        const o = JSON.parse(f);
        if (Array.isArray(o)) s.facility = o.length;
        else if (o && Array.isArray(o.items)) s.facility = o.items.length;
      } catch {}
    }
  } catch {}
  return s;
}

/* ---------- Получаем pid из URL ---------- */
function getPid() {
  try { return new URLSearchParams(location.search).get('project') || null; }
  catch { return null; }
}

/* ---------- Rendering ---------- */
function render() {
  const pid = getPid();
  const p = pid ? getProject(pid) : null;

  const headHost = document.getElementById('pr-detail-head');
  const modulesHost = document.getElementById('pr-detail-modules');
  const actionsHost = document.getElementById('pr-detail-actions');
  const metaHost = document.getElementById('pr-detail-meta');

  if (!p) {
    if (headHost) headHost.innerHTML = `
      <div class="pr-empty">
        Проект не найден. <a href="./">← назад к списку проектов</a>
      </div>`;
    if (modulesHost) modulesHost.innerHTML = '';
    if (actionsHost) actionsHost.innerHTML = '';
    if (metaHost) metaHost.innerHTML = '';
    return;
  }

  const st = statusMeta(p.status || 'draft');
  const s = projectStats(p.id);

  if (headHost) {
    headHost.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h1 style="margin:0;font-size:24px">${esc(p.name || '(без имени)')}</h1>
            <span class="pr-badge-status" style="background:${st.bg};color:${st.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${esc(st.label)}</span>
            ${p.kind === 'sketch' ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">🧪 Мини-проект</span>' : ''}
          </div>
          ${p.description ? `<p style="margin:10px 0 0;color:#475569">${esc(p.description)}</p>` : '<p class="muted" style="margin:10px 0 0;font-style:italic">Описание не задано</p>'}
        </div>
        <div>
          <a href="./" class="pr-btn-sel">← к списку проектов</a>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:6px">
        ${badgeChip('⚡', s.nodes,     'узлов в схеме',           '#dbeafe', '#1d4ed8')}
        ${badgeChip('🗄', s.racks,     'стоек',                   '#ede9fe', '#7c3aed')}
        ${badgeChip('🔗', s.links,     'СКС-связей',              '#cffafe', '#0e7490')}
        ${badgeChip('📦', s.inventory, 'IT-устройств',            '#e0f2fe', '#0369a1')}
        ${badgeChip('🏭', s.facility,  'позиций объекта',         '#fef3c7', '#a16207')}
      </div>`;
  }

  if (modulesHost) {
    // v0.59.373: вместо плоских плашек конфигураторов — модель «артефактов»
    // внутри проекта. Кнопка «+ Добавить» создаёт подпроект (sketch с
    // parentProjectId) нужного типа: схема / СКС / шкаф. Реестры (IT и
    // объект) — singleton'ы проекта, выводятся отдельными кнопками.
    const subSchemes  = listSubProjects(p.id, 'schematic');
    const subScs      = listSubProjects(p.id, 'scs-design');
    const subRacks    = listSubProjects(p.id, 'scs-config');
    const subMdc      = listSubProjects(p.id, 'mdc-config');

    const renderSubList = (subs, modHref, icon, emptyHint) => {
      if (!subs.length) return `<div class="muted" style="font-size:12px;padding:6px 0">${emptyHint}</div>`;
      return subs.map(sp => {
        const href = buildModuleHref(modHref, { projectId: sp.id, fromModule: 'projects' });
        const desig = sp.designation ? `<span style="background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-right:6px">${esc(sp.designation)}</span>` : '';
        return `
        <div class="pr-sub-row" data-sub-id="${esc(sp.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
          <span style="font-size:16px">${icon}</span>
          ${desig}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sp.name || '(без имени)')}</span>
          <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px">Открыть →</a>
          <button type="button" class="pr-btn-sel" data-act="rename-sub" style="font-size:12px;padding:3px 8px">✎</button>
          <button type="button" class="pr-btn-danger" data-act="delete-sub" style="font-size:12px;padding:3px 8px">✕</button>
        </div>`;
      }).join('');
    };

    modulesHost.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <div style="position:relative">
          <button type="button" class="pr-btn-primary" id="pr-add-btn">＋ Добавить ▾</button>
          <div id="pr-add-menu" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:10;min-width:240px">
            <button type="button" data-add="schematic" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-size:13px">⚡ Добавить схему</button>
            <button type="button" data-add="scs-design" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-size:13px;border-top:1px solid #f1f5f9">🔗 Добавить СКС-проект</button>
            <button type="button" data-add="scs-config" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-size:13px;border-top:1px solid #f1f5f9">🗄 Добавить шкаф (компоновка)</button>
            <button type="button" data-add="mdc-config" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-size:13px;border-top:1px solid #f1f5f9">🏗 Добавить модульный ЦОД</button>
          </div>
        </div>
        <a href="${esc(buildModuleHref('../scs-config/inventory.html', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel pr-mod-card" style="text-decoration:none">📦 Реестр IT-оборудования</a>
        <a href="${esc(buildModuleHref('../facility-inventory/', { projectId: p.id, fromModule: 'projects' }))}" class="pr-btn-sel pr-mod-card" style="text-decoration:none">🏭 Реестр оборудования объекта</a>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
        <div class="pr-art-group" data-kind="schematic" style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-weight:600;font-size:13px;color:#1d4ed8;margin-bottom:8px">⚡ Схемы <span class="muted" style="font-weight:400">· ${subSchemes.length}</span></div>
          ${renderSubList(subSchemes, '../index.html', '⚡', 'Схем нет — нажмите «+ Добавить → схему».')}
        </div>
        <div class="pr-art-group" data-kind="scs-design" style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-weight:600;font-size:13px;color:#0d9488;margin-bottom:8px">🔗 СКС-проекты <span class="muted" style="font-weight:400">· ${subScs.length}</span></div>
          ${renderSubList(subScs, '../scs-design/', '🔗', 'СКС-проектов нет — нажмите «+ Добавить → СКС».')}
        </div>
        <div class="pr-art-group" data-kind="scs-config" style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-weight:600;font-size:13px;color:#7c3aed;margin-bottom:8px">🗄 Компоновки шкафов <span class="muted" style="font-weight:400">· ${subRacks.length}</span></div>
          ${renderSubList(subRacks, '../scs-config/', '🗄', 'Компоновок нет — нажмите «+ Добавить → шкаф».')}
        </div>
        ${subMdc.length ? `<div class="pr-art-group" data-kind="mdc-config" style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-weight:600;font-size:13px;color:#be185d;margin-bottom:8px">🏗 Модульные ЦОД <span class="muted" style="font-weight:400">· ${subMdc.length}</span></div>
          ${renderSubList(subMdc, '../mdc-config/', '🏗', '')}
        </div>` : ''}
      </div>`;

    // — меню «+ Добавить ▾»
    const addBtn = modulesHost.querySelector('#pr-add-btn');
    const addMenu = modulesHost.querySelector('#pr-add-menu');
    addBtn?.addEventListener('click', e => {
      e.stopPropagation();
      addMenu.style.display = addMenu.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => { if (addMenu) addMenu.style.display = 'none'; });
    const addOpts = {
      'schematic':  { label: 'схема',         href: '../index.html',     defaultDesig: 'Схема-1', defaultName: 'Схема' },
      'scs-design': { label: 'СКС-проект',    href: '../scs-design/',    defaultDesig: 'СКС-1',   defaultName: 'СКС-проект' },
      'scs-config': { label: 'шкаф',          href: '../scs-config/',    defaultDesig: 'Ш-1',     defaultName: 'Компоновка шкафа' },
      'mdc-config': { label: 'модульный ЦОД', href: '../mdc-config/',    defaultDesig: 'МЦОД-1',  defaultName: 'Модульный ЦОД' },
    };
    modulesHost.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        addMenu.style.display = 'none';
        const moduleId = btn.dataset.add;
        const opt = addOpts[moduleId];
        if (!opt) return;
        const name = await prPrompt(`Добавить ${opt.label}`, 'Имя', opt.defaultName);
        if (name == null) return;
        const designation = await prPrompt('Обозначение', `Короткий код в рамках проекта (напр. ${opt.defaultDesig})`, opt.defaultDesig);
        const sp = createSubProject(p.id, moduleId, { name, designation: designation || '' });
        setActiveProjectId(sp.id);
        prToast(`✔ Создан подпроект «${sp.name}»`);
        try { clearNavStack(); } catch {}
        location.href = buildModuleHref(opt.href, { projectId: sp.id, fromModule: 'projects' });
      });
    });

    // — переименовать / удалить подпроект
    modulesHost.querySelectorAll('.pr-sub-row [data-act="rename-sub"]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.closest('.pr-sub-row')?.dataset.subId;
        const sp = id ? getProject(id) : null; if (!sp) return;
        const name = await prPrompt('Переименовать подпроект', 'Имя', sp.name || '');
        if (name == null) return;
        const designation = await prPrompt('Обозначение', 'Короткий код', sp.designation || '');
        updateProject(id, { name, designation: designation || '' });
        prToast('✔ Обновлено');
        render();
      });
    });
    modulesHost.querySelectorAll('.pr-sub-row [data-act="delete-sub"]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.closest('.pr-sub-row')?.dataset.subId;
        const sp = id ? getProject(id) : null; if (!sp) return;
        const ok = await prConfirm(
          `Удалить подпроект «${sp.name}»?`,
          'Удалятся метаданные и все scoped-данные подпроекта (raschet.project.' + sp.id + '.*). Действие необратимо.'
        );
        if (!ok) return;
        const { removedKeys } = deleteProject(id);
        prToast(`✔ Удалено${removedKeys ? ' (' + removedKeys + ' ключей LS)' : ''}`);
        render();
      });
    });

    // Сбрасываем back-stack при переходе.
    modulesHost.querySelectorAll('a[href]').forEach(a => {
      a.addEventListener('click', () => { try { clearNavStack(); } catch {} });
    });

    // v0.59.374: дополнительно показываем в группе «Схемы» legacy-схемы
    // из window.Storage (то, что видно на главной «Мои схемы» и привязано
    // к этому проекту через scheme.projectId === p.id). Подпроект-«схема»
    // и схема в storage — пока разные сущности; пользователь видит обе.
    (async () => {
      try {
        if (!window.Storage || typeof window.Storage.listProjects !== 'function') return;
        const all = await window.Storage.listProjects();
        const mine = (all || []).filter(s => s && s.projectId === p.id);
        if (!mine.length) return;
        const grp = modulesHost.querySelector('.pr-art-group[data-kind="schematic"]');
        if (!grp) return;
        // обновить счётчик в шапке
        const headSpan = grp.querySelector('div .muted');
        const total = subSchemes.length + mine.length;
        if (headSpan) headSpan.textContent = '· ' + total;
        // убрать «Схем нет — нажмите…» если он был
        const placeholder = Array.from(grp.children).find(c => c.classList && c.classList.contains('muted'));
        if (placeholder) placeholder.remove();
        // дописываем строки legacy-схем
        const rowsHtml = mine.map(s => {
          const href = '../index.html?project=' + encodeURIComponent(s.id) + '&from=projects&fromCtx=' + encodeURIComponent(p.id);
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px">
            <span style="font-size:16px">⚡</span>
            <span style="background:#10b981;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">схема</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name || '')}">${esc(s.name || '(без имени)')}</span>
            <a href="${esc(href)}" class="pr-btn-sel" style="font-size:12px;padding:3px 10px;text-decoration:none">Открыть →</a>
          </div>`;
        }).join('');
        grp.insertAdjacentHTML('beforeend', rowsHtml);
        grp.querySelectorAll('a[href]').forEach(a => {
          a.addEventListener('click', () => { try { clearNavStack(); } catch {} });
        });
      } catch (e) { console.warn('[project.js] legacy schemes load failed', e); }
    })();
  }

  if (actionsHost) {
    actionsHost.innerHTML = `
      <button type="button" class="pr-btn-sel" data-act="status">Статус: ${esc(st.label)} ▾</button>
      <button type="button" class="pr-btn-sel" data-act="rename">Переименовать</button>
      <button type="button" class="pr-btn-sel" data-act="describe">Изменить описание</button>
      <button type="button" class="pr-btn-sel" data-act="import-scheme" title="Скопировать текущую глобальную схему Конструктора в этот проект">⬇ Взять глобальную схему</button>
      <button type="button" class="pr-btn-sel" data-act="apply-scheme" title="Применить схему проекта к главному Конструктору (перезапишет глобальную схему!)">⬆ Применить в Конструкторе</button>
      <button type="button" class="pr-btn-sel" data-act="export">Экспорт JSON</button>
      <button type="button" class="pr-btn-sel" data-act="copy">📄 Копировать проект</button>
      <button type="button" class="pr-btn-sel" data-act="activate">Сделать активным</button>
      <button type="button" class="pr-btn-danger" data-act="delete" style="margin-left:auto">Удалить проект</button>
    `;
    actionsHost.querySelector('[data-act="status"]').addEventListener('click', async () => {
      const next = await prStatusPicker(p.status || 'draft');
      if (next == null || next === p.status) return;
      updateProject(p.id, { status: next });
      prToast('✔ Статус: ' + statusMeta(next).label);
      render();
    });
    actionsHost.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const name = await prPrompt('Переименовать проект', 'Новое имя', p.name || '');
      if (name == null) return;
      updateProject(p.id, { name });
      prToast('✔ Обновлено');
      render();
    });
    actionsHost.querySelector('[data-act="describe"]').addEventListener('click', async () => {
      const desc = await prPrompt('Описание проекта', 'Адрес, клиент, контакты и т.п.', p.description || '');
      if (desc == null) return;
      updateProject(p.id, { description: desc });
      prToast('✔ Описание обновлено');
      render();
    });
    actionsHost.querySelector('[data-act="import-scheme"]').addEventListener('click', async () => {
      const raw = localStorage.getItem('raschet.scheme');
      if (!raw) { prToast('⚠ Глобальная схема Конструктора пуста', 'err'); return; }
      const ok = await prConfirm(
        'Взять глобальную схему в проект?',
        'В этот проект скопируется текущее содержимое главного Конструктора схем. Существующая схема проекта (если есть) будет перезаписана.'
      );
      if (!ok) return;
      localStorage.setItem(`raschet.project.${p.id}.engine.scheme.v1`, raw);
      updateProject(p.id, {});
      prToast('✔ Схема скопирована в проект');
      render();
    });
    actionsHost.querySelector('[data-act="apply-scheme"]').addEventListener('click', async () => {
      const key = `raschet.project.${p.id}.engine.scheme.v1`;
      const raw = localStorage.getItem(key);
      if (!raw) { prToast('⚠ В проекте нет схемы. Сначала «⬇ Взять глобальную схему»', 'err'); return; }
      const ok = await prConfirm(
        'Применить схему проекта в Конструкторе?',
        'Текущая глобальная схема Конструктора будет ПЕРЕЗАПИСАНА схемой этого проекта. Действие необратимо без backup.'
      );
      if (!ok) return;
      localStorage.setItem('raschet.scheme', raw);
      prToast('✔ Схема применена. Откройте Конструктор схем для проверки.');
    });
    actionsHost.querySelector('[data-act="export"]').addEventListener('click', () => {
      const blob = exportProject(p.id);
      if (!blob) { prToast('⚠ Проект не найден', 'err'); return; }
      const safe = (p.name || p.id).replace(/[^\w\-]+/g, '_').slice(0, 40);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      a.download = `project-${safe}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      prToast('✔ JSON сохранён');
    });
    actionsHost.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      const ok = await prConfirm(
        `Создать копию проекта «${p.name}»?`,
        'Скопируются метаданные и все scoped-данные.'
      );
      if (!ok) return;
      const copy = copyProject(p.id);
      if (!copy) { prToast('⚠ Копирование не удалось', 'err'); return; }
      prToast(`✔ Создана копия «${copy.name}»`);
      // Перейти к карточке копии.
      location.href = 'project.html?project=' + encodeURIComponent(copy.id);
    });
    actionsHost.querySelector('[data-act="activate"]').addEventListener('click', () => {
      setActiveProjectId(p.id);
      prToast('✔ Проект сделан активным');
      render();
    });
    actionsHost.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      const ok = await prConfirm(
        `Удалить проект «${p.name}»?`,
        'Удалятся метаданные и все scoped-данные (raschet.project.' + p.id + '.*). Действие необратимо.'
      );
      if (!ok) return;
      const { removedKeys } = deleteProject(p.id);
      prToast(`✔ Удалено${removedKeys ? ' (стёрто ' + removedKeys + ' ключей LS)' : ''}`);
      // Возврат к списку.
      setTimeout(() => { location.href = './'; }, 700);
    });
  }

  if (metaHost) {
    metaHost.innerHTML = `
      <table class="pr-meta-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <tbody>
          <tr><td style="padding:6px 10px;color:#64748b;width:160px">ID</td><td style="padding:6px 10px"><code>${esc(p.id)}</code></td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Создан</td><td style="padding:6px 10px">${fmtDate(p.createdAt)}</td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Изменён</td><td style="padding:6px 10px">${fmtDate(p.updatedAt)}</td></tr>
          <tr><td style="padding:6px 10px;color:#64748b">Тип</td><td style="padding:6px 10px">${p.kind === 'sketch' ? '🧪 Мини-проект' : '🏢 Полноценный проект'}</td></tr>
          ${p.ownerModule ? `<tr><td style="padding:6px 10px;color:#64748b">Создан в модуле</td><td style="padding:6px 10px">${esc(p.ownerModule)}</td></tr>` : ''}
        </tbody>
      </table>`;
  }
}

function badgeChip(icon, n, label, bg, fg) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${fg};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${icon} ${n} <span style="opacity:.8;font-weight:400">${label}</span></span>`;
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // Синхронизируем активный проект — чтобы старые модули, читающие
  // getActiveProjectId(), видели тот же контекст.
  const pid = getPid();
  if (pid && getProject(pid)) setActiveProjectId(pid);
  render();
});
