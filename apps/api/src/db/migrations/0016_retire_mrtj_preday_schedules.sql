-- Migration number: 0016 	 2026-09-06T00:00:00.000Z

-- Retire the MRT Jakarta rows written before the day mask existed.
--
-- 0015 did this for LRT Jabodebek and stopped there, because that operator's id
-- grammar changed (`LRTJBDB-SET-BK-1-JTM` -> `...-BK-WD-1-JTM`) and the stale
-- rows were therefore unreachable by the new load. MRT Jakarta has the opposite
-- problem, which is why it needs its own statement rather than none.
--
-- Its weekday ids are UNCHANGED across the change: a weekday departure is still
-- `MRTJ-BHI-05:06:30-SOUTHBOUND`, and only the weekend board took the extra
-- `-WE-` segment (see the id construction in operators/mrtj/datum.ts). So the
-- pre-day rows collide with the weekday rows on the primary key rather than
-- sitting harmlessly beside them.
--
-- `insertTimetable` cannot clear them on its own. It scopes its DELETE to the
-- dayMask it is loading (`stationId = ? AND dayMask = ?`), which is what lets
-- the two boards own their rows independently — but the stale rows carry the
-- 0015 default of 7, so a weekday load looking for 4 never touches them and the
-- batch dies on `UNIQUE constraint failed: schedules.id`. That is a hard sync
-- failure, not a duplicate board: D1 batches are transactional, so the whole
-- load rolls back and the station keeps its stale board forever.
--
-- Scoped to dayMask = 7 rather than to the whole operator so it is idempotent
-- and cannot touch rows a real day-aware sync has already written.
DELETE FROM schedules
WHERE stationId LIKE 'MRTJ-%'
  AND dayMask = 7;
