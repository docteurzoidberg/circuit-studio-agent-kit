// The kit's settings for this user, shared by their projects: how the kit reaches Circuit Studio (D23), chosen at
// `init` — a build on this machine, a site with the automation API and the bridge, or the manual way.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export interface KitConfig {
  circuitStudio?: {
    /** A Circuit Studio build served by the kit (a `dist/` folder, or a checkout holding one). */
    build?: string;
    /** A Circuit Studio site that has the automation API and the bridge. */
    site?: string;
  };
  /** The token the Circuit Studio page presents to the bridge; stable, so a page left open reconnects. */
  bridgeToken?: string;
}

export function configDir(): string {
  return process.env.CIRCUIT_STUDIO_KIT_CONFIG
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'circuit-studio-agent-kit');
}

export function readConfig(): KitConfig {
  const file = join(configDir(), 'config.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as KitConfig : {};
}

export function writeConfig(config: KitConfig): void {
  mkdirSync(configDir(), {recursive: true});
  writeFileSync(join(configDir(), 'config.json'), `${JSON.stringify(config, null, 1)}\n`);
}
