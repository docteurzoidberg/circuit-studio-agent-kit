#!/usr/bin/env node
// The kit's command line. Commands follow the skills, in the order a user meets them (PLAN.md, Package); every
// command works on the project's `.circuitstudio/` folder (tools/project.ts), except `part inspect` and
// `part convert`, which take the file they work on.
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {catalog, describe, type CatalogOptions} from './catalog/catalog.ts';
import {convertCommand, inspectCommand, type PartOptions} from './parts/commands.ts';
import {projectRoot} from './project.ts';

const USAGE = `usage: circuit-studio-agent-kit <command>

  part catalog [--from <circuit-studio folder>] [--download [--ref <git ref>]] [--force]
      snapshot of the Circuit Studio catalog into .circuitstudio/catalog.json, from a local checkout
      (--from, or the one used last time) or, with --download, from the author's repository (network)
  part inspect <model.step> [--json]
      what a STEP model holds: tree, colours, sizes, contact rows, complexity
  part convert <part.yaml> [--out <file.c3dcomponent>] [--preview <file.png> | --no-preview] [--json]
      STEP model to Circuit Studio part, from its spec; writes next to the spec by default

  planned: init, uninstall, mcp, check, wiring, build, render`;

const OPTIONS = {
  json: {type: 'boolean'}, out: {type: 'string'}, preview: {type: 'string'}, 'no-preview': {type: 'boolean'},
  from: {type: 'string'}, download: {type: 'boolean'}, ref: {type: 'string'}, force: {type: 'boolean'},
  help: {type: 'boolean', short: 'h'},
} as const;

type Options = CatalogOptions & PartOptions & {help?: boolean};

/** Where the command line runs and writes (the tests give their own). */
export interface Io {
  cwd?: string;
  out?: (text: string) => void;
  err?: (text: string) => void;
}

class UsageError extends Error {}

async function part([sub, file, ...rest]: string[], options: Options, cwd: string): Promise<string> {
  if (sub === 'catalog' && !file) {
    const result = await catalog(projectRoot(cwd), options);
    return options.json ? JSON.stringify({file: result.file, status: result.status, source: result.snapshot.source,
      parts: result.snapshot.parts.length}, null, 1) : describe(result);
  }
  if (sub === 'inspect' && file && !rest.length) return inspectCommand(file, options);
  if (sub === 'convert' && file && !rest.length) return convertCommand(file, options);
  throw new UsageError(`unknown or incomplete part command: ${[sub, file, ...rest].filter(Boolean).join(' ')}`);
}

/** Run the command line; returns the exit code. */
export async function main(argv: string[], {cwd = process.cwd(), out = console.log, err = console.error}: Io = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({args: argv, allowPositionals: true, options: OPTIONS});
  } catch (error) {
    err(`error: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const options: Options = parsed.values;
  const [command, ...args] = parsed.positionals;
  if (options.help || !command) {
    (options.help ? out : err)(USAGE);
    return options.help ? 0 : 2;
  }
  try {
    if (command !== 'part') throw new UsageError(`unknown command: ${command}`);
    out(await part(args, options, cwd));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`error: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    err(`error: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
