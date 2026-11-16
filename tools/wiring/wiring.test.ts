// Tests of `part pins` and `wiring`, on a small project written in a temporary folder: a catalog snapshot with one
// built-in part, one prepared part, a stand-in, a wiring document and the wiring.json resolved from it.
//   npm test
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, beforeEach, describe, test} from 'node:test';
import {main} from '../cli.ts';

const DOCUMENT = '# Test — wiring\n\n| Name | Part |\n|---|---|\n| Board | test-board |\n';

const CATALOG = {
  format: 'circuit-studio-catalog', version: 1, takenAt: '2026-11-16T00:00:00Z', source: {kind: 'local', path: '/cs'},
  parts: [{modelId: 'test-mcu', name: 'Test MCU', export: 'TEST_MCU', offered: true, dimensions: [20, 10, 3], pinCount: 4,
    pins: [
      {id: 'J1-1', label: '5V'},
      {id: 'J1-2', label: 'GND'},
      {id: 'J1-3', label: 'GPIO4', silkscreen: '4', aliases: ['IO4']},
      {id: 'J1-4', label: 'GND'},
    ]}],
};

const BOARD = {format: 'c3d-component', version: 1, part: {id: 'test-board', name: 'Test board', pins: [
  {id: 'P1', label: 'VCC'}, {id: 'P2', label: 'DATA'}, {id: 'P3', label: 'GND'},
]}};

/** A wiring.json that passes every check; tests break one thing at a time. */
function wiring(document: string) {
  return {
    $schema: 'schema/wiring.schema.json', version: 1, title: 'Test',
    source: {path: '../wiring.md', sha256: createHash('sha256').update(document).digest('hex')},
    parts: [
      {name: 'MCU', kind: 'catalog', modelId: 'test-mcu', line: 5},
      {name: 'Sensor', kind: 'prepared', ref: 'test-board', model: 'cad/board.step', line: 6},
      {name: 'Buck', kind: 'stand-in', size: [22, 17, 4], pins: ['IN+', 'IN-', 'OUT+', 'OUT-'], line: 7},
    ],
    connections: [
      {color: 'red', from: {part: 'Buck', pin: 'OUT+'}, to: [{part: 'MCU', pin: 'J1-1', text: 'MCU 5V'}], line: 12},
      {color: 'black', from: {part: 'MCU', pin: 'J1-2'}, to: [{part: 'Sensor', pin: 'P3'}, {part: 'Buck', pin: 'OUT-'}], line: 13},
      {color: 'blue', from: {part: 'MCU', pin: 'J1-3'}, to: [{part: 'Sensor', pin: 'P2'}], line: 14},
    ],
    layout: [{part: 'MCU', x: 0, y: 0, line: 20}, {part: 'Sensor', x: 40, y: 0, rotation: 90, line: 21}],
  };
}

type Wiring = ReturnType<typeof wiring>;

let project: string;
const write = (relative: string, content: unknown) => {
  const file = join(project, relative);
  mkdirSync(join(file, '..'), {recursive: true});
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};

async function run(argv: string[]): Promise<{code: number; text: string}> {
  const lines: string[] = [];
  const code = await main(argv, {cwd: project, out: line => lines.push(line), err: line => lines.push(line)});
  return {code, text: lines.join('\n')};
}

async function check(change: (w: Wiring) => void = () => {}): Promise<{code: number; text: string}> {
  const w = wiring(DOCUMENT);
  change(w);
  write('.circuitstudio/wiring.json', w);
  return run(['wiring']);
}

describe('wiring tools', () => {
  beforeEach(() => {
    if (project) rmSync(project, {recursive: true, force: true});
    project = mkdtempSync(join(tmpdir(), 'kit-wiring-'));
    write('.circuitstudio/catalog.json', CATALOG);
    write('.circuitstudio/parts/test-board/test-board.c3dcomponent', BOARD);
    write('wiring.md', DOCUMENT);
  });
  after(() => rmSync(project, {recursive: true, force: true}));

  test('part pins lists prepared and built-in parts with their names', async () => {
    const {code, text} = await run(['part', 'pins', 'test-board', 'test-mcu']);
    assert.equal(code, 0, text);
    assert.match(text, /^test-board: Test board \(prepared, \.circuitstudio\/parts\/test-board\/test-board\.c3dcomponent\), 3 pins$/m);
    assert.match(text, /^ {2}P2 {2}DATA$/m);
    assert.match(text, /^test-mcu: Test MCU \(catalog, \.circuitstudio\/catalog\.json\), 4 pins$/m);
    assert.match(text, /^ {2}J1-3 {2}GPIO4 {2}silkscreen 4 {2}aliases IO4$/m);
    const json = JSON.parse((await run(['part', 'pins', 'test-board', '--json'])).text);
    assert.deepEqual(json[0].pins[0], {id: 'P1', label: 'VCC'});
  });

  test('part pins fails on an unknown part', async () => {
    const {code, text} = await run(['part', 'pins', 'test-board', 'nope']);
    assert.equal(code, 1);
    assert.match(text, /: nope$/);
  });

  test('wiring accepts a complete, up-to-date file', async () => {
    const {code, text} = await check();
    assert.equal(code, 0, text);
    assert.equal(text, '.circuitstudio/wiring.json: 3 parts, 3 connections (4 wires), 2 placements; wiring.md unchanged\nok');
  });

  test('wiring --wires lists every wire as written and as resolved', async () => {
    const w = wiring(DOCUMENT);
    write('.circuitstudio/wiring.json', w);
    const {code, text} = await run(['wiring', '--wires']);
    assert.equal(code, 0, text);
    assert.deepEqual(text.split('\n').slice(1), [
      '  wiring.md:12  red    Buck OUT+         ->  MCU 5V = MCU J1-1 (5V)',
      '  wiring.md:13  black  MCU J1-2 (GND)    ->  Sensor P3 (GND)',
      '  wiring.md:13  black  MCU J1-2 (GND)    ->  Buck OUT-',
      '  wiring.md:14  blue   MCU J1-3 (GPIO4)  ->  Sensor P2 (DATA)',
      'ok',
    ]);
  });

  test('wiring reports a missing file', async () => {
    const {code, text} = await run(['wiring']);
    assert.equal(code, 1);
    assert.match(text, /no \.circuitstudio\/wiring\.json: resolve the wiring document first/);
  });

  test('wiring reports schema errors with the document line', async () => {
    const {code, text} = await check(w => {
      w.connections[2].color = 'pink';
      (w.parts[2] as Record<string, unknown>).size = undefined;
    });
    assert.equal(code, 1);
    assert.match(text, /wiring\.md:14 {2}\/connections\/2\/color {2}"pink" is not a wire colour: black, red, .* or #rrggbb/);
    assert.match(text, /^2 problems$/m);
    assert.match(text, /wiring\.md:7 {2}\/parts\/2 {2}must have required property 'size'/);
  });

  test('wiring reports a changed document', async () => {
    write('wiring.md', `${DOCUMENT}\nOne more line.\n`);
    const w = wiring(DOCUMENT);
    write('.circuitstudio/wiring.json', w);
    const {code, text} = await run(['wiring']);
    assert.equal(code, 1);
    assert.match(text, /wiring\.md changed$/m);
    assert.match(text, /\/source\/sha256 {2}wiring\.md changed since \.circuitstudio\/wiring\.json was resolved from it: resolve it again/);
  });

  test('wiring reports names used instead of pin identifiers, and ambiguous names', async () => {
    const {code, text} = await check(w => {
      w.connections[1].from.pin = 'GND';
      w.connections[2].to[0].pin = 'DATA';
      w.connections[0].to[0].pin = 'VIN';
    });
    assert.equal(code, 1);
    assert.match(text, /wiring\.md:13 {2}\/connections\/1\/from {2}pin "GND" is not a pin of MCU: "GND" names several pins \(J1-2, J1-4\), ask which one/);
    assert.match(text, /wiring\.md:14 {2}\/connections\/2\/to\/0 {2}pin "DATA" is not a pin of Sensor: "DATA" is a name of pin P2, write the identifier/);
    assert.match(text, /wiring\.md:12 {2}\/connections\/0\/to\/0 {2}pin "VIN" is not a pin of MCU$/m);
    assert.match(text, /^3 problems$/m);
  });

  test('wiring reports unknown parts, missing part files and duplicates', async () => {
    rmSync(join(project, '.circuitstudio/catalog.json'));
    const {code, text} = await check(w => {
      w.parts[1].ref = 'other-board';
      w.parts.push({name: 'Buck', kind: 'stand-in', size: [1, 1, 1], pins: ['A', 'A'], line: 8});
      w.connections[2].to.push({part: 'Display', pin: 'CLK', text: 'Display CLK'});
      w.layout.push({part: 'Sensor', x: 0, y: 0, line: 22}, {part: 'Gauge', x: 0, y: 0, line: 23});
    });
    assert.equal(code, 1);
    for (const expected of [
      /wiring\.md:5 {2}\/parts\/0 {2}no catalog snapshot to check "test-mcu": run part catalog/,
      /wiring\.md:6 {2}\/parts\/1 {2}prepared part "other-board" not found: no \.circuitstudio\/parts\/other-board\/other-board\.c3dcomponent/,
      /wiring\.md:8 {2}\/parts\/3 {2}part name "Buck" is used twice \(also at \/parts\/2\)/,
      /wiring\.md:8 {2}\/parts\/3 {2}stand-in pin listed twice: A/,
      /wiring\.md:14 {2}\/connections\/2\/to\/1 {2}part "Display" is not in parts/,
      /wiring\.md:22 {2}\/layout\/2 {2}part "Sensor" is placed twice/,
      /wiring\.md:23 {2}\/layout\/3 {2}part "Gauge" is not in parts/,
    ]) assert.match(text, expected);
  });
});
