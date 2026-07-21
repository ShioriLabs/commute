-- Migration number: 0013 	 2026-07-21T00:00:00.000Z

-- Marks a transfer as staying inside one paid zone (no fare gate on either
-- side), e.g. a busway underpass connecting two halte. Default 0 preserves
-- today's behavior for every existing row (an ordinary transfer is a tap-out
-- boundary for fare purposes).
ALTER TABLE transfers ADD COLUMN noTap BOOLEAN NOT NULL DEFAULT 0;
