-- Migration number: 0018 	 2026-10-21T00:00:00.000Z

-- What the exit's signage lists, in the order the board prints it: a JSON array
-- of { "text": "Jl. Kendal", "kind": "RAIL" | "BUS" }, `kind` only on entries the
-- board marks with a rail or bus icon. NULL until someone transcribes the board.
-- `name` stays as the one-line fallback. Arrows are not stored: they depend on
-- where the sign stands, not on the exit.
ALTER TABLE stationExits ADD COLUMN signs TEXT NULL;
