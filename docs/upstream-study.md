# Upstream integration study — Circuit Studio 3D

Studied on 2026-11-16 at fork commit `47b06b3` (docteurzoidberg/circuit-studio, fork of arslansadiq87/circuit-studio).

## Identity

| Item | Value |
|---|---|
| Upstream | https://github.com/arslansadiq87/circuit-studio (MIT, 12 stars, 5 forks, created 2026-11-15, 4 commits) |
| Fork | https://github.com/docteurzoidberg/circuit-studio |
| Stack | Browser-only SPA: React 19, TypeScript, Vite 8, Three.js 0.186, React Three Fiber, Drei, Zustand, Zod 4 |
| Video | WebCodecs + Mediabunny (H.264 MP4, VP9 WebM, PNG-sequence ZIP); no backend, no ffmpeg in the app |
| Tests | Vitest (Node, fake-indexeddb) + Playwright scripts in `scripts/e2e-*.mjs` against the Vite dev server |
| Deploy | GitHub Pages workflow (`.github/workflows/deploy.yml`), build only, no test job |
| Code style | Dense single-line TypeScript, development organised in "sprints" documented under `docs/` |

The project is two days old and moves fast: any integration must pin a commit and keep its adapter thin.

## What already exists (no upstream change needed)

- **Auto Video** (`src/cinematic.ts`, `src/videoExport.ts`): automatic camera planning from CAD bounds and pin
  anchors, a deterministic seekable timeline (frame N evaluated at N/FPS), saved wire order, HUD captions,
  backgrounds, 1080p/1440p/4K, 24/30/60 FPS. Modes: `tutorial`, `all`, `sequential`, `selected`, `orbit`.
- **Programmatic entry point**: `exportCinematic(project, settings, selectedIds, onProgress)` returns the encoded
  blob. The upstream E2E script already calls it from Playwright through
  `page.evaluate(() => import('/src/videoExport.ts'))`, which only works against the dev server.
- **Project format** `.c3dproj` (JSON, `ProjectSchema` v1 in `src/model.ts`) and `.c3dzip` (ZIP v2 with
  content-addressed assets). Wires reference stable `componentId` + `pinId`; components embed their full pin
  table, transform and geometry metadata.
- **Built-in parts**: YD-ESP32-S3 v34, ESP32-WROOM (38 pins), ESP32 30-pin, ESP32-C3 Zero, ESP32-C6 Supermini,
  3 mm LED, resistor, LDR, 28BYJ-48 stepper, DRV8825, Sonoff CAM S3W, USB-A breakout, external 5 V supply.
- **Custom parts**: `.c3dcomponent` (GLB/glTF/OBJ/STL + pin table), STEP to GLB pipeline with CadQuery
  (`scripts/convert_step_to_glb.py`).
- **Helpers usable from Node**: `placeComponent`, `planAutoWires`, `generateCircuitDiagram` (2D schematic),
  `generateBlockDiagram`, `migrateProject`; the Vitest suite already imports them outside the browser.

## Gaps for unattended rendering

| Gap | Impact | Fix location |
|---|---|---|
| No stable automation API; the hook is a dev-server import plus `window.__circuitExportState` | Breaks on the production build and on refactors | Upstream PR |
| Video settings live in browser `localStorage` (`c3d-video-preset-v1`), not in the project | A CI render cannot reproduce a chosen look from the repository alone | Upstream PR (embed optional settings in the project) |
| No way to open a project or start a render from the URL or the command line | Needs browser scripting for every step | Upstream PR, or our runner |
| Writing a `.c3dproj` by hand means copying full pin tables and coordinates | Too heavy for a human or an LLM to author directly | Compact spec + compiler (ours first, adapter upstream later) |
| No import adapters (KiCad, Wokwi, CSV are listed as missing in `docs/IMPORT_EXPORT.md`) | No path from existing schematics | Upstream PR candidates, aligned with their roadmap |
| Video acceptance targets Windows Chrome with ANGLE D3D11 | Linux CI behaviour unknown | Spike, then upstream PR for a Linux test path |

## Reference project case study

The [Claudemètre](https://github.com/docteurzoidberg/claudemetre) (ESP32-S3 desk gauge with ESPHome firmware) was read to check the approach against existing
documentation. Its parts: ESP32-S3-DevKitC-1 plugged onto an MRD076A screw-terminal board, two SO-45 analog
voltmeters, a TM1637 4-digit display, a 4-LED WS2812B strip, a 1N400x diode in series on 5 V, a 5 V supply,
a panel fuse holder and an LP-16 connector.

Findings:

- **Wiring is described in three unlinked places**: a hand-written HTML wiring page (SVG schematic + wire table
  with columns *Wire / Pin / To / Note*), the specification (pin list), and the firmware YAML (GPIO numbers).
  The wiring page was already out of date with the hardware.
- **The wire table is almost machine-readable as is**, which supports a structured Markdown source rather than
  a strict YAML file.
- **Catalog coverage is low**: only a generic 5 V supply matches directly. The ESP32-S3-DevKitC-1 is retired
  from the parts bin (the YD-ESP32-S3 clone is close but its pinout must be checked); the terminal board,
  voltmeters, display module, LED strip, diode, fuse holder and connector are missing.
- **Topologies to support**: a board plugged onto a carrier (wires land on the carrier's terminals), an inline
  part (diode between supply and strip), and a shared ground net with four endpoints.
- Circuit Studio pins already carry `silkscreen` and `aliases`, which can resolve human pin spellings
  (`GPIO4`, `5V0`, `CLK`).

## Rendering constraints to verify (spike)

Decision: rendering runs locally in a real Chrome with a GPU (see PLAN.md, D1), which is the upstream video
acceptance environment. The points below remain relevant for other setups.

1. **H.264 encoding** needs branded Chrome (`channel: 'chrome'`); Playwright's bundled Chromium lacks proprietary
   codecs. Whether WebCodecs AVC encoding works in headless Chrome on Linux has to be measured.
   Fallback: VP9 WebM or PNG frames, then ffmpeg to MP4.
2. **No GPU on hosted CI runners**: WebGL falls back to SwiftShader (software). Upstream reports it is
   "substantially slower"; render time for a 20 s 1080p tutorial must be measured.
3. **Assets**: built-in models are fetched by URL (`/models/*.glb`), so the app must be served (dev server,
   `vite preview` or the hosted Pages site) during rendering.
4. **Local option**: on the user's Windows host, Chrome with a real GPU can be driven from WSL (existing
   `navigateurs-windows` setup), which should be much faster than SwiftShader.

## Access modes for the skills

| | Hosted site (arslansadiq87.github.io/circuit-studio) | Local clone + Vite dev server | Pinned build bundled in our package |
|---|---|---|---|
| How it is driven | UI automation: Open, file upload, settings, Auto Video, download | Direct calls to internal modules (`useEditor.getState().loadProject`, `exportCinematic`), as the upstream E2E does | Documented automation API (to be added) |
| Upstream change needed | None | None | Yes: automation API |
| Stability | Low: UI labels and deployments change without notice, no version pinning | Medium: pinned commit, but internal module paths | High: pinned build, documented contract |
| Offline | No | Yes | Yes |
| User setup | None | Clone, `npm install`, running server | None (MIT license allows bundling) |
| Privacy | Loads Google Tag Manager | No tracking | Tracking can be stripped |

Decision: dev server for the spike, pinned build with an automation API as the target (PLAN.md, D9).

## Required versus optional upstream changes

Required for durable use:

1. **Automation API in production builds** (`window.circuitStudio`): load a project, list parts, render a PNG,
   render a video, report progress.
2. **Video settings, shot overrides and saved camera scenes stored in the project**: today they live in browser
   storage, so edits made in the editor would be lost on the next unattended render.

Optional, with a workaround on our side:

| Change | Workaround |
|---|---|
| Open a project from a URL parameter | Load through the API |
| Custom parts without the browser library | Embed models in a `.c3dproj` v1 (`assets`) |
| Automatic layout of arbitrary parts | Our builder places parts; the user refines in the editor |
| ESP32-S3-DevKitC-1 removed from the parts bin | Custom part, or YD-ESP32-S3 if its pinout matches |
| WebP/GIF output | ffmpeg in our CLI |

No change needed: the video engine, stable pin references with `aliases` and `silkscreen`, shared nets, inline
parts and carrier boards (plain parts with pins).

## Upstream contribution candidates

Ordered by value for automation and by fit with the upstream roadmap.

1. **Automation API** — a documented `window.circuitStudio` object (load project, list parts, render PNG,
   render video, report progress) available in production builds.
2. **Video settings in the project** — optional `video` block in the project schema, used as the default when
   present.
3. **URL parameters** — `?project=<url>&render=video&preset=...` for scripted or shareable renders.
4. **Compact wiring import** — a small netlist-style format (parts by catalog ID, wires by pin label) expanded
   with the existing placement and auto-routing helpers.
5. **Import adapters** — KiCad netlist, Wokwi `diagram.json`.
6. **Linux CI test path** — SwiftShader video acceptance and a test job in the existing workflow.

Each one starts as an issue upstream before any PR.
