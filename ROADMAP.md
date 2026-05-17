# Raschet — Роадмап (модуль-ориентированный, сжатый)

> **Статус:** v0.60.726 (2026-05-18). Конструктор+дисциплины
> (X.4.5.3, Вариант I): спека + Ф-A pageDiscipline ✅ + Ф-B1
> page.discipline round-trip ✅ + задел §10 (технолог-ГИП lifecycle
> + SPATIAL-BASE архитектор/конструктор, дисц. architectural) ✅ +
> Ф-B2 мастер выбора типа + 🔒 read-only в свойствах ✅ +
> Ф-C контекст-палитра по активной странице ✅ +
> Ф-D дисциплинарный RBAC ✅ +
> Ф-E задел + интеграция #1 (object-registry + store) ✅;
> Ф-E деривация…Ф-G по порядку. Модуль отчётов (X.6.3)
> **завершён ПОЛНОСТЬЮ** + по-раздельная модель (sections-as-base,
> SPEC-section-model.md): база владеет `pageSections[]` (геом+
> колонтитул+логотип на раздел), документ наследует и явно выбирает
> именованный раздел; колонтитул многострочный с h/v-выравниванием
> и режимом ширины (print/page/bleed) вне полей печати; пусто →
> legacy first/other (нулевая регрессия). Также: flow-документ,
> редактор на flow (WYSIWYG=PDF), правка из превью, общий
> `composeReport`, базовые/документные шаблоны разделены вкладками,
> встроенные документы привязаны к базам. Verified e2e.
> Архитектурная
> модуляризация: **Фазы 0–2 ЗАКРЫТЫ ПОЛНОСТЬЮ** (X.1.1/1.2/1.3 ✅):
> контракты+lint+CI, 29 manifest+генератор, `allow:[]`, R2 закрыт
> (вкл. финал `projects/project.js` v0.60.714–720), repo-wide
> 0 sibling-import / 0 foreign-project LS. Структура-канон
> (X.1.4): `ARCHITECTURE.md` + 29 README + `audit-manifest.py` ✅;
> реестр полон + manifest честен (modules.json v1.3.2, audit зелёный).
> `dgu-config`→`genset-config`. Дробление монолитов **завершено для
> всей очереди**: calc/ui выделен в `transformer-config/calc/tx-select.js`
> (пилот) + `ups-config/calc/ups-sizing.js` + `rack-config/calc/rack-power.js`
> + `scs-config/calc/rack-slots.js` + `scs-design/calc/cable-route.js`
> + `tech-workspace/calc/concept-loads.js` (финал).
> R2 (advisory): projects/project.js — **ЗАВЕРШЕНО ПОЛНОСТЬЮ**
> (v0.60.714–720, инкременты A/B/C1–C5, по 1 деплою+verify):
> read-side + все write/migrate-пути переведены на шов
> `projectLoad`/`projectSave`/`projectModulePrefix`; сырые литералы
> `raschet.project.*` и `localStorage(get|set)Item(projectKey)`
> устранены — **0** в project.js; неиспользуемый импорт `projectKey`
> убран. boundary/audit --strict/changelog-lint зелёные; карточка
> проекта (25013_Qarmet) — round-trip OK, console-clean.
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
  - v0.60.640: `tools/changelog-lint.py` — страж синтаксиса
    `module-changelogs.js` (JS-string токенайзер: `\\'` / newline-
    in-str / string-then-identifier / unterminated). Закрывает
    класс site-wide поломки футера (инцидент v0.60.599→639). Делает
    `feedback_changelog_escaping` механически проверяемым; пригоден
    как blocking CI-шаг + ручная проверка перед коммитом.
- [x] **1.2b** ✅ `tools/gen-modules-json.mjs` (--check/--write) + CI-шаг
  `gen-modules-json --check` (non-blocking). Блокирующим станет после
  зелёного прогона Actions, подтверждающего паритет. (Фаза 1)
  - v0.60.609: пост-restructure ремонт паритета — `manifestPath`
    обновлён под apps/lib-раскладку (apps→lib→root-резолвер); поле
    `path` в 26 манифестах выровнено под каноничный `apps/<id>/`
    (расходилось с modules.json после file-structure restructuring).
    modules.json не менялся; паритет 33 модулей подтверждён (python-
    порт --check, node локально недоступен). Нулевой runtime-риск.
  - v0.60.624: `tools/audit-contracts.py` — advisory-аудитор честности
    `dependsOnContracts` (storageKeys/urlParams/bridges/events vs
    фактический код). Дополняет gen-modules-json (тот — только
    проецируемые поля). Ревизия манифестов по модулям: meteo v615,
    cooling v616, tech-workspace v617, service v618, projects v619,
    scs-design v620, scs-config v621, rack-config v622, genset-config
    v623 — честны; 5 calc-lib чисты. **Хвост завершён (v627–v638):**
    mdc/pdu/mv/panel/ups/battery/cable/suppression/logistics/catalog/
    sketch/constructor — honest; help пуст КОРРЕКТНО (auditor
    false-flag из текста справочных статей); transformer/
    psychrometrics/facility-inventory/reports/schematic/
    configurator3d уже были корректны. **Ревизия «manifest честен»
    завершена по ВСЕМ 33 модулям;** modules.json неизменен, паритет
    33 OK на каждом шаге. Schema-id (raschet.&lt;id&gt;.v1) и Map.get
    исключались по человеческому суждению (advisory-границы аудитора).
- [x] **1.3** ✅ Per-module `manifest.json` для всех 15 зарегистр.
  модулей (схема §6 contracts: version/owner/kind/standalone/
  dependsOnContracts/lsNamespacesOwned). modules.json НЕ перезаписан
  (zero-risk: проекция-паритет проверяется --check). Перевод
  «генератор владеет modules.json» (v1.2.0) — после подтверждения
  паритета в CI. `arch:Фаза 7.2,43-Etap2` (Фаза 1)
- [ ] **1.4** Element-Library API (внутр. реализация каталогов). `arch:Фаза 1.2.2 (отложено)`
- [ ] **1.5** Унифицированная selection-model — добить охват модулей
  (`selection-panel.js`). memory:selection_model
- [x] **1.6** history-log: append-only + soft-delete/trash ✅
  ПЛАТФОРМЕННО (`shared/history-log.js`: historyAppend/List/Trash/
  Restore/Purge/Clear/Size/Stats — full API). Остаётся adoption по
  модулям (per-module UI «📜 История»). `arch:Фаза 35` memory:data_history
- [x] **1.7** Все отчёты только через `reports/` (blocks API) ✅
  ЗАВЕРШЕНО. Service export-offer (v0.60.26); SCS-BOM/TW-PUE — прямого
  HTML не было. Все 4 direct-HTML `window.open('').document.write`
  анти-паттерна мигрированы в blocks[]: pdu-config (v0.60.562),
  logistics (v0.60.563), battery (v0.60.564 — делегирует общий
  buildBatteryReportBlocks), ups-config (v0.60.565). Анти-паттерн
  захардкоженного HTML-документа в проекте устранён.
  memory:reports_via_module
- [x] **1.8** Справочные данные только в каталогах ✅ `WORK_TEMPLATES`
  вынесен в `apps/service/catalog/work-templates.js` (re-export shim
  в order-model.js, @deprecated v0.60.36). memory:use_catalogs
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
- [x] X.1.1 Контракты+lint+CI (Фаза 0 плана) ✅ — `shared/contracts/`
  (README §5 правила, lint-allowlist.json), `tools/boundary-lint.mjs`,
  `tools/audit-contracts.py`, `.github/workflows/contracts.yml`.
- [x] X.1.2 manifest по модулям + генератор modules.json (Фаза 1) ✅ —
  29 `<module>/manifest.json`, `tools/gen-modules-json.mjs`,
  `modules.json` v1.3.2, `tools/audit-manifest.py` (паритет 0).
- [x] X.1.3 Упрочнение границ + гашение allowlist (Фаза 2) ✅ **ЗАКРЫТО**.
  Итог: `allow:[]` (все жёсткие R1/R3/R4/R-shared погашены #1–#6 +
  R3 v0.60.626); R2 (сырой foreign per-project LS) закрыт полностью
  (модули+бриджи v0.60.551–559, **финал `projects/project.js`
  v0.60.714–720**: read+write/migrate-пути → шов
  `projectLoad`/`projectSave`/`projectModulePrefix`, 0 сырых
  обращений). Repo-wide скан: 0 sibling-module relative-import,
  0 foreign-project LS-литералов вне шва; остаток `raschet.projects.v1`
  (глобальный реестр, read-only fallback) / `company-profile`
  (shared-contract владеет своим ключом) / bridge/migration helpers —
  **отревьюированы ранее как «genuine-литералов 0»**, санкц., не R2.
  audit-contracts --strict = 0 drift. Историческая детализация ниже.
  Жёсткие нарушения (R1/R3/R4/R-shared) погашены полностью —
  `allow:[]`: #1 psychrometrics-core; #2 meteo/util; #3 CSV-хелперы →
  `shared/` (cooling→meteo устранён); #4 service→`shared/money`
  (fc-summary дублировал байт-в-байт; без shim); #5 каталог АКБ →
  `shared/battery-catalog.js` (зеркало ups-catalog; shim); #6 seed-
  шаблоны отчётов → `shared/report/templates-seed.js` (shim;
  js/main+reports.js переключены).
  Канон мостов ✅ (v0.60.550): `cooling/meteo-bridge.js` (единственный
  мост вне `shared/`) перенесён в `shared/meteo-bridge.js` (git mv,
  история цела; импортёр `cooling.js` → bare; старый путь — re-export
  shim под кэш Pages). Теперь ВСЕ мосты в `shared/`.
  `projects/project.js` R2 ✅ (v0.60.551): 36 сырых литералов
  `raschet.project.${pid}.M.K` → `projectKey()` (байт-идентично,
  `scripts/proj-key-convert.py`, ассерт-инвариант; 0 остаточных).
  Прочие сырые читатели R2 ✅ (v0.60.555): батч 18 литералов →
  `projectKey()` в projects.js(6)/js/main.js(1)/tech-workspace(7)/
  scs-design(4) (`scripts/proj-key-convert-batch.py`, ассерт-
  инвариант; 2 префикс-скана scs-design оставлены — отдельная
  задача; rack-sidebar/suppression/app-header/auto-norm/company-
  profile/scheme-orphan — genuine-литералов 0).
  Префикс-сканы R2 ✅ (деплой A v0.60.558 helper в shared +
  деплой B v0.60.559 потребители; двухдеплойный cache-safe
  паттерн §6a после инцидента 556→557): `projectPrefix`/
  `projectModulePrefix` + 6 префикс-сканов (cooling/meteo/service/
  scs-design×2/scs-config) + 3 остаточных full-key в scs-config.
  Итог R2: project.js 36 + батч 18 + финал 9 = **63 погашены**,
  raw `raschet.project.${` в модулях не осталось.
  **R2 ЗАКРЫТО (v0.60.559):** бриджи проверены сканом — 0 raw
  project/sketch литералов (все через `projectKey`); остаток
  `raschet.*` = санкц. НЕ-проектные глобальные ns (catalog-bridge
  storage-event prefix, service-bridge standalone, legacy-migration
  FLAG) — не foreign-project LS. allowlist/README синхронизированы;
  R2 готов к graduation advisory→enforced (CI-шаг, Фаза F).
  **Последнее жёсткое R3 ✅ (v0.60.626):** проверка boundary-lint
  (python-порт, node локально нет) выявила 1 оставшееся жёсткое
  нарушение — `js/engine/inspector/ups.js` (CORE) импортировал
  `battery/battery-discharge.js` (после apps/-restructure путь ещё
  и сломан: реальный — `apps/battery/`). `battery-discharge.js` —
  чистый calc (calcAutonomy/calcRequiredBlocks/forecast…, 0 импортов,
  без DOM) → перенесён `git mv` в `lib/battery-calc/battery-discharge.js`
  (calc-lib; CORE→calclib законом импортов РАЗРЕШЁН — правила бьют
  только tgt==='module'). Полный перенос без shim (D6): 2 импортёра
  (`apps/battery/battery-calc.js`, `ups.js` dynamic import) перенацелены,
  заодно починен сломанный путь. boundary-lint: HARD violations 0,
  allowlist пуст. Фаза-2 жёсткая часть закрыта полностью.
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
  **Аудит Фазы 4 (v0.60.566):** псевдо-монолиты по факту уже
  разделены старым паттерном `<module>-core.js`/lib (не папкой
  `calc/`, но цель достигнута — DOM-free reusable calc):
  `psychrometrics` (psychrometrics-core.js + psy-calculators.js,
  тянет shared/calc/psychrometrics-core), `suppression-config`
  (calc → `lib/suppression-methods`), `cable` (js/methods +
  shared/calc-modules). Переименование `-core.js`→`calc/index.js`
  — косметика с path-hazard, низкая ценность (ARCHITECTURE §1:
  переименование монолита только при дроблении, через shim).
  Genuine остаток с переплетённым calc+DOM (будущие фокус-
  инкременты, по одному, средний риск): `battery` (4296),
  `panel-config` (1201), `mdc-config` (943). `catalog`/`projects`/
  `schematic` — data/CRUD/canvas-UI, чистого calc мало (вне scope).
  Архитектурная цель Фазы 4 (изоляция calc) по основным
  расчётным модулям достигнута.
- [~] X.1.5 Owner-board UI (owner-chip на карточке модуля). `arch:43.5`
  Готовность ✅: поле `owner` есть в схеме ВСЕХ 29 manifest.json
  (сейчас `"unassigned"` — назначение владельцев = орг-решение, не
  код). Блокеры UI-чипа (v0.60.568, не делаем спекулятивно): (1)
  `tools/gen-modules-json.mjs` НАМЕРЕННО исключает `owner` из
  проекции `modules.json` (карточки `/modules/` читают именно
  `modules.json`) — нужно осознанное расширение проекции +
  регенерация + парити-`--check` (требует Node, недоступен в тек.
  окружении); (2) пока все `owner='unassigned'` ценность чипа
  нулевая. Разблокируется: назначить реальных владельцев в
  манифестах → расширить проекцию генератора (owner) → рендер chip
  в `/modules/index.html` (one-liner на готовой `.meta`-строке).
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
- [ ] X.2.6 Org-уровневые БАЗОВЫЕ шаблоны отчётов: админ
  (internal-роль) правит базовый шаблон → сохраняется в общий
  org-слой (как promote-to-org), виден всем; гейт по роли. Решение
  Пользователя 2026-05-17 (вариант «Org-уровень + роль»). Зависит
  от RBAC/configuration-catalog. `arch:44`

### X.3 i18n / l10n (отложено — только готовность)
- [x] X.3.1 `shared/i18n/` + `t(ns,key)` + расширить `money.js`
  (fmtNumber/Date/Unit). Инфра без извлечения. (Фаза 5 плана) ✅
  v0.60.567: `shared/i18n/index.js` (t/tAsync/getLocale/setLocale/
  availableLocales/loadNamespace; ns=`<module>.<section>.<key>`;
  ru=источник+fallback; ленивый fetch `<lang>/<ns>.json`; нет
  каталогов → `t()`=fallbackText‖key, полный no-op) + README +
  `money.js` +fmtNumber/fmtDate/fmtUnit (locale-aware, zero-dep,
  аддитивно). Cache-safe §6a: i18n никто не импортирует, новые
  money-export без потребителей. Извлечение строк — X.3.2.
- [ ] X.3.2 Codemod литералы→ru-каталоги; en-заглушки; переключатель
  локали в `app-header.js`. ~2–3 нед, после manifests.
- Конструктивное правило СЕЙЧАС: новые/правимые UI-строки изолируемы
  (один литерал) — lint WARN на новую кириллицу в diff.

### X.4 Multi-discipline (ex-47.4,2,12)
- [x] X.4.1 Расчётные движки per-discipline: hydraulic (расход/давление/
  NPSH), hvac (воздухообмен/теплоприток), gas (давление/потери). ✅ (v0.60.576) `arch:47.4.2`
  hydraulic ✅ (v0.60.570): `lib/hydraulic-methods` calc-lib —
  Дарси–Вейсбах + Свами–Джейн + NPSH + свойства воды/ROUGHNESS;
  контракт {META,compute}/run() (эталон suppression-methods);
  manifest+modules.json+REGISTRY_ORDER, audit OK; importmap-ключ
  отложен до UI-потребителя. Шаблон для hvac/gas (по аналогии).
  hvac ✅ (v0.60.575): `lib/hvac-methods` calc-lib —
  air-balance (воздухообмен = max кратность/явная теплота/сан.норма)
  + heat-gain (трансмиссия+солнце+люди+освещение+оборуд.) +
  психрометрия влажного воздуха; parity 10/10.
  gas ✅ (v0.60.576): `lib/gas-methods` calc-lib —
  pressure-drop (авто-режим: низкое ≤5 кПа линейная / среднее-высокое
  изотерм. P1²−P2²) + throughput (обратная задача, итерация λ(Re)) +
  свойства газов/ROUGHNESS; parity OK.
  ВСЕ ТРИ движка готовы. Осталось (X.4.2/X.4.4): UI-потребитель /
  cross-discipline отчёт + importmap-ключи при появлении UI.
- [~] X.4.2 Cross-discipline schemes (узел в неск. дисциплинах). `arch:47.4.3`
  Контракт-шов `shared/disciplines.js` ✅ (v0.60.577): реестр
  дисциплин (electrical CORE + hydraulic/hvac/gas/suppression →
  calc-lib + mechanical/data задел) — единый источник между
  `state.project.discipline` и `lib/<id>-methods`; чистые данные,
  без import lib (calcLib = bare-строка для потребителя).
  Контракт членства узла ✅ (v0.60.578): `node.disciplines[]`
  аддитивно, round-trip без миграции (stripRuntime пропускает не-`_`);
  аксессоры nodeDisciplines/isNodeInDiscipline/isMultiDiscipline,
  fallback на дисциплину проекта, отсутствие поля ≠ ошибка
  (user-params-sacred).
  UI назначения + роутинг ✅ (v0.60.580): в проектном cross-discipline
  view (apps/projects, НЕ Конструктор — он остаётся чистой электрикой,
  решение v0.60.277/278). Секция «🧩 Дисциплины узлов схемы»: чекбоксы
  членства на узел (electrical+hydraulic/hvac/gas/suppression), пусто =
  дисциплина проекта; read-modify-write engine-scheme через projectKey
  (трогаем только node.disciplines, остальное байт-в-байт; чистка поля
  если == дефолт проекта). Таблица «🔀 Расчётный роутинг» — движок
  дисциплины через calcLibSpecifier (lib/<id>-methods или CORE js/calc).
  Осталось: авто-прогон методик по членству → X.4.4-producer.
- X.4.4-producer (в работе): Increment A ✅ (v0.60.581) — декларативная
  схема входа `META.inputs[]` (key/label/unit/type/default/options) во
  всех 6 методиках hydraulic/hvac/gas; heat-gain.compute принимает и
  скалярную форму env_*/gl_*. Контракт авто-формы; producer (projects)
  читает следующим деплоем (§6a split — без потребителя cache-safe).
  Increment B1 ✅ (v0.60.582): в projects-view секция «🧮 Расчёт по
  дисциплинам» — узел с не-электрической ready-дисциплиной → авто-форма
  из META.inputs → run() → результат+steps; «💾 Сохранить параметры»
  пишет node.disciplineParams (byte-preserving через projectKey, free
  round-trip). lib грузится lazy по URL ../../lib/<spec>.
  Increment B2 ✅ (v0.60.583): кнопка «📑 Сводный мультидисциплинарный
  отчёт» — собирает node.disciplineParams всех узлов, прогоняет
  методики, buildCrossDisciplineReport → blocks[] → createTemplate +
  previewPDF (строго reports-пайплайн, memory reports-only-via-reports;
  никакого raw-HTML). X.4.4 producer замкнут end-to-end.
- [ ] X.4.3 Новые дисциплин-модули: cctv/accessctrl/fire-alarm/paging
  (слаботочка), scada/field-instrumentation (АСУ ТП), вентиляция,
  спринклеры/дымоудаление, floor-plan, structural-load. `arch:Фаза 2,12`
- [~] X.4.4 Multi-discipline сводный отчёт + coordinated revisions. `arch:2.X.2,2.X.4`
  Контракт-builder `shared/report/cross-discipline.js` ✅ (v0.60.579):
  чистая `buildCrossDisciplineReport({title,intro,project,sections})`
  → blocks[] для reports/ (memory: reports-only-via-reports); связывает
  движки lib/<id>-methods (X.4.1) + реестр disciplines.js (X.4.2) с
  отчётным слоём; импорты только SHARED→SHARED (lib не импортируется —
  результаты передаёт потребитель). Producer ✅ (v0.60.581-583):
  META.inputs[] во всех методиках + projects-view «🧮 Расчёт по
  дисциплинам» (авто-форма→run→node.disciplineParams) + «📑 Сводный
  отчёт» (агрегация→cross-discipline.js→reports previewPDF).
  Осталось: coordinated revisions (согласование разделов) — под-фазой.
- [ ] X.4.5 **Архитектурные дополнения Пользователя (2026-05-17)** —
  durable, см. memory:architecture_layers. Пересматривают модель слоёв.
  - [x] X.4.5.1 D1 ✅ (v0.60.599): ядро = только `js/engine/*`
    (платформа); `lib/*`+`js/calc` = класс CALC-LIB; `js/methods`
    удалён (электрика → lib/electrical-methods, v.593). boundary-lint
    isCore/isCalcLib/classify переписаны; ARCHITECTURE-лакмус +
    contracts §1 актуализированы.
  - [x] X.4.5.2 D2 ✅ (v0.60.599): закон импортов смягчён —
    calc-модуль (`lib/*`/`js/calc`) = отдельный класс, импортируется
    НАТИВНО любым слоём (правила запрета бьют только по
    tgt==='module'). contracts §3 актуализирован; сырой чужой LS
    (R2) — по-прежнему только через helpers.
  - [~] X.4.5.3 D3: Конструктор — ОДИН app, единый интерфейс для
    любых схем, но РАЗНЫЕ непересекающиеся контекст-палитры под
    дисциплину (решение Пользователя 2026-05-17). Реконсиляция
    v0.60.277/278: «без отвлечений» = чистый ПЕР-КОНТЕКСТ (электро-
    контекст без шума др. дисциплин сохранён). memory:architecture_layers D3.
    Increment 1 ✅ (v0.60.600): контракт-реестр
    `shared/discipline-context.js` (per-discipline палитра/инспектор-
    табы; electrical=CURRENT_ELECTRICAL_PALETTE сентинел=текущая
    палитра без изменений; hydraulic/hvac/gas=scaffold; аксессоры
    getContext/listContexts/isContextActive; 0 потребителей,
    cache-safe). Осталось: разводка в Конструктор (читать по
    state.project.discipline) + селектор контекста — поэтапно,
    высокий blast-radius (js/engine inspector/render + index.html).
    Increment 2 ✅ (v0.60.603): Конструктор читает discipline-context
    по state.project.discipline. Бейдж активного контекста сверху
    палитры. ИНВАРИАНТ: electrical (сентинел) → #palette-sections НЕ
    трогаем (display не меняем) = нулевая регрессия (все реальные
    проекты electrical). Не-electrical → обратимое scaffold-превью
    (скрыть #palette-sections display:none, показать read-only набор
    из реестра). Идемпотентно, вызов на init + смене параметров
    проекта.
    Increment 3 ✅ (v0.60.608): селектор «👁 превью» в баре rs-disc-ctx
    — посмотреть scaffold-палитры др. дисциплин НЕ меняя
    project.discipline (эфемерный _previewDiscCtx, не в LS/state;
    маркер «превью · проект не изменён ✕ сброс»). Электро-инвариант
    сохранён (preview||project; electrical → #palette-sections не
    трогаем, обратимо). Осталось: реальная разводка инструментов
    non-electrical дисциплин (node-model/serialization/interaction
    per discipline — будущие инкременты, высокий blast-radius).
    Спека архитектуры ✅ (v0.60.722): интервью 2026-05-18 +
    мировые практики (Revit/BIM federated, EPLAN, SOLIDWORKS) →
    `shared/contracts/schema-constructor-architecture.md`. Решения:
    оболочка общая (не движок); тип схемы immutable; **страница =
    типизированная схема (Вариант I)**; одна канва + фильтр
    дисциплины; данные СКС в модуле СКС, Конструктор по ссылке;
    общий реестр объектов + дисципл-атрибуты + порт-driven
    видимость (data→СКС, fieldbus→АСУТП); сборка всего
    оборудования — только в технологе. Поэтапный план Ф-A…Ф-G
    (Ф-A контракт безопасен; Ф-B…Ф-G — по одобрению, blast-radius).
    Ф-A ✅ (v0.60.723): shared/disciplines.js +pageDiscipline(page,
    projectDiscipline) + isPageTyped(page) — эффективная immutable-
    дисциплина страницы (page→project→electrical fallback),
    аддитивно, 0 потребителей, cache-safe.
    Ф-B1 ✅ (v0.60.724): addPage/duplicatePage штампуют
    page.discipline; serialization round-trip (только явное
    значение, no-auto-write; legacy → fallback при чтении).
    recalc/render не затронуты. Дальше Ф-B2 (мастер выбора +
    🔒 read-only тип в свойствах) → Ф-C…Ф-G по порядку.
    Задел §10 ✅ (v0.60.725): дополнение Пользователя 2026-05-18 —
    технолог проекта = полное управление + ГИП на весь жизненный
    цикл объекта (до сдачи в эксплуатацию; далее — модуль
    эксплуатации/O&M, отдельная фаза), координатор над всеми
    дисциплинами; архитектор+конструктор = SPATIAL-BASE (стены/
    площади/пространства, BIM-federated подложка). +дисциплина
    `architectural` (ready:false, 0 потребителей, cache-safe);
    mechanical перелейблен «Конструкции/нагрузки» (id стабилен).
    Контракт-задел, движков нет (memory:architecture_layers D7/D8).
    Ф-B2 ✅ (v0.60.726): меню «+ страница» — двухгрупповой мастер
    (выбор immutable-дисциплины radio из DISCIPLINES, по умолчанию =
    дисциплина проекта → выбор вида → addPage(...,discipline)
    штампует page.discipline через pageDiscipline-валидацию). Dropdown
    «Дисциплина схемы» в свойствах проекта → disabled + бейдж
    «🔒 неизменяем» при наличии типизированной страницы (isPageTyped);
    значение сохраняется (disabled .value, memory:user-params-sacred);
    legacy без типизир. страниц → редактируем. RBAC чужого типа — Ф-D.
    Дальше Ф-C (discipline-context по active-page) → Ф-D…Ф-G.
    Ф-C ✅ (v0.60.727): applyDisciplineContextUI читает дисциплину
    активной СТРАНИЦЫ (pageDiscipline(curPage, project.discipline)),
    не проекта; export.js switchPage/addPage/deletePage дёргают
    опциональный хук window.__raschetApplyDiscCtx (no-op без main.js,
    движок не зависит от UI); смена страницы сбрасывает превью.
    Электро-инвариант сохранён (legacy → electrical → #palette-
    sections не трогаем, нулевая регрессия). Дальше Ф-D (RBAC
    дисциплинарный) → Ф-E…Ф-G.
    Ф-D ✅ (v0.60.728): shared/subscriptions.js ROLES +disciplineCreate
    (manager/gip/engineer=«*», viewer=[]); +effectiveRoles() (union,
    forward-compat) +canCreateDiscipline() (не-internal→true, нулевая
    регрессия; internal — union по ролям). Мастер «+ страница» гейтит
    чужой тип: disabled+«🔒 нет прав»+tooltip; _selDisc fallback на
    первую разрешённую; internal viewer — виды disabled. Дальше Ф-E
    (общий реестр объектов + порты) → Ф-F (СКС в оболочку) → Ф-G.
    Ф-E задел ✅ (v0.60.729): shared/object-registry.js — чистый
    контракт + аксессоры (RegistryObject, PORT_TYPES, objectPorts,
    isVisibleToPort/objectsVisibleToPort порт-driven видимость,
    disciplineSlice, duplicateTagGroups). Без LS/авто-записи, 0
    потребителей, cache-safe. Интеграция project-storage шов +
    реконсиляция tech-workspace/rack-merge — следующие защищённые
    инкременты Ф-E → Ф-F → Ф-G.
    Ф-E интеграция #1 ✅ (v0.60.730): shared/object-registry-store.js
    — персистентность через project-storage шов (namespace
    object-registry.objects.v1); loadRegistry/saveRegistry/
    upsertObject/removeObject/writeDisciplineSlice (merge
    disciplineAttrs без затирания чужих срезов). Аддитивно,
    copyProject/clearProjectData несут namespace автоматически,
    0 потребителей cache-safe. Дальше Ф-E деривация (реестр из
    rack/device существующих данных) → wiring tech-workspace/
    rack-merge → Ф-F (СКС оболочка) → Ф-G (агрегация BOM).
  - [~] X.4.5.4 D4: каждый обособленный метод (стандарт/методика) —
    отдельный файл + picker. gas-methods ✅ (v0.60.587): потери
    давления разделены на 3 стандарта-метода — `pressure-drop.js`
    (СП 42-101/СП 62.13330, id сохранён для backward-compat),
    `pressure-drop-renouard.js` (Renouard linéaire/quadratique),
    `pressure-drop-weymouth.js` (Weymouth, λ=0.009407/D^⅓);
    META.standard на каждом.
  - [~] X.4.5.5 D5: мультинорма (РФ + КЗ СН/СП РК + ISO/IEC) +
    отключаемые/версионируемые методы. gas-methods ✅ (v0.60.589):
    +pressure-drop-sprk.js (СН РК 4.03-01 / СП РК 4.03-101, region KZ;
    переиспользует РФ-ядро, своя META для независимой версии);
    META каждого метода +region/version/enabled; index.js — реестр
    из массива _ALL с фильтром enabled (+ALL_META для админ-UI).
    Добавить метод/версию = +1 импорт; отключить = enabled:false.
    METHOD_LIST=5. hydraulic-methods ✅ (v0.60.590): потери напора
    по методике/норме отдельными файлами — Дарси–Вейсбах (INT) +
    head-loss-sprk (КЗ СН/СП РК, своя META, ядро Дарси) +
    Хазен–Вильямс + Шези–Маннинг; META +region/version/enabled;
    index.js реестр _ALL+enabled-фильтр+ALL_META; METHOD_LIST=5.
    Электрика js/methods ✅ (v0.60.591): методы УЖЕ были отдельными
    файлами (iec/pue/nec/rtm/vdrop/economic) — выполнена гармонизация
    к контракту D4/D5 АДДИТИВНО (js/methods потребляется recalc):
    META +standard/region/version/enabled; +pue-rk.js (ПУЭ РК, КЗ,
    ядро ПУЭ); index.js +ALL_META +METHOD_LIST (enabled-фильтр),
    listMethods расширен (id/label backward-compat). Электрика
    подтверждена как calc-модуль (D1).
    D1 завершён физически ✅ (v0.60.592): js/methods → lib/
    electrical-methods (git mv, история); 13 старых путей =
    ../engine/ → ../../js/engine/ (depth-fix); manifest +
    modules.json (parity OK, 33) + REGISTRY_ORDER + /modules/.
    ПОЛНЫЙ перенос ✅ (v0.60.593, по требованию Пользователя «либо
    перенеси полностью, либо как было» — shim-дублирование убрано):
    16 импортёров (recalc/inspector×6/engine-index/main/cable/
    shared·calc-modules×3) переведены на lib/electrical-methods/,
    js/methods/ удалён целиком (git rm), 0 residual-refs. Единый
    источник, без индирекции.
    hvac-methods ✅ (v0.60.595): air-balance/heat-gain META
    +standard/region/version/enabled; +air-balance-sprk.js (КЗ
    СН РК 4.02, своя META, ядро РФ); index.js реестр _ALL+enabled
    +ALL_META; METHOD_LIST=3.
    suppression-methods ✅ (v0.60.598): уже мультинорма (СП РК 2022 /
    СП 485 / +Прил.Д / NFPA 2001 / ISO 14520, каждый = файл, region
    был) — добавлены version/enabled; index.js реестр _ALL+enabled
    +ALL_META (METHODS/METHOD_LIST/run backward-compat для
    suppression-config). **D4/D5 завершены по ВСЕМ calc-libs**
    (gas/hydraulic/hvac/suppression) + электрика js/methods→lib.

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
  3b ✅ (v0.60.545) — единый CORE-резолвер `js/engine/module-paths.js`
  (MODULE_PATHS + moduleHref); переведены inspector `_CONFIGURATORS` +
  tx-ссылки, consumer/panel, export, tech-workspace `_MODULE_HREF`.
  Поведение идентично; move = правка ОДНОЙ карты.
  **Физ. переезд ✅ ЗАВЕРШЁН: пилот cooling (v0.60.546) + МАССОВО
  (v0.60.547)** — `scripts/mass-move.py` атомарно перенёс 25 UI-
  модулей в `apps/`, `suppression-methods` в `lib/` (git mv, история
  цела; relpath-пересчёт всех путей; importmap-блоки регенерированы;
  MODULE_PATHS/modules.json/hub/modules; tech-workspace Proxy;
  shared-хвост catalog/service/report-bridge). Не двигались CORE
  (`js/`), SHARED (`shared/`), лаунчеры (`hub.html`/`modules/`/
  `dev/`/`elements/`/`help/`), корневые файлы. Bare-импорты не
  менялись (авто-резолв importmap). Структура: `apps/` (UI) + `lib/`
  (calc-lib) + `shared/` + `js/` (CORE) + корень (лаунчеры).
  Пост-переезд (v0.60.549): manifest suppression-methods path
  синхронизирован (`lib/`); ARCHITECTURE.md §2 — явный лакмус
  «CORE-calc `js/` vs registered calc-lib `lib/`» (импортирует ли
  `recalc.js`).
- [ ] X.5.1 Schema-versioned JSON контракт всех типов данных проекта. `arch:17.1`
- [~] X.5.2 project-storage как интерфейс (LS/HTTP/IDB/**FS** транспорты). `arch:17.2,34`
  - Seam ✅ (v0.60.552): корень LS-неймспейса = ОДНА константа
    `APP_NS` в `shared/project-storage.js`; все построители ключей
    (projectKey/префиксы/copy/scan/import/export/clear) через неё
    (байт-идентично). schema-id экспорта намеренно стабилен
    (wire-format). `RENAME.md` — плейбук безболезненного
    переименования продукта (1 константа + idempotent LS-миграция
    + env `APP_URL`; контракты не трогаются).
  - [~] **FS-транспорт (запрос пользователя):** настройка «папка на
    ПК для локальных данных» — File System Access API.
    Сделано (v0.60.554): `showDirectoryPicker({startIn:'home'})` —
    диалог по умолч. в домашней папке; handle в IDB + permission
    re-grant + авто-запись по интервалу/при закрытии (было);
    4 alert()→in-page статус (memory no-dialogs); AbortError=не
    ошибка; UI-секция переформулирована «Локальные данные на ПК».
    [ ] Остаётся: полный FS-as-primary-транспорт за async-интерфейсом
    project-storage (load/save/list/remove), фолбэк на LS — отдельный
    инкремент, НЕ ломая sync-seam project-storage.
  - [ ] HTTP/IDB-транспорты (как было).
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
- [x] X.6.3 Кастомные сохраняемые шаблоны документов (модуль отчётов) — flow-редизайн завершён ПОЛНОСТЬЮ (R1–R6 + RR1-3 + DS1-4 Word-разделы + вкладка «Разделы» наглядный список v0.60.687). `arch:Фаза 29`
  - [x] Инк.1–5: image-зоны (печать/скан-подпись) + пресеты подпись/исполнитель;
    модель разделов `sections`+`effectiveContent`+вкладка «Разделы»;
    `pickTemplate` в tech-workspace ТЗ и service КП; persist manifest
    в выбранный шаблон (v0.60.645–650).
  - **РЕДИЗАЙН (discovery 2026-05-17): единый flow-документ.** Проблема:
    `content[]` + absolute `overlays[]` — независимые слои → структурные
    зоны (заголовок/адресат/подпись) накладываются поверх контента.
    Решение Пользователя: структурные элементы В ПОТОКЕ (резервируют
    место), полный редизайн, обе точки настройки (каталог + правка из
    превью), сразу. Фазы:
    - [x] **R1** модель `flow[]`/`floating[]` + `migrateToFlow()` +
      `effectiveFlow()` + структурные типы (v0.60.651).
    - [x] **R2** рендереры (preview/pdf/docx) на `effectiveFlow` +
      разворачивание структуры (expandStructural) + floating-слой
      (фон + печать/скан с anchor к подписанту) (v0.60.652–654).
    - [x] **R3** редактор перестроен на flow: R3a-core тело→flow
      сохранённого шаблона (v0.60.660); R3b editor.js переписан —
      вкладки Структура/Колонтитулы/Плавающий слой/Лист/Стили,
      WYSIWYG=PDF (v0.60.661, verified).
    - [x] **R4** быстрая правка из превью экспорта «⚙ Шаблон»
      (previewPDF rebuild) (v0.60.662).
    - [x] **R5** ТЗ (R5a-c) + КП (R5d) на flow, дедуп структуры,
      overlay-consume; комплектные встроенные шаблоны (R5e)
      (v0.60.655–659). Headline-наложение устранено, verified e2e.
    - [x] **RR1-3** общий конвейер `shared/report/compose.js`
      (`composeReport`): ВСЕ отчёты проекта (ТЗ, КП, ups-config,
      pdu-config, logistics, projects-мультидисц., cable, battery×2)
      на единый pickTemplate+flow+previewPDF+manifest/persist
      (v0.60.664–666, verified e2e). Все отчёты reports-via-module
      (window.open-HTML отсутствует — аудит).
    - [x] **DS1-4** Word-style разделы документа + обложка
      (запрос Пользователя): модель cover/firstPage/sectionBreak +
      mergePageGeom/contentBoxFor/flowSegments (DS1 v0.60.669);
      рендереры preview/PDF на переменную геометрию пер-странично
      (DS2a v0.60.670, нулевая регрессия verified e2e); редактор —
      «Разрыв раздела» + props, «Обложка/титул», «Первая страница»
      (DS3 v0.60.671, verified: sectionBreak→landscape в превью);
      DOCX мульти-Section (DS2c v0.60.672). Часть документа может
      быть альбомной, часть книжной — как в Word; отдельная обложка.
      Также фикс вёрстки редактора (v0.60.668).
    - [x] **R6** legacy absolute-overlay путь убран (v0.60.674):
      migrateToFlow конвертирует колонтитул-overlay → band header/
      footer, tpl.overlays=[]; рендер согласован с потоком, вкладка
      «Колонтитулы» авторитетна; migrateLegacyToOverlays нейтрализован.
      Verified e2e (ТЗ идентичен, консоль чистая). X.6.3 закрыт ПОЛНОСТЬЮ.
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
