-- Migration: bucket storage `avatars` + policy read publik
--
-- Bucket ini dipakai untuk foto profil pengguna. Kebutuhan awal:
-- - upload avatar saat pengguna menyimpan profil.
-- - baca publik agar avatar bisa ditampilkan di navbar, dashboard, dsb
--   tanpa perlu autentikasi tambahan.
--
-- Catatan keamanan:
-- Karena bucket public, siapa pun yang tahu path objek bisa membuka filenya.
-- Konten avatar dianggap data publik (tidak sensitif). Nanti jika perlu,
-- ubah ke signed URL + policy SELECT terbatas.
BEGIN;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy if not exists "public read avatars"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

COMMIT;
