// =============================================================================
// Firebase config — чтобы включить вход по Gmail и облачное хранение проектов.
// -----------------------------------------------------------------------------
// Без заполнения этого файла приложение всё равно работает — в локальном режиме
// (вход отключён, проекты лежат в localStorage браузера, нет совместного доступа).
//
// Как включить облачный режим:
//   1. Создайте проект на https://console.firebase.google.com
//   2. В нём: Authentication → Sign-in method → Google → Enable
//   3. Build → Firestore Database → Create database → Start in production mode
//   4. Правила Firestore скопируйте из README.md (раздел "Firebase setup")
//   5. Project settings (шестерёнка) → General → "Your apps" → Web app → </>
//      Зарегистрируйте веб-приложение, скопируйте firebaseConfig сюда:
//   6. Authentication → Settings → Authorized domains → добавьте адрес
//      вашего GitHub Pages (например, daniil248.github.io)
// =============================================================================

window.FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
