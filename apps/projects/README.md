# Управление проектами (`projects/`)

Реестр проектов компании: создание / редактирование / удаление проектов и работа с карточкой проекта. Внутрикорпоративный модуль (project-manager / ГИП).

- **Тип:** `ui`
- **Точка входа:** `index.html` (реестр) + `project.html` (карточка проекта)
- **Главные файлы:**
  - `projects.js` — реестр проектов: список, создание/удаление, режим хранилища
  - `project.js` — карточка проекта (вкладки, свойства, экономика, handoff)
  - `projects.css` — стили
- **Расчётная часть (calc):** —
- **UI/рендер:** `projects.js`, `project.js`
- **Данные/справочники:** `shared/project-storage`; коллекция `projects`; LS-ключи `raschet.projects.v1`, `raschet.activeProjectId.v1`, `raschet.storageMode.v1`
- **Cross-module связи:** мосты `service-bridge`, `scheme-rack-bridge`, `inventory-bridge`; событие `raschet:storage-mode-changed`; URL `project`, `tab`
- **Куда добавлять новое:** реестр — в `projects.js`; вкладки карточки — в `project.js`; хранилище — через `shared/project-storage`
