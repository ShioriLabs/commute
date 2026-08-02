import FareSheet from '~/components/fare-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'
import { readDismissContext, resolveDismiss } from '~/lib/sheet-route-dismiss'

export function meta() {
  return [
    { title: 'Cek Tarif - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function FarePage() {
  const navigate = useNavigate()

  // `/fare` is a canonical URL, so closing must not assume it is a modal over
  // `/`. Headless UI fires onClose on focus loss and outside interaction, which
  // an iframe or a backgrounded tab can trigger with no user intent at all.
  // See app/lib/sheet-route-dismiss.ts.
  const dismiss = () => {
    if (resolveDismiss(readDismissContext()) === 'back') navigate(-1)
  }

  return (
    <main>
      <Dialog open onClose={dismiss}>
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
