// =========================================================================
// Терминология электротехнических параметров по методикам
// -------------------------------------------------------------------------
// v0.59.657: для одного и того же физического параметра разные методики
// используют разные обозначения. Юзер: «для терминов которые в разных
// методиках называются по разному, нужно выводить соответствующее
// название. В подсказке к параметру нужно приводить аналоги из других
// методик и отображать краткое разъяснение параметра».
//
// Юзер также: «поля в электрических параметрах должны быть связаны с
// соответствующей выбранной методикой. Если в IEC нет понятия «Ки» —
// не выводить в карточке».
//
// Каждый ключ — это семантический параметр (utilization, peak-demand и
// т.п.). Для каждой методики возвращаем:
//   label    — короткое название поля как пишется в данной методике
//   short    — буквенное обозначение (Ки, k_u, …)
//   explain  — краткое разъяснение что это такое (1 строка)
//   aliases  — аналоги из других методик (для tooltip)
//   used     — используется ли этот параметр в данной методике (если
//              false — UI должен скрывать поле)
// =========================================================================

const TERMS = {
  // Коэффициент использования
  utilization: {
    rtm: {
      label: 'Ки — коэффициент использования',
      short: 'Ки',
      explain: 'отношение средней активной мощности за наиболее загруженную смену к номинальной (РТМ 36.18.32.4-92, п. 1.3)',
      aliases: 'IEC: utilization factor (k_u); ПУЭ: Ки',
      used: true,
    },
    pue: {
      label: 'Ки — коэффициент использования',
      short: 'Ки',
      explain: 'отношение средней нагрузки к номинальной за рассматриваемый интервал (ПУЭ 7, гл. 1.3)',
      aliases: 'РТМ: Ки; IEC: utilization factor (k_u)',
      used: true,
    },
    iec: {
      label: 'k_u — utilization factor',
      short: 'k_u',
      explain: 'доля от номинальной мощности, фактически используемая ЭП (IEC 60364-1, §4)',
      aliases: 'РТМ/ПУЭ: Ки (коэффициент использования)',
      used: true,
    },
  },

  // Коэффициент максимума (peak demand factor) — только в РТМ берётся из таблицы;
  // в IEC/ПУЭ принимается «по практике проектирования», явного поля нет.
  peakDemand: {
    rtm: {
      label: 'Кмакс — коэффициент максимума',
      short: 'Кмакс',
      explain: 'из таблицы РТМ 36.18.32.4-92 (приложение 2) по n_э и Ки.ср; авто-расчёт',
      aliases: 'IEC: peak demand factor; ПУЭ: К расч',
      used: true,
    },
    pue: {
      label: 'К расч — коэффициент расчётной нагрузки',
      short: 'К_расч',
      explain: 'отношение получасового максимума к среднесменной нагрузке',
      aliases: 'РТМ: Кмакс; IEC: peak demand factor',
      used: false, // обычно не задаётся юзером явно — только в РТМ
    },
    iec: {
      label: 'peak demand factor',
      short: 'k_pd',
      explain: 'отношение пикового получасового спроса к средней нагрузке',
      aliases: 'РТМ: Кмакс; ПУЭ: К_расч',
      used: false,
    },
  },

  // Коэффициент одновременности / diversity factor
  simultaneity: {
    rtm: {
      label: 'Ко — коэффициент одновременности',
      short: 'Ко',
      explain: 'учитывает что не все ЭП работают одновременно с пиком; в РТМ обычно зашит в Кмакс',
      aliases: 'IEC: diversity factor (k_s); ПУЭ: Ко',
      used: false, // в РТМ зашит в Кмакс
    },
    pue: {
      label: 'Ко — коэффициент одновременности',
      short: 'Ко',
      explain: 'отношение совмещённого максимума к сумме индивидуальных максимумов',
      aliases: 'IEC: diversity factor (k_s); РТМ: Ко',
      used: true,
    },
    iec: {
      label: 'k_s — diversity factor',
      short: 'k_s',
      explain: 'учитывает что не все нагрузки достигают пика одновременно (IEC 60364-1, §4)',
      aliases: 'РТМ/ПУЭ: Ко (коэффициент одновременности)',
      used: true,
    },
  },

  // Эффективное число ЭП — РТМ-специфичный параметр
  effectiveCount: {
    rtm: {
      label: 'n_э — эффективное число ЭП',
      short: 'n_э',
      explain: 'фиктивное число одинаковых ЭП с равной мощностью, дающих ту же сумму квадратов: n_э = (Σ P_ном)² / Σ(P_ном²)',
      aliases: 'IEC/ПУЭ: явно не используется',
      used: true,
    },
    pue: { label: '', short: '', explain: '', aliases: '', used: false },
    iec: { label: '', short: '', explain: '', aliases: '', used: false },
  },

  // cos φ — универсально
  powerFactor: {
    rtm: { label: 'cos φ', short: 'cos φ', explain: 'коэффициент мощности — отношение активной мощности к полной (P/S)', aliases: 'IEC: power factor (PF)', used: true },
    pue: { label: 'cos φ', short: 'cos φ', explain: 'коэффициент мощности (P/S)', aliases: 'IEC: power factor (PF)', used: true },
    iec: { label: 'cos φ (power factor)', short: 'PF', explain: 'ratio of active to apparent power (P/S)', aliases: 'РТМ/ПУЭ: cos φ', used: true },
  },

  // Кратность пускового тока (inrush)
  inrush: {
    rtm: { label: 'Кратность пускового тока', short: 'Iпуск/Iном', explain: 'во сколько раз пусковой ток больше номинального (для двигателей 5–7)', aliases: 'IEC: starting current ratio (Ist/In)', used: true },
    pue: { label: 'Кратность пускового тока', short: 'Iпуск/Iном', explain: 'во сколько раз пусковой ток больше номинального', aliases: 'IEC: starting current ratio (Ist/In)', used: true },
    iec: { label: 'Starting current ratio (Ist/In)', short: 'Ist/In', explain: 'inrush current as multiple of rated current', aliases: 'РТМ/ПУЭ: кратность пускового тока', used: true },
  },
};

/**
 * Получить терминологию для указанного параметра в указанной методике.
 * Если methodId неизвестен — fallback на 'rtm' (как самый детальный
 * по русским терминам, чтобы у юзера всё работало по умолчанию).
 *
 * @param {string} key — семантический ключ параметра (utilization,
 *                       peakDemand, simultaneity, effectiveCount,
 *                       powerFactor, inrush)
 * @param {string} methodId — 'iec' | 'pue' | 'rtm'
 * @returns {{label:string, short:string, explain:string, aliases:string, used:boolean}}
 */
export function getTerm(key, methodId) {
  const def = TERMS[key];
  if (!def) return { label: key, short: key, explain: '', aliases: '', used: true };
  return def[methodId] || def.rtm || def.pue || def.iec
      || { label: key, short: key, explain: '', aliases: '', used: true };
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
