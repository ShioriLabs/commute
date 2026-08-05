import { Link, type LinkProps } from 'react-router'
import { resolveExit } from '~/lib/exit-links'

/**
 * A <Link> that knows the lite bundle exists.
 *
 * Use this anywhere a link's target might fall outside what the lite build
 * hosts — in practice, the shared station/hub sheets, which the map renders in
 * both builds. In the normal build this compiles down to a plain <Link>: Rollup
 * folds IS_LITE, `resolveExit` always returns 'internal', and the anchor branch
 * is eliminated. So call sites do not need to know which build they are in, and
 * a reader of station-sheet.tsx does not have to hold two behaviours in mind.
 *
 * `to` is narrowed to string. React Router also accepts a Partial<Path> object,
 * but serialising that for the external case is a second code path with no
 * current caller.
 */
export default function ExitLink({ to, children, ...rest }: Omit<LinkProps, 'to' | 'children'> & { to: string, children?: React.ReactNode }) {
  const target = resolveExit(to)

  if (target.kind === 'internal') {
    return <Link to={target.to} {...rest}>{children}</Link>
  }

  return (
    <a
      href={target.href}
      // A new tab so the map survives the trip out. On the lite deployment the
      // map is the whole site, and its WebGL context plus warmed tiles are
      // expensive enough that replacing them to read a timetable is a bad trade.
      target="_blank"
      // noopener alone; noreferrer would strip the Referer header, and the
      // referral from FDTJ's map to the full app is the point of the funnel.
      rel="noopener"
      {...rest}
    >
      {children}
    </a>
  )
}
