import FareSheet from '~/components/fare-sheet'
import { Dialog, DialogPanel } from '@headlessui/react'
import { useNavigate } from 'react-router'
import { readDismissContext, resolveDismiss } from '~/lib/sheet-route-dismiss'

/*
 * The trip page — unlisted, and now redundant.
 *
 * Nothing links here: it is absent from the sitemap, the SEO middleware does not
 * decorate it, and `/fare` is canonical. It existed to be the one surface that
 * offered the journey alternatives while they were unreleased, gated away from
 * /fare and therefore from the /fare embedded in TransportForJakarta's site.
 *
 * That gate is gone. The router toggle on /fare offers the same alternatives to
 * anyone who asks for them, so this route is no longer the only way in and no
 * longer holds anything back — it renders the same sheet, under a different
 * heading, and inherits the rider's stored router exactly as /fare does.
 *
 * Kept for now as the escape hatch: if the toggle has to be pulled, the feature
 * stays reachable here without a redeploy. Deleting it, along with the
 * documentTitlePrefix/title props that exist only because two routes render one
 * sheet, is follow-up work.
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
