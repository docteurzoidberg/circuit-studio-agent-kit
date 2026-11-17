# Upstream contributions — tracking

Issues and pull requests proposed to [Circuit Studio 3D](https://github.com/arslansadiq87/circuit-studio), and
their integration by the maintainer. Plan: [tool-changes-plan.md](tool-changes-plan.md); small features tried in the
fork before any proposal: [small-features-plan.md](small-features-plan.md).

**To do at each session:** check the state of every open item below (`gh pr list -R arslansadiq87/circuit-studio
--author @me`, `gh issue list -R arslansadiq87/circuit-studio --author @me`), answer review comments, rebase the
fork branch if `main` moved, and update this table and the State column of the README. When a PR is merged, rebase the following fork branches on
the new `upstream/main` and switch our tooling from the spike workaround to the upstream behaviour.

| Change | Issue | Pull request | Fork branch | State | Follow-up once merged |
|---|---|---|---|---|---|
| Base-path assets | [#1](https://github.com/arslansadiq87/circuit-studio/issues/1) | [#2](https://github.com/arslansadiq87/circuit-studio/pull/2) | — (deleted) | Done 2026-11-16: fixed by the maintainer in [`1713780`](https://github.com/arslansadiq87/circuit-studio/commit/1713780); our PR closed as superseded | Done: the deployed site resolves models under its base path (access modes in upstream-study.md) |
| Model references (F4) | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) | [#4](https://github.com/arslansadiq87/circuit-studio/pull/4) | — (deleted) | Done 2026-11-16: fixed by the maintainer in [`1713780`](https://github.com/arslansadiq87/circuit-studio/commit/1713780); our PR closed as superseded | Drop the model-geometry restore from the spike scripts (local `spike/`) |
| Built-in model fallback (follow-up to F4) | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) ([comment](https://github.com/arslansadiq87/circuit-studio/issues/3#issuecomment-6928191181)) | [#7](https://github.com/arslansadiq87/circuit-studio/pull/7) | [`fix/built-in-model-fallback`](https://github.com/docteurzoidberg/circuit-studio/tree/fix/built-in-model-fallback) | Proposed 2026-11-16 ([texts](upstream-drafts/built-in-model-fallback.md)): the fixture still opens with unavailable models and fails to export on the deployed site; the maintainer merges or fixes it his way. 2026-11-17: rebased on upstream `75f8212` (`5e051d9`, pushed, the PR follows; old head kept as tag `backup/built-in-model-fallback-before-75f8212`); the maintainer's `a355a83` forces the built-in model for `arduino-uno-r3` only, our fallback keeps that rule and covers the other parts | Drop the geometry completion from our end-to-end check |
| Presentation in project (F2) | [#5](https://github.com/arslansadiq87/circuit-studio/issues/5) | [#6](https://github.com/arslansadiq87/circuit-studio/pull/6) | — (kept as a local tag only) | Done 2026-11-17: implemented by the maintainer in [`82e4bcd`](https://github.com/arslansadiq87/circuit-studio/commit/82e4bcd) (same `presentation: {video, cameraScenes}` block); #5 closed as completed, our PR closed as superseded | Done: `build` writes the block from `video.json`, `studio sync` reads it back |
| Garbled characters (bugs 9 and 5, [small features](small-features-plan.md)) | — | [#8](https://github.com/arslansadiq87/circuit-studio/pull/8) | [`fix/garbled-characters`](https://github.com/docteurzoidberg/circuit-studio/tree/fix/garbled-characters) | Proposed 2026-11-17 (two commits `18da839`, `7f2d86e` on upstream `75f8212`, independent of our other branches; [texts](upstream-drafts/garbled-characters.md)): 33 sequences in four source files, two docs, a test that text stays valid UTF-8 | Nothing in the kit; rebase our fork branches on the new `main` |
| Automation API (F1) | — | — | [`feat/automation-api`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/automation-api) | One commit `c784ea6` on upstream `75f8212` (2026-11-17: rebased on the maintainer's presentation block with fixups squashed, then on `75f8212`, pushed; old heads kept as tags `backup/automation-api-before-82e4bcd` and `-before-75f8212`). The API is installed in the page's new `bootstrap()`, after the restore of the previous session, so a project a script opens is not replaced by it, 8 tests; not proposed upstream yet ([draft](upstream-drafts/automation-api.md)); includes `planRoutes()`, `videoSettings()` and API renders shown in the page's progress panel | Replace dev-server module imports with `window.circuitStudio`; `build` checks routes with `planRoutes()` instead of the router bundled from the sources |
| Bridge to the kit (D23) | — | — | [`feat/kit-bridge`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/kit-bridge) (on top of `feat/automation-api`) | One commit `18f0a47` (2026-11-17, fixups squashed, rebased on `75f8212` and pushed; old heads kept as tags `backup/kit-bridge-before-82e4bcd` and `-before-75f8212`). Since `75f8212` the page restores the previous session at start-up: a project the kit opens for review comes back on the user's next visit, 6 tests; checked end to end with the kit (review, renders of the Claudemètre and of the demo project in the owner's browser); proposed after the API ([draft](upstream-drafts/kit-bridge.md)) | The kit's review and rendering stop driving a browser; with both upstream, users no longer need a local build |

## Arguments for the automation API pull request

What the API saves our users, to state in the PR description (noted 2026-11-16):

- **Catalog without the sources**: `listParts()` gives the built-in parts and their pins from the site itself. Without
  it, the kit needs a local Circuit Studio checkout or downloads the author's repository, then compiles `src/model.ts`
  on the user's machine, so it ships esbuild, zod, three, zustand and react as runtime dependencies
  (`tools/catalog/snapshot.ts`; zustand and react since `82e4bcd`, when `model.ts` started importing `cinematic.ts`).
- **No reading of internals**: today the snapshot collects the `*_COMPONENT` constants of `model.ts` and of the
  other modules of `src/` (the Arduino Uno of `a355a83` is defined in `arduinoUno.ts` and not re-exported), and reads
  the list of parts the app offers from `store.ts` with a pattern; any refactor upstream breaks it (it already
  happened twice). The API is a stable contract.
- **No dev server**: driving the app (load a project, render, record) goes through `window.circuitStudio` on the hosted
  site instead of Vite module imports on a local dev server, so users need neither a clone nor `npm install` of
  Circuit Studio.

If the maintainer declines a change or asks for another shape, record it here and update the plan
(PLAN.md decisions) accordingly.
