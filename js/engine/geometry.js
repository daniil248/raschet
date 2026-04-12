import { NODE_H, NODE_MIN_W, PORT_GAP_MIN } from './constants.js';

// ================= Геометрия узла =================
export function nodeInputCount(n) {
  if (n.type === 'source' || n.type === 'generator') return 0;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.inputs | 0);
}
export function nodeOutputCount(n) {
  if (n.type === 'consumer') return 0;
  if (n.type === 'source' || n.type === 'generator') return 1;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.outputs | 0);
}
export function nodeWidth(n) {
  if (n.type === 'zone') return Math.max(200, Number(n.width) || 600);
  const maxPorts = Math.max(nodeInputCount(n), nodeOutputCount(n), 1);
  return Math.max(NODE_MIN_W, maxPorts * PORT_GAP_MIN + 24);
}
export function nodeHeight(n) {
  if (n.type === 'zone') return Math.max(120, Number(n.height) || 400);
  return NODE_H;
}
export function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const h = nodeHeight(n);
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const gap = w / (count + 1);
  const px = n.x + gap * (idx + 1);
  const py = kind === 'in' ? n.y : n.y + h;
  return { x: px, y: py };
}
