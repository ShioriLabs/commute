-- Measured transfer walks, 2026-09-29.
--
-- Same conventions as measured_transfers_2026_08_08.sql: metres gate to gate,
-- both directions, INSERT OR REPLACE keyed on `${from}->${to}` so a resurvey
-- overwrites.

-- ---------------------------------------------------------------------------
-- Manggarai: LRT Jakarta <-> KRL. A link the DB did not have at all, so the
-- router could not interchange off LRT Jakarta at its southern terminus.
--
-- 530 m is the PROVISIONAL street-level walk, measured on Google Maps by
-- tracing the roadside route. A skybridge between the two is under
-- construction; resurvey when it opens, it should come out shorter.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJ-MGI->KCI-MRI', 'INTERNAL', 'LRTJ-MGI', 'KCI-MRI', NULL, 530, 'Sementara jalan kaki lewat trotoar sampai skybridge selesai dibangun', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-MRI->LRTJ-MGI', 'INTERNAL', 'KCI-MRI', 'LRTJ-MGI', NULL, 530, 'Sementara jalan kaki lewat trotoar sampai skybridge selesai dibangun', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
