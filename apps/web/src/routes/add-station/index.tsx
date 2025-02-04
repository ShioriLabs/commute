import { component$ } from '@builder.io/qwik'
import { routeLoader$, type DocumentHead } from '@builder.io/qwik-city'

const useKCIStationsList = routeLoader$(async () => {
  const response = await fetch(`${import.meta.env.PUBLIC_API_URL}/kci/stations`)
  const stations = await response.json()
  return stations
})

const useMRTJStationsList = routeLoader$(async () => {
  const response = await fetch(`${import.meta.env.PUBLIC_API_URL}/mrtj/stations`)
  const stations = await response.json()
  return stations
})

export default component$(() => {
  const kciStations = useKCIStationsList()
  const mrtjStations = useMRTJStationsList()

  return (
    <div class="p-4">
      <h2 class="font-bold text-2xl">Tambahkan Stasiun</h2>
      <ul class="mt-4">
        <li><b>Commuter Line</b></li>
        {kciStations.value.data.map(station => (
          <li key={station.id}>{station.formattedName ?? station.name}</li>
        ))}
        <li class="mt-2"><b>MRT Jakarta</b></li>
        {mrtjStations.value.data.map(station => (
          <li key={station.id}>{station.formattedName ?? station.name}</li>
        ))}
      </ul>
    </div>
  )
})

export const head: DocumentHead = {
  title: 'Tambahkan Stasiun Tersimpan - Commute',
}
