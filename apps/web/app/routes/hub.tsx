import type { Route } from './+types/hub'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { XIcon } from '@phosphor-icons/react'
import { HUB_KIND_LABEL } from '@commute/constants'
import HubContent, { HubContentSkeleton, HubPlaceContent, useHub } from '~/components/hub-content'
import { HubMemberSummary, HubPlaceTitle, useHubSelection } from '~/components/hub-switcher'
import { isPlaceHub, type HubMember } from '~/utils/hub-members'

// A route-param title rather than a "loading" placeholder: the SPA shell's
// crawler-rewritten title is replaced on hydration, and the real name only
// arrives after an API fetch, so a placeholder here is what Google indexes
// whenever its render snapshot wins that race.
export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `${params.slug} - Commute` },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function HubPage({ params }: Route.ComponentProps) {
  const { hub, isLoading } = useHub(params.slug)
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  /*
   * `?m=` names the member a shared link or a search result opens on, e.g. the
   * Arah side that was tapped. It follows the selection with `replace`, so the
   * address bar is always shareable without every tile tap becoming a history
   * entry. `/hubs/<slug>` alone stays the canonical page.
   */
  const handleSelectionChange = useCallback((member: HubMember) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('m', member.id)
      return next
    }, { replace: true, preventScrollReset: true })
  }, [setSearchParams])
  const place = hub && isPlaceHub(hub.kind) ? hub : null
  // Read once: after that the selection owns it, and feeding every `?m=` write
  // back in would restart the selection on each tap. An id from another hub
  // simply falls back to the first member.
  const [initialMemberId] = useState(() => searchParams.get('m'))
  const selection = useHubSelection(place, initialMemberId, handleSelectionChange)

  useEffect(() => {
    if (hub?.name) document.title = `${hub.name} - Commute`
  }, [hub?.name])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
      history.back()
    }
  }, [navigationType, navigate])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/50 backdrop-blur sticky top-0 z-10 border-b-2 border-b-gray-50/20">
        <div className="p-8 pb-4 max-w-3xl mx-auto pointer-events-auto flex flex-col gap-3">
          <div className="flex gap-4 justify-between items-center">
            <div className="flex flex-col min-w-0">
              {isLoading || !hub
                ? (
                    <div className="animate-pulse w-64 h-6 bg-slate-200 rounded-lg" />
                  )
                : selection
                  ? <HubPlaceTitle hub={hub} selection={selection} />
                  : (
                      <>
                        <h1 className="font-bold text-xl">{hub.name}</h1>
                        <span className="text-sm font-semibold text-gray-600">{HUB_KIND_LABEL[hub.kind]}</span>
                      </>
                    )}
            </div>
            <button
              onClick={handleBackButton}
              aria-label="Tutup halaman hub"
              className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 shrink-0 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </button>
          </div>
          {selection && <HubMemberSummary selection={selection} />}
        </div>
      </div>
      {!hub
        ? <HubContentSkeleton />
        : selection
          ? <HubPlaceContent selection={selection} />
          : <HubContent hub={hub} />}
    </div>
  )
}
