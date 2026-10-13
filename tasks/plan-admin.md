# Plan: Enable Admin Features (end-to-end)

Spec = pesan user (LANGKAH 3: Admin spec) — sudah disepakati. Rencana ini
mengikuti hasil inventaris (gap yang ditemukan), bukan dari nol.

## Root cause (sudah direproduksi)

5 Edge Function krusial belum ter-deploy → check-admin 404 → UI menganggap semua
wallet "bukan admin" → `#/admin` ditolak, navbar tanpa link, moderasi laporan
gagal. Sisanya adalah kesenjangan kecil di frontend.

## Slices (vertikal, tiap slice = kondisi testable)

| # | Slice | Depend on | Verify |
|---|---|---|---|
| 1 | Deploy 7 edge function (`--no-verify-jwt`, `--project-ref`) | — | `supabase functions list` ACTIVE; `curl` check-admin → `{is_admin:true}` untuk wallet admin |
| 2 | `admin.js`: heading netral (no-flash), stats platform (SOL total, tx count, wallet count), denied → "Akses ditolak" + redirect, error jujur | slice 1 | lint, test, build; review markup |
| 3 | `adminAccess.js`: cache session (bukan 60s) + `clearAdminCache()` dipanggil `disconnectWallet()` | — | test adminAccess tetap hijau; lint |
| 4 | Guard & verifikasi: negatif-test (PATCH campaigns anon → 42501; set-campaign-status tanpa signature → 400), lint/test/build, daftar langkah skenario 1-5 utk user (butuh Phantom) | 1-3 | bukti HTTP + test suite |

## Batasan

- Tidak menyentuh `NETWORK` di `src/wallet.js` (tetap devnet).
- Tidak menambah DELETE campaigns/donations; update status HANYA kolom
  `status` + `flag_reason`.
- Tidak mencetak secret/service role/.env.
- Rencana lama (Live Donation Feed) di `tasks/plan.md` & `tasks/todo.md`
  TIDAK ditimpa; plan untuk task ini disimpan di file terpisah.