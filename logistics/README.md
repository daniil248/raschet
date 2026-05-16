# Рабочее место логиста (`logistics/`)

Отправления, склады, тарифы перевозчиков, калькулятор доставки. Интеграция с контрагентами и BOM проекта. Внутрикорпоративный модуль.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `logistics.js` — экран логиста: отправления, склады, тарифы, калькулятор доставки
  - `logistics.css` — стили
- **Расчётная часть (calc):** расчёт доставки внутри `logistics.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `logistics.js`
- **Данные/справочники:** `shared/logistics-schemas`, `shared/counterparty-catalog`; коллекции `shipments`, `warehouses`, `carrier-rates`
- **Cross-module связи:** handoff `raschet.logistics.handoff` (BOM проекта); URL-параметр `project`
- **Куда добавлять новое:** новые сущности/тарифы — через `shared/logistics-schemas`; экраны — в `logistics.js`
