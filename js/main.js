/* =========================================================================
   main.js — приложение-оболочка:
     - инициализация Auth + Storage
     - переключение экранов: loading / projects / editor
     - список проектов, создание, удаление, переименование
     - шаринг и запросы доступа
     - запись/чтение текущего проекта через window.Raschet API
   ========================================================================= */
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
    const [mine, shared, requests] = await Promise.all([
      window.Storage.listMyProjects().catch(e => { console.error(e); return []; }),
      window.Storage.listSharedProjects().catch(e => { console.error(e); return []; }),
      window.Storage.listAccessRequests().catch(e => { console.error(e); return []; }),
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
    } else {
      window.Raschet.loadScheme(null);
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
    parts.push(`<div class="preset-group"><h4>${escHtml(cat)}</h4></div>`);
    for (const p of filtered) {
      parts.push(
        `<div class="preset-card" data-id="${escAttr(p.id)}">` +
        `<div class="pc-title">${escHtml(p.title)}</div>` +
        `<div class="pc-desc">${escHtml(p.description || '')}</div>` +
        `</div>`
      );
    }
  }
  els.presetsList.innerHTML = parts.join('') || '<div class="muted" style="padding:20px;text-align:center">Ничего не найдено</div>';
  els.presetsList.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = window.Presets.get(card.dataset.id);
      if (!p) return;
      window.Raschet.applyPreset(p);
      closeModal('modal-presets');
      flash(`Добавлено: ${p.title}`);
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
