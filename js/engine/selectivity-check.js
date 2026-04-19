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
export function analyzeSelectivity() {
  const pairs = [];
  // Для каждой панели находим входные и выходные соединения
  const conns = [...state.conns.values()];
  for (const node of state.nodes.values()) {
    if (node.type !== 'panel' && node.type !== 'ups') continue;

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
  };
  return { pairs, summary };
}

/**
 * Человекочитаемая строка для одной пары (для отчёта / UI).
 */
export function formatPair(pair) {
  const upTag = effectiveTag(pair.upstream.from?.nodeId ? state.nodes.get(pair.upstream.from.nodeId) : null) || '?';
  const downTag = effectiveTag(pair.downstream.to?.nodeId ? state.nodes.get(pair.downstream.to.nodeId) : null) || '?';
  const nodeTag = effectiveTag(pair.node) || pair.node.name || '?';
  return `${upTag} → ${nodeTag} → ${downTag}  |  ` +
    `Up: ${pair.upBreaker.inNominal}A ${pair.upBreaker.curve}  vs  ` +
    `Down: ${pair.downBreaker.inNominal}A ${pair.downBreaker.curve}` +
    (pair.Ik ? `  @ I_k=${pair.Ik.toFixed(0)}А` : '');
}
