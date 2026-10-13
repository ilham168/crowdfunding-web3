# Panduan Menyiapkan Admin (Moderator) — Platform Donasi Web3

Panduan langkah demi langkah untuk pengguna **non-ahli Supabase**. Setiap langkah
disebutkan menu/tombol yang harus diklik. Simbol di awal langkah:

- **[KAMU]** — hanya kamu yang bisa melakukannya (perlu akses Dashboard Supabase
  atau Phantom milikmu).
- **[BANTUAN]** — bisa saya jalankan dari terminal repo ini.
- **[KAMU/BANTUAN]** — bisa salah satu.

> Semua nama tabel, kolom, fungsi, dan secret di bawah **sudah saya cocokkan
> dengan kode dan migration di repo ini** (bukan dari ingatan).

---

## Asumsi yang saya pakai

1. Backend Supabase kamu sudah hidup dan **semua migration sudah diterapkan**,
   termasuk `20250105000000_admin_and_campaign_reports.sql`.
2. `npm run dev` berjalan di `http://localhost:5173` dan `.env` terisi
   (`VITE_SUPABASE_URL` = `https://cnoymqsfnpwyjdwhqzfv.supabase.co`).
3. Supabase CLI `v2.116.0` terpasang dan **sudah login** (`supabase projects list`
   jalan), tapi **belum di-`link`** ke project (perintah `link` belum pernah
   dijalankan).
4. Wallet Phantom kamu sudah di jaringan **Devnet** (sama dengan `NETWORK =
   'devnet'` di `src/wallet.js`).

---

## Status project saat ini (hasil cek via terminal, tanggal panduan ini ditulis)

| Item | Status |
|---|---|
| Project ref | `cnoymqsfnpwyjdwhqzfv` (nama "crowdfunding") |
| CLI sudah `link` | Belum |
| Edge Function `verify-donation` | ✅ Ter-deploy (ACTIVE, kode refactor CORS `_shared/cors.ts`) |
| Edge Function `create-campaign` | ✅ Ter-deploy (ACTIVE, kode refactor CORS `_shared/cors.ts`) |
| Edge Function `check-admin` | ✅ Ter-deploy (ACTIVE) |
| Edge Function `set-campaign-status` | ✅ Ter-deploy (ACTIVE) |
| Edge Function `update-profile` | ✅ Ter-deploy (ACTIVE) |
| Edge Function `report-campaign` | ✅ Ter-deploy (ACTIVE) |
| Edge Function `list-campaign-reports` | ✅ Ter-deploy (ACTIVE) |
| Secret `SOLANA_NETWORK` | ✅ Sudah di-set (nilai tidak bisa dilihat dari CLI, hanya digest) |
| Secret `ALLOWED_ORIGINS` | ❌ Belum di-set (default = localhost saja, di `supabase/functions/_shared/cors.ts`) |

Semua 7 fungsi sekarang berbagi helper CORS di `supabase/functions/_shared/cors.ts`
(satu sumber kebenaran, bukan duplikasi per fungsi). Ini hasil perbaikan BUG 1:
sebelumnya `create-campaign` dan `verify-donation` membalas preflight OPTIONS
dengan **204 + body** yang membuat runtime melempar 500 tanpa header CORS →
browser memblokir POST → toast "Failed to fetch". Sejak refactor: preflight
kembali **204 tanpa body** + ACAO, dan semua jalur respons (termasuk error)
selalu memakai header CORS.

---

## 1. Konsep: apa itu "admin" di sistem ini?

Di aplikasi ini **tidak ada akun email/password**. Identitas kamu adalah
**alamat wallet Solana** (kotak panjang seperti
`7XNh7...fsPq`). Hak moderator ditentukan oleh **whitelist**: daftar
`wallet_address` yang tersimpan di tabel `public.admin_wallets`.

- Kamu jadi admin **bukan** karena kamu "login sebagai admin", tapi karena
  alamat wallet Phantom-mu **ada di tabel `admin_wallets`**.
- Siapa pun yang login memakai wallet di daftar itu → langsung punya akses
  panel Moderasi.
- Menyebut daftar admin tidak boleh bocor. Makanya tabel `admin_wallets`
  sengaja **tidak punya policy SELECT** untuk browser (lihat
  `database/migrations/20250105000000_admin_and_campaign_reports.sql`). Dari
  sisi klien, satu-satunya cara tahu "wallet ini admin?" adalah memanggil Edge
  Function `check-admin`, yang memakai **service role key** (kunci server) dan
  hanya menjawab `{ is_admin: true/false }`.
- Keamanan sesungguhnya tetap di server: operasi seperti mengubah status
  campaign (`set-campaign-status`) **memeriksa ulang whitelist dengan service
  role** dan **mengharuskan tanda tangan wallet**, jadi membekukan panel atau
  mengetik `#/admin` langsung tidak cukup — siapa pun yang bisa meniru alamat
  admin tetap ditolak karena tidak bisa menandatangani atas nama admin itu.

Ringkasnya: **"Admin" = "wallet kamu terdaftar di `admin_wallets`".**

---

## 2. Ambil alamat wallet Phantom yang akan jadi admin [KAMU]

Alamat yang kamu butuh adalah **versi LENGKAP (32–44 huruf base58)**, bukan
versi singkat seperti `7aX...3qP` yang tampil di pojok UI.

### Cara paling mudah (pakai aplikasi ini)

1. Buka `http://localhost:5173/#/login`, klik **Connect Wallet**, setujui
   popup Phantom.
2. Buka halaman **Profil** (klik chip wallet di sudut kanan atas navbar, atau
   langsung `#/profile`).
3. Di halaman Profil, alamat **lengkap** tampil di bawah nama
   (`<code id="profile-wallet">`) dan ada tombol **"Salin"**. Klik **Salin**.
   Ini memakai `navigator.clipboard` di `src/pages/profile.js` dan menyalin
   seluruh string, bukan versi singkat.

### Alternatif (dari ekstensi Phantom)

1. Klik ikon **Phantom** di toolbar browser.
2. Klik menu titik tiga / gear di pojok **kanan atas** popup → **Copy
   address** (atau klik alamat yang tampil untuk menyalin penuh).
3. Tempel di editor teks mana pun dulu untuk memastikan panjangnya (32–44
   karakter) dan **tidak ada spasi** di awal/akhir.

### Hal penting

- **Kerjakan dengan akun Phantom yang sama dengan yang dipakai login.**
  Phantom bisa menyimpan banyak akun. Jika kamu mendaftarkan wallet Akun A
  tetapi login dengan Akun B, kamu tetap ditolak.
- Alamat Solana **case-sensitive**. Jika kamu mengetik ulang manual, jangan
  sampai salah besar/kecil — lebih aman pakai tombol **Salin**.

Pada panduan ini, alamat itu saya sebut **`<WALLET_ADMIN>`**.

---

## 3. Daftarkan wallet ke `admin_wallets` [KAMU]

### 3a. Buka SQL Editor di Supabase Dashboard

1. Masuk ke [supabase.com/dashboard](https://supabase.com/dashboard).
2. Klik project **crowdfunding** (ref `cnoymqsfnpwyjdwhqzfv`).
3. Di menu kiri, klik **SQL Editor**.
4. Klik tombol **New query** (atau **+ New**).

### 3b. Cek dulu isi tabel (apakah ada placeholder palsu?)

Migration `20250105000000` menaruh baris seed dalam **komentar** (tidak
dieksekusi). Jadi sebenarnya tidak ada baris `'GANTI_DENGAN_WALLET_ADMIN_ASLI'`.
Selain itu CHECK constraint `admin_wallets_wallet_format` hanya menerima
karakter base58 dengan panjang 32–44, sedangkan `'GANTI_DENGAN_WALLET_ADMIN_ASLI'`
punya karakter `_` dan panjang 26 — **mustahil masuk**. Tetap jalankan query
di bawah untuk memastikan:

```sql
-- Seharusnya 0 baris. Kalau ada 1+ baris berawalan "GANTI", itu placeholder lama.
select wallet_address, added_at
from public.admin_wallets
where wallet_address like 'GANTI%';

-- Lihat semua admin yang ada saat ini.
select wallet_address, added_at from public.admin_wallets order by added_at;
```

Kalaupun ada placeholder (mis. pernah dijalankan manual sebelum constraint
dipasang), hapus dengan:

```sql
delete from public.admin_wallets
where wallet_address like 'GANTI%';
```

Jangan biarkan placeholder tertinggal: baris seperti itu tidak lolos check saat
SELECT, tapi bikin daftar admin "kotor". (Secara teknis constraint sudah
menolaknya sejak awal, jadi ini jaring pengaman.)

### 3c. INSERT alamat admin

Ganti `<WALLET_ADMIN>` dengan hasil salinan di bagian 2, lalu jalankan:

```sql
insert into public.admin_wallets (wallet_address)
values ('<WALLET_ADMIN>')
on conflict (wallet_address) do nothing;
```

`on conflict ... do nothing` membuatnya aman dijalankan ulang (tidak error jika
sudah ada).

### 3d. Verifikasi

```sql
select wallet_address, added_at
from public.admin_wallets
where wallet_address = '<WALLET_ADMIN>';
```

Hasil: satu baris. Alamat harus **persis sama** (case & spasi) dengan yang
tampil di halaman Profil tadi.

Cek tambahan bahwa tabel memang tidak bisa dibaca browser (harus 0 baris
policy):

```sql
select policyname from pg_policies where tablename = 'admin_wallets';
-- Hasil: kosong / tidak ada baris. Ini yang diharapkan.
```

> **Versi CLI (opsional, kalau kamu nyaman):** setelah `link`, bisa pakai
> `npx supabase db execute --project-ref cnoymqsfnpwyjdwhqzfv --sql "..."`,
> tapi perlu password database tersimpan. **SQL Editor Dashboard jauh lebih
> sederhana untuk non-ahli** — pakai itu.

---

## 4. Edge Function & secret [BANTUAN]

Semua 7 fungsi sudah ter-deploy dengan kode terbaru (termasuk refactor CORS). Dev
tidak perlu men-deploy ulang sekarang; bagian 4a tetap didokumentasikan sebagai
cara deploy/refresh bila kode berubah.

### 4a. Deploy (atau refresh) fungsi

Proyek belum di-`link`. Dua pilihan:

**Pilihan A — link dulu sekali (rekomened):**

```bash
npx supabase login
npx supabase link --project-ref cnoymqsfnpwyjdwhqzfv
```

**Pilihan B — tanpa link:** setiap perintah CLI tambahkan
`--project-ref cnoymqsfnpwyjdwhqzfv`. Contoh di bawah memakai Pilihan A
(karena sudah link).

Deploy semua fungsi (re-deploy aman dan menyegarkan kode; `_shared/cors.ts`
ikut ter-upload tiap fungsi):

```bash
for fn in check-admin set-campaign-status update-profile \
          report-campaign list-campaign-reports \
          verify-donation create-campaign; do
  npx supabase functions deploy "$fn" --no-verify-jwt
done
```

**Kenapa `--no-verify-jwt`?** Aplikasi memanggil fungsi dengan mengirim **anon
key** sebagai `Authorization: Bearer` (lihat `src/supabaseClient.js`), bukan
JWT Supabase Auth. Tanpa flag ini semua panggilan ditolak 401. Semua file di
`supabase/functions/*/index.ts` menaruh perintah deploy yang sama di komentar
header.

Cek hasil deploy:

```bash
npx supabase functions list --project-ref cnoymqsfnpwyjdwhqzfv
# Keenam fungsi harus berstatus ACTIVE.
```

Alternatif dari Dashboard: menu kiri **Edge Functions** → kamu akan melihat
daftar fungsi + versinya. (Upload manual lewat Dashboard dimungkinkan, tapi
sinkronisasi kodenya manual dan rawan salah — pakai CLI.)

### 4b. Secret / environment variable

Kode fungsi membaca dua variabel (bukan tiga; `SUPABASE_URL` dan
`SUPABASE_SERVICE_ROLE_KEY` **di-inject otomatis** oleh platform Supabase ke
setiap Edge Function — lihat pemakaian `Deno.env.get(...)` di
`supabase/functions/check-admin/index.ts` dst.):

1. **`SOLANA_NETWORK`** — dipakai `verify-donation` untuk memilih cluster
   (`Deno.env.get('SOLANA_NETWORK') || 'devnet'`). Statusnya **sudah di-set**
   (dari README). Kalau mau yakin nilainya `devnet` (harus sama dengan
   `NETWORK = 'devnet'` di `src/wallet.js`):
   ```bash
   npx supabase secrets set SOLANA_NETWORK=devnet --project-ref cnoymqsfnpwyjdwhqzfv
   ```

2. **`ALLOWED_ORIGINS`** — whitelist origin yang boleh memanggil fungsi, dipisah
   koma. **Belum di-set**, artinya semua 7 fungsi memakai default
   `http://localhost:5173` dan `http://127.0.0.1:5173` (lihat
   `DEFAULT_ALLOWED_ORIGINS` di `supabase/functions/_shared/cors.ts`). Dev aman.
   Saat nanti domain produksi aktif, wajib di-set **sekaligus menyertakan
   localhost** (kalau hanya domain produksi, dev berhenti bekerja):
   ```bash
   npx supabase secrets set \
     ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://domain-produksi-kamu" \
     --project-ref cnoymqsfnpwyjdwhqzfv
   ```
   Kabijakan CORS **seragam** untuk 7 fungsi (helper `_shared/cors.ts`): origin
   yang tidak cocok **tidak menerima header ACAO sama sekali** sehingga browser
   memblokir sendiri (strict allowlist — tidak ada wildcard `*`).
   Setelah set secret, **deploy ulang fungsi** (atau tunggu restart otomatis)
   supaya nilai baru terbaca. Urutan paling aman: set secret dulu, baru deploy.

Cek daftar secret saat ini:

```bash
npx supabase secrets list --project-ref cnoymqsfnpwyjdwhqzfv
```

> **Peringatan keras:** `SOLANA_NETWORK` dan `ALLOWED_ORIGINS` bukan rahasia,
> tapi **service role key** adalah. Jangan pernah menaruh service role key di
> frontend, di `.env` yang di-commit, atau di chat. Site Supabase otomatis
> menyuntikkannya ke Edge Function; kamu tidak perlu menyalinnya ke mana pun.
> Bila kamu melihatnya di Dashboard → Settings → API, itu hanya untuk referensi
> server — jangan dibagikan.

---

## 5. Uji bahwa admin berfungsi

Urutkan: **[KAMU]** jalankan `npm run dev` di `http://localhost:5173` (atau
sudah jalan), lalu ikuti di bawah. **[KAMU/BANTUAN]** verifikasi baris data
bisa lewat SQL Editor maupun CLI.

### 5a. Login dengan wallet admin → buka `#/admin`

1. Connect wallet **admin** di `#/login`.
2. Ketik langsung `http://localhost:5173/#/admin` di address bar (menu
   Moderasi di navbar juga akan muncul).
3. Harusnya tampil **"Panel Moderator"**, catatan `Moderator: 7XNh...fsPq` (versi
   singkat), tabel laporan, dan tabel campaign dengan **tab filter**
   (Semua/Aktif/Ditinjau/Ditutup + hitungan) dan **aksi sesuai status**:
   - **Aktif** → hanya tombol **"Tandai Ditinjau"**.
   - **Ditinjau (flagged)** → **"Aktifkan lagi"** + **"Tutup"**.
   - **Ditutup** → **tidak ada tombol aksi** (hanya badge "Ditutup").
   Sumber kebenaran aksi ini ada di `src/adminActions.js`, dijaga oleh test
   `tests/adminActions.test.js`.

> Kalau tombol/navigasi tidak muncul, lihat **Troubleshooting** bagian 6
> (paling sering: `check-admin` belum deploy atau cache 60 detik di tab).

### 5b. Login dengan wallet NON-admin → harus ditolak

1. Buka ekstensi Phantom → pilih glob/ganti ke **akun lain** (bukan akun admin).
2. Di aplikasi: **Keluar** (tombol navbar) → login kembali dengan akun itu.
3. Buka `#/admin` manual.
4. Harus tampil: teks **"Halaman ini hanya untuk moderator."** dan tautan
   **"← Kembali ke dashboard"**. Link **Moderasi** di navbar tidak muncul.

Catatan: `requireWallet()` di `src/utils.js` mengirim kamu ke `#/login` kalau
tidak ada wallet tersimpan; "ditolak" = wallet terhubung tapi bukan admin.

### 5c. Tandai campaign uji sebagai `flagged`, lalu kembalikan ke `active`

1. Login sebagai **admin**, buka `#/admin`.
2. Di baris campaign **uji** kamu, klik **"Tandai Ditinjau"**.
3. Kotak input (dari `window.prompt` di `src/pages/admin.js`) minta **alasan
   10–500 karakter**. Isi mis. `"Memerlukan verifikasi tambahan untuk penggalangan dana"`.
4. Phantom muncul → **setujui tanda tangan** (kepemilikan admin wajib dibuktikan).
5. Verifikasi efek di aplikasi (login sebagai siapa pun):
   - **Dashboard** (`#/dashboard`): kartu campaign menunjukkan badge
     **"⚠ Dilaporkan — sedang ditinjau"**.
   - **Detail campaign** (`#/campaign/<id>`): form **"Donasi Sekarang" tidak
     muncul**; ada badge + banner peringatan dengan alasanmu; **riwayat
     donasi tetap tampil** (transparansi tidak hilang).
   - **Admin panel**: baris campaign berstatus flagged + alasan tampil di kolom.
6. Kembalikan: di `#/admin` klik **"Aktifkan lagi"** (alamat/nama donasi tidak
   berubah; hanya status yang kembali `active`, dan `flag_reason` otomatis
   dikosongkan oleh DB — constraint `campaigns_flag_reason_matches_status`).

Cek di SQL Editor bahwa baris berubahnya hanya status:

```sql
select id, title, status, flag_reason, creator_wallet, campaign_wallet
from public.campaigns
where id = '<CAMPAIGN_ID>';
```

### 5d. Kirim laporan dari wallet NON-admin → muncul di antrian admin

1. Login sebagai **non-admin** (akun lain).
2. Buka detail campaign uji → klik **"Laporkan Campaign"**.
3. Isi alasan 10–500 karakter → setujui tanda tangan Phantom.
4. Harus muncul toast **"Laporan terkirim ke moderator."** dan tombol berubah
   menjadi **"Sudah Dilaporkan"**.
5. Login sebagai **admin**, buka `#/admin` → bagian **"Laporan Terbaru"** memuat
   baris: campaign (8 char id), wallet pelapor (disensor), alasan, waktu.

Catatan dari kode (`supabase/functions/report-campaign/index.ts`):
- Kamu **tidak bisa** melaporkan campaign milikmu sendiri.
- Satu wallet hanya satu laporan per campaign (kalau diulang, kembali
  `ok: true` dengan `already_reported`, bukan error).

### 5e. Bukti admin TIDAK bisa mengubah `campaign_wallet`/`title`/`creator_wallet`

Kode `set-campaign-status` hanya pernah menulis
`.update({ status, flag_reason })` — kolom identitas campaign **tidak pernah
terjangkau** oleh request HTTP mana pun (lihat `supabase/functions/set-campaign-status/index.ts`
besar-besaran). Pembuatan campaign juga memaksa `campaign_wallet ===
creator_wallet` (`supabase/functions/create-campaign/index.ts`).

Cara menguji (tanpa merusak data):

1. Sebelum moderasi, catat nilai kolom:
   ```sql
   select id, title, creator_wallet, campaign_wallet from public.campaigns
   where id = '<CAMPAIGN_ID>';
   ```
2. Lakukan moderasi (flag lalu aktifkan, atau tutup lalu aktifkan).
3. Query ulang baris yang sama. **`title`, `creator_wallet`,
   `campaign_wallet` harus identik.** Hanya `status`/`flag_reason` yang
   berubah.
4. Bukti global: query berikut seharusnya **0 baris** (selalu terpaksa sama):
   ```sql
   select count(*) as anomali from public.campaigns
   where creator_wallet <> campaign_wallet;
   ```

Bila kamu ingin menguji langsung lewat HTTP (memakai wallet admin + signature,
payload berisi field ekstra `title` palsu), hasilnya: fungsi **mengabaikan**
field itu (tidak mengubah apa pun), karena payload hanya di-parse untuk
`campaign_id`, `wallet_address`, `new_status`, `flag_reason`, `signed_message`,
`signature`, `admin_wallet`. Ini bukan bug — ini desain keamanan.

### 5f. Guard otomatis: CORS smoke test + mesin status [BANTUAN]

Dua bug yang pernah diperbaiki dijaga oleh pengujian otomatis:

1. **CORS smoke test** (`tests/e2e/cors-smoke.mjs`) — memeriksa 7 fungsi untuk:
   - preflight OPTIONS dari origin diizinkan → **204** + `Access-Control-Allow-Origin` = origin;
   - preflight dari origin asing → **tanpa ACAO** (browser memblokir sendiri);
   - POST dari origin diizinkan (body kosong, aman/tidak menulis) → respons
     apa pun **selalu membawa header ACAO**.
   ```bash
   node tests/e2e/cors-smoke.mjs
   # Semua 7 fungsi lolos CORS smoke test (204 + ACAO + POST ber-CORS).
   ```

2. **Mesin status → aksi** (`tests/adminActions.test.js`) — menjamin
   `adminActionsFor()` selalu mengembalikan: active → hanya "Tandai Ditinjau";
   flagged → "Aktifkan lagi"+"Tutup"; closed → tidak ada aksi. Termasuk dalam
   `npm test`:
   ```bash
   npx vitest run tests/adminActions.test.js
   ```

3. **Reproduksi Playwright** (`tests/e2e/repro-bug1.mjs`, `repro-bug2.mjs`) —
   memerlukan dev server di `http://localhost:5173`:
   - `repro-bug1` mensimulasikan submit campaign (wallet palsu) → bukti bahwa
     fungsi tidak lagi memblokir CORS: tanggapan server nyata (mis. 422 "Tanda
     tangan tidak valid"), bukan toast "Failed to fetch".
   - `repro-bug2` mencegat query REST campaigns dengan fixture ketiga status →
     menegaskan tombol per status + tab filter/hitungan/`aria-selected`.
   ```bash
   node tests/e2e/repro-bug1.mjs
   node tests/e2e/repro-bug2.mjs
   ```

---

## 6. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `#/admin` selalu "Halaman ini hanya untuk moderator." padahal wallet sudah didaftarkan | **`check-admin` belum di-deploy.** Frontend memperlakukan error jaringan sebagai "bukan admin" (lihat `src/adminAccess.js`) | Deploy: `npx supabase functions deploy check-admin --no-verify-jwt --project-ref cnoymqsfnpwyjdwhqzfv` lalu muat ulang. (Ini penyebab #1 saat ini.) |
| Sama seperti atas, tapi fungsi sudah deploy | Alamat di DB beda case/spasi dengan yang login | Bandingkan persis dengan yang tampil di `#/profile` (tombol Salin). Alamat Solana case-sensitive. |
| Sama seperti atas | Akun Phantom aktif berbeda dengan yang didaftarkan | Pastikan akun Phantom yang login = yang ada di `admin_wallets`. |
| Sama seperti atas | Cache `adminAccess.js` 60 detik di tab, atau `localStorage.userWallet` masih menyimpan wallet lama (mis. sebelumnya login akun lain) | Tunggu ±1 menit lalu refresh; atau **Keluar** dan login ulang dengan wallet admin. |
| Sama seperti atas | `wallet_address` di DB bukan case yang sama | `update public.admin_wallets set wallet_address='<YANG_BENAR>' where wallet_address LIKE ...` (atau delete+insert). |
| Error 401/403 dari Edge Function | Tanda tangan kedaluwarsa (> 5 menit), pesan≠payload (mis. `flag_reason` mengandung newline), atau wallet yang menandatangani beda | Muat ulang halaman (timestamp baru), pastikan alasan satu baris, pastikan wallet Phantom yang menandatangani = wallet yang login. |
| Error 403 pada `set-campaign-status` | Wallet bukan admin dan bukan creator campaign, atau signature tidak valid | Cek whitelist `admin_wallets`; lakukan ulang alur (anda harus tanda tangan pakai wallet admin). |
| Error 404 pada `set-campaign-status` | `campaign_id` salah/tidak ada | Cek UUID campaign via `select id from campaigns;` |
| 500 dari fungsi | Tabel/kolom kurang (migration belum jalan) — pesan biasanya `42P01`/`PGRST...`/"relation ... does not exist" | Jalankan migration yang sesuai, deploy ulang fungsi, muat ulang halaman. `admin.js` juga menampilkan hint "Server belum mendukung fitur ini." |
| 500 dari `check-admin` | Env service role tidak tersedia (tidak terjadi di platform) | Cek Dashboard → Edge Functions → Secrets; pastikan `SUPABASE_SERVICE_ROLE_KEY` ada (auto). |
| "Failed to fetch" | Origin tidak diizinkan CORS (akses dari domain selain localhost saat `ALLOWED_ORIGINS` belum di-set); fungsi belum deploy (404); atau URL `.env` salah | Set `ALLOWED_ORIGINS` + deploy ulang; pastikan `VITE_SUPABASE_URL` benar; cek `npx supabase functions list`. Diagnosa cepat: `node tests/e2e/cors-smoke.mjs` — pastikan preflight 204 + ACAO untuk localhost. |
| "Signature verification gagal" / pesan "tidak cocok" | Wallet pada pesan ≠ wallet di body; isi pesan diedit; timestamp melewati 5 menit; tanda tangan ditolak di Phantom | Ulangi aksi dari halaman (biarkan frontend yang membangun pesan); jangan modifikasi alamat; setujui popup Phantom. |
| Panel admin tampil tapi "Belum ada laporan" padahal sudah ada | Query anon ke `campaign_reports` diblokir (tabel tanpa policy SELECT) — ini **bukan** bug | Daftar laporan hanya muncul lewat `list-campaign-reports` (signature). Pastikan function itu deploy; muat ulang `#/admin`. |

---

## 7. Keamanan

### Menambah / mencabut admin di kemudian hari

Semua lewat SQL Editor ([KAMU]):

```sql
-- Tambah:  [KAMU]
insert into public.admin_wallets (wallet_address)
values ('<WALLET_BARU>')
on conflict (wallet_address) do nothing;

-- Cabut:
delete from public.admin_wallets
where wallet_address = '<WALLET_DICABUT>';

-- Lihat daftar:
select wallet_address, added_at from public.admin_wallets order by added_at;
```

Tidak ada jalur lain: `admin_wallets` tanpa policy INSERT/UPDATE/DELETE untuk
browser, jadi admin hanya bisa diubah lewat service role (SQL Editor Dashboard
adalah jalur paling mudah).

### Saran praktik baik

- **Gunakan wallet admin khusus** (dedicated), bukan wallet pribadi dengan
  saldo besar. Wallet admin itu sendiri mungkin dipakai untuk membayar RPC atau
  aktivitas lain; memisahkannya dari dana besar meminimalkan insentif
  penyerangan terhadap moderasimu.
- **Siapa pun yang menguasai wallet admin menguasai moderasi platform.**
  Dengan wallet itu seseorang bisa **menandai (flag) atau menutup campaign
  siapa pun** dan **membaca seluruh daftar pelapor**. (Ia tetap **tidak** bisa
  menarik dana campaign atau mengganti alamat penerima — dana selalu
  dompet-ke-dompet.) Soal ini, redam kerugian dengan: simpan seed phrase wallet
  admin di tempat aman, jangan share alamat+signature ke orang lain, dan
  putar/cabut admin yang tidak lagi diperlukan.
- Jangan pernah menaruh **service role key** di frontend / `.env` yang
  di-commit / chat. Supabase sudah menyuntikkannya ke Edge Function secara
  otomatis.

---

## Checklist "sudah selesai?"

- [ ] Saya menyalin **alamat lengkap** wallet Phantom dari `#/profile` (tombol Salin) — bukan versi singkat.
- [ ] SQL Editor: `select` tabel `admin_wallets` → **tidak ada** placeholder `GANTI%`.
- [ ] SQL Editor: `insert into public.admin_wallets (wallet_address) values ('<WALLET_ADMIN>') ...` sukses.
- [ ] SQL Editor: query verifikasi mengembalikan **1 baris** dengan alamat yang persis sama.
- [ ] `npx supabase functions list` → `check-admin`, `set-campaign-status`, `update-profile`, `report-campaign`, `list-campaign-reports` (plus `verify-donation`, `create-campaign`) berstatus **ACTIVE** (semua kode terbaru + `_shared/cors.ts`).
- [ ] Secret `SOLANA_NETWORK` = `devnet` (sudah di-set dari awal; dicek ulang bila ragu).
- [ ] Secret `ALLOWED_ORIGINS` memuat localhost dev; domain produksi dijadwalkan ditambahkan saat deploy.
- [ ] `node tests/e2e/cors-smoke.mjs` → "Semua 7 fungsi lolos CORS smoke test".
- [ ] `npx vitest run tests/adminActions.test.js` → hijau (mesin status → aksi aman).
- [ ] Browser: login wallet **admin** → `#/admin` menampilkan Panel Moderator; tab filter + aksi sesuai status (active→Tandai Ditinjau, flagged→Aktifkan lagi/Tutup, closed→tanpa aksi).
- [ ] Browser: login wallet **non-admin** → `#/admin` menampilkan "Halaman ini hanya untuk moderator."
- [ ] Browser: campaign uji di-`flagged` → badge muncul di dashboard & detail, form donasi hilang, riwayat tetap tampil.
- [ ] Browser: campaign uji dikembalikan ke `active`.
- [ ] Browser: laporan dari wallet non-admin muncul di "Laporan Terbaru" panel admin.
- [ ] SQL: `creator_wallet = campaign_wallet` untuk semua campaign (0 anomali); `title`/`creator_wallet`/`campaign_wallet` tidak berubah setelah moderasi.