# Обновление drawio

Модуль `sketch/` интегрирован с **официальным drawio** ([jgraph/drawio](https://github.com/jgraph/drawio), Apache 2.0). Используется встроенный JSON-protocol через iframe (`https://www.drawio.com/doc/faq/embed-mode`).

## Источник drawio

Sketch автоматически выбирает первый доступный из двух источников (см. `sketch/sketch.js::resolveDrawioSrc`):

1. **Self-hosted** в `sketch/drawio-app/index.html` — приоритетный источник.
2. **embed.diagrams.net** (fallback) — официальный hosted drawio от мейнтейнеров проекта jgraph. Авто-обновляется со стороны drawio.

## Как self-host'ить drawio (опционально)

Self-hosting нужен если:
- Хотите офлайн-режим (без интернета)
- Хотите фиксировать версию drawio (контроль обновлений)
- Хотите доменно-локальное хранение для compliance / GDPR

```bash
# Latest release
bash sketch/update-drawio.sh

# Конкретная версия
bash sketch/update-drawio.sh v24.7.17
```

Скрипт скачивает webapp из github tagged-релиза, кладёт в `sketch/drawio-app/`. После этого `sketch.js` автоматически подхватит self-hosted версию (HEAD-check на `./drawio-app/index.html`).

После обновления:
```bash
git add sketch/drawio-app
git commit -m "sketch: update drawio to vX.Y.Z"
```

## Размер

Webapp drawio ≈ 8-12 MB после распаковки. Всё статика (HTML/JS/CSS/SVG/PNG) — деплоится на GitHub Pages без проблем.

## Версия

`sketch/drawio-app/VERSION` содержит:
```
v24.7.17
Updated: 2026-05-04T12:34:56Z
Source: https://github.com/jgraph/drawio/releases/tag/v24.7.17
```

## Лицензия

drawio распространяется под **Apache License 2.0**. См. `sketch/drawio-app/LICENSE` после установки. Использование в Raschet (как embed) допустимо без изменений.

## Архитектура интеграции

```
sketch/index.html
  ↓ iframe src="./drawio-app/index.html?embed=1&proto=json&..."
        OR
  ↓ iframe src="https://embed.diagrams.net/?embed=1&proto=json&..."
        ↓
   drawio editor (jgraph/drawio)
        ↕ postMessage protocol (JSON)
        ↑
sketch/sketch.js
  ↕ LocalStorage:
       raschet.sketch.<pid>.<sketchId>.v2 — XML диаграмм
       raschet.sketch.<pid>.list.v1 — список sketches
```

## Сообщения протокола

drawio → app:
- `init` — drawio готов принимать данные
- `save` — пользователь нажал Save
- `autosave` — periodic auto-save (modified=unsavedChanges)
- `export` — ответ на export-request
- `exit` — embed-only, игнорируется

app → drawio:
- `load` — `{xml, autosave: 1}` загрузить диаграмму
- `export` — `{format: 'xmlsvg' | 'xmlpng' | 'xml'}` экспорт

См. `sketch.js::postToDrawio` и event-listener на `window.message`.
