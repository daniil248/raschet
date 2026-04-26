// ======================================================================
// shared/battery-types/s3-li-ion.js
// v0.59.426
// Тип АКБ «Kehua S³ Li-Ion (или совместимый)» — модульная LFP-система,
// где пользователь выбирает МОДУЛЬ, а шкаф собирается автоматически.
//
// Архитектура (Kehua S³ User Manual, Figure3-28):
//   • 1 шкаф          — master ('-M' / '-M1' / '-M2'). Slave не нужны.
//   • 2…N шкафов      — 1×master + (N−1)×slave ('-S' / '-S2').
//   • >2 шкафов       — добавляется Combiner-шкаф (шинная DC-разводка).
//   • Comms (RS485)   — Networking Device (8-port switch), до 7 шкафов
//                       на устройство; >7 ⇒ +1 устройство.
//   • Неполный шкаф   — Blank Panel в каждый пустой слот
//                       (отдельный SKU для S3M040/050 и для S3M100).
//   • Каждый slave    — комплект проводов «Slave Wire Kit»
//                       (#2 communication + #3 power + #1 network 4.5 м
//                        + 2× RJ45). Master комплект НЕ требует.
//
// Плагин делегирует расчёт автономии/мощности модулю
// shared/battery-s3-logic.js (computeS3Configuration), а сам
// отвечает за сборку шкафов и BOM.
// ======================================================================

import {
  isS3Module, getS3Limits, resolveS3Wiring,
  computeS3Configuration, findMinimalS3Config,
} from '../battery-s3-logic.js';

export const s3LiIonType = {
  id: 's3-li-ion',
  label: 'Kehua S³ Li-Ion (модульная LFP-система)',
  icon: '🔷',
  order: 10,

  matches(b) { return isS3Module(b); },

  isSelectable(b) { return isS3Module(b); },

  listSelectable(catalog) {
    return catalog.filter(b => isS3Module(b));
  },

  // ------------------------------------------------------------------
  // Главная функция автосборки шкафов и аксессуаров.
  //
  // Вход:
  //   module           — запись модуля (S3M040/050/100)
  //   totalModules     — желаемое число модулей в системе
  //   options.variant  — 'M' | 'M1' | 'M2' для master (default 'M')
  //                       и 'S' | 'S2' для slave (default 'S')
  //   options.fireFighting — true ⇒ +'X' в model-suffix модулей (флаг)
  //
  // Выход: SystemSpec (см. index.js).
  // ------------------------------------------------------------------
  buildSystem({ module, totalModules, options = {} }) {
    if (!isS3Module(module) || !(totalModules > 0)) {
      return { cabinets: [], accessories: [], modulesPerCabinet: 0,
               cabinetsCount: 0, totalModules: 0, warnings: ['Не задан модуль или количество.'] };
    }
    const lim = getS3Limits(module);
    const masterVariant = options.masterVariant || 'M';   // 'M' | 'M1' | 'M2'
    const slaveVariant  = options.slaveVariant  || 'S';   // 'S' | 'S2'
    const baseModel     = lim.cabinetModel || (module.packaging || {}).cabinetModel || '';

    // Распределяем модули по шкафам сверху вниз: первый шкаф (master)
    // заполняется сначала. Можно переопределить через options.distribution
    // = 'even' для равномерного, default 'top-down' (как в брошюре).
    const cabinetsCount = Math.ceil(totalModules / lim.maxPerCabinet);
    const cabinets = [];
    let remaining = totalModules;
    for (let i = 0; i < cabinetsCount; i++) {
      const role = (i === 0) ? 'master' : 'slave';
      const variant = (i === 0) ? masterVariant : slaveVariant;
      const fillModules = Math.min(remaining, lim.maxPerCabinet);
      remaining -= fillModules;
      cabinets.push({
        role, variant,
        model: baseModel + '-' + variant,
        modulesInCabinet: fillModules,
        emptySlots: lim.maxPerCabinet - fillModules,
      });
    }

    // Combiner — нужен при cabinetsCount > 2 (User Manual §3, Figure3-28).
    if (cabinetsCount > 2) {
      cabinets.push({ role: 'combiner', variant: '', model: 'S3-Combiner', modulesInCabinet: 0, emptySlots: 0 });
    }

    // Аксессуары
    const accessories = [];
    // Wire-kit — по комплекту на каждый slave (master комплект не требует).
    const slavesQty = cabinets.filter(c => c.role === 'slave').length;
    if (slavesQty > 0) {
      accessories.push({ id: 'kehua-s3-slave-wire-kit', role: 'wire-kit', qty: slavesQty });
    }
    // Networking Device — нужен при cabinetsCount >= 2; до 7 шкафов на устройство.
    const realCabinets = cabinets.filter(c => c.role === 'master' || c.role === 'slave').length;
    if (realCabinets >= 2) {
      const ndQty = Math.ceil(realCabinets / 7);
      accessories.push({ id: 'kehua-s3-networking-device', role: 'networking-device', qty: ndQty });
    }
    // Blank Panel — в каждый пустой слот реальных шкафов (master/slave),
    // не в Combiner.
    const totalEmpty = cabinets.filter(c => c.role !== 'combiner')
                               .reduce((s, c) => s + (c.emptySlots || 0), 0);
    if (totalEmpty > 0) {
      const isHundredAh = (Number(module.capacityAh) === 100);
      const blankId = isHundredAh ? 'kehua-s3-blank-panel-100' : 'kehua-s3-blank-panel-040-050';
      accessories.push({ id: blankId, role: 'blank-panel', qty: totalEmpty });
    }

    // Предупреждения
    const warnings = [];
    if (cabinetsCount > lim.maxCabinets) {
      warnings.push(`Превышен лимит параллельных шкафов: ${cabinetsCount} > ${lim.maxCabinets}.`);
    }
    if (totalModules === 1) {
      warnings.push('1 модуль — система всегда master, slave не требуется.');
    }

    return {
      cabinets,
      accessories,
      modulesPerCabinet: lim.maxPerCabinet,
      cabinetsCount,
      totalModules,
      warnings,
    };
  },

  // Делегируем расчёт в shared/battery-s3-logic.js — единственный
  // источник истины для S³-математики.
  compute(args) {
    return computeS3Configuration(args);
  },

  // Проверка max C-rate: реальная мощность нагрузки на модуль не должна
  // превышать паспортную (rated cell discharge × Vnom × Ah / 1000).
  validateMaxCRate({ module, loadKw, totalModules, invEff = 0.96, cosPhi = 1 }) {
    if (!isS3Module(module)) return { ok: true };
    const pk = module.packaging || {};
    const cRate = Number(pk.dischargeRateC) || 0;
    if (!cRate) return { ok: true, reason: 'Нет паспортного C-rate в данных модуля.' };
    const blockV = Number(module.blockVoltage) || 240;
    const ah = Number(module.capacityAh) || 0;
    // Rated power per module (kW) = C × Vnom × Ah / 1000.
    const ratedPerModuleKw = (cRate * blockV * ah) / 1000;
    const ratedSystemKw = ratedPerModuleKw * totalModules;
    const reqKw = (loadKw || 0) * (cosPhi || 1) / Math.max(0.5, invEff || 0.96);
    if (reqKw > ratedSystemKw + 1e-6) {
      return {
        ok: false,
        reason: `Нагрузка ${reqKw.toFixed(1)} кВт превышает max C-rate системы: ${cRate}C × ${totalModules} модулей = ${ratedSystemKw.toFixed(1)} кВт. Увеличьте число модулей или выберите модель с большим C-rate.`,
        ratedSystemKw, ratedPerModuleKw, reqKw, cRate,
      };
    }
    return { ok: true, ratedSystemKw, ratedPerModuleKw, reqKw, cRate };
  },

  // BOM-строки из SystemSpec. Возвращает массив объектов
  // {category, id, supplier, model, qty, role}. Используется в
  // ups-config / battery-calc / inspector для формирования итоговой
  // комплектации.
  bomLines(systemSpec, { module, accessoryCatalog = [] } = {}) {
    if (!systemSpec || !Array.isArray(systemSpec.cabinets)) return [];
    const out = [];
    const supplier = (module && module.supplier) || 'Kehua';

    // Модули
    if (module && systemSpec.totalModules > 0) {
      out.push({
        category: 'АКБ S³ — модули',
        id: module.id, supplier,
        model: module.type || module.model,
        qty: systemSpec.totalModules,
        role: 'module',
      });
    }
    // Шкафы (master + slave + combiner)
    for (const c of systemSpec.cabinets) {
      out.push({
        category: c.role === 'combiner' ? 'АКБ S³ — комбайнер' : 'АКБ S³ — шкафы',
        id: `s3-cabinet-${c.role}`,
        supplier,
        model: c.model,
        qty: 1,
        role: c.role,
        meta: {
          variant: c.variant,
          modulesInCabinet: c.modulesInCabinet,
          emptySlots: c.emptySlots,
        },
      });
    }
    // Аксессуары
    for (const a of (systemSpec.accessories || [])) {
      const cat = accessoryCatalog.find(x => x.id === a.id);
      out.push({
        category: 'АКБ S³ — аксессуары',
        id: a.id,
        supplier: (cat && cat.supplier) || supplier,
        model: (cat && cat.type) || a.id,
        qty: a.qty,
        role: a.role,
      });
    }
    return out;
  },

  // Прокидываем reverse-mode (подбор минимума по требуемой автономии).
  findMinimal(args) {
    return findMinimalS3Config(args);
  },
};
