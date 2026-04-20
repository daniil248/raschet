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
import { BREAKER_SERIES as _BREAKER_SERIES, BREAKER_TYPES as _BREAKER_TYPES } from './engine/constants.js';
import { effectiveTag as _effectiveTag } from './engine/zones.js';

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
  const centerEl = document.getElementById('set-autoCenterOnSelect');
  if (centerEl) centerEl.checked = !!G.autoCenterOnSelect;
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
    autoCenterOnSelect:   !!document.getElementById('set-autoCenterOnSelect')?.checked,
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

// ================= Настройка видимости столбцов (Phase 1.20.31) =================
// Пользователь выбирает, какие колонки отображать в таблицах. Настройки
// сохраняются в localStorage и не сбрасываются до явного изменения.
const _TABLE_COLUMN_KEY = (table) => 'raschet.tableColumns.' + table + '.v1';

function _loadColumnVisibility(table, allCols) {
  try {
    const raw = localStorage.getItem(_TABLE_COLUMN_KEY(table));
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        const result = {};
        for (const col of allCols) result[col.id] = col.id in saved ? !!saved[col.id] : (col.default !== false);
        return result;
      }
    }
  } catch {}
  const result = {};
  for (const col of allCols) result[col.id] = col.default !== false;
  return result;
}
function _saveColumnVisibility(table, visibility) {
  try { localStorage.setItem(_TABLE_COLUMN_KEY(table), JSON.stringify(visibility)); } catch {}
}

// Открывает popover с чекбоксами столбцов. onToggle вызывается при
// изменении состояния с новой visibility-картой.
function _openColumnMenu(anchorBtn, table, allCols, visibility, onToggle) {
  // Закрываем предыдущее меню если есть
  document.querySelectorAll('.rs-col-menu').forEach(m => m.remove());
  const r = anchorBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'rs-col-menu';
  menu.style.cssText = `position:fixed;top:${r.bottom + 4}px;left:${r.left}px;background:#fff;border:1px solid #d0d7de;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:8px;z-index:10000;min-width:200px;max-height:60vh;overflow:auto;font-family:system-ui,sans-serif`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const items = allCols.filter(c => !c.required).map(c => `
    <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px" onmouseover="this.style.background='#f0f3f6'" onmouseout="this.style.background=''">
      <input type="checkbox" data-col-id="${esc(c.id)}" ${visibility[c.id] ? 'checked' : ''}>
      <span>${esc(c.label)}</span>
    </label>
  `).join('');
  menu.innerHTML = `
    <div style="font-size:11px;color:#666;padding:2px 8px 6px;border-bottom:1px solid #eaecef;margin-bottom:4px;font-weight:600">Столбцы таблицы</div>
    ${items}
    <div style="display:flex;gap:6px;padding:6px 4px 2px;border-top:1px solid #eaecef;margin-top:4px">
      <button type="button" data-col-action="all" style="flex:1;padding:3px 6px;font-size:10px;border:1px solid #d0d7de;background:#fff;border-radius:3px;cursor:pointer">Все</button>
      <button type="button" data-col-action="none" style="flex:1;padding:3px 6px;font-size:10px;border:1px solid #d0d7de;background:#fff;border-radius:3px;cursor:pointer">Ничего</button>
      <button type="button" data-col-action="defaults" style="flex:1;padding:3px 6px;font-size:10px;border:1px solid #d0d7de;background:#fff;border-radius:3px;cursor:pointer">По умолч.</button>
    </div>
  `;
  document.body.appendChild(menu);
  const closeMenu = () => { menu.remove(); document.removeEventListener('click', outsideClick, true); };
  const outsideClick = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== anchorBtn) closeMenu();
  };
  setTimeout(() => document.addEventListener('click', outsideClick, true), 0);
  menu.querySelectorAll('input[data-col-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      visibility[cb.dataset.colId] = cb.checked;
      _saveColumnVisibility(table, visibility);
      onToggle(visibility);
    });
  });
  menu.querySelectorAll('button[data-col-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.colAction;
      for (const c of allCols) {
        if (c.required) continue;
        if (a === 'all') visibility[c.id] = true;
        else if (a === 'none') visibility[c.id] = false;
        else if (a === 'defaults') visibility[c.id] = c.default !== false;
      }
      _saveColumnVisibility(table, visibility);
      onToggle(visibility);
      closeMenu();
    });
  });
}

// ================= Таблица кабелей (Фаза 1.20) =================
// Быстрое редактирование всех кабельных линий: марка, длина, способ прокладки.
// Изменения применяются сразу в state и триггерят recalc+render.
// Phase 1.20.15: обозначение линии использует полный effectiveTag
// (включая parent chain: «MVS1.PDC3.ACU1»), а не только локальный tag.

// Column definitions для каждой таблицы (id используется в visibility-мапе
// и в рендере для if(vis.col) skip).
const _CABLE_TABLE_COLUMNS = [
  { id: 'checkbox', label: '(чекбокс)', required: true, default: true },
  { id: 'label', label: 'Обозначение', default: true },
  { id: 'fromTo', label: 'Откуда → Куда', default: true },
  { id: 'mark', label: 'Марка кабеля', default: true },
  { id: 'conductor', label: 'Проводник', default: true },
  { id: 'parallel', label: 'Линий', default: true },
  { id: 'length', label: 'Длина, м', default: true },
  { id: 'method', label: 'Способ прокладки', default: true },
  { id: 'breaker', label: 'Автомат', default: true },
  { id: 'curve', label: 'Тип автомата', default: false },
  { id: 'imax', label: 'Imax / Iдоп', default: true },
  { id: 'class', label: 'Класс', default: true },
  { id: 'status', label: 'Статус', default: true },
];
let _cableTableVisibility = _loadColumnVisibility('cable', _CABLE_TABLE_COLUMNS);

const _CONSUMERS_TABLE_COLUMNS = [
  { id: 'checkbox', label: '(чекбокс)', required: true, default: true },
  { id: 'tag', label: 'Обозначение', default: true },
  { id: 'name', label: 'Имя', default: true },
  { id: 'parent', label: 'Питающий щит', default: true },
  { id: 'category', label: 'Категория', default: true },
  { id: 'demand', label: 'P, кВт', default: true },
  { id: 'count', label: 'Кол-во (шт.)', default: true },
  { id: 'cosPhi', label: 'cos φ', default: true },
  { id: 'kUse', label: 'Kи', default: true },
  { id: 'phase', label: 'Фаза', default: true },
];
let _consumersTableVisibility = _loadColumnVisibility('consumers', _CONSUMERS_TABLE_COLUMNS);

const _EQUIPMENT_TABLE_COLUMNS = [
  { id: 'tag', label: 'Обозначение', default: true },
  { id: 'kind', label: 'Тип', default: true },
  { id: 'name', label: 'Имя / Модель', default: true },
  { id: 'voltage', label: 'U, В', default: true },
  { id: 'inputs', label: 'Входов', default: true },
  { id: 'outputs', label: 'Выходов', default: true },
  { id: 'capacity', label: 'P ном, кВт', default: true },
  { id: 'load', label: 'P расч, кВт', default: true },
  { id: 'loadPct', label: 'Загрузка', default: true },
  { id: 'ip', label: 'IP', default: true },
  { id: 'xnav', label: 'Связано', default: true },
];
let _equipTableVisibility = _loadColumnVisibility('equipment', _EQUIPMENT_TABLE_COLUMNS);

function _ctNodeTag(n) {
  if (!n) return '?';
  try {
    const eff = _effectiveTag(n);
    if (eff) return eff;
  } catch {}
  return n.tag || n.name || '?';
}
// Фаза 1.20.1: per-column фильтры (марка, длина min/max, способ, обозначение,
// from/to) + групповое редактирование выделенных строк.
let _cableTableFilters = {
  search: '', class: '',
  mark: '', method: '', conductor: '',
  parallel: null,            // Phase 1.20.3: отдельный фильтр по числу параллельных линий
  lengthMin: null, lengthMax: null,
  imaxMin: null, imaxMax: null,
  label: '', fromTo: '',
  // Phase 1.20.7: фильтр по категории (силовой/слаботочный/и т.д.)
  category: '',
  // Phase 1.20.9: фильтр по номиналу автомата (А, 0 = без автомата)
  breaker: null,
  // Phase 1.20.10: фильтр по типу/кривой (MCB_B/C/D/K/Z/MCCB/ACB/VCB/SF6/gG/aM)
  curve: '',
  // Phase 1.20.18: фильтр по статусу (ok / warn / error / utility)
  status: '',
};
// Phase 1.20.18: оценка статуса линии по её флагам
function _ctConnStatus(c) {
  if (c._utilityInfeed) return 'utility';
  if (c._breakerAgainstCable || c._breakerUndersize) return 'error';
  if (c._cableOverflow) return 'warn';
  return 'ok';
}

// Phase 1.20.27: auto-fix suggestion (та же логика что в Issues modal)
function _ctSuggestFix(c) {
  const In = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
  const Iz = Math.round(c._cableIz || 0) || 0;
  const Imax = Number(c._maxA) || 0;
  const series = _BREAKER_SERIES;
  if (c._breakerAgainstCable) {
    let suggested = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] <= Iz && series[i] >= Imax) { suggested = series[i]; break; }
    }
    if (suggested) return { kind: 'setBreakerIn', value: suggested, label: `In = ${suggested} А` };
    if (c.manualBreakerIn) return { kind: 'clearManualBreaker', label: 'снять ручной' };
    return null;
  }
  if (c._breakerUndersize) {
    let suggested = 0;
    for (const n of series) {
      if (n >= Imax && (!Iz || n <= Iz)) { suggested = n; break; }
    }
    if (suggested) return { kind: 'setBreakerIn', value: suggested, label: `In = ${suggested} А` };
    if (c.manualBreakerIn) return { kind: 'clearManualBreaker', label: 'снять ручной' };
  }
  return null;
}
let _cableTableSelected = new Set(); // ids выделенных строк для bulk-edit
// Phase 1.20.7: сортировка таблицы. col = поле, dir = 'asc'|'desc'
let _cableTableSort = { col: 'label', dir: 'asc' };

function openCableTableModal(opts) {
  openModal('modal-cable-table');
  if (opts && opts.prefilterClass) {
    _cableTableFilters.class = opts.prefilterClass;
  }
  renderCableTable();
  const srchEl = document.getElementById('cable-table-search');
  if (srchEl) srchEl.oninput = (e) => { _cableTableFilters.search = e.target.value; renderCableTable(); };
  const clsEl = document.getElementById('cable-table-filter-class');
  if (clsEl) {
    if (opts && opts.prefilterClass) clsEl.value = opts.prefilterClass;
    clsEl.onchange = (e) => { _cableTableFilters.class = e.target.value; renderCableTable(); };
  }
  const catEl = document.getElementById('cable-table-filter-category');
  if (catEl) {
    catEl.value = _cableTableFilters.category || '';
    catEl.onchange = (e) => { _cableTableFilters.category = e.target.value; renderCableTable(); };
  }
  const csvBtn = document.getElementById('cable-table-export-csv');
  if (csvBtn) csvBtn.onclick = exportCableTableCsv;
}

function exportCableTableCsv() {
  const S = window.Raschet?._state;
  if (!S) return;
  // Phase 1.20.8: CSV теперь учитывает текущие фильтры и сортировку
  // (согласуется с тем, что пользователь видит в таблице). Экспортируются
  // все кабели проекта (активные + inactive), кроме утилит-инфид.
  const F = _cableTableFilters || {};
  const q = (F.search || '').toLowerCase();
  const cls = F.class;
  const fMark = (F.mark || '').toLowerCase();
  const fMethod = (F.method || '').toLowerCase();
  const fCond = (F.conductor || '').toLowerCase();
  const fLabel = (F.label || '').toLowerCase();
  const fFromTo = (F.fromTo || '').toLowerCase();
  const fCategory = F.category || '';
  let allMarksLocal = [];
  try { allMarksLocal = _listCableTypes(); } catch {}
  const conns = [...S.conns.values()].filter(c => {
    if (!c._cableSize && !c._busbarNom) return false;
    if (cls === 'HV' && !c._isHV) return false;
    if (cls === 'DC' && !c._isDC) return false;
    if (cls === 'LV' && (c._isHV || c._isDC)) return false;
    const fromN = S.nodes.get(c.from?.nodeId);
    const toN = S.nodes.get(c.to?.nodeId);
    if (q) {
      const hay = [c.lineLabel, _ctNodeTag(fromN), _ctNodeTag(toN), fromN?.name, toN?.name, c.cableMark]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fLabel && !String(c.lineLabel || '').toLowerCase().includes(fLabel)) return false;
    if (fFromTo) {
      const ft = `${_ctNodeTag(fromN)} ${_ctNodeTag(toN)}`.toLowerCase();
      if (!ft.includes(fFromTo)) return false;
    }
    if (fMark) {
      const rec = allMarksLocal.find(m => m.id === c.cableMark);
      const brand = (rec?.brand || c.cableMark || '(без марки)').toLowerCase();
      if (brand !== fMark && (c.cableMark || '').toLowerCase() !== fMark) return false;
    }
    if (fMethod && String(c._cableMethod || c.installMethod || '').toLowerCase() !== fMethod) return false;
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
    if (F.parallel != null && Math.max(1, Number(c._cableParallel) || 1) !== F.parallel) return false;
    const L = Number(c.lengthM) || 0;
    if (F.lengthMin != null && L < F.lengthMin) return false;
    if (F.lengthMax != null && L > F.lengthMax) return false;
    const Imax = Number(c._maxA) || 0;
    if (F.imaxMin != null && Imax < F.imaxMin) return false;
    if (F.imaxMax != null && Imax > F.imaxMax) return false;
    if (fCategory) {
      const rec = c.cableMark ? allMarksLocal.find(m => m.id === c.cableMark) : null;
      const catVal = rec?.category || (c._isHV ? 'hv' : (c._isDC ? 'dc' : 'power'));
      if (catVal !== fCategory) return false;
    }
    return true;
  });

  // Применяем текущую сортировку (та же логика что в таблице)
  const sortCol = _cableTableSort.col;
  const sortDir = _cableTableSort.dir === 'desc' ? -1 : 1;
  const sortKey = (c) => {
    const fromN = S.nodes.get(c.from?.nodeId);
    const toN = S.nodes.get(c.to?.nodeId);
    switch (sortCol) {
      case 'label': return (c.lineLabel || `${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`).toLowerCase();
      case 'fromTo': return `${_ctNodeTag(fromN)} → ${_ctNodeTag(toN)}`.toLowerCase();
      case 'mark': {
        const rec = c.cableMark ? allMarksLocal.find(m => m.id === c.cableMark) : null;
        return (rec?.brand || c.cableMark || '').toLowerCase();
      }
      case 'conductor': return Number(c._cableSize) || 0;
      case 'parallel': return Math.max(1, Number(c._cableParallel) || 1);
      case 'length': return Number(c.lengthM) || 0;
      case 'method': return String(c._cableMethod || c.installMethod || '').toLowerCase();
      case 'imax': return Number(c._maxA) || 0;
      case 'class': return c._isHV ? 2 : (c._isDC ? 1 : 0);
      default: return 0;
    }
  };
  conns.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka < kb) return -1 * sortDir;
    if (ka > kb) return 1 * sortDir;
    return 0;
  });

  const rows = [['Обозначение', 'Откуда', 'Куда', 'Марка', 'Категория', 'Материал', 'Изоляция', 'Конструкция', 'Сечение, мм²', 'N-сечение, мм²', 'Число жил', 'Линий (параллель)', 'Длина, м', 'Способ прокладки', 'Автомат In, А', 'Автомат режим', 'Тип автомата', 'Imax, А', 'Iдоп, А', 'Класс', 'Состояние']];
  for (const c of conns) {
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const lineLabel = c.lineLabel || `${linePrefix}-${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`;
    const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
    const cls2 = c._isHV ? 'MV/HV' : (c._isDC ? 'DC' : 'LV');
    const rec = c.cableMark ? allMarksLocal.find(m => m.id === c.cableMark) : null;
    const catLabel = rec?.category || (c._isHV ? 'hv' : (c._isDC ? 'dc' : 'power'));
    const lineState = c.lineMode === 'damaged' ? 'Повреждена'
                    : c.lineMode === 'disabled' ? 'Отключена'
                    : (c._active ? 'Активна' : 'Неактивна');
    const brkIn = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
    const brkMode = c.manualBreakerIn ? 'ручной' : 'авто';
    const curveVal = String(c.breakerCurve || c._breakerCurveEff || '').toUpperCase();
    rows.push([
      lineLabel,
      _ctNodeTag(fromN),
      _ctNodeTag(toN),
      rec?.brand || c.cableMark || '',
      catLabel,
      c.material || '',
      c.insulation || '',
      c.cableType || '',
      c._cableSize || '',
      c._neutralSizeMm2 || '',
      cores,
      Math.max(1, Number(c._cableParallel) || 1),
      c.lengthM || 0,
      c._cableMethod || '',
      brkIn || '',
      brkIn ? brkMode : '',
      curveVal,
      c._maxA ? c._maxA.toFixed(1) : '',
      c._cableIz ? c._cableIz.toFixed(1) : '',
      cls2,
      lineState,
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

// Phase 1.20.7: <th> с sort-индикатором и click-переключением направления.
function _ctSortHdr(col, label, align, extraStyle, titleAttr) {
  const active = _cableTableSort.col === col;
  const arrow = active ? (_cableTableSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
  const colorCss = active ? 'color:#1976d2;' : '';
  const esc2 = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const titAttr = titleAttr ? ` title="${esc2(titleAttr)}"` : '';
  const styleStr = `padding:6px 8px;text-align:${align};border-bottom:2px solid #d0d7de;cursor:pointer;user-select:none;${colorCss}${extraStyle ? extraStyle + ';' : ''}`;
  return `<th class="ct-sort" data-sort-col="${esc2(col)}" style="${styleStr}"${titAttr}>${esc2(label)}${arrow}</th>`;
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
  const fCategory = F.category || '';
  const filtered = conns.filter(c => {
    if (cls === 'HV' && !c._isHV) return false;
    if (cls === 'DC' && !c._isDC) return false;
    if (cls === 'LV' && (c._isHV || c._isDC)) return false;
    // Phase 1.20.7: фильтр по категории кабеля (силовой/слаботочный/…)
    if (fCategory) {
      const rec = c.cableMark ? allMarks.find(m => m.id === c.cableMark) : null;
      const catVal = rec?.category || (c._isHV ? 'hv' : (c._isDC ? 'dc' : 'power'));
      if (catVal !== fCategory) return false;
    }
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    if (q) {
      const hay = [c.lineLabel, _ctNodeTag(fromN), _ctNodeTag(toN), fromN?.name, toN?.name, c.cableMark]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fLabel && !String(c.lineLabel || '').toLowerCase().includes(fLabel)
        && !`${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`.toLowerCase().includes(fLabel)) {
      return false;
    }
    if (fFromTo) {
      const ft = `${_ctNodeTag(fromN)} ${_ctNodeTag(toN)}`.toLowerCase();
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
    if (F.breaker != null) {
      const inNom = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
      if (inNom !== F.breaker) return false;
    }
    if (F.curve) {
      const curveVal = String(c.breakerCurve || c._breakerCurveEff || '').toUpperCase();
      if (curveVal !== F.curve) return false;
    }
    if (F.status && _ctConnStatus(c) !== F.status) return false;
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

  // Phase 1.20.7: сортировка по выбранному столбцу
  const sortCol = _cableTableSort.col;
  const sortDir = _cableTableSort.dir === 'desc' ? -1 : 1;
  const sortKey = (c) => {
    const fromN = S.nodes.get(c.from?.nodeId);
    const toN = S.nodes.get(c.to?.nodeId);
    switch (sortCol) {
      case 'label':
        return (c.lineLabel || `${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`).toLowerCase();
      case 'fromTo':
        return `${_ctNodeTag(fromN)} → ${_ctNodeTag(toN)}`.toLowerCase();
      case 'mark': {
        const rec = c.cableMark ? allMarks.find(m => m.id === c.cableMark) : null;
        return (rec?.brand || c.cableMark || '').toLowerCase();
      }
      case 'conductor':
        return Number(c._cableSize) || 0;
      case 'parallel':
        return Math.max(1, Number(c._cableParallel) || 1);
      case 'length':
        return Number(c.lengthM) || 0;
      case 'method':
        return String(c._cableMethod || c.installMethod || '').toLowerCase();
      case 'imax':
        return Number(c._maxA) || 0;
      case 'breaker':
        return Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
      case 'curve':
        return String(c.breakerCurve || c._breakerCurveEff || '').toUpperCase();
      case 'class':
        return c._isHV ? 2 : (c._isDC ? 1 : 0);
      case 'status': {
        // Сортируем так, чтобы error → warn → utility → ok (ошибки сверху при asc? нет — 0 сверху)
        const st = _ctConnStatus(c);
        return st === 'error' ? 0 : st === 'warn' ? 1 : st === 'utility' ? 2 : 3;
      }
      default:
        return 0;
    }
  };
  filtered.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka < kb) return -1 * sortDir;
    if (ka > kb) return 1 * sortDir;
    return 0;
  });

  // Distinct-значения для dropdown-фильтров (строим по всему conns, не
  // по filtered — чтобы выбор в dropdown'е не «пропадал» после других
  // фильтров и можно было расширить выборку обратно).
  const distinctMarks = new Set();
  const distinctConductors = new Set();   // только {cores × size}, без parallel
  const distinctParallels = new Set();    // количество проводников/линий
  const distinctMethods = new Set();
  const distinctBreakers = new Set();     // номиналы In, А
  const distinctCurves = new Set();       // типы/кривые автоматов
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
    const inNom = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
    distinctBreakers.add(inNom);
    const cv = String(c.breakerCurve || c._breakerCurveEff || '').toUpperCase();
    if (cv) distinctCurves.add(cv);
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
  const sortedBreakers = [...distinctBreakers].sort((a, b) => a - b);
  const sortedCurves = [...distinctCurves].sort();

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
  // Phase 1.20.31: видимость столбцов
  const vis = _cableTableVisibility;
  const show = (col) => vis[col] !== false;
  // Пропускаем column-rendering через show(): хелпер возвращает строку для
  // header/filter/body или пустую если колонка скрыта.
  const ifShow = (col, html) => show(col) ? html : '';
  const html = [`
    <div class="ct-bulk-bar" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;margin-bottom:8px;font-size:12px;flex-wrap:wrap">
      <b>Выделено: ${selCount}</b>
      <button type="button" id="ct-bulk-mark" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Марка</button>
      <button type="button" id="ct-bulk-length" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Длина</button>
      <button type="button" id="ct-bulk-method" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Способ</button>
      <button type="button" id="ct-bulk-scale" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}" title="Умножить длины на коэффициент">× Длина</button>
      <button type="button" id="ct-bulk-breaker" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}" title="Назначить / снять ручной номинал автомата">Автомат</button>
      <button type="button" id="ct-bulk-curve" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}" title="Назначить тип автомата (кривую)">Тип</button>
      <span style="flex:1"></span>
      ${(() => {
        // Phase 1.20.29: автофикс всех error-линий в текущей выборке
        const fixableInView = filtered.filter(c => _ctSuggestFix(c));
        if (!fixableInView.length) return '';
        return `<button type="button" id="ct-bulk-autofix" title="Применить автофиксы ко всем ошибкам в выборке" style="padding:4px 10px;border:1px solid #2e7d32;background:#e8f5e9;color:#2e7d32;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600">🔧 Исправить всё (${fixableInView.length})</button>`;
      })()}
      <button type="button" id="ct-col-menu" title="Настроить видимость столбцов" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px">⚙ Столбцы</button>
      <button type="button" id="ct-clear-filters" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px">Сбросить фильтры</button>
      <button type="button" id="ct-clear-sel" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Снять выделение</button>
    </div>
    <table class="cable-table" style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f6f8fa;position:sticky;top:0;z-index:2">
          <th style="padding:6px 4px;border-bottom:2px solid #d0d7de;width:28px;text-align:center">
            <input type="checkbox" id="ct-select-all" ${filtered.length && filtered.every(c => _cableTableSelected.has(c.id)) ? 'checked' : ''} title="Выделить все">
          </th>
          ${ifShow('label', _ctSortHdr('label', 'Обозначение', 'left'))}
          ${ifShow('fromTo', _ctSortHdr('fromTo', 'Откуда → Куда', 'left'))}
          ${ifShow('mark', _ctSortHdr('mark', 'Марка кабеля', 'left', 'min-width:200px'))}
          ${ifShow('conductor', _ctSortHdr('conductor', 'Проводник', 'left'))}
          ${ifShow('parallel', _ctSortHdr('parallel', 'Линий', 'right', '', 'Параллельные проводники (линий)'))}
          ${ifShow('length', _ctSortHdr('length', 'Длина, м', 'right'))}
          ${ifShow('method', _ctSortHdr('method', 'Способ прокладки', 'left', 'min-width:150px'))}
          ${ifShow('breaker', _ctSortHdr('breaker', 'Автомат', 'right', 'min-width:110px'))}
          ${ifShow('curve', _ctSortHdr('curve', 'Тип', 'left', 'min-width:95px', 'Тип автомата / кривая'))}
          ${ifShow('imax', _ctSortHdr('imax', 'Imax / Iдоп', 'right'))}
          ${ifShow('class', _ctSortHdr('class', 'Класс', 'center'))}
          ${ifShow('status', _ctSortHdr('status', 'Статус', 'center', 'min-width:64px', 'OK / предупреждение / ошибка'))}
        </tr>
        <tr style="background:#fafbfc;position:sticky;top:28px;z-index:1;font-weight:400">
          <th style="padding:3px 4px;border-bottom:1px solid #d0d7de"></th>
          ${ifShow('label', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><input type="text" class="ct-flt" data-flt="label" placeholder="фильтр…" value="${esc(F.label)}" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>`)}
          ${ifShow('fromTo', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><input type="text" class="ct-flt" data-flt="fromTo" placeholder="от/куда…" value="${esc(F.fromTo)}" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>`)}
          ${ifShow('mark', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="mark" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все марки —</option>${sortedMarks.map(v => `<option value="${esc(v)}" ${F.mark === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`)}
          ${ifShow('conductor', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="conductor" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все проводники —</option>${sortedConductors.map(v => `<option value="${esc(v)}" ${F.conductor === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`)}
          ${ifShow('parallel', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="parallel" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">все</option>${sortedParallels.map(v => `<option value="${v}" ${F.parallel === v ? 'selected' : ''}>${v}</option>`).join('')}</select></th>`)}
          ${ifShow('length', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de;white-space:nowrap"><input type="number" class="ct-flt" data-flt="lengthMin" placeholder="от" value="${F.lengthMin ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><input type="number" class="ct-flt" data-flt="lengthMax" placeholder="до" value="${F.lengthMax ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>`)}
          ${ifShow('method', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="method" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все способы —</option>${sortedMethods.map(v => `<option value="${esc(v)}" ${F.method === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`)}
          ${ifShow('breaker', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="breaker" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">все</option>${sortedBreakers.map(v => `<option value="${v}" ${F.breaker === v ? 'selected' : ''}>${v ? v + ' А' : '—'}</option>`).join('')}</select></th>`)}
          ${ifShow('curve', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="curve" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все —</option>${sortedCurves.map(v => `<option value="${esc(v)}" ${F.curve === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`)}
          ${ifShow('imax', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de;white-space:nowrap"><input type="number" class="ct-flt" data-flt="imaxMin" placeholder="от" value="${F.imaxMin ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><input type="number" class="ct-flt" data-flt="imaxMax" placeholder="до" value="${F.imaxMax ?? ''}" style="width:44px;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"></th>`)}
          ${ifShow('class', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"></th>`)}
          ${ifShow('status', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ct-flt" data-flt="status" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">все</option><option value="ok" ${F.status === 'ok' ? 'selected' : ''}>✓ OK</option><option value="warn" ${F.status === 'warn' ? 'selected' : ''}>⚠ Warn</option><option value="error" ${F.status === 'error' ? 'selected' : ''}>✗ Ошибка</option><option value="utility" ${F.status === 'utility' ? 'selected' : ''}>🏙 Utility</option></select></th>`)}
        </tr>
      </thead>
      <tbody>`];
  for (const c of filtered) {
    const fromN = S.nodes.get(c.from.nodeId);
    const toN = S.nodes.get(c.to.nodeId);
    // Phase 1.20.15: полное обозначение (с parent chain) вместо локального tag
    const fromLabel = _ctNodeTag(fromN);
    const toLabel = _ctNodeTag(toN);
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
        ${ifShow('label', `<td style="padding:5px 8px;font-weight:600">
          <a href="#" class="ct-jump" data-id="${esc(c.id)}" title="Перейти к линии на схеме" style="color:#1976d2;text-decoration:none;display:inline-flex;align-items:center;gap:4px">${esc(lineLabel)}<span style="font-size:10px;opacity:0.7">↗</span></a>
          <button type="button" class="ct-tcc" data-id="${esc(c.id)}" title="Показать карту защиты (TCC)" style="margin-left:6px;padding:1px 6px;border:1px solid #bbdefb;background:#f0f4ff;color:#1565c0;border-radius:3px;cursor:pointer;font-size:10px">TCC</button>
        </td>`)}
        ${ifShow('fromTo', `<td style="padding:5px 8px;font-size:11px">${esc(fromLabel)} → ${esc(toLabel)}</td>`)}
        ${ifShow('mark', `<td style="padding:5px 8px"><select class="ct-mark" data-id="${esc(c.id)}" style="width:100%;padding:3px 6px;font-size:11px">${markOpts}</select></td>`)}
        ${ifShow('conductor', `<td style="padding:5px 8px;font-size:11px">${esc(conductorSpec)}</td>`)}
        ${ifShow('parallel', `<td style="padding:5px 8px;text-align:right;font-size:11px;${parallelN > 1 ? 'color:#1976d2;font-weight:600' : 'color:#999'}">${parallelN}</td>`)}
        ${ifShow('length', `<td style="padding:5px 8px;text-align:right"><input class="ct-length" data-id="${esc(c.id)}" type="number" min="0" step="0.5" value="${lengthVal}" style="width:70px;padding:3px 6px;text-align:right"></td>`)}
        ${ifShow('method', `<td style="padding:5px 8px"><select class="ct-method" data-id="${esc(c.id)}" style="width:100%;padding:3px 6px;font-size:11px">${methodOpts}</select></td>`)}
        ${ifShow('breaker', `<td style="padding:5px 8px;text-align:right;font-size:11px">${(() => {
          const auto = Number(c._breakerIn) || 0;
          const manual = !!c.manualBreakerIn;
          const cur = manual ? Number(c.manualBreakerIn) : auto;
          let opts = `<option value="">авто${auto ? ' (' + auto + ' А)' : ''}</option>`;
          for (const nn of _BREAKER_SERIES) opts += `<option value="${nn}"${(manual && nn === cur) ? ' selected' : ''}>${nn} А</option>`;
          const badge = !manual ? '<span class="muted" style="font-size:10px;color:#4caf50;margin-left:4px" title="авто">✓</span>' : '<span class="muted" style="font-size:10px;color:#e65100;margin-left:4px" title="ручной">✎</span>';
          return `<select class="ct-breaker" data-id="${esc(c.id)}" style="width:80px;padding:3px 6px;font-size:11px">${opts}</select>${badge}`;
        })()}</td>`)}
        ${ifShow('curve', `<td style="padding:5px 8px;font-size:11px">${(() => {
          const curCv = String(c.breakerCurve || '').toUpperCase();
          const effCv = String(c._breakerCurveEff || '').toUpperCase();
          let opts = `<option value="">авто${effCv ? ' (' + esc(effCv) + ')' : ''}</option>`;
          for (const [id, def] of Object.entries(_BREAKER_TYPES)) opts += `<option value="${esc(id)}"${curCv === id.toUpperCase() ? ' selected' : ''}>${esc(def.label)}</option>`;
          return `<select class="ct-curve" data-id="${esc(c.id)}" style="width:100%;padding:3px 6px;font-size:11px">${opts}</select>`;
        })()}</td>`)}
        ${ifShow('imax', `<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;color:#555">${_ctFmt(c._maxA || 0)} / ${_ctFmt(c._cableIz || 0)} А</td>`)}
        ${ifShow('class', `<td style="padding:5px 8px;text-align:center;font-size:11px;color:${clsColor};font-weight:600">${cls}</td>`)}
        ${ifShow('status', `<td style="padding:5px 8px;text-align:center;font-size:11px">${(() => {
          const st = _ctConnStatus(c);
          if (st === 'utility') return '<span title="Ввод от городской сети — ТУ поставщика" style="display:inline-block;padding:1px 6px;background:#eef5ff;color:#1565c0;border:1px solid #bbdefb;border-radius:3px;font-size:10px">🏙 utility</span>';
          if (st === 'error') {
            const reasons = [];
            if (c._breakerAgainstCable) reasons.push('In > Iz');
            if (c._breakerUndersize) reasons.push('In < Iрасч');
            const fix = _ctSuggestFix(c);
            const clickable = !!fix;
            return `<span class="${clickable ? 'ct-fix-badge' : ''}" data-id="${esc(c.id)}" title="${esc(reasons.join(', '))}${clickable ? ' · клик — применить фикс (' + esc(fix.label) + ')' : ''}" style="display:inline-block;padding:1px 6px;background:#ffebee;color:#c62828;border:1px solid #ef9a9a;border-radius:3px;font-size:10px;font-weight:600;${clickable ? 'cursor:pointer' : ''}">✗ ${esc(reasons.join(', '))}${clickable ? ' 🔧' : ''}</span>`;
          }
          if (st === 'warn') return '<span title="Сечение превышено" style="display:inline-block;padding:1px 6px;background:#fff8e1;color:#e65100;border:1px solid #ffcc80;border-radius:3px;font-size:10px">⚠ warn</span>';
          return '<span title="OK" style="display:inline-block;padding:1px 6px;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:3px;font-size:10px">✓ OK</span>';
        })()}</td>`)}
      </tr>`);
  }
  // Динамический colspan для «no-rows» строки
  const visibleCount = 1 /* checkbox */ + _CABLE_TABLE_COLUMNS.filter(c => c.id !== 'checkbox' && show(c.id)).length;
  if (!filtered.length) {
    html.push(`<tr><td colspan="${visibleCount}" style="padding:20px;text-align:center;color:#999">Нет кабельных линий по текущим фильтрам</td></tr>`);
  }
  html.push('</tbody></table>');
  mount.innerHTML = html.join('');

  // Обработчики изменений (change, не input — чтобы не терять фокус)
  // Phase 1.20.5: после изменения свойства conn нужно вызвать render()
  // чтобы пересчитался _cableMethod / _maxA / _cableIz (recalc triggered
  // только из render). Иначе bulk-edit способа прокладки / длины не
  // отражается в таблице до следующего ручного действия.
  // Phase 1.20.17: snapshot перед изменениями — чтобы bulk-edit и inline-
  // правки попадали в undo-стек (Ctrl+Z откатывает последнее изменение).
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
  const snap = (tag) => { if (typeof window.Raschet?.snapshot === 'function') window.Raschet.snapshot(tag); };
  mount.querySelectorAll('.ct-mark').forEach(sel => {
    sel.addEventListener('change', () => {
      snap('cable-table:mark:' + sel.dataset.id);
      apply(sel.dataset.id, (c) => {
        c.cableMark = sel.value || null;
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
      snap('cable-table:length:' + inp.dataset.id);
      apply(inp.dataset.id, (c) => { c.lengthM = Math.max(0, Number(inp.value) || 0); });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ct-method').forEach(sel => {
    sel.addEventListener('change', () => {
      snap('cable-table:method:' + sel.dataset.id);
      apply(sel.dataset.id, (c) => { c.installMethod = sel.value || undefined; });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ct-breaker').forEach(sel => {
    sel.addEventListener('change', () => {
      snap('cable-table:breaker:' + sel.dataset.id);
      apply(sel.dataset.id, (c) => {
        if (sel.value === '') delete c.manualBreakerIn;
        else c.manualBreakerIn = Number(sel.value);
      });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ct-curve').forEach(sel => {
    sel.addEventListener('change', () => {
      snap('cable-table:curve:' + sel.dataset.id);
      apply(sel.dataset.id, (c) => {
        if (sel.value === '') delete c.breakerCurve;
        else c.breakerCurve = sel.value;
      });
      applyAndRerender();
    });
  });

  // Phase 1.20.11: клик по обозначению линии — выделяет её на схеме и
  // закрывает модалку (пользователь сразу видит её параметры в инспекторе).
  mount.querySelectorAll('.ct-jump').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.id;
      if (typeof window.Raschet?.selectConnAndFocus === 'function') {
        window.Raschet.selectConnAndFocus(id);
      }
      closeModal('modal-cable-table');
    });
  });

  // Phase 1.20.27: клик по ✗ badge в колонке «Статус» применяет автофикс
  mount.querySelectorAll('.ct-fix-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = badge.dataset.id;
      const c = window.Raschet?._state?.conns?.get(id);
      if (!c) return;
      const fix = _ctSuggestFix(c);
      if (!fix) return;
      snap('cable-table:status-fix:' + id);
      if (fix.kind === 'setBreakerIn') c.manualBreakerIn = Number(fix.value);
      else if (fix.kind === 'clearManualBreaker') delete c.manualBreakerIn;
      applyAndRerender();
      flash(`Применён фикс: ${fix.label}`);
    });
  });

  // Phase 1.20.12: TCC-кнопка в строке — открывает модалку с картой защиты
  // (band-кривые автомата + термостойкость кабеля + upstream + Ik) для
  // этой конкретной линии, без открытия инспектора.
  mount.querySelectorAll('.ct-tcc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (typeof window.Raschet?.openConnTcc === 'function') {
        window.Raschet.openConnTcc(id);
      }
    });
  });

  // Phase 1.20.7: сортировка по клику на шапку
  mount.querySelectorAll('.ct-sort').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      if (!col) return;
      if (_cableTableSort.col === col) {
        _cableTableSort.dir = _cableTableSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _cableTableSort.col = col;
        _cableTableSort.dir = 'asc';
      }
      renderCableTable();
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
      else if (k === 'parallel' || k === 'breaker') v = (v === '' ? null : Number(v));
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
      category: '', breaker: null, curve: '', status: '',
    };
    const s = document.getElementById('cable-table-search'); if (s) s.value = '';
    const cls = document.getElementById('cable-table-filter-class'); if (cls) cls.value = '';
    const cat = document.getElementById('cable-table-filter-category'); if (cat) cat.value = '';
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
  // Phase 1.20.17: один snapshot на всю bulk-операцию — чтобы Ctrl+Z
  // откатывал её целиком за один шаг.
  const bulkApply = (fn) => {
    const ids = [..._cableTableSelected];
    if (!ids.length) return;
    snap('cable-table:bulk:' + ids.length);
    let affectedCount = 0;
    for (const id of ids) {
      const cc = window.Raschet?._state?.conns?.get(id);
      if (!cc) continue;
      const before = { cableMark: cc.cableMark, lengthM: cc.lengthM, installMethod: cc.installMethod, manualBreakerIn: cc.manualBreakerIn, breakerCurve: cc.breakerCurve };
      apply(id, fn);
      if (before.cableMark !== cc.cableMark || before.lengthM !== cc.lengthM || before.installMethod !== cc.installMethod
          || before.manualBreakerIn !== cc.manualBreakerIn || before.breakerCurve !== cc.breakerCurve) {
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
  const brkBtn = mount.querySelector('#ct-bulk-breaker');
  if (brkBtn) brkBtn.addEventListener('click', () => _openBulkCableDialog('breaker', filtered, allMarks, byCat, CAT_LABEL, bulkApply));
  const curveBtn = mount.querySelector('#ct-bulk-curve');
  if (curveBtn) curveBtn.addEventListener('click', () => _openBulkCableDialog('curve', filtered, allMarks, byCat, CAT_LABEL, bulkApply));
  // Phase 1.20.31: меню настройки столбцов
  const colBtn = mount.querySelector('#ct-col-menu');
  if (colBtn) colBtn.addEventListener('click', () => {
    _openColumnMenu(colBtn, 'cable', _CABLE_TABLE_COLUMNS, _cableTableVisibility, (v) => {
      _cableTableVisibility = v;
      renderCableTable();
    });
  });
  // Phase 1.20.29: автофикс всех error-линий в текущей выборке одной кнопкой
  const autofixBtn = mount.querySelector('#ct-bulk-autofix');
  if (autofixBtn) autofixBtn.addEventListener('click', () => {
    const fixable = filtered.filter(c => _ctSuggestFix(c));
    if (!fixable.length) return;
    if (!confirm(`Применить ${fixable.length} автофиксов к ошибочным линиям в текущей выборке? Действие обратимо через Ctrl+Z.`)) return;
    snap('cable-table:autofix-all:' + fixable.length);
    let applied = 0;
    for (const c of fixable) {
      const fix = _ctSuggestFix(c);
      if (!fix) continue;
      if (fix.kind === 'setBreakerIn') c.manualBreakerIn = Number(fix.value);
      else if (fix.kind === 'clearManualBreaker') delete c.manualBreakerIn;
      applied++;
    }
    if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
    renderCableTable();
    flash(`Применено автофиксов: ${applied}`);
  });
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
  } else if (kind === 'breaker') {
    let opts = '<option value="auto">🔄 Вернуть к авто-подбору</option>';
    for (const n of _BREAKER_SERIES) opts += `<option value="${n}">${n} А</option>`;
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Назначить номинал автомата для всех ${count} выделенных линий. «Вернуть к авто» снимает ручную установку и автомат будет подобран по Iрасч и Iz.</p>
      <label>Номинал автомата, А<br><select id="bulk-breaker" style="width:100%;padding:5px 8px;margin-top:4px">${opts}</select></label>
      <div class="warn" style="background:#fff8e1;border-left:3px solid #f57c00;padding:8px 12px;margin-top:10px;border-radius:0 4px 4px 0;font-size:11px;color:#e65100">⚠ Убедитесь что выбранный номинал совместим с I<sub>расч</sub> и I<sub>z</sub> каждой линии: I<sub>расч</sub> ≤ I<sub>n</sub> ≤ I<sub>z</sub>.</div>
    `;
    applyFn = () => {
      const v = document.getElementById('bulk-breaker').value;
      if (v === 'auto') {
        bulkApply((c) => { delete c.manualBreakerIn; });
      } else {
        const n = Number(v);
        if (!n) return;
        bulkApply((c) => { c.manualBreakerIn = n; });
      }
    };
  } else if (kind === 'curve') {
    let opts = '<option value="auto">🔄 Вернуть к авто (по напряжению/In)</option>';
    for (const [id, def] of Object.entries(_BREAKER_TYPES)) {
      opts += `<option value="${esc(id)}">${esc(def.label)} — ${esc(def.desc || '')}</option>`;
    }
    bodyHtml = `
      <p class="muted" style="font-size:11px;margin:0 0 8px">Назначить тип автомата (кривую) для всех ${count} выделенных линий. Для HV-линий будет проигнорировано кроме VCB/SF6.</p>
      <label>Тип автомата<br><select id="bulk-curve" style="width:100%;padding:5px 8px;margin-top:4px">${opts}</select></label>
    `;
    applyFn = () => {
      const v = document.getElementById('bulk-curve').value;
      if (v === 'auto') {
        bulkApply((c) => { delete c.breakerCurve; });
      } else {
        bulkApply((c) => {
          const def = _BREAKER_TYPES[v];
          // HV-линия и LV-кривая — пропускаем (несовместимы)
          if (c._isHV && !def?.hv) return;
          if (!c._isHV && def?.hv) return;
          c.breakerCurve = v;
        });
      }
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

// ================= Сводка проекта / Dashboard (Phase 1.20.26) =================
function openDashboardModal() {
  openModal('modal-dashboard');
  renderDashboard();
}

function renderDashboard() {
  const mount = document.getElementById('dashboard-mount');
  if (!mount) return;
  const S = window.Raschet?._state;
  if (!S) { mount.innerHTML = '<div class="muted">Состояние недоступно</div>'; return; }
  const proj = S.project || {};

  // Счётчики узлов
  const counts = { source: 0, generator: 0, 'panel-lv': 0, 'panel-mv': 0, ups: 0, consumer: 0 };
  let totalLoad = 0, totalCap = 0;
  for (const n of S.nodes.values()) {
    const k = _equipKindOf(n);
    if (k) counts[k] = (counts[k] || 0) + 1;
    if (n.type === 'consumer') counts.consumer++;
    if (n.type === 'source' || n.type === 'generator') {
      totalCap += Number(n.capacityKw) || 0;
      totalLoad += Number(n._loadKw) || 0;
    }
  }

  // Кабельная продукция — суммы по классам / материалам
  const cableStats = { LV: { count: 0, m: 0 }, HV: { count: 0, m: 0 }, DC: { count: 0, m: 0 } };
  const byMaterial = new Map();
  for (const c of S.conns.values()) {
    if (!c._cableSize && !c._busbarNom) continue;
    if (c._utilityInfeed) continue;
    const cls = c._isHV ? 'HV' : (c._isDC ? 'DC' : 'LV');
    cableStats[cls].count++;
    const parallel = Math.max(1, c._cableParallel || 1);
    const groupCount = Array.isArray(c._groupCables) && c._groupCables.length > 1 ? c._groupCables.length : 1;
    const len = (Number(c.lengthM) || 0) * parallel * groupCount;
    cableStats[cls].m += len;
    const matKey = `${c.material || 'Cu'}/${c.insulation || 'PVC'}`;
    byMaterial.set(matKey, (byMaterial.get(matKey) || 0) + len);
  }

  // Проблемы
  const { errors, warns } = _countProjectIssues();

  // BOM цена (если есть)
  let priceSummary = null;
  try {
    const bom = window.Raschet?.getBom?.({ priceStrategy: 'latest', activeOnly: true });
    if (bom?.totals?.totals) {
      const entries = [...bom.totals.totals.entries()];
      if (entries.length) {
        priceSummary = {
          byCurrency: entries,
          missingCount: bom.totals.missingCount,
          totalRows: bom.totals.totalRows,
        };
      }
    }
  } catch {}

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const card = (title, value, sub, bg, color, action) => {
    const cursor = action ? 'cursor:pointer' : '';
    const attrs = action ? ` class="dash-card" data-action="${esc(action)}" title="Нажмите, чтобы открыть"` : '';
    const hoverHint = action ? `<div style="font-size:9px;color:#999;margin-top:4px">▸ нажмите</div>` : '';
    return `
    <div${attrs} style="padding:14px 16px;background:${bg || '#fafbfc'};border:1px solid #e1e4e8;border-radius:6px;min-width:170px;flex:1;${cursor};transition:transform .08s ease, box-shadow .08s ease">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.3px">${esc(title)}</div>
      <div style="font-size:22px;font-weight:600;color:${color || '#24292e'};margin-top:4px">${value}</div>
      ${sub ? `<div style="font-size:10px;color:#888;margin-top:2px">${sub}</div>` : ''}
      ${hoverHint}
    </div>
  `;
  };

  const fmtN = (v, d = 1) => {
    const n = Number(v) || 0;
    return n.toLocaleString('ru-RU', { maximumFractionDigits: d });
  };

  const loadPct = totalCap > 0 ? (totalLoad / totalCap * 100) : 0;

  const html = [];

  // Метаданные проекта
  html.push(`
    <div style="padding:14px 18px;background:linear-gradient(to right, #1976d2, #1565c0);color:#fff;border-radius:8px;margin-bottom:16px">
      <h2 style="margin:0 0 4px;font-size:18px">${esc(proj.name || proj.designation || 'Без названия')}</h2>
      <div style="font-size:11px;opacity:0.9">
        ${proj.designation ? esc(proj.designation) : ''}
        ${proj.customer ? ' · ' + esc(proj.customer) : ''}
        ${proj.object ? ' · ' + esc(proj.object) : ''}
        ${proj.stage ? ' · ' + esc(proj.stage) : ''}
      </div>
      ${proj.author ? `<div style="font-size:11px;opacity:0.85;margin-top:4px">ГИП: ${esc(proj.author)}</div>` : ''}
    </div>
  `);

  // Ряд карточек: общий статус
  html.push(`
    <h3 style="margin:14px 0 8px;font-size:13px">Общий статус</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${card('Проблем', (errors + warns) ? `${errors} / ${warns}` : '0',
        'ошибок / предупреждений',
        (errors + warns) ? (errors ? '#ffebee' : '#fff8e1') : '#e8f5e9',
        errors ? '#c62828' : (warns ? '#e65100' : '#2e7d32'),
        (errors + warns) ? 'issues' : null)}
      ${card('Общая нагрузка', fmtN(totalLoad) + ' кВт',
        totalCap > 0 ? `из ${fmtN(totalCap)} кВт (${loadPct.toFixed(0)}% загрузки)` : '—',
        loadPct > 100 ? '#ffebee' : loadPct > 90 ? '#fff8e1' : '#e8f5e9',
        loadPct > 100 ? '#c62828' : loadPct > 90 ? '#e65100' : '#2e7d32',
        'equipment-sources')}
      ${priceSummary && priceSummary.byCurrency.length
        ? card('Стоимость BOM',
          priceSummary.byCurrency.map(([cur, sum]) => `${fmtN(sum, 0)} ${cur}`).join(' · '),
          priceSummary.missingCount
            ? `⚠ без цены: ${priceSummary.missingCount} из ${priceSummary.totalRows}`
            : `по ${priceSummary.totalRows} позициям`,
          '#eef5ff', '#1565c0', 'bom')
        : card('Стоимость BOM', '—', 'прайс не подключён', '#f5f5f5', '#888')}
    </div>
  `);

  // Оборудование
  html.push(`
    <h3 style="margin:18px 0 8px;font-size:13px">Оборудование</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${card('⚡ Источники', counts.source || 0, null, null, null, counts.source ? 'equipment-sources' : null)}
      ${card('🔋 Генераторы', counts.generator || 0, null, null, null, counts.generator ? 'equipment-generators' : null)}
      ${card('🗄 НКУ (LV)', counts['panel-lv'] || 0, null, null, null, counts['panel-lv'] ? 'equipment-panels-lv' : null)}
      ${card('⚡ РУ СН', counts['panel-mv'] || 0, null, null, null, counts['panel-mv'] ? 'equipment-panels-mv' : null)}
      ${card('🔌 ИБП', counts.ups || 0, null, null, null, counts.ups ? 'equipment-ups' : null)}
      ${card('💡 Потребители', counts.consumer || 0, null, null, null, counts.consumer ? 'consumers' : null)}
    </div>
  `);

  // Кабели
  const totalMeters = cableStats.LV.m + cableStats.HV.m + cableStats.DC.m;
  const totalConns = cableStats.LV.count + cableStats.HV.count + cableStats.DC.count;
  html.push(`
    <h3 style="margin:18px 0 8px;font-size:13px">Кабельная продукция</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${card('Всего линий', totalConns, `${fmtN(totalMeters)} м суммарно`, null, null, totalConns ? 'cables' : null)}
      ${card('LV', cableStats.LV.count, `${fmtN(cableStats.LV.m)} м`, '#eef5ff', '#1565c0', cableStats.LV.count ? 'cables-lv' : null)}
      ${card('MV/HV', cableStats.HV.count, `${fmtN(cableStats.HV.m)} м`, '#fff4e5', '#c67300', cableStats.HV.count ? 'cables-hv' : null)}
      ${cableStats.DC.count ? card('DC', cableStats.DC.count, `${fmtN(cableStats.DC.m)} м`, '#f3e5f5', '#7b1fa2', 'cables-dc') : ''}
    </div>
    ${byMaterial.size ? `
      <div style="margin-top:8px;padding:10px 14px;background:#f6f8fa;border-radius:6px;font-size:11px;color:#555">
        По материалу / изоляции:
        ${[...byMaterial.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<b>${esc(k)}</b> — ${fmtN(v)} м`).join(' · ')}
      </div>
    ` : ''}
  `);

  // Быстрые действия
  html.push(`
    <h3 style="margin:18px 0 8px;font-size:13px">Быстрые действия</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="dash-action" data-action="issues" style="padding:8px 14px;border:1px solid #c62828;background:#fff;color:#c62828;border-radius:4px;cursor:pointer;font-size:12px">⚠ Проверки проекта</button>
      <button type="button" class="dash-action" data-action="cables" style="padding:8px 14px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:4px;cursor:pointer;font-size:12px">🔌 Таблица кабелей</button>
      <button type="button" class="dash-action" data-action="consumers" style="padding:8px 14px;border:1px solid #7b1fa2;background:#fff;color:#7b1fa2;border-radius:4px;cursor:pointer;font-size:12px">💡 Таблица потребителей</button>
      <button type="button" class="dash-action" data-action="equipment" style="padding:8px 14px;border:1px solid #5d4037;background:#fff;color:#5d4037;border-radius:4px;cursor:pointer;font-size:12px">🗄 Таблица оборудования</button>
      <button type="button" class="dash-action" data-action="search" style="padding:8px 14px;border:1px solid #2e7d32;background:#fff;color:#2e7d32;border-radius:4px;cursor:pointer;font-size:12px">🔍 Найти (Ctrl+F)</button>
    </div>
  `);

  mount.innerHTML = html.join('');

  // Wire actions
  const runAction = (a) => {
    closeModal('modal-dashboard');
    setTimeout(() => {
      if (a === 'issues') openProjectIssuesModal();
      else if (a === 'cables') openCableTableModal();
      else if (a === 'cables-lv') openCableTableModal({ prefilterClass: 'LV' });
      else if (a === 'cables-hv') openCableTableModal({ prefilterClass: 'HV' });
      else if (a === 'cables-dc') openCableTableModal({ prefilterClass: 'DC' });
      else if (a === 'consumers') openConsumersTableModal();
      else if (a === 'equipment') openEquipmentTableModal();
      else if (a === 'equipment-sources') openEquipmentTableModal({ prefilterKind: 'source' });
      else if (a === 'equipment-generators') openEquipmentTableModal({ prefilterKind: 'generator' });
      else if (a === 'equipment-panels-lv') openEquipmentTableModal({ prefilterKind: 'panel-lv' });
      else if (a === 'equipment-panels-mv') openEquipmentTableModal({ prefilterKind: 'panel-mv' });
      else if (a === 'equipment-ups') openEquipmentTableModal({ prefilterKind: 'ups' });
      else if (a === 'bom') { const b = document.getElementById('btn-bom'); if (b) b.click(); }
      else if (a === 'search') openSearchPalette();
    }, 100);
  };
  mount.querySelectorAll('.dash-action').forEach(btn => {
    btn.addEventListener('click', () => runAction(btn.dataset.action));
  });
  mount.querySelectorAll('.dash-card').forEach(c => {
    c.addEventListener('click', () => runAction(c.dataset.action));
    c.addEventListener('mouseenter', () => {
      c.style.transform = 'translateY(-1px)';
      c.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
    });
    c.addEventListener('mouseleave', () => {
      c.style.transform = '';
      c.style.boxShadow = '';
    });
  });
}

// ================= Проверки проекта (Phase 1.20.19) =================
// Сводка всех ошибок/предупреждений в проекте с навигацией по клику.
function openProjectIssuesModal() {
  openModal('modal-project-issues');
  renderProjectIssues();
  const csvBtn = document.getElementById('project-issues-export-csv');
  if (csvBtn) csvBtn.onclick = exportProjectIssuesCsv;
}

// Phase 1.20.23: экспорт всех проблем в CSV для аудита / приёмки проекта
function exportProjectIssuesCsv() {
  const S = window.Raschet?._state;
  if (!S) return;
  const rows = [['Уровень', 'Тип', 'Объект', 'Маршрут / Расположение', 'Причина', 'Детали']];

  // Cable errors / warns
  for (const c of S.conns.values()) {
    if (!c._cableSize && !c._busbarNom) continue;
    if (c._utilityInfeed) continue;
    const fromN = S.nodes.get(c.from?.nodeId);
    const toN = S.nodes.get(c.to?.nodeId);
    const prefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const label = c.lineLabel || `${prefix}-${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`;
    const route = `${_ctNodeTag(fromN)} → ${_ctNodeTag(toN)}`;
    const In = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
    const Iz = Math.round(c._cableIz || 0) || 0;
    const Imax = Math.round(c._maxA || 0) || 0;
    if (c._breakerAgainstCable) {
      rows.push(['Ошибка', 'Кабель: In > Iz', label, route, 'Кабель не защищён от перегрузки', `In=${In}A · Iz=${Iz}A · Iрасч=${Imax}A`]);
    }
    if (c._breakerUndersize) {
      rows.push(['Ошибка', 'Кабель: In < Iрасч', label, route, 'Автомат сработает при штатной нагрузке', `In=${In}A · Iрасч=${Imax}A · Iz=${Iz}A`]);
    }
    if (c._cableOverflow) {
      rows.push(['Предупр.', 'Кабель: overflow', label, route, 'Сечение превышает максимум ряда', `Iрасч=${Imax}A`]);
    }
  }

  // MV overloads + source overloads + duplicates + orphans
  const tagMap = new Map();
  for (const n of S.nodes.values()) {
    if (n.type === 'zone' || n.type === 'channel') continue;
    const eff = _effectiveTag(n) || n.tag || '';
    if (n.isMv && n._mvIkOverload) {
      rows.push(['Ошибка', 'MV: Ik > It', eff, '—', 'I_k3 превышает термическую стойкость шин', `I_k3=${(n._Ik3_kA || 0).toFixed(2)}кА`]);
    }
    if (n.type === 'source' || n.type === 'generator') {
      const cap = Number(n.capacityKw) || 0;
      const load = Number(n._loadKw) || 0;
      if (cap > 0 && load > cap * 1.05) {
        rows.push(['Ошибка', 'Источник: overload', eff, '—', 'Нагрузка превышает номинал источника', `load=${load.toFixed(1)}кВт · cap=${cap.toFixed(1)}кВт (${((load / cap - 1) * 100).toFixed(1)}%)`]);
      }
    }
    if ((n.type === 'consumer' || (n.type === 'panel' && !n.parentSectionedId && !n.isSection))) {
      let hasInput = false;
      for (const c of S.conns.values()) if (c.to?.nodeId === n.id) { hasInput = true; break; }
      if (!hasInput) {
        rows.push(['Предупр.', 'Orphan', eff, '—', n.type === 'consumer' ? 'Потребитель не подключён к источнику' : 'Щит без входящей линии', n.type]);
      }
    }
    if (eff) {
      if (tagMap.has(eff)) {
        rows.push(['Ошибка', 'Дубликат', eff, '—', 'Два и более узлов с одинаковым обозначением', '']);
      } else tagMap.set(eff, n.id);
    }
  }

  // Non-selective pairs
  try {
    const sel = window.Raschet?.analyzeSelectivity?.();
    if (sel && Array.isArray(sel.pairs)) {
      for (const p of sel.pairs.filter(p => !p.check?.selective)) {
        const nodeTag = _effectiveTag(p.node) || p.node?.name || '?';
        const up = `${p.upBreaker?.inNominal || '?'}A ${p.upBreaker?.curve || ''}`;
        const down = `${p.downBreaker?.inNominal || '?'}A ${p.downBreaker?.curve || ''}`;
        rows.push(['Предупр.', 'Селективность' + (p.isMvCellPair ? ' (MV)' : ''), nodeTag, `↑${up} / ↓${down}`, p.check?.reason || '', '']);
      }
    }
  } catch {}

  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    return /[,"\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project-issues-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  flash('Экспортировано ' + (rows.length - 1) + ' строк в CSV', 'success');
}

// Phase 1.20.21: счётчик проблем для бейджа на кнопке сайдбара.
// Возвращает { errors, warns } без деталей — быстрый обход всех conns.
function _countProjectIssues() {
  const S = window.Raschet?._state;
  if (!S) return { errors: 0, warns: 0 };
  let err = 0, wrn = 0;
  for (const c of S.conns.values()) {
    if (!c._cableSize && !c._busbarNom) continue;
    if (c._utilityInfeed) continue;
    if (c._breakerAgainstCable) err++;
    if (c._breakerUndersize) err++;
    if (c._cableOverflow) wrn++;
  }
  const tagSet = new Set();
  for (const n of S.nodes.values()) {
    if (n.type === 'zone' || n.type === 'channel') continue;
    if (n.isMv && n._mvIkOverload) err++;
    // Source overload
    if (n.type === 'source' || n.type === 'generator') {
      const cap = Number(n.capacityKw) || 0;
      const load = Number(n._loadKw) || 0;
      if (cap > 0 && load > cap * 1.05) err++;
    }
    // Orphan
    if ((n.type === 'consumer' || (n.type === 'panel' && !n.parentSectionedId && !n.isSection))) {
      let hasInput = false;
      for (const c of S.conns.values()) if (c.to?.nodeId === n.id) { hasInput = true; break; }
      if (!hasInput) wrn++;
    }
    // Duplicate tag
    const eff = _effectiveTag(n) || n.tag || '';
    if (eff) {
      if (tagSet.has(eff)) err++;
      else tagSet.add(eff);
    }
  }
  // Селективность
  try {
    const sel = window.Raschet?.analyzeSelectivity?.();
    if (sel && Array.isArray(sel.pairs)) wrn += sel.pairs.filter(p => !p.check?.selective).length;
  } catch {}
  return { errors: err, warns: wrn };
}

// Phase 1.20.34: компактный статус-бар над холстом (всегда виден)
function _updateProjectStatusBar() {
  const bar = document.getElementById('project-statusbar');
  if (!bar) return;
  const S = window.Raschet?._state;
  if (!S) { bar.innerHTML = ''; return; }
  let consumers = 0, panels = 0, mvPanels = 0, sources = 0;
  let totalLoad = 0, totalCap = 0;
  for (const n of S.nodes.values()) {
    if (n.type === 'consumer') consumers++;
    else if (n.type === 'panel') { if (n.isMv) mvPanels++; else panels++; }
    else if (n.type === 'source' || n.type === 'generator') {
      sources++;
      totalCap += Number(n.capacityKw) || 0;
      totalLoad += Number(n._loadKw) || 0;
    }
  }
  let cables = 0;
  for (const c of S.conns.values()) {
    if ((c._cableSize || c._busbarNom) && !c._utilityInfeed) cables++;
  }
  const { errors, warns } = _countProjectIssues();
  const loadPct = totalCap > 0 ? (totalLoad / totalCap * 100) : 0;
  const loadColor = loadPct > 100 ? '#c62828' : loadPct > 90 ? '#e65100' : loadPct > 0 ? '#2e7d32' : '#999';

  const chip = (color, bg, content, title, onClick) => {
    const clickAttr = onClick ? ` style="pointer-events:auto;cursor:pointer" data-status-action="${onClick}"` : ' style="pointer-events:auto"';
    return `<div class="rs-status-chip"${clickAttr} title="${title}">
      <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:${bg};color:${color};border:1px solid ${color}33;border-radius:16px;font-size:11px;font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,0.08);backdrop-filter:blur(4px)">
        ${content}
      </span>
    </div>`;
  };
  const html = [];
  if (errors || warns) {
    const parts = [];
    if (errors) parts.push(`<span style="color:#c62828;font-weight:700">${errors}</span> ошибок`);
    if (warns) parts.push(`<span style="color:#e65100;font-weight:700">${warns}</span> предупр.`);
    html.push(chip(errors ? '#c62828' : '#e65100', 'rgba(255,255,255,0.95)', '⚠ ' + parts.join(' · '), 'Открыть «Проверки проекта» (Ctrl+Shift+I)', 'issues'));
  } else if (S.nodes.size > 0) {
    html.push(chip('#2e7d32', 'rgba(232,245,233,0.95)', '✓ OK', 'Проверки пройдены', 'issues'));
  }
  if (totalCap > 0) {
    html.push(chip(loadColor, 'rgba(255,255,255,0.95)',
      `⚡ ${totalLoad.toFixed(1)} / ${totalCap.toFixed(0)} кВт <span style="color:${loadColor};font-weight:600">${loadPct.toFixed(0)}%</span>`,
      'Общая нагрузка / номинал источников · открыть Dashboard (Ctrl+Shift+D)', 'dashboard'));
  }
  if (cables || panels || mvPanels || consumers) {
    const parts = [];
    if (panels) parts.push(`🗄 ${panels}`);
    if (mvPanels) parts.push(`⚡ ${mvPanels}`);
    if (cables) parts.push(`🔌 ${cables}`);
    if (consumers) parts.push(`💡 ${consumers}`);
    html.push(chip('#1565c0', 'rgba(255,255,255,0.95)', parts.join(' · '),
      `${panels} НКУ, ${mvPanels} РУ СН, ${cables} кабелей, ${consumers} потребителей (Ctrl+Shift+D)`, 'dashboard'));
  }
  bar.innerHTML = html.join('');
  bar.querySelectorAll('[data-status-action]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.dataset.statusAction;
      if (a === 'issues') openProjectIssuesModal();
      else if (a === 'dashboard') openDashboardModal();
    });
  });
}

function _updateProjectIssuesBadge() {
  const btn = document.getElementById('btn-open-project-issues');
  if (!btn) return;
  // Phase 1.20.33: inject pulse-animation CSS один раз (keyframes для
  // анимации бейджа когда есть ошибки)
  if (!document.getElementById('rs-issue-pulse-style')) {
    const st = document.createElement('style');
    st.id = 'rs-issue-pulse-style';
    st.textContent = `
      @keyframes rs-issue-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.5); }
        50% { box-shadow: 0 0 0 4px rgba(198, 40, 40, 0.0); }
      }
      .rs-issue-err-badge { animation: rs-issue-pulse 1.6s ease-in-out infinite; }
    `;
    document.head.appendChild(st);
  }
  const { errors, warns } = _countProjectIssues();
  // Формат: «⚠ Проверки проекта» [error-badge] [warn-badge]
  let html = '⚠ Проверки проекта';
  if (errors) html += ` <span class="rs-issue-err-badge" style="background:#c62828;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700;margin-left:4px;display:inline-block">${errors}</span>`;
  if (warns) html += ` <span style="background:#f57c00;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700;margin-left:2px">${warns}</span>`;
  btn.innerHTML = html;
  btn.title = errors || warns
    ? `Обнаружено: ${errors} ошибок, ${warns} предупреждений (Ctrl+Shift+I)`
    : 'Проверки проекта (проблем не найдено) (Ctrl+Shift+I)';
}

function renderProjectIssues() {
  const mount = document.getElementById('project-issues-mount');
  if (!mount) return;
  const S = window.Raschet?._state;
  if (!S) { mount.innerHTML = '<div class="muted">Состояние недоступно</div>'; return; }

  // 1. Собираем ошибки/предупреждения по линиям
  const cableErrors = [];   // {id, label, reason, details}
  const cableWarns = [];
  const utilityLines = [];  // информационно
  for (const c of S.conns.values()) {
    if (!c._cableSize && !c._busbarNom) continue;
    const fromN = S.nodes.get(c.from?.nodeId);
    const toN = S.nodes.get(c.to?.nodeId);
    const prefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const label = c.lineLabel || `${prefix}-${_ctNodeTag(fromN)}-${_ctNodeTag(toN)}`;
    const route = `${_ctNodeTag(fromN)} → ${_ctNodeTag(toN)}`;
    if (c._utilityInfeed) {
      utilityLines.push({ id: c.id, label, route });
      continue;
    }
    if (c._breakerAgainstCable) {
      // Phase 1.20.20: предложение авто-фикса: снизить In до ближайшего
      // меньшего номинала, который ≤ Iz (но ≥ Iрасч), ИЛИ снять manual-
      // override и довериться автоподбору.
      const In = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
      const Iz = Math.round(c._cableIz || 0) || 0;
      const Imax = Number(c._maxA) || 0;
      const series = _BREAKER_SERIES;
      let suggested = 0;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i] <= Iz && series[i] >= Imax) { suggested = series[i]; break; }
      }
      const fix = suggested
        ? { kind: 'setBreakerIn', value: suggested, label: `Установить In = ${suggested} А` }
        : (c.manualBreakerIn ? { kind: 'clearManualBreaker', label: 'Снять ручной номинал (автоподбор)' } : null);
      cableErrors.push({
        id: c.id, label, route,
        reason: 'In > Iz — кабель не защищён от перегрузки',
        details: `In = ${In} А, Iz = ${Iz} А, Iрасч = ${Math.round(Imax)} А`,
        fix,
      });
    }
    if (c._breakerUndersize) {
      const In = Number(c.manualBreakerIn) || Number(c._breakerIn) || 0;
      const Imax = Number(c._maxA) || 0;
      const Iz = Math.round(c._cableIz || 0) || 0;
      const series = _BREAKER_SERIES;
      let suggested = 0;
      for (const n of series) {
        if (n >= Imax && (!Iz || n <= Iz)) { suggested = n; break; }
      }
      const fix = suggested
        ? { kind: 'setBreakerIn', value: suggested, label: `Установить In = ${suggested} А` }
        : (c.manualBreakerIn ? { kind: 'clearManualBreaker', label: 'Снять ручной номинал (автоподбор)' } : null);
      cableErrors.push({
        id: c.id, label, route,
        reason: 'In < Iрасч — автомат сработает при штатной нагрузке',
        details: `In = ${In} А, Iрасч = ${Math.round(Imax)} А, Iz = ${Iz} А`,
        fix,
      });
    }
    if (c._cableOverflow) {
      cableWarns.push({
        id: c.id, label, route,
        reason: 'Сечение превышает максимум ряда',
        details: `Iрасч = ${Math.round(c._maxA || 0)} А — проверьте распараллеливание`,
      });
    }
  }

  // 2. Нарушения селективности
  let selPairs = [];
  try {
    const sel = window.Raschet?.analyzeSelectivity?.();
    if (sel && Array.isArray(sel.pairs)) {
      selPairs = sel.pairs.filter(p => !p.check?.selective);
    }
  } catch {}

  // 3. MV-щиты: перегрузка Ik vs It
  const mvOverloads = [];
  for (const n of S.nodes.values()) {
    if (n.isMv && n._mvIkOverload) {
      mvOverloads.push({
        id: n.id,
        name: _effectiveTag(n) || n.tag || n.name || '?',
        reason: 'I_k3 превышает термическую стойкость шин',
        details: `I_k3 = ${(n._Ik3_kA || 0).toFixed(2)} кА`,
      });
    }
  }

  // 4. Phase 1.20.22: orphan-узлы и перегрузка источников
  const orphans = [];
  const sourceOverloads = [];
  const tagMap = new Map(); // для поиска дубликатов
  const duplicateTags = [];
  for (const n of S.nodes.values()) {
    if (n.type === 'zone' || n.type === 'channel') continue;
    const eff = _effectiveTag(n) || n.tag || '';
    if (eff) {
      if (tagMap.has(eff)) duplicateTags.push({ id: n.id, tag: eff, otherId: tagMap.get(eff) });
      else tagMap.set(eff, n.id);
    }
    // Orphan check: consumer/panel без входящих connections
    if (n.type === 'consumer' || (n.type === 'panel' && !n.parentSectionedId)) {
      let hasInput = false;
      for (const c of S.conns.values()) {
        if (c.to?.nodeId === n.id) { hasInput = true; break; }
      }
      if (!hasInput && !n.isSection) {
        orphans.push({
          id: n.id,
          name: eff || n.name || '?',
          reason: n.type === 'consumer' ? 'Потребитель не подключён к источнику' : 'Щит без входящей линии',
          details: n.type + (n.demandKw ? ` · ${n.demandKw} кВт` : ''),
        });
      }
    }
    // Source overload check
    if (n.type === 'source' || n.type === 'generator') {
      const cap = Number(n.capacityKw) || 0;
      const load = Number(n._loadKw) || 0;
      if (cap > 0 && load > cap * 1.05) {
        sourceOverloads.push({
          id: n.id,
          name: eff || n.name || '?',
          reason: 'Нагрузка превышает номинал источника',
          details: `Нагрузка = ${load.toFixed(1)} кВт · Номинал = ${cap.toFixed(1)} кВт (${((load / cap - 1) * 100).toFixed(1)}% перегруз)`,
        });
      }
    }
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const totalErrors = cableErrors.length + mvOverloads.length + sourceOverloads.length + duplicateTags.length;
  const totalWarns = cableWarns.length + selPairs.length + orphans.length;

  // Phase 1.20.21: кнопка «Исправить всё» — применяет все автофиксы
  const fixableCount = cableErrors.filter(e => !!e.fix).length;

  const html = [];
  // Summary
  html.push(`
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="padding:10px 14px;background:${totalErrors ? '#ffebee' : '#e8f5e9'};border:1px solid ${totalErrors ? '#ef9a9a' : '#a5d6a7'};border-radius:6px;flex:1;min-width:180px">
        <div style="font-size:11px;color:#666">Ошибок</div>
        <div style="font-size:22px;font-weight:600;color:${totalErrors ? '#c62828' : '#2e7d32'}">${totalErrors}</div>
      </div>
      <div style="padding:10px 14px;background:${totalWarns ? '#fff8e1' : '#f5f5f5'};border:1px solid ${totalWarns ? '#ffcc80' : '#ddd'};border-radius:6px;flex:1;min-width:180px">
        <div style="font-size:11px;color:#666">Предупреждений</div>
        <div style="font-size:22px;font-weight:600;color:${totalWarns ? '#e65100' : '#777'}">${totalWarns}</div>
      </div>
      <div style="padding:10px 14px;background:#eef5ff;border:1px solid #bbdefb;border-radius:6px;flex:1;min-width:180px">
        <div style="font-size:11px;color:#666">Utility-линий (информ.)</div>
        <div style="font-size:22px;font-weight:600;color:#1565c0">${utilityLines.length}</div>
      </div>
      ${fixableCount > 0 ? `
      <div style="padding:10px 14px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;display:flex;flex-direction:column;justify-content:center;gap:4px">
        <div style="font-size:11px;color:#666">Автоисправлений</div>
        <button type="button" id="pi-fix-all" style="padding:6px 12px;background:#2e7d32;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600" title="Применить все рекомендованные фиксы">✓ Исправить всё (${fixableCount})</button>
      </div>
      ` : ''}
    </div>
  `);

  const renderLineList = (items, color, borderColor) => {
    if (!items.length) return '';
    return items.map(it => {
      const fixBtn = it.fix
        ? `<button type="button" class="pi-fix" data-conn-id="${esc(it.id)}" data-fix-kind="${esc(it.fix.kind)}" data-fix-value="${esc(it.fix.value ?? '')}" title="${esc(it.fix.label)}" style="flex:0 0 auto;padding:3px 10px;border:1px solid #4caf50;background:#fff;color:#2e7d32;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600">✓ Исправить</button>`
        : '';
      return `
      <div class="pi-row" data-kind="conn" data-id="${esc(it.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #eaecef;cursor:pointer;background:#fff" title="Клик — перейти к линии">
        <span style="flex:0 0 200px;font-weight:600;color:${color}">${esc(it.label)}</span>
        <span style="flex:0 0 220px;font-size:11px;color:#555">${esc(it.route)}</span>
        <span style="flex:1;font-size:11px;color:${color}">${esc(it.reason)}</span>
        <span style="flex:0 0 200px;font-size:11px;color:#666;font-family:monospace">${esc(it.details || '')}</span>
        ${fixBtn}
      </div>
    `;
    }).join('');
  };

  const renderNodeList = (items, color) => {
    if (!items.length) return '';
    return items.map(it => `
      <div class="pi-row" data-kind="node" data-id="${esc(it.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #eaecef;cursor:pointer" title="Клик — перейти к узлу">
        <span style="flex:0 0 220px;font-weight:600;color:${color}">${esc(it.name)}</span>
        <span style="flex:1;font-size:11px;color:${color}">${esc(it.reason)}</span>
        <span style="flex:0 0 200px;font-size:11px;color:#666;font-family:monospace">${esc(it.details || '')}</span>
      </div>
    `).join('');
  };

  const section = (title, emoji, count, bodyHtml) => `
    <h3 style="margin:16px 0 4px;font-size:13px;color:#24292e">${emoji} ${esc(title)} <span class="muted" style="font-weight:400">(${count})</span></h3>
    <div style="border:1px solid #e1e4e8;border-radius:4px;overflow:hidden">${bodyHtml || '<div class="muted" style="padding:10px 14px;font-size:11px">—</div>'}</div>
  `;

  html.push(section('Ошибки кабелей (координация защиты)', '✗', cableErrors.length, renderLineList(cableErrors, '#c62828')));
  if (mvOverloads.length) {
    html.push(section('Ошибки MV-щитов', '⚡', mvOverloads.length, renderNodeList(mvOverloads, '#c62828')));
  }
  if (sourceOverloads.length) {
    html.push(section('Перегрузка источников питания', '⚡', sourceOverloads.length, renderNodeList(sourceOverloads, '#c62828')));
  }
  if (duplicateTags.length) {
    const dupHtml = duplicateTags.map(d => `
      <div class="pi-row" data-kind="node" data-id="${esc(d.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #eaecef;cursor:pointer" title="Клик — перейти к узлу">
        <span style="flex:0 0 220px;font-weight:600;color:#c62828">${esc(d.tag)}</span>
        <span style="flex:1;font-size:11px;color:#c62828">Дубликат обозначения — одно и то же имя у двух и более узлов</span>
      </div>`).join('');
    html.push(section('Дубликаты обозначений', '🔁', duplicateTags.length, dupHtml));
  }
  html.push(section('Предупреждения кабелей', '⚠', cableWarns.length, renderLineList(cableWarns, '#e65100')));
  if (orphans.length) {
    html.push(section('Несвязанные узлы (нет входящего питания)', '🔌', orphans.length, renderNodeList(orphans, '#e65100')));
  }

  // Non-selective pairs
  if (selPairs.length) {
    html.push(`<h3 style="margin:16px 0 4px;font-size:13px;color:#24292e">🔶 Нарушения селективности <span class="muted" style="font-weight:400">(${selPairs.length})</span></h3>`);
    const rows = selPairs.map((p, idx) => {
      const nodeTag = _effectiveTag(p.node) || p.node?.name || '?';
      const up = `${p.upBreaker?.inNominal || '?'} А ${p.upBreaker?.curve || ''}`;
      const down = `${p.downBreaker?.inNominal || '?'} А ${p.downBreaker?.curve || ''}`;
      const nodeId = p.node?.id;
      // Phase 1.20.28: автофикс амплитудной селективности — поднять In_up.
      // Применимо только для LV-пар с заданным upstream conn.
      let fixBtn = '';
      if (!p.isMvCellPair && p.upstream?.id && !p.check?.selective) {
        const upIn = Number(p.upBreaker?.inNominal) || 0;
        const downIn = Number(p.downBreaker?.inNominal) || 0;
        const curve = p.downBreaker?.curve;
        const k = curve === 'B' ? 2.0 : (curve === 'C' ? 1.6 : 1.4);
        const target = downIn * k;
        const series = _BREAKER_SERIES;
        let suggested = 0;
        for (const n of series) { if (n >= target && n > upIn) { suggested = n; break; } }
        if (suggested) {
          fixBtn = `<button type="button" class="pi-sel-fix" data-conn-id="${esc(p.upstream.id)}" data-value="${suggested}" title="Поднять номинал upstream до ${suggested} А" style="flex:0 0 auto;padding:3px 10px;border:1px solid #4caf50;background:#fff;color:#2e7d32;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600">✓ In_up = ${suggested} А</button>`;
        }
      }
      return `
        <div class="pi-row" data-kind="node" data-id="${esc(nodeId || '')}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #eaecef;cursor:pointer" title="Клик — перейти к узлу">
          <span style="flex:0 0 220px;font-weight:600;color:#e65100">${esc(nodeTag)}${p.isMvCellPair ? ' (MV)' : ''}</span>
          <span style="flex:0 0 160px;font-size:11px">↑ ${esc(up)}</span>
          <span style="flex:0 0 160px;font-size:11px">↓ ${esc(down)}</span>
          <span style="flex:1;font-size:11px;color:#666">${esc(p.check?.reason || '')}</span>
          ${fixBtn}
        </div>
      `;
    }).join('');
    html.push(`<div style="border:1px solid #e1e4e8;border-radius:4px;overflow:hidden">${rows}</div>`);
  }

  if (utilityLines.length) {
    html.push(`<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:#1565c0">🏙 Utility-линии (информационно, ${utilityLines.length}) — не проверяются</summary>`);
    html.push(`<div style="border:1px solid #e1e4e8;border-radius:4px;overflow:hidden;margin-top:4px">${renderLineList(utilityLines.map(l => ({ ...l, reason: 'Ввод от городской сети — ТУ поставщика', details: '' })), '#1565c0')}</div>`);
    html.push('</details>');
  }

  if (!totalErrors && !totalWarns) {
    html.push('<div style="padding:20px;text-align:center;color:#2e7d32;font-size:14px;background:#e8f5e9;border-radius:6px;margin-top:10px">✓ Проблем не обнаружено. Проект проходит все проверки.</div>');
  }

  mount.innerHTML = html.join('');

  // Phase 1.20.21: «Исправить всё» — применяет все автофиксы одним snapshot'ом
  const fixAllBtn = mount.querySelector('#pi-fix-all');
  if (fixAllBtn) {
    fixAllBtn.addEventListener('click', () => {
      if (!confirm(`Применить ${fixableCount} автофиксов? Действие обратимо через Ctrl+Z.`)) return;
      if (typeof window.Raschet?.snapshot === 'function') window.Raschet.snapshot('issues:fix-all:' + fixableCount);
      let applied = 0;
      for (const it of cableErrors) {
        if (!it.fix) continue;
        const c = window.Raschet?._state?.conns?.get(it.id);
        if (!c) continue;
        if (it.fix.kind === 'setBreakerIn') c.manualBreakerIn = Number(it.fix.value);
        else if (it.fix.kind === 'clearManualBreaker') delete c.manualBreakerIn;
        applied++;
      }
      if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
      flash(`Применено автофиксов: ${applied}`);
      renderProjectIssues();
    });
  }

  // Phase 1.20.28: «✓ In_up = N А» — поднять номинал upstream для
  // нарушенной амплитудной селективности
  mount.querySelectorAll('.pi-sel-fix').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const connId = btn.dataset.connId;
      const value = Number(btn.dataset.value);
      const c = window.Raschet?._state?.conns?.get(connId);
      if (!c || !value) return;
      if (typeof window.Raschet?.snapshot === 'function') window.Raschet.snapshot('issues:sel-fix:' + connId);
      c.manualBreakerIn = value;
      if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
      flash(`Поднят upstream до ${value} А`);
      renderProjectIssues();
    });
  });

  // Phase 1.20.20: кнопки «✓ Исправить» применяют рекомендованный фикс
  mount.querySelectorAll('.pi-fix').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const connId = btn.dataset.connId;
      const kind = btn.dataset.fixKind;
      const value = btn.dataset.fixValue;
      const c = window.Raschet?._state?.conns?.get(connId);
      if (!c) return;
      if (typeof window.Raschet?.snapshot === 'function') window.Raschet.snapshot('issues:fix:' + kind);
      if (kind === 'setBreakerIn') {
        c.manualBreakerIn = Number(value);
      } else if (kind === 'clearManualBreaker') {
        delete c.manualBreakerIn;
      }
      if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
      flash('Исправлено — проверки перерасчитаны');
      renderProjectIssues();
    });
  });

  // Click handlers для навигации
  mount.querySelectorAll('.pi-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.background = '#eef5ff');
    row.addEventListener('mouseleave', () => row.style.background = '');
    row.addEventListener('click', (e) => {
      // Клик по кнопке-фиксу не должен триггерить jump
      if (e.target.closest('.pi-fix')) return;
      const kind = row.dataset.kind;
      const id = row.dataset.id;
      if (!id) return;
      if (kind === 'conn' && typeof window.Raschet?.selectConnAndFocus === 'function') {
        window.Raschet.selectConnAndFocus(id);
      } else if (kind === 'node' && window.Raschet?._state) {
        window.Raschet._state.selectedKind = 'node';
        window.Raschet._state.selectedId = id;
        if (typeof window.Raschet.rerender === 'function') window.Raschet.rerender();
      }
      closeModal('modal-project-issues');
    });
  });
}

// ================= Поиск / Ctrl+F (Phase 1.20.16) =================
// Command-palette для быстрого перехода к узлу или линии.
// Горячая клавиша: Ctrl+F.
let _searchPaletteEl = null;

function openSearchPalette() {
  if (_searchPaletteEl) {
    const inp = _searchPaletteEl.querySelector('input');
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9996;display:flex;align-items:flex-start;justify-content:center;padding-top:80px';
  backdrop.innerHTML = `
    <div style="background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.3);width:min(620px,92vw);overflow:hidden;font-family:system-ui,sans-serif">
      <div style="padding:8px 12px;border-bottom:1px solid #e1e4e8;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">🔍</span>
        <input type="text" id="sp-input" placeholder="Найти узел или линию (по обозначению, имени, кабельной марке)…" style="flex:1;padding:6px 10px;font-size:13px;border:1px solid #d0d7de;border-radius:4px" autocomplete="off">
        <span class="muted" style="font-size:10px">Esc — закрыть</span>
      </div>
      <div id="sp-results" style="max-height:min(50vh,400px);overflow-y:auto"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  _searchPaletteEl = backdrop;

  const input = backdrop.querySelector('#sp-input');
  const list = backdrop.querySelector('#sp-results');
  const close = () => { if (_searchPaletteEl) { document.body.removeChild(_searchPaletteEl); _searchPaletteEl = null; } };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  let selectedIdx = 0;
  let currentHits = [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const render = () => {
    const q = (input.value || '').trim().toLowerCase();
    if (!q) {
      list.innerHTML = '<div class="muted" style="padding:16px;text-align:center;font-size:12px">Начните вводить для поиска по обозначению, имени, марке кабеля…</div>';
      currentHits = [];
      return;
    }
    const S = window.Raschet?._state;
    if (!S) { list.innerHTML = '<div class="muted" style="padding:16px">Состояние недоступно</div>'; return; }
    const hits = [];

    // Nodes
    for (const n of S.nodes.values()) {
      if (n.type === 'zone' || n.type === 'channel') continue;
      let effTag = '';
      try { effTag = _effectiveTag(n) || ''; } catch {}
      const hay = [effTag, n.tag, n.name, n.type].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          kind: 'node',
          id: n.id,
          tag: effTag || n.tag || '',
          name: n.name || '',
          type: n.type,
          icon: _spNodeIcon(n),
        });
      }
      if (hits.length > 80) break;
    }
    // Connections
    for (const c of S.conns.values()) {
      const fromN = S.nodes.get(c.from?.nodeId);
      const toN = S.nodes.get(c.to?.nodeId);
      const fromTag = fromN ? (_effectiveTag(fromN) || fromN.tag || fromN.name || '') : '';
      const toTag = toN ? (_effectiveTag(toN) || toN.tag || toN.name || '') : '';
      const prefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
      const label = c.lineLabel || `${prefix}-${fromTag}-${toTag}`;
      const mark = c.cableMark || '';
      const hay = [label, fromTag, toTag, mark].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          kind: 'conn',
          id: c.id,
          tag: label,
          name: `${fromTag} → ${toTag}`,
          type: 'line',
          icon: '🔌',
        });
      }
      if (hits.length > 120) break;
    }
    currentHits = hits.slice(0, 60);
    if (!currentHits.length) {
      list.innerHTML = '<div class="muted" style="padding:16px;text-align:center;font-size:12px">Ничего не найдено</div>';
      return;
    }
    selectedIdx = Math.min(selectedIdx, currentHits.length - 1);
    list.innerHTML = currentHits.map((h, i) => `
      <div class="sp-row" data-idx="${i}" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;${i === selectedIdx ? 'background:#eef5ff;' : ''}border-bottom:1px solid #f0f3f6">
        <span style="font-size:16px;width:22px;text-align:center">${esc(h.icon)}</span>
        <span style="flex:1;font-size:12px">
          <b>${esc(h.tag)}</b>${h.name ? ` · <span class="muted">${esc(h.name)}</span>` : ''}
        </span>
        <span class="muted" style="font-size:10px;color:#888">${esc(h.type)}</span>
      </div>
    `).join('');
    list.querySelectorAll('.sp-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        activate(currentHits[idx]);
      });
      row.addEventListener('mousemove', () => {
        const idx = Number(row.dataset.idx);
        if (idx !== selectedIdx) {
          selectedIdx = idx;
          list.querySelectorAll('.sp-row').forEach(r => r.style.background = '');
          row.style.background = '#eef5ff';
        }
      });
    });
  };

  const activate = (h) => {
    if (!h) return;
    if (h.kind === 'node') {
      if (window.Raschet?._state) {
        window.Raschet._state.selectedKind = 'node';
        window.Raschet._state.selectedId = h.id;
        if (typeof window.Raschet.rerender === 'function') window.Raschet.rerender();
      }
    } else if (h.kind === 'conn') {
      if (typeof window.Raschet?.selectConnAndFocus === 'function') {
        window.Raschet.selectConnAndFocus(h.id);
      }
    }
    close();
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentHits[selectedIdx]) activate(currentHits[selectedIdx]);
      return;
    }
    if (e.key === 'ArrowDown' && currentHits.length) {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % currentHits.length;
      render();
      const sel = list.querySelector(`.sp-row[data-idx="${selectedIdx}"]`);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp' && currentHits.length) {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + currentHits.length) % currentHits.length;
      render();
      const sel = list.querySelector(`.sp-row[data-idx="${selectedIdx}"]`);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
  });
  setTimeout(() => { input.focus(); render(); }, 10);
}

function _spNodeIcon(n) {
  if (n.type === 'source') return n.sourceSubtype === 'utility' ? '🏙' : '⚡';
  if (n.type === 'generator') return '🔋';
  if (n.type === 'panel') return n.isMv ? '⚡' : '🗄';
  if (n.type === 'ups') return '🔌';
  if (n.type === 'consumer') return '💡';
  if (n.type === 'transformer' || n.sourceSubtype === 'transformer') return '🔄';
  return '▫';
}

// Phase 1.20.16 + 1.20.32: глобальные hotkeys для быстрого доступа к модалкам.
// Ctrl+F — поиск (палетка)
// Ctrl+Shift+D — 📊 Сводка проекта / Dashboard
// Ctrl+Shift+I — ⚠ Проверки проекта / Issues
// Ctrl+Shift+L — 🔌 Таблица кабелей (Lines)
// Ctrl+Shift+U — 💡 Таблица потребителей (Users/Consumers)
// Ctrl+Shift+E — 🗄 Таблица оборудования (Equipment)
document.addEventListener('keydown', (e) => {
  const tgt = e.target;
  const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
  // Ctrl+F — поиск; в полях разрешаем нативный браузерный поиск
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
    if (inField && !_searchPaletteEl) return;
    e.preventDefault();
    openSearchPalette();
    return;
  }
  // Ctrl+Shift+<key> — модалки. Внутри полей ввода не перехватываем.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
    if (inField) return;
    const key = e.key.toLowerCase();
    if (key === 'd') { e.preventDefault(); openDashboardModal(); return; }
    if (key === 'i') { e.preventDefault(); openProjectIssuesModal(); return; }
    if (key === 'l') { e.preventDefault(); openCableTableModal(); return; }
    if (key === 'u') { e.preventDefault(); openConsumersTableModal(); return; }
    if (key === 'e') { e.preventDefault(); openEquipmentTableModal(); return; }
  }
});

// ================= Таблица потребителей (Phase 1.20.14) =================
let _consumersTableFilters = { search: '', phase: '', category: '', parent: '' };
let _consumersTableSelected = new Set();
let _consumersTableSort = { col: 'tag', dir: 'asc' };

function openConsumersTableModal() {
  openModal('modal-consumers-table');
  renderConsumersTable();
  const srchEl = document.getElementById('consumers-table-search');
  if (srchEl) {
    srchEl.value = _consumersTableFilters.search;
    srchEl.oninput = (e) => { _consumersTableFilters.search = e.target.value; renderConsumersTable(); };
  }
  const phEl = document.getElementById('consumers-table-filter-phase');
  if (phEl) {
    phEl.value = _consumersTableFilters.phase;
    phEl.onchange = (e) => { _consumersTableFilters.phase = e.target.value; renderConsumersTable(); };
  }
  const csvBtn = document.getElementById('consumers-table-export-csv');
  if (csvBtn) csvBtn.onclick = exportConsumersTableCsv;
}

function renderConsumersTable() {
  const mount = document.getElementById('consumers-table-mount');
  if (!mount) return;
  const S = window.Raschet?._state;
  if (!S) { mount.innerHTML = '<div class="muted">Состояние недоступно</div>'; return; }

  const consumers = [...S.nodes.values()].filter(n => n.type === 'consumer');

  let catalog = [];
  try { catalog = window.Raschet?.getConsumerCatalog?.() || []; } catch {}
  const catalogById = new Map(catalog.map(c => [c.id, c]));

  const distinctCats = new Set();
  for (const n of consumers) {
    const cat = catalogById.get(n.consumerCatalogId)?.category || 'other';
    distinctCats.add(cat);
  }
  const CAT_LABELS = {
    lighting: 'Освещение', socket: 'Розеточные', power: 'Силовая',
    hvac: 'Климат/HVAC', it: 'IT/Серверы', lowvoltage: 'Слаботочные',
    process: 'Технологическая', other: 'Прочее',
  };

  // Phase 1.20.24: parent-panel map + distinct-значения для фильтра
  const parentPanelById0 = new Map();
  const distinctParents = new Set();
  for (const n of consumers) {
    let parent = null;
    for (const c of S.conns.values()) {
      if (c.to?.nodeId === n.id) {
        const from = S.nodes.get(c.from?.nodeId);
        if (from && (from.type === 'panel' || from.type === 'ups')) { parent = from; break; }
      }
    }
    parentPanelById0.set(n.id, parent);
    if (parent) distinctParents.add(_effectiveTag(parent) || parent.tag || parent.name || '?');
  }

  const F = _consumersTableFilters;
  const q = (F.search || '').toLowerCase();
  const filtered = consumers.filter(n => {
    if (F.phase && (n.phase || '3ph') !== F.phase) return false;
    if (F.category) {
      const cat = catalogById.get(n.consumerCatalogId)?.category || 'other';
      if (cat !== F.category) return false;
    }
    if (F.parent) {
      const p = parentPanelById0.get(n.id);
      const pTag = p ? (_effectiveTag(p) || p.tag || p.name || '') : '';
      if (pTag !== F.parent) return false;
    }
    if (q) {
      const catLabel = catalogById.get(n.consumerCatalogId)?.label || '';
      const pTag = parentPanelById0.get(n.id)
        ? (_effectiveTag(parentPanelById0.get(n.id)) || '')
        : '';
      const hay = [n.tag, n.name, catLabel, n.phase, pTag].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  for (const id of [..._consumersTableSelected]) {
    if (!filtered.find(n => n.id === id)) _consumersTableSelected.delete(id);
  }

  const parentPanelById = parentPanelById0; // alias для нижних обращений
  const sortDir = _consumersTableSort.dir === 'desc' ? -1 : 1;
  const sortKey = (n) => {
    switch (_consumersTableSort.col) {
      case 'tag': return (n.tag || n.name || '').toLowerCase();
      case 'name': return (n.name || '').toLowerCase();
      case 'category': return (catalogById.get(n.consumerCatalogId)?.label || '').toLowerCase();
      case 'parent': {
        const p = parentPanelById.get(n.id);
        return p ? (_effectiveTag(p) || p.tag || p.name || '').toLowerCase() : '~';
      }
      case 'demand': return Number(n.demandKw) || 0;
      case 'count': return Number(n.count) || 1;
      case 'cosPhi': return Number(n.cosPhi) || 0;
      case 'kUse': return Number(n.kUse) || 0;
      case 'phase': return n.phase || '';
      default: return '';
    }
  };
  filtered.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka < kb) return -1 * sortDir;
    if (ka > kb) return 1 * sortDir;
    return 0;
  });

  const countEl = document.getElementById('consumers-table-count');
  if (countEl) countEl.textContent = `${filtered.length} из ${consumers.length}`;

  const selCount = _consumersTableSelected.size;
  const bulkDisabled = selCount === 0;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // Phase 1.20.31: видимость столбцов consumer table
  const vis = _consumersTableVisibility;
  const show = (col) => vis[col] !== false;
  const ifShow = (col, html) => show(col) ? html : '';

  const sortHdr = (col, label, align) => {
    const active = _consumersTableSort.col === col;
    const arrow = active ? (_consumersTableSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
    const color = active ? 'color:#1976d2;' : '';
    return `<th class="ctc-sort" data-sort-col="${col}" style="padding:6px 8px;text-align:${align};border-bottom:2px solid #d0d7de;cursor:pointer;user-select:none;${color}">${label}${arrow}</th>`;
  };

  const html = [`
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;margin-bottom:8px;font-size:12px;flex-wrap:wrap">
      <b>Выделено: ${selCount}</b>
      <button type="button" id="ctc-bulk-demand" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">P (кВт)</button>
      <button type="button" id="ctc-bulk-cosPhi" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">cos φ</button>
      <button type="button" id="ctc-bulk-kUse" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">K<sub>и</sub></button>
      <button type="button" id="ctc-bulk-phase" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Фаза</button>
      <span style="flex:1"></span>
      <button type="button" id="ctc-col-menu" title="Настроить видимость столбцов" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px">⚙ Столбцы</button>
      <button type="button" id="ctc-clear-filters" style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px">Сбросить фильтры</button>
      <button type="button" id="ctc-clear-sel" ${bulkDisabled ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #999;background:#fff;color:#555;border-radius:3px;cursor:pointer;font-size:11px;${bulkDisabled ? 'opacity:0.5;cursor:not-allowed' : ''}">Снять выделение</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f6f8fa;position:sticky;top:0;z-index:2">
          <th style="padding:6px 4px;border-bottom:2px solid #d0d7de;width:28px;text-align:center">
            <input type="checkbox" id="ctc-select-all" ${filtered.length && filtered.every(n => _consumersTableSelected.has(n.id)) ? 'checked' : ''} title="Выделить все">
          </th>
          ${ifShow('tag', sortHdr('tag', 'Обозн.', 'left'))}
          ${ifShow('name', sortHdr('name', 'Имя', 'left'))}
          ${ifShow('parent', sortHdr('parent', 'Питающий щит', 'left'))}
          ${ifShow('category', sortHdr('category', 'Категория', 'left'))}
          ${ifShow('demand', sortHdr('demand', 'P, кВт', 'right'))}
          ${ifShow('count', sortHdr('count', 'Шт.', 'right'))}
          ${ifShow('cosPhi', sortHdr('cosPhi', 'cos φ', 'right'))}
          ${ifShow('kUse', sortHdr('kUse', 'Kи', 'right'))}
          ${ifShow('phase', sortHdr('phase', 'Фаза', 'center'))}
        </tr>
        <tr style="background:#fafbfc;position:sticky;top:28px;z-index:1">
          <th></th>
          ${ifShow('tag', '<th style="padding:3px 6px;border-bottom:1px solid #d0d7de"></th>')}
          ${ifShow('name', '<th style="padding:3px 6px;border-bottom:1px solid #d0d7de"><span class="muted" style="font-size:10px">Поиск — в поле сверху</span></th>')}
          ${ifShow('parent', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ctc-flt" data-flt="parent" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все щиты —</option>${[...distinctParents].sort().map(v => `<option value="${esc(v)}" ${F.parent === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`)}
          ${ifShow('category', `<th style="padding:3px 4px;border-bottom:1px solid #d0d7de"><select class="ctc-flt" data-flt="category" style="width:100%;padding:2px 4px;font-size:11px;border:1px solid #d0d7de;border-radius:2px"><option value="">— все —</option>${[...distinctCats].sort().map(v => `<option value="${esc(v)}" ${F.category === v ? 'selected' : ''}>${esc(CAT_LABELS[v] || v)}</option>`).join('')}</select></th>`)}
          ${ifShow('demand', '<th></th>')}
          ${ifShow('count', '<th></th>')}
          ${ifShow('cosPhi', '<th></th>')}
          ${ifShow('kUse', '<th></th>')}
          ${ifShow('phase', '<th></th>')}
        </tr>
      </thead>
      <tbody>`];

  for (const n of filtered) {
    const cat = catalogById.get(n.consumerCatalogId);
    const catLabel = cat?.label || '—';
    const catCat = cat?.category || 'other';
    const checked = _consumersTableSelected.has(n.id);
    const rowBg = checked ? 'background:#eef5ff;' : '';
    const phase = n.phase || '3ph';
    html.push(`
      <tr data-id="${esc(n.id)}" style="border-bottom:1px solid #eaecef;${rowBg}">
        <td style="padding:5px 4px;text-align:center">
          <input type="checkbox" class="ctc-row-sel" data-id="${esc(n.id)}" ${checked ? 'checked' : ''}>
        </td>
        ${ifShow('tag', `<td style="padding:5px 8px;font-weight:600"><a href="#" class="ctc-jump" data-id="${esc(n.id)}" title="Перейти к потребителю на схеме" style="color:#1976d2;text-decoration:none">${esc(n.tag || '?')} <span style="font-size:10px;opacity:0.7">↗</span></a></td>`)}
        ${ifShow('name', `<td style="padding:5px 8px"><input class="ctc-name" data-id="${esc(n.id)}" type="text" value="${esc(n.name || '')}" style="width:140px;padding:3px 6px;font-size:11px"></td>`)}
        ${ifShow('parent', `<td style="padding:5px 8px;font-size:11px">${(() => {
          const p = parentPanelById.get(n.id);
          if (!p) return '<span class="muted" style="color:#c62828;font-size:10px" title="Нет входящего питания">— orphan —</span>';
          const pt = _effectiveTag(p) || p.tag || p.name || '?';
          return `<a href="#" class="ctc-parent-jump" data-parent-id="${esc(p.id)}" style="color:#1976d2;text-decoration:none">${esc(pt)}</a>`;
        })()}</td>`)}
        ${ifShow('category', `<td style="padding:5px 8px;font-size:11px"><div>${esc(catLabel)}</div><div class="muted" style="font-size:10px">${esc(CAT_LABELS[catCat] || catCat)}</div></td>`)}
        ${ifShow('demand', `<td style="padding:5px 8px;text-align:right"><input class="ctc-demand" data-id="${esc(n.id)}" type="number" min="0" step="0.1" value="${Number(n.demandKw) || 0}" style="width:72px;padding:3px 6px;text-align:right"></td>`)}
        ${ifShow('count', `<td style="padding:5px 8px;text-align:right"><input class="ctc-count" data-id="${esc(n.id)}" type="number" min="1" step="1" value="${Number(n.count) || 1}" style="width:52px;padding:3px 6px;text-align:right"></td>`)}
        ${ifShow('cosPhi', `<td style="padding:5px 8px;text-align:right"><input class="ctc-cosPhi" data-id="${esc(n.id)}" type="number" min="0.1" max="1" step="0.01" value="${Number(n.cosPhi) || 0.92}" style="width:56px;padding:3px 6px;text-align:right"></td>`)}
        ${ifShow('kUse', `<td style="padding:5px 8px;text-align:right"><input class="ctc-kUse" data-id="${esc(n.id)}" type="number" min="0" max="1.5" step="0.05" value="${Number(n.kUse) || 1}" style="width:56px;padding:3px 6px;text-align:right"></td>`)}
        ${ifShow('phase', `<td style="padding:5px 8px;text-align:center;font-size:11px"><select class="ctc-phase" data-id="${esc(n.id)}" style="padding:3px 4px;font-size:11px"><option value="1ph"${phase === '1ph' ? ' selected' : ''}>1ф</option><option value="3ph"${phase === '3ph' ? ' selected' : ''}>3ф</option><option value="dc"${phase === 'dc' ? ' selected' : ''}>DC</option></select></td>`)}
      </tr>`);
  }
  const visibleCount = 1 + _CONSUMERS_TABLE_COLUMNS.filter(c => c.id !== 'checkbox' && show(c.id)).length;
  if (!filtered.length) {
    html.push(`<tr><td colspan="${visibleCount}" style="padding:20px;text-align:center;color:#999">Нет потребителей по текущим фильтрам</td></tr>`);
  }
  html.push('</tbody></table>');
  mount.innerHTML = html.join('');

  const apply = (id, fn) => {
    if (!window.Raschet?._state?.nodes) return;
    const node = window.Raschet._state.nodes.get(id);
    if (!node) return;
    fn(node);
    if (typeof window.Raschet.notifyChange === 'function') window.Raschet.notifyChange();
  };
  const applyAndRerender = () => {
    if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
    renderConsumersTable();
  };
  const snap = (tag) => { if (typeof window.Raschet?.snapshot === 'function') window.Raschet.snapshot(tag); };
  const bindNum = (cls, prop) => {
    mount.querySelectorAll('.' + cls).forEach(inp => {
      inp.addEventListener('change', () => {
        snap('consumers-table:' + prop + ':' + inp.dataset.id);
        apply(inp.dataset.id, (n) => { n[prop] = Math.max(0, Number(inp.value) || 0); });
        applyAndRerender();
      });
    });
  };
  bindNum('ctc-demand', 'demandKw');
  bindNum('ctc-count', 'count');
  bindNum('ctc-cosPhi', 'cosPhi');
  bindNum('ctc-kUse', 'kUse');
  mount.querySelectorAll('.ctc-name').forEach(inp => {
    inp.addEventListener('change', () => {
      snap('consumers-table:name:' + inp.dataset.id);
      apply(inp.dataset.id, (n) => { n.name = inp.value || ''; });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ctc-phase').forEach(sel => {
    sel.addEventListener('change', () => {
      snap('consumers-table:phase:' + sel.dataset.id);
      apply(sel.dataset.id, (n) => { n.phase = sel.value; });
      applyAndRerender();
    });
  });
  mount.querySelectorAll('.ctc-sort').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      if (_consumersTableSort.col === col) {
        _consumersTableSort.dir = _consumersTableSort.dir === 'asc' ? 'desc' : 'asc';
      } else { _consumersTableSort.col = col; _consumersTableSort.dir = 'asc'; }
      renderConsumersTable();
    });
  });
  mount.querySelectorAll('.ctc-flt').forEach(inp => {
    inp.addEventListener('change', () => {
      _consumersTableFilters[inp.dataset.flt] = inp.value;
      renderConsumersTable();
    });
  });
  mount.querySelectorAll('.ctc-row-sel').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) _consumersTableSelected.add(cb.dataset.id);
      else _consumersTableSelected.delete(cb.dataset.id);
      renderConsumersTable();
    });
  });
  const selAll = mount.querySelector('#ctc-select-all');
  if (selAll) selAll.addEventListener('change', () => {
    if (selAll.checked) for (const n of filtered) _consumersTableSelected.add(n.id);
    else for (const n of filtered) _consumersTableSelected.delete(n.id);
    renderConsumersTable();
  });
  mount.querySelectorAll('.ctc-jump').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.id;
      if (window.Raschet?._state) {
        window.Raschet._state.selectedKind = 'node';
        window.Raschet._state.selectedId = id;
        if (typeof window.Raschet.rerender === 'function') window.Raschet.rerender();
      }
      closeModal('modal-consumers-table');
    });
  });
  // Phase 1.20.24: клик по родительскому щиту тоже переходит к нему
  mount.querySelectorAll('.ctc-parent-jump').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = a.dataset.parentId;
      if (window.Raschet?._state) {
        window.Raschet._state.selectedKind = 'node';
        window.Raschet._state.selectedId = id;
        if (typeof window.Raschet.rerender === 'function') window.Raschet.rerender();
      }
      closeModal('modal-consumers-table');
    });
  });
  // Phase 1.20.31: меню столбцов для таблицы потребителей
  const colBtn = mount.querySelector('#ctc-col-menu');
  if (colBtn) colBtn.addEventListener('click', () => {
    _openColumnMenu(colBtn, 'consumers', _CONSUMERS_TABLE_COLUMNS, _consumersTableVisibility, (v) => {
      _consumersTableVisibility = v;
      renderConsumersTable();
    });
  });
  const clearBtn = mount.querySelector('#ctc-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    _consumersTableFilters = { search: '', phase: '', category: '', parent: '' };
    const s = document.getElementById('consumers-table-search'); if (s) s.value = '';
    const p = document.getElementById('consumers-table-filter-phase'); if (p) p.value = '';
    renderConsumersTable();
  });
  const clearSelBtn = mount.querySelector('#ctc-clear-sel');
  if (clearSelBtn) clearSelBtn.addEventListener('click', () => {
    _consumersTableSelected.clear();
    renderConsumersTable();
  });

  // Phase 1.20.17: snapshot один раз на всю bulk-операцию для Ctrl+Z
  const bulkApply = (fn) => {
    const ids = [..._consumersTableSelected];
    if (!ids.length) return;
    snap('consumers-table:bulk:' + ids.length);
    let affected = 0;
    for (const id of ids) {
      const node = window.Raschet?._state?.nodes?.get(id);
      if (!node) continue;
      fn(node);
      affected++;
    }
    if (typeof window.Raschet?.rerender === 'function') window.Raschet.rerender();
    renderConsumersTable();
    flash(`Изменено: ${affected} из ${ids.length} потребителей`);
  };
  const askNum = (title, def, min, max) => {
    const v = prompt(title, String(def));
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (min != null && n < min) return null;
    if (max != null && n > max) return null;
    return n;
  };
  const demBtn = mount.querySelector('#ctc-bulk-demand');
  if (demBtn) demBtn.addEventListener('click', () => {
    const v = askNum('Установить P (кВт) для выделенных:', 5, 0, 100000);
    if (v != null) bulkApply((n) => { n.demandKw = v; });
  });
  const cosBtn = mount.querySelector('#ctc-bulk-cosPhi');
  if (cosBtn) cosBtn.addEventListener('click', () => {
    const v = askNum('Установить cos φ (0.1..1) для выделенных:', 0.92, 0.1, 1);
    if (v != null) bulkApply((n) => { n.cosPhi = v; });
  });
  const kuBtn = mount.querySelector('#ctc-bulk-kUse');
  if (kuBtn) kuBtn.addEventListener('click', () => {
    const v = askNum('Установить Kи (0..1.5) для выделенных:', 1, 0, 1.5);
    if (v != null) bulkApply((n) => { n.kUse = v; });
  });
  const phBtn = mount.querySelector('#ctc-bulk-phase');
  if (phBtn) phBtn.addEventListener('click', () => {
    const v = prompt('Установить фазу (1ph / 3ph / dc):', '3ph');
    if (!v) return;
    if (!['1ph', '3ph', 'dc'].includes(v)) { flash('Неверное значение', 'error'); return; }
    bulkApply((n) => { n.phase = v; });
  });
}

function exportConsumersTableCsv() {
  const S = window.Raschet?._state;
  if (!S) return;
  let catalog = [];
  try { catalog = window.Raschet?.getConsumerCatalog?.() || []; } catch {}
  const catalogById = new Map(catalog.map(c => [c.id, c]));
  const consumers = [...S.nodes.values()].filter(n => n.type === 'consumer');
  // Phase 1.20.24: включаем «Питающий щит» в экспорт
  const rows = [['Обозначение', 'Имя', 'Питающий щит', 'Категория (тип)', 'Категория (функц.)', 'P, кВт', 'Кол-во', 'cos φ', 'Kи', 'Фаза', 'Iрасч, А']];
  for (const n of consumers) {
    const cat = catalogById.get(n.consumerCatalogId);
    let parentTag = '';
    for (const c of S.conns.values()) {
      if (c.to?.nodeId === n.id) {
        const from = S.nodes.get(c.from?.nodeId);
        if (from && (from.type === 'panel' || from.type === 'ups')) {
          parentTag = _effectiveTag(from) || from.tag || from.name || '';
          break;
        }
      }
    }
    rows.push([
      n.tag || '', n.name || '',
      parentTag,
      cat?.label || '', cat?.category || '',
      n.demandKw || 0, n.count || 1,
      n.cosPhi || '', n.kUse || '',
      n.phase || '',
      n._loadA ? n._loadA.toFixed(1) : '',
    ]);
  }
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    return /[,"\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'consumers-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  flash('Экспортировано ' + (rows.length - 1) + ' потребителей в CSV', 'success');
}

// ================= Таблица оборудования (Phase 1.20.25) =================
let _equipTableFilters = { search: '', type: '' };
let _equipTableSort = { col: 'tag', dir: 'asc' };

function openEquipmentTableModal(opts) {
  openModal('modal-equipment-table');
  if (opts && opts.prefilterKind) {
    _equipTableFilters.type = opts.prefilterKind;
  }
  renderEquipmentTable();
  const srchEl = document.getElementById('equipment-table-search');
  if (srchEl) {
    srchEl.value = _equipTableFilters.search;
    srchEl.oninput = (e) => { _equipTableFilters.search = e.target.value; renderEquipmentTable(); };
  }
  const typeEl = document.getElementById('equipment-table-filter-type');
  if (typeEl) {
    typeEl.value = _equipTableFilters.type;
    typeEl.onchange = (e) => { _equipTableFilters.type = e.target.value; renderEquipmentTable(); };
  }
  const csvBtn = document.getElementById('equipment-table-export-csv');
  if (csvBtn) csvBtn.onclick = exportEquipmentTableCsv;
}

function _equipKindOf(n) {
  if (n.type === 'source') return 'source';
  if (n.type === 'generator') return 'generator';
  if (n.type === 'panel' && n.isMv) return 'panel-mv';
  if (n.type === 'panel') return 'panel-lv';
  if (n.type === 'ups') return 'ups';
  return null;
}

function _equipKindLabel(kind) {
  return {
    source: 'Источник',
    generator: 'Генератор',
    'panel-lv': 'НКУ',
    'panel-mv': 'РУ СН',
    ups: 'ИБП',
  }[kind] || kind;
}

function renderEquipmentTable() {
  const mount = document.getElementById('equipment-table-mount');
  if (!mount) return;
  const S = window.Raschet?._state;
  if (!S) { mount.innerHTML = '<div class="muted">Состояние недоступно</div>'; return; }

  const equip = [...S.nodes.values()]
    .map(n => ({ n, kind: _equipKindOf(n) }))
    .filter(e => e.kind);

  const F = _equipTableFilters;
  const q = (F.search || '').toLowerCase();
  const filtered = equip.filter(e => {
    if (F.type && e.kind !== F.type) return false;
    if (q) {
      const eff = _effectiveTag(e.n) || '';
      const hay = [eff, e.n.tag, e.n.name, e.n.panelCatalogId, e.n.mvSwitchgearId, e.n.upsModel]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sort
  const sortDir = _equipTableSort.dir === 'desc' ? -1 : 1;
  const sortKey = (e) => {
    const n = e.n;
    switch (_equipTableSort.col) {
      case 'tag': return (_effectiveTag(n) || n.tag || n.name || '').toLowerCase();
      case 'kind': return e.kind;
      case 'name': return (n.name || '').toLowerCase();
      case 'inputs': return Number(n.inputs) || 0;
      case 'outputs': return Number(n.outputs) || 0;
      case 'capacity': return Number(n.capacityKw) || 0;
      case 'load': return Number(n._loadKw) || 0;
      case 'loadPct': {
        const cap = Number(n.capacityKw) || 0;
        const load = Number(n._loadKw) || 0;
        return cap > 0 ? load / cap : 0;
      }
      case 'ip': return n.ipRating || '';
      case 'voltage': {
        const lv = (GLOBAL_voltageLevels())[n.voltageLevelIdx];
        return lv ? Number(lv.vLL) || 0 : 0;
      }
      default: return 0;
    }
  };
  filtered.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka < kb) return -1 * sortDir;
    if (ka > kb) return 1 * sortDir;
    return 0;
  });

  const countEl = document.getElementById('equipment-table-count');
  if (countEl) countEl.textContent = `${filtered.length} из ${equip.length}`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // Phase 1.20.31: видимость столбцов equipment table
  const vis = _equipTableVisibility;
  const show = (col) => vis[col] !== false;
  const ifShow = (col, html) => show(col) ? html : '';

  const sortHdr = (col, label, align, extra) => {
    const active = _equipTableSort.col === col;
    const arrow = active ? (_equipTableSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
    const color = active ? 'color:#1976d2;' : '';
    return `<th class="et-sort" data-sort-col="${col}" style="padding:6px 8px;text-align:${align};border-bottom:2px solid #d0d7de;cursor:pointer;user-select:none;${color}${extra ? extra + ';' : ''}">${label}${arrow}</th>`;
  };

  const html = [`
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f6f8fa;position:sticky;top:0;z-index:2">
          ${ifShow('tag', sortHdr('tag', 'Обозначение', 'left', 'min-width:130px'))}
          ${ifShow('kind', sortHdr('kind', 'Тип', 'left'))}
          ${ifShow('name', sortHdr('name', 'Имя / Модель', 'left'))}
          ${ifShow('voltage', sortHdr('voltage', 'U, В', 'right'))}
          ${ifShow('inputs', sortHdr('inputs', 'Вх.', 'right'))}
          ${ifShow('outputs', sortHdr('outputs', 'Вых.', 'right'))}
          ${ifShow('capacity', sortHdr('capacity', 'P ном, кВт', 'right'))}
          ${ifShow('load', sortHdr('load', 'P расч, кВт', 'right'))}
          ${ifShow('loadPct', sortHdr('loadPct', 'Загрузка', 'right', 'min-width:80px'))}
          ${ifShow('ip', sortHdr('ip', 'IP', 'center'))}
          ${ifShow('xnav', '<th style="padding:6px 8px;border-bottom:2px solid #d0d7de;min-width:150px" title="Переход к связанным объектам">Связано</th>')}
        </tr>
      </thead>
      <tbody>`];

  const KIND_ICON = { source: '⚡', generator: '🔋', 'panel-lv': '🗄', 'panel-mv': '⚡', ups: '🔌' };
  const KIND_COLOR = { source: '#1976d2', generator: '#2e7d32', 'panel-lv': '#5d4037', 'panel-mv': '#c67300', ups: '#7b1fa2' };

  for (const e of filtered) {
    const n = e.n;
    const tag = _effectiveTag(n) || n.tag || '?';
    const cap = Number(n.capacityKw) || 0;
    const load = Number(n._loadKw) || 0;
    const loadPct = cap > 0 ? (load / cap * 100) : 0;
    const loadColor = loadPct > 100 ? '#c62828' : loadPct > 90 ? '#e65100' : loadPct > 50 ? '#2e7d32' : '#888';
    const lv = (GLOBAL_voltageLevels())[n.voltageLevelIdx];
    const voltage = lv ? Math.round(Number(lv.vLL) || 0) : '—';
    const model = n.panelCatalogId || n.mvSwitchgearId || n.upsModel || '';

    html.push(`
      <tr data-id="${esc(n.id)}" style="border-bottom:1px solid #eaecef">
        ${ifShow('tag', `<td style="padding:5px 8px;font-weight:600"><a href="#" class="et-jump" data-id="${esc(n.id)}" style="color:${KIND_COLOR[e.kind] || '#1976d2'};text-decoration:none">${esc(tag)} <span style="font-size:10px;opacity:0.7">↗</span></a></td>`)}
        ${ifShow('kind', `<td style="padding:5px 8px;font-size:11px"><span style="font-size:14px;margin-right:4px">${KIND_ICON[e.kind] || '▫'}</span>${esc(_equipKindLabel(e.kind))}</td>`)}
        ${ifShow('name', `<td style="padding:5px 8px;font-size:11px"><div>${esc(n.name || '—')}</div>${model ? `<div class="muted" style="font-size:10px">${esc(model)}</div>` : ''}</td>`)}
        ${ifShow('voltage', `<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px">${voltage}</td>`)}
        ${ifShow('inputs', `<td style="padding:5px 8px;text-align:right;font-size:11px">${n.inputs || '—'}</td>`)}
        ${ifShow('outputs', `<td style="padding:5px 8px;text-align:right;font-size:11px">${n.outputs || '—'}</td>`)}
        ${ifShow('capacity', `<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px">${cap ? cap.toFixed(1) : '—'}</td>`)}
        ${ifShow('load', `<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px">${load ? load.toFixed(1) : '—'}</td>`)}
        ${ifShow('loadPct', `<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;color:${loadColor};font-weight:${loadPct > 90 ? 600 : 400}">${cap > 0 ? loadPct.toFixed(0) + '%' : '—'}${loadPct > 0 ? `<div style="background:#e1e4e8;height:3px;border-radius:2px;margin-top:2px;overflow:hidden"><div style="width:${Math.min(100, loadPct)}%;height:100%;background:${loadColor}"></div></div>` : ''}</td>`)}
        ${ifShow('ip', `<td style="padding:5px 8px;text-align:center;font-size:11px">${n.ipRating || '—'}</td>`)}
        ${ifShow('xnav', `<td style="padding:5px 8px;font-size:10px">${(() => {
          let cableCount = 0, consumerCount = 0;
          for (const c of S.conns.values()) {
            if (c.from?.nodeId === n.id || c.to?.nodeId === n.id) cableCount++;
          }
          const visited = new Set([n.id]);
          const queue = [n.id];
          while (queue.length) {
            const cur = queue.shift();
            for (const c of S.conns.values()) {
              if (c.from?.nodeId !== cur) continue;
              const to = c.to?.nodeId;
              if (!to || visited.has(to)) continue;
              visited.add(to);
              const toNode = S.nodes.get(to);
              if (!toNode) continue;
              if (toNode.type === 'consumer') consumerCount++;
              else queue.push(to);
            }
          }
          const buttons = [];
          if (cableCount) buttons.push(`<button type="button" class="et-xnav" data-xnav="cables" data-id="${esc(n.id)}" title="Открыть кабели щита" style="padding:2px 6px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:3px;cursor:pointer;font-size:10px">🔌 ${cableCount}</button>`);
          if (consumerCount) buttons.push(`<button type="button" class="et-xnav" data-xnav="consumers" data-id="${esc(n.id)}" title="Открыть потребителей щита" style="padding:2px 6px;border:1px solid #7b1fa2;background:#fff;color:#7b1fa2;border-radius:3px;cursor:pointer;font-size:10px">💡 ${consumerCount}</button>`);
          return buttons.length ? `<div style="display:flex;gap:4px">${buttons.join('')}</div>` : '—';
        })()}</td>`)}
      </tr>`);
  }
  const visCount = _EQUIPMENT_TABLE_COLUMNS.filter(c => show(c.id)).length;
  if (!filtered.length) {
    html.push(`<tr><td colspan="${visCount}" style="padding:20px;text-align:center;color:#999">Нет оборудования по текущим фильтрам</td></tr>`);
  }
  html.push('</tbody></table>');
  mount.innerHTML = html.join('');

  // Sort handlers
  mount.querySelectorAll('.et-sort').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      if (_equipTableSort.col === col) {
        _equipTableSort.dir = _equipTableSort.dir === 'asc' ? 'desc' : 'asc';
      } else { _equipTableSort.col = col; _equipTableSort.dir = 'asc'; }
      renderEquipmentTable();
    });
  });
  // Phase 1.20.31: меню столбцов для equipment table
  const colBtn = document.getElementById('equipment-table-col-menu');
  if (colBtn && !colBtn._wired) {
    colBtn._wired = true;
    colBtn.addEventListener('click', () => {
      _openColumnMenu(colBtn, 'equipment', _EQUIPMENT_TABLE_COLUMNS, _equipTableVisibility, (v) => {
        _equipTableVisibility = v;
        renderEquipmentTable();
      });
    });
  }
  mount.querySelectorAll('.et-jump').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.id;
      if (window.Raschet?._state) {
        window.Raschet._state.selectedKind = 'node';
        window.Raschet._state.selectedId = id;
        if (typeof window.Raschet.rerender === 'function') window.Raschet.rerender();
      }
      closeModal('modal-equipment-table');
    });
  });
  // Phase 1.20.30: cross-navigation в таблицы кабелей и потребителей
  mount.querySelectorAll('.et-xnav').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const target = btn.dataset.xnav;
      const node = S.nodes.get(id);
      if (!node) return;
      const tag = _effectiveTag(node) || node.tag || node.name || '';
      closeModal('modal-equipment-table');
      setTimeout(() => {
        if (target === 'cables') {
          // Открываем cable-table и фильтруем по from или to = tag
          _cableTableFilters = {
            search: '', class: '',
            mark: '', method: '', conductor: '',
            parallel: null,
            lengthMin: null, lengthMax: null,
            imaxMin: null, imaxMax: null,
            label: '', fromTo: tag.toLowerCase(),
            category: '', breaker: null, curve: '', status: '',
          };
          openCableTableModal();
        } else if (target === 'consumers') {
          _consumersTableFilters = { search: '', phase: '', category: '', parent: tag };
          openConsumersTableModal();
        }
      }, 100);
    });
  });
}

function GLOBAL_voltageLevels() {
  try { return window.Raschet?.getGlobal?.()?.voltageLevels || []; } catch {}
  return [];
}

function exportEquipmentTableCsv() {
  const S = window.Raschet?._state;
  if (!S) return;
  const rows = [['Обозначение', 'Тип', 'Имя', 'Модель', 'U, В', 'Входов', 'Выходов', 'Pном, кВт', 'Pрасч, кВт', 'Загрузка, %', 'IP']];
  for (const n of S.nodes.values()) {
    const kind = _equipKindOf(n);
    if (!kind) continue;
    const cap = Number(n.capacityKw) || 0;
    const load = Number(n._loadKw) || 0;
    const loadPct = cap > 0 ? (load / cap * 100) : 0;
    const lv = (GLOBAL_voltageLevels())[n.voltageLevelIdx];
    const voltage = lv ? Math.round(Number(lv.vLL) || 0) : '';
    const model = n.panelCatalogId || n.mvSwitchgearId || n.upsModel || '';
    rows.push([
      _effectiveTag(n) || n.tag || '',
      _equipKindLabel(kind),
      n.name || '',
      model,
      voltage,
      n.inputs || '',
      n.outputs || '',
      cap ? cap.toFixed(1) : '',
      load ? load.toFixed(1) : '',
      cap > 0 ? loadPct.toFixed(1) : '',
      n.ipRating || '',
    ]);
  }
  const csv = rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    return /[,"\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'equipment-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  flash('Экспортировано ' + (rows.length - 1) + ' единиц оборудования в CSV', 'success');
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
      <h4>Открытие основных модалок</h4>
      <table>
        <tr><th>Модалка</th><th>Сочетание</th></tr>
        <tr><td>🔍 Найти (поиск по проекту)</td><td><code>Ctrl+F</code></td></tr>
        <tr><td>📊 Сводка проекта / Dashboard</td><td><code>Ctrl+Shift+D</code></td></tr>
        <tr><td>⚠ Проверки проекта / Issues</td><td><code>Ctrl+Shift+I</code></td></tr>
        <tr><td>🔌 Таблица кабелей (Lines)</td><td><code>Ctrl+Shift+L</code></td></tr>
        <tr><td>💡 Таблица потребителей (Users)</td><td><code>Ctrl+Shift+U</code></td></tr>
        <tr><td>🗄 Таблица оборудования (Equipment)</td><td><code>Ctrl+Shift+E</code></td></tr>
      </table>
      <div class="note">В полях ввода (input/textarea) Ctrl+Shift-хоткеи не перехватываются. Нативный Ctrl+F тоже работает в полях; модалка поиска открывается только над холстом.</div>
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
    window.Raschet.onChange(() => {
      markDirty();
      // Phase 1.20.21: обновляем бейдж счётчика проблем
      try { _updateProjectIssuesBadge(); } catch {}
      // Phase 1.20.34: обновляем статус-бар над холстом
      try { _updateProjectStatusBar(); } catch {}
    });
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
  const btnConsumersTable = document.getElementById('btn-open-consumers-table');
  if (btnConsumersTable) btnConsumersTable.addEventListener('click', openConsumersTableModal);
  const btnEquipmentTable = document.getElementById('btn-open-equipment-table');
  if (btnEquipmentTable) btnEquipmentTable.addEventListener('click', openEquipmentTableModal);
  const btnDashboard = document.getElementById('btn-open-dashboard');
  if (btnDashboard) btnDashboard.addEventListener('click', openDashboardModal);
  const btnSearch = document.getElementById('btn-open-search');
  if (btnSearch) btnSearch.addEventListener('click', openSearchPalette);
  const btnIssues = document.getElementById('btn-open-project-issues');
  if (btnIssues) {
    btnIssues.addEventListener('click', openProjectIssuesModal);
    // Обновляем бейдж при загрузке (когда проект уже имеет state)
    setTimeout(() => {
      try { _updateProjectIssuesBadge(); } catch {}
      try { _updateProjectStatusBar(); } catch {}
    }, 500);
  }
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
