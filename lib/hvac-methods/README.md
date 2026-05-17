# lib/hvac-methods — методики ОВиК-расчёта (calc-lib)

`kind:'calc-lib'`, без UI/DOM. Второй per-discipline движок X.4.1
(дисциплина `hvac`, 47.4.1). Контракт — как `suppression-methods` /
`hydraulic-methods`.

## Файлы
- `formulas.js` — примитивы SI: ρ(t,P) воздуха, es(t)/w(t,φ,P),
  cp влажного воздуха, hfg(t), энтальпия, расход↔кратность,
  расход по явной теплоте, трансмиссия U·A·ΔT, таблицы
  `PERSON_HEAT` / `FRESH_AIR_PER_PERSON`.
- Воздухообмен — ОБОСОБЛЕН ПО НОРМЕ (D4/D5, picker = METHOD_LIST;
  отключаемые/версионируемые файлы):
  - `air-balance.js` — INT: СП 60.13330 / ASHRAE 62.1 (макс из
    кратности / отвода явной теплоты / сан. нормы).
  - `air-balance-sprk.js` — КЗ: СН РК 4.02-01 / СП РК 4.02-101
    (своя META, переиспользует ядро РФ).
- `heat-gain.js` — `{META,compute}`: теплопритоки (трансмиссия +
  солнце через остекление + люди + освещение + оборудование) +
  потребный расход.
- `index.js` — реестр `METHODS`/`METHOD_LIST`/`run(id,input)` +
  re-export `formulas`, `DISCIPLINE='hvac'`.

## Использование
```js
import { run } from 'hvac-methods/index.js';   // через importmap-ключ
const r = run('air-balance', { V_room: 120, ach: 2, Q_sens: 3000,
  t_supply: 18, t_room: 24, persons: 8 });
// r.flow_required_m3h, r.driver, r.steps[]
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
По этому же шаблону — `lib/gas-methods` (давление/потери газопровода).
