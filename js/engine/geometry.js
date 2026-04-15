import { NODE_H, NODE_MIN_W, PORT_GAP_MIN, GLOBAL } from './constants.js';

// ================= Геометрия узла =================
export function nodeInputCount(n) {
  // Трансформатор имеет вход (первичная обмотка) для подключения utility.
  if (n.type === 'source') {
    const st = n.sourceSubtype || 'transformer';
    if (st === 'transformer') return 1;
    return 0; // generator-like source без входа
  }
  if (n.type === 'generator') return n.auxInput ? 1 : 0;
  if (n.type === 'zone') return 0;
  if (n.type === 'utility') return 0;
  return Math.max(0, n.inputs | 0);
}
export function nodeOutputCount(n) {
  if (n.type === 'consumer') return Math.max(0, n.outputs | 0);
  if (n.type === 'source' || n.type === 'generator') return 1;
  if (n.type === 'utility') return 1;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.outputs | 0);
}
export function nodeWidth(n) {
  if (n.type === 'zone') return Math.max(200, Number(n.width) || 600);
  if (n.type === 'utility') return 80;
  // Многосекционный контейнер — размер по секциям
  if (n.type === 'panel' && n.switchMode === 'sectioned') return Number(n._wrapW) || 400;
  const gs = GLOBAL.gridStep || 40;
  // Для consumer с боковыми портами — входы не влияют на ширину
  const inTop = (n.type !== 'consumer' || !n.inputSide || n.inputSide === 'top');
  const inPorts = inTop ? nodeInputCount(n) : 0;
  const maxPorts = Math.max(inPorts, nodeOutputCount(n), 1);
  const rawW = (maxPorts + 1) * gs;
  const w = Math.max(NODE_MIN_W, rawW);
  return Math.ceil(w / gs) * gs;
}
export function nodeHeight(n) {
  if (n.type === 'zone') return Math.max(120, Number(n.height) || 400);
  if (n.type === 'panel' && n.switchMode === 'sectioned') return Number(n._wrapH) || 200;
  if (n.type === 'utility') return 120;
  return NODE_H;
}
export function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const h = nodeHeight(n);
  const gs = GLOBAL.gridStep || 40;

  // Генератор auxInput: вход СН сбоку
  if (n.type === 'generator' && kind === 'in' && n.auxInput) {
    const side = n.auxInputSide || 'left';
    if (side === 'left') return { x: n.x, y: n.y + h / 2 };
    else return { x: n.x + w, y: n.y + h / 2 };
  }

  // Consumer inputSide: входы сбоку
  if (n.type === 'consumer' && kind === 'in' && n.inputSide && n.inputSide !== 'top') {
    const side = n.inputSide;
    const inCount = nodeInputCount(n);
    if (side === 'left') {
      // Все входы слева, распределены по высоте
      const gap = h / (inCount + 1);
      return { x: n.x, y: n.y + gap * (idx + 1) };
    } else if (side === 'right') {
      // Все входы справа
      const gap = h / (inCount + 1);
      return { x: n.x + w, y: n.y + gap * (idx + 1) };
    } else if (side === 'split') {
      // idx 0 = слева, idx 1 = справа (по центру высоты)
      if (idx === 0) return { x: n.x, y: n.y + h / 2 };
      else return { x: n.x + w, y: n.y + h / 2 };
    }
  }

  // Стандартное расположение: сверху (in) / снизу (out)
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const totalPortsW = count * gs;
  const startX = n.x + (w - totalPortsW) / 2 + gs / 2;
  const px = startX + idx * gs;
  const py = kind === 'in' ? n.y : n.y + h;
  return { x: px, y: py };
}
