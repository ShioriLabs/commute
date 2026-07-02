import { Link } from 'react-router'
import type { LineDetailStation } from 'models/line'
import { getForegroundColor } from 'utils/colors'

export type NodeKind = 'TERMINUS' | 'REGULAR' | 'INTERCHANGE' | 'JUNCTION'
export type RowSide = 'SINGLE' | 'LEFT' | 'RIGHT'

interface StationRowProps {
  station: LineDetailStation
  operator: string
  color: string
  nodeKind: NodeKind
  // First/last row of a rail run: the rail bar only spans half the row so it
  // caps at the node instead of bleeding past the strip.
  railCap?: 'START' | 'END'
  side?: RowSide
  compact?: boolean
}

// Rail geometry (px, CSS): the rail is a 6px bar whose centerline sits at
// RAIL_CENTER within the row's leading gutter. The loop ring in
// loop-section.tsx aligns its borders to the same centerline.
export const RAIL_CENTER_PX = 22
export const RAIL_WIDTH_PX = 6
export const GUTTER_CLASS = 'grid-cols-[2.75rem_1fr]' // 44px gutter

// 'C13' -> { prefix: 'C', num: '13' }; 'b23' -> { prefix: 'b', num: '23' }.
function splitStationNumber(stationNumber: string): { prefix: string, num: string } {
  const match = stationNumber.match(/^([A-Za-z]+)(.*)$/)
  if (!match || !match[2]) return { prefix: '', num: stationNumber }
  return { prefix: match[1], num: match[2] }
}

// The node is a true circle riding the rail, FDTJ-map style: the line letter
// stacked over the station number. Outlined (white core, colored ring) for
// regular/interchange stops; filled with the line color for the structural
// anchors (termini and branch junctions).
function Node({ kind, color, stationNumber, compact }: {
  kind: NodeKind
  color: string
  stationNumber: string
  compact?: boolean
}) {
  const { prefix, num } = splitStationNumber(stationNumber)
  const filled = kind === 'TERMINUS' || kind === 'JUNCTION'
  const size = 'w-8 h-8'
  const text = filled && getForegroundColor(color) === 'LIGHT' ? 'text-white' : 'text-slate-900'
  return (
    <span
      className={`flex flex-col items-center justify-center rounded-full font-bold tabular-nums leading-none ${size} ${text} ${filled ? 'shadow-sm' : `bg-white border-4 ${kind === 'INTERCHANGE' ? 'shadow-sm' : ''}`}`}
      style={filled ? { backgroundColor: color } : { borderColor: color }}
    >
      {prefix && <span className={compact ? 'text-[7px]' : 'text-[8px]'}>{prefix}</span>}
      <span className={compact ? 'text-[10px]' : 'text-[11px]'}>{num}</span>
    </span>
  )
}

export default function StationRow({
  station,
  operator,
  color,
  nodeKind,
  railCap,
  side = 'SINGLE',
  compact = false
}: StationRowProps) {
  const badges = station.otherLines.length > 0 && (
    <ul className={`relative z-10 flex flex-wrap gap-1 ${side === 'RIGHT' ? 'justify-end' : ''}`}>
      {station.otherLines.map(line => (
        <li key={line.lineCode}>
          <Link
            to={`/lines/${operator}/${line.lineCode}`}
            className={`block rounded-full font-semibold ${compact ? 'px-1.5 text-[10px]' : 'px-2.5 text-sm'} ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
            style={{ backgroundColor: line.colorCode }}
            aria-label={`Lihat ${line.name}`}
          >
            {compact ? line.lineCode : line.name.replace(/Lin /g, '')}
          </Link>
        </li>
      ))}
    </ul>
  )

  const content = (
    // pl-3 on single-rail rows: wide code pills (TP01, C11a) extend past the
    // gutter; keep a visible gap before the name.
    <div className={`flex flex-col gap-1 ${compact ? 'py-2' : 'py-3'} ${side === 'RIGHT' ? 'items-end text-right' : ''} ${side === 'SINGLE' ? 'pl-3' : ''}`}>
      <span className={`min-w-0 truncate ${nodeKind === 'INTERCHANGE' || nodeKind === 'JUNCTION' ? 'font-bold' : 'font-semibold'} ${compact ? 'text-sm' : 'text-base'}`}>
        {station.name}
      </span>
      {badges}
    </div>
  )

  const stretchedLink = (
    <Link
      to={`/stations/${operator}/${station.code}`}
      className="absolute inset-0 z-0 rounded-lg"
      aria-label={station.name}
    />
  )

  if (side === 'LEFT' || side === 'RIGHT') {
    // Loop cell: the ring (drawn by loop-section) provides the rail; the node
    // pins onto the ring border just outside this cell's edge.
    const nodeStyle = side === 'LEFT'
      ? { left: '-3px', top: '50%', transform: 'translate(-50%, -50%)' }
      : { right: '-3px', top: '50%', transform: 'translate(50%, -50%)' }
    return (
      // Wider leading padding than the linear rows: the code pill straddles
      // the ring border and extends ~a pill-half inward over the cell.
      <div className={`relative ${side === 'LEFT' ? 'pl-7 pr-1' : 'pr-7 pl-1'}`}>
        {stretchedLink}
        <span className="absolute z-10" style={nodeStyle}>
          <Node kind={nodeKind} color={color} stationNumber={station.stationNumber} compact={compact} />
        </span>
        {content}
      </div>
    )
  }

  return (
    <div className={`relative grid ${GUTTER_CLASS}`}>
      {stretchedLink}
      <div className="relative">
        <span
          className="absolute"
          style={{
            backgroundColor: color,
            width: RAIL_WIDTH_PX,
            left: RAIL_CENTER_PX - RAIL_WIDTH_PX / 2,
            top: railCap === 'START' ? '50%' : 0,
            bottom: railCap === 'END' ? '50%' : 0,
            // Round only the strip's outer ends; middle segments stay square
            // so consecutive rows read as one continuous rail.
            borderRadius: railCap === 'START'
              ? '9999px 9999px 0 0'
              : railCap === 'END' ? '0 0 9999px 9999px' : 0
          }}
        />
        <span
          className="absolute z-10"
          style={{ left: RAIL_CENTER_PX, top: '50%', transform: 'translate(-50%, -50%)' }}
        >
          <Node kind={nodeKind} color={color} stationNumber={station.stationNumber} compact={compact} />
        </span>
      </div>
      {content}
    </div>
  )
}
