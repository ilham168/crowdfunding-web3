# Tasks: Live Donation Feed

Berdasarkan `SPEC-live-donation-feed.md` (approved) dan `tasks/plan.md`.

- [ ] Task: src/realtime.js — helper subscribeDonations reusable + auto-cleanup
  - Acceptance: ekspor `subscribeDonations({ onEvent, filter, onStatus })` yang
    membungkus `supabase.channel().on('postgres_changes', { INSERT, schema, table,
    filter }, cb).subscribe((status)=>...)`; hanya 1 channel aktif per waktu;
    auto-unsubscribe channel lama saat dipanggil lagi; MutationObserver cleanup saat
    node penanda terlepas; mengembalikan handle { unsubscribe, channel }.
  - Verify: `npm run build`; import tanpa error.
  - Files: `src/realtime.js`

- [ ] Task: style.css — kelas live-badge, donation-flash, raised-summary/progress
  - Acceptance: `.live-badge` (hijau saat is-live, abu/merah saat not-live, dot),
    `.donation-flash` (highlight fade ~2s), `.raised-summary` + progress bar
    konsisten dgn `.progress-bar`/`.progress-fill`. Sertakan `prefers-reduced-motion`.
  - Verify: `npm run build`; render visual.
  - Files: `src/style.css`

- [ ] Task: transparency.js — subscribe global, prepend row + flash, update total, badge
  - Acceptance: saat INSERT donations global → baris baru di puncak tabel (dedupe),
    flash, total SOL live; badge Live/Terputus dari status; cleanup otomatis.
  - Verify: 2-tab test; build.
  - Files: `src/pages/transparency.js`

- [ ] Task: campaignDetail.js — kotak Total Terkumpul + progress, subscribe per-campaign,
      update raised live, badge
  - Acceptance: kotak raised+% target (progress bar) render & update live; subscribe
    filter `campaign_id=eq.<id>`; prepend row + flash; badge; cleanup otomatis.
  - Verify: 2-tab test (campaign sama); build.
  - Files: `src/pages/campaignDetail.js`

- [ ] Task: verifikasi race & dedupe menyeluruh + review
  - Acceptance: donasi ganda tidak dobel; channel tidak menumpuk saat pindah rute
    (`supabase.getChannels()` stabil); build lolos.
  - Verify: uji manual + `npm run build`.
  - Files: (review) src/realtime.js, kedua halaman
