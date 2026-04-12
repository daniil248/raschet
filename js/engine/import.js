import { state, uid } from './state.js';
import { NODE_H, DEFAULTS } from './constants.js';
import { nodeOutputCount } from './geometry.js';
import { nextFreeTag } from './graph.js';
import { snapshot, notifyChange, setSuppressSnapshot } from './history.js';
import { render } from './render.js';
import { renderInspector } from './inspector.js';

export function importLoadsTable(text) {
  if (!text || typeof text !== 'string') return 0;
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length < 1) return 0;

  // Автоопределение разделителя
  const first = rawLines[0];
  let sep = ',';
  if (first.includes('\t')) sep = '\t';
  else if (first.includes(';')) sep = ';';
  else if (!first.includes(',')) sep = '\t';

  const header = rawLines[0].split(sep).map(s => s.trim().toLowerCase());
  const idxName = header.indexOf('name');
  const idxKw = header.findIndex(h => h === 'kw' || h === 'квт' || h === 'power');
  const idxCount = header.indexOf('count');
  const idxPhase = header.indexOf('phase');
  const idxPanel = header.indexOf('panel');
  if (idxName < 0 || idxKw < 0) {
    throw new Error('В заголовке нужны как минимум колонки name и kW');
  }

  snapshot();
  setSuppressSnapshot(true);
  let added = 0;
  try {
    // Найдём подходящие щиты по имени/тегу
    const panelByKey = new Map();
    for (const n of state.nodes.values()) {
      if (n.type !== 'panel') continue;
      if (n.tag) panelByKey.set(n.tag.toLowerCase(), n);
      if (n.name) panelByKey.set(n.name.toLowerCase(), n);
    }

    // Расположим новые потребители ниже существующих
    let maxY = 0, minX = Infinity;
    for (const n of state.nodes.values()) {
      maxY = Math.max(maxY, n.y + NODE_H);
      minX = Math.min(minX, n.x);
    }
    if (!isFinite(minX)) minX = 100;
    const startY = maxY + 60;
    const step = 190;

    for (let i = 1; i < rawLines.length; i++) {
      const parts = rawLines[i].split(sep).map(s => s.trim());
      if (!parts[idxName]) continue;
      const name = parts[idxName];
      const kw = Number(String(parts[idxKw]).replace(',', '.')) || 0;
      const cnt = idxCount >= 0 ? Math.max(1, Number(parts[idxCount]) || 1) : 1;
      const phase = idxPhase >= 0 ? (parts[idxPhase] || '3ph') : '3ph';
      const panelKey = idxPanel >= 0 ? String(parts[idxPanel] || '').toLowerCase() : '';

      const id = uid();
      const base = { id, type: 'consumer', ...DEFAULTS.consumer() };
      base.name = name;
      base.demandKw = kw;
      base.count = cnt;
      base.phase = (phase === '3ph' || phase === 'A' || phase === 'B' || phase === 'C') ? phase : '3ph';
      base.inputs = 1;
      base.priorities = [1];
      base.tag = nextFreeTag('consumer');
      base.x = minX + (added % 5) * step;
      base.y = startY + Math.floor(added / 5) * (NODE_H + 40);
      state.nodes.set(id, base);

      // Автоподключение к щиту, если указано
      if (panelKey && panelByKey.has(panelKey)) {
        const panel = panelByKey.get(panelKey);
        // Ищем свободный выходной порт
        const usedPorts = new Set();
        for (const c of state.conns.values()) {
          if (c.from.nodeId === panel.id) usedPorts.add(c.from.port);
        }
        let freePort = 0;
        const outCount = nodeOutputCount(panel);
        for (let p = 0; p < outCount; p++) {
          if (!usedPorts.has(p)) { freePort = p; break; }
        }
        if (usedPorts.size < outCount) {
          const cid = uid('c');
          state.conns.set(cid, {
            id: cid,
            from: { nodeId: panel.id, port: freePort },
            to: { nodeId: id, port: 0 },
          });
        }
      }
      added++;
    }
  } finally {
    setSuppressSnapshot(false);
  }
  render();
  renderInspector();
  notifyChange();
  return added;
}
