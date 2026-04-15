// ======================================================================
// shared/ups-picker.js
// Единый модуль доступа к параметрам ИБП для всех подпрограмм: инспектор
// схемы, расчёт АКБ, будущий «Конфигуратор ИБП». Главная идея — все поля
// ИБП хранятся В ОДНОМ МЕСТЕ (на узле схемы либо в будущей записи каталога),
// а модули только читают их через эти хелперы. Это предотвращает дрейф
// данных между модулями и готовит инфраструктуру для каталога ИБП.
//
// Текущий API:
//   readUpsDcParams(node)   — параметры входа АКБ (V_DC min/max, КПД, cos φ)
//   readUpsCapacity(node)   — номинальная / фактическая мощность
//   formatUpsSummary(node)  — однострочное описание ИБП для UI-подсказок
//
// Позже добавится:
//   mountUpsPicker(container, opts)  — каскадный выбор Производитель →
//                                       серия → модель (когда появится
//                                       каталог UPS, аналог battery-picker)
//   applyUpsModel(node, upsRecord)   — применение выбранной модели к узлу
// ======================================================================

// Значения по умолчанию для DC-параметров батарейной цепи ИБП. Совпадают
// с дефолтами в openUpsParamsModal, чтобы «пустые» значения не расходились.
export const UPS_DC_DEFAULTS = Object.freeze({
  vdcMin: 340,   // В — минимальное напряжение на DC-шине инвертора
  vdcMax: 480,   // В — максимальное напряжение на DC-шине инвертора
  efficiency: 95,// % — КПД преобразования DC → AC
  cosPhi: 1.0,   // cos φ нагрузки ИБП при номинальной мощности
});

/**
 * Читает DC-параметры входа батарейной цепи из узла ИБП.
 * Все 4 поля имеют безопасные дефолты, так что результат всегда валиден.
 * @param {Object} node — узел ИБП (state.nodes entry)
 * @returns {{vdcMin:number, vdcMax:number, efficiency:number, cosPhi:number}}
 */
export function readUpsDcParams(node) {
  const n = node || {};
  return {
    vdcMin:     Number(n.batteryVdcMin ?? UPS_DC_DEFAULTS.vdcMin),
    vdcMax:     Number(n.batteryVdcMax ?? UPS_DC_DEFAULTS.vdcMax),
    efficiency: Number(n.efficiency   ?? UPS_DC_DEFAULTS.efficiency),
    cosPhi:     Number(n.cosPhi       ?? UPS_DC_DEFAULTS.cosPhi),
  };
}

/**
 * Возвращает мощность ИБП: номинальную (по паспорту) и текущую расчётную.
 * Для модульных ИБП номинал = min(frameKw, working_modules × module_kw).
 * @param {Object} node
 * @returns {{nominalKw:number, loadKw:number, maxLoadKw:number}}
 */
export function readUpsCapacity(node) {
  const n = node || {};
  return {
    nominalKw: Number(n.capacityKw) || 0,
    loadKw:    Number(n._loadKw)    || 0,
    maxLoadKw: Number(n._maxLoadKw) || 0,
  };
}

/**
 * Короткое описание ИБП для подсказок (hover, placeholder).
 * Пример: «Моноблок · 300 kW · КПД 95% · cos φ 1.00»
 */
export function formatUpsSummary(node) {
  const n = node || {};
  const { nominalKw } = readUpsCapacity(node);
  const { efficiency, cosPhi } = readUpsDcParams(node);
  const type = n.upsType === 'modular' ? 'Модульный' : 'Моноблок';
  return `${type} · ${Math.round(nominalKw)} kW · КПД ${efficiency}% · cos φ ${cosPhi.toFixed(2)}`;
}

// === Будущее: каталог UPS и mountUpsPicker ===
// Когда появится подпрограмма «Конфигуратор ИБП», здесь добавится:
//   groupUpsBySupplier(list)
//   mountUpsPicker(container, { list, selectedId, onChange, ... })
//   applyUpsModel(node, upsRecord) — синхронно с applyBatteryModel
// по аналогии с shared/battery-picker.js.
