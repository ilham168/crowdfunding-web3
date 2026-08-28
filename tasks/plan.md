# Plan: Live Donation Feed

Based on `SPEC-live-donation-feed.md` (approved).

## Components & dependencies

| Component | Responsibility | Depends on |
|---|---|---|
| `src/realtime.js` (NEW) | Bungkus `supabase.channel().on('postgres_changes'...).subscribe()`; kelola channel aktif tunggal + auto-cleanup; callback status; dedupe helper | supabaseClient |
| `src/style.css` (EDIT) | Kelas `live-badge` (+ is-live/not-live), `donation-flash` (animasi highlight), baris baru utk `raised-summary`/progress | — |
| `src/pages/campaignDetail.js` (EDIT) | Tambah kotak Total Terkumpul + progress; subscribe per-campaign; prepend row + flash; update raised live; badge Live | realtime, style |
| `src/pages/transparency.js` (EDIT) | Subscribe global; prepend row + flash; update total SOL live; badge Live | realtime, style |

Dependency direction: realtime.js → supabaseClient.js; pages → realtime.js + style.css.
No cycles.

## Build order / vertical slices

1. **Slice A — realtime.js + CSS awal**: helper reusable + style (badge, flash).
   Verifiable: build lolos; API terbaca oleh konsumen.
2. **Slice B — transparency (global)**: termurah untuk dipakai verifikasi awal
   (tanpa filter). Subscribe global, prepend row, update total, badge. Uji 2 tab.
3. **Slice C — campaignDetail (per-campaign + raised)**: kotak Total Terkumpul +
   progress, subscribe dengan filter `campaign_id`, prepend row, update raised,
   badge. Uji 2 tab pada campaign yang sama.
4. **Slice D — dedupe & verifikasi race**: hubungan race/id guard diperiksa
   menyeluruh; verifikasi manual + build.

## Risks & mitigations

- **Channel menumpuk** → realtime.js kelola channel aktif tunggal + MutationObserver
  auto-cleanup; verifikasi via `supabase.getChannels()`.
- **Realtime event dari service role insert** → RLS SELECT publik memungkinkan
  subscriber anon; diverifikasi di uji manual.
- **Progress bar tidak ada di detail** → tambah elemen (sudah disetujui user).
- **Double row saat race** → dedupe by `id` sebelum prepend.

## Verification checkpoints
- After each slice: `npm run build`.
- End: uji manual 2 tab; pastikan `supabase.getChannels()` tidak bertambah saat
  pindah rute; donasi baru muncul live + flash + badge.
