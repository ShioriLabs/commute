-- Migration number: 0009 	 2026-06-30T07:30:00.000Z

CREATE TABLE IF NOT EXISTS edges (
  id              VARCHAR(48) PRIMARY KEY NOT NULL UNIQUE,
  lineCode        VARCHAR(8)  NOT NULL,
  fromStationId   VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  toStationId     VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  distance        INTEGER     NOT NULL,
  durationSeconds INTEGER     NULL,
  createdAt       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (lineCode, fromStationId, toStationId)
);

CREATE INDEX IF NOT EXISTS idx_edges_fromStationId ON edges(fromStationId);
CREATE INDEX IF NOT EXISTS idx_edges_toStationId ON edges(toStationId);
