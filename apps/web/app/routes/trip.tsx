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
 * It renders the same sheet as /fare, but it is the ONLY surface that offers
 * the journey alternatives: `alternatives` is off everywhere else, so /fare and
 * the search sheet keep showing a single result exactly as they did before.
 * That gate is the point of this route. All three surfaces share FarePanel, so
 * without it the cards would ship to /fare too — including the /fare page
 * embedded in TransportForJakarta's site, which is the thing being protected.
 *
 * Also deferred, and unrelated to that gate: the /fare -> /trip redirect, the
 * sitemap move, the middleware branch, and the copy change.
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
          {/* The only surface offering alternatives while they are unreleased. */}
          <FareSheet title="Rute & Tarif" alternatives />
        </DialogPanel>
      </Dialog>
    </main>
  )
}
