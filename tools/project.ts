// The user's project as the kit sees it: its root and its `.circuitstudio/` folder.
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

export const KIT_FOLDER = '.circuitstudio';

function upwards(start: string, test: (dir: string) => boolean): string | null {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (test(dir)) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The project root: the nearest folder holding `.circuitstudio/`, from `cwd` upwards (as git finds `.git/`); else
 * the root of the git repository around `cwd`; else `cwd` itself.
 */
export function projectRoot(cwd: string = process.cwd()): string {
  return upwards(cwd, dir => existsSync(join(dir, KIT_FOLDER)))
    ?? upwards(cwd, dir => existsSync(join(dir, '.git')))
    ?? resolve(cwd);
}

/** Path inside the project's `.circuitstudio/`, creating the folders when `create` is set. */
export function kitPath(root: string, relative: string, {create = false}: {create?: boolean} = {}): string {
  const path = join(root, KIT_FOLDER, relative);
  if (create) mkdirSync(dirname(path), {recursive: true});
  return path;
}
