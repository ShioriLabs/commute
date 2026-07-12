import { TicketIcon } from '@phosphor-icons/react'
import SheetButton from './sheet-button'
import FareSheet from '../fare-sheet'

interface Props {
  className?: string
}

export default function FareButton({ className }: Props) {
  return (
    <SheetButton
      url="/fare"
      ariaLabel="Cek tarif perjalanan"
      title="Cek"
      subtitle={(
        <>
          Tarif
          <br />
          Perjalanan
        </>
      )}
      icon={<TicketIcon weight="fill" className="w-12 h-12 text-slate-700" />}
      className={className}
    >
      <FareSheet />
    </SheetButton>
  )
}
