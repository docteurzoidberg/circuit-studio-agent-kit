# Upstream contributions — tracking

Issues and pull requests proposed to [Circuit Studio 3D](https://github.com/arslansadiq87/circuit-studio), and
their integration by the maintainer. Plan: [tool-changes-plan.md](tool-changes-plan.md).

**To do at each session:** check the state of every open item below (`gh pr list -R arslansadiq87/circuit-studio
--author @me`, `gh issue list -R arslansadiq87/circuit-studio --author @me`), answer review comments, rebase the
fork branch if `main` moved, and update this table. When a PR is merged, rebase the following fork branches on
the new `upstream/main` and switch our tooling from the spike workaround to the upstream behaviour.

| Plan item | Issue | Pull request | Fork branch | State | Follow-up once merged |
|---|---|---|---|---|---|
| PR 0 · base-path assets | [#1](https://github.com/arslansadiq87/circuit-studio/issues/1) | [#2](https://github.com/arslansadiq87/circuit-studio/pull/2) | `fix/base-path-assets` | Open (2026-11-16) | Hosted site usable for previews; update access modes in upstream-study.md |
| PR 1 · F4 model references | [#3](https://github.com/arslansadiq87/circuit-studio/issues/3) | [#4](https://github.com/arslansadiq87/circuit-studio/pull/4) | `fix/model-reference-from-catalog` | Open (2026-11-16) | Drop the model-geometry restore from the spike scripts |
| PR 2 · F2 presentation in project | — | — | — | Not started | Write the presentation block from our generator |
| PR 3 · F1 automation API | — | — | — | Not started | Replace dev-server module imports with `window.circuitStudio` |

If the maintainer declines a change or asks for another shape, record it here and update the plan
(PLAN.md decisions) accordingly.
