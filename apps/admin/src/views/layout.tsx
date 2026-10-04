import clsx from 'clsx'
import type { Child } from 'hono/jsx'
import { button } from './ui'

const NAV = [
  { href: '/transfers', label: 'Transfers', live: true },
  { href: '#', label: 'Notices', live: false },
  { href: '#', label: 'Audits', live: false },
  { href: '#', label: 'Ops', live: false },
  { href: '#', label: 'Editorials', live: false }
]

export function Layout({ title, draftCount, children }: { title: string, draftCount: number, children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Commute admin`}</title>
        <link rel="stylesheet" href="/admin.css" />
      </head>
      <body class="bg-neutral-50 pb-20 text-[15px] text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <nav class="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          {NAV.map((item) => {
            const current = item.live && title.startsWith(item.label)
            return item.live
              ? (
                  <a
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    class={clsx('whitespace-nowrap rounded-md px-2.5 py-1.5', current ? 'bg-pink-700 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
                  >
                    {item.label}
                  </a>
                )
              : <span class="whitespace-nowrap px-2.5 py-1.5 text-neutral-400">{item.label}</span>
          })}
        </nav>
        <main class="mx-auto max-w-4xl p-4">{children}</main>
        {draftCount > 0 && (
          <div class="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t-2 border-pink-700 bg-white px-4 py-3 dark:bg-neutral-900">
            <span>{`${draftCount} draft ${draftCount === 1 ? 'change' : 'changes'}`}</span>
            <a href="/publish" class={button()}>Review and publish</a>
          </div>
        )}
      </body>
    </html>
  )
}
