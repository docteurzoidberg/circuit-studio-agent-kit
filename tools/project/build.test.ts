// Tests of `build`, on a small project written in a temporary folder: a built-in part (from a local Circuit Studio
// checkout, which also gives the route planner), a prepared part and stand-ins. Skipped without the checkout.
//   npm test
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, beforeEach, describe, test} from 'node:test';
import {main} from '../cli.ts';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHECKOUT = join(KIT, 'circuit-studio', 'upstream');
const skip = !existsSync(join(CHECKOUT, 'src', 'autoRouting.ts')) && `${CHECKOUT} not present`;
const DOCUMENT = '# Test — wiring\n';

/** A prepared part as wiring-parts writes it (the asset is not a real model: build only embeds it). */
const SENSOR = {format: 'c3d-component', version: 1, part: {
  id: 'test-sensor', name: 'Test sensor', category: 'sensor', dimensions: [20, 12, 4], format: 'glb',
  asset: Buffer.from('glTF test asset').toString('base64'),
  geometry: {kind: 'model', quality: 'detailed', modelFormat: 'glb', modelAssetId: 'test-sensor', modelCenter: [0, 0, 0],
    origin: [0, 0, 0], calibrated: true},
  pins: [
    {id: 'P1', label: 'VCC', side: 'left', index: 0, localPosition: [-10, 2, 1], exitDirection: [-1, 0, 0], orientation: [0, 0, 0], electrical: 'passive'},
    {id: 'P2', label: 'DATA', side: 'left', index: 1, localPosition: [-10, 0, 1], exitDirection: [-1, 0, 0], orientation: [0, 0, 0], electrical: 'passive'},
    {id: 'P3', label: 'GND', side: 'left', index: 2, localPosition: [-10, -2, 1], exitDirection: [-1, 0, 0], orientation: [0, 0, 0], electrical: 'passive'},
  ]}};

interface Wiring {
  [key: string]: unknown;
  parts: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  layout?: Record<string, unknown>[];
}

function wiring(): Wiring {
  return {
    $schema: 'x', version: 1, title: 'Test',
    source: {path: '../wiring.md', sha256: createHash('sha256').update(DOCUMENT).digest('hex')},
    parts: [
      {name: 'MCU', kind: 'catalog', modelId: 'esp32-c6-supermini', line: 5},
      {name: 'Sensor', kind: 'prepared', ref: 'test-sensor', line: 6},
      {name: 'Buck', kind: 'stand-in', size: [22, 17, 4], pins: ['OUT+', 'OUT-'], line: 7},
    ],
    connections: [
      {color: 'red', from: {part: 'Buck', pin: 'OUT+'}, to: [{part: 'MCU', pin: 'J1-1', text: 'MCU 5V'}], line: 12},
      {color: 'black', from: {part: 'MCU', pin: 'J1-2'}, to: [{part: 'Sensor', pin: 'P3'}, {part: 'Buck', pin: 'OUT-'}], line: 13},
      {color: 'blue', from: {part: 'MCU', pin: 'J2-7'}, to: [{part: 'Sensor', pin: 'P2'}], line: 14},
      {color: 'orange', from: {part: 'MCU', pin: 'J1-3'}, to: [{part: 'Sensor', pin: 'P1'}], line: 15},
    ],
  };
}

let project: string;
const write = (relative: string, content: unknown) => {
  const file = join(project, relative);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};
const read = () => JSON.parse(readFileSync(join(project, '.circuitstudio', 'project.c3dproj'), 'utf8'));

async function build(w: Wiring = wiring()): Promise<{code: number; text: string}> {
  write('.circuitstudio/wiring.json', w);
  const lines: string[] = [];
  const code = await main(['build'], {cwd: project, out: line => lines.push(line), err: line => lines.push(line)});
  return {code, text: lines.join('\n')};
}

type Box = {id: string; position: number[]; rotation: number[]; dimensions: number[]};
const footprintsOverlap = (a: Box, b: Box) => {
  const half = (c: Box) => (c.rotation[2] % 180 === 0 ? [c.dimensions[0], c.dimensions[1]] : [c.dimensions[1], c.dimensions[0]]).map(v => v / 2);
  const [ax, ay] = half(a), [bx, by] = half(b);
  return Math.abs(a.position[0] - b.position[0]) < ax + bx && Math.abs(a.position[1] - b.position[1]) < ay + by;
};

describe('build', {skip}, () => {
  beforeEach(() => {
    if (project) rmSync(project, {recursive: true, force: true});
    project = mkdtempSync(join(tmpdir(), 'kit-build-'));
    write('wiring.md', DOCUMENT);
    write('.circuitstudio/catalog.json', {format: 'circuit-studio-catalog', version: 1, takenAt: '2026-11-16T00:00:00Z',
      source: {kind: 'local', path: CHECKOUT}, parts: [{modelId: 'esp32-c6-supermini', name: 'ESP32-C6 Supermini',
        export: 'X', offered: true, dimensions: [18, 28, 13], pinCount: 4,
        pins: ['J1-1', 'J1-2', 'J1-3', 'J2-7'].map(id => ({id, label: id}))}]});
    write('.circuitstudio/parts/test-sensor/test-sensor.c3dcomponent', SENSOR);
  });
  after(() => rmSync(project, {recursive: true, force: true}));

  test('generates a project Circuit Studio accepts, with every wire routed', async () => {
    const {code, text} = await build();
    assert.equal(code, 0, text);
    assert.match(text, /^\.circuitstudio\/project\.c3dproj: 3 parts, 5 wires/);
    assert.match(text, /routes: 5 wires, none blocked/);
    const p = read();
    assert.equal(p.name, 'Test');
    assert.deepEqual(p.components.map((c: Box & {modelId: string}) => [c.id, c.modelId]),
      [['mcu', 'esp32-c6-supermini'], ['sensor', 'custom:test-sensor'], ['buck', 'generic-pcb']]);
    assert.equal(p.assets['test-sensor'], SENSOR.part.asset);
    assert.deepEqual(p.wireOrder, p.wires.map((w: {id: string}) => w.id));
    assert.equal(p.wires[0].id, 'wire-buck-out-mcu-j1-1');
    assert.equal(p.wires[0].label, 'Buck OUT+ → MCU 5V');
    assert.deepEqual(p.wires.map((w: {color: string; routeMode: string}) => [w.color, w.routeMode])[1], ['#383d45', 'clean']);
    for (let i = 0; i < p.components.length; i++) {
      for (let j = i + 1; j < p.components.length; j++) assert.ok(!footprintsOverlap(p.components[i], p.components[j]), `${i} and ${j} overlap`);
    }
  });

  test('places parts from the layout hints', async () => {
    const w = wiring();
    w.layout = [{part: 'Sensor', x: -60, y: 10, rotation: 90}];
    const {code, text} = await build(w);
    assert.equal(code, 0, text);
    assert.match(text, /Sensor {2}layout {5}x -60, y 10, 90°/);
    const sensor = read().components.find((c: Box) => c.id === 'sensor');
    assert.deepEqual([sensor.position, sensor.rotation], [[-60, 10, 0], [0, 0, 90]]);
  });

  test('keeps the edits made in the editor and places new parts around them', async () => {
    await build();
    const edited = read();
    const [x, y] = edited.components[1].position;
    edited.components[1].position = [x + 5, y + 15, 0];
    Object.assign(edited.wires[3], {routeMode: 'manual', bendPoints: [[30, 30, 6]], color: '#ff00ff'});
    edited.camera = {position: [1, 2, 300], target: [1, 2, 0]};
    edited.presentation = {video: {fps: 24}};
    write('.circuitstudio/project.c3dproj', edited);

    const w = wiring();
    w.parts.push({name: 'LED', kind: 'stand-in', size: [5, 5, 3], pins: ['A', 'K'], line: 8});
    w.connections.push({color: 'green', from: {part: 'MCU', pin: 'J1-3'}, to: [{part: 'LED', pin: 'A'}], line: 16});
    const {code, text} = await build(w);
    assert.equal(code, 0, text);
    assert.match(text, new RegExp(`Sensor {2}kept {7}x ${x + 5}, y ${y + 15}, ${edited.components[1].rotation[2]}°`));
    assert.match(text, /LED {5}automatic/);
    assert.match(text, /1 route shape kept/);
    const p = read();
    const sensor = p.components.find((c: Box) => c.id === 'sensor');
    assert.deepEqual([sensor.position, sensor.rotation], [[x + 5, y + 15, 0], edited.components[1].rotation]);
    assert.deepEqual([p.wires[3].routeMode, p.wires[3].bendPoints, p.wires[3].color], ['manual', [[30, 30, 6]], '#2b60ae']);
    assert.deepEqual(p.camera, edited.camera);
    assert.deepEqual(p.presentation, edited.presentation);
    // The video settings chosen for the project (video.json) win, so the page's dialog shows them.
    write('.circuitstudio/video.json', {settings: {fps: 60, mode: 'orbit'}, scenes: []});
    await build(w);
    assert.deepEqual(read().presentation, {video: {fps: 60, mode: 'orbit'}, cameraScenes: []});
    rmSync(join(project, '.circuitstudio', 'video.json'));
    const led = p.components.find((c: Box) => c.id === 'led');
    for (const other of p.components.filter((c: Box) => c.id !== 'led')) assert.ok(!footprintsOverlap(led, other), `LED overlaps ${other.id}`);
  });

  test('never moves a part the user placed, and reports what it blocks', async () => {
    const w = wiring();
    w.parts.push({name: 'Cover', kind: 'stand-in', size: [200, 200, 40], pins: ['X'], line: 8});
    w.layout = [{part: 'Cover', x: 400, y: 0}];
    assert.equal((await build(w)).code, 0);
    const edited = read();
    // The user moves the MCU and lays the cover over it.
    edited.components.find((c: Box) => c.id === 'mcu').position = [300, 0, 0];
    edited.components.find((c: Box) => c.id === 'cover').position = [300, 0, 0];
    write('.circuitstudio/project.c3dproj', edited);
    delete w.layout;
    const {code, text} = await build(w);
    assert.equal(code, 1, text);
    assert.match(text, /MCU {5}kept {7}x 300, y 0, 0°/);
    assert.match(text, /Cover {3}kept {7}x 300, y 0, 0°/);
    assert.match(text, /routes: \d of 5 wires blocked/);
  });

  test('keeps an edit at every later build, until the part is reset', async () => {
    await build();
    const edited = read();
    edited.components.find((c: Box) => c.id === 'buck').position = [-90, -90, 0];
    write('.circuitstudio/project.c3dproj', edited);
    const w = wiring();
    w.layout = [{part: 'Buck', x: -80, y: -80}];
    for (let run = 0; run < 2; run++) assert.match((await build(w)).text, /Buck {4}kept {7}x -90, y -90, 0°/);
    write('.circuitstudio/wiring.json', w);
    const lines: string[] = [];
    assert.equal(await main(['build', '--reset', 'Buck'], {cwd: project, out: l => lines.push(l), err: l => lines.push(l)}), 0);
    assert.match(lines.join('\n'), /Buck {4}layout {5}x -80, y -80, 0°/);
    assert.match((await build(w)).text, /Buck {4}layout/);
  });

  test('moves parts as asked, as the user\'s edits, and tries placements without writing', async () => {
    await build();
    const before = readFileSync(join(project, '.circuitstudio', 'project.c3dproj'), 'utf8');
    write('.circuitstudio/wiring.json', wiring());
    const run = async (...args: string[]) => {
      const lines: string[] = [];
      const code = await main(['build', ...args], {cwd: project, out: l => lines.push(l), err: l => lines.push(l)});
      return {code, text: lines.join('\n')};
    };
    let r = await run('--move', 'Buck=-70,-60,90', '--dry-run');
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /\(dry run: nothing written\)/);
    assert.match(r.text, /Buck {4}moved {6}x -70, y -60, 90°/);
    assert.equal(readFileSync(join(project, '.circuitstudio', 'project.c3dproj'), 'utf8'), before);
    r = await run('--move', 'Buck=-70,-60');
    assert.match(r.text, /Buck {4}moved {6}x -70, y -60, 0°/);
    assert.match((await run()).text, /Buck {4}kept {7}x -70, y -60, 0°/);
    assert.match((await run('--move', 'Nope=1,2')).text, /not a part of the wiring/);
    assert.match((await run('--move', 'Buck=1')).text, /expected x,y or x,y,rotation/);
  });

  test('places again what the user did not edit, so a new layout hint applies', async () => {
    await build();
    const w = wiring();
    w.layout = [{part: 'Buck', x: -80, y: -80}];
    const {code, text} = await build(w);
    assert.equal(code, 0, text);
    assert.match(text, /MCU {5}automatic/);
    assert.match(text, /Buck {4}layout {5}x -80, y -80, 0°/);
  });

  test('takes a project without a state file as the user\'s placements', async () => {
    await build();
    rmSync(join(project, '.circuitstudio', 'build.json'));
    const w = wiring();
    w.layout = [{part: 'Buck', x: -80, y: -80}];
    const {text} = await build(w);
    assert.match(text, /Buck {4}kept/);
  });

  test('never turns a part standing up', async () => {
    write('.circuitstudio/parts/test-sensor/test-sensor.c3dcomponent', {...SENSOR, part: {...SENSOR.part, dimensions: [20, 12, 30]}});
    const {code, text} = await build();
    assert.equal(code, 0, text);
    assert.deepEqual(read().components.find((c: Box) => c.id === 'sensor').rotation, [0, 0, 0]);
  });

  test('reports wires that stay blocked, with their document line', async () => {
    const w = wiring();
    w.parts.push({name: 'Cover', kind: 'stand-in', size: [200, 200, 40], pins: ['X'], line: 8});
    w.layout = [{part: 'MCU', x: 0, y: 0}, {part: 'Cover', x: 0, y: 0}, {part: 'Sensor', x: 60, y: 0}, {part: 'Buck', x: -60, y: 0}];
    const {code, text} = await build(w);
    assert.equal(code, 1, text);
    assert.match(text, /routes: \d of 5 wires blocked/);
    assert.match(text, /^ {2}wiring\.md:1[2-5] {2}/m);
    assert.ok(existsSync(join(project, '.circuitstudio', 'project.c3dproj')));
  });

  test('refuses a prepared part converted without a model asset reference', async () => {
    const {modelAssetId, ...geometry} = SENSOR.part.geometry;
    write('.circuitstudio/parts/test-sensor/test-sensor.c3dcomponent', {...SENSOR, part: {...SENSOR.part, geometry}});
    const {code, text} = await build();
    assert.equal(code, 1);
    assert.ok(modelAssetId);
    assert.match(text, /Sensor: .*test-sensor\.c3dcomponent carries no model asset reference .*run part convert/);
  });

  test('refuses a wiring.json with problems', async () => {
    write('wiring.md', `${DOCUMENT}changed\n`);
    const {code, text} = await build();
    assert.equal(code, 1);
    assert.match(text, /wiring\.json has problems, fix them first/);
    assert.match(text, /resolve it again/);
  });
});
