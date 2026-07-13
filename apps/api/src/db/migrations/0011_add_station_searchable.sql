-- Migration number: 0011 	 2026-07-13T00:00:00.000Z

-- Explicit visibility flag for station search. Default 1 keeps every existing
-- station searchable. Topology-only stations (e.g. TransJakarta roadside `B…P`
-- stops that exist for edges/transfers/routing) are seeded with searchable = 0
-- so they never enter the search index.
ALTER TABLE stations ADD COLUMN searchable BOOLEAN NOT NULL DEFAULT 1;
