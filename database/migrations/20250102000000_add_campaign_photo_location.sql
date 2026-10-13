-- Migration: foto dokumentasi + titik lokasi campaign (semua OPSIONAL)
--
-- Menambah kolom bukti visual & lokasi ke tabel `campaigns`. Semua kolom
-- nullable supaya campaign lama & baru tanpa isian tetap valid. Bucket
-- storage `campaign-photos` (public read) untuk menyimpan foto dokumentasi,
-- terpisah dari bucket `avatars` milik fitur profil.
BEGIN;

-- 1) Kolom bukti visual & lokasi (opsional, nullable)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS photo_urls text[];
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS location_lat numeric;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS location_lng numeric;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS location_label text;

-- 2) Bucket storage public untuk foto dokumentasi campaign
--    (read publik => transparansi: semua orang boleh melihat bukti).
insert into storage.buckets (id, name, public)
values ('campaign-photos', 'campaign-photos', true)
on conflict (id) do nothing;

-- 3) Policy read publik untuk objek di bucket campaign-photos
create policy if not exists "public read campaign-photos"
  on storage.objects for select
  using (bucket_id = 'campaign-photos');

COMMIT;
