# Drawio Electrical Stencils — зеркало

Полный набор электрических стенсилов из drawio (jgraph/drawio,
Apache 2.0 license), скачаны с
`github.com/jgraph/drawio/tree/dev/src/main/webapp/stencils/electrical`.

Назначение: использование как библиотека условных обозначений в модуле
`schematic/` (схема принципиальная) дополнительно к встроенному набору
IEC 60617-DB-12M.

Формат: drawio mxStencil XML (см. https://www.drawio.com/doc/faq/shape-complex-create-edit).
Каждый файл — это `<shapes>` с набором `<shape>`-узлов, каждый с
`<connections>` (точки подключения) и `<foreground>`/`<background>`
(SVG-подобный DSL: rect, line, path, ellipse, …).

## Файлы (24)

Категория              | Файл                            | Размер
-----------------------|---------------------------------|-------
Абстрактные            | abstract.xml                    | 19 KB
Конденсаторы           | capacitors.xml                  | 12 KB
Диоды                  | diodes.xml                      |  8 KB
Электромеханика        | electro-mechanical.xml          | 60 KB
IEC 417                | iec417.xml                      | 33 KB
IEC логические         | iec_logic_gates.xml             |  7 KB
Индуктивности          | inductors.xml                   | 45 KB
Инструменты            | instruments.xml                 |  5 KB
Логические             | logic_gates.xml                 | 25 KB
Прочее                 | miscellaneous.xml               | 62 KB
MOSFET (1)             | mosfets1.xml                    | 21 KB
MOSFET (2)             | mosfets2.xml                    | 15 KB
Операционные усилители | op_amps.xml                     | 11 KB
Опто-электроника       | opto_electronics.xml            | 21 KB
PLC ladder             | plc_ladder.xml                  |  4 KB
Силовые полупроводники | power_semiconductors.xml        | 19 KB
Радио                  | radio.xml                       |  8 KB
Резисторы              | resistors.xml                   | 20 KB
Вращающиеся машины     | rot_mech.xml                    | 11 KB
Источники сигналов     | signal_sources.xml              | 14 KB
Термоэлектроника       | thermionic_devices.xml          |  8 KB
Транзисторы            | transistors.xml                 | 29 KB
Передающие линии       | transmission.xml                | 12 KB
Формы сигналов         | waveforms.xml                   |  8 KB

Итого ~570 KB сжатого XML, сотни условных обозначений.

## Лицензия

Apache 2.0 (как и весь jgraph/drawio). Сохранены полные исходники без
изменений; для модификации нужно сохранять Notice/copyright headers.

## Обновление

Для обновления — переcкачать те же файлы:

```bash
cd schematic/drawio-stencils
for f in abstract capacitors diodes electro-mechanical iec417 \
         iec_logic_gates inductors instruments logic_gates miscellaneous \
         mosfets1 mosfets2 op_amps opto_electronics plc_ladder \
         power_semiconductors radio resistors rot_mech signal_sources \
         thermionic_devices transistors transmission waveforms; do
  curl -sf "https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/stencils/electrical/$f.xml" -o "$f.xml"
done
```

## Интеграция (TODO)

Файлы лежат как зеркало для будущей интеграции в `schematic/`:

1. Парсер mxStencil XML → SVG-draw functions (типа existing `iec60617-symbols.js`).
2. UI вкладка «drawio» в палитре символов рядом с «IEC 60617».
3. Автозагрузка при старте схемы (cache в LS).

Источник: https://github.com/jgraph/drawio/tree/dev/src/main/webapp/stencils/electrical
