# GE Tools — Роадмап (10 разделов, переработан)

> **Продукт:** Genesis Engineering Tools (GE Tools) — набор инженерных
> и управленческих модулей/инструментов на общей платформе (Конструктор
> схем — один из модулей, не весь продукт). Прежнее имя «Raschet» —
> историческое; LS-неймспейс мигрирован (`APP_NS='getools'`, RENAME.md).
> Репозиторий переименован `daniil248/raschet`→`daniil248/ge-tools`,
> live `https://daniil248.github.io/ge-tools/` (v0.60.746, ВЫПОЛНЕНО).
>
> **Статус:** v0.60.774 (2026-05-18). Платформа + предметные модули.
> Прод: https://getools.netchess.ru (Timeweb VPS, бэкенд+Postgres),
> двойной деплой git+сервер. GitHub Pages — пока тоже жив.
> Мультидисциплинарность (X.4.5.3 Вариант I) —
> завершена ПОЛНОСТЬЮ (Ф-A…Ф-G). Архитектурная модуляризация (фазы
> 0–2 плана) — закрыта. Модуль отчётов (flow-редизайн) — закрыт.
> Активные крупные направления: предметные модули, отделяемый
> продукт, чертёжный вывод, коммерция/Auth, новые дисциплины.

## 1. Обзор и как читать
- **10 разделов** (1 обзор + 9 предметных). Каждый: «✅ Сделано —
  ключевое» (сжатая история, детали — в коммитах/`changelog.html`/
  архиве) + «🔲 Открыто» (1 строка/пункт + `arch:`-ссылка в архив).
- Правила ведения: фазы числовые; статус-хедер ↔ APP_VERSION каждый
  коммит; без дублей; **hotfix/regression — НЕ в роадмап** (только
  changelog+bump); новый пункт — в существующий раздел рядом по теме.
- Гранулярный backlog (~287 `[ ]`) и полная история заморожены в
  **[ROADMAP-archive.md](ROADMAP-archive.md)** (не редактируется);
  поднимать пункт сюда при взятии в работу. Мастер-план разделения —
  `C:\Users\sedko\.claude\plans\dapper-munching-petal.md`.
- Мелкая UX-полировка / точечные баги — в **[TODO.md](TODO.md)**.

### Карта переноса архив → разделы (no-loss)
| Архив (фазы) | → Раздел |
|---|---|
| 16, 15, 1.28.6/8, 1.21.2, 6 | 2. Ядро |
| 1.2.2, selection-model, history-log, reports-via-reports, catalogs, price-alerts, 7 (DB-adapter) | 3. Платформа |
| 43, 7 (manifest), 17.4, importmap, structure-canon | 4. Архитектура |
| 1.24/1.25/1.26 (СКС), 22/25 (cooling), 10 (МЦОД), 21.2, 13 (rack-fill), 32/42 (service), 47.x/30/36 (технолог), 19 (пресеты), 1.27 | 5. Модули |
| 47.4.2/3, 12 (HVAC/PUE), 2.B-H (новые дисц.), 11 (АГПТ), 2.X (дисц-as-modules) | 6. Мультидисциплина |
| 3 (drawio), 14 (план ЕСКД), 29 (слот-доки), 9 (Revit/IFC), 4 (3D) | 7. Чертёж/CAD |
| 17.1-17.7, 34, 35, 40, 37, 33, 26, 27, 1.27/1.28 (POR) | 8. Хранение/продукт |
| 44, 5 (Auth), 2.X.1, 41 (организация), X.3 (i18n) | 9. Коммерция/Auth |
| 28 (shell), 8 (presale), 38/39 (PM/LCM), 18.4 (логист) | 10. Бэклог |
| ✅-фазы 45/46/1.28.21/20/23/24/30/36/47.1-3/0/1(EL) | история — только архив |

---

## 2. Ядро (CORE — `js/engine/*`, `js/calc/*`)
Расчётно-графическая платформа Конструктора. Владеет `APP_VERSION`,
импортирует только себя (calc-lib — нативно, см. §4 D2).

**✅ Сделано — ключевое**
- D1 закреплён: ядро = только `js/engine/*`; электрика и методы —
  класс CALC-LIB (`lib/*`/`js/calc`), не ядро (v0.60.599).
- Multi-discipline ядро: `scheme.discipline` + дисциплина-aware гейт
  (v0.60.513); страница = типизированная схема (X.4.5.3 §6).
- Паспорт/ручные габариты оборудования (v0.60.514–519).

**🔲 Открыто**
- [ ] **2.1** Длина кабеля по физ-маршруту (port→exit→trace→mirror,
  изгибы, endpoints wall/standalone). `arch:Фаза 16` memory:cable_length
- [ ] **2.2** Двух-полевая мощность стойки (powerAvgKw/powerMaxKw)
  — модель ядра. `arch:Фаза 15.1` memory:rack_power
- [ ] **2.3** POR-residual: domain-scoped locks (1.28.6) + миграция
  модулей на DataAdapter contract (1.28.8). `arch:Фаза 1.28`
- [ ] **2.4** Произвольные концы связей (port↔port вне щитов). `arch:Фаза 1.21.2`
- [ ] **2.5** Тепловой расчёт щита + climate recommendation. `arch:Фаза 6`

## 3. Платформа / Shared-контракты (`shared/*`)
Шов платформы: контракты, каталоги, отчёты, история, selection-model.

**✅ Сделано — ключевое**
- Контракт-доки + `boundary-lint.mjs` + `audit-contracts.py` +
  `changelog-lint.py` + CI (`contracts.yml`) — Фаза 0.
- `history-log.js` платформенно (append-only + soft-delete/trash,
  full API); остаётся per-module UI «📜 История». memory:data_history
- Все отчёты только через `reports/` (blocks API): 4 direct-HTML
  анти-паттерна мигрированы (v0.60.562–565). memory:reports_via_module
- Справочные данные только в каталогах (`WORK_TEMPLATES`→catalog,
  v0.60.36). memory:use_catalogs
- i18n-инфра `shared/i18n/` + `t()` + `money` fmt (v0.60.567, no-op
  без каталогов; извлечение — §9).

**🔲 Открыто**
- [ ] **3.1** Унифицированная selection-model — добить охват модулей
  (`selection-panel.js`). memory:selection_model
- [ ] **3.2** Element-Library API (внутр. реализация каталогов). `arch:Фаза 1.2.2`
- [ ] **3.3** DB adapter pattern (Firebase/LS/SQL stubs). `arch:Фаза 7.3`
- [ ] **3.4** Панель алертов устаревших цен (опц.). `arch:price-alerts`

## 4. Архитектура и модуляризация (governance)
Закон импортов, манифесты, границы, физ-структура, calc/ui.

**✅ Сделано — ключевое**
- D1/D2: ядро vs calc-lib; calc-lib импортируется нативно любым
  слоём (запреты бьют только `tgt==='module'`), v0.60.599.
- Границы упрочнены: жёсткие R1/R3/R4/R-shared погашены (`allow:[]`),
  R2 (сырой foreign per-project LS) закрыт полностью через шов
  `projectKey`/`projectLoad`/`projectSave` (модули+бриджи+финал
  `projects/project.js` v0.60.714–720). `audit-contracts --strict`=0.
- Manifest по всем 33 модулям + `gen-modules-json.mjs` (modules.json
  v1.3.2, паритет 0) + `audit-manifest.py`; `requires` честны.
- Importmap-развязка + физ-переезд: 25 UI→`apps/`, calc-lib→`lib/`
  (v0.60.546–549); bare-спецификаторы, переезд = правка одной карты.
- calc/ui-нормализация: выделены `calc/`-слои в 6 модулях
  (transformer/ups/rack-config/scs-config/scs-design/tech-workspace,
  v0.60.532–537); псевдо-монолиты уже DOM-free (аудит v0.60.566).
- Структура-канон: `ARCHITECTURE.md` + 29 README (v0.60.527).

**🔲 Открыто**
- [ ] **4.1** Owner-board UI: назначить реальных владельцев в
  манифестах (орг-решение) → расширить проекцию генератора (`owner`)
  → chip в `/modules/`. Сейчас все `unassigned` — ценность нулевая. `arch:43.5`
- [ ] **4.2** Genuine calc+DOM монолиты (фокус-инкременты, по одному):
  `battery`, `panel-config`, `mdc-config`. `arch:Фаза 4`
- [ ] **4.3** (будущее) git submodules / pnpm-workspace. `arch:43-Etap3`

## 5. Предметные модули
Каждый — own index.html, импорт только CORE/SHARED/CATALOGS, общение
через контракты. Открытые эпики (детали — архив):

| Модуль | 🔲 Открытые эпики (`arch:`) |
|---|---|
| **constructor** | drawio canvas↔sheet, ISO-штамп `Фаза 3`; пресеты карточек ✅(Фаза 19) |
| **tech-workspace** | 47.3.2 Конструктор в project-mode; сквозной sync концепция↔схема `30,36.3`; задел §10 технолог-ГИП lifecycle/SPATIAL-BASE (движок — буд. фаза) |
| **scs-config** | 1.24.x (многопорт-каталог, ATS, внешние порты, авто-трасса/питание, телеком-отчёт); 1.26.2.a шаблоны vs реальные стойки `1.24,1.26` |
| **scs-design** | межстоечный СКС: план-вью, port↔port, BOM, экспорт SVG/PDF, лотки, связь с гл.схемой `1.25,1.26.4` |
| **rack-config** | rackInstance-схема+миграция, привязка power-вводов, эл.BOM по PDU, авто-расстановка `1.24.22-26,15` |
| **cooling** | 22.10.1 вариант=комплекс; 22.14 copy&customize подборов; импорт даташитов residual `22,25` |
| **mdc-config** | экспорт по шаблону 26003-SCO-001, BOM→гл.схема, авто-расстановка кондиционеров `10.4-10.6` |
| **meteo** | доп.источники (plugin) `21.2` |
| **suppression-config** | АГПТ residual (3D three.js отложен) `11` |
| **service** | учётные № нарядов + каталог материалов `32`; **мастер составления нарядов** (data-driven `service/catalog/wizards/`) `42` |
| **logistics** | маршрутизация (опц.) `18.4` |
| **reports** | приём blocks[] от модулей; слот-доки `29` (база закрыта, см. §7) |
| **projects** | 1.27 residual; «Модули проекта» UI по подписке `2.X.3` |
| **rack-fill** | детальные параметры устройств наполнения (питание/IPAM/тепло/инспектор/POR) `Фаза 13` |
| ups/battery/panel/mv/transformer/genset/pdu/cable | стабильны; ручные габариты/паспорт ✅; residual — архив |

**✅ Сделано — ключевое**: МЦОД GDM-600 в проде (Фаза 10); Cooling-
подбор + импорт даташитов (Фаза 22/25); Сервис монтаж/ТО в проде
(Фаза 24); Технолог 47.1–47.3 + План зала (v0.60.505–517);
unified project picker / sidebar-аккордеон / column-filters /
cross-filter / tooltips / zoom Ctrl+wheel — платформенно.

## 6. Мультидисциплинарность (X.4.5)
Конструктор — общая ОБОЛОЧКА всех схем; разные непересекающиеся
контекст-палитры под дисциплину.

**✅ Сделано — ключевое**
- Расчётные движки calc-lib: hydraulic / hvac / gas (v0.60.570–576);
  + suppression / electrical. Контракт `{META,compute}`/`run()`.
- D4/D5 мультинорма по ВСЕМ calc-libs: метод = файл + picker,
  META `region/version/enabled`, реестр `_ALL`+фильтр; РФ + КЗ
  (СН/СП РК) + ISO/IEC/NFPA (v0.60.587–598).
- Cross-discipline: контракт `disciplines.js` + `node.disciplines[]`
  + UI назначения/роутинг (projects-view) + авто-форма `META.inputs[]`
  + сводный отчёт через `cross-discipline.js`→reports (v0.60.577–583).
- **X.4.5.3 Вариант I ЗАВЕРШЁН ПОЛНОСТЬЮ** (v0.60.722–739): спека
  `schema-constructor-architecture.md`; Ф-A pageDiscipline · Ф-B
  page.discipline+мастер+🔒read-only · Ф-C контекст по active-page ·
  Ф-D дисципл-RBAC · Ф-E реестр объектов+порт-видимость+деривация ·
  Ф-F СКС в оболочку (бейдж/аккордеон/role-gate/отчёт reports) ·
  Ф-G агрегация BOM по всем дисциплинам в технологе.

**🔲 Открыто**
- [ ] **6.1** Новые дисциплин-модули: cctv/accessctrl/fire-alarm/
  paging (слаботочка), scada/field-instrumentation (АСУ ТП),
  вентиляция, спринклеры/дымоудаление, floor-plan, structural-load. `arch:Фаза 2,12`
- [~] **6.2 Матрица ответственности разделов (ГИП).** Запрос
  Пользователя: ГИП указывает по дисциплине/разделу — разрабатываем
  у нас (`own`) / внешняя разработка (`external`, у нас только
  ключевые требования read-only: мощность, подключение к сети,
  расстановка) / частично наше (`partial`, oursNote — что именно
  наше). A ✅ (v0.60.764: `sectionScopes` модель + `SECTION_SCOPE_
  MODES`/`getSectionScope`/`setSectionScope`/`listSectionScopes`,
  аддитивно, отсутствие=own, exports-only cache-safe). B ✅
  (v0.60.765: секция «🧭 Ответственность по разделам» во вкладке
  «Сводка ГИП» — селектор режима + поля требований по 6 разделам,
  гейт owner/gip/admin). C (позже) — бейдж режима на разделах/слим-
  карточке + read-only enforcement в модулях (баннер требований).
  Coordinated revisions (согласование разделов) — отдельно. `arch:2.X.2,2.X.4`
- [ ] **6.3** §10 SPATIAL-BASE: движок пространства (стены/площади/
  пространства, BIM-federated подложка) + lifecycle-машина
  технолог-ГИП (до сдачи; далее модуль O&M). memory:architecture_layers D7/D8

## 7. Чертёжный вывод / CAD / 3D
**✅ Сделано — ключевое**
- Модуль отчётов закрыт ПОЛНОСТЬЮ: единый flow-документ
  (`flow[]`/`floating[]`), редактор WYSIWYG=PDF, правка из превью,
  общий `composeReport` для всех отчётов, Word-разделы (обложка/
  landscape/sectionBreak)+DOCX мульти-Section (v0.60.651–705). `arch:Фаза 29`

**🔲 Открыто**
- [ ] **7.1** drawio-режим (canvas↔sheet, ISO 7200 штамп, авто-layout). `arch:Фаза 3`
- [ ] **7.2** План зала ЕСКД/ISO scale + читаемые подписи + стены/
  трассы/фитинги + 2D/3D-виды. `arch:Фаза 14`
- [ ] **7.3** Revit/IFC импорт-экспорт (нужен back-end). `arch:Фаза 9`
- [ ] **7.4** 3D-интеграция configurator3d (2D↔3D sync, split-view,
  фасады). `arch:Фаза 4`

## 8. Хранение / отделяемый продукт / интеграции
**✅ Сделано — ключевое**
- project-storage seam: корень LS-ns = одна `APP_NS`; `RENAME.md`
  плейбук (v0.60.552).
- FS-транспорт частично: `showDirectoryPicker` + handle в IDB +
  авто-запись + in-page статус (v0.60.554).

**🔲 Открыто**
- [x] **8.0 Модель «Проект › Конфигурация › Вариант» ✅ ЗАВЕРШЕНО** (v0.60.763). Discovery
  2026-05-18 → спека [`thoughts/shared/specs/2026-05-18-project-
  configuration-variant-model.md`](thoughts/shared/specs/2026-05-18-project-configuration-variant-model.md).
  Канон: **Проект** = объект/комплекс (мультидисц., полная карточка)
  или 1-дисциплинарный (слим+свои мини-реквизиты); **Конфигурация** =
  одна дисциплина внутри проекта (слим-карточка, объект-props
  read-only от родителя); **Вариант** = альтернатива внутри
  конфигурации (★/🔁). Тип immutable, выбор при создании.
  ✅ Сделано: рассогласование namespace scs↔scs (`?project=`-шов
  v0.60.751); релейбл «под-проект…»→«вариант» (v0.60.752–753);
  8.0-A variantRole selected/reserve API+UI (v0.60.754–755); 8.0-B
  variant-aware picker (v0.60.756–757). ❌ **Отклонено: деструктивное
  слияние namespace (бывш. 8.0-C)** — миграция = только тип/UI, без
  переноса данных (риск живым данным, ≈0 выгоды).
  🔲 Остаток (поэтапно, по 1 деплою+verify, спек FR):
  - **8.0-D FR1** ✅ (v0.60.760) аддитивное `entityKind` (object|
    discipline) + хелперы `entityKindOf`/`isConfiguration`/
    `isDisciplineProject`/`isSlimEntity`/`projectDisciplineOf` +
    инференс legacy; exports-only (cache-safe деплой 1/N).
  - **8.0-E FR2** ✅ (v0.60.761) условный рендер: для слим-сущности
    скрыты вкладки summary/approvals/modules/team/plan; остаются
    general/equipment/validation/economics/actions; авто-переход на
    «Общее» если активна скрытая. DOM-уровень, реверсивно.
  - **8.0-F FR3** ✅ (v0.60.762) объект-props слим: конфигурация —
    read-only сводка от родителя + ссылка на карточку объекта;
    1-дисц.проект — свои мини-реквизиты; без категории/дерейтинга/ГИП.
  - **8.0-G FR4/FR5** ✅ (v0.60.763) создание с явным выбором типа
    (prChooseProjectType: 📦 Объект | 🧩 Одна дисциплина+дисц.,
    immutable) + тип-бейдж в шапке карточки (заменил «Мини-проект»).
  - **8.0-H FR6** ✅ (v0.60.763) идемпотентный type-инференс legacy
    через read-time `entityKindOf` (sketch+parent ⇒ конфигурация ⇒
    слим-карточка автоматически), БЕЗ переноса данных/namespace.
  memory:selection_model,module_scope_pickers `arch:1.27,17.1`
- [~] **8.0.1 Self-host на Timeweb VPS + уход от Firebase** (решение
  Пользователя 2026-05-18; **двойной деплой git+сервер ОБЯЗАТЕЛЕН**,
  memory:dual_deploy_server). VPS · nginx · PostgreSQL · Node ·
  systemd · TLS. Подготовлено (kit, exec — при первом SSH):
  `tools/deploy.sh` (git push + rsync в `getools/`, без рассинхрона);
  `DEPLOY-SERVER.md` (runbook провижининга + фазы миграции);
  `server/` (Express+pg+JWT+nodemailer скелет: /api/auth · /kv —
  зеркало project-storage · /projects · /mail) + `db/schema.sql`
  (Postgres JSONB); `.gitignore`-защита секретов, `server-access.env`
  ВНЕ репо. ✅ **РАЗВЁРНУТО (v0.60.768): https://getools.netchess.ru**
  живой — статика+бэкенд+Postgres+TLS, чужие проекты не тронуты,
  двойной деплой git+сервер активен. ✅ C1 backend-сейм (v769) ·
  ✅ C3 данные→серверный Postgres (v770, server-режим gated, API
  доказан e2e). Остаток: C2 auth — рекоменд. авторизовать домен
  getools.netchess.ru в Firebase (Firebase НЕ удаляем; ноль кода/
  риска) ИЛИ серверный логин (чип уже есть, /api/auth работает);
  email (SMTP) — позже. Прежний план C1–C4: Firestore→
  Postgres импорт + клиентский транспорт project-storage→HTTP `/kv`;
  Firebase Auth→/api/auth (+Google OAuth); Cloud Functions→SMTP;
  согласованный клиентский cutover. `arch:17.2,17.3,40`
- [ ] **8.1** FS-as-primary за async-интерфейсом project-storage
  (load/save/list/remove), фолбэк LS, не ломая sync-seam. `arch:17.2,34`
- [ ] **8.2** HTTP/IDB-транспорты; большие датасеты LS→IndexedDB. `arch:17.2,Фаза 34`
- [ ] **8.3** Schema-versioned JSON контракт всех типов данных. `arch:17.1`
- [ ] **8.4** Standalone SPA «Управление объектом» (свой деплой,
  API); обновляемость модулей (semver/CI); модульная лицензия;
  жизненный цикл проект→объект (2-сторон. sync). `arch:17.3-17.6`
- [ ] **8.5** Cloud-синхронизация всех данных проекта. `arch:Фаза 40`
- [ ] **8.6** CDE по ISO 19650. `arch:Фаза 37`
- [ ] **8.7** Интеграции: 1С (УНФ/БП/УТ), SharePoint, MS365-авторизация. `arch:Фаза 33,26,27`
- [ ] **8.8** Кандидаты на отделение: ЗИП/склад, ТО/инциденты,
  энергомониторинг, мобильный companion, SNMP/BACnet/Modbus. `arch:17.7`

## 9. Коммерция / Auth / Организация / i18n
**✅ Сделано — ключевое**
- Subscription-инфра: модуль=SKU, kind ui/calc-lib, 5 планов,
  soft-enforcement, триал 14д (`subscriptions.js`, Фаза 44.1–44.3).
  memory:subscription_per_module
- RBAC 4 роли + permissions guard (disabled+tooltip); internal-only
  модули (projects/reports/logistics). memory:role_based_access,internal_modules
- **Мультироль участника ПРОЕКТА** ✅ (v0.60.748): несколько дисциплин
  на участника (чекбоксы); `role`=Firestore-уровень (editor/viewer)
  выводится, rules не менялись. Standalone = подписка/глоб.уровень.
- i18n-инфра готова (X.3.1, см. §3).

**🔲 Открыто**
- [x] **9.0 ⭐** Тестовый доступ к выбранным модулям + связанным ✅
  ЗАВЕРШЕНО (v0.60.749 B1 API-шов · v0.60.750 B2 UI в global-settings):
  чекбокс-список UI-модулей → `setTesterModules` (subscription.modules
  allowlist + связанные UI из manifest.requires + calc-libs авто);
  аддитивно поверх плана; для не-internal. `arch:44.6`
- [ ] **9.1** Платежи (Stripe/ЮKassa)+webhook+server-валидация+ключи. `arch:44.4`
- [ ] **9.2** Trial-flow (email-напоминания, авто-rollback, upsell). `arch:44.5`
- [ ] **9.3** Per-module SKU UI (выбор 3–5 модулей, bundle, B2B per-seat). `arch:44.6`
- [ ] **9.4** Email/password reg UI; user-roles в Firestore; admin-UI;
  tariff-configurator. `arch:Фаза 5`
- [ ] **9.5** Организация: мульти-пользователь, общие каталоги/
  шаблоны, cascade-resolvers, multi-org switcher. `arch:Фаза 41`
- [ ] **9.6** Org-уровневые БАЗОВЫЕ шаблоны отчётов (promote-to-org,
  гейт по роли; решение Пользователя 2026-05-17). `arch:44`
- [ ] **9.7** i18n-извлечение: codemod литералы→ru-каталоги,
  en-заглушки, переключатель локали. `arch:X.3.2`

## 10. Бэклог / прочее
- [ ] **10.1** Единый shell конфигураторов (`cl-*/sv-*`→`rs-cfg-*`). `arch:Фаза 28`
- [ ] **10.2** Пресейлс/КП модуль `presale/`. `arch:Фаза 8`
- [ ] **10.3** Рабочее место логиста — маршрутизация. `arch:Фаза 18.4`
- [ ] **10.4** Project Management/Planning + LCM — residual. `arch:Фаза 38,39`

> Не нашли пункт в активном плане — он жив в **ROADMAP-archive.md**;
> поднять сюда в нужный раздел при взятии в работу.
