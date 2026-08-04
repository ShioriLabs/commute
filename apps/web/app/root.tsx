import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from 'react-router'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Route } from './+types/root'
import './app.css'
import { InstallableProvider } from './contexts/installable'
import Wordmark from './components/wordmark'
import {
  BOOT_FALLBACK_COPY,
  BOOT_FALLBACK_ID,
  BOOT_FALLBACK_MESSAGE_ID,
  BOOT_FALLBACK_RETRY_ID,
  BOOT_WATCHDOG_SOURCE
} from './lib/boot-watchdog'
import { createBrowserDeps, registerServiceWorker } from './lib/register-service-worker'

declare global {
  interface Window {
    __commuteBoot?: { ok: () => void, retry: () => void }
  }
}

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous'
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=swap'
  },
  {
    rel: 'manifest',
    href: '/manifest.json'
  },
  {
    rel: 'icon',
    href: '/favicon.png'
  }
]

// The boot splash lives in Layout rather than HydrateFallback so it survives
// hydration: Layout persists when the router swaps the fallback for real route
// content, which is what lets the splash fade out over the mounting app
// instead of disappearing in a single frame on unmount.
type BootSplashPhase = 'visible' | 'leaving' | 'gone'

const BootSplashDismissContext = createContext<() => void>(() => {})

// Called from the components that mount when real content is on screen — App
// (route tree committed) and ErrorBoundary (first render threw). Not from
// Layout's own effect: that fires at hydration, when the route module may
// still be a lazy chunk in flight and the splash is the only thing worth
// showing.
function useDismissBootSplash() {
  const dismiss = useContext(BootSplashDismissContext)

  useEffect(() => {
    // Double rAF: the content underneath has not just committed but painted,
    // so the fade reveals real pixels rather than racing first paint.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(dismiss)
    })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [dismiss])
}

export function Layout({ children }: { children: React.ReactNode }) {
  // 'visible' initially so the first client render matches the prerendered
  // markup; the fade is only ever triggered from effects. Layout is never
  // unmounted, so once dismissed the splash stays gone for the life of the
  // page — client-side navigation cannot re-show it.
  const [splashPhase, setSplashPhase] = useState<BootSplashPhase>('visible')
  const splashRef = useRef<HTMLDivElement>(null)

  // Functional update makes dismissal one-shot: 'leaving'/'gone' never regress
  // to 'visible', however many mounted routes call dismiss.
  const dismissSplash = useCallback(() => {
    setSplashPhase(phase => (phase === 'visible' ? 'leaving' : phase))
  }, [])

  useEffect(() => {
    // First statement, before anything that could throw: this effect running at
    // all proves React hydrated, which is the only signal that tells the boot
    // watchdog to stand down.
    window.__commuteBoot?.ok()

    registerServiceWorker(createBrowserDeps(import.meta.env.PROD))
  }, [])

  useEffect(() => {
    if (splashPhase !== 'leaving') return

    const el = splashRef.current
    const finish = () => setSplashPhase('gone')
    // Guard on target and property: the wordmark's letter animations don't
    // emit transitionend, but any future child transition would bubble here.
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === 'opacity') finish()
    }

    el?.addEventListener('transitionend', handleTransitionEnd)
    // Fallback for when the transition never fires (hidden tab, transition
    // skipped): the splash must still leave the DOM.
    const timer = setTimeout(finish, 400)

    return () => {
      el?.removeEventListener('transitionend', handleTransitionEnd)
      clearTimeout(timer)
    }
  }, [splashPhase])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Commute</title>
        <meta name="description" content="Aplikasi Jadwal Kereta Buat Anak Jakarta" />
        <meta name="keywords" content="commute, jadwal kereta, kereta api, krl, jakarta, indonesia, lrt, mrt, commuter line, lrt jabodebek, mrt jakarta, lrt jakarta" />
        <meta property="og:title" content="Commute" />
        <meta property="og:description" content="Aplikasi Jadwal Kereta Buat Anak Jakarta" />
        <meta property="og:image" content="https://commute.shiorilabs.id/img/og-image.png" />
        <meta name="twitter:title" content="Commute" />
        <meta name="twitter:description" content="Aplikasi Jadwal Kereta Buat Anak Jakarta" />
        <meta name="twitter:image" content="https://commute.shiorilabs.id/img/og-image.png" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://commute.shiorilabs.id" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
        {/*
          Classic (non-module) script, so it executes synchronously and cannot
          itself be a victim of the module-loading failure it exists to catch.
          Prerendered into the static shell by the same mechanism as
          HydrateFallback, and PROD-only to match the service worker.
        */}
        {import.meta.env.PROD && (
          <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG_SOURCE }} />
        )}
      </head>
      <body className="bg-rose-50/50 text-slate-900">
        <InstallableProvider>
          <BootSplashDismissContext.Provider value={dismissSplash}>
            {children}
            {/*
              Prerendered into the static shell (Layout renders it
              unconditionally at build time), so it paints before any JS
              arrives. z-[45] keeps it above everything that can exist during
              boot — including the map morph overlay (z-40), so a direct /map
              entry crossfades the wordmark out over the skeleton already
              drawing underneath instead of the overlay hard-cutting over the
              splash — and below the boot-fallback retry panel (50).
              Permanently click-through: pre-hydration nothing beneath it is
              interactive, and the watchdog's panel is a separate element.
            */}
            {splashPhase !== 'gone' && (
              <div
                ref={splashRef}
                className={clsx(
                  'fixed inset-0 z-[45] flex items-center justify-center bg-rose-50/50 pointer-events-none',
                  splashPhase === 'leaving' && 'boot-splash-leave'
                )}
                aria-live="assertive"
                aria-busy={splashPhase === 'visible'}
                data-boot-splash
              >
                <Wordmark className="w-56 max-w-[60vw] h-auto" />
                <span className="sr-only">Memuat...</span>
              </div>
            )}
            <ScrollRestoration />
            <Scripts />
          </BootSplashDismissContext.Provider>
        </InstallableProvider>
      </body>
    </html>
  )
}

export default function App() {
  useDismissBootSplash()

  return (
    <>
      <Outlet />
    </>
  )
}

// SPA mode (ssr: false) prerenders only this root route into index.html. The
// visible boot splash lives in Layout (so it can persist past hydration and
// fade out); what remains here is the watchdog's retry panel, kept in the
// fallback on purpose: it is only reachable when hydration never happens — the
// watchdog latches once React hydrates — so parking it in Layout would carry a
// dead hidden panel and its retry wiring in the live app forever.
export function HydrateFallback() {
  return (
    <>
      {/*
        Revealed by the boot watchdog when the bundle never arrives. Styled with
        inline styles rather than Tailwind classes on purpose: one of the
        failures this handles is /assets/root-*.css coming back as the SPA
        fallback's HTML, in which case every utility class is a no-op and a
        class-styled panel would be invisible exactly when it is needed. This is
        the one place in the app where inline styles are the correct call.
      */}
      <div
        id={BOOT_FALLBACK_ID}
        hidden
        style={{
          position: 'fixed',
          inset: 0,
          // Above the boot splash (z-[45] in Layout), which is still mounted
          // and 'visible' whenever the watchdog reveals this panel.
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          background: '#fff8f8',
          color: '#0f172a',
          textAlign: 'center',
          font: '600 16px/1.5 system-ui, sans-serif'
        }}
      >
        <p id={BOOT_FALLBACK_MESSAGE_ID} style={{ margin: 0, maxWidth: '28rem' }}>
          {BOOT_FALLBACK_COPY.failed}
        </p>
        <button
          type="button"
          id={BOOT_FALLBACK_RETRY_ID}
          style={{
            padding: '10px 20px',
            borderRadius: '9999px',
            border: 'none',
            background: '#f55875',
            color: '#ffffff',
            font: 'inherit',
            cursor: 'pointer'
          }}
        >
          Muat ulang
        </button>
      </div>
    </>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Without this a first-render crash would leave the splash covering the
  // error screen forever: ErrorBoundary replaces App, so App's dismiss never
  // runs.
  useDismissBootSplash()

  let message = 'Oops!'
  let details = 'An unexpected error occurred'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details
      = error.status === 404
        ? 'The requested page could not be found'
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
