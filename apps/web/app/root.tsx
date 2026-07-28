import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from 'react-router'
import { useEffect } from 'react'
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

export function Layout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // First statement, before anything that could throw: this effect running at
    // all proves React hydrated, which is the only signal that tells the boot
    // watchdog to stand down.
    window.__commuteBoot?.ok()

    registerServiceWorker(createBrowserDeps(import.meta.env.PROD))
  }, [])

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
          {children}
          <ScrollRestoration />
          <Scripts />
        </InstallableProvider>
      </body>
    </html>
  )
}

export default function App() {
  return (
    <>
      <Outlet />
    </>
  )
}

// SPA mode (ssr: false) prerenders only this root route into index.html. Without
// a HydrateFallback the shell is blank until the JS bundle downloads and
// hydrates — a visible gap on first load. This markup is baked into the static
// HTML, so it paints immediately and carries the user through to hydration,
// then flows straight into each route's own loading state.
export function HydrateFallback() {
  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center bg-rose-50/50"
        aria-live="assertive"
        aria-busy="true"
        data-boot-splash
      >
        <Wordmark className="w-56 max-w-[60vw] h-auto" />
        <span className="sr-only">Memuat...</span>
      </div>
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
          zIndex: 40,
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
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details
      = error.status === 404
        ? 'The requested page could not be found.'
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
