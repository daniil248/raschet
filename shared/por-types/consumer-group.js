// shared/por-types/consumer-group.js
// POR-type 'consumer-group' — агрегатор для электрика на принципиалке.
//
// Несколько физически отдельных POR-объектов с ИДЕНТИЧНЫМИ electrical-
// атрибутами показываются на схеме одним узлом «×N». В SCS / механике /
// layout каждый член остаётся отдельным.
//
// БИДИРЕКЦИОНАЛЬНОСТЬ — два режима существования группы:
//
//   1) С членами (composed): электрик выделил N уже существующих POR-
//      объектов (стойки, добавленные SCS-инженером) и объединил их.
//        electrical.members = [oid_1, oid_2, ..., oid_N]
//        electrical.count   = N
//
//   2) Анонимный (placeholder): электрик нарисовал на схеме ×N, члены
//      ещё не существуют как реальные POR-объекты. SCS-инженер позже
//      может «материализовать» отдельные слоты, превратив их в реальные
//      стойки (с собственным id, possibility наполнить contents и т.п.).
//        electrical.members = []   ← пока пустой
//        electrical.count   = N    ← но визуально на схеме «×N»
//
//   Промежуточный режим (partially materialized): часть слотов уже
//   материализована, часть ещё анонимна.
//        electrical.members.length < electrical.count
//
// АВТОРИТЕТ ПО АТРИБУТАМ: electrical-параметры на группе — authoritative.
// Все члены должны иметь идентичные electrical (см. groupElectricalKeys
// у их type-definition). При материализации новый член наследует
// electrical группы.

import { num, str, withDomains } from './_helpers.js';

export const CONSUMER_GROUP_TYPE = {
  id: 'consumer-group',
  label: 'Группа потребителей',
  icon: '⊞',
  category: 'aggregator',
  defaultDomains: ['electrical'],
  inspectorPanels: ['electrical'],

  /**
   * Factory. Поддерживает два режима:
   *   • opts.memberObjects = [obj, obj, …] → composed mode
   *   • opts.count + opts.demandKwPerUnit (+ остальные electrical) → anonymous mode
   *   • opts.memberType — какой тип будут иметь будущие материализованные
   *     члены (для UI показывает «Группа стоек ×N» вместо «Группа ×N»).
   */
  factory(opts) {
    const o = opts || {};
    const memberObjects = Array.isArray(o.memberObjects) ? o.memberObjects : [];

    // Composed mode — есть реальные члены.
    if (memberObjects.length > 0) {
      const first = memberObjects[0];
      const e = (first.domains && first.domains.electrical) || {};
      const memberType = first.type;
      const memberIds  = memberObjects.map(m => m.id);
      const perUnitKw  = num(e.demandKw, 0);
      return withDomains({
        type: 'consumer-group',
        subtype: memberType,
        tag:  str(o.tag),
        name: str(o.name, `Группа ${memberType} ×${memberObjects.length}`),
        views: {
          schematic: { symbol: 'consumer-group', countBadge: memberObjects.length },
        },
      }, {
        electrical: {
          members:         memberIds,
          count:           memberObjects.length,
          demandKwPerUnit: perUnitKw,
          demandKw:        perUnitKw * memberObjects.length,
          phases:          num(e.phases,   3),
          cosPhi:          num(e.cosPhi,   0.95),
          voltageV:        e.voltageV ?? null,
        },
      });
    }

    // Anonymous mode — count + per-unit, члены пока не существуют.
    const cnt = Math.max(2, num(o.count, 2));
    const perUnit = num(o.demandKwPerUnit, num(o.demandKw, 0));
    const memberType = str(o.memberType, 'consumer');
    return withDomains({
      type: 'consumer-group',
      subtype: memberType,
      tag:  str(o.tag),
      name: str(o.name, `Группа ${memberType} ×${cnt}`),
      views: {
        schematic: { symbol: 'consumer-group', countBadge: cnt },
      },
    }, {
      electrical: {
        members:         [],     // пока никого
        count:           cnt,
        demandKwPerUnit: perUnit,
        demandKw:        perUnit * cnt,
        phases:          num(o.phases,   3),
        cosPhi:          num(o.cosPhi,   0.95),
        voltageV:        o.voltageV ?? null,
      },
    });
  },
};

/**
 * Operations над consumer-group (вызываются из shared/por.js):
 *   - canGroupTogether(a, b, groupKeys?)
 *   - createGroupFromMembers(addObject, patchObject, pid, members, opts)
 *   - addMemberToGroup(...)
 *   - removeMemberFromGroup(...)
 *   - materializeGroupSlot(...) — превращает анонимный слот в реальный POR-объект
 */

const DEFAULT_KEYS = ['phases', 'cosPhi', 'demandKw', 'voltageV'];

export function canGroupTogether(a, b, groupKeys) {
  if (!a || !b) return { ok: false, reason: 'Нет объектов' };
  if (a.id === b.id) return { ok: false, reason: 'Один и тот же объект' };
  if (a.type !== b.type) return { ok: false, reason: `Разные типы: ${a.type} vs ${b.type}` };
  const keys = Array.isArray(groupKeys) && groupKeys.length ? groupKeys : DEFAULT_KEYS;
  const ae = (a.domains && a.domains.electrical) || {};
  const be = (b.domains && b.domains.electrical) || {};
  for (const k of keys) {
    const av = ae[k], bv = be[k];
    if (av == null && bv == null) continue;
    if (av !== bv) return { ok: false, reason: `Различие по ${k}: ${av} vs ${bv}` };
  }
  return { ok: true };
}

/**
 * Создать группу из существующих членов. Возвращает { ok, group?, reason? }.
 * `por` — объект API из shared/por.js: { addObject, patchObject }.
 */
export function createGroupFromMembers(por, pid, memberObjects, opts) {
  const arr = Array.isArray(memberObjects) ? memberObjects : [];
  if (arr.length < 2) return { ok: false, reason: 'Группа требует минимум 2 объекта' };

  // Получаем groupElectricalKeys из type-definition первого члена (если есть).
  const firstTypeDef = (opts && opts.typeDef) || null;
  const keys = firstTypeDef?.groupElectricalKeys || DEFAULT_KEYS;

  for (let i = 1; i < arr.length; i++) {
    const r = canGroupTogether(arr[0], arr[i], keys);
    if (!r.ok) return r;
  }
  for (const m of arr) {
    const gid = m && m.domains && m.domains.electrical && m.domains.electrical.groupId;
    if (gid) return { ok: false, reason: `Объект ${m.tag || m.id} уже в группе ${gid}` };
  }
  const partial = CONSUMER_GROUP_TYPE.factory({ memberObjects: arr, ...(opts || {}) });
  if (!partial) return { ok: false, reason: 'Не удалось построить заготовку группы' };
  const group = por.addObject(pid, partial);
  if (!group) return { ok: false, reason: 'addObject вернул null' };
  for (const m of arr) {
    por.patchObject(pid, m.id, { groupId: group.id }, { domain: 'electrical' });
  }
  return { ok: true, group };
}

export function addMemberToGroup(por, pid, groupId, memberObject, opts) {
  const group = por.getObject(pid, groupId);
  if (!group || group.type !== 'consumer-group') {
    return { ok: false, reason: 'Группа не найдена' };
  }
  const e = (group.domains && group.domains.electrical) || {};
  const members = Array.isArray(e.members) ? e.members : [];
  const count   = Math.max(members.length, num(e.count, 0));

  // Проверяем совместимость: либо с одним из существующих членов, либо
  // (если группа анонимная) с самой группой по её electrical-параметрам.
  const keys = opts?.groupElectricalKeys || DEFAULT_KEYS;
  if (members.length > 0) {
    const probe = por.getObject(pid, members[0]);
    if (!probe) return { ok: false, reason: 'Первый член группы не найден' };
    const r = canGroupTogether(probe, memberObject, keys);
    if (!r.ok) return r;
  } else {
    // Анонимная группа — сравниваем со «синтетическим» эталоном из e.
    const synthetic = { type: memberObject.type, domains: { electrical: e } };
    const r = canGroupTogether(synthetic, memberObject, keys);
    if (!r.ok) return r;
  }
  if (members.includes(memberObject.id)) return { ok: false, reason: 'Уже в группе' };

  const newMembers = [...members, memberObject.id];
  // Если в группе ещё были анонимные слоты — заполняем один из них (count
  // не меняется). Если все слоты уже заняты — count увеличивается.
  const newCount = Math.max(count, newMembers.length);
  const perUnit = num(e.demandKwPerUnit, 0);
  por.patchObject(pid, groupId, {
    members:  newMembers,
    count:    newCount,
    demandKw: perUnit * newCount,
  }, { domain: 'electrical' });
  por.patchObject(pid, memberObject.id, { groupId }, { domain: 'electrical' });
  return { ok: true };
}

export function removeMemberFromGroup(por, pid, groupId, memberId) {
  const group = por.getObject(pid, groupId);
  if (!group) return { ok: false, reason: 'Группа не найдена' };
  const e = (group.domains && group.domains.electrical) || {};
  const members = Array.isArray(e.members) ? e.members : [];
  const newMembers = members.filter(id => id !== memberId);
  por.patchObject(pid, memberId, { groupId: null }, { domain: 'electrical' });

  // Если в группе остаётся <2 ВСЕГО (членов + анонимных слотов) — распускаем.
  const total = Math.max(newMembers.length, num(e.count, 0));
  if (total < 2) {
    for (const id of newMembers) {
      por.patchObject(pid, id, { groupId: null }, { domain: 'electrical' });
    }
    por.removeObject(pid, groupId);
    return { ok: true, dissolved: true };
  }
  // Группа сохраняется. Решаем, уменьшать count или нет:
  //   - если был анонимный слот «свободный» (count > members.length) —
  //     удаление реального члена освобождает анонимный слот; count держим.
  //   - если все слоты были заняты реальными членами — count уменьшается на 1.
  const newCount = (members.length === num(e.count, 0))
    ? Math.max(2, num(e.count, 0) - 1)
    : num(e.count, 0);
  const perUnit = num(e.demandKwPerUnit, 0);
  por.patchObject(pid, groupId, {
    members:  newMembers,
    count:    newCount,
    demandKw: perUnit * newCount,
  }, { domain: 'electrical' });
  return { ok: true, dissolved: false };
}

/**
 * Материализовать один анонимный слот группы в реальный POR-объект.
 * Используется SCS-инженером, который хочет наполнить «один из ×N»
 * контентом — для этого нужен реальный POR-объект type='rack' (или
 * другой), который наследует electrical-параметры группы.
 *
 * `por` — объект API: { getObject, addObject, patchObject }.
 * `typeFactory` — factory из por-types/<memberType>.js (например, RACK_TYPE.factory).
 * Возвращает { ok, member?, group?, reason? }.
 */
export function materializeGroupSlot(por, pid, groupId, typeFactory, memberOpts) {
  const group = por.getObject(pid, groupId);
  if (!group || group.type !== 'consumer-group') {
    return { ok: false, reason: 'Группа не найдена' };
  }
  const e = (group.domains && group.domains.electrical) || {};
  const members = Array.isArray(e.members) ? e.members : [];
  const count   = num(e.count, 0);
  if (members.length >= count) {
    return { ok: false, reason: 'В группе нет анонимных слотов' };
  }
  if (typeof typeFactory !== 'function') {
    return { ok: false, reason: 'typeFactory required' };
  }
  // Inherited electrical-параметры из группы.
  const inherited = {
    demandKw: num(e.demandKwPerUnit, 0),
    cosPhi:   num(e.cosPhi,   0.95),
    phases:   num(e.phases,   3),
    voltageV: e.voltageV ?? null,
  };
  const partial = typeFactory({ ...(memberOpts || {}), ...inherited });
  if (!partial) return { ok: false, reason: 'typeFactory вернул null' };
  // Прописываем groupId сразу при создании.
  if (!partial.domains) partial.domains = {};
  if (!partial.domains.electrical) partial.domains.electrical = {};
  partial.domains.electrical.groupId = groupId;

  const member = por.addObject(pid, partial);
  if (!member) return { ok: false, reason: 'addObject вернул null' };

  const newMembers = [...members, member.id];
  por.patchObject(pid, groupId, { members: newMembers }, { domain: 'electrical' });
  // count не трогаем — слот был «забронирован» под этот член.
  return { ok: true, member, group: por.getObject(pid, groupId) };
}

/**
 * Материализовать ВСЕ анонимные слоты группы. Полная декомпозиция —
 * группа сохраняется, но все её count слотов теперь — реальные POR-
 * объекты с identity. SCS-инженер использует когда хочет наполнять
 * каждую стойку индивидуально.
 */
export function materializeAllSlots(por, pid, groupId, typeFactory, memberOptsArr) {
  const group = por.getObject(pid, groupId);
  if (!group || group.type !== 'consumer-group') {
    return { ok: false, reason: 'Группа не найдена' };
  }
  const e = (group.domains && group.domains.electrical) || {};
  const members = Array.isArray(e.members) ? e.members : [];
  const count   = num(e.count, 0);
  const slotsToFill = count - members.length;
  if (slotsToFill <= 0) return { ok: true, materialized: 0 };
  const out = [];
  for (let i = 0; i < slotsToFill; i++) {
    const opts = (Array.isArray(memberOptsArr) && memberOptsArr[i]) || {};
    const r = materializeGroupSlot(por, pid, groupId, typeFactory, opts);
    if (!r.ok) return { ok: false, reason: r.reason, materialized: out.length };
    out.push(r.member);
  }
  return { ok: true, materialized: out.length, members: out };
}
