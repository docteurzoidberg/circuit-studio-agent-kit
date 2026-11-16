---
name: wiring-project
description: Turn a validated wiring document (wiring.md) whose parts are ready into the Circuit Studio project of a wiring video - first resolving it into .circuitstudio/wiring.json (every wire end mapped to a real pin of a prepared, built-in or stand-in part), then building the project. Third step of a wiring video, after wiring-plan and wiring-parts. Use when the user wants their wiring turned into a Circuit Studio project or a wiring.json, or wants it updated after the wiring document changed.
---

# wiring-project

Third step of a wiring video: `wiring-plan` wrote and validated the wiring document, `wiring-parts` gave each
of its parts a 3D part with its pins. This skill resolves the document into `.circuitstudio/wiring.json`, the
file the command line builds and renders from without an LLM, then builds the Circuit Studio project, which
`wiring-video` renders.

```text
1 check the inputs → 2 resolve into wiring.json → (questions) → 3 check → 4 report → [5 build the project: later]
```

**This version stops after `wiring.json`.** Building the Circuit Studio project (`<kit> build`: placement, wire
routes, camera, presentation texts, review with the user) comes in a later version: say so in the report.

Talk to the user in their language. Everything written to files is in English.

**The command line.** `<kit>` below is the kit's command line. Until its package exists, it is
`node <kit folder>/tools/cli.ts` with Node 22. Run it from the project root: it finds the project's
`.circuitstudio/` folder from the current folder upwards.

| Command | What it does |
|---|---|
| `<kit> part pins <part id>...` | Pins of prepared parts (`.circuitstudio/parts/`) and built-in parts (`.circuitstudio/catalog.json`), one line each: identifier, label, silkscreen, aliases |
| `<kit> wiring [--wires] [--json]` | Checks `.circuitstudio/wiring.json`: schema, parts, every pin, and whether the document changed since; exit code 1 and one line per problem, with the document line. `--wires` also lists every wire as written and as resolved |

**The user only sees your messages when you stop.** Ask all your questions in one message.

## 1. Check the inputs

- Find the wiring document (`wiring.md`, or the one the user names). If it still has an **Open points** section,
  or the user has not validated it, say so and ask whether to go on or to finish it with `wiring-plan` first.
- If `.circuitstudio/wiring.json` exists, run `<kit> wiring`. When it reports no problem, the file is up to date
  with the document: skip to the report (step 4) and say so. Otherwise resolve again from the whole document
  (step 2): the answers the user gave earlier are in the document, so unchanged rows give the same result.
- Run `<kit> part pins` with every *Part* identifier of the document that is not a stand-in, once. An identifier
  it does not find is a part `wiring-parts` has not prepared yet: stop and offer to run `wiring-parts` first.
  Never invent a part or turn it into a stand-in yourself.

## 2. Resolve into wiring.json

Follow [resolve.md](resolve.md): it maps every part and every wire end of the document to a part and a pin
identifier, asks the user where the document is ambiguous, and writes the file.

## 3. Check

Run `<kit> wiring --wires` and fix what it reports until it reports no problem. A pin "not a pin of" a part, with a
hint, is a resolution mistake: write the pin's identifier. Without a hint, the document names a pin the part
does not have: it is a question for the user (step 2 of resolve.md), not something to fix by guessing.

The command only knows that a pin exists, not that it is the right one: read the `--wires` list against the
document (each reference as written, the pin it became and that pin's label) and fix any wire whose label does
not fit what the document says.

## 4. Report

In a few lines: the number of parts (by kind: built-in, prepared, stand-in) and of wires, the pins resolved
through a label, an alias or the document's own explanations (grouped by part, so the user can check them:
"Display: CLK P1, DIO P2, VCC P3, GND P4"), the answers written into the document, and what remains:

- **Committing**: `wiring.json` is meant to be committed with the project, since the command line renders from it.
  If git ignores it (`git check-ignore .circuitstudio/wiring.json`), say so and let the user decide.
- **Next step**: building the Circuit Studio project, in a later version of this skill.
