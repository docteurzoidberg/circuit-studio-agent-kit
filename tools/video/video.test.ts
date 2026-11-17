import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, test} from 'node:test';
import {main} from '../cli.ts';
import {makeWebp} from './webp.ts';

const root = mkdtempSync(join(tmpdir(), 'kit-video-'));
const media = join(root, '.circuitstudio', 'media');
mkdirSync(media, {recursive: true});
after(() => rmSync(root, {recursive: true, force: true}));

const hasFfmpeg = (() => {
  try {
    return /libwebp/.test(execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {encoding: 'utf8'}));
  } catch {
    return false;
  }
})();

async function run(...args: string[]): Promise<{code: number; text: string}> {
  const lines: string[] = [];
  const code = await main(['video', ...args], {cwd: root, out: l => lines.push(l), err: l => lines.push(l)});
  return {code, text: lines.join('\n')};
}

describe('video outputs', () => {
  test('saves the extras one at a time, keeping the others', async () => {
    assert.match((await run()).text, /outputs: not chosen yet/);
    assert.match((await run('outputs', 'poster=off')).text, /poster off, WebP off/);
    assert.match((await run('outputs', 'webp=on')).text, /poster off, WebP on/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, '.circuitstudio', 'video.json'), 'utf8')).outputs, {poster: false, webp: true});
    assert.equal((await run('outputs', 'gif=on')).code, 2);
  });
});

describe('animated WebP', () => {
  test('says what is missing without ffmpeg', async () => {
    process.env.CIRCUIT_STUDIO_KIT_FFMPEG = join(root, 'no-ffmpeg');
    try {
      await assert.rejects(makeWebp(join(media, 'x.mp4')), /needs ffmpeg on this machine/);
    } finally {
      delete process.env.CIRCUIT_STUDIO_KIT_FFMPEG;
    }
  });

  test('converts the latest video', {skip: !hasFfmpeg && 'no ffmpeg with libwebp here'}, async () => {
    assert.match((await run('webp')).text, /no video in \.circuitstudio\/media\/ yet/);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1',
      '-pix_fmt', 'yuv420p', join(media, 'Demo_Wiring.mp4')]);
    const {code, text} = await run('webp');
    assert.equal(code, 0, text);
    assert.match(text, /^WebP: \.circuitstudio\/media\/Demo_Wiring\.webp \(640 px wide, 12 fps, [\d.]+ MB\), for a README\.$/);
    const head = readFileSync(join(media, 'Demo_Wiring.webp')).subarray(0, 12).toString('latin1');
    assert.equal(head.slice(0, 4) + head.slice(8), 'RIFFWEBP');
  });
});
