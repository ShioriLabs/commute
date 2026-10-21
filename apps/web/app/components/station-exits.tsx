import { BusIcon, TrainSimpleIcon } from '@phosphor-icons/react'
import type { ExitSign, StationExit } from '@commute/schemas'
import ExitBadge from '~/components/exit-badge'
import PaneLink from '~/components/pane-stack/pane-link'

/*
 * A station id is `${operator}-${code}` and the code may itself contain dashes
 * only for operators we do not link to, so the first dash is the split.
 */
function stationPane(stationId: string) {
  const dash = stationId.indexOf('-')
  if (dash <= 0) return null
  return { kind: 'station' as const, operator: stationId.slice(0, dash), code: stationId.slice(dash + 1) }
}

function SignLine({ sign }: { sign: ExitSign }) {
  const pane = sign.stationId ? stationPane(sign.stationId) : null
  const Icon = sign.kind === 'BUS' ? BusIcon : TrainSimpleIcon
  const label = (
    <>
      {sign.kind ? <Icon weight="bold" className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
      <span>{sign.text}</span>
    </>
  )

  if (!pane) return <span className="flex items-center gap-1.5 text-gray-600">{label}</span>

  return (
    <PaneLink pane={pane} className="flex items-center gap-1.5 text-brand font-semibold">
      {label}
    </PaneLink>
  )
}

/**
 * The station's exits, each as the board prints it: the signed code in the
 * Jak Lingko badge, then the board's entries in their printed order. An entry
 * that names a station or halte links to it.
 *
 * Renders nothing for a station with no exits recorded, which is most of them:
 * the list is backfilled station by station, so an empty one is "not yet", and
 * a section saying so would only advertise the gap.
 */
export default function StationExits({ exits }: { exits: StationExit[] | undefined }) {
  if (!exits?.length) return null

  return (
    <section className="mt-8">
      <h2 className="font-semibold text-lg px-4">Pintu Keluar</h2>
      <ul className="flex flex-col gap-4 mt-4">
        {exits.map(exit => (
          <li key={exit.id} className="flex flex-row gap-3 px-4">
            <ExitBadge code={exit.ref} className="mt-0.5" />
            <div className="flex flex-col gap-1 min-w-0">
              {exit.name ? <span className="font-semibold">{exit.name}</span> : null}
              {exit.signs?.length
                ? (
                    <ul className="flex flex-col gap-1">
                      {exit.signs.map(sign => (
                        <li key={sign.text}><SignLine sign={sign} /></li>
                      ))}
                    </ul>
                  )
                : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
