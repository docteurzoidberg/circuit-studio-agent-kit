"""Command line.

    python -m c3dparts inspect <model.step> [--json]
    python -m c3dparts convert <part.yaml> [--out <file.c3dcomponent>] [--preview <file.png> | --no-preview] [--json]

`convert` writes, by default next to the spec, `<id>.c3dcomponent` and `<id>.png`.
"""
import argparse
import json
import sys
from pathlib import Path

from .step_io import StepReadError, read_step


def run_inspect(args):
    from .inspect_step import format_text, inspect
    facts = inspect(read_step(args.step))
    print(json.dumps(facts, indent=1, ensure_ascii=False) if args.json else format_text(facts))


def run_convert(args):
    from .convert import convert, write_component
    from .spec import load_spec
    spec = load_spec(args.spec)
    out = Path(args.out) if args.out else spec.path.parent / f'{spec.id}.c3dcomponent'
    part, report, (_, coloured, centre, euler) = convert(spec)
    write_component(part, out)
    report['component'] = str(out)
    if not args.no_preview:
        from .preview import write_preview
        preview = Path(args.preview) if args.preview else spec.path.parent / f'{spec.id}.png'
        write_preview(part, coloured, centre, euler, preview)
        report['preview'] = str(preview)
    if args.json:
        print(json.dumps(report, indent=1))
        return
    d = report['dimensions']
    print(f"{report['id']}: {report['solids']['kept']}/{report['solids']['read']} solids kept, "
          f"{d[0]} x {d[1]} x {d[2]} mm, {report['pins']} pins")
    print(f"  GLB {report['glbBytes'] // 1024} KiB: {report['meshCount']} meshes, {report['materialCount']} materials, "
          f"{report['triangleCount']} triangles; colours {', '.join(report['colours'])}")
    print(f"  wrote {report['component']}" + (f" and {report['preview']}" if 'preview' in report else ''))


def main(argv=None):
    parser = argparse.ArgumentParser(prog='c3dparts', description='Prepare Circuit Studio parts from STEP models.')
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('inspect', help='report what a STEP model contains: tree, colours, sizes, contact candidates')
    p.add_argument('step', help='STEP file')
    p.add_argument('--json', action='store_true', help='print JSON instead of a readable summary')
    p.set_defaults(run=run_inspect)
    p = sub.add_parser('convert', help='convert a STEP model into a Circuit Studio part from its spec (part.yaml)')
    p.add_argument('spec', help='part spec (YAML)')
    p.add_argument('--out', help='output .c3dcomponent (default: <id>.c3dcomponent next to the spec)')
    p.add_argument('--preview', help='preview PNG (default: <id>.png next to the spec)')
    p.add_argument('--no-preview', action='store_true', help='do not draw the preview')
    p.add_argument('--json', action='store_true', help='print the report as JSON')
    p.set_defaults(run=run_convert)
    args = parser.parse_args(argv)
    from .spec import SpecError
    try:
        args.run(args)
    except (StepReadError, SpecError, RuntimeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
