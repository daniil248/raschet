# Сервис: монтаж и ТО (`service/`)

Расчёт стоимости технического обслуживания и монтажных работ: формирование себестоимости и цены для клиента по нарядам (проектным или разовым), генерация КП.

- **Тип:** `ui`
- **Точка входа:** `index.html`
- **Главные файлы:**
  - `service.js` — оркестратор (3 режима: standalone/project/embed), sidebar нарядов
  - `calc/order-model.js`, `calc/order-builder.js` — модель и сборка наряда
  - `calc/export-offer.js` — выгрузка КП
  - `report/kp-template.js`, `report/kp-editor.js` — шаблон и редактор КП
- **Расчётная часть (calc):** `calc/*` — модель наряда, билдер, экспорт (без DOM)
- **UI/рендер:** `ui/*` (order-form, order-wizard, materials-catalog, work-catalog, wizard-catalog), `service.css`
- **Данные/справочники:** `catalog/work-templates.js`, `catalog/materials.js`, `catalog/wizards/`
- **Cross-module связи:** импорт позиций из любых инженерных модулей (sourceModule + sourceRef), повторный импорт = обновление; КП через `report/`
- **Куда добавлять новое:** методику расчёта — в `calc/`; справочники работ/материалов — в `catalog/`; экраны — в `ui/`
