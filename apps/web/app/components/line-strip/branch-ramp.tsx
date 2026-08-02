import { ArrowBendDownRightIcon } from '@phosphor-icons/react'
import type { LineDetailSegment } from '@commute/schemas'
import { getTintFromColor } from 'utils/colors'
import { GUTTER_CLASS, RAIL_CENTER_PX, RAIL_WIDTH_PX } from './station-row'

interface BranchRampProps {
  segment: LineDetailSegment // the INACTIVE tail at this junction
  color: string
  onActivate: () => void
}

// JR-East N'EX behavior: the ramp is the direction NOT currently rendered
// inline. The rail peels off to a "arah {terminus}" pill; tapping it swaps
// the strip's mainline to run through this branch instead (and the previous
// mainline becomes the ramp).
export default function BranchRamp({ segment, color, onActivate }: BranchRampProps) {
  const terminus = segment.stations[segment.stations.length - 1]
  if (!terminus) return null

  return (
    <div className={`relative grid ${GUTTER_CLASS}`}>
      {/* Mainline rail continues behind the ramp. */}
      <div className="relative">
        <span
          className="absolute inset-y-0"
          style={{ backgroundColor: color, width: RAIL_WIDTH_PX, left: RAIL_CENTER_PX - RAIL_WIDTH_PX / 2 }}
        />
      </div>
      <div className="py-1 pl-3">
        {/* Quarter-turn curve peeling off the mainline into the pill. */}
        <div className="relative">
          <span
            className="absolute rounded-bl-2xl"
            style={{
              left: -(56 - (RAIL_CENTER_PX - RAIL_WIDTH_PX / 2)),
              top: -6,
              width: 44,
              height: 28,
              borderLeft: `${RAIL_WIDTH_PX}px solid ${color}`,
              borderBottom: `${RAIL_WIDTH_PX}px solid ${color}`
            }}
            aria-hidden
          />
          <button
            type="button"
            onClick={onActivate}
            className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-slate-900 cursor-pointer"
            style={{ backgroundColor: getTintFromColor(color, 0.15) }}
            aria-label={`Tampilkan rute arah ${terminus.name}`}
          >
            <ArrowBendDownRightIcon weight="bold" className="w-3.5 h-3.5" />
            {`arah ${terminus.name}`}
          </button>
        </div>
      </div>
    </div>
  )
}
