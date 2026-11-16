// `build`: the Circuit Studio project of a wiring, `.circuitstudio/project.c3dproj`, generated from
// `.circuitstudio/wiring.json` and the parts (built-in templates, prepared `.c3dcomponent` files, stand-in boxes).
//
// - Parts are placed from the layout hints of wiring.json, else automatically: the most connected part at the
//   centre, then each other part next to the pins it is wired to, on the side their wires leave, with as few
//   wires crossing a part as possible; parts lying flat are turned so their pins face their wires, parts standing
//   up (panel meters facing the viewer) keep their pose.
// - Wires use Circuit Studio's clean routing (orthogonal lanes), in the document's order.
// - The routes are planned with Circuit Studio's own planner (engine.ts); a part whose wire finds no route is moved
//   further out or turned, a few times, before the blocked wires are reported.
// - When the project already exists, the user's edits made in the editor are kept: the position and rotation of
//   every part still in the wiring, the route shape of every wire still in it, the camera and any other project
//   setting (presentation). `.circuitstudio/build.json` records the placements and camera build wrote, so only
//   what differs from them counts as an edit; the rest is placed again (a new layout hint applies). The document
//   stays the source of what is connected and in which colour.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {relative} from 'node:path';
import type {CatalogSnapshot} from '../catalog/snapshot.ts';
import {kitPath} from '../project.ts';
import {readVideo} from '../video/video.ts';
import {checkWiring, formatReport} from '../wiring/check.ts';
import {loadEngine, type CsComponent, type CsPin, type CsProject, type CsWire, type Engine, type Triple} from './engine.ts';

/** wiring.json, as far as build reads it (checked by `wiring` first). */
interface WiringEnd {
  part: string;
  pin: string;
  text?: string;
}
interface WiringFile {
  title?: string;
  parts: {name: string; kind: 'catalog' | 'prepared' | 'stand-in'; modelId?: string; ref?: string; size?: Triple;
    pins?: string[]}[];
  connections: {color?: string; from: WiringEnd; to: WiringEnd[]; line: number}[];
  layout?: {part: string; x: number; y: number; rotation?: number}[];
}

interface ComponentFile {
  part: {id: string; name: string; dimensions: Triple; geometry: CsComponent['geometry']; pins: CsPin[]; asset?: string};
}

export interface BuildOptions {
  /** Circuit Studio checkout to take the engine from (default: the catalog snapshot's checkout). */
  from?: string;
  /** Parts (document names) to give back to build: their edited placement is dropped and they are placed again. */
  reset?: string[];
  /** Moves asked for in words, as `<part name>=x,y[,rotation]` (mm, degrees): applied as the user's edits. */
  move?: string[];
  /** Plan and report without writing the project or build.json, to try placements. */
  dryRun?: boolean;
}

export interface PlacedPart {
  name: string;
  id: string;
  placement: 'moved' | 'kept' | 'layout' | 'automatic';
  position: [number, number];
  rotation: number;
}

export interface BuildReport {
  file: string;
  /** True when nothing was written (--dry-run). */
  dryRun: boolean;
  /** The wiring document, relative to the project root. */
  source: string;
  bytes: number;
  parts: PlacedPart[];
  wires: number;
  /** Wires whose route shape was kept from the previous project. */
  keptRoutes: number;
  blocked: {id: string; label: string; line: number}[];
  routingSeconds: number;
  /** Circuit Studio checkout the engine came from. */
  engine: string;
}

/** Colours of the wiring document, as Circuit Studio wires (black lightened: plain black vanishes on dark scenes). */
const WIRE_COLOURS: Record<string, string> = {
  black: '#383d45', red: '#bf3128', orange: '#cc6511', blue: '#2b60ae', purple: '#7944ac', green: '#2a8450',
  brown: '#86572a', yellow: '#a87d00', white: '#e8e8e2',
};
const WIRE_SHAPE = ['routeMode', 'bendPoints', 'liftHeight', 'curvature', 'diameter', 'autoLane'] as const;
/** `.circuitstudio/build.json`: what build last wrote, to tell the user's edits from its own placements. */
interface BuildState {
  /** Placement build wrote for each part; `user` marks a placement kept from the user's edits. */
  components: Record<string, {position: Triple; rotation: Triple; user?: true}>;
  camera: CsProject['camera'] & {user?: true};
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
const GAP = 20;
const MAX_REROUTES = 4;

const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const clone = <T>(value: T): T => structuredClone(value);

/** Unique identifiers from names: `slug`, then `slug-2`... */
function uniqueIds(names: string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    let id = slug(name);
    for (let n = 2; used.has(id); n++) id = `${slug(name)}-${n}`;
    used.add(id);
    return id;
  });
}

// --- Geometry, as Circuit Studio places pins (src/geometry.ts: localPin, worldPin; three.js Euler order XYZ).

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Rotates by Euler angles in degrees, order XYZ (the vector turns about Z, then Y, then X). */
function rotate([x, y, z]: Triple, [rx, ry, rz]: Triple): Triple {
  const [cz, sz] = [Math.cos(radians(rz)), Math.sin(radians(rz))];
  [x, y] = [cz * x - sz * y, sz * x + cz * y];
  const [cy, sy] = [Math.cos(radians(ry)), Math.sin(radians(ry))];
  [x, z] = [cy * x + sy * z, -sy * x + cy * z];
  const [cx, sx] = [Math.cos(radians(rx)), Math.sin(radians(rx))];
  [y, z] = [cx * y - sx * z, sx * y + cx * z];
  return [x, y, z];
}

function localPin(pin: CsPin): Triple {
  return pin.localPosition ?? [pin.side === 'left' ? -15 : 15, 9 - pin.index * 0.87, 2.4];
}

function worldPin(pin: CsPin, component: {position: Triple; rotation: Triple}): Triple {
  const [x, y, z] = rotate(localPin(pin), component.rotation);
  return [x + component.position[0], y + component.position[1], z + component.position[2]];
}

/** Where a wire leaving `pin` is headed: a little beyond the pin, along its exit direction (on the table). */
function exitPoint(pin: CsPin, component: {position: Triple; rotation: Triple}, reach = 12): Triple {
  const at = worldPin(pin, component), [dx, dy] = rotate(pin.exitDirection ?? [0, 0, 1], component.rotation);
  const flat = Math.hypot(dx, dy);
  return flat < 0.3 ? at : [at[0] + (dx / flat) * reach, at[1] + (dy / flat) * reach, at[2]];
}

/** Whether the segment a-b crosses the rectangle (Liang-Barsky clipping). */
function crosses(a: Triple, b: Triple, r: {x: number; y: number; half: [number, number]}): boolean {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const edges: [number, number][] = [[-d[0], a[0] - (r.x - r.half[0])], [d[0], r.x + r.half[0] - a[0]],
    [-d[1], a[1] - (r.y - r.half[1])], [d[1], r.y + r.half[1] - a[1]]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Half sizes of a part's footprint on the table, for a rotation around the vertical axis. */
function halfSize(component: CsComponent, rotation = component.rotation[2]): [number, number] {
  const [w, h] = component.dimensions ?? [28, 20, 3];
  const c = Math.abs(Math.cos(radians(rotation))), s = Math.abs(Math.sin(radians(rotation)));
  return [(c * w + s * h) / 2, (s * w + c * h) / 2];
}

function overlaps(a: {x: number; y: number; half: [number, number]}, b: {x: number; y: number; half: [number, number]}, gap: number) {
  return Math.abs(a.x - b.x) < a.half[0] + b.half[0] + gap && Math.abs(a.y - b.y) < a.half[1] + b.half[1] + gap;
}

// --- Components.

function standIn(id: string, name: string, [w, h, t]: Triple, pins: string[]): CsComponent {
  const pitch = Math.min(2.54, w / pins.length);
  return {
    id, modelId: 'generic-pcb', name, position: [0, 0, 0], rotation: [0, 0, 0], dimensions: [w, h, t],
    geometry: {kind: 'procedural-pcb', quality: 'simple-placeholder', pcbThickness: t, verified: false},
    pins: pins.map((pin, index) => ({id: pin, label: pin, side: 'top', index,
      localPosition: [(index - (pins.length - 1) / 2) * pitch, h / 2 - 1, t / 2], exitDirection: [0, 0, 1]})),
  };
}

function makeComponents(root: string, wiring: WiringFile, engine: Engine, assets: Record<string, string>): CsComponent[] {
  const ids = uniqueIds(wiring.parts.map(p => p.name));
  return wiring.parts.map((part, i): CsComponent => {
    const id = ids[i];
    if (part.kind === 'stand-in') return standIn(id, part.name, part.size!, part.pins!);
    if (part.kind === 'catalog') {
      const template = engine.templates.get(part.modelId!);
      if (!template) throw new Error(`${part.name}: "${part.modelId}" is not a built-in part of ${engine.source}`);
      return {...clone(template), id, name: part.name, position: [0, 0, 0], rotation: [0, 0, 0]};
    }
    const file = kitPath(root, `parts/${part.ref}/${part.ref}.c3dcomponent`);
    const {part: prepared} = JSON.parse(readFileSync(file, 'utf8')) as ComponentFile;
    const assetId = prepared.geometry?.modelAssetId;
    if (!assetId || !prepared.asset) {
      throw new Error(`${part.name}: ${relative(root, file)} carries no model asset reference (converted by an older kit): `
        + `run part convert on its part.yaml again`);
    }
    assets[assetId] = prepared.asset;
    return {id, modelId: `custom:${prepared.id}`, name: part.name, position: [0, 0, 0], rotation: [0, 0, 0],
      pins: prepared.pins, dimensions: prepared.dimensions, geometry: prepared.geometry};
  });
}

function makeWires(wiring: WiringFile, idOf: Map<string, string>): {wires: CsWire[]; lines: Map<string, number>} {
  const wires: CsWire[] = [], lines = new Map<string, number>(), used = new Set<string>();
  const text = (end: WiringEnd) => end.text ?? `${end.part} ${end.pin}`;
  for (const connection of wiring.connections) {
    for (const to of connection.to) {
      const base = `wire-${slug(connection.from.part)}-${slug(connection.from.pin)}-${slug(to.part)}-${slug(to.pin)}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      lines.set(id, connection.line);
      wires.push({
        id, from: {componentId: idOf.get(connection.from.part)!, pinId: connection.from.pin},
        to: {componentId: idOf.get(to.part)!, pinId: to.pin},
        color: WIRE_COLOURS[connection.color ?? ''] ?? connection.color ?? '#9aa3ad', diameter: 1.1,
        label: `${text(connection.from)} → ${text(to)}`, curvature: 19, routeMode: 'clean',
      });
    }
  }
  return {wires, lines};
}

// --- Placement.

/**
 * Whether a part stands up (taller than two thirds of its smaller side, like a panel meter posed with its face
 * towards the viewer): such a part keeps the pose wiring-parts gave it and is never turned, so its face stays
 * towards the viewer. Parts lying flat (boards, modules) may be turned so their pins face their wires.
 */
function standsUp(component: CsComponent): boolean {
  const [w, h, t] = component.dimensions ?? [28, 20, 3];
  return t > (Math.min(w, h) * 2) / 3;
}

/** Places the parts that are not placed yet; returns how each part was placed. */
function place(components: CsComponent[], wires: CsWire[], fixed: Map<string, PlacedPart['placement']>, gap: number,
  avoid: Map<string, Set<number>> = new Map()): void {
  const byId = new Map(components.map(c => [c.id, c]));
  const placed = new Set(fixed.keys());
  const degree = new Map(components.map(c => [c.id, wires.filter(w => w.from.componentId === c.id || w.to.componentId === c.id).length]));
  const box = (c: CsComponent, x = c.position[0], y = c.position[1], rotation = c.rotation[2]) => ({x, y, half: halfSize(c, rotation)});
  const clear = (c: CsComponent, x: number, y: number, rotation: number) =>
    [...placed].every(id => !overlaps(box(c, x, y, rotation), box(byId.get(id)!), gap));

  // The most connected part goes to the centre, unless it is placed already or the centre is taken.
  const main = [...components].sort((a, b) => degree.get(b.id)! - degree.get(a.id)!)[0];
  if (!placed.has(main.id) && clear(main, 0, 0, 0)) {
    main.position = [0, 0, 0];
    main.rotation = [0, 0, 0];
    placed.add(main.id);
  }
  const centre = (): [number, number] => {
    const xs = [...placed].map(id => byId.get(id)!.position);
    return [xs.reduce((s, p) => s + p[0], 0) / xs.length, xs.reduce((s, p) => s + p[1], 0) / xs.length];
  };

  while (placed.size < components.length) {
    // Next: the unplaced part with the most wires to placed parts (a chain is placed link by link).
    const links = (c: CsComponent) => wires.filter(w =>
      (w.from.componentId === c.id && placed.has(w.to.componentId)) || (w.to.componentId === c.id && placed.has(w.from.componentId)));
    const next = components.filter(c => !placed.has(c.id))
      .sort((a, b) => links(b).length - links(a).length || degree.get(b.id)! - degree.get(a.id)!)[0];
    const pairs = links(next).map(w => {
      const mine = w.from.componentId === next.id ? w.from : w.to, other = w.from.componentId === next.id ? w.to : w.from;
      const partner = byId.get(other.componentId)!;
      return {pin: next.pins.find(p => p.id === mine.pinId)!, target: exitPoint(partner.pins.find(p => p.id === other.pinId)!, partner)};
    }).filter(p => p.pin);
    const from = placed.size ? centre() : [0, 0] as [number, number];
    const anchor: [number, number] = pairs.length
      ? [pairs.reduce((s, p) => s + p.target[0], 0) / pairs.length, pairs.reduce((s, p) => s + p.target[1], 0) / pairs.length]
      : from;
    let direction = Math.atan2(anchor[1] - from[1], anchor[0] - from[0]);
    if (Math.hypot(anchor[0] - from[0], anchor[1] - from[1]) < 1e-6) direction = Math.PI / 2;

    let best: {x: number; y: number; rotation: number; score: number} | null = null;
    for (const rotation of standsUp(next) ? [0] : [0, 90, 180, 270]) {
      if (avoid.get(next.id)?.has(rotation) && !standsUp(next)) continue;
      for (const offset of [0, 20, -20, 40, -40, 60, -60, 90, -90]) {
        const ray = direction + radians(offset);
        for (let along = 0; along < 600; along += 5) {
          const x = anchor[0] + Math.cos(ray) * along, y = anchor[1] + Math.sin(ray) * along;
          if (!clear(next, x, y, rotation)) continue;
          const candidate = {position: [x, y, 0] as Triple, rotation: [0, 0, rotation] as Triple};
          // Wire length as the clean router draws it (orthogonal), from each partner pin's exit to this part's pin
          // exit; a wire whose straight path crosses a placed part will have to go around it.
          const obstacles = [...placed].map(id => box(byId.get(id)!));
          const score = pairs.reduce((s, p) => {
            const end = exitPoint(p.pin, candidate);
            const crossing = obstacles.filter(o => crosses(p.target, end, o)).length;
            return s + Math.abs(end[0] - p.target[0]) + Math.abs(end[1] - p.target[1]) + crossing * 120;
          }, 0) + along * (pairs.length ? 0.2 : 1) + Math.abs(offset) * 0.1;
          if (!best || score < best.score) best = {x, y, rotation, score};
          break;
        }
      }
    }
    if (!best) throw new Error(`no room found for ${next.name}`);
    next.position = [Math.round(best.x * 10) / 10, Math.round(best.y * 10) / 10, 0];
    next.rotation = [0, 0, best.rotation];
    placed.add(next.id);
  }
}

/** A camera looking down at the whole circuit, slightly from the front. */
function camera(components: CsComponent[]): CsProject['camera'] {
  const boxes = components.map(c => ({x: c.position[0], y: c.position[1], half: halfSize(c)}));
  const minX = Math.min(...boxes.map(b => b.x - b.half[0])), maxX = Math.max(...boxes.map(b => b.x + b.half[0]));
  const minY = Math.min(...boxes.map(b => b.y - b.half[1])), maxY = Math.max(...boxes.map(b => b.y + b.half[1]));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, size = Math.max(maxX - minX, maxY - minY, 60);
  const r = (v: number) => Math.round(v * 10) / 10;
  return {position: [r(cx), r(cy - size * 0.55), r(size * 1.25)], target: [r(cx), r(cy), 0]};
}

// --- Build.

function engineSource(root: string, options: BuildOptions): string {
  if (options.from) return options.from;
  const file = kitPath(root, 'catalog.json');
  const snapshot = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as CatalogSnapshot : null;
  if (snapshot?.source.kind === 'local' && existsSync(snapshot.source.path)) return snapshot.source.path;
  throw new Error('build needs a local Circuit Studio checkout for its route planner: give it with --from <folder> '
    + '(the catalog snapshot has none)');
}

export async function build(root: string, options: BuildOptions = {}): Promise<BuildReport> {
  const check = checkWiring(root);
  if (check.problems.length) throw new Error(`wiring.json has problems, fix them first:\n${formatReport(check)}`);
  const wiring = JSON.parse(readFileSync(kitPath(root, 'wiring.json'), 'utf8')) as WiringFile;
  const engine = await loadEngine(engineSource(root, options));

  const assets: Record<string, string> = {};
  const components = makeComponents(root, wiring, engine, assets);
  const idOf = new Map(wiring.parts.map((p, i) => [p.name, components[i].id]));
  const {wires, lines} = makeWires(wiring, idOf);

  // Previous project: the user's edits win over hints and automatic placement. Without a state file (a project
  // saved from elsewhere), every placement in it counts as the user's.
  const file = kitPath(root, 'project.c3dproj', {create: true});
  const stateFile = kitPath(root, 'build.json');
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as CsProject : null;
  const state = previous && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) as BuildState : null;
  // An edit stays the user's at every later build, until the part is reset.
  const reset = new Set((options.reset ?? []).map(name => {
    const id = idOf.get(name);
    if (!id) throw new Error(`--reset: "${name}" is not a part of the wiring`);
    return id;
  }));
  const edited = (old: {id: string; position: Triple; rotation: Triple}) => {
    if (reset.has(old.id)) return false;
    const written = state?.components[old.id];
    return !written || !!written.user || !same(written.position, old.position) || !same(written.rotation, old.rotation);
  };
  const fixed = new Map<string, PlacedPart['placement']>();
  for (const component of components) {
    const old = previous?.components.find(c => c.id === component.id);
    if (old && edited(old)) {
      component.position = old.position;
      component.rotation = old.rotation;
      fixed.set(component.id, 'kept');
    }
  }
  for (const move of options.move ?? []) {
    const at = move.lastIndexOf('='), name = move.slice(0, at).trim();
    const values = move.slice(at + 1).split(',').map(v => Number(v.trim()));
    const component = components.find(c => c.id === idOf.get(name));
    if (at < 0 || !component) throw new Error(`--move "${move}": not a part of the wiring (expected <part name>=x,y[,rotation])`);
    if (values.length < 2 || values.length > 3 || values.some(v => !Number.isFinite(v))) {
      throw new Error(`--move "${move}": expected x,y or x,y,rotation in mm and degrees`);
    }
    component.position = [values[0], values[1], 0];
    if (values.length === 3) component.rotation = [0, 0, values[2]];
    fixed.set(component.id, 'moved');
  }
  let keptRoutes = 0;
  for (const wire of wires) {
    const old = previous?.wires.find(w => w.id === wire.id);
    if (!old) continue;
    for (const key of WIRE_SHAPE) if (old[key] !== undefined) (wire as Record<string, unknown>)[key] = old[key];
    if (old.routeMode !== 'clean' || old.bendPoints) keptRoutes++;
  }
  for (const hint of wiring.layout ?? []) {
    const component = components.find(c => c.id === idOf.get(hint.part));
    if (!component || fixed.has(component.id)) continue;
    component.position = [hint.x, hint.y, 0];
    component.rotation = [0, 0, hint.rotation ?? 0];
    fixed.set(component.id, 'layout');
  }
  const automatic = components.filter(c => !fixed.has(c.id)).map(c => c.id);

  // Place, plan the routes, and move the automatically placed parts of blocked wires a few times.
  const started = performance.now();
  place(components, wires, fixed, GAP);
  let routed = engine.planRoutes(wires, components);
  const avoid = new Map<string, Set<number>>();
  for (let round = 1; round <= MAX_REROUTES && routed.some(w => w.routingBlocked); round++) {
    const movable = new Set(routed.filter(w => w.routingBlocked)
      .flatMap(w => [w.from.componentId, w.to.componentId]).filter(id => automatic.includes(id)));
    if (!movable.size) break;
    const before = components.map(c => ({position: c.position, rotation: c.rotation}));
    for (const id of movable) {
      const component = components.find(c => c.id === id)!;
      avoid.set(id, (avoid.get(id) ?? new Set()).add(component.rotation[2]));
      if (avoid.get(id)!.size === 4) avoid.set(id, new Set());
    }
    const keep = new Map(components.filter(c => !movable.has(c.id)).map(c => [c.id, 'automatic' as const]));
    place(components, wires, keep, GAP + 10 * round, avoid);
    const retry = engine.planRoutes(wires, components);
    if (retry.filter(w => w.routingBlocked).length < routed.filter(w => w.routingBlocked).length) routed = retry;
    else components.forEach((c, i) => { c.position = before[i].position; c.rotation = before[i].rotation; });
  }
  const routingSeconds = Math.round((performance.now() - started) / 100) / 10;

  const cameraEdited = !!previous && (!state || !!state.camera.user || !same([...state.camera.position, ...state.camera.target],
    [...previous.camera.position, ...previous.camera.target]));
  const project: CsProject = {
    ...(previous ?? {}),
    schemaVersion: 1,
    name: wiring.title ?? previous?.name ?? 'Wiring',
    components,
    wires,
    wireOrder: wires.map(w => w.id),
    camera: cameraEdited ? previous.camera : camera(components),
    assets,
  };
  // The video settings chosen for the project (D27), so the page's Auto Video dialog shows them.
  const video = readVideo(root);
  if (video.settings) {
    project.presentation = {...(project.presentation as object ?? {}), video: video.settings,
      ...(video.scenes ? {cameraScenes: video.scenes} : {})};
  }
  engine.validate(project);
  const text = `${JSON.stringify(project, null, 1)}\n`;
  if (!options.dryRun) writeFileSync(file, text);
  const written: BuildState = {camera: cameraEdited ? {...project.camera, user: true} : project.camera,
    components: Object.fromEntries(components.map(c => [c.id, fixed.get(c.id) === 'kept' || fixed.get(c.id) === 'moved'
      ? {position: c.position, rotation: c.rotation, user: true as const} : {position: c.position, rotation: c.rotation}]))};
  if (!options.dryRun) writeFileSync(stateFile, `${JSON.stringify(written, null, 1)}\n`);

  return {
    file: relative(root, file),
    dryRun: !!options.dryRun,
    source: check.source ?? 'wiring.md',
    bytes: Buffer.byteLength(text),
    parts: components.map(c => ({name: c.name, id: c.id, placement: fixed.get(c.id) ?? 'automatic',
      position: [c.position[0], c.position[1]], rotation: c.rotation[2]})),
    wires: wires.length,
    keptRoutes,
    blocked: routed.filter(w => w.routingBlocked).map(w => ({id: w.id, label: w.label, line: lines.get(w.id)!})),
    routingSeconds,
    engine: engine.source,
  };
}

export function formatBuild(report: BuildReport): string {
  const width = Math.max(...report.parts.map(p => p.name.length));
  const mb = report.bytes / 1024 / 1024;
  const lines = [
    `${report.file}: ${report.parts.length} parts, ${report.wires} wires, ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(report.bytes / 1024)} KB`}`
      + (report.dryRun ? ' (dry run: nothing written)' : ''),
    ...report.parts.map(p => `  ${p.name.padEnd(width)}  ${p.placement.padEnd(9)}  x ${p.position[0]}, y ${p.position[1]}, ${p.rotation}°`),
    `routes: ${report.blocked.length ? `${report.blocked.length} of ${report.wires} wires blocked` : `${report.wires} wires, none blocked`}`
      + `${report.keptRoutes ? `, ${report.keptRoutes} route shape${report.keptRoutes > 1 ? 's' : ''} kept` : ''} (${report.routingSeconds} s, planner of ${report.engine})`,
    ...report.blocked.map(b => `  ${report.source}:${b.line}  ${b.label}`),
  ];
  return lines.join('\n');
}
