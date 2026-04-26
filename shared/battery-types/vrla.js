// ======================================================================
// shared/battery-types/vrla.js
// v0.59.426
// Тип АКБ «VRLA / стандартные» — fallback-плагин для всего, что не
// модульная Li-Ion-система типа Kehua S³ (или совместимая).
//
// Покрывает: VRLA (свинцово-кислотные с клапанной регулировкой),
// AGM, gel, NiCd, Li-Ion-моноблоки без packaging-metadata.
//
// Логика подбора простая: пользователь сам задаёт число блоков на
// строку (blocksPerString) и число параллельных строк (strings).
// Никакого master/slave, никакого Combiner'а, никаких шкафов
// автосборкой — это «насыпь» одинаковых блоков.
// ======================================================================

export const vrlaType = {
  id: 'vrla',
  label: 'VRLA / AGM / Gel / NiCd / стандартные АКБ',
  icon: '🔋',
  order: 100,                      // fallback — последний в списке

  matches(b) {
    if (!b) return false;
    // НЕ S³-модуль (т.е. либо обычная VRLA, либо S³-cabinet/accessory).
    // S³-cabinet/accessory сами фильтруются как !isSelectable, поэтому
    // здесь просто «всё, что не модуль системы».
    if (b.isSystem && b.systemSubtype === 'module') return false;
    return true;
  },

  isSelectable(b) {
    if (!b) return false;
    // Скрываем только шкафы и аксессуары систем (cabinet/accessory).
    if (b.isSystem && (b.systemSubtype === 'cabinet' || b.systemSubtype === 'accessory')) return false;
    return true;
  },

  listSelectable(catalog) {
    return catalog.filter(b => this.matches(b) && this.isSelectable(b));
  },

  // Для VRLA «buildSystem» — это просто описание массива блоков без
  // шкафов. Шкаф/стеллаж делается отдельно через battery/ модуль
  // «Компоновка VRLA-шкафа».
  buildSystem({ module, totalModules /*, options*/ }) {
    return {
      cabinets: [],                // VRLA не описывается как «шкаф»
      accessories: [],
      modulesPerCabinet: totalModules,
      cabinetsCount: 0,
      totalModules,
      warnings: [],
    };
  },

  // Для VRLA расчёт делается стандартными функциями battery-calc
  // (calcAutonomy / per-block dischargeTable). Этот плагин не
  // подменяет логику — вызывается только когда пользователь явно
  // хочет «новую» сводку. Возврат null = «используй старый код».
  compute() {
    return null;
  },

  validateMaxCRate() {
    // Для VRLA C-rate-валидация не требуется (rated power не из паспорта).
    return { ok: true };
  },

  bomLines() {
    return [];
  },
};
