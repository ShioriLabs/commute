import { GearSixIcon } from '@phosphor-icons/react'
import SheetButton from './sheet-button'
import SettingsSheet from '../settings-sheet'

interface Props {
  className?: string
}

export default function SettingsButton({ className }: Props) {
  return (
    <SheetButton
      url="/settings"
      ariaLabel="Pengaturan aplikasi"
      title="Pengaturan"
      subtitle="Aplikasi"
      icon={<GearSixIcon weight="fill" className="w-12 h-12 text-slate-700" />}
      className={className}
    >
      <SettingsSheet />
    </SheetButton>
  )
}
