// Preview PNG of a converted part: top and front orthographic views in the part frame, pins labelled.
// Drawn as SVG from a coarse tessellation (painter's order, flat shading) and
// rasterised with resvg, without a GPU. Enough to check pin positions and orientation; the faithful render comes
// from Circuit Studio itself.
import {writeFileSync} from 'node:fs';
import {Resvg} from '@resvg/resvg-js';
import {rotate, type ColouredSolid, type Conversion, type Part} from './convert.ts';
import {uniqueSubShapes, type OC} from './occt.ts';

interface Triangle {
  points: number[][];
  colour: string;
}

interface View {
  title: string;
  /** Index of the axis drawn left to right. */
  u: number;
  /** Index of the axis drawn bottom to top. */
  v: number;
}

const VIEWS: View[] = [{title: 'Top (X right, Y up)', u: 0, v: 1}, {title: 'Front (X right, Z up)', u: 0, v: 2}];
const MAX_TRIANGLES = 200_000;
const PANEL = 760;  // px per view
const HEADER = 60;
const PIN = '#e0245e';
const PIN_TEXT = '#9b1040';

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c as '&' | '<' | '>' | '"']);

/** Triangles of every kept solid in the centred, rotated part frame, with their colour. */
function partFrameTriangles(oc: OC, kept: ColouredSolid[], centre: number[], euler: number[], tolerance: number): Triangle[] {
  const out: Triangle[] = [];
  for (const {shape, colour} of kept) {
    new oc.BRepMesh_IncrementalMesh_2(shape, tolerance, false, 0.5, false);
    for (const face of uniqueSubShapes(oc, shape, 'FACE')) {
      const loc = new oc.TopLoc_Location_1();
      const handle = oc.BRep_Tool.Triangulation(oc.TopoDS.Face_1(face), loc, 0);
      if (handle.IsNull()) continue;
      const tri = handle.get();
      const trsf = loc.Transformation();
      const nodes: number[][] = [];
      for (let i = 1; i <= tri.NbNodes(); i++) {
        const p = tri.Node(i).Transformed(trsf);
        nodes.push(rotate([p.X() - centre[0], p.Y() - centre[1], p.Z() - centre[2]], euler));
      }
      for (let i = 1; i <= tri.NbTriangles(); i++) {
        const t = tri.Triangle(i);
        out.push({points: [nodes[t.Value(1) - 1], nodes[t.Value(2) - 1], nodes[t.Value(3) - 1]], colour});
      }
    }
  }
  return out;
}

/** Colour darkened by how much the triangle turns away from the viewer (flat shading). */
function shaded(hex: string, [a, b, c]: number[][], depth: number): string {
  const e1 = b.map((v, i) => v - a[i]);
  const e2 = c.map((v, i) => v - a[i]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(...n) || 1;
  const k = 0.55 + 0.45 * Math.abs(n[depth] / len);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
}

function viewSvg(part: Part, triangles: Triangle[], view: View, x0: number): string {
  const {u, v} = view;
  const depth = 3 - u - v;
  const size = Math.max(...part.dimensions);
  const half = (size / 2) * 1.15;
  const scale = PANEL / (2 * half);
  const X = (p: number[]) => (x0 + (p[u] + half) * scale).toFixed(1);
  const Y = (p: number[]) => (HEADER + (half - p[v]) * scale).toFixed(1);
  const out = [`<text x="${x0 + PANEL / 2}" y="${HEADER - 12}" font-size="16" text-anchor="middle">${esc(view.title)}</text>`,
    `<rect x="${x0}" y="${HEADER}" width="${PANEL}" height="${PANEL}" fill="none" stroke="#ccc"/>`];
  // Grid every power of ten that gives at least 4 lines.
  const stepMm = 10 ** Math.floor(Math.log10(half / 2));
  for (let g = Math.ceil(-half / stepMm) * stepMm; g <= half; g += stepMm) {
    const gx = (x0 + (g + half) * scale).toFixed(1);
    const gy = (HEADER + (half - g) * scale).toFixed(1);
    out.push(`<line x1="${gx}" y1="${HEADER}" x2="${gx}" y2="${HEADER + PANEL}" stroke="#eee"/>`,
      `<line x1="${x0}" y1="${gy}" x2="${x0 + PANEL}" y2="${gy}" stroke="#eee"/>`);
  }
  const ordered = triangles
    .map(t => ({...t, key: t.points[0][depth] + t.points[1][depth] + t.points[2][depth]}))
    .sort((a, b) => a.key - b.key);  // far triangles first
  for (const t of ordered) {
    const [a, b, c] = t.points;
    const area = Math.abs((b[u] - a[u]) * (c[v] - a[v]) - (c[u] - a[u]) * (b[v] - a[v])) * scale * scale;
    if (area < 0.02) continue;  // seen edge-on
    const fill = shaded(t.colour, t.points, depth);
    out.push(`<path d="M${X(a)} ${Y(a)}L${X(b)} ${Y(b)}L${X(c)} ${Y(c)}Z" fill="${fill}" stroke="${fill}" stroke-width="0.3"/>`);
  }
  for (const pin of part.pins) {
    const p = pin.localPosition;
    const d = pin.exitDirection;
    const tip = p.map((c, i) => c + d[i] * size * 0.06);
    const at = p.map((c, i) => c + d[i] * size * 0.07);
    const right = d[u] >= 0;
    const label = esc(pin.label);
    const width = label.length * 6.2 + 4;
    const lx = Number(X(at));
    out.push(`<line x1="${X(p)}" y1="${Y(p)}" x2="${X(tip)}" y2="${Y(tip)}" stroke="${PIN}" stroke-width="1" marker-end="url(#arrow)"/>`,
      `<circle cx="${X(p)}" cy="${Y(p)}" r="2.5" fill="${PIN}"/>`,
      `<rect x="${(right ? lx : lx - width).toFixed(1)}" y="${(Number(Y(at)) - 6).toFixed(1)}" width="${width.toFixed(1)}" height="12" fill="white" fill-opacity="0.75"/>`,
      `<text x="${(right ? lx + 2 : lx - 2).toFixed(1)}" y="${(Number(Y(at)) + 4).toFixed(1)}" font-size="10" fill="${PIN_TEXT}" text-anchor="${right ? 'start' : 'end'}">${label}</text>`);
  }
  return out.join('\n');
}

/** Draw the preview of a converted part (convert.ts) into a PNG file. */
export function writePreview({part, kept, centre, euler, oc}: Conversion, out: string, title?: string): {triangles: number; bytes: number} {
  const size = Math.max(...part.dimensions);
  let triangles = partFrameTriangles(oc, kept, centre, euler, Math.max(0.05, size / 150));
  if (triangles.length > MAX_TRIANGLES) {
    const every = Math.floor(triangles.length / MAX_TRIANGLES) + 1;
    triangles = triangles.filter((_, i) => i % every === 0);
  }
  const width = PANEL * 2 + 60;
  const height = HEADER + PANEL + 40;
  const [w, d, h] = part.dimensions;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="DejaVu Sans, Arial, sans-serif">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${PIN}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="white"/>`,
    `<text x="${width / 2}" y="24" font-size="18" text-anchor="middle">${esc(title ?? `${part.name} — ${w} x ${d} x ${h} mm, ${part.pins.length} pins`)}</text>`,
    viewSvg(part, triangles, VIEWS[0], 20),
    viewSvg(part, triangles, VIEWS[1], 40 + PANEL),
    '</svg>',
  ].join('\n');
  const png = new Resvg(svg, {font: {loadSystemFonts: true}}).render().asPng();
  writeFileSync(out, png);
  return {triangles: triangles.length, bytes: png.length};
}
