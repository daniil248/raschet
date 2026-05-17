# Конфигуратор РУ СН (`mv-config/`)

Распределительные устройства среднего напряжения 6-35 кВ: моноблоки SF6 (RM6, FafeRing) и сборные (ЩО-70). Справочник + wizard-подбор с конфигурированием ячеек.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `mv-config.js` — справочник + wizard-подбор, конфигурирование ячеек
  - `mv-config.css` — стили
- **Расчётная часть (calc):** логика подбора внутри `mv-config.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `mv-config.js`
- **Данные/справочники:** `shared/element-library`; LS-ключи `raschet.configurations.mv.v1`, `raschet.pendingMvSelection.v1`
- **Cross-module связи:** `shared/catalog-bridge`; события `rs-selection-change`, `rs-cs-focus`; URL `project`, `nodeId`
- **Куда добавлять новое:** новые серии РУ/типы ячеек — через `shared/element-library`; wizard и экран — в `mv-config.js`
