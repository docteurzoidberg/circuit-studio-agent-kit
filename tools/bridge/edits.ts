// The user's edits in Circuit Studio, read back from the page: parts moved or turned, wire routes reshaped. They
// are written into `.circuitstudio/project.c3dproj`, where `build` keeps them (it compares with build.json).
import type {CsProject, CsWire, Triple} from '../project/engine.ts';

/** The wire fields that make a route's shape: the ones `build` keeps from the user's edits. */
const SHAPE_KEYS = ['routeMode', 'bendPoints', 'liftHeight', 'curvature', 'diameter', 'autoLane'] as const;

export type Placed = Pick<CsProject, 'components' | 'wires'>;

export interface Snapshot {
  parts: Record<string, {position: Triple; rotation: Triple}>;
  wires: Record<string, string>;
}

export interface Changes {
  parts: string[];
  wires: string[];
}

const shapeOf = (wire: CsWire) => JSON.stringify(SHAPE_KEYS.map(key => wire[key] ?? null));
const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
const round = (v: number) => Math.round(v * 10) / 10;

export function snapshot(project: Placed): Snapshot {
  return {
    parts: Object.fromEntries(project.components.map(c => [c.id, {position: c.position, rotation: c.rotation}])),
    wires: Object.fromEntries(project.wires.map(w => [w.id, shapeOf(w)])),
  };
}

/** Parts moved or turned and wires reshaped from `before` to `after` (ids present in both). */
export function changes(before: Snapshot, after: Snapshot, {wires = true}: {wires?: boolean} = {}): Changes {
  return {
    parts: Object.keys(after.parts).filter(id => before.parts[id] && (!near(before.parts[id].position, after.parts[id].position)
      || !near(before.parts[id].rotation, after.parts[id].rotation))),
    wires: wires ? Object.keys(after.wires).filter(id => before.wires[id] !== undefined && before.wires[id] !== after.wires[id]) : [],
  };
}

/** Copies the changed placements and route shapes from the editor's project into the file's; returns what changed. */
export function applyEdits(file: CsProject, edited: Placed, changed: Changes): string[] {
  const told: string[] = [];
  for (const id of changed.parts) {
    const target = file.components.find(c => c.id === id), source = edited.components.find(c => c.id === id);
    if (!target || !source) continue;
    target.position = [...source.position];
    target.rotation = [...source.rotation];
    told.push(`${target.name} x ${round(target.position[0])}, y ${round(target.position[1])}, ${round(target.rotation[2])}°`);
  }
  for (const id of changed.wires) {
    const target = file.wires.find(w => w.id === id), source = edited.wires.find(w => w.id === id);
    if (!target || !source) continue;
    for (const key of SHAPE_KEYS) {
      if (source[key] === undefined) delete target[key];
      else (target as Record<string, unknown>)[key] = structuredClone(source[key]);
    }
    told.push(`wire ${target.label}: route reshaped`);
  }
  return told;
}
