import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { BadRequest, Internal, NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { Line } from 'models/line'
import { CompactLineGroupedTimetable, GroupingSchedule, LineGroupedTimetable, Schedule } from 'db/schemas/schedules'
import { getLineByOperator } from 'utils/line'
import { CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES, OPERATORS, Operator, PLATFORM_CODES } from '@commute/constants'
import { filterByWindow, mapSchedule, parseTimeWindow, windowCacheKey } from 'utils/schedules'
import { findTopology } from 'utils/topology'
import {
  BoundForEntry,
  buildLineMembershipCount,
  buildStationNameIndex,
  groupDirections,
  syntheticGroup,
  StationNameIndex
} from 'utils/directions'
import * as v from 'valibot'
import { doc, operatorParam, pathParam, queryParam, stationCodeParam, timeWindowParams } from 'schemas/describe'
import { CompactGroupedTimetableSchema, GroupedTimetableSchema, ScheduleSchema, StationSchema, TransferSchema } from '@commute/schemas'

const app = new Hono<{ Bindings: Bindings }>()

// Direction derivation inputs are stable per isolate (fares.ts cachedGraph
// pattern): membership counts are pure TOPOLOGY, the name index needs one D1
// query per operator per isolate.
const membershipCountCache = new Map<Operator, Map<string, number>>()
const nameIndexCache = new Map<Operator, StationNameIndex>()

function getMembershipCount(operator: Operator) {
  let counts = membershipCountCache.get(operator)
  if (!counts) {
    counts = buildLineMembershipCount(operator)
    membershipCountCache.set(operator, counts)
  }
  return counts
}

async function getNameIndex(operator: Operator, stationRepository: StationRepository) {
  let index = nameIndexCache.get(operator)
  if (!index) {
    index = buildStationNameIndex(await stationRepository.getNameIndexRowsByOperator(operator))
    nameIndexCache.set(operator, index)
  }
  return index
}

app.get(
  '/',
  doc({
    summary: 'Daftar semua stasiun',
    description: 'Semua stasiun dari seluruh operator yang bisa dicari. Stasiun yang cuma dipakai buat routing tidak termasuk di sini. Isinya jarang berubah, jadi bisa di-cache di sisi kamu.',
    tag: 'Stasiun',
    data: v.array(StationSchema)
  }),
  async (c) => {
    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `stations:${c.env.API_VERSION}`

    const cachedStations = await kvRepository.get(kvKey)
    if (cachedStations) {
      return c.json(
        Ok(cachedStations),
        200
      )
    }

    const stations = await stationRepository.getAll()

    if (stations.length > 0) {
      c.executionCtx.waitUntil(
        kvRepository.set(kvKey, stations)
      )
    }

    return c.json(
      Ok(
        stations
      ),
      200
    )
  }
)

app.get(
  '/:operator',
  doc({
    summary: 'Daftar stasiun satu operator',
    tag: 'Stasiun',
    data: v.array(StationSchema),
    parameters: [operatorParam],
    errors: { 404: 'Kode operator tidak ditemukan.' }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `stations:${operator.code}:${c.env.API_VERSION}`

    const cachedStations = await kvRepository.get(kvKey)
    if (cachedStations) {
      return c.json(
        Ok(cachedStations),
        200
      )
    }

    const stations = await stationRepository.getAllByOperator(operator.code)

    if (stations.length > 0) {
      c.executionCtx.waitUntil(
        kvRepository.set(kvKey, stations)
      )
    }

    return c.json(
      Ok(
        stations
      ),
      200
    )
  }
)

app.get(
  '/:operator/:stationCode',
  doc({
    summary: 'Detail stasiun',
    description: 'Detail lengkap satu stasiun, termasuk fasilitas dan koordinatnya. Beda dengan endpoint daftar, di sini stasiun yang cuma dipakai buat routing juga ikut dikembalikan.',
    tag: 'Stasiun',
    data: StationSchema,
    parameters: [operatorParam, stationCodeParam],
    errors: { 404: 'Kode operator atau stasiun tidak ditemukan.' }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `stations:${operator.code}-${stationCode}:${c.env.API_VERSION}`

    const cachedStations = await kvRepository.get(kvKey)
    if (cachedStations) {
      return c.json(
        Ok(cachedStations),
        200
      )
    }

    const station = await stationRepository.getById(`${operator.code}-${stationCode}`)

    if (!station) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, station)
    )

    return c.json(
      Ok(
        station
      ),
      200
    )
  }
)

app.get(
  '/:operator/:stationCode/timetable',
  doc({
    summary: 'Jadwal stasiun',
    description: 'Semua jadwal keberangkatan dalam satu daftar, tanpa dipisah per lin. Kalau butuh yang sudah dikelompokkan per arah seperti papan keberangkatan, pakai `/timetable/grouped`.\n\nBisa dipersempit ke rentang jam pakai `from` dan `to` (format `HH:MM`, waktu lokal Asia/Jakarta). Rentangnya dibulatkan ke jam bulat: `from=12:13&to=15:18` jadi jam 12 sampai 15, mencakup keberangkatan sampai `15:59`. Rentang yang melewati tengah malam ditulis biasa saja, misalnya `from=22:00&to=02:00` buat kereta terakhir. Kalau `from` dan `to` persis sama, yang keluar sehari penuh.',
    tag: 'Stasiun',
    data: v.array(ScheduleSchema),
    parameters: [operatorParam, stationCodeParam, ...timeWindowParams],
    errors: {
      400: 'Format `from` atau `to` salah (`INVALID_TIME_RANGE`). Pakai `HH:MM` 24 jam.',
      404: 'Kode operator atau stasiun tidak ditemukan.'
    }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
    }

    const window = parseTimeWindow(c.req.query('from'), c.req.query('to'))
    if (window === 'invalid') {
      return c.json(BadRequest('INVALID_TIME_RANGE', 'Use HH:MM in 24-hour local time, e.g. from=06:00&to=09:00.'), 400)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    /*
     * The window is part of the key. Caching a filtered body under the plain
     * key would serve a morning-only timetable to the next caller who asked for
     * the whole day.
     */
    const kvKey = `timetable:${operator.code}-${stationCode}:${windowCacheKey(window)}:${c.env.API_VERSION}`

    const cachedTimetable = await kvRepository.get(kvKey)
    if (cachedTimetable) {
      return c.json(
        Ok(cachedTimetable),
        200
      )
    }

    const checkStationResult = await stationRepository.checkIfExists(`${operator.code}-${stationCode}`)
    if (!checkStationResult.exists || checkStationResult.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

    if (checkStationResult.station!.timetableSynced === 0) {
      return c.json(
        NotFound(`Timetable for Station ${stationCode} in Operator ${operator.code} is not available yet. Please try again later.`),
        404
      )
    }

    const allDepartures = await stationRepository.getTimetableFromStationId(checkStationResult.station!.id)
    const timetable = window ? filterByWindow(allDepartures, window) : allDepartures
    if (timetable.length === 0) {
      return c.json(
        Ok([]),
        200
      )
    }

    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, timetable)
    )

    return c.json(
      Ok(
        timetable
      ),
      200
    )
  }
)

app.get(
  '/:operator/:stationCode/timetable/grouped',
  doc({
    summary: 'Jadwal stasiun, dikelompokkan',
    description: 'Jadwal keberangkatan yang sudah dikelompokkan per lin, arah, dan tujuan, sesuai bentuk yang ditampilkan papan keberangkatan. Arahnya ditentukan dari stasiun terakhir tiap perjalanan.\n\nKalau butuh response yang lebih ringan, pakai `compact=1`. Tiap keberangkatan jadi tuple `[tripNumber, minutesSinceMidnight]`, bukan object penuh. Menitnya pakai waktu lokal Asia/Jakarta, dari 0 sampai 1439.\n\nBisa dipersempit ke rentang jam pakai `from` dan `to` (format `HH:MM`, dibulatkan ke jam bulat). Pengelompokannya tetap dihitung dari jadwal sehari penuh, jadi arah dan tujuan yang muncul tidak berubah cuma karena rentangnya dipersempit; yang tersaring keberangkatannya.',
    tag: 'Stasiun',
    data: v.union([v.array(GroupedTimetableSchema), v.array(CompactGroupedTimetableSchema)]),
    parameters: [
      operatorParam,
      stationCodeParam,
      queryParam('compact', 'Isi `1` kalau mau keberangkatannya dalam bentuk tuple. Nilai lain akan mengembalikan bentuk penuh.', '1'),
      ...timeWindowParams
    ],
    errors: {
      400: 'Format `from` atau `to` salah (`INVALID_TIME_RANGE`). Pakai `HH:MM` 24 jam.',
      404: 'Kode operator atau stasiun tidak ditemukan.'
    }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const compactMode = c.req.query('compact') === '1'
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
    }

    const window = parseTimeWindow(c.req.query('from'), c.req.query('to'))
    if (window === 'invalid') {
      return c.json(BadRequest('INVALID_TIME_RANGE', 'Use HH:MM in 24-hour local time, e.g. from=06:00&to=09:00.'), 400)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `timetable:${operator.code}-${stationCode}:grouped:${compactMode ? 'compact' : 'full'}:${windowCacheKey(window)}:${c.env.API_VERSION}`

    const cachedTimetable = await kvRepository.get(kvKey)
    if (cachedTimetable) {
      return c.json(
        Ok(cachedTimetable),
        200
      )
    }

    // optimistic check, fails slower but faster happy path
    const stationID = `${operator.code}-${stationCode}`
    const [
      checkStationResult,
      schedules
    ] = await Promise.allSettled([
      stationRepository.checkIfExists(stationID),
      // Compact mode only needs the grouping/compact columns; full mode embeds
      // whole Schedule rows in the response, so keep selectAll there.
      compactMode
        ? stationRepository.getGroupingTimetableFromStationId(stationID)
        : stationRepository.getTimetableFromStationId(stationID)
    ])

    if (checkStationResult.status === 'rejected' || schedules.status === 'rejected') return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'))

    if (!checkStationResult.value.exists || checkStationResult.value.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

    if (checkStationResult.value.station.timetableSynced === 0) {
      return c.json(
        NotFound(`Timetable for Station ${stationCode} in Operator ${operator.code} is not available yet. Please try again later.`),
        404
      )
    }

    if (schedules.value.length === 0) {
      return c.json(
        Ok([]),
        200
      )
    }

    const isBekasiInterliningStation = operator.code === OPERATORS.KCI.code && CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES.has(stationCode)
    const lineGroups: Map<string, { line: Line, boundForGroups: Map<string, GroupingSchedule[]> }> = new Map()

    for (const schedule of schedules.value) {
      const line = getLineByOperator(operator.code, schedule.lineCode)
      if (!line) continue

      let lineGroup = lineGroups.get(line.lineCode)
      if (!lineGroup) {
        lineGroup = {
          line,
          boundForGroups: new Map()
        }
        lineGroups.set(line.lineCode, lineGroup)
      }

      let via: string | null = null

      if (isBekasiInterliningStation && schedule.boundFor === 'Kampung Bandan') {
        const trainNo = schedule.tripNumber ?? ''
        if (trainNo !== '') {
          if (trainNo.startsWith('6')) via = 'Pasar Senen'
          else via = 'Manggarai'
        }
      }

      const boundForKey = via ? `${schedule.boundFor}:${via}` : schedule.boundFor
      const boundForSchedules = lineGroup.boundForGroups.get(boundForKey)
      if (boundForSchedules) {
        boundForSchedules.push(schedule)
      } else {
        lineGroup.boundForGroups.set(boundForKey, [schedule])
      }
    }

    // Direction derivation is KCI-only (per-line topology walks). Other
    // operators keep one group per boundFor — same shape, unchanged rendering.
    const isKCI = operator.code === OPERATORS.KCI.code
    const nameIndex = isKCI ? await getNameIndex(operator.code, stationRepository) : null
    const membershipCount = isKCI ? getMembershipCount(operator.code) : new Map<string, number>()

    /*
     * One array typed as the union of both shapes. Declaring it via a ternary
     * gave `A[] | B[]`, which TypeScript narrows to `A[] & B[]` at the push —
     * an impossible intersection. The element union is what we actually mean:
     * every entry is one shape or the other, chosen by compactMode.
     */
    const timetable: (LineGroupedTimetable[number] | CompactLineGroupedTimetable[number])[] = []

    /*
     * Applied per destination, after grouping.
     *
     * Grouping runs over the full day on purpose: directions and platforms are
     * derived by walking topology across all of a line's departures, so
     * narrowing the input first would make a board's shape depend on the
     * window — a rider asking for 06:00–09:00 could lose a direction entirely
     * because its only trips fall outside. Filtering here keeps the board's
     * structure stable and empties the departure lists instead.
     */
    const inWindow = <T extends { estimatedDeparture: unknown }>(rows: T[]): T[] =>
      window ? filterByWindow(rows, window) : rows

    for (const { line, boundForGroups } of lineGroups.values()) {
      const entries: BoundForEntry[] = Array.from(boundForGroups.entries()).map(([key, schedules]) => {
        const [boundFor, via] = key.split(':')
        return { boundFor: boundFor!, via: via || null, schedules }
      })

      const groups = isKCI
        ? groupDirections({
            operator: operator.code,
            lineCode: line.lineCode,
            stationCode,
            topology: findTopology(operator.code, line.lineCode),
            entries,
            nameIndex,
            lineMembershipCount: membershipCount
          })
        : entries.map(syntheticGroup)

      // Shared per-group fields; only `schedules` differs between the two
      // wire formats, so the split happens once at the destination level.
      const groupShell = (group: typeof groups[number]) => ({
        key: group.key,
        label: group.label,
        platformCode: group.nextHopCode
          ? PLATFORM_CODES[`${stationID}:${line.lineCode}:${group.nextHopCode}`] ?? null
          : null
      })
      // A line key rather than its denormalised name/colour: the same
      // dictionary from /operators resolves it, as everywhere else.
      const lineKey = `${operator.code}:${line.lineCode}`

      if (compactMode) {
        timetable.push({
          line: lineKey,
          timetable: groups.map(group => ({
            ...groupShell(group),
            destinations: group.destinations.map(destination => ({
              boundFor: destination.boundFor,
              via: destination.via,
              schedules: mapSchedule(inWindow(destination.schedules), true)
            }))
          }))
        })
      } else {
        timetable.push({
          line: lineKey,
          timetable: groups.map(group => ({
            ...groupShell(group),
            destinations: group.destinations.map(destination => ({
              boundFor: destination.boundFor,
              via: destination.via,
              schedules: mapSchedule(inWindow(destination.schedules) as Schedule[], false)
            }))
          }))
        })
      }
    }

    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, timetable)
    )

    return c.json(
      Ok(timetable),
      200
    )
  }
)

app.get(
  '/:operator/:stationCode/timetable/:line',
  doc({
    summary: 'Jadwal stasiun untuk satu lin',
    description: 'Jadwal satu lin di satu stasiun. Sama seperti `/timetable`, bisa dipersempit pakai `from` dan `to`.',
    tag: 'Stasiun',
    data: v.array(ScheduleSchema),
    parameters: [operatorParam, stationCodeParam, pathParam('line', 'Kode lin yang mau difilter.', 'C'), ...timeWindowParams],
    errors: {
      400: 'Format `from` atau `to` salah (`INVALID_TIME_RANGE`). Pakai `HH:MM` 24 jam.',
      404: 'Kode operator, stasiun, atau lin tidak ditemukan.'
    }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const lineCode = c.req.param('line')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
    }

    const window = parseTimeWindow(c.req.query('from'), c.req.query('to'))
    if (window === 'invalid') {
      return c.json(BadRequest('INVALID_TIME_RANGE', 'Use HH:MM in 24-hour local time, e.g. from=06:00&to=09:00.'), 400)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `timetable:${operator.code}-${stationCode}:${lineCode}:${windowCacheKey(window)}:${c.env.API_VERSION}`

    const cachedTimetable = await kvRepository.get(kvKey)
    if (cachedTimetable) {
      return c.json(
        Ok(cachedTimetable),
        200
      )
    }

    const checkIfLineExists = await stationRepository.checkIfLineExists(`${operator.code}-${stationCode}`, lineCode)
    if (!checkIfLineExists.exists || checkIfLineExists.line === null) return c.json(NotFound(`Unknown Line Code ${lineCode} in Station ID ${operator.code}-${stationCode}`), 404)

    const lineDepartures = await stationRepository.getTimetableFromStationId(checkIfLineExists.line!.stationId, checkIfLineExists.line!.lineCode)
    const timetable = window ? filterByWindow(lineDepartures, window) : lineDepartures
    if (timetable.length === 0) {
      return c.json(
        Ok([]),
        200
      )
    }

    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, timetable)
    )

    return c.json(
      Ok(
        timetable
      ),
      200
    )
  }
)

app.get(
  '/:operator/:stationCode/transfers',
  doc({
    summary: 'Transfer dari satu stasiun',
    description: 'Sambungan ke stasiun terdekat, termasuk yang beda operator, lengkap dengan jarak jalan kakinya. Transfer `INTERNAL` masih di dalam area berbayar, sedangkan `EXTERNAL` berarti kamu harus tap keluar dulu lalu tap masuk lagi.',
    tag: 'Stasiun',
    data: v.array(TransferSchema),
    parameters: [operatorParam, stationCodeParam],
    errors: { 404: 'Kode operator atau stasiun tidak ditemukan.' }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(NotFound('UNKNOWN_OPERATOR', `Unknown Operator Code: ${operatorCode}`), 404)
    }

    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const kvKey = `transfers:${operator.code}-${stationCode}:${c.env.API_VERSION}`

    const cachedTimetable = await kvRepository.get(kvKey)
    if (cachedTimetable) {
      return c.json(
        Ok(cachedTimetable),
        200
      )
    }

    // optimistic check, fails slower but faster happy path
    const stationID = `${operator.code}-${stationCode}`
    const [
      checkStationResult,
      transfers
    ] = await Promise.allSettled([
      stationRepository.checkIfExists(stationID),
      stationRepository.getTransfersFromStationId(stationID)
    ])

    if (checkStationResult.status === 'rejected' || transfers.status === 'rejected') return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'))

    if (!checkStationResult.value.exists || checkStationResult.value.station === null) return c.json(NotFound('UNKNOWN_STATION', `Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

    // Cache the result even when it's empty. A station having no transfers is a
    // stable topological fact, so re-running both D1 queries on every request is
    // wasted work; without caching here, no-transfer stations never get a KV hit.
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, transfers.value)
    )

    return c.json(
      Ok(transfers.value),
      200
    )
  }
)

export default app
