// =========================================================================
// Реестр методик расчёта экономической плотности тока
// =========================================================================

import pue from './pue.js';
import iec from './iec.js';
import bs7671 from './bs7671.js';

export const ECO_METHODS = { pue_eco: pue, iec_eco: iec, bs7671_eco: bs7671 };

export function getEcoMethod(id) {
  return ECO_METHODS[id] || ECO_METHODS.pue_eco;
}

export function listEcoMethods() {
  return Object.values(ECO_METHODS)
    .filter(m => !m.placeholder)
    .map(m => ({ id: m.id, label: m.label }));
}
