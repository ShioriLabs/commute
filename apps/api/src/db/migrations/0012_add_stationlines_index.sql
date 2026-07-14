-- Migration number: 0012 	 2026-07-14T00:00:00.000Z

-- stationLines only had a PK on `id`. Every hot read hits it un-indexed:
-- the correlated lineCode subquery in getTimetableFromStationId, the
-- group_concat station-list joins, and checkIfLineExists. Index stationId
-- (covers the joins/subquery) and (stationId, lineCode) (covers checkIfLineExists
-- and lets the subquery resolve index-only).
CREATE INDEX IF NOT EXISTS idx_stationLines_stationId ON stationLines(stationId);
CREATE INDEX IF NOT EXISTS idx_stationLines_stationId_lineCode ON stationLines(stationId, lineCode);
