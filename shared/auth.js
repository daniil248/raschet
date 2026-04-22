/* =========================================================================
   shared/auth.js — обёртка над Firebase Auth для всех подпрограмм.

   Одна и та же реализация подключается и в главное приложение (раньше
   js/auth.js) и в подпрограммы (battery/, будущий ups-конфигуратор и т.д.),
   так что каждая подпрограмма может работать автономно без main.js.

   API (на window.Auth):
     init()                    — инициализация Firebase (идемпотентная)
     ready()                   — Promise, резолвится после первого auth state
     signIn() / signOut()      — Google SSO
     currentUser               — объект {uid, email, name, photo} или null
     isFirebaseReady           — true если Firebase SDK + config загружены
     onAuthChange(cb)          — подписка на смену пользователя

   Дополнительно: кэшируем uid в localStorage['raschet.currentUserId'],
   чтобы per-user storage в подпрограммах (battery-catalog и т.д.) работал
   даже без инициализации главного приложения.

   Если firebase-config.js пуст или SDK не загружен → локальный режим
   (isFirebaseReady === false, currentUser всегда null).
   ========================================================================= */
(function () {
'use strict';

// Защита от повторного подключения (если shared/auth.js случайно загружен
// и в главном приложении, и из подпрограммы дважды) — первый экземпляр
// выигрывает, остальные no-op.
if (typeof window.Auth !== 'undefined' && window.Auth.__sharedAuth) return;

const listeners = [];
let currentUser = null;
let initCalled = false;
let firebaseReady = false;
let firstStateResolved = false;
let _firstStateResolve;
const firstStatePromise = new Promise(r => { _firstStateResolve = r; });

// v0.59.234: различаем «definitive-null» (Firebase подтвердил: пользователь
// не вошёл) и «unknown» (Firebase ещё не ответил). Во втором случае НЕ
// перезаписываем raschet.currentUserId на 'anonymous' — иначе per-user
// каталоги (ups-catalog, battery-catalog и т.д.) на Ctrl+F5 на короткое
// окно показывают пустой «anonymous»-срез, и пользователь видит откат
// изменений. Перезапись на 'anonymous' делаем только когда Firebase явно
// сообщил «не вошёл» (onAuthStateChanged(null)) ИЛИ когда SDK/конфиг не
// загружены вовсе (локальный режим).
function cacheCurrentUserId(user, { definitive = true } = {}) {
  try {
    if (user && user.uid) {
      localStorage.setItem('raschet.currentUserId', user.uid);
      return;
    }
    if (!definitive) {
      // Не знаем ещё — оставляем предыдущий кеш, чтобы per-user ключи не
      // «мигали» между uid и anonymous.
      return;
    }
    localStorage.setItem('raschet.currentUserId', 'anonymous');
  } catch { /* localStorage недоступен — пропускаем */ }
}

function notify({ definitive = true } = {}) {
  if (!firstStateResolved) {
    firstStateResolved = true;
    _firstStateResolve();
  }
  cacheCurrentUserId(currentUser, { definitive });
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
    // (нет сессии, пустой кеш) — рендерим «не вошли», НО не перетираем
    // кеш currentUserId на 'anonymous' — это лишь таймаут, реальный state
    // ещё может прийти позже; listeners получат null, а per-user каталоги
    // продолжают работать с предыдущим uid.
    setTimeout(() => { if (!firstStateResolved) notify({ definitive: false }); }, 2000);
    firebase.auth().onAuthStateChanged(async user => {
      if (user) {
        currentUser = {
          uid: user.uid,
          email: (user.email || '').toLowerCase(),
          name: user.displayName || user.email || 'User',
          photo: user.photoURL || null,
        };
        // Сохраняем свою запись в userIndex — чтобы нас можно было добавлять по email.
        // Firestore опциональна: в подпрограммах без firestore-compat этот блок
        // молча пропускается.
        try {
          if (firebase.firestore) {
            await firebase.firestore().collection('userIndex').doc(currentUser.email).set({
              uid: currentUser.uid,
              name: currentUser.name,
              photo: currentUser.photo,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
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
  __sharedAuth: true,
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
