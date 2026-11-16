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
| Presentation in project (F2) | — | — | [`feat/presentation-in-project`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/presentation-in-project) | Pushed to the fork (`deac491`, on upstream `1713780`), not proposed upstream yet; [draft](upstream-drafts/presentation.md) | Write the presentation block from our generator |
| Automation API (F1) | — | — | [`feat/automation-api`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/automation-api) (built on presentation) | Pushed to the fork (`a171ff3`, on upstream `1713780`), not proposed upstream yet; `listParts()` now reads the maintainer's `BUILT_IN_MODEL_COMPONENTS` | Replace dev-server module imports with `window.circuitStudio` |

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
