# Automation API (F1): a documented scripting API on `window.circuitStudio`

> **Not published yet.** Fork branch
> [`feat/automation-api`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/automation-api) (one commit,
> `8f4db3d` and two local `fixup!` commits, on top of the presentation commit `6e4d7f2` proposed in #6; 7 tests).
>
> **Before publishing:**
>
> 1. Wait for #6 to be settled, then rebase on what lands: if the maintainer merges #6, rebase on `main`; if he
>    implements the presentation block his own way, adapt `resolveVideoSettings()` to his block (or drop that
>    part if there is none).
> 2. Squash the local `fixup!` commits into the API commit (`65a135c`: projectFiles loaded on demand, found by the
>    end-to-end check below; `1ba2a91`: `planRoutes()`, added on 2026-11-16 for the kit's project builder), then
>    push the fork branch.
> 3. Fill in the issue and pull request numbers.
>
> **End-to-end check done on 2026-11-16** (fork `8f4db3d` + `65a135c`, `npm run build && npx vite preview`, Chrome
> driven through the DevTools protocol, fresh profile): see the verification section of the pull request. It also
> showed a bug when opening the repository's own fixture (bug 6 in [../upstream-bugs.md](../upstream-bugs.md),
> since proposed as #7); the check worked around it by completing the fixture's part geometry from the parts bin.
> `planRoutes()` was checked the same way afterwards (fork `1ba2a91`).
>
> Issue and pull request are published together, as for #5 and #6: the maintainer merges or implements his way.

## Issue

**Title:** A documented scripting API to open projects and render images or videos

**Body:**

Circuit Studio can only be scripted through its internal modules: a browser automation script (Playwright,
Puppeteer, Chrome DevTools Protocol) has to run the Vite dev server and import `/src/videoExport.ts`,
`/src/store.ts` and friends, which a production build does not expose and which change with any refactor. The
only thing reachable in a build is `window.__circuitExportState` (the raw three.js scene).

So today a script cannot, on the hosted site or a `vite preview` build:

- open a project file and know when its wire routes and models are ready;
- list the available parts and their pins (to map a wiring list to pin IDs);
- render a PNG of the current view or an Auto Video export, and get the file back instead of a download;
- check a generated layout: whether every wire finds a route, before opening the project.

Expected: a small, documented and versioned object, for example `window.circuitStudio`, that wraps what the
interface already does, in development and production builds.

A change is proposed in the linked pull request (one commit, 7 tests, a `docs/AUTOMATION_API.md` page with a
Playwright example). It builds on #6 (the project's stored video settings); I will rebase it on whatever lands
there. Feel free to merge it, or to implement this your own way as you did for #1 and #3, whichever suits you.

### Context: why I am looking at this

This is the last of the small changes announced in #1. My kit
([circuit-studio-agent-kit](https://github.com/docteurzoidberg/circuit-studio-agent-kit)) turns a project's
Markdown wiring document into a Circuit Studio project and has Circuit Studio render the wiring video, so a
maker can re-render it when the wiring changes, from a git hook or a CI job, without opening the editor.

What a stable API changes for such tools:

- **No local clone, no dev server.** A script drives the hosted site or any build through `window.circuitStudio`,
  instead of importing internal modules from a Vite dev server, so users need neither a clone nor an
  `npm install` of Circuit Studio.
- **The catalog without the sources.** `listParts()` gives the built-in parts and their pins from the app itself.
  Without it, my kit reads `src/model.ts` and `src/store.ts` from a checkout or a download of this repository and
  compiles them with esbuild; any refactor here breaks that.
- **Layouts that route.** `planRoutes()` runs the workspace's route planner on a project without opening it, so
  a tool that places parts can check that no wire is blocked, and move parts until none is, with the planner
  the app will use.
- **Reproducible renders.** `renderVideo()` uses the defaults, then the project's stored settings (#6), then the
  caller's: never the browser's local preset, so the same project renders the same way on any machine.
- **A contract you control.** The API is versioned (`version: 1`) and documented; internals stay free to change.

Questions where your preference matters:

1. always available, or opt-in (for example `?automation=1` in the URL);
2. the name `window.circuitStudio` and the shape of the methods;
3. whether `listParts()` should include the parts of the local library, as it does now, or only built-in ones.

## Pull request

**Title:** Add a documented automation API on window.circuitStudio

**Body:**

Fixes #<issue>. Builds on #6.

Scripts could only reach internal modules through the Vite dev server; production builds exposed nothing but
the raw scene.

`window.circuitStudio` (version 1), installed in development and production builds:

- `openProject(data)`: a project object, its JSON text, or a `.c3dproj` / `.c3dzip` `Blob`, through the same path
  as **Open** (validation, migrations, embedded assets); resolves once wire routes are computed and the scene has
  stopped changing;
- `getProject()`: the current project, without embedded assets;
- `listParts()`: built-in and library parts with `modelId`, `name`, `source`, `dimensions` and their pins
  (`id`, `label`, `silkscreen`, `aliases`, `functions`, `electrical`);
- `capabilities(settings?)`: MP4, WebM and PNG support of the browser for these settings;
- `renderImage({width, height, transparent})`: a PNG of the current view;
- `renderVideo(settings?, {selected, onProgress, signal})`: the Auto Video export in memory (`blob`, `filename`,
  `mimeType`, `frames`, `duration`, `warnings`). Settings are the defaults, then the project's stored settings
  (#6), then the given ones; the local preset is not used, so renders are reproducible;
- `planRoutes(data?)`: the wire routes of a project (object or JSON text; the current project when omitted),
  computed by the workspace's planner in the routing worker, without opening the project or loading models:
  each wire's `blocked` flag and route `points`, and the list of blocked wires.

Changes:

- `src/automation.ts` (new): the API, `listAutomationParts()`, `resolveVideoSettings()`, `planProjectRoutes()`; it
  loads `projectFiles` on demand, as the app does.
- `src/main.tsx`: installs the API.
- `src/Workspace.tsx`: `renderScenePng()` split out of `exportScenePng()` (which still downloads), and
  `wireRoutesReady()` so scripts can wait for the routing worker.
- `docs/AUTOMATION_API.md` (new), linked from the README: reference and a Playwright example.
- `tests/automation-api.test.ts`: 7 tests (version, built-in parts with pins, settings from defaults, from the
  project then overrides, sanitized overrides, routes of the fixture, a blocked wire).

Verification:

- `npx tsc -b` passes; the 7 new tests pass; `npx vitest run` shows the same 35 unrelated failures as on `main`.
- End to end on a production build (`npm run build && npx vite preview`), driven from outside through the Chrome
  DevTools protocol in a fresh profile, with `tests/fixtures/crowded-c6-project.json` (8 parts, 28 wires):
  `openProject` accepts the object, its JSON text and a `Blob`, and resolves once the models and the 28 routes
  are in place (10 s); `listParts()` returns the 12 built-in parts with their pins; `capabilities()` reports MP4,
  WebM and PNG; `renderImage()` returns a PNG; `renderVideo({mode: 'orbit', fps: 24})` returns an MP4 checked
  with `ffprobe`: H.264, 1920 × 1080, 24 fps, 90 frames, 3.75 s, every model and wire visible.
- `planRoutes()` on the same build: the fixture's 28 wires all routed with their points (10.4 s, in the worker);
  a large part laid over a wire's source part makes that wire `blocked` (38 ms); without argument it plans the
  current project; an invalid project is rejected with the schema error; the current project is left unchanged.
- `npm run build` adds no warning (a static import of `projectFiles` was made dynamic for that).

Reproduce locally (Node 22):

```bash
npm ci
npx tsc -b && npx vitest run tests/automation-api.test.ts
npm run build && npx vite preview
# in the browser console: await circuitStudio.ready; (await circuitStudio.listParts()).length
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
