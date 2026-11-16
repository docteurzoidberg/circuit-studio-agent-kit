"""A small coloured, named STEP assembly for tests: a board with a 4-pin header and a 3-way screw terminal.

Known facts (mm): board 30 x 20 x 1.6 with its top at z = 1.6; header pins 0.64 square, 2.54 pitch along X,
centred on y = 5, from z = -3 to z = 8.5; terminal screws radius 1.25, 5 mm pitch along X, on y = -5, top at
z = 6.6; one tiny solid (0.3 mm cube).
"""
import cadquery as cq

GREEN, BLACK, GOLD, STEEL = '#1a7a3a', '#141414', '#e4bb5c', '#a4a4aa'
PIN_X = [-3.81, -1.27, 1.27, 3.81]
SCREW_X = [-5.0, 0.0, 5.0]


def colour(hex_value):
    return cq.Color(*(int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5)))


def build():
    board = cq.Workplane().box(30, 20, 1.6, centered=(True, True, False))
    header = cq.Assembly(name='Header')
    header.add(cq.Workplane().box(10.16, 2.54, 2.5, centered=(True, True, False)).translate((0, 5, 1.6)),
               name='Header body', color=colour(BLACK))
    for i, x in enumerate(PIN_X):
        pin = cq.Workplane().box(0.64, 0.64, 11.5, centered=(True, True, False)).translate((x, 5, -3))
        header.add(pin, name=f'Pin {i + 1}', color=colour(GOLD))
    terminal = cq.Assembly(name='Terminal')
    terminal.add(cq.Workplane().box(15, 7, 5, centered=(True, True, False)).translate((0, -5, 1.6)),
                 name='Terminal body', color=colour(GREEN))
    for i, x in enumerate(SCREW_X):
        screw = cq.Workplane().circle(1.25).extrude(1).translate((x, -5, 5.6))
        terminal.add(screw, name=f'Screw {i + 1}', color=colour(STEEL))
    root = cq.Assembly(name='Test board')
    root.add(board, name='PCB', color=colour(GREEN))
    root.add(header)
    root.add(terminal)
    root.add(cq.Workplane().box(0.3, 0.3, 0.3).translate((12, 8, 1.75)), name='Tiny', color=colour(BLACK))
    return root


def write(path):
    build().export(str(path))
    return path


if __name__ == '__main__':
    import sys
    print(write(sys.argv[1]))
