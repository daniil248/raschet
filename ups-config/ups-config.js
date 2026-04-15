// ======================================================================
// ups-config.js
// Подпрограмма «Конфигуратор ИБП» — скелет для будущей полноценной
// работы с каталогом моделей ИБП, подбором резервирования и применением
// конфигурации к узлам схемы.
//
// Текущий статус: stub. Импортирует shared-модули для проверки того,
// что вся инфраструктура подпрограмм доступна и автономна (auth, picker,
// shared-стили). Логика подбора появится в следующих итерациях.
// ======================================================================

import { formatUpsSummary, readUpsDcParams, UPS_DC_DEFAULTS } from '../shared/ups-picker.js';

// Демо-узел «виртуальный ИБП» с дефолтными параметрами — показываем,
// как shared/ups-picker.js читает из него сводку. Когда появится каталог
// UPS и возможность применять модель к реальному узлу, этот демо-блок
// заменится на полноценный пикер.
const demoNode = {
  upsType: 'modular',
  capacityKw: 300,
  _loadKw: 220,
  _maxLoadKw: 280,
  efficiency: UPS_DC_DEFAULTS.efficiency,
  cosPhi: UPS_DC_DEFAULTS.cosPhi,
  batteryVdcMin: UPS_DC_DEFAULTS.vdcMin,
  batteryVdcMax: UPS_DC_DEFAULTS.vdcMax,
};

function renderDemo() {
  const mount = document.getElementById('ups-picker-demo');
  if (!mount) return;
  const dc = readUpsDcParams(demoNode);
  mount.innerHTML = `
    <div style="font-size:12px;padding:10px 14px;background:var(--rs-bg-soft);border-radius:6px;line-height:1.8">
      <div style="font-weight:600;color:var(--rs-accent);margin-bottom:4px">Демо: чтение параметров через shared/ups-picker.js</div>
      <div>${formatUpsSummary(demoNode)}</div>
      <div class="muted">V<sub>DC</sub>: ${dc.vdcMin}…${dc.vdcMax} В · КПД DC–AC: ${dc.efficiency}% · cos φ: ${dc.cosPhi.toFixed(2)}</div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  renderDemo();
  const back = document.getElementById('btn-back');
  if (back) back.addEventListener('click', () => { window.location.href = '../hub.html'; });
});
