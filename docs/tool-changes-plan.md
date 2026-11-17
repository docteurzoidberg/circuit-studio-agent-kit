# Circuit Studio changes — plan

Status: plan, 2026-11-16. Changes are made in the fork (`circuit-studio/fork`, branch per PR) and proposed
upstream later. Each PR starts as an upstream issue. Scope decided in
[feasibility-results.md](feasibility-results.md): F1, F2, F4, plus the hosting bugs.

```mermaid
flowchart LR
  B[Base-path assets] --> F4[Model references (F4)]
  F4 --> F2[Presentation in project (F2)]
  F2 --> F1[Automation API (F1)]
```

Order: smallest first, to establish contact with the maintainer; F4's registry is reused by F1.

## Conventions for every PR

- One issue, then one focused PR; English everywhere.
- Follow the upstream style (dense single-line TypeScript, Zod schemas, Zustand store, docs page per feature).
- Tests: Vitest for logic, a Playwright script under `scripts/` for browser behaviour, `npm run build` clean.
- Backward compatible: existing `.c3dproj` / `.c3dzip` files open unchanged; no `schemaVersion` bump.
- Docs: update the matching page under `docs/` and the README section.

## Base-path assets (bugs 1 and 2)

**Problem.** Bundled models and the font use root-absolute URLs (`/models/...`, `/fonts/...`); on GitHub Pages
the app lives under `/circuit-studio/`, so every CAD model returns 404 and parts fall back to placeholders.

**Change.** Resolve asset URLs against `import.meta.env.BASE_URL` in one helper; use it in `src/model.ts`,
`src/data/*.json` consumers, `src/modelCache.ts` and `src/Workspace.tsx`. Keep stored project URLs stable
(`/models/x.glb`) and prefix at load time, so saved projects stay portable across hosts.

**Tests.** Unit test of the helper with a non-root base; build with `GITHUB_ACTIONS=1` and check a model URL.

## Model references (F4) from `modelId` (bug 6)

**Problem.** A saved model component without `modelUrl`/`lodUrls` (e.g. the upstream fixture
`tests/fixtures/crowded-c6-project.json`) cannot be exported: `modelResource()` throws "No model asset reference".

**Change.**
- Add a single built-in part registry (`src/catalog.ts`): `modelId` → built-in component definition. Today the
  list is inlined in `src/store.ts` (`imported`) and the constants live in `src/model.ts`.
- `modelUrl()` in `src/modelCache.ts` falls back to the registry geometry when the component has none.
- `migrateProject()` may also fill missing references on open, so saved files become explicit again.

**Tests.** Export preparation of the upstream fixture no longer throws; registry covers every bundled part.

## Presentation in project (F2)

**Problem.** Video settings (`c3d-video-preset-v1`), shot overrides and saved camera scenes (keyed by project
name in `src/savedCameraScenes.ts`) live in browser storage. A render from another browser or a script loses
the look chosen in the editor.

**Change.**
- Optional `presentation` block in `ProjectSchema`:
  `{ video?: VideoSettings, shotOverrides?: ShotOverride[], cameraScenes?: SavedCameraScene[] }`.
- Precedence when rendering: project block, then local preset, then defaults.
- Editor: a "Store in project" toggle in Video settings; Save and Package include the block; Open restores it.
- Local presets keep working as before for users who do not opt in.

**Tests.** Schema round trip; old projects without the block open unchanged; settings from the project are
used by `exportCinematic` when present.

**To agree with the maintainer.** Block name, whether scenes move into the project by default.

## Automation API (F1)

**Problem.** Scripts can only reach internal modules through the Vite dev server
(`import('/src/videoExport.ts')`); production builds expose nothing but the raw scene.

**Change.** A documented `window.circuitStudio` object, present in production builds, built on existing code:

```ts
window.circuitStudio = {
  version: string,                       // app + API version
  ready: Promise<void>,                  // resolves when the viewport can render
  openProject(data: object | Blob): Promise<ProjectSummary>,  // same path as Open (migrations, validation, assets)
  getProject(): Project,                 // current project without embedded assets
  listParts(): PartInfo[],               // built-in registry (Model references) + local library, with pins (id, label, aliases)
  capabilities(settings?): Promise<{ mp4: boolean; webm: boolean; png: boolean }>,
  renderImage(options): Promise<Blob>,   // wraps exportScenePng
  renderVideo(settings?, options?: { selected?: string[]; onProgress?(p): void; signal?: AbortSignal })
    : Promise<{ blob: Blob; filename: string; frames: number; duration: number; warnings: string[] }>,
}
```

- `PartInfo` serves the skills' pin mapping (former F5): pins with `id`, `label`, `silkscreen`, `aliases`,
  `electrical`.
- `renderVideo` uses the project's presentation block (Presentation in project) when no settings are passed.
- One `docs/AUTOMATION_API.md` page with a Playwright example (open, render, save bytes).

**Tests.** Playwright against `vite preview`: open a fixture through the API, list parts, render a short PNG
and a 1-second video, check `ffprobe` metadata.

**To agree with the maintainer.** Always-on versus opt-in (for example `?automation=1`), naming, versioning.

## Small features

Small changes useful on their own (720p video, garbled characters, export for Discord) are planned apart, tried in
the fork before the owner decides on a pull request: [small-features-plan.md](small-features-plan.md).

## Bugs not covered here

Bugs 3 (autosave never restored), 4 (fixture stuck loading on the hosted site), 5 (encoding of two docs) and
7 (mirrored supply label) are reported as separate issues; see [upstream-bugs.md](upstream-bugs.md).
