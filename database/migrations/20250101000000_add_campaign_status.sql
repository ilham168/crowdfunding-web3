-- Migration: status campaign + hapus cascade pada donations
BEGIN;

-- 1) Tambah kolom status campaign
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 2) Ganti FK donations.campaign_id dari CASCADE ke RESTRICT
ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_campaign_id_fkey;
ALTER TABLE donations ADD CONSTRAINT donations_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;

COMMIT;
