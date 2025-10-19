import { CloseButton, DialogTitle } from '@headlessui/react'
import { PushPinSimpleIcon, ArchiveIcon, FilesIcon, InfoIcon, XIcon } from '@phosphor-icons/react'
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
            <XIcon weight="bold" className="w-6 h-6" />
          </CloseButton>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white">
        <ul className="flex flex-col">
          <SettingsItem to="/settings/saved-stations">
            <PushPinSimpleIcon weight="fill" className="w-6 h-6" />
            Stasiun Disimpan
          </SettingsItem>
          <SettingsItem to="/settings/manage-data">
            <ArchiveIcon weight="fill" className="w-6 h-6" />
            Atur Data
          </SettingsItem>
          <SettingsItem to="/settings/legal">
            <FilesIcon weight="fill" className="w-6 h-6" />
            Legal & Atribusi
          </SettingsItem>
          <SettingsItem to="/settings/about">
            <InfoIcon weight="fill" className="w-6 h-6" />
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
