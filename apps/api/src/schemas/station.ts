import * as v from 'valibot'
import { AmenitySchema, LineSchema, OperatorSchema, RegionCodeSchema } from './common'

export const StationSchema = v.pipe(
  v.object({
    id: v.pipe(
      v.string(),
      v.description('Stable identifier, `{operatorCode}-{stationCode}`. Use this for fare lookups.'),
      v.metadata({ examples: ['KCI-AC'] })
    ),
    name: v.pipe(
      v.string(),
      v.description('Name as the operator publishes it, often uppercase.'),
      v.metadata({ examples: ['ANCOL'] })
    ),
    formattedName: v.pipe(
      v.nullable(v.string()),
      v.description('Display-ready name. Prefer this over `name`, falling back to it when null.'),
      v.metadata({ examples: ['Ancol'] })
    ),
    code: v.pipe(
      v.string(),
      v.description('Operator-scoped station code — unique per operator, not globally.'),
      v.metadata({ examples: ['AC'] })
    ),
    region: v.pipe(v.string(), v.metadata({ examples: ['Jabodetabek'] })),
    regionCode: RegionCodeSchema,
    operator: OperatorSchema,
    lines: v.pipe(
      v.array(LineSchema),
      v.description('Lines calling at this station. Empty for stations that exist only in the topology.')
    ),
    amenities: v.array(AmenitySchema),
    latitude: v.pipe(
      v.nullable(v.number()),
      v.description('WGS84 latitude; null where coordinates have not been surveyed.'),
      v.metadata({ examples: [-6.128] })
    ),
    longitude: v.pipe(
      v.nullable(v.number()),
      v.metadata({ examples: [106.8451] })
    ),
    score: v.pipe(
      v.number(),
      v.description('Relative popularity, used to rank search results. Higher is more prominent.')
    ),
    searchable: v.pipe(
      v.boolean(),
      v.description('False for topology-only stops that exist for routing but are hidden from search. Always true in list responses, which filter them out.')
    ),
    timetableSynced: v.pipe(
      v.number(),
      v.description('1 when a timetable has been imported for this station, 0 otherwise.')
    ),
    createdAt: v.string(),
    updatedAt: v.string()
  }),
  v.title('Station')
)

export const TransferSchema = v.pipe(
  v.object({
    id: v.string(),
    dataType: v.pipe(
      v.string(),
      v.description('`INTERNAL` for transfers inside one paid area; `EXTERNAL` when the rider exits and re-taps.'),
      v.metadata({ examples: ['EXTERNAL'] })
    ),
    toStation: v.object({
      stationId: v.pipe(v.string(), v.metadata({ examples: ['MRTJ-DKA'] })),
      name: v.string(),
      operatorName: v.string(),
      lines: v.array(LineSchema)
    }),
    distance: v.pipe(
      v.number(),
      v.description('Walking distance in metres.'),
      v.metadata({ examples: [200] })
    ),
    notes: v.string()
  }),
  v.title('Transfer')
)

export const ScheduleSchema = v.pipe(
  v.object({
    id: v.string(),
    stationId: v.pipe(v.string(), v.metadata({ examples: ['KCI-AC'] })),
    tripNumber: v.pipe(v.string(), v.description('Operator\'s trip/service number.'), v.metadata({ examples: ['1151'] })),
    estimatedDeparture: v.pipe(v.string(), v.description('Local time, `HH:MM:SS`.'), v.metadata({ examples: ['05:42:00'] })),
    estimatedArrival: v.pipe(v.string(), v.metadata({ examples: ['05:41:00'] })),
    boundFor: v.pipe(v.string(), v.description('Terminus this service heads toward.'), v.metadata({ examples: ['JAKARTAKOTA'] })),
    lineCode: v.string(),
    createdAt: v.string(),
    updatedAt: v.string()
  }),
  v.title('Schedule')
)

/*
 * The grouped timetable folds a station's departures into lines, then into
 * directions, then into destinations — the shape the station page renders.
 */
export const GroupedTimetableSchema = v.pipe(
  v.object({
    name: v.string(),
    colorCode: v.string(),
    lineCode: v.string(),
    timetable: v.array(v.object({
      key: v.pipe(v.string(), v.description('Stable key for this direction group.')),
      label: v.pipe(v.array(v.string()), v.description('Human-readable direction labels, e.g. the termini served.')),
      platformCode: v.nullable(v.string()),
      destinations: v.array(v.object({
        boundFor: v.string(),
        via: v.pipe(v.nullable(v.string()), v.description('Set when two services to the same terminus take different paths.')),
        schedules: v.array(ScheduleSchema)
      }))
    }))
  }),
  v.title('GroupedTimetable')
)
