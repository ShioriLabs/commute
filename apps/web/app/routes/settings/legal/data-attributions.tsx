/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { CaretLeftIcon } from '@phosphor-icons/react'

export function meta() {
  return [
    { title: 'Atribusi Data - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function DataAttributionsSettingsPage() {
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
            <h1 className="font-bold text-2xl">Atribusi Data</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p>
            <b>Commute</b> menggunakan data dari berbagai sumber resmi untuk tujuan agregasi dan informasi. Kami berharap para operator transportasi berikut dapat mempertimbangkan untuk menyediakan akses data yang lebih terbuka dan terstruktur bagi publik di masa mendatang.<br />
            Data yang telah kami agregasi dan proses akan tersedia melalui API publik untuk mendukung pengembangan ekosistem aplikasi transportasi yang lebih baik.<br />
            Kami percaya penggunaan data ini merupakan penggunaan wajar (fair use) untuk tujuan informasi publik dan pengembangan layanan transportasi, dengan menggunakan metode pengumpulan data yang menghormati infrastruktur server sumber.
          </p><br />
          <ul className="flex flex-col gap-2">
            <li>
              <article>
                <h1 className="font-semibold">Commuter Line</h1>
                <a href="https://commuterline.id/perjalanan-krl/jadwal-kereta" target="_blank" className="text-blue-500">https://commuterline.id/perjalanan-krl/jadwal-kereta</a>
                <p>Kami mengumpulkan data jadwal yang tersedia secara publik melalui sistem otomatis untuk menampilkan jadwal KRL Commuter Line</p>
                <p>
                  © KAI Commuter
                </p>
              </article>
            </li>
            <li>
              <article>
                <h1 className="font-semibold">MRT Jakarta</h1>
                <a href="https://jakartamrt.co.id/id/rencana-perjalanan" target="_blank" className="text-blue-500">https://jakartamrt.co.id/id/rencana-perjalanan</a>
                <p>Kami mengumpulkan data jadwal yang tersedia secara publik melalui sistem otomatis untuk menampilkan jadwal MRT Jakarta</p>
                <p>
                  © MRT Jakarta
                </p>
              </article>
            </li>
            <li>
              <article>
                <h1 className="font-semibold">LRT Jakarta</h1>
                <a href="https://www.lrtjakarta.co.id/jadwal.html" target="_blank" className="text-blue-500">https://www.lrtjakarta.co.id/jadwal.html</a>
                <p>Kami mengumpulkan data jadwal yang tersedia secara publik melalui sistem otomatis untuk menampilkan jadwal LRT Jakarta</p>
                <p>
                  © LRT Jakarta
                </p>
              </article>
            </li>
            <li>
              <article>
                <h1 className="font-semibold">LRT Jabodebek</h1>
                <a href="https://www.instagram.com/lrt_jabodebek" target="_blank" className="text-blue-500">https://www.instagram.com/lrt_jabodebek</a>
                <p>
                  Kami secara manual mengumpulkan jadwal yang dipublikasikan melalui Instagram Stories dan papan pengumuman stasiun. Transkripsi dari tangkapan layar dilakukan dengan bantuan teknologi kecerdasan buatan seperti OpenAI ChatGPT dan Anthropic Claude.
                </p>
                <p>
                  © Kereta Api Indonesia
                </p>
              </article>
            </li>
          </ul><br />
          <p>
            Meskipun Kami mengumpulkan data melalui sumber resmi tersebut, Jadwal perjalanan transportasi tersebut dapat berubah sewaktu-waktu. Silakan cek laman dan sosial media para operator tersebut untuk memastikan jadwal terkini. <br /><br />
            Operator transportasi yang ingin menyediakan akses data resmi atau memiliki pertanyaan mengenai penggunaan data dapat menghubungi kami di <a href="mailto:hai@shiorilabs.id">hai@shiorilabs.id</a>.
          </p>
        </div>
      </article>
    </main>
  )
}
