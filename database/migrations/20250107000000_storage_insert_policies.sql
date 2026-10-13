-- =========================================================
-- 20250107000000_storage_insert_policies.sql
--
-- Policy INSERT untuk bucket `avatars` dan `campaign-photos`.
--
-- Gejala sebelum migration ini: upload gagal dengan
--   42501 new row violates row-level security policy
-- padahal nama bucket dan kode upload sudah benar.
--
-- Batasan penting yang harus jujur dibaca lebih dulu:
-- Klien tidak punya sesi JWT — login memakai tanda tangan wallet, bukan
-- Supabase Auth. Artinya `auth.uid()` selalu null di policy mana pun, jadi
-- policy berbasis identitas pengguna TIDAK MUNGKIN dipakai di sini.
-- Konsekuensinya, policy INSERT hanya bisa membatasi "bentuk path", bukan
-- identitas pengirim. Policy di bawah karena itu sengaja konservatif:
--   - hanya bucket yang benar;
--   - path wajib berawalan folder yang benar;
--   - nama file wajib diawali wallet 32–44 karakter base58;
--   - ukuran dibatasi oleh metadata `size` (2MB avatar, 5MB foto campaign).
-- Batas ukuran memakai `metadata->>'size'`, jadi hanya berlaku selama Storage
-- mengisi metadata itu (untuk upload lewat Storage API selalu terisi). Policy
-- ini bukan bukti kepemilikan kriptografis: seseorang tetap bisa menulis path
-- berawalan wallet orang lain. Yang dicegah adalah penimpaan file orang lain
-- (suffix timestamp selalu baru) dan pembanjiran bucket. Untuk upload yang
-- benar-benar tidak bisa dipalsukan, revise-via Edge Function dengan
-- verifikasi signature — belum di scope v1.
-- =========================================================

-- ---------- avatars ----------
-- Nama objek yang diunggah kode: avatars/<wallet>-<timestamp>.<ext>
drop policy if exists "insert own avatar" on storage.objects;
drop policy if exists "upload avatars" on storage.objects;

create policy "insert own avatar" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}-[0-9]+\.[A-Za-z0-9]+$'
    and coalesce((metadata->>'mimetype') || '', 'image/') like 'image/%'
    and (metadata->>'size') ~ '^[0-9]+$'
    and (metadata->>'size')::bigint <= 2097152 -- 2MB, sama dengan batas di profile.js
  );

-- ---------- campaign photos ----------
-- Nama objek yang diunggah kode: campaign-photos/<wallet>-<ts>-<rand>.<ext>
drop policy if exists "insert own campaign photo" on storage.objects;
drop policy if exists "upload campaign photos" on storage.objects;

create policy "insert own campaign photo" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'campaign-photos'
    and (storage.foldername(name))[1] = 'campaign-photos'
    and (storage.foldername(name))[2] ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}-[0-9]+-[a-z0-9]+\.[A-Za-z0-9]+$'
    and coalesce((metadata->>'mimetype') || '', 'image/') like 'image/%'
    and (metadata->>'size') ~ '^[0-9]+$'
    and (metadata->>'size')::bigint <= 5242880 -- 5MB, sama dengan batas di createCampaign.js
  );

-- Verifikasi setelah dijalankan:
--   select policyname, cmd, roles from pg_policies
--    where tablename = 'objects' and cmd = 'INSERT';