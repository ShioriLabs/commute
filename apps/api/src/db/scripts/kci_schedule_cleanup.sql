-- KCI schedule cleanup, 2026-11-11. One-off; safe to re-run.
--
-- 1. Four trips run the Sudirman corridor (MRI-SUD-SUDB-THB-DU), which only the
--    Cikarang loop serves, but kci.id labels them after their trainset's home
--    line (Rangkasbitung, Tangerang). They showed as R/T departures to Angke,
--    Manggarai and Duri on Tanah Abang's board. generate:kci-timetable now
--    relabels such trips itself; this fixes the rows already on prod.
UPDATE schedules SET lineCode = 'C', updatedAt = CURRENT_TIMESTAMP
WHERE stationId LIKE 'KCI-%' AND tripNumber IN ('1727E', '1676D', '2014C', '2023C') AND lineCode IN ('R', 'T');

-- 2. Karet retired in September 2026. kci_karet_retire.sql removed its edges and
--    stationLines but left the 2026-07-17 board, which no dump rewrites.
DELETE FROM schedules WHERE stationId = 'KCI-KAT';

-- 3. Line A rows at Grogol, last written 2025-04-22. The airport train does not
--    stop there and generateBasoettaTimetableSQL never writes this station.
DELETE FROM schedules WHERE stationId = 'KCI-GGL' AND lineCode = 'A';
