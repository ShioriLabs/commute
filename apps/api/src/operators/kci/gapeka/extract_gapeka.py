"""
Pull every per-train running table out of a GAPEKA PDF (KP DJKA) into JSON.

One-off, for the 1 Dec 2026 edition (KP DJKA 116/2026). The PDF is a text-layer
document: each train is a "KA n (Commuter Line X) Lintas Pelayanan A - B"
caption sitting ABOVE its stop table, and a long table can spill onto the next
page with no caption of its own (it continues the previous caption).

Cell vocabulary (Datang / Berangkat columns):
  HH:MM:SS  a scheduled time
  Ls        langsung, the train does NOT stop; Berangkat carries its pass time
  Berh      berhenti, the train stops; Berangkat is 'Sb' (no printed time)
  -         not applicable (origin has no arrival, terminus no departure)

Usage (PyMuPDF required):
  python3 extract_gapeka.py <gapeka.pdf> <out.json> [first_page last_page]
"""
import json
import re
import sys

import fitz

HEADER = re.compile(r'KA\s*(\d+[A-Z]?)\s*\(([^)]*)\)\s*Lintas\s*Pelayanan\s*([A-Z]+)\s*-\s*([A-Z]+)')
STATION = re.compile(r'\(([A-Z0-9]+)\)\s*$')


def main() -> None:
    pdf, out = sys.argv[1], sys.argv[2]
    doc = fitz.open(pdf)
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    last = int(sys.argv[4]) if len(sys.argv) > 4 else len(doc)

    trips: list[dict] = []
    current = None
    for page_index in range(first, last):
        page = doc[page_index]
        headers = []
        for block in page.get_text('blocks'):
            match = HEADER.search(block[4].replace('\n', ' '))
            if match:
                headers.append((block[1], match.groups()))
        headers.sort()

        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            rows = table.extract()
            if not rows or rows[0][0] != 'No.':
                continue
            above = [h for h in headers if h[0] < table.bbox[1]]
            if above:
                ka, label, origin, dest = above[-1][1]
                current = {
                    'ka': ka,
                    # The PDF spells it "Commuter LineBogor" in places.
                    'label': re.sub(r'\s+', ' ', re.sub(r'Commuter\s*Line\s*', 'Commuter Line ', label)).strip(),
                    'from': origin, 'to': dest, 'page': page_index, 'rows': []
                }
                trips.append(current)
            elif current is None:
                continue
            for row in rows[1:]:
                station = STATION.search(row[1].replace('\n', ' ').strip())
                if not station or not row[0].isdigit():
                    continue
                current['rows'].append([int(row[0]), station.group(1), row[3], row[4]])

    # A range that stops early drops the tail of the last line without a sound
    # (1500 instead of 1513 once cost Cikarang its evening trains), so look past
    # the end for another train caption and refuse to continue if there is one.
    for page_index in range(last, min(last + 8, len(doc))):
        if HEADER.search(doc[page_index].get_text().replace('\n', ' ')):
            sys.exit(f'page range ends at {last} but page {page_index} still has train tables: widen it')

    # A table split gone wrong shows up as a gap in the row numbers.
    broken = [t['ka'] for t in trips if [r[0] for r in t['rows']] != list(range(1, len(t['rows']) + 1))]
    with open(out, 'w') as handle:
        json.dump({'source': pdf, 'trips': trips}, handle)
    print(f'{len(trips)} trips, {sum(len(t["rows"]) for t in trips)} rows, {len(broken)} with non-contiguous rows: {broken[:20]}')


if __name__ == '__main__':
    main()
