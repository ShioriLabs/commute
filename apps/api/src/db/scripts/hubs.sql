-- Hub seed — discovered from connected components of the `transfers` graph
-- (internal station<->station edges only). See docs/transit-hubs.md.
-- Curated source of truth; re-run the discovery query to revisit the roster.
-- score mirrors stations.score for search ranking; lat/lng are member centroids.

-- HUB-DKA — Dukuh Atas (4 members, linked within ~310m)
INSERT OR REPLACE INTO hubs (id, slug, name, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-DKA', 'dukuh-atas', 'Dukuh Atas', NULL, NULL, -6.2023, 106.8229, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:KCI-SUD', 'HUB-DKA', 'KCI-SUD', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:KCI-SUDB', 'HUB-DKA', 'KCI-SUDB', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:MRTJ-DKA', 'HUB-DKA', 'MRTJ-DKA', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:LRTJBDB-DKA', 'HUB-DKA', 'LRTJBDB-DKA', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- HUB-CW — Cawang (2 members, ~620m transfer; borderline, kept per decision)
INSERT OR REPLACE INTO hubs (id, slug, name, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-CW', 'cawang', 'Cawang', NULL, NULL, -6.2429, 106.8577, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:KCI-CW', 'HUB-CW', 'KCI-CW', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:LRTJBDB-CKK', 'HUB-CW', 'LRTJBDB-CKK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
