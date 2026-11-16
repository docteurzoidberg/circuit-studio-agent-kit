"""`part inspect`: the facts a skill needs to write a part spec — tree, colours, sizes and candidate contacts.

Nothing is guessed: contacts are candidates (cylinders and thin posts), grouped into regular rows when they line
up, so the skill can propose pin positions and the user can confirm them.
"""
from collections import defaultdict

import cadquery as cq

AXES = 'xyz'
VOLUME_BUCKETS = (0.1, 1.0, 10.0, 100.0)  # mm³ thresholds, to choose `simplify.minVolume`
CYLINDER_RADIUS = (0.3, 2.5)  # mm: pins, screws, wire holes
POST_THICKNESS = 1.2  # mm: header pins and leads are at most this thick
ROW_TOLERANCE = 0.05  # mm: spacing difference still counted as one row
MAX_TREE = 40
# A model is complex (worth offering a simplification) beyond either threshold. Calibrated on the Claudemètre
# parts: an adapter board (888 solids) and a display module (18 812 faces) are complex; a meter, a socket and a
# fuse holder (at most 12 solids, 641 faces) are simple.
COMPLEX_SOLIDS = 100
COMPLEX_FACES = 5000


def r(v, digits=3):
    return round(v, digits) + 0.0


def bounds(shape):
    b = shape.BoundingBox()
    return {'min': [r(b.xmin), r(b.ymin), r(b.zmin)], 'max': [r(b.xmax), r(b.ymax), r(b.zmax)],
            'size': [r(b.xlen), r(b.ylen), r(b.zlen)]}


def principal_axis(direction):
    """Index of the axis a unit vector runs along, or None when it is oblique."""
    for i, c in enumerate(direction):
        if abs(abs(c) - 1) < 1e-3:
            return i
    return None


def cylinder_candidates(solids):
    """Cylindrical faces along a principal axis, one per axis line and radius, with their extent on the axis."""
    found = {}
    for solid in solids:
        for face in solid.shape.Faces():
            if face.geomType() != 'CYLINDER':
                continue
            cyl = face._geomAdaptor().Cylinder()
            radius = cyl.Radius()
            if not CYLINDER_RADIUS[0] <= radius <= CYLINDER_RADIUS[1]:
                continue
            d = cyl.Axis().Direction()
            axis = principal_axis((d.X(), d.Y(), d.Z()))
            if axis is None:
                continue
            loc = cyl.Location()
            point = [loc.X(), loc.Y(), loc.Z()]
            b = face.BoundingBox()
            lo, hi = (b.xmin, b.ymin, b.zmin)[axis], (b.xmax, b.ymax, b.zmax)[axis]
            key = (axis, r(radius, 2)) + tuple(r(point[i], 1) for i in range(3) if i != axis)
            prev = found.get(key)
            if prev:
                prev['span'] = [min(prev['span'][0], lo), max(prev['span'][1], hi)]
            else:
                found[key] = {'kind': 'cylinder', 'axis': AXES[axis], 'size': r(radius * 2, 2), 'point': point,
                              'span': [lo, hi], 'part': ' / '.join(n for n in solid.path[1:] if n)}
    out = []
    for c in found.values():
        axis = AXES.index(c['axis'])
        c['point'][axis] = c['span'][1]  # report the end with the highest coordinate on the axis
        out.append({**c, 'point': [r(v) for v in c['point']], 'span': [r(v) for v in c['span']]})
    return out


def post_candidates(solids):
    """Thin solids (header pins, leads): two small dimensions, one long; reported at both ends."""
    out = []
    for solid in solids:
        b = solid.shape.BoundingBox()
        size = [b.xlen, b.ylen, b.zlen]
        order = sorted(range(3), key=lambda i: size[i])
        thin, long_ = order[:2], order[2]
        if max(size[i] for i in thin) > POST_THICKNESS or size[long_] < 2 * size[order[1]]:
            continue
        centre = [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2]
        lo, hi = (b.xmin, b.ymin, b.zmin)[long_], (b.xmax, b.ymax, b.zmax)[long_]
        point = list(centre)
        point[long_] = hi
        out.append({'kind': 'post', 'axis': AXES[long_], 'size': r(max(size[i] for i in thin), 2),
                    'point': [r(v) for v in point], 'span': [r(lo), r(hi)],
                    'part': ' / '.join(n for n in solid.path[1:] if n)})
    return out


def find_rows(candidates):
    """Group candidates of the same kind, axis and size that line up with a regular spacing.

    A row is reported as start point, step vector and count, the shape `part.yaml` uses to generate pins.
    """
    rows, used = [], set()
    groups = defaultdict(list)
    for i, c in enumerate(candidates):
        groups[(c['kind'], c['axis'], c['size'])].append(i)
    for (kind, axis, size), members in groups.items():
        for direction in range(3):
            lines = defaultdict(list)
            for i in members:
                if i in used:
                    continue
                p = candidates[i]['point']
                lines[tuple(r(p[k], 1) for k in range(3) if k != direction)].append(i)
            for line in lines.values():
                if len(line) < 3:
                    continue
                line.sort(key=lambda i: candidates[i]['point'][direction])
                coords = [candidates[i]['point'][direction] for i in line]
                gaps = [b - a for a, b in zip(coords, coords[1:])]
                pitch = sum(gaps) / len(gaps)
                if pitch <= 0 or max(abs(g - pitch) for g in gaps) > ROW_TOLERANCE:
                    continue
                step = [0.0, 0.0, 0.0]
                step[direction] = r(pitch)
                rows.append({'kind': kind, 'axis': axis, 'size': size, 'count': len(line),
                             'start': candidates[line[0]]['point'], 'step': step,
                             'end': candidates[line[-1]]['point'], 'part': candidates[line[0]]['part']})
                used.update(line)
    singles = [c for i, c in enumerate(candidates) if i not in used]
    return merge_rows(rows), singles


def merge_rows(rows):
    """One row per line of contacts: rows on the same line, pitch and count (a screw, its hole, its thread at
    several radii or heights) are merged, keeping every size and the highest point."""
    merged = []

    def same_line(a, b):
        axis = AXES.index(a['axis'])
        return (a['axis'] == b['axis'] and a['count'] == b['count']
                and all(abs(x - y) <= ROW_TOLERANCE for x, y in zip(a['step'], b['step']))
                and all(abs(a['start'][k] - b['start'][k]) <= 0.1 for k in range(3) if k != axis))

    for w in rows:
        axis = AXES.index(w['axis'])
        m = next((m for m in merged if same_line(m, w)), None)
        if not m:
            merged.append({**w, 'sizes': [w['size']], 'kinds': [w['kind']], 'parts': [w['part']]})
            continue
        m['sizes'] = sorted(set(m['sizes'] + [w['size']]))
        m['kinds'] = sorted(set(m['kinds'] + [w['kind']]))
        m['parts'] = sorted(set(m['parts'] + [w['part']]))
        if w['start'][axis] > m['start'][axis]:
            m['start'], m['end'] = w['start'], w['end']
    out = []
    for m in merged:
        m['size'], m['kind'], m['part'] = max(m['sizes']), '+'.join(m['kinds']), m['parts'][0]
        out.append(m)
    return sorted(out, key=lambda m: (-m['count'], m['start']))


def tree_summary(solids):
    """Solid count and bounds per assembly path (up to three levels below the root)."""
    groups = defaultdict(list)
    for s in solids:
        names = [n for n in s.path[1:4] if n] or ['(root)']
        for depth in range(1, len(names) + 1):
            groups[' / '.join(names[:depth])].append(s)
    out = []
    for name, members in sorted(groups.items())[:MAX_TREE]:
        b = bounds(cq.Compound.makeCompound([m.shape for m in members]))
        out.append({'path': name, 'solids': len(members), 'size': b['size'], 'min': b['min']})
    return out, len(groups)


def inspect(model):
    """Facts about a read STEP model, as a JSON-ready dict."""
    solids = model.solids
    colours = defaultdict(int)
    for s in solids:
        colours[s.colour or 'none'] += 1
    volumes = [s.shape.Volume() for s in solids]
    buckets = {f'<{t:g}': sum(1 for v in volumes if v < t) for t in VOLUME_BUCKETS}
    tree, tree_total = tree_summary(solids)
    faces = sum(len(s.shape.Faces()) for s in solids)
    reasons = ([f'{len(solids)} solids > {COMPLEX_SOLIDS}'] if len(solids) > COMPLEX_SOLIDS else []) + \
              ([f'{faces} faces > {COMPLEX_FACES}'] if faces > COMPLEX_FACES else [])
    candidates = cylinder_candidates(solids) + post_candidates(solids)
    rows, singles = find_rows(candidates)
    return {
        'file': model.path.name,
        'bounds': bounds(model.compound),
        'solids': len(solids),
        'complexity': {'faces': faces, 'verdict': 'complex' if reasons else 'simple', 'reasons': reasons},
        'volumes': {'total': r(sum(volumes), 1), 'smallestSolidsBelow': buckets},
        'colours': {'distinct': len([c for c in colours if c != 'none']),
                    'bySolid': dict(sorted(colours.items(), key=lambda kv: -kv[1])),
                    'faceColours': model.face_colours},
        'tree': tree, 'treeEntries': tree_total,
        'contacts': {'rows': rows, 'singles': singles[:60], 'singlesTotal': len(singles)},
    }


def format_text(facts):
    """Human-readable summary of `inspect()`."""
    b = facts['bounds']
    lines = [f"{facts['file']}: {facts['solids']} solids, size {b['size'][0]} x {b['size'][1]} x {b['size'][2]} mm",
             f"  bounds min {b['min']} max {b['max']}",
             f"  complexity: {facts['complexity']['verdict']} ({facts['complexity']['faces']} faces"
             + (f"; {', '.join(facts['complexity']['reasons'])}" if facts['complexity']['reasons'] else '') + ')',
             f"  small solids: " + ', '.join(f"{n} {k} mm³" for k, n in facts['volumes']['smallestSolidsBelow'].items())]
    c = facts['colours']
    lines.append(f"  colours: {c['distinct']} distinct, faces with their own colour: {c['faceColours']}")
    lines += [f"    {colour}: {n} solids" for colour, n in list(c['bySolid'].items())[:12]]
    if c['distinct'] <= 1:
        lines.append('    (one colour or none: colour rules will be needed)')
    lines.append(f"  tree ({facts['treeEntries']} entries, first {len(facts['tree'])}):")
    lines += [f"    {t['path']}: {t['solids']} solids, size {t['size']}" for t in facts['tree']]
    rows = facts['contacts']['rows']
    lines.append(f"  contact rows: {len(rows)}")
    lines += [f"    {w['count']} x {w['kind']} ({w['axis']}, {'/'.join(str(s) for s in w['sizes'])} mm)"
              f" from {w['start']} step {w['step']} in {' | '.join(p or '(root)' for p in w['parts'])}" for w in rows]
    lines.append(f"  single contact candidates: {facts['contacts']['singlesTotal']}")
    lines += [f"    {s['kind']} ({s['axis']}, {s['size']} mm) at {s['point']} in {s['part'] or '(root)'}"
              for s in facts['contacts']['singles'][:20]]
    return '\n'.join(lines)
