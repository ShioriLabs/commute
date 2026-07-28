import * as v from 'valibot'
import { LineSchema, OperatorSchema } from './common'

const LineStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-AC'] })),
    code: v.string(),
    name: v.pipe(v.string(), v.description('Display name — `formattedName` where set, otherwise `name`.')),
    stationNumber: v.pipe(
      v.string(),
      v.description('Position label along the line, e.g. `C13`.'),
      v.metadata({ examples: ['C13'] })
    ),
    isInterchange: v.boolean(),
    otherLines: v.pipe(
      v.array(LineSchema),
      v.description('Other lines of the SAME operator calling here; the current line is excluded. Cross-operator connections live on the station\'s transfers.')
    ),
    distanceFromOriginM: v.pipe(
      v.nullable(v.number()),
      v.description('Cumulative metres from the line origin, where known.')
    )
  }),
  v.title('LineStation')
)

const LineSegmentSchema = v.pipe(
  v.object({
    kind: v.pipe(
      v.picklist(['TRUNK', 'CONTINUATION', 'RAMP', 'LOOP']),
      v.description('`TRUNK` — the main path. `CONTINUATION` — a branch extending the trunk that reads as the mainline. `RAMP` — a side branch forking off. `LOOP` — a branch closing back onto the trunk.'),
      v.metadata({ examples: ['TRUNK'] })
    ),
    joinsAtCode: v.pipe(
      v.nullable(v.string()),
      v.description('Station code where this branch leaves the trunk; null for `TRUNK`.')
    ),
    closesAtCode: v.pipe(
      v.nullable(v.string()),
      v.description('Station code where the branch rejoins; set only for `LOOP`.')
    ),
    stations: v.array(LineStationSchema)
  }),
  v.title('LineSegment')
)

export const LineDetailSchema = v.pipe(
  v.object({
    operator: OperatorSchema,
    line: LineSchema,
    segments: v.pipe(
      v.array(LineSegmentSchema),
      v.description('The line\'s ordered structure. A simple line is one `TRUNK`; branching lines add further segments.')
    )
  }),
  v.title('LineDetail')
)

export const OperatorWithLinesSchema = v.pipe(
  v.object({
    code: OperatorSchema.entries.code,
    name: v.string(),
    lines: v.array(LineSchema)
  }),
  v.title('OperatorWithLines')
)
