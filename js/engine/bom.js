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
          const frameRec = frames.find(f =>
            f.supplier === ups.supplier &&
            Math.abs((f.capacityKw || 0) - (ups.frameKw || ups.capacityKw)) < 1
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
          // Пытаемся найти артикул силового модуля
          const pmRec = powerMods.find(p =>
            p.supplier === ups.supplier &&
            Math.abs((p.capacityKw || 0) - moduleKw) < 0.1
          );
          if (pmRec) {
            pushAgg('Силовые модули ИБП', pmRec, nMods, `${nodeLabel}: ${loadKw.toFixed(0)} кВт / ${moduleKw} кВт`);
          } else {
            // Синтетическая строка, если в каталоге нет отдельной записи
            pushAgg('Силовые модули ИБП', {
              id: ups.id + '-pm',
              supplier: ups.supplier,
              model: `${ups.model} PM ${moduleKw}K`,
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

    // --- Ячейки РУ СН (MV) — детализация VCB/fuse/busCoupler/etc ---
    // Phase 1.20.47: каждая ячейка из n.mvCells получает отдельную
    // строку BOM. Ключ агрегации: breakerType + In_A + functionCode
    // (одинаковые ячейки в разных щитах суммируются по qty).
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
          const brkFake = {
            id: `mvbrk:${brk}:${In}`,
            supplier: n.mvManufacturer || '',
            model: `${brkLabel} ${In}А, ${n.mvVoltageKV || '—'} кВ`,
          };
          pushAgg('Аппараты РУ СН', brkFake, 1, cellNote);
          // 3. Для fuse-switch — ПК-предохранители (3 шт. на 3ф)
          if (brk === 'fuse-switch') {
            const fuseIn = cell.fuseInA || cell.settings?.fuseIn || Math.ceil(In / 10) * 10;
            const fuseFake = {
              id: `mvfuse:${fuseIn}`,
              supplier: '',
              model: `Предохранитель ПК (HV fuse) ${fuseIn}А, ${n.mvVoltageKV || '—'} кВ`,
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
        if (cell.type === 'transformer-protect' || cell.type === 'measurement') {
          const ctFake = {
            id: `mvct:${In}`,
            supplier: '',
            model: `Трансформатор тока ${In}/5А, ${n.mvVoltageKV || '—'} кВ`,
          };
          pushAgg('Аппараты РУ СН', ctFake, 3, cellNote);
        }
      }
    }
  }

  // === Преобразуем агрегат в плоские строки в порядке разделов ===
  const sectionOrder = [
    'Трансформаторы',
    'Щиты',
    'Ячейки РУ СН',
    'Аппараты РУ СН',
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
  const header = ['№', 'Раздел', 'Поз.', 'Производитель', 'Модель / артикул', 'Код', 'Кол-во', 'Ед.', 'Примечание'];
  const aoa = [header];
  // Вставляем строки секционно с разделителями
  let globalN = 0;
  let prevSection = null;
  for (const row of bom) {
    if (row.section !== prevSection) {
      aoa.push([row.section]); // строка-заголовок раздела (мёрж при необходимости)
      prevSection = row.section;
    }
    globalN++;
    aoa.push([
      globalN, row.section, row.position,
      row.supplier, row.model, row.article,
      row.qty, row.unit, row.notes,
    ]);
  }
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  // Ширина колонок
  ws['!cols'] = [
    { wch: 4 }, { wch: 22 }, { wch: 5 }, { wch: 16 }, { wch: 36 },
    { wch: 22 }, { wch: 8 }, { wch: 6 }, { wch: 40 },
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
  const head = ['№','Раздел','Поз','Производитель','Модель','Код','Кол-во','Ед','Примечание'];
  const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [head.join(';')];
  let n = 0;
  for (const r of bom) {
    n++;
    lines.push([n, r.section, r.position, r.supplier, r.model, r.article, r.qty, r.unit, r.notes].map(esc).join(';'));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (projectName || 'Raschet') + ' — Спецификация.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { fname: a.download, rows: bom.length };
}
