-- Migration number: 0008 	 2025-10-23T10:47:57.747Z

CREATE TABLE IF NOT EXISTS transfers (
  id VARCHAR(32) PRIMARY KEY NOT NULL UNIQUE,
  dataType VARCHAR(16) NOT NULL,
  fromStationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  toStationId VARCHAR(32) NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  toStationData TEXT NULL,
  distance INT NOT NULL,
  notes TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    (toStationId IS NOT NULL AND toStationData IS NULL)
    OR
    (toStationId IS NULL AND toStationData IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_transfer_fromStationId ON transfers(fromStationId);
CREATE INDEX IF NOT EXISTS idx_transfer_toStationId ON transfers(toStationId);
