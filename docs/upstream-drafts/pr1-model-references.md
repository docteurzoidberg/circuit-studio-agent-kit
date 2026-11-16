# Draft — PR 1 (F4): built-in model references from `modelId`

Fork branch: `fix/model-reference-from-catalog` (commit `424a03e`, on top of upstream `47b06b3`; independent of
PR 0). Not opened yet.

## Issue

**Title:** Video export fails with "No model asset reference" for saved built-in parts

**Body:**

Opening `tests/fixtures/crowded-c6-project.json` and running Auto Video fails with
`Error: No model asset reference`.

The fixture stores built-in parts (ESP32-C6 Supermini, 24BYJ-48 steppers, LDR, resistor) with
`geometry: {kind: "model"}` only: no `modelUrl`, `lodUrls` or `modelAssetId`. `modelResource()` in
`src/modelCache.ts` then has nothing to load, and the editor has no model centre or orientation for these
parts. Only `yd-esp32-s3-v34` has a fallback (`cadLods`).

Steps: Open the fixture, click Auto Video, Export.

Expected: built-in parts resolve their model from `modelId`, as when they are added from the parts bin.

A fix is proposed in the linked pull request: one registry of built-in parts keyed by `modelId`, used as a
fallback when a saved model part carries no reference of its own.

Context: this is the second of the small changes listed in #1, which explains the project behind them
([circuit-studio-agent-kit](https://github.com/docteurzoidberg/circuit-studio-agent-kit)). Generated
projects would rely on this to stay small: they can reference built-in parts by `modelId` without copying
their geometry.

## Pull request

**Title:** Resolve built-in model references from modelId

**Body:**

Fixes #<issue>.

Saved projects can keep only `geometry: {kind: "model"}` for a built-in part (the upstream fixture
`crowded-c6-project.json` does). Video export then failed with "No model asset reference".

Changes:
- `src/catalog.ts` (new): `BUILT_IN_COMPONENTS`, `builtInComponent(modelId)` and `withBuiltInModel(component)`,
  which restores the built-in model references, centre and orientation when a saved model part has none.
- `src/store.ts`: the parts bin uses the registry instead of its inline list (same parts, same order).
- `src/modelCache.ts`: `modelUrl()` and `modelResource()` fall back to the registry.
- `src/projectFiles.ts`: Open (`importLegacy`) fills missing references, so the next Save writes them
  explicitly.
- Parts that carry their own `modelUrl`, `lodUrls` or `modelAssetId`, custom parts and unknown `modelId`s are
  left unchanged.
- `tests/built-in-catalog.test.ts`: 5 tests (unique ids, every built-in model part has a reference, restore,
  no change for explicit or custom parts, every model part of the fixture resolves).

Verification:
- `npx tsc -b` passes; the 5 new tests pass.
- In the dev server: Open the fixture through `importLegacy`, then Auto Video export at the default settings:
  all five model parts resolve (`/models/esp32-c6-supermini.glb`, steppers, LDR, resistor), the real CAD models
  render, and the export completes (2791 frames, 1080p MP4). Before this change the same export failed with
  "No model asset reference".
- `npm run test` reports the same 36 failures as on `main` (unrelated: tests assume the editor starts with the
  starter circuit).

Reproduce locally (Node 22):

```bash
npm ci
npx tsc -b && npx vitest run tests/built-in-catalog.test.ts
npm run dev
# Open tests/fixtures/crowded-c6-project.json, then Auto Video > Export
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
