/* =========================================================================
   shared/auth-gate.js — гард доступа ко всем модулям программы.

   Подключается ПОСЛЕ shared/auth.js. Если пользователь не авторизован —
   редиректит на login.html (с сохранением исходного URL в ?next=...).
   Исключения (страницы, доступные без авторизации):
     • login.html — сама страница входа
   Если firebase-config.js пуст или SDK не загружен — гард работает в
   локальном режиме (без редиректа), как и раньше. Это позволяет
   разрабатывать локально без Firebase.

   Пользователь (2026-04-30): «без авторизации даже нельзя видеть главное
   меню программы, только страницу входа и обзорную информацию о модулях,
   состав которой определяет администратор».

   Активация: <script src="shared/auth-gate.js" defer></script>  ПОСЛЕ
   <script src="shared/auth.js"></script>.
   ========================================================================= */
(function () {
'use strict';

const LOGIN_URL = 'login.html';

// Если страница и так login — ничего не делаем
const path = (location.pathname || '').toLowerCase();
if (path.endsWith('/login.html') || path === '/login.html'
    || path.endsWith('login.html')) return;

function isFirebaseConfigured() {
  const c = window.FIREBASE_CONFIG;
  return c && typeof c.apiKey === 'string' && c.apiKey.length > 10 && c.projectId;
}

function relPathToLogin() {
  // Из любой подпапки (battery/, scs-config/, и т.п.) — относительный путь
  // к login.html в корне приложения. Считаем по количеству сегментов.
  const segs = (location.pathname || '/').split('/').filter(Boolean);
  // Убираем последний сегмент (имя файла), считаем подпапки
  const dirSegs = segs.slice(0, -1);
  // Проект может быть в корне домена (segs.length 0..1) или вложен.
  // Эвристика: ищем где находится 'shared/' — но проще:
  // используем относительный путь к самому себе через document.currentScript.
  try {
    const script = document.currentScript ||
      Array.from(document.scripts).find(s => /auth-gate\.js/i.test(s.src || ''));
    if (script && script.src) {
      const url = new URL(script.src);
      // shared/auth-gate.js → корень = parent папки 'shared'
      const m = url.pathname.match(/^(.*)\/shared\/auth-gate\.js$/i);
      if (m) {
        const root = m[1] || '/';
        return (root.endsWith('/') ? root : root + '/') + 'login.html';
      }
    }
  } catch {}
  // Fallback: подняться на 1 уровень
  return '../login.html';
}

function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  const url = relPathToLogin();
  location.replace(url + '?next=' + next);
}

function checkAuth() {
  const Auth = window.Auth;
  // Если Firebase не настроен — локальный режим, гард не активен
  if (!isFirebaseConfigured()) return;
  if (!Auth) {
    // Auth ещё не загружен — попробуем позже
    setTimeout(checkAuth, 200);
    return;
  }
  // Подождём ready (один auth state)
  Auth.ready().then(() => {
    if (!Auth.currentUser) {
      redirectToLogin();
    }
  });
  // Подписка на logout → редирект
  if (typeof Auth.onAuthChange === 'function') {
    Auth.onAuthChange(user => {
      if (!user && isFirebaseConfigured()) redirectToLogin();
    });
  }
}

// Init Auth и check
if (window.Auth && typeof window.Auth.init === 'function') {
  window.Auth.init();
  checkAuth();
} else {
  // Auth ещё не подгружен — попробуем после window.load
  window.addEventListener('DOMContentLoaded', () => {
    if (window.Auth && typeof window.Auth.init === 'function') {
      window.Auth.init();
    }
    checkAuth();
  });
}

})();
