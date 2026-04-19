// ======================================================================
// js/engine/report-sections.js
//
// Отчёты по схеме, разбитые на независимые разделы. Каждый раздел
// собирается как самостоятельный отчёт: текст для быстрого просмотра
// + массив блоков (shared/report/blocks.js) для экспорта в PDF / DOCX
// с применением подходящего встроенного шаблона (templates-seed.js).
//
// Раньше всё это было единым текстовым отчётом в report.js. Сейчас
// каждый раздел — отдельный экспортируемый отчёт, а полный отчёт
// остаётся доступным как отдельный пункт.
// ======================================================================

import { state } from './state.js';
import { CHANNEL_TYPES, GLOBAL } from './constants.js';
import { recalc } from './recalc.js';
import { effectiveOn, effectiveLoadFactor } from './modes.js';
import { effectiveTag } from './zones.js';
import { cableVoltageClass, nodeVoltage } from './electrical.js';
import { fmt } from './utils.js';
import { get3PhaseBalance, generateReport } from './report.js';
import * as B from '../../shared/report/blocks.js';
import { collectBomFromProject, groupBomByKind } from '../../shared/bom.js';
import { analyzeSelectivity } from './selectivity-check.js';
import { getCableType } from '../../shared/cable-types-catalog.js';
import { pricesForElement } from '../../shared/price-records.js';
import { listElements } from '../../shared/element-library.js';

// ——— общие хелперы ———
function fullTag(n) { if (!n) return ''; return effectiveTag(n) || n.tag || ''; }

function sortByTag(arr) {
  return arr.sort((a, b) => {
    const ta = (effectiveTag(a) || a.tag || a.name || '').toLowerCase();
    const tb = (effectiveTag(b) || b.tag || b.name || '').toLowerCase();
    return ta.localeCompare(tb, 'ru', { numeric: true, sensitivity: 'base' });
  });
}

function pageFilters() {
  const curPage = (state.pages || []).find(p => p.id === state.currentPageId);
  const pageSpace = new Set();
  if (curPage) {
    pageSpace.add(curPage.id);
    for (const p of (state.pages || [])) {
      if (p.type === 'linked' && p.sourcePageId === curPage.id) pageSpace.add(p.id);
    }
  }
  const inSpace = (node) => {
    if (!curPage) return true;
    const pids = Array.isArray(node?.pageIds) ? node.pageIds : null;
    if (!pids || pids.length === 0) return true;
    for (const pid of pids) if (pageSpace.has(pid)) return true;
    return false;
  };
  const connInSpace = (c) => {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    return fromN && toN && inSpace(fromN) && inSpace(toN);
  };
  return { curPage, inSpace, connInSpace };
}

function projectMeta() {
  const proj = state.project || {};
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const modeName = state.activeModeId
    ? ((state.modes || []).find(x => x.id === state.activeModeId)?.name || '—')
    : 'Нормальный режим';
  const curPage = (state.pages || []).find(p => p.id === state.currentPageId);
  return { proj, stamp, modeName, curPage };
}

function metaTextLines(opts = {}) {
  const { proj, stamp, modeName, curPage } = projectMeta();
  const lines = [];
  if (proj.designation) lines.push('Обозначение:    ' + proj.designation);
  if (proj.name)        lines.push('Наименование:   ' + proj.name);
  if (proj.customer)    lines.push('Заказчик:       ' + proj.customer);
  if (proj.object)      lines.push('Объект:         ' + proj.object);
  if (proj.stage)       lines.push('Стадия:         ' + proj.stage);
  if (proj.author)      lines.push('ГИП / Исполн.:  ' + proj.author);
  // Фаза 1.19.9: ведомости оборудования и материалов не зависят от
  // режима работы — режим в их meta не печатается.
  if (!opts.hideMode) lines.push('Режим работы:   ' + modeName);
  lines.push('Дата:           ' + stamp);
  if (curPage) lines.push('Страница:       ' + (curPage.name || curPage.id));
  return lines;
}

function metaBlocks(opts = {}) {
  const { proj, stamp, modeName, curPage } = projectMeta();
  const rows = [];
  if (proj.designation) rows.push(['Обозначение',     String(proj.designation)]);
  if (proj.name)        rows.push(['Наименование',    String(proj.name)]);
  if (proj.customer)    rows.push(['Заказчик',        String(proj.customer)]);
  if (proj.object)      rows.push(['Объект',          String(proj.object)]);
  if (proj.stage)       rows.push(['Стадия',          String(proj.stage)]);
  if (proj.author)      rows.push(['ГИП / Исполнитель', String(proj.author)]);
  if (!opts.hideMode) rows.push(['Режим работы',      modeName]);
  rows.push(['Дата формирования', stamp]);
  if (curPage) rows.push(['Страница', String(curPage.name || curPage.id)]);
  if (!rows.length) return [];
  return [
    B.table(
      [ { text: 'Параметр', width: 60 }, { text: 'Значение' } ],
      rows,
    ),
    B.spacer(3),
  ];
}

// Форматирование текстовой таблицы: cols — массив {label, align}, rows — массив массивов строк.
function textTable(cols, rows) {
  const widths = cols.map((c, i) => {
    const headW = (c.label || '').length;
    const cellW = rows.reduce((m, r) => Math.max(m, String(r[i] ?? '').length), 0);
    return Math.max(headW, cellW) + 2;
  });
  const head = cols.map((c, i) => {
    const lbl = c.label || '';
    return (c.align === 'right') ? lbl.padStart(widths[i] - 1) + ' ' : lbl.padEnd(widths[i]);
  }).join('');
  const out = [head, '-'.repeat(head.length)];
  for (const r of rows) {
    out.push(cols.map((c, i) => {
      const v = String(r[i] ?? '');
      return (c.align === 'right') ? v.padStart(widths[i] - 1) + ' ' : v.padEnd(widths[i]);
    }).join(''));
  }
  return out;
}

// Преобразует cols из textTable-формата в B.table columns.
function blockCols(cols) {
  return cols.map(c => {
    const o = { text: c.label || '' };
    if (c.align) o.align = c.align;
    if (c.width) o.width = c.width;
    return o;
  });
}

// ======================================================================
// Сборщики данных. Каждый возвращает { rows, warnings, extras } —
// низкоуровневые данные, из которых потом лепим текст и блоки.
// ======================================================================

function collectSources() {
  const { inSpace } = pageFilters();
  return sortByTag([...state.nodes.values()]
    .filter(n => (n.type === 'source' || n.type === 'generator') && inSpace(n)));
}

function collectUpses() {
  const { inSpace } = pageFilters();
  return sortByTag([...state.nodes.values()].filter(n => n.type === 'ups' && inSpace(n)));
}

function collectPanels() {
  const { inSpace } = pageFilters();
  return sortByTag([...state.nodes.values()].filter(n => n.type === 'panel' && inSpace(n)));
}

function collectConsumers() {
  const { inSpace } = pageFilters();
  return sortByTag([...state.nodes.values()].filter(n => n.type === 'consumer' && inSpace(n)));
}

function collectChannels() {
  const { inSpace } = pageFilters();
  return sortByTag([...state.nodes.values()].filter(n => n.type === 'channel' && inSpace(n)));
}

function collectCables() {
  const { connInSpace } = pageFilters();
  // Фаза 1.19.9: ввод от городской сети — зона ответственности
  // энергоснабжающей организации, в спецификацию материалов не включается.
  const isUtilityInfeed = (c) => {
    const from = state.nodes.get(c.from?.nodeId);
    return from && from.type === 'source' && (from.sourceSubtype === 'utility' || from.sourceSubtype === 'grid');
  };
  const list = [...state.conns.values()].filter(c => (c._cableSize || c._busbarNom) && connInSpace(c) && !isUtilityInfeed(c));
  list.sort((a, b) => {
    const aFrom = effectiveTag(state.nodes.get(a.from.nodeId)) || '';
    const aTo   = effectiveTag(state.nodes.get(a.to.nodeId))   || '';
    const bFrom = effectiveTag(state.nodes.get(b.from.nodeId)) || '';
    const bTo   = effectiveTag(state.nodes.get(b.to.nodeId))   || '';
    const aPre = a._isHV ? 'WH' : (a._isDC ? 'WD' : 'W');
    const bPre = b._isHV ? 'WH' : (b._isDC ? 'WD' : 'W');
    const la = (a.lineLabel || `${aPre}-${aFrom}-${aTo}`).toLowerCase();
    const lb = (b.lineLabel || `${bPre}-${bFrom}-${bTo}`).toLowerCase();
    return la.localeCompare(lb, 'ru', { numeric: true, sensitivity: 'base' });
  });
  return list;
}

// ======================================================================
// Собственно секции-отчёты
// ======================================================================

// 1. ИСТОЧНИКИ ПИТАНИЯ
function sectionSources() {
  const items = collectSources();
  const cols = [
    { label: 'Обозн.',     width: 18 },
    { label: 'Имя',        width: 35 },
    { label: 'Тип',        width: 22 },
    { label: 'Напряжение', width: 25 },
    { label: 'Pном, кВт',  align: 'right', width: 18 },
    { label: 'Pнагр, кВт', align: 'right', width: 18 },
    { label: 'Iрасч, А',   align: 'right', width: 16 },
    { label: 'cos φ',      align: 'right', width: 14 },
    { label: 'Статус' },
  ];
  const rows = items.map(s => {
    const on = effectiveOn(s);
    const cap = Number(s.capacityKw) || 0;
    const load = s._loadKw || 0;
    const subtype = s.sourceSubtype || (s.type === 'generator' ? 'generator' : 'transformer');
    let type;
    if (subtype === 'utility') type = 'Гор. сеть';
    else if (subtype === 'other') type = 'Прочий';
    else if (s.type === 'generator') type = s.backupMode ? 'Генер. резерв' : 'Генератор';
    else type = 'Трансформатор';
    const status = !on ? 'ОТКЛ' : (s._overload ? 'ПЕРЕГРУЗ' : 'норма');
    let vStr;
    if (subtype === 'utility') vStr = cableVoltageClass(nodeVoltage(s));
    else if (subtype === 'transformer' && typeof s.inputVoltageLevelIdx === 'number') {
      const levels = GLOBAL.voltageLevels || [];
      const lvl = levels[s.inputVoltageLevelIdx];
      vStr = lvl ? `${lvl.vLL}/${nodeVoltage(s)} В` : `${nodeVoltage(s)} В`;
    } else vStr = `${nodeVoltage(s)} В`;
    return [
      fullTag(s), s.name || '', type, vStr,
      fmt(cap), fmt(load), fmt(s._loadA || 0),
      (s._cosPhi || 0).toFixed(2), status,
    ];
  });

  const text = [
    'ИСТОЧНИКИ ПИТАНИЯ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Источники питания'),
    ...metaBlocks(),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    blocks.push(B.h2('Перечень источников'));
    blocks.push(B.table(blockCols(cols), rows));
    blocks.push(B.paragraph(
      'Обозначения: Pном — номинальная мощность источника, Pнагр — текущая нагрузка, Iрасч — расчётный ток, cos φ — коэффициент мощности.'
    ));
  } else {
    text.push('В схеме нет источников питания.');
    blocks.push(B.paragraph('В схеме нет источников питания.'));
  }
  return { text: text.join('\n'), blocks };
}

// 2. ИБП
function sectionUps() {
  const items = collectUpses();
  const cols = [
    { label: 'Обозн.',       width: 18 },
    { label: 'Имя',          width: 35 },
    { label: 'Pном, кВт',    align: 'right', width: 18 },
    { label: 'Pтек., кВт',   align: 'right', width: 18 },
    { label: 'Pмакс., кВт',  align: 'right', width: 20 },
    { label: 'АКБ, кВт·ч',   align: 'right', width: 18 },
    { label: 'Автономия',    align: 'right', width: 18 },
    { label: 'Статус' },
  ];
  const rows = [];
  const details = []; // paragraphs / notes per ИБП
  for (const u of items) {
    const cap = Number(u.capacityKw) || 0;
    const load = u._loadKw || 0;
    const maxLoad = u._maxLoadKw || load;
    const eff = Number(u.efficiency) || 100;
    const batt = (Number(u.batteryKwh) || 0) * (Number(u.batteryChargePct) || 0) / 100;
    const autLoad = maxLoad > 0 ? maxLoad : load;
    const aut = autLoad > 0 ? batt / autLoad * 60 : 0;
    const autStr = autLoad > 0
      ? (aut >= 60 ? (aut / 60).toFixed(1) + ' ч' : Math.round(aut) + ' мин')
      : '—';
    let status = u._onBattery ? 'от АКБ'
               : u._powered ? 'норма'
               : 'без питания';
    rows.push([
      fullTag(u), u.name || '',
      fmt(cap), fmt(load), fmt(maxLoad),
      fmt(batt), autStr, status,
    ]);

    // Детальная карточка по ИБП
    const line1 = `${fullTag(u)} ${u.name || ''}  ·  КПД ${eff}%  ·  заряд ${u.batteryChargePct || 0}%`;
    details.push({ heading: `ИБП ${fullTag(u) || u.name}`, body: [line1] });
    if (u._maxOverload) {
      const uncapped = Number(u._maxDownstreamUncapped) || 0;
      details[details.length - 1].body.push(
        `⚠ Перегруз: downstream по макс-сценарию = ${fmt(uncapped)} кВт (${cap > 0 ? Math.round(uncapped / cap * 100) : 0}% от номинала). ИБП физически не выдаст больше ${fmt(cap)} кВт.`
      );
    }
    if (u.batteryCatalogId) {
      const blocksPer = Number(u.batteryBlocksPerString) || 0;
      const strings = Number(u.batteryStringCount) || 1;
      const cellV = Number(u.batteryCellVoltage) || 2;
      const cellsPerBlock = Number(u.batteryCellCount) && blocksPer
        ? Math.round(u.batteryCellCount / blocksPer) : 0;
      const blockVnom = cellsPerBlock * cellV;
      const vdcOper = blockVnom * blocksPer;
      const totalBlocks = strings * blocksPer;
      const capAh = Number(u.batteryCapacityAh) || 0;
      const endV = Number(u.batteryEndVperCell) || 1.75;
      details[details.length - 1].body.push(
        `Модель АКБ: ${capAh || '—'} А·ч · блок ${blockVnom || '—'} В · конфигурация ${strings} × ${blocksPer} = ${totalBlocks} блок · endV ${endV.toFixed(2)} В/эл.`
      );
      if (vdcOper) details[details.length - 1].body.push(`Рабочее напряжение DC-шины: ${vdcOper} В.`);
      if (Number.isFinite(Number(u.batteryTargetMin))) {
        details[details.length - 1].body.push(`Целевое время автономии: ${u.batteryTargetMin} мин.`);
      }
    }
  }

  const text = [
    'ИСТОЧНИКИ БЕСПЕРЕБОЙНОГО ПИТАНИЯ (ИБП)',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Источники бесперебойного питания'),
    ...metaBlocks(),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    blocks.push(B.h2('Сводная таблица ИБП'));
    blocks.push(B.table(blockCols(cols), rows));
    if (details.length) {
      blocks.push(B.h2('Карточки ИБП'));
      for (const d of details) {
        blocks.push(B.h3(d.heading));
        text.push(d.heading);
        for (const line of d.body) {
          blocks.push(B.paragraph(line));
          text.push('  ' + line);
        }
        text.push('');
      }
    }
  } else {
    text.push('В схеме нет ИБП.');
    blocks.push(B.paragraph('В схеме нет ИБП.'));
  }
  return { text: text.join('\n'), blocks };
}

// 3. ЩИТЫ
function sectionPanels() {
  const items = collectPanels();
  const cols = [
    { label: 'Обозн.',      width: 18 },
    { label: 'Имя',         width: 35 },
    { label: 'Iном, А',     align: 'right', width: 14 },
    { label: 'Вх/Вых',      align: 'center', width: 14 },
    { label: 'Pрасч, кВт',  align: 'right', width: 18 },
    { label: 'Iрасч, А',    align: 'right', width: 14 },
    { label: 'Ксим',        align: 'right', width: 12 },
    { label: 'cos φ',       align: 'right', width: 12 },
    { label: 'Режим' },
  ];
  const rows = items.map(p => {
    const mode = p.switchMode === 'manual' ? 'РУЧН'
               : p.switchMode === 'parallel' ? 'ЩИТ'
               : (p.inputs || 1) <= 1 ? 'ЩИТ'
               : 'АВР';
    return [
      fullTag(p), p.name || '',
      String(p.capacityA || 0),
      `${p.inputs}/${p.outputs}`,
      fmt(p._calcKw || p._loadKw || 0),
      fmt(p._loadA || 0),
      (p.kSim || 1).toFixed(2),
      p._cosPhi ? p._cosPhi.toFixed(2) : '—',
      mode,
    ];
  });

  const text = [
    'РАСПРЕДЕЛИТЕЛЬНЫЕ ЩИТЫ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Распределительные щиты'),
    ...metaBlocks(),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    blocks.push(B.h2('Состав щитов'));
    blocks.push(B.table(blockCols(cols), rows));
    blocks.push(B.paragraph(
      'Ксим — коэффициент одновременности (совпадения максимумов). ' +
      'Режим: ЩИТ — обычный ввод, АВР — автоматическое включение резерва, РУЧН — ручное переключение.'
    ));
  } else {
    text.push('В схеме нет распределительных щитов.');
    blocks.push(B.paragraph('В схеме нет распределительных щитов.'));
  }
  return { text: text.join('\n'), blocks };
}

// 4. ПОТРЕБИТЕЛИ
function sectionConsumers() {
  const items = collectConsumers();
  const cols = [
    { label: 'Обозн.',       width: 18 },
    { label: 'Имя',          width: 38 },
    { label: 'Фаза',         align: 'center', width: 12 },
    { label: 'Pед, кВт',     align: 'right', width: 14 },
    { label: 'Кол.',         align: 'right', width: 10 },
    { label: 'Pрасч, кВт',   align: 'right', width: 16 },
    { label: 'cos φ',        align: 'right', width: 12 },
    { label: 'Iуст, А',      align: 'right', width: 12 },
    { label: 'Iрасч, А',     align: 'right', width: 12 },
    { label: 'Iпуск, А',     align: 'right', width: 12 },
    { label: 'Статус' },
  ];
  let total = 0;
  const rows = items.map(c => {
    const per = Number(c.demandKw) || 0;
    const cnt = Math.max(1, Number(c.count) || 1);
    const factor = effectiveLoadFactor(c);
    const k = (Number(c.kUse) || 1) * factor;
    const sum = per * cnt * k;
    if (c._powered) total += sum;
    return [
      fullTag(c), c.name || '', c.phase || '3ph',
      fmt(per), String(cnt), fmt(sum),
      (Number(c.cosPhi) || 0.92).toFixed(2),
      fmt(c._nominalA || 0), fmt(c._ratedA || 0), fmt(c._inrushA || 0),
      c._powered ? 'ок' : 'БЕЗ ПИТ',
    ];
  });

  const text = [
    'ПОТРЕБИТЕЛИ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Перечень потребителей'),
    ...metaBlocks(),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    text.push('ИТОГО расчётная активная мощность: ' + fmt(total) + ' кВт');
    text.push('');
    blocks.push(B.h2('Потребители'));
    blocks.push(B.table(blockCols(cols), rows));
    blocks.push(B.paragraph('ИТОГО расчётная активная мощность подключённых потребителей: ' + fmt(total) + ' кВт.'));
  } else {
    text.push('В схеме нет потребителей.');
    blocks.push(B.paragraph('В схеме нет потребителей.'));
  }
  return { text: text.join('\n'), blocks };
}

// 5. КАБЕЛЬНЫЕ ЛИНИИ
function sectionCables() {
  const items = collectCables();
  const cols = [
    { label: 'Обозначение', width: 40 },
    { label: 'Марка',       width: 28 },
    { label: 'Проводник',   width: 36 },
    { label: 'Кол.',        align: 'right', width: 10 },
    { label: 'L, м',        align: 'right', width: 12 },
    { label: 'Итого, м',    align: 'right', width: 14 },
    { label: 'Imax, А',     align: 'right', width: 12 },
    { label: 'Iдоп, А',     align: 'right', width: 12 },
    { label: 'Метод',       align: 'center', width: 12 },
  ];
  let bomTotalLength = 0;
  const rows = items.map(c => {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    const fromTag = effectiveTag(fromN) || fromN?.name || '?';
    const toTag   = effectiveTag(toN)   || toN?.name   || '?';
    const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const lineLabel = c.lineLabel || `${linePrefix}-${fromTag}-${toTag}`;
    const length = c._cableLength != null ? c._cableLength : (c.lengthM || 0);
    // Марка кабеля (из cable-types-catalog, если выбрана)
    let markStr = '—';
    if (c.cableMark) {
      try {
        const rec = getCableType(c.cableMark);
        markStr = rec?.brand || c.cableMark;
      } catch { markStr = c.cableMark; }
    }
    let qty, conductorSpec, methodStr;
    if (c._busbarNom) {
      qty = 1;
      conductorSpec = `шинопр. ${c._busbarNom} А`;
      methodStr = '—';
      markStr = '—';
    } else {
      const parallel = Math.max(1, c._cableParallel || 1);
      const isGroup = Array.isArray(c._groupCables) && c._groupCables.length > 1;
      const groupCount = isGroup ? c._groupCables.length : 1;
      qty = parallel * groupCount;
      const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
      conductorSpec = `${cores}×${c._cableSize} мм²`;
      if (c._isHV) conductorSpec = cableVoltageClass(c._voltage || 0) + ' · ' + conductorSpec;
      if (c._isDC) conductorSpec = `= ${Math.round(Number(c._voltage) || 0)} В · ` + conductorSpec;
      methodStr = c._cableMethod || '—';
    }
    const totalM = Number(length) * qty;
    bomTotalLength += totalM;
    return [
      lineLabel, markStr, conductorSpec, String(qty),
      fmt(length), fmt(totalM),
      fmt(c._maxA || 0), fmt(c._cableIz || 0),
      methodStr + (c._cableOverflow ? ' ⚠' : ''),
    ];
  });

  const text = [
    'КАБЕЛЬНЫЕ ЛИНИИ И ШИНОПРОВОДЫ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Кабельные линии и шинопроводы'),
    ...metaBlocks(),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    text.push('ИТОГО кабеля / шинопровода: ' + fmt(bomTotalLength) + ' м');
    text.push('');
    blocks.push(B.h2('Ведомость кабельной продукции'));
    blocks.push(B.table(blockCols(cols), rows));
    blocks.push(B.paragraph('ИТОГО кабеля / шинопровода: ' + fmt(bomTotalLength) + ' м.'));
  } else {
    text.push('В схеме нет активных кабельных линий.');
    blocks.push(B.paragraph('В схеме нет активных кабельных линий.'));
  }
  return { text: text.join('\n'), blocks };
}

// 5b. СВОДНАЯ ВЕДОМОСТЬ КАБЕЛЯ ПО МАРКЕ И СЕЧЕНИЮ (SKU)
// Агрегация всех кабельных линий проекта по ключу «марка + число жил + сечение».
// Даёт снабженческую сводку: сколько метров какого именно SKU нужно закупить.
function sectionCableBom() {
  const items = collectCables().filter(c => !c._busbarNom);  // шинопроводы отдельно
  // Группа: brand + cores × sizeMm2 + material + insulation
  const groups = new Map();
  for (const c of items) {
    const length = Number(c._cableLength != null ? c._cableLength : (c.lengthM || 0));
    if (length <= 0) continue;
    const parallel = Math.max(1, c._cableParallel || 1);
    const isGroup = Array.isArray(c._groupCables) && c._groupCables.length > 1;
    const groupCount = isGroup ? c._groupCables.length : 1;
    const qty = parallel * groupCount;
    const cores = c._wireCount || (c._isHV ? 3 : (c._threePhase ? 5 : 3));
    const size = c._cableSize || 0;
    if (!size) continue;
    // Марка: cable-type brand, иначе «типовой кабель» (материал/изоляция)
    let markLabel = '—';
    if (c.cableMark) {
      try {
        const rec = getCableType(c.cableMark);
        markLabel = rec?.brand || c.cableMark;
      } catch {}
    }
    if (markLabel === '—' || markLabel === c.cableMark) {
      // Fallback-марка по material/insulation
      const mat = c.material === 'Al' ? 'Al' : 'Cu';
      const ins = c.insulation === 'XLPE' ? 'XLPE' : 'PVC';
      markLabel = markLabel === '—' ? `${mat}/${ins} (без марки)` : markLabel;
    }
    const key = `${markLabel} ${cores}×${size} мм²`;
    const prev = groups.get(key) || {
      mark: markLabel, cores, size, totalM: 0, lines: 0,
      material: c.material || 'Cu',
      insulation: c.insulation || 'PVC',
    };
    prev.totalM += length * qty;
    prev.lines += 1;
    groups.set(key, prev);
  }
  // Сортируем: по марке, затем по сечению возрастанию
  const rows = [...groups.values()].sort((a, b) => {
    if (a.mark !== b.mark) return a.mark.localeCompare(b.mark);
    if (a.cores !== b.cores) return a.cores - b.cores;
    return a.size - b.size;
  });

  // Резолв цен: для каждой группы ищем cable-sku с подходящим cableTypeId + cores + sizeMm2
  // Сначала собираем все cable-sku из element-library (включая builtin через bridge)
  let allSku = [];
  try { allSku = listElements({ kind: 'cable-sku' }); } catch {}
  let allMarksDict = {};
  try {
    for (const c of items) if (c.cableMark) {
      const rec = getCableType(c.cableMark);
      if (rec) allMarksDict[rec.brand || c.cableMark] = c.cableMark;
    }
  } catch {}
  // Ключ SKU: cableTypeId+cores+size; ищем для каждой группы цену
  const pricedRows = rows.map(r => {
    const typeId = allMarksDict[r.mark] || r.mark;  // преобразуем brand → typeId если можем
    const skuMatch = allSku.find(s => {
      const kp = s.kindProps || {};
      return String(kp.cableTypeId) === String(typeId) && Number(kp.cores) === r.cores && Number(kp.sizeMm2) === r.size;
    });
    let unitPrice = null, currency = null, totalPrice = null, skuId = null;
    if (skuMatch) {
      skuId = skuMatch.id;
      try {
        const info = pricesForElement(skuMatch.id, { activeOnly: true });
        if (info.latest) {
          unitPrice = Number(info.latest.price) || null;
          currency = info.latest.currency;
          if (unitPrice != null) totalPrice = unitPrice * r.totalM * 1.1;  // с запасом 10%
        }
      } catch {}
    }
    return { ...r, unitPrice, currency, totalPrice, skuId };
  });

  const text = [
    'СВОДНАЯ ВЕДОМОСТЬ КАБЕЛЬНОЙ ПРОДУКЦИИ (по SKU)',
    '='.repeat(78),
    ...metaTextLines({ hideMode: true }),
    '',
  ];
  const blocks = [
    B.h1('Сводная ведомость кабеля по маркам и сечениям'),
    ...metaBlocks({ hideMode: true }),
  ];
  if (!pricedRows.length) {
    text.push('Нет активных кабельных линий.');
    blocks.push(B.paragraph('В проекте нет активных кабельных линий с длиной > 0.'));
    return { text: text.join('\n'), blocks };
  }

  const hasPrices = pricedRows.some(r => r.unitPrice != null);
  const header = hasPrices
    ? ['Марка', 'Жилы×сечение', 'Cu/Al · PVC/XLPE', 'Линий', 'Длина, м', 'С запасом, м', 'Цена за м', 'Итого']
    : ['Марка кабеля', 'Число жил × сечение', 'Материал / изоляция', 'Линий', 'Общая длина, м', 'С запасом 10%, м'];
  const fmtMoney = (v, cur) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
  const tableRows = pricedRows.map(r => {
    if (hasPrices) {
      return [
        r.mark, `${r.cores}×${r.size} мм²`, `${r.material}/${r.insulation}`,
        String(r.lines), fmt(r.totalM), fmt(r.totalM * 1.1),
        fmtMoney(r.unitPrice, r.currency),
        fmtMoney(r.totalPrice, r.currency),
      ];
    }
    return [
      r.mark, `${r.cores}×${r.size} мм²`, `${r.material}/${r.insulation}`,
      String(r.lines), fmt(r.totalM), fmt(r.totalM * 1.1),
    ];
  });

  const grandTotal = pricedRows.reduce((s, r) => s + r.totalM, 0);
  // Итоги по валютам (если есть цены)
  const totalsByCurrency = new Map();
  let missingPriceCount = 0;
  for (const r of pricedRows) {
    if (r.totalPrice == null || !r.currency) { missingPriceCount++; continue; }
    totalsByCurrency.set(r.currency, (totalsByCurrency.get(r.currency) || 0) + r.totalPrice);
  }

  if (hasPrices) {
    tableRows.push(['', 'ИТОГО', '', String(pricedRows.length), fmt(grandTotal), fmt(grandTotal * 1.1), '', '']);
    for (const [cur, sum] of totalsByCurrency) {
      tableRows.push(['', '', '', '', '', '', `ИТОГО ${cur}:`, fmtMoney(sum, cur)]);
    }
  } else {
    tableRows.push(['', 'ИТОГО', '', String(pricedRows.length), fmt(grandTotal), fmt(grandTotal * 1.1)]);
  }

  // Заголовок колонок + разделитель
  text.push(header.map(c => String(c).padEnd(18)).join(' '));
  text.push('─'.repeat(header.length * 19));
  for (const r of tableRows) text.push(r.map(c => String(c).padEnd(18)).join(' '));
  text.push('');
  if (hasPrices && missingPriceCount > 0) {
    text.push(`⚠ Без цены: ${missingPriceCount} из ${pricedRows.length} SKU. Привяжите цены в модуле «Каталог и цены».`);
  }

  blocks.push(B.h2('Сводка к закупке'));
  blocks.push(B.table(header, tableRows));
  if (hasPrices && missingPriceCount > 0) {
    blocks.push(B.paragraph(`Внимание: у ${missingPriceCount} из ${pricedRows.length} позиций нет цены в справочнике cable-sku. Итог рассчитан только по позициям с ценой. Добавьте недостающие цены в модуле «Каталог и библиотека».`));
  } else if (!hasPrices) {
    blocks.push(B.paragraph('Цены не привязаны. Создайте cable-sku записи для марок кабеля и добавьте цены в модуле «Каталог и библиотека» (вкладка Элементы → строка cable-type → «+ SKU»).'));
  }
  blocks.push(B.paragraph('Запас 10% рекомендуется заложить на обрезки, концевые заделки, соединения в муфтах и укладку с провисом. Для MV-кабелей (ВН) и кабелей в лотке/трубе рекомендуется увеличенный запас 15-20%.'));
  blocks.push(B.paragraph(`Всего в проекте: ${pricedRows.length} SKU, суммарная длина: ${fmt(grandTotal)} м (с запасом: ${fmt(grandTotal * 1.1)} м).`));
  return { text: text.join('\n'), blocks };
}

// 6. РАСЧЁТНЫЕ МОДУЛИ ПО ЛИНИЯМ
function sectionModules() {
  const items = collectCables().filter(c => Array.isArray(c._moduleResults) && c._moduleResults.length);
  const text = [
    'РАСЧЁТНЫЕ МОДУЛИ ПО ЛИНИЯМ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
    'Модули: подбор по току (IEC 60364-5-52), падение напряжения,',
    'термическая стойкость к КЗ (IEC 60364-4-43), петля фаза-ноль (IEC 60364-4-41).',
    'Опциональные: экономическая плотность тока (ПУЭ 1.3.25) — по выбору.',
    '',
  ];
  const blocks = [
    B.h1('Расчётные модули по линиям'),
    ...metaBlocks(),
    B.paragraph(
      'Для каждой линии выполнен независимый набор проверок: ' +
      'подбор по току (IEC 60364-5-52), допустимое падение напряжения, ' +
      'термическая стойкость к току КЗ (IEC 60364-4-43), петля фаза-ноль (IEC 60364-4-41), ' +
      'экономическая плотность тока.'
    ),
  ];

  if (!items.length) {
    text.push('Нет линий с активными расчётными модулями.');
    blocks.push(B.paragraph('Нет линий с активными расчётными модулями.'));
    return { text: text.join('\n'), blocks };
  }

  for (const c of items) {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN   = state.nodes.get(c.to.nodeId);
    const fromTag = effectiveTag(fromN) || fromN?.name || '?';
    const toTag   = effectiveTag(toN)   || toN?.name   || '?';
    const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
    const lineLabel = c.lineLabel || `${linePrefix}-${fromTag}-${toTag}`;
    text.push(`  ${lineLabel}`);
    blocks.push(B.h3(lineLabel));

    const mCols = [
      { label: 'Модуль',    width: 60 },
      { label: 'Статус',    align: 'center', width: 25 },
      { label: 'Параметры' },
    ];
    const mRows = [];
    for (const m of c._moduleResults) {
      const r = m.result || {};
      const d = r.details || {};
      let status;
      if (d.skipped) status = 'пропущен';
      else if (r.pass) status = 'OK';
      else status = 'ПРОБЛЕМА';
      let detail = '';
      if (m.id === 'ampacity' && !d.skipped) {
        detail = `S=${d.s} мм² · Iz=${d.iDerated?.toFixed(0)} А · Kt·Kg=${d.kTotal?.toFixed(2)}`;
      } else if (m.id === 'vdrop' && !d.skipped) {
        detail = `ΔU=${d.dUpct?.toFixed(2)}% ≤ ${d.maxPct}%`;
        if (d.bumpedTo) detail += ` → ${d.bumpedTo} мм²`;
      } else if (m.id === 'economic' && !d.skipped) {
        detail = `jэк=${d.jEk} · Sрасч=${d.sCalc} мм² · Sст=${d.sStandard} мм²`;
      } else if (m.id === 'shortCircuit' && !d.skipped) {
        detail = `Ik=${d.IkA} А · tk=${d.tkS} с → Smin=${d.sRequired} мм²`;
      } else if (m.id === 'phaseLoop' && !d.skipped) {
        detail = `${d.earthing} · Zloop=${d.Zloop} Ом · Ik1=${d.Ik1} А ≥ Ia=${d.Ia} А`;
      } else if (d.skipped) {
        detail = d.reason || 'нет данных';
      }
      mRows.push([ m.label, status, detail ]);
      text.push(`    ${m.label.padEnd(36)} ${status.padEnd(10)} ${detail}`);
      for (const w of (r.warnings || [])) text.push(`       ⚠ ${w}`);
    }
    blocks.push(B.table(blockCols(mCols), mRows));
    // Предупреждения по линии — отдельным списком
    const warns = [];
    for (const m of c._moduleResults) for (const w of (m.result?.warnings || [])) warns.push(`${m.label}: ${w}`);
    if (warns.length) blocks.push(B.list(warns.map(w => '⚠ ' + w)));
    blocks.push(B.spacer(2));
    text.push('');
  }
  return { text: text.join('\n'), blocks };
}

// 7. 3-ФАЗНЫЙ БАЛАНС
function sectionBalance() {
  const balance = get3PhaseBalance();
  const cols = [
    { label: 'Щит',        width: 60 },
    { label: 'A, кВт',     align: 'right', width: 18 },
    { label: 'B, кВт',     align: 'right', width: 18 },
    { label: 'C, кВт',     align: 'right', width: 18 },
    { label: 'Дисбаланс',  align: 'right', width: 20 },
    { label: 'Проверка' },
  ];
  const rows = balance.map(b => [
    ((b.tag || '') + ' ' + (b.name || '')).trim(),
    fmt(b.a), fmt(b.b), fmt(b.c),
    b.imbalance.toFixed(1) + ' %',
    b.warning ? '⚠ превышение' : 'норма',
  ]);

  const text = [
    'ТРЁХФАЗНЫЙ БАЛАНС ПО ЩИТАМ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Трёхфазный баланс по щитам'),
    ...metaBlocks(),
    B.paragraph('Норма дисбаланса по ПУЭ — не более 15 %.'),
  ];
  if (rows.length) {
    text.push(...textTable(cols, rows));
    text.push('');
    text.push('Норма: дисбаланс не более 15%.');
    blocks.push(B.h2('Распределение нагрузки по фазам'));
    blocks.push(B.table(blockCols(cols), rows));
  } else {
    text.push('Трёхфазные нагрузки на щитах отсутствуют.');
    blocks.push(B.paragraph('Трёхфазные нагрузки на щитах отсутствуют — баланс не рассчитан.'));
  }
  return { text: text.join('\n'), blocks };
}

// 8. КАБЕЛЬНЫЕ КАНАЛЫ
function sectionChannels() {
  const channels = collectChannels();
  const text = [
    'КАБЕЛЬНЫЕ КАНАЛЫ И ТРАССЫ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Кабельные каналы и трассы'),
    ...metaBlocks(),
  ];
  if (!channels.length) {
    text.push('В схеме нет кабельных каналов.');
    blocks.push(B.paragraph('В схеме нет кабельных каналов.'));
    return { text: text.join('\n'), blocks };
  }
  const chCols = [
    { label: 'Обозн.',      width: 22 },
    { label: 'Наименование', width: 55 },
    { label: 'Тип',          width: 35 },
    { label: 'L, м',         align: 'right', width: 14 },
    { label: 'Метод',        align: 'center' },
  ];
  const chRows = channels.map(ch => {
    const typeInfo = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
    return [
      effectiveTag(ch) || ch.tag || '',
      ch.name || '',
      typeInfo.label,
      String(ch.lengthM || 0),
      typeInfo.method,
    ];
  });
  text.push(...textTable(chCols, chRows));
  text.push('');
  blocks.push(B.h2('Каналы'));
  blocks.push(B.table(blockCols(chCols), chRows));

  // Подробно по каждому каналу — какие линии в нём проходят
  blocks.push(B.h2('Состав каналов'));
  for (const ch of channels) {
    const tag = effectiveTag(ch) || ch.tag || '';
    const typeInfo = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
    const title = `${tag}  ${ch.name || ''}  (${typeInfo.label}, ${ch.lengthM || 0} м, метод ${typeInfo.method})`;
    blocks.push(B.h3(title));
    text.push(title);
    const chConns = [];
    for (const c of state.conns.values()) {
      if (Array.isArray(c.channelIds) && c.channelIds.includes(ch.id)) chConns.push(c);
    }
    if (!chConns.length) {
      blocks.push(B.paragraph('(нет линий)'));
      text.push('    (нет линий)');
      text.push('');
      continue;
    }
    const lineCols = [
      { label: 'Линия',   width: 45 },
      { label: 'Кабель',  width: 35 },
      { label: 'Длина',   align: 'right', width: 16 },
      { label: 'Imax, А', align: 'right', width: 14 },
    ];
    const lineRows = chConns.map(c => {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromTag = fromN ? (effectiveTag(fromN) || fromN.name || '?') : '?';
      const toTag = toN ? (effectiveTag(toN) || toN.name || '?') : '?';
      const cable = c._cableSize ? `${c._wireCount || '?'}×${c._cableSize} мм²` : '—';
      const current = c._maxA ? `${fmt(c._maxA)}` : '—';
      const length = c._cableLength != null ? `${c._cableLength} м` : '—';
      return [`W-${fromTag}-${toTag}`, cable, length, current];
    });
    blocks.push(B.table(blockCols(lineCols), lineRows));
    text.push(...textTable(lineCols, lineRows));
    text.push('');
  }
  return { text: text.join('\n'), blocks };
}

// 9. ПРОВЕРКИ И ПРЕДУПРЕЖДЕНИЯ
function sectionChecks() {
  const { inSpace } = pageFilters();
  const issues = [];
  for (const n of state.nodes.values()) {
    if (!inSpace(n)) continue;
    if (n.type === 'consumer') {
      const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
      if (!hasIn) issues.push({ level: 'warn', text: `Потребитель ${fullTag(n) || n.name} не подключён` });
      if (!n._powered) issues.push({ level: 'warn', text: `Потребитель ${fullTag(n) || n.name} без питания` });
    }
    if (n.type === 'panel') {
      const hasOut = [...state.conns.values()].some(c => c.from.nodeId === n.id);
      if (!hasOut) issues.push({ level: 'warn', text: `Щит ${fullTag(n) || n.name} не имеет отходящих линий` });
    }
    if (n.type === 'ups' && (Number(n.batteryKwh) || 0) <= 0) {
      issues.push({ level: 'warn', text: `ИБП ${fullTag(n) || n.name}: нулевая ёмкость батареи` });
    }
    if (n.type === 'generator' && !n.backupMode) {
      issues.push({ level: 'info', text: `Генератор ${fullTag(n) || n.name} работает как основной источник (не резерв)` });
    }
    if (n._overload) {
      issues.push({ level: 'warn', text: `${fullTag(n) || n.name}: перегруз (${fmt(n._loadKw)}/${fmt(n.capacityKw)} кВт)` });
    }
  }

  const text = [
    'ПРОВЕРКИ И ПРЕДУПРЕЖДЕНИЯ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Проверки и предупреждения'),
    ...metaBlocks(),
  ];
  if (!issues.length) {
    text.push('Замечаний нет.');
    blocks.push(B.paragraph('Замечаний по схеме нет — все потребители подключены и получают питание, щиты имеют отходящие линии, источники не перегружены.'));
    return { text: text.join('\n'), blocks };
  }
  const warns = issues.filter(i => i.level === 'warn');
  const infos = issues.filter(i => i.level === 'info');
  if (warns.length) {
    text.push('ПРЕДУПРЕЖДЕНИЯ:');
    for (const i of warns) text.push('  ⚠ ' + i.text);
    text.push('');
    blocks.push(B.h2('Предупреждения'));
    blocks.push(B.list(warns.map(i => '⚠ ' + i.text)));
  }
  if (infos.length) {
    text.push('СПРАВОЧНО:');
    for (const i of infos) text.push('  ℹ ' + i.text);
    text.push('');
    blocks.push(B.h2('Справочно'));
    blocks.push(B.list(infos.map(i => 'ℹ ' + i.text)));
  }
  return { text: text.join('\n'), blocks };
}

// 9b. СПЕЦИФИКАЦИЯ (BOM) — Фаза 1.3 + 1.5.7 (цены)
// Собирает состав оборудования через element-library composition + резолвит
// цены из price-records (стратегия 'latest' по умолчанию).
// Для узлов с node.elementId — разворачивает composition рекурсивно
// (phantom-элементы тоже попадают). Узлы без elementId — одной строкой
// по типу (ИБП, щит, трансформатор...).
function sectionBom() {
  // Опции резолвинга цен — по умолчанию «последняя актуальная цена».
  // В будущем передадим через UI опций отчёта (Фаза 1.5.7+).
  const priceOpts = { priceStrategy: 'latest', activeOnly: true };
  const { aggregated, totals } = collectBomFromProject(state, priceOpts);
  const groups = groupBomByKind(aggregated);
  const KIND_LABELS = {
    panel: 'НКУ (LV щиты)',
    ups: 'ИБП',
    battery: 'Аккумуляторные батареи',
    transformer: 'Трансформаторы',
    breaker: 'Автоматические выключатели',
    'mv-switchgear': 'РУ СН (MV)',
    'mv-cell': 'Ячейки СН',
    enclosure: 'Корпуса щитов',
    climate: 'Климатическое оборудование',
    'consumer-type': 'Потребители',
    'cable-type': 'Типы кабелей',
    'cable-sku': 'Кабели (типоразмеры)',
    channel: 'Кабельные трассы',
    custom: 'Прочее',
    other: 'Прочее',
    source: 'Источники питания',
    generator: 'Генераторы',
    consumer: 'Потребители',
  };
  const text = [
    'СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ (BOM)',
    '='.repeat(78),
    ...metaTextLines({ hideMode: true }),
    '',
  ];
  const blocks = [
    B.h1('Спецификация оборудования'),
    ...metaBlocks({ hideMode: true }),
  ];
  if (!aggregated.length) {
    text.push('Спецификация пуста (нет оборудования в проекте).');
    blocks.push(B.paragraph('Спецификация пуста — в проекте нет оборудования.'));
    return { text: text.join('\n'), blocks };
  }
  // Проверка: есть ли цены у каких-либо строк
  const withPrice = aggregated.filter(r => r.unitPrice != null).length;
  const showPriceCols = withPrice > 0;

  // Формат цены
  const fmtPrice = (p, cur) => (p == null) ? '—'
    : Number(p).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');

  // Сводная таблица: kind, label, qty [+ цена/итого если есть]
  const header = showPriceCols
    ? ['Группа', 'Наименование', 'Кол-во', 'Цена за ед.', 'Итого']
    : ['Группа', 'Наименование', 'Кол-во'];
  const rows = [];
  for (const [kind, items] of Object.entries(groups)) {
    // Заголовок группы
    if (showPriceCols) rows.push([KIND_LABELS[kind] || kind, '', '', '', '']);
    else rows.push([KIND_LABELS[kind] || kind, '', '']);
    for (const it of items) {
      const label = (it.phantom ? '* ' : '') + (it.label || it.elementId || '—') + (it.role ? ` (${it.role})` : '');
      if (showPriceCols) {
        rows.push([
          '  ', label, String(it.qty),
          fmtPrice(it.unitPrice, it.currency),
          fmtPrice(it.totalPrice, it.currency),
        ]);
      } else {
        rows.push(['  ', label, String(it.qty)]);
      }
    }
  }
  // Итоги по валютам
  if (showPriceCols && totals && totals.totals.size) {
    for (const [cur, sum] of totals.totals) {
      rows.push(['', 'ИТОГО ' + cur, '', '', fmtPrice(sum, cur)]);
    }
  }
  // Текстовое представление с заголовком и разделителем
  text.push(header.map(c => String(c).padEnd(24)).join(' '));
  text.push('─'.repeat(header.length * 25));
  for (const r of rows) text.push(r.map(c => String(c).padEnd(24)).join(' '));
  text.push('');
  text.push('* — phantom-элемент (скрыт в UI, учтён в BOM)');
  if (showPriceCols && totals && totals.missingCount > 0) {
    text.push(`⚠ Без цены: ${totals.missingCount} из ${totals.totalRows} позиций. Добавьте цены в разделе «Каталог и цены».`);
  }
  // PDF/DOCX блоки
  blocks.push(B.h2('Сводная ведомость'));
  blocks.push(B.table(header, rows));
  blocks.push(B.paragraph('* — phantom-элемент (скрыт в UI-схеме, учтён в спецификации как компонент составного оборудования).'));
  if (showPriceCols && totals) {
    if (totals.missingCount > 0) {
      blocks.push(B.paragraph(`Внимание: у ${totals.missingCount} из ${totals.totalRows} позиций нет цены в справочнике. Итог рассчитан только по позициям с ценой. Добавьте недостающие цены в модуле «Каталог и цены».`));
    }
    if (totals.totals.size) {
      const totalLines = [...totals.totals].map(([cur, sum]) => `${fmtPrice(sum, cur)}`);
      blocks.push(B.paragraph('Итого: ' + totalLines.join(' + ')));
    }
  } else {
    blocks.push(B.paragraph('Цены не добавлены. Для расчёта стоимости заполните прайс-лист в модуле «Каталог и цены».'));
  }
  return { text: text.join('\n'), blocks };
}

// 9c. СЕЛЕКТИВНОСТЬ ЗАЩИТЫ (Фаза 1.8)
// Обход пар upstream-downstream по каждой панели, проверка правил
// селективности (амплитудная + временная при заданном I_k).
function sectionSelectivity() {
  const { pairs, summary } = analyzeSelectivity();
  const text = [
    'СЕЛЕКТИВНОСТЬ ЗАЩИТЫ',
    '='.repeat(78),
    ...metaTextLines(),
    '',
  ];
  const blocks = [
    B.h1('Селективность защитных аппаратов'),
    ...metaBlocks(),
  ];
  if (!pairs.length) {
    text.push('Анализ не выполнен: не найдены пары upstream-downstream автоматов (нужны панели со входами и выходами + настроенные breakerIn/curve).');
    blocks.push(B.paragraph('Анализ не выполнен: в проекте не обнаружены пары upstream-downstream автоматов. Для анализа необходимо: (1) наличие панелей со входными и выходными линиями, (2) настроенные номиналы и характеристики автоматов защиты.'));
    return { text: text.join('\n'), blocks };
  }
  // Сводка
  text.push(`Проверено пар: ${summary.total}`);
  text.push(`Селективных: ${summary.selective}`);
  text.push(`Нарушений: ${summary.nonSelective}`);
  text.push('');
  blocks.push(B.h2('Сводка'));
  blocks.push(B.table(['Показатель', 'Значение'], [
    ['Всего пар', String(summary.total)],
    ['Селективных', String(summary.selective)],
    ['Нарушений', String(summary.nonSelective)],
  ]));

  // Таблица всех пар
  const rows = pairs.map(p => {
    const nodeTag = effectiveTag(p.node) || p.node.name || '?';
    const upTxt = `${p.upBreaker.inNominal}А ${p.upBreaker.curve}`;
    const downTxt = `${p.downBreaker.inNominal}А ${p.downBreaker.curve}`;
    const ik = p.Ik ? p.Ik.toFixed(0) + 'А' : '—';
    const verdict = p.check.selective ? '✓' : '✗';
    const reason = p.check.selective ? 'OK' : p.check.reason;
    return [nodeTag, upTxt, downTxt, ik, verdict, reason];
  });
  text.push('Узел | Upstream | Downstream | I_k | Статус | Комментарий');
  text.push('-'.repeat(80));
  for (const r of rows) text.push(r.join(' | '));

  blocks.push(B.h2('Детализация по парам'));
  blocks.push(B.table(['Узел', 'Upstream', 'Downstream', 'I_k', 'Статус', 'Комментарий'], rows));

  // Если есть нарушения — предупреждение
  if (summary.nonSelective > 0) {
    const warns = pairs.filter(p => !p.check.selective);
    blocks.push(B.h2('Обнаруженные нарушения'));
    blocks.push(B.list(warns.map(p =>
      `${effectiveTag(p.node) || p.node.name}: ${p.upBreaker.inNominal}А ${p.upBreaker.curve} vs ${p.downBreaker.inNominal}А ${p.downBreaker.curve} — ${p.check.reason}`
    )));
    blocks.push(B.paragraph('Рекомендации: (1) увеличить номинал вышестоящего автомата; (2) использовать MCCB/ACB с регулируемой задержкой расцепителя (tsd); (3) проверить по таблицам селективности производителя для конкретных моделей.'));
  }

  return { text: text.join('\n'), blocks };
}

// 10. ПОЛНЫЙ ОТЧЁТ
function sectionFull() {
  // Полный отчёт: объединяет все предыдущие секции. Текст собираем через
  // существующий generateReport() — он исторически стабилен. Блоки —
  // комбинируем из отдельных секций, чтобы PDF содержал все разделы.
  const subs = [
    { h2: 'Источники питания',               sec: sectionSources() },
    { h2: 'Источники бесперебойного питания', sec: sectionUps() },
    { h2: 'Распределительные щиты',          sec: sectionPanels() },
    { h2: 'Потребители',                     sec: sectionConsumers() },
    { h2: 'Кабельные линии и шинопроводы',   sec: sectionCables() },
    { h2: 'Расчётные модули по линиям',      sec: sectionModules() },
    { h2: 'Трёхфазный баланс по щитам',      sec: sectionBalance() },
    { h2: 'Кабельные каналы и трассы',       sec: sectionChannels() },
    { h2: 'Проверки и предупреждения',       sec: sectionChecks() },
  ];
  const blocks = [
    B.h1('Сводный отчёт по схеме электроснабжения'),
    ...metaBlocks(),
  ];
  for (const s of subs) {
    // Вырезаем h1 и блок метаданных из каждой подсекции, оставляем
    // только содержательную часть.
    const sub = s.sec.blocks;
    const content = sub.filter(b => b.type !== 'heading' || b.level !== 1);
    // Повторяющийся metaBlock тоже не нужен — уберём первую таблицу,
    // если она идёт сразу после removed h1 (это metaBlocks).
    if (content[0] && content[0].type === 'table' && !blocks._metaStripped) {
      content.shift();
      if (content[0] && content[0].type === 'spacer') content.shift();
    }
    blocks.push(B.pageBreak());
    blocks.push(B.h1(s.h2));
    blocks.push(...content);
  }
  return { text: generateReport(), blocks };
}

// ======================================================================
// Публичный API — каталог отчётов
// ======================================================================

/**
 * Возвращает массив описаний отчётов. Каждый отчёт — самостоятельный
 * экспортируемый документ с текстовым превью и блоками для PDF / DOCX.
 *
 *   { id, title, description, defaultTemplateId, tags, text, blocks }
 *
 * templateId ссылается на встроенные шаблоны из reports/templates-seed.js;
 * tags используются для pickTemplate() как фильтр.
 */
export function getReportSections() {
  recalc();
  return [
    {
      id: 'full',
      title: 'Полный отчёт по схеме',
      description: 'Все разделы в одном документе: источники, ИБП, щиты, потребители, кабельные линии, расчётные модули, баланс фаз, каналы и проверки.',
      defaultTemplateId: 'builtin-engineering-a4',
      tags: ['инженерный', 'расчёты', 'общее'],
      ...sectionFull(),
    },
    {
      id: 'sources',
      title: 'Источники питания',
      description: 'Перечень источников схемы: трансформаторы, городская сеть, генераторы. Номинал, нагрузка, ток, cos φ и статус каждого.',
      defaultTemplateId: 'builtin-transformer-report',
      tags: ['трансформатор', 'расчёты'],
      ...sectionSources(),
    },
    {
      id: 'ups',
      title: 'Источники бесперебойного питания',
      description: 'Список ИБП с параметрами КПД, текущей и максимальной нагрузкой, ёмкостью АКБ и автономией. Для каталожных АКБ — детальная карточка.',
      defaultTemplateId: 'builtin-ups-report',
      tags: ['ибп', 'ups', 'конфигурация'],
      ...sectionUps(),
    },
    {
      id: 'panels',
      title: 'Распределительные щиты',
      description: 'Состав щитов с номиналом вводного, числом вводов/отходящих, расчётной нагрузкой, коэффициентом одновременности и режимом (ЩИТ/АВР).',
      defaultTemplateId: 'builtin-panel-report',
      tags: ['щит', 'panel', 'конфигурация'],
      ...sectionPanels(),
    },
    {
      id: 'consumers',
      title: 'Перечень потребителей',
      description: 'Таблица потребителей с фазностью, единичной и расчётной мощностью, расчётным и пусковым током, статусом питания.',
      defaultTemplateId: 'builtin-engineering-a4',
      tags: ['инженерный', 'расчёты'],
      ...sectionConsumers(),
    },
    {
      id: 'cables',
      title: 'Ведомость кабельной продукции',
      description: 'Кабельный журнал: обозначение линии, марка кабеля, тип проводника, количество, длина, максимальный и допустимый ток, способ прокладки.',
      defaultTemplateId: 'builtin-bom-landscape',
      tags: ['ведомость', 'таблица', 'спецификация', 'кабель'],
      ...sectionCables(),
    },
    {
      id: 'cable-bom',
      title: 'Сводная ведомость кабеля по SKU',
      description: 'Агрегация по маркам и сечениям: сколько метров каждого SKU (марка + число жил × сечение) нужно закупить. С запасом 10%.',
      defaultTemplateId: 'builtin-bom-landscape',
      tags: ['ведомость', 'таблица', 'спецификация', 'кабель', 'закупка', 'sku'],
      ...sectionCableBom(),
    },
    {
      id: 'modules',
      title: 'Расчётные модули по линиям',
      description: 'Результаты всех обязательных и опциональных расчётных модулей по каждой активной линии: подбор по току, ΔU, термическая стойкость, петля фаза-ноль, экономическая плотность тока.',
      defaultTemplateId: 'builtin-engineering-a4',
      tags: ['инженерный', 'расчёты', 'кабель'],
      ...sectionModules(),
    },
    {
      id: 'balance',
      title: 'Трёхфазный баланс по щитам',
      description: 'Распределение активной нагрузки по фазам A / B / C на каждом щите и величина фазового дисбаланса относительно нормы 15 %.',
      defaultTemplateId: 'builtin-engineering-a4',
      tags: ['инженерный', 'расчёты'],
      ...sectionBalance(),
    },
    {
      id: 'channels',
      title: 'Кабельные каналы и трассы',
      description: 'Перечень кабельных каналов/трасс с типом, длиной и методом прокладки. По каждому каналу — список проходящих линий.',
      defaultTemplateId: 'builtin-bom-landscape',
      tags: ['ведомость', 'таблица', 'кабель'],
      ...sectionChannels(),
    },
    {
      id: 'bom',
      title: 'Спецификация оборудования (BOM)',
      description: 'Состав оборудования проекта с агрегацией по типам. Разворачивается через element-library composition (включая phantom-элементы модульных конфигураций).',
      defaultTemplateId: 'builtin-bom-landscape',
      tags: ['ведомость', 'таблица', 'спецификация', 'bom'],
      ...sectionBom(),
    },
    {
      id: 'selectivity',
      title: 'Селективность защиты',
      description: 'Анализ селективности пар upstream-downstream автоматов (амплитудная и временная проверка по IEC 60364-5-53). Матрица нарушений с рекомендациями.',
      defaultTemplateId: 'builtin-engineering-a4',
      tags: ['инженерный', 'защита', 'селективность'],
      ...sectionSelectivity(),
    },
    {
      id: 'checks',
      title: 'Проверки и предупреждения',
      description: 'Список выявленных проблем схемы: неподключённые потребители, щиты без отходящих линий, перегруженные узлы, справочные замечания.',
      defaultTemplateId: 'builtin-technical-note',
      tags: ['записка', 'рабочий'],
      ...sectionChecks(),
    },
  ];
}
