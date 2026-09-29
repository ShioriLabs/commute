-- LRT Jakarta S08-S10 (Pramuka, Matraman, Proklamasi) are passed through without
-- calling as of the 17 Sep 2026 timetable (`passThrough` in db/data/topology.ts),
-- so they lose their edges, and are hidden from search since a picker entry
-- could only ever return "no route".
-- Codes are misnomers: LRTJ-KYM is Matraman, LRTJ-MAT is Proklamasi.
--
-- edges.sql is INSERT OR REPLACE only: it adds the Rawamangun <-> Manggarai
-- bridge but cannot remove the old stop-by-stop edges, hence the DELETE here.
--
-- Apply AFTER generating edges.sql: generateEdgesSQL reads coordinates from the
-- live /stations endpoint, which only lists searchable stations, and the
-- Rawamangun -> Manggarai hop is priced over these three stops.
UPDATE stations SET searchable = 0 WHERE id IN ('LRTJ-PKA', 'LRTJ-KYM', 'LRTJ-MAT');
DELETE FROM edges WHERE lineCode = 'S' AND (fromStationId IN ('LRTJ-PKA', 'LRTJ-KYM', 'LRTJ-MAT') OR toStationId IN ('LRTJ-PKA', 'LRTJ-KYM', 'LRTJ-MAT'));
