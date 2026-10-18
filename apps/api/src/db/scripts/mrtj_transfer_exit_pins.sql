-- MRT Jakarta transfer walks pinned to the exit their existing note names.
--
-- Inferred from `transfers.notes`, nothing else: "Keluar lewat pintu D" on the
-- MRT side is MRTJ-DKA:D, and so on. Only the MRT side is pinned. The KRL and
-- TJ ends have no exit rows yet, so their doors ("pintu B" at Sudirman) stay in
-- the notes until those stations are seeded.
--
-- Pinned in the leaving direction only. The reverse row is left unpinned on
-- purpose: the resolver (utils/transfer-exits.ts) swaps a pinned row for the
-- reverse walk, so SUD -> DKA enters by exit D without a second source of truth.
--
-- Needs 0017 and station_exits_osm_seed.sql. Idempotent. The exit must exist
-- (foreign key), so run the exits seed first.
UPDATE transfers SET fromExitId = 'MRTJ-DKA:D', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-MRTJ-DKA-KCI-SUD' AND fromStationId = 'MRTJ-DKA';
UPDATE transfers SET fromExitId = 'MRTJ-DKA:D', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-MRTJ-DKA-KCI-SUDB' AND fromStationId = 'MRTJ-DKA';
UPDATE transfers SET fromExitId = 'MRTJ-BLM:E', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-MRTJ-BLM-XTJ1' AND fromStationId = 'MRTJ-BLM';

-- Added from the remote notes (these rows come from measured_transfers_2026_10_13.sql
-- and are absent from an older local database, where these UPDATEs match nothing).
UPDATE transfers SET fromExitId = 'MRTJ-LBB:D', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'MRTJ-LBB->TJ-H00122P' AND fromStationId = 'MRTJ-LBB';
UPDATE transfers SET fromExitId = 'MRTJ-IST:D', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'MRTJ-IST->TJ-H00176P' AND fromStationId = 'MRTJ-IST';
UPDATE transfers SET fromExitId = 'MRTJ-SNY:A', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'MRTJ-SNY->TJ-H00023P' AND fromStationId = 'MRTJ-SNY';

-- From the owner's own knowledge of the stations, 2026-10-18 (no note on these rows).
--
-- Bundaran HI: exit A. Exit C used to serve this walk but is closed while the
-- concourse is extended towards the Bundaran HI itself; the work covers C. C
-- stays in stationExits (it is still a real exit); re-pin if it reopens.
--
-- ASEAN: exit A to all three TJ haltes (CSW, ASEAN, Kejaksaan Agung), even
-- though B is the nearest exit by straight line (138 m against 179 m for A).
-- The walk follows the street, not the line, so this overrides the geometry.
UPDATE transfers SET fromExitId = 'MRTJ-BHI:A', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'MRTJ-BHI->TJ-H00022P' AND fromStationId = 'MRTJ-BHI';
UPDATE transfers SET fromExitId = 'MRTJ-SSM:A', notes = 'Jalan menuju Pumpunan Moda CSW via Pintu A', updatedAt = CURRENT_TIMESTAMP
  WHERE id IN ('MRTJ-SSM->TJ-H00041P', 'MRTJ-SSM->TJ-H00265P', 'MRTJ-SSM->TJ-H00266P') AND fromStationId = 'MRTJ-SSM';

-- The way back from the three ASEAN TJ haltes. Note only: the door is not pinned
-- here because the resolver swaps the forward row's exit A for the reverse walk.
UPDATE transfers SET notes = 'Masuk lewat pintu A via Pumpunan Moda CSW', updatedAt = CURRENT_TIMESTAMP
  WHERE id IN ('TJ-H00041P->MRTJ-SSM', 'TJ-H00265P->MRTJ-SSM', 'TJ-H00266P->MRTJ-SSM') AND toStationId = 'MRTJ-SSM';
