import { state } from './state.js';
import { CHANNEL_TYPES } from './constants.js';
import { recalc } from './recalc.js';
import { effectiveOn, effectiveLoadFactor } from './modes.js';
import { effectiveTag } from './zones.js';
import { fmt } from './utils.js';

// Сортировка по обозначению (tag) в алфавитном порядке
function sortByTag(arr) {
  return arr.sort((a, b) => {
    const ta = (effectiveTag(a) || a.tag || a.name || '').toLowerCase();
    const tb = (effectiveTag(b) || b.tag || b.name || '').toLowerCase();
    return ta.localeCompare(tb, 'ru');
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
      tag: panel?.tag || '',
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
  const sources = sortByTag([...state.nodes.values()].filter(n => n.type === 'source' || n.type === 'generator'));
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
  const upses = sortByTag([...state.nodes.values()].filter(n => n.type === 'ups'));
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
  const panels = sortByTag([...state.nodes.values()].filter(n => n.type === 'panel'));
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
  const consumers = sortByTag([...state.nodes.values()].filter(n => n.type === 'consumer'));
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
  const activeCables = [...state.conns.values()].filter(c => c._cableSize || c._busbarNom);
  // Сортировка по обозначению линии
  activeCables.sort((a, b) => {
    const aFrom = effectiveTag(state.nodes.get(a.from.nodeId)) || '';
    const aTo = effectiveTag(state.nodes.get(a.to.nodeId)) || '';
    const bFrom = effectiveTag(state.nodes.get(b.from.nodeId)) || '';
    const bTo = effectiveTag(state.nodes.get(b.to.nodeId)) || '';
    const la = (a.lineLabel || `W-${aFrom}-${aTo}`).toLowerCase();
    const lb = (b.lineLabel || `W-${bFrom}-${bTo}`).toLowerCase();
    return la.localeCompare(lb, 'ru');
  });
  if (activeCables.length) {
    lines.push('КАБЕЛЬНЫЕ ЛИНИИ И ШИНОПРОВОДЫ');
    lines.push('-'.repeat(100));
    lines.push('Обозначение              Проводник       L, м   Imax, A  Iдоп, A  Метод   Каналы');
    for (const c of activeCables) {
      const fromN = state.nodes.get(c.from.nodeId);
      const toN = state.nodes.get(c.to.nodeId);
      const fromTag = effectiveTag(fromN) || fromN?.name || '?';
      const toTag = effectiveTag(toN) || toN?.name || '?';
      const lineLabel = c.lineLabel || `W-${fromTag}-${toTag}`;
      const warn = c._cableOverflow ? ' ⚠' : '';
      const length = c._cableLength != null ? c._cableLength : (c.lengthM || 0);

      let conductorSpec;
      let methodStr;
      if (c._busbarNom) {
        conductorSpec = `шинопр. ${c._busbarNom} А`;
        methodStr = '—';
      } else {
        const parallel = Math.max(1, c._cableParallel || 1);
        const cores = c._wireCount || (c._threePhase ? 5 : 3);
        const inner = `${cores}×${c._cableSize} мм²`;
        conductorSpec = (c._cableAutoParallel && parallel > 1) ? `${parallel}×(${inner})` : inner;
        methodStr = c._cableMethod || '-';
      }

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
        conductorSpec.padEnd(16) +
        String(length).padStart(5) + '  ' +
        String(fmt(c._maxA || 0)).padStart(7) + '  ' +
        String(fmt(c._cableIz || 0)).padStart(7) + '  ' +
        methodStr.padEnd(6) + '  ' +
        channelStr + warn
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

  // Перечень каналов с кабельными линиями
  const channels = sortByTag([...state.nodes.values()].filter(n => n.type === 'channel'));
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
