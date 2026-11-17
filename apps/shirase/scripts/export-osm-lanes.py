"""
Lane data for the road bake (scripts/build-jp-roads.mjs), from raw OSM.

Protomaps' tiles drop `lanes` and `width`, so they come from an OSM extract
(Geofabrik's Java extract, or the Jabodetabek clip of it in data/osm):
every main road (motorway..tertiary and their ramps) tagged with `lanes`,
with its `width`, `lanes:forward`/`backward` and geometry, inside the
basemap's bounds, written as JSON the bake matches to its tile roads.

Residential and smaller streets are left on their class's cross-section:
few are tagged (~13%) and 3.25 m lanes would make them too wide.

Needs pyosmium (not a Node package): pip install --target <dir> osmium,
then run with PYTHONPATH=<dir>.

    python3 scripts/export-osm-lanes.py data/osm/jabodetabek.osm.pbf data/osm/lanes.json
"""
import json
import sys

import osmium

BOUNDS = (105.9, -6.8, 107.3, -5.85)  # the basemap extract's (W, S, E, N)
CLASSES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary'}


def number(tags, key):
    value = tags.get(key, '').strip().replace(',', '.').removesuffix(' m').strip()
    try:
        return float(value)
    except ValueError:
        return None


def main(src, out):
    w, s, e, n = BOUNDS
    rows = []
    for way in osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if not way.is_way():
            continue
        highway = way.tags.get('highway', '')
        if highway.removesuffix('_link') not in CLASSES or 'lanes' not in way.tags:
            continue
        coords = [[round(nd.lon, 7), round(nd.lat, 7)] for nd in way.nodes if nd.location.valid()]
        if len(coords) < 2 or not any(w <= lon <= e and s <= lat <= n for lon, lat in coords):
            continue
        lanes = number(way.tags, 'lanes')
        if not lanes:
            continue
        rows.append({
            'id': way.id,
            'highway': highway,
            'lanes': lanes,
            'fwd': number(way.tags, 'lanes:forward'),
            'bwd': number(way.tags, 'lanes:backward'),
            'width': number(way.tags, 'width'),
            'coords': coords,
        })
    with open(out, 'w') as f:
        json.dump(rows, f, separators=(',', ':'))
    print(f'{len(rows)} ways with lanes -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
