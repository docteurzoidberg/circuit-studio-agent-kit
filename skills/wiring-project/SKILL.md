---
name: wiring-project
description: Turn a validated wiring document (wiring.md) whose parts are ready into the Circuit Studio project of a wiring video - resolving it into .circuitstudio/wiring.json (every wire end mapped to a real pin of a prepared, built-in or stand-in part), building .circuitstudio/project.c3dproj (parts placed, every wire routed) and reviewing it with the user until they validate it, keeping the edits they make in Circuit Studio. Third step of a wiring video, after wiring-plan and wiring-parts. Use when the user wants their wiring turned into a Circuit Studio project, wants it updated after the wiring document changed, or wants parts of the generated project moved.
---

# wiring-project

Third step of a wiring video: `wiring-plan` wrote and validated the wiring document, `wiring-parts` gave each
of its parts a 3D part with its pins. This skill resolves the document into `.circuitstudio/wiring.json`, the
file the command line builds and renders from without an LLM, builds the Circuit Studio project
`.circuitstudio/project.c3dproj` from it, and reviews the project with the user; `wiring-video` renders it.

```text
1 check the inputs → 2 resolve into wiring.json → (questions) → 3 check → 4 build → 5 review (loop) → 6 report
```

**What matters at this step**: every wire connected to the right pin and routed, parts placed so the wires are
easy to follow. The user can rearrange the project by hand in Circuit Studio; a new build keeps those edits.

Talk to the user in their language. Everything written to files is in English.

**The command line.** `<kit>` below is the kit's command line. Until its package exists, it is
`node <kit folder>/tools/cli.ts` with Node 22. Run it from the project root: it finds the project's
`.circuitstudio/` folder from the current folder upwards.

| Command | What it does |
|---|---|
| `<kit> part pins <part id>...` | Pins of prepared parts (`.circuitstudio/parts/`) and built-in parts (`.circuitstudio/catalog.json`), one line each: identifier, label, silkscreen, aliases |
| `<kit> wiring [--wires] [--json]` | Checks `.circuitstudio/wiring.json`: schema, parts, every pin, and whether the document changed since; exit code 1 and one line per problem, with the document line. `--wires` also lists every wire as written and as resolved |
| `<kit> studio open [--no-browser] [--wait <s>]` | Opens `.circuitstudio/project.c3dproj` in the Circuit Studio page connected to the kit (starting the kit's background process, and opening the link in the user's browser, when needed); run it again after each build to reload. Answers with the link when no page connects in time |
| `<kit> studio sync` / `status` / `stop` | `sync` writes what the user moved or reshaped in the page into the project file; `status` says whether a page is connected and how the kit reaches Circuit Studio; `stop` ends the background process |
| `<kit> build [--move "<part>=x,y[,rotation]"]... [--reset <part>]... [--dry-run] [--from <folder>] [--json]` | Generates `.circuitstudio/project.c3dproj` from `wiring.json` and the parts; places the parts, plans every route with Circuit Studio's planner, keeps the user's edits; exit code 1 when wires stay blocked. `--move` places a part as the user asks (kept like an edit), `--reset` gives a part back to build, `--dry-run` writes nothing |

**The user only sees your messages when you stop.** Ask all your questions in one message.

## 1. Check the inputs

- Find the wiring document (`wiring.md`, or the one the user names). If it still has an **Open points** section,
  or the user has not validated it, say so and ask whether to go on or to finish it with `wiring-plan` first.
- If `.circuitstudio/wiring.json` exists, run `<kit> wiring`. When it reports no problem, the file is up to date
  with the document: run the `part pins` check below anyway (the parts may have changed), then skip to the build
  (step 4) and say so (the pin review of step 3 was done when the file was written). Otherwise resolve again from the whole document
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

## 4. Build

Run `<kit> build` (it checks `wiring.json` first and refuses it while `wiring` reports problems). It prints each
part and how it was placed, then the routes:

- `layout`: from the document's *Layout* table; `automatic`: placed by build, next to the pins its wires come
  from, parts lying flat turned to face them, parts standing up (panel meters) never turned; `moved`: placed as
  the user asked (`--move`); `kept`: where the user put it, in Circuit Studio or with an earlier `--move` (build
  never moves those again, until `--reset`).
- The route planner is Circuit Studio's own, taken from the local checkout the catalog snapshot came from (its
  path ends the routes line). The page plans the routes again when it opens the project, with its own copy of the
  same planner: what the user sees is the page's.
- `routes: N wires, none blocked`: every wire found a route with the planner Circuit Studio itself uses. Blocked
  wires are listed with their document line: the project is written anyway, but a blocked wire is drawn without
  a route in Circuit Studio. Never leave one: propose a move in the review (step 5).

**Errors** to handle:

- *needs a local Circuit Studio checkout*: the route planner comes from Circuit Studio's sources, and the catalog
  snapshot did not come from a local checkout. Ask the user where their checkout is (`--from <folder>`); without
  one, offer to clone `https://github.com/arslansadiq87/circuit-studio` (network: ask first, D15).
- *converted by an older kit*: a prepared part must be converted again (`<kit> part convert` on its `part.yaml`,
  as in `wiring-parts`); say which and do it with the user's agreement.

## 5. Review

The user checks the project loaded in Circuit Studio itself (no preview of the kit replaces it). How it gets
there depends on how the kit reaches Circuit Studio (D23), which `init` set up:

- **Connected**: `<kit> studio status` names a Circuit Studio ("studio is not running" is normal before the first
  `studio open`). The Circuit Studio page connects to the kit and the kit opens the project in it; the user only
  looks and edits, nothing to open or save by hand. The page shows "Driven by Circuit Studio agent kit" in its
  header while the kit drives it.
- **Manual**: `<kit> studio status` says none is configured. Say once that without a
  Circuit Studio that has the kit's bridge on this machine (the kit's fork, until the author's version has it),
  the kit can load the project neither for the review nor for the video: the user opens and saves it themselves.

**Opening it.** Keep this message short: the build's summary (parts and how they were placed, routes), then:

- *Connected*: ask whether to open the project in Circuit Studio (it opens a tab in their browser, or reuses the
  one already connected). On yes, run `<kit> studio open`. When it answers with a link instead (no page connected
  in time), give the user that link (it only works on this machine) and run `<kit> studio open` again once they
  have opened it. Once open, say so in one line and wait for their review: what to look at and how to change
  things go in that same line or the next message, not twice.
- *Manual*: their local copy, or the hosted site `https://arslansadiq87.github.io/circuit-studio/` (everything
  runs in their browser; the file is not uploaded anywhere): **Open**, then `.circuitstudio/project.c3dproj`.

Then, in the same message:

- What to look at: every part there and posed as expected, every wire on the right terminal (the *Connections*
  table lists them), wires easy to follow, nothing overlapping.
- Ways to change it:
  - **in words** ("put the display above the board", "turn the strip"): build with
    `--move "<part name>=x,y[,rotation]"` (the document's part name; mm, top view: x to the right, y away from the
    viewer; degrees around the vertical, counterclockwise seen from above). The build output gives each part's
    current position to start from. Such a move counts as the user's edit and stays.
  - **back to the document's placement or to build's**: `--reset <part name>`. Use it too when a requested move
    only brings a part back to its *Layout* row, so a later change of that row still applies.
  - **in the editor**: they move parts or reshape wires in Circuit Studio. *Connected*: run `<kit> studio sync`,
    which reads them back into the project file and lists them, and show that list; no build is needed, the page
    already shows their edit and plans its routes. Build again only if they also ask for something else, or
    want the routes checked. *Manual*: **Save**, and put the saved file in place of
    `.circuitstudio/project.c3dproj`. Every later build keeps their positions, rotations and wire shapes (and,
    manual way, their camera).
- Changes of wiring (a pin, a colour, a part) go into the document, not the project: then resolve and build again
  (steps 2 to 4).

**Connected: keep the page and the file in step.** Run `<kit> studio sync` before every build and before ending the
review: it writes what the user changed in the page into the project file, where build keeps it. A build without
it would lose those edits, since the reload replaces the page's project. After every build, run `<kit> studio open`
again: the page reloads the new project (no new tab). When the user validates, run `<kit> studio sync` once more;
whether the page stays connected is settled in the report (next step).

**Blocked wires**: try a few moves with `--dry-run` first (nothing is written; a build with blocked wires takes
10 to 15 s): the parts of the blocked wire and their neighbours, a little further out or turned. After about five
tries without a fully routed layout, stop and show the user what you tried and the best result. Propose only a
layout you have built (not dry-run) and seen fully routed, and say which of the user's moves it changes.

After each change asked in words or in the document, build again and show only what changed (placements,
routes). The project is done only on an explicit "ok" from the user; never take silence or a new topic as one.

## 6. Report

In a few lines: the number of parts (by kind: built-in, prepared, stand-in) and of wires, the pins resolved
through a label, an alias or the document's own explanations (grouped by part, so the user can check them:
"Display: CLK P1, DIO P2, VCC P3, GND P4"; when step 2 was skipped, read them from `<kit> wiring --wires`, where
`=` marks a pin found by its label or an alias), the answers written into the document (none when step 2 was
skipped), the project file and its
routes, and what remains:

- **Committing**: `wiring.json` is meant to be committed with the project, since the command line renders from it.
  `project.c3dproj` embeds the prepared parts' models, often derived from third-party files that may not be
  redistributable (as `wiring-parts` said about the parts, in `.circuitstudio/parts/`): publishing them is the
  user's call and responsibility (D24). `build.json` only matters next to the project. Re-rendering the video in
  CI later needs the parts and the project committed. The kit's own `.circuitstudio/.gitignore` already leaves out
  `studio.json` and `studio.log` (the review process). Check what git ignores
  (`git check-ignore -v .circuitstudio/* .circuitstudio/parts`; exit code 1 only means nothing is ignored), say
  what would be committed, and let the user decide; offer to add `.circuitstudio/project.c3dproj`,
  `.circuitstudio/build.json` and `.circuitstudio/parts/` to `.gitignore` if they want to keep them local. Never
  decide it for them.
- **Next step, the video**: offer to go on with `wiring-video`, which renders it (and asks, once per project, how
  the video should look). On yes, keep the page connected (no `studio stop`) and hand over to `wiring-video`: it
  starts from the page as it is. On no, run `<kit> studio stop`; `wiring-video` can be run later.
