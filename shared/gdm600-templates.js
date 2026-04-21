/* =========================================================================
   shared/gdm600-templates.js — каталог модульных шаблонов GDM-600
   Источник: drawio «Планирование конфигураций» (10 уникальных шаблонов).

   Правила:
     • модуль — фиксированный типоразмер, внутренний габарит:
       3000×7200 мм (широкий) или 2400×7200 мм (узкий),
       высота внутри 2700 мм от фальшпола.
     • сетка пола 600×600 мм.
     • шкафы: 600×1200 (стандарт), 800×1200 (HPC-wide), 300×1200 (inRow ACU).
     • центральный коридор 1200 мм по оси Y между двумя рядами шкафов.
     • оборудование в слотах может меняться местами в пределах swappable,
       но координаты слотов и габарит модуля — неизменны.

   Роли (role):
     SR   серверная стойка
     ACU  прецизионный кондиционер 65 кВт (600×1200)
     ACU-inrow inRow кондиционер 25 кВт (300×1200, узкий)
     UPS  источник бесперебойного питания
     BAT  шкаф АКБ
     MDB / UDB / PDB   распределительные щиты
     PDC  подмодульный распределитель
     PDU  блок питания в стойке
     MON  шкаф мониторинга / контроля
     JB   соединительная коробка
     SR-wide серверная стойка увеличенной ширины (800×1200, HPC)
   ========================================================================= */

export const MODULE_TEMPLATES = {
  // ===== Силовые (инфра) модули 3000×7200 =====
  'MOD-PWR-A': {
    label: 'Силовой модуль A (2×UPS 300 + 2×UPS 200 + MDB + ACU + UDB)',
    kind: 'POWER',
    widthMm: 3000, lengthMm: 7200,
    slots: [
      { id:'S1',  x:  10, y:2000, w:600, d:1200, role:'UPS', label:'UPS 300', swappable:['UPS'] },
      { id:'S2',  x: 610, y:2000, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S3',  x:1210, y:2000, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S4',  x:1810, y:2000, w:600, d:1200, role:'UPS', label:'UPS 200', swappable:['UPS'] },
      { id:'S5',  x:2410, y:2000, w:600, d:1200, role:'ACU', label:'ACU 65', swappable:['ACU'] },
      { id:'S6',  x:  10, y:4400, w:600, d:1200, role:'UPS', label:'UPS 300', swappable:['UPS'] },
      { id:'S7',  x: 610, y:4400, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S8',  x:1210, y:4400, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S9',  x:1810, y:4400, w:600, d:1200, role:'UPS', label:'UPS 200', swappable:['UPS'] },
      { id:'S10', x:2410, y:4400, w:600, d:1200, role:'ACU', label:'ACU 65', swappable:['ACU'] },
      { id:'S11', x: 310, y:6500, w:600, d:1200, role:'UDB', label:'UDB-IT', swappable:['UDB','PDB'] },
      { id:'S12', x:1510, y:6500, w:600, d:1200, role:'UDB', label:'UDB-MIT', swappable:['UDB','PDB'] },
    ],
  },
  'MOD-PWR-B': {
    label: 'Силовой модуль B (2×UPS 300 + 6×MDB + Monitoring + UDB/PDB)',
    kind: 'POWER',
    widthMm: 3000, lengthMm: 7200,
    slots: [
      { id:'S1',  x:   0, y:2000, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S2',  x: 600, y:2000, w:600, d:1200, role:'UPS', label:'UPS 300', swappable:['UPS'] },
      { id:'S3',  x:1200, y:2000, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S4',  x:1800, y:2000, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S5',  x:2400, y:2000, w:600, d:1200, role:'MON', label:'Monitor', swappable:['MON','SR'] },
      { id:'S6',  x:   0, y:4400, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S7',  x: 600, y:4400, w:600, d:1200, role:'UPS', label:'UPS 300', swappable:['UPS'] },
      { id:'S8',  x:1200, y:4400, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S9',  x:1800, y:4400, w:600, d:1200, role:'MDB', label:'MDB',     swappable:['MDB','PDB','UDB'] },
      { id:'S10', x:2400, y:4400, w:600, d:1200, role:'ACU', label:'ACU 65', swappable:['ACU'] },
      { id:'S11', x: 300, y:6500, w:600, d:1200, role:'UDB', label:'UDB-AI', swappable:['UDB','PDB'] },
      { id:'S12', x:1500, y:6500, w:600, d:1200, role:'PDB', label:'PDB-MAI', swappable:['UDB','PDB'] },
    ],
  },

  // ===== IT-модули 3000×7200 =====
  'MOD-IT-3000-SR10-END-ACU': {
    label: 'IT 3000×7200 — 4×SR 10 + 2 ACU торцевые + 2 PDC',
    kind: 'IT',
    widthMm: 3000, lengthMm: 7200,
    itKwPerRack: 10,
    slots: [
      { id:'S1', x: 900, y: 200, w:600, d:1200, role:'PDC', label:'PDC',      swappable:['PDC','PDU'] },
      { id:'S2', x:2100, y: 200, w:600, d:1200, role:'PDC', label:'PDC',      swappable:['PDC','PDU'] },
      { id:'S3', x:1200, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',    swappable:['SR','ACU'] },
      { id:'S4', x:1800, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',    swappable:['SR','ACU'] },
      { id:'S5', x:2400, y:2300, w:600, d:1200, role:'ACU', label:'ACU 65',   swappable:['ACU','SR'] },
      { id:'S6', x:1200, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',    swappable:['SR','ACU'] },
      { id:'S7', x:1800, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',    swappable:['SR','ACU'] },
      { id:'S8', x:2400, y:4700, w:600, d:1200, role:'ACU', label:'ACU 65',   swappable:['ACU','SR'] },
    ],
  },
  'MOD-IT-3000-SR10x8-ACU': {
    label: 'IT 3000×7200 — 8×SR 10 + 2 ACU в середине ряда',
    kind: 'IT',
    widthMm: 3000, lengthMm: 7200,
    itKwPerRack: 10,
    slots: [
      { id:'S1',  x:   0, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S2',  x: 600, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S3',  x:1200, y:2300, w:600, d:1200, role:'ACU', label:'ACU 65', swappable:['ACU','SR'] },
      { id:'S4',  x:1800, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S5',  x:2400, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S6',  x:   0, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S7',  x: 600, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S8',  x:1200, y:4700, w:600, d:1200, role:'ACU', label:'ACU 65', swappable:['ACU','SR'] },
      { id:'S9',  x:1800, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
      { id:'S10', x:2400, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',  swappable:['SR','ACU'] },
    ],
  },
  'MOD-IT-3000-inRow25': {
    label: 'IT 3000×7200 — 8×SR 10 + 4 inRow ACU 25 (узкие 300)',
    kind: 'IT',
    widthMm: 3000, lengthMm: 7200,
    itKwPerRack: 10,
    slots: [
      { id:'S1',  x:   0, y:2300, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S2',  x: 900, y:2300, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S3',  x:1500, y:2300, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S4',  x:2400, y:2300, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S5',  x: 450, y:2450, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S6',  x:1950, y:2450, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S7',  x:   0, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S8',  x: 900, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S9',  x:1500, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S10', x:2400, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S11', x: 450, y:4850, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S12', x:1950, y:4850, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
    ],
  },
  'MOD-IT-3000-HPC800': {
    label: 'IT 3000×7200 — 2×SR 10 + 2×HPC 800-wide',
    kind: 'IT',
    widthMm: 3000, lengthMm: 7200,
    itKwPerRack: 30,
    slots: [
      { id:'S1', x: 300, y: 200, w:600, d:1200, role:'PDC', label:'PDC',        swappable:['PDC','PDU'] },
      { id:'S2', x:2100, y: 200, w:600, d:1200, role:'PDC', label:'PDC',        swappable:['PDC','PDU'] },
      { id:'S3', x:   0, y:2300, w:600, d:1200, role:'SR',  label:'SR 10',      swappable:['SR','ACU'] },
      { id:'S4', x: 700, y:2200, w:800, d:1200, role:'SR',  label:'HPC 800',    swappable:['SR-wide'] },
      { id:'S5', x:   0, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',      swappable:['SR','ACU'] },
      { id:'S6', x: 700, y:4600, w:800, d:1200, role:'SR',  label:'HPC 800',    swappable:['SR-wide'] },
    ],
  },

  // ===== IT-модули 2400×7200 =====
  'MOD-IT-2400-SR30-ACU-ALT': {
    label: 'IT 2400×7200 — 4×SR 30 + 4×ACU 65 (чередование)',
    kind: 'IT',
    widthMm: 2400, lengthMm: 7200,
    itKwPerRack: 30,
    slots: [
      { id:'S1', x: 300, y: 200, w:600, d:1200, role:'PDC', label:'PDC',     swappable:['PDC','PDU'] },
      { id:'S2', x:   0, y:2300, w:600, d:1200, role:'SR',  label:'SR 30',   swappable:['SR','ACU'] },
      { id:'S3', x: 600, y:2300, w:600, d:1200, role:'ACU', label:'ACU 65',  swappable:['ACU','SR'] },
      { id:'S4', x:1200, y:2300, w:600, d:1200, role:'SR',  label:'SR 30',   swappable:['SR','ACU'] },
      { id:'S5', x:1800, y:2300, w:600, d:1200, role:'ACU', label:'ACU 65',  swappable:['ACU','SR'] },
      { id:'S6', x:   0, y:4700, w:600, d:1200, role:'SR',  label:'SR 30',   swappable:['SR','ACU'] },
      { id:'S7', x: 600, y:4700, w:600, d:1200, role:'ACU', label:'ACU 65',  swappable:['ACU','SR'] },
      { id:'S8', x:1200, y:4700, w:600, d:1200, role:'SR',  label:'SR 30',   swappable:['SR','ACU'] },
      { id:'S9', x:1800, y:4700, w:600, d:1200, role:'ACU', label:'ACU 65',  swappable:['ACU','SR'] },
    ],
  },
  'MOD-IT-2400-HPC': {
    label: 'IT 2400×7200 — 2×HPC 800-wide',
    kind: 'IT',
    widthMm: 2400, lengthMm: 7200,
    itKwPerRack: 50,
    slots: [
      { id:'S1', x:1500, y: 200, w:600, d:1200, role:'PDC', label:'PDC',     swappable:['PDC','PDU'] },
      { id:'S2', x:1600, y:2200, w:800, d:1200, role:'SR',  label:'HPC 800', swappable:['SR-wide'] },
      { id:'S3', x:1600, y:4600, w:800, d:1200, role:'SR',  label:'HPC 800', swappable:['SR-wide'] },
    ],
  },
  'MOD-IT-2400-SR30-SOLO': {
    label: 'IT 2400×7200 — 2×SR 30 (вход, без ACU внутри)',
    kind: 'IT',
    widthMm: 2400, lengthMm: 7200,
    itKwPerRack: 30,
    slots: [
      { id:'S1', x: 300, y: 200, w:600, d:1200, role:'PDC', label:'PDC',   swappable:['PDC','PDU'] },
      { id:'S2', x:   0, y:2300, w:600, d:1200, role:'SR',  label:'SR 30', swappable:['SR','ACU'] },
      { id:'S3', x:   0, y:4700, w:600, d:1200, role:'SR',  label:'SR 30', swappable:['SR','ACU'] },
    ],
  },

  // ===== Транзитный модуль (коридор) =====
  'MOD-CORRIDOR-2400': {
    label: 'Транзит 2400×7200 (вход / коридор)',
    kind: 'CORRIDOR',
    widthMm: 2400, lengthMm: 7200,
    slots: [],
  },
};

/* --------- Утилиты каталога --------- */
export function countRole(tpl, role) {
  return tpl.slots.filter(s => s.role === role).length;
}

export function pickItTemplate(rackKw) {
  // Выбор шаблона IT-модуля по мощности на стойку (drawio-обоснованно):
  //   ≤ 10 кВт  → MOD-IT-3000-SR10x8-ACU (8 стоек + 2 ACU)
  //   10–20 кВт → MOD-IT-3000-inRow25 (inRow охлаждение)
  //   20–40 кВт → MOD-IT-2400-SR30-ACU-ALT (4 стойки + 4 ACU)
  //   > 40 кВт  → MOD-IT-2400-HPC (2 стойки HPC 800)
  if (rackKw <= 10) return 'MOD-IT-3000-SR10x8-ACU';
  if (rackKw <= 20) return 'MOD-IT-3000-inRow25';
  if (rackKw <= 40) return 'MOD-IT-2400-SR30-ACU-ALT';
  return 'MOD-IT-2400-HPC';
}

// Силовые модули: всегда пара A + B = 4×UPS300 + 2×UPS200 = 1600 кВт.
// Масштабируется количеством пар.
export const POWER_PAIR = ['MOD-PWR-A', 'MOD-PWR-B'];
export const POWER_PAIR_KW = 1600;

// Цвета заливки по роли (для SVG)
export const ROLE_COLORS = {
  SR:         { fill: '#1976d2', stroke: '#0d47a1', text: '#fff' },
  'SR-wide':  { fill: '#1565c0', stroke: '#0d47a1', text: '#fff' },
  ACU:        { fill: '#00796b', stroke: '#004d40', text: '#fff' },
  'ACU-inrow':{ fill: '#26a69a', stroke: '#004d40', text: '#fff' },
  UPS:        { fill: '#f57c00', stroke: '#e65100', text: '#fff' },
  BAT:        { fill: '#fb8c00', stroke: '#e65100', text: '#fff' },
  MDB:        { fill: '#546e7a', stroke: '#263238', text: '#fff' },
  UDB:        { fill: '#78909c', stroke: '#263238', text: '#fff' },
  PDB:        { fill: '#90a4ae', stroke: '#263238', text: '#fff' },
  PDC:        { fill: '#ab47bc', stroke: '#6a1b9a', text: '#fff' },
  PDU:        { fill: '#ce93d8', stroke: '#6a1b9a', text: '#000' },
  MON:        { fill: '#9e9e9e', stroke: '#424242', text: '#fff' },
  JB:         { fill: '#bdbdbd', stroke: '#424242', text: '#000' },
};
