// `part convert`: STEP + part spec → Circuit Studio part (.c3dcomponent), deterministic, nothing guessed.
// Port of tools/c3dparts/convert.py.
//
// The GLB keeps the STEP coordinates (mm, Z up). The part tells Circuit Studio how to place it: `modelCenter`
// (bounding-box centre of the kept solids), `modelOrientation` (Euler XYZ, radians) and `dimensions` measured after
// rotation. Pin positions and exit directions are expressed in that centred, rotated frame.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import type {Handle_TDocStd_Document} from 'opencascade.js/dist/opencascade.full.js';
import {compound, enumValue, quantityColour, solidBox, unionBox, volume, type OC, type Shape} from './occt.ts';
import type {Spec, Vector} from './spec.ts';
import {readStep, type Solid} from './step.ts';

const DEFAULT_GREY = '#808080';
const round = (v: number, digits: number): number => Number(v.toFixed(digits)) + 0;

/** Pin of a Circuit Studio part (LibraryPartSchema), in the centred, rotated part frame. */
export interface PartPin {
  id: string;
  label: string;
  side: 'left' | 'right' | 'top' | 'bottom';
  index: number;
  localPosition: number[];
  orientation: number[];
  electrical: 'passive';
  exitDirection: number[];
  aliases?: string[];
}

/** Circuit Studio library part (LibraryPartSchema), as written into a `.c3dcomponent`. */
export interface Part {
  id: string;
  name: string;
  category: string;
  dimensions: number[];
  format: 'glb';
  /** GLB, base64. */
  asset: string;
  geometry: {
    kind: 'model'; quality: 'detailed'; modelFormat: 'glb'; category: string;
    modelCenter: number[]; modelOrientation: number[]; origin: number[];
    calibrated: boolean; verified: boolean; sourceFilename: string; sourceSha256: string;
  } & GlbStats;
  pins: PartPin[];
}

export interface GlbStats {
  meshCount: number;
  materialCount: number;
  triangleCount: number;
}

export interface Report extends GlbStats {
  id: string;
  solids: {read: number; kept: number};
  colours: string[];
  dimensions: number[];
  pins: number;
  glbBytes: number;
  component?: string;
  preview?: string;
}

/** A kept solid with the colour it gets in the part. */
export interface ColouredSolid {
  shape: Shape;
  colour: string;
}

export interface Conversion {
  part: Part;
  report: Report;
  kept: ColouredSolid[];
  /** Centre of the kept solids in STEP coordinates (the part frame's origin). */
  centre: number[];
  /** Part orientation, Euler XYZ in radians. */
  euler: number[];
  oc: OC;
}

/** Apply a three.js 'XYZ' Euler rotation (R = Rx * Ry * Rz) to a vector (radians), rounded to 0.0001. */
export function rotate([x, y, z]: number[], [ax, ay, az]: number[]): number[] {
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  return [x, y, z].map(c => round(c, 4));
}

/** Colour of a solid: the spec's rules when it has some, else the STEP colour, else the default. */
function solidColour(oc: OC, spec: Spec, solid: Solid): string {
  if (!spec.rules.length && !spec.defaultColour) return solid.colour ?? DEFAULT_GREY;
  const largest = Math.max(...solidBox(oc, solid).size);
  const path = solid.path.slice(1).join(' / ');  // without the root, which every solid shares
  for (const rule of spec.rules) {
    if (!path.includes(rule.match)) continue;
    if (rule.largestOver !== null && !(largest > rule.largestOver)) continue;
    if (rule.largestUnder !== null && !(largest < rule.largestUnder)) continue;
    return rule.colour;
  }
  return spec.defaultColour ?? solid.colour ?? DEFAULT_GREY;
}

/** Circuit Studio pin side from the exit direction in the part frame. */
export function sideOf([x, y]: number[]): PartPin['side'] {
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > 1e-6) return x > 0 ? 'right' : 'left';
  return y < 0 ? 'bottom' : 'top';
}

/** An XCAF document with one coloured, named body per entry, under a root assembly (like CadQuery's toCAF). */
function bodiesDocument(oc: OC, rootName: string, bodies: {name: string; colour: string; shape: Shape}[]): Handle_TDocStd_Document {
  const doc = new oc.Handle_TDocStd_Document_2(new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1()));
  const main = doc.get().Main();
  const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(main).get();
  const colourTool = oc.XCAFDoc_DocumentTool.ColorTool(main).get();
  const name = (label: ReturnType<typeof shapeTool.NewShape>, text: string) =>
    oc.TDataStd_Name.Set_1(label, new oc.TCollection_ExtendedString_2(text, true));
  const root = shapeTool.NewShape();
  name(root, rootName);
  for (const body of bodies) {
    const label = shapeTool.AddShape(body.shape, false, false);
    name(label, body.name);
    colourTool.SetColor_2(label, quantityColour(oc, body.colour), enumValue(oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf));
    shapeTool.AddComponent_1(root, label, new oc.TopLoc_Location_1());
  }
  shapeTool.UpdateAssemblies();
  return doc;
}

/** Mesh the bodies and write a binary glTF with OCCT's writer, keeping millimetres and STEP axes (Z up). */
function writeGlb(oc: OC, doc: Handle_TDocStd_Document, shapes: Shape[], linear: number, angular: number): Buffer {
  for (const shape of shapes) new oc.BRepMesh_IncrementalMesh_2(shape, linear, false, angular, false);
  const file = '/part.glb';
  const writer = new oc.RWGltf_CafWriter(new oc.TCollection_AsciiString_2(file), true);
  const conv = writer.ChangeCoordinateSystemConverter();
  conv.SetInputLengthUnit(0.001);
  conv.SetOutputLengthUnit(0.001);
  const zUp = enumValue<Parameters<typeof conv.SetInputCoordinateSystem_2>[0]>(oc.RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup);
  conv.SetInputCoordinateSystem_2(zUp);
  conv.SetOutputCoordinateSystem_2(zUp);
  if (!writer.Perform_2(doc, new oc.TColStd_IndexedDataMapOfStringString_1(), new oc.Message_ProgressRange_1())) {
    throw new Error('GLB export failed');
  }
  const glb = Buffer.from(oc.FS.readFile(file));
  oc.FS.unlink(file);
  return glb;
}

/** Mesh, material and triangle counts read from the GLB JSON chunk. */
export function glbStats(glb: Buffer): GlbStats {
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
    meshes?: {primitives: {indices?: number}[]}[]; materials?: unknown[]; accessors: {count: number}[];
  };
  const meshes = gltf.meshes ?? [];
  const triangles = meshes.flatMap(m => m.primitives)
    .reduce((n, p) => n + (p.indices === undefined ? 0 : Math.floor(gltf.accessors[p.indices].count / 3)), 0);
  return {meshCount: meshes.length, materialCount: (gltf.materials ?? []).length, triangleCount: triangles};
}

/** Run the pipeline on a loaded spec. */
export async function convert(spec: Spec): Promise<Conversion> {
  const model = await readStep(spec.step);
  const {oc} = model;
  const kept = model.solids.filter(s => spec.minVolume <= 0 || volume(oc, s.shape) >= spec.minVolume);
  if (!kept.length) throw new Error(`simplify.minVolume ${spec.minVolume} removes every solid`);
  // Mesh first, as the GLB needs it anyway: bounding boxes then use the triangulation, which is fast and gives the
  // same boxes (centre, dimensions, pin positions) as the Python reference.
  for (const s of kept) new oc.BRepMesh_IncrementalMesh_2(s.shape, spec.meshLinear, false, spec.meshAngular, false);
  const coloured: ColouredSolid[] = kept.map(s => ({shape: s.shape, colour: solidColour(oc, spec, s)}));

  let bodies: {name: string; colour: string; shape: Shape}[];
  if (spec.mergeByColour) {
    const groups = new Map<string, Shape[]>();
    for (const s of coloured) groups.set(s.colour, [...(groups.get(s.colour) ?? []), s.shape]);
    bodies = [...groups.keys()].sort().map((colour, i) =>
      ({name: `body${i + 1}`, colour, shape: compound(oc, groups.get(colour)!)}));
  } else {
    bodies = coloured.map((s, i) => ({name: `solid${i + 1}`, colour: s.colour, shape: s.shape}));
  }
  const doc = bodiesDocument(oc, spec.id, bodies);
  const glb = writeGlb(oc, doc, bodies.map(b => b.shape), spec.meshLinear, spec.meshAngular);

  const b = unionBox(kept.map(s => solidBox(oc, s)));
  const centre = b.min.map((v, i) => (v + b.max[i]) / 2);
  const euler = spec.orientation.map(a => (a * Math.PI) / 180);
  const corners: number[][] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
    corners.push(rotate([x - centre[0], y - centre[1], z - centre[2]], euler));
  }
  const dims = [0, 1, 2].map(i => round(Math.max(...corners.map(c => c[i])) - Math.min(...corners.map(c => c[i])), 4));

  const pins = spec.pins.map((p, index): PartPin => {
    const exitDirection = rotate(p.exit, euler);
    const pin: PartPin = {id: p.id, label: p.label, side: sideOf(exitDirection), index,
      localPosition: rotate(p.at.map((v, i) => v - centre[i]) as Vector, euler), orientation: [0, 0, 0],
      electrical: 'passive', exitDirection};
    if (p.aliases.length) pin.aliases = p.aliases;
    return pin;
  });

  const stats = glbStats(glb);
  const part: Part = {
    id: spec.id, name: spec.name, category: spec.category, dimensions: dims, format: 'glb',
    asset: glb.toString('base64'),
    geometry: {
      kind: 'model', quality: 'detailed', modelFormat: 'glb', category: spec.category,
      modelCenter: centre.map(v => round(v, 4)), modelOrientation: euler.map(a => round(a, 5)), origin: [0, 0, 0],
      calibrated: true, verified: false, sourceFilename: basename(spec.step),
      sourceSha256: createHash('sha256').update(readFileSync(spec.step)).digest('hex'), ...stats,
    },
    pins,
  };
  const report: Report = {id: spec.id, solids: {read: model.solids.length, kept: kept.length},
    colours: [...new Set(coloured.map(s => s.colour))].sort(), dimensions: dims, pins: pins.length,
    glbBytes: glb.length, ...stats};
  return {part, report, kept: coloured, centre, euler, oc};
}

/** Write the `.c3dcomponent` file Circuit Studio imports (Library → Import). */
export function writeComponent(part: Part, out: string): void {
  writeFileSync(out, JSON.stringify({format: 'c3d-component', version: 1, part}, null, 1));
}
