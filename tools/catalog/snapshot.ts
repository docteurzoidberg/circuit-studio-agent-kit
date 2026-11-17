// Snapshot of the Circuit Studio built-in parts catalog, read from Circuit Studio's sources
// (command `part catalog`, see catalog.ts).
//
// Until Circuit Studio exposes its catalog through the automation API (listParts), the parts are read from the
// sources: src/model.ts is bundled with esbuild (zod, three, zustand and react come from this kit's dependencies
// when the sources have none) and every exported component (a `*_COMPONENT` constant with a modelId and pins) is
// collected, from model.ts and from the other modules of src/ that define one (src/arduinoUno.ts). The snapshot records where it
// comes from (local checkout or repository, commit) so a skill can say which Circuit Studio it describes.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A pin of a catalog part, as Circuit Studio defines it (only the fields a skill needs). */
export interface CatalogPin {
  id: string;
  label: string;
  silkscreen?: string;
  aliases?: string[];
  functions?: string[];
  electrical?: string;
}

export interface CatalogPart {
  modelId: string;
  name: string;
  /** Name of the constant that defines the part in Circuit Studio's sources (src/model.ts or another module). */
  export: string;
  /** Whether the app offers the part in its add list; null when the sources do not say. */
  offered: boolean | null;
  /** Width, depth, height in mm. */
  dimensions: [number, number, number];
  pinCount: number;
  pins: CatalogPin[];
}

export type CatalogSource =
  | {kind: 'local'; path: string; commit?: string; branch?: string; remote?: string}
  | {kind: 'repository'; repository: string; ref: string; commit: string};

/** Content of `.circuitstudio/catalog.json`. */
export interface CatalogSnapshot {
  format: 'circuit-studio-catalog';
  version: 1;
  takenAt: string;
  source: CatalogSource;
  parts: CatalogPart[];
}

/** A component constant of Circuit Studio's sources, as far as the snapshot reads it. */
interface SourceComponent {
  modelId: string;
  name: string;
  dimensions: [number, number, number];
  pins: (CatalogPin & Record<string, unknown>)[];
}

const isComponent = (value: unknown): value is SourceComponent =>
  typeof value === 'object' && value !== null && typeof (value as SourceComponent).modelId === 'string'
  && Array.isArray((value as SourceComponent).pins);

function pinInfo(pin: SourceComponent['pins'][number]): CatalogPin {
  const info: CatalogPin = {id: pin.id, label: pin.label};
  if (pin.silkscreen !== undefined) info.silkscreen = pin.silkscreen;
  if (pin.aliases !== undefined) info.aliases = pin.aliases;
  if (pin.functions !== undefined) info.functions = pin.functions;
  if (pin.electrical !== undefined) info.electrical = pin.electrical;
  return info;
}

function git(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

/**
 * Source of a module that exports everything src/model.ts exports, plus the `*_COMPONENT` constants other modules
 * of src/ define without model.ts re-exporting them (model.ts imports src/arduinoUno.ts's part, for instance).
 */
export function componentsModule(root: string): string {
  const src = join(root, 'src');
  const lines = [`export * from ${JSON.stringify(join(src, 'model.ts'))};`];
  for (const file of readdirSync(src).filter(f => f.endsWith('.ts') && f !== 'model.ts').sort()) {
    const names = [...readFileSync(join(src, file), 'utf8').matchAll(/^export const ([A-Z0-9_]+_COMPONENT)\b/gm)]
      .map(m => m[1]);
    if (names.length) lines.push(`export {${names.join(', ')}} from ${JSON.stringify(join(src, file))};`);
  }
  return lines.join('\n') + '\n';
}

/** Bundle the components of the sources (componentsModule) with their dependencies and import them. */
async function loadModule(root: string, work: string): Promise<Record<string, unknown>> {
  const entry = join(work, 'components.ts'), out = join(work, 'components.mjs');
  writeFileSync(entry, componentsModule(root));
  await esbuild.build({
    entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    nodePaths: [join(KIT_ROOT, 'node_modules')], loader: {'.json': 'json'},
  });
  return import(pathToFileURL(out).href);
}

/** modelIds of the parts the app offers to add, read from the list in src/store.ts (undefined when not found). */
function offeredModelIds(root: string, module: Record<string, unknown>): Set<string> | undefined {
  const store = join(root, 'src', 'store.ts');
  if (!existsSync(store)) return undefined;
  const list = readFileSync(store, 'utf8').match(/\[([A-Z0-9_,\s]+)\]\.find\(\s*c\s*=>\s*c\.modelId\s*===\s*modelId\s*\)/);
  if (!list) return undefined;
  return new Set(list[1].split(',').map(n => module[n.trim()]).filter(isComponent).map(c => c.modelId));
}

/** Load the components defined by the sources of the checkout at <root>. */
export async function loadComponents(root: string): Promise<CatalogPart[]> {
  const entry = join(root, 'src', 'model.ts');
  if (!existsSync(entry)) throw new Error(`${root}: no src/model.ts, not a Circuit Studio checkout`);
  const work = mkdtempSync(join(tmpdir(), 'cs-catalog-'));
  try {
    const module = await loadModule(root, work);
    const offered = offeredModelIds(root, module);
    const parts: CatalogPart[] = [];
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(module)) {
      if (!name.endsWith('_COMPONENT') || !isComponent(value) || seen.has(value.modelId)) continue;
      seen.add(value.modelId);
      parts.push({modelId: value.modelId, name: value.name, export: name,
        offered: offered ? offered.has(value.modelId) : null, dimensions: value.dimensions,
        pinCount: value.pins.length, pins: value.pins.map(pinInfo)});
    }
    return parts.sort((a, b) => a.modelId.localeCompare(b.modelId));
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

/** Snapshot of a local checkout. */
export async function snapshotLocal(root: string): Promise<CatalogSnapshot> {
  root = resolve(root);
  const parts = await loadComponents(root);
  return {
    format: 'circuit-studio-catalog', version: 1, takenAt: new Date().toISOString(),
    source: {kind: 'local', path: root, commit: git(root, 'rev-parse', 'HEAD'),
      branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), remote: git(root, 'remote', 'get-url', 'origin')},
    parts,
  };
}

/** Snapshot of a GitHub repository at a ref, downloaded as a source archive (network access). */
export async function snapshotRepo(repo: string, ref = 'main'): Promise<CatalogSnapshot> {
  const work = mkdtempSync(join(tmpdir(), 'cs-repo-'));
  try {
    const api = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,
      {headers: {accept: 'application/vnd.github+json'}});
    if (!api.ok) throw new Error(`${repo}@${ref}: GitHub answered ${api.status}`);
    const commit = ((await api.json()) as {sha: string}).sha;
    const archive = await fetch(`https://codeload.github.com/${repo}/tar.gz/${commit}`);
    if (!archive.ok) throw new Error(`${repo}@${commit}: archive download failed (${archive.status})`);
    const file = join(work, 'source.tar.gz');
    writeFileSync(file, Buffer.from(await archive.arrayBuffer()));
    const dir = join(work, 'source');
    mkdirSync(dir);
    execFileSync('tar', ['-xzf', file, '-C', dir, '--strip-components=1', '--wildcards', '*/src/*']);
    const parts = await loadComponents(dir);
    return {
      format: 'circuit-studio-catalog', version: 1, takenAt: new Date().toISOString(),
      source: {kind: 'repository', repository: `https://github.com/${repo}`, ref, commit}, parts,
    };
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}
