/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { ChevronLeftIcon } from '@heroicons/react/20/solid'

export function meta() {
  return [
    { title: 'Kebijakan Privasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function PrivacyPolicySettingsPage() {
  return (
    <main className="overflow-x-hidden">
      <article className="bg-white w-screen h-full overflow-y-auto pb-8 overflow-x-hidden">
        <div className="p-8 sticky w-full top-0 max-w-3xl mx-auto bg-white">
          <div className="flex gap-3 items-center -ml-2">
            <button
              aria-label="Kembali"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              onClick={() => history.back()}
            >
              <ChevronLeftIcon />
            </button>
            <h1 className="font-bold text-2xl">Kebijakan Privasi</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p className="text-sm font-semibold">
            Efektif Sejak 15 Juni 2025
          </p>
          <br />
          <br />
          <p>
            <b>Shiori Labs</b> (selanjutnya "Kami") berkomitmen untuk menjaga privasi Anda sebagai pengguna aplikasi <b>Commute</b> (selanjutnya "Aplikasi").<br />
            Kami tidak mengumpulkan data pribadi Anda secara langsung, namun Mitra analitik Kami mungkin menyimpan data non-pribadi untuk keperluan analitik.<br />
            Kebijakan Privasi ini menjelaskan bagaimana Kami dan Mitra analitik Kami mengumpulkan, menggunakan, menyimpan, dan melindungi informasi pribadi Anda saat menggunakan Aplikasi.<br />
          </p>
          <br />
          <h2 className="font-bold text-base">1. Informasi yang Kami Kumpulkan</h2>
          <p>Kami tidak mengumpulkan informasi identitas pribadi secara langsung. Namun, Kami menggunakan <i>platform</i> <b>Cloudflare Web Analytics</b> dari Cloudflare (selanjutnya "Mitra Kami" atau "Cloudflare") yang secara otomatis mengumpulkan informasi non-pribadi seperti:</p>
          <ul className="list-disc ml-4 mt-1">
            <li>Alamat IP</li>
            <li>Informasi perangkat dan browser Anda</li>
            <li>Sistem operasi</li>
            <li>Negara asal berdasarkan IP</li>
            <li>Halaman yang dikunjungi dan waktu kunjungan</li>
          </ul><br />
          <p>Data ini dikumpulkan secara anonim dan digunakan hanya untuk keperluan analisis lalu lintas dan performa situs.</p>
          <br />
          <h2 className="font-bold text-base">2. Penggunaan Data</h2>
          <p>Kami menggunakan data yang dikumpulkan oleh Mitra Kami untuk hal-hal seperti:</p>
          <ul className="list-disc ml-4 mt-1">
            <li>Analisis halaman yang sering dikunjungi</li>
            <li>Meningkatkan performa dan stabilitas Aplikasi</li>
            <li>Mengatur prioritas jalan berkembangnya Aplikasi</li>
            <li>Melindungi Aplikasi dari serangan siber</li>
          </ul><br />
          <p>Kami tidak akan menggunakan data tersebut untuk iklan, pelacakan, dan dijual kepada pihak ketiga</p>
          <br />
          <h2 className="font-bold text-base">3. Penyimpanan dan Keamanan</h2>
          <p>
            Semua data analitik disimpan oleh Cloudflare dan tunduk pada <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" className="text-blue-500 font-semibold">Kebijakan Privasi Cloudflare</a>. Kami tidak menyimpan data pengguna secara lokal di server Kami.
          </p><br />
          <h2 className="font-bold text-base">4. Hak Pengguna</h2>
          <p>
            Karena data dikumpulkan secara anonim dan tidak dapat dikaitkan langsung dengan identitas individu,
            Kami tidak menyimpan atau memproses data pribadi yang dapat diminta, diubah, atau dihapus oleh Pengguna.
          </p><br />
          <h2 className="font-bold text-base">5. Perubahan Kebijakan</h2>
          <p>
            Kebijakan ini dapat diperbarui sewaktu-waktu tanpa pemberitahuan pasti. Perubahan signifikan akan diumumkan melalui Aplikasi dan halaman ini.
          </p><br />
          <h2 className="font-bold text-base">6. Informasi Kontak</h2>
          <p>
            Jika Anda memiliki pertanyaan mengenai privasi atau kebijakan ini, silakan hubungi Kami melalui:<br />
            Email: <a href="mailto:hai@shiorilabs.id" className="text-blue-500 font-semibold">hai@shiorilabs.id</a>
          </p>
        </div>
      </article>
    </main>
  )
}
