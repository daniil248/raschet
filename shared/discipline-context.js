/* =========================================================================
   shared/discipline-context.js — реестр КОНТЕКСТ-ПАЛИТР Конструктора
   (D3, X.4.5.3). Контракт-шов: один Конструктор-app, единый интерфейс,
   но РАЗНЫЙ непересекающийся набор инструментов под активную дисциплину
   (state.project.discipline). Электро-контекст = текущая палитра
   Конструктора БЕЗ изменений (регрессия-сейф; принцип v0.60.277/278
   «без отвлечений» сохранён ПЕР-КОНТЕКСТ). Остальные — scaffold-палитры
   для будущей разводки. Чистые данные + аксессоры, БЕЗ import модулей/
   ядра (CORE→SHARED разрешён contracts §3 — Конструктор это прочтёт).
   На этом шаге ПОТРЕБИТЕЛЕЙ нет (cache-safe); разводка в Конструктор —
   следующими одобренными инкрементами.
   ========================================================================= */

/** Сентинел: «оставить текущую электро-палитру Конструктора как есть». */
export const CURRENT_ELECTRICAL_PALETTE = '__constructor_current__';

/**
 * @typedef {Object} DisciplineContext
 * @property {string}  id        == id дисциплины (shared/disciplines.js)
 * @property {string}  label
 * @property {string}  icon
 * @property {'active'|'scaffold'} status  active = разведено в Конструктор
 * @property {string|Array} palette  CURRENT_ELECTRICAL_PALETTE | группы
 *           [{ group, items:[{ kind, label, icon }] }]
 * @property {string[]} inspectorTabs  табы инспектора этого контекста
 * @property {string}  note
 */

/** @type {DisciplineContext[]} порядок = порядок в UI-селекторе. */
export const DISCIPLINE_CONTEXTS = [
  {
    id: 'electrical', label: 'Электроснабжение', icon: '⚡',
    status: 'active',
    palette: CURRENT_ELECTRICAL_PALETTE,   // НИЧЕГО не меняем
    inspectorTabs: ['general', 'electrical', 'geometry'],
    note: 'Текущая палитра Конструктора. Зеро-изменений (регрессия-сейф).',
  },
  {
    id: 'hydraulic', label: 'Гидравлика', icon: '💧',
    status: 'scaffold',
    palette: [
      { group: 'Трубопровод', items: [
        { kind: 'pipe-segment', label: 'Участок трубы', icon: '━' },
        { kind: 'fitting',      label: 'Фасонина',       icon: '⌐' },
      ] },
      { group: 'Оборудование', items: [
        { kind: 'pump',   label: 'Насос',     icon: '⊚' },
        { kind: 'valve',  label: 'Арматура',  icon: '⋈' },
        { kind: 'tank',   label: 'Ёмкость',   icon: '⬡' },
        { kind: 'consumer-hydr', label: 'Потребитель', icon: '◇' },
      ] },
    ],
    inspectorTabs: ['general', 'hydraulic', 'geometry'],
    note: 'Scaffold. Разводка палитры/инспектора — будущий инкремент.',
  },
  {
    id: 'hvac', label: 'ОВиК (вентиляция)', icon: '🌬',
    status: 'scaffold',
    palette: [
      { group: 'Воздуховоды', items: [
        { kind: 'duct',     label: 'Воздуховод', icon: '▭' },
        { kind: 'duct-fit', label: 'Фасонина',   icon: '⌐' },
      ] },
      { group: 'Оборудование', items: [
        { kind: 'ahu',      label: 'Приточная установка', icon: '▦' },
        { kind: 'diffuser', label: 'Решётка/диффузор',    icon: '▤' },
        { kind: 'room-hvac', label: 'Помещение',          icon: '▢' },
      ] },
    ],
    inspectorTabs: ['general', 'hvac', 'geometry'],
    note: 'Scaffold. Разводка — будущий инкремент.',
  },
  {
    id: 'gas', label: 'Газоснабжение', icon: '⛽',
    status: 'scaffold',
    palette: [
      { group: 'Газопровод', items: [
        { kind: 'gas-pipe',  label: 'Участок',  icon: '━' },
        { kind: 'gas-fit',   label: 'Фасонина', icon: '⌐' },
      ] },
      { group: 'Оборудование', items: [
        { kind: 'regulator', label: 'Регулятор/ГРПШ', icon: '⊟' },
        { kind: 'gas-meter', label: 'Счётчик',         icon: '⊞' },
        { kind: 'burner',    label: 'Потребитель',     icon: '◆' },
      ] },
    ],
    inspectorTabs: ['general', 'gas', 'geometry'],
    note: 'Scaffold. Разводка — будущий инкремент.',
  },
];

const _byId = Object.freeze(
  Object.fromEntries(DISCIPLINE_CONTEXTS.map(c => [c.id, Object.freeze(c)])));

/** Контекст по id дисциплины (fallback — electrical, как serialization). */
export function getContext(id) {
  return _byId[id] || _byId.electrical;
}

/** Список контекстов: { onlyActive? } фильтр. */
export function listContexts({ onlyActive = false } = {}) {
  return DISCIPLINE_CONTEXTS.filter(c => !onlyActive || c.status === 'active');
}

/** true → контекст уже разведён в Конструктор (не scaffold). */
export function isContextActive(id) {
  const c = _byId[id];
  return !!c && c.status === 'active';
}

/** Электро-контекст использует текущую палитру Конструктора? */
export function usesCurrentPalette(id) {
  return getContext(id).palette === CURRENT_ELECTRICAL_PALETTE;
}

export const DEFAULT_CONTEXT = 'electrical';
