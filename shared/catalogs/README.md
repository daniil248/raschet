# shared/catalogs/

Справочные (seed) данные каталога, разбитые по типам элементов
(`kind` из `element-library`). Без CRUD, без storage — чистые массивы +
функции-маппинги в формат `Element`. CRUD-каталоги (panels, ups,
batteries, transformers, cable-types) остаются в `shared/` рядом, так как
они содержат собственный localStorage-слой.

## Структура

| Файл                       | kind            | Что содержит                                |
|----------------------------|-----------------|---------------------------------------------|
| `racks.js`                 | `rack`          | KIT_CATALOG + label-таблицы (двери/крыша/…)  |
| `pdus.js`                  | `pdu`           | PDU_CATEGORY + PDU_CATALOG                   |
| `rack-accessories.js`      | `rack-accessory`| ACC_CATEGORIES + ACCESSORY_CATALOG           |
| `breakers.js`              | `breaker`       | BREAKER_SEED (MCB/MCCB/ACB/VCB/fuse)         |
| `ups-kehua-mr33.js`        | `ups`           | KEHUA_MR33_UPSES (линейка моделей)           |
| `battery-kehua-s3.js`      | `battery`       | KEHUA_S3_BATTERIES                           |
| `_helpers.js`              | —               | Внутренние _syncList / _slug / _ensureLib    |

## Правила

1. **Добавление новой модели** — в профильный файл, не трогая соседей.
2. **Новый kind** — новый файл `<kind>.js` + регистрация в
   `shared/catalog-bridge.js::syncLegacyToLibrary()`. Ключ хелперов
   импортируем из `./_helpers.js`.
3. **listBuiltin<Kind>()** возвращает массив Element'ов для bridge.
   **getLive<Kind>Catalog()** читает через `_syncList(kind)` — даёт
   actualized view c учётом override-правок catalog-admin.
4. **Обратная совместимость** — старый монолит
   `shared/rack-catalog-data.js` превращён в barrel, re-export
   преобразован к path'ам `./catalogs/...`. Все существующие импорты
   работают без правок. В новом коде импортируем из конкретного файла.
