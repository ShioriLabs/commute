/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { CaretLeftIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'

export function meta() {
  return [
    { title: 'Syarat & Ketentuan - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function TermsConditionsSettingsPage() {
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
              <CaretLeftIcon weight="bold" className="w-6 h-6" />
            </button>
            <h1 className="font-bold text-2xl">Syarat & Ketentuan</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p className="text-sm font-semibold">
            Efektif Sejak 15 Juni 2025
          </p>
          <br />
          <br />
          <p>
            Dengan mengakses dan menggunakan Aplikasi Commute ("Aplikasi"), Anda menyetujui Syarat dan Ketentuan ini. Jika Anda tidak setuju, silakan hentikan penggunaan.
          </p>
          <br />
          <h2 className="font-bold text-base">1. Deskripsi Layanan</h2>
          <p>
            Commute adalah aplikasi <i>open-source</i> yang menyediakan informasi jadwal transportasi secara cepat dan efisien, tanpa perlu login atau pendaftaran.<br />
            Kami berusaha menyediakan informasi yang akurat berdasarkan jadwal yang diterbitkan oleh Operator, tetapi Kami tidak bisa menjamin keakuratan atau kelengkapan data yang ditampilkan.<br />
            Gunakan Aplikasi ini sebagaimana mestinya dan jangan salahin Kami kalau keretanya telat.
          </p><br />
          <h2 className="font-bold text-base">2. Lisensi dan Keterbukaan</h2>
          <p>
            Kode sumber Aplikasi ini dirilis di bawah <a href="https://github.com/ShioriLabs/commute/blob/main/LICENSE.md" target="_blank" className="font-semibold text-blue-500">Lisensi MIT</a>, yang artinya:
          </p>
          <ul className="mt-1 list-disc ml-4">
            <li>Anda bebas menggunakan, menyalin, memodifikasi, menyebarkan, atau membuat tiruan dari proyek ini;</li>
            <li>Asal menyertakan atribusi kepada pengembang aslinya (Shiori Labs);</li>
            <li>Dan tanpa jaminan apa pun.</li>
          </ul><br />
          <p>
            Kami dengan senang hati mendukung penggunaan dan kontribusi dari para Pengguna, selama mengikuti ketentuan lisensi tersebut.
          </p><br />
          <p>
            <b>PERINGATAN:</b> Lisensi hanya berlaku pada kode sumber Aplikasi ini.
            Untuk ketentuan penggunaan Data, silakan cek <Link to="/settings/legal/data-attributions" className="font-semibold text-blue-500">Atribusi Data</Link>.
            Untuk ketentuan penggunaan Aset Kreatif (termasuk, tapi tidak terbatas pada, gambar <i>clipart</i>), silakan cek <Link to="/settings/legal/creative-assets-attributions" className="font-semibold text-blue-500">Atribusi Aset Kreatif</Link>
          </p><br />
          <h2 className="font-bold text-base">3. Data dan Privasi</h2>
          <p>
            Kami tidak mengumpulkan data pribadi Anda secara langsung. Informasi non-pribadi seperti IP dan browser mungkin dikumpulkan secara anonim oleh <b>Cloudflare Web Analytics</b>.<br />
            Lihat <Link to="/settings/legal/privacy-policy" className="font-semibold text-blue-500">Kebijakan Privasi</Link> untuk info lebih lanjut.
          </p><br />
          <h2 className="font-bold text-base">4. Batasan Tanggung Jawab</h2>
          <p>
            Aplikasi ini disediakan <b>sebagaimana adanya (as-is)</b> tanpa jaminan. Kami <b>tidak bertanggung jawab atas kerugian atau kerusakan</b> yang timbul akibat penggunaan Aplikasi ini, baik secara langsung maupun tidak langsung.
          </p><br />
          <h2 className="font-bold text-base">5. Perubahan Aplikasi</h2>
          <p>
            Aplikasi ini mungkin berubah sewaktu-waktu, baik melalui update, fitur baru, atau perubahan data. Kami tidak wajib memberi tahu sebelumnya, tapi perubahan besar akan diumumkan melalui GitHub, Aplikasi atau kanal resmi Shiori Labs.
          </p><br />
          <h2 className="font-bold text-base">6. Hukum Yang Berlaku</h2>
          <p>
            Syarat ini tunduk pada hukum yang berlaku di Republik Indonesia. Walaupun Aplikasi ini <i>open-source</i> dan bisa dipakai siapa saja di mana saja, Kami tetap beroperasi dari Indonesia.
          </p><br />
          <h2 className="font-bold text-base">7. Kontak</h2>
          <p>
            Punya pertanyaan, saran, atau pengen curhat kenapa Sudirman rame banget pas jam pulang kerja? Hubungi Kami:<br />
            Email: <a href="mailto:hai@shiorilabs.id" className="text-blue-500 font-semibold">hai@shiorilabs.id</a><br />
            Repo: <a href="https://github.com/ShioriLabs/commute" className="text-blue-500 font-semibold">ShioriLabs/commute</a><br />
            Laman Web: <a href="https://shiorilabs.id" className="text-blue-500 font-semibold">shiorilabs.id</a>
          </p>
        </div>
      </article>
    </main>
  )
}
