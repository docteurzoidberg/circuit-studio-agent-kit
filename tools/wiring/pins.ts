// Pins of the parts a wiring document names, wherever they come from: a part prepared by wiring-parts
// (`.circuitstudio/parts/<id>/<id>.c3dcomponent`) or a built-in Circuit Studio part (`.circuitstudio/catalog.json`).
// Stand-ins have no file: their pins are listed in the document itself. Used by `part pins` and by `wiring`.
import {existsSync, readFileSync} from 'node:fs';
import {relative} from 'node:path';
import type {CatalogSnapshot} from '../catalog/snapshot.ts';
import {kitPath} from '../project.ts';

/** A pin, with the names a document may use for it. */
export interface PinNames {
  id: string;
  label?: string;
  silkscreen?: string;
  aliases?: string[];
}

export interface PartPins {
  id: string;
  source: 'prepared' | 'catalog';
  /** File the pins were read from, relative to the project root. */
  file: string;
  name: string;
  pins: PinNames[];
}

interface ComponentFile {
  format?: string;
  part?: {id?: string; name?: string; pins?: PinNames[]};
}

const names = ({id, label, silkscreen, aliases}: PinNames): PinNames => {
  const pin: PinNames = {id};
  if (label !== undefined) pin.label = label;
  if (silkscreen !== undefined) pin.silkscreen = silkscreen;
  if (aliases?.length) pin.aliases = aliases;
  return pin;
};

/** Reads the parts of a project once; `find` looks a part up by its identifier. */
export class PartLibrary {
  readonly root: string;
  private catalog: CatalogSnapshot | null | undefined;
  private readonly cache = new Map<string, PartPins | null>();

  constructor(root: string) {
    this.root = root;
  }

  /** Path of the prepared part `<id>`, whether it exists or not. */
  preparedFile(id: string): string {
    return kitPath(this.root, `parts/${id}/${id}.c3dcomponent`);
  }

  /** The catalog snapshot, or null when the project has none. */
  catalogSnapshot(): CatalogSnapshot | null {
    if (this.catalog === undefined) {
      const file = kitPath(this.root, 'catalog.json');
      this.catalog = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as CatalogSnapshot : null;
    }
    return this.catalog;
  }

  /** A prepared part with this identifier. */
  prepared(id: string): PartPins | null {
    const key = `prepared:${id}`;
    if (!this.cache.has(key)) {
      const file = this.preparedFile(id);
      let found: PartPins | null = null;
      if (existsSync(file)) {
        const component = JSON.parse(readFileSync(file, 'utf8')) as ComponentFile;
        if (component.format !== 'c3d-component' || !Array.isArray(component.part?.pins)) {
          throw new Error(`${relative(this.root, file)} is not a Circuit Studio component`);
        }
        found = {id, source: 'prepared', file: relative(this.root, file), name: component.part.name ?? id,
          pins: component.part.pins.map(names)};
      }
      this.cache.set(key, found);
    }
    return this.cache.get(key) ?? null;
  }

  /** A built-in part of the catalog snapshot with this modelId. */
  builtIn(modelId: string): PartPins | null {
    const part = this.catalogSnapshot()?.parts.find(p => p.modelId === modelId);
    return part ? {id: modelId, source: 'catalog', file: relative(this.root, kitPath(this.root, 'catalog.json')),
      name: part.name, pins: part.pins.map(names)} : null;
  }

  /** A part by the identifier a document's *Part* column gives: a prepared part first, then the catalog. */
  find(id: string): PartPins | null {
    return this.prepared(id) ?? this.builtIn(id);
  }
}

/** Every name of a pin, for messages and matching. */
export function pinNames(pin: PinNames): string[] {
  return [pin.id, pin.label, pin.silkscreen, ...(pin.aliases ?? [])].filter((n): n is string => !!n);
}

/** Pins whose label, silkscreen or alias is `name` (case-insensitive), for a "did you mean" hint. */
export function pinsNamed(pins: PinNames[], name: string): PinNames[] {
  const wanted = name.trim().toLowerCase();
  return pins.filter(pin => pinNames(pin).some(n => n.toLowerCase() === wanted));
}

/** Aliases not already shown as the identifier or the label. */
const aliases = (pin: PinNames) => (pin.aliases ?? []).filter(a => a !== pin.id && a !== pin.label);

/** Text of `part pins`: one block per part, one line per pin. */
export function formatPins(parts: PartPins[]): string {
  return parts.map(part => {
    const width = Math.max(...part.pins.map(p => p.id.length), 2);
    const lines = part.pins.map(pin => {
      const extra = [
        pin.label !== undefined && pin.label !== pin.id ? pin.label : '',
        pin.silkscreen !== undefined && pin.silkscreen !== pin.label ? `silkscreen ${pin.silkscreen}` : '',
        aliases(pin).length ? `aliases ${aliases(pin).join(', ')}` : '',
      ].filter(Boolean).join('  ');
      return `  ${pin.id.padEnd(width)}  ${extra}`.trimEnd();
    });
    return [`${part.id}: ${part.name} (${part.source}, ${part.file}), ${part.pins.length} pins`, ...lines].join('\n');
  }).join('\n\n');
}
