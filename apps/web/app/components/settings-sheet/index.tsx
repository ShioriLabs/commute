import { CloseButton, DialogTitle } from '@headlessui/react'
import { ArchiveBoxIcon, BookmarkIcon, DocumentIcon, InformationCircleIcon } from '@heroicons/react/20/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
import SettingsItem from './settings-item'

declare const __APP_VERSION__: string

export default function SettingsSheet() {
  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">Pengaturan</DialogTitle>
          <CloseButton
            aria-label="Tutup halaman pengaturan"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            aria-expanded="false"
          >
            <XMarkIcon />
          </CloseButton>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white">
        <ul className="flex flex-col">
          <SettingsItem to="/settings/saved-stations">
            <BookmarkIcon className="w-6 h-6" />
            Stasiun Disimpan
          </SettingsItem>
          <SettingsItem to="/settings/manage-data">
            <ArchiveBoxIcon className="w-6 h-6" />
            Atur Data
          </SettingsItem>
          <SettingsItem to="/settings/legal">
            <DocumentIcon className="w-6 h-6" />
            Legal & Atribusi
          </SettingsItem>
          <SettingsItem to="#">
            <InformationCircleIcon className="w-6 h-6" />
            Tentang Commute
          </SettingsItem>
        </ul>
        <span className="block mt-8 px-8 font-mono text-slate-500">
          @commute/web
          {' '}
          {__APP_VERSION__}
        </span>
      </div>
    </section>
  )
}
