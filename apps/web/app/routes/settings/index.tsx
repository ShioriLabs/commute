import SettingsSheet from '~/components/settings-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'

export function meta() {
  return [
    { title: 'Pengaturan - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function SettingsPage() {
  const navigate = useNavigate()

  return (
    <main>
      <Dialog open onClose={() => { navigate('/') }}>
        <DialogPanel
          transition
          className="overflow-hidden relative w-screen h-screen mt-auto"
        >
          <SettingsSheet />
        </DialogPanel>
      </Dialog>
    </main>
  )
}
