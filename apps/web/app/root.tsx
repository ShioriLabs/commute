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
    if (window !== undefined && import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope)
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error)
        })
    }
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
      </head>
      <body className="bg-rose-50/50 text-slate-900">
        {children}
        <ScrollRestoration />
        <Scripts />
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
