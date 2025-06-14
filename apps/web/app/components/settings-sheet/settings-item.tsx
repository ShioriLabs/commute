import { ChevronRightIcon } from '@heroicons/react/20/solid'
import type { ReactNode } from 'react'
import type { To } from 'react-router'
import { Link } from 'react-router'

interface Props {
  children: ReactNode
  to: To
}

export default function SettingsItem({ children, to }: Props) {
  return (
    <li>
      <Link to={to} className="px-8 py-6 text-lg font-semibold w-full flex items-center gap-3">
        {children}
        <ChevronRightIcon className="ml-auto w-8 h-8" />
      </Link>
    </li>
  )
}
