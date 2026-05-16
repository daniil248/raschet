# ДГУ-конфигуратор (`dgu-config/`)

Подбор дизель-генераторной установки по нагрузке с учётом режима (ESP/PRP/COP), резервирования, высоты над уровнем моря, температуры наружного воздуха и автономии.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `dgu-config.js` — UI-оркестратор (standalone-режим, PUSH из tech-workspace через URL params)
  - `calc/dgu-calc.js` — расчётное ядро подбора ДГУ
  - `dgu-config.css` — стили
- **Расчётная часть (calc):** `calc/dgu-calc.js` (чистая логика без DOM)
- **UI/рендер:** `dgu-config.js`
- **Данные/справочники:** `datasheets/index.js`
- **Cross-module связи:** приём контекста из tech-workspace через URL (`capacityKw`, `mode`, `redundancy`, `altitude`, `tamb`, `autonomy`, `vendor`)
- **Куда добавлять новое:** методику подбора/деретинга — в `calc/dgu-calc.js`; даташиты вендоров — в `datasheets/`; экран — в `dgu-config.js`
