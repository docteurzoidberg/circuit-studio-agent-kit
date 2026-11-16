# Upstream contributions — tracking

Issues and pull requests proposed to [Circuit Studio 3D](https://github.com/arslansadiq87/circuit-studio), and
their integration by the maintainer. Plan: [tool-changes-plan.md](tool-changes-plan.md).

**To do at each session:** check the state of every open item below (`gh pr list -R arslansadiq87/circuit-studio
--author @me`, `gh issue list -R arslansadiq87/circuit-studio --author @me`), answer review comments, rebase the
fork branch if `main` moved, and update this table and the State column of the README. When a PR is merged, rebase the following fork branches on
the new `upstream/main` and switch our tooling from the spike workaround to the upstream behaviour.

| Change | Issue | Pull request | Fork branch | State | Follow-up once merged |
|---|---|---|---|---|---|
| Base-path assets | [#1](https://github.com/arslansadiq87/circuit-studio/issues/1) | [#2](https://github.com/arslansadiq87/circuit-studio/pull/2) | `fix/base-path-assets` | Open (2026-11-16) | Hosted site usable for previews; update access modes in upstream-study.md |
| Model references (F4) | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) | [#4](https://github.com/arslansadiq87/circuit-studio/pull/4) | `fix/model-reference-from-catalog` | Open (2026-11-16) | Drop the model-geometry restore from the spike scripts |
| Presentation in project (F2) | — | — | [`feat/presentation-in-project`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/presentation-in-project) | Pushed to the fork, not proposed upstream yet; [draft](upstream-drafts/presentation.md) | Write the presentation block from our generator |
| Automation API (F1) | — | — | `feat/automation-api` (local, built on model references + presentation) | In progress, not proposed yet | Replace dev-server module imports with `window.circuitStudio` |

If the maintainer declines a change or asks for another shape, record it here and update the plan
(PLAN.md decisions) accordingly.
