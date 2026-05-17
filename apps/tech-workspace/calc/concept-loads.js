// ======================================================================
// tech-workspace/calc/concept-loads.js
// Чистый расчётный слой Техзадания (без DOM): нагрузки и площади
// концепции ЦОД — IT-нагрузка, доступная мощность ИБП/холода,
// теплопритоки, требуемое питание, состав помещений.
// Все функции принимают объект концепции `c`; переиспользуемо:
// рендер карточек, отчёты, сравнение вариантов, тесты.
// ======================================================================

// Суммарная IT-нагрузка по rack-группам (network — не IT).
export function calcITTotal(c) {
  return (c.rackGroups || []).reduce((s, rg) => {
    if (rg.profile === 'network') return s;
    return s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
  }, 0);
}

export function calcRackGroupKw(rg) {
  return (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
}

export function calcMachroomArea(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  return Math.round(N * 2.5 * 1.4);
}

// Доступная активная мощность ИБП-системы с учётом резервирования.
export function _upsAvail(us) {
  const count = Number(us.count) || 0;
  const reserve = us.redundancy === 'N+1' ? 1 : (us.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  const kva = Number(us.ratedKva) || 0;
  const cos = Number(us.cosPhi) || 0.95;
  const lf = Number(us.loadFactor) || 0.8;
  return Math.round(N * kva * cos * lf * 10) / 10;
}

export function calcUpsByPurpose(c) {
  const out = { it: 0, cooling: 0, mixed: 0, total: 0 };
  for (const us of (c.upsSystems || [])) {
    const kw = _upsAvail(us);
    out[us.purpose || 'it'] = (out[us.purpose || 'it'] || 0) + kw;
    out.total += kw;
  }
  return out;
}

export function _coolAvail(cu) {
  const count = Number(cu.count) || 0;
  const reserve = cu.redundancy === 'N+1' ? 1 : (cu.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  return Math.round(N * (Number(cu.kwPerUnit) || 0) * 10) / 10;
}

export function calcCoolTotal(c) {
  return (c.coolingUnits || []).reduce((s, cu) => s + _coolAvail(cu), 0);
}

// v0.60.512: в лимит холода добавлены тепловыделения ИБП и прочие
// теплопритоки (ограждающие, кабельные линии, электрощиты). Коэффициенты —
// инженерные дефолты, переопределяются в c.coolingSystem.heatGains
// (user-params-sacred: ручные значения не затираются).
export const HEAT_DEFAULTS = {
  upsEff: 0.95,      // КПД ИБП (для расчёта тепловых потерь)
  wallWPerM2: 20,    // теплоприток через ограждающие, Вт/м² пола
  cablePctIT: 1.5,   // потери в силовых кабелях, % от IT (тепло в зале)
  panelPctIT: 2.0,   // тепловыделение электрощитов/РУ, % от IT
};

export function _heatCfg(c) {
  const hg = (c.coolingSystem && c.coolingSystem.heatGains) || {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
  return {
    upsEff: num(hg.upsEff, HEAT_DEFAULTS.upsEff),
    wallWPerM2: num(hg.wallWPerM2, HEAT_DEFAULTS.wallWPerM2),
    cablePctIT: num(hg.cablePctIT, HEAT_DEFAULTS.cablePctIT),
    panelPctIT: num(hg.panelPctIT, HEAT_DEFAULTS.panelPctIT),
  };
}

// Требуемая холодопроизводительность с разбивкой теплопритоков.
export function calcHeatLoad(c) {
  const itKw = calcITTotal(c);
  const cfg = _heatCfg(c);
  const eta = (cfg.upsEff > 0.5 && cfg.upsEff < 1) ? cfg.upsEff : 0.95;
  const upsKw = itKw * (1 / eta - 1);
  const areaM2 = (Array.isArray(c.rooms) ? c.rooms : [])
    .reduce((s, r) => s + (Number(r.areaSqM) || 0), 0);
  const wallKw = areaM2 > 0
    ? areaM2 * cfg.wallWPerM2 / 1000
    : itKw * 0.02;
  const cableKw = itKw * cfg.cablePctIT / 100;
  const panelKw = itKw * cfg.panelPctIT / 100;
  const totalKw = itKw + upsKw + wallKw + cableKw + panelKw;
  return {
    itKw, upsKw, wallKw, cableKw, panelKw, totalKw,
    areaM2, eta, cfg,
  };
}

export function calcFeedTotal(c) {
  const itTotal = calcITTotal(c);
  const climateLoss = itTotal * 0.3;
  const totalNeeded = itTotal + climateLoss;
  const tp = c.feed?.tp?.needed ? Number(c.feed.tp.kva) || 0 : 0;
  return Math.max(totalNeeded, tp * 0.8);
}

export function calcAreas(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  const upsCount = (c.upsSystems || []).reduce((s, us) => s + (Number(us.count) || 0), 0);
  const upsKvaTotal = (c.upsSystems || []).reduce((s, us) => s + (Number(us.ratedKva) || 0) * (Number(us.count) || 0), 0);
  const hasVrla = (c.upsSystems || []).some(us => us.batteryTech === 'vrla');
  const coolCount = (c.coolingUnits || []).reduce((s, cu) => s + (Number(cu.count) || 0), 0);
  const areas = [
    { name: 'Машзал (стойки)', m2: Math.max(20, Math.round(N * 2.5 * 1.4)) },
    { name: 'ИБП-зал', m2: Math.max(15, Math.round(upsCount * 4)) },
    { name: 'АКБ-зал (VRLA)', m2: hasVrla ? Math.max(10, Math.round(upsKvaTotal * 0.012)) : 0 },
    { name: 'Климат-зал', m2: Math.max(20, Math.round(coolCount * 6)) },
    { name: 'ТП', m2: c.feed.tp.needed ? Math.max(20, Math.round((Number(c.feed.tp.kva) || 0) * 0.025)) : 0 },
    { name: 'ДГУ-зал', m2: c.feed.dgu.needed ? Math.max(30, Math.round((Number(c.feed.dgu.kw) || 0) * 0.04)) : 0 },
    { name: 'Склад', m2: 15 },
    { name: 'Диспетчерская', m2: 12 },
  ].filter(a => a.m2 > 0);
  return areas;
}
