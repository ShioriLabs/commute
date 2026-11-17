"""
Clip an OSM extract to the basemap's bounds: every way with a node inside
them, with all of its nodes, so roads crossing the edge stay whole.

    python3 scripts/clip-osm.py data/osm/java-latest.osm.pbf data/osm/jabodetabek.osm.pbf
"""
import sys

import osmium

BOUNDS = (105.9, -6.8, 107.3, -5.85)  # the basemap extract's (W, S, E, N)


def main(src, out):
    w, s, e, n = BOUNDS
    kept = 0
    with osmium.BackReferenceWriter(out, ref_src=src, overwrite=True) as writer:
        for way in osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not way.is_way():
                continue
            if any(nd.location.valid() and w <= nd.lon <= e and s <= nd.lat <= n for nd in way.nodes):
                writer.add_way(way)
                kept += 1
    print(f'{kept} ways -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
