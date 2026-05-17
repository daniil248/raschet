# АГПТ (газовое пожаротушение) (`suppression-config/`)

Конфигуратор автоматического газового пожаротушения: иерархическая модель Установка → (Сборка модулей | Направления → Зоны), аксонометрия и отчёт.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `suppression-config.js` — иерархическая модель установки, навигатор, сводка, аксонометрия
  - `changelog.js` — журнал изменений модуля
  - `suppression-config.css` — стили
- **Расчётная часть (calc):** методики расчёта — в библиотеке `suppression-methods/` (см. её README)
- **UI/рендер:** `suppression-config.js`
- **Данные/справочники:** `suppression-methods/agents.js`, `modules-catalog.js`, `sp-485-annex-d.js`; персистентность `localStorage['raschet.sup.installations.v1']`; (нет manifest.json)
- **Cross-module связи:** импортирует методики из `../suppression-methods/*`; нормативный документ авто-выбирается по стране проекта
- **Куда добавлять новое:** методики/нормы — в `suppression-methods/`; модель установки и экран — в `suppression-config.js`
