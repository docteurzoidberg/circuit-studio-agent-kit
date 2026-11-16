"""Part spec (`part.yaml`): everything `convert` needs, written by the wiring-parts skill with the user.

```yaml
id: so-45                          # kebab-case, unique in the project
name: SO-45 panel voltmeter
category: meter                    # optional, default "module"
step: so-45-voltmeter.step         # relative to this file
orientation: [0, 0, 180]           # Euler XYZ in degrees, applied after centring (optional)
mesh: { linear: 0.25, angular: 0.7 }          # optional; smaller = finer and heavier
simplify: { minVolume: 1.0, mergeByColour: true }   # optional
colours:                           # optional: only when the STEP has no usable colours
  palette: { body: "#141414", steel: "#a4a4aa" }
  rules:                           # first match wins; match = text in the solid's path below the root
    - { match: "Screw", colour: steel }
    - { match: "Body", largestOver: 20, colour: body }
  default: body
pins:                              # positions and exit directions in STEP coordinates (mm)
  - { id: "+", label: "+", at: [9, -32.9, -12.5], exit: [0, -1, 0] }
  - generate:                      # a regular row (header, terminal block)
      ids: "J1-{n}"                # {n} = 1, 2, ...
      count: 22
      start: [-29.17, 79.1, 4.0]
      step: [0, -3.5, 0]
      exit: [-1, 0, 0]
      labels: [3V3, 3V3, RST]      # optional, by position; missing ones use the id
      aliases: { 21: [5V0] }       # optional, by number
```
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
ID = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')


class SpecError(ValueError):
    pass


@dataclass
class Pin:
    id: str
    label: str
    at: list
    exit: list
    aliases: list = field(default_factory=list)


@dataclass
class ColourRule:
    match: str
    colour: str
    largest_over: float | None = None
    largest_under: float | None = None


@dataclass
class Spec:
    path: Path
    id: str
    name: str
    category: str
    step: Path
    orientation: list
    mesh_linear: float
    mesh_angular: float
    min_volume: float
    merge_by_colour: bool
    palette: dict
    rules: list
    default_colour: str | None
    pins: list


def vector(value, where):
    if not (isinstance(value, list) and len(value) == 3 and all(isinstance(v, (int, float)) for v in value)):
        raise SpecError(f'{where}: expected three numbers, got {value!r}')
    return [float(v) for v in value]


def unit(value, where):
    v = vector(value, where)
    norm = sum(c * c for c in v) ** 0.5
    if norm == 0:
        raise SpecError(f'{where}: direction must not be zero')
    return [c / norm for c in v]


def expand_pins(entries):
    pins = []
    for i, entry in enumerate(entries or []):
        where = f'pins[{i}]'
        if not isinstance(entry, dict):
            raise SpecError(f'{where}: expected a mapping')
        if 'generate' in entry:
            g = entry['generate']
            for key in ('ids', 'count', 'start', 'step', 'exit'):
                if key not in g:
                    raise SpecError(f'{where}.generate: missing "{key}"')
            if '{n}' not in g['ids']:
                raise SpecError(f'{where}.generate.ids: must contain {{n}}')
            count = int(g['count'])
            start, step = vector(g['start'], f'{where}.generate.start'), vector(g['step'], f'{where}.generate.step')
            exit_ = unit(g['exit'], f'{where}.generate.exit')
            labels = g.get('labels') or []
            aliases = {int(k): list(v) for k, v in (g.get('aliases') or {}).items()}
            first = int(g.get('first', 1))
            for k in range(count):
                n = first + k
                pid = g['ids'].replace('{n}', str(n))
                label = str(labels[k]) if k < len(labels) and labels[k] is not None else pid
                at = [start[c] + step[c] * k for c in range(3)]
                pins.append(Pin(pid, label, at, exit_, [str(a) for a in aliases.get(n, [])]))
            continue
        for key in ('id', 'at', 'exit'):
            if key not in entry:
                raise SpecError(f'{where}: missing "{key}"')
        pins.append(Pin(str(entry['id']), str(entry.get('label', entry['id'])), vector(entry['at'], f'{where}.at'),
                        unit(entry['exit'], f'{where}.exit'), [str(a) for a in entry.get('aliases', [])]))
    ids = [p.id for p in pins]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise SpecError(f'pins: duplicate ids {duplicates}')
    return pins


def load_spec(path):
    path = Path(path)
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as error:
        raise SpecError(f'{path}: {error}') from None
    if not isinstance(data, dict):
        raise SpecError(f'{path}: expected a mapping')
    for key in ('id', 'name', 'step'):
        if not data.get(key):
            raise SpecError(f'{path}: missing "{key}"')
    if not ID.match(str(data['id'])):
        raise SpecError(f'id: "{data["id"]}" must be kebab-case (a-z, 0-9, -)')
    step = (path.parent / data['step']).resolve()
    mesh = data.get('mesh') or {}
    simplify = data.get('simplify') or {}
    colours = data.get('colours') or {}
    palette = colours.get('palette') or {}
    for name, value in palette.items():
        if not HEX.match(str(value)):
            raise SpecError(f'colours.palette.{name}: "{value}" is not #rrggbb')

    def colour_ref(value, where):
        if value in palette:
            return palette[value]
        if HEX.match(str(value)):
            return str(value)
        raise SpecError(f'{where}: "{value}" is neither a palette name nor #rrggbb')

    rules = []
    for i, rule in enumerate(colours.get('rules') or []):
        if 'match' not in rule or 'colour' not in rule:
            raise SpecError(f'colours.rules[{i}]: needs "match" and "colour"')
        rules.append(ColourRule(str(rule['match']), colour_ref(rule['colour'], f'colours.rules[{i}].colour'),
                                rule.get('largestOver'), rule.get('largestUnder')))
    default = colour_ref(colours['default'], 'colours.default') if colours.get('default') else None
    pins = expand_pins(data.get('pins'))
    if not pins:
        raise SpecError('pins: at least one pin is needed')
    return Spec(path=path, id=str(data['id']), name=str(data['name']), category=str(data.get('category', 'module')),
                step=step, orientation=vector(data.get('orientation', [0, 0, 0]), 'orientation'),
                mesh_linear=float(mesh.get('linear', 0.25)), mesh_angular=float(mesh.get('angular', 0.7)),
                min_volume=float(simplify.get('minVolume', 0)), merge_by_colour=bool(simplify.get('mergeByColour', False)),
                palette=palette, rules=rules, default_colour=default, pins=pins)
