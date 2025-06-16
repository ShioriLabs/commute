/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import CommuteLogotype from 'public/img/logotype.svg'

export function meta() {
  return [
    { title: 'Tentang - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

declare const __APP_VERSION__: string

export default function AboutSettingsPage() {
  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4 min-h-screen">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="font-bold text-2xl">Tentang</h1>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white px-8">
        <img src={CommuteLogotype} className="h-12" alt="Commute" />
        <h2 className="text-lg mt-4 font-bold text-[#F55875]">Aplikasi Jadwal Kereta Buat Anak Jakarta</h2>
        <p className="mt-4">
          Aplikasi Jadwal Kereta yang dibikin biar kita gak perlu buka 4 aplikasi cuma buat cek kereta berikutnya.<br />
          Mudah, cepat, gratis, dan bisa offline (kalau udah di-save stasiunnya tapi)
        </p><br />
        <p>Dibuat dengan perasaan cinta, layaknya dapet kursi kosong di <i>rush hour</i> Sudirman, oleh <b className="text-[#F55875]">Shiori Labs</b></p><br />
        <p>
          Punya pertanyaan, saran, atau pengen curhat kenapa Sudirman rame banget pas jam pulang kerja?<br />
          Langsung aja Hubungi Kami di:<br />
          Email: <a href="mailto:hai@shiorilabs.id" className="text-[#F55875] font-semibold">hai@shiorilabs.id</a><br />
          Repo: <a href="https://github.com/ShioriLabs/commute" className="text-[#F55875] font-semibold">ShioriLabs/commute</a><br />
          Laman Web: <a href="https://shiorilabs.id" className="text-[#F55875] font-semibold">shiorilabs.id</a><br />
          (tidak menerima curhatan soal percintaan)
        </p>
        <span className="block mt-8 font-mono text-slate-500">
          @commute/web {__APP_VERSION__}<br />
          dari pekerja jakarta, oleh commuter jakarta, untuk pejuang jakarta
        </span>
      </div>
    </main>
  )
}
