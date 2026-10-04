-- Migration number: 0017 	 2026-10-01T00:00:00.000Z

-- Human edits to transfers, layered over the imported rows instead of written
-- into them, so importers (generateTJSQL, the measured_transfers seeds) keep
-- owning `transfers` and can re-run without clobbering an edit. Written only
-- by apps/admin. Readers go through `transfers_effective`.

CREATE TABLE IF NOT EXISTS publishes (
  id TEXT PRIMARY KEY NOT NULL,
  publishedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publishedBy TEXT NOT NULL,
  changeCount INTEGER NOT NULL,
  summary TEXT NOT NULL
);

-- One live row and at most one pending row per transfer: PK (id, status).
-- Editing a published override writes a separate draft, so the live value
-- stays live until the next publish.
CREATE TABLE IF NOT EXISTS transfer_overrides (
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete', 'revert')),
  fromStationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  toStationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- NULL on an upsert keeps the imported distance (a notes-only edit). Never 0:
  -- 0 is the "unmeasured" sentinel and must stay an importer-side fact.
  distance INT NULL CHECK (distance IS NULL OR distance > 0),
  noTap BOOLEAN NOT NULL DEFAULT 0,
  notes TEXT NULL,
  editedBy TEXT NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publishId TEXT NULL REFERENCES publishes(id),

  PRIMARY KEY (id, status),
  -- 'revert' means "drop the published override on publish"; it is never live.
  CHECK (status = 'draft' OR op != 'revert')
);

CREATE VIEW IF NOT EXISTS transfers_effective AS
  SELECT
    t.id, t.dataType, t.fromStationId, t.toStationId, t.toStationData,
    COALESCE(o.distance, t.distance) AS distance,
    CASE WHEN o.id IS NULL THEN t.notes ELSE o.notes END AS notes,
    t.createdAt,
    COALESCE(o.updatedAt, t.updatedAt) AS updatedAt,
    CASE WHEN o.id IS NULL THEN t.noTap ELSE o.noTap END AS noTap
  FROM transfers t
  LEFT JOIN transfer_overrides o
    ON o.id = t.id AND o.status = 'published' AND o.op = 'upsert' AND t.dataType = 'INTERNAL'
  WHERE NOT EXISTS (
    SELECT 1 FROM transfer_overrides d
    WHERE d.id = t.id AND d.status = 'published' AND d.op = 'delete' AND t.dataType = 'INTERNAL'
  )
  UNION ALL
  SELECT
    o.id, 'INTERNAL', o.fromStationId, o.toStationId, NULL,
    o.distance, o.notes, o.updatedAt, o.updatedAt, o.noTap
  FROM transfer_overrides o
  WHERE o.status = 'published' AND o.op = 'upsert' AND o.distance IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = o.id);
