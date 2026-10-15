-- Stale edges left behind by the 2026-07-24 feed's reroutes.
--
-- edges.sql is INSERT OR REPLACE, so it can add and update but never delete; and
-- prune_feeder_edges.sql only removes lines absent from TOPOLOGY, which lines 1
-- and 6 are not. Without this the router keeps track that no longer carries
-- service:
--   6 via Halimun (H00073P)  -- corridor 6 now runs Flyover Kuningan -> Galunggung direct
--   1 via Petojo (H00170P)   -- the feed's Monas/Thamrin diversion; corridor 1 is
--                               poster-overridden back to Harmoni -> Monas ->
--                               Kebon Sirih (H00268S)
DELETE FROM edges WHERE id IN (
  '6:TJ-H00118P->TJ-H00073P',
  '6:TJ-H00073P->TJ-H00283P',
  '1:TJ-H00278P->TJ-H00170P',
  '1:TJ-H00170P->TJ-H00268S'
);
