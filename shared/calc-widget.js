/* shared/calc-widget.js — универсальные калькуляторы «заполни известные → получи неизвестные».
   ─────────────────────────────────────────────────────────────────────
   Экспортирует две фабрики:

   1) createCalcCard({ title, desc, formula, fields, solve, precision })
      Одиночная карточка с независимым набором полей.

   2) createMultiCalc({ title, desc, groups, fields, solve })
      Единый калькулятор с несколькими группами параметров.
      • groups: [{ id, title, keys:[...], coreSize: N }] — coreSize задаёт
        сколько user-введённых полей группа «удерживает» как known. Если
        пользователь вводит больше — самый старый ввод понижается до auto.
      • fields: { key: { label, unit, precision, placeholder, hint } }
      • solve(knowns, lockedSet) → { key: value } — возвращает выходы.
      Поведение:
        ◦ у каждого поля чекбокс 🔒 — фиксирует значение (иммунитет к
          вытеснению, всегда в knowns);
        ◦ клик по полю с вычисленным значением оставляет это значение в
          input'е; пользователь может редактировать с текущего числа
          (стрелки / ввод) — ввод сразу делает поле известным;
        ◦ blur с пустым значением снимает флаг user (поле снова auto).

   Общая утилита форматирования; input value никогда не перезаписывается
   пока поле в фокусе и пользователь в нём печатает.
*/

function fmt(v, precision) {
  if (!Number.isFinite(v)) return '';
  const p = precision ?? 3;
  const s = v.toFixed(p);
  return s.replace(/\.?0+$/, '') || '0';
}

/* ========================================================================
   createCalcCard — одиночная карточка (legacy, оставлена для совместимости)
   ======================================================================== */
export function createCalcCard(cfg) {
  const { title, desc, formula, fields, solve, precision = 3 } = cfg;
  const card = document.createElement('div');
  card.className = 'calc-card';
  card.innerHTML = `
    <div class="calc-card-title">
      <span>${title}</span>
      <button type="button" class="calc-reset" title="Очистить все поля">Сброс</button>
    </div>
    ${desc ? `<div class="calc-card-desc">${desc}</div>` : ''}
    ${formula ? `<div class="calc-card-formula">${formula}</div>` : ''}
    <div class="calc-fields"></div>
    <div class="calc-card-legend">
      <span><span class="sw in"></span>вход</span>
      <span><span class="sw out"></span>вычислено</span>
    </div>
  `;
  const fieldsWrap = card.querySelector('.calc-fields');
  fields.forEach(f => {
    const wrap = document.createElement('label');
    wrap.className = 'calc-field';
    wrap.dataset.mode = 'empty';
    wrap.dataset.key = f.key;
    wrap.innerHTML = `
      <span class="calc-field-lbl">${f.label}${f.unit ? ` <em>${f.unit}</em>` : ''}</span>
      <input type="text" inputmode="decimal" placeholder="${f.placeholder || ''}" autocomplete="off">
      ${f.hint ? `<span class="calc-hint">${f.hint}</span>` : ''}
    `;
    fieldsWrap.appendChild(wrap);
  });
  const readKnowns = () => {
    const obj = {};
    fieldsWrap.querySelectorAll('.calc-field').forEach(wrap => {
      const inp = wrap.querySelector('input');
      if (inp.dataset.user === '1' && inp.value.trim() !== '') {
        const num = parseFloat(inp.value.replace(',', '.').trim());
        if (Number.isFinite(num)) obj[wrap.dataset.key] = num;
      }
    });
    return obj;
  };
  const recompute = () => {
    let outs = {};
    try { outs = solve(readKnowns()) || {}; } catch (e) { outs = {}; }
    fieldsWrap.querySelectorAll('.calc-field').forEach(wrap => {
      const key = wrap.dataset.key;
      const fdef = fields.find(f => f.key === key);
      const inp = wrap.querySelector('input');
      const isUser = inp.dataset.user === '1' && inp.value.trim() !== '';
      if (isUser) { wrap.dataset.mode = 'in'; return; }
      if (Object.prototype.hasOwnProperty.call(outs, key) && Number.isFinite(outs[key])) {
        wrap.dataset.mode = 'out';
        const newVal = fmt(outs[key], fdef.precision ?? precision);
        if (document.activeElement !== inp) inp.value = newVal;
        else if (!isUser) inp.value = newVal;
      } else {
        wrap.dataset.mode = 'empty';
        if (document.activeElement !== inp) inp.value = '';
      }
    });
  };
  fieldsWrap.addEventListener('input', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    e.target.dataset.user = '1'; recompute();
  });
  fieldsWrap.addEventListener('blur', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    if (e.target.value.trim() === '') { e.target.dataset.user = ''; recompute(); }
  }, true);
  card.querySelector('.calc-reset').addEventListener('click', () => {
    fieldsWrap.querySelectorAll('input').forEach(i => { i.value = ''; i.dataset.user = ''; });
    recompute();
  });
  recompute();
  return card;
}
export function mountCalcGroup(container, cards) {
  container.classList.add('calc-group');
  cards.forEach(c => container.appendChild(c));
}

/* ========================================================================
   createMultiCalc — единый калькулятор с группами и cross-group связями.
   ======================================================================== */
export function createMultiCalc({ title, desc, groups, fields, solve }) {
  const card = document.createElement('div');
  card.className = 'calc-card calc-multi';
  card.innerHTML = `
    <div class="calc-card-title">
      <span>${title}</span>
      <button type="button" class="calc-reset" title="Снять все вводы и блокировки">Очистить всё</button>
    </div>
    ${desc ? `<div class="calc-card-desc">${desc}</div>` : ''}
    <div class="calc-multi-body"></div>
    <div class="calc-card-legend">
      <span><span class="sw in"></span>ввод</span>
      <span><span class="sw out"></span>вычислено</span>
      <span><span class="sw locked"></span>🔒 зафиксировано</span>
      <span style="margin-left:auto;color:#607080">Чекбокс 🔒 — запретить пересчёт поля.</span>
    </div>
  `;
  const body = card.querySelector('.calc-multi-body');

  /* мета: per key */
  const meta = {};          // { key: { user, locked, ts, group } }
  const allKeys = [];

  /* построение DOM */
  groups.forEach(g => {
    const block = document.createElement('div');
    block.className = 'calc-group-block';
    block.innerHTML = `
      <div class="calc-group-title">${g.title}</div>
      <div class="calc-fields"></div>
    `;
    const fw = block.querySelector('.calc-fields');
    g.keys.forEach(key => {
      const f = fields[key];
      if (!f) return;
      meta[key] = { user: false, locked: false, ts: 0, group: g.id };
      allKeys.push(key);
      const wrap = document.createElement('div');
      wrap.className = 'calc-field';
      wrap.dataset.mode = 'empty';
      wrap.dataset.key = key;
      wrap.dataset.group = g.id;
      const ro = !!f.readOnly;
      wrap.innerHTML = `
        <span class="calc-field-lbl">${f.label}${f.unit ? ` <em>${f.unit}</em>` : ''}</span>
        <div class="calc-field-row">
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="${f.placeholder || ''}"${ro?' readonly tabindex="-1"':''}>
          ${ro ? '' : `<label class="calc-lock-wrap" title="Зафиксировать значение">
            <input type="checkbox" class="calc-field-lock">
            <span>🔒</span>
          </label>`}
        </div>
        ${f.hint ? `<span class="calc-hint">${f.hint}</span>` : ''}
      `;
      if (ro) { meta[key].readOnly = true; wrap.dataset.mode = 'ro'; }
      fw.appendChild(wrap);
    });
    body.appendChild(block);
  });

  /* Внешние known'ы — для read-only полей, куда значения приходят из
     главного модуля (P, h и т.п.). Пишется через card.setExternalKnowns(). */
  const externalKnowns = {};

  /* собрать knowns с учётом coreSize групп. Locked всегда в knowns. */
  function readKnowns() {
    const rawUser = {};    // key → {num, ts}
    const lockedKnown = { ...externalKnowns };
    const lockedSet = new Set();
    allKeys.forEach(key => {
      if (meta[key].readOnly) return;  // read-only поля не являются known от пользователя
      const wrap = body.querySelector(`[data-key="${key}"]`);
      const inp = wrap.querySelector('input[inputmode="decimal"]');
      const val = inp.value.trim().replace(',', '.');
      const num = parseFloat(val);
      if (val === '' || !Number.isFinite(num)) return;
      if (meta[key].locked) { lockedKnown[key] = num; lockedSet.add(key); return; }
      if (meta[key].user)   { rawUser[key] = { num, ts: meta[key].ts }; }
    });
    // per-group truncation (кроме locked)
    const knowns = { ...lockedKnown };
    groups.forEach(g => {
      if (!g.coreSize || g.coreSize <= 0) return;
      const userInGroup = g.keys
        .filter(k => rawUser[k] !== undefined && !lockedSet.has(k))
        .sort((a, b) => rawUser[b].ts - rawUser[a].ts);
      const kept = userInGroup.slice(0, g.coreSize);
      const dropped = userInGroup.slice(g.coreSize);
      kept.forEach(k => { knowns[k] = rawUser[k].num; });
      dropped.forEach(k => { meta[k].user = false; meta[k].ts = 0; });
    });
    // Для групп без coreSize — все user в knowns
    groups.forEach(g => {
      if (g.coreSize) return;
      g.keys.forEach(k => {
        if (rawUser[k] !== undefined && !lockedSet.has(k)) knowns[k] = rawUser[k].num;
      });
    });
    return { knowns, lockedSet };
  }

  function recompute() {
    const { knowns, lockedSet } = readKnowns();
    let outs = {};
    try { outs = solve(knowns, lockedSet) || {}; } catch (e) { outs = {}; }

    allKeys.forEach(key => {
      const wrap = body.querySelector(`[data-key="${key}"]`);
      const inp = wrap.querySelector('input[inputmode="decimal"]');
      const lockCb = wrap.querySelector('.calc-field-lock');
      const f = fields[key];
      const focused = document.activeElement === inp;

      if (meta[key].readOnly) {
        wrap.dataset.mode = 'ro';
        if (Object.prototype.hasOwnProperty.call(outs, key) && Number.isFinite(outs[key])) {
          inp.value = fmt(outs[key], f.precision ?? 3);
        }
      } else if (meta[key].locked) {
        wrap.dataset.mode = 'locked';
        // value — пользовательский, не трогаем
      } else if (meta[key].user && inp.value.trim() !== '') {
        wrap.dataset.mode = 'in';
      } else if (Object.prototype.hasOwnProperty.call(outs, key) && Number.isFinite(outs[key])) {
        wrap.dataset.mode = 'out';
        const newVal = fmt(outs[key], f.precision ?? 3);
        // Обновляем value даже если поле сфокусировано (но пока не редактируется).
        // «Редактируется» = meta[key].user. Если user ещё не ввёл, .value
        // обновляется, чтобы пользователь мог начать редактировать с актуального
        // вычисленного числа (стрелки/клавиатура).
        if (!meta[key].user) inp.value = newVal;
      } else {
        wrap.dataset.mode = 'empty';
        if (!focused && !meta[key].user) inp.value = '';
      }
      if (lockCb) lockCb.checked = meta[key].locked;
    });
  }

  body.addEventListener('input', (e) => {
    if (!e.target.matches('input[inputmode="decimal"]')) return;
    const wrap = e.target.closest('.calc-field');
    const key = wrap.dataset.key;
    if (meta[key].locked) return;  // locked не меняем через input
    meta[key].user = true;
    meta[key].ts = performance.now();
    recompute();
  });

  body.addEventListener('change', (e) => {
    if (!e.target.classList.contains('calc-field-lock')) return;
    const wrap = e.target.closest('.calc-field');
    const key = wrap.dataset.key;
    const inp = wrap.querySelector('input[inputmode="decimal"]');
    if (e.target.checked) {
      // Фиксируем: если значение пустое — нечего фиксировать
      if (inp.value.trim() === '') {
        e.target.checked = false;
        return;
      }
      meta[key].locked = true;
      meta[key].user = false;  // locked не дублирует user
      meta[key].ts = performance.now();
    } else {
      meta[key].locked = false;
      // Оставляем значение как «ввод» (чтобы не пропало)
      if (inp.value.trim() !== '') {
        meta[key].user = true;
        meta[key].ts = performance.now();
      }
    }
    recompute();
  });

  body.addEventListener('blur', (e) => {
    if (!e.target.matches('input[inputmode="decimal"]')) return;
    if (e.target.value.trim() === '') {
      const wrap = e.target.closest('.calc-field');
      const key = wrap.dataset.key;
      if (!meta[key].locked) {
        meta[key].user = false;
        meta[key].ts = 0;
        recompute();
      }
    }
  }, true);

  card.querySelector('.calc-reset').addEventListener('click', () => {
    allKeys.forEach(key => {
      if (meta[key].readOnly) return;  // read-only не сбрасываем
      meta[key].user = false;
      meta[key].locked = false;
      meta[key].ts = 0;
      const wrap = body.querySelector(`[data-key="${key}"]`);
      wrap.querySelector('input[inputmode="decimal"]').value = '';
      const lcb = wrap.querySelector('.calc-field-lock');
      if (lcb) lcb.checked = false;
    });
    recompute();
  });

  /* Установить значения read-only полей извне (из главного модуля). */
  card.setExternalKnowns = (obj) => {
    Object.assign(externalKnowns, obj || {});
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (!meta[k]) return;
      const wrap = body.querySelector(`[data-key="${k}"]`);
      const inp  = wrap && wrap.querySelector('input[inputmode="decimal"]');
      if (inp && Number.isFinite(v) && meta[k].readOnly) {
        inp.value = fmt(v, fields[k].precision ?? 3);
      }
    });
    recompute();
  };

  card.setValues = (values, mode = 'user') => {
    Object.entries(values).forEach(([key, num]) => {
      if (!meta[key]) return;
      const wrap = body.querySelector(`[data-key="${key}"]`);
      const inp = wrap.querySelector('input[inputmode="decimal"]');
      inp.value = fmt(num, fields[key].precision ?? 3);
      if (mode === 'locked') { meta[key].locked = true; meta[key].user = false; }
      else { meta[key].user = true; meta[key].locked = false; }
      meta[key].ts = performance.now();
    });
    recompute();
  };

  recompute();
  return card;
}
