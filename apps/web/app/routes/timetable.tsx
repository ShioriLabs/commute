import type { Route } from './+types/timetable'
import { useCallback, useEffect } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { XIcon } from '@phosphor-icons/react'
import { useStationHeader } from '~/components/station-content'
import TimetableContent from '~/components/timetable-content'

export function meta() {
  return [
    { title: 'Memuat... - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function TimetablePage({ params }: Route.ComponentProps) {
  const { header } = useStationHeader(params.operator, params.code)
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  useEffect(() => {
    if (header.isLoading) return
    if (header.formattedName) {
      document.title = `${header.formattedName} - Jadwal Lengkap - Commute`
    }
  }, [header.isLoading, header.formattedName])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate(`/stations/${params.operator}/${params.code}`)
    } else {
      history.back()
    }
  }, [navigationType, navigate, params.operator, params.code])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/50 backdrop-blur sticky top-0 z-10 border-b-2 border-b-gray-50/20">
        <div className="p-8 pb-4 max-w-3xl mx-auto pointer-events-auto flex gap-4 justify-between">
          <div className="flex flex-col">
            {header.isLoading
              ? (
                  <div className="animate-pulse w-64 h-6 bg-slate-200 rounded-lg" />
                )
              : (
                  <>
                    <h1 className="font-bold text-xl">{header.formattedName}</h1>
                    <p className="text-sm text-gray-600">Jadwal Lengkap</p>
                  </>
                )}
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleBackButton}
              aria-label="Tutup halaman jadwal lengkap"
              className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
      <TimetableContent operator={params.operator} code={params.code} />
    </div>
  )
}
