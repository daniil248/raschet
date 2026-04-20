// ======================================================================
// shared/protection-wizard.js
// v0.57.59 — Мастер подбора защитного аппарата (автомат / предохранитель).
//
// Вызывается из инспектора связи (js/engine/inspector/conn.js) по
// кнопке «🧙 Мастер подбора». Принимает контекст линии (ток, тип
// нагрузки, длина и т.п.) и колбэк onApply, которому передаёт выбранный
// protectionKind + curve/fuseType.
//
// Модалка состоит из 4 вопросов:
//   1. Тип нагрузки (общая / двигатель / трансформатор / электроника /
//      ДГУ/ИБП-вход)
//   2. Требования (remote trip, регулируемые уставки, быстрое reset)
//   3. Критична ли стоимость
//   4. Вариант координации (коробки IEC 60364-4-41 vs IT/TT систем)
//
// На основе ответов вычисляется рекомендация:
//   - protectionKind: 'breaker' | 'fuse'
//   - breakerCurve: 'MCB_B' | 'MCB_C' | 'MCB_D' | 'MCCB' | 'ACB'
//   - fuseType:     'gG' | 'aM' | 'gM'
//
// Показывает обоснование выбора. Пользователь может согласиться
// (применить) или вручную переопределить перед применением.
// ======================================================================

const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Открывает модалку мастера подбора защиты.
 *
 * @param {Object} ctx — контекст линии
 *   { Ib: number, Iz: number, currentKind: 'breaker'|'fuse',
 *     currentCurve: string, currentFuseType: string,
 *     loadHint: string (тип нагрузки из toN.type, для pre-select) }
 * @param {Function} onApply — (result) => void
 *   result = { protectionKind, breakerCurve?, fuseType?, reasoning }
 */
export function openProtectionWizard(ctx, onApply) {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.25);width:min(620px,95vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e1e4e8;flex-shrink:0">
      <h3 style="margin:0;font-size:14px;font-weight:600;flex:1">🧙 Мастер подбора защиты</h3>
      <button type="button" data-pw-close style="border:1px solid #ccc;background:#f6f8fa;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:13px">✕</button>
    </div>
    <div style="flex:1;overflow:auto;padding:14px 16px;font-size:12px;line-height:1.5">
      <div style="margin-bottom:8px;padding:8px 10px;background:#eef5ff;border:1px solid #bbdefb;border-radius:4px;color:#1565c0;font-size:11px">
        <b>Контекст линии:</b> I<sub>расч</sub> ≈ <b>${ctx.Ib?.toFixed?.(1) || '—'}</b> А,
        I<sub>z</sub> кабеля = <b>${ctx.Iz?.toFixed?.(0) || '—'}</b> А.
        Текущий выбор: <b>${ctx.currentKind === 'fuse' ? 'Предохранитель ' + (ctx.currentFuseType || 'gG') : 'Автомат ' + (ctx.currentCurve || 'MCB_C')}</b>.
      </div>

      <div class="pw-q" style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">1. Тип нагрузки</div>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-load" value="general" checked> Общая (освещение, розетки, распределение, АВР)</label>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-load" value="motor"> Двигатель (пуск 6-8×I<sub>n</sub>, 3-10 с)</label>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-load" value="transformer"> Трансформатор (inrush 10-12×I<sub>n</sub>, 0.1-0.5 с)</label>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-load" value="electronics"> Чувствительная электроника (сервер, медицина)</label>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-load" value="generator"> Ввод от ДГУ / ИБП (требует селективности с сетью)</label>
      </div>

      <div class="pw-q" style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">2. Требования к аппарату (можно несколько)</div>
        <label style="display:block;padding:3px 0"><input type="checkbox" name="pw-req" value="remote"> Дистанционное отключение / управление</label>
        <label style="display:block;padding:3px 0"><input type="checkbox" name="pw-req" value="adjustable"> Регулируемые уставки (Ir/Isd/tsd/Ii)</label>
        <label style="display:block;padding:3px 0"><input type="checkbox" name="pw-req" value="fastReset"> Быстрое повторное включение (за секунды, без замены)</label>
        <label style="display:block;padding:3px 0"><input type="checkbox" name="pw-req" value="highIcu"> Высокая отключающая способность (I<sub>cu</sub> &gt; 50 кА)</label>
      </div>

      <div class="pw-q" style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">3. Приоритет по стоимости</div>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-cost" value="normal" checked> Стандартный (выбрать надёжное решение)</label>
        <label style="display:block;padding:3px 0"><input type="radio" name="pw-cost" value="budget"> Экономия (допустимо простое решение с заменой элемента)</label>
      </div>

      <div id="pw-result" style="margin-top:14px;padding:10px 12px;background:#e8f5e9;border:1px solid #81c784;border-radius:4px;font-size:12px;line-height:1.6;color:#1b5e20"></div>
    </div>
    <div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid #e1e4e8;flex-shrink:0;justify-content:flex-end">
      <button type="button" data-pw-close style="border:1px solid #ccc;background:#f6f8fa;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px">Отмена</button>
      <button type="button" data-pw-apply style="border:1px solid #1976d2;background:#1976d2;color:#fff;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600">Применить рекомендацию</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Pre-select по toN.type
  if (ctx.loadHint === 'motor') modal.querySelector('input[name="pw-load"][value="motor"]').checked = true;
  else if (ctx.loadHint === 'transformer') modal.querySelector('input[name="pw-load"][value="transformer"]').checked = true;
  else if (ctx.loadHint === 'generator' || ctx.loadHint === 'ups') modal.querySelector('input[name="pw-load"][value="generator"]').checked = true;

  const resultBox = modal.querySelector('#pw-result');
  let current = null;

  const recalc = () => {
    const load = modal.querySelector('input[name="pw-load"]:checked')?.value || 'general';
    const reqs = new Set([...modal.querySelectorAll('input[name="pw-req"]:checked')].map(i => i.value));
    const cost = modal.querySelector('input[name="pw-cost"]:checked')?.value || 'normal';
    current = computeRecommendation({ Ib: ctx.Ib, Iz: ctx.Iz, load, reqs, cost });
    resultBox.innerHTML = _renderRecommendation(current);
  };

  modal.querySelectorAll('input').forEach(inp => inp.addEventListener('change', recalc));
  recalc();

  const close = () => { try { document.body.removeChild(backdrop); } catch {} };
  modal.querySelectorAll('[data-pw-close]').forEach(b => b.addEventListener('click', close));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  modal.querySelector('[data-pw-apply]').addEventListener('click', () => {
    if (current && typeof onApply === 'function') onApply(current);
    close();
  });
}

/**
 * Чистая функция подсчёта рекомендации.
 * Возвращает { protectionKind, breakerCurve?, fuseType?, reasoning: [] }
 */
export function computeRecommendation({ Ib, Iz, load, reqs, cost }) {
  const In = Number(Ib) || 0;
  const reasoning = [];
  const needAdjust = reqs.has('adjustable');
  const needRemote = reqs.has('remote');
  const needFastReset = reqs.has('fastReset');
  const needHighIcu = reqs.has('highIcu');
  const budget = cost === 'budget';

  // 1) Если требуются функции, доступные ТОЛЬКО автомату — сразу breaker
  if (needRemote || needAdjust || needFastReset) {
    reasoning.push('Требуются функции автомата: ' +
      [needRemote && 'дистанционное управление', needAdjust && 'регулируемые уставки',
       needFastReset && 'быстрое повторное включение'].filter(Boolean).join(', ') + '.');
    return _pickBreaker({ In, load, needAdjust, needHighIcu, reasoning });
  }

  // 2) Высокий Icu часто закрывается предохранителем (gG до 120 кА)
  if (needHighIcu && !needAdjust) {
    reasoning.push('Предохранители gG имеют I<sub>cu</sub> до 100-120 кА из коробки — часто дешевле MCCB той же категории.');
    if (load === 'motor') return _pickFuse('aM', reasoning, In);
    return _pickFuse('gG', reasoning, In);
  }

  // 3) Бюджетное решение + малый ток → fuse привлекателен
  if (budget && In <= 100) {
    reasoning.push('Бюджетный режим + I<sub>расч</sub> ≤ 100 А: плавкая вставка дешевле MCB того же номинала и не требует обслуживания.');
    if (load === 'motor') { reasoning.push('aM — «моторная» характеристика (устойчива к пуску, быстрая при КЗ).'); return _pickFuse('aM', reasoning, In); }
    if (load === 'transformer') { reasoning.push('gG подходит: inrush длиннее пуска двигателя, но короче порога gG.'); return _pickFuse('gG', reasoning, In); }
    if (load === 'electronics') { reasoning.push('Для электроники всё-таки выбран MCB B (точнее отключает и быстрее восстанавливается).');
      return _pickBreaker({ In, load, needAdjust: false, needHighIcu: false, reasoning }); }
    return _pickFuse('gG', reasoning, In);
  }

  // 4) Ввод ДГУ / ИБП — селективность с сетью критична, нужен MCCB/ACB
  if (load === 'generator') {
    reasoning.push('Ввод от резервного источника: требуется селективность нижних уровней и возможность сопрячь tsd с уставками генератора. Только регулируемый автомат.');
    return _pickBreaker({ In, load, needAdjust: true, needHighIcu, reasoning });
  }

  // 5) По умолчанию — автомат, кривая по типу нагрузки
  reasoning.push('Стандартная рекомендация для данного тока и типа нагрузки.');
  return _pickBreaker({ In, load, needAdjust, needHighIcu, reasoning });
}

function _pickBreaker({ In, load, needAdjust, needHighIcu, reasoning }) {
  let curve;
  // v0.57.90: порог MCCB → ACB поднят с 1600 до 3200 А (Schneider ComPacT NS
  // до 3200 А, ABB Tmax до 2500 А — классический MCCB-диапазон по IEC 60947-2).
  if (In > 3200 || needHighIcu) { curve = 'ACB'; reasoning.push('I<sub>расч</sub> &gt; 3200 А или требуется высокий I<sub>cu</sub> → ACB.'); }
  else if (In > 125 || needAdjust) {
    curve = 'MCCB';
    reasoning.push(In > 125
      ? 'I<sub>расч</sub> &gt; 125 А → MCCB (адаптивный, регулируемый).'
      : 'Нужны регулируемые уставки → MCCB.');
  }
  else if (load === 'motor' || load === 'transformer') {
    curve = 'MCB_D';
    reasoning.push(load === 'motor'
      ? 'Двигатель: MCB кривой D (порог мгн. 10-20×I<sub>n</sub>) не срабатывает при пуске.'
      : 'Трансформатор: MCB кривой D выдерживает inrush.');
  }
  else if (load === 'electronics') {
    curve = 'MCB_B';
    reasoning.push('Чувствительная электроника: MCB кривой B (3-5×I<sub>n</sub>) быстрее отключает при КЗ, снижает уровень помех.');
  }
  else {
    curve = 'MCB_C';
    reasoning.push('Общая нагрузка: MCB кривой C (5-10×I<sub>n</sub>) — стандарт для распределения.');
  }
  return {
    protectionKind: 'breaker',
    breakerCurve: curve,
    fuseType: null,
    reasoning,
  };
}

function _pickFuse(ftype, reasoning, In) {
  reasoning.push(ftype === 'aM'
    ? 'aM: class «motor» — не срабатывает при пуске двигателя, быстрая при КЗ.'
    : ftype === 'gM'
    ? 'gM: комбинированная — защита линии + моторная характеристика (редко применяется).'
    : 'gG: общего назначения — защита линий и кабелей от перегрузки и КЗ.');
  if (In > 630) reasoning.push('Предохранители NH размера > 3 (номинал &gt; 630 А) редки; при возможности увеличьте сечение или перейдите на MCCB.');
  return {
    protectionKind: 'fuse',
    breakerCurve: null,
    fuseType: ftype,
    reasoning,
  };
}

function _renderRecommendation(r) {
  const device = r.protectionKind === 'fuse'
    ? `<b>Предохранитель ${_esc(r.fuseType)}</b> (FU, IEC 60269)`
    : `<b>Автомат ${_esc(r.breakerCurve || 'MCB_C')}</b> (QF, IEC ${r.breakerCurve?.startsWith('MCB') ? '60898' : '60947-2'})`;
  const why = r.reasoning.map(s => `<li>${s}</li>`).join('');
  return `<div><b>Рекомендация:</b> ${device}</div>
    <ul style="margin:6px 0 0 16px;padding:0;font-size:11px">${why}</ul>`;
}
