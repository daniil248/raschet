/* shared/calc-widget.js — универсальный калькулятор «заполни известные».
   ─────────────────────────────────────────────────────────────────────
   createCalcCard({ title, desc, formula, fields, solve, precision })
   → HTMLElement

   fields: [{ key, label, unit, placeholder?, precision?, step? }]
   solve(knowns) → { key: value }  — возвращает вычисленные поля.
       knowns — объект { key: number } только для значений, введённых
       пользователем. Функция должна попытаться вычислить как можно больше
       неизвестных (каких — зависит от того, что задано).

   Логика:
     • любое поле, куда пользователь ввёл значение, становится «входом»
       (жёлтая подсветка, data-mode="in");
     • незаполненные поля — «выход» (зелёная подсветка), получают значение
       из solve() и отображаются с точностью precision поля (или карточки);
     • кнопка «Сброс» очищает все вводы.

   Виджет не хранит внутреннее состояние — всё в DOM (data-user="1" на
   input'ах, которые пользователь тронул). Это позволяет динамически
   переключать, какое поле считать известным, просто стирая значение.

   Фокус сохраняется: при обновлении меняем только .value у output-полей,
   input-поля не трогаем.
*/

function fmt(v, precision) {
  if (!Number.isFinite(v)) return '';
  const p = precision ?? 3;
  // trim trailing zeros for readability
  const s = v.toFixed(p);
  return s.replace(/\.?0+$/, '') || '0';
}

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
      <span><span class="sw in"></span>вход (введено)</span>
      <span><span class="sw out"></span>выход (вычислено)</span>
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

  function readKnowns() {
    const obj = {};
    fieldsWrap.querySelectorAll('.calc-field').forEach(wrap => {
      const inp = wrap.querySelector('input');
      if (inp.dataset.user === '1' && inp.value.trim() !== '') {
        const raw = inp.value.replace(',', '.').trim();
        const num = parseFloat(raw);
        if (Number.isFinite(num)) obj[wrap.dataset.key] = num;
      }
    });
    return obj;
  }

  function recompute() {
    const knowns = readKnowns();
    let outs = {};
    try { outs = solve(knowns) || {}; } catch (e) { outs = {}; }

    fieldsWrap.querySelectorAll('.calc-field').forEach(wrap => {
      const key = wrap.dataset.key;
      const fdef = fields.find(f => f.key === key);
      const inp = wrap.querySelector('input');
      const isUser = inp.dataset.user === '1' && inp.value.trim() !== '';

      if (isUser) {
        wrap.dataset.mode = 'in';
        // не трогаем value и не двигаем каретку
      } else if (Object.prototype.hasOwnProperty.call(outs, key) && Number.isFinite(outs[key])) {
        wrap.dataset.mode = 'out';
        const p = fdef.precision ?? precision;
        const newVal = fmt(outs[key], p);
        if (document.activeElement !== inp) inp.value = newVal;
        else if (!isUser) inp.value = newVal;
      } else {
        wrap.dataset.mode = 'empty';
        if (document.activeElement !== inp) inp.value = '';
      }
    });
  }

  fieldsWrap.addEventListener('input', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    e.target.dataset.user = '1';
    recompute();
  });
  // blur: если стало пустым — снимаем флаг пользователя (поле снова может стать выходом)
  fieldsWrap.addEventListener('blur', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    if (e.target.value.trim() === '') {
      e.target.dataset.user = '';
      recompute();
    }
  }, true);

  card.querySelector('.calc-reset').addEventListener('click', () => {
    fieldsWrap.querySelectorAll('input').forEach(i => { i.value = ''; i.dataset.user = ''; });
    recompute();
  });

  // preset support: { key: value, __user: true|false }
  card.setValues = (values, asUser = true) => {
    fieldsWrap.querySelectorAll('.calc-field').forEach(wrap => {
      const inp = wrap.querySelector('input');
      const key = wrap.dataset.key;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        inp.value = fmt(values[key], (fields.find(f=>f.key===key).precision ?? precision));
        inp.dataset.user = asUser ? '1' : '';
      }
    });
    recompute();
  };

  recompute();
  return card;
}

/* Хелпер: собрать группу карточек в контейнер. */
export function mountCalcGroup(container, cards) {
  container.classList.add('calc-group');
  cards.forEach(c => container.appendChild(c));
}
