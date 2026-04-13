import { NODE_H, NODE_MIN_W, PORT_GAP_MIN, GLOBAL } from './constants.js';

// ================= Геометрия узла =================
export function nodeInputCount(n) {
  if (n.type === 'source' || n.type === 'generator') return 0;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.inputs | 0);
}
export function nodeOutputCount(n) {
  if (n.type === 'consumer') return Math.max(0, n.outputs | 0);
  if (n.type === 'source' || n.type === 'generator') return 1;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.outputs | 0);
}
export function nodeWidth(n) {
  if (n.type === 'zone') return Math.max(200, Number(n.width) || 600);
  const gs = GLOBAL.gridStep || 40;
  const maxPorts = Math.max(nodeInputCount(n), nodeOutputCount(n), 1);
  // Ширина = (портов + 1) × шаг сетки, но не менее NODE_MIN_W, кратна gs
  const rawW = (maxPorts + 1) * gs;
  const w = Math.max(NODE_MIN_W, rawW);
  return Math.ceil(w / gs) * gs;
}
export function nodeHeight(n) {
  if (n.type === 'zone') return Math.max(120, Number(n.height) || 400);
  return NODE_H;
}
export function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const h = nodeHeight(n);
  const gs = GLOBAL.gridStep || 40;
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  // Порты на шаге сетки, центрированы внутри карточки
  const totalPortsW = count * gs;
  const startX = n.x + (w - totalPortsW) / 2 + gs / 2;
  const px = startX + idx * gs;
  const py = kind === 'in' ? n.y : n.y + h;
  return { x: px, y: py };
}
