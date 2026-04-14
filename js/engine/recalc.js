import { state } from './state.js';
import { GLOBAL, CHANNEL_TYPES, BUSBAR_SERIES, INSTALL_METHODS, BREAKER_TYPES } from './constants.js';
import { selectCableSize, selectBreaker, kTempLookup, kGroupLookup, kBundlingFactor, kBundlingIgnoresGrouping, cableTable } from './cable.js';
import { nodeVoltage, nodeVoltageLN, isThreePhase, nodeWireCount, computeCurrentA,
         consumerNominalCurrent, consumerRatedCurrent, consumerInrushCurrent,
         upsChargeKw, sourceImpedance } from './electrical.js';
import { effectiveOn, effectiveLoadFactor } from './modes.js';

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
      } else if (to.type === 'panel' || to.type === 'channel') {
        // БЕЗ share — считаем полную нагрузку
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
function maxDownstreamLoad(nodeId) {
  const visitedConsumers = new Set();
  const visitedUps = new Set();
  let directKw = 0;       // потребители НЕ через UPS
  let upsConsumerKw = 0;  // потребители через UPS (до КПД)
  let totalChargeKw = 0;  // суммарный заряд всех UPS
  let sumEfficiency = 0;  // для среднего КПД
  let upsCount = 0;

  // Рекурсивный обход. throughUps = true если мы прошли через хотя бы один UPS
  function walk(nid, path, throughUps) {
    if (path.has(nid)) return;
    path.add(nid);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== nid) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;

      if (to.type === 'consumer') {
        if (visitedConsumers.has(to.id)) continue;
        visitedConsumers.add(to.id);
        const kw = (Number(to.demandKw) || 0) * Math.max(1, Number(to.count) || 1);
        if (throughUps) {
          upsConsumerKw += kw;
        } else {
          directKw += kw;
        }
      } else if (to.type === 'ups') {
        if (visitedUps.has(to.id)) continue;
        visitedUps.add(to.id);
        const eff = Math.max(0.01, (Number(to.efficiency) || 100) / 100);
        totalChargeKw += upsChargeKw(to);
        sumEfficiency += eff;
        upsCount++;
        walk(to.id, new Set(path), true);
      } else if (to.type === 'panel' || to.type === 'channel') {
        walk(to.id, new Set(path), throughUps);
      }
    }
    path.delete(nid);
  }

  walk(nodeId, new Set(), false);

  const avgEff = upsCount > 0 ? (sumEfficiency / upsCount) : 1;
  return directKw + upsConsumerKw / avgEff + totalChargeKw;
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
      } else if (to.type === 'panel' || to.type === 'channel') {
        stack.push(to.id);
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

// Финальный cos φ в произвольной точке схемы (обёртка над downstreamPQ)
function panelCosPhi(panelId) {
  const { P, Q } = downstreamPQ(panelId);
  if (P <= 0) return null;
  return P / Math.sqrt(P * P + Q * Q);
}

// ================= Расчёт мощности =================
function recalc() {
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
    // Автомат входа downstream-щита отключён
    const toN = state.nodes.get(c.to.nodeId);
    if (toN && toN.type === 'panel' && Array.isArray(toN.inputBreakerStates) && toN.inputBreakerStates[c.to.port] === false) return false;
    // Режим обслуживания downstream
    if (toN && toN.type === 'panel' && toN.maintenance) return false;
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
      res = effectiveOn(n) ? [] : null;
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
        const ins = edgesIn.get(nid) || [];
        if (ins.length > 0) {
          // АВР по приоритетам — один проход
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
        }
        // Батарейный резерв — если нет питания от входов и батарея есть
        if (res === null && !n.staticBypassForced) {
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
        } else if (n.type === 'panel' && n.switchMode === 'parallel') {
          // Щит без АВР — все входы с включёнными автоматами работают
          const inBrk = Array.isArray(n.inputBreakerStates) ? n.inputBreakerStates : [];
          // Если inputBreakerStates не задан — все входы включены
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
      const flowUp = flow / eff;
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
    // Для группы потребителей: суммарный demand = count × demandKw × loadFactor
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const factor = effectiveLoadFactor(n);
    const total = per * count * factor;
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

    // Предварительная проверка байпаса ещё до пост-прохода статусов
    const overloadRatio = (Number(n.capacityKw) || 1) > 0
      ? (n._loadKw || 0) / Number(n.capacityKw) * 100
      : 0;
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

      // Определяем, работает ли статический байпас.
      // Возможно при: принудительном переключении или автоматическом по перегрузке
      // (и только если ИБП получает питание со входа, не с батареи).
      const overloadRatio = (Number(n.capacityKw) || 1) > 0
        ? (n._loadKw || 0) / Number(n.capacityKw) * 100
        : 0;
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
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
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
  // у неё параллельных жил (для групповых потребителей это count, для
  // обычных — 1). Если через один канал проходят линия с 3 жилами и линия
  // с 4 жилами, в канале лежит 7 цепей, и каждая жила должна использовать
  // K_group для 7.
  const channelCircuits = new Map(); // channelId → total circuits
  for (const c of state.conns.values()) {
    const ids = Array.isArray(c.channelIds) ? c.channelIds : [];
    if (!ids.length) continue;
    const toN = state.nodes.get(c.to.nodeId);
    let circuits = 1;
    if (toN && toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
      circuits = Number(toN.count) || 1;
    }
    for (const chId of ids) {
      channelCircuits.set(chId, (channelCircuits.get(chId) || 0) + circuits);
    }
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;

    // Характеристики линии — берутся с downstream-узла
    const threePhase = isThreePhase(toN);
    const U = nodeVoltage(toN);

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
    c._wireCount = nodeWireCount(toN);
    c._loadA = c._loadKw > 0 ? computeCurrentA(c._loadKw, U, cos, threePhase) : 0;

    // === Расчётный ток для подбора кабеля (максимальный по всем сценариям) ===
    // Кабель должен выдержать максимально возможную нагрузку через ДАННУЮ связь.
    let maxKwDownstream;
    if (toN.type === 'consumer') {
      const per = Number(toN.demandKw) || 0;
      const cnt = Math.max(1, Number(toN.count) || 1);
      maxKwDownstream = per * cnt;
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
    const maxCurrent = maxKwDownstream > 0
      ? computeCurrentA(maxKwDownstream, U, cos, threePhase)
      : 0;
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

    // Количество параллельных проводников зависит ТОЛЬКО от downstream-нагрузки,
    // а не от канала. Групповой потребитель (count > 1) требует count параллельных
    // кабельных пар — это физика нагрузки, а не прокладки.
    let conductorsInParallel = 1;
    if (toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
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
        // Авто-подбор кабеля
        // IEC 60364-4-43: Iz ≥ In ≥ Ib
        // При ручном автомате: кабель должен выдержать In автомата на КАЖДУЮ линию.
        // sizingCurrent = max(Ib, In_per_line × parallel) — передаём как полный ток,
        // selectCableSize разделит на parallel и подберёт кабель.
        const breakerCurve = c.breakerCurve || 'MCB_C';
        const brkI2r = (BREAKER_TYPES[breakerCurve] || BREAKER_TYPES.MCB_C).I2ratio;
        let sizingCurrent = maxCurrent;
        if (c.manualBreakerIn) {
          // Ручной автомат задаёт In на ОДНУ линию. Кабель должен обеспечить Iz ≥ In.
          // Для gG/aM (I2ratio=1.6): Iz ≥ In × I2ratio/1.45
          const minIzPerLine = c.manualBreakerIn * brkI2r / 1.45;
          const minTotalCurrent = minIzPerLine * conductorsInParallel;
          sizingCurrent = Math.max(maxCurrent, minTotalCurrent);
          // Предупреждение: автомат меньше расчётного тока
          c._breakerUndersize = (c.manualBreakerIn < (maxCurrent / conductorsInParallel));
        } else {
          c._breakerUndersize = false;
        }
        const sel = selectCableSize(sizingCurrent, {
          material, insulation, method, ambientC: ambient, grouping, bundling,
          cableType, maxSize: GLOBAL.maxCableSize,
          conductorsInParallel, breakerCurve,
        });
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
        c._breakerCurve = breakerCurve;
        c._I2ratio = sel.I2ratio;
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
  }

  // === Подбор защитных автоматов на выходах ===
  // Правило защиты кабеля по IEC 60364-4-43: Iрасч ≤ In ≤ Iz
  //   Iрасч — расчётный ток нагрузки (на одну параллельную линию)
  //   In    — номинал автомата (ближайший больший стандарт ≥ Iрасч)
  //   Iz    — допустимый ток кабеля (с поправками)
  // Если In > Iz — кабель не защищён, нужно увеличить сечение.
  //
  // Для спаренных (auto-parallel) линий:
  //   - Общий автомат = selectBreaker(Iтотал) — на полный ток
  //   - Per-cable автомат = selectBreaker(Iper) — на каждую параллельную линию
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

    const parallel = Math.max(1, c._cableParallel || 1);
    const Itotal = c._maxA || 0;
    const Iper = Itotal / parallel;
    const Iz = c._cableIz || 0;

    if (Iper <= 0) {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      continue;
    }

    // Автомат на каждую параллельную линию: Iрасч ≤ In ≤ Iz
    // Кабель уже подобран так, что Iz ≥ In ≥ Iрасч (selectCableSize
    // теперь проверяет Iz ≥ selectBreaker(Iрасч)).
    let InPerLine = selectBreaker(Iper);
    // IEC 60364-4-43: проверка координации автомата и кабеля
    const brkCurve = c.breakerCurve || 'MCB_C';
    const brkI2r = (BREAKER_TYPES[brkCurve] || BREAKER_TYPES.MCB_C).I2ratio;
    // Условие 1: In ≤ Iz
    c._breakerAgainstCable = !!(Iz > 0 && InPerLine > Iz);
    // Условие 2: I2 ≤ 1.45 × Iz
    c._breakerI2fail = !!(Iz > 0 && brkI2r * InPerLine > 1.45 * Iz);

    // Общий автомат = In × parallel (или ближайший стандарт на полный ток)
    const InTotal = selectBreaker(Itotal);

    if (c._cableAutoParallel && parallel > 1) {
      // Спаренные: общий + per-line
      c._breakerIn = InTotal;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
    } else if (parallel > 1) {
      // Групповая (не спаренная): один автомат per-line × кол-во
      c._breakerIn = null;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
    } else {
      // Одиночная линия
      c._breakerIn = InPerLine;
      c._breakerPerLine = null;
      c._breakerCount = 1;
    }
  }

  // === Расчёт финального cos φ, P/Q/S и токов для щитов / ИБП / источников ===
  // Ik считаем упрощённо: при базовом сопротивлении источника.
  // Zsource_default = 0.05 Ом на фазе (соответствует ~8 кА короткого на 400 В).
  // Вдоль линии каждый метр добавляет R = ρ × L × 2 / S.
  const RHO = { Cu: 0.0178, Al: 0.0285 }; // Ом·мм²/м

  for (const n of state.nodes.values()) {
    if (n.type === 'panel' && n.switchMode === 'sectioned') {
      // Многосекционный контейнер — суммируем нагрузку секций
      const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
      let totalLoad = 0, totalMax = 0;
      for (const sid of secIds) {
        const s = state.nodes.get(sid);
        if (s) {
          totalLoad += s._loadKw || 0;
          totalMax += s._maxLoadKw || 0;
        }
      }
      n._loadKw = totalLoad;
      n._maxLoadKw = totalMax;
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
      n._loadA = n._calcKw > 0 ? computeCurrentA(n._calcKw, nodeVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;
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
                const kw = (Number(to.demandKw)||0) * Math.max(1, Number(to.count)||1);
                if (thruUps) uKw += kw; else dKw += kw;
              } else if (to.type === 'ups') {
                if (visitedU.has(to.id)) continue; visitedU.add(to.id);
                sEff += Math.max(0.01, (Number(to.efficiency)||100)/100);
                chKw += upsChargeKw(to); uCnt++;
                scWalk(to.id, new Set(path), true);
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
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;

      // Проверка номинала шкафа — в амперах (основная единица для щитов).
      // margin% = (In - Iрасч) / Iрасч × 100
      // Параллельно считаем эквивалентную номинальную мощность для справки.
      const capA = Number(n.capacityA) || 0;
      const loadA = n._loadA || 0;
      if (capA > 0) {
        // Вычисляем эквивалентную номинальную мощность шкафа при текущем
        // напряжении и cos φ (или default cos φ если downstream пусто).
        const cos = n._cosPhi || GLOBAL.defaultCosPhi;
        n._capacityKwFromA = capA * nodeVoltage(n) * (isThreePhase(n) ? Math.sqrt(3) : 1) * cos / 1000;
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
    } else if (n.type === 'ups') {
      n._maxLoadKw = maxDownstreamLoad(n.id);
    } else if (n.type === 'source' || n.type === 'generator') {
      // cos φ из downstream PQ, но P/S привязаны к _loadKw (walkUp result)
      const pq = downstreamPQ(n.id);
      n._cosPhi = (pq.P > 0) ? (pq.P / Math.sqrt(pq.P * pq.P + pq.Q * pq.Q)) : Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      const cos = n._cosPhi;
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = n._loadKw || 0;
      n._powerQ = n._powerP * tan;
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
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
                const kw = (Number(to.demandKw) || 0) * Math.max(1, Number(to.count) || 1);
                if (throughUps) upsConsKw += kw; else directKw += kw;
              } else if (to.type === 'ups') {
                if (visitedU.has(to.id)) continue;
                visitedU.add(to.id);
                const eff = Math.max(0.01, (Number(to.efficiency) || 100) / 100);
                totalCharge += upsChargeKw(to);
                sumEff += eff; uCnt++;
                scenarioWalk(to.id, new Set(path), true);
              } else if (to.type === 'panel' || to.type === 'channel') {
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
        n._maxLoadKw = maxDownstreamLoad(n.id);
      }
      // Если downstream — секция многосекционного щита с СВ,
      // макс. нагрузка включает возможную нагрузку через СВ
      for (const c of state.conns.values()) {
        if (c.from.nodeId !== n.id) continue;
        const downN = state.nodes.get(c.to.nodeId);
        if (!downN || !downN.parentSectionedId) continue;
        const container = state.nodes.get(downN.parentSectionedId);
        if (!container || !container.busTies?.length) continue;
        // Проверяем есть ли хотя бы один замкнутый СВ
        const ties = Array.isArray(container.busTies) ? container.busTies : [];
        const tieStates = Array.isArray(container._busTieStates) ? container._busTieStates : ties.map(t => !!t.closed);
        const hasClosedTie = tieStates.some(s => s);
        if (!hasClosedTie) continue;
        // Суммируем макс. нагрузку всех секций, соединённых через замкнутые СВ
        let totalSecMax = 0;
        for (const sid of (container.sectionIds || [])) {
          const sec = state.nodes.get(sid);
          if (sec) totalSecMax += maxDownstreamLoad(sec.id);
        }
        if (totalSecMax > n._maxLoadKw) n._maxLoadKw = totalSecMax;
      }
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      // Ток КЗ на шинах источника: Ik = c × U / (√3 × Zs), c=1.1 (IEC 60909)
      const Uph = isThreePhase(n) ? nodeVoltage(n) / Math.sqrt(3) : nodeVoltage(n);
      const Zs = sourceImpedance(n);
      n._ikA = Zs > 0 ? (1.1 * Uph / Zs) : Infinity;
    } else if (n.type === 'ups') {
      // P/Q для ИБП берём из фактической нагрузки (_loadKw), а не из
      // downstreamPQ — потому что downstream может быть общим с
      // параллельным ИБП (два ИБП на один щит), и downstreamPQ
      // посчитает полную нагрузку обоих, а не долю этого ИБП.
      n._powerP = n._loadKw || 0;
      if (n._onStaticBypass) {
        // При байпасе cos φ = от потребителей → вычисляем Q из downstream
        const sub = downstreamPQ(n.id);
        const ratio = (sub.P > 0 && n._loadKw > 0) ? (n._loadKw / sub.P) : 1;
        n._powerQ = sub.Q * ratio; // пропорционально доле этого ИБП
      } else {
        // Инвертор — чисто активная мощность, Q = 0
        n._powerQ = 0;
      }
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._cosPhi = n._powerS > 0 ? (n._powerP / n._powerS) : 1.0;
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'consumer') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._nominalA = consumerNominalCurrent(n);
      n._ratedA = consumerRatedCurrent(n);
      n._inrushA = consumerInrushCurrent(n);
      // Мгновенные P / Q потребителя
      const per = Number(n.demandKw) || 0;
      const cnt = Math.max(1, Number(n.count) || 1);
      const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
      const p = per * cnt * k;
      const cos = Math.max(0.1, Math.min(1, n._cosPhi));
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = p;
      n._powerQ = p * tan;
      n._powerS = Math.sqrt(p * p + (p * tan) * (p * tan));
    }
  }

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
      const Uph = isThreePhase(n) ? nodeVoltage(n) / Math.sqrt(3) : nodeVoltage(n);
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
      // Добавляем сопротивление линии (фаза + ноль, двойная длина жилы)
      const rho = RHO[c._cableMaterial || 'Cu'] || RHO.Cu;
      const L = Number(c._cableLength || c.lengthM || 1);
      const S = Number(c._cableSize) || 1;
      const par = Math.max(1, c._cableParallel || 1);
      const rSeg = (rho * L * 2) / S / par; // Ом (простая оценка)
      // Z_up = Uph / upIk; Z_new = Z_up + rSeg; Ik_new = Uph / Z_new
      const fromN = state.nodes.get(c.from.nodeId);
      const Uph = isThreePhase(fromN || n) ? nodeVoltage(fromN || n) / Math.sqrt(3) : nodeVoltage(fromN || n);
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
}

export { recalc, maxDownstreamLoad, downstreamPQ, panelCosPhi };
