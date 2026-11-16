#!/usr/bin/env node
// Command line of the part tools (port of `python -m c3dparts`).
//
//   node tools/parts/cli.mjs inspect <model.step> [--json]
//   node tools/parts/cli.mjs convert <part.yaml> [--out <file.c3dcomponent>] [--preview <file.png> | --no-preview] [--json]
//
// `convert` writes, by default next to the spec, `<id>.c3dcomponent` and `<id>.png`.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {convert, writeComponent} from './convert.mjs';
import {formatText, inspect} from './inspect.mjs';
import {writePreview} from './preview.mjs';
import {loadSpec, SpecError} from './spec.mjs';
import {readStep, StepReadError} from './step.mjs';

const USAGE = `usage:
  part inspect <model.step> [--json]
      report what a STEP model contains: tree, colours, sizes, contact candidates
  part convert <part.yaml> [--out <file.c3dcomponent>] [--preview <file.png> | --no-preview] [--json]
      convert a STEP model into a Circuit Studio part from its spec`;

async function runInspect(step, options) {
  const facts = inspect(await readStep(step));
  return options.json ? JSON.stringify(facts, null, 1) : formatText(facts);
}

async function runConvert(specPath, options) {
  const spec = loadSpec(specPath);
  const folder = dirname(spec.path);
  const result = await convert(spec);
  const {report} = result;
  report.component = options.out ?? join(folder, `${spec.id}.c3dcomponent`);
  writeComponent(result.part, report.component);
  if (!options['no-preview']) {
    report.preview = options.preview ?? join(folder, `${spec.id}.png`);
    writePreview(result, report.preview);
  }
  if (options.json) return JSON.stringify(report, null, 1);
  const [w, d, h] = report.dimensions;
  return [
    `${report.id}: ${report.solids.kept}/${report.solids.read} solids kept, ${w} x ${d} x ${h} mm, ${report.pins} pins`,
    `  GLB ${Math.floor(report.glbBytes / 1024)} KiB: ${report.meshCount} meshes, ${report.materialCount} materials, `
      + `${report.triangleCount} triangles; colours ${report.colours.join(', ')}`,
    `  wrote ${report.component}${report.preview ? ` and ${report.preview}` : ''}`,
  ].join('\n');
}

/** Run a command; returns the exit code. */
export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({args: argv, allowPositionals: true, options: {
      json: {type: 'boolean'}, out: {type: 'string'}, preview: {type: 'string'}, 'no-preview': {type: 'boolean'},
      help: {type: 'boolean', short: 'h'},
    }});
  } catch (error) {
    console.error(`error: ${error.message}\n${USAGE}`);
    return 2;
  }
  const [command, file, ...rest] = parsed.positionals;
  const commands = {inspect: runInspect, convert: runConvert};
  if (parsed.values.help || !commands[command] || !file || rest.length) {
    console.error(USAGE);
    return parsed.values.help ? 0 : 2;
  }
  try {
    console.log(await commands[command](file, parsed.values));
    return 0;
  } catch (error) {
    if (error instanceof StepReadError || error instanceof SpecError || error.message) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
