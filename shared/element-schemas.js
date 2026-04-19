// ======================================================================
// shared/element-schemas.js
// Factory-функции и валидаторы для элементов библиотеки по kind.
//
// Используется shared/element-library.js для создания новых элементов
// с корректными дефолтами. Каждый kind имеет свою factory которая
// создаёт Element со всеми обязательными полями заполненными.
//
// Конвертеры legacy → Element (fromPanelRecord, fromUpsRecord, …)
// применяются в подфазе 1.2 для адаптеров существующих каталогов.
// ======================================================================

// ——— Хелперы ———

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\d-]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-{2,}/g, '-');
}

function makeElementId(kind, parts) {
  const body = (Array.isArray(parts) ? parts : [parts])
    .map(slug)
    .filter(Boolean)
    .join('-');
  return kind + '--' + (body || Date.now().toString(36));
}

// ——— Factories по kind ———

/** panel (распределительный щит) — legacy PanelRecord → Element */
export function createPanelElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('panel', [p.manufacturer, p.series, p.variant]),
    kind: 'panel',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.series, p.variant].filter(Boolean).join(' ') || 'Щит',
    description: p.description || '',
    manufacturer: p.manufacturer || p.supplier || '',
    series: p.series || '',
    variant: p.variant || '',
    electrical: {
      voltageCategory: p.voltageCategory || 'lv',
      capacityA: Number(p.inNominal || p.capacityA || 0),
      phases: Number(p.phases) || 3,
    },
    geometry: {
      widthMm: Number(p.width || p.widthMm || 0),
      heightMm: Number(p.height || p.heightMm || 0),
      depthMm: Number(p.depth || p.depthMm || 0),
      weightKg: Number(p.weightKg || 0),
      heatDissipationW: Number(p.heatDissipationW || 0),
    },
    views: {},
    composition: [],
    kindProps: {
      ipRating: p.ipRating || 'IP31',
      form: p.form || '',
      busbarA: p.busbarA != null ? Number(p.busbarA) : null,
      material: p.material || 'steel',
      maxHeatDissipationW: Number(p.maxHeatDissipationW || 0),
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** ups (источник бесперебойного питания) */
export function createUpsElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('ups', [p.manufacturer, p.model]),
    kind: 'ups',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.model].filter(Boolean).join(' ') || 'ИБП',
    description: p.description || '',
    manufacturer: p.manufacturer || p.supplier || '',
    series: p.series || '',
    variant: p.model || p.variant || '',
    electrical: {
      voltageCategory: 'lv',
      capacityKw: Number(p.capacityKw || 0),
      phases: Number(p.phases) || 3,
      efficiency: Number(p.efficiency || 0.96),
      cosPhi: Number(p.cosPhi || 0.9),
    },
    geometry: {
      widthMm: Number(p.widthMm || 0),
      heightMm: Number(p.heightMm || 0),
      depthMm: Number(p.depthMm || 0),
      weightKg: Number(p.weightKg || 0),
      heatDissipationW: Number(p.heatDissipationW || 0),
    },
    views: {},
    composition: p.composition || [],   // модульные ИБП: frame + modules + bypass
    kindProps: {
      upsType: p.upsType || 'monoblock',      // monoblock | modular
      frameKw: Number(p.frameKw || 0),
      moduleKwRated: Number(p.moduleKwRated || 0),
      moduleSlots: Number(p.moduleSlots || 0),
      vdcMin: Number(p.vdcMin || 0),
      vdcMax: Number(p.vdcMax || 0),
      inputs: Number(p.inputs || 1),
      outputs: Number(p.outputs || 1),
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** battery (аккумуляторная батарея) */
export function createBatteryElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('battery', [p.manufacturer, p.type]),
    kind: 'battery',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.type].filter(Boolean).join(' ') || 'АКБ',
    description: p.description || '',
    manufacturer: p.manufacturer || p.supplier || '',
    series: p.series || '',
    variant: p.type || p.variant || '',
    electrical: {
      voltageCategory: 'dc',
    },
    geometry: {
      widthMm: Number(p.widthMm || 0),
      heightMm: Number(p.heightMm || 0),
      depthMm: Number(p.depthMm || 0),
      weightKg: Number(p.weightKg || 0),
    },
    views: {},
    composition: [],
    kindProps: {
      chemistry: p.chemistry || 'vrla',      // vrla | li-ion | nicd
      capacityAh: Number(p.capacityAh || 0),
      blockVoltage: Number(p.blockVoltage || 12),
      cellCount: Number(p.cellCount || 6),
      cellVoltage: Number(p.cellVoltage || 2),
      dischargeTable: p.dischargeTable || [], // [{endV, tMin, powerW}, ...]
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** transformer (силовой трансформатор) */
export function createTransformerElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('transformer', [p.manufacturer, p.series, p.variant]),
    kind: 'transformer',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.series, p.variant].filter(Boolean).join(' ') || 'Трансформатор',
    description: p.description || '',
    manufacturer: p.manufacturer || p.supplier || '',
    series: p.series || '',
    variant: p.variant || '',
    electrical: {
      voltageCategory: p.voltageCategory || 'mv',
      phases: 3,
    },
    geometry: {
      widthMm: Number(p.widthMm || 0),
      heightMm: Number(p.heightMm || 0),
      depthMm: Number(p.depthMm || 0),
      weightKg: Number(p.weight || p.weightKg || 0),
    },
    views: {},
    composition: [],
    kindProps: {
      sKva: Number(p.sKva || 0),
      uhvKv: Number(p.uhvKv || 0),            // первичное, кВ
      ulvV: Number(p.ulvV || 400),            // вторичное, В
      vectorGroup: p.vectorGroup || 'Dyn11',
      ukPct: Number(p.ukPct || 5.5),
      p0Kw: Number(p.p0Kw || 0),
      pkKw: Number(p.pkKw || 0),
      cooling: p.cooling || 'ONAN',           // ONAN | ONAF | ANAN | KNAN
      insulation: p.insulation || 'oil',      // oil | dry | epoxy
      tempRise: Number(p.tempRise || 65),
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** cable-type (марка кабеля: ВВГнг, КВВГ, FTP, ...) */
export function createCableTypeElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('cable-type', [p.brand || p.label]),
    kind: 'cable-type',
    category: 'reference',
    label: p.label || p.brand || 'Кабель',
    description: p.description || p.fullName || '',
    manufacturer: p.manufacturer || '',
    series: p.brand || '',
    variant: '',
    electrical: {
      voltageCategory: p.voltageCategory || 'lv',
    },
    geometry: {},
    views: {},
    composition: [],
    kindProps: {
      brand: p.brand || '',
      fullName: p.fullName || '',
      category: p.category || 'power', // CABLE_CATEGORIES
      material: p.material || 'Cu',
      insulation: p.insulation || 'PVC',
      sheathMaterial: p.sheathMaterial || 'PVC',
      fireResistant: !!p.fireResistant,
      lowSmokeZH: !!p.lowSmokeZH,
      standard: p.standard || '',
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** breaker (автоматический выключатель / УЗО / дифавтомат) */
export function createBreakerElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('breaker', [p.manufacturer, p.series, p.variant]),
    kind: 'breaker',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.series, p.variant].filter(Boolean).join(' ') || 'Автомат',
    description: p.description || '',
    manufacturer: p.manufacturer || '',
    series: p.series || '',
    variant: p.variant || '',
    electrical: {
      voltageCategory: p.voltageCategory || 'lv',
      capacityA: Number(p.inNominal || 0),
      phases: Number(p.poles || 3),
    },
    geometry: {
      widthMm: Number(p.widthMm || 0),
      heightMm: Number(p.heightMm || 85),  // типовая высота модульника
      depthMm: Number(p.depthMm || 70),
      weightKg: Number(p.weightKg || 0.2),
      heatDissipationW: Number(p.heatDissipationW || 0),
    },
    views: {},
    composition: [],
    kindProps: {
      type: p.type || 'MCB',                 // MCB | MCCB | ACB | RCD | RCBO
      curve: p.curve || 'C',                 // B | C | D (для MCB)
      breakingCapacityKa: Number(p.breakingCapacityKa || 6),
      tripUnit: p.tripUnit || null,          // thermal | magnetic | electronic
      rcdTripMa: p.rcdTripMa != null ? Number(p.rcdTripMa) : null,
      modules: Number(p.modules || 1),       // число модулей в щите
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** consumer-type (типовой потребитель — освещение, розетки, насос...) */
export function createConsumerTypeElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('consumer-type', [p.label || p.typeId]),
    kind: 'consumer-type',
    category: 'reference',
    label: p.label || 'Потребитель',
    description: p.description || '',
    manufacturer: '',
    series: '',
    variant: '',
    electrical: {
      voltageCategory: p.voltageCategory || 'lv',
      capacityKw: Number(p.demandKw || 0),
      phases: Number(p.phases) || (p.phase === '3ph' ? 3 : 1),
      cosPhi: Number(p.cosPhi || 0.92),
    },
    geometry: {},
    views: {},
    composition: [],
    kindProps: {
      typeId: p.typeId || p.id || '',        // 'lighting' | 'motor' | ...
      kUse: Number(p.kUse || 1),
      inrushFactor: Number(p.inrushFactor || 1),
      phase: p.phase || '3ph',
      isConditioner: !!p.isConditioner,
      outdoorKw: Number(p.outdoorKw || 0),
      outdoorCosPhi: Number(p.outdoorCosPhi || 0),
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

/** enclosure (корпус-оболочка щита без конфигурации) */
export function createEnclosureElement(patch = {}) {
  return {
    ...createPanelElement(patch),
    kind: 'enclosure',
    label: patch.label || 'Оболочка щита',
  };
}

/** climate (кондиционер / вентилятор для щита) */
export function createClimateElement(patch = {}) {
  const p = patch || {};
  return {
    id: p.id || makeElementId('climate', [p.manufacturer, p.model]),
    kind: 'climate',
    category: 'equipment',
    label: p.label || [p.manufacturer, p.model].filter(Boolean).join(' ') || 'Кондиционер',
    description: p.description || '',
    manufacturer: p.manufacturer || '',
    series: p.series || '',
    variant: p.model || '',
    electrical: {
      voltageCategory: 'lv',
      capacityKw: Number(p.capacityKw || 0),
      phases: Number(p.phases) || 1,
    },
    geometry: {
      widthMm: Number(p.widthMm || 0),
      heightMm: Number(p.heightMm || 0),
      depthMm: Number(p.depthMm || 0),
      weightKg: Number(p.weightKg || 0),
    },
    views: {},
    composition: [],
    kindProps: {
      type: p.type || 'ac',                   // ac | fan | heater | condenser
      coolingPowerW: Number(p.coolingPowerW || 0),
      heatingPowerW: Number(p.heatingPowerW || 0),
      airflowM3h: Number(p.airflowM3h || 0),  // для вентиляторов
    },
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

// ——— Универсальная factory ———

const FACTORIES = {
  panel: createPanelElement,
  ups: createUpsElement,
  battery: createBatteryElement,
  transformer: createTransformerElement,
  'cable-type': createCableTypeElement,
  breaker: createBreakerElement,
  'consumer-type': createConsumerTypeElement,
  enclosure: createEnclosureElement,
  climate: createClimateElement,
};

/**
 * Универсальная factory по kind. Для custom kind — просто сохраняет
 * с минимальной структурой.
 */
export function createElement(kind, patch = {}) {
  const factory = FACTORIES[kind];
  if (factory) return factory(patch);
  // Custom / channel / etc.
  const p = patch || {};
  return {
    id: p.id || ('el-' + Date.now().toString(36)),
    kind,
    category: p.category || 'equipment',
    label: p.label || kind,
    description: p.description || '',
    manufacturer: p.manufacturer || '',
    series: p.series || '',
    variant: p.variant || '',
    electrical: p.electrical || {},
    geometry: p.geometry || {},
    views: p.views || {},
    composition: p.composition || [],
    kindProps: p.kindProps || {},
    source: p.source || 'user',
    builtin: !!p.builtin,
    tags: p.tags || [],
  };
}

// ——— Конвертеры legacy records → Element (для адаптеров подфазы 1.2) ———

/** PanelRecord (shared/panel-catalog.js) → Element(kind='panel') */
export function fromPanelRecord(rec) {
  if (!rec) return null;
  return createPanelElement({
    id: rec.id,
    manufacturer: rec.supplier,
    series: rec.series,
    variant: rec.variant,
    inNominal: rec.inNominal,
    ipRating: rec.ipRating,
    form: rec.form,
    width: rec.width,
    height: rec.height,
    depth: rec.depth,
    busbarA: rec.busbarA,
    material: rec.material,
    maxHeatDissipationW: rec.maxHeatDissipationW,
    source: rec.source || 'adapter',
    builtin: !!rec.builtin,
  });
}

/** UpsRecord → Element(kind='ups') */
export function fromUpsRecord(rec) {
  if (!rec) return null;
  return createUpsElement({
    id: rec.id,
    manufacturer: rec.supplier,
    model: rec.model,
    capacityKw: rec.capacityKw,
    upsType: rec.upsType,
    frameKw: rec.frameKw,
    moduleKwRated: rec.moduleKwRated,
    moduleSlots: rec.moduleSlots,
    efficiency: rec.efficiency,
    cosPhi: rec.cosPhi,
    vdcMin: rec.vdcMin,
    vdcMax: rec.vdcMax,
    inputs: rec.inputs,
    outputs: rec.outputs,
    source: rec.source || 'adapter',
    builtin: !!rec.builtin,
  });
}

/** BatteryRecord → Element(kind='battery') */
export function fromBatteryRecord(rec) {
  if (!rec) return null;
  return createBatteryElement({
    id: rec.id,
    manufacturer: rec.supplier,
    type: rec.type,
    chemistry: rec.chemistry,
    capacityAh: rec.capacityAh,
    blockVoltage: rec.blockVoltage,
    cellCount: rec.cellCount,
    cellVoltage: rec.cellVoltage,
    dischargeTable: rec.dischargeTable,
    source: rec.source || 'adapter',
    builtin: !!rec.builtin,
  });
}

/** TransformerRecord → Element(kind='transformer') */
export function fromTransformerRecord(rec) {
  if (!rec) return null;
  return createTransformerElement({
    id: rec.id,
    manufacturer: rec.supplier,
    series: rec.series,
    variant: rec.variant,
    sKva: rec.sKva,
    uhvKv: rec.uhvKv,
    ulvV: rec.ulvV,
    vectorGroup: rec.vectorGroup,
    ukPct: rec.ukPct,
    p0Kw: rec.p0Kw,
    pkKw: rec.pkKw,
    cooling: rec.cooling,
    insulation: rec.insulation,
    tempRise: rec.tempRise,
    weight: rec.weight,
    source: rec.source || 'adapter',
    builtin: !!rec.builtin,
  });
}

/** CableTypeRecord → Element(kind='cable-type') */
export function fromCableTypeRecord(rec) {
  if (!rec) return null;
  return createCableTypeElement({
    id: rec.id,
    brand: rec.brand,
    fullName: rec.fullName,
    category: rec.category,
    material: rec.material,
    insulation: rec.insulation,
    sheathMaterial: rec.sheathMaterial,
    fireResistant: rec.fireResistant,
    lowSmokeZH: rec.lowSmokeZH,
    standard: rec.standard,
    description: rec.description,
    source: rec.source || 'adapter',
    builtin: !!rec.builtin,
  });
}

// ——— Обратные конвертеры Element → legacy (для backward-compat API) ———

/** Element(kind='panel') → PanelRecord */
export function toPanelRecord(el) {
  if (!el || el.kind !== 'panel') return null;
  return {
    id: el.id,
    supplier: el.manufacturer,
    series: el.series,
    variant: el.variant,
    inNominal: el.electrical?.capacityA || 0,
    ipRating: el.kindProps?.ipRating || 'IP31',
    form: el.kindProps?.form || '',
    width: el.geometry?.widthMm || 0,
    height: el.geometry?.heightMm || 0,
    depth: el.geometry?.depthMm || 0,
    busbarA: el.kindProps?.busbarA ?? null,
    material: el.kindProps?.material || 'steel',
    maxHeatDissipationW: el.kindProps?.maxHeatDissipationW || 0,
    source: el.source,
    builtin: !!el.builtin,
  };
}

/** Element(kind='ups') → UpsRecord */
export function toUpsRecord(el) {
  if (!el || el.kind !== 'ups') return null;
  return {
    id: el.id,
    supplier: el.manufacturer,
    model: el.variant,
    capacityKw: el.electrical?.capacityKw || 0,
    upsType: el.kindProps?.upsType || 'monoblock',
    frameKw: el.kindProps?.frameKw || 0,
    moduleKwRated: el.kindProps?.moduleKwRated || 0,
    moduleSlots: el.kindProps?.moduleSlots || 0,
    efficiency: el.electrical?.efficiency || 0.96,
    cosPhi: el.electrical?.cosPhi || 0.9,
    vdcMin: el.kindProps?.vdcMin || 0,
    vdcMax: el.kindProps?.vdcMax || 0,
    inputs: el.kindProps?.inputs || 1,
    outputs: el.kindProps?.outputs || 1,
    source: el.source,
    builtin: !!el.builtin,
  };
}

export function toBatteryRecord(el) {
  if (!el || el.kind !== 'battery') return null;
  return {
    id: el.id,
    supplier: el.manufacturer,
    type: el.variant,
    chemistry: el.kindProps?.chemistry,
    capacityAh: el.kindProps?.capacityAh,
    blockVoltage: el.kindProps?.blockVoltage,
    cellCount: el.kindProps?.cellCount,
    cellVoltage: el.kindProps?.cellVoltage,
    dischargeTable: el.kindProps?.dischargeTable || [],
    source: el.source,
    builtin: !!el.builtin,
  };
}

export function toTransformerRecord(el) {
  if (!el || el.kind !== 'transformer') return null;
  return {
    id: el.id,
    supplier: el.manufacturer,
    series: el.series,
    variant: el.variant,
    sKva: el.kindProps?.sKva,
    uhvKv: el.kindProps?.uhvKv,
    ulvV: el.kindProps?.ulvV,
    vectorGroup: el.kindProps?.vectorGroup,
    ukPct: el.kindProps?.ukPct,
    p0Kw: el.kindProps?.p0Kw,
    pkKw: el.kindProps?.pkKw,
    cooling: el.kindProps?.cooling,
    insulation: el.kindProps?.insulation,
    tempRise: el.kindProps?.tempRise,
    weight: el.geometry?.weightKg,
    source: el.source,
    builtin: !!el.builtin,
  };
}

export function toCableTypeRecord(el) {
  if (!el || el.kind !== 'cable-type') return null;
  return {
    id: el.id,
    brand: el.kindProps?.brand || el.label,
    fullName: el.kindProps?.fullName || el.description,
    category: el.kindProps?.category,
    material: el.kindProps?.material,
    insulation: el.kindProps?.insulation,
    sheathMaterial: el.kindProps?.sheathMaterial,
    fireResistant: el.kindProps?.fireResistant,
    lowSmokeZH: el.kindProps?.lowSmokeZH,
    standard: el.kindProps?.standard,
    description: el.description,
    source: el.source,
    builtin: !!el.builtin,
  };
}
