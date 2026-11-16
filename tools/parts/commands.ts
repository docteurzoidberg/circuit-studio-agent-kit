// `part inspect` and `part convert` (port of `python -m c3dparts`), called by the kit's command line (tools/cli.ts).
// `convert` writes, by default next to the spec, `<id>.c3dcomponent` and `<id>.png`.
import {dirname, join} from 'node:path';
import {convert, writeComponent} from './convert.ts';
import {formatText, inspect} from './inspect.ts';
import {writePreview} from './preview.ts';
import {loadSpec} from './spec.ts';
import {readStep} from './step.ts';

export interface PartOptions {
  json?: boolean;
  /** `.c3dcomponent` to write (convert). */
  out?: string;
  /** Preview PNG to write (convert). */
  preview?: string;
  'no-preview'?: boolean;
}

/** `part inspect <model.step> [--json]`: what a STEP model holds, as text or JSON. */
export async function inspectCommand(step: string, options: PartOptions = {}): Promise<string> {
  const facts = inspect(await readStep(step));
  return options.json ? JSON.stringify(facts, null, 1) : formatText(facts);
}

/** `part convert <part.yaml> [--out <file>] [--preview <file.png> | --no-preview] [--json]`. */
export async function convertCommand(specPath: string, options: PartOptions = {}): Promise<string> {
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
