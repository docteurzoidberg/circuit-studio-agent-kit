// Read a STEP file with its assembly tree, names and colours (OpenCascade XCAF), like tools/c3dparts/step_io.py.
import {existsSync, readFileSync} from 'node:fs';
import type {Handle_TDocStd_Document, TDF_Label, TopLoc_Location} from 'opencascade.js/dist/opencascade.full.js';
import {colourHex, enumValue, extendedText, occt, uniqueSubShapes, type Box, type OC, type Shape} from './occt.ts';

export class StepReadError extends Error {}

/** A solid of the model, placed in the STEP coordinates. */
export interface Solid {
  shape: Shape;
  /** Names from the root assembly down to the part holding the solid. */
  path: string[];
  /** '#rrggbb' (sRGB), or null when the file gives none. */
  colour: string | null;
  /** Bounding box, filled on first use (occt.ts, solidBox). */
  box?: Box;
}

export interface StepModel {
  oc: OC;
  path: string;
  doc: Handle_TDocStd_Document;
  /** Top-level shapes of the file. */
  shapes: Shape[];
  solids: Solid[];
  /** Faces carrying their own colour (dials, digits). */
  faceColours: number;
}

let fileCounter = 0;

export async function readStep(path: string): Promise<StepModel> {
  if (!existsSync(path)) throw new StepReadError(`${path}: file not found`);
  const oc = await occt();
  const virtual = `/step-${++fileCounter}.step`;
  oc.FS.writeFile(virtual, readFileSync(path));
  try {
    const doc = new oc.Handle_TDocStd_Document_2(new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1()));
    const reader = new oc.STEPCAFControl_Reader_1();
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    if (reader.ReadFile(virtual) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new StepReadError(`${path}: not a readable STEP file`);
    }
    if (!reader.Transfer_1(doc, new oc.Message_ProgressRange_1())) throw new StepReadError(`${path}: STEP transfer failed`);

    const main = doc.get().Main();
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(main).get();
    const colourTool = oc.XCAFDoc_DocumentTool.ColorTool(main).get();
    const nameOf = (label: TDF_Label): string => {
      const attr = new oc.Handle_TDF_Attribute_1();
      if (!label.FindAttribute_1(oc.TDataStd_Name.GetID(), attr)) return '';
      // embind gives the derived TDataStd_Name, which the typings do not know.
      const value = attr.get() as unknown as {Get?: () => Parameters<typeof extendedText>[1]};
      return typeof value.Get === 'function' ? extendedText(oc, value.Get()) : '';
    };
    const colourKinds = [oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen];
    const colourOf = (label: TDF_Label): string | null => {
      const c = new oc.Quantity_Color_1();
      for (const kind of colourKinds) if (colourTool.GetColor_4(label, enumValue(kind), c)) return colourHex(c);
      return null;
    };

    const model: StepModel = {oc, path, doc, shapes: [], solids: [], faceColours: 0};
    const walk = (label: TDF_Label, names: string[], loc: TopLoc_Location, inherited: string | null): void => {
      const own = colourOf(label) ?? inherited;
      if (oc.XCAFDoc_ShapeTool.IsAssembly(label)) {
        const comps = new oc.TDF_LabelSequence_1();
        oc.XCAFDoc_ShapeTool.GetComponents(label, comps, false);
        for (let i = 1; i <= comps.Length(); i++) {
          const comp = comps.Value(i);
          const ref = new oc.TDF_Label();
          oc.XCAFDoc_ShapeTool.GetReferredShape(comp, ref);
          walk(ref, [...names, nameOf(ref) || nameOf(comp)],
            loc.Multiplied(oc.XCAFDoc_ShapeTool.GetLocation(comp)), colourOf(comp) ?? own);
        }
        return;
      }
      const shape = oc.XCAFDoc_ShapeTool.GetShape_2(label);
      // Colours of solids or faces are attached to sub-labels of the part.
      const subs = new oc.TDF_LabelSequence_1();
      oc.XCAFDoc_ShapeTool.GetSubShapes(label, subs);
      const subColours: {shape: Shape; colour: string}[] = [];
      for (let i = 1; i <= subs.Length(); i++) {
        const colour = colourOf(subs.Value(i));
        if (colour) subColours.push({shape: oc.XCAFDoc_ShapeTool.GetShape_2(subs.Value(i)), colour});
      }
      if (subColours.length) {
        for (const face of uniqueSubShapes(oc, shape, 'FACE')) {
          if (subColours.some(s => s.shape.IsSame(face))) model.faceColours++;
        }
      }
      for (const solid of uniqueSubShapes(oc, shape, 'SOLID')) {
        const sub = subColours.find(s => s.shape.IsSame(solid));
        model.solids.push({shape: solid.Moved(loc, false), path: names, colour: sub?.colour ?? own});
      }
    };
    const free = new oc.TDF_LabelSequence_1();
    shapeTool.GetFreeShapes(free);
    for (let i = 1; i <= free.Length(); i++) {
      const label = free.Value(i);
      model.shapes.push(oc.XCAFDoc_ShapeTool.GetShape_2(label));
      walk(label, [nameOf(label)], new oc.TopLoc_Location_1(), null);
    }
    if (!model.solids.length) throw new StepReadError(`${path}: no solid in the file`);
    return model;
  } finally {
    oc.FS.unlink(virtual);
  }
}
