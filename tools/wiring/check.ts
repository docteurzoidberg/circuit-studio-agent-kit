// `wiring`: checks `.circuitstudio/wiring.json`, the file the next steps build and render from, against the kit's
// schema, the parts it names (prepared parts, catalog snapshot, stand-ins) and the document it was resolved from.
// It reads no Markdown (D3): the source document is only hashed. Every problem names the document line it comes
// from when the entry has one, so the skill (or the user) can fix the document or the resolution.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Ajv2020} from 'ajv/dist/2020.js';
import {kitPath} from '../project.ts';
import {PartLibrary, pinsNamed, type PinNames} from './pins.ts';

const SCHEMA = resolve(dirname(fileURLToPath(import.meta.url)), '../../schema/wiring.schema.json');

interface End {
  part: string;
  pin: string;
  text?: string;
}

interface WiringPart {
  name: string;
  kind: 'catalog' | 'prepared' | 'stand-in';
  modelId?: string;
  ref?: string;
  pins?: string[];
  line: number;
}

/** Content of a valid wiring.json, as far as the checks read it. */
interface Wiring {
  source: {path: string; sha256: string};
  parts: WiringPart[];
  connections: {color?: string; from: End; to: End[]; line: number}[];
  layout?: {part: string; line?: number}[];
}

export interface Problem {
  /** Line of the source document, when the entry has one. */
  line?: number;
  /** Where in wiring.json, as a JSON pointer. */
  at: string;
  message: string;
}

/** A wire end as the document wrote it and as it was resolved. */
export interface ResolvedEnd {
  /** The reference as written in the document, else part and pin. */
  text: string;
  part: string;
  pin: string;
  /** Label of the pin in its part, when it has one. */
  label?: string;
  /**
   * How the name written in the document found the pin, when not by its identifier: its label, silkscreen or
   * one of its aliases (named), or none of them (the resolution read the document's own explanations).
   */
  by?: 'label' | 'silkscreen' | `alias ${string}` | 'document';
}

export interface ResolvedWire {
  line: number;
  color?: string;
  from: ResolvedEnd;
  to: ResolvedEnd;
}

export interface WiringReport {
  /** wiring.json, relative to the project root. */
  file: string;
  /** Source document, relative to the project root, when the file names one. */
  source?: string;
  /** Whether the source document still has the recorded hash; null when it could not be checked. */
  upToDate: boolean | null;
  parts: number;
  connections: number;
  wires: number;
  placements: number;
  problems: Problem[];
  /** Every wire, as written and as resolved (option `wires`). */
  wireList?: ResolvedWire[];
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The `line` of the top-level entry a JSON pointer falls in (`/connections/3/to/0/pin` → connections[3]). */
function lineAt(data: unknown, pointer: string): number | undefined {
  const [list, index] = pointer.split('/').slice(1);
  const entry = (data as Record<string, unknown[]> | null)?.[list]?.[Number(index)] as {line?: unknown} | undefined;
  return typeof entry?.line === 'number' ? entry.line : undefined;
}

function schemaProblems(data: unknown): Problem[] {
  const ajv = new Ajv2020({allErrors: true, strictTypes: false, verbose: true});
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  if (validate(data)) return [];
  // An `if`/`then` failure repeats the error of the `then` branch, reported on its own.
  return (validate.errors ?? []).filter(error => error.keyword !== 'if').map(error => {
    const extra = error.keyword === 'additionalProperties' ? ` (${String(error.params.additionalProperty)})`
      : error.keyword === 'enum' ? ` (${(error.params.allowedValues as string[]).join(', ')})` : '';
    const message = error.instancePath.endsWith('/color')
      ? `"${String(error.data)}" is not a wire colour: black, red, orange, blue, purple, green, brown, yellow, white or #rrggbb`
      : `${error.message}${extra}`;
    return {line: lineAt(data, error.instancePath), at: error.instancePath || '/', message};
  });
}

/** Cross-references of a schema-valid file: parts, pins, layout; `pinsOf` receives each part's pins. */
function referenceProblems(wiring: Wiring, library: PartLibrary, pinsOf: Map<string, PinNames[] | null>): Problem[] {
  const problems: Problem[] = [];
  const seen = new Map<string, number>();

  wiring.parts.forEach((part, i) => {
    const at = `/parts/${i}`;
    const add = (message: string) => problems.push({line: part.line, at, message});
    if (seen.has(part.name)) add(`part name "${part.name}" is used twice (also at /parts/${seen.get(part.name)})`);
    seen.set(part.name, i);
    if (part.kind === 'prepared') {
      const found = library.prepared(part.ref!);
      if (!found) add(`prepared part "${part.ref}" not found: no ${relative(library.root, library.preparedFile(part.ref!))}`);
      pinsOf.set(part.name, found?.pins ?? null);
    } else if (part.kind === 'catalog') {
      const found = library.builtIn(part.modelId!);
      if (!library.catalogSnapshot()) add(`no catalog snapshot to check "${part.modelId}": run part catalog`);
      else if (!found) add(`"${part.modelId}" is not a part of the catalog snapshot`);
      pinsOf.set(part.name, found?.pins ?? null);
    } else {
      const doubles = part.pins!.filter((pin, j) => part.pins!.indexOf(pin) !== j);
      if (doubles.length) add(`stand-in pin listed twice: ${[...new Set(doubles)].join(', ')}`);
      pinsOf.set(part.name, part.pins!.map(id => ({id})));
    }
  });

  const checkEnd = (end: End, at: string, line: number) => {
    if (!pinsOf.has(end.part)) {
      problems.push({line, at, message: `part "${end.part}" is not in parts`});
      return;
    }
    const pins = pinsOf.get(end.part);
    if (!pins || pins.some(pin => pin.id === end.pin)) return;
    const named = pinsNamed(pins, end.pin);
    const hint = named.length === 1 ? `: "${end.pin}" is a name of pin ${named[0].id}, write the identifier`
      : named.length > 1 ? `: "${end.pin}" names several pins (${named.map(p => p.id).join(', ')}), ask which one`
      : '';
    problems.push({line, at, message: `pin "${end.pin}" is not a pin of ${end.part}${hint}`});
  };
  wiring.connections.forEach((connection, i) => {
    checkEnd(connection.from, `/connections/${i}/from`, connection.line);
    connection.to.forEach((end, j) => checkEnd(end, `/connections/${i}/to/${j}`, connection.line));
  });

  const placed = new Set<string>();
  (wiring.layout ?? []).forEach((placement, i) => {
    const at = `/layout/${i}`;
    if (!pinsOf.has(placement.part)) problems.push({line: placement.line, at, message: `part "${placement.part}" is not in parts`});
    if (placed.has(placement.part)) problems.push({line: placement.line, at, message: `part "${placement.part}" is placed twice`});
    placed.add(placement.part);
  });
  return problems;
}

function wireList(wiring: Wiring, pinsOf: Map<string, PinNames[] | null>): ResolvedWire[] {
  const resolved = (end: End): ResolvedEnd => {
    const pin = pinsOf.get(end.part)?.find(p => p.id === end.pin);
    const label = pin?.label;
    let by: ResolvedEnd['by'];
    if (end.text && pin) {
      // The pin name as written: the reference without its part name.
      const written = end.text.toLowerCase().startsWith(`${end.part.toLowerCase()} `) ? end.text.slice(end.part.length + 1) : end.text;
      const same = (name?: string) => !!name && name.toLowerCase() === written.trim().toLowerCase();
      const alias = pin.aliases?.find(same);
      by = same(pin.id) ? undefined : same(pin.label) ? 'label' : same(pin.silkscreen) ? 'silkscreen'
        : alias ? `alias ${alias}` : 'document';
    }
    return {text: end.text ?? `${end.part} ${end.pin}`, part: end.part, pin: end.pin, ...(label ? {label} : {}), ...(by ? {by} : {})};
  };
  return wiring.connections.flatMap(c => c.to.map(to =>
    ({line: c.line, ...(c.color ? {color: c.color} : {}), from: resolved(c.from), to: resolved(to)})));
}

/** Check the project's wiring.json (or `file`); with `wires`, also list every wire as written and resolved. */
export function checkWiring(root: string, {file = kitPath(root, 'wiring.json'), wires = false}: {file?: string; wires?: boolean} = {}): WiringReport {
  const report: WiringReport = {file: relative(root, file), upToDate: null, parts: 0, connections: 0, wires: 0,
    placements: 0, problems: []};
  if (!existsSync(file)) {
    report.problems.push({at: '/', message: `no ${report.file}: resolve the wiring document first`});
    return report;
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report.problems.push({at: '/', message: `not valid JSON: ${(error as Error).message}`});
    return report;
  }
  const sourcePath = (data as {source?: {path?: unknown}} | null)?.source?.path;
  if (typeof sourcePath === 'string') report.source = relative(root, resolve(dirname(file), sourcePath));
  report.problems.push(...schemaProblems(data));
  if (report.problems.length) return report;

  const wiring = data as Wiring;
  report.parts = wiring.parts.length;
  report.connections = wiring.connections.length;
  report.wires = wiring.connections.reduce((sum, c) => sum + c.to.length, 0);
  report.placements = wiring.layout?.length ?? 0;

  const source = resolve(dirname(file), wiring.source.path);
  if (!existsSync(source)) {
    report.problems.push({at: '/source/path', message: `source document ${report.source} not found`});
  } else {
    report.upToDate = sha256(source) === wiring.source.sha256;
    if (!report.upToDate) {
      report.problems.push({at: '/source/sha256',
        message: `${report.source} changed since ${report.file} was resolved from it: resolve it again`});
    }
  }
  const pinsOf = new Map<string, PinNames[] | null>();
  report.problems.push(...referenceProblems(wiring, new PartLibrary(root), pinsOf));
  if (wires) report.wireList = wireList(wiring, pinsOf);
  return report;
}

/** Text of `wiring --wires`: one line per wire, the reference as written, then the pin and its label. */
function formatWires(report: WiringReport): string[] {
  const end = (e: ResolvedEnd) => {
    const resolved = `${e.part} ${e.pin}`, label = e.label && e.label !== e.pin ? ` (${e.label})` : '';
    const full = `${resolved}${label}`;
    if (e.text === resolved || e.text === full) return full;
    return `${e.text} = ${full}${e.by && e.by !== 'label' ? ` [${e.by === 'document' ? 'from the document' : `by ${e.by}`}]` : ''}`;
  };
  const rows = (report.wireList ?? []).map(w => [`${report.source ?? ''}:${w.line}`, w.color ?? '', end(w.from), end(w.to)]);
  const widths = [0, 1, 2].map(i => Math.max(0, ...rows.map(r => r[i].length)));
  return rows.map(r => `  ${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ->  ${r[3]}`);
}

/** Text of `wiring`: a summary line, the wires when listed, then one line per problem. */
export function formatReport(report: WiringReport): string {
  const head = report.parts
    ? `${report.file}: ${report.parts} parts, ${report.connections} connections (${report.wires} wires), `
      + `${report.placements} placements; ${report.source ?? 'no source'}`
      + (report.upToDate === true ? ' unchanged' : report.upToDate === false ? ' changed' : '')
    : report.file;
  const wires = formatWires(report);
  if (!report.problems.length) return [head, ...wires, 'ok'].join('\n');
  const where = (p: Problem) => (p.line && report.source ? `${report.source}:${p.line}  ` : '') + `${p.at}  `;
  return [head, ...wires, ...report.problems.map(p => `  ${where(p)}${p.message}`),
    `${report.problems.length} problem${report.problems.length > 1 ? 's' : ''}`].join('\n');
}

