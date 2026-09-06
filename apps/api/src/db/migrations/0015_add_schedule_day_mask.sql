-- Migration number: 0015 	 2026-09-06T00:00:00.000Z

-- Which days a departure runs, as the same three-bit mask the generated headway
-- data uses: WD (Mon-Fri) = 4, SAT = 2, SUN = 1. So 7 is every day, 4 is
-- weekdays only, 3 is the weekend, 1 is Sundays only.
--
-- Until now `schedules` held exactly one board per station and could not say
-- which days it applied to. That is what makes MRT Jakarta's feed discard the
-- `weekendsStart`/`weekendsEnd` fields it already fetches (see the standing TODO
-- in operators/mrtj/datum.ts), and what leaves LRT Jabodebek's published weekend
-- timetable with nowhere to live.
--
-- The default is 7 (every day), NOT 4 (weekdays).
--
-- Every row currently stored is the only board we hold for its station, and the
-- rail operators do run every day — so 7 is what the existing data actually
-- asserts. Defaulting to weekdays would silently close rail service at weekends
-- the moment anything filters on this column, which is the opposite of the bug
-- this whole feature set exists to fix. When a real weekend board lands for a
-- station, its weekday rows narrow to 4 and the weekend rows arrive as 3 in the
-- same load.
ALTER TABLE schedules ADD COLUMN dayMask INTEGER NOT NULL DEFAULT 7;

-- Every departure-board query now filters on the day as well, so the day sits
-- between the station and the ordering column. Created BEFORE the old index is
-- dropped: reversing that order leaves the intervening queries table-scanning.
CREATE INDEX IF NOT EXISTS idx_station_daymask_departure
  ON schedules(stationId, dayMask, estimatedDeparture);

DROP INDEX IF EXISTS idx_station_departure;

-- Retire the LRT Jabodebek rows written under the old id grammar.
--
-- Those ids look like `LRTJBDB-SET-BK-1-JTM`; the regenerated files write
-- `LRTJBDB-SET-BK-WD-1-JTM` and scope their DELETE to `...-BK-WD-%-JTM`. The
-- new pattern therefore cannot match the old rows, so without this the next
-- load would leave the previous board sitting beside the new one and every LRT
-- Jabodebek station would report its departures twice.
--
-- Safe to run before the new files are applied: the station is briefly without
-- a board, and `pnpm generate:lrtjbdbtimetable` + applying the 48 committed
-- `lrtjbdb_*_WD_timetable.sql` files restores it. Matching on the id prefix
-- rather than on `stationId` keeps every other operator's rows untouched.
DELETE FROM schedules
WHERE id LIKE 'LRTJBDB-%'
  AND id NOT LIKE 'LRTJBDB-%-WD-%'
  AND id NOT LIKE 'LRTJBDB-%-WE-%';
