"""`part convert`: STEP + part spec → Circuit Studio part (.c3dcomponent), deterministic, nothing guessed.

The GLB keeps the STEP coordinates (mm, Z up). The part tells Circuit Studio how to place it: `modelCenter`
(bounding-box centre of the GLB), `modelOrientation` (Euler XYZ, radians) and `dimensions` measured on the GLB
after rotation. Pin positions and exit directions are expressed in that centred, rotated frame.
"""
import base64
import hashlib
import json
import math
import struct
import tempfile
from collections import defaultdict
from pathlib import Path

import cadquery as cq
from cadquery.occ_impl.assembly import toCAF
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem
from OCP.TCollection import TCollection_AsciiString
from OCP.TColStd import TColStd_IndexedDataMapOfStringString

from .step_io import read_step

DEFAULT_GREY = '#808080'


def rotate(v, euler):
    """Apply a three.js 'XYZ' Euler rotation (R = Rx * Ry * Rz) to a vector (radians)."""
    x, y, z = v
    ax, ay, az = euler
    x, y = x * math.cos(az) - y * math.sin(az), x * math.sin(az) + y * math.cos(az)
    x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
    y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
    return [round(c, 4) + 0.0 for c in (x, y, z)]


def srgb_to_linear(hex_colour):
    def channel(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return [channel(int(hex_colour[k:k + 2], 16) / 255) for k in (1, 3, 5)]


def solid_colour(spec, solid):
    """Colour of a solid: the spec's rules when it has some, else the STEP colour, else the default."""
    if spec.rules or spec.default_colour:
        b = solid.shape.BoundingBox()
        largest = max(b.xlen, b.ylen, b.zlen)
        path = ' / '.join(solid.path[1:])  # without the root, which every solid shares
        for rule in spec.rules:
            if rule.match not in path:
                continue
            if rule.largest_over is not None and not largest > rule.largest_over:
                continue
            if rule.largest_under is not None and not largest < rule.largest_under:
                continue
            return rule.colour
        return spec.default_colour or solid.colour or DEFAULT_GREY
    return solid.colour or DEFAULT_GREY


def side_of(direction):
    """Circuit Studio pin side from the exit direction in the part frame."""
    x, y, _ = direction
    if abs(x) >= abs(y) and abs(x) > 1e-6:
        return 'right' if x > 0 else 'left'
    return 'bottom' if y < 0 else 'top'


def write_glb(shapes_doc, shapes, out, linear, angular):
    for s in shapes:
        BRepMesh_IncrementalMesh(s.wrapped, linear, False, angular, True).Perform()
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(out)), True)
    conv = writer.ChangeCoordinateSystemConverter()
    conv.SetInputLengthUnit(0.001)
    conv.SetOutputLengthUnit(0.001)  # keep millimetres
    conv.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    conv.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)  # keep STEP axes
    if not writer.Perform(shapes_doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange()):
        raise RuntimeError(f'{out}: GLB export failed')


def glb_stats(data):
    """Mesh, material and triangle counts read from the GLB JSON chunk."""
    length = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + length])
    triangles = sum(gltf['accessors'][p['indices']]['count'] // 3
                    for m in gltf.get('meshes', []) for p in m['primitives'] if 'indices' in p)
    return {'meshCount': len(gltf.get('meshes', [])), 'materialCount': len(gltf.get('materials', [])),
            'triangleCount': triangles}


def _node_matrix(node):
    """Matrix of a glTF node (4 x 4, column-major): its `matrix`, or translation x rotation x scale."""
    if 'matrix' in node:
        return node['matrix']
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = node.get('scale', [1, 1, 1])
    tx, ty, tz = node.get('translation', [0, 0, 0])
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
            2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
            2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
            tx, ty, tz, 1]


def _multiply(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def glb_corners(glb):
    """Corners of every mesh primitive's box (POSITION min/max), placed by the node transforms.

    Circuit Studio measures a part this way (three.js Box3.setFromObject) and rejects a calibrated part whose size
    differs from its `dimensions` by more than 0.15 mm; boxes of the exact geometry are larger than the mesh on
    curved faces, so the part is measured on what is written.
    """
    length = struct.unpack_from('<I', glb, 12)[0]
    gltf = json.loads(glb[20:20 + length])
    corners = []

    def visit(index, parent):
        node = gltf['nodes'][index]
        world = _multiply(parent, _node_matrix(node))
        for primitive in gltf['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []:
            accessor = gltf['accessors'][primitive['attributes']['POSITION']]
            lo, hi = accessor['min'], accessor['max']
            for x in (lo[0], hi[0]):
                for y in (lo[1], hi[1]):
                    for z in (lo[2], hi[2]):
                        corners.append([world[r] * x + world[4 + r] * y + world[8 + r] * z + world[12 + r]
                                        for r in range(3)])
        for child in node.get('children', []):
            visit(child, world)

    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        visit(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    return corners


def convert(spec):
    """Run the pipeline; return (part dict as in LibraryPartSchema, report dict, kept solids with colours)."""
    model = read_step(spec.step)
    kept = [s for s in model.solids if spec.min_volume <= 0 or s.shape.Volume() >= spec.min_volume]
    if not kept:
        raise RuntimeError(f'simplify.minVolume {spec.min_volume} removes every solid')
    coloured = [(s, solid_colour(spec, s)) for s in kept]

    assy = cq.Assembly(name=spec.id)
    if spec.merge_by_colour:
        groups = defaultdict(list)
        for s, c in coloured:
            groups[c].append(s.shape)
        for i, (c, shapes) in enumerate(sorted(groups.items())):
            assy.add(cq.Compound.makeCompound(shapes), name=f'body{i + 1}', color=cq.Color(*srgb_to_linear(c)))
    else:
        for i, (s, c) in enumerate(coloured):
            assy.add(s.shape, name=f'solid{i + 1}', color=cq.Color(*srgb_to_linear(c)))
    _, doc = toCAF(assy)
    compound = assy.toCompound()
    with tempfile.TemporaryDirectory() as tmp:
        glb_path = Path(tmp) / f'{spec.id}.glb'
        write_glb(doc, [compound], glb_path, spec.mesh_linear, spec.mesh_angular)
        glb = glb_path.read_bytes()

    box = glb_corners(glb)  # measured on the GLB, as Circuit Studio measures it
    centre = [(min(c[i] for c in box) + max(c[i] for c in box)) / 2 for i in range(3)]
    euler = [math.radians(a) for a in spec.orientation]
    corners = [rotate([c[i] - centre[i] for i in range(3)], euler) for c in box]
    dims = [round(max(c[i] for c in corners) - min(c[i] for c in corners), 4) for i in range(3)]

    pins = []
    for index, p in enumerate(spec.pins):
        local = rotate([p.at[i] - centre[i] for i in range(3)], euler)
        exit_ = rotate(p.exit, euler)
        pin = {'id': p.id, 'label': p.label, 'side': side_of(exit_), 'index': index, 'localPosition': local,
               'orientation': [0, 0, 0], 'electrical': 'passive', 'exitDirection': exit_}
        if p.aliases:
            pin['aliases'] = p.aliases
        pins.append(pin)

    stats = glb_stats(glb)
    part = {
        'id': spec.id, 'name': spec.name, 'category': spec.category, 'dimensions': dims, 'format': 'glb',
        'asset': base64.b64encode(glb).decode('ascii'),
        'geometry': {'kind': 'model', 'quality': 'detailed', 'modelFormat': 'glb', 'category': spec.category,
                     'modelAssetId': spec.id, 'modelCenter': [round(v, 4) + 0.0 for v in centre],
                     'modelOrientation': [round(a, 5) + 0.0 for a in euler], 'origin': [0, 0, 0],
                     'calibrated': True, 'verified': False, 'sourceFilename': spec.step.name,
                     'sourceSha256': hashlib.sha256(spec.step.read_bytes()).hexdigest(), **stats},
        'pins': pins,
    }
    report = {'id': spec.id, 'solids': {'read': len(model.solids), 'kept': len(kept)},
              'colours': sorted({c for _, c in coloured}), 'dimensions': dims, 'pins': len(pins),
              'glbBytes': len(glb), **stats}
    return part, report, (kept, coloured, centre, euler)


def write_component(part, out):
    """Write the `.c3dcomponent` file Circuit Studio imports (Library → Import)."""
    Path(out).write_text(json.dumps({'format': 'c3d-component', 'version': 1, 'part': part}, indent=1),
                         encoding='utf-8')
