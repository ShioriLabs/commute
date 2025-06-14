import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import SettingsItem from '~/components/settings-sheet/settings-item'

export function meta() {
  return [
    { title: 'Legal & Atribusi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function LegalSettingsPage() {
  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="font-bold text-2xl">Legal & Atribusi</h1>
        </div>
      </div>
      <article className="mt-8 border-b-2 border-b-slate-200 max-w-3xl mx-auto">
        <h1 className="px-8 text-slate-700">Hal-Hal Legal</h1>
        <ul>
          <SettingsItem to="/settings/legal/privacy-policy">
            Kebijakan Privasi
          </SettingsItem>
          <SettingsItem to="/settings/legal/terms-conditions">
            Syarat dan Ketentuan
          </SettingsItem>
        </ul>
      </article>
      <article className="mt-8 max-w-3xl mx-auto">
        <h1 className="px-8 text-slate-700">Atribusi</h1>
        <ul>
          <SettingsItem to="#">
            Atribusi Data
          </SettingsItem>
          <SettingsItem to="/settings/legal/oss-attributions">
            Atribusi Kode Sumber Terbuka
          </SettingsItem>
          <SettingsItem to="#">
            Atribusi Aset Kreatif
          </SettingsItem>
        </ul>
      </article>
    </main>
  )
}
