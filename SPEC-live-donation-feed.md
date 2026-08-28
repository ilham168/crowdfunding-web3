# Spec: Live Donation Feed (Supabase Realtime)

## Objective

Tampilkan donasi baru **secara realtime** tanpa refresh manual, di dua halaman:
- `src/pages/campaignDetail.js` — feed donasi khusus campaign aktif (+ total terkumpul live)
- `src/pages/transparency.js` — buku kas global (semua campaign) (+ total SOL live)

User yang sedang membuka halaman akan langsung melihat donasi baru muncul di puncak
tabel + total ter-update, lengkap dengan animasi highlight singkat dan indikator
status koneksi realtime ("Live"/"Terputus").

## Tech Stack

- Vanilla JS (ESM) + Vite, router hash (`src/router.js`, TIDAK diubah)
- Backend: Supabase (`@supabase/supabase-js` v2) — sudah menyediakan Realtime
  (`supabase.channel(...).on('postgres_changes', ...).subscribe()`), **tidak ada
  dependency baru**.
- Tabel: `donations` (id, campaign_id, donor_wallet, amount_sol, tx_signature,
  created_at). RLS sudah punya policy `public read donations` (SELECT publik) →
  subscribe realtime oleh klien anon berfungsi.

## Commands

```
Build: npm run build
Dev:   npm run dev
```

Tidak ada test runner terpasang → verifikasi = build + uji manual browser
(2 tab). Lihat "Verifikasi Manual" di bawah.

## Project Structure

```
src/
  realtime.js                  (BARU) helper subscribe/unsubscribe channel donations
  supabaseClient.js             (DIBACA) ekspor `supabase`
  style.css                     (DIEDIT: + kelas badge & animasi highlight)
  pages/
    campaignDetail.js           (DIEDIT: subscribe per campaign)
    transparency.js             (DIEDIT: subscribe global)
```

## Code Style

Mengikuti pola file yang ada (no framework, DOM string template + `escapeHtml`,
`shortAddress`, `formatDate`, `explorerUrl`, `showToast`). Contoh gaya update row:

```js
const row = document.createElement('tr');
row.innerHTML = `...`;  // pakai escapeHtml untuk semua input pengguna
row.classList.add('donation-flash');       // animasi highlight
tbody.prepend(row);
setTimeout(() => row.classList.remove('donation-flash'), 2000);
```

Konvensi: `const`, `export function`, kebab-case class, komentar `//` pendek,
tanpa library tambahan.

## Testing Strategy

- Tidak ada test framework → verifikasi = `npm run build` lolos + uji manual
  dua tab (detail di bawah).
- Race-condition & dedupe diuji manual dengan donasi cepat ganda.

## Boundaries

- **Always:** panggil `unsubscribe`/cleanup channel saat halaman berganti
  (prevents channel menumpuk). Validasi input via `escapeHtml`. Dedupe berdasarkan
  `id`/`tx_signature`. Build harus lolos.
- **Ask first:** mengubah tampilan konten yang sudah ada (mis. menambah elemen
  "total terkumpul"/progress ke halaman detail). Mengubah `src/router.js`.
- **Never:** mengubah `src/wallet.js`, `src/router.js`, logika verifikasi donasi
  (Edge Function `verify-donation`), `dashboard.js`, `login.js`,
  `createCampaign.js`, `components/particles.*`, menambah dependency.

## Success Criteria

1. Donasi baru muncul di puncak tabel (halaman detail + transparency) **tanpa
   reload**, saat ada INSERT baru di tabel `donations`.
2. Total SOL / angka terkumpul di halaman ter-update secara live.
3. Baris baru punya animasi highlight (fade ~2 detik).
4. Indikator status: "● Live" (hijau) saat channel terkoneksi, "○ Terputus" saat
   koneksi putus (callback status `.subscribe((status) => ...)`).
5. Pindah rute berulang kali TIDAK menumpuk channel (tidak ada memory leak).
6. Race condition: donasi yang sama tidak muncul dobel (dedupe by id).
7. `npm run build` lolos.

## Open Questions / ASSUMPTIONS

**ASSUMPTIONS I'M MAKING (koreksi saya kalau salah):**
1. Donasi dimasukkan via Edge Function `verify-donation` (service role,
   bypass RLS) — realtime `postgres_changes` tetap MENJADI event ke subscriber
   anon karena RLS SELECT `donations` publik. Akan saya verifikasi saat uji.
2. Halaman-halaman ini TIDAK memakai partikel antigravity → cukup ikuti gaya
   card/tabel yang ada.
3. Realtime `postgres_changes` pada tabel `donations` tidak membutuhkan perubahan
   skema/policy (SELECT sudah publik).

**OPEN QUESTION — progress bar / "raised" (DISEPAKATI):**
Spec butir 2 meminta "update total raised / progress bar campaign secara live" di
`campaignDetail.js`, TAPI halaman detail saat ini TIDAK menampilkan progress bar
maupun total terkumpul — elemen itu ada di `dashboard.js` (di luar scope).
KEPUTUSAN (disetujui user, 28 Aug 2026): **tambah kotak "Total Terkumpul"**
(raised SOL + % target) ke `campaignDetail.js` sebagai bagian fitur ini — dengan
CSS progress bar yang konsisten dengan `.progress-bar`/`.progress-fill` yang ada
di dashboard — lalu update live.

**CLEANUP STRATEGY (keputusan desain, butir 5):**
Router SPA memakai `root.innerHTML` replace tanpa lifecycle hook (dan dilarang
diubah). Saya pilih pola gabungan:
  - `src/realtime.js` menyimpan referensi channel aktif di module scope; memanggil
    `subscribeDonations()` lagi (di awal render halaman) otomatis
    `unsubscribe()` channel sebelumnya → mencegah menumpuk antar halaman.
  - Ditambah `MutationObserver` pada `#app` yang mendeteksi saat node penanda
    milik halaman terlepas dari DOM (pola mirip `canvas.isConnected` di
    particles.js) → cleanup otomatis bila halaman berganti tanpa subscribe baru.
Alasan: deterministik (tidak hanya andalkan tick timer), tidak menyentuh router,
dan menutup dua jalur bocornya.
