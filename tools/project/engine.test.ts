// Tests of the engine bundled from the local upstream checkout (skipped when it is absent).
//   npm test
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadEngine} from './engine.ts';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHECKOUT = join(KIT, 'circuit-studio', 'upstream');
const skip = !existsSync(join(CHECKOUT, 'src', 'autoRouting.ts')) && `${CHECKOUT} not present`;

test('the templates include parts defined outside src/model.ts', {skip}, async () => {
  const engine = await loadEngine(CHECKOUT);
  assert.ok(engine.templates.has('esp32-wroom'), 'a part exported by model.ts');
  // Defined in src/arduinoUno.ts, imported by model.ts without being re-exported.
  assert.equal(engine.templates.get('arduino-uno-r3')?.pins.length, 44);
});
