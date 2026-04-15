"""
Scale a raschet project 5x by deep-cloning it 5 times with translated coordinates
and fully remapped node/conn IDs. Preserves all internal references
(linkedIndoor/Outdoor, triggerNodeId(s), triggerGroups.watchInputs.panelId,
switchPanelId, parentSectionedId, sectionIds, memberIds, channelIds, modes.overrides).

Usage: python scale5x.py <input.json> <output.json>
"""
import json
import sys
import copy
import re

def max_node_id(d):
    mx = 0
    for n in d['nodes']:
        m = re.match(r'n(\d+)$', n['id'])
        if m: mx = max(mx, int(m.group(1)))
    return mx

def max_conn_id(d):
    mx = 0
    for c in d['conns']:
        m = re.match(r'c(\d+)$', c.get('id', ''))
        if m: mx = max(mx, int(m.group(1)))
    return mx

def remap_node_id(old, offset):
    m = re.match(r'n(\d+)$', old)
    if not m: return old
    return 'n' + str(int(m.group(1)) + offset)

def remap_conn_id(old, offset):
    m = re.match(r'c(\d+)$', old)
    if not m: return old
    return 'c' + str(int(m.group(1)) + offset)

def shift_copy(d, n_off, c_off, x_off, y_off):
    """Return a deep-shifted copy of nodes+conns+modes."""
    nodes = copy.deepcopy(d['nodes'])
    conns = copy.deepcopy(d['conns'])
    modes = copy.deepcopy(d.get('modes', []))

    for n in nodes:
        n['id'] = remap_node_id(n['id'], n_off)
        if 'x' in n: n['x'] = n['x'] + x_off
        if 'y' in n: n['y'] = n['y'] + y_off
        # consumer linked pair
        if n.get('linkedOutdoorId'):
            n['linkedOutdoorId'] = remap_node_id(n['linkedOutdoorId'], n_off)
        if n.get('linkedIndoorId'):
            n['linkedIndoorId'] = remap_node_id(n['linkedIndoorId'], n_off)
        # generator refs
        if n.get('switchPanelId'):
            n['switchPanelId'] = remap_node_id(n['switchPanelId'], n_off)
        if n.get('triggerNodeId'):
            n['triggerNodeId'] = remap_node_id(n['triggerNodeId'], n_off)
        if isinstance(n.get('triggerNodeIds'), list):
            n['triggerNodeIds'] = [remap_node_id(x, n_off) for x in n['triggerNodeIds']]
        if isinstance(n.get('triggerGroups'), list):
            for g in n['triggerGroups']:
                for wi in g.get('watchInputs', []) or []:
                    if wi.get('panelId'):
                        wi['panelId'] = remap_node_id(wi['panelId'], n_off)
        # panel sectioning
        if n.get('parentSectionedId'):
            n['parentSectionedId'] = remap_node_id(n['parentSectionedId'], n_off)
        if isinstance(n.get('sectionIds'), list):
            n['sectionIds'] = [remap_node_id(x, n_off) for x in n['sectionIds']]
        # zone members
        if isinstance(n.get('memberIds'), list):
            n['memberIds'] = [remap_node_id(x, n_off) for x in n['memberIds']]
        # update tag with suffix to keep tags unique across copies
        # (tag is used for display only; uniqueness helps inspector/export)
        # note: only suffix when a suffix index is > 0 (handled by caller via x_off==0 marker)

    for c in conns:
        c['id'] = remap_conn_id(c['id'], c_off)
        if 'from' in c and c['from'].get('nodeId'):
            c['from']['nodeId'] = remap_node_id(c['from']['nodeId'], n_off)
        if 'to' in c and c['to'].get('nodeId'):
            c['to']['nodeId'] = remap_node_id(c['to']['nodeId'], n_off)
        if isinstance(c.get('channelIds'), list):
            c['channelIds'] = [remap_node_id(x, n_off) for x in c['channelIds']]
        # shift waypoints too
        if isinstance(c.get('waypoints'), list):
            for wp in c['waypoints']:
                if isinstance(wp, dict):
                    if 'x' in wp: wp['x'] = wp['x'] + x_off
                    if 'y' in wp: wp['y'] = wp['y'] + y_off

    # modes.overrides keyed by node id
    for m in modes:
        if isinstance(m.get('overrides'), dict):
            new_ov = {}
            for k, v in m['overrides'].items():
                new_ov[remap_node_id(k, n_off)] = v
            m['overrides'] = new_ov

    return nodes, conns, modes

def main():
    inp = sys.argv[1]
    out = sys.argv[2]
    d = json.load(open(inp, encoding='utf-8'))

    n_max = max_node_id(d)
    c_max = max_conn_id(d)
    # Safe stride above existing max
    n_stride = ((n_max // 1000) + 1) * 1000  # e.g. 1000 if max<1000
    c_stride = ((c_max // 1000) + 1) * 1000

    # Bounding box of the original — used for translation
    xs = [n['x'] for n in d['nodes'] if 'x' in n]
    ys = [n['y'] for n in d['nodes'] if 'y' in n]
    bb_w = max(xs) - min(xs)
    bb_h = max(ys) - min(ys)
    gap = 1500
    dx = bb_w + gap  # shift per horizontal step

    # Layout: 5 copies in a 3x2 grid (0,0) (1,0) (2,0) (0,1) (1,1)
    layout = [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1)]

    all_nodes = []
    all_conns = []
    all_modes = list(copy.deepcopy(d.get('modes', [])))  # keep original modes once

    # We will process copy index k=0..4.
    # For k=0: keep IDs intact (it's the original copy, no offset).
    # For k>=1: shift IDs and positions.
    for k, (gx, gy) in enumerate(layout):
        n_off = k * n_stride
        c_off = k * c_stride
        x_off = gx * dx
        y_off = gy * (bb_h + gap)

        if k == 0 and gx == 0 and gy == 0:
            # Original copy — no shifts
            all_nodes.extend(copy.deepcopy(d['nodes']))
            all_conns.extend(copy.deepcopy(d['conns']))
            # Tag prefix: leave as-is
            continue

        nodes_k, conns_k, modes_k = shift_copy(d, n_off, c_off, x_off, y_off)

        # Append suffix to tags/names to disambiguate copies
        suffix = f' #{k+1}'
        for n in nodes_k:
            if n.get('tag'):
                n['tag'] = n['tag'] + f'.{k+1}'
            if n.get('name'):
                n['name'] = n['name'] + suffix

        all_nodes.extend(nodes_k)
        all_conns.extend(conns_k)
        # modes from additional copies are merged into the main modes (additional overrides)
        for m in modes_k:
            # prefix mode id to avoid collisions
            m_old = m.get('id', '')
            m['id'] = m_old + f'_k{k+1}'
            m['name'] = (m.get('name', '') + suffix).strip()
            all_modes.append(m)

    d2 = {
        'version': d.get('version', 3),
        'nextId': (len(layout) * n_stride) + 1,
        'nodes': all_nodes,
        'conns': all_conns,
        'modes': all_modes,
        'activeModeId': d.get('activeModeId'),
        'view': d.get('view'),
        'globalSettings': d.get('globalSettings'),
    }

    # Preserve any other top-level keys
    for k in d:
        if k not in d2:
            d2[k] = d[k]

    json.dump(d2, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'Written {out}')
    print(f'nodes: {len(all_nodes)}  conns: {len(all_conns)}  modes: {len(all_modes)}')

if __name__ == '__main__':
    main()
