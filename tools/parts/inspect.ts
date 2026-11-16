// `part inspect`: the facts a skill needs to write a part spec — tree, colours, sizes and candidate contacts.
// Nothing is guessed: contacts are candidates (cylinders and thin posts),
// grouped into regular rows when they line up, so the skill can propose pin positions and the user confirm them.
import {basename} from 'node:path';
import {boundingBox, solidBox, unionBox, uniqueSubShapes, volume, type Box, type OC} from './occt.ts';
import type {Solid, StepModel} from './step.ts';

const AXES = 'xyz';
type Axis = 'x' | 'y' | 'z';
const VOLUME_BUCKETS = [0.1, 1, 10, 100];  // mm³ thresholds, to choose `simplify.minVolume`
const CYLINDER_RADIUS = [0.3, 2.5];  // mm: pins, screws, wire holes
const POST_THICKNESS = 1.2;  // mm: header pins and leads are at most this thick
const ROW_TOLERANCE = 0.05;  // mm: spacing difference still counted as one row
const MAX_TREE = 40;
// A model is complex (worth offering a simplification) beyond either threshold. Calibrated on the Claudemètre
// parts: an adapter board (888 solids) and a display module (18 812 faces) are complex; a meter, a socket and a
// fuse holder (at most 12 solids, 641 faces) are simple.
export const COMPLEX_SOLIDS = 100;
export const COMPLEX_FACES = 5000;

/** A possible contact: a cylindrical face (screw, hole, round pin) or a thin solid (header pin, lead). */
export interface Candidate {
  kind: 'cylinder' | 'post';
  /** Axis the contact runs along. */
  axis: Axis;
  /** Diameter (cylinder) or thickness (post), mm. */
  size: number;
  /** End with the highest coordinate on the axis. */
  point: number[];
  /** Extent along the axis. */
  span: number[];
  /** Assembly path below the root. */
  part: string;
}

/** Contacts in a regular line: start point, step vector and count, as `part.yaml` generates pins. */
export interface Row {
  kind: string;
  axis: Axis;
  size: number;
  count: number;
  start: number[];
  step: number[];
  end: number[];
  part: string;
  /** Every size, kind and part merged into this line (a screw, its hole, its thread). */
  sizes: number[];
  kinds: string[];
  parts: string[];
}

export interface TreeEntry {
  path: string;
  solids: number;
  size: number[];
  min: number[];
}

/** What `part inspect` reports (JSON with `--json`). */
export interface Facts {
  file: string;
  bounds: Box;
  solids: number;
  complexity: {faces: number; verdict: 'simple' | 'complex'; reasons: string[]};
  volumes: {total: number; smallestSolidsBelow: Record<string, number>};
  colours: {distinct: number; bySolid: Record<string, number>; faceColours: number};
  tree: TreeEntry[];
  treeEntries: number;
  contacts: {rows: Row[]; singles: Candidate[]; singlesTotal: number};
}

/** Round to `digits` decimals, without negative zero. */
export const r = (v: number, digits = 3): number => Number(v.toFixed(digits)) + 0;

const partName = (solid: Solid) => solid.path.slice(1).filter(Boolean).join(' / ');
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function compareArrays(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

const rounded = (b: Box): Box => ({min: b.min.map(v => r(v)), max: b.max.map(v => r(v)), size: b.size.map(v => r(v))});

/** Index of the axis a unit vector runs along, or null when it is oblique. */
function principalAxis(direction: number[]): number | null {
  const i = direction.findIndex(c => Math.abs(Math.abs(c) - 1) < 1e-3);
  return i < 0 ? null : i;
}

/** Cylindrical faces along a principal axis, one per axis line and radius, with their extent on the axis. */
function cylinderCandidates(oc: OC, solids: Solid[]): Candidate[] {
  const found = new Map<string, Candidate>();
  for (const solid of solids) {
    for (const face of uniqueSubShapes(oc, solid.shape, 'FACE')) {
      const surface = new oc.BRepAdaptor_Surface_2(oc.TopoDS.Face_1(face), true);
      if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) continue;
      const cyl = surface.Cylinder();
      const radius = cyl.Radius();
      if (radius < CYLINDER_RADIUS[0] || radius > CYLINDER_RADIUS[1]) continue;
      const d = cyl.Axis().Direction();
      const axis = principalAxis([d.X(), d.Y(), d.Z()]);
      if (axis === null) continue;
      const loc = cyl.Location();
      const point = [loc.X(), loc.Y(), loc.Z()];
      const b = boundingBox(oc, face);
      const [lo, hi] = [b.min[axis], b.max[axis]];
      const key = [axis, r(radius, 2), ...[0, 1, 2].filter(i => i !== axis).map(i => r(point[i], 1))].join('|');
      const prev = found.get(key);
      if (prev) prev.span = [Math.min(prev.span[0], lo), Math.max(prev.span[1], hi)];
      else found.set(key, {kind: 'cylinder', axis: AXES[axis] as Axis, size: r(radius * 2, 2), point, span: [lo, hi],
        part: partName(solid)});
    }
  }
  return [...found.values()].map(c => {
    c.point[AXES.indexOf(c.axis)] = c.span[1];  // report the end with the highest coordinate on the axis
    return {...c, point: c.point.map(v => r(v)), span: c.span.map(v => r(v))};
  });
}

/** Thin solids (header pins, leads): two small dimensions, one long; reported at their highest end. */
function postCandidates(oc: OC, solids: Solid[]): Candidate[] {
  const out: Candidate[] = [];
  for (const solid of solids) {
    const b = solidBox(oc, solid);
    const order = [0, 1, 2].sort((i, j) => b.size[i] - b.size[j]);
    const thin = Math.max(b.size[order[0]], b.size[order[1]]);
    const long = order[2];
    if (thin > POST_THICKNESS || b.size[long] < 2 * b.size[order[1]]) continue;
    const point = b.min.map((v, i) => (v + b.max[i]) / 2);
    point[long] = b.max[long];
    out.push({kind: 'post', axis: AXES[long] as Axis, size: r(thin, 2), point: point.map(v => r(v)),
      span: [r(b.min[long]), r(b.max[long])], part: partName(solid)});
  }
  return out;
}

/**
 * Group candidates of the same kind, axis and size that line up with a regular spacing. A row is reported as start
 * point, step vector and count, the shape `part.yaml` uses to generate pins.
 */
export function findRows(candidates: Candidate[]): {rows: Row[]; singles: Candidate[]} {
  type RawRow = Omit<Row, 'sizes' | 'kinds' | 'parts'>;
  const rows: RawRow[] = [];
  const used = new Set<number>();
  const groups = new Map<string, {kind: string; axis: Axis; size: number; members: number[]}>();
  candidates.forEach((c, i) => {
    const key = `${c.kind}|${c.axis}|${c.size}`;
    if (!groups.has(key)) groups.set(key, {kind: c.kind, axis: c.axis, size: c.size, members: []});
    groups.get(key)!.members.push(i);
  });
  for (const {kind, axis, size, members} of groups.values()) {
    for (let direction = 0; direction < 3; direction++) {
      const lines = new Map<string, number[]>();
      for (const i of members) {
        if (used.has(i)) continue;
        const p = candidates[i].point;
        const key = [0, 1, 2].filter(k => k !== direction).map(k => r(p[k], 1)).join('|');
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key)!.push(i);
      }
      for (const line of lines.values()) {
        if (line.length < 3) continue;
        line.sort((a, b) => candidates[a].point[direction] - candidates[b].point[direction]);
        const coords = line.map(i => candidates[i].point[direction]);
        const gaps = coords.slice(1).map((v, k) => v - coords[k]);
        const pitch = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        if (pitch <= 0 || Math.max(...gaps.map(g => Math.abs(g - pitch))) > ROW_TOLERANCE) continue;
        const step = [0, 0, 0];
        step[direction] = r(pitch);
        rows.push({kind, axis, size, count: line.length, start: candidates[line[0]].point, step,
          end: candidates[line.at(-1)!].point, part: candidates[line[0]].part});
        for (const i of line) used.add(i);
      }
    }
  }
  return {rows: mergeRows(rows), singles: candidates.filter((_, i) => !used.has(i))};
}

/**
 * One row per line of contacts: rows on the same line, pitch and count (a screw, its hole, its thread at several
 * radii or heights) are merged, keeping every size and the highest point.
 */
export function mergeRows(rows: Omit<Row, 'sizes' | 'kinds' | 'parts'>[]): Row[] {
  const merged: Row[] = [];
  const sameLine = (a: Row, b: Omit<Row, 'sizes' | 'kinds' | 'parts'>) => {
    const axis = AXES.indexOf(a.axis);
    return a.axis === b.axis && a.count === b.count
      && a.step.every((x, k) => Math.abs(x - b.step[k]) <= ROW_TOLERANCE)
      && [0, 1, 2].every(k => k === axis || Math.abs(a.start[k] - b.start[k]) <= 0.1);
  };
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort(byText);
  for (const w of rows) {
    const axis = AXES.indexOf(w.axis);
    const m = merged.find(m => sameLine(m, w));
    if (!m) {
      merged.push({...w, sizes: [w.size], kinds: [w.kind], parts: [w.part]});
      continue;
    }
    m.sizes = [...new Set([...m.sizes, w.size])].sort((x, y) => x - y);
    m.kinds = union(m.kinds, [w.kind]);
    m.parts = union(m.parts, [w.part]);
    if (w.start[axis] > m.start[axis]) [m.start, m.end] = [w.start, w.end];
  }
  for (const m of merged) [m.size, m.kind, m.part] = [Math.max(...m.sizes), m.kinds.join('+'), m.parts[0]];
  return merged.sort((a, b) => b.count - a.count || compareArrays(a.start, b.start));
}

/** Solid count and bounds per assembly path (up to three levels below the root). */
function treeSummary(oc: OC, solids: Solid[]): {tree: TreeEntry[]; total: number} {
  const groups = new Map<string, Solid[]>();
  for (const s of solids) {
    const names = s.path.slice(1, 4).filter(Boolean);
    if (!names.length) names.push('(root)');
    for (let depth = 1; depth <= names.length; depth++) {
      const key = names.slice(0, depth).join(' / ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
  }
  const tree = [...groups.keys()].sort(byText).slice(0, MAX_TREE).map(path => {
    const members = groups.get(path)!;
    const b = rounded(unionBox(members.map(m => solidBox(oc, m))));
    return {path, solids: members.length, size: b.size, min: b.min};
  });
  return {tree, total: groups.size};
}

/** Facts about a read STEP model, as a JSON-ready object. */
export function inspect(model: StepModel): Facts {
  const {oc, solids} = model;
  const colours: Record<string, number> = {};
  for (const s of solids) colours[s.colour ?? 'none'] = (colours[s.colour ?? 'none'] ?? 0) + 1;
  const volumes = solids.map(s => volume(oc, s.shape));
  const buckets = Object.fromEntries(VOLUME_BUCKETS.map(t => [`<${t}`, volumes.filter(v => v < t).length]));
  const {tree, total} = treeSummary(oc, solids);
  const faces = solids.reduce((n, s) => n + uniqueSubShapes(oc, s.shape, 'FACE').length, 0);
  const reasons = [
    ...(solids.length > COMPLEX_SOLIDS ? [`${solids.length} solids > ${COMPLEX_SOLIDS}`] : []),
    ...(faces > COMPLEX_FACES ? [`${faces} faces > ${COMPLEX_FACES}`] : []),
  ];
  const {rows, singles} = findRows([...cylinderCandidates(oc, solids), ...postCandidates(oc, solids)]);
  return {
    file: basename(model.path),
    bounds: rounded(unionBox(solids.map(s => solidBox(oc, s)))),
    solids: solids.length,
    complexity: {faces, verdict: reasons.length ? 'complex' : 'simple', reasons},
    volumes: {total: r(volumes.reduce((s, v) => s + v, 0), 1), smallestSolidsBelow: buckets},
    colours: {
      distinct: Object.keys(colours).filter(c => c !== 'none').length,
      bySolid: Object.fromEntries(Object.entries(colours).sort((a, b) => b[1] - a[1])),
      faceColours: model.faceColours,
    },
    tree, treeEntries: total,
    contacts: {rows, singles: singles.slice(0, 60), singlesTotal: singles.length},
  };
}

const num = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const vec = (v: number[]) => `[${v.map(num).join(', ')}]`;

/** Human-readable summary of `inspect()`. */
export function formatText(facts: Facts): string {
  const b = facts.bounds;
  const cx = facts.complexity;
  const lines = [
    `${facts.file}: ${facts.solids} solids, size ${b.size.map(num).join(' x ')} mm`,
    `  bounds min ${vec(b.min)} max ${vec(b.max)}`,
    `  complexity: ${cx.verdict} (${cx.faces} faces${cx.reasons.length ? `; ${cx.reasons.join(', ')}` : ''})`,
    `  small solids: ${Object.entries(facts.volumes.smallestSolidsBelow).map(([k, n]) => `${n} ${k} mm³`).join(', ')}`,
  ];
  const c = facts.colours;
  lines.push(`  colours: ${c.distinct} distinct, faces with their own colour: ${c.faceColours}`);
  lines.push(...Object.entries(c.bySolid).slice(0, 12).map(([colour, n]) => `    ${colour}: ${n} solids`));
  if (c.distinct <= 1) lines.push('    (one colour or none: colour rules will be needed)');
  lines.push(`  tree (${facts.treeEntries} entries, first ${facts.tree.length}):`);
  lines.push(...facts.tree.map(t => `    ${t.path}: ${t.solids} solids, size ${vec(t.size)}`));
  const rows = facts.contacts.rows;
  lines.push(`  contact rows: ${rows.length}`);
  lines.push(...rows.map(w => `    ${w.count} x ${w.kind} (${w.axis}, ${w.sizes.join('/')} mm) from ${vec(w.start)}`
    + ` step ${vec(w.step)} in ${w.parts.map(p => p || '(root)').join(' | ')}`));
  lines.push(`  single contact candidates: ${facts.contacts.singlesTotal}`);
  lines.push(...facts.contacts.singles.slice(0, 20)
    .map(s => `    ${s.kind} (${s.axis}, ${s.size} mm) at ${vec(s.point)} in ${s.part || '(root)'}`));
  return lines.join('\n');
}
