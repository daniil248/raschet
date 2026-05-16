# Компоновщик шкафа (`scs-config/`)

Конфигуратор СКС / телеком-оборудования: описывает содержимое стойки (юниты, заглушки, PDU-раскладка), реестр шкафов проекта, инвентаризация.

- **Тип:** `ui`
- **Точка входа:** `index.html` (+ `rack.html` — компоновка стойки, `inventory.html` — инвентарь)
- **Главные файлы:**
  - `scs-config.js` — ядро: модель содержимого стойки, каталог типов оборудования
  - `racks-list.js` — реестр шкафов проекта (реальные стойки vs черновики)
  - `inventory.js` — инвентаризация оборудования
  - `changelog.js` — журнал изменений модуля
- **Расчётная часть (calc):** логика компоновки внутри `scs-config.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `scs-config.js`, `racks-list.js`, `inventory.js`, `rack.html`, `scs-config.css`
- **Данные/справочники:** шаблоны стоек `localStorage['rack-config.templates.v1']`; `localStorage['scs-config.catalog.v1']`; (нет manifest.json)
- **Cross-module связи:** читает шаблоны из `rack-config`; реестр шкафов проекта
- **Куда добавлять новое:** типы оборудования — в каталог `scs-config.catalog.v1`/`DEFAULT_CATALOG`; компоновку — в `scs-config.js`; реестр — в `racks-list.js`
