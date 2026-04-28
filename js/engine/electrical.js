// ================= Электротехнические расчёты =================

import { GLOBAL } from './constants.js';
import { effectiveLoadFactor } from './modes.js';
import { state } from './state.js';

// Обозначение класса напряжения кабеля по IEC 60502-2:
// U₀/U (Um) — фаза-земля / фаза-фаза / макс. рабочее.
// Возвращает строку типа "6/10 (12) кВ" для линий 10 кВ.
// Для LV (≤ 1 кВ) — "0.6/1 (1.2) кВ".
export function cableVoltageClass(U) {
  const ull = Number(U) || 0;
  // Таблица по стандартным рабочим напряжениям
  // [fromKv, U0Kv, UKv, UmKv]
  const table = [
    [0,     0.6,  1,    1.2],
    [1100,  3.6,  6,    7.2],
    [6500,  6,    10,   12],
    [11000, 8.7,  15,   17.5],
    [16000, 12,   20,   24],
    [22000, 18,   30,   36],
    [33000, 20.5, 35,   42],
    [42000, 26,   45,   52],
  ];
  let pick = table[0];
  for (const row of table) {
    if (ull >= row[0]) pick = row;
  }
  const fmt = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
  return `${fmt(pick[1])}/${fmt(pick[2])} (${fmt(pick[3])}) кВ`;
}

// Напряжение потребителя по фазе
// Возвращает межфазное напряжение (V_LL) для узла
export function nodeVoltage(n) {
  // Если задан voltageLevel — берём из справочника
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].vLL;
  }
  if (n.voltage) return Number(n.voltage);
  return ((n.phase || '3ph') === '3ph') ? GLOBAL.voltage3ph : GLOBAL.voltage1ph;
}

// Фазное напряжение (V_LN) для однофазных расчётов
export function nodeVoltageLN(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].vLN;
  }
  return ((n.phase || '3ph') === '3ph') ? GLOBAL.voltage1ph : GLOBAL.voltage1ph;
}

// v0.59.601: «расчётное» напряжение для подстановки в формулу тока
// I = P / (k × U × cos):
//   - 3-фазный узел  → vLL (линейное)
//   - 1-фазный узел  → vLN (фазное)
// Раньше во всех вызовах computeCurrentA передавали nodeVoltage(n) = vLL,
// и для 1-фазной нагрузки 7.2кВт получался ток 18.8А вместо 32.6А (делили
// на 400 вместо 230). Юзер: «однофазная нагрузка 7,2 кВт посчиталась
// как 18,8 А — проверь и исправь для всего модуля».
export function nodeCalcVoltage(n) {
  return isThreePhase(n) ? nodeVoltage(n) : nodeVoltageLN(n);
}

// Фазность: из n.phase, затем voltage level, затем дефолт 3ph.
// 3ph → true, 2ph/1ph/A/B/C → false (для расчёта тока и жил)
export function isThreePhase(n) {
  const ph = n.phase || '3ph';
  if (ph !== '3ph') return false;
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].phases === 3;
  }
  return true;
}

// ==========================================================================
// Жилы кабеля — централизованная логика
// ==========================================================================
// Модель: число жил кабеля складывается из фазности (из voltageLevel
// узла-цели) плюс флагов hasNeutral / hasGround. Флаги хранятся на
// узле (hasNeutral / hasGround, bool). Если флаг не задан — подставляется
// дефолт по системе заземления из GLOBAL.earthingSystem или
// panel.earthingOut (если источник — щит).
//
// Уровень напряжения теперь НЕ содержит wires; только vLL/vLN/phases/dc.
// ==========================================================================

// Дефолты hasNeutral/hasGround по системе заземления IEC 60364-4-41.
// Возвращает { hasNeutral, hasGround, pen } где pen=true означает что
// N и PE физически один провод (TN-C).
export function earthingDefaults(system = 'TN-S') {
  const sys = String(system || 'TN-S').toUpperCase();
  switch (sys) {
    case 'TN-C':   return { hasNeutral: true,  hasGround: true,  pen: true };
    case 'TN-C-S': return { hasNeutral: true,  hasGround: true,  pen: false };
    case 'TN-S':   return { hasNeutral: true,  hasGround: true,  pen: false };
    case 'TT':     return { hasNeutral: true,  hasGround: true,  pen: false };
    case 'IT-N':   return { hasNeutral: true,  hasGround: true,  pen: false };
    case 'IT':     return { hasNeutral: false, hasGround: true,  pen: false };
    default:       return { hasNeutral: true,  hasGround: true,  pen: false };
  }
}

// Определение эффективной системы заземления для кабеля, идущего ИЗ
// узла fromN. Для щита берём panel.earthingOut (если задан), иначе
// GLOBAL.earthingSystem.
export function effectiveEarthingOut(fromN) {
  if (fromN && fromN.type === 'panel' && fromN.earthingOut) return fromN.earthingOut;
  return GLOBAL.earthingSystem || 'TN-S';
}

// Эффективные флаги hasNeutral/hasGround/pen для целевого узла:
// 1) Если у узла явно заданы hasNeutral/hasGround — используем их
// 2) Иначе берём дефолты по системе заземления из fromN (или глобальной)
export function effectiveWireFlags(fromN, toN) {
  const sys = effectiveEarthingOut(fromN);
  const d = earthingDefaults(sys);
  const hasNeutral = (toN && typeof toN.hasNeutral === 'boolean') ? toN.hasNeutral : d.hasNeutral;
  const hasGround  = (toN && typeof toN.hasGround  === 'boolean') ? toN.hasGround  : d.hasGround;
  return { hasNeutral, hasGround, pen: d.pen && hasNeutral && hasGround };
}

// Количество жил кабеля из (phases, hasNeutral, hasGround, pen, dc, dcPoles).
// DC — dcPoles (2 или 3). AC: 3ph→3, 2ph→2, 1ph→1 + N/PE.
export function countWires({ phases, hasNeutral, hasGround, pen, dc, dcPoles }) {
  if (dc) return dcPoles || 2;
  const base = Number(phases) || 1;
  // PEN — N и PE на одном проводе
  if (pen && hasNeutral && hasGround) return base + 1;
  return base + (hasNeutral ? 1 : 0) + (hasGround ? 1 : 0);
}

// Главная функция — количество жил кабеля между fromN и toN.
// Приоритеты:
//   1. Ручное переопределение на связи (conn._wireCountManual)
//   2. Ручное переопределение на цели (toN.wireCount)
//   3. HV-кабели (conn._isHV или U > 1000 В на любом конце):
//      3 жилы (3 фазы без N/PE — стандарт MV/HV в сетях 6/10/35 кВ).
//      Броня заземляется отдельно и не учитывается в числе жил.
//   4. Авто: фазы из toN + hasNeutral/hasGround/pen (effectiveWireFlags)
export function cableWireCount(fromN, toN, conn) {
  if (conn && Number.isFinite(Number(conn._wireCountManual)) && Number(conn._wireCountManual) > 0) {
    return Number(conn._wireCountManual);
  }
  if (toN && Number.isFinite(Number(toN.wireCount)) && Number(toN.wireCount) > 0) {
    return Number(toN.wireCount);
  }
  // HV-признак: если conn уже рассчитан (_isHV в recalc), используем его —
  // он учитывает utility↔transformer направления. Иначе смотрим на оба
  // конца: если U > 1000 В хоть где-то (первичка или вторичка utility) — HV.
  const isHvByConn = conn && conn._isHV === true;
  const U_to = toN ? nodeVoltage(toN) : 0;
  const U_from = fromN ? nodeVoltage(fromN) : 0;
  if (isHvByConn || U_to >= 1000 || U_from >= 1000) {
    return 3;
  }
  // Определяем DC из voltageLevel целевого узла
  const levels = GLOBAL.voltageLevels || [];
  const lv = toN && typeof toN.voltageLevelIdx === 'number' ? levels[toN.voltageLevelIdx] : null;
  const dc = !!(lv && (lv.dc || (typeof lv.hz === 'number' && lv.hz === 0)));
  const dcPoles = dc && lv ? (Number(lv.dcPoles) || 2) : undefined;
  const ph = toN?.phase || '3ph';
  const phases = ph === '3ph' ? 3 : ph === '2ph' ? 2 : 1;
  const flags = effectiveWireFlags(fromN, toN);
  return countWires({ phases, dc, dcPoles, ...flags });
}

// Legacy-совместимость — nodeWireCount теперь просто оценивает по фазам
// и глобальным дефолтам. Новый код должен использовать cableWireCount.
export function nodeWireCount(n) {
  const levels = GLOBAL.voltageLevels || [];
  const lv = n && typeof n.voltageLevelIdx === 'number' ? levels[n.voltageLevelIdx] : null;
  if (lv && (lv.dc || (typeof lv.hz === 'number' && lv.hz === 0))) return 2;
  const phases = n && isThreePhase(n) ? 3 : 1;
  const sys = GLOBAL.earthingSystem || 'TN-S';
  const d = earthingDefaults(sys);
  return countWires({ phases, dc: false, hasNeutral: d.hasNeutral, hasGround: d.hasGround, pen: d.pen });
}

// Установочный ток — ток при номинальной мощности
// I = P / (√3 · U · cos φ)   для 3-фазной AC
// I = P / (U · cos φ)        для 1-фазной AC
// I = P / U                  для DC (cos φ и √3 не применяются)
export function computeCurrentA(P_kW, voltage, cosPhi, threePhase, dc) {
  const P = Number(P_kW) || 0;
  const U = Number(voltage) || 400;
  if (P <= 0 || U <= 0) return 0;
  if (dc) return (P * 1000) / U;
  const cos = Number(cosPhi) || 0.92;
  const k = threePhase ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * U * cos);
}

// Формирует чистый лейбл уровня напряжения ТОЛЬКО из значимых полей
// (vLL, phases, dc). Всё что относится к системе заземления и количеству
// жил (N, PE, +N+PE) отсюда исключено — это вычисляется отдельно через
// cableWireCount/effectiveWireFlags по системе заземления узла-источника.
//
// Формат метки уровня напряжения:
//   LV AC (<1kV):  '400/230 V 50 Hz'   — vLL/vLN + частота
//   HV AC (≥1kV):  '10 kV 50 Hz'       — только vLL + частота (vLN не показывается)
//   DC (hz=0):     '48 V DC'            — только напряжение + DC
export function formatVoltageLevelLabel(lv) {
  if (!lv) return '—';
  const vLL = Number(lv.vLL) || 0;
  const vLN = Number(lv.vLN) || 0;
  const hz = typeof lv.hz === 'number' ? lv.hz : 50;
  const isDC = lv.dc === true || hz === 0;
  const isHV = vLL >= 1000;
  const fmtV = (v) => isHV
    ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : v % 100 === 0 ? 1 : 3)
    : String(v);
  const unit = isHV ? 'kV' : 'V';
  // DC: напряжение + полюса если >2
  if (isDC) {
    const poles = Number(lv.dcPoles) || 2;
    return poles > 2 ? `±${fmtV(vLL / 2)} ${unit} DC` : `${fmtV(vLL)} ${unit} DC`;
  }
  // HV AC: без vLN (на среднем/высоком напряжении vLN не используется)
  if (isHV) return `${fmtV(vLL)} ${unit} ${hz} Hz`;
  // LV AC: vLL/vLN
  const voltPart = vLN && vLN !== vLL ? `${fmtV(vLL)}/${fmtV(vLN)}` : `${fmtV(vLL)}`;
  return `${voltPart} ${unit} ${hz} Hz`;
}

// Миграция уровней напряжения: удаляет устаревшие поля (label, phases),
// конвертирует dc:true → hz:0, добавляет hz:50 по умолчанию для AC.
export function migrateVoltageLevels(levels) {
  if (!Array.isArray(levels)) return;
  for (const lv of levels) {
    if (!lv) continue;
    if ('label' in lv) delete lv.label;
    // dc:true → hz:0
    if (lv.dc && (lv.hz === undefined || lv.hz === null)) lv.hz = 0;
    delete lv.dc;
    if (typeof lv.hz !== 'number') lv.hz = 50;
    // Fix: hz=0 с vLL≠vLN — это AC
    if (lv.hz === 0 && lv.vLL !== lv.vLN) lv.hz = 50;
    // phases по умолчанию: DC→1, AC→3
    if (typeof lv.phases !== 'number') lv.phases = (lv.hz === 0) ? 1 : 3;
    // category по умолчанию — автоопределение по vLL/hz
    if (!lv.category || !['lv','mv','hv','dc'].includes(lv.category)) {
      if (lv.hz === 0) lv.category = 'dc';
      else if (lv.vLL > 35000) lv.category = 'hv';
      else if (lv.vLL >= 1000) lv.category = 'mv';
      else lv.category = 'lv';
    }
  }
  // Удаляем legacy 230/230 1ph — его напряжение есть в 400/230 как vLN
  const idx230 = levels.findIndex(lv => lv.vLL === 230 && lv.vLN === 230 && lv.hz !== 0);
  if (idx230 >= 0) levels.splice(idx230, 1);
}

// DC-детектор для узла по его voltageLevel (hz === 0 означает DC)
export function isNodeDC(n) {
  if (!n) return false;
  const levels = GLOBAL.voltageLevels || [];
  const lv = typeof n.voltageLevelIdx === 'number' ? levels[n.voltageLevelIdx] : null;
  if (!lv) return false;
  return lv.dc === true || (typeof lv.hz === 'number' && lv.hz === 0);
}

// v0.57.81: суммарная установленная мощность группы/одиночного
// потребителя. Учитывает новый режим groupMode='individual' — когда
// у группы неоднородные приборы, мощности задаются поштучно в
// n.items = [{name, demandKw}, …]. Для uniform (по умолчанию) —
// старая формула demandKw × count.
export function consumerTotalDemandKw(n) {
  if (n && n.groupMode === 'individual' && Array.isArray(n.items)) {
    let sum = 0;
    for (const it of n.items) sum += Number(it?.demandKw) || 0;
    return sum;
  }
  const per = Number(n?.demandKw) || 0;
  const cnt = Math.max(1, Number(n?.count) || 1);
  return per * cnt;
}

// Количество приборов в группе — для individual берётся длина items.
export function consumerCountEffective(n) {
  if (n && n.groupMode === 'individual' && Array.isArray(n.items)) {
    return Math.max(1, n.items.length);
  }
  return Math.max(1, Number(n?.count) || 1);
}

// v0.59.91: группа как «оболочка» над членами. Возвращает массив
// объектов-псевдопотребителей, каждый с полным набором параметров
// (поля, не заданные в item, унаследованы из родителя). Используется
// BOM / panel-wizard'ом, чтобы каждый прибор группы давал свою линию
// и свой автомат с нужной кривой/запасом.
export function consumerGroupItems(n) {
  if (!n || n.groupMode !== 'individual' || !Array.isArray(n.items)) return [];
  return n.items.map((it, i) => ({
    name:             it?.name || `Прибор ${i + 1}`,
    demandKw:         Number(it?.demandKw) || 0,
    voltageLevelIdx:  Number.isFinite(+it?.voltageLevelIdx) ? +it.voltageLevelIdx
                       : (Number.isFinite(+n.voltageLevelIdx) ? +n.voltageLevelIdx : 0),
    phase:            it?.phase || n.phase || '3ph',
    cosPhi:           (it?.cosPhi != null && it.cosPhi !== '') ? Number(it.cosPhi) : Number(n.cosPhi ?? 0.92),
    kUse:             (it?.kUse   != null && it.kUse   !== '') ? Number(it.kUse)   : Number(n.kUse ?? 1),
    inrushFactor:     (it?.inrushFactor != null && it.inrushFactor !== '') ? Number(it.inrushFactor) : Number(n.inrushFactor ?? 1),
    curveHint:        it?.curveHint || n.curveHint || '',
    breakerMarginPct: (typeof it?.breakerMarginPct === 'number') ? it.breakerMarginPct
                       : (typeof n.breakerMarginPct === 'number' ? n.breakerMarginPct : null),
  }));
}

// Номинальный (установочный) ток потребителя или группы.
// v0.59.95: для individual-группы суммируем токи по каждому прибору со
// своим cos φ — раньше использовался общий n.cosPhi и завышал/занижал
// ток при смешанных нагрузках (двигатель 0.85 + освещение 1.0).
export function consumerNominalCurrent(n) {
  // v0.59.601: для 1-фазной нагрузки U = vLN (а не vLL) — иначе ток
  // занижается в √3 раз (для систем 400/230 это даёт 18.8А вместо 32.6А
  // для 7.2кВт). См. nodeCalcVoltage.
  const ph3 = isThreePhase(n);
  const U = nodeCalcVoltage(n);
  const dc = isNodeDC(n);
  if (n && n.groupMode === 'individual' && Array.isArray(n.items) && n.items.length > 0) {
    const members = consumerGroupItems(n);
    let I = 0;
    for (const m of members) I += computeCurrentA(m.demandKw, U, m.cosPhi, ph3, dc);
    return I;
  }
  return computeCurrentA(consumerTotalDemandKw(n), U, n.cosPhi, ph3, dc);
}

// Расчётный ток (с учётом Ки и loadFactor сценария).
// v0.59.95: для individual-группы применяется Ки и cos φ каждого прибора
// индивидуально (с фолбэком на группу), а не общий n.kUse на всю группу.
export function consumerRatedCurrent(n) {
  // v0.59.601: см. consumerNominalCurrent — U = vLN для 1-фазной нагрузки.
  const ph3 = isThreePhase(n);
  const U = nodeCalcVoltage(n);
  const dc = isNodeDC(n);
  const lf = effectiveLoadFactor(n);
  if (n && n.groupMode === 'individual' && Array.isArray(n.items) && n.items.length > 0) {
    const members = consumerGroupItems(n);
    let I = 0;
    for (const m of members) {
      const P = m.demandKw * (Number(m.kUse) || 1) * lf;
      I += computeCurrentA(P, U, m.cosPhi, ph3, dc);
    }
    return I;
  }
  const P = consumerTotalDemandKw(n) * (Number(n.kUse) || 1) * lf;
  return computeCurrentA(P, U, n.cosPhi, ph3, dc);
}

// Пусковой ток.
// v0.59.94: для group individual считаем по сценарию «ступенчатый пуск»:
// все прочие приборы работают в номинале, один (самый тяжёлый) стартует
// со своим inrushFactor. Пик тока = Σ I_nom_i + (inrush_max - 1) × I_nom_max.
// Это даёт более реалистичную оценку, чем flat n.inrushFactor на всю группу
// (который нередко завышал пиковый ток, если у членов разные кратности пуска).
export function consumerInrushCurrent(n) {
  if (n && n.groupMode === 'individual' && Array.isArray(n.items) && n.items.length > 0) {
    const members = consumerGroupItems(n);
    // v0.59.601: U = vLN для 1-фазной (см. consumerNominalCurrent).
    const ph3 = isThreePhase(n);
    const U = nodeCalcVoltage(n);
    const dc = isNodeDC(n);
    let sumInom = 0;
    let maxDelta = 0;
    for (const m of members) {
      const Inom = computeCurrentA(m.demandKw, U, m.cosPhi, ph3, dc);
      sumInom += Inom;
      const delta = Inom * (Math.max(1, Number(m.inrushFactor) || 1) - 1);
      if (delta > maxDelta) maxDelta = delta;
    }
    return sumInom + maxDelta;
  }
  return consumerNominalCurrent(n) * (Number(n.inrushFactor) || 1);
}

// v0.59.605 (Phase 18): эффективная capacity ИБП с учётом HVAC-derate.
// v0.59.607: РЕФАКТОРИНГ — derate применяется НЕ ко всей capacity, а только
// к механической части нагрузки. Юзер: «коэффициент нужно применять не для
// всей нагрузки а только для механической нагрузки».
//
// Модель:
//   capacity ИБП — фиксированная, не уменьшается.
//   load_effective = Σ P_IT × 1 + Σ P_HVAC / derateFactor
//                  = всё IT с весом 1 + механическая часть с весом 1/derate.
//   overload = (load_effective > capacity).
//
// Пример: ИБП 100кВт + IT 60кВт + HVAC 30кВт + derate 0.7
//   load_effective = 60 + 30/0.7 = 60 + 42.86 = 102.86 kW
//   102.86 > 100 → overload (на 3%).
// Раньше: capacity_eff = 100 × 0.7 = 70, load = 90. 90 > 70 → overload (на 22%).
//
// Поля на узле UPS (v0.59.620):
//   n.crfActive: boolean — пользователь явно включил Capacity Reservation
//   n.crfMap: { subtypeId: factor } — К_рез per-subtype
// Legacy (до v0.59.620, читаются как fallback):
//   n.hvacDerateActive, n.hvacDerateMap, n.hvacDerateFactor
//
// Default factor по производителю (если active=true и factor не задан):
const HVAC_DERATE_DEFAULTS = {
  'Kehua':     0.70,
  'APC':       0.80,
  'Eaton':     0.80,
  'Schneider': 0.80,
  'Vertiv':    0.80,
  'GE':        0.75,
  '_default':  0.85,
};
export function upsHvacDerateFactor(n) {
  if (!n) return 1.0;
  const active = n.crfActive !== undefined ? !!n.crfActive : !!n.hvacDerateActive;
  if (!active) return 1.0;
  let factor = Number(n.hvacDerateFactor);
  if (!Number.isFinite(factor) || factor <= 0) {
    const vendor = String(n.manufacturer || '').trim();
    factor = HVAC_DERATE_DEFAULTS[vendor] != null
      ? HVAC_DERATE_DEFAULTS[vendor]
      : HVAC_DERATE_DEFAULTS._default;
  }
  return Math.max(0.3, Math.min(1.0, factor));
}
// Backward-compat: устаревший helper. Возвращает n.capacityKw — ИБП сохраняет
// номинальную мощность независимо от типа нагрузки. Перегруз определяется
// по weighted-load, см. recalc.js (n._loadKwWeighted).
export function effectiveUpsCapacity(n) {
  return Number(n && n.capacityKw) || 0;
}

// Мощность заряда ИБП по току в А (переход с chargeA на кВт для учёта в нагрузке)
export function upsChargeKw(ups) {
  if (typeof ups.chargeKw === 'number' && !('chargeA' in ups)) return Number(ups.chargeKw) || 0;
  const I = Number(ups.chargeA) || 0;
  const U = Number(ups.voltage) || ((ups.phase === '3ph') ? 400 : 230);
  const k = ((ups.phase || '3ph') === '3ph') ? Math.sqrt(3) : 1;
  // cos φ зарядного = 1 (ориентировочно)
  return (I * U * k) / 1000;
}

// Вычисление полного сопротивления источника (Ом) по IEC 60909
export function sourceImpedance(n) {
  const U = nodeVoltage(n);
  const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');

  // Utility (городская сеть / ЛЭП) — source с подтипом 'utility'.
  // Импеданс на стороне её собственного напряжения (обычно HV). Приоритет Ik.
  if (n.type === 'source' && subtype === 'utility') {
    const ikA = (Number(n.ikKA) || 0) * 1000;
    if (ikA > 0) return U / (Math.sqrt(3) * ikA);
    const Ssc = (Number(n.sscMva) || 0) * 1e6;
    if (Ssc > 0) return (U * U) / Ssc;
    return 1e-6;
  }

  // Прочий источник — как раньше.
  if (subtype === 'other') {
    const ikA = (Number(n.ikKA) || 0) * 1000;
    if (ikA > 0) return U / (Math.sqrt(3) * ikA);
    const Ssc = (Number(n.sscMva) || 0) * 1e6;
    if (Ssc > 0) return (U * U) / Ssc;
    return 0.05;
  }

  // Трансформатор: Zs_total = Zt (собственный) + Z_upstream (приведённая
  // от первичной к вторичной стороне).
  // Если на входе трансформатора есть utility — приводим её Zs с HV к LV
  // по квадрату коэффициента трансформации.
  if (n.type === 'source' && subtype === 'transformer') {
    const Snom = (Number(n.snomKva) || 400) * 1000;
    const Uk = Number(n.ukPct) || 0;
    const Zt = Uk > 0 ? (Uk / 100) * (U * U) / Snom : 0; // на стороне LV

    // Найти upstream utility через state.conns
    let Zup = 0;
    for (const c of state.conns.values()) {
      if (c.to?.nodeId !== n.id) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      const up = state.nodes.get(c.from.nodeId);
      if (up && up.type === 'source' && up.sourceSubtype === 'utility') {
        const Zup_hv = sourceImpedance(up); // на HV стороне
        const levels = GLOBAL.voltageLevels || [];
        const priIdx = typeof n.inputVoltageLevelIdx === 'number' ? n.inputVoltageLevelIdx : 3;
        const Uprim = (levels[priIdx] && levels[priIdx].vLL) || 10000;
        const Usec = U;
        // Приведение к вторичной стороне: Z' = Z × (Usec/Uprim)²
        const ratio = Usec / Uprim;
        Zup = Zup_hv * ratio * ratio;
        break;
      }
    }
    if (Zup === 0) {
      // Fallback: старая модель с sscMva (если utility не подключена)
      const Ssc = (Number(n.sscMva) || 500) * 1e6;
      Zup = (U * U) / Ssc;
    }
    return Zup + Zt;
  }

  // Generator
  const Ssc = (Number(n.sscMva) || 500) * 1e6;
  const Zq = (U * U) / Ssc;
  const Snom = (Number(n.snomKva) || 400) * 1000;
  const isGen = n.type === 'generator' || (subtype === 'generator');
  if (isGen) {
    const xdpp = Number(n.xdpp) || 0.15;
    const Zg = xdpp * (U * U) / Snom;
    return Zq + Zg;
  }
  return Zq;
}
