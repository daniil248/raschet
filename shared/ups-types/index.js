// ======================================================================
// shared/ups-types/index.js
// Реестр типов ИБП (плагины). Чтобы добавить новый тип:
//   1) Создайте shared/ups-types/<your-type>.js, экспортирующий descriptor
//      (см. интерфейс ниже / примеры monoblock.js, modular.js, integrated.js)
//   2) Добавьте импорт сюда и положите в массив ALL_TYPES
//   3) Всё. Тип появится:
//      • в выпадающем списке «Тип» формы ручного ввода
//      • в фильтре wizard'а «Тип»
//      • в карточке деталей и таблице справочника
//      • в подборе и summary
// ======================================================================
//
// Интерфейс UpsTypeDescriptor:
//   id            : string                    — уникальный ключ
//   label         : string                    — текст в dropdown
//   shortLabel    : string                    — «ИБП (моноблок)» для таблицы
//   icon          : string                    — эмодзи в таблице
//   order         : number                    — порядок в UI
//   matches(u)    : boolean                   — определяет тип записи
//   defaults()    : object                    — поля для новой записи
//   formFieldsHtml(src) : string              — доп. поля формы
//   readForm(getField, root) : object         — патч записи из формы
//   detailRowsHtml(u) : string                — строки карточки деталей
//   metaLabel(u)  : string                    — короткая meta в suitable-list
//   pickFit(rq, u, parseRedundancy) : fitInfo|null
//   fitDescription(u, fi) : string            — описание подбора
//   buildComposition(u, fi) : array           — composition для BOM
//   summaryRowsHtml(u, fi) : string           — строки в шаге 3 wizard'а
// ======================================================================

import { monoblockType  } from './monoblock.js';
import { modularType    } from './modular.js';
import { integratedType } from './integrated.js';

const ALL_TYPES = [monoblockType, modularType, integratedType];

// Стабильно отсортированный массив.
export function listUpsTypes() {
  return ALL_TYPES.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

// По id.
export function getUpsType(id) {
  return ALL_TYPES.find(t => t.id === id) || null;
}

// Распознать тип по записи каталога. Возвращает первый совпавший (по order).
export function detectUpsType(u) {
  if (!u) return null;
  for (const t of listUpsTypes()) {
    try { if (t.matches(u)) return t; } catch {}
  }
  return null;
}

// Удобный фолбэк, если тип неизвестен (старые записи без kind/upsType).
export function getUpsTypeOrFallback(u) {
  return detectUpsType(u) || monoblockType;
}
