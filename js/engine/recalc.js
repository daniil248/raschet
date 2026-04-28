import { state } from './state.js';
import { GLOBAL, CHANNEL_TYPES, BUSBAR_SERIES, BREAKER_SERIES, INSTALL_METHODS, BREAKER_TYPES, autoBreakerMargin, autoBreakerCurve, autoUpsBreakerNominals } from './constants.js';
import { selectCableSize, selectBreaker, selectFuse, kTempLookup, kGroupLookup, kBundlingFactor, kBundlingIgnoresGrouping, cableTable, hvCableTable, selectHvBreaker } from './cable.js';
import { getMethod, calcVoltageDrop, findMinSizeForVdrop } from '../methods/index.js';
import { getEcoMethod } from '../methods/economic/index.js';
import { nodeVoltage, nodeVoltageLN, nodeCalcVoltage, isThreePhase, nodeWireCount, cableWireCount, computeCurrentA,
         consumerNominalCurrent, consumerRatedCurrent, consumerInrushCurrent,
         consumerTotalDemandKw, consumerCountEffective, consumerGroupItems,
         upsChargeKw, sourceImpedance, isNodeDC, effectiveUpsCapacity, upsHvacDerateFactor } from './electrical.js';
import { CONSUMER_CATALOG } from './constants.js';

// v0.59.610: per-category / per-subtype derate map.
// Юзер: «выведем в характеристиках ибп список всех категорий и подтипов
// и для каждой записи вводить коэффициент дирейтинга».
//
// Модель n.hvacDerateMap:
//   { 'cat:hvac': 0.70, 'cat:power': 0.85, 'sub:conditioner': 0.65, ... }
// Lookup для консьюмера:
//   1. n.hvacDerateMap['sub:' + consumerSubtype]  (override per-subtype)
//   2. n.hvacDerateMap['cat:' + category]         (per-category)
//   3. 1.0 (no derate)
// Если n.hvacDerateActive===false → всегда 1.0.
//
// Defaults (когда map пустой и derate active):
const HVAC_DEFAULT_DERATE = {
  'cat:hvac': 0.70,
  'sub:motor': 0.70,
  'sub:pump': 0.70,
  'sub:fan': 0.70,
  'sub:conditioner': 0.70,
  'sub:elevator': 0.70,
  'sub:outdoor_unit': 0.70,
};
function _consumerCategory(n) {
  const sub = n.consumerSubtype || n.consumerType || '';
  if (sub) {
    const cat = CONSUMER_CATALOG.find(x => x && x.id === sub);
    if (cat) return cat.category;
  }
  return n.subtype || 'other';
}
function _resolveDerate(consumer, upsNode) {
  if (!upsNode || !upsNode.hvacDerateActive) return 1.0;
  const map = (upsNode.hvacDerateMap && typeof upsNode.hvacDerateMap === 'object')
    ? upsNode.hvacDerateMap : {};
  const usedMap = Object.keys(map).length ? map : HVAC_DEFAULT_DERATE;
  const sub = consumer.consumerSubtype || consumer.consumerType || '';
  if (sub) {
    const v = Number(usedMap['sub:' + sub]);
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  }
  const cat = _consumerCategory(consumer);
  if (cat) {
    const v = Number(usedMap['cat:' + cat]);
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  }
  return 1.0;
}
function _isDerated(consumer, upsNode) {
  return _resolveDerate(consumer, upsNode) < 0.999;
}
// Возвращает weighted-нагрузку ИБП с учётом HVAC-derate.
// IT-часть считается 1×, механическая часть — 1/derate.
// Если derate не активен — возвращает обычную сумму (=Σ всех загрузок).
// v0.59.608: ВСЕГДА заполняет _loadKwIT / _loadKwHVAC на узле, даже когда
// derate не активен — чтобы UI показывал breakdown.
// v0.59.610: weighted load с per-consumer derate.
// ВАЖНО (юзер 2026-04-28): эти коэффициенты влияют ТОЛЬКО на проверку
// перегруза самого ИБП. Upstream-цепочка (utility / panel / источник)
// НЕ видит derate — она получает n._loadKw (физическая нагрузка) и
// n._inputKw (с КПД, но без derate). Сам ИБП тоже не пропускает derate
// другим ИБП в цепочке: BFS через `next.type === 'ups'` continue.
function _computeUpsWeightedLoad(upsNode) {
  if (!upsNode || upsNode.type !== 'ups') return 0;
  let totalIT = 0, totalHVAC = 0;
  let weightedTotal = 0;
  const hvacLoads = []; // {id, label, P, Peff, sub, cat, derate}
  const itLoads = [];   // {id, label, P, Peff, sub, cat, derate}
  const visited = new Set([upsNode.id]);
  const queue = [upsNode.id];
  while (queue.length) {
    const id = queue.shift();
    for (const c of state.conns.values()) {
      if (c.from?.nodeId !== id) continue;
      if (c._state === 'damaged' || c._state === 'disabled' || c._state === 'dead') continue;
      const next = state.nodes.get(c.to?.nodeId);
      if (!next || visited.has(next.id)) continue;
      visited.add(next.id);
      if (next.type === 'ups' && next.id !== upsNode.id) continue;
      if (next.type === 'consumer') {
        const Pphys = (Number(next._loadKw) || 0)
          || (consumerTotalDemandKw(next) * (Number(next.kUse) || 1) * effectiveLoadFactor(next));
        const sub = next.consumerSubtype || next.consumerType || '';
        const cat = _consumerCategory(next);
        const label = next.name || next.tag || sub || next.id;
        const derate = _resolveDerate(next, upsNode);
        const Peff = derate > 0 ? Pphys / derate : Pphys;
        weightedTotal += Peff;
        const entry = { id: next.id, label, P: Pphys, Peff, sub, cat, derate };
        if (derate < 0.999) {
          totalHVAC += Pphys;
          hvacLoads.push(entry);
        } else {
          totalIT += Pphys;
          itLoads.push(entry);
        }
      }
      queue.push(next.id);
    }
  }
  upsNode._loadKwIT = totalIT;
  upsNode._loadKwHVAC = totalHVAC;
  upsNode._hvacLoads = hvacLoads;
  upsNode._itLoads = itLoads;
  return weightedTotal;
}
import { effectiveOn, effectiveLoadFactor } from './modes.js';
import { runModules as runCalcModules } from '../../shared/calc-modules/index.js';

// Полная downstream-нагрузка за узлом (без share, без visited-блокировок).
// Считает суммарную мощность ВСЕХ уникальных потребителей за данным узлом.
// Используется для определения реальной нагрузки за конкретным UPS:
//   UPS → UDB (parallel) → потребители = ПОЛНАЯ нагрузка UDB, а не 1/N,
//   потому что если этот UPS единственный активный — он несёт всё.
function simpleDownstream(nodeId) {
  const seen = new Set();
  function walk(nid) {
    if (seen.has(nid)) return 0;
    seen.add(nid);
    let total = 0;
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== nid) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;
      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        total += per * cnt;
      } else if (to.type === 'ups') {
        const capKw = Number(to.capacityKw) || 0;
        const down = walk(to.id);
        total += Math.min(capKw, down);
      } else if (to.type === 'generator' && to.auxInput && c.to.port === 0) {
        // auxInput ДГУ — только собственные нужды
        total += Number(to.auxDemandKw) || 0;
      } else if (to.type === 'panel' || to.type === 'channel' || to.type === 'junction-box') {
        // БЕЗ share — считаем полную нагрузку. Junction-box — passthrough.
        total += walk(to.id);
      }
    }
    return total;
  }
  return walk(nodeId);
}

// Максимально возможная нагрузка downstream.
//
// Алгоритм:
// 1. Собрать ВСЕ уникальные потребители, достижимые из данного узла
// 2. Для каждого потребителя определить, проходит ли путь через UPS
// 3. Потребители за UPS: суммарная_мощность / средний_КПД + заряды всех UPS
// 4. Прямые потребители (не через UPS): суммарная мощность как есть
// Это даёт корректный результат без двойного счёта при DAG-топологиях.
// Макс. нагрузка, которая может прийти к узлу с учётом:
//  - реальных conns
//  - расширения между секциями через bus-ties, с ограничением: в одной секции
//    одновременно активен НЕ БОЛЕЕ ОДНОГО bus-tie (реальное эксплуатационное правило)
//  - дедупа потребителей через visited-set
//  - UPS эффективности и заряда батарей
// Алгоритм: собираем все доступные (closed | auto) ties, перебираем их подмножества
// удовлетворяющие ограничению «не более 1 tie на секцию», для каждого варианта
// запускаем BFS и берём максимум.
function _bfsDownstreamWithActiveTies(startId, activeTieKeys) {
  const visitedConsumers = new Set();
  const visitedUps = new Set();
  const visited = new Set();
  let directKw = 0;
  let upsConsumerKw = 0;
  let totalChargeKw = 0;
  let sumEfficiency = 0;
  let upsCount = 0;

  const queue = [{ id: startId, throughUps: false }];
  visited.add(startId);

  while (queue.length) {
    const { id: curId, throughUps } = queue.shift();
    const cur = state.nodes.get(curId);
    if (!cur) continue;
    if (cur.type === 'consumer') {
      if (!visitedConsumers.has(curId)) {
        visitedConsumers.add(curId);
        const kw = consumerTotalDemandKw(cur);
        if (throughUps) upsConsumerKw += kw; else directKw += kw;
      }
      continue;
    }
    if (cur.type === 'ups') {
      if (!visitedUps.has(curId)) {
        visitedUps.add(curId);
        totalChargeKw += upsChargeKw(cur);
        sumEfficiency += Math.max(0.01, (Number(cur.efficiency) || 100) / 100);
        upsCount++;
      }
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== curId) continue;
        if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
        if (!visited.has(c.to.nodeId)) {
          visited.add(c.to.nodeId);
          queue.push({ id: c.to.nodeId, throughUps: true });
        }
      }
      continue;
    }
    // ФИКС: если текущий узел — ГЕНЕРАТОР, на который пришли через
    // auxInput (порт 0) с ЩСН — НЕ спускаемся через его выходы.
    // Этот обход запускает maxDownstreamLoad от ЩСН: ЩСН питает только
    // собственные нужды ДГУ (auxDemandKw), а не выходную нагрузку ДГУ —
    // её ДГУ сам генерирует из топлива.
    //
    // Учитываем auxDemandKw как consumer от этого ДГУ.
    if (cur.type === 'generator' && cur.auxInput) {
      if (!visitedConsumers.has(curId)) {
        visitedConsumers.add(curId);
        const auxKw = Number(cur.auxDemandKw) || 0;
        if (auxKw > 0) {
          if (throughUps) upsConsumerKw += auxKw;
          else directKw += auxKw;
        }
      }
      continue; // не обходим downstream ДГУ — он питается сам
    }
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== curId) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      // ФИКС: не идём по связи, ведущей в auxInput генератора вниз.
      // Когда BFS дошёл до ЩСН и видит исходящую связь в auxInput ДГУ,
      // ДГУ добавляется в очередь, а в обработке ДГУ (case выше) мы
      // берём только auxDemandKw. Этот else защищает от неверного
      // продолжения если обработчик ДГУ не сработает (port !== 0).
      const toN = state.nodes.get(c.to.nodeId);
      if (toN && toN.type === 'generator' && toN.auxInput && c.to.port === 0) {
        // Корректно: добавляем ДГУ в очередь, там он обработается как
        // «потребитель с auxDemandKw» (case выше)
      }
      if (!visited.has(c.to.nodeId)) {
        visited.add(c.to.nodeId);
        queue.push({ id: c.to.nodeId, throughUps });
      }
    }
    // bus-tie — только если ключ этой связки в activeTieKeys
    if (cur.parentSectionedId) {
      const container = state.nodes.get(cur.parentSectionedId);
      const ties = Array.isArray(container?.busTies) ? container.busTies : [];
      if (ties.length) {
        const secIds = Array.isArray(container.sectionIds) ? container.sectionIds : [];
        const myIdx = secIds.indexOf(curId);
        if (myIdx >= 0) {
          for (let ti = 0; ti < ties.length; ti++) {
            const key = container.id + ':' + ti;
            if (!activeTieKeys.has(key)) continue;
            const [a, b] = ties[ti].between;
            const other = a === myIdx ? b : (b === myIdx ? a : -1);
            if (other < 0) continue;
            const otherId = secIds[other];
            if (otherId && !visited.has(otherId)) {
              visited.add(otherId);
              queue.push({ id: otherId, throughUps });
            }
          }
        }
      }
    }
  }

  const avgEff = upsCount > 0 ? (sumEfficiency / upsCount) : 1;
  return directKw + upsConsumerKw / avgEff + totalChargeKw;
}

// Кэш maxDownstreamLoad внутри одного прохода recalc.
// Ключ: nodeId. Сбрасывается в начале recalc.
let _maxDownstreamCache = null;
let _maxDownstreamAvailTies = null; // подготовленный список доступных ties
let _maxDownstreamValidMasks = null; // предвычисленный список валидных битмасок
function _resetMaxDownstreamCache() {
  _maxDownstreamCache = new Map();
  _maxDownstreamAvailTies = null;
  _maxDownstreamValidMasks = null;
}

function _prepareMaxDownstreamStructures() {
  // 1) Собираем все доступные (closed | auto) ties по всему проекту.
  const avail = [];
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
    const ties = Array.isArray(n.busTies) ? n.busTies : [];
    if (!ties.length) continue;
    const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : ties.map(t => !!t.closed);
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    for (let ti = 0; ti < ties.length; ti++) {
      const avail_i = tieStates[ti] || !!ties[ti].auto;
      if (!avail_i) continue;
      const [a, b] = ties[ti].between;
      const secA = secIds[a], secB = secIds[b];
      if (!secA || !secB) continue;
      avail.push({ key: n.id + ':' + ti, secA, secB });
    }
  }
  _maxDownstreamAvailTies = avail;

  // 2) Предвычисляем валидные битмаски один раз для всего прохода recalc:
  //    маска валидна если среди активных ties каждая секция встречается не более 1 раза.
  const N = Math.min(avail.length, 16);
  const total = 1 << N;
  const valid = [];
  for (let mask = 0; mask < total; mask++) {
    const used = new Map();
    let ok = true;
    const keys = new Set();
    for (let bit = 0; bit < N; bit++) {
      if (!(mask & (1 << bit))) continue;
      const t = avail[bit];
      used.set(t.secA, (used.get(t.secA) || 0) + 1);
      used.set(t.secB, (used.get(t.secB) || 0) + 1);
      if (used.get(t.secA) > 1 || used.get(t.secB) > 1) { ok = false; break; }
      keys.add(t.key);
    }
    if (ok) valid.push(keys);
  }
  _maxDownstreamValidMasks = valid;
}

function maxDownstreamLoad(nodeId) {
  if (!_maxDownstreamCache) _maxDownstreamCache = new Map();
  if (_maxDownstreamCache.has(nodeId)) return _maxDownstreamCache.get(nodeId);
  if (!_maxDownstreamAvailTies || !_maxDownstreamValidMasks) {
    _prepareMaxDownstreamStructures();
  }
  if (_maxDownstreamAvailTies.length === 0) {
    const kw = _bfsDownstreamWithActiveTies(nodeId, new Set());
    _maxDownstreamCache.set(nodeId, kw);
    return kw;
  }
  let best = 0;
  for (const activeKeys of _maxDownstreamValidMasks) {
    const kw = _bfsDownstreamWithActiveTies(nodeId, activeKeys);
    if (kw > best) best = kw;
  }
  _maxDownstreamCache.set(nodeId, best);
  return best;
}

// Финальный cos φ щита — взвешенное по активной мощности.
// Суммирует P и Q = P·tan(acos(cos)) по всем downstream-потребителям, cos_total = P / √(P²+Q²)
// Обход downstream-нагрузок. Возвращает суммарные P и Q в точке nodeId.
// Важная особенность: ИБП в нормальном режиме (через инвертор) «разрывает»
// реактивную связь — всё, что ниже, подаётся с его выхода при cos φ = 1,
// поэтому Q обнуляется, а P остаётся прежним. На статическом байпасе реактивная
// составляющая идёт напрямую со входа, поэтому cos φ потребителей сохраняется.
function downstreamPQ(nodeId) {
  let P = 0, Q = 0;
  const seen = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;
      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        const k = (Number(to.kUse) || 1) * effectiveLoadFactor(to);
        const p = per * cnt * k;
        const cos = Math.max(0.1, Math.min(1, Number(to.cosPhi) || 0.92));
        const tan = Math.sqrt(1 - cos * cos) / cos;
        P += p;
        Q += p * tan;
      } else if (to.type === 'panel' || to.type === 'channel' || to.type === 'junction-box') {
        stack.push(to.id);
      } else if (to.type === 'generator' && to.auxInput && c.to.port === 0) {
        // auxInput ДГУ — учитываем только собственные нужды как consumer
        const auxKw = Number(to.auxDemandKw) || 0;
        if (auxKw > 0) {
          const cos = Math.max(0.1, Math.min(1, Number(to.auxCosPhi) || 0.85));
          const tan = Math.sqrt(1 - cos * cos) / cos;
          P += auxKw;
          Q += auxKw * tan;
        }
        // НЕ добавляем ДГУ в stack — его downstream питается сам
      } else if (to.type === 'ups') {
        // ИБП: считаем его downstream отдельно и смотрим, в каком он режиме.
        // При работе через инвертор (не на байпасе) cos φ = 1 → Q сбрасывается.
        const sub = downstreamPQ(to.id);
        if (to._onStaticBypass) {
          // Байпас: поток идёт напрямую, реактивка сохраняется
          P += sub.P;
          Q += sub.Q;
        } else {
          // Нормальный режим: ИБП выходом отдаёт только активную мощность
          P += sub.P;
          // Q += 0
        }
      }
    }
  }
  return { P, Q };
}

// Агрегация downstream для многосекционного контейнера без дублирования.
// Обходит все секции с ЕДИНЫМ visited-set. Потребитель, попавший под
// несколько секций (общая шина через bus-tie → одна и та же ветка), учётом
// идёт один раз. Возвращает:
//   P, Q     — мгновенные (с kUse и effectiveLoadFactor режима)
//   maxKw    — максимальная одновременная (без kUse/режима, всё на 100%)
//   maxLoadA — ток при maxKw на номинальном напряжении контейнера
function _sectionedContainerAgg(container) {
  const secIds = Array.isArray(container.sectionIds) ? container.sectionIds : [];
  const seenNodes = new Set();
  const seenConsumers = new Set();
  const seenUps = new Set();
  let P = 0, Q = 0, maxKw = 0;
  let upsEffSum = 0, upsChargeSum = 0, upsCount = 0;
  let upsMaxKw = 0;
  const queue = [];
  for (const sid of secIds) { if (!seenNodes.has(sid)) { seenNodes.add(sid); queue.push({ id: sid, thruUps: false }); } }
  while (queue.length) {
    const { id: curId, thruUps } = queue.shift();
    const cur = state.nodes.get(curId);
    if (!cur) continue;
    if (cur.type === 'consumer') {
      if (seenConsumers.has(curId)) continue;
      seenConsumers.add(curId);
      const per = Number(cur.demandKw) || 0;
      const cnt = Math.max(1, Number(cur.count) || 1);
      const k = (Number(cur.kUse) || 1) * effectiveLoadFactor(cur);
      const p = per * cnt * k;
      const cos = Math.max(0.1, Math.min(1, Number(cur.cosPhi) || 0.92));
      const tan = Math.sqrt(1 - cos * cos) / cos;
      if (thruUps) { upsMaxKw += per * cnt; /* P/Q учтены на УПС-уровне */ }
      else { P += p; Q += p * tan; maxKw += per * cnt; }
      continue;
    }
    if (cur.type === 'ups') {
      if (!seenUps.has(curId)) {
        seenUps.add(curId);
        upsEffSum += Math.max(0.01, (Number(cur.efficiency) || 100) / 100);
        upsChargeSum += upsChargeKw(cur);
        upsCount++;
      }
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== curId) continue;
        if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
        if (!seenNodes.has(c.to.nodeId)) {
          seenNodes.add(c.to.nodeId);
          queue.push({ id: c.to.nodeId, thruUps: true });
        }
      }
      // P для ИБП: добавляем мгновенную P downstream (cosφ=1 нормально)
      const sub = downstreamPQ(curId);
      if (cur._onStaticBypass) { P += sub.P; Q += sub.Q; }
      else { P += sub.P; /* Q=0 через инвертор */ }
      continue;
    }
    if (cur.type === 'generator' && cur.auxInput) {
      if (!seenConsumers.has(curId)) {
        seenConsumers.add(curId);
        const auxKw = Number(cur.auxDemandKw) || 0;
        if (auxKw > 0) {
          const cos = Math.max(0.1, Math.min(1, Number(cur.auxCosPhi) || 0.85));
          const tan = Math.sqrt(1 - cos * cos) / cos;
          P += auxKw; Q += auxKw * tan; maxKw += auxKw;
        }
      }
      continue;
    }
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== curId) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      if (!seenNodes.has(c.to.nodeId)) {
        seenNodes.add(c.to.nodeId);
        queue.push({ id: c.to.nodeId, thruUps });
      }
    }
  }
  // ИБП: добавляем собственные нужды (charge) к общей нагрузке
  const avgEff = upsCount > 0 ? (upsEffSum / upsCount) : 1;
  maxKw += upsMaxKw / avgEff + upsChargeSum;
  return { P, Q, maxKw };
}

// Финальный cos φ в произвольной точке схемы (обёртка над downstreamPQ)
function panelCosPhi(panelId) {
  const { P, Q } = downstreamPQ(panelId);
  if (P <= 0) return null;
  return P / Math.sqrt(P * P + Q * Q);
}

// ================= Расчёт мощности =================
// v0.59.528: пометить связи, идущие ВНУТРИ интегрированного ИБП.
// Это связи между родительским type='ups' kind='ups-integrated' и его
// integratedChildIds (PDM-секциями ATS/IT/AC/Bypass), а также между
// самими секциями. Эти связи — заводские шины внутри шкафа Kehua MR33,
// для них НЕ нужно считать сечение кабеля и автомат на расчётной схеме
// (только выходящие — после PDM в схему наружу).
function _markInternalIntegratedConns() {
  // Соберём множество членов каждой integrated-группы.
  // Map<groupKey:string, Set<nodeId>> где groupKey = id родителя.
  const memberToGroup = new Map();
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups' || n.kind !== 'ups-integrated') continue;
    const ids = Array.isArray(n.integratedChildIds) ? n.integratedChildIds : [];
    if (!ids.length) continue;
    memberToGroup.set(n.id, n.id);
    for (const cid of ids) memberToGroup.set(cid, n.id);
  }
  for (const c of state.conns.values()) {
    const fromGroup = memberToGroup.get(c.from.nodeId);
    const toGroup   = memberToGroup.get(c.to.nodeId);
    c._isInternalIntegrated = !!(fromGroup && toGroup && fromGroup === toGroup);
  }
}

function recalc() {
  // Сброс кэша maxDownstreamLoad на каждый проход — топология ties / tieStates
  // могла измениться с прошлого recalc.
  _resetMaxDownstreamCache();

  _markInternalIntegratedConns();

  // Нормализация мощности модульного ИБП: единственный источник истины —
  // modulesActive + redundancyScheme + moduleKwRated + frameKw.
  // Пересобираем n.capacityKw отсюда на каждый проход — чтобы отключение
  // модуля в Control modal немедленно влияло на расчёт нагрузки и номинала.
  // v0.59.605: интегрированные ИБП (kind='ups-integrated') тоже модульные —
  // явно включаем по наличию moduleKwRated/frameKw, а не только upsType.
  // Юзер: «MR33 6 слотов × 30кВт = frame 150кВт; в N+1 — 5×30=150, в N+2 —
  // 4×30=120, в N (без резерва) capped frame на 150».
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    const isModular = n.upsType === 'modular' || n.kind === 'ups-integrated';
    if (!isModular) continue;
    const modKw = Number(n.moduleKwRated ?? n.moduleKw) || 0;
    if (modKw <= 0) continue;
    const installed = Number(n.moduleInstalled ?? n.moduleCount) || 0;
    if (!Array.isArray(n.modulesActive) || n.modulesActive.length !== installed) {
      n.modulesActive = Array(installed).fill(true);
    }
    const redundN = n.redundancyScheme === 'N+2' ? 2 : (n.redundancyScheme === 'N+1' ? 1 : 0);
    const activeCount = n.modulesActive.filter(v => v !== false).length;
    const working = Math.max(0, activeCount - redundN);
    const frame = Number(n.frameKw) || (installed * modKw);
    n.capacityKw = Math.min(frame, working * modKw);
  }

  const edgesIn = new Map();
  for (const n of state.nodes.values()) edgesIn.set(n.id, []);
  for (const c of state.conns.values()) {
    // Повреждённые и отключённые линии не проводят электричество
    if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
    edgesIn.get(c.to.nodeId).push(c);
  }

  // Виртуальные связи через замкнутые СВ многосекционных щитов
  // При замкнутом СВ — создаём bidirectional виртуальные connections
  // между секциями, чтобы питание могло проходить через СВ.
  const virtualConns = [];
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    const ties = Array.isArray(n.busTies) ? n.busTies : [];
    const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : ties.map(t => !!t.closed);
    for (let ti = 0; ti < ties.length; ti++) {
      if (!tieStates[ti]) continue; // СВ разомкнут
      const [siA, siB] = ties[ti].between;
      const idA = secIds[siA], idB = secIds[siB];
      if (!idA || !idB) continue;
      const nodeA = state.nodes.get(idA), nodeB = state.nodes.get(idB);
      if (!nodeA || !nodeB) continue;
      // Виртуальная связь A→B (от выхода A[0] к входу B[последний+1])
      // и B→A (от выхода B[0] к входу A[последний+1])
      const vcAB = { id: `__vt_${idA}_${idB}`, from: { nodeId: idA, port: 9999 }, to: { nodeId: idB, port: 9999 }, _virtual: true, _state: 'powered' };
      const vcBA = { id: `__vt_${idB}_${idA}`, from: { nodeId: idB, port: 9999 }, to: { nodeId: idA, port: 9999 }, _virtual: true, _state: 'powered' };
      virtualConns.push(vcAB, vcBA);
      if (!edgesIn.has(idB)) edgesIn.set(idB, []);
      if (!edgesIn.has(idA)) edgesIn.set(idA, []);
      edgesIn.get(idB).push(vcAB);
      edgesIn.get(idA).push(vcBA);
    }
  }

  // Проверка: жива ли конкретная связь? Учитывает _watchdogActivePorts
  // на upstream-щите — если выходной порт не в activePorts, связь мертва.
  function isConnLive(c) {
    if (c._virtual) {
      // Виртуальная связь через СВ: проверяем есть ли питание у секции-источника
      // через РЕАЛЬНЫЕ входы (чтобы избежать рекурсии через виртуальные связи)
      const fromId = c.from.nodeId;
      const realIns = (edgesIn.get(fromId) || []).filter(ic => !ic._virtual);
      return realIns.some(ic => {
        if (ic.lineMode === 'damaged' || ic.lineMode === 'disabled') return false;
        const fn = state.nodes.get(ic.from.nodeId);
        if (!fn) return false;
        return activeInputs(ic.from.nodeId) !== null;
      });
    }
    if (c.lineMode === 'damaged' || c.lineMode === 'disabled') return false;
    const fromN = state.nodes.get(c.from.nodeId);
    if (!fromN) return false;
    if (fromN.type === 'panel' && fromN.maintenance) return false;
    if (fromN._watchdogActivePorts && !fromN._watchdogActivePorts.has(c.from.port)) return false;
    if (fromN.type === 'panel' && Array.isArray(fromN.breakerStates) && fromN.breakerStates[c.from.port] === false) return false;
    // Junction-box: maintenance + канал разомкнут (если защита стоит)
    if (fromN.type === 'junction-box' && fromN.maintenance) return false;
    if (fromN.type === 'junction-box' && Array.isArray(fromN.channels)) {
      const ch = fromN.channels[c.from.port];
      if (ch && ch.hasProtection && ch.closed === false) return false;
    }
    // Выходной автомат QF3 ИБП разомкнут — питание на downstream не идёт
    if (fromN.type === 'ups' && fromN.hasOutputBreaker !== false && fromN.outputBreakerOn === false) return false;
    // Автомат входа downstream-щита отключён
    const toN = state.nodes.get(c.to.nodeId);
    if (toN && toN.type === 'panel' && Array.isArray(toN.inputBreakerStates) && toN.inputBreakerStates[c.to.port] === false) return false;
    // Режим обслуживания downstream
    if (toN && toN.type === 'panel' && toN.maintenance) return false;
    if (toN && toN.type === 'junction-box' && toN.maintenance) return false;
    if (toN && toN.type === 'junction-box' && Array.isArray(toN.channels)) {
      const ch = toN.channels[c.to.port];
      if (ch && ch.hasProtection && ch.closed === false) return false;
    }
    return activeInputs(c.from.nodeId) !== null;
  }

  const cache = new Map();
  // Единый проход — если на входе есть напряжение (из ЛЮБОГО источника),
  // на выходе оно тоже есть. Нет двухпроходной логики allowBackup.
  // allowBackup сохранён как параметр для совместимости вызовов, но не влияет на логику.
  function activeInputs(nid, allowBackup) {
    const key = nid;
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null); // placeholder на случай re-entry

    const n = state.nodes.get(nid);
    let res = null;

    if (n.type === 'source') {
      if (!effectiveOn(n)) {
        res = null;
      } else if ((Number(n.inputs) || 0) > 0) {
        // Первичная обмотка трансформатора (или другого источника)
        // подключена к сети сверху — сам источник без питания сверху
        // не может выдавать электричество. Требуем живой входящий канал
        // с любого порта.
        const ins = edgesIn.get(nid) || [];
        const live = ins.filter(c => isConnLive(c) && activeInputs(c.from.nodeId) !== null);
        res = live.length > 0 ? live.map(c => ({ conn: c, share: 1 / live.length })) : null;
      } else {
        // Автономный источник / utility — сам является корнем питания.
        res = [];
      }
    } else if (n.type === 'generator') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        let tGroups = Array.isArray(n.triggerGroups) && n.triggerGroups.length
          ? n.triggerGroups : [];

        if (!tGroups.length) {
          const legacyIds = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
            ? n.triggerNodeIds
            : (n.triggerNodeId ? [n.triggerNodeId] : []);
          if (legacyIds.length) {
            tGroups = [{
              name: '', watchInputs: legacyIds.map(id => ({ nodeId: id })),
              logic: n.triggerLogic || 'any', activateOutputs: [],
            }];
          }
        }

        if (tGroups.length) {
          let firedGroup = null;
          for (const grp of tGroups) {
            const watches = Array.isArray(grp.watchInputs) ? grp.watchInputs : [];
            if (!watches.length) continue;
            const statuses = watches.map(w => {
              if (w.panelId && typeof w.inputPort === 'number') {
                for (const c of state.conns.values()) {
                  if (c.to.nodeId === w.panelId && c.to.port === w.inputPort) {
                    if (c.lineMode === 'damaged' || c.lineMode === 'disabled') return 'dead';
                    return activeInputs(c.from.nodeId) !== null ? 'alive' : 'dead';
                  }
                }
                return 'dead';
              } else if (w.nodeId) {
                const t = state.nodes.get(w.nodeId);
                if (!t) return 'dead';
                return activeInputs(w.nodeId) !== null ? 'alive' : 'dead';
              }
              return 'dead';
            });
            const logic = grp.logic || 'any';
            const fired = logic === 'any'
              ? statuses.some(s => s === 'dead')
              : statuses.every(s => s === 'dead');
            if (fired) { firedGroup = grp; break; }
          }

          if (!firedGroup) {
            n._activeTriggerGroup = null;
            res = null; // дежурство
          } else {
            n._activeTriggerGroup = firedGroup;
            res = (n._running || (Number(n.startDelaySec) || 0) === 0) ? [] : null;
          }
        } else if (n.backupMode) {
          // Backup без триггеров — не запускается автоматически
          n._activeTriggerGroup = null;
          res = null;
        } else {
          n._activeTriggerGroup = null;
          res = [];
        }
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        // Состояние защитных аппаратов ИБП:
        // Основной вводной путь QF1: вход допускается только когда QF1
        // физически присутствует (hasInputBreaker !== false) и замкнут
        // (inputBreakerOn !== false). Если QF1 разомкнут — ИБП с основного
        // ввода питания не берёт, но может перейти на батарею.
        const qf1Closed = n.hasInputBreaker === false || n.inputBreakerOn !== false;
        // Вход байпаса QF2 — аналогично. В режиме 'separate' (отдельный
        // кабель на байпас) QF2 — это отдельный второй ввод. В режиме
        // 'jumper' (перемычка от основного) QF2 гейтит bypass-ветку,
        // но не основной тракт.
        const qf2Closed = n.hasInputBypassBreaker === false || n.inputBypassBreakerOn !== false;
        const bypassSeparate = n.bypassFeedMode === 'separate';

        const ins = edgesIn.get(nid) || [];
        // Фильтр: в режиме 'separate' порт 1 (index 1) считается bypass-вводом
        // и гейтится QF2, остальные — основным QF1.
        const eligible = ins.filter(c => {
          const isBypassPort = bypassSeparate && c.to.port === 1;
          return isBypassPort ? qf2Closed : qf1Closed;
        });

        if (eligible.length > 0) {
          // АВР по приоритетам — один проход
          const groups = new Map();
          for (const c of eligible) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => isConnLive(c));
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
        }
        // Батарейный резерв — если нет питания от входов и батарея есть.
        // Гейтится батарейным автоматом QB.
        const qbClosed = n.hasBatteryBreaker === false || n.batteryBreakerOn !== false;
        if (res === null && !n.staticBypassForced && qbClosed) {
          const batt = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
          if (batt > 0) res = [];
        }
      }
    } else if (n.type === 'channel') {
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        const live = ins.filter(c => isConnLive(c));
        if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
      }
    } else if (n.type === 'zone') {
      // Зона — чисто декоративный контейнер, в расчёте не участвует
      res = null;
    } else {
      // panel или consumer
      // Режим обслуживания — щит полностью обесточен
      if (n.type === 'panel' && n.maintenance) {
        res = null;
        cache.set(key, res);
        return res;
      }
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        // Ручной режим щита: работает только явно выбранный вход
        if (n.type === 'panel' && n.switchMode === 'manual') {
          const idx = n.manualActiveInput | 0;
          const target = ins.find(c => c.to.port === idx);
          if (target) {
            if (isConnLive(target)) {
              res = [{ conn: target, share: 1 }];
            }
          }
        } else if (n.type === 'panel' && n.switchMode === 'terminal') {
          // v0.59.328: клеммная коробка — 1:1 passthrough (вход i → выход i),
          // + перемычки между входами (только до защиты) объединяют группы
          // общей шиной. Внутри группы все входы равнозначны; если у выхода
          // стоит защитный аппарат — downstream-кабель видит это как
          // собственный автомат, иначе наследует защиту вышестоящего.
          // Для propagate мы собираем res как объединение живых входов;
          // _termPortMap задаёт какие выходы каким входам соответствуют.
          const jumpers = Array.isArray(n.channelJumpers) ? n.channelJumpers : [];
          // Строим группы (union-find) по перемычкам: входы в одной группе
          // питаются общей шиной.
          const N = n.inputs || 0;
          const parent = new Array(N).fill(0).map((_, i) => i);
          const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
          const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
          for (const j of jumpers) {
            if (Array.isArray(j) && j.length === 2 && j[0] < N && j[1] < N) uni(j[0] | 0, j[1] | 0);
          }
          // Для каждого выхода: группа = group(input i). Выход активен, если
          // в группе есть live-вход.
          const groupLive = new Map();
          for (const c of ins) {
            if (!isConnLive(c)) continue;
            const g = find(c.to.port | 0);
            if (!groupLive.has(g)) groupLive.set(g, []);
            groupLive.get(g).push(c);
          }
          const activePorts = new Set();
          const perOutput = [];
          for (let o = 0; o < (n.outputs || 0); o++) {
            const g = find(o);
            const arr = groupLive.get(g);
            if (arr && arr.length) {
              activePorts.add(o);
              for (const c of arr) perOutput.push({ conn: c, share: 1 / arr.length });
            }
          }
          if (perOutput.length) {
            // dedup (один conn может повторяться если выходов в группе >1)
            const byConn = new Map();
            for (const r of perOutput) {
              const k = r.conn.id;
              if (!byConn.has(k)) byConn.set(k, r);
            }
            res = [...byConn.values()];
            n._watchdogActivePorts = activePorts;
          }
        } else if (n.type === 'panel' && n.switchMode === 'parallel') {
          // Щит-параллель: все входы с включёнными автоматами → на все выходы.
          const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
          const selected = ins.filter(c => inBrk[c.to.port] !== false);
          const live = selected.filter(c => isConnLive(c));
          if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
        } else if (n.type === 'panel' && n.switchMode === 'avr_paired') {
          // АВР с привязкой: каждый выход работает от своей группы входов.
          // Для activeInputs щита в целом — берём ВСЕ входы, у которых есть
          // upstream. Но _watchdogActivePorts будет ограничивать выходы
          // в пост-проходе — только те, чей вход по outputInputMap жив.
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => isConnLive(c));
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          // Определяем какие выходы активны — по outputInputMap
          if (res) {
            const map = Array.isArray(n.outputInputMap) ? n.outputInputMap : null;
            const activeInPorts = new Set(res.map(r => r.conn.to.port));
            const activePorts = new Set();
            if (map) {
              for (let outIdx = 0; outIdx < (n.outputs || 0); outIdx++) {
                const allowedIns = map[outIdx];
                if (Array.isArray(allowedIns) && allowedIns.some(i => activeInPorts.has(i))) {
                  activePorts.add(outIdx);
                }
              }
            } else {
              // Без карты — все выходы от любого живого входа
              for (let i = 0; i < (n.outputs || 0); i++) activePorts.add(i);
            }
            n._watchdogActivePorts = activePorts;
          }
        } else if (n.type === 'panel' && n.switchMode === 'switchover') {
          // Switchover: один вход (от подменного ДГУ), несколько выходов.
          // Каждый выход активен ТОЛЬКО когда его outputActivateWhenDead узел мёртв.
          // Вход работает по обычному АВР.
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => isConnLive(c));
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          // Определяем какие выходы активны — по activateWhenDead
          if (res) {
            const whenDead = Array.isArray(n.outputActivateWhenDead) ? n.outputActivateWhenDead : null;
            const activePorts = new Set();
            for (let outIdx = 0; outIdx < (n.outputs || 0); outIdx++) {
              const watchId = whenDead ? whenDead[outIdx] : null;
              if (!watchId) {
                // Нет условия — выход всегда активен
                activePorts.add(outIdx);
              } else {
                // Выход активен только если watchId обесточен
                const watchNode = state.nodes.get(watchId);
                const watchPowered = watchNode && activeInputs(watchId) !== null;
                if (!watchPowered) activePorts.add(outIdx);
              }
            }
            n._watchdogActivePorts = activePorts;
          }
        } else if (n.type === 'panel' && n.switchMode === 'sectioned') {
          // Многосекционный щит-контейнер: сам не участвует в расчёте.
          // Секции — отдельные panel nodes, обрабатываются как обычные.
          // СВ управляет связью между секциями (TODO: электрика через СВ).
          res = null;
          cache.set(key, res);
          return res;
        } else if (false && n.type === 'panel' && n.switchMode === '__old_sectioned__') {
          // Многосекционный щит: каждая секция — изолированный щит.
          // Без замкнутого СВ — секции полностью разделены.
          // С замкнутым СВ — секции объединяются, питание от одного ввода.
          const sections = Array.isArray(n.sections) ? n.sections : [];
          const busTies = Array.isArray(n.busTies) ? n.busTies : [];
          const tieStates = Array.isArray(n._busTieStates) ? n._busTieStates : busTies.map(t => !!t.closed);

          // 1. Для каждой секции находим живые входы
          const sectionLiveConns = []; // [si] = [conn, ...]
          for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            const liveIns = [];
            for (const inPort of (sec.inputPorts || [])) {
              const inConn = ins.find(c => c.to.port === inPort);
              if (inConn && isConnLive(inConn)) liveIns.push(inConn);
            }
            sectionLiveConns.push(liveIns);
          }

          // 2. BFS по замкнутым СВ → группы секций
          const sectionGroup = new Array(sections.length).fill(-1);
          let groupId = 0;
          for (let si = 0; si < sections.length; si++) {
            if (sectionGroup[si] >= 0) continue;
            const queue = [si];
            while (queue.length) {
              const cur = queue.shift();
              if (sectionGroup[cur] >= 0) continue;
              sectionGroup[cur] = groupId;
              for (let ti = 0; ti < busTies.length; ti++) {
                if (!tieStates[ti]) continue;
                const [a, b] = busTies[ti].between;
                if (a === cur && sectionGroup[b] < 0) queue.push(b);
                if (b === cur && sectionGroup[a] < 0) queue.push(a);
              }
            }
            groupId++;
          }

          // 3. Для каждой группы — один активный ввод, выходы всех секций группы
          const activePorts = new Set();
          const allRes = [];
          const groupFeeds = new Map(); // groupId → conn
          for (let si = 0; si < sections.length; si++) {
            const gid = sectionGroup[si];
            if (groupFeeds.has(gid)) continue;
            if (sectionLiveConns[si].length > 0) {
              // Используем первый живой ввод этой секции
              groupFeeds.set(gid, sectionLiveConns[si][0]);
            }
          }
          // Ищем во всех секциях группы
          for (let si = 0; si < sections.length; si++) {
            const gid = sectionGroup[si];
            if (!groupFeeds.has(gid) && sectionLiveConns[si].length > 0) {
              groupFeeds.set(gid, sectionLiveConns[si][0]);
            }
          }

          // 4. Формируем результат
          for (let si = 0; si < sections.length; si++) {
            const gid = sectionGroup[si];
            const feedConn = groupFeeds.get(gid);
            if (feedConn) {
              // Выходы этой секции — активны
              for (const outPort of (sections[si]?.outputPorts || [])) {
                activePorts.add(outPort);
              }
              // Добавляем conn если ещё не добавлен
              if (!allRes.some(r => r.conn === feedConn)) {
                allRes.push({ conn: feedConn, share: 1 });
              }
            }
          }

          if (allRes.length) res = allRes;
          n._watchdogActivePorts = activePorts.size ? activePorts : null;

          // Сохраняем инфо о запитанности каждой секции для рендера
          n._sectionFed = sections.map((_, si) => groupFeeds.has(sectionGroup[si]));

        } else if (n.type === 'panel' && n.switchMode === 'watchdog') {
          // Watchdog-режим: каждый ВХОД i жёстко привязан к ВЫХОДУ i.
          // Вход i работает только когда его upstream МЁРТВ (обесточен).
          // Логика: «если на входе i пропал сигнал → включить выход i от ДГУ».
          // Это обратная логика — «нормально-замкнутый» мониторинг.
          // Реализация: для activeInputs щита — мы собираем все входы,
          // у которых upstream отключён, и делаем их активными.
          // downstream (щит → нагрузки) тогда идёт через те выходы, чей
          // индекс совпадает с активным входом.
          const liveIns = [];
          for (const c of ins) {
            const upAlive = activeInputs(c.from.nodeId) !== null;
            if (!upAlive) {
              // upstream отключён → этот вход (и соответственно выход) активируется
              liveIns.push(c);
            }
          }
          if (liveIns.length) {
            res = liveIns.map(c => ({ conn: c, share: 1 / liveIns.length }));
          }
          // Помечаем какие выходы щита реально работают (для renderConns)
          n._watchdogActivePorts = new Set(liveIns.map(c => c.to.port));
        } else {
          // Автоматический режим — группировка по приоритетам
          // Если simTick управляет переключением (задержки АВР),
          // используем _avrBreakerOverride вместо мгновенного выбора
          if (Array.isArray(n._avrBreakerOverride) && n._avrBreakerOverride.length) {
            const overridden = ins.filter(c => n._avrBreakerOverride[c.to.port] === true && isConnLive(c));
            if (overridden.length) {
              res = overridden.map(c => ({ conn: c, share: 1 / overridden.length }));
            } else {
              // Во время разбежки все автоматы могут быть выключены — щит без питания
              // Проверяем: есть ли хоть один вход с напряжением (fallback)
              const anyLive = ins.filter(c => isConnLive(c));
              if (anyLive.length && !n._avrSwitchStartedAt) {
                // Нет таймера — мгновенный выбор (первый запуск)
                res = anyLive.slice(0, 1).map(c => ({ conn: c, share: 1 }));
              }
              // Иначе res = null — щит обесточен во время переключения
            }
          } else {
            // Без override — стандартная логика по приоритетам (первый запуск)
            const groups = new Map();
            for (const c of ins) {
              const prio = (n.priorities?.[c.to.port]) ?? 1;
              if (!groups.has(prio)) groups.set(prio, []);
              groups.get(prio).push(c);
            }
            const sorted = [...groups.keys()].sort((a, b) => a - b);
            for (const p of sorted) {
              const live = groups.get(p).filter(c => isConnLive(c));
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
            // Инициализация _avrBreakerOverride из результата
            if (res) {
              n._avrBreakerOverride = new Array(n.inputs || 0).fill(false);
              for (const r of res) n._avrBreakerOverride[r.conn.to.port] = true;
              n._avrActivePort = res[0].conn.to.port;
            }
          }
        }
      }
    }

    cache.set(key, res);
    return res;
  }

  // Сброс расчётных полей
  for (const n of state.nodes.values()) {
    n._loadKw = 0; n._powered = false; n._overload = false;
    n._loadA = 0; n._maxLoadA = 0; n._maxLoadKw = 0;
    n._watchdogActivePorts = null;
    n._ownInputPowered = false; n._ownInputAvailable = false;
    // Сброс _avrBreakerOverride для ВСЕХ кроме панелей в активной фазе переключения.
    // Фаза переключения определяется ТОЛЬКО наличием _avrSwitchCountdown > 0 или _avrInterlockCountdown > 0.
    if (n.type === 'consumer') {
      n._avrBreakerOverride = null;
    } else if (n.type === 'panel') {
      const switching = (n._avrSwitchCountdown > 0) || (n._avrInterlockCountdown > 0);
      if (!switching) {
        n._avrBreakerOverride = null;
      }
    }
  }
  for (const c of state.conns.values()) { c._active = false; c._loadKw = 0; c._state = 'dead'; }

  // Предварительный проход: вычислить activeInputs для ВСЕХ генераторов,
  // чтобы установить _activeTriggerGroup и _watchdogActivePorts ДО walkUp.
  for (const n of state.nodes.values()) {
    if (n.type === 'generator') activeInputs(n.id);
  }
  // Установить _watchdogActivePorts на switchover-щитах
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator' || !n._activeTriggerGroup) continue;
    const grp = n._activeTriggerGroup;
    const outputs = Array.isArray(grp.activateOutputs) ? grp.activateOutputs : [];
    if (!outputs.length) continue;
    let targetPanel = null;
    if (n.switchPanelId) targetPanel = state.nodes.get(n.switchPanelId);
    if (!targetPanel) {
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== n.id) continue;
        const panel = state.nodes.get(c.to.nodeId);
        if (panel && panel.type === 'panel') { targetPanel = panel; break; }
      }
    }
    if (targetPanel) {
      targetPanel._watchdogActivePorts = new Set(outputs);
    }
  }

  // Распространение нагрузки от потребителей вверх.
  // При прохождении границы ИБП поток вверх увеличивается на 1/КПД — это потери
  // на преобразование. Если ИБП работает от батареи (активные входы пусты),
  // visit() завершается — вверх ничего не идёт.
  // Через source с inputs>0 (трансформатор на кабеле) поток тоже проходит,
  // увеличиваясь на сумму потерь P0 + Pk·(load/Snom)².
  function walkUp(nid, kw) {
    let depth = 0;
    const visit = (id, flow) => {
      if (depth++ > 2000) return;
      const ai = activeInputs(id);
      if (!ai || ai.length === 0) return;
      const nn = state.nodes.get(id);
      // Потери на ИБП применяем только когда он работает через инвертор.
      // На статическом байпасе КПД = 100%.
      const upsActiveLoss = (nn.type === 'ups') && !nn._onStaticBypass;
      const eff = upsActiveLoss
        ? Math.max(0.01, (Number(nn.efficiency) || 100) / 100)
        : 1;
      let flowUp = flow / eff;
      // Потери трансформатора: если это source с подключённой первичкой, то
      // вверх уходит flow + P0 + Pk·(S/Snom)².
      if (nn.type === 'source' && (Number(nn.inputs) || 0) > 0) {
        const subtype = nn.sourceSubtype || 'transformer';
        if (subtype === 'transformer') {
          const snomKva = Number(nn.snomKva) || 0;
          const cosPhi = Number(nn.cosPhi) || 0.95;
          const snomKw = snomKva * cosPhi;
          const p0 = Number(nn.p0W) || 0; // кВт — в поле называется p0W, но это кВт
          const pk = Number(nn.pkW) || 0;
          const loadRatio = snomKw > 0 ? (flow / snomKw) : 0;
          const copperLoss = pk * loadRatio * loadRatio;
          flowUp = flow + p0 + copperLoss;
          nn._trafoP0Kw = p0;
          nn._trafoPkKw = copperLoss;
        }
      }
      for (const { conn, share } of ai) {
        const upKw = flowUp * share;
        conn._active = true;
        conn._loadKw += upKw;
        const up = state.nodes.get(conn.from.nodeId);
        up._loadKw += upKw;
        up._powered = true;
        visit(up.id, upKw);
      }
    };
    visit(nid, kw);
  }

  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const ai = activeInputs(n.id);
    n._powered = ai !== null;
    if (!n._powered) continue;
    // Суммарная расчётная мощность потребителя:
    //   Pрасч = demandKw × count × Ки × loadFactor
    // Раньше здесь НЕ учитывался Ки — из-за этого сумма по источникам
    // расходилась с полем Pрасч в отчёте и с _powerP на самом потребителе.
    // Теперь всё считается по одной формуле.
    const kUse = Number(n.kUse) || 1;
    const factor = effectiveLoadFactor(n);
    const total = consumerTotalDemandKw(n) * kUse * factor;
    n._loadKw = total;
    walkUp(n.id, total);
  }

  // Собственные нужды генераторов (auxInput)
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator' || !n.auxInput) continue;
    if (!n.auxBreakerOn) continue;
    const auxKw = Number(n.auxDemandKw) || 0;
    if (auxKw <= 0) continue;
    // Ищем входящую связь к порту 0 (auxInput)
    const ins = edgesIn.get(n.id) || [];
    const auxConn = ins.find(c => !c._virtual && c.to.port === 0);
    if (!auxConn) continue;
    // Проверяем что источник запитан
    const fromNode = state.nodes.get(auxConn.from.nodeId);
    if (!fromNode || activeInputs(auxConn.from.nodeId) === null) continue;
    // Нагрузка СН идёт вверх от генератора через auxInput
    auxConn._active = true;
    auxConn._loadKw += auxKw;
    fromNode._loadKw += auxKw;
    walkUp(fromNode.id, auxKw);
  }

  // Зарядный ток ИБП — накидывается поверх проходной мощности, только если:
  // - ИБП включён
  // - Работает от входа (не от батареи)
  // - НЕ на статическом байпасе (при байпасе инвертор выключен, батарея не
  //   заряжается)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!effectiveOn(n)) continue;
    const ai = activeInputs(n.id);
    if (!ai || ai.length === 0) continue;

    // Предварительная проверка байпаса ещё до пост-прохода статусов.
    // v0.59.607: weighted load (HVAC-derate per-load).
    const cap0 = Number(n.capacityKw) || 0;
    const wLoad0 = _computeUpsWeightedLoad(n);
    const overloadRatio = cap0 > 0 ? (wLoad0 / cap0 * 100) : 0;
    const onBypass = n.staticBypass && (
      n.staticBypassForced ||
      (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110))
    );
    if (onBypass) continue;

    const ch = upsChargeKw(n);
    if (ch <= 0) continue;
    walkUp(n.id, ch);
  }

  // Вычисление _state для каждой связи — три цвета
  for (const c of state.conns.values()) {
    if (c._active) {
      // Для щита с _watchdogActivePorts: выход активен только если порт в activePorts
      const fromN = state.nodes.get(c.from.nodeId);
      if (fromN && fromN.type === 'panel' && fromN._watchdogActivePorts) {
        if (!fromN._watchdogActivePorts.has(c.from.port)) {
          c._active = false;
          c._state = 'dead';
          continue;
        }
      }
      c._state = 'active';
      continue;
    }
    // Проверяем _watchdogActivePorts и breakerStates для неактивных связей
    const fromN2 = state.nodes.get(c.from.nodeId);
    if (fromN2 && fromN2.type === 'panel') {
      if (fromN2._watchdogActivePorts && !fromN2._watchdogActivePorts.has(c.from.port)) {
        c._state = 'dead'; continue;
      }
      if (Array.isArray(fromN2.breakerStates) && fromN2.breakerStates[c.from.port] === false) {
        c._state = 'dead'; continue;
      }
      if (fromN2.maintenance) {
        c._state = 'dead'; continue;
      }
    }
    const upAi = activeInputs(c.from.nodeId);
    c._state = (upAi !== null) ? 'powered' : 'dead';
  }

  // Статусы источников и ИБП
  for (const n of state.nodes.values()) {
    if (n.type === 'source' || n.type === 'generator') {
      const ai = activeInputs(n.id);
      n._powered = ai !== null;
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    } else if (n.type === 'panel') {
      if (!n._powered) n._powered = activeInputs(n.id) !== null;
    } else if (n.type === 'ups') {
      const ai = activeInputs(n.id);
      n._powered = ai !== null;
      n._onBattery = ai !== null && ai.length === 0;

      // v0.59.607: weighted load с HVAC-derate (per-load model). capacity
      // ИБП НЕ уменьшается — derate применяется только к механической части.
      // load_effective = Σ P_IT × 1 + Σ P_HVAC / derateFactor
      const cap = Number(n.capacityKw) || 0;
      const wLoad = _computeUpsWeightedLoad(n);
      n._loadKwWeighted = wLoad;
      n._effectiveCapacityKw = cap;
      const overloadRatio = cap > 0 ? (wLoad / cap * 100) : 0;
      const shouldBypass = (
        n.staticBypass && !n._onBattery && n._powered &&
        (n.staticBypassForced || (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110)))
      );
      n._onStaticBypass = shouldBypass;

      if (n._powered && !n._onBattery) {
        if (shouldBypass) {
          // Статический байпас: поток идёт мимо инвертора, КПД = 100%,
          // зарядный ток не потребляется (батарея не обслуживается)
          n._inputKw = n._loadKw;
        } else {
          const eff = Math.max(0.01, (Number(n.efficiency) || 100) / 100);
          n._inputKw = n._loadKw / eff + upsChargeKw(n);
        }
      } else {
        n._inputKw = 0;
      }
      // v0.59.607: перегруз = weighted load > capacity. wLoad учитывает HVAC.
      if (cap > 0 && wLoad > cap) n._overload = true;
    }
  }

  // Вычисляем _ownInputPowered и _ownInputAvailable для секций многосекционных щитов.
  // _ownInputPowered = секция запитана от своих реальных вводов (не через СВ)
  // _ownInputAvailable = на реальных вводах секции есть напряжение (неважно, автомат вкл/выкл)
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || !n.parentSectionedId) continue;
    const realIns = (edgesIn.get(n.id) || []).filter(c => !c._virtual);
    const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
    for (const c of realIns) {
      const live = c._state === 'active' || c._state === 'powered';
      if (live) {
        n._ownInputAvailable = true;
        if (inBrk[c.to.port] !== false) n._ownInputPowered = true;
      }
    }
  }

  // Определение цвета источника для каждого узла и связи.
  // Цвет определяется источником питания и распространяется по ВСЕМ живым связям
  // (active + powered), не только по активным. ИБП в режиме инвертора меняет цвет
  // на свой lineColor, а на байпасе — транслирует цвет входящей линии.
  // Размещено ПОСЛЕ вычисления _onStaticBypass, чтобы bypass-логика работала.
  for (const n of state.nodes.values()) {
    n._sourceColor = null;
    n._sourceColors = null;
    n._mixedSources = false;
  }
  for (const c of state.conns.values()) {
    c._sourceColor = null;
    c._mixedSources = false;
  }

  // Фаза 1: раскрасить ВСЕ входящие линии цветом источника (независимо от автоматов).
  // Линии, у которых на конце открыт вводной автомат, всё равно показывают цвет
  // того источника, от которого они идут.
  // Все связи для обхода цвета (реальные + виртуальные)
  const _allConnsForColor = [...state.conns.values(), ...virtualConns];

  function colorIncomingLines(startId, color) {
    const queue = [{ nid: startId, color }];
    const visited = new Set();
    while (queue.length) {
      const { nid, color: col } = queue.shift();
      const key = nid + ':' + col;
      if (visited.has(key)) continue;
      visited.add(key);
      const n = state.nodes.get(nid);
      if (!n) continue;

      let outColor = col;
      if (n.type === 'ups') {
        if (n._onStaticBypass) outColor = col;
        else if (n.lineColor) outColor = n.lineColor;
      }

      for (const c of _allConnsForColor) {
        if (c.from.nodeId !== nid) continue;
        if (c._state !== 'active' && c._state !== 'powered') continue;
        // Раскрашиваем линию цветом источника
        if (!c._sourceColor) c._sourceColor = outColor;
        // Для downstream-узла: отслеживаем какие цвета РЕАЛЬНО активны
        // (с учётом вводных автоматов)
        const toN = state.nodes.get(c.to.nodeId);
        if (toN) {
          if (!toN._sourceColors) toN._sourceColors = new Set();
          // Проверяем вводной автомат
          const inBrk = Array.isArray(toN.inputBreakerStates) ? toN.inputBreakerStates : [];
          const breakerClosed = inBrk[c.to.port] !== false;
          if (breakerClosed) {
            toN._sourceColors.add(outColor);
            if (!toN._sourceColor) toN._sourceColor = outColor;
          }
        }
        // Распространяем дальше только если breaker открыт (цвет проходит)
        const toInBrk = Array.isArray(toN?.inputBreakerStates) ? toN.inputBreakerStates : [];
        const toBreaker = toInBrk[c.to.port] !== false;
        if (toBreaker) {
          queue.push({ nid: c.to.nodeId, color: outColor });
        }
      }
    }
  }

  for (const n of state.nodes.values()) {
    if ((n.type === 'source' || n.type === 'generator') && n._powered) {
      if (!n._sourceColors) n._sourceColors = new Set();
      n._sourceColors.add(n.lineColor || '#e53935');
      if (!n._sourceColor) n._sourceColor = n.lineColor || '#e53935';
      colorIncomingLines(n.id, n.lineColor || '#e53935');
    }
  }

  // Фаза 2: перекрасить выходные линии цветом активного источника (BFS).
  // Панели, получившие _sourceColor от closed-breaker входов, распространяют
  // этот цвет на свои выходы и далее вниз по цепочке.
  {
    const colorQueue = [];
    for (const n of state.nodes.values()) {
      if (!n._sourceColor) continue;
      if (n.type === 'panel' || n.type === 'ups' || n.type === 'consumer') {
        colorQueue.push(n.id);
      }
    }
    const colorVisited = new Set();
    while (colorQueue.length) {
      const nid = colorQueue.shift();
      if (colorVisited.has(nid)) continue;
      colorVisited.add(nid);
      const n = state.nodes.get(nid);
      if (!n || !n._sourceColor) continue;
      let outColor = n._sourceColor;
      // Для секций через СВ: если все вводные автоматы выключены, цвет берём
      // от виртуальной связи (от смежной секции через СВ)
      if (n.type === 'panel' && n._sourceColors && n._sourceColors.size > 1) {
        // Определяем какой цвет пришёл через АКТИВНЫЙ ввод
        const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
        let activeColor = null;
        for (const c of _allConnsForColor) {
          if (c.to.nodeId !== nid) continue;
          if (c._state !== 'active' && c._state !== 'powered') continue;
          if (!c._virtual && inBrk[c.to.port] === false) continue; // выключенный автомат
          if (c._sourceColor) { activeColor = c._sourceColor; break; }
        }
        if (activeColor) outColor = activeColor;
      }
      if (n.type === 'ups') {
        if (n._onStaticBypass) { /* keep incoming color */ }
        else if (n.lineColor) outColor = n.lineColor;
      }
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== nid) continue;
        if (c._state !== 'active' && c._state !== 'powered') continue;
        c._sourceColor = outColor;
        const toN = state.nodes.get(c.to.nodeId);
        if (toN && !colorVisited.has(toN.id)) {
          // Обновляем _sourceColor downstream-узла, учитывая вводные автоматы
          const inBrk = Array.isArray(toN.inputBreakerStates) ? toN.inputBreakerStates : [];
          if (inBrk[c.to.port] !== false) {
            toN._sourceColor = outColor;
            colorQueue.push(toN.id);
          }
        }
      }
    }
  }

  // Смешанные источники: пунктир только если на входах щита (без АВР) ЗАМКНУТЫ
  // автоматы от разных источников. Открытые вводные автоматы не считаются.
  {
    const mixQueue = [];
    for (const n of state.nodes.values()) {
      if (n.type !== 'panel') continue;
      if (n.switchMode === 'auto') continue; // АВР сам разберётся
      const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
      const activeColors = new Set();
      for (const c of state.conns.values()) {
        if (c.to.nodeId !== n.id) continue;
        if (c._state !== 'active' && c._state !== 'powered') continue;
        if (inBrk[c.to.port] === false) continue; // автомат открыт — не считаем
        if (c._sourceColor) activeColors.add(c._sourceColor);
      }
      if (activeColors.size > 1) {
        n._mixedSources = true;
        mixQueue.push(n.id);
      }
    }
    const mixVisited = new Set();
    while (mixQueue.length) {
      const nid = mixQueue.shift();
      if (mixVisited.has(nid)) continue;
      mixVisited.add(nid);
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== nid) continue;
        if (c._state !== 'active' && c._state !== 'powered') continue;
        c._mixedSources = true;
        const downstream = state.nodes.get(c.to.nodeId);
        if (downstream) {
          downstream._mixedSources = true;
          mixQueue.push(downstream.id);
        }
      }
    }
  }

  // Подсчёт защитных автоматов в щитах:
  // для каждого выхода щита, ведущего к потребителю/каналу/вниз — свой автомат.
  // Для группового потребителя (count > 1) — count автоматов одинакового номинала,
  // подобранных по току ОДНОЙ единицы группы.
  // === Расчёт токов, сечений кабелей и подбор автоматов ===
  // Подсчёт цепей в канале: для каждой линии добавляем столько цепей, сколько
  // Phase 1.20.44 (v0.57.19) — FIX по IEC 60364-5-52 §523.5 / Annex E:
  // параллельные проводники ОДНОЙ цепи считаются как ОДНА цепь для
  // K_group. Раньше было `circuits = count` — групповой потребитель
  // с count=4 добавлял 4 цепи в канал, что завышало K_group и приводило
  // к разным сечениям у симметричных линий с одинаковым per-line током.
  // Если через канал идут два групповых потребителя (4 жилы + 3 жилы) —
  // это 2 цепи в канале (не 7), как и требует стандарт.
  const channelCircuits = new Map(); // channelId → total circuits
  for (const c of state.conns.values()) {
    const ids = Array.isArray(c.channelIds) ? c.channelIds : [];
    if (!ids.length) continue;
    // Одна линия = одна цепь, независимо от count / parallel.
    for (const chId of ids) {
      channelCircuits.set(chId, (channelCircuits.get(chId) || 0) + 1);
    }
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;

    // Характеристики линии — берутся с downstream-узла.
    // Исключение: связь utility → трансформатор идёт на ПЕРВИЧНОЙ стороне
    // трансформатора (HV). Тогда напряжение и фазность берутся с utility
    // (= первичное напряжение трансформатора).
    const isUtilityToTransformer =
      fromN.type === 'source' && fromN.sourceSubtype === 'utility'
      && toN.type === 'source' && (toN.sourceSubtype || 'transformer') === 'transformer';
    const threePhase = isUtilityToTransformer ? isThreePhase(fromN) : isThreePhase(toN);
    // v0.59.603: для 1-фазной линии U должно быть vLN (а не vLL).
    // ПРОБЛЕМА: до v0.59.601 я починил ток для consumer (потребителя),
    // но кабельные линии всё ещё использовали nodeVoltage = vLL и для 1ф
    // получали I = P/(1×400×cos) = 18.8А вместо корректных 32.6А.
    // nodeCalcVoltage возвращает vLL для 3ф и vLN для 1ф.
    const U = isUtilityToTransformer ? nodeCalcVoltage(fromN) : nodeCalcVoltage(toN);

    // Эффективный cos φ линии:
    //   к потребителю → его cos φ
    //   к щиту → взвешенный финальный cos φ щита
    //   к ИБП → 1.0 (выпрямитель потребляет чисто активную мощность из сети)
    //   к каналу → GLOBAL default
    let cos;
    if (toN.type === 'consumer') cos = Number(toN.cosPhi) || GLOBAL.defaultCosPhi;
    else if (toN.type === 'panel') cos = panelCosPhi(toN.id) || GLOBAL.defaultCosPhi;
    else if (toN.type === 'ups') cos = 1.0; // ИБП = чисто активная нагрузка для сети
    else cos = GLOBAL.defaultCosPhi;

    c._voltage = U;
    c._cosPhi = cos;
    c._threePhase = threePhase;
    // DC-линия: detected по voltageLevel целевого узла (АКБ, DC-шины UPS).
    // Для DC токоведущих жил — 2 (L+, L−), cos φ не применяется, I=P/U.
    const _isDC = isNodeDC(isUtilityToTransformer ? fromN : toN);
    c._isDC = _isDC;
    // Высоковольтная линия (> 1 кВ). Подбор кабеля/автомата для HV отличается
    // от LV (другие таблицы XLPE 6/10 кВ, вакуумные выключатели вместо MCCB).
    // Пока используем LV-методику, но принудительно задаём минимальное сечение
    // HV-кабеля (25 мм² XLPE) и помечаем линию флагом — отчёт/рендер покажут (ВН).
    c._isHV = U > 1000 && !_isDC;
    // Количество жил — через cableWireCount: учитывает систему заземления
    // узла-источника (panel.earthingOut или GLOBAL.earthingSystem), фазность
    // целевого узла, ручные переопределения consumer.wireCount и
    // conn._wireCountManual. HV-линии всегда 3 жилы.
    c._wireCount = cableWireCount(fromN, toN, c);
    // v0.59.604: для линии, идущей К потребителю, ток БЕРЁМ напрямую из
    // consumer-функций (consumerRatedCurrent), а не пересчитываем по
    // c._loadKw / U / cos. Юзер: «ты разве в кабель не передаёшь уже
    // рассчитанные значения, а высчитываешь заново, разве это правильно».
    // Преимущества:
    //   1. Учитывается individual-режим (разные cos у каждого члена группы).
    //   2. kUse применяется per-item для individual.
    //   3. Согласованность: ток на консьюмере и ток на линии — одно и то же.
    if (toN.type === 'consumer') {
      c._loadA = consumerRatedCurrent(toN);
    } else {
      c._loadA = c._loadKw > 0 ? computeCurrentA(c._loadKw, U, cos, threePhase, _isDC) : 0;
    }

    // === Расчётный ток для подбора кабеля (максимальный по всем сценариям) ===
    // Кабель должен выдержать максимально возможную нагрузку через ДАННУЮ связь.
    let maxKwDownstream;
    if (toN.type === 'consumer') {
      maxKwDownstream = consumerTotalDemandKw(toN);
    } else if (toN.type === 'ups') {
      // Для линии К ИБП: макс. нагрузка = min(номинал, share_downstream) / КПД + charge
      const capKw = Number(toN.capacityKw) || 0;
      const eff = Math.max(0.01, (Number(toN.efficiency) || 100) / 100);
      const chKw = upsChargeKw(toN);
      // Downstream за UPS. Учитываем share если UPS делит нагрузку с другими UPS.
      const fullDown = simpleDownstream(toN.id);
      // Сколько UPS подключены к тому же downstream-щиту?
      let upsShare = 1;
      for (const c2 of state.conns.values()) {
        if (c2.from.nodeId !== toN.id || c2.lineMode === 'damaged' || c2.lineMode === 'disabled') continue;
        const dest = state.nodes.get(c2.to.nodeId);
        if (!dest || dest.type !== 'panel') continue;
        let peerCount = 0;
        for (const c3 of state.conns.values()) {
          if (c3.to.nodeId !== dest.id || c3.lineMode === 'damaged' || c3.lineMode === 'disabled') continue;
          const feeder = state.nodes.get(c3.from.nodeId);
          if (feeder && feeder.type === 'ups') peerCount++;
        }
        if (peerCount > 1) upsShare = 1 / peerCount;
        break;
      }
      const myLoad = fullDown * upsShare;
      const actualLoad = Math.min(capKw, myLoad);
      maxKwDownstream = actualLoad / eff + chKw;
    } else if (toN.type === 'panel') {
      maxKwDownstream = maxDownstreamLoad(toN.id);
    } else {
      maxKwDownstream = c._loadKw;
    }
    // Для линии ОТ ИБП (вниз): ИБП не может выдать больше своего номинала.
    // Также cos φ на выходе ИБП = 1.0 (инвертор) в нормальном режиме.
    if (fromN.type === 'ups') {
      const upsCap = Number(fromN.capacityKw) || 0;
      if (upsCap > 0 && maxKwDownstream > upsCap) maxKwDownstream = upsCap;
      if (!fromN._onStaticBypass) cos = 1.0; // инвертор → чисто активная мощность
    }
    // Источник/генератор: НЕ ограничиваем downstream его номиналом.
    // Кабель должен быть рассчитан на реальную нагрузку. Если нагрузка
    // превышает номинал источника — это показывается как перегруз (_overload).
    // v0.59.604: для прямой линии к consumer берём _nominalA (установочный
    // ток без kUse / loadFactor) — он уже учитывает individual-режим и
    // правильный U. Не пересчитываем заново.
    const maxCurrent = (toN.type === 'consumer')
      ? consumerNominalCurrent(toN)
      : (maxKwDownstream > 0
          ? computeCurrentA(maxKwDownstream, U, cos, threePhase, _isDC)
          : 0);
    c._maxKw = maxKwDownstream;
    c._maxA = maxCurrent;

    // === Параметры прокладки ===
    // Материал и изоляция — только из самой связи (канал их НЕ переопределяет).
    // Метод, температура, bundling — берутся из канала(ов) по пути; если каналов
    // нет, используются значения по умолчанию в самой связи.
    const channelIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    const material = c.material || GLOBAL.defaultMaterial;
    const insulation = c.insulation || GLOBAL.defaultInsulation;

    let method = c.installMethod || GLOBAL.defaultInstallMethod;
    let ambient = Number(c.ambientC) || GLOBAL.defaultAmbient;
    let bundling = c.bundling || 'touching';
    // Группировка: для групповых потребителей (count > 1) базовое число цепей = count,
    // т.к. каждая единица группы — отдельный кабель в том же лотке/канале.
    let baseGrouping = Number(c.grouping) || GLOBAL.defaultGrouping;
    if (toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
      baseGrouping = Math.max(baseGrouping, Number(toN.count) || 1);
    }
    let grouping = baseGrouping;

    // Ранг «суровости» метода: чем выше, тем меньше допустимый ток при равном сечении
    // Ранг суровости: больше = хуже теплоотвод = меньше допустимый ток
    const methodRank = { G: 0, F: 0, E: 1, C: 2, B1: 3, B2: 3, A1: 4, A2: 4, D1: 5, D2: 6 };
    const bundlingRank = { spaced: 0, touching: 1, bundled: 2 };

    if (channelIds.length) {
      let worstMethod = null;
      let worstAmbient = 0;
      let worstBundling = null;
      let maxGroup = 0;
      let hasChannel = false;
      for (const chId of channelIds) {
        const ch = state.nodes.get(chId);
        if (!ch || ch.type !== 'channel') continue;
        hasChannel = true;

        // Из канала берём method (по его типу), ambient, bundling
        const chMethod = ch.installMethod || 'B1';
        const chIMInfo = INSTALL_METHODS[chMethod] || INSTALL_METHODS.B1;
        if (worstMethod === null || (methodRank[chMethod] || 0) > (methodRank[worstMethod] || 0)) {
          worstMethod = chMethod;
        }
        const chAmb = Number(ch.ambientC) || 30;
        if (chAmb > worstAmbient) worstAmbient = chAmb;

        const chBundling = ch.bundling || chIMInfo.bundlingDefault || 'touching';
        if (worstBundling === null || (bundlingRank[chBundling] || 0) > (bundlingRank[worstBundling] || 0)) {
          worstBundling = chBundling;
        }

        // Группировка — сколько ДРУГИХ цепей идёт через этот же канал
        const grpInCh = channelCircuits.get(chId) || 1;
        if (grpInCh > maxGroup) maxGroup = grpInCh;
      }
      if (hasChannel) {
        method = worstMethod || method;
        ambient = Math.max(ambient, worstAmbient);
        bundling = worstBundling || bundling;
        grouping = Math.max(grouping, maxGroup);
      }
    }

    // Количество параллельных проводников зависит от типа группы:
    //  - параллельная (count > 1, !serialMode) — каждый прибор по своей кабельной
    //    паре от общего автомата; conductorsInParallel = count
    //  - последовательная (serialMode) — ОДИН кабель, один автомат, ток суммарный;
    //    conductorsInParallel = 1
    //  - одиночный потребитель — 1 проводник
    let conductorsInParallel = 1;
    if (toN.type === 'consumer' && (Number(toN.count) || 1) > 1 && !toN.serialMode) {
      conductorsInParallel = Number(toN.count) || 1;
    }

    const cableType = c.cableType || GLOBAL.defaultCableType;

    c._cableMaterial = material;
    c._cableInsulation = insulation;
    c._cableMethod = method;
    c._cableAmbient = ambient;
    c._cableBundling = bundling;
    c._cableGrouping = grouping;
    c._cableType = cableType;
    // Полная длина кабеля = собственная длина + сумма длин всех каналов
    const ownLength = c.lengthM ?? (channelIds.length ? 0 : 1);
    let channelLengthSum = 0;
    for (const chId of channelIds) {
      const ch = state.nodes.get(chId);
      if (ch) channelLengthSum += Number(ch.lengthM) || 0;
    }
    c._cableLength = ownLength + channelLengthSum;
    c._channelChain = channelIds.slice();

    if (maxCurrent > 0) {
      if (cableType === 'busbar') {
        // Шинопровод — подбор номинала с поправочными коэффициентами.
        // Kt — температурный (Schneider Electric Canalis, IEC 61439):
        //   базовая t = 35°C; при отклонении In_eff = In × Kt
        const BUSBAR_KT = { 15: 1.14, 20: 1.11, 25: 1.07, 30: 1.04, 35: 1.00,
          40: 0.96, 45: 0.92, 50: 0.87, 55: 0.82, 60: 0.76 };
        const btKeys = Object.keys(BUSBAR_KT).map(Number).sort((a, b) => a - b);
        let btBest = btKeys[0];
        for (const k of btKeys) if (Math.abs(k - ambient) < Math.abs(btBest - ambient)) btBest = k;
        const kt = BUSBAR_KT[btBest];

        // Kl — коэффициент типа нагрузки (Schneider Electric / IEC 61439-6):
        //   1.0 — чисто активная (cosφ=1); 0.9 — смешанная (cosφ≈0.8);
        //   0.85 — моторная / индуктивная (cosφ≤0.7)
        const cos = Number(c._cosPhi) || GLOBAL.defaultCosPhi;
        const kl = cos >= 0.95 ? 1.0 : cos >= 0.75 ? 0.9 : 0.85;

        const deratingFactor = kt * kl;
        // Iрасч_eff = Imax / (Kt × Kl) — нужный номинал ДО деретинга
        const Ieff = maxCurrent / deratingFactor;

        let busbarNom = BUSBAR_SERIES[BUSBAR_SERIES.length - 1];
        for (const nom of BUSBAR_SERIES) {
          if (nom >= Ieff) { busbarNom = nom; break; }
        }
        c._cableSize = null;
        c._busbarNom = busbarNom;
        c._busbarKt = kt;
        c._busbarKl = kl;
        c._cableIz = busbarNom * deratingFactor;
        c._cableTotalIz = c._cableIz;
        c._cableOverflow = Ieff > BUSBAR_SERIES[BUSBAR_SERIES.length - 1];
        c._cableKt = kt;
        c._cableKg = kl; // для шинопровода Kg = Kl (тип нагрузки)
        c._cableKtotal = deratingFactor;
        c._cableAutoParallel = false;
        c._cableParallel = 1;
      } else if (c.manualCableSize) {
        // Ручной кабель: используем заданное сечение, рассчитываем Iz
        const table = cableTable(material, insulation, method);
        const kT = kTempLookup(ambient, insulation);
        const effGrouping = kBundlingIgnoresGrouping(bundling) ? 1 : grouping;
        const kG = kGroupLookup(effGrouping, method) * kBundlingFactor(bundling);
        const k = kT * kG;
        const mSize = Number(c.manualCableSize) || 240;
        const mPar = Math.max(1, Number(c.manualCableParallel) || 1);
        // Находим Iref из таблицы для данного сечения
        let iRef = 0;
        for (const [s, i] of table) { if (s === mSize) { iRef = i; break; } }
        c._cableSize = mSize;
        c._busbarNom = null;
        c._cableIz = iRef * k;
        c._cableTotalIz = c._cableIz * mPar;
        c._cableOverflow = false;
        c._cableAutoParallel = false;
        c._cableParallel = mPar;
        c._cableKt = kT;
        c._cableKg = kG;
        c._cableKtotal = kT * kG;
      } else {
        // Авто-подбор кабеля через общий модуль методики (IEC / ПУЭ).
        // Единая цепочка запаса по автомату (та же, что в breaker-блоке ниже):
        //   line-override → consumer-override → auto(inrush) → GLOBAL.min
        // Передаём margin и breakerCurve прямо в selectCable — координация
        // In ≤ Iz и I2 ≤ 1.45·Iz выполняется внутри (IEC 60364-4-43).
        const calcMethod = getMethod(GLOBAL.calcMethod);
        const _consInrush = (toN && toN.type === 'consumer') ? (Number(toN.inrushFactor) || 1) : 1;
        const _consMP = (toN && toN.type === 'consumer' && typeof toN.breakerMarginPct === 'number') ? toN.breakerMarginPct : null;
        const _lineMP = (typeof c.breakerMarginPct === 'number') ? c.breakerMarginPct : null;
        const _sizingMarginPct = Math.max(
          Number(GLOBAL.breakerMinMarginPct) || 0,
          _lineMP != null ? _lineMP : (_consMP != null ? _consMP : autoBreakerMargin(_consInrush))
        );
        // Подсказка по кривой — влияет на I2ratio в coordination check
        const _consCurveHint = (toN && toN.type === 'consumer' && toN.curveHint) ? toN.curveHint : null;
        const _curveForSizing = c.breakerCurve || _consCurveHint || autoBreakerCurve(_consInrush, 0);

        let sizingCurrent = maxCurrent;

        // Daisy-chain panels: один автомат защищает всю цепочку, поэтому
        // КАЖДЫЙ кабель внутри цепочки (включая вход на головной щит)
        // подбирается по суммарной нагрузке всей цепочки.
        //
        // Авто-детекция (без chainedFromId): если на входном порту щита
        // подключено ≥2 линии, этот терминал — узел шлейфа. Все щиты,
        // "сидящие" на таких терминалах, объединяются транзитивно.
        try {
          const isChainTerm = (nodeId, port) => {
            let cnt = 0;
            for (const cc of state.conns.values()) {
              if (cc.to.nodeId === nodeId && cc.to.port === port) cnt++;
              if (cnt >= 2) return true;
            }
            return false;
          };
          const involved = new Set();
          // Если c оканчивается на chain-терминал → эта связь — часть шлейфа.
          // Также если c исходит из узла, чей входной порт — chain-терминал
          // и c представляет «перемычку» на следующий щит.
          const toChain = (toN && (toN.type === 'panel' || toN.type === 'junction-box'))
            ? isChainTerm(toN.id, c.to.port) : false;
          if (toChain) involved.add(toN.id);
          // Если fromN — panel и его какой-то вход является chain-терминалом,
          // это означает: fromN — промежуточный щит цепочки, а c уходит с
          // клеммы на следующий peer. Включаем fromN.
          if (fromN && (fromN.type === 'panel' || fromN.type === 'junction-box')) {
            for (let ii = 0; ii < (fromN.inputs || 0); ii++) {
              if (isChainTerm(fromN.id, ii)) { involved.add(fromN.id); break; }
            }
          }
          if (involved.size) {
            // Транзитивно расширяем: все panels, связанные cable с участниками
            // через любой порт (чтобы охватить всю цепочку).
            let grew = true;
            while (grew) {
              grew = false;
              for (const cc of state.conns.values()) {
                const a = state.nodes.get(cc.from.nodeId);
                const b = state.nodes.get(cc.to.nodeId);
                if (!a || !b) continue;
                const aIs = (a.type === 'panel' || a.type === 'junction-box');
                const bIs = (b.type === 'panel' || b.type === 'junction-box');
                if (!aIs || !bIs) continue;
                // связь между двумя панелями: если один уже в chain и
                // терминал с ≥2 связями → включить второй
                const endHub = isChainTerm(cc.to.nodeId, cc.to.port);
                if (!endHub) continue;
                if (involved.has(a.id) && !involved.has(b.id)) { involved.add(b.id); grew = true; }
                if (involved.has(b.id) && !involved.has(a.id)) { involved.add(a.id); grew = true; }
              }
            }
            // Суммарная нагрузка цепочки = сумма downstream-нагрузок каждого
            // участника, исключая двойной счёт внутри (разные участники могут
            // «видеть» друг друга через панели — simpleDownstream считает
            // полный downstream, так что берём max — upstream-root цепочки
            // должен выдержать всю её нагрузку).
            let maxChainKw = 0;
            for (const pid of involved) {
              const kw = simpleDownstream(pid);
              if (kw > maxChainKw) maxChainKw = kw;
            }
            const chainA = computeCurrentA(maxChainKw, U, 0.92, threePhase, _isDC);
            if (chainA > sizingCurrent) {
              sizingCurrent = chainA;
              c._daisyChain = true;
              c._daisyChainSize = involved.size;
            }
          }
        } catch (e) { /* ignore */ }

        // v0.59.97: для individual-группы каждый кабель из N параллельных несёт
        // ток СВОЕГО прибора (а не среднее Itotal/N). Узкое место — максимальный
        // из членов; единое сечение кабеля должно покрывать его. Раньше Iper
        // брался как Itotal/N → при 15/1/3 кВт получалось ~5.7 кВт на жилу
        // (средние) → 1.5мм², а реально 15 кВт требует 4-6 мм².
        // Нормируем sizingCurrent так, чтобы внутри selectCable:
        //   Iper = sizingCurrent / parallel = maxMemberI → корректный подбор.
        if (conductorsInParallel > 1 && toN.type === 'consumer'
            && toN.groupMode === 'individual'
            && Array.isArray(toN.items) && toN.items.length > 0) {
          try {
            const _lf = effectiveLoadFactor(toN);
            let _maxIm = 0;
            for (const m of consumerGroupItems(toN)) {
              const _Im = computeCurrentA(
                m.demandKw * (Number(m.kUse) || 1) * _lf,
                U, m.cosPhi, threePhase, _isDC
              );
              if (_Im > _maxIm) _maxIm = _Im;
            }
            if (_maxIm > 0) {
              c._groupMaxMemberA = _maxIm;
              sizingCurrent = Math.max(maxCurrent, _maxIm * conductorsInParallel);
            }
          } catch {}
        }
        let _sizingMarginForCall = _sizingMarginPct;
        if (c.manualBreakerIn) {
          // Ручной автомат: координируем кабель под заданный In (per-line).
          // Margin уже «зашит» в ручной номинал, не добавляем повторно.
          const minIzPerLine = c.manualBreakerIn;
          const minTotalCurrent = minIzPerLine * conductorsInParallel;
          sizingCurrent = Math.max(maxCurrent, minTotalCurrent);
          _sizingMarginForCall = 0;
          c._breakerUndersize = (c.manualBreakerIn < (maxCurrent / conductorsInParallel));
        } else {
          c._breakerUndersize = false;
        }
        // Режим защиты параллельных жил:
        //   групповая нагрузка (count>1 !serial)  → 'per-line' (N отдельных
        //     автоматов, каждый защищает свой кабель)
        //   одиночная парцелльная в individual    → 'individual' (per-line +
        //     общий автомат на суммарный ток → обе проверки)
        //   одиночная парцелльная в common        → 'common' (один общий
        //     автомат на суммарный ток)
        //   непараллельная (par=1)                → 'individual' (эквивалентно)
        const _isGroupLoadSize = (toN.type === 'consumer'
          && (Number(toN.count) || 1) > 1
          && !toN.serialMode);
        // Приоритет режима защиты: line-override → GLOBAL → 'individual'
        const _protGlobal = GLOBAL.parallelProtection === 'common' ? 'common' : 'individual';
        const _protLine = (c.parallelProtection === 'common' || c.parallelProtection === 'individual')
          ? c.parallelProtection : null;
        const _protMode = _isGroupLoadSize
          ? 'per-line'
          : (conductorsInParallel > 1
              ? (_protLine || _protGlobal)
              : 'individual');
        const sel = calcMethod.selectCable(sizingCurrent, {
          material, insulation, method, ambient, grouping, bundling,
          cableType, maxSize: GLOBAL.maxCableSize,
          parallel: conductorsInParallel,
          breakerMarginPct: _sizingMarginForCall,
          breakerCurve: _curveForSizing,
          protectionMode: _protMode,
        });

        c._ecoSize = null;
        c._cableSize = sel.s;
        c._busbarNom = null;
        c._cableIz = sel.iDerated;
        c._cableTotalIz = sel.totalCapacity;
        c._cableOverflow = !!sel.overflow;
        c._cableAutoParallel = !!sel.autoParallel;
        c._cableParallel = sel.parallel;
        c._cableKt = sel.kT;
        c._cableKg = sel.kG;
        c._cableKtotal = sel.kT * sel.kG;
        // HV: переподбор по реальной таблице XLPE 6/10/35 кВ (IEC 60502-2).
        // Используем ту же методику derating (kT, kG) и тот же I2-критерий, что
        // и для LV, но ампасити берём из HV_TABLES по классу напряжения.
        if (c._isHV) {
          try {
            const hvTbl = hvCableTable(U, material);
            if (hvTbl && hvTbl.length) {
              const kT = sel.kT || 1;
              const kG = sel.kG || 1;
              const k = kT * kG;
              // Минимальное сечение HV — 25 мм² XLPE (механическая прочность).
              const filtered = hvTbl.filter(([s]) => s >= 25 && s <= (GLOBAL.maxCableSize || 800));
              const parallel = sel.parallel || conductorsInParallel || 1;
              const Iper = sizingCurrent / parallel;
              let hvSel = null;
              for (const [s, iRef] of filtered) {
                const iDerated = iRef * k;
                if (iDerated >= Iper) {
                  hvSel = { s, iRef, iDerated };
                  break;
                }
              }
              if (!hvSel && filtered.length) {
                const last = filtered[filtered.length - 1];
                hvSel = { s: last[0], iRef: last[1], iDerated: last[1] * k };
                c._cableOverflow = true;
              }
              if (hvSel) {
                c._cableSize = hvSel.s;
                c._cableIz = hvSel.iDerated;
                c._cableTotalIz = hvSel.iDerated * parallel;
              }
            } else if (c._cableSize && c._cableSize < 25) {
              c._cableSize = 25;
            }
          } catch (e) {
            if (c._cableSize && c._cableSize < 25) c._cableSize = 25;
          }
        }
      }
    } else {
      c._cableSize = null;
      c._busbarNom = null;
      c._cableIz = 0;
      c._cableTotalIz = 0;
      c._cableOverflow = false;
      c._cableAutoParallel = false;
      c._cableParallel = conductorsInParallel;
      c._cableKt = null;
      c._cableKg = null;
      c._cableKtotal = null;
    }
    // Phase 1.20.4: автоматическое уменьшенное сечение N по IEC 60364-5-52
    // §524.2 / ГОСТ Р 50571.5.52 п.524.2. Разрешено для сбалансированной
    // 3-фазной нагрузки при phase > 16 мм² (Cu) / > 25 мм² (Al):
    //   N_min = phase / 2, но не менее 16 мм² (Cu) / 25 мм² (Al).
    // Опцией GLOBAL.allowReducedNeutral = true / false проект включает/
    // отключает этот механизм (default off — консервативно).
    c._neutralSizeMm2 = 0;
    if (GLOBAL.allowReducedNeutral && c._cableSize && !c._busbarNom && !c._isHV && !c._isDC) {
      const phaseS = Number(c._cableSize);
      const isCu = (c.material || GLOBAL.defaultMaterial || 'Cu') === 'Cu';
      const minN = isCu ? 16 : 25;
      const thresh = isCu ? 16 : 25;
      // Подходит только симметричная 3-фазная система с нейтралью
      const cores = c._wireCount || (c._threePhase ? 5 : 3);
      if (phaseS > thresh && cores >= 4) {
        const candidate = Math.max(minN, phaseS / 2);
        // Приводим к стандартному сечению (ближайшее большее из ряда)
        const SERIES = [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];
        let nSel = SERIES.find(s => s >= candidate) || SERIES[SERIES.length - 1];
        if (nSel < phaseS) c._neutralSizeMm2 = nSel;
      }
    }
  }

  // === Подбор защитных автоматов на выходах ===
  // Правило: Iрасч ≤ In ≤ Iz
  //
  // Два физически разных случая параллельности:
  //  A) PARCELLATED (парцелльная линия): один потребитель, кабель разделён
  //     на N жил из-за ампасити → ОДИН общий автомат (общая защита). Признак:
  //     `c._cableAutoParallel === true` — алгоритм сам нарастил параллельность.
  //  B) GROUP (групповая нагрузка): потребитель count > 1 (не serial) —
  //     N отдельных приборов на своих кабелях от общего порта щита. Каждая
  //     линия ЗАЩИЩАЕТСЯ СВОИМ автоматом по току одного прибора; общий
  //     автомат вышестоящего уровня — по суммарному току. Признак:
  //     `toN.type==='consumer' && count>1 && !serialMode`.
  //
  // GLOBAL.parallelProtection: 'individual' | 'common' — применяется ТОЛЬКО к
  // парцелльным линиям (случай A). Групповые нагрузки (случай B) ВСЕГДА
  // защищаются индивидуально, независимо от настройки.
  const _calcMethod = getMethod(GLOBAL.calcMethod);
  const _protIndivGlobal = GLOBAL.parallelProtection === 'individual';
  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    if (!fromN) continue;
    if (fromN.type !== 'panel' && fromN.type !== 'ups' && fromN.type !== 'source') {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      continue;
    }
    const toN = state.nodes.get(c.to.nodeId);
    if (!toN) { c._breakerIn = null; c._breakerPerLine = null; c._breakerCount = 0; continue; }

    // v0.59.328: терминал — если на цепи нет защиты, отходящий кабель
    // защищается вышестоящим автоматом (наследует номинал со стороны входа
    // соответствующего канала). В BOM отдельный автомат НЕ добавляется.
    if (fromN.type === 'panel' && fromN.switchMode === 'terminal') {
      const prot = Array.isArray(fromN.channelProtection) ? fromN.channelProtection : [];
      const outPort = c.from.port | 0;
      if (!prot[outPort]) {
        // Ищем входящий кабель на тот же канал (входной порт == outPort,
        // либо через перемычку в той же группе).
        const N = fromN.inputs || 0;
        const jumps = Array.isArray(fromN.channelJumpers) ? fromN.channelJumpers : [];
        const parent = new Array(N).fill(0).map((_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
        for (const j of jumps) if (Array.isArray(j) && j.length === 2) uni(j[0] | 0, j[1] | 0);
        const gOut = find(outPort);
        let upBrk = null;
        for (const cc of state.conns.values()) {
          if (cc.to.nodeId !== fromN.id) continue;
          if (find((cc.to.port | 0)) !== gOut) continue;
          if (cc._breakerIn && (!upBrk || cc._breakerIn > upBrk)) upBrk = cc._breakerIn;
        }
        c._breakerInternal = true;
        c._breakerInternalSource = 'terminal-passthrough';
        c._breakerExcludeFromBom = true;
        c._breakerIn = upBrk || null;
        c._breakerPerLine = null;
        c._breakerCount = 0;
        const Iz = c._cableIz || 0;
        const par = Math.max(1, c._cableParallel || 1);
        c._breakerAgainstCable = !!(upBrk && Iz > 0 && upBrk > Iz * par);
        c._breakerUndersize = !!(upBrk && c._maxA && upBrk < c._maxA);
        c._breakerCurveEff = 'MCCB';
        continue;
      }
      // иначе — защита в цепи есть, обычный расчёт ниже.
    }

    // Фаза 1.19.9: ввод от городской сети — абстрактный участок по ТУ
    // поставщика. Аппарат защиты подбирается электроснабжающей организацией,
    // мы этот участок не проверяем и не помечаем как «автомат против кабеля».
    if (fromN.type === 'source' && (fromN.sourceSubtype === 'utility' || fromN.sourceSubtype === 'grid')) {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      c._breakerAgainstCable = false;
      c._breakerUndersize = false;
      c._utilityInfeed = true;
      continue;
    }

    // Линия ОТ ИБП: защита — встроенный выходной автомат ИБП (QF3).
    // Если в параметрах ИБП задан outputBreakerIn — используем это
    // значение как номинал защиты линии. Если hasOutputBreaker=false —
    // внешнего автомата нет, ИБП защищает нагрузку внутренними уставками
    // инвертора. В обоих случаях автомат НЕ учитывается в BOM (он часть
    // ИБП, а не отдельная поставляемая позиция). Phase 1.20.65.
    if (fromN.type === 'ups') {
      const hasQF3 = fromN.hasOutputBreaker !== false;
      const IupsOut = Number(fromN.outputBreakerIn) || null;
      const _upsAuto = autoUpsBreakerNominals(fromN);
      c._breakerInternal = true;
      c._breakerInternalSource = 'ups-output-QF3';
      c._breakerExcludeFromBom = true;
      if (c.manualBreakerIn) {
        // Ручной override на линии всё-таки допускаем (экзотика: внешний
        // автомат после ИБП в щите потребителя — тогда он уже НЕ internal).
        c._breakerIn = Number(c.manualBreakerIn);
        c._breakerInternal = false;
        c._breakerExcludeFromBom = false;
      } else if (!hasQF3) {
        c._breakerIn = null;
      } else if (IupsOut) {
        c._breakerIn = IupsOut;
      } else if (_upsAuto.output) {
        // Fallback: расчётный номинал из capacityKw ИБП
        c._breakerIn = _upsAuto.output;
        c._breakerInAuto = true;
      } else {
        c._breakerIn = null;
      }
      c._breakerPerLine = null;
      c._breakerCount = c._breakerIn ? 1 : 0;
      const IzUpsOut = c._cableIz || 0;
      const parUps = Math.max(1, c._cableParallel || 1);
      c._breakerAgainstCable = !!(IzUpsOut > 0 && c._breakerIn && c._breakerIn > IzUpsOut * parUps);
      c._breakerUndersize = !!(c._breakerIn && c._maxA && c._breakerIn < c._maxA);
      c._breakerCurveEff = c.breakerCurve || 'MCCB';
      continue;
    }

    // Линия К ИБП (вход сети или вход байпаса): защита — встроенный
    // вводной автомат ИБП (QF1 / QF2). Аналогично — не учитывается в BOM.
    if (toN.type === 'ups') {
      // Определяем направление: основной вход (QF1) или вход байпаса (QF2).
      // В простом случае (bypassMode='jumper') — только один вход QF1.
      // В separate-режиме и для второго входа — QF2 (байпасный).
      const isBypassIn = (c.to.port === 'bypass' || c.upsInputKind === 'bypass');
      const hasQF = isBypassIn
        ? (toN.hasInputBypassBreaker !== false)
        : (toN.hasInputBreaker !== false);
      const IupsIn = isBypassIn
        ? (Number(toN.inputBypassBreakerIn) || null)
        : (Number(toN.inputBreakerIn) || null);
      const _upsAutoIn = autoUpsBreakerNominals(toN);
      const _upsAutoVal = isBypassIn ? _upsAutoIn.inputBypass : _upsAutoIn.input;
      c._breakerInternal = true;
      c._breakerInternalSource = isBypassIn ? 'ups-input-QF2' : 'ups-input-QF1';
      c._breakerExcludeFromBom = true;
      if (c.manualBreakerIn) {
        c._breakerIn = Number(c.manualBreakerIn);
        c._breakerInternal = false;
        c._breakerExcludeFromBom = false;
      } else if (!hasQF) {
        c._breakerIn = null;
      } else if (IupsIn) {
        c._breakerIn = IupsIn;
      } else if (_upsAutoVal) {
        c._breakerIn = _upsAutoVal;
        c._breakerInAuto = true;
      } else {
        c._breakerIn = null;
      }
      c._breakerPerLine = null;
      c._breakerCount = c._breakerIn ? 1 : 0;
      const IzUpsIn = c._cableIz || 0;
      const parUpsIn = Math.max(1, c._cableParallel || 1);
      c._breakerAgainstCable = !!(IzUpsIn > 0 && c._breakerIn && c._breakerIn > IzUpsIn * parUpsIn);
      c._breakerUndersize = !!(c._breakerIn && c._maxA && c._breakerIn < c._maxA);
      c._breakerCurveEff = c.breakerCurve || 'MCCB';
      continue;
    }

    // Для HV (> 1 кВ) — VCB/SF6 высоковольтные аппараты (IEC 62271-100).
    // Ряд номиналов 200..4000 А. Подбор — ближайший больший к расчётному току.
    // По умолчанию для HV берётся VCB (_breakerType='VCB'), если не задан иной.
    if (c._isHV) {
      const IhvTotal = c._maxA || 0;
      const hvParallel = Math.max(1, c._cableParallel || 1);
      const IhvPer = IhvTotal / hvParallel;
      const _hvMarginK = 1 + (Number(GLOBAL.breakerMinMarginPct) || 0) / 100;
      if (c.manualBreakerIn) {
        c._breakerIn = Number(c.manualBreakerIn);
      } else if (IhvPer > 0) {
        c._breakerIn = selectHvBreaker(IhvTotal * _hvMarginK);
      } else {
        c._breakerIn = null;
      }
      if (!c.breakerCurve || !String(c.breakerCurve).startsWith('VCB') && !String(c.breakerCurve).startsWith('SF6')) {
        c._breakerCurveEff = 'VCB';
      } else {
        c._breakerCurveEff = c.breakerCurve;
      }
      c._breakerPerLine = null;
      c._breakerCount = c._breakerIn ? 1 : 0;
      const IzHv = c._cableIz || 0;
      c._breakerAgainstCable = !!(IzHv > 0 && c._breakerIn && c._breakerIn > IzHv * hvParallel);
      continue;
    }

    const parallel = Math.max(1, c._cableParallel || 1);
    const Itotal = c._maxA || 0;
    // v0.59.97: для individual-группы Iper — ток самого нагруженного прибора,
    // а не среднее Itotal/parallel. Значение вычислено и сохранено в фазе
    // подбора кабеля как c._groupMaxMemberA.
    const Iper = (c._groupMaxMemberA > 0)
      ? c._groupMaxMemberA
      : (Itotal / parallel);
    const Iz = c._cableIz || 0;

    if (Iper <= 0) {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      continue;
    }

    // Запас по автомату: приоритет — ручной override на линии (c.breakerMarginPct),
    // далее — свойство потребителя (toN.breakerMarginPct), далее — по категории
    // (каталог), иначе — авто по inrushFactor. GLOBAL.breakerMinMarginPct —
    // нижний порог (минимум), не подменяющий категорию.
    const _inrushK = (toN && toN.type === 'consumer')
      ? (Number(toN.inrushFactor) || 1)
      : 1;
    const _catalogMargin = (toN && toN.type === 'consumer' && typeof toN.breakerMarginPct === 'number')
      ? toN.breakerMarginPct
      : null;
    const _lineMargin = (typeof c.breakerMarginPct === 'number') ? c.breakerMarginPct : null;
    const _autoMargin = autoBreakerMargin(_inrushK);
    const _minMargin = Number(GLOBAL.breakerMinMarginPct) || 0;
    const _effMarginPct = Math.max(
      _minMargin,
      (_lineMargin != null) ? _lineMargin
        : (_catalogMargin != null) ? _catalogMargin
        : _autoMargin
    );
    c._breakerMarginPctEff = _effMarginPct;
    c._breakerMarginSource = (_lineMargin != null) ? 'line'
      : (_catalogMargin != null) ? 'consumer'
      : 'auto';
    const _marginK = 1 + _effMarginPct / 100;
    const _manualIn = c.manualBreakerIn ? Number(c.manualBreakerIn) : 0;
    let InPerLine = _calcMethod.selectBreaker(Iper * _marginK);
    let InTotal = _calcMethod.selectBreaker(Itotal * _marginK);
    // Ручной номинал применяем к «главному» автомату, который и отображается
    // на схеме (и в инспекторе). Для single/common — это InTotal/общий; для
    // group-load — InPerLine (у каждой линии свой). Для parallel+individual —
    // InTotal (общий), а InPerLine пересчитываем как manualIn/parallel (окр. вверх
    // по стандартному ряду), чтобы оба значения были согласованы.
    if (_manualIn > 0) {
      const _isGroupLoadManual = (toN.type === 'consumer'
        && (Number(toN.count) || 1) > 1
        && !toN.serialMode);
      const _protLineEffM = (c.parallelProtection === 'common' || c.parallelProtection === 'individual')
        ? c.parallelProtection : null;
      const _effProtIndivM = _protLineEffM ? (_protLineEffM === 'individual') : _protIndivGlobal;
      if (parallel > 1 && _isGroupLoadManual) {
        InPerLine = _manualIn;
      } else if (parallel > 1 && _effProtIndivM) {
        InTotal = _manualIn;
        InPerLine = _calcMethod.selectBreaker(_manualIn / parallel);
      } else if (parallel > 1) {
        InTotal = _manualIn;
      } else {
        InPerLine = _manualIn;
        InTotal = _manualIn;
      }
    }
    // Всегда полная координация In ≤ Iz (IEC 60364-4-43)
    c._breakerAgainstCable = !!(Iz > 0 && InPerLine > Iz);
    c._breakerI2fail = false;

    // Определяем тип параллельности: групповая нагрузка или парцелльная линия
    const isGroupLoad = (toN.type === 'consumer'
      && (Number(toN.count) || 1) > 1
      && !toN.serialMode);

    // Line-level override режима защиты (c.parallelProtection) имеет
    // приоритет над GLOBAL. Групповые нагрузки всегда per-line.
    const _protLineEff = (c.parallelProtection === 'common' || c.parallelProtection === 'individual')
      ? c.parallelProtection : null;
    const _effProtIndiv = _protLineEff
      ? (_protLineEff === 'individual')
      : _protIndivGlobal;
    c._parallelProtectionEff = isGroupLoad
      ? 'per-line'
      : (parallel > 1 ? (_effProtIndiv ? 'individual' : 'common') : 'single');

    if (parallel > 1 && isGroupLoad) {
      // ГРУППОВАЯ нагрузка (N отдельных приборов, каждый на своём кабеле):
      // В щите стоит по автомату на КАЖДУЮ линию (parallel штук по InPerLine).
      c._breakerIn = null;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
    } else if (parallel > 1 && _effProtIndiv) {
      // ПАРЦЕЛЛЬНАЯ линия, режим individual: каждая жила своим автоматом + общий.
      // Координация двойная: InPerLine ≤ Iz per-line и InTotal ≤ Iz·n.
      c._breakerIn = InTotal;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
      const failPer = (Iz > 0 && InPerLine > Iz);
      const failTotal = (Iz > 0 && InTotal > Iz * parallel);
      c._breakerAgainstCable = !!(failPer || failTotal);
    } else if (parallel > 1) {
      // Общая защита (common): один автомат на полный ток
      c._breakerIn = InTotal;
      c._breakerPerLine = null;
      c._breakerCount = 1;
      c._breakerAgainstCable = !!(Iz > 0 && InTotal > Iz * parallel);
      c._breakerI2fail = false;
    } else {
      c._breakerIn = InPerLine;
      c._breakerPerLine = null;
      c._breakerCount = 1;
    }

    // v0.57.57: защита предохранителем — post-process. Конвертируем
    // рассчитанные номиналы (автомат) в ближайший больший предохранитель
    // из ряда IEC 60269-1 и помечаем флагами _protectionKind/_fuseType.
    // Ручной номинал c.manualFuseIn имеет приоритет.
    if (c.protectionKind === 'fuse') {
      const fuseType = c.fuseType || 'gG';
      const manualFuse = Number(c.manualFuseIn) || 0;
      if (manualFuse > 0) {
        // Тот же manual-распределения что и для автомата
        if (parallel > 1 && isGroupLoad) {
          c._breakerPerLine = manualFuse;
        } else if (parallel > 1 && _effProtIndiv) {
          c._breakerIn = manualFuse;
          c._breakerPerLine = selectFuse(manualFuse / parallel);
        } else {
          c._breakerIn = manualFuse;
          if (c._breakerPerLine) c._breakerPerLine = manualFuse;
        }
      } else {
        if (c._breakerIn) c._breakerIn = selectFuse(c._breakerIn);
        if (c._breakerPerLine) c._breakerPerLine = selectFuse(c._breakerPerLine);
      }
      c._protectionKind = 'fuse';
      c._fuseType = fuseType;
      // Координация fuse/кабель: I2 = 1.6·In (gG/gM/aM), должно быть
      // ≤ 1.45·Iz → In ≤ 0.906·Iz. Делаем строгую проверку отдельно.
      const checkFuse = (In, IzEff) => Iz > 0 && In > IzEff * 0.906;
      const izEff = Iz;
      const izTotalEff = Iz * (parallel || 1);
      if (parallel > 1 && isGroupLoad) {
        c._breakerAgainstCable = !!(c._breakerPerLine && checkFuse(c._breakerPerLine, izEff));
      } else if (parallel > 1 && _effProtIndiv) {
        const failPer = !!(c._breakerPerLine && checkFuse(c._breakerPerLine, izEff));
        const failTot = !!(c._breakerIn && Iz > 0 && c._breakerIn > izTotalEff * 0.906);
        c._breakerAgainstCable = failPer || failTot;
      } else if (parallel > 1) {
        c._breakerAgainstCable = !!(c._breakerIn && Iz > 0 && c._breakerIn > izTotalEff * 0.906);
      } else {
        c._breakerAgainstCable = !!(c._breakerIn && checkFuse(c._breakerIn, izEff));
      }
    } else {
      c._protectionKind = 'breaker';
      c._fuseType = null;
    }

    // Тип/кривая автомата: ручной (c.breakerCurve) → подсказка потребителя
    // (toN.curveHint) → авто по inrush + In. Для MCCB/ACB — всегда по In.
    const _refIn = c._breakerIn || c._breakerPerLine || 0;
    const _consumerHint = (toN && toN.type === 'consumer' && toN.curveHint) ? toN.curveHint : null;
    let _curveEff;
    if (c.breakerCurve) {
      _curveEff = c.breakerCurve;
    } else if (_refIn > 125) {
      // Для In > 125 А MCB недоступен — тип определяется по номиналу
      _curveEff = autoBreakerCurve(_inrushK, _refIn);
    } else if (_consumerHint) {
      _curveEff = _consumerHint;
    } else {
      _curveEff = autoBreakerCurve(_inrushK, _refIn);
    }
    // v0.57.88: sanity-check. IEC 60898 ограничивает MCB до 125 А.
    // Если пользователь (или старые данные) сохранили MCB_B/C/D/K/Z,
    // а номинал вырос выше предела — переключаем на соответствующий
    // MCCB/ACB по autoBreakerCurve, иначе TCC-кривая и селективность
    // будут считаться по неправильной характеристике.
    if (_refIn > 125 && /^MCB_/.test(String(_curveEff))) {
      _curveEff = autoBreakerCurve(_inrushK, _refIn);
    }
    c._breakerCurveEff = _curveEff;

    // Для регулируемых автоматов (MCCB/ACB) — авто-настройка Ir/Isd/tsd/Ii
    // из параметров защиты потребителя, если не задано вручную в c.breakerSettings.
    // Эти значения подхватываются TCC-графиком и селективностью.
    const _isAdjustable = (_curveEff === 'MCCB' || _curveEff === 'ACB' || _curveEff === 'VCB' || _curveEff === 'SF6');
    if (_isAdjustable && _refIn > 0) {
      const brkType = BREAKER_TYPES[_curveEff] || BREAKER_TYPES.MCCB;
      const Ib = (c._breakerIn ? Itotal : Iper);
      // Ir (long-time): подстраиваем к Iрасч с шагом 0.05·In (типовой MCCB),
      // не ниже Iрасч, не выше номинала.
      const irTarget = Math.min(_refIn, Math.max(Ib, Ib * 1.0));
      const irStep = _refIn * 0.05;
      let Ir = Math.ceil(irTarget / irStep) * irStep;
      if (Ir > _refIn) Ir = _refIn;
      if (Ir < Ib) Ir = Math.min(_refIn, Math.ceil(Ib / irStep) * irStep);
      // Isd (short-time pickup) — по inrushFactor потребителя, в пределах
      // диапазона кривой (magMin..magMax).
      const inrushX = Math.max(1.5, _inrushK * 1.2); // +20% от пуска
      const isdX = Math.min(brkType.magMax || 10, Math.max(brkType.magMin || 5, inrushX));
      const Isd = Math.round(isdX * Ir);
      // tsd (short-time delay) — 0.2 с по умолчанию (селективность нижний уровень).
      const tsd = 0.2;
      // Ii (instantaneous) — ограничивает пиковый ток КЗ.
      const Ii = Math.round((brkType.magMax || 10) * Ir);
      const manual = c.breakerSettings || {};
      c._breakerSettings = {
        Ir: (manual.Ir != null ? Number(manual.Ir) : Math.round(Ir)),
        Isd: (manual.Isd != null ? Number(manual.Isd) : Isd),
        tsd: (manual.tsd != null ? Number(manual.tsd) : tsd),
        Ii: (manual.Ii != null ? Number(manual.Ii) : Ii),
        source: Object.keys(manual).length ? 'manual' : 'auto',
      };
    } else {
      c._breakerSettings = null;
    }
    // DC-линии требуют DC-rated автомата (иначе дуга не гасится).
    // Стандартный MCCB рассчитан на AC; для DC нужен MCCB с маркировкой
    // DC (напр. ABB Tmax XT DC, Schneider Compact NSX DC) или специальный
    // DC-автомат. Флаг используется в рендере/отчёте для предупреждения.
    c._breakerDcRequired = !!c._isDC;
  }

  // === Расчёт финального cos φ, P/Q/S и токов для щитов / ИБП / источников ===
  // Ik считаем упрощённо: при базовом сопротивлении источника.
  // Zsource_default = 0.05 Ом на фазе (соответствует ~8 кА короткого на 400 В).
  // Вдоль линии каждый метр добавляет R = ρ × L × 2 / S.
  const RHO = { Cu: 0.0178, Al: 0.0285 }; // Ом·мм²/м

  for (const n of state.nodes.values()) {
    if (n.type === 'panel' && n.switchMode === 'sectioned') {
      // Многосекционный контейнер — будет обсчитан во втором проходе
      // через _sectionedContainerAgg (дедуп по всему downstream-дереву,
      // учёт одновременной max-нагрузки, а не суммы выходов секций).
      const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
      n._powered = secIds.some(sid => state.nodes.get(sid)?._powered);
    } else if (n.type === 'panel') {
      // cos φ из downstream PQ (для взвешенного среднего),
      // но P/Q/S привязаны к фактической _loadKw (walkUp уже учёл share)
      const pq = downstreamPQ(n.id);
      n._cosPhi = (pq.P > 0) ? (pq.P / Math.sqrt(pq.P * pq.P + pq.Q * pq.Q)) : null;
      const cos = n._cosPhi || GLOBAL.defaultCosPhi;
      const kSim = Number(n.kSim) || 1;
      const P = (n._loadKw || 0) * kSim;
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = P;
      n._powerQ = P * tan;
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._calcKw = (n._loadKw || 0) * kSim;
      n._loadA = n._calcKw > 0 ? computeCurrentA(n._calcKw, nodeCalcVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;
      // Максимально возможная нагрузка (все потребители на 100%)
      // Для щита коммутации (switchPanel) — MAX по сценариям генератора,
      // т.к. одновременно включаются только выходы одного сценария.
      let panelMaxKw = null;
      for (const gen of state.nodes.values()) {
        if (gen.type !== 'generator' || gen.switchPanelId !== n.id) continue;
        const gGroups = Array.isArray(gen.triggerGroups) ? gen.triggerGroups : [];
        if (!gGroups.length) continue;
        // Этот щит управляется генератором — считаем MAX по сценариям
        let maxScKw = 0;
        for (const grp of gGroups) {
          const outs = Array.isArray(grp.activateOutputs) ? grp.activateOutputs : [];
          if (!outs.length) continue;
          const visitedC = new Set(), visitedU = new Set();
          let dKw = 0, uKw = 0, chKw = 0, sEff = 0, uCnt = 0;
          function scWalk(nid, path, thruUps) {
            if (path.has(nid)) return;
            path.add(nid);
            for (const c of state.conns.values()) {
              if (c.from.nodeId !== nid || c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
              const to = state.nodes.get(c.to.nodeId);
              if (!to) continue;
              if (to.type === 'consumer') {
                if (visitedC.has(to.id)) continue; visitedC.add(to.id);
                const kw = consumerTotalDemandKw(to);
                if (thruUps) uKw += kw; else dKw += kw;
              } else if (to.type === 'ups') {
                if (visitedU.has(to.id)) continue; visitedU.add(to.id);
                sEff += Math.max(0.01, (Number(to.efficiency)||100)/100);
                chKw += upsChargeKw(to); uCnt++;
                scWalk(to.id, new Set(path), true);
              } else if (to.type === 'generator' && to.auxInput && c.to.port === 0) {
                // ФИКС: auxInput ДГУ — питает только его собственные нужды
                // (auxDemandKw). Не обходим downstream генератора (он сам
                // генерирует свою выходную мощность из топлива).
                if (visitedC.has(to.id)) continue; visitedC.add(to.id);
                const auxKw = Number(to.auxDemandKw) || 0;
                if (auxKw > 0) {
                  if (thruUps) uKw += auxKw; else dKw += auxKw;
                }
                // НЕ вызываем scWalk — обход останавливается
              } else { scWalk(to.id, new Set(path), thruUps); }
            }
          }
          for (const outPort of outs) {
            for (const c of state.conns.values()) {
              if (c.from.nodeId !== n.id || c.from.port !== outPort) continue;
              if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
              const to = state.nodes.get(c.to.nodeId);
              if (to) scWalk(to.id, new Set(), false);
            }
          }
          const aEff = uCnt > 0 ? sEff / uCnt : 1;
          const scKw = dKw + uKw / aEff + chKw;
          if (scKw > maxScKw) maxScKw = scKw;
        }
        panelMaxKw = maxScKw;
        break; // один генератор управляет этим щитом
      }
      n._maxLoadKw = panelMaxKw !== null ? panelMaxKw : maxDownstreamLoad(n.id);
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeCalcVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;

      // Проверка номинала шкафа — в амперах (основная единица для щитов).
      // margin% = (In - Iрасч) / Iрасч × 100
      // Параллельно считаем эквивалентную номинальную мощность для справки.
      const capA = Number(n.capacityA) || 0;
      const loadA = n._loadA || 0;
      if (capA > 0) {
        // Вычисляем эквивалентную номинальную мощность шкафа при текущем
        // напряжении и cos φ (или default cos φ если downstream пусто).
        const cos = n._cosPhi || GLOBAL.defaultCosPhi;
        n._capacityKwFromA = capA * nodeCalcVoltage(n) * (isThreePhase(n) ? Math.sqrt(3) : 1) * cos / 1000;
      } else {
        n._capacityKwFromA = 0;
      }
      // Сравниваем номинал с МАКСИМАЛЬНЫМ расчётным током (не текущим)
      const maxA = n._maxLoadA || 0;
      if (capA > 0 && maxA > 0) {
        const margin = ((capA - maxA) / maxA) * 100;
        n._marginPct = margin;
        const hi = Number(n.marginMaxPct);
        const maxP = isFinite(hi) ? hi : 30;
        if (margin < 0) n._marginWarn = 'undersize';   // номинал < макс.тока → красный
        else if (margin > maxP) n._marginWarn = 'oversize'; // избыточный запас → фиолетовый
        else n._marginWarn = null;
      } else {
        n._marginPct = null;
        n._marginWarn = null;
      }

      // Фаза 1.19.3: Ik3 на MV-шинах (IEC 60909) с учётом MV-кабелей.
      // Алгоритм:
      //  1. Для каждого активного входа MV-щита находим upstream-source
      //  2. Берём его импеданс (Zs) в Омах на стороне щита
      //  3. Прибавляем импеданс кабеля между source и этим MV-щитом
      //     (R = rho×L/S, X типовое 0.10-0.12 Ом/км для MV-кабелей)
      //  4. I_k3 = c × U_n / (√3 × Z_total), c=1.1
      //  5. i_p = κ × √2 × I_k3 где κ зависит от X/R
      //
      // Ударный коэффициент κ = 1.02 + 0.98 × e^(−3/(X/R))
      if (n.isMv) {
        try {
          const ai = activeInputs(n.id);
          if (ai && ai.length) {
            let minZ_ohm = Infinity, minR = 0, minX = 0;
            const Un_V = nodeVoltage(n);  // линейное напряжение на шинах щита
            for (const { conn } of ai) {
              const up = state.nodes.get(conn.from.nodeId);
              if (!up || !up._ikA) continue;
              // Импеданс источника: Zs = c × U / (√3 × Ik)
              const Zs = (1.1 * Un_V) / (Math.sqrt(3) * up._ikA);
              // Типовое X/R для MV-source: ~10
              const xr_src = 10;
              const Zs_R = Zs / Math.sqrt(1 + xr_src * xr_src);
              const Zs_X = Zs_R * xr_src;
              // Импеданс MV-кабеля (если есть)
              let Zc_R = 0, Zc_X = 0;
              const S = Number(conn._cableSize) || 0;
              const L = Number(conn.lengthM) || 0;
              if (S > 0 && L > 0) {
                const rho = (conn.material === 'Al') ? 0.0287 : 0.0175;
                const parallel = Math.max(1, conn._cableParallel || 1);
                Zc_R = (rho * L / S) / parallel;
                const X0 = S <= 50 ? 0.12 : (S <= 150 ? 0.11 : 0.10); // Ом/км
                Zc_X = (X0 * L / 1000) / parallel;
              }
              const R_sum = Zs_R + Zc_R;
              const X_sum = Zs_X + Zc_X;
              const Z_sum = Math.sqrt(R_sum * R_sum + X_sum * X_sum);
              if (Z_sum > 0 && Z_sum < minZ_ohm) {
                minZ_ohm = Z_sum;
                minR = R_sum;
                minX = X_sum;
              }
            }
            if (minZ_ohm < Infinity && minZ_ohm > 0) {
              const Ik3_A = (1.1 * Un_V) / (Math.sqrt(3) * minZ_ohm);
              n._Ik3_kA = Ik3_A / 1000;
              n._Ik3_Z_ohm = minZ_ohm;
              // Ударный коэффициент κ по IEC 60909
              const xr = minR > 0 ? minX / minR : 10;
              const kappa = 1.02 + 0.98 * Math.exp(-3 / Math.max(0.1, xr));
              n._ip_kA = kappa * Math.sqrt(2) * n._Ik3_kA;
              n._Ik3_kappa = kappa;
              // Проверка стойкости шин (Icu из mv-switchgear)
              if (typeof globalThis.__raschetElementLibrary?.getElement === 'function' && n.mvSwitchgearId) {
                const rec = globalThis.__raschetElementLibrary.getElement(n.mvSwitchgearId);
                const It = rec?.kindProps?.It_kA;
                if (It && n._Ik3_kA > It) {
                  n._mvIkOverload = true;
                }
              }
            }
          }
        } catch (e) { /* silent */ }
      }
    } else if (n.type === 'ups') {
      // Максимальная нагрузка на ИБП с учётом:
      //  1) share между параллельными ИБП на одном downstream-щите (если
      //     2 ИБП питают общий щит, каждый видит половину макс. нагрузки),
      //  2) физического лимита: ИБП не может выдать больше capacityKw.
      //     Если downstream-share > capacityKw — это сценарий перегруза,
      //     ставим флаг n._maxOverload.
      const cap = Number(n.capacityKw) || 0;
      const rawMax = maxDownstreamLoad(n.id);
      // Определяем кол-во параллельных ИБП на одном downstream-щите
      let upsShare = 1;
      for (const c2 of state.conns.values()) {
        if (c2.from.nodeId !== n.id || c2.lineMode === 'damaged' || c2.lineMode === 'disabled') continue;
        const dest = state.nodes.get(c2.to.nodeId);
        if (!dest || dest.type !== 'panel') continue;
        let peerCount = 0;
        for (const c3 of state.conns.values()) {
          if (c3.to.nodeId !== dest.id || c3.lineMode === 'damaged' || c3.lineMode === 'disabled') continue;
          const feeder = state.nodes.get(c3.from.nodeId);
          if (feeder && feeder.type === 'ups') peerCount++;
        }
        if (peerCount > 1) upsShare = 1 / peerCount;
        break;
      }
      const sharedMax = rawMax * upsShare;
      // Физический лимит ИБП: нельзя отдать больше номинала.
      // Если downstream-share > cap → перегруз.
      n._maxDownstreamUncapped = sharedMax;
      n._maxOverload = cap > 0 && sharedMax > cap;
      n._maxLoadKw = cap > 0 ? Math.min(sharedMax, cap) : sharedMax;
      if (n._maxOverload) n._overload = true;
      // P/Q/cosPhi/_loadA для ИБП: P из _loadKw (walkUp), Q по режиму
      // (байпас → пропорциональная доля downstream Q; инвертор → Q=0).
      n._powerP = n._loadKw || 0;
      if (n._onStaticBypass) {
        const sub = downstreamPQ(n.id);
        const ratio = (sub.P > 0 && n._loadKw > 0) ? (n._loadKw / sub.P) : 1;
        n._powerQ = sub.Q * ratio;
      } else {
        n._powerQ = 0;
      }
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._cosPhi = n._powerS > 0 ? (n._powerP / n._powerS) : (Number(n.cosPhi) || GLOBAL.defaultCosPhi);
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeCalcVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeCalcVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'source' || n.type === 'generator') {
      // cos φ из downstream PQ, но P/S привязаны к _loadKw (walkUp result)
      const pq = downstreamPQ(n.id);
      n._cosPhi = (pq.P > 0) ? (pq.P / Math.sqrt(pq.P * pq.P + pq.Q * pq.Q)) : Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      const cos = n._cosPhi;
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = n._loadKw || 0;
      n._powerQ = n._powerP * tan;
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeCalcVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      // Максимально возможная нагрузка.
      // Для генератора с triggerGroups: MAX по всем сценариям.
      // Каждый сценарий = сумма нагрузок за выходами switchover-щита,
      // которые включаются в данном сценарии (activateOutputs).
      const genGroups = Array.isArray(n.triggerGroups) ? n.triggerGroups : [];
      const switchPanel = n.switchPanelId ? state.nodes.get(n.switchPanelId) : null;

      if (genGroups.length && switchPanel) {
        let maxScenarioKw = 0;
        for (const grp of genGroups) {
          const outs = Array.isArray(grp.activateOutputs) ? grp.activateOutputs : [];
          if (!outs.length) continue;
          // Собираем все downstream-узлы сценария и считаем
          // уникальных потребителей через единый walk (один visited set)
          const scenarioStartNodes = [];
          for (const outPort of outs) {
            for (const c of state.conns.values()) {
              if (c.from.nodeId !== switchPanel.id || c.from.port !== outPort) continue;
              if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
              const toN = state.nodes.get(c.to.nodeId);
              if (toN) scenarioStartNodes.push(toN.id);
            }
          }
          // Единый подсчёт с общим visited — без двойного счёта потребителей
          const visitedC = new Set();
          const visitedU = new Set();
          let directKw = 0, upsConsKw = 0, totalCharge = 0;
          let sumEff = 0, uCnt = 0;
          function scenarioWalk(nid, path, throughUps) {
            if (path.has(nid)) return;
            path.add(nid);
            for (const c of state.conns.values()) {
              if (c.from.nodeId !== nid || c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
              const to = state.nodes.get(c.to.nodeId);
              if (!to) continue;
              if (to.type === 'consumer') {
                if (visitedC.has(to.id)) continue;
                visitedC.add(to.id);
                const kw = consumerTotalDemandKw(to);
                if (throughUps) upsConsKw += kw; else directKw += kw;
              } else if (to.type === 'ups') {
                if (visitedU.has(to.id)) continue;
                visitedU.add(to.id);
                const eff = Math.max(0.01, (Number(to.efficiency) || 100) / 100);
                totalCharge += upsChargeKw(to);
                sumEff += eff; uCnt++;
                scenarioWalk(to.id, new Set(path), true);
              } else if (to.type === 'panel' || to.type === 'channel' || to.type === 'junction-box') {
                scenarioWalk(to.id, new Set(path), throughUps);
              }
            }
          }
          for (const startId of scenarioStartNodes) {
            scenarioWalk(startId, new Set(), false);
          }
          const avgEff = uCnt > 0 ? (sumEff / uCnt) : 1;
          const scenarioKw = directKw + upsConsKw / avgEff + totalCharge;
          if (scenarioKw > maxScenarioKw) maxScenarioKw = scenarioKw;
        }
        n._maxLoadKw = maxScenarioKw;
      } else {
        // Единый обход через maxDownstreamLoad — учитывает bus-tie между секциями
        // и дедуплицирует потребителей, поэтому никаких отдельных tie-сценариев
        // складывать сверху НЕ нужно.
        n._maxLoadKw = maxDownstreamLoad(n.id);
      }
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeCalcVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      // Ток КЗ на шинах источника: Ik = c × U / (√3 × Zs), c=1.1 (IEC 60909)
      const Uph = nodeVoltageLN(n);
      const Zs = sourceImpedance(n);
      n._ikA = Zs > 0 ? (1.1 * Uph / Zs) : Infinity;
    } else if (n.type === 'consumer') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._nominalA = consumerNominalCurrent(n);
      n._ratedA = consumerRatedCurrent(n);
      n._inrushA = consumerInrushCurrent(n);
      // Мгновенные P / Q потребителя
      const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
      const p = consumerTotalDemandKw(n) * k;
      const cos = Math.max(0.1, Math.min(1, n._cosPhi));
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = p;
      n._powerQ = p * tan;
      n._powerS = Math.sqrt(p * p + (p * tan) * (p * tan));
    }
  }

  // Второй проход: многосекционные контейнеры агрегируют параметры
  // уже посчитанных секций (на первом проходе порядок Map мог быть таким,
  // что контейнер обрабатывался раньше своих секций).
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    // Агрегация с дедупликацией: обходим весь downstream-дерево всех секций
    // с общим visited-set, чтобы один потребитель, достижимый через bus-tie
    // или несколько путей, считался один раз. Максимальная нагрузка — по
    // фактическому одновременному потреблению, а не сумма выходов секций.
    const agg = _sectionedContainerAgg(n);
    n._loadKw = agg.P;
    n._maxLoadKw = agg.maxKw;
    n._powered = secIds.some(sid => state.nodes.get(sid)?._powered);
    n._powerP = agg.P;
    n._powerQ = agg.Q;
    n._powerS = Math.sqrt(agg.P * agg.P + agg.Q * agg.Q);
    n._cosPhi = (agg.P > 0) ? (agg.P / n._powerS) : null;
    n._calcKw = agg.P;
    const cosAggPre = n._cosPhi || GLOBAL.defaultCosPhi;
    n._loadA = agg.P > 0
      ? computeCurrentA(agg.P, nodeCalcVoltage(n), cosAggPre, isThreePhase(n))
      : 0;
    n._maxLoadA = agg.maxKw > 0
      ? computeCurrentA(agg.maxKw, nodeCalcVoltage(n), cosAggPre, isThreePhase(n))
      : 0;
    // Номинал многосекционного щита определяется автоматически:
    //  - не меньше максимального номинала среди секций (сборка через СВ
    //    ограничена самой слабой секцией/секционным выключателем),
    //  - не меньше фактического максимального протекающего тока _maxLoadA,
    //    округлённого вверх до стандартного номинала серии BREAKER_SERIES.
    // Ручной ввод capacityA для sectioned-контейнера не используется.
    let secMaxCap = 0;
    for (const sid of secIds) {
      const s = state.nodes.get(sid);
      if (s && Number(s.capacityA) > secMaxCap) secMaxCap = Number(s.capacityA);
    }
    const loadMaxA = n._maxLoadA || 0;
    const rawReq = Math.max(secMaxCap, loadMaxA);
    let autoCapA = secMaxCap;
    if (loadMaxA > secMaxCap && rawReq > 0) {
      // Подбираем ближайший стандартный номинал, ≥ loadMaxA
      for (const In of BREAKER_SERIES) {
        if (In >= rawReq) { autoCapA = In; break; }
      }
      if (autoCapA < rawReq) autoCapA = BREAKER_SERIES[BREAKER_SERIES.length - 1] || rawReq;
    }
    n.capacityA = autoCapA;
    const capA = Number(n.capacityA) || 0;
    const cosAgg = n._cosPhi || GLOBAL.defaultCosPhi;
    if (capA > 0) {
      n._capacityKwFromA = capA * nodeCalcVoltage(n) * (isThreePhase(n) ? Math.sqrt(3) : 1) * cosAgg / 1000;
      const maxA = n._maxLoadA || 0;
      if (maxA > 0) {
        const margin = ((capA - maxA) / maxA) * 100;
        n._marginPct = margin;
        const hi = Number(n.marginMaxPct);
        const maxP = isFinite(hi) ? hi : 30;
        if (margin < 0) n._marginWarn = 'undersize';
        else if (margin > maxP) n._marginWarn = 'oversize';
        else n._marginWarn = null;
      } else { n._marginPct = null; n._marginWarn = null; }
    } else {
      n._capacityKwFromA = 0;
      n._marginPct = null; n._marginWarn = null;
    }
  }

  // v0.59.330: о длине для passthrough-кабелей клеммной коробки.
  // Электрически passthrough-участок — продолжение вышестоящего кабеля,
  // но SC/vdrop калькулятор уже обходит граф сегмент-за-сегментом и
  // складывает падения по каждому _cableLength. Суммировать длину
  // в один кабель нельзя (двойной счёт), поэтому оставляем _cableLength
  // собственным. Для breaker'а upstream'а проверка Ik в точке terminal-
  // output выполняется через Ik(toN) passthrough-кабеля — уже корректно.

  // === Ток КЗ Ik в каждой точке схемы ===
  // Ik распространяется от источника вниз по активным линиям.
  // Каждый участок кабеля добавляет сопротивление: R = ρ × L × 2 / S / N
  // где N — число параллельных жил.
  // Подход: для каждого узла идём вверх по активному фидеру до источника,
  // накапливаем импеданс, считаем Ik = Uph / Ztot.
  function nodeIk(nid, visited) {
    visited = visited || new Set();
    if (visited.has(nid)) return Infinity;
    visited.add(nid);
    const n = state.nodes.get(nid);
    if (!n) return Infinity;
    if (n.type === 'source' || n.type === 'generator') {
      const Uph = nodeVoltageLN(n);
      const Zs = sourceImpedance(n);
      return Zs > 0 ? (1.1 * Uph / Zs) : Infinity;
    }
    // ИБП в норме — сам ограничивает Ik до ~1.5..2× номинала
    if (n.type === 'ups' && !n._onStaticBypass) {
      return (n._loadA || 0) * 2 + 50;
    }
    // Ищем активный фидер, через него идём вверх
    for (const c of state.conns.values()) {
      if (c.to.nodeId !== nid) continue;
      if (c._state !== 'active') continue;
      const upIk = nodeIk(c.from.nodeId, visited);
      if (!isFinite(upIk) || upIk <= 0) continue;
      // Добавляем сопротивление линии. Для термической стойкости нужен
      // максимальный ток КЗ = 3-фазное замыкание → только фазная жила,
      // без ×2 (нейтраль в петлю трёхфазного КЗ не входит).
      // Для 1-фазных линий: петля фаза + ноль → ×2.
      const rho = RHO[c._cableMaterial || 'Cu'] || RHO.Cu;
      const L = Number(c._cableLength || c.lengthM || 1);
      const S = Number(c._cableSize) || 1;
      const par = Math.max(1, c._cableParallel || 1);
      const loopFactor = c._threePhase ? 1 : 2;
      const rSeg = (rho * L * loopFactor) / S / par;
      // Z_up = Uph / upIk; Z_new = Z_up + rSeg; Ik_new = Uph / Z_new
      const fromN = state.nodes.get(c.from.nodeId);
      const Uph = nodeVoltageLN(fromN || n);
      const Zup = Uph / upIk;
      const Z = Zup + rSeg;
      return Z > 0 ? Uph / Z : Infinity;
    }
    return 0;
  }
  for (const n of state.nodes.values()) {
    if (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups') {
      n._ikA = nodeIk(n.id);
    }
  }
  for (const c of state.conns.values()) {
    if (c._state === 'active') {
      c._ikA = nodeIk(c.to.nodeId);
    }
  }

  // === Прогон расчётных модулей shared/calc-modules ===
  // Для каждой активной линии прогоняем полный набор mandatory-модулей
  // (ampacity, vdrop, shortCircuit, phaseLoop) + optional по флагам из
  // conn/GLOBAL. Результат сохраняется в c._moduleResults — массив
  // {id, label, mandatory, result: {pass, bump, details, warnings}}.
  // Отчёт и inspector могут потом показать результаты каждого модуля
  // независимо.
  for (const c of state.conns.values()) {
    if (c._state !== 'active' || !c._cableSize) { c._moduleResults = null; continue; }
    const toN = state.nodes.get(c.to.nodeId);
    if (!toN) { c._moduleResults = null; continue; }
    const U = c._voltage || 400;
    const phases = c._threePhase ? 3 : 1;
    const isDC = !!c._isDC;
    // Необязательные модули — по флагам пользователя per-conn / GLOBAL
    const enabledSet = new Set();
    if (c.economicDensity || GLOBAL.enforceEconomicDensity) enabledSet.add('economic');
    // t_k: если задан пользователем — используем, иначе модуль shortCircuit
    // рассчитает автоматически по кривой автомата и кратности Ik/In.
    // Передаём 0 чтобы модуль понял что нужен авто-расчёт.
    const tkS = Number(c.tkS) || Number(GLOBAL.defaultTkS) || 0;
    const modInput = {
      I: Number(c._maxA) || 0,
      U, phases, dc: isDC,
      cosPhi: Number(c._cosPhi) || 0.92,
      lengthM: Number(c._cableLength || c.lengthM || 0),
      maxVdropPct: Number(c.maxVdropPct) || Number(GLOBAL.maxVdropPct) || 5,
      material: c._cableMaterial || GLOBAL.defaultMaterial,
      insulation: c._cableInsulation || GLOBAL.defaultInsulation,
      method: c._cableMethod || GLOBAL.defaultInstallMethod,
      cableType: c.cableType || GLOBAL.defaultCableType,
      ambient: Number(c._cableAmbient) || GLOBAL.defaultAmbient,
      grouping: Number(c._cableGrouping) || 1,
      bundling: c.bundling || 'touching',
      maxSize: GLOBAL.maxCableSize || 240,
      parallel: Math.max(1, c._cableParallel || 1),
      currentSize: Number(c._cableSize) || 0,
      calcMethod: GLOBAL.calcMethod || 'iec',
      ecoMethod: GLOBAL.economicMethod || 'pue_eco',
      economicHours: Number(c.economicHours) || 5000,
      IkA: Number(c._ikA) || 0,
      tkS,
      earthingSystem: (fromN => (fromN?.type === 'panel' && fromN.earthingOut) || GLOBAL.earthingSystem || 'TN-S')(state.nodes.get(c.from.nodeId)),
      breakerIn: Number(c._breakerIn) || Number(c._breakerPerLine) || 0,
      // Авто-выбор типа: MCB_C до 125A (IEC 60898), MCCB свыше.
      // v0.57.88: порог был 63A — поднят до 125A согласно IEC 60898.
      // Также если задан c.breakerCurve='MCB_*' но номинал > 125A — MCCB.
      breakerCurve: (() => {
        const _inRef = Number(c._breakerIn) || Number(c._breakerPerLine) || 0;
        if (c.breakerCurve && !(_inRef > 125 && /^MCB_/.test(String(c.breakerCurve)))) {
          return c.breakerCurve;
        }
        return _inRef > 125 ? 'MCCB' : 'MCB_C';
      })(),
      Uph: phases === 3 ? (U / Math.sqrt(3)) : U,
      rcdEnabled: !!c.rcdEnabled,
      rcdTripMa: Number(c.rcdTripMa) || 30,
    };
    try {
      c._moduleResults = runCalcModules(modInput, enabledSet);
      // Авто-установка УЗО при недостаточной петле фаза-ноль.
      // Если TN-система, phaseLoop провалил проверку Ik1 ≥ Ia, а УЗО не
      // включено пользователем — автоматически включаем УЗО (IΔn=30 мА)
      // и пересчитываем модуль phaseLoop. IEC 60364-4-41 §411.3.3:
      // УЗО обеспечивает защиту при косвенном прикосновении независимо
      // от тока КЗ. Флаг c._rcdAutoInstalled=true — для UI и BOM.
      // Phase 1.20.68.
      c._rcdAutoInstalled = false;
      if (!c.rcdEnabled && Array.isArray(c._moduleResults)) {
        const pl = c._moduleResults.find(m => m.id === 'phaseLoop');
        if (pl && pl.result && !pl.result.pass && !pl.result.details?.skipped) {
          // Только если pass'нуло бы с УЗО
          c._rcdAutoInstalled = true;
          modInput.rcdEnabled = true;
          modInput.rcdTripMa = 30;
          c._moduleResults = runCalcModules(modInput, enabledSet);
        }
      }
    } catch (e) {
      console.warn('[recalc] calc-modules failed', e);
      c._moduleResults = null;
    }
  }

  // === ΔU — падение напряжения ===
  // Для каждой активной связи: ΔU_seg = √3 × I × (R×cosφ + X×sinφ) × L / U × 100% (3ф)
  // X кабеля ≈ 0.08 мОм/м (типичное для стандартных кабелей)
  const X_PER_M = 0.00008; // Ом/м
  for (const c of state.conns.values()) {
    c._deltaUSegPct = 0;
    if (c._state !== 'active' || !c._cableSize || !(c._loadA > 0)) continue;
    const I = c._loadA;
    const L = Number(c._cableLength || c.lengthM || 1);
    const S = Number(c._cableSize) || 1;
    const par = Math.max(1, c._cableParallel || 1);
    const rho = RHO[c._cableMaterial || 'Cu'] || RHO.Cu;
    const R = (rho * L) / (S * par); // Ом
    const X = (X_PER_M * L) / par;
    const cos = Number(c._cosPhi) || GLOBAL.defaultCosPhi;
    const sin = Math.sqrt(1 - cos * cos);
    const U = Number(c._voltage) || GLOBAL.voltage3ph;
    const k = c._threePhase ? Math.sqrt(3) : 2;
    c._deltaUSegPct = (k * I * (R * cos + X * sin)) / U * 100;
  }
  // Суммарный ΔU на каждом узле — идём от источника вниз по активным связям
  function nodeDeltaU(nid, visited) {
    visited = visited || new Set();
    if (visited.has(nid)) return 0;
    visited.add(nid);
    const n = state.nodes.get(nid);
    if (!n) return 0;
    if (n.type === 'source' || n.type === 'generator') return 0;
    // Ищем активный фидер (вход), через который питаемся
    for (const c of state.conns.values()) {
      if (c.to.nodeId !== nid || c._state !== 'active') continue;
      return nodeDeltaU(c.from.nodeId, visited) + (c._deltaUSegPct || 0);
    }
    return 0;
  }
  for (const n of state.nodes.values()) {
    n._deltaUPct = nodeDeltaU(n.id);
    // Превышение допустимого падения напряжения
    n._vdropOverLimit = n._deltaUPct > (GLOBAL.maxVdropPct || 5);
  }

  // v0.59.528: финальная очистка для внутренних связей интегрированного
  // ИБП — расчётные поля кабеля/автомата зануляются, чтобы инспектор и
  // отчёты не показывали для них рекомендации (это заводские шины Kehua
  // MR33, не проектные кабели). Пользователь оставляет на схеме только
  // ВЫХОДЯЩИЕ автоматы PDM-секций.
  for (const c of state.conns.values()) {
    if (!c._isInternalIntegrated) continue;
    c._cableSize = null;
    c._cableMethod = null;
    c._cableMark = null;
    c._cableLength = 0;
    c._cableParallel = 1;
    c._cableMaterial = null;
    c._cableInsulation = null;
    c._maxA = 0;
    c._loadA = 0;
    c._breakerIn = null;
    c._breakerUndersize = false;
    c._deltaUSegPct = 0;
    c._moduleResults = null;
    c._isInternalConnHidden = true;  // флаг для UI / BOM / отчётов
  }
}

export { recalc, maxDownstreamLoad, downstreamPQ, panelCosPhi };
