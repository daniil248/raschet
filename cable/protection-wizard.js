// ======================================================================
// cable/protection-wizard.js
// Помощник заполнения параметров КЗ и защиты в модуле «Расчёт кабельной
// линии». Через 4 типовых вопроса получает достаточно данных, чтобы
// правдоподобно заполнить Ik (кА), tk (с), характеристику автомата и
// систему заземления.
//
// Для пользователя, который не знает эти параметры наизусть — wizard
// даёт разумные значения по умолчанию вместо нулей или гаданий.
//
// Логика подбора:
//  - Ik (ток КЗ) — зависит от источника питания + расстояния:
//      ТП мощная + близко         → 15-20 кА
//      ТП средняя + близко        → 8-12 кА
//      ТП средняя + далеко        → 3-6 кА
//      Этажный/групповой          → 1-3 кА
//      Генератор (автономно)      → 2-6 кА
//      ИБП на выходе              → 2-5 кА
//  - tk (время отключения) — по типу автомата и ПУЭ 1.7.79:
//      MCB групповой (до 32 А)    → 0.1-0.2 с
//      MCCB щита/распред.         → 0.2-0.4 с
//      ACB вводной                → 0.4-1.0 с
//  - Характеристика автомата — по типу нагрузки:
//      Освещение LED, розетки     → MCB B (×5)
//      Обычная смешанная нагрузка → MCB C (×10)
//      Двигатели, компрессоры     → MCB D (×20)
//      Промышленность, транзормат.→ MCCB
//  - Система заземления — по источнику:
//      Городская сеть (РФ)        → TN-C-S
//      Новая ТП (после 2009)      → TN-S
//      Автономный генератор       → TN-S или IT
//      Частный дом со штырём      → TT
// ======================================================================

const STEPS = [
  {
    id: 'source',
    question: 'Что питает эту линию?',
    hint: 'Выберите основной источник электроэнергии для этой кабельной линии.',
    options: [
      { value: 'utility-strong', title: 'Городская сеть, крупный потребитель (от 400 кВА)', desc: 'Многоквартирный дом, офисный/торговый центр, предприятие' },
      { value: 'utility-medium', title: 'Городская сеть, обычный потребитель (до 250 кВА)', desc: 'Небольшое здание, магазин, частный дом с 3-фазным вводом' },
      { value: 'utility-small', title: 'Городская сеть, бытовая нагрузка (до 15 кВт)', desc: 'Квартира, дача, одна группа розеток / освещения' },
      { value: 'generator', title: 'Автономный генератор (ДГУ)', desc: 'Резервное или основное питание от дизель-генератора' },
      { value: 'ups', title: 'Выход ИБП', desc: 'Линия после источника бесперебойного питания' },
      { value: 'transformer-own', title: 'Собственная ТП (КТП / БКТП)', desc: 'Своя трансформаторная подстанция на объекте' },
    ],
  },
  {
    id: 'distance',
    question: 'Где находится автомат защиты этой линии?',
    hint: 'Расстояние от источника (ТП / вводного распредщита) до этого автомата влияет на ток КЗ.',
    options: [
      { value: 'near', title: 'Вводной / главный щит (рядом с источником)', desc: 'До 10 м кабелем от ТП или вводной панели' },
      { value: 'medium', title: 'Распределительный щит (этажный, цеховой)', desc: '10–100 м кабелем от источника' },
      { value: 'far', title: 'Групповой щит / удалённый потребитель', desc: 'Более 100 м или через несколько этажей' },
      { value: 'veryfar', title: 'Конечный потребитель (розетка, светильник)', desc: 'Групповая линия, последний автомат перед нагрузкой' },
    ],
  },
  {
    id: 'load',
    question: 'Какой тип нагрузки на линии?',
    hint: 'Тип определяет характеристику автомата (пусковой ток). От этого зависит кривая отключения.',
    options: [
      { value: 'lighting', title: 'Освещение, розетки, электроника', desc: 'LED, люминесцентные, бытовая электроника, небольшие нагрузки без пуска' },
      { value: 'mixed', title: 'Смешанная нагрузка', desc: 'Комбинация освещения, розеток, мелких бытовых приборов (стандартный выбор)' },
      { value: 'motor', title: 'Двигатели, насосы, компрессоры', desc: 'Нагрузки с большим пусковым током (кратность пуска 5–7×In)' },
      { value: 'industrial', title: 'Промышленная / сварочная', desc: 'Станки, трансформаторы, сварочные аппараты, мощные моторы' },
    ],
  },
  {
    id: 'grounding',
    question: 'Система заземления объекта?',
    hint: 'Влияет на расчёт петли «фаза-ноль» и требования к УЗО.',
    options: [
      { value: 'tn-c-s', title: 'TN-C-S (городская сеть РФ, Казахстан, СНГ)', desc: 'Старый стандарт: совмещённый PEN до ввода, далее разделение на N и PE. Стандартный для РФ.' },
      { value: 'tn-s', title: 'TN-S (современная, раздельные N и PE)', desc: 'Новые ТП (после 2009 г.), коммерческие ЦОД, серверные, ЛПУ' },
      { value: 'tt', title: 'TT (местный контур заземления)', desc: 'Частный дом со своим заземлителем, без PE от сети' },
      { value: 'it', title: 'IT (изолированная нейтраль)', desc: 'Медицина, химия, судостроение — нейтраль не заземлена' },
      { value: 'tn-c', title: 'TN-C (устаревшая, без PE)', desc: 'Объекты до 1995 г., не рекомендуется для новых проектов' },
    ],
  },
];

// Таблица подбора Ik (кА) — (source × distance)
const IK_TABLE = {
  'utility-strong':  { near: 20, medium: 10, far: 5, veryfar: 2 },
  'utility-medium':  { near: 12, medium: 6, far: 3, veryfar: 1.5 },
  'utility-small':   { near: 6, medium: 3, far: 1.5, veryfar: 1 },
  'generator':       { near: 6, medium: 3, far: 2, veryfar: 1 },
  'ups':             { near: 5, medium: 3, far: 2, veryfar: 1 },
  'transformer-own': { near: 25, medium: 12, far: 6, veryfar: 2.5 },
};

// Время отключения tk (с) — по расстоянию (грубо — selectivity с upstream)
const TK_TABLE = {
  near:    0.4,  // вводной — селективность вверх
  medium:  0.2,  // распредщит
  far:     0.15, // групповой
  veryfar: 0.1,  // конечный
};

// Характеристика автомата — по типу нагрузки
const CURVE_TABLE = {
  lighting:   'MCB_B',
  mixed:      'MCB_C',
  motor:      'MCB_D',
  industrial: 'MCCB',
};

// Система заземления — напрямую из ответа
const GROUNDING_TABLE = {
  'tn-c-s': 'TN-C-S',
  'tn-s':   'TN-S',
  'tt':     'TT',
  'it':     'IT',
  'tn-c':   'TN-C',
};

// ========================= UI =========================

const state = {
  stepIdx: 0,
  answers: {},
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function renderStep() {
  const content = document.getElementById('pw-content');
  const progress = document.getElementById('pw-progress-bar');
  const stepLabel = document.getElementById('pw-step-label');
  const nextBtn = document.getElementById('pw-next');
  const backBtn = document.getElementById('pw-back');

  if (!content) return;

  // Шаг 5 (итог) — идёт после 4-х шагов
  if (state.stepIdx >= STEPS.length) {
    renderSummary();
    if (stepLabel) stepLabel.textContent = 'Итог (шаг 5 из 5)';
    if (progress) progress.style.width = '100%';
    if (nextBtn) { nextBtn.textContent = '✓ Применить'; nextBtn.disabled = false; }
    if (backBtn) backBtn.disabled = false;
    return;
  }

  const step = STEPS[state.stepIdx];
  const current = state.answers[step.id];
  const html = [];
  html.push(`<div class="pw-question">${esc(step.question)}</div>`);
  html.push(`<div class="pw-hint">${esc(step.hint)}</div>`);
  html.push('<div class="pw-options">');
  for (const opt of step.options) {
    const sel = opt.value === current ? ' selected' : '';
    html.push(`
      <div class="pw-option${sel}" data-value="${esc(opt.value)}">
        <div class="pw-option-title">${esc(opt.title)}</div>
        <div class="pw-option-desc">${esc(opt.desc)}</div>
      </div>`);
  }
  html.push('</div>');
  content.innerHTML = html.join('');

  // Клик по опции
  content.querySelectorAll('.pw-option').forEach(el => {
    el.addEventListener('click', () => {
      content.querySelectorAll('.pw-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      state.answers[step.id] = el.dataset.value;
      nextBtn.disabled = false;
    });
  });

  // UI состояние
  if (progress) progress.style.width = ((state.stepIdx + 1) / (STEPS.length + 1) * 100) + '%';
  if (stepLabel) stepLabel.textContent = `Шаг ${state.stepIdx + 1} из ${STEPS.length + 1}`;
  if (nextBtn) {
    nextBtn.textContent = (state.stepIdx === STEPS.length - 1) ? 'Показать итог →' : 'Далее →';
    nextBtn.disabled = !state.answers[step.id];
  }
  if (backBtn) backBtn.disabled = state.stepIdx === 0;
}

function calcFromAnswers() {
  const a = state.answers;
  const ik = (IK_TABLE[a.source] || {})[a.distance] || 6;
  const tk = TK_TABLE[a.distance] || 0.2;
  const curve = CURVE_TABLE[a.load] || 'MCB_C';
  const grounding = GROUNDING_TABLE[a.grounding] || 'TN-S';
  return { ik, tk, curve, grounding };
}

function renderSummary() {
  const content = document.getElementById('pw-content');
  const { ik, tk, curve, grounding } = calcFromAnswers();
  const curveLabels = {
    'MCB_B': 'MCB B (×5) — освещение, электроника',
    'MCB_C': 'MCB C (×10) — смешанная нагрузка',
    'MCB_D': 'MCB D (×20) — двигатели, импульсные нагрузки',
    'MCCB':  'MCCB (×10) — силовой автомат',
    'ACB':   'ACB (×10) — воздушный автомат',
  };
  content.innerHTML = `
    <div class="pw-question">Рекомендованные параметры</div>
    <div class="pw-hint">На основе ваших ответов подобраны следующие значения. После применения вы сможете отредактировать любое поле вручную.</div>

    <div class="pw-summary">
      <h4>⚡ Параметры КЗ и защиты</h4>
      <table class="pw-summary-table">
        <tr><td>Ток КЗ, I<sub>k</sub></td><td>${ik} кА</td></tr>
        <tr><td>Время отключения, t<sub>k</sub></td><td>${tk} с</td></tr>
        <tr><td>Характеристика автомата</td><td>${esc(curveLabels[curve] || curve)}</td></tr>
        <tr><td>Система заземления</td><td>${esc(grounding)}</td></tr>
      </table>
    </div>

    <div class="pw-hint" style="margin-top:14px;font-size:11px">
      Примечание: значения рассчитаны по типовым таблицам и подходят для большинства проектов.
      Для точного расчёта рекомендуется запросить у энергосбытовой компании паспорт ТП
      (Ssc или Ik3 на точке подключения) и учесть кабельное сопротивление от ТП до вашего щита.
    </div>
  `;
}

function applyToForm() {
  const { ik, tk, curve, grounding } = calcFromAnswers();
  const ikEl = document.getElementById('in-ik');
  const tkEl = document.getElementById('in-tk');
  const curveEl = document.getElementById('in-breakerCurve');
  const earthEl = document.getElementById('in-earthing');
  if (ikEl) ikEl.value = ik;
  if (tkEl) tkEl.value = tk;
  if (curveEl) curveEl.value = curve;
  if (earthEl) earthEl.value = grounding;
  // Визуальный feedback — подсветим применённые поля на 1.5 секунды
  [ikEl, tkEl, curveEl, earthEl].forEach(el => {
    if (!el) return;
    const prevBg = el.style.background;
    el.style.background = '#d4edda';
    setTimeout(() => { el.style.background = prevBg; }, 1500);
  });
}

function openWizard() {
  state.stepIdx = 0;
  state.answers = {};
  const modal = document.getElementById('protection-wizard-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderStep();
}

function closeWizard() {
  const modal = document.getElementById('protection-wizard-modal');
  if (modal) modal.style.display = 'none';
}

// ========================= Bootstrap =========================

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-protection-wizard');
  if (btn) btn.addEventListener('click', openWizard);

  document.getElementById('pw-close')?.addEventListener('click', closeWizard);
  document.getElementById('pw-back')?.addEventListener('click', () => {
    if (state.stepIdx > 0) {
      state.stepIdx--;
      renderStep();
    }
  });
  document.getElementById('pw-next')?.addEventListener('click', () => {
    if (state.stepIdx >= STEPS.length) {
      // Последний шаг «Итог» — применяем и закрываем
      applyToForm();
      closeWizard();
      return;
    }
    const curStep = STEPS[state.stepIdx];
    if (!state.answers[curStep.id]) return;
    state.stepIdx++;
    renderStep();
  });

  // Закрытие по клику вне модалки
  document.getElementById('protection-wizard-modal')?.addEventListener('click', (ev) => {
    if (ev.target.id === 'protection-wizard-modal') closeWizard();
  });
});
