// ======================================================================
// js/engine/selectivity-check.js
// Анализ селективности защитных аппаратов проекта (Фаза 1.8).
//
// Проходит по всем узлам-панелям и находит пары upstream-downstream
// автоматов (входная линия → исходящая линия через узел-щит). Для
// каждой пары вызывает checkSelectivity() из shared/tcc-curves.js.
//
// Возвращает массив { upstream, downstream, node, check } где check =
// { selective, reason, checks: [...] } из tcc-curves.js.
//
// Использует данные с recalc'ом (c._breakerIn, c.breakerCurve). Без
// актуальных данных рекомендуется вызвать recalc() перед анализом.
// ======================================================================

import { state } from './state.js';
import { effectiveTag } from './zones.js';
import { checkSelectivity } from '../../shared/tcc-curves.js';

/**
 * Преобразовать breakerCurve из нашего формата ('MCB_B', 'MCCB') в
 * формат tcc-curves.js ('B', 'C', 'D' или 'MCCB').
 */
function _normalizeCurve(curve) {
  if (!curve) return 'C';
  const s = String(curve);
  const m = /^MCB_([BCDKZ])$/i.exec(s);
  if (m) return m[1].toUpperCase();
  return s; // MCCB / ACB / gG остаются как есть
}

/**
 * Вычислить минимальный I_k в данной точке (для оценки селективности
 * при реальном токе КЗ). Берём Ik1 линии downstream если посчитан,
 * иначе глобальный Ik (GLOBAL.Ik_kA * 1000).
 */
function _getIkAt(conn) {
  // Ik1 считается в модуле phase-loop — сохраняется как c._modules.phaseLoop.Ik1A
  const mod = conn._modules?.phaseLoop?.details;
  if (mod && mod.Ik1A) return Number(mod.Ik1A);
  // Fallback — расчётный I на линии × magnitude coefficient (грубо)
  return null;
}

/**
 * Основная функция анализа.
 * Возвращает { pairs, summary } где:
 *   pairs = [{ upstream, downstream, node, check, Ik }]
 *   summary = { total, selective, nonSelective, undefined }
 */
/**
 * Селективность MV-ячейки ввода против отходящей. Упрощённая проверка:
 *   1. Амплитудная: In_up ≥ 1.3 × In_down (для VCB-VCB), ≥ 1.6 для fuse-fuse
 *   2. По типам: infeed с VCB + feeder с fuse → OK (fuse срабатывает раньше)
 *                  infeed с fuse + feeder с VCB → НЕ OK (fuse upstream слишком медленный)
 */
function _mvCellSelectivity(upCell, downCell) {
  const inUp = Number(upCell.In_A || upCell.In || 0);
  const inDown = Number(downCell.In_A || downCell.In || 0);
  const checks = [];
  // Амплитудная — предпочитаем уставки реле, если заданы
  const upPickup = Number(upCell.settings?.Isd) || inUp;
  const downPickup = Number(downCell.settings?.Isd) || inDown;
  const coef = downCell.breakerType === 'fuse-switch' ? 1.6 : 1.3;
  const amplitudeOk = upPickup >= coef * downPickup;
  checks.push({
    type: 'amplitude',
    ok: amplitudeOk,
    info: upCell.settings?.Isd
      ? `Isd_up=${upPickup} vs ${coef}×Isd_down=${(coef * downPickup).toFixed(1)} А`
      : `In_up=${inUp} vs ${coef}×In_down=${(coef * inDown).toFixed(1)} А`,
  });
  // По типам аппаратов
  const upType = upCell.breakerType || '—';
  const downType = downCell.breakerType || '—';
  let typeOk = true, typeInfo = `${upType} → ${downType}`;
  if (upType === 'fuse-switch' && downType === 'VCB') {
    typeOk = false;
    typeInfo += ' (⚠ fuse наверху медленнее VCB внизу — нарушение селективности)';
  }
  checks.push({ type: 'device-type', ok: typeOk, info: typeInfo });

  // Phase 1.19.15: временная проверка — если у обеих ячеек VCB с relay settings
  const upTsd = Number(upCell.settings?.tsd);
  const downTsd = Number(downCell.settings?.tsd);
  if (upTsd > 0 && downTsd > 0) {
    // Ступень селективности Δt = tsd_up - tsd_down ≥ 0.1…0.2 с
    const dt = upTsd - downTsd;
    const timeOk = dt >= 0.1;
    checks.push({
      type: 'time-step',
      ok: timeOk,
      info: `Δt = ${dt.toFixed(2)} с (требуется ≥ 0.1 с)`,
    });
  }

  const selective = checks.every(c => c.ok);
  return {
    selective,
    reason: selective
      ? 'Селективность обеспечена (амплитуда + тип' + (upTsd > 0 && downTsd > 0 ? ' + временная ступень' : '') + ')'
      : 'Нарушение: ' + checks.filter(c => !c.ok).map(c => c.type + ': ' + c.info).join('; '),
    checks,
  };
}

export function analyzeSelectivity() {
  const pairs = [];
  // Для каждой панели находим входные и выходные соединения
  const conns = [...state.conns.values()];
  for (const node of state.nodes.values()) {
    if (node.type !== 'panel' && node.type !== 'ups') continue;

    // Фаза 1.19.6: MV-щиты — анализ селективности ячеек из n.mvCells
    // (без учёта conn-уровня, т.к. MV-ячейки живут в самом щите)
    if (node.isMv && Array.isArray(node.mvCells) && node.mvCells.length) {
      const infeeds = node.mvCells.filter(c => c.type === 'infeed' || c.type === 'busCoupler');
      const feeders = node.mvCells.filter(c => c.type === 'feeder' || c.type === 'transformer-protect');
      for (const upCell of infeeds) {
        for (const downCell of feeders) {
          const check = _mvCellSelectivity(upCell, downCell);
          pairs.push({
            node,
            mvUpCell: upCell,
            mvDownCell: downCell,
            upBreaker: {
              inNominal: Number(upCell.In_A || upCell.In || 0),
              curve: upCell.breakerType || '—',
              type: 'MV',
            },
            downBreaker: {
              inNominal: Number(downCell.In_A || downCell.In || 0),
              curve: downCell.breakerType || '—',
              type: 'MV',
            },
            Ik: node._Ik3_kA ? node._Ik3_kA * 1000 : null,
            check,
            isMvCellPair: true,
          });
        }
      }
      continue; // для MV-узлов не делаем conn-уровневый анализ (у них ячейки внутри)
    }

    const inputs = conns.filter(c => c.to.nodeId === node.id);
    const outputs = conns.filter(c => c.from.nodeId === node.id);
    if (!inputs.length || !outputs.length) continue;

    // Для каждого входа (активного) создаём пары с каждым выходом
    for (const up of inputs) {
      if (!up._breakerIn) continue;
      const upBreaker = {
        inNominal: Number(up._breakerIn),
        curve: _normalizeCurve(up.breakerCurve || up._breakerCurveEff),
        type: 'MCB',
      };
      for (const down of outputs) {
        if (!down._breakerIn) continue;
        const downBreaker = {
          inNominal: Number(down._breakerIn),
          curve: _normalizeCurve(down.breakerCurve || down._breakerCurveEff),
          type: 'MCB',
        };
        const Ik = _getIkAt(down);
        const check = checkSelectivity(upBreaker, downBreaker, Ik);
        pairs.push({
          upstream: up,
          downstream: down,
          node,
          upBreaker,
          downBreaker,
          Ik,
          check,
        });
      }
    }
  }

  const summary = {
    total: pairs.length,
    selective: pairs.filter(p => p.check.selective).length,
    nonSelective: pairs.filter(p => !p.check.selective).length,
    mvPairs: pairs.filter(p => p.isMvCellPair).length,
  };
  return { pairs, summary };
}

/**
 * Человекочитаемая строка для одной пары (для отчёта / UI).
 */
export function formatPair(pair) {
  const nodeTag = effectiveTag(pair.node) || pair.node.name || '?';
  // Фаза 1.19.6: MV-пары — без upstream/downstream conn-объектов
  // (ячейки живут в самом щите). Форматируем компактно.
  if (pair.isMvCellPair) {
    const upLabel = pair.mvUpCell?.functionCode || pair.mvUpCell?.type || 'infeed';
    const downLabel = pair.mvDownCell?.functionCode || pair.mvDownCell?.type || 'feeder';
    return `${nodeTag}: ${upLabel} → ${downLabel}  |  ` +
      `Up: ${pair.upBreaker.inNominal}A ${pair.upBreaker.curve}  vs  ` +
      `Down: ${pair.downBreaker.inNominal}A ${pair.downBreaker.curve}` +
      (pair.Ik ? `  @ I_k=${pair.Ik.toFixed(0)}А` : '');
  }
  const upTag = effectiveTag(pair.upstream?.from?.nodeId ? state.nodes.get(pair.upstream.from.nodeId) : null) || '?';
  const downTag = effectiveTag(pair.downstream?.to?.nodeId ? state.nodes.get(pair.downstream.to.nodeId) : null) || '?';
  return `${upTag} → ${nodeTag} → ${downTag}  |  ` +
    `Up: ${pair.upBreaker.inNominal}A ${pair.upBreaker.curve}  vs  ` +
    `Down: ${pair.downBreaker.inNominal}A ${pair.downBreaker.curve}` +
    (pair.Ik ? `  @ I_k=${pair.Ik.toFixed(0)}А` : '');
}
