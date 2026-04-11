/* =========================================================================
   auth.js — обёртка над Firebase Auth с локальным fallback.
   Если firebase-config.js не заполнен или Firebase SDK не загружен,
   Auth.isFirebaseReady === false, а Auth.currentUser всегда null.
   ========================================================================= */
(function () {
'use strict';

const listeners = [];
let currentUser = null;
let initCalled = false;
let firebaseReady = false;
let firstStateResolved = false;
let _firstStateResolve;
const firstStatePromise = new Promise(r => { _firstStateResolve = r; });

function notify() {
  if (!firstStateResolved) {
    firstStateResolved = true;
    _firstStateResolve();
  }
  for (const cb of listeners) {
    try { cb(currentUser); } catch (e) { console.error('[auth] listener failed', e); }
  }
}

function hasValidConfig() {
  const c = window.FIREBASE_CONFIG;
  return c && typeof c.apiKey === 'string' && c.apiKey.length > 10 && c.projectId;
}

async function init() {
  if (initCalled) return;
  initCalled = true;

  if (!hasValidConfig()) {
    console.info('[auth] Firebase config пуст — локальный режим');
    notify();
    return;
  }
  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    console.warn('[auth] Firebase SDK не загрузился (проверьте подключение к интернету)');
    notify();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    firebaseReady = true;
    // Страховка: если Firebase не вызовет onAuthStateChanged за 2 секунды
    // (нет сессии, пустой кеш) — рендерим «не вошли»
    setTimeout(() => { if (!firstStateResolved) notify(); }, 2000);
    firebase.auth().onAuthStateChanged(async user => {
      if (user) {
        currentUser = {
          uid: user.uid,
          email: (user.email || '').toLowerCase(),
          name: user.displayName || user.email || 'User',
          photo: user.photoURL || null,
        };
        // Сохраняем свою запись в userIndex — чтобы нас можно было добавлять по email
        try {
          await firebase.firestore().collection('userIndex').doc(currentUser.email).set({
            uid: currentUser.uid,
            name: currentUser.name,
            photo: currentUser.photo,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.warn('[auth] не удалось обновить userIndex', e);
        }
      } else {
        currentUser = null;
      }
      notify();
    });
  } catch (e) {
    console.error('[auth] init failed', e);
    firebaseReady = false;
    notify();
  }
}

async function signIn() {
  if (!firebaseReady) {
    throw new Error('Firebase не настроен. См. README.md → Firebase setup');
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  await firebase.auth().signInWithPopup(provider);
}

async function signOut() {
  if (!firebaseReady) return;
  await firebase.auth().signOut();
}

window.Auth = {
  init,
  signIn,
  signOut,
  get currentUser() { return currentUser; },
  get isFirebaseReady() { return firebaseReady; },
  ready() { return firstStatePromise; },
  onAuthChange(cb) {
    listeners.push(cb);
    if (firstStateResolved) cb(currentUser);
  },
};

})();
