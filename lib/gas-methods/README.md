# lib/gas-methods — методики газового расчёта (calc-lib)

`kind:'calc-lib'`, без UI/DOM. Третий per-discipline движок X.4.1
(дисциплина `gas`, 47.4.1). Контракт — как `suppression-methods` /
`hydraulic-methods` / `hvac-methods`.

## Файлы
- `formulas.js` — примитивы SI: плотность газа при н.у./рабочих
  условиях, Re, λ (Свами–Джейн / Colebrook–White), ΔP низкого
  давления (линейная), P1²−P2² среднего/высокого (изотермическое
  сжимаемое), `GAS_PROPS` (природный/метан/пропан/бутан/воздух),
  `ROUGHNESS`, `LOW_PRESSURE_LIMIT`.
- Потери давления — ОБОСОБЛЕНЫ ПО СТАНДАРТУ (D4, пользователь
  выбирает методику через picker = METHOD_LIST):
  - `pressure-drop.js` — РФ: СП 42-101-2003 / СП 62.13330 (Darcy
    низкое / изотерм. P1²−P2² среднее-высокое; id `gas-pressure-drop`
    сохранён для backward-compat).
  - `pressure-drop-sprk.js` — КЗ: СН РК 4.03-01 / СП РК 4.03-101
    (D5; своя META, переиспользует РФ-ядро).
  - `pressure-drop-renouard.js` — Renouard linéaire / quadratique.
  - `pressure-drop-weymouth.js` — Weymouth (λ=0.009407/D^⅓).
- `throughput.js` — `{META,compute}`: обратная задача — макс.
  расход при допустимом ΔP (итерация λ(Re) с фикс. точкой).
- `index.js` — реестр `METHODS`/`METHOD_LIST`/`run(id,input)` +
  re-export `formulas`, `DISCIPLINE='gas'`.

## Использование
```js
import { run } from 'gas-methods/index.js';   // через importmap-ключ
const r = run('gas-pressure-drop', { Q: 50, D_mm: 100, L: 200,
  P1_kPa: 3, gas: 'natural' });
// r.regime, r.dP_kPa, r.P2_kPa, r.v, r.Re, r.steps[]
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

## Статус X.4.1
Три per-discipline движка готовы: `hydraulic-methods`,
`hvac-methods`, `gas-methods`. Далее — UI-потребитель /
cross-discipline отчёт (X.4.2 / X.4.4).
