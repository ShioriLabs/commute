import type { OperatorCode } from '@commute/schemas'
import { useMemo, useState } from 'react'
import { haptic } from 'utils/haptics'
import { DEFAULT_FARE_CRITERIA, type FareCriteria } from 'utils/fare-criteria'
import CriterionSheet, { type CriterionOption } from './criterion-sheet'
import {
  FARE_TIME_DESCRIPTIONS,
  FARE_TIME_LABELS,
  OFFERED_PAYMENT_METHODS,
  operatorLabel,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS
} from './labels'

interface Props {
  criteria: FareCriteria
  onChange: (criteria: FareCriteria) => void
  /** Operators present in the pickable set, so the sheet offers only real ones. */
  operators: OperatorCode[]
}

type OpenCriterion = 'payment' | 'time' | 'operator' | null

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
export default function CriteriaBar({ criteria, onChange, operators }: Props) {
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

  // 'ALL' rather than null: CriterionSheet keys on a string, and null would
  // collapse into "nothing selected" instead of an explicit "every operator".
  const operatorOptions = useMemo<CriterionOption<string>[]>(
    () => [
      { value: 'ALL', label: 'Semua', description: 'Tampilkan stasiun dari semua operator' },
      ...operators.map(code => ({ value: code, label: operatorLabel(code) }))
    ],
    [operators]
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
        className="mt-3 -mx-8 px-8 flex gap-2 overflow-x-auto no-scrollbar"
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
        {operators.length > 1
          ? chip('operator', 'Operator', operatorLabel(criteria.operator), criteria.operator !== null)
          : null}
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
      <CriterionSheet
        open={open === 'operator'}
        title="Operator"
        options={operatorOptions}
        selected={criteria.operator ?? 'ALL'}
        onSelect={value => onChange({
          ...criteria,
          operator: value === 'ALL' ? null : value as OperatorCode
        })}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
