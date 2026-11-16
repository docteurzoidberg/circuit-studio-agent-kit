"""Prepare Circuit Studio parts from STEP files: coloured GLB + measured contacts in app coordinates.

The GLB keeps the STEP coordinates (mm, Z up). The part definition tells Circuit Studio how to place it:
`modelCenter` (STEP bounding-box centre), `modelOrientation` (Euler XYZ, radians) and calibrated
`dimensions`. Pin positions are expressed in the same centred, rotated frame.

Usage: .venv-cad/bin/python spike/prepare_parts.py <references dir> <output dir>
"""
import json
import math
import sys
from pathlib import Path

import cadquery as cq
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
from cadquery.occ_impl.assembly import toCAF

HALF_PI = math.pi / 2


def rotate(v, euler):
    """Apply a three.js 'XYZ' Euler rotation (R = Rx * Ry * Rz) to a vector."""
    x, y, z = v
    ax, ay, az = euler
    x, y = x * math.cos(az) - y * math.sin(az), x * math.sin(az) + y * math.cos(az)
    x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
    y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
    return [round(c, 4) + 0.0 for c in (x, y, z)]


def read_step(path):
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.ReadFile(str(path))
    doc = TDocStd_Document(TCollection_ExtendedString('XmXCAF'))
    reader.Transfer(doc)
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    labels = TDF_LabelSequence()
    tool.GetFreeShapes(labels)
    shapes = [cq.Shape.cast(tool.GetShape_s(labels.Value(i))) for i in range(1, labels.Length() + 1)]
    return doc, shapes, cq.Compound.makeCompound(shapes)


MESH = {'linear': 0.08, 'angular': 0.35}


def write_glb(doc, shapes, out):
    for s in shapes:
        BRepMesh_IncrementalMesh(s.wrapped, MESH['linear'], False, MESH['angular'], True).Perform()
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(out)), True)
    conv = writer.ChangeCoordinateSystemConverter()
    conv.SetInputLengthUnit(0.001)
    conv.SetOutputLengthUnit(0.001)  # keep millimetres
    conv.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    conv.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)  # keep STEP axes
    assert writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange())


def srgb_to_linear(hex_color):
    def channel(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return [channel(int(hex_color[k:k + 2], 16) / 255) for k in (1, 3, 5)]


# Same palette and rules as the reference project's mock-up packer: the STEP carries one default colour only,
# so colours are restored per sub-assembly and body size, after the product photo.
BOARD_COLOURS = {'pcb': '#2a2b28', 'terminal': '#2f9e4f', 'steel': '#a4a4aa', 'plastic': '#141414',
                 'gold': '#e4bb5c', 'shield': '#b9ae9b'}


def board_material(path, solid):
    b = solid.BoundingBox()
    s = sorted([b.xlen, b.ylen, b.zlen])
    sub = '+'.join(path[1:])
    if 'Screw Terminal' in sub:
        return 'terminal' if s[2] > 6 else 'steel'
    if 'USB-C' in sub:
        return 'steel'
    if 'Terminal Block' in sub:
        return 'plastic' if s[2] > 50 else 'gold'
    if 'Штыревой' in sub:  # pin header ("pin" in Russian), as named in the source STEP
        return 'gold' if s[2] > 5 else 'plastic'
    if len(path) > 1 and path[1].startswith('MDR076A'):
        return 'pcb' if s[2] > 50 else 'gold'
    if len(path) > 2 and path[2].startswith('ESP32-S3-WROOM-1') or len(path) > 1 and path[1].startswith('ESP32-S3-WROOM-1'):
        if s[2] > 50:
            return 'pcb'
        if s[1] > 12:
            return 'pcb' if s[0] < 1.2 else 'shield'
        return 'gold'
    return 'plastic'


def recoloured_doc(doc, material_of):
    """Rebuild the document as a flat assembly of solids, each coloured by material_of(path, solid)."""
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    assy = cq.Assembly(name='part')
    counts = {}

    def name_of(label):
        attr = TDataStd_Name()
        return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''

    def walk(label, path, loc):
        if XCAFDoc_ShapeTool.IsAssembly_s(label):
            comps = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(label, comps, False)
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                ref = TDF_Label()
                XCAFDoc_ShapeTool.GetReferredShape_s(comp, ref)
                walk(ref, path + [name_of(ref) or name_of(comp)], loc.Multiplied(XCAFDoc_ShapeTool.GetLocation_s(comp)))
            return
        shape = cq.Shape.cast(XCAFDoc_ShapeTool.GetShape_s(label).Moved(loc))
        for solid in shape.Solids():
            material = material_of(path, solid)
            counts[material] = counts.get(material, 0) + 1
            assy.add(solid, name=f'solid{sum(counts.values())}', color=cq.Color(*srgb_to_linear(BOARD_COLOURS[material])))

    free = TDF_LabelSequence()
    tool.GetFreeShapes(free)
    for i in range(1, free.Length() + 1):
        walk(free.Value(i), [name_of(free.Value(i))], TopLoc_Location())
    _, new_doc = toCAF(assy)
    return new_doc, [assy.toCompound()], counts


def mrd076a_contacts(compound):
    """Screw-terminal contacts: one vertical screw per way, wire entry on the outer face of each block."""
    screws = {}
    for face in compound.Faces():
        if face.geomType() != 'CYLINDER':
            continue
        cyl = face._geomAdaptor().Cylinder()
        if abs(cyl.Axis().Direction().Z()) < 0.999 or not 1.0 < cyl.Radius() < 1.8:
            continue
        c = cyl.Location()
        if 22 < abs(c.X()) < 30 and face.BoundingBox().zmin > 1.5:
            key = (1 if c.X() > 0 else -1, round(c.Y(), 1))
            screws[key] = c.Y()
    contacts = []
    for side, header in ((-1, 'J1'), (1, 'J3')):
        ys = sorted(y for (s, _), y in screws.items() if s == side)
        if len(ys) != 22:
            raise RuntimeError(f'{header}: found {len(ys)} screws, expected 22')
        for i, y in enumerate(reversed(ys)):  # pin 1 at the antenna end (high Y)
            contacts.append({'id': f'{header}-{i + 1}', 'at': [side * 29.17, y, 4.0], 'dir': [side, 0, 0]})
    return contacts


PARTS = [
    {'id': 'mrd076a-esp32-s3', 'name': 'MRD076A terminal adapter + ESP32-S3-DevKitC-1', 'step': 'mrd076a/MDR076A+ESP32-S3.STEP',
     'euler': [0, 0, 0], 'contacts': mrd076a_contacts, 'recolour': board_material},
    {'id': 'so-45', 'name': 'SO-45 panel voltmeter', 'step': 'so45/so-45-voltmeter.step', 'euler': [0, 0, math.pi],
     'contacts': [{'id': '+', 'at': [9.0, -32.9, -12.5], 'dir': [0, -1, 0]},
                  {'id': '-', 'at': [-9.0, -32.9, -12.5], 'dir': [0, -1, 0]}]},
    {'id': 'tm1637', 'name': 'TM1637 4-digit display', 'step': 'tm1637/Display_4-Didi_LED_TM1637.stp', 'euler': [0, 0, 0],
     'contacts': [{'id': label, 'at': [36.0, y, -7.4], 'dir': [1, 0, 0]}
                  for label, y in (('CLK', 3.3), ('DIO', 0.76), ('VCC', -1.78), ('GND', -4.32))]},
    {'id': 'lp16-2pole', 'name': 'LP-16 2-pole panel socket', 'step': 'lp16/LP-16-2pole.step', 'euler': [HALF_PI, 0, 0],
     'contacts': [{'id': '1', 'at': [-2.9, 0.0, -15.0], 'dir': [0, 0, -1]},
                  {'id': '2', 'at': [2.9, 0.0, -15.0], 'dir': [0, 0, -1]}]},
    {'id': 'fuse-holder', 'name': '5x20 panel fuse holder', 'step': 'fusible/fuse_holder.step', 'euler': [HALF_PI, 0, 0],
     'contacts': [{'id': 'END', 'at': [0.0, 2.6, -35.0], 'dir': [0, 0, -1]},
                  {'id': 'SIDE', 'at': [0.0, -3.9, -23.5], 'dir': [0, -1, 0]}]},
]


def main():
    """Usage: prepare_parts.py <references dir> <output dir> [--coarse] [--keep-colours] [part id ...]"""
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if '--coarse' in flags:
        MESH.update(linear=0.25, angular=0.7)
    refs, out = Path(args[0]), Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    defs = []
    only = set(args[2:])
    previous = {d['id']: d for d in json.loads((out / 'parts.json').read_text())} if (out / 'parts.json').exists() else {}
    for part in PARTS:
        if only and part['id'] not in only:
            if part['id'] in previous:
                defs.append(previous[part['id']])
            continue
        doc, shapes, compound = read_step(refs / part['step'])
        if part.get('recolour') and '--keep-colours' not in flags:
            doc, shapes, counts = recoloured_doc(doc, part['recolour'])
            print(part['id'], 'materials', counts, flush=True)
        b = compound.BoundingBox()
        center = [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2]
        corners = [rotate([x - center[0], y - center[1], z - center[2]], part['euler'])
                   for x in (b.xmin, b.xmax) for y in (b.ymin, b.ymax) for z in (b.zmin, b.zmax)]
        dims = [round(max(c[i] for c in corners) - min(c[i] for c in corners), 4) for i in range(3)]
        contacts = part['contacts'](compound) if callable(part['contacts']) else part['contacts']
        pins = [{'id': c['id'], 'label': c['id'],
                 'localPosition': rotate([c['at'][i] - center[i] for i in range(3)], part['euler']),
                 'exitDirection': rotate(c['dir'], part['euler'])} for c in contacts]
        glb = out / f"{part['id']}.glb"
        write_glb(doc, shapes, glb)
        stats = glb_stats(glb)
        defs.append({'id': part['id'], 'name': part['name'], 'source': part['step'], 'dimensions': dims,
                     'modelCenter': [round(v, 4) for v in center], 'modelOrientation': part['euler'],
                     'glb': glb.name, 'glbBytes': glb.stat().st_size, **stats, 'pins': pins})
        print(part['id'], dims, len(pins), 'pins', glb.stat().st_size // 1024, 'KiB', stats, flush=True)
    (out / 'parts.json').write_text(json.dumps(defs, indent=1))


def glb_stats(path):
    """Mesh, material and triangle counts read from the GLB JSON chunk."""
    import struct
    data = path.read_bytes()
    length = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + length])
    triangles = sum(gltf['accessors'][p['indices']]['count'] // 3
                    for m in gltf.get('meshes', []) for p in m['primitives'] if 'indices' in p)
    return {'meshes': len(gltf.get('meshes', [])), 'materials': len(gltf.get('materials', [])), 'triangles': triangles}


if __name__ == '__main__':
    main()
