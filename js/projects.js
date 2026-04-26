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
// v0.58.40: Firestore не принимает undefined в payload'ах. Конфигурируем
// клиент один раз через settings({ignoreUndefinedProperties:true}),
// чтобы случайное `undefined` в scheme не валило сохранение.
let _fsConfigured = false;
function fsDb() {
  const db = firebase.firestore();
  if (!_fsConfigured) {
    try { db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch {}
    _fsConfigured = true;
  }
  return db;
}
// v0.58.45: settings({ignoreUndefinedProperties}) не срабатывает, если
// firebase.firestore() уже был вызван раньше (auth.js делает это при
// логине). Поэтому дополнительно чистим undefined вручную перед записью.
// Рекурсивно: в объектах — удаляем ключи, в массивах — заменяем на null.
function _stripUndefined(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(_stripUndefined);
  if (typeof v === 'object') {
    // не трогаем FieldValue/Timestamp/sentinel из Firestore SDK
    if (v && typeof v.toDate === 'function') return v;
    if (v && v._methodName) return v; // FieldValue sentinel
    const out = {};
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (val === undefined) continue;
      out[k] = _stripUndefined(val);
    }
    return out;
  }
  return v;
}
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
    const ref = await fsDb().collection('projects').add(_stripUndefined(data));
    return { id: ref.id, ...data, _role: 'owner' };
  },

  async saveProject(id, patch) {
    const p = _stripUndefined({ ...patch, updatedAt: ts() });
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
    } catch (e) {
      // Однократно логируем причину (обычно permission-denied — нет rules
      // на subcollection projects/{id}/presence/{uid}).
      if (!window.__presenceWarned) {
        window.__presenceWarned = true;
        console.warn('[presence] heartbeat failed — проверьте Firestore rules для projects/{id}/presence/{uid}:', e?.message || e);
      }
    }
  },
  async presenceLeave(projectId, uid) {
    if (!projectId || !uid) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('presence').doc(uid).delete();
    } catch {}
  },
  // v0.57.78 (Collaboration C.6): курсоры участников. Пишем { x, y, pageId }
  // прямо в presence-doc (merge), чтобы не плодить ещё одну subcollection.
  // Дросселирование — на клиенте (200 мс). Передача cursor=null снимает курсор.
  async presenceCursor(projectId, uid, cursor) {
    if (!projectId || !uid) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('presence').doc(uid).set({
          cursor: cursor || null,
          lastSeen: Date.now(),
        }, { merge: true });
    } catch { /* permission-denied или offline — молча */ }
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

  // =================== Phase 1.20.53: Object-level locking ===================
  // Subcollection `projects/{id}/locks/{nodeId}` — пока пользователь
  // выделил узел, лок удерживается heartbeat'ом. Другие пользователи
  // видят лок через subscribeLocks и получают предупреждение.
  async acquireLock(projectId, nodeId, uid, userInfo, sessionId) {
    if (!projectId || !nodeId || !uid) return { ok: true };
    try {
      const ref = fsDb().collection('projects').doc(projectId)
        .collection('locks').doc(String(nodeId));
      const snap = await ref.get();
      const now = Date.now();
      if (snap.exists) {
        const d = snap.data();
        const age = now - (d.lastSeen || 0);
        // свой лок (по uid) или устаревший — перезахват
        if (d.uid !== uid && age < 60_000) {
          return { ok: false, owner: { uid: d.uid, name: d.name || '', email: d.email || '' } };
        }
      }
      await ref.set({
        uid, nodeId: String(nodeId),
        name: userInfo?.name || '',
        email: userInfo?.email || '',
        sessionId,
        acquiredAt: snap.exists && snap.data().uid === uid ? (snap.data().acquiredAt || now) : now,
        lastSeen: now,
      });
      return { ok: true };
    } catch (e) {
      console.warn('[lock] acquire failed', e);
      return { ok: true }; // fail-open: лучше пустить чем блокировать
    }
  },
  async releaseLock(projectId, nodeId, uid) {
    if (!projectId || !nodeId || !uid) return;
    try {
      const ref = fsDb().collection('projects').doc(projectId)
        .collection('locks').doc(String(nodeId));
      const snap = await ref.get();
      if (snap.exists && snap.data().uid === uid) {
        await ref.delete();
      }
    } catch {}
  },
  async heartbeatLock(projectId, nodeId, uid) {
    if (!projectId || !nodeId || !uid) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('locks').doc(String(nodeId))
        .update({ lastSeen: Date.now() });
    } catch {}
  },
  subscribeLocks(projectId, callback) {
    if (!projectId) return () => {};
    try {
      return fsDb().collection('projects').doc(projectId)
        .collection('locks').onSnapshot(snap => {
          const now = Date.now();
          const map = {};
          snap.docs.forEach(d => {
            const v = d.data();
            if (now - (v.lastSeen || 0) < 60_000) {
              map[d.id] = v;
            }
          });
          callback(map);
        }, err => { console.warn('[locks] snapshot error', err); });
    } catch { return () => {}; }
  },

  // =================== v0.57.79 (Collaboration C.8): revisions ===================
  // Subcollection `projects/{id}/revisions/{auto-id}`: полный snapshot схемы
  // + метаданные (createdAt, author{Uid,Name,Email}, note, nodeCount, connCount).
  // Auto-snapshot вызывается из main.js после saveProject не чаще, чем раз
  // в 5 минут. Manual — через openRevisionsModal → «Сохранить версию сейчас».
  async saveRevision(projectId, scheme, authorInfo, note) {
    if (!projectId || !scheme) return null;
    const nodeCount = Array.isArray(scheme.nodes) ? scheme.nodes.length : 0;
    const connCount = Array.isArray(scheme.conns) ? scheme.conns.length : 0;
    const doc = {
      createdAt: ts(),
      authorUid: authorInfo?.uid || '',
      authorName: authorInfo?.name || '',
      authorEmail: authorInfo?.email || '',
      note: note || '',
      nodeCount, connCount,
      scheme,
    };
    try {
      const ref = await fsDb().collection('projects').doc(projectId)
        .collection('revisions').add(doc);
      return { id: ref.id, ...doc };
    } catch (e) {
      console.warn('[revisions] save failed', e);
      return null;
    }
  },
  async listRevisions(projectId, limit = 50) {
    if (!projectId) return [];
    try {
      const snap = await fsDb().collection('projects').doc(projectId)
        .collection('revisions').orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map(d => {
        const v = d.data();
        return {
          id: d.id,
          createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : (v.createdAt || 0),
          authorUid: v.authorUid || '',
          authorName: v.authorName || '',
          authorEmail: v.authorEmail || '',
          note: v.note || '',
          nodeCount: v.nodeCount || 0,
          connCount: v.connCount || 0,
        };
      });
    } catch (e) { console.warn('[revisions] list failed', e); return []; }
  },
  async getRevision(projectId, revId) {
    if (!projectId || !revId) return null;
    try {
      const snap = await fsDb().collection('projects').doc(projectId)
        .collection('revisions').doc(revId).get();
      if (!snap.exists) return null;
      const v = snap.data();
      return {
        id: snap.id,
        createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : (v.createdAt || 0),
        authorUid: v.authorUid || '',
        authorName: v.authorName || '',
        authorEmail: v.authorEmail || '',
        note: v.note || '',
        nodeCount: v.nodeCount || 0,
        connCount: v.connCount || 0,
        scheme: v.scheme || null,
      };
    } catch (e) { console.warn('[revisions] get failed', e); return null; }
  },
  async deleteRevision(projectId, revId) {
    if (!projectId || !revId) return;
    try {
      await fsDb().collection('projects').doc(projectId)
        .collection('revisions').doc(revId).delete();
    } catch {}
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

// v0.59.362: id-префиксы локально созданных проектов из /projects/projects.js
// и shared/project-storage.js. Когда такой id попадает в облачный режим,
// Firestore не находит документ → выкидывает permission-denied → main.js
// открывает «Запросить доступ». Маршрутим такие id напрямую в Local.
function isLocalProjectId(id) {
  if (!id) return false;
  return /^(lp_|p_|s_|_demo_)/.test(String(id));
}
async function _mergedListMyProjects() {
  const cloud = await getStorage().listMyProjects().catch(() => []);
  const local = await Local.listMyProjects().catch(() => []);
  // Local-проекты с id-префиксами p_/s_/lp_ всегда «свои».
  // Сливаем без дублей по id (cloud имеет приоритет на случай совпадений).
  const seen = new Set(cloud.map(p => p.id));
  const out = cloud.slice();
  for (const p of local) if (!seen.has(p.id)) out.push(p);
  return out;
}

window.Storage = {
  get mode() { return getStorage().mode; },
  get isCloud() { return getStorage().mode === 'firestore'; },
  listMyProjects()      { return _mergedListMyProjects(); },
  listSharedProjects()  { return getStorage().listSharedProjects(); },
  listAccessRequests()  { return getStorage().listAccessRequests(); },
  getProject(id)        { return isLocalProjectId(id) ? Local.getProject(id) : getStorage().getProject(id); },
  createProject(n, s)   { return getStorage().createProject(n, s); },
  saveProject(id, patch) { return isLocalProjectId(id) ? Local.saveProject(id, patch) : getStorage().saveProject(id, patch); },
  renameProject(id, n)  { return isLocalProjectId(id) ? Local.renameProject(id, n) : getStorage().renameProject(id, n); },
  deleteProject(id)     { return isLocalProjectId(id) ? Local.deleteProject(id) : getStorage().deleteProject(id); },
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
  presenceCursor(id, uid, cursor) {
    const s = getStorage();
    return s.presenceCursor ? s.presenceCursor(id, uid, cursor) : Promise.resolve();
  },
  subscribePresence(id, cb) {
    const s = getStorage();
    return s.subscribePresence ? s.subscribePresence(id, cb) : (() => {});
  },
  subscribeProjectDoc(id, cb) {
    const s = getStorage();
    return s.subscribeProjectDoc ? s.subscribeProjectDoc(id, cb) : (() => {});
  },
  // Object-level locks (Firestore only; Local → no-op fail-open)
  acquireLock(id, nodeId, uid, info, sid) {
    const s = getStorage();
    return s.acquireLock ? s.acquireLock(id, nodeId, uid, info, sid) : Promise.resolve({ ok: true });
  },
  releaseLock(id, nodeId, uid) {
    const s = getStorage();
    return s.releaseLock ? s.releaseLock(id, nodeId, uid) : Promise.resolve();
  },
  heartbeatLock(id, nodeId, uid) {
    const s = getStorage();
    return s.heartbeatLock ? s.heartbeatLock(id, nodeId, uid) : Promise.resolve();
  },
  subscribeLocks(id, cb) {
    const s = getStorage();
    return s.subscribeLocks ? s.subscribeLocks(id, cb) : (() => {});
  },
  // v0.57.79 Collaboration C.8 — история версий (Firestore only; Local → no-op)
  saveRevision(id, scheme, author, note) {
    const s = getStorage();
    return s.saveRevision ? s.saveRevision(id, scheme, author, note) : Promise.resolve(null);
  },
  listRevisions(id, limit) {
    const s = getStorage();
    return s.listRevisions ? s.listRevisions(id, limit) : Promise.resolve([]);
  },
  getRevision(id, revId) {
    const s = getStorage();
    return s.getRevision ? s.getRevision(id, revId) : Promise.resolve(null);
  },
  deleteRevision(id, revId) {
    const s = getStorage();
    return s.deleteRevision ? s.deleteRevision(id, revId) : Promise.resolve();
  },
  computeRole,
};

})();
