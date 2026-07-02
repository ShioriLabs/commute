import type { LineDetailSegment, LineDetailStation } from 'models/line'
import StationRow, { RAIL_CENTER_PX, RAIL_WIDTH_PX } from './station-row'

interface LoopSectionProps {
  segment: LineDetailSegment // kind LOOP, joins/closes at the junction above
  operator: string
  color: string
}

// Fold the loop into two rails, JR-East style: the first half runs down the
// left rail, the second half runs back UP the right rail (reversed), so
// path-adjacent stations stay visually adjacent across the bottom U-bend.
// Returns 1-based grid rows; row 1 on the right is left empty (plain rail
// leading into the closure at the top).
export function foldLoop(stations: LineDetailStation[]) {
  const leftCount = Math.ceil(stations.length / 2)
  const left = stations.slice(0, leftCount).map((station, i) => ({ station, row: i + 1 }))
  const right = stations.slice(leftCount).map((station, i) => ({
    station,
    row: leftCount - i // path index j = leftCount + i -> row 2*leftCount - j
  }))
  return { left, right, rows: leftCount }
}

// The ring: one bordered div. The top-LEFT corner is square so the trunk's
// rail (whose centerline is RAIL_CENTER_PX) flows straight into the ring's
// left border; the other corners are rounded (the top border is the actual
// JNG closure, the bottom border is the U-bend).
export default function LoopSection({ segment, operator, color }: LoopSectionProps) {
  const { left, right } = foldLoop(segment.stations)
  const ringInset = RAIL_CENTER_PX - RAIL_WIDTH_PX / 2

  return (
    <div className="relative">
      <div
        className="absolute inset-y-0"
        style={{
          left: ringInset,
          right: ringInset,
          border: `${RAIL_WIDTH_PX}px solid ${color}`,
          borderRadius: '0 24px 24px 24px'
        }}
        aria-hidden
      />
      <div
        className="relative grid grid-cols-2 py-5"
        style={{ marginLeft: ringInset + RAIL_WIDTH_PX, marginRight: ringInset + RAIL_WIDTH_PX }}
      >
        {left.map(({ station, row }) => (
          <div key={station.id} style={{ gridColumn: 1, gridRow: row }}>
            <StationRow
              station={station}
              operator={operator}
              color={color}
              nodeKind={station.isInterchange ? 'INTERCHANGE' : 'REGULAR'}
              side="LEFT"
              compact
            />
          </div>
        ))}
        {right.map(({ station, row }) => (
          <div key={station.id} style={{ gridColumn: 2, gridRow: row }}>
            <StationRow
              station={station}
              operator={operator}
              color={color}
              nodeKind={station.isInterchange ? 'INTERCHANGE' : 'REGULAR'}
              side="RIGHT"
              compact
            />
          </div>
        ))}
      </div>
    </div>
  )
}
