/* =========================================================================
   projects.js — CRUD проектов.
   Два адаптера:
     Local    — localStorage, без совместного доступа
     Firestore — облачное хранение, шаринг, запросы доступа
   Выбор адаптера делается динамически в зависимости от Auth.isFirebaseReady
   и залогиненности пользователя.
   ========================================================================= */
(function () {
'use strict';

// --------------------------- Local (single-user) ---------------------------
const LOCAL_KEY = 'raschet.projects.v1';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
  catch { return []; }
}
function saveLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); }
  catch (e) { console.error('[projects] saveLocal failed', e); }
}
function lid() { return 'lp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const Local = {
  mode: 'local',
  async listMyProjects() {
    return loadLocal().map(p => ({ ...p, _role: 'owner' }));
  },
  async listSharedProjects() { return []; },
  async listAccessRequests() { return []; },

  async getProject(id) {
    const p = loadLocal().find(p => p.id === id);
    if (!p) return null;
    return { ...p, _role: 'owner' };
  },

  async createProject(name, scheme) {
    const list = loadLocal();
    const p = {
      id: lid(),
      name: name || 'Новый проект',
      ownerId: 'local',
      ownerEmail: null,
      ownerName: 'Локально',
      scheme: scheme || null,
      visibility: 'private',
      memberUids: [],
      members: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.unshift(p);
    saveLocal(list);
    return { ...p, _role: 'owner' };
  },

  async saveProject(id, patch) {
    const list = loadLocal();
    const i = list.findIndex(p => p.id === id);
    if (i === -1) throw new Error('Проект не найден');
    Object.assign(list[i], patch, { updatedAt: Date.now() });
    saveLocal(list);
    return { ...list[i], _role: 'owner' };
  },

  async renameProject(id, name) { return this.saveProject(id, { name }); },

  async deleteProject(id) {
    saveLocal(loadLocal().filter(p => p.id !== id));
  },

  async shareProject() { throw new Error('Совместный доступ доступен только после входа через Gmail. Настройте Firebase — см. README.'); },
  async unshareMember() { throw new Error('Совместный доступ недоступен в локальном режиме.'); },
  async setVisibility() { throw new Error('Совместный доступ недоступен в локальном режиме.'); },
  async requestAccess() { throw new Error('Совместный доступ недоступен в локальном режиме.'); },
  async approveRequest() { throw new Error('Совместный доступ недоступен в локальном режиме.'); },
  async denyRequest() { throw new Error('Совместный доступ недоступен в локальном режиме.'); },
};

// --------------------------- Firestore adapter ---------------------------
function fsDb() { return firebase.firestore(); }
function ts() { return firebase.firestore.FieldValue.serverTimestamp(); }
function arrayUnion(v) { return firebase.firestore.FieldValue.arrayUnion(v); }
function arrayRemove(v) { return firebase.firestore.FieldValue.arrayRemove(v); }
function fieldDelete() { return firebase.firestore.FieldValue.delete(); }

function computeRole(project, user) {
  if (!user) return 'guest';
  if (project.ownerId === user.uid) return 'owner';
  const m = project.members?.[user.uid];
  if (m) return m.role; // 'editor' | 'viewer'
  return 'guest';
}

const Fs = {
  mode: 'firestore',

  async listMyProjects() {
    const u = window.Auth.currentUser;
    if (!u) return [];
    // Без orderBy, чтобы не требовался composite-index. Сортируем на клиенте.
    const snap = await fsDb().collection('projects')
      .where('ownerId', '==', u.uid)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data(), _role: 'owner' }));
    items.sort((a, b) => {
      const ta = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.updatedAt || 0);
      const tb = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.updatedAt || 0);
      return tb - ta;
    });
    return items;
  },

  async listSharedProjects() {
    const u = window.Auth.currentUser;
    if (!u) return [];
    const snap = await fsDb().collection('projects')
      .where('memberUids', 'array-contains', u.uid)
      .get();
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, _role: data.members?.[u.uid]?.role || 'viewer' };
    });
  },

  async listAccessRequests() {
    const u = window.Auth.currentUser;
    if (!u) return [];
    const snap = await fsDb().collection('accessRequests')
      .where('ownerId', '==', u.uid)
      .where('status', '==', 'pending')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getProject(id) {
    try {
      const doc = await fsDb().collection('projects').doc(id).get();
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() };
      data._role = computeRole(data, window.Auth.currentUser);
      return data;
    } catch (e) {
      if (e.code === 'permission-denied') {
        const err = new Error('Нет доступа к проекту');
        err.code = 'permission-denied';
        throw err;
      }
      throw e;
    }
  },

  async createProject(name, scheme) {
    const u = window.Auth.currentUser;
    if (!u) throw new Error('Войдите через Gmail, чтобы создать проект');
    const data = {
      ownerId: u.uid,
      ownerEmail: u.email,
      ownerName: u.name,
      name: name || 'Новый проект',
      scheme: scheme || null,
      visibility: 'private',
      memberUids: [],
      members: {},
      createdAt: ts(),
      updatedAt: ts(),
    };
    const ref = await fsDb().collection('projects').add(data);
    return { id: ref.id, ...data, _role: 'owner' };
  },

  async saveProject(id, patch) {
    const p = { ...patch, updatedAt: ts() };
    await fsDb().collection('projects').doc(id).update(p);
    return this.getProject(id);
  },

  // =================== Phase 1.20.51: Presence + Live Sync ===================
  // Presence: хранится в subcollection `projects/{id}/presence/{uid}`.
  // Heartbeat обновляет lastSeen; "stale" > 90 сек считается offline.
  async presenceHeartbeat(projectId, uid, userInfo, sessionId) {
    if (!projectId || !uid) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('presence').doc(uid).set({
          uid,
          name: userInfo?.name || '',
          email: userInfo?.email || '',
          photo: userInfo?.photo || null,
          sessionId,
          lastSeen: Date.now(),
        }, { merge: true });
    } catch (e) { /* молча — permission-denied или offline */ }
  },
  async presenceLeave(projectId, uid) {
    if (!projectId || !uid) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('presence').doc(uid).delete();
    } catch {}
  },
  subscribePresence(projectId, callback) {
    if (!projectId) return () => {};
    try {
      return fsDb().collection('projects').doc(projectId)
        .collection('presence').onSnapshot(snap => {
          const list = snap.docs.map(d => d.data()).filter(u => {
            const age = Date.now() - (u.lastSeen || 0);
            return age < 90_000;
          });
          callback(list);
        }, err => { console.warn('[presence] snapshot error', err); });
    } catch (e) { return () => {}; }
  },
  subscribeProjectDoc(projectId, callback) {
    if (!projectId) return () => {};
    try {
      return fsDb().collection('projects').doc(projectId)
        .onSnapshot(doc => {
          if (!doc.exists) return;
          callback({ id: doc.id, ...doc.data() });
        }, err => { console.warn('[project-sync] snapshot error', err); });
    } catch (e) { return () => {}; }
  },

  async renameProject(id, name) { return this.saveProject(id, { name }); },

  async deleteProject(id) {
    await fsDb().collection('projects').doc(id).delete();
  },

  async shareProject(projectId, email, role) {
    email = (email || '').toLowerCase().trim();
    if (!email) throw new Error('Укажите email');
    if (!['viewer', 'editor'].includes(role)) role = 'viewer';

    // Ищем пользователя по email в userIndex
    const snap = await fsDb().collection('userIndex').doc(email).get();
    if (!snap.exists) {
      throw new Error('Пользователь с таким email ещё не входил в приложение. Попросите его сначала войти.');
    }
    const target = snap.data();
    const targetUid = target.uid;
    const u = window.Auth.currentUser;
    if (targetUid === u.uid) throw new Error('Это вы сами');

    await fsDb().collection('projects').doc(projectId).update({
      [`members.${targetUid}`]: {
        email,
        name: target.name || email,
        role,
        addedAt: Date.now(),
      },
      memberUids: arrayUnion(targetUid),
      updatedAt: ts(),
    });
  },

  async unshareMember(projectId, memberUid) {
    await fsDb().collection('projects').doc(projectId).update({
      [`members.${memberUid}`]: fieldDelete(),
      memberUids: arrayRemove(memberUid),
      updatedAt: ts(),
    });
  },

  async setVisibility(projectId, visibility) {
    if (!['private', 'link'].includes(visibility)) return;
    await fsDb().collection('projects').doc(projectId).update({
      visibility,
      updatedAt: ts(),
    });
  },

  async requestAccess(projectId, role = 'viewer') {
    const u = window.Auth.currentUser;
    if (!u) throw new Error('Войдите через Gmail, чтобы запросить доступ');
    // Нужен ownerId проекта — но read может не пройти у неучастника.
    // Для 'link' visibility надо бы разрешить чтение имени и ownerId.
    // Fallback: используем отдельное облегчённое чтение через метаданные.
    let ownerId = null;
    try {
      const p = await fsDb().collection('projects').doc(projectId).get();
      if (p.exists) ownerId = p.data().ownerId;
    } catch { /* permission-denied — ok, будем брать из запроса */ }
    if (!ownerId) throw new Error('Проект не найден или закрыт');

    await fsDb().collection('accessRequests').add({
      projectId,
      ownerId,
      requesterUid: u.uid,
      requesterEmail: u.email,
      requesterName: u.name,
      role,
      status: 'pending',
      createdAt: ts(),
    });
  },

  async approveRequest(reqId, role) {
    const reqDoc = await fsDb().collection('accessRequests').doc(reqId).get();
    if (!reqDoc.exists) throw new Error('Запрос не найден');
    const r = reqDoc.data();
    const useRole = role || r.role || 'viewer';
    await fsDb().collection('projects').doc(r.projectId).update({
      [`members.${r.requesterUid}`]: {
        email: r.requesterEmail,
        name: r.requesterName,
        role: useRole,
        addedAt: Date.now(),
      },
      memberUids: arrayUnion(r.requesterUid),
      updatedAt: ts(),
    });
    await fsDb().collection('accessRequests').doc(reqId).delete();
  },

  async denyRequest(reqId) {
    await fsDb().collection('accessRequests').doc(reqId).delete();
  },
};

// --------------------------- Выбор адаптера ---------------------------
function getStorage() {
  if (window.Auth && window.Auth.isFirebaseReady) return Fs;
  return Local;
}

window.Storage = {
  get mode() { return getStorage().mode; },
  get isCloud() { return getStorage().mode === 'firestore'; },
  listMyProjects()      { return getStorage().listMyProjects(); },
  listSharedProjects()  { return getStorage().listSharedProjects(); },
  listAccessRequests()  { return getStorage().listAccessRequests(); },
  getProject(id)        { return getStorage().getProject(id); },
  createProject(n, s)   { return getStorage().createProject(n, s); },
  saveProject(id, patch) { return getStorage().saveProject(id, patch); },
  renameProject(id, n)  { return getStorage().renameProject(id, n); },
  deleteProject(id)     { return getStorage().deleteProject(id); },
  shareProject(id, e, r) { return getStorage().shareProject(id, e, r); },
  unshareMember(id, u)  { return getStorage().unshareMember(id, u); },
  setVisibility(id, v)  { return getStorage().setVisibility(id, v); },
  requestAccess(id, r)  { return getStorage().requestAccess(id, r); },
  approveRequest(id, r) { return getStorage().approveRequest(id, r); },
  denyRequest(id)       { return getStorage().denyRequest(id); },
  // Presence + live sync (только для Firestore; для Local — no-op)
  presenceHeartbeat(id, uid, info, sid) {
    const s = getStorage();
    return s.presenceHeartbeat ? s.presenceHeartbeat(id, uid, info, sid) : Promise.resolve();
  },
  presenceLeave(id, uid) {
    const s = getStorage();
    return s.presenceLeave ? s.presenceLeave(id, uid) : Promise.resolve();
  },
  subscribePresence(id, cb) {
    const s = getStorage();
    return s.subscribePresence ? s.subscribePresence(id, cb) : (() => {});
  },
  subscribeProjectDoc(id, cb) {
    const s = getStorage();
    return s.subscribeProjectDoc ? s.subscribeProjectDoc(id, cb) : (() => {});
  },
  computeRole,
};

})();
