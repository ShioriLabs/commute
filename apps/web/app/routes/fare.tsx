import FareSheet from '~/components/fare-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'

export function meta() {
  return [
    { title: 'Cek Tarif - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function FarePage() {
  const navigate = useNavigate()

  return (
    <main>
      <Dialog open onClose={() => { navigate('/') }}>
        <DialogPanel
          transition
          className="overflow-hidden relative w-screen h-screen mt-auto"
        >
          <FareSheet />
        </DialogPanel>
      </Dialog>
    </main>
  )
}
