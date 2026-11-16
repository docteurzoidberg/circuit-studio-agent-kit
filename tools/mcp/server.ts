// The kit's MCP server. Claude Code starts it over stdio with the session, so it is the one thing running while
// the user works; it holds the bridge the Circuit Studio page connects to (D23) and gives the agent the tools of
// the review: open the project in Circuit Studio, read back the user's edits. Logs go to stderr (stdout carries
// the protocol).
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {Bridge, findBuild} from '../bridge/bridge.ts';
import {applyEdits, changes, snapshot, type Placed, type Snapshot} from '../bridge/edits.ts';
import {openInBrowser} from '../bridge/open.ts';
import {readConfig, writeConfig} from '../config.ts';
import {kitPath, projectRoot} from '../project.ts';
import type {CsProject} from '../project/engine.ts';

const MANUAL = 'Without a Circuit Studio that has the automation API and the bridge (a build of the kit\'s fork on '
  + 'this machine until the author\'s site has them), the kit cannot load the project nor render: the user opens '
  + '.circuitstudio/project.c3dproj in Circuit Studio and saves it back themselves.';

const text = (value: string) => ({content: [{type: 'text' as const, text: value}]});

export class KitServer {
  readonly root: string;
  private bridge?: Bridge;
  private source = '';
  /** The page's project right after the kit opened it: what the user changed since is theirs. */
  private baseline?: Snapshot;
  private readonly log: (line: string) => void;

  constructor(root: string, log: (line: string) => void = line => process.stderr.write(`${line}\n`)) {
    this.root = root;
    this.log = log;
  }

  /** Starts (or restarts, when the Circuit Studio source changed) the bridge; saves a given source as the user's. */
  async ensureBridge(given: {from?: string; site?: string} = {}): Promise<Bridge | undefined> {
    const config = readConfig();
    if (given.from || given.site) {
      config.circuitStudio = given.from ? {build: resolve(given.from)} : {site: given.site};
    }
    config.bridgeToken ??= randomBytes(16).toString('hex');
    const studio = config.circuitStudio;
    if (!studio?.build && !studio?.site) return undefined;
    const build = studio.build ? findBuild(studio.build) : undefined;
    writeConfig(config);
    const source = build ?? studio.site!;
    if (this.bridge && this.source === source) return this.bridge;
    await this.bridge?.close();
    this.bridge = new Bridge({build, site: build ? undefined : studio.site, token: config.bridgeToken, log: this.log});
    this.source = source;
    await this.bridge.start();
    this.log(`bridge listening: ${this.bridge.pageUrl}`);
    return this.bridge;
  }

  status(): string {
    const studio = readConfig().circuitStudio;
    if (!this.bridge) return `No Circuit Studio configured for the bridge. ${MANUAL}`;
    return [
      `Circuit Studio: ${studio?.build ? `build on this machine (${studio.build})` : studio?.site}`,
      `page: ${this.bridge.connected ? 'connected' : 'not connected'}`,
      `link: ${this.bridge.pageUrl}`,
      `project: ${existsSync(kitPath(this.root, 'project.c3dproj')) ? '.circuitstudio/project.c3dproj' : 'none yet (run build)'}`,
    ].join('\n');
  }

  async open(options: {from?: string; site?: string; openBrowser?: boolean; waitSeconds?: number}): Promise<string> {
    const file = kitPath(this.root, 'project.c3dproj');
    if (!existsSync(file)) throw new Error('no .circuitstudio/project.c3dproj: run build first');
    const bridge = await this.ensureBridge(options);
    if (!bridge) throw new Error(MANUAL);
    if (!bridge.connected) {
      if (options.openBrowser !== false) await openInBrowser(bridge.pageUrl);
      if (!await bridge.waitForPage((options.waitSeconds ?? 90) * 1000)) {
        return `No Circuit Studio page connected. Ask the user to open this link in their browser, then call studio_open `
          + `again:\n${bridge.pageUrl}`;
      }
    }
    const summary = await bridge.call<{components: number; wires: number}>('openProject', [readFileSync(file, 'utf8')]);
    this.baseline = snapshot(await bridge.call<Placed>('getProject'));
    return `Opened .circuitstudio/project.c3dproj in Circuit Studio: ${summary.components} parts, ${summary.wires} wires.`;
  }

  /** Writes the parts the user moved and the routes they reshaped in the page into the project file. */
  async sync(): Promise<string> {
    const bridge = this.bridge;
    if (!bridge?.connected) throw new Error('no Circuit Studio page is connected: call studio_open first');
    const file = kitPath(this.root, 'project.c3dproj');
    const project = JSON.parse(readFileSync(file, 'utf8')) as CsProject;
    const edited = await bridge.call<Placed>('getProject');
    const now = snapshot(edited);
    // Without a baseline (the kit restarted), compare with the file: placements only, since the page normalises wires.
    const changed = this.baseline ? changes(this.baseline, now) : changes(snapshot(project), now, {wires: false});
    const told = applyEdits(project, edited, changed);
    if (told.length) writeFileSync(file, `${JSON.stringify(project, null, 1)}\n`);
    this.baseline = now;
    return told.length ? `Saved the user's edits into .circuitstudio/project.c3dproj:\n${told.join('\n')}`
      : 'No edit in Circuit Studio since the project was opened.';
  }

  async close(): Promise<void> {
    await this.bridge?.close();
  }
}

const guard = async (run: () => Promise<string> | string) => {
  try {
    return text(await run());
  } catch (error) {
    return {...text(`error: ${(error as Error).message}`), isError: true};
  }
};

export async function startMcp(cwd: string): Promise<void> {
  const kit = new KitServer(projectRoot(cwd));
  // Listening from the start lets a Circuit Studio page left open reconnect by itself.
  await kit.ensureBridge().catch(error => process.stderr.write(`bridge not started: ${(error as Error).message}\n`));
  const server = new McpServer({name: 'circuit-studio-agent-kit', version: '0.1.0'});
  server.registerTool('studio_status', {
    title: 'Circuit Studio status',
    description: 'Whether a Circuit Studio page is connected to the kit, the link that opens one, and the project file.',
  }, () => guard(() => kit.status()));
  server.registerTool('studio_open', {
    title: 'Open the project in Circuit Studio',
    description: 'Opens .circuitstudio/project.c3dproj in the Circuit Studio page connected to the kit; when none is, '
      + 'opens the link in the user\'s default browser first (ask the user before) and waits for the page. Call it '
      + 'again after each build to reload the project. `from` (a Circuit Studio build with the bridge) or `site` '
      + 'sets how the kit reaches Circuit Studio, kept for next time.',
    inputSchema: {
      from: z.string().optional().describe('Circuit Studio build folder (or checkout with dist/) served by the kit'),
      site: z.string().optional().describe('Circuit Studio site that has the automation API and the bridge'),
      openBrowser: z.boolean().optional().describe('Open the link in the default browser when no page is connected (default true)'),
      waitSeconds: z.number().optional().describe('How long to wait for the page to connect (default 90)'),
    },
  }, args => guard(() => kit.open(args)));
  server.registerTool('studio_sync', {
    title: 'Save the user\'s edits',
    description: 'Reads the project in the connected Circuit Studio page and writes the parts the user moved or '
      + 'turned and the wire routes they reshaped into .circuitstudio/project.c3dproj, where build keeps them. Call '
      + 'it before each build and before ending the review.',
  }, () => guard(() => kit.sync()));
  await server.connect(new StdioServerTransport());
}
