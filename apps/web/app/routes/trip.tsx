import FareSheet from '~/components/fare-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'
import { readDismissContext, resolveDismiss } from '~/lib/sheet-route-dismiss'

/*
 * The trip page — unlisted, for now.
 *
 * Nothing links here: it is absent from the sitemap, the SEO middleware does not
 * decorate it, and `/fare` is untouched and still canonical. Reachable only by
 * typing the URL, following /map's precedent (see app/hooks/secret-features.ts,
 * which notes the unlock "hides the entry point only" — here there is no entry
 * point yet, so there is nothing to gate).
 *
 * It renders the same sheet as /fare, so the journey alternatives can be lived
 * with on a real URL before any of the risky migration lands: the /fare -> /trip
 * redirect, the sitemap move, the middleware branch, and the copy change. Those
 * are deliberately deferred so the TransportForJakarta embed, which points at
 * /fare, is not disturbed.
 */
export function meta() {
  return [
    { title: 'Rute & Tarif - Commute' },
    { name: 'theme-color', content: '#FFFFFF' },
    // Unlisted, so keep it out of the index even if someone links it.
    { name: 'robots', content: 'noindex' }
  ]
}

export default function TripPage() {
  const navigate = useNavigate()

  // Same guard as /fare: Headless UI fires onClose on focus loss and outside
  // interaction, which an iframe or a backgrounded tab triggers with no user
  // intent. See app/lib/sheet-route-dismiss.ts.
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
          <FareSheet title="Rute & Tarif" />
        </DialogPanel>
      </Dialog>
    </main>
  )
}
