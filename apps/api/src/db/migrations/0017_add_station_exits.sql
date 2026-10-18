-- Migration number: 0017 	 2026-10-18T00:00:00.000Z

-- A station's exits/gates, owned by the station and independent of POIs. Ships
-- empty and is backfilled station by station, so nothing reads it as required.
-- See docs/points-of-interest.md ("Exits: which door to use").
CREATE TABLE IF NOT EXISTS stationExits (
  id        VARCHAR(64) PRIMARY KEY NOT NULL UNIQUE,  -- `${stationId}:${ref}`, e.g. 'MRTJ-IST:B'
  stationId VARCHAR(48) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ref       VARCHAR(32) NOT NULL,                     -- as signed on site ('A', 'Utara'), not normalised
  name      VARCHAR(128) NULL,                        -- street/landmark the exit opens onto
  latitude  REAL        NULL,                         -- the exit's own coords, NOT the station centroid
  longitude REAL        NULL,
  source    VARCHAR(16) NOT NULL,                     -- 'FIELD' | 'OPERATOR' | 'OSM'; OSM rows stay separable (ODbL)
  createdAt TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (stationId, ref)
);

CREATE INDEX IF NOT EXISTS idx_stationExits_stationId ON stationExits (stationId);

-- Pins a transfer walk to the exit it leaves by (fromExitId, an exit of
-- fromStationId) and the exit it enters by (toExitId, an exit of toStationId).
-- Both nullable: NULL keeps today's behaviour for every existing row, and
-- EXTERNAL transfers have no toStationId, so they can only carry fromExitId.
-- Exits never enter the routing graph; `distance` already covers the whole walk.
ALTER TABLE transfers ADD COLUMN fromExitId VARCHAR(64) NULL REFERENCES stationExits(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE transfers ADD COLUMN toExitId VARCHAR(64) NULL REFERENCES stationExits(id) ON DELETE SET NULL ON UPDATE CASCADE;
