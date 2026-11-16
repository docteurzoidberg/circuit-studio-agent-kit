// `studio`: the review of the generated project in Circuit Studio (D23). A background process of the kit holds the
// bridge the Circuit Studio page connects to; the skill starts it when the review begins and talks to it through
// the other `studio` commands, so the kit needs no MCP server and drives no browser.
//
//   studio open    starts the process if needed, opens the link in the user's browser when no page is connected,
//                  and opens .circuitstudio/project.c3dproj in the page (again after each build: it reloads)
//   studio sync    writes the parts the user moved and the routes they reshaped in the page into the project file
//   studio status  what is running and connected, and the link that opens the page
//   studio stop    stops the process
//
// The process listens on 127.0.0.1 only. Its control requests carry a token kept in `.circuitstudio/studio.json`,
// different from the page's token (which the page's link shows).
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Bridge, findBuild} from '../bridge/bridge.ts';
import {applyEdits, changes, snapshot, type Placed, type Snapshot} from '../bridge/edits.ts';
import {openInBrowser} from '../bridge/open.ts';
import {readConfig, writeConfig} from '../config.ts';
import {kitPath} from '../project.ts';
import type {CsProject} from '../project/engine.ts';

const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));

export const MANUAL = 'Without a Circuit Studio that has the automation API and the bridge (a build of the kit\'s fork '
  + 'on this machine until the author\'s site has them), the kit can neither load the project nor render: the user '
  + 'opens .circuitstudio/project.c3dproj in Circuit Studio and saves it back themselves.';

export interface StudioSource {
  /** A Circuit Studio build with the bridge, served by the kit (a `dist/` folder, or a checkout holding one). */
  from?: string;
  /** Or a Circuit Studio site that has the automation API and the bridge. */
  url?: string;
}

/** `.circuitstudio/studio.json`: the running process, for the other `studio` commands. */
interface StudioState {
  pid: number;
  port: number;
  control: string;
}

/** The review's state in the background process: the bridge, and the page's project as the kit opened it. */
export class Studio {
  readonly root: string;
  readonly bridge: Bridge;
  /** The page's project right after the kit opened it: what the user changed since is theirs. */
  private baseline?: Snapshot;

  private constructor(root: string, bridge: Bridge) {
    this.root = root;
    this.bridge = bridge;
  }

  /** Reads (and, when given, saves) how the kit reaches Circuit Studio, then starts the bridge. */
  static async start(root: string, given: StudioSource = {}, log: (line: string) => void = () => {}): Promise<Studio> {
    const config = readConfig();
    if (given.from || given.url) config.circuitStudio = given.from ? {build: resolve(given.from)} : {site: given.url};
    config.bridgeToken ??= randomBytes(16).toString('hex');
    const studio = config.circuitStudio;
    if (!studio?.build && !studio?.site) throw new Error(`no Circuit Studio configured (--from or --url). ${MANUAL}`);
    const build = studio.build ? findBuild(studio.build) : undefined;
    writeConfig(config);
    const bridge = new Bridge({build, site: build ? undefined : studio.site, token: config.bridgeToken, log});
    await bridge.start();
    return new Studio(root, bridge);
  }

  status(): string {
    return [
      `Circuit Studio: ${this.bridge.base}`,
      `page: ${this.bridge.connected ? 'connected' : 'not connected'}`,
      `link: ${this.bridge.pageUrl}`,
      `project: ${existsSync(kitPath(this.root, 'project.c3dproj')) ? '.circuitstudio/project.c3dproj' : 'none yet (run build)'}`,
    ].join('\n');
  }

  async open({browser = true, wait = 90}: {browser?: boolean; wait?: number} = {}): Promise<string> {
    const file = kitPath(this.root, 'project.c3dproj');
    if (!existsSync(file)) throw new Error('no .circuitstudio/project.c3dproj: run build first');
    if (!this.bridge.connected) {
      if (browser) await openInBrowser(this.bridge.pageUrl);
      if (!await this.bridge.waitForPage(wait * 1000)) {
        return `No Circuit Studio page connected. Open this link in the browser, then run studio open again:\n${this.bridge.pageUrl}`;
      }
    }
    const opened = !this.baseline;
    const summary = await this.bridge.call<{components: number; wires: number}>('openProject', [readFileSync(file, 'utf8')]);
    this.baseline = snapshot(await this.bridge.call<Placed>('getProject'));
    return `${opened ? 'Opened' : 'Reloaded'} .circuitstudio/project.c3dproj in the connected Circuit Studio page: `
      + `${summary.components} parts, ${summary.wires} wires.`;
  }

  /** Writes the parts the user moved and the routes they reshaped in the page into the project file. */
  async sync(): Promise<string> {
    if (!this.bridge.connected) throw new Error('no Circuit Studio page is connected: run studio open first');
    const file = kitPath(this.root, 'project.c3dproj');
    const project = JSON.parse(readFileSync(file, 'utf8')) as CsProject;
    const edited = await this.bridge.call<Placed>('getProject');
    const now = snapshot(edited);
    // Without a baseline (opened by an earlier process), compare with the file: placements only, since the page
    // normalises wires.
    const changed = this.baseline ? changes(this.baseline, now) : changes(snapshot(project), now, {wires: false});
    const told = applyEdits(project, edited, changed);
    if (told.length) writeFileSync(file, `${JSON.stringify(project, null, 1)}\n`);
    this.baseline = now;
    return told.length ? `Saved the user's edits into .circuitstudio/project.c3dproj:\n${told.join('\n')}`
      : 'No edit in Circuit Studio since the project was opened.';
  }

  /**
   * Renders the video in the connected page (D26): the user's edits are saved first, the page shows the project
   * file, and the MP4 (or WebM) goes to `.circuitstudio/media/`; a poster image only when asked.
   */
  async render(options: RenderOptions, progress: (line: string) => void): Promise<string> {
    const told: string[] = [];
    if (this.bridge.connected && this.baseline) told.push(await this.sync());
    const opened = await this.open({browser: options.browser, wait: options.wait});
    if (!this.bridge.connected) throw new Error(opened.replace('studio open again', 'render again'));
    const capabilities = await this.bridge.call<{mp4: boolean; webm: boolean}>('capabilities');
    if (!capabilities.mp4 && !capabilities.webm) {
      throw new Error('this browser can encode neither MP4 nor WebM video (WebCodecs): try a recent Chrome or Edge');
    }
    let last = '';
    const started = Date.now();
    const result = await this.bridge.call<RenderResult>('renderVideo', [{}, {}], value => {
      const {stage, percent} = value as {stage: string; percent: number};
      const line = `${stage} ${Math.floor(percent / 5) * 5}%`;
      if (line !== last) progress(`rendering: ${last = line}`);
    });
    const media = dirname(kitPath(this.root, 'media/video', {create: true}));
    const name = basename(result.filename).replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'wiring.mp4';
    const video = join(media, name);
    writeFileSync(video, Buffer.from(result.blob.$blob.base64, 'base64'));
    told.push(`Rendered .circuitstudio/media/${name}: ${(statSync(video).size / 1e6).toFixed(1)} MB, `
      + `${result.duration.toFixed(1)} s, ${result.frames} frames, in ${Math.round((Date.now() - started) / 1000)} s.`);
    for (const warning of result.warnings) told.push(`warning: ${warning}`);
    if (options.poster) {
      const image = await this.bridge.call<{$blob: {base64: string}}>('renderImage', [{width: 1920, height: 1080}]);
      const poster = name.replace(/\.\w+$/, '') + '.png';
      writeFileSync(join(media, poster), Buffer.from(image.$blob.base64, 'base64'));
      told.push(`Poster: .circuitstudio/media/${poster} (1920 × 1080, the project's camera view).`);
    }
    return told.filter(line => !line.startsWith('No edit')).join('\n');
  }

  close(): Promise<void> {
    return this.bridge.close();
  }
}

export interface RenderOptions {
  /** Also write a poster image (a still of the camera view), on request only (D26). */
  poster?: boolean;
  browser?: boolean;
  wait?: number;
}

interface RenderResult {
  blob: {$blob: {type: string; base64: string}};
  filename: string;
  frames: number;
  duration: number;
  warnings: string[];
}

const stateFile = (root: string) => kitPath(root, 'studio.json');

function readState(root: string): StudioState | null {
  if (!existsSync(stateFile(root))) return null;
  const state = JSON.parse(readFileSync(stateFile(root), 'utf8')) as StudioState;
  try {
    process.kill(state.pid, 0);
    return state;
  } catch {
    return null;
  }
}

/** Runs the background process: the bridge, and control requests from the other `studio` commands. */
export async function runStudio(root: string, source: StudioSource, log: (line: string) => void): Promise<void> {
  const running = readState(root);
  if (running) throw new Error(`studio is already running for this project (process ${running.pid})`);
  const studio = await Studio.start(root, source, log);
  const control = randomBytes(16).toString('hex');
  let finish!: () => void;
  const finished = new Promise<void>(done => { finish = done; });
  studio.bridge.control = async (action, body, progress) => {
    if (action === 'status') return studio.status();
    if (action === 'open') return studio.open(body as {browser?: boolean; wait?: number});
    if (action === 'sync') return studio.sync();
    if (action === 'render') return studio.render(body as RenderOptions, progress);
    if (action === 'stop') {
      setTimeout(finish, 50);
      return 'studio stopped';
    }
    throw new Error(`unknown studio action: ${action}`);
  };
  studio.bridge.controlToken = control;
  writeFileSync(stateFile(root), `${JSON.stringify({pid: process.pid, port: studio.bridge.port, control}, null, 1)}\n`);
  log(`studio: ${studio.bridge.pageUrl}`);
  process.once('SIGTERM', finish);
  process.once('SIGINT', finish);
  await finished;
  await studio.close();
  rmSync(stateFile(root), {force: true});
}

async function request(state: StudioState, action: string, body: object = {}, progress: (line: string) => void = () => {}): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${state.port}/__kit/${action}`, {
    method: 'POST', headers: {'content-type': 'application/json', 'x-kit-control': state.control},
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error(`studio answered ${response.status}`);
  let pending = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, {stream: true});
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const message = JSON.parse(pending.slice(0, at)) as {progress?: string; text?: string; error?: string};
      pending = pending.slice(at + 1);
      if (message.progress !== undefined) progress(message.progress);
      else if (message.error !== undefined) throw new Error(message.error);
      else return message.text!;
    }
  }
  throw new Error('studio closed the connection without an answer');
}

/** The review process's own files never belong in git: `.circuitstudio/.gitignore` says so, once. */
function ignoreRuntimeFiles(root: string): void {
  const file = kitPath(root, '.gitignore');
  const wanted = ['studio.json', 'studio.log'];
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n')
    : ['# Written by the Circuit Studio agent kit: files of its review process.'];
  const missing = wanted.filter(name => !lines.includes(name));
  if (!missing.length) return;
  mkdirSync(kitPath(root, ''), {recursive: true});
  writeFileSync(file, `${[...lines.filter(Boolean), ...missing].join('\n')}\n`);
}

/** Starts the background process for the project, detached, logging to `.circuitstudio/studio.log`. */
async function launch(root: string, source: StudioSource): Promise<StudioState> {
  ignoreRuntimeFiles(root);
  const logFile = openSync(kitPath(root, 'studio.log'), 'w');
  const args = [CLI, 'studio', 'start', ...(source.from ? ['--from', source.from] : []), ...(source.url ? ['--url', source.url] : [])];
  spawn(process.execPath, args, {cwd: root, detached: true, stdio: ['ignore', logFile, logFile]}).unref();
  for (const started = Date.now(); Date.now() - started < 15_000;) {
    const state = readState(root);
    if (state) return state;
    await new Promise(done => setTimeout(done, 200));
  }
  const log = existsSync(kitPath(root, 'studio.log')) ? readFileSync(kitPath(root, 'studio.log'), 'utf8').trim() : '';
  throw new Error(`studio did not start${log ? `: ${log.replace(/^error: /, '')}` : ''}`);
}

/** The `studio` commands other than `start`, and `render`. */
export async function studioCommand(root: string, action: string,
  options: StudioSource & RenderOptions & {browser?: boolean; wait?: number}, progress?: (line: string) => void): Promise<string> {
  let state = readState(root);
  if (action === 'stop') return state ? request(state, 'stop') : 'studio is not running';
  if (action === 'status' && !state) {
    const studio = readConfig().circuitStudio;
    return `studio is not running. Circuit Studio: ${studio?.build ?? studio?.site ?? `none configured. ${MANUAL}`}`;
  }
  if (!state) {
    if (action !== 'open' && action !== 'render') throw new Error('studio is not running: run studio open first');
    state = await launch(root, options);
  }
  return request(state, action, {browser: options.browser, wait: options.wait, poster: options.poster}, progress);
}
