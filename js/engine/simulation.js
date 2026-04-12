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

  if (changed) {
    render();
    // Перерисовываем инспектор ТОЛЬКО если пользователь не фокусирован
    // на поле ввода — иначе simTick сбрасывает его редактирование.
    const activeEl = document.activeElement;
    const userEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA');
    if (!userEditing && state.selectedKind === 'node') {
      const sel = state.nodes.get(state.selectedId);
      if (sel && (sel.type === 'ups' || sel.type === 'generator')) {
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
