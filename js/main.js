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
import { getMethod, listMethods } from './methods/index.js';

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
  btnOpenReport: $('btn-open-report'),
  btnOpenLoadsImport: $('btn-open-loads-import'),
  presetsSearch: $('presets-search'),
  presetsList: $('presets-list'),
  reportBody: $('report-body'),
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

function loadGlobalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!window.Raschet || typeof window.Raschet.setGlobal !== 'function') return;
    window.Raschet.setGlobal(saved);
  } catch (e) { console.warn('[settings] load failed', e); }
}

function renderVoltageLevelsTable() {
  const container = document.getElementById('voltage-levels-table');
  if (!container) return;
  const G = (window.Raschet && window.Raschet.getGlobal) ? window.Raschet.getGlobal() : SETTINGS_DEFAULTS;
  const levels = G.voltageLevels || [];
  let html = '<table style="width:100%;font-size:11px;border-collapse:collapse">';
  html += '<tr style="background:#f4f5f7"><th style="padding:4px">Название</th><th>V_LL</th><th>V_LN</th><th>Фазы</th><th>DC</th><th></th></tr>';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    html += `<tr style="border-bottom:1px solid #eee">
      <td><input type="text" data-vl-idx="${i}" data-vl-field="label" value="${escHtml(lv.label)}" style="width:100%;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="vLL" value="${lv.vLL}" style="width:60px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="vLN" value="${lv.vLN}" style="width:60px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="phases" value="${lv.phases}" style="width:30px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td style="text-align:center"><input type="checkbox" data-vl-idx="${i}" data-vl-field="dc"${lv.dc ? ' checked' : ''}></td>
      <td><button type="button" data-vl-del="${i}" style="background:transparent;border:none;color:#c62828;cursor:pointer;font-size:14px" title="Удалить">×</button></td>
    </tr>`;
  }
  html += '</table>';
  container.innerHTML = html;

  // Обработчики
  container.querySelectorAll('[data-vl-idx]').forEach(inp => {
    const evt = (inp.type === 'checkbox') ? 'change' : 'input';
    inp.addEventListener(evt, () => {
      const idx = Number(inp.dataset.vlIdx);
      const field = inp.dataset.vlField;
      const G2 = window.Raschet.getGlobal();
      if (G2.voltageLevels[idx]) {
        let v;
        if (inp.type === 'checkbox') v = inp.checked;
        else if (inp.type === 'number') v = Number(inp.value);
        else v = inp.value;
        G2.voltageLevels[idx][field] = v;
        window.Raschet.setGlobal({ voltageLevels: G2.voltageLevels });
      }
    });
  });
  container.querySelectorAll('[data-vl-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.vlDel);
      const G2 = window.Raschet.getGlobal();
      G2.voltageLevels.splice(idx, 1);
      window.Raschet.setGlobal({ voltageLevels: G2.voltageLevels });
      renderVoltageLevelsTable();
    });
  });
}

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
  const G = (window.Raschet && window.Raschet.getGlobal) ? window.Raschet.getGlobal() : SETTINGS_DEFAULTS;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('set-cosPhi',        G.defaultCosPhi ?? 0.92);
  set('set-earthingSystem', G.earthingSystem ?? 'TN-S');
  renderVoltageLevelsTable();
  const addBtn = document.getElementById('voltage-levels-add');
  if (addBtn) addBtn.onclick = () => {
    const G2 = window.Raschet.getGlobal();
    G2.voltageLevels.push({ label: 'New', vLL: 400, vLN: 230, phases: 3 });
    window.Raschet.setGlobal({ voltageLevels: G2.voltageLevels });
    renderVoltageLevelsTable();
  };
  set('set-material',      G.defaultMaterial ?? 'Cu');
  set('set-insulation',    G.defaultInsulation ?? 'PVC');
  set('set-cableType',     G.defaultCableType ?? 'multi');
  set('set-maxCableSize',  G.maxCableSize ?? 240);
  set('set-maxParallelAuto', G.maxParallelAuto ?? 10);
  set('set-maxVdropPct', G.maxVdropPct ?? 5);
  set('set-calcMethod',    G.calcMethod ?? 'iec');
  updateInstallMethodOptions(G.calcMethod ?? 'iec');
  set('set-installMethod', G.defaultInstallMethod ?? 'B1');
  set('set-ambient',       G.defaultAmbient ?? 30);
  set('set-parallelProtection', G.parallelProtection ?? 'individual');
  set('set-breakerMinMarginPct', G.breakerMinMarginPct ?? 0);
  // Чекбокс: показывать справочную информацию
  const showHelpEl = document.getElementById('set-showHelp');
  if (showHelpEl) showHelpEl.checked = G.showHelp !== false;
  // При смене методики — обновить список способов прокладки
  const calcMethodEl = document.getElementById('set-calcMethod');
  if (calcMethodEl) calcMethodEl.onchange = () => updateInstallMethodOptions(calcMethodEl.value);
  openModal('modal-settings');
}

function saveSettingsModal() {
  const get = (id) => document.getElementById(id)?.value;
  const G = window.Raschet.getGlobal();
  const patch = {
    voltageLevels:      G.voltageLevels, // уже обновлены через inline-редактирование
    defaultCosPhi:      Number(get('set-cosPhi')) || 0.92,
    earthingSystem:     get('set-earthingSystem') || 'TN-S',
    defaultMaterial:    get('set-material') || 'Cu',
    defaultInsulation:  get('set-insulation') || 'PVC',
    defaultCableType:   get('set-cableType') || 'multi',
    maxCableSize:       Number(get('set-maxCableSize')) || 240,
    maxParallelAuto:    Number(get('set-maxParallelAuto')) || 10,
    maxVdropPct:        Number(get('set-maxVdropPct')) || 5,
    defaultInstallMethod: get('set-installMethod') || 'B1',
    defaultAmbient:     Number(get('set-ambient')) || 30,
    calcMethod:         get('set-calcMethod') || 'iec',
    parallelProtection: get('set-parallelProtection') || 'individual',
    breakerMinMarginPct: Math.max(0, Number(get('set-breakerMinMarginPct')) || 0),
    showHelp:           !!document.getElementById('set-showHelp')?.checked,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(patch)); }
  catch (e) { console.warn('[settings] save failed', e); }
  if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
    window.Raschet.setGlobal(patch);
  }
  closeModal('modal-settings');
  flash('Настройки применены');
}

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
  flash('Параметры проекта сохранены');
  // Нотификация о смене для сохранения в БД / localStorage
  if (typeof window.Raschet.notifyChange === 'function') window.Raschet.notifyChange();
}

function resetSettingsModal() {
  if (!confirm('Сбросить все начальные условия к значениям по умолчанию?')) return;
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
    window.Raschet.setGlobal(SETTINGS_DEFAULTS);
  }
  openSettingsModal();
  flash('Сброшено');
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
  document.querySelectorAll('.pal-presets').forEach(container => {
    const type = container.dataset.palPresetsType;
    const list = byType.get(type) || [];
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
    const CAT_TYPE = { 'Источники': 'source', 'Генераторы': 'generator', 'Щиты': 'panel', 'ИБП': 'ups', 'Потребители': 'consumer', 'Каналы': 'channel' };
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
  const h = [];
  // Базовые (нередактируемые)
  h.push('<h4 style="margin:0 0 8px;font-size:12px;color:#666">Базовые типы</h4>');
  for (const cat of CATALOG) {
    if (cat.id.startsWith('user_')) continue;
    h.push(`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0">`);
    h.push(`<span style="flex:1;font-size:13px"><b>${escHtml(cat.label)}</b> <span style="color:#999;font-size:11px">cos φ ${cat.cosPhi}, Ки ${cat.kUse}</span></span>`);
    h.push('</div>');
  }
  // Пользовательские (редактируемые/удаляемые)
  if (customs.length) {
    h.push('<h4 style="margin:16px 0 8px;font-size:12px;color:#666">Пользовательские типы</h4>');
    for (let ci = 0; ci < customs.length; ci++) {
      const cat = customs[ci];
      h.push(`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0">`);
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

// ================= Отчёт =================
function openReportModal() {
  try {
    const report = window.Raschet.generateReport();
    els.reportBody.textContent = report;
    openModal('modal-report');
  } catch (e) {
    console.error(e);
    flash('Ошибка генерации отчёта', 'error');
  }
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
  const settingsSave = document.getElementById('settings-save');
  if (settingsSave) settingsSave.addEventListener('click', saveSettingsModal);
  const settingsReset = document.getElementById('settings-reset');
  if (settingsReset) settingsReset.addEventListener('click', resetSettingsModal);
  // Project info modal
  const btnProjectInfo = document.getElementById('btn-open-project-info');
  if (btnProjectInfo) btnProjectInfo.addEventListener('click', openProjectInfoModal);
  const projectInfoSave = document.getElementById('project-info-save');
  if (projectInfoSave) projectInfoSave.addEventListener('click', saveProjectInfoModal);
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
    G.customConsumerCatalog.push({ id: 'user_' + Date.now(), label, cosPhi: 0.92, kUse: 1 });
    window.Raschet.setGlobal({ customConsumerCatalog: G.customConsumerCatalog });
    if (typeof window.__raschetPersistUserCatalog === 'function') window.__raschetPersistUserCatalog();
    renderConsumerCatalogModal();
  });
  if (els.btnOpenReport) els.btnOpenReport.addEventListener('click', openReportModal);
  if (els.btnOpenLoadsImport) els.btnOpenLoadsImport.addEventListener('click', openLoadsImportModal);
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
