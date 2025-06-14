import SettingsSheet from '~/components/settings-sheet'
import { Dialog } from '@headlessui/react'
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
        <SettingsSheet />
      </Dialog>
    </main>
  )
}
