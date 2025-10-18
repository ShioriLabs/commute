-- Migration number: 0006 	 2025-10-18T19:04:36.973Z

ALTER TABLE stations ADD COLUMN amenities TEXT NULL;
ALTER TABLE stations ADD COLUMN latitude REAL NULL;
ALTER TABLE stations ADD COLUMN longitude REAL NULL;

CREATE INDEX idx_station_coords ON stations(latitude, longitude);
