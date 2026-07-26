-- Migration number: 0014 	 2026-07-26T00:00:00.000Z

-- Distinguishes two things the `hubs` table currently conflates:
--   'hub'        — several distinct, differently-named stations grouped under one
--                  complex (Dukuh Atas = Sudirman + Sudirman Baru + Dukuh Atas BNI
--                  + Galunggung…). The grouping carries information: a rider must
--                  be told *which* member they want.
--   'integrated' — one place that is a single station to a rider, split across
--                  operators only in the data (Juanda KRL + Juanda BRT). The hub
--                  name alone is sufficient.
-- Default 'hub' preserves today's behavior for the existing roster.
--
-- Deliberately NOT modelled here: whether members are joined by a covered/roofed
-- walkway (FDTJ's "Halte Transit" black connector vs "Halte/Stasiun Sambungan"
-- grey box). That is a per-EDGE property, not a per-hub one — Cawang has a roofed
-- LRT<->BRT link and an open-air JPO to the KRL station in the same complex — and
-- it is independent of fare: a roofed link can still require a tap-out. It belongs
-- alongside `transfers.noTap` if/when it is added. See docs/transit-hubs.md.
ALTER TABLE hubs ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'hub';
