"""
Expand a raschet project ~5x in complexity by adding downstream layers:
- For each existing panel with free output ports, attach new sub-panels
  (floor/section distribution boards).
- Each new sub-panel gets a set of new consumers on its outputs.
- Adds extra zones grouping the new branches.
- Preserves the entire original project intact; only appends nodes/conns/zones.

Output target: ~605 nodes, ~670 conns (5x of 121/134).

Usage: python expand5x.py <input.json> <output.json>
"""
import json
import sys
import copy
import re
import random

random.seed(42)  # deterministic

NODE_H = 120
GRID = 40

# Cable template (matches defaults used in the existing project)
CABLE_TPL = {
    'installMethod': 'E',
    'material': 'Cu',
    'lengthM': 10,
    'ambientC': 30,
    'grouping': 1,
    'bundling': 'touching',
    'insulation': 'PVC',
}

def panel_used_outputs(conns_from_map, panel_id):
    """Return set of output port indices already used by outgoing cables."""
    return {c['from']['port'] for c in conns_from_map.get(panel_id, [])}

def next_free_nid(nid_counter):
    nid_counter[0] += 1
    return 'n' + str(nid_counter[0])

def next_free_cid(cid_counter):
    cid_counter[0] += 1
    return 'c' + str(cid_counter[0])

def make_subpanel(nid, tag, name, x, y, inputs=1, outputs=6, capacityA=160):
    return {
        'type': 'panel',
        'id': nid,
        'tag': tag,
        'name': name,
        'x': x, 'y': y,
        'inputs': inputs,
        'outputs': outputs,
        'capacityA': capacityA,
        'switchMode': 'auto',
        'kSim': 0.8,
        'marginMinPct': 2,
        'marginMaxPct': 30,
        'priorities': [1] * inputs,
        'parallelEnabled': [False] * inputs,
        'manualActiveInput': 0,
        'avrDelaySec': 2,
        'avrInterlockSec': 1,
        'inputBreakerStates': None,
    }

def make_consumer(nid, tag, name, x, y, demandKw, subtype='socket', cnt=1):
    return {
        'type': 'consumer',
        'id': nid,
        'tag': tag,
        'name': name,
        'x': x, 'y': y,
        'inputs': 1,
        'outputs': 1,
        'demandKw': demandKw,
        'cosPhi': 0.92,
        'kUse': 0.8,
        'phase': '3ph',
        'voltage': 400,
        'voltageLevelIdx': 0,
        'priorities': [1],
        'count': cnt,
        'consumerSubtype': subtype,
        'inputSide': 'top',
        'inrushFactor': 1,
    }

def make_zone(nid, tag, name, x, y, w, h, member_ids, color='#fff3e0', prefix='EX'):
    return {
        'type': 'zone',
        'id': nid,
        'tag': tag,
        'name': name,
        'x': x, 'y': y,
        'width': w,
        'height': h,
        'memberIds': list(member_ids),
        'color': color,
        'zonePrefix': prefix,
        'inputs': 0,
        'outputs': 0,
    }

def make_cable(cid, from_id, from_port, to_id, to_port, lengthM=10):
    c = {
        'id': cid,
        'from': {'nodeId': from_id, 'port': from_port},
        'to':   {'nodeId': to_id,   'port': to_port},
    }
    c.update(CABLE_TPL)
    c['lengthM'] = lengthM
    return c

def main():
    inp = sys.argv[1]
    out = sys.argv[2]
    d = json.load(open(inp, encoding='utf-8'))

    nodes = d['nodes']
    conns = d['conns']
    modes = d.get('modes', [])

    # Figure out highest existing n/c numeric id
    n_max = 0
    for n in nodes:
        m = re.match(r'n(\d+)$', n['id'])
        if m: n_max = max(n_max, int(m.group(1)))
    c_max = 0
    for c in conns:
        m = re.match(r'c(\d+)$', c.get('id', ''))
        if m: c_max = max(c_max, int(m.group(1)))

    nid_counter = [n_max]
    cid_counter = [c_max]

    # Build outgoing map — UPDATED as we add new conns
    outgoing = {}
    for c in conns:
        fn = c['from']['nodeId']
        outgoing.setdefault(fn, []).append(c)

    all_nodes_by_id = {n['id']: n for n in nodes}

    def has_free_port(panel):
        outs = int(panel.get('outputs', 0) or 0)
        used = len(outgoing.get(panel['id'], []))
        return used < outs

    def next_free_port(panel_id, outs):
        used = {c['from']['port'] for c in outgoing.get(panel_id, [])}
        for i in range(outs):
            if i not in used:
                return i
        return None

    # Original panels from the input project — these are our roots for expansion
    original_panels = [n for n in nodes if n.get('type') == 'panel']
    original_panels.sort(key=lambda n: (n.get('y', 0), n.get('x', 0)))

    # Determine target: 5x original counts
    target_nodes = 5 * len(nodes)
    target_conns = 5 * len(conns)

    new_nodes = []
    new_conns = []
    new_zone_members_per_parent = {}

    def add_conn(from_id, from_port, to_id, to_port, lengthM=10):
        cid = next_free_cid(cid_counter)
        c = make_cable(cid, from_id, from_port, to_id, to_port, lengthM=lengthM)
        new_conns.append(c)
        outgoing.setdefault(from_id, []).append(c)
        return c

    SUBTYPES = [
        ('socket',      4.0, 'Розеточная группа'),
        ('lighting',    2.5, 'Освещение'),
        ('socket',      3.5, 'Розетки рабочих мест'),
        ('conditioner', 6.0, 'Кондиционер'),
        ('lighting',    1.8, 'Аварийный свет'),
        ('socket',      5.0, 'Серверные розетки'),
    ]

    def add_subpanel_with_loads(parent_panel, depth, root_parent_id):
        """Attach one new sub-panel on the next free port of parent_panel.
        Fill N-2 of its outputs with consumers (leave 2 free for deeper growth).
        Returns the sub-panel dict, or None if parent has no free port."""
        pid = parent_panel['id']
        p_outs = int(parent_panel.get('outputs', 0) or 0)
        port = next_free_port(pid, p_outs)
        if port is None:
            return None
        sp_id = next_free_nid(nid_counter)
        sp_outs = 6 if depth == 0 else 5
        # Tag & placement
        existing_children = sum(1 for c in outgoing.get(pid, [])
                                 if all_nodes_by_id.get(c['to']['nodeId'], {}).get('type') == 'panel'
                                 or any(nn['id'] == c['to']['nodeId'] and nn.get('type') == 'panel' for nn in new_nodes))
        sp_tag = (parent_panel.get('tag') or 'P') + f'-S{port+1}'
        sp_name = f'Субщит L{depth+1}/{port+1} от {parent_panel.get("name") or parent_panel.get("tag") or pid}'
        base_x = parent_panel.get('x', 0)
        base_y = parent_panel.get('y', 0) + 340 + depth * 40
        sp_x = round((base_x + (port - p_outs/2) * 280) / GRID) * GRID
        sp_y = round(base_y / GRID) * GRID
        subpanel = make_subpanel(sp_id, sp_tag, sp_name, sp_x, sp_y,
                                 inputs=1, outputs=sp_outs,
                                 capacityA=160 if depth == 0 else 100)
        new_nodes.append(subpanel)
        all_nodes_by_id[sp_id] = subpanel
        new_zone_members_per_parent.setdefault(root_parent_id, []).append(sp_id)
        add_conn(pid, port, sp_id, 0, lengthM=15 - depth)

        # Fill outputs with consumers, leaving last 2 free for deeper growth
        fill = max(1, sp_outs - 2)
        for j in range(fill):
            if len(nodes) + len(new_nodes) >= target_nodes:
                return subpanel
            sub, kw, cn_name = SUBTYPES[(j + depth) % len(SUBTYPES)]
            cn_id = next_free_nid(nid_counter)
            cn_tag = sp_tag + f'-L{j+1}'
            cn_x = round((sp_x + (j - (fill - 1) / 2) * 240) / GRID) * GRID
            cn_y = round((sp_y + 320) / GRID) * GRID
            cons = make_consumer(cn_id, cn_tag, cn_name, cn_x, cn_y,
                                 demandKw=kw, subtype=sub, cnt=1)
            new_nodes.append(cons)
            all_nodes_by_id[cn_id] = cons
            new_zone_members_per_parent[root_parent_id].append(cn_id)
            add_conn(sp_id, j, cn_id, 0, lengthM=8)
        return subpanel

    # Iterative growth: BFS from original panels
    # Each round, for every panel with free output, attach one sub-panel+loads
    # Also add sub-panels under previously-added sub-panels in subsequent rounds.
    growth_queue = [(p, 0, p['id']) for p in original_panels]  # (panel, depth, root_parent_id)

    while growth_queue and len(nodes) + len(new_nodes) < target_nodes:
        next_round = []
        for panel, depth, root_pid in growth_queue:
            if len(nodes) + len(new_nodes) >= target_nodes:
                break
            if not has_free_port(panel):
                continue
            sp = add_subpanel_with_loads(panel, depth, root_pid)
            if sp is not None:
                # The parent still might have more free ports — re-queue it
                if has_free_port(panel):
                    next_round.append((panel, depth, root_pid))
                # The new sub-panel becomes a future growth point at depth+1
                if depth < 3:  # cap depth
                    next_round.append((sp, depth + 1, root_pid))
        growth_queue = next_round

    # Build zones grouping new branches per-parent panel
    for parent_id, members in new_zone_members_per_parent.items():
        parent = next((n for n in nodes if n['id'] == parent_id), None)
        if not parent:
            continue
        # Bounding box of members
        member_nodes = [n for n in new_nodes if n['id'] in members]
        if not member_nodes:
            continue
        xs = [n['x'] for n in member_nodes]
        ys = [n['y'] for n in member_nodes]
        pad_x = 100
        pad_y = 100
        zx = min(xs) - pad_x
        zy = min(ys) - pad_y
        zw = (max(xs) - min(xs)) + 260 + 2 * pad_x
        zh = (max(ys) - min(ys)) + NODE_H + 2 * pad_y
        # Snap to grid
        zx = round(zx / GRID) * GRID
        zy = round(zy / GRID) * GRID
        zw = round(zw / GRID) * GRID
        zh = round(zh / GRID) * GRID
        z_id = next_free_nid(nid_counter)
        z_tag = 'Z-' + (parent.get('tag') or parent_id)
        z_name = 'Ветвь от ' + (parent.get('name') or parent.get('tag') or parent_id)
        zone = make_zone(z_id, z_tag, z_name, zx, zy, zw, zh, members,
                         color='#fff8e1', prefix='EX')
        new_nodes.append(zone)

    # Merge
    d2 = copy.deepcopy(d)
    d2['nodes'] = nodes + new_nodes
    d2['conns'] = conns + new_conns
    d2['nextId'] = max(nid_counter[0], cid_counter[0]) + 1

    json.dump(d2, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    types = {}
    for n in d2['nodes']:
        t = n.get('type')
        types[t] = types.get(t, 0) + 1
    print(f'Written {out}')
    print(f'nodes: {len(d2["nodes"])} (was {len(nodes)})  conns: {len(d2["conns"])} (was {len(conns)})')
    print(f'types: {types}')

if __name__ == '__main__':
    main()
