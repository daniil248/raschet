# Схема принципиальная (`schematic/`)

Редактор принципиальных электрических схем и рабочей документации. Библиотека IEC 60617-DB-12M, листы ISO 216 (A4…A0), основная надпись по ISO 7200.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `schematic.js` — редактор схем (холст, размещение, соединения)
  - `iec60617-symbols.js` — библиотека символов IEC 60617
  - `iso-paper.js` — форматы листов ISO 216 + основная надпись ISO 7200
  - `schematic.css` — стили
- **Расчётная часть (calc):** —
- **UI/рендер:** `schematic.js`, `schematic.css`
- **Данные/справочники:** `iec60617-symbols.js`; стенсилы drawio в `drawio-stencils/` (см. локальный `drawio-stencils/README.md`)
- **Cross-module связи:** `shared/app-header`; URL-параметр `project`
- **Куда добавлять новое:** новые символы — в `iec60617-symbols.js`; форматы листов — в `iso-paper.js`; логику редактора — в `schematic.js`
