import type { FareJourney, FareResult, FareResultLeg, FareResultRideLeg, FareResultTransferLeg, TripResult } from '@commute/schemas'
import { OPERATORS, type Operator } from '@commute/constants'
import { type CSSProperties, useEffect, useState } from 'react'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, PersonSimpleWalkIcon, TicketIcon } from '@phosphor-icons/react'
import { getForegroundColor } from 'utils/colors'
import { joinLabels } from 'utils/labels'
import LineRoundel from '~/components/line-roundel'
import { FARE_GUTTER_CLASS, FARE_RAIL_CENTER_PX, interlinedTrackFill, LINE_COLOR_FALLBACK, RAIL_WIDTH_PX } from '~/components/transit-geometry'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { JOURNEY_LABELS } from './journey-labels'
import { journeysOf, sortJourneyLabels, walkDistanceOf } from './journeys'
import RouteBar from './route-bar'
import { routeBarSegments } from './route-bar-segments'

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const formatKm = (distanceM: number) => `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
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
        <b className="text-lg py-0.5">{leg.from.name}</b>
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
function JourneyTimeline({ legs }: { legs: FareResultLeg[] }) {
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
                    <b>{rupiah.format(leg.fare)}</b>
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
function JourneyCardFace({ journey, selected, onSelect }: {
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

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="figure text-xl font-bold tracking-tight shrink-0">
          {journey.totalFare !== null ? rupiah.format(journey.totalFare) : 'Tarif tidak tersedia'}
        </span>
        {labels.map(label => (
          <span key={label} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 shrink-0">
            { JOURNEY_LABELS[label] }
          </span>
        ))}
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

  return (
    <>
      <JourneyTimeline legs={journey.legs} />

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
                    <b className="shrink-0 figure">{ segment.fare !== null ? rupiah.format(segment.fare) : 'N/A' }</b>
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
                    <b className="shrink-0 figure">{ rupiah.format(leg.fare) }</b>
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

export default function FareResultCard({ result, alternatives = false }: {
  result: FareResult | TripResult
  /*
   * Whether to offer the other journeys the API returned.
   *
   * Off by default, so /fare and the search sheet render exactly what they
   * rendered before alternatives existed: one result, no badges, no cards to
   * choose between. Only /trip turns it on while the feature is unreleased.
   *
   * Gating here rather than at the route is what makes the staging real. All
   * three surfaces share FarePanel, so a route-level flag would have shipped
   * the cards to every one of them — including the /fare page embedded in
   * TransportForJakarta's site, which is the surface this is protecting.
   */
  alternatives?: boolean
}) {
  /*
   * Always the full list, so the hooks below never change shape; the primary is
   * sliced off afterwards when alternatives are off.
   *
   * Its labels go with them. A badge is a comparison — "paling murah" only means
   * anything beside the option it beats — so keeping them on a lone card would
   * boast about a choice the rider was never shown. Same rule the engine
   * applies when it declines to label a single journey.
   */
  const all = journeysOf(result)
  const journeys = alternatives ? all : all.slice(0, 1).map(j => ({ ...j, labels: [] }))
  const [selected, setSelected] = useState(0)

  /*
   * Reset on a new answer. The index is an ordinal into a set recomputed per
   * request, not a stable identifier: change the payment method and the third
   * option may be a different route, or may not exist at all.
   */
  useEffect(() => setSelected(0), [result])

  const journey = journeys[selected] ?? journeys[0]!

  return (
    <article className="mt-6 content-fade">
      {journeys.length > 1
        ? (
            <div className="flex flex-col gap-2">
              {journeys.map((option, index) => (
                <JourneyCardFace
                  key={index}
                  journey={option}
                  selected={index === selected}
                  onSelect={() => setSelected(index)}
                />
              ))}
            </div>
          )
        : <JourneyCardFace journey={journey} selected />}

      <JourneyDetail journey={journey} />
    </article>
  )
}
