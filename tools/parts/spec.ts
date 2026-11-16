// Part spec (`part.yaml`): everything `convert` needs, written by the wiring-parts skill with the user.
//
//   id: so-45                          # kebab-case, unique in the project
//   name: SO-45 panel voltmeter
//   category: meter                    # optional, default "module"
//   step: so-45-voltmeter.step         # relative to this file
//   orientation: [0, 0, 180]           # Euler XYZ in degrees, applied after centring (optional)
//   mesh: { linear: 0.25, angular: 0.7 }                # optional; smaller = finer and heavier
//   simplify: { minVolume: 1.0, mergeByColour: true }   # optional
//   colours:                           # optional: only when the STEP has no usable colours
//     palette: { body: "#141414", steel: "#a4a4aa" }
//     rules:                           # first match wins; match = text in the solid's path below the root
//       - { match: "Screw", colour: steel }
//       - { match: "Body", largestOver: 20, colour: body }
//     default: body
//   pins:                              # positions and exit directions in STEP coordinates (mm)
//     - { id: "+", label: "+", at: [9, -32.9, -12.5], exit: [0, -1, 0] }
//     - generate:                      # a regular row (header, terminal block)
//         ids: "J1-{n}"                # {n} = 1, 2, ...
//         count: 22
//         start: [-29.17, 79.1, 4.0]
//         step: [0, -3.5, 0]
//         exit: [-1, 0, 0]
//         labels: [3V3, 3V3, RST]      # optional, by position; missing ones use the id
//         aliases: { 21: [5V0] }       # optional, by number
//         first: 1                     # optional, number of the first pin
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import YAML from 'yaml';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class SpecError extends Error {}

export type Vector = [number, number, number];

export interface Pin {
  id: string;
  label: string;
  /** Position in STEP coordinates, mm. */
  at: Vector;
  /** Unit direction a wire leaves the pin, STEP coordinates. */
  exit: Vector;
  aliases: string[];
}

export interface ColourRule {
  /** Text searched in the solid's assembly path below the root. */
  match: string;
  colour: string;
  largestOver: number | null;
  largestUnder: number | null;
}

export interface Spec {
  /** Absolute path of the spec file. */
  path: string;
  id: string;
  name: string;
  category: string;
  /** Absolute path of the STEP model. */
  step: string;
  /** Euler XYZ, degrees. */
  orientation: Vector;
  meshLinear: number;
  meshAngular: number;
  minVolume: number;
  mergeByColour: boolean;
  palette: Record<string, string>;
  rules: ColourRule[];
  defaultColour: string | null;
  pins: Pin[];
}

type Data = Record<string, unknown>;

const isMapping = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);

function vector(value: unknown, where: string): Vector {
  if (!(Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number'))) {
    throw new SpecError(`${where}: expected three numbers, got ${JSON.stringify(value)}`);
  }
  return value.map(Number) as Vector;
}

function unit(value: unknown, where: string): Vector {
  const v = vector(value, where);
  const norm = Math.hypot(...v);
  if (norm === 0) throw new SpecError(`${where}: direction must not be zero`);
  return v.map(c => c / norm) as Vector;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

function expandPins(entries: unknown): Pin[] {
  const pins: Pin[] = [];
  (Array.isArray(entries) ? entries : []).forEach((entry: unknown, i) => {
    const where = `pins[${i}]`;
    if (!isMapping(entry)) throw new SpecError(`${where}: expected a mapping`);
    if ('generate' in entry) {
      const g = entry.generate;
      if (!isMapping(g)) throw new SpecError(`${where}.generate: expected a mapping`);
      for (const key of ['ids', 'count', 'start', 'step', 'exit']) {
        if (!(key in g)) throw new SpecError(`${where}.generate: missing "${key}"`);
      }
      const ids = String(g.ids);
      if (!ids.includes('{n}')) throw new SpecError(`${where}.generate.ids: must contain {n}`);
      const count = parseInt(String(g.count), 10);
      const start = vector(g.start, `${where}.generate.start`);
      const step = vector(g.step, `${where}.generate.step`);
      const exit = unit(g.exit, `${where}.generate.exit`);
      const labels = Array.isArray(g.labels) ? g.labels : [];
      const aliases = new Map(Object.entries(isMapping(g.aliases) ? g.aliases : {})
        .map(([k, v]) => [parseInt(k, 10), strings(v)] as const));
      const first = parseInt(String(g.first ?? 1), 10);
      for (let k = 0; k < count; k++) {
        const n = first + k;
        const id = ids.replaceAll('{n}', String(n));
        const label = k < labels.length && labels[k] != null ? String(labels[k]) : id;
        pins.push({id, label, at: start.map((s, c) => s + step[c] * k) as Vector, exit, aliases: aliases.get(n) ?? []});
      }
      return;
    }
    for (const key of ['id', 'at', 'exit']) {
      if (!(key in entry)) throw new SpecError(`${where}: missing "${key}"`);
    }
    pins.push({id: String(entry.id), label: String(entry.label ?? entry.id), at: vector(entry.at, `${where}.at`),
      exit: unit(entry.exit, `${where}.exit`), aliases: strings(entry.aliases)});
  });
  const seen = new Set<string>();
  const duplicates = new Set(pins.map(p => p.id).filter(id => seen.has(id) || !seen.add(id)));
  if (duplicates.size) throw new SpecError(`pins: duplicate ids ${JSON.stringify([...duplicates].sort())}`);
  return pins;
}

/** Read and check a part spec; paths are resolved against the spec's folder. */
export function loadSpec(file: string): Spec {
  const path = resolve(file);
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SpecError(`${path}: ${(error as Error).message}`);
  }
  if (!isMapping(data)) throw new SpecError(`${path}: expected a mapping`);
  for (const key of ['id', 'name', 'step']) {
    if (!data[key]) throw new SpecError(`${path}: missing "${key}"`);
  }
  if (!ID.test(String(data.id))) throw new SpecError(`id: "${data.id}" must be kebab-case (a-z, 0-9, -)`);
  const mesh = isMapping(data.mesh) ? data.mesh : {};
  const simplify = isMapping(data.simplify) ? data.simplify : {};
  const colours = isMapping(data.colours) ? data.colours : {};
  const palette: Record<string, string> = {};
  for (const [name, value] of Object.entries(isMapping(colours.palette) ? colours.palette : {})) {
    if (!HEX.test(String(value))) throw new SpecError(`colours.palette.${name}: "${value}" is not #rrggbb`);
    palette[name] = String(value);
  }
  const colourRef = (value: unknown, where: string): string => {
    const text = String(value);
    if (text in palette) return palette[text];
    if (HEX.test(text)) return text;
    throw new SpecError(`${where}: "${text}" is neither a palette name nor #rrggbb`);
  };
  const rules = (Array.isArray(colours.rules) ? colours.rules : []).map((rule: unknown, i): ColourRule => {
    if (!isMapping(rule) || !('match' in rule) || !('colour' in rule)) {
      throw new SpecError(`colours.rules[${i}]: needs "match" and "colour"`);
    }
    return {match: String(rule.match), colour: colourRef(rule.colour, `colours.rules[${i}].colour`),
      largestOver: typeof rule.largestOver === 'number' ? rule.largestOver : null,
      largestUnder: typeof rule.largestUnder === 'number' ? rule.largestUnder : null};
  });
  const pins = expandPins(data.pins);
  if (!pins.length) throw new SpecError('pins: at least one pin is needed');
  return {
    path, id: String(data.id), name: String(data.name), category: String(data.category ?? 'module'),
    step: resolve(dirname(path), String(data.step)),
    orientation: vector(data.orientation ?? [0, 0, 0], 'orientation'),
    meshLinear: Number(mesh.linear ?? 0.25), meshAngular: Number(mesh.angular ?? 0.7),
    minVolume: Number(simplify.minVolume ?? 0), mergeByColour: Boolean(simplify.mergeByColour ?? false),
    palette, rules, defaultColour: colours.default ? colourRef(colours.default, 'colours.default') : null, pins,
  };
}
