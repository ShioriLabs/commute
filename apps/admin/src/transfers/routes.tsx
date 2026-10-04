import { Hono, type Context } from 'hono'
import type { JSX } from 'hono/jsx/jsx-runtime'
import type { AdminEnv } from '../env'
import { Layout } from '../views/layout'
import {
  countDrafts, discardDraft, getTransfer, listQueue, listStations, markDelete, revertToImported, saveDraft, TABS, type Tab
} from './repository'
import { EditPage, NewPage, QueuePage, type FormValues } from './views'

export const transferRoutes = new Hono<AdminEnv>()

const idParam = (c: Context<AdminEnv>) => decodeURIComponent(c.req.param('id') ?? '')

async function page(c: Context<AdminEnv>, title: string, body: JSX.Element, status: 200 | 404 | 422 = 200) {
  return c.html(<Layout title={title} draftCount={await countDrafts(c.env.DB)}>{body}</Layout>, status)
}

async function readForm(c: Context<AdminEnv>) {
  const form = await c.req.parseBody()
  const text = (key: string) => (typeof form[key] === 'string' ? form[key] as string : '').trim()
  const values: FormValues = {
    distance: text('distance'),
    noTap: form.noTap === 'on',
    notes: text('notes'),
    applyReverse: form.applyReverse === 'on'
  }
  return { values, from: text('from'), to: text('to') }
}

// Empty keeps the imported distance; anything else must parse as an integer, and
// saveDraft owns the actual rules (0, negatives, new transfers).
const parseDistance = (raw: string) => raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : NaN

const blankValues: FormValues = { distance: '', noTap: false, notes: '', applyReverse: true }

transferRoutes.get('/', async (c) => {
  const requested = c.req.query('tab') as Tab | undefined
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'unmeasured'
  return page(c, 'Transfers', <QueuePage tab={tab} rows={await listQueue(c.env.DB, tab)} />)
})

transferRoutes.get('/new', async c =>
  page(c, 'Transfers · new', <NewPage stations={await listStations(c.env.DB)} values={blankValues} from="" to="" />))

transferRoutes.post('/new', async (c) => {
  const { values, from, to } = await readForm(c)
  const result = await saveDraft(c.env.DB, {
    fromStationId: from, toStationId: to, distance: parseDistance(values.distance),
    noTap: values.noTap, notes: values.notes || null, applyReverse: values.applyReverse
  }, c.var.user)
  if (!result.ok) {
    return page(c, 'Transfers · new', <NewPage stations={await listStations(c.env.DB)} values={values} from={from} to={to} error={result.error} />, 422)
  }
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.get('/:id', async (c) => {
  const detail = await getTransfer(c.env.DB, idParam(c))
  if (!detail) return page(c, 'Transfers · not found', <p>No such transfer</p>, 404)
  const current = detail.draft ?? detail.published
  const values: FormValues = {
    distance: current?.distance?.toString() ?? '',
    noTap: Boolean(current?.noTap ?? detail.base?.noTap),
    notes: current?.notes ?? detail.base?.notes ?? '',
    applyReverse: true
  }
  return page(c, `Transfers · ${detail.fromName}`, <EditPage detail={detail} values={values} />)
})

transferRoutes.post('/:id', async (c) => {
  const detail = await getTransfer(c.env.DB, idParam(c))
  if (!detail) return page(c, 'Transfers · not found', <p>No such transfer</p>, 404)
  const { values } = await readForm(c)
  const result = await saveDraft(c.env.DB, {
    fromStationId: detail.fromStationId, toStationId: detail.toStationId, distance: parseDistance(values.distance),
    noTap: values.noTap, notes: values.notes || null, applyReverse: values.applyReverse
  }, c.var.user)
  if (!result.ok) return page(c, `Transfers · ${detail.fromName}`, <EditPage detail={detail} values={values} error={result.error} />, 422)
  return c.redirect('/transfers', 303)
})

transferRoutes.post('/:id/delete', async (c) => {
  const { values } = await readForm(c)
  await markDelete(c.env.DB, idParam(c), values.applyReverse, c.var.user)
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.post('/:id/revert', async (c) => {
  const { values } = await readForm(c)
  await revertToImported(c.env.DB, idParam(c), values.applyReverse, c.var.user)
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.post('/:id/discard', async (c) => {
  await discardDraft(c.env.DB, idParam(c))
  return c.redirect('/transfers?tab=drafts', 303)
})
