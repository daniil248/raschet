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
  // System power limit (паспорт System rated output power × C)
  const systemPowerKw = lim.cabinetPowerKw * C;
  const overload = batteryPwrReqKw > systemPowerKw + 1e-6;
  const minCabinetsForLoad = lim.cabinetPowerKw > 0
    ? Math.max(1, Math.ceil(batteryPwrReqKw / lim.cabinetPowerKw))
    : 0;
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
    cabinetPowerKw: lim.cabinetPowerKw,
    systemPowerKw,
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
  const minCByPower = Math.max(1, Math.ceil(batteryPwrReqKw / lim.cabinetPowerKw));
  if (minCByPower > lim.maxCabinets) {
    return { ok: false, reason: `Нагрузка ${batteryPwrReqKw.toFixed(1)} кВт требует ${minCByPower} шкафов, но лимит ${lim.maxCabinets}.` };
  }
  // Перебор: C от minByPower вверх, для каждого N от 1 до maxPerCabinet
  for (let C = minCByPower; C <= lim.maxCabinets; C++) {
    for (let N = 1; N <= lim.maxPerCabinet; N++) {
      const r = calcAutonomyFn({
        battery: module,
        loadKw,
        dcVoltage: w.vdcOper,
        strings: C,
        blocksPerString: N,
        endV: 1.75,                  // for Li-ion table-driven игнорируется
        invEff,
        chemistry: module.chemistry,
        capacityAh: module.capacityAh,
      });
      // v0.59.447 fix: Infinity = «мощность ниже нижней точки таблицы»,
      // что означает «автономия гарантированно превышает все табличные
      // значения» (например, для S3M040 при ≤5 кВт/модуль — точно ≥20 мин).
      // Раньше Number.isFinite(Infinity)===false → конфигурация отклонялась
      // и Раcчёт говорил «не удалось подобрать», хотя на самом деле модули
      // выдают нагрузку с большим запасом.
      const okAutonomy = Number.isFinite(r?.autonomyMin)
        ? r.autonomyMin >= requiredAutonomyMin
        : (r?.autonomyMin === Infinity);
      if (r && r.feasible && okAutonomy) {
        // v0.59.447: если autonomyMin = Infinity (мощность ниже нижней
        // точки таблицы — гарантированно ≥ longest tMin), даём верхнюю
        // оценку «target × 2», чтобы UI не показывал ∞.
        const reportedAutonomy = Number.isFinite(r.autonomyMin)
          ? r.autonomyMin
          : Math.max(requiredAutonomyMin * 2, 60);
        return {
          ok: true,
          modulesPerCabinet: N,
          cabinetsCount: C,
          total: N * C,
          autonomyMin: reportedAutonomy,
          autonomyExceedsTable: !Number.isFinite(r.autonomyMin),
          target: requiredAutonomyMin,
          limitedByPower: C === minCByPower,
          wiring: w.wiring,
          vdcOper: w.vdcOper,
        };
      }
    }
  }
  return { ok: false, reason: 'Не удалось достичь требуемой автономии в пределах лимитов системы.' };
}
