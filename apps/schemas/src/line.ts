import * as v from 'valibot'
import type { HexColored } from './common'
import { LineKeySchema, LineSchema, OperatorCodeSchema, OperatorSchema } from './common'

export const LineStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-AC'] })),
    code: v.string(),
    name: v.pipe(v.string(), v.description('Display name.')),
    stationNumber: v.pipe(
      v.string(),
      v.description('Position label along the line, e.g. `C13`.'),
      v.metadata({ examples: ['C13'] })
    ),
    isInterchange: v.boolean(),
    otherLines: v.pipe(
      v.array(LineKeySchema),
      v.description('Other lines of the SAME operator calling here, as line keys; the current line is excluded. Cross-operator connections live on the station\'s transfers.')
    )
  }),
  v.title('LineStation')
)

export const LineSegmentSchema = v.pipe(
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
    stations: v.array(LineStationSchema)
  }),
  v.title('LineSegment')
)

export const LineDetailSchema = v.pipe(
  v.object({
    operator: OperatorSchema,
    // The line itself is spelled out rather than keyed: this response IS the
    // line, so making the reader resolve a key would be perverse.
    line: LineSchema,
    segments: v.pipe(
      v.array(LineSegmentSchema),
      v.description('The line\'s ordered structure. A simple line is one `TRUNK`; branching lines add further segments.')
    )
  }),
  v.title('LineDetail')
)

/*
 * The line dictionary. Everything else in the API refers to lines by key
 * (`KCI:C`); this is where those keys resolve to a name and colour, so the full
 * Line objects belong here.
 */
export const OperatorWithLinesSchema = v.pipe(
  v.object({
    code: OperatorCodeSchema,
    name: v.string(),
    lines: v.array(LineSchema)
  }),
  v.title('OperatorWithLines')
)

export type LineStation = v.InferOutput<typeof LineStationSchema>
export type LineSegment = v.InferOutput<typeof LineSegmentSchema>
export type LineSegmentKind = LineSegment['kind']
export type LineDetail = HexColored<v.InferOutput<typeof LineDetailSchema>>
export type OperatorWithLines = HexColored<v.InferOutput<typeof OperatorWithLinesSchema>>

/*
 * Aliases matching the names the web app has always used for these shapes.
 * Kept so the migration to this package didn't have to rename call sites.
 */
export type LineDetailStation = LineStation
export type LineDetailSegment = LineSegment
