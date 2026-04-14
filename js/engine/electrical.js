// ================= Электротехнические расчёты =================

import { GLOBAL } from './constants.js';
import { effectiveLoadFactor } from './modes.js';

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

export function isThreePhase(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].phases === 3;
  }
  return (n.phase || '3ph') === '3ph';
}

// Число проводов (жил) в кабеле для данного узла
export function nodeWireCount(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].wires;
  }
  return isThreePhase(n) ? 5 : 3;
}

// Установочный ток — ток при номинальной мощности
// I = P / (√3 · U · cos φ)   для 3-фазной
// I = P / (U · cos φ)        для 1-фазной (A/B/C)
export function computeCurrentA(P_kW, voltage, cosPhi, threePhase) {
  const P = Number(P_kW) || 0;
  const U = Number(voltage) || 400;
  const cos = Number(cosPhi) || 0.92;
  if (P <= 0) return 0;
  const k = threePhase ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * U * cos);
}

// Номинальный (установочный) ток потребителя или группы
export function consumerNominalCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const P = per * cnt;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}

// Расчётный ток (с учётом Ки и loadFactor сценария)
export function consumerRatedCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
  const P = per * cnt * k;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}

// Пусковой ток
export function consumerInrushCurrent(n) {
  return consumerNominalCurrent(n) * (Number(n.inrushFactor) || 1);
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
  const Ssc = (Number(n.sscMva) || 500) * 1e6; // ВА
  // Zq = U² / Ssc — импеданс питающей сети
  const Zq = (U * U) / Ssc;
  const Snom = (Number(n.snomKva) || 400) * 1000;
  const isGen = n.type === 'generator' || (n.sourceSubtype === 'generator');
  if (isGen) {
    // Zg = Xd'' × U² / Snom — сверхпереходный импеданс генератора
    const xdpp = Number(n.xdpp) || 0.15;
    const Zg = xdpp * (U * U) / Snom;
    return Zq + Zg;
  }
  // Zt = Uk% × U² / (100 × Snom) — импеданс трансформатора
  const Uk = Number(n.ukPct) || 0;
  const Zt = Uk > 0 ? (Uk / 100) * (U * U) / Snom : 0;
  return Zq + Zt; // Ом (упрощённая сумма)
}
