# Built-in model fallback for reference-free geometries (follow-up to #3)

> **Not published yet.** Fork branch `fix/built-in-model-fallback` (one commit, `a2ef47a`, on upstream `1713780`;
> local until published). Bug proven on the deployed site and fix tested on 2026-11-16 (bug 6 in
> [../upstream-bugs.md](../upstream-bugs.md)). Plan: a short comment on the closed issue #3 pointing at a new pull
> request; the maintainer merges it or fixes it his own way.

## Comment on #3

Thanks again for 1713780. One case still slips through, on the deployed site (build of 1713780):

1. Open https://arslansadiq87.github.io/circuit-studio/ after clearing the site data.
2. Open `tests/fixtures/crowded-c6-project.json` from this repository.
3. The ESP32-C6, both 24BYJ-48, the LDR and the resistor show "Model unavailable: Model asset is unavailable",
   and exporting a video (Final Circuit Orbit) stops with "Model asset is unavailable". An ESP32-C6 added from
   the parts bin in the same page renders, and having its model already stored does not change the result.

These components have a `geometry` of kind `model` without `modelUrl`, `lodUrls` or `modelAssetId`, and
`modelUrl()` falls back to the built-in geometry only when `geometry` is missing; the existing test checks that
case only. I opened #<pr> with a fix and a test on the fixture's real geometry; feel free to merge it or to fix it
your own way.

## Pull request

**Title:** Fall back to the built-in model when a saved geometry has no model reference

**Body:**

Follow-up to #3.

`modelUrl()` uses the built-in geometry only when a component has no `geometry` at all. Components saved with a
`geometry` of kind `model` but without `modelUrl`, `lodUrls` or `modelAssetId` (the parts of
`tests/fixtures/crowded-c6-project.json`) fall through to the built-in `modelAssetId`, which `getPartBlob()` does
not find in the parts library: on the deployed site (build of 1713780), opening that fixture shows "Model
unavailable" on five parts, and exporting a video stops with "Model asset is unavailable".

Changes:

- `src/modelCache.ts`: such a geometry resolves through the built-in model; components with their own model
  reference are unchanged.
- `tests/model-cache.test.ts`: a test on the fixture's real geometry (the existing test passes `geometry:
  undefined`). It fails before the change ("expected undefined to be '/models/esp32-c6-supermini.glb'") and
  passes after.

Verification:

- `npx tsc -b` passes; `npx vitest run` shows the same 35 unrelated failures as on `main`, and one more passing
  test.
- Production build with the GitHub Pages base (`GITHUB_ACTIONS=true GITHUB_REPOSITORY=arslansadiq87/circuit-studio
  npm run build`, `npx vite preview --base /circuit-studio/`), new browser storage, the fixture opened with
  **Open**: every model renders; the Auto Video preview builds (93 s); a Final Circuit Orbit export produces an
  MP4 checked with `ffprobe` (H.264, 1920 × 1080, 30 fps, 187 frames) with every model visible. The same export
  on the deployed site stops with "Model asset is unavailable".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
