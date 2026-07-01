-- Migration number: 0010 	 2026-07-01T00:00:00.000Z

-- A transit hub is a named grouping of multiple physically-distinct stations
-- (an interchange complex linked by walking), layered on the transfer graph.
-- See docs/transit-hubs.md.

CREATE TABLE IF NOT EXISTS hubs (
  id          VARCHAR(48) PRIMARY KEY NOT NULL UNIQUE,  -- stable, e.g. 'HUB-DKA'
  slug        VARCHAR(64) NOT NULL UNIQUE,              -- URL key, mutable
  name        VARCHAR(128) NOT NULL,
  description TEXT        NULL,
  heroImage   VARCHAR(255) NULL,
  latitude    REAL        NULL,
  longitude   REAL        NULL,
  score       INTEGER     NOT NULL DEFAULT 0,
  createdAt   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hubs_slug ON hubs (slug);

CREATE TABLE IF NOT EXISTS hubStations (
  id        VARCHAR(80) PRIMARY KEY NOT NULL UNIQUE,  -- `${hubId}:${stationId}`
  hubId     VARCHAR(48) NOT NULL REFERENCES hubs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  stationId VARCHAR(48) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position  INTEGER     NOT NULL DEFAULT 0,
  createdAt TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (hubId, stationId)
);

CREATE INDEX IF NOT EXISTS idx_hubStations_hubId ON hubStations (hubId);
CREATE INDEX IF NOT EXISTS idx_hubStations_stationId ON hubStations (stationId);
