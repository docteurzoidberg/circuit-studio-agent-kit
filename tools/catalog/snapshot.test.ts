// Tests of the catalog snapshot on the local Circuit Studio clones (skipped when they are absent).
//   npm test
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotLocal} from './snapshot.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OFFERED = ['arduino-uno-r3', 'dvr8825', 'esp32-30pin', 'esp32-c3-zero', 'esp32-c6-supermini', 'esp32-wroom', 'ldr', 'led',
  'resistor', 'sonoff-cam-s3w', 'stepper-24byj-48', 'yd-esp32-s3-v34'];

for (const clone of ['fork', 'upstream']) {
  const path = join(ROOT, 'circuit-studio', clone);
  test(`snapshot of the ${clone} clone`, {skip: !existsSync(path) && `${path} not present`}, async () => {
    const snapshot = await snapshotLocal(path);
    assert.equal(snapshot.format, 'circuit-studio-catalog');
    assert.equal(snapshot.source.kind, 'local');
    assert.match(snapshot.source.commit ?? '', /^[0-9a-f]{40}$/);
    const offered = snapshot.parts.filter(p => p.offered).map(p => p.modelId).sort();
    assert.deepEqual(offered, OFFERED);
    const wroom = snapshot.parts.find(p => p.modelId === 'esp32-wroom');
    assert.ok(wroom, 'esp32-wroom is in the catalog');
    assert.equal(wroom.pinCount, 38);
    assert.ok(wroom.pins.some(p => p.aliases?.includes('GPIO36')), 'pin aliases are kept');
    assert.ok(snapshot.parts.every(p => p.dimensions?.length === 3), 'every part has dimensions');
    // Defined in src/arduinoUno.ts and imported by model.ts without being re-exported.
    const uno = snapshot.parts.find(p => p.modelId === 'arduino-uno-r3');
    assert.equal(uno?.export, 'ARDUINO_UNO_R3_COMPONENT');
    assert.equal(uno?.pinCount, 44);
  });
}

test('a folder that is not a Circuit Studio checkout is refused', async () => {
  await assert.rejects(snapshotLocal(ROOT), /no src\/model\.ts/);
});
