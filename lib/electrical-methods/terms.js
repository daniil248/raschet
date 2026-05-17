// =========================================================================
// Терминология электротехнических параметров — методико-зависимый lookup
// -------------------------------------------------------------------------
// v0.59.657: для одного и того же физического параметра разные методики
// используют разные обозначения. Юзер: «для терминов которые в разных
// методиках называются по разному, нужно выводить соответствующее
// название. В подсказке к параметру нужно приводить аналоги из других
// методик и отображать краткое разъяснение параметра».
//
// v0.59.658: «термины лучше отнести непосредственно к методикам, в
// отдельных файлах для каждой методики». Терминологические таблицы
// перенесены в:
//   - js/methods/iec.js → TERMS_IEC
//   - js/methods/pue.js → TERMS_PUE
//   - js/methods/rtm.js → TERMS_RTM
// Этот файл — тонкий index, который просто пробрасывает getTerm/...
// в нужную таблицу по methodId.
//
// Семантические ключи параметров:
//   utilization     — Ки / k_u (utilization factor)
//   peakDemand      — Кмакс / К_расч / peak demand factor
//   simultaneity    — Ко / k_s (diversity factor)
//   effectiveCount  — n_э (только в РТМ)
//   powerFactor     — cos φ / PF
//   inrush          — кратность пуска / Ist/In
//
// API:
//   getTerm(key, methodId) → {label, short, explain, aliases, used}
//   getTermTooltip(key, methodId) → строка для атрибута title=
//   isTermUsed(key, methodId) → bool, нужно ли показывать поле в UI
// =========================================================================

import { TERMS_IEC } from './iec.js';
import { TERMS_PUE } from './pue.js';
import { TERMS_RTM } from './rtm.js';

const TERM_TABLES = { iec: TERMS_IEC, pue: TERMS_PUE, rtm: TERMS_RTM };

const _EMPTY_TERM = { label: '', short: '', explain: '', aliases: '', used: true };

/**
 * Получить терминологию для указанного параметра в указанной методике.
 * Если methodId неизвестен — fallback на 'rtm' (как самый детальный
 * по русским терминам, чтобы у юзера всё работало по умолчанию).
 *
 * @param {string} key — семантический ключ параметра
 * @param {string} methodId — 'iec' | 'pue' | 'rtm'
 * @returns {{label:string, short:string, explain:string, aliases:string, used:boolean}}
 */
export function getTerm(key, methodId) {
  const table = TERM_TABLES[methodId] || TERM_TABLES.rtm;
  const term = table[key];
  if (!term) return { ..._EMPTY_TERM, label: key, short: key };
  return term;
}

/** Полный tooltip-текст для поля: explain + aliases */
export function getTermTooltip(key, methodId) {
  const t = getTerm(key, methodId);
  const parts = [];
  if (t.explain) parts.push(t.explain);
  if (t.aliases) parts.push(`Аналоги: ${t.aliases}`);
  return parts.join('. ');
}

/** Используется ли параметр в данной методике (если false — UI скрывает поле) */
export function isTermUsed(key, methodId) {
  return getTerm(key, methodId).used !== false;
}
