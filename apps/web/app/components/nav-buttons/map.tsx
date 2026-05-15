import { MapTrifoldIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'

interface Props {
  className?: string
}

export default function MapButton({ className }: Props) {
  return (
    <Link
      to="/map"
      className={`bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-44 max-h-32 border-2 border-rose-50 flex flex-col relative overflow-clip select-none text-left cursor-pointer scale-100 lg:hover:scale-105 transition-transform transform-gpu ease-in-out ${className ? className : ''}`}
      aria-label="Lihat peta integrasi"
    >
      <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1]">
        <MapTrifoldIcon weight="fill" className="w-12 h-12 text-slate-700" />
      </div>
      <b className="z-[2]">
        Lihat
      </b>
      <span className="text-lg leading-tight z-[2]">
        Peta
        <br />
        Integrasi
      </span>
    </Link>
  )
}
