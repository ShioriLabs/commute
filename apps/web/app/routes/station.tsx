import type { Route } from './+types/station'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { XIcon, PushPinIcon, PushPinSlashIcon } from '@phosphor-icons/react'
import StationContent, { useStationHeader } from '~/components/station-content'

export function meta() {
  return [
    { title: 'Memuat... - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function StationPage({ params }: Route.ComponentProps) {
  const { header } = useStationHeader(params.operator, params.code)
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (header.isLoading) return
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw || !header.stationId) {
      setSaved(false)
      return
    }

    const savedStations = JSON.parse(savedStationsRaw) as string[]
    setSaved(savedStations.includes(header.stationId))

    if (header.formattedName) {
      document.title = `${header.formattedName} - Commute`
    }
  }, [header.isLoading, header.formattedName, header.stationId])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
      history.back()
    }
  }, [navigationType, navigate])

  const handleSaveStationButton = useCallback(() => {
    if (!header.stationId) return
    const savedStations = JSON.parse(localStorage.getItem('saved-stations') ?? '[]') as string[]

    if (!savedStations) {
      localStorage.setItem('saved-stations', JSON.stringify([header.stationId]))
      setSaved(true)
      return
    }

    if (savedStations.includes(header.stationId)) {
      const newSavedStations = savedStations.filter(item => item !== header.stationId)
      localStorage.setItem('saved-stations', JSON.stringify(newSavedStations))
      setSaved(false)
    } else {
      localStorage.setItem('saved-stations', JSON.stringify([...savedStations, header.stationId]))
      setSaved(true)
    }
  }, [header.stationId])

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
                  <h1 className="font-bold text-xl">{header.formattedName}</h1>
                )}
          </div>
          <div className="flex gap-4">
            {header.isLoading
              ? (
                  <div className="animate-pulse w-8 h-8 bg-slate-200 rounded-full" />
                )
              : (
                  <button
                    onClick={handleSaveStationButton}
                    aria-label={saved ? 'Hapus stasiun ini dari favorit' : 'Simpan stasiun ini ke favorit'}
                    className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer"
                  >
                    {saved
                      ? (
                          <PushPinSlashIcon weight="bold" className="w-6 h-6" />
                        )
                      : (
                          <PushPinIcon weight="bold" className="w-6 h-6" />
                        )}
                  </button>
                )}
            <button
              onClick={handleBackButton}
              aria-label="Tutup halaman stasiun"
              className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
      <StationContent operator={params.operator} code={params.code} />
    </div>
  )
}
