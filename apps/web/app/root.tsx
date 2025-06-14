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
import { SWRConfig } from 'swr'
import { createStore, del, get, set, keys as getAllKeys } from 'idb-keyval'

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

const store = createStore('swr-db', 'cache-store')

export const idbCacheProvider = () => {
  const map = new Map()

  return {
    get(key: string) {
      return map.get(key)
    },
    set(key: string, value: unknown) {
      map.set(key, value)
      set(key, value, store)
    },
    delete(key: string) {
      map.delete(key)
      del(key, store)
    },
    keys() {
      return map.keys()
    },
    async hydrate() {
      const keys = await getAllKeys(store)
      for (const key of keys) {
        const value = await get(key, store)
        if (value !== undefined) {
          map.set(key, value)
        }
      }
    }
  }
}

export default function App() {
  const cache = idbCacheProvider()
  cache.hydrate()

  return (
    <SWRConfig value={{ provider: () => cache }}>
      <Outlet />
    </SWRConfig>
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
