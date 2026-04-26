// js/engine/ups-composite.js
// v0.59.392
// Развёртывание интегрированного ИБП (kind='ups-integrated') в композит
// типовых элементов схемы согласно фирменной топологии (Kehua MR33 60-150K и т.п.):
//
//   ATS/MCCB вход → UPS (модульный) + 3 PDM-панели распределения:
//     • PDM-AC  — питание utility (HVAC и аналогичная нагрузка)
//     • PDM-IT1 — питание inverter (защищённая IT-нагрузка)
//     • PDM-IT2 — питание bypass  (резервное питание)
//
// Идемпотентно: запись о созданных дочерних узлах хранится в n.integratedChildIds.
// При смене модели на не-integrated дочерние узлы удаляются автоматически.

import { state, uid } from './state.js';
import { DEFAULTS, GLOBAL } from './constants.js';

function _deleteChildren(n) {
  if (!Array.isArray(n.integratedChildIds)) return;
  for (const cid of n.integratedChildIds) {
    for (const c of Array.from(state.conns.values())) {
      if (c.from.nodeId === cid || c.to.nodeId === cid) state.conns.delete(c.id);
    }
    state.nodes.delete(cid);
  }
  delete n.integratedChildIds;
}

function _mkPanel(px, py, parentId, opts) {
  const id = uid();
  const defaults = typeof DEFAULTS.panel === 'function' ? DEFAULTS.panel() : {};
  const node = { id, type: 'panel', x: px, y: py, ...defaults, ...opts, _integratedParent: parentId };
  if (state.currentPageId) node.pageIds = [state.currentPageId];
  state.nodes.set(id, node);
  return node;
}

function _mkConn(from, to) {
  const cid = uid('c');
  state.conns.set(cid, {
    id: cid, from, to,
    material: GLOBAL.defaultMaterial,
    insulation: GLOBAL.defaultInsulation,
    installMethod: GLOBAL.defaultInstallMethod,
    ambientC: GLOBAL.defaultAmbient,
    grouping: GLOBAL.defaultGrouping,
    bundling: 'touching',
    lengthM: 1,
    cableMark: GLOBAL.projectMainCableLv || null,
    // Внутренняя заводская проводка интегрированного шкафа ИБП.
    // Не учитывается в BOM (кабели и автоматы) — она уже входит в
    // стоимость готового изделия (Kehua MR33 60-150K и т.п.).
    _internalIntegratedUps: true,
    _breakerInternal: true,
  });
}

// Главная функция: синхронизировать композит интегрированного ИБП
// с текущим состоянием узла. Вызывать после applyUpsModel().
export function syncIntegratedUpsComposite(upsId) {
  const n = state.nodes.get(upsId);
  if (!n || n.type !== 'ups') return;

  // Если узел больше не integrated — снести дочек.
  if (n.kind !== 'ups-integrated') {
    _deleteChildren(n);
    return;
  }
  // Уже развёрнут — повторно не создаём (preserve пользовательские правки).
  if (Array.isArray(n.integratedChildIds) && n.integratedChildIds.length) return;

  const pdms = Array.isArray(n.pdmModules) ? n.pdmModules : [];
  if (!pdms.length) return;

  const tag = n.tag || 'UPS';
  const hasAts = !!n.hasIntegratedAts;
  const utilityPdms = pdms.filter(p => p.source === 'utility' || p.source === 'bypass');
  const inverterPdms = pdms.filter(p => p.source === 'inverter');

  const x0 = n.x;
  const y0 = n.y;
  const dx = 220;
  const dy = 110;
  const childIds = [];

  // 1) Входная панель (ATS/MCCB) — слева от ИБП
  const inPanel = _mkPanel(x0 - dx, y0, n.id, {
    name: hasAts ? 'ATS/MCCB' : 'MCCB',
    tag: tag + '.IN',
    inputs: hasAts ? 2 : 1,
    outputs: 1 + utilityPdms.length, // 1 на ИБП + N на utility/bypass PDM
    switchMode: hasAts ? 'auto' : 'manual',
    capacityA: 250,
  });
  childIds.push(inPanel.id);
  // Вход ИБП ← вход inPanel out 0
  _mkConn({ nodeId: inPanel.id, port: 0 }, { nodeId: n.id, port: 0 });

  // 2) PDM-панели utility/bypass — справа сверху, питаются от inPanel
  utilityPdms.forEach((p, i) => {
    const py = y0 - dy * (utilityPdms.length - 1) / 2 + i * dy;
    const pdm = _mkPanel(x0 + dx, py, n.id, {
      name: p.label || p.id || 'PDM',
      tag: tag + '.' + String(p.id || ('PDM' + (i+1))).toUpperCase(),
      inputs: 1,
      outputs: Math.max(1, Number(p.maxBreakers) || 8),
      switchMode: 'manual',
      capacityA: 160,
      _pdmSource: p.source,
    });
    childIds.push(pdm.id);
    _mkConn({ nodeId: inPanel.id, port: i + 1 }, { nodeId: pdm.id, port: 0 });
  });

  // 3) PDM-панели inverter — справа снизу, питаются от выходов ИБП
  inverterPdms.forEach((p, i) => {
    const py = y0 + dy * (utilityPdms.length || 1) + i * dy;
    const pdm = _mkPanel(x0 + dx, py, n.id, {
      name: p.label || p.id || 'PDM',
      tag: tag + '.' + String(p.id || ('PDM' + (i+1))).toUpperCase(),
      inputs: 1,
      outputs: Math.max(1, Number(p.maxBreakers) || 8),
      switchMode: 'manual',
      capacityA: 160,
      _pdmSource: p.source,
    });
    childIds.push(pdm.id);
    _mkConn({ nodeId: n.id, port: i }, { nodeId: pdm.id, port: 0 });
  });

  // Зафиксировать у родителя число выходов = число inverter-PDM
  n.outputs = Math.max(1, inverterPdms.length || pdms.length);
  if (hasAts && (!Number.isFinite(n.inputs) || n.inputs < 2)) n.inputs = 2;

  n.integratedChildIds = childIds;
}
