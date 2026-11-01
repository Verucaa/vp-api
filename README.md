# VP API — Modular REST API

REST API berbasis Node.js, Express, dan plugin ESM. Endpoint dimuat dari `src/plugins/<kategori>/<nama>.js`. API dapat dipanggil tanpa API key; perlindungan akses dasarnya adalah pembatasan laju per alamat IP client.

## Mulai lokal

Persyaratan: Node.js 20 atau lebih baru.

```bash
npm ci
cp .env.example .env
npm run dev
```

Aplikasi berjalan pada `http://localhost:3000`. Tidak ada API key yang perlu dibuat atau dikonfigurasi.

## Akses publik dan batas request

Semua endpoint API dapat dipanggil tanpa header autentikasi. Setiap alamat IP mendapat maksimum **100 request gabungan untuk semua endpoint dalam jendela 60 detik**. Jendela dimulai pada request pertama dari IP itu lalu reset otomatis setelah 60 detik; tidak ada endpoint reset manual yang terbuka. `RATE_LIMIT_MAX` boleh dipakai untuk menurunkan batas (1–100), tetapi konfigurasi di atas 100 tetap dijepit ke 100. Durasi jendela tetap 60 detik. Respons menyertakan `RateLimit-Limit`, `RateLimit-Remaining`, dan `RateLimit-Reset`; setelah kuota habis, API mengembalikan `429` beserta `Retry-After`.

Karena API tidak memakai API key, siapa pun yang mengetahui URL dapat memanggil endpoint. Pembatasan ini bukan identitas pengguna: perangkat di balik jaringan/NAT yang sama berbagi alamat IP dan kuota, sedangkan alamat IP yang berubah dapat memperoleh kuota baru. Limiter bawaan disimpan di memori proses/isolate, jadi hitungan tidak dibagi antar-instance/serverless atau lokasi Worker dan dapat mulai ulang saat instance diganti. Untuk batas global yang konsisten atau perlindungan lebih kuat, tempatkan API di belakang API gateway atau gunakan penyimpanan limiter terpusat.

IP client diambil dari koneksi langsung kecuali aplikasi berada di belakang proxy. Di belakang proxy sendiri, atur `TRUST_PROXY` hanya ke jumlah hop proxy tepercaya yang benar-benar digunakan; jangan mempercayai header forwarded dari sumber yang tidak tepercaya. Vercel menggunakan konfigurasi bawaan satu hop. `CORS_ORIGINS` menerima daftar origin browser yang dipisahkan koma; tanpa konfigurasi, pemanggilan browser lintas-origin tidak diizinkan. Untuk origin yang diizinkan, header `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, dan `Retry-After` diekspos ke browser.

Endpoint informasi tanpa autentikasi:

- `GET /health`
- `GET /api/endpoints`
- `GET /openapi.json`
- `GET /info/ip` — mengembalikan alamat koneksi yang dilihat backend kepada pemanggil itu sendiri; tidak menggunakan layanan IP pihak ketiga.

## Endpoint yang tersedia

| Kategori | Endpoint | Metode |
| --- | --- | --- |
| bypass | `/bypass/skiplink` | GET, POST |
| downloader | `/downloader/capcut` | GET, POST |
| downloader | `/downloader/instagram` | GET, POST |
| downloader | `/downloader/youtube` | GET, POST |
| info | `/info/gempa` | GET |
| info | `/info/ip` | GET |
| info | `/info/ping` | GET |
| search | `/search/pinterest` | GET, POST |
| search | `/search/soundcloud` | GET, POST |
| search | `/search/ytsearch` | GET, POST |
| tools | `/tools/tempmail` | GET, POST |
| tools | `/tools/web2apk` | GET, POST |

Daftar runtime lengkap beserta parameter dapat dilihat di `GET /api/endpoints`; spesifikasi mesin ada di `/openapi.json`. Endpoint yang hanya disebut dalam README lama tetapi tidak ada di source tidak dibuat ulang tanpa spesifikasi/integrasi yang dapat diverifikasi.

Contoh request tanpa API key:

```bash
curl --request POST 'http://localhost:3000/search/ytsearch' \
  --header 'Content-Type: application/json' \
  --data '{"query":"ambient music","limit":5}'
```

Respons sukses mengikuti format berikut:

```json
{
  "status": true,
  "creator": "Veruu",
  "result": {}
}
```

## Website, docs, dan tutorial

- Beranda: `/` — status API, batas request, IP koneksi dari backend (hanya saat API aktif), ping, dan waktu lokal browser.
- Dokumentasi: `/docs.html` — registry endpoint runtime, method, parameter, pencarian, filter kategori, dan playground.
- Cara menggunakan: `/how-to.html` — contoh cURL, JavaScript, TypeScript, Python, Go, PHP, Ruby, dan Java.

Untuk status kuota live, frontend membaca header rate-limit respons backend. IP pengunjung diambil melalui endpoint `/info/ip`; alamat tidak dikirim ke layanan pihak ketiga. Bila backend offline, IP dan ping ditandai tidak tersedia, dan request playground dinonaktifkan.

## Playground

Halaman Docs memakai daftar accordion yang ringkas, bukan cards. Tombol **Try it** atau nama endpoint membuka/menutup parameter dan form inline. Method selalu dimulai dari **GET** bila didukung; pilih **POST** hanya pada endpoint yang menyediakannya. Tombol **Confirm** mengirim request setelah form valid, lalu menampilkan status HTTP, durasi, respons JSON, dan error/rate limit bila ada. Tombol **Salin cURL** membangun contoh tanpa harus mengirim request.

Tidak ada field API key atau header autentikasi. Nilai bernama `token`, `secret`, atau `password` tidak dapat dikirim melalui GET agar tidak muncul di URL; pilih POST. Contoh cURL mengganti nilai parameter sensitif dengan placeholder. Registry backend adalah sumber ketersediaan runtime: jika `enabled: false`, alasan ditampilkan dan Confirm dinonaktifkan sebelum request. Pada Workers, `/bypass/skiplink`, `/tools/web2apk`, dan `/search/ytsearch` memang nonaktif (501). Katalog fallback/offline juga memberi label batasan Workers tersebut; ini tidak mengubah dukungan Node/Vercel saat registry Node aktif.

Accordion, filter kategori, pencarian, menu mobile, dan form dapat dipakai dengan keyboard. Enter/Space mengaktifkan tombol, Escape menutup accordion aktif dan mengembalikan fokus ke Try it. Tautan “Lewati ke konten” tersedia di setiap halaman.

## Mengubah tampilan website

Tampilan dark navy dengan aksen light blue diterapkan lewat `public/theme.css` setelah stylesheet dasar `public/styles.css`. Latar gelembung dekoratif melayang ke atas dengan CSS transform/opacity (tanpa canvas, library, CDN, atau layanan pihak ketiga), tidak menangkap klik, dan menyesuaikan layar ponsel. Pengaturan tampilan ada di `public/config.js` dan dapat diedit tanpa mengubah backend. Ubah `siteName`, `pageTitle`, `description`, `tagline`, dan `footerText` untuk identitas website; `theme` untuk warna; serta `animation` untuk latar dan efek masuk. Bagian `announcement` mengatur pengumuman awal (`enabled`, `id`, `title`, `message`, dan `buttonText`). Preferensi “Jangan tampilkan lagi” disimpan di `localStorage` per ID pengumuman; ubah `id` bila ingin pengumuman baru muncul kembali.

Untuk API pada origin yang sama, biarkan `api.baseUrl` kosong. Bila API di-host terpisah, isi URL dasarnya dan pastikan `CORS_ORIGINS` di server mengizinkan origin UI. Jangan menaruh rahasia atau API key di konfigurasi frontend. Untuk pratinjau UI tanpa backend, set `api.enabled` ke `false`; `previewEndpoints` menyediakan katalog statis dan semua request backend dinonaktifkan. Kembalikan ke `true` untuk memuat registry runtime serta mengaktifkan playground. Preferensi `prefers-reduced-motion` pengguna tetap dihormati.

### Banner video Docs

Letakkan video milikmu pada **`public/assets/image/banner.mp4`**. File dilayani sebagai **`/assets/image/banner.mp4`**, termasuk oleh penyalinan aset Cloudflare Worker. Gunakan MP4/H.264 yang kompatibel dengan browser, disarankan rasio lebar (misalnya 1920×600), ukuran kecil, dan hindari kilatan cepat. Banner terletak tepat di bawah navbar Docs. Saat video berhasil dimuat, banner memutarnya otomatis dengan `loop`, `muted`, dan `playsinline`; tersedia kontrol Jeda/Putar.

Jika file belum ditambahkan, format video tidak didukung, atau loading gagal, banner tetap menampilkan fallback grafis orbit/nebula CSS. File video contoh tidak disertakan. Bila `prefers-reduced-motion: reduce` aktif atau `animation.enabled` dimatikan, gelembung/animasi berhenti dan video tidak dimuat/diputar otomatis. Perubahan preferensi reduced-motion saat halaman terbuka juga menghentikan video.

### Demo frontend statis yang aman

Script `npm run demo:build` membuat folder `.demo-static/` terpisah berisi hanya HTML/CSS/JS publik dan video opsional yang benar-benar dipakai. Salinan `config.js` di folder itu memaksa `api.enabled: false`, mengosongkan `baseUrl`, menyembunyikan tautan OpenAPI, dan mematikan pengumuman awal; konfigurasi proyek utama tetap aktif. Tidak ada source backend, `.env`, secrets, binding, atau route API di dalam demo. **Confirm tetap nonaktif untuk semua endpoint**; jangan menyamakan demo UI dengan layanan API online. Jangan deploy folder proyek penuh untuk preview publik.

## Menambah plugin

Buat `src/plugins/<kategori>/<nama>.js` dengan ekspor default seperti berikut:

```js
export default {
  name: "Contoh",
  category: "tools",
  description: "Contoh endpoint",
  method: ["GET", "POST"],
  timeout: 20_000,
  params: {
    query: { type: "string", required: true, maxLength: 200 }
  },
  execute: async (_req, _res, { input, signal }) => ({
    query: input.query,
    timestamp: new Date().toISOString()
  })
};
```

`timeout` dibatasi sampai 300 detik. Untuk HTTP keluar, gunakan `safeFetch` dari `src/function.js`; helper ini hanya mengizinkan HTTPS secara default, menolak alamat privat/khusus, memvalidasi ulang pengalihan, mengikat DNS socket ke alamat publik, dan memberi timeout yang mencakup pembacaan body. Jika integrasi perlu host tertentu, sediakan `allowedHosts` pada opsi. Teruskan `signal` bila memungkinkan supaya request berhenti saat klien terputus.

## Pengamanan URL dan batasan

Input URL yang digunakan untuk fetch divalidasi terhadap IP privat, loopback, link-local, alamat khusus, DNS yang menunjuk ke rentang tersebut, dan pengalihan ke jaringan privat. URL ber-username/password dan koneksi HTTP biasa ditolak oleh helper kecuali plugin secara eksplisit mengizinkan HTTP untuk kompatibilitas shortlink. Ini mengurangi risiko SSRF, tetapi tidak mengubah kebijakan atau perilaku layanan pihak ketiga yang dipanggil plugin.

Limiter dan cache bawaan berada di memori; keduanya tidak dibagi lintas instance. Plugin yang bergantung pada API/situs eksternal dapat berubah atau berhenti sewaktu-waktu, dan test lokal tidak membuktikan ketersediaan layanan pihak ketiga.

## Test

```bash
npm test
```

## Deploy

Konfigurasi Vercel menyertakan plugin dan aset media untuk fungsi `api/index.js`. Tidak ada `API_KEY`/`API_KEYS` yang perlu diisi untuk membuka endpoint plugin. Sesuaikan batas durasi fungsi dengan kebijakan paket hosting dan kebutuhan integrasi yang paling lama (`/tools/web2apk` dapat berjalan hingga sekitar 130 detik pada sisi aplikasi). Untuk memperbarui deployment yang terhubung ke proyek Vercel, jalankan `npx vercel --prod` dari direktori proyek (atau push ke branch Git yang memicu deployment). Backend untuk deployment Vercel dikelola terpisah dari demo frontend statis; demo tidak memuat source backend, rahasia, atau request yang menghubungi API.


## Deploy ke Cloudflare Workers

Target Workers memakai entry point terpisah (`src/worker/index.ts`) dan adapter HTTP Node yang direkomendasikan Cloudflare. Source Node/Vercel, `api/index.js`, dan `vercel.json` tetap dipertahankan. Asset `public/` dan `media/` disalin saat build ke `.worker-assets/`; folder asset asli tidak dimodifikasi. Adapter static asset menjalankan Worker terlebih dahulu agar limiter berlaku untuk halaman dan file statis juga, kemudian mengirim asset ke binding `ASSETS`.

### Persyaratan akun dan langkah deploy

Siapkan Node.js 20 atau lebih baru, npm, akun Cloudflare yang memiliki izin Workers & Pages, dan aktifkan subdomain `workers.dev` pada akun tersebut. Login Cloudflare tidak diperlukan untuk test lokal atau dry-run; diperlukan ketika benar-benar deploy. Tidak ada API key aplikasi, secret provider, database, maupun binding rahasia yang perlu diisi untuk konfigurasi dasar ini.

Dari direktori proyek, jalankan urutan berikut:

```bash
npm ci
npm run cf:build
npm run cf:dev
```

`cf:build` menyiapkan asset, membuat tipe binding dengan Wrangler, memeriksa TypeScript, lalu menjalankan `wrangler deploy --dry-run` tanpa mengunggah Worker. `cf:dev` menjalankan test lokal pada `http://127.0.0.1:8787`; uji `/`, `/docs.html`, `/how-to.html`, `/health`, `/api/endpoints`, dan `/openapi.json` sebelum deploy. Hentikan dev server dengan `Ctrl+C`.

Jika belum login di komputer tersebut, jalankan `npx wrangler login` dan selesaikan otorisasi melalui Cloudflare. Pastikan akun yang dipilih benar, Workers & Pages tersedia, dan akun memiliki subdomain `workers.dev`. Setelah itu deploy secara eksplisit dengan:

```bash
npm run cf:deploy
```

Perintah tersebut membangun ulang asset dan tipe, menjalankan typecheck, lalu memanggil `wrangler deploy`. Wrangler menampilkan URL `workers.dev` setelah deploy; buka URL tersebut untuk memeriksa homepage, `/docs.html`, `/how-to.html`, `/health`, `/api/endpoints`, `/openapi.json`, serta `/info/ip`. Untuk deployment berikutnya, ulangi `npm run cf:deploy` setelah source/config berubah. Jangan menambahkan token Cloudflare ke `.env` atau frontend; login Wrangler memakai otorisasi akun lokal.

Atur origin browser dengan mengisi `CORS_ORIGINS` di `vars` dalam `wrangler.jsonc`, berupa daftar origin yang dipisahkan koma, lalu jalankan ulang build/deploy. `RATE_LIMIT_MAX` mengatur batas per IP dan hanya dapat diturunkan dari default 100; durasinya selalu 60.000 ms. Nilai ini adalah konfigurasi, bukan secret. Jangan percaya header `X-Forwarded-For` yang dikirim client: adapter Worker mengambil identitas dari `CF-Connecting-IP` yang disediakan Cloudflare dan hanya meneruskan nilai tersebut ke Express.

### Endpoint dan batas runtime Workers

Pada Workers, sembilan dari dua belas route tersedia: `/downloader/capcut`, `/downloader/instagram`, `/downloader/youtube`, `/info/gempa`, `/info/ip`, `/info/ping`, `/search/pinterest`, `/search/soundcloud`, dan `/tools/tempmail`. Tiga route tetap terdaftar di `/api/endpoints` dan OpenAPI, tetapi sengaja mengembalikan `501` dengan alasan yang jelas: `/bypass/skiplink` dan `/tools/web2apk` menerima/menindaklanjuti URL arbitrer yang tidak dapat diamankan dengan DNS socket pinning pada Workers; `/search/ytsearch` bergantung pada pola jaringan Node yang tidak dipakai oleh entry Worker. Ketiganya tetap berjalan pada adapter Node/Vercel yang memakai validasi SSRF dan DNS pinning sebelumnya.

Worker tidak memuat watcher filesystem maupun loader plugin dengan dynamic import; registry Worker bersifat statis. Plugin aktif mengimpor adapter `safeFetch` Worker dan menerapkan allowlist host provider. DNS Workers menggunakan DNS-over-HTTPS, bukan socket resolver Node, dan outbound fetch tidak bisa dipaksa terhubung ke alamat IP hasil resolusi yang sama; karena itu host provider dibatasi dan fitur dengan tujuan arbitrer dinonaktifkan. Dokumentasi resmi tentang [dukungan Node.js](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [DNS Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/), [static assets binding](https://developers.cloudflare.com/workers/static-assets/binding/), serta [batas platform](https://developers.cloudflare.com/workers/platform/limits/) menjelaskan batas yang berlaku.

Limiter membatasi maksimum 100 request per 60 detik per IP, tetapi penyimpanan limiter/cache proyek ini berada di memori isolate dan bukan penghitung global lintas semua lokasi/instance. Ini bukan limiter terdistribusi; jika aplikasi nanti membutuhkan kuota global yang konsisten, pasang Cloudflare Rate Limiting atau Durable Object sesuai kebutuhan sebelum mengandalkannya untuk kebijakan kuota lintas isolate. Pada Worker, `/info/ping` tidak melaporkan uptime atau memory process karena isolate bersifat sementara dan metrik itu tidak diekspos; field tersebut menjelaskan keterbatasan alih-alih menampilkan angka tebakan. Endpoint pihak ketiga tetap bergantung pada ketersediaan, perubahan autentikasi, anti-bot, kuota, dan subrequest/CPU limits platform; sukses test lokal tidak menjamin provider eksternal selalu tersedia.

### Diagnosis respons `Endpoint gagal dijalankan`

Route yang gagal saat menjalankan plugin mengembalikan HTTP `502` dengan pesan generik agar detail error provider tidak bocor ke klien. Respons juga menyertakan header `X-Request-ID`; cari nilai yang sama pada log Worker dengan awalan `[Endpoint Error]` untuk melihat pesan internal. Saat meminta bantuan, sertakan path endpoint, metode HTTP, status, waktu kejadian, dan ID tersebut. Hapus token, password, API key, alamat email privat, serta nilai sensitif lain dari parameter atau log yang dibagikan. Status `501` berbeda: route itu memang dinonaktifkan pada Workers dan alasannya ada di `/api/endpoints`.

Konfigurasi dasar tidak memerlukan resource Worker tambahan. Rujuk [panduan resmi Cloudflare untuk Express](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/) untuk detail adapter HTTP dan `nodejs_compat`, serta [panduan Wrangler](https://developers.cloudflare.com/workers/get-started/guide/) untuk setup akun dan deployment.


Catatan audit dependency: `npm audit --omit=dev` melaporkan advisori moderat pada rantai `yt-search` → `node-fzf`/`redstar` → `minimatch` (resolusi saat ini `minimatch@3.1.4`). Perbaikan otomatis npm menawarkan downgrade major `yt-search` ke `0.0.2`; itu tidak diterapkan agar perilaku Node/Vercel yang ada tidak berubah diam-diam. Worker tidak mengimpor atau membundel plugin `/search/ytsearch`, tetapi endpoint tersebut tetap ada pada Node/Vercel dan sebaiknya ditinjau jika tetap dipublikasikan.
