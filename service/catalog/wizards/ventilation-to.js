// service/catalog/wizards/ventilation-to.js — ТО системы вентиляции
// Phase 42 seed-scenario v0.60.109.
//
// По запросу Пользователя 2026-05-04: «если речь идет про систему
// вентиляции, то мастер запрашивает производительность системы, затем
// соответственно предлагает соответствующие расходные материалы для
// конкретной установки, учитывая производительность».

export const WIZARD_VENTILATION_TO = {
  id: 'wz-seed-ventilation-to',
  icon: '💨',
  title: 'ТО системы вентиляции',
  description: 'Регламентное обслуживание приточно-вытяжной установки. Мастер задаёт расход и тип фильтров, предлагает расходники с правильным количеством по периодичности.',
  appliesTo: ['maintenance'],

  // Параметры — заполняются Пользователем на первых шагах.
  params: [
    {
      id: 'airflow',
      label: 'Производительность установки, м³/ч',
      type: 'number',
      min: 100,
      max: 100000,
      step: 100,
      default: 3000,
      required: true,
      tip: 'Номинальный расход воздуха установки (по паспорту или фактическим замерам).',
    },
    {
      id: 'filterCount',
      label: 'Кол-во фильтров в установке',
      type: 'number',
      min: 1,
      max: 20,
      default: 1,
      tip: 'Сколько фильтрующих секций в установке (обычно 1–4).',
    },
    {
      id: 'filterClass',
      label: 'Класс фильтра предв./основного',
      type: 'choice',
      options: [
        { v: 'G4',  l: 'G4 (грубая очистка)' },
        { v: 'F7',  l: 'F7 (средняя очистка)' },
        { v: 'F9',  l: 'F9 (тонкая очистка)' },
        { v: 'H13', l: 'HEPA H13 (особо тонкая)' },
        { v: 'H14', l: 'HEPA H14 (для чистых помещений)' },
      ],
      default: 'F7',
      tip: 'Класс установленных фильтров. Если разные — выберите основной (HEPA или F7/F9).',
    },
    {
      id: 'hasRecuperator',
      label: 'Есть рекуператор?',
      type: 'choice',
      options: [
        { v: 'no',     l: 'Нет' },
        { v: 'plate',  l: 'Пластинчатый' },
        { v: 'rotary', l: 'Роторный (энтальпийный)' },
      ],
      default: 'no',
      tip: 'Для ТО рекуператора потребуется чистка / проверка ремней (роторный) или мойка теплообменника (пластинчатый).',
    },
    {
      id: 'periodMonths',
      label: 'Периодичность ТО, мес.',
      type: 'number',
      min: 1,
      max: 12,
      default: 3,
      tip: 'Раз в сколько месяцев плановое ТО. Влияет на kоличество расходников за период.',
    },
  ],

  // Группы предложений. Каждая группа — отдельный шаг в UI.
  suggestions: [
    {
      group: '🔧 Регламентные работы',
      rules: [
        {
          when: 'true',  // всегда предлагать
          label: 'Регламентное ТО ежемесячное (визит)',
          qty: 1,
          unit: 'выезд',
          category: 'labor',
          costPrice: 25000,
          clientPrice: 45000,
          ask: 'Добавить выезд бригады для ТО?',
        },
        {
          when: 'airflow > 5000',
          label: 'Чистка секций крупной АХУ (расход > 5000 м³/ч)',
          qty: 1,
          unit: 'комплект',
          category: 'labor',
          costPrice: 15000,
          clientPrice: 28000,
          ask: 'Расход {airflow} м³/ч — добавить чистку секций?',
        },
        {
          when: 'periodMonths >= 6',
          label: 'Замена клиновых ремней (раз в 6 мес.)',
          qty: 1,
          unit: 'комплект',
          category: 'labor',
          costPrice: 4000,
          clientPrice: 8500,
          ask: 'Период {periodMonths} мес. — заменить ремни?',
        },
      ],
    },
    {
      group: '📦 Фильтры',
      rules: [
        {
          when: 'filterClass === "G4"',
          label: 'Фильтр G4 (предварительный) 592×592×48 мм',
          qty: 'filterCount * 2',  // G4 меняется чаще
          unit: 'шт',
          category: 'material',
          costPrice: 800,
          clientPrice: 1600,
          ask: '{filterClass}-фильтры — {qty} шт ({filterCount} установлено × 2 комплекта на интервал)?',
        },
        {
          when: 'filterClass === "F7"',
          label: 'Фильтр карманный F7 592×592×400 мм',
          qty: 'filterCount',
          unit: 'шт',
          category: 'material',
          costPrice: 2200,
          clientPrice: 4400,
          ask: '{filterClass}-фильтры — {qty} шт?',
        },
        {
          when: 'filterClass === "F9"',
          label: 'Фильтр карманный F9 592×592×400 мм',
          qty: 'filterCount',
          unit: 'шт',
          category: 'material',
          costPrice: 3200,
          clientPrice: 6200,
          ask: '{filterClass}-фильтры — {qty} шт?',
        },
        {
          when: 'filterClass === "H13"',
          label: 'Фильтр HEPA H13 592×592×292 мм',
          qty: 'filterCount',
          unit: 'шт',
          category: 'material',
          costPrice: 7500,
          clientPrice: 14000,
          ask: 'HEPA H13 — {qty} шт?',
        },
        {
          when: 'filterClass === "H14"',
          label: 'Фильтр HEPA H14 592×592×292 мм',
          qty: 'filterCount',
          unit: 'шт',
          category: 'material',
          costPrice: 11000,
          clientPrice: 21000,
          ask: 'HEPA H14 — {qty} шт?',
        },
      ],
    },
    {
      group: '♻ Рекуператор',
      rules: [
        {
          when: 'hasRecuperator === "plate"',
          label: 'Промывка пластинчатого теплообменника',
          qty: 1,
          unit: 'комплект',
          category: 'labor',
          costPrice: 6000,
          clientPrice: 11000,
          ask: 'Пластинчатый рекуператор — добавить промывку?',
        },
        {
          when: 'hasRecuperator === "rotary"',
          label: 'ТО ротора (подшипники + ремень привода)',
          qty: 1,
          unit: 'комплект',
          category: 'labor',
          costPrice: 8500,
          clientPrice: 16000,
          ask: 'Роторный рекуператор — добавить ТО ротора?',
        },
      ],
    },
  ],
};
