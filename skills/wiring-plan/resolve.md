<!-- Draft: revisited after the generation step and wiring-parts (usage order). -->

# Resolve wiring.md into wiring.json

Resolve only when every part has pins available: built-in parts from the MCP tool `list_parts` (Circuit
Studio's `listParts()`), prepared parts from the `.c3dcomponent` written by `wiring-parts`, stand-ins from the
document's own pin list.

1. **Find the tables by their headers**, whatever their order or extra columns:
   - parts: a *Name* column and a *Part* column;
   - connections: *From* or *Source*, and *To* or *Destination*; the colour is in *Wire*, *Color* or *Colour*;
   - layout (optional): *Name* or *Part*, *X*, *Y*, optional *Rotation*.
2. **Parts.** For each row, record the name, the line number and the kind:
   - `catalog` when *Part* is a built-in `modelId` from `list_parts`;
   - `prepared` when it is a part prepared by `wiring-parts` (`ref` = its identifier, `model` = the source file);
   - `stand-in` when it reads `stand-in W x H x T`: `size` in mm, `pins` from the *Pins* column.
   An unknown part is a question for the user, not a stand-in you invent.
3. **Connections**, in table order (it is the order in which the video connects the wires):
   - the source cell holds one reference, the destination cell one or more, separated by commas;
   - a reference is a part name followed by a pin; text in parentheses is a comment; match the longest part
     name first (`Session gauge` before `Session`);
   - resolve the pin to the part's pin **identifier**, comparing case-insensitively, in this order: identifier,
     label, silkscreen, aliases. The document's own explanations may be used too (for example "terminal *n* of
     the left block is header pin J1-*n*"); say so in your report;
   - keep the reference as written in `text`.
4. **Never guess.** When a part or a pin matches nothing, or matches several pins (two GND terminals, a label
   used twice), ask the user, citing the document line, and propose the likely candidates. Write the answer
   into `wiring.md` (with the user's agreement) so the next resolution does not ask again.
5. **Colours**: black, red, orange, blue, purple, green, brown, yellow, white, or `#rrggbb`. Ask for any other
   name.
6. **Line numbers** are the 1-based lines of the table rows in `wiring.md`.
7. **Hash**: compute the SHA-256 of `wiring.md` with a command (`sha256sum wiring.md`); never write it from
   memory. Compute it after the last change to the document.
8. **Write** `.circuitstudio/wiring.json` (in the project root, created if needed), two-space indent, with
   `"$schema"` pointing to the kit's `wiring.schema.json` and `"version": 1`. Field reference: the schema.

## Check and report

- Validate the file: the CLI `wiring` when available (schema, part and pin cross-references, stale hash); until
  then, validate it against `schema/wiring.schema.json` and check every pin against its part yourself.
- Report in a few lines: number of parts and connections, the pins resolved through aliases or the document's
  explanations, the questions still open, and the next step (`wiring-parts` for missing parts, `wiring-project`
  to build the Circuit Studio project).

## Re-resolution

When `wiring.json` exists and its `source.sha256` no longer matches `wiring.md`, resolve again from the whole
document. Answers the user gave earlier are in the document, so the result is the same for unchanged rows.
