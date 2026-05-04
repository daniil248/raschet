// =============================================================================
// cooling/ui/topology-view.js — UI топологии холодоснабжения
// =============================================================================
// Форма настройки топологии (loop mode, redundancy) + таблица оборудования
// (chillers + CRACs) с per-equipment energy + диаграмма-стрелки связей.
//
// Зависит от calc/topology.js (pure simulator) и DOM.

// v0.60.17: убраны stale-imports (buildTopologyFromOptions/simulateTopology
// больше не используются в этом файле — после v0.60.15 Topology-tab inlined
// в cooling.js). renderTopologyResults использует только passed-in metrics.
import { DEFAULT_TOPOLOGY } from '../calc/topology.js';
import { isCracType, SYSTEM_TYPES } from '../calc/chiller-defaults.js';
import { fmtKwh, fmtMoney } from '../calc/fc-summary.js';
import { escAttr, escHtml } from '../../meteo/util.js';

/**
 * Рендерит панель настройки топологии.
 *
 * @param {object} topoConfig    — { loopMode, redundancyN, redundancyM }
 * @param {function(next)} onChange
 * @param {object} sel           — активный selection (для статистики)
 */
export function renderTopologyConfig(topoConfig, onChange, sel) {
  const t = { ...DEFAULT_TOPOLOGY, ...(topoConfig || {}) };
  const wrap = document.createElement('div');
  wrap.className = 'cl-topo-config';
  const opts = sel?.options || [];
  const chillerCount = opts.filter(o => !isCracType(o.spec?.systemType)).length;
  const cracCount = opts.filter(o => isCracType(o.spec?.systemType)).length;

  wrap.innerHTML = `
    <h4 title="Конфигурация топологии: режим связи (общий контур / точка-точка) и схема резервирования.">🔗 Топология подбора</h4>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Состав подбора (берётся из вариантов)</div>
      <div class="cl-topo-stats">
        <div title="Чиллеры / DX-системы (kind=plant) — источники холода. Берутся из вариантов подбора с типами chiller / dx-air / dx-pumped-fc.">
          ❄ Чиллеры (источники): <b>${chillerCount}</b>
        </div>
        <div title="CRAC (Computer Room Air Conditioner) — потребители холода. Берутся из вариантов с типами crac-water / crac-water+compressor / crac-water+fc-loop.">
          🌬 CRAC (потребители): <b>${cracCount}</b>
        </div>
      </div>
      ${chillerCount === 0 || cracCount === 0
        ? `<p class="muted" style="font-size:11.5px;margin:6px 0 0">⚠ Для топологии нужны и чиллеры, и CRAC. Добавьте варианты разных типов через «+ Вариант» в боковой панели.</p>`
        : ''}
    </div>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Режим связи</div>
      <div class="cl-chiller-grid">
        <label title="Режим связи между чиллерами и CRAC:
• Общий контур (common-loop) — все CRAC подключены к общему трубопроводу с резервированными чиллерами (N+1, 2N схемы). Нагрузка распределяется между активными чиллерами равномерно.
• Точка-точка (p2p) — каждый CRAC жёстко привязан к одному чиллеру, нет перекрёстного резервирования.">
          Тип связи:
          <select data-cf="loopMode">
            <option value="common-loop"${t.loopMode === 'common-loop' ? ' selected' : ''}>Общий контур (с резервированием)</option>
            <option value="p2p"${t.loopMode === 'p2p' ? ' selected' : ''}>Точка-точка (1:1)</option>
          </select>
        </label>
      </div>
    </div>

    <div class="cl-chiller-section">
      <div class="cl-chiller-section-title">Резервирование чиллеров</div>
      <div class="cl-chiller-grid">
        <label title="N — количество штатно работающих чиллеров. На них распределяется суммарная нагрузка от CRAC поровну. Если у вас 3 чиллера и N=2, то 2 работают, 1 в резерве.">
          N (рабочих):<input type="number" min="1" max="20" step="1" data-cf="redundancyN" value="${t.redundancyN}">
        </label>
        <label title="R — количество чиллеров в резерве (готовы включиться при отказе одного из активных). N+R = общее число чиллеров в системе. R=0 — без резервирования.">
          R (резерв):<input type="number" min="0" max="10" step="1" data-cf="redundancyM" value="${t.redundancyM}">
        </label>
        <label title="Режим резерва (по требованию Пользователя 2026-05-02):
• Холодный резерв — резервные чиллеры ПОЛНОСТЬЮ ОТКЛЮЧЕНЫ, ждут failover. Energy = 0. Активны только N. Каждый берёт load/N.
• Горячий резерв — резервные работают параллельно с активными, делят нагрузку. Активны все N+R. Каждый берёт load/(N+R) — ниже part-load на каждом + быстрый failover без ramp-up. Энергопотребление в нашей упрощённой модели аналогичное (т.к. linear power-load), но в реальности горячий резерв ВЫГОДНЕЕ при низкой нагрузке (улучшенный IPLV) и ХУЖЕ при максимальной (overhead на параллельных насосах).">
          Режим резерва:
          <select data-cf="standbyMode">
            <option value="cold"${t.standbyMode === 'cold' ? ' selected' : ''}>Холодный (off, ждёт failover)</option>
            <option value="hot"${t.standbyMode === 'hot' ? ' selected' : ''}>Горячий (работают параллельно)</option>
          </select>
        </label>
      </div>
      <p class="muted" style="font-size:11px;margin:4px 0 0">
        Σ N + R = ${(t.redundancyN || 0) + (t.redundancyM || 0)} чиллеров в системе. ${
          t.standbyMode === 'hot'
            ? `Все ${(t.redundancyN || 0) + (t.redundancyM || 0)} работают параллельно (горячий резерв).`
            : `Активны ${t.redundancyN || 0}, в холодном резерве ${t.redundancyM || 0}.`
        }
        ${chillerCount > 0 && (t.redundancyN + t.redundancyM) > chillerCount
          ? ` <span style="color:#b91c1c">⚠ В подборе только ${chillerCount} чиллер${chillerCount === 1 ? '' : 'ов'} — расчёт пойдёт по доступным.</span>`
          : ''}
      </p>
    </div>
  `;

  wrap.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-cf]');
    if (!inp) return;
    const field = inp.dataset.cf;
    const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    onChange({ ...t, [field]: val });
  });
  return wrap;
}

/**
 * Таблица per-equipment с энергией и пиком, плюс агрегированный итог.
 */
export function renderTopologyResults(metrics, currency = '₽', tariff = 0) {
  if (!metrics || !metrics.perEquipment.length) {
    return '<div class="muted">Нет данных для расчёта. Добавьте варианты разных типов и задайте топологию.</div>';
  }
  const sumEnergy = metrics.totalEnergyKwh;
  const sumCost = sumEnergy * (tariff || 0);

  const rows = metrics.perEquipment.map(e => {
    const kindLabel = {
      'chiller':              '❄ Чиллер',
      'chiller-hot-standby':  '🔥 Чиллер (горячий резерв)',
      'chiller-cold-standby': '⏸ Чиллер (холодный резерв)',
      'chiller-standby':      '⏸ Чиллер (резерв)',  // legacy alias
      'crac':                 '🌬 CRAC',
    }[e.kind] || e.kind;
    return `<tr title="${escAttr(e.kind)}">
      <td>${escHtml(kindLabel)}</td>
      <td>${escHtml(e.name)}</td>
      <td class="num" title="Rated capacity">${e.ratedCapKw.toFixed(0)}</td>
      <td class="num" title="Пиковая мощность за все интервалы температуры наружного воздуха">${e.peakKw.toFixed(2)}</td>
      <td class="num" title="Годовое эл. потребление этого блока">${fmtKwh(e.energyKwh)}</td>
      <td class="num" title="Доля в общем потреблении системы">${sumEnergy > 0 ? (e.energyKwh / sumEnergy * 100).toFixed(1) : '0'}%</td>
    </tr>`;
  }).join('');

  return `<table class="cl-annual-table">
    <thead>
      <tr>
        <th title="Тип оборудования: чиллер / CRAC / резервный чиллер.">Тип</th>
        <th title="Имя варианта из подбора.">Имя</th>
        <th class="num" title="Rated cooling capacity, кВт.">Rated кВт</th>
        <th class="num" title="Пиковая мощность за все интервалы температуры наружного воздуха, кВт. Помогает оценить требования к электропитанию.">Пик кВт</th>
        <th class="num" title="Годовое суммарное потребление этого оборудования.">Энергия / год</th>
        <th class="num" title="Доля в общем потреблении системы.">% от Σ</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right" title="Σ по всему оборудованию системы"><b>ИТОГО система:</b></td>
        <td class="num"><b>${fmtKwh(sumEnergy)}</b></td>
        <td class="num"><b>100%</b></td>
      </tr>
      ${tariff > 0 ? `<tr>
        <td colspan="4" style="text-align:right" title="Годовые эксплуатационные затраты на электроэнергию системы при тарифе ${tariff} ${escHtml(currency)}/кВт·ч"><b>OPEX за год (${escHtml(currency)} ${tariff}/кВт·ч):</b></td>
        <td class="num"><b>${fmtMoney(sumCost, currency)}</b></td>
        <td></td>
      </tr>` : ''}
      <tr>
        <td colspan="4" style="text-align:right" title="Холодопроизводительность системы — суммарная capacity всех CRAC."><b>Σ Cooling:</b></td>
        <td class="num"><b>${metrics.totalCoolingKw.toFixed(0)} кВт</b></td>
        <td></td>
      </tr>
    </tfoot>
  </table>`;
}
