import { CloseButton, DialogTitle } from '@headlessui/react'
import { PushPinSimpleIcon, ArchiveIcon, FilesIcon, InfoIcon, XIcon, DownloadSimpleIcon, GearIcon, DatabaseIcon, FlaskIcon } from '@phosphor-icons/react'
import SettingsItem from './settings-item'
import { useLineIsolate } from '~/hooks/use-line-isolate'
import { useInstall } from '~/contexts/installable'

declare const __APP_VERSION__: string

export default function SettingsSheet() {
  const lineIsolate = useLineIsolate()
  const { isInstallable, showIOSInstructions } = useInstall()

  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4 [scrollbar-gutter:stable]">
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
          <SettingsItem to="/settings/installation">
            {
              isInstallable || showIOSInstructions
                ? (
                    <>
                      <DownloadSimpleIcon weight="fill" className="w-6 h-6" />
                      Instal Commute
                    </>
                  )
                : (
                    <>
                      <GearIcon weight="fill" className="w-6 h-6" />
                      Status Instalasi
                    </>
                  )

            }
          </SettingsItem>
          <SettingsItem href="https://data.commute.shiorilabs.id">
            <DatabaseIcon weight="fill" className="w-6 h-6" />
            Commute Data Platform
          </SettingsItem>
          <li>
            <label className="px-8 py-6 text-lg font-semibold w-full flex items-center gap-3 cursor-pointer">
              <FlaskIcon weight="fill" className="w-6 h-6" />
              <span className="flex flex-col">
                Sorot Lin di Peta
                <span className="text-sm font-normal text-slate-600">
                  Eksperimen. Ketuk lin di peta buat nyorot lin itu doang, baru jalan buat lin rel
                </span>
              </span>
              <input
                type="checkbox"
                className="ml-auto w-6 h-6 shrink-0 accent-[#F55875]"
                checked={lineIsolate.enabled}
                onChange={e => lineIsolate.setIsolate(e.target.checked ? 'on' : 'off')}
              />
            </label>
          </li>
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
