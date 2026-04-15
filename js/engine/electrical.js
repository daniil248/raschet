// ================= Электротехнические расчёты =================

import { GLOBAL } from './constants.js';
import { effectiveLoadFactor } from './modes.js';
import { state } from './state.js';

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
  const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');

  // Utility (городская сеть / ЛЭП) — импеданс на стороне её собственного
  // напряжения (обычно HV). Приоритет у Ik (IEC 60909).
  if (n.type === 'utility') {
    const ikA = (Number(n.ikKA) || 0) * 1000;
    if (ikA > 0) return (1.1 * U) / (Math.sqrt(3) * ikA);
    const Ssc = (Number(n.sscMva) || 0) * 1e6;
    if (Ssc > 0) return (U * U) / Ssc;
    return 1e-6;
  }

  // Прочий источник — как раньше.
  if (subtype === 'other') {
    const ikA = (Number(n.ikKA) || 0) * 1000;
    if (ikA > 0) return (1.1 * U) / (Math.sqrt(3) * ikA);
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
      if (up && up.type === 'utility') {
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
