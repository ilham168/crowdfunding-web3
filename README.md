# Platform Donasi Web3 (Solana)

Kerangka aplikasi crowdfunding berbasis blockchain Solana. Donasi dikirim
**langsung dompet-ke-dompet** (non-custodial) dan setiap transaksi bisa
diverifikasi siapa saja lewat Solana Explorer — inilah yang membuat arus
kasnya transparan.

## Struktur Proyek

```
index.html
src/
  main.js                 # entry point, daftar semua rute
  router.js                # router SPA berbasis hash (#/dashboard, dst)
  wallet.js                 # koneksi Phantom wallet + kirim SOL
  supabaseClient.js         # klien Supabase
  utils.js                  # helper (escape html, format tanggal, dll)
  style.css
  components/
    nav.js                  # navbar bersama
    ui.js                   # toast, skeleton, busy state, latar partikel
    particles.js            # latar kanvas partikel antigravitasi
  pages/
    login.js                # halaman connect wallet
    dashboard.js             # daftar semua campaign
    createCampaign.js         # form buat campaign baru (verifikasi kepemilikan)
    campaignDetail.js         # detail campaign + form donasi + riwayat
    transparency.js           # buku kas global semua donasi
database/
  schema.sql                # skema tabel Supabase + RLS
supabase/
  functions/
    verify-donation/         # Edge Function verifikasi donasi on-chain
    create-campaign/         # Edge Function buat campaign (verifikasi kepemilikan wallet)
.env.example
```

## Alur Aplikasi

1. **Login** (`#/login`) — pengguna klik "Connect Wallet", Phantom membuka
   popup, pengguna menandatangani pesan (bukti kepemilikan wallet, tanpa
   password). Wallet address disimpan dan dicatat ke tabel `users`.
2. **Dashboard** (`#/dashboard`) — daftar semua campaign beserta progress
   bar (total donasi terkumpul / target).
3. **Buat Campaign** (`#/create`) — siapa pun yang sudah login bisa membuat
   campaign baru dengan judul, deskripsi, target, dan alamat dompet
   penerima dana.
4. **Detail Campaign** (`#/campaign/:id`) — form donasi mengirim SOL
   langsung dari wallet donatur ke wallet campaign via
   `SystemProgram.transfer`, lalu signature transaksinya dicatat ke tabel
   `donations` untuk ditampilkan di riwayat. Setiap baris riwayat tertaut
   ke Solana Explorer.
5. **Transparansi** (`#/transparency`) — "buku kas" global: seluruh donasi
   dari seluruh campaign, urut terbaru, dengan total keseluruhan dan link
   bukti transaksi masing-masing.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Buat project di [Supabase](https://supabase.com), lalu jalankan isi
   `database/schema.sql` di SQL Editor Supabase.
3. Salin `.env.example` menjadi `.env` dan isi dengan URL + anon key
   project Supabase kamu:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=ey...
   ```
4. Deploy Edge Functions (verifikasi donasi + pembuatan campaign aman, lihat
   bagian "Keamanan" di bawah):
   ```bash
   # instal CLI Supabase & login
   npx supabase login
   npx supabase link --project-ref <ref-project-kamu>
   npx supabase functions deploy verify-donation --no-verify-jwt
   npx supabase functions deploy create-campaign --no-verify-jwt
   npx supabase secrets set SOLANA_NETWORK=devnet
   npx supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,https://domain-produksi-kamu
   ```
   - `SOLANA_NETWORK` harus disamakan dengan `NETWORK` di `src/wallet.js`.
   - `ALLOWED_ORIGINS` adalah daftar origin (dipisah koma) yang boleh memanggil
     fungsi ini dari browser. Default tanpa di-set: `http://localhost:5173`
     (dev). Jangan set `*` — batasi ke domain aplikasimu.
5. Jalankan mode development:
   ```bash
   npm run dev
   ```
6. Pastikan ekstensi [Phantom Wallet](https://phantom.app/) terpasang di
   browser, dan wallet-nya sudah di-set ke jaringan **Devnet** (samakan
   dengan `NETWORK` di `src/wallet.js`) supaya bisa tes pakai SOL devnet
   gratis dari [faucet](https://faucet.solana.com/).

## Keamanan Donasi (Edge Function verify-donation)

Insert ke tabel `donations` **tidak** dilakukan dari sisi klien. Saat
seseorang berdonasi:

1. Situs memanggil `sendDonation` → SOL dikirim langsung dompet-ke-dompet.
2. Signature hasil transaksi dikirim ke Edge Function
   `verify-donation`.
3. Edge Function memverifikasi transaksi itu **benar-benar ada di jaringan
   Solana**: ditandatangani oleh si donatur, dan penerima campaign menerima
   **tepat** sejumlah `amount_sol` (dari pre/post balances).
4. Baru setelah valid, donasi dicatat ke tabel `donations` memakai service
   role key.

Dengan begitu, tidak ada yang bisa memasukkan baris donasi palsu — setiap
baris dijamin merefleksikan transaksi nyata. Sumber kebenaran transparansi
tetaplah blockchain; tabel hanya cache UI yang sudah diverifikasi server.

### Pengerasan keamanan lain yang sudah diterapkan

- **CORS ketat di Edge Function**: `ALLOWED_ORIGINS` whitelist. Origin yang
  tidak dikenal ditolak 403 (bukan wildcard `*`).
- **RLS**: tabel `donations` TIDAK punya policy insert publik. Verifikasi:
  `select policyname from pg_policies where tablename = 'donations';`
  → hanya `public read donations`. Tabel `campaigns` juga tidak punya insert
  publik (pembuatan lewat Edge Function).
- **CHECK constraint di DB** (format base58 wallet, signature ~87 char,
  batas jumlah) + validasi input di klien dan Edge Function (UUID campaign,
  bounds amount, format tx_signature).
- **`tx_signature` UNIQUE** mencegah replay/duplikasi transaksi yang sama.

### Keamanan Campaign (Edge Function create-campaign)

Insert ke tabel `campaigns` **tidak** bisa dilakukan dari sisi klien. Saat
seseorang membuat campaign:

1. Klien menandatangani pesan yang mengikat `campaign_wallet` + judul +
   timestamp (bukti kepemilikan wallet).
2. `create-campaign` memverifikasi tanda tangan Ed25519 terhadap
   `campaign_wallet`, mengecek kebaruan timestamp (anti-replay), dan
   **memaksa `campaign_wallet === creator_wallet`**.
3. Baru setelah valid, campaign disimpan memakai service role key.

Ini mencegah: spam campaign palsu dari klien, dan penunjukan wallet orang
lain sebagai penerima dana (impersonasi).

### Rekomendasi yang belum diterapkan (di luar scope)

- **Rate limiting**: belum ada throttling per-IP/per-wallet di Edge Function
  maupun Rest. Risiko rendah di devnet karena setiap donasi palsu tetap harus
  membayar biaya RPC & SOL asli untuk lolos verifikasi, tapi sebaiknya
  dipasang (dashboard Supabase atau middleware) sebelum mainnet.
- **Campaign untuk organisasi (multi-wallet)**: saat ini dana harus masuk ke
  wallet yang sama dengan yang membuat campaign (`campaign_wallet ===
  creator_wallet`). Jika ingin mendukung penggalangan untuk pihak lain
  (mis. organisasi), perlu skema tanda tangan ganda — pemilik campaign_wallet
  yang sign — yang bisa dikembangkan kemudian.

## Sebelum ke Production

- **Ganti jaringan**: ubah `NETWORK` di `src/wallet.js` dan `SOLANA_NETWORK`
  di secrets edge function dari `'devnet'` ke `'mainnet-beta'`.
- **Keamanan donasi**: insert ke tabel `donations` sudah dipindahkan ke Edge
  Function `verify-donation` yang memverifikasi transaksi on-chain sebelum
  menyimpannya (lihat atas). Pembuatan `campaigns` juga sudah lewat Edge
  Function `create-campaign` dengan verifikasi kepemilikan wallet. Pastikan
  kedua fungsi sudah di-deploy dan policy insert publik untuk `donations`
  **dan** `campaigns` **tidak** dipasang di Supabase.
- **Opsional — smart contract escrow**: untuk kontrol lebih ketat (misal
  dana baru bisa dicairkan setelah target tercapai, atau butuh approval
  multi-pihak), kerangka ini bisa dikembangkan lagi memakai program Anchor
  di Solana sebagai escrow, bukan transfer langsung ke wallet pribadi.
- **Multi-wallet support**: saat ini hanya mendukung Phantom. Bisa
  ditambahkan Solflare, Backpack, dll dengan Wallet Adapter resmi dari
  Solana (`@solana/wallet-adapter-*`).
