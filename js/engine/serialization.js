import { state, uid, getIdSeq, setIdSeq } from './state.js';
import { DEFAULTS, GLOBAL, CHANNEL_TYPES } from './constants.js';
import { nodeInputCount, nodeOutputCount, nodeWidth, nodeHeight } from './geometry.js';
import { nextFreeTag } from './graph.js';

let _clearUndoStack, _render, _renderInspector, _updateViewBox;
export function bindSerializationDeps({ clearUndoStack, render, renderInspector, updateViewBox }) {
  _clearUndoStack = clearUndoStack; _render = render; _renderInspector = renderInspector;
  _updateViewBox = updateViewBox;
}

// ================= Сохранение =================
export function serialize() {
  // Сохраняем пользовательские настройки расчёта вместе с проектом
  const globalSettings = {};
  const skipKeys = ['voltageLevels']; // voltageLevels сохраняется отдельно
  for (const k of Object.keys(GLOBAL)) {
    if (skipKeys.includes(k)) continue;
    globalSettings[k] = GLOBAL[k];
  }
  // voltageLevels — как есть
  globalSettings.voltageLevels = GLOBAL.voltageLevels;

  return {
    version: 3,
    nextId: getIdSeq(),
    nodes: Array.from(state.nodes.values()).map(stripRuntime),
    conns: Array.from(state.conns.values()).map(stripRuntime),
    modes: state.modes,
    activeModeId: state.activeModeId,
    view: { ...state.view },
    globalSettings,
  };
}
// Удаляет все runtime-поля (с префиксом _) — они вычисляются при загрузке.
export function stripRuntime(obj) {
  const copy = {};
  for (const k in obj) {
    if (k.startsWith('_')) continue;
    copy[k] = obj[k];
  }
  return copy;
}
export function deserialize(data) {
  state.nodes.clear();
  state.conns.clear();
  for (const n of (data.nodes || [])) state.nodes.set(n.id, n);
  for (const c of (data.conns || [])) state.conns.set(c.id, c);
  state.modes = data.modes || [];
  state.activeModeId = data.activeModeId || null;
  setIdSeq(Math.max(data.nextId || 1, 1));
  state.view = data.view || { x: 0, y: 0, zoom: 1 };
  state.selectedKind = null; state.selectedId = null;

  // Восстановить настройки расчёта из проекта
  if (data.globalSettings && typeof data.globalSettings === 'object') {
    for (const k of Object.keys(data.globalSettings)) {
      if (k in GLOBAL) GLOBAL[k] = data.globalSettings[k];
    }
  }

  // Миграция старых схем: проставляем отсутствующие поля
  for (const n of state.nodes.values()) {
    if (!n.tag) n.tag = nextFreeTag(n.type);
    if (n.type === 'consumer') {
      if (typeof n.count !== 'number') n.count = 1;
      if (!n.phase) n.phase = '3ph';
      if (typeof n.cosPhi !== 'number') n.cosPhi = GLOBAL.defaultCosPhi;
      if (typeof n.kUse !== 'number') n.kUse = 1.0;
      if (typeof n.inrushFactor !== 'number') n.inrushFactor = 1;
      if (typeof n.voltage !== 'number') n.voltage = (n.phase === '3ph') ? 400 : 230;
    }
    if (n.type === 'panel') {
      if (!n.switchMode) n.switchMode = 'auto';
      if (typeof n.manualActiveInput !== 'number') n.manualActiveInput = 0;
      if (!Array.isArray(n.parallelEnabled)) n.parallelEnabled = new Array(n.inputs || 0).fill(false);
      if (typeof n.kSim !== 'number') n.kSim = 1.0;
      if (typeof n.marginMinPct !== 'number') n.marginMinPct = 2;
      if (typeof n.marginMaxPct !== 'number') n.marginMaxPct = 30;
      // Миграция: если было capacityKw, пересчитаем в ток;
      // иначе — дефолт 160 А
      if (typeof n.capacityA !== 'number') {
        if (typeof n.capacityKw === 'number' && n.capacityKw > 0) {
          const U = 400;  // допущение — миграция ничего не знает о реальном напряжении
          const cos = 0.92;
          n.capacityA = (n.capacityKw * 1000) / (Math.sqrt(3) * U * cos);
        } else {
          n.capacityA = 160;
        }
      }
      // capacityKw больше не нужен как исходное поле
      delete n.capacityKw;
    }
    if (n.type === 'source' || n.type === 'generator' || n.type === 'ups') {
      if (!n.phase) n.phase = '3ph';
      if (typeof n.voltage !== 'number') n.voltage = 400;
      if (typeof n.cosPhi !== 'number') n.cosPhi = (n.type === 'generator') ? 0.85 : 0.92;
    }
    if ((n.type === 'source' || n.type === 'generator') && !n.sourceSubtype) {
      n.sourceSubtype = n.type === 'generator' ? 'generator' : 'transformer';
    }
    // Миграция уровня напряжения — если нет voltageLevelIdx, выводим из phase
    if (typeof n.voltageLevelIdx !== 'number' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups' || n.type === 'consumer')) {
      const ph = n.phase || '3ph';
      n.voltageLevelIdx = (ph === '3ph') ? 0 : 1; // 0 = 400V 3P, 1 = 230V 1P
    }
    if (n.type === 'source') {
      if (typeof n.sscMva !== 'number') n.sscMva = 500;
      if (typeof n.ukPct !== 'number') n.ukPct = 6;
      if (typeof n.xsRsRatio !== 'number') n.xsRsRatio = 10;
      if (typeof n.snomKva !== 'number') n.snomKva = 400;
    }
    if (n.type === 'generator') {
      if (typeof n.sscMva !== 'number') n.sscMva = 10;
      if (typeof n.ukPct !== 'number') n.ukPct = 0;
      if (typeof n.xsRsRatio !== 'number') n.xsRsRatio = 0.5;
      if (typeof n.snomKva !== 'number') n.snomKva = 75;
    }
    if (n.type === 'ups') {
      if (typeof n.chargeA !== 'number') {
        if (typeof n.chargeKw === 'number' && n.chargeKw > 0) {
          const U = n.voltage || 400;
          const k = n.phase === '3ph' ? Math.sqrt(3) : 1;
          n.chargeA = (n.chargeKw * 1000) / (U * k);
        } else {
          n.chargeA = 2;
        }
      }
      if (typeof n.staticBypass !== 'boolean') n.staticBypass = true;
      if (typeof n.staticBypassAuto !== 'boolean') n.staticBypassAuto = true;
      if (typeof n.staticBypassOverloadPct !== 'number') n.staticBypassOverloadPct = 110;
      if (typeof n.staticBypassForced !== 'boolean') n.staticBypassForced = false;
    }
    if (n.type === 'generator') {
      if (typeof n.startDelaySec !== 'number') n.startDelaySec = 5;
      if (typeof n.stopDelaySec !== 'number') n.stopDelaySec = 2;
      if (!('triggerNodeId' in n)) n.triggerNodeId = null;
      // Миграция legacy triggerNodeId → triggerNodeIds[]
      if (!Array.isArray(n.triggerNodeIds)) {
        n.triggerNodeIds = n.triggerNodeId ? [n.triggerNodeId] : [];
      }
      if (!n.triggerLogic) n.triggerLogic = 'any';
    }
    if (n.type === 'channel') {
      // Мигрируем старые поля (material/insulation/method) в новую схему.
      if (!n.channelType) {
        const legacyMethod = n.method || 'B1';
        const methodToType = {
          B1: 'conduit', B2: 'tray_solid', C: 'wall',
          E: 'tray_perf', F: 'air', D1: 'ground', D2: 'ground_direct',
        };
        n.channelType = methodToType[legacyMethod] || 'conduit';
      }
      if (!n.bundling) {
        n.bundling = CHANNEL_TYPES[n.channelType]?.bundlingDefault || 'touching';
      }
      if (typeof n.ambientC !== 'number') n.ambientC = 30;
      if (typeof n.lengthM !== 'number') n.lengthM = 10;
      // Каналы не имеют электрических портов — линии проходят через channelIds
      n.inputs = 0;
      n.outputs = 0;
      // Снимаем устаревшие поля — они теперь на линиях
      delete n.material; delete n.insulation; delete n.method;
    }
    if (n.type === 'zone') {
      if (!n.zonePrefix) n.zonePrefix = n.tag || 'Z1';
      if (typeof n.width !== 'number') n.width = 600;
      if (typeof n.height !== 'number') n.height = 400;
      if (!n.color) n.color = '#e3f2fd';
      if (!Array.isArray(n.memberIds)) n.memberIds = [];
    }
  }

  // Миграция зон: если memberIds пустой, но есть узлы, геометрически лежащие
  // внутри, считаем их членами (обратная совместимость с предыдущей моделью).
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (z.memberIds && z.memberIds.length > 0) continue;
    z.memberIds = [];
    for (const other of state.nodes.values()) {
      if (other.type === 'zone') continue;
      const cx = other.x + nodeWidth(other) / 2;
      const cy = other.y + nodeHeight(other) / 2;
      const zw = nodeWidth(z), zh = nodeHeight(z);
      if (cx >= z.x && cx <= z.x + zw && cy >= z.y && cy <= z.y + zh) {
        z.memberIds.push(other.id);
      }
    }
  }

  // Удалить связи, подключённые к каналам (каналы больше не имеют портов)
  const channelConnIds = [];
  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from?.nodeId);
    const toN = state.nodes.get(c.to?.nodeId);
    if ((fromN && fromN.type === 'channel') || (toN && toN.type === 'channel')) {
      channelConnIds.push(c.id);
    }
  }
  for (const id of channelConnIds) state.conns.delete(id);

  // Миграция связей — дефолты для новых полей
  for (const c of state.conns.values()) {
    if (!c.material) c.material = GLOBAL.defaultMaterial;
    if (!c.insulation) c.insulation = GLOBAL.defaultInsulation;
    if (!c.installMethod) c.installMethod = GLOBAL.defaultInstallMethod;
    if (typeof c.ambientC !== 'number') c.ambientC = GLOBAL.defaultAmbient;
    if (typeof c.grouping !== 'number') c.grouping = GLOBAL.defaultGrouping;
    if (!c.bundling) c.bundling = 'touching';
    if (typeof c.lengthM !== 'number') c.lengthM = 1;
  }

  _updateViewBox();
}
