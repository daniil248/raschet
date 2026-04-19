# Raschet — Roadmap архитектурного развития платформы

> **Статус:** Фаза 0 завершена (v0.41.0). В работе: Фаза 1.
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

#### Подфаза 1.1 — Element schema и ElementLibrary API (1 неделя)

- [ ] **1.1.1** Создать `shared/element-library.js`:
  - Схема `Element { id, kind, category, label, electrical, geometry, views, composition, source, tags, createdAt, updatedAt }`
  - API: `listElements({kind, category})`, `getElement(id)`, `saveElement(el)`, `removeElement(id)`, `cloneElement(id, newName)`
  - Per-user localStorage: `raschet.elementLibrary.v1.<uid>`
  - Builtin vs user (как panel-catalog)

- [ ] **1.1.2** Добавить схема-хелперы:
  - `shared/element-schemas.js` — validator'ы для каждого kind (panel/ups/battery/transformer/cable/consumer/channel)
  - `createElement(kind, patch)` — factory с дефолтами

- [ ] **1.1.3** Новый редактор `elements/index.html`:
  - Режим подготовки: CRUD элементов библиотеки
  - Загрузка SVG для views (schematic symbol, layout front/top)
  - Настройка портов (координаты, kind: electrical/pipe/data)
  - Составные элементы (composition: frame + modules)

#### Подфаза 1.2 — Миграция существующих каталогов (1 неделя)

- [ ] **1.2.1** `shared/panel-catalog.js`:
  - Внутри: листать `element-library` с `kind='panel'`
  - API остаётся (backward compat: `listPanels()`, `getPanel(id)`, `addPanel(rec)`)
  - Старые данные миграция при загрузке

- [ ] **1.2.2** То же для `ups-catalog.js`, `battery-catalog.js`, `transformer-catalog.js`, `cable-types-catalog.js`

- [ ] **1.2.3** `catalog-xlsx-parser.js`:
  - Единый `parseXlsx(buffer, {kind})` → возвращает массив `Element[]`
  - Унифицированные schemas для 5+ kind'ов

#### Подфаза 1.3 — Phantom элементы и BOM (1 неделя)

- [ ] **1.3.1** `element.composition: [{elementId, qty, phantom: bool}]`:
  - При добавлении фрейма ИБП — автоматически прописываются phantom модули в BOM
  - Рекурсивное разворачивание через `expandComposition(element)`

- [ ] **1.3.2** BOM-генератор `shared/bom.js`:
  - Сбор всех элементов проекта + их composition → дерево
  - Агрегация по SKU для спецификации

- [ ] **1.3.3** Интеграция с отчётами (`shared/report/` → новый блок `bom-table`)

#### Подфаза 1.4 — Конфигуратор ИБП из Конструктора схем (1 неделя)

- [ ] **1.4.1** В инспекторе узла «ИБП» — кнопка «Сконфигурировать подробно»
- [ ] **1.4.2** Открывает `ups-config/` в iframe/модалке с переданными параметрами
- [ ] **1.4.3** Результат (выбранный фрейм + модули + батарея) сохраняется в `node.elementId` и разворачивается в composition при генерации BOM
- [ ] **1.4.4** Связь с Конфигуратором АКБ: при выборе батареи — автообновление параметров автономии

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
