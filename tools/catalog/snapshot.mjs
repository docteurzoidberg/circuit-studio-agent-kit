#!/usr/bin/env node
// Snapshot of the Circuit Studio built-in parts catalog, read from Circuit Studio's sources.
//
//   node tools/catalog/snapshot.mjs --from <circuit-studio checkout> [--out catalog.json]
//   node tools/catalog/snapshot.mjs --repo <owner/name> [--ref main] [--out catalog.json]   (network: ask first)
//
// Until Circuit Studio exposes its catalog through the automation API (listParts), the parts are read from the
// sources: src/model.ts is bundled with esbuild (zod and three come from this kit's dependencies) and every
// exported component (a `*_COMPONENT` constant with a modelId and pins) is collected. The snapshot records where it
// comes from (local checkout or repository, commit) so a skill can say which Circuit Studio it describes.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function pinInfo(pin) {
  const info = {id: pin.id, label: pin.label};
  for (const key of ['silkscreen', 'aliases', 'functions', 'electrical']) if (pin[key] !== undefined) info[key] = pin[key];
  return info;
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

async function loadModule(entry, work, name) {
  const out = join(work, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    nodePaths: [join(KIT_ROOT, 'node_modules')], loader: {'.json': 'json'},
  });
  return import(pathToFileURL(out).href);
}

/** modelIds of the parts the app offers to add: src/catalog.ts when present, else the list in src/store.ts. */
async function offeredModelIds(root, work, module) {
  const catalog = join(root, 'src', 'catalog.ts');
  if (existsSync(catalog)) {
    const {BUILT_IN_COMPONENTS} = await loadModule(catalog, work, 'catalog');
    if (Array.isArray(BUILT_IN_COMPONENTS)) return new Set(BUILT_IN_COMPONENTS.map(c => c.modelId));
  }
  const store = join(root, 'src', 'store.ts');
  if (existsSync(store)) {
    const list = readFileSync(store, 'utf8').match(/\[([A-Z0-9_,\s]+)\]\.find\(\s*c\s*=>\s*c\.modelId\s*===\s*modelId\s*\)/);
    if (list) return new Set(list[1].split(',').map(n => module[n.trim()]?.modelId).filter(Boolean));
  }
  return undefined;
}

/** Load the components exported by <root>/src/model.ts. */
export async function loadComponents(root) {
  const entry = join(root, 'src', 'model.ts');
  if (!existsSync(entry)) throw new Error(`${root}: no src/model.ts, not a Circuit Studio checkout`);
  const work = mkdtempSync(join(tmpdir(), 'cs-catalog-'));
  try {
    const module = await loadModule(entry, work, 'model');
    const offered = await offeredModelIds(root, work, module);
    const parts = [];
    const seen = new Set();
    for (const [name, value] of Object.entries(module)) {
      if (!name.endsWith('_COMPONENT') || !value || typeof value.modelId !== 'string' || !Array.isArray(value.pins)) continue;
      if (seen.has(value.modelId)) continue;
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
export async function snapshotLocal(root) {
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
export async function snapshotRepo(repo, ref = 'main') {
  const work = mkdtempSync(join(tmpdir(), 'cs-repo-'));
  try {
    const api = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,
      {headers: {accept: 'application/vnd.github+json'}});
    if (!api.ok) throw new Error(`${repo}@${ref}: GitHub answered ${api.status}`);
    const commit = (await api.json()).sha;
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!['from', 'repo', 'ref', 'out'].includes(key)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = argv[++i];
  }
  if (!!args.from === !!args.repo) throw new Error('give exactly one of --from <checkout> or --repo <owner/name>');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = args.from ? await snapshotLocal(args.from) : await snapshotRepo(args.repo, args.ref);
  const text = JSON.stringify(snapshot, null, 1) + '\n';
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), {recursive: true});
    writeFileSync(args.out, text);
  } else {
    process.stdout.write(text);
  }
  const s = snapshot.source;
  console.error(`${snapshot.parts.length} parts from ${s.kind === 'local' ? s.path : s.repository}` +
    ` at ${(s.commit ?? 'unknown commit').slice(0, 7)}${args.out ? ` -> ${args.out}` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
