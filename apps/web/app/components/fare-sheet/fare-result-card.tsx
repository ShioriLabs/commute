import type { FareJourney, FareResult, FareResultLeg, FareResultRideLeg, FareResultTransferLeg, TripResult } from '@commute/schemas'
import { OPERATORS, type Operator } from '@commute/constants'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { ArrowsDownUpIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, PersonSimpleWalkIcon, TicketIcon } from '@phosphor-icons/react'
import { getForegroundColor } from 'utils/colors'
import { formatClock, formatDuration, formatKm, formatRupiah } from 'utils/format'
import { formatPlatformCode, joinLabels } from 'utils/labels'
import LineRoundel from '~/components/line-roundel'
import { FARE_GUTTER_CLASS, FARE_RAIL_CENTER_PX, interlinedTrackFill, LINE_COLOR_FALLBACK, RAIL_WIDTH_PX } from '~/components/transit-geometry'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { JOURNEY_LABELS } from './journey-labels'
import { journeysOf, sortJourneyLabels, walkDistanceOf } from './journeys'
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
function Rail({ style, cap }: { style: CSSProperties, cap?: 'START' | 'END' }) {
  return (
    <span
      className="absolute"
      style={{
        width: RAIL_WIDTH_PX,
        left: FARE_RAIL_CENTER_PX - RAIL_WIDTH_PX / 2,
        top: cap === 'START' ? '50%' : 0,
        bottom: cap === 'END' ? '50%' : 0,
        ...style
      }}
    />
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

// One ride leg: board node, line-colored connector carrying the service card
// (line pill, headsign, expandable intermediate stops), alight node.
function RideLeg({ leg, isSameStationTransfer }: { leg: FareResultRideLeg, isSameStationTransfer: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const legLines = useLegLines()
  // Optional-chained against a stale API during deploy skew.
  const intermediate = leg.stops?.slice(1, -1) ?? []
  /*
   * Both ends or neither: the API sets them together, and half a range would
   * read as a departure with an unknown arrival rather than as a leg we cannot
   * time. `id-ID` renders 07.14, the dot form the departure board already uses.
   */
  const legTimes = leg.departureAt && leg.arrivalAt
    ? `${formatClock(leg.departureAt)} - ${formatClock(leg.arrivalAt)}`
    : null
  const summary = `${leg.stationCount - 1} stasiun • ${formatKm(leg.distanceM)}`
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
                <ArrowsDownUpIcon weight="bold" className="w-3.5 h-3.5" />
                <span>{leg.operator === OPERATORS.TJ.code ? 'Pindah bus' : 'Pindah kereta'}</span>
              </div>
            </div>
          )
        : null}
      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          <Rail style={railStyle} cap="START" />
          <Node color={legColor} />
        </div>
        <div className="flex items-center gap-2 flex-wrap py-0.5">
          <b className="text-lg">{leg.from.name}</b>
          {/*
            * Which peron to stand on, where it has been field-verified.
            *
            * Beside the boarding station and nowhere else: a platform is where
            * you get on, and the same figure against the alight node would be
            * read as where you get off. Absent for most legs by design — the
            * table is verified entries only, and a wrong peron sends a rider
            * to the wrong trackside — so there is no empty slot and no dash,
            * the badge simply is not there. See PLATFORM_CODES.
            *
            * Same pill as the timetable card's and the line card's, down to the
            * line-tinted ground: a rider reads this figure off a platform sign
            * either way, so it should not look like two different facts on two
            * screens. formatPlatformCode is what tightens the stored "3/4" into
            * the "3·4" those signs use.
            */}
          {leg.platformCode
            ? (
                <span
                  className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap text-slate-900"
                  style={{ backgroundColor: `${legColor}33` }}
                  aria-label={`Berangkat dari peron ${leg.platformCode}`}
                >
                  {'Peron '}
                  { formatPlatformCode(leg.platformCode) }
                </span>
              )
            : null}
        </div>
      </div>
      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          <Rail style={railStyle} />
        </div>
        {/* No plate: the rail already says which service this is and where it
            runs, so a filled card around it drew a second box for the same
            fact — and set it competing with the journey plates above, which
            are the things actually being chosen between. */}
        <div className="my-2 flex flex-col gap-1 items-start">
          <div className="flex flex-wrap gap-1.5 items-center">
            {lines.map(line => (leg.operator === OPERATORS.TJ.code
              // TJ is spoken as "naik koridor 9", not by the line's full name —
              // show the corridor roundel instead of a name pill.
              ? (
                  <LineRoundel key={line.code} size="SM" operator={leg.operator} code={line.code} color={line.color as `#${string}`} />
                )
              : (
                  <span
                    key={line.code}
                    className={`text-sm font-semibold px-3 py-1 rounded-md w-fit ${getForegroundColor(line.color) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                    style={{ backgroundColor: line.color }}
                  >
                    { line.name }
                  </span>
                )))}
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
            * Only where the timetable actually covers this leg.
            *
            * Absent is the honest answer for TransJakarta, which has no
            * timetable and never will, and for a rail leg whose trip reaches us
            * without its intermediate stops. Rendering nothing is deliberate:
            * a dash or a "—" would read as a missing value we could have
            * fetched, where the truth is that no such time was ever published.
            */}
          {legTimes
            ? (
                <span className="text-sm font-semibold text-slate-700">
                  { legTimes }
                </span>
              )
            : null}
          {intermediate.length === 0
            ? <span className="text-sm text-slate-500">{ summary }</span>
            : (
                <button
                  type="button"
                  onClick={() => setExpanded(value => !value)}
                  aria-expanded={expanded}
                  className="flex items-center gap-1 text-sm text-slate-500 cursor-pointer"
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
                {intermediate.map(stop => (
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
                    <span className="text-sm text-slate-600 py-1">{ stop.name }</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        : null}

      <div className={`relative grid ${FARE_GUTTER_CLASS}`}>
        <div className="relative">
          <Rail style={railStyle} cap="END" />
          <Node color={legColor} />
        </div>
        <b className="text-lg py-0.5">{leg.to.name}</b>
      </div>
    </li>
  )
}

// Itinerary timeline: ringed nodes at board/alight stations, line-colored
// connectors carrying the service card, walks as full-width cards that break
// the rail (TfL Go-style).
export function JourneyTimeline({ legs }: { legs: FareResultLeg[] }) {
  return (
    <ol className="mt-6 flex flex-col">
      {legs.map((leg, index) => {
        // Two consecutive rides through the same station = same-station
        // interchange (no walk leg): bridge the islands with a grey rail.
        const previous = index > 0 ? legs[index - 1] : null
        const isSameStationTransfer = leg.type === 'RIDE'
          && previous?.type === 'RIDE'
          && previous.to.id === leg.from.id

        if (leg.type === 'RIDE') {
          return <RideLeg key={index} leg={leg} isSameStationTransfer={isSameStationTransfer} />
        }

        // Paid corridor (e.g. Dukuh Atas via KCI Sudirman): a transfer that
        // crosses a paid area, so it reads as a ticketed step, not a free walk.
        if (leg.corridorLabel != null && leg.fare != null) {
          return (
            <li key={index} className={`relative grid ${FARE_GUTTER_CLASS} my-2`}>
              <div className="relative">
                <Rail style={{ backgroundColor: 'var(--color-rose-300)' }} />
              </div>
              <div className="flex items-start gap-1.5 text-sm py-1.5">
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

        return (
          <li key={index} className={`relative grid ${FARE_GUTTER_CLASS} my-2`}>
            <div className="relative">
              <Rail style={{ backgroundColor: 'var(--color-slate-300)' }} />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-500 py-1.5">
              <PersonSimpleWalkIcon weight="bold" className="w-3.5 h-3.5" />
              <span>
                Transit ke
                {' '}
                {leg.to.name}
                {leg.distanceM > 0 && ` (Jalan kaki ±${leg.distanceM}m)`}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

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
export function JourneyCardFace({ journey, selected, onSelect }: {
  journey: FareJourney
  selected: boolean
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
   * Only on a fully timed journey, which `arrivalAt` already guarantees — the
   * API withholds it the moment one leg cannot be timed. See formatDuration for
   * why this is not the "never a duration" rule being broken.
   */
  const duration = boardsAt && journey.arrivalAt ? formatDuration(boardsAt, journey.arrivalAt) : null
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
  const segments = routeBarSegments(journey.legs, leg => legLines(leg))

  const body = (
    <>
      {/*
        * Unselected options step back rather than being marked: the route is
        * the thing being chosen between, so muting it is a stronger signal than
        * any badge on the card's edge, and it leaves exactly one journey in
        * full line colour at a time.
        */}
      <div className={`transition-[filter,opacity] duration-200 ${selected ? '' : 'saturate-50 opacity-75'}`}>
        <RouteBar segments={segments} />
      </div>

      {/*
        * Time leads, and the fare steps back to the meta row.
        *
        * The order is set by what actually varies. Where a list is one route at
        * several departures — which is now the common answer, not an edge case
        * — the fare is CONSTANT across those rows and the clock is the only
        * thing that moves. Leading with Rp6.500 three times over prints the
        * same figure as a headline on three cards a rider is trying to tell
        * apart, and buries the one fact that separates them in 12px grey.
        *
        * Untimed journeys keep the fare as the headline below, because then it
        * genuinely is the most a row can say.
        */}
      {/*
        * The lead slot, after JR East: how long it takes, then when it leaves.
        *
        * Duration leads because it is the figure a rider compares rows on, and
        * it is the one JR East sets largest. It exists only on a fully timed
        * journey though — formatDuration is arithmetic on two PUBLISHED times,
        * and no TransJakarta journey has them — so the untimed variant is a
        * defined layout rather than a blank first line: the transfer count
        * takes the slot, since on an untimed row that is what separates two
        * otherwise identical shapes.
        */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="figure text-xl font-bold tracking-tight shrink-0 tabular-nums">
          {duration ?? `transit ${journey.transferCount}x`}
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
        * The fare, and the reason this row is here.
        *
        * The label stops being an 11px pill wedged beside the price and becomes
        * the row's own sentence — it is the plain-language answer to "why am I
        * being shown this option", which is what TfL sets as its card header.
        * Still capped at two by sortJourneyLabels: a row wearing four reasons
        * is making none of them.
        */}
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="figure text-sm font-bold text-slate-700 shrink-0">
          {journey.totalFare !== null ? formatRupiah(journey.totalFare) : 'Tarif tidak tersedia'}
        </span>
        {labels.length > 0
          ? (
              <span className="text-xs font-bold text-rose-700 truncate min-w-0 text-right">
                { labels.map(label => JOURNEY_LABELS[label]).join(' · ') }
              </span>
            )
          : null}
      </div>

      {/*
        * Counts, not a sentence. "13,5 km • 2x transit • jalan 460 m" reads as
        * prose and has to be parsed; a figure against its own pictogram is
        * scanned. Walk is omitted rather than zeroed when the response could
        * not say — see journeys.ts.
        */}
      <div className="mt-1.5 flex items-center gap-3 figure text-xs text-slate-500">
        <span>{ formatKm(journey.totalDistanceM) }</span>
        <span className="flex items-center gap-1">
          <ArrowsDownUpIcon weight="bold" className="w-3.5 h-3.5 shrink-0" />
          { journey.transferCount }
        </span>
        {walkM !== null && walkM > 0
          ? (
              <span className="flex items-center gap-1">
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

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      className={`${plate} w-full text-left cursor-pointer ${
        selected ? 'bg-rose-50' : 'bg-stone-100/60 hover:bg-stone-100'
      }`}
      style={{
        '--plate-ground': selected ? 'var(--color-rose-50)' : 'var(--color-stone-100)'
      } as CSSProperties}
    >
      { body }
    </button>
  )
}

/** The chosen option in full: itinerary, fare breakdown, disclaimer. */
function JourneyDetail({ journey }: { journey: FareJourney }) {
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

  return (
    <>
      {/*
        * Each time labelled by its own verb, rather than one phrase covering
        * both: "berangkat sampai tiba" is a gloss nobody says out loud, and the
        * rest of the timeline speaks in short verb phrases (Pindah kereta,
        * Transit ke). `figure` stays on the numerals alone so they align with
        * every other figure on the card.
        */}
      {journeyClock
        ? (
            <p className="mt-4 text-sm font-semibold text-slate-700">
              Berangkat
              {' '}
              <span className="figure">{ journeyClock.departure }</span>
              , tiba
              {' '}
              <span className="figure">{ journeyClock.arrival }</span>
            </p>
          )
        : null}
      <JourneyTimeline legs={journey.legs} />

      {/*
        * The journey in one line, after the itinerary that justifies it.
        *
        * JR East closes its detail the same way, and the reason it works is
        * that every figure here was already drawn above in context — this is a
        * recap for someone who has finished reading, not the first statement of
        * any of them. Duration only on a fully timed journey, for the reason
        * formatDuration documents; the rest are always knowable.
        */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 figure text-sm text-slate-500">
        {/* Not gated on journeyClock: that one is deliberately null on a
            single-ride journey (it would repeat the leg's own times), but a
            one-seat ride still has a duration worth stating here. The real
            precondition is the pair of published times formatDuration needs. */}
        {start?.type === 'RIDE' && start.departureAt && journey.arrivalAt
          ? <b className="text-slate-700">{ formatDuration(start.departureAt, journey.arrivalAt) }</b>
          : null}
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
        Estimasi berdasarkan tarif resmi per Juli 2026. Tarif LRT Jabodebek memakai batas atas jam sibuk; di luar jam sibuk dan akhir pekan bisa lebih murah
      </p>
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
                      selected={index === selected}
                      onSelect={() => select(index)}
                    />
                  </li>
                ))}
              </ul>
            )
          : (
              <>
                {/* Inert: on the detail page this is the journey being read,
                    not one of several being chosen between. */}
                <JourneyCardFace journey={journey} selected />
                <JourneyDetail journey={journey} />
              </>
            )}
      </div>
    </article>
  )
}
