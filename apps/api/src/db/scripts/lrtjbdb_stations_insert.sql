INSERT INTO stations (id, name, code, formattedName, region, regionCode, operator, timetableSynced, createdAt, updatedAt) VALUES
('LRTJBDB-DKA', 'Dukuh Atas', 'DKA', 'Dukuh Atas BNI', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-SET', 'Setiabudi', 'SET', 'Setiabudi', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-RAS', 'Rasuna Said', 'RAS', 'Rasuna Said', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-KUA', 'Kuningan', 'KUA', 'Kuningan', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-PAN', 'Pancoran', 'PAN', 'Pancoran bank bjb', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CKK', 'Cikoko', 'CKK', 'Cikoko', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CIL', 'Ciliwung', 'CIL', 'Ciliwung', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CWG', 'Cawang', 'CWG', 'Cawang', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-HAL', 'Halim', 'HAL', 'Halim', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-JBU', 'Jati Bening Baru', 'JBU', 'Jati Bening Baru', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CK1', 'Cikunir 1', 'CK1', 'Cikunir 1', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CK2', 'Cikunir 2', 'CK2', 'Cikunir 2', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-BEK', 'Bekasi Barat', 'BEK', 'Bekasi Barat', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-JTM', 'Jatimulya', 'JTM', 'Jatimulya', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-TMI', 'TMII', 'TMI', 'TMII', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-KAM', 'Kampung Rambutan', 'KAM', 'Kampung Rambutan', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-CRC', 'Ciracas', 'CRC', 'Ciracas', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('LRTJBDB-HAR', 'Harjamukti', 'HAR', 'Harjamukti', 'Jabodetabek', 'CGK', 'LRTJBDB', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Verify the insert
SELECT COUNT(*) as total_inserted FROM stations WHERE operator = 'LRTJBDB';
