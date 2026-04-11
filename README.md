# Raschet

Конструктор принципиальных схем электроснабжения. Собирается блок-схемой «источники → щиты → ИБП → потребители», автоматически считает нагрузку по активным цепям с учётом АВР по приоритетам, параллельной работы входов, резервных генераторов и КПД ИБП. Поддерживает режимы работы (аварии), вход через Gmail и совместное редактирование проектов.

## Запуск

Просто откройте `index.html` в браузере — всё работает без сборки.

В базовом (локальном) режиме проекты хранятся в `localStorage` браузера, без входа и без совместного доступа. Чтобы включить облачное хранение, вход по Gmail и шаринг — настройте Firebase (см. ниже).

## Возможности

**Редактор схем:**
- Палитра: источники, генераторы, щиты, ИБП, потребители
- Связи между портами с контролем циклов
- У щитов/ИБП/потребителей регулируется число входов и выходов
- АВР по приоритетам: равные значения работают параллельно и делят нагрузку
- Резервные генераторы: включаются, только когда основное питание недоступно
- ИБП: КПД, зарядный ток, ёмкость и заряд батареи, автономия при текущей нагрузке, переход на батарею при обесточке входа
- Линии под напряжением — красные, без напряжения — серые пунктирные
- Зелёные «лампочки» на активных входах многовходовых узлов
- Зум колесом / щипком, панорама, вмещение, кнопки тулбара
- Переключение связи: клик на линию → потянуть оранжевую рукоятку
- Режимы работы (сценарии аварий): переключатель в левой панели

**Проекты и совместный доступ:**
- Список «Мои проекты / Доступные мне / Запросы доступа»
- Создание, переименование, удаление проектов
- Поделиться по email: пользователь получает роль viewer или editor
- Видимость «Доступ ограничен» / «По ссылке» (любой с ссылкой может запросить)
- Запрос доступа → владелец одобряет или отклоняет
- Read-only режим для просмотра без редактирования
- Гости без входа могут только просматривать

**Мобильная вёрстка:**
- Канва на весь экран
- Боковые панели (палитра и инспектор) — выдвижные по нажатию на круглые кнопки внизу
- Пинч-зум, тач-драг узлов, тап-добавление элементов
- Безопасные отступы под «чёлку» iPhone

## Структура

```
raschet/
├── index.html              — оболочка приложения (шапка, экраны, модалки)
├── app.css                 — стили (включая responsive)
├── app.js                  — редактор схем (window.Raschet API)
├── firebase-config.js      — конфигурация Firebase (шаблон)
├── js/
│   ├── auth.js             — обёртка над Firebase Auth
│   ├── projects.js         — CRUD проектов (Local + Firestore адаптеры)
│   └── main.js             — роутинг экранов, проекты, шаринг
└── README.md
```

## Firebase setup

Необязательный шаг. Без него приложение работает локально — без входа и совместного доступа. После настройки появляется вход по Gmail, облачное хранение проектов и шаринг.

### 1. Создать проект Firebase

1. Откройте https://console.firebase.google.com
2. **Add project** → введите имя (например, `raschet`) → Continue → можно отключить Google Analytics → Create project

### 2. Включить Google-аутентификацию

1. В левом меню: **Build → Authentication → Get started**
2. Вкладка **Sign-in method**
3. Строка **Google** → Enable → укажите support email → **Save**

### 3. Создать Firestore Database

1. **Build → Firestore Database → Create database**
2. Выберите регион (например, `eur3` или `us-central`) → Next
3. **Start in production mode** → Create

### 4. Правила безопасности Firestore

Откройте вкладку **Rules** в Firestore и вставьте:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Каталог пользователей: каждый пишет только свою запись (email → uid)
    match /userIndex/{email} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.token.email == email;
    }

    // Проекты
    match /projects/{projectId} {
      // Читать может владелец, любой участник или (если видимость 'link') любой залогиненный
      allow read: if request.auth != null && (
        resource.data.ownerId == request.auth.uid
        || request.auth.uid in resource.data.memberUids
        || resource.data.visibility == 'link'
      );

      // Создавать может любой залогиненный, но только со своим ownerId
      allow create: if request.auth != null
        && request.resource.data.ownerId == request.auth.uid;

      // Обновлять: владелец — всё; редактор — только схему и updatedAt
      allow update: if request.auth != null && (
        resource.data.ownerId == request.auth.uid
        || (
          request.auth.uid in resource.data.memberUids
          && resource.data.members[request.auth.uid].role == 'editor'
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['scheme', 'updatedAt'])
        )
      );

      // Удалять — только владелец
      allow delete: if request.auth != null
        && resource.data.ownerId == request.auth.uid;
    }

    // Запросы доступа
    match /accessRequests/{reqId} {
      allow read: if request.auth != null && (
        resource.data.ownerId == request.auth.uid
        || resource.data.requesterUid == request.auth.uid
      );
      allow create: if request.auth != null
        && request.resource.data.requesterUid == request.auth.uid;
      allow delete: if request.auth != null
        && resource.data.ownerId == request.auth.uid;
    }
  }
}
```

Нажмите **Publish**.

### 5. Зарегистрировать веб-приложение

1. Project settings (шестерёнка сверху слева) → **General**
2. Секция **Your apps** → кнопка `</>` (Web)
3. Nickname: `raschet-web` → **Register app**
4. Скопируйте объект `firebaseConfig` — он выглядит так:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "raschet-xxx.firebaseapp.com",
  projectId: "raschet-xxx",
  storageBucket: "raschet-xxx.appspot.com",
  messagingSenderId: "123...",
  appId: "1:123...:web:abc..."
};
```

5. Откройте `firebase-config.js` в этом репозитории и подставьте значения в `window.FIREBASE_CONFIG`.

### 6. Разрешить ваш домен

1. **Authentication → Settings → Authorized domains**
2. Добавьте ваш домен (например, `daniil248.github.io`)
3. `localhost` добавлен по умолчанию — для локальной отладки

### 7. Закоммитить и запушить

После правки `firebase-config.js`:
```bash
git add firebase-config.js
git commit -m "chore: add firebase config"
git push
```

> Замечание по безопасности: API-ключ Firebase в клиентском коде — это нормально, он не даёт доступа сам по себе. Реальная защита — правила Firestore (см. шаг 4).

## Горячие клавиши

- `Del` / `Backspace` — удалить выбранный узел или связь
- `Esc` — отменить ведение связи
- `Shift` + клик по линии — быстрое удаление
- Клик по пустой области — панорама
- Колесо мыши — зум (сохраняет точку под курсором)

## Расчётная модель (кратко)

`recalc()` строит список входящих связей для каждого узла, затем для каждого потребителя рекурсивно определяет активные фидеры через `activeInputs(node, allowBackup)`:

1. Входы группируются по значению приоритета.
2. Ищется первая группа (по возрастанию), в которой есть хотя бы один upstream, запитанный без привлечения резервных генераторов. Внутри группы параллельные фидеры делят нагрузку поровну.
3. Если не нашли — второй проход с `allowBackup=true` разрешает резервные генераторы и батарею ИБП.
4. Демэнд потребителя распространяется вверх по выбранным связям. На границе ИБП поток умножается на `1/КПД`, плюс добавляется зарядный ток (если ИБП питается от входа, а не от батареи).

Источник помечается перегрузом, если суммарная нагрузка превышает его мощность.

## Развёртывание на GitHub Pages

1. https://github.com/daniil248/raschet/settings/pages
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `(root)` → **Save**
4. Через ~1 минуту будет доступно на https://daniil248.github.io/raschet/
5. Не забудьте добавить этот домен в Authorized domains в Firebase (если настраивали его).
