// Инспектор: модалки и блоки для источников питания и генераторов.
//  - openImpedanceModal — параметры IEC 60909 (трансформатор / генератор / utility / other)
//  - openAutomationModal — сценарии автоматизации запуска генератора
//  - sourceStatusBlock — блок статуса в sidebar
//  - voltageLevelOptions — helper генерации опций для select напряжений
// Выделено из inspector.js.
import { GLOBAL, TRANSFORMER_CATALOG } from './constants.js';
import { state } from './state.js';
import { escHtml, escAttr, fmt, field, flash } from './utils.js';
import { effectiveTag } from './zones.js';
import { effectiveOn } from './modes.js';
import { nodeVoltage, sourceImpedance } from './electrical.js';
import { snapshot, notifyChange } from './history.js';
import { render } from './render.js';

let _renderInspector = null;
export function bindInspectorSourceDeps({ renderInspector }) {
  _renderInspector = renderInspector;
}
function _invokeRenderInspector() { if (_renderInspector) _renderInspector(); }

// ================= voltageLevelOptions =================
export function voltageLevelOptions(selectedIdx, filter) {
  const levels = GLOBAL.voltageLevels || [];
  let opts = '';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (filter === '3ph' && lv.phases !== 3) continue;
    if (filter === '1ph' && (lv.phases !== 1 || lv.wires === 2)) continue;
    if (filter === 'dc' && lv.wires !== 2) continue;
    opts += `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escHtml(lv.label)} (${lv.vLL}V)</option>`;
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
  } else if (isTransformer) {
    let tOpts = '<option value="">— выберите —</option>';
    for (const t of TRANSFORMER_CATALOG) {
      const sel = t.snomKva === n.snomKva ? ' selected' : '';
      tOpts += `<option value="${t.snomKva}"${sel}>${t.label}</option>`;
    }
    h.push(field('Типовой номинал (ГОСТ 11677)', `<select id="imp-tCatalog">${tOpts}</select>`));
    h.push(`<div class="muted" style="font-size:10px;margin-top:-4px">При выборе заполняются Uk, Pk, P0 по ГОСТ. Поле Snom остаётся ручным для редактирования.</div>`);
    h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  } else {
    h.push(field('Номинальная мощность (Snom), кВА', `<input type="number" id="imp-snom" min="1" max="100000" step="1" value="${n.snomKva ?? 400}">`));
  }

  const outIdx = (typeof n.voltageLevelIdx === 'number') ? n.voltageLevelIdx : 0;
  h.push(field(isTransformer ? 'Выходное напряжение (вторичная обмотка)' : 'Выходное напряжение',
    `<select id="imp-voltage-out">${voltageLevelOptions(outIdx, null)}</select>`));

  if (isTransformer) {
    const inIdx = (typeof n.inputVoltageLevelIdx === 'number') ? n.inputVoltageLevelIdx : (() => {
      const levels = GLOBAL.voltageLevels || [];
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].vLL >= 6000) return i;
      }
      return 0;
    })();
    h.push(field('Входное напряжение (первичная обмотка)',
      `<select id="imp-voltage-in">${voltageLevelOptions(inIdx, null)}</select>`));
  }

  h.push('<h4 style="margin:16px 0 8px">Параметры короткого замыкания</h4>');
  if (isOther || isUtility) {
    const hint = isUtility
      ? 'Задайте ток трёхфазного КЗ в точке подключения ЛЭП (или Ssc системы).'
      : 'Для стороннего источника задайте ток 3ф КЗ в точке подключения или Ssc сети.';
    h.push(`<div class="muted" style="font-size:11px;margin-bottom:8px">${hint}</div>`);
    h.push(field('Ток трёхфазного КЗ Ik, кА', `<input type="number" id="imp-ikka" min="0" max="200" step="0.1" value="${n.ikKA ?? 10}">`));
    h.push(field('ИЛИ Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="0" max="10000" step="1" value="${n.sscMva ?? 0}">`));
    h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));
  } else {
    h.push(field('Мощность КЗ сети (Ssc), МВА', `<input type="number" id="imp-ssc" min="1" max="10000" step="1" value="${n.sscMva ?? 500}">`));
    if (isTransformer) {
      h.push(field('Напряжение КЗ трансформатора (Uk), %', `<input type="number" id="imp-uk" min="0" max="25" step="0.5" value="${n.ukPct ?? 6}">`));
    } else {
      h.push(field('Xd\'\' (сверхпереходное), о.е.', `<input type="number" id="imp-xdpp" min="0.01" max="1" step="0.01" value="${n.xdpp ?? 0.15}">`));
    }
    h.push(field('Отношение Xs/Rs', `<input type="number" id="imp-xsrs" min="0.1" max="50" step="0.1" value="${n.xsRsRatio ?? 10}">`));
  }

  if (isTransformer) {
    h.push('<h4 style="margin:16px 0 8px">Потери трансформатора</h4>');
    h.push(field('Потери КЗ (Pk), кВт', `<input type="number" id="imp-pk" min="0" max="100" step="0.1" value="${n.pkW ?? 6}">`));
    h.push(field('Потери ХХ (P0), кВт', `<input type="number" id="imp-p0" min="0" max="50" step="0.1" value="${n.p0W ?? 1.5}">`));
    h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Pk — потери короткого замыкания (нагрев обмоток при номинальном токе).<br>P0 — потери холостого хода (нагрев магнитопровода).</div>');
  }

  if (!isTransformer && n.auxInput) {
    h.push('<h4 style="margin:16px 0 8px">Собственные нужды</h4>');
    h.push(field('Мощность СН, kW', `<input type="number" id="imp-auxKw" min="0" max="1000" step="0.1" value="${n.auxDemandKw || 0}">`));
    h.push(field('cos φ СН', `<input type="number" id="imp-auxCos" min="0.1" max="1" step="0.01" value="${n.auxCosPhi || 0.85}">`));
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
    const impName = document.getElementById('imp-name')?.value?.trim();
    if (impName) n.name = impName;
    if (!isUtility) {
      n.snomKva = Number(document.getElementById('imp-snom')?.value) || 400;
    }
    const outLevelIdx = Number(document.getElementById('imp-voltage-out')?.value) || 0;
    const levels = GLOBAL.voltageLevels || [];
    n.voltageLevelIdx = outLevelIdx;
    if (levels[outLevelIdx]) {
      n.voltage = levels[outLevelIdx].vLL;
      n.phase = levels[outLevelIdx].phases === 3 ? '3ph' : '1ph';
    }
    if (isTransformer) {
      const inEl = document.getElementById('imp-voltage-in');
      if (inEl) n.inputVoltageLevelIdx = Number(inEl.value) || 0;
    }
    if (!isUtility) {
      n.capacityKw = n.snomKva * (Number(n.cosPhi) || 0.92);
    }
    if (isOther || isUtility) {
      n.ikKA = Number(document.getElementById('imp-ikka')?.value) || 0;
      n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 0;
      delete n.ukPct;
      delete n.xdpp;
      delete n.pkW;
      delete n.p0W;
      if (isUtility) delete n.inputVoltageLevelIdx;
    } else {
      n.sscMva = Number(document.getElementById('imp-ssc')?.value) || 500;
      if (isTransformer) {
        n.ukPct = Number(document.getElementById('imp-uk')?.value) || 0;
      } else {
        n.xdpp = Number(document.getElementById('imp-xdpp')?.value) || 0.15;
      }
    }
    n.xsRsRatio = Number(document.getElementById('imp-xsrs')?.value) || 10;
    if (isTransformer) {
      n.pkW = Number(document.getElementById('imp-pk')?.value) || 0;
      n.p0W = Number(document.getElementById('imp-p0')?.value) || 0;
    }
    if (!isTransformer && n.auxInput) {
      n.auxDemandKw = Number(document.getElementById('imp-auxKw')?.value) || 0;
      n.auxCosPhi = Number(document.getElementById('imp-auxCos')?.value) || 0.85;
      n.auxBreakerOn = document.getElementById('imp-auxBrk')?.checked !== false;
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

  document.getElementById('modal-impedance').classList.remove('hidden');
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

  const panels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.inputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru'));

  const switchPanels = [...state.nodes.values()]
    .filter(nn => nn.type === 'panel' && nn.outputs > 0)
    .sort((a, b) => (effectiveTag(a) || '').localeCompare(effectiveTag(b) || '', 'ru'));

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
    allInputs.sort((a, b) => a.panelTag.localeCompare(b.panelTag, 'ru') || a.port - b.port);

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
  h.push(field('Задержка запуска, сек', `<input type="number" id="auto-startDelay" min="0" max="600" step="1" value="${n.startDelaySec || 0}">`));
  h.push(field('Задержка остановки, сек', `<input type="number" id="auto-stopDelay" min="0" max="600" step="1" value="${n.stopDelaySec ?? 2}">`));
  h.push('<div class="muted" style="font-size:10px;margin-top:-4px">Задержка запуска — время до выхода на рабочий режим.<br>Задержка остановки — время остывания после снятия нагрузки.</div>');
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

      n.startDelaySec = Number(document.getElementById('auto-startDelay')?.value) || 0;
      n.stopDelaySec = Number(document.getElementById('auto-stopDelay')?.value) ?? 2;

      document.getElementById('modal-automation').classList.add('hidden');
      render();
      _invokeRenderInspector();
      notifyChange();
      flash('Автоматизация обновлена');
    };
  }

  document.getElementById('modal-automation').classList.remove('hidden');
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
    if (n._cosPhi) parts.push(`cos φ: <b>${n._cosPhi.toFixed(2)}</b>`);
    if (n._ikA && isFinite(n._ikA)) parts.push(`Ik на шинах: <b>${fmt(n._ikA / 1000)} кА</b>`);
    if (n._deltaUPct > 0) parts.push(`ΔU: <b>${n._deltaUPct.toFixed(2)}%</b>`);
  }
  if (n.type === 'generator' && n.triggerNodeId) {
    const t = state.nodes.get(n.triggerNodeId);
    if (t) {
      const tPowered = !!t._powered;
      parts.push(`триггер: <b>${escHtml(t.tag || '')}</b> — ${tPowered ? 'норма (дежурство)' : 'обесточен (пуск)'}`);
    }
  }
  return `<div class="inspector-section"><div class="muted" style="font-size:11px;line-height:1.8">${parts.join('<br>')}</div></div>`;
}
