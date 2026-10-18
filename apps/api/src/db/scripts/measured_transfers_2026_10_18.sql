-- Measured transfer walk, 2026-10-18.
--
-- Same conventions as measured_transfers_2026_08_08.sql: metres, gate to gate,
-- both directions, upserted on `${from}->${to}` so a resurvey overwrites distance
-- and notes and leaves exit pins alone.
--
-- Bendungan Hilir MRT <-> Bendungan Hilir TJ (Koridor 1). A link the DB did not
-- have, so the router could not interchange here at all.
--
-- Surveyed from the TJ halte's JPO entrance, in front of Atma Jaya at the Jl.
-- Garnisun junction, to MRT exit C: 430 m entrance to entrance. 500 m is the
-- agreed gate to gate figure, which adds the stretch inside the station from
-- exit C to the fare gates and the halte's own gate.
--
-- The exit is pinned on the leaving row at insert time (fromExitId) and left out
-- of the UPDATE below, so a later re-pin is not undone by a re-run. The reverse
-- walk reads the same door through the resolver's swap rule.
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, fromExitId, createdAt, updatedAt) VALUES ('MRTJ-BNH->TJ-H00010P', 'INTERNAL', 'MRTJ-BNH', 'TJ-H00010P', NULL, 500, 'Keluar lewat pintu C', 'MRTJ-BNH:C', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00010P->MRTJ-BNH', 'INTERNAL', 'TJ-H00010P', 'MRTJ-BNH', NULL, 500, 'Masuk lewat pintu C', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Second batch, same day. Gate to gate unless stated. No rail exit is pinned:
-- none of these walks was surveyed from a named door.
--
-- LRT Jakarta Rawamangun <-> TJ Rawamangun 380 m, and <-> TJ Kayu Jati 100 m.
-- KRL Matraman <-> TJ Matraman Baru 180 m.
-- ASEAN MRT <-> TJ Masjid Agung 240 m.
-- ---------------------------------------------------------------------------
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJ-RWM->TJ-H00254P', 'INTERNAL', 'LRTJ-RWM', 'TJ-H00254P', NULL, 380, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00254P->LRTJ-RWM', 'INTERNAL', 'TJ-H00254P', 'LRTJ-RWM', NULL, 380, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJ-RWM->TJ-H00230P', 'INTERNAL', 'LRTJ-RWM', 'TJ-H00230P', NULL, 100, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00230P->LRTJ-RWM', 'INTERNAL', 'TJ-H00230P', 'LRTJ-RWM', NULL, 100, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-MTR->TJ-H00104P', 'INTERNAL', 'KCI-MTR', 'TJ-H00104P', NULL, 180, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00104P->KCI-MTR', 'INTERNAL', 'TJ-H00104P', 'KCI-MTR', NULL, 180, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('MRTJ-SSM->TJ-H00127P', 'INTERNAL', 'MRTJ-SSM', 'TJ-H00127P', NULL, 240, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00127P->MRTJ-SSM', 'INTERNAL', 'TJ-H00127P', 'MRTJ-SSM', NULL, 240, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- KRL Juanda <-> TJ Pecenongan, ASYMMETRIC on purpose.
--
-- Juanda -> Pecenongan is 400 m, gate to the halte's door. Pecenongan -> Juanda
-- is 580 m, door to gate: boarding Juanda from the halte side means being routed
-- through the retail passage first (the usual operator detour that makes riders
-- walk past the shops to reach the gates). The two rows are directional, so each
-- way carries its own distance.
-- ---------------------------------------------------------------------------
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-JUA->TJ-H00155P', 'INTERNAL', 'KCI-JUA', 'TJ-H00155P', NULL, 400, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00155P->KCI-JUA', 'INTERNAL', 'TJ-H00155P', 'KCI-JUA', NULL, 580, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
