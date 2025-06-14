/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { ChevronLeftIcon } from '@heroicons/react/20/solid'

export function meta() {
  return [
    { title: 'Atribusi Aset Kreatif - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function CreativeAssetsAttributionsSettingsPage() {
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
            <h1 className="font-bold text-2xl">Atribusi Aset Kreatif</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p>
            <b>Commute</b> menggunakan aset-aset kreatif berikut untuk memberikan sentuhan ajaib dari sisi visual. Kami berterima kasih kepada para kreator yang telah menyediakan aset-aset ini secara terbuka untuk digunakan oleh publik.
          </p><br />
          <ul className="flex flex-col gap-2">
            <li>
              <article>
                <h1 className="font-semibold">Irasutoya</h1>
                <a href="https://www.irasutoya.com/" target="_blank" className="text-blue-500">https://www.irasutoya.com</a>
                <p>Kami menggunakan beberapa gambar <i>clipart</i> dari Irasutoya sesuai dengan ketentuan penggunaan yang berlaku</p>
                <p>
                  © Takashi Mifune<br />
                  Lisensi lengkap bisa dilihat di <a href="https://www.irasutoya.com/p/terms.html" target="_blank" className="text-blue-500">https://www.irasutoya.com/p/terms.html</a>
                </p>
              </article>
            </li>
            <li>
              <article>
                <h1 className="font-semibold">Heroicons</h1>
                <a href="https://heroicons.com/" target="_blank" className="text-blue-500">https://heroicons.com/</a>
                <p>Ikon pada Aplikasi Kami menggunakan ikon dari koleksi Heroicons</p>
                <p>
                  © Tailwind Labs<br />
                  Lisensi lengkap bisa dilihat di <a href="https://github.com/tailwindlabs/heroicons/blob/master/LICENSE" target="_blank" className="text-blue-500">https://github.com/tailwindlabs/heroicons/blob/master/LICENSE</a>
                </p>
              </article>
            </li>
            <li>
              <article>
                <h1 className="font-semibold">Plus Jakarta Sans</h1>
                <a href="https://github.com/tokotype/PlusJakartaSans" target="_blank" className="text-blue-500">https://github.com/tokotype/PlusJakartaSans</a>
                <p>Font pada Aplikasi Kami menggunakan Plus Jakarta Sans yang terlihat modern dan menunjukkan semangat "Kota Kolaborasi"-nya Pemerintah DKI Jakarta</p>
                <p>
                  © Gumpita Rahayu dari Tokotype<br />
                  Lisensi lengkap bisa dilihat di <a href="https://github.com/tokotype/PlusJakartaSans/blob/master/OFL.txt" target="_blank" className="text-blue-500">https://github.com/tokotype/PlusJakartaSans/blob/master/OFL.txt</a>
                </p>
              </article>
            </li>
          </ul>
        </div>
      </article>
    </main>
  )
}
