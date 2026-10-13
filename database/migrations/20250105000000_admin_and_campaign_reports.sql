-- =========================================================
-- 20250105000000_admin_and_campaign_reports.sql
--
-- Moderasi minimal: whitelist admin + laporan campaign.
--
-- Prinsip yang dipegang migration ini:
--   1. Tutup, jangan hapus. Tidak ada DELETE campaigns di mana pun.
--   2. Policy UPDATE publik pada `users` dicabut; perubahan profil hanya
--      lewat Edge Function update-profile yang memverifikasi signature.
--   3. Tabel admin_wallets tidak bisa dibaca publik, jadi daftar moderator
--      tidak bocor.
--   4. Isi laporan campaign hanya dibaca server; tidak dibuka ke anon.
-- =========================================================

-- ---------- Tabel admin ----------
create table if not exists public.admin_wallets (
  wallet_address text primary key
    constraint admin_wallets_wallet_format check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  added_at     timestamptz not null default now()
);

-- Sengaja TIDAK ada policy SELECT untuk anon/authenticated.
-- Policy SELECT di sini berarti siapa pun bisa mengunduh daftar moderator.
-- moderator. Akses hanya lewat Edge Function check-admin (service role).
alter table public.admin_wallets enable row level security;

-- Seed moderator.
--
-- Sengaja DIKOMENTARI, bukan dieksekusi. Nilai placeholder di bawah tidak
-- mungkin lolos constraint `admin_wallets_wallet_format` (bukan base58 Solana),
-- jadi membiarkannya aktif membuat seluruh migration gagal di tengah jalan.
-- Ganti nilainya dengan wallet admin sebenarnya, lalu jalankan manual SETELAH
-- migration ini berhasil:
--
--   insert into public.admin_wallets (wallet_address)
--   values ('<WALLET_ADMIN_ANDA>')
--   on conflict (wallet_address) do nothing;
--
-- Verifikasi admin dengan cara yang sama seperti pengguna biasa:
--   1. Buka app dengan wallet admin.
--   2. Klik "Simpan Profil" di halaman Profil (minta signature).
--   3. Cek baris muncul di tabel `users` dengan display_name yang kamu isi.
--   4. Buka Panel Moderasi; linknya hanya muncul untuk wallet ini.
--insert into public.admin_wallets (wallet_address)
--values ('GANTI_DENGAN_WALLET_ADMIN_ASLI')
--on conflict (wallet_address) do nothing;

-- ---------- Status 'flagged' + alasan ----------
-- Tabel campaign_reports (lihat bawah) memakai status ini sebagai penanda
-- campaign yang sedang ditinjau moderator.
alter table public.campaigns
  drop constraint if exists campaigns_status_check;

alter table public.campaigns
  add column if not exists flag_reason text;

alter table public.campaigns
  drop constraint if exists campaigns_status_check;
alter table public.campaigns
  add constraint campaigns_status_check
    check (status in ('active', 'closed', 'flagged'));

-- Alasan laporan hanya ada saat flagged; harus kosong untuk status lain.
alter table public.campaigns
  drop constraint if exists campaigns_flag_reason_matches_status;
alter table public.campaigns
  add constraint campaigns_flag_reason_matches_status
    check (
      (status = 'flagged' and flag_reason is not null and length(flag_reason) between 10 and 500)
      or (status <> 'flagged' and flag_reason is null)
    );

-- ---------- Laporan campaign ----------
create table if not exists public.campaign_reports (
  id              uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT, bukan CASCADE: kalau campaign dihapus, jejaknya
  -- laporan ikut hilang tanpa jejak. Jejak laporan harus tetap bisa
  -- ditelusuri.
  campaign_id     uuid not null
    references public.campaigns(id) on delete restrict,
  reporter_wallet text not null
    constraint campaign_reports_wallet_format check (reporter_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  reason          text not null
    constraint campaign_reports_reason_length check (length(btrim(reason)) between 10 and 500),
  created_at      timestamptz not null default now(),
  -- Satu laporan per wallet per campaign: mencegah spam dari wallet yang sama.
  constraint campaign_reports_unique unique (campaign_id, reporter_wallet)
);

alter table public.campaign_reports enable row level security;

-- TIDAK ada policy SELECT/INSERT/UPDATE/DELETE untuk anon maupun
-- authenticated. Alasannya, bukan sekadar lupa:
--   - SELECT publik berarti daftar isi laporan (termasuk nama wallet pelapor)
--     terbuka untuk semua orang.
--   - INSERT publik berarti siapa pun bisa mengarang laporan atas nama wallet
--     lain: RLS tidak punya sesi untuk membuktikan siapa pengirimnya.
-- Jadi: select hanya lewat service role di panel admin, insert hanya lewat
-- Edge Function report-campaign.

-- ---------- Realtime: campaigns & donations ----------
-- Halaman detail campaign berlangganan event donasi. Tanpa baris di bawah,
-- subscribe() berhasil secara teknis tapi tidak pernah menerima event,
  -- persis jenis kegagalan yang tidak terlihat di console.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'donations'
  ) then
    alter publication supabase_realtime add table public.donations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
end $$;