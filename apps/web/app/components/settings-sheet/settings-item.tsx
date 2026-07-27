import { ArrowSquareOutIcon, CaretRightIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { To } from 'react-router'
import { Link } from 'react-router'

// Either an in-app route or an outbound URL, never both.
type Props = {
  children: ReactNode
} & (
  | { to: To, href?: never }
  | { href: string, to?: never }
)

const ITEM_CLASS_NAME = 'px-8 py-6 text-lg font-semibold w-full flex items-center gap-3'

export default function SettingsItem(props: Props) {
  // Outbound links leave the app entirely, so they get the standard
  // external-link affordance instead of the chevron and open in a new context
  // — an installed PWA has no back button to return with otherwise.
  if (props.href !== undefined) {
    return (
      <li>
        <a href={props.href} target="_blank" rel="noreferrer" className={ITEM_CLASS_NAME}>
          {props.children}
          <ArrowSquareOutIcon weight="bold" className="ml-auto w-6 h-6" />
        </a>
      </li>
    )
  }

  return (
    <li>
      <Link to={props.to} className={ITEM_CLASS_NAME}>
        {props.children}
        <CaretRightIcon weight="bold" className="ml-auto w-6 h-6" />
      </Link>
    </li>
  )
}
