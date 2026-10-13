-- Migration: izinkan update profil users dari anon key + catat risiko
--
-- Saat ini policy UPDATE untuk tabel `users` belum ada, sehingga simpan
-- profil (display_name/bio/avatar_url) dari klien gagal di bawah RLS
-- meski kode frontend sudah mengirim query UPDATE.
--
-- Kebijakan sementara: izinkan UPDATE publik seperti policy insert yang
-- sudah ada untuk users. Ini sama-sama mengizinkan perubahan data profil
-- wallet manapun oleh siapa pun yang tahu alamatnya, karena proyek ini
-- tidak memakai Supabase Auth session sungguhan.
--
-- TODO HARDENING (sebelum produksi):
-- - Pertimbangkan ganti ke policy berbasis session/service role, atau
--   batasi UPDATE hanya untuk baris milik wallet yang sedang login
--   dengan verifikasi ownership yang lebih kuat (mis. sign a message).
BEGIN;

create policy if not exists "public update users"
  on users
  for update
  using (true)
  with check (true);

COMMIT;
