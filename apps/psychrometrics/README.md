# ID-диаграмма Молье-Рамзина (`psychrometrics/`)

Психрометрический калькулятор и редактор цикла точек с построением диаграммы Молье (i-d): процессы нагрева, охлаждения/осушения, адиабатического и парового увлажнения, расчёт мощности и влагосъёма.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `psychrometrics.js` — UI: редактор цикла точек/процессов + чарт Молье
  - `psychrometrics-core.js` — ядро формул (RH/W, Pws, энтальпия, точка росы, мощность процесса)
  - `psychrometrics-chart.js` — рендер диаграммы Молье
  - `psy-calculators.js` — частные калькуляторы
- **Расчётная часть (calc):** `psychrometrics-core.js` (чистые психрометрические формулы)
- **UI/рендер:** `psychrometrics.js`, `psychrometrics-chart.js`, `psy-calculators.js`, `psychrometrics.css`
- **Данные/справочники:** — (нет manifest.json; не зарегистрирован в modules.json)
- **Cross-module связи:** формулы переиспользуются в cooling (`calc/psychro-formulas.js`)
- **Куда добавлять новое:** новые формулы/процессы — в `psychrometrics-core.js`; визуализацию — в `psychrometrics-chart.js`
