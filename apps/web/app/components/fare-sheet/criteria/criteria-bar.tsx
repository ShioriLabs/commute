import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import {
  BusIcon,
  CheckIcon,
  ClockIcon,
  CreditCardIcon,
  ProhibitIcon
} from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import { formatDepartureLabel } from 'utils/departure-time'
import { DEFAULT_FARE_CRITERIA, WALKING_PREFERENCES, type FareCriteria } from 'utils/fare-criteria'
import CriterionSheet, { type CriterionOption } from './criterion-sheet'
import DepartureSheet from './departure-sheet'
import WalkingIcon from './walking-icon'
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
 * One setting inside the summary chip: its icon, then what it is set to, and a
 * button for that setting's own sheet.
 *
 * Tinted only when the value is off the default, so a scan of the chip finds
 * the changed settings without reading any of them. The divider rides on the
 * segment rather than sitting between them as its own element, which keeps the
 * chip one flex row with nothing to misalign.
 */
function ChipSegment({ icon, value, label, modified, onClick, last }: {
  icon: ReactNode
  value: ReactNode
  label: string
  modified: boolean
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic()
        onClick()
      }}
      aria-haspopup="dialog"
      aria-label={label}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors duration-150',
        !last && 'border-r-2 border-stone-200/70',
        modified ? 'bg-rose-100 text-pink-800' : 'text-slate-500 hover:bg-rose-50/40'
      )}
    >
      { icon }
      <span className="text-sm font-bold whitespace-nowrap">{ value }</span>
    </button>
  )
}

interface Props {
  criteria: FareCriteria
  onChange: (criteria: FareCriteria) => void
}

// One union rather than several pieces of state, so two sheets can never both
// be open.
type OpenCriterion = 'departure' | 'payment' | 'modes' | 'walking' | null

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
      description: WALKING_DESCRIPTIONS[preference],
      icon: <WalkingIcon level={preference} className="h-7 w-10 justify-end text-slate-600" />
    })),
    []
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
        <div className="shrink-0 flex items-stretch rounded-full border-2 border-stone-200/70 bg-white overflow-hidden">
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
            * Each segment opens its own setting's sheet. It used to be one
            * button opening a list of all three, which made every change two
            * sheets deep; the icons already say which segment is which.
            */}
          <ChipSegment
            icon={<CreditCardIcon weight="bold" className="w-4 h-4 shrink-0" />}
            value={PAYMENT_METHOD_SHORT_LABELS[criteria.paymentMethod]}
            label={`Pembayaran: ${PAYMENT_METHOD_LABELS[criteria.paymentMethod]}`}
            modified={criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod}
            onClick={() => setOpen('payment')}
          />
          <ChipSegment
            icon={<BusIcon weight="bold" className="w-4 h-4 shrink-0" />}
            label={`Jalur: ${MODES_LABELS[criteria.modes]}`}
            onClick={() => setOpen('modes')}
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
            icon={<WalkingIcon level={criteria.walking} reserve={false} className="h-4" />}
            value={WALKING_SHORT_LABELS[criteria.walking]}
            label={`Jalan kaki: ${WALKING_LABELS[criteria.walking]}`}
            modified={criteria.walking !== DEFAULT_FARE_CRITERIA.walking}
            onClick={() => setOpen('walking')}
            last
          />
        </div>

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
        title="Kecepatan jalan"
        options={walkingOptions}
        selected={criteria.walking}
        onSelect={walking => onChange({ ...criteria, walking })}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
