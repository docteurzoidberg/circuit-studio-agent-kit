---
name: wiring-parts
description: Give every part of a validated wiring document (wiring.md) a 3D part that Circuit Studio can show, with its pins named as in the document - a built-in Circuit Studio part, a part converted from a STEP model already in the project and checked with the user on a preview, or a stand-in box. Second step of a wiring video, after wiring-plan. Use when the user wants the 3D parts of their wiring prepared, a STEP model turned into a Circuit Studio part, or a part's pins placed or corrected.
---

# wiring-parts

Second step of a wiring video: `wiring-plan` wrote and validated the wiring document; this skill gives each of
its parts a 3D part that Circuit Studio can show, with its pins named as the document names them. Then
`wiring-project` resolves the document into `wiring.json` and builds the Circuit Studio project, and
`wiring-video` renders it.

**What matters at this step**: each part's pins (where they are, what they are called) and its pose (which way
up it stands: flat on its back, standing with its face towards the viewer). Where the parts sit in the scene is
for `wiring-project`, and the user can rearrange the generated project in Circuit Studio.

Talk to the user in their language. Everything written to files (part specs, the document) is in English.

```text
1 check the document → 2 catalog + survey → (first stop) → 3 prepare the parts → (review) → 4 write back → 5 summary
```

**The command line.** `<kit>` below is the kit's command line. Until its package exists, it is
`node <kit folder>/tools/cli.ts` with Node 22. Run it from the project root: it finds the project's
`.circuitstudio/` folder from the current folder upwards.

| Command | What it does |
|---|---|
| `<kit> part catalog [--from <folder>] [--download]` | Snapshot of the Circuit Studio catalog into `.circuitstudio/catalog.json` |
| `<kit> part inspect <model.step> --json` | Facts about a STEP model: tree, colours, size, contact rows, complexity. Always use `--json`: the text output cuts the contact lists |
| `<kit> part convert <part.yaml> [--json]` | Converts the model as the spec says; writes `<id>.c3dcomponent` and the preview `<id>.png` next to the spec |

The CLI measures and converts; it never guesses. Deciding what a part is, where its pins are and what they are
called is this skill's job, with the user. `inspect` and `convert` take from a few seconds to about 3 minutes
and up to 1.5 GB on a large model: run them in the background, one at a time.

**Never go on the network without asking** (fetching the catalog, searching for a model or a datasheet,
downloading anything): say what you would fetch and from where, and offer to go on without it.

**The user only sees your messages when you stop.** Put everything they must answer or check in as few stops as
possible: the first stop (step 2) and the review (step 3), each one message.

## 1. Check the document

- Find the wiring document (`wiring.md`, or the one the user names). If it still has an **Open points** section,
  or the user has not validated it, say so and ask whether to go on or to finish it with `wiring-plan` first.
- From the *Parts* table, list each part: its *Name*, its *Part* identifier, its *Model* file, its *Note*.
  Rows with the same *Part* identifier are **one part to prepare** (two identical meters), used several times.
- From the *Connections* table, list for each part **the pins the wires use**, as written (text in parentheses
  is a comment: `J1-22 (GND)` is pin `J1-22`). These are the pins the prepared part must answer to.
- Read the document's text too: it often explains the terminal numbering or the mounting.

## 2. Catalog and survey

### Catalog

The catalog is the list of parts Circuit Studio ships, with their pins.

- If `.circuitstudio/catalog.json` exists, run `<kit> part catalog` without options: it refreshes the snapshot from
  the same local checkout, or keeps it. A snapshot that came from a download is used as it is; offer to refresh
  it only if the user wants the latest catalog.
- Otherwise the snapshot needs a source: a local copy of Circuit Studio (a git clone, `--from <folder>`), or
  `--download`, which fetches the sources of `github.com/arslansadiq87/circuit-studio` (network). Ask the user at
  the first stop (below), and say they can also go on without a catalog: every part is then prepared from its
  model or kept as a stand-in. **Do not wait idle for the answer**: the survey and `inspect` need no catalog.
- Parts with `offered: false` exist in Circuit Studio but are not in its add list; they can still be used, say so.

### Survey

For each part to prepare, find what the project has:

- **Model**: the file in the *Model* column, and the notes next to it (README, source notes, images): reference,
  dimensions, pin names, numbering, how it is mounted, origin and licence of the model. Version 1 converts
  **STEP** files (`.step`, `.stp`). For another format (IGES, STL, GLB, a CAD project file), look for a STEP of
  the same part next to it; if there is none, the part is a stand-in for now, and say that other formats are not
  supported yet. Run `<kit> part inspect <model> --json` on every STEP, one after the other, in the background.
- **Catalog** (once the snapshot exists): a built-in part that is the same physical part (same board, same
  module, same pinout). A part that only looks alike is not a match: a bare development board is not that board
  plugged onto a terminal adapter, because the wires land on the adapter's terminals. Note close parts: as
  possible substitutes, and as a source of pin names (a near match's pinout may name the terminals of the real
  part; say so, as an assumption).
- **Stand-in**: the document already reads `stand-in W x H x T` with its pins; or there is neither a catalog
  part nor a usable model.

### First stop

One message, then wait:

1. A table of the parts: the pins the wires use, what was found, and what you propose (catalog part, prepare
   from the model, stand-in). Mention the near matches you rejected and why.
2. The catalog question, if the snapshot needs a source.
3. **Pose** of the parts whose position in the build is not obvious, with your proposal: a panel part (meter,
   socket, fuse holder, display behind a front plate) usually stands with its face towards the viewer and its
   wires leaving behind; a board or a module usually lies flat. Ask once for all of them.
4. **Simplification** of the models `inspect` calls `complexity: complex` (many solids or faces): say why and
   what it changes (lighter part, faster render, small hidden solids dropped), and that you will convert them
   simplified unless the user prefers the full model. Do not offer it for the other models.
5. The questions the notes leave open (pin 1, polarity, a colour that differs from the model), each with your
   proposal.

## 3. Prepare the parts

### Catalog part

- Map every pin the document uses to a pin of the catalog part, comparing case-insensitively with its `id`,
  `label`, `silkscreen` and `aliases`. A name that matches nothing or several pins is a question for the user,
  with the candidates. Catalog pins cannot be renamed: a fix goes into the document (step 4).
- The part's *Part* identifier becomes the catalog `modelId`.

### Part from a STEP model

1. **Write the spec** `.circuitstudio/parts/<id>/part.yaml`, `<id>` being the document's *Part* identifier
   (kebab-case), `step` relative to the spec. Format, orientation and the method to place pins:
   [part-spec.md](part-spec.md). In short:
   - **pins**: at least every pin the document uses, named as the document names them (as label or alias);
     for a header or a terminal block, the whole row. Positions come from the contact rows of `inspect`, checked
     against the notes and the datasheet. A position, numbering or pin order that comes from general knowledge
     rather than the project is an **assumption**: say so.
   - **orientation**: the pose agreed at the first stop.
   - **colours**: only when `inspect` reports one colour or none, or when the real part's colour differs from the
     model's and the user wants it shown.
   - **simplify**: only for a complex model, as agreed at the first stop.
2. **Convert**: `<kit> part convert .circuitstudio/parts/<id>/part.yaml`. It writes the part and its preview PNG
   (top view from above, front view from the front, pins in red with their labels).
3. **Look at the preview yourself first** (read the PNG): every pin on a contact, labels in the right order,
   exit directions outward, the pose agreed. Fix what is wrong and convert again before showing it.

### Stand-in

A stand-in is a plain box with pins, drawn by the project builder from the document alone: no file is written.

- Check that the document gives its size (`stand-in W x H x T`, mm) and its pins, and that every pin the wires
  use is in its list. Propose a size from the datasheet or a typical module when it is missing, as an assumption.
- If a catalog part is a close substitute (a similar module with the same pins), offer it; the user chooses.

### Review

When every part is prepared, **one message**:

- for each prepared part: the preview's full path, its size, its pose, its number of pins, where the pins the
  document uses are, your assumptions, and for a simplified part the solids kept and the file size before and
  after when you know it;
- the catalog parts and stand-ins, with their pin mapping;
- the changes you propose to the document (step 4), shown old and new;
- how to see the parts in Circuit Studio itself, if the user wants to: in Circuit Studio (the hosted site or a
  local copy), *Parts bin*, import button next to *Create component*, then choose the `.c3dcomponent`;
- the request: correct anything in plain words ("pin 1 is at the other end", "the terminals face the other
  way"), part by part, **or say "ok" to validate them all** (or name the parts they validate).

Apply the corrections, convert again, check the preview, and show only what changed. A part is done only on an
explicit "ok"; never take silence or a new topic as one.

## 4. Write back into the document

The document stays the source of truth: the next steps read it, not the skill's notes. Propose all the changes
in one batch (in the review message), and write them only with the user's agreement:

- *Part*: the catalog `modelId`, the prepared part's `<id>`, or `stand-in W x H x T`.
- *Pins* of a stand-in, and pin names in *Connections* that the part cannot answer to (a catalog part whose pin
  is named otherwise). For a prepared part, prefer an alias in `part.yaml` to a change in the document.
- A sentence in the *Note* column, the text or the *Source notes* when a choice needs explaining (the model
  differs from the real part, a substitute stands for it).
- *Checks*: tick what the user confirmed and move it to "Confirmed by the owner"; add new assumptions unticked.

Keep the tables aligned: when a cell grows, pad the column so the Markdown table stays readable. If the user
edited the document meanwhile, read it again first and keep their changes.

## 5. Summary

When every part is done, show a table: each part, how it is provided (catalog `modelId`, prepared in
`.circuitstudio/parts/<id>/`, stand-in), its assumptions, and what remains to check on the real part. Then:

- **Licences** (D24): a prepared part embeds its model. Models from third parties (GrabCAD, a vendor site) are
  often not redistributable: say which parts come from such models, as far as their notes tell, and that
  publishing them is the user's call and responsibility, not the kit's. Never refuse such a model. Check whether
  `.circuitstudio/` or `.circuitstudio/parts/` is ignored by git (`git check-ignore`): if not, it will be
  committed with the project. Ask the user whether to commit the prepared parts, and offer to add
  `.circuitstudio/parts/` to `.gitignore` if they do not want to. Never decide it for them.
- **Next step**: `wiring-project` resolves the document into `.circuitstudio/wiring.json` and builds the Circuit
  Studio project.

## Later versions

Not in this version: searching for a model online, modelling a part from its technical drawings with the CAD
tools on the machine, and converting formats other than STEP. When a part would need one of them, keep it as a
stand-in and say that it can be improved later.
