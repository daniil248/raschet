# Raschet — Роадмап (модуль-ориентированный, сжатый)

> **Статус:** v0.60.597 (2026-05-17). Текущий приоритет — **архитектурная
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
  - X.4.5.1 D1: электрорасчёты — МОДУЛЬ, не ядро. Ядро = платформа
    `js/engine` (универсальная база всех схем). Переописать
    ARCHITECTURE-лакмус (электрика = calc-модуль класса lib/*-methods).
  - X.4.5.2 D2: модули нативно используются в др. модулях — смягчить
    закон импортов `contracts/README §3` + boundary-lint (cross-module
    нативный импорт calc-модуля допустим; сырой чужой LS — нет).
  - X.4.5.3 D3: Конструктор — универсальная база ВСЕХ типов схем с
    контекстом систем. ОТМЕНЯЕТ v0.60.277/278. UI контекстно
    фильтруется по активной системе/дисциплине; членство может жить
    в Конструкторе контекстно.
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
    +ALL_META; METHOD_LIST=3. Осталось: suppression мультинорма.

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
