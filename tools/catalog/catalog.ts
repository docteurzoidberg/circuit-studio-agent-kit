// `part catalog`: snapshot of the Circuit Studio catalog into `.circuitstudio/catalog.json`.
//
// Sources, in order (D14): the automation API once upstream has it (not yet); a local Circuit Studio checkout,
// given with `--from` or the one the previous snapshot came from; the author's repository, only with `--download`
// (network: the wiring-parts skill asks the user first, D15). An existing snapshot of the same commit is kept unless
// `--force`.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {kitPath} from '../project.ts';
import {snapshotLocal, snapshotRepo, type CatalogSnapshot} from './snapshot.ts';

export const AUTHOR_REPOSITORY = 'arslansadiq87/circuit-studio';

export interface CatalogOptions {
  /** Local Circuit Studio checkout. */
  from?: string;
  /** Download the author's repository (network access). */
  download?: boolean;
  /** Git ref to download (default main). */
  ref?: string;
  /** Take the snapshot even when the existing one is of the same commit. */
  force?: boolean;
}

export interface CatalogResult {
  file: string;
  status: 'written' | 'up to date';
  snapshot: CatalogSnapshot;
}

function readSnapshot(file: string): CatalogSnapshot | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CatalogSnapshot;
  } catch {
    return null;
  }
}

function headCommit(checkout: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

/** Take the snapshot for the project at `root`. */
export async function catalog(root: string, options: CatalogOptions = {}): Promise<CatalogResult> {
  const file = kitPath(root, 'catalog.json', {create: true});
  const previous = readSnapshot(file);
  const previousLocal = previous?.source.kind === 'local' ? previous.source : null;
  let checkout = options.from ? resolve(options.from) : null;
  if (!checkout && !options.download && previousLocal && existsSync(previousLocal.path)) checkout = previousLocal.path;
  if (!checkout && !options.download) {
    throw new Error('no Circuit Studio source: give a local checkout with --from <folder>, '
      + `or --download to fetch github.com/${AUTHOR_REPOSITORY} (network access)`);
  }
  if (checkout && previous && !options.force && previousLocal?.path === checkout && previousLocal.commit
    && previousLocal.commit === headCommit(checkout)) {
    return {file, status: 'up to date', snapshot: previous};
  }
  const snapshot = checkout ? await snapshotLocal(checkout) : await snapshotRepo(AUTHOR_REPOSITORY, options.ref ?? 'main');
  writeFileSync(file, JSON.stringify(snapshot, null, 1) + '\n');
  return {file, status: 'written', snapshot};
}

/** One-line summary for the command line. */
export function describe({file, status, snapshot}: CatalogResult): string {
  const s = snapshot.source;
  const where = s.kind === 'local' ? s.path : s.repository;
  const offered = snapshot.parts.filter(p => p.offered).length;
  return `${file}: ${status}, ${snapshot.parts.length} parts (${offered} offered in the app) from ${where}`
    + ` at ${(s.commit ?? 'unknown commit').slice(0, 7)}`;
}
