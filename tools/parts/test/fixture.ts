// A small coloured, named STEP assembly for the part tools' tests: a board with a 4-pin header and a 3-way screw
// terminal. Writes test/fixtures/test-board.step (committed); run it only to change the fixture, then regenerate the
// expected outputs (test/fixtures/*.reference.json) on purpose:
//   node tools/parts/test/fixture.ts tools/parts/test/fixtures/test-board.step
//
// Known facts (mm): board 30 x 20 x 1.6 with its top at z = 1.6; header pins 0.64 square, 2.54 pitch along X,
// centred on y = 5, from z = -3 to z = 8.5; terminal screws radius 1.25, 5 mm pitch along X, on y = -5, top at
// z = 6.6; one tiny solid (0.3 mm cube). First written with CadQuery (tools/c3dparts, removed; see git history).
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {TDF_Label} from 'opencascade.js/dist/opencascade.full.js';
import {enumValue, occt, quantityColour, type OC, type Shape} from '../occt.ts';

const GREEN = '#1a7a3a', BLACK = '#141414', GOLD = '#e4bb5c', STEEL = '#a4a4aa';
const PIN_X = [-3.81, -1.27, 1.27, 3.81];
const SCREW_X = [-5, 0, 5];

/** A box of size (dx, dy, dz) centred on (x, y) in plan, from z upwards. */
function box(oc: OC, [dx, dy, dz]: number[], [x, y, z]: number[]): Shape {
  return new oc.BRepPrimAPI_MakeBox_4(new oc.gp_Pnt_3(x - dx / 2, y - dy / 2, z), new oc.gp_Pnt_3(x + dx / 2, y + dy / 2, z + dz))
    .Shape();
}

/** A vertical cylinder standing on (x, y, z). */
function cylinder(oc: OC, radius: number, height: number, [x, y, z]: number[]): Shape {
  return new oc.BRepPrimAPI_MakeCylinder_3(new oc.gp_Ax2_3(new oc.gp_Pnt_3(x, y, z), new oc.gp_Dir_4(0, 0, 1)), radius, height)
    .Shape();
}

/** Write an XCAF document as STEP text. */
function stepText(oc: OC, doc: InstanceType<OC['Handle_TDocStd_Document_2']>): Buffer {
  const writer = new oc.STEPCAFControl_Writer_1();
  writer.SetColorMode(true);
  writer.SetNameMode(true);
  const file = '/fixture.step';
  if (!writer.Perform_2(doc, file, new oc.Message_ProgressRange_1())) throw new Error('STEP write failed');
  const step = Buffer.from(oc.FS.readFile(file));
  oc.FS.unlink(file);
  return step;
}

/**
 * A STEP assembly holding one shape placed twice (two instances of the same 5 x 5 x 10 post, at x = -20 and x = 20,
 * standing on z = 0): 45 x 5 x 10 mm in all. Written by the tests, not committed.
 */
export async function instancedStep(): Promise<Buffer> {
  const oc = await occt();
  const doc = new oc.Handle_TDocStd_Document_2(new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1()));
  const shapes = oc.XCAFDoc_DocumentTool.ShapeTool(doc.get().Main()).get();
  const root = shapes.NewShape();
  oc.TDataStd_Name.Set_1(root, new oc.TCollection_ExtendedString_2('Posts', true));
  const post = shapes.AddShape(box(oc, [5, 5, 10], [0, 0, 0]), false, false);
  oc.TDataStd_Name.Set_1(post, new oc.TCollection_ExtendedString_2('Post', true));
  for (const x of [-20, 20]) {
    const move = new oc.gp_Trsf_1();
    move.SetTranslation_1(new oc.gp_Vec_4(x, 0, 0));
    shapes.AddComponent_1(root, post, new oc.TopLoc_Location_2(move));
  }
  shapes.UpdateAssemblies();
  return stepText(oc, doc);
}

/** The fixture as STEP text. */
export async function fixtureStep(): Promise<Buffer> {
  const oc = await occt();
  const doc = new oc.Handle_TDocStd_Document_2(new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1()));
  const main = doc.get().Main();
  const shapes = oc.XCAFDoc_DocumentTool.ShapeTool(main).get();
  const colours = oc.XCAFDoc_DocumentTool.ColorTool(main).get();
  const name = (label: TDF_Label, text: string) => oc.TDataStd_Name.Set_1(label, new oc.TCollection_ExtendedString_2(text, true));
  const assembly = (parent: TDF_Label | null, text: string): TDF_Label => {
    const label = shapes.NewShape();
    name(label, text);
    if (parent) shapes.AddComponent_1(parent, label, new oc.TopLoc_Location_1());
    return label;
  };
  const part = (parent: TDF_Label, text: string, shape: Shape, colour: string) => {
    const label = shapes.AddShape(shape, false, false);
    name(label, text);
    colours.SetColor_2(label, quantityColour(oc, colour), enumValue(oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf));
    shapes.AddComponent_1(parent, label, new oc.TopLoc_Location_1());
  };

  const root = assembly(null, 'Test board');
  part(root, 'PCB', box(oc, [30, 20, 1.6], [0, 0, 0]), GREEN);
  const header = assembly(root, 'Header');
  part(header, 'Header body', box(oc, [10.16, 2.54, 2.5], [0, 5, 1.6]), BLACK);
  PIN_X.forEach((x, i) => part(header, `Pin ${i + 1}`, box(oc, [0.64, 0.64, 11.5], [x, 5, -3]), GOLD));
  const terminal = assembly(root, 'Terminal');
  part(terminal, 'Terminal body', box(oc, [15, 7, 5], [0, -5, 1.6]), GREEN);
  SCREW_X.forEach((x, i) => part(terminal, `Screw ${i + 1}`, cylinder(oc, 1.25, 1, [x, -5, 5.6]), STEEL));
  part(root, 'Tiny', box(oc, [0.3, 0.3, 0.3], [12, 8, 1.6]), BLACK);
  shapes.UpdateAssemblies();
  return stepText(oc, doc);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node tools/parts/test/fixture.ts <out.step>');
    process.exit(2);
  }
  writeFileSync(out, await fixtureStep());
  console.log(out);
}
