# Raschet — Roadmap архитектурного развития платформы

> **Статус:** Фаза 0 ✅ (v0.41.0). Фаза 1.1-1.4 ✅ (v0.44.0). Добавлены Фаза 1.5 (полноценный модуль catalog/ с ценами + контрагентами) и Фаза 1.6 (рабочее место логиста). В работе: 1.5.1 схемы price-records и counterparty.
> **Цель:** превратить набор специализированных калькуляторов в единую платформу проектирования электрических (и позже — механических) схем с общей библиотекой элементов, мульти-пространственными видами, 3D, правами пользователей и расширяемыми БД-адаптерами.

---

## Как использовать этот документ

Документ лежит в git (`PLAN_ROADMAP.md`) и доступен в любой сессии чата. Перед началом работы прочитай:

1. Этот файл — понять где остановились
2. Раздел **«История изменений»** внизу — последние коммиты и фазы
3. `C:\Users\sedko\.claude\projects\D--Works-ClaudeProject-raschet\memory\MEMORY.md` — предпочтения пользователя (deploy, style, input-event, версионирование)

После каждой выполненной фазы/подфазы — обновляй раздел **«История изменений»** и ставь галочку в соответствующем чеклисте.

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

- [ ] **1.5.1** Схемы данных:
  - `shared/price-records.js` — `PriceRecord { id, elementId, price, currency, recordedAt, source, counterpartyId, priceType, validUntil, conditions, notes }`
    - `priceType`: `'purchase' | 'retail' | 'wholesale' | 'list' | 'special' | 'project'`
    - `source`: произвольная строка (URL прайса / имя XLSX / 'ручной ввод' / email)
    - Множественные цены на один элемент (разные контрагенты + даты + типы)
  - `shared/counterparty-catalog.js` — `CounterpartyRecord { id, name, inn, kpp, address, contacts[], type, tags, createdAt, updatedAt }`
    - `type`: `'supplier' | 'manufacturer' | 'dealer' | 'logistics' | 'other'`
  - Per-user localStorage: `raschet.priceRecords.v1.<uid>`, `raschet.counterparties.v1.<uid>`
  - Listener API (как у panel-catalog): `onPricesChange`, `onCounterpartiesChange`

- [ ] **1.5.2** Новый модуль `catalog/` (promo elements/):
  - `catalog/index.html` с табами:
    - **Элементы** — расширенный список (то что elements/ + колонки с последней ценой / числом предложений)
    - **Цены** — все прайс-записи с фильтрами (по элементу / контрагенту / типу цены / периоду)
    - **Контрагенты** — CRUD поставщиков / производителей / дилеров
    - **Импорт** — XLSX прайс-листов с маппингом полей
  - `elements/` остаётся — quick-access minimal editor

- [ ] **1.5.3** CRUD цен:
  - Форма добавления: Элемент (picker) + Цена + Валюта + Дата + Контрагент (picker) + Тип цены + Источник + Примечания
  - Массовый ввод (таблица с paste from clipboard)
  - Редактирование (кроме даты — историческая)
  - Удаление

- [ ] **1.5.4** Управление контрагентами:
  - CRUD: создать/редактировать/удалить
  - Поиск по ИНН/КПП/имени
  - Быстрое добавление при вводе цены (+new inline)

- [ ] **1.5.5** Импорт XLSX прайс-листов:
  - Drag-drop файлов (несколько одновременно)
  - UI маппинга колонок: какая колонка = элемент / цена / валюта / срок действия
  - Авто-распознавание по заголовкам (Price, Цена, Стоимость, Supplier, Поставщик)
  - Привязка к контрагенту (один на файл, с возможностью переопределить per-row)
  - Dry-run preview перед применением
  - История импортов с возможностью отката

- [ ] **1.5.6** Статистика и аналитика:
  - В таблице элементов: последняя цена + min/max по активным контрагентам
  - График динамики цены (sparkline) на элемент
  - Сводка: самые дорогие / дешёвые элементы / контрагенты
  - Алерты: цены старше N дней → warning

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

- [ ] **1.6.1** Схемы данных:
  - `shared/warehouses.js` — `WarehouseRecord { id, name, counterpartyId, address, type, capacity, cost, leadDays }`
  - `shared/shipments.js` — `ShipmentRecord { id, projectId, items[], origin, destination, carrierId, mode, cost, currency, plannedAt, deliveredAt, status }`
    - `items`: `[{ elementId, qty, unitWeightKg, unitVolumeM3, unitPrice }]`
    - `mode`: `'road' | 'rail' | 'air' | 'sea' | 'express' | 'pickup'`
  - `shared/logistics-rates.js` — тарифы перевозчиков (кг/м³/км)
  - Per-user localStorage

- [ ] **1.6.2** `logistics/` module UI:
  - Tabs:
    - **Отправления** — список shipments, создание/редактирование
    - **Склады** — управление warehouses
    - **Тарифы** — управление carrier rates
    - **Расчёт** — калькулятор: введи вес/объём/расстояние → смета
  - Drag-drop из BOM проекта: «Импорт из Конструктора схем (текущий проект)»
  - Печать ТТН / проформы (через shared/report/)

- [ ] **1.6.3** Интеграция с BOM + ценами:
  - В Конструкторе схем: кнопка «Рассчитать логистику» на узле проекта
  - Открывает `logistics/?projectId=X` с предзаполненным BOM
  - Результат: итоговая стоимость (оборудование + логистика) → в отчёт
  - Раздел в BOM-отчёте: «Логистика и доставка»

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

- [ ] **1.2.3** `catalog-xlsx-parser.js`:
  - Единый `parseXlsx(buffer, {kind})` → возвращает массив `Element[]`
  - Унифицированные schemas для 5+ kind'ов

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
- [ ] **1.4.5** ⚠ НАСТОЯЩИЙ конфигуратор ИБП (bug: v0.43.2 сделано не то что нужно):
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

---

### ⏳ Фаза 2 — Мульти-пространственные схемы (после Фазы 1, 4-6 недель)

**Цель:** один объект — несколько представлений на разных страницах (electrical, layout, mechanical, low-voltage, data).

- [ ] **2.1** `page.kind` расширить: `'schematic' | 'layout' | 'mechanical' | 'low-voltage' | 'data' | '3d'`
- [ ] **2.2** `element.views[page.kind]` — разные представления (SVG) для разных типов страниц
- [ ] **2.3** Layout-page (схема расположения):
  - Холст в миллиметрах
  - Drag-элементов с реальными габаритами (`element.geometry.width/height`)
  - Автоматическая расстановка новых слева
  - Зоны обслуживания (hatched area)
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
7. Обновить раздел «История изменений» ниже с новым номером версии и галочками в чеклисте

---

## История изменений

### v0.52.0 (2026-04-19, Фаза 1.19 — MV-оборудование (RM6, FafeRing, ЩО-70))
- **Задача пользователя:** «Добавим устройства среднего напряжения типа RM-6 или FafeRing и ЩО70, принцип такой же как и с щитами, настройки, автоматы, конфигурирование».
- **Новые kinds в `element-library.js`:**
  - `mv-switchgear` — распределительное устройство СН (compact ringmain / сборные панели)
  - `mv-cell` — ячейка СН (ввод / отходящая / защита трансформатора / измерения / секционная / заземляющая)
- **`shared/element-schemas.js` — 2 новые factory:**
  - `createMvSwitchgearElement(patch)`: поля `mvType` (ringmain/panelboard/gis/air), Un_kV, Uw_kV, In_A (шины), Ip_kA/It_kA (стойкость), insulation (sf6/air/solid/oil), arcProof, IP, form, expandable, cells[]
  - `createMvCellElement(patch)`: cellType (infeed/feeder/transformer-protect/measurement/busCoupler/earthing/metering), Un_kV, In_A, breakerType (VCB/SF6/fuse-switch/switch/isolator/earthing-switch), Icu_kA, fuseRating_A, protectionRelay, ctRatio/vtRatio
- **`shared/mv-switchgear-seed.js` (новый, ~220 строк):**
  - **Schneider RM6** — 7 конфигураций (II, III, IIDI, DI, IDI, IIV, IV) с 2-4 ячейками, 24 кВ SF6, Ip=52.5 кА, Icu=21 кА
  - **FafeRing** (китайский аналог) — 6 конфигураций (CC, CCF, CCCF, CVF, CVV, VVV), 12 кВ SF6
  - **ЩО-70** — 6 отдельных ячеек (ВЛВ-630, ВЛВО-630, ТТ, ССВ-630, ТСН, Р-Н) + 1 типовая сборка «6 ячеек» для ТП 2×1000 кВА (2 ввода + ССВ + 2 отх + ТН)
  - `listBuiltinMvSwitchgear()` для bridge
- **`shared/catalog-bridge.js`:**
  - `_loadMvSwitchgear()` dynamic import
  - В `syncLegacyToLibrary` добавлен 7-й источник
  - После sync `listElements({kind:'mv-switchgear'})` вернёт ~14 builtin моделей, `{kind:'mv-cell'}` — 6 ячеек ЩО-70
- **Последующие фазы (TODO):**
  - 1.19.1: конфигуратор `mv-config/` wizard (по образцу 1.7 panel-config, но со спецификой ячеек)
  - 1.19.2: интеграция в инспектор трансформатора на схеме («Сконфигурировать РУ СН»)
  - 1.19.3: MV-автоматы (VCB, SF6) в breaker-seed с TCC-кривыми

### v0.53.1 (2026-04-19, Фаза 1.20 расширение — цены в сводке SKU + экспорт CSV)
- **Логическое продолжение v0.53.0:**
- **Цены в сводной ведомости кабеля:**
  - `sectionCableBom` ищет `cable-sku` в element-library с совпадением `(cableTypeId + cores + sizeMm2)`
  - Для найденного SKU получает цену через `pricesForElement(id, {activeOnly:true})` — берёт последнюю активную
  - Если есть хоть одна цена — появляются колонки «Цена за м» и «Итого» (с учётом запаса 10%)
  - Итоги по валютам в конце таблицы
  - Предупреждение о позициях без цены + ссылка на catalog/
- **Экспорт CSV из таблицы кабелей:**
  - Кнопка «📥 CSV» в заголовке modal-cable-table
  - 14 колонок: Обозначение, Откуда, Куда, Марка, Материал, Изоляция, Конструкция, Сечение, Жил, Длина, Способ прокладки, Imax, Iдоп, Класс
  - Разделитель `;` (для Excel), BOM UTF-8 для кириллицы
  - Имя файла: `cables-YYYY-MM-DD.csv`
- **APP_VERSION = '0.53.1'**
- **Файлы:**
  - `js/engine/report-sections.js` (+65 строк: резолв cable-sku + цены + colon hasPrices)
  - `js/main.js` (+45 строк exportCableTableCsv)
  - `index.html` (+1 кнопка CSV)

### v0.53.0 (2026-04-19, Фаза 1.20 — марка в отчёте кабелей + сводная ведомость по SKU + таблица кабелей)
- **Запросы пользователя:**
  1. «В отчёт по кабелям и проводникам должна попасть так же марка кабеля»
  2. «Отдельно сформируй отчёт по общему количеству кабеля одной марки и сечения (SKU)»
  3. «Добавь интерфейсную таблицу, где можно быстро просмотреть все кабели, изменить марку кабеля и/или его длину для каждой линии, а так же выбрать способ прокладки»
- **js/engine/report-sections.js:**
  - **sectionCables** — добавлена колонка «Марка» (из `c.cableMark` через `getCableType` → `brand`). Fallback «—» если марка не выбрана
  - **НОВАЯ sectionCableBom** — «Сводная ведомость кабеля по SKU»:
    - Группировка по ключу `(марка + N×S мм² + материал/изоляция)`
    - Fallback-марка «Cu/PVC (без марки)» если не указана
    - Колонки: Марка · Число жил×сечение · Материал/изоляция · Линий · Общая длина · С запасом 10%
    - Итоговая строка: всего SKU + суммарная длина
    - Зарегистрирована как `id: 'cable-bom'` с defaultTemplateId: `builtin-bom-landscape`
- **index.html:**
  - Новая кнопка «🔌 Таблица кабелей» в сайдбаре
  - Модалка `modal-cable-table` (wide 1400px) с поиском + фильтром по классу (LV/MV/HV/DC)
- **js/main.js:**
  - `openCableTableModal`, `renderCableTable()`
  - 8-колонок: Обозначение · Откуда→Куда · Марка (select) · Проводник · Длина (input number) · Способ прокладки (select) · Imax/Iдоп · Класс
  - **Фильтр марок** по классу линии (как в inspector/conn.js): LV→power, MV/HV→hv, DC→dc+power
  - При смене марки — автозаполнение material/insulation
  - При смене длины/метода — сохраняется в conn + notifyChange → recalc
  - Поиск по обозначению/узлам/марке, фильтр «Все/LV/HV/DC»
  - Sticky-шапка таблицы при прокрутке
- **Ценность:**
  - Инженер видит все кабели проекта в одной таблице, редактирует марку/длину/способ прокладки без открытия инспектора каждой линии
  - Сводная ведомость SKU — готовая спецификация для закупки (с запасом 10%)
- **APP_VERSION = '0.53.0'**
- **Файлы:**
  - `js/engine/report-sections.js` (+85 строк sectionCableBom + импорт getCableType + колонка Марка)
  - `index.html` (+25 строк модалка + кнопка)
  - `js/main.js` (+160 строк openCableTableModal + renderCableTable)
  - `js/engine/constants.js` APP_VERSION

### v0.52.2 (2026-04-19, ФИКС бага ДГУ — ВТОРОЙ проход: все функции обхода)
- **Продолжение v0.52.1:** баг вернулся — ЩС G1.PD показывал `Макс: 2826.3 A / 1951.4 kW`. v0.52.1 правил только `_bfsDownstreamWithActiveTies`, но у пользователя ДГУ управлял switchover-щитом через `switchPanelId + triggerGroups` — использовался **другой обход** `scWalk` (внутри panel._maxLoadKw).
- **Найдено 3 функции обхода downstream, каждая с похожим багом:**
  1. ✅ `_bfsDownstreamWithActiveTies` — исправлено в v0.52.1
  2. ❌→✅ `scWalk` (для генератор-управляемых щитов) — через else-ветку рекурсивно шёл в generator
  3. ❌→✅ `downstreamPQ` — тот же паттерн для cos φ
  4. ❌→✅ `simpleDownstream` — не учитывал auxDemandKw вовсе
- **Фикс во всех 3 функциях:** единая логика для `to.type === 'generator' && to.auxInput && c.to.port === 0`:
  - Учитываем `to.auxDemandKw` как consumer-нагрузку (+ `to.auxCosPhi` в downstreamPQ для реактивки)
  - НЕ спускаемся в downstream ДГУ
- **APP_VERSION = '0.52.2'**
- **Файлы:** `js/engine/recalc.js` (~25 строк в 3 функциях)

### v0.52.1 (2026-04-19, ФИКС бага ДГУ: ЩСН собирал всю нагрузку ДГУ)
- **Баг пользователя подтверждён скриншотом:** ДГУ с auxDemandKw=10 кВт, на щите собственных нужд (G2.SB1) отображалось `Макс: 1538 A / 980.3 kW` — вся нагрузка ДГУ.
- **Причина:** в `_bfsDownstreamWithActiveTies` (функция обхода downstream для `maxDownstreamLoad`) BFS от ЩСН шёл через auxConn → ДГУ → далее вниз через исходящие связи ДГУ → потребители. То есть ЩСН «видел» весь downstream ДГУ как свою нагрузку, хотя auxInput — это только для собственных нужд (10 кВт), а выходную нагрузку ДГУ генерирует сам из топлива.
- **Фикс в `js/engine/recalc.js`:**
  - В `_bfsDownstreamWithActiveTies` для `cur.type === 'generator' && cur.auxInput` — НЕ обходим downstream ДГУ, добавляем только `auxDemandKw` как consumer-нагрузку.
  - `continue` пропускает дальнейший обход связей от ДГУ.
- **Результат:** ЩСН теперь показывает только `_maxLoadKw = 10 кВт` (auxDemandKw), `_maxLoadA` соответствующую.
- **APP_VERSION = '0.52.1'**
- **Файлы:** `js/engine/recalc.js` (+18 строк специальной обработки generator.auxInput в BFS)

### v0.51.0 (2026-04-19, Фаза 1.9.2 — TCC-карта цепочки защиты в инспекторе линии)
- **js/engine/inspector/conn.js:**
  - Новая collapsible-секция **«⚡ Карта защиты (TCC)»** в инспекторе соединения
  - Появляется когда `c._breakerIn || c._cableSize` (есть автомат или кабель)
  - Lazy-import `shared/tcc-chart.js` (tcc-chart грузится только при открытии инспектора линии)
- **`_mountConnTccChart(conn)`:**
  - Кривая **этой линии** (синяя, `_breakerIn` + `breakerCurve`)
  - Линия **термостойкости кабеля** (красный пунктир, `_cableSize` + k по material/insulation)
  - **Upstream** автоматы (до 2 уровней вверх, оранжевый/фиолетовый) — через `_collectUpstreamBreakers` с защитой от циклов
  - Вертикальные `I_k max` (из GLOBAL.Ik_kA) и `I_k min` (из модуля phase-loop)
  - Подсказка: как читать график, координация upstream-downstream
- **`_collectUpstreamBreakers(conn)`:** идёт вверх через `conn.from.nodeId`, находит входные connections panel/ups с автоматами, собирает до 5 уровней (защита от зацикливания через `seen` Set)
- **`_normalizeCurveShort`:** MCB_B → B для tcc-curves API
- **`_cableK`:** таблица k (Cu/PVC=115, Cu/XLPE=143, Al/PVC=76, Al/XLPE=94)
- **Ленивый import `tcc-chart.js`** — не грузится пока пользователь не откроет инспектор линии с автоматом
- **APP_VERSION = '0.51.0'** (минор — полноценная TCC в production-режиме инспектора)
- **Файлы:**
  - `js/engine/inspector/conn.js` (+145 строк: _mountConnTccChart + _collectUpstreamBreakers + helpers + UI-блок)
  - `js/engine/constants.js` APP_VERSION

### v0.50.5 (2026-04-19, Фикс: «Страница не отвечает» — защита от параллельных sync в catalog-bridge)
- **Замечание пользователя:** «Проверь» + скриншот «Страница не отвечает» на главной странице Raschet.
- **Диагностика:** в preview console 16+ повторных `[catalog-bridge] synced` после первого запуска. Это не бесконечный цикл, но перегружает main thread при старте и спамит console.
- **Причина:** при инициализации 5 каталогов (panel/ups/battery/transformer/cable-types) каждый делает fallback-migration в `_read()` (копирует legacy ключ в per-user), что триггерит `_write` → `_notify` → `_scheduleSync`. Плюс storage events от других вкладок. Debounce 50мс не успевал батчить.
- **Фиксы в `shared/catalog-bridge.js`:**
  1. **Параллельная защита:** добавлены флаги `_syncInFlight` / `_syncPending`. Если sync уже выполняется — новые запросы не создают параллельный, а ставятся в pending; после завершения выполняется максимум один повтор.
  2. **Увеличенный debounce:** 50 → **150 мс** — хорошо батчит всплеск событий при старте.
  3. **Умный лог:** `console.info` только при реальном изменении total. Повторные sync с тем же количеством элементов — без спама.
  4. **Ошибки в catch:** promise возвращает stats, trycatch правильно ловит исключения.
- **APP_VERSION = '0.50.5'**
- **Файлы:**
  - `shared/catalog-bridge.js` (+15 строк _syncInFlight/_syncPending + умный лог + промис в async)
  - `js/engine/constants.js` APP_VERSION

### v0.50.4 (2026-04-19, Фаза 1.18 — Let-through I²t для MCB (1.5 мм² для освещения))
- **Цель:** довести расчёт термической стойкости кабеля для MCB в мгновенной зоне до реального (сейчас 4 мм² для лампочек вместо нормативных 1.5).
- **Физика:** MCB класса 3 по IEC 60898-1 токоограничивающий. При I_k ≥ I_cu обрывает ток за 3-5 мс, с ограничением пикового значения. Фактическое I²t, прошедшее через кабель, значительно меньше чем `I_k² × t_reaction`.
- **shared/tcc-curves.js:**
  - `MCB_LETTHROUGH_I2T` — таблица из паспортов производителей (ABB S200 / Schneider iC60 / Legrand DX3 при Icu=6 кА): 6A→3000, 10A→5000, 16A→8000, 20A→10000, 25A→13000, 32A→18000, 40A→25000, 50A→35000, 63A→50000 А²·с
  - `letThroughI2t(In, curve, Ik)` — возвращает I²t для кривых B/C/D/K/Z, с пропорциональным снижением при I_k < 6 кА (по квадрату тока)
  - Для MCCB/ACB возвращает null (данные индивидуальны per модель, пока используется стандартная формула)
- **shared/calc-modules/short-circuit.js:**
  - Import `letThroughI2t`
  - Новая логика: если `curve ∈ {B,C,D,K,Z}` И `ratio ≥ magThresh` → используется `S_min = √(I²t) / k` вместо `I_k × √t_k / k`
  - В details добавлены поля `letThroughUsed`, `letThroughI2t`, `calcMode`
  - В warnings — разные сообщения для let-through vs стандартного расчёта
- **Результаты:**
  - MCB B 6A @ I_k=6 кА: S_min = √3000/115 = **0.48 мм² → 1.5 мм²** (было 3.69→4)
  - MCB B 16A @ I_k=6 кА: S_min = √8000/115 = **0.78 мм² → 1.5 мм²**
  - MCB C 25A @ I_k=6 кА: S_min = √13000/115 = **0.99 мм² → 1.5 мм²**
  - MCB C 63A @ I_k=6 кА: S_min = √50000/115 = **1.95 мм² → 2.5 мм²**
- **APP_VERSION = '0.50.4'**
- **Файлы:**
  - `shared/tcc-curves.js` (+60 строк: MCB_LETTHROUGH_I2T + letThroughI2t)
  - `shared/calc-modules/short-circuit.js` (+25 строк: let-through логика в calc + detailed warnings)
  - `js/engine/constants.js` APP_VERSION

### v0.50.3 (2026-04-19, Фикс: «👁 Просмотр» для каждого элемента каталога)
- **Замечание пользователя:** «В каталоге нельзя выбрать и просмотреть свойства элемента каталога, только если сделать копию и зайти в настройку»
- **До фикса:** на строке builtin-элемента был только «+ Цена / Цены / Клон» — чтобы посмотреть параметры Kehua MR33 1000 или ABB ArTu, пользователь должен был сначала клонировать элемент, затем редактировать клон (неудобно).
- **Фикс в `catalog/catalog.js`:**
  - На каждой строке в таблице элементов появилась кнопка **«👁 Просмотр»** (первая в actions)
  - `openViewElementModal(id)`:
    - Для breaker — перенаправляет на `openBreakerDetailsModal` (TCC-график + параметры)
    - Для остальных — universal read-only модалка с таблицами:
      * Общие параметры (id, kind, category, label, manufacturer, series, tags, …)
      * Electrical (все поля `el.electrical`)
      * Geometry (все поля `el.geometry`)
      * Специфичные (все поля `el.kindProps`)
      * Composition (таблица role / label / qty / phantom — если есть)
      * Полный JSON в `<details>` для экспорта
    - Для builtin — подсказка «только просмотр, клонируйте для правки»
  - В footer модалки кнопка **«Клонировать для редактирования»** — делает `cloneElement` + автоматически открывает редактирование клона
  - Кнопка «⚙ Параметры» (дублировала view для breaker) — убрана, теперь один универсальный вход
- **openModal helper усилен:** в начале вызова сбрасывает состояние кнопок (дисплей saveBtn, текст cancelBtn, удаляет временные кнопки .view-clone-btn). Это избавило от хрупкого transitionend-хака.
- **APP_VERSION = '0.50.3'**
- **Файлы:**
  - `catalog/catalog.js` (+130 строк openViewElementModal + усиление openModal; −1 кнопка ⚙)

### v0.50.2 (2026-04-19, Фаза 1.17 — TCC-координация в cable/, убрано демо из catalog/)
- **Замечание пользователя:** «Зачем автоматы-аналитику добавил в каталог. Это должно относиться только к конкретной цепочке в конфигураторе схем и может быть в подборе кабеля. Учитывать конкретные свойства автоматов и кабеля. Автоматы с регулировкой должны регулироваться и влиять на графики».
- **Убрано:** демо-секция «Сравнение TCC-кривых» из `catalog/ → Аналитика` (это справочник, не место для анализа цепочки). Импорт `mountTccChart` из catalog.js удалён.
- **Добавлено в `cable/cable-calc.js`:**
  - После «Рассчитать» внизу появляется блок **«⚡ Координация защиты: автомат ↔ кабель»**
  - SVG-график 2 кривых:
    * Кривая **автомата** (синяя, из `tccBreakerTime` по In и curve)
    * Линия **термостойкости кабеля** (красная пунктирная, `k²·S²/I²` по выбранному материалу/изоляции)
  - Вертикальная линия `I_k max` (из поля в форме)
  - Диапазон оси X автоматически: от 0.8×In до max(Ik, 200×In)
- **Живые настройки для MCCB/ACB:**
  - Если `breakerCurve` = MCCB/ACB — показываются слайдеры **Ir / Isd / tsd**
  - Слайдеры в реальном времени меняют кривую на графике (через `handle.update`)
  - Диапазоны Ir/Isd/tsd рассчитываются по номиналу автомата
- **Для MCB:** подсказка «характеристика фиксированная, настройки не регулируются; для регулировки используйте MCCB»
- **Графика на этой странице:**
  - Только для ДАННОЙ линии (не общая аналитика)
  - Только для ВЫБРАННОГО автомата и кабеля (не абстрактный сравнительный)
  - k коэффициент рассчитывается по фактическим material/insulation (115/143/76/94)
- **Ленивый импорт:** `shared/tcc-chart.js` грузится только когда пользователь дошёл до результатов расчёта — страница без этого легче
- **APP_VERSION = '0.50.2'**
- **Файлы:**
  - `catalog/catalog.js` (−24 строки демо-TCC из analytics; закомментирован импорт)
  - `cable/cable-calc.js` (+130 строк: _renderTccCoordination + _loadTccChart + слайдеры MCCB)

### v0.50.1 (2026-04-19, Фикс: число жил на ВН-кабеле)
- **Баг пользователя:** «На ВН-линии utility → трансформатор показывается 5×50 мм². ВН-кабель — это обычно 3 жилы (3 фазы), иногда с броней, но броня не считается отдельной жилой».
- **Причина:** в `cableWireCount` проверка `U >= 1000` использовала `nodeVoltage(toN)`. Когда `toN` — трансформатор, `nodeVoltage` возвращает напряжение вторички (LV), и HV-ветка не срабатывала. Также fallback в `render.js` был `c._threePhase ? 5 : 3` — для HV выдавал 5.
- **Фиксы:**
  - **js/engine/electrical.js** `cableWireCount`:
    - Приоритет 1: `conn._wireCountManual`
    - Приоритет 2: `toN.wireCount`
    - Приоритет 3 **(обновлён):** HV-признак — либо `conn._isHV` (recalc уже определил с учётом utility↔transformer), либо `U(fromN) >= 1000`, либо `U(toN) >= 1000` — любой конец в ВН → **3 жилы**
    - Приоритет 4: LV через `effectiveWireFlags`
  - **js/engine/render.js** fallback: `c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3))`
- **UI:** в инспекторе соединения для ВН-линий (`c._isHV`) добавлена опция «Кабель с бронёй (заземлённой)»:
  - Флаг `c.hasArmour` — информационный (для BOM и выбора марки: ПвПу vs ПвПуг)
  - Броня НЕ учитывается в числе жил (она заземляется отдельно)
  - Подсказка под чекбоксом: «На ВН 3 жилы (3 фазы). Броня — экран, заземлённый на обоих концах.»
- **Результат:** на ВН-линии теперь `3×50 мм²` вместо `5×50 мм²`. Для кабелей с бронёй — чекбокс в инспекторе для корректного BOM (при выборе марки из справочника).
- **APP_VERSION = '0.50.1'**
- **Файлы:**
  - `js/engine/electrical.js` (+5 строк логики HV через _isHV + _U_from)
  - `js/engine/render.js` (fallback с учётом _isHV)
  - `js/engine/inspector/conn.js` (+7 строк hasArmour чекбокс)

### v0.50.0 (2026-04-19, Фаза 1.16 — разделение «Свойства/Параметры проекта/Параметры расчёта»)
- **Замечание пользователя:** «В параметры проекта и расчёта сделай так чтобы соответствовало назначению — то что нужно для расчёта, должно быть в параметрах расчёта, то что нужно для проекта в параметрах проекта. Название или номер проекта — в свойствах».
- **До фикса:** «Параметры проекта» = метаданные (название, заказчик…). «Параметры расчёта» = сборная солянка из методики + кабельных умолчаний + прокладки.
- **Реорганизация (3 модалки):**

  **📋 Свойства проекта** (бывшая «Параметры проекта», `modal-project-info`):
    - Обозначение (шифр), название, заказчик, объект, стадия, автор, описание
    - Это метаданные — в шапку отчёта и state.project

  **🔧 Параметры проекта** (НОВАЯ, `modal-project-params`):
    - **Основная марка кабеля по проекту**: LV (из `cable-type` category='power'), HV (category='hv') — выпадающие из справочника
    - Материал жил, изоляция, тип конструкции, макс. сечение
    - Способ прокладки, температура среды
    - Сохраняется в GLOBAL (projectMainCableLv, projectMainCableHv, defaultMaterial, …)

  **⚙ Параметры расчёта** (очищен, `modal-settings`):
    - Методика расчёта (IEC/ПУЭ), защита парал., мин. запас In автомата, макс. параллельных
    - Макс. падение напряжения, cos φ, система заземления
    - Показывать справку, сброс базовых пресетов
    - Убраны: материал, изоляция, тип конструкции, макс. сечение, способ прокладки, температура (переехали в Параметры проекта)

- **UI:**
  - Сайдбар: 3 кнопки с разными назначениями и tooltip'ами
  - Флэш-сообщения: «Свойства проекта сохранены» / «Параметры проекта применены» / «Параметры расчёта применены»
  - openProjectParamsModal асинхронно загружает справочник кабелей из `cable-types-catalog`

- **APP_VERSION = '0.50.0'** (минор — значительная реорганизация UI)
- **Файлы:**
  - `index.html` (новая модалка modal-project-params; очищена modal-settings; новая кнопка btn-open-project-params)
  - `js/main.js` (openProjectParamsModal / saveProjectParamsModal; очищены openSettingsModal / saveSettingsModal; переименован flash)

### v0.49.4 (2026-04-19, Фаза 1.15 — фильтр кабелей на электрической схеме)
- **Баг пользователя:** «На электрической схеме — ограничить только силовым кабелем. Для MV/HV — только высоковольтным»
- **До фикса:** в инспекторе соединения select «Марка кабеля» показывал все 16 категорий (Силовой / ВН / Слаботочный / Данные / DC) — UTP cat.5e и ТПП можно было поставить на силовую линию 98 А — бессмысленно.
- **Фикс в `js/engine/inspector/conn.js`:**
  - Определение класса линии: `c._isHV` → MV/HV, `c._isDC` → DC, иначе LV
  - Фильтр cable-types по allowedCats:
    - LV → только `['power']` (ВВГ, АВВГ, АВБбШв, ВВГнг-LS, АПвПу, ПВС)
    - MV/HV → только `['hv']` (АПвПуг, ПвПу)
    - DC → `['dc', 'power']`
  - Слаботочка/данные/полевые категории исключены из электрической принципиальной схемы (они будут доступны на low-voltage/data page.kind в Фазе 2)
- **UI:**
  - Под select'ом надпись «Класс линии: <b>LV / MV/HV / DC</b>» с пояснением
  - Если у соединения уже выбрана марка из запрещённой категории (legacy/drag-n-drop) — показывается в отдельной группе «⚠ Несоответствие классу линии» + красное предупреждение
- **APP_VERSION = '0.49.4'**
- **Файлы:**
  - `js/engine/inspector/conn.js` (~45 строк: логика allowedCats + UI класса линии + warning)

### v0.49.3 (2026-04-19, Фаза 1.6 — logistics/ модуль MVP)
- Новый модуль `logistics/` с 4 вкладками: Отправления / Склады / Тарифы / Калькулятор
- `shared/logistics-schemas.js`: WarehouseRecord, CarrierRate, ShipmentRecord + API + calcShipmentCost
- Калькулятор: фиксированная + ₽/кг + ₽/км + ₽/м³ с учётом минимального заказа
- Интеграция с counterparties (из catalog/): перевозчики выбираются из списка контрагентов типа logistics/supplier
- Обновлена карточка в hub, badge: 'new'

### v0.49.2 (2026-04-19, Фаза 1.8 — анализ селективности защиты)
- **js/engine/selectivity-check.js (новый):**
  - `analyzeSelectivity()` обходит все panel/ups-узлы, находит пары inputs×outputs
  - Для каждой пары вызывает `checkSelectivity(up, down, I_k)` из tcc-curves
  - Преобразование форматов: `MCB_B` → `B` для tcc-curves (`_normalizeCurve`)
  - I_k берётся из модуля phase-loop (`c._modules.phaseLoop.details.Ik1A`) если посчитан
  - Возвращает `{ pairs: [...], summary: { total, selective, nonSelective } }`
- **js/engine/report-sections.js:**
  - Новая секция `sectionSelectivity()` зарегистрирована как `id: 'selectivity'`
  - Сводная таблица + детализация по парам (узел/up/down/I_k/статус/комментарий)
  - При обнаружении нарушений — блок с рекомендациями (увеличить номинал up, использовать задержку tsd, проверить таблицы производителя)
  - Graceful fallback если в проекте нет панелей с breakers
- **js/engine/index.js:**
  - Экспонирование `window.Raschet.analyzeSelectivity()`
- **Ценность:**
  - Инженер запускает отчёт «Селективность защиты» → получает список пар с вердиктом ✓/✗
  - Обнаруживаются проблемы раньше сдачи проекта
  - Интеграция с уже имеющимися данными проекта (c._breakerIn, c.breakerCurve)
- **APP_VERSION = '0.49.2'**
- **Файлы:**
  - `js/engine/selectivity-check.js` (новый, ~95 строк)
  - `js/engine/report-sections.js` (+70 строк sectionSelectivity)
  - `js/engine/index.js` (+2 строки)
  - `js/engine/constants.js` APP_VERSION = '0.49.2'

### v0.49.1 (2026-04-19, Фаза 1.9 — TCC-график с toggle (MVP))
- **shared/tcc-chart.js** (новый ~215 строк):
  - `mountTccChart(container, opts)` — монтирует SVG-график в любой контейнер
  - Поддерживает 3 типа кривых: `breaker` (MCB/MCCB), `fuse` (gG/gM/aM), `cable` (термостойкость IEC 60364-4-43)
  - Лог-лог оси, сетка major+minor (на каждую декаду 9 линий), автометки
  - Легенда с **чекбоксами toggle** — кривые скрываются/показываются без перерисовки данных
  - Вертикальные линии `I_k max` / `I_k min` (опционально) для визуализации диапазона КЗ
  - `handle.update({ items, options })`, `handle.toggle(id, visible)` для внешнего управления
  - Автоматические цвета (10-цветная палитра), ручные через `item.color`
  - Кривые кабеля — пунктиром для визуального отличия
- **catalog/catalog.js (вкладка Аналитика):**
  - Новая секция «🔌 Сравнение TCC-кривых автоматов»
  - Демо: 4 автомата (MCB B 16, C 25, D 40, MCCB 100) + 2 кабеля (2.5 и 10 мм²)
  - Вертикальная линия I_k_max = 6000 А
  - Чекбоксы позволяют оставить на графике только нужные кривые для сравнения
- **Ценность:**
  - Пользователь видит как ведёт себя автомат во времени при разных токах
  - Можно сравнить селективность: быстрый MCB B vs медленный MCB D
  - Подготовка к Фазе 1.8 (автоматическая проверка селективности)
- **APP_VERSION = '0.49.1'**
- **Файлы:**
  - `shared/tcc-chart.js` (новый)
  - `catalog/catalog.js` (+23 строки TCC-демо + импорт)
  - `js/engine/constants.js` APP_VERSION = '0.49.1'

### v0.49.0 (2026-04-19, Фаза 1.10 — справочник автоматов в catalog/ + мини-TCC)
- **shared/catalog-bridge.js:** `_loadBreakers()` + регистрация builtin breakers из `breaker-seed.js`. После init `listElements({kind:'breaker'})` возвращает ~82 автомата: MCB B/C/D (1-63A, 1P/3P) + MCCB TM/ELEC (100-1600A)
- **catalog/catalog.js:**
  - Import `tccBreakerTime`, `tccSamplePoints` из `shared/tcc-curves.js`
  - На строке `kind='breaker'` кнопка «⚙ Параметры»
  - Новая модалка `openBreakerDetailsModal(id)`:
    - Паспорт: тип, характеристика, In, полюса, Icu, расцепитель, модулей
    - **SVG-график TCC** (log-log оси X=I/In 1-100, Y=t 0.01-1000 с) с кривой автомата
    - Settings-блок для электронных MCCB с Ir/Isd/tsd/Ii (read-only для builtin, редактируется у клонов)
    - Info: builtin нельзя редактировать → кнопка «Клон» делает user-копию с возможностью правки
  - `_renderTccMiniSvg()` — 360×240 SVG с сеткой, осями, кривой по tccBreakerTime
- **js/engine/report-sections.js:** добавлена метка для `cable-sku` в KIND_LABELS отчёта BOM
- **Эффект для пользователя:**
  - В каталоге (вкладка Элементы + filter kind=breaker) — 82 готовых автомата с TCC
  - Клик «⚙ Параметры» — визуальная кривая отключения для понимания работы защиты
  - Подготовка к Фазам 1.8/1.9 (селективность, цепочка TCC)
- **APP_VERSION = '0.49.0'**
- **Файлы:**
  - `shared/catalog-bridge.js` (+10 строк _loadBreakers + в syncLegacyToLibrary)
  - `catalog/catalog.js` (+120 строк openBreakerDetailsModal + _renderTccMiniSvg)
  - `js/engine/report-sections.js` (+1 строка KIND_LABELS)
  - `js/engine/constants.js` APP_VERSION = '0.49.0'

### v0.48.1 (2026-04-19, ФИКС: завышенное сечение по термической стойкости)
- **Баг пользователя:** «Для нагрузки 2.72 А освещения MCB B 6A выдаётся 16 мм² — никто не ставит лампочки на 16 мм²»
- **Причина в `shared/calc-modules/short-circuit.js`:**
  ```
  const tk = tkUser > 0 ? tkUser : estimateTripTime(Ik, In, curve);
  ```
  Если пользователь задал tk (например 0.05 с из wizard'а) — игнорировалось РЕАЛЬНОЕ время срабатывания автомата. Для MCB B 6A при Ik=6000A ratio=1000 (глубокая мгновенная зона), реальное tk = 5-10 мс, а не 50 мс. Из-за этого:
  - Было: S_min = 6000 × √0.05 / 115 = 11.66 → 16 мм²
  - Стало: S_min = 6000 × √0.005 / 115 = 3.69 → 4 мм²
- **Фикс 1:** логика `tk = min(tkUser, tkAuto)`:
  - Если пользователь задал меньше — верим ему (upstream может быть быстрее)
  - Если задал больше — ограничиваем расчётным tk по кривой автомата (кабель не может греться дольше, чем работает защита)
  - Новый флаг `tkSource: 'user' | 'auto' | 'auto-clamped'` в details
- **Фикс 2:** добавлена «глубокая мгновенная зона» в estimateTripTime:
  - ratio ≥ 2 × magThresh (например MCB B при I > 10×In, MCB C при I > 20×In, MCB D при I > 40×In) → tk = 0.005 с (токоограничение MCB класса 3 по IEC 60898-1, let-through 5 мс)
  - Обычная мгн. зона (magThresh ≤ ratio < 2×magThresh) → tk = 0.01 с
- **Эффект:** сечение кабеля по термической стойкости резко падает для малых нагрузок с быстрыми MCB (с 16 → 4 мм²)
- **Ограничение:** для получения 1.5 мм² (как в стандартной проводке освещения) требуется полноценный let-through I²t из паспорта автомата. Это Фаза 1.10 (справочник автоматов с TCC).
- **Файлы:**
  - `shared/calc-modules/short-circuit.js` (+20 строк логики tk-clamp, +1 зона в estimateTripTime)
  - `js/engine/constants.js` APP_VERSION = '0.48.1'

### v0.48.0 (2026-04-19, Фаза 1.7 + фикс wizard tk)
- **Фаза 1.7: Конфигуратор щита (wizard)** по образцу ups-config
  - `panel-config/index.html`: добавлена секция `#pc-wizard` появляющаяся при `?nodeId=`
  - 4 шага: Требования → Оболочка → Автоматы → Итог
  - Шаг 1: имя, тип (distribution/main/avr/group/motor), нагрузка kW, напряжение, вводы, выходы, IP, Form, запас %
  - Шаг 2: подбор оболочек из panel-catalog по In ≥ I_required × (1 + reserve), IP, Form; сортировка по утилизации (оптимум 50-80%); кнопка «Продолжить без оболочки» если каталог пуст
  - Шаг 3: авто-генерация списка автоматов (вводные по числу inputs + АВР-переключатель если kind=avr + отходящие по outputs); редактируемая таблица (name/In/curve/poles)
  - Шаг 4: итог с полной сводкой + composition для применения
  - `panel-config/panel-config.js`: + `initPanelWizard()`, `_pcPickEnclosures()`, `_pcGenerateBreakers()`, `_pcApplyConfiguration()`
  - Payload в `localStorage.pendingPanelSelection.v1` с полями panelCatalogId/inputs/outputs/ipRating/form/breakers/composition
  - `panel-config/panel-config.css`: стили .wiz-step, .enclosure-item, .pc-breakers-table, .wiz-summary-box
  - Footer подключён через mountFooter()

- **Фикс wizard tk (cable/protection-wizard.js):**
  - Баг пользователя: «для нагрузки 16А получилось 25 мм² для удалённого щита»
  - Причина: S_min = I_k × √t_k / k = 6000 × √0.15 / 115 ≈ 20.2 мм² → 25 мм² стандарт. 
    t_k=0.15 с слишком консервативно для MCB с мгновенным расцепителем.
  - Заменил `TK_TABLE[distance]` на `TK_MATRIX[load][distance]`:
    - MCB B (освещение): 0.10/0.05/0.02/0.02 с
    - MCB C (смешанная): 0.15/0.08/0.03/0.02 с
    - MCB D (моторы):    0.20/0.10/0.05/0.03 с
    - MCCB (промышл.):   0.40/0.25/0.15/0.10 с
  - Для быстрых автоматов на удалённом уровне t_k теперь 20-50 мс (реалистично для мгн. расцепителя при I_k ≫ I_mag)
  - Обновлено пояснение в Итог: расширенная подсказка про t_k и «если кабель раздувается — проверьте t_k и I_k»
  - Эффект: для нагрузки 16A / MCB C / far: t_k=0.03 с + I_k=3 кА → S_min = 3000×0.173/115 ≈ 4.5 мм² → 6 мм² (вместо 25)

- **APP_VERSION = '0.48.0'**

### v0.47.1 (2026-04-19, Фаза 1.14 — помощник параметров КЗ в cable/)
- **Задача пользователя:** «Добавь конфигуратор в параметры защиты, чтобы по опросу пользователя по типовым вопросам-ответам можно было заполнить параметры источника. Чтобы человек, который не знает как правильно заполнить этот раздел, смог его заполнить».
- **cable/index.html:**
  - Новая кнопка «🧙 Помощник» в заголовке раздела «Параметры КЗ и защиты»
  - Модалка `#protection-wizard-modal` с header/progress/content/footer
- **cable/cable-calc.css:** стили wizard'а (.pw-modal, .pw-option с hover/selected, progress-bar, summary-table)
- **cable/protection-wizard.js (новый):**
  - 4 шага с вопросами:
    1. **Что питает линию?** 6 вариантов (городская сеть мощная/средняя/бытовая, генератор, ИБП, своя ТП)
    2. **Где находится автомат?** 4 варианта (вводной щит / распредщит / групповой / конечный)
    3. **Какой тип нагрузки?** 4 варианта (освещение / смешанная / двигатели / промышленная)
    4. **Система заземления?** 5 вариантов (TN-C-S / TN-S / TT / IT / TN-C)
  - Таблицы подбора:
    - `IK_TABLE` 6×4 — ток КЗ (кА) по комбинации источник × расстояние, от 1 до 25 кА
    - `TK_TABLE` — время отключения по уровню (0.1-0.4 с) с учётом селективности вверх
    - `CURVE_TABLE` — характеристика автомата (B/C/D/MCCB) по типу нагрузки
    - `GROUNDING_TABLE` — прямой маппинг выбора
  - 5-й экран «Итог» — рекомендации с пояснениями и примечание про паспорт ТП
  - После клика «Применить» — поля `in-ik`/`in-tk`/`in-breakerCurve`/`in-earthing` заполняются с визуальной подсветкой (зелёный bg на 1.5 сек)
  - Можно шагать назад / вперёд, закрытие по × / клику вне модалки
- **APP_VERSION = '0.47.1'**
- **Ценность:** новичок (не электрик) может заполнить сложный раздел за 30 секунд, выбирая варианты на обычном языке («городская сеть, квартира»), не вникая в I_k / t_k / МСВ
- **Файлы:**
  - `cable/index.html` (+14 строк кнопка + модалка)
  - `cable/cable-calc.css` (+135 строк стили wizard)
  - `cable/protection-wizard.js` (новый, 230 строк)
  - `js/engine/constants.js` APP_VERSION = '0.47.1'

### v0.47.0 (2026-04-19, Фаза 1.12 + 1.13 — общий header/footer, объединение elements→catalog, cable-sku)
- **Фаза 1.12 — единый header/footer/version для всех модулей:**
  - Создан `shared/app-footer.js` с `mountFooter()`: версия (v0.47.0), ссылки (hub / каталог / GitHub), copyright, инжект CSS
  - `catalog/index.html` переделан: правильный mount ID `rs-header-mount`, вызов `mountHeader()` + `mountFooter()`
  - `elements/` → redirect (meta refresh + кнопка перехода) на `catalog/` во избежание дублирования UI
  - `hub.html` — удалена карточка «Библиотека элементов», остался один вход «Каталог и библиотека элементов»
  - `modules.json` — объединены записи `elements` и `catalog` в один модуль
  - Данные НЕ дублируются: `shared/element-library.js` остаётся единственным источником
- **Фаза 1.13 — cable-sku kind и валидация цен (критичное исправление):**
  - Проблема пользователя: «нельзя сказать что ВВГ стоит 5₽, только ВВГ 4×10 стоит 5₽»
  - `shared/element-library.js`:
    - `ELEMENT_KINDS` получил флаг `pricable` у каждого kind
    - Новый kind `'cable-sku'` — конкретный типоразмер (ВВГнг-LS 3×2.5 мм²)
    - `'cable-type'` помечен `pricable: false` — цены напрямую нельзя
    - `isPricableKind(kind)` экспорт для UI-валидации
    - `globalThis.__raschetElementLibrary` для lazy-lookup без циклического импорта
  - `shared/element-schemas.js`:
    - `createCableSkuElement(patch)` — factory с kindProps `{ cableTypeId, cores, sizeMm2, hasN, hasPE, vendorSku, lengthPackage, … }`
    - Авто-id вида `vvgng-ls-3x2.5`
    - Зарегистрирован в FACTORIES
  - `shared/price-records.js`:
    - `savePrice()` валидирует `kind` через globalThis bridge — блокирует привязку цены к cable-type (и другим non-pricable), показывает подсказку создать SKU
  - `catalog/catalog.js`:
    - Import `isPricableKind` + `createCableSkuElement`
    - Actions колонка в табе Элементы: для cable-type кнопка «+ Цена» заменена на «+ SKU», для non-pricable — disabled кнопка с tooltip
    - Новая модалка `openCableSkuModal(cableTypeId)`:
      - Селекты стандартных жил (1/2/3/4/5/7/12/19/24/37) и сечений (0.5…800 мм² по ГОСТ 22483/IEC 60228)
      - Чекбоксы N-жила, PE-жила
      - Опц.: производитель, vendorSku, диаметр, масса кг/км, длина бухты
      - После создания — автоматически открывается окно «+ Цена»
    - `openPriceModal` — элементы фильтруются по `isPricableKind` (cable-type исключены)
- **APP_VERSION = '0.47.0'**
- **Файлы:**
  - `shared/app-footer.js` (новый, 115 строк)
  - `shared/element-library.js` (+15 строк ELEMENT_KINDS.pricable + isPricableKind + globalThis bridge)
  - `shared/element-schemas.js` (+54 строки createCableSkuElement + регистрация)
  - `shared/price-records.js` (+20 строк валидация через globalThis)
  - `catalog/catalog.js` (+90 строк SKU modal + actions; -8 строк старой логики)
  - `catalog/index.html` (header/footer mount fix)
  - `elements/index.html` (redirect)
  - `hub.html` (-27 строк дублирующей карточки)
  - `modules.json` (-13 строк объединение)

### v0.46.1 (2026-04-19, Фаза 1.11 — типы кабеля в UI инспектора)
- **Баг (пользователь «куда ты добавил типы кабеля?»):** в v0.41.0 создан `shared/cable-types-catalog.js` с 16 базовыми типами, но UI для выбора конкретной марки (ВВГнг-LS / АВБбШв / UTP / …) в инспекторе отсутствовал. Пользователь видел только «конструкцию» проводника (multi/single/solid/busbar).
- **inspector/conn.js** — новый select «Марка кабеля (из справочника)»:
  - Import `listCableTypes`, `getCableType` из `shared/cable-types-catalog.js`
  - Import `CABLE_CATEGORIES` из constants для группировки
  - Select с `<optgroup>` по категориям: Силовой / ВН / Слаботочный / Данные / Полевой / DC
  - 16 базовых + пользовательские типы
  - Info-блок под select'ом: fullName, стандарт, материал, изоляция, иконки «огнестойкий» / «LSZH»
  - Handler: при выборе марки — автоподстановка `c.material` и `c.insulation` из записи
- **Текущие точки доступа к каталогу типов кабелей:**
  1. ✅ `catalog/` модуль → вкладка «Элементы» → фильтр kind=cable-type (16 builtin через bridge)
  2. ✅ `elements/` MVP-редактор (через bridge)
  3. ✅ **НОВОЕ:** инспектор соединения → select «Марка кабеля» (данная правка)
  4. ⏳ `cable/` калькулятор — не интегрировано (TODO)
- **APP_VERSION = '0.46.1'**

### v0.46.0 (2026-04-19, Фаза 1.4.5 — конфигуратор ИБП wizard)
- Полноценный 3-шаговый wizard в `ups-config/` при открытии с `?nodeId=`
- Шаги: Требования → Подбор фрейма → Итог
- Автоподбор: N/N+1/N+2/2N, фильтр по Vdc, сортировка по утилизации
- Возврат composition (frame + инфо о модулях) + применение в узел через engine receiver
- Фикс бага v0.43.2 («кнопка вела на справочник, а не на конфигуратор»)

### v0.45.1 (2026-04-19, Фаза 1.5.7 — интеграция цен в BOM)
- **shared/bom.js** расширено:
  - `PRICE_STRATEGIES`: latest/min/max/avg/counterparty
  - `resolveUnitPrice(elementId, { strategy, currency, counterpartyId, activeOnly })` → `{ unitPrice, currency, source, priceRecord }`
  - `aggregateBom(items, opts)` — если `opts` заданы, каждая строка получает unitPrice/currency/totalPrice/priceSource
  - `bomTotals(aggregated)` → `{ totals (Map<currency, sum>), missingCount, pricedCount, totalRows }`
  - `collectBomFromProject(state, opts)` возвращает `{ flat, aggregated, totals }`
- **js/engine/report-sections.js** `sectionBom` обновлён:
  - Вызывается с `{ priceStrategy: 'latest', activeOnly: true }`
  - Колонки «Цена за ед.» + «Итого» появляются когда хоть одна позиция имеет цену
  - Строки ИТОГО по каждой валюте в конце таблицы
  - Предупреждение о позициях без цены со ссылкой на модуль catalog
- **window.Raschet:**
  - `getBom(opts)`, `getBomMarkdown(opts)` принимают опции
  - `getPriceStrategies()` для UI
- **Эффект:**
  - Отчёт «Спецификация оборудования» теперь включает стоимость
  - При отсутствии цен — graceful fallback (колонки не показываются, текст-подсказка)
  - Фундамент для Фазы 1.4.5 (конфигуратор ИБП с итоговой ценой) и 1.6 (логистика + полная смета)
- **Файлы:**
  - `shared/bom.js` (+90 строк)
  - `js/engine/report-sections.js` (~40 строк изменено в sectionBom)
  - `js/engine/index.js` (+3 строки API)
  - `js/engine/constants.js` APP_VERSION = '0.45.1'

### v0.45.0 (2026-04-19, Фаза 1.5 — модуль catalog/ полноценный)
- **shared/counterparty-catalog.js** (новый ~130 строк):
  - `CounterpartyRecord` schema: name/shortName/inn/kpp/type/address/contacts/paymentTerms/currency/discount/tags/notes
  - 7 типов: supplier/manufacturer/dealer/logistics/warehouse/customer/other
  - API: list/get/save/remove/clear + `onCounterpartiesChange` + `validateInn`
- **shared/price-records.js** (новый ~230 строк):
  - `PriceRecord` schema: elementId/price/currency/priceType/counterpartyId/recordedAt/validFrom/validUntil/quantity/vat/vatIncluded/source/conditions/notes
  - 6 типов цен: purchase/retail/wholesale/list/special/project
  - 6 валют: RUB/USD/EUR/CNY/KZT/BYN
  - API: listPrices (с фильтрами), getPrice, savePrice, removePrice, `pricesForElement` (агрегаты min/max/avg/latest), `bulkAddPrices` для импорта, export/import JSON
  - Множественные цены на элемент (история + разные контрагенты)
- **catalog/** (новый модуль, 3 файла ~900 строк):
  - `index.html` — tabs Элементы / Цены / Контрагенты / Импорт / Аналитика
  - `catalog.css` — стили: tabs, toolbars, badges, modals, dropzone, stat-cards
  - `catalog.js`:
    - Tab **Элементы**: таблица с последней ценой, кол-вом предложений; фильтры (kind/source/search); actions (add price / view prices / edit / clone / delete); cross-navigation к табу Цены с фильтром
    - Tab **Цены**: таблица с датой/элементом/типом/ценой/контрагентом/источником/активностью; фильтры (priceType/counterparty/currency/element); полная модалка редактирования (поля: элемент, цена, валюта, тип, контрагент, даты, количество, НДС, источник, условия, примечания)
    - Tab **Контрагенты**: таблица с типом/названием/ИНН-КПП/контактом/тегами; модалка CRUD с валидацией ИНН
    - Tab **Импорт**: drag-drop XLSX/CSV с авто-маппингом колонок (Price/Цена/SKU/Артикул), preview первых 5 строк, выбор контрагента и типа цены на весь файл, применение; + импорт/экспорт JSON
    - Tab **Аналитика**: stat-cards (всего элементов/контрагентов/цен/с-без цен/устаревшие >90д); топ-5 контрагентов по числу цен; список элементов без цен с inline-кнопкой «+ Цена»
  - Реактивность: onLibraryChange/onPricesChange/onCounterpartiesChange
- **modules.json** — зарегистрированы catalog (badge: new) и logistics (badge: wip)
- **hub.html** — 2 новые карточки (catalog с оранжевой иконкой, logistics с зелёной грузовичком-иконкой)
- **Ценность:**
  - Полноценное управление ценами с историей, множественными контрагентами, импорт из Excel
  - Аналитика помогает найти дыры (элементы без цен, устаревшие прайсы)
  - Подготовка под Фазу 1.6 (логистика) и 1.5.7 (цены в BOM)
- **Файлы:**
  - `shared/counterparty-catalog.js` (новый)
  - `shared/price-records.js` (новый)
  - `catalog/index.html` (новый)
  - `catalog/catalog.css` (новый)
  - `catalog/catalog.js` (новый)
  - `modules.json` (+26 строк)
  - `hub.html` (+28 строк)
  - `js/engine/constants.js` APP_VERSION = '0.45.0'

### v0.44.0 (2026-04-19, Фаза 1.1.3 — MVP редактор библиотеки элементов)
- **elements/** (новый модуль, 3 файла ~400 строк):
  - `index.html` — разметка: toolbar (фильтры + кнопки) + stats + список + модалка
  - `elements.css` — стили: карточки, бэйджи (builtin/user/imported), модалка
  - `elements-editor.js` — логика:
    - `render()`: группировка по kind, бэйджи источника, row actions
    - Фильтры: kind, source, свободный поиск (label/manufacturer/series/variant/id)
    - View: read-only JSON для inspection
    - Edit: простые поля + JSON textarea для электрики/геометрии/kindProps/composition
    - Create: prompt ID + пустая форма
    - Clone: работает для builtin тоже — создаёт user-копию
    - Delete: только user
    - Import/Export JSON (режимы merge/replace)
    - `initCatalogBridge()` вызывается — видны все legacy-каталоги как builtin
    - Reactive через `onLibraryChange`
- **modules.json** — добавлена запись для «elements» с requires: element-library + element-schemas + catalog-bridge
- **hub.html** — новая карточка в сетке (между reports и transformer-config), 4-клеточная icon
- **НЕ включено (отложено до Фазы 2):**
  - Загрузка SVG для views (schematic/layout/3d)
  - Визуальный редактор портов (координаты, kind)
  - Drag-n-drop composition builder
- **Ценность:**
  - Пользователь видит всё оборудование платформы в одном месте
  - Можно клонировать builtin (например, ИБП из Kehua данных) и подредактировать
  - Экспорт/импорт для backup или передачи между пользователями
- **Файлы:**
  - `elements/index.html` (новый, 65 строк)
  - `elements/elements.css` (новый, 165 строк)
  - `elements/elements-editor.js` (новый, 280 строк)
  - `modules.json` (+13 строк)
  - `hub.html` (+14 строк карточка)
  - `js/engine/constants.js` APP_VERSION = '0.44.0'

### v0.43.3 (2026-04-19, Фаза 1.4.4 — связь с Конфигуратором АКБ)
- **inspector/ups.js** — новая кнопка в модалке батарей ИБП:
  - `<a href="battery/?nodeId=X&loadKw=...&vdcMin=...&vdcMax=...&autonomyMin=...&selected=...">🔋 Подобрать АКБ в калькуляторе</a>`
  - Передаёт полный контекст узла (нагрузка, диапазон Vdc, целевая автономия, пред-выбор модели)
- **battery/battery-calc.js** — `initSchemaContext()`:
  - Переключает вкладку на «Расчёт разряда»
  - Предзаполнение полей: `calc-load`, `calc-target`, `calc-dcv` = (vdcMin+vdcMax)/2, `calc-battery`, `calc-mode` = 'required' (если задана autonomy)
  - Sticky-баннер с «Применить к схеме»
  - Извлекает `lastBatteryCalc.calcResult` с поддержкой двух режимов:
    - `kind='autonomy'`: strings из params, autonomyMin из r
    - `kind='required'`: strings/blocksPerString/autonomyMin из found
  - Вычисляет `totalKwh = strings × blocksPerString × capacityAh × blockVoltage / 1000`
  - Пишет payload в `localStorage['raschet.pendingBatterySelection.v1']`
- **js/engine/index.js** — `_tryConsumePendingBatterySelection()`:
  - Симметрично UPS-ресиверу: валидация TTL 5 мин, `node.type === 'ups'`
  - Обновляет `batteryCatalogId / batteryStringCount / batteryBlocksPerString / batteryAutonomyMin / batteryKwh`
  - snapshot + render + renderInspector + notifyChange
- **Эффект:**
  - Полный цикл: ИБП в схеме → кликнул «Подобрать АКБ» → калькулятор с пред-заполненным расчётом → выбрал модель + автономию → клик «Применить» → ИБП обновлён в схеме (с АКБ + автономией)
  - BOM автоматически включает АКБ через `_syntheticUpsComposition` из Фазы 1.4.1
- **Файлы:**
  - `js/engine/inspector/ups.js` (+14 строк кнопка с query params)
  - `battery/battery-calc.js` (+85 строк initSchemaContext + apply-handler)
  - `js/engine/index.js` (+42 строки ресивер)
  - `js/engine/constants.js` APP_VERSION = '0.43.3'

### v0.43.2 (2026-04-19, Фаза 1.4.2-1.4.3 — кнопка «Сконфигурировать подробно» + storage-канал)
- **inspector/ups.js** — новая ссылка-кнопка в верхней части модалки ИБП:
  - `<a href="ups-config/?nodeId=X&selected=Y&capacityKw=Z&upsType=W" target="_blank">`
  - Передаёт контекст узла через URLSearchParams
  - Заменяет прежние inline-ссылки в muted-подсказках
- **ups-config/ups-config.js** — интеграция с Конструктором схем:
  - Чтение `?nodeId=` → показ sticky-баннера сверху
  - Пред-выбор `?selected=` в каскадном пикере
  - Кнопка «Применить к схеме» → `localStorage['raschet.pendingUpsSelection.v1']` = `{ nodeId, ups, selectedAt }`
  - Авто-закрытие вкладки через 2 сек
  - «Отмена» — закрывает вкладку без записи
- **js/engine/index.js** — приёмник возврата:
  - `_tryConsumePendingUpsSelection()`: читает localStorage, валидирует node + ups + TTL 5 мин, вызывает `applyUpsModel(node, ups)` + snapshot + render + notifyChange
  - Триггеры: `focus` event, `storage` event, один раз на старте
  - TTL 5 минут защищает от «старых» применений если пользователь передумал
- **Эффект для пользователя:**
  - В инспекторе ИБП → клик «Сконфигурировать подробно» → открывается ups-config в новой вкладке с пред-выбором текущей модели
  - В ups-config видит баннер с кнопкой «Применить к схеме» → клик → вкладка закрывается
  - В Конструкторе автоматически применяется модель (все паспортные параметры + upsCatalogId) → BOM включает ИБП + АКБ
- **Файлы:**
  - `js/engine/inspector/ups.js` (+12 строк ссылка-кнопка, -3 строки inline links)
  - `ups-config/ups-config.js` (+42 строки context-banner и apply-handler)
  - `js/engine/index.js` (+40 строк storage-listener + applyUpsModel импорт)
  - `js/engine/constants.js` APP_VERSION = '0.43.2'

### v0.43.1 (2026-04-19, Фаза 1.4.1 — BOM резолвит legacy catalogId + АКБ ИБП)
- **shared/bom.js** расширено:
  - `_resolveLegacyElementId(node)` — порядок приоритета: elementId → upsCatalogId → panelCatalogId → enclosureId → transformerCatalogId. Backward-compat: узлы из старых проектов, выбравшие модель через `applyUpsModel`, теперь попадают в BOM через library
  - `_syntheticUpsComposition(node)` — если у ИБП заданы batteryCatalogId + batteryStringCount × batteryBlocksPerString → ссылка на АКБ как компонент. Количество = strings × blocks × count
  - `bomForNode(node)` усложнён: после развёртки основного элемента добавляется АКБ (с `role='battery'`, depth=1), если есть упоминание батареи в каталоге. Корень получает label `"<node.name> (<element.label>)"`
- **Эффект:**
  - Пользователь выбирает ИБП через существующий пикер в инспекторе → BOM автоматически содержит: ИБП + АКБ × N (с ролью «battery»)
  - Аналогично для panel (panelCatalogId → Element из element-library через bridge)
  - Для проектов без каталожных ссылок — прежнее поведение (placeholder по типу узла)
- **Файлы:**
  - `shared/bom.js` (+50 строк legacy resolver и UPS-battery synthesis)
  - `js/engine/constants.js` APP_VERSION = '0.43.1'

### v0.43.0 (2026-04-19, Фаза 1.3 — Phantom + BOM)
- **shared/bom.js** (новый, ~180 строк):
  - `expandComposition(el, mult, depth, seen, path)` — рекурсивное разворачивание `composition: [{elementId, qty, phantom, role}]` с защитой от циклов (per-branch seen), phantom-признак переносится с ref'а
  - `bomForNode(node)` — 3 стратегии: (1) node.elementId → library lookup + expand, (2) inline node.composition, (3) placeholder по node.type
  - `collectBomFromProject(state)` — обход state.nodes (зоны пропускаются), возвращает { flat, aggregated }
  - `aggregateBom(items)` — группировка по (elementId, role) или (label, kind), суммирование qty
  - `groupBomByKind(agg)` — под-группировка для отчёта
  - `bomToMarkdown(agg)` — markdown-таблица
- **js/engine/report-sections.js** — новая секция `sectionBom()`:
  - Зарегистрирована в `getReportSections()` как `id: 'bom'`, defaultTemplateId = builtin-bom-landscape
  - Таблица Группа / Наименование / Кол-во с под-заголовками по kind
  - Phantom-элементы помечены `*`
  - Человекочитаемые kind-labels (ИБП, Щиты, АКБ, Трансформаторы, Потребители, Кабельные трассы...)
- **js/engine/index.js** — экспонирование в window.Raschet:
  - `getBom()` → `{ flat, aggregated }`
  - `getBomMarkdown()` → markdown-таблица
- **Ценность для пользователя:**
  - Секция «Спецификация оборудования (BOM)» доступна в списке отчётов сразу
  - Даже без element-library интеграции (Фазы 1.4+) даёт плоский перечень узлов проекта по типам
  - Когда у ИБП появится composition (Фаза 1.4) — phantom-модули автоматически попадут в BOM
- **Файлы:**
  - `shared/bom.js` (новый, 180 строк)
  - `js/engine/report-sections.js` (+56 строк sectionBom, +8 строк регистрации)
  - `js/engine/index.js` (+2 метода API, +1 импорт)
  - `js/engine/constants.js` APP_VERSION = '0.43.0'

### v0.42.3 (2026-04-19, UX: категории потребителей + очистка conn-инспектора)
- **Категории потребителей:** `CONSUMER_CATEGORIES` (8 типов: lighting, socket, power, hvac, it, lowvoltage, process, other) в `js/engine/constants.js`
  - Каждая категория: label, icon, cableCategories (допустимые типы кабелей)
  - Все 10 базовых потребителей получили поле `category` (motor→power, conditioner→hvac, server→it и т.д.)
  - Добавлены 4 новых типа категории `lowvoltage`: fire-alarm, sks, cctv, access (слаботочные системы)
- **Двухуровневый select в `inspector/consumer.js`:** Категория → Тип
  - Пустые категории скрываются (кроме текущей)
  - Смена категории → перезаполнение типов + выбор первого
  - Миграция user-записей без `category` → `'other'`
- **`js/main.js` — каталог потребителей (модалка):**
  - Типы сгруппированы по категориям с иконками
  - Edit prompt позволяет менять категорию
  - Новые user-типы по умолчанию `category: 'other'`
- **Убран select «Вид соединения»** из `inspector/conn.js`:
  - На электрической принципиальной схеме все соединения — электрические
  - Поле `connectionKind` остаётся в данных (default 'electrical')
  - UI вернётся в Фазе 2 когда будут non-electrical страницы (layout, mechanical)
- **Файлы:**
  - `js/engine/constants.js` (+CONSUMER_CATEGORIES, +4 lowvoltage типа, +category в 10 существующих; APP_VERSION 0.42.3)
  - `js/engine/inspector/consumer.js` (import CONSUMER_CATEGORIES; двухуровневый select; обработчик смены категории)
  - `js/engine/inspector/conn.js` (-12 строк select «Вид соединения»)
  - `js/main.js` (модалка каталога с группировкой; edit с категорией; user_ default category='other')

### v0.42.2 (2026-04-19, Фаза 1.2.1 — same-tab sync listeners)
- **1.2.1** Same-tab реактивность каталогов:
  - `shared/panel-catalog.js`: `onPanelsChange(cb)` + `_notify()` после `_write`
  - `shared/ups-catalog.js`: `onUpsesChange(cb)` + `_notify()`
  - `battery/battery-catalog.js`: `onBatteriesChange(cb)` + `_notify()` в `save()`
  - `shared/transformer-catalog.js`: `onTransformersChange(cb)` + `_notify()`
  - `shared/cable-types-catalog.js`: `onCableTypesChange(cb)` + `_notify()`
- **shared/catalog-bridge.js** — подписка на все listener'ы:
  - `_subscribeSameTab()` async: пытается импортировать каждый каталог (6 paths с fallback для battery), подключает `onXChange(_scheduleSync)`, игнорирует модули которых нет
  - Debounce 50ms в `_scheduleSync()`: при import XLSX 100 записей — 1 re-sync вместо 100
- **Эффект:**
  - `addPanel({...})` в UI catalog-manager → `listElements({kind:'panel'})` сразу содержит новую запись
  - Работает для всех 5 типов без перезагрузки страницы
- **Файлы:**
  - `shared/panel-catalog.js` (+12 строк listener API)
  - `shared/ups-catalog.js` (+11 строк)
  - `battery/battery-catalog.js` (+11 строк)
  - `shared/transformer-catalog.js` (+11 строк)
  - `shared/cable-types-catalog.js` (+11 строк)
  - `shared/catalog-bridge.js` (+35 строк: _scheduleSync + _subscribeSameTab)
  - `js/engine/constants.js:9` APP_VERSION = '0.42.2'

### v0.42.1 (2026-04-19, Фаза 1.2.0 — catalog-bridge)
- **1.2.0** `shared/catalog-bridge.js` — мост legacy → element-library:
  - `syncLegacyToLibrary()`: Promise.all чтения 5 каталогов через dynamic import, конвертация через `from*Record`, регистрация как builtin
  - `initCatalogBridge()`: idempotent, первый sync + listener на `storage` event (cross-tab)
  - Lazy loading: `battery-catalog` пробует `./battery-catalog.js` и `../battery/battery-catalog.js`
  - Read-only: editing продолжается через legacy API (`addPanel`, `addUps`...) до 1.2.1-1.2.2
- **engine/index.js** — импорт и вызов `initCatalogBridge()` сразу после `onGlobalChange()` подписки
- **Эффект:** `listElements({kind:'panel'})` возвращает все panels из legacy; аналогично для ups/battery/transformer/cable-type
- **Файлы:**
  - `shared/catalog-bridge.js` (новый, 135 строк)
  - `js/engine/index.js:76-80` (импорт + вызов)
  - `js/engine/constants.js:9` (APP_VERSION = '0.42.1')

### v0.42.0 (2026-04-19, Фаза 1.1 — Element Library foundation)
- **1.1.1** `shared/element-library.js` (~290 строк): Element schema, 11 kinds, builtin/user двухуровневое хранилище, CRUD + export/import + listeners
- **1.1.2** `shared/element-schemas.js` (~400 строк): factory-функции для 9 kinds + legacy converters (from/to Record) для 5 типов
- **PLAN_ROADMAP.md**: создан для сохранения плана между сессиями
- **modules.json**: манифест 8 модулей

### v0.41.0 (2026-04-19, фаза 0 завершена)
Коммит: `cb202c8`
- **0.1** Единый GLOBAL: `engine/index.js` вызывает `loadGlobal()` на старте + `onGlobalChange()` sync. `engine.setGlobal()` вызывает `saveGlobal()`. `main.js`: убран прямой `localStorage.setItem(SETTINGS_KEY)`, `loadGlobalSettings()` → no-op
- **0.2** `VOLTAGE_CATEGORIES = {lv,mv,hv,dc}` в `constants.js`, `deriveVoltageCategory()`, авто-миграция всех базовых уровней
- **0.3** `CABLE_CATEGORIES` в constants.js, `shared/cable-types-catalog.js` с 16 базовыми типами (ВВГнг-LS, ВВГнг-FRLS, АВБбШв, ВВГ, АВВГ, ПВС, АПвПуг, ПвПу, КВВГ/КВВГнг-LS/FRLS, UTP, FTP, ТПП, ОКЛ, ПуГВ, Solar DC)
- **0.4** `CONNECTION_KINDS = {electrical,pipe,duct,data}` + select «Вид соединения» в `inspector/conn.js`
- **0.5** `modules.json` с описанием 8 модулей
- **0.6** `panel-catalog`: новые поля `material`, `maxHeatDissipationW`; `inputs/outputs/sections` помечены DEPRECATED; `catalog-xlsx-parser` поддерживает колонки Material, Max_Heat_W

### v0.40.x (предыдущая сессия)
- Per-mode loadFactor для потребителей + нормальный режим `normalLoadFactor`
- Блокировка удаления used voltage levels
- Множитель 0-3 для режимов (вместо emergencyOnly чекбокса)
- Phases возвращены в voltage levels (3ph/2ph/1ph select)
- Фазность потребителя не привязана к A/B/C (балансировка)
- Группа соединений обмоток трансформатора (Dyn11/Yyn0/...)
- Voltage level формат: `400/230 V 50 Hz` / `10 kV 50 Hz` / `48 V DC` / `±24 V DC`
- Справки по Ik/Uk% для utility и трансформатора
- УЗО (RCD) — секция в инспекторе связи, учёт в phaseLoop
- 10 независимых отчётов раздел «Отчёты» с PDF/DOCX экспортом
- Auto-tk по кривой автомата в short-circuit модуле
- MCB/MCCB auto-selection по номиналу
- cable/ — select фазности, убрана отдельная секция эконом. плотности
