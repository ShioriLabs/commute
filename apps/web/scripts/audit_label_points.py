#!/usr/bin/env python3
"""
Audits the label tap-targets against the artwork they were extracted from.

Two outputs, because neither alone is enough. Detectors find what they are told
to look for; a contact sheet finds what nobody thought to look for. The nine
glued labels this script now detects survived several rounds of metric-driven
tuning precisely because every metric being watched looked healthy.

Run:
    MAP_PDF="2026-08a Peta Integrasi Jakarta FDTJ Web.pdf" \
        python3 apps/web/scripts/audit_label_points.py [--out DIR]

Writes `cell-RxC.png` per populated grid cell — the artwork at 3x with a 100u
coordinate grid, every label rect drawn, and a leader line to the marker it
names — plus `defects.tsv` and a summary on stdout.
"""

import argparse
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('PyMuPDF is required: pip install pymupdf')

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Pillow is required: pip install pillow')

WEB_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_ROOT.parent.parent
LABELS_PATH = WEB_ROOT / 'app' / 'data' / 'label-points.json'
POINTS_PATH = WEB_ROOT / 'app' / 'data' / 'points.json'

# 800 world units is the knee: at 600 the sweep is 88 cells, at 1000 it is 41
# but each cell renders 4000px square and detail starts to crowd.
CELL = 800.0
GRID_STEP = 100.0
RENDER_SCALE = 3

# A corridor badge appearing MID-TEXT rather than only leading means two labels
# were glued together. Badge COUNT alone is not the signal: 36 of 45 multi-badge
# labels are legitimate multi-corridor names like "10-4 12-19 Walikota Jakarta
# Utara", where every badge leads.
BADGE_RE = re.compile(r'^\d+[-–]\d+$')

AREA_CEILING = 20000.0     # world units^2; median is ~8,300
FAR_FROM_MARKER = 250.0    # world units
MIN_TAPPABLE_AREA = 1200.0  # guards the deliberately-tight boxes


def shape_extent(o):
    """Half-length along the baseline (excluding r) and the radius."""
    length = math.hypot(o['bx'] - o['ax'], o['by'] - o['ay'])
    return length, o['r']


def hit_area(o):
    length, r = shape_extent(o)
    return (length + 2 * r) * 2 * r


def segment_distance(a, b):
    """Closest approach of two segments.

    Overlap MUST be measured this way, minus both radii. Sampling one shape's
    centreline against the other ignores the radii entirely and reported zero
    rotated overlaps while the render plainly showed labels bleeding together.
    """
    def point_seg(px, py, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
        return math.hypot(px - (ax + t * vx), py - (ay + t * vy))
    return min(
        point_seg(a['ax'], a['ay'], b['ax'], b['ay'], b['bx'], b['by']),
        point_seg(a['bx'], a['by'], b['ax'], b['ay'], b['bx'], b['by']),
        point_seg(b['ax'], b['ay'], a['ax'], a['ay'], a['bx'], a['by']),
        point_seg(b['bx'], b['by'], a['ax'], a['ay'], a['bx'], a['by']),
    )


def point_in_shape(px, py, o):
    """Signed distance to the shape, negative inside."""
    vx, vy = o['bx'] - o['ax'], o['by'] - o['ay']
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - o['ax']) * vx + (py - o['ay']) * vy) / L2))
    return math.hypot(px - (o['ax'] + t * vx), py - (o['ay'] + t * vy)) - o['r']


def cell_of(x, y):
    return int(y // CELL), int(x // CELL)


def find_defects(labels, points):
    """Every check, each entry tagged with the cell whose sheet shows it."""
    defects = []

    def add(kind, o, detail):
        cx = (o['ax'] + o['bx']) / 2
        cy = (o['ay'] + o['by']) / 2
        row, col = cell_of(cx, cy)
        defects.append({
            'kind': kind, 'cell': f'{row}x{col}', 'station': o['station'],
            'text': o['text'], 'detail': detail,
        })

    for o in labels:
        tokens = o['text'].split()
        leading = 0
        while leading < len(tokens) and BADGE_RE.match(tokens[leading]):
            leading += 1
        if any(BADGE_RE.match(t) for t in tokens[leading:]):
            add('glued', o, 'corridor badge mid-text')

        area = hit_area(o)
        if area > AREA_CEILING:
            add('oversized', o, f'{area:.0f} u^2')
        if area < MIN_TAPPABLE_AREA:
            add('too-small', o, f'{area:.0f} u^2')

        if o.get('dist', 0) > FAR_FROM_MARKER:
            add('far-from-marker', o, f"{o['dist']:.0f} u")

    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            a, b = labels[i], labels[j]
            # One drawn name serving several operators at an interchange is not
            # an overlap defect; it is one label legitimately claimed twice.
            if a['station'] == b['station'] or a['text'].strip() == b['text'].strip():
                continue
            gap = segment_distance(a, b) - (a['r'] + b['r'])
            if gap < 0:
                add('overlap', a, f"{gap:.1f} u into {b['station']} {b['text'][:28]!r}")

    by_station = defaultdict(list)
    for p in points:
        by_station[p.get('station', p['id'])].append(p)
    for o in labels:
        for station, pts in by_station.items():
            if station == o['station']:
                continue
            for p in pts:
                cx = (p['ax'] + p['bx']) / 2
                cy = (p['ay'] + p['by']) / 2
                if point_in_shape(cx, cy, o) < 0:
                    add('swallows-marker', o, f'contains {station}')
                    break
            else:
                continue
            break

    return defects


def render_cell(page, labels, points, row, col, out_dir):
    x0, y0 = col * CELL, row * CELL
    clip = fitz.Rect(x0, y0, x0 + CELL, y0 + CELL)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), clip=clip)
    base = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples).convert('RGBA')
    overlay = Image.new('RGBA', base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, 'RGBA')

    def to_px(x, y):
        return ((x - x0) * RENDER_SCALE, (y - y0) * RENDER_SCALE)

    step = int(GRID_STEP)
    for gx in range(int(x0), int(x0 + CELL) + 1, step):
        draw.line([to_px(gx, y0), to_px(gx, y0 + CELL)], fill=(0, 120, 255, 60), width=1)
        draw.text((to_px(gx, y0)[0] + 3, 3), str(gx), fill=(0, 90, 200, 255))
    for gy in range(int(y0), int(y0 + CELL) + 1, step):
        draw.line([to_px(x0, gy), to_px(x0 + CELL, gy)], fill=(0, 120, 255, 60), width=1)
        draw.text((3, to_px(x0, gy)[1] + 3), str(gy), fill=(0, 90, 200, 255))

    by_id = {p['id']: p for p in points}
    drawn = 0
    for o in labels:
        length, r = shape_extent(o)
        half_w = length / 2 + r
        cx = (o['ax'] + o['bx']) / 2
        cy = (o['ay'] + o['by']) / 2
        if cx < x0 - half_w or cx > x0 + CELL + half_w:
            continue
        if cy < y0 - r - CELL * 0.05 or cy > y0 + CELL + r + CELL * 0.05:
            continue
        ux, uy = ((o['bx'] - o['ax']) / length, (o['by'] - o['ay']) / length) if length else (1.0, 0.0)
        px, py = -uy, ux
        corners = [
            to_px(cx + ux * half_w * sx + px * r * sy, cy + uy * half_w * sx + py * r * sy)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))
        ]
        colour = (255, 120, 0, 255) if o.get('rot') else (255, 0, 150, 255)
        draw.polygon(corners, outline=colour, fill=(colour[0], colour[1], colour[2], 45))
        marker = by_id.get(o['id'].replace('LBL-', '', 1))
        if marker:
            mx = (marker['ax'] + marker['bx']) / 2
            my = (marker['ay'] + marker['by']) / 2
            draw.line([to_px(cx, cy), to_px(mx, my)], fill=(0, 160, 255, 170), width=2)
            m = to_px(mx, my)
            draw.ellipse([m[0] - 5, m[1] - 5, m[0] + 5, m[1] + 5], fill=(0, 160, 255, 255))
        drawn += 1

    if not drawn:
        return None
    path = out_dir / f'cell-{row}x{col}.png'
    Image.alpha_composite(base, overlay).convert('RGB').save(path)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=None, help='directory for the contact sheet')
    parser.add_argument('--no-render', action='store_true', help='defect list only')
    args = parser.parse_args()

    pdf_env = os.environ.get('MAP_PDF')
    if not pdf_env:
        sys.exit('MAP_PDF is required')
    pdf_path = (REPO_ROOT / pdf_env).resolve()
    if not pdf_path.exists():
        sys.exit(f'no such PDF: {pdf_path}')

    labels = json.loads(LABELS_PATH.read_text())['points']
    points = json.loads(POINTS_PATH.read_text())['points']
    out_dir = Path(args.out) if args.out else REPO_ROOT / 'scratch' / 'label-audit'
    out_dir.mkdir(parents=True, exist_ok=True)

    defects = find_defects(labels, points)
    counts = defaultdict(int)
    for d in defects:
        counts[d['kind']] += 1

    tsv = out_dir / 'defects.tsv'
    with tsv.open('w') as fh:
        fh.write('kind\tcell\tstation\ttext\tdetail\n')
        for d in sorted(defects, key=lambda d: (d['kind'], d['cell'])):
            fh.write(f"{d['kind']}\t{d['cell']}\t{d['station']}\t{d['text']}\t{d['detail']}\n")

    print(f'[audit] {len(labels)} labels, {len(defects)} defects')
    for kind in sorted(counts):
        print(f'[audit]   {kind}: {counts[kind]}')
    print(f'[audit] defect list -> {tsv}')

    if args.no_render:
        return

    doc = fitz.open(pdf_path)
    page = doc[0]
    occupied = sorted({cell_of((o['ax'] + o['bx']) / 2, (o['ay'] + o['by']) / 2) for o in labels})
    written = 0
    for row, col in occupied:
        if render_cell(page, labels, points, row, col, out_dir):
            written += 1
    print(f'[audit] contact sheet: {written} cells -> {out_dir}')


if __name__ == '__main__':
    main()
