# Скетч (drawio) (`sketch/`)

ВРЕМЕННО ОТКЛЁН (v0.60.179). Полнофункциональный drawio (jgraph/drawio, Apache 2.0), интегрирован через embed iframe + postMessage. Multi-page, undo/redo, экспорт SVG/PNG/XML, связи с данными других модулей Raschet.

- **Тип:** `ui`
- **Точка входа:** `index.html` (модуль `enabled: false` в manifest)
- **Главные файлы:**
  - `sketch.js` — интеграция drawio (embed iframe, postMessage-протокол)
  - `sketch-refs-ui.js` — sidebar «🔗 Связи» с данными модулей (стойки, схемы, НКУ, ИБП, РУ-СН, трансформаторы, кабели)
  - `update-drawio.sh` + `UPDATE-DRAWIO.md` — обновление self-hosted drawio из GitHub release
- **Расчётная часть (calc):** —
- **UI/рендер:** `sketch.js`, `sketch-refs-ui.js`, `sketch.css`
- **Данные/справочники:** self-hosted drawio или fallback на embed.diagrams.net
- **Cross-module связи:** sidebar «Связи» — метки-ссылки на объекты других модулей в холсте drawio
- **Куда добавлять новое:** обновление drawio — `bash sketch/update-drawio.sh`; новые типы связей — в `sketch-refs-ui.js`
