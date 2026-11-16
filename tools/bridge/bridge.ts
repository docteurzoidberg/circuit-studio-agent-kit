// The kit's end of the bridge to Circuit Studio (D23): a server on 127.0.0.1 that the Circuit Studio page connects
// to, opened with `#bridge=ws://127.0.0.1:<port>/bridge&token=<token>` (docs/AUTOMATION_API.md#bridge in the fork).
// The page then runs the kit's requests through its automation API; the kit drives no browser. When the kit uses a
// build of Circuit Studio on this machine, the same server serves it, so the page and the bridge share an origin.
import {randomBytes} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {extname, join, normalize, sep} from 'node:path';
import {WebSocket, WebSocketServer} from 'ws';

export const BRIDGE_PORT = 5199;
const PORTS = 10;
const PATH = '/bridge';

/** Close codes the page understands: it stops reconnecting on these. */
export const CLOSE_REPLACED = 4000;
export const CLOSE_REJECTED = 4001;

export interface BridgeOptions {
  /** A Circuit Studio build with the automation API and the bridge, served by the kit (its `dist/` folder). */
  build?: string;
  /** Or a Circuit Studio site that has them. */
  site?: string;
  /** The token pages must present; a stable one lets a page left open reconnect after the kit restarts. */
  token?: string;
  /** First port to try (default 5199; the next ones when taken, e.g. by another session). */
  port?: number;
  log?: (line: string) => void;
}

type Pending = {resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (value: unknown) => void};

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/** The folder of a Circuit Studio build, from a build folder or a checkout holding `dist/`. */
export function findBuild(from: string): string {
  const dir = [join(from, 'dist'), from].find(d => existsSync(join(d, 'index.html')) && existsSync(join(d, 'assets')));
  if (!dir) throw new Error(`${from}: no Circuit Studio build (dist/index.html): run npm run build in the checkout`);
  const scripts = readdirSync(join(dir, 'assets')).filter(f => f.endsWith('.js'));
  if (!scripts.some(f => readFileSync(join(dir, 'assets', f), 'utf8').includes('Automation client'))) {
    throw new Error(`${dir}: this Circuit Studio build has no bridge to the kit; until the author's version has it, `
      + 'build the kit\'s fork (branch feat/kit-bridge of docteurzoidberg/circuit-studio)');
  }
  return dir;
}

export class Bridge {
  readonly token: string;
  private readonly options: BridgeOptions;
  private server?: Server;
  private sockets?: WebSocketServer;
  private page?: WebSocket;
  private readonly pending = new Map<number, Pending>();
  private next = 1;
  private waiting: (() => void)[] = [];
  port = 0;

  constructor(options: BridgeOptions) {
    if (!options.build && !options.site) throw new Error('the bridge needs a Circuit Studio build or site');
    this.options = options;
    this.token = options.token ?? randomBytes(16).toString('hex');
  }

  private log(line: string) {
    this.options.log?.(line);
  }

  /** The page's address: the served build or the site. */
  get base(): string {
    return this.options.build ? `http://127.0.0.1:${this.port}/` : this.options.site!;
  }

  /** The link that opens Circuit Studio connected to this bridge. */
  get pageUrl(): string {
    return `${this.base}#bridge=ws://127.0.0.1:${this.port}${PATH}&token=${this.token}`;
  }

  get connected(): boolean {
    return this.page?.readyState === WebSocket.OPEN;
  }

  private allowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (this.options.build) return origin === `http://127.0.0.1:${this.port}` || origin === `http://localhost:${this.port}`;
    return origin === new URL(this.options.site!).origin;
  }

  private serveFile(request: IncomingMessage, response: ServerResponse) {
    const build = this.options.build;
    if (!build) {
      response.writeHead(404).end();
      return;
    }
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(build, path));
    if (!file.startsWith(build + sep) && file !== build) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(build, 'index.html');
    response.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream'});
    response.end(readFileSync(file));
  }

  /** Listens on the first free port from `port`; resolves with it. */
  async start(): Promise<number> {
    const first = this.options.port ?? BRIDGE_PORT;
    this.sockets = new WebSocketServer({noServer: true, maxPayload: 512 * 1024 * 1024});
    for (let port = first; port < first + PORTS; port++) {
      const server = createServer((request, response) => this.serveFile(request, response));
      server.on('upgrade', (request, socket, head) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== PATH || !this.allowedOrigin(request.headers.origin)) {
          socket.destroy();
          return;
        }
        this.sockets!.handleUpgrade(request, socket, head, ws => this.accept(ws));
      });
      const listening = await new Promise<boolean>(resolve => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (listening) {
        this.server = server;
        this.port = port;
        return port;
      }
    }
    throw new Error(`no free port for the bridge in ${first}-${first + PORTS - 1}`);
  }

  /** A page's connection: kept once it presents the token; it replaces an earlier page. */
  private accept(ws: WebSocket) {
    const timeout = setTimeout(() => ws.close(CLOSE_REJECTED, 'no hello'), 5000);
    ws.once('message', data => {
      clearTimeout(timeout);
      let hello: {type?: string; token?: string};
      try {
        hello = JSON.parse(String(data));
      } catch {
        hello = {};
      }
      if (hello.type !== 'hello' || hello.token !== this.token) {
        ws.close(CLOSE_REJECTED, 'wrong token');
        return;
      }
      if (this.page && this.page !== ws) this.page.close(CLOSE_REPLACED, 'another page took over');
      this.page = ws;
      this.log('Circuit Studio page connected');
      ws.on('message', message => this.receive(String(message)));
      ws.on('close', () => {
        if (this.page !== ws) return;
        this.page = undefined;
        this.log('Circuit Studio page disconnected');
        for (const waiting of this.pending.values()) waiting.reject(new Error('the Circuit Studio page was closed'));
        this.pending.clear();
      });
      for (const resolve of this.waiting.splice(0)) resolve();
    });
  }

  private receive(text: string) {
    const message = JSON.parse(text) as {id?: number; result?: unknown; error?: {message: string}; progress?: unknown};
    const waiting = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!waiting) return;
    if ('progress' in message) {
      waiting.progress?.(message.progress);
      return;
    }
    this.pending.delete(message.id!);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  }

  /** Resolves true once a page is connected, false after `timeout` ms. */
  waitForPage(timeout: number): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter(w => w !== done);
        resolve(false);
      }, timeout);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiting.push(done);
    });
  }

  /** Calls `window.circuitStudio[method](...params)` in the page. */
  call<T>(method: string, params: unknown[] = [], progress?: (value: unknown) => void): Promise<T> {
    const page = this.page;
    if (!page || page.readyState !== WebSocket.OPEN) return Promise.reject(new Error('no Circuit Studio page is connected'));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject, progress});
      page.send(JSON.stringify({id, method, params}));
    });
  }

  async close(): Promise<void> {
    this.page?.close();
    this.sockets?.close();
    await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
  }
}
