import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { haptic } from 'utils/haptics'
import { DEFAULT_FARE_CRITERIA, type FareCriteria } from 'utils/fare-criteria'
import CriterionSheet, { type CriterionOption } from './criterion-sheet'
import {
  FARE_TIME_DESCRIPTIONS,
  FARE_TIME_LABELS,
  OFFERED_PAYMENT_METHODS,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS
} from './labels'

interface Props {
  criteria: FareCriteria
  onChange: (criteria: FareCriteria) => void
  /*
   * Wrap the chips onto multiple lines instead of scrolling them horizontally.
   *
   * Off by default, so /fare and the search sheet keep the scrolling rail. The
   * map's fare sheet must set it: components/bottom-sheet.tsx puts
   * touch-action: none on the sheet and its body to drive scrollTop by hand,
   * touch-action intersects down the ancestor chain so a descendant cannot
   * re-enable panning, and the sheet's drag engine only commits on vertical
   * movement — a horizontal swipe there is swallowed entirely, leaving the
   * overflowing chips visible but unreachable. Wrapping also drops the
   * -mx-8 px-8 bleed, which suits the narrow desktop side pane.
   */
  wrap?: boolean
}

type OpenCriterion = 'payment' | 'time' | null

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
export default function CriteriaBar({ criteria, onChange, wrap = false }: Props) {
  const [open, setOpen] = useState<OpenCriterion>(null)

  const paymentOptions = useMemo<CriterionOption<FareCriteria['paymentMethod']>[]>(
    () => OFFERED_PAYMENT_METHODS.map(method => ({
      value: method,
      label: PAYMENT_METHOD_LABELS[method],
      description: PAYMENT_METHOD_DESCRIPTIONS[method]
    })),
    []
  )

  const timeOptions = useMemo<CriterionOption<FareCriteria['fareTime']>[]>(
    () => (['now', 'peak', 'offpeak'] as const).map(bucket => ({
      value: bucket,
      label: FARE_TIME_LABELS[bucket],
      description: FARE_TIME_DESCRIPTIONS[bucket]
    })),
    []
  )

  const chip = (
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
      // Not aria-pressed: these open a sheet, they do not toggle.
      aria-haspopup="dialog"
      className={`shrink-0 rounded-full px-3.5 py-1.5 border-2 text-left leading-tight cursor-pointer transition-colors duration-150 ${modified ? 'bg-rose-100 text-pink-800 border-rose-200' : 'bg-white text-slate-500 border-stone-200/70'}`}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{ label }</span>
      <span className="block text-sm font-bold">{ value }</span>
    </button>
  )

  return (
    <>
      {/* Rendered whether or not a pair is chosen: it is a standing setting, and
          revealing it only once both stations land would jump the layout. */}
      <div
        className={clsx(
          'mt-3 flex gap-2',
          wrap ? 'flex-wrap' : '-mx-8 px-8 overflow-x-auto no-scrollbar'
        )}
        role="group"
        aria-label="Pengaturan tarif"
      >
        {chip(
          'payment',
          'Pembayaran',
          PAYMENT_METHOD_LABELS[criteria.paymentMethod],
          criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod
        )}
        {chip(
          'time',
          'Waktu',
          FARE_TIME_LABELS[criteria.fareTime],
          criteria.fareTime !== DEFAULT_FARE_CRITERIA.fareTime
        )}
      </div>

      <CriterionSheet
        open={open === 'payment'}
        title="Pembayaran"
        options={paymentOptions}
        selected={criteria.paymentMethod}
        onSelect={paymentMethod => onChange({ ...criteria, paymentMethod })}
        onClose={() => setOpen(null)}
      />
      <CriterionSheet
        open={open === 'time'}
        title="Waktu"
        options={timeOptions}
        selected={criteria.fareTime}
        onSelect={fareTime => onChange({ ...criteria, fareTime })}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
