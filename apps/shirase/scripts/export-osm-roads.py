"""
Road geometry for the bake (scripts/build-jp-roads.mjs), from raw OSM.

Protomaps encodes each z15 tile on its own (its own 4096 grid, its own
simplification), so the same road lands a few tenths of a metre apart in
neighbouring tiles and the baked surface jogged sideways at every tile edge.
Baked from these ways instead, every tile cuts the same road from the same
unquantised line.

Every way the bake can draw (roads, ramps, busways, sidewalks, pedestrian
streets, footbridges and steps) is read with the properties it uses, named as Protomaps names them
(kind_detail, is_link, oneway, is_bridge, is_tunnel, access, name, plus
lanes/width and the service subtype, which Protomaps drops). Ways meeting end
to end with the same properties (lanes and width aside) are joined into one
road, at junctions too when they are the only two alike there, as Protomaps
joins them, so a lane change mid-road is a taper inside one
road rather than a step between two. Written to SQLite: each road once, and
the z15 tiles each one touches.

Needs pyosmium (pip install --target <dir> osmium; run with PYTHONPATH=<dir>).

    python3 scripts/export-osm-roads.py data/osm/jabodetabek.osm.pbf data/osm/roads.sqlite
"""
import json
import math
import os
import re
import sqlite3
import struct
import sys
from collections import defaultdict

import osmium

BOUNDS = (105.9, -6.8, 107.3, -5.85)  # the basemap extract's (W, S, E, N)
ZOOM = 15
# The bake clips each tile's roads 64/4096 of a tile past its edge (CLIP_EDGE).
BUFFER = 64 / 4096

ROAD = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
    'living_street', 'service', 'busway',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}
NO = {'no', 'false', '0'}
# Jembatan penyeberangan orang: a name that says footbridge.
JPO_NAME = re.compile(r'^(JPO|Jembatan Penyeberangan)\b', re.IGNORECASE)


def props_of(tags):
    """The way's properties as the bake reads them, or None when it never draws it."""
    highway = tags.get('highway', '')
    if highway in ROAD:
        kind = highway
    elif highway == 'footway' and tags.get('footway') == 'sidewalk':
        kind = 'sidewalk'
    elif highway == 'pedestrian' and tags.get('area') != 'yes':
        kind = 'pedestrian'
    elif highway in ('footway', 'path', 'cycleway', 'corridor') and (tags.get('bridge', 'no') not in NO or JPO_NAME.match(tags.get('name', ''))):
        # A JPO's deck or a halte skywalk (light and dark's footbridges). A
        # way named JPO is one whatever its tags: JPO Kalibaru's span over
        # Jalan Bakti is mapped as a plain crossing, no bridge tag.
        kind = 'footbridge'
    elif highway == 'steps':
        # A JPO's stairs: OSM tags the flights steps, not bridge.
        kind = 'steps'
    else:
        return None
    props = {'kind_detail': kind}
    if highway.endswith('_link'):
        props['is_link'] = True
    oneway = tags.get('oneway', '')
    if oneway in ('yes', 'true', '1', '-1'):
        props['oneway'] = 'yes'
    elif oneway in NO:
        props['oneway'] = 'no'
    if tags.get('bridge', 'no') not in NO:
        props['is_bridge'] = True
    if tags.get('tunnel', 'no') not in NO:
        props['is_tunnel'] = True
    for key in ('access', 'name', 'service'):
        if key in tags:
            props[key] = tags[key]
    return props


def number(tags, key):
    value = tags.get(key, '').strip().replace(',', '.').removesuffix(' m').strip()
    try:
        return float(value)
    except ValueError:
        return None


def tile_xy(lon, lat):
    n = 2 ** ZOOM
    s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def main(src, out):
    w, s, e, n = BOUNDS
    ways = []  # (props, lanes, width, [node ids], [(lon, lat)])
    for way in osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if not way.is_way():
            continue
        props = props_of(way.tags)
        if props is None:
            continue
        nodes = [(nd.ref, nd.lon, nd.lat) for nd in way.nodes if nd.location.valid()]
        if len(nodes) < 2 or not any(w <= lon <= e and s <= lat <= n for _, lon, lat in nodes):
            continue
        if way.tags.get('oneway') == '-1':
            nodes.reverse()
        ways.append((props, number(way.tags, 'lanes'), number(way.tags, 'width'), [r for r, _, _ in nodes], [(lon, lat) for _, lon, lat in nodes]))
    print(f'{len(ways)} ways read')

    # Join ways end to end where exactly two with the same properties meet.
    key = [json.dumps(p, sort_keys=True) for p, *_ in ways]
    ends = defaultdict(list)
    for i, (_, _, _, refs, _) in enumerate(ways):
        ends[refs[0]].append(i)
        ends[refs[-1]].append(i)
    used = [False] * len(ways)
    chains = []

    # At any node, the two ways with the same properties join, however many
    # other roads meet there: mappers split ways at junctions, and a road
    # that ends at every junction lost its stems' square ends (Latuharhari).
    def partner(node, i):
        same = [j for j in ends[node] if j != i and key[j] == key[i]]
        if len(same) != 1 or used[same[0]]:
            return None
        return same[0]

    for start in range(len(ways)):
        if used[start]:
            continue
        used[start] = True
        refs = list(ways[start][3])
        coords = list(ways[start][4])
        spans = [[0, len(coords) - 1, ways[start][1], ways[start][2]]]
        for forward in (True, False):
            while True:
                node = refs[-1] if forward else refs[0]
                j = partner(node, start)
                if j is None:
                    break
                used[j] = True
                jr, jc = ways[j][3], ways[j][4]
                # A one-way road only joins ways running its way.
                if props_of_oneway(key[start]) and (jr[0] != node if forward else jr[-1] != node):
                    used[j] = False
                    break
                if forward:
                    if jr[0] != node:
                        jr, jc = jr[::-1], jc[::-1]
                    base = len(coords) - 1
                    refs += jr[1:]
                    coords += jc[1:]
                    spans.append([base, len(coords) - 1, ways[j][1], ways[j][2]])
                else:
                    if jr[-1] != node:
                        jr, jc = jr[::-1], jc[::-1]
                    shift = len(jc) - 1
                    refs = jr[:-1] + refs
                    coords = jc[:-1] + coords
                    spans = [[a + shift, b + shift, la, wi] for a, b, la, wi in spans]
                    spans.insert(0, [0, shift, ways[j][1], ways[j][2]])
                if refs[0] == refs[-1]:
                    break
        chains.append((ways[start][0], coords, spans))
    print(f'{len(chains)} roads after joining')

    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.execute('CREATE TABLE roads (id INTEGER PRIMARY KEY, props TEXT, coords BLOB, spans TEXT)')
    db.execute('CREATE TABLE tiles (x INTEGER, y INTEGER, road INTEGER)')
    rows, index = [], set()
    for rid, (props, coords, spans) in enumerate(chains):
        flat = [v for lon, lat in coords for v in (lon, lat)]
        rows.append((rid, json.dumps(props), struct.pack(f'<{len(flat)}d', *flat), json.dumps(spans)))
        pts = [tile_xy(lon, lat) for lon, lat in coords]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            for tx in range(math.floor(min(ax, bx) - BUFFER), math.floor(max(ax, bx) + BUFFER) + 1):
                for ty in range(math.floor(min(ay, by) - BUFFER), math.floor(max(ay, by) + BUFFER) + 1):
                    index.add((tx, ty, rid))
    db.executemany('INSERT INTO roads VALUES (?, ?, ?, ?)', rows)
    db.executemany('INSERT INTO tiles VALUES (?, ?, ?)', sorted(index))
    db.execute('CREATE INDEX tiles_xy ON tiles (x, y)')
    db.commit()
    db.close()
    print(f'{len(chains)} roads, {len(index)} tile entries -> {out}')


def props_of_oneway(k):
    return json.loads(k).get('oneway') == 'yes'


if __name__ == '__main__':
    main(*sys.argv[1:3])
