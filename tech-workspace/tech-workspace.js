// =========================================================================
// tech-workspace.js — v0.59.892 (Phase 20.13, blocks-rail UX)
//
// v0.59.892 (Etap A): двухпанельный layout управления блоками концепции.
// Пользователь: «приоритет управление оборудованием, список, управление
// характеристиками стоек через свойства группы. Управление группами и
// другими блоками переработать для удобной работы».
//
// Layout: левый rail со списком блоков (стойки/ИБП/климат/ввод/площади) +
// правая панель деталей выбранного блока. Над rail — summary-bar с
// ключевыми итогами объекта. Карточные редакторы остались, но рендерятся
// по одной за раз — нет визуального шума от 5+ распахнутых секций сразу.
//
// Data shape:
//   variant.concept = {
//     rackGroups: [{
//       id, name, count, kwPerRack, profile, widthMm, depthMm, modelRef,
//       pdu: { kind, phases, ratingA, inputsPerRack, modelRef }   ← per group
//     }],
//     upsSystems: [{
//       id, name, purpose: 'it'|'cooling'|'mixed',
//       count, ratedKva, redundancy, cosPhi, loadFactor,
//       autonomyMin, batteryTech, modelRef
//     }],
//     coolingUnits: [{
//       id, name, count, kwPerUnit, type, redundancy, modelRef
//     }],
//     feed: { tp: {...}, dgu: {...} }
//   }
// =========================================================================

import { ensureDefaultProject, projectKey, listSubProjects, createSubProject, listProjects, getProject, setActiveProjectId, createProject, updateProject } from '../shared/project-storage.js';
import { buildModuleHref } from '../shared/project-context.js';
import { idbGet, idbAvailable } from '../shared/idb-store.js';
import { pricesForElement } from '../shared/price-records.js';
// v0.60.136 (Phase 44.3 follow-up): RBAC guards на approve-actions.
// По правилу feedback_role_based_access.md — canApproveVariants только
// для manager / gip. Для engineer / viewer кнопка disabled.
import { hasPermission, currentRole, ROLES } from '../shared/subscriptions.js';

const $ = (id) => document.getElementById(id);

// ─── State
let _pid = null;
let _variants = [];
let _activeId = null;
let _mode = 'list';
// v0.59.892: выбранный блок в left rail. kind ∈ rack/ups/cool/feed/areas.
// id — идентификатор элемента массива (для feed/areas — null).
let _selectedBlock = null;

// v0.59.901: режим отображения деталей в Список-режиме.
// 'split'  — двухпанельный (rail + details, default, лучшее для редактирования)
// 'cards'  — все блоки распахнуты карточками (для обзора всего сразу)
// 'compact' — только summary-bar + rail (без details; click открывает modal)
// 'table'  — табличный вид (плотная сетка для bulk-редактирования)
let _layoutMode = 'split';

// ─── Storage
const KEY_VARIANTS = ['tech-workspace', 'variants.v1'];
const KEY_ACTIVE = ['tech-workspace', 'activeVariantId.v1'];
const KEY_LAYOUT = ['tech-workspace', 'layoutMode.v1'];

function loadJson(suffix, fallback) {
  if (!_pid) return fallback;
  try {
    const raw = localStorage.getItem(projectKey(_pid, ...suffix));
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function saveJson(suffix, value) {
  if (!_pid) return;
  try { localStorage.setItem(projectKey(_pid, ...suffix), JSON.stringify(value)); } catch {}
}

// ─── ID generator
function _newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

// ─── Default factories
function newRackGroup(name) {
  return {
    id: _newId('rg'),
    name: name || 'Группа стоек',
    count: 0, kwPerRack: 0, profile: 'it',
    widthMm: 600, depthMm: 1200,
    modelRef: null,
    pdu: { kind: 'metered', phases: '3ph', ratingA: 32, inputsPerRack: 2, modelRef: null },
    // v0.60.111 (rooms-концепция, повторное введение после v0.60.107 fix
    // дcType-ternary): roomId — id помещения объекта, в котором стоят эти
    // стойки. null = ещё не привязано (legacy / новая группа). Допустимые
    // значения — id из concept.rooms[].
    roomId: null,
    // v0.60.128 (memory feedback_rack_clearances.md): минимальные клиренсы
    // вокруг стойки. По умолчанию = depthMm спереди и сзади (ASHRAE / TIA-942).
    // Для сзади с двойными дверями допускается уменьшение до 600 мм.
    // Для статива (только передний доступ) — accessRear=false, rearClearanceMm=0.
    frontClearanceMm: 1200,   // default ASHRAE/TIA-942 cold aisle
    rearClearanceMm: 900,     // default hot aisle
    accessFront: true,
    accessRear: true,         // false для статива
  };
}
function newUpsSystem(name, purpose) {
  return {
    id: _newId('us'),
    name: name || (purpose === 'cooling' ? 'ИБП климат' : 'ИБП IT'),
    purpose: purpose || 'it',
    count: 2, ratedKva: 0, redundancy: 'N+1',
    cosPhi: 0.95, loadFactor: 0.8, autonomyMin: 15, batteryTech: 'vrla',
    modelRef: null,
    // v0.60.111: ИБП могут стоять в одном зале со стойками (roomId = тот
    // же что у rackGroup) или в отдельной электрощитовой/UPS-room.
    roomId: null,
  };
}
function newCoolingUnit(name) {
  return {
    id: _newId('cu'),
    name: name || 'Климат',
    count: 3, kwPerUnit: 0, type: 'crac', redundancy: 'N+1',
    modelRef: null,
    // v0.60.111: scope ∈ 'room' | 'shared'.
    //   'room'   — закреплён за одним залом (CRAC/InRow); roomId = id зала.
    //   'shared' — обслуживает несколько залов (chiller-plant, AHU);
    //              roomIds[] = массив обслуживаемых залов.
    // Это позволяет иметь общий чиллер + per-room CRAC, или независимые
    // DX в каждом зале с разной технологией.
    scope: 'room',
    roomId: null,
    roomIds: [],
  };
}
// v0.60.111: помещение объекта.
// v0.60.119: убран жёсткий select типа помещения — имя задаётся технологом
// в свободной форме («Главный зал», «UPS-room», «Щитовая А», «Зал ГПУ»).
// Добавлены климатические требования и прочие требования.
//
// Поля:
//   id        — уникальный идентификатор
//   name      — отображаемое имя (любое)
//   areaSqM   — ПЛАНОВАЯ площадь м² (вводит технолог).
//               Расчётная площадь — отдельно, по footprint оборудования
//               + клиренсы (calcRoomCalculatedArea).
//   notes     — заметки
//   climate   — { tMinC, tMaxC, rhMinPct, rhMaxPct, ashraeClass } —
//               климатические требования (default ASHRAE A1).
//   requirements — { fireSuppression, accessLevel, antistatic,
//                    raised_floor, additional } — прочие требования.
//   kind (legacy) — оставлен для backward-compat но не используется в UI.

// v0.60.143/145 (по репортам Пользователя 2026-05-04 «требования должны
// ограничиваться выбранным классом» + «не нужно блокировать ввод, только
// ограничить выход за пределы класса»): ASHRAE-класс задаёт диапазон
// «allowable envelope» — поля T мин/макс, RH мин/макс остаются редакти-
// руемыми, но input.min/max и change-handler clamp'ят значения к этому
// диапазону. Class='custom' снимает все ограничения.
//
// Источник: ASHRAE TC 9.9 «Thermal Guidelines for Data Processing
// Environments» (4th edition, 2021). Здесь используем allowable envelope
// (не recommended) — это фактический предел, при котором оборудование
// должно функционировать.
//
//   A1: 15-32°C / 8-80% RH  (Tier-IV / mission-critical)
//   A2: 10-35°C / 8-80% RH  (Office / general business)
//   A3: 5-40°C / 8-85% RH   (Edge / secondary)
//   A4: 5-45°C / 8-90% RH   (Edge / lightweight)
//   N/A: ('не data center') — диапазон сбрасывается на дефолты офиса
//        18-27 / 20-80 (рекомендации СП 60).
//   custom: свободный ввод — Пользователь сам определяет.
export const ASHRAE_CLASSES = {
  'A1':     { tMinC: 15, tMaxC: 32, rhMinPct:  8, rhMaxPct: 80, label: 'A1 — Tier-IV / mission-critical (15-32°C, 8-80% RH)' },
  'A2':     { tMinC: 10, tMaxC: 35, rhMinPct:  8, rhMaxPct: 80, label: 'A2 — Office / general (10-35°C, 8-80% RH)' },
  'A3':     { tMinC:  5, tMaxC: 40, rhMinPct:  8, rhMaxPct: 85, label: 'A3 — Edge / secondary (5-40°C, 8-85% RH)' },
  'A4':     { tMinC:  5, tMaxC: 45, rhMinPct:  8, rhMaxPct: 90, label: 'A4 — Edge / lightweight (5-45°C, 8-90% RH)' },
  'N/A':    { tMinC: 18, tMaxC: 27, rhMinPct: 20, rhMaxPct: 80, label: 'N/A — не ЦОД (офис, СП 60)' },
  'custom': { tMinC: null, tMaxC: null, rhMinPct: null, rhMaxPct: null, label: 'Custom — свободный ввод' },
};
/** Применяет диапазон класса к climate-объекту. Если class='custom' —
 *  не трогает существующие значения; иначе перезаписывает все 4 поля. */
export function applyAshraeClassToClimate(climate, classId) {
  if (!climate) return false;
  const def = ASHRAE_CLASSES[classId];
  if (!def) return false;
  if (classId === 'custom') return false;  // не трогаем
  let changed = false;
  if (climate.tMinC !== def.tMinC)     { climate.tMinC = def.tMinC; changed = true; }
  if (climate.tMaxC !== def.tMaxC)     { climate.tMaxC = def.tMaxC; changed = true; }
  if (climate.rhMinPct !== def.rhMinPct) { climate.rhMinPct = def.rhMinPct; changed = true; }
  if (climate.rhMaxPct !== def.rhMaxPct) { climate.rhMaxPct = def.rhMaxPct; changed = true; }
  return changed;
}

function newRoom(name, kind) {
  return {
    id: _newId('rm'),
    name: name || 'Помещение',
    kind: kind || '',  // legacy, без UI
    areaSqM: 0,
    notes: '',
    climate: {
      // v0.60.143: ASHRAE A1 allowable envelope (не recommended).
      // Значения совпадают с ASHRAE_CLASSES.A1.
      tMinC: 15,
      tMaxC: 32,
      rhMinPct: 8,
      rhMaxPct: 80,
      ashraeClass: 'A1',
    },
    requirements: {
      fireSuppression: '',     // 'gas' / 'sprinkler' / 'mist' / 'none'
      accessLevel: '',         // 'restricted' / 'normal'
      antistatic: false,       // антистатический пол
      raisedFloor: false,      // фальшпол
      additional: '',          // freeform
    },
  };
}

// v0.60.119: расчёт «расчётной площади» помещения по footprint
// оборудования + дефолтные клиренсы.
//   front clearance default 1200 мм (ASHRAE / TIA-942 cold aisle)
//   rear  clearance default 900  мм (hot aisle)
//   общие коридоры (между рядами) +30% к equipment-footprint
//
// Когда rack.frontClearanceMm / rackRearClearanceMm появятся (TODO
// memory rule feedback_rack_clearances.md) — использовать их.
function calcRoomCalculatedArea(roomId, concept) {
  if (!roomId || !concept) return 0;
  let m2 = 0;
  const FRONT_DEFAULT = 1.2;  // м (1200 мм)
  const REAR_DEFAULT  = 0.9;  // м
  // Стойки
  for (const rg of (concept.rackGroups || [])) {
    if (rg.roomId !== roomId) continue;
    const w = (Number(rg.widthMm) || 600) / 1000;
    const d = (Number(rg.depthMm) || 1200) / 1000;
    // v0.60.128: учитываем accessFront / accessRear. Если доступ нет —
    // клиренс не нужен (статив, прислонённый к стене).
    const accessFront = rg.accessFront !== false;
    const accessRear  = rg.accessRear  !== false;
    const fc = accessFront ? ((Number(rg.frontClearanceMm) || (FRONT_DEFAULT * 1000)) / 1000) : 0;
    const rc = accessRear  ? ((Number(rg.rearClearanceMm)  || (REAR_DEFAULT  * 1000)) / 1000) : 0;
    const cnt = Number(rg.count) || 0;
    // Каждая стойка: w × (d + fc + rc).
    m2 += cnt * w * (d + fc + rc);
  }
  // ИБП (приблизительно 0.6 × 1.0 м корпус + 0.6 м клиренс спереди).
  for (const us of (concept.upsSystems || [])) {
    if (us.roomId !== roomId) continue;
    const cnt = Number(us.count) || 0;
    m2 += cnt * (0.6 * (1.0 + 0.6));  // ~0.96 m² × cnt
  }
  // Кондиционеры (0.8 × 1.5 м + 0.5 м клиренс).
  for (const cu of (concept.coolingUnits || [])) {
    const inThisRoom = (cu.scope === 'room' && cu.roomId === roomId)
      || (cu.scope === 'shared' && Array.isArray(cu.roomIds) && cu.roomIds.includes(roomId));
    if (!inThisRoom) continue;
    const cnt = Number(cu.count) || 0;
    m2 += cnt * (0.8 * (1.5 + 0.5));  // ~1.6 m² × cnt
  }
  // Общие коридоры между рядами + сервисные зоны: +30%.
  m2 *= 1.30;
  return Math.ceil(m2);
}

// v0.59.901: глобальные настройки системы охлаждения. Влияет на расчёт PUE
// и BOM. coolingUnits[] остаётся как было (внутренние блоки CRAC/InRow),
// а coolingSystem задаёт топологию объекта целиком.
//
// topology:
//   chiller-fc  — чиллер с фрикулингом (наиболее эффективная для холодных
//                 регионов; PUE 1.2–1.4)
//   chiller     — чиллер без фрикулинга (PUE 1.5–1.7)
//   dx          — DX (прямое расширение, конденсаторы) — для малых ЦОД
//   adiabatic   — адиабатический freecool (с водяной завесой)
//   immersion   — погружное охлаждение (для GPU-кластеров)
//
// freeCool.type:
//   direct    — наружный воздух прямо в зал (требует фильтрации)
//   indirect  — теплообменник воздух-воздух
//   glycol    — гликолевый контур к dry-cooler/градирне
//   none      — нет фрикулинга
//
// chillerSpec — линкуется с meteo/chiller-spec для расчёта годовой энергии
// (синхронизация tech-workspace ↔ meteo через общий project-scoped LS-key).
function newCoolingSystem() {
  return {
    topology: 'chiller-fc',
    freeCool: { enabled: true, type: 'indirect', tCutoffC: 14 },
    setpointTC: 22,           // целевая T в холодном коридоре
    deltaTcorridorC: 12,      // ΔT хол/гор коридор
    chillerSpec: { ratedCapKw: 0, ratedCOP: 3.5, ambientRated: 35, capCorrPctPerC: -1.5 },
  };
}
// v0.59.893 (Etap B): блок МЦОД. count — сколько одинаковых зданий этого
// типа. mdcSubProjectId — id sketch-подпроекта в mdc-config (хранит полную
// конфигурацию модулей, ИБП, климата и т.п.). Если null — здание ещё не
// сконфигурировано в mdc-config; tech-workspace показывает заглушку и
// предлагает «📦 Создать в Конфигураторе МЦОД».
function newMdcBuilding(name) {
  return {
    id: _newId('mdc'),
    name: name || 'МЦОД',
    configurator: 'gdm600',
    mdcSubProjectId: null,
    count: 1,
    // Кэш summary из mdc-config: подгружается лениво в renderDetails (read-only).
    _cachedSummary: null,
  };
}

// ─── Variant data shape
function newVariant(name) {
  return {
    id: 'v-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Базовый вариант',
    primary: false,
    readOnly: false,
    // v0.60.85 (Phase 36.1): linkedSketchProjectId — id sub-project, в котором
    // ведётся разработка схем для этого варианта (schematic / scs-design /
    // cooling.selections и т.д.). Создаётся по требованию через UI «➕ Создать
    // sketch-проект для разработки схем». null = ещё не создан.
    linkedSketchProjectId: null,
    approvedAt: null,                  // ts утверждения (≠ null = approved variant)
    createdAt: Date.now(),
    concept: {
      // v0.59.900: блок «Объект» — общие данные проекта/стройплощадки
      projectData: {
        designation: '',
        customer: '',
        city: '',
        address: '',
        lat: null, lon: null,
        stage: 'concept',          // concept|sketch|working|asbuilt
        // v0.60.90 (Пользователь 2026-05-03): тип ЦОД определяет какие
        // блоки доступны в концепции. Default 'stationary' — стационарный
        // ЦОД в собственном здании (МЦОД-блок скрыт).
        //   'stationary' — Стационарный (своё здание)
        //   'modular'    — Модульный (МЦОД GDM-600 и аналоги — блок «🏢 МЦОД»)
        //   'mobile'     — Мобильный (контейнерный, на колёсах)
        //   'indoor'     — В помещении (room-based, в существующем здании)
        //   'capsule'    — Капсула (гермозона, мини-ЦОД в офисе)
        dcType: 'stationary',
        designer: '',
        dateOfDesign: '',
        notes: '',
      },
      // v0.60.111 (rooms-концепция): по умолчанию один главный IT-зал.
      // Все начальные группы стоек/ИБП/климата автопривязаны к нему через
      // roomId. Юзер может добавить новые залы в rail-блоке «🏠 Помещения».
      ...(() => {
        const mainRoom = newRoom('Главный зал', 'it');
        const rg = newRackGroup('Стойки IT');     rg.roomId = mainRoom.id;
        const us = newUpsSystem('ИБП IT', 'it');  us.roomId = mainRoom.id;
        const cu = newCoolingUnit('Климат');       cu.scope = 'room'; cu.roomId = mainRoom.id;
        return {
          rooms: [mainRoom],
          rackGroups: [rg],
          upsSystems: [us],
          coolingUnits: [cu],
        };
      })(),
      coolingSystem: newCoolingSystem(),
      // v0.59.893: блоки МЦОД — массив зданий с привязкой к sub-project mdc-config.
      // По умолчанию пустой (стационарный ЦОД); пользователь добавляет МЦОД явно.
      mdcBuildings: [],
      feed: {
        tp: { needed: false, kva: 0, redundancy: '2', modelRef: null },
        dgu: { needed: false, kw: 0, mode: 'esp', redundancy: 'N+1', modelRef: null },
      },
      // v0.59.895 (Etap D): PUE — режим mode = 'auto' (расчёт по meteo +
      // нагрузкам) или 'manual' (юзер вводит). Кэш меньше зависит от mode:
      // в auto — пересчитывается на каждом render, в manual — фиксированное.
      pue: { mode: 'auto', value: 1.4, manualPue: 1.4 },
    },
  };
}

// ─── Migration: backward-compat для старых variants со скалярными полями
function migrateVariant(v) {
  if (!v || !v.concept) return v;
  // v0.60.85 (Phase 36.1): добавляем linkedSketchProjectId / approvedAt поля
  // в старые варианты без них.
  if (typeof v.linkedSketchProjectId === 'undefined') v.linkedSketchProjectId = null;
  if (typeof v.approvedAt === 'undefined') v.approvedAt = null;
  const c = v.concept;
  // v0.60.111 (rooms-концепция): добавить rooms[] если нет, и привязать
  // существующее оборудование к главному залу. Sacred-params правило:
  // не затирать уже заданные roomId / scope / roomIds.
  if (!Array.isArray(c.rooms) || c.rooms.length === 0) {
    c.rooms = [newRoom('Главный зал', 'it')];
  }
  // v0.60.119: дозаполнение climate / requirements в существующих rooms
  // (preserve-on-miss). Не затираем уже заданные значения.
  c.rooms.forEach(rm => {
    if (!rm.climate || typeof rm.climate !== 'object') {
      // v0.60.143: default — ASHRAE A1 allowable envelope.
      rm.climate = { tMinC: 15, tMaxC: 32, rhMinPct: 8, rhMaxPct: 80, ashraeClass: 'A1' };
    }
    // v0.60.145: migration — clamp existing values в диапазон класса
    // (НЕ сброс на bounds). По уточнению Пользователя «не нужно блокировать
    // ввод, а только ограничить выход за пределы класса». Сохраняем то что
    // ввёл Пользователь, если оно внутри диапазона; что вне — clamp'аем.
    if (rm.climate.ashraeClass && rm.climate.ashraeClass !== 'custom') {
      const _def = ASHRAE_CLASSES[rm.climate.ashraeClass];
      if (_def) {
        const _cl = (f, lo, hi) => {
          const v = Number(rm.climate[f]);
          if (!Number.isFinite(v)) { rm.climate[f] = lo; return; }
          rm.climate[f] = Math.max(lo, Math.min(hi, v));
        };
        _cl('tMinC',    _def.tMinC,    _def.tMaxC);
        _cl('tMaxC',    _def.tMinC,    _def.tMaxC);
        _cl('rhMinPct', _def.rhMinPct, _def.rhMaxPct);
        _cl('rhMaxPct', _def.rhMinPct, _def.rhMaxPct);
      }
    }
    if (!rm.requirements || typeof rm.requirements !== 'object') {
      rm.requirements = { fireSuppression: '', accessLevel: '', antistatic: false, raisedFloor: false, additional: '' };
    }
  });
  const _mainRoomId = c.rooms[0]?.id || null;
  if (Array.isArray(c.rackGroups)) {
    c.rackGroups.forEach(rg => {
      if (typeof rg.roomId === 'undefined') rg.roomId = _mainRoomId;
      // v0.60.128: дозаполнение клиренсов (preserve-on-miss).
      if (typeof rg.frontClearanceMm !== 'number') rg.frontClearanceMm = 1200;
      if (typeof rg.rearClearanceMm !== 'number') rg.rearClearanceMm = 900;
      if (typeof rg.accessFront !== 'boolean') rg.accessFront = true;
      if (typeof rg.accessRear !== 'boolean') rg.accessRear = true;
    });
  }
  if (Array.isArray(c.upsSystems)) {
    c.upsSystems.forEach(us => {
      if (typeof us.roomId === 'undefined') us.roomId = _mainRoomId;
    });
  }
  if (Array.isArray(c.coolingUnits)) {
    c.coolingUnits.forEach(cu => {
      if (typeof cu.scope !== 'string') cu.scope = 'room';
      if (typeof cu.roomId === 'undefined') cu.roomId = _mainRoomId;
      if (!Array.isArray(cu.roomIds)) cu.roomIds = cu.roomId ? [cu.roomId] : [];
    });
  }
  // racks (single) → rackGroups[]
  if (!Array.isArray(c.rackGroups)) {
    if (c.racks) {
      const rg = newRackGroup('Стойки IT');
      Object.assign(rg, {
        count: c.racks.count || 0,
        kwPerRack: c.racks.kwPerRack || 0,
        profile: c.racks.profile || 'it',
        widthMm: c.racks.widthMm || 600,
        depthMm: c.racks.depthMm || 1200,
        modelRef: c.racks.modelRef || null,
      });
      // pdu из старой schema жил как concept.pdu (один на всё) — копируем
      // в первую группу.
      if (c.pdu) {
        rg.pdu = {
          kind: c.pdu.kind || 'metered',
          phases: c.pdu.phases || '3ph',
          ratingA: Number(c.pdu.ratingA) || 32,
          inputsPerRack: Number(c.pdu.inputsPerRack) || 2,
          modelRef: c.pdu.modelRef || null,
        };
      }
      c.rackGroups = [rg];
    } else {
      c.rackGroups = [newRackGroup('Стойки IT')];
    }
    delete c.racks;
    delete c.pdu;
  }
  // ups (single) → upsSystems[]
  if (!Array.isArray(c.upsSystems)) {
    if (c.ups) {
      const us = newUpsSystem('ИБП IT', 'it');
      Object.assign(us, {
        count: c.ups.count || 2,
        ratedKva: c.ups.ratedKva || 0,
        redundancy: c.ups.redundancy || 'N+1',
        cosPhi: c.ups.cosPhi || 0.95,
        loadFactor: c.ups.loadFactor || 0.8,
        autonomyMin: c.ups.autonomyMin || 15,
        batteryTech: c.ups.batteryTech || 'vrla',
        modelRef: c.ups.modelRef || null,
      });
      c.upsSystems = [us];
    } else {
      c.upsSystems = [newUpsSystem('ИБП IT', 'it')];
    }
    delete c.ups;
  }
  // cooling (single) → coolingUnits[]
  if (!Array.isArray(c.coolingUnits)) {
    if (c.cooling) {
      const cu = newCoolingUnit('Климат');
      Object.assign(cu, {
        count: c.cooling.count || 3,
        kwPerUnit: c.cooling.kwPerUnit || 0,
        type: c.cooling.type || 'crac',
        redundancy: c.cooling.redundancy || 'N+1',
        modelRef: c.cooling.modelRef || null,
      });
      c.coolingUnits = [cu];
    } else {
      c.coolingUnits = [newCoolingUnit('Климат')];
    }
    delete c.cooling;
  }
  if (!c.feed) c.feed = {
    tp: { needed: false, kva: 0, redundancy: '2', modelRef: null },
    dgu: { needed: false, kw: 0, mode: 'esp', redundancy: 'N+1', modelRef: null },
  };
  // v0.59.893: миграция МЦОД (если не задано — пустой массив; не подменяем дефолтом)
  if (!Array.isArray(c.mdcBuildings)) c.mdcBuildings = [];
  // v0.59.895: миграция PUE (мягкая — не перезаписывать существующие пользовательские значения)
  if (!c.pue || typeof c.pue !== 'object') c.pue = { mode: 'auto', value: 1.4, manualPue: 1.4 };
  if (typeof c.pue.mode !== 'string') c.pue.mode = 'auto';
  if (typeof c.pue.manualPue !== 'number') c.pue.manualPue = 1.4;
  // v0.59.900: миграция projectData
  if (!c.projectData || typeof c.projectData !== 'object') {
    c.projectData = { designation: '', customer: '', city: '', address: '',
      lat: null, lon: null, stage: 'concept', designer: '', dateOfDesign: '', notes: '' };
  }
  // v0.59.901: миграция coolingSystem (мягко — не перезаписывать пользовательские)
  if (!c.coolingSystem || typeof c.coolingSystem !== 'object') {
    c.coolingSystem = newCoolingSystem();
  } else {
    if (typeof c.coolingSystem.topology !== 'string') c.coolingSystem.topology = 'chiller-fc';
    if (!c.coolingSystem.freeCool) c.coolingSystem.freeCool = { enabled: true, type: 'indirect', tCutoffC: 14 };
    if (typeof c.coolingSystem.setpointTC !== 'number') c.coolingSystem.setpointTC = 22;
    if (typeof c.coolingSystem.deltaTcorridorC !== 'number') c.coolingSystem.deltaTcorridorC = 12;
    if (!c.coolingSystem.chillerSpec) c.coolingSystem.chillerSpec = { ratedCapKw: 0, ratedCOP: 3.5, ambientRated: 35, capCorrPctPerC: -1.5 };
  }
  return v;
}

// ─── Calculations
function calcITTotal(c) {
  // Сумма по всем rack-группам с profile in {it, blade, gpu, storage} (не network)
  return (c.rackGroups || []).reduce((s, rg) => {
    if (rg.profile === 'network') return s; // network — не IT-нагрузка
    return s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
  }, 0);
}
function calcRackGroupKw(rg) {
  return (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
}
function calcMachroomArea(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  return Math.round(N * 2.5 * 1.4);
}
function _upsAvail(us) {
  const count = Number(us.count) || 0;
  const reserve = us.redundancy === 'N+1' ? 1 : (us.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  const kva = Number(us.ratedKva) || 0;
  const cos = Number(us.cosPhi) || 0.95;
  const lf = Number(us.loadFactor) || 0.8;
  return Math.round(N * kva * cos * lf * 10) / 10;
}
function calcUpsByPurpose(c) {
  const out = { it: 0, cooling: 0, mixed: 0, total: 0 };
  for (const us of (c.upsSystems || [])) {
    const kw = _upsAvail(us);
    out[us.purpose || 'it'] = (out[us.purpose || 'it'] || 0) + kw;
    out.total += kw;
  }
  return out;
}
function _coolAvail(cu) {
  const count = Number(cu.count) || 0;
  const reserve = cu.redundancy === 'N+1' ? 1 : (cu.redundancy === '2N' ? Math.floor(count / 2) : 0);
  const N = Math.max(1, count - reserve);
  return Math.round(N * (Number(cu.kwPerUnit) || 0) * 10) / 10;
}
function calcCoolTotal(c) {
  return (c.coolingUnits || []).reduce((s, cu) => s + _coolAvail(cu), 0);
}
function calcFeedTotal(c) {
  const itTotal = calcITTotal(c);
  const climateLoss = itTotal * 0.3;
  const totalNeeded = itTotal + climateLoss;
  const tp = c.feed?.tp?.needed ? Number(c.feed.tp.kva) || 0 : 0;
  return Math.max(totalNeeded, tp * 0.8);
}
function calcAreas(c) {
  const N = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  const upsCount = (c.upsSystems || []).reduce((s, us) => s + (Number(us.count) || 0), 0);
  const upsKvaTotal = (c.upsSystems || []).reduce((s, us) => s + (Number(us.ratedKva) || 0) * (Number(us.count) || 0), 0);
  const hasVrla = (c.upsSystems || []).some(us => us.batteryTech === 'vrla');
  const coolCount = (c.coolingUnits || []).reduce((s, cu) => s + (Number(cu.count) || 0), 0);
  const areas = [
    { name: 'Машзал (стойки)', m2: Math.max(20, Math.round(N * 2.5 * 1.4)) },
    { name: 'ИБП-зал', m2: Math.max(15, Math.round(upsCount * 4)) },
    { name: 'АКБ-зал (VRLA)', m2: hasVrla ? Math.max(10, Math.round(upsKvaTotal * 0.012)) : 0 },
    { name: 'Климат-зал', m2: Math.max(20, Math.round(coolCount * 6)) },
    { name: 'ТП', m2: c.feed.tp.needed ? Math.max(20, Math.round((Number(c.feed.tp.kva) || 0) * 0.025)) : 0 },
    { name: 'ДГУ-зал', m2: c.feed.dgu.needed ? Math.max(30, Math.round((Number(c.feed.dgu.kw) || 0) * 0.04)) : 0 },
    { name: 'Склад', m2: 15 },
    { name: 'Диспетчерская', m2: 12 },
  ].filter(a => a.m2 > 0);
  return areas;
}

// ─── Render: variants list (sidebar)
function renderVariantsList() {
  const root = $('tw-variants-list');
  if (!root) return;
  if (!_variants.length) {
    root.innerHTML = '<div class="muted tw-no-variants">Нет вариантов. Нажмите ➕</div>';
    return;
  }
  root.innerHTML = _variants.map(v => {
    const active = v.id === _activeId ? ' active' : '';
    const primary = v.primary ? ' <span class="tw-badge-primary" title="Основной вариант">⭐</span>' : '';
    const readonly = v.readOnly ? ' <span class="tw-badge-readonly" title="Передан в проектирование">🔒</span>' : '';
    const approved = v.approvedAt ? ' <span class="tw-badge-approved" title="Утверждён ' + new Date(v.approvedAt).toLocaleDateString('ru-RU') + '">✓</span>' : '';
    // v0.60.85 (Phase 36.1): sketch-project link.
    let sketchRow = '';
    if (v.linkedSketchProjectId) {
      const sub = _pid ? listSubProjects(_pid, 'tech-workspace').find(p => p.id === v.linkedSketchProjectId) : null;
      const subName = sub ? (sub.name || sub.designation || sub.id) : '<i>проект удалён</i>';
      sketchRow = `<div class="tw-variant-sketch" title="Sketch-проект для разработки схем (schematic / scs-design / cooling.selections / service.orders) этого варианта концепции.">
        🔗 <a href="../projects/?focus=${escAttr(v.linkedSketchProjectId)}" target="_blank" style="color:#0d8a4e">${escHtml(subName)}</a>
        <button type="button" data-act="open-sketch" data-vid="${v.id}" title="Открыть sketch-проект в новой вкладке (карточка проекта со списком модулей)">↗</button>
      </div>`;
    } else {
      sketchRow = `<div class="tw-variant-sketch tw-variant-sketch-empty" title="Создать sketch-проект для разработки схем этого варианта (отдельная электрическая схема, СКС, cooling-подбор, наряды).">
        <button type="button" class="tw-bind-btn" data-act="create-sketch" data-vid="${v.id}" style="font-size:11px;padding:3px 6px">➕ Sketch-проект для схем</button>
      </div>`;
    }
    // v0.60.136: guard на «✓ Утвердить» — только canApproveVariants.
    // Снять утверждение тоже регулируется этим же permission.
    const canApprove = hasPermission('canApproveVariants');
    let approveBtn = '';
    if (!v.approvedAt) {
      if (canApprove) {
        approveBtn = `<button type="button" data-act="approve" data-vid="${v.id}" title="✓ Утвердить вариант. После утверждения можно генерить итоговый BOM и КП.">✓</button>`;
      } else {
        const role = currentRole();
        const roleLabel = role ? (ROLES[role]?.label || role) : 'не задана';
        approveBtn = `<button type="button" disabled style="opacity:0.4;cursor:not-allowed" title="Утверждение разрешено только 👑 Менеджеру или 🛠 ГИП. Текущая роль: «${escAttr(roleLabel)}».">✓🔒</button>`;
      }
    }
    return `<div class="tw-variant-row${active}" data-vid="${v.id}">
      <span class="tw-variant-name" title="${escAttr(v.name)}">${escHtml(v.name)}</span>
      ${primary}${readonly}${approved}
      <span class="tw-variant-actions">
        ${approveBtn}
        <button type="button" data-act="primary" data-vid="${v.id}" title="Сделать основным">⭐</button>
        <button type="button" data-act="duplicate" data-vid="${v.id}" title="Дублировать">📋</button>
        <button type="button" data-act="delete" data-vid="${v.id}" title="Удалить">🗑</button>
      </span>
      ${sketchRow}
    </div>`;
  }).join('');
}

// ─── Render: bind-button HTML helper
function _bindBtnHtml(domain, refId, modelRef) {
  const has = !!(modelRef && modelRef.id);
  const txt = has
    ? `📦 ${escHtml((modelRef.manufacturer || '') + ' ' + (modelRef.model || ''))} ✏`
    : '📦 Привязать модель…';
  const cls = has ? 'tw-bind-btn tw-bind-btn-bound' : 'tw-bind-btn';
  return `<button type="button" class="${cls}" data-bind-domain="${domain}" data-ref-id="${escAttr(refId)}">${txt}</button>`;
}

// ─── Render: rack group card
// v0.60.114: helper для room picker'а в карточках стоек/ИБП/климата.
// Скрывается если в проекте всего одно помещение (picker излишен).
function _roomPickerHtml(rooms, currentRoomId, isReadOnly, kindHint) {
  const ro = isReadOnly ? 'disabled' : '';
  const list = Array.isArray(rooms) ? rooms : [];
  if (list.length <= 1) {
    const name = list[0]?.name || 'Главный зал';
    return `<label title="Привязка к помещению объекта. Добавить помещения можно в секции «🏠 Помещения» слева.">🏠 Помещение:
      <input type="text" value="${escAttr(name)}" disabled style="background:#f8fafc;color:#475569"></label>`;
  }
  const opts = list.map(r => `<option value="${escAttr(r.id)}"${currentRoomId === r.id ? ' selected' : ''}>${escHtml(r.name || r.id)}</option>`).join('');
  const tip = kindHint === 'ups'
    ? 'В каком помещении стоят ИБП. Могут быть в одном зале со стойками или в отдельной электрощитовой / UPS-room.'
    : 'В каком помещении расположена эта группа стоек.';
  return `<label title="${escAttr(tip)}">🏠 Помещение:
    <select data-field="roomId" ${ro}>${opts}</select>
  </label>`;
}

function renderRackGroupCard(rg, isReadOnly, rooms) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = calcRackGroupKw(rg);
  return `<div class="tw-card" data-card-kind="rack" data-card-id="${rg.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(rg.name)}" placeholder="Название группы" ${ro}>
      <span class="tw-card-summary muted">${rg.count} × ${rg.kwPerRack} кВт = ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить группу" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      ${_roomPickerHtml(rooms, rg.roomId, isReadOnly, 'rack')}
      <label>Кол-во стоек:<input type="number" data-field="count" min="0" step="1" value="${rg.count}" ${ro}></label>
      <label>Мощность на стойку, кВт:<input type="number" data-field="kwPerRack" min="0" step="0.5" value="${rg.kwPerRack}" ${ro}></label>
      <label>Профиль:
        <select data-field="profile" ${ro}>
          <option value="it"${rg.profile === 'it' ? ' selected' : ''}>IT-rack</option>
          <option value="blade"${rg.profile === 'blade' ? ' selected' : ''}>Blade</option>
          <option value="gpu"${rg.profile === 'gpu' ? ' selected' : ''}>GPU-heavy</option>
          <option value="network"${rg.profile === 'network' ? ' selected' : ''}>Network</option>
          <option value="storage"${rg.profile === 'storage' ? ' selected' : ''}>Storage</option>
        </select>
      </label>
      <label>Ширина, мм:<input type="number" data-field="widthMm" min="600" step="100" value="${rg.widthMm}" ${ro}></label>
      <label>Глубина, мм:<input type="number" data-field="depthMm" min="800" step="100" value="${rg.depthMm}" ${ro}></label>
    </div>
    ${_bindBtnHtml('rack', rg.id, rg.modelRef)}
    <!-- v0.60.128: клиренсы и доступ (memory feedback_rack_clearances.md) -->
    <div class="tw-subsection">
      <h5 title="Минимальные расстояния спереди и сзади стойки. По умолчанию ≥ глубины стойки (ASHRAE TC 9.9 / TIA-942: front 1200мм cold aisle, rear 900мм hot aisle). Сзади с двойными дверями допускается до 600 мм. Для стативов (статив с доступом только спереди) выключите «Доступ сзади» — клиренс сзади обнулится.">📐 Клиренсы и доступ</h5>
      <div class="tw-grid">
        <label title="Передний клиренс (cold aisle). Default ASHRAE: 1200 мм. Можно уменьшить до 900 мм для компактных конфигураций — с обоснованием.">⬅ Спереди, мм:
          <input type="number" data-field="frontClearanceMm" min="0" step="100" value="${Number(rg.frontClearanceMm) || 1200}" ${ro || (rg.accessFront === false ? 'disabled' : '')} title="${rg.accessFront === false ? 'Передний доступ выключен — клиренс не нужен' : ''}">
        </label>
        <label title="Задний клиренс (hot aisle). Default TIA-942: 900 мм. Можно уменьшить до 600 мм где двойные двери. 0 = статив прислонён к стене (accessRear=false).">➡ Сзади, мм:
          <input type="number" data-field="rearClearanceMm" min="0" step="100" value="${Number(rg.rearClearanceMm) || 900}" ${ro || (rg.accessRear === false ? 'disabled' : '')} title="${rg.accessRear === false ? 'Задний доступ выключен — статив. Клиренс не нужен.' : ''}">
        </label>
        <label style="display:flex;align-items:center;gap:6px" title="Доступ спереди (для обслуживания cold-aisle). Default true. Снимите для статива с доступом только сзади (редко).">
          <input type="checkbox" data-field="accessFront"${rg.accessFront !== false ? ' checked' : ''} ${ro}>
          Доступ спереди
        </label>
        <label style="display:flex;align-items:center;gap:6px" title="Доступ сзади (для обслуживания hot-aisle / задних разъёмов). По умолчанию ON. Снимите для статива (стенд с доступом только спереди — типично для коммутационного оборудования).">
          <input type="checkbox" data-field="accessRear"${rg.accessRear !== false ? ' checked' : ''} ${ro}>
          Доступ сзади
        </label>
      </div>
      <p class="muted" style="font-size:11px;margin:4px 0 0">📋 Для расчёта плановой площади помещения см. блок «🏠 Помещения» — суммирует footprint × (глубина + клиренсы).</p>
    </div>
    <!-- PDU sub-section внутри группы стоек (юзер: «PDU тоже в рамках стойки конфигурируется») -->
    <div class="tw-subsection">
      <h5>🔌 PDU для этой группы</h5>
      <div class="tw-grid">
        <label>Тип:
          <select data-field="pdu.kind" ${ro}>
            <option value="basic"${rg.pdu.kind === 'basic' ? ' selected' : ''}>Basic</option>
            <option value="metered"${rg.pdu.kind === 'metered' ? ' selected' : ''}>Metered</option>
            <option value="switched"${rg.pdu.kind === 'switched' ? ' selected' : ''}>Switched</option>
            <option value="monitored"${rg.pdu.kind === 'monitored' ? ' selected' : ''}>Monitored</option>
          </select>
        </label>
        <label>Фазность:
          <select data-field="pdu.phases" ${ro}>
            <option value="1ph"${rg.pdu.phases === '1ph' ? ' selected' : ''}>1ф</option>
            <option value="3ph"${rg.pdu.phases === '3ph' ? ' selected' : ''}>3ф</option>
          </select>
        </label>
        <label>Ток на ввод, А:
          <select data-field="pdu.ratingA" ${ro}>
            <option value="16"${rg.pdu.ratingA === 16 ? ' selected' : ''}>16</option>
            <option value="32"${rg.pdu.ratingA === 32 ? ' selected' : ''}>32</option>
            <option value="63"${rg.pdu.ratingA === 63 ? ' selected' : ''}>63</option>
          </select>
        </label>
        <label>Вводов на стойку:
          <select data-field="pdu.inputsPerRack" ${ro}>
            <option value="1"${rg.pdu.inputsPerRack === 1 ? ' selected' : ''}>1</option>
            <option value="2"${rg.pdu.inputsPerRack === 2 ? ' selected' : ''}>2 (N+1 / 2N)</option>
            <option value="4"${rg.pdu.inputsPerRack === 4 ? ' selected' : ''}>4</option>
          </select>
        </label>
      </div>
      ${_bindBtnHtml('pdu', rg.id, rg.pdu.modelRef)}
    </div>
  </div>`;
}

// ─── Render: ups system card
function renderUpsCard(us, isReadOnly, rooms) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = _upsAvail(us);
  // Phase 30.2 (v0.60.69): pre-fill для ups-config wizard.
  // ups-config принимает ?capacityKw в URL → запускает wizard с этим
  // значением loadKw. cosPhi и autonomy тоже передаём для точности.
  const upsPrefillKw = Math.round(kw);  // используем доступную мощность как target
  return `<div class="tw-card" data-card-kind="ups" data-card-id="${us.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(us.name)}" placeholder="Название" ${ro}>
      <span class="tw-card-summary muted">${us.count} × ${us.ratedKva} кВА · доступно ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить систему" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      ${_roomPickerHtml(rooms, us.roomId, isReadOnly, 'ups')}
      <label>Назначение:
        <select data-field="purpose" ${ro}>
          <option value="it"${us.purpose === 'it' ? ' selected' : ''}>⚡ IT-нагрузка</option>
          <option value="cooling"${us.purpose === 'cooling' ? ' selected' : ''}>❄ Климат / кондиционирование</option>
          <option value="mixed"${us.purpose === 'mixed' ? ' selected' : ''}>🔄 Смешанное</option>
        </select>
      </label>
      <label>Кол-во ИБП:<input type="number" data-field="count" min="1" step="1" value="${us.count}" ${ro}></label>
      <label>Номинал, кВА:<input type="number" data-field="ratedKva" min="0" step="50" value="${us.ratedKva}" ${ro}></label>
      <label>Резервирование:
        <select data-field="redundancy" ${ro}>
          <option value="N"${us.redundancy === 'N' ? ' selected' : ''}>N (без резерва)</option>
          <option value="N+1"${us.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
          <option value="2N"${us.redundancy === '2N' ? ' selected' : ''}>2N</option>
        </select>
      </label>
      <label>cos φ:<input type="number" data-field="cosPhi" min="0.5" max="1" step="0.01" value="${us.cosPhi}" ${ro}></label>
      <label>Загрузка, %:<input type="number" data-field="loadFactor" min="20" max="95" step="5" value="${Math.round((us.loadFactor || 0.8) * 100)}" ${ro}></label>
      <label>Автономия, мин:<input type="number" data-field="autonomyMin" min="5" step="5" value="${us.autonomyMin}" ${ro}></label>
      <label>Тип АКБ:
        <select data-field="batteryTech" ${ro}>
          <option value="vrla"${us.batteryTech === 'vrla' ? ' selected' : ''}>VRLA</option>
          <option value="lifepo4"${us.batteryTech === 'lifepo4' ? ' selected' : ''}>Li-Ion (LFP)</option>
        </select>
      </label>
    </div>
    ${_bindBtnHtml('ups', us.id, us.modelRef)}
    <a class="tw-bind-btn" style="text-decoration:none;display:inline-block;margin-left:6px"
       href="../ups-config/?project=${escAttr(_pid || '')}&capacityKw=${upsPrefillKw}&autonomyMin=${us.autonomyMin || 10}&cosPhi=${us.cosPhi || 0.9}&redundancy=${escAttr(us.redundancy || 'N')}&phases=3"
       target="_blank"
       title="Открыть конфигуратор ИБП с pre-filled параметрами этой системы (loadKw=${upsPrefillKw} кВт, autonomy=${us.autonomyMin || 10} мин, cos φ=${us.cosPhi || 0.9}, ${us.redundancy || 'N'}). Wizard запустится автоматически. После подбора можете вернуться и нажать «↩ Применить» (v0.60.89).">
      ⚙ Подобрать в ups-config →
    </a>
    ${(() => {
      // v0.60.89 (Phase 30.2 PULL): читаем selected UPS из ups-config bridge.
      const sel = _readUpsSelected();
      if (!sel || !sel.supplier || !sel.model) return '';
      const cur = us.modelRef || {};
      const sameAsCur = cur.manufacturer === sel.supplier && cur.model === sel.model;
      if (sameAsCur) return '';
      return `<button type="button" class="tw-bind-btn" data-tw-action="apply-ups-selected" data-ups-id="${escAttr(us.id)}"
        ${ro ? 'disabled' : ''}
        style="background:#dcfce7;border-color:#16a34a;color:#15803d;margin-left:6px"
        title="Применить ${escAttr(sel.supplier)} ${escAttr(sel.model)} (${sel.capacityKw} кВт) из ups-config к этой системе. Сохранено там ${ageHint(sel.ts)}.">
        ↩ Применить ${escHtml(sel.supplier)} ${escHtml(sel.model)} из ups-config
      </button>`;
    })()}
  </div>`;
}

// Phase 30.2 PULL helper (v0.60.89): читает selected UPS из LS-bridge.
function _readUpsSelected() {
  if (!_pid) return null;
  try {
    const raw = localStorage.getItem(projectKey(_pid, 'ups-config', 'selected.v1'));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ─── Render: cooling unit card
// v0.60.114: scope picker (room|shared) + room/rooms picker.
//   'room'   — закреплён за одним залом (CRAC/InRow per room) → roomId.
//   'shared' — обслуживает несколько залов (chiller-plant, AHU) → roomIds[].
function renderCoolCard(cu, isReadOnly, rooms) {
  const ro = isReadOnly ? 'disabled' : '';
  const kw = _coolAvail(cu);
  const list = Array.isArray(rooms) ? rooms : [];
  const scope = cu.scope || 'room';
  // Scope-specific picker
  let scopePickerHtml = '';
  if (list.length > 0) {
    if (scope === 'shared') {
      const ids = Array.isArray(cu.roomIds) ? cu.roomIds : [];
      const checks = list.map(r => {
        const checked = ids.includes(r.id);
        return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12.5px;margin-right:10px"><input type="checkbox" data-cool-room-toggle="${escAttr(r.id)}"${checked ? ' checked' : ''} ${ro}> ${escHtml(r.name || r.id)}</label>`;
      }).join('');
      scopePickerHtml = `<div style="grid-column:1/-1" title="Какие помещения обслуживает эта общая система. Например, чиллер-плант на крыше может обслуживать все залы стоек одновременно.">
        <div style="font-size:11.5px;color:#475569;margin-bottom:4px">🏠 Обслуживает помещения:</div>
        <div>${checks || '<span class="muted">(нет помещений)</span>'}</div>
      </div>`;
    } else {
      const opts = list.map(r => `<option value="${escAttr(r.id)}"${cu.roomId === r.id ? ' selected' : ''}>${escHtml(r.name || r.id)}</option>`).join('');
      scopePickerHtml = `<label title="В каком помещении установлен этот кондиционер. CRAC/InRow обычно стоит в самом IT-зале.">🏠 Помещение:
        <select data-field="roomId" ${ro}>${opts}</select>
      </label>`;
    }
  }
  return `<div class="tw-card" data-card-kind="cool" data-card-id="${cu.id}">
    <div class="tw-card-head">
      <input type="text" class="tw-card-name" data-field="name" value="${escAttr(cu.name)}" placeholder="Название" ${ro}>
      <span class="tw-card-summary muted">${cu.count} × ${cu.kwPerUnit} кВт холода · доступно ${kw.toFixed(1)} кВт</span>
      <button type="button" class="tw-card-del" data-card-action="delete" title="Удалить" ${ro}>×</button>
    </div>
    <div class="tw-grid">
      <label title="Зона обслуживания: «В помещении» — CRAC/InRow закреплён за одним залом. «Общая» — chiller-plant/AHU обслуживает несколько залов.">📍 Зона обслуживания:
        <select data-field="scope" ${ro}>
          <option value="room"${scope === 'room' ? ' selected' : ''}>В помещении (CRAC/InRow per room)</option>
          <option value="shared"${scope === 'shared' ? ' selected' : ''}>Общая (chiller-plant, AHU)</option>
        </select>
      </label>
      ${scopePickerHtml}
      <label>Кол-во кондиционеров:<input type="number" data-field="count" min="1" step="1" value="${cu.count}" ${ro}></label>
      <label>Холод на единицу, кВт:<input type="number" data-field="kwPerUnit" min="0" step="5" value="${cu.kwPerUnit}" ${ro}></label>
      <label>Тип:
        <select data-field="type" ${ro}>
          <option value="crac"${cu.type === 'crac' ? ' selected' : ''}>CRAC (downflow)</option>
          <option value="inrow"${cu.type === 'inrow' ? ' selected' : ''}>In-Row</option>
          <option value="fancoil"${cu.type === 'fancoil' ? ' selected' : ''}>Fan-coil</option>
          <option value="freecool"${cu.type === 'freecool' ? ' selected' : ''}>Free cooling</option>
        </select>
      </label>
      <label>Резервирование:
        <select data-field="redundancy" ${ro}>
          <option value="N"${cu.redundancy === 'N' ? ' selected' : ''}>N</option>
          <option value="N+1"${cu.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
          <option value="2N"${cu.redundancy === '2N' ? ' selected' : ''}>2N</option>
        </select>
      </label>
    </div>
    ${_bindBtnHtml('cool', cu.id, cu.modelRef)}
  </div>`;
}

// ─── Render: feed (TP/DGU)
// v0.60.90 (Пользователь 2026-05-03 «для ТП и ДГУ сделать авто подбор по
// параметрам нагрузки»): рассчитываем рекомендуемые значения и показываем
// рядом с input полем + кнопка «🪄 Авто» для применения.
function _suggestTpKva(c) {
  // ТП кормит весь объект: IT + ИБП-loss + cooling + aux. Используем
  // calcFeedTotal() который уже учитывает 30% общую коррекцию.
  // cos φ ≈ 0.9 для типичной нагрузки → kVA = kW / cos.
  const kw = calcFeedTotal(c);
  const cos = 0.9;
  const kva = kw / cos;
  // С запасом 25% и округлением вверх до 100 кВА.
  return Math.ceil(kva * 1.25 / 100) * 100;
}
function _suggestDguKw(c, mode = 'esp') {
  // ДГУ кормит критическую нагрузку: IT (через ИБП) + cooling. Aux/hum
  // обычно не на ДГУ.
  const itKw = calcITTotal(c);
  const coolKw = calcCoolTotal(c);
  const upsByPurpose = calcUpsByPurpose(c);
  // ИБП-кВт for IT + 25% efficiency loss
  const upsItKw = (upsByPurpose.it + upsByPurpose.mixed) * 1.05;
  // Базовая нагрузка на ДГУ:
  const baseLoadKw = upsItKw + coolKw;
  // Mode-derate (ISO 8528-1 PRP allows 70% nameplate sustained):
  const modeFactor = mode === 'prp' ? 0.70 : 1.0;
  // С запасом 15%
  const requiredKw = baseLoadKw * 1.15 / modeFactor;
  // Округление вверх до 50 кВт
  return Math.ceil(requiredKw / 50) * 50;
}

function renderFeedSection(feed, isReadOnly, concept) {
  const ro = isReadOnly ? 'disabled' : '';
  // v0.60.90: расчёт рекомендуемых.
  const suggestTp = concept ? _suggestTpKva(concept) : 0;
  const suggestDgu = concept ? _suggestDguKw(concept, feed.dgu.mode || 'esp') : 0;
  const tpHasManual = Number(feed.tp.kva) > 0 && Number(feed.tp.kva) !== suggestTp;
  const dguHasManual = Number(feed.dgu.kw) > 0 && Number(feed.dgu.kw) !== suggestDgu;
  const tpAutoBadge = suggestTp > 0
    ? `<span class="tw-auto-badge" title="Авто-подбор по нагрузке концепции (Σ принятая кВт / cos φ × 1.25 запас, округление до 100 кВА).">🪄 Авто: ${suggestTp} кВА</span>
       ${(Number(feed.tp.kva) === 0 || tpHasManual) ? `<button type="button" class="tw-auto-apply" data-tw-action="apply-tp-auto" ${ro} title="Применить авто-расчёт ${suggestTp} кВА">✓</button>` : ''}`
    : '';
  const dguAutoBadge = suggestDgu > 0
    ? `<span class="tw-auto-badge" title="Авто-подбор по нагрузке концепции: ИБП IT (с 5% потерями) + Холод, режим ${(feed.dgu.mode || 'esp').toUpperCase()} (load factor ${feed.dgu.mode === 'prp' ? '70%' : '100%'}), запас 15%, округление до 50 кВт.">🪄 Авто: ${suggestDgu} кВт</span>
       ${(Number(feed.dgu.kw) === 0 || dguHasManual) ? `<button type="button" class="tw-auto-apply" data-tw-action="apply-dgu-auto" ${ro} title="Применить авто-расчёт ${suggestDgu} кВт">✓</button>` : ''}`
    : '';
  return `<div class="tw-grid">
    <label class="tw-checkbox"><input type="checkbox" data-field="tp.needed"${feed.tp.needed ? ' checked' : ''} ${ro}> ТП требуется</label>
    <label>Мощность ТП, кВА:
      <input type="number" data-field="tp.kva" min="0" step="100" value="${feed.tp.kva}" ${ro}>
      ${tpAutoBadge}
    </label>
    <label>Резервирование ТП:
      <select data-field="tp.redundancy" ${ro}>
        <option value="1"${feed.tp.redundancy === '1' ? ' selected' : ''}>1 ввод</option>
        <option value="2"${feed.tp.redundancy === '2' ? ' selected' : ''}>2 ввода</option>
        <option value="2-avr"${feed.tp.redundancy === '2-avr' ? ' selected' : ''}>2 ввода + АВР</option>
      </select>
    </label>
    <label class="tw-checkbox"><input type="checkbox" data-field="dgu.needed"${feed.dgu.needed ? ' checked' : ''} ${ro}> ДГУ требуется</label>
    <label>Мощность ДГУ, кВт:
      <input type="number" data-field="dgu.kw" min="0" step="100" value="${feed.dgu.kw}" ${ro}>
      ${dguAutoBadge}
    </label>
    <label title="Режимы по ISO 8528-1 (общие) + ISO 8528-13 (ЦОД). От режима зависит max load factor для расчёта мощности и допустимое время работы. Полный список см. в dgu-config модуле.">Режим ДГУ:
      <select data-field="dgu.mode" ${ro}>
        <optgroup label="Общие (ISO 8528-1)">
          <option value="esp"${(feed.dgu.mode || 'esp').toLowerCase() === 'esp' ? ' selected' : ''} title="Emergency Standby. ≤200 ч/год, без перегрузки.">ESP — аварийный</option>
          <option value="prp"${(feed.dgu.mode || '').toLowerCase() === 'prp' ? ' selected' : ''} title="Prime Power. Средняя ≤70% nameplate, без лимита часов.">PRP — основной</option>
          <option value="ltp"${(feed.dgu.mode || '').toLowerCase() === 'ltp' ? ' selected' : ''} title="Limited-Time Prime. До 500 ч/год при 100% нагрузке.">LTP — ограниченный</option>
          <option value="cop"${(feed.dgu.mode || '').toLowerCase() === 'cop' ? ' selected' : ''} title="Continuous Operating. 24/7 при 100%.">COP — непрерывный</option>
        </optgroup>
        <optgroup label="ЦОД (ISO 8528-13)">
          <option value="dcc"${(feed.dgu.mode || '').toLowerCase() === 'dcc' ? ' selected' : ''} title="Data Centre Continuous. 24/7 для IT, запуск ≤10 сек.">DCC — ЦОД непрерывный</option>
          <option value="dcp"${(feed.dgu.mode || '').toLowerCase() === 'dcp' ? ' selected' : ''} title="Data Centre Prime. Средняя ≤85% nameplate.">DCP — ЦОД основной</option>
          <option value="dcs"${(feed.dgu.mode || '').toLowerCase() === 'dcs' ? ' selected' : ''} title="Data Centre Standby. Резерв ЦОД с запуском ≤10 сек.">DCS — ЦОД резервный</option>
          <option value="mcsp"${(feed.dgu.mode || '').toLowerCase() === 'mcsp' ? ' selected' : ''} title="Mission Critical Standby. Tier IV / критические объекты.">MCSP — критический резерв</option>
        </optgroup>
      </select>
    </label>
    <label>Резервирование ДГУ:
      <select data-field="dgu.redundancy" ${ro}>
        <option value="none"${feed.dgu.redundancy === 'none' ? ' selected' : ''}>Нет</option>
        <option value="N+1"${feed.dgu.redundancy === 'N+1' ? ' selected' : ''}>N+1</option>
        <option value="2N"${feed.dgu.redundancy === '2N' ? ' selected' : ''}>2N</option>
      </select>
    </label>
  </div>
  <div class="tw-summary">
    <button type="button" class="tw-bind-btn ${feed.tp.modelRef ? 'tw-bind-btn-bound' : ''}" data-bind-domain="tp" data-ref-id="feed-tp">📦 ${feed.tp.modelRef ? escHtml((feed.tp.modelRef.manufacturer || '') + ' ' + (feed.tp.modelRef.model || '')) + ' ✏' : 'Привязать модель ТП'}</button>
    <button type="button" class="tw-bind-btn ${feed.dgu.modelRef ? 'tw-bind-btn-bound' : ''}" data-bind-domain="dgu" data-ref-id="feed-dgu">📦 ${feed.dgu.modelRef ? escHtml((feed.dgu.modelRef.manufacturer || '') + ' ' + (feed.dgu.modelRef.model || '')) + ' ✏' : 'Привязать модель ДГУ'}</button>
    ${feed.dgu.needed ? `
      <a class="tw-bind-btn" style="text-decoration:none"
         href="../dgu-config/?project=${escAttr(_pid || '')}&capacityKw=${Math.round(Number(feed.dgu.kw) || 0)}&mode=${escAttr((feed.dgu.mode || 'prp').toUpperCase())}&redundancy=${escAttr(feed.dgu.redundancy === 'none' ? 'N' : feed.dgu.redundancy)}&autonomy=${feed.dgu.autonomyHours || 24}"
         target="_blank"
         title="Открыть ДГУ-конфигуратор с pre-filled параметрами концепции (мощность ${Math.round(Number(feed.dgu.kw) || 0)} кВт, режим ${(feed.dgu.mode || 'prp').toUpperCase()}, ${feed.dgu.redundancy}). Расчёт по ISO 8528-1 + climate derate + подбор из каталога Caterpillar/Cummins/Volvo/FG Wilson.">
        ⚙ Подобрать ДГУ →
      </a>
    ` : ''}
    ${(() => {
      // Phase 30.3 PULL (v0.60.82): читаем выбранную ДГУ модель из dgu-config.
      // Если модель свежее (< 1 час) и отличается от concept.feed.dgu.modelRef —
      // показываем кнопку «↩ Применить из dgu-config».
      const sel = _readDguSelected();
      if (!sel || !sel.vendor || !sel.model) return '';
      const cur = feed.dgu.modelRef || {};
      const sameAsCur = cur.manufacturer === sel.vendor && cur.model === sel.model;
      if (sameAsCur) return '';
      return `<button type="button" class="tw-bind-btn" data-tw-action="apply-dgu-selected" ${ro ? 'disabled' : ''}
        style="background:#dcfce7;border-color:#16a34a;color:#15803d"
        title="Применить ${escAttr(sel.vendor)} ${escAttr(sel.model)} (${sel.nameplateKw} кВт) из dgu-config к концепции. Сохранено там ${ageHint(sel.ts)}.">
        ↩ Применить ${escHtml(sel.vendor)} ${escHtml(sel.model)} из dgu-config
      </button>`;
    })()}
  </div>`;
}

// Phase 30.3 PULL helper: читает selected DGU из LS-bridge dgu-config.
function _readDguSelected() {
  if (!_pid) return null;
  try {
    const raw = localStorage.getItem(projectKey(_pid, 'dgu-config', 'selected.v1'));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function ageHint(ts) {
  if (!ts) return 'давно';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return 'только что';
  if (sec < 3600) return Math.round(sec / 60) + ' мин назад';
  if (sec < 86400) return Math.round(sec / 3600) + ' ч назад';
  return Math.round(sec / 86400) + ' дн назад';
}

// ─── Render: compare mode (multi-variant side-by-side, Phase 20.10)
function renderCompareMode() {
  const pane = $('tw-mode-compare');
  if (!pane) return;
  if (_variants.length === 0) {
    pane.innerHTML = '<div class="tw-empty-state"><div><h3>Нет вариантов</h3><p class="muted">Создайте 2+ варианта в левой панели для сравнения.</p></div></div>';
    return;
  }
  // Build rows: each метрика — строка, варианты — колонки
  const rows = [
    { label: '⭐ Основной', get: v => v.primary ? '★' : '' },
    { label: '🔒 Передан в проектирование', get: v => v.readOnly ? `да (${new Date(v.handoffAt || 0).toLocaleDateString()})` : 'нет' },
    { label: '— Стойки —', isHeader: true },
    { label: 'Кол-во групп стоек', get: v => (v.concept.rackGroups || []).length },
    { label: 'Σ стоек', get: v => (v.concept.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0) },
    { label: 'Σ IT-нагрузка, кВт', get: v => calcITTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— ИБП —', isHeader: true },
    { label: 'Кол-во систем ИБП', get: v => (v.concept.upsSystems || []).length },
    { label: 'Σ ИБП IT доступно, кВт', get: v => {
      const u = calcUpsByPurpose(v.concept);
      return (u.it + u.mixed).toFixed(1);
    }, highlight: 'kw' },
    { label: 'Σ ИБП климат доступно, кВт', get: v => {
      const u = calcUpsByPurpose(v.concept);
      return (u.cooling + u.mixed).toFixed(1);
    } },
    { label: '— Климат —', isHeader: true },
    { label: 'Кол-во групп кондиц.', get: v => (v.concept.coolingUnits || []).length },
    { label: 'Σ холод доступен, кВт', get: v => calcCoolTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— Ввод —', isHeader: true },
    { label: 'ТП', get: v => v.concept.feed?.tp?.needed ? `${v.concept.feed.tp.kva} кВА` : '—' },
    { label: 'ДГУ', get: v => v.concept.feed?.dgu?.needed ? `${v.concept.feed.dgu.kw} кВт (${v.concept.feed.dgu.mode})` : '—' },
    { label: 'Σ принятая мощность, кВт', get: v => calcFeedTotal(v.concept).toFixed(1), highlight: 'kw' },
    { label: '— Площади —', isHeader: true },
    { label: 'Σ площадь, м²', get: v => calcAreas(v.concept).reduce((s, a) => s + a.m2, 0), highlight: 'm2' },
  ];
  // Find max for highlighting
  const maxBy = {};
  for (const r of rows) {
    if (!r.highlight) continue;
    const vals = _variants.map(v => Number(r.get(v)) || 0);
    maxBy[r.label] = Math.max(...vals);
  }
  pane.innerHTML = `<div class="tw-compare-wrap">
    <div class="tw-compare-toolbar">
      <span class="muted">Сравнение ${_variants.length} вариантов. Лучшие значения подсвечены зелёным (где больше = лучше).</span>
    </div>
    <table class="tw-compare-table">
      <thead>
        <tr>
          <th class="tw-compare-metric">Параметр</th>
          ${_variants.map(v => `<th class="tw-compare-variant${v.id === _activeId ? ' active' : ''}">${escHtml(v.name)}${v.primary ? ' ⭐' : ''}${v.readOnly ? ' 🔒' : ''}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          if (r.isHeader) {
            return `<tr class="tw-compare-section-row"><td colspan="${_variants.length + 1}">${escHtml(r.label)}</td></tr>`;
          }
          return `<tr>
            <td class="tw-compare-metric">${escHtml(r.label)}</td>
            ${_variants.map(v => {
              const val = r.get(v);
              const num = Number(val);
              const isBest = r.highlight && Number.isFinite(num) && num === maxBy[r.label] && num > 0;
              return `<td class="tw-compare-cell${isBest ? ' best' : ''}">${escHtml(val == null ? '—' : val)}</td>`;
            }).join('')}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

// v0.59.892: Helpers для left-rail
function _blockKey(kind, id) { return id ? `${kind}:${id}` : kind; }
function _ensureSelectedBlock(c) {
  // Если selected пустой или указывает на удалённый объект — выбрать первый rack-group
  if (_selectedBlock) {
    const { kind, id } = _selectedBlock;
    if (kind === 'rack' && (c.rackGroups || []).some(rg => rg.id === id)) return;
    if (kind === 'ups' && (c.upsSystems || []).some(us => us.id === id)) return;
    if (kind === 'cool' && (c.coolingUnits || []).some(cu => cu.id === id)) return;
    if (kind === 'mdc' && (c.mdcBuildings || []).some(b => b.id === id)) return;
    if (kind === 'room' && (c.rooms || []).some(r => r.id === id)) return;
    if (kind === 'project' || kind === 'feed' || kind === 'areas' || kind === 'pue' || kind === 'bom' || kind === 'coolsys') return;
  }
  if ((c.rackGroups || []).length) {
    _selectedBlock = { kind: 'rack', id: c.rackGroups[0].id };
  } else {
    _selectedBlock = { kind: 'feed', id: null };
  }
}

// v0.59.901 (расширенный Etap D): PUE авто-расчёт с учётом топологии охлаждения.
//   PUE_auto = 1 + (P_cooling + P_losses) / P_IT
// P_cooling зависит от:
//   1. Топология (chiller-fc / chiller / dx / adiabatic / immersion)
//   2. Freecool настроек (enabled, type, tCutoff °C)
//   3. Климата (доля часов T < tCutoff из meteo)
//   4. Chiller spec (ratedCOP) если задан, иначе типовой COP
//
// Без meteo — fallback по среднестатистическому климату умеренной полосы.
// Без coolingSystem — fallback к v0.59.895 формуле.

const TOPOLOGY_DEFAULTS = {
  // [defaultCop, fcCopBoost, hasFreeCool, baseLossPct, label]
  'chiller-fc':  { copBase: 3.5, copFC: 15.0, hasFC: true,  baseLossPct: 10, label: 'Чиллер с фрикулингом' },
  'chiller':     { copBase: 3.5, copFC: 0,    hasFC: false, baseLossPct: 10, label: 'Чиллер без фрикулинга' },
  'dx':          { copBase: 3.0, copFC: 0,    hasFC: false, baseLossPct: 10, label: 'DX (прямое расш., конденсаторы)' },
  'adiabatic':   { copBase: 4.0, copFC: 25.0, hasFC: true,  baseLossPct: 9,  label: 'Адиабатический freecool' },
  'immersion':   { copBase: 8.0, copFC: 0,    hasFC: false, baseLossPct: 8,  label: 'Погружное охлаждение' },
};

/* v0.60.63 (Phase 30.4): comprehensive breakdown defaults — раскладываем
   старый topo.baseLossPct (5–10%) на физически осмысленные компоненты:
   UPS_loss = (1 − η_ups) × P_IT, типичный η = 96% online double-conversion;
   TP_loss = (1 − η_tp) × (P_IT + P_cool), типичный η = 99% масляный 1000 кВА;
   Aux = aux_pct × P_IT (освещение, безопасность, мониторинг);
   Sum ≈ старый baseLossPct, но теперь видно где сколько уходит. */
const PUE_LOSS_DEFAULTS = {
  upsEfficiency: 0.96,   // 96% online (типовой transformerless modular)
  tpEfficiency:  0.99,   // 99% масляный distribution-transformer
  auxFraction:   0.02,   // 2% от IT (освещение, БСК, ПОЖ-СС, СКУД-CCTV, серверы мониторинга)
};

/**
 * Phase 30.4: расчёт PUE с per-component breakdown.
 * Возвращает { pue, breakdown: { itKw, coolKwAvg, upsLossKw, tpLossKw, auxKw, freecoolFraction } }.
 * calcPueAuto обёрнут — возвращает только число (для backward-compat).
 */
function calcPueAutoBreakdown(c, meteoSummary) {
  const itKw = calcITTotal(c);
  if (itKw <= 0) {
    return { pue: 1.4, breakdown: { itKw: 0, coolKwAvg: 0, upsLossKw: 0, tpLossKw: 0, auxKw: 0, freecoolFraction: 0 } };
  }

  const cs = c.coolingSystem || newCoolingSystem();
  const topo = TOPOLOGY_DEFAULTS[cs.topology] || TOPOLOGY_DEFAULTS['chiller-fc'];
  const fc = cs.freeCool || { enabled: false, type: 'none', tCutoffC: 14 };
  const fcEnabled = topo.hasFC && fc.enabled;
  const tCut = Number(fc.tCutoffC) || 14;

  let freecoolFraction = 0;
  if (fcEnabled) {
    if (meteoSummary?.stats?.n) {
      const hourly = meteoSummary.hourly || [];
      if (hourly.length > 0) {
        const fcHours = hourly.filter(h => Number.isFinite(Number(h.T)) && Number(h.T) < tCut).length;
        freecoolFraction = fcHours / Math.max(1, hourly.length);
      } else {
        freecoolFraction = (meteoSummary.stats.freecoolHours || 0) / Math.max(1, meteoSummary.stats.n);
      }
    } else {
      freecoolFraction = 0.55;
    }
  }

  const copBase = (cs.chillerSpec && Number(cs.chillerSpec.ratedCOP) > 0)
    ? Number(cs.chillerSpec.ratedCOP)
    : topo.copBase;
  const copFC = topo.copFC || 15;
  const fcTypeFactor = ({ direct: 1.0, indirect: 0.85, glycol: 0.75, none: 0 }[fc.type]) || 1.0;
  const effectiveCopFC = copFC * fcTypeFactor;

  let coolKwAvg;
  if (fcEnabled && freecoolFraction > 0 && effectiveCopFC > 0) {
    coolKwAvg = itKw * (
      freecoolFraction / effectiveCopFC +
      (1 - freecoolFraction) / copBase
    );
  } else {
    coolKwAvg = itKw / copBase;
  }

  // Per-component breakdown (Phase 30.4):
  // - UPS-потери: ИБП кормит только IT-нагрузку (cooling питается напрямую от секции).
  //   η_ups = доля КПД (override через c.pue.upsEfficiency, иначе default 96%).
  const etaUps = Number(c.pue?.upsEfficiency) || PUE_LOSS_DEFAULTS.upsEfficiency;
  const upsLossKw = itKw * (1 / etaUps - 1);  // = itKw × (1 − η)/η
  // - TP-потери (понижающий трансформатор): кормит ВСЁ — IT + cooling + aux.
  const etaTp = Number(c.pue?.tpEfficiency) || PUE_LOSS_DEFAULTS.tpEfficiency;
  const auxFraction = Number(c.pue?.auxFraction) || PUE_LOSS_DEFAULTS.auxFraction;
  const auxKw = itKw * auxFraction;
  // TP кормит итог = IT + cool + aux + ups_loss → потери = (1 − η)/η × этот итог.
  const downstreamKw = itKw + coolKwAvg + auxKw + upsLossKw;
  const tpLossKw = downstreamKw * (1 / etaTp - 1);

  const totalNonItKw = coolKwAvg + upsLossKw + tpLossKw + auxKw;
  const pue = 1 + totalNonItKw / itKw;
  return {
    pue: Math.round(pue * 100) / 100,
    breakdown: {
      itKw, coolKwAvg, upsLossKw, tpLossKw, auxKw, totalNonItKw,
      freecoolFraction,
      etaUps, etaTp, auxFraction,
    },
  };
}

function calcPueAuto(c, meteoSummary) {
  return calcPueAutoBreakdown(c, meteoSummary).pue;
}
function calcPue(c, meteoSummary) {
  if (!c.pue) return 1.4;
  if (c.pue.mode === 'manual') return Number(c.pue.manualPue) || 1.4;
  // v0.60.3 (Phase 22.4): mode='cooling-module' — берём годовое
  // потребление из активного подбора /cooling/ проекта и считаем PUE
  // по реальной топологии (chillers + CRAC + free-cooling + redundancy).
  if (c.pue.mode === 'cooling-module') {
    const v = calcPueFromCoolingModule(c, meteoSummary);
    if (Number.isFinite(v) && v > 0) return v;
    // Fallback на auto если cooling-module недоступен.
    return calcPueAuto(c, meteoSummary);
  }
  return calcPueAuto(c, meteoSummary);
}

/**
 * v0.60.3 (Phase 22.4): Расчёт PUE по реальному cooling-подбору проекта.
 *
 * Алгоритм:
 *   1. Читаем cooling.selections.v1 + activeSelectionId.v1 текущего проекта.
 *   2. Берём mainOptionId варианта активного подбора.
 *   3. Если есть ★-вариант с topology — simulateTopology(topo, hourly).
 *   4. Иначе одиночный вариант — buildBinData(hourly, option.spec).
 *   5. Annual cooling energy [кВт·ч/год] / 8760 = avg P_cool [кВт].
 *   6. PUE = 1 + (avg P_cool + lossesKw) / IT_kw.
 *
 * Если данных недостаточно — возвращает null (caller фолбэкнется на auto).
 */
function calcPueFromCoolingModule(c, meteoSummary) {
  try {
    const itKw = calcITTotal(c);
    if (itKw <= 0) return null;
    const pid = (typeof window.activeProject === 'function') ? window.activeProject() : null;
    // Используем глобальный helper если есть; иначе ensureDefaultProject из импорта
    const projectId = pid?.id || (window._activeProjectId || ensureDefaultProject()?.id);
    if (!projectId) return null;
    const selsRaw = localStorage.getItem(`raschet.project.${projectId}.cooling.selections.v1`);
    const sels = selsRaw ? JSON.parse(selsRaw) : [];
    if (!sels.length) return null;
    const activeRaw = localStorage.getItem(`raschet.project.${projectId}.cooling.activeSelectionId.v1`);
    const activeId = activeRaw ? JSON.parse(activeRaw) : null;
    const sel = sels.find(s => s.id === activeId) || sels[0];
    if (!sel || !sel.options?.length) return null;
    const main = sel.options.find(o => o.id === sel.mainOptionId) || sel.options[0];
    const hourly = meteoSummary?.hourly || [];
    if (!hourly.length) return null;

    // Динамически импортируем calc-слой cooling.
    // (Tech-workspace не может использовать ESM-import top-level — он не модуль;
    // используем dynamic import + cached promise.)
    if (!window._coolingCalcPromise) {
      window._coolingCalcPromise = Promise.all([
        import('../cooling/calc/chiller-bin-calc.js'),
        import('../cooling/calc/topology.js'),
      ]).then(([bin, topo]) => ({ ...bin, ...topo }));
    }
    // Так как calcPue — синхронная, используем результат если уже загружен,
    // иначе fallback. Dynamic import всегда даст результат при следующем render.
    const calc = window._coolingCalcCache;
    if (!calc) {
      window._coolingCalcPromise.then(c => {
        window._coolingCalcCache = c;
        // Триггер ре-render через render() если он экспортирован.
        if (typeof render === 'function') try { render(); } catch {}
      });
      return null;
    }

    let annualEnergyKwh = 0;
    // v0.60.17: новая модель cooling — option имеет equipment[] с per-group
    // qty/N/M/standbyMode. Используем simulateOptionTopology(option, hourly).
    // Backward-compat: если у option ещё нет equipment[] (legacy), fallback
    // на одиночный buildBinData(spec).
    if (calc.simulateOptionTopology && Array.isArray(main.equipment) && main.equipment.length) {
      // v0.60.21: передаём requiredCoolingKw из selection.general для случая
      // chiller-only системы (без CRAC) — иначе нагрузка = 0.
      const reqKw = sel?.general
        ? (Number(sel.general.requiredCoolingKw) || 0) * (1 + (Number(sel.general.safetyMarginPct) || 0) / 100)
        : 0;
      const m = calc.simulateOptionTopology(main, hourly, reqKw);
      annualEnergyKwh = m.totalEnergyKwh;
    } else if (calc.simulateTopology && sel.topology && sel.options.some(o => calc.isCracType ? calc.isCracType(o.spec?.systemType) : false)) {
      // Legacy путь — selection-level topology + per-option spec
      const topo = calc.buildTopologyFromOptions(
        sel.options,
        sel.topology.loopMode,
        sel.topology.redundancyN,
        sel.topology.redundancyM,
        sel.topology.standbyMode,
      );
      const m = calc.simulateTopology(topo, hourly);
      annualEnergyKwh = m.totalEnergyKwh;
    } else {
      const rows = calc.buildBinData(hourly, main.spec || main.equipment?.[0]?.spec);
      annualEnergyKwh = rows.reduce((a, r) => a + (r.energy || 0), 0);
    }

    const avgCoolKw = annualEnergyKwh / 8760;
    const cs = c.coolingSystem || newCoolingSystem();
    const lossPct = (TOPOLOGY_DEFAULTS[cs.topology] || TOPOLOGY_DEFAULTS['chiller-fc']).baseLossPct;
    const lossesKw = itKw * (lossPct / 100);
    const pue = 1 + (avgCoolKw + lossesKw) / itKw;
    return Math.round(pue * 100) / 100;
  } catch (e) {
    console.warn('[calcPueFromCoolingModule]', e);
    return null;
  }
}

// v0.59.893: чтение summary из mdc-config sub-project. mdc-config хранит
// in-memory state в LS под ключом raschet.mdc-config.v1, который scoped
// к active project. tech-workspace читает свежий снимок при каждом render
// (через project-storage projectKey + sub pid).
function _readMdcSummary(subPid) {
  if (!subPid) return null;
  try {
    const raw = localStorage.getItem(projectKey(subPid, 'mdc-config', 'v1'));
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      totalRacks: Number(s.totalRacks) || 0,
      rackKw: Number(s.rackKw) || 0,
      itKw: (Number(s.totalRacks) || 0) * (Number(s.rackKw) || 0),
      redundancy: s.redundancy || 'N+1',
      withDgu: !!s.withDgu, withTp: !!s.withTp,
      ashrae: s.ashrae || 'A2',
    };
  } catch { return null; }
}

function renderListRail(c, ro) {
  const itKw = calcITTotal(c);
  const upsByPurpose = calcUpsByPurpose(c);
  const coolKw = calcCoolTotal(c);
  const feedKw = calcFeedTotal(c);
  const areas = calcAreas(c);
  const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
  const sel = _selectedBlock || { kind: 'rack', id: null };

  const _selCls = (kind, id) => (sel.kind === kind && (sel.id || null) === (id || null)) ? ' active' : '';
  const _kvtChip = (kw) => `<span class="tw-rail-chip">${kw.toFixed(1)} кВт</span>`;
  const _redChip = (txt) => `<span class="tw-rail-chip tw-rail-chip-warn">${txt}</span>`;

  const rackRows = (c.rackGroups || []).map(rg => {
    const kw = calcRackGroupKw(rg);
    const profileLbl = ({ 'it': 'IT', 'blade': 'Blade', 'gpu': 'GPU', 'network': 'Net', 'storage': 'Stor' }[rg.profile]) || rg.profile;
    const sub = `${rg.count} × ${rg.kwPerRack} кВт · ${profileLbl}`;
    return `<button type="button" class="tw-rail-item${_selCls('rack', rg.id)}" data-bk="rack" data-bid="${escAttr(rg.id)}">
      <span class="tw-rail-name">${escHtml(rg.name || 'Группа стоек')}</span>
      <span class="tw-rail-sub">${sub}</span>
      ${_kvtChip(kw)}
    </button>`;
  }).join('');

  const upsRows = (c.upsSystems || []).map(us => {
    const kw = _upsAvail(us);
    const purp = ({ 'it': '⚡', 'cooling': '❄', 'mixed': '🔄' }[us.purpose]) || '⚡';
    const sub = `${purp} ${us.count} × ${us.ratedKva} кВА · ${us.redundancy}`;
    return `<button type="button" class="tw-rail-item${_selCls('ups', us.id)}" data-bk="ups" data-bid="${escAttr(us.id)}">
      <span class="tw-rail-name">${escHtml(us.name || 'ИБП')}</span>
      <span class="tw-rail-sub">${sub}</span>
      ${_kvtChip(kw)}
    </button>`;
  }).join('');

  const coolRows = (c.coolingUnits || []).map(cu => {
    const kw = _coolAvail(cu);
    const tp = ({ 'crac': 'CRAC', 'inrow': 'In-Row', 'fancoil': 'Fan-coil', 'freecool': 'Free' }[cu.type]) || cu.type;
    const sub = `${tp} · ${cu.count} × ${cu.kwPerUnit} кВт · ${cu.redundancy}`;
    return `<button type="button" class="tw-rail-item${_selCls('cool', cu.id)}" data-bk="cool" data-bid="${escAttr(cu.id)}">
      <span class="tw-rail-name">${escHtml(cu.name || 'Климат')}</span>
      <span class="tw-rail-sub">${sub}</span>
      ${_kvtChip(kw)}
    </button>`;
  }).join('');

  // Feed: ТП + ДГУ — две подстроки в одном «блоке»
  const feedTpSub = c.feed?.tp?.needed ? `ТП ${c.feed.tp.kva} кВА · ${({'1':'1 ввод','2':'2 ввода','2-avr':'2 ввода + АВР'}[c.feed.tp.redundancy] || c.feed.tp.redundancy)}` : 'ТП — не требуется';
  const feedDguSub = c.feed?.dgu?.needed ? `ДГУ ${c.feed.dgu.kw} кВт · ${({'esp':'ESP','prp':'PRP'}[c.feed.dgu.mode] || c.feed.dgu.mode)}` : 'ДГУ — не требуется';

  // ИБП IT недостаток
  const upsItKw = upsByPurpose.it + upsByPurpose.mixed;
  const upsItMissing = (itKw > 0 && upsItKw < itKw) ? _redChip(`−${(itKw - upsItKw).toFixed(1)} кВт`) : '';
  const coolMissing = (itKw > 0 && coolKw < itKw) ? _redChip(`−${(itKw - coolKw).toFixed(1)} кВт`) : '';

  // v0.59.900: блок «Объект» сверху rail
  const pd = c.projectData || {};
  const STAGE_LABEL = { concept: 'концепция', sketch: 'эскиз', working: 'РД', asbuilt: 'as-built' };
  const projectSubLine = [pd.designation, pd.customer, pd.city].filter(Boolean).join(' · ') || 'данные не заполнены';
  const projectChip = pd.lat && pd.lon ? `${Number(pd.lat).toFixed(2)}, ${Number(pd.lon).toFixed(2)}` : '—';

  // v0.60.113 (rooms-концепция UI, продолжение v0.60.111 data-model):
  // секция «🏠 Помещения» — список помещений объекта со счётчиком
  // привязанного оборудования. Click → редактор помещения.
  const _rooms = Array.isArray(c.rooms) ? c.rooms : [];
  // v0.60.119: kind убран из UI — единая иконка 🏠 для всех помещений.
  // Legacy kind остаётся в данных (для отчётов / фильтров в будущем).
  const ROOM_KIND_ICON = { it: '🗄', ups: '⚡', mech: '🛠', office: '🏢', other: '📦' };
  const _countInRoom = (rid) => {
    const rg = (c.rackGroups || []).filter(x => x.roomId === rid).reduce((s, x) => s + (Number(x.count) || 0), 0);
    const us = (c.upsSystems || []).filter(x => x.roomId === rid).length;
    const cu = (c.coolingUnits || []).filter(x => (x.scope === 'room' && x.roomId === rid) || (x.scope === 'shared' && Array.isArray(x.roomIds) && x.roomIds.includes(rid))).length;
    return { rg, us, cu };
  };
  const roomRows = _rooms.map(rm => {
    const cnt = _countInRoom(rm.id);
    const subLine = `${cnt.rg} ст · ${cnt.us} ИБП · ${cnt.cu} клим`;
    // v0.60.119: единая иконка для rail; для legacy данных с kind показываем
    // соответствующую (для preview-плавного перехода со старых вариантов).
    const icon = ROOM_KIND_ICON[rm.kind] || '🏠';
    const chip = rm.areaSqM > 0 ? `<span class="tw-rail-chip">${rm.areaSqM} м²</span>` : '';
    return `<button type="button" class="tw-rail-item${_selCls('room', rm.id)}" data-bk="room" data-bid="${escAttr(rm.id)}">
      <span class="tw-rail-name">${icon} ${escHtml(rm.name || 'Зал')}</span>
      <span class="tw-rail-sub">${escHtml(subLine)}</span>
      ${chip}
    </button>`;
  }).join('');

  return `
    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">🏷 Объект</span>
      </div>
      <div class="tw-rail-list">
        <button type="button" class="tw-rail-item${_selCls('project', null)}" data-bk="project" data-bid="">
          <span class="tw-rail-name">${escHtml(pd.designation || 'Без обозначения')}</span>
          <span class="tw-rail-sub">${escHtml(projectSubLine)}</span>
          <span class="tw-rail-sub muted">${STAGE_LABEL[pd.stage] || pd.stage || ''}</span>
          <span class="tw-rail-chip">${escHtml(projectChip)}</span>
        </button>
      </div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title" title="Помещения объекта (IT-залы, электрощитовые, насосные и т.п.). К каждому помещению привязываются группы стоек, ИБП и кондиционеры. ИБП могут стоять в одном зале со стойками или в отдельной щитовой; климат может быть общим (chiller-plant обслуживает несколько залов) или независимым per-room (CRAC/DX в каждом зале).">🏠 Помещения <span class="muted">·${_rooms.length}</span></span>
        <button type="button" class="tw-rail-add" data-add-card="room" title="Добавить помещение (IT-зал / UPS-room / щитовая)" ${ro ? 'disabled' : ''}>➕</button>
      </div>
      <div class="tw-rail-list">${roomRows || '<div class="tw-rail-empty muted">Нет помещений</div>'}</div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">🗄 Стойки <span class="muted">·${(c.rackGroups || []).length}</span></span>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('rack-config'))}" target="_blank"
           title="Открыть «Конфигуратор шкафа» (rack-config) с контекстом ${_isSketchPid() ? 'sketch-проекта варианта' : 'основного проекта'}. BOM шкафов: корпус, монтажка, PDU, заглушки.">🛠</a>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('scs-config'))}" target="_blank"
           title="Открыть «Компоновщик шкафа» (scs-config). Карта юнитов, PDU, внутренние патчкорды, матрица питания.">📋</a>
        <button type="button" class="tw-rail-add" data-add-card="rack" title="Добавить группу стоек" ${ro ? 'disabled' : ''}>➕</button>
      </div>
      <div class="tw-rail-list">${rackRows || '<div class="tw-rail-empty muted">Нет групп</div>'}</div>
      <div class="tw-rail-foot">Σ ${itKw.toFixed(1)} кВт IT</div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">⚡ ИБП <span class="muted">·${(c.upsSystems || []).length}</span></span>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('ups-config'))}" target="_blank"
           title="Открыть «Конфигуратор ИБП» (ups-config) с контекстом ${_isSketchPid() ? 'sketch-проекта варианта' : 'основного проекта'}. Wizard-подбор моноблочных/модульных/AIO ИБП с АКБ.">🛠</a>
        <button type="button" class="tw-rail-add" data-add-card="ups" title="Добавить систему ИБП" ${ro ? 'disabled' : ''}>➕</button>
      </div>
      <div class="tw-rail-list">${upsRows || '<div class="tw-rail-empty muted">Нет систем</div>'}</div>
      <div class="tw-rail-foot">Σ ${upsByPurpose.total.toFixed(1)} кВт ${upsItMissing}</div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">❄ Климат <span class="muted">·${(c.coolingUnits || []).length}</span></span>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('cooling'))}" target="_blank"
           title="Открыть «Подбор холодильных систем» (cooling) с контекстом ${_isSketchPid() ? 'sketch-проекта варианта' : 'основного проекта'}. Технико-экономическое сравнение чиллеров, DX, free-cooling, CRAC.">🛠</a>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('meteo'))}" target="_blank"
           title="Открыть «Метеоданные» (meteo). Климатические ряды, FreeCool часы, ASHRAE design conditions.">🌤</a>
        <button type="button" class="tw-rail-add" data-add-card="cool" title="Добавить группу кондиционеров" ${ro ? 'disabled' : ''}>➕</button>
      </div>
      <div class="tw-rail-list">
        ${(() => {
          const cs = c.coolingSystem || {};
          const topo = TOPOLOGY_DEFAULTS[cs.topology] || TOPOLOGY_DEFAULTS['chiller-fc'];
          const fc = cs.freeCool || {};
          const fcLine = topo.hasFC && fc.enabled
            ? `Freecool: ${({direct:'прямой',indirect:'косвенный',glycol:'гликоль',none:'—'}[fc.type] || fc.type)} · T < ${fc.tCutoffC}°C`
            : 'без фрикулинга';
          return `<button type="button" class="tw-rail-item${_selCls('coolsys', null)}" data-bk="coolsys" data-bid="">
            <span class="tw-rail-name">⚙ Топология</span>
            <span class="tw-rail-sub">${escHtml(topo.label)}</span>
            <span class="tw-rail-sub">${escHtml(fcLine)}</span>
            <span class="tw-rail-chip">${cs.chillerSpec?.ratedCOP || topo.copBase}</span>
          </button>`;
        })()}
        ${coolRows || ''}
      </div>
      <div class="tw-rail-foot">Σ ${coolKw.toFixed(1)} кВт холода ${coolMissing}</div>
    </div>

    ${(c.projectData?.dcType || 'stationary') === 'modular' ? `<div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">🏢 МЦОД <span class="muted">·${(c.mdcBuildings || []).length}</span></span>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('mdc-config'))}" target="_blank"
           title="Открыть «Конфигуратор МЦОД» (mdc-config) с контекстом ${_isSketchPid() ? 'sketch-проекта варианта' : 'основного проекта'}. Готовые блоки GDM-600 IT-HALL-300 / POWER-1600.">🛠</a>
        <button type="button" class="tw-rail-add" data-add-card="mdc" title="Добавить блок МЦОД" ${ro ? 'disabled' : ''}>➕</button>
      </div>
      <div class="tw-rail-list">${(() => {
        const arr = (c.mdcBuildings || []);
        if (!arr.length) return '<div class="tw-rail-empty muted">Нет (стационарный ЦОД)</div>';
        return arr.map(b => {
          const summary = _readMdcSummary(b.mdcSubProjectId);
          const sub = summary
            ? `${b.configurator.toUpperCase()} · ${summary.totalRacks} стоек × ${summary.rackKw} кВт`
            : `${b.configurator.toUpperCase()} · не сконфигурирован`;
          const itKw = summary ? (summary.itKw * (Number(b.count) || 1)) : 0;
          return `<button type="button" class="tw-rail-item${(_selectedBlock?.kind === 'mdc' && _selectedBlock.id === b.id) ? ' active' : ''}" data-bk="mdc" data-bid="${escAttr(b.id)}">
            <span class="tw-rail-name">${escHtml(b.name)} ${(Number(b.count) || 1) > 1 ? `<span class="muted">×${b.count}</span>` : ''}</span>
            <span class="tw-rail-sub">${escHtml(sub)}</span>
            ${itKw > 0 ? `<span class="tw-rail-chip">${itKw.toFixed(0)} кВт</span>` : '<span class="tw-rail-chip tw-rail-chip-warn">—</span>'}
          </button>`;
        }).join('');
      })()}</div>
    </div>` : ''}

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">🔌 Ввод</span>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('transformer-config'))}" target="_blank"
           title="Открыть «Конфигуратор трансформатора» с контекстом проекта. Силовой ТП: S, U₁/U₂, группа, u_k.">🛠</a>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('dgu-config'))}" target="_blank"
           title="Открыть «Конфигуратор ДГУ». Расчёт по ISO 8528-1 + climate derate + подбор Caterpillar/Cummins/Volvo/FG Wilson.">⚡</a>
        <a class="tw-rail-cfg" href="${escAttr(_buildConfigLink('mv-config'))}" target="_blank"
           title="Открыть «Конфигуратор РУ СН» (mv-config). Wizard-подбор ячеек 6-35 кВ.">⚙</a>
      </div>
      <div class="tw-rail-list">
        <button type="button" class="tw-rail-item${_selCls('feed', null)}" data-bk="feed" data-bid="">
          <span class="tw-rail-name">ТП и ДГУ</span>
          <span class="tw-rail-sub">${escHtml(feedTpSub)}</span>
          <span class="tw-rail-sub">${escHtml(feedDguSub)}</span>
          <span class="tw-rail-chip">${feedKw.toFixed(1)} кВт</span>
        </button>
      </div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">📐 Площади</span>
      </div>
      <div class="tw-rail-list">
        <button type="button" class="tw-rail-item${_selCls('areas', null)}" data-bk="areas" data-bid="">
          <span class="tw-rail-name">Помещения</span>
          <span class="tw-rail-sub">${areas.length} зон · расчёт по ТКП 308-2011</span>
          <span class="tw-rail-chip">Σ ${sumM2} м²</span>
        </button>
      </div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">📊 PUE</span>
      </div>
      <div class="tw-rail-list">
        ${(() => {
          const meteoSum = _readMeteoSummary();
          const pueVal = calcPue(c, meteoSum);
          const sub = c.pue?.mode === 'manual' ? 'Ручной режим' : (meteoSum ? `Авто · meteo: ${meteoSum.locationName || meteoSum.dateFrom || '?'}` : 'Авто · без meteo (среднестат.)');
          return `<button type="button" class="tw-rail-item${_selCls('pue', null)}" data-bk="pue" data-bid="">
            <span class="tw-rail-name">Расчёт PUE</span>
            <span class="tw-rail-sub">${escHtml(sub)}</span>
            <span class="tw-rail-chip">${pueVal.toFixed(2)}</span>
          </button>`;
        })()}
      </div>
    </div>

    <div class="tw-rail-section">
      <div class="tw-rail-head">
        <span class="tw-rail-title">📦 BOM</span>
      </div>
      <div class="tw-rail-list">
        <button type="button" class="tw-rail-item${_selCls('bom', null)}" data-bk="bom" data-bid="">
          <span class="tw-rail-name">Спецификация</span>
          <span class="tw-rail-sub">Цены из каталога по дате</span>
          <span class="tw-rail-chip">→</span>
        </button>
      </div>
    </div>
  `;
}

function _readMeteoSummary() {
  if (!_pid) return null;
  try {
    const all = JSON.parse(localStorage.getItem(projectKey(_pid, 'meteo', 'datasets.v1')) || '[]');
    return all.find(d => d.activeForProject) || all[0] || null;
  } catch { return null; }
}

function renderDetails(c, ro) {
  const sel = _selectedBlock || { kind: 'rack', id: null };
  // v0.59.900: блок «Объект»
  if (sel.kind === 'project') {
    const pd = c.projectData || {};
    const sub = [pd.designation, pd.customer].filter(Boolean).join(' · ') || 'не заполнено';
    return `<div class="tw-details-head">
        <h3>🏷 Объект (общие данные проекта)</h3>
        <span class="muted tw-details-sub">${escHtml(sub)}</span>
        <button type="button" class="tw-details-btn" data-tw-action="sync-from-project" ${ro ? 'disabled' : ''}
                style="margin-left:auto"
                title="Перезаполнить пустые поля концепции из метаданных родительского проекта (свойства, реквизиты, локация). Заполненные поля не затираются.">🔄 Синхр. с проектом</button>
      </div>
      <div class="tw-details-body">
        <div class="tw-card" data-card-kind="project" data-card-id="-">
          <div class="tw-grid">
            <label title="Шифр проекта (короткий код по системе ГИП). Шапка чертежей. Авто-заполняется из метаданных проекта.">Обозначение проекта:<input type="text" data-field="projectData.designation" value="${escAttr(pd.designation || '')}" placeholder="напр. 25013-GEP-ENG-ELC" ${ro ? 'disabled' : ''}></label>
            <label title="Заказчик / клиент (юр. или физ. лицо). Авто-заполняется из реквизитов проекта.">Заказчик:<input type="text" data-field="projectData.customer" value="${escAttr(pd.customer || '')}" placeholder="ТОО «...»" ${ro ? 'disabled' : ''}></label>
            <label title="Тип ЦОД определяет какие блоки доступны:&#10;• Стационарный — своё здание, классические машзалы.&#10;• Модульный — блок «🏢 МЦОД» доступен (GDM-600, контейнерные блоки).&#10;• Мобильный — на колёсах / в перевозимом контейнере.&#10;• В помещении — в существующем здании (overlay).&#10;• Капсула (гермозона) — мини-ЦОД в офисе, изолированный.">Тип ЦОД:
              <select data-field="projectData.dcType" ${ro ? 'disabled' : ''}>
                <option value="stationary"${(pd.dcType || 'stationary') === 'stationary' ? ' selected' : ''}>🏢 Стационарный (своё здание)</option>
                <option value="modular"${pd.dcType === 'modular' ? ' selected' : ''}>📦 Модульный (МЦОД, GDM-600)</option>
                <option value="mobile"${pd.dcType === 'mobile' ? ' selected' : ''}>🚛 Мобильный (контейнер, колёса)</option>
                <option value="indoor"${pd.dcType === 'indoor' ? ' selected' : ''}>🏠 В помещении (overlay)</option>
                <option value="capsule"${pd.dcType === 'capsule' ? ' selected' : ''}>🛡 Капсула (гермозона, офис)</option>
              </select>
            </label>
            <label title="Стадия проектирования: концепция / эскиз (П) / рабочая (РД) / исполнительная (As-built).">Стадия:
              <select data-field="projectData.stage" ${ro ? 'disabled' : ''}>
                <option value="concept"${pd.stage === 'concept' ? ' selected' : ''}>Концепция</option>
                <option value="sketch"${pd.stage === 'sketch' ? ' selected' : ''}>Эскиз (П)</option>
                <option value="working"${pd.stage === 'working' ? ' selected' : ''}>Рабочая (РД)</option>
                <option value="asbuilt"${pd.stage === 'asbuilt' ? ' selected' : ''}>As-built / Исп.</option>
              </select>
            </label>
            <label>Дата:<input type="date" data-field="projectData.dateOfDesign" value="${escAttr(pd.dateOfDesign || '')}" ${ro ? 'disabled' : ''}></label>
            <label>Главный инженер:<input type="text" data-field="projectData.designer" value="${escAttr(pd.designer || '')}" placeholder="ФИО" ${ro ? 'disabled' : ''}></label>
          </div>
          <h5 class="tw-section-h5">📍 Местоположение</h5>
          <div class="tw-grid">
            <label>Город:<input type="text" data-field="projectData.city" value="${escAttr(pd.city || '')}" placeholder="напр. Алматы" ${ro ? 'disabled' : ''}></label>
            <label>Адрес:<input type="text" data-field="projectData.address" value="${escAttr(pd.address || '')}" placeholder="ул./стройплощадка" ${ro ? 'disabled' : ''}></label>
            <label>Широта (lat):<input type="number" step="0.0001" data-field="projectData.lat" value="${pd.lat != null ? pd.lat : ''}" ${ro ? 'disabled' : ''}></label>
            <label>Долгота (lon):<input type="number" step="0.0001" data-field="projectData.lon" value="${pd.lon != null ? pd.lon : ''}" ${ro ? 'disabled' : ''}></label>
          </div>
          <div class="tw-mdc-actions">
            <button type="button" class="tw-bind-btn" data-tw-action="pick-location" ${ro ? 'disabled' : ''}>🗺 Выбрать на карте…</button>
            ${pd.lat && pd.lon ? `<button type="button" class="tw-details-btn" data-tw-action="fetch-meteo" ${ro ? 'disabled' : ''}>🌐 Загрузить метео для этой локации</button>` : ''}
          </div>
          <h5 class="tw-section-h5">📝 Примечания</h5>
          <label class="tw-textarea-label">
            <textarea rows="3" data-field="projectData.notes" placeholder="Технические условия, ограничения площадки, требования заказчика..." ${ro ? 'disabled' : ''}>${escHtml(pd.notes || '')}</textarea>
          </label>
        </div>
      </div>`;
  }
  if (sel.kind === 'rack') {
    const rg = (c.rackGroups || []).find(x => x.id === sel.id);
    if (!rg) return '<div class="tw-details-empty muted">Группа удалена. Выберите блок слева.</div>';
    return _detailsHeaderHtml('🗄 Группа стоек', rg.id, ro, 'rack', `${rg.count} × ${rg.kwPerRack} кВт = ${calcRackGroupKw(rg).toFixed(1)} кВт`)
      + renderRackGroupCard(rg, ro, c.rooms)
      + _bulkRackToolbar(c, ro);
  }
  if (sel.kind === 'ups') {
    const us = (c.upsSystems || []).find(x => x.id === sel.id);
    if (!us) return '<div class="tw-details-empty muted">Система удалена. Выберите блок слева.</div>';
    return _detailsHeaderHtml('⚡ Система ИБП', us.id, ro, 'ups', `${us.count} × ${us.ratedKva} кВА · ${_upsAvail(us).toFixed(1)} кВт доступно`)
      + renderUpsCard(us, ro, c.rooms);
  }
  if (sel.kind === 'cool') {
    const cu = (c.coolingUnits || []).find(x => x.id === sel.id);
    if (!cu) return '<div class="tw-details-empty muted">Группа удалена. Выберите блок слева.</div>';
    return _detailsHeaderHtml('❄ Группа кондиционеров', cu.id, ro, 'cool', `${cu.count} × ${cu.kwPerUnit} кВт · ${_coolAvail(cu).toFixed(1)} кВт доступно`)
      + renderCoolCard(cu, ro, c.rooms);
  }
  // v0.59.901: топология охлаждения
  if (sel.kind === 'coolsys') {
    const cs = c.coolingSystem || newCoolingSystem();
    const topo = TOPOLOGY_DEFAULTS[cs.topology] || TOPOLOGY_DEFAULTS['chiller-fc'];
    const fc = cs.freeCool || {};
    const fcEnabled = topo.hasFC && fc.enabled;
    return `<div class="tw-details-head">
        <h3>⚙ Топология системы охлаждения</h3>
        <span class="muted tw-details-sub">${escHtml(topo.label)} · ${fcEnabled ? `freecool ${fc.type} T<${fc.tCutoffC}°C` : 'без фрикулинга'}</span>
      </div>
      <div class="tw-details-body">
        <div class="tw-card" data-card-kind="coolsys" data-card-id="-">
          <div class="tw-grid">
            <label>Топология:
              <select data-field="coolingSystem.topology" ${ro ? 'disabled' : ''}>
                <option value="chiller-fc"${cs.topology === 'chiller-fc' ? ' selected' : ''}>❄ Чиллер с фрикулингом (PUE 1.2–1.4)</option>
                <option value="chiller"${cs.topology === 'chiller' ? ' selected' : ''}>🌡 Чиллер без фрикулинга (PUE 1.5–1.7)</option>
                <option value="dx"${cs.topology === 'dx' ? ' selected' : ''}>💨 DX / Конденсаторы (PUE 1.5–2.0)</option>
                <option value="adiabatic"${cs.topology === 'adiabatic' ? ' selected' : ''}>💧 Адиабатический freecool (PUE 1.1–1.3)</option>
                <option value="immersion"${cs.topology === 'immersion' ? ' selected' : ''}>🛢 Погружное охлаждение (PUE 1.05–1.15)</option>
              </select>
            </label>
            <label>Setpoint холодного коридора, °C:<input type="number" min="18" max="30" step="1" data-field="coolingSystem.setpointTC" value="${cs.setpointTC}" ${ro ? 'disabled' : ''}></label>
            <label>ΔT горячий ↔ холодный, °C:<input type="number" min="6" max="20" step="1" data-field="coolingSystem.deltaTcorridorC" value="${cs.deltaTcorridorC}" ${ro ? 'disabled' : ''}></label>
          </div>
          ${topo.hasFC ? `
            <h5 class="tw-section-h5">💨 Фрикулинг</h5>
            <div class="tw-grid">
              <label class="tw-checkbox"><input type="checkbox" data-field="coolingSystem.freeCool.enabled"${fc.enabled ? ' checked' : ''} ${ro ? 'disabled' : ''}> Фрикулинг включен</label>
              <label>Тип:
                <select data-field="coolingSystem.freeCool.type" ${ro ? 'disabled' : ''}>
                  <option value="direct"${fc.type === 'direct' ? ' selected' : ''}>Прямой (DAC, наружный воздух в зал)</option>
                  <option value="indirect"${fc.type === 'indirect' ? ' selected' : ''}>Косвенный (теплообменник AAHX)</option>
                  <option value="glycol"${fc.type === 'glycol' ? ' selected' : ''}>Гликолевый (dry-cooler контур)</option>
                </select>
              </label>
              <label>T cutoff (порог), °C:<input type="number" min="0" max="25" step="1" data-field="coolingSystem.freeCool.tCutoffC" value="${fc.tCutoffC}" ${ro ? 'disabled' : ''}></label>
            </div>
          ` : '<p class="muted tw-details-note">Топология «' + escHtml(topo.label) + '» не поддерживает фрикулинг.</p>'}
          <h5 class="tw-section-h5">⚙ Параметры чиллера / источника холода</h5>
          <div class="tw-grid">
            <label>Rated capacity, кВт:<input type="number" step="1" min="0" data-field="coolingSystem.chillerSpec.ratedCapKw" value="${cs.chillerSpec?.ratedCapKw || 0}" ${ro ? 'disabled' : ''}></label>
            <label>Rated COP:<input type="number" step="0.1" min="1" max="20" data-field="coolingSystem.chillerSpec.ratedCOP" value="${cs.chillerSpec?.ratedCOP || 3.5}" ${ro ? 'disabled' : ''}></label>
            <label>Rated ambient T, °C:<input type="number" step="1" data-field="coolingSystem.chillerSpec.ambientRated" value="${cs.chillerSpec?.ambientRated || 35}" ${ro ? 'disabled' : ''}></label>
            <label>Capacity correction, %/°C:<input type="number" step="0.1" data-field="coolingSystem.chillerSpec.capCorrPctPerC" value="${cs.chillerSpec?.capCorrPctPerC || -1.5}" ${ro ? 'disabled' : ''}></label>
          </div>
          <p class="muted tw-details-note">📊 Эти параметры используются в расчёте PUE (см. блок «📊 PUE») и в годовой энергии чиллера в /meteo/. Rated COP — типовая эффективность при rated ambient.</p>
          <h5 class="tw-section-h5">🔗 Связь с модулем «Подбор холодильных систем»</h5>
          <p class="muted tw-details-note">Создайте подбор оборудования (чиллеры/CRAC/DX) для этой концепции — с pre-filled требуемой холодопроизводительностью и условиями объекта. После «✓ Применить и вернуться» в /cooling/ — концепция автоматически использует данные подбора в PUE-расчёте (mode=cooling-module).</p>
          <div class="tw-pue-actions">
            <button type="button" class="tw-bind-btn" data-tw-action="open-cooling-prefill" ${ro ? 'disabled' : ''}
                    title="Открыть модуль «Подбор холодильных систем» и автоматически создать новый подбор с requiredCoolingKw = Σ rackGroups × pue_target. После «✓ Применить и вернуться» — концепция получит ссылку на подбор и пересчитает PUE из реальной топологии.">
              📤 Подобрать холод для этой концепции →
            </button>
            <a class="tw-pue-link" href="../cooling/" target="_blank" title="Открыть cooling в новой вкладке без pre-fill (для просмотра существующих подборов).">↗ Открыть cooling</a>
          </div>
          ${(() => {
            // Phase 30.5 (v0.60.68): кнопка «📋 Создать ТО-наряд» — показывается
            // только если в проекте уже есть cooling-подбор. Иначе сначала надо его создать.
            const cs = _readCoolingSummary();
            if (!cs) return '';
            return `<h5 class="tw-section-h5">🛠 Связь с модулем «Сервис: монтаж и ТО»</h5>
              <p class="muted tw-details-note">В проекте создан подбор «<b>${escHtml(cs.selectionName)}</b>». Можно одной кнопкой сгенерировать ТО-наряд из основного варианта (★) — позиции автоматически рассчитаются по составу оборудования (квартальное ТО × qty + фильтры + дозаправка хладагента).</p>
              <div class="tw-pue-actions">
                <button type="button" class="tw-bind-btn" data-tw-action="create-maint-order" ${ro ? 'disabled' : ''}
                        title="Создать ТО-наряд для основного варианта подбора «${escAttr(cs.selectionName)} → ${escAttr(cs.mainOptionName)}». Позиции: квартальное ТО × ${cs.totalQty} ед. × 4 раза/год + фильтры + хладагент. Открывает /service/ для редактирования.">
                  📋 Создать ТО-наряд из этого подбора →
                </button>
                <a class="tw-pue-link" href="../service/?project=${escAttr(_pid)}" target="_blank" title="Открыть модуль «Сервис: монтаж и ТО» в новой вкладке.">↗ Открыть Сервис</a>
              </div>`;
          })()}
        </div>
      </div>`;
  }
  // v0.60.113: редактор помещения объекта (rooms-концепция UI).
  // v0.60.119: убран select типа помещения (имена в свободной форме);
  // добавлены климат-требования и прочие требования; плановая vs
  // расчётная площадь.
  if (sel.kind === 'room') {
    const rm = (c.rooms || []).find(x => x.id === sel.id);
    if (!rm) return '<div class="tw-details-empty muted">Помещение удалено. Выберите другое слева.</div>';
    const climate = rm.climate || { tMinC: 18, tMaxC: 27, rhMinPct: 20, rhMaxPct: 80, ashraeClass: 'A1' };
    const reqs = rm.requirements || { fireSuppression: '', accessLevel: '', antistatic: false, raisedFloor: false, additional: '' };
    // v0.60.143: ASHRAE class констрейнит диапазон значений T/RH.
    // v0.60.145 (по уточнению Пользователя 2026-05-04 «мне не нужно
    // блокировать ввод, а только ограничить выход за пределы класса»):
    // поля остаются РЕДАКТИРУЕМЫМИ, но input.min/max берутся из класса
    // и значения clamp'аются на change-handler. Toast предупреждает если
    // юзер ввёл вне диапазона. Class='custom' снимает любые ограничения.
    const ashraeOpts = Object.entries(ASHRAE_CLASSES).map(([id, def]) =>
      `<option value="${id}"${climate.ashraeClass === id ? ' selected' : ''} title="${escAttr(def.label)}">${id}</option>`
    ).join('');
    const _ashraeDef = ASHRAE_CLASSES[climate.ashraeClass] || ASHRAE_CLASSES.A1;
    const _isCustom = climate.ashraeClass === 'custom';
    // min/max для inputs. Для custom — широкие пределы; для класса — границы класса.
    const _tMin = _isCustom ? -20 : (_ashraeDef.tMinC ?? -20);
    const _tMax = _isCustom ?  50 : (_ashraeDef.tMaxC ??  50);
    const _rhMin = _isCustom ? 0   : (_ashraeDef.rhMinPct ?? 0);
    const _rhMax = _isCustom ? 100 : (_ashraeDef.rhMaxPct ?? 100);
    const _classTip = _isCustom
      ? 'Свободный ввод (без ограничений по ASHRAE-классу).'
      : `Допустимый диапазон по классу ${escAttr(climate.ashraeClass)}: T ${_ashraeDef.tMinC}…${_ashraeDef.tMaxC} °C, RH ${_ashraeDef.rhMinPct}…${_ashraeDef.rhMaxPct}%. Значения вне диапазона будут clamp'нуты при сохранении.`;
    const fireOpts = [
      { v: '', l: '— не задано —' },
      { v: 'gas', l: '🔥 Газовое (FM-200/FK-5-1-12/Inergen)' },
      { v: 'sprinkler', l: '💧 Спринклерное' },
      { v: 'mist', l: '🌫 Тонкораспылённая вода' },
      { v: 'none', l: '✗ Нет' },
    ].map(o => `<option value="${o.v}"${reqs.fireSuppression === o.v ? ' selected' : ''}>${o.l}</option>`).join('');
    const accessOpts = [
      { v: '', l: '— не задано —' },
      { v: 'restricted', l: '🔒 Ограниченный (СКУД)' },
      { v: 'normal', l: '👤 Обычный' },
    ].map(o => `<option value="${o.v}"${reqs.accessLevel === o.v ? ' selected' : ''}>${o.l}</option>`).join('');

    const racksHere = (c.rackGroups || []).filter(rg => rg.roomId === rm.id);
    const upsHere = (c.upsSystems || []).filter(us => us.roomId === rm.id);
    const coolHere = (c.coolingUnits || []).filter(cuRoom => (cuRoom.scope === 'room' && cuRoom.roomId === rm.id) || (cuRoom.scope === 'shared' && Array.isArray(cuRoom.roomIds) && cuRoom.roomIds.includes(rm.id)));
    const itKwHere = racksHere.reduce((s, rg) => s + (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0), 0);
    const upsKvaHere = upsHere.reduce((s, us) => s + (Number(us.ratedKva) || 0) * (Number(us.count) || 0), 0);
    const coolKwHere = coolHere.reduce((s, cuRoom) => s + (Number(cuRoom.count) || 0) * (Number(cuRoom.kwPerUnit) || 0), 0);
    // v0.60.119: расчётная площадь.
    const calcAreaM2 = calcRoomCalculatedArea(rm.id, c);
    const planAreaM2 = Number(rm.areaSqM) || 0;
    const _li = (arr, fmt) => arr.length
      ? '<ul style="margin:4px 0 0;padding-left:20px;font-size:12px">' + arr.map(fmt).join('') + '</ul>'
      : '<div class="muted" style="font-size:12px">— ничего не привязано —</div>';
    const headSub = `${racksHere.length} групп стоек · ${upsHere.length} ИБП · ${coolHere.length} клим. систем`;
    // Сравнение plan vs calc — предупреждение если plan меньше calc.
    const areaWarn = (planAreaM2 > 0 && calcAreaM2 > planAreaM2)
      ? `<span style="color:#dc2626;font-size:11px;margin-left:8px" title="Плановая площадь меньше расчётной — оборудование может не поместиться с нормативными клиренсами.">⚠ +${calcAreaM2 - planAreaM2} м²</span>`
      : '';
    return _detailsHeaderHtml('🏠 Помещение', rm.id, ro, 'room', headSub)
      + `<div class="tw-card" data-card-kind="room" data-card-id="${escAttr(rm.id)}">
          <div class="tw-card-head">
            <input type="text" class="tw-card-name" data-field="name" value="${escAttr(rm.name)}" placeholder="Имя помещения (свободная форма)" ${ro ? 'disabled' : ''}>
          </div>
          <p class="muted" style="font-size:11.5px;margin:4px 0 8px">💡 Имя задаёт технолог в свободной форме (например, «Главный зал», «UPS-room», «Машзал ИБП», «Зал GPU», «Щитовая 0.4 кВ»).</p>

          <h5 style="margin:10px 0 6px;font-size:12.5px;color:#075985">📐 Площадь</h5>
          <div class="tw-grid" style="grid-template-columns:1fr 1fr">
            <label title="Плановая площадь — задаётся технологом по архитектурному заданию или плану здания.">📋 Плановая, м²:
              <input type="number" data-field="areaSqM" min="0" step="1" value="${planAreaM2}" ${ro ? 'disabled' : ''}>
            </label>
            <label title="Расчётная площадь — вычисляется автоматически: сумма footprint оборудования + клиренсы (front 1200мм, rear 900мм по умолчанию ASHRAE/TIA-942) × 1.30 на общие коридоры.&#10;&#10;Когда поля frontClearanceMm/rearClearanceMm появятся в карточках стоек — будут использоваться они.">🧮 Расчётная, м²:
              <input type="text" value="${calcAreaM2} м²" readonly style="background:#f0f9ff;color:#0c4a6e;cursor:not-allowed">
            </label>
          </div>
          ${areaWarn ? `<p style="margin:4px 0 0;font-size:11.5px;color:#dc2626">${areaWarn} — расчётная площадь больше плановой. Увеличьте плановую или уменьшите оборудование/клиренсы.</p>` : ''}

          <h5 style="margin:14px 0 6px;font-size:12.5px;color:#075985">🌡 Климатические требования</h5>
          <p class="muted" style="font-size:11px;margin:0 0 8px">
            💡 ASHRAE TC 9.9 «Thermal Guidelines for Data Processing Environments» (4-th ed., 2021) — стандартные классы оборудования по допустимому диапазону T/RH. <b>Выбор класса ограничивает диапазон</b> — значения T мин/макс, RH мин/макс могут редактироваться, но не выходят за пределы «allowable envelope» класса. Для свободного ввода — «custom».
          </p>
          <div class="tw-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            <label title="ASHRAE TC 9.9 класс. Выбор класса задаёт допустимый диапазон T/RH min/max — значения вне диапазона clamp'аются при сохранении. Для свободного ввода — «custom».">ASHRAE класс:
              <select data-field="climate.ashraeClass" ${ro ? 'disabled' : ''}>${ashraeOpts}</select>
            </label>
            <label title="Минимальная температура воздуха в зале, °C. ${escAttr(_classTip)}">T мин, °C:
              <input type="number" data-field="climate.tMinC" min="${_tMin}" max="${_tMax}" step="0.5" value="${Number(climate.tMinC) || 0}" ${ro ? 'disabled' : ''}>
            </label>
            <label title="Максимальная температура воздуха в зале, °C. ${escAttr(_classTip)}">T макс, °C:
              <input type="number" data-field="climate.tMaxC" min="${_tMin}" max="${_tMax}" step="0.5" value="${Number(climate.tMaxC) || 0}" ${ro ? 'disabled' : ''}>
            </label>
            <label title="Минимальная относительная влажность, %. ${escAttr(_classTip)}">RH мин, %:
              <input type="number" data-field="climate.rhMinPct" min="${_rhMin}" max="${_rhMax}" step="1" value="${Number(climate.rhMinPct) || 0}" ${ro ? 'disabled' : ''}>
            </label>
            <label title="Максимальная относительная влажность, %. ${escAttr(_classTip)}">RH макс, %:
              <input type="number" data-field="climate.rhMaxPct" min="${_rhMin}" max="${_rhMax}" step="1" value="${Number(climate.rhMaxPct) || 0}" ${ro ? 'disabled' : ''}>
            </label>
          </div>

          <h5 style="margin:14px 0 6px;font-size:12.5px;color:#075985">🔧 Прочие требования</h5>
          <div class="tw-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            <label title="Тип системы пожаротушения для этого помещения.">Пожаротушение:
              <select data-field="requirements.fireSuppression" ${ro ? 'disabled' : ''}>${fireOpts}</select>
            </label>
            <label title="Уровень доступа: ограниченный (через СКУД, для серверных) или обычный (офис / диспетчерская).">Доступ:
              <select data-field="requirements.accessLevel" ${ro ? 'disabled' : ''}>${accessOpts}</select>
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px" title="Антистатическое покрытие пола / ESD-защита (для серверных и щитовых).">
              <input type="checkbox" data-field="requirements.antistatic"${reqs.antistatic ? ' checked' : ''} ${ro ? 'disabled' : ''}>
              <span>Антистатическое покрытие</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px" title="Фальшпол с раздачей холодного воздуха (типично для классических машзалов).">
              <input type="checkbox" data-field="requirements.raisedFloor"${reqs.raisedFloor ? ' checked' : ''} ${ro ? 'disabled' : ''}>
              <span>Фальшпол</span>
            </label>
          </div>
          <label style="display:block;margin-top:8px" title="Дополнительные требования / ограничения / пометки технолога.">Дополнительно:
            <textarea data-field="requirements.additional" rows="2" placeholder="Особые требования, привязка к плану здания, ограничения по нагрузке, шумовые ограничения и т.п." ${ro ? 'disabled' : ''} style="width:100%;font:inherit;font-size:13px;padding:6px;border:1px solid #cbd5e1;border-radius:4px;resize:vertical">${escHtml(reqs.additional || '')}</textarea>
          </label>

          <label style="display:block;margin-top:8px" title="Заметки (общие, отображаются в отчёте по помещению).">📝 Заметки:
            <textarea data-field="notes" rows="2" placeholder="Свободные заметки." ${ro ? 'disabled' : ''} style="width:100%;font:inherit;font-size:13px;padding:6px;border:1px solid #cbd5e1;border-radius:4px;resize:vertical">${escHtml(rm.notes || '')}</textarea>
          </label>

          <hr style="border:none;border-top:1px dashed #cbd5e1;margin:14px 0">
          <h5 style="margin:0 0 8px;font-size:12.5px;color:#075985">📦 Что в помещении</h5>
          <div class="tw-grid" style="grid-template-columns:1fr 1fr 1fr">
            <div>
              <b>🗄 Стойки</b>
              ${_li(racksHere, rg => '<li>' + escHtml(rg.name || '') + ' — ' + (rg.count || 0) + ' × ' + (rg.kwPerRack || 0) + ' кВт</li>')}
              <div class="muted" style="font-size:11.5px;margin-top:4px">Σ ${itKwHere.toFixed(1)} кВт IT</div>
            </div>
            <div>
              <b>⚡ ИБП</b>
              ${_li(upsHere, us => '<li>' + escHtml(us.name || '') + ' — ' + (us.count || 0) + ' × ' + (us.ratedKva || 0) + ' кВА (' + (us.purpose || '') + ')</li>')}
              <div class="muted" style="font-size:11.5px;margin-top:4px">Σ ${upsKvaHere.toFixed(1)} кВА</div>
            </div>
            <div>
              <b>❄ Климат</b>
              ${_li(coolHere, cuRoom => '<li>' + escHtml(cuRoom.name || '') + ' — ' + (cuRoom.count || 0) + ' × ' + (cuRoom.kwPerUnit || 0) + ' кВт ' + (cuRoom.scope === 'shared' ? '<span class="muted">(общая)</span>' : '') + '</li>')}
              <div class="muted" style="font-size:11.5px;margin-top:4px">Σ ${coolKwHere.toFixed(1)} кВт холода</div>
            </div>
          </div>
          <p class="muted" style="font-size:11.5px;margin-top:10px">
            💡 Привязка оборудования: в карточке группы стоек / ИБП / климата — поле «🏠 Помещение». Климат может быть «в помещении» (CRAC/InRow per room) или «общим» (chiller-plant обслуживает несколько залов).
          </p>
        </div>`;
  }
  if (sel.kind === 'mdc') {
    const b = (c.mdcBuildings || []).find(x => x.id === sel.id);
    if (!b) return '<div class="tw-details-empty muted">Блок удалён. Выберите другой слева.</div>';
    const summary = _readMdcSummary(b.mdcSubProjectId);
    const subProjects = _pid ? listSubProjects(_pid, 'mdc-config') : [];
    const linked = subProjects.find(p => p.id === b.mdcSubProjectId);
    const cnt = Number(b.count) || 1;
    const totalKw = summary ? (summary.itKw * cnt) : 0;
    const totalRacks = summary ? (summary.totalRacks * cnt) : 0;
    const summaryStr = summary
      ? `${cnt > 1 ? cnt + ' × ' : ''}${summary.totalRacks} стоек × ${summary.rackKw} кВт = ${totalKw.toFixed(1)} кВт IT`
      : 'Не сконфигурирован — откройте Конфигуратор МЦОД';
    return _detailsHeaderHtml('🏢 Блок МЦОД', b.id, ro, 'mdc', summaryStr)
      + `<div class="tw-card" data-card-kind="mdc" data-card-id="${b.id}">
          <div class="tw-card-head">
            <input type="text" class="tw-card-name" data-field="name" value="${escAttr(b.name)}" placeholder="Название" ${ro ? 'disabled' : ''}>
          </div>
          <div class="tw-grid">
            <label>Тип конфигуратора:
              <select data-field="configurator" ${ro ? 'disabled' : ''}>
                <option value="gdm600"${b.configurator === 'gdm600' ? ' selected' : ''}>GDM-600 (модульный)</option>
              </select>
            </label>
            <label>Кол-во одинаковых зданий:<input type="number" data-field="count" min="1" step="1" value="${cnt}" ${ro ? 'disabled' : ''}></label>
          </div>
          <div class="tw-mdc-link">
            ${linked
              ? `<div class="tw-mdc-linked"><b>📦 Привязано:</b> «${escHtml(linked.name)}» <span class="muted">(${linked.designation || ''})</span></div>`
              : '<div class="tw-mdc-unlinked muted">Здание ещё не привязано к sub-проекту mdc-config.</div>'}
            <div class="tw-mdc-actions">
              ${linked
                ? `<button type="button" class="tw-bind-btn" data-mdc-action="open" data-bid="${b.id}">↗ Открыть в Конфигураторе МЦОД</button>
                   <button type="button" class="tw-details-btn" data-mdc-action="unlink" data-bid="${b.id}" ${ro ? 'disabled' : ''}>🔌 Отвязать</button>`
                : `<button type="button" class="tw-bind-btn" data-mdc-action="create" data-bid="${b.id}" ${ro ? 'disabled' : ''}>➕ Создать новый</button>
                   ${subProjects.length ? `<button type="button" class="tw-details-btn" data-mdc-action="link" data-bid="${b.id}" ${ro ? 'disabled' : ''}>🔗 Привязать существующий…</button>` : ''}`}
            </div>
          </div>
          ${summary ? `<div class="tw-mdc-summary">
            <h5>Конфигурация (read-only — править в mdc-config)</h5>
            <div class="tw-mdc-grid">
              <div><span class="muted">Стоек на здание:</span> <b>${summary.totalRacks}</b></div>
              <div><span class="muted">Мощность на стойку:</span> <b>${summary.rackKw} кВт</b></div>
              <div><span class="muted">IT-нагрузка на здание:</span> <b>${summary.itKw.toFixed(1)} кВт</b></div>
              <div><span class="muted">Резервирование ИБП:</span> <b>${summary.redundancy}</b></div>
              <div><span class="muted">ASHRAE-класс:</span> <b>${summary.ashrae}</b></div>
              <div><span class="muted">ТП / ДГУ:</span> <b>${summary.withTp ? '✓' : '✗'} / ${summary.withDgu ? '✓' : '✗'}</b></div>
            </div>
            ${cnt > 1 ? `<div class="tw-mdc-multi">× ${cnt} зданий = <b>${totalRacks} стоек, ${totalKw.toFixed(1)} кВт IT</b></div>` : ''}
          </div>` : ''}
        </div>`;
  }
  if (sel.kind === 'feed') {
    const feedKw = calcFeedTotal(c);
    return `<div class="tw-details-head">
        <h3>🔌 Ввод: ТП и ДГУ</h3>
        <span class="muted tw-details-sub">Σ принятая мощность: ${feedKw.toFixed(1)} кВт</span>
      </div>
      <div class="tw-details-body">${renderFeedSection(c.feed, ro, c)}</div>`;
  }
  if (sel.kind === 'pue') {
    const meteoSum = _readMeteoSummary();
    const pueVal = calcPue(c, meteoSum);
    const isAuto = c.pue?.mode !== 'manual';
    const itKw = calcITTotal(c);
    const fc = meteoSum?.stats?.freecoolHours || 0;
    const fcN = meteoSum?.stats?.n || 0;
    const fcPct = fcN > 0 ? (fc / fcN * 100).toFixed(1) : '—';
    const isCoolingMode = (c.pue.mode === 'cooling-module');
    const modeLabel = c.pue.mode === 'manual' ? 'вручную' : (c.pue.mode === 'cooling-module' ? 'из подбора cooling' : 'автоматически');
    return `<div class="tw-details-head">
        <h3>📊 Расчёт PUE</h3>
        <span class="muted tw-details-sub">PUE = ${pueVal.toFixed(2)} (${modeLabel})</span>
      </div>
      <div class="tw-details-body">
        <div class="tw-card" data-card-kind="pue" data-card-id="-">
          <div class="tw-grid">
            <label title="Режим расчёта PUE:
• Автоматически — упрощённая формула по топологии охлаждения и meteo (climate fraction).
• Из подбора cooling — берёт активный ★-вариант подбора /cooling/ проекта и считает PUE по реальной симуляции (chillers + CRAC + free-cooling + redundancy + hot/cold standby).
• Вручную — введите готовое значение из внешнего расчёта.">Режим:
              <select data-field="pue.mode" ${ro ? 'disabled' : ''}>
                <option value="auto"${isAuto ? ' selected' : ''}>Автоматически (упрощ. по meteo)</option>
                <option value="cooling-module"${isCoolingMode ? ' selected' : ''}>Из подбора cooling (точный)</option>
                <option value="manual"${c.pue.mode === 'manual' ? ' selected' : ''}>Вручную</option>
              </select>
            </label>
            ${c.pue.mode === 'manual' ? `<label>PUE (вручную):<input type="number" step="0.01" min="1.05" max="3.0" data-field="pue.manualPue" value="${c.pue.manualPue}" ${ro ? 'disabled' : ''}></label>` : ''}
          </div>
          ${isCoolingMode ? `<div class="tw-pue-breakdown" title="Phase 22.4: PUE считается из реальной топологии активного подбора cooling (через simulateTopology). Если подбора нет — fallback на auto-режим.">
            <h5>📐 Источник: подбор cooling</h5>
            <p class="muted tw-details-note">PUE рассчитан из активного ★-варианта подбора холодильных систем проекта. Изменения в /cooling/ (тип чиллера, free-cooling, резервирование, CRAC) — автоматически отражаются здесь.</p>
            <div class="tw-pue-actions">
              <a class="tw-pue-link" href="../cooling/" target="_blank" title="Открыть модуль подбора в новой вкладке. Изменения после возврата применятся к PUE автоматически.">↗ Открыть «Подбор холодильных систем»</a>
            </div>
          </div>` : ''}
          ${isAuto ? (() => {
            // Phase 30.4 (v0.60.63): per-component breakdown с overridable
            // вводами для UPS efficiency / TP efficiency / Aux %.
            const bd = calcPueAutoBreakdown(c, meteoSum).breakdown;
            const pct = (kw, ref = bd.itKw) => ref > 0 ? `${(kw / ref * 100).toFixed(1)}%` : '—';
            return `<div class="tw-pue-breakdown">
            <h5>Per-component breakdown расчёта</h5>
            <div class="tw-mdc-grid">
              <div title="Электрическая нагрузка серверного оборудования (IT) — knd. поле P_IT в формуле PUE = 1 + (P_не-IT) / P_IT">
                <span class="muted">P<sub>IT</sub>:</span> <b>${bd.itKw.toFixed(1)} кВт</b> <span class="muted" style="font-size:11px">(100%)</span>
              </div>
              <div title="Среднегодовое потребление системы охлаждения. Учитывает freecool fraction × COP_fc + (1−ff) × COP_base. См. tab «Cooling system».">
                <span class="muted">P<sub>cooling</sub>:</span> <b>${bd.coolKwAvg.toFixed(1)} кВт</b> <span class="muted" style="font-size:11px">(${pct(bd.coolKwAvg)})</span>
              </div>
              <div title="Потери в ИБП = (1 − η_ups)/η_ups × P_IT. По умолчанию η = 96% (online double-conversion modular).">
                <span class="muted">P<sub>ups-loss</sub>:</span> <b>${bd.upsLossKw.toFixed(2)} кВт</b> <span class="muted" style="font-size:11px">(η ${(bd.etaUps * 100).toFixed(0)}%, ${pct(bd.upsLossKw)})</span>
              </div>
              <div title="Потери в понижающем трансформаторе = (1 − η_tp)/η_tp × P_total_downstream. По умолчанию η = 99% (масляный).">
                <span class="muted">P<sub>tp-loss</sub>:</span> <b>${bd.tpLossKw.toFixed(2)} кВт</b> <span class="muted" style="font-size:11px">(η ${(bd.etaTp * 100).toFixed(0)}%, ${pct(bd.tpLossKw)})</span>
              </div>
              <div title="Aux = aux_fraction × P_IT. Освещение, ОПС, СКУД-CCTV, серверы мониторинга.">
                <span class="muted">P<sub>aux</sub>:</span> <b>${bd.auxKw.toFixed(2)} кВт</b> <span class="muted" style="font-size:11px">(${(bd.auxFraction * 100).toFixed(1)}%)</span>
              </div>
              <div title="Сумма всех не-IT компонентов / P_IT = PUE − 1">
                <span class="muted">Σ не-IT:</span> <b>${bd.totalNonItKw.toFixed(1)} кВт</b> <span style="color:#0d8a4e">(${pct(bd.totalNonItKw)})</span>
              </div>
              <div title="Источник климатических данных (если есть). От этого зависит P_cooling.">
                <span class="muted">Meteo:</span> <b>${meteoSum ? escHtml(meteoSum.locationName || meteoSum.source) : '<i>нет (55%)</i>'}</b>
              </div>
              <div title="PUE = 1 + Σ не-IT / IT. Цель проектирования — минимизировать.">
                <span class="muted">PUE:</span> <b style="color:#1e40af;font-size:14px">${pueVal.toFixed(2)}</b>
              </div>
            </div>
            <details style="margin-top:8px">
              <summary style="cursor:pointer;font-size:12px;color:#475569" title="Раскройте для тонкой настройки defaults">⚙ Тонкая настройка КПД (override)</summary>
              <div class="tw-grid" style="margin-top:8px">
                <label title="КПД ИБП. Online double-conversion modular: 95-97%. Bypass-режим: ~99%. Default 96%."><span style="white-space:nowrap">η<sub>UPS</sub>:</span>
                  <input type="number" step="0.01" min="0.85" max="1.0" data-field="pue.upsEfficiency" value="${bd.etaUps}" ${ro ? 'disabled' : ''} placeholder="0.96"></label>
                <label title="КПД понижающего трансформатора. Масляный 1000 кВА: 98–99%. Сухой: 97–98%. Default 99%."><span style="white-space:nowrap">η<sub>TP</sub>:</span>
                  <input type="number" step="0.01" min="0.90" max="1.0" data-field="pue.tpEfficiency" value="${bd.etaTp}" ${ro ? 'disabled' : ''} placeholder="0.99"></label>
                <label title="Доля aux от IT (освещение, ОПС, СКУД-CCTV, серверы мониторинга). Default 2%."><span style="white-space:nowrap">Aux %:</span>
                  <input type="number" step="0.001" min="0" max="0.10" data-field="pue.auxFraction" value="${bd.auxFraction}" ${ro ? 'disabled' : ''} placeholder="0.02"></label>
              </div>
            </details>
            <p class="tw-pue-note muted">Формула: PUE = 1 + (P<sub>cool</sub> + P<sub>ups-loss</sub> + P<sub>tp-loss</sub> + P<sub>aux</sub>) / P<sub>IT</sub>.<br>
              Каждый компонент выводится из физики: η_ups, η_tp — каталогованные КПД; aux — % от IT.</p>
            ${!meteoSum ? `<div class="tw-pue-warning">
              <p>⚠ Нет загруженных метеоданных. PUE считается по среднестатистическому климату (FreeCool 55%).</p>
              <div class="tw-pue-actions">
                <button type="button" class="tw-bind-btn" data-tw-action="fetch-meteo" ${ro ? 'disabled' : ''}>🌐 Загрузить метео для проекта (1 клик)</button>
                <a class="tw-pue-link" href="../meteo/" target="_blank">↗ Открыть модуль «Метеоданные»</a>
              </div>
            </div>` : `<p class="muted tw-details-note">📍 Источник: <a href="../meteo/" target="_blank">${escHtml(meteoSum.locationName || meteoSum.source)}</a></p>`}
          </div>`; })() : '<p class="muted tw-details-note">В ручном режиме введите PUE напрямую — он будет использован в отчётах и BOM как-есть.</p>'}
        </div>
      </div>`;
  }
  if (sel.kind === 'bom') {
    return _renderBomDetails(c, ro);
  }
  if (sel.kind === 'areas') {
    const areas = calcAreas(c);
    const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
    return `<div class="tw-details-head">
        <h3>📐 Площади помещений</h3>
        <span class="muted tw-details-sub">Σ ${sumM2} м² · расчёт по ТКП 308-2011 / TIA-942</span>
      </div>
      <div class="tw-details-body">
        <table class="tw-areas">
          <thead><tr><th>Помещение</th><th class="num">Площадь, м²</th></tr></thead>
          <tbody>${areas.map(a => `<tr><td>${escHtml(a.name)}</td><td class="num">${a.m2}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><b>Σ</b></td><td class="num"><b>${sumM2}</b></td></tr></tfoot>
        </table>
        <p class="muted tw-details-note">Площади рассчитываются автоматически из параметров стоек, ИБП, климата и ввода. Чтобы изменить — отредактируйте соответствующие блоки слева.</p>
      </div>`;
  }
  return '<div class="tw-details-empty muted">Выберите блок слева.</div>';
}

// v0.59.896 (Etap E): BOM с ценами из каталога по выбранной дате.
// Дата берётся из concept.bomDate (ISO YYYY-MM-DD, default = today).
// Для каждого элемента концепции (rack-group, ups-system, cooling-unit, tp,
// dgu) подбираем самую позднюю цену из price-records с recordedAt ≤ dateMs.
// Если нет — поле «Цена» пустое, юзер может ввести вручную в overrides.
function _renderBomDetails(c, ro) {
  const dateStr = c.bomDate || new Date().toISOString().slice(0, 10);
  const dateMs = new Date(dateStr + 'T23:59:59').getTime();

  // v0.60.280 (по репорту Пользователя 2026-05-06 «опять же валюты нет для
  // цены ... никакого хардкода, позже будет интернационализация и
  // локализация»): валюта BOM привязана к проекту, без хардкода 'RUB'.
  // Selector добавлен в toolbar; default — null (Пользователь обязан выбрать
  // явно в первый раз). Хранится в proj.currency в project-storage.
  const proj = _pid ? getProject(_pid) : null;
  const projCurrency = proj?.currency || '';
  // Список валют — типичные. Когда придёт i18n, расширится из локали.
  const CURRENCY_OPTIONS = ['', 'RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH', 'CNY', 'KGS', 'AMD', 'AZN', 'GEL'];

  const items = _collectBomItems(c);
  // overrides: { [bomKey]: { unitPrice, currency } }
  if (!c.bomOverrides || typeof c.bomOverrides !== 'object') c.bomOverrides = {};
  const ov = c.bomOverrides;

  let grandSum = {};
  const rows = items.map(it => {
    const ovr = ov[it.key];
    let unitPrice = null, currency = null, source = '';
    if (ovr && Number.isFinite(Number(ovr.unitPrice))) {
      unitPrice = Number(ovr.unitPrice);
      // v0.60.280: ручной override наследует валюту проекта, без хардкода.
      currency = ovr.currency || projCurrency || '';
      source = '✏ ручной';
    } else if (it.elementId) {
      const r = pricesForElement(it.elementId, { recordedBefore: dateMs });
      if (r.prices && r.prices.length) {
        unitPrice = Number(r.prices[0].price);
        currency = r.prices[0].currency;
        source = `📋 ${new Date(r.prices[0].recordedAt).toISOString().slice(0,10)}`;
      }
    }
    const total = unitPrice != null ? (unitPrice * it.qty) : null;
    if (total != null && currency) {
      grandSum[currency] = (grandSum[currency] || 0) + total;
    }
    return { ...it, unitPrice, currency, source, total };
  });

  const noPriceCnt = rows.filter(r => r.unitPrice == null).length;
  const sumStr = Object.entries(grandSum).map(([cur, v]) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${cur}`).join(' + ') || '—';

  return `<div class="tw-details-head">
      <h3>📦 BOM (спецификация)</h3>
      <span class="muted tw-details-sub">Σ ${sumStr} ${noPriceCnt > 0 ? `· <span class="tw-bom-warn">${noPriceCnt} без цены</span>` : ''}</span>
    </div>
    <div class="tw-details-body">
      <div class="tw-bom-toolbar">
        <label>Дата для цен:<input type="date" data-field="bomDate" value="${escAttr(dateStr)}" ${ro ? 'disabled' : ''}></label>
        <!-- v0.60.280: валюта проекта (без хардкода) -->
        <label title="Валюта по умолчанию для всех цен проекта. Не путать с валютой конкретного price-record в каталоге цен — там хранится в каком фиксировалась цена. Эта настройка — то, в какой валюте проект ведётся.">Валюта проекта:
          <select id="tw-bom-currency" ${ro ? 'disabled' : ''} style="margin-left:4px">
            ${CURRENCY_OPTIONS.map(c2 => `<option value="${escAttr(c2)}"${c2 === projCurrency ? ' selected' : ''}>${c2 === '' ? '— не выбрана —' : c2}</option>`).join('')}
          </select>
        </label>
        <span class="muted tw-bom-hint">Цена для каждой позиции — самая поздняя из price-records на эту дату. Если цены нет — введите вручную.</span>
        <a class="tw-bom-link" href="../catalog/" target="_blank">📚 Открыть каталог цен →</a>
      </div>
      ${!projCurrency ? `<p class="tw-pue-warning" style="background:#fef3c7;border-left:3px solid #f59e0b">⚠ Валюта проекта не выбрана. Выберите выше — без неё ручные цены не запоминаются. Project-bound: одна валюта на весь проект (вариант 1, вариант 2 и т.п. используют ту же).</p>` : ''}
      <table class="tw-bom-table">
        <thead><tr>
          <th>Позиция</th>
          <th class="num">Кол-во</th>
          <th class="num">Цена за ед.</th>
          <th>Источник</th>
          <th class="num">Итого</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr data-bom-key="${escAttr(r.key)}">
          <td>${escHtml(r.label)}<br><span class="muted">${escHtml(r.subLabel || '')}</span></td>
          <td class="num">${r.qty}</td>
          <td class="num"><input type="number" step="0.01" min="0" class="tw-bom-price" data-bom-key="${escAttr(r.key)}" value="${r.unitPrice != null ? r.unitPrice : ''}" placeholder="—" ${ro ? 'disabled' : ''}> ${r.currency || (projCurrency || '<span class="muted" title="Валюта не выбрана">—</span>')}</td>
          <td><span class="tw-bom-src">${escHtml(r.source || '<i>нет</i>')}</span></td>
          <td class="num">${r.total != null ? `<b>${r.total.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</b> ${r.currency || projCurrency || ''}` : '—'}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td colspan="4"><b>Σ Итого:</b></td>
          <td class="num"><b>${sumStr}</b></td>
        </tr></tfoot>
      </table>
      ${noPriceCnt > 0 ? `<p class="tw-pue-warning">⚠ ${noPriceCnt} позиций без цены. Откройте <a href="../catalog/" target="_blank">каталог цен</a> и добавьте записи (можно историю — расчёт BOM возьмёт цену на нужную дату).</p>` : ''}
    </div>`;
}

// v0.59.896: собирает позиции для BOM из концепции.
//   key — стабильный id (для overrides), elementId — id из catalog (для price lookup),
//   label — отображение, qty — количество, subLabel — детали.
function _collectBomItems(c) {
  const out = [];
  for (const rg of (c.rackGroups || [])) {
    if (!rg.count) continue;
    out.push({
      key: 'rack:' + rg.id,
      elementId: rg.modelRef?.id || null,
      label: `Стойка — ${rg.name || ''}`,
      subLabel: rg.modelRef ? `${rg.modelRef.manufacturer || ''} ${rg.modelRef.model || ''}` : 'модель не привязана',
      qty: rg.count,
    });
    out.push({
      key: 'pdu:' + rg.id,
      elementId: rg.pdu?.modelRef?.id || null,
      label: `PDU для «${rg.name || ''}»`,
      subLabel: rg.pdu ? `${rg.pdu.kind} ${rg.pdu.phases} ${rg.pdu.ratingA}А ×${rg.pdu.inputsPerRack}` : '',
      qty: (rg.count || 0) * (rg.pdu?.inputsPerRack || 0),
    });
  }
  for (const us of (c.upsSystems || [])) {
    if (!us.count) continue;
    out.push({
      key: 'ups:' + us.id,
      elementId: us.modelRef?.id || null,
      label: `ИБП — ${us.name || ''}`,
      subLabel: us.modelRef ? `${us.modelRef.manufacturer || ''} ${us.modelRef.model || ''} · ${us.ratedKva} кВА` : `${us.ratedKva} кВА (модель не привязана)`,
      qty: us.count,
    });
  }
  for (const cu of (c.coolingUnits || [])) {
    if (!cu.count) continue;
    out.push({
      key: 'cool:' + cu.id,
      elementId: cu.modelRef?.id || null,
      label: `Кондиционер — ${cu.name || ''}`,
      subLabel: cu.modelRef ? `${cu.modelRef.manufacturer || ''} ${cu.modelRef.model || ''}` : `${cu.kwPerUnit} кВт холода`,
      qty: cu.count,
    });
  }
  if (c.feed?.tp?.needed) {
    out.push({
      key: 'tp',
      elementId: c.feed.tp.modelRef?.id || null,
      label: 'ТП (трансформатор)',
      subLabel: c.feed.tp.modelRef ? `${c.feed.tp.modelRef.manufacturer || ''} ${c.feed.tp.modelRef.model || ''} · ${c.feed.tp.kva} кВА` : `${c.feed.tp.kva} кВА`,
      qty: c.feed.tp.redundancy === '2' || c.feed.tp.redundancy === '2-avr' ? 2 : 1,
    });
  }
  if (c.feed?.dgu?.needed) {
    out.push({
      key: 'dgu',
      elementId: c.feed.dgu.modelRef?.id || null,
      label: 'ДГУ',
      subLabel: c.feed.dgu.modelRef ? `${c.feed.dgu.modelRef.manufacturer || ''} ${c.feed.dgu.modelRef.model || ''} · ${c.feed.dgu.kw} кВт` : `${c.feed.dgu.kw} кВт`,
      qty: c.feed.dgu.redundancy === '2N' ? 2 : (c.feed.dgu.redundancy === 'N+1' ? 2 : 1),
    });
  }
  // v0.59.897: МЦОД-здания в BOM. Здание целиком (не разворачивая на модули —
  // BOM модулей лежит внутри mdc-config sub-проекта). На цену МЦОД-здания
  // элемента в каталоге обычно нет — юзер вводит вручную или цена приходит
  // через mdc-config (на следующих этапах будет интеграция).
  for (const b of (c.mdcBuildings || [])) {
    const s = _readMdcSummary(b.mdcSubProjectId);
    out.push({
      key: 'mdc:' + b.id,
      elementId: null,  // у МЦОД нет catalog-id; цена вручную или из сметы mdc-config
      label: `МЦОД — ${b.name || ''}`,
      subLabel: s
        ? `${b.configurator.toUpperCase()} · ${s.totalRacks} стоек × ${s.rackKw} кВт`
        : `${b.configurator.toUpperCase()} · не сконфигурирован`,
      qty: Number(b.count) || 1,
    });
  }
  return out;
}

// v0.59.901: «Карточки» — все блоки развёрнуты (как было до v0.59.892)
function renderAllCardsLayout(c, ro) {
  return `<div class="tw-cards-layout">
    <section class="tw-cards-section">
      <div class="tw-section-head">
        <h3>🏷 Объект</h3>
      </div>
      ${renderDetails(c, ro).replace(/<div class="tw-details-head">[\s\S]*?<\/div>/, '')}
    </section>
    <section class="tw-cards-section">
      <div class="tw-section-head"><h3>🗄 Группы стоек</h3>
        <button type="button" class="tw-add-btn" data-add-card="rack" ${ro ? 'disabled' : ''}>➕ Группа стоек</button>
      </div>
      ${(c.rackGroups || []).map(rg => renderRackGroupCard(rg, ro, c.rooms)).join('') || '<p class="muted">Нет групп.</p>'}
    </section>
    <section class="tw-cards-section">
      <div class="tw-section-head"><h3>⚡ Системы ИБП</h3>
        <button type="button" class="tw-add-btn" data-add-card="ups" ${ro ? 'disabled' : ''}>➕ Система ИБП</button>
      </div>
      ${(c.upsSystems || []).map(us => renderUpsCard(us, ro, c.rooms)).join('') || '<p class="muted">Нет.</p>'}
    </section>
    <section class="tw-cards-section">
      <div class="tw-section-head"><h3>❄ Климат</h3>
        <button type="button" class="tw-add-btn" data-add-card="cool" ${ro ? 'disabled' : ''}>➕ Группа</button>
      </div>
      ${(c.coolingUnits || []).map(cu => renderCoolCard(cu, ro, c.rooms)).join('') || '<p class="muted">Нет.</p>'}
    </section>
    <section class="tw-cards-section">
      <div class="tw-section-head"><h3>🔌 Ввод</h3></div>
      ${renderFeedSection(c.feed, ro, c)}
    </section>
  </div>`;
}

// v0.59.901: «Таблица» — узкая сводная таблица для bulk-обзора
function renderTableLayout(c, ro) {
  const rgRows = (c.rackGroups || []).map(rg =>
    `<tr><td>🗄</td><td>${escHtml(rg.name)}</td><td class="num">${rg.count}</td><td class="num">${rg.kwPerRack} кВт</td><td>${rg.profile}</td><td>${rg.widthMm}×${rg.depthMm}</td><td>${rg.pdu?.kind || '—'} ${rg.pdu?.ratingA || ''}А</td></tr>`).join('');
  const usRows = (c.upsSystems || []).map(us =>
    `<tr><td>⚡</td><td>${escHtml(us.name)}</td><td class="num">${us.count}</td><td class="num">${us.ratedKva} кВА</td><td>${us.purpose}</td><td>${us.redundancy}</td><td>${us.batteryTech}</td></tr>`).join('');
  const cuRows = (c.coolingUnits || []).map(cu =>
    `<tr><td>❄</td><td>${escHtml(cu.name)}</td><td class="num">${cu.count}</td><td class="num">${cu.kwPerUnit} кВт</td><td>${cu.type}</td><td>${cu.redundancy}</td><td>—</td></tr>`).join('');
  return `<div class="tw-table-layout">
    <p class="muted tw-details-note">Сводная read-only таблица всех блоков. Для редактирования переключитесь на «📋 Сплит» или «🗂 Карточки».</p>
    <table class="tw-summary-table">
      <thead><tr><th></th><th>Имя</th><th class="num">Кол-во</th><th class="num">Мощность</th><th>Тип</th><th>Резерв</th><th>Доп.</th></tr></thead>
      <tbody>${rgRows}${usRows}${cuRows}</tbody>
    </table>
  </div>`;
}

function _detailsHeaderHtml(title, id, ro, kind, summary) {
  return `<div class="tw-details-head">
    <h3>${title}</h3>
    <span class="muted tw-details-sub">${escHtml(summary)}</span>
    <span class="tw-details-actions">
      <button type="button" class="tw-details-btn" data-block-action="duplicate" data-bk="${kind}" data-bid="${escAttr(id)}" title="Дублировать блок" ${ro ? 'disabled' : ''}>📋 Дублировать</button>
      <button type="button" class="tw-details-btn tw-details-btn-danger" data-block-action="delete" data-bk="${kind}" data-bid="${escAttr(id)}" title="Удалить блок" ${ro ? 'disabled' : ''}>🗑 Удалить</button>
    </span>
  </div>
  <div class="tw-details-body">`;
}

// v0.59.892: Bulk-toolbar для стоек — применить размеры/PDU параметры ко всем
// группам сразу. Появляется только если групп ≥2.
function _bulkRackToolbar(c, ro) {
  const groups = c.rackGroups || [];
  if (groups.length < 2) return '</div>';
  return `</div>
  <div class="tw-bulk-toolbar">
    <h5>📦 Применить ко всем группам стоек</h5>
    <div class="tw-bulk-row">
      <span class="muted">Габариты:</span>
      <button type="button" class="tw-bulk-btn" data-bulk="rack-size" data-w="600" data-d="1000" ${ro ? 'disabled' : ''}>600 × 1000</button>
      <button type="button" class="tw-bulk-btn" data-bulk="rack-size" data-w="600" data-d="1200" ${ro ? 'disabled' : ''}>600 × 1200</button>
      <button type="button" class="tw-bulk-btn" data-bulk="rack-size" data-w="800" data-d="1200" ${ro ? 'disabled' : ''}>800 × 1200</button>
      <button type="button" class="tw-bulk-btn" data-bulk="rack-size" data-w="800" data-d="1100" ${ro ? 'disabled' : ''}>800 × 1100</button>
    </div>
    <div class="tw-bulk-row">
      <span class="muted">PDU:</span>
      <button type="button" class="tw-bulk-btn" data-bulk="pdu" data-kind="metered" data-rating="32" data-inputs="2" ${ro ? 'disabled' : ''}>Metered 32А ×2</button>
      <button type="button" class="tw-bulk-btn" data-bulk="pdu" data-kind="switched" data-rating="32" data-inputs="2" ${ro ? 'disabled' : ''}>Switched 32А ×2</button>
      <button type="button" class="tw-bulk-btn" data-bulk="pdu" data-kind="basic" data-rating="16" data-inputs="2" ${ro ? 'disabled' : ''}>Basic 16А ×2</button>
    </div>
  </div>`;
}

// ─── Render: active variant (right pane)
function renderActiveVariant() {
  const v = _variants.find(x => x.id === _activeId);
  const empty = $('tw-empty-state');
  const listPane = $('tw-mode-list');
  const planPane = $('tw-mode-plan');
  const comparePane = $('tw-mode-compare');
  const handoffBtn = $('tw-handoff');
  if (!v) {
    if (empty) empty.style.display = 'flex';
    if (listPane) listPane.hidden = true;
    if (planPane) planPane.hidden = true;
    if (comparePane) comparePane.hidden = true;
    if (handoffBtn) handoffBtn.disabled = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (handoffBtn) handoffBtn.disabled = !!v.readOnly;
  if (listPane) listPane.hidden = (_mode !== 'list');
  if (planPane) planPane.hidden = (_mode !== 'plan');
  if (comparePane) comparePane.hidden = (_mode !== 'compare');
  if (_mode === 'compare') renderCompareMode();
  $('tw-variant-name').textContent = v.name + (v.primary ? ' ⭐' : '');
  $('tw-readonly-badge').hidden = !v.readOnly;
  // v0.60.134 (репорт Пользователя 2026-05-04 «основные данные проекта
  // опять не передаются»): автосинк projectData из метаданных проекта на
  // КАЖДОМ render. preserve-on-miss (setIfEmpty) сохраняет ручные правки —
  // заполняются только пустые поля. Раньше синк был ТОЛЬКО на init() /
  // addVariant() / клик «🔄 Синхр», поэтому при изменении requisites в
  // /projects/ (или при открытии TW в проекте, где requisites уже
  // заполнены, но variant создан до того) данные не подхватывались.
  // setIfEmpty гарантирует idempotent — повторный вызов без эффекта если
  // поля уже заполнены (вручную или из предыдущего синка).
  if (_syncProjectDataFromProject(v.concept)) persistVariants();
  const c = v.concept;
  const ro = !!v.readOnly;
  // Compute summaries
  const itKw = calcITTotal(c);
  const upsByPurpose = calcUpsByPurpose(c);
  const coolKw = calcCoolTotal(c);
  const feedKw = calcFeedTotal(c);
  const areas = calcAreas(c);
  const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
  const upsItKw = upsByPurpose.it + upsByPurpose.mixed;
  const totalRacks = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);

  // Build list pane HTML (two-panel rail + details)
  if (listPane && _mode === 'list') {
    _ensureSelectedBlock(c);
    // Top summary bar — ключевые KPI
    const upsItOk = (itKw > 0 && upsItKw >= itKw);
    const coolOk = (itKw > 0 && coolKw >= itKw);
    // v0.59.897: МЦОД-итоги в summary-bar (если хотя бы одно здание сконфигурировано)
    const mdcStats = (c.mdcBuildings || []).reduce((acc, b) => {
      const s = _readMdcSummary(b.mdcSubProjectId);
      if (!s) return acc;
      const cnt = Number(b.count) || 1;
      acc.racks += s.totalRacks * cnt;
      acc.kw += s.itKw * cnt;
      acc.buildings += cnt;
      return acc;
    }, { racks: 0, kw: 0, buildings: 0 });
    const meteoSum = _readMeteoSummary();
    const pueVal = calcPue(c, meteoSum);
    // v0.60.90: tooltips на каждом KPI с пояснением что это и из чего получено.
    // По требованию Пользователя 2026-05-03 «для всех параметров подсказку по
    // тому что это и из чего получено».
    const summaryBar = `<div class="tw-summary-bar">
      <div class="tw-kpi" title="Общее количество серверных стоек = Σ rackGroups.count + Σ mdcBuildings (rackов в МЦОД-блоках). Заполняется в блоке «🗄 Стойки» и «🏢 МЦОД».">
        <span class="tw-kpi-lbl">Стоек</span>
        <span class="tw-kpi-val">${totalRacks}${mdcStats.racks > 0 ? `<small>+${mdcStats.racks}МЦОД</small>` : ''}</span>
      </div>
      <div class="tw-kpi" title="Полезная IT-нагрузка = Σ rackGroups (count × kwPerRack) + Σ MDC IT-нагрузка. Это электрическая нагрузка серверов (без климата и потерь). Используется как P_IT в PUE-формуле.">
        <span class="tw-kpi-lbl">IT-нагрузка</span>
        <span class="tw-kpi-val">${(itKw + mdcStats.kw).toFixed(1)} <small>кВт</small></span>
      </div>
      <div class="tw-kpi ${itKw > 0 ? (upsItOk ? 'ok' : 'bad') : ''}" title="Доступная мощность ИБП для IT-нагрузки = Σ upsSystems.{count × ratedKva × cosPhi × loadFactor} × redundancy_factor. Зелёный если ≥ IT-нагрузка, красный если меньше. Резервирование: N+1 / 2N учитывается.">
        <span class="tw-kpi-lbl">⚡ ИБП IT</span>
        <span class="tw-kpi-val">${upsItKw.toFixed(1)} <small>кВт</small></span>
      </div>
      <div class="tw-kpi ${itKw > 0 ? (coolOk ? 'ok' : 'bad') : ''}" title="Холодопроизводительность = Σ coolingUnits.{count × kwPerUnit × redundancy_factor}. Должна покрывать IT-нагрузку с запасом ~5-10%. Зелёный если хватает, красный если меньше IT.">
        <span class="tw-kpi-lbl">❄ Холод</span>
        <span class="tw-kpi-val">${coolKw.toFixed(1)} <small>кВт</small></span>
      </div>
      <div class="tw-kpi" title="Общая принятая электрическая мощность объекта = (IT + Cooling + UPS_loss + Aux) с коэффициентом одновременности ~0.7. Используется для расчёта мощности ТП/ДГУ. Это значение служит для авто-подбора в блоке «🔌 Ввод».">
        <span class="tw-kpi-lbl">Σ Принятая</span>
        <span class="tw-kpi-val">${feedKw.toFixed(1)} <small>кВт</small></span>
      </div>
      <div class="tw-kpi" title="Power Usage Effectiveness = P_total / P_IT. Меньше = эффективнее (1.0 — идеал, 1.4 — типичный современный ЦОД). Расчёт: см. «📊 Расчёт PUE» — режим auto/cooling-module/manual. P_total = IT + Cooling + UPS_loss + TP_loss + Aux.">
        <span class="tw-kpi-lbl">📊 PUE</span>
        <span class="tw-kpi-val">${pueVal.toFixed(2)}</span>
      </div>
      <div class="tw-kpi" title="Σ площадей всех помещений (машзал, ИБП-зал, климат-зал, АКБ-зал, ДГУ, ТП, диспетчерская). Расчёт по ТКП 308-2011 / TIA-942 с коэффициентами на тип помещения. Заполняется автоматически из количества стоек/ИБП/климата.">
        <span class="tw-kpi-lbl">Площадь</span>
        <span class="tw-kpi-val">${sumM2} <small>м²</small></span>
      </div>
    </div>`;

    // v0.59.901: layout-mode picker над summary
    const layoutPicker = `<div class="tw-layout-picker">
      <span class="muted tw-layout-lbl">Вид:</span>
      <button type="button" class="tw-layout-btn${_layoutMode === 'split' ? ' active' : ''}" data-layout="split" title="Список + детали (по умолчанию)">📋 Сплит</button>
      <button type="button" class="tw-layout-btn${_layoutMode === 'cards' ? ' active' : ''}" data-layout="cards" title="Все блоки развёрнуты">🗂 Карточки</button>
      <button type="button" class="tw-layout-btn${_layoutMode === 'compact' ? ' active' : ''}" data-layout="compact" title="Узкий список без деталей">📑 Компакт</button>
      <button type="button" class="tw-layout-btn${_layoutMode === 'table' ? ' active' : ''}" data-layout="table" title="Сводная таблица всех блоков">📊 Таблица</button>
    </div>`;

    let bodyHtml = '';
    if (_layoutMode === 'split') {
      bodyHtml = `<div class="tw-list-layout">
        <aside class="tw-list-rail">${renderListRail(c, ro)}</aside>
        <div class="tw-list-details">${renderDetails(c, ro)}</div>
      </div>`;
    } else if (_layoutMode === 'cards') {
      bodyHtml = renderAllCardsLayout(c, ro);
    } else if (_layoutMode === 'compact') {
      bodyHtml = `<div class="tw-list-layout tw-layout-compact">
        <aside class="tw-list-rail">${renderListRail(c, ro)}</aside>
      </div>`;
    } else if (_layoutMode === 'table') {
      bodyHtml = renderTableLayout(c, ro);
    }

    listPane.innerHTML = `${layoutPicker}${summaryBar}${bodyHtml}`;
    $('tw-content-summary').textContent = `${totalRacks} стоек · ${itKw.toFixed(1)} кВт IT · Σ ${sumM2} м²`;
  }
}

// ─── Persistence
function persistVariants() { saveJson(KEY_VARIANTS, _variants); }
function persistActive() { saveJson(KEY_ACTIVE, _activeId); }

// ─── Field bindings via event delegation
// Каждая card имеет data-card-kind + data-card-id + data-field на input/select.
// Контейнер #tw-mode-list слушает только `change` event (НЕ `input`).
//
// ВАЖНО (MEMORY.md → feedback_input_event.md): при re-render через
// innerHTML на каждый keystroke (input event) браузер теряет фокус ввода
// — пользователь набирает 1 символ за раз. Решение: использовать `change`
// (fires on blur / Enter) — после ввода полного значения. Пользователь просил
// дважды: «символы можно вводить только по одному так как теряется фокус».
function bindListEvents() {
  const root = $('tw-mode-list');
  if (!root) return;
  const handle = (e) => {
    const cur = _variants.find(x => x.id === _activeId);
    if (!cur || cur.readOnly) return;
    const target = e.target;
    if (!target || (!target.matches('input, select, textarea'))) return;
    const card = target.closest('.tw-card');
    const field = target.dataset.field;
    // v0.60.114: чек-боксы roomIds в shared-cooling карточке.
    const coolRoomToggle = target.dataset.coolRoomToggle;
    if (coolRoomToggle && card && card.dataset.cardKind === 'cool') {
      const cuId = card.dataset.cardId;
      const cuObj = (cur.concept.coolingUnits || []).find(x => x.id === cuId);
      if (cuObj) {
        if (!Array.isArray(cuObj.roomIds)) cuObj.roomIds = [];
        if (target.checked) {
          if (!cuObj.roomIds.includes(coolRoomToggle)) cuObj.roomIds.push(coolRoomToggle);
        } else {
          cuObj.roomIds = cuObj.roomIds.filter(x => x !== coolRoomToggle);
        }
        persistVariants(); renderActiveVariant();
      }
      return;
    }
    // BOM-цены не имеют data-field (они идентифицируются через data-bom-key)
    if (!field && !target.classList.contains('tw-bom-price')) return;
    const value = (target.type === 'checkbox') ? target.checked
      : (target.type === 'number' ? Number(target.value) || 0 : target.value);
    // Early-handle BOM price overrides (изолировано от card-kind branching).
    // v0.60.280: валюта НЕ хардкодим — берём из proj.currency. Если не выбрана,
    // override записывается с currency='' (Пользователь увидит warning сверху
    // BOM и сможет выбрать).
    if (target.classList.contains('tw-bom-price')) {
      const key = target.dataset.bomKey;
      if (!key) return;
      if (!cur.concept.bomOverrides) cur.concept.bomOverrides = {};
      if (target.value === '') delete cur.concept.bomOverrides[key];
      else {
        const proj = _pid ? getProject(_pid) : null;
        const projCurrency = proj?.currency || '';
        cur.concept.bomOverrides[key] = { unitPrice: Number(target.value) || 0, currency: projCurrency };
      }
      persistVariants(); renderActiveVariant();
      return;
    }
    // v0.60.280: смена валюты проекта — пишем в project-storage и
    // перерисовываем все варианты. Project-bound: одна валюта на весь проект.
    if (target.id === 'tw-bom-currency') {
      try {
        if (_pid) {
          updateProject(_pid, { currency: target.value || '' });
          renderActiveVariant();
        }
      } catch (e) { console.warn('[tw] currency save failed:', e); }
      return;
    }
    if (card) {
      const kind = card.dataset.cardKind;
      const id = card.dataset.cardId;
      // PUE-карточка хранит данные в concept.pue (объект, не массив)
      if (kind === 'pue') {
        if (!cur.concept.pue) cur.concept.pue = { mode: 'auto', value: 1.4, manualPue: 1.4 };
        _setNested(cur.concept, field, value);
        persistVariants();
        renderActiveVariant();
        return;
      }
      // v0.59.900: project-карточка хранит в concept.projectData
      if (kind === 'project') {
        if (!cur.concept.projectData) cur.concept.projectData = {};
        // input type="number" возвращает 0 на пустой строке — храним null чтобы
        // пользовательские параметры не перезаписывались случайно (sacred params правило)
        const v = (target.type === 'number' && target.value === '') ? null : value;
        _setNested(cur.concept, field, v);
        persistVariants();
        renderActiveVariant();
        return;
      }
      // v0.59.901: coolsys-карточка хранит в concept.coolingSystem
      if (kind === 'coolsys') {
        if (!cur.concept.coolingSystem) cur.concept.coolingSystem = newCoolingSystem();
        _setNested(cur.concept, field, value);
        persistVariants();
        renderActiveVariant();
        return;
      }
      const arrName = kind === 'rack' ? 'rackGroups'
        : kind === 'ups' ? 'upsSystems'
        : kind === 'cool' ? 'coolingUnits'
        : kind === 'mdc' ? 'mdcBuildings'
        : kind === 'room' ? 'rooms'
        : null;
      if (!arrName) return;
      const arr = cur.concept[arrName];
      const obj = arr.find(x => x.id === id);
      if (!obj) return;
      // v0.60.145 (по уточнению Пользователя 2026-05-04 «не нужно блокировать
      // ввод, а только ограничить выход за пределы класса»): для T/RH полей
      // в room.climate — clamp значение к диапазону класса перед сохранением.
      // Если class='custom' — clamp не применяется (свободный ввод).
      let _saveValue = (kind === 'ups' && field === 'loadFactor') ? value / 100 : value;
      if (kind === 'room' && /^climate\.(tMinC|tMaxC|rhMinPct|rhMaxPct)$/.test(field)) {
        const _curClass = obj.climate?.ashraeClass || 'A1';
        const _def = ASHRAE_CLASSES[_curClass];
        if (_def && _curClass !== 'custom') {
          const _isT = field.startsWith('climate.t');
          const _lo = _isT ? _def.tMinC : _def.rhMinPct;
          const _hi = _isT ? _def.tMaxC : _def.rhMaxPct;
          const _orig = Number(value);
          if (Number.isFinite(_orig) && Number.isFinite(_lo) && Number.isFinite(_hi)) {
            const _clamped = Math.max(_lo, Math.min(_hi, _orig));
            if (_clamped !== _orig) {
              _saveValue = _clamped;
              try {
                twToast(`Значение ${_orig} вне диапазона класса ${_curClass} (${_lo}…${_hi}) — установлено ${_clamped}.`, 'warn');
              } catch {}
              // Reflect clamp visually на input.
              try { target.value = String(_clamped); } catch {}
            }
          }
        }
      }
      // Поддержка nested путей вроде "pdu.kind"
      _setNested(obj, field, _saveValue);
      // v0.60.143: смена ASHRAE-класса в room → авто-применить диапазон
      // класса к T/RH min/max ТОЛЬКО если existing values вне нового
      // диапазона. По уточнению v0.60.145 — Пользователь хочет сохранять
      // свои значения внутри диапазона, не пересбрасывать на envelope.
      if (kind === 'room' && field === 'climate.ashraeClass') {
        if (!obj.climate) obj.climate = {};
        const _newDef = ASHRAE_CLASSES[value];
        if (_newDef && value !== 'custom') {
          // Clamp existing values в новый диапазон (не сброс на bounds!).
          const _clampField = (f, lo, hi) => {
            const v = Number(obj.climate[f]);
            if (!Number.isFinite(v)) { obj.climate[f] = lo; return; }
            obj.climate[f] = Math.max(lo, Math.min(hi, v));
          };
          _clampField('tMinC',     _newDef.tMinC,     _newDef.tMaxC);
          _clampField('tMaxC',     _newDef.tMinC,     _newDef.tMaxC);
          _clampField('rhMinPct',  _newDef.rhMinPct,  _newDef.rhMaxPct);
          _clampField('rhMaxPct',  _newDef.rhMinPct,  _newDef.rhMaxPct);
        }
      }
      // v0.60.113: при смене scope климата (room ↔ shared) мигрируем
      // roomId ↔ roomIds[]. Иначе UI показывает picker без значения.
      if (kind === 'cool' && field === 'scope') {
        if (value === 'shared') {
          if (obj.roomId && (!Array.isArray(obj.roomIds) || obj.roomIds.length === 0)) {
            obj.roomIds = [obj.roomId];
          }
          if (!Array.isArray(obj.roomIds)) obj.roomIds = [];
        } else if (value === 'room') {
          if ((!obj.roomId || !cur.concept.rooms?.some(r => r.id === obj.roomId)) && Array.isArray(obj.roomIds) && obj.roomIds.length) {
            obj.roomId = obj.roomIds[0];
          }
          if (!obj.roomId && cur.concept.rooms?.[0]) {
            obj.roomId = cur.concept.rooms[0].id;
          }
        }
      }
    } else if (target.classList.contains('tw-bom-price')) {
      // BOM override (per-row price input)
      const key = target.dataset.bomKey;
      if (!key) return;
      if (!cur.concept.bomOverrides) cur.concept.bomOverrides = {};
      if (target.value === '') delete cur.concept.bomOverrides[key];
      else cur.concept.bomOverrides[key] = { unitPrice: Number(target.value) || 0, currency: 'RUB' };
    } else if (field === 'bomDate') {
      cur.concept.bomDate = target.value;
    } else {
      // feed.tp.* / feed.dgu.* — относится к concept.feed
      _setNested(cur.concept.feed, field, value);
    }
    persistVariants();
    renderActiveVariant();
  };
  // ТОЛЬКО change — НЕ input. Иначе фокус теряется на каждом keystroke.
  root.addEventListener('change', handle);
  // Кнопки add/delete card / rail-item click / block-actions / bulk-toolbar
  root.addEventListener('click', async (e) => {
    const cur = _variants.find(x => x.id === _activeId);
    if (!cur) return;

    // v0.59.901: layout-mode buttons
    const layoutBtn = e.target.closest('.tw-layout-btn[data-layout]');
    if (layoutBtn) {
      _layoutMode = layoutBtn.dataset.layout;
      saveJson(KEY_LAYOUT, _layoutMode);
      renderActiveVariant();
      return;
    }

    // Rail item click → выбор блока (работает даже в read-only)
    const railItem = e.target.closest('.tw-rail-item[data-bk]');
    if (railItem) {
      const bk = railItem.dataset.bk;
      const bid = railItem.dataset.bid || null;
      _selectedBlock = { kind: bk, id: bid };
      renderActiveVariant();
      return;
    }

    if (cur.readOnly) return;

    // ➕ Добавить блок (из rail)
    const addBtn = e.target.closest('[data-add-card]');
    if (addBtn) {
      const kind = addBtn.dataset.addCard;
      let newObj = null;
      if (kind === 'rack') {
        newObj = newRackGroup(`Группа ${cur.concept.rackGroups.length + 1}`);
        cur.concept.rackGroups.push(newObj);
      } else if (kind === 'ups') {
        newObj = newUpsSystem('ИБП', 'it');
        cur.concept.upsSystems.push(newObj);
      } else if (kind === 'cool') {
        newObj = newCoolingUnit('Климат');
        cur.concept.coolingUnits.push(newObj);
      } else if (kind === 'mdc') {
        if (!Array.isArray(cur.concept.mdcBuildings)) cur.concept.mdcBuildings = [];
        newObj = newMdcBuilding(`МЦОД-${cur.concept.mdcBuildings.length + 1}`);
        cur.concept.mdcBuildings.push(newObj);
      } else if (kind === 'room') {
        // v0.60.113: добавить помещение объекта.
        if (!Array.isArray(cur.concept.rooms)) cur.concept.rooms = [];
        const n = cur.concept.rooms.length + 1;
        newObj = newRoom(`Зал ${n}`, 'it');
        cur.concept.rooms.push(newObj);
      }
      if (newObj) _selectedBlock = { kind, id: newObj.id };
      persistVariants(); renderActiveVariant();
      return;
    }

    // 🗑 Удалить / 📋 Дублировать блок (из details-header)
    const blockAct = e.target.closest('[data-block-action]');
    if (blockAct) {
      const act = blockAct.dataset.blockAction;
      const bk = blockAct.dataset.bk;
      const bid = blockAct.dataset.bid;
      const arrName = bk === 'rack' ? 'rackGroups'
        : bk === 'ups' ? 'upsSystems'
        : bk === 'cool' ? 'coolingUnits'
        : bk === 'mdc' ? 'mdcBuildings'
        : bk === 'room' ? 'rooms'
        : null;
      if (!arrName) return;
      const arr = cur.concept[arrName];
      const idx = arr.findIndex(x => x.id === bid);
      if (idx < 0) return;
      if (act === 'delete') {
        // mdcBuildings допускает 0 (стационарный ЦОД), для остальных — last guard
        const allowEmpty = (bk === 'mdc');
        if (!allowEmpty && arr.length === 1) {
          twToast('Нельзя удалить последний блок этого типа. Добавьте ещё один перед удалением.', 'warn');
          return;
        }
        // v0.60.113: при удалении помещения переназначаем оборудование на
        // соседнее (или null если последнее). Sacred-params: предупреждаем
        // юзера какие группы потеряют roomId.
        if (bk === 'room') {
          const removingId = arr[idx].id;
          const nextRoomId = (arr[idx + 1] || arr[idx - 1])?.id || null;
          const orphans = [];
          (cur.concept.rackGroups || []).forEach(rg => {
            if (rg.roomId === removingId) { rg.roomId = nextRoomId; orphans.push('стойки «' + (rg.name || '') + '»'); }
          });
          (cur.concept.upsSystems || []).forEach(us => {
            if (us.roomId === removingId) { us.roomId = nextRoomId; orphans.push('ИБП «' + (us.name || '') + '»'); }
          });
          (cur.concept.coolingUnits || []).forEach(cuRoom => {
            if (cuRoom.scope === 'room' && cuRoom.roomId === removingId) {
              cuRoom.roomId = nextRoomId;
              orphans.push('климат «' + (cuRoom.name || '') + '»');
            }
            if (cuRoom.scope === 'shared' && Array.isArray(cuRoom.roomIds)) {
              cuRoom.roomIds = cuRoom.roomIds.filter(x => x !== removingId);
            }
          });
          const warnLine = orphans.length
            ? `\n\nПривязанное оборудование (${orphans.length}):\n• ${orphans.slice(0, 5).join('\n• ')}${orphans.length > 5 ? `\n• …и ещё ${orphans.length - 5}` : ''}\n\nБудет перепривязано к «${arr.find(r => r.id === nextRoomId)?.name || '(нет)'}».`
            : '';
          const ok = await twConfirm(`Удалить помещение «${arr[idx].name || ''}»?${warnLine}`, 'Удаление помещения');
          if (!ok) return;
          arr.splice(idx, 1);
          const next = arr[Math.min(idx, arr.length - 1)];
          _selectedBlock = next ? { kind: 'room', id: next.id } : { kind: 'project', id: null };
          persistVariants(); renderActiveVariant();
          return;
        }
        const ok = await twConfirm(`Удалить блок «${arr[idx].name || ''}»?`, 'Удаление блока');
        if (!ok) return;
        arr.splice(idx, 1);
        // Перевыбрать соседний блок
        const next = arr[Math.min(idx, arr.length - 1)];
        _selectedBlock = next ? { kind: bk, id: next.id } : { kind: 'feed', id: null };
        persistVariants(); renderActiveVariant();
      } else if (act === 'duplicate') {
        const copy = JSON.parse(JSON.stringify(arr[idx]));
        copy.id = _newId(bk === 'rack' ? 'rg' : bk === 'ups' ? 'us' : bk === 'mdc' ? 'mdc' : bk === 'room' ? 'rm' : 'cu');
        copy.name = (arr[idx].name || '') + ' (копия)';
        // Для МЦОД: при duplicate привязка к sub-проекту НЕ копируется —
        // юзер должен явно создать или привязать новое здание (иначе два
        // блока ссылаются на один и тот же sub-проект, что путает summary).
        if (bk === 'mdc') copy.mdcSubProjectId = null;
        arr.splice(idx + 1, 0, copy);
        _selectedBlock = { kind: bk, id: copy.id };
        persistVariants(); renderActiveVariant();
      }
      return;
    }

    // 🏢 МЦОД actions: open / create / link / unlink
    const mdcAct = e.target.closest('[data-mdc-action]');
    if (mdcAct) {
      const act = mdcAct.dataset.mdcAction;
      const bid = mdcAct.dataset.bid;
      const b = (cur.concept.mdcBuildings || []).find(x => x.id === bid);
      if (!b) return;
      if (act === 'open') {
        if (b.mdcSubProjectId) {
          // mdc-config читает active project из LS — переключаем перед переходом
          try { localStorage.setItem('raschet.activeProject.v1', JSON.stringify({ id: b.mdcSubProjectId })); } catch {}
          location.href = `../mdc-config/?project=${encodeURIComponent(b.mdcSubProjectId)}`;
        }
      } else if (act === 'create') {
        // Создать новый sub-project mdc-config внутри текущего родителя
        if (!_pid) { twToast('Нет активного проекта.', 'warn'); return; }
        const sub = createSubProject(_pid, 'mdc-config', { name: b.name, designation: b.name });
        b.mdcSubProjectId = sub.id;
        persistVariants();
        try { localStorage.setItem('raschet.activeProject.v1', JSON.stringify({ id: sub.id })); } catch {}
        location.href = `../mdc-config/?project=${encodeURIComponent(sub.id)}`;
      } else if (act === 'link') {
        const subProjects = listSubProjects(_pid, 'mdc-config');
        if (!subProjects.length) { twToast('Нет существующих МЦОД sub-проектов в этом проекте.', 'warn'); return; }
        const picked = await twPickFromList(subProjects.map(p => ({ id: p.id, label: `${p.name} ${p.designation ? `(${p.designation})` : ''}` })), 'Выбор существующего МЦОД');
        if (!picked) return;
        b.mdcSubProjectId = picked;
        persistVariants(); renderActiveVariant();
      } else if (act === 'unlink') {
        const ok = await twConfirm(`Отвязать здание «${b.name}» от sub-проекта? Сам sub-проект не удаляется.`, 'Отвязать');
        if (!ok) return;
        b.mdcSubProjectId = null;
        persistVariants(); renderActiveVariant();
      }
      return;
    }

    // 🗺 Pick location — открывает station-picker и записывает в projectData
    const pickLoc = e.target.closest('[data-tw-action="pick-location"]');
    if (pickLoc) {
      try {
        const { pickStation } = await import('../meteo/station-picker.js');
        const picked = await pickStation({ title: '🗺 Выбор местоположения проекта' });
        if (!picked || picked.manual) return;
        if (!cur.concept.projectData) cur.concept.projectData = {};
        cur.concept.projectData.lat = picked.lat;
        cur.concept.projectData.lon = picked.lon;
        if (!cur.concept.projectData.city) cur.concept.projectData.city = picked.name;
        persistVariants();
        renderActiveVariant();
        twToast(`📍 Локация: ${picked.name} (${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)})`, 'ok');
      } catch (e) {
        twToast(`Ошибка: ${e.message || e}`, 'warn');
      }
      return;
    }

    // 🌐 Auto-fetch meteo для проекта (Phase 21.3) — 1-кликовая загрузка
    const twAct = e.target.closest('[data-tw-action="fetch-meteo"]');
    if (twAct) {
      try {
        const pd = cur.concept.projectData || {};
        let picked;
        // Если projectData содержит lat/lon — используем без picker
        if (Number.isFinite(Number(pd.lat)) && Number.isFinite(Number(pd.lon))) {
          picked = { lat: Number(pd.lat), lon: Number(pd.lon), name: pd.city || pd.designation || 'Проект', id: null };
        } else {
          const { pickStation } = await import('../meteo/station-picker.js');
          picked = await pickStation({ title: '🌐 Загрузка метеоданных для проекта' });
          if (!picked || picked.manual) {
            if (picked?.manual) twToast('Для авто-загрузки нужна станция из каталога или укажите координаты в блоке «Объект».', 'warn');
            return;
          }
        }
        twToast('Загрузка 1 года почасовых данных…', 'info');
        const today = new Date().toISOString().slice(0, 10);
        const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${picked.lat}&longitude=${picked.lon}&start_date=${yearAgo}&end_date=${today}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) { twToast(`Open-Meteo вернул ${res.status}: ${res.statusText}`, 'warn'); return; }
        const json = await res.json();
        const times = json.hourly?.time || [];
        const T = json.hourly?.temperature_2m || [];
        const RH = json.hourly?.relative_humidity_2m || [];
        const W = json.hourly?.wind_speed_10m || [];
        const WD = json.hourly?.wind_direction_10m || [];
        const hourly = times.map((t, i) => ({ t, T: T[i], RH: RH[i], wind: W[i], windDir: WD[i] }));
        if (!hourly.length) { twToast('API вернул пустой ряд.', 'warn'); return; }
        // Compute stats inline (минимально нужное для PUE)
        const temps = hourly.map(h => Number(h.T)).filter(Number.isFinite);
        const sorted = [...temps].sort((a, b) => a - b);
        const stats = {
          tmin: Math.round(sorted[0] * 10) / 10,
          tmax: Math.round(sorted[sorted.length - 1] * 10) / 10,
          tmean: Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 10) / 10,
          t99: Math.round(sorted[Math.floor(sorted.length * 0.99)] * 10) / 10,
          freecoolHours: temps.filter(t => t < 14).length,
          n: temps.length,
        };
        // Save dataset to LS (in same format as meteo module)
        const dsId = 'ds-' + Math.random().toString(36).slice(2, 10);
        const dataset = {
          id: dsId,
          name: `${picked.name} (${yearAgo}…${today})`,
          source: 'open-meteo', lat: picked.lat, lon: picked.lon,
          locationName: picked.name, stationId: picked.id || null,
          dateFrom: yearAgo, dateTo: today,
          hourly, stats,
          activeForProject: true,
          createdAt: Date.now(),
        };
        // Сбрасываем active у других, добавляем новый как ⭐
        const dsKey = projectKey(_pid, 'meteo', 'datasets.v1');
        let existing = [];
        try { existing = JSON.parse(localStorage.getItem(dsKey) || '[]'); } catch {}
        for (const d of existing) d.activeForProject = false;
        existing.unshift(dataset);
        localStorage.setItem(dsKey, JSON.stringify(existing));
        localStorage.setItem(projectKey(_pid, 'meteo', 'activeId.v1'), JSON.stringify(dsId));
        twToast(`✓ Загружено: ${stats.n} часов, T ${stats.tmin}…${stats.tmax} °C, FreeCool ${(stats.freecoolHours / stats.n * 100).toFixed(0)}%`, 'ok');
        renderActiveVariant();
      } catch (e) {
        console.error('[fetch-meteo]', e);
        twToast(`Ошибка загрузки: ${e.message || e}`, 'warn');
      }
      return;
    }

    // v0.60.88: «🔄 Синхр. с проектом» — перезаполнить пустые поля concept.projectData.
    const syncFromProj = e.target.closest('[data-tw-action="sync-from-project"]');
    if (syncFromProj) {
      const changed = _syncProjectDataFromProject(cur.concept);
      if (changed) {
        persistVariants();
        renderActiveVariant();
        twToast('✓ Пустые поля заполнены из метаданных проекта.', 'ok');
      } else {
        twToast('Все поля уже заполнены либо в проекте нет данных.', 'info');
      }
      return;
    }

    // v0.60.90: «🪄 Авто» — применить рекомендуемое ТП/ДГУ.
    const applyTpAuto = e.target.closest('[data-tw-action="apply-tp-auto"]');
    if (applyTpAuto) {
      const c = cur.concept;
      const auto = _suggestTpKva(c);
      if (!c.feed) c.feed = { tp: { needed: false }, dgu: { needed: false } };
      if (!c.feed.tp) c.feed.tp = { needed: false };
      c.feed.tp.kva = auto;
      c.feed.tp.needed = true;
      persistVariants();
      renderActiveVariant();
      twToast(`✓ ТП = ${auto} кВА (авто-подбор по нагрузке)`, 'ok');
      return;
    }
    const applyDguAuto = e.target.closest('[data-tw-action="apply-dgu-auto"]');
    if (applyDguAuto) {
      const c = cur.concept;
      if (!c.feed) c.feed = { tp: { needed: false }, dgu: { needed: false } };
      if (!c.feed.dgu) c.feed.dgu = { needed: false, mode: 'esp' };
      const auto = _suggestDguKw(c, c.feed.dgu.mode || 'esp');
      c.feed.dgu.kw = auto;
      c.feed.dgu.needed = true;
      persistVariants();
      renderActiveVariant();
      twToast(`✓ ДГУ = ${auto} кВт (авто-подбор для режима ${(c.feed.dgu.mode || 'esp').toUpperCase()})`, 'ok');
      return;
    }

    // Phase 30.2 PULL (v0.60.89): «↩ Применить выбранный ИБП из ups-config».
    const applyUpsSelected = e.target.closest('[data-tw-action="apply-ups-selected"]');
    if (applyUpsSelected) {
      const sel = _readUpsSelected();
      if (!sel) { twToast('Нет сохранённой ИБП-модели в ups-config.', 'warn'); return; }
      const usId = applyUpsSelected.dataset.upsId;
      const us = (cur.concept.upsSystems || []).find(x => x.id === usId);
      if (!us) { twToast('Система ИБП не найдена.', 'warn'); return; }
      us.modelRef = {
        id: sel.upsId || `ups-${sel.supplier}-${sel.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        manufacturer: sel.supplier,
        model: sel.model,
        capacityKw: sel.capacityKw,
        upsType: sel.upsType,
      };
      // Опционально: подтягиваем capacity, efficiency, cosPhi из selected
      if (sel.capacityKw && (!us.ratedKva || us.ratedKva === 0)) {
        // Преобразование kW → kVA через cos φ (default 1.0 для современных ИБП с PFC)
        us.ratedKva = Math.round((sel.capacityKw / (sel.cosPhi || 1.0)));
      }
      if (sel.cosPhi) us.cosPhi = sel.cosPhi;
      if (sel.autonomyMin) us.autonomyMin = sel.autonomyMin;
      if (sel.redundancy) us.redundancy = sel.redundancy;
      persistVariants();
      renderActiveVariant();
      twToast(`✓ Применён ИБП: ${sel.supplier} ${sel.model} (${sel.capacityKw} кВт)`, 'ok');
      return;
    }

    // Phase 30.3 PULL (v0.60.82): «↩ Применить выбранную ДГУ из dgu-config».
    const applyDguSelected = e.target.closest('[data-tw-action="apply-dgu-selected"]');
    if (applyDguSelected) {
      const sel = _readDguSelected();
      if (!sel) { twToast('Нет сохранённой ДГУ-модели в dgu-config.', 'warn'); return; }
      if (!cur.concept.feed) cur.concept.feed = {};
      if (!cur.concept.feed.dgu) cur.concept.feed.dgu = { needed: true };
      cur.concept.feed.dgu.modelRef = {
        id: `dgu-${sel.vendor}-${sel.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        manufacturer: sel.vendor,
        model: sel.model,
        nameplateKw: sel.nameplateKw,
        engineModel: sel.engineModel,
      };
      // Опционально подтягиваем kw из nameplateKw если в концепции 0
      if (!cur.concept.feed.dgu.kw && sel.nameplateKw) {
        cur.concept.feed.dgu.kw = sel.nameplateKw;
      }
      persistVariants();
      renderActiveVariant();
      twToast(`✓ Применена ДГУ: ${sel.vendor} ${sel.model} (${sel.nameplateKw} кВт)`, 'ok');
      return;
    }

    // Phase 30.5 (v0.60.68): «📋 Создать ТО-наряд из этого подбора»
    // Читает основной (★) вариант подбора cooling, формирует maintenance-
    // позиции через buildMaintenancePositionsFromCoolingOption и создаёт
    // наряд в service через createServiceOrderForProject.
    const createMaintOrder = e.target.closest('[data-tw-action="create-maint-order"]');
    if (createMaintOrder) {
      try {
        if (!_pid) { twToast('Нет активного проекта.', 'warn'); return; }
        const sels = JSON.parse(localStorage.getItem(`raschet.project.${_pid}.cooling.selections.v1`) || '[]');
        if (!Array.isArray(sels) || !sels.length) { twToast('В проекте нет cooling-подборов.', 'warn'); return; }
        const activeId = JSON.parse(localStorage.getItem(`raschet.project.${_pid}.cooling.activeSelectionId.v1`) || 'null');
        const sel = sels.find(s => s.id === activeId) || sels[0];
        const main = sel.options.find(o => o.id === sel.mainOptionId) || sel.options[0];
        if (!main) { twToast('У подбора нет вариантов.', 'warn'); return; }

        // Динамически импортируем builder и service-bridge
        const [{ buildMaintenancePositionsFromCoolingOption }, { createServiceOrderForProject }] = await Promise.all([
          import('../service/calc/order-builder.js'),
          import('../shared/service-bridge.js'),
        ]);
        const positions = buildMaintenancePositionsFromCoolingOption(main, '₽', sel);
        if (!positions.length) {
          twToast('У основного варианта нет equipment-групп. Сначала задайте оборудование во вкладке Топология cooling.', 'warn');
          return;
        }
        const orderName = `ТО: ${sel.name} → ${main.name}`;
        const result = createServiceOrderForProject(_pid, {
          name: orderName,
          type: 'maintenance',
          coolingSelectionId: sel.id,
          positions,
        });
        twToast(`✓ Создан наряд № «${result.id}»: ${positions.length} позиций. Открываю /service/…`, 'ok');
        // Переходим в /service/ через 1 сек чтобы юзер увидел toast
        setTimeout(() => { location.href = result.navigateUrl; }, 800);
      } catch (err) {
        console.error('[create-maint-order]', err);
        twToast(`Ошибка: ${err.message || err}`, 'warn');
      }
      return;
    }

    // Phase 30.1 (v0.60.66): «📤 Подобрать холод для этой концепции»
    // Открывает /cooling/ в embed-режиме с pre-filled requiredCoolingKw
    // и locationName, после возврата concept получает ссылку на подбор.
    const openCoolingPrefill = e.target.closest('[data-tw-action="open-cooling-prefill"]');
    if (openCoolingPrefill) {
      try {
        const itKw = calcITTotal(cur.concept);
        if (itKw <= 0) {
          twToast('Нет IT-нагрузки в концепции (rackGroups). Добавьте стойки сначала.', 'warn');
          return;
        }
        // Расчётная требуемая холодопроизводительность:
        //   reqCoolKw = itKw × pue_target − itKw (доля cooling в общем потреблении)
        // Используем 1.4 как target по умолчанию, либо текущий pue.value/manualPue.
        const pueTarget = (cur.concept.pue?.mode === 'manual')
          ? (Number(cur.concept.pue.manualPue) || 1.4)
          : 1.4;
        const reqCoolKw = Math.ceil(itKw * (pueTarget - 1));
        // Pre-fill payload в LS-bridge (cooling.js считывает на init).
        const prefillKey = `raschet.cooling.prefill.v1`;
        const payload = {
          ts: Date.now(),
          projectId: _pid,
          requiredCoolingKw: reqCoolKw,
          itKw: Math.round(itKw),
          locationName: cur.concept.projectData?.city || cur.concept.projectData?.designation || '',
          variantId: _activeId,
          source: 'tech-workspace',
        };
        try { localStorage.setItem(prefillKey, JSON.stringify(payload)); } catch {}
        twToast(`📤 Открываю /cooling/ с req = ${reqCoolKw} кВт (PUE target ${pueTarget.toFixed(2)})…`, 'info');
        // Открываем в embed через openEmbed-like (но cooling использует
        // module-nav).
        const { openEmbed } = await import('../shared/module-nav.js');
        openEmbed(location.pathname + location.search, '../cooling/', 'Технолог ЦОД');
      } catch (err) {
        console.error('[open-cooling-prefill]', err);
        twToast(`Ошибка: ${err.message || err}`, 'warn');
      }
      return;
    }

    // Bulk-toolbar для стоек
    const bulkBtn = e.target.closest('[data-bulk]');
    if (bulkBtn) {
      const op = bulkBtn.dataset.bulk;
      const groups = cur.concept.rackGroups || [];
      if (op === 'rack-size') {
        const w = Number(bulkBtn.dataset.w) || 600;
        const d = Number(bulkBtn.dataset.d) || 1200;
        const ok = await twConfirm(`Применить размеры ${w} × ${d} мм ко всем ${groups.length} группам стоек?`, 'Bulk-операция');
        if (!ok) return;
        groups.forEach(rg => { rg.widthMm = w; rg.depthMm = d; });
        persistVariants(); renderActiveVariant();
        twToast(`Размеры ${w} × ${d} мм применены к ${groups.length} группам`, 'ok');
      } else if (op === 'pdu') {
        const kind = bulkBtn.dataset.kind || 'metered';
        const rating = Number(bulkBtn.dataset.rating) || 32;
        const inputs = Number(bulkBtn.dataset.inputs) || 2;
        const ok = await twConfirm(`Применить PDU «${kind} ${rating}А ×${inputs}» ко всем ${groups.length} группам стоек?`, 'Bulk-операция');
        if (!ok) return;
        groups.forEach(rg => {
          if (!rg.pdu) rg.pdu = { kind: 'metered', phases: '3ph', ratingA: 32, inputsPerRack: 2, modelRef: null };
          rg.pdu.kind = kind;
          rg.pdu.ratingA = rating;
          rg.pdu.inputsPerRack = inputs;
        });
        persistVariants(); renderActiveVariant();
        twToast(`PDU «${kind} ${rating}А ×${inputs}» применён к ${groups.length} группам`, 'ok');
      }
      return;
    }

    // Удалить блок через × в шапке карточки (старый путь — оставлено для совместимости)
    const delBtn = e.target.closest('.tw-card-del[data-card-action="delete"]');
    if (delBtn) {
      const card = delBtn.closest('.tw-card');
      if (!card) return;
      const kind = card.dataset.cardKind;
      const id = card.dataset.cardId;
      const arrName = kind === 'rack' ? 'rackGroups' : kind === 'ups' ? 'upsSystems' : 'coolingUnits';
      const arr = cur.concept[arrName];
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return;
      if (arr.length === 1) {
        twToast('Нельзя удалить последний блок. Добавьте ещё один перед удалением.', 'warn');
        return;
      }
      const ok = await twConfirm(`Удалить «${arr[idx].name}»?`, 'Удаление блока');
      if (!ok) return;
      arr.splice(idx, 1);
      const next = arr[Math.min(idx, arr.length - 1)];
      _selectedBlock = next ? { kind, id: next.id } : { kind: 'feed', id: null };
      persistVariants(); renderActiveVariant();
      return;
    }

    const bindBtn = e.target.closest('.tw-bind-btn[data-bind-domain]');
    if (bindBtn) {
      openModelPicker(bindBtn.dataset.bindDomain, bindBtn.dataset.refId);
    }
  });
}

// ─── v0.59.892: Inline UI вместо browser dialogs (по правилу из MEMORY.md)
function twToast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `tw-toast tw-toast-${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  // Reflow + add visible class for transition
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

function twConfirm(msg, title = 'Подтверждение') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'tw-modal-overlay';
    overlay.innerHTML = `<div class="tw-modal" role="dialog" aria-modal="true">
      <div class="tw-modal-head"><h3>${escHtml(title)}</h3></div>
      <div class="tw-modal-body">${escHtml(msg)}</div>
      <div class="tw-modal-actions">
        <button type="button" class="tw-modal-btn tw-modal-cancel">Отмена</button>
        <button type="button" class="tw-modal-btn tw-modal-ok">OK</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    overlay.querySelector('.tw-modal-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.tw-modal-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => overlay.querySelector('.tw-modal-ok').focus());
  });
}

// v0.60.76: prompt с inline-input (для создания проекта).
function twPrompt(label, defaultValue = '', title = 'Ввод значения') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'tw-modal-overlay';
    overlay.innerHTML = `<div class="tw-modal" role="dialog" aria-modal="true">
      <div class="tw-modal-head"><h3>${escHtml(title)}</h3></div>
      <div class="tw-modal-body">
        <label style="display:block;margin-bottom:8px;font-size:12.5px;color:#374151">${escHtml(label)}</label>
        <input type="text" id="tw-prompt-input" value="${escAttr(defaultValue)}" autofocus
               style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;font-size:13px">
      </div>
      <div class="tw-modal-actions">
        <button type="button" class="tw-modal-btn tw-modal-cancel">Отмена</button>
        <button type="button" class="tw-modal-btn tw-modal-ok">OK</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#tw-prompt-input');
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') close(input.value || null);
    };
    overlay.querySelector('.tw-modal-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.tw-modal-ok').addEventListener('click', () => close(input.value || null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

// v0.59.893: пикер из списка опций (id+label). Returns picked id or null.
function twPickFromList(items, title = 'Выбор') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'tw-modal-overlay';
    const rows = items.map(it => `<button type="button" class="tw-pick-row" data-id="${escAttr(it.id)}">${escHtml(it.label)}</button>`).join('');
    overlay.innerHTML = `<div class="tw-modal tw-modal-pick" role="dialog" aria-modal="true">
      <div class="tw-modal-head"><h3>${escHtml(title)}</h3></div>
      <div class="tw-modal-body tw-pick-list">${rows || '<div class="muted">Список пуст.</div>'}</div>
      <div class="tw-modal-actions">
        <button type="button" class="tw-modal-btn tw-modal-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    overlay.querySelector('.tw-modal-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelectorAll('.tw-pick-row').forEach(row => {
      row.addEventListener('click', () => close(row.dataset.id));
    });
    document.addEventListener('keydown', onKey);
  });
}

function _setNested(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

// ─── Variant CRUD
function addVariant() {
  const name = `Вариант ${_variants.length + 1}`;
  const v = newVariant(name);
  if (_variants.length === 0) v.primary = true;
  // v0.60.88: автозаполнение projectData из parent project при создании.
  _syncProjectDataFromProject(v.concept);
  _variants.push(v);
  _activeId = v.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function duplicateVariant(id) {
  const src = _variants.find(v => v.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'v-' + Math.random().toString(36).slice(2, 10);
  copy.name = src.name + ' (копия)';
  copy.primary = false;
  copy.readOnly = false;
  copy.createdAt = Date.now();
  // Переназначить id вложенных объектов чтобы они не пересекались
  for (const rg of (copy.concept.rackGroups || [])) rg.id = _newId('rg');
  for (const us of (copy.concept.upsSystems || [])) us.id = _newId('us');
  for (const cu of (copy.concept.coolingUnits || [])) cu.id = _newId('cu');
  // v0.59.893: МЦОД блоки получают новые id, но привязка к sub-проекту сохраняется
  // (sub-проект — независимая сущность, может быть общей для нескольких вариантов).
  for (const b of (copy.concept.mdcBuildings || [])) b.id = _newId('mdc');
  _variants.push(copy);
  _activeId = copy.id;
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
async function deleteVariant(id) {
  const idx = _variants.findIndex(v => v.id === id);
  if (idx < 0) return;
  const ok = await twConfirm(`Удалить вариант «${_variants[idx].name}»?`, 'Удаление варианта');
  if (!ok) return;
  _variants.splice(idx, 1);
  if (_activeId === id) _activeId = _variants[0]?.id || null;
  if (!_variants.some(v => v.primary) && _variants.length > 0) {
    _variants[0].primary = true;
  }
  persistVariants(); persistActive();
  renderVariantsList(); renderActiveVariant();
}
function makePrimary(id) {
  for (const v of _variants) v.primary = (v.id === id);
  persistVariants();
  renderVariantsList(); renderActiveVariant();
}

// ─── Mode toggle
function setMode(mode) {
  _mode = (mode === 'plan') ? 'plan' : 'list';
  document.querySelectorAll('.tw-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
  renderActiveVariant();
}

// ─── Catalog picker
const DOMAIN_KIND = {
  rack: 'rack', ups: 'ups', cool: 'cooler',
  tp: 'transformer', dgu: 'generator', pdu: 'pdu',
};
const DOMAIN_LABEL = {
  rack: 'Стойка', ups: 'ИБП', cool: 'Кондиционер',
  tp: 'Трансформатор', dgu: 'ДГУ', pdu: 'PDU',
};

async function openModelPicker(domain, refId) {
  const cur = _variants.find(x => x.id === _activeId);
  if (!cur) return;
  const kind = DOMAIN_KIND[domain];
  if (!kind) return;
  let elements = [];
  try {
    const lib = await import('../shared/element-library.js');
    elements = lib.listElements({ kind }) || [];
  } catch (e) { twToast(`Не удалось загрузить библиотеку: ${e.message || e}`, 'warn'); return; }
  // Ищем текущий modelRef для подсветки
  const target = _findBindTarget(cur.concept, domain, refId);
  const currentRefId = target?.modelRef?.id || null;
  const overlay = document.createElement('div');
  overlay.className = 'tw-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:inherit';
  const rows = elements.map(el => {
    const sel = el.id === currentRefId ? ' style="background:#dbeafe;border-color:#1e40af"' : '';
    const kw = el.demandKw ?? el.kva ?? el.power ?? '';
    return `<div class="tw-picker-row" data-id="${escAttr(el.id)}"${sel}>
      <span class="tw-picker-mfr">${escHtml(el.manufacturer || '')}</span>
      <span class="tw-picker-model"><b>${escHtml(el.model || el.name || el.id)}</b></span>
      <span class="tw-picker-kind muted">${escHtml(el.kind || '')}</span>
      <span class="tw-picker-power muted">${kw ? kw + (el.kind === 'ups' ? ' кВА' : ' кВт') : ''}</span>
    </div>`;
  }).join('');
  overlay.innerHTML = `<div class="tw-picker">
    <div class="tw-picker-head">
      <h3>📦 Выбор модели — ${escHtml(DOMAIN_LABEL[domain])}</h3>
      <button type="button" class="tw-picker-close">×</button>
    </div>
    <div class="tw-picker-search-row">
      <input type="text" class="tw-picker-search" placeholder="🔍 Поиск...">
      <span class="muted" style="font-size:11px">${elements.length} моделей</span>
    </div>
    <div class="tw-picker-list">
      ${elements.length === 0
        ? `<div class="muted" style="padding:20px;text-align:center">В библиотеке нет элементов kind="${kind}". Добавьте их в catalog/.</div>`
        : rows}
    </div>
    <div class="tw-picker-actions">
      ${currentRefId ? `<button type="button" class="tw-picker-clear">🗑 Снять привязку</button>` : ''}
      <span style="flex:1"></span>
      <button type="button" class="tw-picker-cancel">Отмена</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.tw-picker-close').addEventListener('click', close);
  overlay.querySelector('.tw-picker-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const search = overlay.querySelector('.tw-picker-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      overlay.querySelectorAll('.tw-picker-row').forEach(row => {
        const txt = row.textContent.toLowerCase();
        row.style.display = (!q || txt.includes(q)) ? '' : 'none';
      });
    });
    search.focus();
  }
  overlay.querySelectorAll('.tw-picker-row').forEach(row => {
    row.addEventListener('click', () => {
      const el = elements.find(e => e.id === row.dataset.id);
      if (el) { _bindModel(domain, refId, el); close(); }
    });
  });
  const clearBtn = overlay.querySelector('.tw-picker-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => { _bindModel(domain, refId, null); close(); });
}

function _findBindTarget(concept, domain, refId) {
  if (domain === 'rack') return (concept.rackGroups || []).find(rg => rg.id === refId);
  if (domain === 'ups') return (concept.upsSystems || []).find(us => us.id === refId);
  if (domain === 'cool') return (concept.coolingUnits || []).find(cu => cu.id === refId);
  if (domain === 'pdu') {
    // refId — это id rack-группы; modelRef лежит в rg.pdu.modelRef
    const rg = (concept.rackGroups || []).find(rg => rg.id === refId);
    return rg ? rg.pdu : null;
  }
  if (domain === 'tp') return concept.feed?.tp;
  if (domain === 'dgu') return concept.feed?.dgu;
  return null;
}

function _bindModel(domain, refId, element) {
  const cur = _variants.find(x => x.id === _activeId);
  if (!cur || cur.readOnly) return;
  const target = _findBindTarget(cur.concept, domain, refId);
  if (!target) return;
  const ref = element ? {
    id: element.id,
    manufacturer: element.manufacturer || '',
    model: element.model || element.name || element.id,
    kind: element.kind,
  } : null;
  target.modelRef = ref;
  // Авто-копирование параметров
  if (element) {
    if (domain === 'rack') {
      if (Number.isFinite(element.widthMm)) target.widthMm = element.widthMm;
      if (Number.isFinite(element.depthMm)) target.depthMm = element.depthMm;
      if (Number.isFinite(element.demandKw) && !target.kwPerRack) target.kwPerRack = element.demandKw;
    } else if (domain === 'ups') {
      const kva = element.kva || element.ratedKva;
      if (Number.isFinite(kva) && !target.ratedKva) target.ratedKva = kva;
    } else if (domain === 'cool') {
      const kw = element.kwCool || element.kw;
      if (Number.isFinite(kw) && !target.kwPerUnit) target.kwPerUnit = kw;
    } else if (domain === 'tp') {
      if (Number.isFinite(element.kva) && !target.kva) target.kva = element.kva;
    } else if (domain === 'dgu') {
      if (Number.isFinite(element.kw) && !target.kw) target.kw = element.kw;
    }
  }
  persistVariants();
  renderActiveVariant();
}

// ─── Handoff (Phase 20.11): генерируем engine.scheme.v1 из concept
//
// MVP: создаём ноды (без connections) на одной странице, пользователь сам
// проводит линии. Это сильно проще чем правильно строить port-топологию,
// и оставляет electrical-detail (автоматы, кабели) за электриком.
//
// Узлы:
//   - source (utility / transformer) — если concept.feed.tp.needed
//   - generator (ДГУ) — если concept.feed.dgu.needed
//   - panel — 1 ГРЩ
//   - consumer-group — по 1 на rackGroup, count = group.count
//   - ups — по 1 на upsSystem
//   - cooling consumer — по 1 на coolingUnit
function _buildSchemeFromConcept(concept, variantName) {
  const nodes = [];
  let nextId = 1;
  const newId = () => 'n' + (nextId++);
  const newTag = (() => {
    const used = new Set();
    return (prefix) => {
      let i = 1;
      while (used.has(prefix + i)) i++;
      const t = prefix + i;
      used.add(t);
      return t;
    };
  })();

  let curY = 100;
  const colX = { source: 100, mid: 500, end: 900 };
  const pageId = 'p1';

  // Source: TP или Utility
  if (concept.feed?.tp?.needed) {
    nodes.push({
      id: newId(), type: 'source', tag: newTag('TP'),
      name: 'Ввод ТП', x: colX.source, y: curY,
      sourceSubtype: 'transformer',
      snomKva: Number(concept.feed.tp.kva) || 1000,
      voltage: 400, voltageLevelIdx: 0, phase: '3ph', cosPhi: 0.95,
      ukPct: 4.5, sscMva: 250,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
  } else {
    nodes.push({
      id: newId(), type: 'source', tag: newTag('U'),
      name: 'Городская сеть', x: colX.source, y: curY,
      sourceSubtype: 'utility',
      voltage: 10000, voltageLevelIdx: 3, phase: '3ph', cosPhi: 1,
      ikKA: 10, sscMva: 250,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
  }
  curY += 200;
  if (concept.feed?.dgu?.needed) {
    nodes.push({
      id: newId(), type: 'generator', tag: newTag('G'),
      name: 'ДГУ', x: colX.source, y: curY,
      capacityKw: Number(concept.feed.dgu.kw) || 100,
      backupMode: concept.feed.dgu.mode === 'esp',
      phase: '3ph', voltage: 400, cosPhi: 0.85,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.source, y: curY } },
    });
    curY += 200;
  }
  // ГРЩ (главный распределительный щит)
  const panelY = 100;
  nodes.push({
    id: newId(), type: 'panel', tag: newTag('ГРЩ'),
    name: 'ГРЩ', x: colX.mid, y: panelY,
    inputs: 2, outputs: Math.max(2, (concept.upsSystems || []).length + (concept.coolingUnits || []).length),
    capacityA: 800,
    pageIds: [pageId],
    positionsByPage: { [pageId]: { x: colX.mid, y: panelY } },
  });
  // ИБП-узлы
  let upsY = panelY;
  for (const us of (concept.upsSystems || [])) {
    nodes.push({
      id: newId(), type: 'ups', tag: newTag(us.purpose === 'cooling' ? 'ИБПК' : 'ИБП'),
      name: us.name, x: colX.mid + 250, y: upsY,
      kva: Number(us.ratedKva) || 0,
      autonomyMin: Number(us.autonomyMin) || 15,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.mid + 250, y: upsY } },
    });
    upsY += 200;
  }
  // v0.59.833 (1.28.20 Phase 7): handoff создаёт consumer-container с
  // N placeholder-слотами вместо одиночного consumer count=N. Это
  // позволяет технологу/электрику затем материализовать каждый слот
  // в индивидуальную стойку с уникальным tag (SR01..SRN), сохранив
  // изначальную спеку из «Концепции стоек».
  let rackY = panelY;
  for (const rg of (concept.rackGroups || [])) {
    const cnt = Math.max(1, Number(rg.count) || 1);
    const kwPerRack = Number(rg.kwPerRack) || 0;
    const slots = [];
    for (let i = 0; i < cnt; i++) {
      slots.push({
        kind: 'placeholder',
        demandKw: kwPerRack,
        cosPhi: 0.95,
        phase: '3ph',
        voltage: 400,
        voltageLevelIdx: 0,
        subtype: 'rack',
        kUse: 1,
      });
    }
    nodes.push({
      id: newId(), type: 'consumer-container', tag: newTag('GR'),
      name: rg.name || 'Стойки',
      x: colX.end, y: rackY,
      inputs: 2, outputs: 0,
      inputSide: 'top',
      slots,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.end, y: rackY } },
      _fromTechWorkspace: true,
      _profile: rg.profile,
      _conceptRgId: rg.id,
    });
    rackY += 200;
  }
  // Cooling consumers (как просто потребители)
  for (const cu of (concept.coolingUnits || [])) {
    const kwTot = (Number(cu.count) || 0) * (Number(cu.kwPerUnit) || 0);
    nodes.push({
      id: newId(), type: 'consumer', tag: newTag('K'),
      name: cu.name || 'Кондиционеры',
      consumerSubtype: 'outdoor_unit',
      x: colX.end, y: rackY,
      count: Number(cu.count) || 1,
      demandKw: Number(cu.kwPerUnit) || 0,
      cosPhi: 0.85, phase: '3ph', voltage: 400,
      width: 250, height: 120,
      pageIds: [pageId],
      positionsByPage: { [pageId]: { x: colX.end, y: rackY } },
      _fromTechWorkspace: true,
    });
    rackY += 200;
  }

  return {
    version: 4,
    nextId: nextId,
    nodes,
    conns: [],
    sysConns: [],
    pages: [{
      id: pageId,
      name: variantName || 'Главная схема',
      type: 'independent',
      kind: 'schematic',
      view: { x: 0, y: 0, zoom: 0.7 },
    }],
    currentPageId: pageId,
    project: { name: variantName || 'Концепция' },
    modes: [],
    activeModeId: null,
    view: { x: 0, y: 0, zoom: 0.7 },
    globalSettings: {},
  };
}

// ─── Phase 20.9: пояснительная записка (HTML-report, печатаемый)
// Пользователь: «Шаблонная ПЗ по концепции: структура с разделами «Описание
// объекта», «Концепция размещения», «Электроснабжение», «Климат»,
// «Резервирование», «Площади», «Перечень ТЗ для смежных дисциплин».
function _redundancyLabel(r) {
  return ({ 'N': 'без резерва (N)', 'N+1': 'N+1', '2N': '2N', '1': '1 ввод', '2': '2 ввода', '2-avr': '2 ввода + АВР', 'none': 'нет', 'esp': 'резервный (ESP)', 'prp': 'постоянный (PRP)' }[r]) || r;
}
function _profileLabel(p) {
  return ({ 'it': 'IT-rack', 'blade': 'Blade', 'gpu': 'GPU-heavy', 'network': 'Network', 'storage': 'Storage' }[p]) || p;
}
function _coolTypeLabel(t) {
  return ({ 'crac': 'CRAC (downflow)', 'inrow': 'In-Row', 'fancoil': 'Fan-coil', 'freecool': 'Free cooling' }[t]) || t;
}
function _purposeLabel(p) {
  return ({ 'it': 'IT-нагрузка', 'cooling': 'климат', 'mixed': 'смешанное' }[p]) || p;
}
/**
 * Phase 30.7 (v0.60.67): сводка cooling-подбора проекта для отчёта.
 * Читает selections + activeSelectionId из LS и возвращает суммарные данные.
 */
function _readCoolingSummary() {
  if (!_pid) return null;
  try {
    const sels = JSON.parse(localStorage.getItem(`raschet.project.${_pid}.cooling.selections.v1`) || '[]');
    if (!Array.isArray(sels) || !sels.length) return null;
    const activeId = JSON.parse(localStorage.getItem(`raschet.project.${_pid}.cooling.activeSelectionId.v1`) || 'null');
    const sel = sels.find(s => s.id === activeId) || sels[0];
    if (!sel || !sel.options?.length) return null;
    const main = sel.options.find(o => o.id === sel.mainOptionId) || sel.options[0];
    const equipment = Array.isArray(main.equipment) ? main.equipment : [];
    const totalQty = equipment.reduce((s, eq) => s + (eq.qty || 1), 0);
    const installedKw = equipment.reduce((s, eq) => {
      if (!eq.spec) return s;
      const active = eq.standbyMode === 'hot' ? (eq.qty || 1) : (eq.redundancyN || (eq.qty || 1));
      return s + (eq.spec.ratedCapKw || 0) * active;
    }, 0);
    const eco = main.eco || {};
    return {
      selectionName: sel.name,
      requiredCoolingKw: sel.general?.requiredCoolingKw || 0,
      safetyMarginPct: sel.general?.safetyMarginPct || 0,
      mainOptionName: main.name,
      systemType: main.spec?.systemType || equipment[0]?.spec?.systemType || '?',
      ratedCop: main.spec?.ratedCOP || equipment[0]?.spec?.ratedCOP || 0,
      totalQty, installedKw,
      optionCount: sel.options.length,
      eco: {
        equipmentCost: eco.equipmentCost || 0,
        installationCost: eco.installationCost || 0,
        maintenanceRubPerYear: eco.maintenanceRubPerYear || 0,
        currency: eco.currency || '₽',
        projectLifetimeYears: sel.eco?.projectLifetimeYears || eco.projectLifetimeYears || 10,
      },
    };
  } catch (e) {
    console.warn('[tw-report] cooling summary read failed:', e);
    return null;
  }
}

/**
 * Phase 30.7: сводка service-нарядов проекта (количество install/maintenance + Σ суммы).
 */
function _readServiceSummary() {
  if (!_pid) return null;
  try {
    const orders = JSON.parse(localStorage.getItem(`raschet.project.${_pid}.service.orders.v1`) || '[]');
    if (!Array.isArray(orders) || !orders.length) return null;
    let installCount = 0, maintCount = 0;
    let installTotal = 0, maintTotal = 0;
    let cur = '₽';
    for (const o of orders) {
      const totalClient = (o.positions || []).reduce((s, p) =>
        s + (p.clientPrice?.value || 0) * (p.qty || 1), 0);
      if ((o.positions || [])[0]?.clientPrice?.currency) cur = o.positions[0].clientPrice.currency;
      if (o.type === 'maintenance') { maintCount++; maintTotal += totalClient; }
      else { installCount++; installTotal += totalClient; }
    }
    return {
      installCount, maintCount, installTotal, maintTotal,
      currency: cur,
    };
  } catch (e) {
    console.warn('[tw-report] service summary read failed:', e);
    return null;
  }
}

function generateReportHtml(v) {
  const c = v.concept;
  const itKw = calcITTotal(c);
  const upsByPurpose = calcUpsByPurpose(c);
  const coolKw = calcCoolTotal(c);
  const feedKw = calcFeedTotal(c);
  const areas = calcAreas(c);
  const sumM2 = areas.reduce((s, a) => s + a.m2, 0);
  const totalRacks = (c.rackGroups || []).reduce((s, rg) => s + (Number(rg.count) || 0), 0);
  const date = new Date().toLocaleDateString('ru-RU');
  // Phase 30.7: cross-module data
  const coolSummary = _readCoolingSummary();
  const serviceSummary = _readServiceSummary();
  // PUE breakdown (from Phase 30.4)
  const meteoSum = _readMeteoSummary();
  const pueData = (c.pue?.mode === 'manual') ? null : calcPueAutoBreakdown(c, meteoSum);
  const pueValue = pueData ? pueData.pue : (Number(c.pue?.manualPue) || 1.4);

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Пояснительная записка — ${escHtml(v.name)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.4; color: #000; max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20pt; text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
  h2 { font-size: 14pt; margin-top: 24px; border-bottom: 1px solid #888; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11pt; }
  table th, table td { border: 1px solid #888; padding: 5px 8px; text-align: left; }
  table th { background: #f0f0f0; font-weight: bold; }
  table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .meta { color: #555; font-size: 10pt; text-align: center; margin-bottom: 24px; }
  .badge { display: inline-block; padding: 1px 6px; background: #f0f0f0; border: 1px solid #888; border-radius: 3px; font-size: 10pt; }
  .summary { background: #f9f9f9; border: 1px solid #ccc; padding: 10px 14px; margin: 12px 0; border-radius: 4px; }
  .summary b { color: #000; }
  .toc { background: #f9f9f9; padding: 10px 14px; border: 1px solid #ddd; margin: 16px 0; }
  .toc ul { margin: 4px 0; padding-left: 24px; }
  .print-actions { position: fixed; top: 8px; right: 8px; }
  .print-actions button { padding: 6px 12px; font-size: 11pt; cursor: pointer; }
  @media print { .print-actions { display: none; } body { padding: 0; max-width: 100%; } }
</style>
</head><body>
<div class="print-actions">
  <button onclick="window.print()">🖨 Печать / PDF</button>
  <button onclick="window.close()">✕ Закрыть</button>
</div>

<h1>Пояснительная записка</h1>
<div class="meta">
  Концепция объекта ЦОД · Вариант «${escHtml(v.name)}»${v.primary ? ' (основной)' : ''}<br>
  Сформировано: ${date} · Технолог ЦОД, Raschet
</div>

<div class="toc">
  <b>Содержание:</b>
  <ul>
    <li>1. Описание объекта</li>
    <li>2. Концепция стоек</li>
    <li>3. Электроснабжение (ИБП)</li>
    <li>4. Климатическое обеспечение</li>
    ${coolSummary ? `<li>4a. Подбор холодильных систем (связанный)</li>` : ''}
    <li>5. Ввод (ТП и ДГУ)</li>
    <li>6. Площади помещений</li>
    ${pueData ? `<li>6a. Расчёт PUE (per-component breakdown)</li>` : ''}
    ${serviceSummary ? `<li>6b. Сервис: монтаж и ТО (связанные наряды)</li>` : ''}
    <li>7. Перечень ТЗ для смежных дисциплин</li>
  </ul>
</div>

<h2>1. Описание объекта</h2>
<p>Объект — центр обработки данных (ЦОД) с IT-нагрузкой <b>${itKw.toFixed(1)} кВт</b>
и общей площадью <b>${sumM2} м²</b>. Концепция включает ${totalRacks} серверных стоек,
${(c.upsSystems || []).length} систем(ы) ИБП,
${(c.coolingUnits || []).length} групп(ы) кондиционирования.</p>
<div class="summary">
  <b>Ключевые параметры:</b><br>
  • IT-нагрузка: ${itKw.toFixed(1)} кВт (${totalRacks} стоек)<br>
  • Подключённая мощность ИБП: ⚡ IT ${(upsByPurpose.it + upsByPurpose.mixed).toFixed(1)} кВт · ❄ климат ${(upsByPurpose.cooling + upsByPurpose.mixed).toFixed(1)} кВт<br>
  • Холодопроизводительность: ${coolKw.toFixed(1)} кВт<br>
  • Принятая мощность объекта: ${feedKw.toFixed(1)} кВт<br>
  • Общая площадь: ${sumM2} м²
</div>

<h2>2. Концепция стоек</h2>
<p>Объект включает ${(c.rackGroups || []).length} групп(ы) серверных стоек:</p>
<table>
  <thead><tr><th>Группа</th><th>Профиль</th><th class="num">Кол-во</th><th class="num">кВт/стойка</th><th class="num">Σ кВт</th><th>Размеры (Ш × Г)</th><th>PDU</th></tr></thead>
  <tbody>
    ${(c.rackGroups || []).map(rg => {
      const sumKw = (Number(rg.count) || 0) * (Number(rg.kwPerRack) || 0);
      const pduSummary = `${rg.pdu?.kind || ''} ${rg.pdu?.phases || ''} ${rg.pdu?.ratingA || ''}А ×${rg.pdu?.inputsPerRack || 1}`;
      return `<tr>
        <td>${escHtml(rg.name)}</td>
        <td>${_profileLabel(rg.profile)}</td>
        <td class="num">${rg.count}</td>
        <td class="num">${rg.kwPerRack}</td>
        <td class="num"><b>${sumKw.toFixed(1)}</b></td>
        <td>${rg.widthMm} × ${rg.depthMm} мм</td>
        <td>${escHtml(pduSummary)}</td>
      </tr>`;
    }).join('')}
    <tr><td colspan="2"><b>Итого:</b></td><td class="num"><b>${totalRacks}</b></td><td></td><td class="num"><b>${itKw.toFixed(1)}</b></td><td></td><td></td></tr>
  </tbody>
</table>

<h2>3. Электроснабжение (ИБП)</h2>
<p>Питание IT-нагрузки и систем климата обеспечивается ${(c.upsSystems || []).length} системами ИБП:</p>
<table>
  <thead><tr><th>Система</th><th>Назначение</th><th class="num">Кол-во</th><th class="num">кВА/шт.</th><th>Резерв</th><th class="num">Доступно, кВт</th><th class="num">Автономия, мин</th><th>АКБ</th></tr></thead>
  <tbody>
    ${(c.upsSystems || []).map(us => `<tr>
      <td>${escHtml(us.name)}</td>
      <td>${_purposeLabel(us.purpose)}</td>
      <td class="num">${us.count}</td>
      <td class="num">${us.ratedKva}</td>
      <td>${_redundancyLabel(us.redundancy)}</td>
      <td class="num">${_upsAvail(us).toFixed(1)}</td>
      <td class="num">${us.autonomyMin}</td>
      <td>${us.batteryTech === 'vrla' ? 'VRLA' : 'Li-Ion (LFP)'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="summary">
  <b>Σ доступная мощность ИБП:</b> ⚡ IT ${(upsByPurpose.it + upsByPurpose.mixed).toFixed(1)} кВт ·
  ❄ климат ${(upsByPurpose.cooling + upsByPurpose.mixed).toFixed(1)} кВт ·
  итого ${upsByPurpose.total.toFixed(1)} кВт
</div>

<h2>4. Климатическое обеспечение</h2>
<p>Для отвода тепла IT-нагрузки (${itKw.toFixed(1)} кВт) предусмотрены:</p>
<table>
  <thead><tr><th>Группа</th><th>Тип</th><th class="num">Кол-во</th><th class="num">кВт/шт.</th><th>Резерв</th><th class="num">Доступно, кВт</th></tr></thead>
  <tbody>
    ${(c.coolingUnits || []).map(cu => `<tr>
      <td>${escHtml(cu.name)}</td>
      <td>${_coolTypeLabel(cu.type)}</td>
      <td class="num">${cu.count}</td>
      <td class="num">${cu.kwPerUnit}</td>
      <td>${_redundancyLabel(cu.redundancy)}</td>
      <td class="num">${_coolAvail(cu).toFixed(1)}</td>
    </tr>`).join('')}
    <tr><td colspan="5"><b>Итого:</b></td><td class="num"><b>${coolKw.toFixed(1)}</b></td></tr>
  </tbody>
</table>
${coolKw < itKw ? `<p style="color:#c62828"><b>⚠ Внимание:</b> Холодопроизводительность (${coolKw.toFixed(1)} кВт) меньше IT-нагрузки (${itKw.toFixed(1)} кВт). Требуется доукомплектование на ${(itKw - coolKw).toFixed(1)} кВт.</p>` : ''}

${coolSummary ? `
<h2>4a. Подбор холодильных систем (связанный)</h2>
<p>В проекте создан связанный подбор холодильных систем «<b>${escHtml(coolSummary.selectionName)}</b>» (модуль <a href="../cooling/?project=${escAttr(_pid)}" target="_blank">«Подбор холодильных систем»</a>) с ${coolSummary.optionCount} варианта${coolSummary.optionCount === 1 ? 'ом' : 'ми'} оборудования.</p>
<div class="summary">
  <b>Основной вариант:</b> «${escHtml(coolSummary.mainOptionName)}» (★)<br>
  • Тип системы: <b>${escHtml(coolSummary.systemType)}</b>, COP rated: <b>${(coolSummary.ratedCop || 0).toFixed(2)}</b><br>
  • Требуемая холодопроизводительность: <b>${coolSummary.requiredCoolingKw.toFixed(1)} кВт</b> (с запасом ${coolSummary.safetyMarginPct}%)<br>
  • Σ установлено системой: <b>${coolSummary.installedKw.toFixed(1)} кВт</b> в ${coolSummary.totalQty} единиц${coolSummary.totalQty === 1 ? 'е' : ''}<br>
  • CAPEX (per-unit × Σ qty): оборудование <b>${(coolSummary.eco.equipmentCost * coolSummary.totalQty).toLocaleString('ru-RU')} ${coolSummary.eco.currency}</b> + монтаж <b>${(coolSummary.eco.installationCost * coolSummary.totalQty).toLocaleString('ru-RU')} ${coolSummary.eco.currency}</b><br>
  • OPEX обслуживания: <b>${(coolSummary.eco.maintenanceRubPerYear * coolSummary.totalQty).toLocaleString('ru-RU')} ${coolSummary.eco.currency}/год</b><br>
  • Lifetime для TCO: ${coolSummary.eco.projectLifetimeYears} лет
</div>
<p class="muted" style="font-size:10pt">📊 Подробное TCO с дисконтированием, OPEX-электричество и сравнение с baseline — в табе «📊 Сравнение» модуля cooling. PUE концепции (см. раздел 6a) использует данные из этого подбора.</p>
` : ''}

<h2>5. Ввод (ТП и ДГУ)</h2>
${c.feed?.tp?.needed ? `<p><b>Трансформаторная подстанция (ТП):</b> ${c.feed.tp.kva} кВА, резервирование — ${_redundancyLabel(c.feed.tp.redundancy)}.</p>` : '<p><i>ТП не предусмотрена.</i></p>'}
${c.feed?.dgu?.needed ? `<p><b>Дизель-генераторная установка (ДГУ):</b> ${c.feed.dgu.kw} кВт, режим — ${_redundancyLabel(c.feed.dgu.mode)}, резервирование — ${_redundancyLabel(c.feed.dgu.redundancy)}.</p>` : '<p><i>ДГУ не предусмотрена.</i></p>'}
<div class="summary">
  <b>Σ принятая мощность объекта:</b> ${feedKw.toFixed(1)} кВт (с учётом потерь и климата ~30%)
</div>

<h2>6. Площади помещений</h2>
<p>Расчётная разбивка площадей (по ТКП 308-2011 / TIA-942):</p>
<table>
  <thead><tr><th>Помещение</th><th class="num">Площадь, м²</th></tr></thead>
  <tbody>
    ${areas.map(a => `<tr><td>${escHtml(a.name)}</td><td class="num">${a.m2}</td></tr>`).join('')}
    <tr><td><b>Σ Итого</b></td><td class="num"><b>${sumM2}</b></td></tr>
  </tbody>
</table>

${pueData ? `
<h2>6a. Расчёт PUE (per-component breakdown)</h2>
<p>Расчётный <b>PUE = ${pueValue.toFixed(2)}</b> ${c.pue?.mode === 'cooling-module' ? '(из связанного подбора cooling)' : '(автоматически по топологии и meteo)'}.
Раскладка не-IT потребления (Phase 30.4):</p>
<table>
  <thead><tr><th>Компонент</th><th class="num">кВт</th><th class="num">% от P<sub>IT</sub></th><th>Источник</th></tr></thead>
  <tbody>
    <tr><td><b>P<sub>IT</sub></b> (нагрузка серверов)</td><td class="num"><b>${pueData.breakdown.itKw.toFixed(1)}</b></td><td class="num">100.0%</td><td>Σ rackGroups[].count × kwPerRack</td></tr>
    <tr><td>P<sub>cooling</sub></td><td class="num">${pueData.breakdown.coolKwAvg.toFixed(1)}</td><td class="num">${(pueData.breakdown.coolKwAvg/pueData.breakdown.itKw*100).toFixed(1)}%</td><td>Σ топология × COP × FreeCool fraction</td></tr>
    <tr><td>P<sub>ups-loss</sub></td><td class="num">${pueData.breakdown.upsLossKw.toFixed(2)}</td><td class="num">${(pueData.breakdown.upsLossKw/pueData.breakdown.itKw*100).toFixed(1)}%</td><td>(1 − η<sub>UPS</sub>)/η<sub>UPS</sub> × P<sub>IT</sub>; η = ${(pueData.breakdown.etaUps * 100).toFixed(0)}%</td></tr>
    <tr><td>P<sub>tp-loss</sub></td><td class="num">${pueData.breakdown.tpLossKw.toFixed(2)}</td><td class="num">${(pueData.breakdown.tpLossKw/pueData.breakdown.itKw*100).toFixed(1)}%</td><td>(1 − η<sub>TP</sub>)/η<sub>TP</sub> × P<sub>downstream</sub>; η = ${(pueData.breakdown.etaTp * 100).toFixed(0)}%</td></tr>
    <tr><td>P<sub>aux</sub> (свет, ОПС, СКУД-CCTV)</td><td class="num">${pueData.breakdown.auxKw.toFixed(2)}</td><td class="num">${(pueData.breakdown.auxFraction * 100).toFixed(1)}%</td><td>aux_fraction × P<sub>IT</sub></td></tr>
    <tr style="border-top:2px solid #888"><td><b>Σ не-IT</b></td><td class="num"><b>${pueData.breakdown.totalNonItKw.toFixed(1)}</b></td><td class="num"><b>${(pueData.breakdown.totalNonItKw/pueData.breakdown.itKw*100).toFixed(1)}%</b></td><td>P<sub>cool</sub> + P<sub>ups</sub> + P<sub>tp</sub> + P<sub>aux</sub></td></tr>
    <tr style="background:#e0f2fe"><td><b>PUE</b></td><td class="num" colspan="3"><b>1 + Σ не-IT / P<sub>IT</sub> = ${pueValue.toFixed(2)}</b></td></tr>
  </tbody>
</table>
<p class="muted" style="font-size:10pt">P<sub>cooling</sub> ≈ среднегодовое (учитывает freecool fraction × COP<sub>fc</sub> + (1−ff) × COP<sub>base</sub>). Default-КПД (η<sub>UPS</sub>=96%, η<sub>TP</sub>=99%, aux=2%) можно overridить в tab «📊 Расчёт PUE».</p>
` : ''}

${serviceSummary ? `
<h2>6b. Сервис: монтаж и ТО (связанные наряды)</h2>
<p>В проекте создано <b>${serviceSummary.installCount + serviceSummary.maintCount}</b> связанных наряд${(serviceSummary.installCount + serviceSummary.maintCount) === 1 ? '' : 'ов'} в модуле <a href="../service/?project=${escAttr(_pid)}" target="_blank">«Сервис: монтаж и ТО»</a>:</p>
<table>
  <thead><tr><th>Тип наряда</th><th class="num">Кол-во</th><th class="num">Σ стоимость для клиента</th></tr></thead>
  <tbody>
    ${serviceSummary.installCount > 0 ? `<tr><td>🔧 Монтажные работы</td><td class="num">${serviceSummary.installCount}</td><td class="num">${serviceSummary.installTotal.toLocaleString('ru-RU')} ${serviceSummary.currency}</td></tr>` : ''}
    ${serviceSummary.maintCount > 0 ? `<tr><td>⚙ ТО (техническое обслуживание)</td><td class="num">${serviceSummary.maintCount}</td><td class="num">${serviceSummary.maintTotal.toLocaleString('ru-RU')} ${serviceSummary.currency}/год</td></tr>` : ''}
    <tr style="border-top:2px solid #888"><td><b>Σ Итого</b></td><td class="num"><b>${serviceSummary.installCount + serviceSummary.maintCount}</b></td><td class="num"><b>${(serviceSummary.installTotal + serviceSummary.maintTotal).toLocaleString('ru-RU')} ${serviceSummary.currency}</b></td></tr>
  </tbody>
</table>
<p class="muted" style="font-size:10pt">Подробные позиции (материалы, работы, командировочные) — в КП каждого наряда. ТО — повторяющиеся работы за год; для многолетнего OPEX × lifetime см. cooling раздел 4a.</p>
` : ''}

<h2>7. Перечень ТЗ для смежных дисциплин</h2>

<h3>7.1. Электрик</h3>
<ul>
  <li>Подобрать конкретные модели ИБП (${(c.upsSystems || []).length} шт.) под параметры из раздела 3.</li>
  <li>Подобрать автоматические выключатели и сечения кабелей по нагрузкам стоек (${itKw.toFixed(1)} кВт IT).</li>
  <li>Предусмотреть распределительный щит ГРЩ под ${(c.upsSystems || []).length + (c.coolingUnits || []).length} вводов.</li>
  ${c.feed?.tp?.needed ? `<li>Подобрать трансформатор ${c.feed.tp.kva} кВА.</li>` : ''}
  ${c.feed?.dgu?.needed ? `<li>Подобрать ДГУ ${c.feed.dgu.kw} кВт (${_redundancyLabel(c.feed.dgu.mode)}).</li>` : ''}
</ul>

<h3>7.2. СКС-инженер</h3>
<ul>
  <li>Расположить ${totalRacks} стоек по группам (раздел 2) в машзале (≈ ${areas.find(a => a.name.startsWith('Машзал'))?.m2 || 0} м²).</li>
  <li>Спроектировать межшкафные связи и кабельные трассы.</li>
  <li>Подобрать конкретные модели стоек (${(c.rackGroups || []).filter(rg => rg.modelRef?.id).length} из ${(c.rackGroups || []).length} групп уже привязаны к каталогу).</li>
</ul>

<h3>7.3. Климатик</h3>
<ul>
  <li>Подобрать конкретные модели кондиционеров (${(c.coolingUnits || []).length} групп(ы) на ${coolKw.toFixed(1)} кВт холода).</li>
  <li>Расположить кондиционеры в климат-зале (≈ ${areas.find(a => a.name.startsWith('Климат'))?.m2 || 0} м²).</li>
  <li>${coolKw < itKw ? 'Доукомплектовать на ' + (itKw - coolKw).toFixed(1) + ' кВт.' : 'Проверить запас при максимальных температурах окружающей среды.'}</li>
</ul>

<h3>7.4. Архитектор</h3>
<ul>
  <li>Скомпоновать помещения общей площадью ${sumM2} м² (см. раздел 6).</li>
  <li>Учесть требования по электротехническим свойствам (двери, кабельные проходки), пожарной безопасности (АГПТ для машзала и АКБ-зала), ИБП-залу — отдельная вентиляция.</li>
</ul>

<p style="margin-top:32px;border-top:1px solid #888;padding-top:8px;font-size:10pt;color:#888;text-align:center">
  Документ сгенерирован автоматически в Raschet · Технолог ЦОД · ${date}
</p>

</body></html>`;
}

function bindReport() {
  const btn = $('tw-report');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const v = _variants.find(x => x.id === _activeId);
    if (!v) { twToast('Сначала выберите вариант.', 'warn'); return; }
    const html = generateReportHtml(v);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { twToast('Браузер заблокировал открытие. Разрешите попапы для этого сайта.', 'warn'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

function bindHandoff() {
  const btn = $('tw-handoff');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const v = _variants.find(x => x.id === _activeId);
    if (!v || v.readOnly) return;
    const summary = `📤 Передать «${v.name}» в детальное проектирование? Будет создана схема в Конструкторе: источник (${v.concept.feed?.tp?.needed ? 'ТП' : 'Utility'}), ГРЩ, ${v.concept.upsSystems?.length || 0} ИБП, ${v.concept.rackGroups?.length || 0} групп стоек, ${v.concept.coolingUnits?.length || 0} кондиционеров. Связи проведёте вручную. Variant станет read-only.`;
    const ok = await twConfirm(summary, 'Handoff в проектирование');
    if (!ok) return;
    try {
      const scheme = _buildSchemeFromConcept(v.concept, v.name);
      // Записываем в engine.scheme.v1 проекта
      const key = projectKey(_pid, 'engine', 'scheme.v1');
      const existing = localStorage.getItem(key);
      if (existing) {
        const ok2 = await twConfirm('В проекте уже есть схема. Заменить её на сгенерированную из концепции? Старая схема будет потеряна (Ctrl+Z в Конструкторе не поможет).', 'Перезапись схемы');
        if (!ok2) return;
      }
      localStorage.setItem(key, JSON.stringify(scheme));
      v.readOnly = true;
      v.handoffAt = Date.now();
      persistVariants();
      renderVariantsList(); renderActiveVariant();
      const goNow = await twConfirm('✓ Схема создана. Открыть Конструктор?', 'Готово');
      if (goNow) location.href = '../index.html';
    } catch (e) {
      console.error('[handoff]', e);
      twToast(`Ошибка handoff: ${e.message || e}`, 'warn');
    }
  });
}

// ─── Main
function init() {
  // v0.60.76: уважать ?project=<id> / ?pid=<id> из URL (как в cooling/service).
  // По требованию Пользователя 2026-05-03 «модуль Технолог ЦОД так же должен
  // иметь привязку к проекту».
  const params = new URLSearchParams(location.search);
  const urlPid = params.get('project') || params.get('pid');
  if (urlPid) {
    const proj = getProject(urlPid);
    if (proj) {
      setActiveProjectId(urlPid);
      _pid = urlPid;
    } else {
      console.warn('[tech-workspace] ?project=' + urlPid + ' не найден — fallback на default');
      _pid = ensureDefaultProject();
    }
  } else {
    _pid = ensureDefaultProject();
  }
  // _pid должен быть string id (для совместимости с projectKey/storage)
  if (typeof _pid === 'object' && _pid?.id) _pid = _pid.id;

  _variants = (loadJson(KEY_VARIANTS, []) || []).map(migrateVariant);
  _activeId = loadJson(KEY_ACTIVE, null);
  _layoutMode = loadJson(KEY_LAYOUT, 'split');
  if (!['split','cards','compact','table'].includes(_layoutMode)) _layoutMode = 'split';
  if (!_variants.length) {
    addVariant();
  } else if (!_variants.some(v => v.id === _activeId)) {
    _activeId = _variants[0].id;
  }
  // v0.60.88: автозаполнение projectData из parent project (preserve-on-miss).
  // Применяется КО ВСЕМ существующим вариантам где поля пустые.
  let synced = 0;
  for (const v of _variants) {
    if (_syncProjectDataFromProject(v.concept)) synced++;
  }
  if (synced > 0) console.info(`[tw v0.60.88] синхронизированы projectData из проекта в ${synced} вариант(ах)`);
  // Сохраним мигрированные данные обратно
  persistVariants();
  renderVariantsList();
  renderActiveVariant();
  bindListEvents();
  bindReport();
  bindHandoff();
  // Sidebar variants list events
  $('tw-variants-list').addEventListener('click', async (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const vid = actBtn.dataset.vid;
      const act = actBtn.dataset.act;
      if (act === 'duplicate') duplicateVariant(vid);
      else if (act === 'delete') deleteVariant(vid);
      else if (act === 'primary') makePrimary(vid);
      // v0.60.85 (Phase 36): sketch-project + approve actions
      else if (act === 'create-sketch') await createSketchForVariant(vid);
      else if (act === 'open-sketch') openSketchForVariant(vid);
      else if (act === 'approve') await approveVariant(vid);
      return;
    }
    const row = e.target.closest('.tw-variant-row');
    if (row) {
      _activeId = row.dataset.vid;
      persistActive();
      renderVariantsList();
      renderActiveVariant();
      // v0.60.86 (Phase 36.4): cross-module panel зависит от sketch-project
      // активного варианта — перерисовываем при смене variant.
      renderCrossModulePanel().catch(e => console.warn('[tech-workspace] cross-module re-render failed:', e));
    }
  });
  $('tw-variant-add').addEventListener('click', addVariant);
  document.querySelectorAll('.tw-mode-btn').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
  // Phase 30.6 (v0.60.62): кросс-модульная панель — async load (meteo
  // читается из IDB) с graceful fallback. Не блокирует init.
  renderCrossModulePanel().catch(e => console.warn('[tech-workspace] cross-module panel failed:', e));
  // v0.60.76: project context picker.
  renderProjectContext();
}

// v0.60.88 (Пользователь 2026-05-03 «модули не синхронизированы по данным
// объекта»): синхронизация concept.projectData с метаданными parent-project.
// Заполняем ТОЛЬКО пустые поля concept (preserve-on-miss), чтобы не затирать
// данные, которые юзер уже изменил вручную.
function _syncProjectDataFromProject(concept) {
  if (!concept) return false;
  if (!concept.projectData) concept.projectData = {};
  const proj = _pid ? getProject(_pid) : null;
  if (!proj) return false;
  const r = proj.requisites || {};
  const loc = proj.location || {};
  let changed = false;
  const setIfEmpty = (key, value) => {
    if (value && (concept.projectData[key] == null || concept.projectData[key] === '')) {
      concept.projectData[key] = value;
      changed = true;
    }
  };
  // v0.60.134: fallback chain — requisites.code → proj.designation → proj.name.
  // По репорту Пользователя: «основные данные проекта опять не передаются».
  // Имя проекта часто содержит шифр (напр. «25006-GEP-GEN-ELC-901_TBC Bank»),
  // поэтому используется как последний fallback, если явный шифр не задан.
  setIfEmpty('designation', r.code || proj.designation || proj.name || '');
  setIfEmpty('customer', r.customer || '');
  setIfEmpty('address', r.address || '');
  setIfEmpty('city', loc.city || '');
  setIfEmpty('designer', r.gip || '');
  // v0.60.134: тип объекта (ЦОД / серверная / ...) тоже из реквизитов, если
  // в концепции ещё не задан конкретный dcType. Только если значения
  // совпадают со словарём концепции — предотвращаем хаос свободного текста.
  if (r.objectType && (concept.projectData.objectType == null || concept.projectData.objectType === '')) {
    concept.projectData.objectType = r.objectType;
    changed = true;
  }
  // lat/lon — числа; setIfEmpty не пройдёт null check
  if (loc.lat != null && (concept.projectData.lat == null)) {
    concept.projectData.lat = Number(loc.lat);
    changed = true;
  }
  if (loc.lon != null && (concept.projectData.lon == null)) {
    concept.projectData.lon = Number(loc.lon);
    changed = true;
  }
  // notes: only fill from project description if concept notes empty
  if (proj.description && (!concept.projectData.notes || concept.projectData.notes === '')) {
    concept.projectData.notes = proj.description;
    changed = true;
  }
  return changed;
}

// v0.60.87 (Phase 36.4 follow-up): helpers для прямых ссылок в headers секций.
// Каждая секция в active-variant view имеет «🛠» иконку, открывающую соотв.
// модуль с правильным pid (sketch-project варианта если есть, иначе parent).
const _MODULE_HREF = {
  'rack-config':        '../rack-config/',
  'scs-config':         '../scs-config/',
  'ups-config':         '../ups-config/',
  'cooling':            '../cooling/',
  'meteo':              '../meteo/',
  'mdc-config':         '../mdc-config/',
  'dgu-config':         '../dgu-config/',
  'transformer-config': '../transformer-config/',
  'mv-config':          '../mv-config/',
  'service':            '../service/',
  'scs-design':         '../scs-design/',
};
function _activePidForModule() {
  // Если у активного варианта есть linked sketch-project — используем его.
  // Иначе — parent.
  const v = _variants.find(x => x.id === _activeId);
  return v?.linkedSketchProjectId || _pid || '';
}
function _isSketchPid() {
  const v = _variants.find(x => x.id === _activeId);
  return !!v?.linkedSketchProjectId;
}
function _buildConfigLink(moduleId) {
  const href = _MODULE_HREF[moduleId] || '../';
  const pid = _activePidForModule();
  if (!pid) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}project=${encodeURIComponent(pid)}&from=tech-workspace`;
}

// v0.60.85 (Phase 36.1): создаёт sketch-project для варианта концепции —
// в нём ведётся независимая разработка схем (schematic / scs-design / cooling /
// service / etc.). Variant.linkedSketchProjectId = id созданного sub-project.
async function createSketchForVariant(vid) {
  if (!_pid) { twToast('Нет родительского проекта.', 'warn'); return; }
  const v = _variants.find(x => x.id === vid);
  if (!v) return;
  if (v.linkedSketchProjectId) {
    twToast('Sketch-проект уже создан для этого варианта.', 'info');
    return;
  }
  const defaultName = `${v.name} — схемы`;
  const name = await twPrompt('Название sketch-проекта:', defaultName, 'Создание sketch-проекта');
  if (!name) return;
  try {
    const sub = createSubProject(_pid, 'tech-workspace', { name: name.trim(), designation: v.name });
    v.linkedSketchProjectId = sub.id;
    persistVariants();
    renderVariantsList();
    // v0.60.86: cross-module panel должна обновиться (теперь у активного
    // variant есть sketch-project — переключаем контекст).
    if (v.id === _activeId) {
      renderCrossModulePanel().catch(err => console.warn('[tw] cm refresh failed:', err));
    }
    twToast(`✓ Создан sketch-проект «${sub.name}». Откройте /projects/ → ${sub.name} для разработки схем.`, 'ok');
  } catch (err) {
    console.error('[tech-workspace] createSketch failed:', err);
    twToast('Ошибка создания: ' + (err.message || err), 'warn');
  }
}

// v0.60.85: открыть sketch-project в новой вкладке.
function openSketchForVariant(vid) {
  const v = _variants.find(x => x.id === vid);
  if (!v?.linkedSketchProjectId) return;
  // Открываем карточку проекта (там список модулей с прямыми ссылками)
  window.open(`../projects/?focus=${encodeURIComponent(v.linkedSketchProjectId)}`, '_blank');
}

// v0.60.85 (Phase 36.3): утвердить вариант. После утверждения — readonly
// badge ✓, sketch-project помечается как «утверждённый» (TODO в Phase 36.3.x:
// статус в /projects/), концепция становится источником итогового BOM.
async function approveVariant(vid) {
  const v = _variants.find(x => x.id === vid);
  if (!v) return;
  // v0.60.136: defence-in-depth — даже если кнопка как-то стала кликабельной
  // (DevTools / direct call), permission проверяется ещё раз.
  if (!hasPermission('canApproveVariants')) {
    twToast('⚠ Утверждение запрещено для текущей роли. Обратитесь к менеджеру проектов или ГИП.', 'warn');
    return;
  }
  if (v.approvedAt) {
    const ok = await twConfirm('Вариант уже утверждён. Снять статус «утверждено»?', 'Снять утверждение');
    if (!ok) return;
    v.approvedAt = null;
    persistVariants();
    renderVariantsList();
    twToast('Утверждение снято.', 'info');
    return;
  }
  const ok = await twConfirm(
    `Утвердить вариант «${v.name}» как итоговый? После утверждения он считается основой для BOM, КП и передачи в проектирование. Снять утверждение можно позже.`,
    '✓ Утвердить вариант'
  );
  if (!ok) return;
  v.approvedAt = Date.now();
  // Auto-mark as primary если других primary нет
  if (!_variants.some(x => x.primary)) v.primary = true;
  persistVariants();
  renderVariantsList();
  renderActiveVariant();
  twToast(`✓ Вариант «${v.name}» утверждён.`, 'ok');
}

// v0.60.76 (по требованию Пользователя 2026-05-03 «модуль Технолог ЦОД
// должен иметь привязку к проекту»): UI picker контекста проекта в sidebar.
// v0.60.134 (по репорту Пользователя 2026-05-04 «как то объедини выбор и
// отображение проекта в одном месте»): sidebar-picker выпилен — он был
// дубликатом header chip (rs-proj-badge в shared/app-header.js). Header
// chip уже показывает активный проект и по клику открывает меню переклю-
// чения / создания. Сохраняем функцию-stub чтобы существующие call-sites
// (`renderProjectContext()` в renderActiveVariant) не падали.
function renderProjectContext() {
  const el = $('tw-project-context');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}

// =============================================================================
// Phase 30.6 (v0.60.62): кросс-модульная панель «🔗 Связанные модули проекта»
// =============================================================================
// Сканирует LS-keys и IDB на наличие данных модулей в namespace проекта.
// Показывает счётчики и ссылки. Один клик → переход в модуль с pid контекстом.
const TW_MODULES = [
  // [moduleId, icon, label, lsSuffix, idbKey?, href, hint]
  { id: 'cooling',          icon: '❄', label: 'Подбор холодильных систем',
    lsSuffix: 'cooling.selections.v1', countInArr: true,
    href: '../cooling/', hint: 'Подборы оборудования (чиллеры, DX, CRAC) с CAPEX/TCO/free-cooling.' },
  { id: 'service',          icon: '🛠', label: 'Сервис: монтаж и ТО',
    lsSuffix: 'service.orders.v1', countInArr: true,
    href: '../service/', hint: 'Наряды на монтаж и ТО с КП/АВР.' },
  { id: 'schematic',        icon: '⚡', label: 'Схема электроснабжения',
    lsSuffix: 'schematic.scheme.v1', countInArr: false,
    href: '../', hint: 'Принципиальная электрическая схема проекта.' },
  { id: 'scs-design',       icon: '🌐', label: 'СКС: проектирование',
    lsSuffix: 'scs-design.scs.v1', countInArr: false,
    href: '../scs-design/', hint: 'СКС-связи между шкафами + план зала.' },
  { id: 'mdc-config',       icon: '🏗', label: 'Конфигуратор МЦОД',
    lsSuffix: 'mdc-config.concept.v1', countInArr: false,
    href: '../mdc-config/', hint: 'Модульный ЦОД GDM-600 с авто-составом.' },
  { id: 'meteo',            icon: '🌤', label: 'Метеоданные',
    lsSuffix: 'meteo.datasets.v1',
    idbKey: (pid) => `meteo.datasets.${pid}`, countInArr: true,
    href: '../meteo/', hint: 'Climate datasets (Open-Meteo / ASHRAE / rp5).' },
  { id: 'suppression-config', icon: '🔥', label: 'АГПТ: газовое пожаротушение',
    lsSuffix: 'suppression-config.installations.v1', countInArr: true,
    href: '../suppression-config/', hint: 'Расчёт ГОТВ по СП 485 / NFPA 2001.' },
  { id: 'rack-config',      icon: '🗄', label: 'Шкафы',
    lsSuffix: 'rack-config.bom.v1', countInArr: false,
    href: '../rack-config/', hint: 'BOM шкафов: корпус, монтажка, PDU, заглушки.' },
  { id: 'ups-config',       icon: '🔋', label: 'Конфигуратор ИБП',
    lsSuffix: 'upsConfig.draft.v1', countInArr: false,
    href: '../ups-config/', hint: 'Wizard-подбор ИБП и АКБ. Pre-fill через capacityKw.' },
  { id: 'dgu-config',       icon: '⚡', label: 'Конфигуратор ДГУ',
    lsSuffix: 'dguConfig.last.v1', countInArr: false,
    href: '../dgu-config/', hint: 'Расчёт ДГУ по ISO 8528-1 + climate derate + подбор Caterpillar/Cummins/Volvo/FG Wilson.' },
];

// v0.60.86 (Phase 36.4): cross-module panel читает данные из ACTIVE variant's
// sketch-project (если он есть), иначе — из parent-проекта. Это даёт
// per-variant видимость модулей, как требовал Пользователь:
//   «в TW-варианте видно schematic ✅ N узлов / cooling ✅ N подборов».
async function renderCrossModulePanel() {
  const root = $('tw-cross-modules');
  if (!root) return;
  const parentPid = (typeof _pid === 'string') ? _pid : (_pid?.id || null);
  if (!parentPid) {
    root.innerHTML = `<div class="muted" style="font-size:11px;padding:6px 0">Нет активного проекта.</div>`;
    return;
  }

  // Активный вариант — может иметь свой linkedSketchProjectId.
  const activeVariant = _variants.find(x => x.id === _activeId);
  const sketchPid = activeVariant?.linkedSketchProjectId || null;
  const pid = sketchPid || parentPid;
  const isSketch = !!sketchPid;

  const items = [];
  for (const mod of TW_MODULES) {
    let count = 0;
    let hasData = false;

    // 1. IDB (если modul использует IDB — meteo с v0.60.54)
    if (mod.idbKey && idbAvailable()) {
      try {
        const data = await idbGet(mod.idbKey(pid), null);
        if (Array.isArray(data) && data.length) {
          count = data.length;
          hasData = true;
        }
      } catch {}
    }

    // 2. LS fallback (или если нет IDB у модуля)
    if (!hasData) {
      try {
        const raw = localStorage.getItem(projectKey(pid, ...mod.lsSuffix.split('.')));
        if (raw && raw !== 'null') {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            count = parsed.length;
            hasData = parsed.length > 0;
          } else if (parsed && typeof parsed === 'object') {
            count = 1;
            hasData = true;
          }
        }
      } catch {}
    }

    items.push({ ...mod, count, hasData });
  }

  // Сортировка: модули с данными вверху.
  items.sort((a, b) => Number(b.hasData) - Number(a.hasData));

  // v0.60.86: header указывает контекст (sketch-проект варианта vs parent).
  const headerHint = isSketch
    ? `<div class="muted" style="font-size:10.5px;padding:2px 0 6px;color:#15803d" title="Данные читаются из sketch-проекта варианта «${escAttr(activeVariant?.name || '')}». При смене активного варианта счётчики обновятся.">📁 Контекст: sketch-проект «${escHtml(activeVariant?.name || '')}»</div>`
    : `<div class="muted" style="font-size:10.5px;padding:2px 0 6px" title="Данные читаются из родительского проекта. Создайте sketch-проект для активного варианта чтобы видеть его независимые схемы.">📁 Контекст: основной проект (нет sketch-проекта у варианта)</div>`;

  root.innerHTML = headerHint + items.map(m => {
    const href = buildModuleHref(m.href, { projectId: pid, fromModule: 'tech-workspace' });
    const countLabel = m.hasData
      ? `<span class="tw-cm-count" title="Количество элементов">${m.count}</span>`
      : `<span class="tw-cm-count empty" title="Нет данных по этому модулю в проекте">—</span>`;
    return `<a href="${escAttr(href)}" class="tw-cm-row${m.hasData ? '' : ' empty'}" title="${escAttr(m.hint)} (одним кликом перейти в модуль)" data-mod="${escAttr(m.id)}">
      <span class="tw-cm-icon">${m.icon}</span>
      <span class="tw-cm-label">${escHtml(m.label)}</span>
      ${countLabel}
    </a>`;
  }).join('');
}

// ─── Utils
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return escHtml(s); }

document.addEventListener('DOMContentLoaded', init);
