# Конфигуратор НКУ (LV щит) (`panel-config/`)

Низковольтное комплектное устройство до 1 кВ по IEC 61439 (TTA/PTTA): ВРУ, АВР, ЩС, ЩО, ЩК. Подбор оболочки, вводные/отходящие автоматы, секционирование, формы разделения 1-4.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `panel-config.js` — конфигуратор: оболочка, автоматы, секционирование, формы разделения
  - `panel-config.css` — стили
- **Расчётная часть (calc):** логика подбора внутри `panel-config.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `panel-config.js`
- **Данные/справочники:** `shared/panel-catalog`; LS-ключи `raschet.configurations.panel.v1`, `raschet.panelCatalog.v1`
- **Cross-module связи:** события `rs-selection-change`, `rs-cs-focus`; URL `project`, `nodeId`, `loadKw`
- **Куда добавлять новое:** оболочки/автоматы — через `shared/panel-catalog`; логику секционирования и экран — в `panel-config.js`
