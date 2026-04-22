# Raschet — Roadmap архитектурного развития платформы

> **Статус:** Фаза 0 ✅ (v0.41.0). Фаза 1.1-1.4 ✅ (v0.44.0). Добавлены Фаза 1.5 (полноценный модуль catalog/ с ценами + контрагентами) и Фаза 1.6 (рабочее место логиста). В работе: 1.5.1 схемы price-records и counterparty.
> **Цель:** превратить набор специализированных калькуляторов в единую платформу проектирования электрических (и позже — механических) схем с общей библиотекой элементов, мульти-пространственными видами, 3D, правами пользователей и расширяемыми БД-адаптерами.

---

## Как использовать этот документ

Документ лежит в git (`ROADMAP.md`) и доступен в любой сессии чата. Перед началом работы прочитай:

1. Этот файл — понять где остановились
2. Модуль `changelog/` и git-лог — последние коммиты и фазы
3. `C:\Users\sedko\.claude\projects\D--Works-ClaudeProject-raschet\memory\MEMORY.md` — предпочтения пользователя (deploy, style, input-event, версионирование)

После каждой выполненной фазы/подфазы — ставь галочку в соответствующем чеклисте. История изменений — в отдельном модуле, сюда не дублируется.

---

## Контекст проекта

Платформа `https://daniil248.github.io/raschet/` состоит из:

- **Конструктор схем** (`index.html` + `js/engine/*`) — главный, drag-n-drop граф электроснабжения
- **Расчёт кабельной линии** (`cable/`) — standalone калькулятор IEC/ПУЭ
- **Схема принципиальная** (`schematic/`) — SVG редактор IEC 60617 с ISO paper sizes
- **Расчёт АКБ** (`battery/`) — подбор батарей по таблицам разряда
- **Конфигуратор ИБП** (`ups-config/`) — WIP
- **Конфигуратор щита** (`panel-config/`) — WIP
- **Конфигуратор трансформатора** (`transformer-config/`) — WIP
- **Шаблоны отчётов** (`reports/`) — конструктор PDF/DOCX
- **3D конфигуратор** (`configurator3d/`) — untracked прототип three.js (не интегрирован)

**Общая инфраструктура:**
- `shared/global-settings.js` — единый источник настроек (**закреплено в Фазе 0.1**)
- `shared/{panel,ups,battery,transformer}-catalog.js` — 4 per-user каталога (будут унифицированы в Фазе 1)
- `shared/cable-types-catalog.js` — каталог кабелей (**создан в Фазе 0.3**)
- `shared/catalog-xlsx-parser.js` — унифицированный парсер XLSX для 3 каталогов
- `shared/report/` — конструктор отчётов (PDF/DOCX)
- `shared/auth.js` — Firebase OAuth + localStorage fallback
- `js/projects.js` — dual-adapter storage (Firestore/localStorage)
- `js/engine/state.js` — central state: nodes, conns, pages, zones, modes
- `js/engine/zones.js` — рекурсивные зоны с `effectiveTag()` (префикс `"Z1.AC1"`)
- `modules.json` — манифест модулей (**создан в Фазе 0.5**)

**Память пользователя** (важно для сотрудничества):
- Делать молча, не переспрашивать, минимум слов
- После push — проверить деплой через ~45 сек (`WebFetch https://daniil248.github.io/raschet/...`)
- Каждый коммит — обновлять `APP_VERSION` в `js/engine/constants.js`
- В таблицах с re-render использовать `change` event а не `input` (фокус теряется)
- Коммит-сообщение: номер версии + структурированный changelog с файлами

---

## Фазы разработки

### ✅ Фаза 0 — Подготовка фундамента (v0.41.0, завершена)

- [x] **0.1** Единый источник правды GLOBAL (`engine/index.js` загружает через `loadGlobal()`, `setGlobal()` вызывает `saveGlobal()`)
- [x] **0.2** `VOLTAGE_CATEGORIES = {lv,mv,hv,dc}` + `deriveVoltageCategory()` + миграция
- [x] **0.3** `CABLE_CATEGORIES` (power/hv/signal/data/fieldbus/dc) + `shared/cable-types-catalog.js` с 16 базовыми типами
- [x] **0.4** `CONNECTION_KINDS` (electrical/pipe/duct/data) + select в инспекторе
- [x] **0.5** `modules.json` с описанием 8 модулей
- [x] **0.6** `panel-catalog` схема расширена: `material`, `maxHeatDissipationW`; `inputs/outputs/sections` помечены DEPRECATED

**Критичные файлы Фазы 0:**
- `js/engine/constants.js` (VOLTAGE_CATEGORIES, CABLE_CATEGORIES, CONNECTION_KINDS)
- `js/engine/electrical.js` (migrateVoltageLevels с category)
- `js/engine/index.js` (loadGlobal/onGlobalChange)
- `shared/global-settings.js` (DEFAULTS с category, _migrateVoltageLevels)
- `shared/cable-types-catalog.js` (новый, 16 базовых типов)
- `shared/panel-catalog.js` (новая схема)
- `modules.json` (новый, манифест 8 модулей)

---

### 🚧 Фаза 1 — Element Library (в работе, срок 3-4 недели)

**Цель:** один единый справочник элементов вместо 4 раздельных (panel, ups, battery, transformer) + кабели + пользовательские типы потребителей. Элемент хранит: электрика, геометрия, порты, представления для разных типов схем, состав (для модульных).

#### Подфаза 1.1 — Element schema и ElementLibrary API (1 неделя) ✅

- [x] **1.1.1** Создан `shared/element-library.js`:
  - Схема `Element { id, kind, category, label, electrical, geometry, views, composition, kindProps, source, tags, createdAt, updatedAt }`
  - API: `listElements({kind, category, tag, manufacturer})`, `getElement(id)`, `saveElement(el)`, `removeElement(id)`, `cloneElement(id, newName)`, `exportLibraryJSON()`, `importLibraryJSON(json, mode)`, `clearUserElements()`, `onLibraryChange(cb)`
  - Per-user localStorage: `raschet.elementLibrary.v1.<uid>`
  - 11 kind'ов в `ELEMENT_KINDS`: panel/ups/battery/transformer/breaker/enclosure/climate/consumer-type/cable-type/channel/custom
  - Builtin vs user через `_builtins` Map + `registerBuiltin`/`registerBuiltins`/`clearBuiltins`
  - User не может перезаписать builtin (бросает ошибку)

- [x] **1.1.2** Создан `shared/element-schemas.js`:
  - Factory-функции `createPanelElement/createUpsElement/createBatteryElement/createTransformerElement/createCableTypeElement/createBreakerElement/createConsumerTypeElement/createEnclosureElement/createClimateElement`
  - Универсальный `createElement(kind, patch)` с дефолтами
  - Конвертеры legacy ↔ Element: `fromPanelRecord/toPanelRecord`, `fromUpsRecord/toUpsRecord`, `fromBatteryRecord/toBatteryRecord`, `fromTransformerRecord/toTransformerRecord`, `fromCableTypeRecord/toCableTypeRecord`

- [x] **1.1.3** MVP редактор `elements/` (v0.44.0):
  - `elements/index.html` + `elements.css` + `elements-editor.js`
  - Список элементов с группировкой по kind, статистикой и бэйджами (builtin/user/imported)
  - Фильтры: kind, source, свободный поиск (по label/manufacturer/series/variant/id)
  - Actions: view (read-only JSON), edit (user only), clone (builtin+user), delete (user only)
  - Форма редактирования: простые поля (id/kind/label/manufacturer/series/variant/description/tags) + JSON textarea для electrical/geometry/kindProps/composition
  - Create: через prompt ID + пустая форма
  - Import/Export JSON (merge/replace modes)
  - Reactive UI через `onLibraryChange`
  - initCatalogBridge() вызывается — страница видит все legacy-каталоги как builtin
  - Зарегистрирован в `modules.json` + карточка в `hub.html`
  - **НЕ включено в MVP:** загрузка SVG для views, визуальный редактор портов, drag-n-drop composition — откладывается до Фазы 2

#### Подфаза 1.5 — Полноценный модуль catalog/ (1.5-2 недели) 🆕

**Задача пользователя:** `elements/` должен стать отдельным полноценным модулем управления библиотекой/каталогами — с импортом, ценами, контрагентами.

- [x] **1.5.1** Схемы данных (закрыто 2026-04-20):
  - `shared/price-records.js` — `PriceRecord` со всеми полями + расширенные:
    `validFrom/validUntil`, `quantity/MOQ`, `unitOfMeasure`, `discount`,
    `vat`, `vatIncluded`, `conditions`. 6 типов цен (`PRICE_TYPES`) и 6
    валют (`CURRENCIES`). API: `listPrices/getPrice/savePrice/
    removePrice/bulkAddPrices/pricesForElement`, `exportPricesJSON/
    importPricesJSON`, `onPricesChange`.
  - `shared/counterparty-catalog.js` — `CounterpartyRecord` +
    `COUNTERPARTY_TYPES` (7 типов включая warehouse/customer).
    API: `listCounterparties/getCounterparty/saveCounterparty/
    removeCounterparty/makeCounterpartyId/validateInn/onCounterpartiesChange`.
  - Per-user localStorage через `currentUserId()` префикс.
  - Валидация: `savePrice` не позволяет привязать цену к non-pricable
    kind (cable-type линейка — только cable-sku).

- [x] **1.5.2** Новый модуль `catalog/` (закрыто 2026-04-20):
  - `catalog/index.html` + `catalog.js` + `catalog.css`: 5 табов
    (Элементы / Цены / Контрагенты / Импорт / **Аналитика** — бонус).
  - Tab «Элементы»: список с колонкой последней цены, badges
    builtin/user/imported, filters (kind/source/search), действия
    view/edit/clone/delete, «+ Цена» inline, переход «view-prices».
  - Tab «Цены»: `listPrices` с 4 фильтрами (по элементу/контрагенту/
    priceType/currency), сортировка по recordedAt desc.
  - Tab «Контрагенты»: CRUD + фильтр по типу + поиск.
  - `elements/` остаётся как quick-access editor.

- [x] **1.5.3** CRUD цен (закрыто 2026-04-20):
  - `openPriceModal` в catalog.js: Элемент picker + Цена + Валюта +
    Контрагент + Тип цены + Источник + Примечания.
  - `bulkAddPrices` для массовой вставки (используется в импорте XLSX).
  - Редактирование/удаление в таблице цен.
  - _Не реализовано:_ paste-from-clipboard в массовом вводе (есть XLSX
    импорт, этого достаточно).

- [x] **1.5.4** Управление контрагентами (закрыто 2026-04-20):
  - renderCounterpartiesTab + openCounterpartyModal в catalog.js.
  - Поиск по имени/ИНН/КПП/адресу/телефону/email (`listCounterparties`
    filter.search объединяет все поля).
  - `validateInn` (10/12 цифр) в счем. Быстрое добавление inline
    в форме цены через dropdown.

- [x] **1.5.5** Импорт XLSX прайс-листов (v0.57.92):
  - ✅ Drag-drop нескольких файлов, парсинг XLSX через SheetJS.
  - ✅ Авто-маппинг колонок по regex на заголовки.
  - ✅ UI маппинга с dropdown «Колонка файла → Поле прайса».
  - ✅ Привязка к контрагенту на файл + тип цены + источник.
  - ✅ Dry-run preview (первые 5 строк) перед применением.
  - ✅ Импорт JSON (backup) для prices и library.
  - ✅ **v0.57.92:** per-row counterparty override — новая колонка маппинга «Контрагент (per-row)», regex включает counter/vendor/supplier/контрагент/поставщик/продавец. Значение в строке файла приоритетнее глобального выбора; резолвится через Map(id) и Map(shortName/name), неопознанные считаются fallback-глобалом и показывают предупреждение в flash-сообщении.
  - ✅ **v0.57.92:** история импортов (`listImportBatches` в price-records.js) + откат (`rollbackImportBatch(source, minuteBucket)`). UI в tab «Импорт» → секция «История импортов»: таблица (Источник / Дата-время / Записей / Элементов / Валюты / Контрагенты / Откатить). Кнопка «↩ Откатить» удаляет все записи из партии (минутное окно `createdAt / 60000`).

- [x] **1.5.6** Статистика и аналитика (v0.57.89):
  - ✅ Tab «Аналитика» в catalog/: stat cards (элементов / контрагентов /
    цен / с ценами / без цен / устаревшие >90д).
  - ✅ Топ-5 контрагентов по числу цен.
  - ✅ Список элементов без цен с inline «+ Цена».
  - ✅ В табе «Элементы» — колонка с последней ценой на элемент.
  - ✅ **v0.57.89:** колонка «Мин / Макс» + Δ% (только при одной валюте).
  - ✅ **v0.57.89:** колонка «Динамика» со sparkline (SVG polyline 90×24, точки по recordedAt, цвет по тренду red↗/green↘/grey→, подпись `↗/↘/→ N%`, tooltip с first→last и % изменения). Функция `renderPriceSparkline(priceInfo)` в catalog/catalog.js.
  - ⏳ _Не реализовано (опционально):_ отдельная панель алертов устаревших цен.

- [x] **1.5.7** Интеграция с BOM (v0.45.1):
  - `shared/bom.js`:
    - `resolveUnitPrice(elementId, { strategy, currency, counterpartyId, activeOnly })` — 5 стратегий (latest/min/max/avg/counterparty)
    - `PRICE_STRATEGIES` экспорт для UI
    - `aggregateBom(items, opts)`: если `opts` заданы — каждая строка получает unitPrice / currency / totalPrice / priceSource
    - `bomTotals(aggregated)`: сумма по валютам + missingCount / pricedCount
    - `collectBomFromProject(state, opts)` принимает opts, возвращает `{ flat, aggregated, totals }`
  - `js/engine/report-sections.js` → `sectionBom`:
    - Вызов с `{ priceStrategy: 'latest', activeOnly: true }` по умолчанию
    - Колонки «Цена за ед.» + «Итого» появляются если есть хоть одна цена
    - Строки ИТОГО по валюте
    - Предупреждение о позициях без цены со ссылкой на модуль catalog
  - `window.Raschet.getBom(opts) / getBomMarkdown(opts) / getPriceStrategies()`

**Критичные файлы 1.5:**
- `shared/price-records.js` (новый)
- `shared/counterparty-catalog.js` (новый)
- `catalog/index.html`, `catalog/catalog.css`, `catalog/catalog.js` (новые)
- `catalog/tab-elements.js`, `catalog/tab-prices.js`, `catalog/tab-counterparties.js`, `catalog/tab-import.js`
- `shared/catalog-xlsx-parser.js` — расширение на прайс-листы
- `shared/bom.js` — интеграция цен

---

#### Подфаза 1.6 — Рабочее место логиста (2 недели) 🆕

**Задача пользователя:** модуль расчёта логистики. Проект → расчёт доставки, складирования, итоговой стоимости с логистикой.

- [x] **1.6.1** Схемы данных (закрыто 2026-04-20):
  - `shared/logistics-schemas.js` объединяет всё: Warehouse, CarrierRate,
    Shipment в одном модуле.
  - `WarehouseRecord`: id/name/counterpartyId/type/address/capacityM3/
    costPerM3Day/leadDays. 5 типов (`WAREHOUSE_TYPES`: own/rented/
    supplier/customer/transit).
  - `CarrierRate`: id/carrierId/mode/unitRUB/perKg/perKm/perM3/minOrder/
    note. 6 режимов (`SHIPMENT_MODES`).
  - `ShipmentRecord`: id/projectId/label/status/mode/carrierId/originId/
    destinationId/items[]/cost/currency/plannedAt/deliveredAt/notes.
    5 статусов (`SHIPMENT_STATUSES`).
  - `calcShipmentCost(items, rate, opts)` — калькулятор с breakdown по
    fixed/perKg/perKm/perM3 + minOrder clamp.
  - Per-user localStorage, listener API для всех трёх.

- [x] **1.6.2** `logistics/` module UI (закрыто 2026-04-20):
  - `logistics/index.html` + `logistics.js` + `logistics.css`, 4 таба:
    Отправления / Склады / Тарифы / Расчёт.
  - Печать ТТН / проформы через встроенный HTML-шаблон
    (`table.items` со стандартными полями).

- [x] **1.6.3** Интеграция с BOM + ценами (закрыто 2026-04-20):
  - `js/engine/export.js`: кнопка «🚚 Передать в логистику» в боковой
    панели Конструктора. Сохраняет handoff в localStorage и открывает
    `logistics/?import=1` с projectId.
  - `js/engine/report-sections.js:sectionLogistics` — раздел «Логистика
    и доставка» в BOM-отчёте: фильтрует shipments по текущему projectId,
    выводит таблицу с маршрутом, массой, объёмом, стоимостью товаров и
    перевозки, итоговой сметой.

- [ ] **1.6.4** Маршрутизация (опционально, Фаза 1.6.4+):
  - Несколько точек доставки (мультистоп)
  - Учёт складов-хабов (Москва → региональный склад → стройплощадка)
  - Оптимизация по стоимости / времени

**Критичные файлы 1.6:**
- `shared/warehouses.js`, `shared/shipments.js`, `shared/logistics-rates.js` (новые)
- `logistics/index.html`, `logistics/logistics.css`, `logistics/logistics.js` (новые)
- `logistics/tab-*.js` — по таб для каждой секции
- Интеграция в `shared/report/` — блок «Логистика»
- Интеграция в `js/engine/inspector/` — кнопка «Рассчитать логистику»

---

#### Подфаза 1.2 — Bridge и миграция существующих каталогов (1 неделя) 🚧

- [x] **1.2.0** Создан `shared/catalog-bridge.js` (v0.42.1):
  - `syncLegacyToLibrary()` — Promise.all чтение 5 legacy каталогов (panel/ups/battery/transformer/cable-types), конвертация через `from*Record`, регистрация как `builtin` через `registerBuiltins()`
  - Lazy dynamic imports (battery-catalog: пробует `./battery-catalog.js` и `../battery/battery-catalog.js`)
  - `initCatalogBridge()` — idempotent, первый sync + `storage`-event listener для cross-tab pre-синхронизации
  - Интегрирован в `js/engine/index.js` сразу после `onGlobalChange()` подписки
  - Read-only: редактирование продолжает идти через legacy API (`addPanel`, `addUps`…)
  - **Результат:** новые подпрограммы (elements editor, BOM) могут работать через `listElements({kind:'X'})` и видят все данные из legacy-каталогов

- [x] **1.2.1** Same-tab sync listeners (v0.42.2):
  - Добавлены в каждый legacy-каталог: `onPanelsChange/onUpsesChange/onBatteriesChange/onTransformersChange/onCableTypesChange`
  - `_notify()` вызывается после каждого `_write()` в каталоге
  - `catalog-bridge` подписывается через dynamic import + `_subscribeSameTab()`
  - Debounced re-sync (50ms) во избежание повторных обходов при bulk-импорте (XLSX)
  - **Эффект:** `addPanel()` в том же tab — и `listElements({kind:'panel'})` сразу видит новую запись без перезагрузки

- [ ] **1.2.2** Переключение внутренней реализации каталогов на Element-API — **отложено до 1.3+**:
  - `shared/panel-catalog.js`: `listPanels()` → `listElements({kind:'panel'}).map(toPanelRecord)`
  - `addPanel(rec)` → `saveElement(fromPanelRecord(rec))`
  - API остаётся (backward compat)
  - Миграция старых localStorage при первой загрузке (копирование → element-library)
  - Аналогично `ups/battery/transformer/cable-types-catalog`

  **Обоснование отложения (оценка 2026-04-19):**
  - Legacy-каталоги содержат специфичные поля (dischargeTable, vectorGroup, ukPct, moduleKwRated, cable.category/material/fireResistant), которые legacy-код (catalog-manager, pickers, инспекторы) читает напрямую (`record.capacityKw`, не `record.kindProps.capacityKw`). Замена storage backend требует либо (а) двойных конвертеров на каждом чтении, либо (б) рефакторинга всего UI — оба варианта = высокий риск регрессий без тестов.
  - Bridge уже обеспечивает единый read через `listElements()` — новые фичи (BOM, elements editor, поиск) работают без объединения.
  - Strangler fig: сначала freeze legacy, потом flip. Freeze достигается когда весь новый код работает через `listElements()` — это произойдёт в 1.3 (BOM) и 1.4 (ups-config).
  - Риск-бенефит: объединение сейчас = 5 каталогов × миграция + regressions vs. 1 новая фича (BOM) за то же время.
  - **План:** сделать 1.2.2 в Фазе 1.5 (или как микро-подфаза после 1.4), когда весь новый код уже не зависит от нативных схем.

- [x] **1.2.3** `catalog-xlsx-parser.js` — v0.57.85:
  - `parseXlsx(buffer, {kind})` реализован через dispatch к существующим per-kind парсерам (parseUpsXlsx/parsePanelXlsx/parseTransformerXlsx) + ленивый импорт `element-schemas.js` для конвертации legacy → Element
  - Возвращает `{kind, filename, elements, legacy, errors}` — `legacy` сохранён для обратной совместимости с существующими addUps/addPanel/addTransformer
  - `supportedParseXlsxKinds()` — список поддерживаемых kind'ов
  - Поддерживаются: `ups`, `panel`, `transformer`. Battery и cable-type SKU остаются через отдельные пайплайны (battery-data-parser, catalog/tab-import)

#### Подфаза 1.3 — Phantom элементы и BOM (1 неделя) ✅

- [x] **1.3.1** `element.composition: [{elementId, qty, phantom, role}]`:
  - Заложено в `shared/element-library.js` (Element.composition)
  - `expandComposition(element, multiplier, depth, seen, path)` в `shared/bom.js` — рекурсивно, с защитой от циклов (per-branch seen Set)
  - Phantom-признак переносится с ref'а в развёрнутый item (composition-ref может помечать phantom независимо от самого элемента)

- [x] **1.3.2** BOM-генератор `shared/bom.js`:
  - `bomForNode(node)`: 3 стратегии — (1) node.elementId → library, (2) node.composition inline, (3) placeholder по node.type
  - `collectBomFromProject(state)`: обход `state.nodes`, агрегация
  - `aggregateBom(items)`: группировка по `(elementId, role)` или `(label, kind)` для без-id, суммирование qty
  - `groupBomByKind(agg)`: под-группировка для отчёта
  - `bomToMarkdown(agg)`: markdown-таблица (используется в будущем для быстрого превью)
  - Экспорт в `window.Raschet.getBom()` + `getBomMarkdown()` для консоли/внешних консьюмеров

- [x] **1.3.3** Интеграция с отчётами:
  - `js/engine/report-sections.js`: новая секция `sectionBom()`, зарегистрирована как `id: 'bom'` в `getReportSections()`
  - Группировка по kind с человекочитаемыми подписями (ИБП, Щиты, АКБ, Трансформаторы...)
  - Phantom-элементы помечены звёздочкой
  - defaultTemplateId: `builtin-bom-landscape` (альбомная)

#### Подфаза 1.4 — Конфигуратор ИБП из Конструктора схем (1 неделя)

- [x] **1.4.1** BOM резолвит legacy-поля узла как `elementId` (v0.43.1):
  - `_resolveLegacyElementId(node)` в `shared/bom.js`: проверяет `node.elementId` → `upsCatalogId` → `panelCatalogId` → `enclosureId` → `transformerCatalogId`
  - `_syntheticUpsComposition(node)`: для ИБП с `batteryCatalogId` + `batteryStringCount` × `batteryBlocksPerString` — генерирует синтетическую ссылку на АКБ
  - В `bomForNode`: label корня заменяется на `"<node.name> (<element.label>)"` — BOM показывает и пользовательское имя узла, и модель
  - Результат: выбор модели ИБП в инспекторе (сохраняется в `n.upsCatalogId` через `applyUpsModel`) автоматически попадает в BOM без изменений в инспекторе
- [x] **1.4.2** Кнопка в инспекторе ИБП «Сконфигурировать подробно» (v0.43.2):
  - Ссылка `<a href="ups-config/?nodeId=X&selected=Y&capacityKw=Z&upsType=W" target="_blank">` в верхней части модалки ИБП
  - Передаёт контекст через URLSearchParams
- [x] **1.4.3** Storage-канал возврата из `ups-config/` (v0.43.2):
  - ups-config показывает sticky-баннер «Открыто из Конструктора схем» когда URL содержит `?nodeId=...`
  - При клике «Применить к схеме» пишет в `localStorage['raschet.pendingUpsSelection.v1']` = `{ nodeId, ups, selectedAt }`
  - `ups-config` пытается закрыть свою вкладку через 2 сек
  - `js/engine/index.js` слушает `focus` + `storage` event, при наличии payload: `applyUpsModel(node, payload.ups)` + снимок истории + re-render
  - TTL 5 минут: устаревшие payload игнорируются и удаляются
  - Через applyUpsModel узел получает `upsCatalogId` → BOM автоматически включает ИБП
- [x] **1.4.5** Конфигуратор ИБП — wizard (закрыто v0.57.87):
  - `ups-config/ups-config.js` — трёхшаговый wizard (исходные данные → подбор → итог/применение), активируется при `?nodeId=...`
  - Шаг 1 «Исходные данные»: поля `loadKw / autonomyMin / redundancy (N|N+1|N+2|2N) / upsType / vdcMin/Max / cosPhi / phases`, предзаполнение из query-параметров инспектора
  - Шаг 2 «Подбор»: фильтрация каталога по `upsType` и пересечению Vdc-диапазона, `_calcModules()` для модульных (working + redundant ≤ slots), `_pickSuitable()` с авто-выбором первого по утилизации + цена из price-records
  - Шаг 3 «Итог»: сводная таблица, `_buildComposition()` формирует `composition: [{elementId, qty, role}]`, кнопка «Применить» → `raschet.pendingUpsSelection.v1`
  - `js/engine/index.js:_tryConsumePendingUpsSelection()` — применяет `configuration.*` полностью (capacityKw / moduleInstalled / frameKw / moduleKwRated / moduleSlots / redundancyScheme / batteryVdcMin/Max / batteryAutonomyMin / composition)
  - **v0.57.87 дополнение:** inspector/ups.js расширил набор query-параметров (targetAutonomyMin, redundancy, vdcMin/Max, cosPhi, phases) — wizard теперь предзаполняется из узла, а не из статических дефолтов
  - АКБ подбирается отдельно через 1.4.4 (battery picker + battery-calc)

~~Старый план на 5 шагов (frame / modules / batteries / accessories) не реализован как отдельные шаги — слит в 3, поскольку для современных модульных ИБП шаги «frame+modules» неотделимы (фрейм определяет moduleSlots и moduleKwRated). При необходимости разнесения — см. TODO 1.4.6.~~

- [ ] **1.4.5-legacy** (архив) Полный 5-шаговый wizard (frame / modules / batteries / accessories / price) — отложено:
  - **Проблема (со слов пользователя):** При клике «Сконфигурировать подробно» открывается просто справочник выбора модели. Нет:
    1. Передачи исходных данных из Конструктора (нагрузка, автономия, резервирование, условия эксплуатации)
    2. Подбора фрейма по нагрузке
    3. Расчёта количества модулей (N+X резервирование)
    4. Подбора АКБ под конфигурацию
    5. Возврата КОНФИГУРАЦИИ (frame + modules + batteries + accessories), а не просто ID модели
  - **Что нужно:**
    - Переделать `ups-config/` в полноценный конфигуратор:
      - **Шаг 1 «Исходные данные»**: автозаполнение из Constructor (nodeId) — capacityKw нагрузки, targetAutonomyMin, N+X резервирование, cosPhi, phases, условия (temp/altitude)
      - **Шаг 2 «Подбор фрейма»**: показать фреймы из ups-catalog, где frameKw ≥ требуемой с учётом N+X; фильтр по производителю/серии; рекомендация
      - **Шаг 3 «Модули»**: выбранный фрейм → доступные слоты, расчёт рабочих модулей (`ceil(loadKw/moduleKw) + X`); проверка ≤ moduleSlots
      - **Шаг 4 «АКБ»**: интеграция со Step 4 battery-calc; автоподбор strings × blocks по vdcMin/max + capacityKw + autonomyMin
      - **Шаг 5 «Состав и цена»**: итоговая composition `{ frame: 1, modules: N, batteries: S×B }` + суммарная цена через price-records
      - **Кнопка «Применить конфигурацию»**: формирует `Element` (kind='ups') с composition + kindProps, сохраняет в element-library, пишет в pendingUpsSelection → Constructor узел получает `node.elementId` + `node.composition` + все параметры
    - **Интеграция с Constructor:**
      - Кнопка передаёт в query: `nodeId, capacityKw, targetAutonomyMin, redundancy, vdcMin, vdcMax, cosPhi, phases`
      - Возврат: `{ nodeId, elementId, composition, capacityKw, moduleInstalled, frameKw, batteryCatalogId, batteryStringCount, batteryBlocksPerString, totalPrice }`
      - BOM автоматически развёртывает composition через `expandComposition`
    - **Priority:** HIGH — текущий поток вводит в заблуждение (кнопка "Сконфигурировать" а показывает просто выбор модели)
  - **Файлы (предстоит изменить):**
    - `ups-config/index.html` — переделать UI в пошаговый wizard
    - `ups-config/ups-config.js` — wizard logic, подбор, composition builder
    - `js/engine/inspector/ups.js` — передавать больше query params
    - `js/engine/index.js` — ресивер должен применять composition + elementId
    - `shared/ups-picker.js` — `applyUpsConfiguration(node, config)` новая функция
    - `shared/element-schemas.js` — `createUpsElementFromConfig(frame, modules, batteries)`

- [x] **1.4.4** Связь с Конфигуратором АКБ (v0.43.3):
  - В модалке «Параметры батарей» ИБП — кнопка «🔋 Подобрать АКБ в калькуляторе»
  - `battery/?nodeId=X&loadKw=...&vdcMin=...&vdcMax=...&autonomyMin=...&selected=...`
  - `battery/battery-calc.js:initSchemaContext()`: при наличии `?nodeId=`:
    - Переключение на вкладку «Расчёт разряда»
    - Предзаполнение: `calc-load` ← loadKw, `calc-target` ← autonomyMin, `calc-dcv` ← (vdcMin+vdcMax)/2, `calc-battery` ← selected, `calc-mode` = 'required'
    - Sticky-баннер с кнопкой «Применить к схеме»
    - При клике: забирает `lastBatteryCalc`, извлекает `batteryCatalogId` / `strings` / `blocksPerString` / `autonomyMin` / `totalKwh` (с поддержкой двух режимов: 'autonomy' и 'required'), пишет в `localStorage['raschet.pendingBatterySelection.v1']`
  - `engine/index.js:_tryConsumePendingBatterySelection()`: аналогично ИБП-ресиверу, обновляет `node.batteryCatalogId / batteryStringCount / batteryBlocksPerString / batteryAutonomyMin / batteryKwh`, делает snapshot + render + notifyChange
  - TTL 5 минут

**Критичные файлы для Фазы 1:**
- `shared/element-library.js` (новый)
- `shared/element-schemas.js` (новый)
- `shared/bom.js` (новый)
- `elements/index.html` + `elements/elements-editor.js` (новые)
- Рефакторинг: `shared/{panel,ups,battery,transformer,cable-types}-catalog.js`
- `js/engine/inspector/ups.js` — интеграция с ups-config/

#### Подфаза 1.21 — Расширение графа: bypass ИБП и произвольные концы связей

Перенесено из TODO.md (2026-04-20): это крупные фичи на уровне графа,
не разовые исправления. Оба пункта требуют изменения модели связей /
портов и централизованного покрытия по recalc + inspector + render.

- [x] **1.21.1** Индивидуальный режим группы потребителей (v0.57.81):
  `n.groupMode='uniform'|'individual'` + `n.items=[{name,demandKw}]`.
  Helper `consumerTotalDemandKw` в electrical.js заменил 6 inline-
  формул. UI — переключатель и таблица с ➕/✕ в inspector/consumer.js.
  На плашке «Σ T kW (M шт.)» для individual.
- [ ] **1.21.2** Расширение связей — произвольные концы:
  - **Выход → выход** (параллельные щиты от одной шины).
  - **Вход → вход** (перемычки).
  - Переключение конца связи: рукоятка работает и на конце `from`.
  - Тип связи определяется автоматически по тому, какие порты
    соединены.
  - Расчёт: для перемычек вход-вход нагрузка распределяется между
    соединёнными входами как у параллельных входов одного узла.
  - Файлы: `engine/interaction.js` (drag-handles на from-end),
    `engine/graph.js` (валидация), `engine/recalc.js` (новая ветка
    in-in coupling), `engine/render.js` (рисовка не-стандартных
    концов).
- [x] **1.21.3** ИБП — байпасный вход (закрыто 2026-04-20, уже реализовано
  в составе Фазы 1.4):
  - Отдельный байпасный ввод: `n.bypassFeedMode='separate'` даёт порт 1 =
    bypass, порт 0 = основной; при `'jumper'` — перемычка от основного.
  - Поток мимо инвертора при байпасе: `recalc.js` 1097 ветка
    `_onStaticBypass` — КПД=100% (эффективный `eff=1`), батарея не
    обслуживается, зарядный ток = 0.
  - Условия активации: `staticBypassForced` (ручной) или
    `staticBypassAuto` + `overloadRatio > staticBypassOverloadPct` (по
    перегрузу). Реальные ИБП переходят на SBS по перегрузу/аварии
    инвертора, а не при «mains+battery dead» (в этом случае bypass
    невозможен, т.к. запитан от того же mains).
  - Инспектор: секции «Байпас обслуживания (QF4)» и «Статический байпас
    (SBS)» с выбором режимов и порогом.
  - Индикатор режима на плашке: `· БАЙПАС` / `· БАТ mm:ss` в
    load-line (`render.js` 807, 859).

#### Подфаза 1.22 — Вкладка «Общее» + унификация стиля инспектора (новое 2026-04-20)

**Цель:** упорядочить поля инспектора. Сейчас на вкладке «Электрика»
соседствуют tag/name, комментарии и собственно электрические
параметры. Выделяем общий фундамент в отдельную вкладку.

- [x] **1.22.1** Вкладка «📋 Общее» (v0.58.47, v0.58.48) — первая по порядку:
  - обозначение (tag), полное обозначение (effectiveTag),
  - имя, инв.№ / паспорт (`n.assetId`), серийный № (`n.serialNo`),
  - UUID (read-only),
  - для `consumer` — подтип (`n.subtype`: generic / rack / hvac /
    lighting / motor / heater / other); rack → кнопка
    «Конфигуратор стойки» загорается,
  - блок «Модель изделия»: производитель (`n.manufacturer`),
    поле `n.modelRef` + кнопка «🔧 Конфигурировать…» с переходом
    в соответствующий модуль (transformer-config / panel-config /
    mv-config / ups-config / rack-config / scs-config),
  - комментарий.
- [x] Электрика-вкладка очищена: tag/name/комментарии перенесены
  в «Общее» (дублирования нет).
- [x] **1.22.2** Modal-параметры (open*ParamsModal в panel/source/ups)
  тоже получают вкладку «Общее» — v0.58.50: wrapModalWithSystemTabs
  добавляет первой вкладкой «📋 Общее», провязка через
  wireGeneralPanelInputs (не дублирует btn-* из sidebar).
- [x] **1.22.3** Единый CSS-стиль всех `.tp-panel` — v0.58.51:
  первая .inspector-section без верхней границы (не дублирует
  разделитель tp-tabs), цветная полоса слева только на
  системных вкладках (`[data-sys-accent]` + CSS-var --sys-accent).
- [x] **1.22.4** Каталог изделий проекта (MVP) — v0.58.52:
  `state.project.productCatalog[]` с `{id, name, type, subtype,
  manufacturer, modelRef, systemRanges: {sysId: {paramKey:
  {min,max,default}}}}`. Узел ссылается через `n.productId`; панель
  «Общее» показывает селект подходящих изделий (по type/subtype) и
  кнопку «💾 Сохранить как изделие», в system-панелях min/max
  параметров подменяется на диапазоны из продукта. Следующая итерация —
  UI редактирования каталога + привязка к конкретным SKU модулей.

#### Подфаза 1.23 — Конфигуратор серверной / телеком стойки (новое 2026-04-20)

**Цель:** полноценная карточка стойки в проекте с BOM на заказ.
Пользователь описывает стойку «как на закупке» — корпус, двери,
боковины, PDU, заглушки. Результат — BOM со всеми артикулами.

- [x] **1.23.1** Модуль `rack-config/` (index.html + rack-config.js +
  rack-config.css). Открывается либо из hub, либо из «Общее →
  🔧 Конфигурировать…» для `n.type='consumer', subtype='rack'`.
- [x] **1.23.2** Параметры корпуса:
  - форм-фактор: `42U / 47U / 32U / 24U / 18U / ...` (настраиваемый),
  - ширина: `600 / 800 мм`,
  - глубина: `600 / 800 / 1000 / 1200 мм`,
  - производитель/серия (каталог per-user, как у остальных конфигов).
- [x] **1.23.3** Двери:
  - передняя: `стекло / сетка / металл / без двери`,
  - задняя: то же,
  - замок: `ключ / кодовый / электро`.
- [x] **1.23.4** Аксессуары:
  - боковые стенки (шт.),
  - крыша / верхняя панель (вентилируемая / глухая),
  - основание / пол (с кабельными вводами — кол-во, тип: щётки/
    заглушки/прокладки),
  - цоколь (ножки / ролики).
- [x] **1.23.5** Кабельные вводы (top/bottom/side): количество,
  диаметр, тип (щётка / заглушка / PG).
- [x] **1.23.6** Заглушки на пустые юниты: кол-во по умолчанию =
  (`totalU − занятоU`), можно override. Тип: `1U глухая / 1U
  перфорация / 2U`.
- [x] **1.23.7** PDU (блоки распределения питания):
  - количество PDU,
  - для каждого: номинальный ток (16/32 А), 1ф/3ф, высота (0U/1U/2U),
  - тип розеток: `C13 / C19 / C13+C19 / Schuko` + количество,
  - позиция в стойке (`left-0U / right-0U / horizontal 1U`),
  - **проверка по мощности**: сумма PDU A × U_nom ≥ `n.demandKw/0.9` с
    warning при недоборе.
- [x] **1.23.8** Карта юнитов: визуальная 2D-раскладка фронт-вью
  (v0.59.151) — SVG-стек занятых юнитов, заглушек и горизонтальных
  PDU, а 0U-PDU — как вертикальные рельсы слева/справа. Легенда
  под схемой. Rear view и привязка к СКС-наполнению (1.24) — потом.
- [x] **1.23.9** BOM на заказ: таблица со всеми позициями (корпус,
  двери, боковины, пол, кабвводы, PDU, заглушки). Экспорт CSV.
- [x] **1.23.10** Сохранение конфигурации как шаблон (localStorage
  `raschet.rackTemplates.v1`). Применение к узлу через `?nodeId=…`
  bridge из инспектора (Общее → 🔧 Конфигурировать…).

#### Подфаза 1.24 — Конфигуратор СКС / телеком оборудования (новое 2026-04-20)

**Цель:** описать содержимое стойки — коммутаторы, патч-панели, серверы.
Каждая единица привязывается к PDU-розетке из 1.23.7.

- [ ] **1.24.1** Модуль `scs-config/` (index.html + scs-config.js +
  scs-config.css). Открывается из «Общее» для `subtype='rack'`
  (вкладка «Содержимое») либо из hub.
- [ ] **1.24.2** Каталог типов оборудования (per-user):
  - **коммутатор**: порты (8/16/24/48), Base-T / SFP / SFP+,
    PoE класс (off/af/at/bt), потребляемая мощность,
  - **патч-панель**: порты (12/24/48), keystone / модульная,
    категория (5e/6/6A/7/оптика), высота U,
  - **сервер**: форм-фактор (1U/2U/4U), мощность Вт, блоки питания
    (1+1/2+0), входные разъёмы (C13/C14/C19/C20),
  - **КВМ / монитор / ИБП 1U** — базовые типы.
- [ ] **1.24.3** Размещение в стойке: drag-n-drop в карту юнитов
  (1.23.8). Одна единица = N U, нельзя разместить поверх заглушки
  или другого оборудования.
- [ ] **1.24.4** Привязка питания: у каждой единицы выбирается
  конкретная PDU-розетка (из 1.23.7). Один PDU-слот = одно устройство.
  Проверка перегруза на PDU (сумма мощностей < номинал).
- [ ] **1.24.5** СКС-матрица: для патч-панелей — список соединений
  порт ↔ порт (другие панели/коммутаторы). Упрощённый BOM по
  патч-кордам: длина × тип × цвет.
- [ ] **1.24.6** Хранение в конфигурации стойки:
  `rack.contents = [{type, modelRef, position:{U, side}, pduSlotRef,
  port?, ...}]`. Выживает round-trip serialize/deserialize.
- [ ] **1.24.7** Сохранение и повторное применение «готовой сборки»
  стойки на другие идентичные стойки проекта (шаблон из 1.23.10
  +  1.24 содержимое).
- [ ] **1.24.8** Отчёт по телеком-оборудованию: BOM + список
  соединений (СКС-таблица), экспорт CSV/PDF. Интеграция в общий
  отчёт проекта (`reports/`).

---

### ⏳ Фаза 2 — Мульти-пространственные схемы (после Фазы 1, 4-6 недель)

**Цель:** один объект — несколько представлений на разных страницах (electrical, layout, mechanical, low-voltage, data).

- [x] **2.1** `page.kind` расширить: `'schematic' | 'layout' | 'mechanical' | 'low-voltage' | 'data' | '3d'` (v0.57.93: `PAGE_KINDS_META` + `getPageKind()` в `state.js`, значок вида в табе, «Вид страницы» в контекстном меню, `addPage/duplicatePage` копируют kind)
- [ ] **2.2** `element.views[page.kind]` — разные представления (SVG) для разных типов страниц
- [~] **2.3** Layout-page (схема расположения):
  - [x] v0.57.95: миллиметровка (grid-mm 10/100 мм) включается автоматически для `kind='layout'`
  - [x] v0.57.94: persist `kind` в JSON + «бета-вид» баннер
  - [~] Drag-элементов с реальными габаритами (`element.geometry.width/height`): v0.57.96 — `getNodeGeometryMm(n)` читает `element.geometry.widthMm/heightMm` через library (и legacy id — upsCatalogId/panelCatalogId/…); на layout-странице рисуется пунктирный прямоугольник реального размера + подпись «W×H мм». Override через `n.geometryMm` зарезервирован.
  - [ ] Автоматическая расстановка новых слева
  - [ ] Зоны обслуживания (hatched area)
  - [x] Линейка (ruler) по краям холста (v0.57.99): SVG-overlay с major/minor рисками, автоподбор шага под zoom, подписи в мм/м.
- [ ] **2.4** IEC 81346 обозначения:
  - `fullTag()` → `=Z1+AC1` (assignment + location structure)
  - Настройка на проекте: `projectTagSystem: 'simple' | 'iec81346' | 'ansi'`
  - Локальный vs полный тег зависит от контекста
- [ ] **2.5** Разные connection kinds на разных страницах:
  - На layout: channel (трасса)
  - На mechanical: pipe/duct
  - Один объект «щит» имеет электрические + вентиляционные соединения одновременно

---

### ⏳ Фаза 3 — drawio-режим (после Фазы 2, 2 недели)

- [ ] **3.1** Переключение view mode: `canvas` (бесконечный) ↔ `sheet` (A3/A4)
- [ ] **3.2** В sheet-mode: ISO 7200 основная надпись, рамка, штамп
- [ ] **3.3** Переиспользовать `schematic/iso-paper.js`
- [ ] **3.4** Авто-layout для новых элементов (packing слева)

---

### ⏳ Фаза 4 — 3D интеграция (после Фазы 3, 6-8 недель)

- [ ] **4.1** Интеграция `configurator3d/` в основной проект:
  - `pages/` получает `kind='3d'`
  - Общая state с 2D
  - three.js рендерит узлы как 3D боксы или загруженные модели
- [ ] **4.2** Синхронизация 2D ↔ 3D:
  - Изменение в 3D → обновление `layout.x, layout.y` → перерисовка 2D
  - Изменение в 2D layout → 3D position
- [ ] **4.3** Split-view: 2D слева, 3D справа
- [ ] **4.4** Фасады: `element.views.layout.svgFront/svgTop` накладываются на 3D-боксы как текстуры

---

### ⏳ Фаза 5 — Auth и Permissions (после Фазы 1-2, 3-4 недели)

- [ ] **5.1** Email/password регистрация (Firebase Auth уже поддерживает — UI добавить)
- [ ] **5.2** User-level roles в Firestore `users` collection: `{uid, email, role, modulesAccess}`
- [ ] **5.3** Module gating:
  - `hub.html` читает `modules.json` + проверяет `hasAccess(moduleId)`
  - Каждая подпрограмма проверяет права при загрузке
- [ ] **5.4** Super-admin UI: `admin/` — таблица users, управление ролями
- [ ] **5.5** Tariff configurator: `Tariff { id, name, modules, priceMonth, priceYear }`

### ✅ Совместное редактирование (Collaboration) — все пункты закрыты

- [x] **C.1** Presence: subcollection `projects/{id}/presence/{uid}` + heartbeat 25 с (stale = 90 с); аватары в шапке.
- [x] **C.2** Live-sync: `subscribeProjectDoc` слушает изменения, применяет `loadScheme` если локально нет dirty; для dirty — confirm().
- [x] **C.3** Object-level locking: subcollection `projects/{id}/locks/{key}`. Key = nodeId или `conn:${connId}` (v0.57.76). Лок удерживается пока пользователь выделил узел/связь.
- [x] **C.4** Визуализация чужих локов: оранжевая пунктирная рамка на узлах + толстая линия на связях, бейдж с именем (`render.js:decorateRemoteLocks`).
- [x] **C.5** Preserve-local-display: view/zoom/activeModeId/currentPageId не пропагируются между сессиями (`_preserveLocalDisplay`).
- [x] **C.6** Cursor awareness (v0.57.78): mousemove дросселируется до 200 мс, координаты конвертируются в схемные (`Raschet.screenToScheme`), пишутся в `presence/{uid}.cursor = {x, y, pageId}` через `presenceCursor`. `subscribePresence` собирает чужие курсоры в `window.__remoteCursors`; `render.js:renderRemoteCursors` рисует треугольник-стрелку + бейдж с именем в `layer-overlay`, фильтрует по `currentPageId`, компенсирует zoom (scale(1/zoom)).
- [x] **C.7** Conflict-aware merge: `_computeSchemeDiff` + `_showRemoteConflictModal` (v0.57.77) — вместо браузерного confirm показывается модалка со счётчиками `nodesAdded/Removed/Changed` и `connsAdded/Removed/Changed`, кнопки «Принять удалённые / Оставить локальные / Решить позже». Автор последнего сохранения виден в заголовке.
- [x] **C.8** История версий (v0.57.79): subcollection `projects/{id}/revisions/{auto}` хранит полный snapshot схемы + метаданные (createdAt, authorUid/Name/Email, note, nodeCount, connCount). Авто-снапшот в `saveCurrent` с троттлингом 5 мин, retention 50 записей (ленивая очистка каждые 5 авто-версий). Модалка «🕓 История версий»: список с автором и размером, кнопки «Восстановить» (с backup-версией «перед восстановлением») и «Удалить». API: `Storage.saveRevision / listRevisions / getRevision / deleteRevision`.
- [x] **C.9** Email-нотификации (v0.57.80): `functions/` Cloud Functions Gen 2 — `onAccessRequestCreated` (письмо владельцу о новом запросе доступа) и `onProjectMemberAdded` (письмо приглашённому о выданных правах). Доставку делает расширение Firebase **Trigger Email** через коллекцию `mail/` — функции не хранят SMTP-секреты. Setup в `FUNCTIONS_SETUP.md`. `firebase.json` и scaffold готовы к `firebase deploy --only functions`.

---

### ⏳ Фаза 6 — Конфигуратор щита + тепловой расчёт (после Фазы 1, 3 недели)

- [ ] **6.1** Финальное разделение panel-catalog:
  - Справочник: только оболочки (убрать inputs/outputs окончательно)
  - На узле «щит»: `enclosureId` ссылка + проектная конфигурация
  - Миграция существующих пользовательских данных
- [ ] **6.2** Тепловой расчёт:
  - `shared/calc-modules/thermal.js` (IEC 60890 / IEC 61439)
  - Суммирование `element.geometry.heatDissipationW` всех компонентов щита
  - Учёт температуры среды, способа установки
- [ ] **6.3** Climate recommendation:
  - Подбор вентиляторов/кондиционеров из `element-library` (kind='climate')
  - Автодобавление в BOM

---

### ⏳ Фаза 7 — Text config + DB abstraction (после Фазы 1, 2-3 недели)

- [ ] **7.1** `config.yaml` / `config.json` в корне с настройками платформы
- [ ] **7.2** `module.json` в каждом модуле с requires/dbCollections/permissions
- [ ] **7.3** DB adapter pattern: FirebaseAdapter, LocalStorageAdapter, MySqlAdapter (stub), PostgresAdapter (stub)

---

### ⏳ Фаза 8 — Пресейлс + КП (отдельно, 4-6 недель)

- [ ] Модуль `presale/`: загрузка прайсов, генерация КП, сметы
- [ ] Интеграция с BOM и отчётами

---

### ⏳ Фаза 9 — Revit / IFC (отдельно, 4-6 недель)

- [ ] Импорт/экспорт IFC файлов
- [ ] Интеграция через revit-api (требует back-end сервиса)

---

### 🟢 Фаза 10 — Конфигуратор модульного ЦОД GDM-600 (в проде с v0.58.87)

Отдельный модуль `mdc-config/` для подбора состава модульного ЦОД серии
GDM-600 по IT-нагрузке. Референсы — drawio-чертежи проектов 26003
(Алатау), 25006 (TBC Ташкент), 26009 (QazCloud).

**Модель данных:** каталог готовых продуктов (prefab).
- `IT-HALL-300` — машзал 300 кВт (22 стойки + 10 inRow-ACU 65 кВт +
  4 PDC + Monitoring + 2 AisleDoor), 7700×7300 мм.
- `POWER-1600` — энергоблок 1600 кВт (4×Kehua MR33-300 + 2×MR33-200 +
  10×Kehua S3 (580 кВт·ч) + 4 ACU + 2 MDB + UDB-IT/M-IT/AI + PDB-M-AI +
  Monitoring + 10 JB + ODU-полка 6200×2000), 8700×7300 мм.
- Все шкафы унифицированы: **600×1200×42U**, высота помещения
  **2700 мм** от фальшпола.

**Входные данные (минимум):** количество стоек + кВт/стойку.
Всё остальное (число машзалов/энергоблоков, ИБП, АКБ, ACU) считается
автоматически из каталога с учётом резервирования и автономии.

- [x] 10.1 — MVP: wizard + зоны + planview (v0.58.87)
- [x] 10.2 — каталог готовых продуктов из drawio (v0.58.90)
- [x] 10.3 — BOM-экспорт XLSX «Объём поставки» (v0.58.91)
- [~] 10.4 — оформление XLSX в стиле 26003-SCO-001: блок метаданных
      проекта (Объект / Заказчик / Договор / Ревизия / Дата) из
      localStorage['raschet.activeProject.v1'], section-title через
      merged cells, итоги по каждому разделу (позиций, Σ кол-во) и
      общий total. Без логотипов/подписей (требует xlsx-js-style).
      v0.59.148.
- [ ] 10.4 — экспорт точно по шаблону 26003-SCO-001 (оформление,
      логотипы, подписи; сейчас упрощённый формат)
- [ ] 10.5 — передача BOM в главную схему Raschet для электрического
      расчёта (через localStorage-мост). *Отложено по запросу
      пользователя, «может быть позже».*

---

### 🟡 Фаза 11 — Расчёт газового пожаротушения (АГПТ) (в разработке с v0.58.99)

Отдельный модуль `suppression-config/` с плагинной архитектурой методик
(`suppression-methods/`). Аналог ПО «Салют» / Siex CalcWin. Подключаемые
методики через единый интерфейс `{ META, compute(input) }`:

- [x] 11.1 — каталог ГОТВ `agents.js`: HFC-227ea (FM-200), FK-5-1-12
      (Novec 1230), HFC-125, HFC-23, CO₂, IG-541 (Inergen), IG-55
      (Argonite), IG-100 (N₂), IG-01 (Ar), SF₆. Свойства: ρ₂₀, s₂₀,
      Cmin A/B, NOAEL, нормативное время выпуска.
- [x] 11.2 — методики (4 модуля): СП РК 2.02-102-2022 (Казахстан),
      СП 485.1311500.2020 (Россия), NFPA 2001 (США), ISO 14520.
      Поправки: K1 (утечки), Ks (класс пожара), Kt (температура),
      Kalt (высота над у. м.).
- [x] 11.3 — UI с выбором методики, параметров объёма, агента,
      баллона; результат: масса ГОТВ, концентрация, DN магистрали,
      кол-во форсунок, кол-во баллонов.
- [x] 11.4 — изометрия трубопровода (SVG, MVP): баллоны, стояк,
      потолочная магистраль, распределительная сеть, форсунки.
- [x] 11.5 — экспорт отчёта (XLSX + HTML) и спецификации.
- [x] 11.6 — гидравлический расчёт трубопровода: падение давления
      по Darcy-Weisbach (реализовано в `suppression-methods/hydraulics.js`,
      v0.59.17+, проверка P_выход ≥ P_min).
- [x] 11.7 — 3D-конфигуратор трубопровода (SVG axonometric): интерактивная
      расстановка узлов и участков, автоматическая трассировка магистрали,
      размерные линии по ISO 129-1, жёсткие/скользящие опоры (v0.59.31).
      *Полный 3D на three.js — отложено; текущая SVG-аксонометрия
      практически достаточна.*
- [x] 11.8 — интеграция с mdc-config: кнопка «🔥 → АГПТ» в mdc-config
      передаёт геометрию IT- и силовых модулей в suppression-config через
      localStorage-мост `raschet.mdcToSuppression.v1`; suppression-config
      на init предлагает создать установку с зонами = модули ЦОД
      (H=2.7 м фиксировано, S=widthMm×lengthMm, направления «IT-модули» /
      «Силовые модули»). v0.59.146.
- [x] 11.9 — валидационные (регрессионные) тесты расчётных модулей.
      Файл `suppression-methods/validation-tests.js` с 6 опорными кейсами
      (СП 485 Прил.Д FM-200 30×3 / 100×3, Novec 1230; NFPA 2001 FM-200
      50 м³; ISO 14520 FM-200 100 м³; СП РК IG-541 100 м³). Кнопка «✓ Тесты»
      в тулбаре установки → диалог с таблицей «ожидание vs факт vs Δ%»
      и сводкой «N из M прошли». Допуск ±5 %. v0.59.147.

---

### ⏳ Фаза 12 — HVAC / PUE калькулятор (планируется)

Точный расчёт климатических систем по реальной психрометрии воздуха
и термодинамике хладагентов, с выводом PUE ЦОД (как отдельный показатель
качества проекта).

- [x] 12.1 — Модуль `psychrometrics/` (ID-диаграмма Молье-Рамзина /
      psychrometric chart ASHRAE). Уравнения состояния влажного
      воздуха: IAPWS-IF97 для пара, формулы Hyland-Wexler (ASHRAE
      Fundamentals 2021, гл. 1) для насыщения. Функции:
      `state(T, RH)`, `state(T, ω)`, `state(h, ω)`, `mixing(a, b, ratio)`,
      `cooling(state, T_coil)`, `heating(state, ΔT)`, `humidifying()`,
      `dehumidifying()`. Интерактивная ID-диаграмма SVG с нанесением
      точек процесса (1→2→3→4), изотерм, линий RH.
- [ ] 12.2 — Модуль `refrigeration-cycles/` — термодинамические циклы
      компрессоров с REFPROP-подобной библиотекой свойств хладагентов
      (R-410A, R-32, R-454B, R-1234ze, R-744/CO₂, R-717/NH₃, R-290).
      Циклы: одноступенчатый парокомпрессионный, с экономайзером,
      каскадный, CO₂-транскритический (booster). Расчёт COP/EER/SEER
      по точкам цикла (1-2-3-4) с учётом real-gas свойств.
- [ ] 12.3 — Подбор чиллеров / DX-систем / inRow / freecooling по
      расчётной нагрузке и внешним условиям (ASHRAE bin method или
      8760-h почасовой расчёт по TMY-файлу).
- [ ] 12.4 — Расчёт PUE:
      PUE = (P_IT + P_cool + P_UPS_loss + P_light + P_misc) / P_IT
      с разбивкой по подсистемам. Суточный/сезонный PUE с учётом
      freecooling. Вывод pPUE для отдельных модулей ЦОД.
- [ ] 12.5 — Интеграция с mdc-config: передача IT-нагрузки и
      климатических условий → автоматический PUE и подбор холодильной
      машины с кривой производительности от T_амб.
- [ ] 12.6 — Экспорт отчёта по EN 50600-4-2 / ISO/IEC 30134-2 (PUE
      measurement methodology).
- [ ] 12.7 — Валидация: сравнение с эталонными программами (CoolTools,
      DesignBuilder, Trace 700) на типовых задачах.

**Зависимости:** Фаза 10 (mdc-config) — источник нагрузки;
Фаза 11 (АГПТ) — параллельная работа, общий UI-паттерн плагинов методик.

---

## Критичные файлы (живой индекс)

### Платформа (общее)
- `js/engine/state.js` — единый state проекта
- `js/engine/constants.js` — GLOBAL, все константы (VOLTAGE_CATEGORIES, CABLE_CATEGORIES, CONNECTION_KINDS)
- `js/engine/electrical.js` — `formatVoltageLevelLabel`, `migrateVoltageLevels`, `isThreePhase`, `cableWireCount`
- `js/engine/zones.js` — `effectiveTag()` (расширять для IEC 81346 в Фазе 2)
- `js/engine/index.js` — инициализация, sync с global-settings
- `js/engine/modes.js` — `effectiveLoadFactor` для режимов работы
- `js/engine/recalc.js` — основной пересчёт кабелей/автоматов/модулей
- `js/engine/render.js` — SVG рендер узлов/связей
- `js/engine/inspector/*.js` — панели свойств узлов

### Shared (общее для модулей)
- `shared/global-settings.js` — единый источник настроек (**обязательно** читать через `getGlobal()` в подпрограммах)
- `shared/auth.js` — Firebase OAuth + localStorage fallback
- `shared/app-header.js` — единый хедер с шестерёнкой
- `shared/{panel,ups,battery,transformer,cable-types}-catalog.js` — каталоги (→ унифицировать в Фазе 1)
- `shared/catalog-xlsx-parser.js` — XLSX парсер для 3 каталогов
- `shared/calc-modules/*` — расчётные модули (ampacity, vdrop, short-circuit, phase-loop, economic)
- `shared/report/*` — конструктор отчётов
- `shared/report-catalog.js` — шаблоны отчётов

### Подпрограммы (standalone)
- `cable/cable-calc.js` — логика расчёта кабельной линии
- `battery/battery-calc.js` + `battery/battery-data-parser.js` — АКБ + парсер таблиц разряда
- `ups-config/ups-config.js` (WIP)
- `panel-config/panel-config.js` (WIP)
- `transformer-config/transformer-config.js` (WIP)
- `schematic/schematic.js` + `schematic/iec60617-symbols.js` + `schematic/iso-paper.js`
- `reports/reports.js` + `reports/templates-seed.js`

### Данные и хранение
- `js/projects.js` — dual storage adapter (Firestore/localStorage)
- `firebase-config.js` — конфигурация (пустая для локального режима)
- `modules.json` — манифест модулей
- Legacy localStorage keys (для миграции):
  - `raschet.global.v1` — глобальные настройки
  - `raschet.{panel,ups,battery,transformer}Catalog.v1.<uid>` — каталоги
  - `raschet.cableTypesCatalog.v1.<uid>` — кабели
  - `raschet.reportCatalog.v1.<uid>` — шаблоны отчётов
  - `raschet.presetsDeleted.v1`, `raschet.presetsOverrides.v1`, `raschet.userPresets.v1` — пресеты

---

## Verification checklist (после каждой подфазы)

1. `git status` — все изменения ожидаемые, нет мусора
2. Локально: Ctrl+Shift+R в браузере, открыть Конструктор схем и подпрограммы — консоль без ошибок
3. Существующие проекты пользователей открываются без ошибок (миграция работает)
4. `git commit` + `git push origin main` с полным changelog
5. Обновить `APP_VERSION` в `js/engine/constants.js`
6. Через ~45 сек: `WebFetch https://daniil248.github.io/raschet/...` проверка деплоя

> История изменений ведётся в отдельном модуле (`changelog/`) и в git-логе, в этот roadmap не дублируется.

