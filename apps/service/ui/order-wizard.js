// =============================================================================
// service/ui/order-wizard.js — Phase 42 v0.60.109
// =============================================================================
// Мастер составления нарядов. По запросу Пользователя 2026-05-04:
// «в нарядах добавь мастер составления нарядов, который по категориям работ
// будет сам предлагать выбрать соответствующие пункты, например если речь
// идет про систему вентиляции, то мастер запрашивает производительность
// системы, затем соответственно предлагает соответствующие расходные
// материалы для конкретной установки, учитывая производительность, по ходы
// работы мастера спрашивая пользователя, нужно ли добавить тот или иной
// пункт».
//
// Этапы мастера:
//   1. Выбор сценария (ТО вентиляции / ТО чиллера / ТО ИБП / ...).
//   2. Заполнение параметров (расход, мощность, тип хладагента, ...).
//   3. Просмотр предложений с галочками (можно снять / редактировать qty).
//   4. Подтверждение → позиции добавлены в наряд.
// =============================================================================

import { listWizards, evalExpr, interpolate } from '../catalog/wizards/index.js';
import { escAttr, escHtml, toast } from 'meteo/util.js';
import { resolveDefaultCurrency } from 'shared/currency-defaults.js';
import { getActiveProjectId } from 'shared/project-storage.js';

/**
 * Открыть мастер. Возвращает Promise<positions[]|null> — массив позиций
 * для добавления в наряд (label, category, unit, qty, costPrice,
 * costCurrency, clientPrice, clientCurrency), или null при отмене.
 *
 * @param {object} ctx — контекст вызова: { orderType: 'install'|'maintenance'|...,
 *                                          activeProjectId, prefill: {...} }
 */
export async function openOrderWizard(ctx = {}) {
  const orderType = ctx.orderType || 'maintenance';
  const wizards = listWizards(orderType);
  if (!wizards.length) {
    toast('Нет сценариев для типа наряда «' + orderType + '».', 'warn');
    return null;
  }

  // ─── Этап 1: Выбор сценария
  const wizard = await pickScenario(wizards, orderType);
  if (!wizard) return null;

  // ─── Этап 2: Параметры
  const params = await collectParams(wizard);
  if (!params) return null;

  // ─── Этап 3: Предложения
  const selected = await reviewSuggestions(wizard, params);
  if (!selected) return null;

  // ─── Этап 4: Конвертация selected в позиции наряда
  const cur = resolveDefaultCurrency(getActiveProjectId());
  const positions = selected.map(s => ({
    label: s.label,
    category: s.category || 'other',
    unit: s.unit || 'шт',
    qty: Number(s.qty) || 1,
    costPrice: { value: Number(s.costPrice) || 0, currency: s.costCurrency || cur },
    clientPrice: { value: Number(s.clientPrice) || 0, currency: s.clientCurrency || cur },
    sourceModule: 'wizard',
    sourceRef: { wizardId: wizard.id, params },
  }));

  toast(`✓ Мастер «${wizard.title}» — ${positions.length} позиций`, 'ok');
  return positions;
}

// ─── Этап 1
function pickScenario(wizards, orderType) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mt-modal-overlay';
    const cards = wizards.map(w => `
      <button type="button" class="wz-pick-card" data-wid="${escAttr(w.id)}" title="${escAttr(w.description)}"
              style="display:block;width:100%;text-align:left;margin:6px 0;padding:12px 14px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font:inherit">
        <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:3px">${w.icon} ${escHtml(w.title)}</div>
        <div style="font-size:11.5px;color:#64748b">${escHtml(w.description)}</div>
      </button>
    `).join('');
    overlay.innerHTML = `<div class="mt-modal" role="dialog" style="max-width:560px">
      <div class="mt-modal-head"><h3>🪄 Мастер составления наряда</h3></div>
      <div class="mt-modal-body">
        <p class="muted" style="font-size:12px;margin:0 0 10px">Тип наряда: <b>${escHtml(orderType)}</b>. Выберите сценарий:</p>
        ${cards || '<p class="muted">Нет сценариев для этого типа.</p>'}
      </div>
      <div class="mt-modal-actions">
        <button type="button" class="mt-modal-btn mt-modal-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.mt-modal-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    overlay.querySelectorAll('.wz-pick-card').forEach(b => {
      b.addEventListener('click', () => {
        const w = wizards.find(x => x.id === b.dataset.wid);
        overlay.remove();
        resolve(w || null);
      });
    });
  });
}

// ─── Этап 2: Параметры
//
// v0.60.117 (Phase 42.5): cross-module pre-fill. Если в проекте уже есть
// данные cooling-подбора / ups-config / ДГУ — wizard подтягивает значения
// в параметры по умолчанию. По roadmap Phase 42.5: «Если активен проект
// с cooling-подбором — мастер ТО чиллера предлагает мощность из подбора».
//
// Источники по wizard.id:
//   wz-seed-chiller-to     ← cooling.selections (capKw, refrigerant)
//   wz-seed-ups-to         ← ups-config.selected (kva, batteryCount, batteryTech)
//   wz-seed-ventilation-to ← пока нет источника (вентиляция не моделируется)
//                            в системе — TODO когда появится).
function _collectPrefillFromProject(wizard) {
  const pid = (() => { try { return getActiveProjectId(); } catch { return null; } })();
  const out = {};
  try {
    if (wizard.id === 'wz-seed-chiller-to') {
      // cooling.selections.v1 — массив подборов; ищем первый чиллерный
      // option в активном (или первом) подборе.
      const key = pid ? `raschet.project.${pid}.cooling.selections.v1` : 'raschet.cooling.standalone.cooling.selections.v1';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(arr) && arr.length) {
        const sel = arr.find(s => s.activeOptionId) || arr[0];
        const opt = sel?.options?.find(o => o.id === sel?.activeOptionId) || sel?.options?.[0];
        const eq = (opt?.equipment || []).find(e => /chiller/i.test(e.spec?.systemType || e.role || '')) || opt?.equipment?.[0];
        if (eq?.spec?.ratedCapKw > 0) out.capKw = Math.round(eq.spec.ratedCapKw);
        if (eq?.spec?.refrigerant) out.refrigerant = eq.spec.refrigerant;
        out._source = `cooling-подбор «${sel.name || 'без имени'}» → опция «${opt?.name || ''}»`;
      }
    } else if (wizard.id === 'wz-seed-ups-to') {
      // ups-config.selected.v1 — single object с capacityKw (не kVA напрямую).
      // Wizard.kva = kVA → конвертируем kW / cos φ.
      const key = pid ? `raschet.project.${pid}.ups-config.selected.v1` : null;
      if (key) {
        const sel = JSON.parse(localStorage.getItem(key) || 'null');
        if (sel) {
          if (sel.capacityKw > 0) {
            const cos = Number(sel.cosPhi) || 0.9;
            out.kva = Math.round(sel.capacityKw / cos);
          }
          // batteryCount/stringCount не сохраняются в текущем bridge —
          // оставляем для будущего расширения. autonomyMin не нужен в ТО.
          out._source = `ups-config «${sel.supplier || ''} ${sel.model || ''}»`.trim();
        }
      }
    }
  } catch (e) { console.warn('[wizard] prefill failed:', e); }
  return out;
}

function collectParams(wizard) {
  return new Promise(resolve => {
    // v0.60.117: pre-fill из проекта.
    const prefill = _collectPrefillFromProject(wizard);
    const prefilledKeys = new Set(Object.keys(prefill).filter(k => !k.startsWith('_')));

    const overlay = document.createElement('div');
    overlay.className = 'mt-modal-overlay';
    const rows = wizard.params.map(p => {
      // v0.60.117: подтягиваем prefill-значение если оно есть.
      const prefillVal = prefill[p.id];
      const effectiveDefault = (prefillVal !== undefined && prefillVal !== null && prefillVal !== '') ? prefillVal : (p.default ?? '');
      const isPrefilled = prefilledKeys.has(p.id) && prefillVal !== undefined;
      let input;
      if (p.type === 'choice') {
        const opts = p.options.map(o => `<option value="${escAttr(o.v)}"${o.v === effectiveDefault ? ' selected' : ''}>${escHtml(o.l)}</option>`).join('');
        input = `<select data-pid="${escAttr(p.id)}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px${isPrefilled ? ';background:#dbeafe' : ''}">${opts}</select>`;
      } else {
        input = `<input type="number" data-pid="${escAttr(p.id)}" value="${effectiveDefault}" min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step || 1}"${p.required ? ' required' : ''} style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:3px${isPrefilled ? ';background:#dbeafe' : ''}">`;
      }
      const prefillBadge = isPrefilled
        ? `<span style="display:inline-block;font-size:10.5px;background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;margin-left:6px;font-weight:600" title="Подтянуто из проекта (${escAttr(prefill._source || '')})">📁 авто</span>`
        : '';
      return `<label style="display:block;margin:6px 0" title="${escAttr(p.tip || '')}">
        <span style="display:block;font-size:11.5px;color:#475569;margin-bottom:3px">${escHtml(p.label)}${p.required ? ' <span style="color:#dc2626">*</span>' : ''}${prefillBadge}</span>
        ${input}
      </label>`;
    }).join('');
    const sourceHint = prefill._source
      ? `<p class="muted" style="font-size:11px;margin:4px 0 10px;padding:6px 10px;background:#dbeafe;border-left:3px solid #1d4ed8;border-radius:3px">📁 Параметры (отмечены 📁 авто) подтянуты из <b>${escHtml(prefill._source)}</b>. Можно скорректировать вручную перед «Далее».</p>`
      : '';
    overlay.innerHTML = `<div class="mt-modal" role="dialog" style="max-width:520px">
      <div class="mt-modal-head"><h3>${wizard.icon} ${escHtml(wizard.title)} — параметры</h3></div>
      <div class="mt-modal-body">
        <p class="muted" style="font-size:12px;margin:0 0 10px">${escHtml(wizard.description)}</p>
        ${sourceHint}
        ${rows}
      </div>
      <div class="mt-modal-actions">
        <button type="button" class="mt-modal-btn mt-modal-cancel">Отмена</button>
        <button type="button" class="mt-modal-btn mt-modal-ok">Далее →</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.mt-modal-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    overlay.querySelector('.mt-modal-ok').addEventListener('click', () => {
      const params = {};
      for (const p of wizard.params) {
        const el = overlay.querySelector(`[data-pid="${p.id}"]`);
        if (!el) continue;
        let v = el.value;
        if (p.required && !String(v).trim()) {
          toast(`Заполните «${p.label}»`, 'warn');
          el.focus();
          return;
        }
        if (p.type !== 'choice') v = Number(v) || 0;
        params[p.id] = v;
      }
      overlay.remove();
      resolve(params);
    });
  });
}

// ─── Этап 3: Предложения
function reviewSuggestions(wizard, params) {
  return new Promise(resolve => {
    // Вычислить предложения по правилам
    const computed = [];
    for (const grp of wizard.suggestions) {
      const groupItems = [];
      for (const rule of grp.rules) {
        const ok = !!evalExpr(rule.when, { params });
        if (!ok) continue;
        const qty = (typeof rule.qty === 'string')
          ? (Number(evalExpr(rule.qty, { params })) || 0)
          : (Number(rule.qty) || 1);
        if (qty <= 0) continue;
        groupItems.push({
          ...rule,
          qty: Math.round(qty * 100) / 100,
          askText: interpolate(rule.ask || rule.label, { params: { ...params, qty } }),
          _id: 'wz-' + Math.random().toString(36).slice(2, 8),
        });
      }
      if (groupItems.length) {
        computed.push({ group: grp.group, items: groupItems });
      }
    }

    if (!computed.length) {
      toast('При заданных параметрах нет рекомендаций.', 'info');
      resolve(null);
      return;
    }

    const cur = resolveDefaultCurrency(getActiveProjectId());
    const overlay = document.createElement('div');
    overlay.className = 'mt-modal-overlay';
    const groupsHtml = computed.map(grp => `
      <div style="margin:10px 0">
        <h4 style="margin:6px 0;font-size:13px;color:#075985;border-bottom:1px solid #e2e8f0;padding-bottom:4px">${escHtml(grp.group)}</h4>
        ${grp.items.map(it => {
          const cost = (Number(it.costPrice) || 0).toLocaleString('ru-RU');
          const cli = (Number(it.clientPrice) || 0).toLocaleString('ru-RU');
          const c = it.costCurrency || cur;
          return `<div class="wz-sug-row" data-rid="${escAttr(it._id)}" style="display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:5px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;margin:3px 0">
            <input type="checkbox" class="wz-sug-check" data-rid="${escAttr(it._id)}" checked>
            <div>
              <div style="font-size:12px;font-weight:600;color:#0f172a">${escHtml(it.askText || it.label)}</div>
              <div style="font-size:10.5px;color:#64748b">${escHtml(it.label)} · ${escHtml(it.category)} · себес ${cost} ${escHtml(c)} · клиент ${cli} ${escHtml(c)}</div>
            </div>
            <input type="number" class="wz-sug-qty" data-rid="${escAttr(it._id)}" value="${it.qty}" min="0" step="0.5"
                   style="width:70px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:3px;text-align:right">
            <span style="font-size:11px;color:#64748b;min-width:50px">${escHtml(it.unit || 'шт')}</span>
          </div>`;
        }).join('')}
      </div>
    `).join('');

    overlay.innerHTML = `<div class="mt-modal" role="dialog" style="max-width:760px">
      <div class="mt-modal-head"><h3>${wizard.icon} Предложения мастера</h3></div>
      <div class="mt-modal-body" style="max-height:60vh;overflow-y:auto">
        <p class="muted" style="font-size:11.5px;margin:0 0 8px">Снимите галочку с ненужных. Можно изменить количество. Цены подтянуты по дефолту — отредактируйте после добавления в наряд.</p>
        ${groupsHtml}
      </div>
      <div class="mt-modal-actions">
        <button type="button" class="mt-modal-btn mt-modal-cancel">Отмена</button>
        <button type="button" class="mt-modal-btn mt-modal-ok">✓ Добавить в наряд</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.mt-modal-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    overlay.querySelector('.mt-modal-ok').addEventListener('click', () => {
      const flat = [];
      for (const grp of computed) {
        for (const it of grp.items) {
          flat.push(it);
        }
      }
      const selected = [];
      for (const it of flat) {
        const chk = overlay.querySelector(`.wz-sug-check[data-rid="${it._id}"]`);
        if (!chk?.checked) continue;
        const qtyInput = overlay.querySelector(`.wz-sug-qty[data-rid="${it._id}"]`);
        const qty = Number(qtyInput?.value) || it.qty;
        if (qty <= 0) continue;
        selected.push({ ...it, qty });
      }
      if (!selected.length) {
        toast('Не выбрано ни одной позиции.', 'warn');
        return;
      }
      overlay.remove();
      resolve(selected);
    });
  });
}
