import type { Route } from './+types/station'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { XIcon, PushPinIcon, PushPinSlashIcon } from '@phosphor-icons/react'
import StationContent, { useStationHeader } from '~/components/station-content'
import LineRoundel from '~/components/line-roundel'
import { sortLineKeysForDisplay } from '~/utils/lines'
import { useLines } from '~/hooks/use-lines'
import { readSavedStations, toggleSavedStation } from 'utils/saved-stations'

export function meta() {
  return [
    { title: 'Memuat... - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function StationPage({ params }: Route.ComponentProps) {
  const { lines: resolveLines } = useLines()
  const { header } = useStationHeader(params.operator, params.code)
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (header.isLoading) return
    if (!header.stationId) {
      setSaved(false)
      return
    }

    setSaved(readSavedStations().includes(header.stationId))

    if (header.name) {
      document.title = `${header.name} - Commute`
    }
  }, [header.isLoading, header.name, header.stationId])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
      history.back()
    }
  }, [navigationType, navigate])

  const handleSaveStationButton = useCallback(() => {
    if (!header.stationId) return
    setSaved(toggleSavedStation(header.stationId).includes(header.stationId))
  }, [header.stationId])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/50 backdrop-blur sticky top-0 z-10 border-b-2 border-b-gray-50/20">
        <div className="p-8 pb-4 max-w-3xl mx-auto pointer-events-auto flex gap-4 justify-between">
          <div className="flex flex-col gap-1">
            {header.isLoading
              ? (
                  <div className="animate-pulse w-64 h-6 bg-slate-200 rounded-lg" />
                )
              : (
                  <>
                    {header.lines.length > 0 && (
                      <ul className="flex flex-row gap-1 flex-wrap">
                        {resolveLines(sortLineKeysForDisplay(header.lines, params.operator)).map(line => (
                          <li key={line.lineCode}>
                            <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={params.operator} />
                            <span className="sr-only">{line.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <h1 className="font-bold text-xl">{header.name}</h1>
                  </>
                )}
          </div>
          <div className="flex gap-4">
            {header.isLoading
              ? (
                  <div className="animate-pulse w-8 h-8 bg-slate-200 rounded-full" />
                )
              : header.unserved
                ? null
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
