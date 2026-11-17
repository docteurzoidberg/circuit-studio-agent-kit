# The Claudemètre's `.circuitstudio/` folder

What the kit keeps in a project, here for the Claudemètre showcase. Each skill keeps its own file, so running it
again resumes without asking what it asked once (D27). The wiring document itself sits next to this folder:
[`../wiring.md`](../wiring.md), written with `wiring-plan`.

| Path | Skill | Content | Here |
|---|---|---|---|
| [`wiring.json`](wiring.json) | `wiring-project` | The document resolved: parts, connections in video order, placement hints; `source` holds the document's hash, so a changed document is noticed | committed |
| [`parts/<id>/part.yaml`](parts/mrd076a-esp32-s3/part.yaml) | `wiring-parts` | How a part is made from its STEP model: pins, pose, simplification | committed (one of the five parts as an example) |
| `parts/<id>/<id>.c3dcomponent`, `<id>.png` | `wiring-parts` | The Circuit Studio part converted from the STEP model, and its preview | local: derived from third-party STEP files |
| `catalog.json` | `wiring-parts` | Snapshot of Circuit Studio's built-in parts (`part catalog`) | local: regenerated |
| `project.c3dproj` | `wiring-project` | The Circuit Studio project (`build`), with the owner's edits made in the editor | local: embeds the parts' models (30 MB) |
| `build.json` | `wiring-project` | What `build` placed, so it tells the owner's edits from its own and keeps them | local: only matters next to the project |
| [`video.json`](video.json) | `wiring-video` | The video settings chosen once (here Circuit Studio's defaults), the outputs besides the video (no poster), later the automation | committed |
| `media/` | `wiring-video` | The rendered video (`render`) and the poster when asked | local: large, published elsewhere |
| `studio.json`, `studio.log` | (kit) | The background process the Circuit Studio page connects to during the review and the render | local, always |

[`.gitignore`](.gitignore) says the same: the kit writes the first two lines; the others are this project's
choice. Publishing files derived from third-party models is the owner's call and responsibility (D24); a project
whose models may be shared can commit the parts and the project, which lets a CI job render the video again.

This example has no `build.json`: its project was arranged by hand in the editor before `build` existed.
