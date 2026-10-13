# Tasks: Enable Admin Features + BUG 1 (CORS) + BUG 2 (panel aksi)

Berdasarkan pesan user (spec admin, LANGKAH 3), `tasks/plan-admin.md`, dan
dua bug yang di-reproduksi setelah deploy.

## Selesai

- [x] Deploy 7 edge functions (`--no-verify-jwt`, `--project-ref
      cnoymqsfnpwyjdwhqzfv`) → semua ACTIVE.
- [x] BUG 1 root cause: preflight 204 + body → Deno 500 tanpa CORS → browser
      blokir ("Failed to fetch"). Fix: `supabase/functions/_shared/cors.ts`
      (helper bersama), semua 7 fungsi memakainya; preflight = `new Response
      (null,{status:204,...})`; semua jalur respons memakai `json()` ber-CORS;
      handler `create-campaign` & `verify-donation` dibungkus try/catch.
- [x] BUG 2 fix `src/pages/admin.js`: tab filter (Semua/Aktif/Ditinjau/Ditutup
      + hitungan, `aria-selected`), aksi per status dipindah ke
      `src/adminActions.js` (active→Tandai Ditinjau; flagged→Aktifkan
      lagi+Tutup; closed→tanpa aksi), refetch dari server setelah aksi.
- [x] `src/pages/createCampaign.js`: pesan error membedakan koneksi/fetch vs
      penolakan server; `console.error` menyertakan endpoint.
- [x] `src/adminAccess.js` cache sesi + `clearAdminCache()` saat logout.
- [x] Guard: `tests/adminActions.test.js` (mesin status→aksi),
      `tests/e2e/cors-smoke.mjs` (7 fungsi: preflight 204 + ACAO, origin asing
      tanpa ACAO, POST selalu ber-CORS).
- [x] Reproduksi: `tests/e2e/repro-bug1.mjs` (kini 422 server, bukan "Failed
      to fetch"), `tests/e2e/repro-bug2.mjs` (aksi per status + tab/filter PASS).
- [x] Pengecekan `npm run lint`, `npm test` (52 tes), `npm run build` hijau.
- [x] `docs/ADMIN_SETUP.md` diperbarui (status deploy, CORS shared, aksi per
      status, guard/smoke test, checklist).

## Catatan / temuan (tanpa perbaikan, non-bloker)

- Storage bucket `campaign-photos`/`avatars`: policy INSERT tampaknya TIDAK
  ditegakkan — upload nama/mimetype/size apa pun berhasil (200). Dilaporkan
  sebagai temuan, bukan blocker.
- Deno tidak terpasang lokal → validasi sintaks fungsi lewat deploy +
  `node` brace-check + review.