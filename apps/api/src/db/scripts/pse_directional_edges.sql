-- Pasar Senen (KCI-PSE) is served northbound only: GST -> PSE -> KMO. Southbound
-- trains run KMO -> GST without calling, so that direction becomes one bridged
-- edge and PSE loses its two southbound edges. Generated from Stop.serves in
-- db/data/topology.ts; this is the same change as regenerating edges.sql, scoped
-- to the three rows it touches.
--
-- Apply BEFORE deploying the code that drops ENDPOINT_RESTRICTIONS: old code on
-- these edges is harmless, new code on the old edges would board PSE southbound.
DELETE FROM edges WHERE id IN ('C:KCI-KMO->KCI-PSE', 'C:KCI-PSE->KCI-GST');
INSERT OR REPLACE INTO edges (id, lineCode, fromStationId, toStationId, distance, createdAt, updatedAt) VALUES ('C:KCI-KMO->KCI-GST', 'C', 'KCI-KMO', 'KCI-GST', 2930, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
