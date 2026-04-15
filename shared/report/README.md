# Модуль `shared/report/` — формирование отчётов

Общая библиотека для всех подпрограмм Raschet. Сама по себе не
запускается как страница — подключается через ES-импорт из cable/,
battery/, ups-config/, panel-config/, transformer-config/ и т.д.

Пользовательский интерфейс для подготовки и хранения шаблонов —
отдельная подпрограмма [`reports/`](../../reports/), которая построена
поверх этого модуля.

---

## Что делает модуль

1. **Шаблон оформления** — чистый JSON-объект с настройками листа,
   полей печати, логотипа, свободных зон (overlays), стилей заголовков
   и таблиц. Шаблон не хранит данные расчёта.

2. **Canvas-редактор** — модальное окно, где пользователь перетаскивает
   зоны (логотип, заголовок, информацию о компании, адресата, дату,
   номер страницы, произвольный текст) на изображении страницы.
   Все зоны ограничены полями печати.

3. **Превью в HTML** — рендерит шаблон как серию абсолютно-позиционированных
   страниц с направляющими полей и границами зон. Используется и
   редактором, и страницей каталога.

4. **Экспорт в PDF** — через jsPDF (загружается с CDN при первом вызове).
   Сохраняет положение всех зон с точностью до миллиметра.

5. **Экспорт в DOCX** — через docx.js (CDN, ленивая загрузка). Свободные
   зоны приближённо конвертируются в header/footer секции Word (с
   потерей точных координат — документированное ограничение).

---

## Архитектура

| Файл | Назначение |
|---|---|
| [`index.js`](index.js) | Публичный API — единственное, что импортируют подпрограммы |
| [`template.js`](template.js) | Структура шаблона, значения по умолчанию, хелперы `pageSizeMm / contentBox / overlaysForPage / substitute`, автомиграция legacy-колонтитулов |
| [`blocks.js`](blocks.js) | Конструкторы блоков содержимого: `h1/h2/h3 / paragraph / list / orderedList / table / image / spacer / hr / pageBreak / caption / custom` |
| [`preview.js`](preview.js) | HTML-рендер шаблона + пагинация потокового содержимого + рендер overlays |
| [`editor.js`](editor.js) | Canvas-редактор шаблона с перетаскиванием зон, resize, клавиатурными сокращениями |
| [`editor.css`](editor.css) | Стили редактора, HTML-превью и picker |
| [`picker.js`](picker.js) | Модальное окно выбора шаблона из каталога (для подпрограмм) |
| [`export-pdf.js`](export-pdf.js) | Экспорт в PDF |
| [`export-docx.js`](export-docx.js) | Экспорт в DOCX |
| [`demo.html`](demo.html) | Самодостаточная демо-страница модуля |

## Клавиатурные сокращения в canvas-редакторе

| Клавиша | Действие |
|---|---|
| `Delete` / `Backspace` | Удалить выбранную зону (или логотип) |
| `←` `→` `↑` `↓` | Сдвиг выбранной зоны на 1 мм с клэмпом по полям печати |
| `Shift` + стрелки | Сдвиг на 10 мм |
| `Ctrl/⌘ + D` | Дублировать выбранную зону со сдвигом 4 мм |
| `Ctrl/⌘ + S` | Сохранить и закрыть редактор |
| `Escape` (1-й раз) | Снять выделение |
| `Escape` (2-й раз) | Закрыть редактор (как «Отмена») |

Навигация/удаление (стрелки, Delete, одиночный Escape) работают только когда фокус **вне** текстовых полей — чтобы не мешать вводу в textarea и input. В текстовых полях `Escape` вызывает `blur()` вместо закрытия редактора. `Ctrl+S` и `Ctrl+D` обрабатываются всегда, чтобы гарантированно перехватить браузерное действие.

### Снап к сетке и автоподгонка

- **Drag / resize** автоматически привязывают координаты зон к сетке 5 мм. Удержание **Alt** во время перетаскивания временно отключает снап (нужно для точного позиционирования).
- При изменении формата листа, ориентации или полей печати все зоны **автоматически подгоняются** внутрь новой печатной области (`fitAllZonesToPage`). Зоны шире/выше новой области пропорционально уменьшаются, положение клэмпается по новым границам. Это работает и для overlay-зон, и для логотипа.

---

## Установка в подпрограмму (минимум)

```js
import * as Report from '../shared/report/index.js';
import * as B      from '../shared/report/blocks.js';

// 1. Получить шаблон оформления (например, выбранный пользователем
//    из справочника shared/report-catalog.js)
const tpl = Report.createTemplate(chosenTemplate.template);

// 2. Наполнить содержимым из данных подпрограммы
tpl.content = [
  B.h1('Отчёт о расчёте линии ' + line.name),
  B.paragraph('Исходные данные и результаты.'),
  B.h2('1. Параметры'),
  B.table(
    [{text:'Параметр',width:75},{text:'Значение',align:'right',width:35},{text:'Ед.',align:'center',width:20}],
    [
      ['Ток',     String(line.I),       'А'],
      ['Длина',   String(line.lengthM), 'м'],
      ['Сечение', String(result.sMm2),  'мм²'],
    ],
  ),
  B.h2('2. Заключение'),
  B.paragraph(result.verdict),
];

// 3. Экспортировать
await Report.exportPDF(tpl,  line.name + '.pdf');
await Report.exportDOCX(tpl, line.name + '.docx');
```

---

## Установка с пользовательским выбором шаблона

Для выбора шаблона из каталога используйте встроенный picker — не
пишите свой UI. Он отфильтровывает шаблоны по тегам, даёт ссылку на
/reports/ и обрабатывает отмену.

```js
import * as Report from '../shared/report/index.js';
import * as B      from '../shared/report/blocks.js';

async function exportReport(line, result) {
  // 1. Открыть picker с фильтром по тегам. Пользователь увидит только
  //    подходящие шаблоны (встроенные и свои).
  const rec = await Report.pickTemplate({
    title: 'Выбор шаблона для отчёта по расчёту линии',
    tags:  ['кабель','расчёты','общее','инженерный'],
  });
  if (!rec) return;   // отмена

  // 2. Клонировать шаблон (автомиграция legacy → overlays выполняется
  //    автоматически внутри createTemplate).
  const tpl = Report.createTemplate(rec.template);

  // 3. Передать метаданные подпрограммы — они подставятся в зоны
  //    через плейсхолдеры {{meta.title}}, {{meta.author}}, ...
  tpl.meta.title  = 'Расчёт линии ' + line.name;
  tpl.meta.author = currentUser.displayName;

  // 4. Собрать содержимое — подпрограмма отвечает только за эти блоки
  tpl.content = buildContentBlocks(line, result);

  // 5. Экспорт
  await Report.exportPDF(tpl, tpl.meta.title);
}
```

Дать пользователю также открыть canvas-редактор прямо из подпрограммы:

```js
import * as Catalog from '../shared/report-catalog.js';

Report.openTemplateEditor(rec.template, {
  onSave(updated) {
    // сохранить правки обратно в каталог
    Catalog.saveTemplate({ ...rec, template: updated });
  },
});
```

## Подпрограммы, уже использующие модуль

| Подпрограмма | Файлы интеграции | Теги picker'а |
|---|---|---|
| [`cable/`](../../cable/) — Расчёт кабельной линии | [cable-calc.js:481-640](../../cable/cable-calc.js) | `['кабель','расчёты','общее','инженерный']` |
| [`battery/`](../../battery/) — Расчёт АКБ       | [battery-calc.js:exportBatteryReport](../../battery/battery-calc.js) | `['акб','батарея','расчёты','общее','инженерный']` |

Референс-паттерн интеграции — 3 шага на любой подпрограмме:

1. `import * as Report from '../shared/report/index.js'` + `import * as B from '../shared/report/blocks.js'`
2. Переменная `lastCalc` хранит состояние последнего расчёта; в обработчике «Рассчитать» она записывается, кнопка «📄 Отчёт» разблокируется
3. Функция `exportReport()` вызывает `Report.pickTemplate` → `createTemplate` → формирует `tpl.content` через `B.*` → `Report.exportPDF`

---

## Публичный API

### Работа с шаблоном

```js
Report.createTemplate(patch)          // глубокая копия defaultTemplate + patch
Report.defaultTemplate()              // пустой валидный шаблон
Report.pageSizeMm(tpl.page)           // {width, height} в мм с учётом orientation
Report.contentBox(tpl, isFirstPage)   // {x, y, width, height} области потокового content
Report.overlaysForPage(tpl, isFirst)  // overlay-зоны для страницы
Report.substitute(text, tpl, ctx)     // подстановка {{meta.*}}, {{page}}, ...
```

### Блоки содержимого

```js
import * as B from '../shared/report/blocks.js';

B.h1(text), B.h2(text), B.h3(text)
B.paragraph(text, { align, style })
B.caption(text)
B.list(items)                           // маркированный
B.orderedList(items)                    // нумерованный
B.table(columns, rows)                  // columns: string[] или {text,width,align}[]
B.image({ src, width, height, align })
B.spacer(heightMm)
B.hr({ color, thickness })
B.pageBreak()
B.custom(renderFn)                      // свой рендер для PDF и HTML
```

### Рендер и экспорт

```js
Report.renderPreview(tpl, container, { mode: 'edit'|'final' })
Report.openTemplateEditor(tpl, { onSave, onCancel })
await Report.exportPDF(tpl, filename)   // async — грузит jsPDF с CDN
await Report.exportDOCX(tpl, filename)  // async — грузит docx.js с CDN
```

---

## Структура шаблона

```js
{
  meta: {
    title, author, subject,
    custom: { /* свои поля для плейсхолдеров {{meta.foo}} */ }
  },

  page: {
    format:      'A4',                  // или 'A3'|'A5'|'Letter'|'Legal'|'Custom'
    width, height,                      // для 'Custom'
    orientation: 'portrait',            // или 'landscape'
    margins:     { top, right, bottom, left }   // в мм
  },

  logo: {
    src,                                // data URL или null
    position:        'header-left',     // legacy, используется если x/y не заданы
    x, y,                               // абсолютные координаты в мм (из canvas-редактора)
    width, height,                      // в мм
    onFirstPageOnly: false,
  },

  header: {                             // legacy поток-блоки колонтитулов
    firstPage:  { enabled, height, blocks: [] },
    otherPages: { enabled, height, blocks: [] },
  },
  footer: { firstPage: {...}, otherPages: {...} },

  styles: {                             // см. defaultTemplate()
    body, h1, h2, h3, caption, list, table
  },

  content: [],                          // основной поток — заполняет подпрограмма

  overlays: [                           // свободно-позиционируемые зоны
    {
      id:      string,
      type:    'text',
      scope:   'all' | 'first' | 'other',
      x, y, width, height,              // в мм, внутри поля печати
      content: {
        text:     string,               // с поддержкой {{...}}
        styleRef: 'body'|'h1'|'h2'|'h3'|'caption',
        align:    'left'|'center'|'right',
      },
    },
    ...
  ],
}
```

---

## Плейсхолдеры

Работают в тексте любого блока и любой overlay-зоны. Подставляются
движком `substitute()` при рендере и при экспорте:

| Плейсхолдер | Значение |
|---|---|
| `{{meta.title}}`   | `tpl.meta.title` |
| `{{meta.author}}`  | `tpl.meta.author` |
| `{{meta.subject}}` | `tpl.meta.subject` |
| `{{meta.<key>}}`   | любое поле из `tpl.meta.custom[<key>]` |
| `{{page}}`         | номер текущей страницы |
| `{{pages}}`        | общее число страниц |
| `{{date}}`         | текущая дата в локали `ru-RU` |

---

## Ограничения

1. **Шрифты** — модуль поддерживает только встроенные PDF-семейства:
   `Helvetica`, `Times`, `Courier`. Для произвольных шрифтов нужно
   подключать пользовательские через jsPDF `addFileToVFS` / `addFont` —
   это пока не реализовано.

2. **DOCX и абсолютные координаты** — Word не умеет свободно
   позиционировать текст так же, как PDF. Overlay-зоны в DOCX
   конвертируются в header / footer секции (верхние → header, нижние →
   footer). Точные координаты при этом теряются.

3. **Пагинация** — грубая оценка высоты блоков по формуле
   (символы × pt). Для большинства инженерных отчётов с короткими
   абзацами работает корректно. Для длинных потоковых текстов с
   сложным wrap могут быть расхождения на 1-2 строки.

4. **Кириллица в jsPDF** — встроенные шрифты jsPDF содержат Latin-1 +
   кириллицу частично. Для надёжной кириллической вёрстки используйте
   `Helvetica` (наиболее полный) и избегайте редких символов.

---

## Как добавить встроенный шаблон

Встроенные шаблоны хранятся в [`../../reports/templates-seed.js`](../../reports/templates-seed.js).

1. Добавить запись в `BUILTIN_TEMPLATES` со стабильным `id`
2. Прописать `getDemoContent(id)` с персональным демо-контентом
3. Увеличить `BUILTIN_VERSION` — пересеивание произойдёт при следующей
   загрузке страницы reports/ у всех пользователей (их пользовательские
   шаблоны при этом не затрагиваются)

## Отладка

- [`demo.html`](demo.html) — самодостаточная страница для проверки API
  без запуска полноценной подпрограммы
- Открывается через dev-сервер как `/shared/report/demo.html`
