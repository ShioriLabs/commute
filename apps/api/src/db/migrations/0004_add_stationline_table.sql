-- Migration number: 0004 	 2025-06-12T03:22:02.919Z

CREATE TABLE IF NOT EXISTS stationLines (
  id VARCHAR(32) PRIMARY KEY NOT NULL UNIQUE,
  stationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  lineCode VARCHAR(8) NOT NULL,
  stationNumber INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO stationLines (id, stationId, lineCode, stationNumber, createdAt, updatedAt)
SELECT
  stationId || '-' || lineCode as id,
  stationId,
  lineCode,
  0 as stationNumber,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM schedules
GROUP BY stationId, lineCode;
