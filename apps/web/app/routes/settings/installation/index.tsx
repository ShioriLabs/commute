/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { CaretLeftIcon, CheckCircleIcon, DownloadSimpleIcon, QuestionIcon, XCircleIcon } from '@phosphor-icons/react'
import CommuteLogotype from 'public/img/logotype.svg'
import { useInstall } from '~/contexts/installable'

export function meta() {
  return [
    { title: 'Instalasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

declare const __APP_VERSION__: string

export default function InstallationSettingsPage() {
  const { isInstallable, promptInstall, showIOSInstructions, isStandalone } = useInstall()

  const handleInstallBannerButton = async () => {
    const result = await promptInstall()
    if (result) {
      localStorage.setItem('is-install-banner-dismissed', 'true')
    }
  }

  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4 min-h-screen">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <CaretLeftIcon weight="bold" className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-2xl">Instalasi</h1>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white px-8">
        <img src={CommuteLogotype} className="h-12" alt="Commute" />
        <span className="block mt-4 font-mono text-slate-500">
          @commute/web {__APP_VERSION__}<br />
        </span>
        { isStandalone
          ? (
              <>
                <div className="mt-8 flex flex-row gap-2">
                  <CheckCircleIcon weight="duotone" className="h-16 w-16 text-green-800 flex-shrink-0" />
                  <div className="flex flex-col mt-2">
                    <span className="font-bold">Terinstal</span>
                    <span>Gokil! Sekarang kamu bisa pake Commute lebih gampang!</span>
                  </div>
                </div>
              </>
            )
          : null}
        { !isStandalone && isInstallable
          ? (
              <>
                <div className="mt-8 flex flex-row gap-2">
                  <XCircleIcon weight="duotone" className="h-16 w-16 text-red-400 flex-shrink-0" />
                  <div className="flex flex-col mt-2">
                    <span className="font-bold">Belum Terinstal</span>
                    <span>Tap tombol di bawah ini untuk menginstal Commute!</span>
                  </div>
                </div>
                <button onClick={handleInstallBannerButton} className="flex flex-row w-full text-center bg-[#F55875] text-white items-center justify-center rounded-lg px-4 py-2 gap-2 cursor-pointer mt-4">
                  <DownloadSimpleIcon weight="bold" className="w-6 h-6" />
                  {' '}
                  Instal Sekarang
                </button>
              </>
            )
          : null}
        { !isStandalone && showIOSInstructions
          ? (
              <>
                <div className="mt-8 flex flex-row gap-2">
                  <XCircleIcon weight="duotone" className="h-16 w-16 text-red-400 flex-shrink-0" />
                  <div className="flex flex-col mt-2">
                    <span className="font-bold">Tidak Dalam Mode Standalone</span>
                    <span>Ikuti cara di bawah ini untuk menambahkan Commute ke home screen!</span>
                  </div>
                </div>
                <h2 className="mt-8 font-bold">Cara Menambahkan Commute ke Home Screen</h2>
                <ol className="mt-4 flex flex-col gap-4">
                  <li>
                    1. Tekan tombol titik tiga di kanan
                    <img
                      src="/ios-install-guide/step1.png"
                      alt="UI Safari pada iOS 26 dengan bottom navigation yang berisi tombol navigasi depan/belakang, address bar, dan tombol menu 3 titik"
                      className="w-full mt-2 rounded-sm"
                      width={666}
                      height={617}
                    />
                  </li>
                  <li>
                    2. Tekan <b>Share</b>
                    <img
                      src="/ios-install-guide/step2.png"
                      alt="Popup menu Safari pada iOS 26 dengan opsi Share dilingkari merah"
                      className="w-full mt-2 rounded-sm"
                      width={666}
                      height={722}
                    />
                  </li>
                  <li>
                    3. Tekan <b>More</b>
                    <img
                      src="/ios-install-guide/step3.png"
                      alt="Share sheet Safari pada iOS 26 dengan tombol More dilingkari merah"
                      className="w-full mt-2 rounded-sm"
                      width={666}
                      height={944}
                    />
                  </li>
                  <li>
                    4. Lalu scroll dan tekan <b>Add to Home Screen</b>
                    <img
                      src="/ios-install-guide/step4.png"
                      alt="Menu more pada share sheet Safari pada iOS 26 dengan tombol Add to Home Screen dilingkari merah"
                      className="w-full mt-2 rounded-sm"
                      width={666}
                      height={580}
                    />
                  </li>
                </ol>
              </>
            )
          : null}
        { (!isStandalone && !isInstallable && !showIOSInstructions)
          ? (
              <>
                <div className="mt-8 flex flex-row gap-2">
                  <QuestionIcon weight="duotone" className="h-16 w-16 text-amber-400 flex-shrink-0" />
                  <div className="flex flex-col mt-2">
                    <span className="font-bold">Status Tidak Dapat Ditentukan</span>
                    <span>Mungkin kamu sudah menginstal Commute, atau browser kamu tidak bisa menginstall aplikasi web progresif</span>
                  </div>
                </div>
              </>
            )
          : null}
      </div>
    </main>
  )
}
