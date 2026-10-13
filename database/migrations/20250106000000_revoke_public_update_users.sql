-- =========================================================
-- 20250106000000_revoke_public_update_users.sql
--
-- Cabut policy UPDATE publik pada `users`.
--
-- Migration 20250103000000_add_allow_update_users.sql membuka:
--
--   create policy "allow update users" on public.users
--     for update to anon, authenticated using (true);
--
-- `USING (true)` berarti APA PUN yang memegang anon key (yaitu kode frontend
-- yang sedang kamu baca) bisa menulis kolom apa pun pada baris wallet mana
-- pun. Dikombinasikan dengan SELECT yang memang publik, ini berarti:
--   - siapa pun bisa mengganti display_name/bio wallet orang lain;
--   - sekarang `avatar_url` juga bisa ditulis, jadi halaman profil orang lain
--     bisa dibuat menunjuk gambar apa saja.
--
-- App tidak butuh policy ini: halaman profil memakai Edge Function
-- update-profile yang memverifikasi tanda tangan Ed25519, sehingga hanya
-- pemilik wallet yang bisa mengubah barisnya. SELECT tetap publik supaya
-- avatar dan nama campaign tetap bisa dibaca semua orang.
-- =========================================================

drop policy if exists "allow update users" on public.users;
drop policy if exists "allow_update_users" on public.users;
drop policy if exists "Allow public update" on public.users;

-- Penjaga: kalau nama policy di project ini berbeda lagi, jalur mutasi
-- masih mungkin ada. Verifikasi manual dengan:
--
--   select policyname, cmd, roles, qual
--     from pg_policies where tablename = 'users' and cmd = 'UPDATE';
--
-- Hasil yang diharapkan: tidak ada baris untuk cmd='UPDATE' dan role anon.