/* =========================================================================
   main.js — приложение-оболочка:
     - инициализация Auth + Storage
     - переключение экранов: loading / projects / editor
     - список проектов, создание, удаление, переименование
     - шаринг и запросы доступа
     - запись/чтение текущего проекта через window.Raschet API
   ========================================================================= */
// Ensure engine modules are loaded and window.Raschet is available
import './engine/index.js';
import { mountHelp } from '../shared/help-panel.js';
import { getMethod, listMethods } from './methods/index.js';
import { formatVoltageLevelLabel } from './engine/electrical.js';
import * as Report from '../shared/report/index.js';
import { getTemplate as getReportTemplate, saveTemplate as saveReportTemplate } from '../shared/report-catalog.js';
import { BUILTIN_TEMPLATES as REPORT_BUILTIN_TEMPLATES } from '../reports/templates-seed.js';
import { openSettingsModal as openGlobalSettingsModal } from '../shared/global-settings.js';
import { listCableTypes as _listCableTypes } from '../shared/cable-types-catalog.js';

(function () {
'use strict';

const screens = {
  loading:  document.getElementById('screen-loading'),
  projects: document.getElementById('screen-projects'),
  editor:   document.getElementById('screen-editor'),
};

const NEW_PROJECT_PASSWORD = '789456123';
let _pwdUnlocked = false;
let _pwdCallback = null;

const $ = (id) => document.getElementById(id);
const els = {
  header: $('header'),
  btnHome: $('btn-home'),
  projectName: $('project-name'),
  btnShare: $('btn-share'),
  btnSave: $('btn-save'),
  btnRequestAccess: $('btn-request-access'),
  btnNotifications: $('btn-notifications'),
  notifBadge: $('notif-badge'),
  authArea: $('auth-area'),

  tabs: document.querySelectorAll('#screen-projects .tab'),
  reqCount: $('req-count'),
  btnNewProject: $('btn-new-project'),
  btnLoadProject: $('btn-load-project'),
  loadProjectFile: $('load-project-file'),
  btnLoadDemo: $('btn-load-demo'),
  projectsList: $('projects-list'),
  projectsEmpty: $('projects-empty'),

  btnTogglePalette: $('btn-toggle-palette'),
  btnToggleInspector: $('btn-toggle-inspector'),

  modalShare: $('modal-share'),
  shareMembers: $('share-members'),
  shareEmail: $('share-email'),
  shareRole: $('share-role'),
  shareAdd: $('share-add'),
  shareVisibility: $('share-visibility'),
  shareLink: $('share-link'),
  shareCopy: $('share-copy'),

  modalRequest: $('modal-request'),
  requestSend: $('request-send'),

  modalNew: $('modal-new'),
  newName: $('new-name'),
  newDemo: $('new-demo'),
  newCreate: $('new-create'),

  modalPassword: $('modal-password'),
  pwdInput: $('pwd-input'),
  pwdSubmit: $('pwd-submit'),

  btnOpenSettings: $('btn-open-settings'),
  btnOpenPresets: $('btn-open-presets'),
  btnOpenReports: $('btn-open-reports'),
  btnOpenLoadsImport: $('btn-open-loads-import'),
  presetsSearch: $('presets-search'),
  presetsList: $('presets-list'),
  reportsList: $('reports-list'),
  reportBody: $('report-body'),
  reportTitle: $('report-title'),
  reportCopy: $('report-copy'),
  reportDownload: $('report-download'),
  loadsImportText: $('loads-import-text'),
  loadsImportApply: $('loads-import-apply'),
};

const state = {
  currentUser: null,
  currentProject: null,
  currentTab: 'mine',
  tabData: { mine: [], shared: [], requests: [] },
  dirty: false,      // есть несохранённые изменения
  saving: false,     // идёт сохранение
  autoSaveTimer: null,
};

const AUTO_SAVE_DELAY = 1500; // мс после последнего изменения

// ================= Экраны =================
function showScreen(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  document.body.dataset.screen = name;
}

// ================= Флеш-сообщение =================
function flash(msg, kind) {
  const d = document.createElement('div');
  d.className = 'flash' + (kind ? ' ' + kind : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

// ================= Auth UI =================
function renderAuthUI() {
  const u = state.currentUser;
  els.authArea.innerHTML = '';
  if (u) {
    const wrap = document.createElement('div');
    wrap.className = 'user-menu';
    const btn = document.createElement('button');
    btn.className = 'user-btn';
    btn.innerHTML =
      (u.photo ? `<img src="${escAttr(u.photo)}" alt="">` : `<span class="avatar-letter">${escHtml((u.name || u.email || '?').charAt(0).toUpperCase())}</span>`) +
      `<span class="user-name">${escHtml(u.name || u.email)}</span>`;
    btn.onclick = () => wrap.classList.toggle('open');
    wrap.appendChild(btn);

    const menu = document.createElement('div');
    menu.className = 'user-dropdown';
    menu.innerHTML = `
      <div class="udd-info">
        <div class="udd-name">${escHtml(u.name || '')}</div>
        <div class="udd-email">${escHtml(u.email || '')}</div>
      </div>
      <button class="udd-item" data-act="signout">Выйти</button>
    `;
    menu.querySelector('[data-act="signout"]').onclick = async () => {
      wrap.classList.remove('open');
      await window.Auth.signOut();
    };
    wrap.appendChild(menu);

    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) wrap.classList.remove('open');
    });

    els.authArea.appendChild(wrap);
  } else {
    const btn = document.createElement('button');
    btn.className = 'hdr-btn signin';
    btn.textContent = 'Войти через Gmail';
    btn.onclick = async () => {
      try { await window.Auth.signIn(); }
      catch (e) { flash(e.message || 'Ошибка входа', 'error'); }
    };
    els.authArea.appendChild(btn);
    if (!window.Auth.isFirebaseReady) {
      btn.title = 'Firebase не настроен — работаем локально. См. README.';
      btn.classList.add('disabled');
    }
  }
}

// ================= Список проектов =================
async function refreshProjects() {
  try {
    const handleErr = (label) => (e) => {
      console.error('[refreshProjects:' + label + ']', e);
      if (String(e && e.message || '').includes('index')) {
        flash('Ошибка Firestore: требуется индекс. Проверьте консоль (F12).', 'error');
      }
      return [];
    };
    const [mine, shared, requests] = await Promise.all([
      window.Storage.listMyProjects().catch(handleErr('mine')),
      window.Storage.listSharedProjects().catch(handleErr('shared')),
      window.Storage.listAccessRequests().catch(handleErr('requests')),
    ]);
    state.tabData = { mine, shared, requests };
    updateNotificationBadge(requests.length);
    renderCurrentTab();
  } catch (e) {
    console.error('refreshProjects', e);
    flash('Ошибка загрузки проектов', 'error');
  }
}

function updateNotificationBadge(count) {
  if (count > 0) {
    els.reqCount.textContent = String(count);
    els.reqCount.classList.remove('hidden');
    els.notifBadge.textContent = String(count);
    els.notifBadge.classList.remove('hidden');
    // Колокольчик показываем только если есть запросы и юзер залогинен
    els.btnNotifications.classList.toggle('hidden', !state.currentUser);
  } else {
    els.reqCount.classList.add('hidden');
    els.notifBadge.classList.add('hidden');
    els.btnNotifications.classList.add('hidden');
  }
}

function renderCurrentTab() {
  els.projectsList.innerHTML = '';
  const tab = state.currentTab;
  const data = state.tabData[tab] || [];
  if (data.length === 0) {
    els.projectsEmpty.textContent = {
      mine: state.currentUser || window.Storage.mode === 'local'
        ? 'Пока нет проектов. Создайте новый.'
        : 'Войдите через Gmail, чтобы создавать свои проекты.',
      shared: 'Пока нет проектов, которыми с вами поделились.',
      requests: 'Нет запросов доступа.',
    }[tab];
    els.projectsEmpty.classList.remove('hidden');
    return;
  }
  els.projectsEmpty.classList.add('hidden');

  if (tab === 'requests') {
    for (const r of data) {
      const card = document.createElement('div');
      card.className = 'req-card';
      card.innerHTML = `
        <div class="req-head">
          <div class="req-title">${escHtml(r.requesterName || r.requesterEmail)}</div>
          <div class="req-sub">${escHtml(r.requesterEmail)}</div>
        </div>
        <div class="req-actions">
          <button class="btn-approve" data-role="viewer">Разрешить просмотр</button>
          <button class="btn-approve" data-role="editor">Разрешить редактирование</button>
          <button class="btn-deny">Отклонить</button>
        </div>
      `;
      card.querySelectorAll('.btn-approve').forEach(b => b.onclick = async () => {
        try {
          await window.Storage.approveRequest(r.id, b.dataset.role);
          flash('Доступ выдан');
          refreshProjects();
        } catch (e) { flash(e.message || 'Ошибка', 'error'); }
      });
      card.querySelector('.btn-deny').onclick = async () => {
        try {
          await window.Storage.denyRequest(r.id);
          refreshProjects();
        } catch (e) { flash(e.message || 'Ошибка', 'error'); }
      };
      els.projectsList.appendChild(card);
    }
    return;
  }

  for (const p of data) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const role = p._role || 'viewer';
    const roleLabel = { owner: 'владелец', editor: 'редактор', viewer: 'просмотр' }[role] || role;
    card.innerHTML = `
      <div class="pc-head">
        <div class="pc-name" title="${escAttr(p.name)}">${escHtml(p.name)}</div>
        <div class="pc-role pc-role-${role}">${roleLabel}</div>
      </div>
      <div class="pc-meta">
        ${p.ownerName ? `<span>${escHtml(p.ownerName)}</span>` : ''}
      </div>
      <div class="pc-actions">
        <button class="pc-open">Открыть</button>
        ${role === 'owner' ? '<button class="pc-rename">Переименовать</button>' : ''}
        ${role === 'owner' ? '<button class="pc-delete">Удалить</button>' : ''}
      </div>
    `;
    card.querySelector('.pc-open').onclick = () => openProject(p.id);
    const rn = card.querySelector('.pc-rename');
    if (rn) rn.onclick = async () => {
      const name = prompt('Новое название проекта:', p.name);
      if (!name || name === p.name) return;
      try {
        await window.Storage.renameProject(p.id, name);
        refreshProjects();
      } catch (e) { flash(e.message || 'Ошибка', 'error'); }
    };
    const del = card.querySelector('.pc-delete');
    if (del) del.onclick = async () => {
      if (!confirm(`Удалить проект «${p.name}»? Это действие необратимо.`)) return;
      try {
        await window.Storage.deleteProject(p.id);
        refreshProjects();
      } catch (e) { flash(e.message || 'Ошибка', 'error'); }
    };
    els.projectsList.appendChild(card);
  }
}

function selectTab(name) {
  state.currentTab = name;
  els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  renderCurrentTab();
}

// ================= Открытие проекта =================
async function openProject(id) {
  try {
    const data = await window.Storage.getProject(id);
    if (!data) {
      flash('Проект не найден', 'error');
      showScreen('projects');
      await refreshProjects();
      return;
    }
    state.currentProject = data;

    // Схему даём редактору
    if (data.scheme) {
      window.Raschet.loadScheme(data.scheme);
      // Если в проекте нет сохранённых настроек — применить из localStorage
      if (!data.scheme.globalSettings) loadGlobalSettings();
    } else {
      window.Raschet.loadScheme(null);
      loadGlobalSettings();
    }

    // Роль и режим read-only
    const role = data._role || window.Storage.computeRole(data, state.currentUser);
    const readOnly = !(role === 'owner' || role === 'editor');
    window.Raschet.setReadOnly(readOnly);

    // Заголовок и кнопки
    els.projectName.textContent = data.name;
    els.projectName.classList.remove('hidden');
    els.btnSave.classList.toggle('hidden', readOnly);
    els.btnShare.classList.toggle('hidden', role !== 'owner');
    // Сбрасываем состояние автосохранения для свежезагруженного проекта
    state.dirty = false;
    state.saving = false;
    if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }
    updateSaveButton();
    // Запросить доступ — только для гостя залогиненного, не владельца и не участника
    const canRequestAccess = state.currentUser
      && role !== 'owner' && role !== 'editor' && role !== 'viewer';
    els.btnRequestAccess.classList.toggle('hidden', !canRequestAccess);
    pendingRequestProjectId = canRequestAccess ? id : null;

    showScreen('editor');

    // После отрисовки — fitAll (canvas теперь имеет размеры)
    requestAnimationFrame(() => window.Raschet.fit());

    // Обновить URL
    const url = new URL(location.href);
    url.searchParams.set('project', id);
    history.replaceState({}, '', url);
  } catch (e) {
    console.error(e);
    showScreen('projects');
    await refreshProjects();
    if (e && e.code === 'permission-denied') {
      showRequestAccessModal(id);
    } else {
      flash(e.message || 'Ошибка открытия проекта', 'error');
    }
  }
}

function backToProjects() {
  // Если есть несохранённые изменения — последний раз пытаемся сохранить синхронно
  if (state.dirty && state.currentProject && state.currentProject._role !== 'viewer') {
    saveCurrent(true).catch(() => {});
  }
  if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }
  state.dirty = false;
  state.saving = false;

  // Если находимся в редакторе проекта — возвращаемся к списку проектов
  // Если на экране проектов — переходим на главную (hub)
  if (state.currentProject) {
    state.currentProject = null;
    els.projectName.textContent = '';
    els.projectName.classList.add('hidden');
    els.btnSave.classList.add('hidden');
    els.btnShare.classList.add('hidden');
    els.btnRequestAccess.classList.add('hidden');
    const url = new URL(location.href);
    url.searchParams.delete('project');
    history.replaceState({}, '', url);
    document.body.classList.remove('palette-open', 'inspector-open');
    showScreen('projects');
    refreshProjects();
  } else {
    window.location.href = 'hub.html';
  }
}

// ================= Сохранение текущего проекта =================
function updateSaveButton() {
  const btn = els.btnSave;
  if (!btn || btn.classList.contains('hidden')) return;
  btn.classList.remove('dirty', 'saving', 'saved', 'save-error');
  if (state.saving) {
    btn.classList.add('saving');
    btn.textContent = 'Сохранение…';
  } else if (state.dirty) {
    btn.classList.add('dirty');
    btn.textContent = '● Сохранить';
  } else {
    btn.textContent = 'Сохранено';
    btn.classList.add('saved');
  }
}

function markDirty() {
  const p = state.currentProject;
  if (!p || p._role === 'viewer' || String(p.id || '').startsWith('_demo_')) return;
  state.dirty = true;
  updateSaveButton();
  scheduleAutoSave();
}

function scheduleAutoSave() {
  if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(() => {
    state.autoSaveTimer = null;
    if (state.dirty && !state.saving) saveCurrent(true);
  }, AUTO_SAVE_DELAY);
}

async function saveCurrent(isAuto) {
  const p = state.currentProject;
  if (!p) return;
  if (p._role === 'viewer') { if (!isAuto) flash('Только просмотр', 'error'); return; }
  if (String(p.id || '').startsWith('_demo_')) {
    if (!isAuto) flash('Это демо-схема, её нельзя сохранить. Создайте новый проект.', 'error');
    return;
  }
  if (state.saving) return;
  if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }
  state.saving = true;
  updateSaveButton();
  try {
    const scheme = window.Raschet.getScheme();
    await window.Storage.saveProject(p.id, { scheme });
    state.dirty = false;
    state.saving = false;
    updateSaveButton();
    if (!isAuto) flash('Сохранено');
  } catch (e) {
    console.error('[saveCurrent]', e);
    state.saving = false;
    els.btnSave.classList.remove('dirty', 'saving', 'saved');
    els.btnSave.classList.add('save-error');
    els.btnSave.textContent = 'Ошибка';
    flash(e.message || 'Ошибка сохранения', 'error');
    // Через 3 сек вернёмся к «● Сохранить», если ещё dirty
    setTimeout(() => {
      if (!state.saving) updateSaveButton();
    }, 3000);
  }
}

// ================= Защита паролем =================
function withPassword(action) {
  if (_pwdUnlocked) { action(); return; }
  _pwdCallback = action;
  els.pwdInput.value = '';
  openModal('modal-password');
  setTimeout(() => els.pwdInput.focus(), 50);
}
function submitPassword() {
  const v = els.pwdInput.value;
  if (v === NEW_PROJECT_PASSWORD) {
    _pwdUnlocked = true;
    closeModal('modal-password');
    const cb = _pwdCallback;
    _pwdCallback = null;
    if (cb) cb();
  } else {
    flash('Неверный пароль', 'error');
    els.pwdInput.value = '';
    els.pwdInput.focus();
  }
}

// ================= Новый проект =================
function showNewProjectModal() {
  withPassword(() => {
    els.newName.value = 'Новый проект';
    els.newDemo.checked = true;
    openModal('modal-new');
    setTimeout(() => els.newName.select(), 50);
  });
}

// ================= Загрузка проекта из файла =================
function showLoadProject() {
  withPassword(() => {
    els.loadProjectFile.value = '';
    els.loadProjectFile.click();
  });
}
async function handleLoadProjectFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const scheme = JSON.parse(text);
    if (!scheme || typeof scheme !== 'object' || !Array.isArray(scheme.nodes) || !Array.isArray(scheme.conns)) {
      throw new Error('Файл не похож на схему Raschet (нет nodes/conns)');
    }
    // Имя проекта: "<имя файла> (импорт DD.MM.YYYY HH:MM)"
    const base = f.name.replace(/\.json$/i, '');
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const name = `${base} (импорт ${stamp})`;
    const p = await window.Storage.createProject(name, scheme);
    flash('Проект загружен');
    await refreshProjects();
    openProject(p.id);
  } catch (err) {
    console.error('[load project]', err);
    flash(err.message || 'Не удалось загрузить файл', 'error');
  } finally {
    e.target.value = '';
  }
}
async function createNewProject() {
  const name = els.newName.value.trim() || 'Новый проект';
  const withDemo = els.newDemo.checked;
  try {
    let scheme = null;
    if (withDemo) {
      window.Raschet.loadDemo();
      scheme = window.Raschet.getScheme();
    }
    const p = await window.Storage.createProject(name, scheme);
    closeModal('modal-new');
    await refreshProjects();
    openProject(p.id);
  } catch (e) {
    flash(e.message || 'Ошибка создания', 'error');
  }
}

// ================= Шаринг =================
function openShareModal() {
  const p = state.currentProject;
  if (!p) return;
  if (p._role !== 'owner') { flash('Только владелец может делиться', 'error'); return; }
  renderShareMembers();
  els.shareVisibility.value = p.visibility || 'private';
  els.shareLink.value = buildShareLink(p.id);
  els.shareEmail.value = '';
  openModal('modal-share');
}

function renderShareMembers() {
  const p = state.currentProject;
  els.shareMembers.innerHTML = '';

  // Владелец
  const owner = document.createElement('div');
  owner.className = 'share-row';
  owner.innerHTML = `
    <div class="share-who">
      <div class="share-name">${escHtml(p.ownerName || '')}</div>
      <div class="share-email">${escHtml(p.ownerEmail || '')}</div>
    </div>
    <div class="share-role-label">владелец</div>
  `;
  els.shareMembers.appendChild(owner);

  // Остальные
  const members = p.members || {};
  const uids = Object.keys(members);
  if (uids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.cssText = 'font-size:12px;padding:6px 0';
    empty.textContent = 'Никому больше не предоставлен доступ';
    els.shareMembers.appendChild(empty);
    return;
  }
  for (const uid of uids) {
    const m = members[uid];
    const row = document.createElement('div');
    row.className = 'share-row';
    row.innerHTML = `
      <div class="share-who">
        <div class="share-name">${escHtml(m.name || m.email)}</div>
        <div class="share-email">${escHtml(m.email)}</div>
      </div>
      <select class="share-role-sel" data-uid="${escAttr(uid)}">
        <option value="viewer"${m.role === 'viewer' ? ' selected' : ''}>Просмотр</option>
        <option value="editor"${m.role === 'editor' ? ' selected' : ''}>Редактирование</option>
      </select>
      <button class="share-remove" data-uid="${escAttr(uid)}">×</button>
    `;
    els.shareMembers.appendChild(row);
  }
  els.shareMembers.querySelectorAll('.share-role-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      try {
        // Обновление роли — тот же механизм, что и добавление
        const m = p.members[sel.dataset.uid];
        await window.Storage.shareProject(p.id, m.email, sel.value);
        await reloadCurrentProjectMeta();
        renderShareMembers();
      } catch (e) { flash(e.message || 'Ошибка', 'error'); }
    });
  });
  els.shareMembers.querySelectorAll('.share-remove').forEach(btn => {
    btn.onclick = async () => {
      try {
        await window.Storage.unshareMember(p.id, btn.dataset.uid);
        await reloadCurrentProjectMeta();
        renderShareMembers();
      } catch (e) { flash(e.message || 'Ошибка', 'error'); }
    };
  });
}

async function reloadCurrentProjectMeta() {
  if (!state.currentProject) return;
  try {
    const fresh = await window.Storage.getProject(state.currentProject.id);
    if (fresh) {
      // Обновляем метаинформацию, но схему не трогаем (у пользователя может быть несохранённые правки)
      const { scheme, ...meta } = fresh;
      Object.assign(state.currentProject, meta);
    }
  } catch (e) { console.error(e); }
}

function buildShareLink(projectId) {
  const url = new URL(location.href);
  url.searchParams.set('project', projectId);
  return url.toString();
}

async function addShare() {
  const email = (els.shareEmail.value || '').trim().toLowerCase();
  const role = els.shareRole.value;
  if (!email) {
    flash('Введите email', 'error');
    els.shareEmail.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    flash('Неверный формат email', 'error');
    els.shareEmail.focus();
    return;
  }
  if (!window.Auth.isFirebaseReady) {
    flash('Совместный доступ доступен только после настройки Firebase', 'error');
    return;
  }
  try {
    await window.Storage.shareProject(state.currentProject.id, email, role);
    els.shareEmail.value = '';
    flash('Пользователь добавлен');
    await reloadCurrentProjectMeta();
    renderShareMembers();
  } catch (e) {
    console.error('[addShare]', e);
    flash(e.message || 'Ошибка при добавлении', 'error');
  }
}

// ================= Request access =================
let pendingRequestProjectId = null;
function showRequestAccessModal(projectId) {
  pendingRequestProjectId = projectId;
  openModal('modal-request');
}
async function sendAccessRequest() {
  if (!pendingRequestProjectId) return;
  if (!state.currentUser) {
    flash('Сначала войдите через Gmail', 'error');
    return;
  }
  try {
    await window.Storage.requestAccess(pendingRequestProjectId, 'viewer');
    flash('Запрос отправлен владельцу');
    closeModal('modal-request');
    backToProjects();
  } catch (e) {
    flash(e.message || 'Ошибка', 'error');
  }
}

// ================= Начальные условия (GLOBAL) =================
const SETTINGS_KEY = 'raschet.global.v1';
const SETTINGS_DEFAULTS = {
  voltage3ph: 400,
  voltage1ph: 230,
  defaultCosPhi: 0.92,
  defaultInstallMethod: 'B1',
  defaultAmbient: 30,
  defaultMaterial: 'Cu',
  defaultInsulation: 'PVC',
  defaultCableType: 'multi',
  maxCableSize: 240,
  maxParallelAuto: 10,
  maxVdropPct: 5,
  calcMethod: 'iec',
  parallelProtection: 'individual',
  earthingSystem: 'TN-S',
};

// Legacy no-op: загрузка GLOBAL из localStorage теперь выполняется единожды
// в engine/index.js через shared/global-settings.js#loadGlobal(). Все дальнейшие
// изменения идут через window.Raschet.setGlobal() → saveGlobal() → listeners.
// Функция оставлена для совместимости с местами, где она вызывалась.
function loadGlobalSettings() { /* no-op */ }

// Таблица уровней напряжения перенесена в «Глобальные настройки платформы»
// (shared/global-settings.js) — единый источник правды.

function updateInstallMethodOptions(methodId) {
  const sel = document.getElementById('set-installMethod');
  if (!sel) return;
  const m = getMethod(methodId || 'iec');
  const prev = sel.value;
  sel.innerHTML = Object.entries(m.installMethods).map(([k, v]) =>
    `<option value="${k}">${v}</option>`
  ).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  else if (m.defaultMethod) sel.value = m.defaultMethod;
}

function openSettingsModal() {
  // Параметры расчёта (методология) — только расчётные поля
  const G = (window.Raschet && window.Raschet.getGlobal) ? window.Raschet.getGlobal() : SETTINGS_DEFAULTS;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('set-cosPhi',              G.defaultCosPhi ?? 0.92);
  set('set-earthingSystem',      G.earthingSystem ?? 'TN-S');
  set('set-maxParallelAuto',     G.maxParallelAuto ?? 10);
  set('set-maxVdropPct',         G.maxVdropPct ?? 5);
  set('set-calcMethod',          G.calcMethod ?? 'iec');
  set('set-parallelProtection',  G.parallelProtection ?? 'individual');
  set('set-breakerMinMarginPct', G.breakerMinMarginPct ?? 0);
  const showHelpEl = document.getElementById('set-showHelp');
  if (showHelpEl) showHelpEl.checked = G.showHelp !== false;
  const redNEl = document.getElementById('set-allowReducedNeutral');
  if (redNEl) redNEl.checked = !!G.allowReducedNeutral;
  openModal('modal-settings');
}

function saveSettingsModal() {
  const get = (id) => document.getElementById(id)?.value;
  const G = window.Raschet.getGlobal();
  const patch = {
    voltageLevels:        G.voltageLevels,
    defaultCosPhi:        Number(get('set-cosPhi')) || 0.92,
    earthingSystem:       get('set-earthingSystem') || 'TN-S',
    maxParallelAuto:      Number(get('set-maxParallelAuto')) || 10,
    maxVdropPct:          Number(get('set-maxVdropPct')) || 5,
    calcMethod:           get('set-calcMethod') || 'iec',
    parallelProtection:   get('set-parallelProtection') || 'individual',
    breakerMinMarginPct:  Math.max(0, Number(get('set-breakerMinMarginPct')) || 0),
    showHelp:             !!document.getElementById('set-showHelp')?.checked,
    allowReducedNeutral:  !!document.getElementById('set-allowReducedNeutral')?.checked,
  };
  if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
    window.Raschet.setGlobal(patch);
  }
  closeModal('modal-settings');
  flash('Параметры расчёта применены');
}

// ================= Параметры проекта (кабельные умолчания) =================
// Выделены из «Параметров расчёта» в отдельную модалку в Фазе 1.16.
function openProjectParamsModal() {
  const G = (window.Raschet && window.Raschet.getGlobal) ? window.Raschet.getGlobal() : SETTINGS_DEFAULTS;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('pp-material',       G.defaultMaterial ?? 'Cu');
  set('pp-insulation',     G.defaultInsulation ?? 'PVC');
  set('pp-cableType',      G.defaultCableType ?? 'multi');
  set('pp-maxCableSize',   G.maxCableSize ?? 240);
  set('pp-ambient',        G.defaultAmbient ?? 30);
  // Способ прокладки — список зависит от методики
  const m = getMethod(G.calcMethod || 'iec');
  const sel = document.getElementById('pp-installMethod');
  if (sel) {
    sel.innerHTML = Object.entries(m.installMethods).map(([k, v]) =>
      `<option value="${k}">${v}</option>`).join('');
    sel.value = G.defaultInstallMethod ?? (m.defaultMethod || 'B1');
  }
  // Основная марка кабеля по проекту — из справочника cable-types
  (async () => {
    try {
      const mod = await import('../shared/cable-types-catalog.js');
      const list = mod.listCableTypes ? mod.listCableTypes() : [];
      const lvList = list.filter(ct => (ct.category || 'power') === 'power');
      const hvList = list.filter(ct => (ct.category || 'power') === 'hv');
      const lvSel = document.getElementById('pp-mainCableLv');
      const hvSel = document.getElementById('pp-mainCableHv');
      if (lvSel) {
        lvSel.innerHTML = '<option value="">— не задано —</option>' +
          lvList.map(ct => `<option value="${ct.id}">${ct.brand || ct.id}</option>`).join('');
        lvSel.value = G.projectMainCableLv || '';
      }
      if (hvSel) {
        hvSel.innerHTML = '<option value="">— не задано —</option>' +
          hvList.map(ct => `<option value="${ct.id}">${ct.brand || ct.id}</option>`).join('');
        hvSel.value = G.projectMainCableHv || '';
      }
    } catch (e) { console.warn('[project-params] cable-types', e); }
  })();
  openModal('modal-project-params');
}

function saveProjectParamsModal() {
  const get = (id) => document.getElementById(id)?.value;
  const patch = {
    defaultMaterial:      get('pp-material') || 'Cu',
    defaultInsulation:    get('pp-insulation') || 'PVC',
    defaultCableType:     get('pp-cableType') || 'multi',
    maxCableSize:         Number(get('pp-maxCableSize')) || 240,
    defaultInstallMethod: get('pp-installMethod') || 'B1',
    defaultAmbient:       Number(get('pp-ambient')) || 30,
    projectMainCableLv:   get('pp-mainCableLv') || null,
    projectMainCableHv:   get('pp-mainCableHv') || null,
  };
  if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
    window.Raschet.setGlobal(patch);
  }
  closeModal('modal-project-params');
  flash('Параметры проекта применены');
}
window.__raschetOpenProjectParams = function() { openProjectParamsModal(); };

window.__raschetOpenProjectInfo = function() { openProjectInfoModal(); };

function openProjectInfoModal() {
  const pi = (window.Raschet?._state?.project) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('pi-designation', pi.designation);
  set('pi-name',        pi.name);
  set('pi-customer',    pi.customer);
  set('pi-object',      pi.object);
  set('pi-stage',       pi.stage);
  set('pi-author',      pi.author);
  set('pi-description', pi.description);
  openModal('modal-project-info');
}

function saveProjectInfoModal() {
  const get = (id) => document.getElementById(id)?.value || '';
  if (!window.Raschet?._state) return;
  window.Raschet._state.project = {
    designation: get('pi-designation').trim(),
    name:        get('pi-name').trim(),
    customer:    get('pi-customer').trim(),
    object:      get('pi-object').trim(),
    stage:       get('pi-stage').trim(),
    author:      get('pi-author').trim(),
    description: get('pi-description').trim(),
  };
  closeModal('modal-project-info');
  flash('Свойства проекта сохранены');
  // Нотификация о смене для сохранения в БД / localStorage
  if (typeof window.Raschet.notifyChange === 'function') window.Raschet.notifyChange();
}

function resetSettingsModal() {
  if (!confirm('Сбросить все начальные условия к значениям по умолчанию?')) return;
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  // Перезагружаем страницу чтобы engine заново инициализировал GLOBAL
  // из DEFAULTS global-settings.js (единый источник правды).
  location.reload();
}

// ================= Библиотека пресетов =================
function openPresetsModal() {
  if (state.currentProject && state.currentProject._role === 'viewer') {
    flash('Только просмотр', 'error'); return;
  }
  renderPresets('');
  els.presetsSearch.value = '';
  openModal('modal-presets');
  setTimeout(() => els.presetsSearch.focus(), 50);
}
// Генерация описания пресета из его параметров
function presetAutoDesc(p) {
  const pr = p.params || {};
  const type = p.type;
  const parts = [];
  if (type === 'source' || type === 'generator') {
    if (pr.capacityKw) parts.push(`${pr.capacityKw} kW`);
    if (pr.snomKva) parts.push(`${pr.snomKva} кВА`);
    if (type === 'generator' && pr.backupMode) parts.push('резерв');
  } else if (type === 'panel') {
    if (pr.capacityA) parts.push(`In ${pr.capacityA} А`);
    parts.push(`вх ${pr.inputs || 1}, вых ${pr.outputs || 4}`);
    const modes = { auto: 'АВР', parallel: '', avr_paired: 'АВР привязка', switchover: 'подменный' };
    if (pr.switchMode && modes[pr.switchMode]) parts.push(modes[pr.switchMode]);
  } else if (type === 'ups') {
    if (pr.capacityKw) parts.push(`${pr.capacityKw} kW`);
    if (pr.efficiency) parts.push(`КПД ${pr.efficiency}%`);
    if (pr.batteryKwh) parts.push(`АКБ ${pr.batteryKwh} kWh`);
  } else if (type === 'consumer') {
    const cnt = pr.count || 1;
    const kw = pr.demandKw || 0;
    if (cnt > 1) parts.push(`${cnt} × ${kw} kW`);
    else if (kw) parts.push(`${kw} kW`);
    if (pr.cosPhi && pr.cosPhi !== 0.92) parts.push(`cos φ ${pr.cosPhi}`);
    if (pr.inputs > 1) parts.push(`вх ${pr.inputs}`);
  } else if (type === 'channel') {
    if (pr.lengthM) parts.push(`${pr.lengthM} м`);
  }
  return parts.join(', ');
}

// Получить отображаемое имя пресета (= params.name или title)
function presetDisplayName(p) {
  return p.params?.name || p.title || '(без имени)';
}

// Рендер пресетов в левой палитре по type-секциям.
// Базовые пресеты + пользовательские (PRESETS из presets.js)
function renderPalettePresets() {
  if (!window.Presets) return;
  const presets = window.Presets.all || [];
  // Группируем по type
  const byType = new Map();
  for (const p of presets) {
    if (!p.type) continue;
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(p);
  }
  // Рендер в каждый контейнер .pal-presets[data-pal-presets-type]
  // Фаза 1.19.12: для type='panel' дополнительно фильтруем по
  // data-pal-voltage (lv/mv) — НКУ и РУ СН должны быть в разных секциях.
  document.querySelectorAll('.pal-presets').forEach(container => {
    const type = container.dataset.palPresetsType;
    const voltage = container.dataset.palVoltage; // 'lv' | 'mv' | undefined
    let list = byType.get(type) || [];
    if (type === 'panel' && voltage) {
      const MV_CATEGORIES = new Set(['Среднее напряжение', 'РУ СН', 'MV']);
      list = list.filter(p => {
        const isMvCat = MV_CATEGORIES.has(p.category);
        const isMvParam = !!(p.params && (p.params.isMv || p.params.mvSwitchgearId));
        const isMv = isMvCat || isMvParam;
        return voltage === 'mv' ? isMv : !isMv;
      });
    }
    container.innerHTML = '';
    for (const p of list) {
      const isBuiltin = typeof window.Presets.isBuiltin === 'function' && window.Presets.isBuiltin(p.id);
      const item = document.createElement('div');
      // user-preset класс = не-базовые (новые или изменённые) — для визуального маркера
      item.className = 'pal-item pal-preset' + (isBuiltin ? '' : ' user-preset');
      item.draggable = true;
      item.dataset.presetId = p.id;
      item.dataset.type = p.type;
      item.title = (p.description || '') + (p.description ? ' · ' : '') + presetAutoDesc(p);
      item.innerHTML =
        `<span class="pp-title">${escHtml(presetDisplayName(p))}</span>` +
        `<span class="pp-meta">${escHtml(presetAutoDesc(p).slice(0, 24))}</span>` +
        `<span class="pp-actions">` +
        `<button class="pp-btn pp-dup" title="Дублировать">⧉</button>` +
        `<button class="pp-btn pp-edit" title="Редактировать">✎</button>` +
        `<button class="pp-btn pp-del" title="Удалить">✕</button>` +
        `</span>`;
      container.appendChild(item);
      if (typeof window.__raschetBindPalItem === 'function') {
        window.__raschetBindPalItem(item);
      }
    }
  });
  // Добавим кнопку «+ новый пресет» в конец каждой секции, если она ещё не добавлена
  document.querySelectorAll('.pal-type-items').forEach(section => {
    if (section.querySelector('.pal-add-preset-btn')) return;
    const type = section.closest('.pal-type')?.dataset.palType;
    if (!type) return;
    const btn = document.createElement('button');
    btn.className = 'pal-add-preset-btn';
    btn.type = 'button';
    btn.textContent = '+ Сохранить текущий выбранный в библиотеку';
    btn.style.cssText = 'width:100%;margin-top:4px;padding:5px;font-size:10px;background:transparent;border:1px dashed #3a4150;border-radius:4px;color:#6b7280;cursor:pointer';
    btn.addEventListener('click', () => savePresetFromCurrentSelection(type));
    section.appendChild(btn);
  });
  wirePalettePresetActions();
}

// Handler для кнопок действий пресетов
function wirePalettePresetActions() {
  document.querySelectorAll('.pal-preset').forEach(item => {
    if (item._wiredActions) return;
    item._wiredActions = true;
    const presetId = item.dataset.presetId;
    const dupBtn = item.querySelector('.pp-dup');
    const editBtn = item.querySelector('.pp-edit');
    const delBtn = item.querySelector('.pp-del');
    if (dupBtn) dupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicatePresetToUser(presetId);
    });
    if (editBtn) editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Открываем полноценный редактор через реальные модалки параметров
      // (тип-специфические, с валидацией и всеми полями), а не простой
      // prompt для переименования. После сохранения палитра обновляется.
      const preset = window.Presets?.get(presetId);
      if (!preset) return;
      editPresetViaModal(preset);
    });
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePreset(presetId);
    });
  });
}

function duplicatePresetToUser(presetId) {
  if (!window.Presets) return;
  const src = window.Presets.get(presetId);
  if (!src) return;
  const label = prompt('Название копии:', (src.params?.name || src.title || 'Копия') + ' (копия)');
  if (!label) return;
  const newPreset = {
    id: 'up_' + Date.now(),
    category: src.category || 'Пользовательские',
    title: label,
    description: src.description || '',
    type: src.type,
    params: { ...(src.params || {}), name: label },
  };
  window.Presets.add(newPreset);
  renderPalettePresets();
  flash('Сохранён как пользовательский пресет');
}

// Редактирование имени пресета (работает для базовых и user — базовый сохранится в overrides)
function editPresetLabel(presetId) {
  if (!window.Presets) return;
  const p = window.Presets.get(presetId);
  if (!p) return;
  const label = prompt('Название:', p.params?.name || p.title || '');
  if (label === null) return;
  const patch = { title: label, params: { ...(p.params || {}), name: label } };
  window.Presets.update(presetId, patch);
  renderPalettePresets();
}

function deletePreset(presetId) {
  if (!window.Presets) return;
  const p = window.Presets.get(presetId);
  if (!p) return;
  const isBuiltin = window.Presets.isBuiltin && window.Presets.isBuiltin(presetId);
  const msg = isBuiltin
    ? `Удалить базовый пресет «${presetDisplayName(p)}»?\n\nПресет скроется из палитры. Восстановить его можно через «Сбросить библиотеку» в настройках.`
    : `Удалить пресет «${presetDisplayName(p)}»?`;
  if (!confirm(msg)) return;
  window.Presets.remove(presetId);
  renderPalettePresets();
  flash(isBuiltin ? 'Пресет скрыт' : 'Пресет удалён');
}

function savePresetFromCurrentSelection(type) {
  const sel = window.Raschet?._state?.selectedId;
  const node = sel && window.Raschet?._state?.nodes?.get(sel);
  if (!node || node.type !== type) {
    flash(`Сначала выделите на холсте объект типа «${type}», затем нажмите эту кнопку`, 'warn');
    return;
  }
  const label = prompt('Название нового пресета:', node.name || type);
  if (!label) return;
  const params = {};
  for (const k of Object.keys(node)) {
    if (k.startsWith('_') || k === 'id' || k === 'x' || k === 'y' || k === 'tag' || k === 'pageIds') continue;
    params[k] = node[k];
  }
  params.name = label;
  const newPreset = {
    id: 'up_' + Date.now(),
    category: 'Пользовательские',
    title: label,
    description: '',
    type,
    params,
  };
  if (window.Presets) window.Presets.add(newPreset);
  renderPalettePresets();
  flash('Сохранено в библиотеку');
}

// Ресайз левой палитры через drag ручки, с сохранением в localStorage
function wirePaletteResizer() {
  const resizer = document.getElementById('palette-resizer');
  if (!resizer) return;
  // Применяем сохранённую ширину
  try {
    const savedW = parseInt(localStorage.getItem('raschet.paletteWidth') || '0', 10);
    if (savedW >= 200 && savedW <= 800) {
      document.documentElement.style.setProperty('--palette-w', savedW + 'px');
    }
  } catch {}
  let startX = 0, startW = 0, dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    startX = e.clientX;
    const palette = document.getElementById('palette');
    startW = palette ? palette.getBoundingClientRect().width : 280;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(800, startW + dx));
    document.documentElement.style.setProperty('--palette-w', newW + 'px');
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Сохранить
    try {
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--palette-w'), 10);
      if (w >= 200 && w <= 800) {
        localStorage.setItem('raschet.paletteWidth', String(w));
      }
    } catch {}
    // Обновить viewBox холста на случай изменения ширины
    if (window.Raschet?._state && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('resize'));
    }
  });
}

// Поиск по палитре — фильтрует видимость элементов и секций
function wirePaletteSearch() {
  const input = document.getElementById('palette-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const types = document.querySelectorAll('.pal-type');
    types.forEach(typeSec => {
      let anyVisible = false;
      const items = typeSec.querySelectorAll('.pal-item, .pal-preset');
      items.forEach(it => {
        if (!q) {
          it.classList.remove('hidden');
          anyVisible = true;
          return;
        }
        const text = it.textContent.toLowerCase();
        const titleAttr = (it.getAttribute('title') || '').toLowerCase();
        const matches = text.includes(q) || titleAttr.includes(q);
        it.classList.toggle('hidden', !matches);
        if (matches) anyVisible = true;
      });
      typeSec.classList.toggle('hidden', !!q && !anyVisible);
      // При поиске автоматически раскрываем секции где есть совпадения
      if (q && anyVisible) typeSec.classList.remove('collapsed');
    });
  });
}

function renderPresets(query) {
  if (!window.Presets) { els.presetsList.innerHTML = '<div class="muted">Библиотека не загружена</div>'; return; }
  const q = (query || '').toLowerCase().trim();
  const groups = window.Presets.byCategory();
  const parts = [];
  for (const [cat, list] of groups) {
    const filtered = q
      ? list.filter(p => (p.title + ' ' + p.description + ' ' + cat).toLowerCase().includes(q))
      : list;
    if (!filtered.length) continue;
    const CAT_TYPE = {
      'Источники': 'source', 'Генераторы': 'generator',
      'Щиты': 'panel', 'НКУ': 'panel', 'Среднее напряжение': 'panel', 'РУ СН': 'panel',
      'ИБП': 'ups', 'Потребители': 'consumer', 'Каналы': 'channel',
    };
    const catType = CAT_TYPE[cat] || 'consumer';
    parts.push(`<div class="preset-group" style="display:flex;align-items:center;justify-content:space-between"><h4 style="margin:0">${escHtml(cat)}</h4><button class="pc-btn pc-cat-add" data-cat-type="${catType}" data-cat-name="${escAttr(cat)}" title="Добавить новый элемент в ${escAttr(cat)}" style="font-size:16px">+</button></div>`);
    for (const p of filtered) {
      const isCustom = !!(p.custom);
      parts.push(
        `<div class="preset-card" data-id="${escAttr(p.id)}" draggable="true">` +
        `<div class="pc-body">` +
        `<div class="pc-title">${escHtml(presetDisplayName(p))}</div>` +
        `<div class="pc-desc">${escHtml(presetAutoDesc(p))}</div>` +
        `</div>` +
        `<div class="pc-actions">` +
        `<button class="pc-btn pc-add" data-add-id="${escAttr(p.id)}" title="Вставить на холст">⎘</button>` +
        `<button class="pc-btn pc-dup" data-dup-id="${escAttr(p.id)}" title="Дублировать">⧉</button>` +
        `<button class="pc-btn pc-edit" data-edit-id="${escAttr(p.id)}" title="Редактировать параметры">✎</button>` +
        (isCustom ? `<button class="pc-btn pc-del" data-del-id="${escAttr(p.id)}" title="Удалить">✕</button>` : '') +
        `</div>` +
        `</div>`
      );
    }
  }
  els.presetsList.innerHTML = parts.join('') || '<div class="muted" style="padding:20px;text-align:center">Ничего не найдено</div>';

  // Drag from library to canvas
  els.presetsList.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/raschet-preset', card.dataset.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  // Click copy button → insert at center
  els.presetsList.querySelectorAll('.pc-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const p = window.Presets.get(btn.dataset.addId);
      if (!p) return;
      window.Raschet.applyPreset(p);
      closeModal('modal-presets');
      flash('Добавлено: ' + presetDisplayName(p));
    });
  });

  // Click edit button → edit via real parameter modal
  els.presetsList.querySelectorAll('.pc-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const preset = window.Presets.get(btn.dataset.editId);
      if (!preset) return;
      editPresetViaModal(preset);
    });
  });

  // Click delete button → remove custom preset
  els.presetsList.querySelectorAll('.pc-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Удалить этот элемент из библиотеки?')) return;
      window.Presets.removeUser(btn.dataset.delId);
      renderPresets(els.presetsSearch.value);
      flash('Удалено');
    });
  });

  // Duplicate button
  els.presetsList.querySelectorAll('.pc-dup').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const src = window.Presets.get(btn.dataset.dupId);
      if (!src) return;
      const srcName = src.params?.name || src.title;
      const dupName = srcName + ' (копия)';
      const dup = {
        id: 'user-' + Date.now().toString(36),
        category: src.category,
        title: dupName,
        description: '',
        type: src.type,
        params: JSON.parse(JSON.stringify(src.params || {})),
        custom: true,
      };
      dup.params.name = dupName;
      if (typeof window.Presets.add === 'function') window.Presets.add(dup);
      renderPresets(els.presetsSearch.value);
      flash('Дублировано: ' + dup.title);
    });
  });

  // "+" button in category headers — add new custom preset of that type
  els.presetsList.querySelectorAll('.pc-cat-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const type = btn.dataset.catType;
      const catName = btn.dataset.catName;
      const title = prompt('Название нового элемента:');
      if (!title) return;
      const DEFAULTS_MAP = {
        source:    { name: title, capacityKw: 400, on: true },
        generator: { name: title, capacityKw: 100, on: true, backupMode: true },
        panel:     { name: title, inputs: 1, outputs: 4, switchMode: 'auto' },
        ups:       { name: title, capacityKw: 10, efficiency: 94, inputs: 1, outputs: 2 },
        consumer:  { name: title, demandKw: 10, count: 1, cosPhi: 0.92, kUse: 1, inrushFactor: 1, inputs: 1 },
        channel:   { name: title },
      };
      const preset = {
        id: 'user-' + Date.now().toString(36),
        category: catName,
        title,
        description: '',
        type,
        params: DEFAULTS_MAP[type] || { name: title },
        custom: true,
      };
      if (typeof window.Presets.add === 'function') window.Presets.add(preset);
      renderPresets(els.presetsSearch.value);
      // Open editor immediately — используем общий редактор через реальные
      // модалки параметров (openPresetEditor в коде не существует).
      editPresetViaModal(preset);
    });
  });
}

// Редактирование пресета через реальные модалки параметров.
// Создаём виртуальный узел из preset.params, открываем модалку,
// при Apply — сохраняем params обратно в preset.
function editPresetViaModal(preset) {
  if (!window.Raschet) return;
  const R = window.Raschet;
  const type = preset.type;
  const params = preset.params || {};

  // Создаём виртуальный узел (не добавляется в state)
  const defaults = R.getDefaults?.(type) || {};
  const vNode = { id: '__preset_edit__', type, ...defaults, ...params, tag: 'LIB', x: 0, y: 0 };

  // Подменяем Apply-callback: вместо сохранения в state — сохраняем в preset
  const origApply = R._presetEditCallback;
  R._presetEditCallback = (node) => {
    // Копируем все параметры из виртуального узла обратно в preset
    const skip = new Set(['id', 'x', 'y', 'tag', 'type']);
    const newParams = { ...(preset.params || {}) };
    for (const k of Object.keys(node)) {
      if (skip.has(k) || k.startsWith('_')) continue;
      newParams[k] = node[k];
    }
    let newTitle = preset.title;
    if (node.name && node.name !== 'LIB') {
      newParams.name = node.name;
      newTitle = node.name;
    }
    // Сохраняем через публичный Presets API — работает для user-пресетов
    // и для встроенных (через overrides). Fallback на старую логику с
    // localStorage сохраняется на случай если Presets.update отсутствует.
    let saved = false;
    if (window.Presets && typeof window.Presets.update === 'function') {
      try {
        window.Presets.update(preset.id, { title: newTitle, params: newParams });
        // Обновляем переданный объект preset inline — чтобы вызывающая
        // сторона видела актуальные данные.
        preset.title = newTitle;
        preset.params = newParams;
        saved = true;
      } catch (e) { console.warn('Presets.update failed, fallback', e); }
    }
    if (!saved) {
      preset.title = newTitle;
      preset.params = newParams;
      if (preset.custom) {
        try {
          const stored = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
          const idx = stored.findIndex(p => p.id === preset.id);
          if (idx >= 0) stored[idx] = preset;
          else stored.push(preset);
          localStorage.setItem('raschet.userPresets.v1', JSON.stringify(stored));
        } catch {}
      }
    }
    // Обновляем обе панели с пресетами — модальная библиотека и сайдбар
    if (els?.presetsSearch && typeof renderPresets === 'function') {
      renderPresets(els.presetsSearch.value);
    }
    if (typeof renderPalettePresets === 'function') {
      renderPalettePresets();
    }
    flash('Параметры обновлены');
    R._presetEditCallback = null;
  };

  // Открываем соответствующую модалку
  if (type === 'consumer') R.openConsumerParamsModal(vNode);
  else if (type === 'ups') R.openUpsParamsModal(vNode);
  else if (type === 'panel') R.openPanelParamsModal(vNode);
  else if (type === 'source' || type === 'generator') R.openImpedanceModal(vNode);
  else {
    // Для типов без модалки — простой prompt
    const name = prompt('Имя элемента:', params.name || preset.title);
    if (name !== null) {
      preset.params.name = name;
      preset.title = name;
      if (preset.custom) {
        try {
          const stored = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
          const idx = stored.findIndex(p => p.id === preset.id);
          if (idx >= 0) stored[idx] = preset;
          else stored.push(preset);
          localStorage.setItem('raschet.userPresets.v1', JSON.stringify(stored));
        } catch {}
      }
      renderPresets(els.presetsSearch.value);
    }
    R._presetEditCallback = null;
  }
}

// ================= Справочник типов потребителей =================
function openConsumerCatalogModal() {
  renderConsumerCatalogModal();
  openModal('modal-consumer-catalog');
}
function renderConsumerCatalogModal() {
  const body = document.getElementById('consumer-catalog-body');
  if (!body) return;
  const G = window.Raschet.getGlobal();
  const CATALOG = window.Raschet.getConsumerCatalog();
  const customs = G.customConsumerCatalog || [];
  // Определения категорий (с fallback на случай если модуль не экспортирован)
  const CAT_DEFS = {
    lighting:   { label: 'Освещение', icon: '💡' },
    socket:     { label: 'Розеточные группы', icon: '🔌' },
    power:      { label: 'Силовая нагрузка', icon: '⚙' },
    hvac:       { label: 'Климат / вентиляция', icon: '❄' },
    it:         { label: 'IT / серверы', icon: '🖥' },
    lowvoltage: { label: 'Слаботочные системы', icon: '📡' },
    process:    { label: 'Технологическая', icon: '🏭' },
    other:      { label: 'Прочее', icon: '—' },
  };
  const h = [];
  // Группируем типы по категориям
  const byCat = {};
  for (const cat of CATALOG) {
    const cId = cat.category || 'other';
    if (!byCat[cId]) byCat[cId] = { builtin: [], custom: [] };
    if (cat.id.startsWith('user_')) {
      const ci = customs.findIndex(c => c.id === cat.id);
      byCat[cId].custom.push({ cat, ci });
    } else {
      byCat[cId].builtin.push(cat);
    }
  }
  for (const [catId, catDef] of Object.entries(CAT_DEFS)) {
    const grp = byCat[catId];
    if (!grp || (grp.builtin.length === 0 && grp.custom.length === 0)) continue;
    h.push(`<h4 style="margin:12px 0 6px;font-size:12px;color:#444">${catDef.icon} ${escHtml(catDef.label)}</h4>`);
    for (const cat of grp.builtin) {
      h.push(`<div style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 16px;border-bottom:1px solid #f0f0f0">`);
      h.push(`<span style="flex:1;font-size:13px">${escHtml(cat.label)} <span style="color:#999;font-size:11px">cos φ ${cat.cosPhi}, Ки ${cat.kUse}</span></span>`);
      h.push('</div>');
    }
    for (const { cat, ci } of grp.custom) {
      h.push(`<div style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 16px;border-bottom:1px solid #f0f0f0">`);
      h.push(`<span style="flex:1;font-size:13px"><b>${escHtml(cat.label)}</b> <span style="color:#999;font-size:11px">cos φ ${cat.cosPhi}, Ки ${cat.kUse}</span></span>`);
      h.push(`<button class="cc-edit" data-cc-idx="${ci}" style="background:none;border:none;cursor:pointer;font-size:14px;color:#666" title="Редактировать">✎</button>`);
      h.push(`<button class="cc-del" data-cc-idx="${ci}" style="background:none;border:none;cursor:pointer;font-size:14px;color:#ccc" title="Удалить">✕</button>`);
      h.push('</div>');
    }
  }
  body.innerHTML = h.join('');
  // Wire edit/delete
  body.querySelectorAll('.cc-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.ccIdx);
      const cat = customs[idx];
      if (!cat) return;
      const label = prompt('Название:', cat.label);
      if (label === null) return;
      cat.label = label;
      const catPrompt = prompt('Категория (lighting / socket / power / hvac / it / lowvoltage / process / other):', cat.category || 'other');
      if (catPrompt !== null && CAT_DEFS[catPrompt]) cat.category = catPrompt;
      const cos = prompt('cos φ:', cat.cosPhi);
      if (cos !== null) cat.cosPhi = Number(cos) || cat.cosPhi;
      const ku = prompt('Ки:', cat.kUse);
      if (ku !== null) cat.kUse = Number(ku) ?? cat.kUse;
      window.Raschet.setGlobal({ customConsumerCatalog: customs });
      if (typeof window.__raschetPersistUserCatalog === 'function') window.__raschetPersistUserCatalog();
      renderConsumerCatalogModal();
    });
  });
  body.querySelectorAll('.cc-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.ccIdx);
      if (!confirm('Удалить тип «' + (customs[idx]?.label || '') + '»?')) return;
      customs.splice(idx, 1);
      window.Raschet.setGlobal({ customConsumerCatalog: customs });
      if (typeof window.__raschetPersistUserCatalog === 'function') window.__raschetPersistUserCatalog();
      renderConsumerCatalogModal();
      flash('Тип удалён');
    });
  });
}

// ================= Отчёты =================
// Кэш сформированных секций: строим один раз на открытие модалки,
// чтобы каждая кнопка (Текст / PDF / DOCX) оперировала одним снимком.
let _reportSections = null;
let _reportBuiltinsSeeded = false;

// Встроенные шаблоны отчётов сидятся на странице reports/ при первом
// её открытии. Конструктор схем может быть открыт раньше — тогда
// каталог пуст и pickTemplate покажет подсказку. Чтобы этого избежать,
// при первом открытии модалки отчётов досеиваем встроенные шаблоны,
// если их в каталоге пользователя ещё нет.
function ensureReportBuiltinsSeeded() {
  if (_reportBuiltinsSeeded) return;
  _reportBuiltinsSeeded = true;
  try {
    for (const rec of REPORT_BUILTIN_TEMPLATES) {
      if (!getReportTemplate(rec.id)) saveReportTemplate(rec);
    }
  } catch (e) {
    console.warn('[reports] seed builtins failed', e);
  }
}

function openReportsModal() {
  ensureReportBuiltinsSeeded();
  try {
    _reportSections = window.Raschet.getReportSections();
  } catch (e) {
    console.error(e);
    flash('Ошибка формирования отчётов: ' + (e && e.message ? e.message : e), 'error');
    return;
  }
  renderReportsList();
  openModal('modal-reports');
}

function renderReportsList() {
  const host = els.reportsList;
  if (!host) return;
  host.innerHTML = '';
  if (!_reportSections || !_reportSections.length) {
    host.innerHTML = '<div class="muted">Нет данных для отчётов.</div>';
    return;
  }
  for (const sec of _reportSections) {
    const tplRec = sec.defaultTemplateId ? getReportTemplate(sec.defaultTemplateId) : null;
    const tplName = tplRec ? tplRec.name : '—';
    const item = document.createElement('div');
    item.className = 'rpt-item';
    const main = document.createElement('div');
    main.className = 'rpt-item__main';
    const title = document.createElement('div');
    title.className = 'rpt-item__title';
    title.textContent = sec.title;
    main.appendChild(title);
    if (sec.description) {
      const d = document.createElement('div');
      d.className = 'rpt-item__desc';
      d.textContent = sec.description;
      main.appendChild(d);
    }
    const tpl = document.createElement('div');
    tpl.className = 'rpt-item__tpl';
    tpl.innerHTML = 'Шаблон по умолчанию: <b>' + escHtml(tplName) + '</b>';
    main.appendChild(tpl);
    item.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'rpt-item__actions';
    const btnText = document.createElement('button');
    btnText.type = 'button';
    btnText.textContent = 'Текст';
    btnText.title = 'Быстрое текстовое превью';
    btnText.addEventListener('click', () => showReportText(sec));
    actions.appendChild(btnText);
    const btnPdf = document.createElement('button');
    btnPdf.type = 'button';
    btnPdf.className = 'primary';
    btnPdf.textContent = 'PDF';
    btnPdf.addEventListener('click', () => exportReportSection(sec, 'pdf'));
    actions.appendChild(btnPdf);
    const btnDocx = document.createElement('button');
    btnDocx.type = 'button';
    btnDocx.textContent = 'DOCX';
    btnDocx.addEventListener('click', () => exportReportSection(sec, 'docx'));
    actions.appendChild(btnDocx);
    item.appendChild(actions);
    host.appendChild(item);
  }
}

function showReportText(sec) {
  if (els.reportTitle) els.reportTitle.textContent = sec.title;
  els.reportBody.textContent = sec.text || '(пусто)';
  openModal('modal-report');
}

async function exportReportSection(sec, kind) {
  try {
    const rec = await Report.pickTemplate({
      title: 'Выбор шаблона: ' + sec.title,
      tags: sec.tags,
      defaultId: sec.defaultTemplateId,
    });
    if (!rec) return;
    const tpl = Report.createTemplate(rec.template);
    tpl.meta = tpl.meta || {};
    tpl.meta.title = sec.title;
    if (!tpl.meta.author) {
      const proj = (window.Raschet && window.Raschet._state && window.Raschet._state.project) || {};
      tpl.meta.author = proj.author || '';
    }
    tpl.content = sec.blocks;
    const filename = sec.title.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    if (kind === 'docx') {
      await Report.exportDOCX(tpl, filename);
    } else {
      await Report.exportPDF(tpl, filename);
    }
  } catch (e) {
    console.error(e);
    flash('Не удалось сформировать ' + kind.toUpperCase() + ': ' + (e && e.message ? e.message : e), 'error');
  }
}

// ================= Таблица кабелей (Фаза 1.20) =================
// Быстрое редактирование всех кабельных линий: марка, длина, способ прокладки.
// Изменения применяются сразу в state и триггерят recalc+render.
// Фаза 1.20.1: per-column фильтры (марка, длина min/max, способ, обозначение,
// from/to) + групповое редактирование выделенных строк.
let _cableTableFilters = {
  search: '', class: '',
  mark: '', method: '', conductor: '',
  parallel: null,            // Phase 1.20.3: отдельный фильтр по числу параллельных линий
  lengthMin: null, lengthMax: null,
  imaxMin: null, imaxMax: null,
  label: '', fromTo: '',
};
let _cableTableSelected = new Set(); // ids выделенных строк для bulk-edit

function openCableTableModal() {
  openModal('modal-cable-table');
  renderCableTable();
  const srchEl = document.getElementById('cable-table-search');
  if (srchEl) srchEl.oninput = (e) => { _cableTableFilters.search = e.target.value; renderCableTable(); };
  const clsEl = document.getElementById('cable-table-filter-class');
  if (clsEl) clsEl.onchange = (e) => { _cableTableFilters.class = e.target.value; renderCableTable(); };
  const csvBtn = document.getElementById('cable-table-export-csv');
  if (csvBtn) csvBtn.onclick = exportCableTableCsv;
}

function exportCableTableCsv() {
  const S = window.Raschet?._state;
  if (!S) return;
  const rows = [['Обозначение', 'Откуда', 'Куда', 'Марка', 'Материал', 'Изоляция', 'Конструкция', 'Сечение, мм²', 'Число жил', 'Длина, м', 'Способ прокладки', 'Imax, А', 'Iдоп, А', 'Класс']];
  for (const c of S.conns.values()) {
    if (!c._active || (!c._cableSize && !c._busbarNom)) continue;
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const lineLabel = c.lineLabel || `${linePrefix}-${fromN?.tag || fromN?.name || '?'}-${toN?.tag || toN?.name || '?'}`;
    const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
    const cls = c._isHV ? 'MV/HV' : (c._isDC ? 'DC' : 'LV');
    rows.push([
      lineLabel,
      fromN?.tag || fromN?.name || '',
      toN?.tag || toN?.name || '',
      c.cableMark || '',
      c.material || '',
      c.insulation || '',
      c.cableType || '',
      c._cableSize || '',
      cores,
      c.lengthM || 0,
      c._cableMethod || '',
      c._maxA ? c._maxA.toFixed(1) : '',
      c._cableIz ? c._cableIz.toFixed(1) : '',
      cls,
    ]);
  }
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    return /[,"\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\n');
  // BOM для Excel
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cables-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  flash('Экспортировано ' + (rows.length - 1) + ' линий в CSV', 'success');
}

function _ctFmt(n, d = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(d);
}

function renderCableTable() {
  const mount = document.getElementById('cable-table-mount');
  if (!mount) return;
  const S = window.Raschet?._state;
  if (!S) { mount.innerHTML = '<div class="muted">Состояние недоступно</div>'; return; }

  // Справочник марок (синхронный импорт)
  let allMarks = [];
  try { allMarks = _listCableTypes(); } catch (e) { console.warn('[cable-table] listCableTypes', e); }

  // Phase 1.20.5: показываем ВСЕ кабели с известным сечением (не только
  // active-в-текущем-режиме). Иначе bulk-edit не может достать линии,
  // «спящие» в других режимах работы, но попадающие в BOM отчёта.
  const conns = [...S.conns.values()].filter(c => (c._cableSize || c._busbarNom));

  // Фильтры (поиск + класс + per-column)
  const F = _cableTableFilters;
  const q = (F.search || '').toLowerCase();
  const cls = F.class;
  const fMark = (F.mark || '').toLowerCase();
  const fMethod = (F.method || '').toLowerCase();
  const fCond = (F.conductor || '').toLowerCase();
  const fLabel = (F.label || '').toLowerCase();
  const fFromTo = (F.fromTo || '').toLowerCase();
  const filtered = conns.filter(c => {
    if (cls === 'HV' && !c._isHV) return false;
    if (cls === 'DC' && !c._isDC) return false;
    if (cls === 'LV' && (c._isHV || c._isDC)) return false;
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    if (q) {
      const hay = [c.lineLabel, fromN?.tag, fromN?.name, toN?.tag, toN?.name, c.cableMark]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fLabel && !String(c.lineLabel || '').toLowerCase().includes(fLabel)
        && !`${fromN?.tag || fromN?.name || ''}-${toN?.tag || toN?.name || ''}`.toLowerCase().includes(fLabel)) {
      return false;
    }
    if (fFromTo) {
      const ft = `${fromN?.tag || fromN?.name || ''} ${toN?.tag || toN?.name || ''}`.toLowerCase();
      if (!ft.includes(fFromTo)) return false;
    }
    // Phase 1.20.2: марка / проводник / способ — equality с distinct
    // значениями из dropdown (значение filter — либо brand из справочника,
    // либо id марки; поддерживаем оба).
    if (fMark) {
      const rec = allMarks.find(m => m.id === c.cableMark);
      const brand = (rec?.brand || c.cableMark || '(без марки)').toLowerCase();
      if (brand !== fMark && (c.cableMark || '').toLowerCase() !== fMark) return false;
    }
    if (fMethod) {
      const method = String(c._cableMethod || c.installMethod || '').toLowerCase();
      if (method !== fMethod) return false;
    }
    if (fCond) {
      const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
      const size = c._cableSize || '?';
      const n = Number(c._neutralSizeMm2) || 0;
      const spec = (c._busbarNom
        ? `шинопровод ${c._busbarNom} А`
        : (n > 0 && n < Number(size))
          ? `${cores - 1}×${size} + 1×${n} мм²`
          : `${cores}×${size} мм²`).toLowerCase();
      if (spec !== fCond) return false;
    }
    if (F.parallel != null) {
      if (Math.max(1, Number(c._cableParallel) || 1) !== F.parallel) return false;
    }
    const L = Number(c.lengthM) || 0;
    if (F.lengthMin != null && L < F.lengthMin) return false;
    if (F.lengthMax != null && L > F.lengthMax) return false;
    const Imax = Number(c._maxA) || 0;
    if (F.imaxMin != null && Imax < F.imaxMin) return false;
    if (F.imaxMax != null && Imax > F.imaxMax) return false;
    return true;
  });
  // Чистим selected от id'шников которые ушли из выборки
  for (const id of [..._cableTableSelected]) {
    if (!filtered.find(c => c.id === id)) _cableTableSelected.delete(id);
  }

  // Distinct-значения для dropdown-фильтров (строим по всему conns, не
  // по filtered — чтобы выбор в dropdown'е не «пропадал» после других
  // фильтров и можно было расширить выборку обратно).
  const distinctMarks = new Set();
  const distinctConductors = new Set();   // только {cores × size}, без parallel
  const distinctParallels = new Set();    // количество проводников/линий
  const distinctMethods = new Set();
  for (const c of conns) {
    if (c.cableMark) {
      const rec = allMarks.find(m => m.id === c.cableMark);
      distinctMarks.add(rec?.brand || c.cableMark);
    } else {
      distinctMarks.add('(без марки)');
    }
    if (c._busbarNom) {
      distinctConductors.add(`шинопровод ${c._busbarNom} А`);
    } else {
      const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
      const size = c._cableSize || '?';
      // Phase 1.20.3: reduced-neutral нотация «3×95 + 1×50» когда N меньше L
      const n = Number(c._neutralSizeMm2) || 0;
      const spec = (n > 0 && n < Number(size))
        ? `${cores - 1}×${size} + 1×${n} мм²`
        : `${cores}×${size} мм²`;
      distinctConductors.add(spec);
    }
    distinctParallels.add(Math.max(1, Number(c._cableParallel) || 1));
    const m = c._cableMethod || c.installMethod;
    if (m) distinctMethods.add(m);
  }
  const sortedMarks = [...distinctMarks].sort((a, b) => a.localeCompare(b, 'ru'));
  const sortedConductors = [...distinctConductors].sort((a, b) => {
    // Сортируем по числовому сечению: "3×1.5 мм²" < "5×10 мм²" < …
    const parse = (s) => {
      const m = /(\d+)×(?:(\d+)×)?([\d.]+)/.exec(s);
      return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3])] : [0, 0, 0];
    };
    const [a1, a2, a3] = parse(a), [b1, b2, b3] = parse(b);
    return a3 - b3 || a1 - b1 || a2 - b2;
  });
  const sortedParallels = [...distinctParallels].sort((a, b) => a - b);
  const sortedMethods = [...distinctMethods].sort();

  const countEl = document.getElementById('cable-table-count');
  if (countEl) countEl.textContent = `${filtered.length} из ${conns.length}`;

  // Группируем марки по категории для optgroup
  const byCat = {};
  for (const m of allMarks) {
    const cat = m.category || 'power';
    (byCat[cat] = byCat[cat] || []).push(m);
  }
  const CAT_LABEL = {
    power: 'Силовой', hv: 'Высоковольтный',
    signal: 'Слаботочный', data: 'Информационный',
    fieldbus: 'Полевой', dc: 'DC',
  };

  // Методы прокладки из текущей методики (синхронно)
  let methodsList = [];
  try {
    const G = window.Raschet?.getGlobal?.() || {};
    const meth = getMethod(G.calcMethod || 'iec');
    if (meth?.installMethods) {
      methodsList = Object.entries(meth.installMethods).map(([k, v]) => ({ id: k, label: v }));
    }
  } catch (e) { console.warn('[cable-table] getMethod', e); }
  if (!methodsList.length) {
    methodsList = [
      { id: 'A1', label: 'A1' }, { id: 'A2', label: 'A2' },
      { id: 'B1', label: 'B1' }, { id: 'B2', label: 'B2' },
      { id: 'C', label: 'C' }, { id: 'D', label: 'D' },
      { id: 'E', label: 'E' }, { id: 'F', label: 'F' }, { id: 'G', label: 'G' },
    ];
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const selCount = _cableTableSelected.size;
  const bulkDisabled = selCount === 0;
  const html = [`
    <div class="ct-bulk-bar" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;margin-bottom:8px;font-size:12px;flex-wrap:wrap">
      <b>Выделено: ${selCount}</b>
      <button type="button" id="ct-bulk-mark" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Марка</button>
      <button type="button" id="ct-bulk-length" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Длина</button>
      <button type="button" id="ct-bulk-method" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Способ</button>
      <button type="button" id="ct-bulk-scale" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}" title="Умножить длины на коэффициент">× Длина</button>
      <span style="flex:1"></span>
      <button type="button" id="ct-clear-filters" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px">Сбросить фильтры</button>
      <button type="button" id="ct-clear-sel" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Снять выделение</button>
    </div>
    <table class="cable-table" style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f6f8fa;position:sticky;top:0;z-index:2">
          <th style="padding:6px 4px;border-bottom:2px solid #d0d7de;width:28px;text-align:center">
            <input type="checkbox" id="ct-select-all" ${filtered.length && filtered.every(c => _cableTableSelected.has(c.id)) ? 'checked' : ''} title="Выделить все">
          </th>
          <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d7de">Обозначение</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d7de">Откуда → Куда</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d7de;min-width:200px">Марка кабеля</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d7de">Проводник</th>
          <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #d0d7de" title="Параллельные проводники (линий)">Линий</th>
          <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #d0d7de">Длина, м</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #d0d7de;min-width:150px">Способ прокладки</th>
          <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #d0d7de">Imax / Iдоп</th>
          <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #d0d7de">Класс</th>
        </tr>
        <tr style="background:#fafbfc;position:sticky;top:28px;z-index:1;font-weight:400">
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de"></th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><input type="text" class="ct-flt" data-flt="label" placeholder="фильтр…" value="${esc(F.label)}" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><input type="text" class="ct-flt" data-flt="fromTo" placeholder="от/куда…" value="${esc(F.fromTo)}" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de">
            <select class="ct-flt" data-flt="mark" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
              <option value="">— все марки —</option>
              ${sortedMarks.map(v => `<option value="${esc(v)}" ${F.mark === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de">
            <select class="ct-flt" data-flt="conductor" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
              <option value="">— все проводники —</option>
              ${sortedConductors.map(v => `<option value="${esc(v)}" ${F.conductor === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de">
            <select class="ct-flt" data-flt="parallel" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
              <option value="">все</option>
              ${sortedParallels.map(v => `<option value="${v}" ${F.parallel === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de;white-space:nowrap">
            <input type="number" class="ct-flt" data-flt="lengthMin" placeholder="от" value="${F.lengthMin ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
            <input type="number" class="ct-flt" data-flt="lengthMax" placeholder="до" value="${F.lengthMax ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de">
            <select class="ct-flt" data-flt="method" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
              <option value="">— все способы —</option>
              ${sortedMethods.map(v => `<option value="${esc(v)}" ${F.method === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de;white-space:nowrap">
            <input type="number" class="ct-flt" data-flt="imaxMin" placeholder="от" value="${F.imaxMin ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
            <input type="number" class="ct-flt" data-flt="imaxMax" placeholder="до" value="${F.imaxMax ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px">
          </th>
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de"></th>
        </tr>
      </thead>
      <tbody>`];
  for (const c of filtered) {
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    const fromLabel = (fromN?.tag || fromN?.name || '?');
    const toLabel = (toN?.tag || toN?.name || '?');
    const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const lineLabel = c.lineLabel || `${linePrefix}-${fromLabel}-${toLabel}`;

    // Фильтр допустимых марок по классу линии
    const allowedCats = c._isHV ? ['hv'] : (c._isDC ? ['dc', 'power'] : ['power']);
    let markOpts = '<option value="">— не выбрано —</option>';
    for (const cat of allowedCats) {
      const items = byCat[cat] || [];
      if (!items.length) continue;
      markOpts += `<optgroup label="${esc(CAT_LABEL[cat] || cat)}">`;
      for (const m of items) {
        const sel = m.id === c.cableMark ? ' selected' : '';
        markOpts += `<option value="${esc(m.id)}"${sel}>${esc(m.brand || m.id)}</option>`;
      }
      markOpts += '</optgroup>';
    }
    if (c.cableMark && !allMarks.find(m => m.id === c.cableMark && allowedCats.includes(m.category || 'power'))) {
      const cur = allMarks.find(m => m.id === c.cableMark);
      if (cur) markOpts += `<optgroup label="⚠ Не по классу"><option value="${esc(cur.id)}" selected>${esc(cur.brand || cur.id)}</option></optgroup>`;
    }

    let methodOpts = '<option value="">—</option>';
    for (const m of methodsList) {
      const sel = m.id === c._cableMethod ? ' selected' : '';
      methodOpts += `<option value="${esc(m.id)}"${sel}>${esc(m.label)}</option>`;
    }

    // Phase 1.20.3: «Проводник» = только сечение жил, количество параллельных
    // проводников вынесено в отдельный столбец «Линий». Поддержка reduced-N
    // сечения («3×95 + 1×50 мм²») через conn._neutralSizeMm2.
    const parallelN = Math.max(1, Number(c._cableParallel) || 1);
    let conductorSpec;
    if (c._busbarNom) {
      conductorSpec = `шинопр. ${c._busbarNom} А`;
    } else {
      const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
      const size = c._cableSize || '?';
      const nSize = Number(c._neutralSizeMm2) || 0;
      conductorSpec = (nSize > 0 && nSize < Number(size))
        ? `${cores - 1}×${size} + 1×${nSize} мм²`
        : `${cores}×${size} мм²`;
    }

    const lengthVal = c.lengthM != null ? c.lengthM : '';
    const cls = c._isHV ? 'MV/HV' : (c._isDC ? 'DC' : 'LV');
    const clsColor = c._isHV ? '#f57c00' : (c._isDC ? '#7b1fa2' : '#1976d2');

    const checked = _cableTableSelected.has(c.id);
    const rowBg = checked ? 'background:#eef5ff;' : '';
    html.push(`
      <tr data-id="${esc(c.id)}" style="border-bottom:1px solid #eaecef;${rowBg}">
        <td style="padding:5px 4px;text-align:center">
          <input type="checkbox" class="ct-row-sel" data-id="${esc(c.id)}" ${checked ? 'checked' : ''}>
        </td>
        <td style="padding:5px 8px;font-weight:600">${esc(lineLabel)}</td>
        <td style="padding:5px 8px;font-size:11px">${esc(fromLabel)} → ${esc(toLabel)}</td>
        <td style="padding:5px 8px">
          <select class="ct-mark" data-id="${esc(c.id)}" style="width:100%;padding:3px 6px;font-size:11px">${markOpts}</select>
        </td>
        <td style="padding:5px 8px;font-size:11px">${esc(conductorSpec)}</td>
        <td style="padding:5px 8px;text-align:right;font-size:11px;${parallelN > 1 ? 'color:#1976d2;font-weight:600' : 'color:#999'}">${parallelN}</td>
        <td style="padding:5px 8px;text-align:right">
          <input class="ct-length" data-id="${esc(c.id)}" type="number" min="0" step="0.5" value="${lengthVal}" style="width:70px;padding:3px 6px;text-align:right">
        </td>
        <td style="padding:5px 8px">
          <select class="ct-method" data-id="${esc(c.id)}" style="width:100%;padding:3px 6px;font-size:11px">${methodOpts}</select>
        </td>
        <td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;color:#555">
          ${_ctFmt(c._maxA || 0)} / ${_ctFmt(c._cableIz || 0)} А
        </td>
        <td style="padding:5px 8px;text-align:center;font-size:11px;color:${clsColor};font-weight:600">${cls}</td>
      </tr>`);
  }
  if (!filtered.length) {
    html.push('<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">Нет кабельных линий по текущим фильтрам</td></tr>');
  }
  html.push('</tbody></table>');
  mount.innerHTML = html.join('');

  // Обработчики изменений (change, не input — чтобы не терять фокус)
  // Phase 1.20.5: после изменения свойства conn нужно вызвать render()
  // чтобы пересчитался _cableMethod / _maxA / _cableIz (recalc triggered
  // только из render). Иначе bulk-edit способа прокладки / длины не
  // отражается в таблице до следующего ручного действия.
  const apply = (connId, fn) => {
    if (!window.Raschet?._state?.conns) return;
    const c = window.Raschet._state.conns.get(connId);
    if (!c) return;
    fn(c);
    if (typeof window.Raschet.notifyChange === 'function') window.Raschet.notifyChange();
  };
  const applyAndRerender = () => {
    if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
    renderCableTable();
  };
  mount.querySelectorAll('.ct-mark').forEach(sel => {
    sel.addEventListener('change', () => {
      apply(sel.dataset.id, (c) => {
        c.cableMark = sel.value || null;
        // Автоприменение material/insulation из записи
        if (sel.value) {
          const rec = allMarks.find(m => m.id === sel.value);
          if (rec) {
            if (rec.material === 'Cu' || rec.material === 'Al') c.material = rec.material;
            if (rec.insulation === 'PVC' || rec.insulation === 'XLPE') c.insulation = rec.insulation;
          }
        }
      });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ct-length').forEach(inp => {
    inp.addEventListener('change', () => {
      apply(inp.dataset.id, (c) => { c.lengthM = Math.max(0, Number(inp.value) || 0); });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ct-method').forEach(sel => {
    sel.addEventListener('change', () => {
      apply(sel.dataset.id, (c) => { c.installMethod = sel.value || undefined; });
      applyAndRerender();
    });
  });

  // Per-column фильтры
  mount.querySelectorAll('.ct-flt').forEach(inp => {
    const isSelect = inp.tagName === 'SELECT';
    const isNumber = inp.type === 'number';
    const isText = !isSelect && !isNumber;
    const handler = () => {
      const k = inp.dataset.flt;
      let v = inp.value;
      if (isNumber) v = (v === '' ? null : Number(v));
      else if (k === 'parallel') v = (v === '' ? null : Number(v));
      else v = v.toLowerCase();
      _cableTableFilters[k] = v;
      renderCableTable();
      // Возвращаем фокус + курсор в конец для текстовых фильтров
      if (isText) {
        const same = mount.querySelector(`.ct-flt[data-flt="${k}"]`);
        if (same) { same.focus(); if (same.setSelectionRange) same.setSelectionRange(same.value.length, same.value.length); }
      }
    };
    inp.addEventListener(isText ? 'input' : 'change', handler);
  });

  // Row checkboxes + select-all
  mount.querySelectorAll('.ct-row-sel').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) _cableTableSelected.add(cb.dataset.id);
      else _cableTableSelected.delete(cb.dataset.id);
      renderCableTable();
    });
  });
  const selAll = mount.querySelector('#ct-select-all');
  if (selAll) selAll.addEventListener('change', () => {
    if (selAll.checked) {
      for (const c of filtered) _cableTableSelected.add(c.id);
    } else {
      for (const c of filtered) _cableTableSelected.delete(c.id);
    }
    renderCableTable();
  });

  // Сбросить фильтры
  const clearBtn = mount.querySelector('#ct-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    _cableTableFilters = {
      search: '', class: '',
      mark: '', method: '', conductor: '',
      parallel: null,
      lengthMin: null, lengthMax: null,
      imaxMin: null, imaxMax: null,
      label: '', fromTo: '',
    };
    const s = document.getElementById('cable-table-search'); if (s) s.value = '';
    const cls = document.getElementById('cable-table-filter-class'); if (cls) cls.value = '';
    renderCableTable();
  });
  const clearSelBtn = mount.querySelector('#ct-clear-sel');
  if (clearSelBtn) clearSelBtn.addEventListener('click', () => {
    _cableTableSelected.clear();
    renderCableTable();
  });

  // Групповое редактирование
  // Phase 1.20.5: после bulk-изменения обязательно делаем rerender —
  // recalc пересчитает _cableMethod / _maxA / _cableIz для всех затронутых
  // линий и таблица покажет актуальные значения.
  const bulkApply = (fn) => {
    const ids = [..._cableTableSelected];
    if (!ids.length) return;
    let affectedCount = 0;
    for (const id of ids) {
      const cc = window.Raschet?._state?.conns?.get(id);
      if (!cc) continue;
      const before = { cableMark: cc.cableMark, lengthM: cc.lengthM, installMethod: cc.installMethod };
      apply(id, fn);
      // Считаем сколько реально изменилось (чтобы дать пользователю обратную связь)
      if (before.cableMark !== cc.cableMark || before.lengthM !== cc.lengthM || before.installMethod !== cc.installMethod) {
        affectedCount++;
      }
    }
    if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
    renderCableTable();
    flash(`Изменено: ${affectedCount} из ${ids.length} линий`);
  };
  const markBtn = mount.querySelector('#ct-bulk-mark');
  if (markBtn) markBtn.addEventListener('click', () => _openBulkCableDialog('mark', filtered, allMarks, byCat, CAT_LABEL, bulkApply));
  const lenBtn = mount.querySelector('#ct-bulk-length');
  if (lenBtn) lenBtn.addEventListener('click', () => _openBulkCableDialog('length', filtered, allMarks, byCat, CAT_LABEL, bulkApply));
  const methBtn = mount.querySelector('#ct-bulk-method');
  if (methBtn) methBtn.addEventListener('click', () => _openBulkCableDialog('method', filtered, allMarks, byCat, CAT_LABEL, bulkApply, methodsList));
  const scaleBtn = mount.querySelector('#ct-bulk-scale');
  if (scaleBtn) scaleBtn.addEventListener('click', () => _openBulkCableDialog('scale', filtered, allMarks, byCat, CAT_LABEL, bulkApply));
}

// Модалка группового изменения (mark/length/method/scale)
function _openBulkCableDialog(kind, filtered, allMarks, byCat, CAT_LABEL, bulkApply, methodsList) {
  const count = _cableTableSelected.size;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let bodyHtml = '';
  let applyFn = null;
  if (kind === 'mark') {
    let opts = '<option value="">— не выбрано —</option>';
    for (const cat of Object.keys(byCat)) {
      opts += `<optgroup label="${esc(CAT_LABEL[cat] || cat)}">`;
      for (const m of byCat[cat]) opts += `<option value="${esc(m.id)}">${esc(m.brand || m.id)}</option>`;
      opts += '</optgroup>';
    }
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Марка будет применена ко всем ${count} выделенным линиям с соблюдением класса линии (HV/DC/LV). Неподходящие по классу пропустятся.</p>
      <label>Марка кабеля<br><select id="bulk-mark" style="width:100%;padding:5px 8px;margin-top:4px">${opts}</select></label>
    `;
    applyFn = () => {
      const id = document.getElementById('bulk-mark').value;
      if (!id) return;
      const rec = allMarks.find(m => m.id === id);
      const cat = rec?.category || 'power';
      bulkApply((c) => {
        // Пропускаем несовместимые по классу
        if (cat === 'hv' && !c._isHV) return;
        if (cat !== 'hv' && c._isHV) return;
        c.cableMark = id;
        if (rec?.material === 'Cu' || rec?.material === 'Al') c.material = rec.material;
        if (rec?.insulation === 'PVC' || rec?.insulation === 'XLPE') c.insulation = rec.insulation;
      });
    };
  } else if (kind === 'length') {
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Установить длину для всех ${count} выделенных линий.</p>
      <label>Длина, м<br><input type="number" id="bulk-length" min="0" step="0.5" value="10" style="width:100%;padding:5px 8px;margin-top:4px"></label>
    `;
    applyFn = () => {
      const L = Math.max(0, Number(document.getElementById('bulk-length').value) || 0);
      bulkApply((c) => { c.lengthM = L; });
    };
  } else if (kind === 'method') {
    let opts = '<option value="">—</option>';
    for (const m of (methodsList || [])) opts += `<option value="${esc(m.id)}">${esc(m.label)}</option>`;
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Способ прокладки для всех ${count} выделенных линий.</p>
      <label>Способ прокладки<br><select id="bulk-method" style="width:100%;padding:5px 8px;margin-top:4px">${opts}</select></label>
    `;
    applyFn = () => {
      const m = document.getElementById('bulk-method').value;
      bulkApply((c) => { c.installMethod = m || undefined; });
    };
  } else if (kind === 'scale') {
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Умножить текущую длину всех ${count} выделенных линий на коэффициент (например, 1.1 — добавить 10% запаса).</p>
      <label>Коэффициент<br><input type="number" id="bulk-scale" min="0.1" max="10" step="0.05" value="1.1" style="width:100%;padding:5px 8px;margin-top:4px"></label>
    `;
    applyFn = () => {
      const k = Number(document.getElementById('bulk-scale').value) || 1;
      bulkApply((c) => { c.lengthM = Math.round((Number(c.lengthM) || 0) * k * 10) / 10; });
    };
  }

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.3);width:min(440px,92vw);overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid #e1e4e8;background:#f6f8fa;display:flex;align-items:center;gap:10px">
        <h3 style="margin:0;font-size:14px;flex:1">Групповое изменение — ${count} линий</h3>
        <button type="button" data-close style="background:none;border:none;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="padding:14px 16px;font-size:12px">${bodyHtml}</div>
      <div style="padding:10px 16px;border-top:1px solid #e1e4e8;display:flex;gap:8px;justify-content:flex-end">
        <button type="button" data-close style="padding:6px 14px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer">Отмена</button>
        <button type="button" data-apply style="padding:6px 14px;border:none;background:#1976d2;color:#fff;border-radius:4px;cursor:pointer">Применить</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => document.body.removeChild(modal);
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('[data-apply]').addEventListener('click', () => {
    if (applyFn) applyFn();
    close();
  });
}

// ================= Импорт таблицы нагрузок =================
function openLoadsImportModal() {
  if (state.currentProject && state.currentProject._role === 'viewer') {
    flash('Только просмотр', 'error'); return;
  }
  openModal('modal-loads-import');
  setTimeout(() => els.loadsImportText.focus(), 50);
}
function applyLoadsImport() {
  const text = els.loadsImportText.value;
  if (!text.trim()) { flash('Вставьте таблицу', 'error'); return; }
  try {
    const added = window.Raschet.importLoadsTable(text);
    closeModal('modal-loads-import');
    els.loadsImportText.value = '';
    flash(`Добавлено потребителей: ${added}`);
    requestAnimationFrame(() => window.Raschet.fit());
  } catch (e) {
    flash(e.message || 'Ошибка импорта', 'error');
  }
}

// ================= Модалки =================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m || e.target.classList.contains('modal-close')) m.classList.add('hidden');
  });
});

// ================= Утилиты =================
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function escAttr(s) { return escHtml(s); }

// ================= Инициализация =================
async function init() {
  showScreen('loading');

  // Справка по главному модулю — floating-«?» в правом-нижнем углу
  mountHelp({
    module: 'engine',
    title: 'Конструктор схем Raschet',
    usage: `
      <h4>Назначение модуля</h4>
      <p>Главный инструмент — drag-and-drop конструктор принципиальных схем электроснабжения. Собирает граф «источник → щит → потребитель» с автоматическим расчётом токов, подбором кабеля, автоматов и проверкой координации защит.</p>
      <h4>Рабочий процесс</h4>
      <ol>
        <li><b>Левая панель (палитра)</b> — перетащите элементы на холст: Источники (утил/ДГУ/солнце), <b>НКУ</b> (LV-щиты), <b>РУ СН</b> (SafeRing/RM6/ЩО-70), ИБП, Потребители, Кабельные каналы.</li>
        <li><b>Соединение</b> — тяните от выходного порта одного узла ко входному другого. Цвет линии = класс напряжения.</li>
        <li><b>Правая панель (инспектор)</b> — параметры выбранного узла / линии: нагрузка, cos φ, Ксим, приоритеты АВР, условия прокладки, ручной/авто подбор кабеля и автомата.</li>
        <li><b>Расчёт</b> — идёт автоматически при каждом изменении (recalc.js). Показываются Imax, Iz, Ik, ΔU, Smin.</li>
        <li><b>Режимы работы</b> — переключатель сверху: «Нормальный» / кастомные (потеря одного ввода и т.п.). Для каждой линии задаётся состояние «Нормальная / Повреждена / Отключена».</li>
        <li><b>Отчёты</b> — кнопка «Отчёт» сверху. Выбор из шаблонов + текстовый/PDF/DOCX экспорт.</li>
      </ol>
      <h4>Подпрограммы (кнопки на верхней панели и отдельные вкладки)</h4>
      <ul>
        <li>⚙ Конфигуратор <b>НКУ</b> (panel-config/) — wizard подбора оболочки + автоматов по IEC 61439</li>
        <li>⚡ Конфигуратор <b>РУ СН</b> (mv-config/) — wizard выбора RM6/SafeRing/ЩО-70 и функций ячеек</li>
        <li>🔋 Конфигуратор <b>ИБП</b> (ups-config/) — wizard 3 шага, IEC 62040-3</li>
        <li>🔌 Расчёт <b>кабеля</b> (cable/) — standalone по IEC 60364/ПУЭ</li>
        <li>🔋 Расчёт <b>АКБ</b> (battery/) — IEEE 485 / IEC 60896</li>
        <li>📦 <b>Каталог</b> (catalog/) — библиотека элементов + цены + контрагенты</li>
        <li>📄 <b>Отчёты</b> (reports/) — редактор шаблонов PDF/DOCX</li>
      </ul>
      <div class="note">У каждой подпрограммы есть свой <b>?</b>-виджет в правом-нижнем углу с детальной справкой по формулам и стандартам.</div>
    `,
    calcs: `
      <h4>Текущие расчёты в конструкторе</h4>
      <h5>1. Баланс нагрузок (recalc.js)</h5>
      <ul>
        <li>BFS вверх по графу от потребителей к источникам</li>
        <li>Суммирование P<sub>расч</sub> с учётом K<sub>сим</sub> (коэффициент одновременности) на каждом щите</li>
        <li>cos φ — по категории потребителя (lighting/power/hvac/it…)</li>
        <li>S = P / cos φ; I = S / (√3 · U) для 3-фазной линии, I = S / U для 1-фазной</li>
      </ul>
      <h5>2. Подбор кабеля (IEC 60364-5-52 или ПУЭ)</h5>
      <ul>
        <li>I<sub>z</sub> ≥ I<sub>расч</sub> / (K<sub>t</sub> · K<sub>g</sub> · K<sub>b</sub>)</li>
        <li>Координация с автоматом: I<sub>расч</sub> ≤ I<sub>n</sub> ≤ I<sub>z</sub> (IEC 60364-4-43)</li>
        <li>Минимальное сечение при КЗ: S<sub>min</sub> = I<sub>k</sub> · √t / k (k=115 Cu/PVC, 143 Cu/XLPE)</li>
        <li>Let-through I²t для MCB class 3 (IEC 60898-1) — учёт токоограничения современных автоматов</li>
      </ul>
      <h5>3. Ток КЗ (shortCircuit module)</h5>
      <ul>
        <li>Zs<sub>utility</sub> = c · U / (√3 · I<sub>k</sub>) — импеданс источника</li>
        <li>Z<sub>cable</sub> = √(R² + X²), R = ρ·L/S, X = X₀·L</li>
        <li>I<sub>k3</sub> = c · U / (√3 · Z<sub>сумм</sub>) по IEC 60909</li>
        <li>i<sub>p</sub> = κ · √2 · I<sub>k3</sub>, κ = 1.02 + 0.98·exp(-3/(X/R))</li>
      </ul>
      <h5>4. Петля «фаза-ноль» (phaseLoop module)</h5>
      <ul>
        <li>I<sub>k1</sub> = c · U / (√3 · Z<sub>loop</sub>), Z<sub>loop</sub> = 2·(R+X) по всей цепочке от источника</li>
        <li>Проверка: I<sub>a</sub> (ток автомата, магнитная зона) ≤ I<sub>k1</sub></li>
        <li>Система заземления TN-S/TN-C/TN-C-S/TT/IT по IEC 60364-4-41</li>
      </ul>
      <h5>5. Потеря напряжения (voltageDrop module)</h5>
      <ul>
        <li>ΔU = √3 · I · L · (R·cos φ + X·sin φ) / U · 100%</li>
        <li>Норма: ≤ 3% освещение, ≤ 5% силовые (IEC 60364-5-52 G.52.1)</li>
      </ul>
      <h5>6. Селективность (selectivity-check.js)</h5>
      <ul>
        <li>Амплитудная: I<sub>n_up</sub> ≥ k · I<sub>n_down</sub> (k=1.6 для C, 1.4 для D, 2.0 для B по IEC 60364-5-53)</li>
        <li>Временная: t<sub>up</sub>(I<sub>k</sub>) &gt; t<sub>down</sub>(I<sub>k</sub>) · 1.3</li>
        <li>Для MV-ячеек — отдельный анализ пар infeed × feeder (fuse-switch как downstream от VCB)</li>
      </ul>
      <h5>7. IEC 60909 для РУ СН</h5>
      <ul>
        <li>Учёт импеданса MV-кабеля между источником и шинами</li>
        <li>Проверка стойкости шин: I<sub>k3</sub> ≤ I<sub>t</sub> (kindProps.It_kA)</li>
      </ul>
      <h5>8. Тепловой баланс ИБП + АКБ</h5>
      <ul>
        <li>S<sub>UPS</sub> ≥ Σ P<sub>крит</sub> / cos φ<sub>IT</sub> (обычно 0.9-1.0)</li>
        <li>Ёмкость АКБ — через storage-channel в battery/ (runtime в минутах, EoD-напряжение)</li>
      </ul>
      <div class="note">Детали каждого расчёта — в ?-виджетах соответствующих подпрограмм (cable, ups-config, mv-config и др.).</div>
    `,
    shortcuts: `
      <h4>Основные</h4>
      <table>
        <tr><th>Действие</th><th>Сочетание</th></tr>
        <tr><td>Отмена</td><td><code>Ctrl+Z</code></td></tr>
        <tr><td>Повтор</td><td><code>Ctrl+Shift+Z</code> или <code>Ctrl+Y</code></td></tr>
        <tr><td>Удалить выделенное</td><td><code>Delete</code> или <code>Backspace</code></td></tr>
        <tr><td>Скопировать узел</td><td><code>Ctrl+C</code></td></tr>
        <tr><td>Вставить</td><td><code>Ctrl+V</code></td></tr>
        <tr><td>Выделить всё</td><td><code>Ctrl+A</code></td></tr>
      </table>
      <h4>Навигация по холсту</h4>
      <table>
        <tr><th>Действие</th><th>Сочетание</th></tr>
        <tr><td>Пан холста</td><td>Средняя кнопка мыши + drag</td></tr>
        <tr><td>Зум</td><td><code>Ctrl + колесо</code></td></tr>
        <tr><td>Центрировать на выделении</td><td><code>Space</code></td></tr>
        <tr><td>Переключить палитру</td><td><code>Esc</code> (закрытие дропдаунов)</td></tr>
      </table>
      <h4>Работа со связью</h4>
      <ul>
        <li><b>Shift + клик</b> по точке сплайна — удалить точку</li>
        <li><b>Shift + клик</b> по линии — удалить связь</li>
        <li><b>+ в середине сегмента</b> — добавить точку сплайна</li>
        <li>Рукоятки на концах — переключить связь на другой порт</li>
      </ul>
    `,
  });

  // Мобильные toggles
  els.btnTogglePalette.addEventListener('click', () => {
    document.body.classList.toggle('palette-open');
    document.body.classList.remove('inspector-open');
  });
  els.btnToggleInspector.addEventListener('click', () => {
    document.body.classList.toggle('inspector-open');
    document.body.classList.remove('palette-open');
  });
  // Закрытие drawer по клику на затемнённую область
  const canvasWrap = document.getElementById('canvas-wrap');
  if (canvasWrap) canvasWrap.addEventListener('click', e => {
    if (document.body.classList.contains('palette-open') || document.body.classList.contains('inspector-open')) {
      // Проверяем, что клик по ::after (затемнению), а не по canvas/toolbar
      const rect = canvasWrap.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        document.body.classList.remove('palette-open', 'inspector-open');
      }
    }
  });

  // Header
  els.btnHome.addEventListener('click', backToProjects);
  els.btnSave.addEventListener('click', () => saveCurrent(false));
  els.btnShare.addEventListener('click', openShareModal);

  // Подписка на изменения редактора → автосохранение
  if (window.Raschet && typeof window.Raschet.onChange === 'function') {
    window.Raschet.onChange(() => markDirty());
  }

  // Предупреждение при закрытии вкладки с несохранёнными изменениями
  window.addEventListener('beforeunload', e => {
    if (state.dirty && state.currentProject && state.currentProject._role !== 'viewer') {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  els.btnRequestAccess.addEventListener('click', () => openModal('modal-request'));
  els.btnNotifications.addEventListener('click', () => {
    backToProjects();
    selectTab('requests');
  });

  // Password modal
  els.pwdSubmit.addEventListener('click', submitPassword);
  els.pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitPassword(); });

  // P3 buttons
  if (els.btnOpenSettings) els.btnOpenSettings.addEventListener('click', openSettingsModal);
  // Шестерёнка в хедере → Глобальные настройки платформы (shared/global-settings.js)
  // Кнопка «⚙ Параметры расчёта» в сайдбаре → локальная модалка (openSettingsModal)
  const btnGlobalSettings = document.getElementById('btn-global-settings');
  if (btnGlobalSettings) btnGlobalSettings.addEventListener('click', () => openGlobalSettingsModal());
  const settingsSave = document.getElementById('settings-save');
  if (settingsSave) settingsSave.addEventListener('click', saveSettingsModal);
  const settingsReset = document.getElementById('settings-reset');
  if (settingsReset) settingsReset.addEventListener('click', resetSettingsModal);
  // Project info modal
  const btnProjectInfo = document.getElementById('btn-open-project-info');
  if (btnProjectInfo) btnProjectInfo.addEventListener('click', openProjectInfoModal);
  const projectInfoSave = document.getElementById('project-info-save');
  if (projectInfoSave) projectInfoSave.addEventListener('click', saveProjectInfoModal);
  // Параметры проекта (кабельные умолчания) — Фаза 1.16
  const btnProjectParams = document.getElementById('btn-open-project-params');
  if (btnProjectParams) btnProjectParams.addEventListener('click', openProjectParamsModal);
  const projectParamsSave = document.getElementById('project-params-save');
  if (projectParamsSave) projectParamsSave.addEventListener('click', saveProjectParamsModal);
  // Сброс базовых пресетов
  const btnPresetsReset = document.getElementById('btn-presets-reset-builtins');
  if (btnPresetsReset) btnPresetsReset.addEventListener('click', () => {
    if (!confirm('Восстановить все скрытые базовые пресеты и сбросить их изменения?')) return;
    if (window.Presets && typeof window.Presets.resetBuiltins === 'function') {
      window.Presets.resetBuiltins();
      renderPalettePresets();
      flash('Базовые пресеты восстановлены');
    }
  });
  // Применяем сохранённые настройки как можно раньше — после загрузки Raschet
  loadGlobalSettings();
  // Рендер библиотечных пресетов в палитру + поиск + ресайз
  // Каждый вызов в try/catch — одиночный сбой не должен ломать всю инициализацию.
  try { renderPalettePresets(); } catch (e) { console.warn('[renderPalettePresets]', e); }
  try { wirePaletteSearch(); } catch (e) { console.warn('[wirePaletteSearch]', e); }
  try { wirePaletteResizer(); } catch (e) { console.warn('[wirePaletteResizer]', e); }
  if (els.btnOpenPresets) els.btnOpenPresets.addEventListener('click', openPresetsModal);
  const btnCatalog = document.getElementById('btn-open-consumer-catalog');
  if (btnCatalog) btnCatalog.addEventListener('click', openConsumerCatalogModal);
  const btnCatalogAdd = document.getElementById('consumer-catalog-add');
  if (btnCatalogAdd) btnCatalogAdd.addEventListener('click', () => {
    const label = prompt('Название нового типа:');
    if (!label) return;
    const G = window.Raschet.getGlobal();
    if (!Array.isArray(G.customConsumerCatalog)) G.customConsumerCatalog = [];
    G.customConsumerCatalog.push({ id: 'user_' + Date.now(), label, category: 'other', cosPhi: 0.92, kUse: 1 });
    window.Raschet.setGlobal({ customConsumerCatalog: G.customConsumerCatalog });
    if (typeof window.__raschetPersistUserCatalog === 'function') window.__raschetPersistUserCatalog();
    renderConsumerCatalogModal();
  });
  if (els.btnOpenReports) els.btnOpenReports.addEventListener('click', openReportsModal);
  if (els.btnOpenLoadsImport) els.btnOpenLoadsImport.addEventListener('click', openLoadsImportModal);
  // Фаза 1.20: таблица кабелей
  const btnCableTable = document.getElementById('btn-open-cable-table');
  if (btnCableTable) btnCableTable.addEventListener('click', openCableTableModal);
  if (els.presetsSearch) els.presetsSearch.addEventListener('input', () => renderPresets(els.presetsSearch.value));
  if (els.reportCopy) els.reportCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(els.reportBody.textContent); flash('Скопировано'); }
    catch { flash('Не удалось скопировать', 'error'); }
  });
  if (els.reportDownload) els.reportDownload.addEventListener('click', () => {
    const blob = new Blob([els.reportBody.textContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.download = `raschet-report_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  if (els.loadsImportApply) els.loadsImportApply.addEventListener('click', applyLoadsImport);

  // Projects screen
  els.tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  els.btnNewProject.addEventListener('click', showNewProjectModal);
  els.btnLoadProject.addEventListener('click', showLoadProject);
  els.loadProjectFile.addEventListener('change', handleLoadProjectFile);
  els.btnLoadDemo.addEventListener('click', () => {
    window.Raschet.loadDemo();
    state.currentProject = {
      id: '_demo_' + Date.now(),
      name: 'Пример (не сохранён)',
      _role: 'owner',
      ownerName: 'Демо',
    };
    els.projectName.textContent = state.currentProject.name;
    els.projectName.classList.remove('hidden');
    els.btnSave.classList.add('hidden');
    els.btnShare.classList.add('hidden');
    window.Raschet.setReadOnly(false);
    showScreen('editor');
    requestAnimationFrame(() => window.Raschet.fit());
  });

  // New project modal
  els.newCreate.addEventListener('click', createNewProject);

  // Share modal
  els.shareAdd.addEventListener('click', addShare);
  els.shareVisibility.addEventListener('change', async () => {
    try {
      await window.Storage.setVisibility(state.currentProject.id, els.shareVisibility.value);
      state.currentProject.visibility = els.shareVisibility.value;
    } catch (e) { flash(e.message || 'Ошибка', 'error'); }
  });
  els.shareCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.shareLink.value);
      flash('Ссылка скопирована');
    } catch { els.shareLink.select(); document.execCommand('copy'); flash('Скопировано'); }
  });

  // Request access modal
  els.requestSend.addEventListener('click', sendAccessRequest);

  // Auth
  window.Auth.onAuthChange(async user => {
    const prevUser = state.currentUser;
    state.currentUser = user;
    // Кэшируем uid в localStorage для кросс-страничного доступа
    // (battery/ подпрограмма читает этот ключ для namespace'а
    // справочника АКБ per-user).
    try {
      if (user && user.uid) localStorage.setItem('raschet.currentUserId', user.uid);
      else localStorage.setItem('raschet.currentUserId', 'anonymous');
    } catch {}
    renderAuthUI();

    // При смене пользователя обновляем проекты
    if (document.body.dataset.screen === 'projects') {
      await refreshProjects();
    } else if (!prevUser && user && state.currentProject) {
      // Только что вошли, проект открыт — перечитаем его
      openProject(state.currentProject.id);
    }
  });

  await window.Auth.init();
  // Ждём, пока Auth определится с текущим пользователем (кэш сессии Firebase
  // может загружаться ~0.5 сек). В локальном режиме резолвится сразу.
  await window.Auth.ready();

  // Определяем начальный экран
  const url = new URL(location.href);
  const projectId = url.searchParams.get('project');
  if (projectId) {
    openProject(projectId);
  } else {
    showScreen('projects');
    await refreshProjects();
  }
}

// Запуск после DOM готовности
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
