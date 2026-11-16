# Feasibility results (phase 2)

Run on 2026-11-16. Circuit Studio 3D at `47b06b3` (upstream and fork identical). Rendering in the Windows Chrome
157 (dedicated profile, CDP port 9223) driven from WSL; GPU: AMD Radeon integrated graphics, ANGLE D3D11.
Node 22 through nvm, dependencies installed locally in `circuit-studio/fork`.

## Verdict

| Question | Answer |
|---|---|
| Can the hosted site be used as is? | **No.** Bundled CAD models return 404 on GitHub Pages (bug 1), no programmatic access, analytics on every visit. |
| Does a local clone solve it? | **Yes, for prototyping.** With the Vite dev server, internal modules can be called directly: a project is loaded and an MP4 rendered without touching the UI. |
| Is the local clone enough for a durable tool? | **No.** The production build exposes no API (test C), and the dev-server path depends on internal module names. |
| Is the overall approach feasible? | **Yes.** A wire table written by a human, with pins named by their labels, produced a correct 1080p MP4 end to end (test B). |

## Tests

| Test | Setup | Result |
|---|---|---|
| O1–O5 | Hosted site, UI and page scripting | Page and WebCodecs work (H.264 and VP9 supported). Project can be opened by scripting the Open file input. All CAD models 404; upstream fixture stays on "Loading 3D workspace…". |
| A | Dev server, upstream fixture `crowded-c6-project.json` (8 parts, 28 wires), default settings | MP4 H.264 High, 1920×1080, 30 fps, 93.0 s, 2791 frames, 45 MB. Render 25.4 s (3.7× real time) + 25 s CAD preparation. Required restoring catalog model references first (bug 6). |
| B | Dev server, project built from the reference project's wire table (DevKitC-1 + 5 procedural stand-ins, 12 wires, pins resolved by label) | MP4 1080p30, 43.4 s, 27 MB, rendered in 10.5 s (13 s total). Schema, migrations and connection validation accepted the generated project. Stand-in parts are unlabelled boxes without visible contacts. |
| C | Production build served by `vite preview` | Internal modules unavailable (`Failed to fetch dynamically imported module`); only `__circuitExportState` (raw scene) is global. Models load correctly when served at `/`. |
| D | ffmpeg conversion of test B | Animated WebP 800 px / 12 fps: 1.1 MB. GIF 640 px / 10 fps / 128 colours: 4.4 MB. Poster PNG: 0.2 MB. About 4.5 s each. |

| E | Dev server, **real wiring of the reference project**: study copy of its wiring document in the proposed Markdown format (`spike/reference-project/wiring.md`), parsed in the page; 5 parts converted from the project's STEP files (terminal adapter with the ESP32 plugged in, SO-45 ×2, TM1637, LP-16, fuse holder) + 3 stand-ins (strip, diode, Mini360) | 9 parts, 17 wires, every pin resolved (labels, ids, `5V0` alias, explicit GND terminals). Project accepted with embedded GLB assets. First render: 58.9 s video in **285 s** (about 15× slower than test B: about 25 MB of detailed meshes). After restoring the adapter's colours (888 separately coloured solids, 19 MB GLB): **363 s**. Output readable: real parts, wires landing on the right terminals; weak points are black wires on the dark background, the gauges' orientation and the sparse automatic overview. |

| F | Same as E with **simplified models** (user-side preparation emulated by `spike/simplify_steps.py`: adapter solids under 1 mm³ dropped, solids merged per colour, colours written into the STEP; coarser tessellation 0.25 mm / 0.7 rad) | Total 580 k → 281 k triangles, 905 → 10 meshes (adapter: 888 → 6 meshes, 407 k → 163 k triangles). Render **202 s** instead of 363 s (1.8× faster), visually equivalent. Still about 3.4× slower than real time: further decimation or profiling needed. Merging per colour loses face-level colours (dials, digits), so only parts without real colours are merged. |
| G | Wire routing: same project as E/F, top view, wires in `auto` mode (what E/F used) versus `clean` mode (what the upstream examples use, e.g. all 28 wires of `crowded-c6-project.json`) | E/F wires looked chaotic because our generator left `routeMode` unset, so Circuit Studio used `auto` (free splines crossing the board). With `routeMode: "clean"` the same wires leave the terminals horizontally and follow orthogonal parallel lanes. Generator fix: `clean` by default. Remaining quality depends on the part layout (automatic layout, phase 5). |
Scripts: `spike/start-export.js` (test A), `spike/build-claudemetre.js` (test B), `spike/make-open.py`
(Open-input injection). Outputs (not versioned): `spike/output/`.

## Findings that shape the plan

- **Rendering cost is low**: real-GPU rendering runs several times faster than real time; a typical wiring video
  takes seconds to a minute. Local rendering (D1) is confirmed.
- **Video transfer**: the encoded blob is returned from the page as base64 through CDP; fine up to tens of MB.
  An API should stream the file instead.
- **Projects must go through the import path** (`importLegacy` / `openProject`), not `loadProject` directly,
  to get migrations and validation.
- **Pin resolution by human label works** with the existing `label`, `silkscreen`, `aliases` fields.
- **The ESP32-S3-DevKitC-1** still exists in the code (`DEVKIT_COMPONENT`, procedural) although hidden from the
  parts bin.
- **Readability of missing parts is the main quality gap**: procedural stand-ins need a visible name and contacts.
- The automatic camera produced no occlusion warnings on either project; manual layout was used for test B.
- **STEP to part pipeline works** (`spike/prepare_parts.py`, CadQuery 2.8.0 as upstream): the GLB keeps the STEP
  axes in mm, Circuit Studio places it with `modelCenter` + `modelOrientation` + calibrated `dimensions`, and
  contacts are measured from the geometry (44 screw terminals found from their screws, 3.5 mm pitch verified).
- **STEP colours are not reliable**: the terminal adapter's STEP has one default SolidWorks colour on all 626
  solids. Colours had to be restored by rules (sub-assembly name + body size), the same rules as the reference
  project's mock-up. The parts skill needs a colour-rule step.
- **Mesh weight drives render time**: detailed STEP-derived meshes made rendering about 15× slower. Parts need a
  decimated level of detail before rendering.
- **Black wires are hard to see** on the default dark background; wire colour versus background needs a rule
  (outline, lighter background, or a colour remap for the video).
- **Undocumented wiring facts** (which GND terminal, where the diode sits, the power input chain) were missing
  from the original document; the study copy shows the Markdown format can carry them without strain.

## Proposed changes to Circuit Studio

Bugs are listed in [upstream-bugs.md](upstream-bugs.md). Feature proposals, reviewed one by one with the user on
2026-11-16:

| # | Feature | Decision |
|---|---|---|
| F1 | **Automation API** in production builds (`window.circuitStudio`): open a project (same import path as Open), list catalog parts with their pins, render PNG, render video with progress and cancellation, return or stream the bytes, report capabilities | **Validated** (required) |
| F2 | **Video settings, shot overrides and saved camera scenes in the project** (optional block) | **Validated** (required) |
| F4 | **Built-in model references resolved from `modelId`** when a saved project lacks them (fixes bug 6) | **Validated** |
| F3 | Readable procedural stand-in parts (body label, visible contacts, simple shapes) | Dropped: missing parts are provided or created by the user; our converter can emit a simple labelled block if needed |
| F5 | More pin aliases on built-in boards | Replaced by a skill feature: query the tool (F1 part listing) for each model's pins and map them into the user's wiring document, or write the document with the right pin names |
| F6 | URL parameters to open a project and start a render | Dropped: redundant with F1 |
| F7 | ESP32-S3-DevKitC-1 back in the parts bin | Rejected for now: too many boards to cover; a missing board is provided or created by the user |
| F8 | Equivalent pins chosen by proximity | Not a tool feature: the user writes the exact terminal in the wiring document; `wiring-plan` can suggest it |
| F9 | Automatic LOD for imported models | Not a tool feature: models are simplified by the user beforehand; `wiring-parts` warns early |
| F10 | Direct STEP import in the editor | Replaced by **our converter** (STEP to `.c3dcomponent`, see below); an upstream PR stays possible later |

## Models in Circuit Studio and the planned converter

| Use | Format |
|---|---|
| Bundled parts | GLB, three LOD files (`-low`, `-medium`, `-high`) made offline from STEP with CadQuery and `optimize:cad` |
| Parts imported in the editor | GLB, glTF, OBJ or STL, then manual calibration (dimensions, orientation, pins) |
| Portable part | `.c3dcomponent`: JSON part definition (dimensions, orientation, pins with position, aliases and wire exit) with the GLB embedded as base64 |
| Project | `.c3dproj` (JSON, embedded models) or `.c3dzip` (archive) |

The converter, in our package: STEP in, `.c3dcomponent` out, in one pass: simplification, colours (rules when
the STEP has none), contact measurement, light GLB. `spike/prepare_parts.py` already does everything but the
final file.
