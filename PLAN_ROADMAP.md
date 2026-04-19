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
