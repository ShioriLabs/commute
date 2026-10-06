/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { CaretLeftIcon } from '@phosphor-icons/react'

export function meta() {
  return [
    { title: 'Kebijakan Privasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function PrivacyPolicySettingsPage() {
  return (
    <main className="overflow-x-hidden">
      <article className="bg-white w-full h-full overflow-y-auto pb-8 overflow-x-hidden">
        <div className="p-8 sticky w-full top-0 max-w-3xl mx-auto bg-white">
          <div className="flex gap-3 items-center -ml-2">
            <button
              aria-label="Kembali"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              onClick={() => history.back()}
            >
              <CaretLeftIcon weight="bold" className="w-6 h-6" />
            </button>
            <h1 className="font-bold text-2xl">Kebijakan Privasi</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p className="text-sm font-semibold">
            Efektif Sejak 6 Oktober 2026
          </p>
          <br />
          <br />
          <p>
            <b>Shiori Labs</b> (selanjutnya "Kami") berkomitmen untuk menjaga privasi Anda sebagai pengguna <b>Commute</b> (selanjutnya "Aplikasi"), baik situs web commute.shiorilabs.id maupun aplikasi Android dan Wear OS-nya.<br />
            Aplikasi tidak memerlukan akun, dan Kami tidak mengumpulkan data yang dapat mengidentifikasi Anda secara langsung.<br />
            Kebijakan Privasi ini menjelaskan informasi apa saja yang dikumpulkan saat Anda menggunakan Aplikasi, untuk apa informasi tersebut digunakan, serta bagaimana informasi tersebut disimpan dan dilindungi.<br />
          </p>
          <br />
          <h2 className="font-bold text-base">1. Informasi yang Kami Kumpulkan</h2>
          <p>Informasi berikut dikumpulkan secara otomatis, tanpa nama, email, maupun ID yang terkait dengan Anda:</p>
          <ul className="list-disc ml-4 mt-1">
            <li><b>Analitik situs web.</b> Di situs web, <i>platform</i> <b>Cloudflare Web Analytics</b> dari Cloudflare mencatat halaman yang dikunjungi dan waktu kunjungan, informasi perangkat dan browser, sistem operasi, alamat IP, serta negara asal berdasarkan alamat IP.</li>
            <li><b>Catatan server.</b> Saat situs web maupun aplikasi meminta jadwal, rute, atau tarif, server Kami mencatat data yang diminta (misalnya stasiun atau rute), versi aplikasi atau jenis browser, dan negara asal berdasarkan alamat IP. Alamat IP hanya dipakai sesaat untuk membatasi permintaan yang berlebihan dan tidak disimpan.</li>
            <li><b>Laporan galat.</b> Saat aplikasi Android berhenti mendadak atau tidak merespons, laporan galat dikirim ke <b>Sentry</b>. Laporan ini berisi rincian teknis galat, versi aplikasi, model perangkat, versi sistem operasi, kondisi perangkat (seperti memori, penyimpanan, dan baterai), bahasa dan zona waktu, serta negara asal berdasarkan koneksi, tanpa ID pengguna maupun ID perangkat.</li>
          </ul><br />
          <p>Cloudflare dan Sentry (selanjutnya "Mitra Kami") mengolah data tersebut atas nama Kami.</p>
          <br />
          <h2 className="font-bold text-base">2. Lokasi</h2>
          <p>Aplikasi Android meminta izin lokasi hanya saat Anda memakai fitur yang membutuhkannya. Lokasi Anda diolah di perangkat Anda sendiri dan tidak pernah dikirim ke server Kami.</p>
          <ul className="list-disc ml-4 mt-1">
            <li><b>Di dekat kamu.</b> Lokasi dibaca saat beranda dibuka, untuk menampilkan stasiun terdekat.</li>
            <li><b>OTW.</b> Selama perjalanan berjalan, Aplikasi membaca lokasi untuk mengetahui posisi Anda di rute dan mengingatkan Anda sebelum turun, termasuk saat Aplikasi tidak sedang dibuka. Selama itu, notifikasi perjalanan selalu tampil. Pembacaan lokasi berhenti saat perjalanan selesai.</li>
            <li><b>Catatan perjalanan.</b> Aplikasi menyimpan catatan teknis perjalanan OTW, termasuk posisi GPS, di perangkat Anda untuk membantu Kami menyempurnakan mode OTW. Catatan ini dibatasi sekitar 1 MB (bagian terlama terhapus otomatis), tidak ikut dicadangkan ke akun Google Anda, dan hanya keluar dari perangkat jika Anda sendiri membagikannya.</li>
            <li><b>Jam tangan.</b> Jika Anda memasangkan jam tangan Wear OS, status perjalanan dikirim langsung dari ponsel ke jam tangan Anda.</li>
          </ul><br />
          <p>Anda dapat mematikan penggunaan lokasi kapan saja melalui menu Pengaturan di Aplikasi atau pengaturan perangkat Anda.</p>
          <br />
          <h2 className="font-bold text-base">3. Penggunaan Data</h2>
          <p>Kami menggunakan data yang dikumpulkan untuk hal-hal seperti:</p>
          <ul className="list-disc ml-4 mt-1">
            <li>Menampilkan jadwal, rute, dan tarif yang Anda minta</li>
            <li>Analisis halaman dan fitur yang sering digunakan</li>
            <li>Menemukan dan memperbaiki galat, serta meningkatkan performa dan stabilitas Aplikasi</li>
            <li>Mengatur prioritas jalan berkembangnya Aplikasi</li>
            <li>Melindungi Aplikasi dari serangan siber dan penyalahgunaan</li>
          </ul><br />
          <p>Kami tidak akan menggunakan data tersebut untuk tujuan iklan, pelacakan, maupun menjualnya kepada pihak ketiga.</p>
          <br />
          <h2 className="font-bold text-base">4. Penyimpanan dan Keamanan</h2>
          <p>
            Semua data dikirim melalui koneksi terenkripsi (HTTPS). Data analitik dan catatan server disimpan oleh Cloudflare dan tunduk pada <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" className="text-blue-500 font-semibold">Kebijakan Privasi Cloudflare</a>; catatan server hanya disimpan selama beberapa hari. Laporan galat disimpan oleh Sentry dan tunduk pada <a href="https://sentry.io/privacy/" target="_blank" className="text-blue-500 font-semibold">Kebijakan Privasi Sentry</a>, dan terhapus otomatis paling lama 90 hari. Selain itu, Kami tidak menyimpan data pengguna di server Kami.
          </p><br />
          <h2 className="font-bold text-base">5. Hak Pengguna</h2>
          <p>
            Karena Aplikasi tidak memakai akun dan data di atas tidak dapat dikaitkan dengan identitas Anda, Kami tidak dapat menemukan, mengubah, atau menghapus data milik orang tertentu atas permintaan. Data tersebut terhapus otomatis sesuai masa simpan di atas.<br />
            Data yang tersimpan di perangkat Anda, seperti stasiun dan rute yang disimpan serta catatan perjalanan, dapat Anda hapus kapan saja dengan menghapus data Aplikasi atau mencopot Aplikasi.
          </p><br />
          <h2 className="font-bold text-base">6. Perubahan Kebijakan</h2>
          <p>
            Kebijakan ini dapat diperbarui sewaktu-waktu tanpa pemberitahuan pasti. Perubahan signifikan akan diumumkan melalui Aplikasi dan halaman ini.
          </p><br />
          <h2 className="font-bold text-base">7. Informasi Kontak</h2>
          <p>
            Jika Anda memiliki pertanyaan mengenai privasi atau kebijakan ini, silakan hubungi Kami melalui:<br />
            Email: <a href="mailto:hai@shiorilabs.id" className="text-blue-500 font-semibold">hai@shiorilabs.id</a>
          </p>
        </div>
      </article>
    </main>
  )
}
