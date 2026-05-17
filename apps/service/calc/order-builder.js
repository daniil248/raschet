// =============================================================================
// service/calc/order-builder.js — построение наряда из cooling-подбора
// =============================================================================
// Phase 24.3 (по требованию: «по проекту или разовые работы»):
// одной кнопкой собрать позиции наряда из выбранного cooling-варианта.
// Использует option.equipment[] (qty + spec) для генерации монтажных
// позиций с дефолтными ценами по типу оборудования.
//
// Pure JS, no DOM. LocalStorage чтение для browse-функций.

import { defaultPosition } from './order-model.js';

/**
 * Эвристика установки прайса монтажа по типу/мощности.
 */
function installPriceFor(spec) {
  if (!spec) return { cost: 30000, client: 50000 };
  const type = String(spec.systemType || '');
  const ratedKw = Number(spec.ratedCapKw) || 0;
  if (type.startsWith('chiller')) {
    if (ratedKw <= 200) return { cost: 80000,  client: 130000 };
    if (ratedKw <= 500) return { cost: 150000, client: 240000 };
    return { cost: 250000, client: 400000 };
  }
  if (type.startsWith('crac')) return { cost: 50000, client: 80000 };
  if (type.startsWith('dx'))   return { cost: 35000, client: 60000 };
  return { cost: 30000, client: 50000 };
}

function maintenancePriceFor(spec) {
  if (!spec) return { cost: 12000, client: 20000 };
  const type = String(spec.systemType || '');
  const ratedKw = Number(spec.ratedCapKw) || 0;
  if (type.startsWith('chiller')) {
    if (ratedKw <= 200) return { cost: 18000, client: 30000 };
    return { cost: 30000, client: 50000 };
  }
  if (type.startsWith('crac')) return { cost: 15000, client: 25000 };
  return { cost: 12000, client: 20000 };
}

/**
 * Построить позиции МОНТАЖНОГО наряда из cooling-варианта.
 * - Каждая equipment-группа → одна позиция «Монтаж: <spec.name>» с qty из топологии.
 * - Дополнительно: ПНР, опрессовка, заправка хладагента.
 * - v0.60.45: каждая позиция помечена sourceModule='cooling' + sourceRef для
 *   дедупа повторных импортов (см. feedback_service_imports.md).
 *
 * @param {object} sel          — cooling selection (для sourceRef.selectionId)
 * @param {object} option       — cooling option (с equipment[])
 * @param {string} displayCurrency
 * @returns {Array<object>} positions[]
 */
export function buildInstallPositionsFromCoolingOption(option, displayCurrency = '₽', sel = null) {
  const positions = [];
  const equipment = Array.isArray(option?.equipment) ? option.equipment : [];
  const baseRef = { selectionId: sel?.id || null, optionId: option?.id || null };
  for (const eq of equipment) {
    if (!eq.spec) continue;
    const qty = Number(eq.qty) || 1;
    const ratedKw = Number(eq.spec.ratedCapKw) || 0;
    const p = installPriceFor(eq.spec);
    positions.push({
      ...defaultPosition(displayCurrency),
      label: `Монтаж: ${eq.spec.name || eq.spec.systemType || 'оборудование'} ${ratedKw ? Math.round(ratedKw) + ' кВт' : ''}`.trim(),
      category: 'labor',
      qty,
      unit: 'комплект',
      costPrice:   { value: p.cost,   currency: '₽' },
      clientPrice: { value: p.client, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, equipmentGroupId: eq.id, kind: 'install-equipment' },
    });
  }
  if (positions.length) {
    positions.push({
      ...defaultPosition(displayCurrency),
      label: 'Опрессовка холодильного контура',
      category: 'labor', qty: 1, unit: 'комплект',
      costPrice:   { value: 12000, currency: '₽' },
      clientPrice: { value: 22000, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, kind: 'install-pressure-test' },
    });
    positions.push({
      ...defaultPosition(displayCurrency),
      label: 'Заправка хладагента (R410A)',
      category: 'material', qty: 5, unit: 'кг',
      costPrice:   { value: 3500, currency: '₽' },
      clientPrice: { value: 5500, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, kind: 'install-refrigerant' },
    });
    positions.push({
      ...defaultPosition(displayCurrency),
      label: 'Пусконаладочные работы (ПНР)',
      category: 'labor', qty: 1, unit: 'комплект',
      costPrice:   { value: 25000, currency: '₽' },
      clientPrice: { value: 45000, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, kind: 'install-pnr' },
    });
  }
  return positions;
}

/**
 * Построить позиции наряда ТО (регламент) из cooling-варианта.
 * - Каждая chiller-группа → одна позиция «ТО квартальное» с qty=4 (4 раза в год) × Σ qty группы.
 */
export function buildMaintenancePositionsFromCoolingOption(option, displayCurrency = '₽', sel = null) {
  const positions = [];
  const equipment = Array.isArray(option?.equipment) ? option.equipment : [];
  const baseRef = { selectionId: sel?.id || null, optionId: option?.id || null };
  for (const eq of equipment) {
    if (!eq.spec) continue;
    const qty = Number(eq.qty) || 1;
    const p = maintenancePriceFor(eq.spec);
    positions.push({
      ...defaultPosition(displayCurrency),
      label: `ТО квартальное: ${eq.spec.name || eq.spec.systemType || 'оборудование'}`.trim(),
      category: 'labor',
      qty: qty * 4, // 4 квартала в год
      unit: 'выезд',
      costPrice:   { value: p.cost,   currency: '₽' },
      clientPrice: { value: p.client, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, equipmentGroupId: eq.id, kind: 'maint-equipment' },
    });
  }
  if (positions.length) {
    positions.push({
      ...defaultPosition(displayCurrency),
      label: 'Замена воздушных фильтров',
      category: 'material', qty: equipment.reduce((s, e) => s + (Number(e.qty) || 1), 0) * 4, unit: 'шт',
      costPrice:   { value: 1200, currency: '₽' },
      clientPrice: { value: 2000, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, kind: 'maint-filters' },
    });
    positions.push({
      ...defaultPosition(displayCurrency),
      label: 'Дозаправка хладагента (годовая)',
      category: 'material', qty: 2, unit: 'кг',
      costPrice:   { value: 4000, currency: '₽' },
      clientPrice: { value: 6500, currency: '₽' },
      sourceModule: 'cooling',
      sourceRef: { ...baseRef, kind: 'maint-refrigerant' },
    });
  }
  return positions;
}

/**
 * Прочитать cooling-подборы из LS для текущего pid (или standalone).
 *
 * @param {string|null} pid — id проекта (null → standalone)
 * @returns {Array<object>} selections[]
 */
export function loadCoolingSelectionsForContext(pid) {
  const key = pid
    ? `raschet.project.${pid}.cooling.selections.v1`
    : `raschet.cooling.standalone.cooling.selections.v1`;
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
