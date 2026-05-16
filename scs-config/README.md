# Компоновщик шкафа (`scs-config/`)

Конфигуратор СКС / телеком-оборудования: описывает содержимое стойки (юниты, заглушки, PDU-раскладка), реестр шкафов проекта, инвентаризация.

- **Тип:** `ui`
- **Точка входа:** `index.html` (+ `rack.html` — компоновка стойки, `inventory.html` — инвентарь)
- **Главные файлы:**
  - `scs-config.js` — UI/рендер: модель содержимого стойки, каталог типов оборудования
  - `calc/rack-slots.js` — чистый расчётный слой (геометрия U-слотов, без DOM): `computeOccupiedU()`, `freeURanges()`, `findFirstFreeSlot()`, `canPlace()`, `findNearestFreeSlot()`
  - `racks-list.js` — реестр шкафов проекта (реальные стойки vs черновики)
  - `inventory.js` — инвентаризация оборудования
  - `changelog.js` — журнал изменений модуля
- **Расчётная часть (calc):** `calc/rack-slots.js` — чистые функции без DOM (catalog передаётся параметром; переиспользуемо: автопак, drag-drop, отчёты, тесты)
- **UI/рендер:** `scs-config.js`, `racks-list.js`, `inventory.js`, `rack.html`, `scs-config.css`
- **Данные/справочники:** шаблоны стоек `localStorage['rack-config.templates.v1']`; `localStorage['scs-config.catalog.v1']`; зарегистрирован в `modules.json` (manifest.json есть)
- **Cross-module связи:** читает шаблоны из `rack-config`; реестр шкафов проекта
- **Куда добавлять новое:** типы оборудования — в каталог `scs-config.catalog.v1`/`DEFAULT_CATALOG`; компоновку — в `scs-config.js`; реестр — в `racks-list.js`
