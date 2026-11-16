"""Preview PNG of a converted part: top and front orthographic views in the part frame, pins labelled.

Drawn with matplotlib from a coarse tessellation, without a GPU: enough to check pin positions and orientation.
The faithful render comes from Circuit Studio itself.
"""
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

from .convert import rotate  # noqa: E402

VIEWS = (('Top (X right, Y up)', 0, 1), ('Front (X right, Z up)', 0, 2))
MAX_TRIANGLES = 200_000


def part_frame_triangles(coloured, centre, euler, tolerance):
    """Triangles of every kept solid, in the centred, rotated part frame, with their colour."""
    out = []
    for solid, colour in coloured:
        vertices, faces = solid.shape.tessellate(tolerance, 0.5)
        pts = [rotate([v.x - centre[0], v.y - centre[1], v.z - centre[2]], euler) for v in vertices]
        out.extend(([pts[a], pts[b], pts[c]], colour) for a, b, c in faces)
    return out


def write_preview(part, coloured, centre, euler, out, title=None):
    size = max(part['dimensions'])
    tolerance = max(0.05, size / 150)
    triangles = part_frame_triangles(coloured, centre, euler, tolerance)
    if len(triangles) > MAX_TRIANGLES:
        triangles = triangles[:: len(triangles) // MAX_TRIANGLES + 1]
    fig, axes = plt.subplots(1, 2, figsize=(14, 7), dpi=110)
    for ax, (name, u, v) in zip(axes, VIEWS):
        depth = 3 - u - v  # draw far triangles first
        ordered = sorted(triangles, key=lambda t: sum(p[depth] for p in t[0]))
        polys = [[(p[u], p[v]) for p in tri] for tri, _ in ordered]
        ax.add_collection(PolyCollection(polys, facecolors=[c for _, c in ordered], edgecolors='none', alpha=0.9))
        for pin in part['pins']:
            p, d = pin['localPosition'], pin['exitDirection']
            ax.plot(p[u], p[v], 'o', color='#e0245e', markersize=4, zorder=5)
            ax.annotate('', xy=(p[u] + d[u] * size * 0.06, p[v] + d[v] * size * 0.06), xytext=(p[u], p[v]),
                        arrowprops={'arrowstyle': '->', 'color': '#e0245e', 'lw': 0.8}, zorder=5)
            ax.text(p[u] + d[u] * size * 0.07, p[v] + d[v] * size * 0.07, pin['label'], fontsize=6, color='#9b1040', zorder=6,
                    ha='left' if d[u] >= 0 else 'right', va='center',
                    bbox={'boxstyle': 'square,pad=0.1', 'facecolor': 'white', 'edgecolor': 'none', 'alpha': 0.75})
        half = size / 2 * 1.15
        ax.set_xlim(-half, half)
        ax.set_ylim(-half, half)
        ax.set_aspect('equal')
        ax.set_title(name)
        ax.grid(True, linewidth=0.3, alpha=0.5)
    fig.suptitle(title or f"{part['name']} — {part['dimensions'][0]} x {part['dimensions'][1]} x "
                          f"{part['dimensions'][2]} mm, {len(part['pins'])} pins")
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(out)
    plt.close(fig)
