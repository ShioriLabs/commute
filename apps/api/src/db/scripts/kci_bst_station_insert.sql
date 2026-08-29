-- Bandara Soekarno-Hatta (BST), the airport terminus of Lin Soekarno-Hatta (A).
--
-- Hand-written because the station never arrives from upstream: syncStations
-- reads https://kci.id/api/krl/stations and skips every row with fg_enable = 0,
-- and BST is not in that feed. Re-running POST /sync/KCI will therefore never
-- create it, however many times it is called.
--
-- Safe across resyncs: StationRepository.insertMany upserts on id and touches
-- only name, formattedName, region, operator and updatedAt -- never searchable,
-- score, code, regionCode or the coordinates -- and nothing prunes stations that
-- are absent from the feed. formattedName already matches
-- WELL_KNOWN_STATION_NAMES['BST'], so if the feed ever does start returning BST
-- the upsert is a no-op on that column too.
--
-- The station is open and served, so unlike the LRT Jakarta Phase 1B stops it
-- goes in searchable = 1 straight away. timetableSynced = 0 until the board is
-- first fetched: POST /sync/KCI/BST/timetable flips it (insertTimetable sets it).
--
-- Line A stays out of the router (see ROUTABLE_LINE_CODES in
-- db/repositories/edges.ts) -- this makes BST a real, browsable station, it does
-- not make the premium-fare airport train routable.
--
-- Apply:
--   wrangler d1 execute commute --local  --file=src/db/scripts/kci_bst_station_insert.sql
--   wrangler d1 execute commute --remote --file=src/db/scripts/kci_bst_station_insert.sql
-- Then apply stations_lat_lng.sql for the coordinates.

INSERT OR IGNORE INTO stations
  (id, name, code, formattedName, region, regionCode, operator, timetableSynced, score, searchable)
VALUES
  ('KCI-BST', 'BANDARA SOEKARNO HATTA', 'BST', 'Bandara Soekarno-Hatta', 'Jabodetabek', 'CGK', 'KCI', 0, 0, 1);

-- Line membership, continuing A01..A05. generateStationCodesSQL only ever emits
-- UPDATEs, so it can backfill stationNumber but never create this row.
INSERT OR IGNORE INTO stationLines (id, stationId, lineCode, stationNumber)
VALUES
  ('KCI-BST-A', 'KCI-BST', 'A', 'A06');
