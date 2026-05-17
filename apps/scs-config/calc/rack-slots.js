// ======================================================================
// scs-config/calc/rack-slots.js
// Чистый расчётный слой Конфигуратора СКС (без DOM): геометрия U-слотов
// стойки — занятость, свободные интервалы, поиск свободного места,
// проверка размещения. catalog передаётся параметром (resolver typeId→type).
// Переиспользуемо: автопак, drag-drop валидация, отчёты, тесты.
// ======================================================================

// Число занятых U (стойкой сверху + устройства, обе стороны монтажа).
export function computeOccupiedU(catalog, r, devices) {
  if (!r) return 0;
  const occ = new Array(r.u + 1).fill(false);
  for (let u = r.u; u > r.u - (r.occupied || 0); u--) occ[u] = true;
  (devices || []).forEach(d => {
    const type = catalog.find(c => c.id === d.typeId);
    const uh = type ? Math.max(1, Number(type.u) || 1) : 1;
    const top = Number(d.u) || 0;
    if (!top) return;
    for (let i = 0; i < uh; i++) {
      const uu = top + i;
      if (uu >= 1 && uu <= r.u) occ[uu] = true;
    }
  });
  let c = 0;
  for (let u = 1; u <= r.u; u++) if (occ[u]) c++;
  return c;
}

// Свободные U-интервалы сверху вниз → ["U42–U30", "U10", ...].
export function freeURanges(catalog, r, devices) {
  if (!r) return [];
  const occ = new Array(r.u + 1).fill(false);
  for (let u = r.u; u > r.u - (r.occupied || 0); u--) occ[u] = true;
  devices.forEach(d => {
    const type = catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) {
      const u = d.positionU - k;
      if (u >= 1 && u <= r.u) occ[u] = true;
    }
  });
  const ranges = [];
  let start = null;
  for (let u = r.u; u >= 1; u--) {
    if (!occ[u]) { if (start == null) start = u; }
    else if (start != null) { ranges.push([start, u + 1]); start = null; }
  }
  if (start != null) ranges.push([start, 1]);
  return ranges.map(([a, b]) => a === b ? `U${a}` : `U${a}–U${b}`);
}

// Первый свободный блок высотой heightU сверху вниз для стороны side.
export function findFirstFreeSlot(catalog, r, devices, heightU, side) {
  const occupiedTop = Number(r.occupied) || 0;
  const heightUSafe = Math.max(1, Number(heightU) || 1);
  const targetSide = side || 'front';
  const occ = new Array(r.u + 1).fill(false);
  for (let u = r.u; u > r.u - occupiedTop; u--) occ[u] = true;
  devices.forEach(d => {
    if ((d.mountSide || 'front') !== targetSide) return;
    const type = catalog.find(c => c.id === d.typeId);
    const h = type ? type.heightU : 1;
    for (let k = 0; k < h; k++) occ[d.positionU - k] = true;
  });
  for (let top = r.u - occupiedTop; top >= heightUSafe; top--) {
    let ok = true;
    for (let k = 0; k < heightUSafe; k++) if (occ[top - k]) { ok = false; break; }
    if (ok) return top;
  }
  return 1;
}

// Можно ли разместить устройство высотой heightU верхом на wantU.
export function canPlace(catalog, r, devices, excludeDevId, heightU, wantU, side) {
  if (wantU < heightU || wantU > r.u) return false;
  const targetSide = side || 'front';
  for (const d of devices) {
    if (d.id === excludeDevId) continue;
    if ((d.mountSide || 'front') !== targetSide) continue;
    const t = catalog.find(c => c.id === d.typeId);
    const dh = t ? t.heightU : 1;
    for (let k = 0; k < heightU; k++) {
      const myU = wantU - k;
      for (let j = 0; j < dh; j++) {
        if (myU === d.positionU - j) return false;
      }
    }
  }
  return true;
}

// Ближайший к wantU свободный слот (сначала вверх, потом вниз).
export function findNearestFreeSlot(catalog, r, devices, heightU, wantU, side) {
  const okAt = (u) => canPlace(catalog, r, devices, null, heightU, u, side);
  if (okAt(wantU)) return wantU;
  for (let delta = 1; delta <= r.u; delta++) {
    const up = wantU + delta;
    if (up <= r.u && okAt(up)) return up;
    const dn = wantU - delta;
    if (dn >= heightU && okAt(dn)) return dn;
  }
  return null;
}
