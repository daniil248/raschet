/* =========================================================================
   report-text.js — генератор отчёта АГПТ в стиле «Такт-Газ-Плюс 1.0.4».
   Выводит многостраничный текстовый отчёт, который можно открыть в
   моноширинном блоке и распечатать / выгрузить как .txt.
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

/**
 * @param {Object} ctx
 *   - installation: {name, elevation, contract, site{name,address,customer,info}, norm, ...}
 *   - direction: {name, tmin, tp, fireClass, ...}
 *   - zone: {S,H,Cn,Spr,Ppr,paramp}
 *   - result: из sp-485-annex-d.compute(...)
 *   - piping: {segments:[{id,OD,wall,L,dH,area,P,G}], totalByDN:{}, totalVolumeL, nozzles:[{code,count}]}
 *   - calcNo: номер расчёта
 */
export function buildReport(ctx) {
  const { installation: inst, direction: dir, zone, result: r, piping, calcNo } = ctx;
  const a = AGENTS[r.agent];
  const mod = findVariant(r.moduleCode);
  const relief = reliefArea({
    mp: r.mp, r1: r.r1, tpd: r.tpd,
    tm: r.inputs.tm, hm: r.inputs.hm, piz: zone?.Ppr || 0.003, fs: r.inputs.fs,
  });

  const lines = [];
  const page = (n) => lines.push('', center(`Расчет № ${calcNo}   Стр. ${n}`), '');

  // --- Стр. 1 ---
  lines.push(center(`Программа Raschet · АГПТ-модуль (СП 485.1311500.2020 Прил. Д)`));
  lines.push(center(`Расчёт № ${calcNo}`));
  lines.push(center('параметров модульной установки газового пожаротушения'));
  lines.push('');
  lines.push(`Договор № ${inst?.site?.contract || '—'}`);
  lines.push(`Объект: ${inst?.site?.address || inst?.site?.name || inst?.name || '—'}`);
  lines.push('');
  lines.push(center('ИСХОДНЫЕ ДАННЫЕ:'));
  const kv = (k, v) => lines.push(`${pad(k, 48)}${v}`);
  kv('Площадь защищаемого помещения',    `sp = ${r.inputs.sp} м²`);
  kv('Высота помещения над полом',        `h  = ${r.inputs.h} м`);
  kv('Минимальная температура в помещении', `tm = ${r.inputs.tm} °C`);
  kv('Высота помещения над уровнем моря', `hm = ${r.inputs.hm} м`);
  kv('Площадь открытых проёмов в помещении', `fs = ${r.inputs.fs} м²`);
  kv('Параметр П, учитывающий расположение проёмов по высоте', `paramp = ${r.inputs.paramp}`);
  kv('Максимально допустимое избыточное давление в помещении', `piz = ${zone?.Ppr ?? 0.003} МПа`);
  kv('Газовое огнетушащее вещество (ОТВ)', `${a.label}`);
  kv('Плотность паров огнетушащего газа', `r0 = ${a.rho20} кг/м³`);
  kv('Нормативное время подачи ОТВ',       `tp = ${r.inputs.tp} с`);
  kv('Класс ожидаемого пожара в помещении', `${r.inputs.fireClass}`);
  kv('Норм. огнетуш. концентрация паров ОТВ', `Cн = ${r.inputs.Cn} % (об)`);
  kv('Тип модуля газового пожаротушения',  `${r.moduleCode}`);
  kv('Коэффициент загрузки модуля',         `kz = ${r.kz_max} кг/л`);

  // --- Расчёт ---
  lines.push('');
  lines.push(center('РАСЧЁТ МАССЫ ОТВ И КОЛИЧЕСТВА МОДУЛЕЙ'));
  lines.push('   Расчёт массы ОТВ при тушении огнетушащим веществом типа');
  lines.push(`${a.label}, являющимся сжиженным газом, производится`);
  lines.push('в соответствии с приложением Д СП 485.1311500.2020 по формуле:');
  lines.push('                               Cн');
  lines.push('   mp = sp · h · r1 · (1 + k2) · ---------');
  lines.push('                              100 − Cн');
  lines.push('где коэффициент k2, учитывающий потери ОТВ через проёмы помещения,');
  lines.push('составляет:');
  lines.push('                     fs');
  lines.push(`   k2 = paramp · --------- · tp · √h = ${r.k2}`);
  lines.push('                    sp · h');
  lines.push('');
  lines.push('   Плотность паров огнетушащего газа при заданной минимальной');
  lines.push('температуре в помещении и высоте над уровнем моря составляет:');
  lines.push('                          293');
  lines.push(`   r1 = r0 · k3 · ---------- = ${r.r1} кг/м³`);
  lines.push('                   273 + tm');
  lines.push(`где коэффициент k3, учитывающий высоту ${r.inputs.hm} м, равен ${r.K3.toFixed(3)}.`);
  lines.push('');
  lines.push('   Таким образом нормативное количество ОТВ, которое необходимо подать');
  lines.push('в защищаемое помещение, равно:');
  lines.push(`                                           ${r.inputs.Cn}`);
  lines.push(`   mp = ${r.inputs.sp} · ${r.inputs.h} · ${r.r1} · (1 + ${r.k2}) · ---------- = ${r.mp} кг`);
  lines.push(`                                          ${(100-r.inputs.Cn).toFixed(1)}`);

  page(2);
  lines.push('   Расчётная масса ОТВ, которая должна храниться в установке, равна');
  lines.push('      mg = k1 · (mp + mtr + n · m1),');
  lines.push(`где коэфф. k1 = ${r.inputs.k1} учитывает утечки ОТВ из модулей в дежурном режиме,`);
  lines.push('mtr — масса остатка ОТВ в трубах, n — количество модулей, ob — объём модуля.');
  lines.push('При этом m1 = mb + ob · r2 / 1000, r2 = r1 · pmin / 2,');
  lines.push(`mb = ${r.mb} кг — макс. масса остатка ОТВ в модуле по тех. документации,`);
  lines.push(`pmin = ${r.inputs.pmin} атм — минимальное давление перед насадками для данного ОТВ.`);
  lines.push(`   m1 = ${r.mb} + ${r.ob}/1000 · ${r.r2} = ${r.m1} кг`);
  lines.push('');
  lines.push(`   Масса остатка ОТВ в трубах mtr = obtr · r2 / 1000, obtr = ${r.obtr} л —`);
  lines.push('объём труб (без учёта модулей), см. результаты расчёта параметров');
  lines.push('трубопроводной системы.');
  lines.push(`   mtr = ${r.obtr}/1000 · ${r.r2} = ${r.mtr} кг`);
  lines.push('');
  lines.push(`   Нормативное количество модулей типа ${r.moduleCode}`);
  lines.push(`с объёмом ob = ${r.ob} л с учётом коэффициента загрузки kz = ${r.kz_max} кг/л`);
  lines.push('составляет n = ⌈(mp + mtr) / (kz · ob / k1 − m1)⌉ =');
  lines.push(`         = ⌈(${r.mp} + ${r.mtr}) / (${r.kz_max}·${r.ob}/${r.inputs.k1} − ${r.m1})⌉ = ${r.n}`);
  lines.push('');
  lines.push('   Таким образом, нормативная расчётная масса ОТВ, предназначенная');
  lines.push('для хранения в установке, составляет:');
  lines.push(`   mg = ${r.inputs.k1} · (${r.mp} + ${r.mtr} + ${r.n} · ${r.m1}) = ${r.mg} кг`);
  lines.push(`   Заряд каждого модуля zr = mg/n = ${r.mg}/${r.n} = ${r.zr} кг`);

  // --- Прил. Ж: проём сброса ---
  lines.push('');
  lines.push(center('Площадь дополнительного проёма для сброса избыточного давления'));
  lines.push('   (Приложение Ж СП 485.1311500.2020)');
  relief.steps.forEach(s => lines.push('   ' + s));
  lines.push('');
  lines.push(`   → Fc ≥ ${relief.Fc} м²`);

  // --- Стр. 3: трубопровод ---
  if (piping) {
    page(3);
    lines.push(center('РЕЗУЛЬТАТЫ РАСЧЁТА ПАРАМЕТРОВ ТРУБОПРОВОДНОЙ'));
    lines.push(center('СИСТЕМЫ И ВРЕМЕНИ ПОДАЧИ ОГНЕТУШАЩЕГО ГАЗА'));
    lines.push('');
    lines.push('Исходные данные:');
    kv('  Общий объём защищаемого помещения, м³', (r.inputs.sp * r.inputs.h).toFixed(2));
    kv('  Количество ОТВ в модулях mg, кг',       r.mg);
    kv('  Расчётное количество ОТВ для тушения mp, кг', r.mp);
    kv('  Количество модулей газового пожаротушения',   r.n);
    kv('  Избыточное давление в модулях, МПа',          ((mod?.pressure_bar || 42) / 10).toFixed(1));
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
  lines.push(`Расчёт подготовил: ${inst?.author || '—'}`);
  lines.push(`Дата: ${new Date().toLocaleDateString('ru-RU')}`);
  return lines.join('\n');
}
