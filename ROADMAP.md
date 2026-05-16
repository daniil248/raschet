# Raschet — Роадмап (модуль-ориентированный, сжатый)

> **Статус:** v0.60.544 (2026-05-16). Текущий приоритет — **архитектурная
> модуляризация**: Фаза 0 ✅, Фаза 1 ✅, Фаза 2 — allowlist жёстких
> нарушений **погашен полностью (7→0)** (#1–#6). Структура-канон
> (X.1.4): `ARCHITECTURE.md` + 29 README + `audit-manifest.py` ✅;
> реестр полон + manifest честен (modules.json v1.3.2, audit зелёный).
> `dgu-config`→`genset-config`. Дробление монолитов **завершено для
> всей очереди**: calc/ui выделен в `transformer-config/calc/tx-select.js`
> (пилот) + `ups-config/calc/ups-sizing.js` + `rack-config/calc/rack-power.js`
> + `scs-config/calc/rack-slots.js` + `scs-design/calc/cable-route.js`
> + `tech-workspace/calc/concept-loads.js` (финал).
> Осталось (R2, advisory): projects/project.js (15+ чужих LS) +
> упрочнение `*-bridge.js` через project-storage.
> Прошлый детальный роадмап (~4570 строк, ~287 открытых пунктов) заморожен
> целиком в **[ROADMAP-archive.md](ROADMAP-archive.md)** — ничего не
> потеряно; здесь — компактный активный план, ссылки на архив по `arch:Фаза N`.

## Как читать
- Структура: **0 Ядро · 1 Shared-контракты · 2 Модули · X Cross-cutting**.
- Каждый пункт — 1 строка + ссылка на детали в архиве (`arch:…`).
- Правила ведения (из memory): фазы числовые; status-header синкается
  каждый коммит; без дублей; hotfix-ы НЕ в роадмап; новый пункт — в
  существующую секцию, если тема рядом.
- Гранулярный backlog (287 `[ ]`) живёт в архиве — НЕ дублировать сюда,
  поднимать в активный план по мере взятия в работу.

---

## Архитектурный план (мастер) → `dapper-munching-petal.md`
Полный план разделения (5 слоёв, закон импортов, boundary-lint,
manifest-схема, фазы 0–6, i18n-готовность) — в плане
`C:\Users\sedko\.claude\plans\dapper-munching-petal.md`. Роадмап ниже —
его проекция на модули.

---

## 0. Ядро (CORE — `js/engine/*`, `js/calc/*`, `js/methods/*`)
Расчётно-графическое ядро Конструктора схем. Владеет `APP_VERSION`.
Импортирует только себя. Открытое:
- [ ] **0.1** Подробный расчёт длины кабеля по физ-маршруту (port→exit→
  trace→mirror, поправки на изгибы, endpoints wall/standalone). `arch:Фаза 16`
- [ ] **0.2** Двух-полевая мощность стойки (powerAvgKw/powerMaxKw),
  модель. `arch:Фаза 15.1`
- [ ] **0.3** POR-residual: domain-scoped locks (1.28.6), миграция всех
  модулей на DataAdapter contract (1.28.8). `arch:Фаза 1.28`
- [ ] **0.4** Произвольные концы связей (port↔port вне щитов). `arch:Фаза 1.21.2`
- [ ] **0.5** Тепловой расчёт щита (panel) + climate recommendation. `arch:Фаза 6`
- [ ] **0.6** Multi-discipline ядро: `scheme.discipline` ✅ (47.4.1);
  дисциплина-aware гейт ✅ (v0.60.513). Движки — см. X.4.

## 1. Shared-контракты (`shared/*`)
Шов платформы. Открытое:
- [ ] **1.1** Контракт-доки: `shared/contracts/README.md`,
  `storage-keys.md`, `cross-module-events.md`, `url-params.md`,
  `CONTRIBUTING.md`, `lint-allowlist.json`. ✅ (Фаза 0)
- [x] **1.2a** ✅ `tools/boundary-lint.mjs` (R1/R3/R4/R-shared жёсткие,
  R2 advisory) + `.github/workflows/contracts.yml` (non-blocking) +
  baseline allowlist (7 санкц.). `arch:Фаза 7,43` (Фаза 0)
- [x] **1.2b** ✅ `tools/gen-modules-json.mjs` (--check/--write) + CI-шаг
  `gen-modules-json --check` (non-blocking). Блокирующим станет после
  зелёного прогона Actions, подтверждающего паритет. (Фаза 1)
- [x] **1.3** ✅ Per-module `manifest.json` для всех 15 зарегистр.
  модулей (схема §6 contracts: version/owner/kind/standalone/
  dependsOnContracts/lsNamespacesOwned). modules.json НЕ перезаписан
  (zero-risk: проекция-паритет проверяется --check). Перевод
  «генератор владеет modules.json» (v1.2.0) — после подтверждения
  паритета в CI. `arch:Фаза 7.2,43-Etap2` (Фаза 1)
- [ ] **1.4** Element-Library API (внутр. реализация каталогов). `arch:Фаза 1.2.2 (отложено)`
- [ ] **1.5** Унифицированная selection-model — добить охват модулей
  (`selection-panel.js`). memory:selection_model
- [ ] **1.6** history-log: append-only + soft-delete/trash платформенно.
  `arch:Фаза 35` memory:data_history
- [ ] **1.7** Все отчёты только через `reports/` (мигрировать Service
  export-offer, TCO-charts, SCS-BOM, TW-PUE). memory:reports_via_module
- [ ] **1.8** Справочные данные только в каталогах (мигрировать
  `WORK_TEMPLATES` из `service/calc/order-model.js`). memory:use_catalogs
- [ ] **1.9** Панель алертов устаревших цен (опц.). `arch:Фаза 1 (price-alerts)`

## 2. Модули (PLUGGABLE / STANDALONE)
Каждый — own index.html, импорт только CORE/SHARED/CATALOGS, общение
через контракты. Открытое по модулям (детали — архив):

| Модуль | Открытые эпики (arch-ссылка) |
|---|---|
| **constructor** (корень/index.html) | drawio-режим canvas↔sheet, ISO-штамп `arch:Фаза 3`; пресеты карточек ✅ |
| **tech-workspace** | 47.3.2 Конструктор в project-mode; сквозной sync концепция↔схема `arch:Фаза 30,36.3`; План зала 20.7.1 ✅(v0.60.505-517) |
| **scs-config** | 1.24.x (многопорт-каталог, ATS, внешние порты, авто-трасса, авто-питание, телеком-отчёт); 1.26.2.a шаблоны vs реальные стойки `arch:Фаза 1.24,1.26` |
| **scs-design** | межстоечный СКС: план-вью, port↔port, BOM, экспорт SVG/PDF, лотки, связь с гл.схемой `arch:Фаза 1.25,1.26.4` |
| **rack-config** | rackInstance-схема+миграция, пресеты, узел «Стойка»→rackId, PDU 3D+розетки, привязка power-вводов, эл.BOM по PDU `arch:Фаза 1.24.22-26,15` |
| **cooling** | 22.10.1 вариант=комплекс; 22.13 единая локация проекта; 22.14 copy&customize подборов; импорт даташитов 25.2-25.5 `arch:Фаза 22,25` |
| **mdc-config** | экспорт по шаблону 26003-SCO-001, BOM→гл.схема, авто-расстановка кондиционеров `arch:Фаза 10.4-10.6` |
| **meteo** | доп.источники (plugin) `arch:Фаза 21.2` |
| **suppression-config** | АГПТ residual (3D three.js отложен) `arch:Фаза 11` |
| **service** | учётные № нарядов + каталог материалов `arch:Фаза 32`; reports/catalog миграция (1.7/1.8) |
| **logistics** | маршрутизация (опц.) `arch:Фаза 18.4` |
| **reports** | слот-ориентированные шаблоны документов `arch:Фаза 29`; приём blocks[] от модулей |
| **projects** | 1.27 residual; «Модули проекта» UI по подписке `arch:Фаза 2.X.3` |
| **rack-fill (Фаза 13)** | детальные параметры устройств наполнения (питание/IPAM/тепло/type-ext/инспектор/POR) `arch:Фаза 13` |
| ups/battery/panel/mv/transformer/genset/pdu/cable | стабильны; ручные габариты/паспорт ✅ (v0.60.514-519); residual — архив |

> Новые модули по дисциплинам — см. X.4.

## X. Cross-cutting

### X.1 Модульная разработка / governance (ex-43,7,17.4)
- [ ] X.1.1 Контракты+lint+CI (Фаза 0 плана) — **следующий шаг после спеки**.
- [ ] X.1.2 manifest по модулям + генератор modules.json (Фаза 1).
- [~] X.1.3 Упрочнение границ + гашение allowlist (Фаза 2).
  Жёсткие нарушения (R1/R3/R4/R-shared) погашены полностью —
  `allow:[]`: #1 psychrometrics-core; #2 meteo/util; #3 CSV-хелперы →
  `shared/` (cooling→meteo устранён); #4 service→`shared/money`
  (fc-summary дублировал байт-в-байт; без shim); #5 каталог АКБ →
  `shared/battery-catalog.js` (зеркало ups-catalog; shim); #6 seed-
  шаблоны отчётов → `shared/report/templates-seed.js` (shim;
  js/main+reports.js переключены).
  Осталось (R2, advisory): `projects/project.js` (15+ чужих LS) и
  упрочнение `*-bridge.js` → через project-storage/configuration-
  catalog helpers.
- [~] X.1.4 Структура-канон + calc/ui-нормализация. memory:module_separation
  Сделано (Фаза 0, v0.60.527, нулевой риск, код не тронут):
  `ARCHITECTURE.md` (канон скелета, привязка к manifest kind/requires,
  целевая реорг `shared/`, чек-лист модуля, долг реестра §5);
  `README.md` в 29 модуль-папках; `scripts/audit-manifest.py`
  (UNDECLARED requires-дрейф 23 / UNREGISTERED ui-папок 13 / PARITY 0)
  + CI non-blocking. `suppression-methods` — 1-й `kind:'calc-lib'`
  (v0.60.528). **Реестр полон (v0.60.529, modules.json v1.3.0):**
  +13 UI-модулей зарегистрированы (manifest+REGISTRY_ORDER, паритет
  OK, все `subscriptionPlan:'free'` → нулевой риск), `UNREGISTERED 0`.
  `dgu-config`→`genset-config` (v0.60.530). **`requires` синхрон
  (v0.60.531, modules.json v1.3.2):** 14 манифестов дополнены
  реальными доменными+cross-module зависимостями → audit-manifest
  полностью зелёный (UNDECLARED 0). Дробление монолитов:
  `transformer-config/calc/tx-select.js` ✅ (v0.60.532, пилот) +
  `ups-config/calc/ups-sizing.js` ✅ (v0.60.533) +
  `rack-config/calc/rack-power.js` ✅ (v0.60.534, электрика) +
  `scs-config/calc/rack-slots.js` ✅ (v0.60.535, U-геометрия) +
  `scs-design/calc/cable-route.js` ✅ (v0.60.536, Manhattan-маршруты) +
  `tech-workspace/calc/concept-loads.js` ✅ (v0.60.537, нагрузки/
  площади концепции, финал). **Очередь монолитов закрыта** —
  все 6 модулей имеют выделенный `calc/`-слой без DOM.
- [ ] X.1.5 Owner-board UI (owner-chip на карточке модуля). `arch:43.5`
- [ ] X.1.6 DB adapter pattern (Firebase/LS/SQL stubs). `arch:Фаза 7.3`
- [ ] X.1.7 (будущее) git submodules / pnpm-workspace. `arch:43-Etap3`

### X.2 Подписка / коммерция / Auth (ex-44,5,2.X.1)
- [ ] X.2.1 Платежи (Stripe/ЮKassa/…)+webhook+server-валидация+ключи. `arch:44.4`
- [ ] X.2.2 Trial-flow (email-напоминания, авто-rollback, upsell). `arch:44.5`
- [ ] X.2.3 Per-module SKU (выбор 3-5 модулей, bundle, B2B per-seat). `arch:44.6`
- [ ] X.2.4 Email/password reg UI; user-roles в Firestore; admin-UI;
  tariff-configurator. `arch:Фаза 5`
- [ ] X.2.5 manifest-поля RBAC/internalOnly/module-scope-pickers
  закреплены схемой (см. 1.3). memory:role_based_access,internal_modules

### X.3 i18n / l10n (отложено — только готовность)
- [ ] X.3.1 `shared/i18n/` + `t(ns,key)` + расширить `money.js`
  (fmtNumber/Date/Unit). Инфра без извлечения. (Фаза 5 плана)
- [ ] X.3.2 Codemod литералы→ru-каталоги; en-заглушки; переключатель
  локали в `app-header.js`. ~2–3 нед, после manifests.
- Конструктивное правило СЕЙЧАС: новые/правимые UI-строки изолируемы
  (один литерал) — lint WARN на новую кириллицу в diff.

### X.4 Multi-discipline (ex-47.4,2,12)
- [ ] X.4.1 Расчётные движки per-discipline: hydraulic (расход/давление/
  NPSH), hvac (воздухообмен/теплоприток), gas (давление/потери). `arch:47.4.2`
- [ ] X.4.2 Cross-discipline schemes (узел в неск. дисциплинах). `arch:47.4.3`
- [ ] X.4.3 Новые дисциплин-модули: cctv/accessctrl/fire-alarm/paging
  (слаботочка), scada/field-instrumentation (АСУ ТП), вентиляция,
  спринклеры/дымоудаление, floor-plan, structural-load. `arch:Фаза 2,12`
- [ ] X.4.4 Multi-discipline сводный отчёт + coordinated revisions. `arch:2.X.2,2.X.4`

### X.5 Управление объектом (отделяемый продукт) (ex-17)
- [ ] X.5.0 **Importmap-развязка путей** (enabler физ. реструктуризации
  без build). 🧪 Прототип на `cooling/` ✅ (v0.60.539). **Verify на
  реальном проде пройден (v0.60.540):** на `/raschet/cooling/`
  bare-спецификаторы резолвятся (`shared/`→projectKey, `engine/`→
  APP_VERSION), console-clean ×2; per-document изоляция доказана —
  `tech-workspace` (без importmap) импортит `cooling/calc/*` штатно,
  а bare `shared/` там корректно НЕ резолвится → нулевой риск другим
  модулям. Механизм пригоден. **Раскат идёт (решение Пользователя):**
  Шаг 1 ✅ (v0.60.541) — importmap во все 30 entry-HTML +
  configurator3d merge, аддитивно/no-op, снят риск порядка. Шаг 2 ✅
  (v0.60.543) — `scripts/bare-convert.py` перевёл импорты всех
  модулей (77 файлов, 357 правок) на bare `shared/`/`engine/`
  (cooling был пилотом). Спецификатор больше не зависит от глубины
  файла. Шаг 3a ✅ (v0.60.544) — module-namespace ключи importmap +
  bare настоящих cross-module импортов (18 файлов; большинство `../`
  оказались интра-модульными, безопасны при переезде целиком). Шаг
  3b — единый резолвер 63 захардкоженных nav-путей (карта в
  `js/engine/inspector.js` + hub + modules/index + consumer/panel).
  Затем depth-fix не-JS на entry-HTML (CSS-link / script-src /
  importmap-адреса) + физический переезд папок в
  `apps/`+`lib/`+`platform/` (правка ОДНОЙ карты + modules.json).
- [ ] X.5.1 Schema-versioned JSON контракт всех типов данных проекта. `arch:17.1`
- [ ] X.5.2 project-storage как интерфейс (LS/HTTP/IDB транспорты). `arch:17.2,34`
- [ ] X.5.3 Standalone SPA «Управление объектом» (свой деплой, API). `arch:17.3`
- [ ] X.5.4 Обновляемость отдельно-деплоимых модулей (manifest semver,
  совместимость, graceful degradation, CI). `arch:17.4`
- [ ] X.5.5 Модульная лицензия (org key, offline/online верификация). `arch:17.5`
- [ ] X.5.6 Жизненный цикл проект→объект (copy/link, 2-сторон. sync,
  audit). `arch:17.6`
- [ ] X.5.7 Кандидаты на отделение: ЗИП/склад, ТО/инциденты,
  энергомониторинг, мобильный companion, мониторинг SNMP/BACnet/Modbus. `arch:17.7`

### X.6 Чертёжный вывод / CAD (ex-3,14,29,9)
- [ ] X.6.1 drawio-режим (canvas↔sheet, ISO 7200 штамп, авто-layout). `arch:Фаза 3`
- [ ] X.6.2 План зала ЕСКД/ISO scale + читаемые подписи + стены/трассы/
  фитинги + 2D/3D-виды. `arch:Фаза 14`
- [ ] X.6.3 Слот-ориентированные шаблоны документов. `arch:Фаза 29`
- [ ] X.6.4 Revit/IFC импорт-экспорт (нужен back-end). `arch:Фаза 9`
- [ ] X.6.5 3D-интеграция configurator3d (2D↔3D sync, split-view,
  фасады). `arch:Фаза 4`

### X.7 Данные / хранение / интеграции (ex-34,35,40,37,41,33,26,27)
- [ ] X.7.1 Большие датасеты LS→IndexedDB. `arch:Фаза 34`
- [ ] X.7.2 История загруженных данных + Корзина (с 1.6). `arch:Фаза 35`
- [ ] X.7.3 Cloud-синхронизация всех данных проекта. `arch:Фаза 40`
- [ ] X.7.4 CDE по ISO 19650. `arch:Фаза 37`
- [ ] X.7.5 Организация: мульти-пользователь, общие шаблоны (data-model,
  shared catalogs, UI настроек). `arch:Фаза 41`
- [ ] X.7.6 Интеграция 1С (УНФ/БП/УТ). `arch:Фаза 33`
- [ ] X.7.7 SharePoint-модуль. `arch:Фаза 26`
- [ ] X.7.8 MS365 авторизация (deferred). `arch:Фаза 27`

### X.8 Единый shell конфигураторов (ex-28)
- [ ] X.8.1 Миграция `cl-*/sv-*/…` → `rs-cfg-*` единый shell. `arch:Фаза 28`

### X.9 Прочее
- [ ] X.9.1 Рабочее место логиста — маршрутизация. `arch:Фаза 18.4`
- [ ] X.9.2 Пресейлс/КП модуль `presale/`. `arch:Фаза 8`
- [ ] X.9.3 Project Management/Planning, LCM — residual. `arch:Фаза 38,39`

---

## Перенос из архива — карта (no-loss)
Полный текст и 287 гранулярных `[ ]` сохранены в **ROADMAP-archive.md**
(заморожен). Соответствие старых фаз → новой структуры:

| Архив | → Новое |
|---|---|
| 47.1/47.2/47.3 ✅, 47.3.2 ⏳ | модуль tech-workspace; 47.4.x → X.4 |
| 43 (Etap0-3, owner-board), 7 (module.json/DB-adapter), 17.4 | X.1 |
| 44 (44.4-44.6), 5 (Auth/Permissions), 2.X.1 | X.2 |
| 17.1-17.7 (separable product), 2.X (disciplines-as-modules) | X.5, X.4 |
| 47.4.2/47.4.3, 12 (HVAC/PUE), 2.B-2.H (новые дисциплины), 11 АГПТ-residual | X.4 |
| 3 (drawio), 14 (план ЕСКД), 29 (слот-доки), 9 (Revit/IFC), 4 (3D) | X.6 |
| 34, 35, 40, 37, 41, 33, 26, 27 | X.7 |
| 28 (единый shell) | X.8 |
| 16 (длина кабеля), 15 (двухполевая мощность/PDU), 1.28.6/8, 1.21.2, 6 (тепло щита) | 0. Ядро |
| 1.2.2, selection-model, history-log, reports-via-reports, catalogs, price-alerts | 1. Shared |
| 1.24/1.25/1.26 (СКС), 22/25 (cooling), 10 (МЦОД), 21.2, 13 (rack-fill), 32 (service), 18.4, 1.27 residual | 2. Модули |
| 8 (presale), 38/39 (PM/LCM residual) | X.9 |
| Все ✅-фазы (45,46,1.28.21,20,23,24,30,36,…) | история — только в архиве |

> Если пункт не нашли в активном плане — он жив в архиве; поднять сюда
> в нужную секцию при взятии в работу (правило ведения).
