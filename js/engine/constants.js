/* =========================================================================
   Raschet — конструктор принципиальных схем электроснабжения
   -------------------------------------------------------------------------
   engine/constants.js — все константы проекта (ES module).
   Извлечены из app.js без изменений значений.
   ========================================================================= */

// ================= Версия =================
// APP_VERSION — единая версия Raschet. Она же отображается в футере
// каждой подпрограммы. Отдельной нумерации у модулей нет: любая правка
// по любому модулю инкрементит эту версию.
export const APP_VERSION = '0.59.58';

// ================= Константы =================
export const NODE_H = 120;      // 3 × 40px grid
export const NODE_MIN_W = 200;  // 5 × 40px grid
export const PORT_GAP_MIN = 40; // = grid step
export const PORT_R = 6;
export const SVG_NS = 'http://www.w3.org/2000/svg';

// v0.58.15: Каталог систем. Любой элемент может входить в одну или
// несколько систем (n.systems = ['electrical','data',...]). По умолчанию
// ['electrical']. На странице данного вида (page.kind) видны и фильтруются
// только элементы с соответствующими системами; на этих страницах у элемента
// показываются порты соответствующей системы.
// params — схема параметров системы, используется для ввода в инспекторе
// при включённой системе. Значения хранятся в n.systemParams[sysId][key].
// type: number | text | select; unit — подсказка; options — для select.
export const SYSTEMS_CATALOG = [
  { id: 'electrical',  label: 'Электрика',   icon: '⚡', color: '#d32f2f', pageKinds: ['schematic'], params: [] },
  { id: 'low-voltage', label: 'Слаботочка',  icon: '📶', color: '#1e88e5', pageKinds: ['low-voltage'], params: [
    { key: 'ports',     label: 'Портов', type: 'number', unit: 'шт', min: 0, step: 1 },
    { key: 'cableType', label: 'Тип кабеля', type: 'select', options: ['', 'UTP cat5e', 'UTP cat6', 'UTP cat6A', 'FTP cat6', 'STP cat7', 'оптика OM3', 'оптика OM4', 'оптика OS2', 'RG-6', 'КСПВ', 'КСПВГ', 'FRLS'] },
    { key: 'powerW',    label: 'Потребление', type: 'number', unit: 'Вт', min: 0, step: 0.5 },
    { key: 'voltage',   label: 'Напряжение питания', type: 'select', options: ['', '5 В DC', '12 В DC', '24 В DC', '48 В DC', '230 В AC', 'PoE'] },
    { key: 'note',      label: 'Комментарий', type: 'text' },
  ] },
  { id: 'data',        label: 'Данные',      icon: '🖧',  color: '#059669', pageKinds: ['data','low-voltage'], params: [
    { key: 'rj45',  label: 'RJ45',  type: 'number', unit: 'шт', min: 0, step: 1 },
    { key: 'fiber', label: 'Оптика (SFP)', type: 'number', unit: 'шт', min: 0, step: 1 },
    { key: 'speed', label: 'Скорость', type: 'select', options: ['', '100M', '1G', '2.5G', '10G', '25G', '40G', '100G'] },
    { key: 'poe',   label: 'PoE', type: 'select', options: ['', 'нет', 'PoE', 'PoE+', 'PoE++'] },
  ] },
  { id: 'pipes',       label: 'Трубы',       icon: '🚰', color: '#0ea5e9', pageKinds: ['mechanical'], params: [
    { key: 'dn',       label: 'Условный диаметр DN', type: 'number', unit: 'мм', min: 0, step: 1 },
    { key: 'medium',   label: 'Среда', type: 'select', options: ['', 'ХВС', 'ГВС', 'ЦО', 'канализация', 'конденсат', 'пожарный'] },
    { key: 'pressure', label: 'Давление', type: 'number', unit: 'бар', min: 0, step: 0.1 },
    { key: 'material', label: 'Материал', type: 'select', options: ['', 'сталь', 'медь', 'PP-R', 'PEX', 'ПВХ'] },
  ] },
  { id: 'hvac',        label: 'Воздуховоды', icon: '🌬️', color: '#64748b', pageKinds: ['mechanical'], params: [
    { key: 'size',        label: 'Сечение', type: 'text', unit: 'мм (WxH или ⌀)' },
    { key: 'airflow',     label: 'Расход воздуха', type: 'number', unit: 'м³/ч', min: 0, step: 10 },
    { key: 'pressure',    label: 'Напор (статическое давление)', type: 'number', unit: 'Па', min: 0, step: 10 },
    { key: 'coolingKw',   label: 'Холодопроизводительность', type: 'number', unit: 'кВт', min: 0, step: 0.1 },
    { key: 'heatingKw',   label: 'Теплопроизводительность', type: 'number', unit: 'кВт', min: 0, step: 0.1 },
    { key: 'eer',         label: 'EER (холод)', type: 'number', unit: 'Вт/Вт', min: 0, step: 0.1 },
    { key: 'cop',         label: 'COP (тепло)', type: 'number', unit: 'Вт/Вт', min: 0, step: 0.1 },
    { key: 'refrigerant', label: 'Хладагент', type: 'select', options: ['', 'R32', 'R410A', 'R454B', 'R290', 'R744 (CO₂)', 'R134a'] },
    { key: 'acType',      label: 'Тип кондиционера', type: 'select', options: ['', 'сплит', 'мульти-сплит', 'VRF/VRV', 'канальный', 'кассетный', 'прецизионный', 'чиллер', 'фанкойл'] },
    { key: 'type',        label: 'Назначение воздуховода', type: 'select', options: ['', 'приток', 'вытяжка', 'рециркуляция', 'дымоудаление'] },
  ] },
  { id: 'gas',         label: 'Газ',         icon: '🔥', color: '#f59e0b', pageKinds: ['mechanical'], params: [
    { key: 'medium',   label: 'Среда', type: 'select', options: ['', 'природный', 'СУГ', 'биогаз'] },
    { key: 'pressure', label: 'Давление', type: 'number', unit: 'кПа', min: 0, step: 1 },
    { key: 'dn',       label: 'DN', type: 'number', unit: 'мм', min: 0, step: 1 },
  ] },
  { id: 'fire',        label: 'Пожарная',    icon: '🚨', color: '#dc2626', pageKinds: ['low-voltage'], params: [
    { key: 'zone',       label: 'Зона/шлейф', type: 'text' },
    { key: 'device',     label: 'Тип устройства', type: 'select', options: ['', 'дымовой', 'тепловой', 'пламени', 'газа', 'ручной (ИПР)', 'оповещатель свет.', 'оповещатель звук.', 'оповещатель свето-зв.', 'модуль пожаротуш.', 'задвижка/клапан', 'прибор ППКП'] },
    { key: 'currentMa',  label: 'Ток потребления', type: 'number', unit: 'мА', min: 0, step: 0.5 },
    { key: 'splDb',      label: 'Уровень звука (для оповещателя)', type: 'number', unit: 'дБ', min: 0, step: 1 },
    { key: 'protocol',   label: 'Протокол', type: 'select', options: ['', 'пороговый', 'адресный', 'адресно-аналоговый', 'Rubezh', 'С2000', 'Болид', 'ESSER', 'Bosch'] },
  ] },
  { id: 'security',    label: 'Охрана/СКУД', icon: '🛡️', color: '#7c3aed', pageKinds: ['low-voltage'], params: [
    { key: 'device',    label: 'Тип', type: 'select', options: ['', 'считыватель', 'контроллер СКУД', 'замок электр.', 'замок магнитн.', 'кнопка выхода', 'датчик движения', 'магнитоконтакт', 'вибро-датчик', 'сирена охр.', 'клавиатура', 'ПЦН'] },
    { key: 'zone',      label: 'Зона', type: 'text' },
    { key: 'interface', label: 'Интерфейс', type: 'select', options: ['', 'Wiegand 26', 'Wiegand 34', 'RS-485', 'OSDP', 'TCP/IP', 'Ethernet PoE', 'Mifare', 'EM-Marine', 'Bluetooth'] },
    { key: 'currentMa', label: 'Ток потребления', type: 'number', unit: 'мА', min: 0, step: 1 },
  ] },
  { id: 'video',       label: 'Видеонаблюдение', icon: '📹', color: '#0284c7', pageKinds: ['low-voltage'], params: [
    { key: 'cameras',     label: 'Камер', type: 'number', unit: 'шт', min: 0, step: 1 },
    { key: 'resolution',  label: 'Разрешение', type: 'select', options: ['', '2 MP', '4 MP', '5 MP', '8 MP (4K)', '12 MP'] },
    { key: 'lensType',    label: 'Объектив', type: 'select', options: ['', 'фикс. 2.8 мм', 'фикс. 3.6 мм', 'фикс. 4 мм', 'варио 2.8-12 мм', 'PTZ', 'fisheye', 'моторизир.'] },
    { key: 'irRangeM',    label: 'ИК-подсветка', type: 'number', unit: 'м', min: 0, step: 1 },
    { key: 'bitrateMbps', label: 'Битрейт потока', type: 'number', unit: 'Мбит/с', min: 0, step: 0.5 },
    { key: 'storageDays', label: 'Архив', type: 'number', unit: 'сут', min: 0, step: 1 },
    { key: 'poeW',        label: 'PoE мощность', type: 'number', unit: 'Вт', min: 0, step: 0.5 },
  ] },
];
export function getSystemMeta(id) {
  const built = SYSTEMS_CATALOG.find(s => s.id === id);
  if (built) return built;
  // v0.58.24: пользовательские системы проекта. Хранятся в
  // state.project.customSystems[]. Ленивый lookup через глобальный хук,
  // который выставляет main.js (чтобы не тащить state.js в constants).
  try {
    if (typeof globalThis !== 'undefined' && Array.isArray(globalThis.__raschetCustomSystems)) {
      return globalThis.__raschetCustomSystems.find(s => s.id === id) || null;
    }
  } catch {}
  return null;
}
// Полный перечень систем (built-in + пользовательские) — используется
// в инспекторе и отчётах.
export function getAllSystems() {
  const out = SYSTEMS_CATALOG.slice();
  try {
    if (typeof globalThis !== 'undefined' && Array.isArray(globalThis.__raschetCustomSystems)) {
      for (const s of globalThis.__raschetCustomSystems) {
        if (!out.find(x => x.id === s.id)) out.push(s);
      }
    }
  } catch {}
  return out;
}
// Компатибельные системы для страницы данного вида (какие системы
// «имеют смысл» на данном kind). Если null — без ограничений.
export function systemsForPageKind(kind) {
  if (kind === 'layout' || kind === 'mechanical-layout' || kind === '3d') return null;
  const out = SYSTEMS_CATALOG.filter(s => Array.isArray(s.pageKinds) && s.pageKinds.includes(kind)).map(s => s.id);
  return out.length ? out : null;
}

// Глобальные настройки расчёта. При старте подгружаются из localStorage
// и применяются ко всей схеме; можно менять через шестерёнку в палитре.
export const GLOBAL = {
  // Настройки отображения
  showGrid: true,
  snapToGrid: true,
  gridStep: 40,
  showSourceColors: false,  // false = все красным, true = по цвету источника
  // Расчётные параметры
  voltage3ph: 400,
  voltage1ph: 230,
  defaultCosPhi: 0.92,
  defaultInstallMethod: 'B1',
  defaultAmbient: 30,
  defaultGrouping: 1,
  defaultMaterial: 'Cu',
  defaultInsulation: 'PVC',
  defaultCableType: 'multi',
  maxCableSize: 240,
  maxParallelAuto: 10,
  maxVdropPct: 5,           // макс. допустимое падение напряжения, % (IEC 60364-5-52)
  calcMethod: 'iec',        // методика расчёта кабеля: 'iec' | 'pue'
  parallelProtection: 'individual', // защита параллельных линий: 'individual' | 'common'
  showHelp: true,           // показывать справку «как получено» в инспекторе
  breakerMinMarginPct: 0,   // минимальный запас по In автомата vs Iрасч, %
  // Phase 1.20.4: разрешить уменьшенное сечение нулевой жилы
  // (IEC 60364-5-52 §524.2): при фазе > 16 мм² (Cu) / 25 мм² (Al) в
  // сбалансированной 3ф-системе N = phase/2 (не менее 16/25). Экономит
  // на кабеле больших сечений. По умолчанию OFF (консервативно).
  allowReducedNeutral: false,
  // Phase 1.20.13: при переходе к линии из cable-table (ссылка W-… ↗)
  // или других action-точек — панорамировать и масштабировать холст
  // так чтобы линия была видна. По умолчанию OFF (не менять зум/пан
  // без явного запроса пользователя).
  autoCenterOnSelect: false,
  // Система заземления по умолчанию для всей схемы (IEC 60364-4-41).
  // Определяет базовое количество жил кабеля:
  //   TN-S   — 3L+N+PE = 5 жил (3ф), L+N+PE = 3 жилы (1ф)
  //   TN-C   — 3L+PEN  = 4 жил (3ф), L+PEN  = 2 жил  (1ф)
  //   TN-C-S — комбинация: TN-C на вводе, TN-S после разделения
  //   TT     — как TN-S (3L+N+PE / L+N+PE), но PE локальный
  //   IT-N   — 3L+N+PE = 5 жил (если есть нейтраль)
  //   IT     — 3L+PE   = 4 жил (без нейтрали)
  // Отдельные щиты могут переопределить это поле (panel.earthingOut) —
  // используется для линий, ВЫХОДЯЩИХ из щита.
  earthingSystem: 'TN-S',
  // Справочник уровней напряжения. Каждая запись:
  //   vLL      — напряжение линия-линия (межфазное), В
  //   vLN      — напряжение фаза-ноль, В (для LV AC; для HV/DC = vLL)
  //   phases   — число фаз (3 или 1)
  //   hz       — частота, Гц (50, 60; 0 = DC)
  //   dcPoles  — кол-во полюсов для DC (2 = L+/L−, 3 = L+/M/L−)
  //   category — 'lv' (≤1 кВ AC), 'mv' (1–35 кВ AC), 'hv' (>35 кВ AC), 'dc'
  //              Используется для фильтрации в UI и выбора методик расчёта.
  //              Автопроставляется миграцией migrateVoltageLevels().
  // Метка формируется автоматически: formatVoltageLevelLabel(lv).
  voltageLevels: [
    { vLL: 400,   vLN: 230,   phases: 3, hz: 50, category: 'lv', builtin: true },
    { vLL: 690,   vLN: 400,   phases: 3, hz: 50, category: 'lv', builtin: true },
    { vLL: 10000, vLN: 5774,  phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 6000,  vLN: 3464,  phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 35000, vLN: 20207, phases: 3, hz: 50, category: 'mv', builtin: true },
    { vLL: 110,   vLN: 110,   phases: 1, hz: 50, category: 'lv', builtin: true },
    { vLL: 48,    vLN: 48,    phases: 1, hz: 0, dcPoles: 2, category: 'dc', builtin: true },
  ],
  // Пользовательские типы потребителей (добавляются в проекте, сохраняются с проектом)
  customConsumerCatalog: [],
};

// Категории уровней напряжения (используются для фильтрации UI и валидации
// совместимости соединений / подбора методик расчёта).
export const VOLTAGE_CATEGORIES = {
  lv: { label: 'Низкое напряжение (≤1 кВ AC)',   vMax: 1000 },
  mv: { label: 'Среднее напряжение (1–35 кВ)',   vMin: 1000, vMax: 35000 },
  hv: { label: 'Высокое напряжение (>35 кВ)',    vMin: 35000 },
  dc: { label: 'Постоянный ток (DC)' },
};

/** Определяет category уровня напряжения по vLL и hz. */
export function deriveVoltageCategory(lv) {
  if (!lv) return 'lv';
  if (lv.hz === 0 || lv.dc === true) return 'dc';
  const v = Number(lv.vLL) || 0;
  if (v > 35000) return 'hv';
  if (v >= 1000) return 'mv';
  return 'lv';
}

// Виды соединений для мульти-пространственных схем.
// Каждое соединение имеет connectionKind — определяет расчёт, рендер, применимость.
// electrical — участвует в кабельных расчётах (ampacity, vdrop и т.д.)
// pipe/duct/data — альтернативные системы (трубопровод/воздуховод/слаботочка)
//                  пропускаются модулями расчёта кабелей.
export const CONNECTION_KINDS = {
  electrical: { label: 'Электрическое',       color: '#e53935', style: 'solid' },
  pipe:       { label: 'Трубопровод',         color: '#1976d2', style: 'thick' },
  duct:       { label: 'Воздуховод',          color: '#6b7280', style: 'dashed' },
  data:       { label: 'Информационное',      color: '#00897b', style: 'thin' },
};

// Категории соединений (кабельной продукции) для валидации и фильтрации.
// Силовой кабель нельзя выбрать для слаботочного соединения и наоборот.
export const CABLE_CATEGORIES = {
  power:    { label: 'Силовой',             allowedVoltage: ['lv', 'mv'],  icon: '⚡' },
  hv:       { label: 'Высоковольтный',       allowedVoltage: ['mv', 'hv'], icon: '⚡⚡' },
  signal:   { label: 'Слаботочный (контрольный)', maxVolt: 400,            icon: '✍' },
  data:     { label: 'Информационный (UTP/оптика)', maxVolt: 50,           icon: '📡' },
  fieldbus: { label: 'Полевой (Modbus/CAN/PROFIBUS)', maxVolt: 50,         icon: '🔗' },
  dc:       { label: 'Постоянный ток',      allowedVoltage: ['dc'],       icon: '⎓' },
};

/** Возвращает список допустимых категорий кабеля для данной категории напряжения */
export function allowedCableCategoriesFor(voltageCategory) {
  const out = [];
  for (const [id, c] of Object.entries(CABLE_CATEGORIES)) {
    if (c.allowedVoltage && c.allowedVoltage.includes(voltageCategory)) out.push(id);
    else if (!c.allowedVoltage && c.maxVolt) out.push(id); // сигнальные доступны всегда
  }
  return out;
}

// Описание типов кабельной конструкции по IEC 60228:
//   multi  — многожильный гибкий / класс 5 (штатная кабельная продукция, F/B2/E/D)
//   single — одножильный многопроволочный (в одножильной оболочке, в трубах/каналах)
//   solid  — цельная жила (класс 1-2), применима до 10 мм² (IEC 60228)
export const CABLE_TYPES = {
  multi:  { label: 'Многожильный', solidMax: null },
  single: { label: 'Одножильный многопроволочный', solidMax: null },
  solid:  { label: 'Цельная жила (класс 1–2)', solidMax: 10 },
  busbar: { label: 'Шинопровод', solidMax: null },
};

// Ряд номиналов шинопроводов, А (IEC 61439 / типовой)
export const BUSBAR_SERIES = [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300];

// Ряд номиналов автоматов защиты (MCB до 125А IEC 60898, MCCB до 3200А
// по IEC 60947-2 — Schneider ComPacT NS/NSX, ABB Tmax XT/T, Siemens 3VA,
// ACB от 800 А до 6300 А — MasterPacT MTZ, Emax 2).
export const BREAKER_SERIES = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];

// v0.57.57: ряд номиналов LV-предохранителей (IEC 60269-1, NH/D0 serial).
export const FUSE_SERIES = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250];
// Коэффициент I2/In для плавкой вставки: gG=1.6 (IEC 60269-2), aM=1.6/часто 8-10 старт.
// Для координации In ≤ Iz × 1.45 / k_fuse = Iz × 0.906 (gG).
export const FUSE_I2_K = { gG: 1.6, gM: 1.6, aM: 1.6 };

// Типы защитных устройств (IEC 60898 / IEC 60269)
// I2ratio — коэфф. условного срабатывания (I2 = I2ratio × In)
// magMin/magMax — диапазон мгновенного расцепления (кратность In)
// Типы защитных устройств (IEC 60898 / IEC 60947 / IEC 60269)
// I2ratio — коэфф. условного срабатывания (I2 = I2ratio × In)
// prefix — буква/обозначение перед номиналом (B32, C100, D250...)
export const BREAKER_TYPES = {
  MCB_B:  { label: 'MCB кр. B',  prefix: 'B',  I2ratio: 1.45, magMin: 3,  magMax: 5,   desc: 'Освещение, розетки, длинные линии', maxIn: 63 },
  MCB_C:  { label: 'MCB кр. C',  prefix: 'C',  I2ratio: 1.45, magMin: 5,  magMax: 10,  desc: 'Общее назначение', maxIn: 63 },
  MCB_D:  { label: 'MCB кр. D',  prefix: 'D',  I2ratio: 1.45, magMin: 10, magMax: 20,  desc: 'Тяжёлый пуск, трансформаторы', maxIn: 63 },
  MCCB:   { label: 'MCCB',       prefix: '',    I2ratio: 1.3,  magMin: 5,  magMax: 10,  desc: 'Автомат в литом корпусе (100-3200 А, IEC 60947-2: Schneider ComPacT NS/NSX, ABB Tmax, Siemens 3VA)', maxIn: 3200 },
  ACB:    { label: 'ACB',        prefix: '',    I2ratio: 1.3,  magMin: 2,  magMax: 10,  desc: 'Воздушный автомат (800-6300 А, IEC 60947-2: Schneider MasterPacT MTZ, ABB Emax 2)', maxIn: 6300 },
  gG:     { label: 'Пр-ль gG',   prefix: '',    I2ratio: 1.6,  magMin: 0,  magMax: 0,   desc: 'Предохранитель общего назначения', maxIn: 1600 },
  aM:     { label: 'Пр-ль aM',   prefix: '',    I2ratio: 1.6,  magMin: 0,  magMax: 0,   desc: 'Предохранитель для двигателей', maxIn: 1600 },
  VCB:    { label: 'VCB',        prefix: '',    I2ratio: 1.2,  magMin: 5,  magMax: 15,  desc: 'Вакуумный выключатель 6/10/35 кВ (IEC 62271-100)', maxIn: 4000, hv: true },
  SF6:    { label: 'SF6',        prefix: '',    I2ratio: 1.2,  magMin: 5,  magMax: 15,  desc: 'Элегазовый выключатель 6/35 кВ (IEC 62271-100)', maxIn: 4000, hv: true },
};

// Ряд номиналов HV-выключателей (IEC 62271-100): VCB/SF6 6/10/35 кВ
export const HV_BREAKER_SERIES = [200, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000];

// IEC 60364-5-52 — допустимые длительные токи.
// Структура: IEC_TABLES[material][insulation][method] = [[s_mm2, I_A], ...]
// Медь, ПВХ-изоляция, 3 нагруженных проводника — это и есть прежние значения.
// Алюминий ≈ 0.78 × меди; XLPE ≈ 1.30 × ПВХ (упрощённое приближение IEC tab B.52).
export const IEC_TABLES = {
  Cu: {
    PVC: {
      // A1 — изолированные проводники в трубе в теплоизолированной стене (IEC 60364-5-52 Tab B.52.4)
      A1: [[1.5,13.5],[2.5,18],[4,24],[6,31],[10,42],[16,56],[25,73],[35,89],[50,108],[70,136],[95,164],[120,188],[150,216],[185,245],[240,286],[300,328]],
      // A2 — многожильный кабель в трубе в теплоизолированной стене
      A2: [[1.5,13],[2.5,17.5],[4,23],[6,29],[10,39],[16,52],[25,68],[35,83],[50,99],[70,125],[95,150],[120,172],[150,196],[185,223],[240,261],[300,298]],
      B1: [[1.5,15.5],[2.5,21],[4,28],[6,36],[10,50],[16,68],[25,89],[35,110],[50,134],[70,171],[95,207],[120,239],[150,275],[185,314],[240,369],[300,424]],
      B2: [[1.5,15],[2.5,20],[4,27],[6,34],[10,46],[16,62],[25,80],[35,99],[50,118],[70,149],[95,179],[120,206],[150,236],[185,268],[240,313],[300,358]],
      C:  [[1.5,19.5],[2.5,27],[4,36],[6,46],[10,63],[16,85],[25,112],[35,138],[50,168],[70,213],[95,258],[120,299],[150,344],[185,392],[240,461],[300,530]],
      E:  [[1.5,22],[2.5,30],[4,40],[6,51],[10,70],[16,94],[25,119],[35,148],[50,180],[70,232],[95,282],[120,328],[150,379],[185,434],[240,514],[300,593]],
      F:  [[1.5,26],[2.5,36],[4,49],[6,63],[10,86],[16,115],[25,149],[35,185],[50,225],[70,289],[95,352],[120,410],[150,473],[185,542],[240,641],[300,741]],
      // G — одножильные кабели с интервалами в воздухе (IEC Tab B.52.4)
      G:  [[1.5,28],[2.5,38],[4,52],[6,67],[10,91],[16,122],[25,158],[35,196],[50,238],[70,305],[95,372],[120,435],[150,502],[185,575],[240,679],[300,783]],
      D1: [[1.5,22],[2.5,29],[4,38],[6,47],[10,63],[16,81],[25,104],[35,125],[50,148],[70,183],[95,216],[120,246],[150,278],[185,312],[240,361],[300,408]],
      // D2 — кабель напрямую в земле (без трубы; ≈0.9 × D1, хуже теплоотвод)
      D2: [[1.5,20],[2.5,26],[4,34],[6,42],[10,57],[16,73],[25,94],[35,113],[50,133],[70,165],[95,194],[120,221],[150,250],[185,281],[240,325],[300,367]],
    },
    XLPE: {
      // A1 — изолированные проводники в трубе в теплоизолированной стене (IEC Tab B.52.5)
      A1: [[1.5,17],[2.5,23],[4,31],[6,40],[10,54],[16,73],[25,95],[35,117],[50,141],[70,179],[95,216],[120,249],[150,285],[185,324],[240,380],[300,435]],
      // A2 — многожильный кабель в трубе в теплоизолированной стене
      A2: [[1.5,16.5],[2.5,22],[4,30],[6,38],[10,52],[16,69],[25,90],[35,111],[50,133],[70,168],[95,201],[120,232],[150,265],[185,300],[240,351],[300,401]],
      B1: [[1.5,20],[2.5,27],[4,37],[6,48],[10,66],[16,89],[25,118],[35,145],[50,176],[70,224],[95,271],[120,314],[150,361],[185,412],[240,484],[300,556]],
      B2: [[1.5,20],[2.5,27],[4,36],[6,45],[10,61],[16,82],[25,105],[35,130],[50,155],[70,196],[95,236],[120,271],[150,310],[185,352],[240,411],[300,470]],
      C:  [[1.5,26],[2.5,36],[4,48],[6,61],[10,83],[16,112],[25,147],[35,181],[50,221],[70,280],[95,339],[120,393],[150,452],[185,514],[240,605],[300,696]],
      E:  [[1.5,29],[2.5,40],[4,54],[6,68],[10,94],[16,127],[25,161],[35,200],[50,242],[70,311],[95,378],[120,440],[150,508],[185,582],[240,688],[300,793]],
      F:  [[1.5,34],[2.5,47],[4,64],[6,83],[10,114],[16,152],[25,197],[35,245],[50,297],[70,381],[95,463],[120,539],[150,621],[185,712],[240,842],[300,975]],
      // G — одножильные кабели с интервалами в воздухе (IEC Tab B.52.5)
      G:  [[1.5,36],[2.5,49],[4,67],[6,86],[10,119],[16,158],[25,205],[35,255],[50,310],[70,397],[95,483],[120,564],[150,651],[185,746],[240,882],[300,1019]],
      D1: [[1.5,29],[2.5,38],[4,49],[6,62],[10,83],[16,106],[25,137],[35,164],[50,195],[70,241],[95,285],[120,324],[150,367],[185,412],[240,476],[300,538]],
      D2: [[1.5,26],[2.5,34],[4,44],[6,56],[10,75],[16,95],[25,123],[35,148],[50,176],[70,217],[95,257],[120,292],[150,330],[185,371],[240,428],[300,484]],
    },
  },
  Al: {
    PVC: {
      // Алюминий (IEC tab B.52.4, 3 нагруженных проводника)
      A1: [[2.5,14],[4,18.5],[6,24],[10,32],[16,43],[25,57],[35,70],[50,84],[70,107],[95,129],[120,149],[150,170],[185,194],[240,227],[300,261]],
      A2: [[2.5,13.5],[4,18],[6,23],[10,31],[16,41],[25,53],[35,65],[50,78],[70,99],[95,118],[120,136],[150,155],[185,176],[240,207],[300,237]],
      B1: [[2.5,16],[4,22],[6,28],[10,39],[16,53],[25,69],[35,86],[50,104],[70,133],[95,161],[120,186],[150,214],[185,245],[240,288],[300,331]],
      B2: [[2.5,16],[4,21],[6,26],[10,36],[16,48],[25,62],[35,77],[50,92],[70,116],[95,139],[120,160],[150,184],[185,209],[240,244],[300,279]],
      C:  [[2.5,21],[4,28],[6,36],[10,49],[16,66],[25,87],[35,108],[50,131],[70,166],[95,201],[120,233],[150,268],[185,306],[240,360],[300,413]],
      E:  [[2.5,23],[4,31],[6,40],[10,54],[16,73],[25,93],[35,116],[50,140],[70,181],[95,220],[120,256],[150,295],[185,338],[240,400],[300,463]],
      F:  [[2.5,28],[4,38],[6,49],[10,67],[16,90],[25,116],[35,144],[50,176],[70,225],[95,274],[120,320],[150,369],[185,423],[240,500],[300,578]],
      G:  [[2.5,30],[4,40],[6,52],[10,71],[16,95],[25,123],[35,153],[50,186],[70,238],[95,290],[120,339],[150,392],[185,449],[240,530],[300,611]],
      D1: [[2.5,23],[4,30],[6,37],[10,49],[16,63],[25,81],[35,97],[50,115],[70,143],[95,168],[120,192],[150,217],[185,243],[240,282],[300,318]],
      D2: [[2.5,21],[4,27],[6,33],[10,44],[16,57],[25,73],[35,87],[50,104],[70,129],[95,151],[120,173],[150,195],[185,219],[240,254],[300,286]],
    },
    XLPE: {
      A1: [[2.5,18],[4,24],[6,31],[10,42],[16,57],[25,74],[35,91],[50,110],[70,140],[95,170],[120,197],[150,226],[185,256],[240,300],[300,344]],
      A2: [[2.5,17],[4,23],[6,30],[10,40],[16,54],[25,70],[35,86],[50,104],[70,132],[95,159],[120,184],[150,210],[185,238],[240,278],[300,318]],
      B1: [[2.5,21],[4,29],[6,37],[10,52],[16,69],[25,92],[35,113],[50,137],[70,175],[95,212],[120,245],[150,282],[185,321],[240,378],[300,434]],
      B2: [[2.5,21],[4,28],[6,35],[10,47],[16,64],[25,82],[35,101],[50,121],[70,153],[95,184],[120,212],[150,242],[185,275],[240,321],[300,367]],
      C:  [[2.5,28],[4,37],[6,48],[10,65],[16,87],[25,115],[35,141],[50,173],[70,219],[95,264],[120,307],[150,353],[185,402],[240,472],[300,543]],
      E:  [[2.5,31],[4,42],[6,53],[10,73],[16,99],[25,126],[35,156],[50,189],[70,243],[95,295],[120,343],[150,396],[185,454],[240,539],[300,621]],
      F:  [[2.5,37],[4,50],[6,65],[10,89],[16,118],[25,154],[35,191],[50,232],[70,297],[95,361],[120,421],[150,485],[185,555],[240,656],[300,762]],
      G:  [[2.5,39],[4,53],[6,68],[10,93],[16,124],[25,161],[35,200],[50,243],[70,311],[95,378],[120,441],[150,509],[185,583],[240,688],[300,795]],
      D1: [[2.5,30],[4,38],[6,48],[10,64],[16,83],[25,106],[35,128],[50,151],[70,188],[95,222],[120,252],[150,287],[185,322],[240,372],[300,420]],
      D2: [[2.5,27],[4,34],[6,43],[10,58],[16,75],[25,95],[35,115],[50,136],[70,169],[95,200],[120,227],[150,258],[185,290],[240,335],[300,378]],
    },
  },
};

// Таблицы ампасити для HV-кабелей (IEC 60502-2, XLPE 6/10/35 кВ, 3-жильные).
// Формат: { material: { voltageKV: [[s_mm2, I_A], ...] } }.
// Значения даны для типовых условий: прокладка в земле (метод D2), 20 °C грунт,
// 3 нагруженные жилы. Для упрощения используется одна таблица на класс напряжения;
// поправки по температуре/группировке применяются теми же K_T / K_group, что и для LV.
// Источник: обобщённые данные производителей по IEC 60502-2 (усреднённые).
export const HV_TABLES = {
  Cu: {
    6:  [[25,130],[35,155],[50,185],[70,225],[95,265],[120,300],[150,335],[185,375],[240,435],[300,490],[400,560],[500,625],[630,705],[800,790]],
    10: [[25,130],[35,155],[50,185],[70,220],[95,260],[120,295],[150,330],[185,370],[240,425],[300,480],[400,545],[500,615],[630,690],[800,775]],
    35: [[25,125],[35,150],[50,175],[70,210],[95,250],[120,285],[150,315],[185,360],[240,410],[300,460],[400,525],[500,590],[630,665],[800,745]],
  },
  Al: {
    6:  [[25,100],[35,120],[50,145],[70,175],[95,210],[120,240],[150,270],[185,305],[240,355],[300,400],[400,460],[500,520],[630,590],[800,665]],
    10: [[25,100],[35,120],[50,145],[70,175],[95,205],[120,235],[150,265],[185,300],[240,345],[300,390],[400,450],[500,510],[630,575],[800,650]],
    35: [[25, 95],[35,115],[50,140],[70,165],[95,195],[120,225],[150,255],[185,290],[240,335],[300,375],[400,435],[500,490],[630,555],[800,625]],
  },
};

// Поправка по температуре (IEC 60364-5-52 tab B.52.14), различается для ПВХ и XLPE
export const K_TEMP = {
  PVC:  { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1.00, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.50 },
  XLPE: { 10: 1.15, 15: 1.12, 20: 1.08, 25: 1.04, 30: 1.00, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76, 60: 0.71, 65: 0.65, 70: 0.58 },
};

// Поправка на количество цепей в группе по IEC 60364-5-52, Table B.52.17
// Разные значения для разных методов прокладки:
//   'bundle' — кабели в пучке, в трубе, замкнутом канале (методы A1, A2, B1, B2)
//   'layer'  — однослойно на стене/лотке/полке (методы C, E, F, G)
//   'perf'   — однослойно на перфорированном лотке (методы E, F горизонтально)
export const K_GROUP_TABLES = {
  bundle: { 1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50, 10: 0.48, 12: 0.45, 16: 0.41, 20: 0.38 },
  layer:  { 1: 1.00, 2: 0.85, 3: 0.79, 4: 0.75, 5: 0.73, 6: 0.72, 7: 0.72, 8: 0.71, 9: 0.70, 12: 0.70, 16: 0.70, 20: 0.70 },
  perf:   { 1: 1.00, 2: 0.88, 3: 0.82, 4: 0.77, 5: 0.75, 6: 0.73, 7: 0.73, 8: 0.72, 9: 0.72, 12: 0.72, 16: 0.72, 20: 0.72 },
};
// Legacy совместимость
export const K_GROUP = K_GROUP_TABLES.bundle;

// Единый справочник методов прокладки IEC 60364-5-52.
// Используется И для каналов (channelType → method), И для линий (installMethod).
// method = ключ IEC, label = описание, bundlingDefault = укладка по умолчанию,
// groupType = тип таблицы K_GROUP (bundle/layer/perf).
export const INSTALL_METHODS = {
  A1: { label: 'A1 — Труба в теплоизол. стене',            bundlingDefault: 'touching', groupType: 'bundle' },
  A2: { label: 'A2 — Кабель в теплоизол. стене',           bundlingDefault: 'touching', groupType: 'bundle' },
  B1: { label: 'B1 — Труба на/в стене',                    bundlingDefault: 'touching', groupType: 'bundle' },
  B2: { label: 'B2 — Короб / сплошной лоток',              bundlingDefault: 'touching', groupType: 'bundle' },
  C:  { label: 'C — Открыто на стене',                     bundlingDefault: 'spaced',   groupType: 'layer'  },
  E:  { label: 'E — Перфорированный лоток / в воздухе',    bundlingDefault: 'touching', groupType: 'perf'   },
  F:  { label: 'F — Лестничный лоток / одножильные касающиеся', bundlingDefault: 'spaced', groupType: 'perf' },
  G:  { label: 'G — Одножильные с интервалами',            bundlingDefault: 'spaced',   groupType: 'perf'   },
  D1: { label: 'D1 — В трубе в земле',                     bundlingDefault: 'touching', groupType: 'bundle' },
  D2: { label: 'D2 — Напрямую в земле',                    bundlingDefault: 'touching', groupType: 'bundle' },
};
// CHANNEL_TYPES — legacy-совместимость: маппинг старых id → метод IEC
export const CHANNEL_TYPES = {
  insulated_conduit: { label: 'A1 — Труба в теплоизол. стене',  method: 'A1', bundlingDefault: 'touching' },
  insulated_cable:   { label: 'A2 — Кабель в теплоизол. стене', method: 'A2', bundlingDefault: 'touching' },
  conduit:     { label: 'B1 — Труба на/в стене',        method: 'B1', bundlingDefault: 'touching' },
  tray_solid:  { label: 'B2 — Короб / сплошной лоток',  method: 'B2', bundlingDefault: 'touching' },
  wall:        { label: 'C — Открыто на стене',          method: 'C',  bundlingDefault: 'spaced'   },
  tray_perf:   { label: 'E — Перфорированный лоток',     method: 'E',  bundlingDefault: 'touching' },
  tray_wire:   { label: 'E — Проволочный лоток',         method: 'E',  bundlingDefault: 'spaced'   },
  tray_ladder: { label: 'F — Лестничный лоток',          method: 'F',  bundlingDefault: 'spaced'   },
  air:         { label: 'F — Одножильные касающиеся',    method: 'F',  bundlingDefault: 'spaced'   },
  air_spaced:  { label: 'G — Одножильные с интервалами', method: 'G',  bundlingDefault: 'spaced'   },
  ground:      { label: 'D1 — В трубе в земле',          method: 'D1', bundlingDefault: 'touching' },
  ground_direct:{ label: 'D2 — Напрямую в земле',        method: 'D2', bundlingDefault: 'touching' },
};

// Палитра цветов для линий (источники и ИБП)
// 16 максимально контрастных цветов для визуального разделения линий
export const LINE_COLORS = [
  '#e53935', // красный
  '#1565c0', // синий
  '#2e7d32', // зелёный
  '#ff6f00', // оранжевый
  '#6a1b9a', // фиолетовый
  '#00838f', // бирюзовый
  '#c62828', // тёмно-красный
  '#283593', // индиго
  '#ad1457', // малиновый
  '#00695c', // тёмно-бирюзовый
  '#ef6c00', // тёмно-оранжевый
  '#4527a0', // тёмно-фиолетовый
  '#0277bd', // голубой
  '#558b2f', // оливковый
  '#6d4c41', // коричневый
  '#37474f', // графит
];
let _colorIdx = 0;
function nextLineColor() {
  const c = LINE_COLORS[_colorIdx % LINE_COLORS.length];
  _colorIdx++;
  return c;
}

// Типы узлов и их параметры по умолчанию
export const DEFAULTS = {
  source:    (subtype) => {
    // Utility — городская сеть / ЛЭП (подтип источника, не отдельный тип узла).
    // Рисуется компактным символом опоры. Имеет только выход (HV).
    if (subtype === 'utility') return {
      name: 'Городская сеть', comment: '', lineColor: nextLineColor(), on: true,
      sourceSubtype: 'utility',
      inputs: 0, outputs: 1,
      phase: '3ph', voltage: 10000, cosPhi: 1,
      voltageLevelIdx: 3,     // 10kV 3P по умолчанию (HV ввод)
      ikKA: 10, sscMva: 250,
      xsRsRatio: 10,
    };
    // Трансформатор по умолчанию — БЕЗ входа (можно включить вручную в
    // инспекторе, установив inputs=1 для подключения к utility).
    return {
      name: 'Ввод ТП', comment: '', lineColor: nextLineColor(), capacityKw: 100, on: true,
      sourceSubtype: 'transformer',
      inputs: 0, outputs: 1,
      phase: '3ph', voltage: 400, cosPhi: 0.95,
      voltageLevelIdx: 0,     // вторичная обмотка (LV)
      inputVoltageLevelIdx: 3, // первичная (10kV по умолчанию) — используется если inputs>0
      sscMva: 250,            // мощность КЗ сети, МВА (fallback если utility не подключён)
      ukPct: 4.5,             // каталожное для 400 кВА (IEC 60076-1)
      xsRsRatio: 8,
      snomKva: 400,
      pkW: 5.5,
      p0W: 0.83,
    };
  },
  generator: () => ({
    name: 'ДГУ', comment: '', lineColor: nextLineColor(), capacityKw: 60, on: true, backupMode: true,
    sourceSubtype: 'generator',
    phase: '3ph', voltage: 400, cosPhi: 0.85,
    sscMva: 10, ukPct: 0, xdpp: 0.15, xsRsRatio: 0.5, snomKva: 75,
    triggerNodeId: null,       // legacy single trigger (мигрируется в triggerNodeIds)
    triggerNodeIds: [],        // массив id триггеров
    triggerLogic: 'any',       // 'any' — запуск если ХОТЯ БЫ один отключён; 'all' — все отключены
    // Расширенные группы триггеров (для подменных ДГУ).
    // Каждая группа — независимый сценарий запуска:
    //   name            — имя сценария ("Подмена ДГУ1")
    //   watchInputs     — массив { panelId, inputPort } — следить за конкретными вводами щитов
    //   logic           — 'any' | 'all' (хотя бы один ввод мёртв / все мертвы)
    //   activateOutputs — массив номеров выходов switchover-щита, которые нужно включить
    // Если triggerGroups не пуст — triggerNodeIds игнорируется.
    triggerGroups: [],
    startDelaySec: 5,
    stopDelaySec: 2,
    // Порт собственных нужд (вход для подключения нагрузки СН)
    auxInput: false,          // включить вход СН
    auxInputSide: 'left',     // сторона: 'left' | 'right'
    auxBreakerOn: true,       // автомат СН включен
    auxDemandKw: 0,           // мощность СН (как у потребителя)
    auxCosPhi: 0.85,
  }),
  panel:     () => ({
    name: 'ЩС', comment: '',
    inputs: 2, outputs: 2,
    priorities: [1, 2],
    switchMode: 'auto',
    maintenance: false,      // режим обслуживания — щит полностью обесточен
    manualActiveInput: 0,
    parallelEnabled: [],
    breakerStates: null,     // состояния автоматов выходов: null = все вкл, или Array<boolean>
    avrDelaySec: 2,         // задержка переключения АВР при возврате напряжения, сек
    avrInterlockSec: 1,     // минимальная разбежка между вкл. автоматов двух вводов, сек
    kSim: 1.0,
    sectionInputPriority: 'input', // 'input' — приоритет ввод, 'tie' — приоритет СВ
    capacityA: 160,
    marginMinPct: 2,
    marginMaxPct: 30,
    // Для режима 'sectioned': многосекционный щит (контейнер)
    // Каждая секция — ОТДЕЛЬНЫЙ узел panel в state.nodes
    // sectionIds: [nodeId1, nodeId2, ...] — id дочерних панелей-секций
    sectionIds: null,
    // busTies[i] = { between: [sectionIdx, sectionIdx], closed: false, auto: true,
    //               delaySec: 2, interlockSec: 1 }
    busTies: null,
    busTiePriority: 'input', // 'input' — приоритет ввод (при наличии питания на вводе СВ размыкается), 'tie' — приоритет СВ
    // Для режима avr_paired: привязка выходов к входам.
    // outputInputMap[outIdx] = [inIdx1, inIdx2, ...] — список входов,
    // от которых может работать данный выход (с приоритетами внутри списка).
    outputInputMap: null,
    // Для режима switchover: per-output условия включения.
    // outputActivateWhenDead[outIdx] = nodeId — выход включается
    // когда указанный узел обесточен.
    outputActivateWhenDead: null,
  }),
  ups:       () => ({
    name: 'ИБП', comment: '', lineColor: nextLineColor(),
    // Тип ИБП: 'monoblock' — моноблок (один неделимый блок),
    //          'modular' — модульный (N независимых силовых модулей)
    upsType: 'monoblock',
    // --- Модульный ИБП ---
    // Модель: "корпус (frame) на N слотов" + "установленные модули" +
    // "схема резервирования". Реальная номинальная мощность:
    //   rated = max(0, moduleInstalled − redundancyN) × moduleKwRated
    // где redundancyN берётся из схемы ('N' → 0, 'N+1' → 1, 'N+2' → 2).
    // Пример: корпус 200 кВт на 8 слотов × 25 кВт, установлено 7 модулей,
    //   схема N+1 → номинал 150 кВт (6 × 25), резерв 25 кВт.
    frameKw: 200,             // типоразмер корпуса (максимум), кВт
    moduleKwRated: 25,        // мощность одного модуля, кВт
    moduleSlots: 8,           // количество слотов в корпусе
    moduleInstalled: 7,       // сколько модулей физически установлено
    redundancyScheme: 'N+1',  // 'N' | 'N+1' | 'N+2'
    // Deprecated — оставлены для обратной совместимости с существующими
    // схемами и UI ИБП. Новый код читает frameKw/moduleKwRated/moduleInstalled.
    moduleCount: 4,
    moduleKw: 25,
    modulesActive: [],        // массив активных модулей (вкл/выкл, per-slot)
    capacityKw: 10,           // для моноблока — номинал
    efficiency: 95,
    chargeA: 2,
    batteryKwh: 2,
    batteryChargePct: 100,
    // --- АКБ (внутри ИБП) ---
    // Тип: 'lead-acid' (VRLA/AGM) или 'li-ion' (LiFePO4 и т.п.)
    batteryType: 'lead-acid',
    // Количество элементов (cells) в блоке. Для свинца обычно 180–240
    // (2 В/элемент), для Li-Ion — 120–160 (3.2 В/элемент LFP).
    batteryCellCount: 192,
    // Напряжение одного элемента, В (номинальное)
    batteryCellVoltage: 2.0,
    // Количество блоков (параллельных цепочек батарей) для резервирования
    batteryStringCount: 1,
    // Ёмкость одного элемента, А·ч (для расчёта автономии)
    batteryCapacityAh: 100,
    phase: '3ph', voltage: 400,
    cosPhi: 1.0,
    inputs: 1, outputs: 1,
    priorities: [1],
    on: true,
    // --- Состав защитных аппаратов ---
    // Флаги наличия каждого автомата в ИБП (физически он может отсутствовать).
    hasInputBreaker:       true,   // вводной автомат основного питания
    hasInputBypassBreaker: true,   // вводной автомат байпаса (у онлайн-ИБП)
    hasOutputBreaker:      true,   // выходной автомат
    hasBypassBreaker:      true,   // байпасный автомат (ручной / механический)
    hasBatteryBreaker:     true,   // батарейный автомат (QB)
    // Рабочие состояния автоматов (true = замкнут/вкл)
    inputBreakerOn:       true,
    inputBypassBreakerOn: true,
    outputBreakerOn:      true,
    bypassBreakerOn:      false,  // механический байпас по умолчанию разомкнут
    batteryBreakerOn:     true,
    // Номиналы автоматов (А) — опциональные, ручные
    inputBreakerIn:       null,
    inputBypassBreakerIn: null,
    outputBreakerIn:      null,
    bypassBreakerIn:      null,
    batteryBreakerIn:     null,
    // Статический байпас
    staticBypass: true,
    staticBypassAuto: true,
    staticBypassOverloadPct: 110,
    staticBypassForced: false,
    // Подключение байпасного ввода:
    //   'jumper'    — перемычка от основного ввода (один кабель на ИБП),
    //   'separate'  — отдельный кабель на байпасный ввод (два кабеля).
    // В режиме 'separate' ИБП должен иметь второй вход (inputs ≥ 2),
    // на который подводится независимая линия байпаса.
    bypassFeedMode: 'jumper',
  }),
  consumer:  () => ({
    name: 'Потребитель', comment: '',
    consumerSubtype: 'custom',
    demandKw: 10,
    count: 1,
    inputs: 2,
    outputs: 0,
    inputSide: 'top',        // 'top' | 'left' | 'right' | 'split' (1-й слева, 2-й справа)
    priorities: [1, 2],
    phase: '3ph',
    voltage: 400,
    cosPhi: 0.92,
    kUse: 1.0,
    inrushFactor: 1,
    linkedOutdoorId: null,  // для кондиционера — id наружного блока
    linkedIndoorId: null,   // для наружного блока — id внутреннего
    outdoorKw: 0,           // мощность наружного блока
    outdoorCosPhi: 0.85,
  }),
  // ------- Новые типы -------
  channel:   () => ({
    // Кабельный канал / трасса — определяет УСЛОВИЯ ПРОКЛАДКИ для любых
    // линий, которые через него проходят. Параметры кабелей (материал,
    // изоляция, сечение) задаются в самих линиях, канал только диктует:
    //   - тип трассы (труба / лоток / земля / воздух / ...)
    //   - температуру среды
    //   - расположение кабелей (в пучке, плотно, с зазором)
    name: 'Кабельный канал', comment: '',
    installMethod: 'B1',     // метод прокладки IEC (ключ из INSTALL_METHODS)
    ambientC: 30,
    grouping: 1,              // цепей в группе
    lengthM: 10,
    bundling: 'touching',
    inputs: 0, outputs: 0,
    // Визуальная трасса
    trayWidth: 40,           // ширина трассы, px
    trayLength: 120,         // длина трассы (визуальная), px — не связана с lengthM
    trayAngle: 0,            // угол поворота, градусы (шаг 15°)
    trayMode: false,         // true = визуальная трасса, false = обычный элемент
  }),
  zone:      () => ({
    // Зона / помещение — контейнер для группировки узлов. Членство явное:
    // только то, что есть в memberIds. Новые узлы добавляются в зону только
    // при полном попадании их bbox внутрь зоны при ручном drop.
    name: 'Зона', comment: '',
    zonePrefix: 'Z1',
    width: 600,
    height: 400,
    color: '#e3f2fd',
    memberIds: [],           // явный список ID дочерних узлов
    inputs: 0,
    outputs: 0,
  }),
};

// Справочник типовых потребителей
// Каталог типовых силовых трансформаторов. При выборе заполняются номинальные
// данные: Snom, Uk%, Pk, P0, Xs/Rs (типовое ~10), cos φ (0.92 по умолчанию).
// Значения по ГОСТ 11677 / IEC 60076 для двухобмоточных 6(10)/0.4 кВ.
export const TRANSFORMER_CATALOG = [
  { label: '25 кВА',   snomKva: 25,   ukPct: 4.5, pkW: 0.6,  p0W: 0.105, xsRsRatio: 4 },
  { label: '40 кВА',   snomKva: 40,   ukPct: 4.5, pkW: 0.88, p0W: 0.15,  xsRsRatio: 4 },
  { label: '63 кВА',   snomKva: 63,   ukPct: 4.5, pkW: 1.28, p0W: 0.22,  xsRsRatio: 5 },
  { label: '100 кВА',  snomKva: 100,  ukPct: 4.5, pkW: 1.97, p0W: 0.31,  xsRsRatio: 5 },
  { label: '160 кВА',  snomKva: 160,  ukPct: 4.5, pkW: 2.6,  p0W: 0.42,  xsRsRatio: 6 },
  { label: '250 кВА',  snomKva: 250,  ukPct: 4.5, pkW: 3.7,  p0W: 0.57,  xsRsRatio: 7 },
  { label: '400 кВА',  snomKva: 400,  ukPct: 4.5, pkW: 5.5,  p0W: 0.83,  xsRsRatio: 8 },
  { label: '630 кВА',  snomKva: 630,  ukPct: 5.5, pkW: 7.6,  p0W: 1.05,  xsRsRatio: 8 },
  { label: '1000 кВА', snomKva: 1000, ukPct: 5.5, pkW: 10.8, p0W: 1.55,  xsRsRatio: 10 },
  { label: '1250 кВА', snomKva: 1250, ukPct: 6.0, pkW: 13.5, p0W: 1.9,   xsRsRatio: 10 },
  { label: '1600 кВА', snomKva: 1600, ukPct: 6.0, pkW: 16.5, p0W: 2.3,   xsRsRatio: 10 },
  { label: '2000 кВА', snomKva: 2000, ukPct: 6.0, pkW: 19.0, p0W: 2.7,   xsRsRatio: 10 },
  { label: '2500 кВА', snomKva: 2500, ukPct: 6.0, pkW: 23.0, p0W: 3.2,   xsRsRatio: 12 },
  // Средние силовые (Um ≤ 36 kV), масляные
  { label: '3150 кВА', snomKva: 3150, ukPct: 7.0, pkW: 28.0, p0W: 3.8,   xsRsRatio: 13 },
  { label: '4000 кВА', snomKva: 4000, ukPct: 7.5, pkW: 33.5, p0W: 4.4,   xsRsRatio: 14 },
  { label: '5000 кВА', snomKva: 5000, ukPct: 7.5, pkW: 39.0, p0W: 5.1,   xsRsRatio: 14 },
  { label: '6300 кВА', snomKva: 6300, ukPct: 7.5, pkW: 46.5, p0W: 6.2,   xsRsRatio: 15 },
  // Крупные силовые (35 kV класс)
  { label: '8000 кВА',  snomKva: 8000,  ukPct: 8.0, pkW: 56.0,  p0W: 7.4,  xsRsRatio: 16 },
  { label: '10 000 кВА',  snomKva: 10000,  ukPct: 8.0, pkW: 65.0,  p0W: 8.7,  xsRsRatio: 18 },
  { label: '12 500 кВА',  snomKva: 12500,  ukPct: 10.0, pkW: 76.0,  p0W: 10.0, xsRsRatio: 20 },
  { label: '16 000 кВА',  snomKva: 16000,  ukPct: 10.0, pkW: 85.0,  p0W: 12.0, xsRsRatio: 22 },
  { label: '20 000 кВА',  snomKva: 20000,  ukPct: 10.5, pkW: 100.0, p0W: 14.0, xsRsRatio: 24 },
  { label: '25 000 кВА',  snomKva: 25000,  ukPct: 10.5, pkW: 115.0, p0W: 16.0, xsRsRatio: 26 },
  { label: '32 000 кВА',  snomKva: 32000,  ukPct: 11.0, pkW: 135.0, p0W: 19.0, xsRsRatio: 28 },
  { label: '40 000 кВА',  snomKva: 40000,  ukPct: 11.0, pkW: 155.0, p0W: 22.0, xsRsRatio: 30 },
  { label: '63 000 кВА',  snomKva: 63000,  ukPct: 12.0, pkW: 215.0, p0W: 32.0, xsRsRatio: 34 },
  { label: '80 000 кВА',  snomKva: 80000,  ukPct: 12.0, pkW: 260.0, p0W: 39.0, xsRsRatio: 36 },
  { label: '100 000 кВА', snomKva: 100000, ukPct: 12.5, pkW: 310.0, p0W: 47.0, xsRsRatio: 38 },
];

// ================= Категории потребителей =================
// Функциональная классификация — ортогональна фазности, надёжности,
// voltageCategory. Используется для:
//  - двухуровневого select «Категория → Тип» в инспекторе
//  - авто-фильтра совместимых cable-category (lowvoltage→signal/data)
//  - группировки в отчётах (спецификация по типу нагрузки)
//  - Фаза 6: hvac — единственная категория без внутреннего heat dissipation
export const CONSUMER_CATEGORIES = {
  lighting:   { label: 'Освещение',            icon: '💡', cableCategories: ['power'] },
  socket:     { label: 'Розеточные группы',    icon: '🔌', cableCategories: ['power'] },
  power:      { label: 'Силовая нагрузка',     icon: '⚙', cableCategories: ['power'] },
  hvac:       { label: 'Климат / вентиляция',  icon: '❄', cableCategories: ['power'] },
  it:         { label: 'IT / серверы',         icon: '🖥', cableCategories: ['power', 'data'] },
  lowvoltage: { label: 'Слаботочные системы',  icon: '📡', cableCategories: ['signal', 'data', 'fieldbus'] },
  process:    { label: 'Технологическая',      icon: '🏭', cableCategories: ['power'] },
  other:      { label: 'Прочее',               icon: '—',  cableCategories: ['power'] },
};

// breakerMarginPct — рекомендованный запас автомата (% сверх Iрасч) для
//   исключения ложных срабатываний. Выбор по inrushFactor и роду нагрузки.
// curveHint — рекомендованный тип/кривая автомата для MCB (inrush-дружественная).
export const CONSUMER_CATALOG = [
  // Phase 2.3: widthMm/heightMm/depthMm/weightKg — типовые физические
  // габариты (front×side или footprint×height, мм). Используются как
  // placeholder/default в модалке «Габариты» и на layout-странице.
  { id: 'custom',      category: 'other',      label: 'Произвольный',       demandKw: 10,   cosPhi: 0.92, kUse: 1,    inrushFactor: 1, breakerMarginPct: 25, curveHint: 'MCB_C', phase: '3ph' },
  { id: 'lighting',    category: 'lighting',   label: 'Освещение',           demandKw: 2,    cosPhi: 0.95, kUse: 0.9,  inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 300, heightMm: 300, depthMm: 100 },
  { id: 'socket',      category: 'socket',     label: 'Розеточная группа',   demandKw: 3.5,  cosPhi: 0.95, kUse: 0.3,  inrushFactor: 1, breakerMarginPct: 20, curveHint: 'MCB_C', phase: '1ph', widthMm: 200, heightMm: 100, depthMm: 60 },
  { id: 'motor',       category: 'power',      label: 'Электродвигатель',    demandKw: 15,   cosPhi: 0.85, kUse: 0.7,  inrushFactor: 7, breakerMarginPct: 50, curveHint: 'MCB_D', phase: '3ph', widthMm: 500, heightMm: 400, depthMm: 500, weightKg: 120 },
  { id: 'heater',      category: 'power',      label: 'Электрообогрев',      demandKw: 5,    cosPhi: 1,    kUse: 0.8,  inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 600, heightMm: 400, depthMm: 200, weightKg: 15 },
  { id: 'pump',        category: 'power',      label: 'Насос',               demandKw: 7.5,  cosPhi: 0.85, kUse: 0.7,  inrushFactor: 6, breakerMarginPct: 45, curveHint: 'MCB_D', phase: '3ph', widthMm: 600, heightMm: 500, depthMm: 500, weightKg: 80 },
  { id: 'fan',         category: 'hvac',       label: 'Вентилятор',          demandKw: 5,    cosPhi: 0.8,  kUse: 0.65, inrushFactor: 5, breakerMarginPct: 40, curveHint: 'MCB_D', phase: '3ph', widthMm: 800, heightMm: 800, depthMm: 600, weightKg: 60 },
  { id: 'server',      category: 'it',         label: 'Серверная стойка',    demandKw: 10,   cosPhi: 0.98, kUse: 0.8,  inrushFactor: 1, breakerMarginPct: 25, curveHint: 'MCB_C', phase: '3ph', widthMm: 600, heightMm: 2000, depthMm: 1000, weightKg: 150 },
  { id: 'elevator',    category: 'power',      label: 'Лифт',               demandKw: 20,   cosPhi: 0.85, kUse: 0.3,  inrushFactor: 5, breakerMarginPct: 40, curveHint: 'MCB_D', phase: '3ph', widthMm: 1100, heightMm: 2100, depthMm: 1400, weightKg: 600 },
  { id: 'conditioner', category: 'hvac',       label: 'Кондиционер',         demandKw: 5,    cosPhi: 0.85, kUse: 0.7,  inrushFactor: 3, breakerMarginPct: 35, curveHint: 'MCB_D', phase: '1ph',
    isConditioner: true, outdoorKw: 0.3, outdoorCosPhi: 0.85, widthMm: 900, heightMm: 300, depthMm: 220, weightKg: 12 },
  // Слаботочные системы (lowvoltage) — используют cable-category signal/data/fieldbus
  { id: 'fire-alarm',  category: 'lowvoltage', label: 'Пожарная сигнализация', demandKw: 0.3, cosPhi: 0.9, kUse: 1,    inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 300, heightMm: 400, depthMm: 120, weightKg: 5 },
  { id: 'sks',         category: 'lowvoltage', label: 'СКС (структурированная кабельная сеть)', demandKw: 0.1, cosPhi: 0.9, kUse: 0.5, inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 600, heightMm: 600, depthMm: 400, weightKg: 20 },
  { id: 'cctv',        category: 'lowvoltage', label: 'Видеонаблюдение',      demandKw: 0.5, cosPhi: 0.9, kUse: 0.9,  inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 150, heightMm: 150, depthMm: 100 },
  { id: 'access',      category: 'lowvoltage', label: 'СКУД',                 demandKw: 0.2, cosPhi: 0.9, kUse: 1,    inrushFactor: 1, breakerMarginPct: 15, curveHint: 'MCB_B', phase: '1ph', widthMm: 200, heightMm: 150, depthMm: 80 },
];

// Авто-запас по автомату и авто-кривая/тип — если у потребителя не задан
// явный breakerMarginPct или curveHint, вычисляем по inrushFactor.
// Применяется также к «старым» узлам, созданным до добавления этих полей.
export function autoBreakerMargin(inrushFactor) {
  const k = Number(inrushFactor) || 1;
  if (k >= 6) return 50;   // тяжёлый пуск (двигатели, насосы)
  if (k >= 4) return 40;   // лифты, вентиляторы, большие моторы
  if (k >= 2.5) return 35; // кондиционеры, мелкие компрессоры
  if (k >= 1.5) return 25; // лёгкий inrush (LED, серверы)
  return 20;               // резистивная / смешанная
}
export function autoBreakerCurve(inrushFactor, In) {
  const inA = Number(In) || 0;
  // v0.57.90: MCCB в литом корпусе покрывает до 3200 А (Schneider
  // ComPacT NS/NSX, ABB Tmax, Siemens 3VA). ACB (air circuit breaker)
  // начинается с ~3200 А (MasterPacT MTZ, Emax 2). Раньше порог был
  // 1600 А — оставлял пространство 1600–3200 А в «ACB», хотя это
  // классический MCCB-диапазон.
  if (inA > 3200) return 'ACB';
  if (inA > 125) return 'MCCB';
  const k = Number(inrushFactor) || 1;
  if (k >= 4) return 'MCB_D';
  if (k >= 2) return 'MCB_C';
  return 'MCB_B';
}

// Рекомендуемые номиналы встроенных автоматов ИБП по его мощности.
// Используется как fallback в recalc, когда hasXxxBreaker=true, но
// конкретный номинал в параметрах ИБП не задан. Phase 1.20.66.
//   Iout = capacityKw × 1000 / (U × √3 × cosφ_out)  (3ф) или /(U×cosφ) (1ф)
//   QF3 (выход)      = selectBreaker(Iout × 1.25)          — запас 25%
//   QF1 (вход сети)  = selectBreaker(Iout × 1.25 / eff + заряд) ≈ QF3 × 1.25
//   QF2 (байпас)     = QF3 (байпас рассчитан на ту же нагрузку)
//   QB  (батарея)    = Iout × 1.15 (с учётом низкого U_batt → больший ток)
// Возвращает { input, inputBypass, output, bypass, battery } — номиналы, А.
export function autoUpsBreakerNominals(n) {
  const capKw = Number(n && n.capacityKw) || 0;
  const effPct = Number(n && n.efficiency) || 94;
  const eff = effPct / 100;
  const threePh = (n && n.phases) ? Number(n.phases) === 3 : true;
  const U = Number(n && n.voltageV) || (threePh ? 400 : 230);
  const cosOut = 1.0; // инвертор даёт чистую активную на выходе
  const cosIn = Number(n && n.inputCosPhi) || 0.95;
  if (capKw <= 0 || U <= 0) return { input: null, inputBypass: null, output: null, bypass: null, battery: null };
  const Iout = threePh
    ? (capKw * 1000) / (U * Math.sqrt(3) * cosOut)
    : (capKw * 1000) / (U * cosOut);
  const Iin  = threePh
    ? (capKw * 1000) / (U * Math.sqrt(3) * cosIn * eff)
    : (capKw * 1000) / (U * cosIn * eff);
  const output      = _selectFromSeries(Iout * 1.25);
  const input       = _selectFromSeries(Iin * 1.25);
  const inputBypass = output;
  const bypass      = output;
  const Ubat = Number(n && n.batteryVoltage) || 240;
  const Ibat = (capKw * 1000) / (Ubat * eff);
  const battery = _selectFromSeries(Ibat * 1.15);
  return { input, inputBypass, output, bypass, battery };
}

function _selectFromSeries(I) {
  const series = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  for (const In of series) if (In >= I) return In;
  return series[series.length - 1];
}

// Префиксы обозначений (tag) по типу узла (IEC 81346-2 где возможно)
//   T   — transformer (IEC letter class «T»)
//   G   — generator
//   PNL — панель / распределительный щит (не IEC; оставлено как внутренний префикс)
//   UPS — ИБП (принятое обозначение)
//   L   — consumer (IEC letter class «E» или «L», берём L — «light/load»)
//   CH  — кабельный канал / трасса
//   Z   — zone / объём группировки
export const TAG_PREFIX = {
  source:    'T',
  generator: 'G',
  panel:     'PNL',
  ups:       'UPS',
  consumer:  'L',
  channel:   'CH',
  zone:      'Z',
};
// Префикс для source по подтипу (IEC 81346-2 — буквенные коды
// электрооборудования). Используется при автогенерации обозначения
// нового узла и в отчётах:
//   T  — transformer (трансформатор, IEC 81346-2 letter class «T»)
//   G  — generator (генератор, IEC 81346-2 letter class «G»)
//   W  — городская сеть / внешний ввод (провод/фидер, letter class «W»)
//   SRC — прочие источники (не стандартный IEC)
export const SOURCE_SUBTYPE_PREFIX = {
  transformer: 'T',
  generator:   'G',
  utility:     'W',
  other:       'SRC',
};

// Палитра пастельных цветов для зон (24 цвета). Все — светлые, мягкие,
// не перекрывают содержимое. Распределены по кругу HSL: 12 оттенков,
// каждый в двух вариантах light/mid. Используется в инспекторе зоны
// как селектор 24 swatch'ей.
export const ZONE_PASTEL_PALETTE = [
  '#ffebee', '#fce4ec', '#f3e5f5', '#ede7f6', '#e8eaf6', '#e3f2fd',
  '#e1f5fe', '#e0f7fa', '#e0f2f1', '#e8f5e9', '#f1f8e9', '#f9fbe7',
  '#fffde7', '#fff8e1', '#fff3e0', '#fbe9e7', '#efebe9', '#f5f5f5',
  '#ffd6d6', '#ffe0b2', '#fff9c4', '#dcedc8', '#c8e6c9', '#bbdefb',
];
