import { TicketIcon } from '@phosphor-icons/react'
import SheetButton, { type SheetButtonSize } from './sheet-button'
import FareSheet from '../fare-sheet'

interface Props {
  className?: string
  size?: SheetButtonSize
}

export default function FareButton({ className, size = 'card' }: Props) {
  const iconSize = size === 'compact' ? 'w-5 h-5' : 'w-12 h-12'
  return (
    <SheetButton
      url="/fare"
      ariaLabel="Cek tarif perjalanan"
      title="Cek"
      compactLabel="Tarif"
      subtitle={(
        <>
          Tarif
          <br />
          Perjalanan
        </>
      )}
      icon={<TicketIcon weight="fill" className={`${iconSize} text-slate-700`} />}
      size={size}
      className={className}
    >
      <FareSheet />
    </SheetButton>
  )
}
