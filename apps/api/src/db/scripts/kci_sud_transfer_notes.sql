-- Notes for two KRL Sudirman walks, now that both leave by exit B
-- (see kci_sud_transfer_exit_pins.sql).
--
-- T-KCI-SUD-XTJ3 (Transport Hub Dukuh Atas): "pintu bawah" is not a signed exit,
-- so only that phrase is replaced; the directions after it stay as they were.
-- KCI-SUD->TJ-H00118P (Flyover Kuningan) had no note. The new one names the exit
-- and the destination and nothing else: no turns or landmarks, since none were
-- walked or recorded. Replace it when someone walks it.
--
-- Idempotent: the first matches only while the old phrase is there, the second
-- only while the note is empty.
UPDATE transfers SET notes = REPLACE(notes, 'pintu bawah', 'pintu B'), updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'T-KCI-SUD-XTJ3' AND notes LIKE '%pintu bawah%';
UPDATE transfers SET notes = 'Keluar lewat pintu B, lalu jalan sekitar 560 m ke halte Flyover Kuningan', updatedAt = CURRENT_TIMESTAMP
  WHERE id = 'KCI-SUD->TJ-H00118P' AND notes IS NULL;
