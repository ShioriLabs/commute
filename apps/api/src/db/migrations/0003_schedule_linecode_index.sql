-- Migration number: 0003 	 2025-06-11T06:44:33.282Z

CREATE INDEX idx_schedules_lineCode ON schedules(lineCode);
