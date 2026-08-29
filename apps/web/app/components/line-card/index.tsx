import type { CompactLineTimetable, CompactSchedule } from '@commute/schemas'
import { useMemo } from 'react'
import { CaretRightIcon, NavigationArrowIcon } from '@phosphor-icons/react'
import ExitLink from '~/components/exit-link'
import PaneLink from '~/components/pane-stack/pane-link'
import { usePaneStack } from '~/components/pane-stack/context'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
import { departureSortKey, getRelativeDepartureLabel, isImminentDeparture, parseMinute } from 'utils/schedules'
import { formatPlatformCode, joinLabels } from 'utils/labels'
import { useClock } from '~/hooks/clock'
import PidsChevrons from './pids-chevrons'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'

function getNextSchedules(
  schedules: CompactSchedule[],
  limit = 3
) {
  const now = new Date()
  const cutoff = now.getTime() - 60000 /* keep just departed trains */

  const upcoming = schedules
    .map(schedule => ({
      schedule,
      sortKey: departureSortKey(parseMinute(schedule[1]), now)
    }))
    .filter(entry => entry.sortKey >= cutoff)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map(entry => entry.schedule)

  if (upcoming.length === 0 && schedules.length > 0) {
    return [schedules[0]]
  }

  return upcoming
}

interface Props {
  line: CompactLineTimetable
  // When set, the card header links to the line's page (/lines/{operator}/{lineCode}).
  operator?: string
  /*
   * Map-only: isolate this line on the map instead of navigating, holding it at
   * full strength while the rest of the network fades. Supplied by StationSheet;
   * the standalone station page leaves it unset and the header stays a link to
   * the line page.
   *
   * Isolating is not a lesser action than the link it replaces: it opens the
   * line sheet too, so the rider gets the detail AND sees the shape on the map.
   * Must be referentially stable, like onSelectDeparture beside it.
   */
  onIsolateLine?: (key: string) => void
}

export default function LineCard({ line, operator, onIsolateLine }: Props) {
  const stack = usePaneStack()
  // Shared 10s clock — one timer for the whole feed instead of one per card.
  const nowMs = useClock()
  const lastUpdated = useMemo(() => new Date(nowMs), [nowMs])

  /*
   * The timetable carries a line key; its name and colour come from the
   * dictionary. Falls back to the bare code and a neutral grey while
   * /operators is still in flight, so the card renders rather than blanking.
   */
  const { line: lookupLine } = useLines()
  const resolved = lookupLine(line.line)
  const lineCode = codeOfLineKey(line.line)
  const lineName = resolved?.name ?? (lineCode || 'Lin lain')
  const lineColor = resolved?.colorCode ?? '#94a3b8'

  const upcomingGroups = useMemo(() => {
    return line.timetable
      .map((group) => {
        const destinations = group.destinations
          .map(destination => ({
            boundFor: destination.boundFor,
            via: destination.via,
            schedules: getNextSchedules(destination.schedules)
          }))
          .filter(destination => destination.schedules.length > 0)

        return {
          key: group.key,
          label: group.label,
          platformCode: group.platformCode,
          destinations
        }
      })
      .filter(group => group.destinations.length > 0)
  }, [line.timetable, lastUpdated])

  if (upcomingGroups.length === 0) return null

  const title = <h1 id={`line-name-${lineName}`} className="font-bold text-base">{lineName}</h1>
  const chevron = <CaretRightIcon weight="bold" className="w-4 h-4 text-slate-600" />

  /*
   * Three headers, in order of what the tap can usefully do.
   *
   * On the map the header ISOLATES rather than navigates: the rider is already
   * looking at the network, so drawing the line in place beats sending them to a
   * page about it — and beginIsolate opens the line sheet too, so no detail is
   * lost. Off the map there is nothing to isolate, so it stays a link.
   *
   * TJ has no line-detail (topology) page yet, and a card off a stale cache can
   * arrive with no line key at all; neither has anywhere to go, so both render
   * as plain text.
   */
  const actionable = operator && operator !== 'TJ' && lineCode
  /*
   * On a desktop map the header pushes the line onto the deck, so the line sits
   * beside the station it was opened from instead of replacing it. The push and
   * the isolate are one gesture: PaneLink owns the card, onIsolateLine draws the
   * line on the map underneath it.
   *
   * Where there is no deck (a phone, or the standalone station page) PaneLink
   * falls through to a normal navigation, so the isolate-only button stays the
   * behaviour there.
   */
  const heading = !actionable
    ? title
    : onIsolateLine
      ? stack?.canPush
        ? (
            <PaneLink
              pane={{ kind: 'line', operator, code: lineCode }}
              className="flex items-center justify-between gap-2"
              aria-label={`Lihat rute ${lineName}`}
              // onPushed, not onClick: the isolate belongs to the card, so it
              // must not fire on a ⌘-click opening a new tab or on a refused
              // push that falls through to a normal navigation.
              onPushed={() => onIsolateLine(`${operator}:${lineCode}`)}
            >
              {title}
              {chevron}
            </PaneLink>
          )
        : (
            <button
              type="button"
              className="flex items-center justify-between gap-2 w-full text-left"
              onClick={() => onIsolateLine(`${operator}:${lineCode}`)}
              aria-label={`Sorot ${lineName} di peta`}
            >
              {title}
              {chevron}
            </button>
          )
      : (
          <ExitLink
            to={`/lines/${operator}/${lineCode}`}
            className="flex items-center justify-between gap-2"
            aria-label={`Lihat rute ${lineName}`}
          >
            {title}
            {chevron}
          </ExitLink>
        )

  return (
    <li
      className="rounded-xl w-full min-h-8 shadow-lg border-t-[16px] border-gray-100"
      style={{ borderTopColor: lineColor, backgroundColor: getTintFromColor(lineColor, 0.065) }}
      aria-label={`Jadwal untuk jalur ${lineName}`}
    >
      <article
        className="px-4 py-2.5 border-b-2"
        style={{ borderBottomColor: getTintFromColor(lineColor, 0.3) }}
        aria-labelledby={`line-name-${lineName}`}
      >
        {heading}
      </article>
      <ul>
        {upcomingGroups.map((group) => {
          // Synthetic/shimmed single-destination groups label themselves by
          // their terminus; a "menuju X" header over an "X" row is noise.
          // A platform badge still has to surface though, so keep the header
          // (minus the redundant label) whenever there is one to show.
          const labelIsRedundant = (
            group.destinations.length === 1
            && group.label.length === 1
            && group.label[0] === group.destinations[0].boundFor
          )
          const showHeader = !labelIsRedundant || Boolean(group.platformCode)

          return (
            <li
              key={group.key}
              className="border-t first:border-t-0"
              style={{ borderTopColor: getTintFromColor(lineColor, 0.3) }}
              aria-label={`Jadwal menuju ${group.label.join(', ')}`}
            >
              {showHeader && (
                <div
                  className="px-4 py-1.5 flex items-center gap-2"
                  style={{ backgroundColor: getTintFromColor(lineColor, 0.16) }}
                >
                  {!labelIsRedundant && (
                    <NavigationArrowIcon weight="fill" className="w-3 h-3 rotate-90 shrink-0" style={{ color: lineColor }} />
                  )}
                  <span className="flex-grow min-w-0 text-xs font-bold text-slate-700 uppercase tracking-wide truncate">
                    {labelIsRedundant ? '' : joinLabels(group.label)}
                  </span>
                  {group.platformCode && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${getForegroundColor(lineColor) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                      style={{ backgroundColor: lineColor }}
                      aria-label={`Berangkat dari peron ${group.platformCode}`}
                    >
                      {'Peron '}
                      {formatPlatformCode(group.platformCode)}
                    </span>
                  )}
                </div>
              )}
              <ul>
                {group.destinations.map((destination) => {
                  const departure = parseMinute(destination.schedules[0][1])
                  const relativeLabel = getRelativeDepartureLabel(lastUpdated, departure)
                  const absoluteTime = departure.toLocaleTimeString('id-ID', { timeStyle: 'short' })
                  const imminent = isImminentDeparture(lastUpdated, departure)

                  return (
                    <li
                      key={`${destination.boundFor}${destination.via ? `:${destination.via}` : ''}`}
                      className="py-2.5 px-4 flex items-baseline justify-between gap-3"
                      aria-label={`Jadwal menuju ${destination.boundFor}`}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-slate-800 truncate">{destination.boundFor}</span>
                        { /* eslint-disable-next-line @stylistic/jsx-one-expression-per-line */ }
                        {destination.via && <span className="text-xs text-gray-500">via {destination.via}</span>}
                      </div>
                      <div className="text-right flex flex-col shrink-0">
                        <span className="flex items-center justify-end gap-1.5">
                          {imminent && <PidsChevrons color={lineColor} />}
                          {relativeLabel
                            ? (
                                <span className="text-2xl font-bold tabular-nums leading-tight" aria-label={relativeLabel === 'Sekarang' ? 'Keberangkatan berikutnya dalam beberapa menit' : `Keberangkatan berikutnya dalam ${relativeLabel.replace('mnt', 'menit')}`}>
                                  {relativeLabel}
                                </span>
                              )
                            : (
                                <span className="text-2xl font-bold tabular-nums leading-tight" aria-label={`Keberangkatan berikutnya pada ${absoluteTime}`}>
                                  {absoluteTime}
                                </span>
                              )}
                        </span>
                        {destination.schedules.length > 1
                          ? (
                              <span
                                className="text-sm tabular-nums text-gray-600"
                                aria-label={`Keberangkatan selanjutnya: ${destination.schedules.slice(1, 3).map(sched => parseMinute(sched[1]).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}`}
                              >
                                lalu
                                {' '}
                                {destination.schedules.slice(1, 3).map(sched => parseMinute(sched[1]).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}
                              </span>
                            )
                          : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    </li>
  )
}
