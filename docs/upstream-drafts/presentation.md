# Presentation in project (F2): presentation settings stored in the project

> **Published 2026-11-16** as issue [#5](https://github.com/arslansadiq87/circuit-studio/issues/5) and pull request [#6](https://github.com/arslansadiq87/circuit-studio/pull/6). Fork branch
> [`feat/presentation-in-project`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/presentation-in-project)
> (one commit, `6e4d7f2`, on upstream `1713780`; reviewed and checked again in the dev server on 2026-11-16).
>
> **Issue and pull request together** (owner's choice, 2026-11-16): the maintainer fixed #1 and #3 himself; he
> chooses again whether to merge the pull request or implement the change his own way.

## Issue

**Title:** Keep Auto Video settings and camera scenes with the project

**Body:**

Auto Video settings (mode, resolution, frame rate, background, labels, card style, and the per-shot camera
overrides set with "Use editor camera for this shot") are stored only in the browser, under
`c3d-video-preset-v1`. Saved camera scenes are stored in the browser too, keyed by project name
(`c3d-camera-scenes-v1:<name>`).

As a result, a project file does not carry the look of its video:

- opening the project in another browser, on another machine, or after clearing site data gives a different
  video;
- two projects in the same browser share one preset, so tuning one changes the other;
- renaming a project loses its saved camera scenes;
- a script or CI job that renders a project cannot reproduce what the author set up in the editor.

Expected: optionally keep these settings in the project file, so the project alone defines its video.

A change is proposed in the linked pull request (one commit on `1713780`, 5 tests): an optional `presentation`
block in the project, filled by a "Store settings in project" button in the Auto Video dialog. Without it, nothing
changes. Feel free to merge it, or to implement this your own way as you did for #1 and #3, whichever suits you.

### Context: why I am looking at this

This is the third of the small changes announced in #1 (thank you for fixing the first two in `1713780`). As a reminder, I am building
[circuit-studio-agent-kit](https://github.com/docteurzoidberg/circuit-studio-agent-kit), an open-source (MIT)
set of AI-agent skills, an MCP server and a CLI around Circuit Studio: a maker keeps a plain Markdown wiring
document in their project, the agent prepares the missing 3D parts, and Circuit Studio renders the wiring video
for the project's README. Circuit Studio stays the editor and the renderer; the kit only feeds it projects and
parts.

Why this one matters for the kit, and I think beyond it:

- **Reproducible renders.** The kit re-renders the video when the wiring changes, possibly from a git hook or a
  CI job. The background, frame rate, labels and camera tweaks the author chose in the editor must travel with
  the project, not stay in one browser.
- **The editor stays the place to tune the video.** A maker opens the generated project in Circuit Studio,
  adjusts the camera of a shot or the background, clicks "Store settings in project" and saves; the next
  automatic render uses exactly that.
- **It prepares the automation API** proposed in the
  [plan](https://github.com/docteurzoidberg/circuit-studio-agent-kit/blob/main/docs/tool-changes-plan.md):
  `renderVideo()` would use the project's stored settings when a script passes none.

Questions where your preference matters:

1. the name and shape of the block (`presentation: {video, cameraScenes}`);
2. whether saved camera scenes should move into the project automatically, rather than only when storing;
3. whether you would rather have a toggle than store/update/remove buttons.

## Pull request

**Title:** Store Auto Video settings and camera scenes in the project

**Body:**

Fixes #5.

Auto Video settings (including shot camera overrides) and saved camera scenes lived only in browser storage, so
a render from another browser or a script lost the look chosen in the editor.

Changes:
- `src/model.ts`: optional `presentation` block in `ProjectSchema`: `video` (Auto Video settings, sanitized with
  `validSettings()` when used) and `cameraScenes`. `schemaVersion` is unchanged; files without the block are
  unchanged.
- `src/presentation.ts` (new): `projectVideoSettings()`, `projectCameraScenes()`, `withPresentation()`.
- `src/store.ts`: `setPresentation()`, an undoable project edit.
- `src/AutoVideoControls.tsx`: "Store settings in project", then "Update settings in project" and "Remove from
  project". Opening a project that carries the block applies its settings; the local preset is no longer
  overwritten while the project has its own settings, and comes back on "Remove from project" or when another
  project is opened.
- `src/CameraScenes.tsx`: scenes stored in the project are listed with the local ones.
- `docs/AUTO_VIDEO_GENERATOR.md`, `docs/PROJECT_FORMAT.md`: the block and the buttons.
- `tests/presentation.test.ts`: 5 tests (no block, schema round trip with overrides and scenes, sanitizing,
  copies, undoable store edit).

Verification (on `1713780`):
- `npx tsc -b` passes; the 5 new tests pass; `npx vitest run` shows the same 35 unrelated failures as on `main`.
- In the dev server, with a local preset at 60 FPS: opening a project file that stores 24 FPS, a white background
  and one camera scene shows 24 FPS and the white background in the dialog, lists the stored scene under Camera
  scenes, and leaves the local preset at 60 FPS; "Remove from project" drops the block and returns to 60 FPS;
  "Store settings in project" writes the current settings back into the project.

Reproduce locally (Node 22):

```bash
npm ci
npx tsc -b && npx vitest run tests/presentation.test.ts
npm run dev
# Auto Video settings > Store settings in project > Save; reload, Open the file: the stored settings apply
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
