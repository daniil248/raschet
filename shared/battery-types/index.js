// ======================================================================
// shared/battery-types/index.js
// v0.59.426
// Реестр ТИПОВ АКБ (плагины). Чтобы добавить новый тип АКБ (например,
// Pylon UP5000, Huawei LUNA, BYD B-Box и т.п.) — создайте файл
// shared/battery-types/<id>.js с descriptor'ом и положите его в
// массив ALL_TYPES ниже. Это всё: тип получит автоматический picker,
// автосборку шкафов, master/slave-логику, BOM-генерацию.
//
// Архитектура зеркалит shared/ups-types/.
//
// ИНТЕРФЕЙС BatteryTypeDescriptor:
//   id            : string  — уникальный ключ ('vrla', 's3-li-ion', …)
//   label         : string  — текст в dropdown
//   icon          : string  — эмодзи
//   order         : number  — порядок в UI
//
//   matches(b)        : boolean
//        Определяет, относится ли запись каталога к этому типу.
//
//   isSelectable(b)   : boolean
//        true для записей, которые можно ВЫБРАТЬ как «модель» в picker'е
//        (модули и обычные АКБ). Шкафы и аксессуары → false.
//
//   listSelectable(catalog) : Array<entry>
//        Дефолт = catalog.filter(b => matches(b) && isSelectable(b)).
//        Можно переопределить для кастомной сортировки/группировки.
//
//   buildSystem({module, totalModules, options}) : SystemSpec
//        Главная функция автосборки. По числу модулей и опциям возвращает:
//        {
//          cabinets: [
//            { role: 'master'|'slave'|'combiner',
//              model: 'S3C040-6C-20-M',
//              modules: <int>,         // сколько модулей в этом шкафу
//              variant: '-M'|'-S'|...,
//            }
//          ],
//          accessories: [               // optional
//            { id, qty, role: 'wire-kit'|'networking-device'|'blank-panel' }
//          ],
//          modulesPerCabinet, cabinetsCount, totalModules,
//          warnings: [string],          // пользовательские предупреждения
//        }
//
//   compute(args) : ComputedConfig
//        Расчёт автономии/мощности/Vdc. Для S³ оборачивает существующий
//        computeS3Configuration(). Для VRLA — обычный per-block расчёт.
//
//   validateMaxCRate({module, loadKw, totalModules, vdcOper, invEff}) : {ok, reason}
//        Проверка что нагрузка в пределах max C-rate (для S³).
//
//   bomLines(systemSpec, opts) : Array<bomLine>
//        Дополнительные строки BOM (шкафы, аксессуары, провода).
// ======================================================================

import { vrlaType  } from './vrla.js';
import { s3LiIonType } from './s3-li-ion.js';

const ALL_TYPES = [vrlaType, s3LiIonType];

export function listBatteryTypes() {
  return ALL_TYPES.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getBatteryType(id) {
  return ALL_TYPES.find(t => t.id === id) || null;
}

// Распознать тип по записи каталога. S³-модуль определяется ДО vrla
// (vrlaType возвращает true для всего, что не S³, как fallback), поэтому
// порядок матчинга = порядок order (s3-li-ion: 10, vrla: 100 — fallback).
export function detectBatteryType(b) {
  if (!b) return null;
  for (const t of listBatteryTypes()) {
    try { if (t.matches(b)) return t; } catch {}
  }
  return null;
}

export function getBatteryTypeOrFallback(b) {
  return detectBatteryType(b) || vrlaType;
}
