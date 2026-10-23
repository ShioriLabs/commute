import type { FareJourney, FareResult, FareResultLeg, FareResultRideLeg, FareResultTransferLeg, TripResult } from '@commute/schemas'
import { OPERATORS, type Operator } from '@commute/constants'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, PersonSimpleWalkIcon, TicketIcon } from '@phosphor-icons/react'
import { formatClock, formatDuration, formatEstimate, formatKm, formatRupiah } from 'utils/format'
import { formatPlatformCode, joinLabels } from 'utils/labels'
import LineRoundel from '~/components/line-roundel'
import TransferIcon from '~/components/transfer-icon'
import { FARE_GUTTER_CLASS, FARE_RAIL_CENTER_PX, interlinedTrackFill, LINE_COLOR_FALLBACK, RAIL_WIDTH_PX } from '~/components/transit-geometry'
import { useClock } from '~/hooks/clock'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import DeparturePicker, { ConnectionNote } from './departure-picker'
import { JOURNEY_LABELS } from './journey-labels'
import { estimatedDurationOf, journeysOf, sortJourneyLabels, walkDistanceOf } from './journeys'
import { changeAt, leaveInLabel, resolveTimedLegs, retimeJourney, type TimedLeg } from './leg-departures'
import { useJourneyPager } from './journey-pager'
import RouteBar from './route-bar'
import { routeBarSegments } from './route-bar-segments'

const operatorName = (code: string) => (OPERATORS as Record<string, { name: string }>)[code as Operator]?.name ?? code

/*
 * A leg's lines, resolved to display identity.
 *
 * Legs carry keys; names and colours live in the dictionary from /operators.
 * On interlined track (the LRT Jabodebek trunk) several service lines run the
 * same leg — any train works, and the primary leads. A leg without
 * `serviceLines` predates the field, so it stands in as its own single service.
 *
 * One resolver for the whole card: the timeline and the route bar were reading
 * the same dictionary through two different shapes, which is how they could
 * have come to disagree about a line's colour on one screen.
 */
function useLegLines() {
  const { line: lookupLine } = useLines()
  return (leg: FareResultRideLeg) =>
    (leg.serviceLines ?? [{ line: leg.line, headsign: leg.headsign }]).map(ref => ({
      key: ref.line,
      code: codeOfLineKey(ref.line),
      name: lookupLine(ref.line)?.name ?? codeOfLineKey(ref.line),
      color: lookupLine(ref.line)?.colorCode ?? LINE_COLOR_FALLBACK,
      headsign: ref.headsign
    }))
}

/*
 * The rail running down a timeline row.
 *
 * Absolutely positioned against a declared centerline, the way the line strip
 * draws its own rail — rather than a flex child centered in a gutter, which is
 * what these rows used to do. The difference shows at the joins: a flex rail
 * with its own margins leaves a hairline gap under every node, so an itinerary
 * read as a column of disconnected pieces instead of one continuous line.
 *
 * `cap` stops the bar half way, so the first and last rails of a run terminate
 * at their node instead of bleeding past it.
 */
function Rail({ style, cap, dotted = false }: { style: CSSProperties, cap?: 'START' | 'END', dotted?: boolean }) {
  /*
   * A walk is drawn as dots in its own colour rather than a bar: a bar says
   * "a line runs here", and none does. The dot colour is the bar's, so a caller
   * only says which colour and whether it is a walk. Dots rather than a dashed
   * border so the pitch is the same on every segment and the half-rails either
   * side of a node line up with the walk's own.
   */
  const { backgroundColor, ...rest } = style
  const fill = dotted
    ? {
        backgroundImage: `radial-gradient(circle at 50% 50%, ${backgroundColor} 2px, transparent 2.5px)`,
        backgroundSize: `100% ${WALK_DOT_PITCH_PX}px`,
        /*
         * `space`, not `repeat`: only whole dots are placed, first and last
         * flush with the segment's ends. A plain repeat cut the last dot in
         * half wherever a segment's height was not a multiple of the pitch,
         * and started each segment on its own phase, so two dots crowded
         * together at every join between a walk and the half-rail by a node.
         * Flush ends put a joined pair exactly one pitch apart.
         */
        backgroundRepeat: 'no-repeat space'
      }
    : { backgroundColor }
  return (
    <span
      className="absolute"
      style={{
        width: RAIL_WIDTH_PX,
        left: FARE_RAIL_CENTER_PX - RAIL_WIDTH_PX / 2,
        top: cap === 'START' ? '50%' : 0,
        bottom: cap === 'END' ? '50%' : 0,
        ...fill,
        ...rest
      }}
    />
  )
}

const WALK_DOT_PITCH_PX = 9

/*
 * The walker, on its own walk's rail, over the dots.
 *
 * It sits on the line rather than beside the text because the line is what it
 * describes: this stretch is on foot. A ground-coloured halo lets it interrupt
 * the dots the way a node interrupts a rail.
 */
function WalkMark({ color }: { color: string }) {
  return (
    <span
      className="absolute z-10 rounded-full bg-white p-0.5"
      style={{ left: FARE_RAIL_CENTER_PX, top: '50%', transform: 'translate(-50%, -50%)', color }}
    >
      <PersonSimpleWalkIcon weight="bold" className="w-6 h-6" />
    </span>
  )
}

/** A board or alight node: a white core ringed in the line's colour. */
function Node({ color }: { color: string }) {
  return (
    <span
      className="absolute z-10 w-4 h-4 rounded-full border-[4px] bg-white"
      style={{ borderColor: color, left: FARE_RAIL_CENTER_PX, top: '50%', transform: 'translate(-50%, -50%)' }}
    />
  )
}

/*
 * Where the trip starts or ends on foot.
 *
 * A ride draws its own two dots, but a walk is only a row of text, so a trip
 * that opens with one began at a station the timeline never named: Sudirman to
 * Blok M BCA read as starting at Dukuh Atas BNI, and the station the rider
 * typed was nowhere on it. Slate rather than a line colour, because no line
 * runs here — it is the walk's own rail, given an end.
 */
function EndpointStop({ name, cap }: { name: string, cap: 'START' | 'END' }) {
  return (
    <li className={`relative grid ${FARE_GUTTER_CLASS}`}>
      <div className="relative">
        <Rail style={{ backgroundColor: 'var(--color-slate-400)' }} cap={cap} dotted />
        <Node color="var(--color-slate-400)" />
      </div>
      <b className="text-lg py-0.5">{name}</b>
    </li>
  )
}

/*
 * A stop's line beside the rail: its name (and whatever goes under it) on the
 * left, its time down the right edge. Figures are tabular so the times line up
 * down the ride, as the Android timeline sets them. No time renders nothing —
 * see RideLeg for why absent is never a dash.
 */
function StopLine({ time, padding = 'py-0.5', children }: { time: string | null | undefined, padding?: string, children: ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-3 min-w-0 ${padding}`}>
      <div className="flex flex-col min-w-0">{ children }</div>
      {time ? <span className="figure shrink-0 text-sm font-medium text-slate-500 tabular-nums">{ formatClock(time) }</span> : null}
    </div>
  )
}

// One ride leg: board node, line-colored connector carrying the service card
// (line pill, headsign, expandable intermediate stops), alight node.
/*
 * The walk's rail colour beside a ride, so the two can meet at the node.
 *
 * A ride's own rail starts and stops at its node's centre, and a walk's rail
 * only fills its own row, so the half-row between them was bare and every walk
 * floated free of the dots it joins. The ride draws that half in the walk's
 * colour, because the ride is the one that knows where its node sits.
 */
const walkRailColor = (leg: FareResultLeg | undefined): string | null => {
  if (leg?.type !== 'TRANSFER') return null
  return leg.corridorLabel != null && leg.fare != null ? 'var(--color-rose-400)' : 'var(--color-slate-400)'
}

function RideLeg({ leg, isSameStationTransfer, walkBefore, walkAfter, timed, rideS, changeGap, onPick }: {
  leg: FareResultRideLeg
  isSameStationTransfer: boolean
  walkBefore: string | null
  walkAfter: string | null
  timed: TimedLeg | undefined
  /** Estimated time on board for a TransJakarta leg, from observed run times. */
  rideS: number | null
  /** The change from the train before into this one, for an interchange with no walk leg. */
  changeGap: { gapS: number, tight: boolean } | null
  onPick: (tripId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const legLines = useLegLines()
  // Optional-chained against a stale API during deploy skew.
  const intermediate = leg.stops?.slice(1, -1) ?? []
  /*
   * A bus leg has no times at its ends to read a ride off, so the estimate
   * joins the counts here instead — as a span on board, never a clock.
   */
  const summary = [
    `${leg.stationCount - 1} stasiun`,
    formatKm(leg.distanceM),
    ...(rideS !== null ? [formatEstimate(rideS)] : [])
  ].join(' • ')
  const lines = legLines(leg)
  const isInterlined = lines.length > 1
  const legColor = lines[0]?.color ?? LINE_COLOR_FALLBACK
  const directions = [...new Set(lines.map(line => line.headsign).filter((headsign): headsign is string => headsign !== null))]
  /*
   * Interlined rails were repeating hard stops here while the route bar above
   * blended, so one card drew the same thing two ways. Both now share
   * interlinedTrackFill — which also means all the leg's colours show, where
   * this only ever drew the first and last.
   */
  const railStyle = interlinedTrackFill(lines.map(line => line.color), 'to bottom')

  return (
    <li className="flex flex-col">
      {isSameStationTransfer
        ? (
            <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
              <div className="relative">
                <Rail style={{ backgroundColor: 'var(--color-slate-300)' }} />
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500 py-1.5">
                <TransferIcon mode={leg.operator === OPERATORS.TJ.code ? 'bus' : 'train'} className="w-3.5 h-3.5" />
                <span>{leg.operator === OPERATORS.TJ.code ? 'Pindah bus' : 'Pindah kereta'}</span>
                {changeGap ? <ConnectionNote gapS={changeGap.gapS} tight={changeGap.tight} /> : null}
              </div>
            </div>
          )
        : null}
      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          {walkBefore ? <Rail style={{ backgroundColor: walkBefore }} cap="END" dotted /> : null}
          <Rail style={railStyle} cap="START" />
          <Node color={legColor} />
        </div>
        <StopLine time={leg.departureAt}>
          <b className="text-lg">{leg.from.name}</b>
          {/*
            * Which peron to stand on, where it has been field-verified.
            *
            * Under the boarding station and nowhere else: a platform is where
            * you get on, and the same figure against the alight node would be
            * read as where you get off. Absent for most legs by design — the
            * table is verified entries only, and a wrong peron sends a rider
            * to the wrong trackside — so there is no empty slot and no dash,
            * the label simply is not there. See PLATFORM_CODES.
            *
            * Plain text, as the Android timeline sets it. formatPlatformCode is
            * what tightens the stored "3/4" into the "3·4" the signs use.
            */}
          {leg.platformCode
            ? (
                <span className="text-xs font-medium text-slate-500" aria-label={`Berangkat dari peron ${leg.platformCode}`}>
                  {'Peron '}
                  { formatPlatformCode(leg.platformCode) }
                </span>
              )
            : null}
        </StopLine>
      </div>
      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          <Rail style={railStyle} />
        </div>
        {/* No plate: the rail already says which service this is and where it
            runs, so a filled card around it drew a second box for the same
            fact — and set it competing with the journey plates above, which
            are the things actually being chosen between. */}
        <div className="my-2 flex flex-col gap-1 items-start min-w-0 max-w-full">
          <div className="flex flex-wrap gap-1.5 items-center">
            {/* Each line as the Android timeline names it: its roundel, then its
                name. The roundel carries the rail/corridor grammar (ringed or
                filled) that a bare colour pill used to leave to the text. */}
            {lines.map((line, lineIndex) => (
              <span key={line.code} className="flex items-center gap-2">
                <LineRoundel size="SM" operator={leg.operator} code={line.code} color={line.color as `#${string}`} />
                <b className="text-base">{ line.name }</b>
                {/* Missing this one means no leg tonight, not a later one. */}
                {leg.lastService && lineIndex === 0
                  ? <span className="text-xs font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Terakhir</span>
                  : null}
              </span>
            ))}
          </div>
          {isInterlined
            ? <span className="text-sm font-medium text-slate-600">{leg.operator === OPERATORS.TJ.code ? 'Naik salah satu bus' : 'Naik salah satu kereta'}</span>
            : null}
          {directions.length > 0
            ? (
                <span className="text-sm font-medium text-slate-600">
                  arah
                  {' '}
                  { joinLabels(directions) }
                </span>
              )
            : null}
          {/*
            * The other trains this leg could be ridden on. Choosing one re-times
            * the legs after it — see resolveTimedLegs. Present only where the
            * timetable covers the leg: absent is the honest answer for
            * TransJakarta, so nothing is drawn rather than a dash for a time
            * no one ever published.
            */}
          {timed
            ? <DeparturePicker options={timed.options} color={legColor} onPick={onPick} />
            : null}
          {intermediate.length === 0
            ? <span className="text-sm text-slate-500">{ summary }</span>
            : (
                <button
                  type="button"
                  onClick={() => setExpanded(value => !value)}
                  aria-expanded={expanded}
                  className="flex items-center gap-1 text-sm font-bold text-slate-500 cursor-pointer"
                >
                  { summary }
                  <CaretDownIcon weight="bold" className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
              )}
        </div>
      </div>

      {/*
        * The stops passed through, on the rail rather than beside it.
        *
        * They used to live inside the service card, which gave them a second
        * column of dots running parallel to the line they are actually on —
        * two verticals claiming to be the same journey. Riding the rail, each
        * stop is a node on the line between the two terminals, which is what it
        * is, and matches how the line strip draws the same object.
        */}
      {intermediate.length > 0
        ? (
            <div className={`grid transition-[grid-template-rows] duration-300 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <ul className="overflow-hidden min-h-0">
                {intermediate.map((stop, stopIndex) => (
                  <li key={stop.id} className={`relative grid ${FARE_GUTTER_CLASS}`}>
                    <div className="relative">
                      <Rail style={railStyle} />
                      {/* A tick across the rail, not a hole punched through it:
                          at the rail's own width the gaps read as a dashed
                          line, which says "unknown route", the opposite of a
                          list of every stop it calls at. */}
                      <span
                        className="absolute z-10 rounded-full bg-white"
                        style={{
                          width: RAIL_WIDTH_PX,
                          height: 2,
                          left: FARE_RAIL_CENTER_PX,
                          top: '50%',
                          transform: 'translate(-50%, -50%)'
                        }}
                      />
                    </div>
                    {/* stopTimes is index-aligned with `stops`, and `intermediate`
                        starts one in. Null is a stop with no recorded time. */}
                    <StopLine time={leg.stopTimes?.[stopIndex + 1]} padding="py-1.5">
                      <span className="text-sm font-semibold text-slate-900">{ stop.name }</span>
                    </StopLine>
                  </li>
                ))}
              </ul>
            </div>
          )
        : null}

      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          <Rail style={railStyle} cap="END" />
          {walkAfter ? <Rail style={{ backgroundColor: walkAfter }} cap="START" dotted /> : null}
          <Node color={legColor} />
        </div>
        {/* The step the rider watches the window for: named, with its time. */}
        <StopLine time={leg.arrivalAt}>
          <b className="text-lg">{leg.to.name}</b>
          <span className="w-fit rounded bg-brand px-1.5 py-px text-[11px] font-bold text-white" aria-label="Turun di sini">TURUN</span>
        </StopLine>
      </div>
    </li>
  )
}

// Itinerary timeline: ringed nodes at board/alight stations, line-colored
// connectors carrying the service card, walks as full-width cards that break
// the rail (TfL Go-style).
export function JourneyTimeline({ legs, timed = [], rideS, onPick = () => {} }: {
  legs: FareResultLeg[]
  /** Timed ride legs with their options. Omit for a journey with no picker. */
  timed?: TimedLeg[]
  /** The journey's `estimate.rideS`, aligned with `legs`. */
  rideS?: (number | null)[]
  onPick?: (legIndex: number, tripId: string) => void
}) {
  const first = legs[0]
  const last = legs.at(-1)
  const changeGapAt = (index: number) => changeAt(legs, timed, index)
  return (
    <ol className="mt-6 flex flex-col">
      {first?.type === 'TRANSFER' ? <EndpointStop name={first.from.name} cap="START" /> : null}
      {legs.map((leg, index) => {
        // Two consecutive rides through the same station = same-station
        // interchange (no walk leg): bridge the islands with a grey rail.
        const previous = index > 0 ? legs[index - 1] : null
        const isSameStationTransfer = leg.type === 'RIDE'
          && previous?.type === 'RIDE'
          && previous.to.id === leg.from.id

        if (leg.type === 'RIDE') {
          return (
            <RideLeg
              key={index}
              leg={leg}
              isSameStationTransfer={isSameStationTransfer}
              walkBefore={walkRailColor(previous ?? undefined)}
              walkAfter={walkRailColor(legs[index + 1])}
              timed={timed.find(entry => entry.index === index)}
              rideS={rideS?.[index] ?? null}
              changeGap={isSameStationTransfer ? changeGapAt(index) : null}
              onPick={tripId => onPick(index, tripId)}
            />
          )
        }

        // Paid corridor (e.g. Dukuh Atas via KCI Sudirman): a transfer that
        // crosses a paid area, so it reads as a ticketed step, not a free walk.
        if (leg.corridorLabel != null && leg.fare != null) {
          return (
            <li key={index} className={`relative grid ${FARE_GUTTER_CLASS}`}>
              <div className="relative">
                <Rail style={{ backgroundColor: 'var(--color-rose-400)' }} dotted />
                <WalkMark color="var(--color-rose-500)" />
              </div>
              <div className="flex items-start gap-1.5 text-sm py-5">
                <TicketIcon weight="fill" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                <div className="flex flex-col">
                  <span className="text-rose-700">
                    {leg.corridorLabel}
                    {' • '}
                    <b>{formatRupiah(leg.fare)}</b>
                  </span>
                  {leg.distanceM > 0 && (
                    <span className="text-slate-500">
                      Jalan kaki ±
                      {leg.distanceM}
                      m
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        }

        /*
         * The breathing room is padding on the text, not a margin on the row: a
         * margin sits outside the row, where its rail cannot reach, and left a
         * gap at both ends of every walk.
         */
        const walkGap = changeGapAt(index)
        return (
          <li key={index} className={`relative grid ${FARE_GUTTER_CLASS}`}>
            <div className="relative">
              <Rail style={{ backgroundColor: 'var(--color-slate-400)' }} dotted />
              <WalkMark color="var(--color-slate-500)" />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-500 py-5">
              <span>
                Transit ke
                {' '}
                {leg.to.name}
                {leg.distanceM > 0 && ` (Jalan kaki ±${leg.distanceM}m)`}
              </span>
              {walkGap ? <ConnectionNote gapS={walkGap.gapS} tight={walkGap.tight} /> : null}
            </div>
          </li>
        )
      })}
      {last?.type === 'TRANSFER' ? <EndpointStop name={last.to.name} cap="END" /> : null}
    </ol>
  )
}

/*
 * Later trains named under a card's own: two, like the reference apps, which is
 * enough to see whether missing this one costs five minutes or twenty.
 */
const NEXT_DEPARTURES_SHOWN = 2

/*
 * The face of one option: the shape of the trip, what it costs, what it wins.
 *
 * The route leads. A rider scanning two options is choosing between journeys,
 * not between prices — the fare only means something once you know what you are
 * buying — so the diagram is the largest thing here and the fare reads beneath
 * it as a figure rather than a headline.
 *
 * Square-cut plate with a rule down the side in the colour of the line boarded
 * first, after the sign plates on the data platform. Colour is data here: the
 * rule is the same fact the bar and the timeline are drawing, so a plate can
 * never quietly disagree with the journey printed beside it.
 *
 * Presented as a button only when there is something to choose between. A lone
 * journey renders the identical block inert, because a press affordance on the
 * only answer invites a rider to look for an alternative that does not exist.
 */
export function JourneyCardFace({ journey, onSelect }: {
  journey: FareJourney
  onSelect?: () => void
}) {
  const legLines = useLegLines()
  /*
   * At most two badges. Four stacked lines of capitals drowned the fare they
   * were meant to qualify; two is what fits on one line beside it, and
   * sortJourneyLabels already ranks them so the pair a rider scans for leads.
   * The rest are recoverable by comparison — the option that is not the
   * cheapest has its price printed right there.
   */
  const labels = sortJourneyLabels(journey.labels).slice(0, 2)
  /*
   * Rides the last train of the night somewhere along the way. Not a reason to
   * pick this option like the labels beside it, but a condition on taking it,
   * so it leads the line in its own colour rather than joining their list.
   */
  const lastTrain = journey.legs.some(leg => leg.type === 'RIDE' && leg.lastService)
  /*
   * When this option leaves, and when it lands if we can say.
   *
   * The boarding alone is enough to show, and on a mixed journey it is all
   * there is: several cards can be the same route at different departures, and
   * without the boarding they are indistinguishable plates. That case is real —
   * a KCI leg into an untimed TransJakarta leg has a known 08.57 boarding and
   * no arrival anyone can promise.
   */
  const boarding = journey.legs.find(leg => leg.type === 'RIDE' && leg.departureAt)
  const boardsAt = boarding?.type === 'RIDE' ? boarding.departureAt : undefined
  /*
   * Published where every leg is timed, which `arrivalAt` already guarantees —
   * the API withholds it the moment one leg cannot be timed. See formatDuration
   * for why this is not the "never a duration" rule being broken.
   *
   * Otherwise the TransJakarta estimate, ±-marked by formatEstimate, which only
   * exists on exactly the journeys that have no published one.
   */
  const duration = boardsAt && journey.arrivalAt
    ? formatDuration(boardsAt, journey.arrivalAt)
    : estimatedDurationOf(journey)
  // Optional-chained against a body cached before the field existed.
  const nextDepartures = journey.moreDepartures?.slice(0, NEXT_DEPARTURES_SHOWN) ?? []
  /*
   * Which service this is, not just which line.
   *
   * From Cakung, line C runs 92 trips to Kampung Bandan and 60 to Angke — same
   * code, same platform, different trains. Where a pair is untimed this is the
   * ONLY thing separating two rows, so the plate has to carry it and not leave
   * it to the timeline below.
   *
   * The first ride's headsign: that is the vehicle the rider is deciding to
   * board, and the later legs are consequences of it.
   */
  const firstRide = journey.legs.find(leg => leg.type === 'RIDE')
  const headsign = firstRide?.type === 'RIDE' ? firstRide.headsign : null
  const walkM = walkDistanceOf(journey)
  const fareText = journey.totalFare !== null ? formatRupiah(journey.totalFare) : null
  const fareLeads = !duration && fareText !== null
  const segments = routeBarSegments(journey.legs, leg => legLines(leg))

  const body = (
    <>
      {/*
        * Every option in full line colour. Nothing is marked as chosen here,
        * because on this surface nothing ever is: the list and the detail are
        * two pages, and picking a row leaves for the detail in the same
        * handler — so a selection drawn on the list is never observed.
        *
        * It used to mute the unselected rows, from when the two were stacked
        * and the plate had to point at the timeline below it. Under paging that
        * left five of six routes looking disabled on arrival (the index
        * defaults to 0, so the marked row is an ordinal rather than a choice),
        * and the desaturation fell on the route bar — the one element here
        * carrying data rather than decoration.
        */}
      <RouteBar segments={segments} />

      {/*
        * Time leads, and the fare steps back to the meta row.
        *
        * The order is set by what actually varies. Routes between one pair
        * often share a fare, and the clock is what tells them apart: leading
        * with Rp6.500 on every card prints the same figure as a headline on
        * cards a rider is trying to tell apart, and buries the one fact that
        * separates them in 12px grey.
        *
        * Untimed journeys keep the fare as the headline below, because then it
        * genuinely is the most a row can say.
        */}
      {/*
        * The lead slot, after JR East: how long it takes, then when it leaves.
        *
        * Duration leads because it is the figure a rider compares rows on, and
        * it is the one JR East sets largest. A fully timed journey fills it
        * from two PUBLISHED times; a TransJakarta journey from the observed
        * estimate, ±-marked, beside its boarding clock where it has one (a
        * journey that opens on a bus has none) and never an arrival.
        * One the API could not estimate is a defined layout rather than a
        * blank first line: the fare moves up into the slot. The transfer
        * count only takes it when the fare is unknown too, since the meta row
        * below already carries that figure.
        */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="figure text-xl font-bold tracking-tight shrink-0 tabular-nums">
          {duration ?? fareText ?? `transit ${journey.transferCount}x`}
        </span>
        {boardsAt
          ? (
              <span className="figure text-sm font-semibold text-slate-500 shrink-0 tabular-nums">
                { formatClock(boardsAt) }
                {journey.arrivalAt
                  ? (
                      <>
                        <span className="text-slate-400">{' → '}</span>
                        { formatClock(journey.arrivalAt) }
                      </>
                    )
                  : null}
              </span>
            )
          : null}
      </div>
      {/*
        * The route's later trains, under the one this card is built on. They
        * used to be cards of their own; as times here they stop pushing a
        * genuinely different route off the first screen. As sent rather than
        * filtered against the clock: the rider may be planning a departure
        * that is not now.
        */}
      {nextDepartures.length > 0
        ? (
            <div className="figure mt-0.5 text-xs font-semibold text-slate-500 text-right tabular-nums truncate">
              {`berikutnya ${nextDepartures.map(departure => formatClock(departure.departureAt)).join(', ')}`}
            </div>
          )
        : null}

      {/*
        * The fare, and the reason this row is here.
        *
        * The label stops being an 11px pill wedged beside the price and becomes
        * the row's own sentence — it is the plain-language answer to "why am I
        * being shown this option", which is what TfL sets as its card header.
        * Still capped at two by sortJourneyLabels: a row wearing four reasons
        * is making none of them.
        */}
      {fareLeads && labels.length === 0 && !lastTrain
        ? null
        : (
            <div className="mt-1 flex items-baseline justify-between gap-2">
              {fareLeads
                ? null
                : (
                    <span className="figure text-sm font-bold text-slate-700 shrink-0">
                      { fareText ?? 'Tarif tidak tersedia' }
                    </span>
                  )}
              {lastTrain || labels.length > 0
                ? (
                    <span className="ml-auto text-xs font-bold truncate min-w-0 text-right">
                      {lastTrain ? <span className="text-amber-700">Kereta terakhir</span> : null}
                      {lastTrain && labels.length > 0 ? <span className="text-slate-400">{' · '}</span> : null}
                      <span className="text-rose-700">{ labels.map(label => JOURNEY_LABELS[label]).join(' · ') }</span>
                    </span>
                  )
                : null}
            </div>
          )}

      {/*
        * Counts, not a sentence. "13,5 km • 2x transit • jalan 460 m" reads as
        * prose and has to be parsed; a figure against its own pictogram is
        * scanned. Walk is omitted rather than zeroed when the response could
        * not say — see journeys.ts.
        */}
      {/*
        * One line at every width, with the headsign as the only thing that
        * yields.
        *
        * flex-nowrap because the figures are the row's fixed part: at the map
        * rail's ~368px they were breaking "16,8 km" and "310 m" each across two
        * lines, which made a card's height a function of its headsign's length
        * — six rows of one answer at three different heights. Truncating the
        * headsign instead is what the comment below already assumed happened.
        */}
      <div className="mt-1.5 flex flex-nowrap items-center gap-3 figure text-xs text-slate-500">
        <span className="shrink-0 whitespace-nowrap">{ formatKm(journey.totalDistanceM) }</span>
        <span className="shrink-0 whitespace-nowrap flex items-center gap-1">
          <TransferIcon className="w-3.5 h-3.5" />
          { journey.transferCount }
        </span>
        {walkM !== null && walkM > 0
          ? (
              <span className="shrink-0 whitespace-nowrap flex items-center gap-1">
                <PersonSimpleWalkIcon weight="bold" className="w-3.5 h-3.5 shrink-0" />
                {walkM}
                {' m'}
              </span>
            )
          : null}
        {/*
          * Where this train is going.
          *
          * It used to sit between the fare and the badges, which gave it
          * whatever width those two left over — on "Angke via Manggarai" beside
          * two badges that was a handful of characters before the ellipsis, and
          * the headsign is the ONLY thing separating two rows of an untimed
          * pair. Here it gets the rest of the row, after the counts that are
          * fixed-width by nature. Still truncated rather than wrapped: the full
          * form is in the timeline a tap away.
          */}
        {headsign
          ? <span className="truncate min-w-0">{ headsign }</span>
          : null}
      </div>
    </>
  )

  /*
   * No coloured rule down the edge.
   *
   * It was the third place the boarded line's colour appeared — rule, opening
   * roundel, track — and the roundel sits a few pixels away saying the same
   * thing better, because it also names the line. What the rule was really
   * carrying was selection, and that now rides on the route bar itself.
   *
   * `--plate-ground` is published for the roundel halos: they have to occlude
   * the track they sit on, and a hardcoded white ring would print a keyline on
   * the tinted plates, exactly where a rider is looking.
   */
  const plate = 'rounded-sm px-4 py-4 transition-colors'

  if (!onSelect) {
    return (
      <div className={`${plate} bg-white`} style={{ '--plate-ground': 'var(--color-white)' } as CSSProperties}>
        { body }
      </div>
    )
  }

  /*
   * No aria-expanded: this row navigates to a page, it does not disclose
   * anything in place. Announcing it as a collapsed widget on every row
   * described a control that no longer exists.
   */
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${plate} w-full text-left cursor-pointer bg-stone-100/60 hover:bg-stone-100`}
      style={{ '--plate-ground': 'var(--color-stone-100)' } as CSSProperties}
    >
      { body }
    </button>
  )
}

/** The chosen option in full: itinerary, fare breakdown, disclaimer. */
function JourneyDetail({ journey, timed, onPick }: {
  journey: FareJourney
  timed: TimedLeg[]
  onPick: (legIndex: number, tripId: string) => void
}) {
  const now = useClock()
  // Surcharged transfers (e.g. the Dukuh Atas corridor) aren't ride segments but
  // do contribute to totalFare, so they need their own breakdown rows for the
  // line items to reconcile with the total.
  const surchargedTransfers = journey.legs.filter(
    (leg): leg is FareResultTransferLeg & { fare: number, corridorLabel: string } =>
      leg.type === 'TRANSFER' && leg.fare != null && leg.corridorLabel != null
  )

  /*
   * The whole journey's clock, shown only when every ride leg is timed.
   *
   * The API omits `arrivalAt` the moment one leg cannot be timed, so this is
   * all-or-nothing by construction rather than by a check here — a total that
   * skipped an untimed leg would read as more certain than the legs it came
   * from.
   */
  const rides = journey.legs.filter(leg => leg.type === 'RIDE')
  const start = rides[0]
  /*
   * Only when it says something the legs do not.
   *
   * On a single-ride journey the strip would repeat that leg's own times
   * verbatim, one line above them — the same figure twice, which reads as a
   * rendering bug rather than a summary. With two or more rides the span
   * genuinely spans something: the waiting and walking between them.
   */
  const journeyClock = journey.arrivalAt && rides.length > 1 && start?.type === 'RIDE' && start.departureAt
    ? { departure: formatClock(start.departureAt), arrival: formatClock(journey.arrivalAt) }
    : null

  const recapDuration = start?.type === 'RIDE' && start.departureAt && journey.arrivalAt
    ? formatDuration(start.departureAt, journey.arrivalAt)
    : estimatedDurationOf(journey)

  // The countdown follows the journey as re-timed by the rider's picks.
  const leaveIn = start?.type === 'RIDE' && start.departureAt ? leaveInLabel(start.departureAt, now) : null

  return (
    <>
      {/*
        * Tonight's service is over: say so, and when it starts again, rather
        * than leave a timeline that looks like a journey someone can take.
        */}
      {journey.resumesAt
        ? (
            <p className="mt-4 rounded-sm bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              {'Layanan hari ini sudah selesai. Berangkat pertama '}
              <span className="figure">{ formatClock(journey.resumesAt) }</span>
            </p>
          )
        : null}
      {leaveIn ? <b className="mt-4 block text-xl tracking-tight">{ leaveIn }</b> : null}
      {/*
        * Each time labelled by its own verb, rather than one phrase covering
        * both: "berangkat sampai tiba" is a gloss nobody says out loud, and the
        * rest of the timeline speaks in short verb phrases (Pindah kereta,
        * Transit ke). `figure` stays on the numerals alone so they align with
        * every other figure on the card.
        */}
      {journeyClock
        ? (
            <p className={`${leaveIn ? 'mt-1' : 'mt-4'} text-sm font-semibold text-slate-700`}>
              {/* The countdown above already says "Berangkat", and the boarding
                  row carries the departure time; repeating the verb read as
                  the same fact twice. */}
              {leaveIn
                ? (
                    <>
                      {'Tiba '}
                      <span className="figure">{ journeyClock.arrival }</span>
                    </>
                  )
                : (
                    <>
                      Berangkat
                      {' '}
                      <span className="figure">{ journeyClock.departure }</span>
                      , tiba
                      {' '}
                      <span className="figure">{ journeyClock.arrival }</span>
                    </>
                  )}
            </p>
          )
        : null}
      <JourneyTimeline legs={journey.legs} timed={timed} rideS={journey.estimate?.rideS} onPick={onPick} />

      {/*
        * The journey in one line, after the itinerary that justifies it.
        *
        * JR East closes its detail the same way, and the reason it works is
        * that every figure here was already drawn above in context — this is a
        * recap for someone who has finished reading, not the first statement of
        * any of them. Duration on a fully timed journey, for the reason
        * formatDuration documents, or the ±-marked TransJakarta estimate; the
        * rest are always knowable.
        */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 figure text-sm text-slate-500">
        {/* Not gated on journeyClock: that one is deliberately null on a
            single-ride journey (it would repeat the leg's own times), but a
            one-seat ride still has a duration worth stating here. The real
            precondition is the pair of published times formatDuration needs. */}
        {recapDuration ? <b className="text-slate-700">{ recapDuration }</b> : null}
        <span>
          {'transit '}
          { journey.transferCount }
          x
        </span>
        {journey.totalFare !== null
          ? <b className="text-slate-700">{ formatRupiah(journey.totalFare) }</b>
          : null}
        <span>{ formatKm(journey.totalDistanceM) }</span>
      </div>

      {journey.segments.length + surchargedTransfers.length > 1
        ? (
            <div className="mt-2">
              <h2 className="font-bold text-lg">Rincian Tarif</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {journey.segments.map(segment => (
                  <li key={`${segment.from.id}-${segment.to.id}`} className="flex flex-row justify-between gap-4 bg-stone-100/80 rounded-sm px-4 py-3">
                    <div className="flex flex-col">
                      <b>{ operatorName(segment.operator) }</b>
                      <span className="text-sm text-slate-500 flex flex-row flex-wrap items-center gap-1">
                        { segment.from.name }
                        <CaretRightIcon weight="bold" className="w-3 h-3 shrink-0" />
                        { segment.to.name }
                      </span>
                    </div>
                    <b className="shrink-0 figure">{ segment.fare !== null ? formatRupiah(segment.fare) : 'N/A' }</b>
                  </li>
                ))}
                {surchargedTransfers.map((leg, index) => (
                  <li key={`transfer-${index}`} className="flex flex-row justify-between gap-4 bg-stone-100/80 rounded-sm px-4 py-3">
                    <div className="flex flex-col">
                      <b>{ leg.corridorLabel }</b>
                      <span className="text-sm text-slate-500 flex flex-row flex-wrap items-center gap-1">
                        { leg.from.name }
                        <CaretRightIcon weight="bold" className="w-3 h-3 shrink-0" />
                        { leg.to.name }
                      </span>
                    </div>
                    <b className="shrink-0 figure">{ formatRupiah(leg.fare) }</b>
                  </li>
                ))}
              </ul>
            </div>
          )
        : null}

      <p className="mt-6 text-xs text-slate-400">
        Estimasi berdasarkan tarif resmi per Oktober 2026. Tarif LRT Jabodebek mengikuti waktu berangkat: maksimal Rp20.000 pada jam sibuk (Senin–Jumat 06.00–08.59 dan 16.00–19.59), dan maksimal Rp10.000 di luar jam sibuk, akhir pekan, serta hari libur
      </p>
    </>
  )
}

/*
 * One option, face and detail together, with the rider's train picks.
 *
 * The picks live here, above both, because the plate and the timeline must tell
 * the same story: choosing a later train changes the plate's clock as well as
 * the leg's. Keyed by the caller on the selected option, so a pick never
 * carries over to a different route; and a pick that no longer matches any
 * train (a fresh answer arrived) is ignored by resolveTimedLegs rather than
 * applied. The clock drops trains that have left while the page was open.
 */
function JourneyPage({ journey }: { journey: FareJourney }) {
  const [picks, setPicks] = useState<Record<number, string>>({})
  const now = useClock()
  const timed = useMemo(() => resolveTimedLegs(journey.legs, picks, now), [journey, picks, now])
  const view = useMemo(() => retimeJourney(journey, timed), [journey, timed])
  return (
    <>
      {/* Inert: on the detail page this is the journey being read,
          not one of several being chosen between. */}
      <JourneyCardFace journey={view} />
      <JourneyDetail
        journey={view}
        timed={timed}
        onPick={(legIndex, tripId) => setPicks(current => ({ ...current, [legIndex]: tripId }))}
      />
    </>
  )
}

export default function FareResultCard({
  result,
  selectedIndex,
  onSelectIndex,
  openOnDetail = false
}: {
  result: FareResult | TripResult
  /*
   * Which option is open, lifted.
   *
   * Optional, and uncontrolled when omitted — every surface but the map keeps
   * owning selection here, because nothing outside the card needs to know. The
   * map does: its overlay draws the chosen journey's legs and its chip shows
   * that journey's total, so a selection private to this component would leave
   * the corridor on screen disagreeing with the card the rider just tapped.
   */
  selectedIndex?: number
  onSelectIndex?: (index: number) => void
  /*
   * Open on the chosen journey rather than the list, for a link that named a
   * route (`?j=`). See journey-pager.ts.
   */
  openOnDetail?: boolean
}) {
  /*
   * Every journey the answer carries, however many that is.
   *
   * One entry is a normal answer, not a special case: a pair with a single
   * non-dominated journey gets one card, and the engine already declines to
   * label a lone journey — a badge is a comparison, and "paling murah" means
   * nothing beside no alternative. So the list needs no trimming here.
   *
   * A `/fares`-shaped body served from a warm cache also lands as one, promoted
   * by journeysOf. See there for why that path outlives the endpoint switch.
   */
  const journeys = useMemo(() => journeysOf(result), [result])

  /*
   * The uncontrolled half. Declared unconditionally — hooks cannot be skipped —
   * and simply ignored when the caller controls selection.
   */
  const [ownSelected, setOwnSelected] = useState(0)
  const controlled = selectedIndex !== undefined
  const selected = controlled ? selectedIndex : ownSelected

  /*
   * Reset on a new answer. The index is an ordinal into a set recomputed per
   * request, not a stable identifier: change the payment method and the third
   * option may be a different route, or may not exist at all.
   *
   * A controlled caller resets its own — the map keys its state on the same
   * response, so doing it here too would fight it.
   */
  useEffect(() => {
    if (!controlled) setOwnSelected(0)
  }, [result, controlled])

  const { showing, hasOptions, toDetail, toOptions, pageFadeRef } = useJourneyPager(journeys, openOnDetail)

  const select = (index: number) => {
    if (!controlled) setOwnSelected(index)
    onSelectIndex?.(index)
    // Picking an option is asking to see it, not to stay in the list.
    toDetail()
  }

  const journey = journeys[selected] ?? journeys[0]!

  return (
    <article className="mt-6">
      {/*
        * A way back, and only where there is something to go back to.
        *
        * The list and the timeline answer different questions — "which of
        * these" and "what is this one" — and a rider is only ever asking one of
        * them. Stacking both meant every plate had to be scrolled past to reach
        * the detail of the one just chosen, which at six rows put it off screen
        * entirely. Same reasoning, and the same two pages, as the map's trip
        * card; see journey-pager.ts.
        */}
      {hasOptions
        ? (
            <div className="flex items-center h-8">
              {showing === 'detail'
                ? (
                    <button
                      type="button"
                      onClick={toOptions}
                      aria-label="Kembali ke pilihan rute"
                      className="flex items-center gap-1 -ml-1 rounded-lg px-1 py-1 cursor-pointer transition-colors duration-150 ease hover:bg-slate-100"
                    >
                      <CaretLeftIcon weight="bold" className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                      <span className="font-bold text-sm text-slate-500">Rincian perjalanan</span>
                    </button>
                  )
                : (
                    <h2 className="font-bold text-sm text-slate-500">
                      {journeys.length}
                      {' pilihan rute'}
                    </h2>
                  )}
            </div>
          )
        : null}

      <div ref={pageFadeRef} className="content-fade">
        {showing === 'options'
          ? (
              <ul className="mt-2 flex flex-col gap-2">
                {journeys.map((option, index) => (
                  <li key={index}>
                    <JourneyCardFace
                      journey={option}
                      onSelect={() => select(index)}
                    />
                  </li>
                ))}
              </ul>
            )
          : (
              <JourneyPage key={selected} journey={journey} />
            )}
      </div>
    </article>
  )
}
