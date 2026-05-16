// =============================================================================
// service/ui/order-form.js — форма наряда сервисных/монтажных работ
// =============================================================================
// Phase 24.1. UI-слой; зависит от DOM. Использует pure-функции из
// service/calc/order-model.js.

import {
  DEFAULT_ORDER, ORDER_TYPES, POSITION_CATEGORIES, UNITS,
  defaultPosition, computeOrderTotals, CURRENCIES,
  SOURCE_MODULE_ICONS, SOURCE_MODULE_LABELS,
} from '../calc/order-model.js';
import { listTemplates } from '../catalog/work-templates.js';
import { pickMaterialModal } from './materials-catalog.js';
import {
  buildInstallPositionsFromCoolingOption,
  buildMaintenancePositionsFromCoolingOption,
  loadCoolingSelectionsForContext,
} from '../calc/order-builder.js';
import { openOfferPreview } from '../calc/export-offer.js';
import { fmtMoney } from 'cooling/calc/fc-summary.js';
import { escAttr, escHtml, modalOpen, toast } from 'meteo/util.js';
// v0.60.136 (Phase 44.3 follow-up): RBAC guard на economics fields.
// canEditEconomics — только manager/gip. Для engineer/viewer поля
// клиент-цены и себестоимости становятся read-only.
import { hasPermission, currentRole, ROLES } from 'shared/subscriptions.js';

/**
 * @param {object} order            — текущий наряд
 * @param {function(order)} onChange — вызывается при каждом изменении
 * @param {string} displayCurrency  — валюта проекта/отчёта
 * @param {function|null} convertFn — (amount, fromCur, toCur) => number
 * @param {object} ctx              — { pid: string|null } — контекст для cross-module
 */
export function renderOrderForm(order, onChange, displayCurrency = '₽', convertFn = null, ctx = {}) {
  const o = { ...DEFAULT_ORDER, ...(order || {}) };
  if (!Array.isArray(o.positions)) o.positions = [];
  const wrap = document.createElement('div');
  wrap.className = 'sv-order-form';

  const totals = computeOrderTotals(o, displayCurrency, convertFn);
  const fmt = (v) => fmtMoney(v, displayCurrency);

  // v0.60.136: economics permission для top-level полей (overheadPct/vatPct).
  const _topCanEcon = hasPermission('canEditEconomics');
  const _topRole = currentRole();
  const _topRoleLabel = _topRole ? (ROLES[_topRole]?.label || _topRole) : 'не задана';
  const _topEconLockTitle = `🔒 Поле экономики — только для 👑 Менеджера или 🛠 ГИП. Текущая роль: «${_topRoleLabel}». Просмотр доступен, редактирование запрещено.`;
  const _topEconAttrs = _topCanEcon ? '' : ` disabled style="opacity:0.7;cursor:not-allowed;background:#f1f5f9"`;

  const typeOpts = ORDER_TYPES.map(t =>
    `<option value="${t.id}"${t.id === o.type ? ' selected' : ''} title="${escAttr(t.desc)}">${escHtml(t.label)}</option>`
  ).join('');

  wrap.innerHTML = `
    <div class="sv-section">
      <div class="sv-section-title" title="Параметры наряда: имя, тип, заказчик, дата.">📋 Свойства наряда</div>
      <div class="sv-grid">
        <label class="sv-field" title="Учётный номер наряда — для учётной системы / 1С. Auto-генерируется при создании наряда по pattern (КП-{year}-{counter:0000}). Можно изменить вручную.">
          <span>Учётный № (КП/ТО/ЗН)</span>
          <input type="text" data-of="number" value="${escAttr(o.number || '')}" placeholder="напр. КП-2026-0042">
        </label>
        <label class="sv-field" title="Краткое имя/описание наряда (например «Монтаж чиллера York YLAA200 для ЦОД-1»). Появляется в списке нарядов.">
          <span>Название / описание</span>
          <input type="text" data-of="name" value="${escAttr(o.name || '')}" placeholder="Например: Монтаж чиллера для серверной A">
        </label>
        <label class="sv-field" title="Тип наряда. Влияет на подсказки шаблонов работ.">
          <span>Тип</span>
          <select data-of="type">${typeOpts}</select>
        </label>
        <label class="sv-field" title="Дата наряда. Используется для выбора курса валют (если включена дата курса).">
          <span>Дата</span>
          <input type="date" data-of="date" value="${escAttr(o.date)}">
        </label>
        <label class="sv-field" title="Имя заказчика / организации.">
          <span>Заказчик</span>
          <input type="text" data-of="customer.name" value="${escAttr(o.customer?.name || '')}" placeholder="ООО «...»">
        </label>
        <label class="sv-field" title="Контакт заказчика (телефон / email).">
          <span>Контакт</span>
          <input type="text" data-of="customer.contact" value="${escAttr(o.customer?.contact || '')}" placeholder="+7 ... / email@...">
        </label>
        <label class="sv-field" title="${_topCanEcon ? 'Накладные расходы — % от себестоимости. Учитываются при расчёте маржи. Типично 10–20%.' : escAttr(_topEconLockTitle)}">
          <span>Накладные, %${_topCanEcon ? '' : ' 🔒'}</span>
          <input type="number" min="0" max="200" step="1" data-of="overheadPct" value="${o.overheadPct}"${_topEconAttrs}>
        </label>
        <label class="sv-field" title="${_topCanEcon ? 'НДС, % от клиент-цены. Применяется к итогу для клиента. РФ — 20%, KZ — 12%.' : escAttr(_topEconLockTitle)}">
          <span>НДС, %${_topCanEcon ? '' : ' 🔒'}</span>
          <input type="number" min="0" max="50" step="0.5" data-of="vatPct" value="${o.vatPct}"${_topEconAttrs}>
        </label>
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Позиции наряда: одна строка = одна работа/материал/командировка с qty/unit/себес/клиент-ценой.">📦 Состав работ и материалов (${o.positions.length})</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <button type="button" class="sv-btn-primary" id="sv-add-pos" title="Добавить пустую позицию.">+ Позиция</button>
        <button type="button" class="sv-btn-primary" id="sv-add-wizard" style="background:#7c3aed;border-color:#7c3aed" title="Phase 42 (v0.60.109): Мастер составления наряда — задаёт вопросы по типу системы (вентиляция/чиллер/ИБП), запрашивает параметры (расход/мощность/тип хладагента) и предлагает релевантные позиции с правильным количеством по периодичности. Можно снять галочки с ненужных, отредактировать qty и нажать «Добавить в наряд».">🪄 Через мастер</button>
        <button type="button" class="sv-btn-ghost" id="sv-add-template" title="Открыть каталог типовых работ для текущего типа наряда (${escAttr(ORDER_TYPES.find(t => t.id === o.type)?.label || '')}). Шаблоны имеют дефолтные себес/клиент-цены — можно редактировать после добавления.">📚 Из шаблонов работ</button>
        <button type="button" class="sv-btn-ghost" id="sv-add-material" title="Добавить позицию из каталога материалов (хладагент, фильтр, масло, АКБ, кабель и т.п.). Дефолтная цена и валюта берутся из каталога; qty по умолчанию 1 — отредактируйте.">📦 Из материалов</button>
        <button type="button" class="sv-btn-ghost" id="sv-import-cooling" title="Импорт работ из cooling-подбора текущего проекта. Для каждой equipment-группы добавится позиция «Монтаж: ...» с qty из топологии (для нарядов типа Монтаж) или «ТО квартальное ...» (для нарядов типа ТО). Цены — дефолтные по типу/мощности; редактируйте после импорта. При повторном импорте — обновление с подтверждением.">❄ Из cooling-подбора</button>
      </div>
      <div class="sv-table-wrap">
        ${renderPositionsTable(o.positions, displayCurrency)}
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Итоги наряда — все суммы в валюте проекта (${escAttr(displayCurrency)}) с per-cell конвертацией по курсу.">📊 Итоги</div>
      <div class="sv-totals-grid">
        <div class="sv-total-block sv-total-cost" title="Себестоимость = Σ qty × costPrice. Накладные = себес × overhead%/100. Итого = себес + накладные.">
          <h5>СЕБЕСТОИМОСТЬ</h5>
          <div class="sv-total-row"><span>Σ Себес (без накладных)</span><b>${fmt(totals.sumCostNative)}</b></div>
          <div class="sv-total-row"><span>+ Накладные (${o.overheadPct}%)</span><b>${fmt(totals.sumOverhead)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>= Себес итого</span><b>${fmt(totals.sumCostWithOverhead)}</b></div>
        </div>
        <div class="sv-total-block sv-total-client" title="Клиент-цена = Σ qty × clientPrice. НДС = клиент × vat%/100. Итого с НДС.">
          <h5>ДЛЯ КЛИЕНТА</h5>
          <div class="sv-total-row"><span>Σ Клиент (без НДС)</span><b>${fmt(totals.sumClientNative)}</b></div>
          <div class="sv-total-row"><span>+ НДС (${o.vatPct}%)</span><b>${fmt(totals.sumVat)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>= К оплате</span><b>${fmt(totals.sumClientWithVat)}</b></div>
        </div>
        <div class="sv-total-block sv-total-margin" title="Маржа = Клиент − Себес итого. Маржа% относительно Себес итого. Целевая маржа ≥ 30% для устойчивого бизнеса.">
          <h5>МАРЖА</h5>
          <div class="sv-total-row"><span>Маржа абс.</span><b>${fmt(totals.marginAbs)}</b></div>
          <div class="sv-total-row sv-total-grand"><span>Маржа %</span><b style="color:${totals.marginPct >= 30 ? '#16a34a' : (totals.marginPct >= 15 ? '#f59e0b' : '#dc2626')}">${totals.marginPct.toFixed(1)} %</b></div>
        </div>
      </div>
      <div class="sv-by-cat" title="Распределение себестоимости по категориям — помогает понять структуру затрат.">
        <h5>Себестоимость по категориям</h5>
        <div class="sv-cat-grid">
          ${POSITION_CATEGORIES.map(c => {
            const v = totals.byCategory[c.id] || 0;
            return `<div class="sv-cat-row" title="${escAttr(c.tip)}"><span>${escHtml(c.label)}</span><b>${fmt(v)}</b></div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Свободные примечания к наряду (детали договора, условия гарантии, контактное лицо).">📝 Примечания</div>
      <textarea data-of="notes" rows="3" style="width:100%" placeholder="Дополнительная информация, условия, гарантии...">${escHtml(o.notes || '')}</textarea>
    </div>

    <div class="sv-section">
      <div class="sv-section-title" title="Экспорт коммерческого предложения для отправки клиенту. Открывается в новом окне, дальше Ctrl+P → Сохранить как PDF.">📤 Экспорт КП клиенту</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button type="button" class="sv-btn-primary" id="sv-export-offer"
                title="Открыть КП в новом окне для печати или сохранения как PDF. Содержит шапку, состав работ по разделам, итоги с НДС, место для подписей.">📄 Открыть КП (для печати/PDF)</button>
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:#475569"
               title="Если включено — в КП показывается дополнительная служебная колонка «Себес/ед» и блок маржи. НЕ отправляйте клиенту в таком виде! Выключите перед финальной отправкой.">
          <input type="checkbox" id="sv-show-cost"> показать себес+маржу (служебно)
        </label>
      </div>
    </div>
  `;

  // v0.60.111 FIX (правило feedback_input_event.md, упомянуто Пользователем
  // ≥4 раз — 🔥 HIGH): «все поля не должны терять фокус при вводе много
  // символьных строк». Раньше слушали 'input' который срабатывает на
  // каждый keystroke → onChange → service.js::renderActive() → wrap.innerHTML
  // переписывается → input уничтожается → фокус теряется.
  //
  // Теперь — 'change' (срабатывает на blur/Enter/stepper-click) на ВСЕ
  // поля наряда (data-of top-level + tr[data-pos] позиции). Живой
  // апдейт totals откладывается до blur, что приемлемо.
  wrap.addEventListener('change', (ev) => {
    const inp = ev.target.closest('[data-of]');
    if (inp) {
      const path = inp.dataset.of;
      const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
      const next = setByPath({ ...o }, path, val);
      onChange(next);
      return;
    }
    const tr = ev.target.closest('tr[data-pos]');
    if (tr) handlePositionInput(ev, tr, o, onChange, displayCurrency, convertFn, /*isChange*/true);
  });
  wrap.addEventListener('click', async (ev) => {
    if (ev.target.closest('#sv-add-pos')) {
      const next = { ...o, positions: [...o.positions, defaultPosition(displayCurrency)] };
      onChange(next);
      return;
    }
    // Phase 42 v0.60.109 — мастер составления наряда
    if (ev.target.closest('#sv-add-wizard')) {
      const { openOrderWizard } = await import('./order-wizard.js');
      const positions = await openOrderWizard({ orderType: o.type });
      if (!positions || !positions.length) return;
      onChange({ ...o, positions: [...o.positions, ...positions] });
      return;
    }
    if (ev.target.closest('#sv-add-template')) {
      const result = await pickTemplateModal(o.type, displayCurrency);
      if (!result) return;
      const newPositions = [result.position];
      // v0.60.51 (Phase 32.3): auto-suggest материалов если у работы задан
      // workType + equipmentKind. Считаем рекомендуемое qty через
      // consumptionRate.perKw × capacityKw (если есть).
      if (result.workType && result.equipmentKind) {
        const matBridge = await import('../catalog/materials.js');
        const suggestions = matBridge.suggestMaterialsForWork(result.workType, result.equipmentKind);
        if (suggestions.length) {
          const picked = await suggestMaterialsModal(suggestions, result.capacityKw);
          if (picked && picked.length) {
            newPositions.push(...picked);
            toast(`✓ Добавлено: 1 работа + ${picked.length} материалов`, 'ok');
          } else {
            toast(`✓ Работа добавлена (без рекомендуемых материалов)`, 'ok');
          }
        }
      }
      onChange({ ...o, positions: [...o.positions, ...newPositions] });
      return;
    }
    if (ev.target.closest('#sv-add-material')) {
      // v0.60.49 (Phase 32.2): добавить позицию из каталога материалов
      const m = await pickMaterialModal();
      if (!m) return;
      const newPos = {
        ...defaultPosition(displayCurrency, 'material'),
        label: m.name + (m.sku ? ` (${m.sku})` : ''),
        category: 'material',
        unit: m.unit,
        // Себес = дефолт-цена из каталога; клиент-цена = себес × 1.4 (40% маржа по умолчанию)
        costPrice:   { value: m.defaultPrice?.value || 0,                        currency: m.defaultPrice?.currency || '₸' },
        clientPrice: { value: Math.round((m.defaultPrice?.value || 0) * 1.4),    currency: m.defaultPrice?.currency || '₸' },
      };
      onChange({ ...o, positions: [...o.positions, newPos] });
      toast(`✓ «${m.name}» добавлен`, 'ok');
      return;
    }
    if (ev.target.closest('#sv-export-offer')) {
      const showCost = document.getElementById('sv-show-cost')?.checked || false;
      // v0.60.27: pid из URL для подбора company-profile (project override)
      const params = new URLSearchParams(location.search);
      const pid = params.get('standalone') === '1' ? null : (params.get('pid') || null);
      try {
        openOfferPreview(o, displayCurrency, convertFn, { showCostBreakdown: showCost, pid });
        toast('КП открыто в новом окне. Ctrl+P → Сохранить как PDF.', 'ok');
      } catch (err) {
        toast(err.message || 'Не удалось открыть КП', 'err');
      }
      return;
    }
    if (ev.target.closest('#sv-import-cooling')) {
      const result = await pickCoolingOptionModal(o.type, displayCurrency);
      if (!result) return;
      const builderFn = (o.type === 'maintenance')
        ? buildMaintenancePositionsFromCoolingOption
        : buildInstallPositionsFromCoolingOption;
      const newPositions = builderFn(result.option, displayCurrency, result.selection);
      if (!newPositions.length) {
        toast('У выбранной опции нет equipment-групп. Сначала задайте оборудование во вкладке Топология.', 'err');
        return;
      }
      // v0.60.45 (feedback_service_imports.md): дедуп. Если уже есть позиции
      // с тем же sourceModule='cooling' + sourceRef.optionId — спросить про
      // обновление вместо дублирования.
      const existingFromSameSource = (o.positions || []).filter(p =>
        p.sourceModule === 'cooling' && p.sourceRef?.optionId === result.option.id
      );
      let positions;
      if (existingFromSameSource.length > 0) {
        const ok = await confirmOverwrite(
          `Уже есть ${existingFromSameSource.length} позиций, импортированных из «${result.selection.name} → ${result.option.name}». Обновить (удалить старые и добавить актуальные с qty из текущей топологии)?`
        );
        if (!ok) return;
        // Удаляем старые из этого источника и добавляем новые
        positions = (o.positions || []).filter(p =>
          !(p.sourceModule === 'cooling' && p.sourceRef?.optionId === result.option.id)
        );
        positions.push(...newPositions);
        toast(`✓ Обновлено: удалено ${existingFromSameSource.length}, добавлено ${newPositions.length} позиций`, 'ok');
      } else {
        positions = [...(o.positions || []), ...newPositions];
        toast(`✓ Добавлено ${newPositions.length} позиций из «${result.selection.name} → ${result.option.name}»`, 'ok');
      }
      onChange({ ...o, coolingSelectionId: result.selection.id, positions });
      return;
    }
    const del = ev.target.closest('.sv-pos-del');
    if (del) {
      const tr = del.closest('tr[data-pos]');
      const idx = Number(tr.dataset.pos);
      const next = { ...o, positions: o.positions.filter((_, i) => i !== idx) };
      onChange(next);
      return;
    }
  });

  return wrap;
}

function renderPositionsTable(positions, displayCurrency) {
  const curOpts = (sel) => CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === sel ? ' selected' : ''}>${c.code}</option>`
  ).join('');
  const catOpts = (sel) => POSITION_CATEGORIES.map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''} title="${escAttr(c.tip)}">${escHtml(c.label)}</option>`
  ).join('');
  const unitOpts = (sel) => UNITS.map(u =>
    `<option value="${u}"${u === sel ? ' selected' : ''}>${escHtml(u)}</option>`
  ).join('');

  if (!positions.length) {
    return '<p class="muted" style="margin:0;padding:10px;text-align:center">Нет позиций. Добавьте через «+ Позиция» или «📚 Из шаблонов».</p>';
  }

  const rows = positions.map((p, i) => {
    // v0.60.45: иконка источника позиции (cooling/ups/mdc/...) с tooltip
    const srcIcon = p.sourceModule ? SOURCE_MODULE_ICONS[p.sourceModule] : '';
    const srcLabel = p.sourceModule ? SOURCE_MODULE_LABELS[p.sourceModule] : '';
    const srcTitle = p.sourceModule
      ? `Источник: ${srcIcon} ${srcLabel}. При повторном импорте из этого источника позиция будет ОБНОВЛЕНА (не дублирована).`
      : 'Пользовательская позиция (без источника). Не затрагивается при импорте из модулей.';
    const srcMarker = `<span class="sv-pos-src" title="${escAttr(srcTitle)}" style="display:inline-block;width:18px;text-align:center;cursor:help;font-size:13px;flex-shrink:0">${srcIcon || '✏'}</span>`;
    // v0.60.136: economics fields (себестоимость + клиент-цена + валюты) —
    // read-only для ролей без canEditEconomics. Tooltip объясняет почему.
    const _canEcon = hasPermission('canEditEconomics');
    const _role = currentRole();
    const _roleLabel = _role ? (ROLES[_role]?.label || _role) : 'не задана';
    const _econLockTitle = `🔒 Поле экономики — только для 👑 Менеджера или 🛠 ГИП. Текущая роль: «${_roleLabel}». Просмотр доступен, редактирование запрещено.`;
    const _econDis = _canEcon ? '' : ` disabled style="opacity:0.7;cursor:not-allowed;background:#f1f5f9" title="${escAttr(_econLockTitle)}"`;
    return `<tr data-pos="${i}">
      <td><span style="display:flex;align-items:center;gap:4px">${srcMarker}<input type="text" class="sv-pos-label" data-attr="label" value="${escAttr(p.label || '')}" placeholder="Описание работы / материала" title="Описание позиции" style="flex:1;min-width:0"></span></td>
      <td><select class="sv-pos-cat" data-attr="category" title="Категория позиции">${catOpts(p.category)}</select></td>
      <td><input type="number" min="0" step="0.5" class="sv-pos-qty" data-attr="qty" value="${Number(p.qty) || 1}" title="Количество"></td>
      <td><select class="sv-pos-unit" data-attr="unit" title="Единица измерения">${unitOpts(p.unit)}</select></td>
      <td><input type="number" min="0" step="100" class="sv-pos-val" data-col="costPrice" data-attr="value" value="${Number(p.costPrice?.value) || 0}" ${_canEcon ? 'title="Себестоимость одной единицы"' : _econDis}></td>
      <td><select class="sv-pos-cur" data-col="costPrice" data-attr="currency" ${_canEcon ? 'title="Валюта себестоимости"' : _econDis}>${curOpts(p.costPrice?.currency || displayCurrency)}</select></td>
      <td><input type="number" min="0" step="100" class="sv-pos-val" data-col="clientPrice" data-attr="value" value="${Number(p.clientPrice?.value) || 0}" ${_canEcon ? 'title="Цена для клиента за единицу"' : _econDis}></td>
      <td><select class="sv-pos-cur" data-col="clientPrice" data-attr="currency" ${_canEcon ? 'title="Валюта клиент-цены"' : _econDis}>${curOpts(p.clientPrice?.currency || displayCurrency)}</select></td>
      <td><button type="button" class="sv-pos-del" title="Удалить позицию">×</button></td>
    </tr>`;
  }).join('');
  return `
    <table class="sv-pos-table">
      <thead>
        <tr>
          <th title="Описание позиции">Позиция</th>
          <th title="Категория: работа / материал / командировочные / субподряд / прочее">Категория</th>
          <th title="Количество">Кол-во</th>
          <th title="Единица измерения">Ед.</th>
          <th title="Себестоимость одной единицы">Себес/ед</th>
          <th title="Валюта себестоимости">Вал.</th>
          <th title="Клиент-цена одной единицы">Клиент/ед</th>
          <th title="Валюта клиент-цены">Вал.</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function handlePositionInput(ev, tr, o, onChange, displayCurrency, convertFn, isChange = false) {
  const idx = Number(tr.dataset.pos);
  const positions = o.positions.map(p => ({ ...p,
    costPrice: { ...p.costPrice }, clientPrice: { ...p.clientPrice },
  }));
  if (!positions[idx]) return;
  const attr = ev.target.dataset.attr;
  const col = ev.target.dataset.col;
  const targetVal = ev.target.value;

  if (col && attr === 'currency') {
    if (!isChange) return;  // currency только в change
    if (!positions[idx][col]) positions[idx][col] = { value: 0, currency: displayCurrency };
    const oldCur = positions[idx][col].currency;
    const newCur = targetVal;
    if (oldCur !== newCur) {
      const curVal = Number(positions[idx][col].value) || 0;
      // v0.60.40: курсы persistent в LS-кэше. Если convertFn=null — пробуем
      // lazy-загрузку через fetchRates(null, null, false) — он подтянет из
      // LS-кэша если есть, или сделает один сетевой запрос.
      // По требованию пользователя: «курсы не должны удаляться, они в LS,
      // используются локальные, обновляются через модуль 💱 валюты».
      if (curVal > 0) {
        let cf = convertFn;
        if (!cf) {
          try {
            const cr = await import('shared/currency-rates/index.js');
            const fc = await import('cooling/calc/fc-summary.js');
            const cache = await cr.fetchRates(null, null, false);  // false = use cache
            if (cache) {
              cf = (amount, from, to) => cr.convert(amount, fc.currencyToIso(from), fc.currencyToIso(to), cache);
            }
          } catch (e) {
            console.warn('[order-form] lazy-load rates failed:', e);
          }
        }
        if (!cf) {
          toast(`⚠ Курсы валют недоступны (${oldCur}→${newCur}). Нажмите «💱 Курсы валют» в сайдбаре service-модуля (раздел «⚙ Настройки») → загрузить. После этого курсы сохранятся в LS и будут доступны во всех модулях.`, 'err');
        } else {
          const v = cf(curVal, oldCur, newCur);
          if (Number.isFinite(v) && v > 0) {
            positions[idx][col].value = +(v.toFixed(2));
            const valInp = tr.querySelector(`.sv-pos-val[data-col="${col}"]`);
            if (valInp) valInp.value = positions[idx][col].value;
            toast(`✓ ${curVal} ${oldCur} → ${positions[idx][col].value} ${newCur}`, 'ok');
          } else {
            toast(`⚠ Курс ${oldCur}→${newCur} не найден. Откройте «💱 Курсы валют» в сайдбаре service для обновления.`, 'err');
          }
        }
      }
      positions[idx][col].currency = newCur;
    }
  } else if (col && attr === 'value') {
    if (!positions[idx][col]) positions[idx][col] = { value: 0, currency: displayCurrency };
    positions[idx][col].value = Number(targetVal) || 0;
  } else if (attr === 'label') {
    positions[idx].label = targetVal;
  } else if (attr === 'category') {
    positions[idx].category = targetVal;
  } else if (attr === 'unit') {
    positions[idx].unit = targetVal;
  } else if (attr === 'qty') {
    positions[idx].qty = Number(targetVal) || 0;
  } else {
    return;  // ignore прочие поля
  }
  onChange({ ...o, positions });
}

function setByPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  return obj;
}

/* v0.60.45: in-page confirm для перезаписи импортированных позиций. */
async function confirmOverwrite(msg) {
  const result = await modalOpen(
    '<h3>⚠ Подтверждение перезаписи</h3>',
    `<p style="font-size:13px">${escHtml(msg)}</p><p class="muted" style="font-size:11.5px;margin-top:8px">Свободные (пользовательские) позиции и позиции из ДРУГИХ источников НЕ затрагиваются.</p>`,
    async () => ({ ok: true })
  );
  return !!result;
}

async function pickCoolingOptionModal(orderType, displayCurrency) {
  // Читаем cooling-подборы из текущего контекста (project pid из URL, либо standalone)
  const params = new URLSearchParams(location.search);
  const pid = params.get('standalone') === '1' ? null : (params.get('pid') || null);
  const selections = loadCoolingSelectionsForContext(pid);
  if (!selections.length) {
    toast(`В текущем контексте (${pid ? 'pid=' + pid : 'standalone'}) нет cooling-подборов. Откройте модуль Подбор холодильных систем и создайте подбор сначала.`, 'err');
    return null;
  }
  // Список (Подбор → Опция) для select
  const opts = [];
  for (const sel of selections) {
    if (!sel.options?.length) continue;
    for (const opt of sel.options) {
      const eqCount = (opt.equipment || []).length;
      const meta = eqCount ? `${eqCount} групп оборудования` : '⚠ нет equipment';
      opts.push({ selId: sel.id, selName: sel.name, optId: opt.id, optName: opt.name, meta });
    }
  }
  if (!opts.length) {
    toast('У cooling-подборов нет опций с оборудованием. Откройте Подбор холодильных систем → добавьте варианты.', 'err');
    return null;
  }
  const selOpts = opts.map((o, i) =>
    `<option value="${i}">${escHtml(o.selName)} → ${escHtml(o.optName)} (${escHtml(o.meta)})</option>`
  ).join('');
  const result = await modalOpen(
    '<h3>❄ Импорт работ из cooling-подбора</h3>',
    `<label>Выберите подбор и опцию:<select id="sv-cool-sel" size="10" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">${selOpts}</select></label>
     <p class="muted" style="font-size:11.5px;margin-top:6px">Тип наряда: <b>${escHtml(orderType === 'maintenance' ? 'ТО' : 'Монтаж')}</b>. Будут добавлены позиции с qty из топологии и дефолтными ценами по типу/мощности оборудования.</p>`,
    async () => {
      const sel = document.getElementById('sv-cool-sel');
      const i = Number(sel?.value);
      if (!Number.isFinite(i) || !opts[i]) return null;
      const meta = opts[i];
      const selection = selections.find(s => s.id === meta.selId);
      const option = selection?.options?.find(o => o.id === meta.optId);
      if (!selection || !option) return null;
      return { picked: { selection, option } };
    }
  );
  return result?.picked || null;
}

async function pickTemplateModal(type, displayCurrency) {
  // v0.60.36: используем каталог service/catalog/work-templates.js
  // (включает SEED + user-кастомные через addTemplate).
  const tpls = listTemplates(type);
  if (!tpls.length) {
    toast('Нет шаблонов для этого типа наряда.', 'info');
    return null;
  }
  const opts = tpls.map((t, i) => {
    const userMark = t.isUser ? '✏ ' : '';
    return `<option value="${i}" title="${escAttr(t.label)} — ${escAttr(t.category)}, ${t.costPrice} ₽ → ${t.clientPrice} ₽${t.isUser ? ' (пользовательский)' : ' (встроенный)'}">${userMark}${escHtml(t.label)} (${escHtml(t.category)}, ${t.unit})</option>`;
  }).join('');
  const result = await modalOpen(
    `<h3>📚 Шаблоны типовых работ — ${escHtml(ORDER_TYPES.find(t => t.id === type)?.label || '')}</h3>`,
    `<label>Выберите шаблон:<select id="sv-tpl-sel" size="10" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px;font:inherit;font-size:13px">${opts}</select></label>
     <p class="muted" style="font-size:11.5px;margin-top:6px">✏ — пользовательские, без значка — встроенные. Цены в шаблонах указаны в ₽. Если валюта проекта другая — после добавления откорректируйте через select валюты в строке. Управление каталогом: кнопка «📚 Каталог работ» в сайдбаре.</p>`,
    async () => {
      const sel = document.getElementById('sv-tpl-sel');
      const i = Number(sel?.value);
      if (!Number.isFinite(i) || !tpls[i]) return null;
      return { idx: i };
    }
  );
  if (!result) return null;
  const t = tpls[result.idx];
  // v0.60.51: дефолтная валюта по категории (material → $, прочие → ₸).
  // Возвращаем position + transient meta для auto-suggest материалов.
  const cur = t.category === 'material' ? '$' : '₸';
  return {
    position: {
      id: 'pos-' + Math.random().toString(36).slice(2, 8),
      label: t.label,
      category: t.category,
      qty: 1,
      unit: t.unit,
      costPrice:   { value: t.costPrice,   currency: cur },
      clientPrice: { value: t.clientPrice, currency: cur },
    },
    workType:      t.workType || null,
    equipmentKind: t.equipmentKind || null,
    capacityKw:    Number(t.capacityKw) || null,
  };
}

/**
 * v0.60.51 (Phase 32.3): модалка-предложение добавить рекомендуемые материалы
 * после выбора работы. Если у материала есть consumptionRate.perKw —
 * предлагаемое qty = capacityKw × perKw (округляем вверх). Иначе qty = 1.
 *
 * @param {Array<object>} suggestions — материалы, найденные suggestMaterialsForWork
 * @param {number|null} capacityKw — для расчёта qty по consumptionRate
 * @returns {Promise<Array<object>|null>} массив positions или null если cancel
 */
async function suggestMaterialsModal(suggestions, capacityKw) {
  const calcQty = (m) => {
    if (m.consumptionRate?.perKw && Number.isFinite(capacityKw)) {
      const v = m.consumptionRate.perKw * capacityKw;
      return Math.max(1, Math.ceil(v * 10) / 10);  // округление до 0.1
    }
    return 1;
  };
  const rows = suggestions.map((m, i) => {
    const qty = calcQty(m);
    const totalPrice = (m.defaultPrice?.value || 0) * qty;
    const totalStr = `${totalPrice.toLocaleString('ru-RU')} ${m.defaultPrice?.currency || ''}`;
    const userMark = m.isUser ? '✏' : '📦';
    const consumptionStr = m.consumptionRate?.perKw && capacityKw
      ? `<span class="muted" style="font-size:10.5px"> · ${m.consumptionRate.perKw} ${m.consumptionRate.unit} × ${capacityKw} кВт</span>`
      : '';
    return `<tr data-idx="${i}">
      <td><input type="checkbox" data-pick checked></td>
      <td>${userMark} <b>${escHtml(m.name)}</b>${m.sku ? ` <span class="muted" style="font-size:10.5px">${escHtml(m.sku)}</span>` : ''}${consumptionStr}</td>
      <td class="num"><input type="number" min="0" step="0.5" data-qty value="${qty}" style="width:60px;padding:3px 5px;border:1px solid #cbd5e1;border-radius:3px;text-align:right"></td>
      <td>${escHtml(m.unit)}</td>
      <td class="num">${(m.defaultPrice?.value || 0).toLocaleString('ru-RU')} ${escHtml(m.defaultPrice?.currency || '')}</td>
      <td class="num"><b>${escHtml(totalStr)}</b></td>
    </tr>`;
  }).join('');

  const result = await modalOpen(
    `<h3>📦 Рекомендуемые материалы для этой работы</h3>`,
    `<p class="muted" style="font-size:11.5px;margin:0 0 8px">
       Найдено ${suggestions.length} материалов, привязанных к этому виду работ${capacityKw ? ` (мощность ${capacityKw} кВт — qty рассчитан по consumption rate)` : ''}. Снимите галочку чтобы пропустить, или измените qty.
     </p>
     <div style="max-height:50vh;overflow:auto;border:1px solid #e2e8f0;border-radius:3px">
       <table style="width:100%;border-collapse:collapse;font-size:12px">
         <thead><tr style="background:#f1f5f9;font-size:10.5px;color:#475569;text-transform:uppercase;letter-spacing:0.3px">
           <th style="padding:6px 8px;width:32px"></th>
           <th style="padding:6px 8px;text-align:left">Материал</th>
           <th style="padding:6px 8px;text-align:right;width:80px">Qty</th>
           <th style="padding:6px 8px;text-align:left;width:60px">Ед.</th>
           <th style="padding:6px 8px;text-align:right;width:90px">Цена/ед</th>
           <th style="padding:6px 8px;text-align:right;width:100px">Сумма</th>
         </tr></thead>
         <tbody>${rows}</tbody>
       </table>
     </div>
     <p class="muted" style="font-size:11px;margin-top:6px">💡 Клиент-цена = себес × 1.4 (40% маржа). Можно отредактировать после добавления.</p>`,
    async (overlay) => {
      const trs = overlay.querySelectorAll('tr[data-idx]');
      const picked = [];
      trs.forEach(tr => {
        const chk = tr.querySelector('[data-pick]');
        if (!chk?.checked) return;
        const idx = Number(tr.dataset.idx);
        const m = suggestions[idx];
        const qty = Number(tr.querySelector('[data-qty]')?.value) || 1;
        picked.push({
          ...defaultPosition('₸', 'material'),
          label: m.name + (m.sku ? ` (${m.sku})` : ''),
          category: 'material',
          qty,
          unit: m.unit,
          costPrice:   { value: m.defaultPrice?.value || 0, currency: m.defaultPrice?.currency || '₸' },
          clientPrice: { value: Math.round((m.defaultPrice?.value || 0) * 1.4), currency: m.defaultPrice?.currency || '₸' },
        });
      });
      return { ok: true, payload: picked };
    }
  );
  return result?.payload || null;
}
