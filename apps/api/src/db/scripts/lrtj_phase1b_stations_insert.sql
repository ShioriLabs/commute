-- LRT Jakarta Phase 1B (Velodrome -> Manggarai), from the FDTJ "Peta Integrasi
-- Jakarta" 2026-08 edition and the station initials LRT Jakarta is submitting
-- for GAPEKA (kept deliberately in step with the AFC system).
--
-- These stations are UNDER CONSTRUCTION: searchable = 0 keeps them out of the
-- pickers and off the router, exactly as the dormant TJ feeder services are
-- handled. Flip to 1 when the extension is commissioned.
--
-- The line's existing codes stay untouched here; see the note on
-- LRTJ_STATION_CODES in apps/constants/src/index.ts for why PGD/EQS are not
-- being renamed to FDTJ's KPG/EQT yet.
--
-- Apply LOCAL ONLY while the FDTJ map is embargoed:
--   wrangler d1 execute commute --local --file=src/db/scripts/lrtj_phase1b_stations_insert.sql

INSERT OR IGNORE INTO stations
  (id, name, code, formattedName, region, regionCode, operator, timetableSynced, score, searchable)
VALUES
  ('LRTJ-RWM', 'Stasiun Rawamangun', 'RWM', 'Rawamangun', 'Jabodetabek', 'CGK', 'LRTJ', 0, 0, 0),
  ('LRTJ-PKA', 'Stasiun Pramuka',    'PKA', 'Pramuka',    'Jabodetabek', 'CGK', 'LRTJ', 0, 0, 0),
  -- KYM/MAT keep their ids and codes: the stops are unchanged, only the names
  -- were reshuffled before opening (S09 Kayu Manis -> Matraman, S10 Matraman ->
  -- Proklamasi), and the codes are load-bearing across edges and stationLines.
  -- Realign them with the official initials when FDTJ/Wikipedia publish them.
  ('LRTJ-KYM', 'Stasiun Matraman',   'KYM', 'Matraman',   'Jabodetabek', 'CGK', 'LRTJ', 0, 0, 0),
  ('LRTJ-MAT', 'Stasiun Proklamasi', 'MAT', 'Proklamasi', 'Jabodetabek', 'CGK', 'LRTJ', 0, 0, 0),
  ('LRTJ-MGI', 'Stasiun Manggarai',  'MGI', 'Manggarai',  'Jabodetabek', 'CGK', 'LRTJ', 0, 0, 0);

-- Line membership with the official per-line codes, continuing S01..S06.
INSERT OR IGNORE INTO stationLines (id, stationId, lineCode, stationNumber)
VALUES
  ('LRTJ-RWM-S', 'LRTJ-RWM', 'S', 'S07'),
  ('LRTJ-PKA-S', 'LRTJ-PKA', 'S', 'S08'),
  ('LRTJ-KYM-S', 'LRTJ-KYM', 'S', 'S09'),
  ('LRTJ-MAT-S', 'LRTJ-MAT', 'S', 'S10'),
  ('LRTJ-MGI-S', 'LRTJ-MGI', 'S', 'S11');
