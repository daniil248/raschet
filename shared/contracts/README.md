# Raschet — Контракты платформы (шов Ядро ↔ Модули)

> Спецификация v1 (2026-05-16). Источник правды для границ между
> Ядром, Shared-контрактами, модулями, каталогами и standalone-app.
> Сопровождается: `storage-keys.md`, `cross-module-events.md`,
> `url-params.md`, `lint-allowlist.json`, корневой `CONTRIBUTING.md`.
> Архитектурный мастер-план: `dapper-munching-petal.md`.

## 1. Слои (пересмотрено 2026-05-17 — D1/D2, memory:architecture_layers)

| Слой | Где | Может импортировать | Импортируется |
|---|---|---|---|
| **CORE** (платформа) | `js/engine/*` — schematic-редактор: state/render/serialization/interaction/geometry/history. Владеет `APP_VERSION` (`js/engine/constants.js`) | CORE, CALC-LIB, SHARED, CATALOGS | модулями, shared |
| **CALC-LIB** (расчётные модули) | `lib/*-methods/*` (gas/hydraulic/hvac/suppression/**electrical**) + `js/calc/*`. **D1:** электрорасчёты — МОДУЛЬ, не ядро | CORE, CALC-LIB, SHARED, CATALOGS | **нативно кем угодно** (module/core/shared) — **D2** |
| **SHARED-CONTRACTS** | `shared/*` (см. §2) | CORE, CALC-LIB, shared, CATALOGS | модулями |
| **CATALOGS** | `shared/catalogs/*`, `shared/*-seed.js`, `shared/ups-types/*`, `shared/battery-types/*`, `shared/por-types/*` | ничего | модулями, shared |
| **PLUGGABLE-MODULES** | `<module>/` со своим `index.html` | CORE, CALC-LIB, SHARED, CATALOGS | — |
| **STANDALONE-APPS** | подмножество модулей `kind:"ui"`, `standalone:true` | как модуль | — |

**D1** (директива Пользователя 2026-05-17): «ядро программы» = ПЛАТФОРМА
схемного редактора (`js/engine`), универсальная база ВСЕХ типов схем.
Электротехнические *расчёты* — calc-МОДУЛЬ класса `lib/*-methods`
(`js/calc`; электрика физически перенесена в `lib/electrical-methods`,
v0.60.593). **D2**: модули могут НАТИВНО использовать calc-модули
(прямой импорт `lib/*`/`js/calc` разрешён). Сырой чужой LS —
по-прежнему только через helpers (R2). Запрет «module→внутренности
ДРУГОГО pluggable-модуля» сохранён (calc-lib — НЕ pluggable-модуль).

## 2. Что относится к SHARED-CONTRACTS (шов)
`project-storage.js`, `project-context.js`, `configuration-catalog.js`,
`history-log.js`, `module-nav.js`, `subscriptions.js`,
`selection-panel.js`, `money.js`, `report/*`, `calc/*`,
`currency-rates/*`, `ui/*`, `element-library.js`, `app-header.js`,
`dialog.js`, `disciplines.js` (реестр-шов дисциплин ↔ calc-lib
`lib/<id>-methods`, X.4.1; чистые данные, БЕЗ import lib — `calcLib`
лишь bare-строка для `import()` потребителем), и объявленные мосты
`shared/<module>-bridge.js` (service-bridge, scheme-rack-bridge,
inventory-bridge, meteo-bridge, legacy-rack-migration).

## 3. Закон импортов (АКТУАЛИЗИРОВАН 2026-05-17 — D1/D2 применены)

D1/D2 РЕАЛИЗОВАНЫ в `tools/boundary-lint.mjs` (X.4.5.1/.2,
v0.60.599): ядро = только `js/engine/*`; `lib/*` + `js/calc/*` =
класс **CALC-LIB** (отдельный от module); `js/methods` удалён
(электрика → `lib/electrical-methods`).

**Разрешено:** `module → CORE | CALC-LIB | SHARED | CATALOGS`;
`CORE → CORE | CALC-LIB | SHARED | CATALOGS`;
`CALC-LIB → CORE | CALC-LIB | SHARED | CATALOGS`;
`SHARED → CORE | CALC-LIB | SHARED | CATALOGS`; `CATALOGS` — без
импортов. **D2:** calc-модуль (`lib/*`, `js/calc`) импортируется
НАТИВНО любым слоём (это отдельный класс, не `module` — правила
запрета бьют только по `tgt==='module'`). *(Аудит 2026-05-16: ядро
`js/engine/*` использует `shared/*` — нижний стабильный шов;
запрещена лишь зависимость ядра от ПОДКЛЮЧАЕМОГО модуля.)*

**Запрещено (жёсткие правила boundary-lint):**
- `CORE → <pluggable-module>` (ядро не зависит от подключаемого
  модуля; CALC-LIB — НЕ pluggable-модуль, импорт ядром разрешён).
- `SHARED → <module>` (включая `*-seed.js`/CATALOGS → модуль).
  Бывшее нарушение `battery-seed → battery/battery-catalog` погашено
  (v0.60.525): каталог АКБ перенесён в `shared/battery-catalog.js`
  (зеркало `shared/ups-catalog.js`), старый путь — shim.
- `<module>/** → ../<другой-module>/**` (импорт во внутренности
  соседа). Кросс-модульное общение — ТОЛЬКО через контракты §4.
- `CATALOGS → <module>`.

**Исключение — мосты:** `shared/<m>-bridge.js` и
`shared/legacy-rack-migration.js` — санкционированный слабый адаптер
(§4.5): вправе импортировать модуль и читать мульти-модульные LS;
исключены из всех импортных правил и из R2.

**R2 ЗАКРЫТО (v0.60.551..559, Фаза 2):** сырой чужой
`localStorage` ключ `raschet.(project|projects|configurations|
subscription).*` literal/template вне `project-storage.js`/
`configuration-catalog.js`/`subscriptions.js`/`project-context.js`/
`project-bootstrap.js`/моста. Все genuine случаи погашены через
`projectKey`/`projectPrefix`/`projectModulePrefix` (модули + бриджи
проверены сканом — 0 raw project/sketch литералов). Остаток
`raschet.*` — санкц. НЕ-проектные глобальные ns (см.
`lint-allowlist.json` advisoryNotes.R2-raw-foreign-ls). Статус:
advisory (WARN); готово к graduation advisory→enforced (CI, Фаза F).

## 4. Каналы кросс-модульного общения (единственно допустимые)
1. **project-storage** — данные проекта (ключи `raschet.project.<pid>.
   <module>.<key>.v<schema>`); читать/писать только helpers. См.
   `storage-keys.md`.
2. **configuration-catalog** — библиотеки конфигураций/selection-meta
   (`listConfigs/getSelectionMeta/saveSelectionMeta/…`).
3. **module-nav** — навигация/embed-return между модулями
   (`?project=`, embed `?return=…`, `raschet.nav.return.<S>.payload`).
   См. `url-params.md`.
4. **DOM-события** — `rs-selection-change`, `rs-cs-focus`,
   `rs-cs-context` и др. См. `cross-module-events.md`.
5. **`shared/<module>-bridge.js`** — объявленный слабый адаптер
   (handoff, sync). Только он вправе знать о двух модулях сразу.

Никаких прямых относительных импортов в соседний модуль; никаких
сырых чужих LS-ключей вне §4.

## 5. boundary-lint (реализация — `tools/boundary-lint.mjs`, Фаза 0 ✅)
Резолвит относительные импорты в репо-путь и классифицирует по слою.
Жёсткие правила (fail при НОВОМ, не в allowlist):
- **R1-cross-module-import** — файл модуля импортирует внутренности
  другого модуля (резолв в чужой module-dir).
- **R3-core-imports-module** — `js/engine|calc|methods` → модуль.
- **R4-catalog-imports-module** — `shared/catalogs|*-seed|*-types|
  por-types` → модуль.
- **R-shared-imports-module** — `shared/*` (не мост) → модуль.
Advisory (не блокирует, Фаза 2):
- **R2-raw-foreign-ls** — сырой чужой `raschet.(project|projects|
  configurations|subscription).*` literal/template (эвристика).
- **WARN (i18n)** — новые кириллические UI-литералы вне `t(...)`
  (вводится в i18n-фазе).
Мосты исключены (см. §3). Санкционированный baseline — машинный
`lint-allowlist.json` (`allow[]`, ключ `rule::file::target`); CI
зелёный с дня 1, каждое гасится по тикету ROADMAP X.1.3.
`node tools/boundary-lint.mjs --update-baseline` пересобирает baseline.

## 6. Манифест модуля — `<module>/manifest.json`
Схема (Фаза 1; генерирует корневой `modules.json` v1.2.0 через
`tools/gen-modules-json.mjs` на commit, НЕ на deploy):

```json
{
  "id": "cooling",
  "name": "Подбор холодильных систем",
  "version": "1.0.0",
  "owner": "<git-user|команда>",
  "kind": "ui",
  "standalone": false,
  "path": "cooling/",
  "badge": "active",
  "enabled": true,
  "internalOnly": false,
  "subscriptionPlan": "pro",
  "requires": ["shared/auth"],
  "dependsOnContracts": {
    "storageKeys": ["raschet.project.<pid>.cooling.selections.v1"],
    "events": { "emits": ["rs-selection-change"], "consumes": [] },
    "urlParams": ["project", "requiredCoolingKw"],
    "bridges": ["meteo-bridge"]
  },
  "lsNamespacesOwned": ["cooling"],
  "dbCollections": ["projects"],
  "permissions": ["module.use"]
}
```
Поля совместимы с текущим `modules.json` v1.1.0 (id/name/path/icon/
badge/kind/subscriptionPlan/internalOnly/enabled/requires/
dbCollections/permissions) + добавлены `version/owner/standalone/
dependsOnContracts/lsNamespacesOwned` (учитывают RBAC, internalOnly,
module-scope-pickers — memory).

CI-валидатор (Фаза 0): каждый `manifest.json` ↔ запись в корневом
`modules.json` согласованы; схема валидна; объявленные storageKeys/
events существуют в `storage-keys.md`/`cross-module-events.md`.

## 7. Жизненный цикл модуля
- **Вход:** добавить `<module>/manifest.json` + запись в
  `module-changelogs.js` + карточку в `/modules/` (memory:modules_index)
  + (опц.) `subscriptionPlan/internalOnly`. CI-валидатор зелёный.
- **Изменение:** ветка `mod/<id>`, bump `version` в manifest +
  changelog + (при пользовательском изменении) `APP_VERSION`, синк
  status-header ROADMAP, verify (curl version + Claude-in-Chrome
  console-clean + smoke), deploy = merge в main.
- **Депрекация:** `enabled:false` в manifest; данные/ключи —
  миграция или soft-delete (history-log); запись в архив-роадмап.

## 8. Версионирование данных
LS/экспорт-ключи несут `vN`. Новые поля — опциональны (минор);
удаление/смена смысла — мажор (см. X.5.1 schema-versioned JSON).
Контракт не считается нарушенным, пока старые `vN` читаются.
