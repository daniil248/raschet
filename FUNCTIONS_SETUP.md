# Cloud Functions — email-нотификации (Collaboration C.9)

Раздел для администратора, разворачивающего проект в Firebase.
Клиентское приложение продолжает работать без этих функций — письма
просто не будут уходить.

## Что делают функции

Каталог `functions/` содержит два Firestore-триггера:

1. **onAccessRequestCreated** — при появлении документа в
   `accessRequests/` пишет задание в коллекцию `mail/` (письмо
   владельцу проекта: «X запросил доступ к …»).
2. **onProjectMemberAdded** — при добавлении нового uid в
   `members.{uid}` документа `projects/{id}` пишет письмо этому
   пользователю («Вам открыт доступ…»).

Сами письма отправляются расширением **Trigger Email**
(`firebase/firestore-send-email`), которое читает из `mail/` и
отсылает через настроенный SMTP. Это избавляет Functions от
хранения секретов.

## Установка

1. **Firebase CLI + init** (если ещё не сделано):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add      # выбрать проект
   ```
   CLI создаст `.firebaserc` с нужным projectId.

2. **Установить зависимости функций**:
   ```bash
   cd functions
   npm install
   cd ..
   ```

3. **Задать URL приложения** (если отличается от
   `https://daniil248.github.io/raschet/`):
   ```bash
   firebase functions:config:set app.url="https://your-domain/raschet/"
   ```
   Либо задать `APP_URL` в env переменных функции (gen2 env).

4. **Развернуть функции**:
   ```bash
   firebase deploy --only functions
   ```

5. **Установить Trigger Email extension**:
   - В Firebase Console → Extensions → `Trigger Email from Firestore`.
   - Коллекцию оставить по умолчанию: `mail`.
   - Указать SMTP URL вида
     `smtps://username:password@smtp.provider.com:465` или
     использовать SendGrid/Mailgun по документации extension.
   - Указать адрес «From» (совпадает с аутентификацией SMTP).

6. **Опционально — коллекция `users/`**: если вы храните метаданные
   пользователей (email, name) в `users/{uid}`, триггер сможет найти
   email владельца проекта для случая, когда в самом проекте нет
   `ownerEmail`. Можно создать триггер `onAuthUserCreate` —
   не входит в этот scaffold.

## Диагностика

- Логи функций: `firebase functions:log`
- Тест запроса: создать документ `accessRequests/` вручную в консоли
  Firestore, проверить появление документа в `mail/`.
- Если в `mail/` появляется документ, но письмо не уходит — проблема
  в SMTP extension, проверьте его логи в Console → Extensions.

## Замечания по безопасности

- Коллекция `mail/` должна быть закрыта правилами Firestore:
  читать-писать только Cloud Functions (service account). Пример:
  ```
  match /mail/{doc} { allow read, write: if false; }
  ```
  (Admin SDK обходит правила и функции продолжат работать.)
- `accessRequests/` должна разрешать create залогиненному
  пользователю и чтение/удаление владельцу проекта.
