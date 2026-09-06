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
