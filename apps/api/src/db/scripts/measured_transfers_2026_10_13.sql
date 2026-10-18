-- Transfer walks, surveyed 2026-10-13.
--
-- distance is metres, gate to gate. Rows are written both ways: the router
-- reads transfers directionally, and the reverse walk is the same ground.
--
-- Upsert keyed on `${from}->${to}`, so re-running is safe. Only distance and
-- notes are written; exit pins and noTap on the row are left alone.
-- Apply, then bump API_VERSION (KV fare cache).

-- Sudirman <-> Flyover Kuningan
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-SUD->TJ-H00118P', 'INTERNAL', 'KCI-SUD', 'TJ-H00118P', NULL, 560, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00118P->KCI-SUD', 'INTERNAL', 'TJ-H00118P', 'KCI-SUD', NULL, 560, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- Dukuh Atas LRTJBDB <-> Galunggung
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJBDB-DKA->TJ-H00283P', 'INTERNAL', 'LRTJBDB-DKA', 'TJ-H00283P', NULL, 320, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00283P->LRTJBDB-DKA', 'INTERNAL', 'TJ-H00283P', 'LRTJBDB-DKA', NULL, 320, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- Dukuh Atas LRTJBDB <-> Dukuh Atas TJ, via the JPO towards Galunggung
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJBDB-DKA->TJ-H00047P', 'INTERNAL', 'LRTJBDB-DKA', 'TJ-H00047P', NULL, 470, 'Lewat JPO arah halte Galunggung', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00047P->LRTJBDB-DKA', 'INTERNAL', 'TJ-H00047P', 'LRTJBDB-DKA', NULL, 470, 'Lewat JPO arah halte Galunggung', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- Istora <-> Polda Metro Jaya, via Istora pintu D
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('MRTJ-IST->TJ-H00176P', 'INTERNAL', 'MRTJ-IST', 'TJ-H00176P', NULL, 300, 'Keluar lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00176P->MRTJ-IST', 'INTERNAL', 'TJ-H00176P', 'MRTJ-IST', NULL, 300, 'Masuk lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- Lebak Bulus MRTJ <-> Lebak Bulus TJ, via pintu D
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('MRTJ-LBB->TJ-H00122P', 'INTERNAL', 'MRTJ-LBB', 'TJ-H00122P', NULL, 60, 'Keluar lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00122P->MRTJ-LBB', 'INTERNAL', 'TJ-H00122P', 'MRTJ-LBB', NULL, 60, 'Masuk lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;

-- Senayan Mastercard <-> Bundaran Senayan (the halte surveyed as "Bunsen"), via pintu A
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('MRTJ-SNY->TJ-H00023P', 'INTERNAL', 'MRTJ-SNY', 'TJ-H00023P', NULL, 234, 'Keluar lewat pintu A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
INSERT INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00023P->MRTJ-SNY', 'INTERNAL', 'TJ-H00023P', 'MRTJ-SNY', NULL, 234, 'Masuk lewat pintu A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET distance = excluded.distance, notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP;
