-- KRL Sudirman transfer walks pinned to the exit their existing note names.
--
-- Same approach as mrtj_transfer_exit_pins.sql: inferred from `transfers.notes`
-- ("Keluar lewat pintu B"), cross-checked against the exit board transcribed in
-- kci_sud_exits_field.sql. Only the KCI-SUD side is pinned, in the leaving
-- direction; the resolver (utils/transfer-exits.ts) swaps a pinned row for the
-- reverse walk, so DKA -> SUD enters by exit B without a second source of truth.
--
-- Pinned on the owner's word rather than the note: T-KCI-SUD-XTJ3 (note said
-- "pintu bawah") and KCI-SUD->TJ-H00118P (no note) both leave by exit B; their notes
-- are in kci_sud_transfer_notes.sql.
--
-- Left unpinned on purpose: walks that leave from the other station
-- (LRTJBDB-DKA, KCI-SUDB, TJ). They have no exit rows yet, so their doors stay
-- in the notes.
--
-- Needs 0017 and kci_sud_exits_field.sql (the exit must exist: foreign key).
-- Idempotent. A row absent from an older local database simply matches nothing.
UPDATE transfers SET fromExitId = 'KCI-SUD:B', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-KCI-SUDB' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:B', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-MRTJ-DKA' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:C', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-LRTJBDB-DKA' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:A', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-XTJ1' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:A', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-XTJ2' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:B', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-XTJ3' AND fromStationId = 'KCI-SUD';
UPDATE transfers SET fromExitId = 'KCI-SUD:B', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'KCI-SUD->TJ-H00118P' AND fromStationId = 'KCI-SUD';
