# Base-path assets: bundled assets on a project-site base path

Fork branch: `fix/base-path-assets` (commit `b67ea2c`, on top of upstream `47b06b3`).
Opened 2026-11-16: issue https://github.com/arslansadiq87/circuit-studio/issues/1, pull request
https://github.com/arslansadiq87/circuit-studio/pull/2. Texts below are as sent.

## Issue

**Title:** Bundled CAD models return 404 on GitHub Pages (project-site base path)

**Body:**

On the hosted site (https://arslansadiq87.github.io/circuit-studio/), adding any bundled part (for example
ESP32-C6 Supermini) requests `https://arslansadiq87.github.io/models/esp32-c6-supermini.glb`, which returns
404; the part falls back to a simple placeholder. The label font has the same problem
(`/fonts/IBMPlexMono-Regular.ttf`).

The build already sets Vite's `base` to `/circuit-studio/` on GitHub Actions, but model and font URLs are
root-absolute strings (`/models/...` in `src/model.ts` and `src/data/*.json`, `/fonts/...` in
`src/Workspace.tsx`), so they bypass the base.

Steps: open the hosted site, click "ESP32-C6 Supermini" in the parts bin, check the network panel.

Expected: models load from `/circuit-studio/models/...`, as they do when the app is served at `/`.

A small fix is proposed in the linked pull request: resolve these paths against `import.meta.env.BASE_URL`
at request time, keeping saved project references unchanged. Happy to rework it if you prefer another approach.

### Context: why I am looking at this

Thank you for Circuit Studio: the Auto Video generator (automatic camera planning from real CAD bounds and pin
anchors, deterministic timeline, MP4 straight from the browser) is exactly what I was missing to document my
electronics projects.

I am building [circuit-studio-agent-kit](https://github.com/docteurzoidberg/circuit-studio-agent-kit), an
open-source (MIT) set of AI-agent skills, an MCP server and a CLI around Circuit Studio. The idea: a maker keeps
a plain Markdown wiring document in their project (a parts table and a connections table); the agent prepares
the missing 3D parts from STEP files and has Circuit Studio render a wiring video, ready to embed in the
project's README. Circuit Studio stays the editor and the renderer; the kit only feeds it projects and parts.

A feasibility study is done
([results](https://github.com/docteurzoidberg/circuit-studio-agent-kit/blob/main/docs/feasibility-results.md)):
from a real project's wiring document and its STEP models, a local clone of Circuit Studio rendered a correct
1080p wiring video end to end.

To make this work without relying on internal modules, I would like to propose a few small, separate changes,
each discussed in an issue first
([plan](https://github.com/docteurzoidberg/circuit-studio-agent-kit/blob/main/docs/tool-changes-plan.md)):

1. this base-path fix;
2. resolving bundled model references from `modelId` when a saved project lacks them (today the
   `tests/fixtures/crowded-c6-project.json` fixture cannot be exported: "No model asset reference");
3. an optional block in the project file for video settings, shot overrides and saved camera scenes, which now
   live in browser storage;
4. a documented automation API (`window.circuitStudio`: open a project, list parts and pins, render an image or
   a video) available in production builds.

I will follow your code style and keep each PR focused. If you would rather shape any of these differently, or
not have some of them at all, I am happy to adapt. A few other issues found along the way are listed
[here](https://github.com/docteurzoidberg/circuit-studio-agent-kit/blob/main/docs/upstream-bugs.md); I can open
them separately if useful.

## Pull request

**Title:** Resolve bundled model and font URLs against the Vite base

**Body:**

Fixes #1.

Bundled CAD models and the label font were requested from root-absolute paths, so a project-site deployment
(GitHub Pages under `/circuit-studio/`) returned 404 for every model.

Changes:
- `src/publicUrl.ts`: `publicUrl(path)` prefixes root-absolute paths with the deployment base; absolute,
  protocol-relative, `blob:` and `data:` URLs are left unchanged.
- `src/assets.ts`: model requests go through `publicUrl()`; the IndexedDB URL index keeps the original
  `/models/...` key, so saved projects and packages stay portable between hosts.
- `src/Workspace.tsx`: label `<Text>` components use the resolved font URL.
- `DEPLOY.md`: one sentence on how subpath deployments resolve assets.
- `tests/public-url.test.ts`: 4 unit tests.

Verification:
- `npx tsc -b` passes; the 4 new tests pass.
- Built with `GITHUB_ACTIONS=1 GITHUB_REPOSITORY=x/circuit-studio`, served by `vite preview` under
  `/circuit-studio/`, browser cache cleared: `/circuit-studio/models/esp32-c6-supermini.glb` and
  `/circuit-studio/fonts/IBMPlexMono-Regular.ttf` both return 200 and the real CAD model renders.
- `npm run test` reports 36 failing tests, the same 36 as on `main` without this change (they assume the
  editor starts with the starter circuit); this PR does not touch them.

Reproduce locally (Node 22):

```bash
npm ci
npx tsc -b && npx vitest run tests/public-url.test.ts
GITHUB_ACTIONS=1 GITHUB_REPOSITORY=x/circuit-studio npm run build
GITHUB_ACTIONS=1 GITHUB_REPOSITORY=x/circuit-studio npx vite preview --port 4173
# open http://localhost:4173/circuit-studio/, add "ESP32-C6 Supermini":
# /circuit-studio/models/esp32-c6-supermini.glb and /circuit-studio/fonts/IBMPlexMono-Regular.ttf return 200
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
