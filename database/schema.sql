-- =========================================================
-- Skema database untuk Platform Donasi Web3 (Solana)
-- Jalankan di Supabase SQL editor.
-- =========================================================

create extension if not exists pgcrypto; -- untuk gen_random_uuid()

-- Tabel users: menyimpan wallet yang pernah login
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,
  created_at timestamptz default now()
);

-- Tabel campaigns: penggalangan dana
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  description text not null check (char_length(description) between 10 and 1000),
  target_amount numeric not null check (target_amount > 0 and target_amount <= 100000),
  campaign_wallet text not null check (campaign_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  creator_wallet text not null check (creator_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at timestamptz default now(),
  status text not null default 'active'
);

-- Tabel donations: catatan setiap donasi (mirror dari transaksi on-chain, untuk UI cepat)
create table if not exists donations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete restrict,
  donor_wallet text not null check (donor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_sol numeric not null check (amount_sol > 0 and amount_sol <= 100000),
  tx_signature text not null unique check (tx_signature ~ '^[1-9A-HJ-NP-Za-km-z]{86,88}$'),
  created_at timestamptz default now()
);

create index if not exists idx_donations_campaign on donations(campaign_id);

-- ---------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------
alter table users enable row level security;
alter table campaigns enable row level security;
alter table donations enable row level security;

-- Semua orang boleh membaca (ini intinya: transparansi publik)
create policy "public read users" on users for select using (true);
create policy "public read campaigns" on campaigns for select using (true);
create policy "public read donations" on donations for select using (true);

-- Insert dibuka untuk anon key hanya untuk tabel `users` (mencatat wallet
-- yang login; berisi alamat publik saja, tanpa data sensitif).
create policy "public insert users" on users for insert with check (true);

-- NOTE: TIDAK ada policy "public insert campaigns".
-- Membuat campaign TIDAK boleh dilakukan klien langsung. Harus lewat Supabase
-- Edge Function `create-campaign` yang memverifikasi tanda tangan digital
-- kepemilikan wallet (campaign_wallet === creator_wallet) sebelum menyimpan
-- dengan service role key. Ini mencegah spam campaign palsu dan mencegah
-- seseorang menunjuk wallet orang lain sebagai penerima dana.

-- NOTE: TIDAK ada policy "public insert donations".
-- Insert donasi TIDAK boleh dilakukan klien langsung. Donasi harus lewat
-- Supabase Edge Function `verify-donation` yang memverifikasi transaksi
-- Solana on-chain dulu, lalu insert dengan service role key (yang by
-- default melewati RLS). Lapisan pengaman tersebut (sengaja dibuat
-- berlapis):
--   1. Tanpa policy insert publik, anon key TIDAK bisa insert (RLS menolak).
--   2. CHECK constraint memastikan format dasar valid (base58 wallet,
--      signature ~87 char, amount dalam batas) bahkan oleh service role.
--   3. tx_signature UNIQUE mencegah replay / duplikasi baris.
-- Verifikasi cepat di SQL editor:
--   select tablename, policyname from pg_policies
--   where tablename = 'donations';
--   -- harusnya HANYA "public read donations".

-- =========================================================
-- CATATAN KEAMANAN (baca sebelum ke production!)
-- =========================================================
-- Insert ke tabel `donations` DILARANG dari sisi klien (tidak ada policy
-- insert publik). Semua donasi harus melalui Supabase Edge Function:
--
--   supabase/functions/verify-donation/index.ts
--
-- Fungsi tersebut melakukan hal berikut sebelum menulis baris:
--   1. Ambil campaign & pastikan alamat penerima (campaign_wallet) valid.
--   2. Panggil connection.getTransaction(tx_signature) di jaringan Solana
--      (cluster sesuai SOLANA_NETWORK, default devnet — samakan dengan NETWORK
--      di src/wallet.js).
--   3. Pastikan transaksi ditandatangani oleh wallet donatur (fee payer).
--   4. Geser info pre/post balances untuk memastikan penerima menerima TEPAT
--      sejumlah amount_sol dari donatur (bukan angka asal-asalan).
--   5. Baru insert ke tabel menggunakan service role key.
--
-- Insert ke tabel `campaigns` juga DILARANG dari sisi klien (tidak ada
-- policy insert publik). Pembuatan campaign lewat Edge Function:
--
--   supabase/functions/create-campaign/index.ts
--
-- Yang memverifikasi tanda tangan Ed25519 bahwa pembuat benar-benar pemilik
-- campaign_wallet (dipaksa campaign_wallet === creator_wallet, plus nonce
-- timestamp anti-replay), DILARANG menunjuk wallet orang lain sebagai
-- penerima dana, sebelum insert dengan service role key.
--
-- Deploy edge function (CLI Supabase):
--   supabase functions deploy verify-donation --no-verify-jwt
--   supabase functions deploy create-campaign --no-verify-jwt
--   supabase secrets set SOLANA_NETWORK=devnet
--   supabase secrets set ALLOWED_ORIGINS=https://domain-produksi
--
-- Kolom tx_signature tetap unique mencegah duplikasi. Sumber kebenaran
-- transparansi tetaplah blockchain — baris di tabel ini hanyalah cache UI
-- yang sudah diverifikasi server, dan setiap baris tertaut ke Solana Explorer.

-- =========================================================
-- MIGRASI untuk database yang SUDAH terlanjur dibuat
-- (constraint pada CREATE TABLE hanya berlaku untuk tabel baru).
-- Jalankan di SQL editor secara MANUAL sekali saja:
-- =========================================================
-- alter table campaigns
--   add constraint campaigns_title_len_check
--   check (char_length(title) between 3 and 80);
-- alter table campaigns
--   add constraint campaigns_desc_len_check
--   check (char_length(description) between 10 and 1000);
-- alter table campaigns
--   add constraint campaigns_target_max_check
--   check (target_amount <= 100000);
-- alter table campaigns
--   add constraint campaigns_wallet_base58_check
--   check (campaign_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
-- alter table campaigns
--   add constraint campaigns_creator_wallet_base58_check
--   check (creator_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
-- alter table donations
--   add constraint donations_donor_wallet_base58_check
--   check (donor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
-- alter table donations
--   add constraint donations_amount_max_check
--   check (amount_sol <= 100000);
-- alter table donations
--   add constraint donations_tx_signature_base58_check
--   check (tx_signature ~ '^[1-9A-HJ-NP-Za-km-z]{86,88}$');
