// Инспектор: модалки и блоки для источников питания и генераторов.
//  - openImpedanceModal — параметры IEC 60909 (трансформатор / генератор / utility / other)
//  - openAutomationModal — сценарии автоматизации запуска генератора
//  - sourceStatusBlock — блок статуса в sidebar
//  - voltageLevelOptions — helper генерации опций для select напряжений
// Выделено из inspector.js.
import { GLOBAL, TRANSFORMER_CATALOG } from '../constants.js';
import { state } from '../state.js';
import { escHtml, escAttr, fmt, field, flash, helpIcon } from '../utils.js';
import { effectiveTag } from '../zones.js';
import { effectiveOn } from '../modes.js';
import { nodeVoltage, sourceImpedance, formatVoltageLevelLabel, cableVoltageClass } from '../electrical.js';
import { getTerm, getTermTooltip } from '../../methods/terms.js';
import { rtmInfoBlock } from './rtm-block.js';
import { snapshot, notifyChange } from '../history.js';
import { getActiveProjectId, getProject, updateProject } from '../../../shared/project-storage.js';
import { render } from '../render.js';
// Ленивая привязка чтобы избежать цикла на этапе загрузки. Связывается
// из inspector.js через bindInspectorSourceDeps.
let _wrapTabs = null;
export function bindWrapModalTabs(fn) { _wrapTabs = fn; }

let _renderInspector = null;
export function bindInspectorSourceDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}
function _invokeRenderInspector() { if (_renderInspector) _renderInspector(); }

function _wrapModalWithSystemTabs(bodyEl, n) {
  if (_wrapTabs) try { _wrapTabs(bodyEl, n); } catch {}
}

// ================= voltageLevelOptions =================
export function voltageLevelOptions(selectedIdx, filter) {
  const levels = GLOBAL.voltageLevels || [];
  let opts = '';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    const isDC = lv.dc || (typeof lv.hz === 'number' && lv.hz === 0);
    // Фильтр 'dc' — только DC; 'ac' — только AC; без фильтра — все
    if (filter === 'dc' && !isDC) continue;
    if (filter === 'ac' && isDC) continue;
    opts += `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escHtml(formatVoltageLevelLabel(lv))}</option>`;
  }
  return opts;
}

// ================= Модалка «Параметры источника (IEC 60909)» =================
export function openImpedanceModal(n) {
  const body = document.getElementById('impedance-body');
  if (!body) return;
  const h = [];
  const subtype = n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer');
  const isTransformer = subtype === 'transformer';
  const isOther = subtype === 'other';
  const isUtility = subtype === 'utility';
  h.push(`<h3>${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push(field('Имя', `<input type="text" id="imp-name" value="${escAttr(n.name || '')}">`));
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Номинальные параметры источника и данные для расчёта тока КЗ по IEC 60909.</div>');

  h.push('<h4 style="margin:16px 0 8px">Номинальные параметры</h4>');

  if (isUtility) {
    h.push('<div class="muted" style="font-size:11px;margin-bottom:8px">Городская сеть / ЛЭП. Параметры КЗ задаются напрямую.</div>');
    // v0.59.693: подсказка вынесена в helpIcon рядом с лейблом.
    h.push(`<div class="field">
      <label>Разрешённая мощность по ТУ, кВт${helpIcon('Выделенная сетевой организацией активная мощность (из технических условий на технологическое присоединение). Используется в Dashboard и sidebar как лимит «общей доступной мощности». Для городской сети номинальная Snom не имеет смысла — только разрешённый лимит из ТУ.')}</label>
      <input type="number" id="imp-utility-pmax" min="0" max="1000000" step="1" value="${n.capacityKw ?? 0}">
    </div>`);
    // v0.59.605 (Phase 18): расчёт компенсации реактивной мощности.
    // Юзер: «добавь расчёт компенсации реактивной мощности на городском
    // вводе». Энергоснабжающая организация требует cosφ ≥ 0.95 (или 0.99
    // для крупных потребителей). При меньшем — штраф или принудительная
    // установка УКРМ (установка компенсации реактивной мощности).
    // v0.59.629: УРКМ перенесён из utility в параметры панели (ГРЩ / РУ 0,4 LV).
    // Юзер: «УРКМ нужно ставить после трансформатора на низкой стороне в ГРЩ».
    // Здесь, на стороне 10 кВ (utility/HV), УРКМ не ставится — конденсаторные
    // батареи 10 кВ редкость, обычно компенсация на низкой стороне.
    h.push(`<div class="muted" style="font-size:11px;margin-top:8px;padding:8px 10px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px;line-height:1.5">
      <b>УКРМ на этой стороне (HV ${n.voltage ? Math.round(n.voltage/1000) : 10} кВ) не задаётся.</b><br>
      Компенсация реактивной мощности ставится на <b>низкой стороне</b> трансформатора в ГРЩ (РУ 0,4 кВ). Включи её в параметрах соответствующего щита (флаг «Точка установки УКРМ»).
    </div>`);
  } else if (isTransformer) {
    let tOpts = '<option value="">— выберите —</option>';
    for (const t of TRANSFORMER_CATALOG) {
      const sel = t.snomKva === n.snomKva ? ' selected' : '';
      tOpts += `<option value="${t.snomKva}"${sel}>${t.label}</option>`;
    }
    h.push(`<div class="field">
      <label>Типовой номинал (ГОСТ 11677)${helpIcon('Выбор стандартного номинала из каталога ГОСТ 11677. При выборе автоматически заполняются Uk, Pk, P0 (потери) по ГОСТ. Поле Snom остаётся редактируемым — для случаев нестандартных мощностей или импорта из паспорта.')}</label>
      <select id="imp-tCatalog">${tOpts}</select>
    </div>`);
    h.push(`<div class="field">
      <label>Номинальная мощность (Snom), кВА${helpIcon('Полная номинальная мощность трансформатора (нагрузочная способность по нагреву обмоток). Связь с активной мощностью: P_ном = Snom × cos φ. Стандартный ряд (ГОСТ 11677): 25/40/63/100/160/250/400/630/1000/1600/2500 кВА для распределительных ТП.')}</label>
      <input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">
    </div>`);
  } else if (subtype === 'generator') {
    // v0.59.631: ISO 8528-1 режимы работы ДГУ — теперь в этой же модалке
    // (юзер: «не используй настройку в нескольких местах, только в Параметры
    // источника»). Раньше был отдельный modal-genrating.
    h.push(_renderGenIsoBlock(n));
  } else {
    h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  }

  const outIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  // v0.59.700: helpIcon на полях напряжения и группы соединений.
  h.push(`<div class="field">
    <label>${isTransformer ? 'Выходное напряжение (вторичная обмотка)' : 'Выходное напряжение'}${helpIcon('Класс напряжения на выходе источника. Для трансформатора — вторичная (низшая) сторона. Стандартные классы по IEC 60038: 0.4 кВ (400/230 В) — для распределительных сетей; 6/10/35 кВ — среднее напряжение; 110/220 кВ — высокое.')}</label>
    <select id="imp-voltage-out">${voltageLevelOptions(outIdx, null)}</select>
  </div>`);

  if (isTransformer) {
    // Группа соединений обмоток (IEC 60076-1)
    const vg = n.vectorGroup || 'Dyn11';
    h.push(`<div class="field">
      <label>Группа соединений обмоток${helpIcon('IEC 60076-1: схема соединения первичной/вторичной обмоток + сдвиг фаз. Dyn11 (Δ/Y-н, сдвиг 330°) — стандарт для силовых ТП 6–10/0.4 кВ; Yyn0 (Y/Y-н) — симметричные нагрузки без 3-й гармоники; Dzn0 (Δ/зигзаг-н) — несимметричные нагрузки с малым током КЗ; YNd11 — для повышающих ТП.')}</label>
      <select id="imp-vectorGroup">
        <option value="Dyn11"${vg === 'Dyn11' ? ' selected' : ''}>Dyn11 — Δ/Y-н (треугольник / звезда с нейтралью)</option>
        <option value="Yyn0"${vg === 'Yyn0' ? ' selected' : ''}>Yyn0 — Y/Y-н (звезда / звезда с нейтралью)</option>
        <option value="Dyn5"${vg === 'Dyn5' ? ' selected' : ''}>Dyn5 — Δ/Y-н (сдвиг 150°)</option>
        <option value="Dyn1"${vg === 'Dyn1' ? ' selected' : ''}>Dyn1 — Δ/Y-н (сдвиг 30°)</option>
        <option value="Dzn0"${vg === 'Dzn0' ? ' selected' : ''}>Dzn0 — Δ/зигзаг-н</option>
        <option value="YNyn0"${vg === 'YNyn0' ? ' selected' : ''}>YNyn0 — Y-н/Y-н (двойная звезда)</option>
        <option value="YNd11"${vg === 'YNd11' ? ' selected' : ''}>YNd11 — Y-н/Δ</option>
        <option value="Dd0"${vg === 'Dd0' ? ' selected' : ''}>Dd0 — Δ/Δ</option>
      </select>
    </div>`);

    const inIdx = (typeof n.inputVoltageLevelIdx === 'number') ? n.inputVoltageLevelIdx : (() => {
      const levels = GLOBAL.voltageLevels || [];
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].vLL >= 6000) return i;
      }
      return 0;
    })();
    h.push(`<div class="field">
      <label>Входное напряжение (первичная обмотка)${helpIcon('Класс напряжения на входе трансформатора (первичная / высшая сторона). Связь с выходным: коэффициент трансформации kt = U1ном / U2ном. Влияет на расчёт тока КЗ через соотношение Z_сети_приведённое = Z_сети × (U2/U1)².')}</label>
      <select id="imp-voltage-in">${voltageLevelOptions(inIdx, null)}</select>
    </div>`);
  }

  h.push('<h4 style="margin:16px 0 8px">Параметры короткого замыкания</h4>');
  if (isOther || isUtility) {
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px;line-height:1.4">`
      + (isUtility
        ? 'Ток трёхфазного КЗ или мощность КЗ сети (Ssc) в точке подключения — из технических условий сетевой организации. '
          + 'Типичные значения Ik на 10 кВ: сельская сеть 6–9 кА (Ssc 100–150 МВА), '
          + 'городская 12–20 кА (200–350 МВА), промышленная 29–58 кА (500–1000 МВА). '
          + 'Если задан Ik — Ssc игнорируется.'
        : 'Задайте ток 3ф КЗ в точке подключения или мощность КЗ сети.')
      + `</div>`);
    h.push(`<div class="field">
      <label>Ток трёхфазного КЗ Ik, кА${helpIcon('Ток 3-фазного короткого замыкания в точке подключения, из ТУ сетевой организации. Связь с мощностью КЗ: Ssc = √3 × U × Ik / 1000. Типичные значения на 10 кВ: сельская сеть 6–9 кА (Ssc 100–150 МВА), городская 12–20 кА (200–350 МВА), промышленная 29–58 кА (500–1000 МВА). Если задан Ik — Ssc игнорируется.')}</label>
      <input type="number" id="imp-ikka" min="0" max="200" step="0.1" value="${n.ikKA ?? 10}">
    </div>`);
    h.push(`<div class="field">
      <label>ИЛИ Мощность КЗ сети (Ssc), МВА${helpIcon('Альтернатива Ik. Полная мощность КЗ сети в точке подключения. Связь: Ik = Ssc / (√3 × U). Типичные значения см. в подсказке для Ik. Используется только если Ik не задан (= 0).')}</label>
      <input type="number" id="imp-ssc" min="0" max="10000" step="1" value="${n.sscMva ?? 0}">
    </div>`);
    h.push(`<div class="field">
      <label>Отношение Xs/Rs${helpIcon('Отношение реактивного к активному сопротивлению источника. Типично для городской сети 10 кВ: 10:1. Влияет на угол сдвига фазы тока КЗ.')}</label>
      <input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">
    </div>`);
  } else {
    // Трансформатор с подключённым upstream → Ssc берётся от utility
    const hasUpstream = isTransformer && [...(state.conns?.values() || [])].some(
      c => c.to?.nodeId === n.id && c._state === 'active'
    );
    if (!hasUpstream) {
      h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px;line-height:1.4">`
        + 'Нет подключённого ввода — задайте мощность КЗ сети вручную (Ssc). '
        + 'Подключите узел «Городская сеть» ко входу трансформатора, чтобы Ssc определялся автоматически.'
        + `</div>`);
      h.push(field('Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="1" max="10000" step="1" value="${n.sscMva ?? 250}">`));
    } else {
      h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px;line-height:1.4">`
        + 'Мощность КЗ сети определяется подключённым вводом (узел «Городская сеть»). '
        + 'Полный импеданс: Z = Z<sub>сети</sub> × (U<sub>НН</sub>/U<sub>ВН</sub>)² + Z<sub>трансформатора</sub>.'
        + `</div>`);
    }
    if (isTransformer) {
      h.push(`<div class="field">
        <label>Напряжение КЗ трансформатора (Uk), %${helpIcon('Uk% — каталожное значение из паспорта трансформатора. Определяет полное сопротивление обмоток в режиме КЗ: Z_тр = Uk × U²ном / Snom. Типичные значения по ГОСТ 11677: 25–250 кВА → 4.0–4.5%; 400–630 кВА → 4.5–5.5%; 1000–2500 кВА → 5.5–6.0%. Чем меньше Uk — тем больше ток КЗ, но меньше падение напряжения при нагрузке.')}</label>
        <input type="number" id="imp-uk" min="0" max="25" step="0.5" value="${n.ukPct ?? 4.5}">
      </div>`);
    } else {
      h.push(`<div class="field">
        <label>Xd&apos;&apos; (сверхпереходное), о.е.${helpIcon('Сверхпереходное (subtransient) реактивное сопротивление генератора в относительных единицах. Определяет начальный ток КЗ (первые 5–10 мс): I_кз = U × 1.1 / (X_d&apos;&apos; × Z_base). Типичные значения для синхронных генераторов: 0.10–0.20 (явнополюсные малой/средней мощности); 0.15–0.25 (турбогенераторы).')}</label>
        <input type="number" id="imp-xdpp" min="0.01" max="1" step="0.01" value="${n.xdpp ?? 0.15}">
      </div>`);
    }
    h.push(`<div class="field">
      <label>Отношение Xs/Rs${helpIcon('Отношение реактивного к активному сопротивлению источника. Для городской сети 10 кВ типично 10:1 (Xs >> Rs); для трансформатора зависит от потерь Pk; для удалённой подстанции — выше. Влияет на угол сдвига фазы тока КЗ. Чем больше — тем «индуктивнее» источник.')}</label>
      <input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">
    </div>`);
  }

  if (isTransformer) {
    h.push('<h4 style="margin:16px 0 8px">Потери трансформатора</h4>');
    h.push(`<div class="field">
      <label>Потери КЗ (Pk), кВт${helpIcon('Pk — активные потери в опыте короткого замыкания (нагрев обмоток при номинальном токе). Из паспорта трансформатора или ГОСТ 11677. Используется для расчёта реальной нагрузки/потерь и эффективности при разной загрузке (P_loss_load = Pk × (load/Snom)²).')}</label>
      <input type="number" id="imp-pk" min="0" max="100" step="0.1" value="${n.pkW ?? 5.5}">
    </div>`);
    h.push(`<div class="field">
      <label>Потери ХХ (P0), кВт${helpIcon('P0 — активные потери холостого хода (нагрев магнитопровода). Не зависят от нагрузки — присутствуют пока трансформатор под напряжением. Из паспорта трансформатора. Влияют на годовые потери электроэнергии: W_loss = P0 × 8760 + Pk × (load/Snom)² × hours_load.')}</label>
      <input type="number" id="imp-p0" min="0" max="50" step="0.1" value="${n.p0W ?? 0.83}">
    </div>`);
  }

  if (!isTransformer && n.auxInput) {
    h.push('<h4 style="margin:16px 0 8px">Собственные нужды</h4>');
    h.push(`<div class="field">
      <label>Мощность СН, kW${helpIcon('Мощность собственных нужд генератора (СН) — потребление подогрева, зарядного устройства АКБ запуска, освещения шкафа, маслонасоса. Питается от внешней сети через auxInput, не от самого генератора. Типично 1–5 кВт для среднемощных ДГУ.')}</label>
      <input type="number" id="imp-auxKw" min="0" max="1000" step="0.1" value="${n.auxDemandKw || 0}">
    </div>`);
    h.push(`<div class="field">
      <label>cos φ СН${helpIcon('Коэффициент мощности нагрузки собственных нужд. Обычно 0.85 — стандартный для смешанной нагрузки (зарядное + подогрев + насосы).')}</label>
      <input type="number" id="imp-auxCos" min="0.1" max="1" step="0.01" value="${n.auxCosPhi || 0.85}">
    </div>`);
    h.push(`<div class="field check"><input type="checkbox" id="imp-auxBrk"${n.auxBreakerOn !== false ? ' checked' : ''}><label>Автомат СН включён</label></div>`);
  }

  // Вычисленные значения (справка)
  const U = nodeVoltage(n);
  const Zs = sourceImpedance(n);
  const IkMax = Zs > 0 ? (1.1 * U) / (Math.sqrt(3) * Zs) : Infinity;
  const Pkw = (n.snomKva || 0) * (Number(n.cosPhi) || 0.92);
  h.push(`<div class="inspector-section"><div style="font-size:12px;line-height:1.8">` +
    `Активная мощность (P = Snom × cos φ): <b>${fmt(Pkw)} kW</b><br>` +
    `Zs (полное сопротивление): <b>${(Zs * 1000).toFixed(2)} мОм</b><br>` +
    (isFinite(IkMax) ? `Ik max (c=1.1): <b>${fmt(IkMax / 1000)} кА</b> при ${U} В` : 'Ik: ∞ (Zs = 0)') +
    `</div></div>`);

  body.innerHTML = h.join('');
  try { _wrapModalWithSystemTabs(body, n); } catch {}

  // v0.59.631/632: live-обновление при смене активного режима ISO 8528.
  // Сохраняем текущие введённые значения, переписываем активный режим и
  // переоткрываем модалку — чтобы перерисовалась подсветка активной строки
  // и обновилась проверка достаточности под новый режим.
  const grModeEl = document.getElementById('gr-mode');
  if (grModeEl) {
    grModeEl.addEventListener('change', () => {
      // Снимаем текущие введённые значения в genRatings до пере-рендера.
      _applyGenIsoFields(n);
      n.genRatingMode = grModeEl.value;
      openImpedanceModal(n);
    });
  }

  const tCatEl = document.getElementById('imp-tCatalog');
  if (tCatEl) {
    tCatEl.addEventListener('change', () => {
      const val = Number(tCatEl.value);
      if (!val) return;
      const t = TRANSFORMER_CATALOG.find(x => x.snomKva === val);
      if (!t) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      set('imp-snom', t.snomKva);
      set('imp-uk', t.ukPct);
      set('imp-pk', t.pkW);
      set('imp-p0', t.p0W);
      set('imp-xsrs', t.xsRsRatio);
    });
  }

  const applyBtn = document.getElementById('impedance-apply');
  if (applyBtn) applyBtn.onclick = () => {
    if (n.id !== '__preset_edit__') snapshot('impedance:' + n.id);
    // v0.57.68: preserve-on-miss. Установленные пользователем параметры
    // НЕЛЬЗЯ затирать дефолтами, если в DOM нет элемента или значение
    // пустое. Читаем только когда есть живое число — иначе оставляем n.*
    // как было. См. feedback_user_params.md.
    const readNum = (id, curr) => {
      const el = document.getElementById(id);
      if (!el) return curr;
      const raw = String(el.value ?? '').trim();
      if (raw === '') return curr;
      const v = Number(raw);
      return Number.isFinite(v) ? v : curr;
    };
    const readStr = (id, curr) => {
      const el = document.getElementById(id);
      if (!el) return curr;
      const raw = String(el.value ?? '').trim();
      return raw === '' ? curr : raw;
    };
    const impName = document.getElementById('imp-name')?.value?.trim();
    if (impName) n.name = impName;
    if (!isUtility) {
      // v0.59.631: для генератора — read ISO 8528 поля; они САМИ синхронизируют
      // n.snomKva и n.capacityKw с активным режимом (см. _applyGenIsoFields).
      // imp-snom для ДГУ не показывается. Для трансформатора и прочих — читаем.
      if (subtype === 'generator') {
        _applyGenIsoFields(n);
      } else {
        n.snomKva = readNum('imp-snom', n.snomKva ?? 400);
      }
    }
    const levels = GLOBAL.voltageLevels || [];
    const outEl = document.getElementById('imp-voltage-out');
    if (outEl && String(outEl.value ?? '').trim() !== '') {
      const outLevelIdx = Number(outEl.value);
      if (Number.isFinite(outLevelIdx)) {
        n.voltageLevelIdx = outLevelIdx;
        if (levels[outLevelIdx]) {
          n.voltage = levels[outLevelIdx].vLL;
          n.phase = '3ph'; // источники всегда 3-фазные
        }
      }
    }
    if (isTransformer) {
      const inEl = document.getElementById('imp-voltage-in');
      if (inEl && String(inEl.value ?? '').trim() !== '') {
        const v = Number(inEl.value);
        if (Number.isFinite(v)) n.inputVoltageLevelIdx = v;
      }
      n.vectorGroup = readStr('imp-vectorGroup', n.vectorGroup || 'Dyn11');
    }
    if (!isUtility) {
      n.capacityKw = (n.snomKva || 0) * (Number(n.cosPhi) || 0.92);
    } else {
      // Phase 1.20.39: utility — capacityKw из ТУ (ввод вручную)
      const pmaxEl = document.getElementById('imp-utility-pmax');
      if (pmaxEl && String(pmaxEl.value ?? '').trim() !== '') {
        const v = Number(pmaxEl.value);
        if (Number.isFinite(v)) n.capacityKw = Math.max(0, v);
      }
      // v0.59.605 (Phase 18): целевой cos φ для расчёта компенсации Q.
      const targetEl = document.getElementById('imp-utility-targetCos');
      if (targetEl && String(targetEl.value ?? '').trim() !== '') {
        const tv = Number(targetEl.value);
        if (Number.isFinite(tv)) n.compTargetCosPhi = Math.max(0.7, Math.min(1.0, tv));
      }
    }
    if (isOther || isUtility) {
      n.ikKA = readNum('imp-ikka', n.ikKA ?? 0);
      n.sscMva = readNum('imp-ssc', n.sscMva ?? 0);
      delete n.ukPct;
      delete n.xdpp;
      delete n.pkW;
      delete n.p0W;
      if (isUtility) delete n.inputVoltageLevelIdx;
    } else {
      n.sscMva = readNum('imp-ssc', n.sscMva ?? 500);
      if (isTransformer) {
        n.ukPct = readNum('imp-uk', n.ukPct ?? 4.5);
      } else {
        n.xdpp = readNum('imp-xdpp', n.xdpp ?? 0.15);
      }
    }
    n.xsRsRatio = readNum('imp-xsrs', n.xsRsRatio ?? 10);
    if (isTransformer) {
      n.pkW = readNum('imp-pk', n.pkW ?? 5.5);
      n.p0W = readNum('imp-p0', n.p0W ?? 0.83);
    }
    if (!isTransformer && n.auxInput) {
      n.auxDemandKw = readNum('imp-auxKw', n.auxDemandKw ?? 0);
      n.auxCosPhi = readNum('imp-auxCos', n.auxCosPhi ?? 0.85);
      const brkEl = document.getElementById('imp-auxBrk');
      if (brkEl) n.auxBreakerOn = brkEl.checked !== false;
    }
    if (n.id === '__preset_edit__' && window.Raschet?._presetEditCallback) {
      window.Raschet._presetEditCallback(n);
      document.getElementById('modal-impedance').classList.add('hidden');
      return;
    }
    document.getElementById('modal-impedance').classList.add('hidden');
    render();
    _invokeRenderInspector();
    notifyChange();
    flash('Параметры источника обновлены');
  };

  // v0.60.226: запоминаем nodeId на модалке — main.js apply-handler по этому
  // атрибуту понимает что модалка открыта для этого узла и нужно её
  // перерисовать (иначе stale-данные после применения dgu-config).
  const _mImp = document.getElementById('modal-impedance');
  if (_mImp) {
    _mImp.dataset.nodeId = n && n.id ? String(n.id) : '';
    _mImp.classList.remove('hidden');
  }
}

// ================= Модалка «Режим работы и номиналы (ISO 8528)» =================
// v0.59.627/631 (Phase B): режимы работы ДГУ по ISO 8528-1:2018.
// У каждого режима — своя пара рейтингов (kW, kVA), потому что производитель
// допускает разную нагрузку в зависимости от продолжительности и характера.
//
// Сортировка — по нарастанию рейтинга (от самого требовательного, с минимальной
// допустимой P, к самому щадящему). Типичные соотношения для дизельных ДГУ:
//   ESP > LTP ≈ ESP × 0.91 > PRP ≈ ESP × 0.91 > DCC ≈ PRP > COP ≈ PRP × 0.90
// Юзер (v0.59.632): «DCC максимально близок к PRP, иногда даже такой же,
// так что по порядку поставь его ниже COP» → COP < DCC < PRP < LTP < ESP.
//
//   COP (Continuous Operating Power)— неограниченное время, постоянная нагрузка
//                                    (off-grid). Самая низкая допустимая P.
//   DCC (Data Center Continuous)  — continuous + кратковременные step-load
//                                    (mission-critical DC). Рейтинг ~PRP.
//   PRP (Prime Power)             — неограниченные часы, переменная нагрузка
//                                    со средней ≤70% от PRP-рейтинга.
//   LTP (Limited Time Prime)      — ≤500 ч/год, постоянная номинальная.
//   ESP (Emergency Standby Power) — ≤200 ч/год, средняя ≤25%/год. Только для
//                                    аварийного резерва. Самая высокая P.
//
// v0.59.631: убран EMG — это не термин ISO 8528, а маркетинговое обозначение
// некоторых производителей. По стандарту используем только ESP.
//
// Источник: ISO 8528-1:2018 §13.3.
// v0.59.632: DCC переставлен между COP и PRP — по рейтингу он близок к PRP
// (юзер: «DCC максимально близок к режиму PRP, иногда даже такой же,
// так что по порядку поставь его ниже COP»).
const GEN_RATING_MODES = [
  { id: 'COP', label: 'COP — Continuous Operating Power',  hint: 'неограниченное время, постоянная номинальная нагрузка (off-grid)' },
  { id: 'DCC', label: 'DCC — Data Center Continuous',      hint: 'continuous с возможностью кратковременных скачков нагрузки (mission-critical DC); рейтинг ~ PRP' },
  { id: 'PRP', label: 'PRP — Prime Power',                 hint: 'неограниченные часы, переменная нагрузка со средней ≤70% от PRP-рейтинга' },
  { id: 'LTP', label: 'LTP — Limited Time Prime',          hint: '≤500 ч/год, постоянная номинальная нагрузка' },
  { id: 'ESP', label: 'ESP — Emergency Standby Power',     hint: '≤200 ч/год, ср. нагрузка ≤25% от ESP-рейтинга; типичный режим для аварийного резерва' },
];
function _genRatingDefaults() {
  // Типичное соотношение между режимами для дизельных ДГУ:
  //   ESP / EMG = 1.10 × PRP
  //   LTP       = 1.00 × PRP (паспортно может слегка отличаться)
  //   COP       = 0.90 × PRP
  //   DCC       = 0.95 × PRP (производители для DC)
  // По дефолту — пустые поля, чтобы пользователь ввёл по табличке производителя.
  const out = {};
  for (const m of GEN_RATING_MODES) out[m.id] = { kW: null, kVA: null };
  return out;
}
// v0.59.631: блок ISO 8528 для генератора, встраивается в openImpedanceModal
// (юзер: «не используй настройку в нескольких местах, только в Параметры
// источника»). Возвращает HTML-строку. Apply-handler в openImpedanceModal
// читает поля по data-gr-mode/data-gr-field + #gr-mode + #gr-cosPhi.
function _renderGenIsoBlock(n) {
  const ratings = (n.genRatings && typeof n.genRatings === 'object') ? n.genRatings : _genRatingDefaults();
  const curMode = n.genRatingMode || 'ESP';
  const cosNom = Number(n.genCosPhi) || 0.8;
  // v0.60.224 (по репорту Пользователя 2026-05-04 «таблицу можно оставить
  // справочно, без возможности редактировать»): когда модель применена из
  // dgu-config (n.appliedConfig.dgu), таблица kW/kVA — read-only. Поля
  // показываются справочно, но недоступны для правки. Изменить можно только
  // через переоткрытие конфигуратора.
  const isAppliedFromCfg = !!(n.appliedConfig && n.appliedConfig.dgu);
  const sel = isAppliedFromCfg ? (n.appliedConfig.dgu.selected || {}) : {};
  const h = [];
  h.push('<div class="muted" style="font-size:11px;margin-bottom:8px;line-height:1.5">');
  if (isAppliedFromCfg) {
    h.push(`<div style="padding:8px 10px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:3px;color:#14532d;margin-bottom:8px;font-size:11.5px">
      🔒 <b>Таблица заполнена из ДГУ-конфигуратора</b>${sel.vendor || sel.model ? ' (' + escHtml((sel.vendor || '') + ' ' + (sel.model || '')).trim() + ')' : ''}.
      Значения — паспортные данные модели по ISO 8528. Для изменения <a href="../dgu-config/?nodeId=${escAttr(n.id)}" target="_blank" style="color:#1d4ed8">переоткройте конфигуратор</a> и выберите другую модель.
    </div>`);
  }
  h.push('Стандарт <b>ISO 8528-1:2018</b> определяет 5 режимов работы ДГУ. ');
  h.push('Сортировка ниже — по нарастанию рейтинга: COP &lt; DCC ≈ PRP &lt; LTP &lt; ESP. ');
  if (!isAppliedFromCfg) {
    h.push('У каждого режима свой допустимый рейтинг по kW и kVA — заполните по табличке производителя. ');
  }
  h.push('Программа проверяет достаточность по <b>обоим</b> (kW + kVA) против наиболее тяжёлого режима нагрузки.');
  h.push('</div>');

  let opts = '';
  for (const m of GEN_RATING_MODES) {
    opts += `<option value="${m.id}"${curMode === m.id ? ' selected' : ''}>${escHtml(m.label)}</option>`;
  }
  h.push(`<div class="field">
    <label>Активный режим работы (ISO 8528)${helpIcon('Режим работы ДГУ по ISO 8528-1. ESP (Emergency Standby) — резервное питание при отказе сети, до 200 ч/год. PRP (Prime) — основной источник в местах без сети, без ограничения часов, но с переменной нагрузкой. COP (Continuous) — постоянная работа с фиксированной нагрузкой 100% времени. LTP (Limited-Time Prime) — расширенный PRP с ограничением до 500 ч/год. Каждый режим имеет свой паспортный номинал.')}</label>
    <select id="gr-mode">${opts}</select>
  </div>`);
  const curHint = (GEN_RATING_MODES.find(m => m.id === curMode) || {}).hint || '';
  h.push(`<div class="muted" id="gr-mode-hint" style="font-size:11px;margin-top:-4px;margin-bottom:8px;line-height:1.4;color:#475569">${escHtml(curHint)}</div>`);

  // v0.59.665/686: methodology-aware label + helpIcon с tooltip-справкой.
  // v0.60.224: cos φ read-only при apply из dgu-config (паспортное значение).
  {
    const _cosT = getTerm('powerFactor', GLOBAL.calcMethod || 'iec');
    const _cosTip = getTermTooltip('powerFactor', GLOBAL.calcMethod || 'iec');
    const _fullTip = (_cosTip || '') + ' По умолчанию 0.80 (ISO 8528-1 §7.2.2). Если задано только одно из kW/kVA — другое посчитается через cos φ на Apply.';
    const _ro = isAppliedFromCfg ? ' readonly tabindex="-1"' : '';
    const _roBg = isAppliedFromCfg ? 'background:#f1f5f9;cursor:not-allowed' : '';
    h.push(`<div class="field">
      <label>Номинальный ${escHtml(_cosT.label)} ДГУ${helpIcon(_fullTip)}</label>
      <input type="number" id="gr-cosPhi" min="0.5" max="1.0" step="0.01" value="${cosNom}"${_ro} style="${_roBg}">
    </div>`);
  }

  // v0.59.632: проверка — пустой ли активный режим (когда другие заполнены).
  const activeRating = ratings[curMode] || {};
  const activeFilled = (Number(activeRating.kW) > 0) && (Number(activeRating.kVA) > 0);
  const anyOtherFilled = Object.keys(ratings).some(id => id !== curMode &&
    Number(ratings[id]?.kW) > 0 && Number(ratings[id]?.kVA) > 0);
  if (!activeFilled && anyOtherFilled) {
    h.push(`<div style="margin-bottom:8px;padding:8px 10px;background:#fef2f2;border-left:3px solid #b91c1c;border-radius:3px;font-size:11.5px;color:#991b1b;line-height:1.5">
      ⚠ <b>Активный режим «${escHtml(curMode)}» не заполнен.</b> Заполни строку <b>${escHtml(curMode)}</b> в таблице ниже, или смени активный режим на тот, что уже заполнен. Сейчас проверка достаточности показывает 0%.
    </div>`);
  }

  h.push('<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px"><thead><tr style="background:#f6f8fa">');
  h.push('<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #d0d7de">Режим</th>');
  h.push('<th style="text-align:right;padding:6px 8px;border-bottom:1px solid #d0d7de;width:90px">kW</th>');
  h.push('<th style="text-align:right;padding:6px 8px;border-bottom:1px solid #d0d7de;width:90px">kVA</th>');
  h.push('</tr></thead><tbody>');
  for (const m of GEN_RATING_MODES) {
    const r = ratings[m.id] || { kW: null, kVA: null };
    const kW  = (r.kW  != null && Number.isFinite(Number(r.kW)))  ? Number(r.kW)  : '';
    const kVA = (r.kVA != null && Number.isFinite(Number(r.kVA))) ? Number(r.kVA) : '';
    // v0.59.632: подсветка активной строки + ⚡ маркер.
    const isActive = m.id === curMode;
    const rowStyle = isActive
      ? 'background:#dbeafe;border-left:3px solid #1d4ed8'
      : 'border-left:3px solid transparent';
    const idCell = isActive
      ? `<b style="color:#1d4ed8">⚡ ${escHtml(m.id)}</b>`
      : `<b>${escHtml(m.id)}</b>`;
    // v0.60.224: read-only когда применено из dgu-config (см. isAppliedFromCfg).
    const _ro = isAppliedFromCfg ? ' readonly tabindex="-1"' : '';
    const _roBg = isAppliedFromCfg ? ';background:#f1f5f9;cursor:not-allowed' : '';
    h.push(`<tr style="border-bottom:1px solid #f1f5f9;${rowStyle}">
      <td style="padding:6px 8px">${idCell} <span class="muted" style="font-size:10px">${escHtml(m.label.replace(/^[^—]*— ?/, ''))}</span></td>
      <td style="padding:4px 8px;text-align:right"><input type="number" min="0" step="1" data-gr-mode="${escHtml(m.id)}" data-gr-field="kW"  value="${kW}" ${_ro} style="width:80px;padding:3px 6px;text-align:right${isActive ? ';border:1.5px solid #1d4ed8;background:#eff6ff' : ''}${_roBg}"></td>
      <td style="padding:4px 8px;text-align:right"><input type="number" min="0" step="1" data-gr-mode="${escHtml(m.id)}" data-gr-field="kVA" value="${kVA}" ${_ro} style="width:80px;padding:3px 6px;text-align:right${isActive ? ';border:1.5px solid #1d4ed8;background:#eff6ff' : ''}${_roBg}"></td>
    </tr>`);
  }
  h.push('</tbody></table>');
  h.push(`<div class="muted" style="font-size:10px;margin-top:4px;color:#1d4ed8">⚡ — активный режим (используется для проверки достаточности). Сменить можно через селектор «Активный режим работы» вверху.</div>`);

  // v0.59.631: проверка достаточности — используем _maxLoadKw для backup ДГУ
  // (текущий _powerP=0 у не-активного резерва). Считаем kVA через cos φ
  // worst-case: S_max = P_max / cos_worst.
  const r = ratings[curMode] || {};
  const ratedKw = Number(r.kW) || 0;
  const ratedKva = Number(r.kVA) || 0;
  const cosW = Number(n._cosPhiWorst) || Number(n._cosPhi) || cosNom;
  const Pmax = Number(n._maxLoadKw) || Number(n._powerPWorst) || Number(n._powerP) || 0;
  const Smax = (Pmax > 0 && cosW > 0) ? (Pmax / cosW) : 0;
  const utilP = ratedKw > 0 ? (Pmax / ratedKw) : 0;
  const utilS = ratedKva > 0 ? (Smax / ratedKva) : 0;
  const util = Math.max(utilP, utilS);
  let status = '—', color = '#6b7280';
  if (ratedKw > 0 && ratedKva > 0 && Pmax > 0) {
    if (util > 1.0)        { status = '⛔ Недостаточно'; color = '#b91c1c'; }
    else if (util >= 0.85) { status = '⚠ Достаточно (близко к пределу)'; color = '#c2410c'; }
    else if (util >= 0.50) { status = '✓ Нормально'; color = '#15803d'; }
    else                   { status = 'ℹ Слишком много (oversized, <50%)'; color = '#0369a1'; }
  } else if (ratedKw > 0 && ratedKva > 0 && Pmax === 0) {
    status = 'нет downstream-нагрузки на ДГУ'; color = '#6b7280';
  }
  h.push(`<div style="margin-top:10px;padding:8px 10px;background:#f0f9ff;border-radius:4px;font-size:11px;line-height:1.7">
    <b>Проверка достаточности по наиболее тяжёлому режиму нагрузки:</b><br>
    Нагрузка (все ИБП в байпасе): <b>${Pmax.toFixed(2)} kW</b> · <b>${Smax.toFixed(2)} kVA</b> <span class="muted">(cos φ ${cosW.toFixed(3)})</span><br>
    Рейтинг ${escHtml(curMode)}: <b>${ratedKw ? ratedKw.toFixed(0) : '—'} kW</b> · <b>${ratedKva ? ratedKva.toFixed(0) : '—'} kVA</b><br>
    Загрузка: kW <b>${(utilP * 100).toFixed(0)}%</b> · kVA <b>${(utilS * 100).toFixed(0)}%</b> → max <b>${(util * 100).toFixed(0)}%</b><br>
    Статус: <b style="color:${color}">${status}</b>
  </div>`);

  return h.join('');
}
// v0.59.631: helper для apply-handler в openImpedanceModal — читает поля
// ISO 8528 и пишет в n.genRatings / n.genRatingMode / n.genCosPhi + sync.
function _applyGenIsoFields(n) {
  const modeEl = document.getElementById('gr-mode');
  if (!modeEl) return; // не на ДГУ
  n.genRatingMode = modeEl.value || 'ESP';
  const newCos = Number(document.getElementById('gr-cosPhi')?.value);
  if (Number.isFinite(newCos) && newCos >= 0.5 && newCos <= 1.0) n.genCosPhi = newCos;
  const cos = Number(n.genCosPhi) || 0.8;
  const next = {};
  for (const m of GEN_RATING_MODES) next[m.id] = { kW: null, kVA: null };
  document.querySelectorAll('[data-gr-mode]').forEach(inp => {
    const mode = inp.getAttribute('data-gr-mode');
    const fld = inp.getAttribute('data-gr-field');
    const raw = String(inp.value || '').trim();
    if (raw === '') return;
    const v = Number(raw);
    if (!(Number.isFinite(v) && v > 0)) return;
    if (!next[mode]) next[mode] = { kW: null, kVA: null };
    next[mode][fld] = v;
  });
  // Auto-fill: если одно из kW/kVA задано — посчитать другое через cos φ.
  for (const m of GEN_RATING_MODES) {
    const r = next[m.id];
    if (r.kW && !r.kVA && cos > 0)  r.kVA = Math.round(r.kW / cos);
    if (r.kVA && !r.kW && cos > 0)  r.kW = Math.round(r.kVA * cos);
  }
  n.genRatings = next;
  // v0.59.632: авто-переключение активного режима, если выбранный пуст
  // и есть заполненные. Берём первый заполненный по порядку GEN_RATING_MODES
  // (DCC → COP → PRP → LTP → ESP — по нарастанию рейтинга).
  const activeR = next[n.genRatingMode] || {};
  if (!(Number(activeR.kW) > 0 && Number(activeR.kVA) > 0)) {
    for (const m of GEN_RATING_MODES) {
      const r = next[m.id];
      if (Number(r.kW) > 0 && Number(r.kVA) > 0) {
        n.genRatingMode = m.id;
        break;
      }
    }
  }
  // Синхронизация capacityKw / snomKva с активным режимом.
  const active = next[n.genRatingMode] || {};
  if (active.kW)  n.capacityKw = active.kW;
  if (active.kVA) n.snomKva    = active.kVA;
}

// ================= Модалка «Автоматизация» =================
export function openAutomationModal(n) {
  const body = document.getElementById('automation-body');
  if (!body) return;
  const h = [];

  h.push(`<h3>Автоматизация ${escHtml(effectiveTag(n))} ${escHtml(n.name)}</h3>`);
  h.push('<div class="muted" style="font-size:11px;margin-bottom:12px">Задайте условия запуска генератора. Каждый сценарий: при потере напряжения на указанных вводах → запуск ДГУ и (опционально) коммутация выходов щита. Для простого резервного ДГУ достаточно одного сценария без выходов.</div>');

  let groups = Array.isArray(n.triggerGroups) && n.triggerGroups.length
    ? n.triggerGroups
    : [];
  if (!groups.length) {
    const legacyIds = (Array.isArray(n.triggerNodeIds) && n.triggerNodeIds.length)
      ? n.triggerNodeIds
      : (n.triggerNodeId ? [n.triggerNodeId] : []);
    if (legacyIds.length) {
      groups = [{ name: 'Резерв', watchInputs: legacyIds.map(id => ({ nodeId: id })), logic: n.triggerLogic || 'any', activateOutputs: [] }];
    }
  }

  // v0.59.845: natural-sort (PNL01<PNL02<PNL10).
  const panels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.inputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru', { numeric: true, sensitivity: 'base' }));

  const switchPanels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.outputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru', { numeric: true, sensitivity: 'base' }));

  let switchPanelId = n.switchPanelId || null;
  if (!switchPanelId) {
    for (const c of state.conns.values()) {
      if (c.from.nodeId === n.id) {
        const to = state.nodes.get(c.to.nodeId);
        if (to && to.type === 'panel') { switchPanelId = to.id; break; }
      }
    }
  }

  let switchOpts = '<option value="">— нет (простой резервный)</option>';
  for (const sp of switchPanels) {
    const sel = sp.id === switchPanelId ? ' selected' : '';
    switchOpts += `<option value="${escAttr(sp.id)}"${sel}>${escHtml(effectiveTag(sp))} — ${escHtml(sp.name || '')} (${sp.outputs} вых.)</option>`;
  }
  h.push(field('Щит коммутации (опционально)', `<select id="auto-switch-panel">${switchOpts}</select>`));
  h.push('<div class="muted" style="font-size:11px;margin-top:-6px;margin-bottom:10px">Для подменного ДГУ — выберите щит, автоматы которого будут коммутироваться. Для простого резервного — оставьте «нет».</div>');

  const downstreamPanel = switchPanelId ? state.nodes.get(switchPanelId) : null;

  for (let gi = 0; gi < Math.max(groups.length, 1); gi++) {
    const grp = groups[gi] || { name: '', watchInputs: [], logic: 'any', activateOutputs: [] };
    const grpName = grp.name || `Сценарий ${gi + 1}`;
    h.push(`<details class="inspector-section" style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:10px" data-grp-idx="${gi}"${gi === 0 ? ' open' : ''}>`);
    h.push(`<summary style="cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px"><span style="flex:1">${escHtml(grpName)}</span>`);
    if (groups.length > 1) {
      h.push(`<button type="button" data-grp-delete="${gi}" style="font-size:14px;color:#c62828;background:none;border:none;cursor:pointer;padding:2px" title="Удалить">×</button>`);
    }
    h.push('</summary>');
    h.push(`<div style="margin-top:8px">`);
    h.push(field('Имя', `<input type="text" data-grp-name="${gi}" value="${escAttr(grp.name || '')}" placeholder="Сценарий ${gi+1}">`));

    h.push('<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Условие запуска (ввод щита без питания):</div>');
    const watches = Array.isArray(grp.watchInputs) ? grp.watchInputs : [];

    const allInputs = [];
    for (const p of panels) {
      for (let port = 0; port < p.inputs; port++) {
        let feederTag = '—';
        for (const c of state.conns.values()) {
          if (c.to.nodeId === p.id && c.to.port === port) {
            const from = state.nodes.get(c.from.nodeId);
            feederTag = from ? (effectiveTag(from) || from.name || '?') : '?';
            break;
          }
        }
        const panelTag = effectiveTag(p) || p.tag || '';
        allInputs.push({ panelId: p.id, port, panelTag, feederTag });
      }
    }
    allInputs.sort((a, b) => a.panelTag.localeCompare(b.panelTag, 'ru', { numeric: true, sensitivity: 'base' }) || a.port - b.port);

    for (const inp of allInputs) {
      const isChecked = watches.some(w => w.panelId === inp.panelId && w.inputPort === inp.port);
      const label = `${escHtml(inp.panelTag)} вход ${inp.port + 1} (от ${escHtml(inp.feederTag)})`;
      h.push(`<div class="field check" style="font-size:11px"><input type="checkbox" data-grp-watch="${gi}" data-panel="${escAttr(inp.panelId)}" data-port="${inp.port}"${isChecked ? ' checked' : ''}><label>${label}</label></div>`);
    }

    const gLogic = grp.logic || 'any';
    h.push(`<select data-grp-logic="${gi}" style="font-size:11px;margin:4px 0">
      <option value="any"${gLogic === 'any' ? ' selected' : ''}>ANY — хотя бы один мёртв</option>
      <option value="all"${gLogic === 'all' ? ' selected' : ''}>ALL — все мертвы</option>
    </select>`);

    if (downstreamPanel) {
      h.push(`<div style="font-size:12px;font-weight:600;margin:8px 0 4px">Включить выходы ${escHtml(effectiveTag(downstreamPanel))}:</div>`);
      const activeOuts = new Set(Array.isArray(grp.activateOutputs) ? grp.activateOutputs : []);
      for (let oi = 0; oi < (downstreamPanel.outputs || 0); oi++) {
        let destTag = '—';
        for (const c of state.conns.values()) {
          if (c.from.nodeId === downstreamPanel.id && c.from.port === oi) {
            const to = state.nodes.get(c.to.nodeId);
            destTag = to ? (effectiveTag(to) || to.name || '?') : '?';
            break;
          }
        }
        const checked = activeOuts.has(oi);
        h.push(`<div class="field check" style="font-size:11px"><input type="checkbox" data-grp-output="${gi}" data-out-idx="${oi}"${checked ? ' checked' : ''}><label>Выход ${oi + 1} → ${escHtml(destTag)}</label></div>`);
      }
    } else {
      h.push('<div class="muted" style="font-size:11px;color:#c62828">Выберите щит коммутации выше.</div>');
    }
    h.push('</div></details>');
  }

  h.push(`<button type="button" id="auto-add-group" style="font-size:12px;padding:5px 12px;border:1px dashed #999;background:transparent;border-radius:4px;cursor:pointer;width:100%;margin-top:4px">+ Добавить сценарий</button>`);

  h.push('<h4 style="margin:16px 0 8px">Задержки</h4>');
  h.push(`<div class="field">
    <label>Задержка запуска, сек${helpIcon('Время от команды запуска до выхода на номинальные обороты и принятие нагрузки. Стандартно 5–15 сек для современных ДГУ с предпусковым подогревом; до 60 сек для ДГУ без подогрева в холодный период.')}</label>
    <input type="number" id="auto-startDelay" min="0" max="600" step="1" value="${n.startDelaySec || 0}">
  </div>`);
  h.push(`<div class="field">
    <label>Задержка остановки, сек${helpIcon('Время остывания двигателя после снятия нагрузки до полной остановки. Обычно 60–300 сек — позволяет двигателю охладиться при работе в холостую, продлевая ресурс. Без этой задержки — резкая остановка нагретого двигателя сокращает срок службы.')}</label>
    <input type="number" id="auto-stopDelay" min="0" max="600" step="1" value="${n.stopDelaySec ?? 2}">
  </div>`);
  h.push('</div>');

  body.innerHTML = h.join('');

  const switchPanelSelect = document.getElementById('auto-switch-panel');
  if (switchPanelSelect) {
    switchPanelSelect.addEventListener('change', () => {
      n.switchPanelId = switchPanelSelect.value || null;
      openAutomationModal(n);
    });
  }

  const addBtn = document.getElementById('auto-add-group');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!Array.isArray(n.triggerGroups)) n.triggerGroups = [];
      n.triggerGroups.push({ name: '', watchInputs: [], logic: 'any', activateOutputs: [] });
      openAutomationModal(n);
    });
  }

  body.querySelectorAll('[data-grp-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gi = Number(btn.dataset.grpDelete);
      if (Array.isArray(n.triggerGroups) && n.triggerGroups[gi]) {
        n.triggerGroups.splice(gi, 1);
      }
      openAutomationModal(n);
    });
  });

  const applyBtn = document.getElementById('automation-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      snapshot('automation:' + n.id);

      const spSel = document.getElementById('auto-switch-panel');
      n.switchPanelId = spSel ? (spSel.value || null) : null;

      const newGroups = [];
      body.querySelectorAll('[data-grp-idx]').forEach(el => {
        const gi = Number(el.dataset.grpIdx);
        const nameInput = el.querySelector(`[data-grp-name="${gi}"]`);
        const logicSelect = el.querySelector(`[data-grp-logic="${gi}"]`);

        const watchInputs = [];
        el.querySelectorAll(`[data-grp-watch="${gi}"]`).forEach(cb => {
          if (cb.checked) {
            watchInputs.push({ panelId: cb.dataset.panel, inputPort: Number(cb.dataset.port) });
          }
        });

        const activateOutputs = [];
        el.querySelectorAll(`[data-grp-output="${gi}"]`).forEach(cb => {
          if (cb.checked) activateOutputs.push(Number(cb.dataset.outIdx));
        });

        newGroups.push({
          name: nameInput ? nameInput.value : '',
          watchInputs,
          logic: logicSelect ? logicSelect.value : 'any',
          activateOutputs,
        });
      });

      n.triggerGroups = newGroups;
      n.triggerNodeIds = [];
      n.triggerNodeId = null;

      // v0.57.71: preserve-on-miss
      const _rd = (id, curr) => {
        const el = document.getElementById(id);
        if (!el) return curr;
        const raw = String(el.value ?? '').trim();
        if (raw === '') return curr;
        const v = Number(raw);
        return Number.isFinite(v) ? v : curr;
      };
      n.startDelaySec = _rd('auto-startDelay', n.startDelaySec ?? 0);
      n.stopDelaySec = _rd('auto-stopDelay', n.stopDelaySec ?? 2);

      document.getElementById('modal-automation').classList.add('hidden');
      render();
      _invokeRenderInspector();
      notifyChange();
      flash('Автоматизация обновлена');
    };
  }

  document.getElementById('modal-automation').classList.remove('hidden');
}

// ================= Запрос на ТУ (технические условия) =================
// v0.59.689: формирует развёрнутый расчётный документ для запроса в
// электроснабжающую организацию (РЭС / Россети).
// v0.59.702: вызов с n=null — режим «по проекту»: автоматически находит
// источники по выбранной стороне присоединения. Пользователь:
// «Получение ТУ вынеси в свойства проекта, сделай выбор, ТУ по низкой
// стороне или ТУ по высокой стороне».
export function openTuRequestModal(n) {
  const body = document.getElementById('tu-request-body');
  if (!body) return;
  // Определяем сторону присоединения: HV (>1000 В) или LV (≤1000 В).
  // Сторона хранится в проектных tuDefaults.side; по умолчанию LV
  // (типичный сценарий — РЭС подключает на 0.4 кВ).
  let activeProjectId = null;
  let projectMeta = {};
  try {
    activeProjectId = getActiveProjectId();
    const proj = activeProjectId ? getProject(activeProjectId) : null;
    projectMeta = (proj && proj.tuDefaults) || {};
    // v0.59.711: цепочка fallback'ов для автозаполнения полей ТУ из
    // свойств проекта. Приоритет:
    //   1) tuDefaults (явно заданные значения для ТУ)
    //   2) state.project.customer / object / name (поля «Информация о
    //      проекте» — модалка «📋 Параметры проекта…»)
    //   3) Зарегистрированный в project-storage project.name / description
    const stateProj = (state.project && typeof state.project === 'object') ? state.project : {};
    if (!projectMeta.applicant) {
      projectMeta = { ...projectMeta, applicant: stateProj.customer || proj?.name || '' };
    }
    if (!projectMeta.address) {
      projectMeta = { ...projectMeta, address: stateProj.object || proj?.description || '' };
    }
    if (!projectMeta.purpose) {
      projectMeta = { ...projectMeta, purpose: stateProj.name || '' };
    }
  } catch {}
  // Сторона: 'lv' или 'hv'. По умолчанию из projectMeta или 'lv'.
  const _initialSide = projectMeta.side === 'hv' ? 'hv' : 'lv';
  // Helper: найти подходящий источник по стороне.
  // LV: предпочитаем трансформатор (его выход = LV) или utility с U ≤ 1000.
  // HV: предпочитаем utility с U > 1000.
  const _findSourceForSide = (side) => {
    const sources = [...state.nodes.values()].filter(m =>
      m.type === 'source' || m.type === 'generator');
    if (side === 'hv') {
      const utilHv = sources.find(m =>
        (m.sourceSubtype || 'transformer') === 'utility' && nodeVoltage(m) > 1000);
      if (utilHv) return utilHv;
      // fallback: трансформатор с входом ВН — ищем входящий utility
      const trafo = sources.find(m =>
        (m.sourceSubtype || 'transformer') === 'transformer');
      return trafo || sources[0] || null;
    }
    // LV
    const trafoLv = sources.find(m =>
      (m.sourceSubtype || 'transformer') === 'transformer' && nodeVoltage(m) <= 1000);
    if (trafoLv) return trafoLv;
    const utilLv = sources.find(m =>
      (m.sourceSubtype || 'transformer') === 'utility' && nodeVoltage(m) <= 1000);
    if (utilLv) return utilLv;
    // fallback: первый источник (если в схеме только utility HV — взять его)
    return sources[0] || null;
  };
  // Если n не передан (вызов из свойств страницы) — выбираем по стороне.
  // Если n передан (legacy — вызов из инспектора utility) — используем его
  // и стороной считаем класс его напряжения.
  let refNode = n || _findSourceForSide(_initialSide);
  let side = _initialSide;
  if (n) side = nodeVoltage(n) > 1000 ? 'hv' : 'lv';
  const _renderModal = () => {
  // Аккумулируем downstream через ref._maxLoadKw / _powerQ / _powerS — они
  // уже посчитаны в recalc. Если есть — берём максимум из текущего и
  // worst-case (байпас ИБП).
  const Pcur = Number(refNode?._powerP || refNode?._loadKw) || 0;
  const Qcur = Number(refNode?._powerQ) || 0;
  const Scur = Number(refNode?._powerS) || Math.sqrt(Pcur * Pcur + Qcur * Qcur);
  const Pmax = Math.max(Number(refNode?._maxLoadKw) || 0, Number(refNode?._powerPWorst) || 0, Pcur);
  const Qmax = Math.max(Number(refNode?._powerQWorst) || 0, Qcur);
  const Smax = Math.max(Number(refNode?._powerSWorst) || 0, Scur,
                        Pmax > 0 ? Math.sqrt(Pmax * Pmax + Qmax * Qmax) : 0);
  const cosCur = Scur > 0 ? (Pcur / Scur) : 0;
  const cosWorst = Smax > 0 ? (Pmax / Smax) : cosCur;
  const Imax = Number(refNode?._maxLoadA) || Number(refNode?._loadA) || 0;
  const Uvolt = refNode ? nodeVoltage(refNode) : 0;
  const Uclass = Uvolt > 0 ? cableVoltageClass(Uvolt) : '—';
  // Классификация по ПУЭ 1.2 — для подсказки. По умолчанию категория 2,
  // если есть резервный источник (ДГУ или ещё один utility) — 1.
  const hasGenerator = [...state.nodes.values()].some(m =>
    m.type === 'generator' && m.backupMode);
  const hasParallelUtility = [...state.nodes.values()].some(m =>
    m.id !== (refNode?.id) && m.type === 'source' && (m.sourceSubtype || 'transformer') === 'utility');
  const hasUps = [...state.nodes.values()].some(m => m.type === 'ups');
  let suggestedCat = 2;
  if (hasParallelUtility && hasGenerator && hasUps) suggestedCat = 1; // I особая
  else if (hasParallelUtility || hasGenerator) suggestedCat = 1;
  const catDescr = {
    1: 'Категория I — перерыв питания недопустим, требуется не менее 2 независимых источников + АВР. Особая группа I — дополнительно ИБП с автономией ≥ нормированной.',
    2: 'Категория II — допускается кратковременный перерыв на время оперативного переключения АВР. Минимум 2 источника.',
    3: 'Категория III — допускается перерыв до 1 суток. Один источник питания достаточен.',
  };
  const today = new Date().toISOString().slice(0, 10);
  const _stdRound = (v) => {
    const series = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
    for (const s of series) if (s >= v) return s;
    return Math.ceil(v / 1000) * 1000;
  };
  const Pdeclared = _stdRound(Pmax);
  const Sdeclared = _stdRound(Smax);
  const tu = (n && n.tuRequest) || {};
  // Для project-level (без n) пользовательские значения
  // pointName/date/category хранятся в projectMeta.
  const _val = (key) => {
    if (tu[key] != null && tu[key] !== '') return tu[key];
    if (projectMeta[key] != null && projectMeta[key] !== '') return projectMeta[key];
    return '';
  };
  const _esc = (s) => String(s ?? '').replace(/[<>"']/g, ch =>
    ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // v0.59.702: блок выбора стороны присоединения и индикация какой
  // источник из схемы используется как «опорный» (refNode).
  const refLabel = refNode
    ? `${escAttr(effectiveTag(refNode) || refNode.name || refNode.id)} (${refNode.sourceSubtype || refNode.type}, ${Uvolt} В)`
    : '— нет источника на схеме';
  body.innerHTML = `
    <div style="font-size:12px;line-height:1.6;max-width:800px">
      <div style="background:#eef5ff;border:1px solid #bbdefb;padding:8px 12px;border-radius:4px;margin-bottom:12px;color:#1565c0">
        ℹ Документ для подачи в электроснабжающую организацию (РЭС / Россети) при
        запросе технических условий на технологическое присоединение.
        Все расчётные значения автоматически собраны из схемы.
      </div>

      <div class="field" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:8px 10px;background:#f6f8fa;border-radius:4px">
        <label style="font-weight:600;font-size:12px;margin:0">Сторона присоединения:</label>
        <select id="tu-side" style="padding:4px 8px;font-size:12px">
          <option value="lv"${side === 'lv' ? ' selected' : ''}>Низкая (0.4 кВ — после трансформатора)</option>
          <option value="hv"${side === 'hv' ? ' selected' : ''}>Высокая (6/10 кВ — до трансформатора)</option>
        </select>
        <span class="muted" style="font-size:10px">Опорный источник: <b>${refLabel}</b></span>
      </div>

      <h3 style="margin:8px 0 6px;font-size:13px">1. Заявитель и объект</h3>
      <div style="display:grid;grid-template-columns:160px 1fr;gap:6px 8px;font-size:11px">
        <label>Наименование заявителя:</label>
        <input type="text" id="tu-applicant" value="${_esc(_val('applicant'))}" placeholder="ООО «...» / ФИО (из свойств проекта)">
        <label>Адрес объекта:</label>
        <input type="text" id="tu-address" value="${_esc(_val('address'))}" placeholder="г. ..., ул. ..., д. ... (из свойств проекта)">
        <label>Назначение объекта:</label>
        <input type="text" id="tu-purpose" value="${_esc(_val('purpose'))}" placeholder="ЦОД / производство / административное здание">
        <label>Точка присоединения:</label>
        <input type="text" id="tu-pointName" value="${_esc(_val('pointName'))}" placeholder="ТП-N / РУ ... / ЛЭП ...">
        <label>Дата формирования:</label>
        <input type="text" id="tu-date" value="${_esc(_val('date') || today)}">
      </div>

      <h3 style="margin:14px 0 6px;font-size:13px">2. Заявленная мощность</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">Активная мощность P, кВт</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;text-align:right;font-weight:600">${fmt(Pdeclared)}</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;color:#666">округлено вверх; расчёт: ${fmt(Pmax)} кВт</td></tr>
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">Полная мощность S, кВА</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;text-align:right;font-weight:600">${fmt(Sdeclared)}</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;color:#666">расчёт: ${fmt(Smax)} кВА</td></tr>
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">Реактивная мощность Q, квар</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;text-align:right;font-weight:600">${fmt(Qmax)}</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;color:#666">в режиме сервисного байпаса ИБП (расчётный максимум)</td></tr>
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">cos φ (расчётный)</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;text-align:right;font-weight:600">${cosWorst.toFixed(3)}</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;color:#666">текущий: ${cosCur.toFixed(3)}</td></tr>
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">Расчётный ток I, А</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;text-align:right;font-weight:600">${fmt(Imax)}</td>
            <td style="padding:3px 6px;border:1px solid #d7dde5;color:#666">по макс. нагрузке через ввод</td></tr>
        <tr><td style="padding:3px 6px;border:1px solid #d7dde5">Класс напряжения присоединения</td>
            <td colspan="2" style="padding:3px 6px;border:1px solid #d7dde5;font-weight:600">${_esc(Uclass)} (Uном = ${Uvolt} В)</td></tr>
      </table>

      <h3 style="margin:14px 0 6px;font-size:13px">3. Категория надёжности (ПУЭ 1.2)</h3>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <select id="tu-cat" style="padding:4px 8px;font-size:12px">
          <option value="1-special"${_val('category') === '1-special' ? ' selected' : ''}>I особая (ЦОД / медицина / непрерывное произв-во)</option>
          <option value="1"${(_val('category') || String(suggestedCat)) === '1' ? ' selected' : ''}>I — недопустим перерыв</option>
          <option value="2"${(_val('category') || String(suggestedCat)) === '2' ? ' selected' : ''}>II — кратковременный перерыв допустим</option>
          <option value="3"${(_val('category') || String(suggestedCat)) === '3' ? ' selected' : ''}>III — перерыв до 1 сут.</option>
        </select>
        <span class="muted" style="font-size:10px">Авто-предложение: <b>${suggestedCat}</b> (по составу схемы)</span>
      </div>
      <div id="tu-cat-descr" class="muted" style="font-size:10.5px;line-height:1.5">${catDescr[_val('category') && _val('category') !== '1-special' ? _val('category') : suggestedCat] || catDescr[2]}</div>

      <h3 style="margin:14px 0 6px;font-size:13px">4. Состав резервирования (из схемы)</h3>
      <ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.6">
        <li>Резервный ввод (utility или ДГУ): <b>${(hasParallelUtility || hasGenerator) ? 'есть' : 'нет'}</b>${hasGenerator ? ' (ДГУ резервный)' : ''}${hasParallelUtility ? ' (2-й ввод от РЭС)' : ''}</li>
        <li>ИБП в составе схемы: <b>${hasUps ? 'есть' : 'нет'}</b></li>
      </ul>

      <h3 style="margin:14px 0 6px;font-size:13px">5. Обоснование расчёта</h3>
      <div class="muted" style="font-size:10.5px;line-height:1.5">
        Заявленная мощность определена как максимальная расчётная
        активная мощность, потребляемая через данный ввод с учётом
        коэффициентов использования (Ки) и одновременности (Ко). Реактивная
        составляющая определена в режиме сервисного байпаса источников
        бесперебойного питания, при котором реактивная мощность
        потребителей не компенсируется инверторами и поступает на ввод
        в полном объёме (расчётный максимум для подбора оборудования
        электроснабжения). Активная мощность округлена в большую сторону
        до ближайшего стандартного значения ряда мощностей. Методика
        расчёта максимальной нагрузки —
        ${(GLOBAL.calcMethod === 'rtm') ? 'РТМ 36.18.32.4-92 (метод упорядоченных диаграмм Г.М.&nbsp;Каялова, приложение 2)' : (GLOBAL.calcMethod === 'pue') ? 'ПУЭ&nbsp;7' : 'IEC&nbsp;60364-5-52'}.
      </div>

      <div style="margin-top:14px;font-size:10.5px;color:#666;border-top:1px dashed #d7dde5;padding-top:8px">
        Документ сгенерирован автоматически ${today}. При подаче в РЭС
        прикладываются: однолинейная схема, расчёт нагрузок, ситуационный план.
      </div>
    </div>
  `;
  // Привязка обработчиков.
  const _read = (id) => document.getElementById(id)?.value || '';
  // v0.59.692: разделяем хранение:
  //   проект-уровень (общее для схемы): applicant, address, purpose
  //     → updateProject(activeProjectId, { tuDefaults: {...} })
  //   узел-уровень (специфичное для конкретного ввода): pointName,
  //     date, category → n.tuRequest
  const _saveFields = () => {
    const projDefaults = {
      applicant: _read('tu-applicant'),
      address:   _read('tu-address'),
      purpose:   _read('tu-purpose'),
    };
    if (activeProjectId) {
      try { updateProject(activeProjectId, { tuDefaults: projDefaults }); } catch {}
    }
    // v0.59.702: при вызове из проекта (n=null) и без opera-указанного
    // refNode — пишем pointName/date/category в проектные tuDefaults
    // как глобальные. Если есть refNode — пишем на узел.
    if (n) {
      n.tuRequest = {
        pointName: _read('tu-pointName'),
        date:      _read('tu-date'),
        category:  _read('tu-cat'),
      };
    } else if (activeProjectId) {
      try {
        const cur = (projectMeta && typeof projectMeta === 'object') ? projectMeta : {};
        const merged = {
          ...cur,
          ...projDefaults,
          pointName: _read('tu-pointName'),
          date:      _read('tu-date'),
          category:  _read('tu-cat'),
        };
        updateProject(activeProjectId, { tuDefaults: merged });
        projectMeta = merged;
      } catch {}
    }
  };
  ['tu-applicant','tu-address','tu-purpose','tu-pointName','tu-date','tu-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      _saveFields();
      const sid = (refNode && refNode.id) ? refNode.id : 'project';
      snapshot('tu-request:' + sid);
      notifyChange();
    });
  });
  // v0.59.702: смена стороны присоединения. Сохраняем выбор в проектных
  // tuDefaults и перерисовываем модалку — refNode пересчитывается под
  // новую сторону, и все значения обновляются.
  const sideSel = document.getElementById('tu-side');
  if (sideSel) {
    sideSel.addEventListener('change', () => {
      side = sideSel.value === 'hv' ? 'hv' : 'lv';
      // Сохраняем выбор в проектных tuDefaults.
      if (activeProjectId) {
        try {
          const cur = (projectMeta && typeof projectMeta === 'object') ? projectMeta : {};
          updateProject(activeProjectId, { tuDefaults: { ...cur, side } });
          projectMeta = { ...cur, side };
        } catch {}
      }
      // Если вызов был с конкретного n — оставляем его (юзер явно
      // выбрал именно этот источник). Иначе переключаем refNode.
      if (!n) refNode = _findSourceForSide(side);
      _renderModal();
    });
  }
  // Обновление описания категории при смене select.
  const catSel = document.getElementById('tu-cat');
  const catDescrEl = document.getElementById('tu-cat-descr');
  if (catSel && catDescrEl) {
    catSel.addEventListener('change', () => {
      const k = catSel.value === '1-special' ? '1' : catSel.value;
      catDescrEl.textContent = catDescr[k] || catDescr[2];
    });
  }
  // Кнопка «копировать в буфер» — собирает текстовый документ.
  const copyBtn = document.getElementById('tu-request-copy');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const cat = _read('tu-cat');
      const catLbl = cat === '1-special' ? 'I особая' : cat;
      const lines = [
        'ЗАЯВКА НА ТЕХНИЧЕСКИЕ УСЛОВИЯ (ТУ)',
        '═'.repeat(60),
        '',
        '1. ЗАЯВИТЕЛЬ И ОБЪЕКТ',
        '   Заявитель:           ' + _read('tu-applicant'),
        '   Адрес объекта:       ' + _read('tu-address'),
        '   Назначение:          ' + _read('tu-purpose'),
        '   Точка присоединения: ' + _read('tu-pointName'),
        '   Дата формирования:   ' + _read('tu-date'),
        '',
        '2. ЗАЯВЛЕННАЯ МОЩНОСТЬ',
        '   Активная P:    ' + fmt(Pdeclared) + ' кВт (расчёт: ' + fmt(Pmax) + ')',
        '   Полная S:      ' + fmt(Sdeclared) + ' кВА (расчёт: ' + fmt(Smax) + ')',
        '   Реактивная Q:  ' + fmt(Qmax) + ' квар (в режиме сервисного байпаса ИБП)',
        '   cos φ:         ' + cosWorst.toFixed(3),
        '   Расчётный I:   ' + fmt(Imax) + ' А',
        '   Класс U:       ' + Uclass + ' (Uном = ' + Uvolt + ' В)',
        '',
        '3. КАТЕГОРИЯ НАДЁЖНОСТИ (ПУЭ 1.2)',
        '   Категория: ' + catLbl,
        '   ' + (catDescr[cat === '1-special' ? '1' : cat] || catDescr[2]),
        '',
        '4. СОСТАВ РЕЗЕРВИРОВАНИЯ',
        '   Резервный ввод/ДГУ: ' + ((hasParallelUtility || hasGenerator) ? 'есть' : 'нет')
          + (hasGenerator ? ' (ДГУ)' : '') + (hasParallelUtility ? ' (2-й ввод РЭС)' : ''),
        '   ИБП в схеме: ' + (hasUps ? 'есть' : 'нет'),
        '',
        '5. ОБОСНОВАНИЕ',
        '   Заявленная мощность определена как максимальная расчётная',
        '   активная мощность, потребляемая через данный ввод с учётом',
        '   коэффициентов использования (Ки) и одновременности (Ко).',
        '   Реактивная мощность определена в режиме сервисного байпаса',
        '   источников бесперебойного питания, при котором реактивная',
        '   составляющая нагрузки не компенсируется инверторами и',
        '   поступает на ввод в полном объёме.',
        '   Методика: ' + ((GLOBAL.calcMethod === 'rtm') ? 'РТМ 36.18.32.4-92'
          : (GLOBAL.calcMethod === 'pue') ? 'ПУЭ 7' : 'IEC 60364-5-52') + '.',
        '',
        'При подаче приложить: однолинейная схема, расчёт нагрузок,',
        'ситуационный план.',
      ];
      const txt = lines.join('\n');
      try {
        navigator.clipboard.writeText(txt).then(() => flash('Скопировано в буфер обмена'));
      } catch (e) {
        // fallback — выделить и Ctrl+C
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash('Скопировано'); } catch {}
        document.body.removeChild(ta);
      }
    };
  }
  };
  _renderModal();
  document.getElementById('modal-tu-request').classList.remove('hidden');
}

// ================= Блок статуса источника =================
export function sourceStatusBlock(n) {
  const parts = [];
  if (!effectiveOn(n)) parts.push('<span class="badge off">отключён</span>');
  else {
    const pct = (Number(n.capacityKw) || 0) > 0 ? Math.round((n._loadKw || 0) / n.capacityKw * 100) : 0;
    parts.push(n._overload ? '<span class="badge off">перегруз</span>' : '<span class="badge on">в работе</span>');
    if (n._maxLoadKw) parts.push(`<b>Максимум:</b> ${fmt(n._maxLoadKw)} kW · ${fmt(n._maxLoadA || 0)} A`);
    parts.push(`<b>Текущая:</b> ${fmt(n._powerP || n._loadKw || 0)} kW · ${fmt(n._loadA || 0)} A <span class="muted">(${pct}%)</span>`);
    if (n._powerQ) parts.push(`Q реакт.: <b>${fmt(n._powerQ)} kvar</b>`);
    if (n._powerS) parts.push(`S полн.: <b>${fmt(n._powerS)} kVA</b>`);
    // v0.59.670: methodology-aware short для «cos φ»
    if (n._cosPhi) {
      const _cosShort = getTerm('powerFactor', GLOBAL.calcMethod || 'iec').short || 'cos φ';
      parts.push(`${_cosShort}: <b>${n._cosPhi.toFixed(2)}</b>`);
    }
    // v0.59.626/629: worst-case (все ИБП в байпасе) — для УРКМ и подбора ДГУ.
    // Всегда показываем обе записи (текущий + наихудший), даже когда они равны.
    // v0.59.867: для городской сети (utility) НЕ показываем worst-case блок.
    // Пользователь: «для городской сети просто показывай финальный косинус фи
    // с учетом всех компенсаторов (УКРМ) и потребителей. Про режим что ИБП
    // в байпасе не упоминая». Для трансформатора и генератора — оставляем
    // (там нужен подбор УРКМ / ДГУ по worst-case).
    const _isUtility = (n.sourceSubtype || (n.type === 'generator' ? 'generator' : 'transformer')) === 'utility';
    if (!_isUtility && (Number.isFinite(n._powerPWorst) || Number.isFinite(n._powerQWorst))) {
      const cosW = Number(n._cosPhiWorst) || (Number(n._cosPhi) || 1);
      const pW = Number(n._powerPWorst) || (Number(n._powerP) || 0);
      const qW = Number(n._powerQWorst) || 0;
      const sW = Number(n._powerSWorst) || 0;
      const aW = Number(n._loadAWorst) || 0;
      const qDelta = Math.abs((Number(n._powerQWorst) || 0) - (Number(n._powerQ) || 0));
      parts.push(`<span style="color:#c2410c"><b>В байпасе ИБП</b> (наиболее тяжёлый режим — для УРКМ и подбора ДГУ):</span>`);
      parts.push(`&nbsp;&nbsp;${fmt(pW)} kW · ${fmt(aW)} A · Q ${fmt(qW)} kvar · S <b>${fmt(sW)} kVA</b> · cos φ <b>${cosW.toFixed(2)}</b>${qDelta < 0.05 ? ' <span class="muted">(совпадает с текущим)</span>' : ''}`);
    }
    // v0.59.627/631: для генератора — статус достаточности по worst-case
    // kW + kVA в выбранном режиме ISO 8528. Используем _maxLoadKw — макс.
    // сценарий нагрузки, который ДГУ должен покрыть при активации
    // (для backup-генератора _powerP=0 в нормальном режиме, нельзя сайзить
    // по нему). kVA считаем как P_max / cos_worst.
    if (n.type === 'generator' && n.genRatings && typeof n.genRatings === 'object') {
      const mode = n.genRatingMode || 'ESP';
      const r = n.genRatings[mode] || {};
      const ratedKw = Number(r.kW) || 0;
      const ratedKva = Number(r.kVA) || 0;
      if (ratedKw > 0 && ratedKva > 0) {
        const cosW = Number(n._cosPhiWorst) || Number(n._cosPhi) || Number(n.genCosPhi) || 0.8;
        const Pmax = Number(n._maxLoadKw) || Number(n._powerPWorst) || Number(n._powerP) || 0;
        const Smax = (Pmax > 0 && cosW > 0) ? (Pmax / cosW) : 0;
        const utilP = Pmax / ratedKw;
        const utilS = Smax / ratedKva;
        const util = Math.max(utilP, utilS);
        let st = '', col = '#6b7280';
        if (Pmax === 0) { st = 'нет нагрузки'; col = '#6b7280'; }
        else if (util > 1.0)        { st = '⛔ недостаточно';           col = '#b91c1c'; }
        else if (util >= 0.85) { st = '⚠ достаточно (близко к пределу)'; col = '#c2410c'; }
        else if (util >= 0.50) { st = '✓ нормально';                col = '#15803d'; }
        else                   { st = 'ℹ слишком много';            col = '#0369a1'; }
        parts.push(`Режим ДГУ: <b>${escHtml(mode)}</b> ${ratedKw.toFixed(0)} kW · ${ratedKva.toFixed(0)} kVA → <b style="color:${col}">${st}</b> <span class="muted">(kW ${(utilP*100).toFixed(0)}% / kVA ${(utilS*100).toFixed(0)}%)</span>`);
      }
    }
    if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на шинах: <b>${fmt(n._ikA / 1000)} кА</b>`);
    // v0.59.709: расширенное ΔU с цветом и U на выходе.
    if (n._deltaUPct > 0) {
      const _drop = n._deltaUPct;
      const _uNom = nodeVoltage(n) || 0;
      const _uTerm = _uNom * (1 - _drop / 100);
      const _color = _drop <= 1 ? '#15803d'
        : _drop <= 3 ? '#0369a1'
        : _drop <= 5 ? '#ca8a04'
        : _drop <= 10 ? '#ea580c'
        : '#b91c1c';
      const _badge = _drop <= 5 ? '' : (_drop <= 10 ? ' ⚠ > 5%' : ' ⛔ > 10%');
      parts.push(`ΔU: <b style="color:${_color}">${_drop.toFixed(2)}%</b>${_badge}`);
      if (_uNom > 0 && _drop > 1) {
        parts.push(`U на выходе: <b style="color:${_color}">${_uTerm.toFixed(1)} В</b>`);
      }
    }
  }
  if (n.type === 'generator' && n.triggerNodeId) {
    const t = state.nodes.get(n.triggerNodeId);
    if (t) {
      const tPowered = !!t._powered;
      parts.push(`триггер: <b>${escHtml(t.tag || '')}</b> — ${tPowered ? 'норма (дежурство)' : 'обесточен (пуск)'}`);
    }
  }
  // v0.59.667: справка по РТМ 36.18.32.4-92 — общий хелпер rtmInfoBlock.
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>${rtmInfoBlock(n)}`;
}
