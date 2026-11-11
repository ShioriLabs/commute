-- LRT Jakarta Pramuka (LRTJ-PKA, S08) opened 2026-11-11: trains call there again.
-- Matraman (LRTJ-KYM) and Proklamasi (LRTJ-MAT) stay passed through and
-- unsearchable (entrance stairs unfinished), see lrtj_passthrough.sql.
--
-- Apply AFTER edges.sql, which adds Rawamangun <-> Pramuka <-> Manggarai. It
-- cannot remove the Rawamangun <-> Manggarai bridge it replaces (INSERT OR
-- REPLACE only), hence the DELETE: left in, the router would skip Pramuka.
-- Then lrtj_S_timetable.sql, then deploy with an API_VERSION bump.
UPDATE stations SET searchable = 1 WHERE id = 'LRTJ-PKA';
DELETE FROM edges WHERE lineCode = 'S' AND ((fromStationId = 'LRTJ-RWM' AND toStationId = 'LRTJ-MGI') OR (fromStationId = 'LRTJ-MGI' AND toStationId = 'LRTJ-RWM'));
