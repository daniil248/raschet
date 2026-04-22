// ======================================================================
// shared/scs-catalog-data.js
// Каталог типов IT-оборудования для Компоновщика шкафа (scs-config):
// серверы (generic + AI/GPU), коммутаторы, патч-панели, хранилища,
// ИБП 1U, KVM, мониторы, органайзеры, полки, firewall.
//
// Источник — реальные модельные ряды Supermicro / NVIDIA / Dell / HPE /
// Lenovo / Cisco / Arista / Juniper / HPE Aruba / Palo Alto. Параметры
// взяты из открытых datasheet'ов (height U, глубина шасси, номинальная
// мощность, кол-во портов). При расхождении datasheet ≠ реальная
// конфигурация — пользователь правит поля вручную (каталог в scs-config
// лежит в localStorage, user params are sacred).
//
// Новые kind'ы (v0.59.257):
//   • server-gpu  — AI/GPU-сервер (SXM H100/H200/MI300, PCIe-GPU)
//   • storage     — дисковое хранилище / JBOD
//   • firewall    — next-gen firewall
//   • router      — маршрутизатор
// Классические kind: switch, patch-panel, server, kvm, monitor, ups,
// cable-manager, shelf.
// ======================================================================

/* Базовые generic-типы (были встроены в scs-config.js до v0.59.256). */
export const GENERIC_CATALOG = [
  { id: 'sw-24',    kind: 'switch',       label: 'Коммутатор 24×1G',             heightU: 1, depthMm: 280, powerW: 45,  ports: 24, color: '#60a5fa' },
  { id: 'sw-48',    kind: 'switch',       label: 'Коммутатор 48×1G + 4SFP+',     heightU: 1, depthMm: 380, powerW: 95,  ports: 48, color: '#3b82f6' },
  { id: 'sw-48-mgmt', kind: 'switch',     label: 'Коммутатор 48×1G + mgmt-rear', heightU: 1, depthMm: 380, powerW: 95,  ports: 48, color: '#2563eb', portsRear: true },
  { id: 'pp-24',    kind: 'patch-panel',  label: 'Патч-панель 24 cat.6',         heightU: 1, depthMm: 100, powerW: 0,   ports: 24, color: '#fbbf24' },
  { id: 'pp-48',    kind: 'patch-panel',  label: 'Патч-панель 48 cat.6',         heightU: 2, depthMm: 100, powerW: 0,   ports: 48, color: '#f59e0b' },
  { id: 'srv-1u',   kind: 'server',       label: 'Сервер 1U (типовой)',          heightU: 1, depthMm: 750, powerW: 450, ports: 4,  color: '#a78bfa' },
  { id: 'srv-2u',   kind: 'server',       label: 'Сервер 2U (типовой)',          heightU: 2, depthMm: 800, powerW: 750, ports: 4,  color: '#8b5cf6' },
  { id: 'kvm',      kind: 'kvm',          label: 'Консоль KVM 1U',               heightU: 1, depthMm: 520, powerW: 20,  ports: 8,  color: '#34d399' },
  { id: 'mon-1u',   kind: 'monitor',      label: 'Монитор 1U (выдвижной)',       heightU: 1, depthMm: 620, powerW: 25,  ports: 1,  color: '#10b981' },
  { id: 'ups-1u',   kind: 'ups',          label: 'ИБП 1U 1 кВА',                 heightU: 1, depthMm: 600, powerW: 900, ports: 0,  color: '#f472b6' },
  { id: 'cm-1u',    kind: 'cable-manager',label: 'Кабельный органайзер 1U',      heightU: 1, depthMm: 80,  powerW: 0,   ports: 0,  color: '#94a3b8' },
  { id: 'shelf-1u', kind: 'shelf',        label: 'Полка 1U (400 мм)',            heightU: 1, depthMm: 400, powerW: 0,   ports: 0,  color: '#d97706' },
  { id: 'shelf-2u', kind: 'shelf',        label: 'Полка 2U (600 мм)',            heightU: 2, depthMm: 600, powerW: 0,   ports: 0,  color: '#b45309' },
];

/* Supermicro / NVIDIA — AI / GPU серверы. */
export const AI_SERVERS_CATALOG = [
  // Supermicro HGX / MGX
  { id: 'smc-sys-821ge-tnhr',  kind: 'server-gpu', label: 'Supermicro SYS-821GE-TNHR · 8×H100 SXM5',        manufacturer: 'Supermicro', heightU: 8, depthMm: 925, powerW: 10200, ports: 4, color: '#16a34a', gpuCount: 8 },
  { id: 'smc-sys-421ge-tnhr2', kind: 'server-gpu', label: 'Supermicro SYS-421GE-TNHR2 · 8×H100 SXM5',       manufacturer: 'Supermicro', heightU: 4, depthMm: 900, powerW: 6500,  ports: 4, color: '#15803d', gpuCount: 8 },
  { id: 'smc-as-8125gs-tnhr',  kind: 'server-gpu', label: 'Supermicro AS-8125GS-TNHR · 8×AMD MI300X',       manufacturer: 'Supermicro', heightU: 8, depthMm: 925, powerW: 10000, ports: 4, color: '#059669', gpuCount: 8 },
  { id: 'smc-sys-521ge-tnrt',  kind: 'server-gpu', label: 'Supermicro SYS-521GE-TNRT · 10×PCIe GPU',        manufacturer: 'Supermicro', heightU: 5, depthMm: 845, powerW: 3200,  ports: 4, color: '#10b981', gpuCount: 10 },
  { id: 'smc-ars-211gl-nhir',  kind: 'server-gpu', label: 'Supermicro ARS-211GL-NHIR · GH200 Grace-Hopper', manufacturer: 'Supermicro', heightU: 2, depthMm: 800, powerW: 2000,  ports: 4, color: '#22c55e', gpuCount: 1 },
  { id: 'smc-sys-741ge-tnrt',  kind: 'server-gpu', label: 'Supermicro SYS-741GE-TNRT · 4×PCIe H100',        manufacturer: 'Supermicro', heightU: 4, depthMm: 784, powerW: 2400,  ports: 4, color: '#4ade80', gpuCount: 4 },
  // NVIDIA / HPE
  { id: 'nvidia-dgx-h100',     kind: 'server-gpu', label: 'NVIDIA DGX H100 · 8×H100 SXM5',                  manufacturer: 'NVIDIA',     heightU: 8, depthMm: 897, powerW: 10200, ports: 4, color: '#84cc16', gpuCount: 8 },
  { id: 'nvidia-dgx-h200',     kind: 'server-gpu', label: 'NVIDIA DGX H200 · 8×H200 SXM5',                  manufacturer: 'NVIDIA',     heightU: 8, depthMm: 897, powerW: 10200, ports: 4, color: '#76b900', gpuCount: 8 },
  { id: 'hpe-xd685',           kind: 'server-gpu', label: 'HPE Cray XD685 · 8×H200/MI300X',                 manufacturer: 'HPE',        heightU: 5, depthMm: 900, powerW: 8500,  ports: 4, color: '#65a30d', gpuCount: 8 },
];

/* General-purpose серверы. */
export const GP_SERVERS_CATALOG = [
  { id: 'dell-r760',      kind: 'server', label: 'Dell PowerEdge R760 · 2U 2S Xeon-SP',     manufacturer: 'Dell',      heightU: 2, depthMm: 760, powerW: 1800, ports: 4, color: '#7c3aed' },
  { id: 'dell-r660',      kind: 'server', label: 'Dell PowerEdge R660 · 1U 2S Xeon-SP',     manufacturer: 'Dell',      heightU: 1, depthMm: 740, powerW: 1400, ports: 4, color: '#8b5cf6' },
  { id: 'hpe-dl380g11',   kind: 'server', label: 'HPE ProLiant DL380 Gen11 · 2U',           manufacturer: 'HPE',       heightU: 2, depthMm: 730, powerW: 1600, ports: 4, color: '#a855f7' },
  { id: 'hpe-dl360g11',   kind: 'server', label: 'HPE ProLiant DL360 Gen11 · 1U',           manufacturer: 'HPE',       heightU: 1, depthMm: 720, powerW: 1200, ports: 4, color: '#c084fc' },
  { id: 'lenovo-sr650v3', kind: 'server', label: 'Lenovo ThinkSystem SR650 V3 · 2U',        manufacturer: 'Lenovo',    heightU: 2, depthMm: 755, powerW: 1800, ports: 4, color: '#9333ea' },
  { id: 'cisco-ucs-c240m7', kind: 'server', label: 'Cisco UCS C240 M7 · 2U',                manufacturer: 'Cisco',     heightU: 2, depthMm: 770, powerW: 1600, ports: 4, color: '#6d28d9' },
];

/* Дата-центровые коммутаторы / AI-fabric. */
export const SWITCHES_CATALOG = [
  { id: 'cisco-n9336-fx2',   kind: 'switch', label: 'Cisco Nexus 9336C-FX2 · 36×100G',        manufacturer: 'Cisco',     heightU: 1, depthMm: 558, powerW: 650,  ports: 36, color: '#0284c7' },
  { id: 'cisco-n93180yc',    kind: 'switch', label: 'Cisco Nexus 93180YC-FX3 · 48×25G+6×100G',manufacturer: 'Cisco',     heightU: 1, depthMm: 508, powerW: 550,  ports: 54, color: '#0369a1', portsRear: true },
  { id: 'cisco-cat9300-48p', kind: 'switch', label: 'Cisco Catalyst 9300-48P · 48×1G PoE+',   manufacturer: 'Cisco',     heightU: 1, depthMm: 445, powerW: 480,  ports: 48, color: '#1d4ed8' },
  { id: 'arista-7050cx3',    kind: 'switch', label: 'Arista 7050CX3-32S · 32×100G',           manufacturer: 'Arista',    heightU: 1, depthMm: 507, powerW: 540,  ports: 32, color: '#0891b2' },
  { id: 'arista-7280r3',     kind: 'switch', label: 'Arista 7280R3 · 2U spine',               manufacturer: 'Arista',    heightU: 2, depthMm: 660, powerW: 900,  ports: 48, color: '#06b6d4' },
  { id: 'nvidia-sn3700',     kind: 'switch', label: 'NVIDIA Spectrum SN3700 · 32×200G',       manufacturer: 'NVIDIA',    heightU: 1, depthMm: 660, powerW: 680,  ports: 32, color: '#22d3ee' },
  { id: 'nvidia-sn5600',     kind: 'switch', label: 'NVIDIA Spectrum-X SN5600 · 64×800G',     manufacturer: 'NVIDIA',    heightU: 2, depthMm: 760, powerW: 2400, ports: 64, color: '#67e8f9' },
  { id: 'nvidia-qm9700',     kind: 'switch', label: 'NVIDIA Quantum-2 QM9700 · 64×NDR IB',    manufacturer: 'NVIDIA',    heightU: 1, depthMm: 730, powerW: 1720, ports: 64, color: '#76b900' },
  { id: 'juniper-qfx5120',   kind: 'switch', label: 'Juniper QFX5120-48Y · 48×25G+8×100G',    manufacturer: 'Juniper',   heightU: 1, depthMm: 650, powerW: 520,  ports: 56, color: '#0e7490' },
  { id: 'aruba-cx6300m',     kind: 'switch', label: 'Aruba CX 6300M 48G · 48×1G',             manufacturer: 'HPE Aruba', heightU: 1, depthMm: 400, powerW: 420,  ports: 48, color: '#0d9488' },
];

/* Storage — JBOD / хранилища. */
export const STORAGE_CATALOG = [
  { id: 'smc-ssg-6049p', kind: 'storage', label: 'Supermicro SuperStorage 6049P · 36-bay', manufacturer: 'Supermicro', heightU: 4, depthMm: 915, powerW: 1600, ports: 4, color: '#ea580c', bays: 36 },
  { id: 'dell-me5084',   kind: 'storage', label: 'Dell PowerVault ME5084 · 84-bay JBOD',   manufacturer: 'Dell',       heightU: 5, depthMm: 890, powerW: 1800, ports: 4, color: '#c2410c', bays: 84 },
];

/* Firewall / security. */
export const SECURITY_CATALOG = [
  { id: 'palo-pa5450', kind: 'firewall', label: 'Palo Alto PA-5450 · NGFW', manufacturer: 'Palo Alto', heightU: 5, depthMm: 760, powerW: 2400, ports: 24, color: '#dc2626' },
];

/* Объединённый список — используется в scs-config.js как seed для
   localStorage-каталога (DEFAULT_CATALOG). Auto-append по id при апгрейде. */
export const SCS_DEFAULT_CATALOG = [
  ...GENERIC_CATALOG,
  ...AI_SERVERS_CATALOG,
  ...GP_SERVERS_CATALOG,
  ...SWITCHES_CATALOG,
  ...STORAGE_CATALOG,
  ...SECURITY_CATALOG,
];

export const KIND_LABEL = {
  'switch':        'Коммутатор',
  'patch-panel':   'Патч-панель',
  'server':        'Сервер',
  'server-gpu':    'AI/GPU сервер',
  'storage':       'Хранилище',
  'kvm':           'KVM',
  'monitor':       'Монитор',
  'ups':           'ИБП-1U',
  'cable-manager': 'Органайзер',
  'shelf':         'Полка',
  'firewall':      'Firewall',
  'router':        'Маршрутизатор',
  'other':         'Другое',
};
