# Upstream bugs found during the study

Short list of issues met in Circuit Studio 3D, to turn into upstream issues and pull requests later.
Reference: upstream `main` at `47b06b3`, hosted site https://arslansadiq87.github.io/circuit-studio/ (2026-11-16).

| # | Area | Observed | Likely cause |
|---|---|---|---|
| 1 | Hosted build | Every bundled CAD model returns 404 (`/models/esp32-c6-supermini.glb`); parts fall back to simple placeholders | Model URLs are root-absolute (`/models/...` in `src/model.ts` and `src/data/*.json`) and ignore the Vite `base` (`/circuit-studio/`) |
| 2 | Hosted build | `IBMPlexMono-Regular.ttf` requested at `/fonts/...` returns 404 (sometimes loaded from `/circuit-studio/fonts/...`) | Root-absolute font paths in `src/Workspace.tsx` |
| 3 | Persistence | The current project is autosaved to localStorage and IndexedDB but never restored: a reload always starts an empty project | `restoreLocalProject()` in `src/projectPersistence.ts` is never called |
| 4 | Hosted build | After opening the upstream fixture `tests/fixtures/crowded-c6-project.json`, the 3D view stays on "Loading 3D workspace…"; once, the page reloaded by itself right after Open | Not investigated; possibly a consequence of #1 |
| 6 | Video export | Exporting the upstream fixture `crowded-c6-project.json` fails with "No model asset reference", even after Open | Saved model components carry no `modelUrl`; `modelUrl()` in `src/modelCache.ts` does not fall back to the catalog by `modelId` |
| 7 | Rendering | The label printed on the external 5 V supply box appears mirrored in the video's final overview | Not investigated |
| 5 | Docs | `docs/TESTING.md` contains invalid UTF-8; `docs/PIN_MAPPING.md` shows `?` in place of characters (`D?`, `62.74 ? 25.40`) | Encoding corruption |
