// ======================================================================
// shared/battery-s3-logic.js
// ЕДИНЫЙ источник истины для расчёта Kehua S³ Li-Ion battery system.
// Используется И в js/engine/inspector/ups.js (модал «Управление АКБ»
// внутри схемы), И в battery/battery-calc.js (standalone-калькулятор).
//
// Принцип DRY: всё, что можно сделать в одном месте, делается в одном
// месте. При исправлении ошибки она исправляется во всём проекте.
//
// Чистые функции (без DOM, без localStorage, без сторонних эффектов).
// Принимают параметры — возвращают данные. Удобно для тестов.
//
// Терминология (соответствует Kehua S³ Brochure):
//   модуль (battery pack)  — S3M040/050/100-{x}-240-X, 51.2/57.6 В,
//                             40/50/100 А·ч, DC/DC 240×2.
//   шкаф  (cabinet)        — S3C040/050-…-20-MX или S3C100-…-12-MX,
//                             металлический корпус, до 20 (или 12) модулей,
//                             паспортная мощность 200/200/60 кВт.
//   N — модулей в шкафу;   C — шкафов в параллель.
// ======================================================================

// ---------- detectors ----------

// Признак: запись каталога — модуль S³ Kehua (или совместимый).
// Отличает модуль от обычной АКБ (VRLA) и от шкафа-metadata.
export function isS3Module(battery) {
  return !!(battery && battery.isSystem && battery.systemSubtype === 'module' && battery.packaging);
}

// ---------- limits ----------

// Лимиты упаковки из поля packaging модуля.
// Защита: всегда возвращает осмысленные числа даже на неполных данных.
export function getS3Limits(module) {
  const pk = (module && module.packaging) || {};
  return {
    maxPerCabinet:  Number(pk.maxPerCabinet)  || 20,
    maxCabinets:    Number(pk.maxCabinets)    || 15,
    cabinetPowerKw: Number(pk.cabinetPowerKw) || 200,
    cabinetKwh:     Number(pk.cabinetKwh)     || 0,
    cabinetModel:   pk.cabinetModel || '',
    dcOutputV:      pk.dcOutputV   || '',
  };
}

// ---------- DC/DC wiring ----------

// Резолвит режим подключения DC/DC выходов модулей S³.
//   parallel — оба выхода 240 В параллельно → Vdc = 240 В, удвоенный ток
//   series   — оба выхода 240 В последовательно → Vdc = 480 В
// Если запрошенный режим даёт Vdc вне диапазона ИБП — переключает на
// допустимый автоматически. Если оба недопустимы — оставляет запрошенный
// (вызывающая сторона должна показать предупреждение).
//
// Дефолт: vdcMin ≥ 320 В → series; иначе parallel.
export function resolveS3Wiring({ module, requestedWiring, vdcMin, vdcMax }) {
  const blockV = Number(module && module.blockVoltage) || 240;
  const vSeries   = blockV * 2;
  const vParallel = blockV;
  const seriesOk   = vSeries   >= vdcMin && vSeries   <= vdcMax;
  const parallelOk = vParallel >= vdcMin && vParallel <= vdcMax;
  let wiring = requestedWiring || (vdcMin >= 320 ? 'series' : 'parallel');
  if (wiring === 'series'   && !seriesOk   && parallelOk) wiring = 'parallel';
  if (wiring === 'parallel' && !parallelOk && seriesOk)   wiring = 'series';
  return {
    wiring,
    vdcOper: wiring === 'series' ? vSeries : vParallel,
    seriesOk, parallelOk, vSeries, vParallel,
  };
}

// ---------- main computation ----------

// Главная функция: дано — модуль, нагрузка, диапазон Vdc ИБП, число
// модулей в шкафу N и число шкафов C; возвращает все вычислимые
// характеристики конфигурации (Vdc, мощность на модуль, ток шкафа,
// перегруз, ёмкость), плюс лимиты системы.
//
// Это «source of truth» для S³-расчётов: и инспектор, и калькулятор
// должны вызывать ИМЕННО ЭТУ функцию и брать значения из её результата.
//
// loadKw      — мощность нагрузки на стороне AC (ИБП), kW
// vdcMin/Max  — диапазон Vdc ИБП, В
// invEff      — КПД DC→AC (0..1)
// cosPhi      — коэффициент мощности нагрузки (0..1)
// modulesPerCabinet, cabinetsCount — желаемая конфигурация
// dcWiring    — 'parallel' | 'series' | undefined (auto)
export function computeS3Configuration({
  module, loadKw, vdcMin, vdcMax,
  invEff = 0.96, cosPhi = 1,
  modulesPerCabinet, cabinetsCount, dcWiring,
}) {
  if (!isS3Module(module)) return null;
  const lim = getS3Limits(module);
  const w = resolveS3Wiring({ module, requestedWiring: dcWiring, vdcMin, vdcMax });
  // Clamp + вернуть hint если был clamp
  let N = Number(modulesPerCabinet);
  let C = Number(cabinetsCount);
  let clampHint = '';
  if (!N) N = lim.maxPerCabinet;
  if (!C) C = 1;
  if (N < 1) { N = 1; clampHint = `Клэмп ↑ до 1 (минимум модулей в шкафу)`; }
  else if (N > lim.maxPerCabinet) { N = lim.maxPerCabinet; clampHint = `Клэмп ↓ до ${lim.maxPerCabinet} (max модулей в шкафу)`; }
  C = Math.max(1, Math.min(lim.maxCabinets, C));
  const totalModules = N * C;
  // Power
  const activePowerKw = (loadKw || 0) * (cosPhi || 1);
  const batteryPwrReqKw = activePowerKw / Math.max(0.5, invEff || 0.96);
  const powerPerModuleW = totalModules > 0 ? (batteryPwrReqKw * 1000) / totalModules : 0;
  const stringCurrentA  = w.vdcOper > 0 ? (batteryPwrReqKw * 1000 / w.vdcOper) / Math.max(1, C) : 0;
  // v0.59.624: модель «номинал шкафа vs допустимая мощность по модулям».
  //   moduleRatedKw    — рейтинг 1 модуля = cabinetPowerKw / maxPerCabinet
  //                      (для S3C050-4C-20: 200/20 = 10 кВт/модуль)
  //   cabinetPowerKw   — паспортный номинал шкафа (System rated output, фикс)
  //   effCabinetPowerKw — реальная допустимая мощность шкафа = N × moduleRatedKw
  //                       (если шкаф не заполнен полностью — меньше паспорта)
  //   systemPowerKw     — суммарный паспорт = cabinetPowerKw × C
  //   effSystemPowerKw  — суммарная допустимая = effCabinetPowerKw × C
  //   overload — теперь по effSystemPowerKw, а не паспорту.
  const moduleRatedKw     = lim.maxPerCabinet > 0 ? lim.cabinetPowerKw / lim.maxPerCabinet : 0;
  const effCabinetPowerKw = N * moduleRatedKw;
  const systemPowerKw     = lim.cabinetPowerKw * C;        // паспорт
  const effSystemPowerKw  = effCabinetPowerKw * C;         // по факту модулей
  const overload = batteryPwrReqKw > effSystemPowerKw + 1e-6;
  const minCabinetsForLoad = effCabinetPowerKw > 0
    ? Math.max(1, Math.ceil(batteryPwrReqKw / effCabinetPowerKw))
    : (lim.cabinetPowerKw > 0
      ? Math.max(1, Math.ceil(batteryPwrReqKw / lim.cabinetPowerKw))
      : 0);
  // Energy
  const blockVnom = Number(module.blockVoltage) || 240;
  const capAh     = Number(module.capacityAh)   || 100;
  const cellsPerBlock = Number(module.cellCount) || 6;
  const totalKwh = (blockVnom * capAh * totalModules) / 1000;

  return {
    // wiring
    wiring: w.wiring,
    vdcOper: w.vdcOper,
    vSeries: w.vSeries, vParallel: w.vParallel,
    seriesOk: w.seriesOk, parallelOk: w.parallelOk,
    // counts
    modulesPerCabinet: N,
    cabinetsCount: C,
    totalModules,
    nMin: 1,
    nMax: lim.maxPerCabinet,
    cabinetsMax: lim.maxCabinets,
    clampHint,
    // power
    cabinetPowerKw: lim.cabinetPowerKw,           // паспорт
    moduleRatedKw,                                // рейтинг 1 модуля
    effCabinetPowerKw,                            // допустимая по модулям
    systemPowerKw,                                // паспорт × C
    effSystemPowerKw,                             // допустимая × C
    overload,
    minCabinetsForLoad,
    batteryPwrReqKw,
    powerPerModuleW,
    stringCurrentA,
    // energy
    totalKwh,
    // metadata
    blockVnom, capAh, cellsPerBlock,
    cabinetModel: lim.cabinetModel,
    cabinetKwh: lim.cabinetKwh,
    dcOutputV: lim.dcOutputV,
  };
}

// ---------- reverse mode ----------

// Подобрать минимум модулей и шкафов для заданной автономии.
// Использует переданный калькулятор автономии (calcAutonomyFn) — не
// импортирует его сам, чтобы избежать циклических зависимостей и
// разнотипных вызовов из разных модулей.
//
// Возвращает {ok:true, modulesPerCabinet, cabinetsCount, total,
// autonomyMin, target, limitedByPower} или {ok:false, reason}.
export function findMinimalS3Config({
  module, loadKw, requiredAutonomyMin, vdcMin, vdcMax,
  invEff = 0.96, cosPhi = 1, dcWiring,
  calcAutonomyFn,
}) {
  if (!isS3Module(module))   return { ok: false, reason: 'Не S³-модуль' };
  if (typeof calcAutonomyFn !== 'function') return { ok: false, reason: 'Не передан calcAutonomyFn' };
  const lim = getS3Limits(module);
  const w = resolveS3Wiring({ module, requestedWiring: dcWiring, vdcMin, vdcMax });
  const activePowerKw = (loadKw || 0) * (cosPhi || 1);
  const batteryPwrReqKw = activePowerKw / Math.max(0.5, invEff || 0.96);
  // v0.59.477: новый алгоритм — перебираем ОБЩЕЕ число модулей по
  // возрастанию, для каждого берём МИНИМАЛЬНОЕ число шкафов
  // (`ceil(total/maxPerCabinet)`). Раньше внешний цикл шёл по C, и
  // алгоритм находил первое решение с большим C и почти-пустыми шкафами
  // (например 3 × 12 вместо 2 × 20). Теперь шкафы автоматически
  // заполняются полностью прежде чем добавляется следующий.
  const maxTotal = lim.maxPerCabinet * lim.maxCabinets;
  // v0.59.480: дополнительный hard-constraint — мощность на модуль не
  // должна превышать паспортную (cabinetPowerKw / maxPerCabinet). Раньше
  // алгоритм возвращал «28 модулей» для 200 кВт×1.375/0.94=292 кВт ⇒
  // 10.45 кВт/модуль > rated 10 кВт. BMS перегружался.
  // Теперь минимум total = max(минимум по автономии, минимум по мощности).
  const moduleRatedKw = lim.cabinetPowerKw / Math.max(1, lim.maxPerCabinet);
  const minTotalByPower = Math.max(1, Math.ceil(batteryPwrReqKw / moduleRatedKw));
  for (let total = minTotalByPower; total <= maxTotal; total++) {
    const C = Math.max(1, Math.ceil(total / lim.maxPerCabinet));
    if (C > lim.maxCabinets) break;
    // Распределение модулей: первые (total mod C) шкафов получают +1.
    // Для autonomyFn используем strings=C, blocksPerString=ceil(total/C).
    // Реальная неравномерность ≤1 модуля — не влияет на autonomy расчёт
    // т.к. модули в S³ соединены в одну параллельную линию через combiner.
    const N = Math.ceil(total / C);
    const realTotal = N * C; // фактическое total ≥ запрошенного (округление)
    if (realTotal !== total) continue; // ищем точные совпадения для чистоты
    const r = calcAutonomyFn({
      battery: module,
      loadKw,
      dcVoltage: w.vdcOper,
      strings: C,
      blocksPerString: N,
      endV: 1.75,
      invEff,
      chemistry: module.chemistry,
      capacityAh: module.capacityAh,
    });
    const okAutonomy = Number.isFinite(r?.autonomyMin)
      ? r.autonomyMin >= requiredAutonomyMin
      : (r?.autonomyMin === Infinity);
    if (r && r.feasible && okAutonomy) {
      const reportedAutonomy = Number.isFinite(r.autonomyMin)
        ? r.autonomyMin
        : Math.max(requiredAutonomyMin * 2, 60);
      // limitedByPower — если total = ceil(power/moduleRated), то именно
      // паспортная мощность модуля диктует число модулей.
      const moduleRatedKw = lim.cabinetPowerKw / lim.maxPerCabinet;
      const minTotalByPower = Math.ceil(batteryPwrReqKw / moduleRatedKw);
      return {
        ok: true,
        modulesPerCabinet: N,
        cabinetsCount: C,
        total: realTotal,
        autonomyMin: reportedAutonomy,
        autonomyExceedsTable: !Number.isFinite(r.autonomyMin),
        target: requiredAutonomyMin,
        limitedByPower: total === minTotalByPower,
        wiring: w.wiring,
        vdcOper: w.vdcOper,
      };
    }
  }
  return { ok: false, reason: 'Не удалось достичь требуемой автономии в пределах лимитов системы.' };
}
