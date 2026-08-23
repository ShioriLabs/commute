-- Hub seed — discovered from connected components of the `transfers` graph
-- (internal station<->station edges only). See docs/transit-hubs.md.
-- Curated source of truth; re-run the discovery query to revisit the roster.
-- score mirrors stations.score for search ranking; lat/lng are member centroids.

-- HUB-DKA — Dukuh Atas (7 members: 4 rail + 3 TJ)
INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-DKA', 'dukuh-atas', 'Dukuh Atas', 'hub', NULL, NULL, -6.2030, 106.8230, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:KCI-SUD', 'HUB-DKA', 'KCI-SUD', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:KCI-SUDB', 'HUB-DKA', 'KCI-SUDB', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:MRTJ-DKA', 'HUB-DKA', 'MRTJ-DKA', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:LRTJBDB-DKA', 'HUB-DKA', 'LRTJBDB-DKA', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:TJ-H00047P', 'HUB-DKA', 'TJ-H00047P', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:TJ-B07663P', 'HUB-DKA', 'TJ-B07663P', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-DKA:TJ-H00283P', 'HUB-DKA', 'TJ-H00283P', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- HUB-CW — Cawang (4 members: KRL + LRT + both Cikoko BRT directions)
INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-CW', 'cawang', 'Cawang', 'hub', NULL, NULL, -6.2430, 106.8579, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:KCI-CW', 'HUB-CW', 'KCI-CW', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:LRTJBDB-CKK', 'HUB-CW', 'LRTJBDB-CKK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:TJ-H00064S', 'HUB-CW', 'TJ-H00064S', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CW:TJ-H00063S', 'HUB-CW', 'TJ-H00063S', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- HUB-CSW — CSW (4 members) / "Pumpunan Moda Cakra Selaras Wahana": the art-deco ring
-- footbridge over Kyai Maja/Panglima Polim, open since 2021-12-22. Tightest
-- complex on the network (~201m). Wikipedia also lists CSW 2 (TJ-H00264P) as
-- part of the building, but it is a roadside non-BRT halte (searchable=0, serves
-- only 1C/1M/1Q/8D/8E) — deliberately excluded.
INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-CSW', 'csw', 'CSW', 'hub', NULL, NULL, -6.2398, 106.7984, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CSW:MRTJ-SSM', 'HUB-CSW', 'MRTJ-SSM', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CSW:TJ-H00041P', 'HUB-CSW', 'TJ-H00041P', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CSW:TJ-H00265P', 'HUB-CSW', 'TJ-H00265P', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-CSW:TJ-H00266P', 'HUB-CSW', 'TJ-H00266P', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- HUB-SEN — Senen Sentral, an official "pumpunan moda" (FDTJ map changelog flags
-- Jaga Jakarta <-> Senen TOYOTA Rangga as transit tanpa keluar bangunan — those
-- two sit 60m apart; the KRL station is the far end of the ~486m complex).
INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-SEN', 'senen-sentral', 'Senen Sentral', 'hub', NULL, NULL, -6.1768, 106.8423, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-SEN:KCI-PSE', 'HUB-SEN', 'KCI-PSE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-SEN:TJ-H00213P', 'HUB-SEN', 'TJ-H00213P', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-SEN:TJ-H00212P', 'HUB-SEN', 'TJ-H00212P', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-SEN:TJ-H00005P', 'HUB-SEN', 'TJ-H00005P', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- HUB-MRI — Manggarai (4 members: KRL + LRT + 2 TJ), ~134m across the three
-- located members. Note docs/transit-hubs.md used to cite Manggarai as the
-- counter-example of a NON-hub — true when KCI-MRI was the only row here, but
-- LRT Jakarta Phase 1B added LRTJ-MGI and the TJ haltes are separate rows, so
-- it is now a genuine multi-station complex. The doc has been updated to match.
--
-- LRTJ-MGI is included while still searchable=0/unbuilt (Phase 1B is under
-- construction): HubRepository does not filter on searchable, so the member is
-- carried now and simply starts resolving when the extension commissions — no
-- second edit needed. It has no lat/lng yet, so the centroid below is the mean
-- of the three located members only.
--
-- Halte Manggarai Temporer 1/2 (TJ-B08301P/B08302P) are deliberately EXCLUDED.
-- They are a temporary corridor-4/4D halte 252-441m away — a separate cluster
-- (the pair is 57m apart from each other, but 308m from the KRL station), not
-- part of the station complex. Revisit if the permanent halte lands closer.
INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('HUB-MRI', 'manggarai', 'Manggarai', 'hub', NULL, NULL, -6.2100, 106.8505, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-MRI:KCI-MRI', 'HUB-MRI', 'KCI-MRI', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-MRI:LRTJ-MGI', 'HUB-MRI', 'LRTJ-MGI', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-MRI:TJ-H00272P', 'HUB-MRI', 'TJ-H00272P', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('HUB-MRI:TJ-H00271P', 'HUB-MRI', 'TJ-H00271P', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
