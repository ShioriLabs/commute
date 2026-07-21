-- Hand-curated noTap transfers: walkways that stay inside one paid zone with
-- no fare gate on either side, so fare-summary must not treat them as a
-- tap-out boundary. See migration 0013_add_transfer_no_tap.

-- Simpang Kuningan <-> Underpass Kuningan: busway underpass already modeled
-- as an ordinary transfer (304m); just needs the flag flipped.
UPDATE transfers SET noTap = 1, updatedAt = CURRENT_TIMESTAMP WHERE id IN ('TJ-H00113P->TJ-H00115P', 'TJ-H00115P->TJ-H00113P');

-- Dukuh Atas <-> Galunggung: TJ-TJ skybridge, not previously modeled at all
-- (each halte only connected separately to KCI-SUD, 310m each). Measured 140m.
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, noTap, createdAt, updatedAt) VALUES ('TJ-H00047P->TJ-H00283P', 'INTERNAL', 'TJ-H00047P', 'TJ-H00283P', NULL, 140, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, noTap, createdAt, updatedAt) VALUES ('TJ-H00283P->TJ-H00047P', 'INTERNAL', 'TJ-H00283P', 'TJ-H00047P', NULL, 140, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
