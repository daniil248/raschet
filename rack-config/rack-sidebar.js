// =========================================================================
// rack-config/rack-sidebar.js (v0.59.245)
// Левый сайдбар со списком всех сохранённых конфигураций типов стоек.
// Показывается только в standalone-режиме (конфигуратор открыт не из
// узла схемы и не как embedded).
//
// Агрегирует шаблоны из:
//   • глобального LS-ключа 'rack-config.templates.v1'
//   • всех project-scoped ключей 'raschet.project.<pid>.rack-config.templates.v1'
//     (как full-проектов, так и sketch-мини-проектов)
//
// По клику — передаёт шаблон в window.__rackConfig.loadExternalTemplate(),
// который клонирует его и делает текущим в форме конфигуратора.
// =========================================================================

const GLOBAL_KEY = 'rack-config.templates.v1';
const SCOPED_PREFIX = 'raschet.project.';
const SCOPED_SUFFIX = '.rack-config.templates.v1';

function isStandaloneMode() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('nodeId')) return false;
    if (p.get('embedded') === '1' || p.get('mode') === 'embedded') return false;
    if (p.get('project')) return false;
  } catch {}
  if (window.name === 'raschet-embed') return false;
  try { if (window.opener && window.__raschetEmbed === true) return false; } catch {}
  try {
    const ref = document.referrer || '';
    if (ref) {
      const u = new URL(ref);
      if (u.origin === location.origin) {
        const p = u.pathname || '';
        if (/\/(scs-config|scs-design|pdu-config|mdc-config)\//i.test(p)) return false;
      }
    }
  } catch {}
  return true;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readProjects() {
  try {
    const raw = localStorage.getItem('raschet.projects.v1');
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.map(p => [p.id, p]));
  } catch { return new Map(); }
}

// Собирает все шаблоны: { template, origin, projectId?, projectName?, projectKind? }
function collectAll() {
  const out = [];
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) for (const t of arr) out.push({ template: t, origin: 'global' });
  } catch {}
  const projects = readProjects();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(SCOPED_PREFIX) || !k.endsWith(SCOPED_SUFFIX)) continue;
      const pid = k.slice(SCOPED_PREFIX.length, k.length - SCOPED_SUFFIX.length);
      const proj = projects.get(pid);
      try {
        const raw = localStorage.getItem(k);
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) continue;
        for (const t of arr) out.push({
          template: t,
          origin: 'project',
          projectId: pid,
          projectName: proj ? proj.name : pid,
          projectKind: proj ? proj.kind : null,
        });
      } catch {}
    }
  } catch {}
  return out;
}

function originChip(rec) {
  if (rec.origin === 'global') {
    return '<span class="rs-chip rs-chip-global" title="Глобальный каталог (rack-config.templates.v1)">🌐 global</span>';
  }
  const isSketch = rec.projectKind === 'sketch';
  const icon = isSketch ? '🧪' : '🏢';
  const cls = isSketch ? 'rs-chip-sketch' : 'rs-chip-project';
  const label = esc(rec.projectName || rec.projectId || 'project');
  return `<span class="rs-chip ${cls}" title="${esc((isSketch ? 'Мини-проект' : 'Проект') + ' · ' + label)}">${icon} ${label}</span>`;
}

function uLabel(t) {
  const u = t && t.u;
  return Number.isFinite(u) ? `${u}U` : '—';
}
function mfgLabel(t) {
  const m = (t && t.manufacturer || '').trim();
  return m || '—';
}

const CSS = `
.rcs-sidebar { display:flex; flex-direction:column; gap:10px; padding:12px; font:13px/1.4 system-ui,sans-serif; color:#0f172a; box-sizing:border-box; height:100%; overflow:auto; }
.rcs-head { display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.3px; color:#475569; padding:4px 4px 2px; }
.rcs-count { color:#94a3b8; font-weight:500; text-transform:none; }
.rcs-search { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font:inherit; }
.rcs-list { list-style:none; padding:0; margin:0; border:1px solid #e2e8f0; border-radius:6px; background:#fff; overflow:auto; }
.rcs-item { padding:8px 10px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
.rcs-item:last-child { border-bottom:0; }
.rcs-item:hover { background:#f1f5f9; }
.rcs-item-title { font-weight:500; color:#0f172a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rcs-item-meta { font-size:11px; color:#64748b; display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; }
.rcs-chip { font-size:10px; padding:1px 6px; border-radius:10px; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; display:inline-flex; gap:3px; align-items:center; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rs-chip-global { background:#eef2ff; color:#3730a3; border-color:#c7d2fe; }
.rs-chip-project { background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
.rs-chip-sketch { background:#fefce8; color:#854d0e; border-color:#fde68a; }
.rcs-empty { padding:12px; color:#94a3b8; text-align:center; font-size:12px; }
.rcs-hint { font-size:11px; color:#64748b; padding:0 4px; }
`;

function injectCss() {
  if (document.getElementById('rcs-css')) return;
  const s = document.createElement('style');
  s.id = 'rcs-css';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

function mount(mountEl) {
  injectCss();
  const root = document.createElement('div');
  root.className = 'rcs-sidebar';
  root.innerHTML = `
    <div class="rcs-head"><span>Сохранённые стойки</span><span class="rcs-count" data-slot="count"></span></div>
    <input class="rcs-search" type="text" placeholder="Поиск по имени/производителю/U…">
    <div class="rcs-hint">Клик — загрузить в форму. Сохранение новой конфигурации — кнопкой «💾 Сохранить шаблон» в правой панели (пишется в глобальный каталог).</div>
    <ul class="rcs-list" data-slot="list"><li class="rcs-empty">Нет сохранённых конфигураций.</li></ul>
  `;
  mountEl.appendChild(root);
  const listEl = root.querySelector('[data-slot="list"]');
  const countEl = root.querySelector('[data-slot="count"]');
  const searchEl = root.querySelector('.rcs-search');

  let items = [];
  let filter = '';

  function render() {
    const q = filter.toLowerCase();
    const filtered = !q ? items : items.filter(rec => {
      const t = rec.template || {};
      return (t.name || '').toLowerCase().includes(q)
        || (t.manufacturer || '').toLowerCase().includes(q)
        || String(t.u || '').includes(q)
        || (rec.projectName || '').toLowerCase().includes(q);
    });
    countEl.textContent = filtered.length + (filtered.length !== items.length ? '/' + items.length : '');
    if (!filtered.length) {
      listEl.innerHTML = `<li class="rcs-empty">${filter ? 'Ничего не найдено' : 'Нет сохранённых конфигураций.'}</li>`;
      return;
    }
    listEl.innerHTML = filtered.map((rec, idx) => {
      const t = rec.template || {};
      return `
        <li class="rcs-item" data-idx="${idx}">
          <div class="rcs-item-title">${esc(t.name || '(без имени)')}</div>
          <div class="rcs-item-meta">
            <span>${esc(uLabel(t))}</span>
            <span>·</span>
            <span>${esc(mfgLabel(t))}</span>
            ${originChip(rec)}
          </div>
        </li>
      `;
    }).join('');
    // replay filtered array binding via data-idx mapping
    listEl._filtered = filtered;
  }

  function reload() {
    items = collectAll();
    // свежие первые (по updatedAt шаблона если есть, иначе стабильная сортировка)
    items.sort((a, b) => {
      const au = (a.template && a.template.updatedAt) || 0;
      const bu = (b.template && b.template.updatedAt) || 0;
      return bu - au;
    });
    render();
  }

  listEl.addEventListener('click', (ev) => {
    const li = ev.target.closest('.rcs-item');
    if (!li) return;
    const idx = parseInt(li.getAttribute('data-idx'), 10);
    const rec = (listEl._filtered || [])[idx];
    if (!rec) return;
    const api = window.__rackConfig;
    if (api && typeof api.loadExternalTemplate === 'function') {
      api.loadExternalTemplate(rec.template);
    }
  });

  searchEl.addEventListener('input', () => {
    filter = searchEl.value.trim();
    render();
  });

  // Обновляемся при внешних изменениях LS (другая вкладка сохранила шаблон
  // в проекте). В рамках текущей вкладки после сохранения шаблона вызываем
  // reload напрямую через rack-config:templates-changed (опционально).
  window.addEventListener('storage', (ev) => {
    if (!ev.key) return;
    if (ev.key === GLOBAL_KEY
        || ev.key === 'raschet.projects.v1'
        || (ev.key.startsWith(SCOPED_PREFIX) && ev.key.endsWith(SCOPED_SUFFIX))) {
      reload();
    }
  });
  window.addEventListener('rack-config:templates-changed', reload);

  reload();
}

export function mountRackSidebarIfStandalone() {
  if (!isStandaloneMode()) return false;
  const aside = document.getElementById('rc-sidebar-left');
  if (!aside) return false;
  document.body.classList.add('rc-has-left-sidebar');
  // Ждём init конфигуратора, чтобы window.__rackConfig был определён.
  if (window.__rackConfig) mount(aside);
  else window.addEventListener('rack-config:ready', () => mount(aside), { once: true });
  return true;
}
