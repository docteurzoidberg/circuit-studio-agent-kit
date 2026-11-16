# Resolve wiring.md into wiring.json

`wiring.json` holds the same wiring as the document, with every name resolved: each part has a kind and a
reference, each wire end a pin **identifier** of its part. Field reference:
[schema/wiring.schema.json](../../schema/wiring.schema.json); a complete example:
[examples/claudemetre/wiring.json](../../examples/claudemetre/wiring.json). It sits next to its document, so its
`source.path` and `$schema` differ from those of a project's file (section 6).

There is no parser of the document: you read it. Read it all, the text around the tables too: it often explains
terminal numbering or which of several equivalent pins is used.

## 1. Read the tables

Find them by their headers, whatever their order or extra columns. Skip any table inside an HTML comment
(`<!-- -->`): the template's commented-out *Layout* section is not a layout.

- **Parts**: *Name*, *Part*, optional *Pins*, *Model*, *Note*.
- **Connections**: *From* or *Source*, *To* or *Destination*; the colour is in *Wire*, *Color* or *Colour*;
  optional *Note*.
- **Layout** (optional): *Name* or *Part*, *X*, *Y*, optional *Rotation*.

**Line numbers** are the 1-based lines of the table rows in the document: get them with a command
(`grep -n '^|' wiring.md`), never by counting.

## 2. Parts

One entry per row of the *Parts* table, in table order:

| *Part* cell | Entry |
|---|---|
| found by `part pins` as `prepared` | `"kind": "prepared"`, `"ref"`: the identifier |
| found by `part pins` as `catalog` | `"kind": "catalog"`, `"modelId"`: the identifier |
| `stand-in W x H x T` (also `WxHxT`) | `"kind": "stand-in"`, `"size": [W, H, T]` in mm, `"pins"`: the *Pins* cell, in order |

Add `"model"` (the *Model* path, without backquotes) when there is one, `"note"` (the *Note* cell) when it is
not empty, and `"line"`.

## 3. Connections

One entry per row, in table order: it is the order in which the video connects the wires.

- The *From* cell holds one reference, the *To* cell one or more separated by commas: several wires from the
  same terminal, one `to` entry each.
- A reference is a part name followed by a pin. Match the **longest** part name first (`Session gauge` before
  `Session`). Text in parentheses is a comment, not part of the pin: `Board J1-22 (GND)` is pin `J1-22`. Keep
  the whole reference as written in `"text"`.
- Resolve the pin against the part's pins (`part pins` for prepared and built-in parts, the *Pins* cell for a
  stand-in), comparing case-insensitively, in this order: identifier, label, silkscreen, aliases. Write
  the pin's **identifier** in `"pin"`.
- When the name matches several pins (two `GND` terminals, a label used twice), the comment in parentheses or
  the document's text may decide (the text says which ground terminal each wire uses). If they do not, it is a
  question (below).
- The document's explanations may resolve a pin that matches no name ("terminal *n* of the left block is header
  pin J1-*n*"). Use them, and list each such pin in the report.
- `"color"`: the *Wire* cell. Allowed: black, red, orange, blue, purple, green, brown, yellow, white, or
  `#rrggbb`. Any other name is a question. `"note"`: the *Note* cell when not empty. `"line"`: the row's line.

## 4. Layout

Only from a *Layout* table outside comments: one entry per row, `"part"` (the *Name*), `"x"`, `"y"` in mm,
`"rotation"` in degrees when given, `"line"`. Without such a table, leave `layout` out: placement is automatic.

## 5. Never guess

When a part or a pin matches nothing, matches several pins that nothing in the document tells apart, or a
colour is not allowed, ask the user. Ask everything in one message: for each question, the document line, the
reference as written, and the likely candidates (identifier and label). Write nothing until they answer.

Then write each answer **into the document**, with the user's agreement, so the next resolution does not ask
again: the pin identifier, with its name as a comment (`Board 3V3` becomes `Board J1-1 (3V3)`), keeping the
table aligned. If the user edited the document meanwhile, read it again first and keep their changes.

## 6. Write the file

Write `.circuitstudio/wiring.json` (create the folder if needed), two-space indent:

- `"$schema"`: `https://raw.githubusercontent.com/docteurzoidberg/circuit-studio-agent-kit/main/schema/wiring.schema.json`
  (editors that know JSON Schema load it from there; the kit checks against its own copy);
- `"version": 1`;
- `"title"`: the document's title without its " — wiring" suffix;
- `"source"`: `"path"` relative to `wiring.json`, so from `.circuitstudio/` (`../wiring.md` when the document is
  at the project root)
  and `"sha256"`, computed with a command (`sha256sum wiring.md`) **after** the last change to the document,
  never written from memory;
- `"parts"`, `"connections"`, and `"layout"` when there is one.

Write it with a short script rather than by hand when it is long (the indentation, the hash from the command);
keep the script outside the project. Then check it (`<kit> wiring`, step 3 of the skill).
