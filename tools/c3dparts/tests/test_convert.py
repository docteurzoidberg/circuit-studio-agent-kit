"""Golden test of `convert` on the generated fixture.

Run from tools/: ../.venv-cad/bin/python -m unittest discover -s c3dparts/tests -t .
"""
import base64
import json
import tempfile
import unittest
from pathlib import Path

from c3dparts.__main__ import main
from c3dparts.spec import SpecError, load_spec
from c3dparts.tests import fixture

SPEC = """
id: test-board
name: Test board
step: test-board.step
orientation: [0, 0, 90]
mesh: { linear: 0.2, angular: 0.5 }
simplify: { minVolume: 0.1, mergeByColour: true }
pins:
  - generate:
      ids: "H{n}"
      count: 4
      start: [-3.81, 5, 8.5]
      step: [2.54, 0, 0]
      exit: [0, 0, 1]
      labels: [VCC, GND, SDA]
      aliases: { 4: [SCL0] }
  - { id: T1, label: IN, at: [-5, -5, 6.6], exit: [0, -1, 0] }
"""


class ConvertFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        folder = Path(cls.tmp.name)
        fixture.write(folder / 'test-board.step')
        (folder / 'part.yaml').write_text(SPEC)
        cls.code = main(['convert', str(folder / 'part.yaml')])
        cls.component = json.loads((folder / 'test-board.c3dcomponent').read_text())
        cls.part = cls.component['part']
        cls.folder = folder

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_outputs(self):
        self.assertEqual(self.code, 0)
        self.assertEqual((self.component['format'], self.component['version']), ('c3d-component', 1))
        self.assertTrue((self.folder / 'test-board.png').stat().st_size > 10_000)
        self.assertEqual(base64.b64decode(self.part['asset'])[:4], b'glTF')

    def test_dimensions_after_rotation(self):
        self.assertEqual(self.part['dimensions'], [20.0, 30.0, 11.5])
        self.assertEqual(self.part['geometry']['modelCenter'], [0.0, 0.0, 2.75])

    def test_merged_colours(self):
        # The tiny black solid is dropped; green, black (header body), gold and steel remain, one body each.
        self.assertEqual(self.part['geometry']['materialCount'], 4)

    def test_pins(self):
        pins = {p['id']: p for p in self.part['pins']}
        self.assertEqual(list(pins), ['H1', 'H2', 'H3', 'H4', 'T1'])
        self.assertEqual([pins[f'H{n}']['label'] for n in range(1, 5)], ['VCC', 'GND', 'SDA', 'H4'])
        self.assertEqual(pins['H4']['aliases'], ['SCL0'])
        # (-3.81, 5, 8.5) minus centre (0, 0, 2.75), rotated 90° around Z: (-5, -3.81, 5.75).
        self.assertEqual(pins['H1']['localPosition'], [-5.0, -3.81, 5.75])
        self.assertEqual(pins['T1']['exitDirection'], [1.0, 0.0, 0.0])
        self.assertEqual(pins['T1']['side'], 'right')


class SpecErrors(unittest.TestCase):
    def write(self, text):
        tmp = tempfile.NamedTemporaryFile('w', suffix='.yaml', delete=False)
        tmp.write(text)
        tmp.close()
        self.addCleanup(Path(tmp.name).unlink)
        return tmp.name

    def test_bad_id(self):
        with self.assertRaisesRegex(SpecError, 'kebab-case'):
            load_spec(self.write('id: Test Board\nname: x\nstep: a.step\npins: [{id: A, at: [0,0,0], exit: [0,0,1]}]'))

    def test_duplicate_pins(self):
        with self.assertRaisesRegex(SpecError, 'duplicate'):
            load_spec(self.write('id: t\nname: x\nstep: a.step\npins:\n'
                                 '  - {id: A, at: [0,0,0], exit: [0,0,1]}\n  - {id: A, at: [1,0,0], exit: [0,0,1]}'))

    def test_unknown_colour(self):
        with self.assertRaisesRegex(SpecError, 'palette'):
            load_spec(self.write('id: t\nname: x\nstep: a.step\ncolours: {default: teal}\n'
                                 'pins: [{id: A, at: [0,0,0], exit: [0,0,1]}]'))


if __name__ == '__main__':
    unittest.main()
