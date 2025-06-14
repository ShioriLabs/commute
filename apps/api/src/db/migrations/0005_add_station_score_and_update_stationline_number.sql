-- Migration number: 0005 	 2025-06-14T15:08:17.450Z

ALTER TABLE stations ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE stationLines ADD COLUMN stationNumberTemp VARCHAR(12);
UPDATE stationLines SET stationNumberTemp = CAST(stationNumber AS TEXT);
ALTER TABLE stationLines DROP COLUMN stationNumber;
ALTER TABLE stationLines RENAME COLUMN stationNumberTemp to stationNumber;
