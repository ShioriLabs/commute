-- Migration number: 0002 	 2025-04-24T06:02:23.993Z

CREATE INDEX IF NOT EXISTS idx_schedules_stationid ON schedules (stationId);
CREATE INDEX IF NOT EXISTS idx_stations_operator ON stations (operator);
CREATE INDEX IF NOT EXISTS idx_stations_code ON stations (code);
