-- Measured transfer walks, surveyed 2026-08-08.
--
-- distance is metres, gate to gate, matching the convention the existing rows
-- use. A 0 in this table means UNMEASURED, never "no walk" — so every row here
-- replaces a 0 with a real figure, and the two Grogol pairs are deliberately
-- absent rather than zeroed (see the note at the foot of this file).
--
-- Rows are written both ways: the router reads transfers directionally, and
-- the reverse walk is the same ground.
--
-- INSERT OR REPLACE keyed on `${from}->${to}`, so re-running is safe and a
-- resurvey overwrites rather than duplicates.

-- ---------------------------------------------------------------------------
-- Klender — two separate haltes, not one.
--
-- The DB only had KCI-KLD <-> TJ-H00226P (Stasiun Klender). TJ-H00054P
-- (Klender) is a second halte at a different distance and had no row at all,
-- so this adds the link as well as measuring it.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-KLD->TJ-H00226P', 'INTERNAL', 'KCI-KLD', 'TJ-H00226P', NULL, 200, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00226P->KCI-KLD', 'INTERNAL', 'TJ-H00226P', 'KCI-KLD', NULL, 200, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-KLD->TJ-H00054P', 'INTERNAL', 'KCI-KLD', 'TJ-H00054P', NULL, 320, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00054P->KCI-KLD', 'INTERNAL', 'TJ-H00054P', 'KCI-KLD', NULL, 320, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- Buaran — a link the DB did not have at all.
--
-- KCI-BUA had zero transfer rows, so this is a new interchange rather than a
-- measurement: 110 m to Simpang Buaran.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-BUA->TJ-H00055P', 'INTERNAL', 'KCI-BUA', 'TJ-H00055P', NULL, 110, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00055P->KCI-BUA', 'INTERNAL', 'TJ-H00055P', 'KCI-BUA', NULL, 110, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- Singles
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-TKO->TJ-H00235P', 'INTERNAL', 'KCI-TKO', 'TJ-H00235P', NULL, 340, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00235P->KCI-TKO', 'INTERNAL', 'TJ-H00235P', 'KCI-TKO', NULL, 340, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-TPK->TJ-H00240P', 'INTERNAL', 'KCI-TPK', 'TJ-H00240P', NULL, 110, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00240P->KCI-TPK', 'INTERNAL', 'TJ-H00240P', 'KCI-TPK', NULL, 110, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJ-PUM->TJ-H00187P', 'INTERNAL', 'LRTJ-PUM', 'TJ-H00187P', NULL, 290, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00187P->LRTJ-PUM', 'INTERNAL', 'TJ-H00187P', 'LRTJ-PUM', NULL, 290, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Velodrome <-> Pemuda Rawamangun: 80 m on the uncovered route.
--
-- A covered walkway also connects these at 280 m. The shorter, uncovered walk
-- is recorded because the covered bridge is expected to be dismantled — and
-- because the schema holds one distance per pair, so the figure has to be the
-- one that will still be true. Revisit if the walkway survives and shelter
-- ever becomes a routing axis.
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('LRTJ-VEL->TJ-H00161P', 'INTERNAL', 'LRTJ-VEL', 'TJ-H00161P', NULL, 80, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00161P->LRTJ-VEL', 'INTERNAL', 'TJ-H00161P', 'LRTJ-VEL', NULL, 80, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- Jakarta Kota
--
-- Three pairs around one interchange, each via a different door, so each
-- carries the direction that makes its figure reproducible.
--
-- Kota <-> Mangga Dua Raya is the long one: tap out at Kota, walk the full
-- length of the old colonial concourse from pintu B to pintu C, then along the
-- sidewalk to the halte stairs. A rider genuinely leaves the paid zone at the
-- start, so noTap stays 0 — noTap is for walks that never leave one paid zone,
-- which fare-summary then declines to treat as a tap-out boundary, and that is
-- the opposite of what happens here.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-JAKK->TJ-H00275P', 'INTERNAL', 'KCI-JAKK', 'TJ-H00275P', NULL, 50, 'Keluar lewat pintu B', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00275P->KCI-JAKK', 'INTERNAL', 'TJ-H00275P', 'KCI-JAKK', NULL, 50, 'Masuk lewat pintu B', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('KCI-JAKK->TJ-H00140P', 'INTERNAL', 'KCI-JAKK', 'TJ-H00140P', NULL, 160, 'Keluar lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00140P->KCI-JAKK', 'INTERNAL', 'TJ-H00140P', 'KCI-JAKK', NULL, 160, 'Masuk lewat pintu D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00275P->TJ-H00140P', 'INTERNAL', 'TJ-H00275P', 'TJ-H00140P', NULL, 530, 'Tap out di Kota, lalu jalan menyusuri selasar Stasiun Jakarta Kota dari pintu B ke pintu C, terus lewat trotoar sampai tangga naik halte Mangga Dua Raya', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt) VALUES ('TJ-H00140P->TJ-H00275P', 'INTERNAL', 'TJ-H00140P', 'TJ-H00275P', NULL, 530, 'Turun dari halte Mangga Dua Raya, lalu jalan di trotoar sampai pintu C Stasiun Jakarta Kota, terus menyusuri selasarnya sampai pintu B', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- STILL UNMEASURED — Grogol (2 pairs, 4 rows)
--
--   KCI-GGL <-> TJ-H00138S (Kali Grogol Arah Utara)
--   KCI-GGL <-> TJ-H00197S (Kali Grogol Arah Selatan)
--   TJ-H00138S <-> TJ-H00197S
--
-- Not surveyable as of 2026-08-08: the halte is demolished for flyover works,
-- so any figure would describe a walk that does not currently exist. Left at 0
-- deliberately — 0 reads as "unmeasured" everywhere in this codebase, and
-- writing a guess would silently convert an honest gap into wrong data.
-- Resurvey once the halte reopens.
-- ---------------------------------------------------------------------------
