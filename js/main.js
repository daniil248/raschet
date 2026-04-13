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
  maxParallelAuto: 4,
  maxVdropPct: 5,
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
  html += '<tr style="background:#f4f5f7"><th style="padding:4px">Название</th><th>V_LL</th><th>V_LN</th><th>Фазы</th><th>Жилы</th><th></th></tr>';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    html += `<tr style="border-bottom:1px solid #eee">
      <td><input type="text" data-vl-idx="${i}" data-vl-field="label" value="${escHtml(lv.label)}" style="width:100%;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="vLL" value="${lv.vLL}" style="width:60px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="vLN" value="${lv.vLN}" style="width:60px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="phases" value="${lv.phases}" style="width:30px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><input type="number" data-vl-idx="${i}" data-vl-field="wires" value="${lv.wires}" style="width:30px;font-size:11px;padding:3px;border:1px solid #ddd;border-radius:3px"></td>
      <td><button type="button" data-vl-del="${i}" style="background:transparent;border:none;color:#c62828;cursor:pointer;font-size:14px" title="Удалить">×</button></td>
    </tr>`;
  }
  html += '</table>';
  container.innerHTML = html;

  // Обработчики
  container.querySelectorAll('[data-vl-idx]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.vlIdx);
      const field = inp.dataset.vlField;
      const G2 = window.Raschet.getGlobal();
      if (G2.voltageLevels[idx]) {
        G2.voltageLevels[idx][field] = inp.type === 'number' ? Number(inp.value) : inp.value;
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

function openSettingsModal() {
  const G = (window.Raschet && window.Raschet.getGlobal) ? window.Raschet.getGlobal() : SETTINGS_DEFAULTS;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('set-cosPhi',        G.defaultCosPhi ?? 0.92);
  renderVoltageLevelsTable();
  const addBtn = document.getElementById('voltage-levels-add');
  if (addBtn) addBtn.onclick = () => {
    const G2 = window.Raschet.getGlobal();
    G2.voltageLevels.push({ label: 'New', vLL: 400, vLN: 230, phases: 3, wires: 5 });
    window.Raschet.setGlobal({ voltageLevels: G2.voltageLevels });
    renderVoltageLevelsTable();
  };
  set('set-material',      G.defaultMaterial ?? 'Cu');
  set('set-insulation',    G.defaultInsulation ?? 'PVC');
  set('set-cableType',     G.defaultCableType ?? 'multi');
  set('set-maxCableSize',  G.maxCableSize ?? 240);
  set('set-maxParallelAuto', G.maxParallelAuto ?? 4);
  set('set-maxVdropPct', G.maxVdropPct ?? 5);
  set('set-installMethod', G.defaultInstallMethod ?? 'B1');
  set('set-ambient',       G.defaultAmbient ?? 30);
  openModal('modal-settings');
}

function saveSettingsModal() {
  const get = (id) => document.getElementById(id)?.value;
  const G = window.Raschet.getGlobal();
  const patch = {
    voltageLevels:      G.voltageLevels, // уже обновлены через inline-редактирование
    defaultCosPhi:      Number(get('set-cosPhi')) || 0.92,
    defaultMaterial:    get('set-material') || 'Cu',
    defaultInsulation:  get('set-insulation') || 'PVC',
    defaultCableType:   get('set-cableType') || 'multi',
    maxCableSize:       Number(get('set-maxCableSize')) || 240,
    maxParallelAuto:    Number(get('set-maxParallelAuto')) || 4,
    maxVdropPct:        Number(get('set-maxVdropPct')) || 5,
    defaultInstallMethod: get('set-installMethod') || 'B1',
    defaultAmbient:     Number(get('set-ambient')) || 30,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(patch)); }
  catch (e) { console.warn('[settings] save failed', e); }
  if (window.Raschet && typeof window.Raschet.setGlobal === 'function') {
    window.Raschet.setGlobal(patch);
  }
  closeModal('modal-settings');
  flash('Настройки применены');
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
        `<div class="pc-title">${escHtml(p.title)}</div>` +
        `<div class="pc-desc">${escHtml(p.description || '')}</div>` +
        `</div>` +
        `<div class="pc-actions">` +
        `<button class="pc-btn pc-add" data-add-id="${escAttr(p.id)}" title="Вставить на холст">⎘</button>` +
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
      flash('Добавлено: ' + p.title);
    });
  });

  // Click edit button → edit preset params
  els.presetsList.querySelectorAll('.pc-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const p = window.Presets.get(btn.dataset.editId);
      if (!p) return;
      openPresetEditor(p);
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
      window.Presets.all.push(preset);
      try {
        const stored = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
        stored.push(preset);
        localStorage.setItem('raschet.userPresets.v1', JSON.stringify(stored));
      } catch {}
      renderPresets(els.presetsSearch.value);
      // Open editor immediately
      openPresetEditor(preset);
    });
  });
}

function openPresetEditor(preset) {
  const p = preset.params || {};
  const type = preset.type;
  const TYPE_LABELS = { source: 'Источник', generator: 'Генератор', panel: 'Щит', ups: 'ИБП', consumer: 'Потребитель', channel: 'Канал' };

  // Helper
  const fld = (label, input) => `<div style="margin-bottom:8px"><label style="display:block;font-size:11px;text-transform:uppercase;color:#666;margin-bottom:2px">${escHtml(label)}</label>${input}</div>`;
  const inp = (key, val, opts) => {
    const t = opts?.type || (typeof val === 'number' ? 'number' : 'text');
    const extra = opts?.step ? ` step="${opts.step}"` : (t === 'number' ? ' step="any"' : '');
    const min = opts?.min != null ? ` min="${opts.min}"` : '';
    const max = opts?.max != null ? ` max="${opts.max}"` : '';
    return `<input type="${t}" data-edit-key="${key}" value="${escAttr(String(val ?? ''))}"${extra}${min}${max} style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px">`;
  };
  const sel = (key, options, val) => {
    let h = `<select data-edit-key="${key}" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px">`;
    for (const o of options) h += `<option value="${escAttr(o.v)}"${o.v === val ? ' selected' : ''}>${escHtml(o.l)}</option>`;
    h += '</select>';
    return h;
  };

  let html = `<div style="padding:12px">`;
  html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:11px;color:#999;text-transform:uppercase">${escHtml(TYPE_LABELS[type] || type)}</span></div>`;

  // Общие поля
  html += fld('Название в библиотеке', inp('title', preset.title));
  html += fld('Описание', inp('description', preset.description || ''));
  html += fld('Имя элемента на схеме', inp('name', p.name || ''));

  // Поля по типу
  if (type === 'source' || type === 'generator') {
    html += fld('Мощность, kW', inp('capacityKw', p.capacityKw || 0));
    if (type === 'generator') {
      html += fld('Режим', sel('backupMode', [{v:'true',l:'Резерв'},{v:'false',l:'Основной'}], String(p.backupMode !== false)));
    }
  }

  if (type === 'panel') {
    html += fld('Номинальный ток, А', inp('capacityA', p.capacityA || 0));
    html += '<div style="display:flex;gap:8px">';
    html += '<div style="flex:1">' + fld('Входов', inp('inputs', p.inputs || 1, {min:1,max:10,step:1})) + '</div>';
    html += '<div style="flex:1">' + fld('Выходов', inp('outputs', p.outputs || 4, {min:1,max:30,step:1})) + '</div>';
    html += '</div>';
    html += fld('Режим АВР', sel('switchMode', [{v:'auto',l:'Авто (АВР)'},{v:'manual',l:'Ручной'},{v:'parallel',l:'Параллельный'}], p.switchMode || 'auto'));
  }

  if (type === 'ups') {
    html += fld('Выходная мощность, kW', inp('capacityKw', p.capacityKw || 0));
    html += fld('КПД, %', inp('efficiency', p.efficiency || 94, {min:50,max:100,step:1}));
    html += '<div style="display:flex;gap:8px">';
    html += '<div style="flex:1">' + fld('Входов', inp('inputs', p.inputs || 1, {min:1,max:5,step:1})) + '</div>';
    html += '<div style="flex:1">' + fld('Выходов', inp('outputs', p.outputs || 2, {min:1,max:20,step:1})) + '</div>';
    html += '</div>';
    html += fld('Ёмкость АКБ, kWh', inp('batteryKwh', p.batteryKwh || 0));
    html += fld('Ток заряда, kW', inp('chargeKw', p.chargeKw || 0));
  }

  if (type === 'consumer') {
    // Тип оборудования из каталога
    const catalog = window.Raschet?.getConsumerCatalog?.() || [];
    if (catalog.length) {
      let catOpts = [{v:'custom',l:'Произвольный'}];
      for (const c of catalog) catOpts.push({v:c.id,l:c.label});
      html += fld('Тип оборудования', sel('consumerSubtype', catOpts, p.consumerSubtype || 'custom'));
    }
    html += fld('Мощность, kW', inp('demandKw', p.demandKw || 10));
    html += '<div style="display:flex;gap:8px">';
    html += '<div style="flex:1">' + fld('Количество', inp('count', p.count || 1, {min:1,step:1})) + '</div>';
    html += '<div style="flex:1">' + fld('Входов', inp('inputs', p.inputs || 1, {min:1,max:10,step:1})) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px">';
    html += '<div style="flex:1">' + fld('cos φ', inp('cosPhi', p.cosPhi ?? 0.92, {min:0.1,max:1,step:0.01})) + '</div>';
    html += '<div style="flex:1">' + fld('Ки', inp('kUse', p.kUse ?? 1, {min:0,max:1,step:0.05})) + '</div>';
    html += '</div>';
    html += fld('Кратность пускового тока', inp('inrushFactor', p.inrushFactor || 1, {min:1,max:10,step:0.1}));
    html += fld('Фаза', sel('phase', [{v:'3ph',l:'3Ф'},{v:'1ph',l:'1Ф'},{v:'A',l:'A'},{v:'B',l:'B'},{v:'C',l:'C'}], p.phase || '3ph'));
  }

  if (type === 'channel') {
    html += fld('Длина, м', inp('lengthM', p.lengthM || 10, {min:0}));
  }

  html += `<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">`;
  html += `<button id="pe-cancel" style="padding:6px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer">Отмена</button>`;
  html += `<button id="pe-save" style="padding:6px 16px;border:none;background:#1976d2;color:#fff;border-radius:4px;cursor:pointer">Сохранить</button>`;
  html += `</div></div>`;

  // Hide search, show editor
  els.presetsSearch.style.display = 'none';
  els.presetsList.innerHTML = html;

  document.getElementById('pe-cancel').onclick = () => {
    els.presetsSearch.style.display = '';
    renderPresets(els.presetsSearch.value);
  };
  document.getElementById('pe-save').onclick = () => {
    const container = els.presetsList;
    container.querySelectorAll('[data-edit-key]').forEach(el => {
      const key = el.dataset.editKey;
      let val = el.type === 'number' ? Number(el.value) : el.value;
      // Boolean selects
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      if (key === 'title') { preset.title = val; return; }
      if (key === 'description') { preset.description = val; return; }
      if (!preset.params) preset.params = {};
      preset.params[key] = val;
    });
    // Sync name to title if not set
    if (!preset.params.name) preset.params.name = preset.title;
    // Save to localStorage
    if (preset.custom) {
      try {
        const stored = JSON.parse(localStorage.getItem('raschet.userPresets.v1') || '[]');
        const idx = stored.findIndex(p => p.id === preset.id);
        if (idx >= 0) stored[idx] = preset;
        else stored.push(preset);
        localStorage.setItem('raschet.userPresets.v1', JSON.stringify(stored));
      } catch {}
    }
    els.presetsSearch.style.display = '';
    renderPresets(els.presetsSearch.value);
    flash('Параметры обновлены');
  };
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
  // Применяем сохранённые настройки как можно раньше — после загрузки Raschet
  loadGlobalSettings();
  if (els.btnOpenPresets) els.btnOpenPresets.addEventListener('click', openPresetsModal);
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
