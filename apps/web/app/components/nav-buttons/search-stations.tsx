import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { Link } from 'react-router'

interface Props {
  className?: string
}

export default function SearchStationsButton({ className }: Props) {
  return (
    <Link
      to="/search"
      className={`bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-40 max-h-28 border-2 border-gray-200 flex flex-col relative overflow-clip select-none ${className ? className : ''}`}
      aria-label="Cari stasiun"
    >
      <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1]">
        <MagnifyingGlassIcon className="w-12 h-12" />
      </div>
      <b className="z-[2]">Cari</b>
      <span className="text-xl z-[2]">Stasiun</span>
    </Link>
  )
}
