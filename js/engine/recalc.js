import { state } from './state.js';
import { GLOBAL, CHANNEL_TYPES, BUSBAR_SERIES } from './constants.js';
import { selectCableSize, selectBreaker } from './cable.js';
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
// Обнаружение UPS-кластеров:
//   Если от узла A выходят линии к ИБП (UPS1, UPS2...), и эти ИБП
//   выходами подключены к щиту P, и при этом A тоже напрямую подключен
//   к P (байпасная/сервисная линия), то это «UPS-кластер».
//   В нормальном режиме A несёт входы UPS; в режиме байпаса — нагрузку P.
//   Оба режима взаимоисключающие → max(сумма_входов_UPS, нагрузка_P).
//
// Для остальных выходов:
//   - Потребитель: P_уст × count
//   - ИБП (без кластера): capacityKw / КПД + charge
//   - Parallel-щит: нагрузка × (1/N фидеров)
//   - АВР-щит: 100% нагрузки (worst case)
function maxDownstreamLoad(nodeId) {
  // --- Шаг 1: обнаружить UPS-кластеры от данного узла ---
  // Собираем: какие UPS выходят из nodeId, и куда ведут их выходы
  const outConns = [];
  for (const c of state.conns.values()) {
    if (c.from.nodeId !== nodeId) continue;
    if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
    outConns.push(c);
  }

  // Для каждого UPS, выходящего из nodeId, найдём panel, куда он ведёт
  const upsToPanel = new Map(); // upsId → panelId (куда выход UPS подключён)
  for (const c of outConns) {
    const to = state.nodes.get(c.to.nodeId);
    if (!to || to.type !== 'ups') continue;
    // Куда выход этого UPS ведёт?
    for (const c2 of state.conns.values()) {
      if (c2.from.nodeId !== to.id) continue;
      if (c2.lineMode === 'damaged' || c2.lineMode === 'disabled') continue;
      const dest = state.nodes.get(c2.to.nodeId);
      if (dest && dest.type === 'panel') {
        upsToPanel.set(to.id, dest.id);
      }
    }
  }

  // Панели, к которым nodeId подключён НАПРЯМУЮ (не через UPS)
  const directPanels = new Set();
  for (const c of outConns) {
    const to = state.nodes.get(c.to.nodeId);
    if (to && (to.type === 'panel' || to.type === 'channel')) {
      directPanels.add(to.id);
    }
  }

  // Кластер: панель, к которой идут И UPS-выходы ОТ nodeId, И прямая линия
  // clusters: Map<panelId, Set<upsId>>
  const clusters = new Map();
  for (const [upsId, panelId] of upsToPanel) {
    if (directPanels.has(panelId)) {
      if (!clusters.has(panelId)) clusters.set(panelId, new Set());
      clusters.get(panelId).add(upsId);
    }
  }

  // ID узлов, входящих в кластеры (чтобы не считать их повторно в основном walk)
  const clusteredUps = new Set();
  const clusteredPanels = new Set();
  for (const [panelId, upsIds] of clusters) {
    clusteredPanels.add(panelId);
    for (const uid of upsIds) clusteredUps.add(uid);
  }

  // --- Шаг 2: основной walk (без кластерных узлов) ---
  const visited = new Set();

  function walk(nid, path) {
    if (path.has(nid)) return 0;
    path.add(nid);
    let total = 0;
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== nid) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;

      // Пропускаем узлы, входящие в кластер (они считаются отдельно)
      if (nid === nodeId && clusteredUps.has(to.id)) continue;
      if (nid === nodeId && clusteredPanels.has(to.id)) continue;

      if (to.type === 'consumer') {
        if (visited.has(to.id)) continue;
        visited.add(to.id);
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        total += per * cnt;
      } else if (to.type === 'ups') {
        if (visited.has(to.id)) continue;
        visited.add(to.id);
        const capKw = Number(to.capacityKw) || 0;
        const eff = Math.max(0.01, (Number(to.efficiency) || 100) / 100);
        const chKw = upsChargeKw(to);
        // Находим все UPS, подключённые к тому же downstream parallel-щиту.
        // Они делят нагрузку — считаем долю этого UPS.
        let upsShare = 1;
        // Куда выход этого UPS ведёт?
        for (const c2 of state.conns.values()) {
          if (c2.from.nodeId !== to.id || c2.lineMode === 'damaged' || c2.lineMode === 'disabled') continue;
          const dest = state.nodes.get(c2.to.nodeId);
          if (!dest || dest.type !== 'panel') continue;
          // Сколько UPS питают этот же щит из текущего upstream?
          let upsCount = 0;
          for (const c3 of state.conns.values()) {
            if (c3.to.nodeId !== dest.id || c3.lineMode === 'damaged' || c3.lineMode === 'disabled') continue;
            const feeder = state.nodes.get(c3.from.nodeId);
            if (feeder && feeder.type === 'ups') upsCount++;
          }
          if (upsCount > 1) upsShare = 1 / upsCount;
          break;
        }
        const downstream = simpleDownstream(to.id);
        const myShare = downstream * upsShare;
        const actualLoad = Math.min(capKw, myShare);
        total += actualLoad / eff + chKw;
      } else if (to.type === 'panel' || to.type === 'channel') {
        let share = 1;
        if (to.type === 'panel' && to.switchMode === 'parallel') {
          let feeders = 0;
          const mask = Array.isArray(to.parallelEnabled) ? to.parallelEnabled : [];
          for (const c2 of state.conns.values()) {
            if (c2.to.nodeId === to.id && c2.lineMode !== 'damaged' && c2.lineMode !== 'disabled') {
              if (mask[c2.to.port]) feeders++;
            }
          }
          if (feeders > 1) share = 1 / feeders;
        }
        total += walk(to.id, new Set(path)) * share;
      }
    }
    path.delete(nid);
    return total;
  }

  let total = walk(nodeId, new Set());

  // --- Шаг 3: добавить кластеры ---
  for (const [panelId, upsIds] of clusters) {
    // Вариант B (байпас): полная нагрузка панели напрямую
    const panelLoad = walk(panelId, new Set());

    // Вариант A (нормальный): для каждого UPS — min(номинал, downstream) / КПД + заряд
    let upsInputSum = 0;
    for (const uid of upsIds) {
      const ups = state.nodes.get(uid);
      if (!ups) continue;
      const capKw = Number(ups.capacityKw) || 0;
      const eff = Math.max(0.01, (Number(ups.efficiency) || 100) / 100);
      const chKw = upsChargeKw(ups);
      // Downstream за этим ИБП (независимый подсчёт)
      const upsDownstream = simpleDownstream(ups.id);
      const actualLoad = Math.min(capKw, upsDownstream);
      upsInputSum += actualLoad / eff + chKw;
    }

    // Worst case = MAX из двух режимов (они взаимоисключающие)
    total += Math.max(upsInputSum, panelLoad);
  }

  return total;
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

  const cache = new Map();
  function activeInputs(nid, allowBackup) {
    const key = nid + '|' + (allowBackup ? 1 : 0);
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
        // Список триггеров (поддерживаем и legacy triggerNodeId, и массив)
        const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
          ? n.triggerNodeIds
          : (n.triggerNodeId ? [n.triggerNodeId] : []);

        if (triggers.length) {
          // Проверяем статус каждого триггера
          const statuses = triggers.map(tid => {
            const t = state.nodes.get(tid);
            if (!t) return 'dead'; // удалён → считаем отключённым
            return activeInputs(tid, false) !== null ? 'alive' : 'dead';
          });
          const logic = n.triggerLogic || 'any';
          const shouldStart = logic === 'any'
            ? statuses.some(s => s === 'dead')    // хотя бы один отключён
            : statuses.every(s => s === 'dead');   // все отключены

          if (!shouldStart) {
            res = null; // все триггеры живы → дежурство
          } else if (n._running || (Number(n.startDelaySec) || 0) === 0) {
            // Генератор запущен (или задержка = 0 → мгновенный запуск)
            res = (n.backupMode && !allowBackup) ? null : [];
          } else {
            res = null; // ещё не запустился (ждём startDelaySec)
          }
        } else if (n.backupMode && !allowBackup) {
          res = null;
        } else {
          res = [];
        }
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        const ins = edgesIn.get(nid) || [];
        if (ins.length > 0) {
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
        }
        // Батарейный резерв — только если батарея реально есть.
        // При принудительном статическом байпасе батарея не используется.
        if (res === null && allowBackup && !n.staticBypassForced) {
          const batt = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
          if (batt > 0) res = [];
        }
      }
    } else if (n.type === 'channel') {
      // Канал — пассивный узел, просто передаёт питание через себя.
      // Имеет один вход и один выход, логика как у щита без АВР.
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        const live = ins.filter(c => activeInputs(c.from.nodeId, false) !== null);
        if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
        else if (allowBackup) {
          const liveB = ins.filter(c => activeInputs(c.from.nodeId, true) !== null);
          if (liveB.length) res = liveB.map(c => ({ conn: c, share: 1 / liveB.length }));
        }
      }
    } else if (n.type === 'zone') {
      // Зона — чисто декоративный контейнер, в расчёте не участвует
      res = null;
    } else {
      // panel или consumer
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        // Ручной режим щита: работает только явно выбранный вход
        if (n.type === 'panel' && n.switchMode === 'manual') {
          const idx = n.manualActiveInput | 0;
          const target = ins.find(c => c.to.port === idx);
          if (target) {
            const upNoBackup = activeInputs(target.from.nodeId, false);
            if (upNoBackup !== null) {
              res = [{ conn: target, share: 1 }];
            } else if (allowBackup) {
              const upWithBackup = activeInputs(target.from.nodeId, true);
              if (upWithBackup !== null) res = [{ conn: target, share: 1 }];
            }
          }
        } else if (n.type === 'panel' && n.switchMode === 'parallel') {
          // Параллельный режим
          const enabledMask = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
          const selected = ins.filter(c => enabledMask[c.to.port]);
          let live = selected.filter(c => activeInputs(c.from.nodeId, false) !== null);
          if (live.length === 0 && allowBackup) {
            live = selected.filter(c => activeInputs(c.from.nodeId, true) !== null);
          }
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
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
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
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
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
                const watchPowered = watchNode && activeInputs(watchId, true) !== null;
                if (!watchPowered) activePorts.add(outIdx);
              }
            }
            n._watchdogActivePorts = activePorts;
          }
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
            const upAlive = activeInputs(c.from.nodeId, false) !== null;
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
          // Автоматический режим — группировка по приоритетам с параллельной работой
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          // Фаза 1: без резерва
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          // Фаза 2: с резервом
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
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
  }
  for (const c of state.conns.values()) { c._active = false; c._loadKw = 0; c._state = 'dead'; }

  // Распространение нагрузки от потребителей вверх.
  // При прохождении границы ИБП поток вверх увеличивается на 1/КПД — это потери
  // на преобразование. Если ИБП работает от батареи (активные входы пусты),
  // visit() завершается — вверх ничего не идёт.
  function walkUp(nid, kw) {
    let depth = 0;
    const visit = (id, flow) => {
      if (depth++ > 2000) return;
      const ai = activeInputs(id, true);
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
    const ai = activeInputs(n.id, true);
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

  // Зарядный ток ИБП — накидывается поверх проходной мощности, только если:
  // - ИБП включён
  // - Работает от входа (не от батареи)
  // - НЕ на статическом байпасе (при байпасе инвертор выключен, батарея не
  //   заряжается)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!effectiveOn(n)) continue;
    const ai = activeInputs(n.id, true);
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
      // Для watchdog-щита: выход i активен только если вход i в _watchdogActivePorts
      const fromN = state.nodes.get(c.from.nodeId);
      if (fromN && fromN.type === 'panel' && fromN.switchMode === 'watchdog' && fromN._watchdogActivePorts) {
        if (!fromN._watchdogActivePorts.has(c.from.port)) {
          c._active = false;
          c._state = 'dead';
          continue;
        }
      }
      c._state = 'active';
      continue;
    }
    const upAi = activeInputs(c.from.nodeId, true);
    c._state = (upAi !== null) ? 'powered' : 'dead';
  }

  // Статусы источников и ИБП
  for (const n of state.nodes.values()) {
    if (n.type === 'source' || n.type === 'generator') {
      const ai = activeInputs(n.id, true);
      n._powered = ai !== null;
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    } else if (n.type === 'panel') {
      if (!n._powered) n._powered = activeInputs(n.id, true) !== null;
    } else if (n.type === 'ups') {
      const ai = activeInputs(n.id, true);
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
      // Для линии К ИБП: макс. нагрузка = min(номинал, downstream) / КПД + charge
      const capKw = Number(toN.capacityKw) || 0;
      const eff = Math.max(0.01, (Number(toN.efficiency) || 100) / 100);
      const chKw = upsChargeKw(toN);
      const upsDown = simpleDownstream(toN.id);
      const actualLoad = Math.min(capKw, upsDown);
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
    const methodRank = { F: 0, E: 1, C: 2, B1: 3, B2: 3, D1: 4, D2: 5 };
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
        const chType = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
        const chMethod = chType.method;
        if (worstMethod === null || (methodRank[chMethod] || 0) > (methodRank[worstMethod] || 0)) {
          worstMethod = chMethod;
        }
        const chAmb = Number(ch.ambientC) || 30;
        if (chAmb > worstAmbient) worstAmbient = chAmb;

        const chBundling = ch.bundling || chType.bundlingDefault || 'touching';
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
    c._cableLength = c.lengthM ?? (channelIds.length ? 0 : 1);
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
        c._cableAutoParallel = false;
        c._cableParallel = 1;
      } else {
        const sel = selectCableSize(maxCurrent, {
          material, insulation, method, ambientC: ambient, grouping, bundling,
          cableType, maxSize: GLOBAL.maxCableSize,
          conductorsInParallel,
        });
        c._cableSize = sel.s;
        c._busbarNom = null;
        c._cableIz = sel.iDerated;
        c._cableTotalIz = sel.totalCapacity;
        c._cableOverflow = !!sel.overflow;
        c._cableAutoParallel = !!sel.autoParallel;
        c._cableParallel = sel.parallel;
      }
    } else {
      c._cableSize = null;
      c._busbarNom = null;
      c._cableIz = 0;
      c._cableTotalIz = 0;
      c._cableOverflow = false;
      c._cableAutoParallel = false;
      c._cableParallel = conductorsInParallel;
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
    // Дополнительная проверка — на случай если кабель задан вручную
    // или параметры канала изменили Iz после подбора.
    c._breakerAgainstCable = !!(Iz > 0 && InPerLine > Iz);

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
    if (n.type === 'panel') {
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
      // НЕ ограничиваем мощностью источников — показываем реальную downstream нагрузку.
      // Если она превышает то, что может подать upstream — это видно по перегрузу источников.
      n._maxLoadKw = maxDownstreamLoad(n.id);
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
      // Максимально возможная нагрузка (все потребители на 100% без Ки)
      // НЕ ограничиваем номиналом — показываем реальную нагрузку,
      // а перегруз отображается через _overload флаг.
      n._maxLoadKw = maxDownstreamLoad(n.id);
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
  }
}

export { recalc, maxDownstreamLoad, downstreamPQ, panelCosPhi };
