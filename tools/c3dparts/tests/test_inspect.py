"""Golden test of `inspect` on the generated fixture.

Run from tools/: ../.venv-cad/bin/python -m unittest discover -s c3dparts/tests -t .
"""
import tempfile
import unittest
from pathlib import Path

from c3dparts.inspect_step import inspect
from c3dparts.step_io import StepReadError, read_step
from c3dparts.tests import fixture


class InspectFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        step = fixture.write(Path(cls.tmp.name) / 'test-board.step')
        cls.model = read_step(step)
        cls.facts = inspect(cls.model)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_bounds(self):
        b = self.facts['bounds']
        self.assertEqual(b['size'][:2], [30.0, 20.0])
        self.assertAlmostEqual(b['min'][2], -3.0, places=3)
        self.assertAlmostEqual(b['max'][2], 8.5, places=3)

    def test_solids_and_small_volumes(self):
        self.assertEqual(self.facts['solids'], 1 + 1 + 4 + 1 + 3 + 1)
        self.assertEqual(self.facts['volumes']['smallestSolidsBelow']['<0.1'], 1)

    def test_colours_and_names(self):
        colours = self.facts['colours']['bySolid']
        for hex_value in (fixture.GREEN, fixture.BLACK, fixture.GOLD, fixture.STEEL):
            self.assertIn(hex_value, colours)
        self.assertEqual(colours[fixture.GOLD], 4)
        paths = {t['path'] for t in self.facts['tree']}
        self.assertIn('Header', paths)
        self.assertIn('Terminal / Screw 1', paths)

    def test_header_row(self):
        rows = [w for w in self.facts['contacts']['rows'] if 'post' in w['kinds']]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['count'], 4)
        self.assertEqual(row['axis'], 'z')
        self.assertAlmostEqual(row['step'][0], 2.54, places=3)
        self.assertEqual(row['start'], [fixture.PIN_X[0], 5.0, 8.5])

    def test_terminal_row(self):
        rows = [w for w in self.facts['contacts']['rows'] if 'cylinder' in w['kinds']]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['count'], row['axis'], row['size']), (3, 'z', 2.5))
        self.assertAlmostEqual(row['step'][0], 5.0, places=3)
        self.assertEqual(row['start'], [fixture.SCREW_X[0], -5.0, 6.6])

    def test_complexity(self):
        self.assertEqual(self.facts['complexity']['verdict'], 'simple')
        self.assertEqual(self.facts['complexity']['reasons'], [])

    def test_unreadable_file(self):
        with self.assertRaises(StepReadError):
            read_step(Path(self.tmp.name) / 'missing.step')


if __name__ == '__main__':
    unittest.main()
