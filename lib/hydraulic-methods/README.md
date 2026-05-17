# lib/hydraulic-methods — методики гидравлического расчёта (calc-lib)

`kind:'calc-lib'`, без UI/DOM. Первый per-discipline движок X.4.1
(дисциплина `hydraulic`, 47.4.1). Контракт — как `suppression-methods`.

## Файлы
- `formulas.js` — примитивы SI: ρ(t)/ν(t)/Pv(t) воды, Re, коэф. трения
  (Свами–Джейн / Colebrook–White), Дарси–Вейсбах, местные потери,
  напор↔давление, таблица шероховатостей `ROUGHNESS`.
- Потери напора — ОБОСОБЛЕНЫ ПО МЕТОДИКЕ/НОРМЕ (D4/D5, picker =
  METHOD_LIST; отключаемые/версионируемые файлы):
  - `darcy-weisbach.js` — универсальный Дарси–Вейсбах (+Swamee–Jain,
    местные + геодезия, i/100м).
  - `head-loss-sprk.js` — КЗ: СН РК 4.01-02 / СП РК 4.01-101 (своя
    META, переиспускает ядро Дарси).
  - `head-loss-hazen-williams.js` — эмпирич. Хазен–Вильямс (вода).
  - `head-loss-manning.js` — Шези–Маннинг (R=D/4, полное сечение).
- `npsh.js` — `{META,compute}`: NPSHa, проверка против NPSHr+запас.
- `index.js` — реестр `METHODS`/`METHOD_LIST`/`run(id,input)` +
  re-export `formulas`, `DISCIPLINE='hydraulic'`.

## Использование
```js
import { run } from 'hydraulic-methods/index.js';   // через importmap-ключ
const r = run('darcy-weisbach', { Q: 36, D_mm: 100, L: 120,
  material: 'steel_used', sumK: 8, tC: 20, dz: 5 });
// r.v, r.Re, r.f, r.hf_total, r.dP_kPa, r.steps[]
```

## Контракт метода
`export const META = { id, label, discipline, refs[] }`
`export function compute(input) → { method, inputs, ...результаты, steps[] }`
Чистые функции: без DOM, без LS, детерминированы — тестируемы и
переиспользуемы (UI-модуль, cross-discipline отчёт X.4.2/X.4.4).

## Регистрация
`manifest.json` (`kind:'calc-lib'`) + запись в корневом `modules.json`
+ `REGISTRY_ORDER` в `tools/gen-modules-json.mjs`. UI-карточки/
subscription-check НЕ требуются (auto-included).

## Расширение (X.4.1 далее)
По этому же шаблону — `lib/hvac-methods` (воздухообмен/теплоприток),
`lib/gas-methods` (давление/потери газопровода).
