"""Summarise STEP files for part preparation: overall bounds, solid count and named sub-shapes.

Usage: .venv-cad/bin/python spike/inspect_step.py <file.step> [...]
"""
import json
import sys

import cadquery as cq
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDF import TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool


def box(shape):
    b = shape.BoundingBox()
    return [round(v, 2) for v in (b.xmin, b.xmax, b.ymin, b.ymax, b.zmin, b.zmax)]


def label_name(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''


def inspect(path):
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.ReadFile(path)
    doc = TDocStd_Document(TCollection_ExtendedString('XmXCAF'))
    reader.Transfer(doc)
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = TDF_LabelSequence()
    tool.GetFreeShapes(free)
    shapes = [cq.Shape.cast(tool.GetShape_s(free.Value(i))) for i in range(1, free.Length() + 1)]
    compound = cq.Compound.makeCompound(shapes)
    names = {}
    for i in range(1, free.Length() + 1):
        comps = TDF_LabelSequence()
        tool.GetComponents_s(free.Value(i), comps, False)
        for j in range(1, comps.Length() + 1):
            lab = comps.Value(j)
            ref = lab
            tool.GetReferredShape_s(lab, ref)
            name = label_name(lab) or label_name(ref)
            shape = cq.Shape.cast(tool.GetShape_s(lab))
            names.setdefault(name, []).append(box(shape))
    return {'file': path.rsplit('/', 1)[-1], 'bounds': box(compound), 'solids': len(compound.Solids()),
            'topLevel': [label_name(free.Value(i)) for i in range(1, free.Length() + 1)],
            'components': {k: {'count': len(v), 'first': v[0]} for k, v in list(names.items())[:40]}}


for p in sys.argv[1:]:
    print(json.dumps(inspect(p)))
