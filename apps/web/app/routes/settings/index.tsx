import SettingsSheet from '~/components/settings-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'
import { readDismissContext, resolveDismiss } from '~/lib/sheet-route-dismiss'

export function meta() {
  return [
    { title: 'Pengaturan - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function SettingsPage() {
  const navigate = useNavigate()

  // Same reasoning as `/fare`: a deep-linked `/settings` is a page, not a modal
  // over `/`. See app/lib/sheet-route-dismiss.ts.
  const dismiss = () => {
    if (resolveDismiss(readDismissContext()) === 'back') navigate(-1)
  }

  return (
    <main>
      <Dialog open onClose={dismiss}>
        <DialogPanel
          transition
          // See routes/fare.tsx: 100vh is the large viewport, so the bottom of
          // this scroller hides under a bottom browser toolbar.
          className="overflow-hidden relative w-screen h-dvh mt-auto"
        >
          <SettingsSheet />
        </DialogPanel>
      </Dialog>
    </main>
  )
}
