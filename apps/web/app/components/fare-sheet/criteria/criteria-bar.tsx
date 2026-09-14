import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import {
  BusIcon,
  CaretRightIcon,
  CheckIcon,
  ClockIcon,
  CreditCardIcon,
  PersonSimpleWalkIcon,
  ProhibitIcon
} from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import { formatDepartureLabel } from 'utils/departure-time'
import { DEFAULT_FARE_CRITERIA, WALKING_PREFERENCES, type FareCriteria } from 'utils/fare-criteria'
import CriterionListSheet from './criterion-list-sheet'
import CriterionSheet, { type CriterionOption } from './criterion-sheet'
import DepartureSheet from './departure-sheet'
import {
  MODES_DESCRIPTIONS,
  MODES_LABELS,
  OFFERED_PAYMENT_METHODS,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_SHORT_LABELS,
  WALKING_DESCRIPTIONS,
  WALKING_LABELS,
  WALKING_SHORT_LABELS
} from './labels'

/*
 * One setting inside the summary chip: its icon, then what it is set to.
 *
 * Tinted only when the value is off the default, so a scan of the chip finds
 * the changed settings without reading any of them. The divider rides on the
 * segment rather than sitting between them as its own element, which keeps the
 * chip one flex row with nothing to misalign.
 */
function ChipSegment({ icon, value, modified, last }: {
  icon: ReactNode
  value: ReactNode
  modified: boolean
  last?: boolean
}) {
  return (
    <span
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5',
        !last && 'border-r-2 border-stone-200/70',
        modified ? 'bg-rose-100 text-pink-800' : 'text-slate-500'
      )}
    >
      { icon }
      <span className="text-sm font-bold whitespace-nowrap">{ value }</span>
    </span>
  )
}

interface Props {
  criteria: FareCriteria
  onChange: (criteria: FareCriteria) => void
}

// 'all' is the list sheet itself; the rest are the individual sheets it opens.
// One union rather than several pieces of state, so the parent closing as a
// child opens is a single transition and two can never both be open.
//
// 'departure' is reachable from the row directly rather than through the list:
// it is not one of the standing settings, so it does not appear in 'all'.
type OpenCriterion = 'all' | 'departure' | 'payment' | 'modes' | 'walking' | null

/*
 * The persistent settings rail under the Dari/Ke fields.
 *
 * Each chip shows its label above its *current value* and opens a sheet, rather
 * than toggling in place — borrowed from JR East's route search, where the same
 * row carries walk speed, fare settings and transport modes. That shape is why
 * it is worth building now: docs/go-mode.md's Tier 1 wants "fewest transfers /
 * least walk / cheapest", and each of those is another chip here rather than a
 * redesign.
 *
 * Reuses the station picker's chip container verbatim so the two rails read as
 * one system. The -mx-8 px-8 bleed assumes 8-unit parent padding, which /fare
 * (p-8) and the search sheet (px-8) both provide.
 */
export default function CriteriaBar({ criteria, onChange }: Props) {
  const [open, setOpen] = useState<OpenCriterion>(null)

  const paymentOptions = useMemo<CriterionOption<FareCriteria['paymentMethod']>[]>(
    () => OFFERED_PAYMENT_METHODS.map(method => ({
      value: method,
      label: PAYMENT_METHOD_LABELS[method],
      description: PAYMENT_METHOD_DESCRIPTIONS[method]
    })),
    []
  )

  const modesOptions = useMemo<CriterionOption<FareCriteria['modes']>[]>(
    () => (['all', 'rail'] as const).map(mode => ({
      value: mode,
      label: MODES_LABELS[mode],
      description: MODES_DESCRIPTIONS[mode]
    })),
    []
  )

  const walkingOptions = useMemo<CriterionOption<FareCriteria['walking']>[]>(
    () => WALKING_PREFERENCES.map(preference => ({
      value: preference,
      label: WALKING_LABELS[preference],
      description: WALKING_DESCRIPTIONS[preference]
    })),
    []
  )

  /*
   * One row of the settings sheet: what the setting is, what it is set to.
   *
   * The same two-line shape the chips used to carry, unrolled into a list —
   * which is what buys the descriptions room. WALKING_DESCRIPTIONS.AVOID is a
   * full sentence about how the ranking shifts, and there was nowhere to put it
   * on a 120px chip.
   */
  const row = (
    key: Exclude<OpenCriterion, null>,
    label: string,
    value: string,
    modified: boolean
  ) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        haptic()
        setOpen(key)
      }}
      aria-haspopup="dialog"
      className="px-8 py-3 flex items-center gap-3 w-full text-left cursor-pointer hover:bg-rose-50/60"
    >
      <span className="flex flex-col flex-1 min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{ label }</span>
        <b className={clsx('text-lg truncate', modified ? 'text-pink-800' : 'text-slate-900')}>{ value }</b>
      </span>
      <CaretRightIcon weight="bold" className="w-4 h-4 shrink-0 text-slate-400" />
    </button>
  )

  return (
    <>
      {/* Rendered whether or not a pair is chosen: it is a standing setting, and
          revealing it only once both stations land would jump the layout. */}
      {/*
        * One segmented chip, not four separate ones.
        *
        * Four always-on chips spent the widest row on the screen restating
        * defaults three riders in four never change, and they could not fit a
        * phone — hence the wrap, which then cost two lines. The segments buy
        * that width back by dropping the uppercase category labels: an icon
        * says "payment" in 16px where "PEMBAYARAN" took most of a chip.
        *
        * This also retires the wrap/scroll problem rather than working around
        * it: one chip fits every surface, including the map sheet, where
        * touch-action: none made a horizontal rail unreachable anyway.
        */}
      {/*
        * Settings left, departure right, on one row.
        *
        * They are the two halves of "what am I asking for": the settings are
        * standing preferences a rider sets once, the departure is a property of
        * this journey and the thing most likely to change between searches. So
        * the departure gets the right edge, where it reads as a value rather
        * than as one more setting, and the row keeps to a single line at every
        * width the panel is rendered at.
        */}
      {/*
        * Wraps rather than squeezes.
        *
        * The narrowest surface this renders on is the map's rail pill — 400px
        * less its px-4, so ~368px — where the settings chip and a long
        * departure do not both fit: "Sen, 14 Sep 13.20" is the worst case at 17
        * characters, and it was clipping to "Besok 13. …" at 11. Truncating a
        * departure is the one thing this row must never do, because the day is
        * the difference between two journeys.
        *
        * flex-wrap rather than a breakpoint: the same panel renders at ~368px
        * here and at max-w-3xl on /fare, so a viewport query would be wrong on
        * both. Wrapping asks the content, which is the only thing that knows.
        */}
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            haptic()
            setOpen('all')
          }}
          aria-haspopup="dialog"
          aria-label={`Pengaturan tarif: ${PAYMENT_METHOD_LABELS[criteria.paymentMethod]}, ${MODES_LABELS[criteria.modes]}, ${WALKING_LABELS[criteria.walking]}`}
          className="shrink-0 flex items-stretch rounded-full border-2 border-stone-200/70 bg-white overflow-hidden cursor-pointer transition-colors duration-150 hover:bg-rose-50/40"
        >
          {/*
            * The settings, shown rather than counted.
            *
            * This replaced a button reading "Atur" with a changed-count badge,
            * which was honest but opaque: a rider had to open the sheet to find
            * out what they were set to, and the count answered "how many did I
            * change" — a question nobody asks — instead of "what am I asking
            * for", which is the one they do.
            *
            * Each segment is an icon plus its value, and a segment tints only
            * when it is off the default, so the whole chip is scannable at a
            * glance and a changed setting still announces itself. Three
            * segments fit where four chips did not, because the icons replace
            * the uppercase category labels the chips were spending width on.
            *
            * Still one button, not three: the sheet it opens lists all three,
            * and three separate tap targets in 200px would be a row of
            * mis-taps. The icons say which is which; the sheet is where you
            * change them.
            */}
          <ChipSegment
            icon={<CreditCardIcon weight="bold" className="w-4 h-4 shrink-0" />}
            value={PAYMENT_METHOD_SHORT_LABELS[criteria.paymentMethod]}
            modified={criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod}
          />
          <ChipSegment
            icon={<BusIcon weight="bold" className="w-4 h-4 shrink-0" />}
            /*
             * A boolean, so it reads as a mark rather than a word. "Semua" and
             * "Tanpa TransJakarta" are a short word against a long phrase, and
             * the long one would set the chip's width on its own.
             */
            value={criteria.modes === 'all'
              ? <CheckIcon weight="bold" className="w-3.5 h-3.5 shrink-0" aria-hidden />
              : <ProhibitIcon weight="bold" className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            modified={criteria.modes !== DEFAULT_FARE_CRITERIA.modes}
          />
          <ChipSegment
            icon={<PersonSimpleWalkIcon weight="bold" className="w-4 h-4 shrink-0" />}
            value={WALKING_SHORT_LABELS[criteria.walking]}
            modified={criteria.walking !== DEFAULT_FARE_CRITERIA.walking}
            last
          />
        </button>

        <button
          type="button"
          onClick={() => {
            haptic()
            setOpen('departure')
          }}
          aria-haspopup="dialog"
          // Derived from the visible label rather than a parallel string: the
          // chip read "Sekarang" while its accessible name said "Berangkat
          // sekarang", which is two wordings for one state and two places to
          // forget to change.
          aria-label={`Berangkat ${formatDepartureLabel(criteria.fareTime).toLowerCase()}`}
          className={clsx(
            // shrink-0, not min-w-0: a shrinkable item clips its label instead
            // of pushing itself onto the next row, which is exactly the
            // truncation the wrap above exists to prevent.
            'shrink-0 flex items-center gap-2 rounded-full px-3.5 py-1.5 border-2 cursor-pointer transition-colors duration-150',
            criteria.fareTime !== 'now'
              ? 'bg-rose-100 text-pink-800 border-rose-200'
              : 'bg-white text-slate-500 border-stone-200/70'
          )}
        >
          <ClockIcon weight="bold" className="w-4 h-4 shrink-0" />
          <span className="figure text-sm font-bold whitespace-nowrap">
            { formatDepartureLabel(criteria.fareTime) }
          </span>
        </button>
      </div>

      {/*
        * The four criteria as one list.
        *
        * Its own Dialog rather than a nested one: tapping a row swaps `open` to
        * that criterion, so the parent closes as the child opens and only ever
        * one sheet is mounted open at a time. Closing the child returns to
        * `null`, not to the parent — a rider who has just set the thing they
        * came for is done, and bouncing them back up a level to dismiss a
        * second sheet is a tax on the common path.
        */}
      <CriterionListSheet
        open={open === 'all'}
        onClose={() => setOpen(null)}
      >
        {row(
          'payment',
          'Pembayaran',
          PAYMENT_METHOD_LABELS[criteria.paymentMethod],
          criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod
        )}
        {row(
          'modes',
          'Jalur',
          MODES_LABELS[criteria.modes],
          criteria.modes !== DEFAULT_FARE_CRITERIA.modes
        )}
        {row(
          'walking',
          'Jalan kaki',
          WALKING_LABELS[criteria.walking],
          criteria.walking !== DEFAULT_FARE_CRITERIA.walking
        )}
      </CriterionListSheet>

      <CriterionSheet
        open={open === 'payment'}
        title="Pembayaran"
        options={paymentOptions}
        selected={criteria.paymentMethod}
        onSelect={paymentMethod => onChange({ ...criteria, paymentMethod })}
        onClose={() => setOpen(null)}
      />
      <DepartureSheet
        open={open === 'departure'}
        value={criteria.fareTime}
        onSelect={fareTime => onChange({ ...criteria, fareTime })}
        onClose={() => setOpen(null)}
      />
      <CriterionSheet
        open={open === 'modes'}
        title="Jalur"
        options={modesOptions}
        selected={criteria.modes}
        onSelect={modes => onChange({ ...criteria, modes })}
        onClose={() => setOpen(null)}
      />
      <CriterionSheet
        open={open === 'walking'}
        title="Jalan kaki"
        options={walkingOptions}
        selected={criteria.walking}
        onSelect={walking => onChange({ ...criteria, walking })}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
