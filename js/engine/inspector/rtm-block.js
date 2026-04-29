// =========================================================================
// Общий блок «РТМ 36.18.32.4-92 (справочно/активная)» для боковых
// инспекторов щитов / источников / ИБП.
// -------------------------------------------------------------------------
// v0.59.667: вынесен из panel.js / source.js / ups.js — раньше дублировался
// тремя одинаковыми генераторами HTML. Юзер ранее: «нужны расчёты максимума
// для прохождения сертификации Uptime Institute и расчёты для получения
// ТУ» → блок показывает все промежуточные параметры РТМ для верификации.
//
// API:
//   rtmInfoBlock(n) → string (HTML) или '' если у узла нет downstream-нагрузки.
//
// Цвет блока:
//   зелёный фон (✓) — когда GLOBAL.calcMethod === 'rtm' (активная методика;
//                      именно это значение применяется как _maxLoadKw)
//   серый фон (ℹ)  — когда calcMethod=iec/pue (справочно для отчётов)
// =========================================================================

import { GLOBAL } from '../constants.js';
import { fmt } from '../utils.js';

/**
 * Рендерит блок справки по РТМ 36.18.32.4-92 для узла-агрегатора
 * (panel / source / generator / ups).
 *
 * @param {object} n — узел из state.nodes; должен иметь n._rtmMax (см. recalc.js)
 * @returns {string} HTML строка или '' если данных нет
 */
export function rtmInfoBlock(n) {
  const rtm = n && n._rtmMax;
  if (!rtm || !Number.isFinite(rtm.Pmax) || !(rtm.count > 0)) return '';
  const isActive = (GLOBAL.calcMethod === 'rtm');
  const bg = isActive ? '#e8f5e9' : '#f5f5f5';
  const border = isActive ? '#4caf50' : '#cfd6df';
  const head = isActive
    ? '✓ РТМ 36.18.32.4-92 (активная методика)'
    : 'ℹ РТМ 36.18.32.4-92 (справочно)';
  return `<div class="inspector-section">
    <div style="font-size:11px;padding:6px 8px;background:${bg};border-left:3px solid ${border};border-radius:3px;line-height:1.7">
      <b style="font-size:11px;color:#37474f">${head}</b><br>
      <span class="muted">ЭП в группе:</span> <b>${rtm.count}</b><br>
      <span class="muted">n_э (эфф. число):</span> <b>${rtm.ne ? rtm.ne.toFixed(1) : '—'}</b><br>
      <span class="muted">Ки.ср (средневзв.):</span> <b>${rtm.kuAvg ? rtm.kuAvg.toFixed(3) : '—'}</b><br>
      <span class="muted">Кмакс:</span> <b>${rtm.Kmax ? rtm.Kmax.toFixed(3) : '—'}</b>
      ${rtm.KmaxQ ? ` · Кмакс' (реакт.): <b>${rtm.KmaxQ.toFixed(2)}</b>` : ''}<br>
      <span class="muted">P_ср = Σ Ки×P_ном:</span> <b>${fmt(rtm.Pavg || 0)} kW</b><br>
      <span class="muted">P_макс = Кмакс × P_ср:</span> <b style="color:#1565c0">${fmt(rtm.Pmax || 0)} kW</b><br>
      <span class="muted">Q_макс:</span> <b>${fmt(rtm.Qmax || 0)} kvar</b> ·
      <span class="muted">S_макс:</span> <b>${fmt(rtm.Smax || 0)} kVA</b>
    </div>
  </div>`;
}
