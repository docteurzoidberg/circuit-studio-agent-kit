// OpenCascade compiled to WebAssembly (opencascade.js 2.0 beta), loaded once, and small helpers around its
// embind API. Overloaded C++ methods and constructors carry `_1`, `_2`... suffixes.
import initOpenCascade from 'opencascade.js/dist/node.js';
import type {OpenCascadeInstance, Quantity_Color, TCollection_ExtendedString, TopAbs_ShapeEnum, TopoDS_Shape} from 'opencascade.js/dist/opencascade.full.js';

export type OC = OpenCascadeInstance;
export type Shape = TopoDS_Shape;

/** Axis-aligned box in mm. */
export interface Box {
  min: number[];
  max: number[];
  size: number[];
}

let instance: OC | undefined;

/** The OpenCascade module (about 5 s to load the first time). */
export async function occt(): Promise<OC> {
  if (!instance) instance = (await initOpenCascade()) as OC;
  return instance;
}

/**
 * An enum value of OpenCascade. The typings declare each value as `{}` and each parameter as the whole enum
 * object, so values are passed through this cast.
 */
export const enumValue = <T>(value: unknown): T => value as T;

/** Shape type for explorers and maps (`'FACE'`, `'SOLID'`...). */
export const shapeType = (oc: OC, name: 'FACE' | 'SOLID'): TopAbs_ShapeEnum =>
  enumValue<TopAbs_ShapeEnum>(oc.TopAbs_ShapeEnum[`TopAbs_${name}`]);

/** UTF-8 text of a TCollection_ExtendedString (embind does not expose its wide characters). */
export function extendedText(oc: OC, ext: TCollection_ExtendedString): string {
  // OCCT writes UTF-8 bytes; embind hands a char* over one byte per character (Latin-1): decode them again.
  const ascii = new oc.TCollection_AsciiString_13(ext, 0);
  return Buffer.from(ascii.ToCString(), 'latin1').toString('utf8');
}

const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** '#rrggbb' (sRGB) of a Quantity_Color, which OpenCascade stores as linear RGB. */
export function colourHex(c: Quantity_Color): string {
  return '#' + [c.Red(), c.Green(), c.Blue()]
    .map(v => Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255).toString(16).padStart(2, '0')).join('');
}

/** Quantity_Color (linear RGB) from '#rrggbb' (sRGB). */
export function quantityColour(oc: OC, hex: string): Quantity_Color {
  const [r, g, b] = [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return new oc.Quantity_Color_3(r, g, b, enumValue(oc.Quantity_TypeOfColor.Quantity_TOC_RGB));
}

/** Bounding box computed like CadQuery's Shape.BoundingBox() (optimal, triangulation when present). */
export function boundingBox(oc: OC, shape: Shape): Box {
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.AddOptimal(shape, box, true, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  const min = [lo.X(), lo.Y(), lo.Z()], max = [hi.X(), hi.Y(), hi.Z()];
  return {min, max, size: max.map((v, i) => v - min[i])};
}

/** Box of several boxes. */
export function unionBox(boxes: Box[]): Box {
  const min = [0, 1, 2].map(i => Math.min(...boxes.map(b => b.min[i])));
  const max = [0, 1, 2].map(i => Math.max(...boxes.map(b => b.max[i])));
  return {min, max, size: max.map((v, i) => v - min[i])};
}

/**
 * Bounding box of a read solid, computed once: the optimal box is exact but slow in WebAssembly on some faces
 * (0.7 s for a terminal block body), and the box of a group of solids is the union of theirs.
 */
export function solidBox(oc: OC, solid: {shape: Shape; box?: Box}): Box {
  solid.box ??= boundingBox(oc, solid.shape);
  return solid.box;
}

/** Volume in mm³, like CadQuery's Shape.Volume(). */
export function volume(oc: OC, shape: Shape): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  return props.Mass();
}

/** Distinct sub-shapes of a type, each once even when shared (like CadQuery's Shape.Faces(), Solids()). */
export function uniqueSubShapes(oc: OC, shape: Shape, type: 'FACE' | 'SOLID'): Shape[] {
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, shapeType(oc, type), map);
  const out: Shape[] = [];
  for (let i = 1; i <= map.Size(); i++) out.push(map.FindKey(i));
  return out;
}

/** A compound of shapes. */
export function compound(oc: OC, shapes: Shape[]): Shape {
  const builder = new oc.BRep_Builder();
  const result = new oc.TopoDS_Compound();
  builder.MakeCompound(result);
  for (const s of shapes) builder.Add(result, s);
  return result;
}
