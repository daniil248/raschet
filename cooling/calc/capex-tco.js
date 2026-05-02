// =============================================================================
// cooling/cooling/calc/capex-tco.js — CAPEX / OPEX / TCO / NPV / payback
// =============================================================================
// Pure-функции экономической модели подбора холодильного оборудования.
// Используется для технико-экономического сравнения нескольких опций.
//
// Модель (упрощённый Total Cost of Ownership, TCO):
//   TCO_N лет = CAPEX  +  Σ_{t=1..N} (OPEX_energy_t + OPEX_maintenance_t) / (1+r)^t
//
// Где:
//   CAPEX = equipmentCost + installationCost  (валюта проекта, year 0)
//   OPEX_energy_t = annual_energy_kwh × tariff × (1 + escEnergy)^(t-1)
//   OPEX_maintenance_t = maintenanceRubPerYear × (1 + escMaint)^(t-1)
//   r = discount rate (доля, например 0.08 для 8%)
//   escEnergy / escMaint = годовая эскалация цены (доля)
//
// Источники методики:
//   • ISO 15686-5:2017 «Buildings and constructed assets — Service life
//     planning — Life-cycle costing»
//   • ASHRAE Handbook — Applications (2023) гл. 38 «Owning and Operating Costs»
//   • EN 15459-1:2017 «Energy performance of buildings — Economic evaluation»
//
// v0.60.21: ЕДИНАЯ ТАБЛИЦА СТАТЕЙ ЗАТРАТ (по требованию Пользователя 2026-05-02:
// «Одна строка в которой несколько колонок. Стоимость оборудования, стоимость
// монтажа, стоимость ТО (всё что нужно для корректного расчёта) количество…
// Для каждой цены, выбор валюты. Цена может быть в долларах, а монтаж в
// тенге… При этом все отдельные затраты в общей форме выводим по разделам»).
//
//   eco.costItems = [
//     {
//       id, label,                                   // строка статьи
//       qty,                                         // количество (×qty при сумме)
//       equipmentPrice:        {value, currency},    // цена/единица оборудования
//       installPrice:          {value, currency},    // цена/единица монтажа+ПНР
//       maintenancePerYearPrice: {value, currency},  // цена/ед. ТО за год
//     }, ...
//   ]
//
//   Σ Оборудование = Σ qty × equipmentPrice (с per-item currency-конверсией)
//   Σ Монтаж        = Σ qty × installPrice
//   Σ ТО/год        = Σ qty × maintenancePerYearPrice
//
// Backward-compat:
//   • Старые поля eco.equipmentCost / installationCost / maintenanceRubPerYear
//     (как {value, currency} или number) обрабатываются как ранее, если
//     costItems отсутствует.
//   • Старые eco.equipmentCost.items[] → авто-миграция в costItems[].
//
// NO DOM. Pure JS.

/**
 * Default-параметры экономической модели.
 */
export const DEFAULT_ECONOMICS = {
  currency: '₽',                                // дефолт-валюта новых полей
  costItems: [],                                // v0.60.21: единая таблица статей
  // legacy (поддерживаем чтение, но новые опции не пишут):
  equipmentCost:        { value: 0, currency: '₽' },
  installationCost:     { value: 0, currency: '₽' },
  maintenanceRubPerYear:{ value: 0, currency: '₽' },
  projectLifetimeYears: 20,
  discountRatePct: 8,
  escalationEnergyPct: 5,
  escalationMaintPct: 4,
};

/** Колонки таблицы costItems (для генерации UI и расчёта). */
export const COST_ITEM_COLUMNS = [
  { id: 'equipmentPrice',          label: 'Стоимость оборудования', section: 'capex',
    tip: 'Закупочная стоимость ОДНОЙ единицы оборудования (чиллер/CRAC/блок насосов и т.п.). Σ Оборудование = qty × value.' },
  { id: 'installPrice',            label: 'Стоимость монтажа+ПНР',  section: 'capex',
    tip: 'Стоимость монтажа + пусконаладки на ОДНУ единицу. Включает обвязку, электроподключение, шеф-монтаж. Σ Монтаж = qty × value.' },
  { id: 'maintenancePerYearPrice', label: 'Стоимость ТО за год',    section: 'opex',
    tip: 'Регламентное ТО на ОДНУ единицу за год: фильтры, чистка, заправка хладагента, выезд бригады. Σ ТО/год = qty × value.' },
];

/** Старые legacy money-поля (для миграции и backward-compat) */
export const MONEY_FIELDS = [
  { id: 'equipmentCost',         label: 'Оборудование',  section: 'capex' },
  { id: 'installationCost',      label: 'Монтаж/ПНР',    section: 'capex' },
  { id: 'maintenanceRubPerYear', label: 'ТО',            section: 'opex', perYear: true },
];

/**
 * Нормализовать денежное поле к {value, currency, items?}.
 */
export function normMoney(field, defaultCur = '₽') {
  if (field == null) return { value: 0, currency: defaultCur, items: [] };
  if (typeof field === 'number') return { value: field, currency: defaultCur, items: [] };
  if (typeof field === 'object') {
    const currency = field.currency || defaultCur;
    const items = Array.isArray(field.items) ? field.items.map(it => ({
      id: it.id || rid(),
      label: it.label || '',
      value: Number(it.value) || 0,
      currency: it.currency || currency,
    })) : [];
    let value;
    if (items.length) {
      value = items.reduce((s, it) => s + (it.value || 0), 0);
    } else {
      value = Number(field.value) || 0;
    }
    return { value, currency, items };
  }
  return { value: 0, currency: defaultCur, items: [] };
}

function rid() { return 'ci-' + Math.random().toString(36).slice(2, 8); }

/**
 * v0.60.21: Нормализовать costItems[] (новая модель). Возвращает массив
 * валидных строк с дефолтами для отсутствующих колонок.
 *
 * Также делает миграцию legacy: если costItems пуст, но в legacy money-полях
 * есть items[] — собирает их в одну таблицу (best-effort, по индексу).
 */
export function normCostItems(eco, defaultCur = '₽') {
  const e = eco || {};
  const cur = e.currency || defaultCur;
  if (Array.isArray(e.costItems) && e.costItems.length) {
    return e.costItems.map(it => normCostItemRow(it, cur));
  }
  // Migration from legacy: items[] разнесены по 3 полям → собрать по индексу
  const eq = normMoney(e.equipmentCost, cur);
  const inst = normMoney(e.installationCost, cur);
  const mnt = normMoney(e.maintenanceRubPerYear, cur);
  const maxLen = Math.max(eq.items.length, inst.items.length, mnt.items.length);
  if (maxLen > 0) {
    const out = [];
    for (let i = 0; i < maxLen; i++) {
      const eItem = eq.items[i];
      const iItem = inst.items[i];
      const mItem = mnt.items[i];
      out.push(normCostItemRow({
        id: rid(),
        label: (eItem?.label || iItem?.label || mItem?.label || `Позиция ${i + 1}`),
        qty: 1,
        equipmentPrice:          eItem ? { value: eItem.value, currency: eItem.currency } : { value: 0, currency: cur },
        installPrice:            iItem ? { value: iItem.value, currency: iItem.currency } : { value: 0, currency: cur },
        maintenancePerYearPrice: mItem ? { value: mItem.value, currency: mItem.currency } : { value: 0, currency: cur },
      }, cur));
    }
    return out;
  }
  // Если совсем пусто, но в legacy single-value что-то есть — одна строка-обёртка.
  if ((eq.value || 0) > 0 || (inst.value || 0) > 0 || (mnt.value || 0) > 0) {
    return [normCostItemRow({
      id: rid(),
      label: 'Базовая позиция (legacy)',
      qty: 1,
      equipmentPrice:          { value: eq.value || 0,   currency: eq.currency },
      installPrice:            { value: inst.value || 0, currency: inst.currency },
      maintenancePerYearPrice: { value: mnt.value || 0,  currency: mnt.currency },
    }, cur)];
  }
  return [];
}

function normCostItemRow(it, defaultCur) {
  const cur = defaultCur || '₽';
  return {
    id: it.id || rid(),
    label: String(it.label || ''),
    qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
    linkedGroupId: it.linkedGroupId || null,    // v0.60.23: привязка к equipment-группе
    equipmentPrice:          normPriceCell(it.equipmentPrice, cur),
    installPrice:            normPriceCell(it.installPrice, cur),
    maintenancePerYearPrice: normPriceCell(it.maintenancePerYearPrice, cur),
  };
}

/**
 * v0.60.23: Синхронизировать costItems с option.equipment — для каждой
 * группы оборудования создаём/обновляем «автостроку» (с linkedGroupId).
 * qty берётся из топологии (Σ qty по группе = N+M). Пользовательские строки
 * (без linkedGroupId) и их порядок сохраняются.
 *
 * По требованию Пользователя 2026-05-02: «думал количество основных железок
 * будет жёстко связано с количеством в опции, остальные позиции
 * пользовательские».
 *
 * @param {object} eco
 * @param {Array<object>} equipment — option.equipment[]
 * @param {string} defaultCur
 * @returns {Array<object>} обновлённый costItems[]
 */
export function syncCostItemsFromEquipment(eco, equipment, defaultCur = '₽') {
  const items = normCostItems(eco, defaultCur).map(it => ({ ...it }));
  const groups = Array.isArray(equipment) ? equipment.filter(eq => eq && eq.spec) : [];

  const autoByGroup = new Map();
  for (const it of items) {
    if (it.linkedGroupId) autoByGroup.set(it.linkedGroupId, it);
  }

  const updatedAuto = [];
  for (const grp of groups) {
    const qty = Number(grp.qty) || 1;
    const existing = autoByGroup.get(grp.id);
    if (existing) {
      existing.qty = qty;
      // Не перетираем label если пользователь его уже изменил — но синкаем имя из spec
      // только если label пуст или это default.
      const def = grp.spec.name || `Группа ${grp.id}`;
      if (!existing.label || existing.label === '' || existing.label.startsWith('Группа ')) {
        existing.label = def;
      }
      updatedAuto.push(existing);
    } else {
      updatedAuto.push(normCostItemRow({
        id: rid(),
        linkedGroupId: grp.id,
        label: grp.spec.name || `Группа ${grp.id}`,
        qty,
        equipmentPrice:          { value: 0, currency: defaultCur },
        installPrice:            { value: 0, currency: defaultCur },
        maintenancePerYearPrice: { value: 0, currency: defaultCur },
      }, defaultCur));
    }
  }

  // Пользовательские строки (без linkedGroupId) или строки, чья группа была удалена.
  const userRows = items.filter(it => !it.linkedGroupId || !groups.some(g => g.id === it.linkedGroupId));
  // Если у row был linkedGroupId, но группа удалилась — очищаем флаг (станет user-row).
  for (const r of userRows) if (r.linkedGroupId) r.linkedGroupId = null;

  return [...updatedAuto, ...userRows];
}

function normPriceCell(cell, defaultCur) {
  if (cell == null) return { value: 0, currency: defaultCur };
  if (typeof cell === 'number') return { value: cell, currency: defaultCur };
  return { value: Number(cell.value) || 0, currency: cell.currency || defaultCur };
}

/**
 * v0.60.21: Подсчитать суммы по разделам для costItems[] (без конвертации
 * между разными валютами — для отображения в native/displayCurrency используем
 * computeEcoTotals).
 */
export function sumCostItemsByCol(items) {
  const out = { equipment: 0, install: 0, maintenance: 0 };
  if (!items || !items.length) return out;
  for (const it of items) {
    const q = Number(it.qty) || 1;
    out.equipment   += q * (Number(it.equipmentPrice?.value)          || 0);
    out.install     += q * (Number(it.installPrice?.value)            || 0);
    out.maintenance += q * (Number(it.maintenancePerYearPrice?.value) || 0);
  }
  return out;
}

/**
 * v0.60.21: Главная функция получения системных тоталов в displayCurrency.
 * Каждая ячейка цены конвертируется per-item.
 *
 * @returns {{equipmentCost, installationCost, maintenanceRubPerYear}}
 */
export function computeEcoTotals(eco, displayCurrency, convertFn) {
  const items = normCostItems(eco, displayCurrency);
  const conv = (v, from, to) => {
    if (!Number.isFinite(v) || v === 0 || from === to || !convertFn) return v;
    const r = convertFn(v, from, to);
    return Number.isFinite(r) ? r : v;
  };
  let eq = 0, inst = 0, mnt = 0;
  for (const it of items) {
    const q = Number(it.qty) || 1;
    eq   += q * conv(Number(it.equipmentPrice?.value)          || 0, it.equipmentPrice?.currency          || displayCurrency, displayCurrency);
    inst += q * conv(Number(it.installPrice?.value)            || 0, it.installPrice?.currency            || displayCurrency, displayCurrency);
    mnt  += q * conv(Number(it.maintenancePerYearPrice?.value) || 0, it.maintenancePerYearPrice?.currency || displayCurrency, displayCurrency);
  }
  // Если costItems пусто и в legacy полях нет items[], но есть native single-value —
  // возьмём legacy как fallback (без qty).
  if (!items.length) {
    const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
    const eqM = normMoney(e.equipmentCost, e.currency || displayCurrency);
    const inM = normMoney(e.installationCost, e.currency || displayCurrency);
    const mtM = normMoney(e.maintenanceRubPerYear, e.currency || displayCurrency);
    eq = conv(eqM.value, eqM.currency, displayCurrency);
    inst = conv(inM.value, inM.currency, displayCurrency);
    mnt = conv(mtM.value, mtM.currency, displayCurrency);
  }
  return {
    equipmentCost: eq || 0,
    installationCost: inst || 0,
    maintenanceRubPerYear: mnt || 0,
  };
}

/**
 * Конвертировать СУММЫ opt.eco в displayCurrency. Возвращает eco с плоскими
 * числами для computeTco (всё в displayCurrency).
 *
 * @param {object} eco
 * @param {string} displayCurrency
 * @param {function|null} convertFn
 * @returns {object} eco с числовыми equipmentCost/installationCost/maintenanceRubPerYear
 */
export function convertEcoToCurrency(eco, displayCurrency, convertFn) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  const totals = computeEcoTotals(eco, displayCurrency, convertFn);
  return {
    ...e,
    currency: displayCurrency,
    equipmentCost:         totals.equipmentCost,
    installationCost:      totals.installationCost,
    maintenanceRubPerYear: totals.maintenanceRubPerYear,
  };
}

/**
 * v0.60.18 helper (оставлен для обратной совместимости вызывающего кода).
 */
export function moneyTotalIn(field, displayCurrency, convertFn, defaultCur = '₽') {
  const m = normMoney(field, defaultCur);
  const conv = (v, from, to) => {
    if (!convertFn || from === to || !Number.isFinite(v) || v === 0) return v;
    const r = convertFn(v, from, to);
    return Number.isFinite(r) ? r : v;
  };
  if (!m.items || !m.items.length) return conv(m.value, m.currency, displayCurrency);
  return m.items.reduce((s, it) =>
    s + conv(Number(it.value) || 0, it.currency || m.currency, displayCurrency), 0);
}

/**
 * Расчёт TCO/NPV по одной опции.
 *
 * @param {object} opts
 *   @param {number} annualEnergyKwh  — годовое потребление (из bin-calc)
 *   @param {number} tariffRubKwh     — текущий тариф ₽/кВт·ч
 *   @param {object} eco              — параметры economics (см. DEFAULT_ECONOMICS)
 *
 * @returns {object} {
 *   capex, yearlyOpex, tco, tcoUndiscounted, averageRubPerYear,
 *   discountRatePct, projectLifetimeYears
 * }
 */
export function computeTco({ annualEnergyKwh, tariffRubKwh, eco }) {
  const e = { ...DEFAULT_ECONOMICS, ...(eco || {}) };
  const N = Math.max(1, Math.round(Number(e.projectLifetimeYears) || 15));
  const r = (Number(e.discountRatePct) || 0) / 100;
  const escE = (Number(e.escalationEnergyPct) || 0) / 100;
  const escM = (Number(e.escalationMaintPct) || 0) / 100;
  const tariff = Number(tariffRubKwh) || 0;
  const annKwh = Number(annualEnergyKwh) || 0;
  const baseEnergy = annKwh * tariff;
  const baseMaint  = Number(e.maintenanceRubPerYear) || 0;

  const capex = (Number(e.equipmentCost) || 0) + (Number(e.installationCost) || 0);

  let cumDisc = 0;
  let sumDisc = 0;
  let sumUndisc = 0;
  const yearly = [];
  for (let t = 1; t <= N; t++) {
    const energyRub = baseEnergy * Math.pow(1 + escE, t - 1);
    const maintRub  = baseMaint  * Math.pow(1 + escM, t - 1);
    const totalRub  = energyRub + maintRub;
    const discount  = Math.pow(1 + r, t);
    const discountedRub = totalRub / discount;
    sumDisc += discountedRub;
    sumUndisc += totalRub;
    cumDisc += discountedRub;
    yearly.push({ year: t, energyRub, maintRub, totalRub, discountedRub, cumDiscounted: cumDisc + capex });
  }

  return {
    capex,
    yearlyOpex: yearly,
    tco: capex + sumDisc,
    tcoUndiscounted: capex + sumUndisc,
    averageRubPerYear: (capex + sumDisc) / N,
    discountRatePct: r * 100,
    projectLifetimeYears: N,
  };
}

/**
 * Discounted Payback Period — за сколько лет инвестиция (ΔCAPEX) окупится
 * экономией на OPEX (ΔOPEX) с учётом дисконтирования.
 */
export function discountedPaybackYears(candidate, baseline) {
  const dCapex = candidate.capex - baseline.capex;
  if (dCapex <= 0) return null;

  const r = candidate.discountRatePct / 100;
  let cum = -dCapex;
  for (let i = 0; i < candidate.yearlyOpex.length; i++) {
    const candOpex = candidate.yearlyOpex[i].totalRub;
    const baseOpex = baseline.yearlyOpex[i] ? baseline.yearlyOpex[i].totalRub : 0;
    const savings  = baseOpex - candOpex;
    const disc     = Math.pow(1 + r, i + 1);
    const discSavings = savings / disc;
    const prev = cum;
    cum += discSavings;
    if (prev < 0 && cum >= 0) {
      const fraction = -prev / discSavings;
      return { years: i + 1, exact: i + fraction, neverPaysBack: false };
    }
  }
  return { years: null, exact: null, neverPaysBack: true };
}
