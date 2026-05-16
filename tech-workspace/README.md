# Технолог ЦОД (`tech-workspace/`)

Предпроектная стадия ЦОД: концепция объекта (стойки, IT-нагрузка, ИБП, климат, ввод ТП/ДГУ, PDU, площади), multi-variant compare, handoff в детальное проектирование. Два режима входа — список параметров или план зала.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `tech-workspace.js` — концепция объекта, варианты, сравнение, handoff, «План зала»
  - `tech-workspace.css` — стили
- **Расчётная часть (calc):** агрегирующие расчёты внутри `tech-workspace.js` (отдельный calc-слой не выделен)
- **UI/рендер:** `tech-workspace.js`
- **Данные/справочники:** LS-ключи `raschet.project.<pid>.tech-workspace.variants.v1`, `...activeVariantId.v1`, `raschet.cooling.prefill.v1`
- **Cross-module связи:** мост `scheme-rack-bridge`; PUSH контекста в дочерние конфигураторы (genset-config и др.) через URL; prefill для cooling
- **Куда добавлять новое:** новые параметры концепции/варианты и логику handoff — в `tech-workspace.js`
