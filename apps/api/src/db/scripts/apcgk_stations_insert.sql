-- Kalayang Bandara (APCGK) — the Soekarno-Hatta airport people-mover.
--
-- Transcribed from the artwork FDTJ prepared for InJourney Airports (skytrain/,
-- dated 19 Feb 25). There is no public API for this service, so the whole
-- operator is seeded by hand, exactly like LRT Jabodebek.
--
-- Station codes follow the poster's own 01..04 numbering, which is also the
-- running order: Terminal 1 -> Stasiun KA Bandara -> Terminal 2 -> Terminal 3.
--
-- APCGK-SHIA is NOT KCI-BST. SHIA is the skytrain platform, BST is where the KA
-- Bandara train berths; they share a building but sit ~500 m of walking apart
-- and are joined by the transfer at the bottom of this file.
--
-- Apply:
--   wrangler d1 execute commute --local  --file=src/db/scripts/apcgk_stations_insert.sql
--   wrangler d1 execute commute --remote --file=src/db/scripts/apcgk_stations_insert.sql
-- Then apply stations_lat_lng.sql for the coordinates.

INSERT OR IGNORE INTO stations
  (id, name, code, formattedName, region, regionCode, operator, timetableSynced, score, searchable)
VALUES
  ('APCGK-T1', 'Terminal 1', 'T1', 'Terminal 1', 'Jabodetabek', 'CGK', 'APCGK', 0, 0, 1),
  -- The poster's own name for the stop; "SHIA" is the code it prints beside the
  -- KA Bandara interchange roundel.
  ('APCGK-SHIA', 'Stasiun KA Bandara', 'SHIA', 'Stasiun KA Bandara', 'Jabodetabek', 'CGK', 'APCGK', 0, 0, 1),
  ('APCGK-T2', 'Terminal 2', 'T2', 'Terminal 2', 'Jabodetabek', 'CGK', 'APCGK', 0, 0, 1),
  ('APCGK-T3', 'Terminal 3', 'T3', 'Terminal 3', 'Jabodetabek', 'CGK', 'APCGK', 0, 0, 1);

-- Line membership. generateStationCodesSQL only ever emits UPDATEs, so it can
-- backfill stationNumber but never create these rows.
INSERT OR IGNORE INTO stationLines (id, stationId, lineCode, stationNumber)
VALUES
  ('APCGK-T1-KLB', 'APCGK-T1', 'KLB', 'K01'),
  ('APCGK-SHIA-KLB', 'APCGK-SHIA', 'KLB', 'K02'),
  ('APCGK-T2-KLB', 'APCGK-T2', 'KLB', 'K03'),
  ('APCGK-T3-KLB', 'APCGK-T3', 'KLB', 'K04');

-- ── Interchange: skytrain <-> KA Bandara ────────────────────────────────────
--
-- One building, but ~500 m of walking end to end (measured on the ground).
--
-- noTap = 0 despite the shared roof: noTap means no fare gate on EITHER side
-- (migration 0013), and this crossing is gated on both — BST sells Rp35k-85k
-- tickets, the Kalayang is free. Two paid zones, so it stays a tap-out boundary
-- and the rides either side must not merge into one priced segment.
INSERT OR REPLACE INTO transfers
  (id, dataType, fromStationId, toStationId, toStationData, distance, notes, noTap, createdAt, updatedAt)
VALUES
  ('T-APCGK-SHIA-KCI-BST', 'INTERNAL', 'APCGK-SHIA', 'KCI-BST', NULL, 500, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('T-KCI-BST-APCGK-SHIA', 'INTERNAL', 'KCI-BST', 'APCGK-SHIA', NULL, 500, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ── Hub ─────────────────────────────────────────────────────────────────────
--
-- kind = 'integrated' (migration 0014): to a rider this is one place, split
-- across operators only in the data. Nobody needs to be told which member they
-- want — unlike Dukuh Atas, where the grouping itself carries information.
INSERT OR REPLACE INTO hubs
  (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt)
VALUES
  ('HUB-BST', 'bandara-soekarno-hatta', 'Bandara Soekarno-Hatta', 'integrated', NULL, NULL, NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt)
VALUES
  ('HUB-BST:KCI-BST', 'HUB-BST', 'KCI-BST', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('HUB-BST:APCGK-SHIA', 'HUB-BST', 'APCGK-SHIA', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
