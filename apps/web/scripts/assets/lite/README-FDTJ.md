# Commute Lite

Peta integrasi transportasi Jabodetabek, versi statis yang bisa di-host sendiri.
Isinya halaman peta dan halaman cek tarif. Selebihnya (jadwal lengkap, detail
stasiun, halaman rute) tetap mengarah ke Commute versi penuh.

> **Catatan.** Paket ZIP ini opsi cadangan, buat kalau petanya mau di-host
> sendiri. Normalnya peta sudah jalan otomatis dan ikut update tiap ada rilis
> baru, jadi tidak perlu pasang manual

---

## Cara pasang

1. Ekstrak seluruh isi ZIP ini.
2. Upload semuanya ke **document root** subdomain, biasanya folder
   `public_html/` milik subdomain tersebut.
3. Pastikan `index.html` dan `.htaccess` berada langsung di folder itu, bukan di
   dalam subfolder.
4. Buka subdomainnya. Peta langsung tampil.

`.htaccess` adalah file tersembunyi. Kalau tidak terlihat di File Manager
Hostinger, aktifkan **Settings → Show hidden files**. Tanpa file ini peta masih
muncul, tapi halaman selain beranda akan error 404.

### Harus di subdomain, bukan subfolder

Contoh yang benar:

```
https://maps.transportforjakarta.or.id/
```

Contoh yang **tidak** akan berfungsi:

```
https://transportforjakarta.or.id/maps/
```

Aplikasi ini memanggil file-filenya dari path absolut (`/assets/`,
`/maps/fdtj/`). Kalau ditaruh di subfolder, semua path itu meleset dan halaman
gagal dimuat. Kalau memang perlu tampil di dalam halaman WordPress, gunakan
`<iframe>` yang menunjuk ke subdomain, jangan menyalin file-nya ke subfolder.

### HTTPS

Aktifkan SSL untuk subdomainnya. Selain soal keamanan, beberapa fitur browser
yang dipakai halaman ini memang hanya jalan di HTTPS.

---

## Kalau bermasalah

**Situs error 500 tepat setelah upload.**
Buka `.htaccess`, hapus baris yang berbunyi `Options -Indexes`, simpan.
Sebagian hosting tidak mengizinkan baris itu. Kalau masih 500, hapus juga blok
`<Files ".ht*">` sampai `</Files>` di paling bawah. Sisanya jangan diubah.

**Peta kosong / putih.**
Cek folder `maps/fdtj/` ikut terupload lengkap. Isinya 258 file dan ini bagian
terbesar dari paket, jadi paling sering gagal kalau upload terputus di tengah.

**Halaman selain beranda jadi 404.**
`.htaccess` belum ikut terupload. Lihat catatan file tersembunyi di atas.

**Peta masih versi lama setelah update.**
Minta paket baru, jangan menimpa sebagian file saja.

---

## Cara update

Minta paket ZIP baru, lalu hapus isi lama dan upload yang baru. Jangan menimpa
sebagian file: nama file JavaScript dan CSS berubah setiap build, jadi mencampur
dua versi menghasilkan situs yang tidak bisa dibuka.

Data jadwal dan tarif diambil langsung dari API secara real-time, jadi tidak
ikut di dalam paket dan tidak perlu diupdate manual. Yang perlu paket baru hanya
kalau ada perubahan peta atau perbaikan aplikasi.

---

## Catatan teknis

Aplikasi ini murni statis - tidak butuh PHP, Node.js, atau database. Cukup web
server biasa yang bisa membaca `.htaccess`.

Data diambil dari API Commute. Alamat API sudah tertanam di dalam paket saat
build, jadi mengubahnya perlu paket baru.

Halaman ini tidak memasang service worker, jadi tidak ada mode offline dan tidak
ada cache yang perlu dibersihkan di sisi pengguna.

---

<!-- BUILD_PROVENANCE -->
