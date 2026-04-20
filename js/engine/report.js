import { state } from './state.js';
import { CHANNEL_TYPES, GLOBAL } from './constants.js';
import { recalc } from './recalc.js';
import { effectiveOn, effectiveLoadFactor } from './modes.js';
import { effectiveTag } from './zones.js';
import { cableVoltageClass, nodeVoltage, consumerCountEffective } from './electrical.js';
import { fmt } from './utils.js';

// Полное обозначение узла — всегда с префиксом зоны (например «P1.MPB1»),
// чтобы в отчёте не было дубликатов при одинаковых коротких tag в разных зонах.
function fullTag(n) {
  if (!n) return '';
  return effectiveTag(n) || n.tag || '';
}

// Сортировка по обозначению (tag) с естественным порядком:
//  PNL1, PNL2, PNL10, PNL12 (а не PNL1, PNL10, PNL12, PNL2 как при простом алфавитном).
// Используется numeric:true в Intl.Collator.
function sortByTag(arr) {
  return arr.sort((a, b) => {
    const ta = (effectiveTag(a) || a.tag || a.name || '').toLowerCase();
    const tb = (effectiveTag(b) || b.tag || b.name || '').toLowerCase();
    return ta.localeCompare(tb, 'ru', { numeric: true, sensitivity: 'base' });
  });
}

export function get3PhaseBalance() {
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
      tag: fullTag(panel),
      name: panel?.name || '',
      a: g.a, b: g.b, c: g.c,
      imbalance,
      warning: imbalance > 15,
    });
  }
  return out;
}

export function generateReport() {
  recalc();
  const lines = [];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // === ШАПКА ПРОЕКТА ===
  const proj = state.project || {};
  lines.push('='.repeat(78));
  lines.push('ОТЧЁТ ПО СХЕМЕ ЭЛЕКТРОСНАБЖЕНИЯ');
  lines.push('='.repeat(78));
  if (proj.designation) lines.push('Обозначение:    ' + proj.designation);
  if (proj.name)        lines.push('Наименование:   ' + proj.name);
  if (proj.customer)    lines.push('Заказчик:       ' + proj.customer);
  if (proj.object)      lines.push('Объект:         ' + proj.object);
  if (proj.stage)       lines.push('Стадия:         ' + proj.stage);
  if (proj.author)      lines.push('ГИП / Исполн.:  ' + proj.author);
  if (proj.description) {
    lines.push('Описание:');
    for (const line of String(proj.description).split(/\r?\n/)) lines.push('  ' + line);
  }
  lines.push('-'.repeat(78));
  lines.push('Дата формирования: ' + stamp);
  // Активный режим работы
  if (state.activeModeId) {
    const m = (state.modes || []).find(x => x.id === state.activeModeId);
    lines.push('Режим работы:      ' + (m?.name || '-'));
  } else {
    lines.push('Режим работы:      Нормальный режим');
  }
  // Текущая страница + ссылочные
  const curPage = (state.pages || []).find(p => p.id === state.currentPageId);
  if (curPage) {
    const linkedChildren = (state.pages || []).filter(p => p.type === 'linked' && p.sourcePageId === curPage.id);
    if (curPage.designation) lines.push('Обозн. листа:      ' + curPage.designation);
    lines.push('Страница:          ' + (curPage.name || curPage.id));
    if (curPage.sheetNo) lines.push('№ листа:           ' + curPage.sheetNo);
    if (curPage.title)   lines.push('Наим. чертежа:     ' + curPage.title);
    if (curPage.revision)lines.push('Ревизия:           ' + curPage.revision);
    if (curPage.description) {
      lines.push('Описание листа:');
      for (const ln of String(curPage.description).split(/\r?\n/)) lines.push('  ' + ln);
    }
    if (linkedChildren.length) {
      lines.push('Ссылочные стр.:    ' + linkedChildren.map(p => p.name).join(', '));
    }
  }
  lines.push('='.repeat(78));
  lines.push('');

  // === ФИЛЬТР ПО СТРАНИЦАМ ===
  // В отчёт включаются узлы, которые видны на текущей странице ИЛИ на любой
  // из её ссылочных потомков (т.е. в «пространстве листа»).
  const _pageSpace = new Set();
  if (curPage) {
    _pageSpace.add(curPage.id);
    for (const p of (state.pages || [])) {
      if (p.type === 'linked' && p.sourcePageId === curPage.id) _pageSpace.add(p.id);
    }
  }
  const _inSpace = (node) => {
    if (!curPage) return true;
    const pids = Array.isArray(node?.pageIds) ? node.pageIds : null;
    if (!pids || pids.length === 0) return true; // legacy — везде
    for (const pid of pids) if (_pageSpace.has(pid)) return true;
    return false;
  };
  const _connInSpace = (c) => {
    const fromN = state.nodes.get(c.from.nodeId);
    const toN = state.nodes.get(c.to.nodeId);
    return fromN && toN && _inSpace(fromN) && _inSpace(toN);
  };

  // 1. Источники
  const sources = sortByTag([...state.nodes.values()].filter(n => (n.type === 'source' || n.type === 'generator') && _inSpace(n)));
  if (sources.length) {
    lines.push('ИСТОЧНИКИ ПИТАНИЯ');
    lines.push('-'.repeat(92));
    lines.push(
      'Обозн.'.padEnd(12) +
      'Имя'.padEnd(21) +
      'Тип'.padEnd(12) +
      'U, IEC'.padEnd(18) +
      'Pном,kW'.padStart(7) + '  ' +
      'Pнаг,kW'.padStart(7) + '  ' +
      'Iр,A'.padStart(6) + '   ' +
      'cosφ'
    );
    for (const s of sources) {
      const on = effectiveOn(s);
      const cap = Number(s.capacityKw) || 0;
      const load = s._loadKw || 0;
      const subtype = s.sourceSubtype || (s.type === 'generator' ? 'generator' : 'transformer');
      let type;
      if (subtype === 'utility') type = 'Гор. сеть';
      else if (subtype === 'other') type = 'Прочий';
      else if (s.type === 'generator') type = s.backupMode ? 'Генер.рез.' : 'Генератор';
      else type = 'Трансформ.';
      const status = !on ? ' ОТКЛ' : (s._overload ? ' ПЕРЕГР' : '');
      // Для utility показываем класс по IEC 60502-2; для трансформатора — вторичн./первичн.
      let vStr;
      if (subtype === 'utility') {
        vStr = cableVoltageClass(nodeVoltage(s));
      } else if (subtype === 'transformer' && typeof s.inputVoltageLevelIdx === 'number') {
        const levels = GLOBAL.voltageLevels || [];
        const lvl = levels[s.inputVoltageLevelIdx];
        vStr = lvl ? `${lvl.vLL}/${nodeVoltage(s)}В` : `${nodeVoltage(s)}В`;
      } else {
        vStr = `${nodeVoltage(s)}В`;
      }
      lines.push(
        fullTag(s).padEnd(12) +
        (s.name || '').padEnd(21) +
        type.padEnd(12) +
        vStr.padEnd(18) +
        String(fmt(cap)).padStart(7) + '  ' +
        String(fmt(load)).padStart(7) + '  ' +
        String(fmt(s._loadA || 0)).padStart(6) + '   ' +
        ((s._cosPhi || 0).toFixed(2)) + status
      );
    }
    lines.push('');
  }

  // 2. ИБП
  const upses = sortByTag([...state.nodes.values()].filter(n => n.type === 'ups' && _inSpace(n)));
  if (upses.length) {
    lines.push('ИСТОЧНИКИ БЕСПЕРЕБОЙНОГО ПИТАНИЯ (ИБП)');
    lines.push('-'.repeat(60));
    for (const u of upses) {
      const cap = Number(u.capacityKw) || 0;
      const load = u._loadKw || 0;
      const maxLoad = u._maxLoadKw || load;
      const eff = Number(u.efficiency) || 100;
      const batt = (Number(u.batteryKwh) || 0) * (Number(u.batteryChargePct) || 0) / 100;
      // Автономия считается по МАКСИМАЛЬНОЙ нагрузке — АКБ должна выдержать
      // наихудший сценарий, а не мгновенное потребление.
      const autLoad = maxLoad > 0 ? maxLoad : load;
      const aut = autLoad > 0 ? batt / autLoad * 60 : 0;
      lines.push(`${fullTag(u).padEnd(12)}${u.name}`);
      lines.push(`   Pном:       ${fmt(cap)} kW  (КПД ${eff}%)`);
      lines.push(`   Текущая:    ${fmt(load)} kW`);
      // Максимальная нагрузка: сколько ИБП должен реально отдать. Лимитирована
      // номиналом (_maxLoadKw уже capped в recalc.js). Если downstream по
      // сценариям превышает номинал, выводим предупреждение с uncapped-значением.
      lines.push(`   Макс нагр.: ${fmt(maxLoad)} kW  (${cap > 0 ? Math.round(maxLoad / cap * 100) : 0}%)`);
      if (u._maxOverload) {
        const uncapped = Number(u._maxDownstreamUncapped) || 0;
        lines.push(`   ⚠ ПЕРЕГРУЗ: downstream по макс-сценарию = ${fmt(uncapped)} kW (${cap > 0 ? Math.round(uncapped / cap * 100) : 0}% от номинала)`);
        lines.push(`              ИБП физически не выдаст больше ${fmt(cap)} kW — требуется увеличить номинал или распределить нагрузку.`);
      }
      lines.push(`   Батарея:    ${fmt(batt)} kWh · ${u.batteryChargePct || 0}%`);
      // Детали АКБ (каталожный режим): модель, конфигурация, напряжение DC,
      // мощность/блок, автономия по методу (таблица / усреднённая модель).
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
        const vdcMin = Number(u.batteryVdcMin) || 0;
        const vdcMax = Number(u.batteryVdcMax) || 0;
        lines.push(`   Модель АКБ: [из справочника] · ${capAh || '—'} А·ч · ${blockVnom || '—'} В блок`);
        if (vdcMin && vdcMax) {
          lines.push(`   V_DC диап.: ${vdcMin}…${vdcMax} В  (раб. ${vdcOper || '—'} В)`);
        } else if (vdcOper) {
          lines.push(`   V_DC раб.:  ${vdcOper} В`);
        }
        lines.push(`   Конфиг.:    ${strings} × ${blocksPer} блок = ${totalBlocks} шт. · endV ${endV.toFixed(2)} В/эл.`);
        if (totalBlocks > 0 && autLoad > 0) {
          // P/блок и ток цепочки считаются по МАКС. нагрузке — как и автономия
          const batteryPwrReqKw = autLoad / Math.max(0.5, eff / 100);
          const powerPerBlockW = (batteryPwrReqKw * 1000) / totalBlocks;
          const stringA = vdcOper > 0 ? (batteryPwrReqKw * 1000 / vdcOper) / strings : 0;
          lines.push(`   P/блок:     ${fmt(powerPerBlockW)} Вт · I цеп.: ${fmt(stringA)} А  (по макс. нагр.)`);
        }
        if (Number.isFinite(Number(u.batteryTargetMin))) {
          lines.push(`   Цель авт.:  ${u.batteryTargetMin} мин`);
        }
      }
      if (autLoad > 0) {
        lines.push(`   Автономия:  ${aut >= 60 ? (aut / 60).toFixed(1) + ' ч' : Math.round(aut) + ' мин'}  (при макс. нагр. ${fmt(autLoad)} kW)`);
      }
      if (u._onBattery) lines.push('   Статус:     РАБОТА ОТ БАТАРЕИ');
      else if (u._powered) lines.push('   Статус:     норма (от сети)');
      else lines.push('   Статус:     БЕЗ ПИТАНИЯ');
      lines.push('');
    }
  }

  // 3. Щиты
  const panels = sortByTag([...state.nodes.values()].filter(n => n.type === 'panel' && _inSpace(n)));
  if (panels.length) {
    lines.push('РАСПРЕДЕЛИТЕЛЬНЫЕ ЩИТЫ');
    lines.push('-'.repeat(92));
    lines.push(
      'Обозн.'.padEnd(12) +
      'Имя'.padEnd(21) +
      'In, А'.padStart(5) + '  ' +
      'Вх/Вых'.padEnd(8) +
      'Pрасч, kW'.padStart(9) + '  ' +
      'Iрасч, A'.padStart(8) + '  ' +
      'Ксим'.padStart(4) + '  ' +
      'cos φ'.padEnd(6) + ' ' +
      'Режим'
    );
    for (const p of panels) {
      const mode = p.switchMode === 'manual' ? 'РУЧН'
                 : p.switchMode === 'parallel' ? 'ЩИТ'
                 : (p.inputs || 1) <= 1 ? 'ЩИТ'
                 : 'АВР';
      const capA = p.capacityA || 0;
      lines.push(
        fullTag(p).padEnd(12) +
        (p.name || '').padEnd(21) +
        String(capA).padStart(5) + '  ' +
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
  const consumers = sortByTag([...state.nodes.values()].filter(n => n.type === 'consumer' && _inSpace(n)));
  if (consumers.length) {
    lines.push('ПОТРЕБИТЕЛИ');
    lines.push('-'.repeat(100));
    lines.push(
      'Обозн.'.padEnd(12) +
      'Имя'.padEnd(21) +
      'Фаза'.padEnd(5) + ' ' +
      'kW ед'.padStart(6) + ' ' +
      'Кол'.padStart(4) + ' ' +
      'Pрасч'.padStart(6) + ' ' +
      'cos φ'.padStart(6) + ' ' +
      'Iуст'.padStart(5) + ' ' +
      'Iрасч'.padStart(6) + ' ' +
      'Iпуск'.padStart(6) + '  ' +
      'Статус'
    );
    let total = 0;
    for (const c of consumers) {
      const per = Number(c.demandKw) || 0;
      const cnt = Math.max(1, Number(c.count) || 1);
      const factor = effectiveLoadFactor(c);
      const k = (Number(c.kUse) || 1) * factor;
      const sum = per * cnt * k;
      if (c._powered) total += sum;
      lines.push(
        fullTag(c).padEnd(12) +
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
  const activeCables = [...state.conns.values()].filter(c => (c._cableSize || c._busbarNom) && _connInSpace(c));
  // Сортировка по обозначению линии
  activeCables.sort((a, b) => {
    const aFrom = effectiveTag(state.nodes.get(a.from.nodeId)) || '';
    const aTo = effectiveTag(state.nodes.get(a.to.nodeId)) || '';
    const bFrom = effectiveTag(state.nodes.get(b.from.nodeId)) || '';
    const bTo = effectiveTag(state.nodes.get(b.to.nodeId)) || '';
    const aPre = a._isHV ? 'WH' : (a._isDC ? 'WD' : 'W');
    const bPre = b._isHV ? 'WH' : (b._isDC ? 'WD' : 'W');
    const la = (a.lineLabel || `${aPre}-${aFrom}-${aTo}`).toLowerCase();
    const lb = (b.lineLabel || `${bPre}-${bFrom}-${bTo}`).toLowerCase();
    return la.localeCompare(lb, 'ru', { numeric: true, sensitivity: 'base' });
  });
  if (activeCables.length) {
    lines.push('КАБЕЛЬНЫЕ ЛИНИИ И ШИНОПРОВОДЫ');
    lines.push('-'.repeat(120));
    // BOM-подобный порядок:
    // Обозначение | Проводник | Кол-во (шт.) | L, м | Итого, м | Imax | Iдоп | Метод | Каналы
    lines.push(
      'Обозначение'.padEnd(25) +
      'Проводник'.padEnd(20) +
      'Кол-во'.padStart(7) + '  ' +
      'L, м'.padStart(7) + '  ' +
      'Итого, м'.padStart(9) + '  ' +
      'Imax, A'.padStart(7) + '  ' +
      'Iдоп, A'.padStart(7) + '  ' +
      'Метод'.padEnd(6) + '  ' +
      'Каналы'
    );
    let bomTotalLength = 0;
    for (const c of activeCables) {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromTag = effectiveTag(fromN) || fromN?.name || '?';
      const toTag = effectiveTag(toN) || toN?.name || '?';
      const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
      const lineLabel = c.lineLabel || `${linePrefix}-${fromTag}-${toTag}`;
      const warn = c._cableOverflow ? ' ⚠' : '';
      const length = c._cableLength != null ? c._cableLength : (c.lengthM || 0);

      // Кол-во: всегда в штуках. Параллельные кабели + групповая
      // линия дают суммарное число физических отрезков.
      let qty;
      let conductorSpec;
      let methodStr;
      if (c._busbarNom) {
        qty = 1;
        conductorSpec = `шинопр. ${c._busbarNom} А`;
        methodStr = '—';
      } else {
        const parallel = Math.max(1, c._cableParallel || 1);
        const isGroup = Array.isArray(c._groupCables) && c._groupCables.length > 1;
        const groupCount = isGroup ? c._groupCables.length : 1;
        // v0.57.85: групповой потребитель → ×N
        const consumerMul = (toN && toN.type === 'consumer') ? consumerCountEffective(toN) : 1;
        qty = parallel * groupCount * consumerMul;
        const cores = c._wireCount || (c._threePhase ? 5 : 3);
        conductorSpec = `${cores}×${c._cableSize} мм²`;
        // IEC 60502-2 класс напряжения для HV-кабелей
        if (c._isHV) conductorSpec = cableVoltageClass(c._voltage || 0) + ' · ' + conductorSpec;
        // DC-префикс (постоянный ток АКБ / Li-Ion)
        if (c._isDC) conductorSpec = `= ${Math.round(Number(c._voltage) || 0)} В · ` + conductorSpec;
        methodStr = c._cableMethod || '-';
      }

      const totalM = Number(length) * qty;
      bomTotalLength += totalM;

      // Каналы, через которые проходит линия
      const channelIds = Array.isArray(c.channelIds) ? c.channelIds : [];
      let channelStr = '—';
      if (channelIds.length) {
        const chLabels = channelIds.map(chId => {
          const ch = state.nodes.get(chId);
          if (!ch || ch.type !== 'channel') return null;
          const chType = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
          return `${effectiveTag(ch) || ch.name || '?'} (${chType.method})`;
        }).filter(Boolean);
        channelStr = chLabels.join(', ') || '—';
      }

      lines.push(
        lineLabel.slice(0, 24).padEnd(25) +
        conductorSpec.padEnd(20) +
        (String(qty) + ' шт.').padStart(7) + '  ' +
        String(fmt(length)).padStart(7) + '  ' +
        String(fmt(totalM)).padStart(9) + '  ' +
        String(fmt(c._maxA || 0)).padStart(7) + '  ' +
        String(fmt(c._cableIz || 0)).padStart(7) + '  ' +
        methodStr.padEnd(6) + '  ' +
        channelStr + warn
      );
    }
    lines.push('-'.repeat(120));
    lines.push('ИТОГО кабеля / шинопровода: ' + fmt(bomTotalLength) + ' м');
    lines.push('');
  }

  // 4b. Расчётные модули по линиям (shared/calc-modules)
  // Для каждой активной линии выводим результат КАЖДОГО включённого
  // модуля независимо — пользователь видит влияние mandatory (ampacity,
  // vdrop, shortCircuit, phaseLoop) и optional (economic).
  const linesWithModules = activeCables.filter(c => Array.isArray(c._moduleResults) && c._moduleResults.length);
  if (linesWithModules.length) {
    lines.push('РАСЧЁТНЫЕ МОДУЛИ ПО ЛИНИЯМ');
    lines.push('-'.repeat(92));
    lines.push('Модули: подбор по току (IEC 60364-5-52), падение напряжения,');
    lines.push('термическая стойкость к КЗ (IEC 60364-4-43), петля фаза-ноль (IEC 60364-4-41),');
    lines.push('экономическая плотность тока.');
    lines.push('');
    for (const c of linesWithModules) {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromTag = effectiveTag(fromN) || fromN?.name || '?';
      const toTag = effectiveTag(toN) || toN?.name || '?';
      const linePrefix = c._isHV ? 'WH' : (c._isDC ? 'WD' : 'W');
      const lineLabel = c.lineLabel || `${linePrefix}-${fromTag}-${toTag}`;
      lines.push(`  ${lineLabel}`);
      for (const m of c._moduleResults) {
        const r = m.result || {};
        const d = r.details || {};
        let status;
        if (d.skipped) status = 'пропущен';
        else if (r.pass) status = 'OK';
        else status = 'ПРОБЛЕМА';
        let detail = '';
        if (m.id === 'ampacity' && !d.skipped) {
          detail = `S=${d.s}мм² Iz=${d.iDerated?.toFixed(0)}А Kt·Kg=${d.kTotal?.toFixed(2)}`;
        } else if (m.id === 'vdrop' && !d.skipped) {
          detail = `ΔU=${d.dUpct?.toFixed(2)}% ≤ ${d.maxPct}%`;
          if (d.bumpedTo) detail += ` → ${d.bumpedTo}мм²`;
        } else if (m.id === 'economic' && !d.skipped) {
          detail = `jэк=${d.jEk} Sрасч=${d.sCalc}мм² Sст=${d.sStandard}мм²`;
        } else if (m.id === 'shortCircuit' && !d.skipped) {
          detail = `Ik=${d.IkA}А tk=${d.tkS}с → Smin=${d.sRequired}мм²`;
        } else if (m.id === 'phaseLoop' && !d.skipped) {
          detail = `${d.earthing} Zloop=${d.Zloop}Ом Ik1=${d.Ik1}А ≥ Ia=${d.Ia}А`;
        } else if (d.skipped) {
          detail = d.reason || 'нет данных';
        }
        lines.push(`    ${m.label.padEnd(36)}${status.padEnd(10)} ${detail}`);
        for (const w of (r.warnings || [])) {
          lines.push(`       ⚠ ${w}`);
        }
      }
      lines.push('');
    }
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
        ((b.tag || '') + ' ' + (b.name || '')).padEnd(26) +
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
    if (!_inSpace(n)) continue;
    if (n.type === 'consumer') {
      const hasIn = [...state.conns.values()].some(c => c.to.nodeId === n.id);
      if (!hasIn) issues.push(`  ⚠ Потребитель ${fullTag(n) || n.name} не подключён`);
      if (!n._powered) issues.push(`  ⚠ Потребитель ${fullTag(n) || n.name} без питания`);
    }
    if (n.type === 'panel') {
      const hasOut = [...state.conns.values()].some(c => c.from.nodeId === n.id);
      if (!hasOut) issues.push(`  ⚠ Щит ${fullTag(n) || n.name} не имеет отходящих линий`);
    }
    if (n.type === 'ups' && (Number(n.batteryKwh) || 0) <= 0) {
      issues.push(`  ⚠ ИБП ${fullTag(n) || n.name}: нулевая ёмкость батареи`);
    }
    if (n.type === 'generator' && !n.backupMode) {
      issues.push(`  ℹ Генератор ${fullTag(n) || n.name} работает как основной источник (не резерв)`);
    }
    if (n._overload) {
      issues.push(`  ⚠ ${fullTag(n) || n.name}: перегруз (${fmt(n._loadKw)}/${fmt(n.capacityKw)} kW)`);
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

  // Перечень каналов с кабельными линиями
  const channels = sortByTag([...state.nodes.values()].filter(n => n.type === 'channel' && _inSpace(n)));
  if (channels.length) {
    lines.push('КАБЕЛЬНЫЕ КАНАЛЫ И ТРАССЫ');
    lines.push('-'.repeat(78));
    for (const ch of channels) {
      const tag = effectiveTag(ch) || ch.tag || '';
      const name = ch.name || '';
      const typeInfo = CHANNEL_TYPES[ch.channelType] || CHANNEL_TYPES.conduit;
      const lengthM = ch.lengthM || 0;
      lines.push(`${tag}  ${name}  (${typeInfo.label}, ${lengthM} м, метод ${typeInfo.method})`);
      // Все линии в канале — по channelIds
      const chConns = [];
      for (const c of state.conns.values()) {
        if (!Array.isArray(c.channelIds) || !c.channelIds.includes(ch.id)) continue;
        chConns.push(c);
      }
      if (chConns.length) {
        for (const c of chConns) {
          const fromN = state.nodes.get(c.from.nodeId);
          const toN = state.nodes.get(c.to.nodeId);
          const fromTag = fromN ? (effectiveTag(fromN) || fromN.name || '?') : '?';
          const toTag = toN ? (effectiveTag(toN) || toN.name || '?') : '?';
          const cable = c._cableSize ? `${c._wireCount || '?'}×${c._cableSize} мм²` : '—';
          const current = c._maxA ? `${fmt(c._maxA)} A` : '—';
          const length = c._cableLength != null ? `${c._cableLength} м` : '—';
          lines.push(`    W-${fromTag}-${toTag}  ${cable}  ${length}  Imax: ${current}`);
        }
      } else {
        lines.push('    (нет линий)');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
