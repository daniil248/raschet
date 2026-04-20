// ======================================================================
// js/engine/bom.js
// Полная спецификация (Bill Of Materials) — сборка списка оборудования
// схемы в плоский список строк для XLSX/CSV экспорта.
//
// Что попадает в BOM:
//   1. ИБП (узлы kind:'ups' главной схемы) — по ссылке n.upsCatalogId
//      получаем запись из ups-catalog. Если запись модульная (upsType
//      'modular' + moduleKwRated + moduleSlots) — строка делится на:
//        a) один fraime (артикул из поля frameModel / model + «Frame»)
//        b) силовые модули PM×N штук
//   2. Батарейные шкафы под АКБ узла ИБП:
//        — если batteryCatalogId у узла — выбран блок VRLA/Li-Ion,
//          считаем число блоков (blocksPerString × stringCount) и
//          подбираем ближайшие vrla-cabinet из ups-catalog по rackSlots;
//        — если это Kehua S³ — подбираем batt-cabinet-s3 и считаем модули.
//   3. Сами АКБ-блоки — отдельной строкой, с количеством и ссылкой на
//      battery-catalog (supplier + model + Ah).
//   4. Трансформаторы (узлы kind:'source' → n.transformerCatalogId).
//   5. Щиты (узлы kind:'panel' → n.panelCatalogId).
//
// Один источник истины: проходим ОДИН раз по state.nodes, собираем
// строки в plainArray. Дальше форматтер exportBomXlsx / exportBomCsv
// превращает его в файл.
// ======================================================================

import { state } from './state.js';
import {
  kitById, pduBySku, accBySku,
} from '../../shared/rack-catalog-data.js';
import { pricesForElement } from '../../shared/price-records.js';
import { getCounterparty } from '../../shared/counterparty-catalog.js';

// Внутренний slug — тот же алгоритм, что в shared/rack-catalog-data.js._slug.
// Нужен, чтобы id в BOM совпадал с id в element-library ('pdu.'+slug и т.п.)
// и работал price-lookup.
function _bomSlug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Сквозной хелпер: читает каталог из localStorage (per-user + legacy
 * fallback) и возвращает массив записей или пустой массив.
 */
function _readCatalog(keyBase) {
  try {
    const uid = localStorage.getItem('raschet.currentUserId') || 'anonymous';
    const raw = localStorage.getItem(keyBase + '.' + uid)
             || localStorage.getItem(keyBase);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/**
 * Собирает строки BOM. Возвращает плоский массив объектов:
 *   { section, position, supplier, model, article, qty, unit, notes }
 *
 * section — раздел (ИБП, Модули ИБП, Батарейные шкафы, АКБ,
 *            Трансформаторы, Щиты, Прочее)
 * position — порядковый номер внутри раздела (расставляется при экспорте)
 */
export function buildBOM() {
  const upsCat  = _readCatalog('raschet.upsCatalog.v1');
  const battCat = _readCatalog('raschet.batteryCatalog.v1');
  const txCat   = _readCatalog('raschet.transformerCatalog.v1');
  const panelCat = _readCatalog('raschet.panelCatalog.v1');

  const byId = (arr, id) => arr.find(x => x.id === id) || null;
  // Для батарейных шкафов — выборка только vrla/s3 kind
  const vrlaCabs = upsCat.filter(r => r.kind === 'batt-cabinet-vrla');
  const s3Cabs   = upsCat.filter(r => r.kind === 'batt-cabinet-s3');
  // Для силовых модулей и фреймов — kind='power-module' / 'frame'
  const frames   = upsCat.filter(r => r.kind === 'frame');
  const powerMods = upsCat.filter(r => r.kind === 'power-module');

  const rows = [];

  // === Счётчики агрегации ===
  // Ключ: id каталожной записи. Значение: { rec, qty, notes[] }
  const agg = new Map();
  const pushAgg = (section, rec, qty, note) => {
    if (!rec || qty <= 0) return;
    const key = section + '::' + (rec.id || rec.model);
    if (!agg.has(key)) {
      agg.set(key, { section, rec, qty: 0, notes: new Set() });
    }
    const a = agg.get(key);
    a.qty += qty;
    if (note) a.notes.add(note);
  };

  // === Проход по узлам схемы ===
  for (const n of state.nodes.values()) {
    const kind = n.kind || n.type;

    // --- ИБП ---
    if (kind === 'ups' && n.upsCatalogId) {
      const ups = byId(upsCat, n.upsCatalogId);
      if (ups) {
        const nodeLabel = n.name || n.tag || 'ИБП';
        if (ups.upsType === 'modular' && ups.moduleKwRated > 0) {
          // Модульный: фрейм + N модулей
          // Пытаемся найти соответствующий frame-артикул (Kehua: frameKw)
          // v0.58.80: в seed фреймов capacityKw=0, frameKw несёт мощность.
          // Ищем по frameKw (или fallback на capacityKw).
          const frameRec = frames.find(f =>
            f.supplier === ups.supplier &&
            Math.abs((f.frameKw || f.capacityKw || 0) - (ups.frameKw || ups.capacityKw)) < 1
          ) || null;
          if (frameRec) {
            pushAgg('Фреймы ИБП', frameRec, 1, nodeLabel);
          } else {
            // Фолбэк: добавляем сам ИБП как фрейм
            pushAgg('ИБП', ups, 1, nodeLabel + ' (модульный, фрейм)');
          }
          // Силовые модули: число = загрузка / moduleKwRated, округление вверх,
          // но не меньше моделей из схемы (n.moduleCount) и не больше moduleSlots
          const loadKw = Number(n._maxLoadKw || n._loadKw || ups.capacityKw || 0);
          const eff = (ups.efficiency || 96) / 100;
          const moduleKw = ups.moduleKwRated;
          let nMods = Math.ceil((loadKw / eff) / moduleKw);
          if (n.moduleCount) nMods = Math.max(nMods, Number(n.moduleCount));
          if (ups.moduleSlots) nMods = Math.min(nMods, ups.moduleSlots);
          nMods = Math.max(1, nMods);
          // v0.58.80: силовые модули 30/50/100 кВт у Kehua — общие артикулы
          // (MR33 PM 30K / 50K / 100K), не зависят от модели ИБП. Поэтому
          // ищем по moduleKwRated (а не по capacityKw, который у модулей 0).
          const pmRec = powerMods.find(p =>
            p.supplier === ups.supplier &&
            Math.abs((p.moduleKwRated || p.capacityKw || 0) - moduleKw) < 0.1
          );
          if (pmRec) {
            pushAgg('Силовые модули ИБП', pmRec, nMods, `${nodeLabel}: ${loadKw.toFixed(0)} кВт / ${moduleKw} кВт`);
          } else {
            // Синтетическая строка, если в каталоге нет отдельной записи —
            // ключ НЕ зависит от id ИБП, чтобы одинаковые модули от разных
            // моделей ИБП агрегировались в одну строку.
            pushAgg('Силовые модули ИБП', {
              id: `pm-${(ups.supplier || '').toLowerCase()}-${moduleKw}k`,
              supplier: ups.supplier,
              model: `Силовой модуль ${moduleKw} кВт`,
            }, nMods, nodeLabel);
          }
        } else {
          // Моноблок — одна строка
          pushAgg('ИБП', ups, 1, nodeLabel);
        }
      }
    }

    // --- АКБ и шкафы АКБ для узла ИБП ---
    if (kind === 'ups' && n.batteryCatalogId) {
      const batt = byId(battCat, n.batteryCatalogId);
      if (batt) {
        const blocksPer = Number(n.batteryBlocksPerString) || 0;
        const strings   = Math.max(1, Number(n.batteryStringCount) || 1);
        const totalBlocks = blocksPer * strings;
        if (totalBlocks > 0) {
          const nodeLabel = n.name || n.tag || 'ИБП';
          const battLabel = `${batt.supplier} ${batt.type}${batt.capacityAh ? ' ' + batt.capacityAh + ' А·ч' : ''}`;
          pushAgg('АКБ блоки', batt, totalBlocks, `${nodeLabel}: ${strings} струн × ${blocksPer} бл`);

          // Подбор батарейного шкафа. Если выбран Kehua S³ (по модели) —
          // подбираем s3Cabs, иначе vrla. Критерий: минимальный шкаф с
          // rackSlots >= totalBlocks. Число шкафов = ceil(total/cap).
          const isS3 = /s3|kehua.*s³/i.test(batt.supplier + ' ' + batt.type);
          const cabPool = isS3 ? s3Cabs : vrlaCabs;
          if (cabPool.length) {
            // Сортировка по slots ↑
            const sorted = [...cabPool].sort((a, b) => (a.rackSlots || 0) - (b.rackSlots || 0));
            // Подберём шкаф, где слот подходит под размер блока (maxBlockAh)
            const ahCap = Number(batt.capacityAh) || 0;
            const candidate = sorted.find(c => {
              const slotsBy = c.rackSlotsByCap && ahCap > 0
                ? (c.rackSlotsByCap[ahCap + 'Ah'] || c.rackSlotsByCap[String(ahCap)] || c.rackSlots)
                : c.rackSlots;
              return slotsBy >= totalBlocks;
            }) || sorted[sorted.length - 1];
            if (candidate) {
              const capPerCab = (candidate.rackSlotsByCap && ahCap > 0
                ? (candidate.rackSlotsByCap[ahCap + 'Ah'] || candidate.rackSlots)
                : candidate.rackSlots) || 1;
              const nCabs = Math.ceil(totalBlocks / capPerCab);
              pushAgg('Батарейные шкафы', candidate, nCabs, `${totalBlocks} блоков × ${ahCap || '?'} А·ч → ${capPerCab} в шкафу`);
            }
          }
        }
      }
    }

    // --- Трансформаторы ---
    if ((kind === 'source' || kind === 'transformer') && n.transformerCatalogId) {
      const tx = byId(txCat, n.transformerCatalogId);
      if (tx) {
        pushAgg('Трансформаторы', tx, 1, n.name || n.tag || '');
      }
    }

    // --- Щиты ---
    if ((kind === 'panel' || kind === 'busbar' || kind === 'distribution') && n.panelCatalogId) {
      const pn = byId(panelCat, n.panelCatalogId);
      if (pn) {
        pushAgg('Щиты', pn, 1, n.name || n.tag || '');
      }
    }

    // --- Шкафы 19" / rack-config ---
    // v0.58.78: если узел (обычно type='consumer') получил rackTemplate из
    // rack-config, разворачиваем его состав в BOM: сам комплект стойки,
    // установленные PDU и аксессуары. Без этого обработчика выбранная в
    // rack-config стойка не попадала в спецификацию проекта.
    if (n.rackTemplate && typeof n.rackTemplate === 'object') {
      const t = n.rackTemplate;
      const nodeLabel = n.name || n.tag || 'Стойка';

      // 1. Комплект стойки (kit) — один артикул
      const kit = t.kitId ? kitById(t.kitId) : null;
      if (kit && kit.id) {
        const kitFake = {
          // v0.58.81: id совпадает с element-library ('rack.'+kitId),
          // чтобы работал price-lookup из shared/price-records.
          id: 'rack.' + kit.id,
          supplier: kit.mfg || (kit.preset && kit.preset.manufacturer) || t.manufacturer || '',
          model: kit.name || kit.id,
          article: kit.sku || '',
        };
        // Формируем короткую сводку по габаритам
        const dim = [t.u ? t.u + 'U' : '', t.width ? t.width + 'мм' : '',
                     t.depth ? 'гл.' + t.depth + 'мм' : ''].filter(Boolean).join('×');
        pushAgg('Шкафы 19"', kitFake, 1, nodeLabel + (dim ? ' · ' + dim : ''));
      } else if (t.manufacturer || t.u) {
        // Нет готового kit — добавляем синтетическую позицию "лист требований"
        const fakeKit = {
          id: 'rack:custom:' + (n.id || Math.random().toString(36).slice(2, 6)),
          supplier: t.manufacturer || '',
          model: `Шкаф 19" ${t.u || '?'}U · ${t.width || '?'}×${t.depth || '?'}мм (требование)`,
        };
        pushAgg('Шкафы 19"', fakeKit, 1, nodeLabel + ' (произвольная конфигурация)');
      }

      // 2. PDU — по списку t.pdus = [{ sku, qty }, ...]
      if (Array.isArray(t.pdus)) {
        for (const p of t.pdus) {
          if (!p || !p.sku) continue;
          const qty = Math.max(1, Number(p.qty) || 1);
          const cat = pduBySku(p.sku);
          if (cat) {
            const pduFake = {
              // v0.58.81: id = element-library id ('pdu.'+slug(sku)).
              id: 'pdu.' + _bomSlug(cat.sku),
              supplier: cat.mfg || '',
              model: cat.name || cat.sku,
              article: cat.sku,
            };
            pushAgg('PDU (блоки распределения питания)', pduFake, qty, nodeLabel);
          } else {
            // SKU есть, но в каталоге не найден — выводим по голому SKU
            const pduFake = {
              id: 'pdu.' + _bomSlug(p.sku),
              supplier: '',
              model: p.sku,
              article: p.sku,
            };
            pushAgg('PDU (блоки распределения питания)', pduFake, qty,
              nodeLabel + ' (SKU не найден в каталоге)');
          }
        }
      }

      // 3. Аксессуары стойки — t.accessories = [{ sku, qty }, ...]
      if (Array.isArray(t.accessories)) {
        for (const a of t.accessories) {
          if (!a || !a.sku) continue;
          const qty = Math.max(1, Number(a.qty) || 1);
          const cat = accBySku(a.sku);
          if (cat) {
            const accFake = {
              // v0.58.81: id = element-library id ('rack-acc.'+slug(sku)).
              id: 'rack-acc.' + _bomSlug(cat.sku),
              supplier: cat.mfg || '',
              model: cat.name || cat.sku,
              article: cat.sku,
            };
            pushAgg('Аксессуары стоек', accFake, qty, nodeLabel);
          } else {
            const accFake = {
              id: 'rack-acc.' + _bomSlug(a.sku),
              supplier: '',
              model: a.sku,
              article: a.sku,
            };
            pushAgg('Аксессуары стоек', accFake, qty,
              nodeLabel + ' (SKU не найден в каталоге)');
          }
        }
      }
    }

    // --- Ячейки РУ СН (MV) — детализация VCB/fuse/busCoupler/etc ---
    // Phase 1.20.47: каждая ячейка из n.mvCells получает отдельную
    // строку BOM. Ключ агрегации: breakerType + In_A + functionCode
    // (одинаковые ячейки в разных щитах суммируются по qty).
    // v0.58.84: если у панели есть mvSwitchgearId (ссылка на запись
     // element-library типа mv-switchgear) — добавляем отдельной строкой
     // сборку целиком. Это даёт возможность вести цену на сборку в catalog,
     // параллельно с детализацией по ячейкам.
    if (kind === 'panel' && n.isMv && n.mvSwitchgearId) {
      try {
        const lib = globalThis.__raschetElementLibrary;
        const el = lib && typeof lib.getElement === 'function'
          ? lib.getElement(n.mvSwitchgearId) : null;
        if (el) {
          const fake = {
            id: el.id,
            supplier: el.manufacturer || n.mvManufacturer || '',
            model: [el.series, el.variant || el.label].filter(Boolean).join(' ') || el.label || el.id,
          };
          pushAgg('РУ СН (сборки)', fake, 1, n.name || n.tag || '');
        }
      } catch {}
    }

    if (kind === 'panel' && n.isMv && Array.isArray(n.mvCells) && n.mvCells.length) {
      const CELL_LABELS = {
        'infeed': 'Ввод', 'feeder': 'Отходящая',
        'transformer-protect': 'Защита ТР', 'busCoupler': 'Секционная',
        'measurement': 'Измерение', 'earthing': 'Заземление',
        'metering': 'Учёт',
      };
      // v0.57.55: детализация аппаратов ячейки — VCB/switch/fuse/реле
      // попадают как отдельные позиции в «Аппараты РУ СН». Ячейка как
      // мех. изделие остаётся в «Ячейки РУ СН».
      const BRK_LABELS = {
        'VCB': 'Вакуумный выключатель',
        'SF6': 'Элегазовый выключатель',
        'fuse-switch': 'Выключатель-разъединитель с предохранителями',
        'load-break-switch': 'Выключатель нагрузки',
        'disconnector': 'Разъединитель',
      };
      // v0.58.85: ряды стандартов из element-library для мэппинга id
      const MV_VCB_IN_LIB = [630, 1250, 2000, 2500, 3150, 4000];
      const _mvUn = Number(n.mvVoltageKV) || 10;  // 10 или 24
      const _mvUnLib = _mvUn >= 20 ? 24 : 10;     // ближайший к library-seed
      for (const cell of n.mvCells) {
        const brk = cell.breakerType || '—';
        const In = cell.In_A || cell.In || 0;
        const typeLabel = CELL_LABELS[cell.type] || cell.type || '?';
        const cellNote = (n.name || n.tag || '') + (cell.functionCode ? ' / ' + cell.functionCode : '');
        // 1. Ячейка как мех. единица (шкаф + шины)
        const cellFake = {
          id: `mvcell:${cell.type}:${brk}:${In}`,
          supplier: n.mvManufacturer || '',
          model: `${typeLabel} · ${brk} · ${In}А`,
        };
        pushAgg('Ячейки РУ СН', cellFake, 1, cellNote);
        // 2. Защитный аппарат — отдельной строкой
        const brkLabel = BRK_LABELS[brk];
        if (brkLabel) {
          // v0.58.85: для VCB id совпадает с breaker-seed → priceable через catalog.
          // Округляем In вверх к стандартному ряду MV_VCB_IN.
          let brkId = `mvbrk:${brk}:${In}`;
          if (brk === 'VCB') {
            const InLib = MV_VCB_IN_LIB.find(v => v >= In) || MV_VCB_IN_LIB[MV_VCB_IN_LIB.length - 1];
            brkId = `mv-vcb-${_mvUnLib}kv-${InLib}`;
          }
          const brkFake = {
            id: brkId,
            supplier: n.mvManufacturer || '',
            model: `${brkLabel} ${In}А, ${n.mvVoltageKV || '—'} кВ`,
          };
          pushAgg('Аппараты РУ СН', brkFake, 1, cellNote);
          // 3. Для fuse-switch — ПК-предохранители (3 шт. на 3ф)
          if (brk === 'fuse-switch') {
            // Стандартный ряд HV fuses (DIN 43625 / IEC 60282-1)
            const HV_FUSE = [2, 4, 6, 10, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200];
            // v0.58.85: ряд HV fuses, представленный в breaker-seed.js
            const HV_FUSE_LIB_10 = [20, 31.5, 40, 50, 63, 80, 100];
            const HV_FUSE_LIB_24 = [16, 25, 40, 50];
            const rawFuse = Number(cell.fuseInA) || Number(cell.settings?.fuseIn) || In;
            const fuseIn = HV_FUSE.find(v => v >= rawFuse) || 200;
            const libSet = _mvUnLib === 24 ? HV_FUSE_LIB_24 : HV_FUSE_LIB_10;
            const fuseInLib = libSet.find(v => v >= rawFuse);
            const fuseId = fuseInLib
              ? `mv-fuse-${_mvUnLib}kv-${fuseInLib}`
              : `mvfuse:${fuseIn}`;
            const fuseFake = {
              id: fuseId,
              supplier: '',
              model: `Предохранитель ПК (HV fuse) ${fuseIn}А, ${n.mvVoltageKV || '—'} кВ (IEC 60282-1)`,
            };
            pushAgg('Аппараты РУ СН', fuseFake, 3, cellNote);
          }
          // 4. Для VCB/SF6 с релейными уставками — реле защиты
          if ((brk === 'VCB' || brk === 'SF6') && cell.settings && Number(cell.settings.Ir) > 0) {
            const relayFake = {
              id: `mvrelay:generic`,
              supplier: '',
              model: `Реле защиты МВ (Ir/Isd/tsd/Ii, IEC 60255)`,
            };
            pushAgg('Аппараты РУ СН', relayFake, 1, cellNote);
          }
        }
        // 5. Для transformer-protect — трансформатор тока (3 шт. на 3ф)
        // Первичный ток округляется вверх до стандартного ряда IEC 60044-1.
        if (cell.type === 'transformer-protect' || cell.type === 'measurement') {
          const CT_PRIMARY = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200,
            300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000];
          const ctPrim = CT_PRIMARY.find(v => v >= In) || Math.ceil(In / 500) * 500;
          const ctFake = {
            id: `mvct:${ctPrim}`,
            supplier: '',
            model: `Трансформатор тока ${ctPrim}/5А, ${n.mvVoltageKV || '—'} кВ (IEC 60044-1)`,
          };
          pushAgg('Аппараты РУ СН', ctFake, 3, cellNote);
        }
      }
    }
  }

  // === Проход по связям (кабелям) — защитные аппараты LV ===
  // v0.57.60: автоматы и предохранители LV попадают в BOM отдельными
  // позициями. Ключ агрегации:
  //   автомат  — "QF " + кривая/тип + " " + In_A
  //   предохр. — "FU " + fuseType + " " + In_A
  // Для параллельных линий количество умножается на число линий.
  // Для кабелей в режиме individual (когда выбран _breakerIn на общий
  // ввод и _breakerPerLine на каждую линию) получаем две позиции.
  const nodeLabel = (id) => {
    const nn = state.nodes.get(id);
    return nn ? (nn.name || nn.tag || ('#' + String(id).slice(0, 4))) : '?';
  };
  for (const c of state.conns.values()) {
    if (!c) continue;
    // MV-линии уже учтены в ячейках РУ СН
    if (c._isMv || c.isMv) continue;
    // Защиту внутри ИБП (QF1/QF2/QF3) каталогизируем через фрейм — пропускаем
    if (c._breakerInternal) continue;
    const fromLbl = c.from ? nodeLabel(c.from.nodeId) : '';
    const toLbl   = c.to   ? nodeLabel(c.to.nodeId)   : '';
    const note = fromLbl + ' → ' + toLbl;
    const parallel = Math.max(1, Number(c._breakerCount) || 1);
    const kind  = c._protectionKind === 'fuse' ? 'fuse' : 'breaker';
    const curve = c._breakerCurveEff || c.breakerCurve || '';
    const fuseType = c._fuseType || 'gG';

    // Режимы:
    //   а) один общий автомат:  _breakerIn задан,   _breakerPerLine == null
    //   б) индивидуально:       _breakerIn задан,   _breakerPerLine задан (кол-во = parallel)
    //   в) per-line без общего: _breakerIn == null, _breakerPerLine задан (кол-во = parallel)
    const Itot = Number(c._breakerIn) || 0;
    const Iper = Number(c._breakerPerLine) || 0;

    if (kind === 'fuse') {
      // Предохранители — по 3 шт. на 3-фазную линию, по 1 шт. на 1-фазную
      const polePerSet = (c.phases === 1) ? 1 : 3;
      if (Itot > 0 && Iper > 0) {
        // Индивидуально: общий + на каждую линию
        const recTot = { id: `lvfuse:${Itot}:${fuseType}:common`, supplier: '', model: `FU ${Itot}А ${fuseType} (общий ввод, IEC 60269-1)` };
        pushAgg('Предохранители LV', recTot, polePerSet, note);
        const recPer = { id: `lvfuse:${Iper}:${fuseType}:perline`, supplier: '', model: `FU ${Iper}А ${fuseType} (на линию, IEC 60269-1)` };
        pushAgg('Предохранители LV', recPer, polePerSet * parallel, note + ` × ${parallel} лин.`);
      } else if (Itot > 0) {
        const rec = { id: `lvfuse:${Itot}:${fuseType}`, supplier: '', model: `FU ${Itot}А ${fuseType} (IEC 60269-1)` };
        pushAgg('Предохранители LV', rec, polePerSet, note);
      } else if (Iper > 0) {
        const rec = { id: `lvfuse:${Iper}:${fuseType}:perline`, supplier: '', model: `FU ${Iper}А ${fuseType} (IEC 60269-1)` };
        pushAgg('Предохранители LV', rec, polePerSet * parallel, note + (parallel > 1 ? ` × ${parallel} лин.` : ''));
      }
    } else {
      // Автоматы
      const curveTag = curve || 'MCCB';
      if (Itot > 0 && Iper > 0) {
        const recTot = { id: `lvqf:${Itot}:${curveTag}:common`, supplier: '', model: `QF ${Itot}А ${curveTag} (общий ввод, IEC 60898/60947-2)` };
        pushAgg('Автоматы LV', recTot, 1, note);
        const recPer = { id: `lvqf:${Iper}:${curveTag}:perline`, supplier: '', model: `QF ${Iper}А ${curveTag} (на линию, IEC 60898/60947-2)` };
        pushAgg('Автоматы LV', recPer, parallel, note + ` × ${parallel} лин.`);
      } else if (Itot > 0) {
        const rec = { id: `lvqf:${Itot}:${curveTag}`, supplier: '', model: `QF ${Itot}А ${curveTag} (IEC 60898/60947-2)` };
        pushAgg('Автоматы LV', rec, 1, note);
      } else if (Iper > 0) {
        const rec = { id: `lvqf:${Iper}:${curveTag}:perline`, supplier: '', model: `QF ${Iper}А ${curveTag} (IEC 60898/60947-2)` };
        pushAgg('Автоматы LV', rec, parallel, note + (parallel > 1 ? ` × ${parallel} лин.` : ''));
      }
    }
  }

  // === Преобразуем агрегат в плоские строки в порядке разделов ===
  const sectionOrder = [
    'Трансформаторы',
    'Щиты',
    'Ячейки РУ СН',
    'Аппараты РУ СН',
    'Автоматы LV',
    'Предохранители LV',
    'ИБП',
    'Фреймы ИБП',
    'Силовые модули ИБП',
    'Батарейные шкафы',
    'АКБ блоки',
  ];
  const bySection = new Map();
  for (const a of agg.values()) {
    if (!bySection.has(a.section)) bySection.set(a.section, []);
    bySection.get(a.section).push(a);
  }
  const result = [];
  for (const section of sectionOrder) {
    const items = bySection.get(section);
    if (!items || !items.length) continue;
    // Сортировка внутри раздела: supplier → model
    items.sort((a, b) => {
      const sa = (a.rec.supplier || '') + (a.rec.model || '');
      const sb = (b.rec.supplier || '') + (b.rec.model || '');
      return sa.localeCompare(sb);
    });
    items.forEach((a, i) => {
      result.push({
        section,
        position: i + 1,
        supplier: a.rec.supplier || '',
        model: a.rec.model || a.rec.type || '',
        article: a.rec.id || '',
        qty: a.qty,
        unit: a.section === 'АКБ блоки' || a.section === 'Силовые модули ИБП' ? 'шт' : 'шт',
        notes: Array.from(a.notes).join('; '),
      });
    });
  }
  // Дополнительно: разделы, которые появились, но не указаны в sectionOrder
  for (const [section, items] of bySection.entries()) {
    if (sectionOrder.includes(section)) continue;
    items.forEach((a, i) => {
      result.push({
        section, position: i + 1,
        supplier: a.rec.supplier || '', model: a.rec.model || '',
        article: a.rec.id || '', qty: a.qty, unit: 'шт',
        notes: Array.from(a.notes).join('; '),
      });
    });
  }
  return result;
}

/**
 * Экспорт BOM в XLSX через SheetJS. Группирует по section, рисует
 * заголовки разделов (жирным), под ними — строки позиций.
 */
export function exportBomXlsx(projectName) {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error('SheetJS (window.XLSX) не подключён');
  }
  const bom = buildBOM();
  if (!bom.length) {
    throw new Error('Спецификация пуста: проверьте, что узлы привязаны к каталожным записям.');
  }
  // v0.58.82: цены в экспорте. v0.58.83: колонка «Контрагент» + итоги по валютам
  // + счётчик позиций без цены.
  const header = ['№', 'Раздел', 'Поз.', 'Производитель', 'Модель / артикул', 'Код',
                  'Кол-во', 'Ед.', 'Цена, ед.', 'Валюта', 'Сумма',
                  'Контрагент', 'Примечание'];
  const aoa = [header];
  let globalN = 0;
  let prevSection = null;
  const totalsByCurrency = Object.create(null); // { RUB: 123, USD: 45 }
  let rowsWithoutPrice = 0;
  let rowsWithPrice = 0;
  for (const row of bom) {
    if (row.section !== prevSection) {
      aoa.push([row.section]);
      prevSection = row.section;
    }
    globalN++;
    let unitPrice = null, currency = '', total = null, counterparty = '';
    try {
      const info = pricesForElement(row.id, { activeOnly: true });
      if (info && info.latest) {
        unitPrice = Number(info.latest.price) || null;
        currency  = info.latest.currency || '';
        if (unitPrice != null) total = unitPrice * (Number(row.qty) || 0);
        if (info.latest.counterpartyId) {
          try {
            const cp = getCounterparty(info.latest.counterpartyId);
            if (cp) counterparty = cp.shortName || cp.name || cp.id;
          } catch {}
        }
      }
    } catch {}
    if (unitPrice != null && currency) {
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + (total || 0);
      rowsWithPrice++;
    } else {
      rowsWithoutPrice++;
    }
    aoa.push([
      globalN, row.section, row.position,
      row.supplier, row.model, row.article,
      row.qty, row.unit,
      unitPrice, currency, total,
      counterparty, row.notes,
    ]);
  }
  // Итоги по валютам — одной или несколькими строками
  const currencies = Object.keys(totalsByCurrency);
  if (currencies.length) {
    aoa.push([]);
    aoa.push(['', 'ИТОГО по проекту', '', '', '', '', '', '', '', '', '', '', '']);
    for (const cur of currencies) {
      aoa.push(['', 'Сумма ' + cur, '', '', '', '', '', '', '', cur,
                totalsByCurrency[cur], '', '']);
    }
    if (rowsWithoutPrice) {
      aoa.push(['', `Позиций без цены: ${rowsWithoutPrice} из ${rowsWithPrice + rowsWithoutPrice}`,
                '', '', '', '', '', '', '', '', '', '', '']);
    }
  } else if (rowsWithoutPrice) {
    aoa.push([]);
    aoa.push(['', `Цены не заведены ни для одной позиции (всего ${rowsWithoutPrice})`,
              '', '', '', '', '', '', '', '', '', '', '']);
  }
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 4 }, { wch: 22 }, { wch: 5 }, { wch: 16 }, { wch: 36 },
    { wch: 22 }, { wch: 8 }, { wch: 6 },
    { wch: 12 }, { wch: 6 }, { wch: 14 },
    { wch: 18 }, { wch: 40 },
  ];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'BOM');
  const fname = (projectName || 'Raschet') + ' — Спецификация.xlsx';
  window.XLSX.writeFile(wb, fname);
  return { fname, rows: bom.length };
}

/**
 * CSV-фолбэк: простой текст, если SheetJS недоступен.
 */
export function exportBomCsv(projectName) {
  const bom = buildBOM();
  if (!bom.length) throw new Error('Спецификация пуста.');
  const head = ['№','Раздел','Поз','Производитель','Модель','Код','Кол-во','Ед',
                'Цена, ед.','Валюта','Сумма','Контрагент','Примечание'];
  const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [head.join(';')];
  let n = 0;
  const totalsByCurrency = Object.create(null);
  let rowsWithoutPrice = 0, rowsWithPrice = 0;
  for (const r of bom) {
    n++;
    let unitPrice = '', currency = '', total = '', counterparty = '';
    try {
      const info = pricesForElement(r.id, { activeOnly: true });
      if (info && info.latest) {
        unitPrice = Number(info.latest.price) || '';
        currency  = info.latest.currency || '';
        if (unitPrice !== '') total = unitPrice * (Number(r.qty) || 0);
        if (info.latest.counterpartyId) {
          try {
            const cp = getCounterparty(info.latest.counterpartyId);
            if (cp) counterparty = cp.shortName || cp.name || cp.id;
          } catch {}
        }
      }
    } catch {}
    if (unitPrice !== '' && currency) {
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + (total || 0);
      rowsWithPrice++;
    } else {
      rowsWithoutPrice++;
    }
    lines.push([n, r.section, r.position, r.supplier, r.model, r.article,
                r.qty, r.unit, unitPrice, currency, total,
                counterparty, r.notes].map(esc).join(';'));
  }
  const currencies = Object.keys(totalsByCurrency);
  if (currencies.length) {
    lines.push('');
    lines.push(['', 'ИТОГО по проекту', '', '', '', '', '', '', '', '', '', '', ''].map(esc).join(';'));
    for (const cur of currencies) {
      lines.push(['', 'Сумма ' + cur, '', '', '', '', '', '', '', cur,
                  totalsByCurrency[cur], '', ''].map(esc).join(';'));
    }
    if (rowsWithoutPrice) {
      lines.push(['', `Позиций без цены: ${rowsWithoutPrice} из ${rowsWithPrice + rowsWithoutPrice}`,
                  '', '', '', '', '', '', '', '', '', '', ''].map(esc).join(';'));
    }
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (projectName || 'Raschet') + ' — Спецификация.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { fname: a.download, rows: bom.length };
}
