// =========================================================
// Supabase Edge Function: create-campaign
//
// Membuat campaign TANPA membiarkan anon key langsung insert ke tabel
// `campaigns`. Fungsi ini memverifikasi kepemilikan wallet SEBELUM
// menyimpan, sehingga:
//   1. Tidak ada yang bisa membuat campaign dengan alamat penerima
//      (campaign_wallet) milik orang lain tanpa tanda tangan pemiliknya.
//   2. Tidak ada spam campaign palsu dari klien yang hanya menebak nilai.
//
// Alur:
//   - Klien menandatangani pesan (lihat src/wallet.js signTextMessage)
//     berisi campaign_wallet + title + timestamp.
//   - Fungsi ini memverifikasi signature Ed25519 terhadap campaign_wallet.
//   - Dipaksa campaign_wallet === creator_wallet dan ada pada batch signature
//     (pemilik wallet yang menandatangani = penerima dana).
//
// Deploy:
//   supabase functions deploy create-campaign --no-verify-jwt
//   supabase secrets set ALLOWED_ORIGINS=https://domain-produksi
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';
import {
  getAllowedOrigins,
  handlePreflight,
  json,
} from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Origin project ini; dipakai agar photo_url hanya boleh menunjuk Storage
// project ini (mencegah URL gambar dari host pihak ketiga).
const SUPABASE_ORIGIN = (() => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

// Batas toleransi kebaruan timestamp (mencegah replay tanda tangan lama).
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

// --- base58 decode (Solana public key) -----------------------------------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

function base58ToBytes(input: string): Uint8Array {
  let num = 0n;
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('karakter base58 tidak valid');
    num = num * BASE + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  // leading '1' = 0
  for (const ch of input) {
    if (ch === '1') bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

function getSignerAddress(message: string): string {
  // Pesan menyertakan baris "Wallet: <address>".
  const m = message.match(/Wallet:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function getTimestamp(message: string): number {
  const m = message.match(/Timestamp:\s*([0-9T:.Z\-+]+)/);
  return m ? Date.parse(m[1]) : NaN;
}

// --- CORS ---------------------------------------------------------------
// Helper CORS dipakai dari ../_shared/cors.ts (libur duplikasi; lihat file itu).

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? null;
  const allowedOrigins = getAllowedOrigins();

  if (origin && !allowedOrigins.includes(origin)) {
    return json({ error: 'Origin tidak diizinkan.' }, 403, origin);
  }

  if (req.method === 'OPTIONS') {
    return handlePreflight(origin);
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method tidak diizinkan.' }, 405, origin);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Konfigurasi server tidak lengkap.' }, 500, origin);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return json({ error: 'Body harus berupa JSON.' }, 400, origin);
    }

    const {
      title, description, target_amount, campaign_wallet, creator_wallet,
      signed_message, signature,
      photo_urls, location_lat, location_lng, location_label,
    } = body;

    // --- Validasi input dasar ---------------------------------------------
    if (
      typeof title !== 'string' || typeof description !== 'string' ||
      typeof campaign_wallet !== 'string' || typeof creator_wallet !== 'string' ||
      typeof signed_message !== 'string' || typeof signature !== 'string'
    ) {
      return json({ error: 'Field wajib tidak lengkap.' }, 400, origin);
    }

    if (title.trim().length < 3 || title.trim().length > 80) {
      return json({ error: 'Judul harus antara 3 dan 80 karakter.' }, 400, origin);
    }
    if (description.trim().length < 10 || description.trim().length > 1000) {
      return json({ error: 'Deskripsi harus antara 10 dan 1000 karakter.' }, 400, origin);
    }
    const amount = Number(target_amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return json({ error: 'Target donasi harus antara 0 dan 100000 SOL.' }, 400, origin);
    }

    // --- Validasi field OPSIONAL: foto & lokasi ------------------------------
    // Semua field di bawah boleh tidak diisi (undefined/null) => campaign tetap
    // boleh dipublikasikan. Hanya divalidasi format bila dikirim.
    let photoArray: string[] | null = null;
    if (photo_urls !== undefined && photo_urls !== null) {
      if (!Array.isArray(photo_urls) || photo_urls.length === 0 || photo_urls.length > 5) {
        return json({ error: 'photo_urls harus berupa array 1-5 URL.' }, 400, origin);
      }
      if (!SUPABASE_ORIGIN) {
        return json({ error: 'Konfigurasi server tidak lengkap.' }, 500, origin);
      }
      for (const p of photo_urls) {
        if (typeof p !== 'string' || p.length === 0 || p.length > 300) {
          return json({ error: 'Setiap photo_url harus berupa URL https:// yang valid.' }, 400, origin);
        }
        let u: URL;
        try {
          u = new URL(p);
        } catch {
          return json({ error: 'Setiap photo_url harus berupa URL https:// yang valid.' }, 400, origin);
        }
        if (u.protocol !== 'https:' || u.origin !== SUPABASE_ORIGIN) {
          return json(
            { error: 'photo_url harus URL https dari Supabase Storage project ini.' },
            400,
            origin,
          );
        }
      }
      photoArray = photo_urls as string[];
    }

    let lat: number | null = null;
    let lng: number | null = null;
    if (location_lat !== undefined && location_lat !== null && location_lat !== '') {
      lat = Number(location_lat);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return json({ error: 'location_lat harus angka antara -90 dan 90.' }, 400, origin);
      }
    }
    if (location_lng !== undefined && location_lng !== null && location_lng !== '') {
      lng = Number(location_lng);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return json({ error: 'location_lng harus angka antara -180 dan 180.' }, 400, origin);
      }
    }
    // Batas konsistensi: lat & lng harus hadir berpasangan.
    if ((lat === null) !== (lng === null)) {
      return json({ error: 'location_lat dan location_lng harus diisi keduanya (atau kosongkan).' }, 400, origin);
    }

    let label: string | null = null;
    if (location_label !== undefined && location_label !== null && location_label !== '') {
      if (typeof location_label !== 'string' || location_label.length > 120) {
        return json({ error: 'location_label maksimal 120 karakter.' }, 400, origin);
      }
      label = location_label.trim() || null;
    }

    // --- Verifikasi kepemilikan wallet -------------------------------------
    // campaign_wallet harus identik dengan creator_wallet, dan pesan yang
    // ditandatangani harus di-sign oleh pemilik campaign_wallet tsb.
    if (campaign_wallet !== creator_wallet) {
      return json({
        error: 'Untuk saat ini, campaign_wallet harus sama dengan wallet yang menandatangani (creator).',
      }, 422, origin);
    }
    if (!BASE58_RE.test(campaign_wallet) || campaign_wallet.length < 32 || campaign_wallet.length > 44) {
      return json({ error: 'Format wallet tidak valid.' }, 400, origin);
    }

    // Verifikasi pesan: wallet yang disebut di dalam pesan harus cocok.
    const signedAddr = getSignerAddress(signed_message);
    if (signedAddr !== campaign_wallet) {
      return json({ error: 'Pesan yang ditandatangani tidak sesuai kampanye ini.' }, 422, origin);
    }

    // Verifikasi kebaruan (anti replay).
    const ts = getTimestamp(signed_message);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
      return json({ error: 'Tanda tangan kedaluwarsa. Silakan ulangi.' }, 422, origin);
    }

    // Verifikasi tanda tangan Ed25519 terhadap public key Solana.
    let pubkey: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubkey = base58ToBytes(campaign_wallet);
      sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: 'Gagal membaca public key / signature.' }, 400, origin);
    }
    if (pubkey.length !== 32 || sigBytes.length !== 64) {
      return json({ error: 'Public key atau signature berukuran tidak valid.' }, 400, origin);
    }
    const msgBytes = new TextEncoder().encode(signed_message);
    if (!ed25519.verify(sigBytes, msgBytes, pubkey)) {
      return json({ error: 'Tanda tangan tidak valid: bukan pemilik wallet.' }, 422, origin);
    }

    // --- Simpan dengan service role ----------------------------------------
    const { data, error: insertError } = await supabase
      .from('campaigns')
      .insert([{
        title: title.trim(),
        description: description.trim(),
        target_amount: amount,
        campaign_wallet,
        creator_wallet,
        photo_urls: photoArray,
        location_lat: lat,
        location_lng: lng,
        location_label: label,
      }])
      .select()
      .single();

    if (insertError) {
      console.error('[insert campaign]', insertError.message);
      return json({ error: 'Gagal menyimpan campaign.' }, 500, origin);
    }

    return json({ ok: true, campaign: data }, 201, origin);
  } catch (err) {
    console.error('[create-campaign] error tak terduga:', err);
    return json({ error: 'Terjadi kesalahan internal.' }, 500, origin);
  }
});
