import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik'
import type { DocumentHead } from '@builder.io/qwik-city'

export default component$(() => {
  const stations = useSignal<string[]>([])

  useVisibleTask$(async () => {
    const savedStations = localStorage.getItem('savedStations')
    if (savedStations) {
      stations.value = savedStations.split(/, /g)
    }
  })

  return (
    <div class="p-4">
      <h2 class="font-bold text-2xl">Stasiun Tersimpan</h2>
      {stations.value.length === 0 && (
        <>
          <p class="mt-4">Belum ada stasiun yang disimpan nih</p>
          <a href="/add-station" class="inline-block rounded py-2 px-4 mt-2 bg-blue-400 text-white">
            Tambah Stasiun
          </a>
        </>
      )}
    </div>
  )
})

export const head: DocumentHead = {
  title: 'Welcome to Qwik',
  meta: [
    {
      name: 'description',
      content: 'Qwik site description',
    },
  ],
}
