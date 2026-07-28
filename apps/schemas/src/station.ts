import * as v from 'valibot'
import type { HexColored } from './common'
import { AmenitySchema, LineKeySchema, OperatorCodeSchema, RegionCodeSchema } from './common'

const stationIdentity = {
  id: v.pipe(
    v.string(),
    v.description('Stable identifier, `{operatorCode}-{stationCode}`. Use this for fare lookups.'),
    v.metadata({ examples: ['KCI-SUDB'] })
  ),
  name: v.pipe(
    v.string(),
    v.description('Display name — what to show a rider.'),
    v.metadata({ examples: ['BNI City'] })
  ),
  officialName: v.pipe(
    v.string(),
    v.description('The operator\'s own spelling, which often differs in substance rather than just casing — KCI still publishes "SUDIRMAN BARU" for the station displayed as "BNI City". Worth indexing as a search alias: it is how many riders still refer to these stations.'),
    v.metadata({ examples: ['SUDIRMAN BARU'] })
  ),
  code: v.pipe(
    v.string(),
    v.description('Operator-scoped station code — unique per operator, not globally.'),
    v.metadata({ examples: ['SUDB'] })
  ),
  operator: OperatorCodeSchema,
  lines: v.pipe(
    v.array(LineKeySchema),
    v.description('Lines calling at this station, as keys into the line dictionary from `/operators`. Empty for stations that exist only in the topology.')
  )
}

export const StationSchema = v.pipe(
  v.object({
    ...stationIdentity,
    regionCode: RegionCodeSchema,
    amenities: v.array(AmenitySchema),
    latitude: v.pipe(
      v.nullable(v.number()),
      v.description('WGS84 latitude; null where coordinates have not been surveyed.'),
      v.metadata({ examples: [-6.2015] })
    ),
    longitude: v.pipe(
      v.nullable(v.number()),
      v.metadata({ examples: [106.8196] })
    ),
    score: v.pipe(
      v.number(),
      v.description('Relative popularity, used to rank search results. Higher is more prominent.')
    ),
    searchable: v.pipe(
      v.boolean(),
      v.description('False for topology-only stops that exist for routing but are hidden from search. Always true in list responses, which filter them out.')
    )
  }),
  v.title('Station')
)

/*
 * A station as referenced from another resource — a hub's members, a transfer's
 * destination. Enough to render and link; fetch the station itself for detail.
 */
export const StationRefSchema = v.pipe(
  v.object(stationIdentity),
  v.title('StationRef')
)

/*
 * Transfers are a discriminated union on `dataType`: an INTERNAL transfer points
 * at a station this API knows, so it carries the full reference; an EXTERNAL one
 * leads off-network and has only a name and an operator.
 */
const TransferBaseEntries = {
  id: v.string(),
  // `distanceM`, matching FareLeg.distanceM and FareResult.totalDistanceM — one
  // spelling for distance across the whole API.
  distanceM: v.pipe(
    v.number(),
    v.description('Walking distance in metres.'),
    v.metadata({ examples: [90] })
  ),
  // Null far more often than not — 13 of 15 sampled from production.
  notes: v.pipe(
    v.nullable(v.string()),
    v.description('Free-text guidance for the walk; null when there is nothing to add.')
  )
}

export const InternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('INTERNAL'),
    toStation: StationRefSchema
  }),
  v.title('InternalTransfer'),
  v.description('A connection to another station in this API. `toStation` is a full station reference.')
)

export const ExternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('EXTERNAL'),
    toStation: v.object({
      name: v.string(),
      operatorName: v.pipe(
        v.string(),
        v.description('Free-text operator name — an external service has no operator code in this API.')
      )
    })
  }),
  v.title('ExternalTransfer'),
  v.description('A connection to a service outside this API — no station id or lines, just a name.')
)

export const TransferSchema = v.pipe(
  v.variant('dataType', [InternalTransferSchema, ExternalTransferSchema]),
  v.title('Transfer'),
  v.description('Discriminated on `dataType`. Current data is all INTERNAL; the EXTERNAL branch exists for off-network connections.')
)

/*
 * A single scheduled departure. The row's own id, its station id and the
 * timestamps are gone: a schedule is always read in the context of the station
 * and line that own it, so repeating them was noise.
 */
export const ScheduleSchema = v.pipe(
  v.object({
    tripNumber: v.pipe(
      v.nullable(v.string()),
      v.description('Operator\'s trip/service number; null for operators that don\'t publish one.'),
      v.metadata({ examples: ['5198B'] })
    ),
    estimatedDeparture: v.pipe(v.string(), v.description('Local time, `HH:MM:SS`.'), v.metadata({ examples: ['00:05:30'] })),
    boundFor: v.pipe(v.string(), v.description('Terminus this service heads toward.'), v.metadata({ examples: ['Cikarang'] })),
    lineCode: v.string()
  }),
  v.title('Schedule')
)

/*
 * Wire-optimised departure used when `?compact=1` is set: a two-element tuple of
 * the trip number (null where the operator publishes none) and minutes since
 * local Asia/Jakarta midnight, 0–1439. Shaves a large timetable down
 * considerably versus the full Schedule object.
 */
export const CompactScheduleSchema = v.pipe(
  /*
   * Modelled as a 2-element union array rather than v.tuple. The tuple would be
   * the honest shape, but @valibot/to-json-schema emits draft-07 tuple syntax
   * (`items: [...]`) for it, and hono-openapi calls the converter with no
   * options — so the `draft-2020-12` target that would emit `prefixItems` never
   * reaches it. Draft-07 tuple syntax is invalid under OpenAPI 3.1 and fails
   * spec validation. The TypeScript type below restores the real tuple.
   */
  v.pipe(
    v.array(v.union([v.nullable(v.string()), v.number()])),
    v.length(2)
  ),
  v.title('CompactSchedule'),
  v.description('`[tripNumber, minutesSinceMidnight]`. Trip number is null where the operator publishes none; minutes are local Asia/Jakarta time, 0–1439.'),
  v.metadata({ examples: [['5198B', 5]] })
)

const directionGroup = <T extends v.GenericSchema>(schedules: T, title: string) => v.pipe(
  v.object({
    key: v.pipe(v.string(), v.description('Stable key for this direction group.')),
    label: v.pipe(v.array(v.string()), v.description('Direction labels — station display names; join with " / " to render.')),
    platformCode: v.pipe(
      v.nullable(v.string()),
      v.description('Curated platform overlay; null where the platform is unknown.')
    ),
    destinations: v.array(v.object({
      boundFor: v.string(),
      via: v.pipe(
        v.nullable(v.string()),
        v.description('Set when two services to the same terminus take different paths.')
      ),
      schedules: v.array(schedules)
    }))
  }),
  v.title(title)
)

/*
 * The grouped timetable folds a station's departures into lines, then into
 * directions, then into destinations — the shape a departure board renders.
 */
export const GroupedTimetableSchema = v.pipe(
  v.object({
    line: v.pipe(LineKeySchema, v.description('The line these departures belong to.')),
    timetable: v.array(directionGroup(ScheduleSchema, 'TimetableDirectionGroup'))
  }),
  v.title('GroupedTimetable')
)

/** The `?compact=1` variant: identical structure, tuple schedules. */
export const CompactGroupedTimetableSchema = v.pipe(
  v.object({
    line: v.pipe(LineKeySchema, v.description('The line these departures belong to.')),
    timetable: v.array(directionGroup(CompactScheduleSchema, 'CompactTimetableDirectionGroup'))
  }),
  v.title('CompactGroupedTimetable')
)

/*
 * Pre-direction-group response entry. No longer served, but still reachable from
 * stale service-worker caches, so the web app keeps normalising it into a
 * direction group.
 */
export const LegacyTimetableEntrySchema = v.pipe(
  v.object({
    boundFor: v.string(),
    via: v.nullable(v.string()),
    schedules: v.union([v.array(ScheduleSchema), v.array(CompactScheduleSchema)])
  }),
  v.title('LegacyTimetableEntry')
)

export type Station = v.InferOutput<typeof StationSchema>
export type StationRef = v.InferOutput<typeof StationRefSchema>
export type Transfer = v.InferOutput<typeof TransferSchema>
export type InternalTransfer = v.InferOutput<typeof InternalTransferSchema>
export type ExternalTransfer = v.InferOutput<typeof ExternalTransferSchema>
export type Schedule = v.InferOutput<typeof ScheduleSchema>
/*
 * The real shape. The schema above widens to `(string | null | number)[]` for
 * the OpenAPI-compat reason documented there; consumers get the precise tuple.
 */
export type CompactSchedule = [tripNumber: string | null, minute: number]
export type GroupedTimetable = v.InferOutput<typeof GroupedTimetableSchema>
/*
 * `schedules` is re-typed to the real CompactSchedule tuple: the schema widens
 * it for OpenAPI-compat reasons (see CompactScheduleSchema), which would
 * otherwise leak `(string | number | null)[]` into every consumer.
 */
type RawCompactGroupedTimetable = HexColored<v.InferOutput<typeof CompactGroupedTimetableSchema>>
export type CompactGroupedTimetable = Omit<RawCompactGroupedTimetable, 'timetable'> & {
  timetable: (Omit<RawCompactGroupedTimetable['timetable'][number], 'destinations'> & {
    destinations: (Omit<RawCompactGroupedTimetable['timetable'][number]['destinations'][number], 'schedules'> & {
      schedules: CompactSchedule[]
    })[]
  })[]
}
export type LegacyTimetableEntry = v.InferOutput<typeof LegacyTimetableEntrySchema>
export type TimetableDirectionGroup = GroupedTimetable['timetable'][number]
export type CompactTimetableDirectionGroup = CompactGroupedTimetable['timetable'][number]
export type TimetableDestination = TimetableDirectionGroup['destinations'][number]
export type CompactTimetableDestination = CompactTimetableDirectionGroup['destinations'][number]
export type LineGroupedTimetable = GroupedTimetable[]
export type CompactLineGroupedTimetable = CompactGroupedTimetable[]

/* Aliases matching the web app's long-standing names. */
export type LineTimetable = GroupedTimetable
export type CompactLineTimetable = CompactGroupedTimetable
