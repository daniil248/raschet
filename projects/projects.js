// projects/projects.js — модуль «Проекты».
// MVP v0.59.222 (Фаза 1.27.0): список проектов + активный проект.
// Данные модулей (схема/СКС/шкафы) пока в общих LS-ключах, миграция в
// проектный неймспейс — в подфазах 1.27.1+ (см. shared/project-storage.js).

import {
  listProjects, createProject, updateProject, deleteProject, copyProject,
  getActiveProjectId, setActiveProjectId, ensureDefaultProject,
  exportProject, importProject,
} from 'shared/project-storage.js';
import { buildModuleHref, clearNavStack } from 'shared/project-context.js';
import { migrateOrphanSchemes } from 'shared/scheme-orphan-migration.js';
import { downloadBackup, readBackupFile, restoreFromJson, getLastBackupInfo, getAutoBackupSettings } from 'shared/backup.js';
import { APP_VERSION } from 'engine/constants.js';
import { historyList, historyTrash, historyStats } from 'shared/history-log.js';
// v0.60.135 (по требованию Пользователя 2026-05-04 «В модуле Проекты только
// менеджер проектов или ГИП могут создавать проекты»): role-based access.
// hasPermission проверяет ROLES[currentRole].permissions[perm]. Если
// Пользователь не internal — currentRole === null → false для всех permissions.
// canCreateProjects/canDeleteProjects = true только для manager / gip.
import { hasPermission, isInternalUser, currentRole, ROLES } from 'shared/subscriptions.js';
// v0.60.169 (Phase 3.5 — reverse-link chips): на каждой карточке проекта
// показываем чип «📎 N sketch'ей», если в этом проекте есть sketch'и со
// ссылкой на сам проект (refType='project', refId=p.id). Click → popover
// со списком sketch'ей и переходом в модуль Скетч.
import { mountReverseLinkChip } from 'shared/sketch-refs-reverse.js';

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
// v0.59.797 (ROADMAP 1.27.5): multi-status фильтр. Хранится в LS, по
// умолчанию — все КРОМЕ archived. Конкретные значения см. STATUSES.
let statusFilter = (() => {
  try {
    const raw = localStorage.getItem('raschet.projects.statusFilter.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
})();

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
// v0.59.858: backup-nudge — показывает баннер сверху /projects/ если
// auto-backup не настроен и есть значимые данные.
function _renderBackupNudge() {
  const host = document.getElementById('pr-backup-nudge');
  if (!host) return;
  // Не показываем если уже dismissed в этой сессии
  try { if (sessionStorage.getItem('raschet.backupNudgeDismissed') === '1') { host.innerHTML = ''; return; } } catch {}
  const settings = getAutoBackupSettings();
  const last = getLastBackupInfo();
  if (settings.enabled) { host.innerHTML = ''; return; } // авто-бэкап включён — баннер не нужен
  // Есть ли у пользователя данные кроме default? Считаем не-default проекты + любые scheme-keys.
  let dataCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('raschet.project.')) dataCount++;
      if (k === 'rack-config.templates.v1') dataCount += 2;
    }
  } catch {}
  if (dataCount < 2) { host.innerHTML = ''; return; } // мало данных — не пристаём
  const lastInfo = last
    ? `Последний бэкап: <b>${new Date(last.at).toLocaleDateString()}</b>`
    : '<b style="color:#dc2626">Бэкапов ещё не было.</b>';
  host.innerHTML = `
    <div style="margin:8px 0 14px;padding:12px 16px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:22px">⚠</span>
      <div style="flex:1;min-width:240px">
        <div style="font-weight:600;color:#78350f;font-size:13px">Защита данных не настроена</div>
        <div style="color:#92400e;font-size:12px;margin-top:2px">${lastInfo}. Очистка cookies/cache в браузере или ошибка миграции уничтожит ваши данные. <b>Включите авто-бэкап</b> — раз в час платформа будет писать JSON-снимок в выбранную папку.</div>
      </div>
      <button type="button" id="pr-nudge-setup" style="padding:8px 16px;background:#16a34a;color:#fff;border:0;border-radius:5px;cursor:pointer;font-weight:600;font-size:13px">⚙ Настроить</button>
      <button type="button" id="pr-nudge-backup-now" style="padding:6px 12px;background:#fff;border:1px solid #d97706;color:#92400e;border-radius:5px;cursor:pointer;font-size:12px">💾 Скачать бэкап сейчас</button>
      <button type="button" id="pr-nudge-dismiss" title="Скрыть до перезагрузки" style="background:transparent;border:0;color:#92400e;cursor:pointer;font-size:18px;padding:0 6px">✕</button>
    </div>
  `;
  document.getElementById('pr-nudge-setup')?.addEventListener('click', () => {
    // Открыть глобальные настройки (там есть секция «💾 Резервное копирование»)
    try {
      import('shared/global-settings.js').then(m => m.openSettingsModal());
    } catch (e) { console.warn('open settings failed', e); }
  });
  document.getElementById('pr-nudge-backup-now')?.addEventListener('click', () => {
    try {
      const r = downloadBackup({ appVersion: APP_VERSION });
      prToast(`✓ Бэкап скачан: ${r.keyCount} ключей`, 'ok');
      _renderBackupNudge();
    } catch (e) { prToast('Ошибка: ' + (e.message || e), 'err'); }
  });
  document.getElementById('pr-nudge-dismiss')?.addEventListener('click', () => {
    try { sessionStorage.setItem('raschet.backupNudgeDismissed', '1'); } catch {}
    host.innerHTML = '';
  });
}

// v0.60.135: role-banner — показывает текущую роль и её ограничения над
// списком проектов. Видим только internal-Пользователям. По требованию
// Пользователя 2026-05-04 «В модуле Проекты только менеджер проектов или
// ГИП могут создавать проекты» — Пользователю должно быть понятно, какая
// у него роль и что она разрешает / запрещает.
function _renderRoleBanner() {
  const host = document.getElementById('pr-role-banner');
  if (!host) return;
  if (!isInternalUser()) {
    host.innerHTML = '';
    return;
  }
  const role = currentRole();
  const def = role ? ROLES[role] : null;
  if (!def) { host.innerHTML = ''; return; }
  const canCreate = !!def.permissions?.canCreateProjects;
  const canDelete = !!def.permissions?.canDeleteProjects;
  const limitations = [];
  if (!canCreate) limitations.push('создание новых проектов');
  if (!canDelete) limitations.push('удаление проектов');
  const limTxt = limitations.length
    ? `<span style="color:#92400e">Запрещено: ${limitations.join(', ')}.</span>`
    : `<span style="color:#15803d">Полный доступ к управлению проектами.</span>`;
  const bg = limitations.length ? '#fffbeb' : '#f0fdf4';
  const borderColor = limitations.length ? '#fbbf24' : '#86efac';
  host.innerHTML = `
    <div style="margin:8px 0 14px;padding:8px 14px;background:${bg};border:1px solid ${borderColor};border-radius:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px">
      <span style="font-size:16px">${def.label.split(' ')[0] || '👤'}</span>
      <div style="flex:1;min-width:200px">
        <b>Ваша роль:</b> ${escapeHtml(def.label)} · ${limTxt}
      </div>
      <button type="button" id="pr-role-change" style="padding:4px 10px;background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:4px;cursor:pointer;font-size:11.5px" title="Сменить роль (открыть глобальные настройки → раздел «Роль»).">⚙ Сменить роль</button>
    </div>
  `;
  document.getElementById('pr-role-change')?.addEventListener('click', () => {
    try {
      import('shared/global-settings.js').then(m => m.openSettingsModal());
    } catch (e) { console.warn('open settings failed', e); }
  });
}

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

  // v0.59.858: backup-nudge banner — если у пользователя есть данные но
  // авто-бэкап не настроен, показываем баннер с напоминанием.
  // Принцип: «не хочу чтобы пользователь мог потерять свои данные».
  _renderBackupNudge();

  // v0.60.135: role-banner — показываем текущую роль и её ограничения
  // если есть. Только для internal-Пользователей (для внешних — модуль
  // /projects/ доступен только если есть подписка enterprise, и роли
  // не используются — модуль закрыт).
  _renderRoleBanner();

  // v0.59.797 (ROADMAP 1.27.5): multi-status фильтр chip-bar вместо
  // одиночного «show archived». Pre-фильтрация (всего по статусу) +
  // подсчёт активных по статусу для показа цифры в чипе.
  if (!Array.isArray(statusFilter) || statusFilter.length === 0) {
    // Default: показывать всё КРОМЕ архивных
    statusFilter = STATUSES.filter(s => s.id !== 'archived').map(s => s.id);
  }
  const totalArchived = projects.filter(p => p.status === 'archived').length;
  // Подсчёт по каждому статусу (на полном списке, до фильтра)
  const countByStatus = {};
  for (const s of STATUSES) countByStatus[s.id] = projects.filter(p => (p.status || 'draft') === s.id).length;
  // Применяем фильтр
  const _statusSet = new Set(statusFilter);
  projects = projects.filter(p => _statusSet.has(p.status || 'draft'));
  const filterHost = document.getElementById('pr-status-filter');
  const emptyFullProjects = projects.filter(p => {
    const s = projectStats(p.id);
    return (s.nodes + s.racks + s.links + s.inventory + s.facility) === 0;
  });
  if (filterHost) {
    // Группировка: проектирование (draft/planned) / объект (installed/operating) / архив
    const _projGroup = ['draft', 'planned'];
    const _objGroup = ['installed', 'operating'];
    const _archGroup = ['archived'];
    const chipHtml = (sid) => {
      const s = statusMeta(sid);
      const isOn = _statusSet.has(sid);
      const cnt = countByStatus[sid] || 0;
      return `<button type="button" class="pr-status-chip" data-status="${escapeHtml(sid)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid ${isOn ? s.color : '#cbd5e1'};background:${isOn ? s.bg : '#fff'};color:${isOn ? s.color : '#94a3b8'};border-radius:14px;cursor:pointer;font-size:12px;font-weight:${isOn ? 600 : 400}" title="${isOn ? 'Скрыть статус' : 'Показать статус'} «${escapeHtml(s.label)}»">${escapeHtml(s.label)}${cnt ? ` <span style="background:${isOn ? '#fff' : '#f1f5f9'};color:${isOn ? s.color : '#94a3b8'};padding:0 5px;border-radius:8px;font-size:10px">${cnt}</span>` : ''}</button>`;
    };
    filterHost.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Проектирование:</span>
        ${_projGroup.map(chipHtml).join('')}
        <span style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin-left:8px">Объект:</span>
        ${_objGroup.map(chipHtml).join('')}
        <span style="border-left:1px solid #e2e8f0;height:18px;margin:0 4px"></span>
        ${_archGroup.map(chipHtml).join('')}
        <button type="button" id="pr-status-all" style="padding:3px 9px;border:1px solid #cbd5e1;background:#f9fafb;color:#475569;border-radius:14px;cursor:pointer;font-size:11.5px" title="Показать все статусы">Все</button>
        ${emptyFullProjects.length && hasPermission('canDeleteProjects') ? `
        <span style="border-left:1px solid #e2e8f0;height:18px;margin:0 4px"></span>
        <button type="button" id="pr-delete-empty-full" style="background:#fbbf24;color:#78350f;border:1px solid #f59e0b;padding:3px 9px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500" title="Удалить ВСЕ полные проекты без данных (схема/стойки/связи/реестры). Полезно для очистки тестовых записей.">🧹 Удалить ${emptyFullProjects.length} пустых</button>` : ''}
      </div>`;
    filterHost.querySelectorAll('.pr-status-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sid = chip.dataset.status;
        const next = new Set(_statusSet);
        if (next.has(sid)) next.delete(sid); else next.add(sid);
        statusFilter = Array.from(next);
        try { localStorage.setItem('raschet.projects.statusFilter.v1', JSON.stringify(statusFilter)); } catch {}
        render();
      });
    });
    filterHost.querySelector('#pr-status-all')?.addEventListener('click', () => {
      statusFilter = STATUSES.map(s => s.id);
      try { localStorage.setItem('raschet.projects.statusFilter.v1', JSON.stringify(statusFilter)); } catch {}
      render();
    });
    filterHost.querySelector('#pr-delete-empty-full')?.addEventListener('click', async () => {
      const ok = await prConfirm(
        `Удалить ${emptyFullProjects.length} пустых проектов?`,
        `Будут удалены все полные проекты без данных. Имена: ${emptyFullProjects.slice(0, 5).map(p => p.name || '(без имени)').join(', ')}${emptyFullProjects.length > 5 ? `… и ещё ${emptyFullProjects.length - 5}` : ''}. Действие необратимо.`,
        { okLabel: 'Удалить все пустые', isHtml: false }
      );
      if (!ok) return;
      let removed = 0;
      let blockedByCloud = 0;
      // v0.60.349: для bulk-delete тоже проверяем cloud-привязки.
      // Если проект имеет cloud-схемы — пропускаем (силент в bulk; индивид-
      // ный delete покажет explicit-объяснение).
      let cloudSchemes = [];
      try {
        if (window.Storage && typeof window.Storage.listMyProjects === 'function') {
          cloudSchemes = await window.Storage.listMyProjects().catch(() => []);
        }
      } catch {}
      const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const cloudNames = new Set((cloudSchemes || []).map(s => norm(s.projectName || s.name || s.label || '')));
      for (const p of emptyFullProjects) {
        const nm = norm(p.name);
        if (nm && cloudNames.has(nm)) { blockedByCloud++; continue; }
        try { deleteProject(p.id); removed++; }
        catch (e) { console.warn('[projects.js] bulk-delete project failed:', p.id, e); }
      }
      const blockedMsg = blockedByCloud ? ` (${blockedByCloud} пропущено: связаны с облачными схемами)` : '';
      prToast(`✔ Удалено ${removed} пустых проектов${blockedMsg}`);
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
          ${hasPermission('canDeleteProjects')
            ? '<button type="button" class="pr-btn-danger" data-act="delete">Удалить</button>'
            : `<button type="button" class="pr-btn-danger" data-act="delete" disabled style="opacity:0.4;cursor:not-allowed" title="Удаление запрещено для текущей роли. Только 👑 Менеджер проектов или 🛠 ГИП могут удалять проекты из реестра.">Удалить 🔒</button>`}
        </div>
      </div>
      ${p.description ? `<div class="pr-project-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="pr-project-stats" style="margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center">${statsBadges(projectStats(p.id))}<span data-sk-rev-mount="1"></span></div>
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

  // v0.60.169 (Phase 3.5): reverse-link chip на каждой карточке проекта.
  // Чип hideEmpty=true — показывается только если у проекта есть sketch'и
  // со ссылкой на него. Иначе невидим (не засоряем UI).
  host.querySelectorAll('.pr-project').forEach(el => {
    const id = el.dataset.id;
    const mount = el.querySelector('[data-sk-rev-mount="1"]');
    if (mount && id) {
      try {
        mountReverseLinkChip({
          container: mount,
          refType: 'project',
          refId: id,
          pid: id, // sketch'и проекта → ищем в LS этого pid
          hideEmpty: true,
        });
      } catch (e) {
        console.warn('[projects] reverse-link chip mount failed:', e);
      }
    }
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
      // v0.59.560: HTML-форматирование, как в delete-sketch (v0.59.559).
      // Красное предупреждение с детализацией по доменам помогает не
      // потерять работу случайным кликом.
      const detail = total
        ? `<b style="color:#b91c1c">Будет удалено: ⚡${s.nodes} узлов схемы, 🗄${s.racks} стоек, 🔗${s.links} связей СКС, 📋${s.inventory} устройств IT, 🏭${s.facility} позиций реестра объекта.</b><br>Действие необратимо!`
        : 'В проекте нет данных — удаление безопасно.';
      const ok = await prConfirm(
        `Удалить проект «${p.name}»?`,
        `Будут стёрты метаданные проекта И все scoped-данные.<br>${detail}`,
        { okLabel: total ? 'Удалить (и потерять данные)' : 'Удалить', isHtml: true }
      );
      if (!ok) return;
      // v0.60.349 (по репорту Пользователя 2026-05-06: «если есть причины,
      // нужно оповещать пользователя о том почему он не может удалить
      // проект а не удалять его вид а после обновления опять отображать
      // его»): ДО удаления проверяем cloud-схемы, привязанные по имени.
      // Если есть — показываем чёткое объяснение и блокируем удаление.
      let cloudLinked = [];
      try {
        if (window.Storage && typeof window.Storage.listMyProjects === 'function') {
          const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const target = norm(p.name);
          const all = await window.Storage.listMyProjects().catch(() => []);
          cloudLinked = (all || []).filter(sch => {
            if (!sch) return false;
            if (sch.projectId === id || sch.parentProjectId === id) return true;
            const cnm = norm(sch.projectName || sch.name || sch.label || '');
            return cnm && cnm === target;
          });
        }
      } catch (e) { console.warn('[projects.js] cloud-link check failed:', e); }
      if (cloudLinked.length > 0) {
        const list = cloudLinked.slice(0, 5).map(s => `• ${s.name || s.label || s.id || '(без имени)'}`).join('<br>');
        const more = cloudLinked.length > 5 ? `<br>… и ещё ${cloudLinked.length - 5}` : '';
        await prConfirm(
          `Нельзя удалить проект «${p.name}»`,
          `<b style="color:#b91c1c">К проекту привязаны ${cloudLinked.length} облачных схем(ы):</b><br>${list}${more}<br><br>` +
          `LS-контейнер был создан автоматически на основе этих схем. После удаления контейнер будет пере-создан при следующей загрузке страницы.<br><br>` +
          `<b>Что делать:</b><br>` +
          `1. Откройте Конструктор / СКС-design и удалите облачные схемы там (или переименуйте).<br>` +
          `2. Затем вернитесь сюда и удалите LS-контейнер.`,
          { okLabel: 'Понятно', isHtml: true, hideCancel: true }
        );
        return;
      }
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
  // v0.60.342 (по репорту Пользователя 2026-05-06: «минипроекты в проектах
  // зачем???»): мини-проекты живут в dropdown'ах своих модулей и не должны
  // дублироваться в общем «Списке проектов». Раньше показывалась audit-панель
  // с группировкой по ownerModule + кнопкой «Удалить пустые». Доступ к
  // мини-проектам — через picker модулей (scs-design, mv-config, tw, etc.).
  host.innerHTML = '';
  return;
  // eslint-disable-next-line no-unreachable
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
  // v0.59.568: счётчик пустых мини-проектов и кнопка их пакетного удаления.
  const emptySketches = sketches.filter(s => {
    const st = projectStats(s.id);
    return st.nodes + st.racks + st.links + st.inventory + st.facility === 0;
  });
  const emptyCount = emptySketches.length;
  host.innerHTML = `
    <details class="pr-sketches-panel" ${sketchesOpen ? 'open' : ''} style="margin-top:24px;padding:10px 14px;background:#fafbfc;border:1px solid #e5e7eb;border-radius:8px">
      <summary style="cursor:pointer;font-weight:600;color:#475569;user-select:none">
        🧪 Мини-проекты (${totalN}) <span class="muted" style="font-weight:400;font-size:12px">— черновики мастеров, живут в своих модулях</span>${emptyCount ? ` <span style="background:#fef3c7;color:#78350f;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:500;margin-left:6px">${emptyCount} пустых</span>` : ''}
      </summary>
      <div style="margin-top:10px;color:#64748b;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span>Мини-проекты создаются внутри конкретного мастера (scs-design, mv-config и т.п.) для быстрых прикидок без создания полноценного проекта. Они видны только в dropdown'е своего модуля.</span>
        ${emptyCount ? `<button type="button" id="pr-delete-empty-sketches" style="background:#fbbf24;color:#78350f;border:1px solid #f59e0b;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;white-space:nowrap" title="Удалить ВСЕ пустые мини-проекты одним кликом (без данных в схеме/стойках/связях)">🧹 Удалить ${emptyCount} пустых</button>` : ''}
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
  // v0.59.568: bulk-удаление пустых мини-проектов.
  document.getElementById('pr-delete-empty-sketches')?.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await prConfirm(
      `Удалить ${emptyCount} пустых мини-проектов?`,
      `Будут удалены все sketches без данных (схема/стойки/связи/реестры). Действие необратимо. Имена: ${emptySketches.slice(0, 5).map(s => s.name || '(без имени)').join(', ')}${emptyCount > 5 ? `… и ещё ${emptyCount - 5}` : ''}.`,
      { okLabel: 'Удалить все пустые', isHtml: false }
    );
    if (!ok) return;
    let removed = 0;
    let removedKeysTotal = 0;
    for (const s of emptySketches) {
      try {
        const r = deleteProject(s.id);
        removed++;
        removedKeysTotal += r.removedKeys || 0;
      } catch (err) { console.warn('[projects.js] bulk-delete sketch failed:', s.id, err); }
    }
    prToast(`✔ Удалено ${removed} пустых мини-проектов (${removedKeysTotal} ключей LS)`);
    render();
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

// v0.59.566: после auth/Storage готов — синкуем cloud-схемы → LS-контейнеры.
// Для каждой cloud-схемы (window.Storage.listMyProjects) проверяем имя; если
// LS-контейнера с таким именем нет — создаём. Это решает проблему «проект
// есть в облаке, но нет в LS на этом устройстве, поэтому в scs-design
// dropdown не виден». Идемпотентно — повторный запуск не создаёт дубликатов.
async function syncCloudToLsContainers() {
  try {
    if (!window.Storage || typeof window.Storage.listMyProjects !== 'function') return;
    let cloudSchemes = [];
    try { cloudSchemes = await window.Storage.listMyProjects(); }
    catch (e) { console.warn('[projects.js] listMyProjects failed:', e); return; }
    if (!Array.isArray(cloudSchemes) || !cloudSchemes.length) return;

    // Все имена существующих LS-контейнеров (full-projects), нормализованные.
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const lsContainers = listProjects().filter(p =>
      (p.kind || 'full') === 'full' &&
      !(typeof p.id === 'string' && p.id.startsWith('lp_')) &&
      !('scheme' in p) && !('memberUids' in p)
    );
    const lsContainerNames = new Set(lsContainers.map(p => norm(p.name)));

    // Имя для контейнера: пытаемся scheme.projectName/projectId-resolved/name.
    let created = 0;
    const seen = new Set();
    for (const sch of cloudSchemes) {
      if (!sch) continue;
      // Если у схемы уже есть projectId на валидный LS-контейнер — пропускаем.
      const existingPid = sch.projectId || sch.parentProjectId || null;
      if (existingPid && lsContainers.some(p => p.id === existingPid)) continue;

      // Имя для контейнера. Берём projectName, иначе scheme.name, иначе scheme.label.
      const candidateName = (sch.projectName || sch.name || sch.label || '').trim();
      if (!candidateName) continue;
      const key = norm(candidateName);
      if (seen.has(key)) continue;     // не создаём дубликаты в одном проходе
      if (lsContainerNames.has(key)) continue; // уже есть LS-контейнер с этим именем
      seen.add(key);
      try {
        const ctx = createProject({
          name: candidateName,
          description: 'Контейнер создан автоматически на основе cloud-схемы. Связанные cloud-схемы будут привязаны при следующем заходе на /projects/.',
        });
        if (ctx) created++;
      } catch (e) { console.warn('[projects.js] auto-create container failed for', candidateName, e); }
    }
    if (created > 0) {
      console.info(`[projects.js] cloud→LS sync: создано ${created} контейнеров`);
      prToast(`☁→💾 Синхронизировано: создано ${created} LS-контейнеров из облака`, 'info');
    }
  } catch (e) { console.warn('[projects.js] syncCloudToLsContainers failed:', e); }
}

function _initAfterDom() {
  ensureDefaultProject();
  render();

  // v0.59.566: одноразовая (за загрузку) попытка синка cloud→LS. После
  // sync — снова render + повторная orphan-migration, чтобы schemas
  // получили правильный projectId по имени.
  syncCloudToLsContainers().then(() => {
    try {
      const r = migrateOrphanSchemes();
      if (r && (r.matched > 0 || r.created > 0)) {
        console.info(`[projects.js] post-sync orphan-migration: matched=${r.matched}, created=${r.created}`);
      }
    } catch {}
    render();
  });

  // Re-render при изменении auth-state (Storage переключится в cloud).
  try {
    if (window.Auth && typeof window.Auth.onAuthChange === 'function') {
      window.Auth.onAuthChange(() => {
        try { render(); } catch (e) { console.warn('[projects.js] re-render on auth-change failed:', e); }
        // Auth теперь готов — снова запускаем sync.
        syncCloudToLsContainers().then(() => { try { render(); } catch {} });
      });
    }
  } catch {}

  // Phase 35.5 (v0.60.61): «📜 История проектов» — глобальная история всех
  // событий по всем проектам с фильтром.
  document.getElementById('pr-history-global')?.addEventListener('click', openGlobalHistoryModal);

  // v0.59.854: «💾 Бэкап» — скачать ВСЕ данные LocalStorage как JSON-файл.
  document.getElementById('pr-backup')?.addEventListener('click', () => {
    try {
      const payload = downloadBackup({ appVersion: APP_VERSION });
      prToast(`✓ Бэкап скачан: ${payload.keyCount} ключей, ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`, 'ok');
    } catch (e) {
      console.error('[backup] failed:', e);
      // v0.60.139: replaced alert() with prToast (правило «No browser dialogs»).
      prToast('Ошибка бэкапа: ' + (e.message || e), 'err');
    }
  });
  // v0.59.877: «📤 Импортировать проект» — импорт ОДНОГО проекта из JSON.
  // Работает с файлами, экспортированными через «📥 JSON» в карточке проекта.
  document.getElementById('pr-import-project')?.addEventListener('click', () => {
    document.getElementById('pr-import-project-file')?.click();
  });
  // v0.60.272: «📁 Открыть файл (drawio)» — переход в Конструктор с авто-
  // запуском file-open dialog. Discoverability file-storage прямо со
  // страницы списка проектов, без необходимости сначала открывать какой-то
  // другой проект.
  document.getElementById('pr-open-file')?.addEventListener('click', () => {
    // Editor читает ?openFile=1 при инициализации и кликает btn-file-open.
    location.href = '../index.html?openFile=1';
  });
  document.getElementById('pr-import-project-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const created = importProject(obj);
      if (!created) throw new Error('importProject вернул null');
      const isCopy = (created.id !== obj.project.id);
      prToast(`✔ Импортирован проект «${created.name}»${isCopy ? ' (создан под новым ID — оригинал уже есть)' : ''}`);
      e.target.value = '';
      render();
    } catch (err) {
      console.error('[import-project] failed:', err);
      prToast('Ошибка импорта: ' + (err.message || err), 'err');
      e.target.value = '';
    }
  });

  // v0.59.854: «📂 Восстановить» — открывает file input → restore.
  document.getElementById('pr-restore-backup')?.addEventListener('click', () => {
    document.getElementById('pr-restore-backup-file')?.click();
  });
  document.getElementById('pr-restore-backup-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = await readBackupFile(file);
      // v0.60.139: replaced confirm()/alert() with prConfirm/prToast (no browser dialogs).
      // Шаг 1: подтвердить, что вообще хотим восстанавливать.
      const summaryHtml = `<b>Бэкап от:</b> ${payload.exportedAt || 'неизвестно'}<br>
        <b>Версия:</b> ${payload.appVersion || '?'}<br>
        <b>Ключей в бэкапе:</b> ${payload.keyCount || Object.keys(payload.data || {}).length}<br><br>
        Продолжить восстановление?`;
      const proceed = await prConfirm('Восстановление из бэкапа', summaryHtml, { okLabel: 'Продолжить', cancelLabel: 'Отмена', isHtml: true });
      if (!proceed) { e.target.value = ''; return; }
      // Шаг 2: выбрать стратегию (MERGE / REPLACE). MERGE — безопаснее, default.
      const wantReplace = await prConfirm(
        'Стратегия восстановления',
        '<b>Полностью заменить</b> текущие данные данными из бэкапа?<br><br>' +
        '<span style="color:#16a34a">OK = REPLACE</span> (стереть текущие, записать из бэкапа) — <i>осторожно</i>.<br>' +
        '<span style="color:#3b82f6">Отмена = MERGE</span> (объединить с текущими — безопаснее, рекомендуется).',
        { okLabel: '✕ REPLACE (стереть всё)', cancelLabel: '↪ MERGE (объединить)', isHtml: true }
      );
      const strategy = wantReplace ? 'replace' : 'merge';
      const result = restoreFromJson(payload, { strategy });
      prToast(`✓ Восстановлено: ${result.written} ключей (стратегия: ${result.strategy}). Страница перезагрузится…`, 'ok');
      e.target.value = '';
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      console.error('[restore] failed:', err);
      prToast('Ошибка восстановления: ' + (err.message || err), 'err');
      e.target.value = '';
    }
  });

  // v0.59.852: «🔧 Восстановить связи» — две задачи в одной кнопке.
  //   1. Сканируем localStorage на orphan project-data:
  //      ключи `raschet.project.<pid>.*` где pid НЕ в raschet.projects.v1.
  //      Для каждого orphan-pid создаём метаданную с именем
  //      из POR / engine.scheme / по pid.
  //   2. Запускаем migrateOrphanSchemes — линкуем lp_*-схемы к контейнерам
  //      по совпадению имени.
  document.getElementById('pr-restore-links')?.addEventListener('click', async () => {
    const log = [];
    try {
      // 1. Собираем все pid из ключей `raschet.project.<pid>.*`
      const orphanPids = new Map();   // pid → bestKnownName
      const PREFIX = 'raschet.project.';
      const knownPids = new Set(listProjects().map(p => p.id));
      const knownLpIds = new Set(listProjects().filter(p => typeof p.id === 'string' && p.id.startsWith('lp_')).map(p => p.id));
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PREFIX)) continue;
        // ключ вида raschet.project.<pid>.<rest>
        const rest = key.slice(PREFIX.length);
        const dotIdx = rest.indexOf('.');
        if (dotIdx < 0) continue;
        const pid = rest.slice(0, dotIdx);
        // v0.59.853 fix: только string-pid с валидным префиксом p_/s_/lp_
        if (typeof pid !== 'string' || !pid) continue;
        if (!/^[ps]_|^lp_/.test(pid)) continue;
        if (knownPids.has(pid)) continue;
        if (!orphanPids.has(pid)) orphanPids.set(pid, null);
      }
      log.push(`Найдено orphan-pid: ${orphanPids.size}`);

      // 2. Для каждого orphan-pid пытаемся вытащить имя:
      //    а) из engine.scheme.v1 (deserialize-friendly poll)
      //    b) из POR objects (любого type)
      //    c) fallback к pid
      for (const pid of orphanPids.keys()) {
        let name = null;
        // engine.scheme.v1
        try {
          const raw = localStorage.getItem(`${PREFIX}${pid}.engine.scheme.v1`);
          if (raw) {
            const obj = JSON.parse(raw);
            name = (obj?.project?.name || obj?.name || '').trim() || null;
          }
        } catch {}
        // POR objects: ищем любой объект с tag/name полем
        if (!name) {
          try {
            const raw = localStorage.getItem(`${PREFIX}${pid}.por.objects.v1`);
            if (raw) {
              const obj = JSON.parse(raw);
              if (obj && typeof obj === 'object') {
                const ids = Object.keys(obj);
                if (ids.length) name = `Восстановленный (${ids.length} POR-объектов, ${pid})`;
              }
            }
          } catch {}
        }
        if (!name) name = `Восстановленный проект ${pid}`;
        orphanPids.set(pid, name);
      }

      // 3. Создаём метаданные записи. ID берём из orphan-pid (не генерируем
      //    новый), чтобы существующие raschet.project.<pid>.* ключи остались
      //    привязанными к этому проекту.
      let restored = 0;
      const fresh = listProjects();
      for (const [pid, name] of orphanPids) {
        const entry = {
          id: pid,
          name,
          description: '🔧 Auto-восстановлено по orphan-данным в LocalStorage. Содержит ранее сохранённые POR-объекты, схему и/или СКС-данные. Если имя не подходит — переименуйте.',
          status: 'draft',
          kind: 'full',
          parentProjectId: null,
          designation: '',
          schema: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fresh.push(entry);
        restored++;
      }
      if (restored > 0) {
        try { localStorage.setItem('raschet.projects.v1', JSON.stringify(fresh)); } catch {}
        log.push(`Восстановлено metadata-записей: ${restored}`);
      }

      // 4. Линкуем orphan-схемы к контейнерам по имени.
      try {
        const r = migrateOrphanSchemes();
        log.push(`Привязка orphan-схем: matched=${r?.matched || 0}, created=${r?.created || 0}, skipped=${r?.skipped || 0}`);
      } catch (e) { log.push(`migrateOrphanSchemes failed: ${e.message || e}`); }

      const summary = log.join('\n');
      // v0.60.139: replaced alert() with prConfirm/prToast (no browser dialogs).
      console.info('[restore-links]', summary);
      const summaryHtml = '<pre style="margin:0;font-size:12px;white-space:pre-wrap">' + summary.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</pre>';
      await prConfirm('🔧 Восстановление завершено', summaryHtml + '<br><b>Страница перезагрузится.</b>', { okLabel: 'OK', cancelLabel: '', isHtml: true });
      location.reload();
    } catch (e) {
      console.error('[restore-links] failed:', e);
      prToast('Ошибка восстановления: ' + (e.message || e) + ' · Данные не изменены.', 'err');
    }
  });

  // v0.60.135: guard «＋ Новый проект» — только manager / gip / без internal.
  // По требованию Пользователя 2026-05-04 «В модуле Проекты только менеджер
  // проектов или ГИП могут создавать проекты». Permissions из ROLES в
  // shared/subscriptions.js. Если permission нет — кнопка disabled с
  // tooltip-объяснением; если internal-режим выключен (Пользователь —
  // внешний клиент) — модуль доступен только если он есть в подписке,
  // и hasPermission всегда вернёт false (нет роли).
  const newBtn = document.getElementById('pr-new');
  if (newBtn) {
    const allowed = hasPermission('canCreateProjects');
    if (!allowed) {
      newBtn.disabled = true;
      newBtn.style.opacity = '0.55';
      newBtn.style.cursor = 'not-allowed';
      const role = currentRole();
      const roleLabel = role ? (ROLES[role]?.label || role) : 'не задана';
      newBtn.title = `Создание проектов запрещено для роли «${roleLabel}». ` +
        `Только 👑 Менеджер проектов или 🛠 ГИП могут создавать проекты в реестре. ` +
        `Локальные проекты в подпрограммах остаются доступными всем (через chip в шапке).`;
    } else {
      newBtn.addEventListener('click', async () => {
        const name = await prPrompt('Новый проект', 'Название проекта', '', 'напр. «ЦОД Альфа-1, Тверь»');
        if (!name) return;
        const desc = await prPrompt('Описание', 'Клиент / адрес / контакты (можно оставить пустым)', '');
        const p = createProject({ name, description: desc || '' });
        setActiveProjectId(p.id);
        prToast('✔ Проект создан и сделан активным');
        render();
      });
    }
  }
}

// =============================================================================
// Phase 35.5 (v0.60.61): глобальная история — все события по всем проектам.
// =============================================================================
const GLOBAL_HIST_ACTION_LABELS = {
  'import':  { icon: '➕', label: 'Импорт', color: '#0d8a4e' },
  'update':  { icon: '✏', label: 'Обновлено', color: '#0369a1' },
  'delete':  { icon: '🗑', label: 'Удалено', color: '#92400e' },
  'restore': { icon: '↩', label: 'Восстановлено', color: '#7c3aed' },
  'purge':   { icon: '✕', label: 'Удалено навсегда', color: '#991b1b' },
};
const GLOBAL_HIST_MODULE_ICONS = {
  'meteo': '🌤', 'cooling': '❄', 'service': '🛠',
  'ups-config': '🔋', 'mdc-config': '🏗',
};

function ghFmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

async function openGlobalHistoryModal() {
  const projects = listProjects();
  const sketchAndFull = projects.filter(p => p.id);
  if (!sketchAndFull.length) {
    prToast('Нет проектов — нечего показывать в истории', 'info');
    return;
  }
  // Собираем все события по всем проектам.
  const allEvents = [];
  let totalTrash = 0;
  for (const proj of sketchAndFull) {
    try {
      const events = await historyList(proj.id);
      const trash = await historyTrash(proj.id);
      totalTrash += trash.length;
      for (const ev of events) {
        allEvents.push({ ...ev, _projectId: proj.id, _projectName: proj.name || proj.id });
      }
    } catch (e) {
      console.warn(`[global-history] failed for project ${proj.id}:`, e);
    }
  }
  allEvents.sort((a, b) => b.ts - a.ts);

  // Уникальные значения для фильтров.
  const uniqProjects = Array.from(new Set(allEvents.map(e => e._projectId)));
  const uniqModules = Array.from(new Set(allEvents.map(e => e.module).filter(Boolean)));
  const uniqActions = Array.from(new Set(allEvents.map(e => e.action).filter(Boolean)));

  const escAttr = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const escHtml = (s) => escAttr(s);

  const renderRows = (events) => events.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:16px">Нет событий по выбранным фильтрам.</td></tr>`
    : events.map(ev => {
        const meta = GLOBAL_HIST_ACTION_LABELS[ev.action] || { icon: '?', label: ev.action, color: '#64748b' };
        const modIcon = GLOBAL_HIST_MODULE_ICONS[ev.module] || '📦';
        return `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:6px 8px;font-size:11.5px;color:#475569;white-space:nowrap">${escHtml(ghFmtTs(ev.ts))}</td>
          <td style="padding:6px 8px;font-size:11.5px;font-weight:500" title="${escAttr(ev._projectId)}">${escHtml(ev._projectName)}</td>
          <td style="padding:6px 8px;font-size:12px">${modIcon} ${escHtml(ev.module)}</td>
          <td style="padding:6px 8px;font-size:12px"><span style="color:${meta.color}">${meta.icon} ${escHtml(meta.label)}</span></td>
          <td style="padding:6px 8px;font-size:12px">${escHtml(ev.itemName || ev.itemId || '—')}</td>
          <td style="padding:6px 8px;font-size:11px;color:#64748b">${escHtml(ev.source || '')}${ev.payload?.triggeredFrom ? ` <span style="opacity:0.7" title="Из какого модуля инициирован">(${escHtml(ev.payload.triggeredFrom)})</span>` : ''}</td>
        </tr>`;
      }).join('');

  const projectsByIdMap = new Map(sketchAndFull.map(p => [p.id, p.name || p.id]));
  const filtersHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center;font-size:12px">
      <label title="Фильтр по проекту">📁 <select id="gh-filter-project" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px"><option value="">Все проекты (${uniqProjects.length})</option>${uniqProjects.map(pid => `<option value="${escAttr(pid)}">${escHtml(projectsByIdMap.get(pid) || pid)}</option>`).join('')}</select></label>
      <label title="Фильтр по модулю">📦 <select id="gh-filter-module" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px"><option value="">Все модули</option>${uniqModules.map(m => `<option value="${escAttr(m)}">${GLOBAL_HIST_MODULE_ICONS[m] || ''} ${escHtml(m)}</option>`).join('')}</select></label>
      <label title="Фильтр по типу события">⚡ <select id="gh-filter-action" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:3px"><option value="">Все события</option>${uniqActions.map(a => `<option value="${escAttr(a)}">${(GLOBAL_HIST_ACTION_LABELS[a]?.label) || a}</option>`).join('')}</select></label>
      <span class="muted" style="margin-left:auto;font-size:11px">Всего: <b id="gh-count">${allEvents.length}</b> событий, в корзине: <b style="color:#92400e">${totalTrash}</b></span>
      <button type="button" id="gh-export" style="padding:4px 8px;font-size:11px;border:1px solid #16a34a;background:#dcfce7;color:#15803d;border-radius:3px;cursor:pointer" title="Скачать историю как JSON для бэкапа/аудита">📥 JSON</button>
    </div>`;

  const html = `
    ${filtersHtml}
    <div style="max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
          <tr>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Время</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Проект</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Модуль</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Событие</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Объект</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #cbd5e1">Источник</th>
          </tr>
        </thead>
        <tbody id="gh-tbody">${renderRows(allEvents)}</tbody>
      </table>
    </div>`;

  // Используем prConfirm-подобный modal через util? У projects.js нет общего
  // util — делаем native overlay по аналогии с existing modals.
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;justify-content:center;align-items:center;padding:24px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:8px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);width:min(95vw,1100px);max-height:90vh;display:flex;flex-direction:column">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0;font-size:16px">📜 Глобальная история проектов Raschet</h3>
        <button type="button" id="gh-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;padding:0;line-height:1" title="Закрыть">×</button>
      </div>
      <div style="padding:14px 18px;overflow:auto;flex:1">${html}</div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#gh-close').addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });

  // Фильтрация при изменении select-ов.
  const tbody = overlay.querySelector('#gh-tbody');
  const countEl = overlay.querySelector('#gh-count');
  const refilter = () => {
    const fp = overlay.querySelector('#gh-filter-project').value;
    const fm = overlay.querySelector('#gh-filter-module').value;
    const fa = overlay.querySelector('#gh-filter-action').value;
    const filtered = allEvents.filter(ev => {
      if (fp && ev._projectId !== fp) return false;
      if (fm && ev.module !== fm) return false;
      if (fa && ev.action !== fa) return false;
      return true;
    });
    tbody.innerHTML = renderRows(filtered);
    countEl.textContent = filtered.length;
  };
  overlay.querySelector('#gh-filter-project').addEventListener('change', refilter);
  overlay.querySelector('#gh-filter-module').addEventListener('change', refilter);
  overlay.querySelector('#gh-filter-action').addEventListener('change', refilter);

  // Экспорт JSON.
  overlay.querySelector('#gh-export').addEventListener('click', () => {
    try {
      const data = { exportedAt: new Date().toISOString(), totalEvents: allEvents.length, events: allEvents };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raschet-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      prToast(`✓ JSON скачан: ${allEvents.length} событий`, 'ok');
    } catch (e) {
      prToast(`❌ Не удалось экспортировать: ${e.message}`, 'err');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAfterDom);
} else {
  _initAfterDom();
}
