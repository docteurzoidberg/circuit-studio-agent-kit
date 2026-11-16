"""Make simplified, coloured copies of the reference STEP files (the user-side preparation step).

For each part: drop tiny solids, restore colours by rules when the STEP has none, merge the remaining solids
into one body per colour, and write a STEP with those colours. The originals are only read.

Usage: .venv-cad/bin/python spike/simplify_steps.py <references dir> <output dir>
"""
import shutil
import sys
from pathlib import Path

import cadquery as cq
from OCP.Quantity import Quantity_Color
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool, XCAFDoc_ShapeTool

from prepare_parts import BOARD_COLOURS, PARTS, read_step, srgb_to_linear

# Smallest solid kept, in mm³ (SMD passives and similar details go); 0 keeps everything.
MIN_VOLUME = {'mrd076a-esp32-s3': 1.0}
COLOUR_TYPES = (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen)
DEFAULT_COLOUR = (0.5, 0.5, 0.5)


def name_of(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''


def simplify(doc, part):
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    colour_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    rule = part.get('recolour')
    min_volume = MIN_VOLUME.get(part['id'], 0.0)
    groups, dropped, kept = {}, 0, 0

    def stored_colour(solid, labels):
        c = Quantity_Color()
        for candidate in [solid, *solid.Faces()[:3]]:
            for t in COLOUR_TYPES:
                if colour_tool.GetColor(candidate.wrapped, t, c):
                    return (c.Red(), c.Green(), c.Blue())
        for label in labels:
            for t in COLOUR_TYPES:
                if colour_tool.GetColor(label, t, c):
                    return (c.Red(), c.Green(), c.Blue())
        return DEFAULT_COLOUR

    def walk(label, path, loc, labels):
        nonlocal dropped, kept
        if XCAFDoc_ShapeTool.IsAssembly_s(label):
            comps = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(label, comps, False)
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                ref = TDF_Label()
                XCAFDoc_ShapeTool.GetReferredShape_s(comp, ref)
                walk(ref, path + [name_of(ref) or name_of(comp)],
                     loc.Multiplied(XCAFDoc_ShapeTool.GetLocation_s(comp)), [comp, ref, *labels])
            return
        for solid in cq.Shape.cast(XCAFDoc_ShapeTool.GetShape_s(label)).Solids():
            if solid.Volume() < min_volume:
                dropped += 1
                continue
            placed = cq.Shape.cast(solid.wrapped.Moved(loc))
            if rule:
                key = rule(path, placed)
                colour = tuple(srgb_to_linear(BOARD_COLOURS[key]))
            else:
                colour = tuple(round(v, 4) for v in stored_colour(solid, [label, *labels]))
                key = colour
            groups.setdefault(key, (colour, []))[1].append(placed)
            kept += 1

    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)
    for i in range(1, free.Length() + 1):
        walk(free.Value(i), [name_of(free.Value(i))], TopLoc_Location(), [free.Value(i)])
    assy = cq.Assembly(name=part['id'])
    for i, (key, (colour, solids)) in enumerate(groups.items()):
        name = key if isinstance(key, str) else f'colour{i + 1}'
        assy.add(cq.Compound.makeCompound(solids), name=name, color=cq.Color(*colour))
    return assy, {'kept': kept, 'dropped': dropped, 'bodies': len(groups)}


def main():
    refs, out = Path(sys.argv[1]), Path(sys.argv[2])
    for part in PARTS:
        target = out / part['step']
        target.parent.mkdir(parents=True, exist_ok=True)
        if not part.get('recolour') and not MIN_VOLUME.get(part['id']):
            # Merging by colour would lose face-level colours (dials, digits): keep the original geometry.
            shutil.copyfile(refs / part['step'], target)
            print(part['id'], 'unchanged', flush=True)
            continue
        doc, _, _ = read_step(refs / part['step'])
        assy, stats = simplify(doc, part)
        assy.export(str(target), exportType='STEP')
        print(part['id'], stats, target.stat().st_size // 1024, 'KiB', flush=True)


main()
