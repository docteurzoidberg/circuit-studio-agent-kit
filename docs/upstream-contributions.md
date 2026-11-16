# Upstream contributions — tracking

Issues and pull requests proposed to [Circuit Studio 3D](https://github.com/arslansadiq87/circuit-studio), and
their integration by the maintainer. Plan: [tool-changes-plan.md](tool-changes-plan.md).

**To do at each session:** check the state of every open item below (`gh pr list -R arslansadiq87/circuit-studio
--author @me`, `gh issue list -R arslansadiq87/circuit-studio --author @me`), answer review comments, rebase the
fork branch if `main` moved, and update this table and the State column of the README. When a PR is merged, rebase the following fork branches on
the new `upstream/main` and switch our tooling from the spike workaround to the upstream behaviour.

| Change | Issue | Pull request | Fork branch | State | Follow-up once merged |
|---|---|---|---|---|---|
| Base-path assets | [#1](https://github.com/arslansadiq87/circuit-studio/issues/1) | [#2](https://github.com/arslansadiq87/circuit-studio/pull/2) | — (deleted) | Done 2026-11-16: fixed by the maintainer in [`1713780`](https://github.com/arslansadiq87/circuit-studio/commit/1713780); our PR closed as superseded | Done: the deployed site resolves models under its base path (access modes in upstream-study.md) |
| Model references (F4) | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) | [#4](https://github.com/arslansadiq87/circuit-studio/pull/4) | — (deleted) | Done 2026-11-16: fixed by the maintainer in [`1713780`](https://github.com/arslansadiq87/circuit-studio/commit/1713780); our PR closed as superseded | Drop the model-geometry restore from the spike scripts (local `spike/`) |
| Built-in model fallback (follow-up to F4) | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) ([comment](https://github.com/arslansadiq87/circuit-studio/issues/3#issuecomment-6928191181)) | [#7](https://github.com/arslansadiq87/circuit-studio/pull/7) | [`fix/built-in-model-fallback`](https://github.com/docteurzoidberg/circuit-studio/tree/fix/built-in-model-fallback) | Proposed 2026-11-16 (`a2ef47a`, on upstream `1713780`; [texts](upstream-drafts/built-in-model-fallback.md)): the fixture still opens with unavailable models and fails to export on the deployed site; the maintainer merges or fixes it his way | Drop the geometry completion from our end-to-end check |
| Presentation in project (F2) | [#5](https://github.com/arslansadiq87/circuit-studio/issues/5) | [#6](https://github.com/arslansadiq87/circuit-studio/pull/6) | [`feat/presentation-in-project`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/presentation-in-project) | Proposed 2026-11-16 (`6e4d7f2`, on upstream `1713780`; [texts](upstream-drafts/presentation.md)); the maintainer chooses to merge it or implement it himself | Write the presentation block from our generator |
| Automation API (F1) | — | — | [`feat/automation-api`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/automation-api) (built on presentation) | Pushed to the fork (`8f4db3d`, on the presentation commit `6e4d7f2`), not proposed upstream yet ([draft](upstream-drafts/automation-api.md), to publish once #6 is settled); `listParts()` now reads the maintainer's `BUILT_IN_MODEL_COMPONENTS`; `planRoutes()` added and checked end to end on 2026-11-16 (local `fixup!` commits `65a135c`, `1ba2a91`, squashed before publishing) | Replace dev-server module imports with `window.circuitStudio`; `build` checks routes with `planRoutes()` instead of the router bundled from the sources |
| Bridge to the kit (D23) | — | — | planned, on top of `feat/automation-api` | Not written yet (phase 6): the page connects to the kit's MCP server and runs its requests through the automation API; proposed after the API, as a generic remote bridge | The kit's review and rendering stop driving a browser; with both upstream, users no longer need a local build |

## Arguments for the automation API pull request

What the API saves our users, to state in the PR description (noted 2026-11-16):

- **Catalog without the sources**: `listParts()` gives the built-in parts and their pins from the site itself. Without
  it, the kit needs a local Circuit Studio checkout or downloads the author's repository, then compiles `src/model.ts`
  on the user's machine, so it ships esbuild, zod and three as runtime dependencies (`tools/catalog/snapshot.mjs`).
- **No reading of internals**: today the snapshot collects the `*_COMPONENT` exports of `model.ts` and reads the list
  of parts the app offers from `store.ts` with a pattern; any refactor upstream breaks it. The API is a stable contract.
- **No dev server**: driving the app (load a project, render, record) goes through `window.circuitStudio` on the hosted
  site instead of Vite module imports on a local dev server, so users need neither a clone nor `npm install` of
  Circuit Studio.

If the maintainer declines a change or asks for another shape, record it here and update the plan
(PLAN.md decisions) accordingly.
