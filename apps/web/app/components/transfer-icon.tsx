import { ArrowsDownUpIcon, BusIcon, TrainSimpleIcon } from '@phosphor-icons/react'
import clsx from 'clsx'

/*
 * A change of vehicle: the vehicle, badged with the up-down arrows.
 *
 * The arrows alone read as "swap", which is what the Dari/Ke button already
 * uses them for, so a transfer count beside it looked like a count of swaps.
 * Pinning them to a vehicle says "change trains" instead. Same composite as
 * TOILET_ACCESSIBLE in station-content: base glyph, round badge bottom-right.
 *
 * Sized entirely by `className` on the wrapper; the badge is a fraction of it,
 * so the one component serves the 14px figures row and anything larger. The
 * badge fills with currentColor, so it follows whatever text colour it sits in.
 * The right margin pays back the badge's overhang, or it crowds the count.
 */
export default function TransferIcon({ mode = 'train', className }: {
  mode?: 'train' | 'bus'
  className?: string
}) {
  const Vehicle = mode === 'bus' ? BusIcon : TrainSimpleIcon
  return (
    <span className={clsx('relative inline-block shrink-0 mr-0.5', className)} aria-hidden="true">
      <Vehicle weight="bold" className="w-full h-full" />
      <span className="absolute -bottom-[10%] -right-[15%] w-[65%] h-[65%] rounded-full bg-current flex items-center justify-center">
        <ArrowsDownUpIcon weight="bold" className="w-[80%] h-[80%] text-white" />
      </span>
    </span>
  )
}
