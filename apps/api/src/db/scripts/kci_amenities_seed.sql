-- KCI station amenities seed.
--
-- All 111 KCI stations shipped with amenities NULL while MRTJ and LRTJBDB were
-- populated. This backfills them one station at a time: KCI stations vary far
-- more than the MRTJ/LRTJBDB rows (which are uniform per-operator blocks), so
-- each entry is researched individually rather than templated.
--
-- Sources are cited per station. Where a facility exists but is qualified
-- (wrong side of the gate, one platform only, out of service), the detail goes
-- in `text`, which the station sheet renders in place of the default
-- "Tersedia" label. Prefer recording the caveat over dropping the row.
--
-- Deliberately omitted throughout: WIFI (Wikipedia lists it widely but it is
-- unreliable in practice and we have no per-station confirmation) and
-- TOILET_ACCESSIBLE (rarely distinguished from the general toilet in any
-- source; absence of evidence is not recorded as a fact). BIKE_PARKING is set
-- only where a source names station-owned racks.
--
-- Escalators and lifts on the Jatinegara-Cikarang stretch are past the gates
-- (island platforms reached from a concourse), so they are ESCALATOR_PAID /
-- ELEVATOR_PAID. That is a property of those stations, not a default: Manggarai
-- carries unpaid units as well and records both sides. Any station with public
-- circulation outside the gates needs the same treatment - check before
-- assuming the paid variant.

-- Stasiun Sudirman (SUD, line C12) - two side platforms, both inside the gates.
-- Toilet is on peron 1 only, at the west end; peron 2 and the upper level have
-- none.
--
-- NO ELEVATOR. Wikipedia carries a lift photo captioned "Lift stasiun, tidak
-- beroperasi" and several blogs list a working lift (those are conflating this
-- station with BNI City). The lift is boarded up as of 2026-07 - field-verified,
-- not merely out of service - so it is not an amenity and gets no row. Do not
-- re-add it from the photo; step-free access here cannot be assumed.
--
-- Sources: id.wikipedia.org/wiki/Stasiun_Sudirman (facility infobox),
-- medcom.id 9K5nmWRN (toilet on peron 1, west end), field report 2026-07 (lift).
UPDATE stations SET amenities = json('[
  {"type":"TOILET","text":"Peron 1"},
  {"type":"PRAYING_ROOM","text":"Peron 1"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"LOCKERS"},
  {"type":"PARKING","text":"Gedung Transport Hub Dukuh Atas"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-SUD';

-- ---------------------------------------------------------------------------
-- Jatinegara (C15) - Cikarang (C26)
--
-- Field report 2026-07: Cakung and Kranji have toilet, musala, escalator, lift
-- and charging; the rest of this stretch looks the same by design. Checked
-- station by station against the Wikipedia facility infoboxes rather than
-- propagated, because these are not one rebuild programme: C16-C20 (Klender,
-- Buaran, Klender Baru, Cakung, Kranji) are the 2018-19 double-double-track
-- rebuilds, while Tambun (2023), Metland Telagamurni (2019) and Cikarang are
-- separate projects that happen to land on a similar spec.
--
-- HOW TO READ THE INFOBOX: it is an inventory of what an editor bothered to
-- tag, not a survey. Buaran's infobox omits its escalator, but a street-level
-- photo (2026-06-30) plainly shows the escalator truss; its parking is
-- likewise real. So a missing icon means UNKNOWN, never absent. Facilities are
-- listed here only on positive evidence, and the gaps below are open questions
-- for whoever can visit - not findings:
--
--   Bekasi Timur (C22) - escalator? musala? (infobox omits, write-ups claim)
--   Cibitung (C24)     - escalator? (lift confirmed)
--
-- Equally, do not fill those gaps by copying a neighbouring station: parking
-- and escalators both vary within the DDT five, so there is no group property
-- to inherit.
--
-- Sources: id.wikipedia.org facility infoboxes per station, retrieved 2026-07;
-- field reports 2026-07 for Cakung, Kranji, Buaran, Klender Baru.

-- Jatinegara (C15). Major interchange, full facility set.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"LOCKERS"},
  {"type":"PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-JNG';

-- Manggarai (C13). The network's biggest interchange - three levels, 12 tracks,
-- 7 platforms - and the first station here where the paid/unpaid split in
-- AMENITY_TYPES earns its keep, so it is recorded on both sides rather than
-- collapsed to the paid variants:
--
--   ESCALATOR_UNPAID - both entrance sides (field report 2026-07)
--   ELEVATOR_UNPAID  - western concourse only, toward the Dr. Saharjo exit and
--                      the integrated Transjakarta halte (field report 2026-07)
--   ESCALATOR_PAID / ELEVATOR_PAID - concourse-to-platform, throughout
--
-- `text` is rider-facing and shows verbatim on the station sheet, so it names
-- landmarks a passenger can actually follow ("Pintu Dr. Saharjo"), not operator
-- vocabulary. "Konkors" is the operator's word for the concourse and was
-- rejected for that reason - keep it to the comments, out of the data.
--
-- TOILET_ACCESSIBLE is set here, unlike the rest of this file: KAI Commuter and
-- KAI Bandara both state it directly, which is the positive evidence the other
-- stations lack. Note that escalator/lift outages have been reported here
-- repeatedly (Kompas 2023-01-27, redigest 2022-04); no unit is flagged because
-- none is known to be permanently out, unlike the boarded-up lift at Sudirman.
--
-- Sources: id.wikipedia.org/wiki/Stasiun_Manggarai (facility infobox),
-- @CommuterLine 2022-05-19 (musala, loket, lift, eskalator, toilet disabilitas),
-- @KAIBandara 2020-10-08 (toilet disabilitas), field report 2026-07 for the
-- paid/unpaid placement.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"TOILET_ACCESSIBLE"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_UNPAID","text":"Kedua sisi pintu masuk"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_UNPAID","text":"Pintu Dr. Saharjo"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"LOCKERS"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-MRI';

-- Matraman (C14). Included because it carries the same set; no lockers listed.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-MTR';

-- Klender (C16). DDT rebuild.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-KLD';

-- Buaran (C17). DDT rebuild. Escalator and parking both confirmed on the
-- ground (street-level photo dated 2026-06-30 shows the enclosed escalator
-- truss from platform to concourse alongside the lift shaft) even though the
-- Wikipedia infobox omits the escalator. The infobox is an inventory of what
-- someone bothered to tag, not a survey - treat its omissions as unknown
-- rather than as absence.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-BUA';

-- Klender Baru (C18). DDT rebuild. No parking (field report 2026-07).
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-KLDB';

-- Cakung (C19). Field-confirmed 2026-07: toilet, musala, escalator, lift and
-- charging. No parking - the infobox omits it and the field report confirms.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-CUK';

-- Kranji (C20). Field-confirmed 2026-07: all six present.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-KRI';

-- Bekasi (C21). Large station; no charging or lockers listed.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-BKS';

-- Bekasi Timur (C22). UNRESOLVED - escalator and musala unconfirmed. The
-- infobox omits both; travel write-ups claim both; no field check available.
-- Buaran proved the infobox under-reports escalators, so omission here is not
-- evidence of absence - these are simply unknown and left out until someone
-- can look. Do not infer them from the neighbouring stations either.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-BKST';

-- Tambun (C23). Rebuilt 2023, opened 18 Nov 2023.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-TB';

-- Cibitung (C24). UNRESOLVED - escalator unconfirmed, same situation as
-- Bekasi Timur: infobox omits it, no field check available. Lift is confirmed.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-CIT';

-- Metland Telagamurni (C25). Opened 2019.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"NURSING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-TLM';

-- Cikarang (C26). Terminus, revitalised.
UPDATE stations SET amenities = json('[
  {"type":"TOILET"},
  {"type":"PRAYING_ROOM"},
  {"type":"ESCALATOR_PAID"},
  {"type":"ELEVATOR_PAID"},
  {"type":"CHARGING_STATION"},
  {"type":"PARKING"},
  {"type":"BIKE_PARKING"}
]'), updatedAt = CURRENT_TIMESTAMP WHERE id = 'KCI-CKR';
