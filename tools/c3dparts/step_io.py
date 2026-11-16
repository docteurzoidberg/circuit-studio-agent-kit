"""Read a STEP file with its assembly tree, names and colours (OpenCascade XCAF through CadQuery's OCP)."""
from dataclasses import dataclass, field
from pathlib import Path

import cadquery as cq
from OCP.Quantity import Quantity_Color, Quantity_TOC_sRGB
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_ColorTool, XCAFDoc_ColorType, XCAFDoc_DocumentTool, XCAFDoc_ShapeTool

COLOUR_TYPES = (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen)


@dataclass
class Solid:
    """One solid of the model, placed in model coordinates."""
    shape: cq.Shape
    path: list  # names from the root to the solid's part
    colour: str | None  # '#rrggbb' (sRGB) or None when the file gives none


@dataclass
class StepModel:
    path: Path
    doc: object
    shapes: list  # top-level shapes, placed
    solids: list = field(default_factory=list)
    face_colours: int = 0  # faces carrying their own colour (dials, digits)

    @property
    def compound(self):
        return cq.Compound.makeCompound(self.shapes)


class StepReadError(RuntimeError):
    pass


def label_name(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''


def to_hex(colour):
    r, g, b = colour.Values(Quantity_TOC_sRGB)
    return '#' + ''.join(f'{round(max(0.0, min(1.0, v)) * 255):02x}' for v in (r, g, b))


def label_colour(label):
    colour = Quantity_Color()
    for kind in COLOUR_TYPES:
        if XCAFDoc_ColorTool.GetColor_s(label, kind, colour):
            return to_hex(colour)
    return None


def read_step(path):
    """Read a STEP file; return the XCAF document, the placed top-level shapes and every solid with its path."""
    path = Path(path)
    if not path.is_file():
        raise StepReadError(f'{path}: file not found')
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    if reader.ReadFile(str(path)) != 1:  # IFSelect_RetDone
        raise StepReadError(f'{path}: not a readable STEP file')
    doc = TDocStd_Document(TCollection_ExtendedString('XmXCAF'))
    if not reader.Transfer(doc):
        raise StepReadError(f'{path}: STEP transfer failed')
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    model = StepModel(path=path, doc=doc, shapes=[])

    def walk(label, names, loc, inherited):
        own = label_colour(label) or inherited
        if XCAFDoc_ShapeTool.IsAssembly_s(label):
            comps = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(label, comps, False)
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                ref = TDF_Label()
                XCAFDoc_ShapeTool.GetReferredShape_s(comp, ref)
                walk(ref, names + [label_name(ref) or label_name(comp)],
                     loc.Multiplied(XCAFDoc_ShapeTool.GetLocation_s(comp)), label_colour(comp) or own)
            return
        shape = cq.Shape.cast(XCAFDoc_ShapeTool.GetShape_s(label))
        # Sub-shape colours (per solid or per face) are attached to sub-labels of the part.
        subs = TDF_LabelSequence()
        XCAFDoc_ShapeTool.GetSubShapes_s(label, subs)
        sub_colours = {}
        for i in range(1, subs.Length() + 1):
            sub = subs.Value(i)
            c = label_colour(sub)
            if c:
                sub_colours[hash(XCAFDoc_ShapeTool.GetShape_s(sub))] = c
        for face in shape.Faces():
            if hash(face.wrapped) in sub_colours:
                model.face_colours += 1
        for solid in shape.Solids():
            c = sub_colours.get(hash(solid.wrapped)) or own
            model.solids.append(Solid(cq.Shape.cast(solid.wrapped.Moved(loc)), names, c))

    free = TDF_LabelSequence()
    tool.GetFreeShapes(free)
    for i in range(1, free.Length() + 1):
        label = free.Value(i)
        model.shapes.append(cq.Shape.cast(XCAFDoc_ShapeTool.GetShape_s(label)))
        walk(label, [label_name(label)], TopLoc_Location(), None)
    if not model.solids:
        raise StepReadError(f'{path}: no solid in the file')
    return model
