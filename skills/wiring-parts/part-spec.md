# Part spec (`part.yaml`)

What `<kit> part convert` needs to turn a STEP model into a Circuit Studio part. Written by the skill with the
user, in `.circuitstudio/parts/<id>/part.yaml`. Nothing is guessed by the converter: every value here is a
decision, from `part inspect`, the project's notes, a datasheet or the user. A complete example, a terminal
adapter with 44 pins: [examples/claudemetre/parts/mrd076a/part.yaml](../../examples/claudemetre/parts/mrd076a/part.yaml).

```yaml
# Where the values come from (inspect, README, datasheet, assumption): a comment line or two.
id: so-45                       # required: the document's Part identifier, kebab-case
name: SO-45 panel voltmeter     # required: readable name
category: meter                 # optional, free text (default "module")
step: ../../../design/references/so45/so-45-voltmeter.step   # required, relative to this file
orientation: [0, 0, 0]          # optional: Euler XYZ in degrees, applied after centring
mesh: { linear: 0.25, angular: 0.7 }                 # optional; larger = coarser and lighter
simplify: { minVolume: 1.0, mergeByColour: true }    # optional, only for a complex model
colours:                        # optional, only when the model's colours are missing or wrong
  palette: { body: "#141414", steel: "#a4a4aa" }
  rules:                        # first match wins
    - { match: "Screw", colour: steel }
    - { match: "Body", largestOver: 20, colour: body }
  default: body
pins:                           # required: at least one
  - { id: "+", label: "+", at: [9, -32.9, -12.5], exit: [0, -1, 0] }
  - generate:                   # a regular row: header, terminal block
      ids: "J1-{n}"             # {n} = first, first + 1, ...
      count: 22
      start: [-29.17, 79.1, 4.0]
      step: [0, -3.5, 0]
      exit: [-1, 0, 0]
      labels: [3V3, 3V3, RST]   # optional, by position; a missing label is the id
      aliases: { 21: [5V0] }    # optional, by pin number
      first: 1                  # optional
```

Coordinates are the STEP model's own, in millimetres, before `orientation`. The converter centres the part on its
bounding box, applies `orientation`, and converts the pins the same way. Circuit Studio's vertical axis is +Z.
Read the contact rows and sizes from `inspect --json`: the text output cuts long lists.

## Pins

Pins are where wires land. Each pin has:

- `id`: the name the wiring refers to. Use the document's own names when it gives them: terminal names
  (`J1-4`, `1`, `+`) for connectors and terminal blocks, the silkscreen name (`VCC`, `DIN`) for a module.
- `label`: the name shown in Circuit Studio, often the function (`GPIO4` on terminal `J1-4`).
- `aliases`: other names the document or the sources use for the same pin (`5V0` for `5V`).
- `at`: the point where the wire attaches.
- `exit`: the direction the wire leaves the pin (a unit vector; it is normalised).

The wiring is resolved by comparing the document's pin names with `id`, `label` and `aliases`, ignoring case. So
**every pin name the document uses must be one of them, for exactly one pin**. Several `GND` pins are fine as
labels only if the document names each ground wire by its terminal (`J3-1 (GND)`).

### Placing the pins

1. **Read the contact rows** of `inspect`: each row is a line of regularly spaced cylinders or posts (`count`,
   `kind`, `axis`, `sizes` in mm, `start`, `step`, and the assembly `parts` they belong to). Match them with the
   connectors the notes or the datasheet describe: number of pins and pitch (2.54 mm for a header, 3.5 or 5 mm
   for a terminal block). A row found at several sizes (a screw, its hole, its thread) is one row.
2. **Choose the attachment point**:
   - a header pin pointing up: the top of the pin, `exit: [0, 0, 1]` (in STEP axes, before orientation);
   - a screw terminal: the wire entry on the side of the block, `exit` pointing out of the opening;
   - a solder lug or a tab: on the lug, `exit` away from the body;
   - a pad or a wire soldered on a board: on the pad, `exit` away from the board.
   - a right-angle header (a display module's 4-pin connector): `inspect` finds the pads or the straight part on
     the board, not the bent tips. Take the row from the pads, then the tip from the header's box in the tree
     (its far end along the bend, its height above the board), and check on the preview.
   The single contact candidates of `inspect` help for isolated pins (a meter's two studs).
3. **Number the row**: pin 1 from the notes, the silkscreen, a square pad or the datasheet. If it comes from
   general knowledge or from the order of the row in the model, it is an **assumption**: put it in a comment and
   in what you tell the user. `step` goes from pin 1 to pin 2.
4. **Name the pins** with `labels` (by position) and `aliases`, so the document's names resolve.
5. **Check on the preview** after converting: every pin sits on a contact, in the right order, its wire leaving
   outward.

## Orientation

`orientation` gives the part its pose, agreed with the user: usually flat with its top facing +Z (a board, a
module), or standing with its face towards the viewer, -Y, and its wires leaving behind, +Y (a panel part).

- **Convention**: three.js Euler `XYZ`, in degrees: the model turns about Z first, then about Y, then about X,
  each time about the fixed axes (R = Rx · Ry · Rz).
- **Preview**: the top view looks down from +Z (X right, Y up); the front view looks from -Y (X right, Z up).
  A part standing with its face towards the viewer shows its face in the front view.
- **Recipes**, from the axis the face (or the top) points along in the STEP model, as `inspect`'s tree and sizes
  or the notes tell:

  | Face along, in the STEP | Face up (+Z) | Face towards the viewer (-Y) |
  |---|---|---|
  | +Z | `[0, 0, 0]` | `[90, 0, 0]` |
  | -Z | `[180, 0, 0]` | `[-90, 0, 0]` |
  | +Y | `[90, 0, 0]` | `[0, 0, 180]` |
  | -Y | `[-90, 0, 0]` | `[0, 0, 0]` |
  | +X | `[0, -90, 0]` | `[0, 0, -90]` |
  | -X | `[0, 90, 0]` | `[0, 0, 90]` |

  The face is then in place, but the part may still be turned about it (upside down, on its side): check the
  front view and adjust, the conversion of a small part takes seconds.
- `exit` and `at` stay in STEP coordinates: the converter rotates them with the part. Give the wires the
  direction they leave in the build (behind a panel part: the direction the terminals point).

## Colours

Most STEP files carry colours; `inspect` reports them (`colours: N distinct`). Add `colours` only when there is
one colour or none, or when the model's colour differs from the real part.

- `match` is a text searched in the solid's assembly path (the tree of `inspect`); names may be in any language
  (the MRD076A spec matches Cyrillic names).
- `largestOver` / `largestUnder` test the largest dimension of the solid, in mm: they tell a board (large) from
  its components (small) under the same name.
- Colours are `#rrggbb` or a name from `palette`. `default` is optional: it colours the solids no rule matches;
  without it they keep the model's colour, so a single rule can recolour one part of the model (a flange shown
  black: `{ match: "", largestOver: 28, colour: "#141414" }`).
- Rules colour whole solids. Colours set on faces (`faces with their own colour` in `inspect`: segments of a
  display, a printed dial) are not changed by them; say so when the real part's colours differ there.

## Simplification

Only for a model `inspect` calls **complex** (many solids or faces): a lighter part renders faster.

- `minVolume` drops solids smaller than that volume, in mm³. Choose it from `small solids` in `inspect` (how
  many solids are below 0.1, 1, 10, 100 mm³): high enough to drop many tiny hidden solids (resistors, SMD
  components under a shield), low enough to keep the visible ones and **the contacts the pins sit on**.
- `mergeByColour: true` merges the solids of each colour into one body. Use `minVolume` alone first: merging
  loses face-level colours (digits on a display, a printed dial), and it can make the file **larger** (on the
  Claudemètre's terminal adapter, 14.8 MB instead of 8.9 MB with `minVolume` alone, for 6 meshes instead of 489).
  Try it only when the model has no face-level colours (`faces with their own colour: 0`), and keep it only if
  the file gets lighter.
- `mesh.linear` (default 0.25 mm) can go to 0.5 for a large part; finer is rarely needed.

Report the result to the user: solids kept out of read, triangles, file size, and whether anything visible
disappeared on the preview.
