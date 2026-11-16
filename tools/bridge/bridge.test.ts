import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {WebSocket} from 'ws';
import {main} from '../cli.ts';
import {Studio} from '../studio/studio.ts';
import type {CsProject} from '../project/engine.ts';
import {Bridge, CLOSE_REJECTED, CLOSE_REPLACED, findBuild} from './bridge.ts';
import {applyEdits, changes, snapshot} from './edits.ts';
import {openCommand} from './open.ts';

const temp = mkdtempSync(join(tmpdir(), 'kit-bridge-'));
const build = join(temp, 'circuit-studio', 'dist');
mkdirSync(join(build, 'assets'), {recursive: true});
writeFileSync(join(build, 'index.html'), '<!doctype html><title>Circuit Studio</title>');
writeFileSync(join(build, 'assets', 'index.js'), "const BRIDGE_PROTOCOL='circuit-studio-bridge/1'");
process.env.CIRCUIT_STUDIO_KIT_CONFIG = join(temp, 'config');

const project = (): CsProject => ({
  schemaVersion: 1, name: 'Demo', camera: {position: [0, -100, 200], target: [0, 0, 0]},
  components: [
    {id: 'mcu', modelId: 'generic-pcb', name: 'MCU', position: [0, 0, 0], rotation: [0, 0, 0], pins: []},
    {id: 'led', modelId: 'generic-pcb', name: 'LED', position: [40, 0, 0], rotation: [0, 0, 0], pins: []},
  ],
  wires: [{id: 'w1', from: {componentId: 'mcu', pinId: 'a'}, to: {componentId: 'led', pinId: 'b'}, color: '#bf3128',
    diameter: 1.1, label: 'MCU A → LED B', curvature: 19, routeMode: 'clean'}],
  assets: {model: 'AAAA'},
});

/** A fake Circuit Studio page: connects like the real one and answers from a project it holds. */
async function page(bridge: Bridge, {token = bridge.token, origin = bridge.base.replace(/\/$/, '')} = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`, {origin});
  let held: CsProject | undefined;
  let welcome: {type?: string; client?: string} | undefined;
  const closed = new Promise<number>(resolve => ws.on('close', code => resolve(code)));
  ws.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.type) {
      welcome = message;
      return;
    }
    const {id, method, params} = message;
    if (method === 'openProject') {
      held = JSON.parse(params[0]);
      ws.send(JSON.stringify({id, result: {name: held!.name, components: held!.components.length, wires: held!.wires.length}}));
    } else if (method === 'getProject') ws.send(JSON.stringify({id, result: {...held, assets: undefined}}));
    else if (method === 'renderVideo') {
      ws.send(JSON.stringify({id, progress: {progress: 0.5}}));
      ws.send(JSON.stringify({id, result: {frames: 2}}));
    } else ws.send(JSON.stringify({id, error: {message: `Unknown method: ${method}`}}));
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', () => reject(new Error('refused')));
  }).then(() => ws.send(JSON.stringify({type: 'hello', token, protocol: 'circuit-studio-bridge/1', api: 1})));
  return {ws, closed, held: () => held!, welcome: () => welcome, edit: (change: (p: CsProject) => void) => change(held!)};
}

after(() => rmSync(temp, {recursive: true, force: true}));

describe('edits', () => {
  test('finds the parts moved or turned and the routes reshaped, and writes them into the file', () => {
    const file = project(), edited = project();
    edited.components[1].position = [60, 20, 0];
    edited.components[0].rotation = [0, 0, 0.004];  // below the tolerance: not an edit
    edited.wires[0].bendPoints = [[10, 10, 0]];
    edited.wires[0].routeMode = 'manual';
    const changed = changes(snapshot(file), snapshot(edited));
    assert.deepEqual(changed, {parts: ['led'], wires: ['w1']});
    assert.deepEqual(changes(snapshot(file), snapshot(edited), {wires: false}).wires, []);
    assert.deepEqual(applyEdits(file, edited, changed), ['LED x 60, y 20, 0°', 'wire MCU A → LED B: route reshaped']);
    assert.deepEqual(file.components[1].position, [60, 20, 0]);
    assert.equal(file.wires[0].routeMode, 'manual');
    assert.deepEqual(file.assets, {model: 'AAAA'});
  });
});

describe('open in the browser', () => {
  test('uses the system\'s own way, PowerShell under WSL', () => {
    const [command, args] = openCommand("http://127.0.0.1:5199/#bridge=ws://127.0.0.1:5199/bridge&token=a'b", true);
    assert.match(command, /powershell\.exe$/);
    assert.equal(args.at(-1), "Start-Process 'http://127.0.0.1:5199/#bridge=ws://127.0.0.1:5199/bridge&token=a''b'");
  });
});

describe('bridge', () => {
  let bridge: Bridge;
  before(async () => {
    bridge = new Bridge({build: findBuild(join(temp, 'circuit-studio'))});
    await bridge.start();
  });
  after(() => bridge.close());

  test('serves the build, and links to it with the bridge address and token', async () => {
    assert.match(bridge.pageUrl, new RegExp(`^http://127\\.0\\.0\\.1:${bridge.port}/#bridge=ws://127\\.0\\.0\\.1:${bridge.port}/bridge&token=[0-9a-f]{32}$`));
    assert.match(await (await fetch(bridge.base)).text(), /Circuit Studio/);
    assert.match(await (await fetch(`${bridge.base}some/route`)).text(), /Circuit Studio/);
    assert.equal((await fetch(`${bridge.base}assets/index.js`)).headers.get('content-type'), 'text/javascript');
  });

  test('refuses a build without the bridge', () => {
    const plain = join(temp, 'plain');
    mkdirSync(join(plain, 'assets'), {recursive: true});
    writeFileSync(join(plain, 'index.html'), '');
    writeFileSync(join(plain, 'assets', 'index.js'), '');
    assert.throws(() => findBuild(plain), /no bridge to the kit/);
  });

  test('refuses another origin and a wrong token', async () => {
    await assert.rejects(page(bridge, {origin: 'https://example.com'}));
    const wrong = await page(bridge, {token: 'nope'});
    assert.equal(await wrong.closed, CLOSE_REJECTED);
    assert.equal(bridge.connected, false);
  });

  test('calls the page, with progress, and lets a newer page take over', async () => {
    const first = await page(bridge);
    assert.equal(await bridge.waitForPage(2000), true);
    for (let i = 0; i < 50 && !first.welcome(); i++) await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(first.welcome(), {type: 'welcome', client: 'Circuit Studio agent kit'});
    const progress: unknown[] = [];
    assert.deepEqual(await bridge.call('renderVideo', [{}], p => progress.push(p)), {frames: 2});
    assert.deepEqual(progress, [{progress: 0.5}]);
    await assert.rejects(bridge.call('nope'), /Unknown method: nope/);
    const second = await page(bridge);
    assert.equal(await first.closed, CLOSE_REPLACED);
    assert.equal(bridge.connected, true);
    second.ws.close();
    await second.closed;
    await assert.rejects(bridge.call('getProject'), /no Circuit Studio page/);
  });
});

describe('studio', () => {
  const root = join(temp, 'project');
  const file = join(root, '.circuitstudio', 'project.c3dproj');
  before(() => {
    mkdirSync(join(root, '.circuitstudio'), {recursive: true});
    writeFileSync(file, JSON.stringify(project()));
  });

  test('opens the project in the page, then saves the user\'s edits into the file', async () => {
    const studio = await Studio.start(root, {from: join(temp, 'circuit-studio')});
    try {
      assert.match(await studio.open({browser: false, wait: 0.2}), /No Circuit Studio page connected[\s\S]*#bridge=/);
      const fake = await page(studio.bridge);
      assert.match(await studio.open({browser: false}), /^Opened .*2 parts, 1 wires/);
      assert.match(await studio.open({browser: false}), /^Reloaded/);
      assert.match(await studio.sync(), /No edit/);
      fake.edit(p => { p.components[0].position = [-30, 10, 0]; p.components[0].rotation = [0, 0, 180]; });
      assert.match(await studio.sync(), /MCU x -30, y 10, 180°/);
      const saved = JSON.parse(readFileSync(file, 'utf8')) as CsProject;
      assert.deepEqual(saved.components[0].position, [-30, 10, 0]);
      assert.deepEqual(saved.assets, {model: 'AAAA'});
      assert.match(studio.status(), /page: connected/);
    } finally {
      await studio.close();
    }
  });

  test('runs in the background and answers the other studio commands', async () => {
    const lines: string[] = [];
    const run = async (...args: string[]) => {
      lines.length = 0;
      const code = await main(['studio', ...args], {cwd: root, out: l => lines.push(l), err: l => lines.push(l)});
      return {code, text: lines.join('\n')};
    };
    assert.match((await run('status')).text, /not running/);
    assert.match((await run('sync')).text, /run studio open first/);
    // Started by `studio open`, detached; nothing connects, so it hands back the link.
    const opened = await run('open', '--from', join(temp, 'circuit-studio'), '--no-browser', '--wait', '0.2');
    assert.equal(opened.code, 0, opened.text);
    assert.match(opened.text, /No Circuit Studio page connected[\s\S]*#bridge=ws:\/\/127\.0\.0\.1:\d+\/bridge&token=/);
    const state = JSON.parse(readFileSync(join(root, '.circuitstudio', 'studio.json'), 'utf8'));
    assert.match((await run('status')).text, /page: not connected/);
    // Control requests need the control token, and never come from a page.
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/__kit/status`, {method: 'POST'})).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/__kit/status`, {method: 'POST',
      headers: {'x-kit-control': state.control, origin: 'https://example.com'}})).status, 403);
    assert.equal(readFileSync(join(root, '.circuitstudio', '.gitignore'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).join(' '), 'studio.json studio.log');
    assert.match((await run('stop')).text, /stopped/);
    for (let i = 0; i < 50 && (await run('status')).text.includes('page:'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match((await run('status')).text, /not running/);
  });
});
