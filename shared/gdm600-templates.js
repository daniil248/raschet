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
      { id:'S5',  x: 600, y:2300, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S6',  x:2100, y:2300, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S7',  x:   0, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S8',  x: 900, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S9',  x:1500, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S10', x:2400, y:4700, w:600, d:1200, role:'SR',        label:'SR 10',       swappable:['SR'] },
      { id:'S11', x: 600, y:4700, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
      { id:'S12', x:2100, y:4700, w:300, d:1200, role:'ACU-inrow', label:'ACU 25 inRow', swappable:['ACU-inrow'] },
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
      { id:'S4', x: 700, y:2300, w:800, d:1200, role:'SR-wide', label:'HPC 800', swappable:['SR-wide'] },
      { id:'S5', x:   0, y:4700, w:600, d:1200, role:'SR',  label:'SR 10',      swappable:['SR','ACU'] },
      { id:'S6', x: 700, y:4700, w:800, d:1200, role:'SR-wide', label:'HPC 800', swappable:['SR-wide'] },
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
      { id:'S1', x: 900, y: 200, w:600, d:1200, role:'PDC', label:'PDC',     swappable:['PDC','PDU'] },
      { id:'S2', x: 800, y:2300, w:800, d:1200, role:'SR-wide', label:'HPC 800', swappable:['SR-wide'] },
      { id:'S3', x: 800, y:4700, w:800, d:1200, role:'SR-wide', label:'HPC 800', swappable:['SR-wide'] },
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

// Цвета заливки по роли (для SVG) — палитра из drawio-источника
// (оранжевая SR, зелёная UPS/BAT/MDB, голубая ACU/AHU, красная АГПТ)
export const ROLE_COLORS = {
  SR:         { fill: '#FFE6CC', stroke: '#D79B00', text: '#000' },
  'SR-wide':  { fill: '#FFE6CC', stroke: '#D79B00', text: '#000' },
  TR:         { fill: '#FFE6CC', stroke: '#D79B00', text: '#000' },
  ACU:        { fill: '#DAE8FC', stroke: '#6C8EBF', text: '#000' },
  'ACU-inrow':{ fill: '#DAE8FC', stroke: '#6C8EBF', text: '#000' },
  AHU:        { fill: '#DAE8FC', stroke: '#6C8EBF', text: '#000' },
  ODU:        { fill: '#DAE8FC', stroke: '#6C8EBF', text: '#000' },
  UPS:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  BAT:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  MDB:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  UDB:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  PDB:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  PDC:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  PDU:        { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  MON:        { fill: '#E1D5E7', stroke: '#9673A6', text: '#000' },
  JB:         { fill: '#D5E8D4', stroke: '#82B366', text: '#000' },
  'AGPT-cyl': { fill: '#F8CECC', stroke: '#B85450', text: '#000' },
  'AGPT-pipe':{ fill: '#B85450', stroke: '#B85450', text: '#000' },
};

/* =========================================================================
   COMPONENT_SPECS — габариты и типы компонентов (из drawio-каталога
   «Планирование конфигураций — копия», 82 KB, 2025-04-20).
   ========================================================================= */
export const COMPONENT_SPECS = {
  SR:          { label: 'Серверная стойка 600',   wMm: 600,  dMm: 1200 },
  'SR-wide':   { label: 'Стойка HPC 800',         wMm: 800,  dMm: 1200 },
  TR:          { label: 'Телеком-стойка 800',     wMm: 800,  dMm: 1200 },
  UPS:         { label: 'ИБП Kehua MR33',         wMm: 600,  dMm: 1200 },
  BAT:         { label: 'АКБ Kehua S3 58 кВт·ч',  wMm: 600,  dMm: 1200 },
  PDC:         { label: 'PDC',                    wMm: 600,  dMm: 1200 },
  MDB:         { label: 'MDB',                    wMm: 600,  dMm: 1200 },
  UDB:         { label: 'UDB',                    wMm: 600,  dMm: 1200 },
  PDB:         { label: 'PDB',                    wMm: 600,  dMm: 1200 },
  MON:         { label: 'Monitoring',             wMm: 600,  dMm: 1200 },
  JB:          { label: 'Junction Box',           wMm: 600,  dMm: 300  },
  ACU:         { label: 'Прецизионный 65 кВт',    wMm: 600,  dMm: 1200 },
  'ACU-inrow': { label: 'inRow 25 кВт',           wMm: 300,  dMm: 1200 },
  AHU:         { label: 'Вентустановка (AHU)',    wMm: 800,  dMm: 1200 },
  ODU:         { label: 'ODU конденсатор',        wMm: 900,  dMm: 900  },
  'AGPT-cyl':  { label: 'Баллон АГПТ',            wMm: 400,  dMm: 400  },
};

/* =========================================================================
   COMPONENT_SVG — отрисовка каждого компонента как в drawio-оригинале.
   Вызов: COMPONENT_SVG[role](x, y, w, d) → строка SVG-разметки.
   (x, y, w, d уже в пикселях SVG при выбранном масштабе.)
   ========================================================================= */
export const COMPONENT_SVG = {
  // Серверная стойка — оранжевая с поперечными полосами (шасси)
  SR: (x, y, w, d) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#FFE6CC" stroke="#D79B00" stroke-width="0.8"/>`;
    for (let i = 1; i <= 3; i++) {
      s += `<line x1="${x+1}" y1="${y + d*i/4}" x2="${x+w-1}" y2="${y + d*i/4}" stroke="#D79B00" opacity="0.55"/>`;
    }
    s += `<line x1="${x + w/2}" y1="${y+1}" x2="${x + w/2}" y2="${y + d - 1}" stroke="#D79B00" opacity="0.3"/>`;
    return s;
  },
  'SR-wide': (x, y, w, d) => COMPONENT_SVG.SR(x, y, w, d),
  TR:        (x, y, w, d) => COMPONENT_SVG.SR(x, y, w, d),

  // ИБП — зелёный с «дисплеем»
  UPS: (x, y, w, d) => `
    <rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#D5E8D4" stroke="#82B366" stroke-width="0.8"/>
    <rect x="${x + w*0.2}" y="${y + d*0.08}" width="${w*0.6}" height="${d*0.14}" fill="#2E7D32" opacity="0.85"/>
    <line x1="${x+1}" y1="${y + d*0.5}" x2="${x + w - 1}" y2="${y + d*0.5}" stroke="#82B366" opacity="0.5"/>`,

  // АКБ — зелёный с горизонтальными полосами (ряды батарей)
  BAT: (x, y, w, d) => {
    let bars = '';
    for (let i = 1; i <= 6; i++) {
      bars += `<line x1="${x+2}" y1="${y + d*i/7}" x2="${x+w-2}" y2="${y + d*i/7}" stroke="#82B366" stroke-width="1"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#D5E8D4" stroke="#82B366" stroke-width="0.8"/>${bars}`;
  },

  // Прецизионный кондиционер — голубой с двумя кругами (вентиляторы)
  ACU: (x, y, w, d) => {
    const r = Math.min(w, d) * 0.18;
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#DAE8FC" stroke="#6C8EBF" stroke-width="0.8"/>
      <circle cx="${x + w/2}" cy="${y + d*0.28}" r="${r}" fill="none" stroke="#6C8EBF" stroke-width="0.8"/>
      <circle cx="${x + w/2}" cy="${y + d*0.72}" r="${r}" fill="none" stroke="#6C8EBF" stroke-width="0.8"/>`;
  },

  // inRow — узкий голубой со «ставнями»
  'ACU-inrow': (x, y, w, d) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#DAE8FC" stroke="#6C8EBF" stroke-width="0.8"/>`;
    for (let i = 1; i <= 10; i++) {
      s += `<line x1="${x+1}" y1="${y + d*i/11}" x2="${x+w-1}" y2="${y + d*i/11}" stroke="#6C8EBF" opacity="0.55"/>`;
    }
    return s;
  },

  // AHU — голубой блок с воздуховодом-стрелкой
  AHU: (x, y, w, d) => `
    <rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#DAE8FC" stroke="#6C8EBF" stroke-width="0.8"/>
    <rect x="${x + w*0.15}" y="${y + d*0.3}" width="${w*0.7}" height="${d*0.4}" fill="none" stroke="#6C8EBF" stroke-dasharray="2,2"/>
    <path d="M ${x + w*0.5} ${y + d*0.12} L ${x + w*0.5} ${y + d*0.88}
             M ${x + w*0.38} ${y + d*0.78} L ${x + w*0.5} ${y + d*0.88} L ${x + w*0.62} ${y + d*0.78}"
          stroke="#6C8EBF" fill="none" stroke-width="1"/>`,

  // ODU — круглый внешний блок
  ODU: (x, y, w, d) => `
    <ellipse cx="${x + w/2}" cy="${y + d/2}" rx="${w/2 - 0.5}" ry="${d/2 - 0.5}"
             fill="#DAE8FC" stroke="#6C8EBF" stroke-width="0.8"/>
    <circle cx="${x + w/2}" cy="${y + d/2}" r="${Math.min(w, d)*0.25}" fill="none" stroke="#6C8EBF"/>`,

  // Баллон АГПТ — красный круг с вентилем сверху
  'AGPT-cyl': (x, y, w, d) => `
    <ellipse cx="${x + w/2}" cy="${y + d/2}" rx="${w/2 - 0.5}" ry="${d/2 - 0.5}"
             fill="#F8CECC" stroke="#B85450" stroke-width="1"/>
    <rect x="${x + w*0.4}" y="${y - d*0.08}" width="${w*0.2}" height="${d*0.18}" fill="#B85450"/>`,

  // Щиты (PDC/MDB/UDB/PDB) — зелёные с двумя вертикальными линиями (DIN-рейки)
  panel: (x, y, w, d) => `
    <rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#D5E8D4" stroke="#82B366" stroke-width="0.8"/>
    <line x1="${x + w*0.33}" y1="${y+1}" x2="${x + w*0.33}" y2="${y + d - 1}" stroke="#82B366" opacity="0.6"/>
    <line x1="${x + w*0.66}" y1="${y+1}" x2="${x + w*0.66}" y2="${y + d - 1}" stroke="#82B366" opacity="0.6"/>`,

  // Шкаф мониторинга — фиолетовый
  MON: (x, y, w, d) => `
    <rect x="${x}" y="${y}" width="${w}" height="${d}" fill="#E1D5E7" stroke="#9673A6" stroke-width="0.8"/>
    <rect x="${x + w*0.2}" y="${y + d*0.15}" width="${w*0.6}" height="${d*0.25}" fill="#6A1B9A" opacity="0.65"/>
    <line x1="${x+1}" y1="${y + d*0.55}" x2="${x + w - 1}" y2="${y + d*0.55}" stroke="#9673A6" opacity="0.5"/>`,
};
// панель-ролевые алиасы
COMPONENT_SVG.PDC = COMPONENT_SVG.panel;
COMPONENT_SVG.MDB = COMPONENT_SVG.panel;
COMPONENT_SVG.UDB = COMPONENT_SVG.panel;
COMPONENT_SVG.PDB = COMPONENT_SVG.panel;
COMPONENT_SVG.PDU = COMPONENT_SVG.panel;
COMPONENT_SVG.JB  = COMPONENT_SVG.panel;
