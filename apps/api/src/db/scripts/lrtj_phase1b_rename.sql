-- LRT Jakarta Phase 1B name reshuffle, taken from the platform signage in
-- revenue service (S01..S11): S09 is Matraman and S10 is Proklamasi. Our seed
-- had S09 as Kayu Manis and S10 as Matraman, so both rows shift by one name.
-- Kayu Manis is not on the line at all.
--
-- Station ids AND codes are deliberately left alone. They are load-bearing
-- across stations.id, edges, stationLines and the curated map points, and the
-- stops themselves did not move, so a rename is all that is warranted. That
-- leaves LRTJ-KYM named Matraman and LRTJ-MAT named Proklamasi until the
-- official GAPEKA/AFC initials are published -- see the same standing note on
-- LRTJ_STATION_CODES in apps/constants/src/index.ts for PGD/EQS.
--
-- The seed (lrtj_phase1b_stations_insert.sql) is INSERT OR IGNORE, so it will
-- NOT correct rows that already exist. This file is what updates them.
--
--   wrangler d1 execute commute --local  --file=src/db/scripts/lrtj_phase1b_rename.sql
--   wrangler d1 execute commute --remote --file=src/db/scripts/lrtj_phase1b_rename.sql

UPDATE stations
SET name = 'Stasiun Matraman', formattedName = 'Matraman', updatedAt = CURRENT_TIMESTAMP
WHERE id = 'LRTJ-KYM';

UPDATE stations
SET name = 'Stasiun Proklamasi', formattedName = 'Proklamasi', updatedAt = CURRENT_TIMESTAMP
WHERE id = 'LRTJ-MAT';
