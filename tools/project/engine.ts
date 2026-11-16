// Circuit Studio's own code that `build` needs, bundled from a local checkout for Node: the project schema and
// migrations, the built-in part templates (src/model.ts), and the wire route planner (src/autoRouting.ts, the
// code the app runs in its routing worker). Until the automation API is upstream (planRoutes, listParts), this is
// the only way to place parts with the routes the app will compute (D21). The bundle is cached in the kit's
// `.cache/engine/`, keyed by the content of the checkout's sources, so a changed checkout gives a new bundle.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(KIT_ROOT, '.cache', 'engine');

/** A point or a vector in mm, or angles in degrees. */
export type Triple = [number, number, number];

/** A pin as a Circuit Studio project stores it (the fields `build` reads). */
export interface CsPin {
  id: string;
  label: string;
  side: 'left' | 'right' | 'top' | 'bottom';
  index: number;
  localPosition?: Triple;
  exitDirection?: Triple;
  aliases?: string[];
  [key: string]: unknown;
}

/** A component (placed part) of a Circuit Studio project. */
export interface CsComponent {
  id: string;
  modelId: string;
  name: string;
  position: Triple;
  rotation: Triple;
  pins: CsPin[];
  dimensions?: Triple;
  geometry?: {kind: 'procedural-pcb' | 'model'; modelAssetId?: string; [key: string]: unknown};
  [key: string]: unknown;
}

export interface CsWire {
  id: string;
  from: {componentId: string; pinId: string};
  to: {componentId: string; pinId: string};
  color: string;
  diameter: number;
  label: string;
  curvature: number;
  routeMode?: 'auto' | 'clean' | 'manual' | 'straight' | 'orthogonal';
  bendPoints?: Triple[];
  liftHeight?: number;
  autoLane?: number;
  /** Set by the planner, never saved. */
  routingBlocked?: boolean;
  routingPoints?: Triple[];
  [key: string]: unknown;
}

export interface CsProject {
  schemaVersion: 1;
  name: string;
  components: CsComponent[];
  wires: CsWire[];
  wireOrder?: string[];
  camera: {position: Triple; target: Triple};
  assets?: Record<string, string>;
  [key: string]: unknown;
}

export interface Engine {
  /** The checkout the bundle was made from. */
  source: string;
  /** Built-in part templates by modelId (every `*_COMPONENT` export of src/model.ts). */
  templates: Map<string, CsComponent>;
  /** Validates a project as the app does on Open (throws the schema error). */
  validate(project: unknown): void;
  /** The app's route planner: the wires with `routingBlocked` and `routingPoints` set. */
  planRoutes(wires: CsWire[], components: CsComponent[]): CsWire[];
}

interface Bundle {
  model: Record<string, unknown> & {
    ProjectSchema: {parse(value: unknown): unknown};
    migrateProject(project: unknown): unknown;
  };
  planAutoWires(wires: CsWire[], components: CsComponent[]): CsWire[];
}

/** A hash of the checkout's sources (src/, recursively), so the cache follows local edits too. */
function sourceKey(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|json)$/.test(entry.name)) hash.update(path.slice(root.length)).update(readFileSync(path));
    }
  };
  walk(join(root, 'src'));
  return hash.digest('hex').slice(0, 16);
}

const isComponent = (value: unknown): value is CsComponent =>
  typeof value === 'object' && value !== null && typeof (value as CsComponent).modelId === 'string'
  && Array.isArray((value as CsComponent).pins);

/** Bundle (or reuse) the engine of the Circuit Studio checkout at `checkout`. */
export async function loadEngine(checkout: string): Promise<Engine> {
  const root = resolve(checkout);
  for (const file of ['src/model.ts', 'src/autoRouting.ts']) {
    if (!existsSync(join(root, file))) throw new Error(`${root}: no ${file}, not a Circuit Studio checkout`);
  }
  const out = join(CACHE, `${sourceKey(root)}.mjs`);
  if (!existsSync(out)) {
    mkdirSync(CACHE, {recursive: true});
    const entry = join(CACHE, `entry-${process.pid}.ts`);
    writeFileSync(entry, [
      `export * as model from ${JSON.stringify(join(root, 'src/model.ts'))};`,
      `export {planAutoWires} from ${JSON.stringify(join(root, 'src/autoRouting.ts'))};`,
    ].join('\n'));
    try {
      await esbuild.build({
        entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
        nodePaths: [join(KIT_ROOT, 'node_modules')], loader: {'.json': 'json'},
      });
    } finally {
      rmSync(entry, {force: true});
    }
  }
  const bundle = await import(pathToFileURL(out).href) as Bundle;
  const templates = new Map<string, CsComponent>();
  for (const [name, value] of Object.entries(bundle.model)) {
    if (name.endsWith('_COMPONENT') && isComponent(value) && !templates.has(value.modelId)) templates.set(value.modelId, value);
  }
  return {
    source: root,
    templates,
    validate: project => { bundle.model.migrateProject(bundle.model.ProjectSchema.parse(project)); },
    // As the workspace does: hidden wires are routed too, so showing one does not move its neighbours.
    planRoutes: (wires, components) => bundle.planAutoWires(wires.map(w => ({...w, visible: undefined})), components),
  };
}
