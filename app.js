/* =========================================================================
   Raschet — конструктор принципиальных схем электроснабжения
   ------------------------------------------------------------------------
   Состояние:
     state.nodes         : Map<id, Node>          — источники/генераторы/щиты/потребители
     state.conns         : Map<id, Conn>          — связи между портами
     state.modes         : Array<Mode>            — сохранённые режимы работы
     state.activeModeId  : string|null            — активный режим (null = "Нормальный")
     state.selectedKind  : 'node'|'conn'|null
     state.selectedId    : string|null
     state.view          : { x, y, zoom }         — параметры viewBox
   Расчёт:
     recalc() — каскадное распространение demand от потребителей вверх.
     Приоритеты: входы щита/потребителя группируются по значению priority.
     Группа с наименьшим номером и хотя бы одним запитанным фидером —
     активна; внутри группы фидеры делят нагрузку поровну (параллельно).
     Резервные генераторы включаются, только если основного питания нет.
   ========================================================================= */

(() => {
'use strict';

// ================= Константы =================
const NODE_H = 96;
const NODE_MIN_W = 180;
const PORT_GAP_MIN = 34;
const PORT_R = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Глобальные настройки расчёта. При старте подгружаются из localStorage
// и применяются ко всей схеме; можно менять через шестерёнку в палитре.
const GLOBAL = {
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
  maxParallelAuto: 4,
  // Справочник уровней напряжения. Каждая запись:
  //   label  — отображаемое имя ('400V 3P', '10kV 3P')
  //   vLL    — напряжение линия-линия (межфазное), В
  //   vLN    — напряжение фаза-ноль, В
  //   phases — число фаз (3 или 1)
  //   wires  — число проводов (5 = L1+L2+L3+N+PE, 3 = L+N+PE, 4 = L1+L2+L3+PE)
  voltageLevels: [
    { label: '400V 3P+N+PE', vLL: 400, vLN: 230, phases: 3, wires: 5 },
    { label: '230V 1P+N+PE', vLL: 230, vLN: 230, phases: 1, wires: 3 },
    { label: '690V 3P+N+PE', vLL: 690, vLN: 400, phases: 3, wires: 5 },
    { label: '10kV 3P',      vLL: 10000, vLN: 5774, phases: 3, wires: 3 },
    { label: '6kV 3P',       vLL: 6000, vLN: 3464, phases: 3, wires: 3 },
    { label: '35kV 3P',      vLL: 35000, vLN: 20207, phases: 3, wires: 3 },
    { label: '110V DC',      vLL: 110, vLN: 110, phases: 1, wires: 2 },
    { label: '48V DC',       vLL: 48, vLN: 48, phases: 1, wires: 2 },
  ],
};

// Описание типов кабельной конструкции по IEC 60228:
//   multi  — многожильный гибкий / класс 5 (штатная кабельная продукция, F/B2/E/D)
//   single — одножильный многопроволочный (в одножильной оболочке, в трубах/каналах)
//   solid  — цельная жила (класс 1-2), применима до 10 мм² (IEC 60228)
const CABLE_TYPES = {
  multi:  { label: 'Многожильный (гибкий)', solidMax: null },
  single: { label: 'Одножильный многопроволочный', solidMax: null },
  solid:  { label: 'Цельная жила (класс 1–2)', solidMax: 10 },
};

// Ряд номиналов автоматов защиты
const BREAKER_SERIES = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 400, 630, 800, 1000, 1250, 1600];

// IEC 60364-5-52 — допустимые длительные токи.
// Структура: IEC_TABLES[material][insulation][method] = [[s_mm2, I_A], ...]
// Медь, ПВХ-изоляция, 3 нагруженных проводника — это и есть прежние значения.
// Алюминий ≈ 0.78 × меди; XLPE ≈ 1.30 × ПВХ (упрощённое приближение IEC tab B.52).
const IEC_TABLES = {
  Cu: {
    PVC: {
      B1: [[1.5,15.5],[2.5,21],[4,28],[6,36],[10,50],[16,68],[25,89],[35,110],[50,134],[70,171],[95,207],[120,239],[150,275],[185,314],[240,369],[300,424]],
      B2: [[1.5,15],[2.5,20],[4,27],[6,34],[10,46],[16,62],[25,80],[35,99],[50,118],[70,149],[95,179],[120,206],[150,236],[185,268],[240,313],[300,358]],
      C:  [[1.5,19.5],[2.5,27],[4,36],[6,46],[10,63],[16,85],[25,112],[35,138],[50,168],[70,213],[95,258],[120,299],[150,344],[185,392],[240,461],[300,530]],
      E:  [[1.5,22],[2.5,30],[4,40],[6,51],[10,70],[16,94],[25,119],[35,148],[50,180],[70,232],[95,282],[120,328],[150,379],[185,434],[240,514],[300,593]],
      F:  [[1.5,26],[2.5,36],[4,49],[6,63],[10,86],[16,115],[25,149],[35,185],[50,225],[70,289],[95,352],[120,410],[150,473],[185,542],[240,641],[300,741]],
      D1: [[1.5,22],[2.5,29],[4,38],[6,47],[10,63],[16,81],[25,104],[35,125],[50,148],[70,183],[95,216],[120,246],[150,278],[185,312],[240,361],[300,408]],
      // D2 — кабель напрямую в земле (без трубы; ≈0.9 × D1, хуже теплоотвод)
      D2: [[1.5,20],[2.5,26],[4,34],[6,42],[10,57],[16,73],[25,94],[35,113],[50,133],[70,165],[95,194],[120,221],[150,250],[185,281],[240,325],[300,367]],
    },
    XLPE: {
      // Приближение XLPE ≈ 1.30 × PVC (IEC допускает более высокий нагрев жил)
      B1: [[1.5,20],[2.5,27],[4,37],[6,48],[10,66],[16,89],[25,118],[35,145],[50,176],[70,224],[95,271],[120,314],[150,361],[185,412],[240,484],[300,556]],
      B2: [[1.5,20],[2.5,27],[4,36],[6,45],[10,61],[16,82],[25,105],[35,130],[50,155],[70,196],[95,236],[120,271],[150,310],[185,352],[240,411],[300,470]],
      C:  [[1.5,26],[2.5,36],[4,48],[6,61],[10,83],[16,112],[25,147],[35,181],[50,221],[70,280],[95,339],[120,393],[150,452],[185,514],[240,605],[300,696]],
      E:  [[1.5,29],[2.5,40],[4,54],[6,68],[10,94],[16,127],[25,161],[35,200],[50,242],[70,311],[95,378],[120,440],[150,508],[185,582],[240,688],[300,793]],
      F:  [[1.5,34],[2.5,47],[4,64],[6,83],[10,114],[16,152],[25,197],[35,245],[50,297],[70,381],[95,463],[120,539],[150,621],[185,712],[240,842],[300,975]],
      D1: [[1.5,29],[2.5,38],[4,49],[6,62],[10,83],[16,106],[25,137],[35,164],[50,195],[70,241],[95,285],[120,324],[150,367],[185,412],[240,476],[300,538]],
      D2: [[1.5,26],[2.5,34],[4,44],[6,56],[10,75],[16,95],[25,123],[35,148],[50,176],[70,217],[95,257],[120,292],[150,330],[185,371],[240,428],[300,484]],
    },
  },
  Al: {
    PVC: {
      // Алюминий ≈ 0.78 × меди (IEC tab B.52 простое приближение)
      B1: [[2.5,16],[4,22],[6,28],[10,39],[16,53],[25,69],[35,86],[50,104],[70,133],[95,161],[120,186],[150,214],[185,245],[240,288],[300,331]],
      B2: [[2.5,16],[4,21],[6,26],[10,36],[16,48],[25,62],[35,77],[50,92],[70,116],[95,139],[120,160],[150,184],[185,209],[240,244],[300,279]],
      C:  [[2.5,21],[4,28],[6,36],[10,49],[16,66],[25,87],[35,108],[50,131],[70,166],[95,201],[120,233],[150,268],[185,306],[240,360],[300,413]],
      E:  [[2.5,23],[4,31],[6,40],[10,54],[16,73],[25,93],[35,116],[50,140],[70,181],[95,220],[120,256],[150,295],[185,338],[240,400],[300,463]],
      F:  [[2.5,28],[4,38],[6,49],[10,67],[16,90],[25,116],[35,144],[50,176],[70,225],[95,274],[120,320],[150,369],[185,423],[240,500],[300,578]],
      D1: [[2.5,23],[4,30],[6,37],[10,49],[16,63],[25,81],[35,97],[50,115],[70,143],[95,168],[120,192],[150,217],[185,243],[240,282],[300,318]],
      D2: [[2.5,21],[4,27],[6,33],[10,44],[16,57],[25,73],[35,87],[50,104],[70,129],[95,151],[120,173],[150,195],[185,219],[240,254],[300,286]],
    },
    XLPE: {
      B1: [[2.5,21],[4,29],[6,37],[10,52],[16,69],[25,92],[35,113],[50,137],[70,175],[95,212],[120,245],[150,282],[185,321],[240,378],[300,434]],
      B2: [[2.5,21],[4,28],[6,35],[10,47],[16,64],[25,82],[35,101],[50,121],[70,153],[95,184],[120,212],[150,242],[185,275],[240,321],[300,367]],
      C:  [[2.5,28],[4,37],[6,48],[10,65],[16,87],[25,115],[35,141],[50,173],[70,219],[95,264],[120,307],[150,353],[185,402],[240,472],[300,543]],
      E:  [[2.5,31],[4,42],[6,53],[10,73],[16,99],[25,126],[35,156],[50,189],[70,243],[95,295],[120,343],[150,396],[185,454],[240,539],[300,621]],
      F:  [[2.5,37],[4,50],[6,65],[10,89],[16,118],[25,154],[35,191],[50,232],[95,361],[120,421],[150,485],[185,555],[240,656],[300,762]],
      D1: [[2.5,30],[4,38],[6,48],[10,64],[16,83],[25,106],[35,128],[50,151],[70,188],[95,222],[120,252],[150,287],[185,322],[240,372],[300,420]],
      D2: [[2.5,27],[4,34],[6,43],[10,58],[16,75],[25,95],[35,115],[50,136],[70,169],[95,200],[120,227],[150,258],[185,290],[240,335],[300,378]],
    },
  },
};

function cableTable(material, insulation, method) {
  const m = IEC_TABLES[material] || IEC_TABLES.Cu;
  const i = m[insulation] || m.PVC || Object.values(m)[0];
  const t = i[method] || i.B1 || Object.values(i)[0];
  return t;
}

// Поправка по температуре (IEC 60364-5-52 tab B.52.14), различается для ПВХ и XLPE
const K_TEMP = {
  PVC:  { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1.00, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.50 },
  XLPE: { 10: 1.15, 15: 1.12, 20: 1.08, 25: 1.04, 30: 1.00, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76, 60: 0.71, 65: 0.65, 70: 0.58 },
};

// Поправка на количество цепей в группе (упрощённо tab B.52.17, методы B-F)
const K_GROUP = { 1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50, 10: 0.48, 12: 0.45, 16: 0.41, 20: 0.38 };

// Описание типов каналов: тип → метод прокладки по IEC 60364-5-52 + базовое
// расположение (bundling), которое можно переопределить.
const CHANNEL_TYPES = {
  conduit:      { label: 'B1 — Труба на/в стене',        method: 'B1', bundlingDefault: 'touching', icon: '⊚' },
  tray_solid:   { label: 'B2 — Сплошной лоток / короб',  method: 'B2', bundlingDefault: 'touching', icon: '▬' },
  wall:         { label: 'C — Открыто на стене',         method: 'C',  bundlingDefault: 'spaced',   icon: '┃' },
  tray_perf:    { label: 'E — Перфорированный лоток',    method: 'E',  bundlingDefault: 'touching', icon: '⊞' },
  tray_wire:    { label: 'E — Проволочный лоток',        method: 'E',  bundlingDefault: 'spaced',   icon: '⊟' },
  tray_ladder:  { label: 'F — Лестничный лоток',         method: 'F',  bundlingDefault: 'spaced',   icon: '☰' },
  air:          { label: 'F — Свободно в воздухе',       method: 'F',  bundlingDefault: 'spaced',   icon: '〰' },
  ground:       { label: 'D1 — В трубе в земле',         method: 'D1', bundlingDefault: 'touching', icon: '⊘' },
  ground_direct:{ label: 'D2 — Напрямую в земле',        method: 'D2', bundlingDefault: 'touching', icon: '⏚' },
};

// Коэффициент расположения кабелей (IEC 60364-5-52, табл. B.52.17 — упрощённо).
//  spaced  — расстояние ≥ диаметр кабеля: группировка не учитывается вовсе
//  touching— плотно друг к другу: базовый K_group
//  bundled — в жгуте: дополнительное понижение
function kBundlingFactor(bundling) {
  if (bundling === 'spaced') return 1.0;       // без группового ухудшения
  if (bundling === 'bundled') return 0.85;     // ≈ 0.85 сверх обычного K_group (IEC табл. B.52.20)
  return 1.0;                                  // touching — базовое, всё в K_group
}
function kBundlingIgnoresGrouping(bundling) {
  return bundling === 'spaced';
}

function kTempLookup(t, insulation) {
  const tbl = K_TEMP[insulation || 'PVC'] || K_TEMP.PVC;
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - t) < Math.abs(best - t)) best = k;
  return tbl[best];
}
function kGroupLookup(n) {
  const keys = Object.keys(K_GROUP).map(Number).sort((a, b) => a - b);
  const v = Math.max(1, n | 0);
  // Находим ближайший ключ не меньше v
  let best = K_GROUP[1];
  for (const k of keys) { if (k <= v) best = K_GROUP[k]; }
  return best;
}

// Подбор минимального стандартного сечения.
// opts: { material, insulation, method, ambientC, grouping, bundling,
//         conductorsInParallel, cableType, maxSize, allowAutoParallel }
// Если заданное conductorsInParallel не выдерживает ток и ни одно сечение
// до maxSize не подходит, функция автоматически увеличивает параллель
// до maxParallelAuto — и сообщает autoParallel: true.
function selectCableSize(I, opts) {
  const o = opts || {};
  const material = o.material || GLOBAL.defaultMaterial;
  const insulation = o.insulation || GLOBAL.defaultInsulation;
  const method = o.method || GLOBAL.defaultInstallMethod;
  const ambient = Number(o.ambientC) || GLOBAL.defaultAmbient;
  const bundling = o.bundling || 'touching';
  const grouping = kBundlingIgnoresGrouping(bundling)
    ? 1
    : (Number(o.grouping) || GLOBAL.defaultGrouping);
  const cableType = o.cableType || GLOBAL.defaultCableType;
  const maxSize = Number(o.maxSize) || GLOBAL.maxCableSize || 240;
  const allowAutoParallel = o.allowAutoParallel !== false;
  const basePar = Math.max(1, Number(o.conductorsInParallel) || 1);

  const table = cableTable(material, insulation, method);
  const kT = kTempLookup(ambient, insulation);
  const kG = kGroupLookup(grouping) * kBundlingFactor(bundling);
  const k = kT * kG;

  // Для цельных жил — ограничение по max сечению (10 мм² для класса 1-2)
  const typeInfo = CABLE_TYPES[cableType] || CABLE_TYPES.multi;
  const typeSolidMax = typeInfo.solidMax;

  function filterTable(t) {
    return t.filter(([s]) => s <= maxSize && (!typeSolidMax || s <= typeSolidMax));
  }
  const effTable = filterTable(table);

  // Пробуем подобрать сечение для заданного числа параллельных жил.
  // Правило IEC 60364-4-43: Iрасч ≤ In ≤ Iz
  //   — сечение должно быть достаточным, чтобы существовал стандартный
  //     автомат In ≥ Iрасч, при этом In ≤ Iz (автомат защищает кабель).
  function tryWithParallel(parallel) {
    const Iper = I / parallel;
    const InNeeded = selectBreaker(Iper); // ближайший стандартный ≥ Iрасч
    for (const [s, iRef] of effTable) {
      const iDerated = iRef * k;
      // Iz должен быть ≥ In (автомат защищает кабель)
      if (iDerated >= InNeeded) {
        return { s, iAllowed: iRef, iDerated, parallel };
      }
    }
    return null;
  }

  // Сначала с базовым параллелизмом
  let res = tryWithParallel(basePar);

  // Если не хватает — наращиваем параллель.
  let autoParallel = false;
  if (!res && allowAutoParallel) {
    const maxPar = Math.max(basePar, Number(GLOBAL.maxParallelAuto) || 4);
    for (let par = basePar + 1; par <= maxPar; par++) {
      // Пересчитываем K_group под увеличенную группу
      let grp2 = grouping;
      if (!kBundlingIgnoresGrouping(bundling)) {
        grp2 += (par - basePar);
      }
      const kG2 = kGroupLookup(grp2) * kBundlingFactor(bundling);
      const k2 = kT * kG2;
      const Iper = I / par;
      const InNeeded = selectBreaker(Iper);
      for (const [s, iRef] of effTable) {
        const iDerated = iRef * k2;
        // Iz ≥ In ≥ Iрасч — автомат защищает кабель
        if (iDerated >= InNeeded) {
          res = { s, iAllowed: iRef, iDerated, parallel: par };
          autoParallel = true;
          break;
        }
      }
      if (res) break;
    }
  }

  if (res) {
    return {
      s: res.s,
      iAllowed: res.iAllowed,
      iDerated: res.iDerated,
      kT, kG,
      material, insulation, method, bundling, cableType,
      parallel: res.parallel,
      autoParallel,
      totalCapacity: res.iDerated * res.parallel,
    };
  }

  // Не смогли подобрать даже с максимальной параллелью — берём максимум таблицы
  // (в пределах maxSize) и возвращаем overflow
  const last = effTable[effTable.length - 1] || table[table.length - 1];
  return {
    s: last[0], iAllowed: last[1], iDerated: last[1] * k, kT, kG,
    material, insulation, method, bundling, cableType,
    parallel: basePar,
    autoParallel: false,
    totalCapacity: last[1] * k * basePar,
    overflow: true,
  };
}

// Подбор ближайшего большего стандартного автомата
function selectBreaker(Iload) {
  for (const In of BREAKER_SERIES) {
    if (In >= Iload) return In;
  }
  return BREAKER_SERIES[BREAKER_SERIES.length - 1];
}

// Типы узлов и их параметры по умолчанию
const DEFAULTS = {
  source:    () => ({
    name: 'Ввод ТП', capacityKw: 100, on: true,
    sourceSubtype: 'transformer',
    phase: '3ph', voltage: 400, cosPhi: 0.95,
    sscMva: 500,            // мощность КЗ сети, МВА
    ukPct: 6,               // напряжение КЗ трансформатора, %
    xsRsRatio: 10,          // Xs/Rs (для ТП ~10, для ДГУ ~0.5)
    snomKva: 400,           // номинальная мощность трансформатора, кВА
    pkW: 6,                 // потери КЗ трансформатора, кВт (Pk)
    p0W: 1.5,               // потери холостого хода, кВт (P0 / Pfe)
  }),
  generator: () => ({
    name: 'ДГУ', capacityKw: 60, on: true, backupMode: true,
    sourceSubtype: 'generator',
    phase: '3ph', voltage: 400, cosPhi: 0.85,
    sscMva: 10, ukPct: 0, xsRsRatio: 0.5, snomKva: 75,
    triggerNodeId: null,       // legacy single trigger (мигрируется в triggerNodeIds)
    triggerNodeIds: [],        // массив id триггеров
    triggerLogic: 'any',       // 'any' — запуск если ХОТЯ БЫ один отключён; 'all' — все отключены
    startDelaySec: 5,
    stopDelaySec: 2,
  }),
  panel:     () => ({
    name: 'ЩС',
    inputs: 2, outputs: 2,
    priorities: [1, 2],
    switchMode: 'auto',
    manualActiveInput: 0,
    parallelEnabled: [],
    kSim: 1.0,
    capacityA: 160,
    marginMinPct: 2,
    marginMaxPct: 30,
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
    name: 'ИБП',
    capacityKw: 10,
    efficiency: 95,
    chargeA: 2,
    batteryKwh: 2,
    batteryChargePct: 100,
    phase: '3ph', voltage: 400,
    // cos φ ИБП в НОРМАЛЬНОМ режиме (питание через инвертор) — обычно 1.0
    // т.к. выходной инвертор отдаёт чисто активную мощность. Поле ИБП
    // используется только как «пережитковый» fallback; в расчёте при работе
    // через инвертор всегда применяется cos φ = 1.
    cosPhi: 1.0,
    inputs: 1, outputs: 1,
    priorities: [1],
    on: true,
    staticBypass: true,
    staticBypassAuto: true,
    staticBypassOverloadPct: 110,
    staticBypassForced: false,
  }),
  consumer:  () => ({
    name: 'Потребитель',
    demandKw: 10,
    count: 1,
    inputs: 2,
    priorities: [1, 2],
    phase: '3ph',
    voltage: 400,
    cosPhi: 0.92,
    kUse: 1.0,
    inrushFactor: 1,
  }),
  // ------- Новые типы -------
  channel:   () => ({
    // Кабельный канал / трасса — определяет УСЛОВИЯ ПРОКЛАДКИ для любых
    // линий, которые через него проходят. Параметры кабелей (материал,
    // изоляция, сечение) задаются в самих линиях, канал только диктует:
    //   - тип трассы (труба / лоток / земля / воздух / ...)
    //   - температуру среды
    //   - расположение кабелей (в пучке, плотно, с зазором)
    name: 'Кабельный канал',
    channelType: 'conduit',   // conduit | tray_perf | tray_ladder | tray_solid | ground | wall | air
    ambientC: 30,
    lengthM: 10,
    // bundling: способ взаимного расположения кабелей в канале:
    //   touching — плотно друг к другу (базовый K_group)
    //   spaced   — с зазором ≥ 1 диаметр (коэффициент не применяется)
    //   bundled  — в пучке (жёсткий коэффициент)
    bundling: 'touching',
    inputs: 1, outputs: 1,
  }),
  zone:      () => ({
    // Зона / помещение — контейнер для группировки узлов. Членство явное:
    // только то, что есть в memberIds. Новые узлы добавляются в зону только
    // при полном попадании их bbox внутрь зоны при ручном drop.
    name: 'Зона',
    zonePrefix: 'Z1',
    width: 600,
    height: 400,
    color: '#e3f2fd',
    memberIds: [],           // явный список ID дочерних узлов
    inputs: 0,
    outputs: 0,
  }),
};

// Префиксы обозначений (tag) по типу узла
const TAG_PREFIX = {
  source:    'TR',
  generator: 'GS',
  panel:     'PNL',
  ups:       'UPS',
  consumer:  'L',
  channel:   'CH',
  zone:      'Z',
};

// ================= Электротехнические расчёты =================

// Напряжение потребителя по фазе
// Возвращает межфазное напряжение (V_LL) для узла
function nodeVoltage(n) {
  // Если задан voltageLevel — берём из справочника
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].vLL;
  }
  if (n.voltage) return Number(n.voltage);
  return ((n.phase || '3ph') === '3ph') ? GLOBAL.voltage3ph : GLOBAL.voltage1ph;
}
// Фазное напряжение (V_LN) для однофазных расчётов
function nodeVoltageLN(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].vLN;
  }
  return ((n.phase || '3ph') === '3ph') ? GLOBAL.voltage1ph : GLOBAL.voltage1ph;
}
function isThreePhase(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].phases === 3;
  }
  return (n.phase || '3ph') === '3ph';
}
// Число проводов (жил) в кабеле для данного узла
function nodeWireCount(n) {
  if (typeof n.voltageLevelIdx === 'number' && GLOBAL.voltageLevels[n.voltageLevelIdx]) {
    return GLOBAL.voltageLevels[n.voltageLevelIdx].wires;
  }
  return isThreePhase(n) ? 5 : 3;
}

// Установочный ток — ток при номинальной мощности
// I = P / (√3 · U · cos φ)   для 3-фазной
// I = P / (U · cos φ)        для 1-фазной (A/B/C)
function computeCurrentA(P_kW, voltage, cosPhi, threePhase) {
  const P = Number(P_kW) || 0;
  const U = Number(voltage) || 400;
  const cos = Number(cosPhi) || 0.92;
  if (P <= 0) return 0;
  const k = threePhase ? Math.sqrt(3) : 1;
  return (P * 1000) / (k * U * cos);
}

// Номинальный (установочный) ток потребителя или группы
function consumerNominalCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const P = per * cnt;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}
// Расчётный ток (с учётом Ки и loadFactor сценария)
function consumerRatedCurrent(n) {
  const per = Number(n.demandKw) || 0;
  const cnt = Math.max(1, Number(n.count) || 1);
  const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
  const P = per * cnt * k;
  return computeCurrentA(P, nodeVoltage(n), n.cosPhi, isThreePhase(n));
}
// Пусковой ток
function consumerInrushCurrent(n) {
  return consumerNominalCurrent(n) * (Number(n.inrushFactor) || 1);
}

// Мощность заряда ИБП по току в А (переход с chargeA на кВт для учёта в нагрузке)
function upsChargeKw(ups) {
  if (typeof ups.chargeKw === 'number' && !('chargeA' in ups)) return Number(ups.chargeKw) || 0;
  const I = Number(ups.chargeA) || 0;
  const U = Number(ups.voltage) || ((ups.phase === '3ph') ? 400 : 230);
  const k = ((ups.phase || '3ph') === '3ph') ? Math.sqrt(3) : 1;
  // cos φ зарядного = 1 (ориентировочно)
  return (I * U * k) / 1000;
}

// Максимально возможная нагрузка downstream — то что ВХОДНАЯ линия узла
// должна выдержать в худшем случае. Учитывает:
//   - потребители: P_уст × count (без Ки, без loadFactor)
//   - ИБП: нагрузка / КПД + chargeKw (нормальный режим)
//   - щиты: проход без потерь (Ксим НЕ применяется)
//   - параллельные фидеры: если N фидеров на один узел, каждый несёт 1/N
//     (например, 2 ИБП на один UDB → каждый несёт половину нагрузки UDB)
// Максимально возможная нагрузка downstream. Учитывает КПД ИБП, заряд,
// и параллельные фидеры (share).
//
// ВАЖНО: нет глобального `seen` — каждый узел может быть посещён
// несколько раз через разные пути. Это корректно, потому что share
// уже делит нагрузку (2 ИБП на один UDB → каждый видит 0.5).
// Защита от циклов — через локальный `path` стек.
function maxDownstreamLoad(nodeId) {
  function walk(nid, path) {
    if (path.has(nid)) return 0; // цикл — выход
    path.add(nid);
    let total = 0;
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== nid) continue;
      if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;

      // Share: для узлов с параллельным питанием (parallel mode) нагрузка
      // делится между фидерами. Для АВР — один фидер несёт 100% (worst case).
      let share = 1;
      if (to.type === 'panel' && to.switchMode === 'parallel') {
        let feeders = 0;
        const enabledMask = Array.isArray(to.parallelEnabled) ? to.parallelEnabled : [];
        for (const c2 of state.conns.values()) {
          if (c2.to.nodeId === to.id && c2.lineMode !== 'damaged' && c2.lineMode !== 'disabled') {
            // В parallel-режиме считаем только включённые входы
            if (enabledMask[c2.to.port]) feeders++;
          }
        }
        if (feeders > 1) share = 1 / feeders;
      }

      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        total += per * cnt * share;
      } else if (to.type === 'ups') {
        // ИБП: ограничен своим номиналом
        const capKw = Number(to.capacityKw) || 0;
        const eff = Math.max(0.01, (Number(to.efficiency) || 100) / 100);
        const chKw = upsChargeKw(to);
        // Максимум что ИБП потребит на входе = min(downstream, capacity) / eff + charge
        const downstream = walk(to.id, new Set(path));
        const actualLoad = Math.min(downstream, capKw);
        total += (actualLoad / eff + chKw);
      } else if (to.type === 'panel' || to.type === 'channel') {
        total += walk(to.id, new Set(path)) * share;
      }
    }
    path.delete(nid);
    return total;
  }
  return walk(nodeId, new Set());
}

// Финальный cos φ щита — взвешенное по активной мощности.
// Суммирует P и Q = P·tan(acos(cos)) по всем downstream-потребителям, cos_total = P / √(P²+Q²)
// Обход downstream-нагрузок. Возвращает суммарные P и Q в точке nodeId.
// Важная особенность: ИБП в нормальном режиме (через инвертор) «разрывает»
// реактивную связь — всё, что ниже, подаётся с его выхода при cos φ = 1,
// поэтому Q обнуляется, а P остаётся прежним. На статическом байпасе реактивная
// составляющая идёт напрямую со входа, поэтому cos φ потребителей сохраняется.
function downstreamPQ(nodeId) {
  let P = 0, Q = 0;
  const seen = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const to = state.nodes.get(c.to.nodeId);
      if (!to) continue;
      if (to.type === 'consumer') {
        const per = Number(to.demandKw) || 0;
        const cnt = Math.max(1, Number(to.count) || 1);
        const k = (Number(to.kUse) || 1) * effectiveLoadFactor(to);
        const p = per * cnt * k;
        const cos = Math.max(0.1, Math.min(1, Number(to.cosPhi) || 0.92));
        const tan = Math.sqrt(1 - cos * cos) / cos;
        P += p;
        Q += p * tan;
      } else if (to.type === 'panel' || to.type === 'channel') {
        stack.push(to.id);
      } else if (to.type === 'ups') {
        // ИБП: считаем его downstream отдельно и смотрим, в каком он режиме.
        // При работе через инвертор (не на байпасе) cos φ = 1 → Q сбрасывается.
        const sub = downstreamPQ(to.id);
        if (to._onStaticBypass) {
          // Байпас: поток идёт напрямую, реактивка сохраняется
          P += sub.P;
          Q += sub.Q;
        } else {
          // Нормальный режим: ИБП выходом отдаёт только активную мощность
          P += sub.P;
          // Q += 0
        }
      }
    }
  }
  return { P, Q };
}

// Финальный cos φ в произвольной точке схемы (обёртка над downstreamPQ)
function panelCosPhi(panelId) {
  const { P, Q } = downstreamPQ(panelId);
  if (P <= 0) return null;
  return P / Math.sqrt(P * P + Q * Q);
}

// ================= Состояние =================
const state = {
  nodes: new Map(),
  conns: new Map(),
  modes: [],
  activeModeId: null,
  selectedKind: null,
  selectedId: null,
  view: { x: 0, y: 0, zoom: 1 },
  pending: null,     // { fromNodeId, fromPort, mouseX, mouseY, restoreConn? }
  drag: null,        // { nodeId, dx, dy } | { pan, sx, sy, vx, vy }
  readOnly: false,   // просмотр без редактирования
  selection: new Set(), // мульти-выделение: Set<nodeId>
  rubberBand: null,    // { sx, sy, ex, ey } — рамка мульти-выбора
};

let _idSeq = 1;
const uid = (p = 'n') => `${p}${_idSeq++}`;

// ================= Undo / Redo =================
// Снапшотный стек: перед каждым мутирующим действием сохраняется JSON
// текущей схемы. Undo восстанавливает предыдущий снимок, redo — следующий.
// Tag используется для коалесирования подряд идущих мелких правок (например,
// последовательные нажатия клавиш в одном поле инспектора даут один снимок).
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 100;
let _suppressSnapshot = false;
let _lastSnapTag = null;
let _snapCounter = 0;
let _changeCb = null;

function snapshot(tag) {
  if (_suppressSnapshot) return;
  if (tag && tag === _lastSnapTag) return;
  _undoStack.push(JSON.stringify(serialize()));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
  _lastSnapTag = tag || ('#' + (++_snapCounter));
  updateUndoButtons();
}

function clearUndoStack() {
  _undoStack.length = 0;
  _redoStack.length = 0;
  _lastSnapTag = null;
  updateUndoButtons();
}

function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(JSON.stringify(serialize()));
  const prev = _undoStack.pop();
  _suppressSnapshot = true;
  try {
    deserialize(JSON.parse(prev));
    render();
    renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(JSON.stringify(serialize()));
  const next = _redoStack.pop();
  _suppressSnapshot = true;
  try {
    deserialize(JSON.parse(next));
    render();
    renderInspector();
  } finally {
    _suppressSnapshot = false;
  }
  _lastSnapTag = null;
  updateUndoButtons();
  notifyChange();
}

function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = _undoStack.length === 0;
  if (r) r.disabled = _redoStack.length === 0;
}

function notifyChange() {
  if (_changeCb && !state.readOnly && !_suppressSnapshot) {
    try { _changeCb(); } catch (e) { console.error('[onChange]', e); }
  }
}

// Поиск наименьшего свободного обозначения с заданным префиксом (TR1, TR2, …)
function nextFreeTag(type) {
  const prefix = TAG_PREFIX[type] || 'X';
  const used = new Set();
  for (const n of state.nodes.values()) {
    if (n.tag) used.add(n.tag);
  }
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

// Проверка, что tag не занят другим узлом В ТОЙ ЖЕ ЗОНЕ.
// Одинаковые теги допустимы в разных зонах (P1.MDB1 и P2.MDB1 — ок).
function isTagUnique(tag, exceptId) {
  // Определяем зону кандидата
  const candidate = state.nodes.get(exceptId);
  const candidateZone = candidate ? findZoneForMember(candidate) : null;
  const candidateZoneId = candidateZone ? candidateZone.id : null;
  for (const n of state.nodes.values()) {
    if (n.id === exceptId) continue;
    if (n.tag !== tag) continue;
    // Нашли узел с таким же tag — допустим, если он в ДРУГОЙ зоне
    const nZone = findZoneForMember(n);
    const nZoneId = nZone ? nZone.id : null;
    if (nZoneId !== candidateZoneId) continue; // разные зоны → ок
    return false; // та же зона (или обе без зоны) → конфликт
  }
  return true;
}

// ================= DOM refs =================
const svg        = document.getElementById('canvas');
const layerConns = document.getElementById('layer-conns');
const layerNodes = document.getElementById('layer-nodes');
const layerOver  = document.getElementById('layer-overlay');
const inspectorBody = document.getElementById('inspector-body');
const statsEl    = document.getElementById('stats');
const modesListEl = document.getElementById('modes-list');

// ================= Режимы =================
function effectiveOn(n) {
  if (!('on' in n)) return true;
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    if (m && m.overrides && m.overrides[n.id] && 'on' in m.overrides[n.id]) {
      return m.overrides[n.id].on;
    }
  }
  return n.on;
}
function setEffectiveOn(n, val) {
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    if (!m) return;
    if (!m.overrides) m.overrides = {};
    if (!m.overrides[n.id]) m.overrides[n.id] = {};
    m.overrides[n.id].on = val;
  } else {
    n.on = val;
  }
}

// Множитель нагрузки потребителя в текущем режиме (сценарий).
// По умолчанию 1 (100%). Режим «ночь» может выставить 0.2 для освещения и т.д.
function effectiveLoadFactor(n) {
  if (!state.activeModeId) return 1;
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (m && m.overrides && m.overrides[n.id] && typeof m.overrides[n.id].loadFactor === 'number') {
    return m.overrides[n.id].loadFactor;
  }
  return 1;
}
function setEffectiveLoadFactor(n, val) {
  if (!state.activeModeId) return;
  const m = state.modes.find(x => x.id === state.activeModeId);
  if (!m) return;
  if (!m.overrides) m.overrides = {};
  if (!m.overrides[n.id]) m.overrides[n.id] = {};
  m.overrides[n.id].loadFactor = Number(val) || 0;
}
function createMode(name) {
  snapshot();
  const id = uid('m');
  const m = { id, name: name || `Режим ${state.modes.length + 1}`, overrides: {} };
  state.modes.push(m);
  state.activeModeId = id;
  render();
  notifyChange();
}
function deleteMode(id) {
  snapshot();
  state.modes = state.modes.filter(m => m.id !== id);
  if (state.activeModeId === id) state.activeModeId = null;
  render();
  notifyChange();
}
function selectMode(id) {
  state.activeModeId = id;
  render();
  renderInspector();
}

// ================= Геометрия узла =================
function nodeInputCount(n) {
  if (n.type === 'source' || n.type === 'generator') return 0;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.inputs | 0);
}
function nodeOutputCount(n) {
  if (n.type === 'consumer') return 0;
  if (n.type === 'source' || n.type === 'generator') return 1;
  if (n.type === 'zone') return 0;
  return Math.max(0, n.outputs | 0);
}
function nodeWidth(n) {
  if (n.type === 'zone') return Math.max(200, Number(n.width) || 600);
  const maxPorts = Math.max(nodeInputCount(n), nodeOutputCount(n), 1);
  return Math.max(NODE_MIN_W, maxPorts * PORT_GAP_MIN + 24);
}
function nodeHeight(n) {
  if (n.type === 'zone') return Math.max(120, Number(n.height) || 400);
  return NODE_H;
}
function portPos(n, kind, idx) {
  const w = nodeWidth(n);
  const h = nodeHeight(n);
  const count = kind === 'in' ? nodeInputCount(n) : nodeOutputCount(n);
  const gap = w / (count + 1);
  const px = n.x + gap * (idx + 1);
  const py = kind === 'in' ? n.y : n.y + h;
  return { x: px, y: py };
}

// ================= Создание / удаление =================
function createNode(type, x, y) {
  snapshot();
  const id = uid();
  const base = { id, type, x, y, ...DEFAULTS[type]() };
  base.tag = nextFreeTag(type);
  base.x = x - nodeWidth(base) / 2;
  base.y = y - NODE_H / 2;
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}
function deleteNode(id) {
  snapshot();
  for (const c of Array.from(state.conns.values())) {
    if (c.from.nodeId === id || c.to.nodeId === id) state.conns.delete(c.id);
  }
  state.nodes.delete(id);
  for (const m of state.modes) { if (m.overrides) delete m.overrides[id]; }
  if (state.selectedKind === 'node' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  render();
  renderInspector();
  notifyChange();
}
function deleteConn(id) {
  snapshot();
  state.conns.delete(id);
  if (state.selectedKind === 'conn' && state.selectedId === id) {
    state.selectedKind = null; state.selectedId = null;
  }
  render();
  renderInspector();
  notifyChange();
}
function clampPortsInvolvingNode(n) {
  // Порты удалять НЕ разрешаем — пользователь должен сначала снять связи.
  // Эта функция теперь только нормализует вспомогательные массивы.
  if (Array.isArray(n.priorities)) {
    while (n.priorities.length < nodeInputCount(n)) n.priorities.push(n.priorities.length + 1);
    n.priorities.length = nodeInputCount(n);
  }
  if (n.type === 'panel' && Array.isArray(n.parallelEnabled)) {
    while (n.parallelEnabled.length < nodeInputCount(n)) n.parallelEnabled.push(false);
    n.parallelEnabled.length = nodeInputCount(n);
  }
}

// ================= Связи =================
function wouldCreateCycle(fromNodeId, toNodeId) {
  const stack = [toNodeId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromNodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId === cur) stack.push(c.to.nodeId);
    }
  }
  return false;
}
function tryConnect(from, to) {
  if (from.nodeId === to.nodeId) return false;
  for (const c of state.conns.values()) {
    if (c.to.nodeId === to.nodeId && c.to.port === to.port) return false;
    // Выход может иметь только одну исходящую связь
    if (c.from.nodeId === from.nodeId && c.from.port === from.port) return false;
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId)) return false;
  snapshot();
  const id = uid('c');
  const conn = {
    id, from, to,
    // Дефолты по умолчанию для вывода ~1 м до щита/потребителя в норм. условиях
    material: GLOBAL.defaultMaterial,
    insulation: GLOBAL.defaultInsulation,
    installMethod: GLOBAL.defaultInstallMethod,
    ambientC: GLOBAL.defaultAmbient,
    grouping: GLOBAL.defaultGrouping,
    bundling: 'touching',
    lengthM: 1,
  };
  state.conns.set(id, conn);
  notifyChange();
  return id;
}

// ================= Расчёт мощности =================
function recalc() {
  const edgesIn = new Map();
  for (const n of state.nodes.values()) edgesIn.set(n.id, []);
  for (const c of state.conns.values()) {
    // Повреждённые и отключённые линии не проводят электричество
    if (c.lineMode === 'damaged' || c.lineMode === 'disabled') continue;
    edgesIn.get(c.to.nodeId).push(c);
  }

  const cache = new Map();
  function activeInputs(nid, allowBackup) {
    const key = nid + '|' + (allowBackup ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null); // placeholder на случай re-entry

    const n = state.nodes.get(nid);
    let res = null;

    if (n.type === 'source') {
      res = effectiveOn(n) ? [] : null;
    } else if (n.type === 'generator') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        // Список триггеров (поддерживаем и legacy triggerNodeId, и массив)
        const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
          ? n.triggerNodeIds
          : (n.triggerNodeId ? [n.triggerNodeId] : []);

        if (triggers.length) {
          // Проверяем статус каждого триггера
          const statuses = triggers.map(tid => {
            const t = state.nodes.get(tid);
            if (!t) return 'dead'; // удалён → считаем отключённым
            return activeInputs(tid, false) !== null ? 'alive' : 'dead';
          });
          const logic = n.triggerLogic || 'any';
          const shouldStart = logic === 'any'
            ? statuses.some(s => s === 'dead')    // хотя бы один отключён
            : statuses.every(s => s === 'dead');   // все отключены

          if (!shouldStart) {
            res = null; // все триггеры живы → дежурство
          } else if (n._running || (Number(n.startDelaySec) || 0) === 0) {
            // Генератор запущен (или задержка = 0 → мгновенный запуск)
            res = (n.backupMode && !allowBackup) ? null : [];
          } else {
            res = null; // ещё не запустился (ждём startDelaySec)
          }
        } else if (n.backupMode && !allowBackup) {
          res = null;
        } else {
          res = [];
        }
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) {
        res = null;
      } else {
        const ins = edgesIn.get(nid) || [];
        if (ins.length > 0) {
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
        }
        // Батарейный резерв — только если батарея реально есть.
        // При принудительном статическом байпасе батарея не используется.
        if (res === null && allowBackup && !n.staticBypassForced) {
          const batt = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
          if (batt > 0) res = [];
        }
      }
    } else if (n.type === 'channel') {
      // Канал — пассивный узел, просто передаёт питание через себя.
      // Имеет один вход и один выход, логика как у щита без АВР.
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        const live = ins.filter(c => activeInputs(c.from.nodeId, false) !== null);
        if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
        else if (allowBackup) {
          const liveB = ins.filter(c => activeInputs(c.from.nodeId, true) !== null);
          if (liveB.length) res = liveB.map(c => ({ conn: c, share: 1 / liveB.length }));
        }
      }
    } else if (n.type === 'zone') {
      // Зона — чисто декоративный контейнер, в расчёте не участвует
      res = null;
    } else {
      // panel или consumer
      const ins = edgesIn.get(nid) || [];
      if (ins.length > 0) {
        // Ручной режим щита: работает только явно выбранный вход
        if (n.type === 'panel' && n.switchMode === 'manual') {
          const idx = n.manualActiveInput | 0;
          const target = ins.find(c => c.to.port === idx);
          if (target) {
            const upNoBackup = activeInputs(target.from.nodeId, false);
            if (upNoBackup !== null) {
              res = [{ conn: target, share: 1 }];
            } else if (allowBackup) {
              const upWithBackup = activeInputs(target.from.nodeId, true);
              if (upWithBackup !== null) res = [{ conn: target, share: 1 }];
            }
          }
        } else if (n.type === 'panel' && n.switchMode === 'parallel') {
          // Параллельный режим
          const enabledMask = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
          const selected = ins.filter(c => enabledMask[c.to.port]);
          let live = selected.filter(c => activeInputs(c.from.nodeId, false) !== null);
          if (live.length === 0 && allowBackup) {
            live = selected.filter(c => activeInputs(c.from.nodeId, true) !== null);
          }
          if (live.length) res = live.map(c => ({ conn: c, share: 1 / live.length }));
        } else if (n.type === 'panel' && n.switchMode === 'avr_paired') {
          // АВР с привязкой: каждый выход работает от своей группы входов.
          // Для activeInputs щита в целом — берём ВСЕ входы, у которых есть
          // upstream. Но _watchdogActivePorts будет ограничивать выходы
          // в пост-проходе — только те, чей вход по outputInputMap жив.
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
          // Определяем какие выходы активны — по outputInputMap
          if (res) {
            const map = Array.isArray(n.outputInputMap) ? n.outputInputMap : null;
            const activeInPorts = new Set(res.map(r => r.conn.to.port));
            const activePorts = new Set();
            if (map) {
              for (let outIdx = 0; outIdx < (n.outputs || 0); outIdx++) {
                const allowedIns = map[outIdx];
                if (Array.isArray(allowedIns) && allowedIns.some(i => activeInPorts.has(i))) {
                  activePorts.add(outIdx);
                }
              }
            } else {
              // Без карты — все выходы от любого живого входа
              for (let i = 0; i < (n.outputs || 0); i++) activePorts.add(i);
            }
            n._watchdogActivePorts = activePorts;
          }
        } else if (n.type === 'panel' && n.switchMode === 'switchover') {
          // Switchover: один вход (от подменного ДГУ), несколько выходов.
          // Каждый выход активен ТОЛЬКО когда его outputActivateWhenDead узел мёртв.
          // Вход работает по обычному АВР.
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
          // Определяем какие выходы активны — по activateWhenDead
          if (res) {
            const whenDead = Array.isArray(n.outputActivateWhenDead) ? n.outputActivateWhenDead : null;
            const activePorts = new Set();
            for (let outIdx = 0; outIdx < (n.outputs || 0); outIdx++) {
              const watchId = whenDead ? whenDead[outIdx] : null;
              if (!watchId) {
                // Нет условия — выход всегда активен
                activePorts.add(outIdx);
              } else {
                // Выход активен только если watchId обесточен
                const watchNode = state.nodes.get(watchId);
                const watchPowered = watchNode && activeInputs(watchId, true) !== null;
                if (!watchPowered) activePorts.add(outIdx);
              }
            }
            n._watchdogActivePorts = activePorts;
          }
        } else if (n.type === 'panel' && n.switchMode === 'watchdog') {
          // Watchdog-режим: каждый ВХОД i жёстко привязан к ВЫХОДУ i.
          // Вход i работает только когда его upstream МЁРТВ (обесточен).
          // Логика: «если на входе i пропал сигнал → включить выход i от ДГУ».
          // Это обратная логика — «нормально-замкнутый» мониторинг.
          // Реализация: для activeInputs щита — мы собираем все входы,
          // у которых upstream отключён, и делаем их активными.
          // downstream (щит → нагрузки) тогда идёт через те выходы, чей
          // индекс совпадает с активным входом.
          const liveIns = [];
          for (const c of ins) {
            const upAlive = activeInputs(c.from.nodeId, false) !== null;
            if (!upAlive) {
              // upstream отключён → этот вход (и соответственно выход) активируется
              liveIns.push(c);
            }
          }
          if (liveIns.length) {
            res = liveIns.map(c => ({ conn: c, share: 1 / liveIns.length }));
          }
          // Помечаем какие выходы щита реально работают (для renderConns)
          n._watchdogActivePorts = new Set(liveIns.map(c => c.to.port));
        } else {
          // Автоматический режим — группировка по приоритетам с параллельной работой
          const groups = new Map();
          for (const c of ins) {
            const prio = (n.priorities?.[c.to.port]) ?? 1;
            if (!groups.has(prio)) groups.set(prio, []);
            groups.get(prio).push(c);
          }
          const sorted = [...groups.keys()].sort((a, b) => a - b);
          // Фаза 1: без резерва
          for (const p of sorted) {
            const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, false) !== null);
            if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
          }
          // Фаза 2: с резервом
          if (res === null && allowBackup) {
            for (const p of sorted) {
              const live = groups.get(p).filter(c => activeInputs(c.from.nodeId, true) !== null);
              if (live.length) { res = live.map(c => ({ conn: c, share: 1 / live.length })); break; }
            }
          }
        }
      }
    }

    cache.set(key, res);
    return res;
  }

  // Сброс расчётных полей
  for (const n of state.nodes.values()) {
    n._loadKw = 0; n._powered = false; n._overload = false;
    n._watchdogActivePorts = null;
  }
  for (const c of state.conns.values()) { c._active = false; c._loadKw = 0; c._state = 'dead'; }

  // Распространение нагрузки от потребителей вверх.
  // При прохождении границы ИБП поток вверх увеличивается на 1/КПД — это потери
  // на преобразование. Если ИБП работает от батареи (активные входы пусты),
  // visit() завершается — вверх ничего не идёт.
  function walkUp(nid, kw) {
    let depth = 0;
    const visit = (id, flow) => {
      if (depth++ > 2000) return;
      const ai = activeInputs(id, true);
      if (!ai || ai.length === 0) return;
      const nn = state.nodes.get(id);
      // Потери на ИБП применяем только когда он работает через инвертор.
      // На статическом байпасе КПД = 100%.
      const upsActiveLoss = (nn.type === 'ups') && !nn._onStaticBypass;
      const eff = upsActiveLoss
        ? Math.max(0.01, (Number(nn.efficiency) || 100) / 100)
        : 1;
      const flowUp = flow / eff;
      for (const { conn, share } of ai) {
        const upKw = flowUp * share;
        conn._active = true;
        conn._loadKw += upKw;
        const up = state.nodes.get(conn.from.nodeId);
        up._loadKw += upKw;
        up._powered = true;
        visit(up.id, upKw);
      }
    };
    visit(nid, kw);
  }

  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const ai = activeInputs(n.id, true);
    n._powered = ai !== null;
    if (!n._powered) continue;
    // Для группы потребителей: суммарный demand = count × demandKw × loadFactor
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const factor = effectiveLoadFactor(n);
    const total = per * count * factor;
    n._loadKw = total;
    walkUp(n.id, total);
  }

  // Зарядный ток ИБП — накидывается поверх проходной мощности, только если:
  // - ИБП включён
  // - Работает от входа (не от батареи)
  // - НЕ на статическом байпасе (при байпасе инвертор выключен, батарея не
  //   заряжается)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!effectiveOn(n)) continue;
    const ai = activeInputs(n.id, true);
    if (!ai || ai.length === 0) continue;

    // Предварительная проверка байпаса ещё до пост-прохода статусов
    const overloadRatio = (Number(n.capacityKw) || 1) > 0
      ? (n._loadKw || 0) / Number(n.capacityKw) * 100
      : 0;
    const onBypass = n.staticBypass && (
      n.staticBypassForced ||
      (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110))
    );
    if (onBypass) continue;

    const ch = upsChargeKw(n);
    if (ch <= 0) continue;
    walkUp(n.id, ch);
  }

  // Вычисление _state для каждой связи — три цвета
  for (const c of state.conns.values()) {
    if (c._active) {
      // Для watchdog-щита: выход i активен только если вход i в _watchdogActivePorts
      const fromN = state.nodes.get(c.from.nodeId);
      if (fromN && fromN.type === 'panel' && fromN.switchMode === 'watchdog' && fromN._watchdogActivePorts) {
        if (!fromN._watchdogActivePorts.has(c.from.port)) {
          c._active = false;
          c._state = 'dead';
          continue;
        }
      }
      c._state = 'active';
      continue;
    }
    const upAi = activeInputs(c.from.nodeId, true);
    c._state = (upAi !== null) ? 'powered' : 'dead';
  }

  // Статусы источников и ИБП
  for (const n of state.nodes.values()) {
    if (n.type === 'source' || n.type === 'generator') {
      const ai = activeInputs(n.id, true);
      n._powered = ai !== null;
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    } else if (n.type === 'panel') {
      if (!n._powered) n._powered = activeInputs(n.id, true) !== null;
    } else if (n.type === 'ups') {
      const ai = activeInputs(n.id, true);
      n._powered = ai !== null;
      n._onBattery = ai !== null && ai.length === 0;

      // Определяем, работает ли статический байпас.
      // Возможно при: принудительном переключении или автоматическом по перегрузке
      // (и только если ИБП получает питание со входа, не с батареи).
      const overloadRatio = (Number(n.capacityKw) || 1) > 0
        ? (n._loadKw || 0) / Number(n.capacityKw) * 100
        : 0;
      const shouldBypass = (
        n.staticBypass && !n._onBattery && n._powered &&
        (n.staticBypassForced || (n.staticBypassAuto && overloadRatio > (Number(n.staticBypassOverloadPct) || 110)))
      );
      n._onStaticBypass = shouldBypass;

      if (n._powered && !n._onBattery) {
        if (shouldBypass) {
          // Статический байпас: поток идёт мимо инвертора, КПД = 100%,
          // зарядный ток не потребляется (батарея не обслуживается)
          n._inputKw = n._loadKw;
        } else {
          const eff = Math.max(0.01, (Number(n.efficiency) || 100) / 100);
          n._inputKw = n._loadKw / eff + upsChargeKw(n);
        }
      } else {
        n._inputKw = 0;
      }
      if (n._loadKw > Number(n.capacityKw || 0)) n._overload = true;
    }
  }

  // Подсчёт защитных автоматов в щитах:
  // для каждого выхода щита, ведущего к потребителю/каналу/вниз — свой автомат.
  // Для группового потребителя (count > 1) — count автоматов одинакового номинала,
  // подобранных по току ОДНОЙ единицы группы.
  // === Расчёт токов, сечений кабелей и подбор автоматов ===
  // Подсчёт цепей в канале: для каждой линии добавляем столько цепей, сколько
  // у неё параллельных жил (для групповых потребителей это count, для
  // обычных — 1). Если через один канал проходят линия с 3 жилами и линия
  // с 4 жилами, в канале лежит 7 цепей, и каждая жила должна использовать
  // K_group для 7.
  const channelCircuits = new Map(); // channelId → total circuits
  for (const c of state.conns.values()) {
    const ids = Array.isArray(c.channelIds) ? c.channelIds : [];
    if (!ids.length) continue;
    const toN = state.nodes.get(c.to.nodeId);
    let circuits = 1;
    if (toN && toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
      circuits = Number(toN.count) || 1;
    }
    for (const chId of ids) {
      channelCircuits.set(chId, (channelCircuits.get(chId) || 0) + circuits);
    }
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;

    // Характеристики линии — берутся с downstream-узла
    const threePhase = isThreePhase(toN);
    const U = nodeVoltage(toN);

    // Эффективный cos φ линии:
    //   к потребителю → его cos φ
    //   к щиту → взвешенный финальный cos φ щита
    //   к ИБП → 1.0 (выпрямитель потребляет чисто активную мощность из сети)
    //   к каналу → GLOBAL default
    let cos;
    if (toN.type === 'consumer') cos = Number(toN.cosPhi) || GLOBAL.defaultCosPhi;
    else if (toN.type === 'panel') cos = panelCosPhi(toN.id) || GLOBAL.defaultCosPhi;
    else if (toN.type === 'ups') cos = 1.0; // ИБП = чисто активная нагрузка для сети
    else cos = GLOBAL.defaultCosPhi;

    c._voltage = U;
    c._cosPhi = cos;
    c._threePhase = threePhase;
    c._wireCount = nodeWireCount(toN);
    c._loadA = c._loadKw > 0 ? computeCurrentA(c._loadKw, U, cos, threePhase) : 0;

    // === Расчётный ток для подбора кабеля (максимальный по всем сценариям) ===
    // Кабель должен выдержать максимально возможную нагрузку через ДАННУЮ связь.
    let maxKwDownstream;
    if (toN.type === 'consumer') {
      const per = Number(toN.demandKw) || 0;
      const cnt = Math.max(1, Number(toN.count) || 1);
      maxKwDownstream = per * cnt;
    } else if (toN.type === 'ups') {
      // Для линии К ИБП: макс. нагрузка = capacityKw / КПД + chargeKw
      // (ИБП не может выдать больше своего номинала, это его физический предел)
      const capKw = Number(toN.capacityKw) || 0;
      const eff = Math.max(0.01, (Number(toN.efficiency) || 100) / 100);
      const chKw = upsChargeKw(toN);
      maxKwDownstream = capKw / eff + chKw;
    } else if (toN.type === 'panel') {
      maxKwDownstream = maxDownstreamLoad(toN.id);
    } else {
      maxKwDownstream = c._loadKw;
    }
    // Для линии ОТ ИБП (вниз): ИБП не может выдать больше своего номинала.
    // Также cos φ на выходе ИБП = 1.0 (инвертор) в нормальном режиме.
    if (fromN.type === 'ups') {
      const upsCap = Number(fromN.capacityKw) || 0;
      if (upsCap > 0 && maxKwDownstream > upsCap) maxKwDownstream = upsCap;
      if (!fromN._onStaticBypass) cos = 1.0; // инвертор → чисто активная мощность
    }
    const maxCurrent = maxKwDownstream > 0
      ? computeCurrentA(maxKwDownstream, U, cos, threePhase)
      : 0;
    c._maxKw = maxKwDownstream;
    c._maxA = maxCurrent;

    // === Параметры прокладки ===
    // Материал и изоляция — только из самой связи (канал их НЕ переопределяет).
    // Метод, температура, bundling — берутся из канала(ов) по пути; если каналов
    // нет, используются значения по умолчанию в самой связи.
    const channelIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    const material = c.material || GLOBAL.defaultMaterial;
    const insulation = c.insulation || GLOBAL.defaultInsulation;

    let method = c.installMethod || GLOBAL.defaultInstallMethod;
    let ambient = Number(c.ambientC) || GLOBAL.defaultAmbient;
    let bundling = c.bundling || 'touching';
    let grouping = Number(c.grouping) || GLOBAL.defaultGrouping;

    // Ранг «суровости» метода: чем выше, тем меньше допустимый ток при равном сечении
    const methodRank = { F: 0, E: 1, C: 2, B1: 3, B2: 3, D1: 4, D2: 5 };
    const bundlingRank = { spaced: 0, touching: 1, bundled: 2 };

    if (channelIds.length) {
      let worstMethod = null;
      let worstAmbient = 0;
      let worstBundling = null;
      let maxGroup = 0;
      let hasChannel = false;
      for (const chId of channelIds) {
        const ch = state.nodes.get(chId);
        if (!ch || ch.type !== 'channel') continue;
        hasChannel = true;

        // Из канала берём method (по его типу), ambient, bundling
        const chType = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
        const chMethod = chType.method;
        if (worstMethod === null || (methodRank[chMethod] || 0) > (methodRank[worstMethod] || 0)) {
          worstMethod = chMethod;
        }
        const chAmb = Number(ch.ambientC) || 30;
        if (chAmb > worstAmbient) worstAmbient = chAmb;

        const chBundling = ch.bundling || chType.bundlingDefault || 'touching';
        if (worstBundling === null || (bundlingRank[chBundling] || 0) > (bundlingRank[worstBundling] || 0)) {
          worstBundling = chBundling;
        }

        // Группировка — сколько ДРУГИХ цепей идёт через этот же канал
        const grpInCh = channelCircuits.get(chId) || 1;
        if (grpInCh > maxGroup) maxGroup = grpInCh;
      }
      if (hasChannel) {
        method = worstMethod || method;
        ambient = Math.max(ambient, worstAmbient);
        bundling = worstBundling || bundling;
        grouping = Math.max(grouping, maxGroup);
      }
    }

    // Количество параллельных проводников зависит ТОЛЬКО от downstream-нагрузки,
    // а не от канала. Групповой потребитель (count > 1) требует count параллельных
    // кабельных пар — это физика нагрузки, а не прокладки.
    let conductorsInParallel = 1;
    if (toN.type === 'consumer' && (Number(toN.count) || 1) > 1) {
      conductorsInParallel = Number(toN.count) || 1;
    }

    const cableType = c.cableType || GLOBAL.defaultCableType;

    c._cableMaterial = material;
    c._cableInsulation = insulation;
    c._cableMethod = method;
    c._cableAmbient = ambient;
    c._cableBundling = bundling;
    c._cableGrouping = grouping;
    c._cableType = cableType;
    c._cableLength = c.lengthM ?? (channelIds.length ? 0 : 1);
    c._channelChain = channelIds.slice();

    if (maxCurrent > 0) {
      const sel = selectCableSize(maxCurrent, {
        material, insulation, method, ambientC: ambient, grouping, bundling,
        cableType, maxSize: GLOBAL.maxCableSize,
        conductorsInParallel,
      });
      c._cableSize = sel.s;
      c._cableIz = sel.iDerated;
      c._cableTotalIz = sel.totalCapacity;
      c._cableOverflow = !!sel.overflow;
      c._cableAutoParallel = !!sel.autoParallel;
      // Если auto-parallel накинул параллель — записываем фактическое число
      c._cableParallel = sel.parallel;
    } else {
      c._cableSize = null;
      c._cableIz = 0;
      c._cableTotalIz = 0;
      c._cableOverflow = false;
      c._cableAutoParallel = false;
      c._cableParallel = conductorsInParallel;
    }
  }

  // === Подбор защитных автоматов на выходах ===
  // Правило защиты кабеля по IEC 60364-4-43: Iрасч ≤ In ≤ Iz
  //   Iрасч — расчётный ток нагрузки (на одну параллельную линию)
  //   In    — номинал автомата (ближайший больший стандарт ≥ Iрасч)
  //   Iz    — допустимый ток кабеля (с поправками)
  // Если In > Iz — кабель не защищён, нужно увеличить сечение.
  //
  // Для спаренных (auto-parallel) линий:
  //   - Общий автомат = selectBreaker(Iтотал) — на полный ток
  //   - Per-cable автомат = selectBreaker(Iper) — на каждую параллельную линию
  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    if (!fromN) continue;
    if (fromN.type !== 'panel' && fromN.type !== 'ups' && fromN.type !== 'source') {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      continue;
    }
    const toN = state.nodes.get(c.to.nodeId);
    if (!toN) { c._breakerIn = null; c._breakerPerLine = null; c._breakerCount = 0; continue; }

    const parallel = Math.max(1, c._cableParallel || 1);
    const Itotal = c._maxA || 0;
    const Iper = Itotal / parallel;
    const Iz = c._cableIz || 0;

    if (Iper <= 0) {
      c._breakerIn = null;
      c._breakerPerLine = null;
      c._breakerCount = 0;
      continue;
    }

    // Автомат на каждую параллельную линию: Iрасч ≤ In ≤ Iz
    // Кабель уже подобран так, что Iz ≥ In ≥ Iрасч (selectCableSize
    // теперь проверяет Iz ≥ selectBreaker(Iрасч)).
    let InPerLine = selectBreaker(Iper);
    // Дополнительная проверка — на случай если кабель задан вручную
    // или параметры канала изменили Iz после подбора.
    c._breakerAgainstCable = !!(Iz > 0 && InPerLine > Iz);

    // Общий автомат = In × parallel (или ближайший стандарт на полный ток)
    const InTotal = selectBreaker(Itotal);

    if (c._cableAutoParallel && parallel > 1) {
      // Спаренные: общий + per-line
      c._breakerIn = InTotal;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
    } else if (parallel > 1) {
      // Групповая (не спаренная): один автомат per-line × кол-во
      c._breakerIn = null;
      c._breakerPerLine = InPerLine;
      c._breakerCount = parallel;
    } else {
      // Одиночная линия
      c._breakerIn = InPerLine;
      c._breakerPerLine = null;
      c._breakerCount = 1;
    }
  }

  // === Расчёт финального cos φ, P/Q/S и токов для щитов / ИБП / источников ===
  // Ik считаем упрощённо: при базовом сопротивлении источника.
  // Zsource_default = 0.05 Ом на фазе (соответствует ~8 кА короткого на 400 В).
  // Вдоль линии каждый метр добавляет R = ρ × L × 2 / S.
  const RHO = { Cu: 0.0178, Al: 0.0285 }; // Ом·мм²/м

  for (const n of state.nodes.values()) {
    if (n.type === 'panel') {
      // cos φ из downstream PQ (для взвешенного среднего),
      // но P/Q/S привязаны к фактической _loadKw (walkUp уже учёл share)
      const pq = downstreamPQ(n.id);
      n._cosPhi = (pq.P > 0) ? (pq.P / Math.sqrt(pq.P * pq.P + pq.Q * pq.Q)) : null;
      const cos = n._cosPhi || GLOBAL.defaultCosPhi;
      const kSim = Number(n.kSim) || 1;
      const P = (n._loadKw || 0) * kSim;
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = P;
      n._powerQ = P * tan;
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._calcKw = (n._loadKw || 0) * kSim;
      n._loadA = n._calcKw > 0 ? computeCurrentA(n._calcKw, nodeVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;
      // Максимально возможная нагрузка (все потребители на 100%)
      n._maxLoadKw = maxDownstreamLoad(n.id);
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeVoltage(n), n._cosPhi || GLOBAL.defaultCosPhi, isThreePhase(n)) : 0;

      // Проверка номинала шкафа — в амперах (основная единица для щитов).
      // margin% = (In - Iрасч) / Iрасч × 100
      // Параллельно считаем эквивалентную номинальную мощность для справки.
      const capA = Number(n.capacityA) || 0;
      const loadA = n._loadA || 0;
      if (capA > 0) {
        // Вычисляем эквивалентную номинальную мощность шкафа при текущем
        // напряжении и cos φ (или default cos φ если downstream пусто).
        const cos = n._cosPhi || GLOBAL.defaultCosPhi;
        n._capacityKwFromA = capA * nodeVoltage(n) * (isThreePhase(n) ? Math.sqrt(3) : 1) * cos / 1000;
      } else {
        n._capacityKwFromA = 0;
      }
      // Сравниваем номинал с МАКСИМАЛЬНЫМ расчётным током (не текущим)
      const maxA = n._maxLoadA || 0;
      if (capA > 0 && maxA > 0) {
        const margin = ((capA - maxA) / maxA) * 100;
        n._marginPct = margin;
        const hi = Number(n.marginMaxPct);
        const maxP = isFinite(hi) ? hi : 30;
        if (margin < 0) n._marginWarn = 'undersize';   // номинал < макс.тока → красный
        else if (margin > maxP) n._marginWarn = 'oversize'; // избыточный запас → фиолетовый
        else n._marginWarn = null;
      } else {
        n._marginPct = null;
        n._marginWarn = null;
      }
    } else if (n.type === 'source' || n.type === 'generator') {
      // cos φ из downstream PQ, но P/S привязаны к _loadKw (walkUp result)
      const pq = downstreamPQ(n.id);
      n._cosPhi = (pq.P > 0) ? (pq.P / Math.sqrt(pq.P * pq.P + pq.Q * pq.Q)) : Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      const cos = n._cosPhi;
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = n._loadKw || 0;
      n._powerQ = n._powerP * tan;
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      // Максимально возможная нагрузка (все потребители на 100% без Ки)
      n._maxLoadKw = maxDownstreamLoad(n.id);
      n._maxLoadA = n._maxLoadKw > 0 ? computeCurrentA(n._maxLoadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
      // Ток КЗ на шинах источника: Ik = c × U / (√3 × Zs), c=1.1 (IEC 60909)
      const Uph = isThreePhase(n) ? nodeVoltage(n) / Math.sqrt(3) : nodeVoltage(n);
      const Zs = sourceImpedance(n);
      n._ikA = Zs > 0 ? (1.1 * Uph / Zs) : Infinity;
    } else if (n.type === 'ups') {
      // P/Q для ИБП берём из фактической нагрузки (_loadKw), а не из
      // downstreamPQ — потому что downstream может быть общим с
      // параллельным ИБП (два ИБП на один щит), и downstreamPQ
      // посчитает полную нагрузку обоих, а не долю этого ИБП.
      n._powerP = n._loadKw || 0;
      if (n._onStaticBypass) {
        // При байпасе cos φ = от потребителей → вычисляем Q из downstream
        const sub = downstreamPQ(n.id);
        const ratio = (sub.P > 0 && n._loadKw > 0) ? (n._loadKw / sub.P) : 1;
        n._powerQ = sub.Q * ratio; // пропорционально доле этого ИБП
      } else {
        // Инвертор — чисто активная мощность, Q = 0
        n._powerQ = 0;
      }
      n._powerS = Math.sqrt(n._powerP * n._powerP + n._powerQ * n._powerQ);
      n._cosPhi = n._powerS > 0 ? (n._powerP / n._powerS) : 1.0;
      n._loadA = n._loadKw > 0 ? computeCurrentA(n._loadKw, nodeVoltage(n), n._cosPhi, isThreePhase(n)) : 0;
    } else if (n.type === 'consumer') {
      n._cosPhi = Number(n.cosPhi) || GLOBAL.defaultCosPhi;
      n._nominalA = consumerNominalCurrent(n);
      n._ratedA = consumerRatedCurrent(n);
      n._inrushA = consumerInrushCurrent(n);
      // Мгновенные P / Q потребителя
      const per = Number(n.demandKw) || 0;
      const cnt = Math.max(1, Number(n.count) || 1);
      const k = (Number(n.kUse) || 1) * effectiveLoadFactor(n);
      const p = per * cnt * k;
      const cos = Math.max(0.1, Math.min(1, n._cosPhi));
      const tan = Math.sqrt(1 - cos * cos) / cos;
      n._powerP = p;
      n._powerQ = p * tan;
      n._powerS = Math.sqrt(p * p + (p * tan) * (p * tan));
    }
  }

  // === Ток КЗ Ik в каждой точке схемы ===
  // Ik распространяется от источника вниз по активным линиям.
  // Каждый участок кабеля добавляет сопротивление: R = ρ × L × 2 / S / N
  // где N — число параллельных жил.
  // Подход: для каждого узла идём вверх по активному фидеру до источника,
  // накапливаем импеданс, считаем Ik = Uph / Ztot.
  function nodeIk(nid, visited) {
    visited = visited || new Set();
    if (visited.has(nid)) return Infinity;
    visited.add(nid);
    const n = state.nodes.get(nid);
    if (!n) return Infinity;
    if (n.type === 'source' || n.type === 'generator') {
      const Uph = isThreePhase(n) ? nodeVoltage(n) / Math.sqrt(3) : nodeVoltage(n);
      const Zs = sourceImpedance(n);
      return Zs > 0 ? (1.1 * Uph / Zs) : Infinity;
    }
    // ИБП в норме — сам ограничивает Ik до ~1.5..2× номинала
    if (n.type === 'ups' && !n._onStaticBypass) {
      return (n._loadA || 0) * 2 + 50;
    }
    // Ищем активный фидер, через него идём вверх
    for (const c of state.conns.values()) {
      if (c.to.nodeId !== nid) continue;
      if (c._state !== 'active') continue;
      const upIk = nodeIk(c.from.nodeId, visited);
      if (!isFinite(upIk) || upIk <= 0) continue;
      // Добавляем сопротивление линии (фаза + ноль, двойная длина жилы)
      const rho = RHO[c._cableMaterial || 'Cu'] || RHO.Cu;
      const L = Number(c._cableLength || c.lengthM || 1);
      const S = Number(c._cableSize) || 1;
      const par = Math.max(1, c._cableParallel || 1);
      const rSeg = (rho * L * 2) / S / par; // Ом (простая оценка)
      // Z_up = Uph / upIk; Z_new = Z_up + rSeg; Ik_new = Uph / Z_new
      const fromN = state.nodes.get(c.from.nodeId);
      const Uph = isThreePhase(fromN || n) ? nodeVoltage(fromN || n) / Math.sqrt(3) : nodeVoltage(fromN || n);
      const Zup = Uph / upIk;
      const Z = Zup + rSeg;
      return Z > 0 ? Uph / Z : Infinity;
    }
    return 0;
  }
  for (const n of state.nodes.values()) {
    if (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups') {
      n._ikA = nodeIk(n.id);
    }
  }
  for (const c of state.conns.values()) {
    if (c._state === 'active') {
      c._ikA = nodeIk(c.to.nodeId);
    }
  }

  // === ΔU — падение напряжения ===
  // Для каждой активной связи: ΔU_seg = √3 × I × (R×cosφ + X×sinφ) × L / U × 100% (3ф)
  // X кабеля ≈ 0.08 мОм/м (типичное для стандартных кабелей)
  const X_PER_M = 0.00008; // Ом/м
  for (const c of state.conns.values()) {
    c._deltaUSegPct = 0;
    if (c._state !== 'active' || !c._cableSize || !(c._loadA > 0)) continue;
    const I = c._loadA;
    const L = Number(c._cableLength || c.lengthM || 1);
    const S = Number(c._cableSize) || 1;
    const par = Math.max(1, c._cableParallel || 1);
    const rho = RHO[c._cableMaterial || 'Cu'] || RHO.Cu;
    const R = (rho * L) / (S * par); // Ом
    const X = (X_PER_M * L) / par;
    const cos = Number(c._cosPhi) || GLOBAL.defaultCosPhi;
    const sin = Math.sqrt(1 - cos * cos);
    const U = Number(c._voltage) || GLOBAL.voltage3ph;
    const k = c._threePhase ? Math.sqrt(3) : 2;
    c._deltaUSegPct = (k * I * (R * cos + X * sin)) / U * 100;
  }
  // Суммарный ΔU на каждом узле — идём от источника вниз по активным связям
  function nodeDeltaU(nid, visited) {
    visited = visited || new Set();
    if (visited.has(nid)) return 0;
    visited.add(nid);
    const n = state.nodes.get(nid);
    if (!n) return 0;
    if (n.type === 'source' || n.type === 'generator') return 0;
    // Ищем активный фидер (вход), через который питаемся
    for (const c of state.conns.values()) {
      if (c.to.nodeId !== nid || c._state !== 'active') continue;
      return nodeDeltaU(c.from.nodeId, visited) + (c._deltaUSegPct || 0);
    }
    return 0;
  }
  for (const n of state.nodes.values()) {
    n._deltaUPct = nodeDeltaU(n.id);
  }
}

// ================= Рендер =================
function updateViewBox() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const vw = W / state.view.zoom;
  const vh = H / state.view.zoom;
  svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${vw} ${vh}`);
  const bg = document.getElementById('bg');
  bg.setAttribute('x', state.view.x);
  bg.setAttribute('y', state.view.y);
  bg.setAttribute('width', vw);
  bg.setAttribute('height', vh);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) e.appendChild(c);
  return e;
}
function text(x, y, str, cls) {
  const t = el('text', { x, y, class: cls });
  t.textContent = str;
  return t;
}
function bezier(a, b) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
}

// Путь сплайна с промежуточными точками. Использует Catmull-Rom → Bezier, чтобы
// линия проходила через все waypoints гладко.
function splinePath(a, points, b) {
  if (!points || points.length === 0) return bezier(a, b);
  const pts = [a, ...points, b];
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // Catmull-Rom → cubic Bezier
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

// Средняя точка пути по длине дуги ломаной [a, ...points, b].
// Это хорошая аппроксимация середины сплайна, и она следует за waypoints.
function pathMidpoint(a, points, b) {
  const pts = [a, ...(points || []), b];
  // Общая длина
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    segs.push(len);
    total += len;
  }
  if (total === 0) return { x: a.x, y: a.y };
  const half = total / 2;
  // Идём по сегментам, пока не накопится половина длины
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= half) {
      const t = segs[i] > 0 ? (half - acc) / segs[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segs[i];
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}
function fmt(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toString();
}

function render() {
  recalc();
  renderConns();
  renderNodes();
  renderStats();
  renderModes();
}

function renderNodes() {
  while (layerNodes.firstChild) layerNodes.removeChild(layerNodes.firstChild);

  // Сначала рисуем зоны (они позади обычных узлов).
  // Тело зоны — pointer-events: none, чтобы связи и порты внутри неё оставались
  // кликабельными. Для перетаскивания зоны используется узкая полоса-хэндл сверху.
  for (const n of state.nodes.values()) {
    if (n.type !== 'zone') continue;
    const w = nodeWidth(n), h = nodeHeight(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const g = el('g', {
      class: 'node zone' + (selected ? ' selected' : ''),
      transform: `translate(${n.x},${n.y})`,
    });
    g.dataset.nodeId = n.id;
    // Тело зоны — видимый, но не интерактивный фон
    g.appendChild(el('rect', {
      class: 'zone-body',
      x: 0, y: 0, width: w, height: h,
      fill: n.color || '#e3f2fd',
      'fill-opacity': 0.25,
    }));
    // Drag-handle — полоса 44px сверху, единственная кликабельная часть для перетаскивания
    g.appendChild(el('rect', {
      class: 'zone-drag-handle',
      x: 0, y: 0, width: w, height: 44,
    }));
    // Подпись: префикс зоны крупнее, имя ниже
    g.appendChild(text(12, 22, n.zonePrefix || n.tag || '', 'zone-prefix'));
    g.appendChild(text(12, 40, n.name || '', 'zone-name'));
    // Уголок для ресайза
    g.appendChild(el('rect', {
      class: 'zone-resize', x: w - 14, y: h - 14, width: 12, height: 12,
    }));
    layerNodes.appendChild(g);
  }

  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    const w = nodeWidth(n);
    const selected = state.selectedKind === 'node' && state.selectedId === n.id;
    const cls = [
      'node', n.type,
      selected ? 'selected' : '',
      state.selection.has(n.id) ? 'multi-selected' : '',
      n._overload ? 'overload' : '',
      (!n._powered && (n.type === 'panel' || n.type === 'consumer' || n.type === 'ups')) ? 'unpowered' : '',
      (n.type === 'ups' && n._onBattery) ? 'onbattery' : '',
      (n.type === 'ups' && n._onStaticBypass) ? 'onbypass' : '',
      (n.type === 'panel' && n.switchMode === 'manual') ? 'manual' : '',
      (n.type === 'panel' && n._marginWarn === 'undersize') ? 'undersize' : '',
      (n.type === 'panel' && n._marginWarn === 'oversize') ? 'oversize' : '',
    ].filter(Boolean).join(' ');

    const g = el('g', { class: cls, transform: `translate(${n.x},${n.y})` });
    g.dataset.nodeId = n.id;

    g.appendChild(el('rect', { class: 'node-body', x: 0, y: 0, width: w, height: NODE_H }));

    // Обозначение — с учётом префикса зоны («P1.MPB1»)
    const displayTag = effectiveTag(n);
    if (displayTag) g.appendChild(text(12, 16, displayTag, 'node-tag'));

    // Имя
    g.appendChild(text(12, 33, n.name || '(без имени)', 'node-title'));

    // IEC условное обозначение для источников (маленький SVG-символ)
    if (n.type === 'source' || n.type === 'generator') {
      const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
      const ix = w - 32, iy = 14;
      if (subtype === 'transformer') {
        // IEC 60617: два пересекающихся кольца (обмотки)
        g.appendChild(el('circle', { cx: ix, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
        g.appendChild(el('circle', { cx: ix + 10, cy: iy, r: 9, fill: 'none', stroke: '#4caf50', 'stroke-width': 1.5, class: 'node-icon' }));
      } else {
        // IEC 60617: кольцо с буквой G
        g.appendChild(el('circle', { cx: ix + 5, cy: iy, r: 11, fill: 'none', stroke: '#ff9800', 'stroke-width': 1.5, class: 'node-icon' }));
        const gt = text(ix + 5, iy + 4, 'G', 'node-icon-letter');
        g.appendChild(gt);
      }
    }

    // Подпись типа
    const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    const subTxt = {
      source:    subtype === 'generator' ? 'Генератор' + (n.backupMode ? ' (резерв)' : '') : 'Трансформатор',
      generator: 'Генератор' + (n.backupMode ? ' (резерв)' : ''),
      panel:     `In ${fmt(n.capacityA || 0)} A / ${fmt(n._maxLoadA || 0)} A · ${fmt(n._maxLoadKw || 0)} kW`,
      ups:       `ИБП · КПД ${Math.round(Number(n.efficiency) || 100)}%` +
                   (n._onStaticBypass ? ' · БАЙПАС' : ''),
      consumer:  ((n.count || 1) > 1
                    ? `Группа · ${n.count} × ${fmt(n.demandKw)} kW`
                    : 'Потребитель') + (n.inputs > 1 ? ` · вх ${n.inputs}` : ''),
      channel:   (CHANNEL_TYPES[n.channelType] || CHANNEL_TYPES.conduit).label,
    }[n.type];
    g.appendChild(text(12, 49, subTxt, 'node-sub'));

    // Нагрузка
    let loadLine = '', loadCls = 'node-load';
    if (n.type === 'source') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'generator') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else if (n.triggerNodeId && n._startCountdown > 0) {
        loadLine = `ПУСК через ${Math.ceil(n._startCountdown)} с`;
        loadCls += ' off';
      } else if (n.triggerNodeId && n._stopCountdown > 0) {
        // Остывание — генератор ещё держит нагрузку, но таймер идёт
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW · стоп ${Math.ceil(n._stopCountdown)} с`;
      } else if (n.triggerNodeId && !n._running) {
        loadLine = 'Дежурство';
        loadCls += ' off';
      } else {
        loadLine = `${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'panel') {
      if (!n._powered) {
        loadLine = 'Без питания';
        loadCls += ' off';
      } else {
        loadLine = `${fmt(n._loadA || 0)} A / ${fmt(n._loadKw || 0)} kW`;
        if (n._marginWarn === 'low') loadCls += ' overload';
      }
    } else if (n.type === 'ups') {
      if (!effectiveOn(n)) { loadLine = 'Отключён'; loadCls += ' off'; }
      else if (!n._powered) { loadLine = 'Без питания'; loadCls += ' off'; }
      else {
        let suffix = '';
        if (n._onStaticBypass) suffix = ' · БАЙПАС';
        else if (n._onBattery) {
          const sec = Math.max(0, Math.round(n._runtimeLeftSec || 0));
          const mm = Math.floor(sec / 60);
          const ss = sec % 60;
          suffix = ` · БАТ ${mm}:${String(ss).padStart(2, '0')}`;
        }
        // Показываем ток / макс.ток и мощность
        const capA = computeCurrentA(n.capacityKw, nodeVoltage(n), 1.0, isThreePhase(n));
        loadLine = `${fmt(n._loadA || 0)} / ${fmt(capA)} A · ${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW${suffix}`;
        if (n._overload) loadCls += ' overload';
      }
    } else if (n.type === 'consumer') {
      loadLine = n._powered ? `${fmt(n.demandKw)} kW` : `${fmt(n.demandKw)} kW · нет`;
      if (!n._powered) loadCls += ' off';
    } else if (n.type === 'channel') {
      loadLine = `${n.ambientC || 30}°C · ${n.lengthM || 0} м`;
      // IEC 60364-5-52: иконка способа прокладки (справа) + расположения кабелей (левее)
      drawChannelIcon(g, w, n.channelType || 'conduit');
      drawBundlingIcon(g, w - 82, n.bundling || 'touching');
    }
    g.appendChild(text(12, NODE_H - 12, loadLine, loadCls));

    // Порты — входы
    const inCount = nodeInputCount(n);
    // Состояние каждого входного порта: 'active' | 'powered' | undefined
    const portStates = new Map();
    if (inCount > 1) {
      for (const c of state.conns.values()) {
        if (c.to.nodeId !== n.id) continue;
        if (c._state === 'active' || c._state === 'powered') {
          portStates.set(c.to.port, c._state);
        }
      }
    }
    for (let i = 0; i < inCount; i++) {
      const cx = w / (inCount + 1) * (i + 1);
      const circ = el('circle', { class: 'port in', cx, cy: 0, r: PORT_R });
      circ.dataset.portKind = 'in'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
      // Метка приоритета
      if (n.type === 'panel' || (n.type === 'consumer' && inCount > 1)) {
        const prio = (n.priorities && n.priorities[i]) ?? (i + 1);
        g.appendChild(text(cx, -10, `P${prio}`, 'port-label'));
      }
      // Лампочки (только при inputs > 1):
      //   зелёная — на красную линию («работает, несёт нагрузку»)
      //   красная — на зелёную линию («есть напряжение, но не выбрано»)
      //   нет лампочки — на серую пунктирную
      if (inCount > 1) {
        const ps = portStates.get(i);
        if (ps === 'active') {
          g.appendChild(el('circle', { class: 'port-lamp green', cx: cx + 11, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core green', cx: cx + 11, cy: 0, r: 2 }));
        } else if (ps === 'powered') {
          g.appendChild(el('circle', { class: 'port-lamp red', cx: cx + 11, cy: 0, r: 4.5 }));
          g.appendChild(el('circle', { class: 'port-lamp-core red', cx: cx + 11, cy: 0, r: 2 }));
        }
      }
    }
    // Порты — выходы
    const outCount = nodeOutputCount(n);
    for (let i = 0; i < outCount; i++) {
      const cx = w / (outCount + 1) * (i + 1);
      const circ = el('circle', { class: 'port out', cx, cy: NODE_H, r: PORT_R });
      circ.dataset.portKind = 'out'; circ.dataset.portIdx = i; circ.dataset.nodeId = n.id;
      g.appendChild(circ);
    }

    // Жёлтый треугольник с «!» — предупреждение о номинале шкафа
    if (n.type === 'panel' && n._marginWarn) {
      const tx = w - 22, ty = 8;
      const tri = el('path', {
        class: 'margin-warn-tri',
        d: `M${tx + 8},${ty} L${tx + 16},${ty + 14} L${tx},${ty + 14} Z`,
      });
      g.appendChild(tri);
      const bang = text(tx + 8, ty + 13, '!', 'margin-warn-bang');
      g.appendChild(bang);
      const title = el('title', {});
      const mp = n._marginPct == null ? '-' : n._marginPct.toFixed(1);
      title.textContent = n._marginWarn === 'undersize'
        ? `Перегруз: номинал ${fmt(n.capacityA)} А < макс.ток ${fmt(n._maxLoadA || 0)} А (${mp}%)`
        : `Избыточный запас: номинал ${fmt(n.capacityA)} А, макс.ток ${fmt(n._maxLoadA || 0)} А (запас ${mp}%, макс. ${n.marginMaxPct}%)`;
      tri.appendChild(title);
    }

    layerNodes.appendChild(g);
  }
}

function renderConns() {
  while (layerConns.firstChild) layerConns.removeChild(layerConns.firstChild);

  // Control-линии: от каждого триггера к генератору
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator') continue;
    const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : []);
    if (!triggers.length) continue;
    const genW = nodeWidth(n);
    for (const tid of triggers) {
      const trigger = state.nodes.get(tid);
      if (!trigger) continue;
      const trigW = nodeWidth(trigger);
      const a = { x: trigger.x + trigW / 2, y: trigger.y + NODE_H / 2 };
      const b = { x: n.x + genW / 2, y: n.y + NODE_H / 2 };
      const triggerAlive = !!trigger._powered;
      const genRunning = !!n._running;
      const cls = (!triggerAlive && genRunning) ? 'control-line started' : 'control-line';
      layerConns.appendChild(el('line', { class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const label = !triggerAlive ? (genRunning ? 'ПУСК' : 'СИГНАЛ') : 'дежурство';
      layerConns.appendChild(text(mid.x, mid.y - 4, label, 'control-label' + (!triggerAlive ? ' started' : '')));
    }
  }

  for (const c of state.conns.values()) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    if (!fromN || !toN) continue;
    const a = portPos(fromN, 'out', c.from.port);
    const b = portPos(toN,   'in',  c.to.port);
    const waypoints = Array.isArray(c.waypoints) ? c.waypoints : [];
    const d = splinePath(a, waypoints, b);

    const selected = state.selectedKind === 'conn' && state.selectedId === c.id;

    // Невидимая «толстая» дорожка — упрощает попадание кликом
    const hit = el('path', { class: 'conn-hit', d });
    hit.dataset.connId = c.id;
    layerConns.appendChild(hit);

    // Видимая линия — повреждённые и отключённые перекрывают электрическое состояние
    let stateClass;
    if (c.lineMode === 'damaged') stateClass = ' damaged';
    else if (c.lineMode === 'disabled') stateClass = ' disabled';
    else stateClass = c._state === 'active' ? ' active'
                    : c._state === 'powered' ? ' powered'
                    : ' dead';
    const path = el('path', {
      class: 'conn' + stateClass + (selected ? ' selected' : ''),
      d,
    });
    path.dataset.connId = c.id;
    layerConns.appendChild(path);

    // Подпись на активных линиях.
    // Формат: «Imax A / жилы×[N×]сечение мм² [(кол-во шт.)]»
    //   Imax — ток в максимальном режиме (одна параллельная ветвь)
    //   жилы — 5 для 3ф (L1+L2+L3+N+PE), 3 для 1ф (L+N+PE)
    //   N× — количество спаренных кабелей (только если > 1)
    //   (кол-во шт.) — только для групповых потребителей (count > 1)
    if (c._state === 'active' && c._loadKw > 0) {
      const mid = pathMidpoint(a, waypoints, b);
      const parallel = Math.max(1, c._cableParallel || 1);
      const cores = c._wireCount || (c._threePhase ? 5 : 3);

      // Ток макс. режима на ОДНУ параллельную ветвь
      const maxPerBranch = (c._maxA || 0) / parallel;

      // Обозначение кабеля:
      //   Обычная линия:                   «5×25 мм²»
      //   Спаренные кабели (auto-parallel): «2×(5×240 мм²)» — расчёт увеличил параллель
      //   Группа потребителей:             «5×25 мм² (4 шт.)» — БЕЗ множителя перед скобками
      //   Группа + спаренные:              «2×(5×240 мм²) (4 шт.)»
      //
      // Ключевое: множитель N×(...) показывается ТОЛЬКО при auto-parallel
      // (когда одиночный кабель не проходит по току и расчёт увеличил параллель).
      // Групповые линии (count > 1) показывают только «(N шт.)» в конце.
      const isAutoParallel = !!c._cableAutoParallel;
      let cableSpec = '';
      if (c._cableSize) {
        const inner = `${cores}×${c._cableSize} мм²`;
        cableSpec = (isAutoParallel && parallel > 1) ? `${parallel}×(${inner})` : inner;
      }

      const groupCount = (toN.type === 'consumer' && (toN.count || 1) > 1)
        ? Number(toN.count) : 0;

      // Формат: «полный_ток A · N×ток_на_линию A / кабель (шт.)»
      // Одиночная:  «173.7 A / 5×240 мм²»
      // Спаренная:  «1389.6 A · 8×173.7 A / 8×(5×240 мм²)»
      // Группа:     «173.7 A / 5×240 мм² (8 шт.)»
      let labelText;
      if (isAutoParallel && parallel > 1) {
        const totalA = maxPerBranch * parallel;
        labelText = `${fmt(totalA)} A · ${parallel}×${fmt(maxPerBranch)} A / ${cableSpec}`;
      } else {
        labelText = `${fmt(maxPerBranch)} A / ${cableSpec}`;
      }
      if (groupCount > 1) labelText += ` (${groupCount} шт.)`;

      const lbl = text(mid.x, mid.y - 4, labelText,
        'conn-label' + (c._cableOverflow ? ' overload' : ''));
      layerConns.appendChild(lbl);
    }

    // Подпись макс. режима на неактивных связях
    if (c._state !== 'active' && c._maxA > 0 && c._cableSize) {
      const mid = pathMidpoint(a, waypoints, b);
      const parallel = Math.max(1, c._cableParallel || 1);
      const maxPerBranch = c._maxA / parallel;
      const cores = c._threePhase ? 5 : 3;
      const inner = `${cores}×${c._cableSize} мм²`;
      const isAutoP = !!c._cableAutoParallel;
      const spec = (isAutoP && parallel > 1) ? `${parallel}×(${inner})` : inner;
      const labelText = `[${fmt(maxPerBranch)} A / ${spec}]`;
      const lbl = text(mid.x, mid.y - 4, labelText, 'conn-label-sub');
      layerConns.appendChild(lbl);
    }

    // Рукоятки на обоих концах выделенной связи + точки сплайна
    if (selected) {
      const h1 = el('circle', { class: 'conn-handle', cx: b.x, cy: b.y, r: 7 });
      h1.dataset.reconnectId = c.id;
      h1.dataset.reconnectEnd = 'to';
      layerConns.appendChild(h1);
      const h2 = el('circle', { class: 'conn-handle', cx: a.x, cy: a.y, r: 7 });
      h2.dataset.reconnectId = c.id;
      h2.dataset.reconnectEnd = 'from';
      layerConns.appendChild(h2);

      // Существующие waypoints
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const dot = el('circle', { class: 'conn-waypoint', cx: wp.x, cy: wp.y, r: 5 });
        dot.dataset.waypointId = c.id;
        dot.dataset.waypointIdx = i;
        layerConns.appendChild(dot);
      }
      // «Плюсы» для добавления новых waypoints в середине каждого сегмента
      const chain = [a, ...waypoints, b];
      for (let i = 0; i < chain.length - 1; i++) {
        const mid = { x: (chain[i].x + chain[i + 1].x) / 2, y: (chain[i].y + chain[i + 1].y) / 2 };
        const plus = el('circle', { class: 'conn-waypoint-add', cx: mid.x, cy: mid.y, r: 4 });
        plus.dataset.waypointAddId = c.id;
        plus.dataset.waypointAddIdx = i; // вставка перед позицией i в waypoints
        layerConns.appendChild(plus);
      }
    }

    // Бейдж автомата — ближе к from-концу, следует за траекторией
    const hasBreaker = c._breakerIn || c._breakerPerLine;
    if (hasBreaker && c._state === 'active') {
      const pts = [a, ...waypoints, b];
      let total = 0;
      const segs = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        segs.push(len); total += len;
      }
      const target = total * 0.15;
      let labelPos = { x: a.x, y: a.y };
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        if (acc + segs[i] >= target) {
          const t = segs[i] > 0 ? (target - acc) / segs[i] : 0;
          labelPos = {
            x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
            y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
          };
          break;
        }
        acc += segs[i];
      }

      const cls = 'breaker-badge' + (c._breakerAgainstCable ? ' overload' : '');

      if (c._cableAutoParallel && c._breakerIn && c._breakerPerLine && c._breakerCount > 1) {
        // Спаренные: общий автомат сверху, per-line в скобках снизу
        layerConns.appendChild(text(labelPos.x, labelPos.y + 10, `C${c._breakerIn}А`, cls));
        layerConns.appendChild(text(labelPos.x, labelPos.y + 22, `(${c._breakerCount}×C${c._breakerPerLine}А)`, cls));
      } else if (c._breakerPerLine && c._breakerCount > 1) {
        // Группа: N×CxxA
        layerConns.appendChild(text(labelPos.x, labelPos.y + 14, `${c._breakerCount}×C${c._breakerPerLine}А`, cls));
      } else if (c._breakerIn) {
        // Одиночная: CxxA
        layerConns.appendChild(text(labelPos.x, labelPos.y + 14, `C${c._breakerIn}А`, cls));
      }
    }
  }
}

function renderStats() {
  let totalDemand = 0, totalCap = 0, totalDraw = 0;
  let unpoweredCount = 0, overloadCount = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      totalDemand += Number(n.demandKw) || 0;
      if (!n._powered) unpoweredCount++;
    }
    if (n.type === 'source' || n.type === 'generator') {
      if (effectiveOn(n)) totalCap += Number(n.capacityKw) || 0;
      totalDraw += n._loadKw || 0;
      if (n._overload) overloadCount++;
    }
  }
  const rows = [];
  rows.push(`<div class="row"><span>Запрос</span><span>${fmt(totalDemand)} kW</span></div>`);
  rows.push(`<div class="row"><span>Источников</span><span>${fmt(totalCap)} kW</span></div>`);
  rows.push(`<div class="row"><span>Потребляется</span><span>${fmt(totalDraw)} kW</span></div>`);
  if (unpoweredCount) rows.push(`<div class="row warn"><span>Без питания</span><span>${unpoweredCount}</span></div>`);
  if (overloadCount)  rows.push(`<div class="row warn"><span>Перегруз</span><span>${overloadCount}</span></div>`);
  if (!unpoweredCount && !overloadCount && state.nodes.size) {
    rows.push(`<div class="row ok"><span>Статус</span><span>OK</span></div>`);
  }
  statsEl.innerHTML = rows.join('');
}

function renderModes() {
  const rows = [];
  const list = [{ id: null, name: 'Нормальный' }, ...state.modes];
  for (const m of list) {
    const active = m.id === state.activeModeId;
    const canDel = m.id !== null;
    rows.push(
      `<div class="mode-row${active ? ' active' : ''}" data-mid="${m.id ?? ''}">
        <input type="radio" name="mode"${active ? ' checked' : ''}>
        <input type="text" class="mode-name" value="${escAttr(m.name)}"${canDel ? '' : ' disabled'}>
        <button class="mode-del" ${canDel ? '' : 'disabled'}>×</button>
      </div>`
    );
  }
  modesListEl.innerHTML = rows.join('');

  modesListEl.querySelectorAll('.mode-row').forEach(row => {
    const mid = row.dataset.mid || null;
    row.querySelector('input[type=radio]').addEventListener('change', () => selectMode(mid));
    row.addEventListener('click', e => {
      if (e.target.closest('.mode-del') || e.target.classList.contains('mode-name')) return;
      selectMode(mid);
    });
    const nameInput = row.querySelector('.mode-name');
    if (!nameInput.disabled) {
      nameInput.addEventListener('input', () => {
        snapshot('mode-name:' + mid);
        const m = state.modes.find(x => x.id === mid);
        if (m) m.name = nameInput.value;
        notifyChange();
      });
    }
    const del = row.querySelector('.mode-del');
    if (!del.disabled) del.addEventListener('click', e => { e.stopPropagation(); deleteMode(mid); });
  });
}

// ================= Инспектор =================
function selectNode(id) {
  state.selectedKind = 'node'; state.selectedId = id;
  renderInspector();
}
function selectConn(id) {
  state.selectedKind = 'conn'; state.selectedId = id;
  renderInspector();
}

function renderInspector() {
  if (!state.selectedKind) {
    inspectorBody.innerHTML = '<div class="muted">Выберите элемент или связь, либо перетащите новый элемент из палитры.</div>';
    return;
  }
  if (state.selectedKind === 'node') {
    const n = state.nodes.get(state.selectedId);
    if (!n) { inspectorBody.innerHTML = ''; return; }
    renderInspectorNode(n);
  } else {
    const c = state.conns.get(state.selectedId);
    if (!c) { inspectorBody.innerHTML = ''; return; }
    renderInspectorConn(c);
  }
}

function renderInspectorNode(n) {
  const h = [];
  // Для зоны — обозначение называется «Префикс зоны» и редактируется в zonePrefix
  if (n.type === 'zone') {
    h.push(field('Префикс зоны', `<input type="text" data-prop="zonePrefix" value="${escAttr(n.zonePrefix || '')}" placeholder="P1">`));
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));
    h.push(field('Ширина, px', `<input type="number" min="200" max="4000" step="40" data-prop="width" value="${n.width || 600}">`));
    h.push(field('Высота, px', `<input type="number" min="120" max="4000" step="40" data-prop="height" value="${n.height || 400}">`));
    h.push(field('Цвет фона', `<input type="text" data-prop="color" value="${escAttr(n.color || '#e3f2fd')}">`));
    // Показать какие узлы принадлежат зоне
    const children = nodesInZone(n);
    if (children.length) {
      h.push('<div class="inspector-section"><h4>Элементы в зоне</h4>');
      h.push('<div style="font-size:11px;line-height:1.8">');
      for (const ch of children) {
        h.push(`<div>${escHtml(effectiveTag(ch))} — ${escHtml(ch.name || '')}</div>`);
      }
      h.push('</div></div>');
    }
    h.push('<button class="btn-delete" id="btn-del-node">Удалить зону</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    return;
  }
  // Channel — только тип и условия среды; материал/изоляция задаются в линиях
  if (n.type === 'channel') {
    h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
    h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

    const ct = n.channelType || 'conduit';
    const ctOpts = Object.keys(CHANNEL_TYPES).map(key => {
      const sel = ct === key ? ' selected' : '';
      return `<option value="${key}"${sel}>${escHtml(CHANNEL_TYPES[key].label)}</option>`;
    }).join('');
    h.push(field('Тип канала', `<select data-prop="channelType">${ctOpts}</select>`));

    const bd = n.bundling || CHANNEL_TYPES[ct]?.bundlingDefault || 'touching';
    h.push(field('Расположение кабелей',
      `<select data-prop="bundling">
        <option value="spaced"${bd === 'spaced' ? ' selected' : ''}>С зазором ≥ Ø кабеля</option>
        <option value="touching"${bd === 'touching' ? ' selected' : ''}>Плотно друг к другу</option>
        <option value="bundled"${bd === 'bundled' ? ' selected' : ''}>В пучке / жгуте</option>
      </select>`));
    // SVG-иконка расположения кабелей
    h.push('<div style="text-align:center;margin:6px 0 10px"><svg width="120" height="36" viewBox="0 0 120 36">');
    if (bd === 'spaced') {
      // С зазором: кабели на расстоянии ≥ Ø друг от друга
      h.push('<circle cx="20" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="60" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="100" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Стрелка зазора
      h.push('<line x1="28" y1="8" x2="52" y2="8" stroke="#1976d2" stroke-width="0.8" marker-start="url(#arr)" marker-end="url(#arr)"/>');
      h.push('<text x="40" y="6" text-anchor="middle" fill="#1976d2" font-size="7">≥Ø</text>');
    } else if (bd === 'touching') {
      // Плотно: кабели касаются друг друга
      h.push('<circle cx="42" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="58" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="74" cy="18" r="8" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Жилы
      h.push('<circle cx="42" cy="18" r="2.5" fill="#555"/>');
      h.push('<circle cx="58" cy="18" r="2.5" fill="#555"/>');
      h.push('<circle cx="74" cy="18" r="2.5" fill="#555"/>');
    } else {
      // В пучке: кабели связаны вместе
      h.push('<ellipse cx="60" cy="18" rx="22" ry="14" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="3 2"/>');
      h.push('<circle cx="50" cy="14" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="66" cy="14" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      h.push('<circle cx="58" cy="24" r="6" fill="none" stroke="#555" stroke-width="1.2"/>');
      // Жилы
      h.push('<circle cx="50" cy="14" r="2" fill="#555"/>');
      h.push('<circle cx="66" cy="14" r="2" fill="#555"/>');
      h.push('<circle cx="58" cy="24" r="2" fill="#555"/>');
    }
    h.push('</svg></div>');
    h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">«С зазором» — группировка не учитывается. «Плотно» — базовый K_group. «В пучке» — дополнительное понижение ×0.85.</div>');

    h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-prop="ambientC" value="${n.ambientC || 30}">`));
    h.push(field('Длина канала, м', `<input type="number" min="0" max="10000" step="1" data-prop="lengthM" value="${n.lengthM || 0}">`));

    // Статистика использования канала — считаем и линии, и суммарные цепи
    let lines = 0, circuits = 0;
    for (const c of state.conns.values()) {
      if (!Array.isArray(c.channelIds) || !c.channelIds.includes(n.id)) continue;
      lines++;
      const toN = state.nodes.get(c.to.nodeId);
      const par = (toN && toN.type === 'consumer' && (Number(toN.count) || 1) > 1)
        ? Number(toN.count)
        : 1;
      circuits += par;
    }
    const typeInfo = CHANNEL_TYPES[ct] || CHANNEL_TYPES.conduit;
    h.push(`<div class="inspector-section">` +
      `<div style="display:flex;gap:12px;justify-content:center;margin:8px 0">${channelIconSVG(ct, 56)}${bundlingIconSVG(bd, 56)}</div>` +
      `<div class="muted" style="font-size:11px;line-height:1.8">` +
      `Метод прокладки по IEC: <b>${typeInfo.method}</b><br>` +
      `Линий в канале: <b>${lines}</b><br>` +
      `Параллельных цепей (для K_group): <b>${circuits}</b><br>` +
      `</div></div>`);

    h.push('<button class="btn-delete" id="btn-del-node">Удалить канал</button>');
    inspectorBody.innerHTML = h.join('');
    wireInspectorInputs(n);
    return;
  }

  h.push(field('Обозначение', `<input type="text" data-prop="tag" value="${escAttr(n.tag || '')}">`));
  // Показать эффективное обозначение если отличается
  const eff = effectiveTag(n);
  if (eff && eff !== n.tag) {
    h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:8px">Полное обозначение: <b>${escHtml(eff)}</b></div>`);
  }
  h.push(field('Имя', `<input type="text" data-prop="name" value="${escAttr(n.name)}">`));

  if (n.type === 'source' || n.type === 'generator') {
    const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
    h.push(field('Тип источника',
      `<select data-prop="sourceSubtype">
        <option value="transformer"${subtype === 'transformer' ? ' selected' : ''}>Трансформатор</option>
        <option value="generator"${subtype === 'generator' ? ' selected' : ''}>Генератор (ДГУ / ДЭС)</option>
      </select>`));
    h.push(voltageField(n));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.92}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));

    // Поля только для генератора
    if (subtype === 'generator') {
      h.push(checkField('Резервный (АВР)', 'backupMode', n.backupMode));
      const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
        ? n.triggerNodeIds : (n.triggerNodeId ? [n.triggerNodeId] : []);
      const triggerCount = triggers.length;
      h.push('<div class="inspector-section">');
      h.push(`<button class="full-btn" id="btn-open-automation">⚡ Автоматизация${triggerCount ? ` (${triggerCount} триггер${triggerCount > 1 ? 'ов' : ''})` : ''}</button>`);
      h.push(field('Задержка запуска, сек', `<input type="number" min="0" max="600" step="1" data-prop="startDelaySec" value="${n.startDelaySec || 0}">`));
      h.push(field('Задержка остановки, сек', `<input type="number" min="0" max="600" step="1" data-prop="stopDelaySec" value="${n.stopDelaySec ?? 2}">`));
      h.push('</div>');
    }

    // Все номинальные параметры (мощность, напряжение, Ssc, Uk%, Xs/Rs) — в модалке
    h.push(`<button class="full-btn" id="btn-open-impedance" style="margin-top:6px">🔌 Параметры источника (IEC 60909)</button>`);
    // Справка: текущие значения из модалки
    h.push(`<div class="muted" style="font-size:11px;margin-top:4px;line-height:1.6">` +
      `Snom: <b>${fmt(n.snomKva || 0)} kVA</b> (${fmt(n.capacityKw || 0)} kW)<br>` +
      `U: <b>${nodeVoltage(n)} В</b> (${(n.phase || '3ph') === '3ph' ? '3ф' : '1ф'})` +
      `</div>`);
    h.push(sourceStatusBlock(n));
  } else if (n.type === 'panel') {
    h.push(field('Входов', `<input type="number" min="1" max="30" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="30" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(field('Ксим (коэффициент одновременности)', `<input type="number" min="0" max="1.2" step="0.05" data-prop="kSim" value="${n.kSim ?? 1}">`));

    // Номинал шкафа — в амперах. Рядом показываем эквивалент в kW для справки.
    h.push('<div class="inspector-section"><h4>Номинал шкафа</h4>');
    h.push(field('Номинальный ток вводного автомата, А', `<input type="number" min="0" step="1" data-prop="capacityA" value="${n.capacityA ?? 160}">`));
    // Подсказка с эквивалентной мощностью
    if (n._capacityKwFromA) {
      h.push(`<div class="muted" style="font-size:11px;margin-top:-8px;margin-bottom:10px">Эквивалентная мощность при ${nodeVoltage(n)} В, cos φ ${(n._cosPhi || GLOBAL.defaultCosPhi).toFixed(2)}: <b>${fmt(n._capacityKwFromA)} kW</b></div>`);
    }
    h.push(field('Мин. запас над нагрузкой, %', `<input type="number" min="0" max="50" step="1" data-prop="marginMinPct" value="${n.marginMinPct ?? 2}">`));
    h.push(field('Макс. запас над нагрузкой, %', `<input type="number" min="5" max="500" step="1" data-prop="marginMaxPct" value="${n.marginMaxPct ?? 30}">`));
    h.push('<div class="muted" style="font-size:11px;margin-top:-4px">Шкаф считается правильно подобранным, если его номинальный ток превышает расчётный на значение в этих пределах. Вне диапазона — предупреждение.</div>');
    h.push('</div>');

    // Режим переключения и приоритеты имеют смысл только при 2+ входах
    if (n.inputs > 1) {
      const sm = n.switchMode || 'auto';
      h.push(field('Режим переключения',
        `<select data-prop="switchMode">
          <option value="auto"${sm === 'auto' ? ' selected' : ''}>Автоматический (АВР)</option>
          <option value="manual"${sm === 'manual' ? ' selected' : ''}>Ручной — один вход</option>
          <option value="parallel"${sm === 'parallel' ? ' selected' : ''}>Параллельный — несколько вводов</option>
          <option value="avr_paired"${sm === 'avr_paired' ? ' selected' : ''}>АВР с привязкой выходов к входам</option>
          <option value="switchover"${sm === 'switchover' ? ' selected' : ''}>Подменный (switchover) — по условию</option>
          <option value="watchdog"${sm === 'watchdog' ? ' selected' : ''}>Watchdog — вход N → выход N по сигналу</option>
        </select>`));
      if (sm === 'manual') {
        const opts = [];
        for (let i = 0; i < n.inputs; i++) {
          opts.push(`<option value="${i}"${(n.manualActiveInput | 0) === i ? ' selected' : ''}>Вход ${i + 1}</option>`);
        }
        h.push(field('Активный вход',
          `<select data-prop="manualActiveInput">${opts.join('')}</select>`));
        h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Работает только явно выбранный вход. Если на нём нет напряжения — щит обесточен.</div>');
      } else if (sm === 'avr_paired') {
        h.push('<div class="inspector-section"><h4>АВР с привязкой</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Каждый выход привязан к группе входов. Выход работает от того входа из своей группы, у которого есть питание (АВР внутри группы).</div>');
        const map = Array.isArray(n.outputInputMap) ? n.outputInputMap : [];
        for (let oi = 0; oi < n.outputs; oi++) {
          const assigned = map[oi] || [];
          h.push(`<div class="field"><label>Выход ${oi + 1} ← входы:</label><div>`);
          for (let ii = 0; ii < n.inputs; ii++) {
            const checked = assigned.includes(ii);
            h.push(`<span style="margin-right:8px"><input type="checkbox" data-oim-out="${oi}" data-oim-in="${ii}"${checked ? ' checked' : ''}> Вх${ii + 1}</span>`);
          }
          h.push('</div></div>');
        }
        h.push('</div>');
      } else if (sm === 'switchover') {
        h.push('<div class="inspector-section"><h4>Подменный (switchover)</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Каждый выход включается только когда указанный узел обесточен. Типичное применение: подменный ДГУ, который заменяет ДГУ1 или ДГУ2.</div>');
        const whenDead = Array.isArray(n.outputActivateWhenDead) ? n.outputActivateWhenDead : [];
        const candidates = [...state.nodes.values()].filter(o => o.id !== n.id && (o.type === 'source' || o.type === 'generator' || o.type === 'ups'));
        for (let oi = 0; oi < n.outputs; oi++) {
          const curId = whenDead[oi] || '';
          let opts = '<option value="">— всегда активен —</option>';
          for (const cand of candidates) {
            opts += `<option value="${escAttr(cand.id)}"${curId === cand.id ? ' selected' : ''}>${escHtml(effectiveTag(cand))} ${escHtml(cand.name || '')}</option>`;
          }
          h.push(field(`Выход ${oi + 1}: включить при обесточке`, `<select data-switchover-out="${oi}">${opts}</select>`));
        }
        h.push('</div>');
      } else if (sm === 'watchdog') {
        h.push('<div class="inspector-section"><h4>Watchdog</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Вход i → выход i. Выход активен когда upstream входа i мёртв.</div>');
        h.push('</div>');
      } else if (sm === 'parallel') {
        h.push('<div class="inspector-section"><h4>Включённые вводы</h4>');
        h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Можно включить несколько вводных автоматов одновременно — актуально для шкафов байпаса и параллельной работы ИБП.</div>');
        const enabled = Array.isArray(n.parallelEnabled) ? n.parallelEnabled : [];
        for (let i = 0; i < n.inputs; i++) {
          const on = !!enabled[i];
          h.push(`<div class="field check"><input type="checkbox" data-parallel="${i}"${on ? ' checked' : ''}><label>Вход ${i + 1}</label></div>`);
        }
        h.push('</div>');
      } else {
        h.push(prioritySection(n));
      }
    }
    // При inputs === 1 никаких приоритетов/режимов не показываем
    h.push(panelStatusBlock(n));
  } else if (n.type === 'ups') {
    h.push(field('Выходная мощность, kW', `<input type="number" min="0" step="0.1" data-prop="capacityKw" value="${n.capacityKw}">`));
    h.push(field('КПД, %', `<input type="number" min="30" max="100" step="1" data-prop="efficiency" value="${n.efficiency}">`));
    h.push(voltageField(n));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi || 0.92}">`));
    h.push(field('Ток заряда батареи, А (AC из сети)', `<input type="number" min="0" step="0.1" data-prop="chargeA" value="${n.chargeA ?? 2}">`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-8px;margin-bottom:8px">Ток, потребляемый ИБП из сети переменного тока на заряд батареи. Не путать с DC-током заряда АКБ.</div>');
    h.push(field('Ёмкость батареи, kWh', `<input type="number" min="0" step="0.1" data-prop="batteryKwh" value="${n.batteryKwh}">`));
    h.push(field('Заряд батареи, %', `<input type="number" min="0" max="100" step="1" data-prop="batteryChargePct" value="${n.batteryChargePct}">`));
    h.push(field('Входов', `<input type="number" min="1" max="5" step="1" data-prop="inputs" value="${n.inputs}">`));
    h.push(field('Выходов', `<input type="number" min="1" max="20" step="1" data-prop="outputs" value="${n.outputs}">`));
    h.push(checkFieldEff('В работе', n, 'on', effectiveOn(n)));
    if (n.inputs > 1) h.push(prioritySection(n));

    // Статический байпас
    h.push('<div class="inspector-section"><h4>Внутренний статический байпас</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Встроенная функция ИБП: при перегрузке или принудительно переводит нагрузку напрямую со входа, минуя инвертор. КПД = 100%, батарея не заряжается.</div>');
    h.push(checkField('Байпас разрешён', 'staticBypass', n.staticBypass !== false));
    h.push(checkField('Автоматический (по перегрузу)', 'staticBypassAuto', n.staticBypassAuto !== false));
    h.push(field('Порог перехода, % от Pном', `<input type="number" min="80" max="200" step="5" data-prop="staticBypassOverloadPct" value="${n.staticBypassOverloadPct || 110}">`));
    h.push(checkField('Принудительный байпас (вручную)', 'staticBypassForced', !!n.staticBypassForced));
    h.push('</div>');

    h.push(upsStatusBlock(n));
  } else if (n.type === 'consumer') {
    h.push(field('Количество в группе', `<input type="number" min="1" max="999" step="1" data-prop="count" value="${n.count || 1}">`));
    h.push(field(((n.count || 1) > 1 ? 'Мощность каждого, kW' : 'Установленная мощность, kW'),
      `<input type="number" min="0" step="0.1" data-prop="demandKw" value="${n.demandKw}">`));
    if ((n.count || 1) > 1) {
      const total = (Number(n.demandKw) || 0) * (n.count | 0);
      h.push(`<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Суммарная установленная: <b>${n.count} × ${fmt(n.demandKw)} kW = ${fmt(total)} kW</b></div>`);
    }
    h.push(voltageField(n));
    h.push(field('cos φ', `<input type="number" min="0.1" max="1" step="0.01" data-prop="cosPhi" value="${n.cosPhi ?? 0.92}">`));
    h.push(field('Ки — коэффициент использования', `<input type="number" min="0" max="1" step="0.05" data-prop="kUse" value="${n.kUse ?? 1}">`));
    h.push(field('Кратность пускового тока', `<input type="number" min="1" max="10" step="0.1" data-prop="inrushFactor" value="${n.inrushFactor ?? 1}">`));
    h.push(field('Входов', `<input type="number" min="1" max="10" step="1" data-prop="inputs" value="${n.inputs}">`));
    if (n.inputs > 1) h.push(prioritySection(n));
    // Расчётные величины
    h.push(consumerCurrentsBlock(n));
    // В активном сценарии — поле множителя нагрузки
    if (state.activeModeId) {
      const lf = effectiveLoadFactor(n);
      h.push('<div class="inspector-section"><h4>В текущем сценарии</h4>');
      h.push(field('Множитель нагрузки (0–3)', `<input type="number" min="0" max="3" step="0.05" data-loadfactor value="${lf}">`));
      h.push(`<div class="muted" style="font-size:11px;margin-top:-4px">1.0 = номинал, 0.5 = 50% мощности, 0 = выключено.</div>`);
      h.push('</div>');
    }
    h.push(statusBlock(n));
  }

  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    h.push(`<div class="inspector-section"><div class="muted" style="font-size:11px">Изменения параметра «В работе» сохраняются в режиме <b>${escAttr(m?.name || '')}</b></div></div>`);
  }

  // Кнопка сохранения элемента в пользовательскую библиотеку
  if (n.type !== 'zone') {
    h.push('<button id="btn-save-preset" class="full-btn" style="margin-top:10px">★ Сохранить в библиотеку</button>');
  }
  h.push('<button class="btn-delete" id="btn-del-node">Удалить элемент</button>');

  // Полный дамп параметров узла
  h.push(renderFullPropsBlock(n));

  inspectorBody.innerHTML = h.join('');

  wireInspectorInputs(n);

  const saveBtn = document.getElementById('btn-save-preset');
  if (saveBtn) saveBtn.addEventListener('click', () => saveNodeAsPreset(n));
}

// Полный блок «Все данные объекта» внизу инспектора
function renderFullPropsBlock(n) {
  const rows = [];
  // Список полей, которые мы не хотим показывать (координаты, runtime)
  const skip = new Set(['id', 'x', 'y', 'width', 'height']);
  const keys = Object.keys(n).filter(k => !k.startsWith('_') && !skip.has(k));
  keys.sort();
  for (const k of keys) {
    let v = n[k];
    if (v === null || v === undefined) v = '—';
    else if (typeof v === 'object') v = JSON.stringify(v);
    else v = String(v);
    rows.push(`<tr><td class="fp-k">${escHtml(k)}</td><td class="fp-v">${escHtml(v)}</td></tr>`);
  }
  // Runtime-значения (с префиксом _)
  const runtimeKeys = Object.keys(n).filter(k => k.startsWith('_'));
  runtimeKeys.sort();
  if (runtimeKeys.length) {
    rows.push('<tr><td colspan="2" class="fp-sep">— Расчётные величины —</td></tr>');
    for (const k of runtimeKeys) {
      let v = n[k];
      if (typeof v === 'number') v = Number(v).toFixed(3).replace(/\.?0+$/, '');
      else if (v === null || v === undefined) v = '—';
      else if (typeof v === 'object') v = JSON.stringify(v);
      rows.push(`<tr><td class="fp-k">${escHtml(k)}</td><td class="fp-v">${escHtml(String(v))}</td></tr>`);
    }
  }
  return `<div class="inspector-section full-props"><h4>Все данные объекта</h4><table class="fp-table">${rows.join('')}</table></div>`;
}

// Сохранение узла как пользовательского пресета
const USER_PRESET_KEY = 'raschet.userPresets.v1';
function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESET_KEY)) || []; }
  catch { return []; }
}
function saveUserPresets(list) {
  try { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list)); }
  catch (e) { console.error('[userPresets]', e); }
}
function saveNodeAsPreset(n) {
  const title = prompt('Название пресета:', `${n.name || n.type}`);
  if (!title) return;
  const params = JSON.parse(JSON.stringify(n));
  // Чистим технические поля
  delete params.id; delete params.x; delete params.y; delete params.tag;
  for (const k of Object.keys(params)) if (k.startsWith('_')) delete params[k];
  const list = loadUserPresets();
  list.push({
    id: 'user-' + Date.now().toString(36),
    category: 'Мои',
    title,
    description: `Сохранено ${new Date().toLocaleString()}`,
    type: n.type,
    params,
    custom: true,
  });
  saveUserPresets(list);
  // Регистрируем в общем каталоге пресетов, если Presets уже загружен
  if (window.Presets && window.Presets.all) {
    window.Presets.all.push(list[list.length - 1]);
  }
  flash('Сохранено в библиотеку: ' + title);
}

function wireInspectorInputs(n) {
  inspectorBody.querySelectorAll('[data-prop]').forEach(inp => {
    const prop = inp.dataset.prop;
    const apply = () => {
      snapshot('prop:' + n.id + ':' + prop);
      let v;
      if (inp.type === 'checkbox') v = inp.checked;
      else if (inp.type === 'number') v = Number(inp.value);
      else v = inp.value;

      if (prop === 'tag') {
        const t = String(v || '').trim();
        if (!t) return;
        if (!isTagUnique(t, n.id)) {
          flash(`Обозначение «${t}» уже занято`);
          inp.value = n.tag || '';
          return;
        }
        n.tag = t;
      } else if (prop === 'on' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        setEffectiveOn(n, v);
      } else if (prop === 'manualActiveInput') {
        n.manualActiveInput = Number(v) || 0;
      } else if (prop === 'count') {
        n.count = Math.max(1, Number(v) || 1);
      } else if (prop === 'switchMode') {
        n.switchMode = String(v);
      } else if (prop === 'inputs' || prop === 'outputs') {
        const newN = Math.max(1, Number(v) || 1);
        const kind = prop === 'inputs' ? 'in' : 'out';
        const maxUsed = maxOccupiedPort(n.id, kind);
        if (newN <= maxUsed) {
          flash(`Нельзя уменьшить: ${prop === 'inputs' ? 'вход' : 'выход'} №${maxUsed + 1} занят. Сначала отключите линию.`, 'error');
          inp.value = n[prop];
          return;
        }
        n[prop] = newN;
      } else if (prop === 'sourceSubtype') {
        n.sourceSubtype = v;
        // Конвертируем внутренний type для совместимости расчётной логики
        if (v === 'generator') {
          n.type = 'generator';
          if (typeof n.backupMode !== 'boolean') n.backupMode = true;
          if (!Array.isArray(n.triggerNodeIds)) n.triggerNodeIds = [];
          if (typeof n.startDelaySec !== 'number') n.startDelaySec = 5;
          if (typeof n.stopDelaySec !== 'number') n.stopDelaySec = 2;
          if (!n.triggerLogic) n.triggerLogic = 'any';
        } else {
          n.type = 'source';
        }
      } else if (prop === 'triggerNodeId') {
        n.triggerNodeId = v ? String(v) : null;
      } else if (prop === 'voltageLevelIdx') {
        n.voltageLevelIdx = Number(v) || 0;
        const lv = GLOBAL.voltageLevels[n.voltageLevelIdx];
        if (lv) {
          n.voltage = lv.vLL;
          n.phase = lv.phases === 3 ? '3ph' : '1ph';
        }
      } else if (prop === 'phase' && (n.type === 'source' || n.type === 'generator' || n.type === 'ups')) {
        n.phase = v;
        if (v === '3ph') n.voltage = GLOBAL.voltage3ph;
        else if (v === '1ph') n.voltage = GLOBAL.voltage1ph;
      } else if (prop === 'phase' && n.type === 'consumer') {
        n.phase = v;
        if (v === '3ph') n.voltage = GLOBAL.voltage3ph;
        else n.voltage = GLOBAL.voltage1ph;
      } else {
        n[prop] = v;
      }
      if (prop === 'inputs' || prop === 'outputs') clampPortsInvolvingNode(n);
      render();
      notifyChange();
      // Перерисовать инспектор при изменениях, от которых зависят другие поля
      if (prop === 'inputs' || prop === 'outputs' || prop === 'switchMode' || prop === 'count' || prop === 'phase' || prop === 'inrushFactor' || prop === 'triggerNodeId' || prop === 'sourceSubtype' || prop === 'channelType' || prop === 'bundling') {
        renderInspector();
      }
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', apply);
  });
  // Чекбоксы привязки выходов к входам (avr_paired)
  inspectorBody.querySelectorAll('[data-oim-out]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('oim:' + n.id);
      const oi = Number(inp.dataset.oimOut);
      const ii = Number(inp.dataset.oimIn);
      if (!Array.isArray(n.outputInputMap)) n.outputInputMap = [];
      while (n.outputInputMap.length <= oi) n.outputInputMap.push([]);
      if (!Array.isArray(n.outputInputMap[oi])) n.outputInputMap[oi] = [];
      if (inp.checked) {
        if (!n.outputInputMap[oi].includes(ii)) n.outputInputMap[oi].push(ii);
      } else {
        n.outputInputMap[oi] = n.outputInputMap[oi].filter(x => x !== ii);
      }
      render(); notifyChange();
    });
  });
  // Селекты switchover per-output
  inspectorBody.querySelectorAll('[data-switchover-out]').forEach(sel => {
    sel.addEventListener('change', () => {
      snapshot('switchover:' + n.id);
      const oi = Number(sel.dataset.switchoverOut);
      if (!Array.isArray(n.outputActivateWhenDead)) n.outputActivateWhenDead = [];
      while (n.outputActivateWhenDead.length <= oi) n.outputActivateWhenDead.push(null);
      n.outputActivateWhenDead[oi] = sel.value || null;
      render(); notifyChange();
    });
  });
  // Чекбоксы параллельного режима щита
  inspectorBody.querySelectorAll('[data-parallel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('parallel:' + n.id);
      const idx = Number(inp.dataset.parallel);
      if (!Array.isArray(n.parallelEnabled)) n.parallelEnabled = [];
      while (n.parallelEnabled.length <= idx) n.parallelEnabled.push(false);
      n.parallelEnabled[idx] = inp.checked;
      render();
      notifyChange();
    });
  });
  inspectorBody.querySelectorAll('[data-prio]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.prio);
      snapshot('prio:' + n.id + ':' + idx);
      if (!n.priorities) n.priorities = [];
      n.priorities[idx] = Number(inp.value) || 1;
      render();
      notifyChange();
    });
  });
  inspectorBody.querySelectorAll('[data-loadfactor]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('lf:' + n.id);
      setEffectiveLoadFactor(n, inp.value);
      render();
      notifyChange();
    });
  });

  const del = document.getElementById('btn-del-node');
  if (del) del.addEventListener('click', () => deleteNode(n.id));
  const autoBtn = document.getElementById('btn-open-automation');
  if (autoBtn) autoBtn.addEventListener('click', () => openAutomationModal(n));
  const impBtn = document.getElementById('btn-open-impedance');
  if (impBtn) impBtn.addEventListener('click', () => openImpedanceModal(n));
}

// ================= Модалка «Параметры источника» (IEC 60909) =================
function openImpedanceModal(n) {
  const body = document.getElementById('impedance-body');
  if (!body) return;
  const h = [];
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Все номинальные параметры источника и данные для расчёта тока КЗ по IEC 60909.</div>');

  // Номинальные параметры (мощность, напряжение, фазность)
  h.push('<h4 style="margin:16px 0 8px">Номинальные параметры</h4>');
  h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  const ph = n.phase || '3ph';
  h.push(field('Фазность',
    `<select id="imp-phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная</option>
      <option value="1ph"${ph === '1ph' ? ' selected' : ''}>Однофазная</option>
    </select>`));
  const autoV = (ph === '3ph') ? GLOBAL.voltage3ph : GLOBAL.voltage1ph;
  h.push(`<div class="muted" style="font-size:11px;margin-bottom:10px">Напряжение: <b>${autoV} В</b> (из «Начальных условий»)</div>`);

  // Параметры КЗ
  h.push('<h4 style="margin:16px 0 8px">Параметры короткого замыкания</h4>');
  h.push(field('Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="1" max="10000" step="1" value="${n.sscMva ?? 500}">`));
  h.push(field('Напряжение КЗ трансформатора (Uk), %', `<input type="number" id="imp-uk" min="0" max="25" step="0.5" value="${n.ukPct ?? 6}">`));
  h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));

  // Потери трансформатора (для точного расчёта)
  h.push('<h4 style="margin:16px 0 8px">Потери трансформатора</h4>');
  h.push(field('Потери КЗ (Pk), кВт', `<input type="number" id="imp-pk" min="0" max="100" step="0.1" value="${n.pkW ?? 6}">`));
  h.push(field('Потери ХХ (P0), кВт', `<input type="number" id="imp-p0" min="0" max="50" step="0.1" value="${n.p0W ?? 1.5}">`));
  h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Pk — потери короткого замыкания (нагрев обмоток при номинальном токе).<br>P0 — потери холостого хода (нагрев магнитопровода).</div>');

  // Вычисленные значения (справка)
  const U = nodeVoltage(n);
  const Zs = sourceImpedance(n);
  const IkMax = (1.1 * U) / (Math.sqrt(3) * Zs);
  const Pkw = (n.snomKva || 0) * (Number(n.cosPhi) || 0.92);
  h.push(`<div class="inspector-section"><div style="font-size:12px;line-height:1.8">` +
    `Активная мощность (P = Snom × cos φ): <b>${fmt(Pkw)} kW</b><br>` +
    `Zs (полное сопротивление): <b>${(Zs * 1000).toFixed(2)} мОм</b><br>` +
    `Ik max (c=1.1): <b>${fmt(IkMax / 1000)} кА</b> при ${U} В` +
    `</div></div>`);

  body.innerHTML = h.join('');

  const applyBtn = document.getElementById('impedance-apply');
  if (applyBtn) applyBtn.onclick = () => {
    snapshot('impedance:' + n.id);
    n.snomKva = Number(document.getElementById('imp-snom')?.value) || 400;
    const newPhase = document.getElementById('imp-phase')?.value || '3ph';
    n.phase = newPhase;
    n.voltage = newPhase === '3ph' ? GLOBAL.voltage3ph : GLOBAL.voltage1ph;
    // capacityKw = Snom × cos φ (активная мощность из полной)
    n.capacityKw = n.snomKva * (Number(n.cosPhi) || 0.92);
    n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 500;
    n.ukPct = Number(document.getElementById('imp-uk')?.value) || 0;
    n.xsRsRatio = Number(document.getElementById('imp-xsrs')?.value) || 10;
    n.pkW = Number(document.getElementById('imp-pk')?.value) || 0;
    n.p0W = Number(document.getElementById('imp-p0')?.value) || 0;
    document.getElementById('modal-impedance').classList.add('hidden');
    render();
    renderInspector();
    notifyChange();
    flash('Параметры источника обновлены');
  };

  document.getElementById('modal-impedance').classList.remove('hidden');
}

// Вычисление полного сопротивления источника (Ом) по IEC 60909
function sourceImpedance(n) {
  const U = nodeVoltage(n);
  const Ssc = (Number(n.sscMva) || 500) * 1e6; // ВА
  // Zq = U² / Ssc — импеданс питающей сети
  const Zq = (U * U) / Ssc;
  // Zt = Uk% × U² / (100 × Snom) — импеданс трансформатора
  const Snom = (Number(n.snomKva) || 400) * 1000;
  const Uk = Number(n.ukPct) || 0;
  const Zt = Uk > 0 ? (Uk / 100) * (U * U) / Snom : 0;
  return Zq + Zt; // Ом (упрощённая сумма)
}

// ================= Модалка «Автоматизация» =================
function openAutomationModal(n) {
  const body = document.getElementById('automation-body');
  if (!body) return;
  const h = [];

  h.push(`<h3>Триггеры запуска для ${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push('<div class="muted" style="font-size:12px;margin-bottom:12px">Отметьте узлы, при отключении которых ДГУ должен запускаться. Можно выбрать несколько.</div>');

  const allCandidates = [];
  for (const other of state.nodes.values()) {
    if (other.id === n.id) continue;
    if (other.type !== 'source' && other.type !== 'panel' && other.type !== 'generator' && other.type !== 'ups') continue;
    allCandidates.push(other);
  }
  const currentTriggers = new Set(
    (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : [])
  );

  for (const cand of allCandidates) {
    const checked = currentTriggers.has(cand.id);
    h.push(`<div class="field check"><input type="checkbox" data-auto-trigger="${escAttr(cand.id)}"${checked ? ' checked' : ''}><label>${escHtml(effectiveTag(cand))} — ${escHtml(cand.name || '')}</label></div>`);
  }

  h.push('<div style="margin-top:16px">');
  const logic = n.triggerLogic || 'any';
  h.push(field('Логика запуска',
    `<select id="auto-trigger-logic">
      <option value="any"${logic === 'any' ? ' selected' : ''}>ANY — запуск если хотя бы один отключён</option>
      <option value="all"${logic === 'all' ? ' selected' : ''}>ALL — запуск только если все отключены</option>
    </select>`));
  h.push('</div>');

  h.push('<div class="muted" style="font-size:11px;margin-top:12px">ANY: ДГУ запускается, когда хотя бы один из выбранных узлов обесточен.<br>ALL: ДГУ запускается только когда все выбранные узлы одновременно обесточены.</div>');

  body.innerHTML = h.join('');

  // Привязка кнопки «Применить»
  const applyBtn = document.getElementById('automation-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      snapshot('automation:' + n.id);
      // Собираем отмеченные триггеры
      const selected = [];
      body.querySelectorAll('[data-auto-trigger]').forEach(inp => {
        if (inp.checked) selected.push(inp.dataset.autoTrigger);
      });
      n.triggerNodeIds = selected;
      n.triggerNodeId = selected[0] || null;
      const logicSel = document.getElementById('auto-trigger-logic');
      n.triggerLogic = logicSel ? logicSel.value : 'any';
      // Закрываем
      document.getElementById('modal-automation').classList.add('hidden');
      render();
      renderInspector();
      notifyChange();
      flash('Автоматизация обновлена');
    };
  }

  document.getElementById('modal-automation').classList.remove('hidden');
}

// IEC 60364-5-52 графические обозначения способов прокладки.
// Рисует SVG-иконку 36×28 px в правом верхнем углу карточки канала.
function drawChannelIcon(g, nodeW, channelType) {
  const ix = nodeW - 44, iy = 6;
  const ig = el('g', { transform: `translate(${ix},${iy})`, class: 'node-icon' });

  // Общие элементы
  function cable(cx, cy, r) {
    // Кабель в разрезе: внешняя оболочка + 3 жилы внутри
    ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#555', 'stroke-width': 1.2 }));
    const jr = r * 0.28;
    ig.appendChild(el('circle', { cx: cx - jr, cy: cy - jr * 0.5, r: jr, fill: '#555' }));
    ig.appendChild(el('circle', { cx: cx + jr, cy: cy - jr * 0.5, r: jr, fill: '#555' }));
    ig.appendChild(el('circle', { cx, cy: cy + jr * 0.7, r: jr, fill: '#555' }));
  }
  function wall(x, y, w, h) {
    // Штриховка стены/грунта
    ig.appendChild(el('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#888', 'stroke-width': 1 }));
    for (let i = 0; i < w; i += 4) {
      ig.appendChild(el('line', { x1: x + i, y1: y + h, x2: x + i + 4, y2: y, stroke: '#bbb', 'stroke-width': 0.5 }));
    }
  }
  function tray(x, y, w) {
    // Лоток — U-образный профиль
    ig.appendChild(el('path', { d: `M${x},${y} L${x},${y + 6} L${x + w},${y + 6} L${x + w},${y}`, fill: 'none', stroke: '#666', 'stroke-width': 1.2 }));
  }
  function tube(cx, cy, r) {
    // Труба — круг
    ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#888', 'stroke-width': 1.2 }));
  }

  switch (channelType) {
    case 'conduit': // B1 — кабель в трубе на стене
      wall(0, 0, 36, 8);
      tube(18, 18, 9);
      cable(18, 18, 5);
      break;
    case 'tray_solid': // B2 — сплошной лоток/короб
      ig.appendChild(el('rect', { x: 2, y: 10, width: 32, height: 14, fill: 'none', stroke: '#666', 'stroke-width': 1.2 }));
      cable(18, 17, 5);
      break;
    case 'wall': // C — открыто на стене
      wall(0, 0, 36, 8);
      cable(18, 18, 6);
      break;
    case 'tray_perf': // E — перфорированный лоток
      tray(2, 20, 32);
      // Отверстия перфорации
      for (let i = 6; i < 32; i += 8) {
        ig.appendChild(el('rect', { x: i, y: 22, width: 4, height: 2, fill: '#fff', stroke: '#888', 'stroke-width': 0.5 }));
      }
      cable(18, 14, 5);
      break;
    case 'tray_wire': // E — проволочный лоток
      tray(2, 20, 32);
      // Проволочная сетка
      for (let i = 4; i < 34; i += 5) {
        ig.appendChild(el('line', { x1: i, y1: 20, x2: i, y2: 26, stroke: '#aaa', 'stroke-width': 0.5 }));
      }
      cable(18, 14, 5);
      break;
    case 'tray_ladder': // F — лестничный лоток
      // Боковины
      ig.appendChild(el('line', { x1: 4, y1: 16, x2: 4, y2: 26, stroke: '#666', 'stroke-width': 1.5 }));
      ig.appendChild(el('line', { x1: 32, y1: 16, x2: 32, y2: 26, stroke: '#666', 'stroke-width': 1.5 }));
      // Перекладины
      for (let y = 18; y <= 24; y += 6) {
        ig.appendChild(el('line', { x1: 4, y1: y, x2: 32, y2: y, stroke: '#888', 'stroke-width': 0.8 }));
      }
      cable(18, 12, 5);
      break;
    case 'air': // F — свободно в воздухе
      cable(18, 14, 6);
      // Стрелки воздушного потока
      ig.appendChild(el('path', { d: 'M6,24 L10,20 L14,24', fill: 'none', stroke: '#aaa', 'stroke-width': 0.8 }));
      ig.appendChild(el('path', { d: 'M22,24 L26,20 L30,24', fill: 'none', stroke: '#aaa', 'stroke-width': 0.8 }));
      break;
    case 'ground': // D1 — в трубе в земле
      wall(0, 0, 36, 28);
      tube(18, 14, 8);
      cable(18, 14, 4.5);
      break;
    case 'ground_direct': // D2 — напрямую в земле
      wall(0, 0, 36, 28);
      cable(18, 14, 5.5);
      break;
    default:
      cable(18, 14, 6);
  }
  g.appendChild(ig);
}

// Компактная иконка расположения кабелей (bundling) 28×28 px
function drawBundlingIcon(g, x, bundling) {
  const ig = el('g', { transform: `translate(${x},${6})`, class: 'node-icon' });
  const c = (cx, cy, r) => ig.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#555', 'stroke-width': 1 }));
  const dot = (cx, cy) => ig.appendChild(el('circle', { cx, cy, r: 1.8, fill: '#555' }));

  if (bundling === 'spaced') {
    c(6, 14, 5); dot(6, 14);
    c(22, 14, 5); dot(22, 14);
    // Зазор
    ig.appendChild(el('line', { x1: 11, y1: 6, x2: 17, y2: 6, stroke: '#1976d2', 'stroke-width': 0.6 }));
  } else if (bundling === 'bundled') {
    ig.appendChild(el('ellipse', { cx: 14, cy: 14, rx: 12, ry: 10, fill: 'none', stroke: '#888', 'stroke-width': 0.8, 'stroke-dasharray': '2 1.5' }));
    c(8, 11, 4); dot(8, 11);
    c(20, 11, 4); dot(20, 11);
    c(14, 20, 4); dot(14, 20);
  } else {
    // touching
    c(8, 14, 5); dot(8, 14);
    c(20, 14, 5); dot(20, 14);
  }
  g.appendChild(ig);
}

// Возвращает inline SVG строку для иконки способа прокладки (для инспектора)
function channelIconSVG(channelType, size) {
  const s = size || 48;
  const scale = s / 36;
  let paths = '';
  // Упрощённые версии иконок как inline SVG строка
  function circSvg(cx, cy, r, fill, stroke) {
    return `<circle cx="${cx * scale}" cy="${cy * scale}" r="${r * scale}" fill="${fill || 'none'}" stroke="${stroke || '#555'}" stroke-width="${1.2 * scale}"/>`;
  }
  function dotsSvg(cx, cy, r) {
    const jr = r * 0.28 * scale;
    return circSvg(cx, cy, r, 'none', '#555') +
      `<circle cx="${(cx - r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${(cx + r * 0.28) * scale}" cy="${(cy - r * 0.14) * scale}" r="${jr}" fill="#555"/>` +
      `<circle cx="${cx * scale}" cy="${(cy + r * 0.2) * scale}" r="${jr}" fill="#555"/>`;
  }
  function hatch(x, y, w, h) {
    let r = `<rect x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="#888" stroke-width="${scale}"/>`;
    for (let i = 0; i < w; i += 4) {
      r += `<line x1="${(x + i) * scale}" y1="${(y + h) * scale}" x2="${(x + i + 4) * scale}" y2="${y * scale}" stroke="#ccc" stroke-width="${0.5 * scale}"/>`;
    }
    return r;
  }

  switch (channelType) {
    case 'conduit': paths = hatch(0, 0, 36, 8) + circSvg(18, 18, 9, 'none', '#888') + dotsSvg(18, 18, 5); break;
    case 'tray_solid': paths = `<rect x="${2 * scale}" y="${10 * scale}" width="${32 * scale}" height="${14 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 17, 5); break;
    case 'wall': paths = hatch(0, 0, 36, 8) + dotsSvg(18, 18, 6); break;
    case 'tray_perf': paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_wire': paths = `<path d="M${2 * scale},${20 * scale} L${2 * scale},${26 * scale} L${34 * scale},${26 * scale} L${34 * scale},${20 * scale}" fill="none" stroke="#666" stroke-width="${1.2 * scale}"/>` + dotsSvg(18, 14, 5); break;
    case 'tray_ladder': paths = `<line x1="${4 * scale}" y1="${16 * scale}" x2="${4 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${32 * scale}" y1="${16 * scale}" x2="${32 * scale}" y2="${26 * scale}" stroke="#666" stroke-width="${1.5 * scale}"/><line x1="${4 * scale}" y1="${21 * scale}" x2="${32 * scale}" y2="${21 * scale}" stroke="#888" stroke-width="${0.8 * scale}"/>` + dotsSvg(18, 12, 5); break;
    case 'ground': paths = hatch(0, 0, 36, 28) + circSvg(18, 14, 8, 'none', '#888') + dotsSvg(18, 14, 4.5); break;
    case 'ground_direct': paths = hatch(0, 0, 36, 28) + dotsSvg(18, 14, 5.5); break;
    default: paths = dotsSvg(18, 14, 6);
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s * 28 / 36}">${paths}</svg>`;
}

// Inline SVG строка для иконки расположения кабелей (для инспектора)
function bundlingIconSVG(bundling, size) {
  const s = size || 48;
  let svg = '';
  if (bundling === 'spaced') {
    svg = `<circle cx="12" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="12" cy="16" r="2" fill="#555"/><circle cx="36" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="36" cy="16" r="2" fill="#555"/><line x1="18" y1="8" x2="30" y2="8" stroke="#1976d2" stroke-width="0.8"/><text x="24" y="7" text-anchor="middle" fill="#1976d2" font-size="6">≥Ø</text>`;
  } else if (bundling === 'bundled') {
    svg = `<ellipse cx="24" cy="16" rx="18" ry="12" fill="none" stroke="#888" stroke-width="0.8" stroke-dasharray="3 2"/><circle cx="16" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="12" r="2" fill="#555"/><circle cx="30" cy="12" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="30" cy="12" r="2" fill="#555"/><circle cx="23" cy="22" r="5" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="23" cy="22" r="2" fill="#555"/>`;
  } else {
    svg = `<circle cx="16" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="16" cy="16" r="2" fill="#555"/><circle cx="32" cy="16" r="6" fill="none" stroke="#555" stroke-width="1.2"/><circle cx="32" cy="16" r="2" fill="#555"/>`;
  }
  return `<svg width="${s}" height="${s * 32 / 48}" viewBox="0 0 48 32">${svg}</svg>`;
}

// Поле уровня напряжения — выбор из справочника
function voltageField(n) {
  const levels = GLOBAL.voltageLevels || [];
  const curIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  // Синхронизируем voltage из уровня
  if (levels[curIdx]) {
    n.voltage = levels[curIdx].vLL;
    n.phase = levels[curIdx].phases === 3 ? '3ph' : '1ph';
  }
  let opts = '';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    opts += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${escHtml(lv.label)} (${lv.vLL}V)</option>`;
  }
  return field('Уровень напряжения',
    `<select data-prop="voltageLevelIdx">${opts}</select>`) +
    `<div class="muted" style="font-size:10px;margin-top:-6px;margin-bottom:8px">V_LL: ${levels[curIdx]?.vLL || 400} В, V_LN: ${levels[curIdx]?.vLN || 230} В, ${levels[curIdx]?.wires || 5} проводов. Справочник — в «Начальных условиях».</div>`;
}

// Поле фазы 3ph/1ph для источников/генераторов/ИБП
function phaseField(n) {
  const ph = n.phase || '3ph';
  return field('Фазность',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="1ph"${ph === '1ph' ? ' selected' : ''}>Однофазная (230 В)</option>
    </select>`);
}
// Поле фазы для потребителя (A/B/C/3ph)
function phaseFieldConsumer(n) {
  const ph = n.phase || '3ph';
  return field('Фаза',
    `<select data-prop="phase">
      <option value="3ph"${ph === '3ph' ? ' selected' : ''}>Трёхфазная (400 В)</option>
      <option value="A"${ph === 'A' ? ' selected' : ''}>Фаза A (230 В)</option>
      <option value="B"${ph === 'B' ? ' selected' : ''}>Фаза B (230 В)</option>
      <option value="C"${ph === 'C' ? ' selected' : ''}>Фаза C (230 В)</option>
    </select>`);
}
// Блок статуса для источников и генераторов
function sourceStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) parts.push('<span class="badge off">отключён</span>');
  else {
    const pct = (Number(n.capacityKw) || 0) > 0 ? Math.round((n._loadKw || 0) / n.capacityKw * 100) : 0;
    parts.push(n._overload ? '<span class="badge off">перегруз</span>' : '<span class="badge on">в работе</span>');
    // Максимальная расчётная нагрузка (все потребители 100%)
    if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
    // Текущая нагрузка (в текущем режиме/сценарии)
    parts.push(`<b>Текущая:</b> ${fmt(n._powerP || n._loadKw || 0)} kW · ${fmt(n._loadA || 0)} A <span class="muted">(${pct}%)</span>`);
    if (n._powerQ) parts.push(`Q реакт.: <b>${fmt(n._powerQ)} kvar</b>`);
    if (n._powerS) parts.push(`S полн.: <b>${fmt(n._powerS)} kVA</b>`);
    if (n._cosPhi) parts.push(`cos φ: <b>${n._cosPhi.toFixed(2)}</b>`);
    if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на шинах: <b>${fmt(n._ikA / 1000)} кА</b>`);
    if (n._deltaUPct > 0) parts.push(`ΔU: <b>${n._deltaUPct.toFixed(2)}%</b>`);
  }
  if (n.type === 'generator' && n.triggerNodeId) {
    const t = state.nodes.get(n.triggerNodeId);
    if (t) {
      const tPowered = !!t._powered;
      parts.push(`триггер: <b>${escHtml(t.tag || '')}</b> — ${tPowered ? 'норма (дежурство)' : 'обесточен (пуск)'}`);
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
// Блок статуса для щита
function panelStatusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">запитан</span>');
  else parts.push('<span class="badge off">без питания</span>');
  // Максимальная расчётная нагрузка
  if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
  // Текущая нагрузка
  parts.push(`<b>Текущая:</b> ${fmt(n._powerP || 0)} kW · ${fmt(n._loadA || 0)} A`);
  parts.push(`Q реакт.: ${fmt(n._powerQ || 0)} kvar · S полн.: ${fmt(n._powerS || 0)} kVA`);
  if (Number(n.kSim) && Number(n.kSim) !== 1) {
    parts.push(`расчётная с Ксим: <b>${fmt(n._calcKw || 0)} kW</b>`);
  }
  if (n._cosPhi) parts.push(`cos φ итог: <b>${n._cosPhi.toFixed(2)}</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik (ток КЗ): <b>${fmt(n._ikA / 1000)} кА</b>`);
  if (n._deltaUPct > 0) parts.push(`ΔU суммарный: <b>${n._deltaUPct.toFixed(2)}%</b>${n._deltaUPct > 5 ? ' ⚠ > 5%' : ''}`);

  // Запас номинала шкафа — сравниваем с максимальным током.
  if (Number(n.capacityA) > 0) {
    const capA = Number(n.capacityA);
    const maxA = n._maxLoadA || 0;
    parts.push(`номинал: <b>${fmt(capA)} A</b>, макс.ток: <b>${fmt(maxA)} A</b>`);
    if (maxA > 0) {
      const pct = n._marginPct == null ? 0 : n._marginPct;
      const pctTxt = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      if (n._marginWarn === 'undersize') {
        parts.push(`запас: <b style="color:#c62828">${pctTxt}</b> ⚠ перегруз (номинал ниже макс.тока)`);
      } else if (n._marginWarn === 'oversize') {
        parts.push(`запас: <b style="color:#8e24aa">${pctTxt}</b> ⚠ избыточен (макс. ${n.marginMaxPct}%)`);
      } else {
        parts.push(`запас: <b style="color:#2e7d32">${pctTxt}</b> ок`);
      }
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
// Блок расчётных токов для потребителя
function consumerCurrentsBlock(n) {
  const parts = [];
  parts.push(`<b>P акт.:</b> ${fmt(n._powerP || 0)} kW`);
  parts.push(`<b>Q реакт.:</b> ${fmt(n._powerQ || 0)} kvar`);
  parts.push(`<b>S полн.:</b> ${fmt(n._powerS || 0)} kVA`);
  parts.push(`<b>Установочный ток:</b> ${fmt(n._nominalA || 0)} А`);
  parts.push(`<b>Расчётный ток:</b> ${fmt(n._ratedA || 0)} А  <span class="muted">(с учётом Ки)</span>`);
  if ((n.inrushFactor || 1) > 1) {
    parts.push(`<b>Пусковой ток:</b> ${fmt(n._inrushA || 0)} А`);
  }
  return `<div class="inspector-section"><h4>Расчётные величины</h4><div style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}

// Мини-escape для HTML (дубликат main.js, т.к. app.js его не видит)
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function prioritySection(n) {
  const ic = nodeInputCount(n);
  if (ic < 1) return '';
  const rows = [];
  rows.push('<div class="inspector-section"><h4>Приоритеты входов</h4>');
  rows.push('<div class="muted" style="font-size:11px;margin-bottom:8px">1 = высший. Равные значения — параллельная работа с разделением нагрузки.</div>');
  for (let i = 0; i < ic; i++) {
    const v = n.priorities?.[i] ?? (i + 1);
    rows.push(field(`Вход ${i + 1}`, `<input type="number" min="1" max="99" step="1" data-prio="${i}" value="${v}">`));
  }
  rows.push('</div>');
  return rows.join('');
}
function statusBlock(n) {
  const parts = [];
  if (n._powered) parts.push('<span class="badge on">есть питание</span>');
  else parts.push('<span class="badge off">без питания</span>');
  if (n.type === 'panel') parts.push(` нагрузка: <b>${fmt(n._loadKw)} kW</b>`);
  return `<div class="inspector-section"><div class="muted" style="font-size:11px">${parts.join(' ')}</div></div>`;
}

function upsStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) {
    parts.push('<span class="badge off">отключён</span>');
  } else if (!n._powered) {
    parts.push('<span class="badge off">без питания</span>');
  } else if (n._onStaticBypass) {
    parts.push('<span class="badge backup">статический байпас</span>');
    parts.push(`<span class="muted">инвертор выключен, реактивная мощность потребителей идёт сквозь ИБП</span>`);
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    parts.push(`на входе: <b>${fmt(n._inputKw)} kW</b> (без потерь)`);
  } else {
    parts.push(n._onBattery
      ? '<span class="badge backup">работа от батареи</span>'
      : '<span class="badge on">работа от сети</span>');
    parts.push(`выход: <b>${fmt(n._loadKw)} / ${fmt(n.capacityKw)} kW</b>`);
    if (!n._onBattery) parts.push(`потребление на входе: <b>${fmt(n._inputKw)} kW</b>`);
  }
  // Номинальный ток на выходе
  const capA = computeCurrentA(n.capacityKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`<b>Номинальный ток: ${fmt(capA)} A</b> (при ${fmt(n.capacityKw)} kW, cos φ = 1)`);

  // P/Q/S — как его видит вышестоящая сеть
  if (typeof n._powerP === 'number') {
    parts.push(`P акт.: <b>${fmt(n._powerP)} kW</b>`);
    parts.push(`Q реакт.: <b>${fmt(n._powerQ || 0)} kvar</b> ${n._onStaticBypass ? '' : '<span class="muted">(инвертор — 0)</span>'}`);
    parts.push(`S полн.: <b>${fmt(n._powerS || 0)} kVA</b>`);
    parts.push(`cos φ: <b>${n._cosPhi ? n._cosPhi.toFixed(2) : '1.00'}</b> ${n._onStaticBypass ? '<span class="muted">(байпас)</span>' : '<span class="muted">(инвертор)</span>'}`);
  }
  // Потребление на входе (от сети): макс. = capacityKw/eff + chargeKw
  const maxInputKw = Number(n.capacityKw) / Math.max(0.01, (Number(n.efficiency) || 100) / 100) + upsChargeKw(n);
  const maxInputA = computeCurrentA(maxInputKw, nodeVoltage(n), 1.0, isThreePhase(n));
  parts.push(`макс. потребление на входе: <b>${fmt(maxInputKw)} kW · ${fmt(maxInputA)} A</b>`);
  if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на выходе: <b>${fmt(n._ikA / 1000)} кА</b>`);
  const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
  parts.push(`запас батареи: <b>${fmt(battKwh)} kWh</b> (${n.batteryChargePct || 0}%)`);
  if (n._loadKw > 0) {
    const hrs = battKwh / n._loadKw;
    const min = hrs * 60;
    let autTxt;
    if (min >= 600) autTxt = '> 10 ч';
    else if (min >= 60) autTxt = (hrs).toFixed(1) + ' ч';
    else if (min >= 1) autTxt = Math.round(min) + ' мин';
    else autTxt = '< 1 мин';
    parts.push(`автономия при текущей нагрузке: <b>${autTxt}</b>`);
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}

function renderInspectorConn(c) {
  const fromN = state.nodes.get(c.from.nodeId);
  const toN   = state.nodes.get(c.to.nodeId);
  const h = [];
  h.push('<div class="muted" style="font-size:12px;margin-bottom:8px">Линия / связь</div>');
  h.push(`<div class="field"><label>Откуда</label><div>${escHtml(effectiveTag(fromN))} · ${escHtml(fromN?.name || '?')} · выход ${c.from.port + 1}</div></div>`);
  h.push(`<div class="field"><label>Куда</label><div>${escHtml(effectiveTag(toN))} · ${escHtml(toN?.name || '?')} · вход ${c.to.port + 1}</div></div>`);

  const lm = c.lineMode || 'normal';
  h.push(field('Состояние линии',
    `<select data-conn-prop="lineMode">
      <option value="normal"${lm === 'normal' ? ' selected' : ''}>Нормальная</option>
      <option value="damaged"${lm === 'damaged' ? ' selected' : ''}>Повреждена</option>
      <option value="disabled"${lm === 'disabled' ? ' selected' : ''}>Отключена</option>
    </select>`));

  if (c._state === 'active') {
    h.push('<div class="inspector-section"><h4>Нагрузка линии</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Текущая P: <b>${fmt(c._loadKw)} kW</b><br>` +
      `Текущий I: <b>${fmt(c._loadA || 0)} A</b><br>` +
      `Расчётный I для кабеля: <b>${fmt(c._maxA || 0)} A</b> <span class="muted">(по максимально возможной нагрузке)</span><br>` +
      (c._cosPhi ? `cos φ: <b>${c._cosPhi.toFixed(2)}</b><br>` : '') +
      `Напряжение: <b>${c._voltage || '-'} В</b>` +
      (c._ikA && isFinite(c._ikA) ? `<br>Ik в точке: <b>${fmt(c._ikA / 1000)} кА</b>` : '') +
      `</div></div>`);
  }

  // Выбор каналов на пути линии
  const channels = [...state.nodes.values()].filter(n => n.type === 'channel');
  if (channels.length) {
    h.push('<div class="inspector-section"><h4>Кабельные каналы на пути</h4>');
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Отметьте каналы, через которые проходит линия. Расчёт возьмёт самые худшие параметры прокладки и учтёт группировку цепей в каждом канале.</div>');
    const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
    for (const ch of channels) {
      const checked = chainIds.includes(ch.id);
      h.push(`<div class="field check"><input type="checkbox" data-conn-channel="${escAttr(ch.id)}"${checked ? ' checked' : ''}><label>${escHtml(ch.tag || '')} — ${escHtml(ch.name || '')} (${escHtml(ch.material || 'Cu')}/${escHtml(ch.insulation || 'PVC')}, ${escHtml(ch.method || 'B1')}, ${ch.ambientC || 30}°C)</label></div>`);
    }
    h.push('</div>');
  }

  // === Кабель линии ===
  // Материал и изоляция — всегда задаются в самой линии, канал их не переопределяет.
  h.push('<div class="inspector-section"><h4>Кабель</h4>');
  const material = c.material || GLOBAL.defaultMaterial;
  h.push(field('Материал жил',
    `<select data-conn-prop="material">
      <option value="Cu"${material === 'Cu' ? ' selected' : ''}>Медь</option>
      <option value="Al"${material === 'Al' ? ' selected' : ''}>Алюминий</option>
    </select>`));
  const insulation = c.insulation || GLOBAL.defaultInsulation;
  h.push(field('Изоляция',
    `<select data-conn-prop="insulation">
      <option value="PVC"${insulation === 'PVC' ? ' selected' : ''}>ПВХ</option>
      <option value="XLPE"${insulation === 'XLPE' ? ' selected' : ''}>СПЭ (XLPE)</option>
    </select>`));
  const ct = c.cableType || GLOBAL.defaultCableType;
  h.push(field('Тип конструкции',
    `<select data-conn-prop="cableType">
      <option value="multi"${ct === 'multi' ? ' selected' : ''}>Многожильный (гибкий)</option>
      <option value="single"${ct === 'single' ? ' selected' : ''}>Одножильный многопроволочный</option>
      <option value="solid"${ct === 'solid' ? ' selected' : ''}>Цельная жила (класс 1–2, до 10 мм²)</option>
    </select>`));
  h.push(field('Длина, м', `<input type="number" min="0" max="10000" step="0.5" data-conn-prop="lengthM" value="${c.lengthM ?? 1}">`));
  h.push('</div>');

  // === Условия прокладки (fallback) ===
  h.push('<div class="inspector-section"><h4>Условия прокладки</h4>');
  // Иконки текущего способа + расположения
  const curMethod = c.installMethod || GLOBAL.defaultInstallMethod;
  const curBundling = c.bundling || 'touching';
  // Маппинг метода → channelType для иконки
  const methodToChannel = { B1: 'conduit', B2: 'tray_solid', C: 'wall', E: 'tray_perf', F: 'tray_ladder', D1: 'ground', D2: 'ground_direct' };
  h.push(`<div style="display:flex;gap:10px;justify-content:center;margin:6px 0">${channelIconSVG(methodToChannel[curMethod] || 'conduit', 48)}${bundlingIconSVG(curBundling, 48)}</div>`);
  const chainIds = Array.isArray(c.channelIds) ? c.channelIds : [];
  if (chainIds.length) {
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Линия проходит через канал(ы) — параметры ниже переопределяются каналом (худший случай по всей цепочке).</div>');
  } else {
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Линия не проходит через каналы — параметры берутся отсюда. Значения по умолчанию соответствуют выводу ~1 м до щита / потребителя в нормальных условиях.</div>');
  }
  const method = c.installMethod || GLOBAL.defaultInstallMethod;
  h.push(field('Способ прокладки',
    `<select data-conn-prop="installMethod">
      <option value="B1"${method === 'B1' ? ' selected' : ''}>B1 — изолированные в трубе</option>
      <option value="B2"${method === 'B2' ? ' selected' : ''}>B2 — многожильный в трубе</option>
      <option value="C"${method === 'C' ? ' selected' : ''}>C — открыто на стене</option>
      <option value="E"${method === 'E' ? ' selected' : ''}>E — многожильный на лотке</option>
      <option value="F"${method === 'F' ? ' selected' : ''}>F — одножильные на лотке / в воздухе</option>
      <option value="D1"${method === 'D1' ? ' selected' : ''}>D1 — в трубе в земле</option>
      <option value="D2"${method === 'D2' ? ' selected' : ''}>D2 — напрямую в земле</option>
    </select>`));
  const bundling = c.bundling || 'touching';
  h.push(field('Расположение кабелей',
    `<select data-conn-prop="bundling">
      <option value="spaced"${bundling === 'spaced' ? ' selected' : ''}>С зазором ≥ Ø кабеля</option>
      <option value="touching"${bundling === 'touching' ? ' selected' : ''}>Плотно друг к другу</option>
      <option value="bundled"${bundling === 'bundled' ? ' selected' : ''}>В пучке / жгуте</option>
    </select>`));
  h.push(field('Температура среды, °C', `<input type="number" min="10" max="70" step="5" data-conn-prop="ambientC" value="${c.ambientC || GLOBAL.defaultAmbient}">`));
  h.push(field('Цепей в группе', `<input type="number" min="1" max="20" step="1" data-conn-prop="grouping" value="${c.grouping || GLOBAL.defaultGrouping}">`));
  h.push('</div>');

  // Результат подбора кабеля
  if (c._state === 'active' && c._cableSize) {
    const warn = c._cableOverflow ? '<span style="color:#c62828;font-weight:600"> (Iрасч > Iдоп даже при макс. сечении и ' + (GLOBAL.maxParallelAuto || 4) + ' параллельных)</span>' : '';
    const par = c._cableParallel || 1;
    const typeLabel = {
      multi: 'многожильный',
      single: 'одножильный многопр.',
      solid: 'цельная жила',
    }[c._cableType || 'multi'] || 'многожильный';
    const bundlingLabel = {
      spaced:   'с зазором ≥ Ø',
      touching: 'плотно',
      bundled:  'в пучке',
    }[c._cableBundling || 'touching'] || 'плотно';

    h.push('<div class="inspector-section"><h4>Подобранный кабель</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Сечение: <b>${c._cableSize} мм²</b>${warn}<br>` +
      `Материал: <b>${c._cableMaterial === 'Al' ? 'Алюминий' : 'Медь'}</b>, изоляция <b>${c._cableInsulation || 'PVC'}</b><br>` +
      `Конструкция: <b>${typeLabel}</b><br>` +
      `Метод: <b>${c._cableMethod || 'B1'}</b>, укладка <b>${bundlingLabel}</b><br>` +
      `t=${c._cableAmbient}°C, группа=${c._cableGrouping}, длина=${fmt(c._cableLength || 0)} м<br>` +
      `Iдоп на жилу: <b>${fmt(c._cableIz)} A</b><br>` +
      (par > 1 ? `Параллельных линий: <b>${par}</b><br>Iдоп всех линий: <b>${fmt(c._cableTotalIz)} A</b><br>` : '') +
      `</div></div>`);

    if (c._cableAutoParallel) {
      h.push('<div class="inspector-section" style="background:#fff8e1;border-radius:6px;padding:10px;border:1px solid #ffd54f">');
      h.push(`<div style="font-size:12px;line-height:1.7">` +
        `⚠ <b>Авто-параллель:</b> одиночная жила сечением ${GLOBAL.maxCableSize} мм² не проходит по току,<br>` +
        `поэтому расчёт выбрал <b>${par} параллельных линий ${c._cableSize} мм²</b>.<br>` +
        `<span class="muted" style="font-size:11px">Рекомендации IEC по прокладке параллельных линий:<br>` +
        `• Кабели одной фазы — одинаковой длины и сечения<br>` +
        `• Разносить не более 1 диаметра (вариант &laquo;touching&raquo;) либо с зазором ≥ Ø для лучшего теплоотвода<br>` +
        `• Использовать общий лоток с симметричной разводкой по фазам (ABC/ABC/...)<br>` +
        `• На каждую параллельную линию — свой автомат того же номинала в шкафу</span>` +
        `</div></div>`);
    }
  }

  // Автомат защиты
  if (c._breakerIn) {
    const cnt = c._breakerCount || 1;
    const badge = c._breakerAgainstCable
      ? '<span class="badge off">селект. нарушена</span>'
      : '<span class="badge on">ок</span>';
    h.push('<div class="inspector-section"><h4>Защитный аппарат</h4>');
    h.push(`<div style="font-size:12px;line-height:1.8">` +
      `Номинал: <b>C${c._breakerIn} А</b> ${badge}<br>` +
      (cnt > 1 ? `В шкафу: <b>${cnt} × C${c._breakerIn} А</b> <span class="muted">(по одному на каждую параллельную линию группы)</span><br>` : '') +
      (c._breakerAgainstCable ? `<span style="color:#c62828;font-size:11px">Ток автомата превышает допустимую нагрузку кабеля (${fmt(c._cableIz)} А). Увеличьте сечение или уменьшите номинал.</span>` : '') +
      `</div></div>`);
  }

  h.push('<div class="muted" style="font-size:11px;margin-top:10px">Рукоятки на концах — переключить связь на другой порт. «+» в середине сегмента — добавить точку сплайна. Shift+клик по точке — удалить. Shift+клик по линии — удалить связь.</div>');
  // Кнопка сброса точек сплайна — только если точки есть
  if (Array.isArray(c.waypoints) && c.waypoints.length) {
    h.push(`<button class="full-btn" id="btn-reset-waypoints" style="margin-top:8px">↺ Сбросить траекторию (${c.waypoints.length} точ.)</button>`);
  }
  h.push('<button class="btn-delete" id="btn-del-conn">Удалить связь</button>');
  inspectorBody.innerHTML = h.join('');

  // Подписка на поля связи
  inspectorBody.querySelectorAll('[data-conn-prop]').forEach(inp => {
    inp.addEventListener('input', () => {
      snapshot('conn:' + c.id + ':' + inp.dataset.connProp);
      const prop = inp.dataset.connProp;
      const v = inp.type === 'number' ? Number(inp.value) : inp.value;
      c[prop] = v;
      render();
      notifyChange();
      // Обновить иконки при смене метода/расположения
      if (prop === 'installMethod' || prop === 'bundling') renderInspector();
    });
  });
  // Чекбоксы каналов
  inspectorBody.querySelectorAll('[data-conn-channel]').forEach(inp => {
    inp.addEventListener('change', () => {
      snapshot('conn-channel:' + c.id);
      if (!Array.isArray(c.channelIds)) c.channelIds = [];
      const chId = inp.dataset.connChannel;
      if (inp.checked) {
        if (!c.channelIds.includes(chId)) c.channelIds.push(chId);
      } else {
        c.channelIds = c.channelIds.filter(x => x !== chId);
      }
      render();
      renderInspector();
      notifyChange();
    });
  });
  document.getElementById('btn-del-conn').onclick = () => deleteConn(c.id);
  const resetBtn = document.getElementById('btn-reset-waypoints');
  if (resetBtn) resetBtn.onclick = () => {
    snapshot('wp-reset:' + c.id);
    c.waypoints = [];
    render();
    renderInspector();
    notifyChange();
    flash('Траектория сброшена');
  };
}

function field(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}
function checkField(label, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
function checkFieldEff(label, n, prop, val) {
  return `<div class="field check"><input type="checkbox" data-prop="${prop}"${val ? ' checked' : ''}><label>${label}</label></div>`;
}
function escAttr(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

// ================= Взаимодействие =================
function clientToSvg(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = state.view.x + (clientX - rect.left) / state.view.zoom;
  const y = state.view.y + (clientY - rect.top)  / state.view.zoom;
  return { x, y };
}

// Палитра: drag & drop (десктоп) + click-to-add (мобильный и шорткат)
let _palDragActive = false;
document.querySelectorAll('.pal-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    if (state.readOnly) { e.preventDefault(); return; }
    _palDragActive = true;
    e.dataTransfer.setData('text/raschet-type', item.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
  item.addEventListener('dragend', () => {
    setTimeout(() => { _palDragActive = false; }, 150);
  });
  item.addEventListener('click', () => {
    if (state.readOnly) return;
    if (_palDragActive) return; // был настоящий drag — click не обрабатываем
    const type = item.dataset.type;
    if (!DEFAULTS[type]) return;
    const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
    const cx = state.view.x + (W / 2) / state.view.zoom;
    const cy = state.view.y + (H / 2) / state.view.zoom;
    createNode(type, cx, cy);
    document.body.classList.remove('palette-open');
  });
});
svg.addEventListener('dragover', e => { if (state.readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', e => {
  if (state.readOnly) return;
  e.preventDefault();
  const type = e.dataTransfer.getData('text/raschet-type');
  if (!type || !DEFAULTS[type]) return;
  const p = clientToSvg(e.clientX, e.clientY);
  createNode(type, p.x, p.y);
});

// Мышь
svg.addEventListener('mousedown', e => {
  // Средняя кнопка мыши → всегда пан холста, независимо от того что под курсором
  if (e.button === 1) {
    e.preventDefault();
    state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.classList.add('panning');
    return;
  }

  // Ресайз зоны: клик на угловую ручку → тянем правый-нижний угол
  const zoneResizeEl = e.target.closest('.zone-resize');
  if (zoneResizeEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const zoneEl = zoneResizeEl.closest('.node.zone');
    const zoneId = zoneEl && zoneEl.dataset.nodeId;
    const zone = zoneId && state.nodes.get(zoneId);
    if (!zone) return;
    snapshot();
    const p = clientToSvg(e.clientX, e.clientY);
    state.drag = {
      zoneResizeId: zone.id,
      startMouse: { x: p.x, y: p.y },
      startW: Number(zone.width) || 600,
      startH: Number(zone.height) || 400,
    };
    selectNode(zone.id);
    return;
  }

  // Клик на кнопку «+» в середине сегмента → добавляем waypoint в этой точке
  const addEl = e.target.closest('.conn-waypoint-add');
  if (addEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = addEl.dataset.waypointAddId;
    const idx = Number(addEl.dataset.waypointAddIdx);
    const c = state.conns.get(cid);
    if (!c) return;
    snapshot();
    if (!Array.isArray(c.waypoints)) c.waypoints = [];
    const p = clientToSvg(e.clientX, e.clientY);
    c.waypoints.splice(idx, 0, { x: p.x, y: p.y });
    state.drag = { waypointConnId: cid, waypointIdx: idx };
    render();
    notifyChange();
    return;
  }
  // Клик на существующий waypoint → перетаскиваем его.
  // Shift+клик удаляет waypoint.
  const wpEl = e.target.closest('.conn-waypoint');
  if (wpEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = wpEl.dataset.waypointId;
    const idx = Number(wpEl.dataset.waypointIdx);
    const c = state.conns.get(cid);
    if (!c || !Array.isArray(c.waypoints)) return;
    if (e.shiftKey) {
      snapshot();
      c.waypoints.splice(idx, 1);
      render();
      notifyChange();
      return;
    }
    snapshot();
    state.drag = { waypointConnId: cid, waypointIdx: idx };
    return;
  }

  // Рукоятка reconnect: на выделенной связи есть два хэндла (to и from).
  // Перетаскивание одного из них позволяет переключить связь на другой порт
  // без удаления оригинальной.
  const handleEl = e.target.closest('.conn-handle');
  if (handleEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const cid = handleEl.dataset.reconnectId;
    const end = handleEl.dataset.reconnectEnd || 'to';
    const c = state.conns.get(cid);
    if (!c) return;
    // «Якорь» — конец, который НЕ двигается; с него начинается pending
    if (end === 'to') {
      state.pending = {
        startNodeId: c.from.nodeId, startKind: 'out', startPort: c.from.port,
        reconnectConnId: cid, mouseX: 0, mouseY: 0,
      };
    } else {
      state.pending = {
        startNodeId: c.to.nodeId, startKind: 'in', startPort: c.to.port,
        reconnectConnId: cid, mouseX: 0, mouseY: 0,
      };
    }
    const p = clientToSvg(e.clientX, e.clientY);
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    svg.classList.add('connecting');
    render();
    drawPending();
    return;
  }

  // Порт — начало/конец связи. Можно начинать С ЛЮБОГО порта.
  // Клик на порт — всегда обрабатываем:
  //  - если pending пусто и порт СВОБОДНЫЙ → начинаем новую связь, якорь = этот порт
  //  - если pending пусто и порт УЖЕ ЗАНЯТ → подхватываем существующую связь:
  //    якорем становится ДРУГОЙ её конец, связь ждёт нового целевого клика
  //  - если pending активен → завершаем связь в этот порт
  const portEl = e.target.closest('.port');
  if (portEl) {
    if (state.readOnly) return;
    e.stopPropagation();
    const nodeId = portEl.dataset.nodeId;
    const kind = portEl.dataset.portKind;
    const idx  = Number(portEl.dataset.portIdx);

    if (!state.pending) {
      // Ищем уже существующую связь на этом порту
      let existing = null;
      for (const c of state.conns.values()) {
        if (kind === 'in' && c.to.nodeId === nodeId && c.to.port === idx) { existing = c; break; }
        if (kind === 'out' && c.from.nodeId === nodeId && c.from.port === idx) { existing = c; break; }
      }

      const p = clientToSvg(e.clientX, e.clientY);

      if (existing) {
        // Подхватываем линию: якорь — противоположный конец, сам клик «отсоединил» её
        // от того порта, по которому кликнули.
        if (kind === 'in') {
          state.pending = {
            startNodeId: existing.from.nodeId,
            startKind: 'out',
            startPort: existing.from.port,
            reconnectConnId: existing.id,
            mouseX: p.x, mouseY: p.y, moved: false,
            _startPortEl: portEl,
            _clickedPortNodeId: nodeId,
            _clickedPortKind: kind,
            _clickedPortIdx: idx,
          };
        } else {
          state.pending = {
            startNodeId: existing.to.nodeId,
            startKind: 'in',
            startPort: existing.to.port,
            reconnectConnId: existing.id,
            mouseX: p.x, mouseY: p.y, moved: false,
            _startPortEl: portEl,
            _clickedPortNodeId: nodeId,
            _clickedPortKind: kind,
            _clickedPortIdx: idx,
          };
        }
        svg.classList.add('connecting');
        flash('Линия снята. Кликните по новому порту, чтобы переподключить. Esc — отмена.');
        drawPending();
      } else {
        // Свободный порт — начинаем новую связь
        state.pending = {
          startNodeId: nodeId, startKind: kind, startPort: idx,
          mouseX: p.x, mouseY: p.y, moved: false,
          _startPortEl: portEl,
        };
        svg.classList.add('connecting');
        drawPending();
      }
    } else {
      // Pending активен — завершаем связь в этот порт.
      const s = state.pending;
      // Клик в якорный порт — отмена
      if (s.startNodeId === nodeId && s.startKind === kind && s.startPort === idx) {
        cancelPending();
        return;
      }
      // Клик в тот же порт, с которого подхватили линию (reconnect) — отмена,
      // линия остаётся на своём месте как и была
      if (s.reconnectConnId
          && s._clickedPortNodeId === nodeId
          && s._clickedPortKind === kind
          && s._clickedPortIdx === idx) {
        cancelPending();
        return;
      }
      finishPendingAtPort(portEl);
    }
    return;
  }

  // Связь
  const connEl = e.target.closest('.conn-hit, .conn');
  if (connEl && connEl.dataset.connId) {
    const cid = connEl.dataset.connId;
    if (e.shiftKey && !state.readOnly) { deleteConn(cid); return; }
    selectConn(cid);
    render();
    return;
  }

  // Нода
  const nodeEl = e.target.closest('.node');
  if (nodeEl) {
    const id = nodeEl.dataset.nodeId;
    // Shift+клик — toggle в мульти-выделении
    if (e.shiftKey) {
      if (state.selection.has(id)) state.selection.delete(id);
      else state.selection.add(id);
      render();
      return;
    }
    // Ctrl+drag — клонировать узел и начать таскать копию
    if ((e.ctrlKey || e.metaKey) && !state.readOnly) {
      const original = state.nodes.get(id);
      if (original && original.type !== 'zone') {
        snapshot();
        _clipboardNode = JSON.parse(JSON.stringify(original));
        pasteNode(0, 0); // вставит со смещением 0,0 — на том же месте
        // Начинаем drag копии (она стала selectedId)
        const copyId = state.selectedId;
        const copy = state.nodes.get(copyId);
        if (copy) {
          const p = clientToSvg(e.clientX, e.clientY);
          state.drag = { nodeId: copyId, dx: p.x - copy.x, dy: p.y - copy.y };
        }
        render();
        return;
      }
    }
    // Обычный клик — одиночное выделение
    state.selection.clear();
    selectNode(id);
    if (!state.readOnly) {
      snapshot();
      const n = state.nodes.get(id);
      const p = clientToSvg(e.clientX, e.clientY);
      if (n.type === 'zone') {
        const children = nodesInZone(n).map(ch => ({
          id: ch.id, dx: ch.x - n.x, dy: ch.y - n.y,
        }));
        state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y, children };
      } else {
        state.drag = { nodeId: id, dx: p.x - n.x, dy: p.y - n.y };
      }
    }
    render();
    return;
  }

  // Пустое место
  if (e.shiftKey) {
    // Shift + drag по пустому → рамка выделения
    const p = clientToSvg(e.clientX, e.clientY);
    state.rubberBand = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
    state.selection.clear();
    svg.classList.add('panning');
    return;
  }
  // Обычный drag → пан
  state.selection.clear();
  state.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
  svg.classList.add('panning');
  state.selectedKind = null; state.selectedId = null;
  renderInspector();
  render();
});

window.addEventListener('mousemove', e => {
  // Рамка мульти-выделения
  if (state.rubberBand) {
    const p = clientToSvg(e.clientX, e.clientY);
    state.rubberBand.ex = p.x;
    state.rubberBand.ey = p.y;
    drawRubberBand();
    return;
  }
  if (state.drag && state.drag.zoneResizeId) {
    const z = state.nodes.get(state.drag.zoneResizeId);
    if (z) {
      const p = clientToSvg(e.clientX, e.clientY);
      const dx = p.x - state.drag.startMouse.x;
      const dy = p.y - state.drag.startMouse.y;
      let nw = state.drag.startW + dx;
      let nh = state.drag.startH + dy;
      if (!e.altKey) {
        nw = Math.round(nw / 40) * 40;
        nh = Math.round(nh / 40) * 40;
      }
      nw = Math.max(200, nw);
      nh = Math.max(120, nh);

      // Ограничение: новая рамка не должна перекрывать bbox не-членов.
      // Проверяем все узлы (кроме самой зоны и её членов):
      // если bbox узла пересекается с новой рамкой зоны — clamp до границы.
      const memberSet = new Set(z.memberIds || []);
      for (const other of state.nodes.values()) {
        if (other.id === z.id) continue;
        if (other.type === 'zone') continue;
        if (memberSet.has(other.id)) continue;
        const ow = nodeWidth(other), oh = nodeHeight(other);
        // Проверяем, был ли этот узел уже вне исходной рамки
        const wasOutsideX = (other.x >= z.x + state.drag.startW) || (other.x + ow <= z.x);
        const wasOutsideY = (other.y >= z.y + state.drag.startH) || (other.y + oh <= z.y);
        if (!wasOutsideX && !wasOutsideY) continue; // узел уже пересекал — игнорируем
        // Если узел справа от исходной правой границы и теперь расширение до него дотянется — clamp
        if (wasOutsideX && other.x >= z.x + state.drag.startW) {
          const maxW = other.x - z.x; // не дотрагиваемся до левой кромки соседа
          if (nw > maxW) nw = Math.max(200, maxW);
        }
        if (wasOutsideY && other.y >= z.y + state.drag.startH) {
          const maxH = other.y - z.y;
          if (nh > maxH) nh = Math.max(120, maxH);
        }
      }

      z.width = nw;
      z.height = nh;
      render();
    }
    return;
  }
  if (state.drag && state.drag.waypointConnId) {
    const c = state.conns.get(state.drag.waypointConnId);
    if (c && Array.isArray(c.waypoints)) {
      const p = clientToSvg(e.clientX, e.clientY);
      let nx = p.x, ny = p.y;
      if (!e.altKey) {
        nx = Math.round(nx / 40) * 40;
        ny = Math.round(ny / 40) * 40;
      }
      c.waypoints[state.drag.waypointIdx] = { x: nx, y: ny };
      render();
    }
    return;
  }
  if (state.drag && state.drag.nodeId) {
    const p = clientToSvg(e.clientX, e.clientY);
    const n = state.nodes.get(state.drag.nodeId);
    let nx = p.x - state.drag.dx;
    let ny = p.y - state.drag.dy;
    // Snap to grid 40 — держим Alt чтобы отключить привязку
    if (!e.altKey) {
      nx = Math.round(nx / 40) * 40;
      ny = Math.round(ny / 40) * 40;
    }
    n.x = nx;
    n.y = ny;
    // Тащим детей вместе с зоной
    if (state.drag.children) {
      for (const ch of state.drag.children) {
        const cn = state.nodes.get(ch.id);
        if (cn) {
          cn.x = nx + ch.dx;
          cn.y = ny + ch.dy;
        }
      }
    }
    render();
  } else if (state.drag && state.drag.pan) {
    const dx = (e.clientX - state.drag.sx) / state.view.zoom;
    const dy = (e.clientY - state.drag.sy) / state.view.zoom;
    state.view.x = state.drag.vx - dx;
    state.view.y = state.drag.vy - dy;
    updateViewBox();
  }
  if (state.pending) {
    const p = clientToSvg(e.clientX, e.clientY);
    // Помечаем, что произошло реальное перемещение (более 3 пикселей)
    if (!state.pending.moved) {
      const dx = Math.abs((state.pending.mouseX || 0) - p.x);
      const dy = Math.abs((state.pending.mouseY || 0) - p.y);
      if (dx > 3 || dy > 3) state.pending.moved = true;
    }
    state.pending.mouseX = p.x; state.pending.mouseY = p.y;
    drawPending();
  }
});

window.addEventListener('mouseup', (e) => {
  // Завершение рамки выделения
  if (state.rubberBand) {
    const rb = state.rubberBand;
    const x1 = Math.min(rb.sx, rb.ex), y1 = Math.min(rb.sy, rb.ey);
    const x2 = Math.max(rb.sx, rb.ex), y2 = Math.max(rb.sy, rb.ey);
    state.selection.clear();
    for (const n of state.nodes.values()) {
      if (n.type === 'zone') continue;
      const nw = nodeWidth(n), nh = nodeHeight(n);
      // Узел выделяется, если пересекается с рамкой
      if (n.x + nw >= x1 && n.x <= x2 && n.y + nh >= y1 && n.y <= y2) {
        state.selection.add(n.id);
      }
    }
    state.rubberBand = null;
    clearRubberBand();
    svg.classList.remove('panning');
    render();
    if (state.selection.size) flash(`Выделено: ${state.selection.size}`);
    return;
  }
  if (state.drag) {
    const wasNodeDrag = !!state.drag.nodeId;
    const wasWpDrag = !!state.drag.waypointConnId;
    const wasZoneResize = !!state.drag.zoneResizeId;
    const draggedNodeId = state.drag.nodeId;
    const hadChildren = !!(state.drag.children && state.drag.children.length);
    svg.classList.remove('panning');
    state.drag = null;
    // Членство в зоне обновляется только в момент отпускания мыши после
    // обычного drag'а узла (не самой зоны и не группового drag-all).
    if (wasNodeDrag && draggedNodeId && !hadChildren) {
      const dragged = state.nodes.get(draggedNodeId);
      if (dragged && dragged.type !== 'zone') {
        const currentZone = findZoneForMember(dragged);
        if (currentZone && !isNodeFullyInside(dragged, currentZone)) {
          currentZone.memberIds = (currentZone.memberIds || []).filter(id => id !== dragged.id);
        }
        if (!findZoneForMember(dragged)) {
          tryAttachToZone(dragged);
        }
        render();
      }
    }
    if (wasNodeDrag || wasWpDrag || wasZoneResize) notifyChange();
  }
  // Завершение pending при отпускании мыши:
  //  - курсор не двигался → ничего не делаем, pending живёт до второго клика
  //  - двигался и отпустил над другим портом → drag-drop финиш
  //  - двигался и отпустил не над портом → отменяем
  if (state.pending) {
    const moved = !!state.pending.moved;
    if (!moved) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const portEl = target && target.closest && target.closest('.port');
    if (portEl && portEl !== state.pending._startPortEl) {
      finishPendingAtPort(portEl);
    } else {
      cancelPending();
    }
  }
});

// Отмена ведения связи
svg.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (state.pending) cancelPending();
});
let _clipboardNode = null;

function copySelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  flash('Скопировано: ' + (n.tag || n.name));
}

function pasteNode(offsetX = 40, offsetY = 40) {
  if (!_clipboardNode) return;
  snapshot();
  const id = uid();
  const copy = JSON.parse(JSON.stringify(_clipboardNode));
  copy.id = id;
  copy.x = (copy.x || 0) + offsetX;
  copy.y = (copy.y || 0) + offsetY;
  copy.tag = nextFreeTag(copy.type); // уникальное обозначение
  // Обнуляем runtime-поля
  delete copy._loadKw; delete copy._loadA; delete copy._powered;
  delete copy._overload; delete copy._cosPhi; delete copy._onBattery;
  delete copy._inputKw; delete copy._nominalA; delete copy._ratedA; delete copy._inrushA;
  delete copy._calcKw;
  state.nodes.set(id, copy);
  selectNode(id);
  render();
  notifyChange();
  flash('Вставлено: ' + copy.tag);
}

function duplicateSelectedNode() {
  if (state.selectedKind !== 'node' || !state.selectedId) return;
  const n = state.nodes.get(state.selectedId);
  if (!n) return;
  _clipboardNode = JSON.parse(JSON.stringify(n));
  pasteNode(40, 40);
}

window.addEventListener('keydown', e => {
  // Undo / Redo работают даже когда фокус в input, это стандартное поведение
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    if (state.readOnly) return;
    e.preventDefault();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
    if (state.readOnly) return;
    e.preventDefault();
    redo();
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  // Copy / Paste / Duplicate
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    if (state.readOnly) return;
    e.preventDefault();
    copySelectedNode();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
    if (state.readOnly) return;
    e.preventDefault();
    pasteNode();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    if (state.readOnly) return;
    e.preventDefault();
    duplicateSelectedNode();
    return;
  }
  if (e.key === 'Escape' && state.pending) cancelPending();
  if (state.readOnly) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selection.size) {
      snapshot();
      for (const id of [...state.selection]) deleteNode(id);
      state.selection.clear();
      e.preventDefault();
    } else if (state.selectedKind === 'node' && state.selectedId) {
      deleteNode(state.selectedId); e.preventDefault();
    } else if (state.selectedKind === 'conn' && state.selectedId) {
      deleteConn(state.selectedId); e.preventDefault();
    }
  }
});

function cancelPending() {
  if (!state.pending) return;
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  render();
}

// Завершение pending при отпускании/клике над портом.
// portEl — DOM-элемент .port, над которым закончилось действие.
function finishPendingAtPort(portEl) {
  if (!state.pending) return;
  if (state.readOnly) { cancelPending(); return; }

  const s = state.pending;
  const nodeId = portEl.dataset.nodeId;
  const kind = portEl.dataset.portKind;
  const idx  = Number(portEl.dataset.portIdx);

  // Концы должны быть разных типов: один out, другой in
  if (s.startKind === kind) {
    flash('Соединение возможно только между выходом и входом', 'error');
    cancelPending();
    return;
  }
  const outEnd = s.startKind === 'out'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };
  const inEnd  = s.startKind === 'in'
    ? { nodeId: s.startNodeId, port: s.startPort }
    : { nodeId, port: idx };

  if (outEnd.nodeId === inEnd.nodeId) {
    flash('Нельзя замыкать узел на себя', 'error');
    cancelPending();
    return;
  }

  // === Жёсткие проверки ===
  // 1) Вход может иметь не более одной входящей связи
  // 2) Выход может иметь не более одной исходящей связи
  const existingId = s.reconnectConnId || null;
  const duplicateIn = [...state.conns.values()].some(c =>
    c.id !== existingId && c.to.nodeId === inEnd.nodeId && c.to.port === inEnd.port);
  if (duplicateIn) {
    flash('На этом входе уже есть линия. Сначала отключите её.', 'error');
    cancelPending();
    return;
  }
  const duplicateOut = [...state.conns.values()].some(c =>
    c.id !== existingId && c.from.nodeId === outEnd.nodeId && c.from.port === outEnd.port);
  if (duplicateOut) {
    flash('С этого выхода уже идёт линия. От одного выхода можно только одну.', 'error');
    cancelPending();
    return;
  }
  if (wouldCreateCycle(outEnd.nodeId, inEnd.nodeId)) {
    flash('Такое соединение создаст цикл', 'error');
    cancelPending();
    return;
  }

  // Reconnect существующей линии (rewire)
  if (existingId) {
    const existing = state.conns.get(existingId);
    if (existing) {
      snapshot();
      existing.from = outEnd;
      existing.to = inEnd;
      state.pending = null;
      clearPending();
      svg.classList.remove('connecting');
      render();
      notifyChange();
      return;
    }
  }

  // Новая связь
  const cid = tryConnect(outEnd, inEnd);
  state.pending = null;
  clearPending();
  svg.classList.remove('connecting');
  if (cid) { selectConn(cid); render(); }
  else flash('Не удалось создать связь', 'error');
}

function drawPending() {
  clearPending();
  if (!state.pending) return;
  const p = state.pending;
  const node = state.nodes.get(p.startNodeId);
  if (!node) return;
  const a = portPos(node, p.startKind, p.startPort);
  const path = el('path', {
    class: 'pending-line',
    d: bezier(a, { x: p.mouseX, y: p.mouseY }),
  });
  path.id = '__pending';
  layerOver.appendChild(path);
}
function clearPending() {
  const p = document.getElementById('__pending');
  if (p) p.remove();
}
function drawRubberBand() {
  clearRubberBand();
  if (!state.rubberBand) return;
  const rb = state.rubberBand;
  const x = Math.min(rb.sx, rb.ex), y = Math.min(rb.sy, rb.ey);
  const w = Math.abs(rb.ex - rb.sx), h = Math.abs(rb.ey - rb.sy);
  const r = el('rect', {
    id: '__rubberband', class: 'rubber-band',
    x, y, width: w, height: h,
  });
  layerOver.appendChild(r);
}
function clearRubberBand() {
  const r = document.getElementById('__rubberband');
  if (r) r.remove();
}

// Зум колесом
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const before = clientToSvg(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.2, Math.min(4, state.view.zoom * factor));
  const rect = svg.getBoundingClientRect();
  state.view.x = before.x - (e.clientX - rect.left) / newZoom;
  state.view.y = before.y - (e.clientY - rect.top)  / newZoom;
  state.view.zoom = newZoom;
  updateViewBox();
}, { passive: false });

// ================= Тулбар =================
document.getElementById('btn-zoom-in').onclick  = () => { state.view.zoom = Math.min(4, state.view.zoom * 1.2); updateViewBox(); };
document.getElementById('btn-zoom-out').onclick = () => { state.view.zoom = Math.max(0.2, state.view.zoom / 1.2); updateViewBox(); };
document.getElementById('btn-zoom-reset').onclick = () => { state.view.zoom = 1; updateViewBox(); };
document.getElementById('btn-fit').onclick = fitAll;
document.getElementById('btn-save-local').onclick  = () => { localStorage.setItem('raschet.scheme', JSON.stringify(serialize())); flash('Сохранено в браузере'); };
document.getElementById('btn-load-local').onclick  = () => {
  const s = localStorage.getItem('raschet.scheme');
  if (!s) return flash('Нет сохранения');
  try { deserialize(JSON.parse(s)); render(); renderInspector(); flash('Загружено'); }
  catch (err) { flash('Ошибка: ' + err.message); }
};
document.getElementById('btn-clear').onclick = () => {
  if (state.nodes.size && !confirm('Очистить схему?')) return;
  snapshot();
  state.nodes.clear(); state.conns.clear(); state.modes = []; state.activeModeId = null;
  state.selectedKind = null; state.selectedId = null;
  render(); renderInspector();
  notifyChange();
};
// Undo / Redo кнопки в тулбаре (добавлены в index.html)
const _btnUndo = document.getElementById('btn-undo');
const _btnRedo = document.getElementById('btn-redo');
if (_btnUndo) _btnUndo.onclick = undo;
if (_btnRedo) _btnRedo.onclick = redo;
updateUndoButtons();
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  a.download = `raschet-scheme_${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.getElementById('btn-import').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { deserialize(JSON.parse(r.result)); render(); renderInspector(); }
    catch (err) { alert('Ошибка: ' + err.message); }
  };
  r.readAsText(f);
});
document.getElementById('btn-new-mode').onclick = () => createMode();

// Авто-раскладка по уровням: источники сверху, потребители снизу
document.getElementById('btn-auto-layout').onclick = () => autoLayout();
function autoLayout() {
  if (!state.nodes.size) return;
  snapshot();
  // Topological sort: определяем уровень каждого узла
  const levels = new Map();
  const q = [];
  // Стартуем с узлов без входных связей (источники, генераторы)
  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
    if (!hasIn) { levels.set(n.id, 0); q.push(n.id); }
  }
  // BFS вниз
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const lvl = levels.get(cur);
    for (const c of state.conns.values()) {
      if (c.from.nodeId !== cur) continue;
      const nextLvl = lvl + 1;
      if (!levels.has(c.to.nodeId) || levels.get(c.to.nodeId) < nextLvl) {
        levels.set(c.to.nodeId, nextLvl);
        q.push(c.to.nodeId);
      }
    }
  }
  // Узлы без связей — уровень 0
  for (const n of state.nodes.values()) {
    if (n.type === 'zone') continue;
    if (!levels.has(n.id)) levels.set(n.id, 0);
  }
  // Группируем по уровням
  const byLevel = new Map();
  for (const [id, lvl] of levels) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(id);
  }
  const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const gapY = NODE_H + 80;
  const gapX = 40;
  let startY = 80;
  for (const lvl of sortedLevels) {
    const ids = byLevel.get(lvl);
    let totalW = 0;
    for (const id of ids) totalW += nodeWidth(state.nodes.get(id)) + gapX;
    let x = 100 - totalW / 2 + 400; // центрируем
    for (const id of ids) {
      const n = state.nodes.get(id);
      n.x = Math.round(x / 40) * 40;
      n.y = Math.round(startY / 40) * 40;
      x += nodeWidth(n) + gapX;
    }
    startY += gapY;
  }
  render();
  fitAll();
  notifyChange();
  flash('Авто-раскладка применена');
}

// Экспорт SVG / PNG
document.getElementById('btn-export-svg').onclick = () => exportSVG();
document.getElementById('btn-export-png').onclick = () => exportPNG();

function exportSVG() {
  const clone = svg.cloneNode(true);
  // Убираем интерактивные элементы
  clone.querySelectorAll('.conn-handle, .conn-waypoint, .conn-waypoint-add, .zone-resize, #__pending, #__rubberband').forEach(e => e.remove());
  // Вычисляем bbox для viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n), h = nodeHeight(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  const pad = 40;
  const vw = (maxX - minX) + pad * 2;
  const vh = (maxY - minY) + pad * 2;
  clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${vw} ${vh}`);
  clone.setAttribute('width', vw);
  clone.setAttribute('height', vh);
  // Встраиваем стили
  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = document.querySelector('link[href="app.css"]')
    ? '' : ''; // Inline основные стили для SVG
  // Простой вариант — копируем все правила из <style> и <link>
  let cssText = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) cssText += rule.cssText + '\n';
    } catch { /* cross-origin */ }
  }
  styleEl.textContent = cssText;
  clone.insertBefore(styleEl, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  a.download = `raschet_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flash('SVG сохранён');
}

function exportPNG() {
  // Рендерим SVG в canvas, потом toBlob
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n), h = nodeHeight(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  if (!isFinite(minX)) { flash('Схема пуста', 'error'); return; }
  const pad = 40;
  const vw = (maxX - minX) + pad * 2;
  const vh = (maxY - minY) + pad * 2;
  const scale = 2; // retina
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.conn-handle, .conn-waypoint, .conn-waypoint-add, .zone-resize, #__pending, #__rubberband').forEach(e => e.remove());
  clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${vw} ${vh}`);
  clone.setAttribute('width', vw * scale);
  clone.setAttribute('height', vh * scale);
  // Inline стили
  let cssText = '';
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) cssText += rule.cssText + '\n'; } catch {}
  }
  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = cssText;
  clone.insertBefore(styleEl, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = vw * scale;
    canvas.height = vh * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      a.download = `raschet_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash('PNG сохранён');
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}

function fitAll() {
  if (!state.nodes.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.nodes.values()) {
    const w = nodeWidth(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + NODE_H);
  }
  const pad = 60;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const W = svg.clientWidth, H = svg.clientHeight;
  state.view.zoom = Math.min(W / w, H / h, 2);
  state.view.x = minX - pad;
  state.view.y = minY - pad;
  updateViewBox();
}

// ================= Сохранение =================
function serialize() {
  return {
    version: 3,
    nextId: _idSeq,
    nodes: Array.from(state.nodes.values()).map(stripRuntime),
    conns: Array.from(state.conns.values()).map(stripRuntime),
    modes: state.modes,
    activeModeId: state.activeModeId,
    view: { ...state.view },
  };
}
// Удаляет все runtime-поля (с префиксом _) — они вычисляются при загрузке.
function stripRuntime(obj) {
  const copy = {};
  for (const k in obj) {
    if (k.startsWith('_')) continue;
    copy[k] = obj[k];
  }
  return copy;
}
function deserialize(data) {
  state.nodes.clear();
  state.conns.clear();
  for (const n of (data.nodes || [])) state.nodes.set(n.id, n);
  for (const c of (data.conns || [])) state.conns.set(c.id, c);
  state.modes = data.modes || [];
  state.activeModeId = data.activeModeId || null;
  _idSeq = Math.max(data.nextId || 1, 1);
  state.view = data.view || { x: 0, y: 0, zoom: 1 };
  state.selectedKind = null; state.selectedId = null;

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
      if (typeof n.inputs !== 'number') n.inputs = 1;
      if (typeof n.outputs !== 'number') n.outputs = 1;
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

  updateViewBox();
}

// === Зоны ===
// Членство в зоне — ЯВНОЕ: у зоны есть memberIds, и именно они считаются
// её детьми. Геометрия проверяется только при drop'е узла (для добавления
// в зону).

// Полностью ли bbox узла внутри bbox зоны.
function isNodeFullyInside(n, zone) {
  if (!n || !zone || zone.type !== 'zone') return false;
  const nw = nodeWidth(n), nh = nodeHeight(n);
  const zw = nodeWidth(zone), zh = nodeHeight(zone);
  return n.x >= zone.x
      && n.y >= zone.y
      && n.x + nw <= zone.x + zw
      && n.y + nh <= zone.y + zh;
}

// Зона, в которую по членству входит узел. Если узел числится в нескольких
// (вложенных), берём ту, где bbox зоны меньше.
function findZoneForMember(n) {
  if (!n || n.type === 'zone') return null;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (!Array.isArray(z.memberIds) || !z.memberIds.includes(n.id)) continue;
    const area = nodeWidth(z) * nodeHeight(z);
    if (area < bestArea) { best = z; bestArea = area; }
  }
  return best;
}

// Эффективное обозначение с учётом префикса зоны: «P1.MPB1»
function effectiveTag(n) {
  if (!n) return '';
  if (n.type === 'zone') return n.zonePrefix || n.tag || '';
  const z = findZoneForMember(n);
  if (z && (z.zonePrefix || z.tag)) {
    const prefix = z.zonePrefix || z.tag;
    return `${prefix}.${n.tag || ''}`;
  }
  return n.tag || '';
}

// Узлы, принадлежащие зоне (для drag-all / отображения)
function nodesInZone(zone) {
  if (!zone || !Array.isArray(zone.memberIds)) return [];
  const result = [];
  for (const id of zone.memberIds) {
    const n = state.nodes.get(id);
    if (n) result.push(n);
  }
  return result;
}

// Попытаться добавить узел в зону, если он полностью внутри неё и ещё
// не является членом. Берём самую «узкую» подходящую зону.
function tryAttachToZone(n) {
  if (!n || n.type === 'zone') return;
  // Если уже член какой-то зоны — оставляем как есть (узел уже «закреплён»)
  if (findZoneForMember(n)) return;
  let best = null, bestArea = Infinity;
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (!isNodeFullyInside(n, z)) continue;
    const area = nodeWidth(z) * nodeHeight(z);
    if (area < bestArea) { best = z; bestArea = area; }
  }
  if (best) {
    if (!Array.isArray(best.memberIds)) best.memberIds = [];
    if (!best.memberIds.includes(n.id)) best.memberIds.push(n.id);
  }
}

// Убрать узел из всех зон
function detachFromZones(nodeId) {
  for (const z of state.nodes.values()) {
    if (z.type !== 'zone') continue;
    if (!Array.isArray(z.memberIds)) continue;
    z.memberIds = z.memberIds.filter(id => id !== nodeId);
  }
}

// Проверка: сколько портов данного вида реально занято связями
function maxOccupiedPort(nodeId, kind) {
  let max = -1;
  for (const c of state.conns.values()) {
    if (kind === 'in' && c.to.nodeId === nodeId) max = Math.max(max, c.to.port);
    if (kind === 'out' && c.from.nodeId === nodeId) max = Math.max(max, c.from.port);
  }
  return max;
}

// ================= Сообщения =================
function flash(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}

// ================= Демо =================
function buildDemo() {
  const s1 = createNode('source',    280, 100); const s1n = state.nodes.get(s1); s1n.name = 'Ввод 1 (ТП)';
  const s2 = createNode('source',    520, 100); const s2n = state.nodes.get(s2); s2n.name = 'Ввод 2';
  const g1 = createNode('generator', 760, 100); const g1n = state.nodes.get(g1); g1n.name = 'ДГУ';
  const p1 = createNode('panel',     440, 300); const p1n = state.nodes.get(p1); p1n.name = 'ЩС-1'; p1n.inputs = 3; p1n.outputs = 2; p1n.priorities = [1, 2, 3];
  const p2 = createNode('panel',     640, 480); const p2n = state.nodes.get(p2); p2n.name = 'ЩС-2'; p2n.inputs = 1; p2n.outputs = 2;
  const u1 = createNode('ups',       260, 440); const u1n = state.nodes.get(u1); u1n.name = 'ИБП сервера'; u1n.capacityKw = 12; u1n.efficiency = 94; u1n.chargeKw = 0.6; u1n.batteryKwh = 5; u1n.batteryChargePct = 100;
  const c1 = createNode('consumer',  260, 600); const c1n = state.nodes.get(c1); c1n.name = 'Сервер'; c1n.demandKw = 8; c1n.inputs = 1; c1n.priorities = [1];
  const c2 = createNode('consumer',  540, 660); const c2n = state.nodes.get(c2); c2n.name = 'Кондиционер'; c2n.demandKw = 20; c2n.inputs = 1;
  const c3 = createNode('consumer',  760, 660); const c3n = state.nodes.get(c3); c3n.name = 'Освещение';   c3n.demandKw = 5;  c3n.inputs = 1;

  tryConnect({ nodeId: s1, port: 0 }, { nodeId: p1, port: 0 });
  tryConnect({ nodeId: s2, port: 0 }, { nodeId: p1, port: 1 });
  tryConnect({ nodeId: g1, port: 0 }, { nodeId: p1, port: 2 });
  tryConnect({ nodeId: p1, port: 0 }, { nodeId: u1, port: 0 });
  tryConnect({ nodeId: u1, port: 0 }, { nodeId: c1, port: 0 });
  tryConnect({ nodeId: p1, port: 1 }, { nodeId: p2, port: 0 });
  tryConnect({ nodeId: p2, port: 0 }, { nodeId: c2, port: 0 });
  tryConnect({ nodeId: p2, port: 1 }, { nodeId: c3, port: 0 });

  // Пример режима — Ввод 1 сломан
  state.modes.push({ id: uid('m'), name: 'Ввод 1 сломан', overrides: { [s1]: { on: false } } });
  state.modes.push({ id: uid('m'), name: 'Оба ввода сломаны', overrides: { [s1]: { on: false }, [s2]: { on: false } } });

  state.selectedKind = null; state.selectedId = null;
}

// ================= Тач-события =================
// Эмуляция мыши для одного пальца + пинч-зум для двух.
let _pinch = null;

function synthMouseFromTouch(type, touch) {
  const target = document.elementFromPoint(touch.clientX, touch.clientY) || svg;
  const evt = new MouseEvent(type, {
    clientX: touch.clientX,
    clientY: touch.clientY,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  target.dispatchEvent(evt);
}

svg.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    // Пинч — отменяем любые одно-пальцевые операции
    if (state.drag) { svg.classList.remove('panning'); state.drag = null; }
    if (state.pending) cancelPending();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinch = { dist: Math.hypot(dx, dy), zoom: state.view.zoom };
    e.preventDefault();
    return;
  }
  if (e.touches.length === 1) {
    e.preventDefault();
    synthMouseFromTouch('mousedown', e.touches[0]);
  }
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (_pinch && e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const newZoom = Math.max(0.2, Math.min(4, _pinch.zoom * (dist / _pinch.dist)));
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = svg.getBoundingClientRect();
    const before = clientToSvg(cx, cy);
    state.view.zoom = newZoom;
    state.view.x = before.x - (cx - rect.left) / newZoom;
    state.view.y = before.y - (cy - rect.top)  / newZoom;
    updateViewBox();
    e.preventDefault();
    return;
  }
  if (!_pinch && e.touches.length === 1 && (state.drag || state.pending)) {
    e.preventDefault();
    synthMouseFromTouch('mousemove', e.touches[0]);
  }
}, { passive: false });

window.addEventListener('touchend', e => {
  if (_pinch) {
    if (e.touches.length < 2) _pinch = null;
    return;
  }
  if (state.drag || state.pending) {
    const t = e.changedTouches[0];
    if (t) synthMouseFromTouch('mouseup', t);
  }
});
window.addEventListener('touchcancel', () => {
  _pinch = null;
  if (state.drag) { svg.classList.remove('panning'); state.drag = null; }
});

// ================= Симуляция времени =================
// Тик раз в секунду. Ускорение: реальное время / TIME_ACCEL = симуляционное.
// Разряд и заряд ускоряются одинаково.
const TIME_ACCEL = 100;
let _simTickHandle = null;
let _lastTickAt = 0;

function simTick() {
  const now = Date.now();
  const dtSec = _lastTickAt ? (now - _lastTickAt) / 1000 : 1;
  _lastTickAt = now;
  if (dtSec <= 0 || dtSec > 10) { _lastTickAt = now; return; }

  let changed = false;

  // 1. Генераторы с триггером — учёт задержек запуска и остановки
  for (const n of state.nodes.values()) {
    if (n.type !== 'generator') continue;
    const triggers = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : []);
    if (!triggers.length) {
      n._startedAt = 0; n._stoppingAt = 0;
      n._running = false; n._startCountdown = 0; n._stopCountdown = 0;
      continue;
    }
    // Проверяем: должен ли генератор работать по логике триггеров
    const statuses = triggers.map(tid => {
      const t = state.nodes.get(tid);
      return (t && t._powered) ? 'alive' : 'dead';
    });
    const logic = n.triggerLogic || 'any';
    const shouldStart = logic === 'any'
      ? statuses.some(s => s === 'dead')
      : statuses.every(s => s === 'dead');
    const allAlive = !shouldStart;

    if (allAlive) {
      // Триггер жив.
      if (n._running) {
        // Генератор работает — запускаем таймер остановки (если ещё не запущен)
        if (!n._stoppingAt) {
          n._stoppingAt = now;
          changed = true;
        }
        const stopDelay = Math.max(0, Number(n.stopDelaySec) || 0);
        const stopElapsed = (now - n._stoppingAt) / 1000;
        if (stopElapsed >= stopDelay) {
          // Остывание закончено — выключаемся
          n._running = false;
          n._stoppingAt = 0;
          n._stopCountdown = 0;
          n._startedAt = 0;
          n._startCountdown = 0;
          changed = true;
        } else {
          n._stopCountdown = Math.max(0, stopDelay - stopElapsed);
        }
      } else {
        // Не работал и не работает — сбрасываем всё
        if (n._startedAt || n._stoppingAt || n._startCountdown || n._stopCountdown) {
          n._startedAt = 0; n._stoppingAt = 0;
          n._startCountdown = 0; n._stopCountdown = 0;
          changed = true;
        }
      }
    } else {
      // Триггер обесточен.
      // Сбрасываем таймер остановки — генератор снова нужен
      if (n._stoppingAt) {
        n._stoppingAt = 0;
        n._stopCountdown = 0;
        changed = true;
      }
      // Если таймер запуска не запущен И генератор ещё не работает — запускаем отсчёт
      if (!n._running && !n._startedAt) {
        n._startedAt = now;
        changed = true;
      }
      if (!n._running) {
        const delay = Math.max(0, Number(n.startDelaySec) || 0);
        const elapsed = (now - n._startedAt) / 1000;
        if (elapsed >= delay) {
          n._running = true;
          n._startCountdown = 0;
          changed = true;
        } else {
          n._startCountdown = Math.max(0, delay - elapsed);
        }
      }
    }
  }

  // 2. ИБП — разряд батареи пока работает от неё
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (!n._onBattery) {
      // Считаем остаток как запас / нагрузка (для отображения)
      const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
      const loadKw = n._loadKw || 0;
      if (loadKw > 0) n._autonomyMin = (battKwh / loadKw) * 60;
      else n._autonomyMin = 0;
      n._runtimeLeftSec = 0;
      continue;
    }
    const battKwh = (Number(n.batteryKwh) || 0) * (Number(n.batteryChargePct) || 0) / 100;
    const loadKw = n._loadKw || 0;
    if (loadKw <= 0 || battKwh <= 0) {
      n._runtimeLeftSec = 0;
      continue;
    }
    // Реальное время работы в минутах
    const realMinutes = (battKwh / loadKw) * 60;
    // Сокращённое (симуляционное) время
    const simMinutes = realMinutes / TIME_ACCEL;
    n._runtimeLeftSec = simMinutes * 60;

    // Уменьшаем заряд: за 1 секунду симуляции «прошло» TIME_ACCEL секунд реально
    // т.е. разряд = loadKw × (dtSec × TIME_ACCEL / 3600) kWh
    const consumedKwh = loadKw * (dtSec * TIME_ACCEL / 3600);
    let newBatt = battKwh - consumedKwh;
    if (newBatt < 0) newBatt = 0;
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newBatt / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.01) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  // 3. ИБП — медленный заряд, когда работает от сети (упрощённо: до 100% за
  // batteryKwh / chargeKw часов, ускорено в TIME_ACCEL раз)
  for (const n of state.nodes.values()) {
    if (n.type !== 'ups') continue;
    if (n._onBattery || !n._powered) continue;
    const ch = upsChargeKw(n);
    if (ch <= 0) continue;
    if ((n.batteryChargePct || 0) >= 100) continue;
    const addedKwh = ch * (dtSec * TIME_ACCEL / 3600);
    const curKwh = (Number(n.batteryKwh) || 0) * (n.batteryChargePct || 0) / 100;
    const newKwh = Math.min(Number(n.batteryKwh) || 0, curKwh + addedKwh);
    const newPct = (Number(n.batteryKwh) || 0) > 0
      ? (newKwh / Number(n.batteryKwh)) * 100
      : 0;
    if (Math.abs((n.batteryChargePct || 0) - newPct) > 0.1) {
      n.batteryChargePct = newPct;
      changed = true;
    }
  }

  if (changed) {
    render();
    // Перерисовываем инспектор ТОЛЬКО если пользователь не фокусирован
    // на поле ввода — иначе simTick сбрасывает его редактирование.
    const activeEl = document.activeElement;
    const userEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA');
    if (!userEditing && state.selectedKind === 'node') {
      const sel = state.nodes.get(state.selectedId);
      if (sel && (sel.type === 'ups' || sel.type === 'generator')) {
        renderInspector();
      }
    }
  }
}

function startSimLoop() {
  if (_simTickHandle) return;
  _lastTickAt = Date.now();
  _simTickHandle = setInterval(simTick, 1000);
}
function stopSimLoop() {
  if (_simTickHandle) clearInterval(_simTickHandle);
  _simTickHandle = null;
}

// ================= Инициализация (холодный старт) =================
window.addEventListener('resize', updateViewBox);
updateViewBox();
render();
renderInspector();
startSimLoop();

// ================= Библиотека пресетов =================
function applyPreset(preset) {
  if (!preset || !preset.type || !DEFAULTS[preset.type]) return null;
  snapshot();
  // Создаём узел в центре текущего видимого окна
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
  const cx = state.view.x + (W / 2) / state.view.zoom;
  const cy = state.view.y + (H / 2) / state.view.zoom;
  const id = uid();
  const base = { id, type: preset.type, ...DEFAULTS[preset.type](), ...preset.params };
  base.tag = nextFreeTag(preset.type);
  // Нормализуем массив приоритетов под число входов
  if (typeof base.inputs === 'number') {
    if (!Array.isArray(base.priorities)) base.priorities = [];
    while (base.priorities.length < base.inputs) base.priorities.push(base.priorities.length + 1);
    base.priorities.length = base.inputs;
  }
  base.x = cx - nodeWidth(base) / 2;
  base.y = cy - NODE_H / 2;
  state.nodes.set(id, base);
  selectNode(id);
  render();
  notifyChange();
  return id;
}

// ================= 3-фазная балансировка =================
// Для каждого щита считаем суммарную нагрузку по фазам A/B/C (3ф распределяется поровну)
// и возвращаем максимальный дисбаланс в процентах.
function get3PhaseBalance() {
  // Сначала построим map «щит → {a, b, c}»
  const byPanel = new Map();
  // Функция «куда прикреплён потребитель» — пройдём вверх по активным связям до первого щита
  function findPanelForConsumer(consumerId) {
    const stack = [consumerId];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = state.nodes.get(cur);
      if (!n) continue;
      if (n.type === 'panel' && cur !== consumerId) return cur;
      // идём вверх по любым связям (не только active — нас интересует структура)
      for (const c of state.conns.values()) {
        if (c.to.nodeId === cur) stack.push(c.from.nodeId);
      }
    }
    return null;
  }
  for (const n of state.nodes.values()) {
    if (n.type !== 'consumer') continue;
    const per = Number(n.demandKw) || 0;
    const count = Math.max(1, Number(n.count) || 1);
    const total = per * count;
    const panelId = findPanelForConsumer(n.id);
    if (!panelId) continue;
    if (!byPanel.has(panelId)) byPanel.set(panelId, { a: 0, b: 0, c: 0 });
    const g = byPanel.get(panelId);
    const ph = n.phase || '3ph';
    if (ph === '3ph') { g.a += total / 3; g.b += total / 3; g.c += total / 3; }
    else if (ph === 'A') g.a += total;
    else if (ph === 'B') g.b += total;
    else if (ph === 'C') g.c += total;
  }
  const out = [];
  for (const [panelId, g] of byPanel) {
    const panel = state.nodes.get(panelId);
    const sum = g.a + g.b + g.c;
    if (sum <= 0) continue;
    const avg = sum / 3;
    const max = Math.max(g.a, g.b, g.c);
    const imbalance = ((max - avg) / avg) * 100;
    out.push({
      panelId,
      tag: panel?.tag || '',
      name: panel?.name || '',
      a: g.a, b: g.b, c: g.c,
      imbalance,
      warning: imbalance > 15,
    });
  }
  return out;
}

// ================= Генерация отчёта =================
function generateReport() {
  recalc();
  const lines = [];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  lines.push('ОТЧЁТ ПО СХЕМЕ ЭЛЕКТРОСНАБЖЕНИЯ');
  lines.push('Дата: ' + stamp);
  if (state.activeModeId) {
    const m = state.modes.find(x => x.id === state.activeModeId);
    lines.push('Сценарий: ' + (m?.name || '-'));
  } else {
    lines.push('Сценарий: Нормальный режим');
  }
  lines.push('='.repeat(60));
  lines.push('');

  // 1. Источники
  const sources = [...state.nodes.values()].filter(n => n.type === 'source' || n.type === 'generator');
  if (sources.length) {
    lines.push('ИСТОЧНИКИ ПИТАНИЯ');
    lines.push('-'.repeat(78));
    lines.push('Обозн.  Имя                  Тип         Pном, kW  Pнаг, kW   Iр, A   cos φ');
    for (const s of sources) {
      const on = effectiveOn(s);
      const cap = Number(s.capacityKw) || 0;
      const load = s._loadKw || 0;
      const type = s.type === 'source' ? 'Источник' : (s.backupMode ? 'Генер.рез.' : 'Генератор');
      const status = !on ? ' ОТКЛ' : (s._overload ? ' ПЕРЕГР' : '');
      lines.push(
        (s.tag || '').padEnd(8) +
        (s.name || '').padEnd(21) +
        type.padEnd(12) +
        String(fmt(cap)).padStart(8) + '  ' +
        String(fmt(load)).padStart(8) + '  ' +
        String(fmt(s._loadA || 0)).padStart(6) + '   ' +
        ((s._cosPhi || 0).toFixed(2)) + status
      );
    }
    lines.push('');
  }

  // 2. ИБП
  const upses = [...state.nodes.values()].filter(n => n.type === 'ups');
  if (upses.length) {
    lines.push('ИСТОЧНИКИ БЕСПЕРЕБОЙНОГО ПИТАНИЯ (ИБП)');
    lines.push('-'.repeat(60));
    for (const u of upses) {
      const cap = Number(u.capacityKw) || 0;
      const load = u._loadKw || 0;
      const eff = Number(u.efficiency) || 100;
      const batt = (Number(u.batteryKwh) || 0) * (Number(u.batteryChargePct) || 0) / 100;
      const aut = load > 0 ? batt / load * 60 : 0;
      lines.push(`${(u.tag || '').padEnd(8)}${u.name}`);
      lines.push(`   Выход:      ${fmt(load)} / ${fmt(cap)} kW  (КПД ${eff}%)`);
      lines.push(`   Батарея:    ${fmt(batt)} kWh · ${u.batteryChargePct || 0}%`);
      if (load > 0) {
        lines.push(`   Автономия:  ${aut >= 60 ? (aut / 60).toFixed(1) + ' ч' : Math.round(aut) + ' мин'}`);
      }
      if (u._onBattery) lines.push('   Статус:     РАБОТА ОТ БАТАРЕИ');
      else if (u._powered) lines.push('   Статус:     норма (от сети)');
      else lines.push('   Статус:     БЕЗ ПИТАНИЯ');
      lines.push('');
    }
  }

  // 3. Щиты
  const panels = [...state.nodes.values()].filter(n => n.type === 'panel');
  if (panels.length) {
    lines.push('РАСПРЕДЕЛИТЕЛЬНЫЕ ЩИТЫ');
    lines.push('-'.repeat(78));
    lines.push('Обозн.  Имя                  Вх/Вых  Pрасч, kW  Iрасч, A  Ксим  cos φ  Режим');
    for (const p of panels) {
      const mode = p.switchMode === 'manual' ? 'РУЧН'
                 : p.switchMode === 'parallel' ? 'ПАРАЛ'
                 : 'АВР';
      lines.push(
        (p.tag || '').padEnd(8) +
        (p.name || '').padEnd(21) +
        `${p.inputs}/${p.outputs}`.padEnd(8) +
        String(fmt(p._calcKw || p._loadKw || 0)).padStart(9) + '  ' +
        String(fmt(p._loadA || 0)).padStart(8) + '  ' +
        String((p.kSim || 1).toFixed(2)).padStart(4) + '  ' +
        (p._cosPhi ? p._cosPhi.toFixed(2) : '----').padEnd(6) + ' ' +
        mode
      );
    }
    lines.push('');
  }

  // 4. Потребители
  const consumers = [...state.nodes.values()].filter(n => n.type === 'consumer');
  if (consumers.length) {
    lines.push('ПОТРЕБИТЕЛИ');
    lines.push('-'.repeat(92));
    lines.push('Обозн.  Имя                  Фаза  kW ед  Кол  Pрасч  cos φ  Iуст  Iрасч  Iпуск  Статус');
    let total = 0;
    for (const c of consumers) {
      const per = Number(c.demandKw) || 0;
      const cnt = Math.max(1, Number(c.count) || 1);
      const factor = effectiveLoadFactor(c);
      const k = (Number(c.kUse) || 1) * factor;
      const sum = per * cnt * k;
      if (c._powered) total += sum;
      lines.push(
        (c.tag || '').padEnd(8) +
        (c.name || '').padEnd(21) +
        (c.phase || '3ph').padEnd(5) + ' ' +
        String(fmt(per)).padStart(6) + ' ' +
        String(cnt).padStart(4) + ' ' +
        String(fmt(sum)).padStart(6) + ' ' +
        ((Number(c.cosPhi) || 0.92).toFixed(2)).padStart(6) + ' ' +
        String(fmt(c._nominalA || 0)).padStart(5) + ' ' +
        String(fmt(c._ratedA || 0)).padStart(6) + ' ' +
        String(fmt(c._inrushA || 0)).padStart(6) + '  ' +
        (c._powered ? 'ок' : 'БЕЗ ПИТ')
      );
    }
    lines.push('-'.repeat(92));
    lines.push('ИТОГО расчётная активная мощность: ' + fmt(total) + ' kW');
    lines.push('');
  }

  // 4a. Кабельные линии
  const activeCables = [...state.conns.values()].filter(c => c._state === 'active' && c._cableSize);
  if (activeCables.length) {
    lines.push('КАБЕЛЬНЫЕ ЛИНИИ (подбор по IEC 60364-5-52)');
    lines.push('-'.repeat(96));
    lines.push('Откуда       →  Куда                P, kW    Iцепи  ×N  Σ, A   Сечение   Метод   Iдоп');
    for (const c of activeCables) {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromLbl = (effectiveTag(fromN) || '') + ' ' + (fromN?.name || '');
      const toLbl = (effectiveTag(toN) || '') + ' ' + (toN?.name || '');
      const warn = c._cableOverflow ? ' ⚠' : '';
      const parallel = Math.max(1, c._cableParallel || 1);
      const perLine = (c._loadA || 0) / parallel;
      lines.push(
        fromLbl.slice(0, 12).padEnd(14) +
        toLbl.slice(0, 18).padEnd(20) +
        String(fmt(c._loadKw)).padStart(6) + '  ' +
        String(fmt(perLine)).padStart(6) + ' ' +
        (parallel > 1 ? ('×' + parallel).padEnd(3) : '   ') + ' ' +
        String(fmt(c._loadA || 0)).padStart(6) + '  ' +
        (c._cableSize + ' мм²').padStart(8) + '   ' +
        (c._cableMethod || '-').padEnd(6) + '  ' +
        String(fmt(c._cableIz)).padStart(4) + warn
      );
    }
    lines.push('');
  }

  // 5. 3-фазная балансировка
  const balance = get3PhaseBalance();
  if (balance.length) {
    lines.push('ТРЁХФАЗНЫЙ БАЛАНС ПО ЩИТАМ');
    lines.push('-'.repeat(60));
    lines.push('Щит                    A, kW    B, kW    C, kW    Дисбаланс');
    for (const b of balance) {
      const warn = b.warning ? '  ⚠ превышен' : '';
      lines.push(
        ((b.tag || '') + ' ' + (b.name || '')).padEnd(22) +
        String(fmt(b.a)).padStart(8) + ' ' +
        String(fmt(b.b)).padStart(8) + ' ' +
        String(fmt(b.c)).padStart(8) + '    ' +
        b.imbalance.toFixed(1) + '%' + warn
      );
    }
    lines.push('Норма: дисбаланс не более 15%.');
    lines.push('');
  }

  // 6. Проверки
  const issues = [];
  for (const n of state.nodes.values()) {
    if (n.type === 'consumer') {
      const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
      if (!hasIn) issues.push(`  ⚠ Потребитель ${n.tag || n.name} не подключён`);
      if (!n._powered) issues.push(`  ⚠ Потребитель ${n.tag || n.name} без питания`);
    }
    if (n.type === 'panel') {
      const hasOut = [...state.conns.values()].some(c => c.from.nodeId === n.id);
      if (!hasOut) issues.push(`  ⚠ Щит ${n.tag || n.name} не имеет отходящих линий`);
    }
    if (n.type === 'ups' && (Number(n.batteryKwh) || 0) <= 0) {
      issues.push(`  ⚠ ИБП ${n.tag || n.name}: нулевая ёмкость батареи`);
    }
    if (n.type === 'generator' && !n.backupMode) {
      issues.push(`  ℹ Генератор ${n.tag || n.name} работает как основной источник (не резерв)`);
    }
    if (n._overload) {
      issues.push(`  ⚠ ${n.tag || n.name}: перегруз (${fmt(n._loadKw)}/${fmt(n.capacityKw)} kW)`);
    }
  }
  if (issues.length) {
    lines.push('ПРОВЕРКИ И ПРЕДУПРЕЖДЕНИЯ');
    lines.push('-'.repeat(60));
    for (const iss of issues) lines.push(iss);
    lines.push('');
  } else {
    lines.push('ПРОВЕРКИ: замечаний нет.');
    lines.push('');
  }

  return lines.join('\n');
}

// ================= Импорт таблицы нагрузок =================
// Поддерживает CSV с разделителями: табуляция, точка с запятой, запятая.
// Колонки (первая строка — заголовок): name, kW, count, phase, panel.
// Возвращает число добавленных потребителей.
function importLoadsTable(text) {
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
  _suppressSnapshot = true;
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
    _suppressSnapshot = false;
  }
  render();
  renderInspector();
  notifyChange();
  return added;
}

// ================= Публичный API (для main.js) =================
window.Raschet = {
  loadScheme(data) {
    _suppressSnapshot = true;
    try {
      if (!data) {
        state.nodes.clear();
        state.conns.clear();
        state.modes = [];
        state.activeModeId = null;
        state.selectedKind = null;
        state.selectedId = null;
        state.view = { x: 0, y: 0, zoom: 1 };
        updateViewBox();
        render();
        renderInspector();
      } else {
        deserialize(data);
        render();
        renderInspector();
      }
    } catch (err) {
      console.error('[Raschet.loadScheme]', err);
      throw err;
    } finally {
      _suppressSnapshot = false;
    }
    clearUndoStack();
  },
  getScheme() {
    return serialize();
  },
  loadDemo() {
    _suppressSnapshot = true;
    try {
      state.nodes.clear();
      state.conns.clear();
      state.modes = [];
      state.activeModeId = null;
      state.selectedKind = null;
      state.selectedId = null;
      _idSeq = 1;
      buildDemo();
      render();
      renderInspector();
    } finally {
      _suppressSnapshot = false;
    }
    clearUndoStack();
  },
  setReadOnly(flag) {
    state.readOnly = !!flag;
    document.body.classList.toggle('read-only', state.readOnly);
    // Перерисуем инспектор — в read-only режиме инпуты должны быть disabled
    renderInspector();
  },
  fit() {
    // Если canvas только что показан, дадим браузеру посчитать layout
    if (!svg.clientWidth || !svg.clientHeight) {
      requestAnimationFrame(() => fitAll());
      return;
    }
    fitAll();
  },
  isEmpty() { return state.nodes.size === 0; },
  undo,
  redo,
  canUndo() { return _undoStack.length > 0; },
  canRedo() { return _redoStack.length > 0; },
  clearHistory: clearUndoStack,
  onChange(cb) { _changeCb = cb; },

  applyPreset,
  generateReport,
  importLoadsTable,
  get3PhaseBalance,
  getGlobal() { return { ...GLOBAL }; },
  setGlobal(patch) {
    if (!patch || typeof patch !== 'object') return;
    for (const k of Object.keys(patch)) {
      if (k in GLOBAL) GLOBAL[k] = patch[k];
    }
    render();
    renderInspector();
  },
};

})();
