# Шаблоны отчётов (`reports/`)

Подготовка и хранение шаблонов оформления отчётов: страница, поля, логотип, колонтитулы, стили заголовков. Используются подпрограммами для экспорта в PDF и DOCX. Внутрикорпоративный модуль.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `reports.js` — экран редактора шаблонов отчётов
  - `templates-seed.js` — встроенные сиды шаблонов
  - `help.js` — встроенная справка модуля
  - `reports.css` — стили
- **Расчётная часть (calc):** —
- **UI/рендер:** `reports.js`, `help.js`
- **Данные/справочники:** `shared/report`, `shared/report-catalog`; `templates-seed.js`; LS-ключ `raschet.reportCatalog.builtinVersion`
- **Cross-module связи:** подпрограммы формируют `blocks[]` (через `shared/report/blocks.js`), модуль `reports/` рендерит и экспортирует PDF/DOCX
- **Куда добавлять новое:** новые шаблоны — в `templates-seed.js` / `shared/report-catalog`; редактор — в `reports.js`
