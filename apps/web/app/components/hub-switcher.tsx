import { OPERATORS } from '@commute/constants'
import type { Hub } from '@commute/schemas'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BusIcon,
  SubwayIcon,
  TrainIcon,
  TrainRegionalIcon,
  TramIcon
} from '@phosphor-icons/react'
import clsx from 'clsx'
import LineRoundel from '~/components/line-roundel'
import { useLines } from '~/hooks/use-lines'
import { sortLineKeysForDisplay } from '~/utils/lines'
import {
  directionLabel,
  groupByOperator,
  type Heading,
  headingOf,
  type HubMember,
  isAirportRail,
  orderDirections,
  resolveMember,
  splitKeepTogether,
  tileLabel
} from '~/utils/hub-members'

/*
 * The place hub header: one tile per operator inline with the title, then a
 * pill per side when that operator's halte is split by direction. Chosen from
 * the 2026-11-24 scratchpad (variant D), modelled on Citymapper's station
 * header but without operator logos, which we cannot use: a tile is a filled
 * mode glyph plus a short label instead.
 */

const MODE_ICON: Record<string, typeof BusIcon> = {
  RAIL: TrainIcon,
  SUBWAY: SubwayIcon,
  TRAM: TramIcon,
  BUS: BusIcon
}

const ARROW: Record<Heading, typeof BusIcon> = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  left: ArrowLeftIcon,
  right: ArrowRightIcon
}

function operatorName(code: string): string {
  return OPERATORS[code as keyof typeof OPERATORS]?.name ?? code
}

export interface HubSelection {
  member: HubMember
  /** The selected member's operator group, its sides in pill order. */
  sides: HubMember[]
  /** More than one operator: tiles are shown and the operator gets named. */
  multiOperator: boolean
  selectOperator: (operator: string) => void
  selectMember: (id: string) => void
}

/*
 * Which member the sheet is showing. Switching operator returns to the side
 * last picked on that operator, so LRT -> BRT -> LRT -> BRT lands back where
 * the rider was instead of resetting to the first side every time.
 */
export function useHubSelection(hub: Hub | null, initialMemberId?: string | null, onChange?: (member: HubMember) => void): HubSelection | null {
  const [memberId, setMemberId] = useState<string | null>(initialMemberId ?? null)
  const lastByOperator = useRef(new Map<string, string>())

  // A different hub, or a new requested member (a second map tap), restarts the
  // selection. Adjusting state during render, as React recommends over an effect.
  const [seen, setSeen] = useState({ slug: hub?.slug, initialMemberId })
  if (seen.slug !== hub?.slug || seen.initialMemberId !== initialMemberId) {
    setSeen({ slug: hub?.slug, initialMemberId })
    setMemberId(initialMemberId ?? null)
    lastByOperator.current.clear()
  }

  const member = hub ? resolveMember(hub.members, memberId) : null

  const select = useCallback((next: HubMember) => {
    lastByOperator.current.set(next.operator, next.id)
    setMemberId(next.id)
    onChange?.(next)
  }, [onChange])

  const selectMember = useCallback((id: string) => {
    const next = hub?.members.find(m => m.id === id)
    if (next) select(next)
  }, [hub, select])

  const selectOperator = useCallback((operator: string) => {
    if (!hub) return
    const remembered = lastByOperator.current.get(operator)
    const next = hub.members.find(m => m.id === remembered) ?? hub.members.find(m => m.operator === operator)
    if (next) select(next)
  }, [hub, select])

  const sides = useMemo(() => (hub && member
    ? orderDirections(hub.members.filter(m => m.operator === member.operator))
    : []), [hub, member])

  if (!hub || !member) return null
  const multiOperator = new Set(hub.members.map(m => m.operator)).size > 1
  return { member, sides, multiOperator, selectOperator, selectMember }
}

function OperatorTile({ member, selected, onSelect }: { member: HubMember, selected: boolean, onSelect: () => void }) {
  const mode = OPERATORS[member.operator as keyof typeof OPERATORS]?.mode as string | undefined
  const Vehicle = isAirportRail(member) ? TrainRegionalIcon : MODE_ICON[mode ?? ''] ?? TrainIcon
  const heading = headingOf(member)
  const Arrow = heading ? ARROW[heading] : null
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={operatorName(member.operator)}
      onClick={onSelect}
      className={clsx(
        'relative min-w-12 h-12 px-1.5 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors',
        selected ? 'bg-gray-900 text-white' : 'bg-slate-100 text-gray-400'
      )}
    >
      <Vehicle weight="fill" className="w-5 h-5" />
      <span className="text-[10px] font-bold leading-none">{tileLabel(member)}</span>
      {Arrow && selected && (
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-white bg-amber-400 text-gray-900">
          <Arrow weight="bold" className="w-3 h-3" />
        </span>
      )}
    </button>
  )
}

function HubTitle({ name, as: Heading }: { name: string, as: 'h1' | 'h2' }) {
  const parts = splitKeepTogether(name)
  return (
    <Heading className="font-bold text-xl leading-tight min-w-0">
      {parts
        ? (
            <>
              {parts.before}
              <span className="whitespace-nowrap">{parts.phrase}</span>
              {parts.after}
            </>
          )
        : name}
    </Heading>
  )
}

/** Tiles inline with the hub's name. The tile for the selected operator shows
 * the member actually selected, so its arrow badge follows the side. */
export function HubPlaceTitle({ hub, selection, as = 'h1' }: { hub: Hub, selection: HubSelection, as?: 'h1' | 'h2' }) {
  const groups = groupByOperator(hub.members)
  // One operator (a directional halte, BRT only) has nothing to switch between:
  // the title stands alone and the Arah pills below do the switching.
  if (groups.length < 2) return <HubTitle name={hub.name} as={as} />
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div role="tablist" aria-label="Moda" className="flex gap-1.5 pt-1 pr-1 shrink-0">
        {groups.map((group) => {
          const selected = group.operator === selection.member.operator
          return (
            <OperatorTile
              key={group.operator}
              member={selected ? selection.member : group.members[0]!}
              selected={selected}
              onSelect={() => { if (!selected) selection.selectOperator(group.operator) }}
            />
          )
        })}
      </div>
      <HubTitle name={hub.name} as={as} />
    </div>
  )
}

function DirectionPill({ member, selected, onSelect }: { member: HubMember, selected: boolean, onSelect: () => void }) {
  const heading = headingOf(member)
  const Arrow = heading ? ARROW[heading] : null
  // Signage rule: a right-pointing arrow trails its text, every other leads.
  const trailing = heading === 'right'
  const badge = Arrow && (
    <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center', selected ? 'bg-gray-900 text-amber-400' : 'bg-slate-300 text-white')}>
      <Arrow weight="bold" className="w-3 h-3" />
    </span>
  )
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full py-0.5 text-sm font-bold cursor-pointer transition-colors',
        trailing ? 'pl-2.5 pr-0.5' : 'pl-0.5 pr-2.5',
        selected ? 'bg-amber-400 text-gray-900' : 'bg-slate-100 text-gray-500'
      )}
    >
      {!trailing && badge}
      {directionLabel(member)}
      {trailing && badge}
    </button>
  )
}

/** Operator name, the side pills when split, and the selected member's lines. */
export function HubMemberSummary({ selection }: { selection: HubSelection }) {
  const { lines: resolveLines } = useLines()
  const { member, sides, multiOperator } = selection
  return (
    <div className="flex flex-col gap-1.5">
      {/* A single-operator hub (a directional halte) needs no naming: it has
          no tiles to tell apart, and its pills already say what it is. */}
      {multiOperator && <span className="text-sm font-semibold text-gray-600">{operatorName(member.operator)}</span>}
      {sides.length > 1 && (
        <div role="tablist" aria-label="Arah" className="flex items-center gap-2 flex-wrap">
          {sides.map(side => (
            <DirectionPill key={side.id} member={side} selected={side.id === member.id} onSelect={() => selection.selectMember(side.id)} />
          ))}
        </div>
      )}
      {member.lines.length > 0 && (
        <ul className="flex flex-row gap-1 flex-wrap">
          {resolveLines(sortLineKeysForDisplay(member.lines, member.operator)).map(line => (
            <li key={line.lineCode}>
              <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={member.operator} />
              <span className="sr-only">{line.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
