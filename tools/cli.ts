#!/usr/bin/env node
// The kit's command line. Commands follow the skills, in the order a user meets them (PLAN.md, Package); every
// command works on the project's `.circuitstudio/` folder (tools/project.ts), except `part inspect` and
// `part convert`, which take the file they work on.
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {catalog, describe, type CatalogOptions} from './catalog/catalog.ts';
import {convertCommand, inspectCommand, type PartOptions} from './parts/commands.ts';
import {projectRoot} from './project.ts';
import {build, formatBuild} from './project/build.ts';
import {runStudio, studioCommand} from './studio/studio.ts';
import {describeSettings, parseAssignments, readVideo, VIDEO_FILE, writeVideo} from './video/video.ts';
import {checkWiring, formatReport} from './wiring/check.ts';
import {formatPins, PartLibrary} from './wiring/pins.ts';

const USAGE = `usage: circuit-studio-agent-kit <command>

  part catalog [--from <circuit-studio folder>] [--download [--ref <git ref>]] [--force]
      snapshot of the Circuit Studio catalog into .circuitstudio/catalog.json, from a local checkout
      (--from, or the one used last time) or, with --download, from the author's repository (network)
  part inspect <model.step> [--json]
      what a STEP model holds: tree, colours, sizes, contact rows, complexity
  part convert <part.yaml> [--out <file.c3dcomponent>] [--preview <file.png> | --no-preview] [--json]
      STEP model to Circuit Studio part, from its spec; writes next to the spec by default
  part pins <part id>... [--json]
      pins of prepared parts (.circuitstudio/parts/) or built-in parts (.circuitstudio/catalog.json),
      with the names a wiring document may use for them
  wiring [--wires] [--json]
      checks .circuitstudio/wiring.json: schema, parts and pins, source document unchanged;
      exit code 1 when there are problems; --wires lists every wire as written and as resolved
  build [--from <circuit-studio folder>] [--move "<part name>=x,y[,rotation]"]... [--reset <part name>]...
        [--dry-run] [--json]
      generates .circuitstudio/project.c3dproj from wiring.json and the parts, keeping the edits made
      in Circuit Studio; --move places a part as the user asks (kept like an edit), --reset gives a part
      back to automatic or layout placement, --dry-run writes nothing (to try placements); plans the
      routes with Circuit Studio's planner (from the catalog's checkout, or --from); exit code 1 when
      wires stay blocked
  studio open [--from <circuit-studio build> | --url <circuit-studio site>] [--no-browser] [--wait <s>]
      opens .circuitstudio/project.c3dproj in Circuit Studio for the review: starts the kit's background
      process if needed, opens the link in the default browser when no page is connected, and loads the
      project in the page (again after each build: it reloads); --from or --url says which Circuit Studio
      (a build with the kit's bridge, or a site that has it), kept for next time
  studio sync | status | stop
      sync writes the parts the user moved and the routes they reshaped in the page into the project;
      status tells what runs and is connected; stop ends the background process
  video
      what .circuitstudio/video.json holds: the video settings, the outputs, the automation (D27)
  video choices
      the presets and allowed values of Circuit Studio's video settings (asks the connected page)
  video settings [--defaults] [preset=<name>] [<key>=<value>]...
      saves the video settings into video.json, checked by the connected page: Circuit Studio's
      defaults, a preset, or changes on top of the saved ones; without arguments, shows them
  video outputs poster=on|off
      what render writes besides the video, from now on
  video poster
      writes the poster image now (a still of the camera view), without rendering the video again
  render [--poster] [--no-browser] [--wait <s>]
      renders the video in the connected Circuit Studio page (opening it first when needed): saves the
      user's edits, reloads the project, writes the MP4 into .circuitstudio/media/; --poster also writes
      a still of the camera view
  studio start [--from <build> | --url <site>]
      runs the background process in the foreground (studio open starts it by itself)

  planned: init, uninstall, check`;

const OPTIONS = {
  json: {type: 'boolean'}, out: {type: 'string'}, preview: {type: 'string'}, 'no-preview': {type: 'boolean'},
  from: {type: 'string'}, download: {type: 'boolean'}, ref: {type: 'string'}, force: {type: 'boolean'},
  wires: {type: 'boolean'}, reset: {type: 'string', multiple: true}, move: {type: 'string', multiple: true},
  'dry-run': {type: 'boolean'}, url: {type: 'string'}, 'no-browser': {type: 'boolean'}, wait: {type: 'string'},
  poster: {type: 'boolean'}, defaults: {type: 'boolean'},
  help: {type: 'boolean', short: 'h'},
} as const;

type Options = CatalogOptions & PartOptions & {help?: boolean; wires?: boolean; reset?: string[]; move?: string[];
  'dry-run'?: boolean; url?: string; 'no-browser'?: boolean; wait?: string; poster?: boolean; defaults?: boolean};

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
  if (sub === 'pins' && file) {
    const library = new PartLibrary(projectRoot(cwd));
    const ids = [file, ...rest];
    const missing = ids.filter(id => !library.find(id));
    if (missing.length) {
      throw new Error(`not a prepared part (.circuitstudio/parts/<id>/<id>.c3dcomponent) nor a part of the catalog `
        + `snapshot (.circuitstudio/catalog.json${library.catalogSnapshot() ? '' : ', missing: run part catalog'}): `
        + missing.join(', '));
    }
    const parts = ids.map(id => library.find(id)!);
    return options.json ? JSON.stringify(parts, null, 1) : formatPins(parts);
  }
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
    if (command === 'wiring') {
      if (args.length) throw new UsageError('wiring takes no argument');
      const report = checkWiring(projectRoot(cwd), {wires: options.wires});
      out(options.json ? JSON.stringify(report, null, 1) : formatReport(report));
      return report.problems.length ? 1 : 0;
    }
    if (command === 'build') {
      if (args.length) throw new UsageError('build takes no argument');
      const report = await build(projectRoot(cwd), {from: options.from, reset: options.reset, move: options.move,
        dryRun: options['dry-run']});
      out(options.json ? JSON.stringify(report, null, 1) : formatBuild(report));
      return report.blocked.length ? 1 : 0;
    }
    if (command === 'render') {
      if (args.length) throw new UsageError('render takes no argument');
      const wait = options.wait === undefined ? undefined : Number(options.wait);
      out(await studioCommand(projectRoot(cwd), 'render', {from: options.from, url: options.url,
        browser: !options['no-browser'], wait, poster: options.poster}, line => err(line)));
      return 0;
    }
    if (command === 'video') {
      const [action, ...rest] = args;
      const root = projectRoot(cwd);
      if (action === undefined) {
        const video = readVideo(root);
        out([`settings: ${video.settings ? describeSettings(video.settings) : 'not chosen yet'}`,
          `outputs: ${video.outputs ? `poster ${video.outputs.poster ? 'on' : 'off'}` : 'not chosen yet'}`,
          `automation: ${video.automation ? JSON.stringify(video.automation) : 'none'}`].join('\n'));
        return 0;
      }
      if (action === 'outputs') {
        const {poster, ...other} = parseAssignments(rest);
        if (Object.keys(other).length || typeof poster !== 'boolean') throw new UsageError('video outputs takes poster=on|off');
        writeVideo(root, {...readVideo(root), outputs: {poster}});
        out(`Saved into ${VIDEO_FILE}: render writes ${poster ? 'a poster image besides the video' : 'the video only'}.`);
        return 0;
      }
      if (!['choices', 'settings', 'poster'].includes(action)) throw new UsageError('video takes one of: choices, settings, outputs, poster');
      const wait = options.wait === undefined ? undefined : Number(options.wait);
      out(await studioCommand(root, `video-${action}`, {from: options.from, url: options.url, browser: !options['no-browser'],
        wait, args: rest, defaults: options.defaults}));
      return 0;
    }
    if (command === 'studio') {
      const [action, ...rest] = args;
      if (rest.length || !['start', 'open', 'sync', 'status', 'stop'].includes(action)) {
        throw new UsageError('studio takes one of: open, sync, status, stop, start');
      }
      const source = {from: options.from, url: options.url};
      if (action === 'start') await runStudio(projectRoot(cwd), source, out);
      else {
        const wait = options.wait === undefined ? undefined : Number(options.wait);
        if (wait !== undefined && !(wait >= 0)) throw new UsageError('--wait takes a number of seconds');
        out(await studioCommand(projectRoot(cwd), action, {...source, browser: !options['no-browser'], wait}));
      }
      return 0;
    }
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
