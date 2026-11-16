# Circuit Studio agent kit

Claude Code skills and a command line that turn an electronics project's wiring into a 3D wiring video
rendered by [Circuit Studio 3D](https://github.com/arslansadiq87/circuit-studio). Start with [README.md](README.md)
(what the kit does, state of each skill and command) and [PLAN.md](PLAN.md) (decisions D1…, architecture, phases,
next steps).

## Layout

| Path | Content |
|---|---|
| `skills/` | Skills, in the order a user meets them: `wiring-plan`, `wiring-parts` (written), `wiring-project` (written), `wiring-video` (planned) |
| `tools/cli.ts` | The kit's command line (`part catalog`, `part inspect`, `part convert`, `part pins`, `wiring`, `build`, `studio` so far) |
| `tools/catalog/` | Snapshot of the Circuit Studio catalog into the user's `.circuitstudio/catalog.json` |
| `tools/parts/` | STEP inspection and conversion into Circuit Studio parts (OpenCascade in WebAssembly) |
| `tools/wiring/` | Pins of the project's parts (`part pins`) and the check of `wiring.json` (`wiring`, ajv) |
| `tools/bridge/`, `tools/studio/` | The bridge the Circuit Studio page connects to (D23) and `studio`, the background process holding it for the review (D25); `tools/config.ts`: the user's kit settings |
| `tools/project/` | `build`: the Circuit Studio project from `wiring.json`; Circuit Studio's schema and route planner bundled from a local checkout into `.cache/engine/` |
| `schema/`, `examples/` | `wiring.json` schema; the Claudemètre showcase (`wiring.md`, `wiring.json`) |
| `docs/` | Study, converter plan, upstream tracking, user guides of the skills (`docs/user-guide/skills/`) |

## Commands

```bash
nvm use 22            # Node 22 runs the TypeScript files directly
npm install
npm test              # node:test, tools/**/*.test.ts
npm run typecheck     # tsc, no output files
node tools/cli.ts part inspect tools/parts/test/fixtures/test-board.step
```

## Conventions

- Everything in the repository is in English: code, comments, messages, docs, skills, commit messages.
- TypeScript (D17): explicit types, imports ending in `.ts`, erasable syntax only (no enums, no parameter
  properties) so Node runs the files without a build. OpenCascade types come from
  `opencascade.js/dist/opencascade.full.js`; enum values go through `enumValue` (tools/parts/occt.ts).
- The skills read Markdown themselves; there is no parser of the wiring document (D3). `wiring.json`, the catalog
  snapshot, parts and the generated project live in the user's `.circuitstudio/` (D13, D14).
- The kit never goes on the network without the user's consent (D15): `part catalog` downloads only with
  `--download`, which the skill passes after asking.
- Commands follow the skills; all find their files in `.circuitstudio/`, except `part inspect` and `part convert`
  (they take a file) and `part pins` (part identifiers).
- Part tools must keep giving the expected outputs in `tools/parts/test/fixtures/*.reference.json` (fixture STEP
  written by `tools/parts/test/fixture.ts`). Regenerate them only on purpose, when an output changes by design (D19).
- Keep the State columns of the README (skills, commands, upstream contributions) and
  [docs/upstream-contributions.md](docs/upstream-contributions.md) current; at the start of a session, check the
  upstream issues and pull requests listed there.
- Record lasting decisions in the PLAN.md decision table (next number after the last one).
