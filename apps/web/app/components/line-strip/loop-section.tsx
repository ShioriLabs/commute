import { useLayoutEffect, useRef, useState } from 'react'
import type { LineDetailSegment, LineDetailStation } from '@commute/schemas'
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

const RING_RADIUS_PX = 24
const JUNCTION_CURVE_PX = 16 // matches the branch-ramp curve (rounded-bl-2xl)
// The stroke rises to the junction node's center (node = row center, one
// standard row = 48px, so center is 24px above this section). The junction
// row's rail is END-capped at the same point, and the node is opaque, so the
// div-rail → svg-stroke handoff is never visible (the two technologies
// pixel-snap differently and would show a jog if they met in the open).
const JUNCTION_RISE_PX = 24

// The whole ring is ONE svg path stroke (measured to the section's size):
// down the left rail, around the bottom U-bend, up the right rail, across
// the closure bar, then the quarter-turn peeling UP off the trunk rail
// toward the JNG node (branch-ramp visual language). A single paint target
// has no internal joints, so nothing can pixel-snap apart on fractional
// zoom/DPR/viewport offsets — the only cross-element contact is the stroke
// overlapping the trunk row's rail div along a straight blue-on-blue run.
function ringPath(w: number, h: number) {
  const half = RAIL_WIDTH_PX / 2
  const lx = RAIL_CENTER_PX // left rail centerline
  const rx = w - RAIL_CENTER_PX // right rail centerline
  const by = h - half // bottom U-bend centerline
  const ty = half // closure bar centerline
  const r = RING_RADIUS_PX - half
  const jr = JUNCTION_CURVE_PX - half
  return [
    `M ${lx} ${-JUNCTION_RISE_PX}`,
    `V ${by - r}`,
    `A ${r} ${r} 0 0 0 ${lx + r} ${by}`,
    `H ${rx - r}`,
    `A ${r} ${r} 0 0 0 ${rx} ${by - r}`,
    `V ${ty + r}`,
    `A ${r} ${r} 0 0 0 ${rx - r} ${ty}`,
    `H ${lx + jr}`,
    `A ${jr} ${jr} 0 0 1 ${lx} ${ty - jr}`
  ].join(' ')
}

export default function LoopSection({ segment, operator, color }: LoopSectionProps) {
  const { left, right } = foldLoop(segment.stations)
  const ringInset = RAIL_CENTER_PX - RAIL_WIDTH_PX / 2
  const sectionRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number, h: number } | null>(null)

  useLayoutEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={sectionRef} className="relative">
      {size && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ overflow: 'visible' }}
          aria-hidden
        >
          <path d={ringPath(size.w, size.h)} fill="none" stroke={color} strokeWidth={RAIL_WIDTH_PX} />
        </svg>
      )}
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
