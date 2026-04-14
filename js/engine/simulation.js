import { state } from './state.js';
import { render } from './render.js';
import { renderInspector } from './inspector.js';
import { upsChargeKw } from './electrical.js';

const TIME_ACCEL = 100;
let _simTickHandle = null;
let _lastTickAt = 0;

function simTick() {
  const now = Date.now();
  const dtSec = _lastTickAt ? (now - _lastTickAt) / 1000 : 1;
  _lastTickAt = now;
  if (dtSec <= 0 || dtSec > 10) { _lastTickAt = now; return; }

  let changed = false;

  // 1. Генераторы с триггером — учёт задержек запуска и остановки
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator') continue;

    // Определяем shouldStart — используя triggerGroups (новый формат)
    // или triggerNodeIds (legacy). Логика идентична recalc.activeInputs.
    let shouldStart = false;
    let hasTriggers = false;

    const tGroups = Array.isArray(n.triggerGroups) && n.triggerGroups.length
      ? n.triggerGroups : [];

    if (tGroups.length) {
      hasTriggers = true;
      for (const grp of tGroups) {
        const watches = Array.isArray(grp.watchInputs) ? grp.watchInputs : [];
        if (!watches.length) continue;
        const statuses = watches.map(w => {
          if (w.panelId && typeof w.inputPort === 'number') {
            // Мониторим напряжение на конкретном вводе щита
            for (const c of state.conns.values()) {
              if (c.to.nodeId === w.panelId && c.to.port === w.inputPort) {
                if (c.lineMode === 'damaged' || c.lineMode === 'disabled') return 'dead';
                const fromN = state.nodes.get(c.from.nodeId);
                return (fromN && fromN._powered) ? 'alive' : 'dead';
              }
            }
            return 'dead';
          } else if (w.nodeId) {
            const t = state.nodes.get(w.nodeId);
            return (t && t._powered) ? 'alive' : 'dead';
          }
          return 'dead';
        });
        const logic = grp.logic || 'any';
        const fired = logic === 'any'
          ? statuses.some(s => s === 'dead')
          : statuses.every(s => s === 'dead');
        if (fired) { shouldStart = true; break; }
      }
    } else {
      // Legacy: triggerNodeIds
      const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
        ? n.triggerNodeIds
        : (n.triggerNodeId ? [n.triggerNodeId] : []);
      if (triggers.length) {
        hasTriggers = true;
        const statuses = triggers.map(tid => {
          const t = state.nodes.get(tid);
          return (t && t._powered) ? 'alive' : 'dead';
        });
        const logic = n.triggerLogic || 'any';
        shouldStart = logic === 'any'
          ? statuses.some(s => s === 'dead')
          : statuses.every(s => s === 'dead');
      }
    }

    if (!hasTriggers) {
      n._startedAt = 0; n._stoppingAt = 0;
      n._running = false; n._startCountdown = 0; n._stopCountdown = 0;
      continue;
    }

    const allAlive = !shouldStart;

    if (allAlive) {
      // Триггер жив.
      if (n._running) {
        // Генератор работает — запускаем таймер остановки (если ещё не запущен)
        if (!n._stoppingAt) {
          n._stoppingAt = now;
          changed = true;
        }
        const stopDelay = Math.max(0, Number(n.stopDelaySec) || 0);
        const stopElapsed = (now - n._stoppingAt) / 1000;
        if (stopElapsed >= stopDelay) {
          // Остывание закончено — выключаемся
          n._running = false;
          n._stoppingAt = 0;
          n._stopCountdown = 0;
          n._startedAt = 0;
          n._startCountdown = 0;
          changed = true;
        } else {
          n._stopCountdown = Math.max(0, stopDelay - stopElapsed);
        }
      } else {
        // Не работал и не работает — сбрасываем всё
        if (n._startedAt || n._stoppingAt || n._startCountdown || n._stopCountdown) {
          n._startedAt = 0; n._stoppingAt = 0;
          n._startCountdown = 0; n._stopCountdown = 0;
          changed = true;
        }
      }
    } else {
      // Триггер обесточен.
      // Сбрасываем таймер остановки — генератор снова нужен
      if (n._stoppingAt) {
        n._stoppingAt = 0;
        n._stopCountdown = 0;
        changed = true;
      }
      // Если таймер запуска не запущен И генератор ещё не работает — запускаем отсчёт
      if (!n._running && !n._startedAt) {
        n._startedAt = now;
        changed = true;
      }
      if (!n._running) {
        const delay = Math.max(0, Number(n.startDelaySec) || 0);
        const elapsed = (now - n._startedAt) / 1000;
        if (elapsed >= delay) {
          n._running = true;
          n._startCountdown = 0;
          changed = true;
        } else {
          n._startCountdown = Math.max(0, delay - elapsed);
        }
      }
    }
  }

  // 2. ИБП — разряд батареи пока работает от неё
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!n._onBattery) {
      // Считаем остаток как запас / нагрузка (для отображения)
      const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
      const loadKw = n._loadKw || 0;
      if (loadKw > 0) n._autonomyMin = (battKwh / loadKw) * 60;
      else n._autonomyMin = 0;
      n._runtimeLeftSec = 0;
      continue;
    }
    const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
    const loadKw = n._loadKw || 0;
    if (loadKw <= 0 || battKwh <= 0) {
      n._runtimeLeftSec = 0;
      continue;
    }
    // Реальное время работы в минутах
    const realMinutes = (battKwh / loadKw) * 60;
    // Сокращённое (симуляционное) время
    const simMinutes = realMinutes / TIME_ACCEL;
    n._runtimeLeftSec = simMinutes * 60;

    // Уменьшаем заряд: за 1 секунду симуляции «прошло» TIME_ACCEL секунд реально
    // т.е. разряд = loadKw × (dtSec × TIME_ACCEL / 3600) kWh
    const consumedKwh = loadKw * (dtSec * TIME_ACCEL / 3600);
    let newBatt = battKwh - consumedKwh;
    if (newBatt < 0) newBatt = 0;
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newBatt / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.01) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  // 3. ИБП — медленный заряд, когда работает от сети (упрощённо: до 100% за
  // batteryKwh / chargeKw часов, ускорено в TIME_ACCEL раз)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (n._onBattery || !n._powered) continue;
    const ch = upsChargeKw(n);
    if (ch <= 0) continue;
    if ((n.batteryChargePct || 0) >= 100) continue;
    const addedKwh = ch * (dtSec * TIME_ACCEL / 3600);
    const curKwh = (Number(n.batteryKwh) || 0) * (n.batteryChargePct || 0) / 100;
    const newKwh = Math.min(Number(n.batteryKwh) || 0, curKwh + addedKwh);
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newKwh / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.1) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  // 4. АВР щитов — задержки переключения при смене приоритета
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel') continue;
    if (n.switchMode === 'parallel' || n.switchMode === 'manual' || n.switchMode === 'sectioned') continue;
    if (n.maintenance) continue;
    if ((n.inputs || 0) < 2) continue;

    // Определяем «желаемый» вход по приоритетам (какой АВР ХОЧЕТ включить)
    const priorities = Array.isArray(n.priorities) ? n.priorities : [];
    const groups = new Map();
    for (let i = 0; i < n.inputs; i++) {
      const prio = priorities[i] ?? (i + 1);
      if (!groups.has(prio)) groups.set(prio, []);
      groups.get(prio).push(i);
    }
    const sorted = [...groups.keys()].sort((a, b) => a - b);

    // Проверяем напряжение на каждом вводе
    const inputPowered = new Array(n.inputs).fill(false);
    for (const c of state.conns.values()) {
      if (c.to.nodeId === n.id && (c._state === 'active' || c._state === 'powered')) {
        inputPowered[c.to.port] = true;
      }
    }

    // Находим желаемую группу — первая по приоритету с напряжением
    let desiredPorts = null;
    for (const p of sorted) {
      const ports = groups.get(p);
      if (ports.some(i => inputPowered[i])) {
        desiredPorts = new Set(ports);
        break;
      }
    }
    if (!desiredPorts) desiredPorts = new Set(); // всё мёртво

    // Текущий активный порт (что сейчас замкнуто по АВР)
    if (!n._avrActivePort && n._avrActivePort !== 0) {
      // Инициализация — ищем текущий active вход
      for (const c of state.conns.values()) {
        if (c.to.nodeId === n.id && c._state === 'active') {
          n._avrActivePort = c.to.port;
          break;
        }
      }
    }
    const currentPort = n._avrActivePort ?? -1;
    const currentInDesired = desiredPorts.has(currentPort);

    // Если текущий порт уже в желаемой группе — ничего делать не нужно
    if (currentInDesired && desiredPorts.size > 0) {
      // Сброс таймеров переключения
      if (n._avrSwitchStartedAt) {
        n._avrSwitchStartedAt = 0;
        n._avrSwitchCountdown = 0;
        n._avrInterlockStartedAt = 0;
        n._avrInterlockCountdown = 0;
        changed = true;
      }
      continue;
    }

    // Все входы мёртвые — некуда переключать, сброс таймеров
    if (desiredPorts.size === 0) {
      if (n._avrSwitchStartedAt) {
        n._avrSwitchStartedAt = 0;
        n._avrSwitchCountdown = 0;
        n._avrInterlockStartedAt = 0;
        n._avrInterlockCountdown = 0;
        n._avrDisconnected = false;
        changed = true;
      }
      continue;
    }

    // Нужно переключение
    const avrDelay = Math.max(0, Number(n.avrDelaySec) || 2);
    const interlockDelay = Math.max(0, Number(n.avrInterlockSec) || 1);

    // Фаза 1: Задержка переключения (ждём avrDelaySec)
    if (!n._avrSwitchStartedAt) {
      n._avrSwitchStartedAt = now;
      changed = true;
    }
    const switchElapsed = (now - n._avrSwitchStartedAt) / 1000;
    n._avrSwitchCountdown = Math.max(0, avrDelay - switchElapsed);

    if (switchElapsed < avrDelay) continue; // ещё ждём

    // Фаза 2: Отключаем текущий автомат
    if (currentPort >= 0 && !n._avrDisconnected) {
      n._avrDisconnected = true;
      // Помечаем входной автомат как отключённый (для отображения)
      if (!Array.isArray(n._avrBreakerOverride)) n._avrBreakerOverride = [];
      n._avrBreakerOverride[currentPort] = false;
      changed = true;
    }

    // Фаза 3: Разбежка (ждём avrInterlockSec после отключения)
    if (!n._avrInterlockStartedAt) {
      n._avrInterlockStartedAt = now;
      changed = true;
    }
    const interlockElapsed = (now - n._avrInterlockStartedAt) / 1000;
    n._avrInterlockCountdown = Math.max(0, interlockDelay - interlockElapsed);

    if (interlockElapsed < interlockDelay) continue; // ещё ждём разбежку

    // Фаза 4: Включаем новый автомат
    const newPort = [...desiredPorts].find(i => inputPowered[i]) ?? -1;
    if (newPort >= 0) {
      if (!Array.isArray(n._avrBreakerOverride)) n._avrBreakerOverride = [];
      // Выключаем все, включаем нужный
      for (let i = 0; i < n.inputs; i++) n._avrBreakerOverride[i] = desiredPorts.has(i);
      n._avrActivePort = newPort;
    }
    // Сброс таймеров
    n._avrSwitchStartedAt = 0;
    n._avrSwitchCountdown = 0;
    n._avrInterlockStartedAt = 0;
    n._avrInterlockCountdown = 0;
    n._avrDisconnected = false;
    changed = true;
  }

  // 5. Секционные щиты — автоматика СВ (АВР-подобная 4-фазная логика)
  for (const n of state.nodes.values()) {
    if (n.type !== 'panel' || n.switchMode !== 'sectioned') continue;
    if (n.maintenance) continue;
    const secIds = Array.isArray(n.sectionIds) ? n.sectionIds : [];
    const busTies = Array.isArray(n.busTies) ? n.busTies : [];
    if (!busTies.length || !secIds.length) continue;

    // Инициализация runtime-состояния
    if (!Array.isArray(n._busTieStates))
      n._busTieStates = busTies.map(t => !!t.closed);
    if (!Array.isArray(n._busTieSwitchStartedAt)) {
      const len = busTies.length;
      n._busTieSwitchStartedAt = new Array(len).fill(0);
      n._busTieSwitchCountdown = new Array(len).fill(0);
      n._busTieInterlockStartedAt = new Array(len).fill(0);
      n._busTieInterlockCountdown = new Array(len).fill(0);
      n._busTieDisconnected = new Array(len).fill(false);
      n._busTieDeadSec = new Array(len).fill(-1);
    }

    // Хелпер: сброс таймеров для СВ ti
    function resetTie(ti) {
      n._busTieSwitchStartedAt[ti] = 0;
      n._busTieSwitchCountdown[ti] = 0;
      n._busTieInterlockStartedAt[ti] = 0;
      n._busTieInterlockCountdown[ti] = 0;
      n._busTieDisconnected[ti] = false;
    }

    // Хелпер: есть ли конфликтующий замкнутый/замыкающийся СВ с общей секцией
    function hasConflict(ti) {
      const [a, b] = busTies[ti].between;
      for (let oti = 0; oti < busTies.length; oti++) {
        if (oti === ti) continue;
        const [oa, ob] = busTies[oti].between;
        if (oa === a || oa === b || ob === a || ob === b) {
          if (n._busTieStates[oti] || n._busTieSwitchStartedAt[oti] > 0) return true;
        }
      }
      return false;
    }

    for (let ti = 0; ti < busTies.length; ti++) {
      const tie = busTies[ti];
      if (!tie.auto) continue;

      const [secIdxA, secIdxB] = tie.between;
      const secA = state.nodes.get(secIds[secIdxA]);
      const secB = state.nodes.get(secIds[secIdxB]);
      if (!secA || !secB) continue;

      const ownPowA = !!secA._ownInputPowered;
      const ownPowB = !!secB._ownInputPowered;
      const ownAvailA = !!secA._ownInputAvailable;
      const ownAvailB = !!secB._ownInputAvailable;
      const tieOn = n._busTieStates[ti];

      const delay = Math.max(0, Number(tie.delaySec) || 2);
      const interlock = Math.max(0, Number(tie.interlockSec) || 1);

      if (!tieOn) {
        // === СВ РАЗОМКНУТ — проверяем нужно ли замкнуть ===

        if (ownPowA && ownPowB) {
          // Обе секции питаются от своих вводов — всё ок
          resetTie(ti);
          continue;
        }
        if (!ownPowA && !ownPowB) {
          // Обе мертвы — СВ не поможет
          resetTie(ti);
          continue;
        }

        // Одна секция запитана, другая нет — нужно замкнуть СВ
        const deadSecIdx = ownPowA ? secIdxB : secIdxA;
        const deadSec = ownPowA ? secB : secA;

        // Взаимная блокировка: нельзя замкнуть если конфликтующий СВ уже замкнут
        if (hasConflict(ti)) {
          resetTie(ti);
          continue;
        }

        // Фаза 1: задержка переключения
        if (!n._busTieSwitchStartedAt[ti]) {
          n._busTieSwitchStartedAt[ti] = now;
          n._busTieDeadSec[ti] = deadSecIdx;
          changed = true;
        }
        const swElapsed = (now - n._busTieSwitchStartedAt[ti]) / 1000;
        n._busTieSwitchCountdown[ti] = Math.max(0, delay - swElapsed);
        if (swElapsed < delay) continue;

        // Фаза 2: отключить вводные автоматы мёртвой секции
        if (!n._busTieDisconnected[ti]) {
          n._busTieDisconnected[ti] = true;
          if (!Array.isArray(deadSec.inputBreakerStates))
            deadSec.inputBreakerStates = new Array(deadSec.inputs || 0).fill(true);
          for (let i = 0; i < (deadSec.inputs || 0); i++)
            deadSec.inputBreakerStates[i] = false;
          changed = true;
        }

        // Фаза 3: разбежка
        if (!n._busTieInterlockStartedAt[ti]) {
          n._busTieInterlockStartedAt[ti] = now;
          changed = true;
        }
        const ilElapsed = (now - n._busTieInterlockStartedAt[ti]) / 1000;
        n._busTieInterlockCountdown[ti] = Math.max(0, interlock - ilElapsed);
        if (ilElapsed < interlock) continue;

        // Фаза 4: замкнуть СВ
        n._busTieStates[ti] = true;
        resetTie(ti);
        changed = true;

      } else {
        // === СВ ЗАМКНУТ — проверяем нужно ли разомкнуть ===

        const deadSecIdx = n._busTieDeadSec[ti];
        if (deadSecIdx < 0) {
          // Не знаем какая секция была мёртвой — определяем
          if (ownAvailA && ownAvailB) {
            // Обе имеют напряжение на вводах — нужно разомкнуть
            n._busTieDeadSec[ti] = secIdxB; // запомним какую восстанавливать
          } else {
            continue; // Оставляем как есть
          }
        }

        const restoredSec = state.nodes.get(secIds[n._busTieDeadSec[ti]]);
        const restoredAvailable = restoredSec ? !!restoredSec._ownInputAvailable : false;

        if (!restoredAvailable) {
          // Питание ещё не вернулось — СВ остаётся замкнутым
          if (n._busTieSwitchStartedAt[ti]) { resetTie(ti); changed = true; }
          continue;
        }

        // Питание восстановилось — начинаем размыкание

        // Фаза 1: задержка
        if (!n._busTieSwitchStartedAt[ti]) {
          n._busTieSwitchStartedAt[ti] = now;
          changed = true;
        }
        const swElapsed = (now - n._busTieSwitchStartedAt[ti]) / 1000;
        n._busTieSwitchCountdown[ti] = Math.max(0, delay - swElapsed);
        if (swElapsed < delay) continue;

        // Фаза 2: разомкнуть СВ
        if (!n._busTieDisconnected[ti]) {
          n._busTieDisconnected[ti] = true;
          n._busTieStates[ti] = false;
          changed = true;
        }

        // Фаза 3: разбежка
        if (!n._busTieInterlockStartedAt[ti]) {
          n._busTieInterlockStartedAt[ti] = now;
          changed = true;
        }
        const ilElapsed = (now - n._busTieInterlockStartedAt[ti]) / 1000;
        n._busTieInterlockCountdown[ti] = Math.max(0, interlock - ilElapsed);
        if (ilElapsed < interlock) continue;

        // Фаза 4: включить вводные автоматы восстановленной секции
        if (restoredSec) {
          if (!Array.isArray(restoredSec.inputBreakerStates))
            restoredSec.inputBreakerStates = new Array(restoredSec.inputs || 0).fill(false);
          for (let i = 0; i < (restoredSec.inputs || 0); i++)
            restoredSec.inputBreakerStates[i] = true;
        }
        resetTie(ti);
        n._busTieDeadSec[ti] = -1;
        changed = true;
      }
    }
  }

  if (changed) {
    render();
    // Перерисовываем инспектор ТОЛЬКО если пользователь не фокусирован
    // на поле ввода — иначе simTick сбрасывает его редактирование.
    const activeEl = document.activeElement;
    const userEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA');
    if (!userEditing && state.selectedKind === 'node') {
      const sel = state.nodes.get(state.selectedId);
      if (sel && (sel.type === 'ups' || sel.type === 'generator' || sel.type === 'panel')) {
        renderInspector();
      }
    }
  }
}

export function startSimLoop() {
  if (_simTickHandle) return;
  _lastTickAt = Date.now();
  _simTickHandle = setInterval(simTick, 1000);
}
export function stopSimLoop() {
  if (_simTickHandle) clearInterval(_simTickHandle);
  _simTickHandle = null;
}

export { TIME_ACCEL, simTick };
