import clsx from 'clsx'
import { Hono } from 'hono'
import type { AdminEnv } from '../env'
import { Layout } from '../views/layout'
import { button, cell, errorBox, muted } from '../views/ui'
import { bumpVersion, getTransfer, listQueue, publish, versionStatus } from '../transfers/repository'

export const publishRoutes = new Hono<AdminEnv>()

const metres = (d: number | null | undefined) => d === null || d === undefined ? '' : d === 0 ? 'unmeasured' : `${d} m`

publishRoutes.get('/', async (c) => {
  const db = c.env.DB
  const rows = await listQueue(db, 'drafts')
  const details = await Promise.all(rows.map(r => getTransfer(db, r.id)))
  const status = await versionStatus(db, c.env.KV)
  const stale = status.latestPublishId !== null && status.latestPublishId !== status.liveVersion

  return c.html(
    <Layout title="Publish" draftCount={0}>
      <h1 class="mb-4 text-2xl font-semibold">Publish</h1>
      {stale && (
        <form method="post" action="/publish/bump" class="mb-6 grid max-w-xl gap-3">
          <p class={errorBox}>
            Publish
            {' '}
            {status.latestPublishId}
            {' '}
            is in the database, but the API is still on version
            {' '}
            {status.liveVersion ?? 'none'}
            .
            Riders won't see it until the version is bumped
          </p>
          <button type="submit" class={clsx(button(), 'justify-self-start')}>Retry version bump</button>
        </form>
      )}
      {rows.length === 0
        ? <p class={muted}>No draft changes</p>
        : (
            <>
              <table class="mb-4 w-full border-collapse bg-white dark:bg-neutral-900">
                <thead>
                  <tr>
                    <th class={cell}>Transfer</th>
                    <th class={cell}>Change</th>
                    <th class={cell}>Imported</th>
                    <th class={cell}>Live now</th>
                    <th class={cell}>After publish</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map(d => d && (
                    <tr>
                      <td class={cell}>
                        <a href={`/transfers/${encodeURIComponent(d.id)}`} class="text-pink-700 hover:underline dark:text-pink-400">
                          {d.fromName}
                          {' '}
                          →
                          {' '}
                          {d.toName}
                        </a>
                      </td>
                      <td class={cell}>{d.draft?.op}</td>
                      <td class={clsx(cell, 'tabular-nums')}>{d.base ? metres(d.base.distance) : <span class={muted}>none</span>}</td>
                      <td class={clsx(cell, 'tabular-nums')}>{metres(d.published?.op === 'upsert' ? (d.published.distance ?? d.base?.distance) : d.base?.distance)}</td>
                      <td class={clsx(cell, 'tabular-nums font-medium')}>{d.draft?.op === 'upsert' ? metres(d.draft.distance ?? d.base?.distance) : d.draft?.op === 'revert' ? metres(d.base?.distance) : 'removed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form method="post" action="/publish" class="grid max-w-xl gap-3">
                <p class={muted}>Clients pick this up when their HTTP cache expires (up to a few hours)</p>
                <button type="submit" class={clsx(button(), 'justify-self-start')}>
                  {`Publish ${rows.length} ${rows.length === 1 ? 'change' : 'changes'}`}
                </button>
              </form>
            </>
          )}
    </Layout>
  )
})

publishRoutes.post('/', async (c) => {
  const result = await publish(c.env.DB, c.env.KV, c.var.user)
  if (!result) return c.redirect('/publish', 303)
  return c.redirect(`/publish?${result.versionBumped ? 'done' : 'bumpFailed'}=${result.publishId}`, 303)
})

publishRoutes.post('/bump', async (c) => {
  await bumpVersion(c.env.DB, c.env.KV)
  return c.redirect('/publish', 303)
})
