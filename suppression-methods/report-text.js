/* =========================================================================
   report-text.js — генератор текстового отчёта АГПТ.
   Заголовки/ссылки на нормативный документ адаптируются к выбранной
   методике (СП 485 / СП РК / NFPA 2001 / ISO 14520).
   Выводит многостраничный текстовый отчёт в моноширинном блоке.
   ========================================================================= */

import { AGENTS } from './agents.js';
import { findVariant } from './modules-catalog.js';
import { reliefArea } from './sp-485-annex-d.js';

const pad = (s, n) => String(s).padEnd(n, ' ');
const padL = (s, n) => String(s).padStart(n, ' ');
const LINE = '-'.repeat(72);

function center(text, w = 72) {
  const s = String(text);
  const gap = Math.max(0, Math.floor((w - s.length) / 2));
  return ' '.repeat(gap) + s;
}

const NORM_META = {
  'sp-485-annex-d': {
    title: 'СП 485.1311500.2020, Приложение Д',
    short: 'СП 485 Прил. Д',
    reliefRef: 'Приложение Ж СП 485.1311500.2020',
    country: 'Россия',
  },
  'sp-rk-2022': {
    title: 'СП РК 2.02-102-2022, Приложение Г',
    short: 'СП РК 2.02-102-2022',
    reliefRef: 'Приложение Г СП РК 2.02-102-2022',
    country: 'Казахстан',
  },
  'nfpa-2001': {
    title: 'NFPA 2001 (Clean Agent Fire Extinguishing Systems)',
    short: 'NFPA 2001',
    reliefRef: 'NFPA 2001, Annex A',
    country: 'США',
  },
  'iso-14520': {
    title: 'ISO 14520 (Gaseous fire-extinguishing systems)',
    short: 'ISO 14520',
    reliefRef: 'ISO 14520, Annex A',
    country: 'International',
  },
};

/**
 * @param {Object} ctx
 *   - installation: {name, elevation, site{...}, norm, author, ...}
 *   - direction, zone, result, piping, calcNo
 */
export function buildReport(ctx) {
  const { installation: inst, direction: dir, zone, result: r, piping, calcNo } = ctx;
  const a = AGENTS[r.agent];
  const mod = findVariant(r.moduleCode);
  const norm = NORM_META[inst?.norm] || NORM_META['sp-485-annex-d'];
  const relief = reliefArea({
    mp: r.mp, r1: r.r1, tpd: r.tpd,
    tm: r.inputs.tm, hm: r.inputs.hm, piz: zone?.Ppr || 0.003, fs: r.inputs.fs,
  });

  const lines = [];
  const page = (n) => lines.push('', center(`Расчёт № ${calcNo}   Стр. ${n}`), '');

  // --- Стр. 1 ---
  lines.push(center(`АГПТ — расчёт по методике: ${norm.title}`));
  lines.push(center(`Расчёт № ${calcNo}`));
  lines.push(center(
    dir?.type === 'local'
      ? 'параметры локальной установки газового пожаротушения'
      : 'параметры модульной установки газового пожаротушения'
  ));
  lines.push('');
  lines.push(`Договор № ${inst?.site?.contract || '—'}`);
  lines.push(`Заказчик: ${inst?.site?.customer || '—'}`);
  lines.push(`Объект: ${inst?.site?.address || inst?.site?.name || inst?.name || '—'}`);
  lines.push(`Направление: ${dir?.name || '—'}`);
  lines.push('');
  lines.push(center('ИСХОДНЫЕ ДАННЫЕ'));
  const kv = (k, v) => lines.push(`${pad(k, 48)}${v}`);
  kv('Площадь защищаемого помещения',    `sp = ${r.inputs.sp} м²`);
  kv('Высота помещения над полом',        `h  = ${r.inputs.h} м`);
  kv('Минимальная температура в помещении', `tm = ${r.inputs.tm} °C`);
  kv('Высота помещения над уровнем моря', `hm = ${r.inputs.hm} м`);
  kv('Площадь открытых проёмов в помещении', `fs = ${r.inputs.fs} м²`);
  kv('Параметр П, располож. проёмов по высоте', `П = ${r.inputs.paramp}`);
  kv('Макс. допустимое избыточное давление', `piz = ${zone?.Ppr ?? 0.003} МПа`);
  kv('Газовое огнетушащее вещество (ГОТВ)', `${a.label}`);
  kv('Плотность паров ГОТВ при 20 °C',     `r0 = ${a.rho20} кг/м³`);
  kv('Нормативное время подачи ГОТВ',       `tp = ${r.inputs.tp} с`);
  kv('Класс ожидаемого пожара',             `${r.inputs.fireClass}`);
  kv('Нормативная огнетуш. концентрация',   `Cн = ${r.inputs.Cn} % (об)`);
  kv('Тип модуля газового пожаротушения',   `${r.moduleCode}`);
  kv('Коэффициент загрузки модуля',         `kz = ${r.kz_max} кг/л`);

  // --- Расчёт массы ---
  lines.push('');
  lines.push(center('РАСЧЁТ МАССЫ ГОТВ И КОЛИЧЕСТВА МОДУЛЕЙ'));
  lines.push(`   Расчёт выполнен по методике: ${norm.title}.`);
  lines.push(`   Огнетушащее вещество: ${a.label} (сжиженный газ).`);
  lines.push('');
  lines.push('   Нормативная масса ГОТВ mp определяется по формуле:');
  lines.push('                               Cн');
  lines.push('      mp = sp · h · r1 · (1 + k2) · ---------');
  lines.push('                              100 − Cн');
  lines.push('где k2 — коэффициент потерь ГОТВ через проёмы:');
  lines.push('                     fs');
  lines.push(`      k2 = П · --------- · tp · √h = ${r.k2}`);
  lines.push('                   sp · h');
  lines.push('');
  lines.push('   Плотность паров ГОТВ при заданной минимальной');
  lines.push('температуре и высоте над уровнем моря:');
  lines.push('                          293');
  lines.push(`      r1 = r0 · k3 · ---------- = ${r.r1} кг/м³`);
  lines.push('                   273 + tm');
  lines.push(`где k3 = ${r.K3.toFixed(3)} — коэффициент высоты ${r.inputs.hm} м.`);
  lines.push('');
  lines.push('   Нормативная масса ГОТВ для подачи в защищаемое помещение:');
  lines.push(`                                           ${r.inputs.Cn}`);
  lines.push(`      mp = ${r.inputs.sp} · ${r.inputs.h} · ${r.r1} · (1 + ${r.k2}) · ---------- = ${r.mp} кг`);
  lines.push(`                                          ${(100-r.inputs.Cn).toFixed(1)}`);

  page(2);
  lines.push('   Расчётная масса ГОТВ для хранения в установке:');
  lines.push('      mg = k1 · (mp + mtr + n · m1),');
  lines.push(`где k1 = ${r.inputs.k1} — коэфф. утечек ГОТВ из модулей в дежурном режиме,`);
  lines.push('mtr — остаток ГОТВ в трубах, n — количество модулей, ob — объём модуля.');
  lines.push('При этом m1 = mb + ob · r2 / 1000, r2 = r1 · pmin / 2,');
  lines.push(`mb = ${r.mb} кг — макс. масса остатка ГОТВ в модуле по тех. документации,`);
  lines.push(`pmin = ${r.inputs.pmin} атм — минимальное давление перед насадками.`);
  lines.push(`   m1 = ${r.mb} + ${r.ob}/1000 · ${r.r2} = ${r.m1} кг`);
  lines.push('');
  lines.push(`   Остаток ГОТВ в трубах: mtr = obtr · r2 / 1000, obtr = ${r.obtr} л —`);
  lines.push('объём трубопровода (без учёта модулей), см. параметры трубопроводной системы.');
  lines.push(`   mtr = ${r.obtr}/1000 · ${r.r2} = ${r.mtr} кг`);
  lines.push('');
  lines.push(`   Нормативное количество модулей типа ${r.moduleCode}`);
  lines.push(`с объёмом ob = ${r.ob} л и коэффициентом загрузки kz = ${r.kz_max} кг/л:`);
  lines.push('      n = ⌈(mp + mtr) / (kz · ob / k1 − m1)⌉ =');
  lines.push(`        = ⌈(${r.mp} + ${r.mtr}) / (${r.kz_max}·${r.ob}/${r.inputs.k1} − ${r.m1})⌉ = ${r.n}`);
  lines.push('');
  lines.push('   Нормативная расчётная масса ГОТВ для хранения в установке:');
  lines.push(`      mg = ${r.inputs.k1} · (${r.mp} + ${r.mtr} + ${r.n} · ${r.m1}) = ${r.mg} кг`);
  lines.push(`      Заряд каждого модуля: zr = mg/n = ${r.mg}/${r.n} = ${r.zr} кг`);

  // --- Площадь сброса ---
  lines.push('');
  lines.push(center('Площадь дополнительного проёма для сброса избыточного давления'));
  lines.push(`   (${norm.reliefRef})`);
  relief.steps.forEach(s => lines.push('   ' + s));
  lines.push('');
  lines.push(`   → Fc ≥ ${relief.Fc} м²`);

  // --- Стр. 3: трубопровод ---
  if (piping) {
    page(3);
    lines.push(center('ПАРАМЕТРЫ ТРУБОПРОВОДНОЙ СИСТЕМЫ'));
    lines.push(center('И ВРЕМЯ ПОДАЧИ ОГНЕТУШАЩЕГО ГАЗА'));
    lines.push('');
    lines.push('Исходные данные:');
    kv('  Объём защищаемого помещения, м³',       (r.inputs.sp * r.inputs.h).toFixed(2));
    kv('  Масса ГОТВ в модулях mg, кг',           r.mg);
    kv('  Расчётная масса ГОТВ для тушения mp, кг', r.mp);
    kv('  Количество модулей',                    r.n);
    kv('  Избыточное давление в модулях, МПа',    ((mod?.pressure_bar || 42) / 10).toFixed(1));
    lines.push('');
    lines.push('Расчётные значения трубной разводки и насадков');
    lines.push('┌─────┬──────────┬──────┬────────┬─────────┬──────────┬──────────┐');
    lines.push('│ №   │  Труба   │Длина │Перепад │ Площадь │Давление, │ Расход,  │');
    lines.push('│     │(D × s), │  м   │высот, м│отверстий│   МПа    │   кг     │');
    lines.push('│     │   мм    │      │        │  , мм²  │          │          │');
    lines.push('├─────┼──────────┼──────┼────────┼─────────┼──────────┼──────────┤');
    (piping.segments || []).forEach(s => {
      const truba = s.OD && s.wall ? `${s.OD}×${s.wall}` : (s.DN ? `DN${s.DN}` : '—');
      lines.push(`│${padL(s.id, 4)} │${pad(truba, 10)}│${padL(s.L ?? '—', 6)}│${padL(s.dH ?? '—', 8)}│${padL(s.area ?? '—', 9)}│${padL(s.P ?? '—', 10)}│${padL(s.G ?? '—', 10)}│`);
    });
    lines.push('└─────┴──────────┴──────┴────────┴─────────┴──────────┴──────────┘');
    lines.push('');
    lines.push(`Расчётное время подачи 95% массы mp·0.95 = ${(r.mp*0.95).toFixed(1)} кг — ${r.tpd} с`);
    lines.push('');
    lines.push('Суммарное количество труб:');
    lines.push('   Диаметр (мм)       Кол-во (м)');
    Object.entries(piping.totalByDN || {}).forEach(([k, v]) => {
      lines.push(`   ${pad(k, 18)} ${v}`);
    });
    lines.push(`   Суммарный объём труб — ${piping.totalVolumeL ?? '—'} л`);
    lines.push('');
    lines.push('Суммарное количество насадков:');
    (piping.nozzles || []).forEach(n => {
      lines.push(`   ${pad(n.code, 26)} ${n.count} шт.`);
    });
  }

  lines.push('');
  lines.push(LINE);
  lines.push(`Расчёт выполнен в системе Raschet · модуль АГПТ (${norm.short}).`);
  lines.push(`Подготовил: ${inst?.author || '—'}`);
  lines.push(`Дата: ${new Date().toLocaleDateString('ru-RU')}`);
  return lines.join('\n');
}
