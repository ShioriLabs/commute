import { Fragment, useState } from 'react'
import type { LineDetail } from 'models/line'
import StationRow, { type NodeKind } from './station-row'
import BranchRamp from './branch-ramp'
import LoopSection from './loop-section'

interface LineStripProps {
  detail: LineDetail
}

// NOTE: holds per-line view state (active branch) — mount with
// key={operator+lineCode} so navigating between lines resets it.
export default function LineStrip({ detail }: LineStripProps) {
  // Which tail (branch after the junction) is rendered inline as the
  // mainline. Default 0 = the CONTINUATION (e.g. Bogor); tapping a ramp pill
  // swaps that branch in (JR-East N'EX behavior).
  const [activeTailIndex, setActiveTailIndex] = useState(0)

  const color = detail.line.colorCode
  const operator = detail.operator.code

  const trunk = detail.segments.find(s => s.kind === 'TRUNK')
  const loop = detail.segments.find(s => s.kind === 'LOOP')
  if (!trunk || trunk.stations.length === 0) return null

  // Lollipop (Cikarang): the trunk is the stick, whose last station is the
  // junction the loop hangs off.
  if (loop) {
    const stick = trunk.stations
    return (
      // `isolate`: the strip's internal z-indexes (nodes, badges over the
      // stretched row links) stay contained so they never paint above the
      // page's sticky header.
      <div className="max-w-md mx-auto w-full isolate">
        {stick.map((station, i) => (
          <StationRow
            key={station.id}
            station={station}
            operator={operator}
            color={color}
            nodeKind={i === 0
              ? 'TERMINUS'
              : i === stick.length - 1
                ? 'JUNCTION'
                : station.isInterchange ? 'INTERCHANGE' : 'REGULAR'}
            // END-cap the junction row: the loop's svg stroke takes over at
            // the node's center, and the handoff hides behind the opaque
            // junction node (div rails and svg strokes pixel-snap
            // differently, so they must never both be visible).
            railCap={i === 0 ? 'START' : i === stick.length - 1 ? 'END' : undefined}
          />
        ))}
        <LoopSection segment={loop} operator={operator} color={color} />
      </div>
    )
  }

  // Linear line. Tails = branches hanging off the trunk's end (Bogor's
  // continuation toward Bogor + the Nambo ramp). Exactly one renders inline
  // as the mainline; the others peel off as tappable ramp pills that swap
  // the view.
  const trunkEndCode = trunk.stations[trunk.stations.length - 1].code
  const tails = detail.segments.filter(s =>
    (s.kind === 'CONTINUATION' || s.kind === 'RAMP') && s.joinsAtCode === trunkEndCode
  )
  const activeTail = tails.length > 0 ? tails[Math.min(activeTailIndex, tails.length - 1)] : null
  const main = activeTail ? [...trunk.stations, ...activeTail.stations] : trunk.stations
  const junctionCode = tails.length > 1 ? trunkEndCode : null

  const nodeKindFor = (index: number): NodeKind => {
    const station = main[index]
    if (station.code === junctionCode) return 'JUNCTION'
    if (index === 0 || index === main.length - 1) return 'TERMINUS'
    return station.isInterchange ? 'INTERCHANGE' : 'REGULAR'
  }

  return (
    // `isolate`: see the loop branch above.
    <div className="max-w-md mx-auto w-full isolate">
      {main.map((station, i) => (
        <Fragment key={station.id}>
          <StationRow
            station={station}
            operator={operator}
            color={color}
            nodeKind={nodeKindFor(i)}
            railCap={i === 0 ? 'START' : i === main.length - 1 ? 'END' : undefined}
          />
          {station.code === junctionCode && tails.map((tail, tailIndex) => (
            tail !== activeTail && (
              <BranchRamp
                key={tail.stations[0]?.id ?? tailIndex}
                segment={tail}
                color={color}
                onActivate={() => setActiveTailIndex(tailIndex)}
              />
            )
          ))}
        </Fragment>
      ))}
    </div>
  )
}
