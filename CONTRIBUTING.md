# CONTRIBUTING — GE Tools

Платформа: vanilla-JS, **zero-build**, сырые ES-модули, GitHub Pages
(deploy = push в `main`). Архитектура — Ядро + независимые модули по
контрактам. Перед работой прочитать `shared/contracts/README.md`
(шов, 5 слоёв, закон импортов) и мастер-план
`C:\Users\sedko\.claude\plans\dapper-munching-petal.md`.

## 1. Границы (обязательно)
- Соблюдать закон импортов (`contracts/README.md` §3): модуль →
  CORE/SHARED/CATALOGS; **никаких** относительных импортов в соседний
  модуль; **никаких** сырых чужих `localStorage`-ключей.
- Кросс-модульное общение — только через 5 каналов: `project-storage`
  / `configuration-catalog` / `module-nav` / DOM-события / объявленный
  `shared/<module>-bridge.js`. См. `storage-keys.md`,
  `cross-module-events.md`, `url-params.md`.
- Новый кросс-канал (LS-ключ / событие / URL-параметр) → добавить в
  соответствующий контракт-док + в `<module>/manifest.json` обеих
  сторон.

## 2. Branch-per-module
- Ветка `mod/<module-id>` на изменение модуля; затрагиваешь несколько
  — обоснуй в PR.
- У каждого зарегистрированного модуля ОБЯЗАТЕЛЕН `<module>/
  manifest.json` (схема `shared/contracts/README.md` §6; для
  constructor — корневой `manifest.json`). Корневой `modules.json` —
  проекция манифестов; сверяется `node tools/gen-modules-json.mjs
  --check` (CI). Менять реестр — через manifest, не правкой
  modules.json вручную.
- Изменение модуля = bump `version` в `<module>/manifest.json` +
  запись в `shared/module-changelogs.js` (массив `engine`, новое
  сверху, `{version,date,items}`).
- Пользовательски-видимое изменение = bump `APP_VERSION`
  (`js/engine/constants.js`) + синк строки «Статус» в `ROADMAP.md`.
- Hotfix-ы (регрессии, мелкий UX) в роадмап НЕ добавляются — только
  содержательная функциональность; пункт поднимать из
  `ROADMAP-archive.md` в активный `ROADMAP.md` при взятии в работу.

## 3. Lint-гейт (вводится Фазой 0)
- `node tools/boundary-lint.mjs` должен быть зелёным (с учётом
  `shared/contracts/lint-allowlist.json`). Новые нарушения границ
  допускаются ТОЛЬКО с тикетом X.1.3 и записью в allowlist.
- `node tools/gen-modules-json.mjs --check` (Фаза 1): корневой
  `modules.json` согласован с `<module>/manifest.json`.
- CI `.github/workflows/contracts.yml` запускает оба (сначала
  не-блокирующе → затем блокирующе). Workflow НЕ подменяет публикацию
  GitHub Pages (deploy-from-branch остаётся).

## 4. Конвенции кода (зафиксированы)
- Без браузерных диалогов (`alert/confirm/prompt`) — только in-page UI
  (toast/inline-modal: `dialog.js` / `scToast`-паттерн).
- В коде/коммитах/доках — «Пользователь», НЕ «Юзер».
- Каждый UI-параметр имеет hover-tooltip (`title`) с расшифровкой.
- Справочные данные — только в каталогах (`shared/catalogs/*`,
  `catalog/`), не хардкодом в модуле.
- Все отчёты/экспорт — только через модуль `reports/` (blocks[] +
  шаблоны), без прямого `window.open`+HTML.
- Пользовательские параметры sacred: не авто-сбрасывать; миграции с
  `typeof !== 'number'`-guard; apply-хендлеры preserve-on-miss.
- Изменяемые данные → history-log (append-only) + soft-delete; жёсткое
  удаление только из корзины.

## 5. i18n-готовность (сейчас не делаем, но соблюдаем)
- Каждая новая/правимая UI-строка **изолируема**: один строковый
  литерал, без конкатенации с разметкой/значениями — чтобы будущий
  codemod извлёк в каталог. boundary-lint WARN на новую кириллицу в
  diff (не блок).
- Числа/даты/валюта/единицы — через `shared/money.js` (будет расширен
  `fmtNumber/fmtDate/fmtUnit`), не ручное форматирование.

## 6. Verify (каждый PR)
1. `node tools/boundary-lint.mjs` → 0 ошибок.
2. Deploy = merge в `main`; через ~45 c:
   `curl -s https://daniil248.github.io/ge-tools/js/engine/constants.js
   | grep APP_VERSION` — версия совпала с ожидаемой.
3. Открыть затронутый модуль + `projects/` + один cross-handoff в
   браузере (Claude-in-Chrome), `read_console` onlyErrors — пусто.
   ⚠ Проверять ТОЛЬКО естественной загрузкой собственной страницы
   модуля (`navigate` на `apps/<id>/index.html`). НЕ зондировать
   `import('../<other>/<other>.js?cb=')` из чужой страницы:
   entry-скрипты авто-запускают `init()/wire()` против DOM текущей
   страницы → ложные `Cannot set … of null` / `Failed to fetch`
   (артефакт зонда, НЕ регрессия). Перед чтением — `clear:true` +
   1 reload, иначе ловишь старые накопленные/probe-сообщения.
4. Project round-trip: создать/открыть проект, выполнить основной
   сценарий модуля, handoff — без регрессий и без потери данных.
- Известный нюанс: не-версионные модули кэшируются ~10 мин
  (edge-кэш Fastly Pages, ключ = URL; разные PoP расходятся не
  синхронно). Доверять curl развёрнутого исходника + cache-busted
  `import('…?cb=')`, НЕ кэшу/`fetch` вкладки (даже `{cache:'reload'}`
  бьёт тот же закэшированный edge-объект).

### 6a. Cache-safe: новый export в unversioned shared-модуле
**Опасность (zero-build):** добавить новый `export` в существующий
`shared/*.js` И в том же деплое начать его статически импортировать
из модуля → в окне edge-кэша клиент может получить **новый
потребитель + старый shared** → `SyntaxError: does not provide an
export named …` (жёсткий, рушит весь модуль; статический `import`
нельзя сделать «мягким»). Shim спасает только при ПЕРЕМЕЩЕНИИ файла,
не при добавлении export в существующий.
**Правило:** разносить на ДВА деплоя —
1. деплой A: только добавить `export` в shared (потребители ещё не
   импортируют) → дождаться распространения (`curl` без cb на голом
   URL отдаёт новый символ);
2. деплой B: перевести потребителей на новый символ.
Либо: одним деплоем, но осознанно принять кратковременный
self-healing-сбой у части клиентов (только для низкого риска).

## 7. Rollback
- Ветка не влита → revert ветки.
- При calc/ui-сплите модуля старое имя файла остаётся **shim**
  (`export * from './calc/...'`) — старые относительные импорты
  продолжают резолвиться; shim не удалять, пока есть импортёры.
- Per-file revert для точечных правок; данные — миграция/soft-delete,
  не жёсткое удаление.
