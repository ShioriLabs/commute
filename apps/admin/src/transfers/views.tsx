import clsx from 'clsx'
import type { QueueRow, Tab, TransferDetail } from './repository'
import { TABS } from './repository'
import { badge, button, cell, errorBox, field, muted, stack } from '../views/ui'

const TAB_LABEL: Record<Tab, string> = {
  'unmeasured': 'Unmeasured',
  'missing-reverse': 'Missing reverse',
  'deletes': 'Deleted',
  'drafts': 'Drafts'
}

const href = (id: string) => `/transfers/${encodeURIComponent(id)}`
const isBlocked = (notes: string | null) => notes !== null && /^blocked\b/i.test(notes)
const link = 'text-pink-700 underline-offset-2 hover:underline dark:text-pink-400'

export function QueuePage({ tab, rows }: { tab: Tab, rows: QueueRow[] }) {
  return (
    <>
      <h1 class="mb-3 text-2xl font-semibold">Transfers</h1>
      <div class="mb-3 flex flex-wrap gap-2">
        {TABS.map(t => (
          <a
            href={`/transfers?tab=${t}`}
            aria-current={t === tab ? 'page' : undefined}
            class={clsx('rounded-md px-2.5 py-1', t === tab ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
          >
            {TAB_LABEL[t]}
          </a>
        ))}
        <a href="/transfers/new" class={clsx('ml-auto', button('secondary'))}>+ New transfer</a>
      </div>
      {rows.length === 0
        ? <p class={muted}>Nothing here</p>
        : (
            <table class="w-full border-collapse bg-white dark:bg-neutral-900">
              <thead>
                <tr>
                  <th class={cell}>From</th>
                  <th class={cell}>To</th>
                  <th class={cell}>Distance</th>
                  <th class={cell}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr>
                    <td class={cell}>
                      <a href={href(r.id)} class={link}>{r.fromName}</a>
                      {' '}
                      <span class={muted}>{r.fromOperator}</span>
                    </td>
                    <td class={cell}>
                      {r.toName}
                      {' '}
                      <span class={muted}>{r.toOperator}</span>
                    </td>
                    <td class={clsx(cell, 'tabular-nums')}>{r.distance === 0 ? <span class={muted}>unmeasured</span> : `${r.distance} m`}</td>
                    <td class={clsx(cell, 'space-x-1')}>
                      {isBlocked(r.notes) && <span class={badge('warn')}>blocked</span>}
                      <span>{r.notes}</span>
                      {r.draftOp && (
                        <span class={badge()}>{`draft: ${r.draftOp}`}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </>
  )
}

export interface FormValues { distance: string, noTap: boolean, notes: string, applyReverse: boolean }

function Fields({ values }: { values: FormValues }) {
  return (
    <>
      <label class="grid gap-1">
        Distance (m, gate to gate)
        <input name="distance" inputmode="numeric" value={values.distance} placeholder="Empty keeps the imported value" class={field} />
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" name="noTap" checked={values.noTap} />
        {' '}
        No tap (stays inside one paid zone)
      </label>
      <label class="grid gap-1">
        Notes
        <textarea name="notes" rows={3} placeholder="e.g. blocked: flyover demolition" class={field}>{values.notes}</textarea>
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" name="applyReverse" checked={values.applyReverse} />
        {' '}
        Apply to the reverse direction too
      </label>
    </>
  )
}

const Back = () => <p class="mb-2"><a href="/transfers" class={link}>← Transfers</a></p>

export function EditPage({ detail, values, error }: { detail: TransferDetail, values: FormValues, error?: string }) {
  const action = href(detail.id)
  const none = (text = 'none') => <span class={muted}>{text}</span>
  return (
    <>
      <Back />
      <h1 class="text-2xl font-semibold">
        {detail.fromName}
        {' '}
        →
        {' '}
        {detail.toName}
      </h1>
      <p class={clsx(muted, 'mb-4 font-mono text-sm')}>{detail.id}</p>
      <table class="mb-4 w-full max-w-md border-collapse">
        <tbody>
          <tr>
            <th class={cell}>Imported</th>
            <td class={cell}>{detail.base ? `${detail.base.distance} m${detail.base.notes ? ` · ${detail.base.notes}` : ''}` : none('none (added by admin)')}</td>
          </tr>
          <tr>
            <th class={cell}>Live override</th>
            <td class={cell}>{detail.published ? `${detail.published.op} ${detail.published.distance ?? ''}` : none()}</td>
          </tr>
          <tr>
            <th class={cell}>Draft</th>
            <td class={cell}>{detail.draft ? `${detail.draft.op} ${detail.draft.distance ?? ''}` : none()}</td>
          </tr>
        </tbody>
      </table>
      {error && <p class={clsx(errorBox, 'mb-4 max-w-md')}>{error}</p>}
      <form class={stack} method="post" action={action}>
        <Fields values={values} />
        <button type="submit" class={button()}>Save draft</button>
      </form>
      <div class="mt-8 flex max-w-md flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <form method="post" action={`${action}/delete`}>
          <input type="hidden" name="applyReverse" value="on" />
          <button type="submit" class={button('secondary')}>Delete (both directions)</button>
        </form>
        {detail.published && (
          <form method="post" action={`${action}/revert`}>
            <input type="hidden" name="applyReverse" value="on" />
            <button type="submit" class={button('secondary')}>Revert to imported (both directions)</button>
          </form>
        )}
        {detail.draft && (
          <form method="post" action={`${action}/discard`}>
            <button type="submit" class={button('secondary')}>Discard draft</button>
          </form>
        )}
      </div>
    </>
  )
}

export function NewPage({ stations, values, from, to, error }: {
  stations: { id: string, name: string, operator: string }[]
  values: FormValues
  from: string
  to: string
  error?: string
}) {
  return (
    <>
      <Back />
      <h1 class="mb-4 text-2xl font-semibold">New transfer</h1>
      {error && <p class={clsx(errorBox, 'mb-4 max-w-md')}>{error}</p>}
      <datalist id="stations">
        {stations.map(s => <option value={s.id}>{`${s.name} (${s.operator})`}</option>)}
      </datalist>
      <form class={stack} method="post" action="/transfers/new">
        <label class="grid gap-1">
          From (station id)
          <input name="from" list="stations" value={from} required class={field} />
        </label>
        <label class="grid gap-1">
          To (station id)
          <input name="to" list="stations" value={to} required class={field} />
        </label>
        <Fields values={values} />
        <button type="submit" class={button()}>Save draft</button>
      </form>
    </>
  )
}
