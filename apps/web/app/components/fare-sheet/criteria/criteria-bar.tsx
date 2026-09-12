import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CaretRightIcon, ClockIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import { formatDepartureLabel } from 'utils/departure-time'
import { DEFAULT_FARE_CRITERIA, WALKING_PREFERENCES, type FareCriteria } from 'utils/fare-criteria'
import CriterionListSheet from './criterion-list-sheet'
import CriterionSheet, { type CriterionOption } from './criterion-sheet'
import DepartureSheet from './departure-sheet'
import {
  DEPARTURE_NOW_LABEL,
  MODES_DESCRIPTIONS,
  MODES_LABELS,
  OFFERED_PAYMENT_METHODS,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS,
  WALKING_DESCRIPTIONS,
  WALKING_LABELS
} from './labels'

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
   * How many settings the rider has moved off the default.
   *
   * The rose tint already marks each changed chip, but on a wrapped two-line
   * rail that is four things to read before knowing whether anything is set at
   * all. Announced to assistive tech rather than drawn: the tint carries it
   * visually, and a second visible badge would compete with the chips it counts.
   */
  // `fareTime` is deliberately not counted: the departure button beside this one
  // carries its own tint when set, so counting it here would report the same
  // change twice on one row.
  const changedCount = [
    criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod,
    criteria.modes !== DEFAULT_FARE_CRITERIA.modes,
    criteria.walking !== DEFAULT_FARE_CRITERIA.walking
  ].filter(Boolean).length

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
        * One button, not four chips, after TfL Go's "Options".
        *
        * Four always-on chips spent the widest row on the screen restating
        * defaults three riders in four never change, and they could not fit a
        * phone — hence the wrap, which then cost two lines. Collapsing them
        * puts the count where the chips' rose tint used to carry it, which is
        * the decision this reverses: `changedCount` was announced to assistive
        * tech only, on the grounds that a badge would compete with the chips it
        * counted. With the chips gone there is nothing left to compete with,
        * and a rider who cannot see the chips needs the number.
        *
        * This also retires the wrap/scroll problem rather than working around
        * it: one button fits every surface, including the map sheet, where
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
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            haptic()
            setOpen('all')
          }}
          aria-haspopup="dialog"
          aria-label={changedCount > 0 ? `Pengaturan tarif, ${changedCount} diubah` : 'Pengaturan tarif'}
          className={clsx(
            'shrink-0 flex items-center gap-2 rounded-full px-3.5 py-1.5 border-2 cursor-pointer transition-colors duration-150',
            changedCount > 0
              ? 'bg-rose-100 text-pink-800 border-rose-200'
              : 'bg-white text-slate-500 border-stone-200/70'
          )}
        >
          <SlidersHorizontalIcon weight="bold" className="w-4 h-4 shrink-0" />
          <span className="text-sm font-bold">Atur</span>
          {changedCount > 0
            ? (
                <span className="figure text-xs font-bold rounded-full bg-pink-800 text-white w-5 h-5 flex items-center justify-center shrink-0">
                  { changedCount }
                </span>
              )
            : null}
        </button>

        <button
          type="button"
          onClick={() => {
            haptic()
            setOpen('departure')
          }}
          aria-haspopup="dialog"
          aria-label={criteria.fareTime === 'now'
            ? DEPARTURE_NOW_LABEL
            : `Berangkat ${formatDepartureLabel(criteria.fareTime)}`}
          className={clsx(
            'min-w-0 flex items-center gap-2 rounded-full px-3.5 py-1.5 border-2 cursor-pointer transition-colors duration-150',
            criteria.fareTime !== 'now'
              ? 'bg-rose-100 text-pink-800 border-rose-200'
              : 'bg-white text-slate-500 border-stone-200/70'
          )}
        >
          <ClockIcon weight="bold" className="w-4 h-4 shrink-0" />
          <span className="figure text-sm font-bold truncate">
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
