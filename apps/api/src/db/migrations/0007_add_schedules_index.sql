-- Migration number: 0007 	 2025-10-21T14:15:36.229Z

CREATE INDEX IF NOT EXISTS idx_station_departure ON schedules(stationId, estimatedDeparture);
