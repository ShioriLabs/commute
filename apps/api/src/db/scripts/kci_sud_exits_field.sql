-- KRL Sudirman exits, coordinates and signage taken on site (source = 'FIELD').
--
-- A was given as 6°12'08.7"S 106°49'22.9"E, converted to decimal degrees here.
-- `signs` is the board text in the order transcribed. `kind` marks the entries
-- that are a way onto transit: RAIL for KCI/MRT/LRT stations, BUS for
-- TransJakarta stops and the Transport Hub. "BRT ..." and "LRTJBDB ..." were
-- written out as "TransJakarta ..." and "LRT Jabodebek ..." at the owner's call,
-- so those two differ from the printed board. `name` stays NULL. Idempotent;
-- needs 0017 and 0018. Apply BEFORE the deploy, then bump API_VERSION.
INSERT INTO stationExits (id, stationId, ref, name, latitude, longitude, signs, source, createdAt, updatedAt) VALUES ('KCI-SUD:A', 'KCI-SUD', 'A', NULL, -6.202417, 106.823028, '[{"text":"JXB buy local!"},{"text":"Skate Park Dukuh Atas"},{"text":"Jl. Jenderal Sudirman"},{"text":"Jl. Galunggung"},{"text":"TransJakarta Dukuh Atas","kind":"BUS"},{"text":"TransJakarta Galunggung","kind":"BUS"},{"text":"Wisma Indocement"}]', 'FIELD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, signs = excluded.signs, source = 'FIELD', updatedAt = CURRENT_TIMESTAMP;
INSERT INTO stationExits (id, stationId, ref, name, latitude, longitude, signs, source, createdAt, updatedAt) VALUES ('KCI-SUD:B', 'KCI-SUD', 'B', NULL, -6.202261, 106.823185, '[{"text":"Jl. Kendal"},{"text":"Jl. Blora"},{"text":"Taman K"},{"text":"MRT Dukuh Atas BNI","kind":"RAIL"},{"text":"KCI Sudirman Baru/BNI City","kind":"RAIL"},{"text":"Transport Hub Dukuh Atas","kind":"BUS"}]', 'FIELD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, signs = excluded.signs, source = 'FIELD', updatedAt = CURRENT_TIMESTAMP;
INSERT INTO stationExits (id, stationId, ref, name, latitude, longitude, signs, source, createdAt, updatedAt) VALUES ('KCI-SUD:C', 'KCI-SUD', 'C', NULL, -6.202643, 106.824782, '[{"text":"JPM Dukuh Atas"},{"text":"LRT Jabodebek Dukuh Atas Bank Syariah Indonesia","kind":"RAIL"}]', 'FIELD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, signs = excluded.signs, source = 'FIELD', updatedAt = CURRENT_TIMESTAMP;
