// Tests of `part catalog` and of finding the project's .circuitstudio/ folder.
//   npm test
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, before, describe, test} from 'node:test';
import {main} from '../cli.ts';
import {projectRoot} from '../project.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FORK = join(ROOT, 'circuit-studio', 'fork');

async function run(argv: string[], cwd: string): Promise<{code: number; text: string}> {
  const lines: string[] = [];
  const code = await main(argv, {cwd, out: line => lines.push(line), err: line => lines.push(line)});
  return {code, text: lines.join('\n')};
}

describe('project root', () => {
  let folder: string;
  before(() => { folder = mkdtempSync(join(tmpdir(), 'kit-root-')); });
  after(() => rmSync(folder, {recursive: true, force: true}));

  test('the nearest folder with .circuitstudio/, else the git root, else the current folder', () => {
    const nested = join(folder, 'a', 'b');
    mkdirSync(nested, {recursive: true});
    assert.equal(projectRoot(nested), nested);
    mkdirSync(join(folder, '.git'));
    assert.equal(projectRoot(nested), folder);
    mkdirSync(join(folder, 'a', '.circuitstudio'));
    assert.equal(projectRoot(nested), join(folder, 'a'));
  });
});

describe('part catalog', () => {
  let project: string;
  before(() => { project = mkdtempSync(join(tmpdir(), 'kit-catalog-')); });
  after(() => rmSync(project, {recursive: true, force: true}));

  test('without a source, it asks for --from or --download and downloads nothing', async () => {
    const {code, text} = await run(['part', 'catalog'], project);
    assert.equal(code, 1);
    assert.match(text, /--from <folder>.*--download/s);
    assert.ok(!existsSync(join(project, '.circuitstudio', 'catalog.json')));
  });

  test('snapshot from a local checkout, kept while the checkout stays on the same commit',
    {skip: !existsSync(FORK) && `${FORK} not present`}, async () => {
      let r = await run(['part', 'catalog', '--from', FORK], project);
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /written, 13 parts \(11 offered/);
      const snapshot = JSON.parse(readFileSync(join(project, '.circuitstudio', 'catalog.json'), 'utf8'));
      assert.equal(snapshot.source.path, FORK);
      r = await run(['part', 'catalog'], project);  // reuses the checkout of the previous snapshot
      assert.match(r.text, /up to date/);
      r = await run(['part', 'catalog', '--force'], project);
      assert.match(r.text, /written/);
    });
});

test('unknown commands print the usage', async () => {
  const {code, text} = await run(['part', 'frobnicate'], tmpdir());
  assert.equal(code, 2);
  assert.match(text, /usage:/);
});
